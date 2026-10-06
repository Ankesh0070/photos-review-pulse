/* Library views: Photos timeline + memories, Favorites, Archive, Trash, Locked Folder, Library hub */
(() => {
const { $, el, icon } = P;
const empty = (ic, t, s, actions) => P.search.emptyState(ic, t, s, actions);

/* ---------- Locked Folder PIN ---------- */
const L = { authed: false, last: 0 };
async function ensure() {
  const s = P.M.settings;
  if (L.authed && Date.now() - L.last < (s.lockTimeoutMin || 5) * 60000) { L.last = Date.now(); return true; }
  L.authed = false;
  if (!s.lockPin) {
    const a = await pinDialog('Set up Locked Folder', 'Choose a PIN (4–8 digits). Items here are hidden from the timeline, search, albums and sharing.');
    if (!a) return false;
    const b = await pinDialog('Confirm PIN', 'Enter the same PIN again.');
    if (a !== b) { P.toast('PINs did not match'); return false; }
    P.setting('lockPin', await P.sha('photos-lock:' + a)); L.authed = true; L.last = Date.now(); P.toast('Locked Folder is ready'); return true;
  }
  for (let tries = 0; tries < 5; tries++) {
    const pin = await pinDialog('Enter PIN', tries ? `Wrong PIN — ${5 - tries} tries left` : 'Unlock your Locked Folder');
    if (pin == null) return false;
    if (await P.sha('photos-lock:' + pin) === s.lockPin) { L.authed = true; L.last = Date.now(); return true; }
  }
  P.toast('Too many wrong attempts'); return false;
}
function pinDialog(title, text) {
  const inp = el('input', { class: 'field pin', type: 'password', inputmode: 'numeric', maxlength: 8, autocomplete: 'off', placeholder: '••••' });
  const p = P.dialog({ title, body: el('div', {}, el('p', {}, text), inp), actions: [{ label: 'Cancel', value: null }, { label: 'OK', value: '__ok', primary: true }], width: '380px' });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.closest('.dialog-card').querySelector('.btn-p').click(); });
  return p.then(v => v === '__ok' ? (/^\d{4,8}$/.test(inp.value) ? inp.value : (P.toast('PIN must be 4–8 digits'), null)) : null);
}
const lock = () => { L.authed = false; };
P.on('route', ({ name }) => { if (name !== 'locked') lock(); });
P.lock = { ensure, lock, changePin: async () => { if (P.M.settings.lockPin && !(await ensure())) return; L.authed = false; P.setting('lockPin', ''); if (await ensure()) P.toast('PIN changed'); } };

/* ---------- generic photo list view ---------- */
function photoView(out, { title, list, ctx, emptyState, headExtra, ctxOpts, zoom = 'month', note, noHeadings }) {
  const view = el('div', { class: 'view' }); out.appendChild(view);
  const head = el('div', { class: 'view-head' }, el('h1', {}, title), el('div', { class: 'view-actions' }, ...(headExtra || [])));
  view.appendChild(head);
  if (note) view.appendChild(el('p', { class: 'note' }, icon('info'), note));
  P.sel.setContext(ctx || 'library', ctxOpts || {});
  if (!list.length) { view.appendChild(emptyState); return view; }
  const host = el('div', {}); view.appendChild(host);
  P.grid.render(host, list, { zoom, ctx: ctx || 'library', ctxOpts, showFav: ctx !== 'favorites', headings: !noHeadings });
  return view;
}

