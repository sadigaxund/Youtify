import os
import tempfile
import uuid
import shutil
import threading
import datetime
import traceback
from typing import Optional, Dict

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import json

import argparse
from youtube_downloader import validate_youtube_url, download_youtube_audio, get_video_info

app = FastAPI(
    title="YT2MP3",
    description="High-quality YouTube Audio Downloader",
    version="1.2.1"
)

# Store progress in-memory (simple session-based)
# In a production app, use Redis or similar
download_progress: Dict[str, dict] = {}

# Handle Configuration (CLI > ENV > DEFAULT)
def get_config():
    parser = argparse.ArgumentParser(description="YT2MP3 Backend Server")
    parser.add_argument("--save-dir", type=str, help="Directory to save MP3 files")
    args, unknown = parser.parse_known_args()
    
    # Priority 1: CLI Argument
    if args.save_dir:
        return args.save_dir
    
    # Priority 2: Environment Variable
    return os.getenv("SAVE_DIRECTORY")

ENV_SAVE_DIR = get_config()

# If no save directory configured, we'll stream downloads directly to browser
BROWSER_DOWNLOAD_MODE = ENV_SAVE_DIR is None
DOWNLOAD_DIR = None

if not BROWSER_DOWNLOAD_MODE:
    # Expand user and resolve to absolute path for reliability
    DOWNLOAD_DIR = os.path.abspath(os.path.expanduser(ENV_SAVE_DIR))
    
    try:
        os.makedirs(DOWNLOAD_DIR, exist_ok=True)
        print(f"FILES WILL BE SAVED TO: {DOWNLOAD_DIR}")
    except Exception as e:
        # Fallback to a safe temp directory if provided path is unwritable (common in Docker)
        DOWNLOAD_DIR = os.path.join(tempfile.gettempdir(), "yt2mp3_fallback")
        os.makedirs(DOWNLOAD_DIR, exist_ok=True)
        print(f"WARNING: Could not use {ENV_SAVE_DIR}. Falling back to: {DOWNLOAD_DIR}")
else:
    print("BROWSER DOWNLOAD MODE: Files will be streamed to browser (no save directory configured)")

# Create static directory if it doesn't exist
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

# Create cache directory for snappy previews
CACHE_DIR = os.path.join(tempfile.gettempdir(), "yt2mp3_cache")
os.makedirs(CACHE_DIR, exist_ok=True)


def cleanup_cache():
    """Removes old cached files to save space"""
    try:
        now = datetime.datetime.now()
        for f in os.listdir(CACHE_DIR):
            fpath = os.path.join(CACHE_DIR, f)
            if os.path.getmtime(fpath) < (now - datetime.timedelta(hours=2)).timestamp():
                os.remove(fpath)
    except Exception as e:
        print(f"Cache cleanup error: {e}")


def cleanup_session(session_id: str):
    """Cleanup session progress but KEEP the file"""
    try:
        if session_id in download_progress:
            del download_progress[session_id]
    except Exception as e:
        print(f"Error cleaning up session {session_id}: {e}")

def get_unique_path(directory: str, filename: str) -> str:
    """Appends _copy if file exists to prevent overwriting"""
    base, ext = os.path.splitext(filename)
    path = os.path.join(directory, filename)
    counter = 1
    while os.path.exists(path):
        path = os.path.join(directory, f"{base}_copy{counter}{ext}")
        counter += 1
    return path

def progress_hook_factory(session_id: str):
    def progress_hook(d):
        if d['status'] == 'downloading':
            p = d.get('_percent_str', '0%').replace('%', '')
            try:
                download_progress[session_id] = {
                    "status": "downloading",
                    "progress": float(p),
                    "speed": d.get('_speed_str', 'N/A'),
                    "eta": d.get('_eta_str', 'N/A')
                }
            except ValueError:
                pass
        elif d['status'] == 'finished':
            download_progress[session_id] = {
                "status": "processing",
                "progress": 100,
                "message": "Converting to MP3..."
            }
    return progress_hook

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
        "save_directory": DOWNLOAD_DIR
    }

@app.get("/info")
async def video_info(url: str = Query(..., description="The YouTube URL")):
    """Get metadata for a video"""
    try:
        info = get_video_info(url)
        return info
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/progress/{session_id}")
async def get_progress(session_id: str):
    """Get progress for a specific session"""
    return download_progress.get(session_id, {"status": "not_started", "progress": 0})


@app.get("/search")
async def search_video(
    background_tasks: BackgroundTasks,
    url: str = Query(..., description="The YouTube URL to search")
):
    """
    Validates URL, extracts info, and triggers pre-caching in the background.
    """
    from youtube_downloader import download_to_cache
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
            # Trigger Cache Download in Background
            background_tasks.add_task(download_to_cache, url, CACHE_DIR)
        
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


