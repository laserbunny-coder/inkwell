// Tidying up: rename, move, change kind, and the Trash.
import { putEntries, children, getEntry } from '../db.js';
import { trash, restore, trashed, deleteForever, contents } from '../trash.js';
import { editStages } from '../stageedit.js';
import { ask, askText, askPiece, toast } from '../menu.js';
import { outline, entry } from '../model.js';
import { titleOf, dayId } from '../notebook.js';
import { isLife, personalArea } from '../pages.js';
import { inPane, host as paneHost } from '../panes.js';
import { sharesOf } from '../sharelink.js';
import { areas, bookType, hasManuscript, kindName, newArea, pagesIn, bookOf, stats, ago, changeType, worlds, worldOf, newPiece, piecesIn, worldTree, usedLabels, SHAPES, shapeOf, levelsOf, nextLevel, FORMATS, formatName, defaultLabel, stageOf, allSets, addOwnWorkflow, dropOwnWorkflow, setById, stageSetOf, stagesIn, stagesOf } from '../library.js';
import { make } from '../dom.js';
import { isoToday } from '../dates.js';
import { $, editor, gone, hstrip, inNotebook, notes, openTalk, root, showClaudeKnows, stagePage, state, store, view, writing } from '../main.js';
import { placeScriptBar } from './scriptbar.js';
import { notebook } from './notebookview.js';
import { go, openBook } from './routing.js';
import { refreshWords, syncWoven, toggleNumbering } from './manuscript.js';
import { renderCrumb, renderRail, subtree } from './rail.js';
import { areaOptions, nudgeBook, renderLibrary, renderProject, renderWorld } from './libraryview.js';
import { newDraft, newDraftFrom, printCurrent } from './revising.js';
import { openShare, sharing } from './sharing.js';
import { production } from './productionwiring.js';

// ---------- tidying up: rename, move, change kind, the Trash ----------

const plural = (n, word, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;
const nameOf = (row) => (row.kind === 'day' ? titleOf(row) : row.title || (row.kind === 'page' ? 'Untitled page' : 'Untitled'));
const KINDS = FORMATS;

async function refreshViews() {
  if (state.project) {
    const p = await getEntry(state.project.id);
    state.project = gone(p) ? null : p;
    if (state.project) state.acts = await outline(state.project.id);
  }
  if (view() === 'library') await renderLibrary();
  if (view() === 'project') await renderProject();
  if (view() === 'world') await renderWorld();
  if (stagePage?.isOpen) await stagePage.refresh();
  if (view() === 'production' || view() === 'deliver') await production?.refresh();
  if (inNotebook() && notebook.page && !notebook.isDay) {
    const p = await getEntry(notebook.page.id);
    if (p && !gone(p)) { notebook.page = notebook.store.page = p; notebook.renderHead(); }
  }
  renderRail();
  renderCrumb();
}

// The chapter on screen has gone (here or on another device): finish saving,
// then let it go, so nothing typed later is saved into it.
async function leaveChapter() {
  await store.close(editor.state.doc);
  store.detach();
  state.chapterId = null;
  editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }, { emitUpdate: false });
  await notes.load(null);
}

// Is `id` the entry `root` or somewhere inside it (by parent, or a book in an area)?
async function isWithin(id, root) {
  let r = id && (await getEntry(id));
  for (let i = 0; r && i < 80; i++) {
    if (r.id === root.id) return true;
    const up = r.parent_id || (['project', 'world'].includes(r.kind) ? r.area_id : null);
    r = up ? await getEntry(up) : null;
  }
  return false;
}

async function rename(row) {
  const title = await askText({ title: `Rename ${row.kind === 'project' ? kindName(row).toLowerCase() : row.kind}`, value: row.title || '' });
  if (!title) return;
  const fresh = await getEntry(row.id);
  await putEntries([{ ...fresh, title, updated_at: Date.now() }]);
  await refreshViews();
}