const favorites = out => photoView(out, { title: 'Favorites', list: P.list(p => P.live(p) && p.fav), ctx: 'favorites', emptyState: empty('star', 'No favorites yet', 'Tap the star on any photo to add it here.') });
const archive = out => photoView(out, { title: 'Archive', list: P.list(p => P.live(p) && p.archived), ctx: 'archive', note: 'Archived items are hidden from your main grid but remain in albums and search.', emptyState: empty('archive', 'Your archive is empty', 'Archive photos to hide them from the main grid without deleting them.') });
async function trash(out) {
  const days = P.M.settings.trashDays, list = P.list(p => p.trashedAt && !p.locked).sort((a, b) => b.trashedAt - a.trashedAt);
  return photoView(out, {
    title: 'Trash', list, ctx: 'trash', zoom: 'day', noHeadings: false,
    note: `Items are deleted forever after ${days} days. Their location and edit history are removed with them.`,
    headExtra: list.length ? [el('button', { class: 'btn-o', onclick: async () => { if (await P.confirm('Empty trash?', `${P.pluralize(list.length, 'item')} will be deleted forever.`, { ok: 'Empty trash', danger: true })) { await P.purge(list.map(p => p.id)); P.toast('Trash emptied'); } } }, 'Empty trash'),
      el('button', { class: 'btn-o', onclick: async () => { await P.untrash(list.map(p => p.id)); P.toast('All items restored'); } }, 'Restore all')] : [],
    emptyState: empty('delete', 'Trash is empty', `Items you delete will appear here for ${days} days.`),
  });
}
async function locked(out) {
  if (!(await ensure())) { location.hash = '#/photos'; return; }
  const list = P.list(p => !p.trashedAt && p.locked);
  return photoView(out, {
    title: 'Locked Folder', list, ctx: 'locked', note: 'Items here are hidden from the timeline, albums, search and memories. They stay on this device.',
    headExtra: [el('button', { class: 'btn-o', onclick: () => { lock(); location.hash = '#/photos'; } }, icon('lock'), ' Lock now')],
    emptyState: empty('lock', 'Locked Folder is empty', 'Move sensitive photos here from the viewer menu or selection bar.'),
  });
}
async function libraryHub(out) {
  const view = el('div', { class: 'view' }); out.appendChild(view);
  view.appendChild(el('div', { class: 'view-head' }, el('h1', {}, 'Library')));
  const tiles = el('div', { class: 'hub' });
  [['star', 'Favorites', '#/favorites'], ['sell', 'Tags', '#/tags'], ['saved_search', 'Searches', '#/searches'], ['archive', 'Archive', '#/archive'], ['delete', 'Trash', '#/trash'], ['lock', 'Locked Folder', '#/locked'], ['build', 'Utilities', '#/utilities'], ['local_printshop', 'Print store', '#/print'], ['settings', 'Settings', '#/settings']]
    .forEach(([ic, l, h]) => tiles.appendChild(el('a', { class: 'hub-i', href: h }, icon(ic), l)));
  view.appendChild(tiles);
  view.appendChild(el('div', { class: 'sec-title' }, 'Albums'));
  await P.albums.grid(view, { limit: 12 });
}

/* ---------- "Find photos the way you remember them": the four research-backed features, one tap each ---------- */
function solutionBanner() {
  const go = h => () => { location.hash = h; };
  const cards = [
    ['psychology', '1 · Describe what you remember', 'Type it like you’d say it. Partial memories still match, and each result says why.', '“pink dress at my friend’s wedding”', go('#/search/' + encodeURIComponent('pink dress at my friend’s wedding'))],
    ['forum', '2 · Let the assistant ask', 'Not found? It asks one smart question at a time: indoors or outdoors, who, when.', '“photos with Mom” → Help me find it', go('#/search/' + encodeURIComponent('photos with Mom'))],
    ['sell', '3 · Add your own words', 'Tags and memory notes like “Mom’s 60th birthday” become the strongest search signal.', 'Open My tags', go('#/tags')],
    ['bookmark', '4 · Pick up where you left off', 'Unfinished searches wait for you. Save a search and get alerts when new photos match.', 'Open Searches', go('#/searches')],
  ];
  const sec = el('section', { class: 'solution' },
    el('div', { class: 'sol-head' }, el('div', {}, el('h2', {}, 'Find photos the way you remember them'), el('p', {}, 'Built from what real users told us: they remember who and what occasion, not file names.')),
      el('button', { class: 'ib', title: 'Hide', 'aria-label': 'Hide', onclick: () => { P.setting('hideSolution', true); sec.remove(); } }, icon('close'))),
    el('div', { class: 'sol-grid' }, ...cards.map(([ic, t, d, tryIt, fn]) => el('button', { class: 'sol-card', onclick: fn }, el('span', { class: 'sol-ic' }, icon(ic)), el('b', {}, t), el('span', { class: 'sol-d' }, d), el('span', { class: 'sol-try' }, 'Try: ' + tryIt)))));
  return sec;
}

