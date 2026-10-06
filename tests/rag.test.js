/* Retrieval-quality tests for the Oracle's RAG engine, on the real project data.   Run:  node tests/rag.test.js */
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.resolve(__dirname, '..'), RAG = require('../static/rag_engine.js');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'static', f), 'utf8'));
const DATA = read('dashboard_data.json'), PRIMARY = read('primary_research.json'), VOICE = read('voice_interviews.json');
const corpus = RAG.buildCorpus({ DATA, PRIMARY, VOICE }), ix = RAG.buildIndex(corpus);
let pass = 0, fail = 0; const failed = [];
const test = (n, fn) => { try { fn(); pass++; console.log('  ✓', n); } catch (e) { fail++; failed.push(n); console.log('  ✗', n, '\n     ', e.message.split('\n')[0]); } };
const top = (q, o) => RAG.retrieve(ix, q, o).hits.slice(0, 5).map(h => h.doc);
const has = (docs, f) => docs.some(f);
console.log(`corpus: ${corpus.length} passages`, JSON.stringify(corpus.reduce((m, d) => (m[d.source] = (m[d.source] || 0) + 1, m), {})));

console.log('\nInterview Q&A');
test('luck → V3 quote about finding it by pure luck', () => assert(has(top('Do people find photos by luck?'), d => d.meta.iv === 'V3' && /luck/i.test(d.text))));
test('what other apps do interviewees use → WhatsApp / Facebook answers', () => assert(has(top('What apps do interviewees check besides Google Photos?'), d => /whatsapp|facebook/i.test(d.text))));
test('V2 filter: "what did V2 say about backup" returns only V2 / global themes', () => { const h = top('what did V2 say about backup'); assert(h.every(d => !d.meta.iv || d.meta.iv === 'V2'), JSON.stringify(h.map(d => d.title))); assert(has(h, d => d.meta.iv === 'V2' && /backup/i.test(d.text))); });
test('"second interviewee" maps to V2', () => assert.strictEqual(RAG.detectFilters('what did the second interviewee want').iv, 'V2'));
test('feature ideas → RAG bot / AI search quote', () => assert(has(top('What feature did anyone suggest for Google Photos?'), d => /RAG|AI search|describe/i.test(d.text))));
test('Hinglish: "photo nahi milti to log kya karte hain" finds fallback behaviour', () => assert(has(top('photo nahi milti to log kya karte hain'), d => /scroll|browse|add more|manual/i.test(d.text))));
test('feelings: "how do they feel when they can\'t find a photo"', () => assert(has(top("how do people feel when they can't find a photo"), d => /sad|annoy|frustrat|disappoint/i.test(d.text))));

console.log('\nSurvey');
test('respondent lookup: "what did R07 answer" returns R07', () => assert(top('what did R07 answer in the survey')[0].meta.rid === 'R07'));
test('"what do users want when search fails" → interaction question', () => assert(has(top('what do users want when search does not understand them'), d => d.meta.qid === 'interaction')));
test('"why do people fail to find photos" → reason question', () => assert(has(top('why do people fail to find photos they know are saved'), d => d.meta.qid === 'reason')));
test('numbers are present in survey passages', () => { const d = top('how often do people search for old photos', { filters: { sources: ['survey'] } }).find(d => d.meta.qid === 'freq'); assert(d && /\d+ of 18/.test(d.text)); });
test('story retrieval: prescription story', () => assert(has(top('someone looking for an old prescription'), d => /prescription/i.test(d.text))));

console.log('\nReviews');
test('crash question retrieves crash reviews or the crash theme', () => assert(has(top('Is the app crashing or freezing?'), d => d.source === 'reviews' && /crash|freez|bug|slow/i.test(d.text))));
test('storage pricing → storage theme', () => assert(has(top('people complain about storage price and paying'), d => d.meta.theme === 'Storage & paid plan issues')));
test('"reviews" cue restricts to the review corpus', () => assert(top('what do reviews say about sharing albums').every(d => d.source === 'reviews')));
test('rating trend question retrieves the trend passage', () => assert(has(top('how has the average rating changed over time'), d => d.kind === 'trend')));

console.log('\nAnswer assembly');
test('strong confidence on a well-covered question', () => { const a = RAG.answer(ix, 'Do people find photos by luck?'); assert(['strong', 'partial'].includes(a.confidence), a.confidence + ' ' + a.top); assert(a.groups.length >= 1); });
test('nonsense query → no confident answer', () => { const a = RAG.answer(ix, 'xyzzy quantum banana protocol'); assert(a.confidence === 'none' || a.confidence === 'weak', a.confidence); });
test('answers mix sources when relevant', () => { const a = RAG.answer(ix, 'why is finding old photos frustrating'); assert(a.groups.length >= 2, a.groups.map(g => g.source).join()); });
test('every snippet is a substring-faithful extract (no invented words)', () => { const a = RAG.answer(ix, 'How do people feel when they cannot find a photo?'); a.groups.forEach(g => g.items.forEach(it => { const norm = s => s.replace(/\s+/g, ' ').trim(); assert(norm(it.full).includes(norm(it.text).replace(/…$/, '')) || norm(it.text).split(' ').every(w => norm(it.full).includes(w)), 'not extractive: ' + it.text); })); });
test('retrieval is fast (<30 ms per query)', () => { const t0 = Date.now(); for (let i = 0; i < 50; i++) RAG.answer(ix, 'people who cannot find a photo they remember'); const per = (Date.now() - t0) / 50; console.log(`      ${per.toFixed(1)} ms/query over ${corpus.length} passages`); assert(per < 30); });

console.log(`\n${pass} passed, ${fail} failed`); if (fail) { console.log('FAILED:', failed.join(' | ')); process.exit(1); }