// Put something in the Trash. Anything holding writing asks first; everything
// can be brought back (Undo right away, or from the Trash in the Library).
async function toTrash(row) {
  const c = await contents(row);
  const held = [
    c.worlds && plural(c.worlds, 'world'),
    c.books && plural(c.books, 'piece'),
    c.areas && plural(c.areas, 'smaller area'),
    c.chapters && row.kind !== 'chapter' && plural(c.chapters, 'chapter'),
    c.words && plural(c.words, 'word'),
    c.pages && plural(c.pages, 'page'),
    !c.words && c.written && plural(c.written, 'written line')
  ].filter(Boolean);
  const name = nameOf(row);
  // A world whose pieces are still empty goes without asking (Undo is right there).
  if (c.words || c.worlds || c.areas || c.written > 3 || (c.books && row.kind !== 'world')) {
    const ok = await ask({
      title: `Move “${name}” to the Trash?`,
      body: `It holds ${held.join(', ')}. Nothing is deleted: you can bring it all back from the Trash at the bottom of the Library.`,
      ok: 'Move to Trash', danger: true
    });
    if (!ok) return;
  }
  // Step out of it first and finish saving, so nothing still open writes over it.
  const here = view() === 'write' ? state.chapterId : view() === 'project' ? state.bookId : view() === 'world' ? state.worldId : inNotebook() ? notebook.page?.id : null;
  const leaving = !!here && (await isWithin(here, row));
  let away = null;
  if (leaving) {
    if (view() === 'write') {
      await leaveChapter();
      away = state.project && !(await isWithin(state.project.id, row)) ? { view: 'project', id: state.project.id } : { view: 'library' };
    } else if (view() === 'project' || view() === 'world') {
      const w = view() === 'project' ? await worldOf(await getEntry(state.bookId)) : null;
      away = w && !(await isWithin(w.id, row)) ? { view: 'world', id: w.id } : { view: 'library' };
    } else {
      await notebook.close();
      const w = await worldOf(notebook.page);
      away = w && !(await isWithin(w.id, row)) ? { view: 'world', id: w.id } : { view: 'notebook', pageId: dayId(isoToday()) };
    }
  } else if (state.chapterId && (await isWithin(state.chapterId, row))) await leaveChapter();
  await trash(row);
  if (away) await go(away);
  await refreshViews();
  toast(`“${name}” is in the Trash`, { label: 'Undo', run: async () => { await restore(row.id); await refreshViews(); toast(`“${name}” is back`); } });
}

async function setKind(book, type) {
  const b = await getEntry(book.id);
  if (bookType(b) === type) return;
  const s = await stats(b);
  if (hasManuscript(b) && !['novel', 'screenplay'].includes(type) && s.words) {
    const ok = await ask({
      title: `Write “${nameOf(b)}” as ${type === 'lines' ? 'an outline' : 'pages'}?`,
      body: `Its manuscript (${plural(s.words, 'word')}) stays exactly as it is and is still listed on its page. Change it back any time.`,
      ok: 'Change it'
    });
    if (!ok) return;
  }
  const next = await changeType(b, type);
  if (state.project?.id === b.id) {
    state.project = next;
    if (view() === 'write') { root.classList.toggle('script', type === 'screenplay'); await syncWoven(next); placeScriptBar(); refreshWords(); }
  }
  await refreshViews();
  toast(`“${nameOf(b)}” is now written as ${formatName(next).toLowerCase()}`, { label: 'Undo', run: async () => { await changeType(await getEntry(b.id), bookType(b)); if (state.project?.id === b.id) { state.project = await getEntry(b.id); if (view() === 'write') { root.classList.toggle('script', bookType(b) === 'screenplay'); await syncWoven(state.project); } } await refreshViews(); } });
}

async function moveBookToArea(book, areaId) {
  const b = await getEntry(book.id);
  await putEntries([{ ...b, area_id: areaId, updated_at: Date.now() }]);
  await refreshViews();
}

// A piece moves to another world, or into another piece (an episode into its season).
async function movePiece(piece, parentId) {
  const p = await getEntry(piece.id);
  if (p.parent_id === parentId || p.id === parentId) return;
  const target = await getEntry(parentId);
  if (!target || (await isWithin(parentId, p))) return;
  const w = target.kind === 'world' ? target : await worldOf(target);
  const sort = ((await piecesIn(parentId)).at(-1)?.sort || 0) + 1;
  await putEntries([{ ...p, parent_id: parentId, area_id: w?.area_id ?? p.area_id, sort, updated_at: Date.now() }]);
  await refreshViews();
  toast(`Moved to ${nameOf(target)}`, { label: 'Undo', run: async () => { await putEntries([{ ...(await getEntry(p.id)), parent_id: p.parent_id, area_id: p.area_id, sort: p.sort, updated_at: Date.now() }]); await refreshViews(); } });
}

