import { byKind, children, getEntry, putEntries, linkedFrom, getMeta, setMeta } from './db.js';
import { entry, newId, outline } from './model.js';

// How the vault is organized: areas (Writing, Filmmaking…) hold worlds. A
// world is everything about one story or show: its bible (pages, which can
// hold pages of their own) and its pieces. A piece is anything made in that
// world at any size (a gag, an episode, a novel, a film), written as prose, a
// script or an outline, and it can hold smaller pieces (a season holds its
// episodes). A piece is kind 'project' (it used to be a whole book, so all
// the manuscript code still works on it); a world is kind 'world'. Pages with
// nowhere to live yet are "loose" until they're moved somewhere.

// Starter areas, the same as Daybook's plus Writing. Fixed ids, so two devices
// that both start fresh end up with the same areas instead of doubles.
const STARTER_AREAS = [
  { id: 'area-writing', title: 'Writing', color: '#9A4A2E' },
  { id: 'area-filmmaking', title: 'Filmmaking', color: '#1F6F64' },
  { id: 'area-business', title: 'Business', color: '#5B6E8C' },
  { id: 'area-personal', title: 'Personal', color: '#8C5B7A' }
];
const PALETTE = ['#9A4A2E', '#1F6F64', '#5B6E8C', '#8C5B7A', '#8C7A5B', '#4E6B3A', '#7A5BA8', '#A8743A'];

export async function ensureAreas() {
  if (!(await getMeta('areasSeeded'))) {
    const have = new Set((await byKind('area')).map((a) => a.id));
    // Kept local until edited: the cloud's copy (if any) always wins, so an
    // area deleted on one device doesn't come back from another.
    const rows = STARTER_AREAS.filter((a) => !have.has(a.id)).map((a, i) =>
      entry('area', { id: a.id, title: a.title, sort: i + 1, fields: { color: a.color }, created_at: 0, updated_at: 0 }));
    if (rows.length) await putEntries(rows, { fromSync: true });
    await setMeta('areasSeeded', true);
  }
  const homeless = [...(await byKind('world')), ...(await byKind('project')).filter((p) => !p.parent_id)].filter((p) => !p.deleted && !p.area_id);
  if (homeless.length) await putEntries(homeless.map((p) => ({ ...p, area_id: 'area-writing', updated_at: Date.now() })));
}

export async function areas() {
  return (await byKind('area')).filter((a) => !a.deleted).sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.title.localeCompare(b.title));
}

// Every piece, in every world (books, before worlds).
export async function books() {
  return (await byKind('project')).filter((p) => !p.deleted);
}

export async function worlds() {
  return (await byKind('world')).filter((w) => !w.deleted);
}

// How a piece is written: prose and scripts in the manuscript view, an
// outline in the notebook. 'notes' is a book from before worlds that only
// held pages.
export const bookType = (p) => p?.fields?.type || 'novel';
export const hasManuscript = (p) => ['novel', 'screenplay'].includes(bookType(p));
export const FORMATS = [['novel', 'Prose'], ['screenplay', 'Script'], ['lines', 'Outline']];
export const formatName = (p) => ({ novel: 'Prose', screenplay: 'Script', lines: 'Outline', notes: 'Pages' })[bookType(p)] || 'Prose';
// What a piece is, in your own words (Gag, Episode, Season…); until it has
// one, what its format suggests.
export const defaultLabel = (type) => ({ novel: 'Novel', screenplay: 'Screenplay', lines: 'Outline', notes: 'Notes' })[type] || 'Piece';
export const kindName = (p) => p?.fields?.label || defaultLabel(bookType(p));
// Where a piece is on its way out into the world.
export const STAGES = ['Idea', 'Written', 'Boarded', 'Generated', 'Edited', 'Posted'];
export const stageOf = (p) => p?.fields?.stage || 'Idea';
export const areaColor = (a) => a?.fields?.color || '#A39A8B';

export async function newArea(title, parentId = null) {
  const all = await areas();
  const area = entry('area', { id: newId('ar'), title, parent_id: parentId, sort: all.length + 1, fields: { color: PALETTE[all.length % PALETTE.length] } });
  await putEntries([area]);
  return area;
}

// A new world starts with an Idea page in its bible, to think it through.
export async function newWorld(title, areaId) {
  const world = entry('world', { id: newId('wd'), title, area_id: areaId || null });
  const idea = entry('page', { id: newId('pg'), parent_id: world.id, title: 'Idea', sort: 1 });
  await putEntries([world, idea]);
  return world;
}

// A new book is a new world with the book as its first piece.
export async function newBook(type, title, areaId, lines) {
  const world = await newWorld(title, areaId);
  return newPiece(world.id, type, title, lines);
}

