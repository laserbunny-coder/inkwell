// One Ideas list, one Bible, each thing knowing its piece (One home Part 3,
// Nov 2026). No tags: the link a line carries, or the piece a page sits in,
// already says which piece it is for. A project with one piece shows none of
// this; everything is the project's.
import { getEntry } from './db.js';
import { worldTree, stats } from './library.js';
import { isLife } from './pages.js';
import { refsIn } from './outline.js';

// Which piece each thing in a project belongs to: the pieces themselves, their
// acts and chapters, and the pages made inside them.
export async function pieceIndex(world) {
  const { pieces, piecePages } = await worldTree(world.id);
  const list = pieces.map(({ row, depth }) => ({ id: row.id, title: row.title || 'Untitled', depth, row }));
  const owner = new Map();
  for (const { row } of pieces) {
    owner.set(row.id, row.id);
    const s = await stats(row);
    for (const a of s.acts) { owner.set(a.id, row.id); for (const c of a.chapters) owner.set(c.id, row.id); }
  }
  for (const { row } of piecePages) {
    let r = row;
    for (let i = 0; r && i < 30 && !owner.has(r.id); i++) r = r.parent_id ? await getEntry(r.parent_id) : null;
    if (r && owner.has(r.id)) owner.set(row.id, owner.get(r.id));
  }
  const name = new Map(list.map((p) => [p.id, p.title]));
  return {
    world,
    pieces: list,
    // Chips and names only when there is more than one piece to tell apart.
    many: !isLife(world) && list.length > 1,
    owner,
    name: (id) => name.get(id) || '',
    // A line is for one piece when everything it ties to here is that piece.
    ofLine(row) {
      const ids = [...(row.links || []), ...(row.fields?.pulled || [])];
      const set = new Set(ids.map((id) => owner.get(id)).filter(Boolean));
      return set.size === 1 ? [...set][0] : null;
    },
    ofPage(row) { return owner.get(row.id) || null; }
  };
}

// The chip picked on this device (not synced): 'all', 'whole' or a piece id.
const KEY = (wid) => `ip:${wid}`;
export function pickOf(idx) {
  let v = 'all';
  try { v = localStorage.getItem(KEY(idx.world.id)) || 'all'; } catch { /* private window */ }
  if (!idx.many) return 'all';
  return v === 'all' || v === 'whole' || idx.pieces.some((p) => p.id === v) ? v : 'all';
}
export function setPick(worldId, v) {
  try { localStorage.setItem(KEY(worldId), v); } catch { /* private window */ }
}
export const fits = (pick, pid) => pick === 'all' || (pick === 'whole' ? !pid : pid === pick);
export const chipList = (idx) => [{ id: 'all', label: 'Everything' }, { id: 'whole', label: 'Whole project' }, ...idx.pieces.map((p) => ({ id: p.id, label: p.title }))];

// "For…": tie a line to the whole project or to one piece instead. Only the
// link that tied it here changes; the words stay. Returns [changed, undo].
export async function lineFor(row, idx, targetId) {
  const r = await getEntry(row.id);
  if (!r) return [null, null];
  const here = (id) => id === idx.world.id || idx.owner.has(id);
  const target = targetId === idx.world.id ? idx.world : idx.pieces.find((p) => p.id === targetId)?.row;
  if (!target) return [null, null];
  const old = (r.links || []).find(here) || (r.fields?.pulled || []).find(here);
  if (!old || old === target.id) return [null, null];
  let swapped = false;
  const swap = (nodes) => (nodes || []).map((n) => {
    if (!swapped && n.type === 'entryRef' && n.attrs?.id === old) { swapped = true; return { ...n, attrs: { ...n.attrs, id: target.id, title: target.title || 'Untitled' } }; }
    return n.content ? { ...n, content: swap(n.content) } : n;
  });
  const next = { ...r, updated_at: Date.now() };
  if ((r.links || []).includes(old)) {
    next.content = swap(r.content);
    next.links = refsIn(next.content);
    if (!swapped) next.links = [...new Set([...(r.links || []).filter((x) => x !== old), target.id])];
  }
  if ((r.fields?.pulled || []).includes(old)) next.fields = { ...r.fields, pulled: [...new Set(r.fields.pulled.map((x) => (x === old ? target.id : x)))] };
  return [next, { ...r }];
}
