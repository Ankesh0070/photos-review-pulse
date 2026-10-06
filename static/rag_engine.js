/* RAG retrieval for the Photos Review Oracle — extractive, runs entirely in the browser (and in Node for tests).
 *
 *   const corpus = RAG.buildCorpus({ DATA, PRIMARY, VOICE });   // one passage per interview Q&A, survey respondent,
 *   const index  = RAG.buildIndex(corpus);                       // survey question, review quote, theme, …
 *   const ans    = RAG.answer(index, "Do people find photos by luck?");
 *
 * Retrieval = BM25 over stemmed tokens + synonym / Hinglish expansion + bigram boost + source/respondent filters.
 * It never generates text: every sentence it shows is quoted from (or computed from) a real passage, with its source.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RAG = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

/* ---------- text processing ---------- */
const STOP = new Set(('a an the of in on at to for from with without and or but is are was were be been being am it its this that those these there here i me my we our you your he she they them their ' +
  'do does did done have has had will would can could should may might shall what which who whom whose when where why how also just very really about into over under than then so such not no nor only own same too ' +
  'tell show give say said says please explain describe list ask asked anyone anything something someone people ? if as by up out off again further once all any both each few more most other some').split(/\s+/));
// light, consistent stemmer (applied to documents AND queries)
function stem(w) {
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  for (const suf of ['ingly', 'edly', 'ings', 'ing', 'ness', 'ment', 'ed', 'ly', 'es', 's']) if (w.endsWith(suf) && w.length - suf.length >= 3 && !(suf === 's' && w.endsWith('ss'))) return w.slice(0, -suf.length);
  return w;
}
// Hinglish → English (the team writes queries in Hinglish) + common phrasing normalisation
const HINGLISH = { nahi: 'not', nhi: 'not', kyun: 'why', kyu: 'why', kya: 'what', kaise: 'how', kitne: 'many', kitna: 'much', log: 'people', logon: 'people', mil: 'find', mila: 'find', milta: 'find', milti: 'find', milte: 'find', milna: 'find', dhoondh: 'search', dhundh: 'search', dhundhna: 'search', khoj: 'search', khojna: 'search',
  pareshan: 'frustrat', pareshani: 'frustrat', dukhi: 'sad', gussa: 'annoy', yaad: 'remember', yad: 'remember', purani: 'old', purana: 'old', tasveer: 'photo', tasveerein: 'photo', foto: 'photo', shaadi: 'wedding', shadi: 'wedding', safar: 'trip', ghoomna: 'trip', jagah: 'place', tareeka: 'way', madad: 'help', sawal: 'question', jawab: 'answer', kab: 'when', kahan: 'where', kaun: 'who', bahut: 'many', zyada: 'more', kam: 'less', galat: 'wrong', sahi: 'right', dikkat: 'problem', samasya: 'problem', batao: 'tell', bataiye: 'tell', chahiye: 'want', chahte: 'want', pasand: 'like' };
