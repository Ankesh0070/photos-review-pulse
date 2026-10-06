/* Create & Utilities: collage, animation (GIF), movie, camera/scan, review suggestions, print store, sample data */
(() => {
const { $, el, icon } = P;
const getBmps = async ids => { const out = []; for (const id of ids) { const p = P.M.photos.get(id); const b = await P.getBlob(id); if (p.kind === 'image') out.push(await createImageBitmap(b, { imageOrientation: 'from-image' })); } return out; };
async function saveCanvasAsPhoto(canvas, name, type = 'image/jpeg') {
  const blob = await P.canvasBlob(canvas, type, .93);
  const f = new File([blob], name, { type, lastModified: Date.now() });
  const r = await P.ingestFile(f, { takenAt: Date.now() }); P.emit('photos'); return r;
}
function cover(x, img, dx, dy, dw, dh, r = 0) {
  x.save(); if (r) { x.beginPath(); x.roundRect(dx, dy, dw, dh, r); x.clip(); } else { x.beginPath(); x.rect(dx, dy, dw, dh); x.clip(); }
  const s = Math.max(dw / img.width, dh / img.height), w = img.width * s, h = img.height * s; x.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h); x.restore();
}

/* ---------- Collage ---------- */
function layoutsFor(n) {
  const comps = []; const go = (rem, cur) => { if (!rem) { comps.push(cur.slice()); return; } for (let k = 1; k <= Math.min(4, rem); k++) { cur.push(k); go(rem - k, cur); cur.pop(); } }; go(n, []);
  const score = c => Math.max(...c) - Math.min(...c) + Math.abs(c.length - Math.sqrt(n));
  const picks = comps.filter(c => c.length <= 4).sort((a, b) => score(a) - score(b)).slice(0, 10);
  return picks.map(rows => { const rects = []; rows.forEach((cnt, ri) => { for (let i = 0; i < cnt; i++) rects.push([i / cnt, ri / rows.length, 1 / cnt, 1 / rows.length]); }); return rects; });
}
async function collage(ids) {
  if (!ids || ids.length < 2) { ids = await P.picker.photos({ title: 'Choose 2–9 photos for a collage', max: 9, ok: 'Next', kind: 'image' }); if (!ids || ids.length < 2) return ids && P.toast('Pick at least 2 photos'); }
  ids = ids.slice(0, 9);
  const bmps = await getBmps(ids); if (bmps.length < 2) return P.toast('Collages need at least 2 photos');
  const st = { layout: 0, aspect: 1, gap: 8, bg: '#ffffff', radius: 0, order: bmps.map((_, i) => i), sel: null };
  const layouts = layoutsFor(bmps.length);
  const cv = el('canvas', { class: 'cl-cv' }), W = 1600;
  const draw = (canvas = cv, w = W) => {
    const h = Math.round(w / st.aspect); canvas.width = w; canvas.height = h; const x = canvas.getContext('2d');
    x.fillStyle = st.bg; x.fillRect(0, 0, w, h); const g = st.gap * w / 800;
    layouts[st.layout].forEach((r, i) => cover(x, bmps[st.order[i]], r[0] * w + g, r[1] * h + g, r[2] * w - g - (r[0] + r[2] > .999 ? g : 0), r[3] * h - g - (r[1] + r[3] > .999 ? g : 0), st.radius * w / 800));
    if (canvas === cv && st.sel != null) { const r = layouts[st.layout][st.sel]; x.strokeStyle = '#1a73e8'; x.lineWidth = 8; x.strokeRect(r[0] * w + 4, r[1] * h + 4, r[2] * w - 8, r[3] * h - 8); }
  };
  cv.addEventListener('click', e => { const b = cv.getBoundingClientRect(), fx = (e.clientX - b.left) / b.width, fy = (e.clientY - b.top) / b.height; const i = layouts[st.layout].findIndex(r => fx >= r[0] && fx < r[0] + r[2] && fy >= r[1] && fy < r[1] + r[3]); if (i < 0) return; if (st.sel == null) st.sel = i; else { [st.order[st.sel], st.order[i]] = [st.order[i], st.order[st.sel]]; st.sel = null; } draw(); });
  const lay = el('div', { class: 'cl-lay' }); layouts.forEach((L, i) => { const c = el('canvas', { width: 44, height: 44, class: i === st.layout ? 'on' : '', onclick: () => { st.layout = i; st.sel = null; P.$$('canvas', lay).forEach((q, k) => q.classList.toggle('on', k === i)); draw(); } }); const x = c.getContext('2d'); x.fillStyle = '#9aa0a6'; L.forEach(r => x.fillRect(r[0] * 44 + 1, r[1] * 44 + 1, r[2] * 44 - 2, r[3] * 44 - 2)); lay.appendChild(c); });
  const rng = (l, min, max, key) => { const i = el('input', { type: 'range', min, max, value: st[key] }); i.oninput = () => { st[key] = +i.value; draw(); }; return el('label', { class: 'rng' }, l, i); };
  const asp = el('select', { class: 'field', onchange: e => { st.aspect = +e.target.value; draw(); } }, ...[['Square', 1], ['4:5', .8], ['3:4', .75], ['Wide 16:9', 16 / 9], ['Tall 9:16', 9 / 16]].map(([l, v]) => el('option', { value: v }, l)));
  const bg = el('div', { class: 'swatches' }, ...['#ffffff', '#202124', '#f1f3f4', '#fbbc04', '#ea4335', '#34a853', '#4285f4', '#fce8e6'].map(c => el('button', { class: 'sw', style: { background: c }, onclick: () => { st.bg = c; draw(); } })));
  draw();
  const body = el('div', { class: 'cl' }, el('div', { class: 'cl-prev' }, cv), el('div', { class: 'cl-ctl' }, el('b', {}, 'Layout'), lay, el('b', {}, 'Shape'), asp, rng('Spacing', 0, 40, 'gap'), rng('Corners', 0, 60, 'radius'), el('b', {}, 'Background'), bg, el('p', { class: 'hint' }, 'Tip: click two tiles to swap their photos.')));
  const r = await P.dialog({ title: 'Collage', body, width: '860px', cls: 'wide-d', actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'ok', primary: true }] });
  if (r !== 'ok') return;
  st.sel = null; const out = document.createElement('canvas'); draw(out, 2000);
  const rec = await saveCanvasAsPhoto(out, `Collage ${new Date().toISOString().slice(0, 10)}.jpg`); P.toast('Collage saved', { action: 'View', onAction: () => rec && P.viewer.open([rec.id], rec.id) });
}

