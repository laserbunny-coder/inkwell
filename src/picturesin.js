// Pictures onto scenes and shots, quickly, on a phone too (Nov 23 2026,
// Michael: "if we had a bunch of images, they need to be linked to sections.
// We need to be able to easily pick sections and then add images to them").
//
// One rule everywhere: pictures given to a scene fill its shots that have no
// picture yet, in order, and each one left over becomes a new shot at the end.
// Pictures given to one shot all go on that shot. The first picture a shot
// gets is its picked still. Every change can be undone in one step.
import { getEntry, putEntries, byKind } from './db.js';
import { addFile, isImage } from './files.js';
import { shotsUnder, newShot, withRenders } from './production.js';
import { bookType } from './library.js';

const hasPicture = (sh) => (sh.fields?.tries || []).some((t) => t.files?.length || t.links?.length);

// A File, or the id of a file already kept (a share). Returns the file id, or
// null when it isn't a picture or is too big.
async function keep(f, shotId) {
  if (typeof f === 'string') {
    const row = await getEntry(f);
    return row && isImage(row.fields?.type) ? row.id : null;
  }
  if (!isImage(f.type)) return null;
  const row = await addFile(f, { shot: shotId });
  return row?.id || null;
}

function withPicture(sh, ids) {
  const fields = withRenders(sh.fields || {}, ids);
  if (!fields.star?.still && ids.length) fields.star = { ...(fields.star || {}), still: ids[0] };
  const next = { ...sh, fields, updated_at: Date.now() };
  delete next._by;
  return next;
}

// Pictures on one shot. Returns { added, skipped, undo }.
export async function picturesOnShot(shotId, files) {
  const before = await getEntry(shotId);
  if (!before) return { added: 0, skipped: files.length, undo: async () => {} };
  const ids = [];
  for (const f of files) { const id = await keep(f, shotId); if (id) ids.push(id); }
  if (ids.length) await putEntries([withPicture(await getEntry(shotId), ids)]);
  return {
    added: ids.length,
    skipped: files.length - ids.length,
    undo: async () => { await putEntries([{ ...before, updated_at: Date.now() }]); }
  };
}

// Pictures on a scene: shots without a picture first, in order, then new shots.
// Returns { filled, made, skipped, rows, undo }.
export async function picturesOnScene(sceneId, files, { pieceId = null } = {}) {
  const shots = await shotsUnder(sceneId);
  const empty = shots.filter((sh) => !sh.deleted && !hasPicture(sh));
  const before = [];
  const made = [];
  let filled = 0;
  let skipped = 0;
  for (const f of files) {
    let target = empty.shift();
    const id = await keep(f, target?.id || null);
    if (!id) { if (target) empty.unshift(target); skipped += 1; continue; }
    if (target) {
      before.push({ ...target });
      filled += 1;
    } else {
      target = await newShot(sceneId, { pieceId, after: made.at(-1)?.id || shots.at(-1)?.id || null });
      made.push(target);
    }
    const fresh = await getEntry(target.id);
    await putEntries([withPicture(fresh, [id])]);
  }
  return {
    filled,
    made: made.length,
    skipped,
    undo: async () => {
      const now = Date.now();
      const rows = [...before.map((r) => ({ ...r, updated_at: now }))];
      for (const r of made) { const cur = await getEntry(r.id); if (cur) rows.push({ ...cur, deleted: true, updated_at: now }); }
      if (rows.length) await putEntries(rows);
    }
  };
}

// What the pictures did, in a few words: "3 pictures: 2 on shots, 1 new shot".
export function picturesText(r) {
  const n = r.filled + r.made;
  if (!n) return r.skipped ? 'Only pictures can go on shots' : 'No pictures';
  const parts = [];
  if (r.filled) parts.push(`${r.filled} on ${r.filled === 1 ? 'a shot' : 'shots'} without one`);
  if (r.made) parts.push(`${r.made} new ${r.made === 1 ? 'shot' : 'shots'}`);
  return `${n} ${n === 1 ? 'picture' : 'pictures'}: ${parts.join(', ')}${r.skipped ? ` (${r.skipped} left out)` : ''}`;
}

// The films pictures can go to, newest first, each with its scenes by name.
export async function filmsForPictures(limit = 6) {
  const films = (await byKind('project')).filter((p) => !p.deleted && bookType(p) === 'screenplay').sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).slice(0, limit);
  const { scenesOf } = await import('./app/pathnotes.js');
  const out = [];
  for (const f of films) {
    const scenes = await scenesOf(f).catch(() => []);
    if (scenes.length) out.push({ film: f, scenes });
  }
  return out;
}
