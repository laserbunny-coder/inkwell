import { byKind, children, getEntry, putEntries, linkedFrom, getMeta, setMeta } from './db.js';
import { entry, newId, outline } from './model.js';

// How the vault is organized: areas (Writing, Filmmaking…) hold books and
// notes collections; a book holds its manuscript and its own note pages.
// Pages with no book yet are "loose" until they're moved somewhere.

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
  const homeless = (await byKind('project')).filter((p) => !p.deleted && !p.area_id);
  if (homeless.length) await putEntries(homeless.map((p) => ({ ...p, area_id: 'area-writing', updated_at: Date.now() })));
}

export async function areas() {
  return (await byKind('area')).filter((a) => !a.deleted).sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.title.localeCompare(b.title));
}

export async function books() {
  return (await byKind('project')).filter((p) => !p.deleted);
}

export const bookType = (p) => p?.fields?.type || 'novel';
// Novels and screenplays are written in the manuscript view; notes collections are pages.
export const hasManuscript = (p) => ['novel', 'screenplay'].includes(bookType(p));
export const kindName = (p) => ({ novel: 'Novel', screenplay: 'Screenplay', notes: 'Notes collection' })[bookType(p)] || 'Novel';
export const areaColor = (a) => a?.fields?.color || '#A39A8B';

export async function newArea(title, parentId = null) {
  const all = await areas();
  const area = entry('area', { id: newId('ar'), title, parent_id: parentId, sort: all.length + 1, fields: { color: PALETTE[all.length % PALETTE.length] } });
  await putEntries([area]);
  return area;
}

// A new book starts with an Idea page to think it through. A screenplay is
// one script (a chapter) that opens on a scene heading; `lines` fills it,
// for a script brought in from Fountain.
export async function newBook(type, title, areaId, lines) {
  const rows = [];
  const levels = type === 'novel' ? ['Act', 'Chapter', 'Scene'] : type === 'screenplay' ? ['Act', 'Script', 'Scene'] : null;
  const project = entry('project', { title, area_id: areaId, fields: { type, ...(levels ? { levels } : {}) } });
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
        content: l.text ? [{ type: 'text', text: l.text }] : null, fields: { el: l.el }
      })));
  }
  rows.push(entry('page', { id: newId('pg'), parent_id: project.id, title: 'Idea', sort: 1 }));
  await putEntries(rows);
  return project;
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

export async function stats(project) {
  if (hasManuscript(project)) {
    const acts = await outline(project.id);
    const chapters = acts.flatMap((a) => a.chapters);
    const words = chapters.reduce((n, c) => n + (c.fields?.words || 0), 0);
    return { acts, chapters, words, pages: (await pagesIn(project.id)).length };
  }
  return { acts: [], chapters: [], words: 0, pages: (await pagesIn(project.id)).length };
}

// Lines on daily pages that link to this book, its chapters or its pages.
export async function dailyMentions(project, limit = 8) {
  const { chapters } = await stats(project);
  const targets = [project, ...chapters, ...(await pagesIn(project.id))];
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
