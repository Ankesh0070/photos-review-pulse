/* Search: natural-language dates, people, places, albums, labels, OCR text, types, filters, history */
(() => {
const { $, el, icon } = P;
const MONTHS = P.MONTHS.map(m => m.toLowerCase()), MABBR = MONTHS.map(m => m.slice(0, 3));
const TYPE_WORDS = {
  video: p => p.kind === 'video', videos: p => p.kind === 'video', photo: p => p.kind === 'image', photos: p => p.kind === 'image',
  selfie: p => p.selfie, selfies: p => p.selfie, screenshot: p => p.screenshot, screenshots: p => p.screenshot,
  panorama: p => p.pano, panoramas: p => p.pano, document: p => p.doc || /document|menu|book jacket|envelope/.test((p.labels || []).join(' ')) || (p.ocr && p.ocr.length > 80), documents: p => p.doc || (p.ocr && p.ocr.length > 80),
  favorite: p => p.fav, favorites: p => p.fav, favourite: p => p.fav, favourites: p => p.fav, starred: p => p.fav, edited: p => p.edited, archived: p => p.archived, gif: p => /gif/.test(p.type), animation: p => /gif|webm/.test(p.type) && p.kind !== 'image',
};

function parseDates(q) {
  const now = new Date(), out = []; let rest = ' ' + q.toLowerCase() + ' ';
  const sod = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), day = 86400000, today = sod(now);
  const take = (re, fn) => { const m = re.exec(rest); if (m) { out.push(fn(m)); rest = rest.replace(re, ' '); } };
  take(/ today /, () => ({ s: today, e: today + day, label: 'Today' }));
  take(/ yesterday /, () => ({ s: today - day, e: today, label: 'Yesterday' }));
  take(/ this week /, () => ({ s: today - 6 * day, e: today + day, label: 'This week' }));
  take(/ last week /, () => ({ s: today - 13 * day, e: today - 6 * day, label: 'Last week' }));
  take(/ this month /, () => ({ s: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), e: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(), label: 'This month' }));
  take(/ last month /, () => ({ s: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(), e: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), label: 'Last month' }));
  take(/ this year /, () => ({ s: new Date(now.getFullYear(), 0, 1).getTime(), e: new Date(now.getFullYear() + 1, 0, 1).getTime(), label: String(now.getFullYear()) }));
  take(/ last year /, () => ({ s: new Date(now.getFullYear() - 1, 0, 1).getTime(), e: new Date(now.getFullYear(), 0, 1).getTime(), label: String(now.getFullYear() - 1) }));
  take(/ (\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9}),? (\d{4}) /, m => { const mi = mon(m[2]); return mi < 0 ? null : { s: new Date(+m[3], mi, +m[1]).getTime(), e: new Date(+m[3], mi, +m[1] + 1).getTime(), label: `${m[1]} ${P.MONTHS[mi]} ${m[3]}` }; });
  take(/ ([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?,? (\d{4}) /, m => { const mi = mon(m[1]); return mi < 0 ? null : { s: new Date(+m[3], mi, +m[2]).getTime(), e: new Date(+m[3], mi, +m[2] + 1).getTime(), label: `${P.MONTHS[mi]} ${m[2]}, ${m[3]}` }; });
  take(/ (?:on )?(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9}) /, m => { const mi = mon(m[2]); if (mi < 0) return null; let y = now.getFullYear(); if (new Date(y, mi, +m[1]) > now) y--; return { s: new Date(y, mi, +m[1]).getTime(), e: new Date(y, mi, +m[1] + 1).getTime(), label: `${m[1]} ${P.MONTHS[mi]}` }; });
  take(/ ([a-z]{3,9}) (\d{4}) /, m => { const mi = mon(m[1]); return mi < 0 ? null : { s: new Date(+m[2], mi, 1).getTime(), e: new Date(+m[2], mi + 1, 1).getTime(), label: `${P.MONTHS[mi]} ${m[2]}` }; });
  take(/ (?:in |during )?(19\d{2}|20\d{2}) /, m => ({ s: new Date(+m[1], 0, 1).getTime(), e: new Date(+m[1] + 1, 0, 1).getTime(), label: m[1] }));
  take(/ (?:in )?(january|february|march|april|may|june|july|august|september|october|november|december) /, m => { const mi = mon(m[1]); let y = now.getFullYear(); return { month: mi, label: P.MONTHS[mi] }; });
  return { ranges: out.filter(Boolean), rest: rest.trim() };
}
function mon(s) { let i = MONTHS.indexOf(s); if (i < 0) i = MABBR.indexOf(s.slice(0, 3)) >= 0 && s.length <= 4 ? MABBR.indexOf(s.slice(0, 3)) : -1; return i; }

