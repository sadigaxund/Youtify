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

# ---------------------------------------------------------------------------
# Audio processing — single shared filter chain
#
# Both the live preview (/stream) and the saved file (/save) build their FFmpeg
# filter graph from build_filter_chain(). This guarantees "what you hear is what
# you get": there is exactly ONE definition of every effect, and exactly ONE
# lossy encode (cache source -> MP3), instead of the old 3-encode pydub pipeline.
# ---------------------------------------------------------------------------

# Corrective EQ presets (opt-in, tonal shaping). Conservative by design.
EQ_PRESETS = {
    'Classical':    "equalizer=f=60:width_type=o:w=1.2:g=8,equalizer=f=12000:width_type=o:w=1.2:g=6",
    'Electronic':   "equalizer=f=50:width_type=o:w=1.0:g=10,equalizer=f=15000:width_type=o:w=1.0:g=8",
    'Podcast':      "equalizer=f=200:width_type=o:w=2:g=-6,equalizer=f=3000:width_type=o:w=1:g=8",
    'Bass Boost':   "equalizer=f=60:width_type=o:w=1:g=10",
    'Treble Boost': "equalizer=f=12000:width_type=o:w=1:g=10",
    'Rock':         "equalizer=f=100:width_type=o:w=1:g=6,equalizer=f=1000:width_type=o:w=1:g=-4,equalizer=f=10000:width_type=o:w=1:g=6",
    'Pop':          "equalizer=f=100:width_type=o:w=1:g=-2,equalizer=f=1000:width_type=o:w=1:g=4,equalizer=f=10000:width_type=o:w=1:g=-2",
    'Jazz':         "equalizer=f=100:width_type=o:w=1:g=5,equalizer=f=1000:width_type=o:w=1:g=-2,equalizer=f=10000:width_type=o:w=1:g=3",
    'Acoustic':     "equalizer=f=100:width_type=o:w=1:g=3,equalizer=f=1000:width_type=o:w=1:g=2,equalizer=f=10000:width_type=o:w=1:g=5",
    'Lo-Fi':        "equalizer=f=200:width_type=o:w=1:g=-6,equalizer=f=8000:width_type=o:w=1:g=-6,lowpass=f=10000,highpass=f=200",
}

# Dynamic-range compression presets (compand: portable, no extra deps).
MBC_PRESETS = {
    'Smooth':    "compand=attacks=0.3:points=-80/-80|-45/-25|-27/-15|0/-6:gain=3",
    'Punchy':    "compand=attacks=0.1:points=-80/-80|-50/-30|-30/-15|0/-8:gain=5",
    'Broadcast': "compand=attacks=0.05:points=-80/-80|-55/-35|-35/-15|-10/-5|0/-3:gain=6",
}


def build_enhance_filter(intensity: float = 1.5) -> str:
    """
    Subtle "restore / clarity" effect.

    YouTube audio is lossy AAC: psychoacoustic encoding throws away high-frequency
    detail, leaving the top end dull. Rather than the old crystalizer+extrastereo
    (which sharpens harshly and can introduce phase issues), this regenerates the
    lost upper harmonics with aexciter and adds a gentle high shelf for "air".
    Mono-safe, no stereo widening — the original feel is preserved.
    """
    # Map UI intensity (1.0 / 1.5 / 2.0 -> Low / Mid / High) to gentle values.
    amount = {1.0: 2.0, 1.5: 3.0, 2.0: 4.5}.get(round(intensity, 1), 3.0)
    shelf_g = {1.0: 1.5, 1.5: 2.5, 2.0: 3.5}.get(round(intensity, 1), 2.5)
    return (
        f"aexciter=level_in=1:level_out=1:amount={amount}:drive=8.5:blend=0:freq=7000:ceil=16000,"
        f"highshelf=g={shelf_g}:f=10000"
    )


