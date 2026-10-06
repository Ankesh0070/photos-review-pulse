/* Sharing: links, shared albums (members, comments, likes), partner sharing, standalone HTML export.
   Everything is stored locally. Real delivery works through: Web Share, mailto invites, and the self-contained HTML/ZIP export. */
(() => {
const { $, el, icon } = P;
const me = () => P.M.settings.email || 'you@example.com';
const linkFor = id => `${location.href.split('#')[0]}#/s/${id}`;
const initials = e => (e || '?')[0].toUpperCase();

async function createLink(ids) {
  const ps = ids.map(i => P.M.photos.get(i)).filter(Boolean);
  const s = { id: P.uid(), kind: 'link', title: ps.length === 1 ? ps[0].name : `${ps.length} photos`, photoIds: ids, createdAt: Date.now(), owner: me(), expires: null, download: true };
  await P.db.put('shares', s); P.M.shares.set(s.id, s); P.emit('albums');
  return linkDialog(s);
}
async function linkDialog(s) {
  const link = linkFor(s.id), inp = el('input', { class: 'field', readonly: true, value: link });
  inp.addEventListener('focus', () => inp.select());
  const body = el('div', {}, el('p', {}, 'Anyone who opens this link in this browser can view these photos.'), inp,
    el('p', { class: 'hint warn' }, icon('info', 'sm'), ' There is no server behind this app, so the link only works on this device. To send photos to someone else, use “Download as web page”, the ZIP download, or your device’s share sheet.'));
  const r = await P.dialog({ title: 'Share link created', body, width: '520px', actions: [{ label: 'Download as web page', value: 'html' }, { label: 'Done', value: null }, { label: 'Copy link', value: 'copy', primary: true }] });
  if (r === 'copy') { try { await navigator.clipboard.writeText(link); P.toast('Link copied'); } catch { P.toast(link); } }
  if (r === 'html') exportHtml(s);
}
async function exportHtml(s) {
  P.toast('Building a standalone web page…', { ms: 8000 });
  const items = [];
  for (const id of s.photoIds) {
    const p = P.M.photos.get(id); if (!p || p.kind !== 'image') continue;
    const b = await P.getBlob(id), bmp = await createImageBitmap(b, { imageOrientation: 'from-image' }), sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.round(bmp.width * sc), Math.round(bmp.height * sc)); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: .85 }); const data = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
    items.push({ data, name: p.name, date: P.fmt.dateLong(p.takenAt), desc: p.desc });
  }
  const html = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${P.escapeHtml(s.title)}</title><style>body{margin:0;font:14px Roboto,system-ui,sans-serif;background:#fff;color:#202124}h1{font-weight:400;margin:24px 16px 4px}p.s{margin:0 16px 16px;color:#5f6368}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px;padding:0 4px 24px}.g img{width:100%;height:220px;object-fit:cover;cursor:zoom-in;display:block}#lb{position:fixed;inset:0;background:#000e;display:none;place-items:center}#lb img{max-width:96vw;max-height:92vh}#lb.on{display:grid}#lb span{position:fixed;bottom:12px;color:#fff}@media(prefers-color-scheme:dark){body{background:#202124;color:#e8eaed}}</style><h1>${P.escapeHtml(s.title)}</h1><p class=s>${items.length} photos · shared ${new Date().toLocaleDateString()}</p><div class=g>${items.map((i, k) => `<img src="${i.data}" alt="${P.escapeHtml(i.desc || i.name)}" onclick="o(${k})">`).join('')}</div><div id=lb onclick="this.classList.remove('on')"><img id=li><span id=lc></span></div><script>const D=${JSON.stringify(items.map(i => ({ d: i.data, c: i.date })))};function o(k){li.src=D[k].d;lc.textContent=D[k].c;lb.classList.add('on')}document.onkeydown=e=>{if(e.key=='Escape')lb.classList.remove('on')}<\/script>`;
  P.download(new Blob([html], { type: 'text/html' }), `${s.title.replace(/[^\w ]+/g, '').trim() || 'shared-photos'}.html`);
  P.toast('Web page saved — send the file to anyone');
}

