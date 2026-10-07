/* Ask Photos: a conversational finder built on the memory-search engine.
 * You describe what you remember; it shows likely photos, and when it can't find them (or there are too many)
 * it asks ONE clarifying question at a time, folds your answer back into the search, and tries again.
 * Everything runs on this device (rule-based language understanding + on-device ranking, no cloud model). */
(() => {
const { $, el, icon } = P;
const nlp = P.nlp, E = P.engine, M = () => P.memory, H = () => P.memory.history;
let S = null, pend = null, panel = null, log = null, input = null, busy = false, lastShown = [];

const EXAMPLES = ['pink dress at my friend’s wedding', 'beach trip around 3 years back', 'photos with Mom indoors', 'passport'];
const FALLBACK = [
  { dim: 'year', text: 'Roughly when was it taken? A year, a season or “3 years back” is fine.', chips: [] },
  { dim: 'person', text: 'Who was with you in it?', chips: [] },
  { dim: 'place', text: 'Where was it taken, even roughly?', chips: [] },
  { dim: 'setting', text: 'Was it indoors or outdoors?', chips: [['Indoors', 'indoors'], ['Outdoors', 'outdoors']] },
  { dim: 'occasion', text: 'Was it during a trip or an event?', chips: [['A trip', 'during a trip'], ['An event or party', 'at a party']] },
];
const SKIP = /^(not sure|no idea|idk|skip|don'?t know|do not know|don'?t remember|pata nahi|yaad nahi|nahi pata)\b/i;
const NEW = /^(new search|start over|reset|find|show me|show|search|look for|get me|dhundo|dikhao)\b/i;

function newState(q) { return { q: q || '', filters: {}, answers: [], removed: [], skipped: [], extra: '', loose: false, assistantOpen: true, rec: null, fb: [], rejected: new Set() }; }

/* ---------- UI ---------- */
function build() {
  if (panel) return;
  panel = el('aside', { id: 'ask-panel', class: 'ask-panel hidden', role: 'dialog', 'aria-label': 'Ask Photos' },
    el('header', { class: 'ask-head' }, el('span', { class: 'ask-logo' }, icon('psychology')), el('div', {}, el('b', {}, 'Ask Photos'), el('small', {}, 'Describe it. I’ll find it, or ask what I need.')),
      el('button', { class: 'ib sm', title: 'New search', 'aria-label': 'New search', onclick: () => reset(true) }, icon('restart_alt')), el('button', { class: 'ib sm', title: 'Close', 'aria-label': 'Close', onclick: close }, icon('close'))),
    log = el('div', { class: 'ask-log', 'aria-live': 'polite' }),
    el('form', { class: 'ask-in', onsubmit: e => { e.preventDefault(); send(input.value); } }, input = el('input', { class: 'field', placeholder: 'e.g. me in a pink dress at a wedding', maxlength: 200, 'aria-label': 'Describe the photo' }), el('button', { class: 'btn-p', type: 'submit' }, icon('send'))),
    el('div', { class: 'ask-foot' }, icon('lock'), ' Runs on this device. Nothing is uploaded.'));
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(); });
  document.body.appendChild(panel);
  const fab = el('button', { id: 'ask-fab', class: 'ask-fab', 'aria-label': 'Ask Photos', onclick: () => open() }, icon('psychology'), el('span', {}, 'Ask Photos'));
  document.body.appendChild(fab);
}
function open(q) { build(); panel.classList.remove('hidden'); $('#ask-fab').classList.add('hidden'); if (!log.children.length) greet(); if (q) { reset(false); send(q); } setTimeout(() => input.focus(), 50); }
function close() { panel && panel.classList.add('hidden'); const f = $('#ask-fab'); f && f.classList.remove('hidden'); }
function reset(greetAgain) { S = null; pend = null; if (greetAgain) { log.innerHTML = ''; greet(); } }

