// The command box (Ctrl + K) and go-to (Ctrl + O).
import { media } from '../device.js';
import { SECTION_NAMES } from '../schema.js';
import { keyLabel, showKeysForThisComputer } from '../keys.js';
import { flip, newParagraphVersion } from '../alts.js';
import { bySort } from '../order.js';
import { putEntries, children, getEntry, byKind } from '../db.js';
import { popMenu, askText, askScript, toast } from '../menu.js';
import { chapterMarkdown, bookMarkdown, download } from '../export.js';
import { toggleDone, toggleChecklist, lineChecks, toggleBox } from '../outline.js';
import { mb } from '../keep.js';
import { SPACE, spaceUsed, unsentFiles } from '../files.js';
import { vaultZip } from '../vault.js';
import { ELEMENTS, toFountain, fromFountain, fromOutline, looksLikeOutline } from '../script.js';
import { titleOf, dayId } from '../notebook.js';
import { newScene } from '../woven.js';
import { openAlerts } from '../alerts.js';
import { showSaveButton } from '../savebutton.js';
import { openPicker } from '../picker.js';
import { toggleLight } from '../frame.js';
import { addLine } from '../capture.js';
import { LISTS, listOf } from '../lists.js';
import { tabFor } from '../plan.js';
import { Box } from '../box.js';
import { describe } from '../commandinfo.js';
import { SHOWS } from '../shows.js';
import { dayWord, loadTasks, addTask } from '../tasks.js';
import { inPane, PANE_ID, host as paneHost, BESIDE_PLACES } from '../panes.js';
import { areas, books, bookType, hasManuscript, kindName, newBook, ago, worlds, newPiece } from '../library.js';
import { isoToday } from '../dates.js';
import { $, alts, body, editor, gone, inNotebook, insertSection, isScript, isWoven, notes, root, setElement, state, store, view } from '../main.js';
import { touch, typeHere } from './scriptbar.js';
import { currentEditor, notebook, toggleTypewriter } from './notebookview.js';
import { go, lastPlace, newPageHere, openBook, openEntry } from './routing.js';
import { applyRemote, conflicts, sync } from './syncwiring.js';
import { connectClaude, connectScribe, newAct, newChapter, openChapter, prepareShoot, sceneDetails, setWoven, toggleNumbering } from './manuscript.js';
import { KINDS, addPiece, areaMenu, bookMenu, chapterMenu, pageMenu, plural, refreshViews, setKind, worldMenu } from './tidying.js';
import { showNewBook } from './libraryview.js';
import { askClaudeNotes, newDraft, newDraftFrom, printCurrent, revisionPiece, toggleBeside, toggleCompare, toggleFreshEyes, toggleTalk } from './revising.js';
import { openShare } from './sharing.js';
import { toggleGrid, toggleProduction } from './productionwiring.js';
import { PAGE_NAMES, goCatchup, goPage, nav, projectOrder, railProjects, strip, todayPanel } from './workpages.js';
import { hstrip, openHistory } from './historyview.js';
import { currentSize, currentWidth, hidden, lookTab, progressPanel, setPage, setShown, step, toggleFocus, togglePageSettings, toggleReading, toggleSections, toggleShortcuts } from './pagesettings.js';
import { bringInOld, closePalette, currentBook, currentBookId, currentWorld, gatherTagHere, insertDay, insertTime, menuSpot, moveLinePicker, openPalette, pickFiles, sendSelectionPicker, showClaudeKnows, showTidy, showTrash, toggleNotes } from './quickinserts.js';
import { canAskServer, captureHere, dayReview, deskPage, fixSpeaker, flipPlan, fromRecordingFile, makeMeeting, meetingToAcro, openModes, plan, through, todayKey, writeLineOutAgain } from './talking.js';
import { connectCalendar, makeList, openBeside, openTalk, panes, pullFromProject, toggleBesidePane, whenHere } from './beside.js';
// The one box (box.js), made once the commands are listed.
let box = null;

// ---------- command menu (⌘K) and go-to (⌘O) ----------

const mod = '⌘'; // shown as Ctrl+ off a Mac, see keys.js

function toggleTheme() { toggleLight(); }

// Opens the Aa panel at the script's look.
function openLook() {
  if ($('.page-settings').hidden) togglePageSettings('text'); else lookTab('text');
  $('.woven-pick')?.scrollIntoView({ block: 'start' });
  $('.woven-pick .wv-preset.current')?.focus({ preventScroll: true });
}

// Opens the Aa panel at its font list, on the current font, so a font is picked, not guessed.
function openFontPicker() {
  if ($('.page-settings').hidden) togglePageSettings('text'); else lookTab('text');
  const pick = $('.font-pick');
  pick.scrollIntoView({ block: 'start' });
  (pick.querySelector('.font-list button.current') || pick.querySelector('.font-list button'))?.focus({ preventScroll: true });
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

// What a script calls its section levels, top down, in your own words.
async function nameSectionLevels() {
  const b = await getEntry(state.project.id);
  const now = b.fields?.sections || SECTION_NAMES.slice(0, 4);
  const got = await askText({ title: 'Section levels', body: 'Top level first, separated by commas. For example: Act, Sequence, Scene.', value: now.join(', '), ok: 'Save' });
  if (!got) return;
  const names = got.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 6);
  if (!names.length) return;
  const next = { ...b, fields: { ...b.fields, sections: names }, updated_at: Date.now() };
  await putEntries([next]);
  state.project = next;
  await store.close(editor.state.doc);
  const id = state.chapterId;
  state.chapterId = null;
  await openChapter(id);
}

