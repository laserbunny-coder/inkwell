import { allEntries, byKind, putEntries, getEntry, getMeta, setMeta, snapshots, addSnapshot, allSnapshots, dropSnapshots, labelSnapshot } from './db.js';
import { entry, newId, wordCount } from './model.js';

// The history of a chapter or a page: every version kept as you pause typing
// (on this device), plus a checkpoint at most once an hour that syncs, so the
// other device has the same timeline. History thins itself out as it ages:
// everything from the last two days, one an hour for two weeks, one a day
// after that, forever. Nothing in the text is ever changed by looking back.

const HOUR = 36e5;
const DAY = 24 * HOUR;

// ---------- keeping versions ----------

export async function keep(rootId, doc, text, { force = false, label } = {}) {
  const at = Date.now();
  const words = wordCount(text || '');
  await addSnapshot({ chapter_id: rootId, at, words, doc, ...(label ? { label } : {}) });
  const last = (await getMeta(`checkpoint:${rootId}`)) || 0;
  if (!force && at - last < HOUR) return;
  await setMeta(`checkpoint:${rootId}`, at);
  // Not a child of the chapter or page (those are its text), so it's linked by fields.of.
  await putEntries([entry('version', { id: newId('ve'), title: label || '', fields: { of: rootId, at, words, doc } })]);
}

// Every version of one chapter or page, newest first, from here and the cloud.
// Each says where it is kept (snapId on this device, entryId synced), so it
// can be named later.
export async function versionsOf(rootId) {
  const local = (await snapshots(rootId)).map((s) => ({ at: s.at, words: s.words, doc: s.doc, label: s.label || '', snapId: s.id }));
  const synced = (await byKind('version')).filter((v) => v.fields?.of === rootId && v.fields.doc)
    .map((v) => ({ at: v.fields.at, words: v.fields.words, doc: v.fields.doc, label: v.title || '', synced: true, entryId: v.id }));
  const seen = new Map();
  const out = [];
  for (const v of [...local, ...synced].sort((a, b) => b.at - a.at)) {
    const key = JSON.stringify(v.doc);
    const was = seen.get(key);
    if (was) {
      // The same words kept twice (here and synced): one mark, either name.
      if (v.snapId != null && was.snapId == null) was.snapId = v.snapId;
      if (v.entryId && !was.entryId) was.entryId = v.entryId;
      if (!was.label && v.label) was.label = v.label;
      continue;
    }
    seen.set(key, v);
    out.push(v);
  }
  return out;
}

// Give a kept version a name (or take it away with ''). Named ones are never thinned out.
export async function nameVersion(v, label) {
  if (v.snapId != null) await labelSnapshot(v.snapId, label);
  if (v.entryId) {
    const e = await getEntry(v.entryId);
    if (e) await putEntries([{ ...e, title: label, updated_at: Date.now() }]);
  }
  v.label = label;
}

// How many words changed from one version to the next (added, cut or reworded).
export function changedWords(before, after) {
  let n = 0;
  const count = (t) => (t.match(/\S+/g) || []).length;
  for (const c of compare(before, after)) {
    if (c.op === 'ins' || c.op === 'del') n += count(c.block.text);
    else if (c.op === 'chg') for (const w of c.words) if (w.op !== '=') n += count(w.t);
  }
  return n;
}