// Where a piece or page can go: every world, and the pieces or pages inside them.
async function homesFor(row) {
  const out = [];
  for (const w of (await worlds()).sort((a, b) => (a.title || '').localeCompare(b.title || ''))) {
    out.push({ id: w.id, label: w.title || 'Untitled', depth: 0 });
    const { pieces, pages } = await worldTree(w.id);
    const list = row.kind === 'project' ? pieces : pages;
    for (const { row: r, depth } of list) out.push({ id: r.id, label: r.title || 'Untitled', depth: depth + 1 });
  }
  const mine = new Set();
  for (const h of out) if (h.id === row.id || (await isWithin(h.id, row))) mine.add(h.id);
  return out.filter((h) => !mine.has(h.id)).map((h) => ({ ...h, label: `${'  '.repeat(h.depth)}${h.label}` }));
}

async function movePage(page, parentId) {
  const p = await getEntry(page.id);
  if ((p.parent_id || null) === (parentId || null)) return;
  if (parentId && (parentId === p.id || (await isWithin(parentId, p)))) return;
  const sort = parentId ? (await pagesIn(parentId)).length + 1 : 0;
  await putEntries([{ ...p, parent_id: parentId || null, sort, updated_at: Date.now() }]);
  await refreshViews();
  const to = parentId ? nameOf(await getEntry(parentId)) : 'Loose pages';
  toast(`Moved to ${to}`, { label: 'Undo', run: async () => { await putEntries([{ ...(await getEntry(p.id)), parent_id: p.parent_id, sort: p.sort, updated_at: Date.now() }]); await refreshViews(); } });
}

// Renumber a list in order, writing only what changed.
async function reorder(list, extra = {}) {
  const now = Date.now();
  const rows = list.map((r, i) => ({ r, sort: i + 1 })).filter(({ r, sort }) => r.sort !== sort || Object.entries(extra[r.id] || {}).some(([k, v]) => r[k] !== v))
    .map(({ r, sort }) => { const { chapters: _c, ...row } = r; return { ...row, ...(extra[r.id] || {}), sort, updated_at: now }; });
  await putEntries(rows);
}

// A chapter one step up or down; past the end of its act it moves into the next one.
async function moveChapter(ch, dir) {
  const book = await bookOf(ch);
  const acts = await outline(book.id);
  const ai = acts.findIndex((a) => a.chapters.some((c) => c.id === ch.id));
  const list = acts[ai].chapters;
  const i = list.findIndex((c) => c.id === ch.id);
  const j = i + dir;
  if (j >= 0 && j < list.length) {
    [list[i], list[j]] = [list[j], list[i]];
    await reorder(list);
  } else {
    const to = acts[ai + dir];
    if (!to) return;
    list.splice(i, 1);
    if (dir < 0) to.chapters.push(ch); else to.chapters.unshift(ch);
    await reorder(list);
    await reorder(to.chapters, { [ch.id]: { parent_id: to.id } });
  }
  await refreshViews();
}

async function moveChapterToAct(ch, act) {
  const fresh = await getEntry(act.id);
  const there = await children(fresh.id);
  await putEntries([{ ...(await getEntry(ch.id)), parent_id: act.id, sort: (there.at(-1)?.sort || 0) + 1, updated_at: Date.now() }]);
  await refreshViews();
}

async function moveAct(act, dir) {
  const book = await bookOf(act);
  const acts = await outline(book.id);
  const i = acts.findIndex((a) => a.id === act.id);
  const j = i + dir;
  if (j < 0 || j >= acts.length) return;
  [acts[i], acts[j]] = [acts[j], acts[i]];
  await reorder(acts);
  await refreshViews();
}

async function moveArea(area, parentId) {
  await putEntries([{ ...(await getEntry(area.id)), parent_id: parentId, updated_at: Date.now() }]);
  await refreshViews();
}

