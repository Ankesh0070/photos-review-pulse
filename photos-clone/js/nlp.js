/* Query understanding for "memory search" — pure functions (no DOM, no storage), unit-tested in Node.
 *
 *   parse("Find a photo where I was wearing a pink dress at my friend's wedding", ctx)
 *   → { dates, types, setting, attire, events, people, places, tags, text, chips, … }
 *
 * ctx = { now, people:[{id,name}], places:[string], albums:[string], tags:[string] }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.P = root.P || {}; root.P.nlp = api; }
})(typeof window !== 'undefined' ? window : globalThis, function () {

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MABBR = MONTHS.map(m => m.slice(0, 3));
const DAY = 86400000;

/* ---------- lexicons ---------- */
const COLORS = {
  pink: ['pink', 'rose', 'magenta', 'fuchsia', 'blush'], red: ['red', 'maroon', 'crimson', 'scarlet'], orange: ['orange', 'saffron', 'peach'], yellow: ['yellow', 'golden', 'gold', 'mustard'],
  green: ['green', 'olive', 'mint', 'lime'], teal: ['teal', 'turquoise', 'aqua'], blue: ['blue', 'navy', 'sky-blue', 'cyan'], purple: ['purple', 'violet', 'lavender', 'lilac', 'mauve'],
  brown: ['brown', 'beige', 'tan', 'khaki', 'maroon-brown'], white: ['white', 'cream', 'ivory'], gray: ['gray', 'grey', 'silver'], black: ['black'],
};
const COLOR_OF = {}; Object.entries(COLORS).forEach(([c, ws]) => ws.forEach(w => { if (!COLOR_OF[w]) COLOR_OF[w] = c; }));
COLOR_OF.maroon = 'red';
const GARMENTS = ['dress', 'gown', 'saree', 'sari', 'lehenga', 'kurta', 'kurti', 'sherwani', 'shirt', 't-shirt', 'tshirt', 'jacket', 'suit', 'blazer', 'jeans', 'pants', 'trousers', 'skirt', 'hoodie', 'sweater', 'uniform', 'cap', 'hat', 'sunglasses', 'glasses', 'scarf', 'shorts', 'tie', 'jersey', 'coat', 'dupatta', 'costume', 'outfit', 'shoes'];
const GARMENT_NORM = { sari: 'saree', tshirt: 't-shirt', kurti: 'kurta', trousers: 'pants' };

const EVENTS = {
  wedding: ['wedding', 'weddings', 'shaadi', 'shadi', 'marriage', 'reception', 'sangeet', 'mehendi', 'mehndi', 'haldi', 'bride', 'groom', 'baraat', 'vivah', 'engagement', 'nikah'],
  birthday: ['birthday', 'birthdays', 'bday', 'b-day', 'janmadin', 'cake cutting', 'cake'],
  party: ['party', 'parties', 'celebration', 'celebrations', 'get-together', 'gettogether', 'farewell', 'freshers'],
  trip: ['trip', 'trips', 'vacation', 'holiday', 'holidays', 'tour', 'travel', 'honeymoon', 'road trip', 'getaway', 'picnic', 'trek', 'trekking'],
  festival: ['festival', 'diwali', 'holi', 'eid', 'christmas', 'navratri', 'durga puja', 'ganesh', 'rakhi', 'raksha bandhan', 'dussehra', 'lohri', 'onam', 'pongal', 'new year'],
  graduation: ['graduation', 'convocation', 'degree ceremony'],
  concert: ['concert', 'gig', 'festival show', 'live show'],
  sports: ['cricket match', 'football match', 'tournament', 'championship', 'sports day', 'marathon', 'medal'],
  family: ['family function', 'family gathering', 'reunion', 'family get-together'],
  college: ['college', 'campus', 'fresher', 'freshers', 'hostel', 'classmates', 'convocation'],
};
const EVENT_EMOJI = { wedding: '💍', birthday: '🎂', party: '🎉', trip: '🧳', festival: '🪔', graduation: '🎓', concert: '🎤', sports: '🏅', family: '👪', college: '🏫' };

const TYPE_WORDS = {
  video: 'video', videos: 'video', clip: 'video', clips: 'video', reel: 'video',
  selfie: 'selfie', selfies: 'selfie', screenshot: 'screenshot', screenshots: 'screenshot', 'screen shot': 'screenshot',
  panorama: 'panorama', panoramas: 'panorama', document: 'document', documents: 'document', scan: 'document', receipt: 'document', receipts: 'document',
  edited: 'edited', favorite: 'favorite', favorites: 'favorite', favourite: 'favorite', favourites: 'favorite', starred: 'favorite',
};
const SETTINGS = {
  outdoor: ['outdoors', 'outdoor', 'outside', 'open air', 'in the open', 'under the sky', 'in the garden', 'on the road'],
  indoor: ['indoors', 'indoor', 'inside', 'in a room', 'in the room', 'at home', 'in the house', 'in a hall', 'in the hall', 'in a restaurant'],
};
const RELATIONS = ['mom', 'mother', 'mummy', 'maa', 'dad', 'father', 'papa', 'wife', 'husband', 'brother', 'sister', 'bhai', 'didi', 'friend', 'friends', 'cousin', 'uncle', 'aunt', 'grandma', 'grandpa', 'son', 'daughter', 'baby', 'kid', 'kids', 'family', 'colleague', 'boss', 'teacher'];

