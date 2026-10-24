import { children, getEntry, putEntries } from './db.js';
import { entry, newId, wordCount, outline } from './model.js';
import { versionsOf, blocks as docBlocks, words as wordDiff } from './history.js';

// Revising: a piece read as plain blocks (for comparing, printing and
// sharing), drafts kept whole when you start again from scratch, and two
// versions lined up paragraph by paragraph.

// ---------- a piece as blocks ----------

// The words of a paragraph's content, with bold and italic kept as runs:
// [[text, 'b' | 'i' | 'bi' | '']]. Links read as their titles; pictures are left out.
export function runsOf(content) {
  const out = [];
  const push = (t, f) => { if (!t) return; const last = out[out.length - 1]; if (last && last[1] === f) last[0] += t; else out.push([t, f]); };
  for (const n of content || []) {
    if (n.type === 'text') {
      const marks = (n.marks || []).map((m) => m.type);
      push(n.text || '', `${marks.includes('bold') ? 'b' : ''}${marks.includes('italic') ? 'i' : ''}`);
    } else if (n.type === 'hardBreak') push('\n', '');
    else if (n.type === 'entryRef') push(n.attrs?.title || '', '');
  }
  return out;
}

const textOfRuns = (runs) => runs.map((r) => r[0]).join('');

// One row of a chapter (para, heading or scene) as a block.
export function blockOf(r) {
  if (r.kind === 'scene') return { eid: r.id, kind: 'scene', level: r.fields?.level || 1, text: r.title || '', runs: r.title ? [[r.title, '']] : [] };
  const runs = runsOf(r.content);
  const said = r.fields?.voice && r.fields?.versions?.[1] ? runsOf(r.fields.versions[1]) : null;
  return {
    eid: r.id, kind: r.kind === 'heading' ? 'heading' : 'para', el: r.fields?.el || null, level: r.fields?.level || null,
    code: r.fields?.code || null, by: r.fields?.edited_by || r.fields?.by || null, text: textOfRuns(runs) || r.text || '', runs, ...(said ? { said } : {})
  };
}

// The same from a kept version's document (history), so a date can be compared too.
function blockFromNode(b) {
  const n = b.node;
  if (b.scene) return { eid: b.eid, kind: 'scene', level: n.attrs?.level || 1, text: b.text, runs: b.text ? [[b.text, '']] : [] };
  return { eid: b.eid, kind: n.type === 'heading' ? 'heading' : 'para', el: n.attrs?.el || null, code: n.attrs?.code || null, text: b.text, runs: runsOf(n.content) };
}

// Acts and their chapters under a piece (or a kept draft), in order.
export async function chaptersUnder(ownerId) {
  const out = [];
  for (const act of await outline(ownerId)) for (const ch of act.chapters) out.push({ id: ch.id, title: ch.title || 'Untitled', act: act.title || '', row: ch });
  return out;
}

// A piece (or a draft of it) as chapters of blocks.
export async function pieceDoc(ownerId) {
  const chapters = [];
  for (const ch of await chaptersUnder(ownerId)) chapters.push({ ...ch, blocks: (await children(ch.id)).map(blockOf) });
  return chapters;
}

// A bible page as blocks: its lines, nested.
export async function pageDoc(page) {
  const blocks = [];
  const walk = async (parentId, depth) => {
    for (const r of await children(parentId)) {
      if (r.kind !== 'line') continue;
      if (!r.fields?.mirror || r.text) blocks.push({ eid: r.id, kind: 'line', depth, done: !!r.fields?.done, text: r.text || '', runs: runsOf(r.content) });
      await walk(r.id, depth + 1);
    }
  };
  await walk(page.id, 0);
  return [{ id: page.id, title: page.title || 'Untitled page', act: '', blocks }];
}

// ---------- drafts ----------

// Earlier drafts of a piece, kept whole: entries of kind 'draft' under it,
// each holding the acts it had. Oldest first.
export async function draftsOf(pieceId) {
  return (await children(pieceId)).filter((r) => r.kind === 'draft').sort((a, b) => (a.fields?.n || 0) - (b.fields?.n || 0));
}

