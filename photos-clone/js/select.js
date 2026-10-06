/* Selection manager + shared photo operations */
(() => {
const { $, el, icon } = P;
const S = { ids: new Set(), order: [], last: null, ctx: 'library', ctxOpts: {} };
const bar = () => $('#selbar');

function update() {
  const n = S.ids.size;
  bar().classList.toggle('hidden', n === 0);
  document.body.classList.toggle('selecting', n > 0);
  $('#sel-count').textContent = `${n} selected`;
  $$tiles().forEach(t => t.classList.toggle('sel', S.ids.has(t.dataset.id)));
  $$secs().forEach(s => { const ids = (s.dataset.ids || '').split(','); s.classList.toggle('all', ids.length && ids.every(i => S.ids.has(i))); });
  if (n) renderActions();
  P.emit('selection', n);
}
const $$tiles = () => P.$$('.tile[data-id]');
const $$secs = () => P.$$('.sec-head[data-ids]');

function toggle(id, { shift = false } = {}) {
  if (shift && S.last && S.order.length) {
    const a = S.order.indexOf(S.last), b = S.order.indexOf(id);
    if (a > -1 && b > -1) { const [s, e] = a < b ? [a, b] : [b, a]; for (let i = s; i <= e; i++) S.ids.add(S.order[i]); }
    else S.ids.add(id);
  } else S.ids.has(id) ? S.ids.delete(id) : S.ids.add(id);
  S.last = id; update();
}
function setMany(ids, on = true) { ids.forEach(i => on ? S.ids.add(i) : S.ids.delete(i)); update(); }
function clear() { S.ids.clear(); S.last = null; update(); }
function all() { S.order.forEach(i => S.ids.add(i)); update(); }
const ids = () => { const out = new Set(); for (const i of S.ids) { out.add(i); const p = P.M.photos.get(i), st = p && P.stackOf && P.stackOf(p); if (st) st.forEach(q => out.add(q.id)); } return [...out]; };
const photos = () => ids().map(i => P.M.photos.get(i)).filter(Boolean);
function setContext(ctx, opts = {}) { S.ctx = ctx; S.ctxOpts = opts; }
function setOrder(arr) { S.order = arr; }

/* ---------- operations ---------- */
const ops = {
  async fav(ids) { const ps = ids.map(i => P.M.photos.get(i)).filter(Boolean), on = ps.some(p => !p.fav); ps.forEach(p => p.fav = on); await P.savePhotos(ps); P.toast(on ? `Added ${ps.length} to Favorites` : `Removed ${ps.length} from Favorites`); },
  async archive(ids, on = true) {
    const ps = ids.map(i => P.M.photos.get(i)).filter(Boolean); ps.forEach(p => p.archived = on); await P.savePhotos(ps);
    P.toast(on ? `${P.pluralize(ps.length, 'item')} archived` : `${P.pluralize(ps.length, 'item')} unarchived`, { action: 'Undo', onAction: () => ops.archive(ids, !on) });
  },
  async trash(ids) {
    await P.trash(ids);
    P.toast(`${P.pluralize(ids.length, 'item')} moved to trash`, { action: 'Undo', onAction: async () => { await P.untrash(ids); } });
  },
  async restore(ids) { await P.untrash(ids); P.toast(`${P.pluralize(ids.length, 'item')} restored`); },
  async purge(ids) { if (await P.confirm('Delete permanently?', `${P.pluralize(ids.length, 'item')} will be deleted forever. This can't be undone.`, { ok: 'Delete', danger: true })) { await P.purge(ids); P.toast('Deleted permanently'); return true; } return false; },
  async lock(ids) { if (!(await P.lock.ensure())) return; const ps = ids.map(i => P.M.photos.get(i)).filter(Boolean); ps.forEach(p => { p.locked = true; p.archived = false; p.fav = false; }); await P.savePhotos(ps); P.toast(`${P.pluralize(ps.length, 'item')} moved to Locked Folder`, { action: 'Undo', onAction: () => ops.unlock(ids) }); },
  async unlock(ids) { const ps = ids.map(i => P.M.photos.get(i)).filter(Boolean); ps.forEach(p => p.locked = false); await P.savePhotos(ps); P.toast(`${P.pluralize(ps.length, 'item')} moved out of Locked Folder`); },
  async addToAlbum(ids) {
    const albums = [...P.M.albums.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    const choice = await P.pick('Add to', [{ value: '__new', label: 'New album', icon: 'add' }, { value: '__shared', label: 'New shared album', icon: 'group_add' },
      ...albums.map(a => ({ value: a.id, label: a.name, sub: P.pluralize(P.albumItems(a.id).length, 'item'), icon: 'photo_album' }))], { search: albums.length > 6 });
    if (!choice) return;
    if (choice === '__new' || choice === '__shared') return P.albums.createFlow(ids, choice === '__shared');
    const n = await P.addToAlbum(choice, ids);
    P.toast(n ? `Added ${P.pluralize(n, 'item')} to ${P.M.albums.get(choice).name}` : 'Already in album', { action: 'View', onAction: () => location.hash = '#/album/' + choice });
  },
  async download(ids) {
    const ps = ids.map(i => P.M.photos.get(i)).filter(Boolean);
    if (ps.length === 1) { const b = await P.getBlob(ps[0].id); return P.download(b, ps[0].name); }
    try {
      await P.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
      const z = new JSZip(), used = new Set();
      for (const p of ps) { let n = p.name || p.id, k = 1; while (used.has(n)) n = p.name.replace(/(\.\w+)?$/, ` (${k++})$1`); used.add(n); z.file(n, await P.getBlob(p.id)); }
      P.toast('Preparing download…');
      P.download(await z.generateAsync({ type: 'blob', compression: 'STORE' }), `Photos-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch { for (const p of ps) { P.download(await P.getBlob(p.id), p.name); await P.sleep(250); } }
  },
  async shareFiles(ids) {
    const ps = ids.map(i => P.M.photos.get(i)).filter(Boolean), files = [];
    for (const p of ps) {
      let b = await P.getBlob(p.id);
      if (P.M.settings.stripGeoOnShare && p.loc && p.kind === 'image' && /jpe?g/.test(b.type)) { try { const bmp = await createImageBitmap(b, { imageOrientation: 'from-image' }); const c = new OffscreenCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); b = await c.convertToBlob({ type: 'image/jpeg', quality: .95 }); } catch { } }
      files.push(new File([b], p.name || 'photo.jpg', { type: b.type }));
    }
    return files;
  },
  async share(ids) {
    const choice = await P.pick('Share', [
      { value: 'link', icon: 'link', label: 'Create link', sub: 'Anyone with the link on this device can view' },
      { value: 'album', icon: 'group_add', label: 'Share in a shared album', sub: 'Invite people, add comments & likes' },
      { value: 'device', icon: 'ios_share', label: 'Share to apps…', sub: 'Uses your device share sheet' },
      { value: 'email', icon: 'mail', label: 'Send by email' },
      { value: 'zip', icon: 'folder_zip', label: 'Download', sub: ids.length > 1 ? 'As a ZIP file' : 'Original file' },
    ]);
    if (!choice) return;
    if (choice === 'link') return P.sharing.createLink(ids);
    if (choice === 'album') return P.albums.createFlow(ids, true);
    if (choice === 'zip') return ops.download(ids);
    if (choice === 'email') { location.href = `mailto:?subject=${encodeURIComponent('Photos')}&body=${encodeURIComponent('I shared ' + ids.length + ' photo(s) with you from Photos.')}`; return; }
    const files = await ops.shareFiles(ids);
    if (navigator.canShare?.({ files })) { try { await navigator.share({ files, title: 'Photos' }); } catch { } }
    else { P.toast('Sharing to apps is not supported in this browser — downloading instead'); ops.download(ids); }
  },
  async editDate(ids) {
    const ps = ids.map(i => P.M.photos.get(i)).filter(Boolean), t = new Date(ps[0].takenAt);
    const loc = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const inp = el('input', { type: 'datetime-local', class: 'field', value: loc(t) });
    const shift = el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: true }), ' Keep time differences between selected items');
    const body = el('div', {}, inp, ps.length > 1 ? shift : null);
    const r = await P.dialog({ title: 'Edit date & time', body, actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'ok', primary: true }] });
    if (r !== 'ok' || !inp.value) return;
    const nt = new Date(inp.value).getTime(), keep = shift.querySelector('input').checked, base = Math.min(...ps.map(p => p.takenAt));
    ps.forEach(p => p.takenAt = keep ? nt + (p.takenAt - base) : nt);
    await P.savePhotos(ps); P.toast('Date & time updated');
  },
  async editLocation(ids) {
    const ps = ids.map(i => P.M.photos.get(i)).filter(Boolean);
    const q = await P.prompt('Add location', { placeholder: 'Search a place, or enter "lat, lon"', hint: 'Place search uses OpenStreetMap Nominatim. Enter clear to remove location.' });
    if (q == null) return;
    if (/^clear$/i.test(q)) { ps.forEach(p => p.loc = null); await P.savePhotos(ps); return P.toast('Location removed'); }
    let loc = null; const m = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
    if (m) loc = { lat: +m[1], lon: +m[2], place: null };
    else { try { const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`)).json(); if (r[0]) loc = { lat: +r[0].lat, lon: +r[0].lon, place: r[0].display_name.split(',').slice(0, 2).join(',').trim() }; } catch { } }
    if (!loc) return P.toast('Could not find that place');
    ps.forEach(p => p.loc = { ...loc }); await P.savePhotos(ps); P.toast(`Location set${loc.place ? ' to ' + loc.place : ''}`);
  },
  async rename(id) { const p = P.M.photos.get(id); const n = await P.prompt('Rename', { value: p.name }); if (n) { p.name = n; await P.savePhoto(p); } },
  async copy(id) { try { let b = await P.getBlob(id); if (b.type !== 'image/png') { const bmp = await createImageBitmap(b); const c = new OffscreenCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); b = await c.convertToBlob({ type: 'image/png' }); } await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); P.toast('Image copied'); } catch { P.toast('Copy failed'); } },
  async print(id) { const u = await P.fullURL(id); const w = open('', '_blank'); if (!w) return P.toast('Allow pop-ups to print'); w.document.write(`<html><body style="margin:0"><img src="${u}" style="max-width:100%" onload="print()"></body></html>`); w.document.close(); },
  async stack(ids) { const id = P.uid(); const ps = ids.map(i => P.M.photos.get(i)); ps.forEach(p => p.stackId = id); await P.savePhotos(ps); P.toast('Stack created'); },
  async unstack(ids) { const ps = ids.map(i => P.M.photos.get(i)); ps.forEach(p => delete p.stackId); await P.savePhotos(ps); },
};

