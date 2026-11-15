// The Library, a book's home, a world's home (its pieces and its bible) and
// the plot grid.
import { getMeta, putEntries, children, getEntry } from '../db.js';
import { newWorkflow } from '../stageedit.js';
import { popMenu, menuButton, onContextMenu, ask, askText, toast } from '../menu.js';
import { outline } from '../model.js';
import { titleOf } from '../notebook.js';
import { PlotGrid, worldPromises } from '../grid.js';
import { isLife, personalArea } from '../pages.js';
import { gatherItems } from '../stages.js';
import { dayWord } from '../tasks.js';
import { isFinished, areas, bookType, hasManuscript, kindName, areaColor, newArea, pagesIn, loosePages, bookOf, stats, dailyMentions, ago, worlds, worldOf, piecesIn, worldTree, worldStats, usedLabels, SHAPES, shapeOf, nextLevel, newShaped, editedAt, defaultLabel, stageOf, nextLabel, setForNew, typeForSet, stageSetOf, stagesOf, isReady } from '../library.js';
import { make } from '../dom.js';
import { isoToday, isoOf } from '../dates.js';
import { addCommands } from './commandlist.js';
import { $, editor, gone, gridTouched, notes, setGridTouched, state, store, view } from '../main.js';
import { go, openBook, openEntry } from './routing.js';
import { areaPath, dot, renameable, renderCrumb, renderRail, subtree } from './rail.js';
import { finishWorld, reopenWorld, KINDS, actMenu, addPiece, areaMenu, bookMenu, chapterMenu, deleteOwn, keepOwn, moveBookToArea, openStages, ownUsedBy, pageMenu, personalAreaId, plural, refreshViews, renderTrash, setKind, setStage, worldMenu } from './tidying.js';
import { renderBoard } from './workpages.js';
import { askServer, canAskServer, plan, projectPage } from './talking.js';
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
        box.append(row);
      }
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
    return li;
  }));

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

