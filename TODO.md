# TODO

## Done
- [x] 1. Queue system — user-curated play queue ("Play next" / "Add to queue" + Up-next panel in the player).
- [x] 2. Sleep timer — off / 15 / 30 / 60 min / end-of-track (moon button in the player).
- [x] 3. Zen/Firefox media controls — hardened (metadata/handlers re-applied after user-initiated play, artwork MIME types, try/catch). Remaining limitation is the browser's: Zen/hardened profiles need `media.hardwaremediakeys.enabled=true` in about:config.
- [x] 4. Generate modal loudness labels — moot, Generate removed (see 24).
- [x] 7. Editable facet thumbnails (Album/Artist/Genre/Year) + artist default image pulled from the YouTube channel pfp at save time.
- [x] 8. Chip UX — long chips ellipsize (full value in tooltip), key field narrower than value, × shows on hover, delete needs a confirming second click (chip turns red).
- [x] 9. 'value…' placeholder hidden once a chip is present.
- [x] 10. Fast preview option — 128k MP3 previews (toggle next to Turbo) instead of lossless FLAC.
- [x] 13. Library metadata editor — artists/genres/albums are chip inputs and the tag separator setting is respected (was hardcoded '|').
- [x] 14. Composer field removed — it's a normal custom tag now (backend still maps it to TPE3/COMPOSER).
- [x] 15. Stuck suggestion dropdowns — global outside-click + Escape dismissal.
- [x] 16. 'New' button — resets the form in place instead of reloading (reload landed on Library in server-save mode).
- [x] 17. Stats — play count, last played, date added (sortable; in row tooltip; stored in sidecars so they survive DB rebuilds).
- [x] 18. Favorites — heart per row/player/kebab, favorites-only toggle, `favorite` filter field (works in dynamic playlists).
- [x] 19/20. Custom-tag preset keys (Emotion, Mood, Language, BPM, …) as a guide; Emotion is the default row on new downloads.
- [x] 21. Copy metadata from another song — "Copy from…" picker in both editors.
- [x] 22. Album is multi-value — first value saved as canonical `ALBUM` (Jellyfin-compatible), full list as `ALBUMS`.
- [x] 23. Browse-by grids capped at 4 cards + "See all N" / "Show less".
- [x] 24. Generate option + queue removed.

## Deferred (next round)
- [ ] 11. Spotify as a source — DRM means actual audio would come from YouTube matched via Spotify metadata (spotdl-style). Decide if wanted.
- [ ] 12. Universal scraper — yt-dlp already supports 1000+ sites; main work is relaxing the YouTube-only URL whitelist (`youtube_downloader.py` `validate_youtube_url`) and dropping the 11-char ID assumption.
