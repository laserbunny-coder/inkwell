import { putEntries, byKind, children, getMeta, setMeta, getEntry } from './db.js';

// Time-ordered random ids: sortable, safe to make offline on any device.
export function newId(prefix = 'e') {
  const t = Date.now().toString(36).padStart(9, '0');
  const r = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join('');
  return `${prefix}_${t}${r}`;
}

export function entry(kind, fields = {}) {
  const now = Date.now();
  return {
    id: fields.id || newId(kind.slice(0, 2)),
    kind,
    parent_id: null,
    sort: 0,
    title: '',
    text: '',
    content: null,
    tags: [],
    type: null,
    fields: {},
    area_id: null,
    links: [],
    deleted: false,
    created_at: now,
    updated_at: now,
    ...fields
  };
}

export function tagsIn(text) {
  const tags = new Set();
  for (const m of text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)) tags.add(m[1].toLowerCase());
  return [...tags];
}

export function wordCount(text) {
  const m = text.match(/[\p{L}\p{N}'’-]+/gu);
  return m ? m.length : 0;
}

// Note types are data, not code, so they can be renamed or added later.
export const DEFAULT_NOTE_TYPES = [
  { id: 'writing', name: 'Writing', color: '#2F5DA8' },
  { id: 'directing', name: 'Directing', color: '#A84E17' },
  { id: 'production', name: 'Production', color: '#1F7A6E' },
  { id: 'ai', name: 'AI production', color: '#6B4BB8' }
];

// Note categories are one shared entry, so a change on one device reaches the others.
const NOTE_TYPES_ID = 'settings-note-types';

export async function noteTypes() {
  const row = await getEntry(NOTE_TYPES_ID);
  if (row && !row.deleted && row.fields?.types?.length) return row.fields.types;
  return (await getMeta('noteTypes')) || DEFAULT_NOTE_TYPES;
}

export async function saveNoteTypes(types) {
  const prev = await getEntry(NOTE_TYPES_ID);
  await putEntries([{ ...(prev || entry('settings', { id: NOTE_TYPES_ID, title: 'Note categories' })), fields: { types }, deleted: false, updated_at: Date.now() }]);
}

// First run: one empty project with one act and one chapter to start writing in.
export async function ensureSeed() {
  // Books in the Trash count: putting your only book there shouldn't make a new one.
  const projects = await byKind('project', { withTrash: true });
  if (projects.length) return projects[0];
  if ((await byKind('world', { withTrash: true })).length) return null;
  const project = entry('project', { title: 'Untitled novel', fields: { levels: ['Act', 'Chapter', 'Scene'] } });
  // Its world has the id a book from before worlds would get, so a device
  // that started fresh ends up the same as one that was brought up to date.
  const world = entry('world', { id: `wd-${project.id}`, title: project.title, area_id: 'area-writing' });
  project.parent_id = world.id;
  project.area_id = 'area-writing';
  const act = entry('act', { parent_id: project.id, title: 'Act One', sort: 1 });
  const chapter = entry('chapter', { parent_id: act.id, title: 'Chapter 1', sort: 1 });
  await putEntries([world, project, act, chapter]);
  await setMeta('noteTypes', DEFAULT_NOTE_TYPES);
  await setMeta('lastChapter', chapter.id);
  return project;
}

export async function outline(projectId) {
  const acts = (await children(projectId)).filter((r) => r.kind === 'act');
  for (const act of acts) act.chapters = await children(act.id);
  return acts;
}
