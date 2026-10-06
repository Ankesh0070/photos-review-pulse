/* Full-screen viewer: swipe, pinch/wheel zoom, filmstrip, info panel, slideshow, video tools */
(() => {
const { $, el, icon } = P;
const V = { ids: [], i: 0, p: null, ctx: 'library', ctxOpts: {}, z: 1, tx: 0, ty: 0, slide: null, ui: true, uiT: null };
const root = () => $('#viewer'), stage = () => $('#v-stage');
let curEl = null, mapObj = null;

async function open(ids, startId, o = {}) {
  V.ids = ids.slice(); V.i = Math.max(0, V.ids.indexOf(startId)); V.ctx = o.ctx || 'library'; V.ctxOpts = o.ctxOpts || {};
  root().classList.remove('hidden'); root().setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
  history.pushState({ v: 1 }, '');
  buildFilm();
  await show(0, true);
  if (o.info) toggleInfo(true);
  poke();
}
function close(fromPop) {
  if (root().classList.contains('hidden')) return;
  stopSlideshow(); closeInfo();
  root().classList.add('hidden'); root().setAttribute('aria-hidden', 'true');
  stage().innerHTML = ''; curEl = null; document.body.classList.remove('no-scroll');
  if (!fromPop && history.state?.v) history.back();
  P.emit('viewer:closed');
}
addEventListener('popstate', () => { if (!root().classList.contains('hidden')) close(true); });

async function show(dir = 0, first = false) {
  const id = V.ids[V.i], p = P.M.photos.get(id);
  if (!p) { if (V.ids.length > 1) { V.ids.splice(V.i, 1); V.i = Math.min(V.i, V.ids.length - 1); return show(0, first); } return close(); }
  V.p = p; resetZoom(true);
  const url = await P.fullURL(id);
  if (V.ids[V.i] !== id) return;
  const holder = el('div', { class: 'v-slide' });
  let node;
  if (p.kind === 'video') {
    node = el('video', { src: url, controls: true, autoplay: true, playsinline: true, loop: !!V.loop, poster: await P.thumbURL(id) });
    node.addEventListener('click', e => e.stopPropagation());
  } else {
    node = el('img', { src: url, alt: p.desc || p.name || 'Photo', draggable: false });
    node.style.opacity = 0; node.onload = () => node.style.opacity = 1;
    P.thumbURL(id).then(t => { if (t && !node.complete) { node.style.backgroundImage = `url(${t})`; node.style.backgroundSize = 'contain'; node.style.backgroundRepeat = 'no-repeat'; node.style.backgroundPosition = 'center'; node.style.opacity = 1; } });
  }
  holder.appendChild(node);
  const old = stage().firstElementChild;
  if (old && dir && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    holder.classList.add(dir > 0 ? 'in-r' : 'in-l'); old.classList.add(dir > 0 ? 'out-l' : 'out-r');
    stage().appendChild(holder); setTimeout(() => old.remove(), 260); requestAnimationFrame(() => holder.classList.remove('in-r', 'in-l'));
  } else { stage().innerHTML = ''; stage().appendChild(holder); }
  curEl = node; V.slide = holder;
  $('#v-title').textContent = `${P.fmt.dateLong(p.takenAt)} · ${P.fmt.time(p.takenAt)}`;
  renderActions(); renderBottom(); updateFilm();
  $('#v-prev').classList.toggle('hidden', V.i === 0); $('#v-next').classList.toggle('hidden', V.i >= V.ids.length - 1);
  if (!$('#v-info').classList.contains('hidden')) renderInfo();
  // preload neighbours
  [V.i - 1, V.i + 1].forEach(j => { const q = V.ids[j]; if (q) P.fullURL(q).then(u => { const m = P.M.photos.get(q); if (u && m?.kind === 'image') { const i = new Image(); i.src = u; } }); });
}
const next = () => { if (V.i < V.ids.length - 1) { V.i++; show(1); } };
const prev = () => { if (V.i > 0) { V.i--; show(-1); } };

/* ---------- top actions ---------- */
function renderActions() {
  const a = $('#v-actions'); a.innerHTML = ''; const p = V.p;
  const b = (ic, t, fn, extra = '') => { const x = el('button', { class: 'ib lt ' + extra, title: t, 'aria-label': t, onclick: e => { e.stopPropagation(); fn(e); } }, icon(ic, extra.includes('on') ? 'fill' : '')); a.appendChild(x); return x; };
  if (V.ctx === 'trash') {
    b('restore_from_trash', 'Restore', async () => { await P.ops.restore([p.id]); removeCurrent(); });
    b('delete_forever', 'Delete permanently', async () => { if (await P.ops.purge([p.id])) removeCurrent(); });
    b('info', 'Info', () => toggleInfo());
    return;
  }
  if (p.kind === 'image') b('document_scanner', 'Copy text from image', () => lens());
  b('slideshow', 'Slideshow', startSlideshow);
  if (p.kind === 'image') b('zoom_in', 'Zoom', () => zoomBy(V.z > 1 ? 0 : 2.2));
  b('share', 'Share', () => P.ops.share([p.id]));
  b('add', 'Add to album', () => P.ops.addToAlbum([p.id]));
  b('tune', 'Edit', () => p.kind === 'image' ? P.editor.open(p.id) : trimVideo());
  b('info', 'Info (I)', () => toggleInfo(), !$('#v-info').classList.contains('hidden') ? 'on' : '');
  if (V.ctx === 'search' && V.ctxOpts.sid) b('task_alt', 'This is the photo I was looking for', async () => { await P.memory.resolveFromViewer(p.id, V.ctxOpts); renderActions(); });
  b('star', p.fav ? 'Remove from favorites' : 'Add to favorites', async () => { await P.ops.fav([p.id]); renderActions(); renderBottom(); }, p.fav ? 'on' : '');
  b('delete', 'Move to trash (#)', trashCurrent);
  b('more_vert', 'More', e => moreMenu(e.currentTarget));
}
function renderBottom() {
  const bt = $('#v-bottom'); bt.innerHTML = ''; const p = V.p; if (V.ctx === 'trash') return;
  const mk = (ic, l, fn) => bt.appendChild(el('button', { onclick: e => { e.stopPropagation(); fn(); } }, icon(ic), el('span', {}, l)));
  mk('share', 'Share', () => P.ops.share([p.id]));
  mk('tune', 'Edit', () => p.kind === 'image' ? P.editor.open(p.id) : trimVideo());
  if (p.kind === 'image') mk('document_scanner', 'Lens', lens);
  mk('delete', 'Delete', trashCurrent);
}
function moreMenu(anchor) {
  const p = V.p, items = [
    { icon: 'download', label: 'Download', kbd: 'Shift+D', onClick: () => P.ops.download([p.id]) },
    p.kind === 'image' ? { icon: 'content_copy', label: 'Copy image', onClick: () => P.ops.copy(p.id) } : { icon: 'loop', label: V.loop ? 'Turn off loop' : 'Loop video', onClick: () => { V.loop = !V.loop; if (curEl) curEl.loop = V.loop; } },
    p.kind === 'video' ? { icon: 'speed', label: 'Playback speed', onClick: speedMenu } : null,
    { icon: 'print', label: 'Print', onClick: () => P.ops.print(p.id) },
    '-',
    { icon: 'archive', label: p.archived ? 'Unarchive' : 'Archive', kbd: 'Shift+A', onClick: async () => { await P.ops.archive([p.id], !p.archived); if (V.ctx !== 'archive' || !p.archived) renderActions(); } },
    { icon: 'lock', label: 'Move to Locked Folder', onClick: async () => { await P.ops.lock([p.id]); removeCurrent(); } },
    V.ctx === 'album' ? { icon: 'image', label: 'Use as album cover', onClick: async () => { const a = P.M.albums.get(V.ctxOpts.albumId); a.cover = p.id; await P.saveAlbum(a); P.toast('Album cover updated'); } } : null,
    V.ctx === 'album' ? { icon: 'remove_circle_outline', label: 'Remove from album', onClick: async () => { await P.removeFromAlbum(V.ctxOpts.albumId, [p.id]); removeCurrent(); } } : null,
    '-',
    { icon: 'edit', label: 'Rename', onClick: () => P.ops.rename(p.id).then(() => renderInfo()) },
    { icon: 'edit_calendar', label: 'Edit date & time', onClick: () => P.ops.editDate([p.id]).then(() => show(0)) },
    { icon: 'location_on', label: 'Edit location', onClick: () => P.ops.editLocation([p.id]).then(() => renderInfo()) },
    p.stackId ? { icon: 'layers_clear', label: 'Remove from stack', onClick: () => P.ops.unstack([p.id]) } : null,
    p.kind === 'image' ? { icon: 'face', label: 'Find faces in this photo', onClick: () => P.ml.facesFor(p.id).then(() => renderInfo()) } : null,
    p.kind === 'image' ? { icon: 'wallpaper', label: 'Set as wallpaper — download', onClick: () => P.ops.download([p.id]) } : null,
  ].filter(Boolean);
  P.menuAt(anchor, items);
}
function speedMenu() { P.pick('Playback speed', [0.25, 0.5, 1, 1.5, 2].map(s => ({ value: s, label: s === 1 ? 'Normal' : s + '×', icon: 'speed' }))).then(s => { if (s && curEl) curEl.playbackRate = s; }); }
async function trashCurrent() {
  const p = V.p; await P.ops.trash([p.id]); removeCurrent();
}
function removeCurrent() {
  V.ids.splice(V.i, 1);
  if (!V.ids.length) return close();
  if (V.i >= V.ids.length) V.i = V.ids.length - 1;
  buildFilm(); show(0);
}

/* ---------- zoom / pan / swipe ---------- */
function apply(anim) { if (!curEl) return; curEl.style.transition = anim ? 'transform .22s cubic-bezier(.3,0,0,1)' : 'none'; curEl.style.transform = `translate(${V.tx}px,${V.ty}px) scale(${V.z})`; stage().classList.toggle('zoomed', V.z > 1.01); }
function resetZoom(noApply) { V.z = 1; V.tx = V.ty = 0; if (!noApply) apply(true); }
function zoomBy(z, cx, cy) {
  if (!curEl || V.p.kind !== 'image') return;
  const nz = P.clamp(z || 1, 1, 8);
  if (cx != null) { const r = stage().getBoundingClientRect(), ox = cx - (r.left + r.width / 2), oy = cy - (r.top + r.height / 2); V.tx = ox - (ox - V.tx) * (nz / V.z); V.ty = oy - (oy - V.ty) * (nz / V.z); }
  V.z = nz; if (nz === 1) V.tx = V.ty = 0; boundPan(); apply(true);
}
function boundPan() {
  if (!curEl) return; const r = stage().getBoundingClientRect(), w = curEl.clientWidth * V.z, h = curEl.clientHeight * V.z;
  const mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (h - r.height) / 2);
  V.tx = P.clamp(V.tx, -mx, mx); V.ty = P.clamp(V.ty, -my, my);
}
function wireStage() {
  const st = stage(), ptrs = new Map();
  let start = null, pinch = null, lastTap = 0, swiping = false;
  st.addEventListener('wheel', e => { e.preventDefault(); if (V.p?.kind !== 'image') return; if (e.ctrlKey || V.z > 1 || e.deltaMode === 0 && Math.abs(e.deltaY) > 0 && !e.shiftKey) zoomBy(V.z * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX, e.clientY); }, { passive: false });
  st.addEventListener('pointerdown', e => {
    if (e.target.closest('video')) { poke(); return; }
    st.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: V.z }; start = null; }
    else start = { x: e.clientX, y: e.clientY, tx: V.tx, ty: V.ty, t: Date.now(), moved: false, id: e.pointerId };
  });
  st.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, e);
    if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); zoomBy(pinch.z * d / pinch.d, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2); V.z = P.clamp(V.z, 1, 8); apply(false); return; }
    if (!start) return; const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) start.moved = true;
    if (V.z > 1.01) { V.tx = start.tx + dx; V.ty = start.ty + dy; boundPan(); apply(false); }
    else if (start.moved && V.p?.kind === 'image' || start.moved && V.p?.kind === 'video' && !e.target.closest('video')) {
      if (Math.abs(dx) > Math.abs(dy) * 1.2 || swiping) { swiping = true; V.slide.style.transition = 'none'; V.slide.style.transform = `translateX(${dx}px)`; }
      else if (dy > 0) { V.slide.style.transition = 'none'; V.slide.style.transform = `translateY(${dy}px) scale(${1 - Math.min(.2, dy / 1500)})`; root().style.background = `rgba(0,0,0,${1 - Math.min(.8, dy / 400)})`; }
    }
  });
  const end = e => {
    if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
    if (pinch) { if (ptrs.size < 2) pinch = null; if (V.z < 1.05) resetZoom(); return; }
    if (!start) return; const dx = e.clientX - start.x, dy = e.clientY - start.y, dt = Date.now() - start.t; const s = start; start = null;
    root().style.background = '';
    if (V.slide) { V.slide.style.transition = 'transform .22s cubic-bezier(.3,0,0,1)'; V.slide.style.transform = ''; }
    if (!s.moved) {
      const now = Date.now();
      if (now - lastTap < 300 && V.p?.kind === 'image') { zoomBy(V.z > 1.05 ? 1 : 2.4, e.clientX, e.clientY); lastTap = 0; } else { lastTap = now; setTimeout(() => { if (lastTap === now) toggleUI(); }, 310); }
      return;
    }
    if (V.z > 1.01) return;
    if (swiping) { swiping = false; if (dx < -70 || (dx < -25 && dt < 250)) next(); else if (dx > 70 || (dx > 25 && dt < 250)) prev(); }
    else if (dy > 120 || (dy > 50 && dt < 200)) close();
  };
  st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
  st.addEventListener('mousemove', poke);
}
function toggleUI() { root().classList.toggle('ui-hidden'); }
function poke() { root().classList.remove('ui-hidden'); clearTimeout(V.uiT); V.uiT = setTimeout(() => { if (V.slideshow || (V.p?.kind === 'image' && matchMedia('(hover:hover)').matches && false)) root().classList.add('ui-hidden'); }, 2500); }

