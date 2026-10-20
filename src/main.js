import './style.css';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EntryIds, SceneBreak } from './schema.js';
import { ChapterStore } from './chapter.js';
import { NotesLayer } from './notes.js';
import { getMeta, setMeta, putEntries, children, getEntry, snapshots, byKind, onLocalWrites } from './db.js';
import { Sync } from './sync.js';
import { ensureSeed, outline, entry, wordCount } from './model.js';
import { chapterMarkdown, bookMarkdown, download } from './export.js';
import { EntryRef } from './outline.js';
import { Notebook, rootOf } from './notebook.js';
import { openPicker } from './picker.js';

const $ = (s) => document.querySelector(s);
const body = document.body;
const root = document.documentElement;
const extensions = [
  StarterKit.configure({ codeBlock: false, code: false, horizontalRule: false }), EntryIds, SceneBreak,
  EntryRef.configure({ onPick: openPicker, onOpen: openEntry })
];

const state = { project: null, acts: [], chapterId: null };

const statusEl = $('#status');
const store = new ChapterStore((s) => {
  statusEl.textContent = s === 'saving' ? 'Saving…' : s === 'error' ? 'Not saved — check storage' : 'Saved';
  statusEl.classList.toggle('error', s === 'error');
});

const editor = new Editor({
  element: $('#editor'),
  extensions,
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  autofocus: 'end',
  onUpdate: ({ editor: ed }) => {
    store.change(ed.state.doc);
    notes.layout();
    refreshWords();
    scheduleScenes();
  }
});
window.__editor = editor;

const notes = new NotesLayer($('.notes-layer'), editor);

// ---------- notebook ----------

const notebook = new Notebook({
  onPick: openPicker,
  onOpen: openEntry,
  onStatus: (s) => { if (inNotebook()) statusEl.textContent = s === 'saving' ? 'Saving…' : s === 'error' ? 'Not saved — check storage' : 'Saved'; }
});

const inNotebook = () => root.dataset.view === 'notebook';

async function setView(view) {
  // Switch at once so the next keystroke lands in the right place; saving catches up.
  if (view === 'notebook') {
    root.dataset.view = 'notebook';
    notebook.editor.commands.focus();
    store.close(editor.state.doc);
    if (!notebook.page) await notebook.openDay();
  } else {
    delete root.dataset.view;
    editor.commands.focus();
    notebook.close();
  }
  localStorage.setItem('view', view);
  $('#view-toggle').textContent = inNotebook() ? 'Write' : 'Today';
  body.classList.remove('show-outline');
}

const currentEditor = () => (inNotebook() ? notebook.editor : editor);

// Follow a link: pages and days open in the notebook, chapters in the
// manuscript, and a single line or paragraph opens where it lives.
async function openEntry(id) {
  const row = await getEntry(id);
  if (!row || row.deleted) return;
  const home = await rootOf(row);
  if (!home) return;
  const focus = home.id === row.id ? null : row.id;
  if (home.kind === 'day' || home.kind === 'page') {
    if (!inNotebook()) await setView('notebook');
    if (notebook.page?.id === home.id) { if (focus) notebook.focusLine(focus); }
    else await notebook.open(home.id, null, focus);
  } else if (home.kind === 'chapter') {
    if (inNotebook()) await setView('write');
    await openChapter(home.id);
    if (focus) {
      editor.state.doc.forEach((node, pos) => {
        if (node.attrs.eid === focus) { editor.commands.setTextSelection(pos + node.nodeSize - 1); editor.view.nodeDOM(pos)?.scrollIntoView({ block: 'center' }); }
      });
    }
  }
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
  },
  onRemote: applyRemote
});
onLocalWrites(() => sync.soon());
window.__sync = sync;
syncEl.addEventListener('click', () => { if (syncEl.dataset.state === 'signed-out') sync.signIn(); else sync.soon(0); });

async function pickProject() {
  const projects = (await byKind('project')).sort((a, b) => a.created_at - b.created_at);
  return projects[0] || null;
}

// An untouched starter project on a new device gives way to the real one from the cloud.
async function dropEmptySeed(keep) {
  for (const p of await byKind('project')) {
    if (p.id === keep.id || p.title !== 'Untitled novel') continue;
    const acts = await outline(p.id);
    const chapters = acts.flatMap((a) => a.chapters);
    const empty = chapters.every((c) => !c.fields?.words);
    if (!empty) continue;
    const now = Date.now();
    await putEntries([p, ...acts, ...chapters].map((e) => ({ ...e, deleted: true, updated_at: now })));
  }
}

