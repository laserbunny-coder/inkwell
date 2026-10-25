import { children, getEntry } from './db.js';
import { addLine } from './capture.js';

// The pages of the work, like DaVinci Resolve's: Gather, Shape, Write,
// Revise, Make, Deliver, left to right, from the first spark to posted. Each
// has two sizes: the whole world, or one piece in it (Overview, Alt + 0, is
// the home of either). Outside a world is the desk: Today, the Drawer and the
// Library. A life project (a kitchen remodel, research for someone who's ill)
// only needs Overview, Gather and Notes.
//
// The tabs sit in the top strip. They never show while you write: they come
// back at the top edge or while Alt is held (with their numbers), sit faintly
// on the pages you look at rather than type in, and are gone in focus.

export const PAGES = [
  { id: 'gather', label: 'Gather', about: 'Everything in, nothing decided: lines from your days, pictures, links, research' },
  { id: 'shape', label: 'Shape', about: 'What’s true: the bible, arcs, the timeline, who’s who, promises' },
  { id: 'write', label: 'Write', about: 'The words' },
  { id: 'revise', label: 'Revise', about: 'Fresh eyes, drafts side by side, notes and comments' },
  { id: 'make', label: 'Make', about: 'The stage board, shots, storyboard, kit and shoot days' },
  { id: 'deliver', label: 'Deliver', about: 'Files out, share links and posting' }
];
export const LIFE_PAGES = [
  { id: 'gather', label: 'Gather', about: 'Everything in: research, links, pictures, lines from your days' },
  { id: 'notes', label: 'Notes', about: 'What you’ve worked out, a page for each thing' }
];
export const DESK = [
  { id: 'today', label: 'Today', about: 'Today’s page (Ctrl + J)' },
  { id: 'drawer', label: 'Drawer', about: 'Ideas that don’t belong anywhere yet' },
  { id: 'library', label: 'Library', about: 'Every world and piece (Ctrl + Shift + O)' },
  { id: 'tags', label: 'Tags', about: 'Every #tag, grouped' }
];

// A world that's for life, not for making something.
export const isLife = (w) => w?.kind === 'world' && w.fields?.life === true;

// The tabs for where you are. ctx: { scope: 'desk' | 'world' | 'piece', life }.
export function tabsFor(ctx) {
  if (!ctx || ctx.scope === 'desk') return DESK.map((t) => ({ ...t, n: null }));
  const pages = ctx.life ? LIFE_PAGES : PAGES;
  return [{ id: 'overview', label: 'Overview', about: ctx.scope === 'world' ? 'The whole world at a glance' : 'This piece at a glance', n: 0 }, ...pages.map((t, i) => ({ ...t, n: i + 1 }))];
}

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};

export class PageStrip {
  // hooks: pick(tabId)
  constructor(el, hooks) {
    this.el = el;
    this.hooks = hooks;
    this.ctx = null;
    this.tabs = [];
  }

  set(ctx) {
    this.ctx = ctx;
    this.tabs = tabsFor(ctx);
    const key = JSON.stringify([ctx?.scope, ctx?.life, ctx?.active]);
    if (key === this.key) return;
    this.key = key;
    this.el.hidden = !ctx;
    this.el.dataset.scope = ctx?.scope || '';
    this.el.replaceChildren(...this.tabs.map((t) => {
      const b = make('button', 'pt-tab' + (t.id === ctx?.active ? ' on' : ''), t.label);
      b.dataset.page = t.id;
      b.title = t.n == null ? t.about : `${t.about} (Alt + ${t.n})`;
      if (t.id === ctx?.active) b.setAttribute('aria-current', 'page');
      if (t.n != null) b.append(make('span', 'pt-num', String(t.n)));
      b.addEventListener('click', () => this.hooks.pick(t.id));
      return b;
    }));
  }

  // Alt + a number: that page, if there's one with the number here.
  byNumber(n) { return this.tabs.find((t) => t.n === n)?.id || null; }
}

// ---------- the Today panel: today's lines, beside whatever you're doing ----------

