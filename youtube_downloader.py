"""
YouTube Audio Downloader Module

Provides functionality to validate YouTube URLs and download audio as high-quality MP3.
"""

import re
import os
from urllib.parse import urlparse, parse_qs
from typing import Optional
import yt_dlp
import threading
from weakref import WeakValueDictionary


# Global lock manager for downloads to prevent race conditions
_download_locks = WeakValueDictionary()
_locks_lock = threading.Lock()

def _get_download_lock(video_id: str):
    with _locks_lock:
        if video_id not in _download_locks:
            # We use a standard Lock, but store it in a WeakValueDictionary.
            # However, Lock objects aren't weak-referenceable by default in some python versions or hard to manage.
            # Simpler approach: Use a specific object that holds the lock.
            # Or just use a standard dictionary and accept it grows (IDs are small).
            # Let's use a standard dict for robustness in this simple app.
            pass
            
# Retrying with a standard dict approach for simplicity and reliability
_active_locks = {}
_active_locks_lock = threading.Lock()

def get_video_lock(video_id: str):
    with _active_locks_lock:
        if video_id not in _active_locks:
            _active_locks[video_id] = threading.Lock()
        return _active_locks[video_id]

def validate_youtube_url(url: str) -> Optional[str]:
    """
    Validates that a URL is a legitimate YouTube URL and extracts the video ID.
    
    Args:
        url: The URL to validate
        
    Returns:
        The video ID if valid, None otherwise
        
    Raises:
        ValueError: If the URL is not a valid YouTube URL
    """
    if not url or not isinstance(url, str):
        raise ValueError("URL must be a non-empty string")
    
    # Clean the URL
    url = url.strip()
    
    # List of valid YouTube domains
    valid_domains = [
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'youtu.be',
        'www.youtu.be',
        'music.youtube.com',
    ]
    
    try:
        parsed = urlparse(url)
        
        # Ensure scheme is http or https (or empty for shorthand)
        if parsed.scheme and parsed.scheme not in ('http', 'https'):
            raise ValueError(f"Invalid URL scheme: {parsed.scheme}. Only http/https allowed.")
        
        # Check if the domain is valid
        hostname = parsed.hostname
        if not hostname:
            raise ValueError("Could not parse hostname from URL")
            
        hostname = hostname.lower()
        
        if hostname not in valid_domains:
            raise ValueError(f"Invalid domain: {hostname}. Not a recognized YouTube domain.")
        
        # Extract video ID based on URL format
        video_id = None
        
        # Format: youtu.be/VIDEO_ID
        if hostname in ('youtu.be', 'www.youtu.be'):
            path = parsed.path.strip('/')
            if path:
                video_id = path.split('/')[0].split('?')[0]
        
        # Format: youtube.com/watch?v=VIDEO_ID
        elif 'watch' in parsed.path:
            query_params = parse_qs(parsed.query)
            if 'v' in query_params:
                video_id = query_params['v'][0]
        
        # Format: youtube.com/embed/VIDEO_ID or youtube.com/v/VIDEO_ID
        elif '/embed/' in parsed.path or '/v/' in parsed.path:
            path_parts = parsed.path.split('/')
            for i, part in enumerate(path_parts):
                if part in ('embed', 'v') and i + 1 < len(path_parts):
                    video_id = path_parts[i + 1]
                    break
        
        # Format: youtube.com/shorts/VIDEO_ID
        elif '/shorts/' in parsed.path:
            path_parts = parsed.path.split('/')
            for i, part in enumerate(path_parts):
                if part == 'shorts' and i + 1 < len(path_parts):
                    video_id = path_parts[i + 1]
                    break
        
        if not video_id:
            raise ValueError("Could not extract video ID from URL")
        
        # Validate video ID format (YouTube IDs are 11 characters, alphanumeric with - and _)
        video_id_pattern = re.compile(r'^[a-zA-Z0-9_-]{11}$')
        if not video_id_pattern.match(video_id):
            raise ValueError(f"Invalid video ID format: {video_id}")
        
        return video_id
        
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"Failed to parse URL: {str(e)}")