const SYN = {
  find: ['search', 'locate', 'retriev', 'look'], search: ['find', 'query', 'lookup'], fail: ['unable', 'cant', 'couldnt', 'miss', 'unsuccess', 'not found'], failed: ['unable', 'fail'], cant: ['cannot', 'unable', 'fail'], cannot: ['cant', 'unable'], unable: ['cant', 'fail'],
  frustrat: ['annoy', 'sad', 'disappoint', 'upset'], annoy: ['frustrat', 'irritat'], sad: ['disappoint', 'upset', 'frustrat'], feel: ['emotion', 'felt', 'sad', 'annoy'], emotion: ['feel', 'sad', 'annoy'],
  scroll: ['browse', 'timeline', 'manual'], browse: ['scroll', 'timeline'], luck: ['lucky', 'accident', 'serendipity', 'chance'], lucky: ['luck', 'accident'], accident: ['luck', 'chance'],
  wish: ['want', 'feature', 'idea', 'should', 'prefer'], want: ['wish', 'prefer', 'need'], feature: ['idea', 'wish', 'improve'], idea: ['feature', 'wish', 'suggest'], improve: ['better', 'feature', 'fix'],
  photo: ['picture', 'image', 'pic'], picture: ['photo', 'image'], image: ['photo', 'picture'], pic: ['photo'],
  app: ['application', 'google photo'], crash: ['freez', 'bug', 'slow', 'perform'], bug: ['crash', 'error', 'glitch'], slow: ['lag', 'perform'],
  backup: ['sync', 'upload', 'back up', 'cloud'], sync: ['backup', 'upload'], storage: ['space', 'quota', 'full', 'paid', 'plan', 'google one'], pric: ['cost', 'expensive', 'pay', 'paid', 'subscript'], expensive: ['pric', 'cost'],
  delete: ['trash', 'remov', 'lost', 'missing'], missing: ['lost', 'delete', 'gone', 'disappear'], lost: ['missing', 'gone'],
  whatsapp: ['social media', 'other app', 'facebook'], facebook: ['whatsapp', 'social media', 'memories'], remember: ['recall', 'memory', 'vague', 'half'], memory: ['remember', 'recall', 'memories'], vague: ['half', 'fuzzy', 'unsure', 'remember'],
  trust: ['confident', 'believe', 'highlight', 'explain'], confident: ['confidence', 'sure', 'trust'], filter: ['narrow', 'refine'], narrow: ['filter', 'refine', 'broad'],
  library: ['collection', 'photos count'], big: ['large', 'huge'], huge: ['large', 'big', 'too many'], many: ['large', 'huge', 'lot'],
  document: ['receipt', 'prescription', 'screenshot', 'scan', 'id card', 'passport'], screenshot: ['document', 'receipt'],
  describe: ['description', 'natural language', 'words'], description: ['describe', 'natural language'], clarif: ['question', 'ask', 'follow'], ask: ['question', 'clarif'],
  person: ['people', 'face', 'name'], face: ['person', 'people'], date: ['year', 'month', 'time', 'when'], year: ['date', 'time'], place: ['location', 'where'], location: ['place', 'where'],
  edit: ['editor', 'filter', 'crop'], share: ['album', 'link', 'shared'], album: ['share', 'folder'], notification: ['memories', 'remind'], memories: ['notification', 'on this day'],
  survey: ['respondent', 'questionnaire'], respondent: ['survey', 'participant'], interview: ['interviewee', 'call', 'transcript'], interviewee: ['interview', 'voice'] };

function tokenize(s) {
  const out = []; String(s == null ? '' : s).toLowerCase().replace(/[’']s\b/g, '').replace(/[’']/g, '').replace(/[^a-z0-9ऀ-ॿ ]+/g, ' ').split(/\s+/).forEach(w => {
    if (!w) return; w = HINGLISH[w] || w; if (STOP.has(w)) return; if (/^\d{1,2}$/.test(w) && !/^(v|r)?\d+$/.test(w)) return; const st = stem(w); if (st.length > 1 && !STOP.has(st)) out.push(st);
  });
  return out;
}
const bigrams = toks => { const b = []; for (let i = 0; i < toks.length - 1; i++) b.push(toks[i] + ' ' + toks[i + 1]); return b; };

