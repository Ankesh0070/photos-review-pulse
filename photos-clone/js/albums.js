/* Albums: index, album view, create flow, photo picker */
(() => {
const { $, el, icon } = P;

async function create(name, ids = [], shared = false) {
  const a = { id: P.uid(), name: name || 'Untitled', desc: '', createdAt: Date.now(), updatedAt: Date.now(), cover: null, sort: 'new', shared: !!shared, members: shared ? [] : undefined, comments: [], likes: {} };
  await P.saveAlbum(a); if (ids.length) await P.addToAlbum(a.id, ids); return a;
}
async function createFlow(ids = [], shared = false) {
  const name = await P.prompt(shared ? 'New shared album' : 'New album', { placeholder: 'Add a title', value: '', ok: 'Create' });
  if (name == null) return null;
  const a = await create(name || 'Untitled', ids, shared);
  P.toast(`${shared ? 'Shared album' : 'Album'} created`, { action: 'Open', onAction: () => location.hash = '#/album/' + a.id });
  if (shared) P.sharing.invite(a.id);
  return a;
}
const coverOf = a => { const ph = P.albumPhotos(a.id); return ph.find(p => p.id === a.cover) || ph[0] || null; };

async function grid(container, { limit = 0, shared = null } = {}) {
  let albums = [...P.M.albums.values()]; if (shared != null) albums = albums.filter(a => !!a.shared === shared);
  albums.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); if (limit) albums = albums.slice(0, limit);
  const g = el('div', { class: 'cards' });
  if (!limit) g.appendChild(el('button', { class: 'card new', onclick: () => createFlow([]) }, el('div', { class: 'card-img' }, icon('add')), el('div', { class: 'card-t' }, 'New album')));
  for (const a of albums) {
    const ph = P.albumPhotos(a.id), cv = ph.find(p => p.id === a.cover) || ph[0];
    const img = el('div', { class: 'card-img' }, cv ? null : icon('photo_album'));
    if (cv) P.thumbURL(cv.id).then(u => u && (img.style.backgroundImage = `url(${u})`));
    g.appendChild(el('a', { class: 'card', href: '#/album/' + a.id }, img, el('div', { class: 'card-t' }, a.name, a.shared ? icon('group', 'sm') : null), el('div', { class: 'card-s' }, P.pluralize(ph.length, 'item'))));
  }
  container.appendChild(g); return g;
}

async function index(out) {
  const view = el('div', { class: 'view' }); out.appendChild(view);
  view.appendChild(el('div', { class: 'view-head' }, el('h1', {}, 'Albums'), el('div', { class: 'view-actions' }, el('button', { class: 'btn-o', onclick: () => createFlow([]) }, icon('add'), ' New album'))));
  if (![...P.M.albums.values()].length) {
    view.appendChild(P.search.emptyState('photo_album', 'No albums yet', 'Group photos into albums to organise trips, events and people.', el('button', { class: 'btn-p', onclick: () => createFlow([]) }, 'Create album')));
  } else await grid(view);
  // quick links like the real app: People, Places, Things, Utilities
}

async function view(out, [id]) {
  const a = P.M.albums.get(id); if (!a) { location.hash = '#/albums'; return; }
  let list = P.albumPhotos(id); if (a.sort === 'old') list = [...list].reverse();
  const v = el('div', { class: 'view' }); out.appendChild(v);
  const range = list.length ? (P.fmt.date(Math.min(...list.map(p => p.takenAt))) + (list.length > 1 ? ' – ' + P.fmt.date(Math.max(...list.map(p => p.takenAt))) : '')) : '';
  v.appendChild(el('div', { class: 'album-head' },
    el('button', { class: 'ib', onclick: () => history.length > 1 ? history.back() : location.hash = '#/albums', 'aria-label': 'Back' }, icon('arrow_back')),
    el('div', { class: 'ah-t' }, el('h1', { contenteditable: 'plaintext-only', spellcheck: 'false', onblur: async e => { const n = e.target.textContent.trim(); if (n && n !== a.name) { a.name = n; a.updatedAt = Date.now(); await P.saveAlbum(a); } else e.target.textContent = a.name; }, onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } } }, a.name),
      el('div', { class: 'ah-s' }, `${P.pluralize(list.length, 'item')}${range ? ' · ' + range : ''}`, a.shared ? el('span', { class: 'badge' }, icon('group', 'sm'), ' Shared') : null)),
    el('div', { class: 'view-actions' },
      el('button', { class: 'btn-o', onclick: () => addPhotos(a.id) }, icon('add_photo_alternate'), ' Add photos'),
      el('button', { class: 'ib', title: 'Share', onclick: () => a.shared ? P.sharing.invite(a.id) : P.sharing.albumShare(a.id) }, icon(a.shared ? 'person_add' : 'share')),
      el('button', { class: 'ib', title: 'Slideshow', disabled: !list.length, onclick: () => list.length && (P.viewer.open(list.map(p => p.id), list[0].id, { ctx: 'album', ctxOpts: { albumId: id } }), setTimeout(() => $('#v-actions button[title=Slideshow]')?.click(), 400)) }, icon('slideshow')),
      el('button', { class: 'ib', title: 'More', onclick: e => P.menuAt(e.currentTarget, [
        { icon: 'edit', label: 'Edit title', onClick: () => $('.ah-t h1').focus() },
        { icon: 'notes', label: a.desc ? 'Edit description' : 'Add description', onClick: async () => { const d = await P.prompt('Description', { value: a.desc || '', multiline: true }); if (d != null) { a.desc = d; await P.saveAlbum(a); P.router.render(); } } },
        { icon: 'swap_vert', label: a.sort === 'old' ? 'Sort: newest first' : 'Sort: oldest first', onClick: async () => { a.sort = a.sort === 'old' ? 'new' : 'old'; await P.saveAlbum(a); P.router.render(); } },
        { icon: 'download', label: 'Download all', onClick: () => P.ops.download(list.map(p => p.id)) },
        { icon: 'content_copy', label: 'Duplicate album', onClick: async () => { const c = await create(a.name + ' (copy)', list.map(p => p.id)); P.toast('Album duplicated', { action: 'Open', onAction: () => location.hash = '#/album/' + c.id }); } },
        { icon: 'movie', label: 'Create movie', onClick: () => list.length && P.create.movie(list.map(p => p.id)) },
        '-', { icon: 'delete', label: 'Delete album', onClick: async () => { if (await P.confirm('Delete album?', 'Photos stay in your library. This album and its shared link will be removed.', { ok: 'Delete', danger: true })) { await P.deleteAlbum(id); location.hash = '#/albums'; P.toast('Album deleted'); } } },
      ]) }, icon('more_vert')))));
  if (a.desc) v.appendChild(el('p', { class: 'album-desc' }, a.desc));
  if (a.shared) v.appendChild(P.sharing.panel(a));
  P.sel.setContext('album', { albumId: id });
  if (!list.length) { v.appendChild(P.search.emptyState('add_photo_alternate', 'Add photos to this album', 'Pick from your library to fill this album.', el('button', { class: 'btn-p', onclick: () => addPhotos(id) }, 'Add photos'))); return; }
  const host = el('div', {}); v.appendChild(host);
  P.grid.render(host, list, { zoom: 'month', ctx: 'album', ctxOpts: { albumId: id }, scrubber: false });
}
async function addPhotos(albumId) {
  const have = new Set(P.albumItems(albumId).map(i => i.photoId));
  const ids = await photosPicker({ title: 'Add photos', exclude: have, ok: 'Add' });
  if (ids?.length) { await P.addToAlbum(albumId, ids); P.toast(`Added ${P.pluralize(ids.length, 'item')}`); }
}

