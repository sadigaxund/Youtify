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
                _applyingSnapshot = true;
                try {
                    applyParamsToControls(s.params);   // reflect combo in the controls
                } finally {
                    _applyingSnapshot = false;
                }
                activeSnapshotId = id;
                renderSnapshots();
                // Kill any stale onEffectChange debounce so a pending
                // effect-change callback doesn't fire after we already switched.
                clearTimeout(fxRerenderTimer);
                // Keep the current playhead position (don't restart) whenever a
                // track is loaded — whether it's currently playing or paused.
                const pos = (currentSrc && previewAudio.currentTime > 0) ? previewAudio.currentTime : rangeStart();
                playPreview(previewUrlFrom(s.params), pos);
            }
            els.abClear.addEventListener('click', () => { snapshots = []; activeSnapshotId = null; renderSnapshots(); });

