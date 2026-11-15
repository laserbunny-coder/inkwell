import './keyboard.js';
import { media } from './device.js';
import './style.css';
import './frame.css';
import './desk.css';
import './plan.css';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EntryIds, SceneBreak, sectionName, SECTION_NAMES } from './schema.js';
import { isMac, keyLabel, showKeysForThisComputer } from './keys.js';
import './stats.js';
import { AltMark, ParagraphVersions, AltPanel, flip, newParagraphVersion } from './alts.js';
import { ChapterStore } from './chapter.js';
import { NotesLayer } from './notes.js';
import { BlockHandle } from './blocks.js';
import { bySort } from './order.js';
import { getMeta, setMeta, putEntries, children, getEntry, byKind, forgetDeleted, isTrashed } from './db.js';
import './trash.js';
import { searchIndex } from './search.js';
import { tidyHistory } from './history.js';
import './stageedit.js';
import { popMenu, ask, askText, askScript, showCopy, toast } from './menu.js';
import './sync.js';
import { hasWriting, entry, noteTypes } from './model.js';
import { chapterMarkdown, bookMarkdown, download } from './export.js';
import { EntryRef, TagMarks } from './outline.js';
import './links.js';
import { keepStorage, mb } from './keep.js';
import { moveEntries } from './move.js';
import './conflicts.js';
import { FileEmbed, insertFiles } from './filenode.js';
import { MAX_BYTES, SPACE, spaceUsed, unsentFiles } from './files.js';
import { vaultZip, pageMarkdown } from './vault.js';
import { ScriptElements, ELEMENTS, elementLabel, toFountain, fromFountain, fromOutline, looksLikeOutline, SceneCodes } from './script.js';
import { titleOf, dayId } from './notebook.js';
import { toggleDone, toggleChecklist, toggleBox, lineChecks, setLineDragOut, dropLineAt } from './outline.js';
import { SlashMenu, setSlashItems, slashOpen } from './slash.js';
import { Woven, newScene, placeList } from './woven.js';
import './wovenlook.js';
import './production.js';
import './handlemenu.js';
import { openAlerts } from './alerts.js';
import { showSaveButton } from './savebutton.js';
import { openPicker } from './picker.js';
import './grid.js';
import { taskHint } from './pages.js';
import './nav.js';
import { startLook, toggleLight } from './frame.js';
import './stages.js';
import { CaptureScreen, writeOutPending, recoverRecording, writeOutAgain, requeueBlank, addLine } from './capture.js';
import { onVoiceChip, switchVoice, voiceText, voiceInfo, knownModes, fetchModes, placeDraft, placeVoice, placeScribeWaiting, RAW } from './voice.js';
import { takeShares, snapshotPending, tidyShareBlanks, keepShare } from './share.js';
import { SAVE_CHANNEL } from './inbox.js';
import { LISTS, listOf, setList, fillList } from './lists.js';
import { meetingPending, addMeetingFile, meetingFromLine, audioOn, renameSpeaker, speakersOn, mine, sendMeetingToAcro } from './meeting.js';
import { DayReview, getReview } from './review.js';
import { TagsPage, tagIndex, statsOf } from './tags.js';
import { DeskPage } from './desk.js';
import { ProjectPage } from './projectpage.js';
import { Plan, tabFor, isCal } from './plan.js';
import { Pull } from './pull.js';
import { whenOpen } from './when.js';
import { Box } from './box.js';
import { describe } from './commandinfo.js';
import { SHOWS } from './shows.js';
import { Through } from './through.js';
import { looseOn } from './loose.js';
import { dayWord, loadTasks, addTask, stepsHome } from './tasks.js';
import { setFont } from './fonts.js';
import './drafts.js';
import './compare.js';
import { inPane, PANE_ID, PaneHost, host as paneHost, BESIDE_PLACES } from './panes.js';
import { SideNotes } from './sidenotes.js';
import { Talk } from './talk.js';
import './hstrip.js';
import './hstrip.css';
import { aheadSource } from './ahead.js';
import { events as calendarEvents, forgetCalendar } from './calendar.js';
import './claudenotes.js';
import { openClaudeKnows } from './claudeknows.js';
import { openTidy, counts as tidyCounts } from './tidypass.js';
import './sharelink.js';
import { ensureAreas, areas, books, bookType, hasManuscript, kindName, areaColor, newBook, pagesIn, bookOf, newPage, ago, worlds, worldOf, newPiece, setOwnWorkflows } from './library.js';
import './dom.js';
import { isoOf, isoToday } from './dates.js';
import { touch, typeHere, wireScriptBar } from './app/scriptbar.js';
import { currentEditor, notebook, toggleTypewriter, wireNotebook } from './app/notebookview.js';
import { besideUntil, go, historyMode, lastChapterAnywhere, lastPlace, newPageHere, openBook, openEntry, paneStep, phoneAway, placeOf, setBesideUntil, setHistoryMode, wireRouting } from './app/routing.js';
import { applyRemote, caretAfter, conflicts, migrateOnce, seedIfEmpty, seedNow, setCaretAfter, sync, wireSync } from './app/syncwiring.js';
import { biblePlaces, connectClaude, connectScribe, markScene, newAct, newChapter, numbering, openChapter, prepareShoot, refreshWords, sceneDetails, scenePop, setWoven, toggleNumbering, wireManuscript } from './app/manuscript.js';
import { renderCrumb, scheduleScenes, wireRail } from './app/rail.js';
import { KINDS, addPiece, areaMenu, bookMenu, chapterMenu, pageMenu, plural, refreshViews, setKind, setLife, worldMenu } from './app/tidying.js';
import { nextDate, renderWorld, showNewBook, wireLibraryView } from './app/libraryview.js';
import { askClaudeNotes, newDraft, newDraftFrom, printCurrent, revisionPiece, toggleBeside, toggleCompare, toggleFreshEyes, toggleTalk, wireRevising } from './app/revising.js';
import { openShare, warmRooms, wireSharing } from './app/sharing.js';
import { toggleGrid, toggleProduction } from './app/productionwiring.js';
import { PAGE_NAMES, frame, goCatchup, goPage, nav, projectOrder, railProjects, strip, todayPanel, wireWorkPages } from './app/workpages.js';
import { closeHistory, hstrip, openHistory, wireHistory } from './app/historyview.js';
import { currentSize, currentWidth, hidden, lookTab, progressPanel, setPage, setShown, step, toggleFocus, togglePageSettings, toggleReading, toggleSections, toggleShortcuts, wirePageSettings } from './app/pagesettings.js';

const $ = (s) => document.querySelector(s);
const body = document.body;
const root = document.documentElement;
// Inside a pane beside the main window (panes.js): just the view, no chrome.
if (inPane) root.classList.add('in-pane');
// The look (colours and typefaces) and how much things move, per device.
startLook();
const extensions = [
  // No lists or block quotes in a manuscript: they hold paragraphs the chapter
  // can't save as its own (typing "- " made a list whose words were lost).
  StarterKit.configure({ codeBlock: false, code: false, horizontalRule: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, blockquote: false }), EntryIds, SceneBreak.configure({ names: () => sectionNames() }), AltMark, ParagraphVersions,
  EntryRef.configure({ onPick: openPicker, onOpen: openEntry }),
  TagMarks.configure({ onTag: (t) => notebook.showTag(t) }),
  ScriptElements.configure({ isScript: () => isScript() }),
  SceneCodes.configure({ numbering: () => (isScript() && state.project?.fields?.numbered ? numbering : null) }),
  Woven.configure({ isWoven: () => isWoven(), busy: (v) => slashOpen(v), places: (doc) => placeList(biblePlaces, doc), onDot: (ref, anchor, title) => scenePop.open(ref, anchor, title), onBlocked: (m) => toast(m) }),
  FileEmbed.configure({ onTooBig: tooBig }), SlashMenu
];
const isScript = () => root.classList.contains('script');
// Woven: the script written as flowing prose, scene headings hidden (woven.js).
const isWoven = () => root.classList.contains('woven');
// What the levels of a script's sections are called (Act, Sequence, Scene…), per piece.
const sectionNames = () => state.project?.fields?.sections || SECTION_NAMES;
function tooBig(f) { toast(`“${f.name}” is too big to add (the limit is ${Math.round(MAX_BYTES / 1048576)} MB)`); }
// Deleted, missing, or in the Trash.
const gone = (r) => !r || r.deleted || isTrashed(r);

// project: the piece open in the manuscript view. bookId: the piece whose home is
// shown. worldId: the world whose home is shown.
const state = { project: null, acts: [], chapterId: null, bookId: null, worldId: null, gridId: null, prodId: null, compareId: null, libArea: null, stage: null };
// The plot grid wrote to the open chapter's entries: read it afresh on the way back.
let gridTouched = false;
function setGridTouched(value) { return (gridTouched = value); }
const view = () => root.dataset.view || 'write';
const inNotebook = () => view() === 'notebook';

const statusEl = $('#status');
// "Saved" is the quiet, normal state: the phone shows the status only when it says something else.
new MutationObserver(() => statusEl.classList.toggle('quiet', statusEl.textContent === 'Saved')).observe(statusEl, { childList: true, characterData: true, subtree: true });
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
    const world = state.project ? await worldOf(state.project) : null;
    const pages = state.project ? [...(await pagesIn(state.project.id)), ...(world ? await pagesIn(world.id) : [])] : [];
    const idea = pages.find((p) => /^idea$/i.test(p.title || ''));
    return { book: state.project?.title || '', chapter: chapter?.title || '', idea: idea ? await pageMarkdown(idea) : '' };
  }
});