/* ---------- shared albums ---------- */
async function albumShare(albumId) {
  const a = P.M.albums.get(albumId);
  const r = await P.pick('Share album', [
    { value: 'invite', icon: 'group_add', label: 'Share with people', sub: 'Invite people, enable comments and likes' },
    { value: 'link', icon: 'link', label: 'Create link', sub: 'View-only link (this device)' },
    { value: 'html', icon: 'web', label: 'Download as web page', sub: 'One file you can send to anyone' },
    { value: 'zip', icon: 'folder_zip', label: 'Download all as ZIP' },
  ]);
  if (r === 'invite') { a.shared = true; a.members = a.members || []; await P.saveAlbum(a); invite(albumId); }
  else if (r === 'link') createLink(P.albumPhotos(albumId).map(p => p.id));
  else if (r === 'html') exportHtml({ title: a.name, photoIds: P.albumPhotos(albumId).map(p => p.id) });
  else if (r === 'zip') P.ops.download(P.albumPhotos(albumId).map(p => p.id));
}
async function invite(albumId) {
  const a = P.M.albums.get(albumId); a.members = a.members || [];
  const list = el('div', { class: 'members' }), draw = () => { list.innerHTML = ''; list.appendChild(memberRow({ email: me(), role: 'owner' })); a.members.forEach((m, i) => list.appendChild(memberRow(m, i))); };
  const memberRow = (m, i) => el('div', { class: 'mem-r' }, el('i', { class: 'chip-av lg', style: { background: P.hashColor(m.email) } }, initials(m.email)), el('div', { class: 'mr-t' }, m.email, el('small', {}, m.role === 'owner' ? 'Owner' : m.role === 'edit' ? 'Can add photos' : 'Can view')),
    m.role !== 'owner' ? el('div', { class: 'mr-a' }, el('button', { class: 'btn-t', onclick: () => { m.role = m.role === 'edit' ? 'view' : 'edit'; draw(); } }, m.role === 'edit' ? 'Make viewer' : 'Make contributor'), el('button', { class: 'ib', title: 'Remove', onclick: () => { a.members.splice(i, 1); draw(); } }, icon('close'))) : null);
  const email = el('input', { class: 'field', type: 'email', placeholder: 'Add people by email' });
  const add = () => { const v = email.value.trim(); if (!/^\S+@\S+\.\S+$/.test(v)) return P.toast('Enter a valid email'); if (a.members.some(m => m.email === v)) return; a.members.push({ email: v, role: 'view', since: Date.now() }); email.value = ''; draw(); };
  email.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  draw();
  const body = el('div', {}, el('div', { class: 'row-in' }, email, el('button', { class: 'btn-o', onclick: add }, 'Add')), list,
    el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: a.comments !== false && !a.noComments, onchange: e => a.noComments = !e.target.checked }), ' Allow comments and likes'),
    el('p', { class: 'hint' }, 'Invitations open your mail app with a message. People you add get access once you send it; the album itself stays on this device.'));
  const r = await P.dialog({ title: `Share “${a.name}”`, body, width: '520px', actions: [{ label: 'Cancel', value: null }, { label: 'Save & send invite', value: 'ok', primary: true }] });
  if (r !== 'ok') return;
  a.updatedAt = Date.now(); await P.saveAlbum(a);
  if (a.members.length) location.href = `mailto:${a.members.map(m => m.email).join(',')}?subject=${encodeURIComponent(`${P.M.settings.name} shared “${a.name}” with you`)}&body=${encodeURIComponent(`Hi,\n\nI'd like to share the album “${a.name}” (${P.pluralize(P.albumItems(a.id).length, 'photo')}) with you.\n\n${linkFor('a-' + a.id)}\n`)}`;
  P.router.render();
}
function panel(a) {
  const w = el('div', { class: 'share-panel' });
  const ms = [{ email: me(), role: 'owner' }, ...(a.members || [])];
  w.appendChild(el('div', { class: 'sp-members' }, ...ms.slice(0, 8).map(m => el('i', { class: 'chip-av lg', title: m.email, style: { background: P.hashColor(m.email) } }, initials(m.email))), el('button', { class: 'btn-t', onclick: () => invite(a.id) }, ms.length > 1 ? `${ms.length} people` : 'Invite people')));
  if (!a.noComments) {
    const likes = a.likes || {}, n = Object.keys(likes).length, liked = !!likes[me()];
    w.appendChild(el('div', { class: 'sp-row' }, el('button', { class: 'btn-t' + (liked ? ' on' : ''), onclick: async () => { a.likes = a.likes || {}; liked ? delete a.likes[me()] : a.likes[me()] = Date.now(); await P.saveAlbum(a); P.router.render(); } }, icon('favorite', liked ? 'fill' : ''), ` ${n || ''} Like`)));
    const feed = el('div', { class: 'feed' }); (a.comments || []).slice(-30).forEach(c => feed.appendChild(el('div', { class: 'cm' }, el('i', { class: 'chip-av', style: { background: P.hashColor(c.by) } }, initials(c.by)), el('div', {}, el('b', {}, c.by === me() ? P.M.settings.name : c.by), ' ', el('span', {}, c.text), el('small', {}, P.fmt.rel(c.t))))));
    const inp = el('input', { class: 'field', placeholder: 'Add a comment' });
    inp.addEventListener('keydown', async e => { if (e.key === 'Enter' && inp.value.trim()) { a.comments = a.comments || []; a.comments.push({ by: me(), text: inp.value.trim(), t: Date.now() }); a.updatedAt = Date.now(); await P.saveAlbum(a); P.router.render(); } });
    w.append(feed, inp);
  }
  return w;
}

