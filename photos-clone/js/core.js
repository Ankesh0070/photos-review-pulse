/* Core: namespace, DOM helpers, formatting, events, toast, dialogs, menus */
window.P = window.P || {};
(() => {
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    e.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
  }
  return e;
}
const icon = (n, cls = '') => el('span', { class: 'mi ' + cls }, n);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const throttle = (fn, ms = 100) => { let last = 0, t; return (...a) => { const n = Date.now(); if (n - last >= ms) { last = n; fn(...a); } else { clearTimeout(t); t = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (n - last)); } }; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- events ---------- */
const bus = new EventTarget();
const emit = (t, d) => bus.dispatchEvent(new CustomEvent(t, { detail: d }));
const on = (t, fn) => { const h = e => fn(e.detail, e); bus.addEventListener(t, h); return () => bus.removeEventListener(t, h); };

/* ---------- formatting ---------- */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmt = {
  bytes(n) { if (!n) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`; },
  dur(s) { s = isFinite(s) ? Math.max(0, Math.round(s || 0)) : 0; const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; },
  dateLong(t) { const d = new Date(t); return `${DAYS[d.getDay()].slice(0, 3)}, ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`; },
  date(t) { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`; },
  time(t) { return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); },
  monthYear(t) { const d = new Date(t); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; },
  /* heading for a given zoom level */
  heading(t, level = 'day') {
    const d = new Date(t), now = new Date();
    if (level === 'year') return String(d.getFullYear());
    if (level === 'month') return d.getFullYear() === now.getFullYear() ? MONTHS[d.getMonth()] : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    const sod = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((sod(now) - sod(d)) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    const base = `${DAYS[d.getDay()].slice(0, 3)}, ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
    return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
  },
  rel(t) { const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${(s / 60) | 0}m ago`; if (s < 86400) return `${(s / 3600) | 0}h ago`; if (s < 86400 * 30) return `${(s / 86400) | 0}d ago`; return fmt.date(t); },
  exposure(x) { return x ? (x < 1 ? `1/${Math.round(1 / x)}s` : `${x}s`) : ''; },
  mp(w, h) { return w && h ? `${(w * h / 1e6).toFixed(1)} MP` : ''; },
};

/* ---------- toast ---------- */
let toastT;
function toast(msg, opts = {}) {
  const t = $('#toast');
  t.innerHTML = '';
  t.appendChild(el('span', {}, msg));
  if (opts.action) t.appendChild(el('button', { class: 'toast-a', onclick: () => { t.classList.add('hidden'); opts.onAction && opts.onAction(); } }, opts.action));
  t.classList.remove('hidden');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('hidden'), opts.ms || 4500);
}

/* ---------- dialogs ---------- */
function dialog({ title, body, actions, width, onClose, cls = '' }) {
  return new Promise(res => {
    const wrap = el('div', { class: 'dialog ' + cls });
    const card = el('div', { class: 'dialog-card', style: width ? { width } : {}, role: 'dialog', 'aria-modal': 'true' });
    if (title) card.appendChild(el('h2', {}, title));
    if (body) card.appendChild(typeof body === 'string' ? el('p', {}, body) : body);
    const close = v => { wrap.remove(); document.removeEventListener('keydown', key, true); onClose && onClose(v); res(v); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', key, true);
    if (actions && actions.length) {
      const row = el('div', { class: 'dialog-actions' });
      actions.forEach(a => row.appendChild(el('button', { class: a.primary ? (a.danger ? 'btn-p danger' : 'btn-p') : 'btn-t', onclick: () => close(a.value ?? a.label) }, a.label)));
      card.appendChild(row);
    }
    wrap.appendChild(card);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(null); });
    $('#dialogs').appendChild(wrap);
    const f = $('input,textarea,button.btn-p', card); f && setTimeout(() => f.focus(), 30);
    wrap._close = close;
  });
}
const confirm = (title, text, { ok = 'OK', cancel = 'Cancel', danger = false } = {}) =>
  dialog({ title, body: text, actions: [{ label: cancel, value: false }, { label: ok, value: true, primary: true, danger }] });
