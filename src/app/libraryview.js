// The Library, a book's home, a world's home (its pieces and its bible) and
// the plot grid.
import { pieceHead } from './piecehead.js';
import { getMeta, putEntries, children, getEntry, byKind } from '../db.js';
import { newWorkflow } from '../stageedit.js';
import { popMenu, menuButton, onContextMenu, ask, askText, toast } from '../menu.js';
import { outline } from '../model.js';
import { titleOf } from '../notebook.js';
import { PlotGrid, worldPromises, pieceRows } from '../grid.js';
import { isLife, personalArea, partsFor } from '../pages.js';
import { pieceIndex, pickOf, setPick, fits, chipList, lineFor } from '../ideapieces.js';
import { openParts, setPartOpen, pieceLine, inIdeaOrder, setIdeaOrder, stepKeys } from '../projectoutline.js';
import { arrangeable, movableRow, refocus } from '../listkit.js';
import { gatherItems } from '../stages.js';
import { dayWord } from '../tasks.js';
import { newPage as pagesNew, isFinished, areas, bookType, hasManuscript, kindName, areaColor, newArea, pagesIn, loosePages, bookOf, stats, dailyMentions, ago, worlds, worldOf, piecesIn, worldTree, worldStats, usedLabels, SHAPES, shapeOf, nextLevel, newShaped, editedAt, defaultLabel, stageOf, nextLabel, setForNew, typeForSet, stageSetOf, stagesOf, isReady, isOut, toolsOf } from '../library.js';
import { make } from '../dom.js';
import { isoToday, isoOf } from '../dates.js';
import { addCommands } from './commandlist.js';
import { $, editor, gone, notes, setGridTouched, state, store, view } from '../main.js';
import { go, openBook, openEntry } from './routing.js';
import { areaPath, dot, renameable, renderCrumb, renderRail, subtree } from './rail.js';
import { placeAmong, stepAmong, toTrash, setLife, reopenWorld, KINDS, actMenu, addPiece, areaMenu, bookMenu, chapterMenu, deleteOwn, keepOwn, moveBookToArea, openStages, ownUsedBy, pageMenu, personalAreaId, plural, refreshViews, renderTrash, setKind, setStage, worldMenu } from './tidying.js';
import { renderBoard } from './workpages.js';
import { notebook } from './notebookview.js';
import { applyRemote } from './syncwiring.js';
import { askServer, canAskServer, deskPage, plan, projectPage } from './talking.js';
import { seatMap, seatWord } from './seats.js';
let worldDates = []; // the open project's dated things besides its steps (shoot days)

// ---------- library view ----------

// How books are ordered in the Library, per device.
const libSort = () => { try { return localStorage.getItem('libSort') || 'recent'; } catch { return 'recent'; } };
// Your own order: a number on each book (synced, so it's the same on every
// device). Books never placed yet follow, most recently edited first.
const ORDER_KEY = (b) => b.fields?.order ?? Infinity;
const byMyOrder = (a, b) => ORDER_KEY(a) - ORDER_KEY(b) || editedAt(b) - editedAt(a);

// Put a world just before (or after) another one in your order.
async function placeBook(bookId, targetId, after = false) {
  if (bookId === targetId) return;
  const list = (await worlds()).sort(byMyOrder);
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
  const list = shown.length && shown.includes(book.id) && libSort() === 'custom' ? shown : (await worlds()).sort(byMyOrder).map((b) => b.id);
  const i = list.indexOf(book.id);
  const target = list[i + dir];
  if (target) await placeBook(book.id, target, dir > 0);
}

