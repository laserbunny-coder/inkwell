import './style.css';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EntryIds, SceneBreak } from './schema.js';
import { isMac, keyLabel, showKeysForThisComputer } from './keys.js';
import { StatsPanel, record as recordProgress } from './stats.js';
import { AltMark, ParagraphVersions, AltPanel, flip, newParagraphVersion } from './alts.js';
import { ChapterStore } from './chapter.js';
import { NotesLayer } from './notes.js';
import { BlockHandle } from './blocks.js';
import { getMeta, setMeta, putEntries, children, getEntry, snapshots, byKind, onLocalWrites, forgetDeleted, isTrashed } from './db.js';
import { trash, restore, trashed, deleteForever, contents } from './trash.js';
import { searchIndex } from './search.js';
import { popMenu, menuButton, onContextMenu, ask, askText, toast, closeMenu } from './menu.js';
import { Sync } from './sync.js';
import { ensureSeed, outline, entry, wordCount } from './model.js';
import { chapterMarkdown, bookMarkdown, download } from './export.js';
import { EntryRef, TagMarks } from './outline.js';
import { retitleLinks, freshenRefs } from './links.js';
import { Conflicts } from './conflicts.js';
import { vaultZip, pageMarkdown } from './vault.js';
import { ScriptElements, ELEMENTS, scriptPages, toFountain, fromFountain } from './script.js';
import { Notebook, rootOf, titleOf, dayId, renderLinkedFrom } from './notebook.js';
import { moveLine, toggleDone } from './outline.js';
import { openPicker } from './picker.js';
import { ensureAreas, areas, books, bookType, hasManuscript, kindName, areaColor, newArea, newBook, pagesIn, loosePages, bookOf, stats, dailyMentions, ago, changeType } from './library.js';

const $ = (s) => document.querySelector(s);
const body = document.body;
const root = document.documentElement;
const extensions = [
  StarterKit.configure({ codeBlock: false, code: false, horizontalRule: false }), EntryIds, SceneBreak, AltMark, ParagraphVersions,
  EntryRef.configure({ onPick: openPicker, onOpen: openEntry }),
  TagMarks.configure({ onTag: (t) => notebook.showTag(t) }),
  ScriptElements.configure({ isScript: () => isScript() })
];
const isScript = () => root.classList.contains('script');
// Deleted, missing, or in the Trash.
const gone = (r) => !r || r.deleted || isTrashed(r);

// project: the book open in the manuscript view. bookId: the book whose home is shown.
const state = { project: null, acts: [], chapterId: null, bookId: null, libArea: null };
const view = () => root.dataset.view || 'write';
const inNotebook = () => view() === 'notebook';

const statusEl = $('#status');
const store = new ChapterStore((s) => {
  statusEl.textContent = s === 'saving' ? 'Saving…' : s === 'error' ? 'Not saved — check storage' : 'Saved';
  statusEl.classList.toggle('error', s === 'error');
});

const editor = new Editor({
  element: $('#editor'),
  extensions,
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  onUpdate: ({ editor: ed }) => {
    store.change(ed.state.doc);
    notes.layout();
    refreshWords();
    scheduleScenes();
  }
});
window.__editor = editor;

const notes = new NotesLayer($('.notes-layer'), editor);
// Alternates, with Claude's suggestions when you're signed in and online.
// Tests stand in for Claude with window.__claude.
const alts = new AltPanel(editor, {
  ask: (body) => (window.__claude ? window.__claude(body) : sync.invoke('inkwell', body)),
  canAsk: () => !!window.__claude || (!!sync.user && navigator.onLine && !!sync.backend?.invoke),
  context: async () => {
    const chapter = state.chapterId ? await getEntry(state.chapterId) : null;
    const idea = state.project ? (await pagesIn(state.project.id)).find((p) => /^idea$/i.test(p.title || '')) : null;
    return { book: state.project?.title || '', chapter: chapter?.title || '', idea: idea ? await pageMarkdown(idea) : '' };
  }
});

const isText = (n) => n.type.name === 'paragraph' || n.type.name === 'heading';
const blocks = new BlockHandle(editor, $('.sheet'), {
  actions: [
    { label: 'Add a note', keys: '⌘⇧N', when: isText, run: ({ node }) => notes.add(node.attrs.eid) },
    { label: 'Versions of this paragraph', keys: '', when: isText, run: ({ index, handle }) => { const { from } = handle.range(index); editor.chain().setTextSelection(from + 1).focus().run(); alts.open({ scope: 'para' }); } },
    { label: 'New version to rewrite', keys: '⌘⇧D', when: isText, run: ({ index, handle }) => { const { from } = handle.range(index); editor.chain().setTextSelection(from + 1).focus().run(); newParagraphVersion(editor); } },
    { label: 'Move up', keys: 'Alt+⇧↑', when: (_n, i) => i > 0, run: ({ index, handle }) => handle.move(index, index - 1) },
    { label: 'Move down', keys: 'Alt+⇧↓', when: (_n, i, count) => i < count - 1, run: ({ index, handle }) => handle.move(index, index + 2) },
    ...ELEMENTS.map((x) => ({ label: x.label, keys: '', when: (n) => isScript() && n.type.name === 'paragraph' && (n.attrs.el || 'action') !== x.id, run: ({ index, handle }) => { const { from } = handle.range(index); editor.chain().setTextSelection(from + 1).updateAttributes('paragraph', { el: x.id }).focus().run(); } })),
    { label: 'Make it a heading', when: (n) => !isScript() && n.type.name === 'paragraph', run: ({ index, handle }) => { const { from } = handle.range(index); editor.chain().setTextSelection(from + 1).setNode('heading', { level: 2 }).focus().run(); } },
    { label: 'Make it a paragraph', when: (n) => n.type.name === 'heading', run: ({ index, handle }) => { const { from } = handle.range(index); editor.chain().setTextSelection(from + 1).setNode('paragraph').focus().run(); } },
    { label: 'Section above', when: () => isScript(), run: ({ index, handle }) => { const { from } = handle.range(index); editor.chain().insertContentAt(from, { type: 'sceneBreak' }).run(); requestAnimationFrame(() => editor.view.nodeDOM(from)?.querySelector('input')?.focus()); } },
    { label: 'Scene break above', when: () => !isScript(), run: ({ index, handle }) => { const { from } = handle.range(index); editor.chain().insertContentAt(from, { type: 'sceneBreak' }).focus().run(); } },
    { label: 'Delete', run: ({ index, handle }) => { const { from, to } = handle.range(index); if (editor.state.doc.childCount > 1) editor.chain().deleteRange({ from, to }).focus().run(); else editor.chain().setContent({ type: 'doc', content: [{ type: 'paragraph' }] }).focus().run(); } }
  ]
});

// ---------- script bar ----------

// On a phone there's no Tab key, so a row of element buttons rides just above
// the keyboard while you write a script. Tapping one changes the line you're on.
const scriptBar = $('.script-bar');
const touch = matchMedia('(hover: none)');
function placeScriptBar() {
  const show = touch.matches && isScript() && writing() && editor.isFocused;
  scriptBar.hidden = !show;
  body.classList.toggle('script-bar-on', show);
  if (!show) return;
  const vv = window.visualViewport;
  const bottom = vv ? window.innerHeight - (vv.offsetTop + vv.height) : 0;
  scriptBar.style.bottom = `${Math.max(0, bottom)}px`;
  const p = editor.state.selection.$from.parent;
  const el = p.type.name === 'paragraph' ? p.attrs.el || 'action' : null;
  scriptBar.querySelectorAll('button').forEach((b) => b.classList.toggle('current', b.dataset.el === el));
}
// The rows above the keyboard: a quick tap runs a button; holding (or sliding)
// scrolls the row instead, so a thumb resting on a button never sets it off.
// pointerdown is held back so the keyboard stays up.
const TAP_MS = 280;

// Room kept below the caret when the page scrolls to it: whatever the keyboard
// and the row above it cover, plus a couple of lines, so the caret never hides.
const caretRoom = {
  top: 60, left: 5, right: 5,
  get bottom() {
    const vv = window.visualViewport;
    const keyboard = vv ? Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)) : 0;
    const bar = [scriptBar, $('.outline-bar')].find((b) => b && !b.hidden);
    return keyboard + (bar ? bar.offsetHeight : 0) + 72;
  }
};

function tapBar(bar, selector, run) {
  let start = null;
  let hold = null;
  const end = () => { clearTimeout(hold); bar.classList.remove('holding'); };
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const b = e.target.closest(selector);
    start = b ? { b, x: e.clientX, y: e.clientY, t: performance.now(), left: bar.scrollLeft } : null;
    clearTimeout(hold);
    hold = setTimeout(() => bar.classList.add('holding'), TAP_MS);
  });
  bar.addEventListener('pointerup', (e) => {
    end();
    const s = start;
    start = null;
    if (!s) return;
    const tap = performance.now() - s.t < TAP_MS && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 10 && Math.abs(bar.scrollLeft - s.left) < 4;
    if (tap) { run(s.b); caretSoon(80); }
  });
  bar.addEventListener('pointercancel', () => { end(); start = null; });
}
tapBar(scriptBar, 'button[data-el]', (b) => {
  if (b.dataset.el === 'section') {
    const at = editor.state.selection.$from.before(1);
    editor.chain().insertContentAt(at, { type: 'sceneBreak' }).run();
    requestAnimationFrame(() => editor.view.nodeDOM(at)?.querySelector('input')?.focus());
  } else editor.chain().focus().updateAttributes('paragraph', { el: b.dataset.el }).run();
  placeScriptBar();
});
editor.on('transaction', placeScriptBar);
editor.on('focus', placeScriptBar);
editor.on('blur', () => setTimeout(placeScriptBar, 50));
window.visualViewport?.addEventListener('resize', placeScriptBar);
window.visualViewport?.addEventListener('scroll', placeScriptBar);

// ---------- notebook ----------

let railTimer;
const notebook = new Notebook({
  onPick: openPicker,
  onOpen: openEntry,
  onStatus: (s) => { if (inNotebook()) statusEl.textContent = s === 'saving' ? 'Saving…' : s === 'error' ? 'Not saved — check storage' : 'Saved'; },
  onChange: () => { clearTimeout(railTimer); railTimer = setTimeout(renderRail, 100); },
  onPlace: (page) => {
    if (!inNotebook()) return;
    remember({ view: 'notebook', pageId: page.id, ...(notebook?.zoom ? { zoom: notebook.zoom } : {}) });
    $('#nb-more').replaceChildren(...(page.kind === 'page' ? [menuButton(() => pageMenu(page), 'More for this page')] : []));
    renderCrumb();
  },
  // Zooming in is a step you can go Back from.
  onZoom: (zoom) => {
    if (!inNotebook() || !notebook.page) return;
    remember({ view: 'notebook', pageId: notebook.page.id, ...(zoom ? { zoom } : {}) });
  }
});

