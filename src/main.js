import './style.css';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EntryIds, SceneBreak } from './schema.js';
import { ChapterStore } from './chapter.js';
import { NotesLayer } from './notes.js';
import { getMeta, setMeta, putEntries, children, getEntry, snapshots } from './db.js';
import { ensureSeed, outline, entry, wordCount } from './model.js';
import { chapterMarkdown, bookMarkdown, download } from './export.js';

const $ = (s) => document.querySelector(s);
const body = document.body;
const extensions = [StarterKit.configure({ codeBlock: false, code: false, horizontalRule: false }), EntryIds, SceneBreak];

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
$('.outline').addEventListener('mouseleave', () => body.classList.remove('show-outline'));
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
  { label: 'Outline (keep open)', keys: `${mod}1`, run: () => body.classList.toggle('pin-outline') },
  { label: 'Notes beside the text', keys: `${mod}2`, run: () => toggleNotes() },
  { label: 'Add a note to this paragraph', keys: `${mod}⇧N`, run: () => notes.add() },
  { label: 'Scene break', keys: `${mod}⇧↵`, run: () => editor.chain().focus().insertSceneBreak().run() },
  { label: 'New chapter', keys: '', run: newChapter },
  { label: 'New act', keys: '', run: newAct },
  { label: 'History: earlier versions of this chapter', keys: `${mod}⇧H`, run: openHistory },
  { label: 'Light / dark', keys: `${mod}⇧L`, run: toggleTheme },
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
  if (refocus) editor.commands.focus();
}

function filterPalette() {
  const q = $('#palette-input').value.trim().toLowerCase();
  paletteItems = commands.filter((c) => !q || c.label.toLowerCase().includes(q));
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
  editor.commands.focus();
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
  if (cmd === 'history') openHistory();
  if (cmd === 'new-chapter') newChapter();
  if (cmd === 'new-act') newAct();
});

document.addEventListener('keydown', (e) => {
  const m = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (m && k === 'k') { e.preventDefault(); $('.palette').hidden ? openPalette() : closePalette(); }
  else if (m && k === '1') { e.preventDefault(); body.classList.toggle('pin-outline'); }
  else if (m && k === '2') { e.preventDefault(); toggleNotes(); }
  else if (m && e.shiftKey && k === 'n') { e.preventDefault(); notes.add(); }
  else if (m && e.shiftKey && k === 'h') { e.preventDefault(); openHistory(); }
  else if (m && e.shiftKey && k === 'l') { e.preventDefault(); toggleTheme(); }
  else if (e.key === 'Escape') {
    if (!$('.history').hidden) { $('.history').hidden = true; editor.commands.focus(); }
    body.classList.remove('show-outline', 'show-top');
  }
});

// Save before the tab goes away.
document.addEventListener('visibilitychange', () => { if (document.hidden) store.close(editor.state.doc); });
window.addEventListener('pagehide', () => store.close(editor.state.doc));

// ---------- start ----------

async function start() {
  const font = localStorage.getItem('font');
  if (font) document.documentElement.dataset.font = font;
  state.project = await ensureSeed();
  $('#project-title').textContent = state.project.title;
  state.acts = await outline(state.project.id);
  let last = await getMeta('lastChapter');
  if (!last || !state.acts.some((a) => a.chapters.some((c) => c.id === last))) last = state.acts[0]?.chapters[0]?.id;
  await openChapter(last);
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js');
}

start();
