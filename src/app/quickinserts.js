// Quick inserts: the / menu, Ctrl + Shift + ; and Ctrl + ;.
import { isMac, keyLabel } from '../keys.js';
import { flip, newParagraphVersion } from '../alts.js';
import { bySort } from '../order.js';
import { getEntry, byKind } from '../db.js';
import { searchIndex } from '../search.js';
import { popMenu, toast } from '../menu.js';
import { entry } from '../model.js';
import { toggleDone, toggleChecklist, toggleBox } from '../outline.js';
import { moveEntries } from '../move.js';
import { insertFiles } from '../filenode.js';
import { titleOf, dayId } from '../notebook.js';
import { setSlashItems } from '../slash.js';
import { setSuggestWorld } from '../suggest.js';
import { newScene } from '../woven.js';
import { openPicker } from '../picker.js';
import { tagIndex, statsOf } from '../tags.js';
import { whenOpen } from '../when.js';
import { inPane, BESIDE_PLACES } from '../panes.js';
import { openClaudeKnows } from '../claudeknows.js';
import { openTidy } from '../tidypass.js';
import { areas, books, bookType, hasManuscript, kindName, bookOf, newPage, worlds, worldOf } from '../library.js';
import { isoOf, isoToday } from '../dates.js';
import { addCommands, mod } from './commandlist.js';
import { $, alts, blocks, body, editor, gone, inNotebook, insertSection, isScript, isWoven, notes, root, state, statusEl, store, tooBig, view } from '../main.js';
import { touch } from './scriptbar.js';
import { currentEditor, notebook } from './notebookview.js';
import { go, newPageHere, openEntry, paneStep, setBesideUntil } from './routing.js';
import { applyRemote, conflicts, sync } from './syncwiring.js';
import { activePlan, markScene, newAct, newChapter, sceneDetails, steadyTitles, toggleNumbering } from './manuscript.js';
import { KINDS, addPiece, bookMenu, refreshViews, setKind, setLife, worldMenu } from './tidying.js';
import { printCurrent, toggleCompare, toggleFreshEyes } from './revising.js';
import { toggleGrid, toggleProduction } from './productionwiring.js';
import { goPage, nav, strip, todayPanel } from './workpages.js';
import { openGoTo } from './goto.js';
import { closeHistory, hstrip, openHistory } from './historyview.js';
import { currentSize, currentWidth, lookHere, progressPanel, setPage, step, togglePageSettings, toggleReading, toggleSections, toggleShortcuts } from './pagesettings.js';
import { box, commands, toggleTheme, writing } from './commands.js';
import { askServer, canAskServer, capture, captureHere, openToday, plan } from './talking.js';
import { openTalk, paneKeys, pull, toggleBesidePane, whenHere } from './beside.js';

// Pictures and files from this device, put in where the caret is.
// ---------- quick inserts (the / menu, Ctrl+Shift+; and Ctrl+;) ----------