// The menus. Each is built when opened, so it always reflects what's there now.
// A piece's menu.
async function bookMenu(book) {
  const b = await getEntry(book.id);
  const world = await worldOf(b);
  const writable = hasManuscript(b) || bookType(b) === 'lines';
  const script = bookType(b) === 'screenplay';
  return [
    { label: writable ? (bookType(b) === 'lines' ? 'Open the outline' : 'Open the manuscript') : 'Open', run: () => (writable ? openBook(b.id) : go({ view: 'project', id: b.id })) },
    ...(view() !== 'project' || state.bookId !== b.id ? [{ label: 'Its page', run: () => go({ view: 'project', id: b.id }) }] : []),
    { label: 'Rename…', run: () => rename(b) },
    { label: 'What it is (Gag, Episode…)…', run: () => setLabel(b) },
    { label: 'Written as', sub: KINDS.map(([id, label]) => ({ label, current: bookType(b) === id, run: () => setKind(b, id) })) },
    { label: 'Stage', sub: stagesOf(b, world).map((st) => ({ label: st, current: stageOf(b, world) === st, run: () => setStage(b, st) })) },
    { label: `Stages: ${stageSetOf(b, world).name}`, sub: allSets().map((set) => ({ label: `${set.name}: ${set.about.toLowerCase()}`, current: stageSetOf(b, world).id === set.id, run: () => setPieceStages(b, set.id) })) },
    ...(script ? [{ label: b.fields?.numbered ? 'Scene numbers: turn off' : 'Number the scenes (for production)…', run: () => toggleNumbering(b) }] : []),
    ...(hasManuscript(b) ? [{ label: 'Production (shots, kit, shoot days)', run: () => go({ view: 'production', id: b.id }) }] : []),
    ...(hasManuscript(b) ? [{ label: 'Revise', sub: [
      { label: 'Compare drafts or dates', run: () => go({ view: 'compare', id: b.id }) },
      { label: 'New draft from this one (keep a copy of this draft)…', run: () => newDraftFrom(b) },
      { label: 'Start a new draft from scratch…', run: () => newDraft(b) },
      { label: 'Print, or save as PDF', run: async () => { await go({ view: 'project', id: b.id }); await printCurrent(); } }
    ] }] : []),
    ...(hasManuscript(b) ? [{ label: 'Share a link to read and comment…', run: () => openShare(b) }] : []),
    { label: 'New piece inside (an episode in a season…)', run: () => addPiece(b.id) },
    { label: 'New page in it', run: async () => { await go({ view: 'notebook' }); await notebook.newPage(b.id); } },
    { label: 'What Claude knows about this piece…', run: () => showClaudeKnows(b) },
    { label: 'Move to', sub: (await homesFor(b)).map((h) => ({ label: h.label, current: b.parent_id === h.id, run: () => movePiece(b, h.id) })) },
    'sep',
    { label: 'Move to Trash…', danger: true, run: () => toTrash(b) }
  ];
}

async function worldMenu(world) {
  const w = await getEntry(world.id);
  const all = await areas();
  const top = await piecesIn(w.id);
  return [
    ...(view() !== 'world' || state.worldId !== w.id ? [{ label: 'Open', run: () => go({ view: 'world', id: w.id }) }] : []),
    { label: 'Rename…', run: () => rename(w) },
    { label: 'New piece…', run: () => addPiece(w.id) },
    { label: 'What Claude knows about this world…', run: () => showClaudeKnows(w) },
    ...(!inPane && paneHost() && !root.classList.contains('hide-panes') && view() === 'world' && state.worldId === w.id ? [{ label: 'Talk it through with Claude', keys: '⌥T', run: () => openTalk() }] : []),
    { label: 'New page in its bible', run: async () => { await go({ view: 'notebook' }); await notebook.newPage(w.id); } },
    { label: 'Move to area', sub: (await areaOptions(all)).map(([id, label]) => ({ label: label.trim(), current: w.area_id === id, run: () => moveBookToArea(w, id) })) },
    ...(!isLife(w) ? [{ label: 'Workflow…', run: () => openStages(w) }] : []),
    { label: 'Shape', sub: [
      ...SHAPES.map((sh) => ({ label: `${sh.name}: ${sh.about.toLowerCase()}`, current: shapeOf(w, top.length).id === sh.id, run: () => setShape(w, sh.id) })),
      ...(shapeOf(w, top.length).levels.length ? ['sep', { label: `Rename levels (${levelsOf(w, shapeOf(w, top.length)).map((l) => l.label).join(' › ')})…`, run: () => renameLevels(w) }] : [])
    ] },
    ...(isLife(w) ? [{ label: 'Meeting notes go here', sub: [['business', 'Business meetings'], ['filmmaking', 'Filmmaking meetings'], ['other', 'Other meetings']].map(([k, label]) => ({ label, current: (w.fields?.meetings || []).includes(k), run: () => setMeetings(w, k) })) }] : []),
    ...(view() === 'library' ? [
      { label: 'Move earlier in my order', run: () => nudgeBook(w, -1) },
      { label: 'Move later in my order', run: () => nudgeBook(w, 1) }
    ] : []),
    'sep',
    { label: 'Move to Trash…', danger: true, run: () => toTrash(w) }
  ];
}

// What a project is. Nothing moves or gets renamed: the shape only says
// what new pieces start as (Seasons and Episodes in a Show).
async function setShape(world, id) {
  const w = await getEntry(world.id);
  if (id === 'life') return setLife(w, true);
  if (isLife(w)) { await setLife(w, false); }
  const fresh = await getEntry(w.id);
  const now = { ...fresh, fields: { ...fresh.fields, shape: id }, updated_at: Date.now() };
  await putEntries([now]);
  await refreshViews();
  const sh = SHAPES.find((x) => x.id === id);
  const levels = levelsOf(now, sh);
  toast(`Now ${id === 'one' ? 'one piece' : `a ${sh.name.toLowerCase()}`}. Nothing moved${levels.length ? `; new pieces start as ${levels.map((l) => l.label + 's').join(', then ')}` : ''}.`);
  if (id === 'show') await offerSeason(now, levels);
}

