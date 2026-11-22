// The notebook: daily pages and pages written as lines.
import { calmNow } from '../steady.js';
import { keyboard } from '../keyboard.js';
import { menuButton, toast } from '../menu.js';
import { toggleDone, indentLines, outdentLines, moveLine, foldKey, toggleChecklist, hasBox, toggleBox, canMoveLine, removeLine, lineChecks } from '../outline.js';
import { Notebook } from '../notebook.js';
import { openHandleMenu } from '../handlemenu.js';
import { openPicker } from '../picker.js';
import { inPane } from '../panes.js';
import { addCommands, mod } from './commandlist.js';
import { $, body, editor, inNotebook, root, state, statusEl } from '../main.js';
import { ROOM_ABOVE, ROOM_BELOW, caretRoom, rowEnd, scriptBar, tapBar, touch, typeHere } from './scriptbar.js';
import { openEntry, remember } from './routing.js';
import { applyRemote, applyRemoteChapter } from './syncwiring.js';
import { renderCrumb, renderRail } from './rail.js';
import { pageMenu } from './tidying.js';
import { dayMenu } from './historyview.js';
import { writing } from './commands.js';
import { moveLinePicker, sendSelectionPicker } from './quickinserts.js';
import { captureHere, plan, writeOut } from './talking.js';
import { besideItem, listSoon, paneMoves, planningView, pull, whenHere } from './beside.js';
import { amountsMenu } from '../trainpage.js';

// ---------- notebook ----------

let railTimer;
let notebook; // set in wireNotebook()