@app.post("/save")
async def save_audio(
    background_tasks: BackgroundTasks,
    url: str = Query(..., description="The YouTube URL to download audio from"),
    start_time: Optional[float] = Query(None, description="Start time in seconds"),
    end_time: Optional[float] = Query(None, description="End time in seconds"),
    trim_silence: bool = Query(True, description="Trim leading/trailing silence"),
    silence_thresh: float = Query(-40.0, description="Silence threshold in dBFS (-60 to -20, higher = more aggressive)"),
    eq_preset: Optional[str] = Query(None, description="Equalizer preset"),
    mbc_preset: Optional[str] = Query(None, description="Multiband compressor preset"),
    normalize: bool = Query(True, description="Apply loudness normalization"),
    normalize_i: float = Query(-16.0, description="Target loudness in LUFS"),
    enhance: bool = Query(False, description="Apply audio enhancement"),
    enhance_intensity: float = Query(1.5, description="Enhancement intensity"),
    original: bool = Query(False, description="Bypass all processing"),
    session_id: Optional[str] = Query(None, description="Optional session ID for progress tracking"),
    meta_title: Optional[str] = Query(None, description="Title metadata tag"),
    meta_artist: Optional[str] = Query(None, description="Artist metadata tag"),
    meta_album: Optional[str] = Query(None, description="Album metadata tag"),
    meta_genre: Optional[str] = Query(None, description="Genre metadata tag"),
    meta_year: Optional[str] = Query(None, description="Year metadata tag"),
    meta_composer: Optional[str] = Query(None, description="Composer metadata tag"),
    metadata_json: Optional[str] = Query(None, description="JSON string with custom_tags and thumbnail_base64"),
    delimiter: str = Query("|", description="Delimiter used between artist/genre tags")
):
    """
    Downloads and saves audio directly to /mnt/Apps.
    """
    try:
        # 1. Validate URL
        video_id = validate_youtube_url(url)
        
        # 2. Setup session
        if not session_id:
            session_id = uuid.uuid4().hex[:8]
        
        download_progress[session_id] = {"status": "starting", "progress": 0}
        hook = progress_hook_factory(session_id)
        
        # 3. Generate filename from metadata
        # Pattern: "Title (Album) - Artist (Composer).mp3"
        def sanitize(s):
            return "".join(c for c in s if c.isalnum() or c in "._- ,'&").strip()
        
        # Extract composer from metadata_json if provided (since it's a custom tag now)
        composer_from_json = None
        if metadata_json:
            try:
                extra = json.loads(metadata_json)
                if 'custom_tags' in extra:
                    for tag in extra['custom_tags']:
                        if tag.get('key', '').lower() == 'composer':
                            composer_from_json = tag.get('value')
                            break
            except:
                pass


        title = sanitize(meta_title) if meta_title else None
        # Replace delimiter with comma for filename readability
        artist = sanitize(meta_artist.replace(delimiter, ', ')) if meta_artist else None
        album = sanitize(meta_album) if meta_album else None
        composer = sanitize(meta_composer or composer_from_json) if (meta_composer or composer_from_json) else None
        
        if not title:
            info = get_video_info(url)
            title = sanitize(info.get('title', video_id))
        
        # Build filename: "Title (Album) - Artist (Composer).mp3"
        parts = [title]
        if album:
            parts[0] = f"{title} ({album})"
        if artist or composer:
            right = artist or ''
            if composer:
                right = f"{right} ({composer})" if right else composer
            parts.append(right)
        
        filename_to_use = " - ".join(parts) + ".mp3"
        
        # 4. Determine output directory based on mode
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

        # 5. Build user metadata dict
        # 5. Build user metadata dict
        user_metadata = {}
        if meta_title: user_metadata['title'] = meta_title
        if meta_artist: user_metadata['artist'] = meta_artist
        if meta_album: user_metadata['album'] = meta_album
        if meta_genre: user_metadata['genre'] = meta_genre
        if meta_year: user_metadata['year'] = meta_year
        if meta_composer: user_metadata['composer'] = meta_composer
        user_metadata['delimiter'] = delimiter
        
        # Parse additional metadata from JSON (custom tags, thumbnail)
        if metadata_json:
            try:
                extra = json.loads(metadata_json)
                if 'custom_tags' in extra:
                    user_metadata['custom_tags'] = extra['custom_tags']
                if 'thumbnail_base64' in extra:
                    user_metadata['thumbnail_base64'] = extra['thumbnail_base64']
            except Exception as e:
                print(f"Warning: Failed to parse metadata_json: {e}")
        
        # 6. Download and Process
        output_path = download_youtube_audio(
            url=url,
            output_dir=output_dir,
            filename=output_filename_base,
            start_time=start_time,
            end_time=end_time,
            trim_silence_flag=False if original else trim_silence,
            silence_thresh=silence_thresh,
            eq_preset=None if original else eq_preset,
            mbc_preset=None if original else mbc_preset,
            enhance=False if original else enhance,
            enhance_intensity=enhance_intensity,
            normalize=False if original else normalize,
            normalize_i=normalize_i,
            original=original,
            progress_hook=hook,
            user_metadata=user_metadata if user_metadata else None
        )
        
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
            print(f"Failed to cleanup temp dir: {e}")
    
    # Schedule cleanup after response is sent
    if background_tasks:
        background_tasks.add_task(cleanup_temp)
    
    import urllib.parse
    encoded_filename = urllib.parse.quote(filename)
    
    return FileResponse(
        path,
        media_type="audio/mpeg",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"}
    )

