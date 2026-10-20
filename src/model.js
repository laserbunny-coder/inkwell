import { putEntries, byKind, children, getMeta, setMeta } from './db.js';

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

export async function noteTypes() {
  return (await getMeta('noteTypes')) || DEFAULT_NOTE_TYPES;
}

// First run: one empty project with one act and one chapter to start writing in.
export async function ensureSeed() {
  const projects = await byKind('project');
  if (projects.length) return projects[0];
  const project = entry('project', { title: 'Untitled novel', fields: { levels: ['Act', 'Chapter', 'Scene'] } });
  const act = entry('act', { parent_id: project.id, title: 'Act One', sort: 1 });
  const chapter = entry('chapter', { parent_id: act.id, title: 'Chapter 1', sort: 1 });
  await putEntries([project, act, chapter]);
  await setMeta('noteTypes', DEFAULT_NOTE_TYPES);
  await setMeta('lastChapter', chapter.id);
  return project;
}

export async function outline(projectId) {
  const acts = (await children(projectId)).filter((r) => r.kind === 'act');
  for (const act of acts) act.chapters = await children(act.id);
  return acts;
}
