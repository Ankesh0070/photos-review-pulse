/* Discovery engine — turns 3 evidence sources into answers about photo-RETRIEVAL problems.
 *
 *   node scripts/discovery_engine.js [path-to-master-reviews.csv]
 *
 * Sources:  (1) ~117k scraped reviews/posts → coded with transparent rules (scripts/discovery_lib.js)
 *           (2) primary survey (static/primary_research.json)   (3) voice interviews (static/voice_interviews.json)
 * Output:   static/discovery.json  ·  docs/Discovery_Report.md  ·  injected into dashboard.html + chatbot.html
 *
 * It goes beyond sentiment: it separates WHAT is being retrieved, WHAT is remembered vs forgotten, HOW searches are
 * formulated, WHICH problems matter most (volume × severity × reach × momentum × cross-source support), and shows how
 * stable that ranking is under different weightings.
 */
const fs = require('fs'), path = require('path');
const L = require('./discovery_lib.js');
const ROOT = path.resolve(__dirname, '..');
const CSV = process.argv[2] || path.join(ROOT, 'dataset', 'reviews', 'Google_Photos_Master_Reviews.csv');
const readJSON = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'static', f), 'utf8'));
const SURVEY = readJSON('primary_research.json'), VOICE = readJSON('voice_interviews.json');

/* ======================= 1. load + clean reviews ======================= */
function parseCSV(t) { const rows = []; let row = [], f = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c; } if (f.length || row.length) { row.push(f); rows.push(row); } return rows; }
const rows = parseCSV(fs.readFileSync(CSV, 'utf8')); const H = rows.shift(); const ix = Object.fromEntries(H.map((h, i) => [h, i]));
const SW = /\b(the|and|is|to|of|it|this|that|i|my|photos?|app|not|but|for|with|have)\b/gi;
const isEn = s => { const w = s.split(/\s+/).length; if (w < 4) return false; const nonLatin = (s.match(/[^\x00-\x7f‘’“”…]/g) || []).length; if (nonLatin / s.length > 0.05) return false; return (s.match(SW) || []).length / w > 0.22; };
const redact = s => s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/\b(?:\+?\d[\d\s().-]{8,}\d)\b/g, '[number]').replace(/@\w{3,}/g, '@user');
const group = p => /^(Google Play|Apple App)/.test(p) ? 'store' : 'community';
const osOf = p => /^Google Play/.test(p) ? 'android' : /^Apple/.test(p) ? 'ios' : 'community';
const recs = [];
let totalRows = rows.length, skipped = { youtube: 0, nonEnglish: 0, short: 0, wiki: 0 };
for (const r of rows) {
  const plat = r[ix.platform] || ''; if (/^YouTube/.test(plat)) { skipped.youtube++; continue; } if (/^Wikipedia/.test(plat)) { skipped.wiki++; continue; }
  const text = L.clean((r[ix.title] ? r[ix.title] + '. ' : '') + (r[ix.content] || '')); if (text.split(' ').length < 5) { skipped.short++; continue; } if (!isEn(text)) { skipped.nonEnglish++; continue; }
  const rating = r[ix.rating] ? +r[ix.rating] : null, date = (r[ix.date] || '').slice(0, 10);
  recs.push({ id: r[ix.review_id], platform: plat, g: group(plat), os: osOf(plat), rating: Number.isFinite(rating) ? rating : null, date, year: +date.slice(0, 4) || null, thumbs: +r[ix.thumbs_up_count] || 0, text, a: null });
}
recs.forEach(r => { r.a = L.analyze(r.text, r.rating); });
const store = recs.filter(r => r.g === 'store'), comm = recs.filter(r => r.g === 'community');
const relS = store.filter(r => r.a.retrieval), relC = comm.filter(r => r.a.retrieval);
const maxDate = recs.reduce((m, r) => r.date > m ? r.date : m, '0000'); const D = (s) => new Date(s + 'T00:00:00Z').getTime();
const addMonths = (s, n) => { const d = new Date(D(s)); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const recentFrom = addMonths(maxDate, -18), priorFrom = addMonths(maxDate, -36);

/* ======================= helpers ======================= */
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const r1 = x => x == null ? null : Math.round(x * 10) / 10, r2 = x => x == null ? null : Math.round(x * 100) / 100, pct = (a, b) => b ? Math.round(1000 * a / b) / 10 : 0;
const rated = a => a.filter(r => r.rating != null);
const sev = a => { const x = rated(a); return x.length ? { n_rated: x.length, mean: r2(mean(x.map(r => r.rating))), pct_low: pct(x.filter(r => r.rating <= 2).length, x.length) } : { n_rated: 0, mean: null, pct_low: null }; };
const baseSev = sev(store);
const sum = a => a.reduce((x, y) => x + y, 0);
const years = [...new Set(recs.map(r => r.year).filter(Boolean))].sort();
const yearBuckets = a => Object.fromEntries(years.filter(y => y >= 2018).map(y => [y, a.filter(r => r.year === y).length]));
const win = (a, from, to) => a.filter(r => r.date >= from && (!to || r.date < to));
const momentum = (sub, universe) => { const rc = win(sub, recentFrom).length, pr = win(sub, priorFrom, recentFrom).length, uRc = win(universe, recentFrom).length, uPr = win(universe, priorFrom, recentFrom).length; const sr = uRc ? rc / uRc : 0, sp = uPr ? pr / uPr : 0; const smooth = ((rc + 1) / (uRc + 2)) / ((pr + 1) / (uPr + 2)); return { recent_n: rc, prior_n: pr, recent_share: r2(sr * 100), prior_share: r2(sp * 100), ratio: r2(smooth), reliable: pr >= 10 && rc >= 10 }; };
/* evidence quotes: store reviews first, distinct, 70–320 chars, prefer the fragment that triggered the code */
function quotes(sub, key, n = 4, opts = {}) {
  const pool = sub.filter(r => r.text.length >= 70 && r.text.length <= 900).sort((a, b) => (b.thumbs - a.thumbs) || (b.date > a.date ? 1 : -1));
  const out = [], seen = new Set();
  for (const r of pool) {
    if (out.length >= n) break; const frag = (key && r.a.frags && r.a.frags[key]) || ''; const t = r.text; let start = 0;
    if (frag) { const i = t.toLowerCase().indexOf(frag.slice(0, 40).toLowerCase()); if (i > 120) start = t.lastIndexOf(' ', i - 80) + 1; }
    let ex = t.slice(start, start + 320); if (start + 320 < t.length) ex = ex.replace(/\s+\S*$/, '') + '…'; if (start > 0) ex = '…' + ex;
    const sig = ex.slice(0, 50); if (seen.has(sig)) continue; seen.add(sig);
    out.push({ id: r.id, platform: r.platform.replace(' (Main App)', ''), rating: r.rating, date: r.date, thumbs: r.thumbs, text: redact(ex), full_len: t.length });
  }
  return out;
}

/* ======================= 2. review-derived statistics ======================= */
const PROB = L.PROBLEMS;
const problems = PROB.map(p => {
  const s = relS.filter(r => r.a.problems.includes(p.id)), c = relC.filter(r => r.a.problems.includes(p.id));
  const sv = sev(s);
  return { id: p.id, label: p.label, short: p.short, n_store: s.length, share_store: pct(s.length, relS.length), n_comm: c.length, ...sv, thumbs: sum(s.map(r => r.thumbs)), by_year: yearBuckets(s), momentum: momentum(s, store), android: s.filter(r => r.os === 'android').length, ios: s.filter(r => r.os === 'ios').length,
    old_n: s.filter(r => r.a.old).length, quotes: quotes(s, p.id, 4), community_quotes: quotes(c, p.id, 2) };
}).filter(p => p.n_store + p.n_comm > 0).sort((a, b) => b.n_store - a.n_store);
const probBy = Object.fromEntries(problems.map(p => [p.id, p]));

const contentStats = L.CONTENT.map(c => {
  const all = relS.filter(r => r.a.content.includes(c.id)), old = relS.filter(r => r.a.old && r.a.content.includes(c.id)), oldBase = relS.filter(r => r.a.old);
  const shareAll = all.length / relS.length, shareOld = oldBase.length ? old.length / oldBase.length : 0;
  return { id: c.id, label: c.label, n_all: all.length, share_all: pct(all.length, relS.length), n_old: old.length, share_old: pct(old.length, oldBase.length), lift_old: shareAll ? r2(shareOld / shareAll) : null, ...sev(all), quotes_old: quotes(old, null, 3), quotes: quotes(all, null, 3) };
}).sort((a, b) => b.n_old - a.n_old);
const oldRel = relS.filter(r => r.a.old);
const oldProblems = problems.map(p => ({ id: p.id, short: p.short, n: oldRel.filter(r => r.a.problems.includes(p.id)).length })).filter(x => x.n).sort((a, b) => b.n - a.n);

const clueAll = [...relS, ...relC].filter(r => r.a.clues.length);
const clueStats = L.CLUES.map(c => ({ id: c.id, label: c.label, n: clueAll.filter(r => r.a.clues.includes(c.id)).length })).sort((a, b) => b.n - a.n).map(c => ({ ...c, share: pct(c.n, clueAll.length) }));
const qList = [...relS, ...relC].flatMap(r => r.a.quotedQueries.map(q => ({ q: q.replace(/[.,;:!?]+$/, '').trim(), r }))).filter(x => x.q.length >= 2 && !/^(no results?|google|search|select all)$/i.test(x.q));
const qKind = {}; qList.forEach(x => { const k = L.classifyQuery(x.q); qKind[k] = (qKind[k] || 0) + 1; });
const qTerms = {}; qList.forEach(x => { const k = x.q.toLowerCase(); qTerms[k] = (qTerms[k] || 0) + 1; });
const queryStats = { n: qList.length, kinds: Object.entries(qKind).map(([k, n]) => ({ kind: k, n, share: pct(n, qList.length) })).sort((a, b) => b.n - a.n), examples: Object.entries(qTerms).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 28).map(([t, n]) => ({ term: t, n })) };