// A project that became a Show can put what it already has into Season 1,
// as its Episodes, only if you say so; Undo puts everything back.
async function offerSeason(world, levels) {
  const [group, piece] = levels.map((l) => l.label);
  const loose = (await piecesIn(world.id)).filter((p) => kindName(p) !== group);
  if (!loose.length) return;
  const one = loose.length === 1;
  const ok = await ask({ title: `Put ${one ? `${loose[0].title || 'it'}` : `these ${loose.length} pieces`} into ${group} 1?`, body: `${one ? 'It becomes' : 'They become'} ${one ? `${piece} 1` : `its ${piece.toLowerCase()}s`}, in the same order. Nothing in ${one ? 'it' : 'them'} changes, and you can undo it.`, ok: `Put ${one ? 'it' : 'them'} in`, cancel: 'Leave as is' });
  if (!ok) return;
  const before = loose.map((p) => ({ ...p }));
  const season = await newPiece(world.id, 'lines', `${group} 1`, null, group);
  const t = Date.now();
  await putEntries([
    { ...season, sort: Math.min(...loose.map((p) => p.sort || 0)) - 1, updated_at: t },
    ...loose.map((p) => ({ ...p, parent_id: season.id, fields: { ...p.fields, ...(p.fields?.label ? {} : { label: piece }) }, updated_at: t }))
  ]);
  await refreshViews();
  toast(`${one ? `${loose[0].title || 'It'} is` : `${loose.length} pieces are`} in ${group} 1 now`, { label: 'Undo', run: async () => {
    const s = await getEntry(season.id);
    await putEntries([...before.map((p) => ({ ...p, updated_at: Date.now() })), { ...s, deleted: true, updated_at: Date.now() }]);
    await refreshViews();
  } });
}

// Your own names for a shape's levels in this project. Pieces you already
// have keep theirs; new ones start with the new names.
async function renameLevels(world) {
  const w = await getEntry(world.id);
  const shape = shapeOf(w, (await piecesIn(w.id)).length);
  const now = levelsOf(w, shape).map((l) => l.label);
  const got = await askText({ title: 'Rename levels', body: `What ${shape.levels.length > 1 ? 'they are' : 'it is'} called in ${w.title || 'this project'}, biggest first${shape.levels.length > 1 ? ', with › or a comma between' : ''}. For example ${shape.levels.length > 1 ? 'Batch › Reel' : 'Reel'}. Pieces you already have keep their names.`, value: now.join(' › '), ok: 'Save' });
  if (got === null || got === undefined) return;
  const names = got.split(/›|>|,/).map((x) => x.trim()).slice(0, shape.levels.length);
  const levelNames = shape.levels.map((l, i) => (names[i] && names[i] !== l.label ? names[i] : ''));
  const fields = { ...w.fields, levelNames };
  if (!levelNames.some(Boolean)) delete fields.levelNames;
  await putEntries([{ ...w, fields, updated_at: Date.now() }]);
  await refreshViews();
  toast(`New pieces in ${w.title || 'it'} start as ${levelsOf({ fields }, shape).map((l) => l.label + 's').join(', then ')}`);
}

// The stages a project's pieces go through, and its names for them.
async function openStages(world) {
  const w = await getEntry(world.id);
  const pieces = (await worldTree(w.id)).pieces.map(({ row }) => row);
  const rows = await editStages(w, pieces, { keepOwn, deleteOwn, usedBy: ownUsedBy });
  if (!rows) return;
  const before = [w, ...pieces.filter((p) => rows.some((r) => r.id === p.id))];
  await putEntries(rows);
  await refreshViews();
  const moved = rows.length - 1;
  toast(`Workflow saved${moved ? `; ${plural(moved, 'piece')} moved with them` : ''}`, { label: 'Undo', run: async () => { await putEntries(before.map((r) => ({ ...r, updated_at: Date.now() }))); await refreshViews(); } });
}

// A workflow of your own, to start the next project from.
async function keepOwn(row) {
  await putEntries([row]);
  addOwnWorkflow(row);
  toast(`“${row.title}” is one of your workflows now; pick it under More when you make something new`);
}

