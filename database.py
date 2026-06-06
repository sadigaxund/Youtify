"""
Database module for caching audio metadata with SQLite.

This DB is a *rebuildable index*: the source of truth lives on disk as the
saved MP3s plus per-track sidecar JSON files under <save-dir>/.youtify/meta/.
If the DB is deleted it is repopulated by scanning those sidecars
(`rebuild_from_sidecars`).

Schema:
    audio_files     - one row per saved track (keyed by youtube_id)
    tags            - distinct (kind, value) pairs for artist/genre suggestions
    audio_tags      - many-to-many between audio_files and tags
    metadata_fields - EAV store for arbitrary custom tags
"""

import os
import json
import glob
import sqlite3
from contextlib import contextmanager
from typing import Optional, Dict, Any, List

SCHEMA_VERSION = 2


def _norm_list(values, titlecase=False) -> List[str]:
    """Strip, drop blanks, de-dupe case-insensitively (first spelling wins)."""
    out, seen = [], set()
    for v in values or []:
        v = (v or "").strip()
        if titlecase:
            v = v.title()
        if not v:
            continue
        k = v.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(v)
    return out


class AudioMetadataDB:
    def __init__(self, db_path: str):
        self.db_path = db_path
        os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
        self.init_db()

    @contextmanager
    def get_connection(self):
        """Fresh connection per call (safe under FastAPI's threadpool)."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")  # per-connection; required for cascade
        try:
            yield conn
        except Exception:
            conn.rollback()
            raise
        else:
            conn.commit()
        finally:
            conn.close()

    def init_db(self):
        with self.get_connection() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute('''
                CREATE TABLE IF NOT EXISTS audio_files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    youtube_id TEXT UNIQUE NOT NULL,
                    title TEXT,
                    album TEXT,
                    year INTEGER,
                    duration INTEGER,
                    rel_path TEXT,
                    filename TEXT,
                    sidecar_path TEXT,
                    effects_json TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS tags (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    kind TEXT NOT NULL,
                    value TEXT NOT NULL,
                    UNIQUE(kind, value)
                )
            ''')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS audio_tags (
                    audio_file_id INTEGER NOT NULL REFERENCES audio_files(id) ON DELETE CASCADE,
                    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                    PRIMARY KEY (audio_file_id, tag_id)
                )
            ''')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS metadata_fields (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    audio_file_id INTEGER NOT NULL REFERENCES audio_files(id) ON DELETE CASCADE,
                    field_name TEXT NOT NULL,
                    field_value TEXT
                )
            ''')
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tags_kind_value ON tags(kind, value)")
            conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    # ------------------------------------------------------------------ writes

    def upsert_audio(self, *, youtube_id: str, title: Optional[str] = None,
                     album: Optional[str] = None, year=None, duration=None,
                     rel_path: Optional[str] = None, filename: Optional[str] = None,
                     sidecar_path: Optional[str] = None, effects: Optional[dict] = None,
                     artists: Optional[List[str]] = None, genres: Optional[List[str]] = None,
                     custom_fields: Optional[Dict[str, Any]] = None) -> int:
        """
        Insert or update a track by youtube_id (id is preserved on update).
        Tags and custom fields are fully replaced to mirror the current state.
        """
        artists = _norm_list(artists)
        genres = _norm_list(genres, titlecase=True)
        custom_fields = custom_fields or {}
        effects_json = json.dumps(effects) if effects is not None else None

        try:
            year_val = int(year) if year not in (None, "") else None
        except (ValueError, TypeError):
            year_val = None
        try:
            dur_val = int(duration) if duration not in (None, "") else None
        except (ValueError, TypeError):
            dur_val = None

        with self.get_connection() as conn:
            conn.execute('''
                INSERT INTO audio_files
                    (youtube_id, title, album, year, duration, rel_path, filename,
                     sidecar_path, effects_json, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP)
                ON CONFLICT(youtube_id) DO UPDATE SET
                    title=excluded.title, album=excluded.album, year=excluded.year,
                    duration=excluded.duration, rel_path=excluded.rel_path,
                    filename=excluded.filename, sidecar_path=excluded.sidecar_path,
                    effects_json=excluded.effects_json, updated_at=CURRENT_TIMESTAMP
            ''', (youtube_id, title, album, year_val, dur_val, rel_path, filename,
                  sidecar_path, effects_json))

            # lastrowid is unreliable on the DO UPDATE branch — re-select.
            row = conn.execute("SELECT id FROM audio_files WHERE youtube_id=?",
                               (youtube_id,)).fetchone()
            audio_id = row["id"]

            # Full replace of child rows.
            conn.execute("DELETE FROM audio_tags WHERE audio_file_id=?", (audio_id,))
            conn.execute("DELETE FROM metadata_fields WHERE audio_file_id=?", (audio_id,))

            for kind, values in (("artist", artists), ("genre", genres)):
                for value in values:
                    conn.execute(
                        "INSERT INTO tags(kind, value) VALUES(?,?) "
                        "ON CONFLICT(kind, value) DO NOTHING", (kind, value))
                    tag_id = conn.execute(
                        "SELECT id FROM tags WHERE kind=? AND value=?",
                        (kind, value)).fetchone()["id"]
                    conn.execute(
                        "INSERT OR IGNORE INTO audio_tags(audio_file_id, tag_id) VALUES(?,?)",
                        (audio_id, tag_id))

            for k, v in custom_fields.items():
                if k:
                    conn.execute(
                        "INSERT INTO metadata_fields(audio_file_id, field_name, field_value) "
                        "VALUES(?,?,?)", (audio_id, str(k), str(v) if v is not None else None))

            return audio_id

    def delete_audio(self, audio_file_id: int) -> Optional[dict]:
        """Delete a track. Returns the row (for file cleanup) or None if absent."""
        with self.get_connection() as conn:
            row = conn.execute("SELECT * FROM audio_files WHERE id=?",
                               (audio_file_id,)).fetchone()
            if not row:
                return None
            conn.execute("DELETE FROM audio_files WHERE id=?", (audio_file_id,))
            return dict(row)

    # ------------------------------------------------------------------- reads

    def _tags_by_audio(self, conn, kind: str) -> Dict[int, List[str]]:
        rows = conn.execute('''
            SELECT at.audio_file_id AS aid, t.value AS value
            FROM audio_tags at JOIN tags t ON t.id = at.tag_id
            WHERE t.kind=? ORDER BY t.value
        ''', (kind,)).fetchall()
        out: Dict[int, List[str]] = {}
        for r in rows:
            out.setdefault(r["aid"], []).append(r["value"])
        return out

    def get_library(self) -> List[dict]:
        with self.get_connection() as conn:
            files = conn.execute(
                "SELECT * FROM audio_files ORDER BY created_at DESC").fetchall()
            artists = self._tags_by_audio(conn, "artist")
            genres = self._tags_by_audio(conn, "genre")
            items = []
            for f in files:
                d = dict(f)
                d["artists"] = artists.get(f["id"], [])
                d["genres"] = genres.get(f["id"], [])
                d.pop("effects_json", None)
                items.append(d)
            return items

    def get_audio_detail(self, audio_file_id: int) -> Optional[dict]:
        with self.get_connection() as conn:
            row = conn.execute("SELECT * FROM audio_files WHERE id=?",
                               (audio_file_id,)).fetchone()
            if not row:
                return None
            d = dict(row)
            d["artists"] = [r["value"] for r in conn.execute('''
                SELECT t.value FROM audio_tags at JOIN tags t ON t.id=at.tag_id
                WHERE at.audio_file_id=? AND t.kind='artist' ORDER BY t.value''',
                (audio_file_id,)).fetchall()]
            d["genres"] = [r["value"] for r in conn.execute('''
                SELECT t.value FROM audio_tags at JOIN tags t ON t.id=at.tag_id
                WHERE at.audio_file_id=? AND t.kind='genre' ORDER BY t.value''',
                (audio_file_id,)).fetchall()]
            d["custom_fields"] = {r["field_name"]: r["field_value"] for r in conn.execute(
                "SELECT field_name, field_value FROM metadata_fields WHERE audio_file_id=?",
                (audio_file_id,)).fetchall()}
            d["effects"] = json.loads(d["effects_json"]) if d.get("effects_json") else {}
            d.pop("effects_json", None)
            return d

    def suggest_tags(self, kind: str, q: str = "", limit: int = 10) -> List[str]:
        q = (q or "").strip()
        with self.get_connection() as conn:
            if q:
                # Prefix matches first, then contains; merged + de-duped.
                like_prefix = q.replace("%", r"\%").replace("_", r"\_") + "%"
                like_contains = "%" + q.replace("%", r"\%").replace("_", r"\_") + "%"
                rows = conn.execute('''
                    SELECT value FROM tags WHERE kind=? AND value LIKE ? ESCAPE '\\'
                    ORDER BY value LIMIT ?''', (kind, like_prefix, limit)).fetchall()
                out = [r["value"] for r in rows]
                if len(out) < limit:
                    seen = {v.lower() for v in out}
                    rows2 = conn.execute('''
                        SELECT value FROM tags WHERE kind=? AND value LIKE ? ESCAPE '\\'
                        ORDER BY value LIMIT ?''',
                        (kind, like_contains, limit)).fetchall()
                    for r in rows2:
                        if r["value"].lower() not in seen:
                            out.append(r["value"])
                            seen.add(r["value"].lower())
                        if len(out) >= limit:
                            break
                return out[:limit]
            rows = conn.execute(
                "SELECT value FROM tags WHERE kind=? ORDER BY value LIMIT ?",
                (kind, limit)).fetchall()
            return [r["value"] for r in rows]

    # -------------------------------------------------------------- rebuilding

    def rebuild_from_sidecars(self, meta_dir: str, save_dir: str) -> int:
        """Repopulate the DB from sidecar JSONs. Skips tracks whose MP3 is gone."""
        count = 0
        for path in glob.glob(os.path.join(meta_dir, "*.json")):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    sc = json.load(fh)
                rel = sc.get("rel_path")
                if rel and not os.path.exists(os.path.join(save_dir, rel)):
                    continue  # stale sidecar, file removed
                meta = sc.get("metadata", {})
                self.upsert_audio(
                    youtube_id=sc["youtube_id"],
                    title=meta.get("title"),
                    album=meta.get("album"),
                    year=meta.get("year"),
                    duration=sc.get("duration"),
                    rel_path=rel,
                    filename=sc.get("filename"),
                    sidecar_path=os.path.basename(path),
                    effects=sc.get("effects"),
                    artists=meta.get("artists", []),
                    genres=meta.get("genres", []),
                    custom_fields={t["key"]: t["value"]
                                   for t in meta.get("custom_tags", []) if t.get("key")},
                )
                count += 1
            except Exception as e:
                print(f"Warning: failed to index sidecar {path}: {e}")
        return count
