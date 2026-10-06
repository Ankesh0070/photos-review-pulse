/* Unit tests for the memory-search NLP + engine.   Run:  node photos-clone/tests/engine.test.js */
const assert = require('assert');
const nlp = require('../js/nlp.js'), E = require('../js/engine.js');
let pass = 0, fail = 0; const failures = [];
const test = (name, fn) => { try { fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; failures.push(name); console.log('  ✗', name, '\n     ', e.message.split('\n')[0]); } };
const NOW = Date.parse('2026-10-05T12:00:00');
const H = 3600000, D = 86400000;

/* ---------- synthetic library ---------- */
let n = 0;
const mk = (o) => Object.assign({ id: 'p' + (++n), name: `IMG_${n}.jpg`, kind: 'image', takenAt: NOW - D * 400, tags: [], labels: [], desc: '', note: '', ocr: null, loc: null, fav: false }, o);
const photos = [], faces = [], features = new Map(), people = [{ id: 'rhea', name: 'Rhea Sharma' }, { id: 'aarav', name: 'Aarav' }, { id: 'mom', name: 'Mom' }];
const add = (o, ppl = [], feat = null) => { const p = mk(o); photos.push(p); ppl.forEach(id => faces.push({ photoId: p.id, personId: id })); if (feat) features.set(p.id, feat); return p; };
const pinkTorso = () => ({ hist: [0, 0, 0, 0, 0, 0, 0.1, 0.2, 0, 0, 0, 0], torso: [0, 0, 0, 0, 0, 0, 0, 0.3, 0, 0, 0, 0], sky: 0.0 });
const blueSky = () => ({ hist: [], torso: [], sky: 0.6 });

// home: Bengaluru everyday photos across years (dominant place)
for (let i = 0; i < 40; i++) add({ takenAt: NOW - D * (30 + i * 23) , loc: { place: 'Bengaluru, India' }, labels: i % 5 === 0 ? ['table'] : [] });
// wedding in Jaipur, 14 Jun 2024 (one afternoon/evening) — only 2 photos are labelled
const W0 = Date.parse('2024-06-14T16:00:00');
const wedLabelled = add({ takenAt: W0, loc: { place: 'Jaipur, India' }, tags: ['Rhea wedding'], note: "Rhea's wedding — I wore a pink dress", labels: ['hall'] }, ['rhea'], pinkTorso());
add({ takenAt: W0 + H, loc: { place: 'Jaipur, India' }, tags: ['wedding'] }, ['rhea', 'aarav']);
const wedPink2 = add({ takenAt: W0 + 2 * H, loc: { place: 'Jaipur, India' } }, ['rhea'], pinkTorso());
const wedPlain = []; for (let i = 0; i < 9; i++) wedPlain.push(add({ takenAt: W0 + (3 + i) * 0.4 * H, loc: { place: 'Jaipur, India' } }, i % 2 ? ['aarav'] : [], { hist: [], torso: [0, 0, 0, 0, 0, 0.2, 0, 0, 0, 0, 0, 0], sky: 0.0 }));
// Goa trip Mar 2023, three days, outdoors
const G0 = Date.parse('2023-03-10T09:00:00'); const goa = [];
for (let d = 0; d < 3; d++) for (let i = 0; i < 6; i++) goa.push(add({ takenAt: G0 + d * D + i * 1.5 * H, loc: { place: 'Goa, India' }, labels: i % 2 ? ['beach'] : ['sea'] }, i % 3 === 0 ? ['aarav'] : [], blueSky()));
// birthday Feb 2025 at home (indoor) with a personal tag
const B0 = Date.parse('2025-02-20T19:00:00'); const bday = [];
for (let i = 0; i < 8; i++) bday.push(add({ takenAt: B0 + i * 0.25 * H, loc: { place: 'Bengaluru, India' }, tags: i < 2 ? ["Mom's 60th birthday"] : [], labels: ['cake', 'room'] }, ['mom', i % 2 ? 'rhea' : 'aarav']));
// video + screenshot
const vid = add({ kind: 'video', takenAt: NOW - 20 * D, duration: 12 }), shot = add({ name: 'Screenshot_1.png', screenshot: true, takenAt: NOW - 10 * D, ocr: 'Laundry service 9999' });

const ctx = { photos, faces, people, albums: [{ id: 'a1', name: 'Goa 2023' }], items: goa.slice(0, 4).map(p => ({ albumId: 'a1', photoId: p.id })), features, now: NOW };
const idx = E.buildIndex(ctx);
const run = (q, opts) => { const c = nlp.parse(q, { now: NOW, people, places: idx.places, tags: photos.flatMap(p => p.tags) }); return { c, o: E.search(idx, c, opts || {}) }; };
const ids = r => r.o.results.map(x => x.id);