const STOP = new Set(('a an the of in on at to for from with without and or but my me i we us our you your was were is are be been am it its this that those these there here photo photos picture pictures pic pics image images ' +
  'one some any find show search searching looking look looked want need where when which who whom what how did do does have has had taken take took clicked click saw see seen remember remembered think thought maybe ' +
  'about around roughly approximately wearing wore wear worn there then than very really just also only like got get give gave please can could would should will shall ever last first one-time sometime somewhere something someone ' +
  'taken during while after before near ago back old new some few many much').split(/\s+/));

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* normalisation shared by the query parser and the index so "Mom's 60th" == "moms 60th" */
const normText = s => String(s == null ? '' : s).toLowerCase().replace(/[’']s\b/g, '').replace(/[’']/g, '').replace(/[\u201c\u201d"?!.;:(),]/g, ' ').replace(/\s+/g, ' ').trim();
/* tags also fold plurals/possessives (moms == mom's == mom) so typing without the apostrophe still matches */
const stemWord = w => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);
const normTag = t => normText(t).split(' ').map(stemWord).join(' ');
const wordRe = (w, flags = 'i') => new RegExp('(?:^|[^a-z0-9])' + esc(w) + '(?:s|es)?(?=$|[^a-z0-9])', flags);
const hasWord = (s, w) => wordRe(w).test(s);
const monIdx = w => { let i = MONTHS.indexOf(w); if (i < 0 && w.length >= 3 && w.length <= 4) i = MABBR.indexOf(w.slice(0, 3)); return i; };
const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, few: 3 };
const num = w => NUM_WORDS[w] != null ? NUM_WORDS[w] : (/^\d+$/.test(w) ? +w : null);