async function applyRemote(rows) {
  const structural = rows.some((r) => ['project', 'act', 'chapter'].includes(r.kind));
  if (structural) {
    const remoteProject = rows.find((r) => r.kind === 'project' && !r.deleted);
    if (remoteProject) await dropEmptySeed(remoteProject);
    const project = await pickProject();
    if (project) state.project = project;
    $('#project-title').textContent = state.project.title;
    state.acts = await outline(state.project.id);
    const chapters = state.acts.flatMap((a) => a.chapters);
    if (!chapters.some((c) => c.id === state.chapterId) && chapters[0]) { state.chapterId = null; await openChapter(chapters[0].id); }
    else {
      const ch = chapters.find((c) => c.id === state.chapterId);
      if (ch) $('#chapter-title').textContent = ch.title;
      renderOutline();
    }
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
  editor.commands.setContent(doc, { emitUpdate: false });
  if (recovered) store.change(editor.state.doc);
  else statusEl.textContent = 'Saved';
  await notes.load(id);
  await setMeta('lastChapter', id);
  const ch = await getEntry(id);
  $('#chapter-title').textContent = ch.title;
  refreshWords();
  renderOutline();
  editor.commands.focus('end');
}

function refreshWords() {
  $('#words').textContent = `${wordCount(editor.state.doc.textContent).toLocaleString()} words`;
}

async function newChapter() {
  const act = state.acts.find((a) => a.chapters.some((c) => c.id === state.chapterId)) || state.acts.at(-1);
  if (!act) return newAct();
  const level = state.project.fields?.levels?.[1] || 'Chapter';
  const count = state.acts.reduce((n, a) => n + a.chapters.length, 0);
  const ch = entry('chapter', { parent_id: act.id, title: `${level} ${count + 1}`, sort: (act.chapters.at(-1)?.sort || 0) + 1 });
  await putEntries([ch]);
  await reloadOutline();
  await openChapter(ch.id);
}

async function newAct() {
  const level = state.project.fields?.levels?.[0] || 'Act';
  const names = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
  const act = entry('act', { parent_id: state.project.id, title: `${level} ${names[state.acts.length] || state.acts.length + 1}`, sort: (state.acts.at(-1)?.sort || 0) + 1 });
  const chLevel = state.project.fields?.levels?.[1] || 'Chapter';
  const count = state.acts.reduce((n, a) => n + a.chapters.length, 0);
  const ch = entry('chapter', { parent_id: act.id, title: `${chLevel} ${count + 1}`, sort: 1 });
  await putEntries([act, ch]);
  await reloadOutline();
  await openChapter(ch.id);
}

// ---------- outline ----------

async function reloadOutline() {
  state.acts = await outline(state.project.id);
  renderOutline();
}

function renameable(el, row) {
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
      if (row.id === state.chapterId) $('#chapter-title').textContent = title;
      if (row.id === state.project.id) $('#project-title').textContent = title;
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

function renderOutline() {
  const tree = $('#outline-tree');
  tree.replaceChildren();
  const proj = document.createElement('div');
  proj.className = 'tree-act';
  proj.style.fontSize = '16px';
  proj.textContent = state.project.title;
  renameable(proj, state.project);
  tree.append(proj);
  for (const act of state.acts) {
    const a = document.createElement('div');
    a.className = 'tree-act';
    a.textContent = act.title;
    renameable(a, act);
    tree.append(a);
    for (const ch of act.chapters) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tree-chapter' + (ch.id === state.chapterId ? ' current' : '');
      b.textContent = ch.title;
      b.addEventListener('click', () => { if (b.contentEditable !== 'true') openChapter(ch.id); });
      renameable(b, ch);
      tree.append(b);
      if (ch.id === state.chapterId) {
        const scenes = document.createElement('div');
        scenes.id = 'outline-scenes';
        tree.append(scenes);
      }
    }
  }
  renderScenes();
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
    if (node.type.name !== 'sceneBreak') return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tree-scene';
    b.textContent = node.attrs.title || 'Untitled scene';
    b.addEventListener('click', () => {
      editor.view.nodeDOM(pos)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      editor.commands.focus(pos + node.nodeSize + 1);
    });
    box.append(b);
  });
}

