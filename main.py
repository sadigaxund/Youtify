import os
import tempfile
import uuid
import shutil
import threading
import datetime
import traceback
import logging
import base64
from typing import Optional, Dict

# Match uvicorn's log line style AND colors so app + server logs are uniform
# (e.g. a green "INFO:     Library index: ...").
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())
try:
    from uvicorn.logging import DefaultFormatter
    for _h in logging.getLogger().handlers:
        _h.setFormatter(DefaultFormatter("%(levelprefix)s %(message)s"))
except Exception:
    for _h in logging.getLogger().handlers:
        _h.setFormatter(logging.Formatter("%(levelname)s:     %(message)s"))
log = logging.getLogger("youtify")

YOUTIFY_BANNER = r"""
██╗   ██╗ ██████╗ ██╗   ██╗████████╗██╗███████╗██╗   ██╗
╚██╗ ██╔╝██╔═══██╗██║   ██║╚══██╔══╝██║██╔════╝╚██╗ ██╔╝
 ╚████╔╝ ██║   ██║██║   ██║   ██║   ██║█████╗   ╚████╔╝
  ╚██╔╝  ██║   ██║██║   ██║   ██║   ██║██╔══╝    ╚██╔╝
   ██║   ╚██████╔╝╚██████╔╝   ██║   ██║██║        ██║
   ╚═╝    ╚═════╝  ╚═════╝    ╚═╝   ╚═╝╚═╝        ╚═╝
"""


def print_startup_banner(*, mode, save_dir, originals_dir, cache_root, host_url, warning=None):
    """One-time startup banner: ASCII logo + a colorized config summary."""
    import sys
    if sys.stdout.isatty():
        MAG, DIM, CYAN, WHITE, RST = (
            "\033[38;5;205m", "\033[2m", "\033[36m", "\033[97m", "\033[0m")
    else:
        MAG = DIM = CYAN = WHITE = RST = ""
    rows = [
        ("Mode", mode),
        ("Save dir", save_dir or "— (temporary, streamed to browser)"),
        ("Archive", originals_dir or "—"),
        ("Cache + DB", cache_root),
        ("Listening", host_url),
    ]
    label_w = max(len(l) for l, _ in rows)
    # Widths computed on plain text (ANSI codes are zero-width on screen).
    plain = [f"  {l.ljust(label_w)}   {v}" for l, v in rows]
    inner = max(len(p) for p in plain) + 2
    bar = "─" * inner

    print(f"{MAG}{YOUTIFY_BANNER}{RST}")
    print(f"{DIM}┌{bar}┐{RST}")
    for (label, value), p in zip(rows, plain):
        pad = " " * (inner - len(p))
        print(f"{DIM}│{RST}  {CYAN}{label.ljust(label_w)}{RST}   {WHITE}{value}{RST}{pad}{DIM}│{RST}")
    print(f"{DIM}└{bar}┘{RST}")
    if warning:
        log.warning(warning)

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks, Body, Response, UploadFile, File
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json

import argparse
import sqlite3
from youtube_downloader import (
    validate_youtube_url, download_youtube_audio, get_video_info,
    archive_original, retag_mp3_in_place, reprocess_from_original,
    find_original, get_audio_duration, read_cover, normalize_cover,
)

# Import the database module
from database import AudioMetadataDB
from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Rebuild the DB index from the on-disk sidecars so the DB is fully
    # disposable. Globals below are defined later at module load but resolved
    # here at startup time.
    if not BROWSER_DOWNLOAD_MODE:
        try:
            n = db.rebuild_from_sidecars(META_DIR, DOWNLOAD_DIR)
            p = db.rebuild_playlists_from_sidecars(PLAYLISTS_DIR)
            log.info("Library index: %d track(s), %d playlist(s) loaded from sidecars.", n, p)
        except Exception as e:
            log.warning("Startup library rebuild failed: %s", e)
    yield


app = FastAPI(
    title="Youtify",
    description="High-quality YouTube Audio Downloader",
    version="2.2.3",
    lifespan=lifespan,
)

# CORS: Allow Chrome extension and other origins to access the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static file directory
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

# Serve static files (CSS, JS, assets)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Store progress in-memory (simple session-based)
# In a production app, use Redis or similar
#   download_progress: keyed by session_id, tracks the /save job (cache + process phases)
#   cache_progress:    keyed by video_id, tracks background pre-caching from /search
download_progress: Dict[str, dict] = {}
cache_progress: Dict[str, dict] = {}

# Handle Configuration (CLI > ENV > DEFAULT)
#   --save-dir  : permanent library on (typically) HDD. Holds the MP3s plus a
#                 .youtify/ archive (originals + per-track metadata sidecars).
#   --cache-dir : working + index store on (typically) SSD. Holds the preview/
#                 download cache (work/) and the rebuildable metadata.db.
def get_config():
    parser = argparse.ArgumentParser(description="YT2MP3 Backend Server")
    parser.add_argument("--save-dir", type=str, help="Directory to save MP3 files")
    parser.add_argument("--cache-dir", type=str, help="Working cache + DB directory")
    parser.add_argument("--turbo", action="store_true",
                        help="Default Turbo Render ON: cache lossless WAV checkpoints "
                             "to speed up re-rendering preview combos (uses disk).")
    args, unknown = parser.parse_known_args()

    save_dir = args.save_dir or os.getenv("SAVE_DIRECTORY")
    cache_dir = (args.cache_dir or os.getenv("CACHE_DIRECTORY")
                 or os.path.expanduser("~/.cache/youtify"))
    # Turbo default: CLI flag OR truthy env. Off unless explicitly enabled.
    turbo = args.turbo or os.getenv("TURBO_PREVIEW", "").strip().lower() in ("1", "true", "yes", "on")
    return save_dir, cache_dir, turbo

ENV_SAVE_DIR, ENV_CACHE_DIR, TURBO_DEFAULT = get_config()

# Cache root (SSD): working files under work/, DB at the root so cleanup_cache
# (which only scans work/) can never touch it.
CACHE_ROOT = os.path.abspath(os.path.expanduser(ENV_CACHE_DIR))
CACHE_DIR = os.path.join(CACHE_ROOT, "work")
DB_PATH = os.path.join(CACHE_ROOT, "metadata.db")
os.makedirs(CACHE_DIR, exist_ok=True)

db = AudioMetadataDB(DB_PATH)

# If no save directory configured, we'll stream downloads directly to browser
BROWSER_DOWNLOAD_MODE = ENV_SAVE_DIR is None
DOWNLOAD_DIR = None
ORIGINALS_DIR = None
META_DIR = None
PLAYLISTS_DIR = None
_startup_warning = None