/* ---------- partner sharing ---------- */
async function partner() {
  const cur = P.M.settings.partner;
  if (cur) { const r = await P.pick('Partner sharing', [{ value: 'edit', icon: 'edit', label: 'Change settings' }, { value: 'stop', icon: 'person_remove', label: 'Stop sharing with ' + cur.email }]); if (r === 'stop') { P.setting('partner', null); P.toast('Partner sharing stopped'); P.router.render(); } if (r !== 'edit') return; }
  const email = el('input', { class: 'field', type: 'email', placeholder: 'Partner’s email', value: cur?.email || '' });
  const mode = el('select', { class: 'field' }, ...[['all', 'All photos'], ['from', 'Photos from a date onward'], ['people', 'Photos of specific people']].map(([v, l]) => el('option', { value: v, selected: cur?.mode === v }, l)));
  const from = el('input', { type: 'date', class: 'field', value: cur?.from || '' });
  const ppl = el('select', { class: 'field', multiple: true, size: 4 }, ...[...P.M.people.values()].map(p => el('option', { value: p.id, selected: cur?.people?.includes(p.id) }, p.name || 'Unnamed')));
  const body = el('div', { class: 'filters' }, el('label', {}, 'Partner', email), el('label', {}, 'Share', mode), el('label', {}, 'Starting from', from), el('label', {}, 'People', ppl), el('p', { class: 'hint' }, 'Your partner receives an email invite. They will see the selected photos in their Sharing tab once they accept (requires them to use a compatible app — here the setting is stored locally).'));
  const r = await P.dialog({ title: 'Partner sharing', body, width: '480px', actions: [{ label: 'Cancel', value: null }, { label: 'Send invite', value: 'ok', primary: true }] });
  if (r !== 'ok' || !/^\S+@\S+\.\S+$/.test(email.value)) return;
  P.setting('partner', { email: email.value.trim(), mode: mode.value, from: from.value, people: [...ppl.selectedOptions].map(o => o.value), since: Date.now() });
  location.href = `mailto:${email.value}?subject=${encodeURIComponent('Partner sharing invitation')}&body=${encodeURIComponent(`${P.M.settings.name} invited you to be their sharing partner in Photos.`)}`;
  P.toast('Partner sharing set up'); P.router.render();
}