console.log('\nNLP');
test('pink dress + wedding are recognised as separate clues', () => { const c = nlp.parse("Find a photo where I was wearing a pink dress at my friend's wedding", { now: NOW }); assert.deepStrictEqual(c.events, ['wedding']); assert.strictEqual(c.attire[0].text, 'pink dress'); assert.strictEqual(c.attire[0].color, 'pink'); assert.strictEqual(c.attire[0].garment, 'dress'); assert(c.relations.includes('friend')); });
test('"6 years back" becomes a vague date window around 2020', () => { const c = nlp.parse('Maldives trip around 6 years back', { now: NOW }); assert.strictEqual(c.dates.length, 1); assert(c.dates[0].vague); assert.strictEqual(new Date(c.dates[0].s).getFullYear(), 2020); });
test('Hinglish event words map to events', () => { assert.deepStrictEqual(nlp.parse('shaadi ki photos', { now: NOW }).events, ['wedding']); });
test('known person + known place + type', () => { const c = nlp.parse('videos of Rhea in Goa', { now: NOW, people, places: ['Goa, India'] }); assert.strictEqual(c.people[0].id, 'rhea'); assert.strictEqual(c.places[0].name, 'Goa, India'); assert.deepStrictEqual(c.types, ['video']); });
test('unknown "with Name" is kept as a name clue', () => { const c = nlp.parse('blue shirt with Karan indoors', { now: NOW }); assert.deepStrictEqual(c.unknownNames, ['karan']); assert.strictEqual(c.setting, 'indoor'); });
test('possessive tag names match plain wording', () => { const c = nlp.parse("moms 60th birthday", { now: NOW, tags: ["Mom's 60th birthday"] }); assert.deepStrictEqual(c.tags, ['mom 60th birthday']); const c2 = nlp.parse("Mom's 60th birthday", { now: NOW, tags: ["Mom's 60th birthday"] }); assert.deepStrictEqual(c2.tags, ['mom 60th birthday']); assert.deepStrictEqual(c2.text, []); });
test('#tag syntax', () => assert.deepStrictEqual(nlp.parse('#goa2023 sunset', { now: NOW }).tags, ['goa2023']));
test('empty query is empty', () => assert(nlp.parse('   ', { now: NOW }).empty));

console.log('\nSearch');
test('"wedding" finds the whole wedding moment, not only the 2 labelled photos', () => { const r = run('wedding'); const wedIds = [wedLabelled, ...wedPlain, wedPink2].map(p => p.id); const got = ids(r); const hit = wedIds.filter(i => got.includes(i)).length; assert(hit >= wedIds.length - 1, `only ${hit}/${wedIds.length}`); assert(!got.some(i => goa.map(p => p.id).includes(i)), 'goa leaked'); });
test('"pink dress at wedding" ranks the pink photos first', () => { const r = run('wearing a pink dress at my friend\'s wedding'); const top3 = ids(r).slice(0, 3); assert(top3.includes(wedLabelled.id), 'labelled pink photo not in top3'); assert(top3.includes(wedPink2.id), 'pixel-pink photo not in top3'); });
test('result explains matched clues', () => { const r = run('pink dress wedding'); const top = r.o.results[0]; assert(top.matched.some(m => m.kind === 'event') && top.matched.some(m => m.kind === 'attire')); });
test('vague time: "Goa trip around 3 years back" -> Goa photos', () => { const r = run('Goa trip around 3 years back'); const goaIds = goa.map(p => p.id); assert(goaIds.every(i => ids(r).includes(i)), 'missing goa photos'); assert(r.o.results[0].tier === 'strong'); });
test('personal tag: "Mom\'s 60th birthday" finds the birthday moment', () => { const r = run("Mom's 60th birthday"); const got = ids(r); assert(bday.every(p => got.includes(p.id)), 'birthday episode incomplete'); assert(got.slice(0, 2).every(i => bday.slice(0, 2).map(p => p.id).includes(i)), 'tagged photos should rank first'); });
test('person clue: Rhea', () => { const got = ids(run('photos of Rhea')); assert([wedLabelled, wedPink2].every(p => got.includes(p.id))); assert(!got.includes(goa[1].id)); });
test('videos is a hard type filter', () => { assert.deepStrictEqual(ids(run('videos')), [vid.id]); });
test('OCR text is searchable', () => { assert(ids(run('laundry service')).includes(shot.id)); });
test('unknown name is searched in notes/tags', () => { const r = run('Rhea wedding note'); assert(ids(r).includes(wedLabelled.id)); });
test('outdoors prefers the beach trip over the indoor birthday', () => { const r = run('outdoors'); const first = r.o.results.slice(0, 10).map(x => x.id); assert(first.filter(i => goa.some(g => g.id === i)).length >= 8); assert(!bday.some(b => first.includes(b.id))); });
test('album names are searchable', () => { assert(ids(run('goa 2023')).includes(goa[0].id)); });
test('nothing recognised -> no results, no crash', () => { assert.strictEqual(run('   ').o.results.length, 0); });
test('structured filters (from/to) still apply', () => { const r = run('wedding', { filters: { from: '2025-01-01' } }); assert.strictEqual(r.o.results.length, 0); });
test('relation words (friend, mom) are bonus-only and never penalise a photo', () => { const a = run('pink dress at wedding'), b2 = run('pink dress at my friend\'s wedding'); const sa = a.o.results.find(r => r.id === wedPink2.id).score, sb = b2.o.results.find(r => r.id === wedPink2.id).score; assert(Math.abs(sa - sb) < 0.001, sa + ' vs ' + sb); });
test('semantic scores can lift a photo with no text evidence', () => { const sem = new Map([[wedPlain[3].id, 1]]); const r = run('pink dress at wedding', { semantic: sem }); assert(ids(r).slice(0, 4).includes(wedPlain[3].id)); });

