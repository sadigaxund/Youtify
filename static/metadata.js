            // --- Custom Tags (reusable across the download form + library editor) ---
            // Generic library autocomplete via a native <datalist>. fieldOrFn is a
            // /suggestions field name (or a function returning one at fetch time,
            // used for custom-tag values keyed by the row's current key).
            // Single-value autocomplete with the same styled dropdown as the
            // Artist/Genre fields (native <datalist> didn't open on mobile and
            // looked out of place). Picking a suggestion fills the input. `fieldOrFn`
            // is a /suggestions field name or a function returning one.
            // Preset custom-tag keys, shown alongside keys already in the library —
            // a guide for what kind of metadata a tag row can hold.
            const PRESET_TAG_KEYS = ['Emotion', 'Mood', 'Language', 'BPM', 'Key', 'Rating', 'Composer', 'Instrument', 'Occasion', 'Energy'];
            function mergeKeySuggestions(libraryKeys, q) {
                const lf = (q || '').trim().toLowerCase();
                const presets = PRESET_TAG_KEYS.filter(k => !lf || k.toLowerCase().includes(lf));
                const seen = new Set();
                const out = [];
                [...libraryKeys, ...presets].forEach(k => {
                    const key = String(k).toLowerCase();
                    if (!seen.has(key)) { seen.add(key); out.push(k); }
                });
                return out;
            }

            function attachSuggest(input, fieldOrFn) {
                const wrap = document.createElement('span');
                wrap.className = 'suggest-wrap';
                input.parentNode.insertBefore(wrap, input);
                wrap.appendChild(input);
                input.style.width = '100%';
                const dd = document.createElement('div');
                dd.className = 'chip-suggest';
                dd.style.display = 'none';
                wrap.appendChild(dd);
                let curList = [], focusIdx = -1;
                const hide = () => { dd.style.display = 'none'; focusIdx = -1; };
                const highlight = () => Array.from(dd.children).forEach((c, i) => c.classList.toggle('active', i === focusIdx));
                const pick = (v) => { input.value = v; hide(); input.dispatchEvent(new Event('input', { bubbles: true })); };
                function renderDD(list) {
                    curList = list; focusIdx = -1; dd.innerHTML = '';
                    if (!list.length) { hide(); return; }
                    list.forEach(v => {
                        const it = document.createElement('div');
                        it.className = 'chip-suggest-item'; it.textContent = v;
                        it.addEventListener('mousedown', (e) => { e.preventDefault(); pick(v); });
                        dd.appendChild(it);
                    });
                    dd.style.display = 'block';
                }
                const run = debounce(async () => {
                    const field = (typeof fieldOrFn === 'function') ? fieldOrFn() : fieldOrFn;
                    if (!field) { hide(); return; }
                    const cur = input.value.trim().toLowerCase();
                    let list = [];
                    try {
                        const res = await fetch(`/suggestions?field=${encodeURIComponent(field)}&q=${encodeURIComponent(input.value)}`);
                        if (res.ok) list = (await res.json()).suggestions || [];
                    } catch (e) { /* offline / browser-download mode -> presets only */ }
                    // Custom-tag keys: blend in the preset keys as a guide for what
                    // can go there (library-sourced keys first).
                    if (field === '__keys__') list = mergeKeySuggestions(list, input.value);
                    list = list.filter(v => String(v).toLowerCase() !== cur);
                    if (!list.length) { hide(); return; }
                    renderDD(list);
                }, 150);
                input.addEventListener('input', run);
                input.addEventListener('focus', run);
                input.addEventListener('keydown', (e) => {
                    const n = dd.children.length;
                    if (e.key === 'ArrowDown') { e.preventDefault(); if (dd.style.display === 'none') { run(); return; } focusIdx = (focusIdx + 1) % n; highlight(); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!n) return; focusIdx = (focusIdx - 1 + n) % n; highlight(); }
                    else if (e.key === 'Enter' && focusIdx >= 0) { e.preventDefault(); pick(curList[focusIdx]); }
                    else if (e.key === 'Escape') { hide(); }
                });
                input.addEventListener('blur', () => setTimeout(hide, 150));
            }

            // Reusable multi-value chip input with a styled suggestion dropdown
            // (same look/behaviour as the Artist/Genre fields): type + Enter (or
            // comma) -> chip; Backspace on empty removes the last; clicking or
            // arrow+Enter on a suggestion adds it immediately. `suggestField` is a
            // /suggestions field name or a function returning one (per-row key).
            function makeChipValue(initialValues, suggestField, onChange) {
                const wrap = document.createElement('div');
                wrap.className = 'chip-input';
                wrap.style.position = 'relative';
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'chip-input-field';
                input.placeholder = 'value…';
                input.autocomplete = 'off';
                const dd = document.createElement('div');
                dd.className = 'chip-suggest';
                dd.style.display = 'none';
                let values = Array.isArray(initialValues) ? initialValues.slice() : [];
                let curList = [], focusIdx = -1;

                function render() {
                    wrap.querySelectorAll('.chip').forEach(c => c.remove());
                    values.forEach(v => {
                        const chip = document.createElement('span');
                        chip.className = 'chip';
                        chip.title = v;
                        const label = document.createElement('span');
                        label.className = 'chip-label';
                        label.textContent = v;
                        const x = document.createElement('span');
                        x.className = 'chip-x';
                        x.textContent = '×';
                        // Two-click delete: first click arms (chip turns red), second
                        // within 2.5s removes; anywhere else it disarms.
                        let confirmTimer = null;
                        x.addEventListener('click', (e) => {
                            e.stopPropagation();
                            if (chip.classList.contains('chip-confirm')) {
                                clearTimeout(confirmTimer);
                                values = values.filter(z => z !== v);
                                render(); fire();
                            } else {
                                chip.classList.add('chip-confirm');
                                confirmTimer = setTimeout(() => chip.classList.remove('chip-confirm'), 2500);
                            }
                        });
                        chip.append(label, x);
                        wrap.insertBefore(chip, input);
                    });
                    // No ghost placeholder once at least one chip is present.
                    input.placeholder = values.length ? '' : (input.getAttribute('data-ph') || 'value…');
                }
                function fire() {
                    if (onChange) onChange(values.slice());
                    if (typeof updateFilenamePreview === 'function') updateFilenamePreview();
                }
                function add(v) {
                    v = (v || '').trim();
                    if (v && !values.includes(v)) { values.push(v); render(); fire(); }
                    input.value = '';
                    hideDD();
                    fetchSuggest();   // refresh list (the added value drops out)
                }
                function hideDD() { dd.style.display = 'none'; focusIdx = -1; }
                function highlight() {
                    Array.from(dd.children).forEach((c, i) => c.classList.toggle('active', i === focusIdx));
                    if (focusIdx >= 0 && dd.children[focusIdx]) dd.children[focusIdx].scrollIntoView({ block: 'nearest' });
                }
                function renderDD(list) {
                    curList = list; focusIdx = -1; dd.innerHTML = '';
                    if (!list.length) { hideDD(); return; }
                    list.forEach(v => {
                        const it = document.createElement('div');
                        it.className = 'chip-suggest-item';
                        it.textContent = v;
                        it.addEventListener('mousedown', (e) => { e.preventDefault(); add(v); });
                        dd.appendChild(it);
                    });
                    dd.style.display = 'block';
                }
                const fetchSuggest = debounce(async () => {
                    const field = (typeof suggestField === 'function') ? suggestField() : suggestField;
                    if (!field) { hideDD(); return; }
                    try {
                        const res = await fetch(`/suggestions?field=${encodeURIComponent(field)}&q=${encodeURIComponent(input.value)}`);
                        if (!res.ok) { hideDD(); return; }
                        const cur = input.value.trim().toLowerCase();
                        const list = ((await res.json()).suggestions || [])
                            .filter(v => !values.includes(v) && String(v).toLowerCase() !== cur);
                        renderDD(list);
                    } catch (e) { hideDD(); }
                }, 150);

                input.addEventListener('input', fetchSuggest);
                input.addEventListener('focus', fetchSuggest);
                input.addEventListener('keydown', (e) => {
                    const items = dd.children;
                    if (e.key === 'ArrowDown') { e.preventDefault(); if (dd.style.display === 'none') { fetchSuggest(); return; } focusIdx = (focusIdx + 1) % items.length; highlight(); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!items.length) return; focusIdx = (focusIdx - 1 + items.length) % items.length; highlight(); }
                    else if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(focusIdx >= 0 ? curList[focusIdx] : input.value); }
                    else if (e.key === 'Escape') { hideDD(); }
                    else if (e.key === 'Backspace' && !input.value && values.length) { values.pop(); render(); fire(); }
                });
                input.addEventListener('blur', () => { setTimeout(() => { if (input.value.trim()) add(input.value); hideDD(); }, 150); });
                wrap.appendChild(input);
                wrap.appendChild(dd);
                wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target === input) input.focus(); });
                render();
                return {
                    wrap,
                    getValues: () => values.slice(),
                    setValues: (vals) => { values = (vals || []).slice(); render(); fire(); },
                    input,
                };
            }

            function addCustomTag(container, key = '', value = '') {
                const row = document.createElement('div');
                row.className = 'custom-tag-row';
                const keyIn = document.createElement('input');
                keyIn.type = 'text';
                keyIn.className = 'custom-tag-key';
                keyIn.placeholder = 'Key';
                keyIn.value = key;
                // Split an incoming joined value into individual chips.
                const initial = value ? String(value).split(/[|,;]/).map(s => s.trim()).filter(Boolean) : [];
                const chip = makeChipValue(initial, () => keyIn.value.trim());
                chip.wrap.classList.add('custom-tag-value');
                const rm = document.createElement('button');
                rm.type = 'button';
                rm.className = 'custom-tag-rm';
                rm.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
                rm.addEventListener('click', () => { row.remove(); if (typeof updateFilenamePreview === 'function') updateFilenamePreview(); });
                row.append(keyIn, chip.wrap, rm);
                container.appendChild(row);
                attachSuggest(keyIn, '__keys__');
                // Expose getters for getCustomTags (chips aren't readable from DOM value).
                row._getKey = () => keyIn.value.trim();
                row._getValues = () => chip.getValues();
            }
            els.addTagBtn.addEventListener('click', () => addCustomTag(els.customTagsContainer));

            // Library-sourced autocomplete on the standard metadata fields.
            attachSuggest(els.metaYear, 'year');
            attachSuggest(document.getElementById('libYear'), 'year');

            // Album is multi-value (chips). The hidden #metaAlbum input keeps the
            // delimiter-joined string so /save and the filename flow are unchanged;
            // the backend stores the first value as the canonical ALBUM tag
            // (Jellyfin-compatible) and the full list as ALBUMS.
            els.metaAlbum.type = 'hidden';
            const albumChips = makeChipValue([], 'album', (vals) => {
                els.metaAlbum.value = vals.join((els.delimiterInput && els.delimiterInput.value) || '|');
            });
            albumChips.input.setAttribute('data-ph', 'Album name…');
            albumChips.input.placeholder = 'Album name…';
            els.metaAlbum.parentNode.insertBefore(albumChips.wrap, els.metaAlbum);
            // Used by search.js (source load) and pipeline.js (New/reset).
            window.setAlbums = (vals) => albumChips.setValues(vals);
            window.getAlbums = () => albumChips.getValues();

            function getCustomTags(container) {
                const tags = [];
                const delim = (els.delimiterInput && els.delimiterInput.value) || '|';
                container.querySelectorAll(':scope > .custom-tag-row').forEach(row => {
                    const key = row._getKey ? row._getKey() : '';
                    const vals = row._getValues ? row._getValues() : [];
                    // Multiple chips are stored as one delimiter-joined value (so the
                    // DB/embedding stay single-string; the UI keeps them individual).
                    if (key && vals.length) tags.push({ key, value: vals.join(delim) });
                });
                return tags;
            }

            // --- localStorage history (previously entered genres / artists) ---
            // Stored client-side so suggestions persist across sessions without a
            // backend. Most-recent-first, deduped (case-insensitive), capped.
            const HIST = {
                GENRES: 'youtify_genres',
                ARTISTS: 'youtify_artists',
                load(key) { try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; } },
                add(key, val) {
                    val = (val || '').trim();
                    if (!val) return;
                    let arr = HIST.load(key).filter(x => x.toLowerCase() !== val.toLowerCase());
                    arr.unshift(val);
                    localStorage.setItem(key, JSON.stringify(arr.slice(0, 200)));
                }
            };

            // --- Genre Multi-Select with Autocomplete ---
            // Built-in seed genres. User-entered genres are remembered separately in
            // localStorage (HIST.GENRES) and float to the top of suggestions.
            const GENRE_SEED = [
                // Pop / rock / urban
                'Pop', 'Rock', 'Hip-Hop', 'Rap', 'R&B', 'Soul', 'Funk', 'Disco', 'Blues', 'Country', 'Folk',
                'Americana', 'Bluegrass', 'Singer-Songwriter', 'Alternative', 'Indie', 'Indie Pop', 'Indie Rock',
                'Punk', 'Pop Punk', 'Emo', 'Hardcore', 'Grunge', 'Shoegaze', 'Post-Rock', 'Math Rock',
                'Progressive Rock', 'Psychedelic', 'Garage Rock', 'Surf', 'Metal', 'Heavy Metal', 'Metalcore',
                'Death Metal', 'Black Metal', 'Doom Metal', 'Nu Metal', 'Gospel', 'Choir', 'A Cappella',
                // Electronic / dance
                'Electronic', 'EDM', 'Dance', 'House', 'Deep House', 'Tech House', 'Progressive House',
                'Techno', 'Trance', 'Dubstep', 'Drum & Bass', 'Garage', 'UK Garage', 'Breakbeat', 'Hardstyle',
                'Future Bass', 'Trap', 'Drill', 'Phonk', 'Synthwave', 'Vaporwave', 'Chillwave', 'Chillout',
                'Chillhop', 'Lo-Fi', 'Lo-Fi Hip-Hop', 'Ambient', 'Downtempo', 'New Age', 'IDM',
                // Jazz family
                'Jazz', 'Smooth Jazz', 'Bebop', 'Swing', 'Big Band', 'Fusion', 'Bossa Nova', 'Boogie',
                // World / regional
                'Latin', 'Reggaeton', 'Salsa', 'Bachata', 'Cumbia', 'Tango', 'Flamenco', 'Reggae', 'Ska',
                'Dancehall', 'Afrobeat', 'Afrobeats', 'Amapiano', 'K-Pop', 'J-Pop', 'C-Pop', 'City Pop',
                'Anime', 'Bollywood', 'Arabic', 'Turkish', 'Celtic', 'World',
                // Classical & instrumental
                'Classical', 'Baroque', 'Romantic', 'Medieval', 'Renaissance', 'Impressionist', 'Modern',
                'Contemporary', 'Minimalism', 'Neoclassical', 'Orchestra', 'Concerto', 'Symphony', 'Sonata',
                'Suite', 'Partita', 'Rondo', 'Theme and Variations', 'Fugue', 'Prelude', 'Etude', 'Nocturne',
                'Waltz', 'Mazurka', 'Polonaise', 'Minuet', 'Scherzo', 'Toccata', 'Fantasia', 'Rhapsody',
                'Overture', 'Sinfonia concertante', 'Mass', 'Opera', 'Oratorio', 'Cantata',
                'Piano', 'Violin', 'Cello', 'Flute', 'Guitar', 'Harp', 'Kalimba', 'Acoustic', 'Instrumental',
                // Soundtrack & functional
                'Soundtrack', 'Film Score', 'Video Game', 'Cinematic', 'Epic', 'Trailer', 'Meditation',
                'Study', 'Workout', 'Cover', 'Original', 'Remix', 'Live', 'Holiday', 'Christmas'
            ];
            // Merged candidate list: user history first (recent), then seed, deduped.
            function genreCandidates() {
                const seen = new Set();
                const out = [];
                [...remoteGenres, ...HIST.load(HIST.GENRES), ...GENRE_SEED].forEach(g => {
                    const k = g.toLowerCase();
                    if (!seen.has(k)) { seen.add(k); out.push(g); }
                });
                return out;
            }
            let selectedGenres = [];
            let selectedArtists = [];

            // --- Backend tag suggestions (merge with localStorage) ---
            // The server suggests artists/genres seen in previously saved tracks
            // (save-dir mode). localStorage stays as an offline fallback. Results
            // are debounced and, when they arrive, re-render the open dropdown.
            let remoteArtists = [];
            let remoteGenres = [];
            function debounce(fn, ms) {
                let t;
                return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
            }
            async function fetchSuggest(kind, q, onResult) {
                try {
                    const res = await fetch(`/suggestions?kind=${kind}&q=${encodeURIComponent(q || '')}`);
                    if (!res.ok) return; // 404 in browser-download mode -> just use localStorage
                    const data = await res.json();
                    onResult(data.suggestions || []);
                } catch (e) { /* offline -> localStorage only */ }
            }
            const fetchArtistSuggest = debounce((q) => fetchSuggest('artist', q, (s) => {
                remoteArtists = s;
                if (document.activeElement === els.artistInput) showArtistDropdown(els.artistInput.value);
            }), 150);
            const fetchGenreSuggest = debounce((q) => fetchSuggest('genre', q, (s) => {
                remoteGenres = s;
                if (document.activeElement === els.genreInput) showGenreDropdown(els.genreInput.value);
            }), 150);
            function mergeUnique(...lists) {
                const seen = new Set(), out = [];
                for (const list of lists) for (const v of list) {
                    const k = (v || '').toLowerCase();
                    if (v && !seen.has(k)) { seen.add(k); out.push(v); }
                }
                return out;
            }

            // --- Artist Multi-Tag Input ---
            function renderArtistTags() {
                els.artistContainer.querySelectorAll('.artist-tag').forEach(t => t.remove());
                const input = els.artistInput;
                selectedArtists.forEach(artist => {
                    const tag = document.createElement('span');
                    tag.className = 'artist-tag';
                    tag.style.cssText = 'display:inline-flex; align-items:center; gap:0.2rem; padding:0.15rem 0.45rem; font-size:0.7rem; border-radius:6px; background:rgba(100,140,255,0.15); border:1px solid rgba(100,140,255,0.3); color:rgba(140,170,255,1); white-space:nowrap; cursor:default;';
                    tag.innerHTML = `${artist}<span onclick="removeArtist('${artist.replace(/'/g, "\\\'")}')" style="cursor:pointer; margin-left:0.15rem; opacity:0.7; font-size:0.85em;">&times;</span>`;
                    els.artistContainer.insertBefore(tag, input);
                });
                els.metaArtist.value = selectedArtists.join(els.delimiterInput.value || '|');
                updateFilenamePreview();
            }

            function addArtist(name) {
                name = name.trim();
                if (!name || selectedArtists.includes(name)) return;
                selectedArtists.push(name);
                HIST.add(HIST.ARTISTS, name); // remember for future suggestions
                renderArtistTags();
                els.artistInput.value = '';
                setTimeout(() => showArtistDropdown(''), 50);
            }

            window.removeArtist = function (name) {
                selectedArtists = selectedArtists.filter(a => a !== name);
                renderArtistTags();
            };

            // Artist autocomplete sourced purely from localStorage history.
            let currentArtistFocus = -1;

            function showArtistDropdown(filter = '') {
                currentArtistFocus = -1;
                const dd = els.artistDropdown;
                dd.innerHTML = '';
                const lf = filter.toLowerCase();
                const matches = mergeUnique(remoteArtists, HIST.load(HIST.ARTISTS)).filter(a =>
                    !selectedArtists.includes(a) && a.toLowerCase().includes(lf)
                ).slice(0, 12);

                if (matches.length === 0) { dd.style.display = 'none'; return; }

                matches.forEach(artist => {
                    const item = document.createElement('div');
                    item.textContent = artist;
                    item.className = 'artist-item';
                    item.style.cssText = 'padding:0.45rem 0.75rem; font-size:0.78rem; cursor:pointer; color:rgba(255,255,255,0.85); transition:all 0.15s ease; border-bottom:1px solid rgba(255,255,255,0.04);';
                    item.onmouseenter = () => {
                        Array.from(dd.children).forEach(c => { c.style.background = 'transparent'; c.classList.remove('active'); });
                        item.classList.add('active'); item.style.background = 'rgba(100,140,255,0.12)';
                    };
                    item.onmouseleave = () => { item.classList.remove('active'); item.style.background = 'transparent'; };
                    item.onmousedown = (e) => { e.preventDefault(); addArtist(artist); };
                    dd.appendChild(item);
                });
                dd.style.display = 'block';
            }

            function hideArtistDropdown() { els.artistDropdown.style.display = 'none'; currentArtistFocus = -1; }

            function setArtistActive(items) {
                if (!items || !items.length) return;
                Array.from(items).forEach(i => { i.classList.remove('active'); i.style.background = 'transparent'; });
                if (currentArtistFocus >= items.length) currentArtistFocus = 0;
                if (currentArtistFocus < 0) currentArtistFocus = items.length - 1;
                const t = items[currentArtistFocus];
                t.classList.add('active'); t.style.background = 'rgba(100,140,255,0.12)';
                t.scrollIntoView({ block: 'nearest' });
                els.artistInput.value = t.textContent;
            }

            els.artistInput.addEventListener('input', () => { fetchArtistSuggest(els.artistInput.value); showArtistDropdown(els.artistInput.value); });
            els.artistInput.addEventListener('focus', () => { fetchArtistSuggest(els.artistInput.value); showArtistDropdown(els.artistInput.value); });
            els.artistInput.addEventListener('keydown', (e) => {
                const items = els.artistDropdown.getElementsByClassName('artist-item');
                if (e.key === 'ArrowDown') {
                    currentArtistFocus++; setArtistActive(items); e.preventDefault();
                    if (els.artistDropdown.style.display === 'none') showArtistDropdown(els.artistInput.value);
                } else if (e.key === 'ArrowUp') {
                    currentArtistFocus--; setArtistActive(items); e.preventDefault();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = els.artistInput.value.trim();
                    if (val) addArtist(val);
                } else if (e.key === 'Backspace' && !els.artistInput.value && selectedArtists.length > 0) {
                    selectedArtists.pop();
                    renderArtistTags();
                }
            });
            // Auto-add pending text when clicking away
            els.artistInput.addEventListener('blur', () => {
                setTimeout(hideArtistDropdown, 150);
                const val = els.artistInput.value.trim();
                if (val) addArtist(val);
            });

            function renderGenreTags() {
                // Remove existing tags (but keep the input)
                els.genreContainer.querySelectorAll('.genre-tag').forEach(t => t.remove());
                const input = els.genreInput;
                selectedGenres.forEach(genre => {
                    const tag = document.createElement('span');
                    tag.className = 'genre-tag';
                    tag.style.cssText = 'display:inline-flex; align-items:center; gap:0.2rem; padding:0.15rem 0.45rem; font-size:0.7rem; border-radius:6px; background:rgba(255,0,80,0.15); border:1px solid rgba(255,0,80,0.3); color:var(--primary); white-space:nowrap; cursor:default;';
                    tag.innerHTML = `${genre}<span onclick="removeGenre('${genre.replace(/'/g, "\\'")}')"
                        style="cursor:pointer; margin-left:0.15rem; opacity:0.7; font-size:0.85em;">&times;</span>`;
                    els.genreContainer.insertBefore(tag, input);
                });
                // Update hidden field with chosen delimiter
                els.metaGenre.value = selectedGenres.join(els.delimiterInput.value || '|');
                updateFilenamePreview();
            }

            function toTitleCase(str) {
                return str.replace(/\w\S*/g, function (txt) {
                    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
                });
            }

            function addGenre(genre) {
                genre = genre.trim();
                // 1. Capitalize first letter of each word
                if (genre) genre = toTitleCase(genre);

                if (!genre || selectedGenres.includes(genre)) return;
                selectedGenres.push(genre);
                HIST.add(HIST.GENRES, genre); // remember for future suggestions
                renderGenreTags();
                els.genreInput.value = '';
                // Re-show dropdown since focus is still on the input
                setTimeout(() => showGenreDropdown(''), 50);
            }

            window.removeGenre = function (genre) {
                selectedGenres = selectedGenres.filter(g => g !== genre);
                renderGenreTags();
            };

            let currentGenreFocus = -1;

            function showGenreDropdown(filter = '') {
                currentGenreFocus = -1; // Reset focus
                const dd = els.genreDropdown;
                dd.innerHTML = '';
                const lf = filter.toLowerCase();
                const matches = genreCandidates().filter(g =>
                    !selectedGenres.includes(g) && g.toLowerCase().includes(lf)
                ).slice(0, 15);

                if (matches.length === 0 && filter.length === 0) { dd.style.display = 'none'; return; }

                matches.forEach((genre, i) => {
                    const item = document.createElement('div');
                    item.textContent = genre;
                    item.className = 'genre-item'; // Class for easy selection
                    item.style.cssText = `padding:0.45rem 0.75rem; font-size:0.78rem; cursor:pointer; color:rgba(255,255,255,0.85); transition:all 0.15s ease; border-bottom:1px solid rgba(255,255,255,0.04); letter-spacing:0.01em;`;
                    if (i === 0) item.style.borderRadius = '9px 9px 0 0';
                    item.onmouseenter = () => {
                        // Remove active from others
                        Array.from(dd.children).forEach(c => {
                            c.style.background = 'transparent';
                            c.style.color = 'rgba(255,255,255,0.85)';
                            c.classList.remove('active');
                        });
                        item.classList.add('active');
                        item.style.background = 'rgba(255,255,255,0.08)';
                        item.style.color = '#fff';
                    };
                    item.onmouseleave = () => {
                        item.classList.remove('active');
                        item.style.background = 'transparent';
                        item.style.color = 'rgba(255,255,255,0.85)';
                    };
                    item.onmousedown = (e) => { e.preventDefault(); addGenre(genre); };
                    dd.appendChild(item);
                });

                // If typed text doesn't exactly match any genre, show "Add custom" option
                if (filter && !genreCandidates().some(g => g.toLowerCase() === lf) && !selectedGenres.some(g => g.toLowerCase() === lf)) {
                    const custom = document.createElement('div');
                    custom.className = 'genre-item';
                    custom.textContent = filter; // Use textContent for consistency in navigation
                    custom.innerHTML = `<span style="opacity:0.5">+</span> Add "<strong>${filter}</strong>"`;
                    custom.dataset.value = filter; // Store value
                    custom.style.cssText = 'padding:0.45rem 0.75rem; font-size:0.78rem; cursor:pointer; color:var(--primary); transition:all 0.15s ease; border-top:1px solid rgba(255,255,255,0.06); border-radius:0 0 9px 9px;';
                    custom.onmouseenter = () => custom.style.background = 'rgba(255,0,80,0.08)';
                    custom.onmouseleave = () => custom.style.background = 'transparent';
                    custom.onmousedown = (e) => { e.preventDefault(); addGenre(filter); };
                    dd.appendChild(custom);
                }

                // Round last item if no custom option
                if (dd.lastChild && !filter) dd.lastChild.style.borderRadius = '0 0 9px 9px';

                dd.style.display = matches.length > 0 || filter ? 'block' : 'none';
            }

            function setActive(items) {
                if (!items || items.length === 0) return;

                // Remove active class/style from all
                Array.from(items).forEach(item => {
                    item.classList.remove('active');
                    item.style.background = 'transparent';
                    item.style.color = 'rgba(255,255,255,0.85)';
                    // Restore custom item color if needed, simplified for focus
                    if (item.innerHTML.includes('Add "')) item.style.color = 'var(--primary)';
                });

                if (currentGenreFocus >= items.length) currentGenreFocus = 0;
                if (currentGenreFocus < 0) currentGenreFocus = items.length - 1;

                const target = items[currentGenreFocus];
                target.classList.add('active');

                // Styling for active state
                if (target.innerHTML.includes('Add "')) {
                    target.style.background = 'rgba(255,0,80,0.08)';
                } else {
                    target.style.background = 'rgba(255,255,255,0.08)';
                    target.style.color = '#fff';
                }

                target.scrollIntoView({ block: 'nearest' });

                // Update input value
                const val = target.dataset.value || target.textContent;
                els.genreInput.value = val;
            }

            function hideGenreDropdown() {
                els.genreDropdown.style.display = 'none';
                currentGenreFocus = -1;
            }

            els.genreInput.addEventListener('input', () => { fetchGenreSuggest(els.genreInput.value); showGenreDropdown(els.genreInput.value); });
            els.genreInput.addEventListener('focus', () => { fetchGenreSuggest(els.genreInput.value); showGenreDropdown(els.genreInput.value); });
            els.genreInput.addEventListener('blur', () => setTimeout(hideGenreDropdown, 150));
            els.genreInput.addEventListener('keydown', (e) => {
                const dd = els.genreDropdown;
                const items = dd.getElementsByClassName('genre-item');

                if (e.key === 'ArrowDown') {
                    currentGenreFocus++;
                    setActive(items);
                    e.preventDefault(); // Prevent cursor moving
                    if (dd.style.display === 'none') showGenreDropdown(els.genreInput.value);
                } else if (e.key === 'ArrowUp') {
                    currentGenreFocus--;
                    setActive(items);
                    e.preventDefault();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (currentGenreFocus > -1 && items[currentGenreFocus]) {
                        // Select the active item
                        const val = items[currentGenreFocus].dataset.value || items[currentGenreFocus].textContent;
                        addGenre(val);
                    } else {
                        // Standard enter behavior
                        const val = els.genreInput.value.trim();
                        if (val) addGenre(val);
                    }
                } else if (e.key === 'Backspace' && !els.genreInput.value && selectedGenres.length > 0) {
                    selectedGenres.pop();
                    renderGenreTags();
                }
            });

            // --- Output & technical: format flow + filename (auto + custom) ---
            // The export extension follows the chosen format ('auto' resolves to
            // flac for a lossless source, else mp3 — same rule as the backend).
            function resolvedExt() {
                const f = els.formatSelect ? els.formatSelect.value : 'auto';
                if (f === 'auto') return currentSourceLossless ? 'flac' : 'mp3';
                return f;
            }
            // The auto-generated base name (no extension), from the metadata.
            function autoFilenameBase() {
                const title = els.metaTitle.value.trim() || 'Title';
                const artist = selectedArtists.length > 0 ? selectedArtists.join(', ') : '';
                const album = (getAlbums()[0] || '').trim();   // first album only (canonical)
                const composer = getCustomTags(els.customTagsContainer).find(t => t.key.toLowerCase() === 'composer')?.value || '';
                let parts = [title];
                if (album) parts[0] = `${title} (${album})`;
                if (artist || composer) {
                    let right = artist || '';
                    if (composer) right = right ? `${right} (${composer})` : composer;
                    parts.push(right);
                }
                return parts.join(' - ');
            }
            // The base name actually used for the saved file (custom overrides auto).
            function currentFilenameBase() {
                if (els.filenameCustomToggle && els.filenameCustomToggle.checked) {
                    const v = (els.filenameCustom.value || '').trim();
                    if (v) return v;
                }
                return autoFilenameBase();
            }
            function updateFilenamePreview() {
                els.filenamePreview.textContent = currentFilenameBase() + '.' + resolvedExt();
            }
            // Source -> Target format display in the Output panel.
            function updateFmtFlow() {
                if (els.srcFmt) els.srcFmt.textContent = currentSrcLabel;
                if (els.fmtResolved) {
                    const auto = els.formatSelect && els.formatSelect.value === 'auto';
                    els.fmtResolved.textContent = auto ? '→ ' + resolvedExt().toUpperCase() : '';
                }
            }

            // Update filename preview on any metadata field change
            // (album chips trigger it via their own change hook)
            els.metaTitle.addEventListener('input', updateFilenamePreview);
            // Also update filename when custom tags change (e.g. Composer)
            els.customTagsContainer.addEventListener('input', updateFilenamePreview);

            // Re-render tags when delimiter changes
            els.delimiterInput.addEventListener('input', () => {
                renderArtistTags();
                renderGenreTags();
                // Re-join the hidden album field with the new delimiter.
                els.metaAlbum.value = albumChips.getValues().join(els.delimiterInput.value || '|');
            });

            // Output panel wiring: collapse/expand, format flow, custom filename.
            if (els.techToggle) {
                els.techToggle.addEventListener('click', () => {
                    const open = els.techBody.style.display !== 'none';
                    els.techBody.style.display = open ? 'none' : 'flex';
                    els.techToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
                });
            }
            if (els.formatSelect) {
                els.formatSelect.addEventListener('change', () => { updateFmtFlow(); updateFilenamePreview(); });
            }
            if (els.filenameCustomToggle) {
                els.filenameCustomToggle.addEventListener('change', () => {
                    const on = els.filenameCustomToggle.checked;
                    // Same field swaps to an editable input; pencil <-> revert swap too.
                    els.filenameCustom.style.display = on ? 'block' : 'none';
                    els.filenamePreview.style.display = on ? 'none' : 'block';
                    if (els.filenameEditBtn) els.filenameEditBtn.style.display = on ? 'none' : '';
                    if (els.filenameAutoBtn) els.filenameAutoBtn.style.display = on ? '' : 'none';
                    if (on) { if (!els.filenameCustom.value) els.filenameCustom.value = autoFilenameBase(); els.filenameCustom.focus(); }
                    updateFilenamePreview();
                });
                // Pencil (appears on hover) -> edit; ↺ -> back to the generated name.
                if (els.filenameEditBtn) els.filenameEditBtn.addEventListener('click', () => {
                    els.filenameCustomToggle.checked = true;
                    els.filenameCustomToggle.dispatchEvent(new Event('change'));
                });
                if (els.filenameAutoBtn) els.filenameAutoBtn.addEventListener('click', () => {
                    els.filenameCustom.value = '';
                    els.filenameCustomToggle.checked = false;
                    els.filenameCustomToggle.dispatchEvent(new Event('change'));
                });
                els.filenameCustom.addEventListener('input', updateFilenamePreview);
            }

            els.originalToggle.addEventListener('change', () => {
                const isOriginal = els.originalToggle.checked;
                els.advancedControls.style.opacity = isOriginal ? '0.3' : '1';
                els.advancedControls.style.pointerEvents = isOriginal ? 'none' : 'auto';

                // When enabling Original, clear all effect toggles
                if (isOriginal) {
                    els.normalizeToggle.checked = false;
                    els.eqToggle.checked = false;
                    if (els.mbcToggle) els.mbcToggle.checked = false;
                    els.enhanceModeSelect.value = '';
                    els.trimSilenceToggle.checked = false;
                }
                onEffectChange();
            });

            // --- Global dropdown dismissal ---
            // The per-input blur handlers use a 150ms grace timeout, which can lose
            // the race (e.g. blur to a non-focusable element) and leave a dropdown
            // stuck open. Capture-phase pointerdown + Escape close everything.
            function hideAllSuggestDropdowns() {
                document.querySelectorAll('.chip-suggest').forEach(d => { d.style.display = 'none'; });
                hideArtistDropdown();
                hideGenreDropdown();
            }
            document.addEventListener('pointerdown', (e) => {
                if (!e.target.closest('.suggest-wrap, .chip-input')) {
                    document.querySelectorAll('.chip-suggest').forEach(d => { d.style.display = 'none'; });
                }
                if (!e.target.closest('#artistContainer, #artistDropdown')) hideArtistDropdown();
                if (!e.target.closest('#genreContainer, #genreDropdown')) hideGenreDropdown();
            }, true);
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideAllSuggestDropdowns(); });

            // --- Copy metadata from another saved track ---
            // Searchable picker over the library; onPick receives the full track
            // detail (GET /library/{id}). excludeId hides the track being edited.
            async function openCopyMetaPicker(onPick, excludeId) {
                let items = [];
                try {
                    const res = await fetch('/library');
                    if (!res.ok) { showError('Library unavailable'); return; }
                    items = (await res.json()).items || [];
                } catch (e) { showError('Library unavailable'); return; }
                items = items.filter(it => it.id !== excludeId);

                const ov = document.createElement('div');
                ov.className = 'copy-overlay';
                ov.innerHTML = `
                    <div class="copy-panel" role="dialog" aria-modal="true">
                        <h3>Copy metadata from…</h3>
                        <input type="text" class="copy-search" placeholder="Search tracks…" autocomplete="off">
                        <div class="copy-list"></div>
                    </div>`;
                document.body.appendChild(ov);
                const search = ov.querySelector('.copy-search');
                const list = ov.querySelector('.copy-list');
                const close = () => ov.remove();
                ov.addEventListener('click', e => { if (e.target === ov) close(); });
                document.addEventListener('keydown', function esc(e) {
                    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
                });

                function renderList(q) {
                    const lf = (q || '').toLowerCase();
                    const matches = items.filter(it => {
                        const hay = [it.title, (it.artists || []).join(' '), it.album].filter(Boolean).join(' ').toLowerCase();
                        return !lf || hay.includes(lf);
                    }).slice(0, 50);
                    list.innerHTML = '';
                    if (!matches.length) {
                        list.innerHTML = '<div class="copy-empty">No matching tracks.</div>';
                        return;
                    }
                    matches.forEach(it => {
                        const row = document.createElement('div');
                        row.className = 'copy-row';
                        const img = document.createElement('img');
                        img.src = `/library/${it.id}/cover?v=${encodeURIComponent(it.updated_at || '')}`;
                        img.onerror = () => { img.style.visibility = 'hidden'; };
                        const txt = document.createElement('div');
                        txt.className = 'copy-row-text';
                        txt.innerHTML = `<div class="copy-row-title"></div><div class="copy-row-sub"></div>`;
                        txt.querySelector('.copy-row-title').textContent = it.title || it.filename || it.id;
                        txt.querySelector('.copy-row-sub').textContent = (it.artists || []).join(', ');
                        row.append(img, txt);
                        row.addEventListener('click', async () => {
                            try {
                                const res = await fetch('/library/' + it.id);
                                if (!res.ok) { showError('Track not found'); return; }
                                onPick(await res.json());
                                close();
                            } catch (e) { showError(e.message); }
                        });
                        list.appendChild(row);
                    });
                }
                search.addEventListener('input', () => renderList(search.value));
                renderList('');
                search.focus();
            }

            // Download form: fill everything except title + cover.
            const copyMetaBtn = document.getElementById('copyMetaBtn');
            if (copyMetaBtn) copyMetaBtn.addEventListener('click', () => openCopyMetaPicker((d) => {
                selectedArtists = (d.artists || []).slice(); renderArtistTags();
                selectedGenres = (d.genres || []).slice(); renderGenreTags();
                setAlbums(d.albums && d.albums.length ? d.albums : (d.album ? [d.album] : []));
                els.metaYear.value = d.year || '';
                els.customTagsContainer.innerHTML = '';
                Object.entries(d.custom_fields || {}).forEach(([k, v]) => addCustomTag(els.customTagsContainer, k, v));
                updateFilenamePreview();
            }));