async function renderLibrary() {
  const [allAreas, allBooks, loose] = await Promise.all([areas(), worlds(), loosePages()]);
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
  const info = new Map();
  for (const w of allBooks) if (!ids || ids.has(w.area_id)) info.set(w.id, await worldStats(w));
  const recent = (w) => info.get(w.id)?.edited || w.updated_at;
  const inArea = allBooks.filter((b) => !ids || ids.has(b.area_id));
  const shown = inArea.filter((b) => !isFinished(b))
    .sort(sort === 'custom' ? byMyOrder : sort === 'title' ? (a, b) => (a.title || '').localeCompare(b.title || '', undefined, { numeric: true }) : sort === 'made' ? (a, b) => b.created_at - a.created_at : (a, b) => recent(b) - recent(a));
  const sortSel = $('#lib-sort');
  sortSel.value = sort;
  sortSel.onchange = () => { try { localStorage.setItem('libSort', sortSel.value); } catch { /* full */ } renderLibrary(); };
  const cards = [];
  for (const b of shown) {
    const area = allAreas.find((a) => a.id === b.area_id);
    const s = info.get(b.id);
    const card = make('button', 'card');
    const kind = make('span', 'card-kind');
    // A world says what's in it: its one piece, how many pieces, or just pages.
    const top = s.pieces.filter((p) => p.depth === 0).map((p) => p.row);
    const shape = shapeOf(b, top.length);
    const what = shape.id !== 'one' ? shape.name.toLowerCase() : top.length === 1 && !s.pieces.slice(1).length ? kindName(top[0]).toLowerCase() : s.pieces.length ? 'collection' : 'pages';
    kind.append(dot(areaColor(area)), document.createTextNode(`${area?.title || 'No area'} · ${what}`));
    const n = (x, word) => `${x} ${word}${x === 1 ? '' : 's'}`;
    const detail = [
      s.pieces.length > 1 && n(s.pieces.length, 'piece'),
      s.chapters.length > 1 && n(s.chapters.length, 'chapter'),
      s.words && `${s.words.toLocaleString()} words`,
      s.pages.length && n(s.pages.length, 'page')
    ].filter(Boolean).join(' · ') || 'Empty so far';
    card.append(kind, make('span', 'card-title', b.title || 'Untitled'), make('span', 'card-detail', detail), make('span', 'card-when', `Edited ${ago(s.edited)}`));
    card.addEventListener('click', () => go({ view: 'world', id: b.id }));
    onContextMenu(card, () => worldMenu(b));
    const wrap = make('div', 'card-wrap');
    wrap.dataset.id = b.id;
    wrap.append(card, menuButton(() => worldMenu(b), `More for ${b.title || 'this world'}`));
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
  add.append(make('span', 'plus', '+'), make('span', '', 'New: a novel, a show, a book series, a life project…'));
  add.addEventListener('click', () => showNewBook('novel'));
  cards.push(add);
  $('#lib-books').replaceChildren(...cards);

  // Area choices for the new-book form.
  const opts = await areaOptions(allAreas);
  state.allAreas = allAreas;
  $('#lib-new-area').replaceChildren(...opts.map(([id, label]) => { const o = make('option', '', label); o.value = id; return o; }));
  $('#lib-new-area').value = sel || allAreas[0]?.id || '';

  // Loose pages, each with somewhere to move it.
  const bookOpts = allBooks.slice().sort((a, b) => a.title.localeCompare(b.title));
  $('#lib-loose').replaceChildren(...loose.map((p) => {
    const li = make('li');
    const open = make('button', 'loose-title', p.title || 'Untitled page');
    open.addEventListener('click', () => go({ view: 'notebook', pageId: p.id }));
    const move = make('select', 'move');
    move.setAttribute('aria-label', `Move ${p.title || 'page'} to a world`);
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
  renderFinished(inArea.filter(isFinished));
  await renderTrash();
  await renderZoomLibrary(allAreas, allBooks);
}

// The Library in the zoom (Part 4): On stage (the Desk) first, then every
// area with each project and its seat word, the Finished shelf, then the
// Drawer, the daily pages, Tags and Trash under "Also here". A quiet + at the
// end of each area's list starts a new project there. A project can be
// carried onto a seat (the bar above the ruler) or right-clicked for it.
async function renderZoomLibrary(allAreas, allBooks) {
  const box = $('#lib-zoom');
  box.hidden = false;
  if (box.hidden) { box.replaceChildren(); return; }
  const seats = await seatMap();
  const order = await deskPage.order().catch(() => []);
  const rank = (w) => { const i = order.indexOf(w.id); return i < 0 ? 1e6 : i; };
  const live = allBooks.filter((w) => !isFinished(w)).sort((a, b) => rank(a) - rank(b) || (a.title || '').localeCompare(b.title || ''));
  const chip = (w) => {
    const c = make('button', 'zl-chip', w.title || 'Untitled');
    c.type = 'button';
    c.dataset.pid = w.id;
    c.draggable = true;
    c.addEventListener('click', () => go({ view: 'world', id: w.id }));
    return c;
  };
  const parts = [];
  const stage = make('section', 'zl-stage');
  stage.dataset.seat = 'on';
  const into = make('button', 'zl-h zl-into', 'On stage: the Desk');
  into.type = 'button';
  into.title = 'Into the Desk (6)';
  into.addEventListener('click', () => go({ view: 'desk' }));
  const on = live.filter((w) => seats.get(w.id) === 'on');
  const chips = make('div', 'zd-chips');
  chips.append(...on.map(chip));
  if (!on.length) chips.append(make('span', 'zd-none', 'Nothing is on stage.'));
  stage.append(into, chips);
  parts.push(stage);

  const areaIds = [...allAreas.map((a) => a.id), ''];
  const grid = make('div', 'zl-areas');
  for (const id of areaIds) {
    const list = live.filter((w) => (w.area_id || '') === id || (!id && !allAreas.some((a) => a.id === w.area_id)));
    const area = allAreas.find((a) => a.id === id);
    if (!list.length && (!area || area.parent_id)) continue;
    const sec = make('section', 'zl-area');
    const h = make('div', 'zl-h');
    h.append(dot(areaColor(area)), document.createTextNode(area?.title || 'No area'));
    // Its ⋯: rename, Move up / Move down among the areas, Move inside, Trash.
    sec.append(h);
    if (area) {
      onContextMenu(h, () => areaMenu(area));
      const more = menuButton(() => areaMenu(area), `More for ${area.title}`);
      more.classList.add('zl-area-more');
      sec.append(more);
    }
    for (const w of list) {
      const row = make('div', 'zl-row');
      row.dataset.pid = w.id;
      row.draggable = true;
      const name = make('button', 'zl-name', w.title || 'Untitled');
      name.type = 'button';
      name.addEventListener('click', () => go({ view: 'world', id: w.id }));
      const seat = seats.get(w.id) || 'back';
      const word = make('button', `zl-seat s-${seat}`, seatWord(seat));
      word.type = 'button';
      word.dataset.seatfor = w.id;
      word.title = 'Where it sits (Alt + S)';
      row.append(name, word, menuButton(() => worldMenu(w), `More for ${w.title || 'this project'}`));
      sec.append(row);
    }
    if (area) {
      const add = make('button', 'zl-add', '+');
      add.type = 'button';
      add.title = `A new project in ${area.title}`;
      add.setAttribute('aria-label', add.title);
      add.addEventListener('click', async () => { await showNewBook('novel'); $('#lib-new-area').value = area.id; });
      sec.append(add);
    }
    grid.append(sec);
  }
  const plusArea = addAreaChip(null);
  plusArea.className = 'zl-add zl-newarea';
  plusArea.textContent = '+ area';
  grid.append(plusArea);
  parts.push(grid);

  const done = allBooks.filter(isFinished).sort((a, b) => b.fields.finished - a.fields.finished);
  const shelf = make('section', 'zl-done');
  shelf.dataset.seat = 'done';
  shelf.append(make('div', 'zl-h', 'Finished shelf'));
  const dchips = make('div', 'zd-chips');
  dchips.append(...done.map(chip));
  if (!done.length) dchips.append(make('span', 'zd-none', 'Nothing finished yet. Carry a project here when it’s done.'));
  shelf.append(dchips);
  parts.push(shelf);

  const also = make('section', 'zl-also');
  also.append(make('div', 'zl-h', 'Also here'));
  const achips = make('div', 'zd-chips');
  const jump = (label, run, title = '') => { const b = make('button', 'zl-chip', label); b.type = 'button'; if (title) b.title = title; b.addEventListener('click', run); achips.append(b); };
  jump('Drawer', () => go({ view: 'drawer' }), 'Sparks and ideas not in a project yet');
  jump('Daily pages', () => go({ view: 'notebook', pageId: `day-${isoToday()}` }), 'Today’s page; the days before it are a step back');
  jump('Tags', () => go({ view: 'tags' }));
  const trash = $('#lib-trash-box');
  if (!trash.hidden) jump('Trash', () => { trash.open = true; trash.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  also.append(achips);
  parts.push(also);
  box.replaceChildren(...parts);
}

// "today", "yesterday", "Nov 12": when a project was finished.
const finishedWord = (w) => { const d = dayWord(isoOf(new Date(w.fields.finished))); return /^(Today|Yesterday)$/.test(d) ? d.toLowerCase() : d; };
// The Finished shelf: projects you've finished, newest first, in the area
// you're looking at. Open looks back; Reopen brings one back to the Desk.
function renderFinished(list) {
  const box = $('#lib-done-box');
  box.hidden = !list.length;
  $('#lib-done-count').textContent = list.length ? `(${list.length})` : '';
  $('#lib-done').replaceChildren(...list.sort((a, b) => b.fields.finished - a.fields.finished).map((w) => {
    const li = make('li');
    const open = make('button', 'loose-title', w.title || 'Untitled');
    open.addEventListener('click', () => go({ view: 'world', id: w.id }));
    onContextMenu(open, () => worldMenu(w));
    const back = make('button', 'ghost-btn', 'Reopen');
    back.addEventListener('click', () => reopenWorld(w));
    li.append(open, make('span', 'when', `Finished ${finishedWord(w)}`), back, menuButton(() => worldMenu(w), `More for ${w.title || 'this project'}`));
    return li;
  }));
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

// New: what are you making? The shape can change any time from the ⋯ menu.
let newShape = 'one';
let newHow; // set in wireLibraryView()
const pickHow = (force) => newHow.pick(setForNew(newShape, $('#lib-new-type').value), { force });
function pickShape(id, force) {
  // A life project starts out in Personal (offered as a new area if there
  // isn't one); picking another shape puts back the area that was chosen.
  const sel = $('#lib-new-area');
  if (id === 'life' && newShape !== 'life') {
    sel.dataset.before = sel.value;
    const home = personalArea(state.allAreas || []);
    if (home) sel.value = home.id;
    else {
      const o = make('option', '', 'Personal (new area)');
      o.value = '__personal';
      sel.append(o);
      sel.value = '__personal';
    }
  } else if (id !== 'life' && newShape === 'life') {
    sel.querySelector('option[value="__personal"]')?.remove();
    if (sel.dataset.before !== undefined) sel.value = sel.dataset.before;
  }
  newShape = id;
  pickHow(force);
  $('#lib-new-shapes').querySelectorAll('.lib-shape').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.shape === id)));
  $('#lib-new-type-box').hidden = id !== 'one';
  const sh = SHAPES.find((x) => x.id === id);
  $('#lib-new-levels').textContent = sh.levels.length ? `Starts with ${id === 'show' ? 'Season 1 and Episode 1' : id === 'series' ? 'Book 1' : 'nothing yet'}. New pieces inside are ${sh.levels.map((l) => l.label + 's').join(', then ')}.` : id === 'universe' ? 'Put a Show, a Book series or a Film inside; they all share one bible.' : '';
}

async function showNewBook(type = 'novel', shape = 'one') {
  if (view() !== 'library') await go({ view: 'library' });
  const form = $('#lib-new');
  form.hidden = false;
  $('#lib-new-type').value = type === 'notes' ? 'world' : type;
  newHow.reset();
  newShape = '';
  delete $('#lib-new-area').dataset.before;
  pickShape(shape, true);
  $('#lib-new-title').value = '';
  $('#lib-new-title').focus();
}
// The workflow picked at New: its kind of piece (and outlines, which go the
// project's way) goes through it, with any steps and tools you customized.
async function useWorkflow(world, how) {
  const w = await getEntry(world.id);
  const stageFor = { ...(w.fields?.stageFor || {}) };
  for (const t of [typeForSet(how.set), 'lines']) if (stageSetOf({ fields: { type: t } }, w).id !== how.set) stageFor[t] = how.set;
  const fields = { ...w.fields, stageFor, stageLists: { ...(w.fields?.stageLists || {}), ...how.stageLists }, toolLists: { ...(w.fields?.toolLists || {}), ...how.toolLists } };
  for (const k of ['stageFor', 'stageLists', 'toolLists']) if (!Object.keys(fields[k]).length) delete fields[k];
  if (JSON.stringify(fields) !== JSON.stringify(w.fields)) await putEntries([{ ...w, fields, updated_at: Date.now() }]);
}

// ---------- a book's home ----------

async function renderProject() {
  const b = await getEntry(state.bookId);
  if (gone(b)) return go({ view: 'library' });
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
  $('#ph-more').replaceChildren(menuButton(() => bookMenu(b), 'More for this piece'));
  const kindSel = $('#ph-kind');
  const formats = bookType(b) === 'notes' ? [...KINDS, ['notes', 'Pages']] : KINDS;
  kindSel.replaceChildren(...formats.map(([id, label]) => Object.assign(make('option', '', label), { value: id })));
  kindSel.value = bookType(b);
  kindSel.onchange = async () => { const to = kindSel.value; kindSel.value = bookType(b); await setKind(b, to); };
  // What it is, in your own words: type over it; earlier labels are offered.
  const label = $('#ph-label');
  label.value = kindName(b);
  $('#piece-labels').replaceChildren(...(await usedLabels()).map((v) => Object.assign(make('option'), { value: v })));
  label.onchange = async () => {
    const fresh = await getEntry(b.id);
    const v = label.value.trim();
    const fields = { ...fresh.fields };
    if (v && v !== defaultLabel(bookType(fresh))) fields.label = v; else delete fields.label;
    if (JSON.stringify(fields) === JSON.stringify(fresh.fields)) return;
    await putEntries([{ ...fresh, fields, updated_at: Date.now() }]);
    renderRail();
  };
  label.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); label.blur(); } };
  const world = await worldOf(b);
  const stageSel = $('#ph-stage');
  stageSel.replaceChildren(...stagesOf(b, world).map((st) => Object.assign(make('option', '', st), { value: st })));
  stageSel.value = stageOf(b, world);
  stageSel.onchange = () => setStage(b, stageSel.value);
  // In the zoom: its stage as small dots under its name (click one to set it).
  const dots = $('#ph-dots');
  dots.hidden = false;
  {
    const list = stagesOf(b, world);
    const here = list.indexOf(stageOf(b, world));
    dots.replaceChildren(...list.map((st, i) => {
      const d = make('button', `zp-dot${i <= here ? ' on' : ''}${i === here ? ' here' : ''}`);
      d.type = 'button';
      d.title = st;
      d.setAttribute('aria-label', `${st}${i === here ? ' (now)' : ''}`);
      if (i === here) d.setAttribute('aria-current', 'step');
      d.addEventListener('click', () => setStage(b, st));
      return d;
    }), make('span', 'zp-word', list[here] || ''));
  }
  // The one button that moves it on; the menu beside it goes back or skips.
  const next = $('#ph-next');
  const nl = nextLabel(stagesOf(b, world), stageOf(b, world));
  next.hidden = !nl;
  next.textContent = nl || '';
  next.onclick = () => { const l = stagesOf(b, world); setStage(b, l[l.indexOf(stageOf(b, world)) + 1]); };
  $('#ph-stats').textContent = bookType(b) === 'screenplay'
    ? `${s.words.toLocaleString()} words`
    : novel
    ? `${s.words.toLocaleString()} words · ${s.chapters.length} chapter${s.chapters.length === 1 ? '' : 's'}`
    : `${s.pages} page${s.pages === 1 ? '' : 's'}${s.words ? ` · ${s.words.toLocaleString()} words in its manuscript` : ''}`;
  const inWorld = $('#ph-world');
  inWorld.replaceChildren();
  if (world) {
    const wb = make('button', '', world.title || 'Untitled');
    wb.addEventListener('click', () => go({ view: 'world', id: world.id }));
    inWorld.append(document.createTextNode('In '), wb);
  }

  const cont = $('#ph-continue');
  const outlined = bookType(b) === 'lines';
  cont.hidden = !outlined && (!novel || !s.chapters.length);
  if (outlined) {
    cont.textContent = 'Open the outline';
    cont.onclick = () => go({ view: 'notebook', pageId: b.id });
  } else if (novel && s.chapters.length) {
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
        box.append(arrangeRow(row, 'ms-ch', ch));
      }
      // Chapters drag into order within their act (hold on a phone); ⋯ › Move
      // up / down also crosses into the next act.
      arrangeable(ms, box, 'ms-ch', (key, keys) => placeAmong(key, keys));
      ms.append(box);
    }
  }

  const inside = await piecesIn(b.id);
  $('#ph-pieces').replaceChildren(...inside.map((x) => pieceRow(x, 0, world)));
  $('#ph-new-piece').onclick = () => addPiece(b.id);
  const nextIn = await nextLevel(b);
  $('#ph-new-piece').textContent = `+ ${nextIn ? nextIn.label : 'Piece'}`;
  const pages = await pagesIn(b.id);
  // Empty sections stay out of the way: just the two ways to add one.
  $('#ph-pieces-head').hidden = !inside.length;
  $('#ph-new-piece-quiet').hidden = inside.length > 0;
  $('#ph-new-piece-quiet').onclick = () => addPiece(b.id);
  $('#ph-pages-label').style.visibility = pages.length ? '' : 'hidden';
  $('#ph-pages').replaceChildren(...pages.map((p) => {
    const li = make('li');
    const open = make('button', 'loose-title', p.title || 'Untitled page');
    open.addEventListener('click', () => go({ view: 'notebook', pageId: p.id }));
    onContextMenu(open, () => pageMenu(p));
    li.append(open, make('span', 'when', ago(p.updated_at)), menuButton(() => pageMenu(p), `More for ${p.title || 'this page'}`));
    return arrangeRow(li, 'ph-page', p);
  }));
  arrangeable($('#ph-pages'), $('#ph-pages'), 'ph-page', (key, keys) => placeAmong(key, keys));

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

