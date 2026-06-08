# Changelog

All notable changes to Youtify are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases are cut by pushing a `vX.Y.Z` git tag, which builds and publishes the
Docker image (`sakhund/youtify:<version>` + `:latest`).

## [Unreleased]

## [2.2.2] - 2026-06-09

### Added
- **Manual file upload** — drop (or browse to) a local audio file in the download
  view to use it as a source instead of YouTube. Embedded tags (title/artist/
  album/year/genre/composer) and cover art are auto-read to pre-fill the editor;
  the file is probed for losslessness. New `POST /upload`; `/stream`, `/silence-info`
  and `/save` now accept a `source_id` alongside `url` (resolved by `resolve_source`).
- **Selectable export format** — Auto / MP3 320 / FLAC / WAV, chosen from the
  action bar. **Auto** keeps lossless sources lossless (lossless source → FLAC,
  lossy → MP3 320). FLAC is tagged via Vorbis comments + a Picture block; MP3/WAV
  via ID3. Export is a single pass from the source, so a lossless upload exported
  as FLAC/WAV has no lossy stage at all.
- **Batch "⊞ Generate" mixes** — pick sets of EQ / compression / enhance / intensity
  / loudness values and add every combination to the Mixes (A/B) list at once. Chips
  are added lazily (they render only when clicked), so big batches don't thrash the
  CPU. The Mixes list now holds up to 200 and scrolls.
- **⚡ Turbo Render (opt-in preview speed-up)** — caches lossless WAV checkpoints
  of the preview pipeline (decoded source + one per cumulative effect prefix:
  +EQ, +compression, +enhance) under `<cache>/work/ckpt/`. A new combo that shares
  a prefix with an earlier render resumes mid-pipeline instead of recomputing every
  stage (e.g. nudging the enhance knob reuses base+EQ+comp). Off by default; toggle
  in the effects panel, or set the default with `--turbo` / `TURBO_PREVIEW=1`
  (surfaced via `GET /config`). All intermediates are lossless, so no quality loss.
- **OS media integration on the download preview** — the preview player now also
  publishes title/artist/album + cover to the OS (lock screen / desktop widget)
  with play/pause/seek, matching the library player.

### Changed
- **Preview is now lossless FLAC** (was 320 kbps MP3) — faster to render *and*
  higher quality (no lossy stage). Download/export is unchanged (single-pass
  320 kbps MP3).
- **Max-quality source download** — yt-dlp now grabs the highest-bitrate
  audio-only stream (typically ~160 kbps Opus) instead of being pinned to the
  lower-bitrate AAC/m4a, and never falls back to a muxed video stream.
- **New search clears other videos' cache** — preview renders and checkpoints for
  other videos are dropped on each `/search`, keeping the current track's cached.
- **More search results** — text search now returns up to ~30 results in a
  scrollable list (was 10), no pagination.
- **Per-track ⋮ menu** — dropped *Play* (clicking the row already plays) and added
  a **Download** action (saves the library file with its proper name).

### Fixed
- **Library "Add to playlist…" menu** opened and closed instantly — the outside-
  click closer fired on the same click; menu-item clicks no longer bubble to it.
- **FLAC/WAV library tracks** now play and download with the correct content type
  (the endpoint always sent `audio/mpeg`).
- **Effect changes mid-render are no longer dropped** — re-render now triggers on
  playback intent (not just `!paused`) and is debounced, so changing a knob while
  a render is in flight applies without needing to pause + play.
- **Preview starts at the silence-trimmed range** — the start seek is re-asserted
  once the element becomes seekable (first load wasn't seekable yet, so it started
  at 0), and the resume position is clamped to the range start.
- `cleanup_cache` no longer aborts its sweep when it hits the `ckpt/` directory
  (it tried to `os.remove` a folder); it now skips non-files.

## [2.2.1] - 2026-06-08

### Added
- **Autocomplete on all metadata** — Album, Year, Composer, and custom-tag **keys
  and values** now suggest from the library (generalized `GET /suggestions?field=`),
  via native datalists on the download form and the library editor.
- **Edit playlists** — change a playlist's name, cover, kind, and (dynamic) filters
  from the sidebar pencil button (`PATCH /playlists/{id}`).
- **Reorder playlists** — drag sidebar entries to reorder; order persists
  (`POST /playlists/reorder` + a `position` field in the DB/sidecars).
- **Library is the default view** in server-save mode.
- **Mobile library (Spotify-style)** — the sidebar collapses to a `source ▾`
  picker, the track list goes full-width, and now-playing becomes a fixed bottom
  mini-bar (tap to expand to a full sheet, with a close button).
- **OS media integration (Media Session API)** — the current library track's
  title/artist/album + cover artwork are published to the OS, so it appears in
  Linux desktop media widgets (MPRIS) and mobile lock-screen/notification
  controls, with working play/pause/next/previous/seek. (Full controls on Android
  need an HTTPS origin.)
- **Per-track action menu** — the row's play/add/edit/delete buttons collapse into
  a single `⋮` kebab so titles get the space.

### Changed
- **Mixes** chips show effects as wrapping pill-tags instead of one bunched line.
- **Library Effects editor** laid out as a 2-column grid (was a single long column).
- **Download view compacted** — cover sits beside the metadata fields; the view is
  wider; Download/New + progress sit in their own action bar.
- Filter/sort controls grouped into a single header band above the track list.
- Now-playing panel is compact (cover capped) and no longer dominates the column.
- Log lines + the startup banner/config box are colorized to match uvicorn.

### Fixed
- **Scroll jitter** — removed `position: sticky` everywhere (it fought the scroll,
  worse under CSS `zoom`): the top bar is a fixed overlay and the now-playing
  panel / action bar are normal flow. The global `zoom` is off by default for the
  same reason (use the browser's own zoom).
- Cover endpoints are now cacheable (versioned URL), so the Media Session artwork
  is no longer re-fetched every second during playback.
- Combo switching no longer throws `416 Range Not Satisfiable` / interrupts —
  the resume seek waits for metadata and is clamped inside the file.
- Datalist suggestions no longer re-open right after you pick one.
- Mobile: horizontal overflow (player + library) — content now fills the viewport;
  the player range header wraps; the now-playing mini-bar is a single row.
- Playlist sidebar: track counts align across All Tracks and playlists; the
  hover edit/delete buttons no longer overlap the count; dynamic counts are live.

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

[Unreleased]: https://github.com/sakhund/youtify/compare/v2.2.2...HEAD
[2.2.2]: https://github.com/sakhund/youtify/compare/v2.2.1...v2.2.2
[2.2.1]: https://github.com/sakhund/youtify/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/sakhund/youtify/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/sakhund/youtify/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/sakhund/youtify/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/sakhund/youtify/releases/tag/v1.0.0
