/* Settings, storage manager, account sheet, backup/export/import, keyboard shortcut help */
(() => {
const { $, el, icon } = P;
const S = () => P.M.settings;

function row(title, sub, ctrl) { return el('div', { class: 'set-row' }, el('div', { class: 'sr-t' }, el('div', {}, title), sub ? el('small', {}, sub) : null), ctrl ? el('div', { class: 'sr-c' }, ctrl) : null); }
const toggle = (key, after) => { const s = el('button', { class: 'switch' + (S()[key] ? ' on' : ''), role: 'switch', 'aria-checked': !!S()[key], onclick: () => { const v = !S()[key]; P.setting(key, v); s.classList.toggle('on', v); s.setAttribute('aria-checked', v); after && after(v); } }); return s; };
const select = (key, opts, after) => { const s = el('select', { class: 'field sm', onchange: () => { const v = typeof opts[0][0] === 'number' ? +s.value : s.value; P.setting(key, v); after && after(v); } }, ...opts.map(([v, l]) => el('option', { value: v, selected: S()[key] === v }, l))); return s; };
const section = (t, ...rows) => el('div', { class: 'set-sec', id: 'set-' + t.toLowerCase().split(' ')[0] }, el('h2', {}, t), ...rows);

function applyTheme() { const t = S().theme; if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); document.querySelector('meta[name=theme-color]').content = (t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)) ? '#202124' : '#ffffff'; }
function applyDensity() { document.body.classList.toggle('compact', S().density === 'compact'); }

