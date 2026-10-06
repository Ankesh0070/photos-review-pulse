/* App shell: router, nav, global shortcuts, bootstrap */
(() => {
const { $, el } = P;
const routes = {};
let gen = 0, running = false, again = false;
P._routeCleanup = [];

const parse = () => { const h = location.hash.slice(2) || 'photos'; const [name, ...params] = h.split('?')[0].split('/'); return { name, params }; };
async function render() {
  if (running) { again = true; return; } running = true;
  try {
    do {
      again = false; const my = ++gen, { name, params } = parse(), out = $('#outlet');
      P._routeCleanup.splice(0).forEach(f => { try { f(); } catch { } });
      const top = out.scrollTop, same = out._route === name && out._params === params.join('/');
      out.innerHTML = ''; out.scrollTop = 0;
      P.$$('.nav').forEach(n => n.classList.toggle('active', n.dataset.nav === name || (n.dataset.nav === 'photos' && !routes[name])));
      P.$$('#bottomnav a').forEach(n => n.classList.toggle('active', n.dataset.nav === name || (name === 'library' && n.dataset.nav === 'library')));
      document.title = (({ photos: 'Photos', explore: 'Explore', sharing: 'Sharing', albums: 'Albums', favorites: 'Favorites', archive: 'Archive', trash: 'Trash', utilities: 'Utilities', settings: 'Settings', map: 'Map' })[name] || 'Photos') + ' – Photos';
      P.sel.clear(); P.sel.setContext('library');
      if (name !== 'search') { /* keep the search input in sync only on search route */ }
      const fn = routes[name] || routes.photos;
      try { await fn(out, params); } catch (e) { console.error(e); out.innerHTML = ''; out.appendChild(el('div', { class: 'view' }, el('h2', {}, 'Something went wrong'), el('pre', { class: 'err' }, String(e.stack || e)))); }
      if (my !== gen) { /* superseded */ } else { out._route = name; out._params = params.join('/'); if (same && top) out.scrollTop = top; P.emit('route', { name, params }); }
    } while (again);
  } finally { running = false; }
}
const route = (n, f) => routes[n] = f;
P.router = { render, go: h => { if (location.hash === h) render(); else location.hash = h; }, parse };

function register() {
  route('photos', P.library.photos); route('explore', P.explore.index); route('sharing', P.sharing.index); route('favorites', P.library.favorites); route('albums', P.albums.index); route('album', P.albums.view);
  route('utilities', P.create.utilities); route('archive', P.library.archive); route('trash', P.library.trash); route('locked', P.library.locked); route('library', P.library.libraryHub);
  route('person', P.explore.person); route('place', P.explore.place); route('map', P.explore.mapView); route('thing', P.explore.thing); route('print', () => P.create.printStore());
  route('search', (out, params) => P.search.renderResults(out, params)); route('settings', P.settingsUI.view); route('s', P.sharing.sharedView);
  route('searches', (out, params) => P.memory.searchesPage(out, params)); route('tags', out => P.notes.page(out));
}

/* ---------- shell wiring ---------- */
function wire() {
  $('#btn-menu').onclick = () => { if (innerWidth <= 800) { document.body.classList.toggle('nav-open'); } else { document.body.classList.toggle('rail'); P.setting('rail', document.body.classList.contains('rail')); } };
  $('#scrim-nav').onclick = () => document.body.classList.remove('nav-open');
  $('#sidenav').addEventListener('click', e => { if (e.target.closest('a')) document.body.classList.remove('nav-open'); });
  $('#btn-settings').onclick = () => location.hash = '#/settings';
  $('#btn-help').onclick = P.settingsUI.shortcuts;
  $('#btn-account').onclick = P.settingsUI.accountSheet;
  $('#btn-storage').onclick = () => location.hash = '#/settings/storage';
  $('#fab').onclick = e => P.menuAt(e.currentTarget, [
    { icon: 'photo_library', label: 'Upload photos & videos', onClick: () => $('#file-input').click() }, { icon: 'photo_camera', label: 'Camera / scan', onClick: () => P.create.camera() }, '-',
    { icon: 'photo_album', label: 'New album', onClick: () => P.albums.createFlow([]) }, { icon: 'view_quilt', label: 'Collage', onClick: () => P.create.collage() }, { icon: 'movie', label: 'Movie', onClick: () => P.create.movie() }, { icon: 'search', label: 'Search', onClick: () => $('#search-input').focus() }]);
  $('#btn-create').onclick = e => P.menuAt(e.currentTarget, [
    { icon: 'photo_album', label: 'Album', onClick: () => P.albums.createFlow([]) }, { icon: 'group_add', label: 'Shared album', onClick: () => P.albums.createFlow([], true) },
    { icon: 'view_quilt', label: 'Collage', onClick: () => P.create.collage() }, { icon: 'gif_box', label: 'Animation', onClick: () => P.create.animation() }, { icon: 'movie', label: 'Movie', onClick: () => P.create.movie() }, { icon: 'photo_camera', label: 'Camera / scan', onClick: () => P.create.camera() }]);
  $('#outlet').addEventListener('scroll', P.throttle(() => $('#appbar').classList.toggle('scrolled', $('#outlet').scrollTop > 4), 100), { passive: true });
  // global keyboard
  let g = 0;
  document.addEventListener('keydown', e => {
    if (P.viewer.isOpen() || !$('#editor').classList.contains('hidden') || document.querySelector('#dialogs .dialog')) return;
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
    const k = e.key, m = e.ctrlKey || e.metaKey;
    if (k === '/') { e.preventDefault(); $('#search-input').focus(); }
    else if (m && k.toLowerCase() === 'a') { e.preventDefault(); P.sel.all(); }
    else if (k === 'Escape') { P.sel.clear(); }
    else if (k === '?') P.settingsUI.shortcuts();
    else if (k.toLowerCase() === 'g' && !e.shiftKey && !m) { g = Date.now(); }
    else if (Date.now() - g < 1200 && !m) { const t = { p: '#/photos', e: '#/explore', a: '#/albums', s: '#/sharing', f: '#/favorites', t: '#/trash' }[k.toLowerCase()]; if (t) { location.hash = t; g = 0; } }
    else if (P.sel.active) {
      const ids = P.sel.ids();
      if (k === 'Delete' || k === '#') { (P.sel.S.ctx === 'trash' ? P.ops.purge(ids) : P.ops.trash(ids)).then(() => P.sel.clear()); }
      else if (k === 'A' && e.shiftKey) P.ops.archive(ids, P.sel.S.ctx !== 'archive').then(() => P.sel.clear());
      else if (k === 'D' && e.shiftKey) P.ops.download(ids);
      else if (k === 'F' && e.shiftKey) P.ops.fav(ids).then(() => P.sel.clear());
    }
  });
  P.on('photos', P.debounce(() => { const { name } = parse(); if (['locked'].includes(name) && !P.lock) return; render(); P.refreshStorage(); }, 220));
  P.on('albums', P.debounce(() => { const n = parse().name; if (['albums', 'album', 'sharing', 'library'].includes(n)) render(); }, 220));
  P.on('setting', ({ key }) => { if (['memories', 'zoom', 'viewerFilmstrip', 'hiddenMemories', 'hiddenPeople'].includes(key)) { /* applied on next render */ } });
  addEventListener('hashchange', () => { if (P.viewer.isOpen()) P.viewer.close(true); render(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', P.settingsUI.applyTheme);
  addEventListener('online', () => P.toast('Back online')); addEventListener('offline', () => P.toast('You’re offline — everything still works'));
}

/* ---------- boot ---------- */
(async () => {
  await new Promise(r => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r) : r());
  try { await P.load(); } catch (e) { document.body.innerHTML = '<p style="padding:24px;font:16px sans-serif">Storage is unavailable (private mode?). Photos needs IndexedDB.</p>'; return; }
  P.settingsUI.applyTheme(); P.settingsUI.applyDensity(); P.settingsUI.avatar(); if (P.M.settings.rail) document.body.classList.add('rail');
  register(); wire();
  await P.autoPurge(); P.refreshStorage();
  if (!location.hash) location.hash = '#/photos';
  await render();
  // ?demo=1 (linked from the dashboard): an empty library gets the demo story library automatically, then the linked page is shown
  if (/[?&]demo=1\b/.test(location.search) && !P.M.photos.size) { try { await P.create.demo(); } catch (e) { console.warn('demo', e); } await render(); }
  navigator.storage?.persist?.().catch(() => { });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
  // resume background analysis for un-analysed photos
  if (P.M.settings.smart) setTimeout(() => P.ml.scanAll(), 3000);
  // memory search: colour features in the background, warm the index, optional on-device CLIP
  setTimeout(() => { P.features.backfill().then(() => P.memory.warm()); }, 1200);
  if (P.M.settings.clip) setTimeout(() => P.features.clip.load().then(ok => { if (ok) P.memory.startIndexing(); }), 2500);
  // shared-link / web share target
  const u = new URL(location.href); if (u.searchParams.get('url') || u.searchParams.get('text')) P.toast('Shared content received');
  if (!P.M.settings.onboarded && P.M.photos.size === 0) P.setting('onboarded', true);
})();
})();