const isText = (n) => n.type.name === 'paragraph' || n.type.name === 'heading';
// The six-dot handle's menu for a paragraph (or script line). Same order as
// the notebook's: work on this one, turn into, add above, move, delete.
function paragraphMenu({ node, index, count, handle }) {
  const script = isScript();
  const kind = node.type.name;
  const text = isText(node);
  const el = kind === 'paragraph' ? node.attrs.el || 'action' : null;
  const at = (fn) => () => fn(handle.range(index).from);
  const into = (fn) => at((from) => fn(editor.chain().setTextSelection(from + 1)).focus().run());
  const title = kind === 'heading' ? 'Heading' : kind === 'sceneBreak' ? (script ? 'Section' : 'Scene break') : script ? elementLabel(el) : 'Paragraph';
  const depthChips = kind === 'sceneBreak' && script
    ? { label: 'Turn into', chips: [1, 2, 3, ...(node.attrs.level > 3 ? [node.attrs.level] : [])].map((l) => ({ label: sectionName(l, sectionNames()), current: (node.attrs.level || 1) === l, run: at((from) => editor.view.dispatch(editor.state.tr.setNodeMarkup(from, undefined, { ...editor.state.doc.nodeAt(from).attrs, level: l }))) })) }
    : null;
  const turn = depthChips || (!text ? null : script
    ? { label: 'Turn into', chips: ELEMENTS.map((x) => ({ label: x.short || x.label, current: el === x.id, run: x.id === 'scene' && isWoven() ? at((from) => { editor.chain().setTextSelection(from + 1).focus().run(); newScene(editor); }) : into((c) => (kind === 'heading' ? c.setNode('paragraph') : c).updateAttributes('paragraph', { el: x.id })) })) }
    : { label: 'Turn into', chips: [
      { label: 'Paragraph', current: kind === 'paragraph', run: into((c) => c.setNode('paragraph')) },
      { label: 'Heading', current: kind === 'heading', run: into((c) => c.setNode('heading', { level: 2 })) }
    ] });
  return {
    title,
    sections: [
      [
        text && { label: 'Add a note', keys: '⌘⇧N', run: () => notes.add(node.attrs.eid) },
        node.attrs.eid && besideItem(() => ({ view: 'write', chapterId: state.chapterId, focus: node.attrs.eid })),
        text && { label: script ? 'Versions of this line' : 'Versions of this paragraph', run: at((from) => { editor.chain().setTextSelection(from + 1).focus().run(); alts.open({ scope: 'para' }); }) },
        text && { label: 'New version to rewrite', keys: '⌘⇧D', run: at((from) => { editor.chain().setTextSelection(from + 1).focus().run(); newParagraphVersion(editor); }) }
      ],
      [turn],
      [script
        ? { label: 'Section above', run: at((from) => insertSection(from)) }
        : { label: 'Scene break above', run: at((from) => editor.chain().insertContentAt(from, { type: 'sceneBreak' }).focus().run()) }],
      [
        { label: 'Move up', keys: 'Alt+⇧↑', stay: true, half: 'move', off: index === 0, run: () => handle.move(index, index - 1) },
        { label: 'Move down', keys: 'Alt+⇧↓', stay: true, half: 'move', off: index >= count - 1, run: () => handle.move(index, index + 2) },
        node.attrs.eid && { label: 'Move to…', run: () => setTimeout(() => sendSelectionPicker([node.attrs.eid]), 120) },
        ...(node.attrs.eid ? paneMoves([node.attrs.eid], state.chapterId) : [])
      ],
      [{ label: 'Delete', danger: true, run: () => {
        const { from, to } = handle.range(index);
        if (editor.state.doc.childCount > 1) editor.chain().deleteRange({ from, to }).focus().run();
        else editor.chain().setContent({ type: 'doc', content: [{ type: 'paragraph' }] }).focus().run();
        toast(`${title} deleted`, { label: 'Undo', run: () => editor.chain().focus().undo().run() });
      } }]
    ]
  };
}
// A new section in a script, at the same depth as the one it follows (a
// scene after a scene), ready to name. Tab in its name goes a level deeper.
// Changes the line you're on. In Woven a scene heading isn't a line you see,
// so "Scene" starts a new scene there instead.
function setElement(el) {
  if (el === 'scene' && isWoven()) { editor.commands.focus(); return newScene(editor); }
  return editor.chain().focus().updateAttributes('paragraph', { el }).run();
}
function insertSection(at) {
  let level = 1;
  editor.state.doc.forEach((n, pos) => { if (pos < at && n.type.name === 'sceneBreak') level = n.attrs.level || 1; });
  editor.chain().insertContentAt(at, { type: 'sceneBreak', attrs: { level } }).run();
  requestAnimationFrame(() => editor.view.nodeDOM(at)?.querySelector('input')?.focus());
}
const blocks = new BlockHandle(editor, $('.sheet'), { menu: paragraphMenu });

wireScriptBar();

wireNotebook();
let tagsPage = null; // the Tags page (set up with capture, below)
let deskPage = null; // the Desk: every project, what needs you (below)
let plan = null; // the plan: tasks by day, on a day's page and as Week and Pace (below)
let pull = null; // a project's lines next to the plan, to drag in (pull.js, below)
let projectPage = null; // what a project's page borrows from the Desk (below)
let through = null; // Go through: loose lines and the Desk's calls, one at a time (below)
let dayReview = null; // the day review under a day page (set up with capture, below)

wireRouting();

wireSync();

wireManuscript();

wireRail();

wireLibraryView();

wireRevising();

wireSharing();

wireWorkPages();
// The one box (box.js), made once the commands are listed.
let box = null;

wireHistory();

wirePageSettings();

// ---------- command menu (⌘K) and go-to (⌘O) ----------