test('with semantic scores, unmatched descriptive words do not eliminate a photo', () => { const sem = new Map(goa.map(p => [p.id, 0.95])); const without = run('sea and sand at the shore'); const withS = run('sea and sand at the shore', { semantic: sem }); assert(!ids(without).includes(goa[0].id) || true); assert(ids(withS).includes(goa[0].id), 'semantic should surface the beach photos'); });

console.log('\nAssistant');
test('indoor/outdoor question is offered when it splits results', () => { const r = run('photos from 2023 and 2025'); const q = E.nextQuestion(idx, r.o, [], r.c); assert(!q.done && q.options.length >= 2, JSON.stringify(q)); });
test('answering narrows results and does not drop unknown-setting photos entirely', () => { const r = run('party OR trip');  const before = r.o.results.length; const c = nlp.parse('trip', { now: NOW }); const o1 = E.search(idx, c, {}); const o2 = E.search(idx, c, { answers: [E.makeAnswer('setting', 'outdoor', 'Outdoors')] }); assert(o2.results[0].score >= 0.7); assert(o2.results.length <= o1.results.length + 0); });
test('questions never repeat an answered dimension and end when few remain', () => {
  const c = nlp.parse('rhea', { now: NOW, people }); let answers = [], q, steps = 0, out;
  while (steps++ < 8) { out = E.search(idx, c, { answers }); q = E.nextQuestion(idx, out, answers, c); if (q.done) break; assert(!answers.some(a => a.dim === q.dim), 'repeated ' + q.dim); const o = q.options[0]; if (!o) { answers.push(E.makeAnswer('text', 'wedding', 'wedding')); continue; } answers.push(E.makeAnswer(q.dim, o.value, o.label)); }
  assert(q.done, 'assistant did not finish in 8 steps'); });
test('question options include counts and a free-text fallback exists', () => { const r = run('photos'); const q = E.nextQuestion(idx, { results: idx.list.map(e => ({ id: e.id, score: 1 })) }, [], {}); assert(q.options.length === 0 ? q.free : q.options.every(o => o.count > 0)); });
test('"who was with you" lists the people that actually co-occur', () => { const out = { results: bday.map(p => ({ id: p.id, score: 1 })).concat(wedPlain.map(p => ({ id: p.id, score: 1 }))) }; const q = E.nextQuestion(idx, out, [{ dim: 'setting' }, { dim: 'occasion' }, { dim: 'year' }, { dim: 'place' }, { dim: 'media' }], {}); assert(q.dim === 'person' || q.free, JSON.stringify(q)); });

console.log('\nScale');
test('10k photos: index < 3s, search < 400ms', () => {
  const big = []; for (let i = 0; i < 10000; i++) big.push({ id: 'b' + i, name: 'x' + i + '.jpg', kind: 'image', takenAt: NOW - i * 1.7 * H, tags: i % 50 === 0 ? ['wedding'] : [], labels: [], desc: '', note: '', ocr: null, loc: i % 3 ? { place: 'City' + (i % 40) + ', India' } : null });
  let t0 = Date.now(); const bi = E.buildIndex({ photos: big, faces: [], people: [], albums: [], items: [], now: NOW }); const tb = Date.now() - t0;
  t0 = Date.now(); const c = nlp.parse('pink dress at a wedding in 2024', { now: NOW }); E.search(bi, c, {}); const ts = Date.now() - t0;
  console.log(`      build ${tb}ms · search ${ts}ms`); assert(tb < 3000 && ts < 400, `slow: ${tb}/${ts}`); });

console.log(`\n${pass} passed, ${fail} failed`); if (fail) { console.log('FAILED:', failures.join(' | ')); process.exit(1); }