// On a phone, a row above the keyboard for outlines. The first screen holds what
// gets used all the time (mic, undo, indent, move, tag, link); Done, Move to…,
// Zoom and + wait at the end of the row.
let outlineBar; // set in wireNotebook()
// The same row, for the lines under a top line in a script's plan
// (planlines.js): indent, outdent, move, fold, undo.
let planEd = null;
let planLines = null;
function planLinesFocus(ed, lines) {
  planEd = ed;
  if (lines) planLines = lines;
  placeOutlineBar();
}
function placeOutlineBar() {
  const inPlan = !!planEd && planEd.isFocused;
  outlineBar.classList.toggle('in-plan', inPlan);
  const show = touch.matches && keyboard.up && (inPlan || (inNotebook() && notebook.editor.isFocused));
  const back = show && outlineBar.hidden;
  outlineBar.hidden = !show;
  if (back) outlineBar.scrollLeft = 0; // a row that comes back starts with the mic in view
  body.classList.toggle('outline-bar-on', show);
  if (!show) return;
  const vv = window.visualViewport;
  outlineBar.style.bottom = `${Math.max(0, vv ? window.innerHeight - (vv.offsetTop + vv.height) : 0)}px`;
  if (inPlan) {
    outlineBar.querySelector('[data-do="undo"]').disabled = !planEd.can().undo();
    outlineBar.querySelector('[data-do="redo"]').disabled = !planEd.can().redo();
    return;
  }
  const here = notebook.currentLine();
  const zoomOut = !!notebook.zoom && here === notebook.zoom;
  outlineBar.querySelector('[data-do="undo"]').disabled = !notebook.editor.can().undo();
  outlineBar.querySelector('[data-do="redo"]').disabled = !notebook.editor.can().redo();
  const z = outlineBar.querySelector('[data-do="zoom"]');
  z.textContent = zoomOut ? 'Out' : 'Zoom';
  z.setAttribute('aria-label', zoomOut ? 'Zoom out' : 'Zoom in');
}
// The six-dot handle's menu for a notebook line (a right-click on its handle,
// or a tap on a phone). Everything here also has a key or a button on the
// phone row; the menu is where you find them.
function findLine(eid) {
  let hit = null;
  notebook.editor.state.doc.descendants((n, pos) => {
    if (hit) return false;
    if (n.type.name === 'listItem' && n.attrs.eid === eid) { hit = { node: n, pos, $pos: notebook.editor.state.doc.resolve(pos) }; return false; }
    return true;
  });
  return hit;
}
function lineMenu(eid) {
  const ed = notebook.editor;
  const line = findLine(eid);
  if (!line) return { sections: [] };
  const { node, pos, $pos } = line;
  const kids = node.lastChild?.type.name === 'bulletList' ? node.lastChild : null;
  let under = 0;
  node.descendants((n) => { if (n.type.name === 'listItem') under++; });
  const folded = !!kids && foldKey.getState(ed.state)?.folded.has(eid);
  const index = $pos.index();
  const nested = $pos.depth > 1;
  const inChecklist = nested && !!$pos.node($pos.depth - 1).attrs.checklist;
  const lines = (n) => `${n} line${n === 1 ? '' : 's'}`;
  // Line actions work on the line the caret is in, so put it there first.
  const here = () => {
    const now = findLine(eid);
    if (!now) return false;
    if (notebook.currentLine() !== eid) ed.commands.setTextSelection(now.pos + 1 + now.node.firstChild.nodeSize - 1);
    return true;
  };
  const on = (fn) => () => { if (here()) fn(); };
  const zoom = { label: 'Zoom in', run: () => { notebook.zoomTo(eid); ed.commands.focus(); } };
  const fold = kids && { label: folded ? `Unfold the ${lines(under)} under it` : `Fold the ${lines(under)} under it`, keys: folded ? '⌘↓' : '⌘↑', run: () => { ed.view.dispatch(ed.state.tr.setMeta(foldKey, { fold: eid, on: !folded })); ed.commands.focus(); } };
  return {
    title: `Line${under ? ` · ${lines(under)} under it` : ''}`,
    sections: [
      [
        // On a phone, Fold leads the menu.
        ...(touch.matches ? [fold, zoom] : [zoom, fold]),
        besideItem(() => ({ view: 'notebook', pageId: notebook.page?.id, zoom: eid })),
        { label: node.attrs.done ? 'Not done' : 'Mark done', keys: '⌘↵', run: on(() => { toggleDone(ed); ed.commands.focus(); }) },
        // On a phone, When is in the bar above the keyboard instead.
        ...(touch.matches ? [] : [{ label: 'When…', keys: 'Alt+W', run: () => setTimeout(async () => { await notebook.store.flush(ed.state.doc); const li = ed.view.dom.querySelector(`li:has(> .line-gutter[data-eid="${CSS.escape(eid)}"])`); plan.pickWhenFor([eid], { anchor: li?.querySelector(':scope > p') || null }); }, 60) }])
      ],
      [
        { label: node.attrs.checklist ? 'Not a checklist' : 'Checklist: boxes on the lines under it', run: on(() => { toggleChecklist(ed); ed.commands.focus(); }) },
        { label: hasBox(node, inChecklist) ? 'No box on this line' : 'Box on this line', run: on(() => { toggleBox(ed); ed.commands.focus(); }) }
      ],
      [
        { label: 'Outdent', keys: '⇧Tab', stay: true, half: 'indent', off: !nested, run: on(() => { ed.commands.focus(); outdentLines(ed); }) },
        { label: 'Indent', keys: 'Tab', stay: true, half: 'indent', off: index === 0, run: on(() => { ed.commands.focus(); indentLines(ed); }) },
        { label: 'Move up', keys: 'Alt+⇧↑', stay: true, half: 'move', off: !canMoveLine(ed.state, -1, pos + 2), run: on(() => moveLine(ed, -1)) },
        { label: 'Move down', keys: 'Alt+⇧↓', stay: true, half: 'move', off: !canMoveLine(ed.state, 1, pos + 2), run: on(() => moveLine(ed, 1)) },
        { label: 'Move to…', run: () => setTimeout(() => sendSelectionPicker([eid]), 120) },
        ...paneMoves([eid], notebook.page?.id)
      ],
      [{ label: under ? `Delete line and the ${lines(under)} under it` : 'Delete line', danger: true, run: () => {
        const now = findLine(eid);
        if (!now) return;
        const tr = ed.state.tr;
        // The page always keeps at least one line.
        if (now.$pos.depth === 1 && now.$pos.parent.childCount === 1) tr.replaceWith(now.pos, now.pos + now.node.nodeSize, ed.schema.nodes.listItem.create(null, ed.schema.nodes.paragraph.create()));
        else removeLine(tr, now.pos);
        ed.view.dispatch(tr);
        ed.commands.focus();
        toast(under ? `Deleted a line and the ${lines(under)} under it` : 'Line deleted', { label: 'Undo', run: () => ed.chain().focus().undo().run() });
      } }]
    ]
  };
}
function keepCaretInView(ed = currentEditor()) {
  // Something just folded and is being held still (src/steady.js): the page
  // doesn't chase the caret meanwhile.
  if (calmNow()) return true;
  if (typewriter()) return holdLine(ed);
  if (!touch.matches || !ed?.isFocused) return false;
  let r;
  try { r = ed.view.coordsAtPos(ed.state.selection.head); } catch { return false; }
  const vv = window.visualViewport;
  const bar = [scriptBar, outlineBar].find((b) => !b.hidden);
  const floor = (bar ? bar.getBoundingClientRect().top : vv ? vv.offsetTop + vv.height : window.innerHeight) - ROOM_BELOW;
  const ceiling = (vv ? vv.offsetTop : 0) + ROOM_ABOVE;
  if (r.bottom > floor) window.scrollBy(0, r.bottom - floor);
  else if (r.top < ceiling) window.scrollBy(0, r.top - ceiling);
  return true;
}
// Typewriter mode: the line you're on stays just above the middle of what
// you can see (above the phone's keyboard), and the page glides under it.
const typewriter = () => root.classList.contains('typewriter');
function holdLine(ed = currentEditor()) {
  if (!ed?.isFocused) return false;
  let r;
  try { r = ed.view.coordsAtPos(ed.state.selection.head); } catch { return false; }
  const vv = window.visualViewport;
  const bar = [scriptBar, outlineBar].find((b) => !b.hidden);
  const top = vv ? vv.offsetTop : 0;
  const bottom = bar ? bar.getBoundingClientRect().top : vv ? vv.offsetTop + vv.height : window.innerHeight;
  const delta = r.top - (top + (bottom - top) * 0.45);
  if (Math.abs(delta) > 3) window.scrollBy({ top: delta, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  return true;
}
function toggleTypewriter() {
  const on = !typewriter();
  root.classList.toggle('typewriter', on);
  try { localStorage.setItem('typewriter', on ? '1' : '0'); } catch { /* private window */ }
  $('#typewriter-mode').checked = on;
  if (on) requestAnimationFrame(() => holdLine());
  toast(on ? 'Typewriter on: the line you’re on stays put' : 'Typewriter off');
}
let caretTimer;
const caretSoon = (ms = 60) => { clearTimeout(caretTimer); caretTimer = setTimeout(() => requestAnimationFrame(() => keepCaretInView()), ms); };

const currentEditor = () => (inNotebook() ? notebook.editor : editor);

// Its commands in the box (Ctrl + K); commandinfo.js has their hints and words.
addCommands(() => [
  { group: 'write', label: 'Zoom into this line', keys: 'click its handle', run: () => notebook.zoomTo(notebook.currentLine()), when: inNotebook },
  { group: 'write', label: 'Zoom out', keys: 'Esc', run: () => notebook.zoomTo(null), when: () => inNotebook() && !!notebook.zoom },
  { group: 'write', label: 'Fold or unfold this line', keys: `${mod}↑ ${mod}↓`, run: () => notebook.toggleFold(), when: inNotebook },
  { group: 'write', label: 'Link to a page…', keys: '[[', run: () => openPicker(currentEditor()), when: () => writing() || inNotebook() },
  { group: 'view', label: 'Typewriter mode: the line you’re on stays put', words: ['scroll', 'center', 'middle'], run: () => toggleTypewriter() },
  { group: 'write', label: 'Bring back gathered lines I deleted', keys: '', run: () => notebook.regather(), when: () => inNotebook() && !!notebook.gatherLine() },
  { group: 'write', label: 'Stop gathering on this line', keys: '', run: () => notebook.stopGather(), when: () => inNotebook() && !!notebook.gatherLine() },
  { group: 'write', label: 'Task: put this line on a day’s plan (again: a plain line)', keys: `${mod}⇧↵`, words: ['todo', 'to-do', 'plan', 'schedule', 'today'], run: () => notebook.toggleTask(), when: inNotebook },
  { group: 'write', label: 'Done: strike this line through', keys: `${mod}↵`, run: () => toggleDone(notebook.editor), when: inNotebook },
  { group: 'write', label: 'Checklist: tick boxes on the lines under this one', keys: '', words: ['todo', 'to-do', 'list', 'checkbox', 'tick'], run: () => toggleChecklist(notebook.editor), when: () => inNotebook() && !lineChecks(notebook.editor.state)?.checklist },
  { group: 'write', label: 'Not a checklist (take the boxes off the lines under this one)', keys: '', words: ['checklist', 'checkbox'], run: () => toggleChecklist(notebook.editor), when: () => inNotebook() && !!lineChecks(notebook.editor.state)?.checklist },
  { group: 'write', label: 'Box on this line (tick it when done; or type [ ] at the start)', keys: '', words: ['checkbox', 'todo', 'to-do', 'tick'], run: () => toggleBox(notebook.editor), when: () => inNotebook() && lineChecks(notebook.editor.state) && !lineChecks(notebook.editor.state).box },
  { group: 'write', label: 'No box on this line (a note, not a thing to do)', keys: '', words: ['checkbox', 'tick'], run: () => toggleBox(notebook.editor), when: () => inNotebook() && !!lineChecks(notebook.editor.state)?.box }
]);

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wireNotebook() {
  notebook = new Notebook({
    onPick: openPicker,
    onOpen: openEntry,
    onStatus: (s) => {
      if (inNotebook()) statusEl.textContent = s === 'saving' ? 'Saving…' : s === 'error' ? 'Not saved — check storage' : 'Saved';
      if (s === 'saved') { listSoon(); plan?.soon(); }
    },
    onTaskChip: (eid, el) => (el?.dataset.train ? amountsMenu(eid, el, { wrote: (rows) => applyRemote(rows).then(() => notebook.redrawMarks()) }) : plan?.chipMenu(eid, el)),
    onTasks: () => plan?.soon(),
    onChange: () => { clearTimeout(railTimer); railTimer = setTimeout(renderRail, 100); },
    // A mirror edited a paragraph of the chapter that's open behind the notebook.
    onSources: (rows) => { if (rows.some((r) => r.parent_id === state.chapterId)) applyRemoteChapter(); },
    // A link pasted or typed on a line of its own: its snapshot is asked for now.
    onLink: () => writeOut(),
    onPlace: (page) => {
      if (!inNotebook()) return;
      remember({ view: 'notebook', pageId: page.id, ...(notebook?.zoom ? { zoom: notebook.zoom } : {}) });
      plan?.showDay(page);
      pull?.setShown(planningView());
      $('#nb-more').replaceChildren(menuButton(() => (page.kind === 'page' ? pageMenu(page) : dayMenu()), page.kind === 'page' ? 'More for this page' : 'More for this day'));
      renderCrumb();
    },
    // Zooming in is a step you can go Back from.
    onZoom: (zoom) => {
      if (!inNotebook() || !notebook.page) return;
      remember({ view: 'notebook', pageId: notebook.page.id, ...(zoom ? { zoom } : {}) });
      if (inPane) renderCrumb();
      pull?.setShown(planningView());
    }
  });
  outlineBar = $('.outline-bar');
  tapBar(outlineBar, 'button[data-do], button[data-end]', (b) => {
    if (b.dataset.end) return rowEnd(b.dataset.end);
    const act = b.dataset.do;
    if (outlineBar.classList.contains('in-plan')) { planLines?.act(act); placeOutlineBar(); return; }
    const ed = notebook.editor;
    if (act === 'talk') captureHere({ start: true });
    else if (act === 'undo') ed.chain().focus().undo().run();
    else if (act === 'redo') ed.chain().focus().redo().run();
    else if (act === 'done') toggleDone(ed);
    else if (act === 'when') setTimeout(() => whenHere(), 120);
    else if (act === 'move') setTimeout(moveLinePicker, 120); // after the tap's click, so it doesn't land on the menu
    else if (act === 'indent') { ed.commands.focus(); indentLines(ed); }
    else if (act === 'outdent') { ed.commands.focus(); outdentLines(ed); }
    else if (act === 'up' || act === 'down') moveLine(ed, act === 'up' ? -1 : 1);
    else if (act === 'tag') typeHere(ed, '#');
    else if (act === 'insert') typeHere(ed, '/');
    else if (act === 'link') openPicker(ed);
    else if (act === 'zoom') { const here = notebook.currentLine(); notebook.zoomTo(notebook.zoom && here === notebook.zoom ? null : here); ed.commands.focus(); }
    placeOutlineBar();
  });
  notebook.editor.view.dom.addEventListener('line-menu', (e) => {
    const { eid, anchor, at } = e.detail;
    const li = anchor.closest('li');
    li?.classList.add('menu-open');
    openHandleMenu({ anchor, at, editor: notebook.editor, build: () => lineMenu(eid), onClose: () => { li?.classList.remove('menu-open'); placeOutlineBar(); } });
  });
  // On a phone, a standing rule: the caret always sits clear above the keyboard
  // and the row, with a line to spare, however it got there (a tap, typing,
  // zooming, moving a line, or the keyboard opening). The page only moves when
  // the caret would be hidden, and only as far as it must, so typing never
  // makes it jump. ProseMirror's own scrolling defers to this on a phone.
  for (const ed of [editor, notebook.editor]) {
    ed.view.setProps({ scrollMargin: caretRoom, scrollThreshold: caretRoom, handleScrollToSelection: () => (typewriter() ? holdLine(ed) : touch.matches && keepCaretInView(ed)) });
  }
  for (const ed of [editor, notebook.editor]) { ed.on('selectionUpdate', () => caretSoon(typewriter() ? 0 : 60)); ed.on('focus', () => caretSoon(250)); }
  window.visualViewport?.addEventListener('resize', () => caretSoon(120));
  window.visualViewport?.addEventListener('scroll', () => caretSoon(200));
  notebook.editor.on('transaction', placeOutlineBar);
  notebook.editor.on('focus', placeOutlineBar);
  notebook.editor.on('blur', () => setTimeout(placeOutlineBar, 50));
  window.visualViewport?.addEventListener('resize', placeOutlineBar);
  window.visualViewport?.addEventListener('scroll', placeOutlineBar);
}

export { caretSoon, currentEditor, notebook, placeOutlineBar, planLinesFocus, toggleTypewriter, wireNotebook };
