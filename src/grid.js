import { getEntry, children, putEntries, byKind } from './db.js';
import { entry, newId, tagsIn, outline, noteTypes } from './model.js';
import { placeSorts } from './order.js';
import { SECTION_NAMES, sectionName } from './schema.js';
import { bookType, hasManuscript, kindName, worldOf, piecesIn } from './library.js';
import { media } from './device.js';
import { plain as make } from './dom.js';

// The plot grid: the manuscript shown as a table, the way Rowling planned
// with hers. Rows are the story's own units (acts, chapters, scenes, a
// script's sections at any depth, or the episodes of a season); columns are
// threads: a character's journey, a mystery, a romance, whatever this story
// needs to follow. Nothing here is a copy:
// - a row IS the chapter, section or piece, so dragging a row moves it in
//   the manuscript;
// - a cell holds notes, the same notes that sit in the margin while you
//   write, each belonging to one thread; a note written in the margin and
//   given a thread shows up in the grid, and dragging a note to another row
//   moves it there in the text;
// - the summary column is the chapter's, section's or piece's own summary.
// Threads belong to the world, so a promise planted in one piece can be paid
// off in another (a gag sets up what an episode pays off).

// Thread colours, by a thread's place in the world's list (as in the plan).
const HUES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

export const BEATS = [
  { id: 'promise', label: 'Promise', mark: '◇', about: 'Sets something up the story owes the reader' },
  { id: 'progress', label: 'Progress', mark: '→', about: 'Moves a promise along' },
  { id: 'payoff', label: 'Payoff', mark: '◆', about: 'Delivers on a promise' }
];
const beatOf = (id) => BEATS.find((b) => b.id === id);
const TEXT = ['para', 'heading', 'scene'];
// A thread's own tag, from its name: "The goo" is #the-goo.
export const tagFor = (name) => (name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');

// ---------- what the rows are ----------

// The levels a grid can show its rows at, top down.
export function levelsFor(owner, info) {
  const out = [];
  const type = owner.kind === 'world' ? 'world' : bookType(owner);
  if (type === 'novel' && info.hasManuscript) {
    const names = owner.fields?.levels || ['Act', 'Chapter', 'Scene'];
    out.push({ id: 'act', label: plural(names[0] || 'Act') }, { id: 'chapter', label: plural(names[1] || 'Chapter') }, { id: 'scene', label: plural(names[2] || 'Scene') });
  }
  if (type === 'screenplay' && info.hasManuscript && owner.fields?.woven) {
    // Woven (Nov 20 2026): one row per scene, anchored on its hidden heading,
    // named by its title; acts and sequences can be rows too.
    const names = owner.fields?.sections || SECTION_NAMES;
    for (const l of [1, 2]) if (info.sectionLevels?.has(l)) out.push({ id: `s${l}`, label: plural(sectionName(l, names)) });
    out.push({ id: 'wscene', label: plural(sectionName(3, names)) });
  } else if (type === 'screenplay' && info.hasManuscript) {
    const names = owner.fields?.sections || SECTION_NAMES;
    for (let l = 1; l <= Math.max(1, info.deepest); l++) out.push({ id: `s${l}`, label: plural(sectionName(l, names)) });
    out.push({ id: 'slug', label: 'Scene headings' });
  }
  if (info.pieces.length) out.push({ id: 'piece', label: info.pieceLabel });
  return out;
}
const plural = (w) => (/s$/i.test(w) ? w : /y$/i.test(w) && !/[aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);

// Everything a grid needs to know about its owner (a piece or a world).
export async function loadStructure(owner) {
  const acts = owner.kind === 'project' && hasManuscript(owner) ? await outline(owner.id) : [];
  for (const act of acts) for (const ch of act.chapters) ch.rows = (await children(ch.id)).filter((r) => TEXT.includes(r.kind));
  const pieces = await piecesIn(owner.id);
  // What's inside each piece, so notes anywhere in an episode show in its row.
  for (const p of pieces) p.inside = await descendants(p.id);
  let deepest = 0;
  const sectionLevels = new Set();
  for (const act of acts) for (const ch of act.chapters) for (const r of ch.rows) if (r.kind === 'scene') { deepest = Math.max(deepest, r.fields?.level || 1); sectionLevels.add(r.fields?.level || 1); }
  const labels = [...new Set(pieces.map((p) => kindName(p)))];
  return {
    acts,
    pieces,
    hasManuscript: acts.some((a) => a.chapters.length),
    deepest,
    sectionLevels,
    pieceLabel: pieces.length && labels.length === 1 ? plural(labels[0]) : 'Pieces'
  };
}

// Paragraphs hold only their notes, so there's no need to look inside them
// (a long novel has thousands).
const LEAF = ['para', 'heading', 'scene'];

async function descendants(id) {
  const out = [];
  const walk = async (pid, depth) => {
    if (depth > 12) return;
    for (const r of await children(pid)) {
      if (['note', 'thread'].includes(r.kind)) continue;
      out.push(r);
      if (!LEAF.includes(r.kind)) await walk(r.id, depth + 1);
    }
  };
  await walk(id, 0);
  return out;
}

// The rows at a level, with group headings between them (the act a chapter
// is in, the act and sequence a scene is in). Each row has the entry it
// stands for (its anchor: where its notes and summary live), the entries it
// covers (members), and the entries that move when it's dragged (span).
export function rowsAt(level, st, owner) {
  const out = [];
  const row = (r) => { out.push({ type: 'row', movable: true, ...r }); return out.at(-1); };
  const group = (g) => out.push({ type: 'group', depth: 1, ...g });
  if (level === 'piece') {
    for (const p of st.pieces) row({ id: p.id, kind: 'piece', entry: p, title: p.title || 'Untitled', synopsis: p.fields?.synopsis || '', members: [p.id, ...p.inside.map((r) => r.id)], label: kindName(p) });
    return out;
  }
  if (level === 'act') {
    for (const act of st.acts) {
      const ids = [act.id];
      for (const ch of act.chapters) ids.push(ch.id, ...ch.rows.map((r) => r.id));
      row({ id: act.id, kind: 'act', entry: act, title: act.title || 'Untitled', synopsis: act.fields?.synopsis || '', members: ids });
    }
    return out;
  }
  if (level === 'chapter') {
    const many = st.acts.length > 1;
    for (const act of st.acts) {
      if (many) group({ id: act.id, kind: 'act', title: act.title || 'Untitled', entry: act });
      for (const ch of act.chapters) row({ id: ch.id, kind: 'chapter', entry: ch, title: ch.title || 'Untitled', synopsis: ch.fields?.synopsis || '', chapterId: ch.id, members: [ch.id, ...ch.rows.map((r) => r.id)], words: ch.fields?.words || 0 });
    }
    return out;
  }
  if (level === 'scene') {
    // A chapter's scenes are the stretches between its scene breaks; the
    // first, before any break, is the chapter's opening and goes with it.
    for (const act of st.acts) {
      for (const ch of act.chapters) {
        group({ id: ch.id, kind: 'chapter', title: ch.title || 'Untitled', entry: ch, chapterId: ch.id });
        let cur = row({ id: ch.id, kind: 'opening', entry: ch, title: ch.title || 'Untitled', opening: true, movable: false, synopsis: ch.fields?.synopsis || '', chapterId: ch.id, members: [ch.id], span: [] });
        const opening = cur;
        let words = false;
        let n = 1;
        for (const r of ch.rows) {
          if (r.kind === 'scene') {
            n += 1;
            cur = row({ id: r.id, kind: 'scene', entry: r, title: r.title || `Scene ${n}`, untitled: !r.title, synopsis: r.fields?.synopsis || '', chapterId: ch.id, members: [r.id], span: [r.id] });
          } else {
            cur.members.push(r.id);
            cur.span.push(r.id);
            if (cur === opening && (r.text || '').trim()) words = true;
          }
        }
        // An opening with no words in it isn't a scene (unless it's all there is).
        if (!words && cur !== opening && !opening.synopsis) {
          out.splice(out.indexOf(opening), 1);
          // Its empty lines go with the first scene, so nothing is left behind when that moves.
          const next = out.find((x) => x.type === 'row' && x.chapterId === ch.id);
          next.members.push(...opening.members);
        }
      }
    }
    return out;
  }
  if (level === 'wscene') { wovenRows(st, owner, row, group); return out; }
  // A script: its sections at one depth are the rows, shallower ones head
  // groups of them, deeper ones are inside a row.
  const names = owner.fields?.sections || SECTION_NAMES;
  const all = [];
  for (const act of st.acts) for (const ch of act.chapters) for (const r of ch.rows) all.push({ r, ch });
  const depth = level === 'slug' ? Infinity : Number(level.slice(1));
  let cur = null;
  for (const { r, ch } of all) {
    const sec = r.kind === 'scene' ? r.fields?.level || 1 : 0;
    const slug = r.kind === 'para' && r.fields?.el === 'scene' && (r.text || '').trim();
    if (sec && sec < depth) {
      group({ id: r.id, kind: 'section', depth: sec, title: r.title || `Untitled ${sectionName(sec, names).toLowerCase()}`, entry: r, chapterId: ch.id });
      cur = null;
      continue;
    }
    const starts = level === 'slug' ? slug : sec === depth;
    if (starts) {
      cur = row({ id: r.id, kind: level === 'slug' ? 'slug' : 'section', entry: r, title: level === 'slug' ? (r.text || '').trim().toUpperCase() : r.title || `Untitled ${sectionName(sec, names).toLowerCase()}`, untitled: !slug && !r.title, code: r.fields?.code || null, synopsis: r.fields?.synopsis || '', chapterId: ch.id, members: [r.id], span: [r.id] });
      continue;
    }
    if (!cur) {
      // Writing before the first row of its group: a row of its own, once it
      // has words in it.
      if (!(r.text || '').trim() && r.kind !== 'scene') continue;
      cur = row({ id: r.id, kind: 'opening', entry: r, title: (r.text || r.title || '').trim().slice(0, 60) || 'Opening', opening: true, movable: false, synopsis: r.fields?.synopsis || '', chapterId: ch.id, members: [], span: [] });
    }
    cur.members.push(r.id);
    cur.span.push(r.id);
  }
  return out;
}

// A Woven script's scenes: each hidden scene heading starts a row (its one
// anchor: summary and thread lines live there), named by the title section
// just above it, or its number and first words. Acts and sequences head
// groups. The title section moves with its scene.
function wovenRows(st, owner, row, group) {
  const names = owner.fields?.sections || SECTION_NAMES;
  const rows = [];
  let cur = null;
  let title = null; // a scene's title section, waiting for its heading
  let n = 0;
  const words = (t) => { const w = (t || '').trim().split(/\s+/).slice(0, 6).join(' '); return w.length > 48 ? `${w.slice(0, 47)}…` : w; };
  for (const act of st.acts) for (const ch of act.chapters) for (const r of ch.rows) {
    const sec = r.kind === 'scene' ? r.fields?.level || 1 : 0;
    if (sec && sec < 3) {
      group({ id: r.id, kind: 'section', depth: sec, title: r.title || `Untitled ${sectionName(sec, names).toLowerCase()}`, entry: r, chapterId: ch.id });
      cur = null;
      title = null;
      continue;
    }
    if (sec) { title = r; continue; }
    if (r.kind === 'para' && r.fields?.el === 'scene') {
      n += 1;
      const a = (r.fields?.synopsis || '').trim();
      const b = (title?.fields?.synopsis || '').trim();
      cur = row({ id: r.id, kind: 'scene', entry: r, n, title: title?.title || '', untitled: !title?.title, code: r.fields?.code || null, synopsis: a && b && a !== b ? `${a} ${b}` : a || b, ...(b ? { clearSynopsis: title.id } : {}), chapterId: ch.id, members: [...(title ? [title.id] : []), r.id], span: [...(title ? [title.id] : []), r.id] });
      rows.push(cur);
      title = null;
      continue;
    }
    if (title && cur) { cur.members.push(title.id); cur.span.push(title.id); }
    title = null;
    if (!cur) {
      if (!(r.text || '').trim()) continue;
      cur = row({ id: r.id, kind: 'opening', entry: r, title: words(r.text) || 'Opening', opening: true, movable: false, synopsis: r.fields?.synopsis || '', chapterId: ch.id, members: [], span: [] });
    }
    if (cur.untitled && !cur.first && r.kind === 'para' && (r.text || '').trim()) cur.first = words(r.text);
    cur.members.push(r.id);
    cur.span.push(r.id);
  }
  for (const r of rows) { r.name = r.title || ''; r.title = `${r.code ? '' : `${r.n} · `}${r.title || r.first || 'name it'}`; }
}

// ---------- reading a thread down its column ----------

// Where each thread goes quiet: runs of rows with nothing for it, between its
// first and last appearance. Returns a Set of "rowIndex:threadId" for the
// empty cells inside runs at least `min` rows long.
export function gaps(rows, threads, has, min = 2) {
  const out = new Set();
  for (const t of threads) {
    const idx = rows.map((r, i) => (has(r, t) ? i : -1)).filter((i) => i >= 0);
    for (let k = 1; k < idx.length; k++) {
      const a = idx[k - 1];
      const b = idx[k];
      if (b - a - 1 >= min) for (let i = a + 1; i < b; i++) out.add(`${i}:${t.id}`);
    }
  }
  return out;
}

// Promises and their payoffs, in story order: each beat is { id, thread,
// beat, at } where `at` is its place in the order. A promise is kept once
// a payoff comes after it in the same thread.
export function promiseState(beats) {
  const out = new Map();
  for (const b of beats) {
    if (b.beat !== 'promise') continue;
    // The nearest payoff after it in the story, not just any later one.
    const paid = beats.filter((x) => x.thread === b.thread && x.beat === 'payoff' && x.at >= b.at).sort((x, y) => x.at - y.at)[0];
    out.set(b.id, paid ? { paid: true, by: paid.id } : { paid: false });
  }
  return out;
}

// Every promise made in a world, in story order, with whether it's been
// paid off yet and where: [{ note, thread, paid, payoff, piece }].
export async function worldPromises(world) {
  const order = new Map();
  const pieceOf = new Map();
  let k = 0;
  const walk = async (row, piece, depth) => {
    if (depth > 12) return;
    order.set(row.id, k++);
    if (piece) pieceOf.set(row.id, piece);
    if (LEAF.includes(row.kind)) return;
    for (const r of await children(row.id)) if (!['note', 'thread', 'page'].includes(r.kind)) await walk(r, r.kind === 'project' ? r : piece, depth + 1);
  };
  await walk(world, null, 0);
  const threads = new Map((await threadsOf(world)).map((t) => [t.id, t]));
  const notes = (await byKind('note')).filter((n) => n.fields?.beat && threads.has(n.fields?.thread) && order.has(n.parent_id));
  const beats = notes.map((n) => ({ id: n.id, thread: n.fields.thread, beat: n.fields.beat, at: order.get(n.parent_id) }));
  const state = promiseState(beats);
  const byId = new Map(notes.map((n) => [n.id, n]));
  return beats.filter((b) => b.beat === 'promise').sort((a, b) => a.at - b.at).map((b) => {
    const st = state.get(b.id);
    const note = byId.get(b.id);
    return { note, thread: threads.get(b.thread), paid: st.paid, payoff: st.paid ? byId.get(st.by) : null, piece: pieceOf.get(note.parent_id) || null, payoffPiece: st.paid ? pieceOf.get(byId.get(st.by).parent_id) || null : null };
  });
}

// ---------- the threads ----------

export async function threadsOf(world) {
  if (!world) return [];
  return (await children(world.id)).filter((r) => r.kind === 'thread');
}

export async function newThread(world, title) {
  const list = await threadsOf(world);
  const t = entry('thread', { id: newId('th'), parent_id: world.id, title, sort: (list.at(-1)?.sort || 0) + 1024, fields: { tag: tagFor(title) } });
  await putEntries([t]);
  return t;
}

// ---------- moving rows: the manuscript moves with them ----------

// Puts entries (a span of paragraphs and sections) into a chapter, before
// `before` or after `after` (ids of entries already there), or at the end.
// The notes beside them come along.
export async function placeSpan(ids, chapterId, { before = null, after = null } = {}) {
  if (!ids.length) return [];
  const moving = new Set(ids);
  const rows = (await Promise.all(ids.map(getEntry))).filter(Boolean);
  const from = new Set(rows.map((r) => r.parent_id));
  const there = (await children(chapterId)).filter((r) => TEXT.includes(r.kind) && !moving.has(r.id));
  let at = there.length;
  if (before) { const i = there.findIndex((r) => r.id === before); if (i >= 0) at = i; }
  else if (after) { const i = there.findIndex((r) => r.id === after); if (i >= 0) at = i + 1; }
  const order = [...there.slice(0, at), ...rows, ...there.slice(at)];
  const sorts = placeSorts(order.map((r) => (moving.has(r.id) ? undefined : r.sort)));
  const now = Date.now();
  const out = [];
  order.forEach((r, i) => { if (moving.has(r.id) || r.sort !== sorts[i]) out.push({ ...r, parent_id: chapterId, sort: sorts[i], updated_at: now }); });
  if ([...from].some((c) => c !== chapterId)) {
    for (const n of (await byKind('note')).filter((x) => moving.has(x.parent_id) && x.fields?.chapter_id !== chapterId)) out.push({ ...n, fields: { ...n.fields, chapter_id: chapterId }, updated_at: now });
  }
  await putEntries(out);
  return out;
}

// Puts one entry among its kind under a parent (a chapter in an act, an act
// in a book, a piece in a world or a season), before or after a sibling.
export async function placeAmong(id, parentId, kind, { before = null, after = null } = {}) {
  const me = await getEntry(id);
  if (!me) return [];
  const there = (await children(parentId)).filter((r) => r.kind === kind && r.id !== id);
  let at = there.length;
  if (before) { const i = there.findIndex((r) => r.id === before); if (i >= 0) at = i; }
  else if (after) { const i = there.findIndex((r) => r.id === after); if (i >= 0) at = i + 1; }
  if (!before && !after) at = 0;
  const order = [...there.slice(0, at), me, ...there.slice(at)];
  const sorts = placeSorts(order.map((r) => (r.id === id ? undefined : r.sort)));
  const now = Date.now();
  const out = [];
  order.forEach((r, i) => { if (r.id === id || r.sort !== sorts[i]) out.push({ ...r, ...(r.id === id ? { parent_id: parentId } : {}), sort: sorts[i], updated_at: now }); });
  await putEntries(out);
  return out;
}

// ---------- the view ----------

const LEVEL_KEY = (id) => `gridLevel:${id}`;
const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* full */ } };