/* ---------- reusable photo picker ---------- */
function photosPicker({ title = 'Select photos', max = 0, exclude = new Set(), ok = 'Done', filter = p => P.inTimeline(p), kind } = {}) {
  return new Promise(res => {
    const list = P.list(p => filter(p) && !exclude.has(p.id) && (!kind || p.kind === kind)), sel = new Set();
    const wrap = el('div', { class: 'dialog pickerw' });
    const count = el('span', { class: 'pk-count' }, '0 selected'), btn = el('button', { class: 'btn-p', disabled: true, onclick: () => done(true) }, ok);
    const grid = el('div', { class: 'pk-grid' });
    const obs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { const t = e.target; obs.unobserve(t); P.thumbURL(t.dataset.id).then(u => u && (t.style.backgroundImage = `url(${u})`)); } }), { root: grid, rootMargin: '300px' });
    let last = null;
    list.forEach(p => {
      const t = el('button', { class: 'pk-t', 'data-id': p.id, title: P.fmt.dateLong(p.takenAt), onclick: e => {
        if (e.shiftKey && last) { const a = list.findIndex(x => x.id === last), b = list.findIndex(x => x.id === p.id); for (let i = Math.min(a, b); i <= Math.max(a, b); i++) { sel.add(list[i].id); grid.children[i].classList.add('on'); } }
        else if (sel.has(p.id)) { sel.delete(p.id); t.classList.remove('on'); } else { if (max && sel.size >= max) return P.toast(`You can select up to ${max}`); sel.add(p.id); t.classList.add('on'); }
        last = p.id; count.textContent = `${sel.size} selected`; btn.disabled = !sel.size;
      } }, icon('check'), p.kind === 'video' ? el('i', { class: 'pk-d' }, P.fmt.dur(p.duration)) : null);
      grid.appendChild(t); obs.observe(t);
    });
    const done = ok_ => { document.removeEventListener('keydown', key, true); wrap.remove(); res(ok_ ? list.filter(p => sel.has(p.id)).sort((a, b) => a.takenAt - b.takenAt).map(p => p.id) : null); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } }; document.addEventListener('keydown', key, true);
    const card = el('div', { class: 'dialog-card wide' }, el('div', { class: 'pk-h' }, el('button', { class: 'ib', onclick: () => done(false) }, icon('close')), el('h2', {}, title), count, el('div', { style: { flex: 1 } }),
      el('button', { class: 'btn-t', onclick: () => { list.slice(0, max || 1e9).forEach((p, i) => { sel.add(p.id); grid.children[i].classList.add('on'); }); count.textContent = `${sel.size} selected`; btn.disabled = !sel.size; } }, 'Select all'), btn),
      list.length ? grid : el('div', { class: 'empty' }, icon('photo'), el('p', {}, 'No photos available.')));
    wrap.appendChild(card); $('#dialogs').appendChild(wrap);
  });
}

P.albums = { create, createFlow, grid, index, view, addPhotos, coverOf };
P.picker = { photos: photosPicker };
})();