const timeNow = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, ' ').toLowerCase();
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function dayFrom(n) { const d = new Date(); d.setDate(d.getDate() + n); return d; }
const shortDay = (d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

function insertTime(ed) { ed.chain().focus().insertContent(`${timeNow()} `).run(); }
// A date is a link to that day's page (made when you first write on it).
function insertDay(ed, n) {
  const id = dayId(isoOf(dayFrom(n)));
  ed.chain().focus().insertContent([{ type: 'entryRef', attrs: { id, title: titleOf({ kind: 'day', id }) } }, { type: 'text', text: ' ' }]).run();
}
// The time on its own line with the caret on a fresh line under it, ready
// for an entry (tucked in a level on the notebook).
function timeHeading(ed) {
  const outline = ed === notebook.editor;
  const empty = !ed.state.selection.$from.parent.textContent.trim();
  const c = ed.chain().focus();
  if (!empty) (outline ? c.splitListItem('listItem') : c.splitBlock());
  c.insertContent(timeNow()).run();
  if (outline) ed.chain().splitListItem('listItem').sinkListItem('listItem').scrollIntoView().run();
  else ed.chain().splitBlock().scrollIntoView().run();
}

function pickFiles() {
  const ed = currentEditor();
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.addEventListener('change', () => {
    const files = [...input.files];
    if (files.length) insertFiles(ed.view, ed.schema.nodes.file, files, null, tooBig);
  });
  input.click();
}

// The piece you're in, wherever you are in it.
function currentBookId() {
  if (view() === 'project') return state.bookId;
  if (view() === 'compare') return state.compareId;
  if (writing()) return state.project?.id || null;
  if (inNotebook() && notebook.page?.kind === 'project') return notebook.page.id;
  return null;
}
const currentBook = () => getEntry(currentBookId());
const currentWorld = () => getEntry(state.worldId);
// The page, piece or world you're in, for What Claude knows (null on a day page or the Library).
async function knowsThing() {
  if (inNotebook() && notebook.page?.kind === 'page') return notebook.page;
  if (currentBookId()) return currentBook();
  if (state.worldId && view() === 'world') return currentWorld();
  return null;
}
// Bring in old notes: a section pasted or dropped from another app becomes a page.
async function bringInOld() {
  const base = location.origin + location.pathname;
  const { openBringIn } = await import('../bringin.js');
  await openBringIn({
    ask: askServer, canAsk: canAskServer, toast, base,
    open: (row) => openEntry(row.id),
    applied: async (rows) => { if (rows.length) await applyRemote(rows); await refreshViews(); },
    tags: async () => statsOf(await tagIndex()).sort((a, b) => b.count - a.count).map((t) => t.tag)
  });
}

const showClaudeKnows = async (thing) => openClaudeKnows(thing === undefined ? await knowsThing() : thing, { toast });

// Claude's tidy pass (src/tidypass.js): its suggestions to tick yes or no, and
// what it changed itself through the connector, each with an Undo.
async function showTidy() {
  if (!$('.palette').hidden) closePalette(false);
  await openTidy({
    flush: () => Promise.all([store.close(editor.state.doc), notebook.close()]),
    setLife,
    onRows: (rows) => applyRemote(rows),
    open: (id) => openEntry(id),
    canAsk: canAskServer,
    // Claude makes the batch on the server; it comes down with the next sync.
    ask: async () => { const got = await askServer({ mode: 'tidy' }); await sync.run(); return got?.count || 0; },
    toast
  });
}
const menuSpot = () => ({ left: Math.max(8, window.innerWidth / 2 - 130), top: 110 });

async function showTrash() {
  await go({ view: 'library', area: null });
  const box = $('#lib-trash-box');
  if (box.hidden) toast('The Trash is empty');
  else { box.open = true; box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
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

// Send selection to…: the paragraphs or lines the selection touches (or the
// one the caret is in) move together to a chapter, page or day.
function selectedIds(ed) {
  const { from, to } = ed.state.selection;
  const ids = [];
  ed.state.doc.descendants((node, pos) => {
    if (pos + node.nodeSize < from || pos > to) return false;
    if (node.attrs?.eid && (node.type.name === 'listItem' || node.isBlock)) { ids.push(node.attrs.eid); return false; }
    return true;
  });
  return ids;
}

// ids: the paragraphs or lines to send (the six-dot menu passes its own one).
function sendSelectionPicker(ids = selectedIds(currentEditor())) {
  if (!ids.length) return;
  const here = inNotebook() ? notebook.page?.id : state.chapterId;
  const send = (id, fallback) => async () => {
    const n = await moveEntries(ids, id, { fallback });
    if (n) statusEl.textContent = `Moved ${n === 1 ? '' : `${n} `}to ${fallback ? titleOf(fallback) : titleOf(await getEntry(id))}`;
  };
  const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  openPalette('move', async () => {
    const out = [];
    for (const [label, iso] of [['Today', day(0)], ['Tomorrow', day(1)], ['Yesterday', day(-1)]]) {
      const id = dayId(iso);
      if (id !== here) out.push({ label, keys: 'day', run: send(id, entry('day', { id, title: iso })) });
    }
    for (const ch of (await byKind('chapter')).filter((x) => !gone(x) && x.id !== here).sort((a, c) => c.updated_at - a.updated_at)) {
      const book = await bookOf(ch);
      if (book && !gone(book)) out.push({ label: `${ch.title || 'Untitled'} · ${book.title || 'Untitled'}`, keys: 'chapter', run: send(ch.id) });
    }
    for (const pg of (await byKind('page')).filter((x) => !gone(x) && x.id !== here).sort((a, c) => c.updated_at - a.updated_at)) out.push({ label: pg.title || 'Untitled page', keys: 'page', run: send(pg.id) });
    for (const d of (await byKind('day')).filter((x) => !x.deleted && x.id !== here).sort((a, c) => (a.title < c.title ? 1 : -1)).slice(0, 30)) out.push({ label: titleOf(d), keys: 'day', run: send(d.id) });
    return out;
  });
}

// Gather a tag: pick the page its lines should gather on (from the tag's list).
function gatherOntoPage(tag) {
  if (!tag) return;
  $('.tag-results').hidden = true;
  const onto = (pageId) => async () => {
    await go({ view: 'notebook', pageId });
    const n = await notebook.addGather(tag);
    statusEl.textContent = n ? `Gathered ${n} #${tag} ${n === 1 ? 'line' : 'lines'}` : `Gathering #${tag} here`;
  };
  openPalette('pick', async () => {
    const out = [];
    if (notebook.page && !notebook.isDay) out.push({ label: `This page: ${titleOf(notebook.page)}`, keys: 'page', run: onto(notebook.page.id) });
    const label = tag.charAt(0).toUpperCase() + tag.slice(1).replace(/[-_]/g, ' ');
    out.push({ label: `A new page called “${label}”`, keys: 'new', run: async () => {
      const world = notebook.page && !notebook.isDay ? await worldOf(notebook.page) : null;
      const page = await newPage(world?.id || (view() === 'project' ? state.bookId : null), label);
      await onto(page.id)();
    } });
    for (const pg of (await byKind('page')).filter((x) => !x.deleted && x.id !== notebook.page?.id).sort((a, c) => c.updated_at - a.updated_at)) out.push({ label: pg.title || 'Untitled page', keys: 'page', run: onto(pg.id) });
    return out;
  }, `Gather #${tag} onto which page?`);
}

// Gather a tag onto the page you're on: pick the tag.
function gatherTagHere() {
  openPalette('pick', async () => {
    const tags = new Map();
    for (const kind of ['line', 'para']) for (const r of await byKind(kind)) for (const t of r.tags || []) tags.set(t, (tags.get(t) || 0) + 1);
    return [...tags].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ label: `#${t}`, keys: String(n), run: async () => {
      const added = await notebook.addGather(t);
      statusEl.textContent = added ? `Gathered ${added} #${t} ${added === 1 ? 'line' : 'lines'}` : `Gathering #${t} here`;
    } }));
  }, 'Gather which #tag onto this page?');
}