const scroll = () => { log.scrollTop = log.scrollHeight; };
function bubble(who, ...kids) { const b = el('div', { class: 'ask-msg ' + who }, ...kids); log.appendChild(b); scroll(); return b; }
const say = (text, ...extra) => bubble('bot', el('p', {}, text), ...extra);
const you = text => bubble('me', el('p', {}, text));
const chips = (list, onPick) => el('div', { class: 'ask-chips' }, ...list.map(([label, value, sub]) => el('button', { class: 'chip', onclick: e => { e.currentTarget.parentElement.querySelectorAll('button').forEach(b => b.disabled = true); onPick(value, label); } }, label, sub ? el('small', {}, String(sub)) : null)));

function greet() {
  const un = (H().all().filter(H().unfinished).sort((a, b) => b.updatedAt - a.updatedAt))[0];
  const list = EXAMPLES.map(x => [x, x]);
  const msg = say('Hi! Tell me what you remember about the photo: who was there, what the occasion was, roughly when. Partial memories are fine. If I can’t find it, I’ll ask you a question.', chips(list, v => { you(v); send(v, true); }));
  if (un) msg.appendChild(chips([['Continue: ' + un.q, un.id]], id => { you('Continue: ' + un.q); resume(id); }));
}
async function resume(id) { const r = P.M.searches.get(id); if (!r) return; S = newState(r.q); S.answers = r.answers || []; S.removed = r.removed || []; S.skipped = r.skipped || []; S.extra = r.extra || ''; S.rec = r; await respond('Picking up where you left off.'); }

/* ---------- conversation ---------- */
async function send(text, already) {
  text = (text || '').trim(); if (!text || busy) return; input.value = '';
  if (!already) you(text);
  busy = true;
  try {
    if (!S || NEW.test(text) && S.q) { S = newState(text.replace(/^(new search|start over|reset)[:,\s]*/i, '')); pend = null; if (!S.q) { say('Okay, fresh start. What do you remember?'); return; } }
    else if (!S.q) S.q = text;
    else if (!(await applyReply(text))) return;
    await respond();
  } catch (e) { console.warn(e); say('Sorry, something went wrong while searching. Try rephrasing it.'); } finally { busy = false; }
}

