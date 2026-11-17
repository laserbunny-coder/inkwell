// Inkwell starts here. This file makes the editor and the few things every
// part of the app shares (state, the chapter store, the notes layer), then
// sets up each part in turn, in the order they need each other: each part
// lives in src/app/ (getting around in routing.js, the command box in
// commands.js, and so on) and its wire…() function runs here, in the place
// its code always ran. start() at the end opens the app.
import './keyboard.js';
import './device.js';
import './style.css';
import './frame.css';
import './desk.css';
import './plan.css';
import './zoom.css';
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
import { getMeta, setMeta, getEntry, byKind, forgetDeleted, isTrashed } from './db.js';
import './trash.js';
import { searchIndex } from './search.js';
import { tidyHistory } from './history.js';
import './stageedit.js';
import { toast } from './menu.js';
import './sync.js';
import { hasWriting } from './model.js';
import './export.js';
import { EntryRef, TagMarks } from './outline.js';
import './links.js';
import { keepStorage } from './keep.js';
import './move.js';
import './conflicts.js';
import { FileEmbed } from './filenode.js';
import { MAX_BYTES } from './files.js';
import { pageMarkdown } from './vault.js';
import { ScriptElements, ELEMENTS, elementLabel, SceneCodes } from './script.js';
import { dayId } from './notebook.js';
import './outline.js';
import { SlashMenu, slashOpen } from './slash.js';
import { Woven, newScene, placeList } from './woven.js';
import './wovenlook.js';
import './production.js';
import './handlemenu.js';
import './alerts.js';
import './savebutton.js';
import { openPicker } from './picker.js';
import './grid.js';
import './pages.js';
import './nav.js';
import { startLook } from './frame.js';
import './stages.js';
import { recoverRecording } from './capture.js';
import './voice.js';
import { tidyShareBlanks, keepShare } from './share.js';
import './inbox.js';
import './lists.js';
import './meeting.js';
import { getReview } from './review.js';
import './tags.js';
import './desk.js';
import './projectpage.js';
import './plan.js';
import './pull.js';
import './when.js';
import './box.js';
import './commandinfo.js';
import './shows.js';
import './through.js';
import './loose.js';
import './tasks.js';
import { setFont } from './fonts.js';
import './drafts.js';
import './compare.js';
import { inPane, PANE_ID, host as paneHost } from './panes.js';
import './sidenotes.js';
import './talk.js';
import './hstrip.js';
import './hstrip.css';
import './ahead.js';
import './calendar.js';
import './claudenotes.js';
import './claudeknows.js';
import './tidypass.js';
import './sharelink.js';
import { ensureAreas, pagesIn, worldOf, setOwnWorkflows } from './library.js';
import './dom.js';
import { isoToday } from './dates.js';
import { wireScriptBar } from './app/scriptbar.js';
import { notebook, wireNotebook } from './app/notebookview.js';
import { go, historyMode, lastChapterAnywhere, openEntry, phoneAway, setHistoryMode, wireRouting } from './app/routing.js';
import { applyRemote, conflicts, migrateOnce, seedIfEmpty, seedNow, sync, wireSync } from './app/syncwiring.js';
import { biblePlaces, connectScribe, numbering, refreshWords, scenePop, wireManuscript } from './app/manuscript.js';
import { scheduleScenes, wireRail } from './app/rail.js';
import './app/tidying.js';
import { wireLibraryView } from './app/libraryview.js';
import { wireRevising } from './app/revising.js';
import { warmRooms, wireSharing } from './app/sharing.js';
import './app/productionwiring.js';
import { wireWorkPages } from './app/workpages.js';
import { wireHistory } from './app/historyview.js';
import { wirePageSettings } from './app/pagesettings.js';
import { wireCommands } from './app/commands.js';
import { sendSelectionPicker, showClaudeKnows, showTidy, wireQuickInserts } from './app/quickinserts.js';
import { asking, landShares, openAsked, openCapture, setAsking, showCapture, wireTalking } from './app/talking.js';
import { besideItem, paneMoves, panes, reviewAsked, reviewing, setReviewing, wireBeside } from './app/beside.js';
import { wireZoom } from './app/zoom.js';

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

wireTalking();

wireBeside();
wireZoom();

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
    if (/^\d{4}-\d{2}-\d{2}$/.test(sp.get('review') || '')) { setReviewing(sp.get('review')); reviewAsked(); }
  });
  // The Save to Inkwell bookmark on a computer: the page it was clicked on.
  if (asked.get('save')) await keepShare({ url: asked.get('save'), title: asked.get('title') || '' }).catch((e) => console.error(e));
  if (asked.has('capture') || asked.has('save') || asked.has('share') || asked.has('open') || asked.has('review') || asked.has('connect') || asked.has('tidy') || asked.has('summaries')) history.replaceState(history.state, '', location.pathname);
  if (/^\d{4}-\d{2}-\d{2}$/.test(asked.get('review') || '')) {
    setReviewing(asked.get('review'));
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
  if (asked.get('open')) { setAsking(asked.get('open')); await openAsked(); }
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

export { $, alts, blocks, body, editor, gone, gridTouched, inNotebook, insertSection, isScript, isWoven, notes, root, sectionNames, setElement, setGridTouched, state, statusEl, store, tooBig, view };