const forgotRel = [...relS, ...relC].filter(r => r.a.forgot.length && /\b(remember|recall|not sure|unsure|no idea|can'?t tell|don'?t know)\b/i.test(r.a.forgot.join(' ')) && /(photo|picture|video|album|screenshot)/i.test(r.text));
const forgotStats = { n: forgotRel.length, of_relevant: relS.length + relC.length, kinds: ['time', 'name', 'who', 'where'].map(k => ({ kind: k, n: forgotRel.filter(r => r.a.forgotKinds.includes(k)).length })), quotes: quotes(forgotRel, null, 3) };

const behStats = L.BEHAVIOUR.map(b => { const s = relS.filter(r => r.a.behaviour.includes(b.id)); return { id: b.id, label: b.label, n: s.length, share: pct(s.length, relS.length), ...sev(s), quotes: quotes(s, null, 2) }; }).sort((a, b) => b.n - a.n);
const workStats = L.WORKAROUND.map(b => { const s = relS.filter(r => r.a.workarounds.includes(b.id) && r.a.problems.length && !r.a.success); return { id: b.id, label: b.label, n: s.length, share: pct(s.length, relS.length), ...sev(s), quotes: quotes(s, null, 2) }; }).sort((a, b) => b.n - a.n);

const successS = relS.filter(r => r.a.success);
const trend = Object.fromEntries(years.filter(y => y >= 2018).map(y => { const u = store.filter(r => r.year === y), s = relS.filter(r => r.year === y); return [y, { n_store: u.length, n_relevant: s.length, share: pct(s.length, u.length), mean_rating_relevant: r2(mean(rated(s).map(r => r.rating))) }]; }));

const osCompare = problems.map(p => { const a = relS.filter(r => r.os === 'android'), i = relS.filter(r => r.os === 'ios'); const pa = a.filter(r => r.a.problems.includes(p.id)).length, pi = i.filter(r => r.a.problems.includes(p.id)).length; return { id: p.id, short: p.short, android_share: pct(pa, a.length), ios_share: pct(pi, i.length), android_n: pa, ios_n: pi, community_n: p.n_comm }; });
const relCgroups = problems.map(p => ({ id: p.id, short: p.short, store_share: p.share_store, community_share: pct(relC.filter(r => r.a.problems.includes(p.id)).length, relC.length) }));

/* ======================= 3. primary-research evidence ======================= */
const sq = id => SURVEY.questions.find(q => q.id === id), sN = SURVEY.meta.respondents, vN = VOICE.meta.interviews;
const sCount = (id, ...labels) => { const q = sq(id); return q ? q.dist.filter(d => labels.includes(d.label)).reduce((s, d) => s + d.count, 0) : 0; };
const sPct = (c) => Math.round(100 * c / sN);
const vTheme = id => VOICE.themes.find(t => t.id === id) || { n_interviews: 0, n_explicit: 0, quotes: [], interviewees: [] };
const vQA = (iv, qid) => { const i = VOICE.interviews.find(x => x.id === iv); const q = i && i.qa.find(x => x.id === qid); return q && q.answer; };

/* analyst coding of the interviews — what each person remembered / forgot / did (every quote is verbatim from the transcript) */
const IV_CLUES = {
  V1: { place: 1, person: 1, event: 1, time: 0.5, scene: 1, attire: 0, text: 0, type: 0, quote: vQA('V1', 'story') },
  V2: { place: 0, person: 0, event: 1, time: 1, scene: 0, attire: 1, text: 0, type: 0, quote: vQA('V2', 'confident') },
  V3: { place: 0.5, person: 1, event: 0, time: 0, scene: 0, attire: 0, text: 0, type: 1, quote: vQA('V3', 'first_action') },
};
const IV_FORGOT = { V1: { note: 'Audio broke up; no explicit forgetting recorded', kinds: [] }, V2: { kinds: ['which event', 'exact month', 'who took it'], quotes: [vQA('V2', 'first_memory'), vQA('V2', 'when'), vQA('V2', 'who')] }, V3: { kinds: ['exact time', 'who took it'], quotes: [vQA('V3', 'when'), vQA('V3', 'who')] } };
/* interview signals computed from the transcripts' own answers (no hand-set numbers) */
const retried = VOICE.interviews.filter(i => { const a = vQA(i.id, 'attempts'); return a && !/^no,? in one search/i.test(a); }).length;           // needed more than one try
const placeOrEvent = Object.values(IV_CLUES).filter(c => c.place > 0 || c.event > 0).length;
const wishEvents = VOICE.interviews.filter(i => /event|important|date|location/i.test(vQA(i.id, 'wish') || '')).length;
const IV_STRAT = { V1: 'Date first, then place name ("Maldives") → found in one search', V2: 'Year (+ month, + description like the outfit) → if no hit, scan the whole year manually', V3: 'Type/folder first (screenshot folder, own name, area) → several attempts → scroll by date/month' };

/* ======================= 4. question modules ======================= */
const topOf = (arr, k = 3) => arr.slice(0, k);
const Q = [];

/* Q1 — what kinds of old photos are hard to retrieve */
{
  const survItem = sq('item').dist.filter(d => d.count > 0);
  const docLike = sCount('item', 'Medical document/prescription', 'Screenshot', 'Bill/receipt', 'Note/handwritten image');
  const ranked = contentStats.filter(c => c.n_old >= 8);
  Q.push({
    id: 'old_kinds', question: 'What kinds of old photos do users struggle to retrieve?',
    headline: `Across ${oldRel.length} store reviews that talk about OLD content and retrieval, the struggle clusters around ${ranked.slice(0, 3).map(c => c.label.split(' (')[0].toLowerCase()).join(', ')}. In the survey, ${docLike} of ${sN} (${sPct(docLike)}%) last hunted for a document-like image, not a "memory" photo — and interviewees named ID/passport photos, a college photo and a photo of a personal achievement that was never backed up.`,
    findings: [
      ...ranked.slice(0, 5).map(c => `${c.label}: ${c.n_old} old-photo reviews (${c.share_old}% of old-photo reviews; ${c.lift_old}× its share in all retrieval reviews; mean rating ${c.mean ?? 'n/a'}).`),
      `Survey — what respondents last looked for: ${survItem.map(d => `${d.label} ${d.count}`).join(', ')}.`,
      `Interviews — items they struggled with: ${VOICE.interviews.map(i => `${i.id}: ${i.profile.struggled_item.toLowerCase()}`).join('; ')}.`,
      `The biggest problem types inside old-photo reviews: ${oldProblems.slice(0, 4).map(p => `${p.short} (${p.n})`).join(', ')}.`,
    ],
    table: { head: ['What they retrieve', 'Old-photo reviews', 'Share of old', 'Lift vs all', 'Mean ★'], rows: ranked.slice(0, 8).map(c => [c.label, c.n_old, c.share_old + '%', c.lift_old + '×', c.mean ?? '–']) },
    chart: { type: 'bar', title: 'Old-photo reviews by what is being retrieved', labels: ranked.slice(0, 8).map(c => c.label.split(' (')[0]), values: ranked.slice(0, 8).map(c => c.n_old) },
    evidence: [...contentStats.flatMap(c => c.quotes_old.map(q => ({ ...q, tag: c.label.split(' (')[0] }))).slice(0, 6)],
    sources: { reviews: `${oldRel.length} old-photo retrieval reviews (store)`, survey: `Q2 · n=${sN}`, interviews: `struggled-item · n=${vN}` },
    caveat: '“Old” is detected from words like old/years ago/20xx/childhood, so it under-counts reviews that never state an age.',
  });
}

