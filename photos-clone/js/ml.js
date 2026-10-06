/* On-device intelligence (all optional, lazy-loaded): face grouping, object labels, OCR, place names.
   Models/libraries are fetched from public CDNs on first use; photos never leave the browser. */
(() => {
const { $, el } = P;
const FACE_JS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/dist/face-api.js';
const FACE_MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model/';
const TF_JS = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js';
const MOBILENET_JS = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js';
const TESS_JS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js';

const ML = { running: false, q: [], done: 0, total: 0, cancel: false };
let faceReady, mobile, tess;

async function initFaces() {
  if (faceReady) return faceReady;
  return faceReady = (async () => {
    await P.loadScript(FACE_JS);
    await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODELS), faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODELS), faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODELS)]);
  })().catch(e => { faceReady = null; throw e; });
}
async function initLabels() {
  if (mobile) return mobile;
  await P.loadScript(TF_JS); await P.loadScript(MOBILENET_JS);
  return mobile = await window.mobilenet.load({ version: 2, alpha: 1.0 });
}
async function initOCR() {
  if (tess) return tess;
  await P.loadScript(TESS_JS);
  return tess = await Tesseract.createWorker('eng');
}

const distance = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); };
async function imgFor(id, max = 800) {
  const blob = await P.db.get('thumbs', id); const full = await P.getBlob(id);
  const bmp = await createImageBitmap(full, { imageOrientation: 'from-image' });
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.(); return c;
}

/* ---------- faces ---------- */
const personDesc = new Map();
function centroid(pid) { let c = personDesc.get(pid); if (c) return c; const fs = P.M.faces.filter(f => f.personId === pid && f.desc); if (!fs.length) return null; c = new Array(128).fill(0); fs.forEach(f => f.desc.forEach((v, i) => c[i] += v / fs.length)); personDesc.set(pid, c); return c; }
function avatarFrom(canvas, box) {
  const m = .35, w = box.w * canvas.width, h = box.h * canvas.height, sz = Math.max(w, h) * (1 + m), cx = (box.x + box.w / 2) * canvas.width, cy = (box.y + box.h / 2) * canvas.height;
  const o = document.createElement('canvas'); o.width = o.height = 96;
  o.getContext('2d').drawImage(canvas, cx - sz / 2, cy - sz / 2, sz, sz, 0, 0, 96, 96); return o.toDataURL('image/jpeg', .8);
}
async function facesFor(id) {
  await initFaces();
  const p = P.M.photos.get(id); if (!p || p.kind !== 'image') return [];
  P.M.faces.filter(f => f.photoId === id).forEach(f => { P.db.del('faces', f.id); });
  P.M.faces = P.M.faces.filter(f => f.photoId !== id);
  const c = await imgFor(id, 800);
  const res = await faceapi.detectAllFaces(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: .55 })).withFaceLandmarks().withFaceDescriptors();
  const out = [];
  for (const r of res) {
    const b = r.detection.box, box = { x: b.x / c.width, y: b.y / c.height, w: b.width / c.width, h: b.height / c.height };
    if (b.width < 28) continue; // ignore tiny background faces
    out.push(await addFace(id, box, Array.from(r.descriptor), c));
  }
  p.faceScan = true; await P.savePhoto(p, true);
  return out;
}
/* greedy clustering: join the nearest existing person (distance < 0.52) or start a new one */
async function addFace(photoId, box, descriptor, canvas) {
  const desc = Array.from(descriptor).map(v => +(+v).toFixed(4));
  let best = null, bd = 1e9;
  for (const per of P.M.people.values()) { const ce = centroid(per.id); if (!ce) continue; const d = distance(desc, ce); if (d < bd) { bd = d; best = per; } }
  let per = best && bd < .52 ? best : null;
  if (!per) { per = { id: P.uid(), name: '', avatar: canvas ? avatarFrom(canvas, box) : '', createdAt: Date.now(), pet: false }; P.M.people.set(per.id, per); await P.db.put('people', per); }
  const face = { id: P.uid(), photoId, box, desc, personId: per.id }; personDesc.delete(per.id);
  P.M.faces.push(face); await P.db.put('faces', face); return face;
}