// Where the pieces stand, as one thin line: each stage and how many are
// at it. A click opens the stage board (Make).
// One piece in a list: its name, what it is and its stage (a piece's own
// pieces, on its page).
function pieceRow(p, depth, world) {
  const li = make('li');
  li.style.setProperty('--depth', depth);
  const open = make('button', 'loose-title', p.title || 'Untitled');
  open.addEventListener('click', () => go({ view: 'project', id: p.id }));
  onContextMenu(open, () => bookMenu(p));
  const stage = make('button', 'stage', stageOf(p, world));
  stage.title = `Stage (${stageSetOf(p, world).name})`;
  stage.addEventListener('click', () => popMenu(stage, stagesOf(p, world).map((st) => ({ label: st, current: stageOf(p, world) === st, run: () => setStage(p, st) }))));
  li.append(open, make('span', 'piece-kind', kindName(p)), stage, menuButton(() => bookMenu(p), `More for ${p.title || 'this piece'}`));
  return li;
}

// ---------- a world's home: its pieces and its bible ----------

async function renderWorld() {
  const w = await getEntry(state.worldId);
  if (gone(w)) return go({ view: 'library' });
  const allAreas = await areas();
  const s = await worldStats(w);
  const title = $('#wh-title');
  title.textContent = w.title;
  title.contentEditable = 'true';
  title.onblur = async () => {
    const t = title.textContent.trim();
    if (!t) title.textContent = w.title;
    if (t && t !== w.title) { await putEntries([{ ...(await getEntry(w.id)), title: t, updated_at: Date.now() }]); renderRail(); renderCrumb(); }
  };
  title.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } if (e.key === 'Escape') { e.preventDefault(); title.textContent = w.title; title.blur(); } };
  $('#wh-more').replaceChildren(menuButton(() => worldMenu(w), 'More for this world'));
  // A finished project says so, with the way back.
  const fin = $('#wh-finished');
  fin.hidden = !isFinished(w);
  if (isFinished(w)) {
    const back = make('button', 'wp-link', 'Reopen');
    back.addEventListener('click', () => reopenWorld(w));
    fin.replaceChildren(document.createTextNode(`✓ Finished ${finishedWord(w)}. It’s on the Finished shelf in the Library, with everything still in it. `), back);
  }
  const areaSel = $('#wh-area');
  areaSel.replaceChildren(...(await areaOptions(allAreas)).map(([id, label]) => Object.assign(make('option', '', label), { value: id })));
  areaSel.value = w.area_id || '';
  areaSel.onchange = () => moveBookToArea(w, areaSel.value);
  const color = areaColor(allAreas.find((a) => a.id === w.area_id));
  $('#wh-dot').style.background = w.area_id ? color : '';

  // Carry on with the piece you were last writing in this world.
  const cont = $('#wh-continue');
  const last = await getMeta('lastChapter');
  const lastCh = last && (await getEntry(last));
  const lastPiece = lastCh && !gone(lastCh) ? await bookOf(lastCh) : null;
  const here = lastPiece && s.pieces.some((p) => p.row.id === lastPiece.id) ? lastPiece : s.pieces.filter((p) => hasManuscript(p.row)).sort((a, b) => editedAt(b.row) - editedAt(a.row))[0]?.row;
  $('#wh-continue-row').hidden = !here;
  if (here) {
    const at = (lastPiece?.id === here.id && lastCh ? editedAt(lastCh) : 0) || editedAt(here);
    const asOne = onePiece(w, s) && s.pieces[0].row.id === here.id;
    cont.replaceChildren(make('span', 'wt-t', asOne ? kindName(here) : here.title || 'Untitled'), make('small', 'wt-when', at ? ago(at) : ''));
    cont.title = 'Carry on where you were writing';
    cont.onclick = () => openBook(here.id);
  }

  const life = isLife(w);
  const shape = shapeOf(w, s.pieces.filter((p) => p.depth === 0).length);
  $('#wh-kind').textContent = shape.id === 'one' ? '' : shape.name;
  // In the zoom, "Life project" beside the name is the switch (it was buried in ⋯ > Shape).
  if (life) {
    const b = make('button', 'wp-lifeword', 'Life project');
    b.type = 'button';
    b.title = 'A life project: steps, notes and pages. Click to make it a story world';
    b.addEventListener('click', () => popMenu(b, [
      { label: 'Life project: steps, notes and pages', current: true, run: () => {} },
      { label: 'Story world: Shape, Make and the look wall too', run: () => setLife(w, false) }
    ]));
    $('#wh-kind').replaceChildren(b);
  }
  // What it is, in a sentence: type over it.
  const log = $('#wh-logline');
  log.textContent = w.fields?.logline || '';
  log.contentEditable = 'true';
  log.dataset.placeholder = life ? 'What this is about, in a sentence' : 'The world in a sentence';
  log.onblur = async () => {
    const t = log.textContent.trim();
    const fresh = await getEntry(w.id);
    if (t === (fresh.fields?.logline || '')) return;
    await putEntries([{ ...fresh, fields: { ...fresh.fields, logline: t }, updated_at: Date.now() }]);
  };
  log.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); log.blur(); } if (e.key === 'Escape') { e.preventDefault(); log.textContent = w.fields?.logline || ''; log.blur(); } };

  // Steps: the project's own tasks, wherever in it they're written. Drawn
  // into the Steps zoom; the top block shows the next one.
  await plan?.showSteps(w);
  drawNextStep(w);

  // The next date: the soonest shoot day (besides the project's dated steps).
  const dates = [];
  const days = [];
  if (!life) {
    for (const { row } of s.pieces) for (const d of (await children(row.id)).filter((r) => r.kind === 'shootday' && !r.deleted)) days.push({ d, p: row });
    days.sort((a, b) => String(a.d.fields?.date || '').localeCompare(String(b.d.fields?.date || '')));
    const soon = days.find(({ d }) => (d.fields?.date || '') >= isoToday());
    if (soon) dates.push({ iso: soon.d.fields.date, text: `Shoot day · ${soon.p.title || 'Untitled'}`, run: () => go({ view: 'production', id: soon.p.id, day: soon.d.id }) });
  }

  // The zoom into Steps: the same page with only its steps, and the way back.
  const part = state.worldPart === 'steps' ? 'steps' : null;
  const sheet = $('.wp-sheet');
  if (part) sheet.dataset.part = part; else delete sheet.dataset.part;
  const back = $('#wh-back');
  back.hidden = !part;
  back.textContent = `‹ ${w.title || 'Untitled'}`;
  back.onclick = () => go({ view: 'world', id: w.id });
  $('#wh-zoom-title').hidden = !part;
  $('#wh-zoom-title').textContent = part ? 'Steps' : '';

  await drawOutline(w, s, { life, days });
  // From the Desk: where it sits, its north star, where it stands, what
  // needs you, the crew and the turns. The next date is the soonest dated
  // step or shoot day.
  worldDates = dates;
  // What was touched last, for the project's where-line ("Recently" itself went).
  const { pages } = await worldTree(w.id);
  const recent = [...s.pieces.map(({ row }) => row), ...pages.map(({ row }) => row)].sort((a, b) => editedAt(b) - editedAt(a)).slice(0, 1);
  const lately = recent[0] && editedAt(recent[0]) ? { title: recent[0].title || 'Untitled', at: editedAt(recent[0]), run: () => (recent[0].kind === 'page' ? go({ view: 'notebook', pageId: recent[0].id }) : go({ view: 'project', id: recent[0].id })) } : null;
  // The same clock the Desk seats it by, so the two never disagree.
  await projectPage?.show(w, { color, edited: editedAt(w), last: lately, date: nextDate(w.id) });
}
// ---------- the home as one outline ----------

