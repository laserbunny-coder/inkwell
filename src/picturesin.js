// Pictures onto scenes and shots, quickly, on a phone too (Nov 23 2026,
// Michael: "if we had a bunch of images, they need to be linked to sections.
// We need to be able to easily pick sections and then add images to them").
//
// One rule everywhere: pictures given to a scene fill its shots that have no
// picture yet, in order, and each one left over becomes a new shot at the end.
// Pictures given to one shot all go on that shot. The first picture a shot
// gets is its picked still. Every change can be undone in one step.
import { getEntry, putEntries, byKind } from './db.js';
import { addFile, isImage, fileUrl, fileBlob } from './files.js';
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

// Where pictures come from. Each source hands back Files when picked (from a
// tap: it may open a picker). Today only Photo or file; a sketch pad and an
// image model join this list later, and land the same way.
// pick(ctx) may get { title, under (a file id to draw over), strokes (a
// sketch's strokes file id, to keep drawing) }.
export const pictureSources = [
  { id: 'sketch', label: 'Sketch', pick: (ctx) => sketch(ctx) },
  { id: 'photo', label: 'Photo or file', pick: () => pickFiles() }
];

// The pad, then the sketch as a board frame (never the video's first still),
// with its strokes kept as a small file so it can be opened again.
export async function sketch({ title = 'Sketch', under = null, strokes = null, from = null } = {}) {
  const { openSketchPad } = await import('./sketchpad.js');
  const underUrl = under ? await fileUrl(under).catch(() => null) : null;
  let old = null;
  if (strokes) { try { old = JSON.parse(await (await fileBlob(strokes)).text()); } catch { old = null; } }
  const out = await openSketchPad({ title, under: underUrl, strokes: old });
  if (!out) return [];
  const kept = await addFile(new File([JSON.stringify(out.strokes)], 'Sketch strokes.json', { type: 'application/json' }));
  const png = new File([out.blob], 'Sketch.png', { type: 'image/png' });
  return { files: [png], meta: { kind: 'board', source: 'sketch', ...(kept ? { strokes: kept.id } : {}), ...(from ? { from } : {}) } };
}
// The try a picture is in, and so whether it's a sketch that can be reopened.
export function tryOf(sh, fileId) { return (sh?.fields?.tries || []).find((t) => (t.files || []).includes(fileId)) || null; }
function pickFiles() {
  return new Promise((done) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.addEventListener('change', () => done([...(input.files || [])]), { once: true });
    input.addEventListener('cancel', () => done([]), { once: true });
    input.click();
  });
}

// `meta` (kind 'board', source, from, note, strokes…) goes onto the try as
// it is. A board frame is a plan, so it never becomes the picked still.
function withPicture(sh, ids, meta = null) {
  let fields;
  if (meta && Object.keys(meta).length) {
    const f = sh.fields || {};
    fields = { ...f, tries: [...(f.tries || []), { id: `tr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, at: Date.now(), by: 'me', still: f.still || '', video: f.video || '', ...meta, files: [...ids] }] };
  } else fields = withRenders(sh.fields || {}, ids);
  // A board frame is a plan: it becomes the picked board frame (star.board),
  // never the still the video starts on.
  const slot = meta?.kind === 'board' ? 'board' : 'still';
  // Drawn on from the picked sketch (Keep drawing, Draw over it): the new
  // one is the pick now.
  const fromPicked = meta?.from && fields.star?.[slot] && (fields.tries || []).some((t) => t.id === meta.from && (t.files || []).includes(fields.star[slot]));
  if ((!fields.star?.[slot] || fromPicked) && ids.length) fields.star = { ...(fields.star || {}), [slot]: ids[0] };
  const next = { ...sh, fields, updated_at: Date.now() };
  delete next._by;
  return next;
}

// Pictures on one shot. Returns { added, skipped, undo }.
export async function picturesOnShot(shotId, files, meta = null) {
  const before = await getEntry(shotId);
  if (!before) return { added: 0, skipped: files.length, undo: async () => {} };
  const ids = [];
  for (const f of files) { const id = await keep(f, shotId); if (id) ids.push(id); }
  if (ids.length) await putEntries([withPicture(await getEntry(shotId), ids, meta)]);
  return {
    added: ids.length,
    skipped: files.length - ids.length,
    undo: async () => { await putEntries([{ ...before, updated_at: Date.now() }]); }
  };
}

// Pictures on a scene: shots without a picture first, in order, then new shots.
// Returns { filled, made, skipped, rows, undo }.
export async function picturesOnScene(sceneId, files, { pieceId = null, meta = null } = {}) {
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
    await putEntries([withPicture(fresh, [id], meta)]);
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

// Words to paste into an image model by hand (Gemini, ChatGPT) beside the
// sketch: the look, the shot, the lines it covers, who and where.
export async function framePrompt({ style = '', scene = '', heading = '', code = '', what = '', framing = '', lines = [], worldId = null }) {
  const all = (await byKind('page')).filter((p) => !p.deleted);
  const byId = new Map(all.map((p) => [p.id, p]));
  // Only this film's world: a page's parents lead up to it.
  const inWorld = (p) => { for (let at = p, n = 0; at && n < 20; at = byId.get(at.parent_id), n += 1) if (at.parent_id === worldId) return true; return false; };
  const pages = all.filter((p) => p.fields?.element && (!worldId || inWorld(p)));
  const named = (name) => pages.find((p) => p.fields.element.type === 'character' && [p.title, ...(p.fields.element.also || [])].some((n) => (n || '').trim().toUpperCase() === name));
  const who = [];
  for (const l of lines) {
    if (l.el !== 'character') continue;
    const name = l.text.replace(/\(.*?\)/g, '').trim().toUpperCase();
    const p = named(name);
    const line = p ? `${p.title}${p.fields.element.snippet ? `: ${p.fields.element.snippet}` : ''}` : name.charAt(0) + name.slice(1).toLowerCase();
    if (!who.includes(line)) who.push(line);
  }
  const head = (heading || '').toUpperCase();
  const place = pages.find((p) => p.fields.element.type === 'location' && p.title && head.includes(p.title.toUpperCase()));
  const words = lines.filter((l) => l.el !== 'character' && l.text.trim()).map((l) => (l.el === 'dialogue' ? `“${l.text.trim()}”` : l.text.trim()));
  return [
    `One storyboard frame, 16:9. ${style ? `Look: ${style}.` : 'Look: a clean, clear storyboard drawing, not photoreal.'} Keep the layout of my sketch if I give one.`,
    `Scene: ${scene}${heading && heading !== scene ? ` (${heading})` : ''}.`,
    `Shot ${code}: ${what || 'see the lines below'}${framing ? `. Framing: ${framing}` : ''}.`,
    words.length ? `The lines it covers: ${words.join(' ')}` : '',
    who.length ? `Who: ${who.join('; ')}.` : '',
    place ? `Where: ${place.title}${place.fields.element.snippet ? `, ${place.fields.element.snippet}` : ''}${place.fields.element.lighting ? `. Lighting: ${place.fields.element.lighting}` : ''}.` : ''
  ].filter(Boolean).join('\n');
}
