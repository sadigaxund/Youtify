<p align="center">
  <img src="https://github.com/user-attachments/assets/c454b82a-764f-4a34-bc12-95b2d42a25de" alt="Youtify banner" width="100%" />
</p>

<h1 align="center">Youtify</h1>

<p align="center">
  Pull high-quality audio from YouTube, shape it with effects, tag it, and save it — to your device or directly into a server media library.
</p>

<p align="center">
  <a href="https://hub.docker.com/r/sakhund/youtify"><img src="https://img.shields.io/docker/pulls/sakhund/youtify?style=flat-square" /></a>
  <a href="https://hub.docker.com/r/sakhund/youtify"><img src="https://img.shields.io/docker/v/sakhund/youtify?sort=semver&style=flat-square" /></a>
</p>

---

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="https://github.com/user-attachments/assets/a22b5165-4bb8-47cc-acaf-a8f7637e6acd" alt="Download — live preview & A/B compare"/><br/><sub><b>Download — live preview & A/B compare</b></sub></td>
    <td width="50%"><img src="https://github.com/user-attachments/assets/42d5215e-b009-4d7f-ba28-c61b1bab4c10" alt="Library — playlists & now-playing"/><br/><sub><b>Library — playlists & now-playing</b></sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://github.com/user-attachments/assets/e751268b-7594-41c4-8c37-8e216ed8b06a" alt="Effects & metadata editor"/><br/><sub><b>Effects & metadata editor</b></sub></td>
    <td width="50%"><img src="https://github.com/user-attachments/assets/8a5f18b2-63d4-48d8-84c1-f0cc422b3cff" alt="Search key or URL"/><br/><sub><b>Effects & metadata editor</b></sub></td>
  </tr>
</table>


<details><summary>📱 Mobile screenshots</summary>
<br/>
<p align="center">
  <img src="https://github.com/user-attachments/assets/a59ed7b8-7f25-4154-9fe8-eea537004f02" width="320" alt="Search Menu"/>
  <br/><sub><b>Search Menu</b></sub>
</p>
  
<p align="center">
  <img src="https://github.com/user-attachments/assets/1f089579-0bd2-48de-8e9f-2ba57345326d" width="320" alt="Download & Metadata Menu"/>
  <br/><sub><b>Download & Metadata Menu</b></sub>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/8ca6aa39-208a-43ff-888b-edf444d9c928" width="320" alt="Mobile mini-bar + media controls"/>
  <br/><sub><b>Mobile mini-bar + media controls</b></sub>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/6febf04b-f669-4b4e-ad6f-3f97ffaec79d" width="320" alt="Playlists & Groups"/>
  <br/><sub><b>Playlists & Groups</b></sub>
</p>
  
</details>

---

## Features

### Audio quality & processing

- **Single-encode pipeline** — the best available source is cached once, then rendered in a single FFmpeg pass to 320 kbps MP3, keeping quality close to the original.
- **Loudness normalization** — EBU R128 (`loudnorm`) with a selectable target (−12 / −16 / −23 LUFS) and a true-peak limiter.
- **EQ presets** — Pop, Rock, Jazz, Classical, Acoustic, Electronic, Podcast, Lo-Fi, Bass Boost, Treble Boost.
- **Enhancement modes** — pick one at Low / Mid / High intensity:
  - **Restore** — regenerates high-frequency detail lost to YouTube's lossy AAC.
  - **Vocal Clarity** — presence lift + de-mud for clearer vocals and speech.
  - **Crisp / Air** — stronger top-end sparkle for dull or muffled sources.
  - **Warmth / De-harsh** — low-mid warmth + tames harsh upper-mids.
- **Range select & silence trim** — clip to a time range and strip leading silence; applied only on export so the preview stays full-length.
- **Original bypass** — save an untouched copy with no processing applied.

### Preview & compare