const mod = '⌘'; // shown as Ctrl+ off a Mac, see keys.js
showKeysForThisComputer();

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
const commands = [
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

// The command menu opens on these, so the phone doesn't need a long scroll; typing searches everything.
async function showSpace() {
  const { bytes, count } = await spaceUsed();
  const { count: waiting } = await unsentFiles();
  toast(`Pictures and files: ${mb(bytes)} of ${mb(SPACE)} used · ${count === 1 ? '1 file' : `${count} files`}${waiting ? ` · ${waiting} still to upload from here` : ''}`);
}

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
    { id: 'tag', label: 'Tag', keys: '#', run: (e) => e.chain().focus().insertContent('#').run() },
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
  const { openBringIn } = await import('./bringin.js');
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
    onClose: () => tidyNudge(),
    toast
  });
}
// On today's page, a quiet line while Claude has tidy-ups waiting or has changed something since you last looked.
let nudgeAt = 0;
async function tidyNudge() {
  const el = $('.tidy-nudge');
  if (!el) return;
  const today = inNotebook() && notebook.isDay && notebook.page?.id === dayId(isoToday());
  const stamp = ++nudgeAt;
  const { waiting, changes } = today ? await tidyCounts() : { waiting: 0, changes: 0 };
  if (stamp !== nudgeAt) return;
  el.hidden = !(waiting || changes);
  el.textContent = ['Tidy pass', waiting ? `${waiting} to look at` : '', changes ? `Claude changed ${changes === 1 ? 'a thing' : `${changes} things`}` : ''].filter(Boolean).join(' · ');
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

function toggleNotes() {
  notes.setVisible(!notes.visible);
}
document.addEventListener('notes-visibility', () => { $('#notes-toggle').setAttribute('aria-pressed', String(notes.visible)); });

const toggleWriteToday = () => go(inNotebook() ? { view: 'write' } : { view: 'notebook', pageId: dayId(isoToday()) });

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (!b) return;
  const cmd = b.dataset.cmd;
  if (cmd === 'palette') openPalette();
  if (cmd === 'notes' && writing()) toggleNotes();
  if (cmd === 'page') togglePageSettings();
  if (cmd === 'history') hstrip.toggle();
  if (cmd === 'history-list') openHistory();
  if (cmd === 'new-chapter') newChapter();
  if (cmd === 'new-act') newAct();
  if (cmd === 'new-page') newPageHere();
  if (cmd === 'view') toggleWriteToday();
  if (cmd === 'focus') toggleFocus();
  if (cmd === 'shortcuts') toggleShortcuts();
  if (cmd === 'stats') progressPanel.toggle();
  if (cmd === 'library') go({ view: 'library', area: null });
  if (cmd === 'grid') toggleGrid();
  if (cmd === 'production') toggleProduction();
  // Beside, the plan's own Day is today's plan alone, not the whole page.
  if (cmd === 'today') go(inPane && view() === 'plan' ? BESIDE_PLACES.plan : { view: 'notebook', pageId: dayId(isoToday()) });
  // On a phone the day is two views: its page, and its plan.
  if (cmd === 'today-page' || cmd === 'today-plan') plan.goTab(cmd === 'today-page' ? 'page' : 'plan');
  if (cmd === 'beside') toggleBesidePane();
  if (cmd === 'talk') openTalk();
  if (cmd === 'drawer') go({ view: 'drawer' });
  if (cmd === 'go') nav.toggle();
  if (cmd === 'mic') captureHere({ start: true });
  if (cmd === 'gather-tag') gatherOntoPage(notebook.shownTag);
  if (cmd === 'tags') go({ view: 'tags' });
  if (cmd === 'week') go({ view: 'plan', tab: 'week' });
  if (cmd === 'when' || cmd === 'plan') go({ view: 'plan', tab: 'plan' });
  if (cmd === 'calendar') plan.goTab('cal');
  if (cmd === 'ahead') go({ view: 'plan', tab: 'ahead' });
  if (cmd === 'pace') go({ view: 'plan', tab: 'pace' });
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
  else if (m && e.shiftKey && !e.altKey && e.code === 'Period') { e.preventDefault(); toggleSections(); }
  else if (m && e.key === '.') { e.preventDefault(); toggleFocus(); }
  else if (m && !e.shiftKey && !e.altKey && e.code === 'Backslash') { e.preventDefault(); toggleBesidePane(); }
  // Alt + T: talk it through with Claude, beside where you are.
  else if (e.altKey && !m && !e.shiftKey && e.code === 'KeyT') { e.preventDefault(); openTalk(); }
  // Alt + Shift + T: everything left from earlier days onto today.
  else if (e.altKey && !m && e.shiftKey && e.code === 'KeyT') { e.preventDefault(); plan.bringToday(); }
  // Alt + P: the plan beside today's page, or on top of it.
  else if (e.altKey && !m && !e.shiftKey && e.code === 'KeyP' && !inPane) { e.preventDefault(); flipPlan(); }
  // Alt + 1, 2, 3 in Today: Today, Plan, Calendar (again in a calendar: the next zoom).
  else if (e.altKey && !m && !e.shiftKey && /^Digit[1-3]$/.test(e.code) && inToday()) { e.preventDefault(); todayKey(Number(e.code.slice(5))); }
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
  else if (m && k === '1') { e.preventDefault(); body.classList.toggle('pin-outline'); }
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

// ---------- capture: talk, and it lands on today's page ----------

const askServer = (body) => (window.__claude ? window.__claude(body) : sync.invoke('inkwell', body));
const canAskServer = () => !!window.__claude || (!!sync.user && navigator.onLine && !!sync.backend?.invoke);
// Until writing-out is set up, the recording's chip says so; nothing else nags.
// Once a session, after the first sync: recordings from the last week that
// came back with no words (and so were never written up) get another go.
let blankChecked = null;
function blankOnce() {
  blankChecked ||= requeueBlank().catch((e) => { console.warn(e); return 0; });
  return blankChecked;
}
// Recordings Scribe kept here (its mode has "Keep in Inkwell" on) arrive by
// sync with their words; each sync, any not written up yet are, like a Capture.
let scribing = null;
function scribeKept() {
  scribing ||= placeScribeWaiting().then((rows) => (rows.length ? applyRemote(rows) : null)).catch((e) => console.warn(e)).finally(() => { scribing = null; });
  return scribing;
}
// Ctrl + K on a recording's line: write it out again.
async function writeLineOutAgain() {
  const id = notebook.currentLine();
  if (!id || !(await writeOutAgain(id))) { toast('Put the cursor on a line with a recording on it.'); return; }
  toast('Writing it out again…');
  writeOut();
}
function writeOut() {
  const opts = { ask: askServer, canAsk: canAskServer, onRows: (rows) => applyRemote(rows), typing: (id) => notebook.typingOn(id) };
  return Promise.all([writeOutPending({ ...opts, draft: { context: draftContext, deliver: deliverDraft } }), snapshotPending(opts), meetingPending({ ...opts, ...meetingOpts })]);
}
// Meetings: your tasks become tasks here (a business one goes to Acro HQ).
const meetingOpts = {
  me: () => sync.user?.user_metadata?.full_name || sync.user?.user_metadata?.name || '',
  base: () => location.origin + location.pathname,
  onDone: (it, notes, to) => {
    const sent = to === 'acro' ? notes.tasks.length : notes.tasks.filter((t) => mine(t.owner, meetingOpts.me())).length;
    const where = to === 'acro' ? 'Acro HQ' : 'your plan';
    toast(`Meeting notes ready: ${notes.title}${sent ? ` (${sent} task${sent === 1 ? '' : 's'} to ${where})` : to === 'acro' ? ' (sent to Acro HQ)' : ''}`, { label: 'Open', run: () => openEntry(`pg_meet-${it.file}`) });
  }
};
// Ctrl+K on a meeting page: send it (again) to Acro HQ, as the page stands now.
async function meetingToAcro() {
  const pid = notebook.page?.id;
  await notebook.close();
  try {
    const rows = await sendMeetingToAcro(pid, { ask: askServer, base: location.origin + location.pathname });
    await applyRemote(rows);
    toast('Sent to Acro HQ');
  } catch (e) {
    toast(e.code === 'no-acro' ? 'Sending to Acro HQ isn’t set up yet' : canAskServer() ? 'Couldn’t reach Acro HQ. Try again in a minute' : 'Go online and sign in to send it');
  }
}
// Ctrl+K: the recording on this line becomes a meeting, or pick a recording file.
async function makeMeeting() {
  const id = inNotebook() ? notebook.currentLine() : null;
  const line = id ? await getEntry(id) : null;
  if (audioOn(line)) {
    await notebook.close();
    await meetingFromLine(line.id);
    toast(canAskServer() ? 'Writing out the meeting…' : 'It’ll be written out once you’re online and signed in');
    writeOut();
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*,.m4a,.mp3,.wav,.webm,.ogg,.aac';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    await Promise.all([store.close(editor.state.doc), notebook.close()]);
    const added = await addMeetingFile(file);
    if (!added) { toast(`“${file.name}” is over ${Math.round(MAX_BYTES / 1048576)} MB. In Voice Recorder, set Recording quality lower and record again`); return; }
    await applyRemote(added.rows);
    await go({ view: 'notebook', pageId: added.line.parent_id, line: added.line.id });
    toast(canAskServer() ? 'Writing out the meeting…' : 'It’ll be written out once you’re online and signed in');
    writeOut();
  });
  input.click();
}
async function fixSpeaker() {
  const pid = notebook.page?.id;
  const names = await speakersOn(pid);
  popMenu(null, names.map((from) => ({ label: from, run: async () => {
    const to = await askText({ title: `Rename ${from}`, body: 'Every line they said gets the new name.', value: from, ok: 'Rename' });
    if (!to || to === from) return;
    await notebook.close();
    await applyRemote(await renameSpeaker(pid, from, to));
  } })), menuSpot());
}
// A link from anywhere to ?open=<id> opens that line where it
// lives, once this device has it.
let asking = null;
async function openAsked() {
  if (!asking) return;
  const row = await getEntry(asking);
  if (!row) return;
  asking = null;
  openEntry(row.id);
}
// Things shared into Inkwell from other apps land on today's page, with the
// caret at the end of the last one (Enter starts a line under it).
let landing = null;
// `quiet` (a link saved from the browser while you're working here): it goes
// on today's page without taking you away from where you are.
function landShares({ quiet = false } = {}) {
  landing ||= landSharesNow(quiet).finally(() => { landing = null; });
  return landing;
}
async function landSharesNow(quiet = false) {
  const skipped = [];
  const added = await takeShares(skipped).catch((e) => { console.error(e); return []; });
  if (skipped.length) toast(`“${skipped[0]}” is over ${Math.round(MAX_BYTES / 1048576)} MB, too big to keep. For meetings, set Voice Recorder’s Recording quality lower`);
  if (!added.length) return;
  const last = added.at(-1);
  if (quiet) {
    await applyRemote(added.flatMap((a) => a.rows));
    const show = { label: 'Show', run: () => go({ view: 'notebook', pageId: last.line.parent_id, line: last.line.id }) };
    toast(added.length === 1 ? `Saved to today’s page: ${last.line.text || 'the link'}` : `${added.length} links saved to today’s page`, show);
    writeOut();
    return;
  }
  await Promise.all([store.close(editor.state.doc), notebook.close()]);
  await applyRemote(added.flatMap((a) => a.rows));
  await go({ view: 'notebook', pageId: last.line.parent_id, line: last.line.id });
  toast(added.length === 1 ? 'Kept on today’s page' : `${added.length} things kept on today’s page`);
  writeOut();
}
// Lands a capture on today's page and shows it there.
async function showCapture({ line, rows }) {
  await applyRemote(rows);
  await go({ view: 'notebook', pageId: line.parent_id, line: line.id });
  writeOut();
}
const capture = new CaptureScreen($('.capture'), {
  onSaved: (saved) => {
    // Aimed at the draft: you stay where you were writing, and the words follow.
    if (saved.line.fields?.into?.chapter) { toast('Kept. Claude is writing it into the draft…'); applyRemote(saved.rows).then(() => { if (writing()) editor.commands.focus(); writeOut(); }); return; }
    toast(saved.line.parent_id?.startsWith('day-') ? 'Kept on today’s page' : 'Kept here, and noted on today’s page');
    showCapture(saved);
  },
  onClose: () => currentEditor().commands.focus(),
  toast
});
// ---------- walk and talk: say it, and it lands where you are ----------