/* ---------- filmstrip ---------- */
function buildFilm() {
  const f = $('#v-film'); f.innerHTML = '';
  f.classList.toggle('hidden', !P.M.settings.viewerFilmstrip || V.ids.length < 2);
  V.ids.forEach((id, i) => {
    const d = el('div', { class: 'fs', 'data-i': i, onclick: e => { e.stopPropagation(); const dir = i - V.i; V.i = i; show(dir > 0 ? 1 : -1); } });
    d._id = id; f.appendChild(d);
  });
  V.filmObs?.disconnect();
  V.filmObs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && !e.target._ld) { e.target._ld = 1; P.thumbURL(e.target._id).then(u => u && (e.target.style.backgroundImage = `url(${u})`)); } }), { root: f, rootMargin: '300px' });
  f.querySelectorAll('.fs').forEach(x => V.filmObs.observe(x));
}
function updateFilm() {
  const f = $('#v-film'); f.querySelector('.cur')?.classList.remove('cur');
  const c = f.children[V.i]; if (c) { c.classList.add('cur'); f.scrollTo({ left: c.offsetLeft - f.clientWidth / 2 + c.clientWidth / 2, behavior: 'smooth' }); }
}

/* ---------- info panel ---------- */
function toggleInfo(force) {
  const i = $('#v-info'), show_ = force ?? i.classList.contains('hidden');
  i.classList.toggle('hidden', !show_); root().classList.toggle('with-info', show_);
  if (show_) renderInfo(); else { mapObj?.remove(); mapObj = null; }
  renderActions();
}
const closeInfo = () => { $('#v-info').classList.add('hidden'); root().classList.remove('with-info'); mapObj?.remove(); mapObj = null; };
async function renderInfo() {
  const p = V.p; if (!p) return; const box = $('#v-info'); box.innerHTML = '';
  box.appendChild(el('div', { class: 'info-h' }, el('button', { class: 'ib', onclick: () => toggleInfo(false) }, icon('close')), el('h3', {}, 'Info')));
  const row = (ic, a, b, onclick) => el('div', { class: 'info-r' + (onclick ? ' click' : ''), onclick }, icon(ic), el('div', {}, el('div', { class: 'ir-a' }, a), b ? el('div', { class: 'ir-b' }, b) : null));
  const ta = el('textarea', { class: 'info-desc', placeholder: 'Add a description', rows: 2 }); ta.value = p.desc || '';
  ta.addEventListener('input', P.debounce(async () => { p.desc = ta.value; await P.savePhoto(p, true); }, 400));
  box.appendChild(el('div', { class: 'info-r' }, icon('notes'), ta));
  // why this matched (only when opened from a search result)
  const why = V.ctx === 'search' && P.memory.explain(p.id);
  if (why) {
    box.appendChild(el('div', { class: 'info-sect' }, 'Why this matched'));
    const w = el('div', { class: 'why' });
    why.matched.forEach(m => w.appendChild(el('div', { class: 'why-r ok' }, icon('check_circle', 'sm'), el('span', {}, m.label + (m.approx ? ' (approximate)' : '')))));
    why.missed.forEach(m => w.appendChild(el('div', { class: 'why-r no' }, icon('cancel', 'sm'), el('span', {}, m.label + ' — not found in this photo'))));
    w.appendChild(el('div', { class: 'why-s' }, `Match score ${Math.round(why.score * 100)}%`)); box.appendChild(w);
  }
  // personal tags + memory note + "name this moment"
  const np = P.notes.panel(p, () => renderInfo()); box.appendChild(np);
  if (P.memory.moment(p.id) === undefined) P.memory.getIndex().then(() => { if (V.p && V.p.id === p.id && !$('#v-info').classList.contains('hidden')) renderInfo(); }).catch(() => { });
  box.appendChild(el('div', { class: 'info-sect' }, 'Details'));
  box.appendChild(row('calendar_today', P.fmt.dateLong(p.takenAt), `${P.DAYS[new Date(p.takenAt).getDay()]}, ${P.fmt.time(p.takenAt)}`, () => P.ops.editDate([p.id]).then(() => { show(0); })));
  box.appendChild(row(p.kind === 'video' ? 'videocam' : 'image', p.name, `${P.fmt.bytes(p.size)}${p.w ? ' · ' + p.w + ' × ' + p.h : ''}${p.kind === 'image' && p.w ? ' · ' + P.fmt.mp(p.w, p.h) : ''}${p.kind === 'video' ? ' · ' + P.fmt.dur(p.duration) : ''}`, () => P.ops.rename(p.id).then(renderInfo)));
  if (p.cam) box.appendChild(row('photo_camera', [p.cam.make, p.cam.model].filter(Boolean).join(' ') || 'Camera', [p.cam.fNumber && 'ƒ/' + (+p.cam.fNumber).toFixed(1), p.cam.exposure && P.fmt.exposure(p.cam.exposure), p.cam.focal && Math.round(p.cam.focal) + 'mm', p.cam.iso && 'ISO ' + p.cam.iso].filter(Boolean).join(' · ')));
  box.appendChild(row('cloud_done', 'Backed up', P.M.settings.quality === 'saver' ? 'Storage saver quality' : 'Original quality'));
  box.appendChild(row('location_on', p.loc ? (p.loc.place || `${p.loc.lat.toFixed(4)}, ${p.loc.lon.toFixed(4)}`) : 'Add a location', p.loc ? 'Click to edit' : '', () => P.ops.editLocation([p.id]).then(renderInfo)));
  if (p.loc) {
    const m = el('div', { class: 'info-map' }); box.appendChild(m);
    setTimeout(() => { if (!window.L) return; mapObj?.remove(); mapObj = L.map(m, { zoomControl: false, attributionControl: false }).setView([p.loc.lat, p.loc.lon], 13); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapObj); L.marker([p.loc.lat, p.loc.lon]).addTo(mapObj); }, 50);
    if (P.M.settings.geocode && !p.loc.place) P.ml.geocode(p).then(() => { if (V.p === p) renderInfo(); });
  }
  const faces = P.M.faces.filter(f => f.photoId === p.id);
  if (faces.length) {
    box.appendChild(el('div', { class: 'info-sect' }, 'People'));
    const wrap = el('div', { class: 'chips' });
    for (const f of faces) { const per = f.personId && P.M.people.get(f.personId); wrap.appendChild(el('button', { class: 'chip', onclick: () => per ? (close(), location.hash = '#/person/' + per.id) : P.explore.namePerson(f) }, el('i', { class: 'chip-av', style: { background: P.hashColor(per?.id || f.id) } }, (per?.name || '?')[0]), per?.name || 'Add name')); }
    box.appendChild(wrap);
  }
  if (p.labels?.length) { box.appendChild(el('div', { class: 'info-sect' }, 'Things')); const w = el('div', { class: 'chips' }); p.labels.slice(0, 8).forEach(l => w.appendChild(el('button', { class: 'chip', onclick: () => { close(); P.search.go(l); } }, l))); box.appendChild(w); }
  const albums = P.M.items.filter(i => i.photoId === p.id).map(i => P.M.albums.get(i.albumId)).filter(Boolean);
  if (albums.length) { box.appendChild(el('div', { class: 'info-sect' }, 'Albums')); albums.forEach(a => box.appendChild(row('photo_album', a.name, P.pluralize(P.albumItems(a.id).length, 'item'), () => { close(); location.hash = '#/album/' + a.id; }))); }
  const st = P.stackOf(p); if (st) box.appendChild(row('layers', `Stack of ${st.length}`, 'Click to remove this photo from its stack', () => P.ops.unstack([p.id])));
  if (p.ocr) { box.appendChild(el('div', { class: 'info-sect' }, 'Text in image')); box.appendChild(el('pre', { class: 'info-ocr' }, p.ocr)); }
}

