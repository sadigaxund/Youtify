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
import re
import json
import glob
import sqlite3
from contextlib import contextmanager
from typing import Optional, Dict, Any, List

SCHEMA_VERSION = 3


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
            conn.execute('''
                CREATE TABLE IF NOT EXISTS playlists (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL DEFAULT 'manual',
                    filters_json TEXT,
                    sort_json TEXT,
                    has_cover INTEGER DEFAULT 0,
                    position INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            # Add `position` to pre-existing DBs (no-op if already present).
            try:
                conn.execute("ALTER TABLE playlists ADD COLUMN position INTEGER DEFAULT 0")
            except Exception:
                pass
            # v3: play stats + favorite (no-ops if already present).
            for ddl in ("ALTER TABLE audio_files ADD COLUMN play_count INTEGER DEFAULT 0",
                        "ALTER TABLE audio_files ADD COLUMN last_played TIMESTAMP",
                        "ALTER TABLE audio_files ADD COLUMN favorite INTEGER DEFAULT 0"):
                try:
                    conn.execute(ddl)
                except Exception:
                    pass
            conn.execute('''
                CREATE TABLE IF NOT EXISTS playlist_tracks (
                    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                    youtube_id TEXT NOT NULL,
                    position INTEGER,
                    PRIMARY KEY (playlist_id, youtube_id)
                )
            ''')
            conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    # ------------------------------------------------------------------ writes

    def upsert_audio(self, *, youtube_id: str, title: Optional[str] = None,
                     album: Optional[str] = None, year=None, duration=None,
                     rel_path: Optional[str] = None, filename: Optional[str] = None,
                     sidecar_path: Optional[str] = None, effects: Optional[dict] = None,
                     artists: Optional[List[str]] = None, genres: Optional[List[str]] = None,
                     albums: Optional[List[str]] = None,
                     custom_fields: Optional[Dict[str, Any]] = None,
                     play_count: Optional[int] = None, last_played: Optional[str] = None,
                     favorite: Optional[bool] = None, created_at: Optional[str] = None) -> int:
        """
        Insert or update a track by youtube_id (id is preserved on update).
        Tags and custom fields are fully replaced to mirror the current state.
        play_count/last_played/favorite/created_at are sidecar-backed (so they
        survive rebuilds); when None, existing DB values are preserved.
        """
        artists = _norm_list(artists)
        genres = _norm_list(genres, titlecase=True)
        # Albums: multi-value via the tags table; the `album` column keeps the
        # canonical (first) value for players/facets that expect a single one.
        albums = _norm_list(albums if albums is not None else ([album] if album else []))
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

        fav_val = None if favorite is None else (1 if favorite else 0)

        with self.get_connection() as conn:
            conn.execute('''
                INSERT INTO audio_files
                    (youtube_id, title, album, year, duration, rel_path, filename,
                     sidecar_path, effects_json, play_count, last_played, favorite,
                     created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?, COALESCE(?, 0), ?, COALESCE(?, 0),
                        COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
                ON CONFLICT(youtube_id) DO UPDATE SET
                    title=excluded.title, album=excluded.album, year=excluded.year,
                    duration=excluded.duration, rel_path=excluded.rel_path,
                    filename=excluded.filename, sidecar_path=excluded.sidecar_path,
                    effects_json=excluded.effects_json,
                    play_count=COALESCE(?, audio_files.play_count),
                    last_played=COALESCE(?, audio_files.last_played),
                    favorite=COALESCE(?, audio_files.favorite),
                    created_at=COALESCE(?, audio_files.created_at),
                    updated_at=CURRENT_TIMESTAMP
            ''', (youtube_id, title, album, year_val, dur_val, rel_path, filename,
                  sidecar_path, effects_json, play_count, last_played, fav_val, created_at,
                  play_count, last_played, fav_val, created_at))

            # lastrowid is unreliable on the DO UPDATE branch — re-select.
            row = conn.execute("SELECT id FROM audio_files WHERE youtube_id=?",
                               (youtube_id,)).fetchone()
            audio_id = row["id"]

            # Full replace of child rows.
            conn.execute("DELETE FROM audio_tags WHERE audio_file_id=?", (audio_id,))
            conn.execute("DELETE FROM metadata_fields WHERE audio_file_id=?", (audio_id,))

            for kind, values in (("artist", artists), ("genre", genres), ("album", albums)):
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

    def bump_play(self, audio_file_id: int) -> Optional[dict]:
        """Increment play count + stamp last_played. Returns the new stats."""
        with self.get_connection() as conn:
            cur = conn.execute('''
                UPDATE audio_files
                SET play_count = COALESCE(play_count, 0) + 1, last_played = CURRENT_TIMESTAMP
                WHERE id=?''', (audio_file_id,))
            if cur.rowcount == 0:
                return None
            row = conn.execute(
                "SELECT youtube_id, play_count, last_played FROM audio_files WHERE id=?",
                (audio_file_id,)).fetchone()
            return dict(row) if row else None

    def set_favorite(self, audio_file_id: int, fav: bool) -> Optional[str]:
        """Toggle favorite. Returns the track's youtube_id or None if absent."""
        with self.get_connection() as conn:
            row = conn.execute("SELECT youtube_id FROM audio_files WHERE id=?",
                               (audio_file_id,)).fetchone()
            if not row:
                return None
            conn.execute("UPDATE audio_files SET favorite=? WHERE id=?",
                         (1 if fav else 0, audio_file_id))
            return row["youtube_id"]

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

    @staticmethod
    def _canonical_first(values: List[str], canonical) -> List[str]:
        """Move the canonical value to the front (tag reads are alphabetical)."""
        if canonical and canonical in values:
            return [canonical] + [v for v in values if v != canonical]
        return values

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
            albums = self._tags_by_audio(conn, "album")
            # Custom fields per track (for client-side filtering/sorting).
            custom: Dict[int, Dict[str, str]] = {}
            for r in conn.execute(
                    "SELECT audio_file_id AS aid, field_name, field_value FROM metadata_fields").fetchall():
                custom.setdefault(r["aid"], {})[r["field_name"]] = r["field_value"]
            items = []
            for f in files:
                d = dict(f)
                d["artists"] = artists.get(f["id"], [])
                d["genres"] = genres.get(f["id"], [])
                d["albums"] = self._canonical_first(
                    albums.get(f["id"], []) or ([f["album"]] if f["album"] else []), f["album"])
                d["custom_fields"] = custom.get(f["id"], {})
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
            d["albums"] = self._canonical_first(
                [r["value"] for r in conn.execute('''
                    SELECT t.value FROM audio_tags at JOIN tags t ON t.id=at.tag_id
                    WHERE at.audio_file_id=? AND t.kind='album' ORDER BY t.value''',
                    (audio_file_id,)).fetchall()] or ([d["album"]] if d.get("album") else []),
                d.get("album"))
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

    @staticmethod
    def _prefix_then_contains(conn, sql, params_for, q, limit):
        """Run a value query prefix-first then contains, deduped (ci)."""
        esc = q.replace("%", r"\%").replace("_", r"\_")
        out, seen = [], set()
        for pat in (esc + "%", "%" + esc + "%"):
            if len(out) >= limit:
                break
            for r in conn.execute(sql, params_for(pat, limit)).fetchall():
                if r[0] is None:
                    continue
                v = str(r[0])
                if v and v.lower() not in seen:
                    seen.add(v.lower()); out.append(v)
                if len(out) >= limit:
                    break
        return out[:limit]

    def suggest_values(self, field: str, q: str = "", limit: int = 10) -> List[str]:
        """
        Distinct value suggestions for a metadata field:
          album / year       -> audio_files
          composer / <key>   -> metadata_fields (by field_name)
        """
        q = (q or "").strip()
        with self.get_connection() as conn:
            if field in ("album", "year"):
                col = field
                if not q:
                    rows = conn.execute(
                        f"SELECT DISTINCT {col} AS v FROM audio_files "
                        f"WHERE {col} IS NOT NULL AND {col} <> '' ORDER BY {col} LIMIT ?",
                        (limit,)).fetchall()
                    return [str(r["v"]) for r in rows]
                return self._prefix_then_contains(
                    conn,
                    f"SELECT DISTINCT {col} FROM audio_files "
                    f"WHERE {col} IS NOT NULL AND CAST({col} AS TEXT) LIKE ? ESCAPE '\\' ORDER BY {col} LIMIT ?",
                    lambda pat, lim: (pat, lim), q, limit)

            # Custom-tag values (and composer) are stored as a single delimiter-
            # joined string per track (e.g. "Sad|Angry"). Split them so the
            # autocomplete suggests INDIVIDUAL tokens, not the whole joined string.
            key = "Composer" if field == "composer" else field
            rows = conn.execute(
                "SELECT DISTINCT field_value AS v FROM metadata_fields "
                "WHERE field_name=? AND field_value <> '' ORDER BY field_value",
                (key,)).fetchall()
            tokens, seen = [], set()
            for r in rows:
                for tok in re.split(r"[|,;]", str(r["v"])):
                    tok = tok.strip()
                    if tok and tok.lower() not in seen:
                        seen.add(tok.lower()); tokens.append(tok)
            ql = q.lower()
            if ql:
                pref = [t for t in tokens if t.lower().startswith(ql)]
                cont = [t for t in tokens if ql in t.lower() and not t.lower().startswith(ql)]
                tokens = pref + cont
            return tokens[:limit]

    def suggest_custom_keys(self, q: str = "", limit: int = 20) -> List[str]:
        """Distinct custom-tag key names (for the key input autocomplete)."""
        q = (q or "").strip()
        with self.get_connection() as conn:
            if not q:
                rows = conn.execute(
                    "SELECT DISTINCT field_name AS v FROM metadata_fields ORDER BY field_name LIMIT ?",
                    (limit,)).fetchall()
                return [r["v"] for r in rows]
            return self._prefix_then_contains(
                conn,
                "SELECT DISTINCT field_name FROM metadata_fields "
                "WHERE field_name LIKE ? ESCAPE '\\' ORDER BY field_name LIMIT ?",
                lambda pat, lim: (pat, lim), q, limit)

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
                stats = sc.get("stats") or {}
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
                    albums=meta.get("albums") or ([meta["album"]] if meta.get("album") else []),
                    custom_fields={t["key"]: t["value"]
                                   for t in meta.get("custom_tags", []) if t.get("key")},
                    play_count=stats.get("play_count", 0),
                    last_played=stats.get("last_played"),
                    favorite=sc.get("favorite", False),
                    # Real date-added comes from the sidecar; without this every
                    # rebuild would reset created_at to "now". Normalized to
                    # SQLite's CURRENT_TIMESTAMP format so string sorting works.
                    created_at=(sc.get("created_at") or "").replace("T", " ")[:19] or None,
                )
                count += 1
            except Exception as e:
                print(f"Warning: failed to index sidecar {path}: {e}")
        return count

    # -------------------------------------------------------------- playlists

    def upsert_playlist(self, *, id, name, kind="manual", filters=None, sort=None,
                        has_cover=False, track_ids=None, position=0):
        with self.get_connection() as conn:
            conn.execute('''
                INSERT INTO playlists (id, name, kind, filters_json, sort_json, has_cover, position, updated_at)
                VALUES (?,?,?,?,?,?,?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name, kind=excluded.kind, filters_json=excluded.filters_json,
                    sort_json=excluded.sort_json, has_cover=excluded.has_cover,
                    position=excluded.position, updated_at=CURRENT_TIMESTAMP
            ''', (id, name, kind, json.dumps(filters or []), json.dumps(sort or {}),
                  1 if has_cover else 0, int(position or 0)))
            if track_ids is not None:
                conn.execute("DELETE FROM playlist_tracks WHERE playlist_id=?", (id,))
                for pos, yid in enumerate(track_ids):
                    conn.execute("INSERT OR IGNORE INTO playlist_tracks(playlist_id, youtube_id, position) "
                                 "VALUES(?,?,?)", (id, yid, pos))

    def list_playlists(self) -> List[dict]:
        with self.get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM playlists ORDER BY position, name COLLATE NOCASE").fetchall()
            counts = {}
            for r in conn.execute("SELECT playlist_id, COUNT(*) c FROM playlist_tracks GROUP BY playlist_id"):
                counts[r["playlist_id"]] = r["c"]
            out = []
            for r in rows:
                d = dict(r)
                d["count"] = counts.get(r["id"], 0)
                d["filters"] = json.loads(d.pop("filters_json") or "[]")
                d["sort"] = json.loads(d.pop("sort_json") or "{}")
                out.append(d)
            return out

    def get_playlist(self, pid) -> Optional[dict]:
        with self.get_connection() as conn:
            r = conn.execute("SELECT * FROM playlists WHERE id=?", (pid,)).fetchone()
            if not r:
                return None
            d = dict(r)
            d["filters"] = json.loads(d.pop("filters_json") or "[]")
            d["sort"] = json.loads(d.pop("sort_json") or "{}")
            d["track_ids"] = [x["youtube_id"] for x in conn.execute(
                "SELECT youtube_id FROM playlist_tracks WHERE playlist_id=? ORDER BY position",
                (pid,)).fetchall()]
            return d

    def delete_playlist(self, pid) -> Optional[dict]:
        with self.get_connection() as conn:
            r = conn.execute("SELECT * FROM playlists WHERE id=?", (pid,)).fetchone()
            if not r:
                return None
            conn.execute("DELETE FROM playlists WHERE id=?", (pid,))
            return dict(r)

    def rebuild_playlists_from_sidecars(self, pdir) -> int:
        count = 0
        for path in glob.glob(os.path.join(pdir, "*.json")):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    pl = json.load(fh)
                self.upsert_playlist(
                    id=pl["id"], name=pl.get("name", "Untitled"), kind=pl.get("kind", "manual"),
                    filters=pl.get("filters", []), sort=pl.get("sort", {}),
                    has_cover=pl.get("has_cover", False), track_ids=pl.get("track_ids", []),
                    position=pl.get("position", 0))
                count += 1
            except Exception as e:
                print(f"Warning: failed to index playlist {path}: {e}")
        return count

    def prune_stale(self, meta_dir: str, playlists_dir: str):
        """Delete all DB rows so the subsequent rebuild only inserts what still has sidecars."""
        with self.get_connection() as conn:
            conn.execute("DELETE FROM metadata_fields")
            conn.execute("DELETE FROM audio_tags")
            conn.execute("DELETE FROM audio_files")
            conn.execute("DELETE FROM playlist_tracks")
            conn.execute("DELETE FROM playlists")