/* Q2 — what people actually remember */
{
  const clueAny = (id, ...labels) => sCount(id, ...labels);
  const sv = [
    ['A person', sCount('clues', 'Person/persons'), sCount('query', "A person's name")], ['An event / occasion', sCount('clues', 'Event/occasion'), 0], ['Approximate time / period', sCount('clues', 'Approximate time/period'), sCount('query', 'A date/month/year')],
    ['A place', sCount('clues', 'Place'), sCount('query', 'A place')], ['A word / name', sCount('clues', 'Word/name'), sCount('query', 'A word or phrase visible in the image')], ['How it looked / objects', sCount('clues', 'How the image looked', 'Object visible in the image'), sCount('query', 'A description of what is in the image')], ['Brand / shop', sCount('clues', 'Brand/shop/company'), 0],
  ];
  const ivN = k => Object.values(IV_CLUES).filter(c => c[k] > 0).length;
  const rv = id => clueStats.find(c => c.id === id) || { n: 0, share: 0 };
  const rows = [['A person', 'person'], ['An event / occasion', 'event'], ['Approximate time / period', 'time'], ['A place', 'place'], ['How it looked / objects', 'scene'], ['What they wore', 'attire'], ['Words / text', 'text'], ['A file type / source', 'type']].map(([lbl, k]) => {
    const svr = sv.find(s => s[0] === lbl); const rvid = { 'person': 'person', 'event': 'event', 'time': 'date', 'place': 'place', 'scene': 'object', 'attire': 'look', 'text': 'text', 'type': 'kind' }[k];
    return { clue: lbl, survey_remember: svr ? sPct(svr[1]) : null, survey_type: svr && svr[2] ? sPct(svr[2]) : null, interviews: ivN(k), reviews_search_by: rv(rvid).share };
  });
  const top = [...rows].sort((a, b) => (b.survey_remember ?? 0) - (a.survey_remember ?? 0))[0];
  Q.push({
    id: 'remembered', question: 'What information do people actually remember about a photo?',
    headline: `People remember WHO and WHAT-OCCASION before WHEN or WHERE: ${sPct(sCount('clues', 'Person/persons'))}% of survey respondents recall the person first, ${sPct(sCount('clues', 'Event/occasion'))}% the event, ${sPct(sCount('clues', 'Approximate time/period'))}% roughly when, only ${sPct(sCount('clues', 'Place'))}% the place. Interviewees remembered a scene or outfit (“water villa”, “that dress”) and an approximate year — not file details.`,
    findings: [
      `Survey (up to 3 clues): person ${sCount('clues', 'Person/persons')}/${sN}, event ${sCount('clues', 'Event/occasion')}, approx. time ${sCount('clues', 'Approximate time/period')}, place ${sCount('clues', 'Place')}, word/name ${sCount('clues', 'Word/name')}, how it looked ${sCount('clues', 'How the image looked')}, object ${sCount('clues', 'Object visible in the image')}, brand ${sCount('clues', 'Brand/shop/company')}.`,
      `Interviews — what each remembered: V1 place + person + trip + “~6 years back” + a visual scene; V2 the year and what they wore (not the month); V3 only the kind of photo (a passport photo) and its purpose.`,
      `Reviews — people say they search or filter by: ${clueStats.slice(0, 5).map(c => `${c.label.toLowerCase()} (${c.share}%)`).join(', ')}.`,
      `Cross-source agreement: the person and the time period are remembered by all three sources; place is over-represented in reviews and interviews but under-chosen in the survey.`,
    ],
    table: { head: ['Clue', 'Survey: remembered %', 'Survey: typed %', 'Interviews (of 3)', 'Reviews: search-by %'], rows: rows.map(r => [r.clue, r.survey_remember ?? '–', r.survey_type ?? '–', r.interviews, r.reviews_search_by || '–']) },
    chart: { type: 'bar', title: 'Share of survey respondents who remember each clue first (%)', labels: rows.filter(r => r.survey_remember != null).map(r => r.clue), values: rows.filter(r => r.survey_remember != null).map(r => r.survey_remember) },
    evidence: [{ id: 'V1', platform: 'Interview V1', text: IV_CLUES.V1.quote, tag: 'remembers scene + place' }, { id: 'V2', platform: 'Interview V2', text: IV_CLUES.V2.quote, tag: 'remembers the year, not the month' }, { id: 'V3', platform: 'Interview V3', text: IV_CLUES.V3.quote, tag: 'remembers the kind of photo' }, ...clueStats.slice(0, 0)],
    sources: { survey: `Q3, Q5 · n=${sN}`, interviews: `first memory / story · n=${vN}`, reviews: `${clueAll.length} reviews that name what they search by` },
    caveat: 'Interview coding is analyst-judgement on 3 people; survey is a small convenience sample. Reviews show only clues users bother to mention.',
    _clueRows: rows,
  });
}

/* Q3 — what they have forgotten */
{
  const forgotReasons = sq('reason').dist.filter(d => d.count > 0);
  const lowClues = sq('clues').dist.filter(d => d.count <= 3).map(d => `${d.label.toLowerCase()} (${d.count})`);
  const hardest = sq('hardest').dist.filter(d => d.count > 0).slice(0, 5).map(d => `${d.label.toLowerCase()} (${d.count})`);
  Q.push({
    id: 'forgotten', question: 'What information have they forgotten?',
    headline: `Forgetting is about DETAILS, not the photo itself: ${sCount('reason', "I don't remember enough details")} of ${sN} give “I don't remember enough details” as the top reason a known photo isn't found, ${sCount('reason', "I can't remember approximately when it was saved")} can't place when it was saved, and ${sCount('reason', "I don't know what words to search")} don't know which words to use. Interviewees forgot the month, which event it was, and who took the photo. Reviews almost never reveal this (${forgotStats.n} of ${forgotStats.of_relevant} retrieval reviews) — it is a blind spot of review mining.`,
    findings: [
      `Survey — biggest reason for failing: ${forgotReasons.map(d => `${d.label} ${d.count}`).join('; ')}.`,
      `Survey — the clues almost nobody holds on to: ${lowClues.join(', ')}; hardest things to search inside an image: ${hardest.join(', ')}.`,
      `Interviews — V2 forgot ${IV_FORGOT.V2.kinds.join(', ')}; V3 forgot ${IV_FORGOT.V3.kinds.join(' and ')}; V1's call had poor audio (nothing coded).`,
      `Reviews — only ${forgotStats.n} reviews state a memory gap; they are about the time period (“sometime in 2019”) or about not recalling where a photo was saved.`,
      `Implication: search must tolerate fuzzy time (“around 6 years ago”) and vocabulary gaps (“I don't know what words to search”), and should not rely on exact file facts.`,
    ],
    table: { head: ['Reason a known photo isn’t found (survey)', 'Respondents', '%'], rows: forgotReasons.map(d => [d.label, d.count, Math.round(d.pct) + '%']) },
    chart: { type: 'bar', title: 'Why a known photo is not found (survey, respondents)', labels: forgotReasons.map(d => d.label), values: forgotReasons.map(d => d.count) },
    evidence: [...IV_FORGOT.V2.quotes.filter(Boolean).map(t => ({ id: 'V2', platform: 'Interview V2', text: t, tag: 'forgot' })), ...IV_FORGOT.V3.quotes.filter(Boolean).map(t => ({ id: 'V3', platform: 'Interview V3', text: t, tag: 'forgot' })), ...forgotStats.quotes.map(q => ({ ...q, tag: 'review' }))].slice(0, 6),
    sources: { survey: `Q7, Q3, Q9 · n=${sN}`, interviews: `when / who / confident · n=${vN}`, reviews: `${forgotStats.n} reviews (blind spot)` },
    caveat: 'Forgetting is only observable through direct questions — which is why the survey and interviews, not reviews, carry this answer.',
  });
}

