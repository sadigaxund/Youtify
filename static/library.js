            // ===================== Library (save-dir mode) =====================
            // In-page views (no modals): Download <-> Library <-> Edit, with back
            // arrows. Hiding (not destroying) the download view preserves its state.
            (function () {
                const $ = id => document.getElementById(id);
                let libItems = [];
                let editing = null;            // { id }
                let libEditCoverBase64 = null; // set if the user uploads a new cover
                let libEditResetUrl = '';      // current saved cover (revert target)

                const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
                    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">' +
                    '<rect width="48" height="48" fill="#222"/>' +
                    '<path d="M19 14v11a3 3 0 1 1-2-2.83V12l12-2v9a3 3 0 1 1-2-2.83V8z" fill="#666"/></svg>');
                const ICON_PLAY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
                const ICON_PAUSE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

                const ICON_PLAY_LG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
                const ICON_PAUSE_LG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

                // Standalone player + now-playing panel for the library.
                const libAudio = new Audio();
                let libPlayingId = null;
                let visibleItems = [];                  // current filtered+sorted list (prev/next scope)
                let playQueue = [];                     // user-curated "up next" track ids (session-only)
                let playStatsArmed = null;              // track id whose play hasn't been counted yet
                let sleepMode = 'off';                  // 'off' | minutes (number) | 'eot'
                let sleepTimer = null;
                let favOnly = false;                    // toolbar "favorites only" toggle
                let libFilters = [];                    // [{field, value}]
                let libSort = { field: 'created_at', dir: -1 };
                let libPlaylists = [];                  // sidebar playlists
                let currentSource = { type: 'all' };    // {type:'all'} | {type:'playlist',...} | {type:'browse', field, value}
                let browseField = 'album';               // active Browse-by facet
                let facetCovers = {};                    // {field: Set(values with a custom cover)}
                let facetCoverVer = Date.now();          // cache-buster for facet covers
                let createFilters = [];                 // dynamic-playlist builder chips
                let createKind = 'manual';
                let createCoverBase64 = null;
                let editingPlaylistId = null;           // set while editing an existing playlist

                const itemById = id => libItems.find(x => x.id === id);

                function playById(id) {
                    libPlayingId = id;
                    playStatsArmed = id;   // counted once playback crosses the threshold
                    libAudio.src = `/library/${id}/audio`;
                    libAudio.play().catch(() => {});
                    $('nowPlaying').style.setProperty('--np-prog', '0%');
                    renderNowPlaying();
                }
                function libTogglePlay(id) {
                    if (libPlayingId === id) {
                        if (libAudio.paused) libAudio.play().catch(() => {}); else libAudio.pause();
                        return;
                    }
                    playById(id);
                }
                function stepTrack(delta) {
                    // Forward steps consume the user queue first (skipping any
                    // queued tracks that were deleted meanwhile).
                    if (delta > 0) {
                        while (playQueue.length) {
                            const id = playQueue.shift();
                            if (itemById(id)) { renderQueue(); playById(id); return; }
                        }
                        renderQueue();
                    }
                    if (!visibleItems.length) return;
                    let i = visibleItems.findIndex(x => x.id === libPlayingId);
                    if (i < 0) i = delta > 0 ? -1 : 0;
                    i = (i + delta + visibleItems.length) % visibleItems.length;
                    playById(visibleItems[i].id);
                }

                function updateLibPlayIcons() {
                    document.querySelectorAll('#libList .lib-play').forEach(b => {
                        const on = Number(b.dataset.id) === libPlayingId && !libAudio.paused;
                        b.classList.toggle('playing', on);
                        b.innerHTML = on ? ICON_PAUSE : ICON_PLAY;
                    });
                    document.querySelectorAll('#libList .lib-row').forEach(r => {
                        r.classList.toggle('playing', Number(r.dataset.id) === libPlayingId);
                    });
                    const pb = $('npPlay');
                    if (pb) pb.innerHTML = (libPlayingId != null && !libAudio.paused) ? ICON_PAUSE_LG : ICON_PLAY_LG;
                }

                // Put text in an inner span; if it overflows, loop-scroll it (ping-pong)
                // so long titles are fully readable.
                function setMarquee(el, text) {
                    el.innerHTML = '';
                    const span = document.createElement('span');
                    span.className = 'np-marq'; span.textContent = text;
                    el.appendChild(span);
                    el.classList.remove('scroll');
                    requestAnimationFrame(() => {
                        const over = span.scrollWidth - el.clientWidth;
                        if (over > 4) {
                            el.style.setProperty('--marq-dist', (-(over + 8)) + 'px');
                            el.style.setProperty('--marq-dur', Math.max(5, (over + 8) / 22) + 's');
                            el.classList.add('scroll');
                        }
                    });
                }
                function renderNowPlaying() {
                    const it = itemById(libPlayingId);
                    const np = $('nowPlaying');
                    if (!it) {
                        np.classList.remove('has-track', 'np-expanded');   // hides body / mobile mini-bar
                        return;
                    }
                    np.classList.add('has-track');
                    const cov = $('npCover');
                    cov.onerror = () => { cov.onerror = null; cov.src = PLACEHOLDER; };
                    cov.src = `/library/${it.id}/cover?v=${encodeURIComponent(it.updated_at || '')}`;
                    setMarquee($('npTitle'), it.title || it.filename || it.youtube_id);
                    setMarquee($('npArtist'), (it.artists || []).join(', '));
                    const nf = $('npFav');
                    if (nf) {
                        nf.classList.toggle('on', !!it.favorite);
                        nf.title = it.favorite ? 'Unfavorite' : 'Favorite';
                    }
                    updateMediaSession(it);
                    updateLibPlayIcons();
                }

                // --- OS-level media metadata (MPRIS on Linux, lock screen on mobile) ---
                function updateMediaSession(it) {
                    if (!('mediaSession' in navigator)) return;
                    const cover = `${location.origin}/library/${it.id}/cover?v=${encodeURIComponent(it.updated_at || '')}`;
                    // Firefox can throw on artwork shapes it dislikes instead of
                    // ignoring them — never let that break playback.
                    try {
                        navigator.mediaSession.metadata = new MediaMetadata({
                            title: it.title || it.filename || it.youtube_id,
                            artist: (it.artists || []).join(', '),
                            album: it.album || '',
                            artwork: ['96x96', '256x256', '512x512'].map(s => ({ src: cover, sizes: s, type: 'image/jpeg' })),
                        });
                    } catch (e) { /* ignore */ }
                }
                function updatePositionState() {
                    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
                    const d = libAudio.duration;
                    if (!d || !isFinite(d)) return;
                    try {
                        navigator.mediaSession.setPositionState({
                            duration: d,
                            position: Math.min(libAudio.currentTime, d),
                            playbackRate: libAudio.playbackRate || 1,
                        });
                    } catch (e) { /* ignore */ }
                }
                function bindMediaHandlers() {
                    if (!('mediaSession' in navigator)) return;
                    const ms = navigator.mediaSession;
                    const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch (e) { } };
                    set('play', () => libAudio.play());
                    set('pause', () => libAudio.pause());
                    set('previoustrack', () => { if (libAudio.currentTime > 3) { libAudio.currentTime = 0; } else { stepTrack(-1); } });
                    set('nexttrack', () => stepTrack(1));
                    set('seekto', d => { if (d && d.seekTime != null) { libAudio.currentTime = d.seekTime; updatePositionState(); } });
                    set('seekbackward', d => { libAudio.currentTime = Math.max(0, libAudio.currentTime - ((d && d.seekOffset) || 10)); });
                    set('seekforward', d => { libAudio.currentTime = Math.min(libAudio.duration || 1e9, libAudio.currentTime + ((d && d.seekOffset) || 10)); });
                }
                bindMediaHandlers();

                libAudio.addEventListener('play', () => {
                    updateLibPlayIcons();
                    if ('mediaSession' in navigator) {
                        navigator.mediaSession.playbackState = 'playing';
                        // Firefox/Zen only reliably pick up metadata + handlers when
                        // (re)applied after a user-gesture-initiated play.
                        const it = itemById(libPlayingId);
                        if (it) updateMediaSession(it);
                        bindMediaHandlers();
                    }
                });
                libAudio.addEventListener('pause', () => { updateLibPlayIcons(); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; });
                libAudio.addEventListener('ended', () => {
                    if (sleepMode === 'eot') {
                        // Sleep at end of track: stop here (the queue is kept).
                        setSleepMode('off');
                        return;
                    }
                    stepTrack(1);
                });
                libAudio.addEventListener('timeupdate', () => {
                    if (!libAudio.duration) return;
                    $('npSeek').value = String(Math.round(libAudio.currentTime / libAudio.duration * 1000));
                    $('npCur').textContent = fmtDur(libAudio.currentTime);
                    // Mobile mini-bar shows position as a background sweep.
                    $('nowPlaying').style.setProperty('--np-prog', (libAudio.currentTime / libAudio.duration * 100).toFixed(2) + '%');
                    updatePositionState();
                    // Count a play once past 30s (or half of a short track) — not on
                    // the first instant, so accidental clicks don't inflate stats.
                    if (playStatsArmed != null && playStatsArmed === libPlayingId &&
                        libAudio.currentTime > Math.min(30, libAudio.duration * 0.5)) {
                        const id = playStatsArmed;
                        playStatsArmed = null;
                        fetch(`/library/${id}/played`, { method: 'POST' })
                            .then(r => r.ok ? r.json() : null)
                            .then(stats => {
                                const it = itemById(id);
                                if (it && stats) { it.play_count = stats.play_count; it.last_played = stats.last_played; }
                            }).catch(() => {});
                    }
                });
                libAudio.addEventListener('loadedmetadata', () => { $('npDur').textContent = fmtDur(libAudio.duration); updatePositionState(); });

                function showView(name) {
                    $('downloadView').style.display = name === 'download' ? 'block' : 'none';
                    $('libraryView').style.display = name === 'library' ? 'block' : 'none';
                    $('libEditView').style.display = name === 'libEdit' ? 'block' : 'none';
                    $('navDownload').classList.toggle('active', name === 'download');
                    $('navLibrary').classList.toggle('active', name === 'library' || name === 'libEdit');
                    // Library view scrolls inside .content (mobile) so the URL bar
                    // stays put and the fixed mini-bar doesn't jitter.
                    document.body.classList.toggle('lib-locked', name === 'library');
                    // Only one player audible at a time: pause the other tab's audio.
                    if (name === 'download') { libAudio.pause(); }
                    else { stopPlayback(); }   // pause the download preview when entering library/edit
                    window.scrollTo(0, 0);
                    const content = document.querySelector('.content');
                    if (content) content.scrollTop = 0;
                }

                function fmtDur(s) {
                    if (!s && s !== 0) return '';
                    s = Math.round(s); const m = Math.floor(s / 60), r = s % 60;
                    return `${m}:${String(r).padStart(2, '0')}`;
                }

                async function loadLibrary() {
                    try {
                        const res = await fetch('/library');
                        if (!res.ok) return;
                        const data = await res.json();
                        libItems = data.items || [];
                        renderLibrary();
                    } catch (e) { showError('Failed to load library: ' + e.message); }
                }

                // --- Filter / sort engine (client-side over libItems) ---
                function fieldText(it, field) {
                    switch (field) {
                        case 'title': return it.title || '';
                        case 'artist': return (it.artists || []).join(' ');
                        case 'genre': return (it.genres || []).join(' ');
                        case 'album': return (it.albums && it.albums.length ? it.albums : [it.album || '']).join(' ');
                        case 'year': return it.year != null ? String(it.year) : '';
                        case 'duration': return it.duration != null ? String(it.duration) : '';
                        case 'created_at': return it.created_at || '';
                        case 'play_count': return it.play_count != null ? String(it.play_count) : '0';
                        case 'last_played': return it.last_played || '';
                        case 'favorite': return it.favorite ? 'true' : '';
                        case 'composer': return (it.custom_fields && (it.custom_fields.Composer || it.custom_fields.composer)) || '';
                        default: return (it.custom_fields && it.custom_fields[field]) || '';
                    }
                }
                function libFieldOptions() {
                    const fields = ['title', 'artist', 'genre', 'album', 'year', 'composer', 'favorite'];
                    const seen = new Set(fields.map(f => f.toLowerCase()));
                    libItems.forEach(it => Object.keys(it.custom_fields || {}).forEach(k => {
                        if (!seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); fields.push(k); }
                    }));
                    return fields;
                }
                function passesChips(it, chips) {
                    return (chips || []).every(f =>
                        fieldText(it, f.field).toLowerCase().includes(String(f.value).toLowerCase()));
                }
                function sourceItems() {
                    if (currentSource.type === 'playlist') {
                        if (currentSource.kind === 'dynamic') {
                            return libItems.filter(it => passesChips(it, currentSource.filters));
                        }
                        const ids = currentSource.track_ids || [];
                        return libItems.filter(it => ids.includes(it.youtube_id));
                    }
                    if (currentSource.type === 'browseAll') return libItems;   // full-grid view; player scope = everything
                    if (currentSource.type === 'browse') {
                        const { field, value } = currentSource;
                        return libItems.filter(it => {
                            if (field === 'artist') return (it.artists || []).includes(value);
                            if (field === 'genre') return (it.genres || []).includes(value);
                            if (field === 'album') return (it.albums && it.albums.length ? it.albums : (it.album ? [it.album] : [])).includes(value);
                            if (field === 'year') return String(it.year) === value;
                            return false;
                        });
                    }
                    return libItems;
                }

                // --- Browse-by facets (cover-art card grid) ---
                const BROWSE_FIELDS = [['album', 'Albums'], ['artist', 'Artists'], ['genre', 'Genres'], ['year', 'Years']];

                async function loadFacets() {
                    try {
                        const res = await fetch('/facets');
                        if (!res.ok) return;
                        const data = await res.json();
                        facetCovers = {};
                        Object.keys(data).forEach(f => { facetCovers[f] = new Set(data[f] || []); });
                    } catch (e) { /* ignore — track-cover fallback still works */ }
                }
                function hasFacetCover(field, value) {
                    return !!(facetCovers[field] && facetCovers[field].has(value));
                }
                function facetCoverUrl(field, value) {
                    return `/facets/${encodeURIComponent(field)}/${encodeURIComponent(value)}/cover?v=${facetCoverVer}`;
                }
                // Set an <img> to the custom facet cover when present, else the
                // facet's first-track cover, else the placeholder.
                function setFacetImg(img, field, value, coverId, updated) {
                    const trackUrl = `/library/${coverId}/cover?v=${encodeURIComponent(updated || '')}`;
                    img.onerror = () => {
                        img.onerror = () => { img.onerror = null; img.src = PLACEHOLDER; };
                        img.src = trackUrl;
                    };
                    if (hasFacetCover(field, value)) img.src = facetCoverUrl(field, value);
                    else { img.onerror = () => { img.onerror = null; img.src = PLACEHOLDER; }; img.src = trackUrl; }
                }
                function browseValuesFor(field) {
                    const map = new Map();   // value -> {value, count, coverId, updated}
                    libItems.forEach(it => {
                        let vals;
                        if (field === 'artist') vals = it.artists || [];
                        else if (field === 'genre') vals = it.genres || [];
                        else if (field === 'album') vals = (it.albums && it.albums.length) ? it.albums : (it.album ? [it.album] : []);
                        else if (field === 'year') vals = (it.year != null && it.year !== '') ? [String(it.year)] : [];
                        else vals = [];
                        vals.forEach(v => {
                            v = String(v).trim(); if (!v) return;
                            const e = map.get(v) || { value: v, count: 0, coverId: it.id, updated: it.updated_at };
                            e.count++; map.set(v, e);
                        });
                    });
                    return [...map.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
                }
                const BROWSE_CAP = 4;   // capped band size on All Tracks ("See all" opens the full view)
                function renderBrowse() {
                    const allView = currentSource.type === 'browseAll';
                    const tabs = $('browseTabs'); tabs.innerHTML = '';
                    BROWSE_FIELDS.forEach(([f, label]) => {
                        const b = document.createElement('button');
                        b.type = 'button'; b.className = 'browse-tab' + (f === browseField ? ' active' : '');
                        b.textContent = label;
                        b.addEventListener('click', () => {
                            browseField = f;
                            if (allView) { currentSource.field = f; renderSidebar(); }
                            renderBrowse();
                        });
                        tabs.appendChild(b);
                    });
                    const grid = $('browseGrid'); grid.innerHTML = '';
                    const circular = browseField === 'artist';
                    const all = browseValuesFor(browseField);
                    const shown = allView ? all : all.slice(0, BROWSE_CAP);
                    shown.forEach(v => {
                        const card = document.createElement('div');
                        card.className = 'browse-card' + (circular ? ' circ' : '');
                        const img = document.createElement('img');
                        img.className = 'browse-card-cover'; img.loading = 'lazy'; img.alt = '';
                        setFacetImg(img, browseField, v.value, v.coverId, v.updated);
                        const name = document.createElement('div');
                        name.className = 'browse-card-name'; name.textContent = v.value; name.title = v.value;
                        const cnt = document.createElement('div');
                        cnt.className = 'browse-card-count'; cnt.textContent = v.count + ' track' + (v.count === 1 ? '' : 's');
                        card.append(img, name, cnt);
                        card.addEventListener('click', () => {
                            currentSource = {
                                type: 'browse', field: browseField, value: v.value, name: v.value,
                                coverId: v.coverId, updated: v.updated,
                                from: allView ? 'browseAll' : undefined,
                            };
                            renderLibrary();
                        });
                        grid.appendChild(card);
                    });
                    // Head action: "See all" on the capped band, "Back" in the full view.
                    const head = tabs.parentElement;
                    const old = head.querySelector('.browse-head-btn');
                    if (old) old.remove();
                    if (allView || all.length > BROWSE_CAP) {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'browse-head-btn';
                        btn.textContent = allView ? '← Back' : `See all ${all.length} ▸`;
                        btn.addEventListener('click', () => {
                            currentSource = allView ? { type: 'all' } : { type: 'browseAll', field: browseField };
                            renderLibrary();
                        });
                        head.appendChild(btn);
                    }
                }
                function applyFilters(items) {
                    const q = ($('libSearch').value || '').toLowerCase();
                    return items.filter(it => {
                        if (favOnly && !it.favorite) return false;
                        const hay = [it.title, (it.artists || []).join(' '), (it.genres || []).join(' '), it.album]
                            .join(' ').toLowerCase();
                        if (q && !hay.includes(q)) return false;
                        return passesChips(it, libFilters);
                    });
                }
                function applySort(items) {
                    const { field, dir } = libSort;
                    const numeric = (field === 'year' || field === 'duration' || field === 'play_count');
                    return items.slice().sort((a, b) => {
                        let va = fieldText(a, field), vb = fieldText(b, field);
                        if (numeric) return ((parseFloat(va) || 0) - (parseFloat(vb) || 0)) * dir;
                        return String(va).localeCompare(String(vb)) * dir;
                    });
                }
                function renderChips() {
                    const c = $('libChips'); c.innerHTML = '';
                    libFilters.forEach((f, i) => {
                        const chip = document.createElement('span');
                        chip.className = 'filter-chip';
                        const label = document.createElement('span');
                        label.textContent = `${f.field}: ${f.value}`;
                        const x = document.createElement('button');
                        x.type = 'button'; x.textContent = '×';
                        x.addEventListener('click', () => { libFilters.splice(i, 1); renderLibrary(); });
                        chip.append(label, x);
                        c.appendChild(chip);
                    });
                }

                function renderLibrary() {
                    // Refresh the filter-field dropdown (includes custom keys).
                    const fsel = $('libFilterField');
                    if (fsel) {
                        const cur = fsel.value;
                        fsel.innerHTML = libFieldOptions()
                            .map(f => `<option value="${f}">${f.charAt(0).toUpperCase() + f.slice(1)}</option>`).join('');
                        if (cur) fsel.value = cur;
                    }
                    renderChips();
                    visibleItems = applySort(applyFilters(sourceItems()));

                    // Browse band on "All Tracks"; dedicated full grid in the
                    // "browseAll" view; hero header when a facet is open.
                    const allView = currentSource.type === 'browseAll';
                    const browseMode = currentSource.type === 'all' || allView;
                    const isBrowse = currentSource.type === 'browse';
                    if (allView) browseField = currentSource.field || browseField;
                    if ($('libBrowse')) {
                        $('libBrowse').style.display = browseMode ? 'block' : 'none';
                        if (browseMode) renderBrowse();
                    }
                    // The full-grid view hides the toolbar + track list entirely.
                    const toolbar = document.querySelector('.lib-toolbar');
                    if (toolbar) toolbar.style.display = allView ? 'none' : '';
                    $('libList').style.display = allView ? 'none' : '';
                    if ($('libHero')) {
                        $('libHero').style.display = isBrowse ? 'flex' : 'none';
                        if (isBrowse) {
                            $('libHeroKind').textContent = ({ album: 'Album', artist: 'Artist', genre: 'Genre', year: 'Year' })[currentSource.field] || '';
                            $('libHeroName').textContent = currentSource.name;
                            $('libHeroCount').textContent = visibleItems.length + ' track' + (visibleItems.length === 1 ? '' : 's');
                            const hc = $('libHeroCover');
                            hc.classList.toggle('circ', currentSource.field === 'artist');
                            setFacetImg(hc, currentSource.field, currentSource.value, currentSource.coverId, currentSource.updated);
                        }
                    }

                    const list = $('libList'); list.innerHTML = '';
                    $('libEmpty').style.display = (visibleItems.length || allView) ? 'none' : 'block';
                    visibleItems.forEach(it => {
                        const title = it.title || it.filename || it.youtube_id;
                        const sub = [(it.artists || []).join(', '), (it.genres || []).join(', '), fmtDur(it.duration)]
                            .filter(Boolean).join('  ·  ');
                        const row = document.createElement('div');
                        row.className = 'lib-row'; row.dataset.id = it.id;
                        // Stats live in the tooltip — the row itself stays clean.
                        row.title = statsTooltip(it);

                        const img = document.createElement('img');
                        img.className = 'lib-cover'; img.loading = 'lazy'; img.alt = '';
                        img.onerror = () => { img.onerror = null; img.src = PLACEHOLDER; };
                        img.src = `/library/${it.id}/cover?v=${encodeURIComponent(it.updated_at || '')}`;

                        const info = document.createElement('div');
                        info.className = 'lib-info';
                        const t = document.createElement('div');
                        t.className = 'lib-ttl'; t.textContent = title; t.title = title;
                        const s = document.createElement('div');
                        s.className = 'lib-sub'; s.textContent = sub; s.title = sub;
                        info.append(t, s);

                        const actions = document.createElement('div');
                        actions.className = 'lib-actions';
                        const fav = document.createElement('button');
                        fav.type = 'button'; fav.className = 'lib-btn lib-fav' + (it.favorite ? ' on' : '');
                        fav.title = it.favorite ? 'Unfavorite' : 'Favorite';
                        fav.textContent = '♥';
                        fav.addEventListener('click', e => { e.stopPropagation(); toggleFavorite(it); });
                        actions.append(fav);
                        const kebab = document.createElement('button');
                        kebab.type = 'button'; kebab.className = 'lib-btn lib-kebab'; kebab.title = 'More';
                        kebab.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>';
                        kebab.addEventListener('click', e => { e.stopPropagation(); openRowMenu(e.currentTarget, it); });
                        actions.append(kebab);

                        row.append(img, info, actions);
                        // Row body click plays (edit is its own button now).
                        row.addEventListener('click', () => libTogglePlay(it.id));
                        list.appendChild(row);
                    });
                    updateLibPlayIcons();
                    renderNowPlaying();
                    renderSidebar();
                }

                // ---- Playlists sidebar ----
                const ICON_ALL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>';
                const ICON_PL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

                async function loadPlaylists() {
                    try {
                        const res = await fetch('/playlists');
                        if (!res.ok) return;
                        libPlaylists = (await res.json()).items || [];
                        renderSidebar();
                    } catch (e) { /* ignore */ }
                }

                let dragPid = null;
                function reorderPlaylists(srcId, targetId) {
                    if (!srcId || srcId === targetId) return;
                    const from = libPlaylists.findIndex(p => p.id === srcId);
                    const to = libPlaylists.findIndex(p => p.id === targetId);
                    if (from < 0 || to < 0) return;
                    const [moved] = libPlaylists.splice(from, 1);
                    libPlaylists.splice(to, 0, moved);
                    renderSidebar();
                    fetch('/playlists/reorder', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: libPlaylists.map(p => p.id) }),
                    }).catch(() => {});
                }

                function makeEntry(label, count, active, opts) {
                    const e = document.createElement('div');
                    e.className = 'pl-entry' + (active ? ' active' : '');
                    let thumb;
                    if (opts.cover) {
                        thumb = document.createElement('img');
                        thumb.className = 'pl-thumb'; thumb.alt = '';
                        thumb.onerror = () => { thumb.removeAttribute('src'); thumb.innerHTML = opts.icon; };
                        thumb.src = opts.cover;
                    } else {
                        thumb = document.createElement('div');
                        thumb.className = 'pl-thumb'; thumb.innerHTML = opts.icon;
                    }
                    const nm = document.createElement('span'); nm.className = 'pl-name'; nm.textContent = label; nm.title = label;
                    const ct = document.createElement('span'); ct.className = 'pl-count'; ct.textContent = count;
                    e.append(thumb, nm, ct);
                    if (opts.onEdit || opts.onDelete) {
                        const acts = document.createElement('div');
                        acts.className = 'pl-actions';
                        if (opts.onEdit) {
                            const ed = document.createElement('button');
                            ed.className = 'pl-act'; ed.type = 'button'; ed.title = 'Edit playlist';
                            ed.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
                            ed.addEventListener('click', ev => { ev.stopPropagation(); opts.onEdit(); });
                            acts.append(ed);
                        }
                        if (opts.onDelete) {
                            const d = document.createElement('button');
                            d.className = 'pl-act'; d.type = 'button'; d.title = 'Delete playlist';
                            d.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
                            d.addEventListener('click', ev => { ev.stopPropagation(); opts.onDelete(); });
                            acts.append(d);
                        }
                        e.append(acts);
                    }
                    e.addEventListener('click', opts.onClick);
                    // Drag-to-reorder (playlists only).
                    if (opts.pid) {
                        e.dataset.pid = opts.pid;
                        e.draggable = true;
                        e.title = 'Drag to reorder';
                        e.addEventListener('dragstart', ev => { dragPid = opts.pid; e.classList.add('dragging'); ev.dataTransfer.effectAllowed = 'move'; });
                        e.addEventListener('dragend', () => { e.classList.remove('dragging'); dragPid = null; });
                        e.addEventListener('dragover', ev => { ev.preventDefault(); });
                        e.addEventListener('drop', ev => { ev.preventDefault(); reorderPlaylists(dragPid, opts.pid); });
                    }
                    return e;
                }

                function renderSidebar() {
                    const list = $('plList'); if (!list) return;
                    list.innerHTML = '';
                    list.appendChild(makeEntry('All Tracks', libItems.length, currentSource.type === 'all',
                        { icon: ICON_ALL, onClick: () => setSource({ type: 'all' }) }));
                    libPlaylists.forEach(p => {
                        const count = p.kind === 'dynamic'
                            ? libItems.filter(it => passesChips(it, p.filters)).length
                            : p.count;
                        list.appendChild(makeEntry(p.name, count,
                            currentSource.type === 'playlist' && currentSource.id === p.id, {
                            icon: ICON_PL,
                            cover: p.has_cover ? `/playlists/${p.id}/cover?v=${encodeURIComponent(p.updated_at || '')}` : null,
                            onClick: () => setSource({ type: 'playlist', id: p.id, kind: p.kind }),
                            onEdit: () => openEditPlaylist(p.id),
                            onDelete: () => deletePlaylist(p.id, p.name),
                            pid: p.id,
                        }));
                    });
                    // Mobile picker label = current source name.
                    const facetLabel = (BROWSE_FIELDS.find(([f]) => f === currentSource.field) || [])[1];
                    const active = currentSource.type === 'all'
                        ? 'All Tracks'
                        : currentSource.type === 'browseAll'
                            ? (facetLabel || 'Browse')
                            : (libPlaylists.find(p => p.id === currentSource.id)?.name
                               || currentSource.name || 'Playlist');
                    $('plToggle').innerHTML = `${active} <span>▾</span>`;
                }

                function setSource(src) {
                    $('libSidebar').classList.remove('open');   // collapse the mobile picker
                    if (src.type === 'playlist') {
                        fetch('/playlists/' + src.id).then(r => r.json()).then(pl => {
                            currentSource = { type: 'playlist', ...pl };
                            renderLibrary();
                        }).catch(() => { });
                    } else {
                        currentSource = { type: 'all' };
                        renderLibrary();
                    }
                }

                function closePlaylistMenu() { const m = $('plMenu'); if (m) m.remove(); }

                // Generic popup menu (reuses .pl-menu styling). items: [{label, fn, danger}]
                function openMenu(anchor, items) {
                    closePlaylistMenu();
                    const menu = document.createElement('div'); menu.className = 'pl-menu'; menu.id = 'plMenu';
                    items.forEach(it => {
                        const b = document.createElement('button'); b.type = 'button'; b.textContent = it.label;
                        if (it.danger) b.style.color = 'var(--primary)';
                        // stopPropagation: keep this click from bubbling to the
                        // outside-click closer, which would otherwise close a submenu
                        // (e.g. "Add to playlist…") the very instant it opens.
                        b.addEventListener('click', (e) => { e.stopPropagation(); closePlaylistMenu(); it.fn(); });
                        menu.appendChild(b);
                    });
                    document.body.appendChild(menu);
                    const r = anchor.getBoundingClientRect();
                    menu.style.top = (window.scrollY + r.bottom + 4) + 'px';
                    menu.style.left = (window.scrollX + Math.min(r.left, window.innerWidth - 180)) + 'px';
                    setTimeout(() => document.addEventListener('click', closePlaylistMenu, { once: true }), 0);
                }

                // Per-track kebab menu (collapses the row's actions). No Play —
                // clicking the row already plays it.
                function openRowMenu(anchor, it) {
                    const inManual = currentSource.type === 'playlist' && currentSource.kind !== 'dynamic';
                    const title = it.title || it.filename || it.youtube_id;
                    openMenu(anchor, [
                        { label: 'Play next', fn: () => { playQueue.unshift(it.id); renderQueue(); } },
                        { label: 'Add to queue', fn: () => { playQueue.push(it.id); renderQueue(); } },
                        { label: it.favorite ? 'Unfavorite' : 'Favorite', fn: () => toggleFavorite(it) },
                        { label: 'Add to playlist…', fn: () => openPlaylistMenu(anchor, it.youtube_id) },
                        { label: 'Edit', fn: () => openEdit(it.id) },
                        { label: 'Download', fn: () => downloadItem(it) },
                        inManual
                            ? { label: 'Remove from playlist', danger: true, fn: () => removeFromPlaylist(currentSource.id, it.youtube_id) }
                            : { label: 'Delete', danger: true, fn: () => deleteItem(it.id, title) },
                    ]);
                }

                // ---- Stats / favorites ----
                function statsTooltip(it) {
                    const bits = [];
                    if (it.created_at) bits.push('Added ' + String(it.created_at).slice(0, 10));
                    bits.push((it.play_count || 0) + ' play' + ((it.play_count || 0) === 1 ? '' : 's'));
                    if (it.last_played) bits.push('Last played ' + String(it.last_played).slice(0, 10));
                    return bits.join('  ·  ');
                }
                async function toggleFavorite(it) {
                    const fav = !it.favorite;
                    it.favorite = fav;               // optimistic
                    renderLibrary();
                    try {
                        const res = await fetch(`/library/${it.id}/favorite`, {
                            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ favorite: fav }),
                        });
                        if (!res.ok) throw new Error();
                    } catch (e) {
                        it.favorite = !fav;          // roll back
                        renderLibrary();
                        showError('Could not update favorite');
                    }
                }

                // ---- Play queue ("Up next") panel ----
                function renderQueue() {
                    const box = $('npQueue'), list = $('npQueueList');
                    if (!box || !list) return;
                    playQueue = playQueue.filter(id => itemById(id));   // drop deleted tracks
                    if (!playQueue.length) { box.style.display = 'none'; list.innerHTML = ''; return; }
                    box.style.display = 'block';
                    list.innerHTML = '';
                    playQueue.forEach((id, i) => {
                        const it = itemById(id);
                        const row = document.createElement('div');
                        row.className = 'np-queue-row';
                        const nm = document.createElement('span');
                        nm.className = 'np-queue-name';
                        nm.textContent = (i + 1) + '. ' + (it.title || it.filename || it.youtube_id);
                        nm.title = 'Play now';
                        nm.addEventListener('click', () => {
                            playQueue.splice(i, 1); renderQueue(); playById(id);
                        });
                        const x = document.createElement('button');
                        x.type = 'button'; x.className = 'np-queue-x'; x.textContent = '×'; x.title = 'Remove from queue';
                        x.addEventListener('click', e => { e.stopPropagation(); playQueue.splice(i, 1); renderQueue(); });
                        row.append(nm, x);
                        list.appendChild(row);
                    });
                }

                // ---- Sleep timer ----
                function setSleepMode(mode) {
                    sleepMode = mode;
                    if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
                    if (typeof mode === 'number') {
                        sleepTimer = setTimeout(() => {
                            libAudio.pause();
                            setSleepMode('off');
                        }, mode * 60 * 1000);
                    }
                    updateSleepUi();
                }
                function updateSleepUi() {
                    const b = $('npSleep');
                    if (!b) return;
                    b.classList.toggle('on', sleepMode !== 'off');
                    b.title = sleepMode === 'off' ? 'Sleep timer'
                        : (sleepMode === 'eot' ? 'Sleep: end of track' : `Sleep in ${sleepMode} min`);
                }

                // Download the saved file (same-origin -> the `download` attr forces
                // a save with the library filename instead of streaming inline).
                function downloadItem(it) {
                    const a = document.createElement('a');
                    a.href = `/library/${it.id}/audio`;
                    a.download = it.filename || (it.title || it.youtube_id);
                    document.body.appendChild(a); a.click(); a.remove();
                }

                function openPlaylistMenu(anchor, yid) {
                    closePlaylistMenu();
                    const menu = document.createElement('div'); menu.className = 'pl-menu'; menu.id = 'plMenu';
                    const manual = libPlaylists.filter(p => p.kind !== 'dynamic');
                    if (!manual.length) {
                        const b = document.createElement('div');
                        b.style.cssText = 'padding:0.4rem 0.55rem; font-size:0.76rem; opacity:0.6;';
                        b.textContent = 'No playlists yet';
                        menu.appendChild(b);
                    }
                    manual.forEach(p => {
                        const b = document.createElement('button'); b.type = 'button'; b.textContent = p.name;
                        b.addEventListener('click', () => { addToPlaylist(p.id, yid); closePlaylistMenu(); });
                        menu.appendChild(b);
                    });
                    document.body.appendChild(menu);
                    const r = anchor.getBoundingClientRect();
                    menu.style.top = (window.scrollY + r.bottom + 4) + 'px';
                    menu.style.left = (window.scrollX + Math.min(r.left, window.innerWidth - 180)) + 'px';
                    setTimeout(() => document.addEventListener('click', closePlaylistMenu, { once: true }), 0);
                }
                async function addToPlaylist(pid, yid) {
                    try {
                        await fetch(`/playlists/${pid}/tracks`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ youtube_id: yid }),
                        });
                        loadPlaylists();
                    } catch (e) { showError('Add failed'); }
                }
                async function removeFromPlaylist(pid, yid) {
                    try {
                        await fetch(`/playlists/${pid}/tracks/${encodeURIComponent(yid)}`, { method: 'DELETE' });
                        const pl = await (await fetch('/playlists/' + pid)).json();
                        currentSource = { type: 'playlist', ...pl };
                        loadPlaylists(); renderLibrary();
                    } catch (e) { showError('Remove failed'); }
                }
                async function deletePlaylist(pid, name) {
                    if (!confirm(`Delete playlist "${name}"? (the tracks themselves are kept)`)) return;
                    try {
                        await fetch('/playlists/' + pid, { method: 'DELETE' });
                        if (currentSource.type === 'playlist' && currentSource.id === pid) currentSource = { type: 'all' };
                        loadPlaylists(); renderLibrary();
                    } catch (e) { showError('Delete failed'); }
                }

                // ---- Create-playlist unit ----
                function renderPlChips() {
                    const c = $('plChips'); c.innerHTML = '';
                    createFilters.forEach((f, i) => {
                        const chip = document.createElement('span'); chip.className = 'filter-chip';
                        const label = document.createElement('span'); label.textContent = `${f.field}: ${f.value}`;
                        const x = document.createElement('button'); x.type = 'button'; x.textContent = '×';
                        x.addEventListener('click', () => { createFilters.splice(i, 1); renderPlChips(); });
                        chip.append(label, x); c.appendChild(chip);
                    });
                }
                function setKind(kind) {
                    createKind = kind;
                    $('plKindManual').classList.toggle('active', kind === 'manual');
                    $('plKindDynamic').classList.toggle('active', kind === 'dynamic');
                    $('plDynBuilder').style.display = kind === 'dynamic' ? 'block' : 'none';
                }
                function openCreate() {
                    editingPlaylistId = null;
                    createFilters = []; createCoverBase64 = null;
                    $('plName').value = '';
                    setKind('manual');
                    $('plCoverBtn').textContent = 'Cover image (optional)';
                    $('plFilterField').innerHTML = libFieldOptions()
                        .map(f => `<option value="${f}">${f.charAt(0).toUpperCase() + f.slice(1)}</option>`).join('');
                    $('plCreateTitle').textContent = 'New playlist';
                    $('plCreateSave').textContent = 'Create';
                    renderPlChips();
                    $('plCreate').style.display = 'flex';
                    $('libSidebar').classList.add('open');
                }
                async function openEditPlaylist(pid) {
                    try {
                        const pl = await (await fetch('/playlists/' + pid)).json();
                        editingPlaylistId = pid;
                        createFilters = (pl.filters || []).slice();
                        createCoverBase64 = null;
                        $('plName').value = pl.name || '';
                        setKind(pl.kind === 'dynamic' ? 'dynamic' : 'manual');
                        $('plCoverBtn').textContent = pl.has_cover ? 'Change cover' : 'Cover image (optional)';
                        $('plFilterField').innerHTML = libFieldOptions()
                            .map(f => `<option value="${f}">${f.charAt(0).toUpperCase() + f.slice(1)}</option>`).join('');
                        $('plCreateTitle').textContent = 'Edit playlist';
                        $('plCreateSave').textContent = 'Save';
                        renderPlChips();
                        $('plCreate').style.display = 'flex';
                        $('libSidebar').classList.add('open');
                    } catch (e) { showError(e.message); }
                }
                async function saveCreate() {
                    const name = $('plName').value.trim();
                    if (!name) { showError('Name the playlist'); return; }
                    const body = { name, kind: createKind, filters: createKind === 'dynamic' ? createFilters : [] };
                    if (createCoverBase64) body.cover_base64 = createCoverBase64;
                    const editing = editingPlaylistId;
                    try {
                        const res = await fetch(editing ? '/playlists/' + editing : '/playlists', {
                            method: editing ? 'PATCH' : 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body),
                        });
                        if (!res.ok) { showError('Save failed: ' + (await res.text())); return; }
                        const pl = await res.json();
                        editingPlaylistId = null;
                        $('plCreate').style.display = 'none';
                        await loadPlaylists();
                        setSource({ type: 'playlist', id: editing || pl.id });
                    } catch (e) { showError(e.message); }
                }

                function cloneOptions(srcId, withNone) {
                    const src = document.getElementById(srcId);
                    let html = src ? src.innerHTML : '';
                    if (withNone && !/value=("")|value=''/.test(html)) html = '<option value="">None</option>' + html;
                    return html;
                }

                function buildFxControls(eff) {
                    eff = eff || {};
                    const field = (id, label, html) =>
                        `<div class="fx-field"><label>${label}</label>
                         <select id="${id}" class="styled-select-mini" style="width:100%;">${html}</select></div>`;
                    $('libFxControls').innerHTML =
                        `<div class="fx-grid">` +
                        field('libFxEq', 'EQ preset', cloneOptions('eqPresetSelect', true)) +
                        field('libFxMbc', 'Compression', cloneOptions('mbcPresetSelect', true)) +
                        field('libFxEnhance', 'Enhance', cloneOptions('enhanceModeSelect', true)) +
                        field('libFxIntensity', 'Intensity', cloneOptions('enhanceIntensitySelect', false)) +
                        field('libFxNormI', 'Loudness', cloneOptions('normalizeISelect', false)) +
                        `</div>` +
                        `<div class="fx-toggles">
                            <label><input type="checkbox" id="libFxNorm"> Normalize</label>
                            <label><input type="checkbox" id="libFxTrim"> Trim silence</label>
                            <label><input type="checkbox" id="libFxOriginal"> Original</label>
                         </div>`;
                    if ($('libFxEq')) $('libFxEq').value = eff.eq_preset || '';
                    if ($('libFxMbc')) $('libFxMbc').value = eff.mbc_preset || '';
                    if ($('libFxEnhance')) $('libFxEnhance').value = eff.enhance_mode || '';
                    if ($('libFxIntensity')) $('libFxIntensity').value = eff.enhance_intensity || '1.5';
                    if ($('libFxNormI')) $('libFxNormI').value = eff.normalize_i || '-16';
                    $('libFxNorm').checked = eff.normalize !== false;
                    $('libFxTrim').checked = !!eff.trim_silence;
                    $('libFxOriginal').checked = !!eff.original;
                }

                async function openEdit(id) {
                    try {
                        const res = await fetch('/library/' + id);
                        if (!res.ok) { showError('Track not found'); return; }
                        const d = await res.json();
                        editing = { id };
                        $('libEditTitle').textContent = d.title || d.filename || 'Edit';
                        $('libTitle').value = d.title || '';
                        // Same chip inputs as the download form (rebuilt per edit session).
                        mountEditChips(d);
                        $('libYear').value = d.year || '';
                        const cf = d.custom_fields || {};
                        const cont = $('libCustomTags'); cont.innerHTML = '';
                        Object.keys(cf).forEach(k => addCustomTag(cont, k, cf[k]));
                        // Cover
                        libEditCoverBase64 = null;
                        libEditResetUrl = `/library/${id}/cover?v=${encodeURIComponent(d.updated_at || '')}`;
                        const im = $('libEditThumb');
                        im.onerror = () => { im.onerror = null; im.src = PLACEHOLDER; };
                        im.src = libEditResetUrl;

                        buildFxControls(d.effects);
                        showMetaPane();
                        showView('libEdit');
                    } catch (e) { showError(e.message); }
                }

                // (Re)build the editor's chip inputs from a track detail.
                function mountEditChips(d) {
                    const albums = (d.albums && d.albums.length) ? d.albums : (d.album ? [d.album] : []);
                    const artistsChip = makeChipValue(d.artists || [], 'artist');
                    const genresChip = makeChipValue(d.genres || [], 'genre');
                    const albumsChip = makeChipValue(albums, 'album');
                    [['libArtistsChips', artistsChip], ['libGenresChips', genresChip], ['libAlbumChips', albumsChip]]
                        .forEach(([id, chip]) => { const m = $(id); m.innerHTML = ''; m.appendChild(chip.wrap); });
                    editing.artistsChip = artistsChip;
                    editing.genresChip = genresChip;
                    editing.albumsChip = albumsChip;
                }

                function showMetaPane() {
                    $('libPaneMeta').style.display = 'grid';
                    $('libPaneFx').style.display = 'none';
                    $('libTabMeta').style.background = 'var(--primary)';
                    $('libTabFx').style.background = 'rgba(255,255,255,0.05)';
                }
                function showFxPane() {
                    $('libPaneMeta').style.display = 'none';
                    $('libPaneFx').style.display = 'flex';
                    $('libTabFx').style.background = 'var(--primary)';
                    $('libTabMeta').style.background = 'rgba(255,255,255,0.05)';
                }

                async function saveMeta() {
                    if (!editing) return;
                    const custom_tags = getCustomTags($('libCustomTags'));
                    const albums = editing.albumsChip ? editing.albumsChip.getValues() : [];
                    const body = {
                        title: $('libTitle').value.trim(),
                        artists: editing.artistsChip ? editing.artistsChip.getValues() : [],
                        genres: editing.genresChip ? editing.genresChip.getValues() : [],
                        albums,
                        album: albums[0] || '',
                        year: $('libYear').value.trim(),
                        custom_tags,
                        delimiter: (els.delimiterInput && els.delimiterInput.value) || '|',
                    };
                    if (libEditCoverBase64) body.thumbnail_base64 = libEditCoverBase64;
                    const btn = $('libSaveMeta');
                    btn.disabled = true; btn.textContent = 'Saving…';
                    try {
                        const res = await fetch('/library/' + editing.id, {
                            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body),
                        });
                        if (!res.ok) { showError('Save failed: ' + (await res.text())); return; }
                        await loadLibrary();
                        showView('library');
                    } catch (e) { showError(e.message); }
                    finally { btn.disabled = false; btn.textContent = 'Save metadata'; }
                }

                async function reprocess() {
                    if (!editing) return;
                    const body = {
                        eq_preset: $('libFxEq').value || null,
                        mbc_preset: $('libFxMbc').value || null,
                        enhance_mode: $('libFxEnhance').value || null,
                        enhance_intensity: parseFloat($('libFxIntensity').value) || 1.5,
                        normalize_i: parseFloat($('libFxNormI').value) || -16,
                        normalize: $('libFxNorm').checked,
                        trim_silence: $('libFxTrim').checked,
                        original: $('libFxOriginal').checked,
                    };
                    const btn = $('libReprocess');
                    btn.disabled = true; btn.textContent = 'Rebuilding…';
                    try {
                        const res = await fetch('/library/' + editing.id + '/reprocess', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body),
                        });
                        if (!res.ok) { showError('Reprocess failed: ' + (await res.text())); return; }
                        await loadLibrary();
                        showView('library');
                    } catch (e) { showError(e.message); }
                    finally { btn.disabled = false; btn.textContent = 'Rebuild file with these effects'; }
                }

                async function deleteItem(id, name) {
                    if (!confirm(`Delete "${name}"? The MP3 and its sidecar are removed (the archived original is kept).`)) return;
                    try {
                        const res = await fetch('/library/' + id, { method: 'DELETE' });
                        if (!res.ok) { showError('Delete failed'); return; }
                        loadLibrary();
                    } catch (e) { showError(e.message); }
                }

                // Cover uploader for the edit view (reuses the shared resizer).
                wireCover($('libThumbUpload'), $('libEditThumb'), $('libUploadThumbBtn'), $('libResetThumbBtn'),
                    b64 => { libEditCoverBase64 = b64; }, () => libEditResetUrl);

                // Browse hero: Play all (first track; prev/next step the rest) + Back.
                // Back returns to where the group was opened from (full grid or All Tracks).
                $('libHeroPlay').addEventListener('click', () => { if (visibleItems.length) libTogglePlay(visibleItems[0].id); });
                $('libHeroBack').addEventListener('click', () => {
                    currentSource = currentSource.from === 'browseAll'
                        ? { type: 'browseAll', field: currentSource.field }
                        : { type: 'all' };
                    renderLibrary();
                });

                // Hero cover editing: upload a custom facet image / revert to the
                // first-track cover. (Reuses the playlist-cover resize approach.)
                function readImageAsJpegBase64(file, maxSide, cb) {
                    const rd = new FileReader();
                    rd.onload = ev => {
                        const im = new Image();
                        im.onload = () => {
                            let { width: w, height: h } = im;
                            const sc = Math.min(1, maxSide / Math.max(w, h));
                            w = Math.round(w * sc); h = Math.round(h * sc);
                            const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
                            const cx = cv.getContext('2d'); cx.fillStyle = '#000'; cx.fillRect(0, 0, w, h); cx.drawImage(im, 0, 0, w, h);
                            cb(cv.toDataURL('image/jpeg', 0.85).split(',')[1]);
                        };
                        im.onerror = () => showError('Could not read that image');
                        im.src = ev.target.result;
                    };
                    rd.readAsDataURL(file);
                }
                $('libHeroCoverEdit').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (currentSource.type !== 'browse') return;
                    const { field, value } = currentSource;
                    const items = [{ label: 'Upload image…', fn: () => $('libHeroCoverUpload').click() }];
                    if (hasFacetCover(field, value)) {
                        items.push({
                            label: 'Remove custom image', danger: true, fn: async () => {
                                try {
                                    await fetch(facetCoverUrl(field, value).split('?')[0], { method: 'DELETE' });
                                    (facetCovers[field] || new Set()).delete(value);
                                    renderLibrary();
                                } catch (err) { showError('Remove failed'); }
                            },
                        });
                    }
                    openMenu(e.currentTarget, items);
                });
                $('libHeroCoverUpload').addEventListener('change', (e) => {
                    const f = e.target.files[0]; e.target.value = '';
                    if (!f || currentSource.type !== 'browse') return;
                    const { field, value } = currentSource;
                    readImageAsJpegBase64(f, 600, async (b64) => {
                        try {
                            const res = await fetch(facetCoverUrl(field, value).split('?')[0], {
                                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ cover_base64: b64 }),
                            });
                            if (!res.ok) { showError('Upload failed: ' + (await res.text())); return; }
                            if (!facetCovers[field]) facetCovers[field] = new Set();
                            facetCovers[field].add(value);
                            facetCoverVer = Date.now();
                            renderLibrary();
                        } catch (err) { showError(err.message); }
                    });
                });

                // Wiring (view navigation)
                $('navDownload').addEventListener('click', () => showView('download'));
                $('navLibrary').addEventListener('click', () => { showView('library'); currentSource = { type: 'all' }; loadLibrary(); loadPlaylists(); });
                $('brandHome').addEventListener('click', () => showView('download'));

                // Playlist create unit
                // Mobile: toggle the playlist picker; tap the mini-player to expand.
                $('plToggle').addEventListener('click', () => $('libSidebar').classList.toggle('open'));
                $('npBody').addEventListener('click', (e) => {
                    if (e.target.closest('.np-controls') || e.target.closest('.np-seek') || e.target.closest('.np-queue')) return;
                    if (window.matchMedia('(max-width: 900px)').matches) {
                        $('nowPlaying').classList.add('np-expanded');   // mini-bar -> full sheet
                    }
                });
                $('npClose').addEventListener('click', (e) => {
                    e.stopPropagation();
                    $('nowPlaying').classList.remove('np-expanded');
                });

                $('plNewBtn').addEventListener('click', openCreate);
                $('plCreateCancel').addEventListener('click', () => { $('plCreate').style.display = 'none'; });
                $('plCreateSave').addEventListener('click', saveCreate);
                $('plKindManual').addEventListener('click', () => setKind('manual'));
                $('plKindDynamic').addEventListener('click', () => setKind('dynamic'));
                $('plAddFilter').addEventListener('click', () => {
                    const field = $('plFilterField').value, value = $('plFilterValue').value.trim();
                    if (!field || !value) return;
                    createFilters.push({ field, value }); $('plFilterValue').value = ''; renderPlChips();
                });
                $('plFilterValue').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('plAddFilter').click(); } });
                $('plCoverBtn').addEventListener('click', () => $('plCoverUpload').click());
                $('plCoverUpload').addEventListener('change', e => {
                    const f = e.target.files[0]; if (!f) return;
                    const rd = new FileReader();
                    rd.onload = ev => {
                        const im = new Image();
                        im.onload = () => {
                            const MAX = 600; let { width: w, height: h } = im;
                            const sc = Math.min(1, MAX / Math.max(w, h)); w = Math.round(w * sc); h = Math.round(h * sc);
                            const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
                            const cx = cv.getContext('2d'); cx.fillStyle = '#000'; cx.fillRect(0, 0, w, h); cx.drawImage(im, 0, 0, w, h);
                            createCoverBase64 = cv.toDataURL('image/jpeg', 0.85).split(',')[1];
                            $('plCoverBtn').textContent = 'Cover ✓';
                        };
                        im.onerror = () => showError('Could not read that image');
                        im.src = ev.target.result;
                    };
                    rd.readAsDataURL(f);
                });
                $('libBackBtn').addEventListener('click', () => showView('download'));
                $('libEditBackBtn').addEventListener('click', () => showView('library'));
                $('libRefreshBtn').addEventListener('click', async () => {
                    try { await fetch('/library/rebuild', { method: 'POST' }); } catch (e) {}
                    loadLibrary();
                });
                $('libSearch').addEventListener('input', renderLibrary);

                // Filter / sort controls
                $('libSortField').addEventListener('change', () => { libSort.field = $('libSortField').value; renderLibrary(); });
                $('libSortDir').addEventListener('click', () => {
                    libSort.dir *= -1;
                    $('libSortDir').textContent = libSort.dir < 0 ? '↓' : '↑';
                    renderLibrary();
                });
                $('libAddFilter').addEventListener('click', () => {
                    const field = $('libFilterField').value;
                    const value = $('libFilterValue').value.trim();
                    if (!field || !value) return;
                    libFilters.push({ field, value });
                    $('libFilterValue').value = '';
                    renderLibrary();
                });
                $('libFilterValue').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('libAddFilter').click(); } });

                // Now-playing controls
                $('npPlay').addEventListener('click', () => {
                    if (libPlayingId == null) { if (visibleItems[0]) playById(visibleItems[0].id); return; }
                    if (libAudio.paused) libAudio.play().catch(() => {}); else libAudio.pause();
                });
                $('npPrev').addEventListener('click', () => stepTrack(-1));
                $('npNext').addEventListener('click', () => stepTrack(1));
                $('npSeek').addEventListener('input', () => {
                    if (libAudio.duration) libAudio.currentTime = ($('npSeek').value / 1000) * libAudio.duration;
                });
                $('npFav').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const it = itemById(libPlayingId);
                    if (it) toggleFavorite(it);
                });
                $('npSleep').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const opt = (label, mode) => ({
                        label: (sleepMode === mode ? '✓ ' : '') + label,
                        fn: () => setSleepMode(mode),
                    });
                    openMenu(e.currentTarget, [
                        opt('Off', 'off'),
                        opt('15 minutes', 15),
                        opt('30 minutes', 30),
                        opt('60 minutes', 60),
                        opt('End of track', 'eot'),
                    ]);
                });
                $('npQueueClear').addEventListener('click', (e) => {
                    e.stopPropagation();
                    playQueue = [];
                    renderQueue();
                });
                $('libFavToggle').addEventListener('click', () => {
                    favOnly = !favOnly;
                    $('libFavToggle').classList.toggle('on', favOnly);
                    renderLibrary();
                });

                $('libTabMeta').addEventListener('click', showMetaPane);
                $('libTabFx').addEventListener('click', showFxPane);
                $('libAddTagBtn').addEventListener('click', () => addCustomTag($('libCustomTags')));
                $('libCopyMetaBtn').addEventListener('click', () => {
                    if (!editing) return;
                    openCopyMetaPicker((d) => {
                        // Rebuild the chip inputs with the copied values.
                        mountEditChips(d);
                        $('libYear').value = d.year || '';
                        const cont = $('libCustomTags'); cont.innerHTML = '';
                        Object.entries(d.custom_fields || {}).forEach(([k, v]) => addCustomTag(cont, k, v));
                    }, editing.id);
                });
                $('libSaveMeta').addEventListener('click', saveMeta);
                $('libReprocess').addEventListener('click', reprocess);

                // Reveal the Library nav only in server-save mode.
                fetch('/config').then(r => r.json()).then(cfg => {
                    if (cfg && cfg.browser_download_mode === false) {
                        window.serverSaveMode = true;
                        $('navLibrary').style.display = '';
                        // Copy-from needs a library to copy from.
                        const cm = document.getElementById('copyMetaBtn');
                        if (cm) cm.style.display = '';
                        // Library is the default landing in server-save mode.
                        showView('library');
                        loadLibrary();
                        loadPlaylists();
                        loadFacets();
                    }
                    // Apply the server Turbo default only if the user hasn't chosen.
                    const tt = document.getElementById('turboToggle');
                    if (tt && cfg && cfg.turbo_default && localStorage.getItem('youtify_turbo') === null) {
                        tt.checked = true;
                    }
                }).catch(() => {});
            })();
