// A piece's pages (Gather, Shape, Write, Revise, Make, Deliver) and the stage
// board (a world's pieces by stage).
import { isTouch } from '../device.js';
import { keyLabel } from '../keys.js';
import { children, getEntry, byKind } from '../db.js';
import { searchChanged } from '../search.js';
import { popMenu, menuButton, onContextMenu, ask, askText, toast } from '../menu.js';
import { outline, wordCount } from '../model.js';
import { bookMarkdown, download } from '../export.js';
import { toFountain } from '../script.js';
import { dayId } from '../notebook.js';
import { PageStrip, TodayPanel, isLife } from '../pages.js';
import { Nav } from '../nav.js';
import { Frame, lookPicker } from '../frame.js';
import { pieceDoc } from '../drafts.js';
import { areas, bookType, kindName, areaColor, bookOf, worldOf, editedAt, stageOf, nextLabel, setById, stageSetOf, stagesIn } from '../library.js';
import { make } from '../dom.js';
import { isoToday } from '../dates.js';
import { $, askServer, body, boxOpen, canAskServer, captureHere, closePalette, deskPage, editor, filterPalette, gone, hidden, inNotebook, lookPanel, notes, openBox, openPalette, openProjectBeside, plan, planningView, root, setShown, state, store, toggleFocus, togglePageSettings, view, writing } from '../main.js';
import { touch } from './scriptbar.js';
import { currentEditor, notebook } from './notebookview.js';
import { go, openBook, openEntry, remember } from './routing.js';
import { applyRemote } from './syncwiring.js';
import { renderRail } from './rail.js';
import { addPiece, bookMenu, openStages, setStage } from './tidying.js';
import { accountName, askClaudeNotes, newDraft, newDraftFrom, toggleFreshEyes, toggleTalk } from './revising.js';
import { printLater } from './sharing.js';

// ---------- the pages: Gather, Shape, Write, Revise, Make, Deliver ----------

const PAGE_NAMES = { gather: 'Gather', shape: 'Shape', write: 'Write', revise: 'Revise', make: 'Make', deliver: 'Deliver', notes: 'Notes' };
// Views you look at rather than type in: the tabs sit faintly at the top there.
const LOOKING = ['library', 'tags', 'desk', 'plan', 'world', 'project', 'grid', 'production', 'deliver', 'compare', 'stage', 'drawer'];
let strip; // set in wireWorkPages()
let nav; // set in wireWorkPages()
// The rail of rooms and the switch at the top centre (frame.js).
// The world something sits in, for lighting it up in the rail.
async function worldAround(row) {
  for (let r = row, i = 0; r && i < 40; r = r.parent_id && (await getEntry(r.parent_id)), i++) if (r.kind === 'world') return r;
  return null;
}
async function currentWorldId() {
  const v = view();
  const id = v === 'world' ? state.worldId : v === 'project' ? state.bookId : v === 'grid' ? state.gridId : v === 'production' || v === 'deliver' ? state.prodId
    : v === 'stage' ? state.stage?.id : v === 'compare' ? state.compareId : v === 'write' ? state.project?.id : v === 'notebook' && notebook.page?.kind !== 'day' ? notebook.page?.id : null;
  return id ? (await worldAround(await getEntry(id)))?.id || null : null;
}
const RAIL_PROJECTS = 7;
// Every project in your Desk order (what's on stage first, as you dragged
// them): the one order projects come in everywhere.
async function projectOrder() {
  const list = (await byKind('world')).filter((w) => !gone(w));
  const order = deskPage ? await deskPage.order() : [];
  const rank = new Map(order.map((id, i) => [id, i]));
  return list.sort((a, b) => (rank.get(a.id) ?? 1e6) - (rank.get(b.id) ?? 1e6) || editedAt(b) - editedAt(a));
}
// The rail: the first seven in your Desk order, and the project you're in
// as an eighth while you're in it.
async function railProjects() {
  const [all, list, here] = [await areas(), await projectOrder(), await currentWorldId()];
  const byId = new Map(all.map((a) => [a.id, a]));
  const top = list.slice(0, RAIL_PROJECTS);
  const extra = here && !top.some((w) => w.id === here) ? list.find((w) => w.id === here) : null;
  return [...top, ...(extra ? [extra] : [])]
    .map((w) => ({ id: w.id, title: w.title, color: areaColor(byId.get(w.area_id)), current: w.id === here }));
}
// Which of a project's pages a place is, so its rooms slide in work order.
const pageOfPlace = (p) => (p.view === 'stage' ? p.page : { world: 'overview', project: 'overview', write: 'write', grid: 'shape', production: 'make', deliver: 'deliver', compare: 'revise' }[p.view]) || null;
let frame; // set in wireWorkPages()

