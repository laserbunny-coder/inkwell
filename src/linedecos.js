// Decorations drawn line by line (bullets, boxes, tags, task labels…), kept
// up to date by redoing only the lines a change touched. Rebuilding every
// line's decorations on each key press made typing on a page of a few
// thousand lines lag by seconds (measured Nov 12 2026, tests/perf/longpages.mjs).
import { DecorationSet } from '@tiptap/pm/view';

// Where a transaction changed the page, as one range in the new page, or null.
// Uses each step's whole range, so changing a line's attributes covers
// everything under it too (a checklist's lines depend on it).
export function changedRange(tr) {
  if (!tr.docChanged) return null;
  // One pass: the range so far is carried through each later step.
  let r = null;
  tr.steps.forEach((step, i) => {
    const map = tr.mapping.maps[i];
    const doc = tr.docs[i];
    if (r) r = { from: map.map(r.from, -1), to: map.map(r.to, 1) };
    let a = step.from;
    let b = step.to;
    if (a == null && step.pos != null) { a = step.pos; const n = doc.nodeAt(step.pos); b = a + (n ? n.nodeSize : 1); }
    if (a == null) { a = 0; b = doc.content.size; }
    const own = { from: map.map(a, -1), to: map.map(b, 1) };
    r = r ? { from: Math.min(r.from, own.from), to: Math.max(r.to, own.to) } : own;
  });
  if (!r || r.from > r.to) return null;
  return { from: Math.max(0, r.from), to: Math.min(tr.doc.content.size, r.to) };
}

// Did the transaction bring in whole lines (Enter, paste, moving a line)?
// Typing words doesn't, so checks that look across the whole page can skip it.
export function insertsNodes(tr, type) {
  return tr.steps.some((step) => {
    const slice = step.slice;
    if (!slice?.content.size) return false;
    let found = false;
    slice.content.descendants((n) => { if (found) return false; if (n.type.name === type) found = true; return !found; });
    return found;
  });
}

// The units a change touched: each one overlapping the range, ancestors included.
export function unitsIn(doc, r, isUnit) {
  const out = [];
  doc.nodesBetween(Math.max(0, r.from - 1), Math.min(doc.content.size, r.to + 1), (n, pos) => {
    if (isUnit(n) && pos <= r.to && pos + n.nodeSize >= r.from) out.push([n, pos]);
    return !n.isTextblock;
  });
  return out;
}

const isLine = (n) => n.type.name === 'listItem';
const isBlock = (n) => n.isTextblock;
// Where a unit's own decorations sit: a line's are on the line itself and in
// its first paragraph (not in the lines under it); a paragraph's are inside it.
const ownSpan = (n, pos) => (isLine(n) ? [pos, pos + 1 + (n.firstChild?.nodeSize || 0)] : [pos, pos + n.nodeSize]);

const registry = new Map();

// State for a plugin whose decorations are made unit by unit.
//   unit: 'line' (list items) or 'block' (paragraphs and other text blocks)
//   make(node, pos, state, ctx) → that unit's decorations
//   rebuild(tr) → true when everything must be redrawn (a fold, new task data…)
//   context(state, prevCtx, tr) → anything make needs to know about the page
//     (with full: true when everything must be redrawn after all)
export function lineDecos({ key, unit = 'line', make, rebuild = () => false, context = () => null }) {
  const isUnit = unit === 'line' ? isLine : isBlock;
  const build = (state, ctx) => {
    const decos = [];
    state.doc.descendants((n, pos) => {
      if (!isUnit(n)) return true;
      for (const d of make(n, pos, state, ctx)) decos.push(d);
      return !n.isTextblock;
    });
    return DecorationSet.create(state.doc, decos);
  };
  if (key) registry.set(key.key, { key, build: (state) => build(state, context(state, null, null)) });
  return {
    init(_config, state) { const ctx = context(state, null, null); return { set: build(state, ctx), ctx }; },
    apply(tr, value, _old, state) {
      if (rebuild(tr)) { const ctx = context(state, null, tr); return { set: build(state, ctx), ctx }; }
      if (!tr.docChanged) return value;
      const ctx = context(state, value.ctx, tr);
      // The context can ask for a full redraw (the zoomed-in line's edges moved).
      if (ctx?.full) return { set: build(state, ctx), ctx: { ...ctx, full: false } };
      const doc = tr.doc;
      let set = value.set.map(tr.mapping, doc);
      const r = changedRange(tr);
      if (!r) return { set, ctx };
      const units = unitsIn(doc, r, isUnit);
      const stale = set.find(r.from, r.to);
      for (const [n, pos] of units) {
        const [a, b] = ownSpan(n, pos);
        for (const d of set.find(a, b)) if (d.from >= a && d.from <= b) stale.push(d);
      }
      if (stale.length) set = set.remove(stale);
      const fresh = [];
      for (const [n, pos] of units) for (const d of make(n, pos, state, ctx)) fresh.push(d);
      if (fresh.length) set = set.add(doc, fresh);
      return { set, ctx };
    }
  };
}

// For tests: is every kept decoration set the same as drawing it afresh?
// Returns the names of the ones that differ.
const sig = (set, doc) => set.find(0, doc.content.size)
  .map((d) => `${d.from}-${d.to}-${d.spec.key || ''}-${JSON.stringify(d.type.attrs || '')}`).sort().join('|');
export function checkLineDecos(state) {
  const bad = [];
  for (const { key, build } of registry.values()) {
    const kept = key.getState(state);
    if (!kept) continue;
    if (sig(kept.set, state.doc) !== sig(build(state), state.doc)) bad.push(key.key);
  }
  return bad;
}

// The same over several transactions (appendTransaction gets a list), in the last one's page.
export function changedRangeOf(trs) {
  let r = null;
  for (const tr of trs) {
    if (r) r = { from: tr.mapping.map(r.from, -1), to: tr.mapping.map(r.to, 1) };
    const own = changedRange(tr);
    if (own) r = r ? { from: Math.min(r.from, own.from), to: Math.max(r.to, own.to) } : own;
  }
  return r;
}

// For tests: what differs, for the first set that does (kept-only and fresh-only decorations).
export function diffLineDecos(state) {
  for (const { key, build } of registry.values()) {
    const kept = key.getState(state);
    if (!kept) continue;
    const a = sig(kept.set, state.doc).split('|');
    const b = sig(build(state), state.doc).split('|');
    const onlyKept = a.filter((x) => !b.includes(x));
    const onlyFresh = b.filter((x) => !a.includes(x));
    if (onlyKept.length || onlyFresh.length) return { name: key.key, onlyKept: onlyKept.slice(0, 6), onlyFresh: onlyFresh.slice(0, 6) };
  }
  return null;
}
