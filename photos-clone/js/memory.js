/* Memory search UI: natural-language results, interactive assistant, history / saved searches / alerts.
 * Pure logic lives in nlp.js + engine.js (unit-tested); this file wires it to the DOM and storage. */
(() => {
const { $, el, icon } = P;
const nlp = P.nlp, E = P.engine;
const DAY = 86400000;

/* ================= index cache ================= */
let idx = null, building = null, ver = 0, lastOut = new Map();
const invalidate = () => { ver++; idx = null; };
P.on('photos', invalidate); P.on('albums', invalidate); P.on('features:ready', invalidate);
P.on('clip:state', invalidate);
P.on('clip:progress', P.debounce(invalidate, 1500));

async function getIndex() {
  if (idx) return idx; if (building) return building;
  const my = ver;
  building = (async () => {
    await P.features.loadAll();
    const cm = P.features.cacheMap(), missing = [...P.M.photos.values()].filter(p => !p.trashedAt && !p.locked && !cm.has(p.id));
    if (missing.length && missing.length <= 120) await P.features.ensureAll(missing.map(p => p.id)); else if (missing.length) P.features.backfill();
    const clipOut = P.features.clip.state() === 'ready' ? await P.features.clip.outdoorMap() : null;
    return E.buildIndex({ photos: [...P.M.photos.values()], faces: P.M.faces, people: [...P.M.people.values()], albums: [...P.M.albums.values()], items: P.M.items, features: cm, clipOut, now: Date.now() });
  })().then(i => { building = null; if (my !== ver) return getIndex(); idx = i; return i; }, e => { building = null; throw e; });
  return building;
}
const ready = () => !!idx;
const warm = P.debounce(() => { (window.requestIdleCallback || (f => setTimeout(f, 200)))(() => getIndex().catch(() => { })); }, 2500);
P.on('photos', warm); P.on('notes:changed', () => { invalidate(); });

function moment(photoId) {
  if (!idx) return undefined; const e = idx.entries.get(photoId); if (!e) return null; const ep = idx.eps[e.ep]; if (!ep) return null;
  return { ids: ep.ids.slice(), n: ep.ids.length, t0: ep.t0, t1: ep.t1, place: e.place || e.epPlace };
}
const explain = id => lastOut.get(id) || null;

const parseCtx = i => ({ now: i.now, people: [...P.M.people.values()].filter(p => p.name).map(p => ({ id: p.id, name: p.name })), places: i.places, albums: [...P.M.albums.values()].map(a => a.name), tags: P.notes.allTags().map(t => t.name) });

/* ================= history / saved searches ================= */
const keyOf = S => nlp.normText(S.q || '') + '|' + JSON.stringify(S.filters || {});
const H = {
  all: () => [...P.M.searches.values()],
  async put(rec) { P.M.searches.set(rec.id, rec); await P.db.put('searches', rec); },
  unfinished: r => r.status === 'open' && !r.dismissed && Date.now() - r.updatedAt < 30 * DAY && (r.resultCount === 0 || r.strongCount === 0 || (r.answers || []).length > 0 || r.assistantOpened),
  async touch(S, res) {
    if (!(S.q || '').trim()) return null;
    let rec = S.rec || H.all().find(r => r.key === keyOf(S));
    const isNew = !rec;
    if (!rec) rec = { id: P.uid(), key: keyOf(S), q: S.q, filters: S.filters || {}, createdAt: Date.now(), status: 'open', answers: [], removed: [], skipped: [], extra: '', saved: false, alert: false, newMatches: [], views: 0 };
    const before = JSON.stringify([rec.resultCount, rec.strongCount, rec.answers, rec.removed, rec.extra, rec.skipped, rec.assistantOpened]);
    rec.resultCount = res.out.total; rec.strongCount = res.out.strong; rec.answers = S.answers; rec.removed = S.removed; rec.extra = S.extra; rec.skipped = S.skipped; rec.assistantOpened = rec.assistantOpened || S.assistantUsed;
    if (isNew || JSON.stringify([rec.resultCount, rec.strongCount, rec.answers, rec.removed, rec.extra, rec.skipped, rec.assistantOpened]) !== before) { rec.updatedAt = Date.now(); if (isNew) { rec.views = 1; } await H.put(rec); if (isNew) await H.trim(); }
    S.rec = rec; return rec;
  },
  async trim() { const list = H.all().filter(r => !r.saved).sort((a, b) => b.updatedAt - a.updatedAt); for (const r of list.slice(200)) { P.M.searches.delete(r.id); await P.db.del('searches', r.id); } },
  async resolve(rec, photoId) { rec.status = 'resolved'; rec.foundId = photoId; rec.resolvedAt = Date.now(); rec.updatedAt = Date.now(); await H.put(rec); },
  async remove(id) { P.M.searches.delete(id); await P.db.del('searches', id); },
  hash: r => '#/search/' + encodeURIComponent(r.q || '') + '/' + encodeURIComponent(JSON.stringify(r.filters || {})) + '/' + r.id,
  label: r => r.name || r.q || (r.filters && r.filters.tag ? 'Tag: ' + r.filters.tag : 'Search'),
};
const rel = P.fmt.rel;
function suggestData() {
  const all = H.all(), byTime = (a, b) => b.updatedAt - a.updatedAt;
  return { unfinished: all.filter(H.unfinished).sort(byTime).slice(0, 3), saved: all.filter(r => r.saved).sort(byTime).slice(0, 5), recent: all.filter(r => !r.saved && r.q).sort(byTime).slice(0, 6), newCount: all.filter(r => r.saved && (r.newMatches || []).length).length };
}
function badgeCount() { const all = H.all(); return all.filter(H.unfinished).length + all.filter(r => r.saved && (r.newMatches || []).length).length; }
function paintBadge() { const n = badgeCount(); P.$$('.nav[data-nav="searches"] .nav-badge').forEach(b => { b.textContent = n || ''; b.classList.toggle('hidden', !n); }); }
P.on('route', paintBadge);

/* ================= run a search ================= */
function dropRemoved(c, removed) {
  const gone = k => removed.includes(k);
  c.dates = c.dates.filter(r => !gone('date:' + r.label)); c.people = c.people.filter(p => !gone('person:' + p.name)); c.unknownNames = c.unknownNames.filter(n => !gone('name:' + nlp.cap(n)));
  c.places = c.places.filter(p => !gone('place:' + p.name.split(',')[0])); c.events = c.events.filter(e => !gone('event:' + nlp.cap(e))); c.attire = c.attire.filter(a => !gone('attire:' + a.text));
  if (c.setting && gone('setting:' + (c.setting === 'indoor' ? 'Indoors' : 'Outdoors'))) c.setting = null;
  c.types = c.types.filter(t => !gone('type:' + nlp.cap(t))); c.tags = c.tags.filter(t => !gone('tag:#' + t));
  c.text = c.text.filter(t => !gone('text:' + t)); c.relations = c.relations.filter(t => !gone('text:' + t));
  return c;
}
async function run(S) {
  const i = await getIndex(), text = (S.q || '') + (S.extra ? ' ' + S.extra : '');
  const clues0 = nlp.parse(text, parseCtx(i)); const tm = P.notes.tagMap();
  clues0.chips.forEach(c => { if (c.kind === 'tag') { const r = tm.get(nlp.normTag(c.label.slice(1))); c.display = '#' + (r ? r.name : c.label.slice(1)); } });   // show the tag as you typed it ("Mom’s 60th birthday")
  const clues = dropRemoved(JSON.parse(JSON.stringify(clues0)), S.removed || []);
  let semantic = null;
  if (P.features.clip.state() === 'ready' && text.trim() && !clues.empty) { try { semantic = await P.features.clip.semantic(text); } catch (e) { console.warn(e); } }
  const out = E.search(i, clues, { semantic, answers: S.answers || [], filters: S.filters && Object.keys(S.filters).length ? S.filters : null, tiers: S.loose ? { partial: 0.3 } : undefined });
  lastOut = new Map(out.results.map(r => [r.id, r]));
  return { i, clues0, clues, out, semantic: !!semantic };
}

const KIND_ICON = { date: 'calendar_today', person: 'face', name: 'person', place: 'place', event: 'celebration', attire: 'checkroom', setting: 'wb_sunny', type: 'category', tag: 'sell', text: 'search', relation: 'group', occasion: 'luggage' };

/* ================= results view ================= */
async function results(out, params) {
  const q = decodeURIComponent(params[0] || ''); let filters = {}; try { if (params[1]) filters = JSON.parse(decodeURIComponent(params[1])); } catch { }
  const S = { q, filters, answers: [], removed: [], skipped: [], extra: '', loose: false, assistantOpen: false, rec: null, resumed: false };
  const sid = params[2]; let existing = sid && P.M.searches.get(sid);
  if (!existing && q.trim()) existing = H.all().find(r => r.key === keyOf(S));
  if (existing) {
    S.rec = existing; if (sid || H.unfinished(existing)) { S.answers = existing.answers || []; S.removed = existing.removed || []; S.skipped = existing.skipped || []; S.extra = existing.extra || ''; S.assistantOpen = !!(existing.answers || []).length; S.resumed = !!(S.answers.length || S.removed.length || S.extra); }
    if (sid) { S.q = existing.q; S.filters = existing.filters || {}; }
  }
  const view = el('div', { class: 'view search-view' }); out.appendChild(view);
  P.sel.setContext('library');
  await paint(view, S);
}

async function paint(view, S, keepScroll) {
  const sc = $('#outlet'), top = keepScroll ? sc.scrollTop : 0;
  const res = await run(S); const rec = await H.touch(S, res);
  // auto-open the assistant when the search is vague / unresolved
  if (S.assistantOpen === false && !S._autoChecked && P.M.settings.assistant && !res.clues.empty && (res.out.strong === 0 || res.out.total > 12 || res.out.total === 0)) { S.assistantOpen = true; S.autoOpened = true; }
  S._autoChecked = true;
  view.innerHTML = '';
  const title = S.q ? `Results for “${S.q}”` : (S.filters && S.filters.tag ? `Tag: ${S.filters.tag}` : 'Search');
  const head = el('div', { class: 'view-head' }, el('button', { class: 'ib', 'aria-label': 'Back', onclick: () => history.back() }, icon('arrow_back')), el('h1', {}, title));
  const act = el('div', { class: 'view-actions' });
  if (rec) act.appendChild(el('button', { class: 'btn-o' + (rec.saved ? ' on' : ''), 'aria-pressed': !!rec.saved, onclick: () => toggleSave(rec, S, view) }, icon(rec.saved ? 'bookmark_added' : 'bookmark_add'), rec.saved ? ' Saved' : ' Save search'));
  act.appendChild(el('button', { class: 'btn-o', onclick: async () => { const f = await P.search.filterDialog(S.filters || {}); if (f) { S.filters = f; S.rec = null; await paint(view, S); } } }, icon('tune'), ' Filters'));
  if (P.M.settings.assistant && !res.clues.empty) act.appendChild(el('button', { class: 'btn-p', onclick: () => { S.assistantOpen = !S.assistantOpen; S.assistantUsed = true; paint(view, S, true); } }, icon('psychology'), S.assistantOpen ? ' Hide assistant' : ' Help me find it'));
  head.appendChild(act); view.appendChild(head);

  if (S.resumed && S.rec) view.appendChild(el('div', { class: 'note resumed' }, icon('history'), `Picked up where you left off — ${P.pluralize((S.answers || []).length, 'answer')} restored from ${rel(S.rec.updatedAt)}.`, el('button', { class: 'btn-t', onclick: async () => { S.answers = []; S.removed = []; S.skipped = []; S.extra = ''; S.resumed = false; S.loose = false; S.assistantOpen = false; S._autoChecked = false; await paint(view, S); } }, 'Start fresh')));
  if (rec && rec.status === 'resolved' && rec.foundId && P.M.photos.get(rec.foundId)) view.appendChild(foundBanner(rec, view, S));

  // clue chips
  const chips = el('div', { class: 'chips clues', role: 'group', 'aria-label': 'What I understood' });
  if (res.clues0.chips.length || (S.answers || []).length || Object.keys(S.filters || {}).length) chips.appendChild(el('span', { class: 'clue-lbl' }, 'I looked for:'));
  res.clues0.chips.forEach(c => {
    const key = c.kind + ':' + c.label, off = (S.removed || []).includes(key);
    chips.appendChild(el('button', { class: 'chip clue' + (off ? ' off' : ''), title: off ? 'Click to add this clue back' : (c.note || 'Click to ignore this clue'), onclick: () => { S.removed = off ? S.removed.filter(k => k !== key) : [...S.removed, key]; paint(view, S, true); } }, c.emoji ? el('span', { class: 'emo' }, c.emoji) : icon(KIND_ICON[c.kind] || 'label', 'sm'), (c.display || c.label) + (c.approx ? ' ≈' : ''), icon(off ? 'add' : 'close', 'sm')));
  });
  (S.answers || []).forEach((a, ai) => chips.appendChild(el('button', { class: 'chip clue ans', title: 'Click to undo this answer', onclick: () => { S.answers.splice(ai, 1); paint(view, S, true); } }, icon('chat_bubble', 'sm'), a.label, icon('close', 'sm'))));
  if (S.filters && S.filters.tag) chips.appendChild(el('span', { class: 'chip static' }, icon('sell', 'sm'), S.filters.tag));
  Object.entries(S.filters || {}).forEach(([k, v]) => { if (k !== 'tag') chips.appendChild(el('span', { class: 'chip static' }, icon('filter_alt', 'sm'), `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)); });
  if (chips.children.length > 1 || (chips.children.length === 1 && !chips.firstChild.classList.contains('clue-lbl'))) view.appendChild(chips);

  // hints
  if (res.clues.attire.length && P.features.clip.state() !== 'ready') view.appendChild(el('div', { class: 'note ai-hint' }, icon('auto_awesome'), 'Outfit and colour matching is approximate (pixel colours + your tags). On-device AI search understands descriptions like “pink dress” far better.', el('button', { class: 'btn-t', onclick: async () => { if (await enableClip()) paint(view, S); } }, 'Turn on')));
  const cp = P.features.clip.progress(); if (cp.indexing) view.appendChild(el('div', { class: 'note' }, icon('hourglass_top'), `AI index in progress: ${cp.done}/${cp.total} photos — results improve as it runs.`));

  // assistant
  if (S.assistantOpen && P.M.settings.assistant) view.appendChild(assistantCard(view, S, res));

  // summary + results
  const { out } = res;
  if (res.clues.empty && !(S.filters && Object.keys(S.filters).length)) { view.appendChild(P.search.emptyState('psychology', 'Describe what you remember', 'Try: “pink dress at my friend’s wedding”, “beach trip around 3 years back”, or “Mom’s 60th birthday”.')); return; }
  if (!out.total) {
    view.appendChild(P.search.emptyState('search_off', 'Nothing matched everything you described', 'Your memory may be slightly off — that is normal. Remove a clue above, loosen the match, or let the assistant ask you a few questions.',
      el('div', { class: 'empty-actions' }, el('button', { class: 'btn-p', onclick: () => { S.assistantOpen = true; S.assistantUsed = true; paint(view, S); } }, icon('psychology'), ' Help me find it'), S.loose ? null : el('button', { class: 'btn-o', onclick: () => { S.loose = true; paint(view, S); } }, 'Show looser matches'))));
    return;
  }
  view.appendChild(el('div', { class: 'res-count', 'aria-live': 'polite' }, out.strong ? `${P.pluralize(out.strong, 'best match', 'best matches')}${out.partial ? ` · ${P.pluralize(out.partial, 'possible match', 'possible matches')}` : ''}` : `No exact match — ${P.pluralize(out.partial, 'close match', 'close matches')} that fit most of what you described`));
  const photoOf = r => P.M.photos.get(r.id), mk = (rs, label, sub, cls) => {
    const list = rs.map(photoOf).filter(Boolean); if (!list.length) return;
    const sec = el('section', { class: 'res-sec ' + (cls || '') }, el('h2', {}, label, el('span', {}, ` ${list.length}`)), sub ? el('p', { class: 'muted' }, sub) : null); view.appendChild(sec);
    const host = el('div', {}); sec.appendChild(host);
    P.grid.render(host, list, { flat: true, collapseStacks: false, scrubber: false, ctx: 'search', ctxOpts: { sid: rec && rec.id }, zoom: 'month', tileAction: p => foundBtn(p, S, view), tileTitle: p => whyText(p.id), showFav: true });
  };
  mk(out.results.filter(r => r.tier === 'strong'), 'Best matches', 'Everything you described lines up.', 'strong');
  mk(out.results.filter(r => r.tier === 'partial'), out.strong ? 'Possible matches' : 'Closest matches', 'These fit most — not all — of what you described. Hover a photo to see why.', 'partial');
  if (keepScroll) sc.scrollTop = top;
}

const whyText = id => { const r = lastOut.get(id); if (!r) return ''; return [...r.matched.map(m => '✓ ' + m.label + (m.approx ? ' (approx.)' : '')), ...r.missed.map(m => '✗ ' + m.label)].join('\n'); };
function foundBtn(p, S, view) {
  return el('button', { class: 'tile-found', title: 'This is the photo I was looking for', 'aria-label': 'This is the photo I was looking for', onclick: async e => { e.stopPropagation(); await resolve(S, p.id, view); } }, icon('task_alt'));
}
async function resolve(S, photoId, view) {
  if (!S.rec) { toast0('Nothing to mark — run a search first'); return; }
  await H.resolve(S.rec, photoId); P.toast('Marked as found — I’ll remember this search', { action: 'Undo', onAction: async () => { S.rec.status = 'open'; S.rec.foundId = null; await H.put(S.rec); view && paint(view, S, true); } });
  paintBadge(); view && paint(view, S, true);
}
const toast0 = m => P.toast(m);
function foundBanner(rec, view, S) {
  const p = P.M.photos.get(rec.foundId), th = el('div', { class: 'fb-th' }); P.thumbURL(p.id).then(u => u && (th.style.backgroundImage = `url(${u})`));
  return el('div', { class: 'found-banner' }, th, el('div', {}, el('b', {}, 'You found it'), el('span', {}, `Marked ${rel(rec.resolvedAt)} · ${P.fmt.dateLong(p.takenAt)}`)), el('button', { class: 'btn-o', onclick: () => P.viewer.open([p.id], p.id, { ctx: 'search', ctxOpts: { sid: rec.id } }) }, 'Open photo'),
    el('button', { class: 'btn-t', onclick: async () => { rec.status = 'open'; rec.foundId = null; await H.put(rec); paint(view, S, true); } }, 'Not this one'));
}
async function toggleSave(rec, S, view) {
  if (rec.saved) { rec.saved = false; rec.alert = false; await H.put(rec); P.toast('Removed from saved searches'); }
  else {
    const name = await P.prompt('Save this search', { value: rec.name || S.q || '', placeholder: 'Name, e.g. Wedding photos', hint: P.M.settings.searchAlerts ? 'You’ll be told when new photos match it.' : '', ok: 'Save' }); if (name == null) return;
    rec.saved = true; rec.name = name || S.q; rec.alert = !!P.M.settings.searchAlerts; rec.savedAt = Date.now(); rec.seenIds = (lastOut.size ? [...lastOut.keys()] : []); rec.newMatches = []; await H.put(rec);
    P.toast('Search saved', { action: 'Manage', onAction: () => location.hash = '#/searches' });
  }
  paintBadge(); paint(view, S, true);
}

/* ================= assistant ================= */
function assistantCard(view, S, res) {
  const answered = [...(S.answers || []), ...(S.skipped || []).map(d => ({ dim: d }))];
  const q = E.nextQuestion(res.i, res.out, answered, res.clues);
  const card = el('section', { class: 'assistant', 'aria-label': 'Search assistant' });
  card.appendChild(el('div', { class: 'as-head' }, el('span', { class: 'as-ico' }, icon('psychology')), el('div', {}, el('b', {}, 'Let’s narrow it down'), el('span', {}, res.out.total ? (res.out.strong && res.out.partial ? `${P.pluralize(res.out.strong, 'best match', 'best matches')} · ${P.pluralize(res.out.partial, 'possible match', 'possible matches')}` : res.out.strong ? P.pluralize(res.out.strong, 'best match', 'best matches') : `${P.pluralize(res.out.total, 'close match', 'close matches')}`) : 'No close matches yet')),
    el('button', { class: 'ib sm', 'aria-label': 'Close assistant', onclick: () => { S.assistantOpen = false; paint(view, S, true); } }, icon('close'))));
  const body = el('div', { class: 'as-body' }); card.appendChild(body);
  const answer = (dim, value, label) => { S.answers = [...(S.answers || []), E.makeAnswer(dim, value, label)]; S.assistantUsed = true; paint(view, S, true); };
  const skip = dim => { S.skipped = [...(S.skipped || []), dim]; S.assistantUsed = true; paint(view, S, true); };
  const reset = el('button', { class: 'btn-t', onclick: () => { S.answers = []; S.skipped = []; S.removed = []; S.extra = ''; S.loose = false; paint(view, S, true); } }, 'Start over');
  if (q.done) {
    if (q.reason === 'none') body.appendChild(el('div', {}, el('p', {}, 'I can’t find anything close. Memories are often a little off — try removing a clue above, or loosen the match.'), el('div', { class: 'as-opts' }, S.loose ? null : el('button', { class: 'chip', onclick: () => { S.loose = true; paint(view, S, true); } }, 'Loosen the match'), reset)));
    else body.appendChild(el('div', {}, el('p', {}, q.reason === 'few' ? `Down to ${P.pluralize(q.count, 'photo')}. Is one of them the one? Hover a photo and tap ✓ “This is it”.` : `That’s everything I can ask. Still ${P.pluralize(q.count, 'candidate')} — scroll the matches below, or add a word you remember.`), el('div', { class: 'as-opts' }, reset)));
    if (q.reason === 'exhausted') body.appendChild(freeInput(S, view));
    return card;
  }
  body.appendChild(el('p', { class: 'as-q', role: 'status' }, q.text));
  if (q.free) {
    body.appendChild(freeInput(S, view)); body.appendChild(el('div', { class: 'as-opts' }, el('button', { class: 'chip', onclick: () => skip('text') }, 'Not sure'), reset));
  } else {
    const opts = el('div', { class: 'as-opts' });
    q.options.forEach(o => opts.appendChild(el('button', { class: 'chip opt', onclick: () => answer(q.dim, o.value, q.dim === 'person' ? 'With ' + o.label : q.dim === 'year' ? 'In ' + o.label : q.dim === 'place' ? 'In ' + o.label : o.label) }, o.label, el('small', {}, String(o.count)))));
    opts.appendChild(el('button', { class: 'chip', onclick: () => skip(q.dim) }, 'Not sure')); body.appendChild(opts);
    body.appendChild(el('div', { class: 'as-foot' }, `Narrowing from ${P.pluralize(q.count, 'candidate')}`, reset));
  }
  return card;
}
function freeInput(S, view) {
  const inp = el('input', { class: 'field', placeholder: 'e.g. a name, a place, a word, something you wore', 'aria-label': 'Something else you remember', maxlength: 80 });
  const add = () => { const v = inp.value.trim(); if (!v) return; S.answers = [...(S.answers || []), E.makeAnswer('text', nlp.normText(v), v)]; S.assistantUsed = true; paint(view, S, true); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } e.stopPropagation(); });
  return el('div', { class: 'row-in' }, inp, el('button', { class: 'btn-o', onclick: add }, 'Add'));
}

/* ================= CLIP opt-in ================= */
async function enableClip() {
  if (P.features.clip.state() !== 'ready') {
    const ok = await P.confirm('Turn on on-device AI search?', 'Downloads an AI model (~90 MB) once — internet needed only for that — then understands descriptions like “pink dress at a wedding” entirely inside your browser. Your photos are never uploaded. Indexing runs in the background.', { ok: 'Download & turn on' });
    if (!ok) return false;
    P.setting('clip', true); P.toast('Downloading the AI model…', { ms: 8000 });
    const loaded = await P.features.clip.load();
    if (!loaded) { P.setting('clip', false); P.toast('Could not load the AI model (' + (P.features.clip.error() || 'offline?') + ')', { ms: 7000 }); return false; }
  } else P.setting('clip', true);
  startIndexing(); return true;
}
function startIndexing() {
  const chip = $('#ml-chip'); const upd = () => { const p = P.features.clip.progress(); if (chip) { chip.textContent = p.indexing ? `AI index ${p.done}/${p.total}` : ''; chip.classList.toggle('hidden', !p.indexing); } };
  P.features.clip.indexAll(upd).then(() => { upd(); invalidate(); if (P.features.clip.count()) P.toast('AI search is ready'); });
}

/* ================= searches page ================= */
async function searchesPage(out, params) {
  const tab = params[0] || (suggestData().unfinished.length ? 'unfinished' : suggestData().saved.length ? 'saved' : 'history');
  const v = el('div', { class: 'view narrow' }); out.appendChild(v);
  const all = H.all(), byTime = (a, b) => b.updatedAt - a.updatedAt;
  const lists = { saved: all.filter(r => r.saved).sort(byTime), unfinished: all.filter(H.unfinished).sort(byTime), history: all.filter(r => r.q).sort(byTime) };
  v.appendChild(el('div', { class: 'view-head' }, el('h1', {}, 'Searches'), el('div', { class: 'view-actions' }, lists.history.length ? el('button', { class: 'btn-o', onclick: async () => { if (await P.confirm('Clear search history?', 'Saved searches are kept.', { ok: 'Clear' })) { for (const r of all.filter(r => !r.saved)) await H.remove(r.id); P.router.render(); } } }, 'Clear history') : null)));
  v.appendChild(el('div', { class: 'share-tabs' }, ...[['unfinished', 'Unfinished'], ['saved', 'Saved'], ['history', 'History']].map(([k, l]) => el('a', { class: 'share-tab' + (k === tab ? ' active' : ''), href: '#/searches/' + k }, `${l} (${lists[k].length})`))));
  const list = lists[tab] || [];
  if (!list.length) { v.appendChild(P.search.emptyState(tab === 'saved' ? 'bookmark' : tab === 'unfinished' ? 'task_alt' : 'history', tab === 'unfinished' ? 'No unfinished searches' : tab === 'saved' ? 'No saved searches yet' : 'No searches yet', tab === 'unfinished' ? 'When a search doesn’t get you the photo, it waits here so you can pick it up later.' : tab === 'saved' ? 'Open a search and tap “Save search” to get alerts when new photos match.' : 'Your searches show up here.')); return; }
  const wrap = el('div', { class: 'srch-list' }); v.appendChild(wrap);
  list.forEach(r => {
    const status = r.status === 'resolved' ? el('span', { class: 'chip found' }, 'Found') : H.unfinished(r) ? el('span', { class: 'chip unclear' }, 'Unfinished') : null;
    const row = el('div', { class: 'srch' }, el('a', { class: 'srch-main', href: H.hash(r) }, icon(r.saved ? 'bookmark' : 'search'), el('div', {}, el('b', {}, H.label(r)), el('span', {}, [r.q && r.name && r.name !== r.q ? `“${r.q}”` : null, P.pluralize(r.resultCount || 0, 'result'), (r.answers || []).length ? P.pluralize(r.answers.length, 'answer') : null, rel(r.updatedAt)].filter(Boolean).join(' · ')))),
      status, (r.newMatches || []).length ? el('span', { class: 'chip new' }, `${r.newMatches.length} new`) : null,
      el('div', { class: 'srch-a' },
        r.saved ? el('button', { class: 'ib sm' + (r.alert ? ' on' : ''), title: r.alert ? 'Alerts on — click to turn off' : 'Alert me about new matches', 'aria-pressed': !!r.alert, onclick: async () => { r.alert = !r.alert; await H.put(r); P.router.render(); } }, icon(r.alert ? 'notifications_active' : 'notifications_off')) : null,
        el('button', { class: 'ib sm', 'aria-label': 'More', onclick: e => P.menuAt(e.currentTarget, [
          { icon: 'play_arrow', label: H.unfinished(r) ? 'Resume' : 'Open', onClick: () => location.hash = H.hash(r) },
          { icon: r.saved ? 'bookmark_remove' : 'bookmark_add', label: r.saved ? 'Unsave' : 'Save', onClick: async () => { r.saved = !r.saved; if (r.saved) { r.name = r.name || r.q; r.alert = !!P.M.settings.searchAlerts; } await H.put(r); P.router.render(); } },
          r.saved ? { icon: 'edit', label: 'Rename', onClick: async () => { const n = await P.prompt('Rename saved search', { value: H.label(r) }); if (n) { r.name = n; await H.put(r); P.router.render(); } } } : null,
          H.unfinished(r) ? { icon: 'done_all', label: 'Dismiss from unfinished', onClick: async () => { r.dismissed = true; await H.put(r); paintBadge(); P.router.render(); } } : null,
          '-', { icon: 'delete', label: 'Delete', onClick: async () => { await H.remove(r.id); paintBadge(); P.router.render(); } }]) }, icon('more_vert'))));
    wrap.appendChild(row);
    if ((r.newMatches || []).length) { /* clear the badge once the list is viewed */ }
  });
}

/* ================= alerts for saved searches ================= */
P.on('ingested', async photos => {
  if (!P.M.settings.searchAlerts || !photos || !photos.length) return;
  const saved = H.all().filter(r => r.saved && r.alert); if (!saved.length) return;
  try {
    const i = await getIndex(); const ids = photos.map(p => p.id); let total = 0, first = null;
    for (const r of saved) {
      const S = { q: r.q, filters: r.filters, answers: r.answers || [], removed: r.removed || [], skipped: r.skipped || [], extra: r.extra || '' };
      const clues = dropRemoved(nlp.parse(S.q + (S.extra ? ' ' + S.extra : ''), parseCtx(i)), S.removed);
      const o = E.search(i, clues, { answers: S.answers, filters: S.filters && Object.keys(S.filters).length ? S.filters : null, onlyIds: ids, tiers: { strong: 0.78, partial: 0.55 } });
      const fresh = o.results.map(x => x.id).filter(id => !(r.newMatches || []).includes(id));
      if (fresh.length) { r.newMatches = [...(r.newMatches || []), ...fresh]; await H.put(r); total += fresh.length; first = first || r; }
    }
    if (total) { paintBadge(); P.toast(`${P.pluralize(total, 'new photo')} match your saved search “${H.label(first)}”`, { action: 'View', onAction: async () => { first.newMatches = []; await H.put(first); paintBadge(); location.hash = H.hash(first); } }); }
  } catch (e) { console.warn('alerts', e); }
});

/* viewer hook: "This is it" from inside the viewer */
async function resolveFromViewer(photoId, opts) {
  const rec = opts && opts.sid && P.M.searches.get(opts.sid); if (!rec) return P.toast('Open this photo from a search result to mark it as found');
  await H.resolve(rec, photoId); P.toast('Marked as found — I’ll remember this search'); paintBadge(); P.emit('search:resolved', rec.id);
}

document.addEventListener('DOMContentLoaded', () => { setTimeout(paintBadge, 600); });
P.memory = { results, searchesPage, getIndex, invalidate, warm, ready, moment, explain, suggestData, badgeCount, paintBadge, enableClip, startIndexing, history: H, resolveFromViewer, run, hashFor: H.hash };
})();
