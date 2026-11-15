import './keyboard.js';
import './device.js';
import './style.css';
import './frame.css';
import './desk.css';
import './plan.css';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EntryIds, SceneBreak, sectionName, SECTION_NAMES } from './schema.js';
import './keys.js';
import './stats.js';
import { AltMark, ParagraphVersions, AltPanel, newParagraphVersion } from './alts.js';
import { ChapterStore } from './chapter.js';
import { NotesLayer } from './notes.js';
import { BlockHandle } from './blocks.js';
import './order.js';
import { getMeta, setMeta, putEntries, children, getEntry, byKind, forgetDeleted, isTrashed } from './db.js';
import './trash.js';
import { searchIndex } from './search.js';
import { tidyHistory } from './history.js';
import './stageedit.js';
import { popMenu, ask, askText, showCopy, toast } from './menu.js';
import './sync.js';
import { hasWriting, entry, noteTypes } from './model.js';
import './export.js';
import { EntryRef, TagMarks } from './outline.js';
import './links.js';
import { keepStorage } from './keep.js';
import { moveEntries } from './move.js';
import './conflicts.js';
import { FileEmbed } from './filenode.js';
import { MAX_BYTES } from './files.js';
import { pageMarkdown } from './vault.js';
import { ScriptElements, ELEMENTS, elementLabel, SceneCodes } from './script.js';
import { titleOf, dayId } from './notebook.js';
import { setLineDragOut, dropLineAt } from './outline.js';
import { SlashMenu, slashOpen } from './slash.js';
import { Woven, newScene, placeList } from './woven.js';
import './wovenlook.js';
import './production.js';
import './handlemenu.js';
import './alerts.js';
import './savebutton.js';
import { openPicker } from './picker.js';
import './grid.js';
import { taskHint } from './pages.js';
import './nav.js';
import { startLook } from './frame.js';
import './stages.js';
import { CaptureScreen, writeOutPending, recoverRecording, writeOutAgain, requeueBlank } from './capture.js';
import { onVoiceChip, switchVoice, voiceText, voiceInfo, knownModes, fetchModes, placeDraft, placeVoice, placeScribeWaiting, RAW } from './voice.js';
import { takeShares, snapshotPending, tidyShareBlanks, keepShare } from './share.js';
import { SAVE_CHANNEL } from './inbox.js';
import { LISTS, listOf, setList, fillList } from './lists.js';
import { meetingPending, addMeetingFile, meetingFromLine, audioOn, renameSpeaker, speakersOn, mine, sendMeetingToAcro } from './meeting.js';
import { DayReview, getReview } from './review.js';
import { TagsPage } from './tags.js';
import { DeskPage } from './desk.js';
import { ProjectPage } from './projectpage.js';
import { Plan, tabFor, isCal } from './plan.js';
import { Pull } from './pull.js';
import './when.js';
import './box.js';
import './commandinfo.js';
import './shows.js';
import { Through } from './through.js';
import { looseOn } from './loose.js';
import { loadTasks, addTask, stepsHome } from './tasks.js';
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
import './claudeknows.js';
import './tidypass.js';
import './sharelink.js';
import { ensureAreas, areas, bookType, areaColor, pagesIn, bookOf, worldOf, setOwnWorkflows } from './library.js';
import './dom.js';
import { isoToday } from './dates.js';
import { touch, wireScriptBar } from './app/scriptbar.js';
import { currentEditor, notebook, wireNotebook } from './app/notebookview.js';
import { besideUntil, go, historyMode, lastChapterAnywhere, lastPlace, openEntry, paneStep, phoneAway, placeOf, setBesideUntil, setHistoryMode, wireRouting } from './app/routing.js';
import { applyRemote, caretAfter, conflicts, migrateOnce, seedIfEmpty, seedNow, setCaretAfter, sync, wireSync } from './app/syncwiring.js';
import { biblePlaces, connectScribe, numbering, refreshWords, scenePop, wireManuscript } from './app/manuscript.js';
import { renderCrumb, scheduleScenes, wireRail } from './app/rail.js';
import './app/tidying.js';
import { nextDate, renderWorld, wireLibraryView } from './app/libraryview.js';
import { wireRevising } from './app/revising.js';
import { warmRooms, wireSharing } from './app/sharing.js';
import './app/productionwiring.js';
import { frame, nav, projectOrder, railProjects, wireWorkPages } from './app/workpages.js';
import { wireHistory } from './app/historyview.js';
import { hidden, setShown, wirePageSettings } from './app/pagesettings.js';
import { wireCommands, writing } from './app/commands.js';
import { closePalette, menuSpot, sendSelectionPicker, showClaudeKnows, showTidy, wireQuickInserts } from './app/quickinserts.js';

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

wireHistory();

wirePageSettings();

wireCommands();

wireQuickInserts();

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

export { $, alts, askServer, besideItem, blankOnce, blocks, body, canAskServer, capture, captureHere, connectCalendar, dayReview, deskPage, editor, fixSpeaker, flipPlan, fromRecordingFile, gone, gridTouched, inNotebook, inToday, insertSection, isScript, isWoven, listSoon, looseFoot, looseSoon, makeList, makeMeeting, meetingToAcro, notes, openAsked, openBeside, openModes, openProjectBeside, openTalk, paneKeys, paneMoves, panes, plan, planningView, projectPage, pull, pullFromProject, reviewAsked, root, scribeKept, sectionNames, setElement, setGridTouched, sideNotes, state, statusEl, store, syncBeside, tagsPage, talkThrough, through, todayKey, toggleBesidePane, tooBig, view, whenHere, writeLineOutAgain, writeOut };