// ---------- panels revealed by edges ----------

$('.edge-left').addEventListener('mouseenter', () => body.classList.add('show-outline'));
document.querySelectorAll('.outline').forEach((el) => el.addEventListener('mouseleave', () => body.classList.remove('show-outline')));
$('.edge-top').addEventListener('mouseenter', () => body.classList.add('show-top'));
$('.topbar').addEventListener('mouseleave', () => body.classList.remove('show-top'));

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
  if (!panel.hidden) { panel.hidden = true; editor.commands.focus(); return; }
  setPage(currentWidth(), currentSize());
  panel.hidden = false;
  $('#page-width').focus();
}

$('#page-width').addEventListener('input', (e) => setPage(Number(e.target.value), currentSize()));
$('#text-size').addEventListener('input', (e) => setPage(currentWidth(), Number(e.target.value)));
$('#page-reset').addEventListener('click', () => setPage(DEFAULT_WIDTH, defaultSize()));
$('#page-done').addEventListener('click', togglePageSettings);

// ---------- command menu ----------

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

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

async function exportBook() {
  await store.close(editor.state.doc);
  download(`${state.project.title}.md`, await bookMarkdown(state.project, state.acts));
}

const commands = [
  { label: 'Today’s page', keys: `${mod}J`, run: () => (inNotebook() ? notebook.openDay() : setView('notebook').then(() => notebook.openDay())) },
  { label: 'Back to writing', keys: `${mod}J`, run: () => setView('write'), when: inNotebook },
  { label: 'New notebook page', keys: '', run: () => setView('notebook').then(() => notebook.newPage()) },
  { label: 'Link to a page…', keys: '[[', run: () => openPicker(currentEditor()) },
  { label: 'Outline (keep open)', keys: `${mod}1`, run: () => body.classList.toggle('pin-outline'), when: () => !inNotebook() },
  { label: 'Shelves (keep open)', keys: `${mod}1`, run: () => body.classList.toggle('pin-outline'), when: inNotebook },
  { label: 'Notes beside the text', keys: `${mod}2`, run: () => toggleNotes(), when: () => !inNotebook() },
  { label: 'Add a note to this paragraph', keys: `${mod}⇧N`, run: () => notes.add(), when: () => !inNotebook() },
  { label: 'Scene break', keys: `${mod}⇧↵`, run: () => editor.chain().focus().insertSceneBreak().run(), when: () => !inNotebook() },
  { label: 'New chapter', keys: '', run: () => setView('write').then(newChapter) },
  { label: 'New act', keys: '', run: () => setView('write').then(newAct) },
  { label: 'History: earlier versions of this chapter', keys: `${mod}⇧H`, run: openHistory, when: () => !inNotebook() },
  { label: 'Page width and text size', keys: '', run: togglePageSettings },
  { label: 'Wider page', keys: 'Alt+]', run: () => setPage(currentWidth() + 40, currentSize()) },
  { label: 'Narrower page', keys: 'Alt+[', run: () => setPage(currentWidth() - 40, currentSize()) },
  { label: 'Larger text', keys: 'Alt+=', run: () => setPage(currentWidth(), currentSize() + 1) },
  { label: 'Smaller text', keys: 'Alt+−', run: () => setPage(currentWidth(), currentSize() - 1) },
  { label: 'Light / dark', keys: `${mod}⇧L`, run: toggleTheme },
  { label: 'Sync now', keys: '', run: () => sync.soon(0), when: () => !!sync.user },
  { label: 'Sign in to sync between devices', keys: '', run: () => sync.signIn(), when: () => sync.available && !sync.user },
  { label: 'Sign out of sync', keys: '', run: () => sync.signOut(), when: () => !!sync.user },
  { label: 'Change the writing font', keys: '', run: cycleFont },
  { label: 'Export this chapter as Markdown', keys: '', run: exportChapter },
  { label: 'Export the whole book as Markdown', keys: '', run: exportBook }
];

let paletteIndex = 0;
let paletteItems = [];

function openPalette() {
  $('.palette').hidden = false;
  $('.palette-backdrop').hidden = false;
  const input = $('#palette-input');
  input.value = '';
  filterPalette();
  input.focus();
}