// On a phone, a row above the keyboard for outlines: indent, move, tag, link, fold, zoom.
const outlineBar = $('.outline-bar');
function placeOutlineBar() {
  const show = touch.matches && inNotebook() && notebook.editor.isFocused;
  outlineBar.hidden = !show;
  body.classList.toggle('outline-bar-on', show);
  if (!show) return;
  const vv = window.visualViewport;
  outlineBar.style.bottom = `${Math.max(0, vv ? window.innerHeight - (vv.offsetTop + vv.height) : 0)}px`;
  const here = notebook.currentLine();
  const zoomOut = !!notebook.zoom && here === notebook.zoom;
  outlineBar.querySelector('[data-do="undo"]').disabled = !notebook.editor.can().undo();
  outlineBar.querySelector('[data-do="redo"]').disabled = !notebook.editor.can().redo();
  const z = outlineBar.querySelector('[data-do="zoom"]');
  z.textContent = zoomOut ? 'Out' : 'Zoom';
  z.setAttribute('aria-label', zoomOut ? 'Zoom out' : 'Zoom in');
}
tapBar(outlineBar, 'button[data-do]', (b) => {
  const ed = notebook.editor;
  const act = b.dataset.do;
  if (act === 'undo') ed.chain().focus().undo().run();
  else if (act === 'redo') ed.chain().focus().redo().run();
  else if (act === 'done') toggleDone(ed);
  else if (act === 'move') setTimeout(moveLinePicker, 120); // after the tap's click, so it doesn't land on the menu
  else if (act === 'indent') ed.chain().focus().sinkListItem('listItem').scrollIntoView().run();
  else if (act === 'outdent') ed.chain().focus().liftListItem('listItem').scrollIntoView().run();
  else if (act === 'up' || act === 'down') moveLine(ed, act === 'up' ? -1 : 1);
  else if (act === 'tag') {
    const { $from } = ed.state.selection;
    const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset);
    ed.chain().focus().insertContent(before && before !== ' ' ? ' #' : '#').run();
  } else if (act === 'link') openPicker(ed);
  else if (act === 'zoom') { const here = notebook.currentLine(); notebook.zoomTo(notebook.zoom && here === notebook.zoom ? null : here); ed.commands.focus(); }
  placeOutlineBar();
});
for (const ed of [editor, notebook.editor]) ed.view.setProps({ scrollMargin: caretRoom, scrollThreshold: caretRoom });
// When the keyboard or a row appears, bring the caret back above them.
// On a phone, a standing rule: the caret always sits clear above the keyboard
// and the row, with a couple of lines to spare, however it got there (a tap,
// typing, zooming, moving a line, or the keyboard opening).
function keepCaretInView() {
  const ed = currentEditor();
  if (!touch.matches || !ed?.isFocused) return;
  let r;
  try { r = ed.view.coordsAtPos(ed.state.selection.head); } catch { return; }
  const vv = window.visualViewport;
  const bar = [scriptBar, outlineBar].find((b) => !b.hidden);
  const floor = (bar ? bar.getBoundingClientRect().top : vv ? vv.offsetTop + vv.height : window.innerHeight) - 72;
  const ceiling = (vv ? vv.offsetTop : 0) + 60;
  if (r.bottom > floor) window.scrollBy(0, r.bottom - floor);
  else if (r.top < ceiling) window.scrollBy(0, r.top - ceiling);
}
let caretTimer;
const caretSoon = (ms = 60) => { clearTimeout(caretTimer); caretTimer = setTimeout(() => requestAnimationFrame(keepCaretInView), ms); };
for (const ed of [editor, notebook.editor]) { ed.on('selectionUpdate', () => caretSoon()); ed.on('focus', () => caretSoon(250)); }
window.visualViewport?.addEventListener('resize', () => caretSoon(120));
window.visualViewport?.addEventListener('scroll', () => caretSoon(200));
notebook.editor.on('transaction', placeOutlineBar);
notebook.editor.on('focus', placeOutlineBar);
notebook.editor.on('blur', () => setTimeout(placeOutlineBar, 50));
window.visualViewport?.addEventListener('resize', placeOutlineBar);
window.visualViewport?.addEventListener('scroll', placeOutlineBar);

const currentEditor = () => (inNotebook() ? notebook.editor : editor);

// ---------- getting around ----------

// Where you are, kept per device so the app opens back there.
// Each place also goes in the browser's history, so Back and Forward (mouse
// buttons, Alt+← →, ⌘[ ]) step through where you've been.
let historyMode = 'replace';
function remember(place) {
  try { localStorage.setItem('place', JSON.stringify(place)); } catch { /* full */ }
  if (JSON.stringify(history.state) === JSON.stringify(place)) return;
  if (historyMode === 'push') history.pushState(place, '');
  else history.replaceState(place, '');
}

window.addEventListener('popstate', async (e) => {
  if (!e.state?.view) return;
  historyMode = 'replace';
  try { await go(e.state); } finally { historyMode = 'push'; }
});

async function go(place) {
  // Somewhere that has since gone to the Trash (Back can lead there): go nearby instead.
  if (place.view === 'write' && place.chapterId && gone(await getEntry(place.chapterId))) place = { view: 'library' };
  if (place.view === 'project' && gone(await getEntry(place.id))) place = { view: 'library' };
  if (place.view === 'notebook' && place.pageId && !place.pageId.startsWith('day-') && gone(await getEntry(place.pageId))) place = { view: 'notebook', pageId: dayId(isoToday()) };
  if (place.view === 'notebook' && !place.pageId && notebook.page && !notebook.isDay && gone(await getEntry(notebook.page.id))) place = { view: 'notebook', pageId: dayId(isoToday()) };
  const from = view();
  // Switch at once so the next keystroke lands in the right place; saving catches up.
  if (from === 'write' && place.view !== 'write') store.close(editor.state.doc);
  if (from === 'notebook' && place.view !== 'notebook') notebook.close();
  if (place.view === 'write') delete root.dataset.view;
  else root.dataset.view = place.view;
  body.classList.remove('show-outline');
  $('#view-toggle').textContent = place.view === 'notebook' ? 'Write' : 'Today';

  if (place.view === 'write') {
    editor.commands.focus();
    const id = place.chapterId || state.chapterId || (await lastChapterAnywhere());
    if (!id) return go({ view: 'library' });
    if (id !== state.chapterId) await openChapter(id);
    else remember({ view: 'write', chapterId: id });
    if (place.focus) focusParagraph(place.focus);
  } else if (place.view === 'notebook') {
    notebook.editor.commands.focus();
    const id = place.pageId;
    if (id && id !== notebook.page?.id) {
      const fallback = id.startsWith('day-') ? entry('day', { id, title: id.slice(4) }) : null;
      await notebook.open(id, fallback, place.line);
    } else if (!notebook.page) await notebook.openDay();
    else {
      if (place.line) notebook.focusLine(place.line);
      remember({ view: 'notebook', pageId: notebook.page.id });
    }
    if ((place.zoom || null) !== notebook.zoom) {
      const mode = historyMode;
      historyMode = 'replace';
      notebook.zoomTo(place.zoom || null);
      historyMode = mode;
    }
  } else if (place.view === 'library') {
    if ('area' in place) state.libArea = place.area;
    remember({ view: 'library', area: state.libArea });
    await renderLibrary();
  } else if (place.view === 'project') {
    state.bookId = place.id;
    remember(place);
    await renderProject();
  }
  renderCrumb();
  renderRail();
}

async function openBook(projectId) {
  const book = await getEntry(projectId);
  if (!book || !hasManuscript(book)) return go({ view: 'project', id: projectId });
  const acts = await outline(projectId);
  const chapters = acts.flatMap((a) => a.chapters);
  const last = await getMeta(`lastChapter:${projectId}`);
  const id = chapters.some((c) => c.id === last) ? last : chapters[0]?.id;
  if (id) return go({ view: 'write', chapterId: id });
  return go({ view: 'project', id: projectId });
}

async function lastChapterAnywhere() {
  const last = await getMeta('lastChapter');
  const ch = last && (await getEntry(last));
  if (!gone(ch)) {
    const book = await bookOf(ch);
    if (!gone(book)) return ch.id;
  }
  const novels = (await books()).filter(hasManuscript).sort((a, b) => a.created_at - b.created_at);
  for (const b of novels) {
    const first = (await outline(b.id)).flatMap((a) => a.chapters)[0];
    if (first) return first.id;
  }
  return null;
}

function focusParagraph(eid) {
  editor.state.doc.forEach((node, pos) => {
    if (node.attrs.eid === eid) { editor.commands.setTextSelection(pos + node.nodeSize - 1); editor.view.nodeDOM(pos)?.scrollIntoView({ block: 'center' }); }
  });
}

// Follow a link: pages and days open in the notebook, chapters in the
// manuscript, books on their home page, and a single line or paragraph opens
// where it lives.
async function openEntry(id) {
  const row = await getEntry(id);
  if (gone(row)) return;
  if (row.kind === 'project') return go({ view: 'project', id: row.id });
  if (row.kind === 'area') return go({ view: 'library', area: row.id });
  const home = await rootOf(row);
  if (!home) return;
  const focus = home.id === row.id ? null : row.id;
  if (home.kind === 'day' || home.kind === 'page') return go({ view: 'notebook', pageId: home.id, line: focus });
  if (home.kind === 'chapter') return go({ view: 'write', chapterId: home.id, focus });
}

async function newPageHere() {
  let parent = null;
  if (view() === 'project') parent = state.bookId;
  else if (view() === 'write') parent = state.project?.id || null;
  else if (inNotebook() && notebook.page) parent = (await bookOf(notebook.page))?.id || null;
  if (!inNotebook()) await go({ view: 'notebook' });
  await notebook.newPage(parent);
}

// ---------- sync between devices ----------

const syncEl = $('#sync');
const SYNC_LABELS = { 'signed-out': 'Sign in to sync', syncing: 'Syncing…', synced: 'Synced', offline: 'Offline · will sync' };
const sync = new Sync({
  onStatus: (s) => {
    syncEl.hidden = s === 'off';
    syncEl.textContent = SYNC_LABELS[s] || '';
    syncEl.dataset.state = s;
    document.body.dataset.sync = s;
    if (s === 'synced') conflicts.count();
  },
  onRemote: applyRemote
});
const conflicts = new Conflicts({ onApplied: (rows) => applyRemote(rows) });
// Progress keeps a small daily tally; it's noted a little after you stop typing.
let tallyTimer = null;
const tallySoon = (ms = 20000) => { clearTimeout(tallyTimer); tallyTimer = setTimeout(() => recordProgress().catch((e) => console.error(e)), ms); };
onLocalWrites((rows) => {
  sync.soon();
  if (rows.some((r) => r.kind !== 'tally')) tallySoon();
  retitleLinks(rows).then((changed) => { if (changed) { freshenRefs(editor); freshenRefs(notebook.editor); } }).catch((e) => console.error(e));
});
window.__sync = sync;
syncEl.addEventListener('click', () => { if (syncEl.dataset.state === 'signed-out') sync.signIn(); else sync.soon(0); });

// An untouched starter book on a new device gives way to the real one from the cloud.
async function dropEmptySeed(keep) {
  for (const p of await byKind('project')) {
    if (p.id === keep.id || p.deleted || p.title !== 'Untitled novel') continue;
    const acts = await outline(p.id);
    const chapters = acts.flatMap((a) => a.chapters);
    if (!chapters.every((c) => !c.fields?.words)) continue;
    const now = Date.now();
    await putEntries([p, ...acts, ...chapters].map((e) => ({ ...e, deleted: true, updated_at: now })));
  }
}

async function applyRemote(rows) {
  if (rows.some((r) => r.kind === 'settings')) await notes.reloadTypes();
  if (state.chapterId && rows.some((r) => r.links?.includes(state.chapterId))) renderChapterLinks();
  const structural = rows.some((r) => ['project', 'act', 'chapter', 'area', 'page'].includes(r.kind));
  if (structural) {
    const remoteProject = rows.find((r) => r.kind === 'project' && !r.deleted);
    if (remoteProject) await dropEmptySeed(remoteProject);
    if (state.project) {
      const p = await getEntry(state.project.id);
      state.project = gone(p) ? null : p;
    }
    const ch = state.chapterId && (await getEntry(state.chapterId));
    if (state.chapterId && gone(ch)) await leaveChapter();
    if (view() === 'write' && (!state.project || gone(ch))) {
      state.chapterId = null;
      const id = await lastChapterAnywhere();
      if (id) await openChapter(id);
      else await go({ view: 'library' });
    } else if (state.project) state.acts = await outline(state.project.id);
    if (inNotebook() && notebook.page && !notebook.isDay && gone(await getEntry(notebook.page.id))) await go({ view: 'notebook', pageId: dayId(isoToday()) });
    if (view() === 'library') await renderLibrary();
    if (view() === 'project') await renderProject();
    renderRail();
    renderCrumb();
  }
  if (rows.some((r) => r.parent_id === state.chapterId && ['para', 'scene', 'heading'].includes(r.kind))) await applyRemoteChapter();
  if (rows.some((r) => r.kind === 'note' && r.fields?.chapter_id === state.chapterId)) await notes.load(state.chapterId);
  await notebook.applyRemote(rows);
}

async function applyRemoteChapter(tries = 0) {
  // Never replace text that's still being saved; wait for this device to settle.
  if (!store.idle) { if (tries < 20) setTimeout(() => applyRemoteChapter(tries + 1), 800); return; }
  const doc = await store.refresh();
  if (JSON.stringify(doc) === JSON.stringify(editor.state.doc.toJSON())) return;
  const { $from } = editor.state.selection;
  const block = $from.node(1);
  const anchor = block ? { eid: block.attrs.eid, offset: $from.parentOffset } : null;
  const focused = editor.isFocused;
  editor.commands.setContent(doc, { emitUpdate: false });
  if (anchor?.eid) {
    editor.state.doc.forEach((node, pos) => {
      if (node.attrs.eid === anchor.eid) {
        const at = Math.min(pos + 1 + anchor.offset, pos + node.nodeSize - 1);
        editor.commands.setTextSelection(at);
      }
    });
  }
  if (focused) editor.view.focus();
  refreshWords();
  scheduleScenes();
  notes.layout();
}

// ---------- chapters ----------

