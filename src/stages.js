import { getEntry, children, chapterText, putEntries, byKind, byTag, linkedFrom } from './db.js';
import { entry, newId, tagsIn, outline } from './model.js';
import { GAP, bySort } from './order.js';
import {
  worldOf, piecesIn, worldTree, worldStats, dailyMentions, stats, hasManuscript, bookType, kindName,
  STAGES, stageOf, stageSetOf, isOut, isReady, ago, newPage, pagesIn, toolsOf
} from './library.js';
import { worldPromises } from './grid.js';
import { elementsIn, ELEMENT_TYPES, typeOf, shootDays } from './production.js';
import { shareId, commentsOn } from './sharelink.js';
import { isLife, hasLineDrag, lineDragId, lineWords } from './pages.js';
import { make } from './dom.js';

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

export const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
export const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* full */ } };
export const plural = (n, w, many = `${w}s`) => `${n.toLocaleString()} ${n === 1 ? w : many}`;
const titleOfDay = (day) => {
  const [y, m, d] = (day.id || '').slice(4).split('-').map(Number);
  return y ? new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : day.title || '';
};
export const snip = (s, n = 160) => { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const textOf = (content) => (content || []).map((n) => (n.type === 'text' ? n.text : n.type === 'entryRef' ? n.attrs?.title || '' : '')).join('');
export const gone = (r) => !r || r.deleted || r.fields?.trashed;

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
// The status board is on the project's Overview now; Make is tools only.
export const MAKE_WORLD = [
  { id: 'kit', label: 'Kit' },
  { id: 'looks', label: 'Looks' },
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
export function askForm({ title, body = '', fields, ok = 'Save' }) {
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

export const hasDrawerTag = (r) => (r.tags || []).includes(DRAWER);

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
      for (const r of await chapterText(ch.id)) {
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
export async function pageText(page, limit = 1500) {
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