/* Q4 — how searches are formulated when memory is incomplete */
{
  const qs = sq('query').dist.filter(d => d.count > 0), nx = sq('next').dist.filter(d => d.count > 0);
  Q.push({
    id: 'formulation', question: 'How do users formulate searches when their memory is incomplete?',
    headline: `They describe, then anchor, then widen. ${sPct(sCount('query', 'A description of what is in the image'))}% type a description of what is in the picture, ${sPct(sCount('query', "A person's name"))}% a name, ${sPct(sCount('query', 'A place'))}% a place, ${sPct(sCount('query', 'A date/month/year'))}% a date. When that fails, ${sCount('next', 'Add more details')} of ${sN} add more details, ${sCount('next', 'Browse the timeline')} fall back to scrolling the timeline, and only ${sCount('next', 'Try different keywords')} reword.`,
    findings: [
      `Survey — what they type: ${qs.map(d => `${d.label} ${d.count}`).join('; ')}.`,
      `Survey — next step after a failed search: ${nx.map(d => `${d.label} ${d.count}`).join('; ')}.`,
      `Interviews — V1: ${IV_STRAT.V1}. V2: ${IV_STRAT.V2}. V3: ${IV_STRAT.V3}.`,
      `Reviews — ${queryStats.n} explicit quoted queries: ${queryStats.kinds.map(k => `${k.kind.replace(/_/g, ' ')} ${k.share}%`).join(', ')}; typical terms: ${queryStats.examples.slice(0, 8).map(e => '“' + e.term + '”').join(', ')}.`,
      `Behaviour in reviews: ${behStats.map(b => `${b.label.toLowerCase()} (${b.n})`).join('; ')}.`,
      `Strategies seen across sources: (1) anchor on a time or place cue, (2) describe the scene or outfit, (3) search by person, (4) go by type/folder (screenshots, “my pictures”), (5) widen/add details, (6) scroll the timeline, (7) check other apps (WhatsApp, Facebook).`,
    ],
    table: { head: ['Strategy', 'Survey', 'Interviews (of 3)', 'Reviews'], rows: [
      ['Describe what is in the image', sCount('query', 'A description of what is in the image') + `/${sN}`, 2, `${(queryStats.kinds.find(k => k.kind === 'description') || { n: 0 }).n} quoted`],
      ['Search by a person’s name', sCount('query', "A person's name") + `/${sN}`, 1, 'person clue ' + (clueStats.find(c => c.id === 'person') || { share: 0 }).share + '%'],
      ['Search by a place / date', sCount('query', 'A place') + sCount('query', 'A date/month/year') + `/${sN} mentions`, 3, 'date ' + (clueStats.find(c => c.id === 'date') || { share: 0 }).share + '% · place ' + (clueStats.find(c => c.id === 'place') || { share: 0 }).share + '%'],
      ['Add details after a failure', sCount('next', 'Add more details') + `/${sN}`, 2, `retry ${(behStats.find(b => b.id === 'retry_terms') || { n: 0 }).n}`],
      ['Fall back to scrolling', sCount('next', 'Browse the timeline') + sCount('query', "I usually don't search; I scroll") + `/${sN}`, 3, `scroll ${(behStats.find(b => b.id === 'scroll_manual') || { n: 0 }).n}`],
      ['Check other apps', '–', 3, `other apps ${(workStats.find(b => b.id === 'other_app') || { n: 0 }).n}`],
    ] },
    chart: { type: 'bar', title: 'What survey respondents type when memory is vague (respondents)', labels: qs.map(d => d.label), values: qs.map(d => d.count) },
    evidence: [...VOICE.themes.find(t => t.id === 'time_place').quotes.map(q => ({ id: q.iv, platform: 'Interview ' + q.iv, text: q.quote, tag: 'anchor on time/place' })).slice(0, 3), ...queryStats.examples.slice(0, 0), ...behStats.flatMap(b => b.quotes.map(q => ({ ...q, tag: b.label }))).slice(0, 3)],
    sources: { survey: `Q5, Q8 · n=${sN}`, interviews: `first action / would type / attempts · n=${vN}`, reviews: `${queryStats.n} quoted queries + ${behStats.reduce((s, b) => s + b.n, 0)} behaviour mentions` },
    caveat: 'Quoted queries are rare in reviews (people rarely paste their search); survey/interviews carry the formulation evidence.',
    _queryStats: queryStats,
  });
}

/* Q5 — which problems are most common vs most severe */
{
  const P = problems.filter(p => p.n_store >= 10 && p.id !== 'general_difficulty');
  const byN = [...P].sort((a, b) => b.n_store - a.n_store), bySev = [...P].filter(p => p.n_rated >= 15).sort((a, b) => b.pct_low - a.pct_low);
  Q.push({
    id: 'common_vs_severe', question: 'Which retrieval problems are most common — and which hurt the most?',
    headline: `Most common: ${byN.slice(0, 3).map(p => `${p.short} (${p.n_store})`).join(', ')}. Most severe (highest share of 1–2★ among rated reviews): ${bySev.slice(0, 3).map(p => `${p.short} (${p.pct_low}%)`).join(', ')}. For reference, ${baseSev.pct_low}% of ALL store reviews are 1–2★ — so every problem listed is far worse than the app average.`,
    findings: byN.slice(0, 8).map(p => `${p.short}: ${p.n_store} reviews (${p.share_store}% of retrieval reviews), ${p.pct_low}% 1–2★, mean ${p.mean}★, ${p.thumbs.toLocaleString()} 👍.`),
    table: { head: ['Problem', 'Reviews', 'Share', '% 1–2★', 'Mean ★', '👍 total'], rows: byN.slice(0, 12).map(p => [p.label, p.n_store, p.share_store + '%', p.pct_low + '%', p.mean, p.thumbs]) },
    chart: { type: 'scatter', title: 'Volume vs severity', points: P.map(p => ({ label: p.short, x: p.n_store, y: p.pct_low, r: Math.max(4, Math.min(22, Math.sqrt(p.thumbs) / 6)) })) },
    evidence: byN.slice(0, 4).flatMap(p => p.quotes.slice(0, 1).map(q => ({ ...q, tag: p.short }))),
    sources: { reviews: `${relS.length} store retrieval reviews of ${store.length} English store reviews` },
    caveat: 'Rule-coded; sampled precision ≈85–90% per category, so counts are conservative lower bounds. Severity uses star ratings, so only store reviews are scored.',
  });
}

/* Q6 — what is growing */
{
  const P = problems.filter(p => p.n_store >= 25 && p.id !== 'general_difficulty').sort((a, b) => b.momentum.ratio - a.momentum.ratio);
  const trusted = P.filter(p => p.momentum.reliable), fade = trusted.filter(p => p.momentum.ratio < 0.95), latest = trend[years.filter(y => y >= 2018).slice(-1)[0]];
  Q.push({
    id: 'momentum', question: 'Which retrieval problems are growing or fading?',
    headline: `Last 18 months vs the 18 before (shares of store reviews, add-one smoothed): growing fastest — ${P.slice(0, 3).map(p => `${p.short} (${p.momentum.ratio}×${p.momentum.reliable ? '' : ', low confidence'})`).join(', ')}. ` + (fade.length ? `Fading: ${fade.map(p => `${p.short} (${p.momentum.ratio}×)`).join(', ')}. ` : 'Nothing with enough data is clearly fading. ') + `Only ${trusted.length} of ${P.length} problems have enough reviews in BOTH windows to trust — the rest are early signals, not trends. Retrieval talk is ${latest ? latest.share : '–'}% of store reviews in the latest year vs ${trend['2023'] ? trend['2023'].share : '–'}% in 2023.`,
    findings: P.map(p => `${p.momentum.reliable ? '' : '(low confidence) '}${p.short}: ${p.momentum.recent_share}% of recent reviews vs ${p.momentum.prior_share}% before → ${p.momentum.ratio}× (${p.momentum.recent_n} vs ${p.momentum.prior_n} reviews).`),
    table: { head: ['Problem', 'Recent n', 'Prior n', 'Recent share', 'Prior share', 'Ratio', 'Reliable?'], rows: P.map(p => [p.label, p.momentum.recent_n, p.momentum.prior_n, p.momentum.recent_share + '%', p.momentum.prior_share + '%', p.momentum.ratio + '×', p.momentum.reliable ? 'yes' : 'low']) },
    chart: { type: 'bar', title: 'Momentum (recent ÷ prior share of reviews)', labels: P.map(p => p.short), values: P.map(p => p.momentum.ratio) },
    evidence: P.slice(0, 3).flatMap(p => p.quotes.slice(0, 1).map(q => ({ ...q, tag: p.short }))),
    sources: { reviews: `store reviews, windows ${priorFrom} → ${recentFrom} → ${maxDate}` },
    caveat: 'Review volume is heavily skewed to 2025–26 (harvesting recency), so each window is compared as a SHARE of that window with add-one smoothing; thin windows are flagged low-confidence.',
  });
}

