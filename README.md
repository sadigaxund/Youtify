
<p align="center">
  <img src="https://github.com/user-attachments/assets/c454b82a-764f-4a34-bc12-95b2d42a25de" alt="Youtify banner" width="100%" />
</p>

<h1 align="center">Youtify</h1>

<p align="center">
  <strong>Pull high-quality audio from YouTube, preview effects live, tag it, and save it — to your device or straight into a server media library.</strong>
</p>

<p align="center">
  <a href="https://hub.docker.com/r/sakhund/youtify"><img src="https://img.shields.io/docker/pulls/sakhund/youtify?style=flat-square" /></a>
  <a href="https://hub.docker.com/r/sakhund/youtify"><img src="https://img.shields.io/docker/v/sakhund/youtify?sort=semver&style=flat-square" /></a>
</p>


<p align="center">
  <img src="https://github.com/user-attachments/assets/b8a1806b-53cc-4e0c-9c82-b9de0ce380be" alt="Youtify UI" width="45%" />
</p>

## Screenshots

<!-- Drag each image into a GitHub issue/PR/release comment, then paste the
     generated user-attachments URL in place of the REPLACE_* placeholders. -->
<table>
  <tr>
    <td width="50%"><img src="REPLACE_URL_1" alt="Download — live preview & A/B compare"/><br/><sub><b>Download — live preview & A/B compare</b></sub></td>
    <td width="50%"><img src="REPLACE_URL_2" alt="Library — playlists & now-playing"/><br/><sub><b>Library — playlists & now-playing</b></sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="REPLACE_URL_3" alt="Effects & metadata editor"/><br/><sub><b>Effects & metadata editor</b></sub></td>
    <td width="50%"><img src="REPLACE_URL_4" alt="Mobile mini-bar + lock screen"/><br/><sub><b>Mobile mini-bar + lock-screen controls</b></sub></td>
  </tr>
</table>