if not BROWSER_DOWNLOAD_MODE:
    # Expand user and resolve to absolute path for reliability
    DOWNLOAD_DIR = os.path.abspath(os.path.expanduser(ENV_SAVE_DIR))

    try:
        os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    except Exception:
        # Fallback to a safe temp directory if provided path is unwritable (common in Docker)
        fallback = os.path.join(tempfile.gettempdir(), "yt2mp3_fallback")
        os.makedirs(fallback, exist_ok=True)
        _startup_warning = f"Could not use {ENV_SAVE_DIR}; falling back to {fallback}"
        DOWNLOAD_DIR = fallback

    # Archive lives with the library (HDD): originals for reprocessing +
    # per-track JSON sidecars that can rebuild the DB if it's lost.
    ORIGINALS_DIR = os.path.join(DOWNLOAD_DIR, ".youtify", "originals")
    META_DIR = os.path.join(DOWNLOAD_DIR, ".youtify", "meta")
    PLAYLISTS_DIR = os.path.join(DOWNLOAD_DIR, ".youtify", "playlists")
    os.makedirs(ORIGINALS_DIR, exist_ok=True)
    os.makedirs(META_DIR, exist_ok=True)
    os.makedirs(PLAYLISTS_DIR, exist_ok=True)



print_startup_banner(
    mode="Server Save" if not BROWSER_DOWNLOAD_MODE else "Browser Download (temporary)",
    save_dir=DOWNLOAD_DIR,
    originals_dir=ORIGINALS_DIR,
    cache_root=CACHE_ROOT,
    host_url="http://localhost:8000",
    warning=_startup_warning,
)
if BROWSER_DOWNLOAD_MODE:
    log.info("No save directory set. Use --save-dir or SAVE_DIRECTORY to keep files + build a library.")


def cleanup_cache():
    """
    Removes cached files older than 2 hours to prevent disk bloat.
    Runs periodically as a background task.
    """
    cutoff = (datetime.datetime.now() - datetime.timedelta(hours=2)).timestamp()
    for f in os.listdir(CACHE_DIR):
        fpath = os.path.join(CACHE_DIR, f)
        # Skip directories (e.g. the ckpt/ checkpoint store) — os.remove() on a
        # dir raises and used to abort the whole sweep. ckpt is size-managed by
        # prune_checkpoints + cleared per-video on a new search.
        if not os.path.isfile(fpath):
            continue
        try:
            if os.path.getmtime(fpath) < cutoff:
                os.remove(fpath)
        except OSError as e:
            log.warning("Cache cleanup error on %s: %s", f, e)


def clear_other_video_cache(keep_video_id: str):
    """
    On a new search, drop preview renders (prev_*.mp3) and WAV checkpoints that
    belong to OTHER videos, so the cache stays focused on the current track. The
    current video's checkpoints are kept, so re-previewing it stays fast.
    """
    import glob
    try:
        ckpt_dir = os.path.join(CACHE_DIR, "ckpt")
        targets = (glob.glob(os.path.join(CACHE_DIR, "prev_*"))
                   + glob.glob(os.path.join(ckpt_dir, "*.wav")))
        for f in targets:
            if keep_video_id and keep_video_id in os.path.basename(f):
                continue
            try:
                os.remove(f)
            except OSError:
                pass
    except Exception as e:
        log.warning("clear_other_video_cache error: %s", e)


def cleanup_session(session_id: str):
    """Cleanup session progress but KEEP the file"""
    try:
        if session_id in download_progress:
            del download_progress[session_id]
    except Exception as e:
        log.warning("Error cleaning up session %s: %s", session_id, e)

def get_unique_path(directory: str, filename: str) -> str:
    """
    Generates a unique file path by appending a counter if the file already exists.
    Example: song.mp3 -> song_copy1.mp3 -> song_copy2.mp3
    """
    base, ext = os.path.splitext(filename)
    path = os.path.join(directory, filename)
    counter = 1
    while os.path.exists(path):
        path = os.path.join(directory, f"{base}_copy{counter}{ext}")
        counter += 1
    return path

# Memoize silence analysis per (video_id, threshold) so toggling Trim Silence
# or nudging the threshold doesn't re-run an ffmpeg scan every time.
silence_cache: Dict[str, dict] = {}


def sanitize(s: str) -> str:
    return "".join(c for c in (s or "") if c.isalnum() or c in "._- ,'&").strip()


def split_multi(value: Optional[str], delimiter: str = "|") -> list:
    """Split a delimiter-joined tag string into a clean list."""
    if not value:
        return []
    return [v.strip() for v in value.split(delimiter) if v.strip()]


def build_filename(title, album, artist, composer, delimiter="|", ext="mp3") -> str:
    """
    Build the library filename: "Title (Album) - Artist (Composer).<ext>".
    Shared by /save and the library metadata editor so renames stay consistent.
    """
    title = sanitize(title) or "audio"
    artist = sanitize(artist.replace(delimiter, ', ')) if artist else None
    album = sanitize(album) if album else None
    composer = sanitize(composer) if composer else None

    parts = [title]
    if album:
        parts[0] = f"{title} ({album})"
    if artist or composer:
        right = artist or ''
        if composer:
            right = f"{right} ({composer})" if right else composer
        parts.append(right)
    return " - ".join(parts) + "." + ext.lstrip(".")


def resolve_source(url: Optional[str], source_id: Optional[str]):
    """
    Resolve an input to (video_id, source_path). For an upload/cached source
    (source_id set) returns the cached file path; for a YouTube url returns
    (video_id, None) and the caller downloads as usual.
    """
    from youtube_downloader import find_cache_file
    if source_id:
        path = find_cache_file(CACHE_DIR, source_id)
        if not path:
            raise HTTPException(status_code=404, detail="Uploaded source not found (cache may have been cleared — re-upload).")
        return source_id, path
    if not url:
        raise HTTPException(status_code=400, detail="Provide a YouTube url or a source_id.")
    return validate_youtube_url(url), None


def sidecar_path_for(video_id: str) -> str:
    return os.path.join(META_DIR, f"{video_id}.json")


