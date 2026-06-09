            // --- Range Slider Logic ---
            function initRangeSlider(duration) {
                videoDuration = duration;
                els.startSlider.max = duration;
                els.endSlider.max = duration;
                els.startSlider.value = 0;
                els.endSlider.value = duration;
                els.totalDisplay.textContent = formatTime(duration);
                updateRangeUI();
            }

            function updateRangeUI() {
                const MIN_DURATION = 10; // Minimum 10 seconds
                let start = parseFloat(els.startSlider.value);
                let end = parseFloat(els.endSlider.value);

                // 1. Constrain to silence boundaries if enabled
                if (els.trimSilenceToggle.checked) {
                    const minAllowed = silenceInfo.leading || 0;
                    const maxAllowed = videoDuration - (silenceInfo.trailing || 0);

                    if (start < minAllowed) {
                        start = minAllowed;
                        els.startSlider.value = start;
                    }
                    if (end > maxAllowed) {
                        end = maxAllowed;
                        els.endSlider.value = end;
                    }
                }

                // 2. Enforce minimum duration of 10 seconds (respecting boundaries)
                if (end - start < MIN_DURATION) {
                    const minAllowed = els.trimSilenceToggle.checked ? (silenceInfo.leading || 0) : 0;
                    const maxAllowed = els.trimSilenceToggle.checked ? (videoDuration - (silenceInfo.trailing || 0)) : videoDuration;

                    if (start + MIN_DURATION <= maxAllowed) {
                        end = start + MIN_DURATION;
                        els.endSlider.value = end;
                    } else {
                        start = Math.max(minAllowed, end - MIN_DURATION);
                        els.startSlider.value = start;
                    }
                }

                // Simple percentage positioning - inner track is already inset to match thumb centers
                const startPct = (start / videoDuration) * 100;
                const endPct = (end / videoDuration) * 100;
                els.sliderRange.style.left = startPct + '%';
                els.sliderRange.style.width = (endPct - startPct) + '%';
                // Only overwrite the input text when it's not being edited (avoids
                // fighting the user mid-type).
                if (document.activeElement !== els.startDisplay) els.startDisplay.value = formatTime(start);
                if (document.activeElement !== els.endDisplay) els.endDisplay.value = formatTime(end);

                // Range changes no longer stop playback (full-file model). Just keep
                // the playhead inside the new window.
                if (!previewAudio.paused) {
                    const cur = previewAudio.currentTime;
                    if (cur < start || cur > end) {
                        try { previewAudio.currentTime = start; } catch (e) { }
                    }
                }
            }

            function formatTime(seconds) {
                if (isNaN(seconds)) return "00:00";
                const h = Math.floor(seconds / 3600);
                const m = Math.floor((seconds % 3600) / 60);
                const s = Math.floor(seconds % 60);
                if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            }

            els.startSlider.addEventListener('input', updateRangeUI);
            els.endSlider.addEventListener('input', updateRangeUI);

            // Click-to-seek: jump the playhead anywhere on the track. Direct seek,
            // since the preview is the full file (currentTime == timeline).
            els.sliderWrapper.addEventListener('click', (e) => {
                if (e.target === els.startSlider || e.target === els.endSlider) return;
                const rect = els.sliderTrack.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const t = pct * videoDuration;
                els.playbackPointer.style.display = 'block';
                els.playbackPointer.style.left = (pct * 100) + '%';
                els.currentTimeDisplay.textContent = formatTime(t);
                if (currentSrc) { try { previewAudio.currentTime = t; } catch (e) { } }
            });

            // Manual time editing — accepts ss, mm:ss, or h:mm:ss; clamps; reformats.
            function parseTimeInput(str) {
                const parts = str.split(':').map(p => parseInt(p, 10));
                if (parts.some(isNaN)) return null;
                let secs;
                if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
                else if (parts.length === 2) secs = parts[0] * 60 + parts[1];
                else secs = parts[0];
                return secs;
            }
            [els.startDisplay, els.endDisplay].forEach((el, idx) => {
                const commit = () => {
                    let secs = parseTimeInput(el.value.trim());
                    if (secs == null) {  // invalid -> restore from slider
                        el.value = formatTime(idx === 0 ? rangeStart() : rangeEnd());
                        return;
                    }
                    secs = Math.max(0, Math.min(videoDuration, secs));
                    if (idx === 0) {
                        els.startSlider.value = Math.min(secs, rangeEnd() - 1);
                    } else {
                        els.endSlider.value = Math.max(secs, rangeStart() + 1);
                    }
                    updateRangeUI();
                    // NB: do NOT re-run silence analysis here. Silence offsets
                    // depend only on the source + threshold, not the chosen
                    // range, so editing Start/End must not trigger /silence-info
                    // (that re-ran an ffmpeg scan on every blur — the lag).
                };
                el.addEventListener('blur', commit);
                el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
                el.addEventListener('focus', () => el.select());
            });

            async function updateSilenceVisualization() {
                if (!els.trimSilenceToggle.checked || (!els.urlInput.value && !currentSourceId)) {
                    silenceInfo = { leading: 0, trailing: 0 };
                    els.silenceStartOverlay.style.width = '0';
                    els.silenceEndOverlay.style.width = '0';
                    updateRangeUI();
                    return;
                }

                try {
                    const sp = new URLSearchParams({ silence_thresh: els.silenceThreshSelect.value });
                    setSourceParam(sp);
                    const res = await fetch(`/silence-info?${sp.toString()}`);
                    if (res.ok) {
                        const data = await res.json();
                        silenceInfo = { leading: data.leading_silence, trailing: data.trailing_silence };

                        const startPct = (silenceInfo.leading / videoDuration) * 100;
                        const endPct = (silenceInfo.trailing / videoDuration) * 100;

                        els.silenceStartOverlay.style.width = startPct + '%';
                        els.silenceEndOverlay.style.width = endPct + '%';

                        // Snap slider thumbs to silence boundaries
                        const newStart = silenceInfo.leading;
                        const newEnd = videoDuration - silenceInfo.trailing;

                        // Only snap if it results in valid range (min 10 seconds)
                        if (newEnd - newStart >= 10) {
                            els.startSlider.value = newStart;
                            els.endSlider.value = newEnd;
                        }
                    }
                    updateRangeUI();
                } catch (e) {
                    console.error("Silence info fetch failed", e);
                    updateRangeUI();
                }
            }

            els.trimSilenceToggle.addEventListener('change', updateSilenceVisualization);
            els.silenceThreshSelect.addEventListener('change', updateSilenceVisualization);

            // When an effect changes: if playing, re-render the preview live at the
            // current position; otherwise the next Play picks it up. Clears any
            // active A/B snapshot selection (you're now on the live controls).
            let fxRerenderTimer = null;
            function onEffectChange() {
                if (_applyingSnapshot) return;
                // Re-render whenever there's PLAYBACK INTENT — i.e. we're playing OR
                // a render is still in flight (during which previewAudio.paused is
                // true because load() paused it). Checking only `!paused` dropped
                // changes made mid-render, so you had to pause+play to apply them.
                const playingIntent = isStreaming || !previewAudio.paused;
                if (playingIntent) {
                    // Debounce: dragging Low->Mid->High should fire ONE render, not
                    // three. switchToken already makes the last load win, so the
                    // interrupted in-flight renders are simply ignored on arrival.
                    clearTimeout(fxRerenderTimer);
                    fxRerenderTimer = setTimeout(() => {
                        const p = effectParams();
                        recordSnapshot(p);   // keep A/B consistent with playback
                        renderSnapshots();
                        playPreview(previewUrlFrom(p), previewAudio.currentTime);
                    }, 250);
                } else {
                    // Not playing: no audio heard yet, so don't snapshot — just drop
                    // the active highlight (controls no longer match a saved combo).
                    activeSnapshotId = null;
                    renderSnapshots();
                }
            }

            // NB: originalToggle is NOT here — it has its own change handler that
            // already calls onEffectChange (binding both fired it twice and raced
            // two crossfades, so the audio didn't follow the selected mix).
            [els.normalizeToggle, els.normalizeISelect, els.eqToggle, els.eqPresetSelect,
            els.mbcToggle, els.mbcPresetSelect, els.enhanceModeSelect, els.enhanceIntensitySelect
            ].forEach(el => {
                if (el) el.addEventListener('change', onEffectChange);
            });

            // --- Audio Preview ---
            // The preview plays the FULL processed track (effects only). Range +
            // silence are applied only on export, so the playhead = currentTime
            // maps 1:1 to the timeline and seeking/looping is trivial.
            let currentSrc = '';   // /stream URL currently loaded (per effect set)

            // --- Single-element preview player ---
            // One <audio> (els.previewAudio). Switching combos swaps the src and
            // resumes at the captured position. Simple and reliable: it always
            // switches and never spuriously restarts. (A brief load gap is fine —
            // already-rendered combos are cached so it's near-instant.)
            const previewAudio = els.previewAudio;

            previewAudio.addEventListener('error', () => {
                if (!previewAudio.src || previewAudio.src === window.location.href) return;
                showError("Preview error: " + (previewAudio.error ? previewAudio.error.message : "source failure"));
                isStreaming = false;
                stopPlayback();
            });
            previewAudio.addEventListener('playing', () => {
                isStreaming = false;
                setLoading(els.previewBtn, false);
                els.previewBtn.classList.add('playing');
                els.previewBtn.dataset.loading = "";
                setIcon(els.previewBtn, 'pause');
                els.playbackPointer.style.display = 'block';
            });
            previewAudio.addEventListener('loadedmetadata', () => {
                els.totalDisplay.textContent = formatTime(videoDuration || previewAudio.duration);
            });
            // Playhead + in-range looping driven by the audio clock.
            previewAudio.addEventListener('timeupdate', () => {
                const cur = previewAudio.currentTime;
                if (!videoDuration) return;
                const end = rangeEnd();
                if (cur >= end - 0.04) { try { previewAudio.currentTime = rangeStart(); } catch (e) { } return; }
                const pct = Math.min(cur, videoDuration) / videoDuration * 100;
                els.playbackPointer.style.left = pct + '%';
                els.currentTimeDisplay.textContent = formatTime(cur);
            });
            previewAudio.addEventListener('pause', () => {
                els.previewBtn.classList.remove('playing');
                setIcon(els.previewBtn, 'play');
            });
            previewAudio.addEventListener('ended', () => {
                try { previewAudio.currentTime = rangeStart(); previewAudio.play(); } catch (e) { stopPlayback(); }
            });

            // --- OS media integration for the download preview ---
            // The library player wires libAudio the same way; only one element
            // plays at a time, so whichever last hit play() owns the OS session.
            // Preview has no track list, so no prev/next — just metadata + play/
            // pause/seek so it shows on the lock screen / desktop media widget.
            function updatePreviewMediaSession() {
                if (!('mediaSession' in navigator)) return;
                const art = [];
                const src = els.metaThumb && els.metaThumb.src;
                // Only attach real cover art (skip empty / the page URL placeholder).
                if (src && src !== window.location.href && !src.endsWith('/')) {
                    ['96x96', '256x256', '512x512'].forEach(s => art.push({ src, sizes: s }));
                }
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: (els.metaTitle && els.metaTitle.value) || 'Youtify preview',
                    artist: selectedArtists.join(', '),
                    album: (els.metaAlbum && els.metaAlbum.value) || '',
                    artwork: art,
                });
            }
            function updatePreviewPositionState() {
                if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
                const d = previewAudio.duration;
                if (!d || !isFinite(d)) return;
                try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(previewAudio.currentTime, d), playbackRate: previewAudio.playbackRate || 1 }); } catch (e) { }
            }
            if ('mediaSession' in navigator) {
                const ms = navigator.mediaSession;
                const claimSession = () => {
                    const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch (e) { } };
                    set('play', () => previewAudio.play());
                    set('pause', () => previewAudio.pause());
                    set('previoustrack', null);
                    set('nexttrack', null);
                    set('seekto', d => { if (d && d.seekTime != null) { previewAudio.currentTime = d.seekTime; updatePreviewPositionState(); } });
                    set('seekbackward', d => { previewAudio.currentTime = Math.max(0, previewAudio.currentTime - ((d && d.seekOffset) || 10)); });
                    set('seekforward', d => { previewAudio.currentTime = Math.min(previewAudio.duration || 1e9, previewAudio.currentTime + ((d && d.seekOffset) || 10)); });
                    updatePreviewMediaSession();
                };
                previewAudio.addEventListener('play', () => { claimSession(); ms.playbackState = 'playing'; });
                previewAudio.addEventListener('pause', () => { ms.playbackState = 'paused'; });
                previewAudio.addEventListener('loadedmetadata', updatePreviewPositionState);
                previewAudio.addEventListener('timeupdate', updatePreviewPositionState);
            }

            function rangeStart() { return parseFloat(els.startSlider.value) || 0; }
            function rangeEnd() { return parseFloat(els.endSlider.value) || videoDuration; }

            // Effect set sent to /stream (NO range/silence — those are export-only).
            function effectParams() {
                const eq = els.eqToggle && els.eqToggle.checked ? els.eqPresetSelect.value : '';
                const mbc = els.mbcToggle && els.mbcToggle.checked ? els.mbcPresetSelect.value : '';
                const enh = els.enhanceModeSelect.value;
                const norm = els.normalizeToggle.checked;
                // No EQ/compression/enhance/normalize == acoustically identical to
                // "Original". Collapse it so untoggling Original (before adding any
                // FX) doesn't spawn a redundant 'Dry (no FX)' chip or re-encode.
                const anyFx = !!eq || !!mbc || !!enh || norm;
                return {
                    eq_preset: eq,
                    mbc_preset: mbc,
                    enhance_mode: enh,
                    enhance_intensity: els.enhanceIntensitySelect.value,
                    normalize: norm,
                    normalize_i: els.normalizeISelect.value,
                    original: els.originalToggle.checked || !anyFx
                };
            }

            // Set either source_id (uploaded/cached) or url (YouTube) on a params obj.
            function setSourceParam(params) {
                if (currentSourceId) params.set('source_id', currentSourceId);
                else params.set('url', els.urlInput.value.trim());
            }
            function previewUrlFrom(p) {
                const params = new URLSearchParams({
                    eq_preset: p.eq_preset || '',
                    mbc_preset: p.mbc_preset || '',
                    enhance_mode: p.enhance_mode || '',
                    enhance_intensity: p.enhance_intensity,
                    normalize: p.normalize,
                    normalize_i: p.normalize_i,
                    original: p.original,
                    turbo: !!(els.turboToggle && els.turboToggle.checked)
                });
                setSourceParam(params);
                return `/stream?${params.toString()}`;
            }

            let switchToken = 0;   // ignore stale canplay handlers when switching fast

            // Play `url`, resuming at `seekTo` (defaults to range start). Switching
            // combos swaps the src and seeks back to the captured position.
            function playPreview(url, seekTo) {
                const startAt = (seekTo != null) ? seekTo : rangeStart();

                // Same combo already loaded -> just (re)play it in place.
                if (url === currentSrc && previewAudio.src) {
                    try { if (Math.abs(previewAudio.currentTime - startAt) > 0.3) previewAudio.currentTime = startAt; } catch (e) { }
                    const pr = previewAudio.play();
                    if (pr) pr.catch(e => { if (e.name !== 'AbortError') { showError('Playback failed: ' + e.message); stopPlayback(); } });
                    return;
                }

                // Resume where we are now (keep position across an effect/mix switch),
                // but NEVER before the selected range start. Without this clamp, an
                // effect change made before playback actually began (first combo still
                // loading, so currentTime is still 0) resumes at 0 and ignores the
                // silence-trimmed range.
                let resumeAt = (previewAudio.src && previewAudio.currentTime > 0) ? previewAudio.currentTime : startAt;
                const rStart = rangeStart();
                if (!(resumeAt >= rStart)) resumeAt = rStart;
                const myToken = ++switchToken;
                currentSrc = url;
                isStreaming = true;
                setLoading(els.previewBtn, true);
                els.previewBtn.dataset.loading = 'true';

                let started = false;
                const begin = () => {
                    if (started || myToken !== switchToken) return;
                    started = true;
                    const target = () => {
                        const dur = previewAudio.duration;
                        let at = resumeAt;
                        if (dur && isFinite(dur)) at = Math.min(at, dur - 0.3);
                        return (at >= 0) ? at : 0;
                    };
                    const doPlay = () => {
                        if (myToken !== switchToken) return;
                        const pr = previewAudio.play();
                        if (pr) pr.catch(e => { if (e.name !== 'AbortError') { showError('Playback failed: ' + e.message); stopPlayback(); } });
                    };
                    let tries = 0;
                    const ensureSeek = () => {
                        if (myToken !== switchToken) return true;
                        const at = target();
                        if (at <= 0.25) return true;
                        if (Math.abs(previewAudio.currentTime - at) <= 0.4) return true;
                        if (previewAudio.seekable && previewAudio.seekable.length) {
                            try { previewAudio.currentTime = at; } catch (e) { }
                        }
                        return (++tries > 25);
                    };
                    if (ensureSeek()) {
                        doPlay();
                    } else {
                        const iv = setInterval(() => { if (ensureSeek()) { clearInterval(iv); doPlay(); } }, 100);
                        ['seeked', 'canplaythrough'].forEach(ev =>
                            previewAudio.addEventListener(ev, () => { if (ensureSeek()) { clearInterval(iv); doPlay(); } }, { once: true }));
                    }
                };
                // Seek only once duration is known (loadedmetadata) so the range is valid.
                previewAudio.addEventListener('loadedmetadata', begin, { once: true });
                previewAudio.addEventListener('canplay', begin, { once: true });
                previewAudio.src = url;
                previewAudio.load();
                if (previewAudio.readyState >= 1) begin();
            }

            els.previewBtn.addEventListener('click', () => {
                if (els.previewBtn.disabled) return;
                if (!previewAudio.paused) { previewAudio.pause(); return; }
                const p = effectParams();
                const url = previewUrlFrom(p);
                const resume = (currentSrc === url && previewAudio.currentTime > 0);
                recordSnapshot(p);   // A/B: remember this combo (sets it active)
                renderSnapshots();
                playPreview(url, resume ? previewAudio.currentTime : rangeStart());
            });

            function stopPlayback() {
                isStreaming = false;
                try { previewAudio.pause(); } catch (e) { }
                els.previewBtn.classList.remove('playing');
                els.previewBtn.dataset.loading = "";
                setLoading(els.previewBtn, false);
                setIcon(els.previewBtn, 'play');
                els.playbackPointer.style.display = 'none';
                els.currentTimeDisplay.textContent = "00:00";
            }