async function openChapter(id) {
  if (state.chapterId === id) return;
  if (state.chapterId) await store.close(editor.state.doc);
  const { doc, recovered } = await store.load(id);
  state.chapterId = id;
  const book = await bookOf(store.chapter);
  if (book && book.id !== state.project?.id) state.project = book;
  root.classList.toggle('script', bookType(book) === 'screenplay');
  requestAnimationFrame(placeScriptBar);
  editor.commands.setContent(doc, { emitUpdate: false });
  if (recovered) store.change(editor.state.doc);
  else statusEl.textContent = 'Saved';
  freshenRefs(editor);
  if (state.project) state.acts = await outline(state.project.id);
  await notes.load(id);
  await renderChapterLinks();
  await setMeta('lastChapter', id);
  if (state.project) await setMeta(`lastChapter:${state.project.id}`, id);
  if (view() === 'write') remember({ view: 'write', chapterId: id });
  refreshWords();
  renderRail();
  renderCrumb();
  editor.commands.focus('end');
}

// What links to this chapter, shown after its last paragraph.
async function renderChapterLinks() {
  if (!state.chapterId) return;
  const n = await renderLinkedFrom(state.chapterId, $('.chapter-links'), $('#chapter-links-list'), openEntry);
  const chip = $('#chapter-links-chip');
  chip.hidden = !n || view() !== 'write';
  chip.textContent = `Linked from ${n}`;
}
$('#chapter-links-chip').addEventListener('click', () => $('.chapter-links').scrollIntoView({ behavior: 'smooth', block: 'center' }));

function refreshWords() {
  if (view() !== 'write') { $('#words').textContent = ''; return; }
  if (isScript()) { const n = scriptPages(editor.state.doc); $('#words').textContent = `About ${n} page${n === 1 ? '' : 's'}`; return; }
  $('#words').textContent = `${wordCount(editor.state.doc.textContent).toLocaleString()} words`;
}

async function newChapter() {
  if (!state.project) return;
  const act = state.acts.find((a) => a.chapters.some((c) => c.id === state.chapterId)) || state.acts.at(-1);
  if (!act) return newAct();
  const level = state.project.fields?.levels?.[1] || 'Chapter';
  const count = state.acts.reduce((n, a) => n + a.chapters.length, 0);
  const ch = entry('chapter', { parent_id: act.id, title: `${level} ${count + 1}`, sort: (act.chapters.at(-1)?.sort || 0) + 1 });
  await putEntries([ch]);
  state.acts = await outline(state.project.id);
  await openChapter(ch.id);
}

async function newAct() {
  if (!state.project) return;
  const level = state.project.fields?.levels?.[0] || 'Act';
  const names = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
  const act = entry('act', { parent_id: state.project.id, title: `${level} ${names[state.acts.length] || state.acts.length + 1}`, sort: (state.acts.at(-1)?.sort || 0) + 1 });
  const chLevel = state.project.fields?.levels?.[1] || 'Chapter';
  const count = state.acts.reduce((n, a) => n + a.chapters.length, 0);
  const ch = entry('chapter', { parent_id: act.id, title: `${chLevel} ${count + 1}`, sort: 1 });
  await putEntries([act, ch]);
  state.acts = await outline(state.project.id);
  await openChapter(ch.id);
}

// ---------- names you can rename in place ----------

function renameable(el, row, after) {
  el.addEventListener('dblclick', (e) => {
    e.preventDefault();
    el.contentEditable = 'true';
    el.classList.add('renaming');
    el.focus();
    document.getSelection().selectAllChildren(el);
  });
  const finish = async (save) => {
    if (el.contentEditable !== 'true') return;
    el.contentEditable = 'false';
    el.classList.remove('renaming');
    const title = el.textContent.trim();
    if (save && title && title !== row.title) {
      row.title = title;
      row.updated_at = Date.now();
      await putEntries([row]);
      if (row.id === state.project?.id) state.project.title = title;
      renderCrumb();
      after?.();
    } else {
      el.textContent = row.title;
    }
  };
  el.addEventListener('keydown', (e) => {
    if (el.contentEditable !== 'true') return;
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  el.addEventListener('blur', () => finish(true));
}

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};
const dot = (color) => { const d = make('span', 'dot'); d.style.background = color; return d; };

async function areaPath(areaId, all) {
  const list = all || (await areas());
  const out = [];
  for (let a = list.find((x) => x.id === areaId), i = 0; a && i < 20; a = list.find((x) => x.id === a.parent_id), i++) out.unshift(a);
  return out;
}

const subtree = (areaId, all) => {
  const ids = new Set([areaId]);
  let grew = true;
  while (grew) { grew = false; for (const a of all) if (a.parent_id && ids.has(a.parent_id) && !ids.has(a.id)) { ids.add(a.id); grew = true; } }
  return ids;
};

// ---------- the library sidebar (left edge) ----------

let railBusy = Promise.resolve();
function renderRail() { railBusy = railBusy.then(drawRail).catch((e) => console.error(e)); return railBusy; }

async function drawRail() {
  const [allAreas, allBooks, loose] = await Promise.all([areas(), books(), loosePages()]);
  let current = null;
  if (view() === 'write') current = state.project?.id;
  else if (view() === 'project') current = state.bookId;
  else if (inNotebook() && notebook.page) current = (await bookOf(notebook.page))?.id;

  const tree = $('#outline-tree');
  const out = [];
  $('.rail-top [data-cmd="library"]').classList.toggle('current', view() === 'library');
  $('.rail-top [data-cmd="today"]').classList.toggle('current', inNotebook() && notebook.page?.id === dayId(isoToday()) );

  const bookNode = async (b, depth) => {
    const area = allAreas.find((a) => a.id === b.area_id);
    const btn = make('button', 'tree-book' + (b.id === current ? ' current' : ''));
    btn.style.paddingLeft = `${10 + depth * 14}px`;
    const name = make('span', 'name', b.title || 'Untitled');
    btn.append(dot(areaColor(area)), name);
    btn.addEventListener('click', () => { if (name.contentEditable !== 'true') go({ view: 'project', id: b.id }); });
    renameable(name, b, renderRail);
    onContextMenu(btn, () => bookMenu(b));
    out.push(btn);
    if (b.id !== current) return;
    const pad = 26 + depth * 14;
    if (hasManuscript(b)) {
      const acts = b.id === state.project?.id ? state.acts : await outline(b.id);
      for (const act of acts) {
        const a = make('div', 'tree-act', act.title);
        a.style.paddingLeft = `${pad}px`;
        renameable(a, act);
        onContextMenu(a, () => actMenu(act));
        out.push(a);
        for (const ch of act.chapters) {
          const c = make('button', 'tree-chapter' + (ch.id === state.chapterId && view() === 'write' ? ' current' : ''), ch.title);
          c.style.paddingLeft = `${pad + 14}px`;
          c.addEventListener('click', () => { if (c.contentEditable !== 'true') go({ view: 'write', chapterId: ch.id }); });
          renameable(c, ch);
          onContextMenu(c, () => chapterMenu(ch));
          out.push(c);
          if (ch.id === state.chapterId && view() === 'write') {
            const scenes = make('div');
            scenes.id = 'outline-scenes';
            scenes.style.setProperty('--pad', `${pad + 30}px`);
            out.push(scenes);
          }
        }
      }
    }
    for (const p of await pagesIn(b.id)) {
      const c = make('button', 'tree-page' + (inNotebook() && notebook.page?.id === p.id ? ' current' : ''), p.title || 'Untitled page');
      c.style.paddingLeft = `${pad}px`;
      c.addEventListener('click', () => go({ view: 'notebook', pageId: p.id }));
      onContextMenu(c, () => pageMenu(p));
      out.push(c);
    }
  };

  const areaNode = async (area, depth) => {
    const label = make('button', 'tree-area', area.title);
    label.style.paddingLeft = `${10 + depth * 14}px`;
    label.addEventListener('click', () => { if (label.contentEditable !== 'true') go({ view: 'library', area: area.id }); });
    renameable(label, area, renderRail);
    onContextMenu(label, () => areaMenu(area));
    out.push(label);
    for (const b of allBooks.filter((x) => x.area_id === area.id).sort((x, y) => x.title.localeCompare(y.title))) await bookNode(b, depth);
    for (const sub of allAreas.filter((a) => a.parent_id === area.id)) await areaNode(sub, depth + 1);
  };

  for (const area of allAreas.filter((a) => !a.parent_id || !allAreas.some((x) => x.id === a.parent_id))) await areaNode(area, 0);
  const orphans = allBooks.filter((b) => !allAreas.some((a) => a.id === b.area_id));
  if (orphans.length) { out.push(make('div', 'tree-area', 'Other')); for (const b of orphans) await bookNode(b, 0); }
  if (loose.length) {
    out.push(make('div', 'tree-area', 'Loose pages'));
    for (const p of loose.slice(0, 12)) {
      const c = make('button', 'tree-page' + (inNotebook() && notebook.page?.id === p.id ? ' current' : ''), p.title || 'Untitled page');
      c.style.paddingLeft = '10px';
      c.addEventListener('click', () => go({ view: 'notebook', pageId: p.id }));
      onContextMenu(c, () => pageMenu(p));
      out.push(c);
    }
    if (loose.length > 12) {
      const more = make('button', 'tree-page tree-more', `All ${loose.length} loose pages ›`);
      more.style.paddingLeft = '10px';
      more.addEventListener('click', async () => { await go({ view: 'library', area: null }); $('#lib-loose-box').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      out.push(more);
    }
  }
  tree.replaceChildren(...out);
  renderScenes();

  const tags = new Map();
  for (const l of await byKind('line')) if (!l.deleted) for (const t of l.tags || []) tags.set(t, (tags.get(t) || 0) + 1);
  $('#shelves-tags').replaceChildren(...[...tags].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t]) => {
    const b = make('button', 'tag-chip', `#${t}`);
    b.addEventListener('click', () => notebook.showTag(t));
    return b;
  }));
  $('#shelves-tags-label').hidden = !tags.size;
}

let scenesTimer;
function scheduleScenes() {
  clearTimeout(scenesTimer);
  scenesTimer = setTimeout(renderScenes, 400);
}

function renderScenes() {
  const box = $('#outline-scenes');
  if (!box) return;
  box.replaceChildren();
  editor.state.doc.forEach((node, pos) => {
    // In a script, sections are your story's own headings and the INT./EXT.
    // scene headings sit under them.
    const slug = isScript() && node.type.name === 'paragraph' && node.attrs.el === 'scene' && node.textContent.trim();
    if (node.type.name !== 'sceneBreak' && !slug) return;
    const b = make('button', slug ? 'tree-scene tree-slug' : 'tree-scene', slug ? slug.toUpperCase() : node.attrs.title || (isScript() ? 'Untitled section' : 'Untitled scene'));
    b.style.paddingLeft = slug ? `calc(${box.style.getPropertyValue('--pad')} + 12px)` : box.style.getPropertyValue('--pad');
    b.addEventListener('click', () => {
      editor.view.nodeDOM(pos)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      editor.commands.focus(pos + node.nodeSize + 1);
    });
    box.append(b);
  });
}

// ---------- breadcrumb: where you are ----------

let crumbBusy = Promise.resolve();
function renderCrumb() { crumbBusy = crumbBusy.then(drawCrumb).catch((e) => console.error(e)); return crumbBusy; }

async function drawCrumb() {
  const parts = [];
  const link = (label, run, cls = '') => { const b = make('button', 'crumb-part ' + cls, label); b.addEventListener('click', run); return b; };
  const all = await areas();
  const lib = link('Library', () => go({ view: 'library', area: null }));
  const areaParts = async (areaId) => (await areaPath(areaId, all)).map((a) => link(a.title, () => go({ view: 'library', area: a.id })));
  const bookPart = (b) => link(`${b.title || 'Untitled'} ▾`, () => openPalette('go', 'books'), 'book');
  if (view() === 'library') {
    parts.push(lib, ...(state.libArea ? await areaParts(state.libArea) : []));
  } else if (view() === 'project') {
    const b = await getEntry(state.bookId);
    if (b) parts.push(lib, ...(await areaParts(b.area_id)), bookPart(b));
  } else if (view() === 'write' && state.project) {
    const ch = state.chapterId && (await getEntry(state.chapterId));
    parts.push(lib, ...(await areaParts(state.project.area_id)), bookPart(state.project), link(ch?.title || '', () => {}, 'here'));
  } else if (inNotebook() && notebook.page) {
    const p = notebook.page;
    if (p.kind === 'day') parts.push(link('Daily pages', () => go({ view: 'notebook', pageId: dayId(isoToday()) })), link(titleOf(p), () => {}, 'here'));
    else {
      const b = await bookOf(p);
      if (b) parts.push(lib, ...(await areaParts(b.area_id)), link(b.title, () => go({ view: 'project', id: b.id })));
      else parts.push(lib, link('Loose pages', () => go({ view: 'library', area: null })));
      parts.push(link(p.title || 'Untitled page', () => {}, 'here'));
    }
  }
  const crumb = $('#crumb');
  crumb.replaceChildren();
  parts.forEach((p, i) => { if (i) crumb.append(make('span', 'sep', '›')); crumb.append(p); });
  refreshWords();
}

