/* Ingest: EXIF, thumbnails, hashes, Takeout sidecars, upload tray, drag/drop/paste */
(() => {
const { $, el } = P;

/* ---------- EXIF (JPEG) ---------- */
async function readExif(file) {
  try {
    const buf = await file.slice(0, 512 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return {};
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      if ((marker & 0xFF00) !== 0xFF00) break;
      const size = v.getUint16(off + 2);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
      off += 2 + size;
    }
  } catch { }
  return {};
}
function parseTiff(v, s) {
  const le = v.getUint16(s) === 0x4949;
  const g16 = o => v.getUint16(o, le), g32 = o => v.getUint32(o, le);
  if (g16(s + 2) !== 0x2A) return {};
  const out = {};
  const entries = off => { const n = g16(off), e = {}; for (let i = 0; i < n; i++) { const p = off + 2 + i * 12; e[g16(p)] = { type: g16(p + 2), count: g32(p + 4), vo: p + 8 }; } return e; };
  const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const val = e => {
    const total = (SZ[e.type] || 1) * e.count, d = total <= 4 ? e.vo : s + g32(e.vo);
    if (e.type === 2) { let t = ''; for (let i = 0; i < e.count - 1; i++) t += String.fromCharCode(v.getUint8(d + i)); return t.trim(); }
    if (e.type === 3) return g16(d);
    if (e.type === 4) return g32(d);
    if (e.type === 5) { const n = g32(d), q = g32(d + 4); return q ? n / q : 0; }
    if (e.type === 10) { const n = v.getInt32(d, le), q = v.getInt32(d + 4, le); return q ? n / q : 0; }
    return null;
  };
  const e0 = entries(s + g32(s + 4));
  if (e0[0x010F]) out.make = val(e0[0x010F]);
  if (e0[0x0110]) out.model = val(e0[0x0110]);
  if (e0[0x0112]) out.orientation = val(e0[0x0112]);
  if (e0[0x0132]) out.dateTime = val(e0[0x0132]);
  if (e0[0x8769]) {
    const ex = entries(s + val(e0[0x8769]));
    if (ex[0x9003]) out.dateTimeOriginal = val(ex[0x9003]);
    if (ex[0x829A]) out.exposure = val(ex[0x829A]);
    if (ex[0x829D]) out.fNumber = val(ex[0x829D]);
    if (ex[0x8827]) out.iso = val(ex[0x8827]);
    if (ex[0x920A]) out.focal = val(ex[0x920A]);
    if (ex[0xA434]) out.lens = val(ex[0xA434]);
  }
  if (e0[0x8825]) {
    const gp = entries(s + val(e0[0x8825]));
    const rat = t => { const e = gp[t]; if (!e) return null; const d = s + g32(e.vo); const a = []; for (let i = 0; i < e.count; i++) { const n = g32(d + i * 8), q = g32(d + i * 8 + 4); a.push(q ? n / q : 0); } return a[0] + (a[1] || 0) / 60 + (a[2] || 0) / 3600; };
    const la = rat(2), lo = rat(4);
    if (la != null && lo != null && !(la === 0 && lo === 0)) out.gps = { lat: (gp[1] ? val(gp[1]) : 'N') === 'S' ? -la : la, lon: (gp[3] ? val(gp[3]) : 'E') === 'W' ? -lo : lo };
  }
  return out;
}
const parseExifDate = s => { const m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null; };

/* ---------- thumbnails + hash ---------- */
async function frameFromVideo(blob) {
  const url = URL.createObjectURL(blob);
  const v = P.el('video', { muted: true, playsinline: true, preload: 'auto' });
  v.src = url;
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video')); setTimeout(res, 6000); });
  if (!isFinite(v.duration)) { // MediaRecorder .webm files have no duration header: force the browser to compute it
    try { v.currentTime = 1e101; await new Promise(r => { v.ontimeupdate = r; setTimeout(r, 2500); }); } catch { }
  }
  const realDur = isFinite(v.duration) ? v.duration : 0;
  try { v.currentTime = Math.min(0.3, (realDur || 1) / 3); await new Promise(r => { v.onseeked = r; setTimeout(r, 1500); }); } catch { }
  const w = v.videoWidth || 640, h = v.videoHeight || 360, c = new OffscreenCanvas(w, h);
  c.getContext('2d').drawImage(v, 0, 0, w, h);
  const out = { bmp: c.transferToImageBitmap(), duration: realDur, w, h };
  URL.revokeObjectURL(url);
  return out;
}
async function makeThumb(source, long = 400) {
  const { bmp, ...extra } = source instanceof ImageBitmap ? { bmp: source } : source;
  const s = long / Math.max(bmp.width, bmp.height), sc = Math.min(1, s);
  const w = Math.max(1, Math.round(bmp.width * sc)), h = Math.max(1, Math.round(bmp.height * sc));
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d');
  x.drawImage(bmp, 0, 0, w, h);
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: .82 });
  // dominant colour + dHash (9x8)
  const t = new OffscreenCanvas(9, 8).getContext('2d', { willReadFrequently: true });
  t.drawImage(c, 0, 0, 9, 8);
  const d = t.getImageData(0, 0, 9, 8).data, g = [];
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { g.push(.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]); r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
  let bits = ''; for (let y = 0; y < 8; y++) for (let xx = 0; xx < 8; xx++) bits += g[y * 9 + xx] > g[y * 9 + xx + 1] ? '1' : '0';
  let hash = ''; for (let i = 0; i < 64; i += 4) hash += parseInt(bits.slice(i, i + 4), 2).toString(16);
  const n = d.length / 4;
  return { blob, w: bmp.width, h: bmp.height, hash, color: `rgb(${(r / n) | 0},${(gg / n) | 0},${(b / n) | 0})`, ...extra };
}
const hamming = (a, b) => { let d = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } } return d; };

