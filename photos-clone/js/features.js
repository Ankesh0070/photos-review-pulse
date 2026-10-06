/* Image features for memory search.
 *  1. Colour features (always on, cheap): 12-class colour histograms of the whole photo and of the "torso" region
 *     (below detected faces, otherwise lower-centre) + a sky score → used for "pink dress" and indoor/outdoor.
 *  2. CLIP (opt-in, on-device): semantic image/text embeddings via transformers.js. Photos never leave the browser;
 *     the model (~90 MB) is downloaded once from the Hugging Face CDN.
 */
(() => {
const { $ } = P;
const NAMES = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'white', 'gray', 'black'];

/* ---------- 1. colour features ---------- */
function classify(r, g, b) {                       // → index into NAMES
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (l < 0.13) return 11;                         // black
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l > 0.88 && s < 0.25) return 9;              // white
  if (s < 0.14) return l > 0.82 ? 9 : l < 0.2 ? 11 : 10;   // gray
  let h = d === 0 ? 0 : mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
  if ((h >= 295 && h < 350) || ((h >= 345 || h < 12) && l > 0.66 && s > 0.3)) return 7;   // pink / magenta / light red
  if (h >= 345 || h < 12) return l < 0.28 ? 8 : 0; // red (dark red → brown-ish)
  if (h < 42) return l < 0.36 ? 8 : 1;             // orange / brown
  if (h < 68) return l < 0.3 ? 8 : 2;              // yellow
  if (h < 165) return 3;                           // green
  if (h < 195) return 4;                           // teal
  if (h < 258) return 5;                           // blue
  return 6;                                        // purple
}
function compute(bmp, faceBoxes) {
  const S = 64, c = new OffscreenCanvas(S, S), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0, S, S); const d = x.getImageData(0, 0, S, S).data;
  const hist = new Array(12).fill(0), torso = new Array(12).fill(0); let nh = 0, nt = 0, sky = 0, ns = 0, bright = 0;
  // torso region: below the lowest face (normalised box), centred; else lower-centre 50%×60%
  let tx0 = 0.25, tx1 = 0.75, ty0 = 0.4, ty1 = 1;
  if (faceBoxes && faceBoxes.length) { const f = faceBoxes[0]; tx0 = Math.max(0, f.x - f.w * 0.6); tx1 = Math.min(1, f.x + f.w * 1.6); ty0 = Math.min(0.95, f.y + f.h * 1.15); ty1 = Math.min(1, f.y + f.h * 4.2); }
  for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
    const i = (yy * S + xx) * 4, k = classify(d[i], d[i + 1], d[i + 2]); hist[k]++; nh++; bright += (d[i] + d[i + 1] + d[i + 2]) / 765;
    const fx = xx / S, fy = yy / S; if (fx >= tx0 && fx <= tx1 && fy >= ty0 && fy <= ty1) { torso[k]++; nt++; }
    if (yy < S * 0.35) { ns++; if ((k === 5 || k === 4) || (k === 9 || k === 10) && d[i + 2] > d[i] - 6) sky++; }   // blue/teal or pale grey-white-blue ⇒ sky-like
  }
  return { hist: hist.map(v => +(v / nh).toFixed(3)), torso: torso.map(v => +(v / Math.max(1, nt)).toFixed(3)), sky: +(sky / Math.max(1, ns)).toFixed(3), bright: +(bright / nh).toFixed(3), v: 2 };
}
const cache = new Map();
async function get(id) {
  if (cache.has(id)) return cache.get(id);
  const rec = await P.db.get('features', id);
  const faces = P.M.faces.filter(f => f.photoId === id).map(f => f.box);
  if (rec && rec.v === 2 && (rec.faces || 0) === faces.length) { cache.set(id, rec); return rec; }
  const t = await P.db.get('thumbs', id); if (!t) return null;
  const bmp = await createImageBitmap(t.blob); const f = compute(bmp, faces); bmp.close && bmp.close(); f.id = id; f.faces = faces.length;
  await P.db.put('features', f); cache.set(id, f); return f;
}
/* compute for everything that needs it (chunked so the UI stays responsive) */
async function ensureAll(ids, onProgress) {
  let i = 0; for (const id of ids) { try { await get(id); } catch { } if (++i % 40 === 0) { onProgress && onProgress(i, ids.length); await P.sleep(0); } }
  onProgress && onProgress(ids.length, ids.length);
}
const forget = id => cache.delete(id);

