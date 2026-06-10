# Changelog

All notable changes to Youtify are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases are cut by pushing a `vX.Y.Z` git tag, which builds and publishes the
Docker image (`sakhund/youtify:<version>` + `:latest`).


#  [v2.3.1] - 2026-06-10

## Changed (Mobile Polish)
- **Informational mobile mini-bar** — Redesigned as an edge-to-edge layout displaying title, artist, and playback position as a subtle background sweep. Interactive controls (transport, heart, sleep, seek, queue) are offloaded to the full-screen sheet opened by tapping the bar.
- **Browse "See all" workflow** — Dashed see-all cards are replaced by a compact "See all N ▸" button in the Browse-by header that opens a dedicated full-grid view of that facet, hiding the main toolbar and track list. Picking a card displays that group's tracks, and the hero's `← Back` button returns to the grid.
- **Horizontal facet navigation** — "Browse by" header layout is locked to a single line on narrow viewports, enabling horizontal scrolling across facet tabs and preventing text wrapping.
- **Toolbar optimization** — The favorites `♥` toggle is integrated inside the sort group to save vertical layout space on mobile devices.
- **Browse-by grid caps** — Grid view is capped at 4 cards per facet with an accompanying "See all N" / "Show less" toggle card.

## Fixed
- **Persistent asset creation dates** — `created_at` parameters are threaded from the sidecar back into the database during a rebuild, preventing file ingest times from resetting to the current time on startup.
- **Safe re-save data merging** — Re-saving an existing video identifier executes a sidecar merge on `/save`, preserving historical play stats, favorite flags, and creation dates.
- **Dropdown focus handling** — Suggestion dropdowns no longer stick open after losing field focus; a capture-phase outside-click handler and an Escape key listener dismiss them reliably.
- **Media Session hardening** — Hardened OS media control routines for Firefox and Zen browsers by re-applying metadata and handlers immediately after user-initiated play commands, enforcing explicit MIME types on artwork URLs, and skipping oversized data-URL graphics strings. *(Note: Hardened browser profiles must enable `media.hardwaremediakeys.enabled` for hardware keys and MPRIS integration to function).*

# [v2.3.0] - 2026-06-10

## Added
- **Play queue** — "Play next" and "Add to queue" entries in each track's kebab menu; an "Up next" panel in the now-playing aside (click a row to jump, `×` to remove, *Clear* to empty). Next/auto-advance actions consume the queue before falling back to the current filtered list. Session-only.
- **Sleep timer** — Moon button in the now-playing controls supporting off, 15, 30, 60 minutes, or end of track intervals. End-of-track halts playback without auto-advancing and preserves the queue.
- **Play stats** — Tracks `play_count` and `last_played` per track, incremented once playback passes 30s (or half of a short track). Introduces new sorting options (Plays, Last played) and adds Added/plays/last-played data to the row tooltip. Stats persist in the asset sidecar to survive database rebuilds and re-saves.
- **Favorites** — Heart toggle on each row, inside the now-playing panel, and in the kebab menu; a toolbar `♥` toggle limits the view to favorites, and favorite is exposed as a filter field for dynamic playlists. Persisted via the sidecar.
- **Fast preview** — Opt-in toggle next to Turbo that renders previews as 128k MP3 instead of lossless FLAC for quicker, smaller cache files. Cached separately per quality; final export quality is unaffected.
- **Multi-value Album** — Album field converted to a chip input. The first value acts as the canonical `ALBUM`/`TALB` tag (Jellyfin-compatible) and database column, while the full array is written as `ALBUMS` (TXXX frame / multi-value Vorbis), indexed for browse/filter/suggestions, and stored in the sidecar (`metadata.albums`).
- **Editable Browse-by thumbnails** — Pencil icon on the facet hero cover allows custom image uploads per Album/Artist/Genre/Year value (stored under `.youtify/facets/`), supporting removal with a fallback to the first track's cover art.
- **Artist default image from channel profile picture** — Background routine fetches the channel avatar as that artist's facet image on save if the first artist matches the YouTube channel name.
- **Copy metadata from another track** — "Copy from…" option in the download form and library editor opens a searchable picker to fill artists, genres, albums, year, and custom tags, leaving the title and cover untouched.
- **Custom-tag preset keys** — Key field suggests preset keys (Emotion, Mood, Language, BPM, etc.) merged with keys already present in the library; a default empty Emotion row replaces the old Composer row on new downloads.

## Changed
- **Gapless mix switching** — Download-preview player rewritten around two ping-ponging `<audio>` elements. The active node keeps playing while the idle node loads and seeks the newly selected mix; the roles swap once the new element is explicitly emitting audio (its clock advances). This replaces single-element swapping and volume-crossfade attempts, resolving load gaps, doubled/echoed audio, desync, restart-from-0, and dropped silence-trim starts.
- **Sync positioning** — Resume position computed as `max(range start, current playhead)` clamped to the file, ensuring first play honors the selected/silence-trim start and switches resume in place.
- **Stream file isolation** — `/stream` endpoint renders to a unique temp file per request using worker PID and UUID combinations, preventing parallel requests from the two audio elements from racing on destructive `os.replace` operations (`FileNotFoundError`).
- **Streamlined code structure** — Refactored `playPreview` routines into flat named phases and small helpers (`startEl`, `whenReady`, `seekThen`), and stripped out legacy crossfade logic.
- **Generate (batch mixes) removed** — The `⊞ Generate` modal and its render queue are gone; A/B mix chips themselves remain unchanged.
- **Composer field removed from UI** — Replaced by standard custom tag mappings, though uploaded files with embedded composer data still pre-fill a row. The backend continues to map a Composer custom tag to `TPE3`/`COMPOSER`.
- **Library metadata editor parity** — Artists, genres, and albums now use chip inputs with autocomplete mirroring the download form, respecting global tag separator settings rather than hard-coded delimiters.
- **In-place form reset** — The "New" action clears the form and returns to the search view immediately without a full page reload.
- **Metadata chip interactions** — Long metadata chips truncate with the full value accessible in a tooltip. The chip removal button appears on hover and requires a second confirmation click (turning red for 2.5s) to prevent accidental deletions. The custom-tag key column is narrower, and the `value…` placeholder hides once a chip exists.