function peopleByName() { const m = new Map(); for (const per of P.M.people.values()) if (per.name) m.set(per.name.toLowerCase(), per.id); return m; }

/* returns {photos, chips} */
function run(q, filt = {}) {
  q = (q || '').trim();
  const chips = [], preds = [];
  const { ranges, rest } = parseDates(q);
  ranges.forEach(r => { chips.push({ icon: 'calendar_today', label: r.label }); preds.push(r.month != null ? (p => new Date(p.takenAt).getMonth() === r.month) : (p => p.takenAt >= r.s && p.takenAt < r.e)); });
  const names = peopleByName(), albumsByName = new Map([...P.M.albums.values()].map(a => [a.name.toLowerCase(), a.id]));
  let tokens = (rest.match(/"[^"]+"|\S+/g) || []).map(t => t.replace(/"/g, '').toLowerCase()).filter(t => t && !['in', 'of', 'at', 'the', 'a', 'on', 'and', 'with', 'from', 'my', 'me'].includes(t) || t === 'me');
  // multi-word people / albums / places
  const joined = ' ' + tokens.join(' ') + ' ';
  const used = new Set();
  for (const [n, id] of names) if (joined.includes(' ' + n + ' ')) { chips.push({ icon: 'face', label: P.M.people.get(id).name }); preds.push(p => P.M.faces.some(f => f.photoId === p.id && f.personId === id)); n.split(' ').forEach(w => used.add(w)); }
  for (const [n, id] of albumsByName) if (joined.includes(' ' + n + ' ')) { const set = new Set(P.albumItems(id).map(i => i.photoId)); chips.push({ icon: 'photo_album', label: P.M.albums.get(id).name }); preds.push(p => set.has(p.id)); n.split(' ').forEach(w => used.add(w)); }
  tokens = tokens.filter(t => !used.has(t));
  const textTokens = [];
  for (const t of tokens) {
    if (TYPE_WORDS[t]) { const f = TYPE_WORDS[t]; chips.push({ icon: t.startsWith('video') ? 'videocam' : t.startsWith('fav') || t === 'starred' ? 'star' : 'category', label: t[0].toUpperCase() + t.slice(1) }); preds.push(f); }
    else if (t === 'me') continue;
    else textTokens.push(t);
  }
  for (const t of textTokens) { chips.push({ icon: 'search', label: t }); preds.push(textMatch(t, albumsByName)); }
  // structured filters
  if (filt.types?.length) { chips.push({ icon: 'category', label: filt.types.join(', ') }); preds.push(p => filt.types.some(t => TYPE_WORDS[t]?.(p))); }
  if (filt.from || filt.to) { const s = filt.from ? new Date(filt.from).getTime() : 0, e = filt.to ? new Date(filt.to).getTime() + 86400000 : 8.64e15; chips.push({ icon: 'date_range', label: `${filt.from || '…'} → ${filt.to || '…'}` }); preds.push(p => p.takenAt >= s && p.takenAt < e); }
  if (filt.person) { const per = P.M.people.get(filt.person); chips.push({ icon: 'face', label: per?.name || 'Person' }); preds.push(p => P.M.faces.some(f => f.photoId === p.id && f.personId === filt.person)); }
  if (filt.album) { const set = new Set(P.albumItems(filt.album).map(i => i.photoId)); chips.push({ icon: 'photo_album', label: P.M.albums.get(filt.album)?.name || 'Album' }); preds.push(p => set.has(p.id)); }
  if (filt.place) { chips.push({ icon: 'place', label: filt.place }); preds.push(p => (p.loc?.place || '').toLowerCase().includes(filt.place.toLowerCase())); }
  if (filt.fav) { chips.push({ icon: 'star', label: 'Favorites' }); preds.push(p => p.fav); }
  if (filt.hasLoc) { chips.push({ icon: 'location_on', label: 'Has location' }); preds.push(p => !!p.loc); }
  const wantsArchived = TYPE_WORDS.archived && /\barchived\b/i.test(q);
  const pool = P.list(p => P.live(p) && (!p.archived || wantsArchived || true));
  const peopleFace = new Map(); // photoId -> names (for text match)
  const photos = preds.length ? pool.filter(p => preds.every(f => f(p))) : [];
  return { photos, chips, empty: !preds.length };
}
function textMatch(t, albumsByName) {
  const peopleNames = new Map(); for (const f of P.M.faces) { const per = P.M.people.get(f.personId); if (per?.name) { if (!peopleNames.has(f.photoId)) peopleNames.set(f.photoId, ''); peopleNames.set(f.photoId, peopleNames.get(f.photoId) + ' ' + per.name.toLowerCase()); } }
  const albumNames = new Map(); for (const it of P.M.items) { const a = P.M.albums.get(it.albumId); if (a) albumNames.set(it.photoId, (albumNames.get(it.photoId) || '') + ' ' + a.name.toLowerCase()); }
  const plural = t.endsWith('s') ? t.slice(0, -1) : t;
  return p => {
    const h = `${p.name} ${p.desc} ${(p.labels || []).join(' ')} ${p.loc?.place || ''} ${p.cam ? (p.cam.make || '') + ' ' + (p.cam.model || '') : ''} ${peopleNames.get(p.id) || ''} ${albumNames.get(p.id) || ''} ${p.ocr || ''} ${p.kind} ${P.MONTHS[new Date(p.takenAt).getMonth()]}`.toLowerCase();
    return h.includes(t) || h.includes(plural);
  };
}