// The top block's Next step: the first open step, as the Steps zoom lists
// them, with a circle to tick it and "all N ›" into the Steps zoom.
function drawNextStep(w = null) {
  const row = $('#wh-next-row');
  const box = $('#wh-steps');
  const id = w?.id || state.worldId;
  if (!row || !id) return;
  const mine = (plan?.items || []).filter((i) => i.world?.id === id);
  const open = mine.filter((i) => !i.row.fields?.done);
  const firstId = box?.querySelector('.pl-task:not(.done)[data-task]')?.dataset.task;
  const first = open.find((i) => i.row.id === firstId) || open[0];
  row.hidden = false;
  const v = $('#wh-next-step');
  const kids = [];
  if (first) {
    const ring = make('button', 'wt-tick');
    ring.type = 'button';
    ring.setAttribute('aria-label', `Done: ${first.row.text || 'this step'}`);
    ring.title = 'Done';
    ring.addEventListener('click', async () => { ring.classList.add('on'); await plan.tick(first, true); drawNextStep(); });
    const t = make('button', 'wt-t', first.row.text || 'Untitled');
    t.type = 'button';
    t.title = 'Open where it’s written';
    t.addEventListener('click', () => openEntry(first.row.id));
    kids.push(ring, t);
  } else kids.push(make('span', 'wt-none', mine.length ? 'All done' : 'None yet'));
  const all = make('button', 'wt-all', open.length ? `all ${open.length} ›` : 'Add a step ›');
  all.type = 'button';
  all.title = 'Every step in this project (zooms in)';
  all.addEventListener('click', () => go({ view: 'world', id, part: 'steps' }));
  kids.push(all);
  v.replaceChildren(...kids);
}