// ---------- tidying up: rename, move, change kind, the Trash ----------

const plural = (n, word, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;
const nameOf = (row) => (row.kind === 'day' ? titleOf(row) : row.title || (row.kind === 'page' ? 'Untitled page' : 'Untitled'));
const KINDS = [['novel', 'Novel'], ['screenplay', 'Screenplay'], ['notes', 'Notes collection']];

async function refreshViews() {
  if (state.project) {
    const p = await getEntry(state.project.id);
    state.project = gone(p) ? null : p;
    if (state.project) state.acts = await outline(state.project.id);
  }
  if (view() === 'library') await renderLibrary();
  if (view() === 'project') await renderProject();
  if (inNotebook() && notebook.page && !notebook.isDay) {
    const p = await getEntry(notebook.page.id);
    if (p && !gone(p)) { notebook.page = notebook.store.page = p; notebook.renderHead(); }
  }
  renderRail();
  renderCrumb();
}

// The chapter on screen has gone (here or on another device): finish saving,
// then let it go, so nothing typed later is saved into it.
async function leaveChapter() {
  await store.close(editor.state.doc);
  store.detach();
  state.chapterId = null;
  editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }, { emitUpdate: false });
  await notes.load(null);
}

// Is `id` the entry `root` or somewhere inside it (by parent, or a book in an area)?
async function isWithin(id, root) {
  let r = id && (await getEntry(id));
  for (let i = 0; r && i < 80; i++) {
    if (r.id === root.id) return true;
    const up = r.parent_id || (r.kind === 'project' ? r.area_id : null);
    r = up ? await getEntry(up) : null;
  }
  return false;
}

async function rename(row) {
  const title = await askText({ title: `Rename ${row.kind === 'project' ? kindName(row).toLowerCase() : row.kind === 'area' ? 'area' : row.kind}`, value: row.title || '' });
  if (!title) return;
  const fresh = await getEntry(row.id);
  await putEntries([{ ...fresh, title, updated_at: Date.now() }]);
  await refreshViews();
}

// Put something in the Trash. Anything holding writing asks first; everything
// can be brought back (Undo right away, or from the Trash in the Library).
async function toTrash(row) {
  const c = await contents(row);
  const held = [
    c.books && plural(c.books, 'book'),
    c.areas && plural(c.areas, 'smaller area'),
    c.chapters && row.kind !== 'chapter' && plural(c.chapters, 'chapter'),
    c.words && plural(c.words, 'word'),
    c.pages && plural(c.pages, 'page'),
    !c.words && c.written && plural(c.written, 'written line')
  ].filter(Boolean);
  const name = nameOf(row);
  if (c.words || c.books || c.areas || c.written > 3) {
    const ok = await ask({
      title: `Move “${name}” to the Trash?`,
      body: `It holds ${held.join(', ')}. Nothing is deleted: you can bring it all back from the Trash at the bottom of the Library.`,
      ok: 'Move to Trash', danger: true
    });
    if (!ok) return;
  }
  // Step out of it first and finish saving, so nothing still open writes over it.
  const here = view() === 'write' ? state.chapterId : view() === 'project' ? state.bookId : inNotebook() ? notebook.page?.id : null;
  const leaving = !!here && (await isWithin(here, row));
  let away = null;
  if (leaving) {
    if (view() === 'write') {
      await leaveChapter();
      away = state.project && !(await isWithin(state.project.id, row)) ? { view: 'project', id: state.project.id } : { view: 'library' };
    } else if (view() === 'project') away = { view: 'library' };
    else {
      await notebook.close();
      const book = await bookOf(notebook.page);
      away = book && !(await isWithin(book.id, row)) ? { view: 'project', id: book.id } : { view: 'notebook', pageId: dayId(isoToday()) };
    }
  } else if (state.chapterId && (await isWithin(state.chapterId, row))) await leaveChapter();
  await trash(row);
  if (away) await go(away);
  await refreshViews();
  toast(`“${name}” is in the Trash`, { label: 'Undo', run: async () => { await restore(row.id); await refreshViews(); toast(`“${name}” is back`); } });
}

async function setKind(book, type) {
  const b = await getEntry(book.id);
  if (bookType(b) === type) return;
  const s = await stats(b);
  if (hasManuscript(b) && type === 'notes' && s.words) {
    const ok = await ask({
      title: `Make “${nameOf(b)}” a notes collection?`,
      body: `Its manuscript (${plural(s.words, 'word')}) stays exactly as it is and is still listed on the book’s page. Change it back any time.`,
      ok: 'Change it'
    });
    if (!ok) return;
  }
  const next = await changeType(b, type);
  if (state.project?.id === b.id) {
    state.project = next;
    if (view() === 'write') { root.classList.toggle('script', type === 'screenplay'); placeScriptBar(); refreshWords(); }
  }
  await refreshViews();
  toast(`“${nameOf(b)}” is now a ${kindName(next).toLowerCase()}`, { label: 'Undo', run: async () => { await changeType(await getEntry(b.id), bookType(b)); if (state.project?.id === b.id) { state.project = await getEntry(b.id); if (view() === 'write') root.classList.toggle('script', bookType(b) === 'screenplay'); } await refreshViews(); } });
}

async function moveBookToArea(book, areaId) {
  const b = await getEntry(book.id);
  await putEntries([{ ...b, area_id: areaId, updated_at: Date.now() }]);
  await refreshViews();
}

async function movePage(page, parentId) {
  const p = await getEntry(page.id);
  if ((p.parent_id || null) === (parentId || null)) return;
  const sort = parentId ? (await pagesIn(parentId)).length + 1 : 0;
  await putEntries([{ ...p, parent_id: parentId || null, sort, updated_at: Date.now() }]);
  await refreshViews();
  const to = parentId ? nameOf(await getEntry(parentId)) : 'Loose pages';
  toast(`Moved to ${to}`, { label: 'Undo', run: async () => { await putEntries([{ ...(await getEntry(p.id)), parent_id: p.parent_id, sort: p.sort, updated_at: Date.now() }]); await refreshViews(); } });
}

// Renumber a list in order, writing only what changed.
async function reorder(list, extra = {}) {
  const now = Date.now();
  const rows = list.map((r, i) => ({ r, sort: i + 1 })).filter(({ r, sort }) => r.sort !== sort || Object.entries(extra[r.id] || {}).some(([k, v]) => r[k] !== v))
    .map(({ r, sort }) => { const { chapters: _c, ...row } = r; return { ...row, ...(extra[r.id] || {}), sort, updated_at: now }; });
  await putEntries(rows);
}

// A chapter one step up or down; past the end of its act it moves into the next one.
async function moveChapter(ch, dir) {
  const book = await bookOf(ch);
  const acts = await outline(book.id);
  const ai = acts.findIndex((a) => a.chapters.some((c) => c.id === ch.id));
  const list = acts[ai].chapters;
  const i = list.findIndex((c) => c.id === ch.id);
  const j = i + dir;
  if (j >= 0 && j < list.length) {
    [list[i], list[j]] = [list[j], list[i]];
    await reorder(list);
  } else {
    const to = acts[ai + dir];
    if (!to) return;
    list.splice(i, 1);
    if (dir < 0) to.chapters.push(ch); else to.chapters.unshift(ch);
    await reorder(list);
    await reorder(to.chapters, { [ch.id]: { parent_id: to.id } });
  }
  await refreshViews();
}

async function moveChapterToAct(ch, act) {
  const fresh = await getEntry(act.id);
  const there = await children(fresh.id);
  await putEntries([{ ...(await getEntry(ch.id)), parent_id: act.id, sort: (there.at(-1)?.sort || 0) + 1, updated_at: Date.now() }]);
  await refreshViews();
}

async function moveAct(act, dir) {
  const book = await bookOf(act);
  const acts = await outline(book.id);
  const i = acts.findIndex((a) => a.id === act.id);
  const j = i + dir;
  if (j < 0 || j >= acts.length) return;
  [acts[i], acts[j]] = [acts[j], acts[i]];
  await reorder(acts);
  await refreshViews();
}

async function moveArea(area, parentId) {
  await putEntries([{ ...(await getEntry(area.id)), parent_id: parentId, updated_at: Date.now() }]);
  await refreshViews();
}

// The menus. Each is built when opened, so it always reflects what's there now.
async function bookMenu(book) {
  const b = await getEntry(book.id);
  const all = await areas();
  return [
    { label: hasManuscript(b) ? 'Open the manuscript' : 'Open', run: () => (hasManuscript(b) ? openBook(b.id) : go({ view: 'project', id: b.id })) },
    ...(view() !== 'project' || state.bookId !== b.id ? [{ label: 'Book’s page', run: () => go({ view: 'project', id: b.id }) }] : []),
    { label: 'Rename…', run: () => rename(b) },
    { label: 'Kind', sub: KINDS.map(([id, label]) => ({ label, current: bookType(b) === id, run: () => setKind(b, id) })) },
    { label: 'Move to area', sub: (await areaOptions(all)).map(([id, label]) => ({ label: label.trim(), current: b.area_id === id, run: () => moveBookToArea(b, id) })) },
    { label: 'New page in it', run: async () => { await go({ view: 'notebook' }); await notebook.newPage(b.id); } },
    ...(view() === 'library' ? [
      { label: 'Move earlier in my order', run: () => nudgeBook(b, -1) },
      { label: 'Move later in my order', run: () => nudgeBook(b, 1) }
    ] : []),
    'sep',
    { label: 'Move to Trash…', danger: true, run: () => toTrash(b) }
  ];
}

async function pageMenu(page) {
  const p = await getEntry(page.id);
  const all = (await books()).sort((a, b) => a.title.localeCompare(b.title));
  return [
    { label: 'Open', run: () => go({ view: 'notebook', pageId: p.id }) },
    { label: 'Rename…', run: () => rename(p) },
    { label: 'Move to', sub: [{ label: 'Loose pages (no book)', current: !p.parent_id, run: () => movePage(p, null) }, ...all.map((b) => ({ label: b.title || 'Untitled', current: p.parent_id === b.id, run: () => movePage(p, b.id) }))] },
    'sep',
    { label: 'Move to Trash', danger: true, run: () => toTrash(p) }
  ];
}

async function chapterMenu(chapter) {
  const ch = await getEntry(chapter.id);
  const book = await bookOf(ch);
  const acts = book ? await outline(book.id) : [];
  const level = book?.fields?.levels?.[0] || 'Act';
  return [
    { label: 'Open', run: () => go({ view: 'write', chapterId: ch.id }) },
    { label: 'Rename…', run: () => rename(ch) },
    { label: 'Move up', run: () => moveChapter(ch, -1) },
    { label: 'Move down', run: () => moveChapter(ch, 1) },
    ...(acts.length > 1 ? [{ label: `Move to ${level.toLowerCase()}`, sub: acts.map((a) => ({ label: a.title, current: a.id === ch.parent_id, run: () => moveChapterToAct(ch, a) })) }] : []),
    'sep',
    { label: 'Move to Trash…', danger: true, run: () => toTrash(ch) }
  ];
}

async function actMenu(act) {
  const a = await getEntry(act.id);
  const book = await bookOf(a);
  const chLevel = book?.fields?.levels?.[1] || 'Chapter';
  return [
    { label: 'Rename…', run: () => rename(a) },
    { label: `New ${chLevel.toLowerCase()} in it`, run: async () => {
      const there = await children(a.id);
      const count = (await outline(book.id)).reduce((n, x) => n + x.chapters.length, 0);
      const ch = entry('chapter', { parent_id: a.id, title: `${chLevel} ${count + 1}`, sort: (there.at(-1)?.sort || 0) + 1 });
      await putEntries([ch]);
      await go({ view: 'write', chapterId: ch.id });
    } },
    { label: 'Move up', run: () => moveAct(a, -1) },
    { label: 'Move down', run: () => moveAct(a, 1) },
    'sep',
    { label: 'Move to Trash…', danger: true, run: () => toTrash(a) }
  ];
}

async function areaMenu(area) {
  const a = await getEntry(area.id);
  const all = await areas();
  const mine = subtree(a.id, all);
  return [
    { label: 'Open', run: () => go({ view: 'library', area: a.id }) },
    { label: 'Rename…', run: () => rename(a) },
    { label: 'New area inside', run: async () => { const t = await askText({ title: `New area inside ${a.title}`, ok: 'Add' }); if (t) { const n = await newArea(t, a.id); await go({ view: 'library', area: n.id }); } } },
    { label: 'Move inside', sub: [{ label: 'Top level', current: !a.parent_id, run: () => moveArea(a, null) }, ...(await areaOptions(all)).filter(([id]) => !mine.has(id)).map(([id, label]) => ({ label: label.trim(), current: a.parent_id === id, run: () => moveArea(a, id) }))] },
    'sep',
    { label: 'Move to Trash…', danger: true, run: () => toTrash(a) }
  ];
}