/* ---------- suggestions UI ---------- */
let open = false;
function getHist() { if (!P.memory) return []; const seen = new Set(); return P.memory.history.all().filter(r => r.q).sort((a, b) => b.updatedAt - a.updatedAt).map(r => r.q).filter(q => { const k = q.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); }
function pushHistory(q) { /* history is recorded by the results view (memory.js) so it can keep answers + status */ }
function go(q, filt) { $('#search-input').value = q; $('#search-clear').classList.toggle('hidden', !q); pushHistory(q); closeSuggest(); $('#search-input').blur(); location.hash = '#/search/' + encodeURIComponent(q) + (filt ? '/' + encodeURIComponent(JSON.stringify(filt)) : ''); }
function closeSuggest() { $('#suggest').classList.add('hidden'); open = false; $('#searchbar').classList.remove('open'); }
function renderSuggest() {
  const box = $('#suggest'), v = $('#search-input').value.trim().toLowerCase(); box.innerHTML = ''; box.classList.remove('hidden'); open = true; $('#searchbar').classList.add('open');
  const sect = (t, node) => { box.appendChild(el('div', { class: 'sg-h' }, t)); box.appendChild(node); };
  const row = (ic, text, fn, sub, x) => el('div', { class: 'sg-row', onclick: fn }, icon(ic), el('div', { class: 'sg-t' }, text, sub ? el('small', {}, sub) : null), x || null);
  if (v) {
    const frag = el('div', {});
    frag.appendChild(row('search', `Search for “${$('#search-input').value.trim()}”`, () => go($('#search-input').value.trim())));
    for (const per of P.M.people.values()) if (per.name && per.name.toLowerCase().includes(v)) frag.appendChild(row('face', per.name, () => location.hash = '#/person/' + per.id, 'Person'));
    for (const a of P.M.albums.values()) if (a.name.toLowerCase().includes(v)) frag.appendChild(row('photo_album', a.name, () => location.hash = '#/album/' + a.id, 'Album'));
    const places = new Set(); for (const p of P.M.photos.values()) { const pl = p.loc?.place; if (pl && pl.toLowerCase().includes(v)) places.add(pl); } [...places].slice(0, 4).forEach(pl => frag.appendChild(row('place', pl, () => go(pl), 'Place')));
    const labels = new Set(); for (const p of P.M.photos.values()) (p.labels || []).forEach(l => { if (l.toLowerCase().includes(v)) labels.add(l); }); [...labels].slice(0, 5).forEach(l => frag.appendChild(row('category', l, () => go(l), 'Thing')));
    getHist().filter(h => h.toLowerCase().includes(v) && h.toLowerCase() !== v).slice(0, 3).forEach(h => frag.appendChild(row('history', h, () => go(h))));
    box.appendChild(frag); return;
  }
  const sd = P.memory ? P.memory.suggestData() : { unfinished: [], saved: [], recent: [] }, M = P.memory && P.memory.history;
  if (sd.unfinished.length) sect('Continue where you left off', el('div', {}, ...sd.unfinished.map(r => row('play_circle', M.label(r), () => { closeSuggest(); location.hash = M.hash(r); }, (r.resultCount ? P.pluralize(r.resultCount, 'photo') + ' could be it' : 'No match yet') + ((r.answers || []).length ? ' · ' + P.pluralize(r.answers.length, 'answer') + ' saved' : '') + ' · ' + P.fmt.rel(r.updatedAt), el('span', { class: 'chip unclear' }, 'Resume')))));
  if (sd.saved.length) sect('Saved searches', el('div', {}, ...sd.saved.map(r => row('bookmark', M.label(r), () => { closeSuggest(); location.hash = M.hash(r); }, (r.newMatches || []).length ? P.pluralize(r.newMatches.length, 'new photo') + ' match' : P.pluralize(r.resultCount || 0, 'photo'), (r.newMatches || []).length ? el('span', { class: 'chip new' }, 'New') : null))));
  if (sd.recent.length) sect('Recent searches', el('div', {}, ...sd.recent.slice(0, 5).map(r => row('history', r.q, () => go(r.q, r.filters && Object.keys(r.filters).length ? r.filters : null), r.status === 'resolved' ? 'Found it' : '', el('button', { class: 'ib sm', title: 'Remove', onclick: async e => { e.stopPropagation(); await M.remove(r.id); P.memory.paintBadge(); renderSuggest(); } }, icon('close'))))));
  const ppl = [...P.M.people.values()].filter(p => !(P.M.settings.hiddenPeople || []).includes(p.id));
  if (ppl.length) sect('People & pets', el('div', { class: 'sg-people' }, ...ppl.slice(0, 8).map(per => el('button', { class: 'sg-p', onclick: () => location.hash = '#/person/' + per.id }, el('img', { src: per.avatar, alt: '' }), el('span', {}, per.name || 'Add name')))));
  const cats = [['Videos', 'videocam'], ['Selfies', 'face_retouching_natural'], ['Screenshots', 'screenshot'], ['Panoramas', 'panorama'], ['Documents', 'description'], ['Favorites', 'star'], ['Edited', 'tune'], ['Last year', 'history_toggle_off'], ['This month', 'event']];
  sect('Categories', el('div', { class: 'sg-cats' }, ...cats.map(([n, ic]) => el('button', { class: 'sg-c', onclick: () => go(n.toLowerCase()) }, icon(ic), n))));
  const places = new Map(); for (const p of P.M.photos.values()) { const pl = p.loc?.place; if (pl && !p.trashedAt && !p.locked) places.set(pl, (places.get(pl) || 0) + 1); }
  if (places.size) sect('Places', el('div', { class: 'sg-cats' }, ...[...places].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => el('button', { class: 'sg-c', onclick: () => go(n) }, icon('place'), n))));
  sect('Describe what you remember', el('div', {}, ...['Pink dress at my friend’s wedding', 'Beach trip around 3 years back', 'Photos with Mom indoors', 'Videos from last year'].map(t => row('psychology', t, () => go(t)))));
}

