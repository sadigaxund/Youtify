            lucide.createIcons();
            // --- State ---
            let videoDuration = 0;
            let currentVideoId = '';
            let currentSourceId = null;   // set for uploaded/cached sources; null for YouTube
            let session_id = '';
            let isDragging = false;
            let playbackInterval = null;
            let silenceInfo = { leading: 0, trailing: 0 };
            let isStreaming = false; // Prevent interactions during streaming
            let originalThumbnailUrl = ''; // Store YouTube thumbnail URL
            let customThumbnailBase64 = null; // Store custom thumbnail as base64
            let isCached = false; // Track if audio is cached
            let cachePollTimer = null; // Timer for cache polling

            // Reset all form elements to defaults on page load
            function resetDefaults() {
                // Checkboxes - all unchecked by default except specific ones
                document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
                // Enable normalize and silence trim by default
                const normalizeToggle = document.getElementById('normalizeToggle');
                const trimSilenceToggle = document.getElementById('trimSilenceToggle');
                if (normalizeToggle) normalizeToggle.checked = true;
                if (trimSilenceToggle) trimSilenceToggle.checked = true;

                // Reset selects to first/default option
                document.querySelectorAll('select').forEach(sel => sel.selectedIndex = 0);
                const normalizeISelect = document.getElementById('normalizeISelect');
                if (normalizeISelect) normalizeISelect.value = '-16'; // Default to -16 LUFS
                const silenceThreshSelect = document.getElementById('silenceThreshSelect');
                if (silenceThreshSelect) silenceThreshSelect.value = '-40'; // Default to -40 dB
            }
            resetDefaults();

            // Turbo Render (checkpoint cache) is opt-in. Default comes from the
            // user's saved choice; if they've never chosen, the server flag
            // (turbo_default) is applied once /config resolves. Persist on change.
            (function initTurbo() {
                const tt = document.getElementById('turboToggle');
                if (!tt) return;
                const saved = localStorage.getItem('youtify_turbo');
                if (saved !== null) tt.checked = (saved === '1');
                tt.addEventListener('change', () => localStorage.setItem('youtify_turbo', tt.checked ? '1' : '0'));
            })();

            // --- Elements ---
            const els = {
                urlInput: document.getElementById('urlInput'),
                inputGroup: document.getElementById('inputGroup'),
                searchBtn: document.getElementById('searchBtn'),
                searchResults: document.getElementById('searchResults'),
                preview: document.getElementById('preview'),
                optionsPanel: document.getElementById('optionsPanel'),
                previewAudio: document.getElementById('previewAudio'),
                previewBtn: document.getElementById('previewBtn'),
                playbackPointer: document.getElementById('playbackPointer'),
                currentTimeDisplay: document.getElementById('currentTimeDisplay'),
                totalDisplay: document.getElementById('totalDisplay'),
                startDisplay: document.getElementById('startDisplay'),
                endDisplay: document.getElementById('endDisplay'),
                startSlider: document.getElementById('startSlider'),
                endSlider: document.getElementById('endSlider'),
                sliderRange: document.getElementById('sliderRange'),
                sliderTrack: document.getElementById('sliderTrack'),
                sliderWrapper: document.querySelector('.slider-wrapper'),
                filenamePreview: document.getElementById('filenamePreview'),
                originalToggle: document.getElementById('originalToggle'),
                advancedControls: document.getElementById('advancedControls'),
                normalizeToggle: document.getElementById('normalizeToggle'),
                normalizeISelect: document.getElementById('normalizeISelect'),
                eqToggle: document.getElementById('eqToggle'),
                eqPresetSelect: document.getElementById('eqPresetSelect'),
                mbcToggle: document.getElementById('mbcToggle'),
                mbcPresetSelect: document.getElementById('mbcPresetSelect'),
                enhanceModeSelect: document.getElementById('enhanceModeSelect'),
                enhanceIntensitySelect: document.getElementById('enhanceIntensitySelect'),
                trimSilenceToggle: document.getElementById('trimSilenceToggle'),
                silenceThreshSelect: document.getElementById('silenceThreshSelect'),
                turboToggle: document.getElementById('turboToggle'),
                downloadBtn: document.getElementById('downloadBtn'),
                uploadNextBtn: document.getElementById('uploadNextBtn'),
                formatSelect: document.getElementById('formatSelect'),
                dropZone: document.getElementById('dropZone'),
                fileInputSrc: document.getElementById('fileInputSrc'),
                success: document.getElementById('success'),
                silenceStartOverlay: document.getElementById('silenceStartOverlay'),
                silenceEndOverlay: document.getElementById('silenceEndOverlay'),
                // Pipeline progress elements
                pipelineProgress: document.getElementById('pipelineProgress'),
                pipelineFill: document.getElementById('pipelineFill'),
                pipelineLabel: document.getElementById('pipelineLabel'),
                pipelinePct: document.getElementById('pipelinePct'),
                stepCache: document.getElementById('stepCache'),
                stepCacheIcon: document.getElementById('stepCacheIcon'),
                stepCacheLabel: document.getElementById('stepCacheLabel'),
                stepProcess: document.getElementById('stepProcess'),
                stepProcessIcon: document.getElementById('stepProcessIcon'),
                stepProcessLabel: document.getElementById('stepProcessLabel'),
                pipelineConnector: document.getElementById('pipelineConnector'),
                // Metadata elements
                metaThumb: document.getElementById('metaThumb'),
                thumbUpload: document.getElementById('thumbUpload'),
                uploadThumbBtn: document.getElementById('uploadThumbBtn'),
                resetThumbBtn: document.getElementById('resetThumbBtn'),
                metaTitle: document.getElementById('metaTitle'),
                metaArtist: document.getElementById('metaArtist'),
                artistContainer: document.getElementById('artistContainer'),
                artistInput: document.getElementById('artistInput'),
                artistDropdown: document.getElementById('artistDropdown'),
                metaAlbum: document.getElementById('metaAlbum'),
                metaGenre: document.getElementById('metaGenre'),
                genreContainer: document.getElementById('genreContainer'),
                genreInput: document.getElementById('genreInput'),
                genreDropdown: document.getElementById('genreDropdown'),
                metaYear: document.getElementById('metaYear'),
                addTagBtn: document.getElementById('addTagBtn'),
                customTagsContainer: document.getElementById('customTagsContainer'),
                delimiterInput: document.getElementById('delimiterInput'),
                abList: document.getElementById('abList'),
                abClear: document.getElementById('abClear'),
                abGenerate: document.getElementById('abGenerate')
            };

            // --- Utils ---
            function setLoading(btn, loading) {
                const icon = btn.querySelector('i, svg');
                if (loading) {
                    btn.disabled = true;
                    if (icon) icon.classList.add('spin');
                } else {
                    btn.disabled = false;
                    if (icon) icon.classList.remove('spin');
                }
            }

            function setIcon(btn, name) {
                const icon = btn.querySelector('i, svg');
                if (icon) {
                    icon.setAttribute('data-lucide', name);
                    lucide.createIcons();
                }
            }

            function showError(msg) {
                msg = (msg || '').toString();
                // Map ONLY genuine URL-validation failures to a friendly hint.
                // Everything else (yt-dlp/ffmpeg/processing errors) is shown as-is,
                // so real failures aren't masked as "enter a valid URL".
                let friendly = msg;
                if (/NetworkError|Failed to fetch|fetch resource/i.test(msg)) {
                    friendly = 'Connection error — check your network';
                } else if (/non-empty string|Invalid domain|Could not extract video ID|Invalid video ID|Could not parse hostname|Failed to parse URL|not a recognized YouTube/i.test(msg)) {
                    friendly = 'Please enter a valid YouTube URL';
                } else {
                    // Strip a leading FastAPI/HTTP wrapper if present, cap length.
                    friendly = msg.replace(/^\s*\{?"?detail"?:?\s*"?/i, '').replace(/"?\}?\s*$/,'').trim() || msg;
                    if (friendly.length > 220) friendly = friendly.slice(0, 217) + '…';
                }
                document.getElementById('errorToastMsg').textContent = friendly;
                const toast = document.getElementById('errorToast');
                toast.classList.add('show');
                setTimeout(() => toast.classList.remove('show'), 7000);
            }

            function showToast(path) {
                document.getElementById('toastPath').textContent = path;
                const toast = document.getElementById('toast');
                toast.classList.add('show');
                setTimeout(() => toast.classList.remove('show'), 6000);
            }

