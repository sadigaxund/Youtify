            // --- A/B Compare snapshots ---
            // Each Play records the current effect set as a chip. Click a chip to
            // hear that combo instantly (cached server-side) without disturbing the
            // live controls; "load" copies it back into the controls; ✕ removes it.
            let snapshots = [];
            let activeSnapshotId = null;
            let snapSeq = 0;

            function paramsKey(p) {
                return [p.eq_preset || '', p.mbc_preset || '', p.enhance_mode || '', p.enhance_intensity,
                !!p.normalize, p.normalize_i, !!p.original].join('|');
            }
            // Loudness target -> friendly word (no LUFS numbers in the UI).
            const LOUD_LABEL = { '-12': 'Loud', '-16': 'Normal', '-23': 'Quiet' };
            function snapParts(p) {
                if (p.original) return ['Original'];
                const lvl = { '1': 'Lo', '1.0': 'Lo', '1.5': 'Md', '2': 'Hi', '2.0': 'Hi' }[String(p.enhance_intensity)] || '';
                const bits = [];
                if (p.eq_preset) bits.push('EQ ' + p.eq_preset);
                if (p.mbc_preset) bits.push('Cmp ' + p.mbc_preset);
                if (p.enhance_mode) bits.push(p.enhance_mode + (lvl ? ' ' + lvl : ''));
                if (p.normalize) bits.push(LOUD_LABEL[String(p.normalize_i)] || ('Norm ' + p.normalize_i));
                return bits.length ? bits : ['Dry'];
            }
            function snapLabel(p) { return snapParts(p).join(' · '); }
            const MAX_SNAPSHOTS = 200;
            function recordSnapshot(p) {
                const key = paramsKey(p);
                let s = snapshots.find(x => paramsKey(x.params) === key);
                if (!s) {
                    s = { id: ++snapSeq, params: { ...p }, label: snapLabel(p) };
                    snapshots.unshift(s);
                    if (snapshots.length > MAX_SNAPSHOTS) snapshots.length = MAX_SNAPSHOTS;
                }
                activeSnapshotId = s.id;
            }
            // Add a combo as a chip WITHOUT rendering it (batch generate). Chips
            // render lazily on click via loadSnapshot. Returns false if duplicate
            // or the cap is reached.
            function addSnapshotLazy(p) {
                if (snapshots.length >= MAX_SNAPSHOTS) return false;
                const key = paramsKey(p);
                if (snapshots.find(x => paramsKey(x.params) === key)) return false;
                snapshots.push({ id: ++snapSeq, params: { ...p }, label: snapLabel(p) });
                return true;
            }
            function renderSnapshots() {
                const list = els.abList;
                if (!list) return;
                if (!snapshots.length) {
                    list.innerHTML = '<span class="ab-empty">Press play — each combo you preview is saved here to flip between.</span>';
                    return;
                }
                list.innerHTML = '';
                snapshots.forEach(s => {
                    const chip = document.createElement('div');
                    chip.className = 'ab-chip' + (s.id === activeSnapshotId ? ' active' : '');
                    chip.title = 'Load into controls & play';
                    const pills = snapParts(s.params).map(t => `<span class="ab-tag">${t}</span>`).join('');
                    chip.title = s.label;
                    chip.innerHTML = `
                        <span class="ab-play"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
                        <span class="ab-label">${pills}</span>
                        <button class="ab-act ab-del" title="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
                    // Clicking the chip now loads the combo into the controls AND plays it.
                    chip.addEventListener('click', (e) => { if (e.target.closest('.ab-act')) return; loadSnapshot(s.id); });
                    chip.querySelector('.ab-del').addEventListener('click', (e) => { e.stopPropagation(); removeSnapshot(s.id); });
                    list.appendChild(chip);
                });
            }
            function removeSnapshot(id) {
                snapshots = snapshots.filter(x => x.id !== id);
                if (activeSnapshotId === id) activeSnapshotId = null;
                renderSnapshots();
            }
            function applyParamsToControls(p) {
                els.originalToggle.checked = !!p.original;
                els.advancedControls.style.opacity = p.original ? '0.3' : '1';
                els.advancedControls.style.pointerEvents = p.original ? 'none' : 'auto';
                els.eqToggle.checked = !!p.eq_preset;
                if (p.eq_preset) els.eqPresetSelect.value = p.eq_preset;
                if (els.mbcToggle) { els.mbcToggle.checked = !!p.mbc_preset; if (p.mbc_preset && els.mbcPresetSelect) els.mbcPresetSelect.value = p.mbc_preset; }
                els.enhanceModeSelect.value = p.enhance_mode || '';
                if (p.enhance_intensity) els.enhanceIntensitySelect.value = p.enhance_intensity;
                els.normalizeToggle.checked = !!p.normalize;
                if (p.normalize_i) els.normalizeISelect.value = p.normalize_i;
            }
            function loadSnapshot(id) {
                const s = snapshots.find(x => x.id === id);
                if (!s) return;
                applyParamsToControls(s.params);   // reflect combo in the controls
                activeSnapshotId = id;
                renderSnapshots();
                // Keep the current playhead position (don't restart) whenever a
                // track is loaded — whether it's currently playing or paused.
                const pos = (currentSrc && previewAudio.currentTime > 0) ? previewAudio.currentTime : rangeStart();
                playPreview(previewUrlFrom(s.params), pos);
            }
            els.abClear.addEventListener('click', () => { snapshots = []; activeSnapshotId = null; stopGenQueue(); renderSnapshots(); });

            // --- Generate render queue ---
            // Generate enqueues combos and renders them one at a time in the
            // background (each /stream call renders + caches that combo server-side).
            // A chip appears only once its render finishes; progress shows N/total.
            // Clear stops everything; further Generates append to the running queue.
            let genQueue = [];
            let genActive = false;
            let genAbort = null;
            let genTotal = 0, genDone = 0;

            function updateGenProgress() {
                const el = els.genProgress;
                if (!el) return;
                if (genActive || genQueue.length) {
                    el.style.display = 'inline';
                    el.textContent = `${genDone}/${genTotal}`;
                } else {
                    el.style.display = 'none';
                    el.textContent = '';
                }
            }
            function enqueueCombos(combos) {
                let added = 0;
                combos.forEach(p => {
                    const k = paramsKey(p);
                    if (snapshots.find(x => paramsKey(x.params) === k)) return;   // already a chip
                    if (genQueue.find(q => paramsKey(q) === k)) return;           // already queued
                    if (snapshots.length + genQueue.length >= MAX_SNAPSHOTS) return;
                    genQueue.push(p); added++;
                });
                genTotal += added;
                updateGenProgress();
                runGenQueue();
                return added;
            }
            async function runGenQueue() {
                if (genActive) return;
                genActive = true;
                updateGenProgress();
                while (genQueue.length) {
                    const p = genQueue[0];
                    genAbort = new AbortController();
                    try {
                        // GET /stream renders + caches the combo; we discard the body.
                        await fetch(previewUrlFrom(p), { signal: genAbort.signal });
                        addSnapshotLazy(p);
                        renderSnapshots();
                    } catch (e) {
                        if (e.name === 'AbortError') break;   // Clear pressed
                    }
                    genQueue.shift();
                    genDone++;
                    updateGenProgress();
                }
                genActive = false;
                genAbort = null;
                if (!genQueue.length) { genTotal = 0; genDone = 0; }
                updateGenProgress();
            }
            function stopGenQueue() {
                genQueue = [];
                if (genAbort) { try { genAbort.abort(); } catch (e) { } }
                genActive = false; genAbort = null; genTotal = 0; genDone = 0;
                updateGenProgress();
            }

            // --- Batch "Generate combos" -> Mixes (lazy chips) ---
            function optsOf(sel, dropEmpty) {
                return Array.from(sel ? sel.options : [])
                    .filter(o => !(dropEmpty && o.value === ''))
                    .map(o => ({ value: o.value, label: o.textContent.trim() }));
            }
            // Cartesian product of the selected dimension values -> deduped params.
            function buildCombos(sel) {
                const out = [];
                const seen = new Set();
                const enhList = sel.enh.length ? sel.enh : [''];
                const intList = sel.intensity.length ? sel.intensity : ['1.5'];
                const eqList = sel.eq.length ? sel.eq : [''];
                const compList = sel.comp.length ? sel.comp : [''];
                const loudList = sel.loud.length ? sel.loud : ['-16'];
                for (const eq of eqList) for (const comp of compList)
                    for (const enh of enhList) for (const intn of intList)
                        for (const loud of loudList) {
                            const p = {
                                eq_preset: eq || '', mbc_preset: comp || '',
                                enhance_mode: enh || '',
                                enhance_intensity: enh ? intn : '1.5',
                                normalize: true, normalize_i: loud,
                                original: false,
                            };
                            const k = paramsKey(p);
                            if (!seen.has(k)) { seen.add(k); out.push(p); }
                        }
                return out;
            }
            function openGenerator() {
                const ov = document.createElement('div');
                ov.className = 'gen-overlay';
                const dims = [
                    { key: 'eq', label: 'EQ preset', opts: optsOf(els.eqPresetSelect, true) },
                    { key: 'comp', label: 'Compression', opts: optsOf(els.mbcPresetSelect, true) },
                    { key: 'enh', label: 'Enhance', opts: optsOf(els.enhanceModeSelect, true) },
                    { key: 'intensity', label: 'Enhance level', opts: [{ value: '1.0', label: 'Low' }, { value: '1.5', label: 'Mid' }, { value: '2.0', label: 'High' }] },
                    { key: 'loud', label: 'Loudness', opts: [{ value: '-12', label: 'Loud' }, { value: '-16', label: 'Normal' }, { value: '-23', label: 'Quiet' }] },
                ];
                const groups = dims.map(d => `
                    <div class="gen-dim" data-key="${d.key}">
                        <label>${d.label}</label>
                        <div class="gen-opts">${d.opts.map(o =>
                    `<label class="gen-opt"><input type="checkbox" value="${o.value}">${o.label}</label>`).join('')}</div>
                    </div>`).join('');
                ov.innerHTML = `
                    <div class="gen-panel" role="dialog" aria-modal="true">
                        <h3>Generate mixes</h3>
                        <div class="gen-sub">Tick the values to combine — leave a row untouched to keep that effect off. Each combination renders in the background and appears in Mixes when ready.</div>
                        ${groups}
                        <div class="gen-foot">
                            <span class="gen-count" id="genCount">0 mixes</span>
                            <span style="display:flex; gap:0.5rem;">
                                <button id="genCancel" type="button" style="background:rgba(255,255,255,0.05); border:1px solid var(--card-border);">Cancel</button>
                                <button id="genAdd" type="button">Generate</button>
                            </span>
                        </div>
                    </div>`;
                document.body.appendChild(ov);

                const selOf = () => {
                    const s = {};
                    dims.forEach(d => {
                        s[d.key] = Array.from(ov.querySelectorAll(`.gen-dim[data-key="${d.key}"] input:checked`)).map(i => i.value);
                    });
                    return s;
                };
                const countEl = ov.querySelector('#genCount');
                const addBtn = ov.querySelector('#genAdd');
                const recount = () => {
                    const n = buildCombos(selOf()).length;
                    const room = MAX_SNAPSHOTS - snapshots.length;
                    countEl.textContent = `${n} mix${n === 1 ? '' : 'es'}` + (n > room ? ` (max ${room} will be added)` : '');
                    addBtn.disabled = n === 0;
                };
                ov.addEventListener('change', recount);
                recount();

                const close = () => ov.remove();
                ov.addEventListener('click', e => { if (e.target === ov) close(); });
                ov.querySelector('#genCancel').addEventListener('click', close);
                addBtn.addEventListener('click', () => {
                    const added = enqueueCombos(buildCombos(selOf()));
                    close();
                    showToast(added ? `Generating ${added} mix${added === 1 ? '' : 'es'}…` : 'Those mixes are already queued or made.');
                });
            }
            els.abGenerate.addEventListener('click', openGenerator);