async function filterDialog(initial = {}) {
  const f = { ...initial }, types = new Set(f.types || []);
  const body = el('div', { class: 'filters' });
  const typeRow = el('div', { class: 'chips' }); [['photo', 'Photos'], ['video', 'Videos'], ['selfie', 'Selfies'], ['screenshot', 'Screenshots'], ['panorama', 'Panoramas'], ['document', 'Documents'], ['edited', 'Edited']].forEach(([k, l]) => {
    const b = el('button', { class: 'chip' + (types.has(k) ? ' on' : ''), onclick: () => { types.has(k) ? types.delete(k) : types.add(k); b.classList.toggle('on'); } }, l); typeRow.appendChild(b);
  });
  const from = el('input', { type: 'date', class: 'field', value: f.from || '' }), to = el('input', { type: 'date', class: 'field', value: f.to || '' });
  const person = el('select', { class: 'field' }, el('option', { value: '' }, 'Anyone'), ...[...P.M.people.values()].map(p => el('option', { value: p.id, selected: p.id === f.person }, p.name || 'Unnamed')));
  const album = el('select', { class: 'field' }, el('option', { value: '' }, 'Any album'), ...[...P.M.albums.values()].map(a => el('option', { value: a.id, selected: a.id === f.album }, a.name)));
  const place = el('input', { class: 'field', placeholder: 'Any place', value: f.place || '' });
  const fav = el('input', { type: 'checkbox', checked: !!f.fav }), loc = el('input', { type: 'checkbox', checked: !!f.hasLoc });
  body.append(el('label', {}, 'Type'), typeRow, el('div', { class: 'two' }, el('label', {}, 'From', from), el('label', {}, 'To', to)), el('label', {}, 'People', person), el('label', {}, 'Album', album), el('label', {}, 'Place', place),
    el('label', { class: 'chk' }, fav, ' Favorites only'), el('label', { class: 'chk' }, loc, ' Only photos with location'));
  const r = await P.dialog({ title: 'Search filters', body, actions: [{ label: 'Clear', value: 'clear' }, { label: 'Cancel', value: null }, { label: 'Search', value: 'go', primary: true }] });
  if (r === 'clear') return {}; if (r !== 'go') return null;
  const out = {}; if (types.size) out.types = [...types]; if (from.value) out.from = from.value; if (to.value) out.to = to.value; if (person.value) out.person = person.value; if (album.value) out.album = album.value; if (place.value.trim()) out.place = place.value.trim(); if (fav.checked) out.fav = true; if (loc.checked) out.hasLoc = true;
  return out;
}