// Which projects, and which of their pieces, go through one of your own workflows.
async function ownUses(set) {
  const out = [];
  for (const w of await worlds()) {
    const pieces = (await worldTree(w.id)).pieces.map(({ row }) => row).filter((p) => stageSetOf(p, w).id === set.id);
    if (pieces.length || Object.values(w.fields?.stageFor || {}).includes(set.id)) out.push({ w, pieces });
  }
  return out;
}
const ownUsedBy = async (set) => (await ownUses(set)).map(({ w }) => w.title || 'Untitled');

// Delete a workflow of your own. Projects that used it go the way it was
// built from (its base), and each piece moves to the step at the same point;
// Undo puts the workflow, the projects and the pieces back.
async function deleteOwn(set) {
  const row = await getEntry(set.id);
  if (!row) return false;
  const t = Date.now();
  const before = [row];
  const rows = [{ ...row, deleted: true, updated_at: t }];
  for (const { w, pieces } of await ownUses(set)) {
    const fields = { ...w.fields };
    const stageFor = Object.fromEntries(Object.entries(fields.stageFor || {}).map(([k, v]) => [k, v === set.id ? set.base : v]));
    const { [set.id]: _s, ...stageLists } = fields.stageLists || {};
    const { [set.id]: _t, ...toolLists } = fields.toolLists || {};
    Object.assign(fields, { stageFor, stageLists, toolLists });
    for (const k of ['stageFor', 'stageLists', 'toolLists']) if (!Object.keys(fields[k]).length) delete fields[k];
    before.push(w);
    rows.push({ ...w, fields, updated_at: t });
    const after = { ...w, fields };
    for (const p of pieces) {
      const old = stagesOf(p, w);
      const i = old.indexOf(stageOf(p, w));
      const pf = { ...p.fields };
      if (pf.stageSet === set.id) pf.stageSet = set.base;
      const now = stagesOf({ ...p, fields: pf }, after);
      // The last step stays the last (out in the world); the rest keep their point.
      if (pf.stage) pf.stage = i === old.length - 1 ? now[now.length - 1] : now[Math.min(i, now.length - 2)];
      before.push(p);
      rows.push({ ...p, fields: pf, updated_at: t });
    }
  }
  await putEntries(rows);
  dropOwnWorkflow(set.id);
  await refreshViews();
  toast(`Deleted “${set.name}”`, { label: 'Undo', run: async () => {
    await putEntries(before.map((r) => ({ ...r, updated_at: Date.now() })));
    addOwnWorkflow(row);
    await refreshViews();
  } });
  return true;
}

// One piece through a different set of stages (a live-action short in a Show of AI reels).
async function setPieceStages(piece, setId) {
  const b = await getEntry(piece.id);
  const world = await worldOf(b);
  const fields = { ...b.fields };
  const usual = stageSetOf({ fields: { type: bookType(b) } }, world).id;
  const at = stageOf({ ...b, fields: { ...b.fields, stageSet: setId } }, world);
  if (setId === usual) delete fields.stageSet; else fields.stageSet = setId;
  if (b.fields?.stage) fields.stage = at;
  await putEntries([{ ...b, fields, updated_at: Date.now() }]);
  await refreshViews();
  toast(`${b.title || 'It'} goes through ${setById(setId).name} stages now: ${stagesIn(setById(setId), world).join(', ')}`);
}

// A life project: Overview, Gather and Notes only, and never shared. Nothing
// in it changes; switching back brings the six pages back.
async function setLife(world, on) {
  const w = await getEntry(world.id);
  if (isLife(w) === on) return;
  if (on) {
    const live = (await sharesOf()).filter((sh) => sh.fields?.world === w.id);
    if (live.length) {
      const ok = await ask({ title: 'Turn its share links off?', body: `Life projects are never shared. ${plural(live.length, 'link')} from it ${live.length === 1 ? 'is' : 'are'} still on; ${live.length === 1 ? 'it' : 'they'} will be turned off. Comments already in stay.`, ok: 'Turn them off' });
      if (!ok) return;
      for (const sh of live) await sharing.stop(sh).catch(() => {});
    }
  }
  const fields = { ...w.fields, life: on };
  if (!on) delete fields.life;
  await putEntries([{ ...w, fields, updated_at: Date.now() }]);
  await refreshViews();
  // Life projects belong in Personal: offered, not done, so nothing moves unasked.
  const home = on && personalArea(await areas());
  if (on && w.area_id !== home?.id) toast(`${w.title || 'It'} is a life project now: Overview, Gather and Notes`, { label: 'Move to Personal', run: () => toPersonal(w) });
  else toast(on ? `${w.title || 'It'} is a life project now: Overview, Gather and Notes` : `${w.title || 'It'} is a creative world again`);
}
// Into the Personal area, made if there isn't one yet.
async function personalAreaId() {
  const home = personalArea(await areas());
  return home ? home.id : (await newArea('Personal')).id;
}
async function toPersonal(world) {
  await moveBookToArea(world, await personalAreaId());
  toast(`${world.title || 'It'} is in Personal now`);
}

