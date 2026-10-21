import { allEntries, putEntries, getEntry, isTrashed } from './db.js';

// The Trash. Putting something in it never deletes anything: the item and
// everything inside it (a book's chapters, paragraphs, notes and pages; an
// area's books and smaller areas) are marked with when and with what they went,
// and every list stops showing them. Restoring clears the mark on exactly that
// group, so it all comes back as it was, on every device. Only "Delete forever"
// removes anything, and only from the Trash.

// Everything held by `root`: entries under it by parent, plus the books filed
// in an area and in the areas inside it.
function inside(root, rows) {
  const byParent = new Map();
  const byArea = new Map();
  for (const r of rows) {
    if (r.deleted) continue;
    if (r.parent_id) (byParent.get(r.parent_id) || byParent.set(r.parent_id, []).get(r.parent_id)).push(r);
    if (r.kind === 'project' && r.area_id) (byArea.get(r.area_id) || byArea.set(r.area_id, []).get(r.area_id)).push(r);
  }
  const out = [];
  const seen = new Set([root.id]);
  const queue = [root];
  while (queue.length) {
    const r = queue.shift();
    const next = [...(byParent.get(r.id) || []), ...(r.kind === 'area' ? byArea.get(r.id) || [] : [])];
    for (const c of next) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
      queue.push(c);
    }
  }
  return out;
}

const WRITTEN = ['para', 'heading', 'line', 'note'];

// What's in it, to say so before it goes: words in its chapters, books, pages.
// In the Trash already, count what went with it.
export async function contents(root) {
  const all = await allEntries();
  const self = all.find((r) => r.id === root.id) || root;
  const rows = [self, ...inside(root, all)].filter((r) => (isTrashed(self) ? r.fields?.trashedWith === self.id : !isTrashed(r)));
  const words = rows.filter((r) => r.kind === 'chapter').reduce((n, c) => n + (c.fields?.words || 0), 0);
  return {
    words,
    books: rows.filter((r) => r.kind === 'project' && r.id !== root.id).length,
    chapters: rows.filter((r) => r.kind === 'chapter' && r.id !== root.id).length,
    pages: rows.filter((r) => r.kind === 'page' && r.id !== root.id).length,
    areas: rows.filter((r) => r.kind === 'area' && r.id !== root.id).length,
    written: rows.filter((r) => WRITTEN.includes(r.kind) && (r.text || '').trim()).length
  };
}

export async function trash(root) {
  const now = Date.now();
  // Anything already in the Trash on its own stays in its own group.
  const rows = [root, ...inside(root, await allEntries())].filter((r) => !isTrashed(r));
  await putEntries(rows.map((r) => ({ ...r, fields: { ...r.fields, trashed: now, trashedWith: root.id }, updated_at: now })));
  return rows.length;
}

// Brings back a group. If what held it is in the Trash too (a chapter whose
// book went later), that comes back with it, so nothing returns to nowhere.
export async function restore(id) {
  const rows = await allEntries();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const groups = new Set([id]);
  for (let r = byId.get(id), i = 0; r && i < 60; i++) {
    const up = byId.get(r.parent_id) || (r.kind === 'project' ? byId.get(r.area_id) : null);
    if (up && isTrashed(up)) groups.add(up.fields.trashedWith);
    r = up;
  }
  const now = Date.now();
  const back = rows.filter((r) => !r.deleted && isTrashed(r) && groups.has(r.fields.trashedWith)).map((r) => {
    const { trashed: _t, trashedWith: _w, ...fields } = r.fields;
    return { ...r, fields, updated_at: now };
  });
  await putEntries(back);
  return back.length;
}

// What's in the Trash: one row per thing put there, newest first.
export async function trashed() {
  return (await allEntries()).filter((r) => !r.deleted && isTrashed(r) && r.fields.trashedWith === r.id)
    .sort((a, b) => b.fields.trashed - a.fields.trashed);
}

export async function deleteForever(id) {
  const now = Date.now();
  const gone = (await allEntries()).filter((r) => !r.deleted && r.fields?.trashedWith === id)
    .map((r) => ({ ...r, deleted: true, updated_at: now }));
  await putEntries(gone);
  return gone.length;
}

export async function inTrash(id) { return isTrashed(await getEntry(id)); }
