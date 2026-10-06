/* Photo grid: justified rows, lazy tiles, day/month/year zoom, scrubber, rubber-band + range select */
(() => {
const { $, el, icon } = P;
const GAP = 3;
const LEVELS = ['year', 'month', 'day'];

/* stacks */
let stackIdx = null;
const buildStacks = () => { stackIdx = new Map(); for (const p of P.M.photos.values()) if (p.stackId && !p.trashedAt) { if (!stackIdx.has(p.stackId)) stackIdx.set(p.stackId, []); stackIdx.get(p.stackId).push(p); } for (const a of stackIdx.values()) a.sort((x, y) => y.takenAt - x.takenAt); };
P.on('photos', () => stackIdx = null);
const stackOf = p => { if (!p.stackId) return null; if (!stackIdx) buildStacks(); return stackIdx.get(p.stackId) || null; };
P.stackOf = stackOf;

function groupPhotos(list, level) {
  const groups = [], map = new Map();
  for (const p of list) {
    const d = new Date(p.takenAt);
    const key = level === 'year' ? d.getFullYear() : level === 'month' ? d.getFullYear() * 12 + d.getMonth() : d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
    let g = map.get(key);
    if (!g) { g = { key, t: p.takenAt, items: [] }; map.set(key, g); groups.push(g); }
    g.items.push(p);
  }
  return groups;
}
const AR = p => P.clamp((p.w && p.h) ? p.w / p.h : 1, .45, 3.2);

function justify(items, W, target) {
  const rows = []; let cur = [], sum = 0;
  for (const p of items) {
    cur.push(p); sum += AR(p);
    if (sum * target + GAP * (cur.length - 1) >= W) {
      const h = (W - GAP * (cur.length - 1)) / sum;
      rows.push({ h: Math.min(h, target * 1.6), items: cur }); cur = []; sum = 0;
    }
  }
  if (cur.length) rows.push({ h: target, items: cur, last: true });
  return rows;
}

/* ---------- main renderer ---------- */
function render(host, list, opts = {}) {
  const o = { zoom: P.M.settings.zoom, headings: true, ctx: 'library', collapseStacks: true, placeLabels: true, scroller: $('#outlet'), scrubber: true, ...opts };
  const ctl = { host, list, opts: o, destroy };
  host.classList.add('grid');
  let level = LEVELS.includes(o.zoom) ? o.zoom : 'day';
  let obs, ro, scrub, W = 0, lastW = 0;
  const disposers = [];

  let shown = list;
  if (o.collapseStacks) { const seen = new Set(); shown = list.filter(p => { if (!p.stackId) return true; if (seen.has(p.stackId)) return false; seen.add(p.stackId); return true; }); }
  const idsFor = p => { const s = o.collapseStacks && stackOf(p); return s ? s.map(x => x.id) : [p.id]; };
  P.sel.setOrder(shown.map(p => p.id));

  function targetH() { const nar = innerWidth < 700; return level === 'day' ? (nar ? 118 : 210) : level === 'month' ? (nar ? 70 : 118) : (nar ? 44 : 72); }

  function build() {
    const prevAnchor = firstVisible();
    host.innerHTML = '';
    W = host.clientWidth || 800; lastW = W;
    const groups = o.flat ? [{ key: 0, t: shown[0]?.takenAt, items: shown }] : groupPhotos(shown, level);
    const target = targetH();
    obs?.disconnect();
    obs = new IntersectionObserver(es => es.forEach(e => e.isIntersecting ? fill(e.target) : unfill(e.target)), { root: o.scroller, rootMargin: '900px 0px' });
    ctl.secs = [];
    for (const g of groups) {
      const sec = el('section', { class: 'sec' });
      if (o.headings && !o.flat) {
        const places = o.placeLabels && level === 'day' ? topPlace(g.items) : '';
        const head = el('div', { class: 'sec-head', 'data-ids': g.items.map(p => p.id).join(',') },
          el('button', { class: 'sec-check', 'aria-label': 'Select section', onclick: e => { e.stopPropagation(); const ids = g.items.flatMap(idsFor); const all = ids.every(i => P.sel.has(i)); P.sel.setMany(ids, !all); } }, icon('check_circle')),
          el('div', { class: 'sec-t' }, el('h3', {}, P.fmt.heading(g.t, level)), places ? el('span', { class: 'sec-sub' }, places) : null));
        sec.appendChild(head);
      }
      const rowsEl = el('div', { class: 'rows' });
      for (const r of justify(g.items, W, target)) {
        const row = el('div', { class: 'row', style: { height: Math.round(r.h) + 'px' } });
        row._items = r.items; row._h = r.h;
        rowsEl.appendChild(row); obs.observe(row);
      }
      sec.appendChild(rowsEl); host.appendChild(sec);
      ctl.secs.push({ g, el: sec });
    }
    if (prevAnchor) requestAnimationFrame(() => { const t = host.querySelector(`.tile[data-id="${prevAnchor}"]`) || null; if (t) o.scroller.scrollTop += t.getBoundingClientRect().top - o.scroller.getBoundingClientRect().top - 80; });
    if (o.scrubber) buildScrubber();
    P.sel.update();
  }
  function firstVisible() {
    const t = [...host.querySelectorAll('.tile')].find(t => t.getBoundingClientRect().top > o.scroller.getBoundingClientRect().top + 60);
    return t?.dataset.id;
  }
  function topPlace(items) {
    const c = {}; items.forEach(p => { const k = p.loc?.place; if (k) c[k] = (c[k] || 0) + 1; });
    const k = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return k ? k[0] : '';
  }

  function fill(row) {
    if (row._filled) return; row._filled = true;
    const W2 = row.parentElement.clientWidth || W, sum = row._items.reduce((s, p) => s + AR(p), 0);
    const h = row._h, scale = row._h * sum + GAP * (row._items.length - 1) > W2 + 1 ? (W2 - GAP * (row._items.length - 1)) / (sum * h) : 1;
    for (const p of row._items) row.appendChild(tile(p, Math.floor(AR(p) * h * scale), h));
    P.sel.update();
  }
  function unfill(row) { if (!row._filled) return; row._filled = false; row.innerHTML = ''; }

  function tile(p, w, h) {
    const t = el('div', { class: 'tile' + (P.sel.has(p.id) ? ' sel' : ''), 'data-id': p.id, style: { width: w + 'px', height: h + 'px', backgroundColor: p.color || '#ddd' }, tabindex: 0, role: 'button', 'aria-label': `${p.kind === 'video' ? 'Video' : 'Photo'} ${P.fmt.dateLong(p.takenAt)}` });
    const img = el('img', { alt: '', draggable: false, decoding: 'async' });
    t.appendChild(img);
    P.thumbURL(p.id).then(u => { if (u) { img.src = u; img.onload = () => img.classList.add('in'); } });
    t.appendChild(el('div', { class: 'tile-shade' }));
    t.appendChild(el('button', { class: 'tile-check', 'aria-label': 'Select', onclick: e => { e.stopPropagation(); P.sel.toggle(p.id, { shift: e.shiftKey }); } }, icon('check')));
    const badges = el('div', { class: 'tile-badges' });
    if (p.kind === 'video') badges.appendChild(el('span', { class: 'bd' }, P.fmt.dur(p.duration), icon('play_circle', 'fill')));
    if (p.fav && o.showFav) badges.appendChild(el('span', { class: 'bd' }, icon('star', 'fill')));
    const st = o.collapseStacks && stackOf(p); if (st) badges.appendChild(el('span', { class: 'bd' }, String(st.length), icon('layers')));
    if (p.pano) badges.appendChild(el('span', { class: 'bd' }, icon('panorama')));
    if (badges.children.length) t.appendChild(badges);
    if (o.tileAction) { const a = o.tileAction(p); if (a) t.appendChild(a); }
    if (o.tileTitle) { const tt = o.tileTitle(p); if (tt) t.title = tt; }
    t.addEventListener('click', e => {
      if (P.sel.active || e.ctrlKey || e.metaKey) { P.sel.toggle(p.id, { shift: e.shiftKey }); return; }
      if (e.shiftKey && P.sel.S.last) { P.sel.toggle(p.id, { shift: true }); return; }
      const ids = []; for (const q of shown) idsFor(q).forEach(i => ids.push(i));
      P.viewer.open(ids, p.id, { ctx: o.ctx, ctxOpts: o.ctxOpts });
    });
    t.addEventListener('keydown', e => { if (e.key === 'Enter') t.click(); if (e.key === ' ') { e.preventDefault(); P.sel.toggle(p.id); } });
    t.addEventListener('contextmenu', e => { e.preventDefault(); if (!P.sel.has(p.id)) { P.sel.clear(); P.sel.toggle(p.id); } contextMenu(e.clientX, e.clientY); });
    // long-press select (touch)
    let lp, sx, sy;
    t.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; lp = setTimeout(() => { navigator.vibrate?.(15); P.sel.toggle(p.id); t._lp = true; }, 420); }, { passive: true });
    t.addEventListener('touchmove', e => { if (Math.abs(e.touches[0].clientX - sx) + Math.abs(e.touches[0].clientY - sy) > 10) clearTimeout(lp); }, { passive: true });
    t.addEventListener('touchend', e => { clearTimeout(lp); if (t._lp) { t._lp = false; e.preventDefault(); } });
    t.addEventListener('dragstart', e => e.preventDefault());
    return t;
  }

  function contextMenu(x, y) {
    const ids = P.sel.ids(), n = ids.length, c = o.ctx;
    const items = [];
    if (c === 'trash') items.push({ icon: 'restore_from_trash', label: 'Restore', onClick: async () => { await P.ops.restore(ids); P.sel.clear(); } }, { icon: 'delete_forever', label: 'Delete permanently', onClick: async () => { if (await P.ops.purge(ids)) P.sel.clear(); } });
    else {
      items.push({ icon: 'open_in_full', label: 'Open', onClick: () => P.viewer.open(P.sel.order(), ids[0], { ctx: c, ctxOpts: o.ctxOpts }) }, '-',
        { icon: 'share', label: 'Share', onClick: () => P.ops.share(ids) }, { icon: 'add', label: 'Add to album…', onClick: () => P.ops.addToAlbum(ids) },
        { icon: 'star', label: 'Favorite / unfavorite', kbd: 'Shift+F', onClick: () => P.ops.fav(ids) });
      if (n === 1) items.push({ icon: 'tune', label: 'Edit', kbd: 'E', onClick: () => P.editor.open(ids[0]) });
      items.push({ icon: 'archive', label: c === 'archive' ? 'Unarchive' : 'Archive', kbd: 'Shift+A', onClick: () => P.ops.archive(ids, c !== 'archive') },
        { icon: 'lock', label: 'Move to Locked Folder', onClick: () => P.ops.lock(ids) }, '-',
        { icon: 'download', label: 'Download', kbd: 'Shift+D', onClick: () => P.ops.download(ids) },
        { icon: 'delete', label: 'Move to trash', kbd: '#', onClick: () => P.ops.trash(ids) });
    }
    P.menu(x, y, items);
  }
  P.sel.order = () => { const o2 = []; for (const q of shown) idsFor(q).forEach(i => o2.push(i)); return o2; };

  /* ---------- scrubber ---------- */
  function buildScrubber() {
    scrub?.remove();
    if (o.flat || shown.length < 30 || innerWidth < 700) return;
    scrub = el('div', { class: 'scrub' });
    const bubble = el('div', { class: 'scrub-bubble hidden' }); scrub.appendChild(bubble);
    const marks = el('div', { class: 'scrub-marks' }); scrub.appendChild(marks); document.body.appendChild(scrub);
    const total = () => host.scrollHeight;
    const draw = () => {
      marks.innerHTML = ''; let lastLabel = '';
      const H = scrub.clientHeight, tot = total() || 1;
      ctl.secs.forEach(({ g, el: s }) => {
        const y = (s.offsetTop / tot) * H, y0 = new Date(g.t).getFullYear();
        const label = level === 'year' ? String(y0) : String(y0);
        if (label !== lastLabel) { marks.appendChild(el('span', { class: 'sm-year', style: { top: y + 'px' } }, label)); lastLabel = label; }
        else marks.appendChild(el('i', { class: 'sm-dot', style: { top: y + 'px' } }));
      });
    };
    requestAnimationFrame(draw);
    const secAt = frac => { const t = frac * total(); let hit = ctl.secs[0]; for (const s of ctl.secs) if (s.el.offsetTop <= t) hit = s; return hit; };
    let drag = false;
    const go = e => {
      const r = scrub.getBoundingClientRect(), f = P.clamp((e.clientY - r.top) / r.height, 0, 1);
      o.scroller.scrollTop = f * (o.scroller.scrollHeight - o.scroller.clientHeight);
      const s = secAt(f); bubble.textContent = P.fmt.monthYear(s.g.t); bubble.style.top = (e.clientY - r.top) + 'px'; bubble.classList.remove('hidden');
    };
    scrub.addEventListener('pointerdown', e => { drag = true; scrub.setPointerCapture(e.pointerId); go(e); });
    scrub.addEventListener('pointermove', e => { if (drag) go(e); else { const r = scrub.getBoundingClientRect(); const s = secAt(P.clamp((e.clientY - r.top) / r.height, 0, 1)); bubble.textContent = P.fmt.monthYear(s.g.t); bubble.style.top = (e.clientY - r.top) + 'px'; bubble.classList.remove('hidden'); } });
    scrub.addEventListener('pointerup', () => { drag = false; bubble.classList.add('hidden'); });
    scrub.addEventListener('pointerleave', () => { if (!drag) bubble.classList.add('hidden'); });
    const thumb = el('div', { class: 'scrub-thumb' }); scrub.appendChild(thumb);
    const pos = () => { const f = o.scroller.scrollTop / Math.max(1, o.scroller.scrollHeight - o.scroller.clientHeight); thumb.style.top = (f * (scrub.clientHeight - 6)) + 'px'; };
    o.scroller.addEventListener('scroll', pos, { passive: true }); pos();
    ctl._scrubDraw = draw;
    disposers.push(() => o.scroller.removeEventListener('scroll', pos));
  }

  /* ---------- zoom ---------- */
  function setLevel(l) {
    if (l === level || !LEVELS.includes(l)) return;
    level = l; P.setting('zoom', l); build(); P.emit('zoomed', l);
  }
  ctl.setLevel = setLevel; ctl.level = () => level;
  const zoomStep = dir => setLevel(LEVELS[P.clamp(LEVELS.indexOf(level) + dir, 0, 2)]);
  ctl.zoomStep = zoomStep;
  const wheel = e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); if (Math.abs(e.deltaY) < 4) return; if (!ctl._zt || Date.now() - ctl._zt > 250) { ctl._zt = Date.now(); zoomStep(e.deltaY > 0 ? -1 : 1); } };
  host.addEventListener('wheel', wheel, { passive: false });
  let pd0 = 0; const pts = new Map();
  host.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') { pts.set(e.pointerId, e); if (pts.size === 2) { const [a, b] = [...pts.values()]; pd0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); } } });
  host.addEventListener('pointermove', e => { if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return; pts.set(e.pointerId, e); if (pts.size === 2 && pd0) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (d / pd0 > 1.35) { zoomStep(1); pd0 = d; } else if (d / pd0 < .7) { zoomStep(-1); pd0 = d; } } });
  const pend = e => { pts.delete(e.pointerId); if (pts.size < 2) pd0 = 0; };
  host.addEventListener('pointerup', pend); host.addEventListener('pointercancel', pend);

  /* ---------- rubber-band selection (mouse) ---------- */
  let band = null, bx = 0, by = 0;
  host.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('.tile,.sec-check,button')) return;
    const sc = o.scroller, r0 = sc.getBoundingClientRect();
    bx = e.clientX; by = e.clientY + sc.scrollTop - r0.top;
    const base = new Set(P.sel.ids());
    let moved = false;
    const mv = ev => {
      if (!moved && Math.abs(ev.clientX - bx) + Math.abs(ev.clientY - (by - sc.scrollTop + r0.top)) < 6) return;
      moved = true;
      if (!band) { band = el('div', { class: 'band' }); document.body.appendChild(band); }
      const x1 = Math.min(bx, ev.clientX), x2 = Math.max(bx, ev.clientX);
      const y1 = Math.min(by, ev.clientY + sc.scrollTop - r0.top) - sc.scrollTop + r0.top, y2 = Math.max(by, ev.clientY + sc.scrollTop - r0.top) - sc.scrollTop + r0.top;
      Object.assign(band.style, { left: x1 + 'px', top: y1 + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
      const sel = new Set(base);
      host.querySelectorAll('.tile').forEach(t => { const b = t.getBoundingClientRect(); if (b.right > x1 && b.left < x2 && b.bottom > y1 && b.top < y2) sel.add(t.dataset.id); });
      P.sel.S.ids = sel; P.sel.update();
      if (ev.clientY > innerHeight - 60) sc.scrollTop += 18; else if (ev.clientY < r0.top + 40) sc.scrollTop -= 18;
    };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); band?.remove(); band = null; if (!moved && P.sel.active && !e.shiftKey) { /* click on blank space keeps selection */ } };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  });

  /* ---------- resize ---------- */
  ro = new ResizeObserver(P.debounce(() => { const w = host.clientWidth; if (w && Math.abs(w - lastW) > 8) build(); }, 160));
  ro.observe(host);

  function destroy() { obs?.disconnect(); ro?.disconnect(); scrub?.remove(); disposers.forEach(f => f()); band?.remove(); host.removeEventListener('wheel', wheel); }
  build();
  host._grid = ctl;
  (P._routeCleanup || []).push(destroy);
  return ctl;
}

P.grid = { render, LEVELS };
})();