async function places(only) {
  const [allAreas, allBooks, allWorlds] = await Promise.all([areas(), books(), worlds()]);
  const out = [];
  const worldName = new Map(allWorlds.map((w) => [w.id, w.title || 'Untitled']));
  for (const w of allWorlds.sort((a, c) => c.updated_at - a.updated_at)) out.push({ label: w.title || 'Untitled', keys: 'world', run: () => go({ view: 'world', id: w.id }) });
  for (const b of allBooks.sort((a, c) => c.updated_at - a.updated_at)) {
    const w = worldName.get(b.parent_id);
    // A world's only piece of the same name is already listed as the world.
    if (w === (b.title || 'Untitled') && allBooks.filter((x) => x.parent_id === b.parent_id).length === 1) continue;
    out.push({ label: w ? `${b.title || 'Untitled'} · ${w}` : b.title || 'Untitled', keys: kindName(b).toLowerCase(), run: () => go({ view: 'project', id: b.id }) });
  }
  if (only === 'books') return out;
  for (const a of allAreas) out.push({ label: a.title, keys: 'area', run: () => go({ view: 'library', area: a.id }) });
  // Every act and chapter in two reads, rather than a read per book and act.
  const [allActs, allChapters] = await Promise.all([byKind('act'), byKind('chapter')]);
  const under = new Map();
  for (const r of [...allActs, ...allChapters]) (under.get(r.parent_id) || under.set(r.parent_id, []).get(r.parent_id)).push(r);
  const inOrder = (id) => (under.get(id) || []).sort(bySort);
  for (const b of allBooks.filter(hasManuscript)) {
    for (const act of inOrder(b.id)) if (act.kind === 'act') for (const ch of inOrder(act.id)) out.push({ label: `${ch.title} · ${b.title}`, keys: 'chapter', run: () => go({ view: 'write', chapterId: ch.id }) });
  }
  for (const p of (await byKind('page')).filter((x) => !x.deleted)) out.push({ label: p.title || 'Untitled page', keys: 'page', run: () => go({ view: 'notebook', pageId: p.id }) });
  const days = (await byKind('day')).filter((d) => !d.deleted).sort((a, c) => (a.title < c.title ? 1 : -1)).slice(0, 30);
  for (const d of days) out.push({ label: titleOf(d), keys: 'day', run: () => go({ view: 'notebook', pageId: d.id }) });
  return out;
}

let paletteIndex = 0;
let paletteItems = [];
let paletteMode = 'commands';
let paletteSource; // set in wireQuickInserts()
let paletteReady; // set in wireQuickInserts()
let paletteGroup = null;
let searchIdx = null;
const KIND_LABEL = { para: 'text', heading: 'heading', line: 'line', note: 'note', scene: 'scene', project: 'book', chapter: 'chapter', page: 'page', area: 'area' };

// A search result: open it where it lives, with the caret on it.
export async function openHit(row) {
  if (row.kind === 'note') { await openEntry(row.parent_id); if (!notes.visible) notes.setVisible(true); return; }
  if (row.kind === 'chapter') return go({ view: 'write', chapterId: row.id });
  return openEntry(row.id);
}