/* ---------- Sharing tab ---------- */
async function index(out) {
  const view = el('div', { class: 'view' }); out.appendChild(view);
  view.appendChild(el('div', { class: 'view-head' }, el('h1', {}, 'Sharing'), el('div', { class: 'view-actions' }, el('button', { class: 'btn-o', onclick: () => P.albums.createFlow([], true) }, icon('group_add'), ' New shared album'))));
  const cards = el('div', { class: 'sharecards' });
  const par = P.M.settings.partner;
  cards.appendChild(el('button', { class: 'sc', onclick: partner }, icon('supervisor_account'), el('div', {}, el('b', {}, par ? `Sharing with ${par.email}` : 'Partner sharing'), el('span', {}, par ? ({ all: 'All photos', from: `Photos from ${par.from || 'a date'}`, people: 'Photos of selected people' })[par.mode] : 'Automatically share photos with someone you trust'))));
  cards.appendChild(el('button', { class: 'sc', onclick: () => P.picker.photos({ title: 'Choose photos to share', ok: 'Share' }).then(ids => ids?.length && P.ops.share(ids)) }, icon('send'), el('div', {}, el('b', {}, 'Send photos'), el('span', {}, 'Pick photos and share with a link, email or other apps'))));
  view.appendChild(cards);
  view.appendChild(el('div', { class: 'sec-title' }, 'Shared albums'));
  const sh = [...P.M.albums.values()].filter(a => a.shared);
  if (sh.length) await P.albums.grid(view, { shared: true, limit: 0 }); else view.appendChild(el('p', { class: 'muted' }, 'Albums you share with people appear here.'));
  const links = [...P.M.shares.values()].filter(s => s.kind === 'link').sort((a, b) => b.createdAt - a.createdAt);
  view.appendChild(el('div', { class: 'sec-title' }, 'Links'));
  if (!links.length) view.appendChild(el('p', { class: 'muted' }, 'Links you create appear here.'));
  const list = el('div', { class: 'linklist' });
  for (const s of links) {
    const ph = s.photoIds.map(i => P.M.photos.get(i)).filter(Boolean), th = el('div', { class: 'll-th' }); if (ph[0]) P.thumbURL(ph[0].id).then(u => u && (th.style.backgroundImage = `url(${u})`));
    list.appendChild(el('div', { class: 'll' }, th, el('a', { href: '#/s/' + s.id, class: 'll-t' }, el('b', {}, s.title), el('span', {}, `${P.pluralize(ph.length, 'item')} · ${P.fmt.rel(s.createdAt)}`)),
      el('button', { class: 'ib', title: 'Copy link', onclick: () => navigator.clipboard.writeText(linkFor(s.id)).then(() => P.toast('Link copied')) }, icon('link')),
      el('button', { class: 'ib', title: 'Stop sharing', onclick: async () => { await P.db.del('shares', s.id); P.M.shares.delete(s.id); P.router.render(); P.toast('Link deleted'); } }, icon('link_off'))));
  }
  view.appendChild(list);
  const act = [...P.M.albums.values()].filter(a => a.shared).flatMap(a => (a.comments || []).map(c => ({ ...c, album: a }))).sort((a, b) => b.t - a.t).slice(0, 12);
  view.appendChild(el('div', { class: 'sec-title' }, 'Conversations'));
  if (!act.length) view.appendChild(el('p', { class: 'muted' }, 'Comments on shared albums show up here.'));
  act.forEach(c => view.appendChild(el('a', { class: 'convo', href: '#/album/' + c.album.id }, el('i', { class: 'chip-av lg', style: { background: P.hashColor(c.by) } }, initials(c.by)), el('div', {}, el('b', {}, c.album.name), el('span', {}, `${c.by === me() ? 'You' : c.by}: ${c.text}`)), el('small', {}, P.fmt.rel(c.t)))));
}
/* public-style page for a link */
async function sharedView(out, [id]) {
  const s = P.M.shares.get(id); const view = el('div', { class: 'view' }); out.appendChild(view);
  if (!s) { view.appendChild(P.search.emptyState('link_off', 'This link isn’t available', 'It may have been deleted, or it was created on another device (links only work in the browser where they were made).')); return; }
  const list = s.photoIds.map(i => P.M.photos.get(i)).filter(p => p && !p.trashedAt && !p.locked);
  view.appendChild(el('div', { class: 'view-head' }, el('button', { class: 'ib', onclick: () => history.back() }, icon('arrow_back')), el('h1', {}, s.title), el('div', { class: 'view-actions' },
    el('button', { class: 'btn-o', onclick: () => exportHtml(s) }, icon('web'), ' Web page'), el('button', { class: 'btn-o', onclick: () => P.ops.download(list.map(p => p.id)) }, icon('download'), ' Download'),
    el('button', { class: 'btn-o', onclick: async () => { await P.db.del('shares', s.id); P.M.shares.delete(s.id); location.hash = '#/sharing'; P.toast('Stopped sharing'); } }, icon('link_off'), ' Stop sharing'))));
  view.appendChild(el('p', { class: 'muted' }, `Shared ${P.fmt.rel(s.createdAt)} by ${s.owner}`));
  P.sel.setContext('library'); const host = el('div', {}); view.appendChild(host); P.grid.render(host, list, { zoom: 'month', scrubber: false });
}

P.sharing = { createLink, invite, albumShare, panel, partner, index, sharedView, exportHtml };
})();
