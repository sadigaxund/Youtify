            // --- Thumbnail Upload/Reset ---
            // --- Reusable cover uploader (download form + library editor) ---
            // Reads a file, downscales to <=800px JPEG, sets the <img>, and hands
            // the base64 back via onResult(b64|null). getReset() supplies the revert src.
            function wireCover(fileInput, img, uploadBtn, resetBtn, onResult, getReset) {
                uploadBtn.addEventListener('click', () => fileInput.click());
                fileInput.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const im = new Image();
                        im.onload = () => {
                            // Downscale (max 800px) and re-encode as JPEG to keep the
                            // embedded art (and request body) small; flatten onto black.
                            const MAX = 800;
                            let { width: w, height: h } = im;
                            const scale = Math.min(1, MAX / Math.max(w, h));
                            w = Math.round(w * scale); h = Math.round(h * scale);
                            const canvas = document.createElement('canvas');
                            canvas.width = w; canvas.height = h;
                            const ctx = canvas.getContext('2d');
                            ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
                            ctx.drawImage(im, 0, 0, w, h);
                            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                            img.src = dataUrl;
                            onResult(dataUrl.split(',')[1]);
                        };
                        im.onerror = () => showError('Could not read that image');
                        im.src = ev.target.result;
                    };
                    reader.readAsDataURL(file);
                });
                resetBtn.addEventListener('click', () => {
                    img.src = getReset() || '';
                    onResult(null);
                    fileInput.value = '';
                });
            }
            wireCover(els.thumbUpload, els.metaThumb, els.uploadThumbBtn, els.resetThumbBtn,
                b64 => { customThumbnailBase64 = b64; }, () => originalThumbnailUrl);

