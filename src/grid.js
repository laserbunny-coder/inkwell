import { getEntry, children, putEntries, byKind } from './db.js';
import { entry, newId, tagsIn, outline } from './model.js';
import { placeSorts } from './order.js';
import { SECTION_NAMES, sectionName } from './schema.js';
import { bookType, hasManuscript, kindName, worldOf, piecesIn } from './library.js';

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
  if (type === 'screenplay' && info.hasManuscript) {
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
  for (const act of acts) for (const ch of act.chapters) for (const r of ch.rows) if (r.kind === 'scene') deepest = Math.max(deepest, r.fields?.level || 1);
  const labels = [...new Set(pieces.map((p) => kindName(p)))];
  return {
    acts,
    pieces,
    hasManuscript: acts.some((a) => a.chapters.length),
    deepest,
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
    const paid = beats.find((x) => x.thread === b.thread && x.beat === 'payoff' && x.at >= b.at);
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

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
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
    this.touch = matchMedia('(hover: none)');
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
    const st = await loadStructure(owner);
    const levels = levelsFor(owner, st);
    const wanted = pref(LEVEL_KEY(owner.id), null);
    const fallback = levels.find((l) => l.id === 'chapter') || levels.filter((l) => /^s\d$/.test(l.id)).at(-1) || levels[0];
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
    hr.append(th0, Object.assign(make('th', 'gv-sumh', 'Summary'), { scope: 'col' }));
    this.threads.forEach((t) => hr.append(this.threadHead(t)));
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
    const empty = !this.rows.length ? make('p', 'hint gv-empty', 'No rows at this level yet.') : null;
    const read = this.claudePanel();
    const hint = !this.threads.length && this.rows.length ? make('p', 'hint gv-hint', 'Add a thread for each thing you want to follow down the story: a character’s journey, a mystery, a romance. A blank run in a column shows where a thread was dropped.') : null;
    this.el.replaceChildren(...[head, sub, read, scroll, empty, hint].filter(Boolean));
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
    const name = make('button', 'gv-tname', t.title || 'Untitled');
    name.type = 'button';
    name.title = t.fields?.tag ? `#${t.fields.tag}` : '';
    name.addEventListener('click', () => this.hooks.menu(name, this.threadMenu(t)));
    name.addEventListener('contextmenu', (e) => { e.preventDefault(); this.hooks.menu(name, this.threadMenu(t)); });
    th.append(name);
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
    const text = make('div', 'gv-text', r.synopsis || '');
    text.contentEditable = 'plaintext-only';
    text.dataset.placeholder = 'What happens';
    text.setAttribute('aria-label', `Summary of ${r.title}`);
    text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); text.blur(); } if (e.key === 'Escape') { text.textContent = r.synopsis || ''; text.blur(); } });
    text.addEventListener('blur', () => this.saveSummary(r, text.textContent.trim()));
    sum.append(text);
    tr.append(sum);

    for (const t of this.threads) tr.append(this.cellEl(r, i, t));
    tr.append(make('td', 'gv-pad'));
    if (r.movable) this.dropTarget(tr, { row: r });
    return tr;
  }

  cellEl(r, i, t) {
    const td = make('td', 'gv-cell');
    td.dataset.thread = t.id;
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
    return box;
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
    await putEntries([{ ...fresh, fields: text ? { ...fields, synopsis: text } : fields, updated_at: Date.now() }]);
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
