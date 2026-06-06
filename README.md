
<img width="1590" height="878" alt="image" src="https://github.com/user-attachments/assets/c454b82a-764f-4a34-bc12-95b2d42a25de" />

<h1 align="center">Youtify</h1>

<p align="center">
  <strong>Pull high-quality audio from YouTube, preview effects live, tag it, and save it — to your device or straight into a server media library.</strong>
</p>

<p align="center">
  <a href="https://hub.docker.com/r/sakhund/youtify"><img src="https://img.shields.io/docker/pulls/sakhund/youtify?style=flat-square" /></a>
  <a href="https://hub.docker.com/r/sakhund/youtify"><img src="https://img.shields.io/docker/v/sakhund/youtify?sort=semver&style=flat-square" /></a>
</p>


<img width="1218" height="1399" alt="image" src="https://github.com/user-attachments/assets/b8a1806b-53cc-4e0c-9c82-b9de0ce380be" />


## Features

### Audio quality & processing
- **Single-encode pipeline** — best available source is cached once, then rendered with **one** FFmpeg pass to **320 kbps MP3**. Only one lossy stage, so quality stays close to the source (no repeated re-encoding).
- **Loudness normalization** — EBU R128 (`loudnorm`) with selectable target (-12 / -16 / -23 LUFS) and a true-peak limiter.
- **EQ presets** — Pop, Rock, Jazz, Classical, Acoustic, Electronic, Podcast, Lo-Fi, Bass Boost, Treble Boost.
- **Enhancement modes** (pick one, each with Low / Mid / High):
  - **Restore** — regenerates high-frequency detail lost to YouTube's lossy AAC. Subtle, mono-safe, keeps the original feel.
  - **Vocal Clarity** — presence lift + de-mud for clearer vocals/speech.
  - **Crisp / Air** — stronger top-end sparkle for dull or muffled sources.
  - **Warmth / De-harsh** — low-mid warmth + tames harsh upper-mids.
- **Range select & silence trim** — clip to a time range and strip leading silence; applied only on export so the preview stays full-length.
- **Original bypass** — save an untouched copy with no processing.

### Preview & compare
- **Seekable live preview** — plays the full track with your effects applied; drag the playhead anywhere and it maps 1:1 to the timeline.
- **A/B compare** — every combo you preview is saved as a chip. Flip between them instantly (each render is cached per effect-set) to compare, without disturbing your current controls. Load any snapshot back into the controls in one click.
- **Real-time progress** — separate live bars for caching (download) and processing (FFmpeg), instead of a single "done" flip.

### Metadata
- Auto-fetches cover art, title, artist, and year from the video.
- Multi-artist / multi-genre tagging with autocomplete that **remembers what you've typed** (stored locally in the browser).
- Custom ID3 tags, cover-art upload (auto-resized to keep files small), and a configurable delimiter for multiple artists/genres (e.g. `,`, `|`, `;`).

### Deployment
- **Browser Download** (default): process and download straight to your device.
- **Server Save**: mount a volume and write files directly to your server library (e.g. Jellyfin / Nextcloud).
- **Docker** support, running as a non-root user with PUID/PGID mapping for correct file ownership.

## How it works

`Search` caches the best audio stream once. Both the **preview** and the final **export** build their FFmpeg filter graph from the *same* shared chain over that cache, so what you hear is what you get. The preview plays the full track with effects only (seekable, cached per effect-set); time-range and silence cuts are applied only on export, in a single 320 kbps encode.

## Installation

### Option 1: Run directly with Python

**Prerequisites:** Python 3.11+, FFmpeg, pip

```bash
# Install FFmpeg
# Ubuntu/Debian:  sudo apt install ffmpeg python3-pip
# Fedora:          sudo dnf install ffmpeg python3-pip
# macOS:           brew install ffmpeg

# Clone & install
git clone https://github.com/<your-repo>/youtify.git
cd youtify
pip install -r requirements.txt

# Run (browser download mode)
python main.py

# Or run (server save mode)
python main.py --save-dir ~/Music/Youtify
```

Server starts at `http://localhost:8000`.

### Option 2: Pull & run from Docker Hub (recommended)

```bash
docker pull sakhund/youtify:latest

# Browser download mode
docker run -d --name youtify -p 8000:8000 sakhund/youtify:latest

# Server save mode (set PUID/PGID to your user ID for correct file ownership)
docker run -d --name youtify -p 8000:8000 \
  -v /path/to/music:/music \
  -e SAVE_DIRECTORY=/music \
  -e PUID=$(id -u) \
  -e PGID=$(id -g) \
  sakhund/youtify:latest
```

Access the UI at `http://localhost:8000`.

### Option 3: Build image from source

```bash
git clone https://github.com/<your-repo>/youtify.git
cd youtify
docker build -t sakhund/youtify:latest .
# Then run using Option 2 commands
```

## Usage

1. Paste a YouTube URL and hit **Search** — the thumbnail/metadata load and the audio starts caching in the background.
2. Set a **time range**, pick **effects**, and press **play** to preview. Try a few combos; each is saved to the **A/B** list to compare.
3. Edit **metadata** and cover art.
4. Hit **Download** — files stream to your browser (or save to the server in Server Save mode).