// One part of the project as a line: ▸ opens it here, its name zooms in.
function partLine(w, part, open, { count = '', meta = '', kids = null, zoom }) {
  const li = make('li', 'wo-line');
  li.dataset.part = part.id;
  const row = make('div', 'wo-row');
  const tog = make('button', 'wo-tog', open ? '▾' : '▸');
  tog.type = 'button';
  tog.setAttribute('aria-expanded', String(open));
  tog.setAttribute('aria-label', `${open ? 'Close' : 'Open'} ${part.label}`);
  tog.addEventListener('click', () => { setPartOpen(w.id, part.id, !open); renderWorld(); });
  const name = make('button', 'wo-name', part.label);
  name.type = 'button';
  name.title = `${part.about} (zoom in${part.keys ? `, ${part.keys}` : ''})`;
  name.addEventListener('click', zoom);
  row.append(tog, name);
  if (count !== '') row.append(make('span', 'wo-count', String(count)));
  if (meta) row.append(make('span', 'wo-meta', meta));
  li.append(row);
  if (open && kids) {
    const ul = make('ul', 'wo-kids');
    ul.append(...kids);
    li.append(ul);
  }
  return li;
}

const kidLine = (text, run, { meta = '', depth = 0, cls = '' } = {}) => {
  const li = make('li', cls);
  if (depth) li.style.setProperty('--depth', depth);
  const b = make(run ? 'button' : 'span', 'wo-item', text);
  if (run) { b.type = 'button'; b.addEventListener('click', run); }
  li.append(b);
  if (meta) li.append(make('span', 'wo-meta', meta));
  return li;
};
const snipText = (t, n = 70) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