// One voice button, one rule: in a chapter Claude writes it into the draft
// just after the paragraph the caret is on; on a page it goes on that page,
// after the line you're on; anywhere else (and on a day) it goes on today.
// Today's page always gets a line for it, linking to where it went.
async function captureSpot() {
  if (writing() && state.chapterId) return draftSpot();
  const page = inNotebook() && !notebook.isDay ? notebook.page : null;
  // The title as shown (a page named a moment ago may not be saved yet).
  if (page && !page.deleted) return { page: page.id, title: $('#nb-title')?.textContent.trim() || titleOf(page), after: notebook.currentLine() };
  return null;
}
async function captureHere(opts = {}) {
  await openCapture({ ...opts, into: await captureSpot() });
}
async function draftSpot() {
  const chapter = await getEntry(state.chapterId);
  const block = editor.state.selection.$from.node(1);
  return { chapter: state.chapterId, title: chapter?.title || 'this chapter', after: block?.attrs.eid || null };
}
// Picks a recording file for Capture; it lands where you are, like talking.
async function fromRecordingFile() {
  // The file picker needs this tap, so it opens first and Capture follows.
  const into = await captureSpot();
  await openCapture({ start: false, into });
  capture.pick.click();
}
// What Claude needs to know about where the words go: the text just before,
// whether it's a script, and what's being written.
async function draftContext(into) {
  const chapter = await getEntry(into.chapter);
  if (!chapter) return {};
  const book = await bookOf(chapter);
  const kids = (await children(chapter.id)).filter((k) => k.kind === 'para' || k.kind === 'heading').sort((a, b) => a.sort - b.sort);
  const at = kids.findIndex((k) => k.id === into.after);
  const before = kids.slice(0, at >= 0 ? at + 1 : kids.length).map((k) => (k.text || '').trim()).filter(Boolean).join('\n\n').slice(-3000);
  return { before, script: !!book && bookType(book) === 'screenplay', book: [book?.title, chapter.title].filter(Boolean).join(', ') };
}
// The words land in the chapter (an open one is saved first, then refreshed).
// If the chapter's gone, they land on the day page like any capture.
async function deliverDraft(it, answer) {
  if (state.chapterId === it.into.chapter) await store.flush(editor.state.doc);
  const { script } = await draftContext(it.into);
  const types = await noteTypes();
  const rows = await placeDraft({ ...it.into, line: it.line }, answer, { script, noteType: types[0]?.id || null });
  const line = await getEntry(it.line);
  const raw = String(answer.raw || '').trim();
  if (rows === null) return placeVoice(it, answer, {});
  if (line && raw) {
    const kept = { ...line, fields: { ...line.fields, voice: { raw, mode: answer.mode || 'scene', into: it.into.chapter } }, updated_at: Date.now() };
    await putEntries([kept]);
    rows.push(kept);
  }
  const first = rows.find((r) => r.kind === 'para');
  // Still on the spot you talked into: carry on writing after what you said.
  const here = state.chapterId === it.into.chapter && editor.state.selection.$from.node(1)?.attrs.eid;
  if (here && (here === it.into.after || !it.into.after)) setCaretAfter(rows.filter((r) => r.kind === 'para' && !r.deleted && r.fields?.voice).at(-1)?.id || null);
  if (first) toast(`Your words are in “${it.into.title || 'the draft'}”`, state.chapterId === it.into.chapter ? null : { label: 'Show', run: () => openEntry(first.id) });
  else if (raw === '') toast('Nothing was heard in that recording');
  return rows;
}

// A tap on a capture's mode chip: the same words in another mode, or word for word.
onVoiceChip(async (lineId, chip) => {
  const info = await voiceInfo(lineId);
  if (!info) return;
  const modes = await knownModes();
  if (canAskServer()) fetchModes(askServer).catch(() => {});
  const use = (id, name) => async () => {
    if (id === info.mode) return;
    if (!info.made.includes(id) && !canAskServer()) { toast('Writing it up another way needs a connection'); return; }
    await notebook.close();
    if (!info.made.includes(id)) toast(`Writing it up as ${name}…`);
    try {
      await applyRemote(await switchVoice(lineId, id, askServer));
    } catch (e) { console.error(e); toast(e.message || 'Claude couldn’t write it up that way this time'); }
  };
  popMenu(chip, [
    { label: 'Word for word', current: info.mode === RAW, run: use(RAW, 'Word for word') },
    ...modes.map((m) => ({ label: m.name, current: info.mode === m.id, run: use(m.id, m.name) })),
    'sep',
    { label: 'Copy this version', run: async () => { await notebook.close(); const t = await voiceText(lineId); try { await navigator.clipboard.writeText(t); toast('Copied, ready to paste'); } catch { showCopy({ title: 'Copy this version', value: t }); } } },
    { label: 'Change your modes…', run: () => openModes() },
    ...(info.by ? ['sep', { note: heardNote(info), plain: true }] : [])
  ]);
});
// "Written out by ElevenLabs", or by the backup when ElevenLabs came back blank.
const SERVICE = { elevenlabs: 'ElevenLabs', openai: 'OpenAI (the backup)' };
function heardNote({ by, tried }) {
  const blank = (tried || []).some((t) => /^elevenlabs.*: (no words|failed)/.test(t));
  return `Written out by ${SERVICE[by] || by}${by === 'openai' && blank ? ', ElevenLabs came back blank' : ''}`;
}

// Your modes, the same ones Scribe uses: rename one, change what it does or
// which Claude writes it, add one, or delete one.
async function openModes(anchor = $('#palette-toggle')) {
  if (!canAskServer()) { toast('Your modes live on your account; sign in and get online to change them'); return; }
  let modes;
  try { modes = await fetchModes(askServer); } catch { toast('Couldn’t reach your modes. Try again.'); return; }
  const save = async (item) => {
    try {
      const out = await askServer({ mode: 'voice-save-mode', item });
      if (out?.error) throw new Error(out.error);
      await fetchModes(askServer);
      toast(`Saved “${item.name}”. Scribe has it too.`);
    } catch (e) { toast(e.message || 'Couldn’t save that mode. Try again.'); }
  };
  const CLAUDES = [['haiku', 'Haiku: quick, for light jobs'], ['sonnet', 'Sonnet: everyday writing'], ['opus', 'Opus: when the writing matters']];
  popMenu(anchor, [
    { note: 'Your modes, shared with Scribe' },
    ...modes.map((m) => ({ label: m.name, sub: [
      { label: 'Rename…', run: async () => { const name = await askText({ title: 'Rename this mode', value: m.name }); if (name && name !== m.name) save({ ...m, name }); } },
      { label: 'What it does…', run: async () => { const prompt = await askText({ title: `What ${m.name} does`, body: 'In plain words, how what you say gets written up.', value: m.prompt || '' }); if (prompt !== null && prompt !== m.prompt) save({ ...m, prompt }); } },
      { label: 'Which Claude writes it', sub: CLAUDES.map(([id, label]) => ({ label, current: m.model === id, run: () => save({ ...m, model: id }) })) },
      'sep',
      { label: 'Delete', danger: true, run: async () => {
        if (!(await ask({ title: `Delete “${m.name}”?`, body: 'It goes from Scribe too. Anything already written up with it stays as it is.', ok: 'Delete', danger: true }))) return;
        const out = await askServer({ mode: 'voice-delete-mode', id: m.id }).catch((e) => ({ error: e.message }));
        if (out?.error) { toast(out.error); return; }
        await fetchModes(askServer);
        toast(`Deleted “${m.name}”`);
      } }
    ] })),
    'sep',
    { label: 'New mode…', run: async () => {
      const name = await askText({ title: 'New mode', placeholder: 'Like “Pitch” or “Lyrics”', ok: 'Next' });
      if (!name) return;
      const prompt = await askText({ title: `What ${name} does`, body: 'In plain words, how what you say gets written up.', ok: 'Add' });
      if (prompt) save({ name, prompt, model: 'opus' });
    } }
  ]);
}

async function openCapture(opts) {
  if (!$('.palette').hidden) closePalette(false);
  // Anything typed is saved first, so the new line can't clash with it.
  await Promise.all([store.close(editor.state.doc), notebook.close()]);
  capture.show(opts);
}
if (!inPane) window.addEventListener('online', () => writeOut());