// The Trash, at the bottom of the Library.
async function renderTrash() {
  const rows = await trashed();
  const box = $('#lib-trash-box');
  box.hidden = !rows.length;
  $('#lib-trash-count').textContent = rows.length ? `(${rows.length})` : '';
  const what = (r) => (r.kind === 'project' ? kindName(r) : { area: 'Area', act: 'Act', chapter: 'Chapter', page: 'Page' }[r.kind] || 'Item');
  $('#lib-trash').replaceChildren(...rows.map((r) => {
    const li = make('li');
    const back = make('button', 'ghost-btn', 'Restore');
    back.addEventListener('click', async () => { await restore(r.id); await refreshViews(); toast(`“${nameOf(r)}” is back`); });
    const forever = make('button', 'ghost-btn danger', 'Delete forever');
    forever.addEventListener('click', async () => {
      const c = await contents(r);
      const ok = await ask({
        title: `Delete “${nameOf(r)}” forever?`,
        body: `This ${what(r).toLowerCase()}${c.words ? ` and its ${plural(c.words, 'word')}` : ''} will be gone from every device and can’t be brought back.`,
        ok: 'Delete forever', danger: true
      });
      if (!ok) return;
      await deleteForever(r.id);
      await refreshViews();
    });
    li.append(make('span', 'loose-title', nameOf(r)), make('span', 'when', `${what(r)} · trashed ${ago(r.fields.trashed)}`), back, forever);
    return li;
  }));
}

// ---------- library view ----------

// How books are ordered in the Library, per device.
const libSort = () => { try { return localStorage.getItem('libSort') || 'recent'; } catch { return 'recent'; } };
// Your own order: a number on each book (synced, so it's the same on every
// device). Books never placed yet follow, most recently edited first.
const ORDER_KEY = (b) => b.fields?.order ?? Infinity;
const byMyOrder = (a, b) => ORDER_KEY(a) - ORDER_KEY(b) || b.updated_at - a.updated_at;

// Put a book just before (or after) another one in your order.
async function placeBook(bookId, targetId, after = false) {
  if (bookId === targetId) return;
  const list = (await books()).sort(byMyOrder);
  const moving = list.find((b) => b.id === bookId);
  const rest = list.filter((b) => b.id !== bookId);
  const at = rest.findIndex((b) => b.id === targetId);
  if (!moving || at < 0) return;
  rest.splice(after ? at + 1 : at, 0, moving);
  const now = Date.now();
  await putEntries(rest.map((b, i) => ({ b, i })).filter(({ b, i }) => b.fields?.order !== i + 1)
    .map(({ b, i }) => ({ ...b, fields: { ...b.fields, order: i + 1 }, updated_at: now })));
  if (libSort() !== 'custom') { try { localStorage.setItem('libSort', 'custom'); } catch { /* full */ } }
  await refreshViews();
}

// One step earlier or later among the books shown right now.
async function nudgeBook(book, dir) {
  const shown = [...document.querySelectorAll('#lib-books .card-wrap[data-id]')].map((w) => w.dataset.id);
  const list = shown.length && shown.includes(book.id) && libSort() === 'custom' ? shown : (await books()).sort(byMyOrder).map((b) => b.id);
  const i = list.indexOf(book.id);
  const target = list[i + dir];
  if (target) await placeBook(book.id, target, dir > 0);
}

async function renderLibrary() {
  const [allAreas, allBooks, loose] = await Promise.all([areas(), books(), loosePages()]);
  if (state.libArea && !allAreas.some((a) => a.id === state.libArea)) state.libArea = null;
  const sel = state.libArea;
  const path = sel ? await areaPath(sel, allAreas) : [];

  // Area chips: the top level, then each level down to the one picked.
  const chips = $('#lib-areas');
  chips.replaceChildren();
  const chip = (label, on, run) => { const b = make('button', 'chip' + (on ? ' on' : ''), label); b.addEventListener('click', run); return b; };
  const row = (parentId) => {
    const wrap = make('div', 'chip-row');
    const list = allAreas.filter((a) => (a.parent_id || null) === parentId);
    if (!parentId) wrap.append(chip('All', !sel, () => go({ view: 'library', area: null })));
    for (const a of list) {
      const c = chip(a.title, path.some((p) => p.id === a.id), () => { if (c.contentEditable !== 'true') go({ view: 'library', area: a.id }); });
      renameable(c, a, () => { renderRail(); });
      onContextMenu(c, () => areaMenu(a));
      wrap.append(c);
    }
    wrap.append(addAreaChip(parentId));
    return wrap;
  };
  chips.append(row(null));
  for (const a of path) chips.append(row(a.id));
  const libPath = $('#lib-path');
  libPath.replaceChildren();
  if (sel) {
    const here = allAreas.find((a) => a.id === sel);
    libPath.append(make('span', '', `${here.title}: `), menuButton(() => areaMenu(here), `More for ${here.title}`), make('span', '', ' rename, move or remove this area. + adds an area inside the one you picked.'));
  }

  // Books in the picked area and everything nested under it.
  const ids = sel ? subtree(sel, allAreas) : null;
  const sort = libSort();
  const shown = allBooks.filter((b) => !ids || ids.has(b.area_id))
    .sort(sort === 'custom' ? byMyOrder : sort === 'title' ? (a, b) => (a.title || '').localeCompare(b.title || '', undefined, { numeric: true }) : sort === 'made' ? (a, b) => b.created_at - a.created_at : (a, b) => b.updated_at - a.updated_at);
  const sortSel = $('#lib-sort');
  sortSel.value = sort;
  sortSel.onchange = () => { try { localStorage.setItem('libSort', sortSel.value); } catch { /* full */ } renderLibrary(); };
  const cards = [];
  for (const b of shown) {
    const area = allAreas.find((a) => a.id === b.area_id);
    const s = await stats(b);
    const card = make('button', 'card');
    const kind = make('span', 'card-kind');
    kind.append(dot(areaColor(area)), document.createTextNode(`${area?.title || 'No area'} · ${{ novel: 'novel', screenplay: 'screenplay', notes: 'notes' }[bookType(b)] || 'novel'}`));
    const detail = bookType(b) === 'screenplay'
      ? `${s.words.toLocaleString()} words`
      : bookType(b) === 'novel'
      ? `${s.chapters.length} chapter${s.chapters.length === 1 ? '' : 's'} · ${s.words.toLocaleString()} words`
      : `${s.pages} page${s.pages === 1 ? '' : 's'}`;
    card.append(kind, make('span', 'card-title', b.title || 'Untitled'), make('span', 'card-detail', detail), make('span', 'card-when', `Edited ${ago(b.updated_at)}`));
    card.addEventListener('click', () => go({ view: 'project', id: b.id }));
    onContextMenu(card, () => bookMenu(b));
    const wrap = make('div', 'card-wrap');
    wrap.dataset.id = b.id;
    wrap.append(card, menuButton(() => bookMenu(b), `More for ${b.title || 'this book'}`));
    // In your own order, drag a card onto another to put it there.
    if (sort === 'custom') {
      card.draggable = true;
      card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-book', b.id); e.dataTransfer.effectAllowed = 'move'; wrap.classList.add('dragging'); });
      card.addEventListener('dragend', () => wrap.classList.remove('dragging'));
      wrap.addEventListener('dragover', (e) => {
        if (!e.dataTransfer.types.includes('text/x-book')) return;
        e.preventDefault();
        const r = wrap.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2;
        wrap.classList.toggle('drop-before', !after);
        wrap.classList.toggle('drop-after', after);
      });
      wrap.addEventListener('dragleave', () => wrap.classList.remove('drop-before', 'drop-after'));
      wrap.addEventListener('drop', (e) => {
        e.preventDefault();
        const after = wrap.classList.contains('drop-after');
        wrap.classList.remove('drop-before', 'drop-after');
        const id = e.dataTransfer.getData('text/x-book');
        if (id) placeBook(id, b.id, after);
      });
    }
    cards.push(wrap);
  }
  const add = make('button', 'card card-new');
  add.append(make('span', 'plus', '+'), make('span', '', 'New novel, screenplay or notes collection'));
  add.addEventListener('click', () => showNewBook('novel'));
  cards.push(add);
  $('#lib-books').replaceChildren(...cards);

  // Area choices for the new-book form.
  const opts = await areaOptions(allAreas);
  $('#lib-new-area').replaceChildren(...opts.map(([id, label]) => { const o = make('option', '', label); o.value = id; return o; }));
  $('#lib-new-area').value = sel || allAreas[0]?.id || '';

  // Loose pages, each with somewhere to move it.
  const bookOpts = allBooks.slice().sort((a, b) => a.title.localeCompare(b.title));
  $('#lib-loose').replaceChildren(...loose.map((p) => {
    const li = make('li');
    const open = make('button', 'loose-title', p.title || 'Untitled page');
    open.addEventListener('click', () => go({ view: 'notebook', pageId: p.id }));
    const move = make('select', 'move');
    move.setAttribute('aria-label', `Move ${p.title || 'page'} to a book`);
    move.append(Object.assign(make('option', '', 'Move to…'), { value: '' }), ...bookOpts.map((b) => Object.assign(make('option', '', b.title), { value: b.id })));
    move.addEventListener('change', async () => {
      if (!move.value) return;
      await putEntries([{ ...p, parent_id: move.value, updated_at: Date.now() }]);
      renderLibrary();
      renderRail();
    });
    onContextMenu(open, () => pageMenu(p));
    li.append(open, make('span', 'when', ago(p.updated_at)), move, menuButton(() => pageMenu(p), `More for ${p.title || 'this page'}`));
    return li;
  }));
  $('#lib-loose-box').hidden = !loose.length;
  await renderTrash();
}

function addAreaChip(parentId) {
  const b = make('button', 'chip add', '+');
  b.setAttribute('aria-label', parentId ? 'Add an area inside this one' : 'Add an area');
  b.addEventListener('click', () => {
    const input = make('input', 'chip-input');
    input.placeholder = 'New area';
    b.replaceWith(input);
    input.focus();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const title = input.value.trim();
      if (save && title) {
        const area = await newArea(title, parentId);
        await go({ view: 'library', area: area.id });
      } else renderLibrary();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
  });
  return b;
}