/* ---------- Lens (OCR) ---------- */
async function lens() {
  const p = V.p; if (p.kind !== 'image') return;
  P.toast('Reading text… (first run downloads the OCR engine)', { ms: 8000 });
  try {
    const text = await P.ml.ocr(p.id);
    if (!text) return P.toast('No text found in this photo');
    const r = await P.dialog({ title: 'Text in photo', body: el('pre', { class: 'ocr-box' }, text), actions: [{ label: 'Close', value: null }, { label: 'Search for text', value: 'search' }, { label: 'Copy all', value: 'copy', primary: true }] });
    if (r === 'copy') { await navigator.clipboard.writeText(text); P.toast('Copied'); }
    if (r === 'search') { close(); P.search.go(text.split(/\s+/).slice(0, 6).join(' ')); }
    if (!$('#v-info').classList.contains('hidden')) renderInfo();
  } catch (e) { P.toast('Text recognition is unavailable offline'); }
}

/* ---------- slideshow ---------- */
function startSlideshow() {
  if (V.ids.length < 1) return; V.slideshow = true;
  root().classList.add('slideshow'); closeInfo();
  (root().requestFullscreen?.() || Promise.resolve()).catch(() => { });
  const tick = () => { if (!V.slideshow) return; const cur = V.p; if (cur?.kind === 'video') { curEl?.addEventListener('ended', adv, { once: true }); } else V.ssT = setTimeout(adv, P.M.settings.slideshowSec * 1000); };
  const adv = () => { if (!V.slideshow) return; V.i = V.i >= V.ids.length - 1 ? 0 : V.i + 1; show(1).then(tick); };
  V.ssAdv = adv; clearTimeout(V.ssT); tick();
  P.toast('Slideshow · press Esc to exit', { ms: 2500 });
}
function stopSlideshow() { if (!V.slideshow) return; V.slideshow = false; clearTimeout(V.ssT); root().classList.remove('slideshow'); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => { }); }