/* ---------- 2. CLIP (optional) ---------- */
const CLIP = { state: 'off', err: null, tok: null, text: null, proc: null, vis: null, lib: null, emb: new Map(), textCache: new Map(), indexing: false, done: 0, total: 0 };
const MODEL = 'Xenova/clip-vit-base-patch32';
async function load() {
  if (CLIP.state === 'ready') return true; if (CLIP.state === 'loading') return CLIP.loading;
  CLIP.state = 'loading'; P.emit('clip:state');
  CLIP.loading = (async () => {
    try {
      const lib = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
      lib.env.allowLocalModels = false; lib.env.useBrowserCache = true; CLIP.lib = lib;
      CLIP.tok = await lib.AutoTokenizer.from_pretrained(MODEL);
      CLIP.text = await lib.CLIPTextModelWithProjection.from_pretrained(MODEL);
      CLIP.proc = await lib.AutoProcessor.from_pretrained(MODEL);
      CLIP.vis = await lib.CLIPVisionModelWithProjection.from_pretrained(MODEL);
      const stored = await P.db.all('embeddings'); stored.forEach(r => CLIP.emb.set(r.id, r.v));
      CLIP.state = 'ready'; CLIP.err = null; P.emit('clip:state'); return true;
    } catch (e) { console.warn('CLIP load failed', e); CLIP.state = 'error'; CLIP.err = String(e.message || e); P.emit('clip:state'); return false; }
  })();
  return CLIP.loading;
}
const norm = v => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, x => x / s); };
async function embedText(text) {
  if (CLIP.textCache.has(text)) return CLIP.textCache.get(text);
  const inputs = CLIP.tok([text], { padding: true, truncation: true }); const { text_embeds } = await CLIP.text(inputs);
  const v = norm(text_embeds.data); CLIP.textCache.set(text, v); return v;
}
async function embedImage(id) {
  const u = await P.thumbURL(id); if (!u) return null;
  const img = await CLIP.lib.RawImage.read(u); const inputs = await CLIP.proc(img); const { image_embeds } = await CLIP.vis(inputs);
  return norm(image_embeds.data);
}
async function indexAll(onProgress) {
  if (!(await load())) return false; if (CLIP.indexing) return true; CLIP.indexing = true;
  const todo = [...P.M.photos.values()].filter(p => !p.trashedAt && !p.locked && !CLIP.emb.has(p.id)); CLIP.total = todo.length; CLIP.done = 0;
  try {
    for (const p of todo) {
      if (!CLIP.indexing) break;
      try { const v = await embedImage(p.id); if (v) { CLIP.emb.set(p.id, v); await P.db.put('embeddings', { id: p.id, v: Array.from(v, x => +x.toFixed(4)) }); } } catch (e) { console.warn('embed', p.id, e); }
      CLIP.done++; if (CLIP.done % 5 === 0) { onProgress && onProgress(CLIP.done, CLIP.total); P.emit('clip:progress'); await P.sleep(0); }
    }
  } finally { CLIP.indexing = false; P.emit('clip:progress'); onProgress && onProgress(CLIP.done, CLIP.total); }
  return true;
}
function stopIndexing() { CLIP.indexing = false; }
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
/* semantic scores 0..1 for a description: z-score against the library, squashed with a logistic */
async function semantic(query) {
  if (CLIP.state !== 'ready' || !CLIP.emb.size) return null;
  const t = await embedText('a photo of ' + query), sims = []; for (const [id, v] of CLIP.emb) sims.push([id, dot(t, v)]);
  if (sims.length < 8) return null;
  const mean = sims.reduce((s, x) => s + x[1], 0) / sims.length, sd = Math.sqrt(sims.reduce((s, x) => s + (x[1] - mean) ** 2, 0) / sims.length) || 1e-6;
  const m = new Map(); for (const [id, s] of sims) m.set(id, 1 / (1 + Math.exp(-(((s - mean) / sd) - 1.6) * 1.6)));
  return m;
}
/* indoor/outdoor from embeddings via zero-shot prompts → Map(id → P(outdoor)) */
async function outdoorMap() {
  if (CLIP.state !== 'ready' || !CLIP.emb.size) return null;
  const [o, i] = await Promise.all([embedText('a photo taken outdoors'), embedText('a photo taken indoors')]); const m = new Map();
  for (const [id, v] of CLIP.emb) { const a = Math.exp(100 * dot(o, v)), b = Math.exp(100 * dot(i, v)); m.set(id, a / (a + b)); }
  return m;
}
/* background back-fill: compute colour features for photos that don't have them yet */
let loaded = false, busy = false;
async function loadAll() { if (loaded) return; (await P.db.all('features')).forEach(r => cache.set(r.id, r)); loaded = true; }
async function backfill() {
  if (busy) return; busy = true; let n = 0;
  try {
    await loadAll();
    const todo = [...P.M.photos.values()].filter(p => !p.trashedAt && !p.locked && !cache.has(p.id));
    for (const p of todo) { try { await get(p.id); n++; } catch { } if (n % 25 === 0) await P.sleep(0); }
  } finally { busy = false; if (n) P.emit('features:ready'); }
}
P.on('photos', P.debounce(() => { backfill(); if (CLIP.state === 'ready' && P.M.settings.clip && !CLIP.indexing) indexAll(); }, 2500));

P.features = { get, ensureAll, loadAll, backfill, cacheMap: () => cache, forget, compute, classify, NAMES, clip: { load, embedText, indexAll, stopIndexing, semantic, outdoorMap, state: () => CLIP.state, error: () => CLIP.err, count: () => CLIP.emb.size, progress: () => ({ done: CLIP.done, total: CLIP.total, indexing: CLIP.indexing }), has: id => CLIP.emb.has(id), drop: id => { CLIP.emb.delete(id); } } };
})();
