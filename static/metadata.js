            // --- Custom Tags (reusable across the download form + library editor) ---
            // Generic library autocomplete via a native <datalist>. fieldOrFn is a
            // /suggestions field name (or a function returning one at fetch time,
            // used for custom-tag values keyed by the row's current key).
            let _suggestSeq = 0;
            function attachSuggest(input, fieldOrFn) {
                const dl = document.createElement('datalist');
                dl.id = 'dl' + (++_suggestSeq);
                input.setAttribute('list', dl.id);
                input.after(dl);
                const run = debounce(async () => {
                    const field = (typeof fieldOrFn === 'function') ? fieldOrFn() : fieldOrFn;
                    if (!field) { dl.innerHTML = ''; return; }
                    try {
                        const res = await fetch(`/suggestions?field=${encodeURIComponent(field)}&q=${encodeURIComponent(input.value)}`);
                        if (!res.ok) return;
                        const cur = input.value.trim().toLowerCase();
                        // Drop an exact match so the dropdown doesn't re-pop right
                        // after the user picks/types that value.
                        const list = ((await res.json()).suggestions || [])
                            .filter(v => String(v).toLowerCase() !== cur);
                        dl.innerHTML = list.map(v => `<option value="${String(v).replace(/"/g, '&quot;')}">`).join('');
                    } catch (e) { /* offline -> no suggestions */ }
                }, 150);
                input.addEventListener('input', run);
                input.addEventListener('focus', run);
            }

            function addCustomTag(container, key = '', value = '') {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex; gap:0.4rem; align-items:center;';
                row.innerHTML = `
                    <input type="text" placeholder="Key" value="${key}" class="custom-tag-key"
                        style="flex:1; padding:0.3rem 0.5rem; font-size:0.75rem; border-radius:6px; background:rgba(255,255,255,0.03); border:1px solid var(--card-border); color:#fff;">
                    <input type="text" placeholder="Value" value="${value}" class="custom-tag-value"
                        style="flex:2; padding:0.3rem 0.5rem; font-size:0.75rem; border-radius:6px; background:rgba(255,255,255,0.03); border:1px solid var(--card-border); color:#fff;">
                    <button type="button" onclick="this.parentElement.remove()"
                        style="width:24px; height:24px; padding:0; margin:0; border-radius:6px; background:rgba(255,0,80,0.15); border:1px solid rgba(255,0,80,0.3); flex-shrink:0; display:flex; align-items:center; justify-content:center;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                `;
                container.appendChild(row);
                const keyIn = row.querySelector('.custom-tag-key');
                const valIn = row.querySelector('.custom-tag-value');
                attachSuggest(keyIn, '__keys__');
                attachSuggest(valIn, () => keyIn.value.trim());
            }
            els.addTagBtn.addEventListener('click', () => addCustomTag(els.customTagsContainer));

            // Library-sourced autocomplete on the standard metadata fields.
            attachSuggest(els.metaAlbum, 'album');
            attachSuggest(els.metaYear, 'year');
            attachSuggest(document.getElementById('libAlbum'), 'album');
            attachSuggest(document.getElementById('libYear'), 'year');
            attachSuggest(document.getElementById('libComposer'), 'composer');

            function getCustomTags(container) {
                const tags = [];
                container.querySelectorAll(':scope > div').forEach(row => {
                    const key = row.querySelector('.custom-tag-key')?.value?.trim();
                    const val = row.querySelector('.custom-tag-value')?.value?.trim();
                    if (key && val) tags.push({ key, value: val });
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

            // --- Filename Preview (auto-generated from metadata) ---
            function updateFilenamePreview() {
                const title = els.metaTitle.value.trim() || 'Title';
                const artist = selectedArtists.length > 0 ? selectedArtists.join(', ') : '';
                const album = els.metaAlbum.value.trim();
                const composer = getCustomTags(els.customTagsContainer).find(t => t.key.toLowerCase() === 'composer')?.value || '';

                let parts = [title];
                if (album) parts[0] = `${title} (${album})`;
                if (artist || composer) {
                    let right = artist || '';
                    if (composer) right = right ? `${right} (${composer})` : composer;
                    parts.push(right);
                }
                els.filenamePreview.textContent = parts.join(' - ') + '.mp3';
            }
            // Update filename preview on any metadata field change
            ['metaTitle', 'metaAlbum'].forEach(id => {
                els[id].addEventListener('input', updateFilenamePreview);
            });
            // Also update filename when custom tags change (e.g. Composer)
            els.customTagsContainer.addEventListener('input', updateFilenamePreview);

            // Re-render tags when delimiter changes
            els.delimiterInput.addEventListener('input', () => {
                renderArtistTags();
                renderGenreTags();
            });

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