async function drawOutline(w, s, { life, days }) {
  const open = openParts(w.id);
  const zoomTo = (page, sub) => () => go({ view: 'stage', id: w.id, page, ...(sub ? { sub } : {}) });
  const parts = partsFor(w).map((p, i) => ({ ...p, keys: `Alt + ${i + 1}` }));
  const lines = [];
  const { pages, piecePages } = await worldTree(w.id);
  const one = onePiece(w, s, life);
  const idx = await pieceIndex(w);
  const pick = pickOf(idx);
  // Bible: the project's own pages, then those made inside a piece (named
  // beside them when there's more than one piece). No page moves.
  const bible = pages.filter(({ row }) => row.id !== `steps-${w.id}` && !row.fields?.fixesFor);
  for (const { row, depth } of piecePages) {
    if (row.fields?.fixesFor) continue;
    bible.push({ row, depth, from: idx.many ? idx.name(idx.ofPage(row)) : '' });
  }
  for (const part of parts) {
    const on = open.has(part.id);
    if (part.id === 'ideas') {
      const items = await gatherItems(w);
      const all = inIdeaOrder(w, items.filter(({ row }) => !(row.fields?.filed || []).length && !row.fields?.letgo));
      // One Ideas list: with several pieces, chips pick whose (One home Part 3).
      const loose = all.filter(({ row }) => fits(pick, idx.ofLine(row)));
      const shown = loose.slice(0, 8);
      const keys = shown.map(({ row }) => row.id);
      // The way to add one comes first, so it is there without scrolling.
      const kids = [...(idx.many ? [pickRow(w, idx, pick)] : []), ideaAdder(w, idx, pick), ...shown.map(({ row, from }) => ideaLine(w, row, from, keys, idx))];
      if (loose.length > 8) kids.push(kidLine(`${loose.length - 8} more ›`, zoomTo('gather'), { cls: 'wo-more' }));
      lines.push(partLine(w, part, on, { count: loose.length, meta: loose.length ? `to sort · newest: ${snipText(loose[0].row.text, 40)}` : 'nothing to sort', kids, zoom: zoomTo('gather') }));
    } else if (part.id === 'bible' || part.id === 'notes') {
      const mine = bible.filter(({ row }) => fits(pick, idx.ofPage(row)));
      const kids = [...(idx.many && part.id === 'bible' ? [pickRow(w, idx, pick)] : []), pageAdder(w, part.id === 'notes', idx, pick), ...mine.map(({ row, depth, from }) => pageLine(row, depth, from))];
      const more = make('li', 'wo-also');
      if (part.id === 'bible') {
        for (const [sub, label] of [['arcs', 'Arcs'], ['timeline', 'Timeline'], ['ties', 'Relationships'], ['promises', 'Promises']]) {
          const b = make('button', 'wo-sub', label);
          b.type = 'button';
          b.addEventListener('click', sub === 'arcs' ? () => go({ view: 'grid', id: w.id }) : zoomTo('shape', sub));
          more.append(b);
        }
      }
      kids.push(more);
      const top = bible.filter(({ depth }) => depth === 0).map(({ row }) => row.title || 'Untitled');
      lines.push(partLine(w, part, on, { count: bible.length, meta: top.length ? snipText(top.slice(0, 4).join(', ') + (top.length > 4 ? '…' : ''), 60) : 'no pages yet', kids, zoom: zoomTo(part.page) }));
    } else if (part.id === 'pieces') {
      // A piece with a text opens in place: ▸ shows its scenes (or a novel's
      // chapters), each opening the text there (One home Part 2).
      const rowsBy = new Map();
      const wordsBy = new Map();
      for (const { row } of s.pieces) {
        if (!hasManuscript(row)) continue;
        wordsBy.set(row.id, (await stats(row)).words);
        if (pieceOpen(row.id)) rowsBy.set(row.id, await pieceRows(row));
      }
      const h = {
        open: (p) => openBook(p.id), stage: (p, st, o) => setStage(p, st, o), pop: popMenu, menu: (p) => bookMenu(p), button: menuButton,
        fold: (p) => (hasManuscript(p) ? pieceFold(p) : null),
        kids: (p) => (rowsBy.has(p.id) ? sceneList(p, rowsBy.get(p.id)) : null),
        words: (p) => (wordsBy.get(p.id) ? make('span', 'wo-words', `${wordsBy.get(p.id).toLocaleString('en-US')} words`) : null)
      };
      if (one) {
        // One script, right on the page: the Pieces line is that piece, named by its label.
        const p = s.pieces[0].row;
        const li = pieceLine(p, 0, w, { ...h, name: (x) => kindName(x), noKind: true });
        li.classList.add('wo-line', 'wo-one');
        li.dataset.part = 'pieces';
        li.querySelector('.wo-item').title = `Open ${p.title || 'it'} where you left off`;
        lines.push(li);
        continue;
      }
      const kids = s.pieces.map(({ row, depth }) => movePiece(pieceLine(row, depth, w, h), row));
      const more = make('li', 'wo-also');
      const add = make('button', 'wo-add', `+ ${(await nextLevel(w))?.label || 'Piece'}`);
      add.type = 'button';
      add.addEventListener('click', () => addPiece(w.id));
      more.append(add);
      kids.push(more);
      const by = new Map();
      // Counted in the order of the stages, idea first.
      const order = [];
      for (const { row } of s.pieces) { const st = stageOf(row, w); by.set(st, (by.get(st) || 0) + 1); for (const x of stagesOf(row, w)) if (!order.includes(x)) order.push(x); }
      const counts = [...by].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
      lines.push(partLine(w, part, on, { count: s.pieces.length, meta: counts.map(([st, k]) => `${k} ${st.toLowerCase()}`).join(' · ') || 'none yet', kids, zoom: zoomTo('write') }));
    } else if (part.id === 'make') {
      const { elementsIn, lookOf } = await import('../production.js');
      const els = await elementsIn(w);
      const looked = els.filter((e) => lookOf(e.fields?.element || {}).refs.length);
      const kids = [];
      const looks = kidLine('Looks', zoomTo('make', 'looks'), { meta: looked.length ? `${looked.length} with pictures` : 'none yet' });
      if (looked.length) {
        const ul = make('ul', 'wo-kids');
        for (const e of looked) {
          const l = lookOf(e.fields.element);
          ul.append(kidLine(e.title || 'Untitled', zoomTo('make', 'looks'), { meta: `${l.kept.length}${l.pick ? ' · ★' : ''}` }));
        }
        looks.append(ul);
      }
      kids.push(looks, kidLine('Kit', zoomTo('make', 'kit'), { meta: els.length ? `${els.length} characters, places and props` : 'characters, places, props' }));
      const ahead = days.filter(({ d }) => (d.fields?.date || '') >= isoToday());
      for (const { d, p } of ahead.slice(0, 4)) {
        const when = d.fields?.date ? new Date(`${d.fields.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'No date yet';
        kids.push(kidLine(`Shoot day · ${p.title || 'Untitled'}${d.fields?.place ? ` · ${d.fields.place}` : ''}`, () => go({ view: 'production', id: p.id, day: d.id }), { meta: when }));
      }
      if (days.length) kids.push(kidLine('All shoot days', zoomTo('make', 'days'), { cls: 'wo-more' }));
      // One "Shots" line per piece with video tools: its production view.
      const filmed = s.pieces.map(({ row }) => row).filter((p) => hasManuscript(p) && toolsOf(p, w).includes('shots'));
      if (filmed.length) {
        const counts = on ? await shotCounts(filmed) : new Map();
        for (const p of filmed) kids.push(kidLine(filmed.length > 1 || s.pieces.length > 1 ? `Shots · ${p.title || 'Untitled'}` : 'Shots', () => go({ view: 'production', id: p.id }), { meta: on ? plural(counts.get(p.id) || 0, 'shot') : '' }));
      }
      const metaBits = [looked.length && `${plural(looked.length, 'look')}`, els.length && `${els.length} in the kit`, ahead.length && plural(ahead.length, 'shoot day')].filter(Boolean);
      lines.push(partLine(w, part, on, { count: '', meta: metaBits.join(' · ') || 'looks, kit, shoot days', kids, zoom: zoomTo('make') }));
    } else if (part.id === 'deliver') {
      const ready = s.pieces.filter(({ row }) => isReady(row, w)).map(({ row }) => row);
      const out = s.pieces.filter(({ row }) => isOut(row, w)).map(({ row }) => row);
      const where = (p) => Object.entries(p.fields?.posting || {}).filter(([, v]) => v?.url).map(([k]) => (k === 'x' ? 'X' : k[0].toUpperCase() + k.slice(1))).join(', ');
      const kids = [
        ...ready.map((p) => kidLine(p.title || 'Untitled', () => go({ view: 'deliver', id: p.id, tab: 'post' }), { meta: 'Ready to post' })),
        ...out.map((p) => kidLine(p.title || 'Untitled', () => go({ view: 'deliver', id: p.id }), { meta: where(p) ? `Out · ${where(p)}` : 'Out' }))
      ];
      if (!kids.length) kids.push(kidLine('Nothing ready or out yet', null, { cls: 'wo-none' }));
      lines.push(partLine(w, part, on, { count: out.length || '', meta: [out.length && `${out.length} out`, ready.length && `${ready.length} ready to post`].filter(Boolean).join(' · ') || 'nothing out yet', kids, zoom: zoomTo('deliver') }));
    }
  }
  const list = $('#wh-outline');
  for (const el of [...list.querySelectorAll(':scope > li[data-part]:not(#wh-about)')]) el.remove();
  $('#wh-about').before(...lines);
  // Each open list can be rearranged: drag (hold on a phone), or the keys.
  const ul = (part) => list.querySelector(`:scope > li[data-part="${part}"] > .wo-kids:not(.wo-scenes)`);
  if (ul('ideas')) arrangeable(list, ul('ideas'), 'wo-idea', async (_key, keys) => { await applyRemote(await setIdeaOrder(w.id, keys)); await renderWorld(); });
  for (const part of ['bible', 'notes']) if (ul(part)) arrangeable(list, ul(part), 'wo-page', (key, keys) => placeAmong(key, keys));
  if (ul('pieces')) arrangeable(list, ul('pieces'), 'wo-piece', (key, keys) => placeAmong(key, keys));
  // About: folded under its own line, the facts the Desk keeps.
  const about = $('#wh-about');
  const aOpen = open.has('about');
  about.querySelector('.wo-kids').hidden = !aOpen;
  const tog = about.querySelector('.wo-tog');
  tog.textContent = aOpen ? '▾' : '▸';
  tog.setAttribute('aria-expanded', String(aOpen));
  tog.setAttribute('aria-label', `${aOpen ? 'Close' : 'Open'} About`);
  const flip = () => { setPartOpen(w.id, 'about', !aOpen); renderWorld(); };
  tog.onclick = flip;
  about.querySelector('.wo-name').onclick = flip;
  $('#wh-about-meta').textContent = w.fields?.star ? snipText(w.fields.star, 60) : 'north star, now, crew, turns';
}

// An idea on the home: open it where it was written; ⋯ to move it or let it
// go to the Trash; drag it (hold on a phone) into your own order.
function ideaLine(w, row, from, keys, idx = null) {
  const li = kidLine(snipText(row.text) || 'A picture or recording', () => openEntry(row.id), { meta: from || '' });
  // Whose it is, when there are pieces to tell apart.
  const pid = idx?.many ? idx.ofLine(row) : null;
  // (Not when the line already says it, as "… [[The Harbour Book]]" does.)
  if (pid && !(row.text || '').includes(idx.name(pid))) li.querySelector('.wo-item').after(make('span', 'wo-for', idx.name(pid)));
  const step = async (how) => {
    const next = stepKeys(keys, row.id, how);
    if (!next) return;
    await applyRemote(await setIdeaOrder(w.id, next));
    await renderWorld();
    refocus($('#wh-outline'), row.id);
  };
  const del = async () => { await toTrash(row); await renderWorld(); };
  const i = keys.indexOf(row.id);
  li.append(menuButton(() => [
    { label: 'Open where it was written', run: () => openEntry(row.id) },
    { label: 'Move up', keys: '⌥⇧↑', off: i === 0, run: () => step(-1) },
    { label: 'Move down', keys: '⌥⇧↓', off: i === keys.length - 1, run: () => step(1) },
    { label: 'Move to the top', off: i === 0, run: () => step('top') },
    { label: 'File it into a page…', run: () => go({ view: 'stage', id: w.id, page: 'gather' }) },
    ...(idx?.many ? [forMenu(row, idx, async () => { await renderWorld(); })] : []),
    'sep',
    { label: 'Delete', keys: '⌘⇧⌫', danger: true, run: del }
  ], `More for this idea`));
  return movableRow(li, 'wo-idea', row.id, { up: () => step(-1), down: () => step(1), del });
}

// A bible page on the home: its name opens it; ⋯ is the page's own menu.
function pageLine(row, depth, from = '') {
  const li = kidLine(row.title || 'Untitled page', () => go({ view: 'notebook', pageId: row.id }), { depth, cls: 'wo-page', meta: from });
  li.append(menuButton(() => pageMenu(row), `More for ${row.title || 'this page'}`));
  onContextMenu(li.querySelector('.wo-item'), () => pageMenu(row));
  return arrangeRow(li, 'wo-page', row);
}
function movePiece(li, row) { return arrangeRow(li, 'wo-piece', row); }

// The chips over Ideas and the Bible (several pieces only): Everything,
// Whole project, then each piece. Remembered on this device.
function pickRow(w, idx, pick) {
  const li = make('li', 'wo-also wo-picks');
  for (const c of chipList(idx)) {
    const b = make('button', 'chip' + (c.id === pick ? ' on' : ''), c.label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(c.id === pick));
    b.addEventListener('click', () => { setPick(w.id, c.id); renderWorld(); });
    li.append(b);
  }
  return li;
}
// "For…" on an idea: the whole project, or one piece. Undo puts the link back.
export function forMenu(row, idx, after) {
  const cur = idx.ofLine(row);
  const to = async (id) => {
    const [next, was] = await lineFor(row, idx, id);
    if (!next) return;
    await putEntries([next]);
    await applyRemote([next]);
    await after();
    toast(`Now for ${id === idx.world.id ? 'the whole project' : idx.name(id)}`, { label: 'Undo', run: async () => { const back = { ...was, updated_at: Date.now() }; await putEntries([back]); await applyRemote([back]); await after(); } });
  };
  return { label: 'For…', sub: [
    { label: 'Whole project', current: !cur, run: () => to(idx.world.id) },
    ...idx.pieces.map((p) => ({ label: `${'  '.repeat(p.depth)}${p.title}`, current: cur === p.id, run: () => to(p.id) }))
  ] };
}

// One script, right on the project page: a story project with exactly one
// piece draws its Pieces line as that piece. The project's ⋯ menu turns it off.
export const onePiece = (w, s, life = isLife(w)) => !life && s.pieces.length === 1 && w.fields?.onePiece !== false;

// A piece line's ▸: its scenes (or chapters) here, open per piece per device.
const pieceOpen = (id) => { try { return localStorage.getItem(`wp:${id}`) === '1'; } catch { return false; } };
function pieceFold(p) {
  const on = pieceOpen(p.id);
  const b = make('button', 'wo-tog wo-ptog', on ? '▾' : '▸');
  b.type = 'button';
  b.setAttribute('aria-expanded', String(on));
  b.setAttribute('aria-label', `${on ? 'Hide' : 'Show'} what’s in ${p.title || 'this piece'}`);
  b.addEventListener('click', () => { try { localStorage.setItem(`wp:${p.id}`, on ? '0' : '1'); } catch { /* private window */ } renderWorld(); });
  return b;
}
function sceneList(p, rows) {
  const ul = make('ul', 'wo-kids wo-scenes');
  if (!rows.length) ul.append(kidLine('No scenes yet', null, { cls: 'wo-none' }));
  rows.forEach((r, i) => {
    const li = make('li', 'wo-scene');
    li.dataset.row = r.id;
    const b = make('button', 'wo-item');
    b.type = 'button';
    b.title = 'Open the text here';
    b.append(make('span', 'wo-sn', grid.olNum(r, i)), document.createTextNode(r.name || r.title || 'Untitled'));
    b.addEventListener('click', () => grid.hooks.open(r));
    li.append(b);
    if (r.synopsis) li.append(make('span', 'wo-meta', snipText(r.synopsis, 90)));
    ul.append(li);
  });
  ul.append(kidLine('Open the outline ›', () => go({ view: 'grid', id: p.id, mode: 'outline' }), { cls: 'wo-more wo-ol' }));
  return ul;
}
// How many shots each piece has (a shot knows its piece, or its scene does).
async function shotCounts(pieces) {
  const ids = new Set(pieces.map((p) => p.id));
  const n = new Map();
  for (const sh of await byKind('shot')) {
    let pid = sh.fields?.piece;
    if (!pid) { const sc = sh.parent_id && (await getEntry(sh.parent_id)); pid = sc ? (await bookOf(sc))?.id : null; }
    if (ids.has(pid)) n.set(pid, (n.get(pid) || 0) + 1);
  }
  return n;
}
// The keys for a page, piece or area row: a step among its siblings, or the Trash.
function arrangeRow(li, kind, row) {
  const step = async (how) => { await stepAmong(row, how); refocus(document, row.id); };
  return movableRow(li, kind, row.id, { up: () => step(-1), down: () => step(1), del: () => toTrash(row) });
}

// "Add a page…" at the top of the Bible (or Notes): type its name, Enter.
function pageAdder(w, notesToo, idx = null, pick = 'all') {
  const into = idx?.many && pick !== 'all' && pick !== 'whole' ? idx.pieces.find((p) => p.id === pick) : null;
  const li = make('li', 'wo-add-idea wo-add-page');
  const form = make('form', 'wo-idea');
  form.noValidate = true;
  const input = make('input');
  input.type = 'text';
  input.placeholder = into ? `Add a page for ${into.title}…` : notesToo ? 'Add a page…' : 'Add a bible page…';
  input.setAttribute('aria-label', `Add a page to ${into ? into.title : w.title || 'this project'}`);
  input.setAttribute('enterkeyhint', 'enter');
  input.autocomplete = 'off';
  form.append(input);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    input.value = '';
    const page = await pagesNew(into ? into.id : w.id, title);
    await applyRemote([page]);
    toast(`“${title}” added${into ? ` to ${into.title}` : ''}`, { label: 'Open', run: () => go({ view: 'notebook', pageId: page.id }) });
    await renderWorld();
    document.querySelector('#wh-outline .wo-add-page input')?.focus();
  });
  li.append(form);
  return li;
}

// "Add an idea…" at the end of Ideas: a line on today's page that links here.
function ideaAdder(w, idx = null, pick = 'all') {
  const into = idx?.many && pick !== 'all' && pick !== 'whole' ? idx.pieces.find((p) => p.id === pick)?.row : null;
  const to = into || w;
  const li = make('li', 'wo-add-idea');
  const form = make('form', 'wo-idea');
  form.noValidate = true;
  const input = make('input');
  input.type = 'text';
  input.placeholder = into ? `Add an idea for ${into.title || 'this piece'}…` : 'Add an idea…';
  input.setAttribute('aria-label', `Add an idea to ${to.title || 'this project'}`);
  input.setAttribute('enterkeyhint', 'enter');
  input.autocomplete = 'off';
  form.append(input);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const { addLine } = await import('../capture.js');
    const { rows } = await addLine([{ type: 'text', text: `${text} ` }, { type: 'entryRef', attrs: { id: to.id, title: to.title || 'Untitled' } }], {});
    await applyRemote(rows);
    toast(`Idea added to ${to.title || 'the project'} (on today’s page too)`);
    await renderWorld();
    document.querySelector('#wh-outline .wo-idea input')?.focus();
  });
  li.append(form);
  return li;
}

// A project's next date: its soonest dated step, or its next shoot day.
function nextDate(worldId) {
  const dates = [...worldDates];
  for (const i of plan?.items || []) {
    if (i.world?.id === worldId && !i.row.fields?.done && i.task.day && i.task.day >= isoToday()) dates.push({ iso: i.task.day, text: i.row.text || 'Untitled', run: () => openEntry(i.row.id) });
  }
  dates.sort((a, b) => a.iso.localeCompare(b.iso));
  return dates[0] ? { ...dates[0], word: dayWord(dates[0].iso, isoToday()) } : null;
}

// ---------- the plot grid: the manuscript as a table ----------

let grid; // set in wireLibraryView()

// Its commands in the box (Ctrl + K); commandinfo.js has their hints and words.
addCommands(() => [
  { group: 'new', label: 'New novel', keys: '', run: () => showNewBook('novel') },
  { group: 'new', label: 'New screenplay', keys: '', run: () => showNewBook('screenplay') },
  { group: 'new', label: 'New notes collection', keys: '', run: () => showNewBook('notes') },
  { group: 'new', label: 'New show (seasons, episodes)', keys: '', words: ['series', 'tv', 'reels'], run: () => showNewBook('novel', 'show') },
  { group: 'new', label: 'New book series', keys: '', run: () => showNewBook('novel', 'series') },
  { group: 'new', label: 'New project: what are you making?', keys: '', words: ['world', 'universe', 'collection', 'life'], run: () => showNewBook('novel', 'one') }
]);

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wireLibraryView() {
  newHow = newWorkflow($('#lib-new-how'), { keepOwn, deleteOwn, usedBy: ownUsedBy });
  $('#lib-new-type').addEventListener('change', () => pickHow());
  $('#lib-new-shapes').replaceChildren(...SHAPES.map((sh) => {
    const b = make('button', 'lib-shape');
    b.type = 'button';
    b.dataset.shape = sh.id;
    b.setAttribute('role', 'radio');
    b.append(make('b', '', sh.name), make('span', '', sh.about));
    b.addEventListener('click', () => { pickShape(sh.id); $('#lib-new-title').focus(); });
    return b;
  }));
  $('#lib-new').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#lib-new-title').value.trim();
    if (!title) return;
    const type = $('#lib-new-type').value;
    let area = $('#lib-new-area').value || null;
    if (area === '__personal') area = await personalAreaId();
    const how = newHow.value();
    const world = await newShaped(newShape, title, area, type);
    if (how) await useWorkflow(world, how);
    $('#lib-new').hidden = true;
    // One piece opens on its Idea page, the place to think it through; anything
    // bigger opens on its overview, to see what's inside.
    const idea = newShape === 'one' && (await pagesIn(world.id))[0];
    if (idea) await go({ view: 'notebook', pageId: idea.id });
    else await go({ view: 'world', id: world.id });
  });
  $('#lib-new-cancel').addEventListener('click', () => { $('#lib-new').hidden = true; });
  grid = new PlotGrid($('#grid-view'), {
    // A row opens where it is in the text.
    async open(r) {
      if (r.focus) return openEntry(r.focus);
      if (r.kind === 'piece') return openBook(r.id);
      if (r.kind === 'act') { const ch = (await outline((await getEntry(r.id)).parent_id)).find((a) => a.id === r.id)?.chapters[0]; return ch ? go({ view: 'write', chapterId: ch.id }) : null; }
      if (r.kind === 'chapter' || (r.kind === 'opening' && r.id === r.chapterId)) return go({ view: 'write', chapterId: r.chapterId || r.id });
      if (r.chapterId) return go({ view: 'write', chapterId: r.chapterId, focus: r.id });
      return openEntry(r.id);
    },
    leave: (owner) => (owner.kind === 'world' ? go({ view: 'world', id: owner.id }) : openBook(owner.id)),
    changed(rows) {
      setGridTouched(true);
      if (rows.some((r) => r && ['chapter', 'act', 'project'].includes(r.kind))) renderRail();
    },
    beforeMove: () => store.close(editor.state.doc),
    menu: (anchor, items) => popMenu(anchor, items),
    menuButton: (items, label) => menuButton(items, label),
    ask, askText, toast,
    pieceHead: (piece, world) => pieceHead(piece, world),
    rowMenu: (r) => chapterMenu({ id: r.id }),
    noteType: () => notes.types[0]?.id || null,
    askServer: (body) => askServer(body),
    canAsk: () => canAskServer()
  });
  window.__grid = grid;
}

export { arrangeRow, areaOptions, drawNextStep, grid, nextDate, nudgeBook, renderLibrary, renderProject, renderWorld, wireLibraryView };
