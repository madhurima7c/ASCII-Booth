(function () {
  "use strict";

  const LIVE_COLS = 220;
  const LIVE_MAX_ROWS = 180;
  const PHOTO_EXPORT_MAX = 960;
  const GAMMA = 0.65;
  const FRAME_MIN_MS = 55;
  /** Darkest → brightest (reference-style colored ASCII). */
  const RAMP = "./\\FR#";

  const video = document.getElementById("preview");
  const asciiOut = document.getElementById("ascii-out");
  const placeholder = document.getElementById("preview-placeholder");
  const errorEl = document.getElementById("error-message");
  const viewfinder = document.getElementById("viewfinder");
  const viewfinderInner = document.getElementById("viewfinder-inner");
  const viewfinderFlipRoot = document.getElementById("viewfinder-flip-root");
  const viewfinderFlipInner = document.getElementById("viewfinder-flip-inner");
  const boothStack = document.getElementById("booth-stack");
  const captureAsciiOut = document.getElementById("capture-ascii-out");
  const captureViewfinder = document.getElementById("viewfinder-capture");
  const captureViewfinderInner = document.getElementById(
    "capture-viewfinder-inner"
  );
  const btnBackCapture = document.getElementById("btn-back-capture");
  const btnDownloadCapture = document.getElementById("btn-download-capture");
  const snapshotInner = document.getElementById("snapshot-inner");
  const btnCapture = document.getElementById("btn-capture");
  const btnMulticolor = document.getElementById("btn-multicolor");
  const popover = document.getElementById("swatch-popover");
  const canvasSv = document.getElementById("canvas-sv");
  const canvasHue = document.getElementById("canvas-hue");
  const svCursor = document.getElementById("sv-cursor");
  const hueCursor = document.getElementById("hue-cursor");
  const swatchGroup = document.getElementById("swatch-group");
  const workCanvas = document.getElementById("work-canvas");
  const snapshotModal = document.getElementById("snapshot-modal");
  const snapshotFrame = document.getElementById("snapshot-frame");
  const snapshotAscii = document.getElementById("snapshot-ascii");
  const btnSnapshotClose = document.getElementById("btn-snapshot-close");

  const ctx = workCanvas.getContext("2d", { willReadFrequently: true });
  const ctxSv = canvasSv.getContext("2d", { willReadFrequently: true });
  const ctxHue = canvasHue.getContext("2d", { willReadFrequently: true });

  let stream = null;
  let cameraOn = false;
  let rafId = 0;
  let lastFrameTime = 0;
  let busy = false;
  let popoverOpen = false;
  let pickerHue = 0;
  let pickerSat = 0;
  let pickerVal = 1;
  let draggingSv = false;
  let draggingHue = false;
  let lastCols = 0;
  let lastRows = 0;
  let cachedCellRatioWH = null;
  let viewfinderShowingPhoto = false;
  /** Ignore tiny mobile camera intrinsic-size jitter (reduces grid / font-size thrash). */
  let stableVideoW = 0;
  let stableVideoH = 0;
  /** Skip redundant analytical refits when box + grid unchanged. */
  let asciiLiveFitKey = "";
  /** Prevent overlapping getUserMedia prompts (race on slow mobile). */
  let cameraStartPromise = null;

  function getAsciiCellRatioWH() {
    if (cachedCellRatioWH !== null) {
      return cachedCellRatioWH;
    }
    const cs = window.getComputedStyle(asciiOut);
    const fsProbe = 100;
    const fsCurr = parseFloat(cs.fontSize) || 16;
    let lineHPx;
    const lhRaw = cs.lineHeight;
    if (lhRaw === "normal" || lhRaw === "") {
      lineHPx = fsProbe * 1.15;
    } else {
      const parsed = parseFloat(lhRaw);
      if (Number.isFinite(parsed)) {
        if (lhRaw.indexOf("px") >= 0) {
          const mult = parsed / fsCurr;
          lineHPx = fsProbe * mult;
        } else {
          lineHPx = fsProbe * parsed;
        }
      } else {
        lineHPx = fsProbe * 1.15;
      }
    }

    const probe = document.createElement("pre");
    probe.style.cssText =
      "position:fixed;left:-9999px;top:0;visibility:hidden;margin:0;padding:0;border:0;" +
      "white-space:pre;overflow:hidden;";
    probe.style.fontFamily = cs.fontFamily;
    probe.style.fontSize = fsProbe + "px";
    probe.style.lineHeight = lineHPx + "px";
    const lsRaw = cs.letterSpacing;
    const lsPx = parseFloat(lsRaw);
    if (Number.isFinite(lsPx) && lsRaw.indexOf("px") >= 0) {
      probe.style.letterSpacing = (lsPx * (fsProbe / fsCurr)) + "px";
    } else {
      probe.style.letterSpacing = lsRaw;
    }
    probe.style.fontWeight = cs.fontWeight;
    probe.textContent = new Array(33).join("0");
    document.body.appendChild(probe);
    const charW = probe.offsetWidth / 32;
    const lineH = probe.offsetHeight;
    document.body.removeChild(probe);

    if (lineH < 1 || charW < 0.01) {
      cachedCellRatioWH = 0.54 / 1.15;
    } else {
      cachedCellRatioWH = charW / lineH;
    }
    return cachedCellRatioWH;
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      cachedCellRatioWH = null;
    });
  }

  function rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) {
        h = (60 * ((g - b) / d) + 360) % 360;
      } else if (max === g) {
        h = 60 * ((b - r) / d + 2);
      } else {
        h = 60 * ((r - g) / d + 4);
      }
    }
    const s = max === 0 ? 0 : d / max;
    const v = max;
    return { h: h, s: s, v: v };
  }

  function hsvToRgb(h, s, v) {
    const hh = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = v - c;
    let rp = 0;
    let gp = 0;
    let bp = 0;
    if (hh < 60) {
      rp = c;
      gp = x;
    } else if (hh < 120) {
      rp = x;
      gp = c;
    } else if (hh < 180) {
      gp = c;
      bp = x;
    } else if (hh < 240) {
      gp = x;
      bp = c;
    } else if (hh < 300) {
      rp = x;
      bp = c;
    } else {
      rp = c;
      bp = x;
    }
    return [
      Math.round((rp + m) * 255),
      Math.round((gp + m) * 255),
      Math.round((bp + m) * 255),
    ];
  }

  function rgbToHex(r, g, b) {
    return (
      "#" +
      [r, g, b]
        .map(function (n) {
          return Math.max(0, Math.min(255, n))
            .toString(16)
            .padStart(2, "0");
        })
        .join("")
    );
  }

  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    if (h.length !== 6) return { r: 255, g: 255, b: 255 };
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  function luminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function inkForBackground(hex) {
    const o = hexToRgb(hex);
    const L = luminance(o.r, o.g, o.b);
    return L > 145 ? "#0a0a0a" : "#f5f5f5";
  }

  function getBgHex() {
    const s = viewfinder.style.getPropertyValue("--ascii-bg").trim();
    if (s) return s;
    return "#ffffff";
  }

  function applyTheme(bgHex) {
    viewfinder.style.setProperty("--ascii-bg", bgHex);
    viewfinder.style.setProperty("--ascii-fg", inkForBackground(bgHex));
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function stopLiveLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    busy = false;
    lastFrameTime = 0;
  }

  function stopStream() {
    stopLiveLoop();
    if (stream) {
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
      stream = null;
    }
    video.srcObject = null;
    cameraOn = false;
    btnCapture.disabled = true;
    asciiOut.innerHTML = "";
    if (viewfinderFlipRoot) {
      viewfinderFlipRoot.classList.remove("is-flipped");
    }
    if (boothStack) {
      boothStack.classList.remove("is-capture-back");
    }
    viewfinderShowingPhoto = false;
    if (captureAsciiOut) {
      captureAsciiOut.innerHTML = "";
    }
    if (btnDownloadCapture) {
      btnDownloadCapture.setAttribute("href", "#");
    }
    btnCapture.textContent = "Capture";
    btnCapture.setAttribute("aria-label", "Capture ASCII portrait");
    stableVideoW = 0;
    stableVideoH = 0;
    asciiLiveFitKey = "";
  }

  /**
   * Uniform scale like CSS object-fit: cover — fills the container, preserves
   * aspect ratio, clips overflow (no letterboxing, no non-uniform stretch).
   * When cols & rows are passed, font size is derived from the grid geometry
   * (stable on mobile). Measuring scrollWidth/scrollHeight each frame drifts
   * with colored spans and triggers iOS resize loops (zoom / stretch).
   */
  function coverAsciiInContainer(pre, container, colsOpt, rowsOpt) {
    if (!pre.textContent) return;
    const w = Math.round(container.clientWidth);
    const h = Math.round(container.clientHeight);
    if (w < 10 || h < 10) return;

    const cols = colsOpt != null ? colsOpt : 0;
    const rows = rowsOpt != null ? rowsOpt : 0;
    if (cols > 0 && rows > 0) {
      const fitKey = w + "x" + h + "x" + cols + "x" + rows;
      if (pre === asciiOut && fitKey === asciiLiveFitKey) {
        return;
      }
      const r = getAsciiCellRatioWH();
      const lh = 1.15;
      const unitW = cols * r * lh;
      const unitH = rows * lh;
      if (unitW < 1e-6 || unitH < 1e-6) return;
      const scale = Math.max(w / unitW, h / unitH);
      let fs = scale * 1.002;
      fs = Math.max(2, Math.min(96, fs));
      pre.style.fontSize = fs + "px";
      if (pre === asciiOut) {
        asciiLiveFitKey = fitKey;
      }
      return;
    }

    const testFs = 16;
    pre.style.fontSize = testFs + "px";
    const sw = pre.scrollWidth;
    const sh = pre.scrollHeight;
    if (sw < 1 || sh < 1) return;

    const scale = Math.max(w / sw, h / sh);
    let fs = testFs * scale * 1.002;
    fs = Math.max(2, Math.min(96, fs));
    pre.style.fontSize = fs + "px";
  }

  function computeGridSizeFromVideo(maxCols, maxRows) {
    let vw = video.videoWidth;
    let vh = video.videoHeight;
    if (!vw || !vh) return null;

    if (stableVideoW > 0 && stableVideoH > 0) {
      const wJitter = Math.abs(vw - stableVideoW) / stableVideoW;
      const hJitter = Math.abs(vh - stableVideoH) / stableVideoH;
      const ar0 = stableVideoW / stableVideoH;
      const ar1 = vw / vh;
      const arJitter = Math.abs(ar1 - ar0) / ar0;
      if (wJitter < 0.08 && hJitter < 0.08 && arJitter < 0.04) {
        vw = stableVideoW;
        vh = stableVideoH;
      } else {
        stableVideoW = vw;
        stableVideoH = vh;
      }
    } else {
      stableVideoW = vw;
      stableVideoH = vh;
    }

    const r = getAsciiCellRatioWH();
    let cols = maxCols;
    let rows = Math.round(cols * (vh / vw) * r);
    rows = Math.max(24, Math.min(rows, maxRows));
    if (rows >= maxRows) {
      rows = maxRows;
      cols = Math.min(
        maxCols,
        Math.max(32, Math.round(rows / ((vh / vw) * r)))
      );
    }
    cols = Math.max(32, Math.min(cols, maxCols));
    return { cols: cols, rows: rows };
  }

  /**
   * Pixel buffer must match the camera aspect (vw/vh), not cols/rows. Using a
   * cols×rows canvas makes each sample square while each monospace cell is
   * wider than tall (cw/lh), which stretches the image vertically on screen.
   */
  function videoBufferSizePx(cols, vw, vh) {
    const bufW = cols;
    const bufH = Math.max(1, Math.round((cols * vh) / vw));
    return { bufW: bufW, bufH: bufH };
  }

  function syncCaptureViewfinderTheme() {
    if (!captureViewfinder) return;
    const bg = viewfinder.style.getPropertyValue("--ascii-bg").trim();
    const fg = viewfinder.style.getPropertyValue("--ascii-fg").trim();
    captureViewfinder.style.setProperty("--ascii-bg", bg || "#000000");
    captureViewfinder.style.setProperty("--ascii-fg", fg || "#eeeeee");
  }

  /**
   * Shared luminance sampling for HTML ASCII and PNG export.
   * @returns {{ cellR: Float32Array, cellG: Float32Array, cellB: Float32Array, cellL: Float32Array, lo: number, span: number }}
   */
  function sampleCellsForAscii(imageData, cols, rows, stretchContrast) {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    const cellW = w / cols;
    const cellH = h / rows;
    const total = cols * rows;
    const cellR = new Float32Array(total);
    const cellG = new Float32Array(total);
    const cellB = new Float32Array(total);
    const cellL = new Float32Array(total);
    let lo = 255;
    let hi = 0;
    let t = 0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x0 = Math.floor(col * cellW);
        const y0 = Math.floor(row * cellH);
        const x1 = Math.min(w, Math.ceil((col + 1) * cellW));
        const y1 = Math.min(h, Math.ceil((row + 1) * cellH));
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let sumL = 0;
        let count = 0;
        for (let y = y0; y < y1; y++) {
          const rowOff = y * w * 4;
          for (let x = x0; x < x1; x++) {
            const i = rowOff + x * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            sumR += r;
            sumG += g;
            sumB += b;
            sumL += luminance(r, g, b);
            count++;
          }
        }
        if (count) {
          cellR[t] = sumR / count;
          cellG[t] = sumG / count;
          cellB[t] = sumB / count;
          cellL[t] = sumL / count;
          if (stretchContrast) {
            const L = cellL[t];
            if (L < lo) lo = L;
            if (L > hi) hi = L;
          }
        } else {
          cellR[t] = cellG[t] = cellB[t] = cellL[t] = 0;
        }
        t++;
      }
    }

    let span = hi - lo;
    if (!stretchContrast || span < 30) {
      lo = 0;
      span = 255;
    }
    return { cellR: cellR, cellG: cellG, cellB: cellB, cellL: cellL, lo: lo, span: span };
  }

  function frameToAsciiFromCells(cellR, cellG, cellB, cellL, cols, rows, lo, span) {
    const rampLen = RAMP.length - 1;
    const parts = [];
    let t = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const L = cellL[t];
        const r = cellR[t];
        const g = cellG[t];
        const b = cellB[t];
        t++;
        let n = (L - lo) / span;
        n = Math.pow(Math.max(0, Math.min(1, n)), GAMMA);
        const dark = 1 - n;
        const idx = Math.round(dark * rampLen);
        const ch = RAMP.charAt(idx);
        parts.push(
          '<span style="color:#',
          rgbToHexBytes(r, g, b),
          '">',
          ch,
          "</span>"
        );
      }
      if (row < rows - 1) {
        parts.push("\n");
      }
    }
    return parts.join("");
  }

  function buildAsciiPngDataUrl() {
    const cols = lastCols;
    const rows = lastRows;
    const bufW = workCanvas.width;
    const bufH = workCanvas.height;
    if (!cols || !rows || bufW < 2 || bufH < 2) {
      return "";
    }
    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, bufW, bufH);
    } catch (err) {
      return "";
    }
    const s = sampleCellsForAscii(imageData, cols, rows, false);
    const r = getAsciiCellRatioWH();
    const exportW = Math.min(PHOTO_EXPORT_MAX, bufW * 2);
    const exportH = Math.max(1, Math.round((exportW * rows) / cols / r));
    const cnv = document.createElement("canvas");
    cnv.width = exportW;
    cnv.height = exportH;
    const x = cnv.getContext("2d");
    if (!x) return "";
    const bg = getBgHex();
    x.fillStyle = bg;
    x.fillRect(0, 0, exportW, exportH);
    const fam = window.getComputedStyle(asciiOut).fontFamily;
    const cellW = exportW / cols;
    const cellH = exportH / rows;
    const fontSize = Math.max(2, cellH / 1.15);
    x.font = "400 " + fontSize + "px " + fam;
    x.textBaseline = "top";
    const rampLen = RAMP.length - 1;
    let t = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const L = s.cellL[t];
        const rr = s.cellR[t];
        const gg = s.cellG[t];
        const bb = s.cellB[t];
        t++;
        let n = (L - s.lo) / s.span;
        n = Math.pow(Math.max(0, Math.min(1, n)), GAMMA);
        const dark = 1 - n;
        const idx = Math.round(dark * rampLen);
        const ch = RAMP.charAt(idx);
        x.fillStyle = "rgb(" + (rr | 0) + "," + (gg | 0) + "," + (bb | 0) + ")";
        const px = col * cellW;
        const py = row * cellH;
        const yAdj = Math.max(0, (cellH - fontSize * 1.15) * 0.5);
        const mw = x.measureText(ch).width;
        x.fillText(ch, px + (cellW - mw) * 0.5, py + yAdj);
      }
    }
    try {
      return cnv.toDataURL("image/png");
    } catch (err2) {
      return "";
    }
  }

  function captureAndFlip() {
    if (!stream || video.readyState < 2) return;
    btnCapture.disabled = true;
    stopLiveLoop();
    try {
      renderAsciiFrame();
      if (asciiOut.textContent) {
        coverAsciiInContainer(asciiOut, viewfinderInner, lastCols, lastRows);
      }
    } catch (err) {}
    if (!asciiOut.textContent || !lastCols || !lastRows) {
      btnCapture.disabled = false;
      if (cameraOn) startLiveLoop();
      return;
    }
    const url = buildAsciiPngDataUrl();
    if (!url) {
      btnCapture.disabled = false;
      if (cameraOn) startLiveLoop();
      return;
    }
    syncCaptureViewfinderTheme();
    if (captureAsciiOut) {
      captureAsciiOut.innerHTML = asciiOut.innerHTML;
    }
    if (captureViewfinderInner && captureAsciiOut) {
      coverAsciiInContainer(
        captureAsciiOut,
        captureViewfinderInner,
        lastCols,
        lastRows
      );
    }
    let flipInDone = false;
    function finishFlipIn() {
      if (flipInDone) return;
      flipInDone = true;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (viewfinderFlipRoot) {
            viewfinderFlipRoot.classList.add("is-flipped");
          }
          if (boothStack) {
            boothStack.classList.add("is-capture-back");
          }
          if (btnDownloadCapture) {
            btnDownloadCapture.href = url;
          }
          viewfinderShowingPhoto = true;
          btnCapture.textContent = "Retake";
          btnCapture.setAttribute("aria-label", "Return to live camera");
          btnCapture.disabled = false;
        });
      });
    }
    finishFlipIn();
  }

  function flipBackToLive() {
    if (!viewfinderShowingPhoto) return;
    btnCapture.disabled = true;
    let finished = false;
    function done() {
      if (finished) return;
      finished = true;
      viewfinderFlipInner.removeEventListener("transitionend", onTransitionEnd);
      window.clearTimeout(fallbackTimer);
      if (captureAsciiOut) {
        captureAsciiOut.innerHTML = "";
      }
      if (btnDownloadCapture) {
        btnDownloadCapture.setAttribute("href", "#");
      }
      if (boothStack) {
        boothStack.classList.remove("is-capture-back");
      }
      viewfinderShowingPhoto = false;
      btnCapture.textContent = "Capture";
      btnCapture.setAttribute("aria-label", "Capture ASCII portrait");
      btnCapture.disabled = false;
      if (cameraOn) startLiveLoop();
    }
    function onTransitionEnd(e) {
      if (e.target !== viewfinderFlipInner) return;
      if (e.propertyName !== "transform") return;
      done();
    }
    const fallbackTimer = window.setTimeout(done, 900);
    viewfinderFlipInner.addEventListener("transitionend", onTransitionEnd);
    if (viewfinderFlipRoot) {
      viewfinderFlipRoot.classList.remove("is-flipped");
    }
  }

  function drawVideoCover(dw, dh) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    const destAspect = dw / dh;
    const srcAspect = vw / vh;
    let sx;
    let sy;
    let sw;
    let sh;
    if (srcAspect > destAspect) {
      sh = vh;
      sw = vh * destAspect;
      sx = (vw - sw) / 2;
      sy = 0;
    } else {
      sw = vw;
      sh = vw / destAspect;
      sx = 0;
      sy = (vh - sh) / 2;
    }
    ctx.save();
    ctx.translate(dw, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
    ctx.restore();
  }

  function rgbToHexBytes(r, g, b) {
    const clamp = function (n) {
      return Math.max(0, Math.min(255, n | 0));
    };
    return (
      clamp(r).toString(16).padStart(2, "0") +
      clamp(g).toString(16).padStart(2, "0") +
      clamp(b).toString(16).padStart(2, "0")
    );
  }

  function frameToAscii(imageData, cols, rows, stretchContrast) {
    const s = sampleCellsForAscii(imageData, cols, rows, stretchContrast);
    return frameToAsciiFromCells(
      s.cellR,
      s.cellG,
      s.cellB,
      s.cellL,
      cols,
      rows,
      s.lo,
      s.span
    );
  }

  function renderAsciiFrame() {
    if (!cameraOn || !stream || video.readyState < 2) return;

    const grid = computeGridSizeFromVideo(LIVE_COLS, LIVE_MAX_ROWS);
    if (!grid) return;

    const prevCols = lastCols;
    const prevRows = lastRows;
    lastCols = grid.cols;
    lastRows = grid.rows;
    const gridDimsChanged =
      prevCols !== lastCols || prevRows !== lastRows;

    const vw = stableVideoW || video.videoWidth;
    const vh = stableVideoH || video.videoHeight;
    const buf = videoBufferSizePx(grid.cols, vw, vh);
    workCanvas.width = buf.bufW;
    workCanvas.height = buf.bufH;
    drawVideoCover(buf.bufW, buf.bufH);
    const imageData = ctx.getImageData(0, 0, buf.bufW, buf.bufH);
    asciiOut.innerHTML = frameToAscii(imageData, grid.cols, grid.rows, false);

    if (asciiOut.textContent && lastCols > 0 && lastRows > 0) {
      if (gridDimsChanged) {
        asciiLiveFitKey = "";
        coverAsciiInContainer(asciiOut, viewfinderInner, lastCols, lastRows);
      } else if (!asciiLiveFitKey) {
        /* First frames: mat may be 0×0 until layout; retry until fit sticks. */
        coverAsciiInContainer(asciiOut, viewfinderInner, lastCols, lastRows);
      }
    }
  }

  function tick(now) {
    rafId = requestAnimationFrame(tick);
    if (!cameraOn) return;
    if (now - lastFrameTime < FRAME_MIN_MS) return;
    if (busy) return;
    busy = true;
    lastFrameTime = now;
    try {
      renderAsciiFrame();
    } finally {
      busy = false;
    }
  }

  function startLiveLoop() {
    stopLiveLoop();
    rafId = requestAnimationFrame(tick);
  }

  async function resumeExistingStream() {
    if (!stream) return false;
    const live = stream.getTracks().some(function (t) {
      return t.readyState === "live";
    });
    if (!live) return false;
    video.srcObject = stream;
    await video.play().catch(function () {});
    cameraOn = true;
    placeholder.classList.add("is-hidden");
    btnCapture.disabled = false;
    lastCols = 0;
    lastRows = 0;
    asciiLiveFitKey = "";
    startLiveLoop();
    return true;
  }

  async function startCamera() {
    if (await resumeExistingStream()) {
      return true;
    }

    if (stream) {
      const anyLive = stream.getTracks().some(function (t) {
        return t.readyState === "live";
      });
      if (!anyLive) {
        stream.getTracks().forEach(function (t) {
          t.stop();
        });
        stream = null;
        video.srcObject = null;
      }
    }

    if (cameraStartPromise) {
      return cameraStartPromise;
    }

    const attempt = (async function () {
      clearError();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showError(
          "Camera needs HTTPS or localhost. Open this page from a local server."
        );
        return false;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        stableVideoW = 0;
        stableVideoH = 0;
        asciiLiveFitKey = "";
        video.srcObject = stream;
        await video.play().catch(function () {});
        cameraOn = true;
        placeholder.classList.add("is-hidden");
        btnCapture.disabled = false;
        lastCols = 0;
        lastRows = 0;
        startLiveLoop();
        return true;
      } catch (err) {
        const name = err && err.name;
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          showError("Camera blocked. Allow access in your browser settings.");
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          showError("No camera found.");
        } else if (name === "NotReadableError" || name === "TrackStartError") {
          showError("Camera is busy or unavailable.");
        } else {
          showError("Could not start the camera.");
        }
        return false;
      }
    })();

    cameraStartPromise = attempt;
    attempt.finally(function () {
      if (cameraStartPromise === attempt) {
        cameraStartPromise = null;
      }
    });
    return attempt;
  }

  function closeSnapshot() {
    snapshotModal.setAttribute("hidden", "");
    document.body.style.overflow = "";
    if (cameraOn) {
      startLiveLoop();
      requestAnimationFrame(function () {
        if (asciiOut.textContent) {
          coverAsciiInContainer(asciiOut, viewfinderInner, lastCols, lastRows);
        }
      });
    }
  }

  function drawHueCanvas() {
    const w = canvasHue.width;
    const h = canvasHue.height;
    const img = ctxHue.createImageData(w, h);
    const data = img.data;
    for (let y = 0; y < h; y++) {
      const hue = (y / h) * 360;
      const rgb = hsvToRgb(hue, 1, 1);
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
        data[i + 3] = 255;
      }
    }
    ctxHue.putImageData(img, 0, 0);
  }

  function drawSvCanvas() {
    const w = canvasSv.width;
    const h = canvasSv.height;
    const img = ctxSv.createImageData(w, h);
    const data = img.data;
    for (let y = 0; y < h; y++) {
      const v = 1 - y / h;
      for (let x = 0; x < w; x++) {
        const s = x / w;
        const rgb = hsvToRgb(pickerHue, s, v);
        const i = (y * w + x) * 4;
        data[i] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
        data[i + 3] = 255;
      }
    }
    ctxSv.putImageData(img, 0, 0);
  }

  function updatePickerCursors() {
    svCursor.style.left = pickerSat * 100 + "%";
    svCursor.style.top = (1 - pickerVal) * 100 + "%";
    hueCursor.style.top = (pickerHue / 360) * 100 + "%";
  }

  function setSvFromEvent(clientX, clientY) {
    const rect = canvasSv.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    pickerSat = x / rect.width;
    pickerVal = 1 - y / rect.height;
    const rgb = hsvToRgb(pickerHue, pickerSat, pickerVal);
    applyTheme(rgbToHex(rgb[0], rgb[1], rgb[2]));
    updatePickerCursors();
  }

  function setHueFromEvent(clientY) {
    const rect = canvasHue.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    pickerHue = (y / rect.height) * 360;
    drawSvCanvas();
    const rgb = hsvToRgb(pickerHue, pickerSat, pickerVal);
    applyTheme(rgbToHex(rgb[0], rgb[1], rgb[2]));
    updatePickerCursors();
  }

  function openPopover() {
    const rgb = hexToRgb(getBgHex());
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    pickerHue = hsv.h;
    pickerSat = hsv.s;
    pickerVal = hsv.v;
    drawHueCanvas();
    drawSvCanvas();
    updatePickerCursors();
    popover.hidden = false;
    popoverOpen = true;
    btnMulticolor.setAttribute("aria-expanded", "true");
  }

  function closePopover() {
    popover.hidden = true;
    popoverOpen = false;
    btnMulticolor.setAttribute("aria-expanded", "false");
    draggingSv = false;
    draggingHue = false;
  }

  function selectPreset(btn) {
    swatchGroup.querySelectorAll(".swatch").forEach(function (el) {
      el.setAttribute("aria-pressed", "false");
    });
    btn.setAttribute("aria-pressed", "true");
    btnMulticolor.classList.remove("is-custom-selected");
    applyTheme(btn.dataset.color);
    closePopover();
  }

  function selectCustom() {
    swatchGroup.querySelectorAll(".swatch").forEach(function (el) {
      el.setAttribute("aria-pressed", el === btnMulticolor ? "true" : "false");
    });
    btnMulticolor.classList.add("is-custom-selected");
  }

  btnCapture.addEventListener("click", function () {
    if (!cameraOn) return;
    if (viewfinderShowingPhoto) {
      flipBackToLive();
    } else {
      captureAndFlip();
    }
  });

  if (btnBackCapture) {
    btnBackCapture.addEventListener("click", function () {
      flipBackToLive();
    });
  }

  if (btnDownloadCapture) {
    btnDownloadCapture.addEventListener("click", function (e) {
      if (btnDownloadCapture.getAttribute("href") === "#") {
        e.preventDefault();
      }
    });
  }

  btnSnapshotClose.addEventListener("click", closeSnapshot);

  snapshotModal
    .querySelector(".snapshot-backdrop")
    .addEventListener("click", closeSnapshot);

  swatchGroup.addEventListener("click", function (e) {
    const btn = e.target.closest(".swatch");
    if (!btn) return;
    if (btn.dataset.preset === "custom") {
      e.preventDefault();
      if (popoverOpen) {
        closePopover();
      } else {
        selectCustom();
        openPopover();
      }
      return;
    }
    selectPreset(btn);
  });

  canvasSv.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    canvasSv.setPointerCapture(e.pointerId);
    draggingSv = true;
    setSvFromEvent(e.clientX, e.clientY);
  });

  canvasSv.addEventListener("pointermove", function (e) {
    if (!draggingSv) return;
    setSvFromEvent(e.clientX, e.clientY);
  });

  canvasSv.addEventListener("pointerup", function (e) {
    draggingSv = false;
    try {
      canvasSv.releasePointerCapture(e.pointerId);
    } catch (err) {}
  });

  canvasSv.addEventListener("pointercancel", function () {
    draggingSv = false;
  });

  canvasHue.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    canvasHue.setPointerCapture(e.pointerId);
    draggingHue = true;
    setHueFromEvent(e.clientY);
  });

  canvasHue.addEventListener("pointermove", function (e) {
    if (!draggingHue) return;
    setHueFromEvent(e.clientY);
  });

  canvasHue.addEventListener("pointerup", function (e) {
    draggingHue = false;
    try {
      canvasHue.releasePointerCapture(e.pointerId);
    } catch (err) {}
  });

  canvasHue.addEventListener("pointercancel", function () {
    draggingHue = false;
  });

  document.addEventListener("pointerdown", function (e) {
    if (!popoverOpen) return;
    if (popover.contains(e.target)) return;
    if (e.target === btnMulticolor || btnMulticolor.contains(e.target)) return;
    closePopover();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (popoverOpen) closePopover();
      else if (viewfinderShowingPhoto) flipBackToLive();
      else if (!snapshotModal.hasAttribute("hidden")) closeSnapshot();
    }
  });

  window.addEventListener("beforeunload", stopStream);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (!stream || !cameraOn || viewfinderShowingPhoto) return;
    video.play().catch(function () {});
    if (!rafId) {
      startLiveLoop();
    }
  });

  window.addEventListener("pageshow", function (ev) {
    if (!ev.persisted || !stream || !cameraOn || viewfinderShowingPhoto) return;
    video.play().catch(function () {});
    if (!rafId) {
      startLiveLoop();
    }
  });

  let asciiLayoutRaf = 0;
  function scheduleAsciiLayoutFromResize() {
    if (asciiLayoutRaf) return;
    asciiLayoutRaf = requestAnimationFrame(function () {
      asciiLayoutRaf = 0;
      if (cameraOn && asciiOut.textContent && lastCols > 0 && lastRows > 0) {
        coverAsciiInContainer(asciiOut, viewfinderInner, lastCols, lastRows);
      }
      if (
        viewfinderShowingPhoto &&
        captureAsciiOut &&
        captureAsciiOut.textContent &&
        captureViewfinderInner &&
        lastCols > 0 &&
        lastRows > 0
      ) {
        coverAsciiInContainer(
          captureAsciiOut,
          captureViewfinderInner,
          lastCols,
          lastRows
        );
      }
    });
  }

  const ro = new ResizeObserver(scheduleAsciiLayoutFromResize);
  ro.observe(viewfinderInner);
  if (captureViewfinderInner) {
    ro.observe(captureViewfinderInner);
  }

  const roSnapshot = new ResizeObserver(function () {
    if (
      snapshotModal.hasAttribute("hidden") ||
      !snapshotAscii.textContent
    ) {
      return;
    }
    coverAsciiInContainer(snapshotAscii, snapshotInner);
  });
  roSnapshot.observe(snapshotInner);

  if (window.visualViewport) {
    window.visualViewport.addEventListener(
      "resize",
      scheduleAsciiLayoutFromResize
    );
  }

  applyTheme("#000000");

  startCamera();
})();