/* ---------- video trim ---------- */
async function trimVideo() {
  const p = V.p, url = await P.fullURL(p.id);
  const vid = el('video', { src: url, controls: true, class: 'trim-v', playsinline: true, muted: true });
  const s = el('input', { type: 'range', min: 0, max: 1000, value: 0 }), e = el('input', { type: 'range', min: 0, max: 1000, value: 1000 });
  const lbl = el('div', { class: 'hint' }, 'Drag the sliders to choose the part to keep.');
  const upd = () => { const d = vid.duration || p.duration || 1, a = s.value / 1000 * d, b = e.value / 1000 * d; lbl.textContent = `${P.fmt.dur(a)} – ${P.fmt.dur(b)}  (${P.fmt.dur(Math.max(0, b - a))})`; };
  s.oninput = () => { if (+s.value >= +e.value) s.value = e.value - 5; vid.currentTime = s.value / 1000 * vid.duration; upd(); };
  e.oninput = () => { if (+e.value <= +s.value) e.value = +s.value + 5; vid.currentTime = e.value / 1000 * vid.duration; upd(); };
  const r = await P.dialog({ title: 'Trim video', width: '640px', body: el('div', {}, vid, el('label', { class: 'rng' }, 'Start', s), el('label', { class: 'rng' }, 'End', e), lbl), actions: [{ label: 'Cancel', value: null }, { label: 'Save copy', value: 'ok', primary: true }] });
  if (r !== 'ok') return;
  P.toast('Trimming in real time — keep this tab open…', { ms: 10000 });
  const d = vid.duration, a = s.value / 1000 * d, b = e.value / 1000 * d;
  const v2 = el('video', { src: url, muted: false, playsinline: true }); v2.currentTime = a;
  await new Promise(r => v2.onseeked = r);
  const stream = v2.captureStream ? v2.captureStream() : null; if (!stream) return P.toast('Trim is not supported in this browser');
  const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm' }), chunks = [];
  rec.ondataavailable = ev => ev.data.size && chunks.push(ev.data);
  const done = new Promise(r => rec.onstop = r);
  rec.start(); v2.play();
  await new Promise(res => { const t = setInterval(() => { if (v2.currentTime >= b || v2.ended) { clearInterval(t); res(); } }, 50); });
  v2.pause(); rec.stop(); await done;
  const blob = new Blob(chunks, { type: 'video/webm' });
  const f = new File([blob], p.name.replace(/\.\w+$/, '') + ' (trimmed).webm', { type: 'video/webm', lastModified: Date.now() });
  await P.ingestFile(f, { takenAt: p.takenAt }); P.emit('photos'); P.toast('Trimmed copy saved');
}