// One piece in a list: its name, what it is and its stage.
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
  const n = (x, word) => `${x.toLocaleString()} ${word}${x === 1 ? '' : 's'}`;
  $('#wh-stats').textContent = (isLife(w) ? [n(s.pieces.length, 'piece')] : [n(s.pieces.length, 'piece'), s.words && n(s.words, 'word'), n(s.pages.length, 'page')]).filter(Boolean).join(' · ');
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
  cont.hidden = !here;
  if (here) {
    cont.textContent = s.pieces.length > 1 ? `Continue · ${here.title || 'Untitled'}` : 'Continue writing';
    cont.onclick = () => openBook(here.id);
  }

  const life = isLife(w);
  const shape = shapeOf(w, s.pieces.filter((p) => p.depth === 0).length);
  $('#wh-kind').textContent = shape.id === 'one' ? '' : shape.name;
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

  // Where every piece is, from new idea to out in the world: by status on
  // one hairline, or as a list (how they nest) when you'd rather.
  $('#wh-stagebar').hidden = true;
  const status = $('#wh-status');
  const canBoard = !life && s.pieces.length > 0;
  const asList = !canBoard || localStorage.getItem('piecesAs') === 'list';
  status.hidden = asList;
  if (canBoard) renderBoard(w, s.pieces);
  $('#wh-workflow').onclick = () => openStages(w);
  $('#wh-workflow').hidden = !canBoard;
  const as = $('#wh-as');
  as.hidden = !canBoard;
  as.textContent = asList ? 'By status' : 'As a list';
  as.onclick = () => { localStorage.setItem('piecesAs', asList ? 'board' : 'list'); renderWorld(); };

  $('#wh-pieces-box').hidden = life && !s.pieces.length;
  $('#wh-pieces').hidden = !asList;
  $('#wh-pieces').replaceChildren(...s.pieces.map(({ row, depth }) => pieceRow(row, depth, w)));
  $('#wh-pieces-empty').hidden = s.pieces.length > 0;
  $('#wh-new-piece').onclick = () => addPiece(w.id);
  const nextHere = await nextLevel(w);
  $('#wh-new-piece').textContent = `+ ${nextHere ? nextHere.label : 'Piece'}`;

  // Steps: the project's own tasks, wherever in it they're written.
  await plan?.showSteps(w);

  // Next: what's waiting, from each page.
  const next = [];
  const items = await gatherItems(w);
  const open = items.filter(({ row }) => !(row.fields?.filed || []).length && !row.fields?.letgo).length;
  if (open) next.push({ from: 'Gather', text: `${plural(open, 'thing')} in to file`, run: () => go({ view: 'stage', id: w.id, page: 'gather' }) });
  const dates = [];
  if (!life) {
    const promises = await worldPromises(w);
    const unpaid = promises.filter((p) => !p.paid).length;
    if (unpaid) next.push({ from: 'Shape', text: `${plural(unpaid, 'promise')} not paid off yet`, run: () => go({ view: 'stage', id: w.id, page: 'shape', sub: 'promises' }) });
    const days = [];
    for (const { row } of s.pieces) for (const d of (await children(row.id)).filter((r) => r.kind === 'shootday' && (r.fields?.date || '') >= isoToday())) days.push({ d, p: row });
    days.sort((a, b) => a.d.fields.date.localeCompare(b.d.fields.date));
    if (days[0]) dates.push({ iso: days[0].d.fields.date, text: `Shoot day · ${days[0].p.title || 'Untitled'}`, run: () => go({ view: 'production', id: days[0].p.id, day: days[0].d.id }) });
    if (days[0]) { const { d, p } = days[0]; next.push({ from: 'Make', text: `Shoot day ${new Date(`${d.fields.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${p.title || 'Untitled'}`, run: () => go({ view: 'production', id: p.id, day: d.id }) }); }
    const written = s.pieces.filter(({ row }) => stageSetOf(row, w).id === 'ai' && stageOf(row, w) === stagesOf(row, w)[1] && bookType(row) === 'screenplay').map(({ row }) => row);
    if (written[0]) next.push({ from: 'Make', text: `Board ${written[0].title || 'Untitled'}${written.length > 1 ? ` and ${plural(written.length - 1, 'other')}` : ''}`, run: () => go({ view: 'production', id: written[0].id }) });
    const edited = s.pieces.filter(({ row }) => isReady(row, w)).map(({ row }) => row);
    if (edited[0]) next.push({ from: 'Deliver', text: `Post ${edited[0].title || 'Untitled'}`, run: () => go({ view: 'deliver', id: edited[0].id, tab: 'post' }) });
  }
  $('#wh-next').replaceChildren(...next.map((n) => {
    const li = make('li');
    const b = make('button');
    b.append(make('span', 'from', n.from), make('span', 'line', n.text));
    b.addEventListener('click', n.run);
    li.append(b);
    return li;
  }));
  $('#wh-next-box').hidden = !next.length;

  // Recently: the pieces and pages last written in.
  const { pages } = await worldTree(w.id);
  const recent = [...s.pieces.map(({ row }) => row), ...pages.map(({ row }) => row)].sort((a, b) => editedAt(b) - editedAt(a)).slice(0, 6);
  $('#wh-recent').replaceChildren(...recent.map((r) => {
    const li = make('li');
    const open = make('button', 'loose-title', r.title || (r.kind === 'page' ? 'Untitled page' : 'Untitled'));
    open.addEventListener('click', () => (r.kind === 'page' ? go({ view: 'notebook', pageId: r.id }) : go({ view: 'project', id: r.id })));
    onContextMenu(open, () => (r.kind === 'page' ? pageMenu(r) : bookMenu(r)));
    li.append(open, make('span', 'when', ago(editedAt(r))));
    return li;
  }));
  $('#wh-recent-box').hidden = !recent.length;

  // From the Desk: where it sits, its north star, where it stands, what
  // needs you, the crew and the turns. The next date is the soonest dated
  // step or shoot day.
  worldDates = dates;
  const lately = recent[0] && editedAt(recent[0]) ? { title: recent[0].title || 'Untitled', at: editedAt(recent[0]), run: () => (recent[0].kind === 'page' ? go({ view: 'notebook', pageId: recent[0].id }) : go({ view: 'project', id: recent[0].id })) } : null;
  // The same clock the Desk seats it by, so the two never disagree.
  await projectPage?.show(w, { color, edited: editedAt(w), last: lately, date: nextDate(w.id) });
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
    noteType: () => notes.types[0]?.id || null,
    askServer: (body) => askServer(body),
    canAsk: () => canAskServer()
  });
  window.__grid = grid;
}

export { areaOptions, grid, nextDate, nudgeBook, renderLibrary, renderProject, renderWorld, wireLibraryView };