// Bring in a script: a .fountain file, or Fountain pasted from an outliner.
// It becomes a new screenplay piece in the world you're in (or another, or a
// world of its own), sections nested as they were.
async function importFountain() {
  const here = state.worldId && (await getEntry(state.worldId));
  const others = (await worlds()).filter((w) => w.id !== here?.id).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  const places = [...(here && !gone(here) ? [[here.id, here.title || 'Untitled']] : []), ['', 'A new world of its own'], ...others.map((w) => [w.id, w.title || 'Untitled'])];
  const got = await askScript({ places });
  if (!got) return;
  const { title, lines } = looksLikeOutline(got.text) ? fromOutline(got.text) : fromFountain(got.text);
  if (!lines.length) { toast('That doesn’t look like a script: nothing came in.'); return; }
  const name = title || got.name || 'Untitled script';
  let book;
  if (got.into) book = await newPiece(got.into, 'screenplay', name, lines);
  else book = await newBook('screenplay', name, (await areas())[0]?.id || null, lines);
  await refreshViews();
  await openBook(book.id);
  const sections = lines.filter((l) => l.el === 'section').length;
  const scenes = lines.filter((l) => l.el === 'scene').length;
  toast(`“${name}” is in: ${plural(scenes, 'scene')}${sections ? `, ${plural(sections, 'section')}` : ''}`);
}

async function exportBook() {
  await store.close(editor.state.doc);
  download(`${state.project.title}.md`, await bookMarkdown(state.project, state.acts));
}

const writing = () => view() === 'write';
let commands; // set in wireCommands()