/* ---------- wiring ---------- */
document.addEventListener('DOMContentLoaded', () => {
  $('#v-close').onclick = () => close();
  $('#v-prev').onclick = e => { e.stopPropagation(); prev(); }; $('#v-next').onclick = e => { e.stopPropagation(); next(); };
  wireStage();
  root().addEventListener('mousemove', P.throttle(() => { root().classList.remove('ui-hidden'); clearTimeout(V.uiT); if (V.slideshow) V.uiT = setTimeout(() => root().classList.add('ui-hidden'), 2200); }, 200));
  document.addEventListener('keydown', e => {
    if (root().classList.contains('hidden') || !$('#editor').classList.contains('hidden')) return;
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || document.querySelector('#dialogs .dialog')) return;
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); if (V.slideshow) stopSlideshow(); else if (V.z > 1) resetZoom(); else close(); }
    else if (k === 'ArrowRight' || k === 'j' || k === 'J') next();
    else if (k === 'ArrowLeft' || k === 'k' || k === 'K') prev();
    else if (k === 'i' || k === 'I') toggleInfo();
    else if ((k === 'e' || k === 'E') && V.ctx !== 'trash') V.p.kind === 'image' ? P.editor.open(V.p.id) : trimVideo();
    else if (k === 'Delete' || k === '#') V.ctx === 'trash' ? P.ops.purge([V.p.id]).then(ok => ok && removeCurrent()) : trashCurrent();
    else if (k === 'F' && e.shiftKey) P.ops.fav([V.p.id]).then(renderActions);
    else if (k === 'A' && e.shiftKey) P.ops.archive([V.p.id], !V.p.archived);
    else if (k === 'D' && e.shiftKey) P.ops.download([V.p.id]);
    else if (k === '+' || k === '=') zoomBy(V.z * 1.4); else if (k === '-') zoomBy(V.z / 1.4); else if (k === '0') resetZoom();
    else if (k === ' ' && V.p.kind === 'video' && curEl) { e.preventDefault(); curEl.paused ? curEl.play() : curEl.pause(); }
    else if (k === 's' || k === 'S') V.slideshow ? stopSlideshow() : startSlideshow();
    else if (k === 'ArrowUp' && V.z > 1) { V.ty += 40; boundPan(); apply(true); }
  });
  addEventListener('resize', () => { if (V.z > 1) { boundPan(); apply(); } });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && V.slideshow) stopSlideshow(); });
});
P.on('photos', () => { if (!root().classList.contains('hidden') && V.p && !P.M.photos.has(V.p.id)) removeCurrent(); else if (!root().classList.contains('hidden') && V.p) { V.p = P.M.photos.get(V.p.id) || V.p; } });

P.viewer = { open, close, next, prev, current: () => V.p, isOpen: () => !root().classList.contains('hidden'), refresh: () => show(0) };
})();
