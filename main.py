import os
import tempfile
import uuid
import shutil
import threading
import datetime
from typing import Optional, Dict

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

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
    # Priority 3: Default (~/Downloads)
    return os.getenv("SAVE_DIRECTORY", "~/Downloads")

ENV_SAVE_DIR = get_config()

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

# Create static directory if it doesn't exist
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

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

@app.post("/save")
async def save_audio(
    background_tasks: BackgroundTasks,
    url: str = Query(..., description="The YouTube URL to download audio from"),
    use_hash: bool = Query(False, description="Use hash+timestamp naming"),
    session_id: Optional[str] = Query(None, description="Optional session ID for progress tracking")
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
        
        # 3. Determine Naming
        info = get_video_info(url)
        if use_hash:
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            unique_id = uuid.uuid4().hex[:6]
            filename_to_use = f"{video_id}_{timestamp}_{unique_id}.mp3"
        else:
            # Clean title for filename
            clean_title = "".join(c for c in info['title'] if c.isalnum() or c in "._- ").strip()
            filename_to_use = f"{clean_title}.mp3"
        
        # 4. Handle duplicates
        final_path = get_unique_path(DOWNLOAD_DIR, filename_to_use)
        final_filename = os.path.basename(final_path)
        
        # We need the basename for yt-dlp to output to exactly that name
        # download_youtube_audio appends .mp3 if not present, so we strip it for the call
        output_filename_base = os.path.splitext(final_filename)[0]

        # 5. Download in background or wait
        # To keep progress bar working simply, we download synchronously but the UI polls
        output_path = download_youtube_audio(
            url=url,
            output_dir=DOWNLOAD_DIR,
            filename=output_filename_base,
            progress_hook=hook
        )
        
        # 6. Final progress update
        download_progress[session_id] = {
            "status": "finished", 
            "progress": 100, 
            "path": final_path,
            "filename": final_filename
        }
        
        return {
            "status": "success",
            "message": f"Saved to {final_path}",
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

@app.get("/stream")
async def stream_audio(
    background_tasks: BackgroundTasks,
    url: str = Query(..., description="The YouTube URL to download audio from"),
    filename: Optional[str] = Query(None, description="Optional custom filename (without .mp3)"),
    session_id: Optional[str] = Query(None, description="Optional session ID for progress tracking")
):
    """
    Validates, downloads, and streams the MP3 audio in a single request.
    Perfect for direct browser downloads or Postman testing.
    """
    try:
        # 1. Validate URL
        video_id = validate_youtube_url(url)
        
        # 2. Setup session and progress recording
        if not session_id:
            session_id = uuid.uuid4().hex[:8]
        
        download_progress[session_id] = {"status": "starting", "progress": 0}
        hook = progress_hook_factory(session_id)
        
        # 3. Generate unique filename
        unique_id = uuid.uuid4().hex[:8]
        if filename:
            safe_name = "".join(c for c in filename if c.isalnum() or c in "._- ")
            filename_to_use = f"{safe_name}_{unique_id}"
        else:
            filename_to_use = f"yt_{video_id}_{unique_id}"
        
        # 4. Download to local cache with progress hook
        output_path = download_youtube_audio(
            url=url,
            output_dir=DOWNLOAD_DIR,
            filename=filename_to_use,
            progress_hook=hook
        )
        
        if not os.path.exists(output_path):
            download_progress[session_id] = {"status": "error", "message": "File not found after processing"}
            raise HTTPException(status_code=500, detail="Download failed: File not found after processing")

        # Get final filename for Content-Disposition
        final_filename = os.path.basename(output_path)
        file_size = os.path.getsize(output_path)

        # 5. Define streaming iterator
        def iterfile():
            try:
                with open(output_path, "rb") as f:
                    while chunk := f.read(1024 * 1024):  # 1MB chunks
                        yield chunk
            except Exception as e:
                print(f"Streaming error: {e}")
            finally:
                pass

        # 6. Schedule cleanup after response
        background_tasks.add_task(cleanup_file, output_path, session_id)

        # 7. Stream back to user
        return StreamingResponse(
            iterfile(),
            media_type="audio/mpeg",
            headers={
                "Content-Disposition": f'attachment; filename="{final_filename}"',
                "Content-Length": str(file_size),
                "Cache-Control": "no-cache"
            }
        )

    except ValueError as e:
        if session_id in download_progress:
            download_progress[session_id] = {"status": "error", "message": str(e)}
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        if session_id in download_progress:
            download_progress[session_id] = {"status": "error", "message": str(e)}
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        if session_id in download_progress:
            download_progress[session_id] = {"status": "error", "message": str(e)}
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")

# Mount static files (optional, but good for assets like icons if needed later)
# app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