function prompt(title, { value = '', placeholder = '', ok = 'OK', multiline = false, type = 'text', hint = '' } = {}) {
  const inp = multiline ? el('textarea', { class: 'field', rows: 4, placeholder }) : el('input', { class: 'field', type, placeholder });
  inp.value = value;
  const body = el('div', {}, inp, hint ? el('p', { class: 'hint' }, hint) : null);
  const p = dialog({ title, body, actions: [{ label: 'Cancel', value: null }, { label: ok, value: '__ok', primary: true }] });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !multiline) { e.preventDefault(); $('.btn-p', inp.closest('.dialog-card')).click(); } });
  return p.then(v => v === '__ok' ? inp.value.trim() : null);
}
/* pick one from a list: items = [{value,label,icon?,thumb?,sub?}] */
function pick(title, items, { cancel = true, search = false } = {}) {
  return new Promise(res => {
    const list = el('ul', { class: 'pick-list' });
    const render = q => {
      list.innerHTML = '';
      items.filter(i => !q || i.label.toLowerCase().includes(q.toLowerCase())).forEach(i => {
        list.appendChild(el('li', { onclick: () => { d._close(i.value); } },
          i.thumb ? el('div', { class: 'pk-thumb', style: { backgroundImage: `url(${i.thumb})` } }) : icon(i.icon || 'label'),
          el('div', { class: 'pk-t' }, el('div', {}, i.label), i.sub ? el('small', {}, i.sub) : null)));
      });
    };
    render('');
    const body = el('div', {});
    if (search) { const s = el('input', { class: 'field', placeholder: 'Search' }); s.addEventListener('input', () => render(s.value)); body.appendChild(s); }
    body.appendChild(list);
    let d; const p = dialog({ title, body, actions: cancel ? [{ label: 'Cancel', value: null }] : [], cls: 'pick' });
    d = $('#dialogs').lastElementChild;
    p.then(res);
  });
}

/* ---------- context menu ---------- */
let menuClose = null;
function menu(x, y, items, { anchor } = {}) {
  const m = $('#menu');
  m.innerHTML = '';
  items.forEach(it => {
    if (it === '-') return m.appendChild(el('div', { class: 'menu-sep' }));
    if (!it) return;
    const row = el('div', { class: 'menu-i' + (it.disabled ? ' dis' : ''), onclick: () => { if (it.disabled) return; hide(); it.onClick && it.onClick(); } },
      icon(it.icon || 'chevron_right'), el('span', {}, it.label), it.kbd ? el('kbd', {}, it.kbd) : null);
    m.appendChild(row);
  });
  m.classList.remove('hidden');
  const r = m.getBoundingClientRect();
  if (anchor) { const a = anchor.getBoundingClientRect(); x = a.right - r.width; y = a.bottom + 4; }
  m.style.left = clamp(x, 8, innerWidth - r.width - 8) + 'px';
  m.style.top = clamp(y, 8, innerHeight - r.height - 8) + 'px';
  function hide() { m.classList.add('hidden'); document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', esc, true); }
  const away = e => { if (!m.contains(e.target)) hide(); };
  const esc = e => { if (e.key === 'Escape') hide(); };
  setTimeout(() => { document.addEventListener('mousedown', away, true); document.addEventListener('keydown', esc, true); }, 0);
  menuClose = hide;
}
const menuAt = (anchor, items) => menu(0, 0, items, { anchor });

/* ---------- misc helpers ---------- */
function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name || 'download' });
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const canvasBlob = (c, type = 'image/jpeg', q = .92) => new Promise(r => c.toBlob(r, type, q));
function loadScript(src, key) {
  P._scripts = P._scripts || {};
  if (P._scripts[src]) return P._scripts[src];
  return P._scripts[src] = new Promise((res, rej) => { const s = el('script', { src }); s.onload = res; s.onerror = () => { delete P._scripts[src]; rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); });
}
function hashStr(s) { let h = 0; for (const c of s || 'x') h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
const hashColor = s => `hsl(${hashStr(s) % 360} 45% 45%)`;
const pluralize = (n, w, p) => `${n} ${n === 1 ? w : (p || w + 's')}`;
async function sha(str) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)); return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''); }

Object.assign(P, { $, $$, el, icon, uid, sleep, debounce, throttle, clamp, escapeHtml, bus, emit, on, fmt, MONTHS, DAYS, toast, dialog, confirm, prompt, pick, menu, menuAt, download, loadImage, canvasBlob, loadScript, hashStr, hashColor, pluralize, sha });
})();