/* ---------- Photos (timeline) ---------- */
async function photos(out) {
  const view = el('div', { class: 'view timeline' }); out.appendChild(view);
  const list = P.list(P.inTimeline);
  P.sel.setContext('library');
  if (!list.length) {
    const hasAny = P.M.photos.size > 0;
    view.appendChild(empty(hasAny ? 'photo' : 'add_photo_alternate', hasAny ? 'Nothing to show' : 'Add your first photos', hasAny ? 'Everything is archived, trashed or in the Locked Folder.' : 'Drag photos and videos anywhere on this page, or choose them from your computer. Everything stays on this device.',
      hasAny ? null : el('div', { class: 'empty-actions' }, el('button', { class: 'btn-p', onclick: () => $('#file-input').click() }, icon('upload'), ' Upload photos'), el('button', { class: 'btn-o', onclick: () => $('#folder-input').click() }, icon('folder_open'), ' Upload a folder'), el('button', { class: 'btn-o', onclick: () => P.create.sample() }, icon('auto_awesome'), ' Add sample photos'), el('button', { class: 'btn-p', onclick: () => P.create.demo() }, icon('psychology'), ' Load demo story library'))));
    return;
  }
  if (!P.M.settings.hideSolution) view.appendChild(solutionBanner());
  const mem = P.M.settings.memories ? memoriesStrip() : null; if (mem) view.appendChild(mem);
  const bar = el('div', { class: 'zoombar' },
    el('div', { class: 'seg' }, ...['year', 'month', 'day'].map(l => el('button', { class: 'seg-b' + (P.M.settings.zoom === l ? ' on' : ''), 'data-l': l, onclick: () => { ctl.setLevel(l); P.$$('.seg-b', bar).forEach(b => b.classList.toggle('on', b.dataset.l === l)); } }, l[0].toUpperCase() + l.slice(1)))),
    el('span', { class: 'zoom-hint' }, `${P.pluralize(list.length, 'item')}`));
  view.appendChild(bar);
  const host = el('div', {}); view.appendChild(host);
  const ctl = P.grid.render(host, list, { zoom: P.M.settings.zoom, ctx: 'library' });
  const un = P.on('zoomed', l => P.$$('.seg-b', bar).forEach(b => b.classList.toggle('on', b.dataset.l === l))); P._routeCleanup.push(un);
}

