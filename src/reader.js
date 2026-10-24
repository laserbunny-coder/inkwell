import './reader.css';
import config from './config.js';

// The page a share link opens: a piece or a bible page from Inkwell, to read
// and comment on, with no account. Everything here comes from the copy the
// writer's app sent up (src/sharelink.js); comments go back through the
// inkwell-share server function.

const $ = (s) => document.querySelector(s);
const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const token = decodeURIComponent(location.hash.replace(/^#/, '')).trim();

// The writer, reading their own link on a browser where they're signed in to
// Inkwell, comments as themselves.
function session() {
  try {
    const ref = new URL(config.supabaseUrl).hostname.split('.')[0];
    const s = JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`) || 'null');
    return s?.access_token && s.expires_at * 1000 > Date.now() ? s.access_token : null;
  } catch { return null; }
}

async function call(body) {
  if (window.__shareBackend) return window.__shareBackend({ token, ...body });
  if (!config.supabaseUrl) throw new Error('This copy of Inkwell isn’t connected, so links can’t open here.');
  const res = await fetch(`${config.supabaseUrl}/functions/v1/inkwell-share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.supabaseAnonKey, Authorization: `Bearer ${session() || config.supabaseAnonKey}` },
    body: JSON.stringify({ token, ...body })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Couldn’t open this. Try again.'); e.code = data.code; throw e; }
  return data;
}

const state = { share: null, comments: [], since: null, pick: null, replyTo: null, hide: false };
// Who this reader is to the server, so a later version could let them edit their own comments.
const guest = (() => {
  try { let g = localStorage.getItem('inkwell-guest'); if (!g) { g = crypto.randomUUID(); localStorage.setItem('inkwell-guest', g); } return g; } catch { return ''; }
})();

function runs(e, list, upper = false) {
  for (const [t, f] of list || []) {
    t.split('\n').forEach((part, i) => {
      if (i) e.append(document.createElement('br'));
      if (!part) return;
      let node = document.createTextNode(upper ? part.toUpperCase() : part);
      if (f?.includes('i')) { const x = document.createElement('em'); x.append(node); node = x; }
      if (f?.includes('b')) { const x = document.createElement('strong'); x.append(node); node = x; }
      e.append(node);
    });
  }
  return e;
}

function blockEl(b, type) {
  let e;
  if (b.k === 'scene') {
    // Novels: a scene break. Scripts: a section heading, quietly, to find your way.
    if (type === 'screenplay') e = make('div', `rd-section rd-lv${b.lv || 1}`, (b.r || []).map((r) => r[0]).join(''));
    else e = make('div', 'rd-break', b.r?.length ? (b.r || []).map((r) => r[0]).join('') : '* * *');
  } else if (b.k === 'h') e = runs(make('h3', 'rd-h'), b.r);
  else if (b.k === 'line') {
    e = runs(make('div', `rd-line${b.done ? ' rd-done' : ''}`), b.r);
    e.style.setProperty('--d', b.d || 0);
  } else if (type === 'screenplay') {
    const el = b.el || 'action';
    e = runs(make('p', `rd-${el}`), b.r, el === 'scene' || el === 'character' || el === 'transition');
    if (el === 'scene' && b.code) e.prepend(make('span', 'rd-code', b.code));
  } else e = runs(make('p', 'rd-p'), b.r);
  e.classList.add('rd-block');
  e.dataset.id = b.id;
  return e;
}

const when = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function commentEl(c) {
  const box = make('div', `rd-c${c.owner ? ' rd-owner' : ''}`);
  const head = make('div', 'rd-c-head');
  head.append(make('b', '', c.name || 'A reader'), make('span', 'rd-c-when', ` · ${when(c.created_at)}`));
  box.append(head);
  if (c.quote) box.append(make('div', 'rd-c-quote', `“${c.quote}”`));
  box.append(make('div', 'rd-c-text', c.text));
  return box;
}

function threadEl(top) {
  const t = make('div', `rd-thread${top.resolved ? ' rd-resolved' : ''}`);
  t.dataset.thread = top.id;
  t.append(commentEl(top));
  for (const r of state.comments.filter((c) => c.parent_id === top.id)) t.append(commentEl(r));
  if (state.share.can_comment) {
    const b = make('button', 'rd-link', 'Reply');
    b.type = 'button';
    b.addEventListener('click', () => compose({ reply: top }));
    t.append(b);
  }
  return t;
}

function render() {
  const s = state.share;
  document.title = `${s.title} · Shared from Inkwell`;
  $('#rd-title').textContent = s.title;
  const type = s.content?.type || 'novel';
  document.body.className = `rd-${type}${state.hide ? ' rd-hide-comments' : ''}`;
  const body = $('#rd-body');
  body.replaceChildren();
  const tops = state.comments.filter((c) => !c.parent_id);
  const byBlock = new Map();
  for (const c of tops) (byBlock.get(c.block || '') || byBlock.set(c.block || '', []).get(c.block || '')).push(c);
  const chapters = s.content?.chapters || [];
  for (const ch of chapters) {
    const sec = make('section', 'rd-chapter');
    if (type === 'novel' && chapters.length > 1) sec.append(make('h2', 'rd-ch', ch.title));
    for (const b of ch.blocks) {
      sec.append(blockEl(b, type));
      for (const c of byBlock.get(b.id) || []) sec.append(threadEl(c));
    }
    body.append(sec);
  }
  if (!chapters.some((ch) => ch.blocks.length)) body.append(make('p', 'rd-hint', 'Nothing written here yet.'));
  // Comments on something no longer in the text still show, at the end.
  const ids = new Set(chapters.flatMap((ch) => ch.blocks.map((b) => b.id)));
  const loose = tops.filter((c) => !c.block || !ids.has(c.block));
  if (loose.length) {
    const sec = make('section', 'rd-chapter rd-loose');
    sec.append(make('div', 'rd-label', 'Other comments'));
    for (const c of loose) sec.append(threadEl(c));
    body.append(sec);
  }
  $('#rd-toggle').hidden = !tops.length;
  $('#rd-toggle').textContent = state.hide ? `Show comments (${tops.length})` : 'Hide comments';
  const hint = $('#rd-hint');
  hint.hidden = !s.can_comment;
  hint.textContent = matchMedia('(hover: hover)').matches ? 'To comment, click a paragraph (or select some words) and press Comment.' : 'To comment, tap a paragraph (or select some words), then Comment.';
}

// ---------- picking what to comment on ----------

function pick(blockEl, quote = '') {
  document.querySelectorAll('.rd-picked').forEach((e) => e.classList.remove('rd-picked'));
  state.pick = blockEl ? { id: blockEl.dataset.id, quote } : null;
  if (blockEl) blockEl.classList.add('rd-picked');
  $('#rd-bar').hidden = !blockEl || !$('#rd-compose').hidden;
  if (blockEl) placeBar(blockEl);
}

function placeBar(el) {
  const bar = $('#rd-bar');
  if (matchMedia('(max-width: 700px)').matches) { bar.style.top = ''; return; }
  bar.style.top = `${el.getBoundingClientRect().top + window.scrollY}px`;
}

document.addEventListener('mouseup', () => setTimeout(fromSelection, 0));
document.addEventListener('selectionchange', () => { if (!matchMedia('(hover: hover)').matches) setTimeout(fromSelection, 0); });
function fromSelection() {
  if (!state.share?.can_comment || !$('#rd-compose').hidden) return;
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed) return;
  const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
  const block = node?.closest('.rd-block');
  if (block) pick(block, sel.toString().trim().slice(0, 500));
}

$('#rd-body').addEventListener('click', (e) => {
  if (!state.share?.can_comment) return;
  const sel = document.getSelection();
  if (sel && !sel.isCollapsed) return;
  const block = e.target.closest('.rd-block');
  if (block) pick(block === document.querySelector('.rd-picked') ? null : block);
});

$('#rd-comment').addEventListener('click', () => compose({}));

function compose({ reply = null }) {
  state.replyTo = reply;
  const form = $('#rd-compose');
  form.hidden = false;
  $('#rd-bar').hidden = true;
  const q = $('#rd-quote');
  const quote = reply ? `Replying to ${reply.name || 'a reader'}` : state.pick?.quote ? `“${state.pick.quote}”` : '';
  q.hidden = !quote;
  q.textContent = quote;
  const name = $('#rd-name');
  try { name.value = name.value || localStorage.getItem('inkwell-reader-name') || ''; } catch { /* private window */ }
  $('#rd-text').focus();
}

function closeCompose() {
  $('#rd-compose').hidden = true;
  $('#rd-text').value = '';
  state.replyTo = null;
  pick(null);
}
$('#rd-cancel').addEventListener('click', closeCompose);

$('#rd-compose').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#rd-text').value.trim();
  if (!text) { $('#rd-text').focus(); return; }
  const name = $('#rd-name').value.trim();
  try { localStorage.setItem('inkwell-reader-name', name); } catch { /* private window */ }
  const send = $('#rd-send');
  send.disabled = true;
  send.textContent = 'Sending…';
  try {
    const body = state.replyTo ? { op: 'comment', parent: state.replyTo.id, name, text, guest } : { op: 'comment', block: state.pick?.id || null, quote: state.pick?.quote || '', name, text, guest };
    const { comment } = await call(body);
    state.comments.push(comment);
    state.since = comment.created_at > (state.since || '') ? comment.created_at : state.since;
    closeCompose();
    render();
    document.querySelector(`[data-thread="${CSS.escape(comment.parent_id || comment.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  } catch (err) {
    alert(err.message);
  } finally {
    send.disabled = false;
    send.textContent = 'Send';
  }
});

$('#rd-toggle').addEventListener('click', () => { state.hide = !state.hide; render(); });

// ---------- opening, and keeping up ----------

async function open() {
  if (!/^[A-Za-z0-9]{20,64}$/.test(token)) { gone('This link isn’t complete. Ask for it again.'); return; }
  try {
    const data = await call({ op: 'read' });
    state.share = data;
    state.comments = data.comments || [];
    state.since = state.comments.at(-1)?.created_at || null;
    render();
  } catch (err) {
    gone(err.code === 'gone' ? 'This link has been turned off.' : err.message);
  }
}

function gone(msg) {
  $('#rd-title').textContent = '';
  $('#rd-body').replaceChildren(make('p', 'rd-hint rd-gone', msg));
}

// New comments from others show up while you read.
async function refresh() {
  if (document.hidden || !state.share) return;
  try {
    const data = await call({ op: 'read', ...(state.since ? { since: state.since } : {}) });
    const known = new Set(state.comments.map((c) => c.id));
    const fresh = (data.comments || []).filter((c) => !known.has(c.id));
    // The writer kept writing: take the new words too.
    const rewritten = data.updated_at !== state.share.updated_at;
    if (rewritten) { const full = await call({ op: 'read' }); state.share = full; state.comments = full.comments || []; }
    else state.comments.push(...fresh);
    state.since = state.comments.at(-1)?.created_at || state.since;
    if ((fresh.length || rewritten) && $('#rd-compose').hidden) render();
  } catch (err) {
    if (err.code === 'gone') gone('This link has been turned off.');
  }
}
setInterval(refresh, 60000);
document.addEventListener('visibilitychange', refresh);
window.addEventListener('hashchange', () => location.reload());

open();