async function downscale(file, maxMP = 16) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const mp = bmp.width * bmp.height / 1e6;
    if (mp <= maxMP) { bmp.close?.(); return file; }
    const s = Math.sqrt(maxMP / mp), c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await c.convertToBlob({ type: 'image/jpeg', quality: .85 });
  } catch { return file; }
}

/* ---------- ingest one file ---------- */
const VIDEO_RE = /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i, IMG_RE = /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif|svg)$/i;
const kindOf = f => /^video\//.test(f.type) || (!f.type && VIDEO_RE.test(f.name)) ? 'video' : /^image\//.test(f.type) || IMG_RE.test(f.name) ? 'image' : null;

async function ingestFile(file, side = {}) {
  const kind = kindOf(file); if (!kind) return null;
  const sig = `${file.name}|${file.size}|${file.lastModified}`;
  for (const p of P.M.photos.values()) if (p.sig === sig) return { dup: p };
  let blob = file, exif = {}, duration = 0, thumb;
  if (kind === 'image') {
    exif = await readExif(file);
    if (P.M.settings.quality === 'saver' && file.size > 1.5e6) blob = await downscale(file);
    let bmp; try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { throw new Error('Unsupported image format'); }
    thumb = await makeThumb(bmp); bmp.close?.();
  } else {
    const f = await frameFromVideo(file); duration = f.duration;
    thumb = await makeThumb({ bmp: f.bmp });
    thumb.w = f.w; thumb.h = f.h;
  }
  const id = P.uid();
  const takenAt = (side.takenAt) || parseExifDate(exif.dateTimeOriginal || exif.dateTime) || file.lastModified || Date.now();
  const gps = side.gps || exif.gps || null;
  const rec = {
    id, sig, name: file.name, type: blob.type || file.type, kind, size: blob.size, w: thumb.w, h: thumb.h, duration,
    takenAt, createdAt: Date.now(), fav: !!side.fav, archived: !!side.archived, locked: false, trashedAt: side.trashed ? Date.now() : null,
    desc: side.desc || '', loc: gps ? { lat: gps.lat, lon: gps.lon, place: null } : null,
    cam: exif.make || exif.model ? { make: exif.make, model: exif.model, fNumber: exif.fNumber, exposure: exif.exposure, iso: exif.iso, focal: exif.focal, lens: exif.lens } : null,
    hash: thumb.hash, color: thumb.color, labels: [], ocr: null, faceScan: false, tags: [],
    screenshot: /screenshot|screen[ _-]?shot|screen_capture/i.test(file.name) || (kind === 'image' && !exif.make && /^image\/png$/.test(blob.type) && thumb.w >= 600 && Math.abs(thumb.h / thumb.w - 2.16) < .3),
    selfie: /selfie|front/i.test(file.name) || /front/i.test(exif.lens || ''),
    pano: kind === 'image' && (thumb.w / thumb.h >= 2.4 || thumb.h / thumb.w >= 2.4),
    doc: /\b(scan|document|doc|receipt|invoice)\b/i.test(file.name),
  };
  await P.db.put('blobs', { id, blob });
  await P.db.put('thumbs', { id, blob: thumb.blob });
  P.M.photos.set(id, rec); await P.db.put('photos', rec);
  return rec;
}

/* ---------- Takeout sidecar parsing ---------- */
function sidecarKey(name) { return name.replace(/\.(supplemental-metadata|supplemental-meta|suppl)?\.?json$/i, '').replace(/\(\d+\)$/, ''); }
async function readSidecars(files) {
  const map = new Map();
  for (const f of files) if (/\.json$/i.test(f.name) && f.size < 200000) {
    try {
      const j = JSON.parse(await f.text());
      if (!j.photoTakenTime && !j.creationTime && !j.title) continue;
      map.set((j.title || sidecarKey(f.name)).toLowerCase(), j);
    } catch { }
  }
  return map;
}
function sideFor(file, map) {
  const j = map.get(file.name.toLowerCase()) || map.get(file.name.replace(/\(\d+\)(\.\w+)$/, '$1').toLowerCase());
  if (!j) return {};
  const ts = +(j.photoTakenTime?.timestamp || j.creationTime?.timestamp || 0) * 1000;
  const g = j.geoData || j.geoDataExif;
  return { takenAt: ts || null, desc: j.description || '', fav: !!j.favorited, archived: !!j.archived, trashed: !!j.trashed, gps: g && (g.latitude || g.longitude) ? { lat: g.latitude, lon: g.longitude } : null };
}