const pad = (n) => String(n).padStart(2, '0');
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export class TodayPanel {
  // hooks: open(lineId), openDay(), added(rows), focusBack()
  constructor(el, hooks) {
    this.el = el;
    this.hooks = hooks;
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); } });
  }

  get isOpen() { return !this.el.hidden; }

  async toggle() { if (this.isOpen) this.close(); else await this.open(); }

  async open() {
    this.el.hidden = false;
    document.body.classList.add('today-on');
    await this.draw();
    this.el.querySelector('.tp-add')?.focus();
  }

  close() {
    this.el.hidden = true;
    document.body.classList.remove('today-on');
    this.hooks.focusBack?.();
  }

  refresh() { if (this.isOpen) return this.draw(); }

  async lines() {
    const id = `day-${isoToday()}`;
    const out = [];
    const walk = async (pid, depth) => {
      const kids = (await children(pid)).filter((r) => r.kind === 'line' && !r.deleted).sort((a, b) => (a.sort || 0) - (b.sort || 0));
      for (const k of kids) { out.push({ row: k, depth }); if (depth < 3) await walk(k.id, depth + 1); }
    };
    await walk(id, 0);
    return out;
  }

  async draw() {
    const day = new Date();
    const head = make('div', 'tp-head');
    const title = make('div', 'tp-title');
    title.append(make('span', 'panel-label', 'Today'), make('span', 'tp-date', day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })));
    const full = make('button', 'ghost-btn', 'Full page');
    full.title = 'Open today’s page (Ctrl + J)';
    full.addEventListener('click', () => { this.close(); this.hooks.openDay(); });
    const close = make('button', 'ghost-btn', 'Close');
    close.title = 'Close (Ctrl + Shift + J)';
    close.addEventListener('click', () => this.close());
    head.append(title, full, close);

    const add = make('input', 'tp-add');
    add.type = 'text';
    add.placeholder = 'Add a line to today…';
    add.setAttribute('aria-label', 'Add a line to today');
    add.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !add.value.trim()) return;
      e.preventDefault();
      const text = add.value.trim();
      add.value = '';
      const { rows } = await addLine([{ type: 'text', text }], {});
      await this.hooks.added(rows);
      await this.draw();
      this.el.querySelector('.tp-add')?.focus();
    });

    const list = make('ul', 'tp-lines');
    const lines = await this.lines();
    for (const { row, depth } of lines) {
      const text = (row.text || '').trim();
      if (!text && !row.fields?.mirror) continue;
      const li = make('li', row.fields?.done ? 'done' : '');
      li.style.setProperty('--depth', depth);
      const b = make('button', 'tp-line');
      b.append(lineWords(row));
      b.draggable = true;
      b.dataset.id = row.id;
      b.title = 'Open it on today’s page, or drag it where it belongs';
      b.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', text);
        e.dataTransfer.setData('application/x-inkwell-line', row.id);
        e.dataTransfer.effectAllowed = 'copyLink';
      });
      b.addEventListener('click', () => this.hooks.open(row.id));
      li.append(b);
      list.append(li);
    }
    const empty = make('p', 'hint', 'Nothing on today’s page yet. Type above, or Alt + C to talk.');
    empty.hidden = list.children.length > 0;
    const tip = make('p', 'hint tp-tip', 'Drag a line into what you’re writing, or onto a page in Gather.');
    tip.hidden = !list.children.length;
    this.el.replaceChildren(head, add, list, empty, tip);
  }
}

// A line's words, with its links shown as links (not run into the text).
export function lineWords(row, max = 400) {
  const el = document.createElement('span');
  let n = 0;
  for (const node of row.content || [{ type: 'text', text: row.text || '' }]) {
    if (n >= max) break;
    if (node.type === 'text') { const t = node.text.replace(/\s*#drawer\b/gi, '').slice(0, max - n); el.append(t); n += t.length; }
    else if (node.type === 'entryRef') { const r = document.createElement('span'); r.className = 'st-ref'; r.textContent = node.attrs?.title || ''; el.append(r); n += r.textContent.length; }
  }
  if (!el.textContent.trim()) el.textContent = '…';
  return el;
}

export const lineDragId = (e) => e.dataTransfer?.getData('application/x-inkwell-line') || '';
export const hasLineDrag = (e) => [...(e.dataTransfer?.types || [])].includes('application/x-inkwell-line');
export { getEntry };
