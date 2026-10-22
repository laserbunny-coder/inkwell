import { allEntries, byKind, putEntries, getEntry, getMeta, setMeta, snapshots, addSnapshot, allSnapshots, dropSnapshots } from './db.js';
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
export async function versionsOf(rootId) {
  const local = (await snapshots(rootId)).map((s) => ({ at: s.at, words: s.words, doc: s.doc, label: s.label || '' }));
  const synced = (await byKind('version')).filter((v) => v.fields?.of === rootId && v.fields.doc)
    .map((v) => ({ at: v.fields.at, words: v.fields.words, doc: v.fields.doc, label: v.title || '', synced: true }));
  const seen = new Set();
  const out = [];
  for (const v of [...local, ...synced].sort((a, b) => b.at - a.at)) {
    const key = JSON.stringify(v.doc);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
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
