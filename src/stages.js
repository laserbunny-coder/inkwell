import { getEntry, children, putEntries, byKind, byTag, linkedFrom } from './db.js';
import { entry, newId, tagsIn, outline } from './model.js';
import { GAP, bySort } from './order.js';
import {
  worldOf, piecesIn, worldTree, worldStats, dailyMentions, stats, hasManuscript, bookType, kindName,
  STAGES, stageOf, isOut, isReady, ago, newPage, pagesIn
} from './library.js';
import { worldPromises } from './grid.js';
import { elementsIn, ELEMENT_TYPES, typeOf, shootDays } from './production.js';
import { shareId, commentsOn } from './sharelink.js';
import { isLife, hasLineDrag, lineDragId, lineWords } from './pages.js';

// The pages that aren't one of the older views: Gather, Shape, Write, Revise,
// Make, Deliver and Notes at the size of a world, the piece-sized Gather,
// Shape (the Develop page) and Revise, and the Drawer on the desk.
//
// Gather is everything in and nothing decided. Shape is canon. Moving a thing
// from one to the other is "File into…": it lands on a bible page (or a
// piece's notes) as a mirror of the original, so editing either edits both,
// and the original shows where it went. "Go through" takes them one at a
// time, with Claude's guess at a home; nothing moves without a tap.
//
// The Drawer is ideas with no home yet (#drawer). Pulling one into a world
// links it there rather than moving it: one idea can feed many things.

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};
const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* full */ } };
const plural = (n, w, many = `${w}s`) => `${n.toLocaleString()} ${n === 1 ? w : many}`;
const titleOfDay = (day) => {
  const [y, m, d] = (day.id || '').slice(4).split('-').map(Number);
  return y ? new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : day.title || '';
};
const snip = (s, n = 160) => { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const textOf = (content) => (content || []).map((n) => (n.type === 'text' ? n.text : n.type === 'entryRef' ? n.attrs?.title || '' : '')).join('');
const gone = (r) => !r || r.deleted || r.fields?.trashed;

export const SHAPE_WORLD = [
  { id: 'bible', label: 'Bible' },
  { id: 'arcs', label: 'Arcs' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'ties', label: 'Relationships' },
  { id: 'promises', label: 'Promises' }
];
export const SHAPE_PIECE = [
  { id: 'develop', label: 'Develop' },
  { id: 'grid', label: 'Plot grid' }
];
export const MAKE_WORLD = [
  { id: 'board', label: 'Stage board' },
  { id: 'kit', label: 'Kit' },
  { id: 'days', label: 'Shoot days' }
];
// The steps of the Develop page, small to big (the snowflake, loosely).
export const DEVELOP = [
  { id: 'sentence', label: 'One sentence', hint: 'The whole thing in a line: who, what they want, what’s in the way.' },
  { id: 'paragraph', label: 'One paragraph', hint: 'Set-up, three turns, how it ends.' },
  { id: 'people', label: 'Who’s in it', hint: 'For each one: what they want, what stops them, what they learn.' },
  { id: 'page', label: 'One page', hint: 'The paragraph grown to a page: each turn becomes a few lines.' }
];
const DRAWER = 'drawer';

// A small dialog with a few fields. Resolves { key: value } or null.
function askForm({ title, body = '', fields, ok = 'Save' }) {
  return new Promise((resolve) => {
    const back = make('div', 'ask-backdrop');
    const box = make('form', 'ask st-form');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.append(make('h2', '', title));
    if (body) box.append(make('p', '', body));
    const inputs = fields.map((f, i) => {
      const label = make('label', 'st-form-field');
      label.append(make('span', 'panel-label', f.label));
      const input = make('input', 'ask-input');
      input.value = f.value || '';
      input.placeholder = f.placeholder || '';
      input.name = f.key;
      input.autocomplete = 'off';
      if (f.list?.length) {
        const dl = make('datalist');
        dl.id = `st-list-${Date.now()}-${i}`;
        dl.append(...f.list.map((v) => Object.assign(make('option'), { value: v })));
        input.setAttribute('list', dl.id);
        label.append(dl);
      }
      label.append(input);
      box.append(label);
      return input;
    });
    const row = make('div', 'ask-actions');
    const no = make('button', 'ghost-btn', 'Cancel');
    const yes = make('button', 'pill primary', ok);
    yes.type = 'submit';
    row.append(no, yes);
    box.append(row);
    back.append(box);
    document.body.append(back);
    const done = (v) => { back.remove(); resolve(v); };
    no.addEventListener('click', () => done(null));
    box.addEventListener('submit', (e) => { e.preventDefault(); done(Object.fromEntries(inputs.map((x) => [x.name, x.value.trim()]))); });
    back.addEventListener('pointerdown', (e) => { if (e.target === back) done(null); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } });
    inputs[0]?.focus();
  });
}

// ---------- filing: Gather into canon ----------

// Where things in a world can be filed: its bible pages and its pieces.
export async function homesIn(world) {
  const { pages, pieces } = await worldTree(world.id);
  return [
    ...pages.filter(({ row }) => !gone(row)).map(({ row, depth }) => ({ id: row.id, title: row.title || 'Untitled page', kind: 'page', depth })),
    ...pieces.filter(({ row }) => !gone(row)).map(({ row, depth }) => ({ id: row.id, title: row.title || 'Untitled', kind: 'piece', depth }))
  ];
}

// The page in a piece that filed things go on: its Idea or Notes page, made if there's neither.
async function notesPageOf(piece) {
  const pages = await pagesIn(piece.id);
  const found = pages.find((p) => /^(idea|ideas|notes)$/i.test((p.title || '').trim()));
  return found || newPage(piece.id, 'Notes');
}

// Puts a line on a page as a mirror of itself (the same words, editable in
// either place), and marks the original with where it went. Returns the rows.
export async function fileInto(lineId, targetId) {
  const src = await getEntry(lineId);
  let target = await getEntry(targetId);
  if (gone(src) || gone(target)) return [];
  if (target.kind === 'project') target = await notesPageOf(target);
  const kids = await children(target.id);
  if (kids.some((k) => k.fields?.mirror === src.id)) return [];
  const sort = kids.length ? Math.max(...kids.map((k) => k.sort || 0)) + GAP : GAP;
  const mirror = entry('line', {
    id: newId('li'), parent_id: target.id, sort, text: src.text || '', content: src.content || [], tags: [], links: src.links || [],
    fields: { done: false, gather: null, gathered: null, mirror: src.id, filed: true }
  });
  const filed = [...new Set([...(src.fields?.filed || []), target.id])];
  const marked = { ...src, fields: { ...src.fields, filed, letgo: false }, updated_at: Date.now() };
  await putEntries([mirror, marked]);
  return [mirror, marked, target];
}

// Takes a filing back: the mirror goes, the original forgets it went there.
export async function unfile(lineId, pageId) {
  const src = await getEntry(lineId);
  const rows = [];
  for (const k of await children(pageId)) if (k.fields?.mirror === lineId) rows.push({ ...k, deleted: true, updated_at: Date.now() });
  if (src) rows.push({ ...src, fields: { ...src.fields, filed: (src.fields?.filed || []).filter((x) => x !== pageId) }, updated_at: Date.now() });
  await putEntries(rows);
  return rows;
}

// Let go: out of Gather, but kept where it was written.
export async function letGo(lineId, on = true) {
  const src = await getEntry(lineId);
  if (!src) return [];
  const row = { ...src, fields: { ...src.fields, letgo: on }, updated_at: Date.now() };
  await putEntries([row]);
  return [row];
}

// ---------- the drawer ----------

const hasDrawerTag = (r) => (r.tags || []).includes(DRAWER);

// Into the drawer: a #drawer tag at the end of the line.
export async function intoDrawer(lineId) {
  const r = await getEntry(lineId);
  if (!r || hasDrawerTag(r)) return [];
  const content = [...(r.content || []), { type: 'text', text: ` #${DRAWER}` }];
  const text = textOf(content);
  const row = { ...r, content, text, tags: tagsIn(text), updated_at: Date.now() };
  await putEntries([row]);
  return [row];
}