// Which meetings land in this life project (the meeting notes put them under it).
async function setMeetings(world, kind) {
  const w = await getEntry(world.id);
  const now = new Set(w.fields?.meetings || []);
  if (now.has(kind)) now.delete(kind); else now.add(kind);
  const rows = [{ ...w, fields: { ...w.fields, meetings: [...now] }, updated_at: Date.now() }];
  // One home for each kind of meeting.
  if (now.has(kind)) for (const o of await worlds()) if (o.id !== w.id && (o.fields?.meetings || []).includes(kind)) rows.push({ ...o, fields: { ...o.fields, meetings: o.fields.meetings.filter((k) => k !== kind) }, updated_at: Date.now() });
  await putEntries(rows);
  await refreshViews();
}

async function pageMenu(page) {
  const p = await getEntry(page.id);
  return [
    { label: 'Open', run: () => go({ view: 'notebook', pageId: p.id }) },
    { label: 'Rename…', run: () => rename(p) },
    { label: 'New page inside', run: async () => { await go({ view: 'notebook' }); await notebook.newPage(p.id); } },
    { label: 'History', run: async () => { if (!(inNotebook() && notebook.page?.id === p.id)) await go({ view: 'notebook', pageId: p.id }); await hstrip.open(); } },
    { label: 'Share a link to read and comment…', run: () => openShare(p) },
    { label: 'What Claude knows about this page…', run: () => showClaudeKnows(p) },
    { label: 'Move to', sub: [{ label: 'Loose pages (no world)', current: !p.parent_id, run: () => movePage(p, null) }, ...(await homesFor(p)).map((h) => ({ label: h.label, current: p.parent_id === h.id, run: () => movePage(p, h.id) }))] },
    'sep',
    { label: 'Move to Trash', danger: true, run: () => toTrash(p) }
  ];
}

// What a piece is, in your own words; labels you've used before are offered.
async function setLabel(piece) {
  const b = await getEntry(piece.id);
  const label = await askText({ title: 'What is it?', body: `For example ${(await usedLabels()).slice(0, 6).join(', ')}.`, value: kindName(b), ok: 'Save', list: await usedLabels() });
  if (label === null || label === undefined) return;
  const fields = { ...b.fields };
  if (label.trim() && label.trim() !== defaultLabel(bookType(b))) fields.label = label.trim(); else delete fields.label;
  await putEntries([{ ...b, fields, updated_at: Date.now() }]);
  await refreshViews();
}

async function setStage(piece, stage) {
  const b = await getEntry(piece.id);
  const was = b.fields?.stage;
  await putEntries([{ ...b, fields: { ...b.fields, stage }, updated_at: Date.now() }]);
  await refreshViews();
  toast(`${b.title || 'It'}: ${stage}`, { label: 'Undo', run: async () => {
    const now = await getEntry(b.id);
    const fields = { ...now.fields, stage: was };
    if (!was) delete fields.stage;
    await putEntries([{ ...now, fields, updated_at: Date.now() }]);
    await refreshViews();
  } });
}

// A new piece in a world or inside a piece: its name, what it is, how it's written.
async function addPiece(parentId) {
  const parent = await getEntry(parentId);
  const next = await nextLevel(parent);
  const got = await askPiece({
    title: `New ${next ? next.label.toLowerCase() : 'piece'} in ${nameOf(parent)}`,
    labels: await usedLabels(),
    label: next?.label || '',
    name: next ? `${next.label} ${next.n}` : '',
    type: next?.type,
    formats: [['screenplay', 'Script', 'A short, an episode, a film'], ['novel', 'Prose', 'A novel, a story'], ['lines', 'Outline', 'A gag, a season, loose lines']]
  });
  if (!got) return;
  const label = got.label && got.label !== defaultLabel(got.type) ? got.label : undefined;
  const piece = await newPiece(parentId, got.type, got.title, null, label);
  await refreshViews();
  await go({ view: 'project', id: piece.id });
}