/* ---------- Animation (GIF) ---------- */
async function animation(ids) {
  if (!ids || ids.length < 2) { ids = await P.picker.photos({ title: 'Choose 2–50 photos to animate', max: 50, ok: 'Next', kind: 'image' }); if (!ids || ids.length < 2) return ids && P.toast('Pick at least 2 photos'); }
  const speed = el('select', { class: 'field' }, ...[['Fast (0.2s)', 200], ['Normal (0.5s)', 500], ['Slow (1s)', 1000]].map(([l, v], i) => el('option', { value: v, selected: i === 1 }, l)));
  const r = await P.dialog({ title: 'Create animation', body: el('div', {}, el('p', {}, `${ids.length} photos will be combined into an animated GIF.`), el('label', {}, 'Speed', speed)), actions: [{ label: 'Cancel', value: null }, { label: 'Create', value: 'ok', primary: true }] });
  if (r !== 'ok') return;
  P.toast('Making GIF…', { ms: 30000 });
  try {
    const { GIFEncoder, quantize, applyPalette } = await import('https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm');
    const bmps = await getBmps(ids), w = 480, h = Math.round(w * bmps[0].height / bmps[0].width), enc = GIFEncoder(), c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
    for (const b of bmps) { x.fillStyle = '#000'; x.fillRect(0, 0, w, h); cover(x, b, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data, pal = quantize(d, 256); enc.writeFrame(applyPalette(d, pal), w, h, { palette: pal, delay: +speed.value }); await P.sleep(0); }
    enc.finish(); const blob = new Blob([enc.bytes()], { type: 'image/gif' });
    const rec = await P.ingestFile(new File([blob], `Animation ${new Date().toISOString().slice(0, 10)}.gif`, { type: 'image/gif', lastModified: Date.now() }), { takenAt: Date.now() }); P.emit('photos');
    P.toast('Animation saved', { action: 'View', onAction: () => rec && P.viewer.open([rec.id], rec.id) });
  } catch (e) { console.warn(e); P.toast('Could not create the GIF (needs internet to fetch the encoder the first time)'); }
}

/* ---------- Movie ---------- */
async function movie(ids) {
  if (!ids || ids.length < 1) { ids = await P.picker.photos({ title: 'Choose photos for your movie', max: 60, ok: 'Next' }); if (!ids?.length) return; }
  const title = el('input', { class: 'field', placeholder: 'Title (optional)', value: '' });
  const theme = el('select', { class: 'field' }, ...[['cinematic', 'Cinematic – slow zoom, letterbox'], ['vibrant', 'Vibrant – quick cuts, zoom'], ['classic', 'Classic – crossfade']].map(([v, l]) => el('option', { value: v }, l)));
  const asp = el('select', { class: 'field' }, ...[['16:9 landscape', 16 / 9], ['1:1 square', 1], ['9:16 portrait', 9 / 16]].map(([l, v]) => el('option', { value: v }, l)));
  const dur = el('select', { class: 'field' }, ...[2, 3, 4, 5].map(v => el('option', { value: v, selected: v === 3 }, `${v} seconds per photo`)));
  const music = el('input', { type: 'file', accept: 'audio/*', class: 'field' });
  const body = el('div', { class: 'filters' }, el('label', {}, 'Title', title), el('label', {}, 'Theme', theme), el('label', {}, 'Shape', asp), el('label', {}, 'Photo length', dur), el('label', {}, 'Soundtrack (optional)', music), el('p', { class: 'hint' }, `${P.pluralize(ids.length, 'clip')} · movies are rendered in real time in this tab (about ${Math.round(ids.length * 3)} seconds). Output is a .webm video.`));
  const r = await P.dialog({ title: 'Create movie', body, width: '480px', actions: [{ label: 'Cancel', value: null }, { label: 'Create movie', value: 'ok', primary: true }] });
  if (r !== 'ok') return;
  const opt = { title: title.value.trim(), theme: theme.value, ar: +asp.value, sec: +dur.value, audio: music.files[0] };
  renderMovie(ids, opt);
}
async function renderMovie(ids, o) {
  const H = o.ar >= 1 ? 720 : 1280, Wd = Math.round(H * o.ar), W = o.ar >= 1 ? Math.round(720 * o.ar) : 720, Hh = o.ar >= 1 ? 720 : Math.round(720 / o.ar), fps = 30;
  const cv = el('canvas', { width: W, height: Hh }), x = cv.getContext('2d');
  const prog = el('div', { class: 'bar' }, el('i', {})); const status = el('p', {}, 'Preparing…');
  let cancel = false; const dlg = P.dialog({ title: 'Rendering movie', width: '440px', body: el('div', {}, cv, status, prog), actions: [{ label: 'Cancel', value: 'cancel' }], onClose: v => { if (v) cancel = true; } });
  cv.style.cssText = 'width:100%;border-radius:12px;background:#000;margin-bottom:8px';
  const stream = cv.captureStream(fps); let ac, dest, srcNode;
  if (o.audio) { try { ac = new AudioContext(); dest = ac.createMediaStreamDestination(); const buf = await ac.decodeAudioData(await o.audio.arrayBuffer()); srcNode = ac.createBufferSource(); srcNode.buffer = buf; srcNode.loop = true; const gain = ac.createGain(); gain.gain.value = .8; srcNode.connect(gain); gain.connect(dest); dest.stream.getAudioTracks().forEach(t => stream.addTrack(t)); } catch { P.toast('Could not read the audio file'); } }
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5e6 }), chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  const items = []; for (const id of ids) { const p = P.M.photos.get(id), b = await P.getBlob(id); items.push(p.kind === 'image' ? { img: await createImageBitmap(b, { imageOrientation: 'from-image' }) } : { vid: b }); }
  rec.start(500); srcNode?.start();
  const frame = () => new Promise(r => setTimeout(r, 1000 / fps));
  const drawItem = (it, t, a = 1) => { // t 0..1
    const zoom = o.theme === 'cinematic' ? 1 + t * .1 : o.theme === 'vibrant' ? 1.08 - t * .08 : 1 + t * .04;
    x.save(); x.globalAlpha = a; const src = it.img || it.v; const iw = src.width || src.videoWidth, ih = src.height || src.videoHeight; const s = Math.max(W / iw, Hh / ih) * zoom;
    // blurred backdrop
    x.drawImage(src, (W - iw * s) / 2, (Hh - ih * s) / 2, iw * s, ih * s); x.restore();
    if (o.theme === 'cinematic') { x.fillStyle = '#000'; const bar = Hh * .08; x.fillRect(0, 0, W, bar); x.fillRect(0, Hh - bar, W, bar); }
  };
  const total = ids.length + (o.title ? 1 : 0); let idx = 0;
  const bar = prog.firstChild; bar.style.width = '0';
  const titleCard = async text => { for (let f = 0; f < fps * 2.5 && !cancel; f++) { x.fillStyle = '#0b0b0b'; x.fillRect(0, 0, W, Hh); x.fillStyle = '#fff'; x.font = `600 ${Math.round(W / 14)}px "Google Sans",Roboto,sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.globalAlpha = Math.min(1, f / 15, (fps * 2.5 - f) / 15); x.fillText(text, W / 2, Hh / 2); x.globalAlpha = 1; await frame(); } };
  if (o.title) { status.textContent = 'Title…'; await titleCard(o.title); }
  let prev = null;
  for (const it of items) {
    if (cancel) break; status.textContent = `Clip ${++idx} of ${ids.length}`;
    if (it.vid) { const u = URL.createObjectURL(it.vid), v = el('video', { src: u, muted: true, playsinline: true }); await new Promise(r => v.onloadeddata = r); it.v = v; v.play(); const len = Math.min(6, v.duration || 3) * 1000, t0 = performance.now(); while (performance.now() - t0 < len && !cancel) { x.fillStyle = '#000'; x.fillRect(0, 0, W, Hh); drawItem(it, 0); await frame(); } v.pause(); URL.revokeObjectURL(u); }
    else { const n = Math.round(o.sec * fps), fade = o.theme === 'vibrant' ? 4 : 14; for (let f = 0; f < n && !cancel; f++) { x.fillStyle = '#000'; x.fillRect(0, 0, W, Hh); if (prev && f < fade) drawItem(prev, 1, 1); drawItem(it, f / n, Math.min(1, (f + 1) / fade)); await frame(); } }
    prev = it; bar.style.width = (idx / total * 100) + '%';
  }
  rec.stop(); srcNode?.stop(); await done; ac?.close();
  document.querySelector('#dialogs .dialog .dialog-card') && $('#dialogs .dialog:last-child')?._close?.(null);
  if (cancel) return P.toast('Movie cancelled');
  const blob = new Blob(chunks, { type: 'video/webm' });
  const rec2 = await P.ingestFile(new File([blob], `Movie ${new Date().toISOString().slice(0, 10)}.webm`, { type: 'video/webm', lastModified: Date.now() }), { takenAt: Date.now() }); P.emit('photos');
  P.toast('Movie saved', { action: 'Watch', onAction: () => rec2 && P.viewer.open([rec2.id], rec2.id) });
}

/* ---------- Camera / document scan ---------- */
async function camera() {
  const v = el('video', { autoplay: true, playsinline: true, muted: true, class: 'cam-v' }); let stream, facing = 'environment', scanMode = false;
  const start = async () => { stream?.getTracks().forEach(t => t.stop()); try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 } }, audio: false }); v.srcObject = stream; } catch { P.toast('Camera permission denied or unavailable'); } };
  const body = el('div', {}, v, el('div', { class: 'cam-bar' },
    el('button', { class: 'btn-o', onclick: () => { facing = facing === 'user' ? 'environment' : 'user'; start(); } }, icon('cameraswitch'), ' Flip'),
    el('label', { class: 'chk' }, el('input', { type: 'checkbox', onchange: e => scanMode = e.target.checked }), ' Document scan (B&W, high contrast)')));
  await start();
  const r = await P.dialog({ title: 'Take a photo', body, width: '720px', actions: [{ label: 'Close', value: null }, { label: 'Capture', value: 'shot', primary: true }], onClose: () => stream?.getTracks().forEach(t => t.stop()) });
  if (r !== 'shot' || !v.videoWidth) return;
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; const x = c.getContext('2d'); x.drawImage(v, 0, 0);
  if (scanMode) { const id = x.getImageData(0, 0, c.width, c.height), d = id.data; let mn = 255, mx = 0; for (let i = 0; i < d.length; i += 4) { const l = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]; mn = Math.min(mn, l); mx = Math.max(mx, l); } for (let i = 0; i < d.length; i += 4) { let l = (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2] - mn) / Math.max(1, mx - mn); l = l > .62 ? 1 : l * 1.2 * l; d[i] = d[i + 1] = d[i + 2] = Math.min(255, l * 255); } x.putImageData(id, 0, 0); }
  const rec = await saveCanvasAsPhoto(c, `${scanMode ? 'Scan' : 'Photo'} ${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.jpg`);
  if (rec && scanMode) { rec.doc = true; await P.savePhoto(rec); } P.toast(scanMode ? 'Document scanned' : 'Photo captured');
}

/* ---------- Utilities hub ---------- */
function sharpness(bmp) { const s = 160 / Math.max(bmp.width, bmp.height), w = Math.max(8, Math.round(bmp.width * s)), h = Math.max(8, Math.round(bmp.height * s)), c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h); for (let i = 0; i < w * h; i++) g[i] = .299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2]; let sum = 0, sq = 0, n = 0; for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) { const l = 4 * g[y * w + xx] - g[y * w + xx - 1] - g[y * w + xx + 1] - g[(y - 1) * w + xx] - g[(y + 1) * w + xx]; sum += l; sq += l * l; n++; } return sq / n - (sum / n) ** 2; }
function dupGroups() {
  const arr = P.list(p => P.live(p) && p.kind === 'image' && p.hash), used = new Set(), groups = [];
  for (let i = 0; i < arr.length; i++) { if (used.has(arr[i].id)) continue; const g = [arr[i]]; for (let j = i + 1; j < arr.length; j++) { if (used.has(arr[j].id)) continue; if (P.hamming(arr[i].hash, arr[j].hash) <= 3) { g.push(arr[j]); used.add(arr[j].id); } } if (g.length > 1) { used.add(arr[i].id); groups.push(g); } }
  return groups;
}
function burstGroups() {
  const arr = P.list(p => P.live(p) && p.kind === 'image' && p.hash && !p.stackId).sort((a, b) => a.takenAt - b.takenAt), groups = []; let cur = [];
  for (const p of arr) { if (cur.length && p.takenAt - cur.at(-1).takenAt < 4000 && P.hamming(p.hash, cur.at(-1).hash) <= 12) cur.push(p); else { if (cur.length > 2) groups.push(cur); cur = [p]; } } if (cur.length > 2) groups.push(cur); return groups;
}
async function utilities(out, [sub]) {
  const view = el('div', { class: 'view' }); out.appendChild(view);
  if (sub) return utilSub(view, sub);
  view.appendChild(el('div', { class: 'view-head' }, el('h1', {}, 'Utilities')));
  const dups = dupGroups(), shots = P.list(p => P.live(p) && p.screenshot), big = P.list(p => P.live(p) && p.size > 20e6), bursts = burstGroups(), docs = P.list(p => P.live(p) && (p.doc));
  view.appendChild(el('div', { class: 'sec-title' }, 'Review suggestions'));
  const sg = el('div', { class: 'util-grid' });
  const card = (ic, t, s, href, n) => sg.appendChild(el('a', { class: 'util', href }, icon(ic), el('div', {}, el('b', {}, t), el('span', {}, s)), n != null ? el('em', {}, n) : null));
  card('content_copy', 'Duplicates & similar', 'Free up space by removing near-identical photos', '#/utilities/duplicates', dups.length);
  card('blur_on', 'Blurry photos', 'Find out-of-focus shots (analysed on this device)', '#/utilities/blurry');
  card('screenshot', 'Screenshots', 'Clean up screenshots you no longer need', '#/utilities/screenshots', shots.length);
  card('layers', 'Burst & stacks', 'Group near-identical sequential shots', '#/utilities/stacks', bursts.length);
  card('movie', 'Large videos', 'Videos and files over 20 MB', '#/utilities/large', big.length);
  card('document_scanner', 'Documents', 'Scans, receipts and notes', '#/utilities/documents', docs.length);
  view.appendChild(sg);
  view.appendChild(el('div', { class: 'sec-title' }, 'Create new'));
  const cr = el('div', { class: 'util-grid' });
  const mk = (ic, t, s, fn) => cr.appendChild(el('button', { class: 'util', onclick: fn }, icon(ic), el('div', {}, el('b', {}, t), el('span', {}, s))));
  mk('photo_album', 'Album', 'Organise photos into a collection', () => P.albums.createFlow([]));
  mk('group_add', 'Shared album', 'Collect photos with friends & family', () => P.albums.createFlow([], true));
  mk('view_quilt', 'Collage', 'Combine photos in a layout', () => collage());
  mk('gif_box', 'Animation', 'Turn photos into a GIF', () => animation());
  mk('movie', 'Movie', 'Create a video with themes & music', () => movie());
  mk('photo_camera', 'Camera & scan', 'Take a photo or scan a document', () => camera());
  mk('auto_stories', 'Photo book', 'Design a printed book', () => printStore('book'));
  view.appendChild(cr);
  view.appendChild(el('div', { class: 'sec-title' }, 'Library & storage'));
  const lb = el('div', { class: 'util-grid' });
  [['archive', 'Archive', '#/archive'], ['delete', 'Trash', '#/trash'], ['lock', 'Locked Folder', '#/locked'], ['history', 'Recently added', '#/utilities/recent'], ['cleaning_services', 'Manage storage', '#/settings/storage'], ['upload_file', 'Import Takeout / folder', null]].forEach(([ic, t, h]) =>
    lb.appendChild(h ? el('a', { class: 'util', href: h }, icon(ic), el('div', {}, el('b', {}, t))) : el('button', { class: 'util', onclick: () => $('#folder-input').click() }, icon(ic), el('div', {}, el('b', {}, t), el('span', {}, 'Pick a folder with photos and Google Takeout .json files')))));
  view.appendChild(lb);
}
async function utilSub(view, sub) {
  const back = t => view.appendChild(el('div', { class: 'view-head' }, el('button', { class: 'ib', onclick: () => location.hash = '#/utilities' }, icon('arrow_back')), el('h1', {}, t)));
  const simple = (title, list, note, empty) => { back(title); if (note) view.appendChild(el('p', { class: 'note' }, icon('info'), note)); if (!list.length) return view.appendChild(P.search.emptyState('check_circle', empty || 'Nothing to review', 'You’re all caught up.')); P.sel.setContext('library'); const h = el('div', {}); view.appendChild(h); P.grid.render(h, list, { zoom: 'month', scrubber: false }); };
  if (sub === 'screenshots') return simple('Screenshots', P.list(p => P.live(p) && p.screenshot), 'Select screenshots and move them to trash to free up space.');
  if (sub === 'large') return simple('Large files', P.list(p => P.live(p) && p.size > 20e6).sort((a, b) => b.size - a.size), 'Sorted by size.');
  if (sub === 'documents') return simple('Documents', P.list(p => P.live(p) && p.doc), 'Photos named like scans, receipts or documents, and anything captured with Document scan.');
  if (sub === 'recent') return simple('Recently added', P.list(p => P.live(p)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 200).sort((a, b) => b.createdAt - a.createdAt));
  if (sub === 'duplicates' || sub === 'stacks') {
    back(sub === 'duplicates' ? 'Duplicates & similar' : 'Burst & stacks');
    const groups = sub === 'duplicates' ? dupGroups() : burstGroups();
    if (!groups.length) return view.appendChild(P.search.emptyState('check_circle', sub === 'duplicates' ? 'No duplicates found' : 'No bursts found', 'Comparison is done on perceptual hashes of your photos.'));
    const total = groups.reduce((s, g) => s + g.slice(1).reduce((a, p) => a + p.size, 0), 0);
    view.appendChild(el('p', { class: 'note' }, icon('info'), sub === 'duplicates' ? `${groups.length} groups — removing the extras could free ${P.fmt.bytes(total)}.` : `${groups.length} sequences of near-identical shots taken seconds apart.`));
    groups.forEach(g => {
      const row = el('div', { class: 'dupg' }); const best = [...g].sort((a, b) => b.size - a.size)[0];
      const strip = el('div', { class: 'dg-strip' }); g.forEach(p => { const t = el('div', { class: 'dg-t' + (p.id === best.id ? ' best' : ''), onclick: () => P.viewer.open(g.map(x => x.id), p.id) }); P.thumbURL(p.id).then(u => u && (t.style.backgroundImage = `url(${u})`)); t.appendChild(el('span', {}, P.fmt.bytes(p.size))); strip.appendChild(t); });
      row.append(strip, el('div', { class: 'dg-a' }, sub === 'duplicates'
        ? el('button', { class: 'btn-o', onclick: async () => { await P.trash(g.filter(p => p.id !== best.id).map(p => p.id)); P.toast('Kept the best, moved the rest to trash'); P.router.render(); } }, 'Keep best, trash others')
        : el('button', { class: 'btn-o', onclick: async () => { await P.ops.stack(g.map(p => p.id)); P.router.render(); } }, icon('layers'), ' Create stack'),
        el('button', { class: 'btn-t', onclick: () => { row.remove(); } }, 'Skip')));
      view.appendChild(row);
    });
    if (sub === 'stacks') view.appendChild(el('button', { class: 'btn-p', style: { margin: '16px 0' }, onclick: async () => { for (const g of groups) await P.ops.stack(g.map(p => p.id)); P.router.render(); } }, 'Stack all'));
    return;
  }
  if (sub === 'blurry') {
    back('Blurry photos'); const msg = el('p', { class: 'note' }, icon('info'), 'Analysing sharpness…'); view.appendChild(msg); const host = el('div', {}); view.appendChild(host);
    const imgs = P.list(p => P.live(p) && p.kind === 'image'); const scored = []; let n = 0;
    for (const p of imgs) { try { if (p.sharp == null) { const bmp = await createImageBitmap(await P.db.get('thumbs', p.id).then(r => r.blob)); p.sharp = sharpness(bmp); bmp.close?.(); await P.db.put('photos', p); } scored.push(p); } catch { } if (++n % 25 === 0) { msg.lastChild.textContent = ` Analysing ${n}/${imgs.length}…`; await P.sleep(0); } }
    const thr = 18, blurry = scored.filter(p => p.sharp < thr).sort((a, b) => a.sharp - b.sharp);
    msg.lastChild.textContent = blurry.length ? ` ${blurry.length} photos look out of focus. Review and delete the ones you don’t need.` : ' No blurry photos found.';
    if (blurry.length) { P.sel.setContext('library'); P.grid.render(host, blurry, { zoom: 'month', scrubber: false }); }
  }
}

/* ---------- Print store ---------- */
const PRODUCTS = {
  prints: { icon: 'photo_size_select_actual', name: 'Photo prints', sizes: [['4×6 in', 10], ['5×7 in', 25], ['8×10 in', 59]], desc: 'Glossy or matte prints from ₹10' },
  book: { icon: 'auto_stories', name: 'Photo book', sizes: [['Softcover 7×7 in', 599], ['Hardcover 8×8 in', 999], ['Hardcover 12×12 in', 1699]], desc: 'Layflat pages, up to 100 photos' },
  canvas: { icon: 'wallpaper', name: 'Canvas print', sizes: [['12×16 in', 1199], ['16×20 in', 1799], ['24×36 in', 3299]], desc: 'Gallery-wrapped canvas' },
  mug: { icon: 'local_cafe', name: 'Photo mug', sizes: [['11 oz ceramic', 399]], desc: 'A favourite photo on a mug' },
  cal: { icon: 'calendar_month', name: 'Photo calendar', sizes: [['Wall calendar 12 mo', 549]], desc: '12 months of memories' },
};
async function printStore(open) {
  const orders = (await P.db.get('misc', 'orders'))?.list || [];
  if (open) return orderFlow(open);
  const view = el('div', { class: 'view' }); $('#outlet').innerHTML = ''; $('#outlet').appendChild(view);
  view.appendChild(el('div', { class: 'view-head' }, el('h1', {}, 'Print store')));
  view.appendChild(el('p', { class: 'note' }, icon('info'), 'Orders are saved locally as a print-ready proof (PDF layout for prints) — there is no payment or shipping backend in this app.'));
  const g = el('div', { class: 'util-grid' }); Object.entries(PRODUCTS).forEach(([k, p]) => g.appendChild(el('button', { class: 'util', onclick: () => orderFlow(k) }, icon(p.icon), el('div', {}, el('b', {}, p.name), el('span', {}, p.desc))))); view.appendChild(g);
  if (orders.length) { view.appendChild(el('div', { class: 'sec-title' }, 'Your orders')); orders.slice().reverse().forEach(o => view.appendChild(el('div', { class: 'll' }, el('div', { class: 'll-th', style: { background: 'var(--c-surface-2)' } }, icon(PRODUCTS[o.product].icon)), el('div', { class: 'll-t' }, el('b', {}, `${PRODUCTS[o.product].name} · ${o.size}`), el('span', {}, `${o.qty} × ${o.count} photos · ₹${o.total} · ${P.fmt.rel(o.t)}`))))); }
}
async function orderFlow(key) {
  const p = PRODUCTS[key]; const ids = await P.picker.photos({ title: `Choose photos for ${p.name.toLowerCase()}`, max: key === 'mug' ? 1 : key === 'canvas' ? 1 : 100, ok: 'Next', kind: 'image' }); if (!ids?.length) return;
  const size = el('select', { class: 'field' }, ...p.sizes.map(([s, pr]) => el('option', { value: s }, `${s} — ₹${pr}`))), qty = el('input', { class: 'field', type: 'number', min: 1, max: 99, value: 1 });
  const total = () => { const pr = p.sizes.find(s => s[0] === size.value)[1]; return key === 'prints' ? pr * ids.length * qty.value : pr * qty.value; };
  const sum = el('div', { class: 'sum' }); const upd = () => sum.textContent = `${P.pluralize(ids.length, 'photo')} · Total ₹${total()}`; size.onchange = qty.oninput = upd; upd();
  const r = await P.dialog({ title: p.name, body: el('div', { class: 'filters' }, el('label', {}, 'Size', size), el('label', {}, 'Quantity', qty), sum), actions: [{ label: 'Cancel', value: null }, { label: 'Save order', value: 'ok', primary: true }] });
  if (r !== 'ok') return;
  const orders = (await P.db.get('misc', 'orders'))?.list || []; orders.push({ product: key, size: size.value, qty: +qty.value, count: ids.length, total: total(), t: Date.now(), ids }); await P.db.put('misc', { id: 'orders', list: orders });
  P.toast('Order saved'); if (location.hash === '#/print') P.router.render();
}

/* ---------- Sample photos (offline demo) ---------- */
async function sample() {
  P.toast('Generating 60 sample photos…', { ms: 15000 });
  const places = [['Goa, India', 15.4909, 73.8278], ['Jaipur, India', 26.9124, 75.7873], ['Bengaluru, India', 12.9716, 77.5946], ['Paris, France', 48.8566, 2.3522], ['Tokyo, Japan', 35.6762, 139.6503], ['New York, United States', 40.7128, -74.006]];
  const scenes = [['sunset', ['#ff7e5f', '#feb47b', '#2b1055']], ['ocean', ['#36d1dc', '#5b86e5', '#0f2027']], ['forest', ['#134e5e', '#71b280', '#0b3d2e']], ['city', ['#4b6cb7', '#182848', '#f5af19']], ['desert', ['#f2994a', '#f2c94c', '#8e4a2b']], ['snow', ['#e6dada', '#274046', '#a8c0ff']]];
  const now = Date.now(), made = [];
  const tripStart = [3, 40, 120, 250, 410, 640];
  for (let i = 0; i < 60; i++) {
    const [sn, cols] = scenes[i % scenes.length], pl = places[Math.floor(i / 10) % places.length], tall = i % 7 === 3, wide = i % 11 === 5, W = wide ? 2400 : tall ? 900 : 1600, H = wide ? 800 : tall ? 1600 : 1066;
    const c = new OffscreenCanvas(W, H), x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, cols[0]); g.addColorStop(.6, cols[1]); g.addColorStop(1, cols[2]); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.arc(W * (.2 + .6 * ((i * 37) % 100) / 100), H * .28, H * .09, 0, 7); x.fill();
    for (let k = 0; k < 3; k++) { x.fillStyle = `rgba(0,0,0,${.18 + k * .14})`; x.beginPath(); x.moveTo(0, H); let px = 0; while (px < W) { const hh = H * (.55 + k * .1) - Math.abs(Math.sin((px + i * 50 + k * 300) / (180 + k * 70))) * H * .22; x.lineTo(px, hh); px += 40; } x.lineTo(W, H); x.fill(); }
    x.fillStyle = 'rgba(255,255,255,.7)'; x.font = `600 ${Math.round(H / 14)}px sans-serif`; x.fillText(`${sn} · ${pl[0].split(',')[0]}`, W * .04, H * .94);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: .85 }), d = new Date(now - tripStart[Math.floor(i / 10)] * 86400000 + (i % 10) * 6.5 * 3.6e6);
    const f = new File([blob], `IMG_${d.toISOString().slice(0, 10).replace(/-/g, '')}_${1000 + i}.jpg`, { type: 'image/jpeg', lastModified: d.getTime() });
    const r = await P.ingestFile(f, { takenAt: d.getTime(), gps: { lat: pl[1] + (Math.random() - .5) * .05, lon: pl[2] + (Math.random() - .5) * .05 }, fav: i % 9 === 0 }); if (r?.id) { r.loc.place = pl[0]; r.labels = [sn]; await P.savePhoto(r, true); made.push(r.id); }
  }
  P.emit('photos'); P.toast('Sample photos added');
}

/* ---------- Demo library: a life story that shows all four memory-search ideas ----------
 * Illustrated (generated) photos with realistic metadata: some tagged / noted, most NOT, so search has real work to do.
 * Also seeds people, albums and a few searches (unfinished / saved / history). Everything stays on this device. */
async function demo() {
  if (P.M.photos.size && !await P.confirm('Add the demo library?', 'It adds ~46 illustrated photos with people, tags, notes and example searches next to your existing photos.', { ok: 'Add demo' })) return;
  P.toast('Building the demo library (about a minute)…', { ms: 90000 });
  const W = 1600, H = 1066, now = Date.now(), DAY = 86400000;
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const skins = ['#f1c9a5', '#d9a47c', '#b87a54', '#8d5a3b'];
  const grad = (x, h, stops) => { const g = x.createLinearGradient(0, 0, 0, h); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; };
  const disc = (x, cx, cy, r, c) => { x.fillStyle = c; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); };
  // a person: head at (cx, cy) radius r; dress/outfit colour; returns normalised face box
  function fig(x, cx, cy, r, o) {
    const dress = o.dress, hem = o.hem || 2.5, skin = o.skin || skins[0];
    x.fillStyle = skin; x.fillRect(cx - r * .28, cy + r * .8, r * .56, r * .6);                       // neck
    x.fillStyle = dress; x.beginPath(); x.moveTo(cx - r * 1.25, cy + r * 1.35); x.lineTo(cx + r * 1.25, cy + r * 1.35);
    x.lineTo(cx + r * hem, cy + r * (o.len || 7)); x.lineTo(cx - r * hem, cy + r * (o.len || 7)); x.closePath(); x.fill();   // outfit
    x.strokeStyle = skin; x.lineWidth = r * .42; x.lineCap = 'round';                                   // arms
    x.beginPath(); x.moveTo(cx - r * 1.2, cy + r * 1.7); x.lineTo(cx - r * 1.55, cy + r * 3.6); x.moveTo(cx + r * 1.2, cy + r * 1.7); x.lineTo(cx + r * 1.55, cy + r * 3.6); x.stroke();
    disc(x, cx, cy - r * .12, r * 1.08, o.hair || '#2b1b17'); disc(x, cx, cy, r, skin);               // hair, face
    x.fillStyle = o.hair || '#2b1b17'; x.beginPath(); x.arc(cx, cy - r * .2, r * 1.02, Math.PI, 0); x.fill();
    x.fillStyle = '#2b1b17'; disc(x, cx - r * .35, cy - r * .05, r * .09, '#2b1b17'); disc(x, cx + r * .35, cy - r * .05, r * .09, '#2b1b17');
    x.strokeStyle = '#a0503c'; x.lineWidth = r * .08; x.beginPath(); x.arc(cx, cy + r * .2, r * .38, .15, Math.PI - .15); x.stroke();
    if (o.bindi) disc(x, cx, cy - r * .5, r * .07, '#c1121f');
    return { x: (cx - r) / W, y: (cy - r) / H, w: 2 * r / W, h: 2 * r / H };
  }
  const flowers = (x, cx, cy, rad, cols, n) => { for (let i = 0; i < n; i++) { const a = rnd() * 7, d = rad * (.3 + rnd() * .7); disc(x, cx + Math.cos(a) * d, cy + Math.sin(a) * d * .6, 10 + rnd() * 16, cols[i % cols.length]); } };
  const balloons = (x, n) => { for (let i = 0; i < n; i++) { const bx = W * (.06 + .88 * rnd()), by = H * (.1 + .3 * rnd()), c = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5'][i % 5]; x.strokeStyle = 'rgba(255,255,255,.6)'; x.beginPath(); x.moveTo(bx, by + 40); x.lineTo(bx + 8, by + 150); x.stroke(); x.fillStyle = c; x.beginPath(); x.ellipse(bx, by, 30, 40, 0, 0, 7); x.fill(); } };
  const rows = [], docs = [];   // rows: photo plans
  const add = (p) => rows.push(Object.assign({ tags: [], faces: [], labels: [] }, p));
  const PINK = '#e8579c', HALL = ['#3b1f2b', '#7a3e48', '#d98c5f'], GARDEN = ['#9fd8f7', '#d8f1e0', '#6aa84f'];
  // ---- 1. Riya's wedding, Jaipur, ~3 years ago (indoors reception + outdoors ceremony). User tagged only TWO of eight.
  for (let i = 0; i < 8; i++) {
    const indoor = i % 2 === 1, pink = i < 5;
    add({
      key: 'wedding', days: 3 * 365 - 20 + Math.floor(i / 3), hour: 17 + i * .4, place: 'Jaipur, India', gps: [26.9124, 75.7873], labels: ['wedding', indoor ? 'indoor' : 'outdoor'],
      tags: i === 0 ? ["Riya's wedding", 'shaadi'] : i === 3 ? ["Riya's wedding"] : [], desc: i === 0 ? 'Me in my pink lehenga with Riya at her wedding' : '', note: i === 0 ? 'Wore the pink lehenga Mom picked. Riya cried during the pheras.' : '',
      draw: (x, F) => {
        x.fillStyle = indoor ? grad(x, H, [[0, HALL[0]], [.55, HALL[1]], [1, HALL[2]]]) : grad(x, H, [[0, GARDEN[0]], [.55, GARDEN[1]], [1, GARDEN[2]]]); x.fillRect(0, 0, W, H);
        if (indoor) { for (let k = 0; k < 14; k++) disc(x, W * (.05 + .07 * k), H * (.08 + .04 * (k % 3)), 9, 'rgba(255,225,150,.9)'); } else { disc(x, W * .82, H * .16, 70, 'rgba(255,248,210,.95)'); }
        x.strokeStyle = '#d4a017'; x.lineWidth = 22; x.beginPath(); x.arc(W * .5, H * .62, H * .52, Math.PI * 1.07, Math.PI * 1.93); x.stroke(); flowers(x, W * .5, H * .12, H * .5, ['#ff7aa8', '#ffb703', '#fb8500', '#fff'], 60);
        x.fillStyle = indoor ? '#5b2a35' : '#5f8f3a'; x.fillRect(0, H * .86, W, H * .14);
        F.push(['me', fig(x, W * .5, H * .3, H * .062, { dress: pink ? PINK : '#2a9d8f', hem: 3.1, len: 7.6, skin: skins[1], hair: '#1a1110', bindi: 1 })]);
        F.push(['Riya', fig(x, W * .27, H * .34, H * .055, { dress: '#c1121f', hem: 2.9, len: 6.6, skin: skins[0], hair: '#241512', bindi: 1 })]);
        if (i % 3 !== 2) F.push(['Mom', fig(x, W * .74, H * .35, H * .055, { dress: '#6a4c93', hem: 2.5, len: 6.3, skin: skins[2], hair: '#9a9a9a' })]);
      },
    });
  }
  // ---- 2. Goa beach trip, ~3 years ago. Nothing tagged: found by time + place + scene only
  for (let i = 0; i < 8; i++) add({
    key: 'goa', days: 3 * 365 + 190 + Math.floor(i / 3), hour: 9 + i * 1.3, place: 'Goa, India', gps: [15.4909, 73.8278], labels: ['beach', 'sea', 'outdoor'], tags: [], desc: '', note: '',
    draw: (x, F) => {
      x.fillStyle = grad(x, H, [[0, '#7ad0f5'], [.45, '#c9efff'], [.46, '#1fa2c7'], [.7, '#0e7fa6'], [.71, '#f2d7a0'], [1, '#e6c27a']]); x.fillRect(0, 0, W, H); disc(x, W * (.2 + .08 * i % 5), H * .14, 70, '#fff3b0');
      x.strokeStyle = 'rgba(255,255,255,.65)'; x.lineWidth = 6; for (let k = 0; k < 5; k++) { x.beginPath(); x.moveTo(0, H * (.5 + .04 * k)); for (let px = 0; px < W; px += 50) x.lineTo(px, H * (.5 + .04 * k) + Math.sin(px / 60 + k + i) * 8); x.stroke(); }
      x.fillStyle = '#e63946'; x.beginPath(); x.moveTo(W * .75, H * .55); x.lineTo(W * .6, H * .7); x.lineTo(W * .9, H * .7); x.fill(); x.fillStyle = '#6b4a2b'; x.fillRect(W * .748, H * .55, 8, H * .3);
      F.push(['Dad', fig(x, W * .3, H * .5, H * .05, { dress: '#2a6f97', hem: 1.9, len: 5.2, skin: skins[2], hair: '#222' })]); if (i % 2) F.push(['me', fig(x, W * .45, H * .54, H * .05, { dress: '#ffd166', hem: 2.1, len: 5, skin: skins[1], hair: '#1a1110' })]);
    },
  });
  // ---- 3. Mom's 60th birthday, indoors at home (Bengaluru), ~1 year ago. One photo tagged + noted
  for (let i = 0; i < 6; i++) add({
    key: 'bday', days: 365 + 12 + Math.floor(i / 3), hour: 19 + i * .3, place: 'Bengaluru, India', gps: [12.9716, 77.5946], labels: ['birthday', 'cake', 'indoor'],
    tags: i === 1 ? ["Mom's 60th birthday"] : [], desc: i === 1 ? 'Mom blowing out the candles' : '', note: i === 1 ? 'Surprise party! Cousins flew in from Pune. Mom cried and laughed at the same time.' : '',
    draw: (x, F) => {
      x.fillStyle = grad(x, H, [[0, '#2d1b4e'], [.6, '#5b3a7a'], [1, '#8a5a44']]); x.fillRect(0, 0, W, H); balloons(x, 9);
      x.fillStyle = '#7a4b2a'; x.fillRect(W * .15, H * .74, W * .7, H * .26); x.fillStyle = '#f7e3c4'; x.fillRect(W * .4, H * .6, W * .2, H * .14); x.fillStyle = '#ff8fab'; x.fillRect(W * .4, H * .56, W * .2, H * .05);
      for (let k = 0; k < 6; k++) { x.fillStyle = '#ffd60a'; x.fillRect(W * (.42 + .03 * k), H * .5, 6, H * .06); disc(x, W * (.42 + .03 * k) + 3, H * .48, 7, '#ff9f1c'); }
      x.fillStyle = 'rgba(255,255,255,.9)'; x.font = `700 ${H * .06}px sans-serif`; x.fillText('60', W * .47, H * .68);
      F.push(['Mom', fig(x, W * .27, H * .33, H * .06, { dress: '#e5383b', hem: 2.5, len: 6.4, skin: skins[2], hair: '#a7a7a7', bindi: 1 })]); F.push(['Dad', fig(x, W * .72, H * .36, H * .055, { dress: '#1d3557', hem: 2, len: 6, skin: skins[2], hair: '#555' })]); if (i % 2) F.push(['me', fig(x, W * .5, H * .3, H * .045, { dress: PINK, hem: 2.2, len: 5.2, skin: skins[1], hair: '#1a1110' })]);
    },
  });
  // ---- 4. First family vacation, Manali, ~5-6 years ago. One tagged
  for (let i = 0; i < 6; i++) add({
    key: 'vac', days: 5 * 365 + 120 + Math.floor(i / 2), hour: 10 + i * 1.5, place: 'Manali, India', gps: [32.2396, 77.1887], labels: ['mountain', 'snow', 'outdoor'], tags: i === 2 ? ['First family vacation'] : [], desc: i === 2 ? 'All four of us at Rohtang' : '', note: i === 2 ? 'First trip together after Dad retired. Rohtang was freezing.' : '',
    draw: (x, F) => {
      x.fillStyle = grad(x, H, [[0, '#8ec5fc'], [.5, '#e0f4ff'], [1, '#ffffff']]); x.fillRect(0, 0, W, H);
      x.fillStyle = '#7c8fa6'; x.beginPath(); x.moveTo(0, H * .6); x.lineTo(W * .25, H * .2); x.lineTo(W * .5, H * .6); x.fill(); x.fillStyle = '#5d7088'; x.beginPath(); x.moveTo(W * .3, H * .65); x.lineTo(W * .65, H * .12); x.lineTo(W, H * .65); x.fill();
      x.fillStyle = '#fff'; x.beginPath(); x.moveTo(W * .56, H * .28); x.lineTo(W * .65, H * .12); x.lineTo(W * .74, H * .28); x.fill(); x.fillStyle = '#f4f9ff'; x.fillRect(0, H * .72, W, H * .28);
      F.push(['Dad', fig(x, W * .3, H * .38, H * .05, { dress: '#e76f51', hem: 2.1, len: 6, skin: skins[2], hair: '#222' })]); F.push(['Mom', fig(x, W * .45, H * .4, H * .05, { dress: '#9b5de5', hem: 2.1, len: 5.8, skin: skins[2], hair: '#3a2a22', bindi: 1 })]); F.push(['me', fig(x, W * .6, H * .44, H * .042, { dress: '#2ec4b6', hem: 2, len: 5.2, skin: skins[1], hair: '#1a1110' })]);
    },
  });
  // ---- 5. Documents (the survey's #1 "last search"): passport + certificate scans, searchable by text
  [['Passport', 'PASSPORT  REPUBLIC OF INDIA  Type P  Surname KUMAR', 400], ['Degree certificate', 'BACHELOR OF TECHNOLOGY  Computer Science  Convocation 2024', 200]].forEach(([nm, ocr, days], i) => add({
    key: 'doc', days: days + i * 30, hour: 12, place: null, labels: ['document'], tags: [], desc: '', note: '', doc: nm.toLowerCase().replace(/ /g, '_'), ocr,
    draw: x => { x.fillStyle = '#d9d4c7'; x.fillRect(0, 0, W, H); x.fillStyle = '#fbfaf6'; x.fillRect(W * .12, H * .08, W * .76, H * .84); x.fillStyle = '#1d3557'; x.fillRect(W * .12, H * .08, W * .76, H * .14); x.fillStyle = '#fff'; x.font = `700 ${H * .07}px sans-serif`; x.fillText(nm.toUpperCase(), W * .16, H * .18); x.fillStyle = '#c9c3b2'; for (let k = 0; k < 9; k++) x.fillRect(W * .16, H * (.3 + .06 * k), W * (.4 + .3 * ((k * 37) % 5) / 5), 14); disc(x, W * .77, H * .45, H * .12, '#b9b19a'); },
  }));
  // ---- 6. Everyday photos with no tags at all: the "haystack"
  const fill = [['city', ['#4b6cb7', '#182848', '#f5af19'], 'Bengaluru, India', [12.97, 77.59]], ['forest', ['#134e5e', '#71b280', '#0b3d2e'], 'Bengaluru, India', [12.97, 77.59]], ['sunset', ['#ff7e5f', '#feb47b', '#2b1055'], 'Goa, India', [15.49, 73.83]], ['desert', ['#f2994a', '#f2c94c', '#8e4a2b'], 'Jaipur, India', [26.91, 75.79]]];
  for (let i = 0; i < 12; i++) { const [sn, cols, pl, g] = fill[i % 4]; add({ key: 'misc', days: 3 + i * 31 + Math.floor(rnd() * 14), hour: 9 + (i * 7) % 11, place: pl, gps: g, labels: [sn], tags: [], desc: '', note: '', draw: x => { x.fillStyle = grad(x, H, [[0, cols[0]], [.6, cols[1]], [1, cols[2]]]); x.fillRect(0, 0, W, H); disc(x, W * (.2 + .6 * ((i * 37) % 100) / 100), H * .26, H * .09, 'rgba(255,255,255,.85)'); for (let k = 0; k < 3; k++) { x.fillStyle = `rgba(0,0,0,${.18 + k * .14})`; x.beginPath(); x.moveTo(0, H); let px = 0; while (px < W) { x.lineTo(px, H * (.55 + k * .1) - Math.abs(Math.sin((px + i * 50 + k * 300) / (180 + k * 70))) * H * .22); px += 40; } x.lineTo(W, H); x.fill(); } } }); }

  // people (named, with simple avatars) → face records
  const mkAvatar = (c, hair) => { const cv = document.createElement('canvas'); cv.width = cv.height = 96; const g = cv.getContext('2d'); g.fillStyle = '#dfe3ee'; g.fillRect(0, 0, 96, 96); disc(g, 48, 38, 24, hair); disc(g, 48, 42, 22, c); g.fillStyle = '#6a7390'; g.beginPath(); g.arc(48, 100, 36, Math.PI, 0); g.fill(); return cv.toDataURL('image/jpeg', .8); };
  const pNames = { Mom: ['Mom', skins[2], '#9a9a9a'], Riya: ['Riya', skins[0], '#241512'], Dad: ['Dad', skins[2], '#555'], me: ['Me', skins[1], '#1a1110'] }, pid = {};
  for (const [k, [nm, c, h]] of Object.entries(pNames)) { const ex = [...P.M.people.values()].find(p => p.name === nm); if (ex) { pid[k] = ex.id; continue; } const per = { id: P.uid(), name: nm, avatar: mkAvatar(c, h), createdAt: Date.now(), pet: false }; P.M.people.set(per.id, per); await P.db.put('people', per); pid[k] = per.id; }

  const byKey = {}, made = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], c = new OffscreenCanvas(W, H), x = c.getContext('2d'), F = []; r.draw(x, F);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: .86 });
    const d = new Date(now - r.days * DAY); d.setHours(Math.floor(r.hour), Math.round((r.hour % 1) * 60), 0, 0);
    const fn = r.doc ? `scan_${r.doc}_${i}.jpg` : `IMG_${d.toISOString().slice(0, 10).replace(/-/g, '')}_${String(1000 + i)}.jpg`;
    const f = new File([blob], fn, { type: 'image/jpeg', lastModified: d.getTime() });
    const rec = await P.ingestFile(f, { takenAt: d.getTime(), gps: r.gps ? { lat: r.gps[0] + (rnd() - .5) * .01, lon: r.gps[1] + (rnd() - .5) * .01 } : null, fav: i === 0 || i === 9 });
    if (!rec || rec.dup) continue;
    if (rec.loc && r.place) rec.loc.place = r.place; rec.labels = r.labels.slice(); rec.tags = r.tags.slice(); if (r.desc) rec.desc = r.desc; if (r.note) rec.note = r.note;
    if (r.doc) { rec.doc = true; rec.ocr = r.ocr; } rec.faceScan = true;
    await P.savePhoto(rec, true); made.push(rec.id); (byKey[r.key] = byKey[r.key] || []).push(rec.id);
    for (const [who, box] of F) if (pid[who]) { const face = { id: P.uid(), photoId: rec.id, box, desc: null, personId: pid[who] }; P.M.faces.push(face); await P.db.put('faces', face); }
  }
  try { await P.albums.create("Riya's wedding", byKey.wedding.slice(0, 5)); await P.albums.create('Goa 2023', byKey.goa); } catch (e) { console.warn('demo albums', e); }

  // example searches: one unfinished, one saved, a few in history (one already found)
  const keyOf = (q) => P.nlp.normText(q) + '|{}', mk = (q, o) => Object.assign({ id: P.uid(), key: keyOf(q), q, filters: {}, createdAt: now - 3 * DAY, updatedAt: now - 3 * DAY, status: 'open', answers: [], removed: [], skipped: [], extra: '', saved: false, alert: false, newMatches: [], views: 1, resultCount: 0, strongCount: 0 }, o);
  const recs = [
    mk('blue saree photo at my cousin’s engagement', { updatedAt: now - 2 * 3600e3, assistantOpened: true, answers: [P.engine.makeAnswer('setting', 'indoor', 'Indoors')] }),
    mk('wedding photos', { saved: true, name: 'Wedding photos I searched for last week', savedAt: now - 7 * DAY, updatedAt: now - 7 * DAY, alert: true, seenIds: (byKey.wedding || []).slice(0, 5), newMatches: [], resultCount: 5, strongCount: 3 }),
    mk('beach trip around 3 years back', { createdAt: now - 5 * DAY, updatedAt: now - 5 * DAY, resultCount: 8, strongCount: 8, status: 'resolved', foundId: (byKey.goa || [])[2], resolvedAt: now - 5 * DAY }),
    mk('passport', { createdAt: now - 9 * DAY, updatedAt: now - 9 * DAY, resultCount: 1, strongCount: 1, status: 'resolved', foundId: (byKey.doc || [])[0], resolvedAt: now - 9 * DAY }),
    mk('Mom birthday indoors', { createdAt: now - 12 * DAY, updatedAt: now - 12 * DAY, resultCount: 6, strongCount: 5 }),
  ];
  for (const r of recs) { P.M.searches.set(r.id, r); await P.db.put('searches', r); }
  P.emit('photos'); P.emit('notes:changed'); P.emit('searches');
  P.toast(`Demo library added — ${made.length} photos, 4 people, 2 albums`, { action: 'Open Searches', onAction: () => location.hash = '#/searches' });
}

Object.assign(P, { create: { collage, animation, movie, camera, sample, demo, utilities, printStore, dupGroups } });
})();
