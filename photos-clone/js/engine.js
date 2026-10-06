/* Memory-search engine — pure functions (no DOM, no storage), unit-tested in Node.
 *
 *   const idx = E.buildIndex(ctx)                      // once per library change
 *   const out = E.search(idx, clues, { semantic, answers, filters, onlyIds })
 *   const q   = E.nextQuestion(idx, out, answeredDims, clues)
 *
 * Design: every clue in the query ("pink dress", "wedding", "June 2023", "with Rhea") scores each photo 0..1.
 * The photo's score is the weighted average over clues, so a photo that matches MOST of what you remember still
 * surfaces (vague memory), while the "why" list tells you which clues matched and which did not.
 */
(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./nlp.js') : root.P.nlp);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.P = root.P || {}; root.P.engine = api; }
})(typeof window !== 'undefined' ? window : globalThis, function (nlp) {

const HOUR = 3600000, DAY = 86400000;
const OUTDOOR_WORDS = ['beach', 'mountain', 'sky', 'park', 'garden', 'street', 'road', 'sunset', 'sunrise', 'forest', 'lake', 'river', 'ocean', 'sea', 'field', 'hill', 'trek', 'trail', 'waterfall', 'desert', 'snow', 'bridge', 'farm', 'campsite', 'temple', 'fort', 'monument', 'outdoor', 'outside', 'city', 'skyline', 'ski', 'valley', 'cliff', 'island', 'seashore', 'lakeside', 'villa', 'resort'];
const INDOOR_WORDS = ['room', 'kitchen', 'bedroom', 'restaurant', 'cafe', 'hall', 'office', 'classroom', 'sofa', 'couch', 'table', 'dining', 'lobby', 'ceiling', 'living room', 'bathroom', 'library', 'mall', 'indoor', 'inside', 'banquet', 'theatre', 'stage', 'gym', 'hostel', 'cake'];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lc = s => (s || '').toString().toLowerCase();
const COLOR_IDX = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'white', 'gray', 'black'];

const WEIGHTS = { date: 3, person: 3, name: 2, place: 2.5, event: 2.5, attire: 2, setting: 1.2, tag: 4, text: 1.2, relation: 0.8, color: 1, occasion: 2, semantic: 3, year: 3, media: 3 };
const TIER = { strong: 0.78, partial: 0.45 };

/* ---------- index ---------- */
function buildIndex(ctx) {
  const now = ctx.now || Date.now();
  const people = new Map((ctx.people || []).map(p => [p.id, p]));
  const facesBy = new Map();
  for (const f of (ctx.faces || [])) { if (!f.personId) continue; if (!facesBy.has(f.photoId)) facesBy.set(f.photoId, new Set()); facesBy.get(f.photoId).add(f.personId); }
  const albumNames = new Map(), albumById = new Map((ctx.albums || []).map(a => [a.id, a]));
  for (const it of (ctx.items || [])) { const a = albumById.get(it.albumId); if (!a) continue; if (!albumNames.has(it.photoId)) albumNames.set(it.photoId, []); albumNames.get(it.photoId).push(lc(a.name)); }
  const photos = (ctx.photos || []).filter(p => !p.trashedAt && !p.locked).sort((a, b) => a.takenAt - b.takenAt);

  // home place = most frequent place (only when it clearly dominates)
  const pc = new Map(); photos.forEach(p => { const k = p.loc && p.loc.place; if (k) pc.set(k, (pc.get(k) || 0) + 1); });
  const located = [...pc.values()].reduce((a, b) => a + b, 0), top = [...pc].sort((a, b) => b[1] - a[1])[0];
  const home = top && located >= 8 && top[1] / located >= 0.35 ? top[0] : null;

  // short episodes (gap ≤ 8h) and trips (episodes ≤ 30h apart, away from home)
  const eps = []; let cur = null;
  photos.forEach((p, i) => { if (!cur || p.takenAt - photos[i - 1].takenAt > 8 * HOUR) { cur = { ids: [], t0: p.takenAt, t1: p.takenAt, places: new Map() }; eps.push(cur); } cur.ids.push(p.id); cur.t1 = p.takenAt; const pl = p.loc && p.loc.place; if (pl) cur.places.set(pl, (cur.places.get(pl) || 0) + 1); });
  const trips = []; let tr = null;
  eps.forEach(ep => {
    const away = ep.places.size ? [...ep.places.keys()].some(k => k !== home) : false;
    if (tr && ep.t0 - tr.t1 <= 30 * HOUR && (away || tr.away)) { tr.eps.push(ep); tr.t1 = ep.t1; tr.n += ep.ids.length; tr.away = tr.away || away; ep.places.forEach((v, k) => tr.places.set(k, (tr.places.get(k) || 0) + v)); }
    else { tr = { eps: [ep], t0: ep.t0, t1: ep.t1, n: ep.ids.length, away, places: new Map(ep.places) }; trips.push(tr); }
  });
  const epOf = new Map(), tripOf = new Map();
  eps.forEach((ep, i) => ep.ids.forEach(id => epOf.set(id, i))); trips.forEach((t, i) => t.eps.forEach(ep => ep.ids.forEach(id => tripOf.set(id, i))));

  const entries = new Map();
  for (const p of photos) {
    const albums = albumNames.get(p.id) || [], pids = facesBy.get(p.id) || new Set();
    const pnames = [...pids].map(id => lc(people.get(id) && people.get(id).name)).filter(Boolean);
    const tags = (p.tags || []).map(nlp.normTag);
    const place = p.loc && p.loc.place ? p.loc.place : null;
    const nt = nlp.normText, strong = [nt((p.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ')), nt(p.desc), nt(p.note), tags.join(' | '), albums.map(nt).join(' | ')].join(' | ');
    const med = [(p.labels || []).map(lc).join(' | '), lc(place), pnames.join(' | '), lc(p.cam && (p.cam.make + ' ' + p.cam.model)), p.kind].join(' | ');
    const weak = nt((p.ocr || '').slice(0, 2500));
    const e = { id: p.id, p, t: p.takenAt, year: new Date(p.takenAt).getFullYear(), month: new Date(p.takenAt).getMonth(), strong, med, weak, hay: strong + ' | ' + med + ' | ' + weak, tags, tagSet: new Set(tags), pids, pnames, place, album: albums, ep: epOf.get(p.id), trip: tripOf.get(p.id) };
    e.evs = new Set(); for (const [ev, syn] of Object.entries(nlp.EVENTS)) if (syn.some(w => nlp.hasWord(strong + ' | ' + med, w))) e.evs.add(ev);
    entries.set(p.id, e);
  }
  // propagate event evidence across the short episode; derive occasion type
  const epTags = eps.map(ep => { const s = new Set(); ep.ids.forEach(id => entries.get(id).tagSet.forEach(x => s.add(x))); return s; });
  const epEv = eps.map(ep => { const s = new Set(); ep.ids.forEach(id => entries.get(id).evs.forEach(x => s.add(x))); return s; });
  for (const e of entries.values()) {
    e.epEv = epEv[e.ep] || new Set(); e.epTags = epTags[e.ep] || new Set();
    const ep = eps[e.ep], tp = trips[e.trip], f = (ctx.features && ctx.features.get && ctx.features.get(e.id)) || null;
    const span = tp ? tp.t1 - tp.t0 : 0, days = tp ? Math.round(span / DAY) : 0;
    e.occasion = tp && tp.n >= 6 && days >= 1 && (tp.away || !home) && span >= 20 * HOUR ? 'trip' : (ep && ep.ids.length >= 5 && ep.t1 - ep.t0 <= 12 * HOUR) || e.evs.size ? 'event' : 'everyday';
    if (e.evs.has('trip') && e.occasion !== 'trip') e.occasion = 'trip';
    e.epPlace = ep && ep.places.size ? [...ep.places].sort((a, b) => b[1] - a[1])[0][0] : null;
    e.feat = f;
    // indoor/outdoor evidence → outdoor probability (null when nothing is known)
    let out = 0.5, ev = 0;
    const clip = ctx.clipOut && ctx.clipOut.get && ctx.clipOut.get(e.id);
    if (clip != null) { out = clip; ev = 1; }
    else {
      const w = lc(e.strong + ' ' + e.med); let o = 0, i = 0;
      OUTDOOR_WORDS.forEach(x => { if (nlp.hasWord(w, x)) o++; }); INDOOR_WORDS.forEach(x => { if (nlp.hasWord(w, x)) i++; });
      if (o || i) { out = 0.5 + 0.18 * clamp(o - i, -3, 3); ev = 1; }
      if (f && f.sky != null) { out += clamp((f.sky - 0.2) * 0.8, -0.25, 0.35); ev = ev || (f.sky > 0.3 || f.sky < 0.05 ? 1 : 0); }
    }
    e.out = ev ? clamp(out) : null;
  }
  const ctxPlaces = [...pc.keys()];
  return { entries, list: [...entries.values()], eps, trips, home, now, people, places: ctxPlaces, years: [...new Set([...entries.values()].map(e => e.year))].sort((a, b) => b - a), albums: ctx.albums || [] };
}

/* ---------- clue matchers (each returns 0..1) ---------- */
function mDate(e, r) {
  if (r.month != null) { if (e.month === r.month) return 1; const d = Math.min(Math.abs(e.month - r.month), 12 - Math.abs(e.month - r.month)); return d === 1 ? 0.2 : 0; }
  if (e.t >= r.s && e.t < r.e) return 1;
  const soft = r.soft || 0; if (soft && e.t >= r.s - soft && e.t < r.e + soft) return r.vague ? 0.55 : 0.5;
  return 0;
}
function mPerson(e, pid, name) { if (e.pids.has(pid)) return 1; const n = lc(name); if (n && e.strong.includes(n)) return 0.8; return 0; }
function mText(e, term) { const t = lc(term); if (!t) return 0; if (e.strong.includes(t)) return 1; if (e.med.includes(t)) return 0.9; if (e.weak.includes(t)) return 0.7; return 0; }
function mPlace(e, pl, idx) {
  const m = lc(pl.match || pl.name || pl), full = lc(pl.name || pl);
  if (e.place && (lc(e.place).includes(m) || lc(e.place).includes(full))) return pl.level === 'country' ? 0.85 : 1;
  if (!e.place && e.epPlace && lc(e.epPlace).includes(m)) return 0.6;   // photo lacks GPS but its moment has a place
  if (!e.place && (e.strong.includes(m))) return 0.8;
  return 0;
}
function mEvent(e, ev) {
  if (e.evs.has(ev)) return 1;
  if (e.epEv.has(ev)) return 0.7;
  if (ev === 'trip' && e.occasion === 'trip') return 0.8;
  if (ev !== 'trip' && ev !== 'family' && e.occasion === 'event' && !e.evs.size) return 0.12;
  return 0;
}
function mAttire(e, a) {
  const text = lc(a.text), strongHit = e.strong.includes(text), garment = a.garment ? e.strong.includes(a.garment) || e.med.includes(a.garment) : false;
  let best = 0;
  if (strongHit) best = 1;
  else if (a.color && a.garment && e.strong.includes(a.color) && garment) best = 0.9;
  else if (!a.color && garment) best = 0.65;
  else if (a.color && garment) best = 0.45;
  else if (a.color && e.strong.includes(a.color)) best = a.bare && !a.worn ? 0.6 : 0.4;
  if (a.color && e.feat) {                                    // heuristic from pixel colours (below faces / lower-centre)
    const share = (e.feat.torso && e.feat.torso[COLOR_IDX.indexOf(a.color)]) || 0, g = (e.feat.hist && e.feat.hist[COLOR_IDX.indexOf(a.color)]) || 0;
    const base = a.garment || a.worn ? share / 0.14 : g / 0.22;
    const px = clamp(base) * (a.garment || a.worn ? (e.pids.size ? 0.72 : 0.5) : 0.7);
    best = Math.max(best, px);
  }
  return best;
}
function mSetting(e, want) { if (e.out == null) return 0.35; return want === 'outdoor' ? e.out : 1 - e.out; }
function mType(e, t) {
  const p = e.p;
  return ({ video: p.kind === 'video', edited: !!p.edited, selfie: !!p.selfie, screenshot: !!p.screenshot, panorama: !!p.pano, document: !!(p.doc || (p.ocr && p.ocr.length > 120)), favorite: !!p.fav })[t] ? 1 : 0;
}
function mTag(e, t) { const tl = nlp.normTag(t); if (e.tagSet.has(tl)) return 1; for (const x of e.tags) if (x.includes(tl) || tl.includes(x)) return 0.8; if (e.strong.includes(tl)) return 0.5; return e.epTags && e.epTags.has(tl) ? 0.5 : 0; }

/* ---------- search ---------- */
function clueList(clues, answers) {
  const L = []; clues = clues || {};
  (clues.dates || []).forEach((r, i) => L.push({ kind: 'date', label: r.label, w: WEIGHTS.date, fn: e => mDate(e, r) }));
  (clues.people || []).forEach(p => L.push({ kind: 'person', label: p.name, w: WEIGHTS.person, fn: e => mPerson(e, p.id, p.name) }));
  (clues.unknownNames || []).forEach(n => L.push({ kind: 'name', label: nlp.cap(n), w: WEIGHTS.name, fn: e => mText(e, n) }));
  (clues.places || []).forEach(p => L.push({ kind: 'place', label: p.name.split(',')[0], w: WEIGHTS.place, fn: e => mPlace(e, p) }));
  (clues.events || []).forEach(ev => L.push({ kind: 'event', label: nlp.cap(ev), w: WEIGHTS.event, fn: e => mEvent(e, ev) }));
  (clues.attire || []).forEach(a => L.push({ kind: 'attire', label: a.text, w: a.garment || a.worn ? WEIGHTS.attire : WEIGHTS.color, fn: e => mAttire(e, a), approx: true }));
  if (clues.setting) L.push({ kind: 'setting', label: clues.setting === 'indoor' ? 'Indoors' : 'Outdoors', w: WEIGHTS.setting, fn: e => mSetting(e, clues.setting) });
  (clues.tags || []).forEach(t => L.push({ kind: 'tag', label: '#' + t, w: WEIGHTS.tag, fn: e => mTag(e, t) }));
  (clues.relations || []).forEach(r => L.push({ kind: 'relation', label: r, bonus: true, w: WEIGHTS.relation, fn: e => Math.max(mText(e, r), r === 'mom' || r === 'mother' || r === 'mummy' ? mText(e, 'maa') : 0) }));
  (clues.text || []).forEach(t => { if ((clues.unknownNames || []).some(n => n.startsWith(t) || t.startsWith(n))) return; L.push({ kind: 'text', label: t, w: WEIGHTS.text, fn: e => mText(e, t) }); });
  // assistant answers (soft clues: "not sure" is simply absent)
  (answers || []).forEach(a => {
    if (a.dim === 'setting') L.push({ kind: 'setting', label: a.label, w: 2, fn: e => mSetting(e, a.value), fromAnswer: true });
    else if (a.dim === 'person') L.push({ kind: 'person', label: a.label, w: 3, fn: e => (e.pids.has(a.value) ? 1 : 0), fromAnswer: true });
    else if (a.dim === 'place') L.push({ kind: 'place', label: a.label, w: 2.5, fn: e => mPlace(e, { name: a.value, match: lc(a.value).split(',')[0] }), fromAnswer: true });
    else if (a.dim === 'occasion') L.push({ kind: 'occasion', label: a.label, w: WEIGHTS.occasion, fn: e => (e.occasion === a.value ? 1 : (a.value === 'event' && e.occasion === 'trip' ? 0.2 : 0)), fromAnswer: true });
    else if (a.dim === 'year') L.push({ kind: 'date', label: a.label, w: WEIGHTS.year, fn: e => (e.year === a.value ? 1 : (Math.abs(e.t - new Date(a.value, 0, 1).getTime()) < 45 * DAY || Math.abs(e.t - new Date(a.value + 1, 0, 1).getTime()) < 45 * DAY ? 0.45 : 0)), fromAnswer: true });
    else if (a.dim === 'media') L.push({ kind: 'type', label: a.label, w: WEIGHTS.media, fn: e => mType(e, a.value) || (a.value === 'photo' && e.p.kind === 'image' && !e.p.screenshot ? 1 : 0), fromAnswer: true });
    else if (a.dim === 'text') L.push({ kind: 'text', label: a.label, w: 1.6, fn: e => mText(e, a.value), fromAnswer: true });
  });
  return L;
}

function passesFilters(e, f) {
  if (!f) return true; const p = e.p;
  if (f.types && f.types.length && !f.types.some(t => mType(e, t) || (t === 'photo' && p.kind === 'image') || (t === 'edited' && p.edited))) return false;
  if (f.from && e.t < new Date(f.from).getTime()) return false;
  if (f.to && e.t >= new Date(f.to).getTime() + DAY) return false;
  if (f.person && !e.pids.has(f.person)) return false;
  if (f.album && !(e.album || []).length) return false;
  if (f.place && !lc(e.place).includes(lc(f.place))) return false;
  if (f.tag && !(e.tagSet.has(nlp.normTag(f.tag)) || (e.epTags && e.epTags.has(nlp.normTag(f.tag)) && f.looseTag))) return false;
  if (f.fav && !p.fav) return false;
  if (f.hasLoc && !p.loc) return false;
  return true;
}

function search(idx, clues, opts = {}) {
  const L = clueList(clues, opts.answers), semantic = opts.semantic || null;
  const hardTypes = (clues && clues.types) || [];
  const only = opts.onlyIds ? new Set(opts.onlyIds) : null;
  const tiers = Object.assign({}, TIER, opts.tiers || {});
  const results = [];
  if (!L.length && !semantic && !hardTypes.length && !(opts.filters && Object.keys(opts.filters).length)) return { results: [], clues: L, total: 0, strong: 0, partial: 0, empty: true };
  for (const e of idx.list) {
    if (only && !only.has(e.id)) continue;
    if (!passesFilters(e, opts.filters)) continue;
    if (hardTypes.length && !hardTypes.every(t => mType(e, t))) continue;
    let s = 0, d = 0; const matched = [], missed = [];
    for (const c of L) { const m = c.fn(e); if ((c.bonus || (semantic && c.kind === 'text')) && m < 0.3) continue; s += c.w * m; d += c.w; (m >= 0.6 ? matched : m < 0.3 ? missed : matched).push({ kind: c.kind, label: c.label, m: +m.toFixed(2), approx: !!c.approx, partial: m < 0.6 && m >= 0.3 }); }
    if (semantic) { const m = semantic.get(e.id) || 0; s += WEIGHTS.semantic * m; d += WEIGHTS.semantic; if (m >= 0.6) matched.push({ kind: 'semantic', label: 'looks like your description', m: +m.toFixed(2), approx: true }); }
    const score = d ? s / d : 1;
    if (score >= tiers.partial) results.push({ id: e.id, score: +score.toFixed(3), matched, missed, tier: score >= tiers.strong ? 'strong' : 'partial', t: e.t });
  }
  results.sort((a, b) => b.score - a.score || b.t - a.t);
  const strong = results.filter(r => r.tier === 'strong').length;
  return { results, clues: L, total: results.length, strong, partial: results.length - strong, empty: false };
}

/* ---------- assistant: pick the follow-up question that splits the candidates best ---------- */
const PRIORITY = { setting: 1.0, person: 1.06, occasion: 1.0, year: 1.12, place: 1.0, media: 0.8 };
function entropy(counts) { const n = counts.reduce((a, b) => a + b, 0); if (!n) return 0; return -counts.reduce((h, c) => (c ? h + (c / n) * Math.log2(c / n) : h), 0); }

function nextQuestion(idx, out, answered = [], clues = {}) {
  const cands = out.results.slice(0, 150).map(r => idx.entries.get(r.id)).filter(Boolean);
  if (cands.length <= 6) return { done: true, reason: cands.length ? 'few' : 'none', count: cands.length };
  const asked = new Set(answered.map(a => a.dim));
  const have = { setting: !!clues.setting, person: (clues.people || []).length > 0, year: (clues.dates || []).length > 0, place: (clues.places || []).length > 0, occasion: (clues.events || []).some(e => ['trip', 'wedding', 'party', 'birthday', 'festival', 'graduation'].includes(e)), media: (clues.types || []).length > 0 };
  const N = cands.length, dims = [];
  const consider = (dim, bucketOf, optionsFn, textQ) => {
    if (asked.has(dim) || have[dim]) return;
    const buckets = new Map(); cands.forEach(e => { const k = bucketOf(e); buckets.set(k == null ? '__unknown' : k, (buckets.get(k == null ? '__unknown' : k) || 0) + 1); });
    const known = [...buckets].filter(([k]) => k !== '__unknown'), unknown = buckets.get('__unknown') || 0;
    const big = known.filter(([, c]) => c / N >= 0.08);
    if (big.length < 2 || unknown / N > 0.65) return;
    const score = entropy([...buckets.values()]) * (1 - 0.5 * unknown / N) * (PRIORITY[dim] || 1);
    dims.push({ dim, score, text: textQ, options: optionsFn(known) });
  };
  consider('setting', e => (e.out == null ? null : e.out >= 0.6 ? 'outdoor' : e.out <= 0.4 ? 'indoor' : null), k => k.sort((a, b) => b[1] - a[1]).map(([v, c]) => ({ value: v, label: v === 'outdoor' ? 'Outdoors' : 'Indoors', count: c })), 'Was it taken indoors or outdoors?');
  consider('occasion', e => e.occasion, k => k.sort((a, b) => b[1] - a[1]).map(([v, c]) => ({ value: v, label: v === 'trip' ? 'During a trip' : v === 'event' ? 'At an event or party' : 'An everyday moment', count: c })), 'Was it during a trip or an event?');
  // people: bucket by the most common person present
  const pcount = new Map(); cands.forEach(e => e.pids.forEach(id => pcount.set(id, (pcount.get(id) || 0) + 1)));
  const alreadyP = new Set(); (clues.people || []).forEach(p => alreadyP.add(p.id)); answered.forEach(a => a.dim === 'person' && alreadyP.add(a.value));
  const topP = [...pcount].filter(([id]) => !alreadyP.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (topP.length >= 2) consider('person', e => { for (const [id] of topP) if (e.pids.has(id)) return id; return e.pids.size ? 'other' : null; }, k => topP.map(([id, c]) => ({ value: id, label: (idx.people.get(id) && idx.people.get(id).name) || 'Unnamed', count: c })), 'Who was with you?');
  consider('year', e => e.year, k => k.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v, c]) => ({ value: +v, label: String(v), count: c })), 'Roughly when was it taken?');
  consider('place', e => (e.place || e.epPlace || null), k => k.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v, c]) => ({ value: v, label: v.split(',')[0], count: c })), 'Where was it taken?');
  consider('media', e => (e.p.kind === 'video' ? 'video' : e.p.screenshot ? 'screenshot' : 'photo'), k => k.sort((a, b) => b[1] - a[1]).map(([v, c]) => ({ value: v, label: nlp.cap(v), count: c })), 'Was it a photo, a video or a screenshot?');
  if (!dims.length) return asked.has('text') ? { done: true, reason: 'exhausted', count: cands.length } : { dim: 'text', text: 'Anything else you remember — a word, a name, or something visible in it?', free: true, options: [], count: cands.length };
  dims.sort((a, b) => b.score - a.score);
  return { ...dims[0], count: cands.length, free: false };
}

/* answer → the stored answer object used by clueList */
function makeAnswer(dim, value, label) { return { dim, value, label: label || String(value) }; }

/* ---------- convenience: natural-language one-shot ---------- */
function ask(idx, raw, ctxForParse, opts) { const clues = nlp.parse(raw, Object.assign({ now: idx.now, people: [...idx.people.values()], places: idx.places, albums: idx.albums.map(a => a.name) }, ctxForParse)); return { clues, out: search(idx, clues, opts) }; }

return { buildIndex, search, nextQuestion, makeAnswer, ask, clueList, WEIGHTS, TIER, COLOR_IDX, entropy, passesFilters };
});