/* ---------- dates (also handles vague "6 years back") ---------- */
function parseDates(text, now) {
  const nowD = new Date(now), out = []; let rest = ' ' + text + ' ';
  const sod = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), today = sod(nowD);
  const take = (re, fn) => { let m; while ((m = re.exec(rest))) { const r = fn(m); rest = rest.replace(m[0], ' '); if (r) out.push(r); re.lastIndex = 0; } };
  const rng = (s, e, label, soft = 0, extra = {}) => ({ s, e, label, soft, ...extra });
  take(/ today /, () => rng(today, today + DAY, 'Today'));
  take(/ yesterday /, () => rng(today - DAY, today, 'Yesterday'));
  take(/ this week /, () => rng(today - 6 * DAY, today + DAY, 'This week'));
  take(/ last week /, () => rng(today - 13 * DAY, today - 6 * DAY, 'Last week', 3 * DAY));
  take(/ this month /, () => rng(new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime(), new Date(nowD.getFullYear(), nowD.getMonth() + 1, 1).getTime(), 'This month'));
  take(/ last month /, () => rng(new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1).getTime(), new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime(), 'Last month', 10 * DAY));
  take(/ this year /, () => rng(new Date(nowD.getFullYear(), 0, 1).getTime(), new Date(nowD.getFullYear() + 1, 0, 1).getTime(), String(nowD.getFullYear())));
  take(/ last year /, () => rng(new Date(nowD.getFullYear() - 1, 0, 1).getTime(), new Date(nowD.getFullYear(), 0, 1).getTime(), String(nowD.getFullYear() - 1), 45 * DAY));
  // "around 6 years back", "two years ago", "a few years ago", "about 3 months ago"
  take(/ (?:around |about |roughly |almost |nearly )?(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few|\d{1,2})(?: of| or so)? (years?|months?|weeks?) (?:ago|back|before|earlier) /, m => {
    const n = num(m[1]); if (!n) return null; const u = m[2][0];
    if (u === 'y') { const y = nowD.getFullYear() - n; return rng(new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime(), `around ${y} (${n} year${n > 1 ? 's' : ''} ago)`, 365 * DAY, { vague: true }); }
    if (u === 'm') { const c = new Date(nowD.getFullYear(), nowD.getMonth() - n, 15).getTime(); return rng(c - 20 * DAY, c + 20 * DAY, `around ${n} month${n > 1 ? 's' : ''} ago`, 30 * DAY, { vague: true }); }
    const c = today - n * 7 * DAY; return rng(c - 4 * DAY, c + 4 * DAY, `around ${n} week${n > 1 ? 's' : ''} ago`, 7 * DAY, { vague: true });
  });
  take(/ (\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9}),? (\d{4}) /, m => { const mi = monIdx(m[2]); return mi < 0 ? null : rng(new Date(+m[3], mi, +m[1]).getTime(), new Date(+m[3], mi, +m[1] + 1).getTime(), `${m[1]} ${cap(MONTHS[mi])} ${m[3]}`, 2 * DAY); });
  take(/ ([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?,? (\d{4}) /, m => { const mi = monIdx(m[1]); return mi < 0 ? null : rng(new Date(+m[3], mi, +m[2]).getTime(), new Date(+m[3], mi, +m[2] + 1).getTime(), `${cap(MONTHS[mi])} ${m[2]}, ${m[3]}`, 2 * DAY); });
  take(/ (?:on )?(\d{1,2})(?:st|nd|rd|th)? (january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec) /, m => { const mi = monIdx(m[2]); if (mi < 0) return null; let y = nowD.getFullYear(); if (new Date(y, mi, +m[1]) > nowD) y--; return rng(new Date(y, mi, +m[1]).getTime(), new Date(y, mi, +m[1] + 1).getTime(), `${m[1]} ${cap(MONTHS[mi])}`, 2 * DAY); });
  take(/ (january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec),? (\d{4}) /, m => { const mi = monIdx(m[1]); return mi < 0 ? null : rng(new Date(+m[2], mi, 1).getTime(), new Date(+m[2], mi + 1, 1).getTime(), `${cap(MONTHS[mi])} ${m[2]}`, 14 * DAY); });
  take(/ (?:in |during |of |from )?(19\d{2}|20\d{2}) /, m => rng(new Date(+m[1], 0, 1).getTime(), new Date(+m[1] + 1, 0, 1).getTime(), m[1], 45 * DAY));
  take(/ (?:in |during |of )?(january|february|march|april|may|june|july|august|september|october|november|december) /, m => { const mi = monIdx(m[1]); return { month: mi, label: cap(MONTHS[mi]), s: 0, e: 0, soft: 0 }; });
  return { ranges: out, rest: rest.replace(/\s+/g, ' ').trim() };
}
const cap = s => s[0].toUpperCase() + s.slice(1);

/* ---------- main parser ---------- */
function parse(raw, ctx = {}) {
  const now = ctx.now || Date.now();
  raw = String(raw || '').trim();
  const out = { raw, dates: [], types: [], setting: null, attire: [], events: [], people: [], places: [], tags: [], text: [], relations: [], unknownNames: [], chips: [], empty: false };
  if (!raw) { out.empty = true; return out; }
  let s = ' ' + raw.toLowerCase().replace(/[“”"]/g, ' ').replace(/[’]/g, "'").replace(/'s\b/g, '').replace(/[?!.;:()]/g, ' ').replace(/,/g, ' ') + ' ';

  // #tags and tag:name
  s = s.replace(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu, (_, t) => { out.tags.push(t); return ' '; }).replace(/\btag:([\p{L}\p{N}_-]+)/gu, (_, t) => { out.tags.push(t); return ' '; });
  // user-defined tags written as plain words (exact tag names the user created)
  { const sTag = ' ' + normTag(s) + ' ';
    for (const t of (ctx.tags || [])) { const tl = normTag(t); if (tl.length >= 3 && /\s/.test(tl) && sTag.includes(' ' + tl + ' ')) { out.tags.push(tl); normText(t).split(' ').forEach(w => { s = s.replace(new RegExp('(^|\\s)' + esc(w) + "'?s?(?=\\s|$)", 'i'), ' '); }); } } }

  // dates
  const d = parseDates(s.replace(/\s+/g, ' '), now); out.dates = d.ranges; s = ' ' + d.rest + ' ';

  // types
  Object.keys(TYPE_WORDS).sort((a, b) => b.length - a.length).forEach(w => { if (hasWord(s, w)) { const t = TYPE_WORDS[w]; if (!out.types.includes(t)) out.types.push(t); s = s.replace(wordRe(w, 'gi'), ' '); } });

  // indoor / outdoor
  for (const [k, ws] of Object.entries(SETTINGS)) for (const w of ws.sort((a, b) => b.length - a.length)) if (s.includes(' ' + w + ' ')) { out.setting = k; s = s.replace(' ' + w + ' ', ' '); break; }

  // events
  for (const [id, syn] of Object.entries(EVENTS)) for (const w of [...syn].sort((a, b) => b.length - a.length)) if (hasWord(s, w)) { if (!out.events.includes(id)) out.events.push(id); s = s.replace(wordRe(w, 'gi'), ' '); break; }

  // known people (full name, or first name of ≥3 letters)
  for (const p of (ctx.people || [])) {
    if (!p.name) continue; const full = p.name.toLowerCase(), first = full.split(/\s+/)[0];
    if (hasWord(s, full) || (first.length >= 3 && hasWord(s, first))) { out.people.push({ id: p.id, name: p.name }); s = s.replace(wordRe(full, 'gi'), ' ').replace(wordRe(first, 'gi'), ' '); }
  }
  // "with <Name>" that is not a known person → remember as unknown name (matched as text in notes/tags)
  for (const m of raw.matchAll(/\b(?:with|and)\s+([A-Z][a-z]{2,})(?:\s+([A-Z][a-z]{2,}))?/g)) {
    const nm = m[1].toLowerCase(); if (STOP.has(nm) || out.people.some(p => p.name.toLowerCase().includes(nm))) continue;
    if (!out.unknownNames.includes(nm) && !MONTHS.includes(nm)) out.unknownNames.push(nm);
  }

  // places: known place strings (full, or the city part before the first comma)
  const placeSet = new Set();
  for (const full of (ctx.places || [])) { const f = full.toLowerCase(); const city = f.split(',')[0].trim(); const country = f.includes(',') ? f.split(',').pop().trim() : ''; for (const cand of [f, city, country]) if (cand && cand.length >= 3 && hasWord(s, cand) && !placeSet.has(cand)) { placeSet.add(cand); out.places.push({ name: full, match: cand, level: cand === country ? 'country' : 'city' }); s = s.replace(wordRe(cand, 'gi'), ' '); } }

  // attire: [color] [garment]
  const toks = s.split(/\s+/).filter(Boolean), used = new Set();
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i], g = GARMENTS.includes(w.replace(/s$/, '')) ? w.replace(/s$/, '') : (GARMENTS.includes(w) ? w : null), c = COLOR_OF[w];
    if (c) {
      const nx = toks[i + 1], ng = nx && (GARMENTS.includes(nx) || GARMENTS.includes(nx.replace(/s$/, ''))) ? (GARMENTS.includes(nx) ? nx : nx.replace(/s$/, '')) : null;
      if (ng) { out.attire.push({ color: c, garment: GARMENT_NORM[ng] || ng, text: `${w} ${nx}` }); used.add(i); used.add(i + 1); i++; }
      else { const worn = /wear|wore|dressed|in a|in an|in/.test(toks.slice(Math.max(0, i - 3), i).join(' ')); out.attire.push({ color: c, garment: null, text: w, bare: true, worn }); used.add(i); }
    } else if (g && !used.has(i)) { out.attire.push({ color: null, garment: GARMENT_NORM[g] || g, text: w }); used.add(i); }
  }
  const remaining = toks.filter((_, i) => !used.has(i));

  // relations and free text
  for (const w of remaining) {
    const wl = w.replace(/^['-]+|['-]+$/g, ''); if (!wl || wl.length < 2) continue;
    if (RELATIONS.includes(wl)) { if (!out.relations.includes(wl)) out.relations.push(wl); continue; }
    if (STOP.has(wl) || /^\d+$/.test(wl) || wl.length < 3) continue;
    const stem = wl.length > 4 ? wl.replace(/(es|s)$/, '') : wl; if (!out.text.includes(stem)) out.text.push(stem);
  }

  // chips for the UI
  const chip = (kind, label, extra = {}) => out.chips.push({ kind, label, ...extra });
  out.dates.forEach((r, i) => chip('date', r.label, { idx: i }));
  out.people.forEach(p => chip('person', p.name, { id: p.id }));
  out.unknownNames.forEach(n => chip('name', cap(n), { note: 'not a known person — searched in tags & notes' }));
  out.places.forEach(p => chip('place', p.name.split(',')[0]));
  out.events.forEach(e => chip('event', cap(e), { emoji: EVENT_EMOJI[e] }));
  out.attire.forEach(a => chip('attire', a.text, { approx: true }));
  if (out.setting) chip('setting', out.setting === 'indoor' ? 'Indoors' : 'Outdoors');
  out.types.forEach(t => chip('type', cap(t)));
  out.tags.forEach(t => chip('tag', '#' + t));
  out.relations.forEach(r => chip('text', r));
  out.text.forEach(t => chip('text', t));
  out.empty = !out.chips.length;
  return out;
}

return { parse, parseDates, normText, normTag, COLORS, COLOR_OF, GARMENTS, EVENTS, EVENT_EMOJI, RELATIONS, SETTINGS, STOP, hasWord, wordRe, cap, MONTHS };
});