// A piece in a world, or inside another piece. A screenplay is one script (a
// chapter) that opens on a scene heading; `lines` fills it, for a script
// brought in from Fountain.
export async function newPiece(parentId, type, title, lines, label) {
  const rows = [];
  const levels = type === 'novel' ? ['Act', 'Chapter', 'Scene'] : type === 'screenplay' ? ['Act', 'Script', 'Scene'] : null;
  const siblings = (await children(parentId)).filter((r) => r.kind === 'project');
  const world = await worldOf({ parent_id: parentId });
  // A script brought in with its scene numbers stays numbered.
  const numbered = lines?.some((l) => l.code);
  const project = entry('project', {
    title, parent_id: parentId, area_id: world?.area_id || null, sort: (siblings.at(-1)?.sort || 0) + 1,
    fields: { type, ...(levels ? { levels } : {}), ...(label ? { label } : {}), ...(numbered ? { numbered: true } : {}) }
  });
  rows.push(project);
  if (type === 'novel') {
    const act = entry('act', { parent_id: project.id, title: 'Act One', sort: 1 });
    rows.push(act, entry('chapter', { parent_id: act.id, title: 'Chapter 1', sort: 1 }));
  }
  if (type === 'screenplay') {
    const act = entry('act', { parent_id: project.id, title: 'Screenplay', sort: 1 });
    const script = entry('chapter', { parent_id: act.id, title: 'Script', sort: 1 });
    rows.push(act, script);
    const body = lines?.length ? lines : [{ el: 'scene', text: '' }];
    body.forEach((l, i) => rows.push(l.el === 'section'
      ? entry('scene', { id: newId('sc'), parent_id: script.id, sort: (i + 1) * 1024, title: l.text })
      : entry('para', {
        id: newId('pa'), parent_id: script.id, sort: (i + 1) * 1024, text: l.text,
        content: l.text ? [{ type: 'text', text: l.text }] : null, fields: { el: l.el, ...(l.code ? { code: l.code } : {}) }
      })));
  }
  await putEntries(rows);
  return project;
}

// The world anything belongs to (a piece, a page, a chapter, a line), if any.
export async function worldOf(row) {
  let r = row;
  for (let i = 0; r && i < 80; i++) {
    if (r.kind === 'world') return r;
    if (r.kind === 'day') return null;
    r = r.parent_id ? await getEntry(r.parent_id) : null;
  }
  return null;
}

// Pieces right inside a world or a piece, in order.
export async function piecesIn(id) {
  return (await children(id)).filter((r) => r.kind === 'project');
}

// Every piece inside a world (pieces in pieces) and its bible pages (pages in
// pages), in order, each with how deep it sits. Pages a piece keeps for itself
// come back separately.
export async function worldTree(id) {
  const pieces = [];
  const pages = [];
  const piecePages = [];
  const walkPages = async (pid, depth, list) => {
    for (const r of await children(pid)) if (r.kind === 'page') { list.push({ row: r, depth }); await walkPages(r.id, depth + 1, list); }
  };
  const walkPieces = async (pid, depth) => {
    for (const r of await piecesIn(pid)) {
      pieces.push({ row: r, depth });
      await walkPages(r.id, 0, piecePages);
      await walkPieces(r.id, depth + 1);
    }
  };
  await walkPieces(id, 0);
  await walkPages(id, 0, pages);
  return { pieces, pages, piecePages };
}

// The labels already given to pieces, most used first, to offer again.
export async function usedLabels() {
  const n = new Map();
  for (const p of await books()) {
    const l = kindName(p);
    n.set(l, (n.get(l) || 0) + 1);
  }
  for (const d of ['Novel', 'Screenplay', 'Short', 'Gag', 'Episode', 'Season', 'Film']) if (!n.has(d)) n.set(d, 0);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
}

// Every book from before worlds becomes a world. A book with a manuscript
// gets a world around it (same name and area) and its pages move up into the
// world's bible; the book itself, its chapters and its id stay as they are, so
// links, progress and history carry on. A book that only ever held pages
// becomes a world in place. Ids are fixed (wd-<book id>), so two devices that
// both do this agree, and it runs again for any old book that arrives later
// from a device still on an older version. Nothing is deleted.
export async function ensureWorlds() {
  const all = await byKind('project', { withTrash: true });
  const now = Date.now();
  const rows = [];
  for (const p of all) {
    if (p.deleted || p.parent_id) continue;
    const acts = (await children(p.id, { withTrash: true })).filter((r) => r.kind === 'act');
    const trashed = p.fields?.trashed ? { trashed: p.fields.trashed, trashedWith: p.fields.trashedWith } : null;
    // When each was really last changed, so "Recently edited" keeps its order.
    const kept = (r) => ({ edited: r.fields?.edited || r.updated_at, moved: now });
    if (bookType(p) === 'notes' && !acts.length) {
      const { type: _t, levels: _l, ...fields } = p.fields || {};
      rows.push({ ...p, kind: 'world', fields: { ...fields, ...kept(p) }, updated_at: now });
      continue;
    }
    const id = `wd-${p.id}`;
    const have = await getEntry(id);
    const { order, ...fields } = p.fields || {};
    if (!have || have.deleted) {
      rows.push(entry('world', {
        id, title: p.title, area_id: p.area_id || null, created_at: p.created_at,
        fields: { ...(order !== undefined ? { order } : {}), ...(trashed || {}), ...kept(p) }
      }));
    }
    rows.push({ ...p, parent_id: id, fields: { ...fields, ...kept(p) }, updated_at: now });
    // Pages anywhere in the Trash keep their own group, so they come back the same way.
    for (const pg of (await children(p.id, { withTrash: true })).filter((r) => r.kind === 'page')) rows.push({ ...pg, parent_id: id, fields: { ...pg.fields, ...kept(pg) }, updated_at: now });
  }
  if (rows.length) await putEntries(rows, { stamp: false });
  return rows.length;
}