/* ---------- Memories ---------- */
function buildMemories() {
  const all = P.list(p => P.live(p) && !p.archived && p.kind === 'image' || P.live(p) && p.kind === 'video' && !p.archived);
  if (all.length < 6) return [];
  const mems = [], now = new Date(), hidden = new Set(P.M.settings.hiddenMemories || []);
  const spread = (arr, n) => { if (arr.length <= n) return arr; const out = [], step = arr.length / n; for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]); return out; };
  const add = (id, title, sub, arr, n = 20) => { if (hidden.has(id) || !arr.length) return; const favs = arr.filter(p => p.fav), rest = arr.filter(p => !p.fav); const pick = spread([...favs, ...rest].sort((a, b) => a.takenAt - b.takenAt), n); mems.push({ id, title, sub, ids: pick.map(p => p.id), cover: (favs[0] || pick[Math.floor(pick.length / 2)]).id }); };
  // on this day
  for (let y = 1; y <= 20; y++) {
    const c = new Date(now.getFullYear() - y, now.getMonth(), now.getDate()).getTime();
    const near = all.filter(p => Math.abs(p.takenAt - c) < 2.5 * 86400000);
    if (near.length >= 2) add(`otd-${now.getFullYear() - y}-${now.getMonth()}-${now.getDate()}`, `${y} year${y > 1 ? 's' : ''} ago`, P.fmt.dateLong(c), near, 15);
  }
  // recent highlights
  const recent = all.filter(p => Date.now() - p.takenAt < 45 * 86400000);
  if (recent.length >= 8) add(`recent-${now.getFullYear()}-${now.getMonth()}`, 'Recent highlights', 'Your best moments lately', recent, 18);
  // best of past months
  const byMonth = new Map(); all.forEach(p => { const d = new Date(p.takenAt), k = d.getFullYear() * 12 + d.getMonth(); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(p); });
  [...byMonth].sort((a, b) => b[0] - a[0]).slice(0, 14).forEach(([k, arr]) => { if (k !== now.getFullYear() * 12 + now.getMonth() && arr.length >= 12) add(`month-${k}`, `Best of ${P.MONTHS[k % 12]}`, String(Math.floor(k / 12)), arr, 20); });
  // trips: runs of geotagged photos separated by < 2 days
  const geo = all.filter(p => p.loc).sort((a, b) => a.takenAt - b.takenAt); let run = [];
  const flush = () => { if (run.length >= 10 && run.at(-1).takenAt - run[0].takenAt > 86400000) { const pl = run.find(p => p.loc.place)?.loc.place; const d = new Date(run[0].takenAt); add(`trip-${run[0].id}`, pl ? `Trip to ${pl.split(',')[0]}` : `${P.MONTHS[d.getMonth()]} trip`, `${P.fmt.date(run[0].takenAt)} – ${P.fmt.date(run.at(-1).takenAt)}`, run, 24); } run = []; };
  geo.forEach(p => { if (run.length && p.takenAt - run.at(-1).takenAt > 2 * 86400000) flush(); run.push(p); }); flush();
  // people
  for (const per of P.M.people.values()) {
    if (!per.name || (P.M.settings.hiddenPeople || []).includes(per.id)) continue;
    const ids = new Set(P.M.faces.filter(f => f.personId === per.id).map(f => f.photoId)), arr = all.filter(p => ids.has(p.id));
    if (arr.length >= 10) add(`person-${per.id}-${now.getFullYear()}`, `${per.name} through the years`, 'People memory', arr, 20);
  }
  // favourites
  const fav = all.filter(p => p.fav); if (fav.length >= 8) add('fav-all', 'Your favorites', 'The photos you starred', fav, 24);
  return mems;
}
function memoriesStrip() {
  const mems = buildMemories(); if (!mems.length) return null;
  const wrap = el('div', { class: 'mem' });
  const row = el('div', { class: 'mem-row' });
  mems.slice(0, 16).forEach(m => {
    const c = el('button', { class: 'mem-c', onclick: () => story(m) }, el('div', { class: 'mem-t' }, el('b', {}, m.title), el('span', {}, m.sub)));
    P.thumbURL(m.cover).then(u => u && (c.style.backgroundImage = `url(${u})`)); row.appendChild(c);
  });
  wrap.appendChild(row);
  const mk = d => el('button', { class: 'mem-nav ' + (d < 0 ? 'l' : 'r'), 'aria-label': d < 0 ? 'Scroll left' : 'Scroll right', onclick: () => row.scrollBy({ left: d * 400, behavior: 'smooth' }) }, icon(d < 0 ? 'chevron_left' : 'chevron_right'));
  wrap.append(mk(-1), mk(1)); return wrap;
}
/* full-screen story */
function story(m) {
  const ids = m.ids.filter(i => P.M.photos.has(i)); if (!ids.length) return;
  const wrap = el('div', { class: 'story' }), bars = el('div', { class: 'st-bars' }), slide = el('div', { class: 'st-slide' });
  ids.forEach(() => bars.appendChild(el('i', {}, el('b', {}))));
  const title = el('div', { class: 'st-title' }, el('b', {}, m.title), el('span', {}, m.sub));
  let i = 0, t0 = 0, raf = 0, paused = false, elapsed = 0; const DUR = 4200;
  const close = () => { cancelAnimationFrame(raf); wrap.remove(); document.removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') go(i + 1); else if (e.key === 'ArrowLeft') go(i - 1); else if (e.key === ' ') { e.preventDefault(); toggle(); } };
  const top = el('div', { class: 'st-top' }, title, el('button', { class: 'ib lt', title: 'Pause', onclick: () => toggle() }, icon('pause')),
    el('button', { class: 'ib lt', title: 'More', onclick: e => P.menuAt(e.currentTarget, [
      { icon: 'movie', label: 'Save as movie', onClick: () => { close(); P.create.movie(ids); } },
      { icon: 'photo_album', label: 'Save to album', onClick: async () => { const a = await P.albums.create(m.title, ids); P.toast('Album created', { action: 'View', onAction: () => location.hash = '#/album/' + a.id }); } },
      { icon: 'visibility_off', label: 'Hide this memory', onClick: () => { P.setting('hiddenMemories', [...(P.M.settings.hiddenMemories || []), m.id]); close(); P.emit('photos'); P.toast('Memory hidden'); } }]) }, icon('more_vert')),
    el('button', { class: 'ib lt', onclick: close, title: 'Close' }, icon('close')));
  wrap.append(slide, bars, top, el('button', { class: 'st-z l', 'aria-label': 'Previous', onclick: () => go(i - 1) }), el('button', { class: 'st-z r', 'aria-label': 'Next', onclick: () => go(i + 1) }));
  document.body.appendChild(wrap); document.addEventListener('keydown', key);
  function toggle() { paused = !paused; $('.st-top .ib', wrap).firstChild.textContent = paused ? 'play_arrow' : 'pause'; if (!paused) { t0 = performance.now() - elapsed; loop(); } }
  async function go(n) {
    if (n >= ids.length) return close(); if (n < 0) n = 0; i = n; elapsed = 0; t0 = performance.now();
    const p = P.M.photos.get(ids[i]), u = await P.fullURL(ids[i]);
    const node = p.kind === 'video' ? el('video', { src: u, autoplay: true, muted: true, playsinline: true }) : el('img', { src: u });
    node.className = 'st-media k' + (i % 4);
    slide.innerHTML = ''; slide.appendChild(el('div', { class: 'st-bg', style: { backgroundImage: `url(${await P.thumbURL(ids[i])})` } }), node, el('div', { class: 'st-date' }, P.fmt.dateLong(p.takenAt)));
    [...bars.children].forEach((b, k) => b.firstChild.style.width = k < i ? '100%' : '0');
    cancelAnimationFrame(raf); if (!paused) loop();
  }
  function loop() { raf = requestAnimationFrame(() => { elapsed = performance.now() - t0; const f = Math.min(1, elapsed / DUR); bars.children[i].firstChild.style.width = f * 100 + '%'; if (f >= 1) go(i + 1); else if (!paused) loop(); }); }
  go(0);
}

P.library = { photos, favorites, archive, trash, locked, libraryHub, photoView, story, buildMemories };
})();