/* ---------- corpus ---------- */
const fmtN = n => Number(n).toLocaleString('en-US');
function buildCorpus({ DATA, PRIMARY, VOICE } = {}) {
  const docs = []; const add = (source, kind, title, text, meta = {}) => docs.push({ id: source[0] + docs.length, source, kind, title, text: String(text).replace(/\s+/g, ' ').trim(), meta });

  if (VOICE) {
    const guide = Object.fromEntries((VOICE.guide || []).map(g => [g.id, g.label]));
    VOICE.interviews.forEach(iv => {
      const p = iv.profile || {};
      add('interview', 'profile', `${iv.id} · profile`, `Interviewee ${iv.id} profile: library ${p.library_label}${p.span_label && p.span_label !== 'not stated' ? ' over ' + p.span_label : ''}; searches ${p.frequency}; last search was ${p.last_item}; struggled to find ${p.struggled_item}; outcome ${p.outcome}; felt ${p.emotion}.`, { iv: iv.id });
      iv.qa.forEach(qa => { if (qa.answer) add('interview', 'qa', `${iv.id} · ${guide[qa.id] || qa.question}`, `${guide[qa.id] || qa.question}. ${iv.id} said: ${qa.answer}`, { iv: iv.id, qid: qa.id, quote: qa.answer, question: guide[qa.id] || qa.question }); });
    });
    (VOICE.themes || []).forEach(t => add('interview', 'theme', `Interview theme · ${t.label}`, `${t.label}. ${t.definition} Raised by ${t.n_interviews} of ${VOICE.meta.interviews} interviewees (${t.n_explicit} explicitly: ${t.interviewees.join(', ')}). ` + t.quotes.map(q => `${q.iv}: ${q.quote}`).join(' '), { theme: t.id, n: t.n_interviews }));
    (VOICE.feature_ideas || []).forEach(f => add('interview', 'idea', `${f.iv} · feature idea`, `Feature idea from ${f.iv}: ${f.idea}. They said: ${f.quote}`, { iv: f.iv, quote: f.quote }));
  }

  if (PRIMARY) {
    const N = PRIMARY.meta.respondents, short = Object.fromEntries(PRIMARY.questions.map(q => [q.id, q.short]));
    PRIMARY.questions.forEach(q => add('survey', 'question', `Survey · ${q.short}`, `${q.text} ${q.short}. Answers from ${N} respondents${q.type === 'multi' ? ' (select up to 3, % of respondents)' : ''}: ` + q.dist.filter(d => d.count > 0).map(d => `${d.label} (${d.count} of ${N}, ${Math.round(d.pct)}%)`).join('; ') + '.', { qid: q.id, dist: q.dist.filter(d => d.count > 0).slice(0, 8) }));
    PRIMARY.highlights.forEach((h, i) => add('survey', 'finding', `Survey finding ${i + 1}`, h, {}));
    const stories = Object.fromEntries((PRIMARY.stories || []).map(s => [s.id, s]));
    (PRIMARY.respondents || []).forEach(r => {
      const parts = []; Object.keys(short).forEach(k => { const v = r[k]; if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) parts.push(`${short[k]}: ${Array.isArray(v) ? v.join(', ') : v}`); });
      const st = stories[r.id]; add('survey', 'respondent', `Survey respondent ${r.id}`, `Respondent ${r.id} answered — ${parts.join('; ')}.` + (st ? ` Their frustrating experience: ${st.text} (outcome: ${st.outcome}).` : ''), { rid: r.id, story: st && st.text });
    });
    const X = PRIMARY.crosstabs || {};
    const line = (rows, lbl) => rows && rows.length ? rows.map(x => `${x.group} ${x.mean_frustration} (n=${x.n})`).join(', ') : '';
    if (X.frustration_by_confidence) add('survey', 'crosstab', 'Survey · frustration by confidence', `Mean frustration (1–5) by how confident respondents are describing a half-remembered photo: ${line(X.frustration_by_confidence)}. Less confident respondents are more frustrated.`, {});
    if (X.frustration_by_failed) add('survey', 'crosstab', 'Survey · frustration by failure frequency', `Mean frustration by how often a known photo could not be found: ${line(X.frustration_by_failed)}.`, {});
    if (X.frustration_by_frequency) add('survey', 'crosstab', 'Survey · frustration by search frequency', `Mean frustration by how often people search: ${line(X.frustration_by_frequency)}.`, {});
  }

  if (DATA) {
    const k = DATA.kpis, T = DATA.themes.filter(t => t.theme !== 'General feedback / other');
    add('reviews', 'overview', 'Reviews · overview', `The review corpus has ${fmtN(k.total)} reviews and posts across ${DATA.meta.platforms} platforms. Average rating ${k.avg_rating} of 5 over ${fmtN(k.rated_count)} rated reviews. ${k.negative_pct}% negative, ${k.positive_pct}% positive, ${k.neutral_pct}% neutral. Top complaint theme: ${k.top_theme} (${fmtN(k.top_theme_volume)} entries).`, {});
    T.forEach((t, i) => {
      const kw = (DATA.top_keywords[t.theme] || []).slice(0, 10).map(x => x.word).join(', '), pm = DATA.theme_platform_matrix[t.theme] || {}, top = Object.entries(pm).sort((a, b) => b[1] - a[1])[0];
      add('reviews', 'theme', `Reviews · ${t.theme}`, `Complaint theme ${t.theme}: ${fmtN(t.volume)} entries, ${t.neg_pct}% negative (${fmtN(t.negative)} negative), severity score ${Math.round(t.severity)}. Most common keywords: ${kw}.${top ? ` Most reports come from ${top[0]} (${fmtN(top[1])} entries).` : ''}`, { theme: t.theme, rank: i + 1 });
      (DATA.theme_citations[t.theme] || []).forEach(c => add('reviews', 'review', `Review · ${t.theme}`, c.content, { theme: t.theme, rating: c.rating, platform: c.platform, date: c.date, thumbs: c.thumbs }));
    });
    DATA.platforms.filter(p => p.negative + p.positive + p.neutral > 0).forEach(p => add('reviews', 'platform', `Reviews · ${p.platform}`, `Platform ${p.platform}: ${fmtN(p.volume)} reviews, ${p.neg_pct}% negative (${fmtN(p.negative)} negative, ${fmtN(p.positive)} positive).`, { platform: p.platform }));
    const tr = DATA.monthly_trend.filter(m => m.avg_rating != null && m.count >= 100); if (tr.length) {
      const hi = tr.reduce((a, b) => b.avg_rating > a.avg_rating ? b : a), lo = tr.reduce((a, b) => b.avg_rating < a.avg_rating ? b : a), last = tr[tr.length - 1];
      add('reviews', 'trend', 'Reviews · rating trend over time', `Average rating over time: highest ${hi.avg_rating} in ${hi.month}; lowest ${lo.avg_rating} in ${lo.month}; latest ${last.avg_rating} in ${last.month}. Review volume has grown sharply since mid-2025, which probably reflects how the data was harvested rather than real usage.`, {});
    }
    add('reviews', 'geo', 'Reviews · countries', 'Top review countries: ' + DATA.top_countries.map(c => `${c.country} (${fmtN(c.count)})`).join(', ') + '. GLOBAL means the source did not capture a country.', {});
    add('reviews', 'versions', 'Reviews · most-flagged app versions', 'Most-flagged app versions by negative reviews: ' + DATA.top_versions.slice(0, 6).map(v => `${v.version} (${v.negative} negative of ${v.total}, ${v.neg_pct}%)`).join('; ') + '.', {});
  }
  return docs;
}