// Out of the drawer: the #drawer tag comes off (the rest of the line stays).
export async function outOfDrawer(lineId) {
  const r = await getEntry(lineId);
  if (!r) return [];
  const strip = (s) => s.replace(/\s*#drawer\b/gi, '');
  const content = (r.content || []).map((n) => (n.type === 'text' ? { ...n, text: strip(n.text) } : n)).filter((n) => n.type !== 'text' || n.text);
  const text = textOf(content);
  const row = { ...r, content, text, tags: tagsIn(text), updated_at: Date.now() };
  await putEntries([row]);
  return [row];
}

export async function drawerItems() {
  return (await byTag(DRAWER)).filter((r) => r.kind === 'line' && !gone(r) && !r.fields?.done).sort((a, b) => b.created_at - a.created_at);
}

// Pulling an idea in from the drawer links it to the world (it stays in the drawer).
export async function pullInto(lineId, worldId, on = true) {
  const r = await getEntry(lineId);
  if (!r) return [];
  const pulled = new Set(r.fields?.pulled || []);
  if (on) pulled.add(worldId); else pulled.delete(worldId);
  const row = { ...r, fields: { ...r.fields, pulled: [...pulled] }, updated_at: Date.now() };
  await putEntries([row]);
  return [row];
}

// ---------- what's in a world ----------

// Everything that's come in for a world or piece: lines on day pages that
// link to it (or anything in it), and ideas pulled in from the drawer.
export async function gatherItems(owner) {
  const items = new Map();
  for (const { row, day } of await dailyMentions(owner, 400)) items.set(row.id, { row, from: titleOfDay(day), dayId: day.id });
  const world = owner.kind === 'world' ? owner : await worldOf(owner);
  for (const r of await drawerItems()) {
    if ((r.fields?.pulled || []).includes(owner.id) || (world && (r.fields?.pulled || []).includes(world.id) && owner.kind === 'world')) {
      if (!items.has(r.id)) items.set(r.id, { row: r, from: 'From the drawer', drawer: true });
    }
  }
  return [...items.values()].sort((a, b) => b.row.created_at - a.row.created_at);
}

// A piece's words, as plain text, for Claude to read (up to a limit).
export async function pieceText(piece, limit = 12000) {
  if (!hasManuscript(piece)) return '';
  const out = [];
  let n = 0;
  for (const act of await outline(piece.id)) {
    for (const ch of act.chapters) {
      for (const r of await children(ch.id)) {
        const t = r.kind === 'scene' ? r.title || r.text || '' : r.text || '';
        if (!t.trim()) continue;
        out.push(t);
        n += t.length;
        if (n > limit) return out.join('\n').slice(0, limit);
      }
    }
  }
  return out.join('\n');
}

// A bible page's lines, as plain text.
async function pageText(page, limit = 1500) {
  const out = [];
  const walk = async (pid, depth) => {
    for (const r of await children(pid)) {
      if (r.kind !== 'line') continue;
      out.push(`${'  '.repeat(depth)}${r.text || ''}`);
      if (depth < 3) await walk(r.id, depth + 1);
    }
  };
  await walk(page.id, 0);
  return out.join('\n').slice(0, limit);
}

// The characters in a world: elements that are characters, else pages under a "Characters" page.
export async function charactersIn(world) {
  const els = (await elementsIn(world)).filter((e) => (e.fields?.element?.type || 'other') === 'character');
  if (els.length) return els;
  const { pages } = await worldTree(world.id);
  const cast = pages.find(({ row }) => /^(characters|cast|people)$/i.test((row.title || '').trim()))?.row;
  return cast ? pages.map(({ row }) => row).filter((p) => p.parent_id === cast.id) : [];
}

export async function tiesIn(world) {
  return (await children(world.id)).filter((r) => r.kind === 'tie' && !gone(r));
}
export async function eventsIn(world) {
  return (await children(world.id)).filter((r) => r.kind === 'event' && !gone(r)).sort(bySort);
}

// ---------- the view ----------

export class StagePage {
  // hooks: go(place), openEntry(id), openBook(id), menu(anchor, items),
  // menuButton(fn, label), ask, askText, toast, askServer, canAsk,
  // changed(rows), board(el, world, pieces), revise(action, piece),
  // newPage(parentId), newPiece(parentId), sendTask(task), base()
  constructor(el, hooks) {
    this.el = el;
    this.hooks = hooks;
    this.place = null;
    this.busy = Promise.resolve();
    this.walk = null;
    this.timers = new Map();
    this.suggest = new Map();
  }

  get isOpen() { return !!this.place && ['stage', 'drawer'].includes(document.documentElement.dataset.view); }

  async show(place) {
    if (JSON.stringify([place.id, place.page]) !== JSON.stringify([this.place?.id, this.place?.page])) this.walk = null;
    this.place = { ...place };
    if (place.sub) setPref(`sub:${place.page}:${this.scopeOf(place)}`, place.sub);
    return this.render();
  }

  scopeOf(place) { return place.view === 'drawer' ? 'desk' : place.scope || 'world'; }

  refresh() {
    if (!this.place) return this.busy;
    const a = document.activeElement;
    if (this.el.contains(a) && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) { this.stale = true; return this.busy; }
    return this.render();
  }

  render() {
    this.busy = this.busy.then(() => this.draw()).catch((e) => console.error(e));
    return this.busy;
  }

  async draw() {
    this.stale = false;
    const p = this.place;
    if (p.view === 'drawer') return this.drawDrawer();
    const owner = await getEntry(p.id);
    if (gone(owner)) return this.hooks.go({ view: 'library' });
    this.owner = owner;
    this.world = owner.kind === 'world' ? owner : await worldOf(owner);
    this.scope = owner.kind === 'world' ? 'world' : 'piece';
    const page = p.page;
    const head = make('div', 'st-head');
    const title = make('h1', 'st-title', owner.title || 'Untitled');
    const where = make('span', 'st-page', { gather: 'Gather', shape: 'Shape', write: 'Write', revise: 'Revise', make: 'Make', deliver: 'Deliver', notes: 'Notes' }[page] || '');
    head.append(where, title);
    const body = make('div', 'st-body');
    body.dataset.page = page;
    this.el.replaceChildren(head, body);
    if (page === 'gather') await this.drawGather(body);
    else if (page === 'shape' && this.scope === 'world') await this.drawShapeWorld(body);
    else if (page === 'shape') await this.drawShapePiece(body);
    else if (page === 'write') await this.drawWriteWorld(body);
    else if (page === 'revise') await this.drawRevise(body);
    else if (page === 'make') await this.drawMakeWorld(body);
    else if (page === 'deliver') await this.drawDeliverWorld(body);
    else if (page === 'notes') await this.drawNotes(body);
  }

  chips(list, current, pick) {
    const row = make('div', 'gv-levels st-chips');
    row.setAttribute('role', 'tablist');
    for (const c of list) {
      const b = make('button', 'chip' + (c.id === current ? ' on' : ''), c.label);
      b.setAttribute('role', 'tab');
      b.dataset.sub = c.id;
      b.setAttribute('aria-selected', String(c.id === current));
      b.addEventListener('click', () => pick(c.id));
      row.append(b);
    }
    return row;
  }

  sub(list, fallback) {
    const k = `sub:${this.place.page}:${this.scope}`;
    const v = this.place.sub || pref(k, fallback);
    return list.some((c) => c.id === v) ? v : fallback;
  }

  pickSub(id) { this.place.sub = id; setPref(`sub:${this.place.page}:${this.scope}`, id); this.hooks.remember?.(this.place); this.render(); }

  async changed(rows) { await this.hooks.changed(rows.filter(Boolean)); }

  // ---------- Gather ----------

  async drawGather(body) {
    const items = await gatherItems(this.owner);
    this.items = items;
    const open = items.filter(({ row }) => !(row.fields?.filed || []).length && !row.fields?.letgo);
    const filed = items.filter(({ row }) => (row.fields?.filed || []).length);
    const letgo = items.filter(({ row }) => row.fields?.letgo && !(row.fields?.filed || []).length);
    const show = this.sub([{ id: 'open' }, { id: 'filed' }, { id: 'all' }], 'open');
    const top = make('div', 'st-tools');
    top.append(this.chips([
      { id: 'open', label: `To file${open.length ? ` · ${open.length}` : ''}` },
      { id: 'filed', label: `Filed${filed.length ? ` · ${filed.length}` : ''}` },
      { id: 'all', label: 'All' }
    ], show, (id) => this.pickSub(id)));
    if (open.length) {
      const go = make('button', 'pill', 'Go through');
      go.title = 'One at a time: file it, put it in the drawer, or let it go';
      go.addEventListener('click', () => this.startWalk(open));
      top.append(go);
    }
    body.append(top);
    if (this.walk) { await this.drawWalk(body); return; }

    const list = show === 'open' ? open : show === 'filed' ? filed : [...open, ...filed, ...letgo];
    const ul = make('ul', 'st-cards');
    for (const it of list) ul.append(await this.card(it));
    body.append(ul);
    if (!list.length) {
      body.append(make('p', 'hint st-empty', show === 'open'
        ? (items.length ? 'Everything here has a home. New lines that link here with [[ show up on their own.' : `Nothing in yet. On any day page, link a line to ${this.owner.title || 'this'} with [[ and it lands here. Ideas from the Drawer can be pulled in too.`)
        : 'Nothing filed yet.'));
    }
    // The drawer: ideas that may belong here, with Claude's picks first.
    if (this.scope === 'world') await this.drawFromDrawer(body);
  }

  async card(it) {
    const { row } = it;
    const li = make('li', 'st-card' + (row.fields?.letgo ? ' letgo' : ''));
    li.dataset.id = row.id;
    const from = make('button', 'st-from', it.from);
    from.title = 'Open where it was written';
    from.addEventListener('click', () => this.hooks.openEntry(row.id));
    const text = make('div', 'st-text');
    text.append(lineWords(row));
    li.append(from, text);
    const where = make('div', 'st-where');
    for (const id of row.fields?.filed || []) {
      const t = await getEntry(id);
      if (gone(t)) continue;
      const b = make('button', 'st-went', `→ ${t.title || 'Untitled'}`);
      b.title = 'Open the page it went to';
      b.addEventListener('click', () => this.hooks.go({ view: 'notebook', pageId: t.id }));
      where.append(b);
    }
    if (row.fields?.letgo) where.append(make('span', 'st-went faint', 'Let go'));
    const acts = make('div', 'st-acts');
    const file = make('button', 'ghost-btn st-file', 'File into…');
    file.addEventListener('click', async () => this.hooks.menu(file, await this.fileMenu(row)));
    acts.append(file);
    if (row.fields?.letgo) {
      const back = make('button', 'ghost-btn', 'Bring back');
      back.addEventListener('click', async () => { await this.changed(await letGo(row.id, false)); this.render(); });
      acts.append(back);
    }
    acts.append(this.hooks.menuButton(() => this.cardMenu(it), 'More'));
    li.append(where, acts);
    return li;
  }

  async fileMenu(row) {
    const homes = this.world ? await homesIn(this.world) : [];
    const pages = homes.filter((h) => h.kind === 'page');
    const pieces = homes.filter((h) => h.kind === 'piece');
    const pick = (h) => ({ label: `${'  '.repeat(h.depth || 0)}${h.title}`, current: (row.fields?.filed || []).includes(h.id), run: () => this.file(row.id, h.id) });
    return [
      ...(pages.length ? [{ label: this.world && isLife(this.world) ? 'Notes' : 'Bible', sub: pages.map(pick) }] : []),
      ...(pieces.length ? [{ label: 'A piece’s notes', sub: pieces.map(pick) }] : []),
      { label: 'A new page…', run: () => this.fileNew(row.id) },
      'sep',
      { label: hasDrawerTag(row) ? 'In the drawer' : 'The drawer (no home yet)', current: hasDrawerTag(row), run: async () => { await this.changed(await intoDrawer(row.id)); this.hooks.toast('In the drawer'); this.render(); } },
      { label: 'Let go (it stays on its day)', run: async () => { await this.changed(await letGo(row.id)); this.undoToast('Let go', async () => this.changed(await letGo(row.id, false))); this.render(); } }
    ];
  }

  cardMenu(it) {
    const { row } = it;
    return [
      { label: 'Open where it was written', run: () => this.hooks.openEntry(row.id) },
      ...(row.fields?.filed || []).map((id) => ({ label: 'Take it back off a page…', run: async () => { const t = await getEntry(id); const ok = await this.hooks.ask({ title: `Take it off “${t?.title || 'that page'}”?`, body: 'The copy on that page goes; the line stays where it was written.', ok: 'Take it off' }); if (ok) { await this.changed(await unfile(row.id, id)); this.render(); } } })),
      ...(it.drawer ? [{ label: 'Not for this world', run: async () => { await this.changed(await pullInto(row.id, this.owner.id, false)); this.render(); } }] : [])
    ];
  }

  async file(lineId, targetId) {
    const rows = await fileInto(lineId, targetId);
    if (!rows.length) { this.hooks.toast('It’s on that page already'); return; }
    await this.changed(rows);
    const target = rows[2];
    this.undoToast(`Filed into ${target.title || 'the page'}`, async () => this.changed(await unfile(lineId, target.id)), { label: 'Open', run: () => this.hooks.go({ view: 'notebook', pageId: target.id }) });
    if (this.walk) this.walk.i += 1;
    this.render();
  }

  async fileNew(lineId) {
    const title = await this.hooks.askText({ title: 'A new page for it', body: this.world ? `In ${this.world.title || 'the world'}’s ${isLife(this.world) ? 'notes' : 'bible'}.` : '', ok: 'Make it and file', value: '' });
    if (!title?.trim()) return;
    const page = await newPage((this.world || this.owner).id, title.trim());
    await this.changed([page]);
    await this.file(lineId, page.id);
  }

  undoToast(msg, undo, extra) {
    this.hooks.toast(msg, { label: 'Undo', run: async () => { await undo(); this.render(); } }, extra);
  }

  // ---------- Go through: one at a time ----------

  async startWalk(open) {
    this.walk = { ids: open.map((x) => x.row.id), i: 0, picks: new Map(), asking: false };
    await this.render();
    if (this.hooks.canAsk() && this.world) this.askHomes();
  }

  async askHomes() {
    const w = this.walk;
    if (!w) return;
    w.asking = true;
    try {
      const homes = await homesIn(this.world);
      const rows = (await Promise.all(w.ids.map((id) => getEntry(id)))).filter(Boolean);
      const out = await this.hooks.askServer({
        mode: 'pages', task: 'gather', world: this.world.title || '', life: isLife(this.world),
        homes: homes.map((h) => ({ id: h.id, title: h.title, kind: h.kind })),
        items: rows.map((r) => ({ id: r.id, text: snip(r.text, 600) }))
      });
      for (const p of out?.picks || []) w.picks.set(p.id, p);
    } catch (e) {
      console.warn(e);
    }
    w.asking = false;
    if (this.walk === w) this.render();
  }

  async drawWalk(body) {
    const w = this.walk;
    while (w.i < w.ids.length) {
      const r = await getEntry(w.ids[w.i]);
      if (r && !gone(r) && !(r.fields?.filed || []).length && !r.fields?.letgo && !(hasDrawerTag(r) && w.drawered?.has(r.id))) break;
      w.i += 1;
    }
    const box = make('div', 'st-walk');
    if (w.i >= w.ids.length) {
      box.append(make('p', 'st-walk-done', 'That’s all of them.'));
      const done = make('button', 'pill', 'Done');
      done.addEventListener('click', () => { this.walk = null; this.render(); });
      box.append(done);
      body.append(box);
      done.focus();
      return;
    }
    const row = await getEntry(w.ids[w.i]);
    const it = this.items.find((x) => x.row.id === row.id) || { row, from: '' };
    box.append(make('div', 'st-walk-n', `${w.i + 1} of ${w.ids.length}`));
    const from = make('button', 'st-from', it.from || '');
    from.addEventListener('click', () => this.hooks.openEntry(row.id));
    const words = make('p', 'st-walk-text');
    words.append(lineWords(row, 2000));
    box.append(from, words);
    const pick = w.picks.get(row.id);
    const homes = this.world ? await homesIn(this.world) : [];
    const home = pick && homes.find((h) => h.id === pick.home);
    const acts = make('div', 'st-walk-acts');
    if (home) {
      const b = make('button', 'pill primary', `File into ${home.title}`);
      b.addEventListener('click', () => this.file(row.id, home.id));
      acts.append(b);
    } else if (pick?.home === 'drawer') {
      const b = make('button', 'pill primary', 'Into the drawer');
      b.addEventListener('click', () => this.walkDrawer(row.id));
      acts.append(b);
    }
    const other = make('button', home ? 'ghost-btn' : 'pill', home ? 'Somewhere else…' : 'File into…');
    other.addEventListener('click', async () => this.hooks.menu(other, await this.fileMenu(row)));
    acts.append(other);
    if (pick?.home !== 'drawer') { const d = make('button', 'ghost-btn', 'Drawer'); d.addEventListener('click', () => this.walkDrawer(row.id)); acts.append(d); }
    const go = make('button', 'ghost-btn', 'Let go');
    go.addEventListener('click', async () => { await this.changed(await letGo(row.id)); w.i += 1; this.render(); });
    const skip = make('button', 'ghost-btn', 'Skip');
    skip.addEventListener('click', () => { w.i += 1; this.render(); });
    const stop = make('button', 'ghost-btn', 'Stop');
    stop.addEventListener('click', () => { this.walk = null; this.render(); });
    acts.append(go, skip, stop);
    box.append(acts);
    if (pick?.why) box.append(make('p', 'hint st-why', `Claude: ${pick.why}`));
    else if (w.asking) box.append(make('p', 'hint st-why', 'Claude is looking for a home for each…'));
    body.append(box);
    acts.querySelector('button')?.focus();
  }

  async walkDrawer(id) {
    await this.changed(await intoDrawer(id));
    (this.walk.drawered ||= new Set()).add(id);
    this.walk.i += 1;
    this.render();
  }

  async drawFromDrawer(body) {
    const all = await drawerItems();
    const fresh = all.filter((r) => !(r.fields?.pulled || []).includes(this.owner.id) && !(r.fields?.notFor || []).includes(this.owner.id));
    if (!fresh.length) return;
    const box = make('section', 'st-drawer-shelf');
    const head = make('div', 'ph-row');
    head.append(make('span', 'panel-label', 'From the drawer'));
    const key = this.owner.id;
    const sug = this.suggest.get(key);
    if (this.hooks.canAsk() && !sug) {
      const b = make('button', 'ghost-btn', 'Which fit here?');
      b.title = 'Claude reads the drawer and picks the ideas that could belong to this world';
      b.addEventListener('click', async () => {
        b.disabled = true;
        b.textContent = 'Claude is reading the drawer…';
        try {
          const out = await this.hooks.askServer({ mode: 'pages', task: 'drawer', world: this.owner.title || '', about: this.owner.fields?.logline || '', pieces: (await worldTree(this.owner.id)).pieces.map(({ row }) => row.title || '').slice(0, 40), items: fresh.slice(0, 200).map((r) => ({ id: r.id, text: snip(r.text, 300) })) });
          this.suggest.set(key, new Map((out?.fits || []).map((f) => [f.id, f.why || ''])));
        } catch (e) { this.hooks.toast(e.message || 'Couldn’t ask Claude. Try again.'); }
        this.render();
      });
      head.append(b);
    }
    box.append(head);
    const ul = make('ul', 'st-cards st-drawer-cards');
    const ordered = sug ? [...fresh.filter((r) => sug.has(r.id)), ...fresh.filter((r) => !sug.has(r.id))] : fresh;
    for (const r of ordered.slice(0, sug ? 30 : 8)) {
      const li = make('li', 'st-card' + (sug?.has(r.id) ? ' fits' : ''));
      li.dataset.id = r.id;
      const words = make('div', 'st-text');
      words.append(lineWords(r, 300));
      li.append(make('div', 'st-from', `Drawer · ${ago(r.created_at)}`), words);
      if (sug?.get(r.id)) li.append(make('p', 'hint st-why', `Claude: ${sug.get(r.id)}`));
      const acts = make('div', 'st-acts');
      const pull = make('button', 'ghost-btn', 'Pull in');
      pull.title = 'Link it to this world: it shows in Gather here, and stays in the drawer for anything else it could feed';
      pull.addEventListener('click', async () => { await this.changed(await pullInto(r.id, this.owner.id)); this.hooks.toast('Pulled in: it’s in Gather now, and still in the drawer'); this.render(); });
      acts.append(pull);
      if (sug?.has(r.id)) {
        const no = make('button', 'ghost-btn', 'Not for this');
        no.addEventListener('click', async () => { const row = await getEntry(r.id); const notFor = [...new Set([...(row.fields?.notFor || []), this.owner.id])]; const nr = { ...row, fields: { ...row.fields, notFor }, updated_at: Date.now() }; await putEntries([nr]); await this.changed([nr]); this.render(); });
        acts.append(no);
      }
      li.append(acts);
      ul.append(li);
    }
    box.append(ul);
    body.append(box);
  }

  // ---------- Shape: the world ----------

  async drawShapeWorld(body) {
    const sub = this.sub(SHAPE_WORLD, 'bible');
    body.append(this.chips(SHAPE_WORLD, sub, (id) => (id === 'arcs' ? this.hooks.go({ view: 'grid', id: this.owner.id }) : this.pickSub(id))));
    if (sub === 'bible' || sub === 'arcs') await this.drawBible(body);
    if (sub === 'timeline') await this.drawTimeline(body);
    if (sub === 'ties') await this.drawTies(body);
    if (sub === 'promises') await this.drawPromises(body);
  }

  async drawBible(body, label = 'Bible') {
    const w = this.owner;
    const { pages } = await worldTree(w.id);
    const head = make('div', 'ph-row');
    head.append(make('span', 'panel-label', label));
    const add = make('button', 'ghost-btn', '+ Page');
    add.addEventListener('click', () => this.hooks.newPage(w.id));
    head.append(add);
    body.append(head);
    const ul = make('ul', 'loose-list tree-list st-bible');
    for (const { row: p, depth } of pages) {
      const li = make('li');
      li.style.setProperty('--depth', depth);
      li.dataset.id = p.id;
      const open = make('button', 'loose-title', p.title || 'Untitled page');
      open.addEventListener('click', () => this.hooks.go({ view: 'notebook', pageId: p.id }));
      const el = p.fields?.element;
      li.append(open, make('span', 'when', el ? typeOf(el.type).label : ago(p.updated_at)));
      // A line from the Today panel dropped on a page is filed there.
      li.addEventListener('dragover', (e) => { if (hasLineDrag(e)) { e.preventDefault(); li.classList.add('drop'); } });
      li.addEventListener('dragleave', () => li.classList.remove('drop'));
      li.addEventListener('drop', async (e) => { li.classList.remove('drop'); const id = lineDragId(e); if (!id) return; e.preventDefault(); await this.file(id, p.id); });
      ul.append(li);
    }
    body.append(ul);
    if (!pages.length) body.append(make('p', 'hint', isLife(w) ? 'A page for each thing you work out: the options, who to call, what was decided.' : 'Characters, places, rules, running gags: a page for each, and pages inside pages. This is canon.'));
    else body.append(make('p', 'hint st-tip', 'Drag a line from the Today panel (Ctrl + Shift + J) onto a page to file it there.'));
  }

  async drawPromises(body) {
    const promises = await worldPromises(this.owner);
    const ul = make('ul', 'ref-list promise-list st-promises');
    for (const p of promises) {
      const li = make('li', p.paid ? 'paid' : 'unpaid');
      const btn = make('button');
      const where = [p.thread?.title, p.piece?.title].filter(Boolean).join(' · ');
      btn.append(make('span', 'from', where), make('span', 'line', p.note.text || ''), make('span', 'state', p.paid ? `Paid off${p.payoffPiece && p.payoffPiece.id !== p.piece?.id ? ` in ${p.payoffPiece.title}` : ''}: ${p.payoff.text || ''}` : 'Not paid off yet'));
      btn.addEventListener('click', () => this.hooks.go({ view: 'grid', id: p.piece?.id || this.owner.id }));
      li.append(btn);
      ul.append(li);
    }
    body.append(ul);
    if (!promises.length) body.append(make('p', 'hint', 'Promises are made in the plot grid: mark a note on a thread as a promise, and a later one as its payoff.'));
  }

  // ---------- Timeline: when things happen in the story ----------

  async drawTimeline(body) {
    const w = this.owner;
    const events = await eventsIn(w);
    const pieces = (await worldTree(w.id)).pieces.map(({ row }) => row);
    const byId = new Map(pieces.map((p) => [p.id, p]));
    const tools = make('div', 'st-tools');
    const add = make('button', 'pill', '+ Event');
    add.addEventListener('click', () => this.editEvent(null, pieces));
    tools.append(add);
    if (this.hooks.canAsk() && pieces.some(hasManuscript)) {
      const find = make('button', 'ghost-btn', 'Find events in the pieces');
      find.title = 'Claude reads the pieces and suggests events for the timeline, in story order';
      find.addEventListener('click', () => this.findEvents(find, pieces, events));
      tools.append(find);
    }
    body.append(tools);
    const sug = this.suggest.get(`tl:${w.id}`) || [];
    const tl = make('ol', 'st-timeline');
    for (const ev of events) {
      const li = make('li', 'st-ev' + (byId.get(ev.fields?.piece) && isOut(byId.get(ev.fields.piece), this.owner) ? ' canon' : ''));
      li.dataset.id = ev.id;
      li.append(make('div', 'st-when', ev.fields?.when || ''), make('div', 'st-what', ev.title || ''));
      const pc = byId.get(ev.fields?.piece);
      if (pc) { const b = make('button', 'st-pc', pc.title || 'Untitled'); b.addEventListener('click', () => this.hooks.go({ view: 'project', id: pc.id })); li.append(b); }
      li.append(this.hooks.menuButton(() => [
        { label: 'Edit…', run: () => this.editEvent(ev, pieces) },
        { label: 'Earlier', run: () => this.nudge(ev, events, -1) },
        { label: 'Later', run: () => this.nudge(ev, events, 1) },
        'sep',
        { label: 'Remove', danger: true, run: async () => { const r = { ...ev, deleted: true, updated_at: Date.now() }; await putEntries([r]); await this.changed([r]); this.undoToast('Event removed', async () => { const b = { ...r, deleted: false, updated_at: Date.now() }; await putEntries([b]); await this.changed([b]); }); this.render(); } }
      ], 'More for this event'));
      tl.append(li);
    }
    body.append(tl);
    if (!events.length && !sug.length) body.append(make('p', 'hint', 'What happens when, in story time: births, battles, the day they met. Events in posted pieces are canon and stand out.'));
    if (sug.length) {
      const box = make('section', 'st-suggest');
      box.append(make('div', 'panel-label', 'Claude’s suggestions'));
      const ul = make('ul', 'st-sug-list');
      sug.forEach((s, i) => {
        const li = make('li');
        li.append(make('span', 'st-when', s.when || ''), make('span', 'st-what', s.what), make('span', 'hint', byId.get(s.piece)?.title || ''));
        const keep = make('button', 'ghost-btn', 'Add');
        keep.addEventListener('click', async () => { await this.addEvent({ what: s.what, when: s.when, piece: s.piece, after: s.after }); sug.splice(i, 1); this.render(); });
        const no = make('button', 'ghost-btn', 'No');
        no.addEventListener('click', () => { sug.splice(i, 1); this.render(); });
        li.append(keep, no);
        ul.append(li);
      });
      box.append(ul);
      body.append(box);
    }
  }

  async addEvent({ what, when = '', piece = '', after = null }) {
    const w = this.owner;
    const events = await eventsIn(w);
    let sort = events.length ? events.at(-1).sort + GAP : GAP;
    const at = after ? events.findIndex((e) => e.id === after) : -1;
    if (at >= 0) sort = at + 1 < events.length ? (events[at].sort + events[at + 1].sort) / 2 : events[at].sort + GAP;
    const ev = entry('event', { id: newId('ev'), parent_id: w.id, sort, title: what, fields: { when, piece: piece || null } });
    await putEntries([ev]);
    await this.changed([ev]);
    return ev;
  }

  async editEvent(ev, pieces) {
    const names = pieces.map((p) => p.title || 'Untitled');
    const cur = pieces.find((p) => p.id === ev?.fields?.piece);
    const got = await askForm({
      title: ev ? 'The event' : 'A new event',
      fields: [
        { key: 'what', label: 'What happens', value: ev?.title || '', placeholder: 'Kenji fails the audition' },
        { key: 'when', label: 'When, in story time (optional)', value: ev?.fields?.when || '', placeholder: 'Year 1, spring · Kenji is 9' },
        { key: 'piece', label: 'Shown in (optional)', value: cur?.title || '', list: names }
      ],
      ok: 'Save'
    });
    if (!got?.what) return;
    const piece = pieces.find((p) => (p.title || 'Untitled').toLowerCase() === got.piece.toLowerCase())?.id || null;
    if (ev) { const r = { ...ev, title: got.what, fields: { ...ev.fields, when: got.when, piece }, updated_at: Date.now() }; await putEntries([r]); await this.changed([r]); }
    else await this.addEvent({ what: got.what, when: got.when, piece });
    this.render();
  }

  async nudge(ev, events, by) {
    const i = events.findIndex((e) => e.id === ev.id);
    const j = i + by;
    if (j < 0 || j >= events.length) return;
    const a = { ...events[i], sort: events[j].sort, updated_at: Date.now() };
    const b = { ...events[j], sort: events[i].sort, updated_at: Date.now() };
    await putEntries([a, b]);
    await this.changed([a, b]);
    this.render();
  }

  async findEvents(btn, pieces, events) {
    btn.disabled = true;
    btn.textContent = 'Claude is reading…';
    try {
      const texts = [];
      for (const p of pieces.filter(hasManuscript).slice(0, 12)) texts.push({ id: p.id, title: p.title || 'Untitled', stage: stageOf(p, this.owner), text: await pieceText(p, 6000) });
      const out = await this.hooks.askServer({ mode: 'pages', task: 'timeline', world: this.owner.title || '', pieces: texts, events: events.map((e) => ({ id: e.id, what: e.title || '', when: e.fields?.when || '' })) });
      this.suggest.set(`tl:${this.owner.id}`, (out?.events || []).filter((e) => e.what));
      if (!(out?.events || []).length) this.hooks.toast('Claude found nothing new for the timeline');
    } catch (e) { this.hooks.toast(e.message || 'Couldn’t ask Claude. Try again.'); }
    this.render();
  }

  // ---------- Relationships: who's who to whom ----------

  async drawTies(body) {
    const w = this.owner;
    const people = await charactersIn(w);
    const ties = await tiesIn(w);
    const tools = make('div', 'st-tools');
    const add = make('button', 'pill', '+ Tie');
    add.addEventListener('click', () => this.editTie(null, people));
    tools.append(add);
    if (this.hooks.canAsk() && people.length > 1) {
      const sug = make('button', 'ghost-btn', 'Suggest ties');
      sug.title = 'Claude reads the character pages and pieces and suggests how they’re tied';
      sug.addEventListener('click', () => this.suggestTies(sug, people, ties));
      tools.append(sug);
    }
    body.append(tools);
    if (people.length < 2) {
      body.append(make('p', 'hint', 'Relationships are drawn between characters. Make a page for each under a “Characters” page in the bible (or mark pages as characters in Make > Kit), and they show here.'));
      return;
    }
    const sug = this.suggest.get(`ties:${w.id}`) || [];
    body.append(this.web(people, ties, sug));
    const ul = make('ul', 'st-ties');
    const name = new Map(people.map((p) => [p.id, p.title || 'Untitled']));
    for (const t of ties) {
      const li = make('li');
      li.dataset.id = t.id;
      li.append(make('span', 'st-tie-a', name.get(t.fields?.a) || '?'), make('span', 'st-tie-label', t.title || '—'), make('span', 'st-tie-b', name.get(t.fields?.b) || '?'));
      li.append(this.hooks.menuButton(() => [
        { label: 'Edit…', run: () => this.editTie(t, people) },
        'sep',
        { label: 'Remove', danger: true, run: async () => { const r = { ...t, deleted: true, updated_at: Date.now() }; await putEntries([r]); await this.changed([r]); this.undoToast('Tie removed', async () => { const b = { ...r, deleted: false, updated_at: Date.now() }; await putEntries([b]); await this.changed([b]); }); this.render(); } }
      ], 'More for this tie'));
      ul.append(li);
    }
    body.append(ul);
    if (sug.length) {
      const box = make('section', 'st-suggest');
      box.append(make('div', 'panel-label', 'Claude’s suggestions'));
      const sl = make('ul', 'st-sug-list');
      sug.forEach((s, i) => {
        const li = make('li');
        li.append(make('span', 'st-what', `${name.get(s.a)} · ${s.label} · ${name.get(s.b)}`), make('span', 'hint', s.why || ''));
        const keep = make('button', 'ghost-btn', 'Keep');
        keep.addEventListener('click', async () => { await this.addTie(s.a, s.b, s.label); sug.splice(i, 1); this.render(); });
        const no = make('button', 'ghost-btn', 'No');
        no.addEventListener('click', () => { sug.splice(i, 1); this.render(); });
        li.append(keep, no);
        sl.append(li);
      });
      box.append(sl);
      body.append(box);
    }
  }

  // The people in a ring, ties as lines between them (suggestions dashed).
  web(people, ties, sug) {
    const NS = 'http://www.w3.org/2000/svg';
    const W = 640, H = 420, R = Math.min(W, H) / 2 - 60;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'st-web');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Who’s tied to whom');
    const pos = new Map(people.map((p, i) => { const a = (i / people.length) * Math.PI * 2 - Math.PI / 2; return [p.id, [W / 2 + R * Math.cos(a), H / 2 + R * Math.sin(a)]]; }));
    const line = (a, b, label, cls) => {
      const pa = pos.get(a), pb = pos.get(b);
      if (!pa || !pb) return;
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', pa[0]); l.setAttribute('y1', pa[1]); l.setAttribute('x2', pb[0]); l.setAttribute('y2', pb[1]);
      l.setAttribute('class', cls);
      svg.append(l);
      if (label) {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', (pa[0] + pb[0]) / 2); t.setAttribute('y', (pa[1] + pb[1]) / 2 - 4);
        t.setAttribute('class', cls + '-label');
        t.setAttribute('text-anchor', 'middle');
        t.textContent = label.length > 24 ? label.slice(0, 23) + '…' : label;
        svg.append(t);
      }
    };
    for (const t of ties) line(t.fields?.a, t.fields?.b, t.title, 'st-edge');
    for (const s of sug) line(s.a, s.b, s.label, 'st-edge sug');
    for (const p of people) {
      const [x, y] = pos.get(p.id);
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'st-node');
      g.setAttribute('tabindex', '0');
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 7);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', x); t.setAttribute('y', y + (y < H / 2 ? -14 : 24));
      t.setAttribute('text-anchor', 'middle');
      t.textContent = p.title || 'Untitled';
      g.append(c, t);
      g.addEventListener('click', () => this.hooks.go({ view: 'notebook', pageId: p.id }));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.hooks.go({ view: 'notebook', pageId: p.id }); });
      svg.append(g);
    }
    return svg;
  }

  async addTie(a, b, label) {
    const t = entry('tie', { id: newId('ti'), parent_id: this.owner.id, title: label, fields: { a, b } });
    await putEntries([t]);
    await this.changed([t]);
  }

  async editTie(tie, people) {
    const names = people.map((p) => p.title || 'Untitled');
    const find = (x) => people.find((p) => (p.title || 'Untitled').toLowerCase() === (x || '').trim().toLowerCase());
    const got = await askForm({
      title: tie ? 'The tie' : 'A new tie',
      fields: [
        { key: 'a', label: 'Who', value: people.find((p) => p.id === tie?.fields?.a)?.title || '', list: names },
        { key: 'label', label: 'How they’re tied', value: tie?.title || '', placeholder: 'brothers · owes him his life · secretly in love' },
        { key: 'b', label: 'And who', value: people.find((p) => p.id === tie?.fields?.b)?.title || '', list: names }
      ]
    });
    if (!got) return;
    const a = find(got.a), b = find(got.b);
    if (!a || !b || a.id === b.id) { this.hooks.toast('Pick two different characters'); return; }
    if (!got.label) return;
    if (tie) { const r = { ...tie, title: got.label, fields: { ...tie.fields, a: a.id, b: b.id }, updated_at: Date.now() }; await putEntries([r]); await this.changed([r]); }
    else await this.addTie(a.id, b.id, got.label);
    this.render();
  }

  async suggestTies(btn, people, ties) {
    btn.disabled = true;
    btn.textContent = 'Claude is reading…';
    try {
      const chars = [];
      for (const p of people.slice(0, 40)) chars.push({ id: p.id, name: p.title || 'Untitled', about: await pageText(p, 800) });
      const pieces = [];
      for (const p of (await worldTree(this.owner.id)).pieces.map(({ row }) => row).filter(hasManuscript).slice(0, 8)) pieces.push({ title: p.title || 'Untitled', text: await pieceText(p, 4000) });
      const out = await this.hooks.askServer({ mode: 'pages', task: 'ties', world: this.owner.title || '', characters: chars, pieces, ties: ties.map((t) => ({ a: t.fields?.a, b: t.fields?.b, label: t.title || '' })) });
      const ids = new Set(people.map((p) => p.id));
      this.suggest.set(`ties:${this.owner.id}`, (out?.ties || []).filter((t) => ids.has(t.a) && ids.has(t.b) && t.a !== t.b && t.label));
      if (!(out?.ties || []).length) this.hooks.toast('Claude found no new ties');
    } catch (e) { this.hooks.toast(e.message || 'Couldn’t ask Claude. Try again.'); }
    this.render();
  }

  // ---------- Shape: a piece (the Develop page) ----------

  async drawShapePiece(body) {
    const sub = this.sub(SHAPE_PIECE, 'develop');
    body.append(this.chips(SHAPE_PIECE, 'develop', (id) => (id === 'grid' ? this.hooks.go({ view: 'grid', id: this.owner.id }) : this.pickSub(id))));
    await this.drawDevelop(body);
    void sub;
  }

  async drawDevelop(body) {
    const piece = this.owner;
    const dev = piece.fields?.develop || {};
    body.append(make('p', 'hint st-lede', 'Start small and grow it: a sentence, then a paragraph, the people, then a page. Use as much or as little as helps; nothing here is required.'));
    for (const step of DEVELOP) {
      const sec = make('section', 'st-dev');
      sec.dataset.step = step.id;
      const head = make('div', 'ph-row');
      head.append(make('span', 'panel-label', step.label));
      if (this.hooks.canAsk()) {
        const help = make('button', 'ghost-btn', step.id === 'people' ? 'Suggest with Claude' : 'Grow it with Claude');
        help.title = step.id === 'sentence' ? 'Claude offers a sentence from what’s there (the idea page, the draft)' : 'Claude grows the step before into this one; yours stays until you keep Claude’s';
        help.addEventListener('click', () => this.growStep(step.id, help));
        head.append(help);
      }
      sec.append(head, make('p', 'hint', step.hint));
      if (step.id === 'people') {
        const people = dev.people || [];
        const list = make('div', 'st-people');
        people.forEach((pp, i) => list.append(this.personRow(pp, i)));
        const add = make('button', 'ghost-btn', '+ Someone');
        add.addEventListener('click', async () => { await this.saveDev({ people: [...people, { name: '', wants: '', against: '', learns: '' }] }); this.render(); });
        sec.append(list, add);
      } else {
        const ta = make('textarea', 'st-ta');
        ta.value = dev[step.id] || '';
        ta.rows = step.id === 'sentence' ? 2 : step.id === 'paragraph' ? 5 : 12;
        ta.setAttribute('aria-label', step.label);
        ta.addEventListener('input', () => this.later(`dev:${step.id}`, () => this.saveDev({ [step.id]: ta.value })));
        ta.addEventListener('blur', () => this.now(`dev:${step.id}`));
        sec.append(ta);
      }
      const offer = this.suggest.get(`dev:${piece.id}:${step.id}`);
      if (offer) {
        const box = make('div', 'st-offer');
        box.append(make('div', 'panel-label', 'Claude’s version'));
        if (step.id === 'people') box.append(...offer.map((p) => make('p', '', `${p.name}: wants ${p.wants}; against ${p.against}; learns ${p.learns}`)));
        else box.append(make('p', 'st-offer-text', offer));
        const keep = make('button', 'pill', step.id === 'people' ? 'Add them' : 'Use this');
        keep.addEventListener('click', async () => {
          if (step.id === 'people') await this.saveDev({ people: [...(dev.people || []), ...offer.filter((p) => !(dev.people || []).some((q) => q.name.toLowerCase() === p.name.toLowerCase()))] });
          else await this.saveDev({ [step.id]: offer, [`${step.id}_was`]: dev[step.id] || '' });
          this.suggest.delete(`dev:${piece.id}:${step.id}`);
          this.render();
        });
        const no = make('button', 'ghost-btn', 'No thanks');
        no.addEventListener('click', () => { this.suggest.delete(`dev:${piece.id}:${step.id}`); this.render(); });
        box.append(keep, no);
        sec.append(box);
      }
      body.append(sec);
    }
  }

  personRow(pp, i) {
    const row = make('div', 'st-person');
    for (const [k, ph] of [['name', 'Name'], ['wants', 'Wants'], ['against', 'What stops them'], ['learns', 'What they learn']]) {
      const inp = make('input', 'st-input');
      inp.value = pp[k] || '';
      inp.placeholder = ph;
      inp.setAttribute('aria-label', ph);
      inp.addEventListener('input', () => this.later(`dev:people:${i}:${k}`, async () => {
        const fresh = (await getEntry(this.owner.id)).fields?.develop?.people || [];
        const next = fresh.map((x, j) => (j === i ? { ...x, [k]: inp.value } : x));
        await this.saveDev({ people: next });
      }));
      inp.addEventListener('blur', () => this.now(`dev:people:${i}:${k}`));
      row.append(inp);
    }
    row.append(this.hooks.menuButton(() => [{ label: 'Remove', danger: true, run: async () => { const fresh = (await getEntry(this.owner.id)).fields?.develop?.people || []; await this.saveDev({ people: fresh.filter((_, j) => j !== i) }); this.render(); } }], 'More'));
    return row;
  }

  async saveDev(patch) {
    const fresh = await getEntry(this.owner.id);
    const develop = { ...(fresh.fields?.develop || {}), ...patch };
    const row = { ...fresh, fields: { ...fresh.fields, develop }, updated_at: Date.now() };
    await putEntries([row]);
    this.owner = row;
    await this.changed([row]);
  }

  later(key, fn) {
    clearTimeout(this.timers.get(key)?.t);
    this.timers.set(key, { fn, t: setTimeout(() => this.now(key), 600) });
  }
  now(key) {
    const x = this.timers.get(key);
    if (!x) return;
    clearTimeout(x.t);
    this.timers.delete(key);
    return x.fn();
  }

  async growStep(step, btn) {
    for (const k of [...this.timers.keys()]) await this.now(k);
    btn.disabled = true;
    btn.textContent = 'Claude is thinking…';
    try {
      const piece = await getEntry(this.owner.id);
      const pages = await pagesIn(piece.id);
      const idea = pages.find((p) => /^idea$/i.test(p.title || ''));
      const out = await this.hooks.askServer({ mode: 'pages', task: 'develop', step, piece: piece.title || '', kind: kindName(piece), world: this.world?.title || '', develop: piece.fields?.develop || {}, idea: idea ? await pageText(idea, 3000) : '', draft: await pieceText(piece, 6000) });
      if (step === 'people') { if (out?.people?.length) this.suggest.set(`dev:${piece.id}:${step}`, out.people); }
      else if (out?.text) this.suggest.set(`dev:${piece.id}:${step}`, out.text);
    } catch (e) { this.hooks.toast(e.message || 'Couldn’t ask Claude. Try again.'); }
    this.render();
  }

  // ---------- Write: the world ----------

  async drawWriteWorld(body) {
    const { pieces } = await worldStats(this.owner);
    const ul = make('ul', 'st-write');
    for (const { row: p, depth } of pieces) {
      const li = make('li');
      li.style.setProperty('--depth', depth);
      const writable = hasManuscript(p) || bookType(p) === 'lines';
      const s = writable && hasManuscript(p) ? await stats(p) : null;
      const open = make('button', 'loose-title', p.title || 'Untitled');
      open.addEventListener('click', () => (writable ? this.hooks.openBook(p.id) : this.hooks.go({ view: 'project', id: p.id })));
      li.append(open, make('span', 'piece-kind', kindName(p)), make('span', 'when', s ? plural(s.words, 'word') : ''), make('span', 'stage', stageOf(p, this.owner)));
      ul.append(li);
    }
    const head = make('div', 'ph-row');
    head.append(make('span', 'panel-label', 'Pieces to write in'));
    const add = make('button', 'ghost-btn', '+ Piece');
    add.addEventListener('click', () => this.hooks.newPiece(this.owner.id));
    head.append(add);
    body.append(head, ul);
    if (!pieces.length) body.append(make('p', 'hint', 'No pieces yet. A gag, a short, an episode, a novel: anything you make here.'));
  }

  // ---------- Revise ----------

  async drawRevise(body) {
    if (this.scope === 'piece') {
      const piece = this.owner;
      const tools = make('div', 'st-tools st-rev-tools');
      const tool = (label, keys, action, about) => {
        const b = make('button', 'st-tool');
        b.dataset.action = action;
        b.append(make('span', 'st-tool-name', label), make('span', 'st-tool-about', about), keys ? make('span', 'keys', keys) : '');
        b.addEventListener('click', () => this.hooks.revise(action, piece));
        tools.append(b);
      };
      if (hasManuscript(piece)) {
        tool('Fresh eyes', 'Ctrl + Shift + Y', 'fresh', 'Reread it in a new font, page and colour, like someone else wrote it');
        tool('Claude’s notes', '', 'notes', 'Margin notes and a fix list for the chapter you were last in');
        tool('Talk it over', '', 'talk', 'A conversation with Claude about the chapter');
        tool('Compare', 'Ctrl + Shift + X', 'compare', 'Two drafts, or the text then and now, side by side');
        tool('New draft from this one', '', 'draft-from', 'Keep a copy of this draft as it is, and carry on with big changes');
        tool('New draft from scratch', '', 'draft', 'The old draft is kept whole and opens beside the empty page');
        tool('Print or PDF', 'Ctrl + P', 'print', 'As a manuscript or a script');
      }
      body.append(tools);
      if (!hasManuscript(piece)) body.append(make('p', 'hint', 'Revising works on a prose or script draft. This piece is an outline.'));
      // Fix lists Claude has written for it.
      const fixes = (await pagesIn(piece.id)).filter((p) => p.fields?.fixesFor);
      if (fixes.length) {
        body.append(make('div', 'panel-label ph-gap', 'Fix lists'));
        const ul = make('ul', 'loose-list st-fixes');
        for (const p of fixes) {
          const left = (await children(p.id)).filter((r) => r.parent_id !== p.id && !r.fields?.done).length;
          const li = make('li');
          const b = make('button', 'loose-title', p.title || 'Fix list');
          b.addEventListener('click', () => this.hooks.go({ view: 'notebook', pageId: p.id }));
          li.append(b, make('span', 'when', left ? `${left} to do` : ago(p.updated_at)));
          ul.append(li);
        }
        body.append(ul);
      }
      await this.drawComments(body, [piece]);
      return;
    }
    // The world: comments across its pieces, and continuity against canon.
    const pieces = (await worldTree(this.owner.id)).pieces.map(({ row }) => row);
    const posted = pieces.filter((p) => isOut(p, this.owner));
    const box = make('section', 'st-continuity');
    const head = make('div', 'ph-row');
    head.append(make('span', 'panel-label', 'Continuity'));
    box.append(head);
    box.append(make('p', 'hint', posted.length ? `Posted is canon: ${posted.map((p) => p.title).join(', ')}. Claude can check a piece against it and the bible.` : 'Once pieces are posted they’re canon, and Claude can check new pieces against them and the bible.'));
    const unposted = pieces.filter((p) => !isOut(p, this.owner) && hasManuscript(p));
    if (this.hooks.canAsk() && unposted.length) {
      const pick = make('select', 'st-select');
      pick.setAttribute('aria-label', 'Piece to check');
      for (const p of unposted) pick.append(Object.assign(make('option', '', p.title || 'Untitled'), { value: p.id }));
      const go = make('button', 'pill', 'Check continuity');
      go.addEventListener('click', () => this.checkContinuity(go, pick.value, posted));
      const row = make('div', 'st-tools');
      row.append(pick, go);
      box.append(row);
    }
    const found = this.suggest.get(`cont:${this.owner.id}`);
    if (found) {
      const ul = make('ul', 'ref-list st-issues');
      for (const f of found.issues) {
        const li = make('li');
        li.append(make('span', 'from', f.where || ''), make('span', 'line', f.issue), make('span', 'state', f.canon ? `Canon: ${f.canon}` : ''));
        ul.append(li);
      }
      box.append(make('div', 'panel-label ph-gap', `In ${found.title}`), found.issues.length ? ul : make('p', 'hint', 'Nothing clashes with canon.'));
    }
    body.append(box);
    await this.drawComments(body, pieces);
  }

  async checkContinuity(btn, pieceId, posted) {
    btn.disabled = true;
    btn.textContent = 'Claude is reading…';
    try {
      const piece = await getEntry(pieceId);
      const { pages } = await worldTree(this.owner.id);
      const bible = [];
      for (const { row } of pages.slice(0, 60)) bible.push({ title: row.title || '', text: await pageText(row, 800) });
      const canon = [];
      for (const p of posted.slice(0, 10)) canon.push({ title: p.title || '', text: await pieceText(p, 5000) });
      const out = await this.hooks.askServer({ mode: 'pages', task: 'continuity', world: this.owner.title || '', bible, canon, piece: { title: piece.title || '', text: await pieceText(piece, 16000) } });
      this.suggest.set(`cont:${this.owner.id}`, { title: piece.title || 'Untitled', issues: out?.issues || [] });
    } catch (e) { this.hooks.toast(e.message || 'Couldn’t ask Claude. Try again.'); }
    this.render();
  }

  async drawComments(body, pieces) {
    const all = [];
    for (const p of pieces) {
      const share = await getEntry(shareId(p.id));
      if (!share || share.deleted) continue;
      for (const n of await commentsOn(share)) all.push({ n, piece: p });
    }
    body.append(make('div', 'panel-label ph-gap', 'Readers’ comments'));
    if (!all.length) { body.append(make('p', 'hint', 'Share a link from Deliver and readers’ comments show up here and in the margin.')); return; }
    const ul = make('ul', 'ref-list st-comments');
    for (const { n, piece } of all.sort((a, b) => (b.n.fields.comment.at || 0) - (a.n.fields.comment.at || 0)).slice(0, 60)) {
      const li = make('li', n.fields.resolved ? 'resolved' : '');
      const b = make('button');
      b.append(make('span', 'from', `${n.fields.comment.name || 'A reader'}${pieces.length > 1 ? ` · ${piece.title}` : ''}`), make('span', 'line', n.text || ''));
      b.addEventListener('click', () => this.hooks.revise('comment', piece, n));
      li.append(b);
      ul.append(li);
    }
    body.append(ul);
  }

  // ---------- Make: the world ----------

  async drawMakeWorld(body) {
    const sub = this.sub(MAKE_WORLD, 'board');
    body.append(this.chips(MAKE_WORLD, sub, (id) => this.pickSub(id)));
    const w = this.owner;
    if (sub === 'board') {
      const { pieces } = await worldStats(w);
      const tools = make('div', 'st-tools st-board-tools');
      const edit = make('button', 'ghost-btn', 'Stages…');
      edit.title = 'Which stages scripts, prose and outlines go through here, and your own names for them';
      edit.addEventListener('click', () => this.hooks.editStages(w));
      tools.append(edit);
      body.append(tools);
      const board = make('div', 'stage-board st-board');
      board.id = 'st-board';
      body.append(board);
      if (pieces.length) this.hooks.board(board, w, pieces);
      else body.append(make('p', 'hint', 'Every piece by stage, from idea to out in the world. Make a piece and it shows here.'));
    }
    if (sub === 'kit') await this.drawKit(body);
    if (sub === 'days') await this.drawDays(body);
  }

  async drawKit(body) {
    const w = this.owner;
    const els = await elementsIn(w);
    const style = make('section', 'st-style');
    style.append(make('div', 'panel-label', 'Style rules for the whole show'));
    const ta = make('textarea', 'st-ta');
    ta.rows = 3;
    ta.value = w.fields?.production?.style || '';
    ta.placeholder = 'The look every prompt keeps to: “90s anime, film grain, warm dusk palette”';
    ta.setAttribute('aria-label', 'Style rules');
    ta.addEventListener('input', () => this.later('style', async () => {
      const fresh = await getEntry(w.id);
      const row = { ...fresh, fields: { ...fresh.fields, production: { ...(fresh.fields?.production || {}), style: ta.value } }, updated_at: Date.now() };
      await putEntries([row]);
      this.owner = row;
      await this.changed([row]);
    }));
    ta.addEventListener('blur', () => this.now('style'));
    style.append(ta);
    body.append(style);
    for (const t of ELEMENT_TYPES) {
      const mine = els.filter((e) => (e.fields?.element?.type || 'other') === t.id);
      if (!mine.length) continue;
      body.append(make('div', 'panel-label ph-gap', `${t.plural} · ${mine.length}`));
      const ul = make('ul', 'st-kit');
      for (const e of mine) {
        const li = make('li');
        const b = make('button', 'st-kit-el');
        b.append(make('span', 'st-kit-name', e.title || 'Untitled'), make('span', 'st-kit-look', snip(e.fields?.element?.look || e.fields?.element?.snippet || '', 120)));
        b.addEventListener('click', () => this.hooks.go({ view: 'notebook', pageId: e.id }));
        li.append(b);
        ul.append(li);
      }
      body.append(ul);
    }
    if (!els.length) body.append(make('p', 'hint', 'The kit is the bible pages that are characters, places, props and wardrobe. Open a piece’s Make page and add them from its Kit tab, or turn bible pages into elements there.'));
  }

  async drawDays(body) {
    const pieces = (await worldTree(this.owner.id)).pieces.map(({ row }) => row);
    const all = [];
    for (const p of pieces) for (const d of await shootDays(p.id)) all.push({ d, p });
    all.sort((a, b) => String(a.d.fields?.date || '').localeCompare(String(b.d.fields?.date || '')));
    const today = new Date().toISOString().slice(0, 10);
    const ul = make('ul', 'ref-list st-days');
    for (const { d, p } of all) {
      const li = make('li', (d.fields?.date || '') < today ? 'past' : '');
      const b = make('button');
      const date = d.fields?.date ? new Date(`${d.fields.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'No date yet';
      b.append(make('span', 'from', `${date}${d.fields?.call ? ` · call ${d.fields.call}` : ''}`), make('span', 'line', `${d.fields?.type === 'voice' ? 'Voices: ' : ''}${p.title || 'Untitled'}${d.fields?.place ? ` · ${d.fields.place}` : ''}`));
      b.addEventListener('click', () => this.hooks.go({ view: 'production', id: p.id, day: d.id }));
      li.append(b);
      ul.append(li);
    }
    body.append(ul);
    if (!all.length) body.append(make('p', 'hint', 'Shoot days for every piece in the world, in date order. Add one from a piece’s Make page.'));
  }

  // ---------- Deliver: the world ----------

  async drawDeliverWorld(body) {
    const pieces = (await worldTree(this.owner.id)).pieces.map(({ row }) => row);
    const posted = pieces.filter((p) => isOut(p, this.owner));
    const ready = pieces.filter((p) => isReady(p, this.owner));
    const list = (label, rows, empty) => {
      body.append(make('div', 'panel-label ph-gap', label));
      if (!rows.length) { body.append(make('p', 'hint', empty)); return; }
      const ul = make('ul', 'loose-list st-posted');
      for (const p of rows) {
        const li = make('li');
        const b = make('button', 'loose-title', p.title || 'Untitled');
        b.addEventListener('click', () => this.hooks.go({ view: 'deliver', id: p.id }));
        li.append(b, make('span', 'piece-kind', kindName(p)));
        const links = make('span', 'st-links');
        for (const [k, v] of Object.entries(p.fields?.posting || {})) {
          if (!v?.url) continue;
          const a = make('a', 'st-link', k === 'x' ? 'X' : k[0].toUpperCase() + k.slice(1));
          a.href = v.url;
          a.target = '_blank';
          a.rel = 'noopener';
          links.append(a);
        }
        li.append(links);
        ul.append(li);
      }
      body.append(ul);
    };
    list('Ready to post', ready, 'Pieces at Edited show here, ready for captions and posting.');
    list('Out in the world', posted, 'Nothing out yet. Pieces at their last stage (posted, released, published) are canon: what continuity is checked against.');
  }

  // ---------- Notes: a life project's pages ----------

  async drawNotes(body) {
    await this.drawBible(body, 'Notes');
  }

  // ---------- the Drawer ----------

  async drawDrawer() {
    const head = make('div', 'st-head');
    head.append(make('span', 'st-page', 'Desk'), make('h1', 'st-title', 'The Drawer'));
    const body = make('div', 'st-body');
    body.dataset.page = 'drawer';
    this.el.replaceChildren(head, body);
    body.append(make('p', 'hint st-lede', 'Ideas with no home yet. Tag a line #drawer anywhere, or choose “Into the drawer” in the day review. Nothing here nags. When a world wants one, pull it in: it’s linked there and stays here for anything else it could feed.'));
    const q = make('input', 'st-input st-search');
    q.type = 'search';
    q.placeholder = 'Search the drawer';
    q.setAttribute('aria-label', 'Search the drawer');
    q.value = this.query || '';
    body.append(q);
    const items = await drawerItems();
    const worldsList = (await byKind('world')).filter((w) => !gone(w)).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    const wName = new Map(worldsList.map((w) => [w.id, w.title || 'Untitled']));
    const box = make('div', 'st-drawer');
    const draw = () => {
      const s = (q.value || '').toLowerCase();
      this.query = q.value;
      box.replaceChildren();
      let month = '';
      let ul = null;
      for (const r of items) {
        if (s && !(r.text || '').toLowerCase().includes(s)) continue;
        const m = new Date(r.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        if (m !== month) { month = m; box.append(make('div', 'panel-label ph-gap', m)); ul = make('ul', 'st-cards'); box.append(ul); }
        const li = make('li', 'st-card');
        li.dataset.id = r.id;
        const from = make('button', 'st-from', ago(r.created_at));
        from.addEventListener('click', () => this.hooks.openEntry(r.id));
        const words = make('div', 'st-text');
        words.append(lineWords(r));
        li.append(from, words);
        const where = make('div', 'st-where');
        for (const id of r.fields?.pulled || []) if (wName.has(id)) { const b = make('button', 'st-went', `→ ${wName.get(id)}`); b.addEventListener('click', () => this.hooks.go({ view: 'stage', id, page: 'gather' })); where.append(b); }
        const acts = make('div', 'st-acts');
        const pull = make('button', 'ghost-btn', 'Pull into…');
        pull.addEventListener('click', () => this.hooks.menu(pull, worldsList.map((w) => ({ label: w.title || 'Untitled', current: (r.fields?.pulled || []).includes(w.id), run: async () => { const on = !(r.fields?.pulled || []).includes(w.id); const rows = await pullInto(r.id, w.id, on); await this.changed(rows); this.hooks.toast(on ? `Pulled into ${w.title}: it’s in its Gather now` : `Not in ${w.title} any more`); this.render(); } }))));
        const out = make('button', 'ghost-btn', 'Out of the drawer');
        out.title = 'Takes the #drawer tag off; the line stays where it was written';
        out.addEventListener('click', async () => { const rows = await outOfDrawer(r.id); await this.changed(rows); this.undoToast('Out of the drawer', async () => this.changed(await intoDrawer(r.id))); this.render(); });
        acts.append(pull, out);
        li.append(where, acts);
        ul.append(li);
      }
      if (!box.children.length) box.append(make('p', 'hint st-empty', items.length ? 'Nothing matches.' : 'The drawer is empty. Put #drawer on any line to keep it here.'));
    };
    q.addEventListener('input', draw);
    draw();
    body.append(box);
  }
}
