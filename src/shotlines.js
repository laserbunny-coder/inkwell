// Shots on the lines they cover (Nov 22 2026, script beside shots Part 2):
// the "lined script" film crews use. A shot keeps the first and last
// paragraph it covers by entry id (fields.from, fields.to); its parent stays
// the scene heading, so everything that reads shots by scene still works.
//
// Plain helpers, no editor: a scene is its paragraphs in order, each
// { id, el, text } (the heading itself not included).

// A name and what's said under it count as one line of the script.
const SPEECH = ['dialogue', 'paren'];
const elOf = (p) => p?.el || 'action';

// Where each line starts: every paragraph with words that isn't speech
// under a name.
export function lineStarts(paras) {
  const out = [];
  paras.forEach((p, i) => { if ((p.text || '').trim() && !SPEECH.includes(elOf(p))) out.push(i); });
  return out;
}

// A pick that lands on speech reaches back to its name; one that ends on a
// name (or its parenthetical) reaches forward through what's said.
export function snap(paras, from, to) {
  let a = Math.max(0, Math.min(from, to));
  let b = Math.min(paras.length - 1, Math.max(from, to));
  while (a > 0 && SPEECH.includes(elOf(paras[a]))) a--;
  while (b < paras.length - 1 && SPEECH.includes(elOf(paras[b + 1])) && ['character', ...SPEECH].includes(elOf(paras[b]))) b++;
  return { from: a, to: b };
}

// Where a shot is in its scene now: the indexes of its first and last line,
// or null when it isn't on any lines (never set, or its lines were deleted
// or moved to another scene: it then waits at its scene, never lost).
export function resolve(shot, paras) {
  const f = shot?.fields || {};
  if (!f.from && !f.to) return null;
  const at = (id) => (id ? paras.findIndex((p) => p.id === id) : -1);
  let a = at(f.from);
  let b = at(f.to);
  if (a < 0 && b < 0) return null;
  if (a < 0) a = b;
  if (b < 0) b = a;
  return snap(paras, Math.min(a, b), Math.max(a, b));
}

// How many lines a stretch covers (at least one).
export const linesIn = (paras, from, to) => Math.max(1, lineStarts(paras).filter((i) => i >= from && i <= to).length);

// Shots in the order they sit: those on no lines first (at the scene line),
// then by their first line, then as Make orders them.
export function inOrder(shots, paras) {
  const at = new Map(shots.map((s) => [s.id, resolve(s, paras)]));
  return [...shots].sort((x, y) => ((at.get(x.id)?.from ?? -1) - (at.get(y.id)?.from ?? -1)) || (x.sort - y.sort));
}

// The shots that cover line i.
export function covering(shots, paras, i) {
  return shots.filter((s) => { const r = resolve(s, paras); return r && r.from <= i && i <= r.to; });
}

// The lines no shot covers yet (indexes of where each starts). The stage
// path can count these too.
export function bareLines(shots, paras) {
  const spans = shots.map((s) => resolve(s, paras)).filter(Boolean);
  return lineStarts(paras).filter((i) => !spans.some((r) => r.from <= i && i <= r.to));
}
export const bareCount = (shots, paras) => bareLines(shots, paras).length;

// The tramline lanes: a shot takes the first lane free at its first line, so
// two shots on the same lines sit side by side.
export function lanes(shots, paras) {
  const ends = [];
  const out = new Map();
  for (const s of inOrder(shots, paras)) {
    const r = resolve(s, paras);
    if (!r) continue;
    let lane = ends.findIndex((e) => e < r.from);
    if (lane < 0) lane = ends.length;
    ends[lane] = r.to;
    out.set(s.id, lane);
  }
  return out;
}

// Where a new shot goes among the others (its index for shotNumber, and
// Make's sort between its neighbours), so one put between 3 and 4 is 3A.
export function placeAmong(shots, paras, from) {
  const list = inOrder(shots, paras);
  const at = from == null ? list.length : list.filter((s) => { const r = resolve(s, paras); return !r || r.from <= from; }).length;
  const prev = list[at - 1];
  const next = list[at];
  const sort = prev && next ? (prev.sort + next.sort) / 2 : prev ? prev.sort + 1024 : next ? next.sort - 1024 : 1024;
  // shotNumber reads the numbers in Make's order; find where `sort` falls there.
  const bySort = [...shots].sort((x, y) => x.sort - y.sort);
  const index = bySort.filter((s) => s.sort < sort).length;
  return { sort, index, numbers: bySort.map((s) => s.fields?.n || null) };
}
