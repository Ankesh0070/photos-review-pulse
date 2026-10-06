/* IndexedDB layer + in-memory model. All metadata is cached in memory for instant filtering. */
(() => {
const NAME = 'photos-clone-v1', VER = 2;
const STORES = ['photos', 'blobs', 'thumbs', 'albums', 'albumItems', 'people', 'faces', 'shares', 'settings', 'misc', 'searches', 'features', 'embeddings'];
let dbp;
function open() {
  if (dbp) return dbp;
  return dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VER);
    r.onupgradeneeded = () => { const db = r.result; STORES.forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'settings' ? 'key' : 'id' }); }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function st(store, mode = 'readonly') { return (await open()).transaction(store, mode).objectStore(store); }
const db = {
  open,
  async get(s, k) { return req((await st(s)).get(k)); },
  async put(s, v) { return req((await st(s, 'readwrite')).put(v)); },
  async del(s, k) { return req((await st(s, 'readwrite')).delete(k)); },
  async all(s) { return req((await st(s)).getAll()); },
  async clear(s) { return req((await st(s, 'readwrite')).clear()); },
  async bulk(s, arr) { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(s, 'readwrite'), o = t.objectStore(s); arr.forEach(v => o.put(v)); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  async bulkDel(s, keys) { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(s, 'readwrite'), o = t.objectStore(s); keys.forEach(k => o.delete(k)); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  async nuke() { const d = await open(); d.close(); dbp = null; await new Promise(r => { const q = indexedDB.deleteDatabase(NAME); q.onsuccess = q.onerror = q.onblocked = r; }); },
};

/* ---------- in-memory model ---------- */
const M = P.M = {
  photos: new Map(), albums: new Map(), items: [], people: new Map(), faces: [], shares: new Map(),
  settings: {}, searches: new Map(),
};
const DEFAULTS = {
  theme: 'auto', density: 'comfortable', zoom: 'day', name: 'You', email: 'you@example.com',
  quality: 'original', memories: true, smart: false, geocode: false, stripGeoOnShare: true,
  slideshowSec: 4, trashDays: 60, lockPin: '', lockTimeoutMin: 5, partner: null, faceGrouping: true,
  hiddenPeople: [], searchHistory: [], onboarded: false, autoBackup: true, notifications: true,
  showCaptions: false, mapStyle: 'osm', viewerFilmstrip: true, pinned: [], clip: false, searchAlerts: true, assistant: true,
};
async function load() {
  const [ph, al, it, pe, fa, sh, se, sr] = await Promise.all(['photos', 'albums', 'albumItems', 'people', 'faces', 'shares', 'settings', 'searches'].map(s => db.all(s)));
  ph.forEach(p => M.photos.set(p.id, p)); al.forEach(a => M.albums.set(a.id, a)); M.items = it;
  pe.forEach(p => M.people.set(p.id, p)); M.faces = fa; sh.forEach(s => M.shares.set(s.id, s)); sr.forEach(s => M.searches.set(s.id, s));
  M.settings = { ...DEFAULTS }; se.forEach(r => M.settings[r.key] = r.value);
}
const setting = (k, v) => { M.settings[k] = v; db.put('settings', { key: k, value: v }); P.emit('setting', { key: k, value: v }); };

/* ---------- photo helpers ---------- */
const live = p => !p.trashedAt && !p.locked;                       // visible anywhere except trash/locked
const inTimeline = p => live(p) && !p.archived;                    // main grid
const list = (pred = inTimeline) => { const a = []; for (const p of M.photos.values()) if (pred(p)) a.push(p); return a.sort((x, y) => y.takenAt - x.takenAt || y.createdAt - x.createdAt); };
const savePhoto = async (p, quiet) => { await db.put('photos', p); M.photos.set(p.id, p); if (!quiet) P.emit('photos'); };
const savePhotos = async (arr, quiet) => { await db.bulk('photos', arr); arr.forEach(p => M.photos.set(p.id, p)); if (!quiet) P.emit('photos'); };

/* thumbnails + object URL cache */
const urlCache = new Map();
function cacheURL(key, blob) { const u = URL.createObjectURL(blob); urlCache.set(key, u); if (urlCache.size > 1500) { const k = urlCache.keys().next().value; URL.revokeObjectURL(urlCache.get(k)); urlCache.delete(k); } return u; }
const pend = new Map();
async function thumbURL(id) {
  const k = 't' + id;
  if (urlCache.has(k)) return urlCache.get(k);
  if (pend.has(k)) return pend.get(k);
  const pr = (async () => { const r = await db.get('thumbs', id); return r ? cacheURL(k, r.blob) : null; })();
  pend.set(k, pr); const u = await pr; pend.delete(k); return u;
}
const getBlob = async id => (await db.get('blobs', id))?.blob;
async function fullURL(id) { const k = 'f' + id; if (urlCache.has(k)) return urlCache.get(k); const b = await getBlob(id); return b ? cacheURL(k, b) : null; }
const dropURLs = id => ['t', 'f'].forEach(x => { const u = urlCache.get(x + id); if (u) { URL.revokeObjectURL(u); urlCache.delete(x + id); } });

/* ---------- albums ---------- */
const albumItems = id => M.items.filter(i => i.albumId === id);
const albumPhotos = id => albumItems(id).map(i => M.photos.get(i.photoId)).filter(p => p && !p.trashedAt && (!p.locked)).sort((a, b) => b.takenAt - a.takenAt);
async function saveAlbum(a) { await db.put('albums', a); M.albums.set(a.id, a); P.emit('albums'); }
async function addToAlbum(albumId, ids) {
  const have = new Set(albumItems(albumId).map(i => i.photoId));
  const add = ids.filter(i => !have.has(i)).map(photoId => ({ id: P.uid(), albumId, photoId, addedAt: Date.now() }));
  if (add.length) { await db.bulk('albumItems', add); M.items.push(...add); }
  const a = M.albums.get(albumId); if (a && !a.cover && ids[0]) { a.cover = ids[0]; await saveAlbum(a); }
  P.emit('albums'); return add.length;
}
async function removeFromAlbum(albumId, ids) {
  const s = new Set(ids), rm = M.items.filter(i => i.albumId === albumId && s.has(i.photoId));
  await db.bulkDel('albumItems', rm.map(i => i.id)); M.items = M.items.filter(i => !rm.includes(i)); P.emit('albums');
}
async function deleteAlbum(id) { await removeFromAlbum(id, albumItems(id).map(i => i.photoId)); await db.del('albums', id); M.albums.delete(id); P.emit('albums'); }

/* ---------- destructive ops ---------- */
async function trash(ids) { const t = Date.now(), arr = ids.map(i => M.photos.get(i)).filter(Boolean); arr.forEach(p => { p.trashedAt = t; p.fav = p.fav; }); await savePhotos(arr); return arr; }
async function untrash(ids) { const arr = ids.map(i => M.photos.get(i)).filter(Boolean); arr.forEach(p => p.trashedAt = null); await savePhotos(arr); }
async function purge(ids) {
  for (const id of ids) { dropURLs(id); }
  await db.bulkDel('photos', ids); await db.bulkDel('blobs', ids); await db.bulkDel('thumbs', ids); await db.bulkDel('features', ids); await db.bulkDel('embeddings', ids);
  ids.forEach(i => M.photos.delete(i));
  const s = new Set(ids), rm = M.items.filter(i => s.has(i.photoId));
  if (rm.length) { await db.bulkDel('albumItems', rm.map(i => i.id)); M.items = M.items.filter(i => !s.has(i.photoId)); }
  const fr = M.faces.filter(f => s.has(f.photoId));
  if (fr.length) { await db.bulkDel('faces', fr.map(f => f.id)); M.faces = M.faces.filter(f => !s.has(f.photoId)); }
  for (const sh of M.shares.values()) { const n = sh.photoIds.filter(i => !s.has(i)); if (n.length !== sh.photoIds.length) { sh.photoIds = n; await db.put('shares', sh); } }
  P.emit('photos'); P.emit('albums');
}
async function autoPurge() {
  const cut = Date.now() - M.settings.trashDays * 86400000;
  const old = [...M.photos.values()].filter(p => p.trashedAt && p.trashedAt < cut).map(p => p.id);
  if (old.length) await purge(old);
}
async function storage() {
  let used = 0; for (const p of M.photos.values()) used += p.size || 0;
  let quota = 15 * 1024 ** 3, usage = used;
  try { const e = await navigator.storage.estimate(); quota = e.quota || quota; usage = e.usage || used; } catch { }
  return { used, usage, quota, free: quota - usage };
}

Object.assign(P, { db, load, setting, live, inTimeline, list, savePhoto, savePhotos, thumbURL, fullURL, getBlob, dropURLs, albumItems, albumPhotos, saveAlbum, addToAlbum, removeFromAlbum, deleteAlbum, trash, untrash, purge, autoPurge, storage, DEFAULTS });
})();
