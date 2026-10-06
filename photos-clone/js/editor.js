/* Photo editor: suggestions, crop/straighten/rotate/flip, light & colour adjustments, filters, markup, undo/redo, compare, revert */
(() => {
const { $, el, icon } = P;
const ADJ_DEF = () => ({ brightness: 0, contrast: 0, white: 0, highlights: 0, shadows: 0, black: 0, vignette: 0, saturation: 0, warmth: 0, tint: 0, skin: 0, blue: 0, pop: 0, hdr: 0, sharpen: 0, clarity: 0, fade: 0 });
const GROUPS = [
  ['Light', [['brightness', 'Brightness'], ['contrast', 'Contrast'], ['white', 'White point'], ['highlights', 'Highlights'], ['shadows', 'Shadows'], ['black', 'Black point'], ['vignette', 'Vignette', 0, 100]]],
  ['Color', [['saturation', 'Saturation'], ['warmth', 'Warmth'], ['tint', 'Tint'], ['skin', 'Skin tone'], ['blue', 'Deep blue']]],
  ['Pop & detail', [['pop', 'Pop', 0, 100], ['hdr', 'HDR', 0, 100], ['clarity', 'Clarity', 0, 100], ['sharpen', 'Sharpen', 0, 100], ['fade', 'Fade', 0, 100]]],
];
const FILTERS = [
  { id: 'none', name: 'None', d: {} },
  { id: 'vivid', name: 'Vivid', d: { saturation: 30, contrast: 14, pop: 20 } },
  { id: 'playa', name: 'Playa', d: { warmth: 18, brightness: 8, saturation: 8, fade: 10 } },
  { id: 'honey', name: 'Honey', d: { warmth: 36, tint: 8, contrast: 8, saturation: 6 } },
  { id: 'isla', name: 'Isla', d: { warmth: -14, saturation: 18, brightness: 6, tint: -6 } },
  { id: 'desert', name: 'Desert', d: { warmth: 28, saturation: -10, contrast: 18, fade: 14 } },
  { id: 'clay', name: 'Clay', d: { warmth: 12, saturation: -22, contrast: 10, fade: 18, tint: 6 } },
  { id: 'palma', name: 'Palma', d: { brightness: 10, warmth: 14, saturation: -8, fade: 8 } },
  { id: 'blush', name: 'Blush', d: { warmth: 10, tint: 18, brightness: 6, fade: 12, skin: 20 } },
  { id: 'alpaca', name: 'Alpaca', d: { warmth: -8, saturation: -30, contrast: 12, fade: 20, tint: 4 } },
  { id: 'modena', name: 'Modena', d: { contrast: 22, saturation: 12, warmth: 8, shadows: -14, vignette: 14 } },
  { id: 'reel', name: 'Reel', d: { contrast: 28, saturation: -18, vignette: 24, warmth: 6 } },
  { id: 'vogue', name: 'Vogue', d: { contrast: 24, saturation: -42, brightness: -4, highlights: -10 } },
  { id: 'metro', name: 'Metro', d: { contrast: 16, saturation: -28, warmth: -12, tint: -4, vignette: 10 } },
  { id: 'ollie', name: 'Ollie', d: { bw: 1, contrast: 24 } },
  { id: 'bazaar', name: 'Bazaar', d: { bw: 1, warmth: 30, fade: 20, brightness: 6 } },
  { id: 'mono', name: 'Mono', d: { bw: 1, contrast: 12, brightness: 4 } },
  { id: 'noir', name: 'Noir', d: { bw: 1, contrast: 42, vignette: 34, brightness: -6, black: 12 } },
];
const RATIOS = [['free', 'Free', null], ['orig', 'Original', 'orig'], ['sq', 'Square', 1], ['16:9', '16:9', 16 / 9], ['4:3', '4:3', 4 / 3], ['3:2', '3:2', 3 / 2], ['5:4', '5:4', 5 / 4], ['7:5', '7:5', 7 / 5], ['9:16', '9:16', 9 / 16], ['3:4', '3:4', 3 / 4], ['2:3', '2:3', 2 / 3]];
const COLORS = ['#ffffff', '#202124', '#ea4335', '#fbbc04', '#34a853', '#4285f4', '#ab47bc', '#ff6d00', '#00bcd4'];

const E = { photo: null, img: null, blob: null, tab: 'suggest', pr: null, hist: [], fut: [], canvas: null, wrap: null, cropUI: null, raf: 0, compare: false, mk: { tool: 'pen', color: '#ea4335', size: 5 }, ratio: 'free', flipRatio: false };
const newParams = () => ({ rot: 0, flipH: false, flipV: false, angle: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, adj: ADJ_DEF(), filter: 'none', fstr: 100, marks: [] });
const clone = o => JSON.parse(JSON.stringify(o));
const clamp = P.clamp;

async function open(id) {
  const p = P.M.photos.get(id); if (!p || p.kind !== 'image') return P.toast('Only photos can be edited here');
  E.photo = p; E.blob = await P.getBlob(id);
  const url = URL.createObjectURL(E.blob);
  try { E.img = await P.loadImage(url); } catch { return P.toast('Could not open this image for editing'); }
  E.url = url; E.pr = newParams(); E.hist = []; E.fut = []; E.tab = 'suggest'; E.ratio = 'free';
  E.cropMode = false;
  build();
  $('#editor').classList.remove('hidden'); $('#editor').setAttribute('aria-hidden', 'false'); document.body.classList.add('no-scroll');
  fit(); renderTab(); schedule();
}
function close(force) {
  if (!force && JSON.stringify(E.pr) !== JSON.stringify(newParams()) && !E.saved) {
    P.confirm('Discard changes?', 'Your edits will be lost.', { ok: 'Discard', danger: true }).then(ok => ok && close(true)); return;
  }
  $('#editor').classList.add('hidden'); $('#editor').innerHTML = ''; document.body.classList.remove('no-scroll'); E.saved = false;
  URL.revokeObjectURL(E.url); E.img = null;
}

/* ---------- layout ---------- */
function build() {
  const ed = $('#editor'); ed.innerHTML = '';
  const top = el('div', { class: 'ed-top' },
    el('button', { class: 'ib', onclick: () => close(), title: 'Close', 'aria-label': 'Close editor' }, icon('close')),
    el('div', { class: 'ed-title' }, 'Edit'),
    el('div', { class: 'ed-hist' },
      el('button', { class: 'ib', id: 'ed-undo', onclick: undo, title: 'Undo (Ctrl+Z)' }, icon('undo')),
      el('button', { class: 'ib', id: 'ed-redo', onclick: redo, title: 'Redo (Ctrl+Shift+Z)' }, icon('redo')),
      el('button', { class: 'ib', id: 'ed-cmp', title: 'Hold to compare with original' }, icon('compare'))),
    el('div', { class: 'ed-save' },
      el('button', { class: 'btn-o lt', onclick: () => save(true) }, 'Save copy'),
      el('button', { class: 'btn-p', onclick: () => save(false) }, 'Save'),
      el('button', { class: 'ib lt', title: 'More', onclick: e => P.menuAt(e.currentTarget, [
        { icon: 'restart_alt', label: 'Reset all edits', onClick: () => { commit(); E.pr = newParams(); renderTab(); schedule(); } },
        E.photo.edited ? { icon: 'history', label: 'Revert to original photo', onClick: revertOriginal } : null,
      ].filter(Boolean)) }, icon('more_vert'))));
  E.wrap = el('div', { class: 'ed-stage' }, el('div', { class: 'ed-cv-wrap', id: 'ed-cvw' }, E.canvas = el('canvas', { id: 'ed-canvas' })));
  const side = el('aside', { class: 'ed-side' }, el('div', { class: 'ed-body', id: 'ed-body' }),
    el('nav', { class: 'ed-tabs' }, ...[['suggest', 'auto_awesome', 'Suggestions'], ['crop', 'crop_rotate', 'Crop'], ['adjust', 'tune', 'Adjust'], ['filters', 'filter_vintage', 'Filters'], ['markup', 'draw', 'Markup']].map(([id, ic, l]) =>
      el('button', { class: 'ed-tab', 'data-tab': id, onclick: () => setTab(id) }, icon(ic), el('span', {}, l)))));
  ed.append(top, el('div', { class: 'ed-main' }, E.wrap, side));
  const cmp = $('#ed-cmp');
  const on = () => { E.compare = true; schedule(); }, off = () => { E.compare = false; schedule(); };
  ['pointerdown'].forEach(ev => cmp.addEventListener(ev, on)); ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => cmp.addEventListener(ev, off));
  E.canvas.addEventListener('pointerdown', canvasDown);
  syncHist();
}
function fit() {
  const w = E.wrap.clientWidth - 40, h = E.wrap.clientHeight - 40; E.box = { w: Math.max(100, w), h: Math.max(100, h) };
}
addEventListener('resize', P.debounce(() => { if (E.img && !$('#editor').classList.contains('hidden')) { fit(); schedule(); } }, 120));

function setTab(t) { if (E.tab === 'crop' && t !== 'crop') leaveCrop(); E.tab = t; renderTab(); schedule(); }
function renderTab() {
  P.$$('.ed-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === E.tab));
  const body = $('#ed-body'); body.innerHTML = '';
  ({ suggest: tabSuggest, crop: tabCrop, adjust: tabAdjust, filters: tabFilters, markup: tabMarkup }[E.tab])(body);
  $('#ed-cvw').classList.toggle('marking', E.tab === 'markup');
}

/* ---------- history ---------- */
function commit() { E.hist.push(JSON.stringify(E.pr)); if (E.hist.length > 80) E.hist.shift(); E.fut = []; syncHist(); }
function undo() { if (!E.hist.length) return; E.fut.push(JSON.stringify(E.pr)); E.pr = JSON.parse(E.hist.pop()); afterHist(); }
function redo() { if (!E.fut.length) return; E.hist.push(JSON.stringify(E.pr)); E.pr = JSON.parse(E.fut.pop()); afterHist(); }
function afterHist() { syncHist(); renderTab(); schedule(); }
function syncHist() { const u = $('#ed-undo'), r = $('#ed-redo'); if (u) u.disabled = !E.hist.length; if (r) r.disabled = !E.fut.length; }

/* ---------- rendering pipeline ---------- */
function schedule() { if (E.raf) return; E.raf = requestAnimationFrame(() => { E.raf = 0; draw(); if (E.tab === 'crop') placeCropBox(); }); }
function effAdj(pr) {
  const a = { ...pr.adj }; const f = FILTERS.find(x => x.id === pr.filter); let bw = 0;
  if (f && f.id !== 'none') { const k = pr.fstr / 100; for (const [key, v] of Object.entries(f.d)) { if (key === 'bw') bw = k; else a[key] = (a[key] || 0) + v * k; } }
  a.bw = bw; return a;
}
/* renders params -> canvas at max dimension `maxDim` (0 = original size). opts.noCrop shows the straightened full frame */
function render(target, pr, maxDim, opts = {}) {
  const img = E.img, iw = img.naturalWidth, ih = img.naturalHeight, odd = pr.rot % 2 === 1;
  const bw0 = odd ? ih : iw, bh0 = odd ? iw : ih;
  const sc = maxDim ? Math.min(1, maxDim / Math.max(bw0, bh0)) : 1;
  const bw = Math.max(1, Math.round(bw0 * sc)), bh = Math.max(1, Math.round(bh0 * sc));
  const base = new OffscreenCanvas(bw, bh), bx = base.getContext('2d');
  bx.imageSmoothingQuality = 'high';
  bx.translate(bw / 2, bh / 2);
  const th = pr.angle * Math.PI / 180, ca = Math.abs(Math.cos(th)), sa = Math.abs(Math.sin(th));
  const zoom = ca + sa * Math.max(bw / bh, bh / bw);
  bx.rotate(pr.rot * Math.PI / 2 + th); bx.scale((pr.flipH ? -1 : 1) * (pr.angle ? zoom : 1), (pr.flipV ? -1 : 1) * (pr.angle ? zoom : 1));
  const dw = odd ? bh : bw, dh = odd ? bw : bh;
  bx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  const c = opts.noCrop ? { x: 0, y: 0, w: 1, h: 1 } : pr.crop;
  const ow = Math.max(1, Math.round(bw * c.w)), oh = Math.max(1, Math.round(bh * c.h));
  target.width = ow; target.height = oh;
  const x = target.getContext('2d', { willReadFrequently: true });
  x.drawImage(base, c.x * bw, c.y * bh, ow, oh, 0, 0, ow, oh);
  if (opts.plain) return;
  const a = effAdj(pr);
  if (Object.values(a).some(v => v)) { const id = x.getImageData(0, 0, ow, oh); adjust(id, a, ow, oh); x.putImageData(id, 0, 0); }
  if (!opts.noMarks) drawMarks(x, pr.marks, ow, oh);
}

function adjust(id, a, w, h) {
  const d = id.data, n = w * h;
  // tone LUT
  const lut = new Uint8ClampedArray(256);
  const bp = a.black / 100 * .12, wp = 1 - a.white / 100 * .18, g = Math.pow(2, -(a.brightness + a.hdr * .25) / 70), cf = 1 + a.contrast / 100 * 1.0 + a.pop / 100 * .18;
  const sh = (a.shadows + a.hdr * .55) / 100, hi = (a.highlights - a.hdr * .45) / 100;
  for (let i = 0; i < 256; i++) {
    let x = i / 255;
    x = (x - bp) / Math.max(.05, wp - bp);
    x = Math.pow(clamp(x, 0, 1), g);
    x = (x - .5) * cf + .5;
    const sm = (e0, e1, v) => { const t = clamp((v - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
    x += sh * .3 * (1 - sm(0, .55, x)) * (x > 0 ? 1 : 0) + hi * .3 * sm(.45, 1, x);
    lut[i] = clamp(x, 0, 1) * 255;
  }
  const sat = 1 + a.saturation / 100, pop = a.pop / 100, wa = a.warmth / 100, ti = a.tint / 100, sk = a.skin / 100, bl = a.blue / 100, fade = a.fade / 100, bw = a.bw, vig = a.vignette / 100;
  const cx = w / 2, cy = h / 2, maxd = Math.hypot(cx, cy);
  const doColor = sat !== 1 || pop || wa || ti || sk || bl || fade || bw || vig;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    let r = lut[d[i]], g2 = lut[d[i + 1]], b = lut[d[i + 2]];
    if (doColor) {
      r /= 255; g2 /= 255; b /= 255;
      const lum = .299 * r + .587 * g2 + .114 * b;
      if (sat !== 1 || pop) {
        const mx = Math.max(r, g2, b), mn = Math.min(r, g2, b), ch = mx - mn;
        const s = sat * (1 + pop * (1 - ch) * .9);
        r = lum + (r - lum) * s; g2 = lum + (g2 - lum) * s; b = lum + (b - lum) * s;
      }
      if (wa) { r += wa * .13; b -= wa * .13; g2 += wa * .02; }
      if (ti) { g2 -= ti * .09; r += ti * .045; b += ti * .045; }
      if (sk) { const w2 = clamp((r - g2) * 3, 0, 1) * clamp((g2 - b) * 4, 0, 1); r += sk * .06 * w2; g2 -= sk * .03 * w2; b += sk * .03 * w2; }
      if (bl) { const w2 = clamp((b - Math.max(r, g2)) * 2.5, 0, 1); b += bl * .1 * w2; r -= bl * .05 * w2; g2 -= bl * .03 * w2; }
      if (fade) { r = r * (1 - fade * .3) + fade * .1; g2 = g2 * (1 - fade * .3) + fade * .1; b = b * (1 - fade * .3) + fade * .1; }
      if (bw) { const l = .299 * r + .587 * g2 + .114 * b; r += (l - r) * bw; g2 += (l - g2) * bw; b += (l - b) * bw; }
      if (vig) { const x = p % w, y = (p / w) | 0, dd = Math.hypot(x - cx, y - cy) / maxd, f = 1 - vig * Math.pow(Math.max(0, dd - .25) / .75, 1.6) * 1.1; r *= f; g2 *= f; b *= f; }
      r *= 255; g2 *= 255; b *= 255;
    }
    d[i] = r; d[i + 1] = g2; d[i + 2] = b;
  }
  if (a.clarity) blurMix(id, w, h, Math.max(3, Math.round(Math.max(w, h) / 90)), a.clarity / 100 * .9);
  if (a.sharpen) blurMix(id, w, h, 1, a.sharpen / 100 * 1.4);
}
/* unsharp mask: out = orig + k*(orig - blur(r)) */
function blurMix(id, w, h, r, k) {
  const d = id.data, src = new Uint8ClampedArray(d), tmp = new Uint8ClampedArray(d.length);
  const pass = (a, b, horiz) => {
    const len = horiz ? w : h, lines = horiz ? h : w, step = horiz ? 4 : w * 4, lstep = horiz ? w * 4 : 4;
    for (let l = 0; l < lines; l++) {
      const base = l * lstep;
      for (let c = 0; c < 3; c++) {
        let sum = 0, cnt = 0;
        for (let i = 0; i <= r && i < len; i++) { sum += a[base + i * step + c]; cnt++; }
        for (let i = 0; i < len; i++) {
          b[base + i * step + c] = sum / cnt;
          const add = i + r + 1, rem = i - r;
          if (add < len) { sum += a[base + add * step + c]; cnt++; }
          if (rem >= 0) { sum -= a[base + rem * step + c]; cnt--; }
        }
      }
    }
  };
  pass(src, tmp, true); const blur = new Uint8ClampedArray(d.length); blur.set(src); pass(tmp, blur, false);
  for (let i = 0; i < d.length; i += 4) { d[i] = src[i] + k * (src[i] - blur[i]); d[i + 1] = src[i + 1] + k * (src[i + 1] - blur[i + 1]); d[i + 2] = src[i + 2] + k * (src[i + 2] - blur[i + 2]); }
}

function drawMarks(x, marks, w, h) {
  for (const m of marks) {
    x.save();
    if (m.t === 'text') {
      x.font = `600 ${m.size * w}px "Google Sans", Roboto, sans-serif`; x.fillStyle = m.color; x.textBaseline = 'top';
      x.shadowColor = m.color === '#ffffff' ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.0)'; x.shadowBlur = m.size * w * .15;
      m.text.split('\n').forEach((ln, i) => x.fillText(ln, m.x * w, m.y * h + i * m.size * w * 1.15));
    } else {
      x.strokeStyle = m.color; x.lineWidth = m.size * w * (m.t === 'hl' ? 3 : 1); x.lineCap = m.t === 'hl' ? 'butt' : 'round'; x.lineJoin = 'round';
      if (m.t === 'hl') x.globalAlpha = .38;
      x.beginPath(); m.pts.forEach(([px, py], i) => i ? x.lineTo(px * w, py * h) : x.moveTo(px * w, py * h)); if (m.pts.length === 1) x.lineTo(m.pts[0][0] * w + .01, m.pts[0][1] * h); x.stroke();
    }
    x.restore();
  }
}

function draw() {
  if (!E.img) return;
  const cv = E.canvas, pr = E.compare ? newParams() : E.pr, bx = E.box;
  const crop = E.tab === 'crop' && !E.compare;
  // choose render size so that the display fits box
  const tmpOdd = pr.rot % 2 === 1, iw = tmpOdd ? E.img.naturalHeight : E.img.naturalWidth, ih = tmpOdd ? E.img.naturalWidth : E.img.naturalHeight;
  const cw = crop ? 1 : pr.crop.w, chh = crop ? 1 : pr.crop.h;
  const dispScale = Math.min(bx.w / (iw * cw), bx.h / (ih * chh), 1.6);
  const dpr = Math.min(2, devicePixelRatio || 1);
  const maxDim = Math.min(2000, Math.round(Math.max(iw, ih) * Math.min(1, dispScale * dpr)));
  render(cv, pr, maxDim, { noCrop: crop, noMarks: false });
  const cssW = Math.round(cv.width / (maxDim / Math.max(iw, ih) || 1) * dispScale * (1)); // css size in display px
  const aspect = cv.width / cv.height;
  let w = Math.min(bx.w, bx.h * aspect), h = w / aspect;
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  E.disp = { w, h };
}

/* ---------- Suggestions ---------- */
function stats() {
  const c = document.createElement('canvas'); render(c, { ...E.pr, adj: ADJ_DEF(), filter: 'none', marks: [] }, 200, {});
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, hist = new Uint32Array(256); let sum = 0, n = 0, ssum = 0;
  for (let i = 0; i < d.length; i += 4) { const l = (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) | 0; hist[l]++; sum += l; n++; const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); ssum += mx ? (mx - mn) / mx : 0; }
  let acc = 0, p1 = 0, p99 = 255; for (let i = 0; i < 256; i++) { acc += hist[i]; if (!p1 && acc > n * .01) p1 = i; if (acc > n * .99) { p99 = i; break; } }
  return { mean: sum / n / 255, p1: p1 / 255, p99: p99 / 255, sat: ssum / n };
}
function tabSuggest(body) {
  const items = [
    ['Auto', 'auto_fix_high', () => { const s = stats(); return { black: clamp(s.p1 * 160, 0, 40), white: clamp((1 - s.p99) * 160, 0, 40), brightness: clamp((.45 - s.mean) * 90, -25, 35), contrast: 8, saturation: clamp((.35 - s.sat) * 70, -10, 25), pop: 10, sharpen: 12 }; }],
    ['Dynamic', 'hdr_strong', () => ({ hdr: 55, contrast: 10, saturation: 14, clarity: 25, sharpen: 10 })],
    ['Vivid', 'palette', () => ({ saturation: 34, pop: 40, contrast: 12 })],
    ['Warm', 'wb_sunny', () => ({ warmth: 30, tint: 4, brightness: 4 })],
    ['Cool', 'ac_unit', () => ({ warmth: -30, blue: 20 })],
    ['Bright', 'brightness_high', () => ({ brightness: 22, shadows: 28, highlights: -10 })],
    ['Dramatic', 'contrast', () => ({ contrast: 38, shadows: -12, vignette: 26, saturation: -6, clarity: 28 })],
    ['Soft', 'blur_on', () => ({ contrast: -12, fade: 16, brightness: 8, clarity: 0 })],
    ['Golden hour', 'wb_twilight', () => ({ warmth: 44, tint: 6, highlights: -12, saturation: 12, vignette: 12 })],
    ['Black & white', 'filter_b_and_w', null],
  ];
  body.appendChild(el('div', { class: 'ed-h' }, 'Suggestions'));
  const grid = el('div', { class: 'sug' });
  items.forEach(([name, ic, fn]) => {
    const cv = el('canvas', { width: 96, height: 96 }); const c = document.createElement('canvas');
    const pr = { ...E.pr, crop: { ...E.pr.crop }, marks: [], filter: 'none', adj: ADJ_DEF() };
    if (fn) Object.assign(pr.adj, fn()); else pr.filter = 'mono';
    try { render(c, pr, 120); const x = cv.getContext('2d'), s = Math.max(96 / c.width, 96 / c.height); x.drawImage(c, (96 - c.width * s) / 2, (96 - c.height * s) / 2, c.width * s, c.height * s); } catch { }
    grid.appendChild(el('button', { class: 'sug-i', onclick: () => { commit(); if (fn) { E.pr.adj = { ...ADJ_DEF(), ...fn() }; E.pr.filter = 'none'; } else { E.pr.adj = ADJ_DEF(); E.pr.filter = 'mono'; E.pr.fstr = 100; } schedule(); } }, cv, el('span', {}, name)));
  });
  body.appendChild(grid);
  body.appendChild(el('p', { class: 'hint' }, 'Suggestions are generated locally from this photo’s histogram — nothing is uploaded.'));
}

/* ---------- Adjust ---------- */
function tabAdjust(body) {
  GROUPS.forEach(([title, list], gi) => {
    const sec = el('details', { class: 'ed-grp', open: gi === 0 || list.some(([k]) => E.pr.adj[k]) }, el('summary', {}, title, icon('expand_more')));
    list.forEach(([key, label, mn = -100, mx = 100]) => {
      const val = el('span', { class: 'sv' }, String(Math.round(E.pr.adj[key])));
      const inp = el('input', { type: 'range', min: mn, max: mx, value: E.pr.adj[key], step: 1 });
      inp.style.setProperty('--p', ((E.pr.adj[key] - mn) / (mx - mn) * 100) + '%');
      let pending = false;
      inp.addEventListener('pointerdown', () => { pending = true; commit(); });
      inp.addEventListener('input', () => { if (!pending) { commit(); pending = true; } E.pr.adj[key] = +inp.value; val.textContent = inp.value; inp.style.setProperty('--p', ((+inp.value - mn) / (mx - mn) * 100) + '%'); schedule(); });
      inp.addEventListener('change', () => pending = false);
      sec.appendChild(el('label', { class: 'sl', ondblclick: () => { commit(); E.pr.adj[key] = 0; inp.value = 0; val.textContent = '0'; inp.style.setProperty('--p', ((0 - mn) / (mx - mn) * 100) + '%'); schedule(); }, title: 'Double-click to reset' }, el('div', { class: 'sl-h' }, el('span', {}, label), val), inp));
    });
    body.appendChild(sec);
  });
  body.appendChild(el('button', { class: 'btn-o block', onclick: () => { commit(); E.pr.adj = ADJ_DEF(); renderTab(); schedule(); } }, 'Reset adjustments'));
}

/* ---------- Filters ---------- */
function tabFilters(body) {
  body.appendChild(el('div', { class: 'ed-h' }, 'Filters'));
  const grid = el('div', { class: 'flt' });
  FILTERS.forEach(f => {
    const cv = el('canvas', { width: 84, height: 84 }), c = document.createElement('canvas');
    const pr = { ...E.pr, crop: { ...E.pr.crop }, marks: [], adj: ADJ_DEF(), filter: f.id, fstr: 100 };
    try { render(c, pr, 110); const x = cv.getContext('2d'), s = Math.max(84 / c.width, 84 / c.height); x.drawImage(c, (84 - c.width * s) / 2, (84 - c.height * s) / 2, c.width * s, c.height * s); } catch { }
    grid.appendChild(el('button', { class: 'flt-i' + (E.pr.filter === f.id ? ' on' : ''), onclick: () => { commit(); E.pr.filter = f.id; E.pr.fstr = 100; renderTab(); schedule(); } }, cv, el('span', {}, f.name)));
  });
  body.appendChild(grid);
  if (E.pr.filter !== 'none') {
    const val = el('span', { class: 'sv' }, E.pr.fstr);
    const inp = el('input', { type: 'range', min: 0, max: 100, value: E.pr.fstr });
    inp.style.setProperty('--p', E.pr.fstr + '%');
    inp.addEventListener('pointerdown', commit);
    inp.addEventListener('input', () => { E.pr.fstr = +inp.value; val.textContent = inp.value; inp.style.setProperty('--p', inp.value + '%'); schedule(); });
    body.appendChild(el('label', { class: 'sl' }, el('div', { class: 'sl-h' }, el('span', {}, 'Filter strength'), val), inp));
  }
}

/* ---------- Crop / rotate ---------- */
function tabCrop(body) {
  E.cropMode = true;
  const ratios = el('div', { class: 'ratios' });
  RATIOS.forEach(([id, label]) => ratios.appendChild(el('button', { class: 'rat' + (E.ratio === id ? ' on' : ''), onclick: () => setRatio(id) }, label)));
  body.appendChild(el('div', { class: 'ed-h' }, 'Aspect ratio'));
  body.appendChild(ratios);
  body.appendChild(el('div', { class: 'ed-row' },
    el('button', { class: 'btn-t', onclick: () => { E.flipRatio = !E.flipRatio; setRatio(E.ratio); } }, icon('screen_rotation'), ' Swap orientation')));
  body.appendChild(el('div', { class: 'ed-h' }, 'Straighten'));
  const val = el('span', { class: 'sv' }, E.pr.angle.toFixed(1) + '°');
  const inp = el('input', { type: 'range', min: -45, max: 45, step: .5, value: E.pr.angle });
  inp.style.setProperty('--p', ((E.pr.angle + 45) / 90 * 100) + '%');
  inp.addEventListener('pointerdown', commit);
  inp.addEventListener('input', () => { E.pr.angle = +inp.value; val.textContent = (+inp.value).toFixed(1) + '°'; inp.style.setProperty('--p', ((+inp.value + 45) / 90 * 100) + '%'); schedule(); });
  body.appendChild(el('label', { class: 'sl' }, el('div', { class: 'sl-h' }, el('span', {}, 'Angle'), val), inp));
  body.appendChild(el('div', { class: 'ed-h' }, 'Rotate & flip'));
  body.appendChild(el('div', { class: 'ed-icons' },
    el('button', { class: 'ib-l', onclick: () => { commit(); E.pr.rot = (E.pr.rot + 3) % 4; E.pr.crop = { x: 0, y: 0, w: 1, h: 1 }; schedule(); } }, icon('rotate_left'), el('span', {}, 'Rotate left')),
    el('button', { class: 'ib-l', onclick: () => { commit(); E.pr.rot = (E.pr.rot + 1) % 4; E.pr.crop = { x: 0, y: 0, w: 1, h: 1 }; schedule(); } }, icon('rotate_right'), el('span', {}, 'Rotate right')),
    el('button', { class: 'ib-l', onclick: () => { commit(); E.pr.flipH = !E.pr.flipH; schedule(); } }, icon('flip'), el('span', {}, 'Flip horizontal')),
    el('button', { class: 'ib-l', onclick: () => { commit(); E.pr.flipV = !E.pr.flipV; schedule(); } }, icon('flip', 'rot90'), el('span', {}, 'Flip vertical'))));
  body.appendChild(el('div', { class: 'ed-row' }, el('button', { class: 'btn-o block', onclick: () => { commit(); E.pr.crop = { x: 0, y: 0, w: 1, h: 1 }; E.pr.angle = 0; E.pr.rot = 0; E.pr.flipH = E.pr.flipV = false; E.ratio = 'free'; renderTab(); schedule(); } }, 'Reset crop & rotation')));
  ensureCropUI();
}
function curRatio() {
  const r = RATIOS.find(x => x[0] === E.ratio)?.[2]; if (r == null) return null;
  const odd = E.pr.rot % 2 === 1, base = r === 'orig' ? (odd ? E.img.naturalHeight / E.img.naturalWidth : E.img.naturalWidth / E.img.naturalHeight) : r;
  return E.flipRatio && r !== 'orig' ? 1 / base : base;
}
function setRatio(id) {
  E.ratio = id; const r = curRatio(); const c = E.pr.crop; commit();
  if (r) {
    const odd = E.pr.rot % 2 === 1, W = odd ? E.img.naturalHeight : E.img.naturalWidth, H = odd ? E.img.naturalWidth : E.img.naturalHeight;
    let w = c.w * W, h = c.h * H; const cx = (c.x + c.w / 2), cy = (c.y + c.h / 2);
    if (w / h > r) w = h * r; else h = w / r;
    if (w > W) { w = W; h = w / r; } if (h > H) { h = H; w = h * r; }
    const nw = w / W, nh = h / H; E.pr.crop = { x: clamp(cx - nw / 2, 0, 1 - nw), y: clamp(cy - nh / 2, 0, 1 - nh), w: nw, h: nh };
  }
  renderTab(); schedule();
}
function ensureCropUI() {
  if (E.cropUI) E.cropUI.remove();
  const box = el('div', { class: 'crop-box' }, ...['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(h => el('i', { class: 'h h-' + h, 'data-h': h })), el('div', { class: 'grid3' }));
  $('#ed-cvw').appendChild(box); E.cropUI = box;
  let drag = null;
  box.addEventListener('pointerdown', e => {
    e.preventDefault(); box.setPointerCapture(e.pointerId); const h = e.target.dataset.h || 'move';
    commit(); drag = { h, x: e.clientX, y: e.clientY, c: { ...E.pr.crop } };
  });
  box.addEventListener('pointermove', e => {
    if (!drag) return; const { w: dw, h: dh } = E.disp; let dx = (e.clientX - drag.x) / dw, dy = (e.clientY - drag.y) / dh; const c0 = drag.c; let { x, y, w, h } = c0; const r = curRatio();
    const odd = E.pr.rot % 2 === 1, W = odd ? E.img.naturalHeight : E.img.naturalWidth, H = odd ? E.img.naturalWidth : E.img.naturalHeight, rr = r ? r * H / W : null; // ratio in normalised units
    const hh = drag.h;
    if (hh === 'move') { x = clamp(x + dx, 0, 1 - w); y = clamp(y + dy, 0, 1 - h); }
    else {
      let x1 = x, y1 = y, x2 = x + w, y2 = y + h;
      if (hh.includes('w')) x1 = clamp(x1 + dx, 0, x2 - .04); if (hh.includes('e')) x2 = clamp(x2 + dx, x1 + .04, 1);
      if (hh.includes('n')) y1 = clamp(y1 + dy, 0, y2 - .04); if (hh.includes('s')) y2 = clamp(y2 + dy, y1 + .04, 1);
      if (rr) {
        let nw = x2 - x1, nh = y2 - y1;
        if (hh.length === 2) { if (nw / nh > rr) nw = nh * rr; else nh = nw / rr; }
        else if (hh === 'n' || hh === 's') nw = nh * rr; else nh = nw / rr;
        if (hh.includes('w')) x1 = x2 - nw; else x2 = x1 + nw; if (hh.includes('n')) y1 = y2 - nh; else y2 = y1 + nh;
        if (hh === 'n' || hh === 's') { x1 = (x + w / 2) - nw / 2; x2 = x1 + nw; } if (hh === 'e' || hh === 'w') { y1 = (y + h / 2) - nh / 2; y2 = y1 + nh; }
        if (x1 < 0 || x2 > 1 || y1 < 0 || y2 > 1) return;
      }
      x = x1; y = y1; w = x2 - x1; h = y2 - y1;
    }
    E.pr.crop = { x, y, w, h }; placeCropBox();
  });
  const up = () => { drag = null; }; box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  placeCropBox();
}
function placeCropBox() {
  const b = E.cropUI; if (!b || E.tab !== 'crop') return; const { w, h } = E.disp || {}; if (!w) return; const c = E.pr.crop;
  Object.assign(b.style, { left: c.x * w + 'px', top: c.y * h + 'px', width: c.w * w + 'px', height: c.h * h + 'px', display: 'block' });
  b.parentElement.querySelectorAll('.crop-dim').forEach(x => x.remove());
}
function leaveCrop() { E.cropMode = false; E.cropUI?.remove(); E.cropUI = null; }

/* ---------- Markup ---------- */
function tabMarkup(body) {
  body.appendChild(el('div', { class: 'ed-h' }, 'Tools'));
  const tools = el('div', { class: 'ed-icons' });
  [['pen', 'edit', 'Pen'], ['hl', 'ink_highlighter', 'Highlighter'], ['text', 'title', 'Text'], ['erase', 'ink_eraser', 'Eraser']].forEach(([id, ic, l]) =>
    tools.appendChild(el('button', { class: 'ib-l' + (E.mk.tool === id ? ' on' : ''), onclick: () => { E.mk.tool = id; renderTab(); } }, icon(ic), el('span', {}, l))));
  body.appendChild(tools);
  body.appendChild(el('div', { class: 'ed-h' }, 'Color'));
  const cs = el('div', { class: 'swatches' });
  COLORS.forEach(c => cs.appendChild(el('button', { class: 'sw' + (E.mk.color === c ? ' on' : ''), style: { background: c }, 'aria-label': c, onclick: () => { E.mk.color = c; renderTab(); } })));
  body.appendChild(cs);
  const val = el('span', { class: 'sv' }, E.mk.size);
  const inp = el('input', { type: 'range', min: 2, max: 40, value: E.mk.size }); inp.style.setProperty('--p', ((E.mk.size - 2) / 38 * 100) + '%');
  inp.addEventListener('input', () => { E.mk.size = +inp.value; val.textContent = inp.value; inp.style.setProperty('--p', ((+inp.value - 2) / 38 * 100) + '%'); });
  body.appendChild(el('label', { class: 'sl' }, el('div', { class: 'sl-h' }, el('span', {}, E.mk.tool === 'text' ? 'Text size' : 'Size'), val), inp));
  body.appendChild(el('div', { class: 'ed-row' }, el('button', { class: 'btn-o block', onclick: () => { if (!E.pr.marks.length) return; commit(); E.pr.marks = []; schedule(); } }, 'Clear all markup')));
  body.appendChild(el('p', { class: 'hint' }, E.mk.tool === 'text' ? 'Tap on the photo to place text. Drag existing text to move it.' : 'Draw directly on the photo.'));
}
function canvasDown(e) {
  if (E.tab !== 'markup') return;
  const cv = E.canvas, r = cv.getBoundingClientRect(), fx = ev => clamp((ev.clientX - r.left) / r.width, 0, 1), fy = ev => clamp((ev.clientY - r.top) / r.height, 0, 1);
  const t = E.mk.tool; cv.setPointerCapture(e.pointerId);
  if (t === 'pen' || t === 'hl') {
    commit(); const m = { t, color: E.mk.color, size: E.mk.size / 1000, pts: [[fx(e), fy(e)]] }; E.pr.marks.push(m);
    const mv = ev => { m.pts.push([fx(ev), fy(ev)]); schedule(); }, up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); }; cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); schedule();
  } else if (t === 'erase') {
    commit(); const hit = ev => { const x = fx(ev), y = fy(ev), tol = .03; const n = E.pr.marks.length; E.pr.marks = E.pr.marks.filter(m => m.t === 'text' ? !(x > m.x && x < m.x + m.size * m.text.length * .6 && y > m.y && y < m.y + m.size * 1.2 * (cv.width / cv.height)) : !m.pts.some(([px, py]) => Math.hypot(px - x, (py - y) * cv.height / cv.width) < tol)); if (E.pr.marks.length !== n) schedule(); };
    hit(e); const mv = hit, up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); }; cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
  } else if (t === 'text') {
    const x = fx(e), y = fy(e), ar = cv.width / cv.height;
    const ex = [...E.pr.marks].reverse().find(m => m.t === 'text' && x > m.x && x < m.x + m.size * m.text.length * .6 && y > m.y && y < m.y + m.size * 1.2 * ar);
    if (ex) { commit(); const ox = x - ex.x, oy = y - ex.y; const mv = ev => { ex.x = fx(ev) - ox; ex.y = fy(ev) - oy; schedule(); }, up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); }; cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); return; }
    P.prompt('Add text', { multiline: true, ok: 'Add' }).then(txt => { if (!txt) return; commit(); E.pr.marks.push({ t: 'text', text: txt, x, y, color: E.mk.color, size: E.mk.size / 400 }); schedule(); });
  }
}