/* ---------- queue + tray ---------- */
let trayTotal = 0, trayDone = 0, tray = $('#tray');
function trayUpdate() {
  $('#tray-title').textContent = trayDone >= trayTotal ? `${trayDone} item${trayDone === 1 ? '' : 's'} backed up` : `Backing up ${trayDone + 1} of ${trayTotal}`;
  $('#tray-bar').style.width = (trayTotal ? trayDone / trayTotal * 100 : 0) + '%';
}
async function ingestMany(files) {
  files = Array.from(files || []);
  if (!files.length) return [];
  const side = await readSidecars(files);
  const media = files.filter(f => kindOf(f)).sort((a, b) => a.lastModified - b.lastModified);
  if (!media.length) { P.toast(files.some(f => /\.json$/i.test(f.name)) ? 'JSON sidecars need to be uploaded together with their photos' : 'No supported photos or videos'); return []; }
  tray.classList.remove('hidden', 'min'); $('#tray-list').innerHTML = '';
  trayTotal += media.length; trayUpdate();
  const out = []; let dups = 0, fail = 0, i = 0;
  const rows = [];
  for (const f of media) {
    const li = el('li', {}, el('div', { class: 'tr-th' }), el('span', { class: 'tr-n' }, f.name), el('span', { class: 'tr-s' }, '…'));
    rows.push(li); $('#tray-list').prepend(li); if (rows.length > 40) rows.shift().remove();
    try {
      const r = await ingestFile(f, sideFor(f, side));
      if (r?.dup) { dups++; li.querySelector('.tr-s').textContent = 'Already backed up'; }
      else if (r) { out.push(r); li.querySelector('.tr-s').textContent = 'Backed up'; li.classList.add('ok'); P.thumbURL(r.id).then(u => u && (li.querySelector('.tr-th').style.backgroundImage = `url(${u})`)); }
    } catch (e) { fail++; li.querySelector('.tr-s').textContent = 'Failed'; li.classList.add('err'); console.warn(f.name, e); }
    trayDone++; trayUpdate();
    if (++i % 8 === 0) { P.emit('photos'); await P.sleep(0); }
  }
  P.emit('photos');
  P.emit('ingested', out);
  if (trayDone >= trayTotal) { trayTotal = trayDone = 0; }
  P.toast(`${out.length} added` + (dups ? ` · ${dups} already in library` : '') + (fail ? ` · ${fail} failed` : ''));
  if (out.length && P.M.settings.smart) P.ml?.queue(out.map(p => p.id));
  P.refreshStorage?.();
  return out;
}

/* ---------- wiring ---------- */
function wire() {
  const fi = $('#file-input'), fo = $('#folder-input');
  fi.addEventListener('change', () => { ingestMany(fi.files); fi.value = ''; });
  fo.addEventListener('change', () => { ingestMany(fo.files); fo.value = ''; });
  $('#tray-x').onclick = () => tray.classList.add('hidden');
  $('#tray-min').onclick = () => tray.classList.toggle('min');
  $('#btn-upload').onclick = e => P.menuAt(e.currentTarget, [
    { icon: 'photo_library', label: 'Computer · photos & videos', onClick: () => fi.click() },
    { icon: 'folder_open', label: 'Computer · folder', onClick: () => fo.click() },
    { icon: 'photo_camera', label: 'Take a photo or scan', onClick: () => P.create?.camera() },
    { icon: 'content_paste', label: 'Paste from clipboard', onClick: pasteFromClipboard },
  ]);
  let depth = 0;
  addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { depth++; $('#dropzone').classList.remove('hidden'); } });
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('#dropzone').classList.add('hidden'); } });
  addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  addEventListener('drop', async e => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault(); depth = 0; $('#dropzone').classList.add('hidden');
    const files = await filesFromDrop(e.dataTransfer);
    ingestMany(files);
  });
  addEventListener('paste', e => { if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return; const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); ingestMany(f); } });
}
async function filesFromDrop(dt) {
  const items = [...dt.items || []].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!items.length) return [...dt.files];
  const out = [];
  const walk = async en => {
    if (en.isFile) out.push(await new Promise(r => en.file(r)));
    else if (en.isDirectory) { const rd = en.createReader(); let batch; do { batch = await new Promise(r => rd.readEntries(r)); for (const c of batch) await walk(c); } while (batch.length); }
  };
  for (const en of items) await walk(en);
  return out;
}
async function pasteFromClipboard() {
  try {
    const items = await navigator.clipboard.read(), files = [];
    for (const it of items) for (const t of it.types) if (t.startsWith('image/')) files.push(new File([await it.getType(t)], `Pasted ${Date.now()}.${t.split('/')[1]}`, { type: t }));
    if (files.length) ingestMany(files); else P.toast('No image on the clipboard');
  } catch { P.toast('Clipboard access was blocked — use Ctrl+V instead'); }
}
document.addEventListener('DOMContentLoaded', wire);
Object.assign(P, { ingestMany, ingestFile, makeThumb, hamming, readExif, kindOf });
})();