- **Seekable live preview** — plays the full track with your effects applied; drag the playhead anywhere and it maps 1:1 to the timeline.
- **A/B compare** — every combo you preview is saved as a chip. Flip between them instantly (each render is cached per effect-set), then load any snapshot back into the controls with one click.
- **Lossless preview** — previews are rendered to lossless FLAC, so what you hear is higher quality than the final MP3 export, with no extra lossy stage.
- **⚡ Turbo Render** *(opt-in)* — caches intermediate WAV checkpoints so re-rendering similar effect combinations is faster. See [Turbo Render](#turbo-render) below.
- **Real-time progress** — separate live progress bars for source download and FFmpeg processing.

### Metadata

- Auto-fetches cover art, title, artist, and year from the video.
- Multi-value chip tagging for **Artist, Genre, Composer**, and any custom field — each value is its own chip with per-library autocomplete.
- Cover art upload, custom filename, configurable multi-value delimiter (`,` / `|` / `;`).
- Cover art is standardized server-side (JPEG, capped ~1000 px) for consistent display in players like Jellyfin.

### Library *(Server Save mode)*

- Browse, **edit metadata** (re-tags the file in place), **reprocess effects** (rebuilds from the archived original), or delete.
- **Built-in player** — now-playing panel with cover art, seek bar, and prev/next that steps through the current filtered list.
- **OS media integration** — publishes title, artist, album, and cover art to the OS: MPRIS on Linux desktops, lock-screen / notification controls on Android (full controls require HTTPS).
- **Playlists** — manual or dynamic (filter-defined) playlists with cover art and drag-to-reorder; stored as JSON sidecars under `.youtify/playlists/`.
- **Browse by Album / Artist / Genre / Year** — cover-art card grid with a hero view and Play All for each group.
- **Filter & sort** — `field=value` filter chips across any metadata field (including custom tags), a sort selector, and full-text search.
- **Archive** — each save writes a source copy + JSON sidecar under `<save-dir>/.youtify/`, enabling re-render without re-download and index rebuild if the database is lost.
- **SQLite index** — `metadata.db` lives in the cache directory and is rebuilt from sidecars on startup.
- **Mobile-friendly** — Spotify-style layout: collapsible source picker, full-width track list, fixed bottom mini-bar that expands to a full sheet.

### Sources & export

- **YouTube URL or local file** — paste a URL/search term, or drop a local audio file. Uploaded files have their embedded tags and cover art pre-read into the editor.
- **Selectable export format** — Auto / MP3 320 / FLAC / WAV. *Auto* keeps the source's quality: lossless in → FLAC out; lossy in → MP3 320 out.
- **Batch generate** — open **⊞ Generate** to define sets of EQ / compression / enhance / loudness values and drop every combination into the A/B list at once.

### Deployment

- **Browser Download** *(default)* — process and download straight to your device.
- **Server Save** — mount a volume and write files directly to a server media library (e.g. Jellyfin, Nextcloud).
- **Split storage** — keep the media library on one disk (`--save-dir`) and the working cache + database on another (`--cache-dir`).
- **Docker** — runs as a non-root user with PUID/PGID mapping for correct file ownership.

---

## How it works

Hitting **Search** caches the best available audio stream once. Both the preview and the final export build their FFmpeg filter graph from the same shared source, so what you hear is what you get. The preview renders the full track with effects to lossless FLAC (seekable, cached per effect-set); time-range and silence cuts are applied only on final export, in a single encode to your chosen format.

### Turbo Render

The preview effect chain runs in order: **EQ → compression → enhance → loudness**. Without Turbo Render, every new combo re-decodes the source and runs all stages from scratch.

**Turbo Render** (opt-in) caches lossless WAV checkpoints after each cumulative stage (`+EQ`, `+EQ+comp`, `+EQ+comp+enhance`) under `<cache>/work/ckpt/`. When you tweak a later stage, the render resumes from the deepest matching checkpoint instead of recomputing earlier ones — e.g. changing the enhance intensity reuses the cached base+EQ+compression and only re-runs enhance + loudness.

Because every intermediate is lossless and there is still exactly one final encode, **preview quality is identical** — Turbo only changes how fast a render is produced.

It's **off by default**. Enable per-session with the toggle in the effects panel, or set the default with the `--turbo` flag / `TURBO_PREVIEW=1` env var. Checkpoints for earlier videos are cleared on each new search, and the checkpoint store is LRU-pruned to keep disk use bounded.

> **Note:** Turbo speeds up *re-renders* that share a cached prefix. The first render of a new track still pays full cost, and loudness normalization (the dominant cost) runs for every distinct combination regardless.

---

## Installation

### Option 1: Python (run directly)

**Prerequisites:** Python 3.11+, FFmpeg

```bash
# Install FFmpeg
# Ubuntu/Debian:  sudo apt install ffmpeg
# Fedora:         sudo dnf install ffmpeg
# macOS:          brew install ffmpeg

git clone https://github.com/sadigaxund/youtify.git
cd youtify
pip install .

# Browser download mode
python main.py

# Server save mode
python main.py --save-dir ~/Music/Youtify

# Split storage: library on HDD, cache + database on SSD
python main.py --save-dir /mnt/hdd/Music --cache-dir ~/.cache/youtify
```

Server starts at `http://localhost:8000`.

**Configuration:**

| Flag | Env var | Default | Description |
|------|---------|---------|-------------|
| `--save-dir` | `SAVE_DIRECTORY` | *(unset — browser download)* | Media library root; `.youtify/` archive is written here |
| `--cache-dir` | `CACHE_DIRECTORY` | `~/.cache/youtify` | Working cache (previews, downloads) + `metadata.db` |
| `--turbo` | `TURBO_PREVIEW` | *off* | Enable Turbo Render by default |
| — | `LOG_LEVEL` | `INFO` | Log verbosity |

---

### Option 2: Docker Hub *(recommended)*

```bash
docker pull sakhund/youtify:latest

# Browser download mode
docker run -d --name youtify -p 8000:8000 sakhund/youtify:latest

# Server save mode
docker run -d --name youtify -p 8000:8000 \
  -v /path/to/music:/music \
  -e SAVE_DIRECTORY=/music \
  -e PUID=$(id -u) \
  -e PGID=$(id -g) \
  sakhund/youtify:latest

# With a separate cache volume (avoids re-downloading sources after container recreate)
docker run -d --name youtify -p 8000:8000 \
  -v /path/to/music:/music \
  -v /path/to/cache:/cache \
  -e SAVE_DIRECTORY=/music \
  -e PUID=$(id -u) \
  -e PGID=$(id -g) \
  sakhund/youtify:latest
```

The container defaults `CACHE_DIRECTORY=/cache`. The `.youtify/` archive lives inside `/music`, so the media volume already protects it. Open the UI at `http://localhost:8000`.

---

### Option 3: Build from source

```bash
git clone https://github.com/sadigaxund/youtify.git
cd youtify
docker build -t sakhund/youtify:latest .
# Then run with the Option 2 commands above
```

---

## Quick start

1. Paste a YouTube URL and hit **Search** — thumbnail and metadata load while the audio caches in the background.
2. Set a time range, pick your effects, and press **play** to preview. Each combination is saved as an A/B chip — click any chip to hear it instantly, then load it back into the controls with one click.
3. Edit metadata and cover art.
4. Hit **Download** — the file streams to your browser, or saves to the server in Server Save mode.
5. In Server Save mode, open **Library** to play saved tracks (with OS lock-screen / desktop controls), organize playlists, filter and sort, edit metadata in place, reprocess effects, or delete.

---

## Contributing

Issues and pull requests are welcome. Please open an issue before starting significant work so we can discuss the approach.

## License

See [LICENSE](LICENSE).