// Which draft a chapter belongs to, if it's in a kept one rather than the piece.
export async function draftHolding(chapter) {
  const act = chapter?.parent_id ? await getEntry(chapter.parent_id) : null;
  const up = act?.parent_id ? await getEntry(act.parent_id) : null;
  return up?.kind === 'draft' ? up : null;
}

// Start the piece again from scratch: what's there now is kept whole as a
// draft (its acts move under it, so every paragraph, note, shot and link stays
// with the words it was about), and the piece gets the same acts and chapters
// back, empty. Returns the kept draft and the new first chapter.
//
// With copy, you carry on from the words as they are: a copy of them is kept
// as the draft, and the text you go on writing keeps its notes, shots and
// comments (nothing moves).
export async function startDraft(piece, { script = false, copy = false } = {}) {
  if (copy) return keepCopy(piece);
  const now = Date.now();
  const kept = await draftsOf(piece.id);
  const n = Math.max(piece.fields?.draft ? piece.fields.draft : 1, ...kept.map((d) => (d.fields?.n || 0) + 1));
  const acts = (await children(piece.id)).filter((r) => r.kind === 'act');
  let words = 0;
  const rows = [];
  const draft = entry('draft', { id: newId('dr'), parent_id: piece.id, title: `Draft ${n}`, sort: n, fields: { n, at: now } });
  let first = null;
  for (const act of acts) {
    const chs = await children(act.id);
    words += chs.reduce((s, c) => s + (c.fields?.words || 0), 0);
    rows.push({ ...act, parent_id: draft.id, updated_at: now });
    const fresh = entry('act', { parent_id: piece.id, title: act.title, sort: act.sort });
    rows.push(fresh);
    for (const ch of chs) {
      if (ch.kind !== 'chapter') continue;
      const c = entry('chapter', { parent_id: fresh.id, title: ch.title, sort: ch.sort, fields: { words: 0 } });
      rows.push(c);
      if (!first) first = c;
      if (!script) continue;
      // A script keeps its sections (acts, sequences…) to write into, and
      // opens on a scene heading under the first, as a new one does.
      const sections = (await children(ch.id)).filter((r) => r.kind === 'scene' && (r.title || '').trim()).sort((x, y) => x.sort - y.sort);
      for (const sec of sections) rows.push(entry('scene', { parent_id: c.id, title: sec.title, sort: sec.sort, fields: { ...(sec.fields?.level ? { level: sec.fields.level } : {}), ...(sec.fields?.synopsis ? { synopsis: sec.fields.synopsis } : {}) } }));
      const at = sections.length && sections[0].sort < 1024 ? (sections[0].sort + Math.min(1024, sections[1]?.sort ?? Infinity)) / 2 : 1024;
      rows.push(entry('para', { id: newId('pa'), parent_id: c.id, sort: at, fields: { el: 'scene' } }));
    }
  }
  if (!first) {
    const act = entry('act', { parent_id: piece.id, title: script ? 'Screenplay' : 'Act One', sort: 1 });
    first = entry('chapter', { parent_id: act.id, title: script ? 'Script' : 'Chapter 1', sort: 1 });
    rows.push(act, first);
  }
  draft.fields.words = words;
  rows.unshift(draft);
  rows.push({ ...piece, fields: { ...piece.fields, draft: n + 1 }, updated_at: now });
  await putEntries(rows);
  return { draft, first };
}

// ---------- what to compare ----------

// A side of the compare view: now, a kept draft, the text as it was at a
// time (from history), or now with walk-and-talk paragraphs as you said them.
export function sourceLabel(src, drafts = []) {
  if (!src || src.type === 'now') return 'Now';
  if (src.type === 'draft') return drafts.find((d) => d.id === src.id)?.title || 'An earlier draft';
  if (src.type === 'said') return 'As you said it';
  if (src.type === 'at') return `As of ${new Date(src.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(new Date(src.at).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })}`;
  return '';
}