// Which of a list of {id, root, at} to let go: within each root, keep all from
// the last two days, the last of each hour for two weeks, the last of each day after.
export function thin(list, now = Date.now()) {
  const drop = [];
  const byRoot = new Map();
  for (const v of list) (byRoot.get(v.root) || byRoot.set(v.root, []).get(v.root)).push(v);
  for (const vs of byRoot.values()) {
    const kept = new Set();
    for (const v of vs.sort((a, b) => b.at - a.at)) {
      const age = now - v.at;
      if (age < 2 * DAY || v.label) continue;
      const d = new Date(v.at);
      const bucket = age < 14 * DAY ? `h${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}` : `d${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (kept.has(bucket)) drop.push(v.id);
      else kept.add(bucket);
    }
  }
  return drop;
}

export async function tidyHistory(now = Date.now()) {
  // Once a day is plenty, and it reads every version, so not on every start.
  const last = (await getMeta('tidiedAt')) || 0;
  if (now - last < 20 * HOUR) return 0;
  await setMeta('tidiedAt', now);
  const snaps = await allSnapshots();
  const localDrop = thin(snaps.map((s) => ({ id: s.id, root: s.chapter_id, at: s.at, label: s.label })), now);
  if (localDrop.length) await dropSnapshots(localDrop);
  const versions = (await byKind('version')).filter((v) => v.fields?.doc);
  const gone = new Set(thin(versions.map((v) => ({ id: v.id, root: v.fields.of, at: v.fields.at, label: v.title })), now));
  // Let go of the words too, so the cloud doesn't keep carrying them.
  const rows = versions.filter((v) => gone.has(v.id)).map((v) => ({ ...v, deleted: true, fields: { of: v.fields.of, at: v.fields.at }, updated_at: now }));
  if (rows.length) await putEntries(rows);
  return localDrop.length + rows.length;
}

// ---------- comparing two versions ----------

const textOf = (n) => (n.text || '') + (n.content || []).map(textOf).join('');

// The blocks of a document in reading order: paragraphs of a chapter, or the
// lines of a page (with how deep each sits).
export function blocks(doc) {
  const out = [];
  const walk = (nodes, depth) => {
    for (const n of nodes || []) {
      if (n.type === 'listItem') {
        const para = (n.content || []).find((c) => c.type === 'paragraph');
        out.push({ eid: n.attrs?.eid, depth, text: para ? textOf(para) : '', node: n, line: true });
        for (const c of n.content || []) if (c.type === 'bulletList') walk(c.content, depth + 1);
      } else if (n.type === 'bulletList') walk(n.content, depth);
      else if (n.type === 'sceneBreak') out.push({ eid: n.attrs?.eid, depth: 0, text: n.attrs?.title || '', node: n, scene: true });
      else out.push({ eid: n.attrs?.eid, depth: 0, text: textOf(n), node: n });
    }
  };
  walk(doc?.content, 0);
  return out;
}

// What changed from `then` to `now`, block by block: same, changed (with the
// words that changed), removed (only in `then`) and added (only in `now`).
export function compare(then, now) {
  const a = blocks(then);
  const b = blocks(now);
  const inB = new Map(b.map((x) => [x.eid, x]));
  const inA = new Map(a.map((x, k) => [x.eid, k]));
  const out = [];
  let i = 0;
  const flushRemoved = (upTo) => {
    for (; i < upTo; i++) if (!inB.has(a[i].eid) || !a[i].eid) out.push({ op: 'del', block: a[i], after: lastKept() });
  };
  const lastKept = () => { for (let k = out.length - 1; k >= 0; k--) if (out[k].op !== 'del') return out[k].block.eid; return null; };
  for (const x of b) {
    const k = x.eid ? inA.get(x.eid) : undefined;
    const old = k === undefined ? null : a[k];
    if (old) {
      flushRemoved(k);
      if (i <= k) i = k + 1;
      out.push(old.text === x.text ? { op: 'same', block: x } : { op: 'chg', block: x, old, words: words(old.text, x.text) });
    } else out.push({ op: 'ins', block: x });
  }
  flushRemoved(a.length);
  return out;
}

// Word-level differences inside one paragraph: [{ t, op: '=' | '-' | '+' }].
export function words(x, y) {
  const A = x.split(/(\s+)/).filter(Boolean);
  const B = y.split(/(\s+)/).filter(Boolean);
  if (A.length * B.length > 250000) return [{ t: x, op: '-' }, { t: y, op: '+' }];
  const L = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  const push = (t, op) => { const last = out[out.length - 1]; if (last && last.op === op) last.t += t; else out.push({ t, op }); };
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { push(A[i], '='); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) push(A[i++], '-'); else push(B[j++], '+');
  }
  while (i < A.length) push(A[i++], '-');
  while (j < B.length) push(B[j++], '+');
  return out;
}

// ---------- putting a paragraph or line back into today's page ----------

// Every node with an id in a document, with the list it sits in and its place there.
function index(doc) {
  const at = new Map();
  const walk = (list, owner) => {
    list.forEach((n, i) => {
      if (n.attrs?.eid && (n.type === 'listItem' || !owner || owner.type !== 'listItem')) at.set(n.attrs.eid, { node: n, list, i, owner });
      if (n.content) walk(n.content, n.type === 'bulletList' ? owner : n);
    });
  };
  walk(doc.content || [], null);
  return at;
}

// Today's page with one block of an old version back in it: reworded back
// if it's still there, or put back where it used to sit if it was cut (an
// outline line with the lines under it, leaving out any that are still in
// today's page somewhere).
export function withBlockBack(nowDoc, oldDoc, eid) {
  const doc = structuredClone(nowDoc);
  const now = index(doc);
  const old = index(oldDoc);
  const was = old.get(eid);
  if (!was) return null;
  const here = now.get(eid);
  if (here) {
    if (here.node.type === 'listItem') {
      const para = (was.node.content || []).find((c) => c.type === 'paragraph');
      const k = (here.node.content || []).findIndex((c) => c.type === 'paragraph');
      if (para && k >= 0) here.node.content[k] = structuredClone(para);
    } else here.list[here.i] = structuredClone(was.node);
    return doc;
  }
  const prune = (n) => {
    const c = structuredClone(n);
    const strip = (x) => {
      if (!x.content) return x;
      x.content = x.content.filter((k) => !(k.type === 'listItem' && k.attrs?.eid && now.has(k.attrs.eid))).map(strip);
      x.content = x.content.filter((k) => !(k.type === 'bulletList' && !(k.content || []).length));
      return x;
    };
    return strip(c);
  };
  const node = prune(was.node);
  // After the nearest earlier neighbour that's still there.
  for (let k = was.i - 1; k >= 0; k--) {
    const prev = was.list[k].attrs?.eid && now.get(was.list[k].attrs.eid);
    if (prev) { prev.list.splice(prev.i + 1, 0, node); return doc; }
  }
  // First under its parent line, if that's still there.
  const parentId = was.owner?.type === 'listItem' ? was.owner.attrs?.eid : null;
  const parent = parentId && now.get(parentId);
  if (parent) {
    const kids = parent.node.content || (parent.node.content = []);
    let list = kids.find((c) => c.type === 'bulletList');
    if (!list) { list = { type: 'bulletList', content: [] }; kids.push(list); }
    list.content.unshift(node);
    return doc;
  }
  // Else after whatever came before it in reading order, or at the very top.
  const order = blocks(oldDoc).map((b) => b.eid);
  for (let k = order.indexOf(eid) - 1; k >= 0; k--) {
    const prev = now.get(order[k]);
    if (prev) { prev.list.splice(prev.i + 1, 0, node); return doc; }
  }
  if (node.type === 'listItem') {
    const top = (doc.content || []).find((c) => c.type === 'bulletList');
    if (top) { top.content.unshift(node); return doc; }
    doc.content = [{ type: 'bulletList', content: [node] }, ...(doc.content || [])];
    return doc;
  }
  doc.content = [node, ...(doc.content || [])];
  return doc;
}

// ---------- things deleted from a chapter or page ----------

// Paragraphs or lines deleted from it that still have words, newest first.
// (Deleted entries are kept for six months, so this reaches back that far.)
export async function deletedFrom(root) {
  const rows = await allEntries();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const homeOf = (r) => { let p = r; for (let n = 0; p && n < 60 && p.id !== root.id; n++) p = byId.get(p.parent_id); return p; };
  const kinds = root.kind === 'chapter' ? ['para', 'heading'] : ['line'];
  return rows.filter((r) => r.deleted && kinds.includes(r.kind) && (r.text || '').trim() && !r.fields?.mirror && homeOf(r)?.id === root.id)
    .sort((a, b) => b.updated_at - a.updated_at);
}

// Puts a deleted paragraph or line back where it was. A line whose parent
// line is gone too comes back at the top level of the page.
export async function bringBack(row, root) {
  const now = Date.now();
  const fresh = await getEntry(row.id);
  if (!fresh) return;
  let parent = fresh.parent_id;
  if (fresh.kind === 'line' && parent !== root.id) {
    const p = await getEntry(parent);
    if (!p || p.deleted) parent = root.id;
  }
  await putEntries([{ ...fresh, parent_id: parent, deleted: false, updated_at: now }]);
}
