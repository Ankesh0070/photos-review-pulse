/* Offline shell cache (app files only; photos live in IndexedDB) */
const V = 'photos-clone-v2';
const SHELL = ['./', 'index.html', 'manifest.json', 'assets/logo.svg', 'css/app.css',
  'js/core.js', 'js/db.js', 'js/ingest.js', 'js/select.js', 'js/timeline.js', 'js/viewer.js', 'js/editor.js', 'js/ml.js', 'js/nlp.js', 'js/engine.js', 'js/features.js', 'js/search.js', 'js/notes.js', 'js/memory.js', 'js/library.js', 'js/albums.js', 'js/sharing.js', 'js/create.js', 'js/askchat.js', 'js/explore.js', 'js/settings.js', 'js/app.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  // network-first for same-origin app files (so edits show up), cache fallback offline
  if (u.origin === location.origin) { e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); return res; }).catch(() => caches.match(r).then(m => m || caches.match('index.html')))); return; }
  // CDN assets (fonts, leaflet, ML libs): stale-while-revalidate
  if (/googleapis|gstatic|unpkg|jsdelivr|cdnjs/.test(u.host)) e.respondWith(caches.open(V + '-cdn').then(async c => { const m = await c.match(r); const net = fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => m); return m || net; }));
});
