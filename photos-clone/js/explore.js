/* Explore: people & pets, places + map, things, creations */
(() => {
const { $, el, icon } = P;
const visible = () => P.list(p => P.live(p));
const personPhotos = id => { const s = new Set(P.M.faces.filter(f => f.personId === id).map(f => f.photoId)); return P.list(p => P.live(p) && s.has(p.id)); };
const hiddenPpl = () => new Set(P.M.settings.hiddenPeople || []);

function section(view, title, node, action) { view.appendChild(el('div', { class: 'sec-title' }, title, action || null)); view.appendChild(node); }
function tileCard(label, sub, id, ic, href, onclick) {
  const a = el(href ? 'a' : 'button', { class: 'xc', href, onclick }, el('div', { class: 'xc-img' }, ic ? icon(ic) : null), el('div', { class: 'xc-t' }, label), sub ? el('div', { class: 'xc-s' }, sub) : null);
  if (id) P.thumbURL(id).then(u => u && ((a.firstChild.style.backgroundImage = `url(${u})`), a.firstChild.classList.add('has')));
  return a;
}

async function index(out) {
  const view = el('div', { class: 'view' }); out.appendChild(view);
  view.appendChild(el('div', { class: 'view-head' }, el('h1', {}, 'Explore')));
  const photos = visible();
  // ---- People & pets
  const hid = hiddenPpl(), people = [...P.M.people.values()].filter(p => !hid.has(p.id)).map(p => ({ p, n: personPhotos(p.id).length })).filter(x => x.n).sort((a, b) => (b.p.name ? 1 : 0) - (a.p.name ? 1 : 0) || b.n - a.n);
  const pRow = el('div', { class: 'people' });
  people.slice(0, 30).forEach(({ p, n }) => pRow.appendChild(el('a', { class: 'pp', href: '#/person/' + p.id }, el('img', { src: p.avatar, alt: '' }), el('span', {}, p.name || 'Add name'), el('small', {}, String(n)))));
  if (!people.length) pRow.appendChild(el('div', { class: 'pp-empty' }, icon('face'), el('div', {}, el('b', {}, P.M.settings.smart ? 'No faces found yet' : 'Find people in your photos'), el('p', {}, P.M.settings.smart ? 'Face grouping runs in the background as photos are added.' : 'Turn on smart features to group faces by person. Analysis happens on this device.'),
    el('button', { class: 'btn-o', onclick: () => { if (!P.M.settings.smart) { P.setting('smart', true); } P.ml.scanAll(); } }, P.M.settings.smart ? 'Scan photos now' : 'Turn on & scan'))));
  section(view, 'People & pets', pRow, hid.size ? el('button', { class: 'btn-t', onclick: () => manageHidden() }, `${hid.size} hidden`) : null);
  // ---- Places
  const places = new Map(); photos.forEach(p => { const k = p.loc?.place; if (k) { if (!places.has(k)) places.set(k, []); places.get(k).push(p); } });
  const withLoc = photos.filter(p => p.loc), unnamed = withLoc.filter(p => !p.loc.place);
  const pl = el('div', { class: 'xgrid' });
  pl.appendChild(tileCard('Map view', P.pluralize(withLoc.length, 'geotagged photo'), withLoc[0]?.id, 'map', '#/map'));
  [...places].sort((a, b) => b[1].length - a[1].length).slice(0, 11).forEach(([n, arr]) => pl.appendChild(tileCard(n.split(',')[0], P.pluralize(arr.length, 'item'), arr[0].id, 'place', '#/place/' + encodeURIComponent(n))));
  section(view, 'Places', pl, unnamed.length ? el('button', { class: 'btn-t', onclick: async () => { if (!P.M.settings.geocode) { if (!(await P.confirm('Look up place names?', `Coordinates of ${unnamed.length} photos will be sent to OpenStreetMap Nominatim to get city names. Nothing else is shared.`, { ok: 'Look up' }))) return; P.setting('geocode', true); } P.ml.geocodeAll().then(() => P.router.render()); } }, `Name ${unnamed.length} places`) : null);
  // ---- Things
  const things = new Map(); photos.forEach(p => (p.labels || []).forEach(l => { if (/^[A-Z]/.test(l)) { if (!things.has(l)) things.set(l, []); things.get(l).push(p); } }));
  const types = [['Videos', 'videocam', p => p.kind === 'video'], ['Selfies', 'face_retouching_natural', p => p.selfie], ['Screenshots', 'screenshot', p => p.screenshot], ['Panoramas', 'panorama', p => p.pano], ['Documents', 'description', p => p.doc], ['Favorites', 'star', p => p.fav], ['Edited', 'tune', p => p.edited]];
  const tg = el('div', { class: 'xgrid' });
  types.forEach(([n, ic, f]) => { const arr = photos.filter(f); if (arr.length) tg.appendChild(tileCard(n, P.pluralize(arr.length, 'item'), arr[0].id, ic, '#/search/' + encodeURIComponent(n.toLowerCase()))); });
  [...things].sort((a, b) => b[1].length - a[1].length).forEach(([n, arr]) => tg.appendChild(tileCard(n, P.pluralize(arr.length, 'item'), arr[0].id, null, '#/search/' + encodeURIComponent(n.toLowerCase()))));
  if (!tg.children.length) tg.appendChild(el('p', { class: 'muted' }, 'Things like Food, Pets, Beaches and Cars appear here once smart features have analysed your photos.'));
  section(view, 'Things', tg, !P.M.settings.smart ? el('button', { class: 'btn-t', onclick: () => { P.setting('smart', true); P.ml.scanAll(); } }, 'Turn on smart labels') : null);
  // ---- My tags
  const myTags = P.notes.allTags();
  if (myTags.length) section(view, 'My tags', el('div', { class: 'chips' }, ...myTags.slice(0, 16).map(t => el('a', { class: 'chip', href: '#/search/' + encodeURIComponent('') + '/' + encodeURIComponent(JSON.stringify({ tag: t.name })) }, icon('sell', 'sm'), `${t.name} · ${t.count}`)), el('a', { class: 'chip', href: '#/tags' }, 'All tags')));
  // ---- Creations
  const cre = el('div', { class: 'xgrid' }); [['Collages', 'view_quilt', /^collage/i], ['Animations', 'gif_box', /^animation/i], ['Movies', 'movie', /^movie/i], ['Scans', 'document_scanner', /^scan/i]].forEach(([n, ic, re]) => { const arr = photos.filter(p => re.test(p.name)); if (arr.length) cre.appendChild(tileCard(n, P.pluralize(arr.length, 'item'), arr[0].id, ic, '#/search/' + encodeURIComponent(n.slice(0, -1).toLowerCase()))); });
  cre.appendChild(tileCard('Create collage', '', null, 'view_quilt', null, () => P.create.collage())); cre.appendChild(tileCard('Create movie', '', null, 'movie', null, () => P.create.movie())); cre.appendChild(tileCard('Create animation', '', null, 'gif_box', null, () => P.create.animation()));
  section(view, 'Creations', cre);
}

/* ---------- person ---------- */
async function person(out, [id]) {
  const per = P.M.people.get(id); if (!per) { location.hash = '#/explore'; return; }
  const list = personPhotos(id);
  const v = el('div', { class: 'view' }); out.appendChild(v);
  v.appendChild(el('div', { class: 'view-head' }, el('button', { class: 'ib', onclick: () => history.back() }, icon('arrow_back')), el('img', { class: 'ph-av', src: per.avatar, alt: '' }),
    el('h1', {}, per.name || 'Add a name'), el('div', { class: 'view-actions' },
      el('button', { class: 'btn-o', onclick: () => rename(per) }, icon('edit'), per.name ? ' Rename' : ' Add name'),
      el('button', { class: 'ib', onclick: e => P.menuAt(e.currentTarget, [
        { icon: 'merge', label: 'Merge with another person', onClick: () => merge(per) },
        { icon: 'pets', label: per.pet ? 'Not a pet' : 'Mark as pet', onClick: async () => { per.pet = !per.pet; await P.db.put('people', per); P.toast(per.pet ? 'Marked as pet' : 'Updated'); } },
        { icon: 'visibility_off', label: 'Hide this person', onClick: () => { P.setting('hiddenPeople', [...hiddenPpl(), id]); location.hash = '#/explore'; P.toast('Person hidden', { action: 'Undo', onAction: () => P.setting('hiddenPeople', [...hiddenPpl()].filter(x => x !== id)) }); } },
        { icon: 'photo_album', label: 'Create album from photos', onClick: async () => { const a = await P.albums.create(per.name || 'People', list.map(p => p.id)); location.hash = '#/album/' + a.id; } },
        '-', { icon: 'delete', label: 'Delete face group', onClick: async () => { if (await P.confirm('Delete this face group?', 'Photos are not deleted — only the grouping.', { ok: 'Delete', danger: true })) { const fs = P.M.faces.filter(f => f.personId === id); await P.db.bulkDel('faces', fs.map(f => f.id)); P.M.faces = P.M.faces.filter(f => f.personId !== id); await P.db.del('people', id); P.M.people.delete(id); location.hash = '#/explore'; } } },
      ]) }, icon('more_vert')))));
  P.sel.setContext('library');
  if (!list.length) { v.appendChild(P.search.emptyState('face', 'No photos', 'All photos of this person were removed.')); return; }
  const host = el('div', {}); v.appendChild(host); P.grid.render(host, list, { zoom: 'month' });
}
async function rename(per) {
  const n = await P.prompt(per.name ? 'Rename' : 'Who is this?', { value: per.name || '', placeholder: 'Name' }); if (n == null || !n) return;
  const dup = [...P.M.people.values()].find(p => p.id !== per.id && p.name?.toLowerCase() === n.toLowerCase());
  if (dup && await P.confirm('Merge faces?', `“${dup.name}” already exists. Merge these photos into that person?`, { ok: 'Merge' })) { await mergeInto(per, dup); return; }
  per.name = n; await P.db.put('people', per); P.emit('photos'); P.toast('Saved');
}
async function namePerson(face) { const per = face.personId && P.M.people.get(face.personId); if (per) return rename(per); }
async function merge(per) {
  const others = [...P.M.people.values()].filter(p => p.id !== per.id);
  const t = await P.pick('Merge with…', others.map(p => ({ value: p.id, label: p.name || 'Unnamed', thumb: p.avatar, sub: P.pluralize(personPhotos(p.id).length, 'photo') })), { search: others.length > 8 });
  if (t) await mergeInto(per, P.M.people.get(t));
}
async function mergeInto(from, to) {
  const fs = P.M.faces.filter(f => f.personId === from.id); fs.forEach(f => f.personId = to.id); await P.db.bulk('faces', fs); await P.db.del('people', from.id); P.M.people.delete(from.id); P.ml.resetCentroids();
  if (!to.name && from.name) { to.name = from.name; await P.db.put('people', to); } P.toast('Merged'); location.hash = '#/person/' + to.id; P.router.render();
}
async function manageHidden() {
  const hid = [...hiddenPpl()].map(i => P.M.people.get(i)).filter(Boolean); if (!hid.length) return;
  const w = el('div', { class: 'people wrap' }, ...hid.map(p => el('button', { class: 'pp', onclick: () => { P.setting('hiddenPeople', [...hiddenPpl()].filter(x => x !== p.id)); P.router.render(); $('#dialogs').lastElementChild?._close?.(null); } }, el('img', { src: p.avatar, alt: '' }), el('span', {}, p.name || 'Unnamed'), el('small', {}, 'Tap to unhide'))));
  P.dialog({ title: 'Hidden people', body: w, actions: [{ label: 'Done', value: null }] });
}

/* ---------- place & map ---------- */
async function place(out, [name]) {
  name = decodeURIComponent(name || ''); const list = P.list(p => P.live(p) && p.loc?.place === name);
  const v = el('div', { class: 'view' }); out.appendChild(v);
  v.appendChild(el('div', { class: 'view-head' }, el('button', { class: 'ib', onclick: () => history.back() }, icon('arrow_back')), el('h1', {}, name), el('div', { class: 'view-actions' }, el('button', { class: 'btn-o', onclick: () => location.hash = '#/map' }, icon('map'), ' Map'))));
  P.sel.setContext('library'); const host = el('div', {}); v.appendChild(host); P.grid.render(host, list, { zoom: 'month' });
}
let map;
async function mapView(out) {
  const v = el('div', { class: 'view mapview' }); out.appendChild(v);
  v.appendChild(el('div', { class: 'view-head' }, el('button', { class: 'ib', onclick: () => history.back() }, icon('arrow_back')), el('h1', {}, 'Map view')));
  const pts = P.list(p => P.live(p) && p.loc);
  if (!pts.length) { v.appendChild(P.search.emptyState('location_off', 'No geotagged photos', 'Photos taken with location on (or given a location via Edit location) appear on the map.')); return; }
  const box = el('div', { class: 'map' }); v.appendChild(box); const side = el('div', { class: 'map-grid hidden' }); v.appendChild(side);
  if (!window.L) { box.appendChild(el('p', { class: 'muted pad' }, 'The map library could not be loaded (offline?).')); return; }
  try { await P.loadScript('https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js'); document.head.appendChild(el('link', { rel: 'stylesheet', href: 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css' })); } catch { }
  await P.sleep(30);
  map = L.map(box, { zoomControl: true }); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  const layer = L.markerClusterGroup ? L.markerClusterGroup({ maxClusterRadius: 60 }) : L.layerGroup();
  const show = ps => { side.classList.remove('hidden'); side.innerHTML = ''; const h = el('div', {}); side.appendChild(h); P.sel.setContext('library'); P.grid.render(h, ps.sort((a, b) => b.takenAt - a.takenAt), { zoom: 'month', scrubber: false, scroller: side }); };
  const bounds = [];
  for (const p of pts) {
    const u = await P.thumbURL(p.id), m = L.marker([p.loc.lat, p.loc.lon], { icon: L.divIcon({ className: 'ph-pin', html: `<div style="background-image:url(${u})"></div>`, iconSize: [44, 44] }) });
    m._p = p; m.on('click', () => show([p])); layer.addLayer(m); bounds.push([p.loc.lat, p.loc.lon]);
  }
  layer.on?.('clusterclick', e => show(e.layer.getAllChildMarkers().map(m => m._p)));
  map.addLayer(layer); map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
  P._routeCleanup.push(() => { map?.remove(); map = null; });
}

function thing(out, [name]) { location.replace('#/search/' + name); }

P.explore = { index, person, place, mapView, thing, namePerson, rename };
})();
