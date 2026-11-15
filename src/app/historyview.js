// Panels revealed by the edges, and history: every version, what changed,
// and bringing things back.
import { isTouch } from '../device.js';
import { keep, versionsOf, blocks as docBlocks, compare, deletedFrom, bringBack } from '../history.js';
import { menuButton, ask, askText, toast } from '../menu.js';
import { titleOf } from '../notebook.js';
import { HistoryStrip } from '../hstrip.js';
import { ago } from '../library.js';
import { make } from '../dom.js';
import { $, body, edgesQuietUntil, editor, inNotebook, notes, root, state, store, writing } from '../main.js';
import { currentEditor, notebook } from './notebookview.js';
import { refreshWords } from './manuscript.js';
import { chapterMenu } from './tidying.js';
// The history strip (made further down, with history).
let hstrip = null;
// On a touch screen an edge opens on a tap, never on a hover: phones send
// stray hover events when the page shifts (the keyboard opening, say).
const hovers = () => Date.now() > edgesQuietUntil && !isTouch();
// The top bar comes down as the mouse nears the top of the page, and also when
// it overshoots into the window's own title bar. It goes away once the mouse
// is well below it, not the moment it slips off an edge.
// A short pause first, so reaching for something near the top of the page
// (and clicking it) doesn't pull the bar down over it.
const TOP_ZONE = 48;
let topByMouse = false;
let topTimer = 0;
let mouseY = Infinity;
const showTop = () => { clearTimeout(topTimer); body.classList.add('show-top'); topByMouse = true; };
const topAllowed = () => !body.classList.contains('show-outline') && !document.querySelector('.go-panel:not([hidden]), .palette:not([hidden])');

// ---------- history: every version, what changed, and bringing things back ----------

// What history is about right now: the chapter being written, or the page open in the notebook.
function historyTarget() {
  if (inNotebook() && notebook.page) {
    return {
      root: notebook.page, name: titleOf(notebook.page), ed: notebook.editor,
      save: () => notebook.close(),
      reload: async () => { const doc = await notebook.store.refresh(); notebook.replaceDoc(doc, false); },
      replace: (doc) => notebook.replaceDoc(doc, true)
    };
  }
  if (writing() && state.chapterId) {
    return {
      root: store.chapter, name: store.chapter?.title || 'this chapter', ed: editor,
      save: () => store.close(editor.state.doc),
      reload: async () => { await store.close(editor.state.doc); editor.commands.setContent(await store.refresh(), { emitUpdate: false }); notes.layout(); refreshWords(); },
      replace: (doc) => editor.commands.setContent(doc, { emitUpdate: true })
    };
  }
  return null;
}

let historyAt = null;
let historyMode2 = 'changes';

const dayLabel = (ms) => {
  const d = new Date(ms);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
};

// The day page's ⋯ menu.
function dayMenu() {
  return [{ label: 'History', run: () => hstrip.open() }];
}

// Every version as a list, and what was deleted: reached from the strip's own ⋯.
async function openHistory(pick) {
  const panel = $('.history');
  if (!panel.hidden) { closeHistory(); return; }
  const t = historyTarget();
  if (!t) { toast('Open a chapter or a page to see its history'); return; }
  await t.save();
  historyAt = t;
  panel.hidden = false;
  $('#history-title').textContent = `History · ${t.name}`;
  await renderHistoryList(pick);
}

function closeHistory() {
  $('.history').hidden = true;
  historyAt = null;
  currentEditor().commands.focus();
}