const LEVELS = { novel: ['Act', 'Chapter', 'Scene'], screenplay: ['Act', 'Script', 'Scene'] };

// Changing what a book is never removes any of it. A manuscript stays when a
// book becomes a notes collection (its home still lists it, and changing back
// picks up where it was); a book that gains a manuscript gets a first chapter
// only if it has none yet.
export async function changeType(project, type) {
  const now = Date.now();
  const from = bookType(project);
  if (type === from) return project;
  const fields = { ...project.fields, type };
  // Level names follow the kind unless they were renamed by hand.
  if (LEVELS[type] && (!fields.levels || JSON.stringify(fields.levels) === JSON.stringify(LEVELS[from]))) fields.levels = LEVELS[type];
  const rows = [{ ...project, fields, updated_at: now }];
  if (LEVELS[type] && !(await outline(project.id)).length) {
    const act = entry('act', { parent_id: project.id, title: type === 'screenplay' ? 'Screenplay' : 'Act One', sort: 1 });
    rows.push(act, entry('chapter', { parent_id: act.id, title: type === 'screenplay' ? 'Script' : 'Chapter 1', sort: 1 }));
  }
  await putEntries(rows);
  return rows[0];
}

export async function newPage(parentId, title = '') {
  const sort = parentId ? (await children(parentId)).filter((r) => r.kind === 'page').length + 1 : 0;
  const page = entry('page', { id: newId('pg'), parent_id: parentId || null, title, sort });
  await putEntries([page]);
  return page;
}

export async function pagesIn(projectId) {
  return (await children(projectId)).filter((r) => r.kind === 'page');
}

export async function loosePages() {
  return (await byKind('page')).filter((p) => !p.deleted && !p.parent_id).sort((a, b) => b.updated_at - a.updated_at);
}

// The book an entry belongs to, if any.
export async function bookOf(row) {
  let r = row;
  for (let i = 0; r && i < 60; i++) {
    if (r.kind === 'project') return r;
    if (r.kind === 'day') return null;
    r = r.parent_id ? await getEntry(r.parent_id) : null;
  }
  return null;
}

// A notes collection can still hold a manuscript from when it was a novel, so it's counted too.
export async function stats(project) {
  const acts = await outline(project.id);
  const chapters = acts.flatMap((a) => a.chapters);
  const words = chapters.reduce((n, c) => n + (c.fields?.words || 0), 0);
  return { acts, chapters, words, pages: (await pagesIn(project.id)).length };
}

// When something was last really changed: becoming part of a world doesn't count.
export const editedAt = (r) => (r.fields?.moved && r.updated_at - r.fields.moved < 15 * 60000 ? r.fields.edited || r.updated_at : r.updated_at);

// What a world comes to: its pieces and pages, and the words in its manuscripts.
export async function worldStats(world) {
  const { pieces, pages, piecePages } = await worldTree(world.id);
  let words = 0;
  const chapters = [];
  for (const { row } of pieces) {
    const s = await stats(row);
    words += s.words;
    chapters.push(...s.chapters);
  }
  const all = [...pages, ...piecePages];
  // Last written in: the world, its pieces and pages, or any chapter.
  const edited = Math.max(editedAt(world), ...pieces.map((p) => editedAt(p.row)), ...all.map((p) => editedAt(p.row)), ...chapters.map((c) => c.updated_at));
  return { pieces, pages: all, words, chapters, edited };
}

// Lines on daily pages that link to this book (or world), its chapters, pieces or pages.
export async function dailyMentions(project, limit = 8) {
  let targets;
  if (project.kind === 'world') {
    const { pieces, pages, chapters } = await worldStats(project);
    targets = [project, ...pieces.map((p) => p.row), ...chapters, ...pages.map((p) => p.row)];
  } else {
    const { chapters } = await stats(project);
    targets = [project, ...chapters, ...(await pagesIn(project.id))];
  }
  const seen = new Map();
  for (const t of targets) for (const row of await linkedFrom(t.id)) seen.set(row.id, row);
  const out = [];
  for (const row of [...seen.values()].sort((a, b) => b.updated_at - a.updated_at)) {
    let r = row;
    for (let i = 0; r && r.kind === 'line' && i < 50; i++) r = await getEntry(r.parent_id);
    if (r?.kind === 'day') out.push({ row, day: r });
    if (out.length >= limit) break;
  }
  return out;
}

export function ago(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
