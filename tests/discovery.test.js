// Invariants for the discovery engine output (static/discovery.json). Run: node tests/discovery.test.js
const assert = require('assert'); const path = require('path');
const D = require(path.join(__dirname, '..', 'static', 'discovery.json'));
let pass = 0; const t = (n, f) => { try { f(); pass++; console.log('ok  ', n); } catch (e) { console.error('FAIL', n, '-', e.message); process.exitCode = 1; } };

t('twelve questions each with headline, findings, evidence, sources, caveat', () => {
  assert.strictEqual(D.questions.length, 12);
  D.questions.forEach(q => { assert(q.headline && q.findings.length && q.sources && q.caveat, q.id); });
});
t('counts are consistent', () => {
  const m = D.meta; assert(m.retrieval_store <= m.store_english); assert(m.retrieval_community <= m.community_english);
  assert(m.store_english + m.community_english <= m.reviews_english_analysed + 1);
  assert(m.survey_n === 18 && m.interviews_n === 3);
});
t('opportunity scores in [0,1], ranks sequential, sorted descending', () => {
  D.opportunities.forEach((o, i) => { assert(o.score >= 0 && o.score <= 1, o.id); assert.strictEqual(o.rank, i + 1); if (i) assert(o.score <= D.opportunities[i - 1].score + 1e-9); });
});
t('component weights sum to 1', () => {
  const s = Object.values(D.meta.weights).reduce((a, b) => a + b, 0); assert(Math.abs(s - 1) < 1e-6, String(s));
});
t('summary mirrors the opportunity ranking and has limits', () => {
  D.summary.top_opportunities.forEach((o, i) => assert.strictEqual(o.label, D.opportunities[i].label));
  assert(D.summary.one_liner && D.summary.bullets.length && D.summary.limits.length);
});
t('evidence quotes carry no emails / phone numbers / URLs', () => {
  const bad = /[\w.+-]+@[\w-]+\.[\w.]+|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|https?:\/\//i;
  D.questions.forEach(q => q.evidence.forEach(e => assert(!bad.test(e.text), q.id + ': ' + e.text.slice(0, 40))));
});
t('every evidence quote is non-empty with a platform', () => {
  D.questions.forEach(q => q.evidence.forEach(e => { assert(e.text && e.text.length > 10); assert(e.platform); }));
});
console.log(pass + ' passed');