async function chapterMenu(chapter) {
  const ch = await getEntry(chapter.id);
  const book = await bookOf(ch);
  const acts = book ? await outline(book.id) : [];
  const level = book?.fields?.levels?.[0] || 'Act';
  return [
    { label: 'Open', run: () => go({ view: 'write', chapterId: ch.id }) },
    { label: 'Rename…', run: () => rename(ch) },
    { label: 'History', run: async () => { if (!(writing() && state.chapterId === ch.id)) await go({ view: 'write', chapterId: ch.id }); await hstrip.open(); } },
    { label: 'Move up', run: () => moveChapter(ch, -1) },
    { label: 'Move down', run: () => moveChapter(ch, 1) },
    ...(acts.length > 1 ? [{ label: `Move to ${level.toLowerCase()}`, sub: acts.map((a) => ({ label: a.title, current: a.id === ch.parent_id, run: () => moveChapterToAct(ch, a) })) }] : []),
    'sep',
    { label: 'Move to Trash…', danger: true, run: () => toTrash(ch) }
  ];
}

async function actMenu(act) {
  const a = await getEntry(act.id);
  const book = await bookOf(a);
  const chLevel = book?.fields?.levels?.[1] || 'Chapter';
  return [
    { label: 'Rename…', run: () => rename(a) },
    { label: `New ${chLevel.toLowerCase()} in it`, run: async () => {
      const there = await children(a.id);
      const count = (await outline(book.id)).reduce((n, x) => n + x.chapters.length, 0);
      const ch = entry('chapter', { parent_id: a.id, title: `${chLevel} ${count + 1}`, sort: (there.at(-1)?.sort || 0) + 1 });
      await putEntries([ch]);
      await go({ view: 'write', chapterId: ch.id });
    } },
    { label: 'Move up', run: () => moveAct(a, -1) },
    { label: 'Move down', run: () => moveAct(a, 1) },
    'sep',
    { label: 'Move to Trash…', danger: true, run: () => toTrash(a) }
  ];
}

async function areaMenu(area) {
  const a = await getEntry(area.id);
  const all = await areas();
  const mine = subtree(a.id, all);
  return [
    { label: 'Open', run: () => go({ view: 'library', area: a.id }) },
    { label: 'Rename…', run: () => rename(a) },
    { label: 'New area inside', run: async () => { const t = await askText({ title: `New area inside ${a.title}`, ok: 'Add' }); if (t) { const n = await newArea(t, a.id); await go({ view: 'library', area: n.id }); } } },
    { label: 'Move inside', sub: [{ label: 'Top level', current: !a.parent_id, run: () => moveArea(a, null) }, ...(await areaOptions(all)).filter(([id]) => !mine.has(id)).map(([id, label]) => ({ label: label.trim(), current: a.parent_id === id, run: () => moveArea(a, id) }))] },
    'sep',
    { label: 'Move to Trash…', danger: true, run: () => toTrash(a) }
  ];
}

// The Trash, at the bottom of the Library.
async function renderTrash() {
  const rows = await trashed();
  const box = $('#lib-trash-box');
  box.hidden = !rows.length;
  $('#lib-trash-count').textContent = rows.length ? `(${rows.length})` : '';
  const what = (r) => (r.kind === 'project' ? kindName(r) : { world: 'World', area: 'Area', act: 'Act', chapter: 'Chapter', page: 'Page' }[r.kind] || 'Item');
  $('#lib-trash').replaceChildren(...rows.map((r) => {
    const li = make('li');
    const back = make('button', 'ghost-btn', 'Restore');
    back.addEventListener('click', async () => { await restore(r.id); await refreshViews(); toast(`“${nameOf(r)}” is back`); });
    const forever = make('button', 'ghost-btn danger', 'Delete forever');
    forever.addEventListener('click', async () => {
      const c = await contents(r);
      const ok = await ask({
        title: `Delete “${nameOf(r)}” forever?`,
        body: `This ${what(r).toLowerCase()}${c.words ? ` and its ${plural(c.words, 'word')}` : ''} will be gone from every device and can’t be brought back.`,
        ok: 'Delete forever', danger: true
      });
      if (!ok) return;
      await deleteForever(r.id);
      await refreshViews();
    });
    li.append(make('span', 'loose-title', nameOf(r)), make('span', 'when', `${what(r)} · trashed ${ago(r.fields.trashed)}`), back, forever);
    return li;
  }));
}

export { KINDS, actMenu, addPiece, areaMenu, bookMenu, chapterMenu, deleteOwn, keepOwn, leaveChapter, moveBookToArea, nameOf, openStages, ownUsedBy, pageMenu, personalAreaId, plural, refreshViews, renderTrash, setKind, setLife, setStage, worldMenu };