async function openPalette(mode = 'commands', only, placeholder) {
  // Open and focus at once so nothing typed is lost; the list fills in after.
  box.stop();
  // Commands, places and adding a task: the one box (box.js).
  if (mode === 'commands') return openBox({ all: only === 'all', placeholder });
  paletteMode = mode;
  paletteGroup = null;
  const listed = mode === 'move' || mode === 'pick';
  paletteSource = [];
  paletteReady = Promise.resolve();
  $('.palette').hidden = false;
  $('.palette-backdrop').hidden = false;
  const input = $('#palette-input');
  input.placeholder = mode === 'pick' ? placeholder : mode === 'search' ? 'Search all your writing…' : mode === 'move' ? 'Move this line to…' : mode === 'go' ? (only === 'books' ? 'Go to a book…' : 'Go to a book, chapter, page or day…') : 'Type a command…';
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
  if (mode === 'go' || listed) {
    paletteReady = (listed ? only() : places(only)).then((list) => {
      if (paletteMode !== mode) return;
      paletteSource = list;
      filterPalette();
    });
    await paletteReady;
  }
}

// The one box: Ctrl + K or Ctrl + O, the Go button on a phone. find: put the
// caret in it (a phone keeps its keyboard down until you tap the box).
function openBox({ all = false, find = !touch.matches, placeholder = '' } = {}) {
  paletteMode = 'box';
  paletteGroup = null;
  body.classList.remove('show-outline', 'show-top');
  $('.palette').hidden = false;
  $('.palette-backdrop').hidden = false;
  body.classList.add('go-on');
  const input = $('#palette-input');
  input.value = '';
  if (find) input.focus();
  box.start({ all, find });
  if (placeholder) input.placeholder = placeholder;
}
const boxOpen = () => !$('.palette').hidden && paletteMode === 'box';

function closePalette(refocus = true) {
  box.stop();
  body.classList.remove('go-on');
  $('.palette').hidden = true;
  $('.palette-backdrop').hidden = true;
  if (refocus && (writing() || inNotebook())) currentEditor().commands.focus();
}

