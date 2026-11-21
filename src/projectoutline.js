// A project's home as one outline (Nov 2026): its parts (Ideas, Bible,
// Pieces, Make, Deliver, About) are lines. ▸ opens a line in place; its name
// zooms into it. What's open is kept per project, per device.
import { make } from './dom.js';
import { getEntry, putEntries } from './db.js';
import { inOrder, mergeOrder } from './deskdrag.js';
import { stageOf, stagesOf, nextLabel, kindName } from './library.js';

const KEY = (worldId) => `wo:${worldId}`;
export function openParts(worldId) {
  try { return new Set(JSON.parse(localStorage.getItem(KEY(worldId)) || '[]')); } catch { return new Set(); }
}
export function setPartOpen(worldId, id, on) {
  const open = openParts(worldId);
  if (on) open.add(id); else open.delete(id);
  try { localStorage.setItem(KEY(worldId), JSON.stringify([...open])); } catch { /* full */ }
  return open;
}

// A piece's stage as dots: one per stage, filled up to where it is.
export function stageDots(p, w) {
  const list = stagesOf(p, w);
  const at = list.indexOf(stageOf(p, w));
  const el = make('span', 'wo-dots');
  el.setAttribute('aria-hidden', 'true');
  list.forEach((_, i) => el.append(make('i', i <= at ? 'on' : '')));
  return el;
}

// One piece as an outline line: its name (opens it), its stage (dots and
// word, a click picks another) and a quiet "→ next stage".
// h: { open(p), stage(p, stage, opts), menu(p) → items, pop(anchor, items), button(fn, label),
//      and for One home: fold(p) → ▸, kids(p) → its scenes (or null), name(p), words(p), noKind }
export function pieceLine(p, depth, w, h) {
  const li = make('li', 'wo-piece');
  li.dataset.id = p.id;
  if (depth) li.style.setProperty('--depth', depth);
  // A piece with a text opens in place: ▸ shows its scenes (One home).
  const fold = h.fold?.(p);
  if (fold) li.append(fold);
  const name = make('button', 'wo-item', h.name ? h.name(p) : p.title || 'Untitled');
  name.type = 'button';
  name.addEventListener('click', () => h.open(p));
  const list = stagesOf(p, w);
  const st = make('button', 'wo-stage');
  st.type = 'button';
  st.title = 'Stage: click to pick another';
  st.append(stageDots(p, w), make('span', 'wo-stage-w', stageOf(p, w)));
  st.addEventListener('click', () => h.pop(st, list.map((x) => ({ label: x, current: stageOf(p, w) === x, run: () => h.stage(p, x) }))));
  li.append(name, ...(h.noKind ? [] : [make('span', 'wo-kind', kindName(p))]), st);
  const next = nextLabel(list, stageOf(p, w));
  if (next) {
    // It says what starts (One home): "→ Start boarding".
    const b = make('button', 'wo-next', `→ ${next}`);
    b.type = 'button';
    b.title = `Move it on to ${list[list.indexOf(stageOf(p, w)) + 1]}`;
    b.addEventListener('click', () => h.stage(p, list[list.indexOf(stageOf(p, w)) + 1], { door: true }));
    li.append(b);
  }
  const words = h.words?.(p);
  if (words) li.append(words);
  if (h.button) li.append(h.button(() => h.menu(p), `More for ${p.title || 'this piece'}`));
  if (h.kids) { const k = h.kids(p); if (k) li.append(k); }
  return li;
}

// Ideas in your own order (Nov 19 2026): newest first until you move one; new
// ones still come in at the top, so nothing new is tucked out of sight. The
// order is kept on the project (fields.ideaOrder), so it's the same on every device.
export function inIdeaOrder(w, items) {
  return inOrder(items, (x) => x.row.id, w.fields?.ideaOrder);
}
export async function setIdeaOrder(worldId, keys) {
  const w = await getEntry(worldId);
  if (!w) return [];
  const row = { ...w, fields: { ...w.fields, ideaOrder: mergeOrder(keys, w.fields?.ideaOrder || []).slice(0, 400) }, updated_at: Date.now() };
  await putEntries([row]);
  return [row];
}
// One idea a step up, down or to the top, in the list as it's shown.
export function stepKeys(keys, key, how) {
  const i = keys.indexOf(key);
  const j = how === 'top' ? 0 : i + how;
  if (i < 0 || j < 0 || j >= keys.length || i === j) return null;
  const out = keys.slice();
  out.splice(i, 1);
  out.splice(j, 0, key);
  return out;
}
