import { getEntry, children, putEntries, byKind } from './db.js';
import { entry } from './model.js';
import { placeSorts } from './order.js';
import { descendants } from './outline.js';

// Moving writing between places: a manuscript paragraph to another chapter or
// onto a page or day, a notebook line (with everything under it) into a
// chapter or onto another page. It's the same entry that moves, so its id,
// its links, the notes beside it and "Linked from" all come along. Only the
// kind changes when it crosses over: a paragraph on a page becomes a line,
// and lines in a chapter become paragraphs (nested lines are laid out in
// order as the paragraphs that follow).
//
// The app tells this module which chapter and page are open, so an open
// editor never saves the old copy back over the move.

let hooks = { open: () => [], refresh: async () => {} };
export function setMoveHooks(h) { hooks = { ...hooks, ...h }; }

const ROOTS = ['chapter', 'page', 'day'];
const TEXT = ['para', 'heading', 'scene', 'line'];

async function rootOf(row) {
  let r = row;
  for (let i = 0; r && i < 60 && !ROOTS.includes(r.kind); i++) r = r.parent_id ? await getEntry(r.parent_id) : null;
  return r && ROOTS.includes(r.kind) ? r : null;
}

// Takes the entry out of an open editor and saves that, so the editor and
// the stored copy agree it's gone before it's put somewhere else.
async function takeOutOfEditor(open, eid) {
  const ed = open.editor;
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (pos < 0 && n.attrs?.eid === eid && (n.type.name === 'listItem' || n.isBlock)) pos = p;
    return pos < 0;
  });
  if (pos < 0) return;
  const node = ed.state.doc.nodeAt(pos);
  const $pos = ed.state.doc.resolve(pos);
  const tr = ed.state.tr;
  // A page or chapter always keeps one empty line or paragraph.
  if ($pos.parent.childCount === 1 && $pos.depth <= 1) {
    const s = ed.schema.nodes;
    const blank = node.type.name === 'listItem' ? s.listItem.create(null, s.paragraph.create()) : s.paragraph.create();
    tr.replaceWith(pos, pos + node.nodeSize, blank);
  } else tr.delete(pos, pos + node.nodeSize);
  ed.view.dispatch(tr);
  await open.store.flush(ed.state.doc);
}

// What the moved entries become under the target, in order.
function convert(top, under, target) {
  const toChapter = target.kind === 'chapter';
  const base = (r) => ({ ...r, parent_id: target.id, deleted: false });
  if (!toChapter) {
    // Onto a page or day: one line (anything under a line stays under it).
    if (top.kind === 'line') return { tops: [base(top)], rest: under.map((r) => ({ ...r, deleted: false })) };
    const text = top.kind === 'scene' ? top.title || '' : top.text || '';
    const content = top.kind === 'scene' ? (text ? [{ type: 'text', text }] : null) : top.content;
    const { level: _l, el: _e, ...fields } = top.fields || {};
    return { tops: [{ ...base(top), kind: 'line', title: '', text, content, fields }], rest: [] };
  }
  // Into a chapter: paragraphs, the nested lines laid out after their parent.
  if (top.kind !== 'line') return { tops: [{ ...base(top) }], rest: [] };
  const byParent = new Map();
  for (const r of under) (byParent.get(r.parent_id) || byParent.set(r.parent_id, []).get(r.parent_id)).push(r);
  const flat = [];
  const walk = (r) => {
    flat.push(r);
    for (const c of (byParent.get(r.id) || []).sort((a, b) => a.sort - b.sort)) walk(c);
  };
  walk(top);
  return { tops: flat.map((r) => ({ ...base(r), kind: 'para' })), rest: [] };
}

// Moves one paragraph or line (and what's under a line) to the chapter, page
// or day `targetId`, after the sibling `after` (or at the end). `fallback` is
// the entry to create if the target is a day not written on yet.
export async function moveEntry(eid, targetId, opts = {}) {
  return !!(await place(eid, targetId, opts));
}

// Moves several, keeping their order: the first goes where asked, each next
// one right after the one before. Returns how many moved.
export async function moveEntries(eids, targetId, opts = {}) {
  let after = opts.after || null;
  let moved = 0;
  for (const eid of eids) {
    const ids = await place(eid, targetId, { ...opts, after });
    if (ids) { moved += 1; after = ids[ids.length - 1]; }
  }
  return moved;
}

// Does the move; returns the ids now sitting directly in the target, in order.
async function place(eid, targetId, { after = null, fallback = null } = {}) {
  // Save any typing first, so what moves is what's on screen (and a line
  // written a moment ago exists to be moved).
  for (const o of hooks.open()) if (o.rootId && !o.store.idle) await o.store.flush(o.editor.state.doc);
  const first = await getEntry(eid);
  if (!first || first.deleted || !TEXT.includes(first.kind)) return null;
  let target = await getEntry(targetId);
  if (!target && targetId?.startsWith('day-')) target = fallback || entry('day', { id: targetId, title: targetId.slice(4) });
  if (!target || target.deleted || !ROOTS.includes(target.kind)) return null;
  // A gathered mirror only makes sense on a page.
  if (first.fields?.mirror && target.kind === 'chapter') return null;
  const from = await rootOf(first);
  if (from?.id === target.id) return null;

  const open = from && hooks.open().find((o) => o.rootId === from.id);
  const top = await getEntry(eid);
  const under = top.kind === 'line' ? await descendants(eid) : [];
  if (open) await takeOutOfEditor(open, eid);
  const { tops, rest } = convert(top, under, target);
  const moving = new Set(tops.map((r) => r.id));

  // Fit them in among what's there, renumbering only if there's no room.
  const there = (await children(target.id)).filter((r) => TEXT.includes(r.kind) && !moving.has(r.id));
  const at = after ? there.findIndex((r) => r.id === after) + 1 || there.length : there.length;
  const order = [...there.slice(0, at), ...tops, ...there.slice(at)];
  const sorts = placeSorts(order.map((r) => (moving.has(r.id) ? undefined : r.sort)));
  const now = Date.now();
  const rows = [];
  order.forEach((r, i) => {
    if (moving.has(r.id) || r.sort !== sorts[i]) rows.push({ ...r, sort: sorts[i], updated_at: now });
  });
  rows.push(...rest.map((r) => ({ ...r, updated_at: now })));
  if (!(await getEntry(target.id))) rows.push({ ...target, updated_at: now });
  // Notes beside a paragraph follow it to its new chapter.
  if (target.kind === 'chapter') {
    for (const n of (await byKind('note')).filter((x) => moving.has(x.parent_id) && x.fields?.chapter_id !== target.id)) {
      rows.push({ ...n, fields: { ...n.fields, chapter_id: target.id }, updated_at: now });
    }
  }
  await putEntries(rows);
  await hooks.refresh(rows);
  return tops.map((r) => r.id);
}