function closePalette(refocus = true) {
  $('.palette').hidden = true;
  $('.palette-backdrop').hidden = true;
  if (refocus) currentEditor().commands.focus();
}

function filterPalette() {
  const q = $('#palette-input').value.trim().toLowerCase();
  paletteItems = commands.filter((c) => (!c.when || c.when()) && (!q || c.label.toLowerCase().includes(q)));
  paletteIndex = 0;
  const list = $('#palette-list');
  list.replaceChildren();
  paletteItems.forEach((c, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === paletteIndex));
    li.innerHTML = '<span></span><span class="keys"></span>';
    li.firstChild.textContent = c.label;
    li.lastChild.textContent = c.keys;
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
  closePalette(false);
  currentEditor().commands.focus();
  c.run();
}

$('#palette-input').addEventListener('input', filterPalette);
$('#palette-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); selectPalette(Math.min(paletteIndex + 1, paletteItems.length - 1)); }
  if (e.key === 'ArrowUp') { e.preventDefault(); selectPalette(Math.max(paletteIndex - 1, 0)); }
  if (e.key === 'Enter') { e.preventDefault(); if (paletteItems[paletteIndex]) runCommand(paletteItems[paletteIndex]); }
  if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
});
$('.palette-backdrop').addEventListener('click', () => closePalette());

function toggleNotes() {
  notes.setVisible(!notes.visible);
  $('#notes-toggle').textContent = notes.visible ? 'Hide notes' : 'Notes';
}

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
  if (cmd === 'view') setView(inNotebook() ? 'write' : 'notebook');
  if (cmd === 'shelves') body.classList.toggle('show-outline');
  if (cmd === 'close-tag') { $('.tag-results').hidden = true; currentEditor().commands.focus(); }
});

document.addEventListener('keydown', (e) => {
  const m = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (m && k === 'k') { e.preventDefault(); $('.palette').hidden ? openPalette() : closePalette(); }
  else if (m && k === 'j') { e.preventDefault(); setView(inNotebook() ? 'write' : 'notebook'); }
  else if (m && k === '1') { e.preventDefault(); body.classList.toggle('pin-outline'); }
  else if (m && k === '2' && !inNotebook()) { e.preventDefault(); toggleNotes(); }
  else if (m && e.shiftKey && k === 'n' && !inNotebook()) { e.preventDefault(); notes.add(); }
  else if (m && e.shiftKey && k === 'h' && !inNotebook()) { e.preventDefault(); openHistory(); }
  else if (m && e.shiftKey && k === 'l') { e.preventDefault(); toggleTheme(); }
  else if (e.altKey && !m && e.code === 'BracketRight') { e.preventDefault(); setPage(currentWidth() + 40, currentSize()); }
  else if (e.altKey && !m && e.code === 'BracketLeft') { e.preventDefault(); setPage(currentWidth() - 40, currentSize()); }
  else if (e.altKey && !m && e.code === 'Equal') { e.preventDefault(); setPage(currentWidth(), currentSize() + 1); }
  else if (e.altKey && !m && e.code === 'Minus') { e.preventDefault(); setPage(currentWidth(), currentSize() - 1); }
  else if (e.key === 'Escape') {
    if (!$('.page-settings').hidden) { $('.page-settings').hidden = true; editor.commands.focus(); }
    if (!$('.history').hidden) { $('.history').hidden = true; editor.commands.focus(); }
    if (!$('.tag-results').hidden) { $('.tag-results').hidden = true; currentEditor().commands.focus(); }
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
  state.project = await pickProject();
  $('#project-title').textContent = state.project.title;
  state.acts = await outline(state.project.id);
  let last = await getMeta('lastChapter');
  if (!last || !state.acts.some((a) => a.chapters.some((c) => c.id === last))) last = state.acts[0]?.chapters[0]?.id;
  await openChapter(last);
  if (inNotebook()) {
    const page = localStorage.getItem('notebookPage');
    // A day page opens to today; a named page opens where you left it.
    if (page && !page.startsWith('day-') && (await getEntry(page))) await notebook.open(page);
    else await notebook.openDay();
    $('#view-toggle').textContent = 'Write';
  } else await notebook.renderShelves();
  sync.start();
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js');
}

start();