async function view(out, [focus]) {
  const v = el('div', { class: 'view narrow' }); out.appendChild(v);
  v.appendChild(el('div', { class: 'view-head' }, el('h1', {}, 'Settings')));
  const st = await P.storage();
  v.appendChild(section('Backup',
    row('Backup', 'Photos are saved in this browser’s private storage (IndexedDB). They never leave your device.', toggle('autoBackup')),
    row('Upload quality', 'Storage saver downsizes images above 16 MP on import', select('quality', [['original', 'Original quality'], ['saver', 'Storage saver']])),
    row('Export everything', 'Download all photos as a ZIP with a metadata JSON', el('button', { class: 'btn-o', onclick: exportAll }, 'Export')),
    row('Import', 'Add photos, folders or Google Takeout (with .json sidecars)', el('button', { class: 'btn-o', onclick: () => $('#folder-input').click() }, 'Choose folder'))));
  const pct = Math.min(100, st.usage / st.quota * 100);
  const storage = section('Storage',
    el('div', { class: 'set-row col' }, el('div', { class: 'storage big' }, el('div', { class: 'bar' }, el('i', { style: { width: Math.max(1, pct) + '%' } })), el('div', { class: 'storage-s' }, `${P.fmt.bytes(st.usage)} used of ${P.fmt.bytes(st.quota)} available to this browser`),
      el('div', { class: 'legend' }, ...usageParts().map(([l, n, c]) => el('span', {}, el('i', { style: { background: c } }), `${l} ${P.fmt.bytes(n)}`))))),
    row('Review suggestions', 'Duplicates, blurry photos, screenshots and large files', el('a', { class: 'btn-o', href: '#/utilities' }, 'Free up space')),
    row('Trash retention', 'Items in trash are deleted automatically', select('trashDays', [[7, '7 days'], [30, '30 days'], [60, '60 days']])));
  v.appendChild(storage);
  v.appendChild(section('Appearance',
    row('Theme', '', select('theme', [['auto', 'Device default'], ['light', 'Light'], ['dark', 'Dark']], applyTheme)),
    row('Grid density', 'Spacing between photos', select('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']], applyDensity)),
    row('Default grid zoom', '', select('zoom', [['day', 'Day'], ['month', 'Month'], ['year', 'Year']])),
    row('Filmstrip in viewer', '', toggle('viewerFilmstrip')),
    row('Slideshow speed', '', select('slideshowSec', [[2, '2 seconds'], [4, '4 seconds'], [6, '6 seconds'], [10, '10 seconds']]))));
  v.appendChild(section('Smart features',
    row('Smart analysis', 'Object labels (“Food”, “Pets”, “Beach”…) and face grouping. Runs in your browser; models are downloaded once from a CDN.', toggle('smart', on => on && P.ml.scanAll())),
    row('Group similar faces', '', toggle('faceGrouping')),
    row('Analyse existing photos now', `${P.M.photos.size} photos in library`, el('button', { class: 'btn-o', onclick: () => { P.setting('smart', true); P.ml.scanAll(); } }, 'Scan')),
    row('Place names', 'Look up city names for geotagged photos via OpenStreetMap Nominatim (sends coordinates)', toggle('geocode', on => on && P.ml.geocodeAll())),
    row('Text in photos (OCR)', 'Open a photo and tap “Copy text” to read it; results become searchable', null),
    row('Memories', 'Show memories at the top of Photos', toggle('memories')),
    row('Hidden memories', '', el('button', { class: 'btn-o', onclick: () => { P.setting('hiddenMemories', []); P.toast('Memories reset'); } }, 'Reset'))));
  const clipSt = P.features.clip.state(), clipP = P.features.clip.progress();
  v.appendChild(section('Search & memory',
    row('Interactive search assistant', 'When a search is vague or finds nothing, ask follow-up questions (indoors/outdoors, who was with you, trip or event…)', toggle('assistant')),
    row('On-device AI search', clipSt === 'ready' ? `Active · ${P.features.clip.count()} of ${P.M.photos.size} photos indexed${clipP.indexing ? ' (indexing…)' : ''}. Understands “pink dress at a wedding”.` : clipSt === 'loading' ? 'Downloading the AI model…' : clipSt === 'error' ? 'Could not load the model: ' + (P.features.clip.error() || 'offline?') : 'Understands descriptions like “pink dress at a wedding”. Downloads a ~90 MB model once; runs entirely in your browser.',
      S().clip && clipSt === 'ready' ? el('div', { class: 'row-in' }, el('button', { class: 'btn-o', onclick: () => { P.memory.startIndexing(); P.toast('Indexing photos in the background'); } }, 'Index now'), el('button', { class: 'btn-o', onclick: () => { P.features.clip.stopIndexing(); P.setting('clip', false); P.memory.invalidate(); P.router.render(); } }, 'Turn off')) : el('button', { class: 'btn-o', onclick: async () => { if (await P.memory.enableClip()) P.router.render(); } }, 'Turn on')),
    row('Saved-search alerts', 'Tell me when newly added photos match a saved search', toggle('searchAlerts')),
    row('Search history', `${P.M.searches.size} searches stored on this device`, el('div', { class: 'row-in' }, el('a', { class: 'btn-o', href: '#/searches' }, 'Manage'), el('button', { class: 'btn-o', onclick: async () => { if (await P.confirm('Clear search history?', 'Saved searches are kept.', { ok: 'Clear' })) { for (const r of [...P.M.searches.values()].filter(r => !r.saved)) await P.memory.history.remove(r.id); P.memory.paintBadge(); P.toast('History cleared'); P.router.render(); } } }, 'Clear')))));
  v.appendChild(section('Sharing',
    row('Remove location when sharing', 'Strips GPS info from photos shared as files', toggle('stripGeoOnShare')),
    row('Partner sharing', S().partner ? `Sharing with ${S().partner.email}` : 'Not set up', el('button', { class: 'btn-o', onclick: () => P.sharing.partner() }, S().partner ? 'Manage' : 'Set up'))));
  v.appendChild(section('Locked Folder',
    row('PIN', S().lockPin ? 'A PIN is set' : 'No PIN yet — you’ll create one the first time', el('button', { class: 'btn-o', onclick: () => P.lock.changePin() }, S().lockPin ? 'Change PIN' : 'Set up')),
    row('Lock after inactivity', '', select('lockTimeoutMin', [[1, '1 minute'], [5, '5 minutes'], [15, '15 minutes']]))));
  v.appendChild(section('Account',
    row('Name', '', el('input', { class: 'field sm', value: S().name, onchange: e => { P.setting('name', e.target.value || 'You'); avatar(); } })),
    row('Email', 'Used as your identity in shared albums', el('input', { class: 'field sm', type: 'email', value: S().email, onchange: e => P.setting('email', e.target.value) }))));
  v.appendChild(section('Data',
    row('Keyboard shortcuts', '', el('button', { class: 'btn-o', onclick: shortcuts }, 'View')),
    row('Install app', 'Use Photos as a standalone offline app', el('button', { class: 'btn-o', onclick: installApp }, 'Install')),
    row('Erase everything', 'Deletes all photos, albums, people and settings from this browser', el('button', { class: 'btn-o danger', onclick: eraseAll }, 'Erase all data')),
    row('About', 'Photos · local-first build', null)));
  if (focus === 'storage') setTimeout(() => $('#set-storage')?.scrollIntoView({ behavior: 'smooth' }), 60);
}
function usageParts() {
  let img = 0, vid = 0; for (const p of P.M.photos.values()) p.kind === 'video' ? vid += p.size : img += p.size;
  const trash = [...P.M.photos.values()].filter(p => p.trashedAt).reduce((s, p) => s + p.size, 0);
  return [['Photos', img, '#4285f4'], ['Videos', vid, '#ea4335'], ['In trash', trash, '#fbbc04']];
}
async function exportAll() {
  const ps = [...P.M.photos.values()]; if (!ps.length) return P.toast('Nothing to export');
  P.toast(`Building ZIP of ${ps.length} items…`, { ms: 20000 });
  await P.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  const z = new JSZip(), meta = [], used = new Set();
  for (const p of ps) { let n = p.name, k = 1; while (used.has(n)) n = p.name.replace(/(\.\w+)?$/, ` (${k++})$1`); used.add(n); z.file('Photos/' + n, await P.getBlob(p.id)); const { id, name, takenAt, desc, fav, archived, trashedAt, loc, cam } = p; meta.push({ title: name, description: desc, photoTakenTime: { timestamp: String(Math.round(takenAt / 1000)) }, geoData: loc ? { latitude: loc.lat, longitude: loc.lon } : undefined, favorited: !!fav, archived: !!archived, trashed: !!trashedAt, camera: cam }); }
  z.file('library.json', JSON.stringify({ photos: meta, albums: [...P.M.albums.values()].map(a => ({ name: a.name, description: a.desc, photos: P.albumItems(a.id).map(i => P.M.photos.get(i.photoId)?.name) })), people: [...P.M.people.values()].map(p => p.name) }, null, 2));
  P.download(await z.generateAsync({ type: 'blob', compression: 'STORE' }), `Photos-export-${new Date().toISOString().slice(0, 10)}.zip`);
}
async function eraseAll() {
  if (!(await P.confirm('Erase everything?', 'All photos, albums, faces and settings in this browser will be deleted permanently.', { ok: 'Erase all', danger: true }))) return;
  if (!(await P.confirm('Are you absolutely sure?', 'This cannot be undone. Export first if you want a copy.', { ok: 'Yes, erase', danger: true }))) return;
  await P.db.nuke(); localStorage.clear(); location.hash = '#/photos'; location.reload();
}
let deferredPrompt; addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
async function installApp() { if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; } else P.toast('Use your browser menu → “Install Photos” / “Add to Home screen”'); }

