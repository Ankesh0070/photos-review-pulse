/* Personal tags & memory notes: per-photo editor, bulk tagging, "Name this moment", tags page */
(() => {
const { $, el, icon } = P;
const norm = s => P.nlp.normTag(s);
const clean = s => String(s || '').replace(/\s+/g, ' ').replace(/^#+/, '').trim().slice(0, 40);
let cache = null;
const dirty = () => { cache = null; P.memory && P.memory.invalidate(); };
P.on('photos', () => { cache = null; }); P.on('notes:changed', dirty);

/* tag key → {name, count, ids[]} over visible photos (case/plural/possessive-insensitive) */
function tagMap() {
  if (cache) return cache; const m = new Map();
  for (const p of P.M.photos.values()) { if (p.trashedAt || p.locked) continue; for (const t of (p.tags || [])) { const k = norm(t); if (!k) continue; let r = m.get(k); if (!r) { r = { key: k, name: t, count: 0, ids: [] }; m.set(k, r); } r.count++; r.ids.push(p.id); } }
  return cache = m;
}
const allTags = () => [...tagMap().values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
const canonical = name => { const n = clean(name); const r = tagMap().get(norm(n)); return r ? r.name : n; };

async function addTags(ids, tags) {
  const ps = ids.map(i => P.M.photos.get(i)).filter(Boolean), add = [...new Set(tags.map(canonical).filter(Boolean))], changed = [];
  for (const p of ps) { p.tags = p.tags || []; let ch = false; for (const t of add) if (!p.tags.some(x => norm(x) === norm(t))) { p.tags.push(t); ch = true; } if (ch) changed.push(p); }
  if (changed.length) { await P.savePhotos(changed, true); P.emit('notes:changed'); }
  return changed.length;
}
async function removeTag(ids, tag) {
  const k = norm(tag), changed = [];
  for (const id of ids) { const p = P.M.photos.get(id); if (!p || !p.tags) continue; const n = p.tags.filter(t => norm(t) !== k); if (n.length !== p.tags.length) { p.tags = n; changed.push(p); } }
  if (changed.length) { await P.savePhotos(changed, true); P.emit('notes:changed'); }
  return changed.length;
}
async function renameTag(oldName, newName) {
  const nn = canonical(newName); if (!nn) return 0; const k = norm(oldName), changed = [];
  for (const p of P.M.photos.values()) { if (!p.tags) continue; if (p.tags.some(t => norm(t) === k)) { const arr = p.tags.filter(t => norm(t) !== k); if (!arr.some(t => norm(t) === norm(nn))) arr.push(nn); p.tags = arr; changed.push(p); } }
  if (changed.length) { await P.savePhotos(changed, true); P.emit('notes:changed'); P.emit('photos'); }
  return changed.length;
}
async function setNote(id, text) { const p = P.M.photos.get(id); if (!p) return; p.note = text; await P.savePhoto(p, true); P.emit('notes:changed'); }

/* ---------- chip editor used by the viewer's Info panel ---------- */
function panel(p, rerender) {
  const wrap = el('div', { class: 'notes-panel' });
  const chips = el('div', { class: 'tag-chips' });
  const dlId = 'tagdl-' + p.id, dl = el('datalist', { id: dlId });
  const input = el('input', { class: 'tag-in', type: 'text', placeholder: 'Add a tag, e.g. First family vacation', list: dlId, maxlength: 40, 'aria-label': 'Add a tag' });
  const draw = () => {
    chips.innerHTML = '';
    (p.tags || []).forEach(t => chips.appendChild(el('span', { class: 'tag-chip' }, icon('sell', 'sm'), el('a', { href: '#/search/' + encodeURIComponent('') + '/' + encodeURIComponent(JSON.stringify({ tag: t })), onclick: () => { P.viewer.close(); } }, t), el('button', { class: 'tag-x', 'aria-label': 'Remove tag ' + t, onclick: async () => { await removeTag([p.id], t); draw(); } }, icon('close', 'sm')))));
    chips.appendChild(input);
    dl.innerHTML = ''; allTags().filter(t => !(p.tags || []).some(x => norm(x) === t.key)).slice(0, 30).forEach(t => dl.appendChild(el('option', { value: t.name })));
  };
  const commit = async () => { const parts = input.value.split(/[,\n]/).map(clean).filter(Boolean); if (!parts.length) return; input.value = ''; await addTags([p.id], parts); draw(); input.focus(); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } else if (e.key === 'Backspace' && !input.value && (p.tags || []).length) { removeTag([p.id], p.tags[p.tags.length - 1]).then(draw); } e.stopPropagation(); });
  input.addEventListener('change', commit); input.addEventListener('blur', () => { if (input.value.trim()) commit(); });
  draw();
  wrap.appendChild(el('div', { class: 'info-sect' }, 'Tags'));
  wrap.appendChild(el('div', { class: 'info-r' }, icon('sell'), el('div', {}, chips, dl)));
  const sug = allTags().filter(t => !(p.tags || []).some(x => norm(x) === t.key)).slice(0, 5);
  if (sug.length) wrap.appendChild(el('div', { class: 'tag-sug' }, el('span', {}, 'Your tags:'), ...sug.map(t => el('button', { class: 'chip', onclick: async () => { await addTags([p.id], [t.name]); draw(); rerender && rerender(); } }, t.name))));
  // memory note
  const ta = el('textarea', { class: 'info-desc note', placeholder: 'Write a memory note — who, why it mattered, what you want to remember…', rows: 3, maxlength: 2000, 'aria-label': 'Memory note' }); ta.value = p.note || '';
  ta.addEventListener('input', P.debounce(() => setNote(p.id, ta.value), 450)); ta.addEventListener('keydown', e => e.stopPropagation());
  wrap.appendChild(el('div', { class: 'info-sect' }, 'Memory note'));
  wrap.appendChild(el('div', { class: 'info-r' }, icon('edit_note'), ta));
  // name this moment
  const m = P.memory && P.memory.moment(p.id);
  if (m && m.n >= 4) wrap.appendChild(el('div', { class: 'info-r click moment', onclick: () => nameMoment(p, m, rerender) }, icon('auto_stories'), el('div', {}, el('div', { class: 'ir-a' }, `Part of a moment with ${m.n} photos`), el('div', { class: 'ir-b' }, `${P.fmt.dateLong(m.t0)}${m.place ? ' · ' + m.place.split(',')[0] : ''} — tap to name it, e.g. “Mom’s 60th birthday”`))));
  return wrap;
}
async function nameMoment(p, m, rerender) {
  const existing = new Set(); m.ids.forEach(id => (P.M.photos.get(id).tags || []).forEach(t => existing.add(t)));
  const name = await P.prompt('Name this moment', { placeholder: 'e.g. Mom’s 60th birthday', hint: `Adds this tag to all ${m.n} photos from ${P.fmt.dateLong(m.t0)}, so searching the name finds the whole moment.${existing.size ? ' Already used here: ' + [...existing].slice(0, 4).join(', ') : ''}` });
  if (!name) return; const n = await addTags(m.ids, [name]); P.toast(`Tagged ${P.pluralize(n, 'photo')} “${canonical(name)}”`, { action: 'Search it', onAction: () => location.hash = '#/search/' + encodeURIComponent('') + '/' + encodeURIComponent(JSON.stringify({ tag: canonical(name) })) });
  rerender && rerender();
}

/* ---------- bulk dialog (selection bar) ---------- */
async function tagDialog(ids) {
  const ps = ids.map(i => P.M.photos.get(i)).filter(Boolean); if (!ps.length) return;
  const have = new Map(); ps.forEach(p => (p.tags || []).forEach(t => { const k = norm(t); const r = have.get(k) || { name: t, n: 0 }; r.n++; have.set(k, r); }));
  const adds = new Set(), removes = new Set();
  const box = el('div', { class: 'tagdlg' }), chips = el('div', { class: 'tag-chips' }), input = el('input', { class: 'field', placeholder: 'Type a tag and press Enter', maxlength: 40, list: 'tagdl-bulk' });
  const dl = el('datalist', { id: 'tagdl-bulk' }, ...allTags().slice(0, 40).map(t => el('option', { value: t.name })));
  const draw = () => {
    chips.innerHTML = '';
    have.forEach((r, k) => chips.appendChild(el('button', { class: 'tag-chip' + (removes.has(k) ? ' off' : ''), title: removes.has(k) ? 'Will be removed — click to keep' : 'Click to remove from all selected', onclick: () => { removes.has(k) ? removes.delete(k) : removes.add(k); draw(); } }, icon('sell', 'sm'), `${r.name}${r.n < ps.length ? ` (${r.n}/${ps.length})` : ''}`)));
    adds.forEach(t => chips.appendChild(el('button', { class: 'tag-chip new', onclick: () => { adds.delete(t); draw(); } }, icon('add', 'sm'), t, icon('close', 'sm'))));
  };
  const addFromInput = () => { input.value.split(/[,\n]/).map(clean).filter(Boolean).forEach(t => adds.add(canonical(t))); input.value = ''; draw(); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addFromInput(); } e.stopPropagation(); });
  const sug = allTags().filter(t => !have.has(t.key)).slice(0, 8);
  box.append(el('p', { class: 'hint' }, `${P.pluralize(ps.length, 'photo')} selected. Tags are searchable and private to this device.`), chips, input, dl,
    sug.length ? el('div', { class: 'tag-sug' }, el('span', {}, 'Your tags:'), ...sug.map(t => el('button', { class: 'chip', onclick: () => { adds.add(t.name); draw(); } }, t.name))) : null);
  draw();
  const r = await P.dialog({ title: 'Add tags', body: box, width: '480px', actions: [{ label: 'Cancel', value: null }, { label: 'Apply', value: 'ok', primary: true }] });
  if (r !== 'ok') return false; addFromInput();
  let n = 0; if (adds.size) n += await addTags(ids, [...adds]);
  for (const k of removes) { const r = have.get(k); n += await removeTag(ids, r.name); }
  P.toast(n ? `Updated tags on ${P.pluralize(Math.min(n, ps.length), 'photo')}` : 'No changes'); return true;
}

