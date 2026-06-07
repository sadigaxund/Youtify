# Changelog

All notable changes to Youtify are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases are cut by pushing a `vX.Y.Z` git tag, which builds and publishes the
Docker image (`sakhund/youtify:<version>` + `:latest`).

## [2.2.0] - 2026-06-07

### Added
- **Music-library app shell.** A persistent top bar (Download / Library) with
  full-width, capped (~1200px) pages — the floating card/modal layout is gone.
- **Now-playing panel** in the library: cover, marquee title/artist, seek bar,
  play/pause, and prev/next that step through the current filtered list.
- **Filter & sort.** Field=value filter chips (AND-combined, across any metadata
  incl. custom tags) plus a sort selector (field + direction), on top of the
  existing full-text search.
- **Playlists** (left sidebar): "All Tracks" plus manual and **dynamic**
  (filter-defined) playlists, an inline create unit (name, optional cover,
  Manual/Dynamic, filter builder), per-track add/remove, and delete. Persisted as
  JSON sidecars under `.youtify/playlists/` (DB-indexed, rebuilt on startup).
  Endpoints: `GET/POST /playlists`, `GET/PATCH/DELETE /playlists/{id}`,
  `POST/DELETE /playlists/{id}/tracks`, `GET /playlists/{id}/cover`.
- **In-library playback** — `GET /library/{id}/audio`; play any saved track.
- **Per-track cover endpoint** `GET /library/{id}/cover`; inline covers in lists.
- **Full metadata editing** in the library: all standard fields plus arbitrary
  custom tags and cover, on a dedicated edit page.
- **Search by query** — non-URL input on the download view searches YouTube
  (`GET /yt-search`) and shows up to 10 pickable results.
- **Preview-cache cleanup** — `POST /preview-cache/clear`; a session's preview
  "mix" renders are dropped on page unload.

### Changed
- Library editing moved from modals to **in-page views** with back navigation.
- "A/B Compare" renamed to **Mixes**; history cap raised to 12.
- **Preview player rewritten to a single, reliable `<audio>` element**, replacing
  the dual-element crossfade: switching effects/mixes always applies and resumes
  the current position (brief load gap on a combo's first render).
- `GET /library` now returns `custom_fields` for client-side filter/sort.
- Cover controls are an always-visible 2-column **Upload / Reset** row.
- Removed the PayPal donation footer. App version bumped to 2.2.0.

### Fixed
- Effect/mix switches no longer randomly reset playback or fail to apply.
- `416 Range Not Satisfiable` on combo switch — the resume seek is now clamped
  inside the file and only after duration is known.
- Double audio when moving between Download and Library — the other tab's player
  is paused on switch.
- Library list rendered as one giant cover — now a proper row list.
- Filter row layout/sizing cleaned up; dynamic playlist counts compute live.

## [2.1.0] - 2026-06-06

### Added
- **Library (server-save mode).** Browse every saved track and edit it from the UI:
  a Library modal listing tracks with filter, plus per-track Edit / Effects / Delete.
  Endpoints: `GET /library`, `GET /library/{id}`, `PATCH /library/{id}`,
  `POST /library/{id}/reprocess`, `DELETE /library/{id}`, `POST /library/rebuild`.
- **Rebuildable SQLite metadata index** with normalized artist/genre tags and an
  EAV store for arbitrary custom tags.
- **On-disk archive** under `<save-dir>/.youtify/`: a copy of each source audio
  (`originals/`) plus a per-track JSON sidecar (`meta/`). Enables effect-rebuilds
  without re-downloading, and lets the DB be rebuilt from disk if lost.
- **Tag suggestions** — `GET /suggestions?kind=artist|genre&q=` served from saved
  tracks, merged into the autocomplete alongside the existing localStorage history.
- **`--cache-dir` / `CACHE_DIRECTORY`** — separate SSD working cache + `metadata.db`
  from the HDD `--save-dir` library.
- **Server-side cover-art standardization** — all embedded art normalized to JPEG,
  aspect ratio kept (no crop), capped at ~1000px, for consistent Jellyfin display.
- **Gap-free A/B crossfade** — a dual `<audio>` setup fades a new combo in while the
  old fades out, phase-synced to avoid an echo/flam.
- **Startup ASCII banner + structured logging** (`logging`, level via `LOG_LEVEL`).

### Changed
- **A/B chips**: clicking a chip now loads the combo into the controls *and* plays it;
  the separate "load into controls" button was removed.
- **Library editing semantics**: metadata changes re-tag the MP3 in place (no
  re-download, no FFmpeg) and rename the file when name fields change; effect changes
  rebuild the MP3 from the archived original.
- **`metadata.db`** moved off the repo root to `<cache-dir>/metadata.db` and gitignored;
  it is repopulated from the sidecars on startup.
- Replaced the deprecated FastAPI `@app.on_event("startup")` with a lifespan handler.
- Improved restoration/quality processing in the audio pipeline.

### Fixed
- **A/B switching is now instant** for already-rendered combos — `/stream` no longer
  makes a per-request yt-dlp metadata call (the old 3–6s lag).
- Range-input blur no longer triggers a redundant `/silence-info` ffmpeg scan;
  silence analysis is memoized per `(video, threshold)`.
- A/B no longer spawns a duplicate "Dry (no FX)" chip identical to Original.
- DB writes use UPSERT (no orphaned/duplicate metadata rows), enforce FK cascade,
  and the `get_audio_detail` SELECT `rowcount` bug is fixed.
- Thumbnail embedding hardened (format/resolution) via cover normalization.

## [2.0.0] - 2026-02-14

### Added
- Option to save downloads directly to a server directory instead of streaming to
  the browser (`--save-dir` / `SAVE_DIRECTORY`).

### Changed
- Comprehensive README rewrite covering Python and Docker usage and configuration.
- General code polish and cleanup.

## [1.0.0] - 2026-02-01

### Added
- Initial working version: YouTube → 320 kbps MP3 with EQ presets, loudness
  normalization, enhancement modes, range select, live seekable preview, and
  ID3 + cover-art metadata embedding.

[2.2.0]: https://github.com/sakhund/youtify/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/sakhund/youtify/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/sakhund/youtify/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/sakhund/youtify/releases/tag/v1.0.0