/* map a typed reply onto the pending question; anything else becomes an extra detail for the search */
async function applyReply(text) {
  if (pend && SKIP.test(text)) { skip(); return true; }
  if (!pend) {   // replying to “Is it one of these?”
    if (SKIP.test(text)) { say('No problem. Tell me one more thing you remember, or tap “None of these”.'); return false; }
    if (/^(no|nope|nahi|none|none of (these|them)|not (this|these|any))\b/i.test(text)) { lastShown.forEach(id => S.rejected.add(id)); return true; }
    if (/^(yes|yeah|yep|ya|haan|found it|this is it|that'?s it)\b/i.test(text)) { say('Great! Tap “This is it” under the right photo so I can remember this search.'); return false; }
  }
  if (pend && pend.kind === 'opt') {
    const q = pend.q, t = text.toLowerCase(); let hit = null;
    for (const o of q.options) if (t.includes(String(o.label).toLowerCase()) || String(o.label).toLowerCase().includes(t)) { hit = o; break; }
    if (!hit && q.dim === 'setting') hit = /\b(out|outside|outdoor|bahar|open)/i.test(t) ? q.options.find(o => o.value === 'outdoor') : /\b(in|inside|indoor|ghar|home|room|hall)/i.test(t) ? q.options.find(o => o.value === 'indoor') : null;
    if (!hit && q.dim === 'occasion') hit = /\b(trip|travel|vacation|holiday|yatra)/i.test(t) ? q.options.find(o => o.value === 'trip') : /\b(event|party|function|wedding|birthday)/i.test(t) ? q.options.find(o => o.value === 'event') : null;
    if (!hit && q.dim === 'year') { const y = (t.match(/\b(19|20)\d\d\b/) || [])[0]; if (y) hit = q.options.find(o => String(o.value) === y); }
    if (hit) { answerOpt(q, hit); return true; }
  }
  if (pend && pend.kind === 'free' && pend.dim === 'text') { S.answers.push(E.makeAnswer('text', nlp.normText(text), text)); S.fb.push('text'); return true; }
  S.extra = (S.extra + ' ' + text).trim(); if (pend && pend.dim) S.fb.push(pend.dim); return true;
}
const labelFor = (dim, o) => dim === 'person' ? 'With ' + o.label : dim === 'year' ? 'In ' + o.label : dim === 'place' ? 'In ' + o.label : o.label;
function answerOpt(q, o) { S.answers.push(E.makeAnswer(q.dim, o.value, labelFor(q.dim, o))); }
function skip() { if (pend && pend.kind === 'opt') S.skipped.push(pend.q.dim); else if (pend && pend.dim) S.fb.push(pend.dim); }

async function respond(lead) {
  const typing = bubble('bot typing', el('span', {}), el('span', {}), el('span', {}));
  let res = await M().run(S), looseNote = false;
  if (!res.out.total && !S.loose && !res.clues.empty) { const l = Object.assign({}, S, { loose: true }), r2 = await M().run(l); if (r2.out.total) { res = r2; looseNote = true; } else await M().run(S); }
  const rec = await H().touch(S, res); if (rec) S.rec = rec;
  typing.remove();
  const out = res.out, clues = res.clues, cl = (res.clues0 || res.clues).chips || [];
  const looked = cl.length ? 'I looked for: ' + cl.map(c => (c.display || c.label) + (c.approx ? ' ≈' : '')).join(' · ') + '.' : '';
  if (clues.empty && !out.total) { pend = { kind: 'free', dim: 'text' }; say((lead ? lead + ' ' : '') + 'I couldn’t pick out anything I can search for yet. Tell me who was there, where, when, or what was happening.'); return; }

  const strong = out.results.filter(r => r.tier === 'strong'), pool = (strong.length ? strong : out.results).filter(r => !S.rejected.has(r.id));
  const q = E.nextQuestion(res.i, out, [...S.answers, ...S.skipped.map(d => ({ dim: d }))], clues);
  const few = pool.length > 0 && pool.length <= 6 && (strong.length > 0 || out.total <= 6);

  if (few && !looseNote) {
    const show = pool.slice(0, 6);
    say((lead ? lead + ' ' : '') + (show.length === 1 ? 'I think this is it.' : `I found ${show.length} likely matches.`) + (looked ? ' ' + looked : ''), thumbs(show, res));
    pend = null; say('Is it one of these?', chips([['None of these', 'none'], ['Let me add a detail', 'add']], v => { if (v === 'none') { show.forEach(r => S.rejected.add(r.id)); you('None of these'); busy = true; respond().finally(() => busy = false); } else { you('I’ll add a detail'); pend = { kind: 'free', dim: 'text' }; say('Sure, what else do you remember?'); } }));
    return;
  }
  if (out.total) {
    const show = pool.slice(0, 4);
    const head = !show.length ? `Okay, ruling those out. ${out.total} other possibilities remain.` : looseNote ? `I couldn’t find an exact match, so these are the closest guesses (${out.total} in all).` : out.total > 4 ? `${strong.length ? strong.length + ' strong' : out.total} match${(strong.length || out.total) === 1 ? '' : 'es'}, too many to be sure.` : `Here is what I found.`;
    say((lead ? lead + ' ' : '') + head + (looked ? ' ' + looked : ''), thumbs(show, res), seeAll(res));
  } else {
    say((lead ? lead + ' ' : '') + 'I couldn’t find a photo that fits that.' + (looked ? ' ' + looked : '') + ' Memories are often a little off, so let me ask something.');
  }
  ask(q, res, out);
}

function ask(q, res, out) {
  if (q && !q.done) {
    if (q.free) { pend = { kind: 'free', dim: 'text' }; say(q.text, chips([['Not sure', 'skip']], () => { you('Not sure'); S.fb.push('text'); S.skipped.push('text'); busy = true; respond().finally(() => busy = false); })); return; }
    pend = { kind: 'opt', q };
    say(q.text + ` (narrowing from ${q.count})`, chips([...q.options.map(o => [o.label, o, o.count]), ['Not sure', 'skip']], (v, label) => { you(label); if (v === 'skip') { S.skipped.push(q.dim); } else answerOpt(q, v); busy = true; respond().finally(() => busy = false); }));
    return;
  }
  // no candidates to split (or none left): ask about something the search doesn't have yet, in free text
  const have = { year: (res.clues.dates || []).length, person: (res.clues.people || []).length || (res.clues.unknownNames || []).length, place: (res.clues.places || []).length, setting: res.clues.setting, occasion: (res.clues.events || []).length };
  const MAXQ = 3;   // question fatigue guard: after three free-text questions, stop asking and say so
  const f = S.fb.length < MAXQ ? FALLBACK.find(x => !have[x.dim] && !S.fb.includes(x.dim)) : null;
  if (f) {
    pend = { kind: 'free', dim: f.dim };
    say(f.text, chips([...f.chips, ['Not sure', 'skip']], (v, label) => { you(label); if (v === 'skip') S.fb.push(f.dim); else { S.extra = (S.extra + ' ' + v).trim(); S.fb.push(f.dim); } busy = true; respond().finally(() => busy = false); }));
  } else if (!S.fb.includes('text') && S.fb.length < MAXQ) {
    pend = { kind: 'free', dim: 'text' }; say('Anything else you remember: a word on it, what you were doing, something you wore?', chips([['Not sure', 'skip']], () => { you('Not sure'); S.fb.push('text'); busy = true; respond().finally(() => busy = false); }));
  } else {
    pend = null; say(out && out.total ? 'That’s all I can ask. Open the full results to browse them, or start a new search.' : 'I’m out of questions and nothing matches. Try “New search” with different words, or add the photo’s tags and notes so I can find it next time.', chips([['New search', 'n']], () => reset(true)));
  }
}

function thumbs(list, res) {
  const ids = list.map(r => r.id), grid = el('div', { class: 'ask-thumbs' }); lastShown = ids;
  list.forEach(r => {
    const t = el('div', { class: 'ask-t' }), im = el('button', { class: 'ask-img', 'aria-label': 'Open photo', onclick: () => P.viewer.open(ids, r.id) });
    P.thumbURL(r.id).then(u => u && (im.style.backgroundImage = `url(${u})`));
    const why = [...(r.matched || []).map(m => '✓ ' + m.label), ...(r.missed || []).map(m => '✗ ' + m.label)].join(' · ');
    t.append(im, el('div', { class: 'ask-why' }, why || 'matches your description'), el('button', { class: 'btn-o sm', onclick: async e => { e.currentTarget.disabled = true; if (S && S.rec) await H().resolve(S.rec, r.id); pend = null; say('Great, found it. I’ll remember this search.', chips([['Open photo', 'o'], ['Find another', 'n']], v => { if (v === 'o') P.viewer.open([r.id], r.id); else reset(true); })); } }, icon('check'), ' This is it'));
    grid.appendChild(t);
  });
  return grid;
}
function seeAll(res) { return el('button', { class: 'btn-t', onclick: () => { close(); location.hash = '#/search/' + encodeURIComponent(S.q) + (S.rec ? '/' + encodeURIComponent('{}') + '/' + S.rec.id : ''); } }, 'See all ' + res.out.total + ' results →'); }

P.askchat = { open, close, state: () => ({ q: S && S.q, shown: lastShown.slice(), pend: pend && pend.kind }) };
const boot = () => { build(); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
