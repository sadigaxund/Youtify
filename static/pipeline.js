            // --- Pipeline Progress Helpers ---
            function setPipelineStep(step, state) {
                // step: 'cache' or 'process'
                // state: 'idle', 'active', 'done'
                const el = step === 'cache' ? els.stepCache : els.stepProcess;
                const iconEl = step === 'cache' ? els.stepCacheIcon : els.stepProcessIcon;
                const labelEl = step === 'cache' ? els.stepCacheLabel : els.stepProcessLabel;

                el.classList.remove('active', 'done');
                iconEl.classList.remove('spin');

                if (state === 'active') {
                    el.classList.add('active');
                    iconEl.setAttribute('data-lucide', 'loader-2');
                    iconEl.classList.add('spin');
                    labelEl.textContent = step === 'cache' ? 'Caching…' : 'Processing…';
                } else if (state === 'done') {
                    el.classList.add('done');
                    iconEl.setAttribute('data-lucide', 'check-circle-2');
                    labelEl.textContent = step === 'cache' ? 'Cached' : 'Done';
                } else {
                    iconEl.setAttribute('data-lucide', step === 'cache' ? 'download-cloud' : 'cpu');
                    labelEl.textContent = step === 'cache' ? 'Cache' : 'Process';
                }
                lucide.createIcons({ nodes: [iconEl] });
            }

            // Sets the bar width + numeric % + status label in one place.
            // The bar is split 0-50% = cache phase, 50-100% = process phase.
            function setPipelineProgress(barPct, label) {
                barPct = Math.max(0, Math.min(100, barPct));
                els.pipelineFill.style.width = barPct + '%';
                els.pipelinePct.textContent = Math.round(barPct) + '%';
                if (label !== undefined) els.pipelineLabel.textContent = label;
            }

            function showPipeline() {
                els.pipelineProgress.style.display = 'flex';
                setPipelineProgress(0, 'Preparing…');
                setPipelineStep('cache', 'idle');
                setPipelineStep('process', 'idle');
                els.pipelineConnector.classList.remove('done');
            }

            function hidePipeline() {
                els.pipelineProgress.style.display = 'none';
            }

            function startCachePoll(url) {
                isCached = false;
                if (cachePollTimer) clearInterval(cachePollTimer);
                showPipeline();
                setPipelineStep('cache', 'active');
                setPipelineProgress(2, 'Caching audio…');

                cachePollTimer = setInterval(async () => {
                    try {
                        const res = await fetch(`/cache-status?url=${encodeURIComponent(url)}`);
                        const data = await res.json();
                        // Map cache download 0-100% onto the first half of the bar.
                        if (!data.cached) {
                            setPipelineProgress((data.progress || 0) * 0.5, 'Caching audio…');
                        }
                        if (data.cached) {
                            isCached = true;
                            clearInterval(cachePollTimer);
                            cachePollTimer = null;
                            setPipelineStep('cache', 'done');
                            els.pipelineConnector.classList.add('done');
                            setPipelineProgress(50, 'Cached — ready');
                        }
                    } catch (e) { /* silently retry */ }
                }, 600);
            }

            // --- Process flow ---
            els.downloadBtn.addEventListener('click', async () => {
                if (!currentSourceId && !els.urlInput.value.trim()) { showError('Please enter a YouTube URL or upload a file'); return; }
                stopPlayback();
                session_id = Math.random().toString(36).substring(7);
                els.downloadBtn.disabled = true;
                els.success.style.display = 'none';

                // Show pipeline progress
                showPipeline();
                if (isCached) {
                    // Cache already done from search
                    setPipelineStep('cache', 'done');
                    els.pipelineConnector.classList.add('done');
                    setPipelineProgress(50, 'Processing audio…');
                    setPipelineStep('process', 'active');
                } else {
                    // Cache still in progress
                    setPipelineStep('cache', 'active');
                    setPipelineProgress(2, 'Caching audio…');
                }

                const params = new URLSearchParams({
                    start_time: els.startSlider.value,
                    end_time: els.endSlider.value,
                    trim_silence: els.trimSilenceToggle.checked,
                    silence_thresh: els.silenceThreshSelect.value,
                    eq_preset: els.eqToggle && els.eqToggle.checked ? els.eqPresetSelect.value : '',
                    mbc_preset: els.mbcToggle && els.mbcToggle.checked ? els.mbcPresetSelect.value : '',
                    enhance_mode: els.enhanceModeSelect.value,
                    enhance_intensity: els.enhanceIntensitySelect.value,
                    normalize: els.normalizeToggle.checked,
                    normalize_i: els.normalizeISelect.value,
                    original: els.originalToggle.checked,
                    output_format: els.formatSelect ? els.formatSelect.value : 'auto',
                    session_id: session_id,
                    delimiter: els.delimiterInput.value || '|'
                });
                setSourceParam(params);

                // Add metadata params
                if (els.metaTitle.value.trim()) params.set('meta_title', els.metaTitle.value.trim());
                if (els.metaArtist.value.trim()) params.set('meta_artist', els.metaArtist.value.trim());
                if (els.metaAlbum.value.trim()) params.set('meta_album', els.metaAlbum.value.trim());
                if (els.metaGenre.value.trim()) params.set('meta_genre', els.metaGenre.value.trim());
                if (els.metaYear.value.trim()) params.set('meta_year', els.metaYear.value.trim());

                // Custom tags + cover go in the POST body (a base64 image is far
                // too large for the query string and would abort the request).
                const metadataExtra = {};
                const customTags = getCustomTags(els.customTagsContainer);
                if (customTags.length > 0) metadataExtra.custom_tags = customTags;
                if (customThumbnailBase64) metadataExtra.thumbnail_base64 = customThumbnailBase64;
                const saveBody = JSON.stringify({
                    metadata_json: Object.keys(metadataExtra).length > 0 ? JSON.stringify(metadataExtra) : null
                });

                let downloadTriggered = false; // Prevent multiple download triggers

                const poll = setInterval(async () => {
                    try {
                        const res = await fetch(`/progress/${session_id}`);
                        const data = await res.json();

                        if (data.status === 'caching') {
                            // Cache phase: map 0-100 onto the first half of the bar.
                            setPipelineStep('cache', 'active');
                            setPipelineProgress((data.progress || 0) * 0.5, `Caching audio… ${Math.round(data.progress || 0)}%`);
                        } else if (data.status === 'processing') {
                            // Cache finished, processing phase: second half of the bar.
                            if (!isCached) {
                                isCached = true;
                                setPipelineStep('cache', 'done');
                                els.pipelineConnector.classList.add('done');
                            }
                            setPipelineStep('process', 'active');
                            setPipelineProgress(50 + (data.progress || 0) * 0.5, `Processing audio… ${Math.round(data.progress || 0)}%`);
                        } else if (data.status === 'finished' && !downloadTriggered) {
                            downloadTriggered = true;
                            clearInterval(poll);
                            els.downloadBtn.disabled = false;

                            // Mark everything as done
                            setPipelineStep('cache', 'done');
                            setPipelineStep('process', 'done');
                            els.pipelineConnector.classList.add('done');
                            setPipelineProgress(100, 'Done');

                            // Check if browser download mode
                            if (data.browser_download && data.path) {
                                const downloadUrl = `/download-file?path=${encodeURIComponent(data.path)}&filename=${encodeURIComponent(data.filename)}`;
                                const a = document.createElement('a');
                                a.href = downloadUrl;
                                a.download = data.filename;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                showToast(`Downloading: ${data.filename}`);
                            } else {
                                els.success.style.display = 'block';
                                showToast(data.path);
                            }
                        } else if (data.status === 'error') {
                            clearInterval(poll);
                            showError(data.message);
                            els.downloadBtn.disabled = false;
                            hidePipeline();
                        }
                    } catch (e) { }
                }, 500);

                try {
                    const res = await fetch(`/save?${params.toString()}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: saveBody
                    });
                    if (!res.ok) throw new Error(await res.text());
                } catch (err) {
                    showError(err.message);
                    els.downloadBtn.disabled = false;
                    clearInterval(poll);
                    hidePipeline();
                }
            });

            els.uploadNextBtn.addEventListener('click', () => location.reload());

            // Clear this session's preview "mix" renders from the SSD cache when
            // the page is closed/reloaded (the source cache is kept). The 2h
            // server-side sweep is the backstop for abandoned tabs.
            window.addEventListener('beforeunload', () => {
                const u = (els.urlInput.value || '').trim();
                if (u) navigator.sendBeacon('/preview-cache/clear?url=' + encodeURIComponent(u));
            });