/* ---------- Tags page ---------- */
async function page(out) {
  const v = el('div', { class: 'view' }); out.appendChild(v);
  const tags = allTags();
  const filter = el('input', { class: 'field sm', type: 'search', placeholder: 'Filter tags', 'aria-label': 'Filter tags' });
  v.appendChild(el('div', { class: 'view-head' }, el('h1', {}, 'Tags'), el('div', { class: 'view-actions' }, tags.length ? filter : null)));
  v.appendChild(el('p', { class: 'note' }, icon('sell'), 'Personal tags and memory notes are searchable — e.g. “First family vacation” or “Mom’s 60th birthday”. Add them in a photo’s Info panel, or select photos and use More → Add tags.'));
  if (!tags.length) { v.appendChild(P.search.emptyState('sell', 'No tags yet', 'Open a photo, tap Info, and add a tag or a memory note. They become part of search.', el('button', { class: 'btn-p', onclick: () => location.hash = '#/photos' }, 'Go to photos'))); return; }
  const grid = el('div', { class: 'cards tags' }); v.appendChild(grid);
  const draw = () => {
    grid.innerHTML = ''; const q = norm(filter.value);
    tags.filter(t => !q || t.key.includes(q)).forEach(t => {
      const cover = t.ids.map(i => P.M.photos.get(i)).filter(Boolean).sort((a, b) => b.takenAt - a.takenAt)[0];
      const img = el('div', { class: 'card-img' }, cover ? null : icon('sell')); if (cover) P.thumbURL(cover.id).then(u => u && (img.style.backgroundImage = `url(${u})`));
      grid.appendChild(el('a', { class: 'card', href: '#/search/' + encodeURIComponent('') + '/' + encodeURIComponent(JSON.stringify({ tag: t.name })) }, img,
        el('div', { class: 'card-t' }, t.name, el('button', { class: 'ib sm', title: 'Manage tag', 'aria-label': 'Manage tag ' + t.name, onclick: e => { e.preventDefault(); e.stopPropagation(); P.menuAt(e.currentTarget, [
          { icon: 'edit', label: 'Rename', onClick: async () => { const n = await P.prompt('Rename tag', { value: t.name }); if (n && n !== t.name) { await renameTag(t.name, n); P.router.render(); } } },
          { icon: 'delete', label: 'Remove from all photos', onClick: async () => { if (await P.confirm('Remove tag?', `“${t.name}” will be removed from ${P.pluralize(t.count, 'photo')}. The photos stay.`, { ok: 'Remove', danger: true })) { await removeTag(t.ids, t.name); P.router.render(); } } }]); } }, icon('more_vert'))),
        el('div', { class: 'card-s' }, P.pluralize(t.count, 'photo'))));
    });
  };
  filter.addEventListener('input', draw); draw();
}

P.notes = { tagMap, allTags, addTags, removeTag, renameTag, setNote, panel, tagDialog, nameMoment, page, canonical, norm };
})();