// The day review: Claude sums up a day's page and sorts what's on it, and you
// decide each thing (a task, keep thinking, split, let go).
dayReview = new DayReview($('.day-review'), {
  card: $('.evening-card'),
  ask: askServer,
  canAsk: canAskServer,
  base: () => location.origin + location.pathname,
  onRows: (rows) => applyRemote(rows),
  onOpen: (id) => openEntry(id),
  toast
});
$('.tidy-nudge').addEventListener('click', () => showTidy());
// The Tags page: every tag, grouped, merged and gone through one by one.
tagsPage = new TagsPage({
  sheet: $('#tags-sheet'),
  go: async (place, { replace = false } = {}) => {
    const mode = historyMode;
    if (replace) setHistoryMode('replace');
    try { await go(place); } finally { setHistoryMode(mode); }
  },
  open: (id) => openEntry(id),
  ask: askServer,
  canAsk: canAskServer,
  changed: (rows) => applyRemote(rows),
  toast
});
// The Desk: every project with what needs you and who's working on it, and
// History, every Claude thread there has been. Calls and updates live in
// Daybook's side of the database.
const deskBackend = () => window.__desk || (sync.user && sync.backend?.desk ? sync.backend : null);
deskPage = new DeskPage({
  sheet: $('#desk-sheet'),
  fetch: (since) => { const b = deskBackend(); return b ? b.desk(since) : null; },
  fetchAll: () => { const b = deskBackend(); return b ? b.deskAll() : null; },
  done: (id) => deskBackend().doneNeed(id),
  later: (id, until) => deskBackend().laterNeed(id, until),
  ask: askServer,
  canAsk: canAskServer,
  open: (id) => openEntry(id),
  go: (place) => go(place),
  base: () => location.origin + location.pathname,
  changed: (rows) => applyRemote(rows),
  onCount: (n) => { frame.count(n); nav.count(n); },
  // The Desk's order changed (a drag, or what's on stage): the rail follows.
  ordered: () => frame.drawProjects(),
  // "Add one" under "No next step yet": the project's Steps page, the caret on a new step.
  addStep: async (id) => {
    const world = await getEntry(id);
    if (!world) return;
    const rows = await addTask({ text: '', home: stepsHome(world) });
    await applyRemote(rows);
    await openEntry(rows.at(-1).id);
  },
  through: () => through.open('calls'),
  // A call answered from a project's own page: that page looks again.
  acted: () => { projectPage?.stale(); if (view() === 'world') renderWorld(); },
  // ✦ Talk it through, from the Desk's head (not from inside a pane, and not with Beside off).
  talk: () => (inPane || !paneHost() || root.classList.contains('hide-panes') ? null : () => openTalk()),
  toast
});
// A call was answered or set aside, here or in a pane: whatever shows calls looks again.
function callsChanged() {
  projectPage?.stale();
  if (view() === 'world') renderWorld();
  else if (view() === 'desk') deskPage.load({ quiet: true });
  else deskPage.peek();
}
if (!inPane) window.__callsChanged = callsChanged;
// A project's own page borrows the Desk: its seat, north star, calls, crew
// and turns (projectpage.js).
projectPage = new ProjectPage({ seat: $('#wh-seat'), facts: $('#wh-facts'), calls: $('#wh-calls'), crew: $('#wh-crew'), turns: $('#wh-turns') }, {
  fetch: (since) => { const b = deskBackend(); return b ? b.desk(since) : null; },
  // Answering a call here is the Desk answering it; then both look again.
  call: (c, now) => deskPage.call(c, now, () => false),
  go: (place) => go(place),
  history: (name) => { deskPage.filter = 'all'; deskPage.query = name; go({ view: 'desk', tab: 'history' }); },
  changed: (rows) => applyRemote(rows),
  showing: (id) => view() === 'world' && state.worldId === id
});
// Go through (through.js): the last week's loose lines, or the Desk's calls,
// one card at a time.
through = new Through({
  toast,
  changed: (rows) => applyRemote(rows),
  worlds: async () => (await byKind('world')).filter((w) => !w.deleted && !isTrashed(w)).sort((a, b) => b.updated_at - a.updated_at).map((w) => ({ id: w.id, title: w.title || 'Untitled' })),
  calls: { list: () => deskPage.waiting(), done: (id) => deskPage.callDone(id), later: (id) => deskPage.callLater(id) },
  // Tasks left on today from earlier days: keep, take off the day, or delete.
  carried: { list: () => plan.carriedList(), answer: (it, how) => plan.carriedAnswer(it, how) },
  onClose: () => { looseFoot(); plan?.soon(); }
});
// Under a recent day's lines: how many are still loose, and the way in.
let looseTimer = 0;
function looseSoon() { clearTimeout(looseTimer); looseTimer = setTimeout(looseFoot, 250); }
async function looseFoot() {
  const foot = $('#loose-foot');
  if (!foot) return;
  const page = inNotebook() && notebook.looseDay ? notebook.page : null;
  const n = page ? (await looseOn(page.title)).length : 0;
  // The page changed while counting: the newer count wins.
  if ((inNotebook() && notebook.looseDay ? notebook.page.id : null) !== (page?.id || null)) return looseFoot();
  foot.hidden = !n;
  if (!n) { foot.replaceChildren(); return; }
  if (foot.dataset.n === String(n) && foot.firstChild) return;
  foot.dataset.n = String(n);
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = n === 1 ? 'Go through it' : 'Go through them';
  b.title = 'One at a time: a task, a project, the Drawer, or just a note for the day';
  b.addEventListener('click', () => through.open('loose'));
  const words = document.createElement('span');
  words.textContent = n === 1 ? '1 loose line' : `${n} loose lines`;
  foot.replaceChildren(document.createElement('i'), words, b);
}
// Today's views, for Alt + 1 to 4.
function todayKey(n) {
  if (n === 1) return go({ view: 'notebook', pageId: dayId(isoToday()) });
  if (n === 2) return touch.matches ? plan.goTab('plan') : go({ view: 'plan', tab: 'plan' });
  return view() === 'plan' && isCal(tabFor(lastPlace?.tab)) ? plan.stepZoom() : plan.goTab('cal');
}
function inToday() {
  if (view() === 'plan') return true;
  return inNotebook() && !!notebook.page && notebook.isDay && !notebook.zoom;
}
// The plan beside today's page (on a wide enough computer) or on top of it in
// one column, as on a phone. Kept on this device.
const planLayout = () => (hidden().has('planside') ? 'top' : 'side');
function flipPlan() {
  const was = planLayout();
  const y = document.scrollingElement?.scrollTop || 0;
  setShown('planside', was !== 'side');
  plan.redraw();
  if (document.scrollingElement) document.scrollingElement.scrollTop = y;
  if (view() === 'notebook' && notebook.isDay) toast(was === 'side' ? 'The plan is on top of the page (Alt + P puts it beside)' : 'The plan is beside the page (Alt + P puts it on top)');
}
// The plan: tasks gathered by day (plan.js). On a day's page it sits on top;
// Week and Pace are their own page.
plan = new Plan({
  box: $('#plan'),
  sheet: $('#plan-sheet'),
  steps: $('#wh-steps'),
  hooks: {
    stepHint: (w) => taskHint(w),
    view,
    changed: (rows) => applyRemote(rows),
    // Beside, a task's place opens in the main window and the plan stays.
    openEntry: (id) => (inPane && view() === 'plan' ? openInMain(id) : openEntry(id)),
    beside: (id) => (inPane || root.classList.contains('hide-panes') || !paneHost() ? null : () => openEntryBeside(id)),
    // A click on a task zooms into it, as an outliner does: the task becomes
    // the page, its lines under it (the cursor on `line`, if given), and Back
    // (Alt + Left) comes out to the plan. Ctrl + click and the menu open it beside.
    openTask: async (id, line = null, { beside = false } = {}) => {
      const at = await placeOf(id);
      if (!at) return;
      const place = at.view === 'notebook' && at.line ? { view: 'notebook', pageId: at.pageId, zoom: at.line, ...(line ? { line } : {}) } : at;
      if (beside && !inPane && !root.classList.contains('hide-panes') && paneHost()) return openBeside(place);
      if (inPane && view() === 'plan') return paneHost()?.hooks.goMain(place);
      return go(place);
    },
    go: (place) => go(place),
    goThrough: () => through.open('carried'),
    off: (name) => hidden().has(name),
    show: (name, on) => setShown(name, on),
    // Beside or on top: only where there's room for beside (a computer, 1100 px and wider).
    layout: () => (inPane || touch.matches || !matchMedia('(min-width: 1100px)').matches ? null : planLayout()),
    flip: () => flipPlan(),
    // A project's steps were drawn again: its next date may have moved.
    steps: () => { if (view() === 'world' && state.worldId) projectPage?.setDate(nextDate(state.worldId)); },
    // Weeks ahead: the lanes as the Desk seats them, and shoot days.
    ahead: () => aheadSource((since) => { const b = deskBackend(); return b ? b.desk(since) : null; }),
    talk: () => (inPane || !paneHost() || root.classList.contains('hide-panes') ? null : () => openTalk()),
    // Google Calendar, read-only, through the server's calendar function.
    calendar: (from, to) => calendarEvents((a, b) => (window.__calendar ? window.__calendar(a, b) : sync.user && sync.invoke ? sync.invoke('calendar', { timeMin: a, timeMax: b }) : null), from, to),
    // Pull from a project: its lines open next to the plan, to drag in.
    pull: inPane ? null : () => pullFromProject(),
    pulling: () => !!pull?.isOpen,
    floor: () => pull?.floor() || 0,
    redrawn: () => pull?.soon(),
    toast
  }
});
window.__plan = plan;
if (inNotebook() && notebook.page) plan.showDay(notebook.page);

// ---------- pulling lines in from a project, beside a planning view ----------

// Today (a day's page with its plan), Plan, and Calendar's Week and Six weeks.
function planningView() {
  if (view() === 'plan') return ['plan', 'week', 'ahead', 'day'].includes(tabFor(lastPlace?.tab));
  return inNotebook() && !!notebook.page && notebook.isDay && !notebook.zoom;
}
pull = inPane ? null : new Pull({
  sources: async () => {
    const [all, worldsSorted, pages] = [await areas(), await projectOrder(), (await byKind('page')).filter((p) => !gone(p))];
    const byId = new Map(all.map((a) => [a.id, a]));
    const worldList = worldsSorted;
    const titles = new Map(worldList.map((w) => [w.id, w.title || 'Untitled']));
    const out = worldsSorted.map((w) => ({ id: w.id, title: w.title || 'Untitled', kind: 'world', color: areaColor(byId.get(w.area_id)), hint: 'project' }));
    for (const pg of pages.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))) {
      if (/^steps-/.test(pg.id)) continue;
      out.push({ id: pg.id, title: pg.title || 'Untitled page', kind: 'page', hint: titles.get(pg.parent_id) || 'page' });
    }
    return out;
  },
  // The project you last pulled from is remembered by the pane itself; the
  // first time, the first project in your Desk order that has open steps
  // (never an empty one), else the project you were last in.
  first: async () => {
    const open = new Set((await loadTasks()).filter((i) => i.world && !i.row.fields?.done).map((i) => i.world.id));
    for (const w of await projectOrder()) if (open.has(w.id)) return w.id;
    let id = null;
    try { id = localStorage.getItem('lastWorld'); } catch { /* none */ }
    if (id && !gone(await getEntry(id))) return id;
    return (await railProjects())[0]?.id || null;
  },
  start: () => { if (root.classList.contains('pulling-phone')) plan.pullZones(true); },
  over: (x, y) => plan.pullShow(plan.pullSpot(x, y)),
  drop: async (x, y, ids) => { const spot = plan.pullSpot(x, y); plan.pullZones(false); await plan.pullDrop(spot, ids); },
  end: () => { plan.pullZones(false); plan.pullShow(null); },
  when: (ids, anchor) => plan.pickWhenFor(ids, { anchor }),
  changed: () => plan.redraw(),
  toast
});
async function pullFromProject(id = null) {
  if (!pull) return;
  if (!planningView()) await go({ view: 'plan', tab: 'plan' });
  if (pull.isOpen && !id) pull.close(); else await pull.start(id);
}
// Ctrl + click on a project in the rail: beside the plan in a planning view
// (to drag from), in a pane beside anything else.
async function openProjectBeside(id) {
  if (planningView()) return pullFromProject(id);
  if (!root.classList.contains('hide-panes') && paneHost()) return openBeside({ view: 'world', id });
  return pullFromProject(id);
}
// The lines a When is for, in the outline: the ones the selection touches.
function selectedLineIds() {
  const ed = notebook.editor;
  const { from, to, empty } = ed.state.selection;
  if (empty) { const one = notebook.currentLine(); return one ? [one] : []; }
  const out = [];
  ed.state.doc.nodesBetween(from, to, (n) => { if (n.type.name === 'listItem' && n.attrs.eid) out.push(n.attrs.eid); return true; });
  return out.length ? [...new Set(out)] : [notebook.currentLine()].filter(Boolean);
}
// Alt + W: When for what's under the keyboard (tasks picked in a plan, lines
// picked in the project pane, or the line or lines in the outline).
async function whenHere() {
  if (plan.whenKey()) return true;
  if (pull?.isOpen && pull.picked.size) { plan.pickWhenFor([...pull.picked], { anchor: pull.pickWhen }); return true; }
  if (inNotebook() && notebook.page) {
    const ids = selectedLineIds();
    if (!ids.length) return false;
    await notebook.store.flush(notebook.editor.state.doc);
    let at = null;
    try { const c = notebook.editor.view.coordsAtPos(notebook.editor.state.selection.head); at = { left: c.left, top: c.bottom }; } catch { /* not drawn */ }
    await plan.pickWhenFor(ids, { at });
    return true;
  }
  return false;
}