## [2.2.4] - 2026-06-09

### Added
- **Browse by Album / Artist / Genre / Year** in the library — a cover-art card
  grid on "All Tracks" (responsive; circular cards for artists, square for the
  rest, with track counts). Clicking a card opens a hero view (cover + name +
  count + ▶ Play all) over that facet's tracks, reusing the existing filter/sort.
- **Output & technical panel** in the download view — a collapsible section above
  Download/New holding the export **format** (with a `source → target` preview),
  **Turbo Render** (moved here from the effects grid), the **tag separator**, and
  the **filename**.
- **Editable filename** — a ✎ custom toggle overrides the auto-generated name; the
  extension still follows the export format (`/save?custom_filename=`).
- **Multi-value Composer + custom tags** — Composer and every custom tag are now
  chip inputs (type + Enter → chip) with per-value autocomplete; suggestions are
  individual tokens (e.g. `Emotion: [Sad] [Angry]`, not the joined string).
  Stored delimiter-joined, so the DB/embedding are unchanged; `suggest_values`
  splits stored values into distinct tokens.

### Changed
- **Generate mixes now renders in background** with a queue + `N/total`
  progress; each chip appears only when its render finishes (cached, instant
  click). Clear stops the queue; further Generates append to it.
- **Turbo Render** moved from the effects grid to a header toggle beside
  Original (not treated as an effect). Effects grid is now a clean 2×2:
  Loudness, EQ, Enhance, Trim Silence.
- **Loudness labels** replaced LUFS numbers with friendly names: Loud /
  Normal / Quiet — everywhere (effects panel, Generate modal, Mix chips,
  library FX editor).
- **Album, Year, Composer, and custom-tag suggestions** migrated from native
  `<datalist>` to styled floating dropdowns (matching Artist/Genre) — opens on
  focus/tap, arrow-key nav, works on mobile.
- **Export format** shown as a single row with inline editable filename (✎ to
  edit, ↺ to revert to auto-generated name).
- **Tag separator** moved below the cover Upload/Reset buttons; Album field
  restored to full width.
- **Generate dialog** pills are now `white-space:nowrap` with proper hover and
  checked states. Removed Off/None options — leaving a row untouched keeps
  that effect off.

### Fixed
- Custom-tag value suggestions open on mobile tap (native `<datalist>` didn't).
- Tag separator input no longer triggers browser autofill.
- Generate dialog: opaque (was see-through), tidy layout, enhance "Off" was
  mislabeled "None".
- Export options panel: shorter title, label beside control, filename
  width-capped.
- "File Saved" toast no longer looks boxy on mobile.
- **Mix switch double-fire** — `applyParamsToControls` would trigger
  `onEffectChange` through control change events, causing a second
  `playPreview` call. Added `_applyingSnapshot` guard and stale-debounce
  cleanup (`clearTimeout` in `loadSnapshot`).
- **Gapless mix switching** — the preview uses two ping-ponging `<audio>`
  elements: the active one keeps playing while the idle one buffers AND seeks
  the newly selected mix; the swap is a hard cut performed only once the new
  element actually emits audio (its `playing` event). This finally removes the
  load gap, the doubled/echoed audio, and the desync that the single-element
  swap and the volume-crossfade attempts both produced.
- **Mix switch no longer restarts from 0 / ignores the start point** — the new
  element is seeked to `max(range start, current position)` and playback only
  begins after the seek lands, so first play honors the silence-trim/selected
  start and switches resume in place.
- **`/stream` concurrent renders** — each request renders to a unique temp file
  (`…rendering.<pid>.<uuid>.flac`); the first to finish publishes the result,
  the rest reuse it. Fixes the `FileNotFoundError` on `os.replace` when several
  `/stream` calls for the same mix raced (common now that two audio elements
  request in parallel).

## [2.2.3] - 2026-06-09

### Changed
- **Migrated to `pyproject.toml`** (PEP 621) for dependency management — replaces
  `requirements.txt`. Docker installs via `pip install .` directly.
- **Modularized frontend** — split monolithic 5089-line `index.html` into
  `style.css` + 8 focused JS files. Added FastAPI `StaticFiles` mount.
  Added `AGENTS.md` with code map.

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

[Unreleased]: https://github.com/sakhund/youtify/compare/v2.2.3...HEAD
[2.2.3]: https://github.com/sakhund/youtify/compare/v2.2.2...v2.2.3
[2.2.2]: https://github.com/sakhund/youtify/compare/v2.2.1...v2.2.2
[2.2.1]: https://github.com/sakhund/youtify/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/sakhund/youtify/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/sakhund/youtify/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/sakhund/youtify/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/sakhund/youtify/releases/tag/v1.0.0
