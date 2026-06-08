            // --- Search Flow ---
            // Treat input as a URL/ID when it looks like one; otherwise search.
            function looksLikeYouTube(s) {
                return /(?:youtube\.com|youtu\.be)/i.test(s);
            }
            function hideSearchResults() {
                els.searchResults.style.display = 'none';
                els.searchResults.innerHTML = '';
            }
            function fmtSrDur(s) {
                if (!s && s !== 0) return '';
                s = Math.round(s); const m = Math.floor(s / 60), r = s % 60;
                return `${m}:${String(r).padStart(2, '0')}`;
            }
            function renderSearchResults(list) {
                const box = els.searchResults; box.innerHTML = '';
                if (!list.length) { box.style.display = 'none'; showError('No results'); return; }
                list.forEach(r => {
                    const row = document.createElement('div'); row.className = 'sr-row';
                    const img = document.createElement('img'); img.loading = 'lazy'; img.alt = '';
                    img.src = r.thumbnail || '';
                    const info = document.createElement('div'); info.className = 'sr-info';
                    const t = document.createElement('div'); t.className = 'sr-ttl'; t.textContent = r.title || r.video_id; t.title = t.textContent;
                    const sub = document.createElement('div'); sub.className = 'sr-sub';
                    sub.textContent = [r.author, fmtSrDur(r.duration)].filter(Boolean).join('  ·  ');
                    info.append(t, sub);
                    row.append(img, info);
                    row.addEventListener('click', () => runSearch(r.url));
                    box.appendChild(row);
                });
                box.style.display = 'flex';
            }
            async function doYtSearch(q) {
                hideSearchResults();
                if (els.dropZone) els.dropZone.style.display = 'none';
                setLoading(els.searchBtn, true);
                try {
                    const res = await fetch('/yt-search?q=' + encodeURIComponent(q));
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data.detail || 'Search failed');
                    renderSearchResults(data.results || []);
                } catch (e) { showError(e.message); }
                finally { setLoading(els.searchBtn, false); }
            }

            els.searchBtn.addEventListener('click', () => {
                const q = els.urlInput.value.trim();
                if (!q) { showError("Enter a YouTube URL or search terms"); return; }
                if (looksLikeYouTube(q)) runSearch(q);
                else doYtSearch(q);
            });
            els.urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); els.searchBtn.click(); } });

            // --- File upload (use a local file instead of YouTube) ---
            async function uploadLocalFile(file) {
                if (!file) return;
                hideSearchResults();
                setLoading(els.searchBtn, true);
                if (els.dropZone) els.dropZone.classList.add('busy');
                try {
                    const fd = new FormData();
                    fd.append('file', file);
                    const res = await fetch('/upload', { method: 'POST', body: fd });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data.detail || 'Upload failed');
                    onSourceReady(data, { isUpload: true });
                } catch (e) {
                    showError(e.message);
                } finally {
                    setLoading(els.searchBtn, false);
                    if (els.dropZone) els.dropZone.classList.remove('busy');
                }
            }
            if (els.dropZone) {
                els.dropZone.addEventListener('click', () => els.fileInputSrc.click());
                els.fileInputSrc.addEventListener('change', e => {
                    if (e.target.files && e.target.files[0]) uploadLocalFile(e.target.files[0]);
                    e.target.value = '';
                });
                ['dragenter', 'dragover'].forEach(ev => els.dropZone.addEventListener(ev, e => {
                    e.preventDefault(); els.dropZone.classList.add('drag');
                }));
                ['dragleave', 'drop'].forEach(ev => els.dropZone.addEventListener(ev, e => {
                    e.preventDefault(); els.dropZone.classList.remove('drag');
                }));
                els.dropZone.addEventListener('drop', e => {
                    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                    if (f) uploadLocalFile(f);
                });
            }

            async function runSearch(url) {
                els.urlInput.value = url;      // downstream /stream + /save read this field
                hideSearchResults();
                setLoading(els.searchBtn, true);

                try {
                    const res = await fetch(`/search?url=${encodeURIComponent(url)}`);
                    if (!res.ok) {
                        let errText = await res.text();
                        try { errText = JSON.parse(errText).detail || errText; } catch (e) { }
                        throw new Error(errText);
                    }
                    const data = await res.json();
                    onSourceReady(data, { url });
                } catch (err) {
                    showError(err.message);
                } finally {
                    setLoading(els.searchBtn, false);
                }
            }

            // Populate the editor + reveal preview/options for a resolved source —
            // a YouTube video (from /search) OR an uploaded file (from /upload).
            function onSourceReady(data, opts = {}) {
                const isUpload = !!(opts.isUpload || data.is_upload);
                currentVideoId = data.video_id;
                currentSourceId = isUpload ? data.video_id : null;
                // Source format + losslessness drive the Output panel + Auto export.
                currentSourceLossless = !!data.lossless;
                currentSrcLabel = isUpload ? String(data.src_ext || 'file').toUpperCase() : 'YouTube';

                originalThumbnailUrl = data.thumbnail || '';
                els.metaThumb.src = data.thumbnail || '';
                els.metaTitle.value = data.title || '';
                selectedArtists = data.author ? [data.author] : [];
                renderArtistTags();
                els.metaAlbum.value = data.album || '';
                selectedGenres = data.genre ? String(data.genre).split(/[|,;]/).map(g => g.trim()).filter(Boolean) : [];
                renderGenreTags();
                // Uploaded files may carry an embedded cover (a data: URL) — keep it
                // as the base64 cover so it's re-embedded on save.
                customThumbnailBase64 = (data.thumbnail && data.thumbnail.startsWith('data:'))
                    ? data.thumbnail.split(',')[1] : null;
                els.customTagsContainer.innerHTML = '';
                addCustomTag(els.customTagsContainer, 'Composer', data.composer || '');

                // Year: uploads carry it directly; YouTube gives upload_date YYYYMMDD.
                if (isUpload) {
                    els.metaYear.value = data.year || '';
                } else if (data.upload_date && data.upload_date.length >= 4) {
                    els.metaYear.value = data.upload_date.substring(0, 4);
                } else {
                    els.metaYear.value = '';
                }

                els.preview.style.display = 'flex';
                els.optionsPanel.style.display = 'grid';
                document.getElementById('actionBar').style.display = 'flex';
                if (els.techPanel) els.techPanel.style.display = 'block';
                els.searchBtn.style.display = 'none';
                els.inputGroup.style.display = 'none';
                if (els.dropZone) els.dropZone.style.display = 'none';

                // Reset custom-filename override per source.
                if (els.filenameCustomToggle) {
                    els.filenameCustomToggle.checked = false; els.filenameCustom.value = '';
                    els.filenameCustom.style.display = 'none'; els.filenamePreview.style.display = 'block';
                    if (els.filenameEditBtn) els.filenameEditBtn.style.display = '';
                    if (els.filenameAutoBtn) els.filenameAutoBtn.style.display = 'none';
                }

                initRangeSlider(data.duration);
                updateFmtFlow();
                updateFilenamePreview();
                updateSilenceVisualization();

                // Fresh A/B list per source
                snapshots = [];
                activeSnapshotId = null;
                currentSrc = '';
                renderSnapshots();

                if (isUpload) {
                    // Already in cache — no download to poll.
                    isCached = true;
                } else {
                    startCachePoll(opts.url);
                }

                if (data.can_preview === false) {
                    els.previewBtn.disabled = true;
                    els.previewBtn.title = data.limit_reason || '';
                } else {
                    els.previewBtn.disabled = false;
                    els.previewBtn.title = '';
                }
            }