/* ---------- Save ---------- */
async function save(asCopy) {
  const p = E.photo; P.toast('Saving…', { ms: 20000 });
  const out = document.createElement('canvas'); render(out, E.pr, Math.min(8192, Math.max(E.img.naturalWidth, E.img.naturalHeight)));
  const png = /png/.test(p.type);
  const blob = await P.canvasBlob(out, png ? 'image/png' : 'image/jpeg', .95);
  const bmp = await createImageBitmap(blob); const th = await P.makeThumb(bmp); bmp.close?.();
  if (asCopy) {
    const id = P.uid(), rec = { ...p, id, sig: id, name: p.name.replace(/(\.\w+)?$/, ' (edited)$1'), size: blob.size, w: th.w, h: th.h, hash: th.hash, color: th.color, createdAt: Date.now(), edited: true, labels: [], ocr: null, faceScan: false, stackId: undefined, fav: false };
    await P.db.put('blobs', { id, blob }); await P.db.put('thumbs', { id, blob: th.blob }); await P.savePhoto(rec); E.saved = true; close(true); P.toast('Saved as copy', { action: 'View', onAction: () => P.viewer.open([id], id) });
  } else {
    if (!p.edited) await P.db.put('misc', { id: 'orig_' + p.id, blob: E.blob, w: p.w, h: p.h });
    await P.db.put('blobs', { id: p.id, blob }); await P.db.put('thumbs', { id: p.id, blob: th.blob }); P.dropURLs(p.id);
    P.features.forget(p.id); P.features.clip.drop(p.id); await P.db.del('features', p.id); await P.db.del('embeddings', p.id);
    Object.assign(p, { size: blob.size, w: th.w, h: th.h, hash: th.hash, color: th.color, edited: true, type: blob.type, faceScan: false });
    P.M.faces = P.M.faces.filter(f => f.photoId !== p.id);
    await P.savePhoto(p); E.saved = true; close(true); P.viewer.isOpen() && P.viewer.refresh(); P.toast('Edits saved');
  }
}
async function revertOriginal() {
  const p = E.photo, o = await P.db.get('misc', 'orig_' + p.id); if (!o) return P.toast('Original not available');
  if (!(await P.confirm('Revert to original?', 'All edits saved to this photo will be removed.', { ok: 'Revert' }))) return;
  const bmp = await createImageBitmap(o.blob, { imageOrientation: 'from-image' }); const th = await P.makeThumb(bmp); bmp.close?.();
  await P.db.put('blobs', { id: p.id, blob: o.blob }); await P.db.put('thumbs', { id: p.id, blob: th.blob }); P.dropURLs(p.id);
  Object.assign(p, { size: o.blob.size, w: th.w, h: th.h, hash: th.hash, color: th.color, edited: false }); await P.savePhoto(p); await P.db.del('misc', 'orig_' + p.id);
  E.saved = true; close(true); P.viewer.isOpen() && P.viewer.refresh(); P.toast('Reverted to original');
}

document.addEventListener('keydown', e => {
  if ($('#editor').classList.contains('hidden')) return;
  if (document.querySelector('#dialogs .dialog')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
  else if (e.key === 'Escape' && !/INPUT|TEXTAREA/.test(e.target.tagName)) close();
  else if (e.key === '\\' ) { E.compare = true; schedule(); }
});
document.addEventListener('keyup', e => { if (e.key === '\\' && E.compare) { E.compare = false; schedule(); } });

P.editor = { open, close };
})();