// Google Calendar, connected from Inkwell itself.
async function connectCalendar() {
  const b = sync.backend;
  if (!b?.connectCalendar || !sync.user) { toast('Sign in first (Ctrl + K, “Sign in”), then connect your calendar.'); return; }
  let has = null;
  try { has = await b.hasCalendar(); } catch {}
  const yes = await ask(has
    ? { title: 'Your Google Calendar is connected', body: 'Its events show on Today and the week. Connect again if they stopped showing, or to use another Google account.', ok: 'Connect again' }
    : { title: 'Connect your Google Calendar', body: 'Your events show on Today and the week, and “left today” counts them. Inkwell only reads your calendar and never changes it. Google asks you to allow this.', ok: 'Connect' });
  if (yes) b.connectCalendar();
}
window.addEventListener('calendar-connected', (e) => {
  forgetCalendar();
  toast(e.detail?.ok ? 'Your Google Calendar is connected. Its events show on Today and the week.' : 'Google said yes, but the calendar couldn’t be saved. Try again from Ctrl + K, “Google Calendar”.');
  plan.refresh?.();
});

// The number beside Desk keeps up without the Desk being open.
let deskPeeked = 0;
const peekDesk = () => { if (inPane || document.hidden || Date.now() - deskPeeked < 120000) return; deskPeeked = Date.now(); deskPage.peek(); };
// Sync may still be signing in when the app opens, so look twice early on.
if (!inPane) for (const ms of [4000, 20000]) setTimeout(() => { deskPeeked = Date.now(); deskPage.peek(); }, ms);
setInterval(peekDesk, 300000);
document.addEventListener('visibilitychange', peekDesk);
// The 9 pm alert links to ?review=<date>: open that day and its
// review, or ask Claude for one once this device has caught up.
let reviewing = null;
async function reviewAsked() {
  if (!reviewing) return;
  const iso = reviewing;
  if (!inNotebook() || notebook.page?.id !== dayId(iso)) await go({ view: 'notebook', pageId: dayId(iso) });
  if (await getReview(iso)) { reviewing = null; await dayReview.reveal(); return; }
  if (!canAskServer()) return;
  reviewing = null;
  await dayReview.run(iso);
  dayReview.box.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// Watch and read lists: once typing pauses, Claude links the titles you've
// moved on from (never the line you're on).
let listTimer;
function listSoon(ms = 4000) {
  clearTimeout(listTimer);
  listTimer = setTimeout(() => {
    if (!inNotebook() || !listOf(notebook.page)) return;
    fillList(notebook.page, { ask: askServer, canAsk: canAskServer, onRows: (rows) => applyRemote(rows), skip: notebook.editor.isFocused ? notebook.currentLine() : null });
  }, ms);
}
async function makeList(list) {
  if (!notebook.page) return;
  await notebook.close();
  const page = await setList(notebook.page.id, list);
  if (!page) return;
  notebook.page = notebook.store.page = page;
  toast(list ? `Claude will link each title on this ${LISTS[list].toLowerCase()}` : 'Claude won’t link titles on this page');
  listSoon(500);
}
// Sharing again while Inkwell is already open brings it to the front.
if (!inPane) document.addEventListener('visibilitychange', () => { if (!document.hidden) landShares(); });
// The Save to Inkwell bookmark (save.html) asks whether Inkwell is already
// open in this browser: this window answers, and the link lands here quietly
// (or once this window has finished opening).
if (!inPane && 'BroadcastChannel' in window) {
  const saves = new BroadcastChannel(SAVE_CHANNEL);
  saves.onmessage = (e) => {
    if (!e.data?.save) return;
    saves.postMessage({ heard: e.data.save });
    if (root.dataset.started) landShares({ quiet: true });
  };
}

// ---------- side by side ----------

// Other places open in panes beside the main view (panes.js). The main window
// keeps them; a pane asks it.
const panes = inPane ? null : new PaneHost({
  mainPlace: () => lastPlace,
  goMain: (place) => go(place),
  focusMain: () => { window.focus(); try { currentEditor().commands.focus(); } catch { /* nothing to type in */ } },
  isOff: () => root.classList.contains('hide-panes'),
  many: () => localStorage.getItem('manyPanes') === '1',
  focus: () => root.classList.contains('focus'),
  changed: () => syncBeside(),
  toast
});
if (panes) window.__panes = panes;

// Beside (Ctrl + \): with nothing beside, today's plan opens there; otherwise
// what's beside is put away, or brought back. From a pane it's the same.
function toggleBesidePane() {
  const h = paneHost();
  if (!h) return;
  if (h.hooks.isOff()) { toast('Beside is switched off (Look → Beside)'); return; }
  if (!inPane && root.classList.contains('focus') && !h.sheet) { toast('Focus is only the words. Leave it (⌘.) to see what’s beside.'); return; }
  if (!h.toggle()) openBeside(BESIDE_PLACES.plan);
}
function syncBeside() {
  const b = $('#beside-toggle');
  if (!b || !panes) return;
  b.setAttribute('aria-pressed', String(panes.showing));
  b.title = panes.count ? (panes.showing ? 'Put away what’s beside (⌘\\)' : 'Bring back what’s beside (⌘\\)') : 'Beside: today’s plan, notes or another page next to this one (⌘\\)';
}
// Talk it through (Alt + T): Claude beside where you are, about the project
// you're in, or everything on stage from anywhere else.
function openTalk() {
  const h = paneHost();
  if (!h) return;
  if (h.hooks.isOff()) { toast('Beside is switched off (Look → Beside)'); return; }
  if (inPane) { go(BESIDE_PLACES.claude); return; }
  if (root.classList.contains('focus') && !h.sheet) { toast('Focus is only the words. Leave it (⌘.) to talk it through.'); return; }
  openBeside(BESIDE_PLACES.claude, { focus: true });
}
// The project a place belongs to, if any: { id, title }.
async function projectOfPlace(place) {
  const id = !place ? null
    : place.view === 'write' ? place.chapterId
      : place.view === 'notebook' ? (place.pageId && !place.pageId.startsWith('day-') ? place.pageId : null)
        : ['world', 'stage', 'project', 'grid', 'production', 'deliver'].includes(place.view) ? place.id : null;
  const row = id ? await getEntry(id) : null;
  const w = row && !gone(row) ? await worldOf(row) : null;
  return w && !gone(w) ? { id: w.id, title: w.title || 'Untitled' } : null;
}
// From a pane: somewhere opens in the main window, and the pane stays as it is.
async function openInMain(id) {
  const place = await placeOf(id);
  if (place) await paneHost()?.hooks.goMain(place);
}
// The notes of the draft in the main window, listed beside (sidenotes.js).
const sideNotes = new SideNotes($('#side-notes'), {
  mainPlace: () => paneHost()?.hooks.mainPlace() || null,
  open: async (chapterId, paraId) => { const h = paneHost(); if (!h) return; await h.hooks.goMain({ view: 'write', chapterId, focus: paraId }); h.focused(''); h.hooks.focusMain(); },
  skip: (n) => notes.skip(n),
  shown: () => view() === 'sidenotes',
  named: () => { if (view() === 'sidenotes') renderCrumb(); }
});

// Talk it through (talk.js), in the Beside pane.
const talkThrough = new Talk($('#talk-sheet'), {
  scope: () => projectOfPlace(paneHost()?.hooks.mainPlace() || null),
  fetch: (since) => { const b = deskBackend(); return b ? b.desk(since) : null; },
  ask: (body) => askServer(body),
  canAsk: () => canAskServer(),
  later: (id, until) => deskBackend().laterNeed(id, until),
  // What it changed shows wherever it's open, here and in the main window.
  changed: async (rows, { calls = false } = {}) => { await applyRemote(rows); if (calls) { try { window.parent.__callsChanged?.(); } catch { /* on its own */ } } },
  shown: () => view() === 'talk',
  named: () => { if (view() === 'talk') renderCrumb(); },
  toast
});

async function openBeside(place, opts = {}) {
  if (!place?.view) return;
  // Beside a planning view, a project or a page opens where its lines can be dragged onto the plan.
  if (!inPane && pull && planningView()) {
    if (place.view === 'world' && place.id) return pullFromProject(place.id);
    if (place.view === 'notebook' && place.pageId && !place.pageId.startsWith('day-') && !place.zoom && !place.line) return pullFromProject(place.pageId);
  }
  const h = paneHost();
  if (!h) return;
  await h.open(place, { from: inPane ? PANE_ID : null, ...opts });
}
async function openEntryBeside(id) { await openBeside(await placeOf(id)); }

// "Open beside" in a handle menu (Peek beside on a phone).
function besideItem(place) {
  if (root.classList.contains('hide-panes') || !paneHost()) return null;
  return touch.matches
    ? { label: 'Peek beside', run: () => openBeside(place()) }
    : { label: 'Open beside', keys: 'Middle-click', run: () => openBeside(place()) };
}
// "Move to <a page open beside>", one for each pane showing a page, day or chapter.
function paneMoves(ids, here) {
  const roots = (paneHost()?.roots() || []).filter((r) => r.id !== here && !(inPane && r.pane === PANE_ID));
  // The main window counts too, from a pane.
  if (inPane && lastMainRoot() && lastMainRoot().id !== here) roots.unshift(lastMainRoot());
  const seen = new Set();
  return roots.filter((r) => !seen.has(r.id) && seen.add(r.id)).slice(0, 3).map((r) => ({
    label: `Move to ${r.title}`,
    run: async () => {
      const fallback = r.id.startsWith('day-') ? entry('day', { id: r.id, title: r.id.slice(4) }) : null;
      const n = await moveEntries(ids, r.id, { fallback });
      if (n) toast(`Moved to ${r.title}`);
    }
  }));
}
// From a pane: the page or chapter open in the main window.
function lastMainRoot() {
  try {
    const main = window.parent;
    const pl = main.__panes?.hooks.mainPlace();
    const id = pl?.view === 'notebook' ? pl.pageId : pl?.view === 'write' ? pl.chapterId : null;
    if (!id) return null;
    const title = main.document.querySelector('#crumb .here')?.textContent || 'the main view';
    return { id, title };
  } catch { return null; }
}

// Ctrl + Alt + → / ←: the next or previous pane (the main view counts).
// Ctrl + Alt + W closes the pane you're in; Ctrl + Alt + Enter makes it the main view.
function paneKeys(e, m) {
  const h = paneHost();
  if (inPane && e.altKey && !m && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.target.closest?.('input, textarea, [contenteditable="true"]')) {
    e.preventDefault();
    paneStep(e.key === 'ArrowLeft' ? -1 : 1);
    return true;
  }
  if (!h || !m || !e.altKey || e.shiftKey) return false;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    if (!h.count) return false;
    e.preventDefault();
    if (inPane) h.focused(PANE_ID); else h.focused('');
    h.cycle(e.key === 'ArrowRight' ? 1 : -1);
    return true;
  }
  if (e.code === 'KeyW' && h.count) {
    e.preventDefault();
    if (inPane) h.close(PANE_ID); else toast('Click into a pane to close it (or its ×)');
    return true;
  }
  if (e.key === 'Enter' && inPane) { e.preventDefault(); h.swap(PANE_ID); return true; }
  return false;
}

