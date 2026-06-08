# Youtify — Code map for AI agents

## Architecture

FastAPI app serving a single-page frontend from `static/`. Two modes: **Browser Download** (streams to browser) and **Server Save** (writes to disk with SQLite index).

## Static files (frontend)

All JS is **global-scope, no modules** — loaded via `<script>` tags in order. Functions freely cross-reference across files without import/export.

| File | Responsibility |
|---|---|
| `index.html` | HTML skeleton only |
| `style.css` | All styles (single file) |
| `app.js` | State vars, `els` DOM references, utils (`setLoading`, `showError`, `showToast`) |
| `pipeline.js` | Download progress steps, process flow |
| `thumbnail.js` | Cover uploader (`wireCover`) |
| `metadata.js` | Tags, multi-value chip inputs (artist/genre/composer/custom), autocomplete, Output & technical panel (format flow, tag separator, custom filename) |
| `search.js` | YouTube search, file upload, `onSourceReady` |
| `mixer.js` | A/B compare snapshots, batch combo generator |
| `preview.js` | Range slider, audio player, OS media session, `onEffectChange` |
| `library.js` | Library view, playlists, filter/sort, Browse-by facet grid + hero (IIFE-wrapped) |

**Key patterns:**
- `els.xxx` = cached `document.getElementById('xxx')`
- `setLoading(btn, bool)` / `showError(msg)` / `showToast(path)` — global utils
- `lucide.createIcons()` called after any HTML icon change
- `debounce(fn, ms)` for autocomplete

## Backend (`main.py`)

- `GET /` serves `static/index.html`
- `GET /stream` — live preview with effects (FLAC cached)
- `POST /save` — download + process + save
- `POST /upload` — local file ingest
- `GET|POST|PATCH|DELETE /library/*` — saved tracks
- `GET|POST|PATCH|DELETE /playlists/*` — playlists

## Docker / CI

- `Dockerfile` — `python:3.13-slim`, installs via `pip install .` (pyproject.toml)
- `.github/workflows/docker-image.yml` — builds on `v*.*.*` tag push
- Entrypoint (`entrypoint.sh`) handles UID/GID mapping for volume permissions

## Dependency management

- `pyproject.toml` (PEP 621) — single source of truth. `pip install .` to install.
- Key deps: `fastapi`, `yt-dlp`, `pydub`, `mutagen`, `Pillow`, `python-multipart`
