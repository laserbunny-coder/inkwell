// All journals (Nov 28 2026): every day's journal in one place, newest first.
// A day's entries are the lines under its Journal line (journal.js) and any
// line on that day's page that carries a typed #journal (the voice journals
// from before the Journal line), each with the lines under it. Read here,
// written on the day page: "Open day ›", or "Write ›" for today.
// A month at a time, so years of journals open at once; the find box looks
// through them all.

import { children, journalHeads, byTag, getMany } from './db.js';
import { rootsOf } from './notebook.js';
import { isoToday } from './dates.js';
import { make } from './dom.js';

const MONTH = 7; // the YYYY-MM of an ISO date
const fold = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const longDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) }); };
const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); };

// The lines under a row, as a tree: [{ row, kids: [...] }].
async function treeUnder(id) {
  const out = [];
  for (const r of await children(id)) if (r.kind === 'line') out.push({ row: r, kids: await treeUnder(r.id) });
  return out;
}

export class JournalPage {
  constructor(sheet, hooks) {
    this.sheet = sheet;
    this.hooks = hooks;
    this.days = []; // [{ iso, head, typed: [rows] }], newest first
    this.loaded = new Map(); // iso -> entries tree
    this.months = 1; // how many months are shown
    this.q = '';
  }

  // Which days have a journal: one read of the Journal lines and one of the
  // #journal tag, nothing under them yet.
  async findDays() {
    const [heads, tagged] = await Promise.all([journalHeads(), byTag('journal')]);
    const days = new Map();
    const day = (iso) => { if (!days.has(iso)) days.set(iso, { iso, head: null, typed: [] }); return days.get(iso); };
    for (const h of heads) day(h.id.slice(3)).head = h;
    const typed = tagged.filter((r) => r.kind === 'line' && r.tags?.includes('journal'));
    const roots = await rootsOf(typed);
    // A typed #journal line nested under another one is shown with it.
    const typedIds = new Set(typed.map((r) => r.id));
    const parents = new Map((await getMany([...new Set(typed.map((r) => r.parent_id))])).filter(Boolean).map((r) => [r.id, r]));
    for (const r of typed) {
      const root = roots.get(r.id);
      if (root?.kind !== 'day' || root.deleted) continue;
      if (typedIds.has(r.parent_id) || parents.get(r.parent_id)?.fields?.journal) continue;
      let up = parents.get(r.parent_id);
      let inJournal = false;
      for (let i = 0; up && i < 40 && up.kind === 'line'; i++) { if (up.fields?.journal) { inJournal = true; break; } up = (await getMany([up.parent_id]))[0]; }
      if (!inJournal) day(root.title || root.id.slice(4)).typed.push(r);
    }
    for (const d of days.values()) d.typed.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.created_at - b.created_at);
    return [...days.values()].sort((a, b) => (a.iso < b.iso ? 1 : -1));
  }

  async entriesOf(d) {
    if (this.loaded.has(d.iso)) return this.loaded.get(d.iso);
    const out = [...(d.head ? await treeUnder(d.head.id) : [])];
    for (const r of d.typed) out.push({ row: r, kids: await treeUnder(r.id) });
    const kept = out.filter((e) => hasWords(e));
    this.loaded.set(d.iso, kept);
    return kept;
  }

  async show() {
    this.turn = (this.turn || 0) + 1;
    const turn = this.turn;
    this.loaded.clear();
    this.months = 1;
    this.days = await this.findDays();
    if (turn !== this.turn) return;
    this.drawFrame();
    await this.drawDays();
  }

  drawFrame() {
    const head = make('header', 'jp-head');
    head.append(make('div', 'panel-label', 'Library'), make('h1', 'jp-title', 'Journal'));
    const find = make('div', 'jp-find');
    const input = make('input');
    input.type = 'search';
    input.placeholder = 'Find in your journal…';
    input.setAttribute('aria-label', 'Find in your journal');
    input.value = this.q;
    let t = 0;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { this.q = input.value; this.drawDays(); }, 120); });
    find.append(input);
    this.list = make('div', 'jp-days');
    this.sheet.replaceChildren(head, find, this.list);
  }

  // The days shown: the newest month (and as many more as asked for), or
  // with words in the find box, every day whose journal has them all.
  async drawDays() {
    const turn = (this.drawTurn = (this.drawTurn || 0) + 1);
    const words = fold(this.q).split(/\s+/).filter(Boolean);
    const today = isoToday();
    const ms = [...new Set(this.days.map((d) => d.iso.slice(0, MONTH)))];
    const showMonths = new Set(words.length ? ms : ms.slice(0, this.months));
    const parts = [];
    for (const d of this.days) {
      if (!showMonths.has(d.iso.slice(0, MONTH))) continue;
      let entries = await this.entriesOf(d);
      if (turn !== this.drawTurn) return;
      if (words.length) entries = entries.filter((e) => words.every((w) => fold(textOf(e)).includes(w)));
      if (!entries.length && !(d.iso === today && !words.length)) continue;
      const sec = make('section', 'jp-day');
      sec.dataset.day = d.iso;
      const h = make('h3');
      const open = make('button', 'jp-open', d.iso === today ? 'Write ›' : 'Open day ›');
      open.type = 'button';
      open.addEventListener('click', () => this.hooks.openDay(d.iso, true));
      h.append(make('span', '', d.iso === today ? `Today · ${longDay(d.iso)}` : longDay(d.iso)), open);
      sec.append(h, this.tree(entries, words));
      parts.push(sec);
    }
    // Today's journal is always a tap away, written in or not.
    if (!words.length && !this.days.some((d) => d.iso === today)) {
      const sec = make('section', 'jp-day');
      sec.dataset.day = today;
      const h = make('h3');
      const open = make('button', 'jp-open', 'Write ›');
      open.type = 'button';
      open.addEventListener('click', () => this.hooks.openDay(today, true));
      h.append(make('span', '', `Today · ${longDay(today)}`), open);
      sec.append(h);
      parts.unshift(sec);
    }
    if (!parts.length) parts.push(make('p', 'jp-none', words.length ? 'Nothing in your journal matches that.' : 'Nothing written yet. Write under Journal at the top of any day’s page.'));
    if (!words.length && ms.length > this.months) {
      const more = make('button', 'jp-more', `Earlier: ${monthName(ms[this.months])} ›`);
      more.type = 'button';
      more.addEventListener('click', () => { this.months += 1; this.drawDays(); });
      parts.push(more);
    }
    this.list.replaceChildren(...parts);
  }

  tree(entries, words) {
    const ul = make('ul', 'jp-lines');
    for (const e of entries) {
      const li = make('li');
      const p = make('p', 'jp-e');
      paint(p, e.row.text || '', words);
      li.append(p);
      const kids = e.kids.filter(hasWords);
      if (kids.length) li.append(this.tree(kids, words));
      ul.append(li);
    }
    return ul;
  }
}

const hasWords = (e) => !!(e.row.text || '').trim() || e.kids.some(hasWords);
const textOf = (e) => [e.row.text || '', ...e.kids.map(textOf)].join(' ');

// The words, with what was looked for marked.
function paint(el, text, words) {
  if (!words.length) { el.textContent = text; return; }
  const f = fold(text).length === text.length ? fold(text) : text.toLowerCase();
  const marks = [];
  for (const w of words) { for (let at = f.indexOf(w); at >= 0; at = f.indexOf(w, at + w.length)) marks.push([at, at + w.length]); }
  marks.sort((a, b) => a[0] - b[0]);
  let i = 0;
  for (const [a, b] of marks) {
    if (a < i) continue;
    if (a > i) el.append(text.slice(i, a));
    el.append(make('mark', '', text.slice(a, b)));
    i = b;
  }
  if (i < text.length) el.append(text.slice(i));
}