def build_filter_chain(
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
    silence_thresh: float = -40.0,
    include_range: bool = True,
) -> list:
    """
    Builds the ordered list of FFmpeg `-af` filters for a given set of effects.
    Used by BOTH preview streaming and final save so they are always identical.

    Order matters: range clip -> silence trim -> EQ -> compression -> restore ->
    loudness (last, so the limiter sees the fully processed signal).
    """
    filters = []

    # 1. Range clip first — so normalization analyses only the kept audio.
    if include_range and (start_time is not None or end_time is not None):
        t_start = start_time if start_time else 0
        t_end = f":end={end_time}" if end_time else ""
        filters.append(f"atrim=start={t_start}{t_end},asetpts=PTS-STARTPTS")

    # "Original" bypasses all tonal/dynamic processing (range clip still applies).
    if original:
        return filters

    # 2. Leading-silence removal (streamable; trailing is handled by the range
    #    end, which the UI snaps to the detected silence boundary).
    if trim_silence:
        filters.append(
            f"silenceremove=start_periods=1:start_threshold={silence_thresh}dB:detection=peak"
        )

    # 3. Corrective EQ
    if eq_preset and eq_preset in EQ_PRESETS:
        filters.append(EQ_PRESETS[eq_preset])

    # 4. Dynamic-range compression
    if mbc_preset and mbc_preset in MBC_PRESETS:
        filters.append(MBC_PRESETS[mbc_preset])

    # 5. Restore / clarity (subtle high-frequency regeneration)
    if enhance:
        filters.append(build_enhance_filter(enhance_intensity))

    # 6. Loudness normalization + true-peak limiter (final stage)
    if normalize:
        filters.append(f"loudnorm=I={normalize_i}:LRA=11:TP=-1.5")

    return filters


def get_audio_duration(path: str) -> Optional[float]:
    """Returns audio duration in seconds via ffprobe, or None on failure."""
    import subprocess
    try:
        out = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', path],
            capture_output=True, text=True, timeout=15
        )
        return float(out.stdout.strip())
    except Exception:
        return None


def process_audio(
    input_path: str,
    output_path: str,
    total_duration: Optional[float] = None,
    progress_cb: Optional[callable] = None,
    **effect_kwargs,
) -> str:
    """
    Single-pass FFmpeg encode: cache source -> processed MP3 (320k).

    Replaces the old multi-encode pipeline (yt-dlp mp3 + pydub trim + ffmpeg fx),
    so there is exactly one lossy stage. Streams FFmpeg's `-progress` output and
    reports 0-100 via progress_cb for real-time UI updates.
    """
    import subprocess

    filters = build_filter_chain(**effect_kwargs)
    cmd = ['ffmpeg', '-y', '-i', input_path]
    if filters:
        cmd.extend(['-af', ",".join(filters)])
    cmd.extend([
        '-map', 'a',
        '-ar', '44100', '-b:a', '320k',
        '-progress', 'pipe:1', '-nostats',
        output_path,
    ])

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        for line in proc.stdout:
            line = line.strip()
            if line.startswith('out_time_us=') and total_duration and progress_cb:
                raw = line.split('=', 1)[1]
                if raw.isdigit():
                    pct = min(99.0, (int(raw) / 1_000_000.0) / total_duration * 100.0)
                    progress_cb(pct)
            elif line == 'progress=end' and progress_cb:
                progress_cb(100.0)
    finally:
        proc.wait()

    if proc.returncode != 0:
        err = proc.stderr.read() if proc.stderr else ''
        raise RuntimeError(f"FFmpeg processing failed: {err[-500:]}")
    return output_path


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
    user_metadata: Optional[dict] = None,
    cache_dir: Optional[str] = None,
    on_progress: Optional[callable] = None,
) -> str:
    """
    Produces a processed MP3 from a YouTube URL using the unified pipeline:

        1. Ensure bestaudio is in the cache (download once, reuse across preview/save).
        2. Single FFmpeg pass: cache source -> effects -> 320k MP3 (one lossy encode).
        3. Embed ID3 metadata + cover art.

    Args:
        cache_dir: where bestaudio is cached. Defaults to a temp dir.
        on_progress: optional callback(phase, percent) where phase is
                     'cache' or 'process' and percent is 0-100.

    Returns:
        Path to the finished MP3.
    """
    import subprocess

    validate_youtube_url(url)

    output_dir = os.path.abspath(output_dir)
    os.makedirs(output_dir, exist_ok=True)

    if cache_dir is None:
        import tempfile
        cache_dir = os.path.join(tempfile.gettempdir(), "yt2mp3_cache")
    os.makedirs(cache_dir, exist_ok=True)

    def _phase(name):
        return (lambda p: on_progress(name, p)) if on_progress else None

    user_metadata = user_metadata or {}

    # 1. Ensure bestaudio is cached (reuses an existing cache file if present).
    try:
        cache_file = download_to_cache(url, cache_dir, progress_cb=_phase('cache'))
    except yt_dlp.DownloadError as e:
        raise RuntimeError(f"Failed to download audio: {str(e)}")
    if _phase('cache'):
        _phase('cache')(100.0)

    output_path = os.path.join(output_dir, f"{filename}.mp3")

    # Duration of the processed clip (for accurate progress %).
    src_duration = get_audio_duration(cache_file)
    if start_time is not None or end_time is not None:
        clip_end = end_time if end_time is not None else (src_duration or 0)
        total_duration = max(0.0, clip_end - (start_time or 0)) or None
    else:
        total_duration = src_duration

    # 2. Single processing pass (cache -> processed MP3).
    process_audio(
        cache_file,
        output_path,
        total_duration=total_duration,
        progress_cb=_phase('process'),
        start_time=start_time,
        end_time=end_time,
        eq_preset=eq_preset,
        mbc_preset=mbc_preset,
        enhance=enhance,
        enhance_intensity=enhance_intensity,
        normalize=normalize,
        normalize_i=normalize_i,
        original=original,
        trim_silence=trim_silence_flag,
        silence_thresh=silence_thresh,
    )

    # 3. Metadata + cover art.
    if os.path.exists(output_path):
        # Fetch YouTube thumbnail only if the user did not upload a custom cover.
        if not user_metadata.get('thumbnail_base64'):
            try:
                info = get_video_info(url)
                if info.get('thumbnail'):
                    import urllib.request
                    with urllib.request.urlopen(info['thumbnail'], timeout=10) as response:
                        user_metadata['youtube_thumbnail_data'] = response.read()
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
                thumbnail_path=None,
                user_metadata=user_metadata,
            )
        except Exception as e:
            print(f"Warning: Metadata embedding failed: {str(e)}")

    return output_path