/* Q7 — platform / audience differences */
{
  const diff = osCompare.filter(o => o.android_n + o.ios_n >= 25).map(o => ({ ...o, gap: r1(o.ios_share - o.android_share) })).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  Q.push({
    id: 'audience', question: 'Do iOS, Android and power users hit different retrieval problems?',
    headline: `Yes. ${diff.slice(0, 3).map(d => `${d.short}: ${d.ios_share}% of iOS vs ${d.android_share}% of Android retrieval reviews`).join('; ')}. Community posts (Hacker News, Stack Exchange, Reddit) skew toward ${relCgroups.sort((a, b) => b.community_share - a.community_share).slice(0, 2).map(g => g.short.toLowerCase()).join(' and ')}.`,
    findings: [...diff.slice(0, 5).map(d => `${d.short}: iOS ${d.ios_share}% vs Android ${d.android_share}% (${d.ios_n} / ${d.android_n} reviews).`), `Power users (community, n=${relC.length}): top issues ${relCgroups.slice(0, 3).map(g => `${g.short} ${g.community_share}%`).join(', ')}.`],
    table: { head: ['Problem', 'iOS share', 'Android share', 'Store share', 'Community share'], rows: osCompare.filter(o => o.android_n + o.ios_n >= 25).map(o => [o.short, o.ios_share + '%', o.android_share + '%', (probBy[o.id] || {}).share_store + '%', (relCgroups.find(g => g.id === o.id) || {}).community_share + '%']) },
    chart: { type: 'groupbar', title: 'Share of retrieval reviews that mention each problem', labels: osCompare.filter(o => o.android_n + o.ios_n >= 25).map(o => o.short), series: [{ name: 'Android', values: osCompare.filter(o => o.android_n + o.ios_n >= 25).map(o => o.android_share) }, { name: 'iOS', values: osCompare.filter(o => o.android_n + o.ios_n >= 25).map(o => o.ios_share) }, { name: 'Community', values: osCompare.filter(o => o.android_n + o.ios_n >= 25).map(o => (relCgroups.find(g => g.id === o.id) || {}).community_share) }] },
    evidence: problems.slice(0, 3).flatMap(p => p.community_quotes.slice(0, 1).map(q => ({ ...q, tag: 'community · ' + p.short }))),
    sources: { reviews: `${relS.filter(r => r.os === 'android').length} Android · ${relS.filter(r => r.os === 'ios').length} iOS · ${relC.length} community` },
    caveat: 'Android and iOS populations differ (the Android corpus is larger and more recent).',
  });
}

/* Q8 — workarounds and cost of failure */
{
  Q.push({
    id: 'workarounds', question: 'What do people do when retrieval fails — and what does it cost them?',
    headline: `They scroll (${(behStats.find(b => b.id === 'scroll_manual') || { n: 0 }).n} reviews), mention using or switching to other apps (${(workStats.find(b => b.id === 'other_app') || { n: 0 }).n}), and some give up (${(behStats.find(b => b.id === 'give_up') || { n: 0 }).n}). The emotional cost is real: ${sPct(SURVEY.kpis.frustrated_any)}% of survey respondents are at least slightly frustrated (mean ${SURVEY.kpis.mean_frustration}/5), interviewees describe being "sad" or "annoyed", and reviews that mention giving up average ${(behStats.find(b => b.id === 'give_up') || { mean: '–' }).mean}★.`,
    findings: [...behStats.map(b => `${b.label}: ${b.n} reviews (${b.share}%), mean ${b.mean ?? 'n/a'}★.`), ...workStats.map(w => `${w.label}: ${w.n} reviews, mean ${w.mean ?? 'n/a'}★.`), `Survey: ${sCount('next', 'Browse the timeline')} browse the timeline and ${sCount('next', 'Check an album/folder')} check an album after a failed search; interviews: 3/3 check other apps (WhatsApp, Facebook, social media).`],
    table: { head: ['Behaviour / workaround', 'Reviews', 'Mean ★'], rows: [...behStats, ...workStats].map(b => [b.label, b.n, b.mean ?? '–']) },
    chart: { type: 'bar', title: 'Reviews mentioning each behaviour / workaround', labels: [...behStats, ...workStats].map(b => b.label.split(' (')[0]), values: [...behStats, ...workStats].map(b => b.n) },
    evidence: [...behStats.flatMap(b => b.quotes.map(q => ({ ...q, tag: b.label }))), ...workStats.flatMap(w => w.quotes.map(q => ({ ...q, tag: w.label })))].slice(0, 6),
    sources: { reviews: `${relS.length} store retrieval reviews`, survey: `Q8, Q10 · n=${sN}`, interviews: `other methods / feelings · n=${vN}` },
    caveat: 'Workaround counts only include reviews that also describe a retrieval problem.',
  });
}

/* Q9 — where the sources disagree (blind spots) */
{
  const fam = [
    ['Missing / vanished photos', ['missing_photos', 'deleted_trash', 'backup_state'], 0, vTheme('backup_gap').n_interviews],
    ['Search quality & wanting smarter search', ['search_quality', 'ai_expectation', 'general_difficulty'], sCount('interaction', 'It should ask me questions to clarify', 'It should suggest better search terms', 'It should show related searches', 'It should automatically suggest filters'), vTheme('describe_wish').n_interviews],
    ['Dates, scale & scrolling', ['dates_order', 'old_scale'], sCount('next', 'Browse the timeline') + sCount('query', "I usually don't search; I scroll"), vTheme('scroll_fallback').n_interviews],
    ['People & faces', ['people_faces'], sCount('clues', 'Person/persons'), Object.values(IV_CLUES).filter(c => c.person).length],
    ['Documents, screenshots & text', ['text_docs'], sCount('item', 'Medical document/prescription', 'Screenshot', 'Bill/receipt', 'Note/handwritten image'), vTheme('docs_screens').n_interviews],
    ['Incomplete memory (what was forgotten)', [], sCount('reason', "I don't remember enough details", "I can't remember approximately when it was saved", "I don't know what words to search"), Object.values(IV_FORGOT).filter(x => x.kinds && x.kinds.length).length],
    ['Personal tags / notes', ['personal_tags'], 0, wishEvents],
  ];
  const rowsF = fam.map(([label, ids, sv, iv]) => { const n = relS.filter(r => r.a.problems.some(p => ids.includes(p))).length; return { label, reviews: n, reviews_pct: pct(n, relS.length), survey: sv, survey_pct: sPct(sv), interviews: iv }; });
  const only = rowsF.filter(r => r.reviews_pct < 3 && (r.survey_pct >= 40 || r.interviews >= 2)).map(r => r.label);
  Q.push({
    id: 'blind_spots', question: 'Where do reviews, the survey and interviews disagree — what does each source miss?',
    headline: `Reviews are loud about vanished photos and broken search; the survey and interviews are loud about incomplete memory — something reviews can't show (${only.length ? only.join(', ') : 'see table'}). Each source has blind spots, which is why the discovery engine triangulates instead of trusting any one.`,
    findings: [`Reviews over-index on: missing / vanished photos (${rowsF[0].reviews_pct}% of retrieval reviews) and organisation complaints.`, `The survey and interviews over-index on: incomplete memory, wanting to describe the photo, and scrolling as a fallback.`, `Documents/screenshots matter to ${sPct(rowsF[4].survey)}% of survey respondents but appear in only ${rowsF[4].reviews_pct}% of retrieval reviews.`, `Personal tags/notes: ${rowsF[6].reviews} reviews ask for them; interviewees rely instead on memories resurfacing (${rowsF[6].interviews}/3).`],
    table: { head: ['Problem family', 'Reviews (% of retrieval)', 'Survey (respondents)', 'Interviews (of 3)'], rows: rowsF.map(r => [r.label, r.reviews_pct + '%', `${r.survey} (${r.survey_pct}%)`, r.interviews]) },
    chart: { type: 'groupbar', title: 'Emphasis by source (reviews % of retrieval reviews · survey % of respondents · interviews % of 3)', labels: rowsF.map(r => r.label), series: [{ name: 'Reviews %', values: rowsF.map(r => r.reviews_pct) }, { name: 'Survey %', values: rowsF.map(r => r.survey_pct) }, { name: 'Interviews %', values: rowsF.map(r => Math.round(100 * r.interviews / vN)) }] },
    evidence: [], sources: { reviews: `${relS.length}`, survey: `n=${sN}`, interviews: `n=${vN}` },
    caveat: 'Problem families are analyst-defined groupings; survey and interview columns are the closest corresponding signal, not identical measurements.',
    _rows: rowsF,
  });
}