async function areaOptions(allAreas) {
  const out = [];
  const walk = (parentId, depth) => {
    for (const a of allAreas.filter((x) => (x.parent_id || null) === parentId)) {
      out.push([a.id, `${' '.repeat(depth)}${a.title}`]);
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

async function showNewBook(type) {
  if (view() !== 'library') await go({ view: 'library' });
  const form = $('#lib-new');
  form.hidden = false;
  $('#lib-new-type').value = type;
  $('#lib-new-title').value = '';
  $('#lib-new-title').focus();
}

$('#lib-new').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#lib-new-title').value.trim();
  if (!title) return;
  const type = $('#lib-new-type').value;
  const book = await newBook(type, title, $('#lib-new-area').value || null);
  $('#lib-new').hidden = true;
  // A new book opens on its Idea page, the place to think it through.
  const idea = (await pagesIn(book.id))[0];
  if (idea) await go({ view: 'notebook', pageId: idea.id });
  else await go({ view: 'project', id: book.id });
});
$('#lib-new-cancel').addEventListener('click', () => { $('#lib-new').hidden = true; });

// ---------- a book's home ----------

async function renderProject() {
  const b = await getEntry(state.bookId);
  if (gone(b)) return go({ view: 'library' });
  const allAreas = await areas();
  const s = await stats(b);
  // A notes collection that was once a novel still shows its manuscript.
  const novel = hasManuscript(b) || s.words > 0;
  const title = $('#ph-title');
  title.textContent = b.title;
  title.contentEditable = 'true';
  title.onblur = async () => {
    const t = title.textContent.trim();
    if (!t) title.textContent = b.title;
    if (t && t !== b.title) { await putEntries([{ ...b, title: t, updated_at: Date.now() }]); if (state.project?.id === b.id) state.project.title = t; renderRail(); renderCrumb(); }
  };
  title.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } if (e.key === 'Escape') { e.preventDefault(); title.textContent = b.title; title.blur(); } };
  $('#ph-more').replaceChildren(menuButton(() => bookMenu(b), 'More for this book'));
  const kindSel = $('#ph-kind');
  kindSel.replaceChildren(...KINDS.map(([id, label]) => Object.assign(make('option', '', label), { value: id })));
  kindSel.value = bookType(b);
  kindSel.onchange = async () => { const to = kindSel.value; kindSel.value = bookType(b); await setKind(b, to); };
  $('#ph-stats').textContent = bookType(b) === 'screenplay'
    ? `${s.words.toLocaleString()} words`
    : novel
    ? `${s.words.toLocaleString()} words · ${s.chapters.length} chapter${s.chapters.length === 1 ? '' : 's'}`
    : `${s.pages} page${s.pages === 1 ? '' : 's'}${s.words ? ` · ${s.words.toLocaleString()} words in its manuscript` : ''}`;
  const areaSel = $('#ph-area');
  areaSel.replaceChildren(...(await areaOptions(allAreas)).map(([id, label]) => Object.assign(make('option', '', label), { value: id })));
  areaSel.value = b.area_id || '';
  areaSel.onchange = () => moveBookToArea(b, areaSel.value);

  const cont = $('#ph-continue');
  cont.hidden = !novel || !s.chapters.length;
  if (novel && s.chapters.length) {
    const last = await getMeta(`lastChapter:${b.id}`);
    const ch = s.chapters.find((c) => c.id === last) || s.chapters[0];
    cont.textContent = `Continue writing · ${ch.title}`;
    cont.onclick = () => go({ view: 'write', chapterId: ch.id });
  }

  $('#ph-ms-label').hidden = !novel;
  const ms = $('#ph-manuscript');
  ms.replaceChildren();
  if (novel) {
    for (const act of s.acts) {
      const box = make('div', 'ms-act');
      const head = make('div', 'ms-act-title');
      head.append(make('span', '', act.title), menuButton(() => actMenu(act), `More for ${act.title}`));
      onContextMenu(head, () => actMenu(act));
      box.append(head);
      for (const ch of act.chapters) {
        const row = make('div', 'ms-row');
        const c = make('button', 'ms-chapter');
        c.append(make('span', '', ch.title), make('span', 'when', `${(ch.fields?.words || 0).toLocaleString()} words`));
        c.addEventListener('click', () => go({ view: 'write', chapterId: ch.id }));
        onContextMenu(c, () => chapterMenu(ch));
        row.append(c, menuButton(() => chapterMenu(ch), `More for ${ch.title}`));
        box.append(row);
      }
      ms.append(box);
    }
  }

  const pages = await pagesIn(b.id);
  $('#ph-pages').replaceChildren(...pages.map((p) => {
    const li = make('li');
    const open = make('button', 'loose-title', p.title || 'Untitled page');
    open.addEventListener('click', () => go({ view: 'notebook', pageId: p.id }));
    onContextMenu(open, () => pageMenu(p));
    li.append(open, make('span', 'when', ago(p.updated_at)), menuButton(() => pageMenu(p), `More for ${p.title || 'this page'}`));
    return li;
  }));

  const mentions = await dailyMentions(b);
  $('#ph-daily').replaceChildren(...mentions.map(({ row, day }) => {
    const li = make('li');
    const btn = make('button');
    btn.append(make('span', 'from', titleOf(day)), make('span', 'line', row.text));
    btn.addEventListener('click', () => go({ view: 'notebook', pageId: day.id, line: row.id }));
    li.append(btn);
    return li;
  }));
  $('#ph-daily-empty').hidden = mentions.length > 0;
}

// ---------- panels revealed by edges ----------

// The browser can fire a stray hover when the layout shifts (like turning focus on), so edges ignore it then.
let edgesQuietUntil = 0;
// On a touch screen an edge opens on a tap, never on a hover: phones send
// stray hover events when the page shifts (the keyboard opening, say).
const hovers = () => Date.now() > edgesQuietUntil && !matchMedia('(hover: none)').matches;
$('.edge-left').addEventListener('mouseenter', () => { if (hovers()) body.classList.add('show-outline'); });
$('.edge-left').addEventListener('click', () => body.classList.add('show-outline'));
$('.outline').addEventListener('mouseleave', () => body.classList.remove('show-outline'));
$('.edge-top').addEventListener('mouseenter', () => { if (hovers()) body.classList.add('show-top'); });
$('.edge-top').addEventListener('click', () => body.classList.add('show-top'));
$('.topbar').addEventListener('mouseleave', () => body.classList.remove('show-top'));
// On a touch screen there's no mouse to leave the bar, so a tap anywhere else tucks it away.
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' && !e.target.closest('.topbar, .edge-top')) body.classList.remove('show-top');
  if (e.pointerType !== 'mouse' && !e.target.closest('.outline, .edge-left')) body.classList.remove('show-outline');
});

// ---------- history ----------

let historyPreview = null;
let historyPick = null;

async function openHistory() {
  const panel = $('.history');
  if (!panel.hidden) { panel.hidden = true; editor.commands.focus(); return; }
  await store.close(editor.state.doc);
  panel.hidden = false;
  const list = $('#history-list');
  list.replaceChildren();
  const rows = await snapshots(state.chapterId);
  if (!rows.length) {
    $('#history-meta').textContent = 'No earlier versions yet. A version is kept every time you pause typing.';
  }
  for (const snap of rows) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const when = new Date(snap.at);
    b.innerHTML = `<div class="when"></div><div class="meta"></div>`;
    b.querySelector('.when').textContent = when.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    b.querySelector('.meta').textContent = `${snap.words.toLocaleString()} words`;
    b.addEventListener('click', () => showSnapshot(snap, b));
    li.append(b);
    list.append(li);
  }
}

function showSnapshot(snap, button) {
  document.querySelectorAll('#history-list button').forEach((x) => x.classList.toggle('current', x === button));
  historyPick = snap;
  if (!historyPreview) historyPreview = new Editor({ element: $('#history-doc'), extensions, editable: false });
  historyPreview.commands.setContent(snap.doc, { emitUpdate: false });
  $('#history-meta').textContent = new Date(snap.at).toLocaleString();
  $('.history-actions').hidden = false;
}

$('#history-restore').addEventListener('click', () => {
  if (!historyPick) return;
  editor.commands.setContent(historyPick.doc, { emitUpdate: true });
  $('.history').hidden = true;
  editor.commands.focus('end');
});
$('#history-copy').addEventListener('click', () => {
  if (historyPreview) navigator.clipboard.writeText(historyPreview.getText({ blockSeparator: '\n\n' }));
});

// ---------- page width and text size (per device) ----------

const DEFAULT_WIDTH = 660;
const defaultSize = () => (matchMedia('(max-width: 700px)').matches ? 18 : 21);
const currentWidth = () => Number(localStorage.getItem('pageWidth')) || DEFAULT_WIDTH;
const currentSize = () => Number(localStorage.getItem('textSize')) || defaultSize();

function setPage(width, size) {
  width = Math.max(420, Math.min(1100, width));
  size = Math.max(14, Math.min(30, size));
  root.style.setProperty('--page-width', `${width}px`);
  root.style.setProperty('--text-size', `${size}px`);
  localStorage.setItem('pageWidth', String(width));
  localStorage.setItem('textSize', String(size));
  $('#page-width').value = width;
  $('#text-size').value = size;
  $('#width-value').textContent = `${width}px`;
  $('#size-value').textContent = `${size}px`;
  notes.layout();
}

function togglePageSettings() {
  const panel = $('.page-settings');
  if (!panel.hidden) { panel.hidden = true; currentEditor().commands.focus(); return; }
  setPage(currentWidth(), currentSize());
  panel.hidden = false;
  $('#page-width').focus();
}

// Display switches, per device: anything beyond the text can be turned off.
const hidden = () => { try { return new Set(JSON.parse(localStorage.getItem('hide') || '[]')); } catch { return new Set(); } };
function setShown(name, on) {
  const h = hidden();
  if (on) h.delete(name); else h.add(name);
  localStorage.setItem('hide', JSON.stringify([...h]));
  root.classList.toggle(`hide-${name}`, !on);
  syncSwitches();
}
// Reading a script through: only the script pages, no sections, notes or tools.
function toggleReading() {
  const on = !root.classList.contains('reading');
  if (on !== root.classList.contains('focus')) toggleFocus();
  root.classList.toggle('reading', on);
}

function toggleFocus() {
  const on = !root.classList.contains('focus');
  root.classList.toggle('focus', on);
  if (!on) root.classList.remove('reading');
  localStorage.setItem('focus', on ? '1' : '0');
  edgesQuietUntil = Date.now() + 600;
  body.classList.remove('show-outline', 'show-top');
  syncSwitches();
}
function syncSwitches() {
  const h = hidden();
  document.querySelectorAll('[data-show]').forEach((c) => { c.checked = !h.has(c.dataset.show); });
  $('#focus-mode').checked = root.classList.contains('focus');
  $('#focus-toggle').setAttribute('aria-pressed', String(root.classList.contains('focus')));
}

// Next or previous chapter in the book, or day on a daily page.
async function step(dir) {
  if (inNotebook()) return notebook.step(dir);
  if (!writing() || !state.project) return;
  const chapters = (await outline(state.project.id)).flatMap((a) => a.chapters);
  const i = chapters.findIndex((c) => c.id === state.chapterId);
  const next = chapters[i + dir];
  if (next) go({ view: 'write', chapterId: next.id });
}

const progressPanel = new StatsPanel($('.stats'), { onClose: () => currentEditor().commands.focus() });
document.addEventListener('visibilitychange', () => { if (document.hidden) recordProgress().catch(() => {}); });
setTimeout(() => recordProgress().catch((e) => console.error(e)), 4000);
const toggleShortcuts = () => { const s = $('.shortcuts'); s.hidden = !s.hidden; if (s.hidden) currentEditor().commands.focus(); };
document.querySelectorAll('[data-show]').forEach((c) => c.addEventListener('change', () => setShown(c.dataset.show, c.checked)));
$('#focus-mode').addEventListener('change', toggleFocus);
syncSwitches();

$('#page-width').addEventListener('input', (e) => setPage(Number(e.target.value), currentSize()));
$('#text-size').addEventListener('input', (e) => setPage(currentWidth(), Number(e.target.value)));
$('#page-reset').addEventListener('click', () => setPage(DEFAULT_WIDTH, defaultSize()));
$('#page-done').addEventListener('click', togglePageSettings);

// ---------- command menu (⌘K) and go-to (⌘O) ----------

const mod = '⌘'; // shown as Ctrl+ off a Mac, see keys.js
showKeysForThisComputer();

function toggleTheme() {
  const dark = getComputedStyle(document.documentElement).colorScheme === 'dark';
  const next = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
}

function cycleFont() {
  const fonts = ['newsreader', 'literata', 'georgia'];
  const cur = document.documentElement.dataset.font || 'newsreader';
  const next = fonts[(fonts.indexOf(cur) + 1) % fonts.length];
  document.documentElement.dataset.font = next;
  localStorage.setItem('font', next);
}

async function exportChapter() {
  await store.close(editor.state.doc);
  const ch = await getEntry(state.chapterId);
  download(`${ch.title}.md`, chapterMarkdown(ch, await children(ch.id)));
}

async function exportVault() {
  await store.close(editor.state.doc);
  await notebook.close();
  download(`Inkwell vault ${isoToday()}.zip`, await vaultZip());
}

async function exportFountain() {
  await store.close(editor.state.doc);
  const rows = [];
  for (const act of state.acts) for (const ch of act.chapters) rows.push(...(await children(ch.id)));
  download(`${state.project.title}.fountain`, toFountain(state.project.title, rows));
}

// Pick a .fountain file and make it a new screenplay in the Library.
function importFountain() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.fountain,.spmd,.txt,text/plain';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const { title, lines } = fromFountain(await file.text());
    const area = (await areas())[0];
    const book = await newBook('screenplay', title || file.name.replace(/\.[^.]+$/, ''), area?.id || null, lines);
    renderRail();
    openBook(book.id);
  });
  input.click();
}

async function exportBook() {
  await store.close(editor.state.doc);
  download(`${state.project.title}.md`, await bookMarkdown(state.project, state.acts));
}