/* ---------- selection bar ---------- */
function renderActions() {
  const box = $('#sel-actions'); box.innerHTML = '';
  const n = S.ids.size, sel = ids();
  const btn = (ic, title, fn) => box.appendChild(el('button', { class: 'ib', title, 'aria-label': title, onclick: fn }, icon(ic)));
  const done = () => clear();
  const c = S.ctx;
  if (c === 'trash') {
    btn('restore_from_trash', 'Restore', async () => { await ops.restore(sel); done(); });
    btn('delete_forever', 'Delete permanently', async () => { if (await ops.purge(sel)) done(); });
    return;
  }
  btn('share', 'Share', () => ops.share(sel));
  btn('add', 'Add to…', () => ops.addToAlbum(sel).then(done));
  if (c === 'locked') btn('lock_open', 'Move out of Locked Folder', async () => { await ops.unlock(sel); done(); });
  else {
    btn('star', 'Favorite', async () => { await ops.fav(sel); done(); });
    btn('archive', c === 'archive' ? 'Unarchive' : 'Archive', async () => { await ops.archive(sel, c !== 'archive'); done(); });
    btn('delete', 'Move to trash', async () => { await ops.trash(sel); done(); });
  }
  btn('download', 'Download', () => ops.download(sel));
  box.appendChild(el('button', { class: 'ib', title: 'More', onclick: e => moreMenu(e.currentTarget, sel, n) }, icon('more_vert')));
}
function moreMenu(anchor, sel, n) {
  const items = [];
  if (S.ctx === 'album') items.push({ icon: 'remove_circle_outline', label: 'Remove from album', onClick: async () => { await P.removeFromAlbum(S.ctxOpts.albumId, sel); P.toast('Removed from album'); clear(); } },
    n === 1 ? { icon: 'image', label: 'Set as album cover', onClick: async () => { const a = P.M.albums.get(S.ctxOpts.albumId); a.cover = sel[0]; await P.saveAlbum(a); P.toast('Album cover updated'); clear(); } } : null, '-');
  if (S.ctx !== 'locked') items.push({ icon: 'lock', label: 'Move to Locked Folder', onClick: async () => { await ops.lock(sel); clear(); } });
  items.push({ icon: 'sell', label: 'Add tags…', onClick: () => P.notes.tagDialog(sel) }, n === 1 ? { icon: 'edit_note', label: 'Memory note', onClick: () => P.viewer.open([sel[0]], sel[0], { info: true }) } : null,
    { icon: 'edit_calendar', label: 'Edit date & time', onClick: () => ops.editDate(sel) }, { icon: 'location_on', label: 'Edit location', onClick: () => ops.editLocation(sel) }, '-');
  if (n >= 2) items.push({ icon: 'view_quilt', label: 'Create collage', onClick: () => P.create.collage(sel) }, { icon: 'gif_box', label: 'Create animation', onClick: () => P.create.animation(sel) }, { icon: 'movie', label: 'Create movie', onClick: () => P.create.movie(sel) }, { icon: 'layers', label: 'Stack together', onClick: async () => { await ops.stack(sel); clear(); } }, '-');
  if (n === 1) items.push({ icon: 'tune', label: 'Edit', onClick: () => P.editor.open(sel[0]) }, { icon: 'info', label: 'Info', onClick: () => P.viewer.open([sel[0]], sel[0], { info: true }) });
  items.push({ icon: 'select_all', label: 'Select all', kbd: 'Ctrl+A', onClick: all });
  P.menuAt(anchor, items);
}
document.addEventListener('DOMContentLoaded', () => { $('#sel-close').onclick = clear; });
P.on('photos', () => { let ch = false; for (const i of [...S.ids]) { const p = P.M.photos.get(i); if (!p) { S.ids.delete(i); ch = true; } } if (ch) update(); });

P.sel = { S, toggle, setMany, clear, all, ids, photos, setContext, setOrder, update, has: i => S.ids.has(i), get active() { return S.ids.size > 0; } };
P.ops = ops;
})();