/* ---------- account sheet ---------- */
function avatar() { $('#avatar').textContent = (S().name || 'A')[0].toUpperCase(); }
function accountSheet() {
  const st = P.M.photos.size;
  const body = el('div', { class: 'acct' }, el('div', { class: 'acct-h' }, el('i', { class: 'avatar xl' }, (S().name || 'A')[0].toUpperCase()), el('div', {}, el('b', {}, S().name), el('span', {}, S().email))),
    el('div', { class: 'acct-s' }, `${P.pluralize(st, 'item')} · ${P.pluralize(P.M.albums.size, 'album')}`),
    el('div', { class: 'acct-l' }, ...[['settings', 'Photos settings', () => location.hash = '#/settings'], ['cleaning_services', 'Manage storage', () => location.hash = '#/settings/storage'], ['lock', 'Locked Folder', () => location.hash = '#/locked'], ['psychology', 'Load demo story library', () => P.create.demo()], ['download', 'Export library', exportAll], ['keyboard', 'Keyboard shortcuts', shortcuts], ['dark_mode', 'Toggle dark theme', () => { P.setting('theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); applyTheme(); }]]
      .map(([ic, t, fn]) => el('button', { class: 'acct-i', onclick: () => { $('#dialogs').lastElementChild?._close?.(null); fn(); } }, icon(ic), t))));
  P.dialog({ title: null, body, width: '400px', cls: 'acct-d', actions: [] });
}
function shortcuts() {
  const rows = [['Navigation', [['G then P', 'Photos'], ['G then E', 'Explore'], ['G then A', 'Albums'], ['/', 'Search'], ['?', 'This help']]], ['Photo grid', [['Ctrl/⌘ + A', 'Select all'], ['Shift + click', 'Select range'], ['Ctrl + scroll / pinch', 'Zoom day · month · year'], ['Esc', 'Clear selection'], ['Shift + A', 'Archive selection'], ['Shift + D', 'Download selection'], ['Shift + F', 'Favorite selection'], ['Delete or #', 'Move to trash']]],
    ['Viewer', [['← / → or J / K', 'Previous / next'], ['I', 'Info'], ['E', 'Edit'], ['S', 'Slideshow'], ['+ / − / 0', 'Zoom in / out / reset'], ['Space', 'Play / pause video'], ['Esc', 'Close']]], ['Editor', [['Ctrl + Z', 'Undo'], ['Ctrl + Shift + Z', 'Redo'], ['Ctrl + S', 'Save'], ['\\ (hold)', 'Compare with original']]]];
  const body = el('div', { class: 'kbd-help' }, ...rows.map(([t, items]) => el('div', {}, el('h3', {}, t), ...items.map(([k, d]) => el('div', { class: 'kr' }, el('kbd', {}, k), el('span', {}, d))))));
  P.dialog({ title: 'Keyboard shortcuts', body, width: '640px', actions: [{ label: 'Close', value: null }] });
}

P.refreshStorage = async () => { const s = await P.storage(), pct = Math.min(100, s.usage / s.quota * 100); const f = $('#storage-fill'); if (f) f.style.width = Math.max(1, pct) + '%'; $('#storage-text').textContent = `${P.fmt.bytes(s.usage)} of ${P.fmt.bytes(s.quota)} used`; };
P.settingsUI = { view, applyTheme, applyDensity, accountSheet, shortcuts, avatar, exportAll };
})();