/* ---------- labels ---------- */
const CATS = [
  ['Pets', /\b(dog|retriever|terrier|poodle|spaniel|hound|bulldog|collie|husky|shepherd|chihuahua|beagle|pug|cat|tabby|siamese|persian|kitten|hamster|rabbit|parrot|macaw)\b/i],
  ['Food', /(pizza|burger|hotdog|plate|bakery|ice cream|espresso|coffee|bagel|pretzel|waffle|guacamole|soup|salad|burrito|carbonara|meat loaf|trifle|chocolate|strawberry|banana|orange|lemon|pineapple|broccoli|mushroom|pomegranate|fig|cheeseburger|dough|pot pie|cup|wok|frying pan|dining table|menu|consomme|eggnog)/i],
  ['Beach', /(seashore|sandbar|coast|beach|lakeside|breakwater|wave|sandbar|dock|boat|canoe)/i],
  ['Mountains', /(alp|mountain|volcano|cliff|valley|ridge|geyser|promontory)/i],
  ['Cars', /(car|jeep|limousine|taxi|convertible|minivan|pickup|racer|cab|van|truck|bus|motor scooter|moped)/i],
  ['Flowers', /(daisy|sunflower|rose|tulip|flower|pot|bee|lotus|orchid|hip)/i],
  ['Buildings', /(church|palace|castle|mosque|monastery|tower|bridge|dome|library|cinema|restaurant|barn|lighthouse|pier|mosque|temple|obelisk|stupa|triumphal|suspension)/i],
  ['Documents', /(book jacket|menu|envelope|packet|notebook|binder|paper|comic book|crossword|web site|monitor|screen|laptop)/i],
  ['Night', /(spotlight|candle|torch|lighter|stage|neon)/i],
  ['Bikes', /(bicycle|mountain bike|tricycle|unicycle|moped|motor scooter)/i],
  ['Sports', /(ball|racket|soccer|volleyball|basketball|ski|snowboard|skateboard|surfboard|dumbbell|barbell|golf|baseball|tennis)/i],
];
async function labelsFor(id) {
  const model = await initLabels(); const c = await imgFor(id, 400);
  const preds = await model.classify(c, 5); const set = new Set();
  for (const pr of preds) {
    if (pr.probability < .12) continue;
    const name = pr.className.split(',')[0].trim().toLowerCase(); set.add(name);
    for (const [cat, re] of CATS) if (re.test(pr.className)) set.add(cat);
  }
  const p = P.M.photos.get(id); p.labels = [...set]; p.labelled = true; await P.savePhoto(p, true); return p.labels;
}
async function ocr(id) {
  const p = P.M.photos.get(id); if (p.ocr != null && p.ocr !== '') return p.ocr;
  const w = await initOCR(); const c = await imgFor(id, 1800);
  const { data } = await w.recognize(c); p.ocr = (data.text || '').trim().replace(/\n{3,}/g, '\n\n').slice(0, 4000); await P.savePhoto(p, true); return p.ocr;
}

/* ---------- reverse geocoding (Nominatim) ---------- */
const geoCache = new Map(); let geoLast = 0;
async function geocode(p) {
  if (!p.loc) return null; const key = `${p.loc.lat.toFixed(1)},${p.loc.lon.toFixed(1)}`;
  if (geoCache.has(key)) { p.loc.place = geoCache.get(key); await P.savePhoto(p, true); return p.loc.place; }
  const wait = Math.max(0, 1100 - (Date.now() - geoLast)); if (wait) await P.sleep(wait); geoLast = Date.now();
  try {
    const r = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en&lat=${p.loc.lat}&lon=${p.loc.lon}`)).json();
    const a = r.address || {}, name = [a.city || a.town || a.village || a.county || a.state_district, a.state, a.country].filter(Boolean).slice(0, 2).join(', ') || r.display_name?.split(',').slice(0, 2).join(',');
    if (name) { geoCache.set(key, name); p.loc.place = name; await P.savePhoto(p, true); return name; }
  } catch { }
  return null;
}
async function geocodeAll() {
  const todo = [...P.M.photos.values()].filter(p => p.loc && !p.loc.place);
  if (!todo.length) return P.toast('All places already named');
  P.toast(`Looking up ${todo.length} places (1 per second)…`, { ms: 5000 });
  let n = 0; for (const p of todo) { await geocode(p); if (++n % 10 === 0) P.emit('photos'); if (ML.cancel) break; }
  P.emit('photos'); P.toast('Place names updated');
}

/* ---------- background queue ---------- */
function status() { return ML.running ? `Analysing ${ML.done}/${ML.total}` : ''; }
function paint() { const b = $('#ml-chip'); if (b) { b.textContent = status(); b.classList.toggle('hidden', !ML.running); } }
async function run() {
  if (ML.running) return; ML.running = true; ML.cancel = false;
  try {
    while (ML.q.length && !ML.cancel) {
      const id = ML.q.shift(), p = P.M.photos.get(id); ML.done++; paint();
      if (!p || p.kind !== 'image' || p.trashedAt || p.locked) continue;
      try {
        if (!p.labelled && P.M.settings.smart) await labelsFor(id);
        if (!p.faceScan && P.M.settings.smart && P.M.settings.faceGrouping) await facesFor(id);
      } catch (e) { console.warn('ml', e); if (/load|fetch|network/i.test(String(e.message))) { ML.q.length = 0; P.toast('Smart features need an internet connection the first time'); break; } }
      if (ML.done % 6 === 0) P.emit('ml:progress');
      await P.sleep(20);
    }
  } finally { ML.running = false; ML.done = ML.total = 0; paint(); P.emit('ml:progress'); P.emit('photos'); }
}
function queue(ids) { ids = ids.filter(i => !ML.q.includes(i)); ML.q.push(...ids); ML.total += ids.length; run(); }
function scanAll() {
  const ids = [...P.M.photos.values()].filter(p => p.kind === 'image' && !p.trashedAt && !p.locked && (!p.labelled || !p.faceScan)).map(p => p.id);
  if (!ids.length) return P.toast('Everything is already analysed');
  P.toast(`Analysing ${ids.length} photos on this device…`); queue(ids);
}
function stop() { ML.cancel = true; ML.q.length = 0; }

Object.assign(P, { ml: { addFace, queue, scanAll, stop, facesFor, labelsFor, ocr, geocode, geocodeAll, status, state: ML, distance, centroid, resetCentroids: () => personDesc.clear(), avatarFrom, imgFor } });
})();