def detect_leading_silence(audio, silence_threshold=-40.0, chunk_size=1):
    """
    Detect leading silence in milliseconds with finer granularity.
    Used only for silence ANALYSIS (drawing the UI overlay / snapping the
    range slider) — never for re-encoding the audio.
    """
    trim_ms = 0
    # Process in chunks of 1ms for max precision
    while trim_ms < len(audio) and audio[trim_ms:trim_ms+chunk_size].dBFS < silence_threshold:
        trim_ms += chunk_size
    return trim_ms


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


def download_to_cache(url: str, cache_dir: str, progress_cb: Optional[callable] = None) -> str:
    """
    Downloads raw bestaudio to a cache directory for quick previewing and reuse.
    Returns the path to the cached file.
    Optimized: extracts video ID from URL to check cache without API calls.

    progress_cb: optional callback(percent 0-100) for real-time download progress.
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
                    if progress_cb:
                        progress_cb(100.0)
                    return cache_file
                else:
                    print(f"Cache file {cache_file} is corrupted or empty. Removing.")
                    try:
                        os.remove(cache_file)
                    except:
                        pass

        # Translate yt-dlp progress dicts into a simple 0-100 callback.
        def _hook(d):
            if not progress_cb:
                return
            if d['status'] == 'downloading':
                total = d.get('total_bytes') or d.get('total_bytes_estimate')
                got = d.get('downloaded_bytes', 0)
                if total:
                    progress_cb(min(99.0, got / total * 100.0))
            elif d['status'] == 'finished':
                progress_cb(100.0)

        # Download in M4A format (higher compatibility with FFmpeg/Pydub containers)
        ydl_opts = {
            'format': 'bestaudio[ext=m4a]/bestaudio/best',
            'outtmpl': os.path.join(cache_dir, '%(id)s.%(ext)s'),
            'quiet': True,
            'no_warnings': True,
            'noplaylist': True,
            'progress_hooks': [_hook] if progress_cb else [],
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
    Uses the SAME build_filter_chain() as the saved file, so the preview is an
    exact match for what gets downloaded. Optimized for fast browser buffering
    (no -re flag).
    """
    args = ['ffmpeg', '-y', '-i', input_path]

    filters = build_filter_chain(
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
        silence_thresh=silence_thresh,
    )
    if filters:
        args.extend(['-af', ",".join(filters)])

    # Output to stdout as MP3 for browser playback.
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