def get_video_info(url: str) -> dict:
    """
    Extracts metadata from a YouTube video.
    
    Args:
        url: The YouTube video URL
        
    Returns:
        Dictionary containing title, thumbnail, and duration
    """
    validate_youtube_url(url)
    
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return {
                "title": info.get("title"),
                "thumbnail": info.get("thumbnail"),
                "duration": info.get("duration"),
                "author": info.get("uploader"),
                "view_count": info.get("view_count"),
                "video_id": info.get("id"),
                "upload_date": info.get("upload_date")  # YYYYMMDD format
            }
    except Exception as e:
        raise RuntimeError(f"Failed to extract video info: {str(e)}")


def download_youtube_audio(
    url: str,
    output_dir: str = ".",
    filename: Optional[str] = None,
    start_time: Optional[float] = None,
    end_time: Optional[float] = None,
    trim_silence_flag: bool = False,
    silence_thresh: float = -40.0,
    eq_preset: Optional[str] = None,
    mbc_preset: Optional[str] = None,
    enhance: bool = False,
    enhance_intensity: float = 1.5,
    normalize: bool = True,
    normalize_i: float = -16.0,
    original: bool = False,
    progress_hook: Optional[callable] = None,
    user_metadata: Optional[dict] = None
) -> str:
    """
    Downloads audio from a YouTube video in the highest quality and saves it as MP3.
    
    Args:
        url: The YouTube video URL
        output_dir: Directory to save the MP3 file (default: current directory)
        filename: Optional custom filename (without extension). If not provided,
                  uses the video title.
                  
    Returns:
        The path to the downloaded MP3 file
        
    Raises:
        ValueError: If the URL is invalid
        RuntimeError: If the download fails
    """
    # Validate the URL first
    video_id = validate_youtube_url(url)
    
    # Ensure output directory exists
    output_dir = os.path.abspath(output_dir)
    os.makedirs(output_dir, exist_ok=True)
    
    # Configure yt-dlp options for highest quality audio
    ydl_opts = {
        # Extract audio only - prioritize M4A/AAC for better container stability/compatibility
        'format': 'bestaudio[ext=m4a]/bestaudio/best',
        
        # Post-processing: only convert to MP3, no metadata/thumbnail embedding
        'postprocessors': [
            {
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '320',  # Highest MP3 quality (320 kbps)
            },
        ],
        
        # Output template
        'outtmpl': os.path.join(
            output_dir,
            filename if filename else '%(title)s'
        ) + '.%(ext)s',
        
        # Print to stdout for terminal progress
        'quiet': False,
        'no_warnings': True,
        
        # Prevent downloading playlists
        'noplaylist': True,
        
        # Progress hook
        'progress_hooks': [progress_hook] if progress_hook else [],
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Extract info first to get the final filename
            info = ydl.extract_info(url, download=True)
            
            # Construct the output path
            if filename:
                output_path = os.path.join(output_dir, f"{filename}.mp3")
            else:
                # Use the sanitized title from yt-dlp
                title = ydl.prepare_filename(info)
                # Replace the original extension with .mp3
                output_path = os.path.splitext(title)[0] + '.mp3'
            
            # Log the actual source bitrate to verify quality
            source_abr = info.get('abr')
            if source_abr:
                print(f"Source audio bitrate: {source_abr}kbps")
            else:
                print("Could not determine source bitrate.")
            
            if not os.path.exists(output_path):
                # Try to find the file (yt-dlp might have sanitized the filename)
                for f in os.listdir(output_dir):
                    if f.endswith('.mp3') and (video_id in f or info.get('title', '') in f):
                        output_path = os.path.join(output_dir, f)
                        break
            
            # Trim to time range if specified (fast local operation using stream copy)
            if os.path.exists(output_path) and (start_time is not None or end_time is not None):
                try:
                    output_path = trim_audio_range(output_path, start_time, end_time)
                    print(f"Trimmed to range: {start_time or 0}s - {end_time or 'end'}s")
                except Exception as e:
                    print(f"Warning: Range trimming failed: {str(e)}")
            
            # Apply silence trimming if requested
            if trim_silence_flag and os.path.exists(output_path):
                try:
                    start_trim, end_trim = trim_silence(output_path, silence_thresh=silence_thresh)
                    # print(f"Trimmed {start_trim/1000:.2f}s from start, {end_trim/1000:.2f}s from end.")
                except Exception as e:
                    # Log error but don't fail the download
                    print(f"Warning: Silence trimming failed: {str(e)}")
            
            # Apply advanced audio processing (Normalization, EQ, Enhancement)
            if os.path.exists(output_path) and not original:
                try:
                    apply_audio_processing(
                        output_path, 
                        normalize=normalize, 
                        normalize_i=normalize_i,
                        eq_preset=eq_preset, 
                        mbc_preset=mbc_preset,
                        enhance=enhance,
                        enhance_intensity=enhance_intensity
                    )
                except Exception as e:
                    print(f"Warning: Audio processing failed: {str(e)}")
            
            # Embed custom metadata (source URL and processing info)
            if os.path.exists(output_path):
                # Download YouTube thumbnail if no custom thumbnail provided
                if not user_metadata.get('thumbnail_base64') and info.get('thumbnail'):
                    try:
                        import urllib.request
                        thumbnail_url = info['thumbnail']
                        print(f"Downloading thumbnail from: {thumbnail_url}")
                        with urllib.request.urlopen(thumbnail_url, timeout=10) as response:
                            thumbnail_data = response.read()
                            if not user_metadata:
                                user_metadata = {}
                            user_metadata['youtube_thumbnail_data'] = thumbnail_data
                            print(f"Downloaded thumbnail: {len(thumbnail_data)} bytes")
                    except Exception as e:
                        print(f"Warning: Could not download YouTube thumbnail: {e}")
                
                try:
                    embed_custom_metadata(
                        output_path,
                        source_url=url,
                        eq_preset=eq_preset if not original else None,
                        mbc_preset=mbc_preset if not original else None,
                        normalize=normalize if not original else False,
                        normalize_i=normalize_i,
                        enhance=enhance if not original else False,
                        trim_silence=trim_silence_flag if not original else False,
                        original=original,
                        thumbnail_path=None,  # No longer using file path
                        user_metadata=user_metadata
                    )
                except Exception as e:
                    print(f"Warning: Metadata embedding failed: {str(e)}")
            
            return output_path
            
    except yt_dlp.DownloadError as e:
        raise RuntimeError(f"Failed to download audio: {str(e)}")
    except Exception as e:
        raise RuntimeError(f"Unexpected error during download: {str(e)}")


def trim_audio_range(audio_path: str, start_time: Optional[float] = None, end_time: Optional[float] = None) -> str:
    """
    Trims an audio file to the specified time range using ffmpeg stream copy.
    This is nearly instant since no re-encoding is needed.
    Replaces the original file with the trimmed version.
    
    Args:
        audio_path: Path to the audio file
        start_time: Start time in seconds (None = from beginning)
        end_time: End time in seconds (None = to end)
    
    Returns:
        The path to the trimmed file (same as input)
    """
    import subprocess
    import tempfile
    
    temp_fd, temp_path = tempfile.mkstemp(suffix='.mp3')
    os.close(temp_fd)
    
    try:
        cmd = ['ffmpeg', '-y', '-i', audio_path]
        
        # Add time range flags (before output for fast seeking)
        if start_time is not None and start_time > 0:
            cmd.extend(['-ss', str(float(start_time))])
        if end_time is not None:
            if start_time is not None and start_time > 0:
                # Use -t (duration) since -ss shifts the timeline
                duration = float(end_time) - float(start_time)
                cmd.extend(['-t', str(duration)])
            else:
                cmd.extend(['-to', str(float(end_time))])
        
        # Stream copy — no re-encoding, nearly instant
        cmd.extend(['-c', 'copy', temp_path])
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            os.replace(temp_path, audio_path)
        else:
            print(f"FFmpeg trim failed: {result.stderr}")
            if os.path.exists(temp_path):
                os.remove(temp_path)
    except Exception as e:
        print(f"Error trimming audio: {e}")
        if os.path.exists(temp_path):
            os.remove(temp_path)
    
    return audio_path


def detect_leading_silence(audio, silence_threshold=-40.0, chunk_size=1):
    """
    Detect leading silence in milliseconds with finer granularity.
    """
    trim_ms = 0
    # Process in chunks of 1ms for max precision
    while trim_ms < len(audio) and audio[trim_ms:trim_ms+chunk_size].dBFS < silence_threshold:
        trim_ms += chunk_size
    return trim_ms


def trim_silence(audio_path, silence_thresh=-40.0):
    """
    Trims leading and trailing silence from an audio file.
    
    NOTE: This uses pydub which involves a transcode (MP3 -> PCM -> MP3).
    At 320kbps, this quality loss is minimal but present.
    """
    from pydub import AudioSegment
    audio = AudioSegment.from_file(audio_path)
    
    start_trim = detect_leading_silence(audio, silence_threshold=silence_thresh)
    end_trim = detect_leading_silence(audio.reverse(), silence_threshold=silence_thresh)
    
    duration = len(audio)
    # Ensure we don't trim everything if the whole file is silent
    if start_trim + end_trim >= duration:
        return 0, 0
        
    trimmed_audio = audio[start_trim:duration-end_trim]
    
    # Export back to the same path
    trimmed_audio.export(audio_path, format="mp3", bitrate="320k")
    return start_trim, end_trim


def get_silence_offsets(audio_path: str, silence_thresh: float = -40.0):
    """
    Analyzes an audio file and returns leading and trailing silence in seconds.
    """
    from pydub import AudioSegment
    try:
        audio = AudioSegment.from_file(audio_path)
        start_ms = detect_leading_silence(audio, silence_threshold=silence_thresh)
        end_ms = detect_leading_silence(audio.reverse(), silence_threshold=silence_thresh)
        
        # Prevent everything being marked as silence
        if start_ms + end_ms >= len(audio):
            return 0.0, 0.0
            
        return start_ms / 1000.0, end_ms / 1000.0
    except Exception as e:
        print(f"Error getting silence offsets for {audio_path}: {e}")
        # If file is corrupted, try to remove it if it's in the cache
        try:
            if "/yt2mp3_cache/" in audio_path and os.path.exists(audio_path):
                os.remove(audio_path)
                print(f"Removed corrupted cache file: {audio_path}")
        except:
            pass
        return 0.0, 0.0


def embed_custom_metadata(
    audio_path: str,
    source_url: str,
    eq_preset: Optional[str] = None,
    mbc_preset: Optional[str] = None,
    normalize: bool = False,
    normalize_i: float = -16.0,
    enhance: bool = False,
    trim_silence: bool = False,
    original: bool = False,
    thumbnail_path: Optional[str] = None,
    user_metadata: Optional[dict] = None
):
    """
    Embeds metadata into an MP3 file using mutagen (ID3 tags).
    
    Supports standard tags: title (TIT2), artist (TPE1), album (TALB),
    genre (TCON), year (TDRC), composer (TPE3), cover art (APIC),
    and custom tags (TXXX).
    
    user_metadata can contain:
        - title, artist, album, genre, year, composer: standard tags
        - custom_tags: list of {key, value} dicts
        - thumbnail_base64: base64-encoded image for cover art
    """
    import base64
    from mutagen.mp3 import MP3
    from mutagen.id3 import ID3, TIT2, TPE1, TALB, TCON, TDRC, TPE3, COMM, TXXX, APIC, ID3NoHeaderError
    
    user_metadata = user_metadata or {}
    
    try:
        # Load or create ID3 tags
        try:
            audio = MP3(audio_path, ID3=ID3)
            if audio.tags is None:
                audio.add_tags()
        except ID3NoHeaderError:
            audio = MP3(audio_path)
            audio.add_tags()
        
        tags = audio.tags
        
        # Standard ID3 tags
        if user_metadata.get('title'):
            tags.add(TIT2(encoding=3, text=user_metadata['title']))
        if user_metadata.get('artist'):
            tags.add(TPE1(encoding=3, text=user_metadata['artist']))
        if user_metadata.get('album'):
            tags.add(TALB(encoding=3, text=user_metadata['album']))
        if user_metadata.get('genre'):
            # Use configured delimiter, do not split (User preference)
            # Force Title Case for all genres
            genre_str = user_metadata['genre']
            delim = user_metadata.get('delimiter', '|')
            # Reconstruct title case while preserving delimiter
            capitalized_genres = [g.strip().title() for g in genre_str.split(delim) if g.strip()]
            final_genre_str = delim.join(capitalized_genres)
            tags.add(TCON(encoding=3, text=final_genre_str))
        if user_metadata.get('year'):
            tags.add(TDRC(encoding=3, text=user_metadata['year']))
        if user_metadata.get('composer'):
            tags.add(TPE3(encoding=3, text=user_metadata['composer']))
        
        # Build processing description for comment
        processing_parts = []
        if original:
            processing_parts.append("Original (no processing)")
        else:
            if eq_preset: processing_parts.append(f"EQ: {eq_preset}")
            if mbc_preset: processing_parts.append(f"Compression: {mbc_preset}")
            if normalize: processing_parts.append(f"Normalized: {normalize_i} LUFS")
            if enhance: processing_parts.append("Stereo Enhanced")
            if trim_silence: processing_parts.append("Silence Trimmed")
        
        processing_info = ", ".join(processing_parts) if processing_parts else "No processing"
        tags.add(COMM(encoding=3, lang='eng', desc='', text=f"Source: {source_url} | Processing: {processing_info}"))
        tags.add(TXXX(encoding=3, desc='source_url', text=source_url))
        
        # Custom tags — map known keys to proper ID3 frames, rest as TXXX
        for tag in user_metadata.get('custom_tags', []):
            key = tag.get('key', '').strip()
            value = tag.get('value', '').strip()
            if key and value:
                if key.lower() == 'composer':
                    tags.add(TPE3(encoding=3, text=value))
                else:
                    tags.add(TXXX(encoding=3, desc=key, text=value))
        
        # Cover art - custom upload takes priority over YouTube thumbnail
        cover_data = None
        cover_mime = 'image/jpeg'
        
        if user_metadata.get('thumbnail_base64'):
            try:
                cover_data = base64.b64decode(user_metadata['thumbnail_base64'])
                if cover_data[:4] == b'\x89PNG':
                    cover_mime = 'image/png'
                elif cover_data[:4] == b'RIFF':
                    cover_mime = 'image/webp'
            except Exception as e:
                print(f"Warning: Custom thumbnail decode failed: {e}")
                cover_data = None
        
        
        if not cover_data and user_metadata.get('youtube_thumbnail_data'):
            try:
                cover_data = user_metadata['youtube_thumbnail_data']
                # Detect MIME type from data
                if cover_data[:4] == b'\x89PNG':
                    cover_mime = 'image/png'
                elif cover_data[:4] == b'RIFF':
                    cover_mime = 'image/webp'
                elif cover_data[:2] == b'\xff\xd8':
                    cover_mime = 'image/jpeg'
            except Exception as e:
                print(f"Warning: Could not process YouTube thumbnail: {e}")
        
        
        if cover_data:
            tags.add(APIC(
                encoding=3,
                mime=cover_mime,
                type=3,  # Cover (front)
                desc='Cover',
                data=cover_data
            ))
        
        audio.save()
        print(f"Metadata embedded successfully into {audio_path}")
        
    except Exception as e:
        print(f"Error embedding metadata with mutagen: {e}")

def apply_audio_processing(
    audio_path: str, 
    normalize: bool = True, 
    normalize_i: float = -16.0,
    eq_preset: Optional[str] = None, 
    mbc_preset: Optional[str] = None,
    enhance: bool = False,
    enhance_intensity: float = 1.5
):
    """
    Applies loudness normalization, EQ, and enhancement using ffmpeg.
    """
    import subprocess
    
    if not any([normalize, eq_preset, enhance]):
        return

    temp_path = audio_path + ".proc.mp3"
    filters = []

    # 1. Corrective EQ (Set first to clean up frequencies)
    if eq_preset and eq_preset != 'None' and eq_preset != '':
        if eq_preset == 'Classical':
            filters.append("equalizer=f=60:width_type=o:w=1.2:g=8,equalizer=f=12000:width_type=o:w=1.2:g=6")
        elif eq_preset == 'Electronic':
            filters.append("equalizer=f=50:width_type=o:w=1.0:g=10,equalizer=f=15000:width_type=o:w=1.0:g=8")
        elif eq_preset == 'Podcast':
            filters.append("equalizer=f=200:width_type=o:w=2:g=-6,equalizer=f=3000:width_type=o:w=1:g=8")
        elif eq_preset == 'Bass Boost':
            filters.append("equalizer=f=60:width_type=o:w=1:g=10")
        elif eq_preset == 'Treble Boost':
            filters.append("equalizer=f=12000:width_type=o:w=1:g=10")
        elif eq_preset == 'Rock':
            filters.append("equalizer=f=100:width_type=o:w=1:g=6,equalizer=f=1000:width_type=o:w=1:g=-4,equalizer=f=10000:width_type=o:w=1:g=6")
        elif eq_preset == 'Pop':
            filters.append("equalizer=f=100:width_type=o:w=1:g=-2,equalizer=f=1000:width_type=o:w=1:g=4,equalizer=f=10000:width_type=o:w=1:g=-2")
        elif eq_preset == 'Jazz':
            filters.append("equalizer=f=100:width_type=o:w=1:g=5,equalizer=f=1000:width_type=o:w=1:g=-2,equalizer=f=10000:width_type=o:w=1:g=3")
        elif eq_preset == 'Acoustic':
            filters.append("equalizer=f=100:width_type=o:w=1:g=3,equalizer=f=1000:width_type=o:w=1:g=2,equalizer=f=10000:width_type=o:w=1:g=5")
        elif eq_preset == 'Lo-Fi':
            filters.append("equalizer=f=200:width_type=o:w=1:g=-6,equalizer=f=8000:width_type=o:w=1:g=-6,lowpass=f=10000,highpass=f=200")

    # 2. Multiband Compression (using compand for better compatibility)
    if mbc_preset and mbc_preset != 'None' and mbc_preset != '':
        if mbc_preset == 'Smooth':
            # Gentle compression for subtle leveling
            filters.append("compand=attacks=0.3:points=-80/-80|-45/-25|-27/-15|0/-6:gain=3")
        elif mbc_preset == 'Punchy':
            # More aggressive compression for punch
            filters.append("compand=attacks=0.1:points=-80/-80|-50/-30|-30/-15|0/-8:gain=5")
        elif mbc_preset == 'Broadcast':
            # Heavy compression for consistent loudness
            filters.append("compand=attacks=0.05:points=-80/-80|-55/-35|-35/-15|-10/-5|0/-3:gain=6")

    # 3. Stereo Enhancement (High-end only, avoid phase issues in low)
    if enhance:
        # Focusing on harmonics and clarity (Crystalizer) + subtle widening
        # extrastereo is moved after compression to widen a more controlled signal
        filters.append(f"crystalizer=i={(enhance_intensity+1)},extrastereo=m={enhance_intensity}")

    # 4. Loudness Normalization + Limiter (Final volume check)
    if normalize:
        filters.append(f"loudnorm=I={normalize_i}:LRA=11:TP=-1.5")

    if not filters:
        return

    cmd = [
        'ffmpeg', '-y', '-i', audio_path,
        '-af', ",".join(filters),
        '-ar', '44100', '-b:a', '320k',
        temp_path
    ]
    
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        os.replace(temp_path, audio_path)
        print(f"Applied: {' + '.join(filters)}")
    except subprocess.CalledProcessError as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise RuntimeError(f"FFmpeg processing failed: {e.stderr.decode()}")
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise e


def normalize_loudness(audio_path: str):
    """Legacy function, now using apply_audio_processing"""
    apply_audio_processing(audio_path, normalize=True)


def download_to_cache(url: str, cache_dir: str) -> str:
    """
    Downloads raw audio to a cache directory for quick previewing.
    Returns the path to the cached file.
    Uses native format - pydub can handle most formats via ffmpeg.
    Optimized: extracts video ID from URL to check cache without API calls.
    """
    import glob
    import re
    os.makedirs(cache_dir, exist_ok=True)
    
    # Extract video ID from URL without making API call
    video_id = None
    patterns = [
        r'(?:v=|/v/|youtu\.be/)([a-zA-Z0-9_-]{11})',
        r'(?:embed/|shorts/)([a-zA-Z0-9_-]{11})',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            video_id = match.group(1)
            break
            
    # Default lock if ID not found (fallback)
    lock_id = video_id if video_id else "unknown_video"
    lock = get_video_lock(lock_id)
    
    with lock:
        # Check if already cached (any extension)
        # We check INSIDE the lock to ensure we don't start downloading if someone else just finished
        if video_id:
            existing = glob.glob(os.path.join(cache_dir, f"{video_id}.*"))
            if existing:
                cache_file = existing[0]
                # Validate existing cache file - ensure it's not an empty or tiny stub (corrupted download)
                if os.path.exists(cache_file) and os.path.getsize(cache_file) > 1024: # > 1KB
                    return cache_file
                else:
                    print(f"Cache file {cache_file} is corrupted or empty. Removing.")
                    try:
                        os.remove(cache_file)
                    except:
                        pass
        
        # Download in M4A format (higher compatibility with FFmpeg/Pydub containers)
        ydl_opts = {
            'format': 'bestaudio[ext=m4a]/bestaudio/best',
            'outtmpl': os.path.join(cache_dir, '%(id)s.%(ext)s'),
            'quiet': True,
            'no_warnings': True,
            'noplaylist': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            return ydl.prepare_filename(info)


def get_ffmpeg_stream_args(
    input_path: str,
    start_time: Optional[float] = None,
    end_time: Optional[float] = None,
    eq_preset: Optional[str] = None,
    mbc_preset: Optional[str] = None,
    enhance: bool = False,
    enhance_intensity: float = 1.5,
    normalize: bool = True,
    normalize_i: float = -16.0,
    original: bool = False,
    trim_silence: bool = False,
    silence_thresh: float = -40.0
) -> list:
    """
    Generates FFmpeg arguments for streaming processed audio from a source file.
    Optimized for faster browser buffering (no -re flag).
    """
    args = ['ffmpeg', '-y', '-i', input_path]
    
    filters = []

    # 1. Time Range Clipping (MUST BE FIRST for correct normalization analysis)
    if start_time is not None or end_time is not None:
        t_start = start_time if start_time else 0
        t_end = f":end={end_time}" if end_time else ""
        filters.append(f"atrim=start={t_start}{t_end},asetpts=PTS-STARTPTS")
    
    # 2. Advanced Processing (only if NOT original)
    if not original:
        # Silence Removal - Only remove leading silence to prevent audio artifacts
        # Note: stop_periods=-1 was causing audio duplication/overlap
        if trim_silence:
            # Simple approach: just remove leading silence, let trailing be handled naturally
            # Using detection=peak for more reliable silence detection
            filters.append(f"silenceremove=start_periods=1:start_threshold={silence_thresh}dB:detection=peak")

        # 1. Corrective EQ (Set first to clean up frequencies)
        if eq_preset == 'Classical':
            filters.append("equalizer=f=60:width_type=o:w=1.2:g=8,equalizer=f=12000:width_type=o:w=1.2:g=6")
        elif eq_preset == 'Electronic':
            filters.append("equalizer=f=50:width_type=o:w=1.0:g=10,equalizer=f=15000:width_type=o:w=1.0:g=8")
        elif eq_preset == 'Podcast':
            filters.append("equalizer=f=200:width_type=o:w=2:g=-6,equalizer=f=3000:width_type=o:w=1:g=8")
        elif eq_preset == 'Bass Boost':
            filters.append("equalizer=f=60:width_type=o:w=1:g=10")
        elif eq_preset == 'Treble Boost':
            filters.append("equalizer=f=12000:width_type=o:w=1:g=10")
        elif eq_preset == 'Rock':
            filters.append("equalizer=f=100:width_type=o:w=1:g=6,equalizer=f=1000:width_type=o:w=1:g=-4,equalizer=f=10000:width_type=o:w=1:g=6")
        elif eq_preset == 'Pop':
            filters.append("equalizer=f=100:width_type=o:w=1:g=-2,equalizer=f=1000:width_type=o:w=1:g=4,equalizer=f=10000:width_type=o:w=1:g=-2")
        elif eq_preset == 'Jazz':
            filters.append("equalizer=f=100:width_type=o:w=1:g=5,equalizer=f=1000:width_type=o:w=1:g=-2,equalizer=f=10000:width_type=o:w=1:g=3")
        elif eq_preset == 'Acoustic':
            filters.append("equalizer=f=100:width_type=o:w=1:g=3,equalizer=f=1000:width_type=o:w=1:g=2,equalizer=f=10000:width_type=o:w=1:g=5")
        elif eq_preset == 'Lo-Fi':
            filters.append("equalizer=f=200:width_type=o:w=1:g=-6,equalizer=f=8000:width_type=o:w=1:g=-6,lowpass=f=10000,highpass=f=200")

        # 2. Multiband Compression (using compand for better compatibility)
        if mbc_preset and mbc_preset != 'None' and mbc_preset != '':
            if mbc_preset == 'Smooth':
                # Gentle compression for subtle leveling
                filters.append("compand=attacks=0.3:points=-80/-80|-45/-25|-27/-15|0/-6:gain=3")
            elif mbc_preset == 'Punchy':
                # More aggressive compression for punch
                filters.append("compand=attacks=0.1:points=-80/-80|-50/-30|-30/-15|0/-8:gain=5")
            elif mbc_preset == 'Broadcast':
                # Heavy compression for consistent loudness
                filters.append("compand=attacks=0.05:points=-80/-80|-55/-35|-35/-15|-10/-5|0/-3:gain=6")

        # 3. Stereo Enhancement (High-band focused)
        if enhance:
            filters.append(f"crystalizer=i={(enhance_intensity+1)},extrastereo=m={enhance_intensity}")

        # 4. Loudness Normalization + Limiter (Final volume safely)
        if normalize:
            filters.append(f"loudnorm=I={normalize_i}:LRA=11:TP=-1.5")

    if filters:
        args.extend(['-af', ",".join(filters)])

    # Output to stdout as MP3 for browser playback
    # We use libmp3lame and set a reasonable bitrate. 
    # Removed -re to allow the browser to download/buffer as fast as possible.
    args.extend(['-f', 'mp3', '-acodec', 'libmp3lame', '-ab', '320k', 'pipe:1'])
    return args


# Example usage
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python youtube_downloader.py <youtube_url> [output_dir] [filename]")
        sys.exit(1)
    
    url = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "."
    filename = sys.argv[3] if len(sys.argv) > 3 else None
    
    try:
        print(f"Validating URL: {url}")
        video_id = validate_youtube_url(url)
        print(f"Valid YouTube video ID: {video_id}")
        
        print(f"Downloading audio to: {output_dir}")
        output_path = download_youtube_audio(url, output_dir, filename)
        print(f"Successfully downloaded: {output_path}")
        
    except ValueError as e:
        print(f"Validation error: {e}")
        sys.exit(1)
    except RuntimeError as e:
        print(f"Download error: {e}")
        sys.exit(1)
