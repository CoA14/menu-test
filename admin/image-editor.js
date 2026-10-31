/* Image editor for the admin: cropping photos (pan, zoom, pinch, rotate) and preparing the logo
   (keeps a transparent background, or removes a plain one, or softens the edges of a photo).
   Both open a dialog from index.html and resolve with the finished image as a Blob, or null when
   cancelled. Text comes from the admin's t(), passed to ImageEditor.init(). */
(function () {
  'use strict';
  const $ = sel => document.querySelector(sel);
  let t = key => key;
  const MAX_SOURCE = 2400;   // big phone photos are scaled to this first, to keep memory low

  function loadSource(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        // An SVG has no real size: it's drawn 1000 px on its longest side.
        const w = img.naturalWidth || 1000, h = img.naturalHeight || 1000;
        const scale = /svg/.test(file.type) ? 1000 / Math.max(w, h) : Math.min(1, MAX_SOURCE / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('badImage'))); };
      img.src = url;
    });
  }

  // WebP (small, keeps transparency); PNG or JPEG where a browser can't make WebP.
  async function encode(canvas, alpha) {
    const make = (type, quality) => new Promise(r => canvas.toBlob(r, type, quality));
    const blob = await make('image/webp', 0.82);
    if (blob && blob.type === 'image/webp') return blob;
    return alpha ? make('image/png') : make('image/jpeg', 0.85);
  }

  // Opens a dialog; resolves with onUse()'s result, or null when closed any other way.
  function runDialog(dialog, form, onUse) {
    return new Promise(resolve => {
      let used = false;
      const submit = async e => {
        e.preventDefault();
        used = true;
        const result = await onUse();
        dialog.close();
        resolve(result);
      };
      form.addEventListener('submit', submit);
      dialog.addEventListener('close', () => {
        form.removeEventListener('submit', submit);
        if (!used) resolve(null);
      }, { once: true });
      dialog.showModal();
    });
  }

  /* ---------- cropping ---------- */

  const crop = { src: null, aspect: 1, guide: false, z: 1, cx: 0, cy: 0, pointers: new Map() };
  const MAX_ZOOM = 5;

  function stage() {
    const c = $('#crop-canvas');
    return { c, W: c.clientWidth, H: c.clientHeight };
  }
  function scale() {
    const { W, H } = stage();
    return Math.max(W / crop.src.width, H / crop.src.height) * crop.z;   // zoom 1 = the frame just covered
  }
  function setZoom(z) {
    crop.z = Math.min(MAX_ZOOM, Math.max(1, z));
  }

  function drawCrop() {
    const { c, W, H } = stage();
    if (!W || !crop.src) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const s = scale();
    // Keep the frame filled: the picture can't be dragged past its own edges.
    const hw = W / 2 / s, hh = H / 2 / s;
    crop.cx = Math.min(Math.max(crop.cx, hw), crop.src.width - hw);
    crop.cy = Math.min(Math.max(crop.cy, hh), crop.src.height - hh);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(crop.src, W / 2 - crop.cx * s, H / 2 - crop.cy * s, crop.src.width * s, crop.src.height * s);
    if (crop.guide) {
      // The square in the middle is what the menu's list shows; the whole frame shows when opened.
      const x = (W - H) / 2;
      ctx.fillStyle = 'rgba(0, 0, 0, .28)';
      ctx.fillRect(0, 0, x, H);
      ctx.fillRect(x + H, 0, x, H);
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.75, 0.75, H - 1.5, H - 1.5);
      ctx.setLineDash([]);
    }
    $('#crop-zoom').value = crop.z;
  }

  function cropResult(size) {
    const { W, H } = stage();
    const s = scale();
    const sw = W / s, sh = H / s;
    const ow = Math.round(Math.min(size, sw)), oh = Math.round(ow / crop.aspect);
    const out = document.createElement('canvas');
    out.width = ow;
    out.height = oh;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(crop.src, crop.cx - sw / 2, crop.cy - sh / 2, sw, sh, 0, 0, ow, oh);
    return encode(out, false);
  }

  function setupCrop() {
    const c = $('#crop-canvas');
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      crop.pointers.set(e.pointerId, [e.clientX, e.clientY]);
    });
    c.addEventListener('pointermove', e => {
      const prev = crop.pointers.get(e.pointerId);
      if (!prev) return;
      if (crop.pointers.size === 1) {
        const s = scale();
        crop.cx -= (e.clientX - prev[0]) / s;
        crop.cy -= (e.clientY - prev[1]) / s;
      } else {
        // Two fingers: pinch to zoom.
        const other = [...crop.pointers].find(([id]) => id !== e.pointerId)[1];
        const before = Math.hypot(prev[0] - other[0], prev[1] - other[1]);
        const after = Math.hypot(e.clientX - other[0], e.clientY - other[1]);
        if (before > 0) setZoom(crop.z * after / before);
      }
      crop.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      drawCrop();
    });
    for (const type of ['pointerup', 'pointercancel']) c.addEventListener(type, e => crop.pointers.delete(e.pointerId));
    c.addEventListener('wheel', e => {
      e.preventDefault();
      setZoom(crop.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
      drawCrop();
    }, { passive: false });
    $('#crop-zoom').addEventListener('input', e => { setZoom(Number(e.target.value)); drawCrop(); });
    $('#crop-in').addEventListener('click', () => { setZoom(crop.z * 1.25); drawCrop(); });
    $('#crop-out').addEventListener('click', () => { setZoom(crop.z / 1.25); drawCrop(); });
    $('#crop-rotate').addEventListener('click', () => {
      const src = crop.src, turned = document.createElement('canvas');
      turned.width = src.height;
      turned.height = src.width;
      const ctx = turned.getContext('2d');
      ctx.translate(turned.width, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(src, 0, 0);
      Object.assign(crop, { src: turned, z: 1, cx: turned.width / 2, cy: turned.height / 2 });
      drawCrop();
    });
    window.addEventListener('resize', () => { if ($('#crop-dialog').open) drawCrop(); });
  }

  // aspect: width / height of the result; guide: mark the square the list shows; size: max width.
  async function cropImage(file, { aspect, guide, size }) {
    const src = await loadSource(file);
    Object.assign(crop, { src, aspect, guide, z: 1, cx: src.width / 2, cy: src.height / 2 });
    crop.pointers.clear();
    $('#crop-canvas').style.aspectRatio = String(aspect);
    $('#crop-hint').textContent = t(guide ? 'cropHintItem' : 'cropHint');
    $('#crop-zoom').max = MAX_ZOOM;
    const result = runDialog($('#crop-dialog'), $('#crop-form'), () => cropResult(size));
    requestAnimationFrame(drawCrop);
    return result;
  }

  /* ---------- logo ---------- */

  const logo = { src: null, kind: '', bg: [255, 255, 255], menuBg: '#ffffff', qrInk: '#111111', result: null };

  // transparent: has its own see-through background · solid: one plain colour around it · photo: neither.
  function analyse(src) {
    const { width: w, height: h } = src;
    const d = src.getContext('2d').getImageData(0, 0, w, h).data;
    let clear = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) clear++;
    if (clear > w * h * 0.01) return { kind: 'transparent' };
    const ring = [];
    const at = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    for (let x = 0; x < w; x++) ring.push(at(x, 0), at(x, h - 1));
    for (let y = 0; y < h; y++) ring.push(at(0, y), at(w - 1, y));
    const bg = [0, 1, 2].map(ch => ring.map(p => p[ch]).sort((a, b) => a - b)[ring.length >> 1]);
    // Plain = nearly all of the edge within JPEG noise of one colour (a gradient or a photo isn't).
    const near = ring.filter(p => Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]) < 24).length;
    return near >= ring.length * 0.9 ? { kind: 'solid', bg } : { kind: 'photo', bg };
  }

  function processLogo() {
    const mode = document.querySelector('input[name="logo-mode"]:checked')?.value || 'keep';
    const src = logo.src, w = src.width, h = src.height;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, w, h), d = img.data;

    if (mode === 'remove') {
      // Pixels close to the background colour become see-through, with a soft step so edges
      // stay smooth; half-see-through edge pixels lose the background's tint.
      const [br, bgc, bb] = logo.bg;
      const T = Number($('#logo-tol').value) * 2.2, F = 30;
      const dist = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) dist[i] = Math.hypot(d[i * 4] - br, d[i * 4 + 1] - bgc, d[i * 4 + 2] - bb);
      let reach = null;
      if (!$('#logo-holes').checked) {
        // Only the background connected to the edges (so a white letter inside stays white).
        reach = new Uint8Array(w * h);
        const queue = [];
        const push = i => { if (!reach[i] && dist[i] < T + F) { reach[i] = 1; queue.push(i); } };
        for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
        for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
        while (queue.length) {
          const i = queue.pop(), x = i % w;
          if (x > 0) push(i - 1);
          if (x < w - 1) push(i + 1);
          if (i >= w) push(i - w);
          if (i < w * (h - 1)) push(i + w);
        }
      }
      for (let i = 0; i < w * h; i++) {
        if (reach && !reach[i]) continue;
        const a = Math.min(1, Math.max(0, (dist[i] - T) / F));
        if (a >= 1) continue;
        const p = i * 4;
        if (a > 0) {
          d[p] = Math.min(255, Math.max(0, (d[p] - (1 - a) * br) / a));
          d[p + 1] = Math.min(255, Math.max(0, (d[p + 1] - (1 - a) * bgc) / a));
          d[p + 2] = Math.min(255, Math.max(0, (d[p + 2] - (1 - a) * bb) / a));
        }
        d[p + 3] = Math.round(d[p + 3] * a);
      }
    } else if (mode === 'soft') {
      // Edges fade out, so a rectangular picture blends into the menu instead of sitting as a box.
      const f = Math.max(4, Math.round(Math.min(w, h) * 0.12));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const e = Math.min(x, y, w - 1 - x, h - 1 - y) / f;
          if (e >= 1) continue;
          d[(y * w + x) * 4 + 3] *= e * e * (3 - 2 * e);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return mode === 'keep' && logo.kind !== 'transparent' ? out : trim(out, d);
  }

  // Cuts away empty see-through margins (with a little room), so the logo fills its place.
  function trim(canvas, d) {
    const { width: w, height: h } = canvas;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 12) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return canvas;   // nothing left: keep it, the preview shows the problem
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  const luminance = ([r, g, b]) => [r, g, b].map(v => v / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const hexRgb = hex => {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? [...h].map(c => c + c).join('') : h.slice(0, 6);
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  };
  const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  // The logo's average visible colour, and whether it's a see-through, pale logo
  // (the QR code then puts it on a box in the code's colour instead of white, like the admin does).
  function logoStats(canvas) {
    const s = Math.min(1, 64 / Math.max(canvas.width, canvas.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(canvas.width * s));
    c.height = Math.max(1, Math.round(canvas.height * s));
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let clear = 0, solid = 0;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) { clear++; continue; }
      solid++;
      sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2];
    }
    const avg = solid ? sum.map(v => v / solid) : [255, 255, 255];
    // See-through and pale overall (too little contrast with white to show on it).
    return { avg, light: clear > (clear + solid) * 0.1 && solid > 0 && contrast(avg, [255, 255, 255]) < 1.8 };
  }

  function drawPreview(canvas, bg, box) {
    const ctx = canvas.getContext('2d'), w = canvas.width;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, w);
    if (box) {
      ctx.fillStyle = box;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(w * 0.08, w * 0.08, w * 0.84, w * 0.84, w * 0.17) : ctx.rect(w * 0.08, w * 0.08, w * 0.84, w * 0.84);
      ctx.fill();
    }
    const r = logo.result, size = w * 0.68, s = Math.min(size / r.width, size / r.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(r, (w - r.width * s) / 2, (w - r.height * s) / 2, r.width * s, r.height * s);
  }

  let pending = 0;
  function redrawLogo() {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      const mode = document.querySelector('input[name="logo-mode"]:checked')?.value;
      $('#logo-remove-opts').hidden = mode !== 'remove';
      logo.result = processLogo();
      const stats = logoStats(logo.result);
      drawPreview($('#logo-prev-menu'), logo.menuBg, '');
      drawPreview($('#logo-prev-white'), '#ffffff', stats.light ? logo.qrInk : '');
      $('#logo-contrast').hidden = contrast(stats.avg, hexRgb(logo.menuBg)) >= 1.6;
    });
  }

  function setupLogo() {
    $('#logo-form').addEventListener('input', redrawLogo);
    $('#logo-form').addEventListener('change', redrawLogo);
  }

  // menuBg: the menu's background colour; qrInk: the QR code's colour (both for the previews).
  async function prepareLogo(file, { menuBg, qrInk }) {
    const src = await loadSource(file);
    // A logo never needs more than 600 px.
    const s = Math.min(1, 600 / Math.max(src.width, src.height));
    const small = document.createElement('canvas');
    small.width = Math.round(src.width * s);
    small.height = Math.round(src.height * s);
    const sctx = small.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(src, 0, 0, small.width, small.height);
    const { kind, bg } = analyse(small);
    Object.assign(logo, { src: small, kind, bg: bg || [255, 255, 255], menuBg, qrInk });
    $('#logo-verdict').textContent = t({ transparent: 'logoTransparent', solid: 'logoSolid', photo: 'logoPhoto' }[kind]);
    $('#logo-verdict').className = `logo-verdict ${kind === 'transparent' ? 'good' : 'warn'}`;
    $('#logo-modes').hidden = kind === 'transparent';
    $('#logo-tol').value = 18;
    $('#logo-holes').checked = false;
    const mode = { transparent: 'keep', solid: 'remove', photo: 'soft' }[kind];
    document.querySelector(`input[name="logo-mode"][value="${mode}"]`).checked = true;
    const result = runDialog($('#logo-dialog'), $('#logo-form'), () => encode(logo.result || processLogo(), true));
    redrawLogo();
    return result;
  }

  window.ImageEditor = {
    init(translate) {
      t = translate;
      setupCrop();
      setupLogo();
    },
    crop: cropImage,
    logo: prepareLogo,
    isLightLogo: img => logoStats(img).light,
  };
})();