// Where you are, as the rooms commands say they fit (commandinfo.js).
function roomTags() {
  const v = view();
  if (v === 'plan') return ['plan', 'when', 'day'].includes(tabFor(lastPlace?.tab)) ? ['plan'] : ['calendar'];
  if (inNotebook() && notebook.page) return notebook.isDay ? ['today'] : ['page'];
  if (v === 'desk') return ['desk'];
  if (['library', 'drawer', 'tags'].includes(v)) return ['library'];
  if (writing()) return isScript() ? ['script', 'write'] : ['write'];
  if (['world', 'project', 'grid', 'production', 'deliver', 'stage'].includes(v)) return ['world'];
  return [];
}
// Every place to go, for typing in the box: projects, pieces, areas,
// chapters, pages and the last month of days, each saying what it is.
async function boxPlaces() {
  const [allAreas, allBooks, allWorlds, allPages] = await Promise.all([areas(), books(), worlds(), byKind('page')]);
  const out = [];
  const worldName = new Map(allWorlds.map((w) => [w.id, w.title || 'Untitled']));
  for (const w of await projectOrder()) out.push({ label: w.title || 'Untitled', what: 'project', run: () => go({ view: 'world', id: w.id }) });
  for (const b of allBooks.sort((a, c) => c.updated_at - a.updated_at)) {
    const w = worldName.get(b.parent_id);
    if (w === (b.title || 'Untitled') && allBooks.filter((x) => x.parent_id === b.parent_id).length === 1) continue;
    out.push({ label: b.title || 'Untitled', what: w ? `piece · ${w}` : kindName(b).toLowerCase(), run: () => go({ view: 'project', id: b.id }) });
  }
  for (const a of allAreas) out.push({ label: a.title, what: 'area', run: () => go({ view: 'library', area: a.id }) });
  const [allActs, allChapters] = await Promise.all([byKind('act'), byKind('chapter')]);
  const under = new Map();
  for (const r of [...allActs, ...allChapters]) (under.get(r.parent_id) || under.set(r.parent_id, []).get(r.parent_id)).push(r);
  const inOrder = (id) => (under.get(id) || []).sort(bySort);
  for (const b of allBooks.filter(hasManuscript)) {
    for (const act of inOrder(b.id)) if (act.kind === 'act') for (const ch of inOrder(act.id)) out.push({ label: ch.title || 'Untitled', what: `chapter · ${b.title || 'Untitled'}`, run: () => go({ view: 'write', chapterId: ch.id }) });
  }
  for (const p of allPages.filter((x) => !gone(x))) out.push({ label: p.title || 'Untitled page', what: worldName.get(p.parent_id) ? `page · ${worldName.get(p.parent_id)}` : 'page', run: () => go({ view: 'notebook', pageId: p.id }) });
  const days = (await byKind('day')).filter((d) => !d.deleted).sort((a, c) => (a.title < c.title ? 1 : -1)).slice(0, 30);
  for (const d of days) out.push({ label: titleOf(d), what: 'day', run: () => go({ view: 'notebook', pageId: d.id }) });
  return out;
}
// Every open task (from the task index), saying when and where it is.
async function boxTasks() {
  const today = isoToday();
  const list = (await loadTasks(today)).filter((i) => !i.row.fields?.done && i.mine);
  return list.map((i) => {
    const day = i.task.day ? (i.task.day < today ? 'from earlier' : dayWord(i.task.day, today).toLowerCase()) : '';
    return { label: i.row.text || 'Untitled task', what: ['task', day, i.world?.title].filter(Boolean).join(' · '), run: () => openEntry(i.row.id) };
  });
}
// The Desk's Catch-up lines, once the Desk has read them.
function boxCatchup() {
  const ups = deskPage?.data?.updates || [];
  const now = Date.now();
  return ups.slice(-60).reverse().map((u) => ({ label: u.text, what: `Catch-up · ${ago(u.at, now)}`, run: () => goCatchup() }));
}
// A task typed into the box: on its day (or week, month, later), like one
// typed into the plan. A toast offers Undo and Open it.
async function boxAddTask(title, choice) {
  if (!title.trim()) return;
  const when = choice?.when || { day: isoToday() };
  const day = when.day || null;
  const rows = await addTask({ text: title.trim(), day, span: when.span || null, order: plan?.lastOrder?.(day) ?? 0 });
  await applyRemote(rows);
  const line = rows.at(-1);
  const said = !day ? choice.label.toLowerCase() : day === isoToday() ? 'today' : dayWord(day, isoToday()) === 'Tomorrow' ? 'tomorrow' : new Date(`${day}T12:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  toast(`Task added for ${said}: “${title.trim()}”`, { label: 'Undo', run: async () => { const row = await getEntry(line.id); if (row) { const gone = { ...row, deleted: true, updated_at: Date.now() }; await putEntries([gone]); await applyRemote([gone]); } } }, { label: 'Open it', run: () => openEntry(line.id) });
}
// Shift + Enter in the box: the words as a line at the end of today's page.
async function boxAddLine(text) {
  if (!text.trim()) return;
  const { line, rows } = await addLine([{ type: 'text', text: text.trim() }], {});
  await applyRemote(rows);
  toast('Added to today’s page', { label: 'Undo', run: async () => { const row = await getEntry(line.id); if (row) { const gone = { ...row, deleted: true, updated_at: Date.now() }; await putEntries([gone]); await applyRemote([gone]); } } }, { label: 'Open it', run: () => openEntry(line.id) });
}

// The command menu opens on these, so the phone doesn't need a long scroll; typing searches everything.
async function showSpace() {
  const { bytes, count } = await spaceUsed();
  const { count: waiting } = await unsentFiles();
  toast(`Pictures and files: ${mb(bytes)} of ${mb(SPACE)} used · ${count === 1 ? '1 file' : `${count} files`}${waiting ? ` · ${waiting} still to upload from here` : ''}`);
}

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wireCommands() {
  showKeysForThisComputer();
  commands = [
    { group: 'go', label: 'Back to the last place', keys: '', words: ['recent', 'jump', 'switch'], run: () => nav.jumpBack(), when: () => nav.recent.length > 0 },
    { group: 'plan', label: 'Add a task', keys: `${mod}K`, run: () => setTimeout(() => openPalette('commands', null, 'Type the task, then Enter (a day at the end: fri, tomorrow, next week)'), 60) },
    { group: 'go', label: 'Search inside all your writing', keys: `${mod}⇧F`, run: () => openPalette('search') },
    { group: 'go', label: 'Library', keys: `${mod}⇧O`, run: () => go({ view: 'library', area: null }) },
    { group: 'go', label: 'Tags: every tag, grouped', keys: '', run: () => go({ view: 'tags' }) },
    { group: 'go', label: 'Catch-up: what your Claude threads did (bottom of the Desk)', keys: '', words: ['catch up', 'catch-up', 'catchup', 'threads', 'updates', 'claude'], run: () => goCatchup() },
    { group: 'go', label: 'Today: today’s page with its plan', keys: 'Alt+1', words: ['today', 'plan', 'day', 'tasks', 'page'], run: () => todayKey(1) },
    { group: 'go', label: 'Bring earlier days to today (every task left from before, onto today)', keys: 'Alt+Shift+T', words: ['carried', 'earlier', 'overdue', 'late', 'move', 'today', 'left over'], run: () => plan.bringToday() },
    { group: 'go', label: 'Plan: today, tomorrow, this week, next week, this month, later, not planned', keys: 'Alt+2', words: ['what’s when', 'whats when', 'when', 'planning', 'schedule', 'later', 'month', 'next week', 'loose', 'not planned', 'outline'], run: () => todayKey(2) },
    { group: 'go', label: 'Calendar: day (today’s hours)', keys: '', words: ['calendar', 'day', 'hours', 'time', 'schedule'], run: () => go({ view: 'plan', tab: 'calday' }) },
    { group: 'go', label: 'Calendar: week (seven days, and what’s for any day this week)', keys: '', words: ['calendar', 'week', 'plan', 'tasks', 'schedule', 'tray', 'any day'], run: () => go({ view: 'plan', tab: 'week' }) },
    { group: 'write', label: 'When: plan this line (today, this week, next week, later…)', keys: 'Alt+W', words: ['when', 'schedule', 'plan', 'day', 'week', 'month', 'later', 'task'], run: () => setTimeout(() => whenHere(), 60) },
    { group: 'go', label: 'From a project: open one next to the plan, to drag its steps in', keys: '', words: ['pull', 'project', 'beside', 'plan', 'drag', 'split', 'steps'], run: () => pullFromProject() },
    { group: 'go', label: 'Calendar: six weeks (a lane for each project)', keys: '', words: ['calendar', 'weeks ahead', 'ahead', 'six weeks', 'roadmap', 'weeks', 'months', 'dates', 'deadline', 'milestone', 'schedule', 'timeline', 'stretch'], run: () => go({ view: 'plan', tab: 'ahead' }) },
    { group: 'go', label: 'Calendar: pace (what you planned against what it really took)', keys: '', words: ['calendar', 'pace', 'plan', 'tasks', 'time', 'estimate', 'looking back', 'hours'], run: () => go({ view: 'plan', tab: 'pace' }), when: () => !hidden().has('estimates') },
    { group: 'go', label: 'Desk: every project, what needs you and who’s working on it', keys: `${mod}⇧U`, words: ['claude', 'threads', 'needs you', 'calls', 'catch-up', 'catchup', 'updates', 'projects', 'stage'], run: () => go({ view: 'desk' }) },
    { group: 'go', label: 'History: every Claude thread, newest first', keys: '', words: ['threads', 'closed', 'finished', 'desk', 'search threads'], run: () => go({ view: 'desk', tab: 'history' }) },
    { group: 'go', label: 'Today’s page', keys: `${mod}J`, run: () => go({ view: 'notebook', pageId: dayId(isoToday()) }) },
    { group: 'go', label: 'Side panel with today’s lines, beside what you’re doing', keys: `${mod}⇧J`, words: ['panel', 'side'], run: () => todayPanel.toggle() },
    { group: 'go', label: 'The Drawer: ideas with no home yet', keys: '', words: ['ideas', 'jackie chan'], run: () => go({ view: 'drawer' }) },
    ...['overview', 'gather', 'shape', 'write', 'revise', 'make', 'deliver', 'notes'].map((id, i) => ({ group: 'go', label: `Page: ${id === 'overview' ? 'Overview' : PAGE_NAMES[id]}`, keys: id === 'notes' ? '' : `⌥${i}`, words: ['tab', 'page'], run: () => goPage(id), when: () => strip.tabs.some((t) => t.id === id) })),
    { group: 'go', label: 'Back to writing', keys: `${mod}J`, run: () => go({ view: 'write' }), when: () => !writing() },
    { group: 'go', label: 'Next chapter (or day)', keys: `${mod}⌥↓`, run: () => step(1), when: () => writing() || inNotebook() },
    { group: 'go', label: 'Previous chapter (or day)', keys: `${mod}⌥↑`, run: () => step(-1), when: () => writing() || inNotebook() },
    { group: 'new', label: 'Capture an idea by voice (it lands where you are)', keys: '⌥C', words: ['dictate', 'voice', 'walk', 'speak', 'talk', 'draft'], run: () => captureHere() },
    { group: 'new', label: 'Capture from a recording file…', words: ['audio', 'voice memo', 'upload', 'draft'], run: () => fromRecordingFile() },
    { group: 'write', label: 'Your voice modes (shared with Scribe)…', words: ['journal', 'scene', 'idea', 'email', 'mode'], run: () => openModes() },
    { group: 'new', label: 'New novel', keys: '', run: () => showNewBook('novel') },
    { group: 'new', label: 'New screenplay', keys: '', run: () => showNewBook('screenplay') },
    { group: 'new', label: 'New notes collection', keys: '', run: () => showNewBook('notes') },
    { group: 'new', label: 'New show (seasons, episodes)', keys: '', words: ['series', 'tv', 'reels'], run: () => showNewBook('novel', 'show') },
    { group: 'new', label: 'New book series', keys: '', run: () => showNewBook('novel', 'series') },
    { group: 'new', label: 'New project: what are you making?', keys: '', words: ['world', 'universe', 'collection', 'life'], run: () => showNewBook('novel', 'one') },
    { group: 'new', label: 'Bring in a script (Fountain file or pasted text)…', keys: '', run: importFountain },
    { group: 'new', label: 'New page', keys: '', run: newPageHere },
    { group: 'new', label: 'New area', keys: '', run: () => go({ view: 'library' }).then(() => [...document.querySelectorAll('#lib-areas .chip.add')].at(-1)?.click()) },
    { group: 'new', label: 'New chapter', keys: '', run: () => go({ view: 'write' }).then(newChapter), when: () => !!state.project },
    { group: 'new', label: 'New act', keys: '', run: () => go({ view: 'write' }).then(newAct), when: () => !!state.project },
    { group: 'write', label: 'Zoom into this line', keys: 'click its handle', run: () => notebook.zoomTo(notebook.currentLine()), when: inNotebook },
    { group: 'write', label: 'Zoom out', keys: 'Esc', run: () => notebook.zoomTo(null), when: () => inNotebook() && !!notebook.zoom },
    { group: 'write', label: 'Fold or unfold this line', keys: `${mod}↑ ${mod}↓`, run: () => notebook.toggleFold(), when: inNotebook },
    ...ELEMENTS.map((x) => ({ group: 'write', label: `Script: ${x.label}`, keys: 'Tab', run: () => setElement(x.id), when: () => writing() && isScript() && !(x.id === 'scene' && isWoven()) })),
    { group: 'write', label: 'Script view: Woven (flowing, scene headings hidden)', keys: '', words: ['woven', 'flowing', 'prose', 'quiet', 'view'], run: () => setWoven(true), when: () => writing() && isScript() && !isWoven() },
    { group: 'write', label: 'Script view: Classic (the standard screenplay page)', keys: '', words: ['woven', 'classic', 'standard', 'view', 'courier'], run: () => setWoven(false), when: () => writing() && isWoven() },
    { group: 'write', label: 'Woven: new scene here', keys: `${mod}⇧↵`, words: ['scene', 'cut', 'line', 'break'], run: () => { editor.commands.focus(); newScene(editor); }, when: () => writing() && isWoven() },
    { group: 'write', label: 'Woven: this scene’s place, time and title…', keys: '/scene', words: ['scene', 'place', 'time', 'slug', 'heading', 'title'], run: sceneDetails, when: () => writing() && isWoven() },
    { group: 'write', label: 'Woven: prepare for shoot (fill in every scene’s place and time)', keys: '', words: ['shoot', 'production', 'slug', 'headings', 'breakdown', 'claude'], run: prepareShoot, when: () => writing() && isWoven() },
    { group: 'view', label: 'Woven: this script’s look (line, names, title font)…', keys: '', words: ['look', 'genre', 'style', 'font', 'colour', 'color', 'kung fu'], run: openLook, when: () => writing() && isWoven() },
    { group: 'write', label: 'Script: Section (your own heading)', keys: '# ', run: () => { insertSection(editor.state.selection.$from.before(1)); }, when: () => writing() && isScript() },
    { group: 'write', label: 'Insert the time', keys: `${mod}⇧;`, run: () => insertTime(currentEditor()), when: () => writing() || inNotebook() },
    { group: 'write', label: 'Insert today’s date', keys: `${mod};`, run: () => insertDay(currentEditor(), 0), when: () => writing() || inNotebook() },
    { group: 'write', label: 'Insert something (time, date, link…)', keys: '/', run: () => typeHere(currentEditor(), '/'), when: () => writing() || inNotebook() },
    { group: 'write', label: 'Link to a page…', keys: '[[', run: () => openPicker(currentEditor()), when: () => writing() || inNotebook() },
    { group: 'write', label: 'Add a note to this paragraph', keys: `${mod}⇧N`, run: () => notes.add(), when: writing },
    { group: 'write', label: 'Alternates for this word (or the selection)', keys: `${mod}⇧E`, run: () => alts.open({ scope: 'word', focusAdd: true }), when: writing },
    { group: 'write', label: 'Versions of this paragraph', keys: '', run: () => alts.open({ scope: 'para' }), when: writing },
    { group: 'write', label: 'New version of this paragraph to rewrite', keys: `${mod}⇧D`, run: () => newParagraphVersion(editor), when: writing },
    { group: 'write', label: 'Next alternate (word, or else paragraph)', keys: '⌥↓', run: () => flip(editor, 1), when: writing },
    { group: 'write', label: 'Previous alternate', keys: '⌥↑', run: () => flip(editor, -1), when: writing },
    { group: 'write', label: 'Scene break', keys: `${mod}⇧↵`, run: () => editor.chain().focus().insertSceneBreak().run(), when: writing },
    { group: 'write', label: 'History: drag back through earlier versions of this chapter or page', keys: `${mod}⇧H`, words: ['versions', 'earlier', 'undo', 'go back', 'restore', 'scrub', 'timeline'], run: () => hstrip.toggle(), when: () => writing() || (inNotebook() && !!notebook.page) },
    { group: 'write', label: 'History as a list, and what was deleted (this chapter or page)', keys: '', words: ['deleted', 'versions', 'bring back'], run: () => openHistory(), when: () => writing() || (inNotebook() && !!notebook.page) },
    { group: 'write', label: 'Note categories: add, rename, recolour', keys: '', run: () => notes.editTypes() },
    { group: 'view', label: 'Sidebar (keep open)', keys: `${mod}1`, run: () => body.classList.toggle('pin-outline') },
    { group: 'view', label: 'Plan beside the page, or on top in one column', keys: 'Alt+P', words: ['plan', 'side', 'column', 'top', 'layout', 'flip'], run: () => flipPlan(), when: () => !touch.matches },
    { group: 'view', label: 'Notes beside the text', keys: `${mod}2`, run: () => toggleNotes(), when: writing },
    { group: 'view', label: 'Read it through: just the script pages', keys: 'Esc to stop', run: toggleReading, when: () => writing() && isScript() },
    { group: 'view', label: 'Focus: just the text (on / off)', keys: `${mod}.`, run: toggleFocus },
    { group: 'view', label: 'Typewriter mode: the line you’re on stays put', words: ['scroll', 'center', 'middle'], run: () => toggleTypewriter() },
    { group: 'view', label: 'Show or hide earlier days (under the day page)', keys: '', run: () => notebook.togglePastDays(), when: () => inNotebook() && notebook.isDay },
    { group: 'view', label: 'Show or hide "Linked from"', keys: '', run: () => setShown('links', hidden().has('links')) },
    { group: 'view', label: 'Show or hide alternate marks', keys: '', run: () => setShown('alts', hidden().has('alts')) },
    { group: 'plan', label: 'Hide done tasks (or show them again, where they were)', keys: '', run: () => { const show = hidden().has('donetasks'); setShown('donetasks', show); toast(show ? 'Done tasks show again, where they were' : 'Done tasks are out of sight (tap “N done” to see them)'); } },
    { group: 'view', label: 'Show or hide pictures on shared links', keys: '', run: () => setShown('linkpics', hidden().has('linkpics')) },
    { group: 'view', label: 'Progress: words and pages over time (stats)', keys: `${mod}⇧P`, run: () => progressPanel.open() },
    { group: 'write', label: 'Move this line to another page or day…', keys: '', run: moveLinePicker, when: inNotebook },
    { group: 'write', label: 'Gather a #tag onto this page…', keys: '', run: gatherTagHere, when: inNotebook },
    { group: 'write', label: 'Bring back gathered lines I deleted', keys: '', run: () => notebook.regather(), when: () => inNotebook() && !!notebook.gatherLine() },
    { group: 'write', label: 'Stop gathering on this line', keys: '', run: () => notebook.stopGather(), when: () => inNotebook() && !!notebook.gatherLine() },
    { group: 'write', label: 'Task: put this line on a day’s plan (again: a plain line)', keys: `${mod}⇧↵`, words: ['todo', 'to-do', 'plan', 'schedule', 'today'], run: () => notebook.toggleTask(), when: inNotebook },
    { group: 'go', label: 'Go through loose lines: the last week’s unfiled lines, one at a time', words: ['sort', 'file', 'loose', 'triage', 'review', 'inbox', 'tidy'], run: () => through.open('loose') },
    { group: 'go', label: 'Go through the tasks left from earlier days: keep, not today, or delete', words: ['carried', 'overdue', 'old tasks', 'pile', 'triage', 'clear'], run: () => through.open('carried') },
    { group: 'go', label: 'Go through what needs you: the Desk’s calls, one at a time', words: ['calls', 'needs you', 'decide', 'desk', 'triage', 'waiting'], run: () => through.open('calls') },
    { group: 'write', label: 'Done: strike this line through', keys: `${mod}↵`, run: () => toggleDone(notebook.editor), when: inNotebook },
    { group: 'write', label: 'Checklist: tick boxes on the lines under this one', keys: '', words: ['todo', 'to-do', 'list', 'checkbox', 'tick'], run: () => toggleChecklist(notebook.editor), when: () => inNotebook() && !lineChecks(notebook.editor.state)?.checklist },
    { group: 'write', label: 'Not a checklist (take the boxes off the lines under this one)', keys: '', words: ['checklist', 'checkbox'], run: () => toggleChecklist(notebook.editor), when: () => inNotebook() && !!lineChecks(notebook.editor.state)?.checklist },
    { group: 'write', label: 'Box on this line (tick it when done; or type [ ] at the start)', keys: '', words: ['checkbox', 'todo', 'to-do', 'tick'], run: () => toggleBox(notebook.editor), when: () => inNotebook() && lineChecks(notebook.editor.state) && !lineChecks(notebook.editor.state).box },
    { group: 'write', label: 'No box on this line (a note, not a thing to do)', keys: '', words: ['checkbox', 'tick'], run: () => toggleBox(notebook.editor), when: () => inNotebook() && !!lineChecks(notebook.editor.state)?.box },
    { group: 'view', label: 'Keyboard shortcuts (all the keys)', keys: `${mod}/`, run: toggleShortcuts },
    { group: 'page', label: 'Look, page and text settings (Aa)', keys: '', words: ['look', 'looks', 'theme', 'themes', 'colour', 'colours', 'color', 'colors', 'dark', 'light', 'appearance', 'aa', 'settings', 'midnight', 'lamplight', 'ember', 'candle', 'night shift', 'graphite', 'typewriter', 'paper', 'motion', 'text size', 'font'], run: togglePageSettings },
    { group: 'page', label: 'Wider page', keys: 'Alt+]', run: () => setPage(currentWidth() + 40, currentSize()) },
    { group: 'page', label: 'Narrower page', keys: 'Alt+[', run: () => setPage(currentWidth() - 40, currentSize()) },
    { group: 'page', label: 'Larger text', keys: 'Alt+=', run: () => setPage(currentWidth(), currentSize() + 1) },
    { group: 'page', label: 'Smaller text', keys: 'Alt+−', run: () => setPage(currentWidth(), currentSize() - 1) },
    { group: 'page', label: 'Light / dark', keys: `${mod}⇧L`, run: toggleTheme },
    { group: 'page', label: 'Change the writing font', keys: '', words: ['typeface', 'mono', 'serif'], run: () => setTimeout(openFontPicker, 60) },
    { group: 'sync', label: 'Sync now', keys: '', run: () => sync.soon(0), when: () => !!sync.user },
    { group: 'sync', label: 'Sign in to sync between devices', keys: '', run: () => sync.signIn(), when: () => sync.available && !sync.user },
    { group: 'sync', label: 'Sign out of sync', keys: '', run: () => sync.signOut(), when: () => !!sync.user },
    { group: 'sync', label: 'Export this chapter as Markdown', keys: '', run: exportChapter, when: () => writing() && !isScript() },
    { group: 'sync', label: 'Export the whole book as Markdown', keys: '', run: exportBook, when: () => writing() && !!state.project && !isScript() },
    { group: 'sync', label: 'Export this script as Fountain', keys: '', run: exportFountain, when: () => writing() && isScript() },
    { group: 'sync', label: 'Back up everything (download all as files)', keys: '', run: exportVault },
    { group: 'sync', label: 'Pictures and files: space used', keys: '', run: showSpace },
    { group: 'write', label: 'Add a picture or file…', keys: '', run: () => setTimeout(pickFiles, 120), when: () => writing() || inNotebook() },
    { group: 'tidy', label: 'Send selection to… a chapter, page or day', keys: '', run: () => setTimeout(sendSelectionPicker, 120), when: () => writing() || inNotebook() },
    { group: 'tidy', label: 'This piece: rename, label, stage, move or trash…', keys: '', run: async () => popMenu(null, await bookMenu(await currentBook()), menuSpot()), when: () => !!currentBookId() },
    { group: 'tidy', label: 'This world: rename, move to an area or trash…', keys: '', run: async () => popMenu(null, await worldMenu(await currentWorld()), menuSpot()), when: () => !!state.worldId && (view() === 'world' || !!currentBookId() || inNotebook()) },
    { group: 'tidy', label: 'Change how this piece is written (prose, script, outline)…', keys: '', run: async () => { const b = await currentBook(); popMenu(null, KINDS.map(([id, label]) => ({ label, current: bookType(b) === id, run: () => setKind(b, id) })), menuSpot()); }, when: () => !!currentBookId() },
    { group: 'new', label: 'New piece in this world (a gag, an episode, a season…)', keys: '', run: async () => { const w = await currentWorld(); if (w) addPiece(w.id); }, when: () => !!state.worldId },
    { group: 'write', label: 'Number the scenes (for production)…', keys: '', run: async () => { const b = await currentBook(); if (!b.fields?.numbered) toggleNumbering(b); }, when: () => writing() && isScript() && !state.project?.fields?.numbered },
    { group: 'write', label: 'Scene numbers: turn off', keys: '', run: async () => toggleNumbering(await currentBook()), when: () => writing() && isScript() && !!state.project?.fields?.numbered },
    { group: 'view', label: 'Show or hide scene numbers', keys: '', run: () => setShown('codes', hidden().has('codes')), when: () => writing() && isScript() },
    { group: 'view', label: 'Plot grid (the story as a table)', keys: `${mod}⇧G`, run: toggleGrid, when: () => view() !== 'grid' && view() !== 'library' },
    { group: 'view', label: 'Back to the text from the grid', keys: `${mod}⇧G`, run: toggleGrid, when: () => view() === 'grid' },
    { group: 'view', label: 'Production (shots, kit, shoot days, posting)', keys: `${mod}⇧S`, run: toggleProduction, when: () => view() !== 'production' && view() !== 'library' },
    { group: 'view', label: 'Back to the text from production', keys: `${mod}⇧S`, run: toggleProduction, when: () => view() === 'production' },
    { group: 'view', label: 'Show or hide section titles', keys: '⌘⇧.', run: () => toggleSections(), when: () => writing() && isScript() },
    { group: 'view', label: 'Fresh eyes: a new font, page and colour, to reread it cold', keys: `${mod}⇧Y`, words: ['reread', 'revise', 'unfamiliar'], run: () => toggleFreshEyes() },
    { group: 'view', label: 'Show or hide Claude’s notes in the margin', keys: '', run: () => setShown('claude', hidden().has('claude')) },
    { group: 'view', label: 'Show or hide readers’ comments in the margin', keys: '', run: () => setShown('comments', hidden().has('comments')) },
    { group: 'revise', label: 'Compare drafts, or the text then and now', keys: `${mod}⇧X`, words: ['diff', 'versions', 'changes'], run: toggleCompare, when: () => view() !== 'compare' },
    { group: 'revise', label: 'Back to the text from comparing', keys: `${mod}⇧X`, run: toggleCompare, when: () => view() === 'compare' },
    { group: 'revise', label: 'Read an earlier draft beside this one', keys: `${mod}⇧B`, words: ['side by side', 'old draft'], run: toggleBeside, when: writing },
    { group: 'revise', label: 'New draft from this one: keep a copy of this draft and carry on…', keys: '', words: ['save draft', 'version', 'draft 2', 'snapshot'], run: async () => { const b = await revisionPiece(); if (b) newDraftFrom(b); }, when: () => !!currentBookId() },
    { group: 'revise', label: 'Start a new draft from scratch (the old one is kept whole)…', keys: '', words: ['rewrite', 'draft 2'], run: async () => { const b = await revisionPiece(); if (b) newDraft(b); }, when: () => !!currentBookId() },
    { group: 'revise', label: 'Claude’s notes on this chapter (margin notes and a fix list)', keys: '', words: ['feedback', 'editor', 'critique'], run: askClaudeNotes, when: writing },
    { group: 'revise', label: 'Talk this chapter over with Claude', keys: '', words: ['chat', 'conversation', 'feedback'], run: toggleTalk, when: writing },
    { group: 'revise', label: 'Print, or save as PDF (manuscript or screenplay format)', keys: `${mod}P`, words: ['pdf', 'export'], run: printCurrent, when: () => writing() || view() === 'project' || view() === 'compare' || (inNotebook() && notebook.page?.kind === 'page') },
    { group: 'revise', label: 'Share a link to read and comment…', keys: '', words: ['share', 'feedback', 'reader', 'link'], run: () => openShare(), when: () => !!currentBookId() || (inNotebook() && notebook.page?.kind === 'page') },
    { group: 'page', label: 'Name the section levels (Act, Sequence, Scene…)', keys: '', run: nameSectionLevels, when: () => writing() && isScript() },
    { group: 'sync', label: 'Connect Claude to Inkwell (a connector address)…', keys: '', run: () => connectClaude() },
    { group: 'sync', label: 'Phone alerts (day review, Needs you, your week and month)…', keys: '', run: () => openAlerts({ backend: sync.backend, signedIn: !!sync.user, toast }) },
    { group: 'sync', label: 'Google Calendar: show your events on Today and the week…', keys: '', words: ['calendar', 'google', 'connect', 'events'], run: () => connectCalendar() },
    { group: 'view', label: 'What Claude knows: its one-line note on this, and weekly summaries', keys: '', words: ['about', 'summary', 'second brain', 'memory', 'digest', 'weekly'], run: () => showClaudeKnows() },
    { group: 'view', label: 'Beside: today’s plan next to this page (again: put it away)', keys: `${mod}\\`, words: ['pane', 'side by side', 'split', 'beside', 'plan', 'tasks', 'today'], when: () => !!paneHost() && !root.classList.contains('hide-panes'), run: () => toggleBesidePane() },
    { group: 'view', label: 'Talk it through with Claude, beside where you are', keys: '⌥T', words: ['claude', 'talk', 'think', 'plan', 'week', 'moves', 'ask', 'beside', 'overwhelmed', 'too much'], when: () => !!paneHost() && !root.classList.contains('hide-panes'), run: () => openTalk() },
    { group: 'view', label: 'In the Beside pane: this draft’s notes, listed next to it', words: ['pane', 'side by side', 'beside', 'notes', 'margin', 'comments'], when: () => !inPane && !!panes && writing() && !root.classList.contains('hide-panes'), run: () => openBeside(BESIDE_PLACES.notes) },
    { group: 'view', label: 'Open where you are in a pane beside (middle-click opens anything beside)', words: ['pane', 'side by side', 'split', 'beside', 'two', 'compare'], when: () => !!paneHost() && !root.classList.contains('hide-panes'), run: () => openBeside(lastPlace) },
    { group: 'view', label: 'Show the panes beside', words: ['pane', 'peek', 'side by side'], when: () => !!panes?.count && panes.sheet && !panes.sheetOpen, run: () => panes.showSheet() },
    { group: 'view', label: 'Close the pane you’re in', keys: `${mod}⌥W`, words: ['pane', 'side by side', 'close'], when: () => inPane, run: () => paneHost()?.close(PANE_ID) },
    { group: 'view', label: 'Close all the panes beside', words: ['pane', 'side by side', 'close'], when: () => !!panes?.count, run: () => panes.closeAll() },
    { group: 'new', label: 'Save links from your browser (Save to Inkwell button)…', keys: '', words: ['bookmark', 'bookmarklet', 'share', 'save link', 'twitter', 'x', 'web page', 'computer', 'desktop'], run: () => showSaveButton(), when: () => !media('finger').matches },
    { group: 'new', label: 'Bring in old notes (from Thymer, Tana, Workflowy, OneNote)…', keys: '', words: ['import', 'paste', 'opml', 'markdown', 'migrate', 'old apps'], run: () => bringInOld() },
    { group: 'sync', label: 'Connect Scribe, the dictation keyboard…', keys: '', run: () => connectScribe() },
    { group: 'tidy', label: 'This chapter: rename, move or trash…', keys: '', run: async () => popMenu(null, await chapterMenu({ id: state.chapterId }), menuSpot()), when: () => writing() && !!state.chapterId },
    ...Object.entries(LISTS).map(([list, name]) => ({ group: 'page', label: `Make this page a ${name.toLowerCase()} (Claude links each title)`, keys: '', run: () => makeList(list), when: () => inNotebook() && notebook.page?.kind === 'page' && listOf(notebook.page) !== list })),
    { group: 'tidy', label: 'Review the day with Claude (what to plan, what to keep thinking about)', keys: '', run: () => dayReview.run(), when: () => inNotebook() && notebook.isDay },
    { group: 'new', label: 'Make meeting notes from a recording (summary, decisions, tasks, who said what)…', keys: '', run: () => setTimeout(makeMeeting, 120) },
    { group: 'tidy', label: 'Send this meeting to Acro HQ (summary and tasks, for you and Nate)', keys: '', run: () => setTimeout(meetingToAcro, 120), when: () => inNotebook() && !!notebook.page?.fields?.meeting && canAskServer() },
    { group: 'tidy', label: 'Fix a speaker’s name in this meeting…', keys: '', run: () => setTimeout(fixSpeaker, 120), when: () => inNotebook() && !!notebook.page?.fields?.meeting },
    { group: 'tidy', label: 'Write out this recording again', keys: '', words: ['transcribe', 'voice', 'retry', 'audio'], run: writeLineOutAgain, when: () => inNotebook() && !!notebook.currentLine() && canAskServer() },
    { group: 'page', label: 'Stop Claude linking titles on this page', keys: '', run: () => makeList(null), when: () => inNotebook() && !!listOf(notebook.page) },
    { group: 'tidy', label: 'This page: rename, move to a world or trash…', keys: '', run: async () => popMenu(null, await pageMenu(notebook.page), menuSpot()), when: () => inNotebook() && notebook.page?.kind === 'page' },
    { group: 'tidy', label: 'This area: rename, move or trash…', keys: '', run: async () => popMenu(null, await areaMenu({ id: state.libArea }), menuSpot()), when: () => view() === 'library' && !!state.libArea },
    { group: 'tidy', label: 'Tidy pass: Claude’s suggested tidy-ups, and what it changed', keys: '', words: ['tidy', 'clean up', 'merge', 'duplicates', 'undo claude', 'claude changes', 'suggestions'], run: () => setTimeout(showTidy, 120) },
    { group: 'tidy', label: 'Trash: bring things back', keys: '', run: showTrash },
    { group: 'sync', label: 'Two versions to check', urgent: true, keys: '', run: () => conflicts.open(), when: () => !$('#versions').hidden }
  ];
  // Each one's group, its one line, more words that find it, the rooms it fits
  // and why it can't run (commandinfo.js).
  // The "Show or hide …" commands come from the same list as the Show tab
  // (shows.js); the ones written above by hand keep their own.
  for (const sh of SHOWS) {
    if (!sh.cmd || commands.some((c) => c.label === sh.cmd)) continue;
    commands.push({ group: 'view', label: sh.cmd, keys: sh.keys || '', hint: sh.hint, words: sh.words, run: () => { setShown(sh.id, hidden().has(sh.id)); toast(`${sh.label}: ${hidden().has(sh.id) ? 'off' : 'on'}`); }, when: sh.phone ? () => touch.matches : undefined, needs: sh.phone ? 'On a phone only' : undefined });
  }
  commands.forEach(describe);
  // For the tests: every command as the box lists it.
  window.__commandList = () => commands.map((c) => ({ label: c.label, group: c.group, hint: c.hint, words: c.words, where: c.where || [], needs: c.needs || '' }));
  box = new Box($('.palette'), {
    commands: () => commands,
    usable: (c) => !c.when || c.when(),
    recent: () => nav.recent,
    jump: (place) => go(place),
    rooms: () => {
      const v = view();
      const active = strip.ctx?.active || null;
      const inside = strip.tabs.some((t) => t.n != null);
      const on = (id) => !inside && (active === id || (id === 'library' && v === 'library') || (id === 'drawer' && v === 'drawer') || (id === 'tags' && v === 'tags') || (id === 'desk' && v === 'desk'));
      const all = [['today', 'Today', '⌘J'], ['desk', 'Desk', '⌘⇧U'], ['library', 'Library', '⌘⇧O'], ['drawer', 'Drawer', ''], ['tags', 'Tags', ''], ['catchup', 'Catch-up', '']];
      // The phone's bottom bar has Today, Desk and Library already.
      const list = touch.matches ? all.filter(([id]) => !['today', 'desk', 'library'].includes(id)) : all;
      const out = list.map(([id, label, keys]) => ({ id, label, keys: keyLabel(keys), on: on(id) }));
      if (touch.matches) out.push({ id: 'outline', label: 'Outline', quiet: true });
      return out;
    },
    room: (id) => {
      if (id === 'look') { if ($('.page-settings').hidden) togglePageSettings(); $('.page-settings').scrollTop = 0; return; }
      if (id === 'outline') { body.classList.add('show-outline'); return; }
      return goPage(id);
    },
    tabs: () => {
      if (!strip.tabs.some((t) => t.n != null)) return null;
      const active = strip.ctx?.active || null;
      return { title: nav.titleOfOwner(), tabs: strip.tabs.map((t) => ({ label: t.label, keys: t.n != null ? keyLabel(`⌥${t.n}`) : '', on: t.id === active, run: () => goPage(t.id) })) };
    },
    here: () => roomTags(),
    projects: () => railProjects(),
    openProject: (id) => go({ view: 'world', id }),
    places: () => boxPlaces(),
    tasks: () => boxTasks(),
    catchup: () => boxCatchup(),
    addTask: (title, choice) => boxAddTask(title, choice),
    addLine: (text) => boxAddLine(text),
    search: (text) => openPalette('search', text),
    runCommand: (c) => c.run(),
    focusOn: () => root.classList.contains('focus'),
    toggleFocus: () => { toggleFocus(); toast(root.classList.contains('focus') ? 'Focus on' : 'Focus off'); },
    look: () => { if ($('.page-settings').hidden) togglePageSettings(); },
    close: (refocus = true) => closePalette(refocus),
    isTouch: () => touch.matches,
    keyLabel: (t) => keyLabel(t),
    toast: (t) => toast(t)
  });
}

export { box, commands, mod, roomTags, toggleTheme, wireCommands, writing };