/* ---------- results view: handled by memory.js (natural-language engine + assistant) ---------- */
async function renderResults(out, params) { return P.memory.results(out, params); }
const emptyState = (ic, t, s, actions) => el('div', { class: 'empty' }, icon(ic), el('h2', {}, t), el('p', {}, s), actions || null);

document.addEventListener('DOMContentLoaded', () => {
  const inp = $('#search-input');
  inp.addEventListener('focus', renderSuggest); inp.addEventListener('input', () => { $('#search-clear').classList.toggle('hidden', !inp.value); renderSuggest(); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (inp.value.trim()) go(inp.value.trim()); } if (e.key === 'Escape') { inp.blur(); closeSuggest(); } });
  $('#search-clear').onclick = () => { inp.value = ''; $('#search-clear').classList.add('hidden'); inp.focus(); };
  $('#search-go').onclick = () => inp.value.trim() ? go(inp.value.trim()) : inp.focus();
  $('#search-tune').onclick = async () => { const f = await filterDialog(); if (f && Object.keys(f).length) go(inp.value.trim(), f); };
  document.addEventListener('mousedown', e => { if (open && !$('#searchbar').contains(e.target) && !$('#suggest').contains(e.target)) closeSuggest(); });
});

P.search = { run, go, renderResults, filterDialog, parseDates, emptyState };
})();