// Middle-click opens it beside, the way a browser opens a link in a new tab:
// a line's or paragraph's six dots, a [[link]], a #tag, a card in the Library
// or a world, a chapter in the outline, a part of the path, a row or chip in the box.
const BESIDE = 'a[data-ref], .line-gutter, .block-handle, .tag[data-tag], [data-id], .tree-chapter, .crumb-part, #palette-list > li:not(.box-chips), #palette-list .box-chip, .past-list [data-line]';
const besideTarget = (e) => (e.button === 1 && !root.classList.contains('hide-panes') && paneHost() ? e.target.closest?.(BESIDE) : null);
// (No auto-scroll from the middle button on these.)
document.addEventListener('mousedown', (e) => { if (besideTarget(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
document.addEventListener('auxclick', (e) => { if (besideTarget(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
document.addEventListener('pointerdown', (e) => {
  const el = besideTarget(e);
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  middleBeside(el).catch((err) => console.error(err));
}, true);
async function middleBeside(el) {
  if (el.matches('a[data-ref]')) return openEntryBeside(el.getAttribute('data-ref'));
  if (el.matches('.line-gutter')) {
    const eid = el.dataset.eid;
    if (eid && notebook.page) return openBeside({ view: 'notebook', pageId: notebook.page.id, zoom: eid });
    return;
  }
  if (el.matches('.block-handle')) {
    const eid = editor.view.dom.children[blocks.index]?.getAttribute('data-eid');
    if (state.chapterId) return openBeside({ view: 'write', chapterId: state.chapterId, ...(eid ? { focus: eid } : {}) });
    return;
  }
  if (el.matches('.tag[data-tag]')) return openBeside({ view: 'tags', tag: el.dataset.tag });
  if (el.matches('.past-list [data-line]')) return openBeside({ view: 'notebook', pageId: el.dataset.day, line: el.dataset.line });
  if (el.dataset.id && (await placeOf(el.dataset.id))) return openEntryBeside(el.dataset.id);
  // Anything else that takes you somewhere: where its click would go.
  setBesideUntil(Date.now() + 1500);
  el.click();
}

// ---------- dropping a line dragged from another window ----------

// The spot under (x, y) in this window: a line on the page open here, or a
// paragraph in the chapter open here.
function dropSpotAt(x, y) {
  if (inNotebook() && notebook.page) {
    const dom = notebook.editor.view.dom;
    let li = document.elementFromPoint(x, y)?.closest?.('li');
    if (li && !dom.contains(li)) li = null;
    let after = true;
    const box = dom.getBoundingClientRect();
    if (!li) {
      // Beside or below the lines: at the end of the page (or zoomed line).
      if (x < box.left - 80 || x > box.right + 80 || y < box.top) return null;
      const shown = [...dom.querySelectorAll('li')].filter((l) => l.getClientRects().length && !l.classList.contains('zoom-root') && !l.classList.contains('zoom-path'));
      li = shown.filter((l) => !l.parentElement.closest('li') || l.parentElement.closest('li').classList.contains('zoom-root')).at(-1) || shown.at(-1);
      if (!li) return null;
    } else {
      const r = (li.querySelector(':scope > p') || li).getBoundingClientRect();
      after = y > r.top + r.height / 2;
    }
    const eid = li.querySelector(':scope > .line-gutter')?.dataset.eid;
    if (!eid) return null;
    let top = li;
    while (top.parentElement?.closest('li') && dom.contains(top.parentElement.closest('li'))) top = top.parentElement.closest('li');
    const r = (li.querySelector(':scope > p') || li).getBoundingClientRect();
    return { kind: 'line', rootId: notebook.page.id, eid, after, top: top.querySelector(':scope > .line-gutter')?.dataset.eid || eid, mark: { left: r.left, width: r.width, top: after ? r.bottom : r.top } };
  }
  if (writing() && state.chapterId) {
    const dom = editor.view.dom;
    let el = document.elementFromPoint(x, y);
    while (el && el.parentElement !== dom) el = el.parentElement;
    if (!el) {
      const box = dom.getBoundingClientRect();
      if (x < box.left - 80 || x > box.right + 80 || y < box.bottom) return null;
      el = dom.lastElementChild;
      if (!el) return null;
    }
    const r = el.getBoundingClientRect();
    const after = y > r.top + r.height / 2 || !el.previousElementSibling;
    const prev = after ? el : el.previousElementSibling;
    const pr = prev.getBoundingClientRect();
    return { kind: 'para', rootId: state.chapterId, after: prev.getAttribute('data-eid'), mark: { left: pr.left, width: pr.width, top: pr.bottom } };
  }
  return null;
}
let dropMark = null;
function showDrop(spot) {
  if (!spot) { dropMark?.remove(); dropMark = null; return false; }
  if (!dropMark) { dropMark = document.createElement('div'); dropMark.className = 'line-drop'; document.body.append(dropMark); }
  Object.assign(dropMark.style, { left: `${spot.mark.left}px`, width: `${spot.mark.width}px`, top: `${spot.mark.top - 1}px` });
  return true;
}
// Alt + drop: a link to the line, where it was dropped.
async function addLinkAt(eid, spot) {
  showDrop(null);
  const row = await getEntry(eid);
  if (!row || gone(row)) return false;
  const title = (row.text || row.title || 'Untitled').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
  const ed = spot.kind === 'line' ? notebook.editor : editor;
  const s = ed.schema.nodes;
  const ref = s.entryRef.create({ id: eid, title });
  let at = -1;
  let size = 0;
  ed.state.doc.descendants((n, pos) => {
    if (at >= 0) return false;
    const match = spot.kind === 'line' ? n.type.name === 'listItem' && n.attrs.eid === spot.eid : n.attrs?.eid === spot.after && n.isBlock;
    if (match) { at = pos; size = n.nodeSize; }
    return at < 0;
  });
  if (at < 0) return false;
  const node = spot.kind === 'line' ? s.listItem.create(null, s.paragraph.create(null, ref)) : s.paragraph.create(null, ref);
  const to = spot.kind === 'line' && !spot.after ? at : at + size;
  ed.view.dispatch(ed.state.tr.insert(to, node));
  ed.commands.focus();
  return true;
}
// The window it was dragged from moves it (so its own editor lets go of it).
async function moveOutTo(eid, spot) {
  const row = await getEntry(eid);
  if (!row || gone(row)) return false;
  const here = inNotebook() ? notebook.page?.id : state.chapterId;
  // The same page in both windows: the one it was dropped in moves it there.
  if (here === spot.rootId) return true;
  const fallback = spot.rootId.startsWith('day-') ? entry('day', { id: spot.rootId, title: spot.rootId.slice(4) }) : null;
  const n = await moveEntries([eid], spot.rootId, { after: spot.kind === 'line' ? spot.top : spot.after, fallback });
  return n > 0;
}
// Once the line has arrived here, it goes exactly where it was dropped.
async function settleAt(eid, spot) {
  showDrop(null);
  if (spot.kind !== 'line') return true;
  for (let i = 0; i < 40; i++) {
    if (!notebook.store.idle) await notebook.store.flush(notebook.editor.state.doc);
    let has = false;
    notebook.editor.state.doc.descendants((n) => { if (n.attrs?.eid === eid) has = true; return !has; });
    if (has) return dropLineAt(notebook.editor.view, eid, spot.eid, spot.after);
    if (i % 5 === 4) await notebook.applyRemote([await getEntry(eid)].filter(Boolean));
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
window.__pane = {
  go: (place) => go(place),
  mainMoved: () => { if (view() === 'sidenotes') sideNotes.soon(); if (view() === 'talk') talkThrough.mainMoved(); },
  focus: () => { try { currentEditor().commands.focus(); } catch { /* nothing to type in */ } },
  closing: () => { store.close(editor.state.doc); notebook.close(); },
  dropOver: (x, y) => showDrop(dropSpotAt(x, y)),
  dropClear: () => showDrop(null),
  dropSpot: (x, y) => dropSpotAt(x, y),
  addLink: (eid, spot) => addLinkAt(eid, spot),
  moveOut: (eid, spot) => moveOutTo(eid, spot),
  settle: (eid, spot) => settleAt(eid, spot)
};
// A line dragged by its dots out of this window, over another one.
setLineDragOut({
  over: (e) => !!paneHost()?.dragOver(inPane ? PANE_ID : '', e.clientX, e.clientY),
  drop: (e, eid) => paneHost()?.drop(inPane ? PANE_ID : '', e.clientX, e.clientY, { eid, alt: e.altKey }) || false
});

// ---------- start ----------

async function start() {
  if (localStorage.getItem('font')) setFont(localStorage.getItem('font'));
  if (inPane) return startPane();
  // A first run gets a starter novel, but with sync only once the cloud has
  // said the account is empty. Signed in, wait a moment for that first pull,
  // so the app opens on your own writing; signed out, it waits for sign-in.
  let syncing = null;
  if (!(await getMeta('seedDecided'))) {
    if (await hasWriting()) await setMeta('seedDecided', true);
    else if (!sync.available) await seedNow();
    else if (await sync.backend.user?.().catch(() => null)) {
      // Nothing to type into until it opens on your own writing.
      root.classList.add('starting');
      syncing = sync.start();
      await Promise.race([syncing, new Promise((r) => setTimeout(r, 6000))]);
      await seedIfEmpty();
    }
  }
  await ensureAreas();
  // If sync never answers (no signal, say), books still become worlds.
  setTimeout(migrateOnce, 6000);
  let place = null;
  try { place = JSON.parse(localStorage.getItem('place') || 'null'); } catch { /* ignore */ }
  // On the phone, coming back on a new day or after a few hours away opens
  // on Today (the day's plan on top); a quick look away keeps your place.
  if (place?.view && phoneAway()) place = { view: 'notebook', pageId: dayId(isoToday()) };
  // A first run opens in the novel to write in, or on today's page while
  // there's nothing of yours here yet (signed out, or still catching up).
  if (!place?.view) place = (await lastChapterAnywhere()) ? { view: 'write' } : { view: 'notebook', pageId: dayId(isoToday()) };
  // A daily page opens to today; anything else opens where you left it.
  if (place.view === 'notebook' && (!place.pageId || place.pageId.startsWith('day-'))) place = { view: 'notebook', pageId: dayId(isoToday()) };
  if (place.view === 'notebook') { const p = await getEntry(place.pageId); if (!place.pageId.startsWith('day-') && gone(p)) place = { view: 'notebook', pageId: dayId(isoToday()) }; }
  if (place.view === 'project' || place.view === 'world') { const b = await getEntry(place.id); if (gone(b)) place = { view: 'library' }; }
  if (place.view === 'write' && place.chapterId) { const c = await getEntry(place.chapterId); if (gone(c)) place = { view: 'write' }; }
  if (place.view !== 'write') delete root.dataset.view;
  await go(place);
  setHistoryMode('push');
  // Opened where it belongs (tests wait for this before moving around).
  root.classList.remove('starting');
  root.dataset.started = '1';
  warmRooms();
  // The panes that were open beside come back.
  panes?.restore();
  // A recording cut short (the app closed, the phone died) is kept, not lost.
  const recovered = await recoverRecording().catch((e) => { console.error(e); return null; });
  if (recovered) { toast('A recording that was cut short is kept on today’s page'); await showCapture(recovered); }
  // The home-screen shortcut (long-press the icon, then Capture) opens straight in.
  const asked = new URLSearchParams(location.search);
  // The Capture shortcut while Inkwell is already open: the open window is
  // sent to the shortcut's address (launch_handler in the manifest). Where a
  // phone only brings the window forward, its launch still comes through here.
  // The launch that opened this window was handled just above.
  let first = location.href;
  window.launchQueue?.setConsumer((params) => {
    const same = params.targetURL === first;
    first = null;
    if (!params.targetURL || same) return;
    const sp = new URL(params.targetURL).searchParams;
    if (sp.get('capture')) openCapture();
    if (sp.get('save')) keepShare({ url: sp.get('save'), title: sp.get('title') || '' }).then(landShares).catch((e) => console.error(e));
    if (/^\d{4}-\d{2}-\d{2}$/.test(sp.get('review') || '')) { reviewing = sp.get('review'); reviewAsked(); }
  });
  // The Save to Inkwell bookmark on a computer: the page it was clicked on.
  if (asked.get('save')) await keepShare({ url: asked.get('save'), title: asked.get('title') || '' }).catch((e) => console.error(e));
  if (asked.has('capture') || asked.has('save') || asked.has('share') || asked.has('open') || asked.has('review') || asked.has('connect') || asked.has('tidy') || asked.has('summaries')) history.replaceState(history.state, '', location.pathname);
  if (/^\d{4}-\d{2}-\d{2}$/.test(asked.get('review') || '')) {
    reviewing = asked.get('review');
    // Signed in, wait for this device to catch up first (the review may
    // already have been made on another one); otherwise go now.
    const signedIn = !window.__claude && await sync.backend?.user?.().catch(() => null);
    if (signedIn) { await go({ view: 'notebook', pageId: dayId(reviewing) }); if (await getReview(reviewing)) await reviewAsked(); } else await reviewAsked();
  }
  if (asked.get('capture')) openCapture();
  // The Monday alert links to ?tidy=<Monday>: the pass opens, and fills in as this device catches up.
  if (asked.has('tidy')) showTidy().catch((e) => console.error(e));
  // The monthly alert links to ?summaries: What Claude knows, with the weekly and monthly summaries.
  if (asked.has('summaries')) showClaudeKnows(null).catch((e) => console.error(e));
  if (asked.get('open')) { asking = asked.get('open'); await openAsked(); }
  // A phone alert for Needs you or a note from Claude opens the Desk, where they're listed.
  if (asked.has('desk')) await go({ view: 'desk' });
  // Shared from another app (or shared earlier and not yet placed).
  await landShares();
  tidyShareBlanks().then((rows) => rows.length && applyRemote(rows)).catch((e) => console.error(e));
  if (!syncing) sync.start();
  conflicts.count();
  // Scribe sent here to connect.
  if (asked.get('connect') === 'scribe') connectScribe().catch((e) => console.error(e));
  // Deleted things are remembered for six months, then this device lets go of them.
  forgetDeleted(Date.now() - 182 * 864e5).catch((e) => console.warn(e));
  keepStorage();
  // Old versions thin out: all from two days, hourly for two weeks, daily after.
  setTimeout(() => tidyHistory().catch((e) => console.warn(e)), 8000);
  // Search reads everything once; do it while idle so the first search is quick.
  setTimeout(() => (window.requestIdleCallback || setTimeout)(() => searchIndex().catch((e) => console.warn(e))), 15000);
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js');
}

// A pane opens where it was asked to and leaves the rest (syncing, sharing,
// tidying, recordings) to the main window.
async function startPane() {
  await sync.attach();
  setOwnWorkflows(await byKind('workflow'));
  const place = paneHost()?.placeFor(PANE_ID) || { view: 'notebook', pageId: dayId(isoToday()) };
  await go(place);
  setHistoryMode('push');
  root.classList.remove('starting');
  root.dataset.started = '1';
  paneHost()?.started(PANE_ID);
}

start();

export { $, alts, askServer, besideItem, blankOnce, body, box, boxOpen, canAskServer, captureHere, closePalette, currentBook, dayReview, deskPage, editor, filterPalette, gone, gridTouched, inNotebook, insertSection, isScript, isWoven, listSoon, looseFoot, looseSoon, moveLinePicker, notes, openAsked, openBeside, openBox, openPalette, openProjectBeside, openTalk, paneMoves, panes, plan, planningView, projectPage, pull, reviewAsked, roomTags, root, scribeKept, sectionNames, sendSelectionPicker, setElement, setGridTouched, showClaudeKnows, sideNotes, state, statusEl, store, syncBeside, tagsPage, talkThrough, tidyNudge, view, whenHere, writeOut, writing };