// Where you are, as a page: on the desk, or in a world or piece, and which of its pages.
async function pageContext() {
  const v = view();
  const at = async (row, active) => {
    if (gone(row)) return { scope: 'desk', active: null };
    if (row.kind === 'world') return { scope: 'world', id: row.id, life: isLife(row), active };
    return { scope: 'piece', id: row.id, life: false, active };
  };
  if (v === 'library') return { scope: 'desk', active: 'library' };
  if (v === 'tags') return { scope: 'desk', active: 'tags' };
  if (v === 'drawer') return { scope: 'desk', active: 'drawer' };
  if (v === 'desk') return { scope: 'desk', active: 'desk' };
  if (v === 'plan') return { scope: 'desk', active: 'today' };
  if (v === 'notebook') {
    const p = notebook.page;
    if (!p || p.kind === 'day') return { scope: 'desk', active: 'today' };
    if (p.kind === 'project') return at(p, 'write');
    const piece = await bookOf(p);
    if (piece) return at(piece, p.fields?.fixesFor ? 'revise' : 'gather');
    const w = await worldOf(p);
    if (w) return at(w, isLife(w) ? 'notes' : 'shape');
    return { scope: 'desk', active: null };
  }
  if (v === 'world') return at(await getEntry(state.worldId), 'overview');
  if (v === 'project') return at(await getEntry(state.bookId), 'overview');
  if (v === 'write') return state.project ? at(state.project, 'write') : null;
  if (v === 'grid') return at(await getEntry(state.gridId), 'shape');
  if (v === 'production') return at(await getEntry(state.prodId), 'make');
  if (v === 'deliver') return at(await getEntry(state.prodId), 'deliver');
  if (v === 'compare') return at(await getEntry(state.compareId), 'revise');
  if (v === 'stage' && state.stage) return at(await getEntry(state.stage.id), state.stage.page);
  return null;
}

let stripView = null;
async function renderStrip() {
  strip.set(await pageContext());
  // A new page starts untucked, so the first tap on it can't shift it under the finger.
  if (view() !== stripView) { stripView = view(); body.classList.remove('typing'); }
  body.classList.toggle('looking', LOOKING.includes(view()));
  $('.topbar').classList.toggle('has-tabs', !$('#page-tabs').hidden);
}