<details><summary>📸 More screenshots</summary>
<br/>
<img src="REPLACE_URL_5" width="100%" alt="Extra screenshot"/>
</details>

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
- **Lossless preview** — previews are rendered to lossless FLAC, so what you audition is *higher* quality than the final MP3, with no extra lossy stage. (The download/export is a single-pass 320 kbps MP3.)
- **⚡ Turbo Render** (opt-in) — caches the preview pipeline in stages so re-rendering similar combos is faster. See [Turbo Render](#turbo-render-faster-previews) below.
- **Real-time progress** — separate live bars for caching (download) and processing (FFmpeg), instead of a single "done" flip.

### Metadata
- Auto-fetches cover art, title, artist, and year from the video.
- Multi-value tagging via chips (type + Enter) for **Artist, Genre, Composer, and any custom tag** — each value is its own chip with individual autocomplete drawn from your library.
- Custom tags, cover-art upload, and a configurable delimiter for multi-value fields (e.g. `,`, `|`, `;`).
- **Output & technical** panel: pick the export format (with a `source → target` preview), toggle Turbo Render, set the tag separator, and optionally type a **custom filename**.
- Cover art is **standardized server-side** (JPEG, aspect kept, capped ~1000px) for consistent display in players like Jellyfin.

### Library (Server Save mode)
- Browse everything you've saved, **edit metadata** (re-tags the file in place — no re-download), **reprocess effects** (rebuilds from an archived original), or delete.
- **Built-in player** — a now-playing panel with cover, seek bar, and prev/next that step through the current filtered list.
- **OS media integration** — the playing track's title/artist/album + cover art publish to the OS, so it shows in Linux desktop media widgets (MPRIS) and mobile lock-screen/notification controls, with working play/pause/next/previous/seek. (Full controls on Android need an HTTPS origin.)
- **Playlists** — manual or **dynamic** (filter-defined) playlists in a sidebar, drag-to-reorder, with cover art. Stored as JSON sidecars under `.youtify/playlists/`.
- **Browse by Album / Artist / Genre / Year** — a cover-art card grid; pick a card to open a hero view (▶ Play all) of that group's tracks.
- **Filter & sort** — `field=value` filter chips across any metadata (incl. custom tags) plus a sort selector, on top of full-text search.
- Each save also writes an **archive** under `<save-dir>/.youtify/`: a copy of the source audio plus a JSON sidecar. This lets you re-render without re-downloading and rebuild the index if the database is ever lost.
- A small **SQLite index** (`metadata.db`) powers the library and tag suggestions; it lives in the cache directory and is rebuilt from the sidecars on startup.
- **Mobile-friendly** — Spotify-style layout: collapsible source picker, full-width track list, fixed bottom mini-bar that expands to a full sheet.

### Sources & export
- **Two sources** — paste a YouTube URL/search, **or drop a local audio file** into the download view. Uploaded files have their embedded tags + cover auto-read to pre-fill the editor.
- **Selectable export format** — **Auto** / MP3 320 / FLAC / WAV. *Auto* keeps the source's quality: a lossless source (e.g. an uploaded FLAC) exports as FLAC, a lossy one (YouTube) as MP3 320. Tags + cover are embedded in every format (ID3 for MP3/WAV, Vorbis comments for FLAC).
- **Batch generate** — open **⊞ Generate** to pick sets of EQ / compression / enhance / loudness values and drop every combination into the A/B "Mixes" list at once; each renders on click.

### Deployment
- **Browser Download** (default): process and download straight to your device.
- **Server Save**: mount a volume and write files directly to your server library (e.g. Jellyfin / Nextcloud).
- **Split storage**: keep the media library on one disk (`--save-dir`, e.g. HDD) and the working cache + database on another (`--cache-dir`, e.g. SSD).
- **Docker** support, running as a non-root user with PUID/PGID mapping for correct file ownership.

## How it works

`Search` caches the best audio stream once. Both the **preview** and the final **export** build their FFmpeg filter graph from the *same* shared chain over that cache, so what you hear is what you get. The preview plays the full track with effects only (seekable, lossless FLAC, cached per effect-set); time-range and silence cuts are applied only on export, in a single encode to your chosen format (MP3 320 / FLAC / WAV / Auto).

### Turbo Render (faster previews)

The preview effect chain runs in order: **EQ → compression → enhance → loudness**. Rendering a brand-new combo from scratch re-decodes the source and runs every stage. **Turbo Render** (opt-in) trades disk for speed: it caches **lossless WAV checkpoints** — one for the decoded source, then one per *cumulative prefix* (`+EQ`, `+EQ+comp`, `+EQ+comp+enhance`) under `<cache>/work/ckpt/`. A new combo that shares a prefix with an earlier render resumes from the deepest matching checkpoint instead of recomputing those stages — so, for example, nudging just the enhance intensity reuses the cached base+EQ+compression and only re-runs enhance + loudness.

Because every intermediate is lossless and there's still exactly one lossless final encode, **preview quality is identical** — Turbo only changes *how fast* a render is produced, never how it sounds. Loudness is the last stage and is followed only by the encode, so it isn't checkpointed (that would just duplicate the per-combo output cache).

It's **off by default**. Enable per-session with the toggle in the effects panel, or change the default with the `--turbo` flag / `TURBO_PREVIEW=1` env var. Checkpoints (and stale preview renders) for other videos are cleared on each new search, and the checkpoint store is LRU-pruned, so disk use stays bounded.

> **Note:** Turbo speeds up *re-rendering* combos that share a prefix. The first render of a brand-new track still pays full cost, and loudness normalization (which must run for every distinct combo) is the dominant cost regardless — so the win is biggest while A/B-ing many variations of the same track.

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

# Split storage: library on HDD, cache + database on SSD
python main.py --save-dir /mnt/hdd/Music --cache-dir ~/.cache/youtify
```

Server starts at `http://localhost:8000`.

**Configuration** (CLI flag overrides environment variable):

| Flag | Env var | Default | Purpose |
|------|---------|---------|---------|
| `--save-dir` | `SAVE_DIRECTORY` | _(unset → browser download)_ | Media library + `.youtify/` archive |
| `--cache-dir` | `CACHE_DIRECTORY` | `~/.cache/youtify` | Working cache (previews/downloads) + `metadata.db` |
| `--turbo` | `TURBO_PREVIEW` | _off_ | Default [Turbo Render](#turbo-render-faster-previews) ON (checkpoint cache; users can still toggle per-session) |

`LOG_LEVEL` (default `INFO`) controls log verbosity.

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

# Optional: persist the cache + database on a separate (e.g. SSD) volume.
# It's disposable — the database rebuilds from the library's sidecars — but
# mounting it avoids re-downloading sources after a container recreate.
docker run -d --name youtify -p 8000:8000 \
  -v /path/to/music:/music \
  -v /path/to/cache:/cache \
  -e SAVE_DIRECTORY=/music \
  -e PUID=$(id -u) \
  -e PGID=$(id -g) \
  sakhund/youtify:latest
```

The container defaults `CACHE_DIRECTORY=/cache`; the `.youtify/` archive sits inside `/music`, so the media volume already protects it.

Access the UI at `http://localhost:8000`.

### Option 3: Build image from source

```bash
git clone https://github.com/sadigaxund/youtify.git
cd youtify
docker build -t sakhund/youtify:latest .
# Then run using Option 2 commands
```

## Usage

1. Paste a YouTube URL and hit **Search** — the thumbnail/metadata load and the audio starts caching in the background.
2. Set a **time range**, pick **effects**, and press **play** to preview. Try a few combos; each is saved to the **A/B** list — click any chip to load it back into the controls and hear it instantly (each render cached per effect-set).
3. Edit **metadata** and cover art.
4. Hit **Download** — files stream to your browser (or save to the server in Server Save mode).
5. In Server Save mode, open **Library** to revisit saved tracks: play them (with OS lock-screen/desktop controls), organize into playlists, filter/sort, edit metadata in place, reprocess effects, or delete.