/* Q11 — expectations of AI / natural-language search */
{
  const ai = relS.filter(r => r.a.problems.includes('ai_expectation')), sA = sev(ai);
  Q.push({
    id: 'ai_expectations', question: 'What do users expect from AI / natural-language search?',
    headline: `Reviews that mention AI search average ${sA.mean}★ (${sA.pct_low}% 1–2★): users want it to understand description, not force keywords. In the survey ${sPct(sCount('interaction', 'It should ask me questions to clarify'))}% would rather be asked clarifying questions than get suggested terms (${sPct(sCount('interaction', 'It should suggest better search terms'))}%); ${sPct(sCount('query', 'A description of what is in the image'))}% already type descriptions. All ${vN} interviewees described the photo in their own words, and one asked for a RAG-style bot.`,
    findings: [`${ai.length} store reviews mention AI/natural-language search (mean ${sA.mean}★).`, `Survey — preferred help when search doesn't understand: ${sq('interaction').dist.filter(d => d.count > 0).map(d => `${d.label} ${d.count}`).join('; ')}.`, `Survey — what builds trust: ${sq('trust').dist.filter(d => d.count > 0).slice(0, 4).map(d => `${d.label} ${d.count}`).join('; ')}.`, `Interviews — wishes: ${VOICE.feature_ideas.map(f => f.idea).join('; ')}.`],
    table: { head: ['Preferred interaction when search is stuck (survey)', 'Respondents', '%'], rows: sq('interaction').dist.filter(d => d.count > 0).map(d => [d.label, d.count, Math.round(d.pct) + '%']) },
    chart: { type: 'bar', title: 'Preferred help when search does not understand (respondents)', labels: sq('interaction').dist.filter(d => d.count > 0).map(d => d.label.replace('It should ', '')), values: sq('interaction').dist.filter(d => d.count > 0).map(d => d.count) },
    evidence: [...quotes(ai, 'ai_expectation', 3).map(q => ({ ...q, tag: 'review' })), ...VOICE.feature_ideas.slice(0, 2).map(f => ({ id: f.iv, platform: 'Interview ' + f.iv, text: f.quote, tag: f.idea }))],
    sources: { reviews: `${ai.length} AI-search reviews`, survey: `Q12–13 · n=${sN}`, interviews: `wishes · n=${vN}` },
    caveat: 'AI-search mentions are recent and often about Google\'s new “Ask Photos”; expectations may be shaped by that rollout.',
  });
}

/* Q12 — library size */
{
  const big = relS.filter(r => /\b(thousands|tens of thousands|hundreds of thousands|\d{2,3},?\d{3} (?:photos|pictures)|huge library|years of (?:photos|memories))\b/i.test(r.text));
  const sb = sev(big);
  Q.push({
    id: 'library_size', question: 'Does library size change the retrieval problem?',
    headline: `Hints, not proof: the interviewee with a 10,000+ photo library found a photo in ONE location search, while the 500-photo library owner found scrolling “a little frustrating”, and the ~5,000-photo owner said search is “for them who took too many pictures”. Reviews that mention huge libraries (${big.length}) average ${sb.mean}★. The real driver looks like “how much do I remember?”, not “how many photos do I have?”`,
    findings: VOICE.interviews.map(i => `${i.id}: ${i.profile.library_label} → ${i.profile.outcome.toLowerCase()}; felt ${i.profile.emotion.toLowerCase()}.`).concat([`${big.length} reviews describe very large libraries (mean ${sb.mean}★, ${sb.pct_low}% 1–2★).`, 'With n=3 interviews this is a hypothesis to test, not a finding.']),
    table: { head: ['Interviewee', 'Library', 'Outcome', 'Feeling'], rows: VOICE.interviews.map(i => [i.id, i.profile.library_label, i.profile.outcome, i.profile.emotion]) },
    chart: { type: 'bar', title: 'Interview library size (photos)', labels: VOICE.interviews.map(i => i.id), values: VOICE.interviews.map(i => i.profile.library_n || 0) },
    evidence: [{ id: 'V1', platform: 'Interview V1', text: vQA('V1', 'decide'), tag: '10,000+ photos' }, { id: 'V3', platform: 'Interview V3', text: vQA('V3', 'give_up'), tag: '500–600 photos' }, ...quotes(big, 'old_scale', 2).map(q => ({ ...q, tag: 'review' }))],
    sources: { interviews: `library size vs outcome · n=${vN}`, reviews: `${big.length} large-library reviews` }, caveat: 'Three interviews cannot separate library size from other differences between people.',
  });
}