@app.get("/stream")
async def stream_audio(
    url: str = Query(..., description="The YouTube URL to stream"),
    start_time: Optional[float] = Query(None),
    end_time: Optional[float] = Query(None),
    eq_preset: Optional[str] = Query(None),
    mbc_preset: Optional[str] = Query(None),
    normalize: bool = Query(True),
    normalize_i: float = Query(-16.0),
    enhance: bool = Query(False),
    enhance_intensity: float = Query(1.5),
    original: bool = Query(False),
    trim_silence: bool = Query(True),
    silence_thresh: float = Query(-40.0)
):
    """
    Streams processed audio for preview using FFmpeg on-the-fly.
    """
    from youtube_downloader import download_to_cache, get_ffmpeg_stream_args
    import subprocess

    try:
        # 0. Quick duration check
        info = get_video_info(url)
        if info.get('duration', 0) > 1800:
            raise HTTPException(status_code=403, detail="Preview restricted to videos under 30 minutes.")

        # 1. Ensure cached
        try:
            cache_file = download_to_cache(url, CACHE_DIR)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Streaming failed: Could not cache audio. {str(e)}")

        # 2. Get FFmpeg args for streaming
        ffmpeg_args = get_ffmpeg_stream_args(
            input_path=cache_file,
            start_time=start_time,
            end_time=end_time,
            eq_preset=eq_preset,
            mbc_preset=mbc_preset,
            enhance=enhance,
            enhance_intensity=enhance_intensity,
            normalize=normalize,
            normalize_i=normalize_i,
            original=original,
            trim_silence=trim_silence,
            silence_thresh=silence_thresh
        )

        # 3. Stream process
        process = subprocess.Popen(
            ffmpeg_args,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL
        )

        def iter_file():
            try:
                while True:
                    chunk = process.stdout.read(4096)
                    if not chunk:
                        break
                    yield chunk
            finally:
                process.terminate()

        return StreamingResponse(iter_file(), media_type="audio/mpeg")
    except Exception as e:
        error_msg = str(e)
        if "Invalid data found" in error_msg:
             error_msg = "Invalid audio data in cache. Please refresh the page and try searching again."
        raise HTTPException(status_code=500, detail=error_msg)


@app.get("/cache-status")
async def cache_status(url: str = Query(..., description="The YouTube URL to check cache for")):
    """Check if audio is cached for this URL"""
    import glob
    try:
        video_id = validate_youtube_url(url)
        existing = glob.glob(os.path.join(CACHE_DIR, f"{video_id}.*"))
        cached = any(os.path.getsize(f) > 1024 for f in existing if os.path.exists(f))
        return {"cached": cached}
    except Exception:
        return {"cached": False}


@app.get("/silence-info")
async def silence_info(
    url: str = Query(..., description="The YouTube URL to analyze"),
    silence_thresh: float = Query(-40.0)
):
    """
    Returns leading and trailing silence offsets for the cached audio.
    Returns defaults (0, 0) if analysis fails to avoid blocking playback.
    """
    from youtube_downloader import download_to_cache, get_silence_offsets
    import traceback
    try:
        cache_file = download_to_cache(url, CACHE_DIR)
        start, end = get_silence_offsets(cache_file, silence_thresh=silence_thresh)
        return {"leading_silence": start, "trailing_silence": end}
    except Exception as e:
        # Log the error but return defaults so playback can continue
        print(f"WARN: silence-info failed for {url}: {e}")
        traceback.print_exc()
        return {"leading_silence": 0, "trailing_silence": 0}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)