// A tab: the same page at the size you're at.
// The Desk's Catch-up sits at its very bottom; this opens the Desk and scrolls there.
async function goCatchup() {
  await go({ view: 'desk' });
  for (let i = 0; i < 40; i++) {
    const sec = $('.dk-catchup');
    if (sec?.offsetParent) { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    await new Promise((r) => setTimeout(r, 100));
  }
  toast('Catch-up shows here once you’re signed in (the sync button at the top)');
}

async function goPage(id) {
  if (id === 'today') return go({ view: 'notebook', pageId: dayId(isoToday()) });
  if (id === 'drawer') return go({ view: 'drawer' });
  if (id === 'library') return go({ view: 'library', area: null });
  if (id === 'tags') return go({ view: 'tags' });
  if (id === 'week') return go({ view: 'plan', tab: 'week' });
  if (id === 'when' || id === 'plan') return go({ view: 'plan', tab: 'plan' });
  if (id === 'calendar') return plan.goTab('cal');
  if (id === 'calday') return go({ view: 'plan', tab: 'calday' });
  if (id === 'ahead') return go({ view: 'plan', tab: 'ahead' });
  if (id === 'pace') return go({ view: 'plan', tab: 'pace' });
  if (id === 'desk') return go({ view: 'desk' });
  if (id === 'desk-history') return go({ view: 'desk', tab: 'history' });
  if (id === 'catchup') return goCatchup();
  const ctx = await pageContext();
  if (!ctx?.id) return;
  return openPage(await getEntry(ctx.id), id);
}

async function openPage(row, id) {
  if (gone(row)) return;
  if (id === 'overview') return go(row.kind === 'world' ? { view: 'world', id: row.id } : { view: 'project', id: row.id });
  if (row.kind === 'world') return go({ view: 'stage', id: row.id, page: id });
  if (id === 'write') return openBook(row.id);
  if (id === 'make') return go({ view: 'production', id: row.id });
  if (id === 'deliver') return go({ view: 'deliver', id: row.id });
  return go({ view: 'stage', id: row.id, page: id });
}

// Typing on a page you look at tucks the tabs away until the mouse moves.
let altTimer = 0;
let lastMove = null;

// What the pages need from the rest of the app.
async function changedHere(rows) {
  rows = rows.filter(Boolean);
  if (!rows.length) return;
  searchChanged(rows);
  if (rows.some((r) => ['project', 'world', 'page'].includes(r.kind))) renderRail();
  await notebook.applyRemote(rows);
  await todayPanel.refresh();
}

async function revisePiece(action, piece, note) {
  if (action === 'compare') return go({ view: 'compare', id: piece.id });
  if (action === 'draft') return newDraft(piece);
  if (action === 'draft-from') return newDraftFrom(piece);
  if (action === 'print') return printRow(piece);
  if (action === 'comment') { await openEntry(note.parent_id); if (note.fields?.chapter_id) { if (hidden().has('comments')) setShown('comments', true); notes.setVisible(true); } return; }
  await openBook(piece.id);
  if (!writing()) return;
  if (action === 'fresh') toggleFreshEyes(true);
  if (action === 'notes') await askClaudeNotes();
  if (action === 'talk') await toggleTalk();
}

async function printRow(b) {
  if (state.project?.id === b.id) await store.close(editor.state.doc);
  const chapters = await pieceDoc(b.id);
  const words = chapters.reduce((n, ch) => n + ch.blocks.reduce((m, x) => m + wordCount(x.text), 0), 0);
  printLater({ title: b.title, type: bookType(b), chapters, words, author: await accountName() });
}

async function filesOut(kind, b) {
  if (state.project?.id === b.id) await store.close(editor.state.doc);
  if (kind === 'print') return printRow(b);
  const acts = await outline(b.id);
  if (kind === 'fountain') {
    const rows = [];
    for (const act of acts) for (const ch of act.chapters) rows.push(...(await children(ch.id)));
    return download(`${b.title || 'Untitled'}.fountain`, toFountain(b.title, rows));
  }
  if (kind === 'markdown') return download(`${b.title || 'Untitled'}.md`, await bookMarkdown(b, acts));
}

// A world's pages (Gather, Shape, Write…) and the Drawer: loaded the first
// time one opens, and fetched after start by warmRooms.
let stagePage = null;
async function loadStagePage() {
  if (!stagePage) {
    const { StagePage } = await import('../stagepage.js');
    stagePage ||= new StagePage($('#stage-view'), stageHooks);
    window.__stages = stagePage;
  }
  return stagePage;
}
const stageHooks = {
  go: (place) => go(place),
  openEntry: (id) => openEntry(id),
  openBook: (id) => openBook(id),
  menu: (anchor, items) => popMenu(anchor, items),
  menuButton: (items, label) => menuButton(items, label),
  ask, askText, toast,
  askServer: (b) => askServer(b),
  canAsk: () => canAskServer(),
  changed: (rows) => changedHere(rows),
  remember: (place) => remember(place),
  board: (el, w, pieces) => renderBoard(w, pieces, el),
  editStages: (w) => openStages(w),
  revise: (action, piece, note) => revisePiece(action, piece, note),
  newPage: async (parentId) => { await go({ view: 'notebook' }); await notebook.newPage(parentId); },
  newPiece: (parentId) => addPiece(parentId)
};

// Ctrl + Shift + J: today's lines beside whatever you're doing.
let todayPanel; // set in wireWorkPages()

// ---------- the stage board: a world's pieces by stage ----------

function renderBoard(w, pieces, el = $('#wh-board')) {
  // One button on a card moves it to the next status.
  const nextBtn = (p, list) => {
    const label = nextLabel(list, stageOf(p, w));
    if (!label) return null;
    const b = make('button', 'sb-next', label);
    b.type = 'button';
    b.addEventListener('click', (e) => { e.stopPropagation(); setStage(p, list[list.indexOf(stageOf(p, w)) + 1]); });
    return b;
  };
  const touch = isTouch();
  // One row of columns for each set of stages in the world (a Universe can
  // have reels on AI video and a novel on Book); one set needs no label.
  const sets = [...new Set(pieces.map(({ row }) => stageSetOf(row, w).id))].map(setById);
  if (!sets.length) sets.push(setById(w?.fields?.stageFor?.screenplay || 'ai'));
  const rowFor = (set) => stagesIn(set, w).map((stage, i, list) => {
    const col = make('section', 'sb-col' + (i === list.length - 1 ? ' out' : ''));
    col.dataset.stage = stage;
    const mine = pieces.filter(({ row }) => stageSetOf(row, w).id === set.id && stageOf(row, w) === stage);
    const head = make('div', 'sb-head');
    head.append(make('span', '', stage), make('span', 'sb-n', mine.length ? String(mine.length) : ''));
    col.append(head);
    for (const { row: p } of mine) {
      const card = make('button', 'sb-card');
      card.dataset.id = p.id;
      card.append(make('span', 'sb-title', p.title || 'Untitled'), make('span', 'sb-kind', kindName(p)));
      const nb = nextBtn(p, list);
      if (nb) card.append(nb);
      card.addEventListener('click', () => (touch ? popMenu(card, [
        { label: 'Open', run: () => go({ view: 'project', id: p.id }) },
        { label: 'Status', sub: list.map((st) => ({ label: st, current: stageOf(p, w) === st, run: () => setStage(p, st) })) }
      ]) : go({ view: 'project', id: p.id })));
      onContextMenu(card, () => bookMenu(p));
      if (!touch) {
        card.draggable = true;
        card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-piece', p.id); e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
      }
      col.append(card);
    }
    if (!touch) {
      col.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-piece')) { e.preventDefault(); col.classList.add('drop'); } });
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); });
      col.addEventListener('drop', async (e) => {
        const id = e.dataTransfer.getData('text/x-piece');
        col.classList.remove('drop');
        if (!id) return;
        e.preventDefault();
        const p = pieces.find(({ row }) => row.id === id)?.row;
        // A piece only moves along its own set's stages.
        if (p && stageSetOf(p, w).id === set.id && stageOf(p, w) !== stage) await setStage(p, stage);
      });
    }
    return col;
  });
  el.classList.toggle('sb-sets', sets.length > 1);
  if (sets.length === 1) { el.dataset.set = sets[0].id; el.replaceChildren(...rowFor(sets[0])); return; }
  el.replaceChildren(...sets.map((set) => {
    const box = make('div', 'sb-set');
    box.dataset.set = set.id;
    const row = make('div', 'stage-board sb-row');
    row.replaceChildren(...rowFor(set));
    box.append(make('div', 'panel-label', set.name), row);
    return box;
  }));
}

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wireWorkPages() {
  strip = new PageStrip($('#page-tabs'), { pick: (id) => goPage(id) });
  nav = new Nav({
    openBox: (o) => openBox(o),
    closeBox: (refocus) => closePalette(refocus),
    boxOpen: () => boxOpen(),
    go: (place) => go(place),
    goPage: (id) => goPage(id),
    tabs: () => strip.tabs,
    active: () => strip.ctx?.active || null,
    crumb: () => [...document.querySelectorAll('#crumb .crumb-part')],
    search: (text) => { openPalette('go'); const input = $('#palette-input'); input.value = text; filterPalette(); },
    capture: () => captureHere({ start: true }),
    menu: () => openPalette(),
    leaveFocus: () => { if (root.classList.contains('focus')) toggleFocus(); },
    look: () => { if ($('.page-settings').hidden) togglePageSettings(); $('.page-settings').scrollTop = 0; },
    outline: () => body.classList.add('show-outline'),
    isTouch: () => touch.matches,
    keyLabel,
    refocus: () => { if (!touch.matches && (writing() || inNotebook())) currentEditor().commands.focus(); }
  });
  frame = new Frame({
    keyLabel,
    projects: railProjects,
    openProject: (id, { beside = false } = {}) => (beside ? openProjectBeside(id) : go({ view: 'world', id })),
    projectMenu: (id, anchor, at) => popMenu(anchor, [
      { label: 'Open', run: () => go({ view: 'world', id }) },
      { label: planningView() ? 'Open beside the plan (Ctrl + click)' : 'Open beside (Ctrl + click)', run: () => openProjectBeside(id) }
    ], at),
    contents: () => body.classList.toggle('pin-outline'),
    hasContents: () => writing() && !!state.project,
    page: () => strip.ctx?.active || null,
    onDay: () => inNotebook() && !!notebook.page && notebook.page.kind === 'day'
  });
  lookPicker($('.page-settings'));
  lookPanel($('.page-settings'));
  // A phone has no keys, so the menu button says what it is.
  if (touch.matches) document.querySelectorAll('[data-cmd="palette"]').forEach((b) => { b.textContent = 'Menu'; });
  document.addEventListener('keydown', (e) => {
    // The tab numbers show only when Alt is held on its own for a moment, so
    // Alt + Left (Back) or Alt + C never flashes them.
    if (e.key === 'Alt') { if (!e.repeat) { clearTimeout(altTimer); altTimer = setTimeout(() => body.classList.add('alt-held'), 400); } return; }
    if (e.altKey && !/^[0-9]$/.test(e.key)) { clearTimeout(altTimer); body.classList.remove('alt-held'); }
    const t = e.target;
    if (!e.altKey && !e.ctrlKey && !e.metaKey && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName)) && !t.closest('.palette, .topbar')) body.classList.add('typing');
  }, true);
  document.addEventListener('keyup', (e) => { if (e.key === 'Alt') { clearTimeout(altTimer); body.classList.remove('alt-held'); } });
  window.addEventListener('blur', () => { clearTimeout(altTimer); body.classList.remove('alt-held'); });
  document.addEventListener('mousemove', (e) => {
    if (!body.classList.contains('typing')) return;
    // A finger's tap sends a mouse move too; only a real mouse untucks.
    if (e.sourceCapabilities?.firesTouchEvents) return;
    if (lastMove && Math.abs(e.clientX - lastMove[0]) + Math.abs(e.clientY - lastMove[1]) > 12) { body.classList.remove('typing'); lastMove = null; }
    else if (!lastMove) lastMove = [e.clientX, e.clientY];
  });
  todayPanel = new TodayPanel($('.today-panel'), {
    open: (lineId) => go({ view: 'notebook', pageId: dayId(isoToday()), line: lineId }),
    openDay: () => go({ view: 'notebook', pageId: dayId(isoToday()) }),
    added: (rows) => applyRemote(rows),
    focusBack: () => { if (writing() || inNotebook()) currentEditor().commands.focus(); }
  });
  window.__today = todayPanel;
}

export { PAGE_NAMES, filesOut, frame, goCatchup, goPage, loadStagePage, nav, pageOfPlace, projectOrder, railProjects, renderBoard, renderStrip, stagePage, strip, todayPanel, wireWorkPages };