export async function sideDoc(pieceId, src) {
  if (!src || src.type === 'now') return pieceDoc(pieceId);
  if (src.type === 'draft') return pieceDoc(src.id);
  const now = await pieceDoc(pieceId);
  if (src.type === 'said') return now.map((ch) => ({ ...ch, blocks: ch.blocks.map((b) => (b.said ? { ...b, runs: b.said, text: textOfRuns(b.said), by: 'me' } : b)) }));
  // As of a time: each chapter as its last kept version then. A chapter
  // made since isn't there; one never changed since keeps its words now.
  const out = [];
  for (const ch of now) {
    if (ch.row.created_at > src.at) continue;
    const versions = await versionsOf(ch.id);
    const then = versions.find((v) => v.at <= src.at);
    if (then) out.push({ ...ch, blocks: docBlocks(then.doc).map(blockFromNode) });
    else if (!versions.length || versions.at(-1).at > src.at) {
      // Kept versions all come later: the oldest is the closest to then.
      const oldest = versions.at(-1);
      out.push(oldest ? { ...ch, blocks: docBlocks(oldest.doc).map(blockFromNode), approx: true } : ch);
    }
  }
  return out;
}

// ---------- lining two versions up ----------

const norm = (t) => (t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// How alike two paragraphs are, 0 to 1, by the words they share.
export function likeness(x, y) {
  const a = norm(x).split(' ').filter(Boolean);
  const b = norm(y).split(' ').filter(Boolean);
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const count = new Map();
  for (const w of a) count.set(w, (count.get(w) || 0) + 1);
  let both = 0;
  for (const w of b) { const c = count.get(w); if (c) { both++; count.set(w, c - 1); } }
  return (2 * both) / (a.length + b.length);
}

// Chapters of two sides paired up: the same chapter (by id), else the same
// title, else in order.
export function pairChapters(A, B) {
  const pairs = [];
  const usedB = new Set();
  const byId = new Map(B.map((c, i) => [c.id, i]));
  const match = A.map((c) => { const i = byId.get(c.id); if (i !== undefined) { usedB.add(i); return i; } return -1; });
  A.forEach((c, k) => {
    if (match[k] !== -1) return;
    const i = B.findIndex((d, j) => !usedB.has(j) && norm(d.title) === norm(c.title));
    if (i !== -1) { usedB.add(i); match[k] = i; }
  });
  A.forEach((c, k) => {
    if (match[k] !== -1) return;
    const i = B.findIndex((_d, j) => !usedB.has(j));
    if (i !== -1 && A.length === B.length) { usedB.add(i); match[k] = i; }
  });
  // In A's order, with B's unpaired chapters slotted in where they fall.
  const done = new Set();
  let j = 0;
  A.forEach((c, k) => {
    const i = match[k];
    if (i !== -1) {
      for (; j < i; j++) if (!usedB.has(j) && !done.has(j)) { done.add(j); pairs.push({ a: null, b: B[j] }); }
      j = Math.max(j, i + 1);
      done.add(i);
    }
    pairs.push({ a: c, b: i === -1 ? null : B[i] });
  });
  B.forEach((d, i) => { if (!done.has(i) && !usedB.has(i)) pairs.push({ a: null, b: d }); });
  return pairs;
}

// Two lists of blocks lined up: rows of { op: same | chg | del | ins, a, b, words }.
// Matching paragraphs (the same entry, or the same words) anchor the rows;
// between anchors, paragraphs that are mostly alike pair up as changed.
export function alignBlocks(A, B) {
  const same = (x, y) => (x.eid && x.eid === y.eid) || (norm(x.text) === norm(y.text) && x.kind === y.kind && !!norm(x.text));
  const n = A.length;
  const m = B.length;
  const anchors = [];
  if (n * m <= 9e6) {
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = same(A[i], B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (same(A[i], B[j])) { anchors.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
    }
  } else {
    // Very long: match by id only, in order.
    const at = new Map(B.map((b, j) => [b.eid, j]));
    let last = -1;
    A.forEach((a, i) => { const j = at.get(a.eid); if (j !== undefined && j > last) { anchors.push([i, j]); last = j; } });
  }
  const rows = [];
  const gap = (a0, a1, b0, b1) => {
    // Pair what's between two anchors in order, when alike enough.
    let j = b0;
    for (let i = a0; i < a1; i++) {
      let best = -1;
      let score = 0.34;
      for (let k = j; k < b1 && k < j + 6; k++) { const s = likeness(A[i].text, B[k].text); if (s > score) { score = s; best = k; } }
      if (best === -1) { rows.push({ op: 'del', a: A[i] }); continue; }
      for (; j < best; j++) rows.push({ op: 'ins', b: B[j] });
      rows.push({ op: 'chg', a: A[i], b: B[best], words: wordDiff(A[i].text, B[best].text) });
      j = best + 1;
    }
    for (; j < b1; j++) rows.push({ op: 'ins', b: B[j] });
  };
  let pa = 0;
  let pb = 0;
  for (const [i, j] of anchors) {
    gap(pa, i, pb, j);
    const a = A[i];
    const b = B[j];
    rows.push(a.text === b.text ? { op: 'same', a, b } : { op: 'chg', a, b, words: wordDiff(a.text, b.text) });
    pa = i + 1;
    pb = j + 1;
  }
  gap(pa, n, pb, m);
  return rows;
}

// How much changed, for a line under each chapter: words added and taken out.
export function changeCount(rows) {
  let added = 0;
  let cut = 0;
  for (const r of rows) {
    if (r.op === 'ins') added += wordCount(r.b.text);
    else if (r.op === 'del') cut += wordCount(r.a.text);
    else if (r.op === 'chg') for (const w of r.words) { if (w.op === '+') added += wordCount(w.t); if (w.op === '-') cut += wordCount(w.t); }
  }
  return { added, cut };
}

// The plain text of a side, chapter by chapter, for Claude.
export const sideText = (chapters) => chapters.map((ch) => ({ title: ch.title, text: ch.blocks.map((b) => (b.kind === 'scene' ? `[${b.text || 'Scene break'}]` : b.el && b.el !== 'action' ? `${b.el.toUpperCase()}: ${b.text}` : b.text)).join('\n') }));


async function keepCopy(piece) {
  const now = Date.now();
  const kept = await draftsOf(piece.id);
  const n = Math.max(piece.fields?.draft ? piece.fields.draft : 1, ...kept.map((d) => (d.fields?.n || 0) + 1));
  const draft = entry('draft', { id: newId('dr'), parent_id: piece.id, title: `Draft ${n}`, sort: n, fields: { n, at: now } });
  const rows = [draft];
  let words = 0;
  let first = null;
  const TEXT = ['para', 'scene', 'heading'];
  for (const act of (await children(piece.id)).filter((r) => r.kind === 'act')) {
    const a = entry('act', { parent_id: draft.id, title: act.title, sort: act.sort, fields: { ...(act.fields || {}) } });
    rows.push(a);
    for (const ch of await children(act.id)) {
      if (ch.kind !== 'chapter') continue;
      if (!first) first = ch;
      words += ch.fields?.words || 0;
      const c = entry('chapter', { parent_id: a.id, title: ch.title, sort: ch.sort, fields: { ...(ch.fields || {}) } });
      rows.push(c);
      for (const r of await children(ch.id)) {
        if (!TEXT.includes(r.kind)) continue;
        rows.push(entry(r.kind, { id: newId(r.kind.slice(0, 2)), parent_id: c.id, sort: r.sort, title: r.title || '', text: r.text || '', content: r.content ?? null, tags: [], links: [], fields: { ...(r.fields || {}) } }));
      }
    }
  }
  draft.fields.words = words;
  rows.push({ ...piece, fields: { ...piece.fields, draft: n + 1 }, updated_at: now });
  await putEntries(rows);
  return { draft, first };
}