def write_sidecar(video_id: str, data: dict):
    """Atomically write the per-track sidecar JSON."""
    path = sidecar_path_for(video_id)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def read_sidecar(video_id: str) -> Optional[dict]:
    path = sidecar_path_for(video_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as e:
        log.warning("Failed to read sidecar %s: %s", path, e)
        return None


def playlist_sidecar_path(pid: str) -> str:
    return os.path.join(PLAYLISTS_DIR, f"{pid}.json")


def playlist_cover_path(pid: str) -> str:
    return os.path.join(PLAYLISTS_DIR, f"{pid}.jpg")


def write_playlist_sidecar(pid: str, data: dict):
    path = playlist_sidecar_path(pid)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def read_playlist_sidecar(pid: str) -> Optional[dict]:
    path = playlist_sidecar_path(pid)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as e:
        log.warning("Failed to read playlist sidecar %s: %s", path, e)
        return None


def precache_with_progress(url: str):
    """
    Background task launched by /search: downloads bestaudio into the cache
    while recording real-time progress in cache_progress[video_id], so the UI
    can show a live caching bar instead of a binary 'cached / not cached'.
    """
    from youtube_downloader import download_to_cache
    try:
        video_id = validate_youtube_url(url)
    except Exception:
        return
    cache_progress[video_id] = {"status": "caching", "progress": 0.0}

    def cb(pct):
        cache_progress[video_id] = {
            "status": "done" if pct >= 100 else "caching",
            "progress": round(pct, 1),
        }

    try:
        download_to_cache(url, CACHE_DIR, progress_cb=cb)
        cache_progress[video_id] = {"status": "done", "progress": 100.0}
    except Exception as e:
        cache_progress[video_id] = {"status": "error", "progress": 0.0, "message": str(e)}

@app.get("/")
async def serve_ui():
    """Serves the main UI"""
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {
        "message": "YouTube Audio Downloader API is running",
        "usage": "GET /stream?url=YOUR_YT_URL",
        "ui_status": "index.html not found in static folder"
    }

@app.get("/config")
async def get_config_endpoint():
    """Get server configuration - tells frontend if browser download mode is enabled"""
    return {
        "browser_download_mode": BROWSER_DOWNLOAD_MODE,
        "save_directory": DOWNLOAD_DIR,
        "turbo_default": TURBO_DEFAULT,
    }

@app.get("/info")
def video_info(url: str = Query(..., description="The YouTube URL")):
    """Get metadata for a video"""
    try:
        info = get_video_info(url)
        return info
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/yt-search")
def yt_search(q: str = Query(..., description="Free-text search query")):
    """Search YouTube and return up to 30 pickable results (for non-URL input)."""
    from youtube_downloader import search_youtube
    try:
        return {"results": search_youtube(q, 30)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")

@app.get("/progress/{session_id}")
async def get_progress(session_id: str):
    """Get progress for a specific session"""
    return download_progress.get(session_id, {"status": "not_started", "progress": 0})


@app.get("/search")
def search_video(
    background_tasks: BackgroundTasks,
    url: str = Query(..., description="The YouTube URL to search")
):
    """
    Validates URL, extracts info, and triggers pre-caching in the background.
    """
    try:
        # 1. Validate
        video_id = validate_youtube_url(url)

        # 2. Get Info (Speedy metadata extraction)
        info = get_video_info(url)

        # 3. Limit check (30 minutes = 1800 seconds)
        if info.get('duration', 0) > 1800:
            info['can_preview'] = False
            info['limit_reason'] = "Video longer than 30 minutes. Preview disabled for performance."
        else:
            info['can_preview'] = True
        # Pre-cache in the background regardless of preview limit, so a later
        # /save can reuse it (the only gate is whether we *stream* a preview).
        background_tasks.add_task(precache_with_progress, url)

        # New search -> clear other videos' preview renders + checkpoints (keeps
        # this video's, so re-previewing it stays fast).
        background_tasks.add_task(clear_other_video_cache, video_id)
        background_tasks.add_task(cleanup_cache)
        
        # Pass upload_date to frontend for year pre-population
        if info.get('upload_date'):
            info['upload_date'] = info['upload_date']  # YYYYMMDD format
        
        return info

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # Provide meaningful error messages for search/cache failures
        error_msg = str(e)
        if "Invalid data found" in error_msg:
             error_msg = "Corrupted audio data received from YouTube. Please try again."
        elif "ffprobe" in error_msg.lower():
             error_msg = "ffmpeg/ffprobe analysis failed. The video format might be unsupported."
             
        raise HTTPException(status_code=500, detail=f"Search failed: {error_msg}")


ALLOWED_UPLOAD_EXTS = {"mp3", "flac", "wav", "m4a", "aac", "ogg", "oga",
                       "opus", "aiff", "aif", "alac", "wma", "mp4"}


@app.post("/upload")
async def upload_source(file: UploadFile = File(...)):
    """
    Ingest a manually-uploaded audio file as a generic source: save it into the
    working cache under a non-YouTube id, probe it (duration + lossless), and
    read its embedded tags + cover so the form can be pre-filled. The returned
    shape mirrors /search so the frontend treats it like any other source.
    """
    import secrets
    from youtube_downloader import probe_audio, get_audio_duration, read_audio_tags, normalize_cover

    ext = os.path.splitext(file.filename or "")[1].lower().lstrip(".")
    if ext not in ALLOWED_UPLOAD_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '.{ext}'. Upload an audio file.")

    source_id = "up" + secrets.token_hex(6)   # deliberately not an 11-char YT id
    dest = os.path.join(CACHE_DIR, f"{source_id}.{ext}")
    try:
        with open(dest, "wb") as out:
            shutil.copyfileobj(file.file, out)
    finally:
        await file.close()

    duration = get_audio_duration(dest)
    if not duration:
        try: os.remove(dest)
        except OSError: pass
        raise HTTPException(status_code=400, detail="Could not read that file as audio.")

    probe = probe_audio(dest)
    tags = read_audio_tags(dest)

    thumbnail = None
    cover = tags.get("cover")
    if cover:
        try:
            data, mime = normalize_cover(cover[0])
            if data:
                thumbnail = "data:%s;base64,%s" % (mime, base64.b64encode(data).decode())
        except Exception:
            thumbnail = None

    return {
        "video_id": source_id,
        "is_upload": True,
        "title": tags.get("title") or os.path.splitext(file.filename or "")[0],
        "author": tags.get("artist"),
        "album": tags.get("album"),
        "year": tags.get("year"),
        "genre": tags.get("genre"),
        "composer": tags.get("composer"),
        "duration": duration,
        "thumbnail": thumbnail,
        "lossless": probe.get("lossless", False),
        "src_ext": ext,
    }


@app.post("/save")
def save_audio(
    background_tasks: BackgroundTasks,
    url: Optional[str] = Query(None, description="The YouTube URL to download audio from (or use source_id)"),
    source_id: Optional[str] = Query(None, description="Id of an already-cached source (e.g. an upload) — use instead of url"),
    output_format: str = Query("auto", description="Export format: auto|mp3|flac|wav"),
    start_time: Optional[float] = Query(None, description="Start time in seconds"),
    end_time: Optional[float] = Query(None, description="End time in seconds"),
    trim_silence: bool = Query(True, description="Trim leading/trailing silence"),
    silence_thresh: float = Query(-40.0, description="Silence threshold in dBFS (-60 to -20, higher = more aggressive)"),
    eq_preset: Optional[str] = Query(None, description="Equalizer preset"),
    mbc_preset: Optional[str] = Query(None, description="Multiband compressor preset"),
    normalize: bool = Query(True, description="Apply loudness normalization"),
    normalize_i: float = Query(-16.0, description="Target loudness in LUFS"),
    enhance_mode: Optional[str] = Query(None, description="Enhancement mode: Restore/Vocal/Crisp/Warmth"),
    enhance_intensity: float = Query(1.5, description="Enhancement intensity"),
    original: bool = Query(False, description="Bypass all processing"),
    session_id: Optional[str] = Query(None, description="Optional session ID for progress tracking"),
    meta_title: Optional[str] = Query(None, description="Title metadata tag"),
    meta_artist: Optional[str] = Query(None, description="Artist metadata tag"),
    meta_album: Optional[str] = Query(None, description="Album metadata tag"),
    meta_genre: Optional[str] = Query(None, description="Genre metadata tag"),
    meta_year: Optional[str] = Query(None, description="Year metadata tag"),
    meta_composer: Optional[str] = Query(None, description="Composer metadata tag"),
    delimiter: str = Query("|", description="Delimiter used between artist/genre tags"),
    # Sent in the POST body (not the query string): a base64 cover image can be
    # large and would blow past URL/header length limits if put in the URL.
    metadata_json: Optional[str] = Body(None, embed=True, description="JSON string with custom_tags and thumbnail_base64")
):
    """
    Downloads and saves audio directly to /mnt/Apps.
    """
    try:
        # 1. Resolve the source: YouTube url OR an already-cached upload.
        from youtube_downloader import resolve_output_format
        video_id, source_path = resolve_source(url, source_id)
        is_upload = source_path is not None
        out_fmt = resolve_output_format(output_format, source_path) if is_upload \
            else (output_format if output_format in ("mp3", "flac", "wav") else "mp3")

        # 2. Setup session
        if not session_id:
            session_id = uuid.uuid4().hex[:8]
        
        download_progress[session_id] = {"status": "starting", "phase": "cache", "progress": 0}

        # Unified progress: the downloader reports (phase, percent) for both the
        # cache download and the single FFmpeg processing pass.
        def on_progress(phase: str, percent: float):
            download_progress[session_id] = {
                "status": "caching" if phase == "cache" else "processing",
                "phase": phase,
                "progress": round(percent, 1),
            }

        # 3. Parse extra metadata (custom tags + cover) once.
        custom_tags = []
        thumbnail_base64 = None
        if metadata_json:
            try:
                extra = json.loads(metadata_json)
                custom_tags = extra.get('custom_tags', []) or []
                thumbnail_base64 = extra.get('thumbnail_base64')
            except Exception as e:
                log.warning("Failed to parse metadata_json: %s", e)

        composer_from_json = next(
            (t.get('value') for t in custom_tags
             if t.get('key', '').lower() == 'composer'), None)
        composer = meta_composer or composer_from_json

        # 4. Build filename "Title (Album) - Artist (Composer).<fmt>"
        title_for_name = meta_title
        if not title_for_name:
            title_for_name = get_video_info(url).get('title', video_id) if not is_upload else video_id
        filename_to_use = build_filename(title_for_name, meta_album, meta_artist, composer, delimiter, ext=out_fmt)

        # 5. Determine output directory based on mode
        if BROWSER_DOWNLOAD_MODE:
            # Use temp directory for browser downloads
            output_dir = tempfile.mkdtemp(prefix="yt2mp3_")
            final_path = os.path.join(output_dir, filename_to_use)
        else:
            # Handle duplicates for server save mode
            final_path = get_unique_path(DOWNLOAD_DIR, filename_to_use)
            output_dir = DOWNLOAD_DIR

        final_filename = os.path.basename(final_path)
        output_filename_base = os.path.splitext(final_filename)[0]

        # 6. Build user metadata dict for ID3 embedding
        user_metadata = {'delimiter': delimiter}
        if meta_title: user_metadata['title'] = meta_title
        if meta_artist: user_metadata['artist'] = meta_artist
        if meta_album: user_metadata['album'] = meta_album
        if meta_genre: user_metadata['genre'] = meta_genre
        if meta_year: user_metadata['year'] = meta_year
        if meta_composer: user_metadata['composer'] = meta_composer
        if custom_tags: user_metadata['custom_tags'] = custom_tags
        if thumbnail_base64: user_metadata['thumbnail_base64'] = thumbnail_base64

        # 7. Download (or use cached upload) and Process
        output_path = download_youtube_audio(
            url=url,
            source_path=source_path,
            output_format=out_fmt,
            output_dir=output_dir,
            filename=output_filename_base,
            start_time=start_time,
            end_time=end_time,
            trim_silence_flag=False if original else trim_silence,
            silence_thresh=silence_thresh,
            eq_preset=None if original else eq_preset,
            mbc_preset=None if original else mbc_preset,
            enhance_mode=None if original else enhance_mode,
            enhance_intensity=enhance_intensity,
            normalize=False if original else normalize,
            normalize_i=normalize_i,
            original=original,
            user_metadata=user_metadata if user_metadata else None,
            cache_dir=CACHE_DIR,
            on_progress=on_progress,
        )
        
        # Archive + index (save-dir mode only): keep a permanent copy of the
        # source audio, write a sidecar describing the effects/metadata, and
        # upsert the DB index. The sidecar is the source of truth; the DB can
        # be rebuilt from it.
        if not BROWSER_DOWNLOAD_MODE:
            try:
                original_dest = archive_original(CACHE_DIR, video_id, ORIGINALS_DIR)
                original_rel = (os.path.relpath(original_dest, DOWNLOAD_DIR)
                                if original_dest else None)
                duration = get_audio_duration(final_path)

                effects = {
                    "start_time": start_time, "end_time": end_time,
                    "trim_silence": False if original else trim_silence,
                    "silence_thresh": silence_thresh,
                    "eq_preset": None if original else eq_preset,
                    "mbc_preset": None if original else mbc_preset,
                    "enhance_mode": None if original else enhance_mode,
                    "enhance_intensity": enhance_intensity,
                    "normalize": False if original else normalize,
                    "normalize_i": normalize_i,
                    "original": original,
                }
                artists = split_multi(meta_artist, delimiter)
                genres = split_multi(meta_genre, delimiter)
                sidecar = {
                    "schema_version": 1,
                    "youtube_id": video_id,
                    "source_url": url or f"upload:{video_id}",
                    "rel_path": os.path.relpath(final_path, DOWNLOAD_DIR),
                    "filename": final_filename,
                    "original_rel": original_rel,
                    "duration": duration,
                    "effects": effects,
                    "metadata": {
                        "title": meta_title, "album": meta_album, "year": meta_year,
                        "composer": meta_composer, "artists": artists, "genres": genres,
                        "delimiter": delimiter, "custom_tags": custom_tags,
                    },
                    "created_at": datetime.datetime.now().isoformat(),
                    "updated_at": datetime.datetime.now().isoformat(),
                }
                write_sidecar(video_id, sidecar)

                db.upsert_audio(
                    youtube_id=video_id, title=meta_title, album=meta_album,
                    year=meta_year, duration=duration,
                    rel_path=sidecar["rel_path"], filename=final_filename,
                    sidecar_path=f"{video_id}.json", effects=effects,
                    artists=artists, genres=genres,
                    custom_fields={t["key"]: t.get("value")
                                   for t in custom_tags if t.get("key")},
                )
            except Exception as e:
                log.warning("Failed to archive/index metadata: %s", e)
        
        # 7. Final progress update
        download_progress[session_id] = {
            "status": "finished", 
            "progress": 100, 
            "path": output_path,
            "filename": final_filename,
            "browser_download": BROWSER_DOWNLOAD_MODE
        }
        
        if BROWSER_DOWNLOAD_MODE:
            return {
                "status": "success",
                "message": "Ready for download",
                "browser_download": True,
                "download_path": output_path,
                "filename": final_filename
            }
        else:
            return {
                "status": "success",
                "message": f"Saved to {final_path}",
                "browser_download": False,
                "path": final_path,
                "filename": final_filename
            }


    except Exception as e:
        if session_id in download_progress:
            download_progress[session_id] = {"status": "error", "message": str(e)}
        raise HTTPException(status_code=500, detail=str(e))

    except ValueError as e:
        if session_id in download_progress:
            download_progress[session_id] = {"status": "error", "message": str(e)}
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/download-file")
async def download_file(
    path: str = Query(..., description="Path to the file to download"),
    filename: str = Query(..., description="Filename for the download"),
    background_tasks: BackgroundTasks = None
):
    """
    Stream a file to browser for download (used in browser download mode).
    Cleans up temp file after download.
    """
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")
    
    # Security check - only allow files from temp directory
    if not path.startswith(tempfile.gettempdir()):
        raise HTTPException(status_code=403, detail="Access denied")
    
    def cleanup_temp():
        try:
            parent_dir = os.path.dirname(path)
            if parent_dir.startswith(tempfile.gettempdir()) and os.path.exists(parent_dir):
                shutil.rmtree(parent_dir)
        except Exception as e:
            log.warning("Failed to cleanup temp dir: %s", e)
    
    # Schedule cleanup after response is sent
    if background_tasks:
        background_tasks.add_task(cleanup_temp)
    
    import urllib.parse
    encoded_filename = urllib.parse.quote(filename)
    mime = {"flac": "audio/flac", "wav": "audio/wav", "mp3": "audio/mpeg"}.get(
        os.path.splitext(path)[1].lower().lstrip("."), "audio/mpeg")

    return FileResponse(
        path,
        media_type=mime,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"}
    )

@app.get("/stream")
def stream_audio(
    url: Optional[str] = Query(None, description="The YouTube URL to stream (or use source_id)"),
    source_id: Optional[str] = Query(None, description="Id of an already-cached source (upload)"),
    eq_preset: Optional[str] = Query(None),
    mbc_preset: Optional[str] = Query(None),
    normalize: bool = Query(True),
    normalize_i: float = Query(-16.0),
    enhance_mode: Optional[str] = Query(None),
    enhance_intensity: float = Query(1.5),
    original: bool = Query(False),
    turbo: bool = Query(False),
):
    """
    Preview the FULL track with the chosen effects applied — but WITHOUT range
    clipping or silence trimming. Those are mechanical cuts applied only on
    export; keeping the preview full-length lets the browser seek freely and the
    playhead map 1:1 to the timeline.

    Renders once to a per-effect cached MP3 and serves it via FileResponse, which
    supports HTTP range requests (seekable) and makes A/B switching instant.
    """
    from youtube_downloader import download_to_cache, render_preview_checkpointed
    import hashlib

    try:
        video_id, source_path = resolve_source(url, source_id)

        # Hash the effect set (NOT range/silence) so identical settings reuse the
        # same rendered file — instant replay and A/B comparison.
        key = f"{eq_preset}|{mbc_preset}|{enhance_mode}|{enhance_intensity}|{normalize}|{normalize_i}|{original}"
        h = hashlib.md5(key.encode()).hexdigest()[:10]
        out = os.path.join(CACHE_DIR, f"prev_{video_id}_{h}.flac")

        # Fast path: this combo was already rendered — serve it straight away.
        # No yt-dlp metadata call, no ffprobe, no re-encode. This is what makes
        # A/B switching snappy (the old code did a network get_video_info every
        # time, adding several seconds per switch).
        if os.path.exists(out) and os.path.getsize(out) > 1024:
            return FileResponse(out, media_type="audio/flac")

        # First render of this combo: ensure the source is cached (uploads are
        # already in cache), then gate on duration read from the LOCAL file.
        try:
            cache_file = source_path or download_to_cache(url, CACHE_DIR)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not cache audio. {str(e)}")

        if (get_audio_duration(cache_file) or 0) > 1800:
            raise HTTPException(status_code=403, detail="Preview restricted to videos under 30 minutes.")

        # Render the full-length preview (lossless FLAC). With Turbo on, reuse
        # lossless WAV checkpoints (decoded source + per-stage prefixes) so a new
        # combo sharing a prefix resumes mid-pipeline instead of recomputing every
        # stage; with Turbo off, a plain single-pass render (no WAVs written).
        render_preview_checkpointed(
            cache_file, out, video_id, os.path.join(CACHE_DIR, "ckpt"),
            eq_preset=eq_preset, mbc_preset=mbc_preset,
            enhance_mode=enhance_mode, enhance_intensity=enhance_intensity,
            normalize=normalize, normalize_i=normalize_i, original=original,
            use_checkpoints=turbo,
        )
        return FileResponse(out, media_type="audio/flac")
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        if "Invalid data found" in error_msg:
            error_msg = "Invalid audio data in cache. Please refresh the page and try searching again."
        raise HTTPException(status_code=500, detail=error_msg)


@app.get("/cache-status")
async def cache_status(url: str = Query(..., description="The YouTube URL to check cache for")):
    """Check if audio is cached for this URL, plus live download progress."""
    import glob
    try:
        video_id = validate_youtube_url(url)
        existing = glob.glob(os.path.join(CACHE_DIR, f"{video_id}.*"))
        cached = any(os.path.getsize(f) > 1024 for f in existing if os.path.exists(f))
        prog = cache_progress.get(video_id, {})
        progress = 100.0 if cached else float(prog.get("progress", 0.0))
        return {
            "cached": cached,
            "progress": progress,
            "status": prog.get("status", "done" if cached else "idle"),
        }
    except Exception:
        return {"cached": False, "progress": 0.0, "status": "idle"}


@app.get("/silence-info")
def silence_info(
    url: Optional[str] = Query(None, description="The YouTube URL to analyze (or use source_id)"),
    source_id: Optional[str] = Query(None, description="Id of an already-cached source (upload)"),
    silence_thresh: float = Query(-40.0)
):
    """
    Returns leading and trailing silence offsets for the cached audio.
    Returns defaults (0, 0) if analysis fails to avoid blocking playback.
    """
    from youtube_downloader import download_to_cache, get_silence_offsets
    import traceback
    try:
        video_id, source_path = resolve_source(url, source_id)
        ckey = f"{video_id}|{silence_thresh}"
        if ckey in silence_cache:
            return silence_cache[ckey]
        cache_file = source_path or download_to_cache(url, CACHE_DIR)
        start, end = get_silence_offsets(cache_file, silence_thresh=silence_thresh)
        result = {"leading_silence": start, "trailing_silence": end}
        silence_cache[ckey] = result
        return result
    except Exception as e:
        # Log the error but return defaults so playback can continue
        log.warning("silence-info failed for %s: %s", url, e)
        traceback.print_exc()
        return {"leading_silence": 0, "trailing_silence": 0}


# ---------------------------------------------------------------------------
# Library / archive endpoints (save-dir mode only) + tag suggestions.
# ---------------------------------------------------------------------------

def _require_library():
    if BROWSER_DOWNLOAD_MODE:
        raise HTTPException(status_code=404,
                            detail="Library is only available in save-directory mode.")


def _abs(rel_path: str) -> str:
    return os.path.join(DOWNLOAD_DIR, rel_path)


@app.get("/library")
def library_list():
    """List every saved track (newest first)."""
    _require_library()
    return {"items": db.get_library()}


@app.get("/library/{audio_id}")
def library_detail(audio_id: int):
    _require_library()
    detail = db.get_audio_detail(audio_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Track not found")
    return detail


@app.post("/library/rebuild")
def library_rebuild():
    """Re-index the DB from the on-disk sidecars."""
    _require_library()
    n = db.rebuild_from_sidecars(META_DIR, DOWNLOAD_DIR)
    return {"indexed": n}


@app.patch("/library/{audio_id}")
def library_patch(audio_id: int, payload: dict = Body(...)):
    """
    Edit metadata only: re-tag the MP3 in place (no re-download / no FFmpeg),
    rename the file if the name-deriving fields changed, and update the sidecar
    + DB index.
    """
    _require_library()
    detail = db.get_audio_detail(audio_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Track not found")

    video_id = detail["youtube_id"]
    sidecar = read_sidecar(video_id) or {}
    delimiter = payload.get("delimiter") or sidecar.get("metadata", {}).get("delimiter", "|")

    title = payload.get("title", detail.get("title"))
    album = payload.get("album", detail.get("album"))
    year = payload.get("year", detail.get("year"))
    artists = payload.get("artists", detail.get("artists", []))
    genres = payload.get("genres", detail.get("genres", []))
    custom_tags = payload.get("custom_tags")
    if custom_tags is None:
        custom_tags = [{"key": k, "value": v} for k, v in detail.get("custom_fields", {}).items()]
    composer = next((t.get("value") for t in custom_tags
                     if t.get("key", "").lower() == "composer"), None)

    artist_str = delimiter.join(artists) if artists else None
    genre_str = delimiter.join(genres) if genres else None

    old_rel = detail.get("rel_path")
    old_abs = _abs(old_rel) if old_rel else None

    # Rename if the filename-deriving fields changed.
    new_filename = build_filename(title, album, artist_str, composer, delimiter)
    new_abs = old_abs
    if old_abs and os.path.basename(old_abs) != new_filename:
        new_abs = get_unique_path(DOWNLOAD_DIR, new_filename)
        try:
            os.rename(old_abs, new_abs)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Rename failed: {e}")
    new_filename = os.path.basename(new_abs) if new_abs else new_filename
    new_rel = os.path.relpath(new_abs, DOWNLOAD_DIR) if new_abs else old_rel

    # Re-tag in place. Cover: only supply a new one if the client sent it;
    # otherwise the existing embedded cover is preserved.
    user_metadata = {"delimiter": delimiter}
    if title: user_metadata["title"] = title
    if artist_str: user_metadata["artist"] = artist_str
    if album: user_metadata["album"] = album
    if genre_str: user_metadata["genre"] = genre_str
    if year: user_metadata["year"] = year
    if composer: user_metadata["composer"] = composer
    if custom_tags: user_metadata["custom_tags"] = custom_tags
    if payload.get("thumbnail_base64"): user_metadata["thumbnail_base64"] = payload["thumbnail_base64"]

    eff = sidecar.get("effects", detail.get("effects", {})) or {}
    if new_abs and os.path.exists(new_abs):
        try:
            retag_mp3_in_place(
                new_abs, source_url=sidecar.get("source_url", ""),
                user_metadata=user_metadata,
                eq_preset=eff.get("eq_preset"), mbc_preset=eff.get("mbc_preset"),
                normalize=eff.get("normalize", False), normalize_i=eff.get("normalize_i", -16.0),
                enhance_mode=eff.get("enhance_mode"), trim_silence=eff.get("trim_silence", False),
                original=eff.get("original", False),
            )
        except Exception as e:
            log.warning("re-tag failed: %s", e)

    # Persist sidecar + DB.
    sidecar.setdefault("youtube_id", video_id)
    sidecar["rel_path"] = new_rel
    sidecar["filename"] = new_filename
    sidecar["metadata"] = {
        "title": title, "album": album, "year": year, "composer": composer,
        "artists": artists, "genres": genres, "delimiter": delimiter,
        "custom_tags": custom_tags,
    }
    sidecar["updated_at"] = datetime.datetime.now().isoformat()
    write_sidecar(video_id, sidecar)

    db.upsert_audio(
        youtube_id=video_id, title=title, album=album, year=year,
        duration=sidecar.get("duration", detail.get("duration")),
        rel_path=new_rel, filename=new_filename, sidecar_path=f"{video_id}.json",
        effects=eff, artists=artists, genres=genres,
        custom_fields={t["key"]: t.get("value") for t in custom_tags if t.get("key")},
    )
    return db.get_audio_detail(audio_id)


@app.post("/library/{audio_id}/reprocess")
def library_reprocess(audio_id: int, payload: dict = Body(...)):
    """
    Rebuild the MP3 from the archived original with a new effect set, keeping
    the existing metadata. Requires the archived original to exist.
    """
    _require_library()
    detail = db.get_audio_detail(audio_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Track not found")

    video_id = detail["youtube_id"]
    original_path = find_original(ORIGINALS_DIR, video_id)
    if not original_path:
        raise HTTPException(status_code=409,
                            detail="No archived original — cannot reprocess this track.")

    sidecar = read_sidecar(video_id) or {}
    prev_eff = sidecar.get("effects", detail.get("effects", {})) or {}
    # Merge incoming effect overrides over the stored set.
    effects = {**prev_eff, **{k: v for k, v in payload.items() if k in (
        "start_time", "end_time", "trim_silence", "silence_thresh", "eq_preset",
        "mbc_preset", "enhance_mode", "enhance_intensity", "normalize",
        "normalize_i", "original")}}

    meta = sidecar.get("metadata", {})
    delimiter = meta.get("delimiter", "|")
    artists = meta.get("artists", detail.get("artists", []))
    genres = meta.get("genres", detail.get("genres", []))
    custom_tags = meta.get("custom_tags",
                           [{"key": k, "value": v} for k, v in detail.get("custom_fields", {}).items()])
    composer = next((t.get("value") for t in custom_tags
                     if t.get("key", "").lower() == "composer"), meta.get("composer"))

    user_metadata = {"delimiter": delimiter}
    if meta.get("title") or detail.get("title"):
        user_metadata["title"] = meta.get("title") or detail.get("title")
    if artists: user_metadata["artist"] = delimiter.join(artists)
    if meta.get("album") or detail.get("album"):
        user_metadata["album"] = meta.get("album") or detail.get("album")
    if genres: user_metadata["genre"] = delimiter.join(genres)
    if meta.get("year") or detail.get("year"):
        user_metadata["year"] = meta.get("year") or detail.get("year")
    if composer: user_metadata["composer"] = composer
    if custom_tags: user_metadata["custom_tags"] = custom_tags

    target = _abs(detail["rel_path"])
    try:
        reprocess_from_original(
            original_path, target, source_url=sidecar.get("source_url", ""),
            effects=effects, user_metadata=user_metadata,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reprocess failed: {e}")

    sidecar["effects"] = effects
    sidecar["updated_at"] = datetime.datetime.now().isoformat()
    write_sidecar(video_id, sidecar)
    db.upsert_audio(
        youtube_id=video_id, title=detail.get("title"), album=detail.get("album"),
        year=detail.get("year"), duration=detail.get("duration"),
        rel_path=detail["rel_path"], filename=detail.get("filename"),
        sidecar_path=f"{video_id}.json", effects=effects,
        artists=artists, genres=genres,
        custom_fields={t["key"]: t.get("value") for t in custom_tags if t.get("key")},
    )
    return db.get_audio_detail(audio_id)


@app.delete("/library/{audio_id}")
def library_delete(audio_id: int, purge_original: bool = Query(False)):
    """Delete a track: removes the MP3 + sidecar (+ original if purge_original)."""
    _require_library()
    row = db.delete_audio(audio_id)
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")
    video_id = row["youtube_id"]
    for path in filter(None, [
        _abs(row["rel_path"]) if row.get("rel_path") else None,
        sidecar_path_for(video_id),
    ]):
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception as e:
            log.warning("Failed to delete %s: %s", path, e)
    if purge_original:
        orig = find_original(ORIGINALS_DIR, video_id)
        if orig and os.path.exists(orig):
            try:
                os.remove(orig)
            except Exception as e:
                log.warning("Failed to delete original %s: %s", orig, e)
    return {"deleted": True}


@app.get("/library/{audio_id}/cover")
def library_cover(audio_id: int):
    """Serve a track's embedded front cover (for the library list/editor)."""
    _require_library()
    detail = db.get_audio_detail(audio_id)
    if not detail or not detail.get("rel_path"):
        raise HTTPException(status_code=404, detail="Track not found")
    cover = read_cover(_abs(detail["rel_path"]))
    if not cover:
        raise HTTPException(status_code=404, detail="No cover")
    data, mime = cover
    # URL is versioned with ?v=updated_at, so cache hard (avoids the Media
    # Session artwork re-fetching the cover repeatedly during playback).
    return Response(content=data, media_type=mime,
                    headers={"Cache-Control": "public, max-age=604800"})


@app.get("/library/{audio_id}/audio")
def library_audio(audio_id: int):
    """Stream a saved track for in-library playback (seekable). Library files may
    be MP3/FLAC/WAV now, so pick the media type from the extension."""
    _require_library()
    detail = db.get_audio_detail(audio_id)
    if not detail or not detail.get("rel_path"):
        raise HTTPException(status_code=404, detail="Track not found")
    path = _abs(detail["rel_path"])
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File missing")
    mime = {"flac": "audio/flac", "wav": "audio/wav", "mp3": "audio/mpeg"}.get(
        os.path.splitext(path)[1].lower().lstrip("."), "audio/mpeg")
    return FileResponse(path, media_type=mime)


@app.post("/preview-cache/clear")
def clear_preview_cache(url: Optional[str] = Query(None)):
    """
    Drop cached preview renders (the per-effect 'mix' MP3s). Called on unload so
    a session's experiments don't linger on the SSD. With ?url=, clears just that
    video's mixes; otherwise clears all. The source cache is left intact.
    """
    import glob
    removed = 0
    try:
        if url:
            try:
                vid = validate_youtube_url(url)
            except Exception:
                return {"removed": 0}
            patterns = [os.path.join(CACHE_DIR, f"prev_{vid}_*"),
                        os.path.join(CACHE_DIR, "ckpt", f"base_{vid}.wav"),
                        os.path.join(CACHE_DIR, "ckpt", f"ck_{vid}_*.wav")]
        else:
            patterns = [os.path.join(CACHE_DIR, "prev_*"),
                        os.path.join(CACHE_DIR, "ckpt", "*.wav")]
        for pattern in patterns:
            for f in glob.glob(pattern):
                try:
                    os.remove(f)
                    removed += 1
                except Exception:
                    pass
    except Exception:
        pass
    return {"removed": removed}


# ---------------------------------------------------------------------------
# Playlists (save-dir mode). Definitions persist as JSON sidecars under
# .youtify/playlists/ so they survive a DB rebuild; the DB is just the index.
# ---------------------------------------------------------------------------

def _save_playlist(pid, *, name, kind, filters, sort, track_ids, has_cover, position=None):
    """Write the sidecar + upsert the DB index together. Position is preserved
    unless explicitly given (new playlists append at the end)."""
    if position is None:
        existing = db.get_playlist(pid)
        position = existing["position"] if existing else len(db.list_playlists())
    data = {
        "id": pid, "name": name, "kind": kind,
        "filters": filters or [], "sort": sort or {},
        "track_ids": track_ids or [], "has_cover": bool(has_cover),
        "position": position,
        "updated_at": datetime.datetime.now().isoformat(),
    }
    write_playlist_sidecar(pid, data)
    db.upsert_playlist(id=pid, name=name, kind=kind, filters=filters, sort=sort,
                       has_cover=has_cover, track_ids=track_ids, position=position)
    return data


@app.post("/playlists/reorder")
def playlists_reorder(payload: dict = Body(...)):
    _require_library()
    ids = payload.get("ids") or []
    for i, pid in enumerate(ids):
        pl = db.get_playlist(pid)
        if not pl:
            continue
        _save_playlist(pid, name=pl["name"], kind=pl["kind"], filters=pl["filters"],
                       sort=pl["sort"], track_ids=pl["track_ids"], has_cover=pl["has_cover"],
                       position=i)
    return {"ok": True}


@app.get("/playlists")
def playlists_list():
    _require_library()
    return {"items": db.list_playlists()}


@app.get("/playlists/{pid}")
def playlist_detail(pid: str):
    _require_library()
    pl = db.get_playlist(pid)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return pl


@app.post("/playlists")
def playlist_create(payload: dict = Body(...)):
    _require_library()
    pid = uuid.uuid4().hex[:12]
    name = (payload.get("name") or "Untitled").strip() or "Untitled"
    kind = "dynamic" if payload.get("kind") == "dynamic" else "manual"
    filters = payload.get("filters") or []
    sort = payload.get("sort") or {}
    has_cover = False
    if payload.get("cover_base64"):
        try:
            data, _ = normalize_cover(base64.b64decode(payload["cover_base64"]), max_side=600)
            if data:
                with open(playlist_cover_path(pid), "wb") as fh:
                    fh.write(data)
                has_cover = True
        except Exception as e:
            log.warning("playlist cover save failed: %s", e)
    return _save_playlist(pid, name=name, kind=kind, filters=filters, sort=sort,
                          track_ids=[], has_cover=has_cover)


@app.patch("/playlists/{pid}")
def playlist_update(pid: str, payload: dict = Body(...)):
    _require_library()
    pl = db.get_playlist(pid)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    name = (payload.get("name") if payload.get("name") is not None else pl["name"]).strip() or pl["name"]
    kind = payload.get("kind") or pl["kind"]
    filters = payload.get("filters") if payload.get("filters") is not None else pl["filters"]
    sort = payload.get("sort") if payload.get("sort") is not None else pl["sort"]
    has_cover = pl["has_cover"]
    if payload.get("cover_base64"):
        try:
            data, _ = normalize_cover(base64.b64decode(payload["cover_base64"]), max_side=600)
            if data:
                with open(playlist_cover_path(pid), "wb") as fh:
                    fh.write(data)
                has_cover = True
        except Exception as e:
            log.warning("playlist cover save failed: %s", e)
    return _save_playlist(pid, name=name, kind=kind, filters=filters, sort=sort,
                          track_ids=pl["track_ids"], has_cover=has_cover)


@app.delete("/playlists/{pid}")
def playlist_delete(pid: str):
    _require_library()
    if not db.delete_playlist(pid):
        raise HTTPException(status_code=404, detail="Playlist not found")
    for p in (playlist_sidecar_path(pid), playlist_cover_path(pid)):
        try:
            if os.path.exists(p):
                os.remove(p)
        except Exception as e:
            log.warning("Failed to delete %s: %s", p, e)
    return {"deleted": True}


@app.post("/playlists/{pid}/tracks")
def playlist_add_track(pid: str, payload: dict = Body(...)):
    _require_library()
    pl = db.get_playlist(pid)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    yid = payload.get("youtube_id")
    if not yid:
        raise HTTPException(status_code=422, detail="youtube_id required")
    ids = pl["track_ids"]
    if yid not in ids:
        ids.append(yid)
    return _save_playlist(pid, name=pl["name"], kind=pl["kind"], filters=pl["filters"],
                          sort=pl["sort"], track_ids=ids, has_cover=pl["has_cover"])


@app.delete("/playlists/{pid}/tracks/{youtube_id}")
def playlist_remove_track(pid: str, youtube_id: str):
    _require_library()
    pl = db.get_playlist(pid)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    ids = [x for x in pl["track_ids"] if x != youtube_id]
    return _save_playlist(pid, name=pl["name"], kind=pl["kind"], filters=pl["filters"],
                          sort=pl["sort"], track_ids=ids, has_cover=pl["has_cover"])


@app.get("/playlists/{pid}/cover")
def playlist_cover(pid: str):
    _require_library()
    path = playlist_cover_path(pid)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="No cover")
    return FileResponse(path, media_type="image/jpeg",
                        headers={"Cache-Control": "public, max-age=604800"})


@app.get("/suggestions")
def suggestions(kind: Optional[str] = Query(None), field: Optional[str] = Query(None),
                q: str = Query("")):
    """
    Autocomplete sourced from the library.
      kind=artist|genre              -> normalized tags
      field=album|year|composer|<k>  -> distinct values for that field/custom key
      field=__keys__                 -> distinct custom-tag key names
    """
    if kind in ("artist", "genre"):
        return {"suggestions": db.suggest_tags(kind, q)}
    if field == "__keys__":
        return {"suggestions": db.suggest_custom_keys(q)}
    if field:
        return {"suggestions": db.suggest_values(field, q)}
    raise HTTPException(status_code=422, detail="provide kind=artist|genre or field=<name>")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)