/* ---------- BM25 index ---------- */
function buildIndex(docs) {
  const K1 = 1.4, B = 0.75, post = new Map(), len = [], toks = [];
  docs.forEach((d, i) => { const t = tokenize(d.title + ' ' + d.title + ' ' + d.text); toks.push(t); len.push(t.length); const tf = new Map(); t.forEach(w => tf.set(w, (tf.get(w) || 0) + 1)); tf.forEach((c, w) => { if (!post.has(w)) post.set(w, []); post.get(w).push([i, c]); }); });
  const N = docs.length, avg = len.reduce((a, b) => a + b, 0) / Math.max(1, N);
  const idf = w => { const p = post.get(w); const df = p ? p.length : 0; return Math.log(1 + (N - df + 0.5) / (df + 0.5)); };
  const bg = toks.map(t => new Set(bigrams(t)));
  return { docs, N, avg, post, len, idf, bg, K1, B, toks };
}

/* ---------- retrieval ---------- */
function detectFilters(q) {
  const ql = q.toLowerCase(), f = { sources: null, iv: null, rid: null };
  const s = []; if (/\b(interview|interviews|interviewee|interviewees|voice|transcript|call|called|spoke)\b/.test(ql)) s.push('interview'); if (/\b(survey|respondent|respondents|questionnaire|form)\b/.test(ql)) s.push('survey'); if (/\b(review|reviews|play store|app store|rating|ratings|star|stars|users say|customers)\b/.test(ql)) s.push('reviews');
  if (s.length) f.sources = s;
  const iv = ql.match(/\bv([1-9])\b/) || ql.match(/\binterviewee\s*#?([1-9])\b/); if (iv) { f.iv = 'V' + iv[1]; f.sources = f.sources || ['interview']; }
  const ord = ql.match(/\b(first|second|third)\s+(interviewee|interview|person|caller)\b/); if (ord && !f.iv) { f.iv = 'V' + ({ first: 1, second: 2, third: 3 })[ord[1]]; f.sources = f.sources || ['interview']; }
  const rid = ql.match(/\br(\d{1,2})\b/); if (rid) { f.rid = 'R' + String(rid[1]).padStart(2, '0'); f.sources = f.sources || ['survey']; }
  return f;
}

function retrieve(ix, query, opts = {}) {
  const filters = Object.assign(detectFilters(query), opts.filters || {});
  const base = tokenize(query); const qset = [...new Set(base)];
  // expansion: synonyms count for half weight
  const weights = new Map(); qset.forEach(t => weights.set(t, 1));
  qset.forEach(t => (SYN[t] || []).forEach(s => tokenize(s).forEach(x => { if (!weights.has(x)) weights.set(x, 0.45); })));
  if (!weights.size) return { hits: [], filters, terms: [], maxScore: 0, matched: [] };
  const scores = new Map(), matchedTerms = new Map();
  weights.forEach((wt, term) => {
    const p = ix.post.get(term); if (!p) return; const idf = ix.idf(term);
    for (const [i, tf] of p) { const L = ix.len[i], s = idf * ((tf * (ix.K1 + 1)) / (tf + ix.K1 * (1 - ix.B + ix.B * L / ix.avg))) * wt; scores.set(i, (scores.get(i) || 0) + s); if (wt === 1) { if (!matchedTerms.has(i)) matchedTerms.set(i, new Set()); matchedTerms.get(i).add(term); } }
  });
  const qb = bigrams(base);
  // theoretical per-query ceiling (all terms matched once at tf≈2) used to normalise confidence
  let ceiling = 0; qset.forEach(t => { if (ix.post.has(t)) ceiling += ix.idf(t) * 1.8; }); ceiling = Math.max(ceiling, 1e-6);
  let cand = [...scores].map(([i, s]) => ({ i, s }));
  cand.forEach(c => { let bonus = 0; qb.forEach(b => { if (ix.bg[c.i].has(b)) bonus += 0.25 * Math.max(ix.idf(b.split(' ')[0]), ix.idf(b.split(' ')[1])); }); c.s += bonus; const cover = (matchedTerms.get(c.i) || new Set()).size / Math.max(1, qset.filter(t => ix.post.has(t)).length); c.s *= (0.7 + 0.6 * cover); c.cover = cover; });
  cand = cand.filter(c => { const d = ix.docs[c.i]; if (filters.sources && !filters.sources.includes(d.source)) return false; if (filters.iv && d.meta.iv && d.meta.iv !== filters.iv) return false; if (filters.iv && !d.meta.iv && d.source === 'interview') return opts.keepGlobal !== false && d.kind === 'theme'; if (filters.rid && d.meta.rid && d.meta.rid !== filters.rid) return false; return true; });
  cand.sort((a, b) => b.s - a.s);
  const maxScore = cand.length ? cand[0].s : 0;
  return { hits: cand.slice(0, opts.pool || 40).map(c => ({ doc: ix.docs[c.i], score: c.s, rel: c.s / ceiling, cover: c.cover, matched: [...(matchedTerms.get(c.i) || [])] })), filters, terms: qset, maxScore, ceiling };
}

/* ---------- snippet extraction (best sentences for the question) ---------- */
function snippet(doc, qTerms, max = 300) {
  const text = doc.text; if (text.length <= max) return text;
  const sents = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [text], T = new Set(qTerms);
  const scored = sents.map((s, i) => ({ s: s.trim(), i, sc: tokenize(s).reduce((a, w) => a + (T.has(w) ? 1 : 0), 0) }));
  const best = [...scored].sort((a, b) => b.sc - a.sc || a.i - b.i); let out = [], total = 0;
  for (const b of best) { if (total + b.s.length > max && out.length) break; out.push(b); total += b.s.length + 1; if (total >= max * 0.7) break; }
  return out.sort((a, b) => a.i - b.i).map(x => x.s).join(' ').slice(0, max + 40);
}

/* ---------- answer assembly ---------- */
const SOURCE_LABEL = { interview: 'Voice interviews', survey: 'Survey', reviews: 'Reviews' };
function answer(ix, query, opts = {}) {
  const r = retrieve(ix, query, opts), k = opts.k || 6;
  const strongest = r.hits[0] ? r.hits[0].rel : 0;
  const confidence = !r.hits.length ? 'none' : strongest >= 0.42 ? 'strong' : strongest >= 0.2 ? 'partial' : 'weak';
  // diversity: at most 3 per source; pull in a second source only if it is reasonably close to the top
  const per = { interview: [], survey: [], reviews: [] }, chosen = [];
  for (const h of r.hits) { const g = per[h.doc.source]; if (g.length >= 3) continue; if (chosen.length >= k) break; if (chosen.length && h.rel < strongest * 0.45) continue; if (g.length && h.rel < strongest * 0.35) continue; g.push(h); chosen.push(h); }
  // avoid showing the generic theme summary 3 times when we already have its quotes
  const groups = ['interview', 'survey', 'reviews'].map(s => ({ source: s, label: SOURCE_LABEL[s], items: per[s].map(h => ({ title: h.doc.title, kind: h.doc.kind, text: snippet(h.doc, r.terms), full: h.doc.text, meta: h.doc.meta, rel: +h.rel.toFixed(3), matched: h.matched })) })).filter(g => g.items.length);
  return { query, confidence, groups, filters: r.filters, terms: r.terms, top: strongest, hits: r.hits.length, corpus: ix.N };
}

return { tokenize, stem, buildCorpus, buildIndex, retrieve, answer, snippet, detectFilters, SYN, HINGLISH, SOURCE_LABEL };
});