export class PlotGrid {
  // hooks: open(row), changed(ids) after anything is written, menu(anchor,
  // items), ask(opts), askText(opts), toast(text, action), noteType().
  constructor(el, hooks) {
    this.el = el;
    this.hooks = hooks;
    this.owner = null;
    this.level = null;
    this.saveTimers = new Map();
    this.busy = Promise.resolve();
    this.touch = media('touch');
    // Outline or Grid (Part 2, Nov 2026): a phone opens on Outline, Windows on
    // whichever was used last there.
    this.mode = this.touch.matches ? 'outline' : pref('gridMode', 'grid');
    this.follow = '';
    // Lines under a cell's top line, opened in place (planlines.js, loaded
    // when first needed so the grid's own logic runs anywhere).
    this.lines = null;
  }

  get isOpen() { return !!this.owner && document.documentElement.dataset.view === 'grid'; }

  async show(ownerId, level) {
    this.owner = await getEntry(ownerId);
    if (level) setPref(LEVEL_KEY(ownerId), level);
    return this.render();
  }

  // Draw again (after a change here or from another device), keeping what's
  // being typed: an open cell isn't redrawn under the caret.
  refresh() {
    if (!this.owner) return this.busy;
    if (this.el.contains(document.activeElement) && document.activeElement.isContentEditable) { this.stale = true; return this.busy; }
    return this.render();
  }

  render() {
    this.busy = this.busy.then(() => this.draw()).catch((e) => console.error(e));
    return this.busy;
  }