async function renderHistoryList(pick) {
  const t = historyAt;
  if (!t) return;
  const list = $('#history-list');
  list.replaceChildren();
  const [versions, deleted] = await Promise.all([versionsOf(t.root.id), deletedFrom(t.root)]);
  const item = (cls, top, sub, run) => {
    const li = make('li');
    const b = make('button', cls);
    b.append(make('div', 'when', top), make('div', 'meta', sub));
    b.addEventListener('click', () => { list.querySelectorAll('button').forEach((x) => x.classList.toggle('current', x === b)); run(); });
    li.append(b);
    list.append(li);
    return b;
  };
  let first = null;
  if (deleted.length) {
    const what = t.root.kind === 'chapter' ? 'paragraph' : 'line';
    const b = item('history-deleted', `Deleted ${what}s`, `${deleted.length} you can bring back`, () => showDeleted(deleted));
    if (pick === 'deleted') first = b;
  }
  let day = '';
  versions.forEach((v, i) => {
    const label = dayLabel(v.at);
    if (label !== day) { day = label; list.append(Object.assign(make('li', 'history-day'), { textContent: label })); }
    const older = versions[i + 1];
    const diff = older ? v.words - older.words : 0;
    const change = !older ? 'first kept' : diff > 0 ? `+${diff.toLocaleString()} words` : diff < 0 ? `−${(-diff).toLocaleString()} words` : 'words changed';
    const time = new Date(v.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const b = item('', `${time}${v.label ? ` · ${v.label}` : ''}`, `${v.words.toLocaleString()} words · ${change}`, () => showVersion(v));
    if (!first && i === 0 && pick !== 'deleted') first = b;
  });
  if (!versions.length && !deleted.length) {
    list.append(Object.assign(make('li', 'hint'), { textContent: 'Nothing yet. A version is kept each time you pause typing.' }));
    $('#history-meta').textContent = '';
    $('#history-doc').replaceChildren();
    $('.history-actions').hidden = true;
    $('.history-modes').hidden = true;
  }
  first?.click();
}

let historyPick = null;
function showVersion(v) {
  historyPick = v;
  $('.history-modes').hidden = false;
  $('.history-actions').hidden = false;
  $('#history-meta').textContent = `${dayLabel(v.at)}, ${new Date(v.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${v.words.toLocaleString()} words`;
  document.querySelectorAll('.history-modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === historyMode2));
  const box = $('#history-doc');
  box.replaceChildren();
  box.classList.toggle('outline-like', historyAt.root.kind !== 'chapter');
  if (historyMode2 === 'read') {
    for (const bl of docBlocks(v.doc)) box.append(blockEl(bl, 'same'));
    return;
  }
  const changes = compare(v.doc, historyAt.ed.getJSON());
  if (changes.every((c) => c.op === 'same')) box.append(make('p', 'hint', 'This is the same as now.'));
  for (const c of changes) {
    const el = blockEl(c.block, c.op, c.words);
    if (c.op === 'del') {
      const back = make('button', 'ghost-btn history-back', 'Bring back');
      back.addEventListener('click', async () => {
        insertBlock(historyAt, c.block, c.after);
        await historyAt.save();
        back.replaceWith(make('span', 'hint', 'Back in the text'));
        el.classList.add('brought');
      });
      el.append(back);
    }
    box.append(el);
  }
}

// One paragraph or line of a version, marked by how it changed since.
function blockEl(bl, op, wordsDiff) {
  const p = make('div', `hb hb-${op}${bl.scene ? ' hb-scene' : ''}`);
  if (bl.line) p.style.paddingLeft = `${bl.depth * 22}px`;
  const text = make('span', 'hb-text');
  if (op === 'chg' && wordsDiff) for (const w of wordsDiff) text.append(w.op === '=' ? document.createTextNode(w.t) : make(w.op === '-' ? 'del' : 'ins', '', w.t));
  else text.textContent = bl.scene ? `§ ${bl.text || 'Scene'}` : bl.text || ' ';
  p.append(text);
  if (op === 'del') p.title = 'Taken out since this version';
  if (op === 'ins') p.title = 'Added since this version';
  return p;
}

// Put a paragraph (or line) from an old version back into the text, after the
// one it used to follow.
function insertBlock(t, bl, afterEid) {
  const ed = t.ed;
  let node = bl.node;
  if (node.type === 'listItem') node = { ...node, content: (node.content || []).filter((c) => c.type !== 'bulletList') };
  let at = null;
  ed.state.doc.descendants((n, pos) => {
    if (at !== null) return false;
    if (afterEid && n.attrs?.eid === afterEid && (n.type.name === 'listItem' || !node.type.startsWith('list'))) { at = pos + n.nodeSize; return false; }
    return true;
  });
  if (at === null) at = node.type === 'listItem' ? 1 : 0;
  ed.chain().insertContentAt(at, node).run();
}

function showDeleted(rows) {
  historyPick = null;
  $('.history-modes').hidden = true;
  $('.history-actions').hidden = true;
  const what = historyAt.root.kind === 'chapter' ? 'paragraphs' : 'lines';
  $('#history-meta').textContent = `Deleted ${what}, newest first. Each comes back where it was.`;
  const box = $('#history-doc');
  box.replaceChildren();
  box.classList.remove('outline-like');
  for (const r of rows) {
    const p = make('div', 'hb hb-del');
    p.append(make('span', 'hb-text', r.text), make('span', 'hb-when', `deleted ${ago(r.updated_at)}`));
    const back = make('button', 'ghost-btn history-back', 'Bring back');
    back.addEventListener('click', async () => {
      await historyAt.save();
      await bringBack(r, historyAt.root);
      await historyAt.reload();
      back.replaceWith(make('span', 'hint', 'Back in the text'));
      p.classList.add('brought');
    });
    p.append(back);
    box.append(p);
  }
}

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wireHistory() {
  $('.edge-left').addEventListener('mouseenter', () => { if (hovers()) body.classList.add('show-outline'); });
  $('.edge-left').addEventListener('click', () => body.classList.add('show-outline'));
  $('.outline').addEventListener('mouseleave', () => body.classList.remove('show-outline'));
  document.addEventListener('mousemove', (e) => {
    mouseY = e.clientY;
    if (!hovers() || e.buttons) { clearTimeout(topTimer); topTimer = 0; return; }
    const open = body.classList.contains('show-top');
    if (!open && e.clientY <= TOP_ZONE && e.clientX > 18 && topAllowed()) {
      if (!topTimer) topTimer = setTimeout(() => { topTimer = 0; if (mouseY <= TOP_ZONE && topAllowed()) showTop(); }, 150);
    } else if (open && topByMouse && e.clientY > $('.topbar').getBoundingClientRect().bottom + 24) { body.classList.remove('show-top'); topByMouse = false; }
  });
  document.addEventListener('mousedown', () => { clearTimeout(topTimer); topTimer = 0; }, true);
  document.documentElement.addEventListener('mouseleave', (e) => { if (e.clientY <= 0 && hovers()) showTop(); });
  $('.edge-top').addEventListener('click', () => body.classList.add('show-top'));
  // The pages you look at start below the bar, however tall it is.
  new ResizeObserver(() => root.style.setProperty('--topbar-h', `${$('.topbar').offsetHeight}px`)).observe($('.topbar'));
  // On a touch screen there's no mouse to leave the bar, so a tap anywhere else tucks it away.
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' && !e.target.closest('.topbar, .edge-top')) body.classList.remove('show-top');
    if (e.pointerType !== 'mouse' && !e.target.closest('.outline, .edge-left')) body.classList.remove('show-outline');
  });
  // The strip over the page (Ctrl + Shift + H, or History in the page's ⋯ menu).
  hstrip = new HistoryStrip({
    target: historyTarget,
    toast,
    askText,
    openList: (pick) => openHistory(pick)
  });
  window.__hstrip = hstrip;
  $('#ch-more').append(menuButton(() => (state.chapterId && store.chapter ? chapterMenu(store.chapter) : []), 'More for this chapter'));
  $('.history-modes').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b || !historyPick) return;
    historyMode2 = b.dataset.mode;
    showVersion(historyPick);
  });
  $('#history-restore').addEventListener('click', async () => {
    const t = historyAt;
    if (!historyPick || !t) return;
    const ok = await ask({
      title: 'Go back to this version?',
      body: 'The text as it is now is kept in the history first, so you can come back to it.',
      ok: 'Go back to it'
    });
    if (!ok) return;
    await t.save();
    const now = t.ed.getJSON();
    await keep(t.root.id, now, t.ed.getText(), { force: true, label: 'Before going back' });
    t.replace(historyPick.doc);
    await t.save();
    closeHistory();
    toast('Back to the earlier version. The one before is in History.');
  });
  $('#history-copy').addEventListener('click', () => {
    if (historyPick) navigator.clipboard.writeText(docBlocks(historyPick.doc).map((b) => b.text).join('\n\n'));
    toast('Copied');
  });
}

export { closeHistory, dayMenu, hstrip, openHistory, wireHistory };