function filterPalette() {
  // Straight and curly apostrophes are the same thing here ("what's when").
  const norm = (t) => t.toLowerCase().replace(/[’‘']/g, '');
  if (paletteMode === 'box') return;
  const q = norm($('#palette-input').value.trim());
  if (paletteMode === 'search') {
    const raw = $('#palette-input').value;
    const hits = searchIdx ? searchIdx.find(raw) : [];
    paletteItems = hits.map((h) => ({ label: h.snippet, hint: h.where, keys: KIND_LABEL[h.row.kind] || '', run: () => openHit(h.row) }));
    if (!paletteItems.length) {
      const note = !searchIdx ? 'Looking…' : raw.trim().length < 2 ? 'Type a word or two from anything you’ve written' : 'Nothing found';
      paletteItems = [{ label: note, keys: '', stay: true, run: () => {} }];
    }
  } else {
    // Best matches first: the whole name, then names starting with it, then a
    // word starting with it, then anywhere (so "Page 3" isn't lost behind "Page 30").
    const rank = (label) => {
      const l = norm(label);
      if (l === q) return 0;
      if (l.startsWith(q)) return l[q.length] === ' ' ? 1 : 2;
      if (l.includes(` ${q}`)) return 3;
      return l.includes(q) ? 4 : 5;
    };
    // A command's other words (theme for the look, catch-up for the Desk) find it too, after the names.
    // Several words find a name holding them all, in any order ("calendar week").
    const words = q.split(/\s+/).filter(Boolean);
    const allIn = (l) => words.length > 1 && words.every((w) => l.includes(w));
    const hit = (c) => norm(c.label).includes(q) || allIn(norm(c.label));
    paletteItems = paletteSource.filter((c) => hit(c))
      .map((c, i) => ({ c, i, r: q ? rank(c.label) : 0 })).sort((a, b) => a.r - b.r || a.i - b.i).slice(0, 60).map((x) => x.c);
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
    li.lastChild.textContent = keyLabel(c.keys);
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

function toggleNotes() {
  notes.setVisible(!notes.visible);
}

const toggleWriteToday = () => go(inNotebook() ? { view: 'write' } : { view: 'notebook', pageId: dayId(isoToday()) });

// Its commands in the box (Ctrl + K); commandinfo.js has their hints and words.
addCommands(() => [
  { group: 'plan', label: 'Add a task', keys: `${mod}K`, run: () => setTimeout(() => openPalette('commands', null, 'Type the task, then Enter (a day at the end: fri, tomorrow, next week)'), 60) },
  { group: 'go', label: 'Search inside all your writing', keys: `${mod}⇧F`, run: () => openPalette('search') },
  { group: 'write', label: 'Insert the time', keys: `${mod}⇧;`, run: () => insertTime(currentEditor()), when: () => writing() || inNotebook() },
  { group: 'write', label: 'Insert today’s date', keys: `${mod};`, run: () => insertDay(currentEditor(), 0), when: () => writing() || inNotebook() },
  { group: 'view', label: 'Notes beside the text', keys: `${mod}2`, run: () => toggleNotes(), when: writing },
  { group: 'write', label: 'Move this line to another page or day…', keys: '', run: moveLinePicker, when: inNotebook },
  { group: 'write', label: 'Gather a #tag onto this page…', keys: '', run: gatherTagHere, when: inNotebook },
  { group: 'write', label: 'Add a picture or file…', keys: '', run: () => setTimeout(pickFiles, 120), when: () => writing() || inNotebook() },
  { group: 'tidy', label: 'Send selection to… a chapter, page or day', keys: '', run: () => setTimeout(sendSelectionPicker, 120), when: () => writing() || inNotebook() },
  { group: 'tidy', label: 'This piece: rename, label, stage, move or trash…', keys: '', run: async () => popMenu(null, await bookMenu(await currentBook()), menuSpot()), when: () => !!currentBookId() },
  { group: 'tidy', label: 'This world: rename, move to an area or trash…', keys: '', run: async () => popMenu(null, await worldMenu(await currentWorld()), menuSpot()), when: () => !!state.worldId && (view() === 'world' || !!currentBookId() || inNotebook()) },
  { group: 'tidy', label: 'Change how this piece is written (prose, script, outline)…', keys: '', run: async () => { const b = await currentBook(); popMenu(null, KINDS.map(([id, label]) => ({ label, current: bookType(b) === id, run: () => setKind(b, id) })), menuSpot()); }, when: () => !!currentBookId() },
  { group: 'new', label: 'New piece in this world (a gag, an episode, a season…)', keys: '', run: async () => { const w = await currentWorld(); if (w) addPiece(w.id); }, when: () => !!state.worldId },
  { group: 'write', label: 'Number the scenes (for production)…', keys: '', run: async () => { const b = await currentBook(); if (!b.fields?.numbered) toggleNumbering(b); }, when: () => writing() && isScript() && !state.project?.fields?.numbered },
  { group: 'view', label: 'What Claude knows: its one-line note on this, and weekly summaries', keys: '', words: ['about', 'summary', 'second brain', 'memory', 'digest', 'weekly'], run: () => showClaudeKnows() },
  { group: 'new', label: 'Bring in old notes (from Thymer, Tana, Workflowy, OneNote)…', keys: '', words: ['import', 'paste', 'opml', 'markdown', 'migrate', 'old apps'], run: () => bringInOld() },
  { group: 'tidy', label: 'Tidy pass: Claude’s suggested tidy-ups, and what it changed', keys: '', words: ['tidy', 'clean up', 'merge', 'duplicates', 'undo claude', 'claude changes', 'suggestions'], run: () => setTimeout(showTidy, 120) },
  { group: 'tidy', label: 'Trash: bring things back', keys: '', run: showTrash }
]);

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wireQuickInserts() {
  // @ lists the people and places of the project he is in.
  setSuggestWorld(async () => {
    if (writing() && state.project) return worldOf(state.project);
    if (inNotebook() && notebook.page && !notebook.isDay) return worldOf(notebook.page);
    if (state.worldId && view() === 'world') return currentWorld();
    return null;
  });
  setSlashItems((ed) => {
    const outline = ed === notebook.editor;
    const inScript = !outline && isScript();
    const days = WEEKDAYS.map((name, w) => {
      const ahead = ((w - new Date().getDay() + 7) % 7) || 7;
      return { id: name, label: name[0].toUpperCase() + name.slice(1), hint: shortDay(dayFrom(ahead)), more: true, run: (e) => insertDay(e, ahead) };
    });
    return [
      { id: 'time', label: 'Time', hint: timeNow(), keys: '⌘⇧;', run: insertTime },
      { id: 'now', label: 'Time heading', hint: 'a line to write under', words: ['journal', 'entry', 'log'], run: timeHeading },
      { id: 'today', label: 'Today', hint: shortDay(new Date()), keys: '⌘;', words: ['date'], run: (e) => insertDay(e, 0) },
      { id: 'tomorrow', label: 'Tomorrow', hint: shortDay(dayFrom(1)), words: ['date'], run: (e) => insertDay(e, 1) },
      { id: 'yesterday', label: 'Yesterday', hint: shortDay(dayFrom(-1)), words: ['date'], run: (e) => insertDay(e, -1) },
      { id: 'link', label: 'Link to a page', keys: '[[', words: ['page'], run: (e) => openPicker(e) },
      { id: 'tag', label: 'Tag', keys: '#', hint: 'your tags show as you type', run: (e) => e.chain().focus().insertContent('#').run() },
      !outline && { id: 'note', label: 'Note on this paragraph', keys: '⌘⇧N', words: ['comment'], run: () => notes.add() },
      { id: 'talk', label: 'Talk', hint: 'say it; Claude writes it up here', keys: '⌥C', words: ['voice', 'dictate', 'speak', 'record', 'capture'], run: () => setTimeout(() => captureHere({ start: true }), 60) },
      { id: 'picture', label: 'Picture or file', words: ['image', 'photo', 'file', 'attach'], run: () => setTimeout(pickFiles, 120) },
      outline && { id: 'done', label: 'Done', hint: 'strike the line through', keys: '⌘↵', words: ['todo', 'check'], run: (e) => toggleDone(e) },
      outline && { id: 'checklist', label: 'Checklist', hint: 'boxes on the lines under this one', words: ['todo', 'to-do', 'list', 'tick', 'checkbox'], run: (e) => toggleChecklist(e) },
      outline && { id: 'box', label: 'Box', hint: 'a tick box on this line', keys: '[ ]', words: ['checkbox', 'todo', 'tick'], run: (e) => toggleBox(e) },
      !outline && !inScript && { id: 'scene', label: 'Scene break', keys: '⌘⇧↵', words: ['break', 'divider'], run: (e) => e.chain().focus().insertSceneBreak().run() },
      inScript && { id: 'section', label: 'Section', hint: 'your own heading', words: ['act', 'sequence', 'heading'], run: () => { insertSection(editor.state.selection.$from.before(1)); } },
      inScript && isWoven() && { id: 'cut', label: 'New scene', hint: 'a faint line, from here on', keys: '⌘⇧↵', words: ['scene', 'break', 'line'], run: () => newScene(editor) },
      inScript && isWoven() && { id: 'continuous', label: 'Continuous', hint: 'straight on from the scene before', words: ['cont'], run: () => markScene('continuous') },
      inScript && isWoven() && { id: 'intercut', label: 'Intercut', hint: 'two places at once (a phone call)', words: ['phone', 'cross'], run: () => markScene('intercut') },
      inScript && isWoven() && { id: 'flashback', label: 'Flashback', hint: 'this scene is the past', words: ['past', 'memory'], run: () => markScene('flashback') },
      inScript && isWoven() && { id: 'montage', label: 'Montage', hint: 'a run of moments', words: ['series'], run: () => markScene('montage') },
      inScript && isWoven() && { id: 'scene', label: 'Scene details', hint: 'place, time, title', words: ['place', 'time', 'title', 'slug'], run: () => setTimeout(sceneDetails, 30) },
      ...days
    ].filter(Boolean);
  });
  paletteSource = commands;
  paletteReady = Promise.resolve();
  $('#palette-input').addEventListener('input', filterPalette);
  $('#palette-input').addEventListener('keydown', (e) => {
    if (paletteMode === 'box') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); selectPalette(Math.min(paletteIndex + 1, paletteItems.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); selectPalette(Math.max(paletteIndex - 1, 0)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Shift + Enter or Ctrl + Enter: beside.
      const beside = (e.shiftKey || e.ctrlKey || e.metaKey) && !['move', 'pick'].includes(paletteMode);
      // Enter pressed before the list arrived still picks the best match.
      paletteReady.then(() => {
        const c = paletteItems[paletteIndex];
        if (!c) return;
        // Shift + Enter (or Ctrl + Enter): where it leads opens beside.
        if (beside && !c.stay && (!c.group || c.group === 'go')) setBesideUntil(Date.now() + 1500);
        runCommand(c);
      });
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
  });
  $('.palette-backdrop').addEventListener('click', () => closePalette());
  document.addEventListener('notes-visibility', () => { $('#notes-toggle').setAttribute('aria-pressed', String(notes.visible)); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (!b) return;
    const cmd = b.dataset.cmd;
    if (cmd === 'palette') openPalette();
    if (cmd === 'notes' && writing()) toggleNotes();
    if (cmd === 'page') lookHere();
    if (cmd === 'history') hstrip.toggle();
    if (cmd === 'history-list') openHistory();
    if (cmd === 'new-chapter') newChapter();
    if (cmd === 'new-act') newAct();
    if (cmd === 'new-page') newPageHere();
    if (cmd === 'view') toggleWriteToday();
    if (cmd === 'shortcuts') toggleShortcuts();
    if (cmd === 'stats') progressPanel.toggle();
    if (cmd === 'library') go({ view: 'library', area: null });
    if (cmd === 'grid') toggleGrid();
    if (cmd === 'production') toggleProduction();
    // Beside, the plan's own Day is today's plan alone, not the whole page.
    // Today opens on Now when something is current or today has open tasks.
    if (cmd === 'today') { if (inPane && view() === 'plan') go(BESIDE_PLACES.plan); else openToday(); }
    if (cmd === 'now') go({ view: 'plan', tab: 'now' });
    // On a phone the day is two views: its page, and its plan.
    // Beside, Page is today's plan alone (a pane has no day page of its own).
    if (cmd === 'today-page' && inPane && view() === 'plan') go(BESIDE_PLACES.plan);
    else if (cmd === 'today-page' || cmd === 'today-plan') plan.goTab(cmd === 'today-page' ? 'page' : 'plan');
    if (cmd === 'beside') toggleBesidePane();
    if (cmd === 'talk') openTalk();
    if (cmd === 'drawer') go({ view: 'drawer' });
    // On a phone, the search button in a project is Go to… for that project.
    if (cmd === 'go') { if (touch.matches && ['world', 'piece'].includes(strip.ctx?.scope) && !nav.isOpen) openGoTo().then((ok) => { if (!ok) nav.toggle(); }); else nav.toggle(); }
    if (cmd === 'mic') captureHere({ start: true });
    if (cmd === 'gather-tag') gatherOntoPage(notebook.shownTag);
    if (cmd === 'tags') go({ view: 'tags' });
    if (cmd === 'week') go({ view: 'plan', tab: 'week' });
    if (cmd === 'when' || cmd === 'plan') go({ view: 'plan', tab: 'day' });
    if (cmd === 'calendar') plan.goTab('cal');
    if (cmd === 'ahead') go({ view: 'plan', tab: 'ahead' });
    if (cmd === 'desk') go({ view: 'desk' });
    if (cmd === 'desk-history') go({ view: 'desk', tab: 'history' });
    if (cmd === 'close-tag') { $('.tag-results').hidden = true; currentEditor().commands.focus(); }
  });
  document.addEventListener('keydown', (e) => {
    const m = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (paneKeys(e, m)) return;
    // Ctrl + K: the box; again while it's open and empty, All commands.
    if (m && !e.shiftKey && k === 'k') { e.preventDefault(); if ($('.palette').hidden) openBox({ find: true }); else if (boxOpen() && !box.all && !$('#palette-input').value) box.setAll(true); else closePalette(); }
    else if (m && e.shiftKey && !e.altKey && e.code === 'Period') { e.preventDefault(); if (writing() && isWoven()) steadyTitles(); else toggleSections(); }
    // Ctrl + Shift + Comma: the plan under every scene, open or folded.
    else if (m && e.shiftKey && !e.altKey && e.code === 'Comma' && writing() && activePlan()) { e.preventDefault(); activePlan().toggleAll(); }
    else if (m && !e.shiftKey && !e.altKey && e.code === 'Backslash') { e.preventDefault(); toggleBesidePane(); }
    // Alt + T: talk it through with Claude, beside where you are.
    else if (e.altKey && !m && !e.shiftKey && e.code === 'KeyT') { e.preventDefault(); openTalk(); }
    // Alt + Shift + T: everything left from earlier days onto today.
    else if (e.altKey && !m && e.shiftKey && e.code === 'KeyT') { e.preventDefault(); plan.bringToday(); }
    // Alt + L: Look (the Aa button), in text too.
    else if (e.altKey && !m && !e.shiftKey && e.code === 'KeyL') { e.preventDefault(); lookHere(); }
    // Alt + W: When (today, this week, next week, later…) for the line or lines here.
    else if (e.altKey && !m && !e.shiftKey && e.code === 'KeyW') { e.preventDefault(); whenHere(); }
    // Alt + Left / Right: Back and Forward, everywhere (in a line too), so a task
    // zoomed into from the plan zooms back out the way an outliner does.
    else if (e.altKey && !m && !e.shiftKey && !inPane && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); if (e.key === 'ArrowLeft') history.back(); else history.forward(); }
    else if (m && e.shiftKey && k === 'f') { e.preventDefault(); openPalette('search'); }
    else if (m && e.shiftKey && k === 'o') { e.preventDefault(); go({ view: 'library', area: null }); }
    else if (m && k === 'o') { e.preventDefault(); if (boxOpen()) closePalette(); else { if (!$('.palette').hidden) closePalette(false); openBox({ find: true }); } }
    else if (m && e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); step(e.key === 'ArrowDown' ? 1 : -1); }
    else if (m && !e.shiftKey && !e.altKey && e.code === 'BracketLeft') { e.preventDefault(); if (inPane) paneStep(-1); else history.back(); }
    else if (m && !e.shiftKey && !e.altKey && e.code === 'BracketRight') { e.preventDefault(); if (inPane) paneStep(1); else history.forward(); }
    else if (m && !e.altKey && e.code === 'Semicolon' && (writing() || inNotebook()) && currentEditor().isFocused) { e.preventDefault(); if (e.shiftKey) insertTime(currentEditor()); else insertDay(currentEditor(), 0); }
    else if (m && (e.key === '/' || e.code === 'Slash')) { e.preventDefault(); toggleShortcuts(); }
    else if (m && e.shiftKey && k === 'p') { e.preventDefault(); progressPanel.toggle(); }
    else if (m && e.shiftKey && k === 'j') { e.preventDefault(); todayPanel.toggle(); }
    else if (m && e.shiftKey && !e.altKey && k === 'u') { e.preventDefault(); go({ view: 'desk' }); }
    else if (m && k === 'j') { e.preventDefault(); toggleWriteToday(); }
    else if (m && k === '2' && writing()) { e.preventDefault(); toggleNotes(); }
    else if (((m && e.shiftKey) || (!isMac && e.altKey && !m && !e.shiftKey)) && e.code === 'KeyN' && writing()) { e.preventDefault(); notes.add(); }
    else if (e.altKey && e.shiftKey && !m && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && writing() && editor.isFocused) { e.preventDefault(); blocks.moveCurrent(e.key === 'ArrowUp' ? -1 : 1); }
    else if (m && e.shiftKey && k === 'e' && writing()) { e.preventDefault(); editor.commands.focus(); alts.toggle({ scope: 'word', focusAdd: true }); }
    else if (m && e.shiftKey && k === 'd' && writing() && editor.isFocused) { e.preventDefault(); newParagraphVersion(editor); }
    else if (e.altKey && !e.shiftKey && !m && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && writing() && editor.isFocused) { if (flip(editor, e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault(); }
    else if (m && e.shiftKey && k === 'h' && (writing() || inNotebook())) { e.preventDefault(); if (!$('.history').hidden) closeHistory(); else hstrip.toggle(); }
    else if (m && e.shiftKey && k === 'l') { e.preventDefault(); toggleTheme(); }
    else if (m && e.shiftKey && k === 'g') { e.preventDefault(); toggleGrid(); }
    else if (m && e.shiftKey && !e.altKey && k === 's') { e.preventDefault(); toggleProduction(); }
    else if (m && e.shiftKey && !e.altKey && k === 'y') { e.preventDefault(); toggleFreshEyes(); }
    else if (m && e.shiftKey && !e.altKey && k === 'x') { e.preventDefault(); toggleCompare(); }
    else if (m && !e.shiftKey && !e.altKey && k === 'p' && (writing() || view() === 'project' || view() === 'compare' || (inNotebook() && notebook.page?.kind === 'page'))) { e.preventDefault(); printCurrent(); }
    // Alt + 0 to 6: the pages (Overview, then Gather to Deliver).
    // Alt + G: Go to… a piece, page, look or step in the project you're in.
    else if (e.altKey && !m && !e.shiftKey && e.code === 'KeyG' && ['world', 'piece'].includes(strip.ctx?.scope)) { e.preventDefault(); openGoTo(); }
    else if (e.altKey && !m && !e.shiftKey && /^Digit[0-6]$/.test(e.code) && strip.byNumber(Number(e.code.slice(5)))) { e.preventDefault(); goPage(strip.byNumber(Number(e.code.slice(5)))); }
    // Alt+C: Capture, recording at once; Alt+C again keeps it.
    // Alt + C talks, and lands where you are (Alt + V, the old draft key, does the same).
    else if (e.altKey && !m && !e.shiftKey && (e.code === 'KeyC' || e.code === 'KeyV')) { e.preventDefault(); if (!capture.isOpen) captureHere({ start: true }); else if (capture.rec) capture.finish(); }
    else if (e.altKey && !m && e.code === 'BracketRight') { e.preventDefault(); setPage(currentWidth() + 40, currentSize()); }
    else if (e.altKey && !m && e.code === 'BracketLeft') { e.preventDefault(); setPage(currentWidth() - 40, currentSize()); }
    else if (e.altKey && !m && e.code === 'Equal') { e.preventDefault(); setPage(currentWidth(), currentSize() + 1); }
    else if (e.altKey && !m && e.code === 'Minus') { e.preventDefault(); setPage(currentWidth(), currentSize() - 1); }
    else if (e.key === 'Escape' && root.classList.contains('reading')) toggleReading();
    else if (e.key === 'Escape' && pull?.isOpen && !whenOpen() && $('.palette').hidden && !document.querySelector('.pop-menu') && !e.target.closest?.('input, textarea, [contenteditable="true"]') && pull.escape()) e.preventDefault();
    else if (e.key === 'Escape') {
      if (alts.isOpen) alts.close();
      if (!$('.page-settings').hidden) { $('.page-settings').hidden = true; currentEditor().commands.focus(); }
      if (!$('.history').hidden) closeHistory();
      if (!$('.tag-results').hidden) { $('.tag-results').hidden = true; currentEditor().commands.focus(); }
      if (!$('.versions').hidden) conflicts.close();
      if (!$('.shortcuts').hidden) toggleShortcuts();
      nav.close();
      if (progressPanel.isOpen) progressPanel.close();
      body.classList.remove('show-outline', 'show-top');
    }
  });
  // Save before the tab goes away.
  document.addEventListener('visibilitychange', () => { if (document.hidden) { store.close(editor.state.doc); notebook.close(); } });
  window.addEventListener('pagehide', () => { store.close(editor.state.doc); notebook.close(); });
}

export { boxOpen, closePalette, currentBook, currentBookId, filterPalette, menuSpot, moveLinePicker, openBox, openPalette, sendSelectionPicker, showClaudeKnows, showTidy, wireQuickInserts };