  async draw() {
    this.stale = false;
    const owner = (this.owner = await getEntry(this.owner.id));
    if (!owner || owner.deleted) return;
    const st = (this.st = await loadStructure(owner));
    const levels = levelsFor(owner, st);
    const wanted = pref(LEVEL_KEY(owner.id), null);
    const fallback = levels.find((l) => l.id === 'chapter' || l.id === 'wscene') || levels.filter((l) => /^s\d$/.test(l.id)).at(-1) || levels[0];
    this.level = levels.some((l) => l.id === wanted) ? wanted : fallback?.id || null;
    this.world = owner.kind === 'world' ? owner : await worldOf(owner);
    const allThreads = await threadsOf(this.world);
    const hiddenIds = new Set(owner.fields?.gridHide || []);
    this.threads = allThreads.filter((t) => !hiddenIds.has(t.id));
    this.hiddenThreads = allThreads.filter((t) => hiddenIds.has(t.id));
    this.items = this.level ? rowsAt(this.level, st, owner) : [];
    this.rows = this.items.filter((x) => x.type === 'row');

    // Which row each entry is in, then the notes and tagged paragraphs in each cell.
    const where = new Map();
    this.rows.forEach((r, i) => { for (const id of r.members) where.set(id, i); });
    const texts = new Map();
    for (const act of st.acts) for (const ch of act.chapters) for (const r of ch.rows) texts.set(r.id, r);
    for (const p of st.pieces) for (const r of p.inside) texts.set(r.id, r);
    this.texts = texts;
    const byTag = new Map(this.threads.filter((t) => t.fields?.tag).map((t) => [t.fields.tag, t]));
    const cells = new Map();
    const cell = (i, t) => { const k = `${i}:${t}`; if (!cells.has(k)) cells.set(k, { notes: [], mentions: [] }); return cells.get(k); };
    const notes = (await byKind('note')).filter((n) => where.has(n.parent_id));
    for (const n of notes) {
      const i = where.get(n.parent_id);
      const t = n.fields?.thread && this.threads.find((x) => x.id === n.fields.thread);
      if (t) cell(i, t.id).notes.push(n);
      else for (const tag of n.tags || []) if (byTag.has(tag)) cell(i, byTag.get(tag).id).notes.push(n);
    }
    for (const [id, i] of where) {
      const r = texts.get(id);
      if (!r || r.kind === 'note') continue;
      for (const tag of r.tags || []) if (byTag.has(tag)) cell(i, byTag.get(tag).id).mentions.push(r);
    }
    for (const c of cells.values()) c.notes.sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.created_at - b.created_at);
    this.cells = cells;
    // Notes by category (Part 4): directing, fixes, readers' comments… gathered
    // per row, for the Outline's Follow row and the grid's category columns.
    this.types = await noteTypes();
    const typed = new Map();
    for (const n of notes) {
      if (n.fields?.thread || n.fields?.resolved || !n.type || !(n.text || '').trim()) continue;
      const k = `${where.get(n.parent_id)}:${n.type}`;
      if (!typed.has(k)) typed.set(k, []);
      typed.get(k).push(n);
    }
    for (const list of typed.values()) list.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    this.typed = typed;
    this.gapSet = gaps(this.rows, this.threads, (r, t) => {
      const c = cells.get(`${this.rows.indexOf(r)}:${t.id}`);
      return !!c && (c.notes.some((n) => (n.text || '').trim()) || c.mentions.length > 0);
    });
    // Promises across the whole world, in story order.
    this.promises = await this.promiseMap();
    this.paint(levels);
  }

  // Each promise note in this world: kept (a payoff after it in its thread)
  // or not yet. Story order is the world's pieces in order, then each
  // piece's chapters and lines in order.
  async promiseMap() {
    if (!this.world) return new Map();
    const order = new Map();
    let k = 0;
    const walk = async (id, kind, depth) => {
      if (depth > 12) return;
      order.set(id, k++);
      if (depth && LEAF.includes(kind)) return;
      for (const r of await children(id)) if (!['note', 'thread', 'page'].includes(r.kind)) await walk(r.id, r.kind, depth + 1);
    };
    await walk(this.world.id, 'world', 0);
    const beats = (await byKind('note')).filter((n) => n.fields?.beat && n.fields?.thread && order.has(n.parent_id))
      .map((n) => ({ id: n.id, thread: n.fields.thread, beat: n.fields.beat, at: order.get(n.parent_id) }));
    return promiseState(beats);
  }

  paint(levels) {
    const owner = this.owner;
    const head = make('div', 'gv-head');
    const title = make('h1', 'gv-title', owner.title || 'Untitled');
    const sub = make('div', 'gv-sub');
    if (levels.length > 1) {
      const pick = make('div', 'gv-levels');
      pick.setAttribute('role', 'tablist');
      pick.setAttribute('aria-label', 'Rows');
      for (const l of levels) {
        const b = make('button', 'chip' + (l.id === this.level ? ' on' : ''), l.label);
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(l.id === this.level));
        b.addEventListener('click', () => { setPref(LEVEL_KEY(owner.id), l.id); this.render(); });
        pick.append(b);
      }
      sub.append(pick);
    }
    const tools = make('div', 'gv-tools');
    const back = make('button', 'ghost-btn gv-write', owner.kind === 'world' ? 'World' : 'Write');
    back.type = 'button';
    back.title = owner.kind === 'world' ? 'Back to the world' : 'Back to the text (Ctrl + Shift + G)';
    back.addEventListener('click', () => this.hooks.leave(owner));
    tools.append(back, this.hooks.menuButton(() => this.moreMenu(), 'More for the grid'));
    head.append(title, tools);
    if (this.level && (this.rows.length || owner.kind === 'project')) {
      const sw = make('div', 'gv-mode');
      sw.setAttribute('role', 'group');
      sw.setAttribute('aria-label', 'Outline or grid');
      for (const [id, label] of [['outline', 'Outline'], ['grid', 'Grid']]) {
        const b = make('button', 'chip' + (this.mode === id ? ' on' : ''), label);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(this.mode === id));
        b.addEventListener('click', () => this.setMode(id));
        sw.append(b);
      }
      sub.prepend(sw);
    }
    // A piece's Outline is its home (One home): drawn even before it has scenes.
    const home = owner.kind === 'project' && !!this.hooks.pieceHead;
    if (this.mode === 'outline' && this.level && (this.rows.length || home)) { this.paintOutline(head, sub); return; }
    // Columns: a note category can sit beside the threads (per device).
    const shownTypes = this.typeCols();
    const offered = this.level ? this.usedTypes(shownTypes) : [];
    if (offered.length) {
      const cols = make('div', 'gv-cols');
      cols.setAttribute('role', 'group');
      cols.setAttribute('aria-label', 'Note columns');
      cols.append(make('span', 'ol-flabel', 'Columns'));
      for (const t of offered) {
        const on = shownTypes.includes(t.id);
        const b = make('button', 'ol-chip gv-colchip', t.name || 'Notes');
        b.type = 'button';
        b.style.setProperty('--h', t.color || 'var(--muted)');
        b.setAttribute('aria-pressed', String(on));
        b.title = on ? 'Take this column away' : 'Show these notes as a column';
        b.addEventListener('click', () => { setPref('gridTypeCols', JSON.stringify(on ? shownTypes.filter((x) => x !== t.id) : [...shownTypes, t.id])); this.render(); });
        cols.append(b);
      }
      sub.append(cols);
    }
    this.colTypes = offered.filter((t) => shownTypes.includes(t.id));

    const scroll = make('div', 'gv-scroll');
    if (!this.level) {
      scroll.append(make('p', 'hint gv-empty', 'Nothing to lay out yet. A grid shows the chapters or sections of a draft, or the pieces inside this one.'));
      this.el.replaceChildren(head, sub, scroll);
      return;
    }
    const table = make('table', 'gv-table');
    const hide = new Set(JSON.parse(pref('gridHideCols', '[]')));
    if (hide.has('summary')) table.classList.add('no-summary');
    if (hide.has('gaps')) table.classList.add('no-gaps');
    const thead = make('thead');
    const hr = make('tr');
    const th0 = make('th', 'gv-corner');
    th0.append(make('span', '', levels.find((l) => l.id === this.level)?.label || ''));
    const sumh = Object.assign(make('th', 'gv-sumh', 'Summary'), { scope: 'col' });
    sumh.dataset.col = 'summary';
    this.grip(sumh, 'summary');
    hr.append(th0, sumh);
    this.threads.forEach((t) => hr.append(this.threadHead(t)));
    for (const t of this.colTypes) {
      const th = Object.assign(make('th', 'gv-typeh', t.name || 'Notes'), { scope: 'col' });
      th.style.setProperty('--h', t.color || 'var(--muted)');
      th.dataset.col = `type:${t.id}`;
      this.grip(th, `type:${t.id}`);
      hr.append(th);
    }
    const add = make('th', 'gv-addh');
    const addBtn = make('button', 'ghost-btn gv-add-thread', '+ Thread');
    addBtn.type = 'button';
    addBtn.title = 'A column to follow a character, a plot line, a mystery…';
    addBtn.addEventListener('click', () => this.addThread(addBtn));
    add.append(addBtn);
    hr.append(add);
    thead.append(hr);
    const tbody = make('tbody');
    let i = 0;
    for (const item of this.items) {
      if (item.type === 'group') tbody.append(this.groupRow(item));
      else tbody.append(this.row(item, i++));
    }
    table.append(thead, tbody);
    scroll.append(table);
    this.scrollEl = scroll;
    this.colWidths();
    const empty = !this.rows.length ? make('p', 'hint gv-empty', 'No rows at this level yet.') : null;
    const read = this.claudePanel();
    const hint = !this.threads.length && this.rows.length ? make('p', 'hint gv-hint', 'Add a thread for each thing you want to follow down the story: a character’s journey, a mystery, a romance. A blank run in a column shows where a thread was dropped.') : null;
    this.el.replaceChildren(...[head, sub, read, scroll, empty, hint].filter(Boolean));
    this.lines?.sweep();
  }

  // ---------- Claude, only when asked ----------

  // What Claude reads: each row's title, summary, words and notes.
  claudeBody(task, thread) {
    const rows = this.rows.map((r, i) => {
      const text = r.members.map((id) => this.texts.get(id)).filter((e) => e && ['para', 'heading', 'scene', 'line'].includes(e.kind))
        .map((e) => (e.kind === 'scene' ? `[${e.title || 'section'}]` : e.text || '')).filter((t) => t.trim()).join('\n');
      const notes = [];
      for (const t of this.threads) for (const n of this.cells.get(`${i}:${t.id}`)?.notes || []) notes.push({ thread: t.id, text: n.text || '', ...(n.fields?.beat ? { beat: n.fields.beat } : {}) });
      return { id: r.id, title: r.title, ...(r.synopsis ? { summary: r.synopsis } : {}), text, notes };
    });
    return { mode: 'grid', task, ...(thread ? { thread } : {}), piece: this.owner.title || '', rows, threads: this.threads.map((t) => ({ id: t.id, title: t.title || '', ...(t.fields?.tag ? { tag: t.fields.tag } : {}) })) };
  }

  async fillThread(t) {
    if (!this.hooks.canAsk()) { this.hooks.toast('Claude needs you signed in and online.'); return; }
    this.reading = `Claude is reading the draft for “${t.title}”…`;
    await this.render();
    let out;
    try { out = await this.hooks.askServer(this.claudeBody('fill', t.id)); } catch (e) { this.reading = null; await this.render(); this.hooks.toast(e.message || 'Claude couldn’t do that just now.'); return; }
    this.reading = null;
    const have = new Set(this.rows.map((r, i) => ((this.cells.get(`${i}:${t.id}`)?.notes || []).some((n) => (n.text || '').trim()) ? r.id : null)).filter(Boolean));
    const now = Date.now();
    const made = [];
    for (const c of out?.cells || []) {
      const r = this.rows.find((x) => x.id === c.row);
      if (!r || have.has(r.id)) continue;
      made.push(entry('note', { parent_id: r.id, type: this.hooks.noteType(), text: c.text, tags: tagsIn(c.text), sort: now + made.length, _by: 'claude', fields: { thread: t.id, ...(c.beat ? { beat: c.beat } : {}), ...(r.chapterId ? { chapter_id: r.chapterId } : {}) } }));
    }
    if (made.length) await putEntries(made);
    this.hooks.changed(made);
    await this.render();
    this.hooks.toast(made.length ? `Claude filled in ${made.length} row${made.length === 1 ? '' : 's'} of “${t.title}”` : `Claude didn’t find more of “${t.title}” in the draft`, made.length ? { label: 'Undo', run: async () => { await putEntries(made.map((n) => ({ ...n, deleted: true, updated_at: Date.now() }))); this.hooks.changed(made); this.render(); } } : undefined);
  }

  async checkPromises() {
    if (!this.hooks.canAsk()) { this.hooks.toast('Claude needs you signed in and online.'); return; }
    if (!this.threads.length) { this.hooks.toast('Add a thread first: Claude checks the promises each one makes.'); return; }
    this.reading = 'Claude is reading the story for promises…';
    this.findings = null;
    await this.render();
    try {
      const out = await this.hooks.askServer(this.claudeBody('check'));
      this.findings = out?.findings || [];
    } catch (e) { this.hooks.toast(e.message || 'Claude couldn’t do that just now.'); }
    this.reading = null;
    await this.render();
  }

  claudePanel() {
    if (!this.reading && !this.findings) return null;
    const box = make('section', 'gv-claude');
    box.setAttribute('aria-label', 'What Claude noticed');
    const head = make('div', 'gv-claude-head');
    head.append(make('span', 'panel-label', this.reading ? 'Claude' : 'What Claude noticed'));
    if (!this.reading) {
      const close = make('button', 'ghost-btn', 'Close');
      close.type = 'button';
      close.addEventListener('click', () => { this.findings = null; this.render(); });
      head.append(close);
    }
    box.append(head);
    if (this.reading) { box.append(make('p', 'hint', this.reading)); return box; }
    if (!this.findings.length) { box.append(make('p', 'hint', 'Nothing left hanging: every promise Claude found is paid off.')); return box; }
    const KIND = { promise: 'Not paid off', quiet: 'Goes quiet', payoff: 'Payoff with no setup' };
    const list = make('ul', 'gv-findings');
    for (const f of this.findings) {
      const li = make('li');
      const b = make('button');
      b.type = 'button';
      const t = this.threads.find((x) => x.id === f.thread);
      const r = this.rows.find((x) => x.id === f.row);
      b.append(make('span', 'from', [KIND[f.kind] || 'Note', t?.title, r?.title].filter(Boolean).join(' · ')), make('span', 'line', f.text));
      b.addEventListener('click', () => {
        const tr = r && this.el.querySelector(`tr[data-id="${CSS.escape(r.id)}"]`);
        if (!tr) return;
        tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
        tr.classList.add('flash');
        setTimeout(() => tr.classList.remove('flash'), 1600);
      });
      li.append(b);
      list.append(li);
    }
    box.append(list);
    return box;
  }

  threadHead(t) {
    const th = make('th', 'gv-thread');
    th.scope = 'col';
    th.dataset.thread = t.id;
    th.dataset.col = t.id;
    const name = make('button', 'gv-tname', t.title || 'Untitled');
    name.type = 'button';
    name.title = t.fields?.tag ? `#${t.fields.tag}` : '';
    name.addEventListener('click', () => this.hooks.menu(name, this.threadMenu(t)));
    name.addEventListener('contextmenu', (e) => { e.preventDefault(); this.hooks.menu(name, this.threadMenu(t)); });
    th.append(name);
    this.grip(th, t.id);
    if (!this.touch.matches) {
      th.draggable = true;
      th.addEventListener('dragstart', (e) => { this.dragging = { thread: t.id }; e.dataTransfer.setData('text/plain', t.title || ''); e.dataTransfer.effectAllowed = 'move'; });
      th.addEventListener('dragover', (e) => { if (this.dragging?.thread) { e.preventDefault(); th.classList.add('drop'); } });
      th.addEventListener('dragleave', () => th.classList.remove('drop'));
      th.addEventListener('drop', async (e) => { e.preventDefault(); th.classList.remove('drop'); const d = this.dragging; this.dragging = null; if (d?.thread && d.thread !== t.id) await this.moveThread(d.thread, t.id); });
      th.addEventListener('dragend', () => { this.dragging = null; });
    }
    return th;
  }

  groupRow(g) {
    const tr = make('tr', 'gv-group');
    tr.dataset.depth = g.depth || 1;
    tr.dataset.id = g.id;
    const td = make('td');
    td.colSpan = this.threads.length + 3;
    const b = make('button', 'gv-gtitle', g.title);
    b.type = 'button';
    b.addEventListener('click', () => this.hooks.open(g));
    td.append(b);
    tr.append(td);
    this.dropTarget(tr, { group: g });
    return tr;
  }

  row(r, i) {
    const tr = make('tr', 'gv-row' + (r.opening ? ' opening' : ''));
    tr.dataset.id = r.id;
    const th = make('th', 'gv-rtitle');
    th.scope = 'row';
    if (r.movable && !this.touch.matches) {
      const grip = make('span', 'gv-grip', '⠿');
      grip.title = 'Drag to move it in the story';
      grip.draggable = true;
      grip.addEventListener('dragstart', (e) => { this.dragging = { row: r }; tr.classList.add('dragging'); e.dataTransfer.setData('text/plain', r.title); e.dataTransfer.effectAllowed = 'move'; });
      grip.addEventListener('dragend', () => { tr.classList.remove('dragging'); this.dragging = null; });
      th.append(grip);
    }
    const open = make('button', 'gv-open' + (r.untitled ? ' untitled' : ''));
    open.type = 'button';
    if (r.code) open.append(make('span', 'gv-code', r.code));
    open.append(make('span', 'gv-name', r.title));
    if (r.label && r.kind === 'piece') open.append(make('span', 'gv-label', r.label));
    open.title = this.touch.matches ? '' : 'Open it in the text. Right-click for more.';
    open.addEventListener('click', () => (this.touch.matches ? this.hooks.menu(open, this.rowMenu(r, i)) : this.hooks.open(r)));
    open.addEventListener('contextmenu', (e) => { e.preventDefault(); this.hooks.menu(open, this.rowMenu(r, i)); });
    th.append(open);
    tr.append(th);

    const sum = make('td', 'gv-sum');
    sum.dataset.col = 'summary';
    const text = make('div', 'gv-text', r.synopsis || '');
    text.contentEditable = 'plaintext-only';
    text.dataset.placeholder = 'What happens';
    text.setAttribute('aria-label', `Summary of ${r.title}`);
    text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); text.blur(); } if (e.key === 'Escape') { text.textContent = r.synopsis || ''; text.blur(); } });
    text.addEventListener('blur', () => this.saveSummary(r, text.textContent.trim()));
    sum.append(text);
    if (!r.opening) this.linesIn(sum, r.id, true);
    tr.append(sum);

    for (const t of this.threads) tr.append(this.cellEl(r, i, t));
    for (const t of this.colTypes || []) {
      const td = make('td', 'gv-typecell');
      td.dataset.col = `type:${t.id}`;
      for (const n of this.typed.get(`${i}:${t.id}`) || []) td.append(this.typedNote(n, r));
      tr.append(td);
    }
    tr.append(make('td', 'gv-pad'));
    if (r.movable) this.dropTarget(tr, { row: r });
    return tr;
  }

  cellEl(r, i, t) {
    const td = make('td', 'gv-cell');
    td.dataset.thread = t.id;
    td.dataset.col = t.id;
    const c = this.cells.get(`${i}:${t.id}`) || { notes: [], mentions: [] };
    if (this.gapSet.has(`${i}:${t.id}`)) td.classList.add('gap');
    for (const n of c.notes) td.append(this.noteEl(n, r, t));
    for (const m of c.mentions.slice(0, 3)) {
      const q = make('button', 'gv-mention', (m.text || m.title || '').trim().slice(0, 90));
      q.type = 'button';
      q.title = `Tagged #${t.fields?.tag} in the text. Click to open it there.`;
      q.addEventListener('click', () => this.hooks.open({ ...r, focus: m.id }));
      td.append(q);
    }
    if (c.mentions.length > 3) td.append(make('span', 'gv-more', `+${c.mentions.length - 3} more tagged`));
    // Click anywhere empty in the cell to add a note to it.
    td.addEventListener('click', (e) => { if (e.target === td) this.newNote(td, r, t); });
    td.addEventListener('dragover', (e) => { if (this.dragging?.note) { e.preventDefault(); td.classList.add('drop'); } });
    td.addEventListener('dragleave', () => td.classList.remove('drop'));
    td.addEventListener('drop', async (e) => {
      if (!this.dragging?.note) return;
      e.preventDefault();
      e.stopPropagation();
      td.classList.remove('drop');
      const n = this.dragging.note;
      this.dragging = null;
      await this.moveNote(n, r, t);
    });
    return td;
  }

  noteEl(n, r, t) {
    const box = make('div', 'gv-note');
    box.dataset.note = n.id;
    const beat = beatOf(n.fields?.beat);
    if (beat) box.dataset.beat = beat.id;
    const state = this.promises.get(n.id);
    if (state && !state.paid) box.classList.add('unpaid');
    const mark = make('button', 'gv-mark', beat ? beat.mark : '•');
    mark.type = 'button';
    mark.title = (beat ? `${beat.label}. ` : '') + (state ? (state.paid ? 'Paid off later in the story. ' : 'Not paid off yet. ') : '') + (this.touch.matches ? 'Tap for more.' : 'Drag to move. Click for more.');
    mark.setAttribute('aria-label', `${beat ? beat.label : 'Note'}: more`);
    mark.addEventListener('click', () => this.hooks.menu(mark, this.noteMenu(n, r, t)));
    if (!this.touch.matches) {
      mark.draggable = true;
      mark.addEventListener('dragstart', (e) => { this.dragging = { note: n }; box.classList.add('dragging'); e.dataTransfer.setData('text/plain', n.text || ''); e.dataTransfer.effectAllowed = 'move'; });
      mark.addEventListener('dragend', () => { box.classList.remove('dragging'); this.dragging = null; });
    }
    const text = make('div', 'gv-text', n.text || '');
    text.contentEditable = 'plaintext-only';
    text.setAttribute('aria-label', `${t.title} in ${r.title}`);
    text.addEventListener('input', () => this.saveNote(n, text.textContent));
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); text.blur(); }
      if (e.key === 'Escape') text.blur();
    });
    text.addEventListener('blur', () => this.doneNote(n, text.textContent));
    box.append(mark, text);
    if (!n.unsaved) this.linesIn(box, n.id, false);
    return box;
  }

  // ---------- the Outline (Part 2) ----------
  // The same rows as the grid, one under another: number, title, summary and
  // each thread's line, all written in place (the plan under the scene line,
  // without the text). Follow a thread to see only its lines.

  setMode(mode) {
    if (this.mode === mode) return this.busy;
    this.mode = mode;
    if (!this.touch.matches) setPref('gridMode', mode);
    document.dispatchEvent(new CustomEvent('inkwell:grid-mode', { detail: mode }));
    return this.render();
  }

  paintOutline(head, sub) {
    const page = make('div', 'ol-page');
    // The piece's home: what it is, its name, stage and sentence (One home).
    if (this.owner.kind === 'project' && this.hooks.pieceHead) {
      head.querySelector('.gv-title')?.replaceWith(this.hooks.pieceHead(this.owner, this.world));
      head.classList.add('ph1-head');
    }
    const cat = typeof this.follow === 'string' && this.follow.startsWith('type:') && this.usedTypes().some((t) => `type:${t.id}` === this.follow) ? this.follow.slice(5) : '';
    const f = this.threads.some((t) => t.id === this.follow) ? this.follow : cat ? this.follow : '';
    // Follow: Everything, then a chip per thread, then + New thread.
    const follow = make('div', 'ol-follow');
    follow.setAttribute('role', 'group');
    follow.setAttribute('aria-label', 'Follow');
    follow.append(make('span', 'ol-flabel', 'Follow'));
    const chip = (id, label, hue) => {
      const b = make('button', `ol-chip${hue ? ` hue-${hue}` : ''}`, label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(f === id));
      b.addEventListener('click', () => { this.follow = f === id && id ? '' : id; this.render(); });
      return b;
    };
    follow.append(chip('', 'Everything'));
    this.threads.forEach((t, k) => {
      const b = chip(t.id, t.title || 'Untitled', HUES[k % HUES.length]);
      b.title = this.touch.matches ? '' : 'Follow this thread. F2 or right-click: rename and more.';
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); this.hooks.menu(b, this.threadMenu(t)); });
      b.addEventListener('keydown', (e) => { if (e.key === 'F2') { e.preventDefault(); this.hooks.menu(b, this.threadMenu(t)); } });
      let hold = null;
      b.addEventListener('touchstart', () => { hold = setTimeout(() => { hold = 'done'; this.hooks.menu(b, this.threadMenu(t)); }, 550); }, { passive: true });
      b.addEventListener('touchend', (e) => { if (hold === 'done') e.preventDefault(); clearTimeout(hold); hold = null; });
      b.addEventListener('touchmove', () => { clearTimeout(hold); hold = null; }, { passive: true });
      follow.append(b);
    });
    // Then the note categories that have notes here (no "quiet" marks for these).
    for (const t of this.usedTypes()) {
      const b = chip(`type:${t.id}`, t.name || 'Notes');
      b.classList.add('cat');
      b.style.setProperty('--h', t.color || 'var(--muted)');
      follow.append(b);
    }
    const nt = make('button', 'ol-chip new', '+ New thread');
    nt.type = 'button';
    nt.addEventListener('click', () => this.addThread(nt));
    follow.append(nt);
    page.append(follow);

    const word = this.level === 'chapter' ? 'chapters' : 'scenes';
    const followed = cat ? this.types.find((t) => t.id === cat) : f ? this.threads.find((t) => t.id === f) : null;
    const has = (i) => (cat ? (this.typed.get(`${i}:${cat}`) || []).length > 0 : (this.cells.get(`${i}:${f}`)?.notes || []).some((n) => (n.text || '').trim()));
    if (!this.rows.length) page.append(make('p', 'ol-none', this.level === 'wscene' ? 'No scenes yet. Type “# ” and a name below to start the first one.' : 'Nothing here yet. Type “# ” and a name below to start.'));
    if (followed && !this.rows.some((_r, i) => has(i))) page.append(make('p', 'ol-none', `Nothing here yet for ${followed.title || followed.name || 'this thread'}.`));
    let i = 0;
    let run = 0;
    for (const item of this.items) {
      if (item.type === 'group') { if (!f) page.append(this.olGroup(item)); continue; }
      const r = item;
      const k = i++;
      if (f && !cat && this.gapSet.has(`${k}:${f}`)) {
        if (!run) { let n = 0; while (this.gapSet.has(`${k + n}:${f}`)) n++; page.append(make('div', 'ol-gap', `Quiet for ${n} ${word}`)); }
        run++;
      } else run = 0;
      if (f && !has(k)) {
        const q = make('div', 'ol-row quiet');
        q.append(make('span', 'ol-n', this.olNum(r, k)), make('span', 'ol-title', (r.name ?? r.title) || 'Untitled'));
        page.append(q);
        continue;
      }
      page.append(this.olRow(r, k, f));
    }
    if (!f) page.append(this.olAdd());
    this.el.replaceChildren(head, sub, page);
    this.lines?.sweep();
  }

  olNum(r, i) { return r.code || (r.n != null ? String(r.n) : String(i + 1)); }

  // ---------- note categories (Part 4) ----------

  // The categories that have notes in these rows (and any column already shown).
  usedTypes(also = []) {
    const used = new Set([...this.typed.keys()].map((k) => k.slice(k.indexOf(':') + 1)));
    return (this.types || []).filter((t) => used.has(t.id) || also.includes(t.id));
  }
  typeCols() { try { return JSON.parse(pref('gridTypeCols', '[]')) || []; } catch { return []; } }
  // One gathered note: its category's colour, its words, and a tap to its place in the text.
  typedNote(n, r) {
    const type = this.types.find((t) => t.id === n.type);
    const b = make('button', 'gv-tnote');
    b.type = 'button';
    b.style.setProperty('--h', type?.color || 'var(--muted)');
    b.title = 'Open it in the text';
    const who = n.fields?.comment ? (n.fields.comment.owner ? 'You' : n.fields.comment.name || 'A reader') : '';
    if (who) b.append(make('span', 'gv-tnwho', who));
    b.append(make('span', 'gv-tntext', n.text || ''));
    b.addEventListener('click', () => this.hooks.open({ ...r, focus: n.parent_id }));
    return b;
  }

  olGroup(g) {
    const box = make('div', `ol-sec d${g.depth || 1}`);
    box.dataset.id = g.id;
    const t = make('button', 'ol-st', g.title);
    t.type = 'button';
    t.title = this.touch.matches ? '' : 'Open it in the text';
    t.addEventListener('click', () => this.hooks.open(g));
    const sum = make('div', 'gv-text ol-gsum', g.entry?.fields?.synopsis || '');
    sum.contentEditable = 'plaintext-only';
    sum.dataset.placeholder = 'What happens in it';
    sum.setAttribute('aria-label', `Summary of ${g.title}`);
    sum.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sum.blur(); } });
    sum.addEventListener('blur', () => this.saveSummary({ id: g.id, synopsis: g.entry?.fields?.synopsis || '' }, sum.textContent.trim()));
    box.append(t, sum);
    this.linesIn(box, g.id, true);
    return box;
  }

  olRow(r, i, f) {
    const box = make('div', 'ol-row' + (r.opening ? ' opening' : ''));
    box.dataset.id = r.id;
    const head = make('div', 'ol-head');
    if (r.movable && !this.touch.matches) {
      const grip = make('span', 'gv-grip ol-grip', '⠿');
      grip.title = 'Drag to move it in the story';
      grip.draggable = true;
      grip.addEventListener('dragstart', (e) => { this.dragging = { row: r }; box.classList.add('dragging'); e.dataTransfer.setData('text/plain', r.title); e.dataTransfer.effectAllowed = 'move'; });
      grip.addEventListener('dragend', () => { box.classList.remove('dragging'); this.dragging = null; });
      head.append(grip);
      this.dropTarget(box, { row: r });
    }
    head.append(make('span', 'ol-n', this.olNum(r, i)));
    head.append(this.olTitle(r));
    const tools = make('span', 'ol-tools');
    const tool = (label, aria, run, on = true) => {
      if (!on) return;
      const b = make('button', '', label);
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.title = aria;
      b.addEventListener('click', run);
      tools.append(b);
    };
    tool('↑', 'Move up (Alt + Up)', () => this.nudge(r, i, -1), r.movable && i > 0);
    tool('↓', 'Move down (Alt + Down)', () => this.nudge(r, i, 1), r.movable && i < this.rows.length - 1);
    tool('Open', 'Open it in the text (Enter)', () => this.hooks.open(r));
    // A novel's chapter keeps its own menu (rename, move, Trash…), as the
    // piece's old Overview had it (One home).
    if (r.kind === 'chapter' && this.hooks.rowMenu && this.owner.kind === 'project') {
      const items = () => this.hooks.rowMenu(r);
      tools.append(this.hooks.menuButton(items, `More for ${r.title || 'this chapter'}`));
      head.addEventListener('contextmenu', async (e) => { if (e.target.isContentEditable) return; e.preventDefault(); this.hooks.menu(head, await items()); });
    }
    head.append(tools);
    box.append(head);
    box.addEventListener('keydown', (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && r.movable) {
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        if (this.rows[i + dir]) this.nudge(r, i, dir).then(() => this.el.querySelector(`.ol-row[data-id="${CSS.escape(r.id)}"] .ol-title`)?.focus());
      }
    });
    if (!f) {
      const sum = make('div', 'gv-text ol-sum', r.synopsis || '');
      sum.contentEditable = 'plaintext-only';
      sum.dataset.placeholder = 'What happens';
      sum.setAttribute('aria-label', `Summary of ${r.title}`);
      sum.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sum.blur(); } if (e.key === 'Escape') { sum.textContent = r.synopsis || ''; sum.blur(); } });
      sum.addEventListener('blur', () => this.saveSummary(r, sum.textContent.trim()));
      const sw = make('div', 'ol-sumw');
      sw.append(sum);
      if (!r.opening) this.linesIn(sw, r.id, true);
      box.append(sw);
    }
    if (f.startsWith?.('type:')) {
      const list = make('div', 'ol-tnotes');
      for (const n of this.typed.get(`${i}:${f.slice(5)}`) || []) list.append(this.typedNote(n, r));
      box.append(list);
      return box;
    }
    const shown = f ? this.threads.filter((t) => t.id === f) : this.threads;
    for (const t of shown) {
      const k = this.threads.indexOf(t);
      for (const n of this.cells.get(`${i}:${t.id}`)?.notes || []) box.append(this.olBeat(n, r, t, k));
    }
    // A novel's chapter: its scene breaks, nested under it (a tap opens one in the text).
    if (r.kind === 'chapter' && !f) {
      const ch = (this.st?.acts || []).flatMap((a) => a.chapters).find((c) => c.id === r.id);
      const breaks = (ch?.rows || []).filter((x) => x.kind === 'scene');
      if (breaks.length) {
        const list = make('div', 'ol-breaks');
        for (const b of breaks) {
          const row = make('button', 'ol-break');
          row.type = 'button';
          row.dataset.id = b.id;
          row.title = 'Open it in the text';
          row.append(make('span', 'ol-bdots', '· · ·'), make('span', 'ol-bt', b.title || 'A scene'));
          if (b.fields?.synopsis) row.append(make('span', 'ol-bs', b.fields.synopsis));
          row.addEventListener('click', () => this.hooks.open({ ...r, focus: b.id }));
          list.append(row);
        }
        box.append(list);
      }
    }
    if (!f && this.threads.length) box.append(this.olAddBeat(r, i));
    return box;
  }

  // A row's title: the scene's own name (only you see it), written here.
  olTitle(r) {
    const open = () => this.hooks.open(r);
    const titleId = r.kind === 'scene' && !r.untitled ? r.members?.[0] : (['chapter', 'act'].includes(r.kind) ? r.id : null);
    if (r.kind !== 'scene' && !titleId) {
      const b = make('button', 'ol-title', r.title || 'Untitled');
      b.type = 'button';
      b.addEventListener('click', open);
      return b;
    }
    const own = r.name ?? r.title ?? '';
    const t = make('div', 'ol-title', r.untitled ? '' : own);
    t.contentEditable = 'plaintext-only';
    t.tabIndex = 0;
    t.dataset.placeholder = r.first ? `Name it (${r.first})` : 'Name it';
    t.setAttribute('aria-label', `Title of ${r.title || 'this scene'} (only you see it)`);
    t.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (t.textContent.trim() === (r.untitled ? '' : own)) open(); else t.blur(); }
      if (e.key === 'Escape') { t.textContent = r.untitled ? '' : own; t.blur(); }
    });
    t.addEventListener('blur', () => this.renameRow(r, t.textContent.trim(), titleId));
    return t;
  }

  async renameRow(r, name, titleId) {
    const was = r.untitled ? '' : r.name ?? r.title ?? '';
    if (name === was) return;
    const now = Date.now();
    if (titleId) {
      const fresh = await getEntry(titleId);
      if (!fresh) return;
      await putEntries([{ ...fresh, title: name, updated_at: now }]);
      this.hooks.changed([fresh]);
    } else if (name && r.kind === 'scene' && r.chapterId) {
      // An untitled scene gets its title section right above its heading.
      const sibs = await children(r.chapterId);
      const at = sibs.findIndex((x) => x.id === r.id);
      if (at < 0) return;
      const before = at > 0 ? sibs[at - 1].sort : sibs[at].sort - 2048;
      const row = entry('scene', { parent_id: r.chapterId, title: name, sort: (before + sibs[at].sort) / 2, fields: { level: 3 } });
      await putEntries([row]);
      this.hooks.changed([row]);
    } else return;
    r.name = name;
    r.untitled = !name;
    this.render();
  }

  olBeat(n, r, t, k) {
    const box = make('div', `gv-note ol-beat hue-${HUES[k % HUES.length]}`);
    box.dataset.note = n.id;
    const beat = beatOf(n.fields?.beat);
    const mark = make('button', 'gv-mark', beat ? beat.mark : '·');
    mark.type = 'button';
    mark.title = `${beat ? beat.label : 'No mark'}. Tap for the next mark; right-click for more.`;
    mark.setAttribute('aria-label', `${beat ? beat.label : 'No mark'}: next mark`);
    const order = [null, 'promise', 'progress', 'payoff'];
    mark.addEventListener('click', () => this.setBeat(n, order[(order.indexOf(n.fields?.beat || null) + 1) % order.length]));
    mark.addEventListener('contextmenu', (e) => { e.preventDefault(); this.hooks.menu(mark, this.noteMenu(n, r, t)); });
    const name = make('span', 'ol-tn', t.title || 'Thread');
    const text = make('div', 'gv-text', n.text || '');
    text.contentEditable = 'plaintext-only';
    text.dataset.placeholder = 'what happens for this thread';
    text.setAttribute('aria-label', `${t.title} in ${r.title}`);
    text.addEventListener('input', () => this.saveNote(n, text.textContent));
    text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); text.blur(); } if (e.key === 'Escape') text.blur(); });
    text.addEventListener('blur', () => this.doneNote(n, text.textContent));
    const line = make('div', 'ol-bline');
    line.append(mark, name, text);
    box.append(line);
    if (!n.unsaved) this.linesIn(box, n.id, false);
    return box;
  }

  olAddBeat(r, i) {
    const foot = make('div', 'ol-foot');
    const add = make('button', 'ol-addb', '+ thread');
    add.type = 'button';
    add.addEventListener('click', () => {
      const chips = make('div', 'ol-chips');
      this.threads.forEach((t, k) => {
        const b = make('button', `ol-chip hue-${HUES[k % HUES.length]}`, t.title || 'Untitled');
        b.type = 'button';
        b.addEventListener('click', () => {
          const n = entry('note', { parent_id: r.id, type: this.hooks.noteType(), fields: { thread: t.id, ...(r.chapterId ? { chapter_id: r.chapterId } : {}) } });
          n.unsaved = true;
          n.sort = Date.now();
          const el = this.olBeat(n, r, t, k);
          foot.replaceWith(el, this.olAddBeat(r, i));
          el.querySelector('.gv-text').focus();
        });
        chips.append(b);
      });
      const done = make('button', 'ol-addb', 'Done');
      done.type = 'button';
      done.addEventListener('click', () => chips.replaceWith(add));
      chips.append(done);
      add.replaceWith(chips);
      chips.querySelector('button')?.focus();
    });
    foot.append(add);
    return foot;
  }

  // The add line at the end: "# name" a scene, "## name" a sequence,
  // "### name" an act (a chapter or part in a novel, Part 3).
  olAdd() {
    const wrap = make('div', 'ol-addrow');
    const input = make('input', 'ol-addline');
    const woven = this.level === 'wscene';
    // A novel (Part 3): "# " a scene break, "## " a chapter, "### " a part.
    const novel = this.owner?.kind === 'project' && bookType(this.owner) !== 'screenplay' && ['chapter', 'scene'].includes(this.level);
    const kinds = novel ? ['a scene', 'a chapter', 'a part'] : ['a scene', 'a sequence', 'an act'];
    input.placeholder = woven ? '# a new scene, ## a sequence, ### an act' : novel ? '# a new scene, ## a chapter, ### a part' : 'Add a line…';
    input.setAttribute('aria-label', 'Add at the end');
    input.enterKeyHint = 'done';
    const hint = make('div', 'ol-hint');
    input.addEventListener('input', () => {
      const m = /^(#{1,3})\s/.exec(input.value);
      hint.textContent = m ? `Enter adds ${kinds[m[1].length - 1]}` : '';
    });
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const m = /^(#{1,3})\s+(.*)$/.exec(input.value.trim() + (input.value.trim().endsWith('#') ? ' ' : ''));
      const count = m ? m[1].length : 1;
      const name = (m ? m[2] : input.value).trim();
      if (!woven && !novel) { this.hooks.toast('Add lines with # in a script’s or a book’s Outline'); return; }
      if (novel) await this.addToBook(count, name); else await this.addAtEnd(count, name);
      input.value = '';
      hint.textContent = '';
      await this.render();
      this.el.querySelector('.ol-addline')?.focus();
    });
    wrap.append(input, hint);
    return wrap;
  }

  async addAtEnd(count, name) {
    const last = this.rows.at(-1);
    // An empty script: the first scene goes in its first chapter.
    const chId = last?.chapterId || this.st?.acts?.[0]?.chapters?.[0]?.id;
    if (!chId) return;
    const sibs = await children(chId);
    let sort = (sibs.at(-1)?.sort || 0) + 1024;
    const next = () => { const s0 = sort; sort += 1024; return s0; };
    const rows = [];
    if (count === 1) {
      rows.push(entry('scene', { parent_id: chId, title: name, sort: next(), fields: { level: 3 } }));
      rows.push(entry('para', { parent_id: chId, text: '', content: null, sort: next(), fields: { el: 'scene' } }));
      rows.push(entry('para', { parent_id: chId, text: '', content: null, sort: next(), fields: { el: 'action' } }));
    } else {
      rows.push(entry('scene', { parent_id: chId, title: name, sort: next(), fields: count === 2 ? { level: 2 } : {} }));
    }
    await putEntries(rows);
    this.hooks.changed(rows);
  }

  // A novel's add line: a scene break at the end of the last chapter, a new
  // chapter after it, or a new part (with its first chapter).
  async addToBook(count, name) {
    const acts = this.st?.acts || [];
    const act = acts.at(-1);
    const word = (i, d) => this.owner.fields?.levels?.[i] || d;
    const chapters = acts.flatMap((a) => a.chapters);
    const rows = [];
    if (count === 1) {
      const ch = chapters.at(-1);
      if (!ch) return;
      const sibs = await children(ch.id);
      const sort = (sibs.at(-1)?.sort || 0) + 1024;
      rows.push(entry('scene', { parent_id: ch.id, title: name, sort }));
      rows.push(entry('para', { parent_id: ch.id, text: '', content: null, sort: sort + 1024 }));
    } else if (count === 2) {
      if (!act) return;
      rows.push(entry('chapter', { parent_id: act.id, title: name || `${word(1, 'Chapter')} ${chapters.length + 1}`, sort: (act.chapters.at(-1)?.sort || 0) + 1 }));
    } else {
      const part = entry('act', { parent_id: this.owner.id, title: name || `${word(0, 'Part')} ${acts.length + 1}`, sort: (act?.sort || 0) + 1 });
      rows.push(part, entry('chapter', { parent_id: part.id, title: `${word(1, 'Chapter')} ${chapters.length + 1}`, sort: 1 }));
    }
    await putEntries(rows);
    this.hooks.changed(rows);
  }

  // ---------- column widths (Nov 20 2026) ----------
  // Drag the right edge of a column's heading to widen or narrow it; a
  // double-click on the edge (a tap on a phone) makes it wide and back. On a
  // phone wide is the screen beside the row names, and the grid slides the
  // column into place. Per script, per device.

  widths() { try { return JSON.parse(pref(`gridCols:${this.owner?.id}`, '{}')) || {}; } catch { return {}; } }
  colWidths(w = this.widths()) {
    let style = document.getElementById('gv-colw');
    if (!style) { style = document.createElement('style'); style.id = 'gv-colw'; document.head.append(style); }
    style.textContent = Object.entries(w).map(([k, px]) => `.gv-table [data-col="${CSS.escape(k)}"] { width: ${px}px; min-width: ${px}px; max-width: ${px}px; }`).join('\n');
  }
  setWidth(col, px) {
    const w = this.widths();
    if (px == null) delete w[col]; else w[col] = Math.round(px);
    setPref(`gridCols:${this.owner.id}`, JSON.stringify(w));
    this.colWidths(w);
  }
  wideWidth() {
    if (!this.touch.matches) return 520;
    const corner = this.el.querySelector('.gv-corner')?.offsetWidth || 0;
    return Math.max(200, (this.scrollEl?.clientWidth || window.innerWidth) - corner - 2);
  }
  toggleWide(th, col) {
    const wide = this.wideWidth();
    const now = th.offsetWidth;
    this.setWidth(col, now >= wide - 4 ? null : wide);
    if (this.touch.matches && this.scrollEl && now < wide - 4) {
      const corner = this.el.querySelector('.gv-corner')?.offsetWidth || 0;
      requestAnimationFrame(() => this.scrollEl.scrollTo({ left: th.offsetLeft - corner, behavior: 'smooth' }));
    }
  }
  grip(th, col) {
    const g = make('span', 'gv-colgrip');
    g.setAttribute('role', 'separator');
    g.setAttribute('aria-orientation', 'vertical');
    g.setAttribute('aria-label', 'Drag to change the column’s width');
    g.title = this.touch.matches ? '' : 'Drag to change the width. Double-click: wide, and back.';
    let start = null;
    g.addEventListener('mousedown', (e) => e.preventDefault()); // not a drag of the whole column
    g.addEventListener('click', (e) => e.stopPropagation());
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      g.setPointerCapture(e.pointerId);
      start = { x: e.clientX, w: th.offsetWidth, moved: false };
      document.body.classList.add('gv-resizing');
    });
    g.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      if (Math.abs(dx) > 3) start.moved = true;
      if (!start.moved) return;
      const w = Math.max(110, Math.min(1000, start.w + dx));
      const all = this.widths();
      this.colWidths({ ...all, [col]: w });
      start.now = w;
    });
    const end = () => {
      if (!start) return;
      const s0 = start;
      start = null;
      document.body.classList.remove('gv-resizing');
      if (s0.moved && s0.now) this.setWidth(col, s0.now);
      else if (this.touch.matches) this.toggleWide(th, col);
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
    g.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); this.toggleWide(th, col); });
    th.append(g);
  }

  // Lines under a cell's top line (planlines.js): "▸ N", and a tap opens
  // them in place. Cells always start folded, so rows stay short.
  linesIn(el, ownerId, summary) {
    import('./planlines.js').then(async ({ PlanLines, linesUnder }) => {
      if (!this.lines) this.lines = new PlanLines({ openRef: (id) => this.hooks.openRef?.(id) });
      return linesUnder(ownerId, summary);
    }).then((rows) => {
      if (!rows.length) return;
      const tog = make('button', 'gv-lines-tog', `▸ ${rows.length}`);
      tog.type = 'button';
      tog.setAttribute('aria-expanded', 'false');
      tog.title = `${rows.length === 1 ? 'The line' : `The ${rows.length} lines`} under it`;
      let sub = null;
      tog.addEventListener('click', async () => {
        if (sub) {
          await this.lines.drop(ownerId);
          sub.remove();
          sub = null;
          tog.textContent = `▸ ${rows.length}`;
          tog.setAttribute('aria-expanded', 'false');
          return;
        }
        ({ sub } = this.lines.mount(ownerId, { summary, folds: false }));
        el.append(sub);
        tog.textContent = `▾ ${rows.length}`;
        tog.setAttribute('aria-expanded', 'true');
      });
      el.append(tog);
    }).catch(() => {});
  }

  // ---------- writing ----------

  newNote(td, r, t) {
    const n = entry('note', { parent_id: r.id, type: this.hooks.noteType(), fields: { thread: t.id, ...(r.chapterId ? { chapter_id: r.chapterId } : {}) } });
    n.unsaved = true;
    n.sort = Date.now();
    const el = this.noteEl(n, r, t);
    td.append(el);
    el.querySelector('.gv-text').focus();
  }

  saveNote(n, text) {
    n.text = text;
    clearTimeout(this.saveTimers.get(n.id));
    this.saveTimers.set(n.id, setTimeout(() => this.writeNote(n), 400));
  }

  async writeNote(n) {
    clearTimeout(this.saveTimers.get(n.id));
    this.saveTimers.delete(n.id);
    const text = (n.text || '').trim();
    if (!text && n.unsaved) return;
    const { unsaved: _u, ...row } = n;
    n.unsaved = false;
    const fresh = (await getEntry(n.id)) || row;
    await putEntries([{ ...fresh, text: n.text, tags: tagsIn(n.text), deleted: false, updated_at: Date.now() }]);
    this.hooks.changed([fresh]);
  }

  async doneNote(n, text) {
    n.text = text;
    if (!text.trim()) {
      // Emptied: gone, without redrawing (a click may be starting another note).
      clearTimeout(this.saveTimers.get(n.id));
      this.el.querySelector(`.gv-note[data-note="${CSS.escape(n.id)}"]`)?.remove();
      if (!n.unsaved) {
        const fresh = await getEntry(n.id);
        if (fresh) await putEntries([{ ...fresh, deleted: true, updated_at: Date.now() }]);
        this.hooks.changed([fresh]);
      }
      return;
    }
    await this.writeNote(n);
    // Redraw (the thread may no longer go quiet here), unless another cell is being typed in.
    this.refresh();
  }

  async saveSummary(r, text) {
    if ((r.synopsis || '') === text) return;
    const fresh = await getEntry(r.id);
    if (!fresh) return;
    const { synopsis: _s, ...fields } = fresh.fields || {};
    const rows = [{ ...fresh, fields: text ? { ...fields, synopsis: text } : fields, updated_at: Date.now() }];
    // A Woven scene's older summary on its title section was joined into this one.
    const old = r.clearSynopsis && (await getEntry(r.clearSynopsis));
    if (old?.fields?.synopsis) { const { synopsis: _o, ...f } = old.fields; rows.push({ ...old, fields: f, updated_at: Date.now() }); r.clearSynopsis = null; }
    await putEntries(rows);
    r.synopsis = text;
    this.hooks.changed([fresh]);
    if (this.stale) this.render();
  }

  async setBeat(n, beat) {
    const fresh = await getEntry(n.id);
    if (!fresh) return;
    const { beat: _b, ...fields } = fresh.fields || {};
    await putEntries([{ ...fresh, fields: beat ? { ...fields, beat } : fields, updated_at: Date.now() }]);
    this.hooks.changed([fresh]);
    await this.render();
  }

  async moveNote(n, r, t) {
    const fresh = await getEntry(n.id);
    if (!fresh) return;
    const { chapter_id: _c, ...fields } = fresh.fields || {};
    await putEntries([{ ...fresh, parent_id: r.id, fields: { ...fields, thread: t.id, ...(r.chapterId ? { chapter_id: r.chapterId } : {}) }, updated_at: Date.now() }]);
    this.hooks.changed([fresh, { id: r.id, parent_id: r.chapterId }]);
    await this.render();
  }

  async removeNote(n) {
    const fresh = await getEntry(n.id);
    if (!fresh) return;
    await putEntries([{ ...fresh, deleted: true, updated_at: Date.now() }]);
    this.hooks.changed([fresh]);
    await this.render();
    this.hooks.toast('Note deleted', { label: 'Undo', run: async () => { await putEntries([{ ...fresh, deleted: false, updated_at: Date.now() }]); this.hooks.changed([fresh]); this.render(); } });
  }

  // ---------- moving rows ----------

  dropTarget(tr, target) {
    if (this.touch.matches) return;
    tr.addEventListener('dragover', (e) => {
      if (!this.dragging?.row) return;
      if (target.row && target.row.id === this.dragging.row.id) return;
      e.preventDefault();
      const below = target.row && e.offsetY > tr.offsetHeight / 2;
      tr.classList.toggle('drop-before', !below);
      tr.classList.toggle('drop-after', !!below);
    });
    tr.addEventListener('dragleave', () => tr.classList.remove('drop-before', 'drop-after'));
    tr.addEventListener('drop', async (e) => {
      if (!this.dragging?.row) return;
      e.preventDefault();
      const after = tr.classList.contains('drop-after');
      tr.classList.remove('drop-before', 'drop-after');
      const moving = this.dragging.row;
      this.dragging = null;
      await this.moveRow(moving, target, after);
    });
  }

  // Moves a row before or after another row (or to the top of a group), and
  // with it what it stands for in the manuscript.
  async moveRow(r, target, after = false) {
    if (!r.movable || (target.row && target.row.id === r.id)) return;
    await this.hooks.beforeMove?.();
    let changed = [];
    const t = target.row || null;
    const g = target.group || null;
    if (r.kind === 'piece') {
      if (!t) return;
      const parent = (await getEntry(t.id))?.parent_id;
      changed = await placeAmong(r.id, parent, 'project', after ? { after: t.id } : { before: t.id });
    } else if (r.kind === 'act') {
      if (!t) return;
      changed = await placeAmong(r.id, this.owner.id, 'act', after ? { after: t.id } : { before: t.id });
    } else if (r.kind === 'chapter') {
      if (t) changed = await placeAmong(r.id, (await getEntry(t.id)).parent_id, 'chapter', after ? { after: t.id } : { before: t.id });
      else if (g?.kind === 'act') changed = await placeAmong(r.id, g.id, 'chapter', {});
    } else {
      // A stretch of the text: a scene, a section with everything in it, a
      // scene heading with its lines.
      if (t) {
        const span = t.span?.length ? t.span : t.members.filter((id) => id !== t.chapterId);
        const first = async () => (await children(t.chapterId)).find((x) => TEXT.includes(x.kind))?.id || null;
        if (after) changed = await placeSpan(r.span, t.chapterId, span.length ? { after: span.at(-1) } : { before: await first() });
        else changed = await placeSpan(r.span, t.chapterId, { before: span[0] || (await first()) });
      } else if (g) {
        // Onto a heading: first in its group.
        if (g.kind === 'chapter') { const first = (await children(g.id)).find((x) => TEXT.includes(x.kind)); changed = await placeSpan(r.span, g.id, first ? { before: first.id } : {}); }
        else changed = await placeSpan(r.span, g.chapterId, { after: g.id });
      }
    }
    if (changed.length) {
      this.hooks.changed(changed);
      this.hooks.toast(`Moved “${r.title}”`);
    }
    await this.render();
  }

  // Up or down one row, for the keyboard and phones (no dragging there).
  async nudge(r, i, dir) {
    const other = this.rows[i + dir];
    if (!other) return;
    return this.moveRow(r, { row: other }, dir > 0);
  }

  async moveThread(id, beforeId) {
    const list = await threadsOf(this.world);
    const me = list.find((t) => t.id === id);
    const rest = list.filter((t) => t.id !== id);
    const at = rest.findIndex((t) => t.id === beforeId);
    const order = [...rest.slice(0, at), me, ...rest.slice(at)];
    const sorts = placeSorts(order.map((t) => (t.id === id ? undefined : t.sort)));
    const now = Date.now();
    await putEntries(order.filter((t, i) => t.id === id || t.sort !== sorts[i]).map((t) => ({ ...t, sort: sorts[order.indexOf(t)], updated_at: now })));
    await this.render();
  }

  // ---------- menus ----------

  rowMenu(r, i) {
    return [
      { label: 'Open in the text', run: () => this.hooks.open(r) },
      r.movable && i > 0 && { label: 'Move up', run: () => this.nudge(r, i, -1) },
      r.movable && i < this.rows.length - 1 && { label: 'Move down', run: () => this.nudge(r, i, 1) },
      ['chapter', 'act', 'piece'].includes(r.kind) && { label: 'Rename…', run: async () => {
        const name = await this.hooks.askText({ title: 'Rename', value: r.title });
        if (!name) return;
        const fresh = await getEntry(r.id);
        await putEntries([{ ...fresh, title: name, updated_at: Date.now() }]);
        this.hooks.changed([fresh]);
        this.render();
      } }
    ].filter(Boolean);
  }

  noteMenu(n, r, t) {
    const now = n.fields?.beat || null;
    const state = this.promises.get(n.id);
    return [
      { label: 'Just a note', current: !now, run: () => this.setBeat(n, null) },
      ...BEATS.map((b) => ({ label: `${b.mark}  ${b.label}`, current: now === b.id, run: () => this.setBeat(n, b.id) })),
      state && { note: state.paid ? 'Paid off later in the story' : 'Not paid off yet' },
      { label: 'Move to another row…', run: () => this.pickRow(r, (to) => this.moveNote(n, to, t)) },
      this.threads.length > 1 && { label: 'Move to another thread…', run: () => this.pickThread(t, (to) => this.moveNote(n, r, to)) },
      { label: 'Delete', danger: true, run: () => this.removeNote(n) }
    ].filter(Boolean);
  }

  pickRow(from, then) {
    const anchor = this.el.querySelector(`tr[data-id="${CSS.escape(from.id)}"] .gv-open`) || this.el;
    this.hooks.menu(anchor, this.rows.filter((x) => x.id !== from.id).map((x) => ({ label: x.title, run: () => then(x) })));
  }

  pickThread(from, then) {
    const anchor = this.el.querySelector(`th[data-thread="${CSS.escape(from.id)}"] .gv-tname`) || this.el;
    this.hooks.menu(anchor, this.threads.filter((x) => x.id !== from.id).map((x) => ({ label: x.title, run: () => then(x) })));
  }

  threadMenu(t) {
    return [
      { label: 'Rename…', run: async () => {
        const name = await this.hooks.askText({ title: 'Rename the thread', value: t.title });
        if (!name) return;
        const fresh = await getEntry(t.id);
        await putEntries([{ ...fresh, title: name, updated_at: Date.now() }]);
        this.render();
      } },
      { label: `Tag: ${t.fields?.tag ? `#${t.fields.tag}` : 'none'}…`, run: async () => {
        const got = await this.hooks.askText({ title: 'The thread’s tag', body: 'Lines and notes in the text with this #tag show in the thread’s column.', value: t.fields?.tag || tagFor(t.title) });
        if (got === null || got === undefined) return;
        const fresh = await getEntry(t.id);
        await putEntries([{ ...fresh, fields: { ...fresh.fields, tag: tagFor(got.replace(/^#/, '')) }, updated_at: Date.now() }]);
        this.render();
      } },
      { label: 'Fill in from the draft, with Claude', run: () => this.fillThread(t) },
      { label: 'Hide from this grid', run: () => this.setHidden(t.id, true) },
      { label: 'Delete the thread…', danger: true, run: () => this.deleteThread(t) }
    ];
  }

  async setHidden(id, on) {
    const fresh = await getEntry(this.owner.id);
    const set = new Set(fresh.fields?.gridHide || []);
    if (on) set.add(id); else set.delete(id);
    await putEntries([{ ...fresh, fields: { ...fresh.fields, gridHide: [...set] }, updated_at: Date.now() }]);
    this.hooks.changed([fresh]);
    await this.render();
  }

  async deleteThread(t) {
    const notes = (await byKind('note')).filter((n) => n.fields?.thread === t.id);
    const ok = await this.hooks.ask({
      title: `Delete the thread “${t.title}”?`,
      body: notes.length ? `Its ${notes.length} note${notes.length === 1 ? '' : 's'} stay where they are in the text, as ordinary notes.` : 'It has no notes yet.',
      ok: 'Delete the thread',
      danger: true
    });
    if (!ok) return;
    const now = Date.now();
    const fresh = await getEntry(t.id);
    await putEntries([{ ...fresh, deleted: true, updated_at: now }, ...notes.map((n) => { const { thread: _t, beat: _b, ...fields } = n.fields || {}; return { ...n, fields, updated_at: now }; })]);
    this.hooks.changed(notes);
    await this.render();
  }

  async addThread(anchor) {
    const items = [
      { label: 'New thread…', run: async () => {
        const name = await this.hooks.askText({ title: 'New thread', body: 'A character’s journey, a plot line, a mystery, a romance: anything you want to follow down the story.', placeholder: 'Monk’s vow', ok: 'Add' });
        if (!name) return;
        if (!this.world) { this.hooks.toast('This piece isn’t in a world yet, so it can’t have threads.'); return; }
        await newThread(this.world, name);
        await this.render();
      } },
      ...this.hiddenThreads.map((t) => ({ label: `Show “${t.title}”`, run: () => this.setHidden(t.id, false) }))
    ];
    if (items.length === 1) return items[0].run();
    this.hooks.menu(anchor, items);
  }

  moreMenu() {
    const hide = new Set(JSON.parse(pref('gridHideCols', '[]')));
    const flip = (k) => { if (hide.has(k)) hide.delete(k); else hide.add(k); setPref('gridHideCols', JSON.stringify([...hide])); this.render(); };
    return [
      { label: hide.has('summary') ? 'Show the summary column' : 'Hide the summary column', run: () => flip('summary') },
      { label: hide.has('gaps') ? 'Show where threads go quiet' : 'Hide where threads go quiet', run: () => flip('gaps') },
      { label: 'Ask Claude: any promises not paid off?', run: () => this.checkPromises() }
    ];
  }
}