const writing = () => view() === 'write';
const commands = [
  { group: 'go', label: 'Go to… a book, chapter or page', keys: `${mod}O`, run: () => openPalette('go') },
  { group: 'go', label: 'Search inside all your writing', keys: `${mod}⇧F`, run: () => openPalette('search') },
  { group: 'go', label: 'Library', keys: `${mod}⇧O`, run: () => go({ view: 'library', area: null }) },
  { group: 'go', label: 'Today’s page', keys: `${mod}J`, run: () => go({ view: 'notebook', pageId: dayId(isoToday()) }) },
  { group: 'go', label: 'Back to writing', keys: `${mod}J`, run: () => go({ view: 'write' }), when: () => !writing() },
  { group: 'go', label: 'Next chapter (or day)', keys: `${mod}⌥↓`, run: () => step(1), when: () => writing() || inNotebook() },
  { group: 'go', label: 'Previous chapter (or day)', keys: `${mod}⌥↑`, run: () => step(-1), when: () => writing() || inNotebook() },
  { group: 'new', label: 'New novel', keys: '', run: () => showNewBook('novel') },
  { group: 'new', label: 'New screenplay', keys: '', run: () => showNewBook('screenplay') },
  { group: 'new', label: 'New notes collection', keys: '', run: () => showNewBook('notes') },
  { group: 'new', label: 'Bring in a Fountain script (.fountain)', keys: '', run: importFountain },
  { group: 'new', label: 'New page', keys: '', run: newPageHere },
  { group: 'new', label: 'New area', keys: '', run: () => go({ view: 'library' }).then(() => [...document.querySelectorAll('#lib-areas .chip.add')].at(-1)?.click()) },
  { group: 'new', label: 'New chapter', keys: '', run: () => go({ view: 'write' }).then(newChapter), when: () => !!state.project },
  { group: 'new', label: 'New act', keys: '', run: () => go({ view: 'write' }).then(newAct), when: () => !!state.project },
  { group: 'write', label: 'Zoom into this line', keys: 'click its bullet', run: () => notebook.zoomTo(notebook.currentLine()), when: inNotebook },
  { group: 'write', label: 'Zoom out', keys: 'Esc', run: () => notebook.zoomTo(null), when: () => inNotebook() && !!notebook.zoom },
  { group: 'write', label: 'Fold or unfold this line', keys: `${mod}↑ ${mod}↓`, run: () => notebook.toggleFold(), when: inNotebook },
  ...ELEMENTS.map((x) => ({ group: 'write', label: `Script: ${x.label}`, keys: 'Tab', run: () => editor.chain().focus().updateAttributes('paragraph', { el: x.id }).run(), when: () => writing() && isScript() })),
  { group: 'write', label: 'Script: Section (your own heading)', keys: '# ', run: () => { const at = editor.state.selection.$from.before(1); editor.chain().insertContentAt(at, { type: 'sceneBreak' }).run(); requestAnimationFrame(() => editor.view.nodeDOM(at)?.querySelector('input')?.focus()); }, when: () => writing() && isScript() },
  { group: 'write', label: 'Link to a page…', keys: '[[', run: () => openPicker(currentEditor()), when: () => writing() || inNotebook() },
  { group: 'write', label: 'Add a note to this paragraph', keys: `${mod}⇧N`, run: () => notes.add(), when: writing },
  { group: 'write', label: 'Alternates for this word (or the selection)', keys: `${mod}⇧E`, run: () => alts.open({ scope: 'word', focusAdd: true }), when: writing },
  { group: 'write', label: 'Versions of this paragraph', keys: '', run: () => alts.open({ scope: 'para' }), when: writing },
  { group: 'write', label: 'New version of this paragraph to rewrite', keys: `${mod}⇧D`, run: () => newParagraphVersion(editor), when: writing },
  { group: 'write', label: 'Next alternate (word, or else paragraph)', keys: '⌥↓', run: () => flip(editor, 1), when: writing },
  { group: 'write', label: 'Previous alternate', keys: '⌥↑', run: () => flip(editor, -1), when: writing },
  { group: 'write', label: 'Scene break', keys: `${mod}⇧↵`, run: () => editor.chain().focus().insertSceneBreak().run(), when: writing },
  { group: 'write', label: 'History: earlier versions of this chapter', keys: `${mod}⇧H`, run: openHistory, when: writing },
  { group: 'write', label: 'Note categories: add, rename, recolour', keys: '', run: () => notes.editTypes() },
  { group: 'view', label: 'Sidebar (keep open)', keys: `${mod}1`, run: () => body.classList.toggle('pin-outline') },
  { group: 'view', label: 'Notes beside the text', keys: `${mod}2`, run: () => toggleNotes(), when: writing },
  { group: 'view', label: 'Read it through: just the script pages', keys: 'Esc to stop', run: toggleReading, when: () => writing() && isScript() },
  { group: 'view', label: 'Focus: just the text (on / off)', keys: `${mod}.`, run: toggleFocus },
  { group: 'view', label: 'Show or hide "Linked from"', keys: '', run: () => setShown('links', hidden().has('links')) },
  { group: 'view', label: 'Show or hide note dots', keys: '', run: () => setShown('dots', hidden().has('dots')) },
  { group: 'view', label: 'Show or hide alternate marks', keys: '', run: () => setShown('alts', hidden().has('alts')) },
  { group: 'view', label: 'Show or hide the paragraph handle', keys: '', run: () => setShown('handle', hidden().has('handle')) },
  { group: 'view', label: 'Show or hide bullets on notebook lines', keys: '', run: () => setShown('bullets', hidden().has('bullets')) },
  { group: 'view', label: 'Progress: words and pages over time (stats)', keys: `${mod}⇧P`, run: () => progressPanel.open() },
  { group: 'write', label: 'Move this line to another page or day…', keys: '', run: moveLinePicker, when: inNotebook },
  { group: 'write', label: 'Done: strike this line through', keys: `${mod}↵`, run: () => toggleDone(notebook.editor), when: inNotebook },
  { group: 'view', label: 'Keyboard shortcuts (all the keys)', keys: `${mod}/`, run: toggleShortcuts },
  { group: 'page', label: 'Page and text settings', keys: '', run: togglePageSettings },
  { group: 'page', label: 'Wider page', keys: 'Alt+]', run: () => setPage(currentWidth() + 40, currentSize()) },
  { group: 'page', label: 'Narrower page', keys: 'Alt+[', run: () => setPage(currentWidth() - 40, currentSize()) },
  { group: 'page', label: 'Larger text', keys: 'Alt+=', run: () => setPage(currentWidth(), currentSize() + 1) },
  { group: 'page', label: 'Smaller text', keys: 'Alt+−', run: () => setPage(currentWidth(), currentSize() - 1) },
  { group: 'page', label: 'Light / dark', keys: `${mod}⇧L`, run: toggleTheme },
  { group: 'page', label: 'Change the writing font', keys: '', run: cycleFont },
  { group: 'sync', label: 'Sync now', keys: '', run: () => sync.soon(0), when: () => !!sync.user },
  { group: 'sync', label: 'Sign in to sync between devices', keys: '', run: () => sync.signIn(), when: () => sync.available && !sync.user },
  { group: 'sync', label: 'Sign out of sync', keys: '', run: () => sync.signOut(), when: () => !!sync.user },
  { group: 'sync', label: 'Export this chapter as Markdown', keys: '', run: exportChapter, when: () => writing() && !isScript() },
  { group: 'sync', label: 'Export the whole book as Markdown', keys: '', run: exportBook, when: () => writing() && !!state.project && !isScript() },
  { group: 'sync', label: 'Export this script as Fountain', keys: '', run: exportFountain, when: () => writing() && isScript() },
  { group: 'sync', label: 'Back up everything (download all as files)', keys: '', run: exportVault },
  { group: 'tidy', label: 'This book: rename, move, change kind or trash…', keys: '', run: async () => popMenu(null, await bookMenu(await currentBook()), menuSpot()), when: () => !!currentBookId() },
  { group: 'tidy', label: 'Change what this book is (novel, screenplay, notes)…', keys: '', run: async () => { const b = await currentBook(); popMenu(null, KINDS.map(([id, label]) => ({ label, current: bookType(b) === id, run: () => setKind(b, id) })), menuSpot()); }, when: () => !!currentBookId() },
  { group: 'tidy', label: 'This chapter: rename, move or trash…', keys: '', run: async () => popMenu(null, await chapterMenu({ id: state.chapterId }), menuSpot()), when: () => writing() && !!state.chapterId },
  { group: 'tidy', label: 'This page: rename, move to a book or trash…', keys: '', run: async () => popMenu(null, await pageMenu(notebook.page), menuSpot()), when: () => inNotebook() && notebook.page?.kind === 'page' },
  { group: 'tidy', label: 'This area: rename, move or trash…', keys: '', run: async () => popMenu(null, await areaMenu({ id: state.libArea }), menuSpot()), when: () => view() === 'library' && !!state.libArea },
  { group: 'tidy', label: 'Trash: bring things back', keys: '', run: showTrash },
  { group: 'sync', label: 'Two versions to check', urgent: true, keys: '', run: () => conflicts.open(), when: () => !$('#versions').hidden }
];

// The command menu opens on these, so the phone doesn't need a long scroll; typing searches everything.
const GROUPS = [
  { id: 'go', label: 'Go', hint: 'Library, today, chapters, back' },
  { id: 'new', label: 'New', hint: 'Book, page, chapter, area' },
  { id: 'write', label: 'Write', hint: 'Links, notes, scene breaks, history' },
  { id: 'view', label: 'View', hint: 'Focus, sidebar, notes, what shows' },
  { id: 'page', label: 'Page and text', hint: 'Width, text size, font, light or dark' },
  { id: 'tidy', label: 'Organize', hint: 'Rename, move, change kind, Trash' },
  { id: 'sync', label: 'Sync and backup', hint: 'Sync, export, back up' }
];

// The book you're in, wherever you are in it.
function currentBookId() {
  if (view() === 'project') return state.bookId;
  if (writing()) return state.project?.id || null;
  if (inNotebook() && notebook.page?.kind === 'page') return notebook.page.parent_id || null;
  return null;
}
const currentBook = () => getEntry(currentBookId());
const menuSpot = () => ({ left: Math.max(8, window.innerWidth / 2 - 130), top: 110 });