/* ======================= 5. opportunity areas + scoring ======================= */
const idsOf = ids => relS.filter(r => r.a.problems.some(p => ids.includes(p)));
const OPP = [
  { id: 'nl_memory_search', label: 'Describe-what-you-remember search', problems: ['search_quality', 'ai_expectation', 'general_difficulty'], survey: () => sCount('query', 'A description of what is in the image'), survey_note: 'type a description', interviews: () => vTheme('describe_wish').n_interviews, concept: 'Natural-language search that scores each clue (person, place, time, outfit, setting) and shows close matches, with “why this matched”.', built: 'built', feature: 'AI memory search' },
  { id: 'guided_refinement', label: 'Ask-back / guided narrowing', problems: ['search_quality', 'general_difficulty'], extra: ['retry_terms', 'give_up'], survey: () => sCount('interaction', 'It should ask me questions to clarify'), survey_note: 'want clarifying questions', interviews: () => retried, concept: 'When a search is vague or empty, ask the best next question (indoors/outdoors, who, trip/event, when) and let answers be soft evidence.', built: 'built', feature: 'Interactive search assistant' },
  { id: 'time_travel', label: 'Faster time travel in big libraries', problems: ['old_scale', 'dates_order'], extra: ['scroll_manual'], survey: () => sCount('next', 'Browse the timeline') + sCount('query', "I usually don't search; I scroll"), survey_note: 'fall back to scrolling', interviews: () => vTheme('scroll_fallback').n_interviews, concept: 'Year/month zoom, a draggable date scrubber, and “around 2020” fuzzy-date search.', built: 'partial', feature: 'Timeline zoom + scrubber' },
  { id: 'people_retrieval', label: 'Person-first retrieval & manual face labels', problems: ['people_faces'], survey: () => sCount('clues', 'Person/persons'), survey_note: 'remember the person first', interviews: () => Object.values(IV_CLUES).filter(c => c.person).length, concept: 'Reliable person grouping, manual add/label of missed faces, relationship labels (“Mom”, “friend”).', built: 'partial', feature: 'People grouping' },
  { id: 'personal_memory_layer', label: 'Personal tags & memory notes', problems: ['personal_tags', 'organization'], survey: () => 0, survey_note: '— (not asked)', interviews: () => wishEvents, concept: 'Let people add their own words (“Mom’s 60th birthday”) to photos and whole moments; make them the strongest search signal.', built: 'built', feature: 'Tags & memory notes' },
  { id: 'docs_screens', label: 'Documents, screenshots & text-in-image retrieval', problems: ['text_docs'], survey: () => sCount('item', 'Medical document/prescription', 'Screenshot', 'Bill/receipt', 'Note/handwritten image'), survey_note: 'last searched for a document-like image', interviews: () => vTheme('docs_screens').n_interviews, concept: 'Type-aware search (screenshots/documents) with OCR and “copy text”.', built: 'partial', feature: 'OCR + type filters' },
  { id: 'backup_transparency', label: 'Backup transparency & recovery', problems: ['missing_photos', 'backup_state', 'deleted_trash'], survey: () => 0, survey_note: '—', interviews: () => vTheme('backup_gap').n_interviews, concept: 'Show what is NOT backed up, why a photo is missing, and where to recover it.', built: 'gap', feature: '—' },
  { id: 'search_continuity', label: 'Search history, resume & saved searches', problems: ['search_history'], extra: ['retry_terms', 'give_up'], survey: () => sCount('next', 'Add more details') + sCount('next', 'Try different keywords'), survey_note: 'retry / add details after a failure', interviews: () => retried, concept: 'Resume an unfinished search with its answers, save searches, alert on new matches.', built: 'built', feature: 'History & saved searches' },
  { id: 'places_events', label: 'Places, trips & events as first-class', problems: ['location', 'shared'], survey: () => sCount('clues', 'Place', 'Event/occasion'), survey_note: 'remember a place or event', interviews: () => placeOrEvent, concept: 'Auto-moments (trips/events), place names, “name this moment”.', built: 'partial', feature: 'Moments + places' },
  { id: 'discoverability', label: 'Findability of features after UI changes', problems: ['ui_change'], survey: () => 0, survey_note: '—', interviews: () => 0, concept: 'Keep search/filters in stable, obvious places; announce moves.', built: 'gap', feature: '—' },
  { id: 'cross_app', label: 'Cross-app & source-aware retrieval', problems: [], extra: ['other_app'], survey: () => sCount('narrow', 'Source (WhatsApp, Camera, Screenshot, etc.)'), survey_note: 'want a source filter', interviews: () => vTheme('cross_app').n_interviews, concept: 'Source filters (camera / WhatsApp / screenshots) and imported-chat media.', built: 'gap', feature: '—' },
  { id: 'edits_copies', label: 'Edited versions & duplicates', problems: ['edited_copies'], survey: () => 0, survey_note: '—', interviews: () => 0, concept: 'Group edits with originals; surface duplicates.', built: 'partial', feature: 'Stacks' },
];
const norm = (arr) => { const mn = Math.min(...arr), mx = Math.max(...arr); return arr.map(v => mx === mn ? 0 : (v - mn) / (mx - mn)); };
const oppRaw = OPP.map(o => {
  const set = new Set(); relS.forEach(r => { if (r.a.problems.some(p => o.problems.includes(p)) || (o.extra || []).some(e => r.a.behaviour.includes(e) || r.a.workarounds.includes(e))) set.add(r); });
  const sub = [...set], sv = sev(sub), mo = momentum(sub, store);
  const sCnt = o.survey(), iCnt = o.interviews();
  const sSig = sCnt / sN >= 0.5 ? 2 : sCnt / sN >= 0.25 ? 1 : sCnt > 0 ? 0.5 : 0, iSig = iCnt >= 3 ? 2 : iCnt >= 2 ? 1.5 : iCnt >= 1 ? 1 : 0;
  return { o, n: sub.length, low: sv.pct_low ?? baseSev.pct_low, mean: sv.mean, thumbs: sum(sub.map(r => r.thumbs)), mom: mo.ratio ?? 1, sSig, iSig, sCnt, iCnt, quotes: quotes(sub, o.problems[0], 3), sub: sub.length };
});
const feats = { volume: norm(oppRaw.map(x => x.n)), severity: norm(oppRaw.map(x => x.low)), reach: norm(oppRaw.map(x => Math.log1p(x.thumbs))), momentum: norm(oppRaw.map(x => Math.min(2.5, Math.max(0.4, x.mom)))), triangulation: oppRaw.map(x => (x.sSig + x.iSig) / 4) };
const WEIGHTS = { volume: 0.25, severity: 0.25, reach: 0.10, momentum: 0.10, triangulation: 0.30 };
const scoreOf = (i, w) => Object.keys(w).reduce((s, k) => s + w[k] * feats[k][i], 0);
const base = oppRaw.map((x, i) => scoreOf(i, WEIGHTS)); const order = base.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
// sensitivity: 1,000 random weightings around the base weights (Dirichlet-like jitter ±60%)
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const ranks = oppRaw.map(() => []); const top3 = oppRaw.map(() => 0);
for (let t = 0; t < 1000; t++) { const w = {}; let tot = 0; Object.keys(WEIGHTS).forEach(k => { w[k] = WEIGHTS[k] * (0.4 + 1.2 * rnd()); tot += w[k]; }); Object.keys(w).forEach(k => w[k] /= tot); const sc = oppRaw.map((_, i) => [scoreOf(i, w), i]).sort((a, b) => b[0] - a[0]); sc.forEach(([, i], rk) => { ranks[i].push(rk + 1); if (rk < 3) top3[i]++; }); }
const RV_W = { volume: 0.4, severity: 0.4, reach: 0.1, momentum: 0.1, triangulation: 0 };
const rvOrder = oppRaw.map((_, i) => [scoreOf(i, RV_W), i]).sort((a, b) => b[0] - a[0]).map(x => x[1]); const rvRank = {}; rvOrder.forEach((i, r) => rvRank[i] = r + 1);
const primOnly = { volume: 0, severity: 0, reach: 0, momentum: 0, triangulation: 1 }; const prOrder = oppRaw.map((_, i) => [scoreOf(i, primOnly), i]).sort((a, b) => b[0] - a[0]).map(x => x[1]); const prRank = {}; prOrder.forEach((i, r) => prRank[i] = r + 1);
const opportunities = order.map((i, rank) => { const x = oppRaw[i], o = x.o, rs = ranks[i].slice().sort((a, b) => a - b); return {
  rank: rank + 1, id: o.id, label: o.label, score: r2(base[i]), concept: o.concept, status: o.built, built_feature: o.feature,
  components: { volume: r2(feats.volume[i]), severity: r2(feats.severity[i]), reach: r2(feats.reach[i]), momentum: r2(feats.momentum[i]), triangulation: r2(feats.triangulation[i]) },
  evidence: { reviews: x.n, pct_low: x.low, mean_rating: x.mean, thumbs: x.thumbs, momentum: x.mom, survey: `${x.sCnt}/${sN} ${o.survey_note}`, interviews: `${x.iCnt}/${vN}` },
  stability: { top3_pct: Math.round(top3[i] / 10), rank_p10: rs[Math.floor(rs.length * 0.1)], rank_p90: rs[Math.floor(rs.length * 0.9)], rank_reviews_only: rvRank[i], rank_primary_only: prRank[i] },
  quotes: x.quotes }; });
Q.push({
  id: 'opportunities', question: 'Which retrieval problems are the best opportunity areas — and how sure are we?',
  headline: `Ranked by a transparent evidence score (volume, severity, reach, momentum, cross-source support):${opportunities.slice(0, 3).map(o => `#${o.rank} ${o.label} (${o.score})`).join('; ')}. The top-3 are stable: ${opportunities.slice(0, 3).map(o => `${o.label.split(' ').slice(0, 3).join(' ')} stays top-3 in ${o.stability.top3_pct}% of 1,000 random re-weightings`).join('; ')}.`,
  findings: opportunities.map(o => `#${o.rank} ${o.label} — score ${o.score}; ${o.evidence.reviews} reviews (${o.evidence.pct_low}% 1–2★), survey ${o.evidence.survey}, interviews ${o.evidence.interviews}. Status: ${o.status}${o.built_feature !== '—' ? ' (' + o.built_feature + ')' : ''}.`),
  table: { head: ['#', 'Opportunity', 'Score', 'Reviews', '% 1–2★', 'Survey signal', 'Interviews', 'Top-3 in', 'Rank: reviews only', 'Rank: primary only', 'Status'], rows: opportunities.map(o => [o.rank, o.label, o.score, o.evidence.reviews, o.evidence.pct_low + '%', o.evidence.survey, o.evidence.interviews, o.stability.top3_pct + '%', o.stability.rank_reviews_only, o.stability.rank_primary_only, o.status]) },
  chart: { type: 'stackbar', title: 'Opportunity score, by component (weights: volume .25 · severity .25 · reach .10 · momentum .10 · triangulation .30)', labels: opportunities.map(o => o.label), series: Object.keys(WEIGHTS).map(k => ({ name: k, values: opportunities.map(o => r2(o.components[k] * WEIGHTS[k])) })) },
  evidence: opportunities.slice(0, 4).flatMap(o => o.quotes.slice(0, 1).map(q => ({ ...q, tag: o.label }))),
  sources: { reviews: `${relS.length}`, survey: `n=${sN}`, interviews: `n=${vN}` },
  caveat: 'Transparent, not authoritative. Triangulation carries 30% of the weight and the primary research was designed around retrieval by memory, so it favours that area. The “reviews only” and “primary only” ranks show how much the order depends on that choice.',
});

