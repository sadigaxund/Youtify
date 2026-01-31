import os
import tempfile
import uuid
import shutil
import threading
from typing import Optional, Dict

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from youtube_downloader import validate_youtube_url, download_youtube_audio, get_video_info

app = FastAPI(
    title="YT2MP3",
    description="High-quality YouTube Audio Downloader",
    version="1.2.1"
)

# Store progress in-memory (simple session-based)
# In a production app, use Redis or similar
download_progress: Dict[str, dict] = {}

# Use a persistent temp directory for downloads
DOWNLOAD_DIR = os.path.join(tempfile.gettempdir(), "yt_downloader_cache")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# Create static directory if it doesn't exist
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

def cleanup_file(path: str, session_id: str):
    """Callback to delete the file and progress after streaming is complete"""
    try:
        if os.path.exists(path):
            os.remove(path)
        if session_id in download_progress:
            del download_progress[session_id]
    except Exception as e:
        print(f"Error cleaning up file {path}: {e}")

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