async function showTrash() {
  await go({ view: 'library', area: null });
  const box = $('#lib-trash-box');
  if (box.hidden) toast('The Trash is empty');
  else { box.open = true; box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Everything you can go to: books, areas, chapters, pages and recent days.
// Move to…: send the line you're on (and what's under it) to another page or day.
function moveLinePicker() {
  const eid = notebook.currentLine();
  if (!eid || !inNotebook()) return;
  const send = (id, fallback) => async () => {
    if (await notebook.moveLineTo(eid, id, fallback)) statusEl.textContent = (`Moved to ${fallback ? titleOf(fallback) : titleOf(await getEntry(id))}`);
  };
  const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  openPalette('move', async () => {
    const out = [];
    for (const [label, iso] of [['Today', day(0)], ['Tomorrow', day(1)], ['Yesterday', day(-1)]]) {
      const id = dayId(iso);
      if (id !== notebook.page?.id) out.push({ label, keys: 'day', run: send(id, entry('day', { id, title: iso })) });
    }
    for (const pg of (await byKind('page')).filter((x) => !x.deleted && x.id !== notebook.page?.id).sort((a, c) => c.updated_at - a.updated_at)) out.push({ label: pg.title || 'Untitled page', keys: 'page', run: send(pg.id) });
    const days = (await byKind('day')).filter((d) => !d.deleted && d.id !== notebook.page?.id).sort((a, c) => (a.title < c.title ? 1 : -1)).slice(0, 30);
    for (const d of days) out.push({ label: titleOf(d), keys: 'day', run: send(d.id) });
    return out;
  });
}

async function places(only) {
  const [allAreas, allBooks] = await Promise.all([areas(), books()]);
  const out = [];
  for (const b of allBooks.sort((a, c) => c.updated_at - a.updated_at)) out.push({ label: b.title || 'Untitled', keys: 'book', run: () => go({ view: 'project', id: b.id }) });
  if (only === 'books') return out;
  for (const a of allAreas) out.push({ label: a.title, keys: 'area', run: () => go({ view: 'library', area: a.id }) });
  for (const b of allBooks.filter(hasManuscript)) {
    for (const act of await outline(b.id)) for (const ch of act.chapters) out.push({ label: `${ch.title} · ${b.title}`, keys: 'chapter', run: () => go({ view: 'write', chapterId: ch.id }) });
  }
  for (const p of (await byKind('page')).filter((x) => !x.deleted)) out.push({ label: p.title || 'Untitled page', keys: 'page', run: () => go({ view: 'notebook', pageId: p.id }) });
  const days = (await byKind('day')).filter((d) => !d.deleted).sort((a, c) => (a.title < c.title ? 1 : -1)).slice(0, 30);
  for (const d of days) out.push({ label: titleOf(d), keys: 'day', run: () => go({ view: 'notebook', pageId: d.id }) });
  return out;
}

let paletteIndex = 0;
let paletteItems = [];
let paletteMode = 'commands';
let paletteSource = commands;
let paletteReady = Promise.resolve();
let paletteGroup = null;
let searchIdx = null;
const KIND_LABEL = { para: 'text', heading: 'heading', line: 'line', note: 'note', scene: 'scene', project: 'book', chapter: 'chapter', page: 'page', area: 'area' };

// A search result: open it where it lives, with the caret on it.
async function openHit(row) {
  if (row.kind === 'note') { await openEntry(row.parent_id); if (!notes.visible) notes.setVisible(true); return; }
  if (row.kind === 'chapter') return go({ view: 'write', chapterId: row.id });
  return openEntry(row.id);
}

async function openPalette(mode = 'commands', only) {
  // Open and focus at once so nothing typed is lost; the list fills in after.
  paletteMode = mode;
  paletteGroup = null;
  paletteSource = mode === 'go' || mode === 'move' || mode === 'search' ? [] : commands;
  paletteReady = Promise.resolve();
  $('.palette').hidden = false;
  $('.palette-backdrop').hidden = false;
  const input = $('#palette-input');
  input.placeholder = mode === 'search' ? 'Search all your writing…' : mode === 'move' ? 'Move this line to…' : mode === 'go' ? (only === 'books' ? 'Go to a book…' : 'Go to a book, chapter, page or day…') : 'Type a command…';
  input.value = typeof only === 'string' && mode === 'search' ? only : '';
  input.focus();
  filterPalette();
  if (mode === 'search') {
    // Stores what's written now; each search after that is instant.
    searchIdx = null;
    paletteReady = (async () => { await store.close(editor.state.doc); await notebook.close(); return searchIndex(); })().then((idx) => {
      if (paletteMode !== 'search') return;
      searchIdx = idx;
      filterPalette();
    });
    await paletteReady;
  }
  if (mode === 'go' || mode === 'move') {
    paletteReady = (mode === 'move' ? only() : places(only)).then((list) => {
      if (paletteMode !== mode) return;
      paletteSource = list;
      filterPalette();
    });
    await paletteReady;
  }
}

function closePalette(refocus = true) {
  $('.palette').hidden = true;
  $('.palette-backdrop').hidden = true;
  if (refocus && (writing() || inNotebook())) currentEditor().commands.focus();
}

function openGroup(id) {
  paletteGroup = id;
  const input = $('#palette-input');
  input.placeholder = id ? `${GROUPS.find((g) => g.id === id).label}…` : 'Type a command…';
  input.value = '';
  input.focus();
  filterPalette();
}

function filterPalette() {
  const q = $('#palette-input').value.trim().toLowerCase();
  const usable = (c) => !c.when || c.when();
  if (paletteMode === 'commands' && !q && !paletteGroup) {
    // Anything waiting on you stays at the top; then the categories.
    paletteItems = [
      ...commands.filter((c) => c.urgent && usable(c)),
      ...GROUPS.map((g) => ({ label: g.label, hint: g.hint, keys: '›', stay: true, run: () => openGroup(g.id) })),
      { label: 'Keyboard shortcuts', hint: 'Every key, named for this computer', keys: `${mod}/`, run: toggleShortcuts }
    ];
  } else if (paletteMode === 'commands' && !q) {
    paletteItems = [
      { label: '‹ All commands', keys: '', stay: true, back: true, run: () => openGroup(null) },
      ...commands.filter((c) => c.group === paletteGroup && usable(c))
    ];
  } else if (paletteMode === 'search') {
    const raw = $('#palette-input').value;
    const hits = searchIdx ? searchIdx.find(raw) : [];
    paletteItems = hits.map((h) => ({ label: h.snippet, hint: h.where, keys: KIND_LABEL[h.row.kind] || '', run: () => openHit(h.row) }));
    if (!paletteItems.length) {
      const note = !searchIdx ? 'Looking…' : raw.trim().length < 2 ? 'Type a word or two from anything you’ve written' : 'Nothing found';
      paletteItems = [{ label: note, keys: '', stay: true, run: () => {} }];
    }
  } else {
    const inGroup = (c) => !paletteGroup || paletteMode !== 'commands' || c.group === paletteGroup;
    paletteItems = paletteSource.filter((c) => usable(c) && inGroup(c) && c.label.toLowerCase().includes(q)).slice(0, 60);
    // Not a title? Offer to look inside the writing too.
    if (paletteMode === 'go' && q.length > 1) {
      const text = $('#palette-input').value.trim();
      paletteItems.push({ label: `Search inside your writing for “${text}”`, keys: `${mod}⇧F`, stay: true, run: () => openPalette('search', text) });
    }
  }
  // In a category, start on its first command rather than the way back.
  paletteIndex = paletteItems[0]?.back && paletteItems.length > 1 ? 1 : 0;
  const list = $('#palette-list');
  list.replaceChildren();
  paletteItems.forEach((c, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === paletteIndex));
    li.innerHTML = '<span class="label"></span><span class="keys"></span>';
    li.firstChild.textContent = c.label;
    if (c.hint) { const h = document.createElement('span'); h.className = 'hint'; h.textContent = c.hint; li.firstChild.append(h); }
    if (c.back) li.classList.add('back');
    if (c.stay) li.classList.add('opens');
    // While searching, say which category a command without a shortcut lives in.
    li.lastChild.textContent = keyLabel(c.keys) || (q && c.group ? GROUPS.find((g) => g.id === c.group).label : '');
    li.addEventListener('click', () => runCommand(c));
    li.addEventListener('mousemove', () => selectPalette(i));
    list.append(li);
  });
}

function selectPalette(i) {
  paletteIndex = i;
  [...$('#palette-list').children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
  $('#palette-list').children[i]?.scrollIntoView({ block: 'nearest' });
}

function runCommand(c) {
  if (c.stay) return c.run();
  closePalette(paletteMode !== 'go');
  c.run();
}

$('#palette-input').addEventListener('input', filterPalette);
$('#palette-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); selectPalette(Math.min(paletteIndex + 1, paletteItems.length - 1)); }
  if (e.key === 'ArrowUp') { e.preventDefault(); selectPalette(Math.max(paletteIndex - 1, 0)); }
  if (e.key === 'Enter') {
    e.preventDefault();
    // Enter pressed before the list arrived still picks the best match.
    paletteReady.then(() => { if (paletteItems[paletteIndex]) runCommand(paletteItems[paletteIndex]); });
  }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (paletteGroup && !e.target.value) openGroup(null); else closePalette(); }
  if (e.key === 'Backspace' && paletteGroup && !e.target.value) { e.preventDefault(); openGroup(null); }
  if (e.key === 'ArrowRight' && !e.target.value && paletteItems[paletteIndex]?.stay && !paletteItems[paletteIndex].back) { e.preventDefault(); runCommand(paletteItems[paletteIndex]); }
  if (e.key === 'ArrowLeft' && !e.target.value && paletteGroup) { e.preventDefault(); openGroup(null); }
});
$('.palette-backdrop').addEventListener('click', () => closePalette());

function toggleNotes() {
  notes.setVisible(!notes.visible);
}
document.addEventListener('notes-visibility', () => { $('#notes-toggle').textContent = notes.visible ? 'Hide notes' : 'Notes'; });

const toggleWriteToday = () => go(inNotebook() ? { view: 'write' } : { view: 'notebook', pageId: dayId(isoToday()) });

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (!b) return;
  const cmd = b.dataset.cmd;
  if (cmd === 'palette') openPalette();
  if (cmd === 'notes') toggleNotes();
  if (cmd === 'page') togglePageSettings();
  if (cmd === 'history') openHistory();
  if (cmd === 'new-chapter') newChapter();
  if (cmd === 'new-act') newAct();
  if (cmd === 'new-page') newPageHere();
  if (cmd === 'view') toggleWriteToday();
  if (cmd === 'focus') toggleFocus();
  if (cmd === 'shortcuts') toggleShortcuts();
  if (cmd === 'stats') progressPanel.toggle();
  if (cmd === 'library') go({ view: 'library', area: null });
  if (cmd === 'today') go({ view: 'notebook', pageId: dayId(isoToday()) });
  if (cmd === 'close-tag') { $('.tag-results').hidden = true; currentEditor().commands.focus(); }
});

document.addEventListener('keydown', (e) => {
  const m = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (m && k === 'k') { e.preventDefault(); $('.palette').hidden ? openPalette() : closePalette(); }
  else if (m && e.key === '.') { e.preventDefault(); toggleFocus(); }
  else if (m && e.shiftKey && k === 'f') { e.preventDefault(); openPalette('search'); }
  else if (m && e.shiftKey && k === 'o') { e.preventDefault(); go({ view: 'library', area: null }); }
  else if (m && k === 'o') { e.preventDefault(); openPalette('go'); }
  else if (m && e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); step(e.key === 'ArrowDown' ? 1 : -1); }
  else if (m && !e.shiftKey && !e.altKey && e.code === 'BracketLeft') { e.preventDefault(); history.back(); }
  else if (m && !e.shiftKey && !e.altKey && e.code === 'BracketRight') { e.preventDefault(); history.forward(); }
  else if (m && (e.key === '/' || e.code === 'Slash')) { e.preventDefault(); toggleShortcuts(); }
  else if (m && e.shiftKey && k === 'p') { e.preventDefault(); progressPanel.toggle(); }
  else if (m && k === 'j') { e.preventDefault(); toggleWriteToday(); }
  else if (m && k === '1') { e.preventDefault(); body.classList.toggle('pin-outline'); }
  else if (m && k === '2' && writing()) { e.preventDefault(); toggleNotes(); }
  else if (((m && e.shiftKey) || (!isMac && e.altKey && !m && !e.shiftKey)) && e.code === 'KeyN' && writing()) { e.preventDefault(); notes.add(); }
  else if (e.altKey && e.shiftKey && !m && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && writing() && editor.isFocused) { e.preventDefault(); blocks.moveCurrent(e.key === 'ArrowUp' ? -1 : 1); }
  else if (m && e.shiftKey && k === 'e' && writing()) { e.preventDefault(); editor.commands.focus(); alts.toggle({ scope: 'word', focusAdd: true }); }
  else if (m && e.shiftKey && k === 'd' && writing() && editor.isFocused) { e.preventDefault(); newParagraphVersion(editor); }
  else if (e.altKey && !e.shiftKey && !m && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && writing() && editor.isFocused) { if (flip(editor, e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault(); }
  else if (m && e.shiftKey && k === 'h' && writing()) { e.preventDefault(); openHistory(); }
  else if (m && e.shiftKey && k === 'l') { e.preventDefault(); toggleTheme(); }
  else if (e.altKey && !m && e.code === 'BracketRight') { e.preventDefault(); setPage(currentWidth() + 40, currentSize()); }
  else if (e.altKey && !m && e.code === 'BracketLeft') { e.preventDefault(); setPage(currentWidth() - 40, currentSize()); }
  else if (e.altKey && !m && e.code === 'Equal') { e.preventDefault(); setPage(currentWidth(), currentSize() + 1); }
  else if (e.altKey && !m && e.code === 'Minus') { e.preventDefault(); setPage(currentWidth(), currentSize() - 1); }
  else if (e.key === 'Escape' && root.classList.contains('reading')) toggleReading();
  else if (e.key === 'Escape') {
    if (alts.isOpen) alts.close();
    if (!$('.page-settings').hidden) { $('.page-settings').hidden = true; currentEditor().commands.focus(); }
    if (!$('.history').hidden) { $('.history').hidden = true; editor.commands.focus(); }
    if (!$('.tag-results').hidden) { $('.tag-results').hidden = true; currentEditor().commands.focus(); }
    if (!$('.versions').hidden) conflicts.close();
    if (!$('.shortcuts').hidden) toggleShortcuts();
    if (progressPanel.isOpen) progressPanel.close();
    body.classList.remove('show-outline', 'show-top');
  }
});

// Save before the tab goes away.
document.addEventListener('visibilitychange', () => { if (document.hidden) { store.close(editor.state.doc); notebook.close(); } });
window.addEventListener('pagehide', () => { store.close(editor.state.doc); notebook.close(); });

// ---------- start ----------

async function start() {
  const font = localStorage.getItem('font');
  if (font) document.documentElement.dataset.font = font;
  await ensureSeed();
  await ensureAreas();
  let place = null;
  try { place = JSON.parse(localStorage.getItem('place') || 'null'); } catch { /* ignore */ }
  if (!place?.view) place = { view: 'write' };
  // A daily page opens to today; anything else opens where you left it.
  if (place.view === 'notebook' && (!place.pageId || place.pageId.startsWith('day-'))) place = { view: 'notebook', pageId: dayId(isoToday()) };
  if (place.view === 'notebook') { const p = await getEntry(place.pageId); if (!place.pageId.startsWith('day-') && gone(p)) place = { view: 'notebook', pageId: dayId(isoToday()) }; }
  if (place.view === 'project') { const b = await getEntry(place.id); if (gone(b)) place = { view: 'library' }; }
  if (place.view === 'write' && place.chapterId) { const c = await getEntry(place.chapterId); if (gone(c)) place = { view: 'write' }; }
  if (place.view !== 'write') delete root.dataset.view;
  await go(place);
  historyMode = 'push';
  sync.start();
  conflicts.count();
  // Deleted things are remembered for six months, then this device lets go of them.
  forgetDeleted(Date.now() - 182 * 864e5).catch((e) => console.warn(e));
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js');
}

start();