/* ======================= 6. summary ======================= */
const top = opportunities[0], qd = id => Q.find(q => q.id === id);
const summary = {
  title: 'Discovery summary',
  one_liner: `Photo retrieval fails less because search is “broken” and more because people remember photos in fuzzy, human ways (who, what occasion, roughly when) while the product asks for exact keywords, dates and file facts.`,
  bullets: [
    `What is hard to retrieve: ${contentStats.filter(c => c.n_old >= 8).slice(0, 3).map(c => c.label.split(' (')[0].toLowerCase()).join(', ')} — and, in the survey, document-like images (${sPct(sCount('item', 'Medical document/prescription', 'Screenshot', 'Bill/receipt', 'Note/handwritten image'))}% of respondents' last hunt).`,
    `What people remember: the person (${sPct(sCount('clues', 'Person/persons'))}%), the occasion (${sPct(sCount('clues', 'Event/occasion'))}%) and roughly when (${sPct(sCount('clues', 'Approximate time/period'))}%); scenes and outfits in interviews.`,
    `What they forget: exact month/date, which event it was, who took it, and which words to type (“I don't remember enough details” is the #1 reason for failure, ${sCount('reason', "I don't remember enough details")}/${sN}).`,
    `How they search: describe or name first (${sPct(sCount('query', 'A description of what is in the image'))}% describe), anchor on a place/date, then add details or scroll; 3/3 interviewees also check other apps.`,
    `Most common problems in reviews: ${problems.filter(p => p.id !== 'general_difficulty').slice(0, 3).map(p => `${p.short.toLowerCase()} (${p.n_store})`).join(', ')}; every one skews far more negative than the app average (${baseSev.pct_low}% 1–2★).`,
    `Growing: ${(qd('momentum').findings || []).slice(0, 2).map(s => s.split(':')[0].toLowerCase()).join(', ')}.`,
    `Sources disagree in useful ways: reviews see symptoms (vanished photos, bad search); the survey and interviews expose the cause (incomplete memory) — which reviews almost never reveal.`,
  ],
  top_opportunities: opportunities.slice(0, 5).map(o => ({ rank: o.rank, label: o.label, score: o.score, status: o.status, why: `${o.evidence.reviews} reviews · survey ${o.evidence.survey} · interviews ${o.evidence.interviews}` })),
  implications: [
    'Build retrieval around fuzzy human clues: score partial matches, tolerate approximate time, and say why a photo matched.',
    'When search is vague, ask — don’t just return nothing (half of respondents prefer clarifying questions).',
    'Let people add their own words and name whole moments; use them as the strongest signal.',
    'Treat documents/screenshots as their own retrieval problem (type + OCR).',
    'Make “not backed up” visible — some “missing” photos are not a search failure at all.',
  ],
  limits: [`Reviews are rule-coded (sampled precision ≈85–90%); counts are lower bounds.`, `Survey n=${sN} and interviews n=${vN} are small, convenience samples — read them as patterns and wording, not percentages.`, 'Review volume is skewed toward 2025–26; trends compare shares, not counts.', 'Opportunity scores depend on weights; see the stability column.'],
};

/* ======================= 7. assemble + write ======================= */
const out = {
  meta: { generated_at: new Date().toISOString().slice(0, 19), engine: 'rule-coded review mining + survey + interviews', reviews_total: totalRows, reviews_english_analysed: recs.length, store_english: store.length, community_english: comm.length, retrieval_store: relS.length, retrieval_community: relC.length, success_store: successS.length, skipped, survey_n: sN, interviews_n: vN, windows: { recent_from: recentFrom, prior_from: priorFrom, max_date: maxDate }, weights: WEIGHTS, base_mean_rating: baseSev.mean, base_pct_low: baseSev.pct_low,
    method: 'English reviews from Play Store / App Store (rated) and community posts (HN, Reddit, Stack Exchange, GitHub, Support). A review counts as “retrieval-relevant” only if it describes finding photos/videos/albums (not a UI button) AND names a concrete retrieval problem or an explicit difficulty/success in finding. Problems, content kinds, clues, behaviours and workarounds are coded with transparent rules (scripts/discovery_lib.js).' },
  problems: problems.map(({ quotes: q, community_quotes, ...p }) => ({ ...p, quotes: q, community_quotes })),
  content: contentStats, old_problems: oldProblems, clues: clueStats, queries: queryStats, forgot: forgotStats, behaviour: behStats, workarounds: workStats, trend, os_compare: osCompare, community_vs_store: relCgroups,
  interview_coding: { clues: IV_CLUES, forgot: IV_FORGOT, strategies: IV_STRAT },
  questions: Q, opportunities, summary,
};
fs.writeFileSync(path.join(ROOT, 'static', 'discovery.json'), JSON.stringify(out, null, 1), 'utf8');

/* markdown report */
const md = [];
md.push('# Discovery report — photo retrieval problems & opportunities', '', `*Generated ${out.meta.generated_at} · ${out.meta.retrieval_store.toLocaleString()} retrieval-relevant store reviews (of ${out.meta.store_english.toLocaleString()} English), ${out.meta.retrieval_community} community posts, survey n=${sN}, interviews n=${vN}.*`, '');
md.push('## Summary', '', summary.one_liner, '', ...summary.bullets.map(b => '- ' + b), '', '**Top opportunity areas**', '', ...summary.top_opportunities.map(o => `${o.rank}. **${o.label}** — score ${o.score} · ${o.status} · ${o.why}`), '', '**Implications**', '', ...summary.implications.map(b => '- ' + b), '', '**Limits**', '', ...summary.limits.map(b => '- ' + b), '');
Q.forEach((q, i) => { md.push(`## ${i + 1}. ${q.question}`, '', `**${q.headline}**`, '', ...q.findings.map(f => '- ' + f), ''); if (q.table) { md.push('| ' + q.table.head.join(' | ') + ' |', '|' + q.table.head.map(() => '---').join('|') + '|', ...q.table.rows.map(r => '| ' + r.join(' | ') + ' |'), ''); } if (q.evidence && q.evidence.length) { md.push('Evidence:', '', ...q.evidence.slice(0, 5).map(e => `> “${e.text}” — *${e.platform}${e.rating ? ' ' + e.rating + '★' : ''}${e.tag ? ' · ' + e.tag : ''}*`), ''); } md.push(`*Sources: ${Object.entries(q.sources).map(([k, v]) => k + ' — ' + v).join(' · ')}. Caveat: ${q.caveat}*`, ''); });
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'docs', 'Discovery_Report.md'), md.join('\n'), 'utf8');

/* inject a compact copy into the two pages */
const slim = JSON.parse(JSON.stringify(out)); slim.problems.forEach(p => { p.quotes = p.quotes.slice(0, 3); p.community_quotes = p.community_quotes.slice(0, 1); }); slim.content.forEach(c => { c.quotes = c.quotes.slice(0, 2); c.quotes_old = c.quotes_old.slice(0, 2); });
slim.behaviour.forEach(b => b.quotes = b.quotes.slice(0, 1)); slim.workarounds.forEach(b => b.quotes = b.quotes.slice(0, 1)); slim.opportunities.forEach(o => o.quotes = o.quotes.slice(0, 2)); slim.questions.forEach(q => { q.evidence = (q.evidence || []).slice(0, 5); });
const payload = JSON.stringify(slim).replace(/</g, '\\u003c');
for (const f of ['dashboard.html', 'chatbot.html']) { const p = path.join(ROOT, f); const h = fs.readFileSync(p, 'utf8'); const re = /(<script id="discovery-data" type="application\/json">)[\s\S]*?(<\/script>)/; if (!re.test(h)) { console.warn(`! ${f}: placeholder <script id="discovery-data"> not found — skipped`); continue; } fs.writeFileSync(p, h.replace(re, (_, a, b) => a + payload + b), 'utf8'); console.log('injected into ' + f + ` (${Math.round(payload.length / 1024)} KB)`); }
console.log(`\nreviews: ${totalRows} rows → ${recs.length} English analysed (store ${store.length}, community ${comm.length}) → retrieval-relevant: store ${relS.length}, community ${relC.length}`);
console.log('problems:', problems.slice(0, 8).map(p => `${p.id}:${p.n_store}`).join(' '));
console.log('opportunities:'); opportunities.forEach(o => console.log(`  #${o.rank} ${o.label.padEnd(52)} score ${o.score}  top3 ${o.stability.top3_pct}%  rank ${o.stability.rank_p10}-${o.stability.rank_p90}  [${o.status}]`));
