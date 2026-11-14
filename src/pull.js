// Pull from a project: a project's lines, open next to a planning view (Day,
// What's when, Week, Weeks ahead) to drag onto it. Beside the plan on a
// computer; in the bottom half on a phone, where sliding a line up by its dots
// folds the plan on top into a few big places to drop it on. The lines stay
// where they're written; dropped on the plan, they get a When (and a plain
// line becomes a task). The pane's title is the project switcher.

import { children, getEntry, isTrashed } from './db.js';
import { taskOf, whenWord, stepsPage, isoOf } from './tasks.js';

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};
const root = document.documentElement;
const phone = matchMedia('(max-width: 899px), (hover: none)');
const read = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };
const MAX_LINES = 600;

// hooks: sources() → [{ id, title, kind: 'world' | 'page', hint, color }],
// first() → the project to open on (the one you were last in), over(x, y),
// drop(x, y, ids) → Promise, start(ids), end(), when(ids, anchor),
// toast(text), changed() (the pane opened, closed or changed size).
export class Pull {
  constructor(hooks) {
    this.hooks = hooks;
    this.open = false; // asked for (it shows in planning views only)
    this.shown = false;
    this.id = read('pullFrom', null);
    this.picked = new Set();
    this.folds = new Set(read('pullOpen', []));
    this.closedKids = new Set();
    this.build();
    phone.addEventListener('change', () => this.layout());
    const bar = document.querySelector('.placebar');
    if (bar && window.ResizeObserver) new ResizeObserver(() => { if (this.isOpen) this.layout(); }).observe(bar);
    window.addEventListener('resize', () => this.layout());
  }

  get isOpen() { return this.open && this.shown; }

  build() {
    const el = (this.el = make('aside', 'pull'));
    el.setAttribute('aria-label', 'A project, to pull lines from');
    el.hidden = true;
    this.grab = make('div', 'pu-grab');
    this.grab.title = 'Drag to make this half taller or shorter';
    this.grab.setAttribute('aria-hidden', 'true');
    const head = make('div', 'pu-head');
    this.title = make('button', 'pu-title');
    this.title.title = 'Switch project: click, type a few letters, Enter';
    this.title.setAttribute('aria-haspopup', 'listbox');
    this.title.addEventListener('click', () => this.switcher());
    this.pickBar = make('span', 'pu-picks');
    this.pickWhen = make('button', 'pu-when', 'When');
    this.pickWhen.title = 'When for the lines picked (Alt + W)';
    this.pickWhen.addEventListener('click', () => this.hooks.when?.([...this.picked], this.pickWhen));
    this.pickBar.append(make('span', 'pu-count'), this.pickWhen);
    this.pickBar.hidden = true;
    const close = make('button', 'pu-x', '×');
    close.title = 'Close (Esc)';
    close.setAttribute('aria-label', 'Close the project');
    close.addEventListener('click', () => this.close());
    head.append(this.title, make('span', 'pu-space'), this.pickBar, close);
    this.body = make('div', 'pu-body');
    this.hint = make('p', 'pu-hint', phone.matches ? 'Slide a line up by its dots onto the plan. Tap lines to pick several.' : 'Drag a line by its dots onto the plan. Click lines to pick several, then drag them together or press Alt + W.');
    el.append(this.grab, head, this.body);
    document.body.append(el);
    this.resizer();
    this.body.addEventListener('pointerdown', (e) => this.down(e));
    this.body.addEventListener('click', (e) => this.click(e));
    // The phone's own long-press menu would end a slide.
    this.body.addEventListener('contextmenu', (e) => { if (e.target.closest('.pu-line')) e.preventDefault(); });
  }

  // ---------- opening and closing ----------

  async toggle() { if (this.isOpen) this.close(); else await this.start(); }

  async start(id = null) {
    if (id) this.id = id;
    if (!this.id || !(await this.alive(this.id))) this.id = (await this.hooks.first?.()) || null;
    if (!this.id || !(await this.alive(this.id))) {
      const any = (await this.hooks.sources?.()) || [];
      this.id = any[0]?.id || null;
    }
    this.open = true;
    this.shown = true;
    keep('pullFrom', this.id);
    this.layout();
    await this.draw();
    this.hooks.changed?.();
    if (!this.id) this.switcher();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.picked.clear();
    this.closeSwitch();
    this.layout();
    this.hooks.changed?.();
  }

  // The planning view came or went: the pane goes with it (and comes back).
  setShown(on) {
    if (this.shown === !!on) return;
    this.shown = !!on;
    if (!on) this.closeSwitch();
    this.layout();
    if (on && this.open) this.draw();
  }

  async alive(id) { const r = await getEntry(id); return !!r && !r.deleted && !isTrashed(r); }

  layout() {
    const on = this.isOpen;
    this.el.hidden = !on;
    const small = phone.matches;
    root.classList.toggle('pulling', on && !small);
    root.classList.toggle('pulling-phone', on && small);
    // On a phone it sits just above the bar at the bottom.
    const bar = document.querySelector('.placebar');
    const bh = small && bar && bar.offsetParent !== null ? bar.getBoundingClientRect().height : 0;
    root.style.setProperty('--bar-h', `${Math.round(bh)}px`);
    const h = Math.max(0.25, Math.min(0.75, read('pullH', 0.46)));
    root.style.setProperty('--pull-h', `${Math.round(innerHeight * h)}px`);
    this.hint.textContent = small ? 'Slide a line up by its dots onto the plan. Tap lines to pick several.' : 'Drag a line by its dots onto the plan. Click lines to pick several, then drag them together or press Alt + W.';
  }

  // The top of the bottom half, on a phone (the plan's lower edge).
  floor() { return this.isOpen && phone.matches ? this.el.getBoundingClientRect().top : 0; }

  // Make the bottom half taller or shorter by its top edge.
  resizer() {
    let y0 = null;
    let h0 = 0;
    this.grab.addEventListener('pointerdown', (e) => {
      y0 = e.clientY;
      h0 = this.el.getBoundingClientRect().height;
      try { this.grab.setPointerCapture(e.pointerId); } catch { /* gone */ }
      e.preventDefault();
    });
    this.grab.addEventListener('pointermove', (e) => {
      if (y0 == null) return;
      const h = Math.max(innerHeight * 0.25, Math.min(innerHeight * 0.75, h0 - (e.clientY - y0)));
      root.style.setProperty('--pull-h', `${Math.round(h)}px`);
    });
    const up = () => {
      if (y0 == null) return;
      y0 = null;
      keep('pullH', this.el.getBoundingClientRect().height / innerHeight);
      this.hooks.changed?.();
    };
    this.grab.addEventListener('pointerup', up);
    this.grab.addEventListener('pointercancel', up);
  }

  // ---------- what's in it ----------

  soon() {
    if (!this.isOpen || this.dragging) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.draw(), 120);
  }

  // The project's own lines (its Steps), then its pages, each folded until
  // asked for; a page on its own is just its lines.
  async sections(id) {
    const r = await getEntry(id);
    if (!r || r.deleted) return { title: 'Pick a project', sections: [] };
    if (r.kind === 'world') {
      const pages = (await children(id)).filter((p) => p.kind === 'page' && p.id !== stepsPage(id));
      return { title: r.title || 'Untitled', sections: [{ id: stepsPage(id), title: null }, ...pages.map((p) => ({ id: p.id, title: p.title || 'Untitled page' }))] };
    }
    return { title: r.kind === 'day' ? new Date(`${r.title}T12:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : r.title || 'Untitled', sections: [{ id, title: null }] };
  }

  async lines(parent, depth, out) {
    for (const r of await children(parent)) {
      if (out.length >= MAX_LINES) return;
      if (r.kind !== 'line' || r.fields?.mirror || r.fields?.done) continue;
      const text = String(r.text || '').trim();
      if (text) out.push({ row: r, depth });
      if (depth < 6 && !this.closedKids.has(r.id)) await this.lines(r.id, text ? depth + 1 : depth, out);
      else if (this.closedKids.has(r.id) && out.at(-1)?.row === r) out.at(-1).folded = true;
    }
  }

  async draw() {
    if (!this.isOpen) return;
    const turn = (this.turn = (this.turn || 0) + 1);
    const { title, sections } = await this.sections(this.id);
    const today = isoOf();
    const parts = [];
    for (const sec of sections) {
      const open = !sec.title || this.folds.has(sec.id);
      if (sec.title) {
        const b = make('button', `pu-sec${open ? ' open' : ''}`);
        b.dataset.sec = sec.id;
        b.setAttribute('aria-expanded', String(open));
        b.append(make('span', 'pu-tri', open ? '▾' : '▸'), make('span', '', sec.title));
        parts.push(b);
      }
      if (!open) continue;
      const out = [];
      await this.lines(sec.id, 0, out);
      for (const { row, depth } of out) parts.push(this.line(row, depth, today));
      if (!out.length && !sec.title) parts.push(make('p', 'pu-empty', 'No open lines here yet.'));
    }
    if (turn !== this.turn) return;
    // Never pull the rows out from under a line being dragged; draw after.
    if (this.dragging) { this.later = true; return; }
    this.title.replaceChildren(make('span', 'pu-name', title), make('span', 'pu-caret', '▾'));
    // Nothing changed: the rows stay as they are (a tap on one isn't lost).
    // A row that's the same as before is kept as it is (a tap on it isn't lost).
    const was = new Map([...this.body.children].map((x) => [x.outerHTML, x]));
    const next = parts.map((x) => was.get(x.outerHTML) || x);
    if (next.some((x, n) => this.body.children[n] !== x) || this.body.children.length !== next.length + 1) this.body.replaceChildren(...next, this.hint);
    this.showPicks();
  }

  line(row, depth, today) {
    const t = taskOf(row);
    const el = make('div', `pu-line${t ? ' task' : ''}${this.picked.has(row.id) ? ' sel' : ''}`);
    el.dataset.id = row.id;
    el.style.setProperty('--d', String(depth));
    const grip = make('span', 'pu-grip', '⠿');
    grip.setAttribute('aria-hidden', 'true');
    grip.title = phone.matches ? 'Slide up onto the plan' : 'Drag onto the plan';
    const kids = this.closedKids.has(row.id);
    el.append(grip, make('span', `pu-ring${t ? '' : ' plain'}`), make('span', 'pu-words', row.text || ''));
    const word = t ? whenWord(t, today) : '';
    if (word) el.append(make('span', 'pu-whenis', word));
    if (kids) el.classList.add('folded');
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', String(this.picked.has(row.id)));
    el.tabIndex = -1;
    return el;
  }

  // ---------- picking several ----------

  click(e) {
    const sec = e.target.closest('.pu-sec');
    if (sec) {
      if (this.folds.has(sec.dataset.sec)) this.folds.delete(sec.dataset.sec); else this.folds.add(sec.dataset.sec);
      keep('pullOpen', [...this.folds].slice(-60));
      this.draw();
      return;
    }
    const line = e.target.closest('.pu-line');
    if (!line || this.justDragged) return;
    const id = line.dataset.id;
    if (this.picked.has(id)) this.picked.delete(id); else this.picked.add(id);
    line.classList.toggle('sel', this.picked.has(id));
    line.setAttribute('aria-selected', String(this.picked.has(id)));
    this.showPicks();
  }

  showPicks() {
    for (const id of [...this.picked]) if (!this.body.querySelector(`[data-id="${CSS.escape(id)}"]`)) this.picked.delete(id);
    this.pickBar.hidden = !this.picked.size;
    this.pickBar.querySelector('.pu-count').textContent = `${this.picked.size} picked`;
  }

  unpick() {
    this.picked.clear();
    for (const l of this.body.querySelectorAll('.pu-line.sel')) { l.classList.remove('sel'); l.setAttribute('aria-selected', 'false'); }
    this.showPicks();
  }

  // Esc: lets go of what's picked, or closes.
  escape() {
    if (this.switchEl) { this.closeSwitch(); return true; }
    if (this.picked.size) { this.unpick(); return true; }
    if (!this.isOpen) return false;
    this.close();
    return true;
  }

  // ---------- dragging a line onto the plan ----------

  // The dots under a finger slide the line at once; with a mouse the whole
  // line can be dragged. A click (or a tap on the words) picks it.
  down(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const line = e.target.closest('.pu-line');
    if (!line) return;
    const grip = !!e.target.closest('.pu-grip');
    if (e.pointerType !== 'mouse' && !grip) return;
    const id = line.dataset.id;
    const ids = this.picked.has(id) ? [...this.picked] : [id];
    const x0 = e.clientX;
    const y0 = e.clientY;
    const target = grip ? e.target.closest('.pu-grip') : line;
    try { target.setPointerCapture(e.pointerId); } catch { /* not ours */ }
    if (grip || e.pointerType === 'mouse') e.preventDefault();
    let lift = null;
    let last = { x: x0, y: y0 };
    let raf = 0;
    const begin = () => {
      this.dragging = true;
      lift = make('div', 'pu-lift');
      lift.textContent = line.querySelector('.pu-words')?.textContent || '';
      if (ids.length > 1) lift.dataset.more = `+${ids.length - 1}`;
      document.body.append(lift);
      line.classList.add('dragging');
      root.classList.add('pull-dragging');
      navigator.vibrate?.(8);
      this.hooks.start?.(ids);
      // Near the top or bottom of the window, the plan scrolls along.
      const step = () => {
        if (!lift) return;
        const edge = 60;
        const floor = phone.matches ? this.floor() : innerHeight;
        if (!phone.matches) {
          const sp = last.y < edge ? -Math.ceil((edge - last.y) / 5) : last.y > floor - edge && last.y < floor ? Math.ceil((last.y - (floor - edge)) / 5) : 0;
          if (sp) { window.scrollBy(0, sp); this.hooks.over?.(last.x, last.y); }
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      last = { x: ev.clientX, y: ev.clientY };
      if (!lift) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        begin();
      }
      ev.preventDefault?.();
      Object.assign(lift.style, { left: `${ev.clientX + 12}px`, top: `${ev.clientY - (phone.matches ? 46 : 14)}px` });
      this.hooks.over?.(ev.clientX, phone.matches ? ev.clientY - 10 : ev.clientY);
    };
    const up = async (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      try { target.releasePointerCapture(e.pointerId); } catch { /* let go */ }
      if (!lift) return;
      cancelAnimationFrame(raf);
      lift.remove();
      lift = null;
      line.classList.remove('dragging');
      root.classList.remove('pull-dragging');
      this.justDragged = true;
      setTimeout(() => { this.justDragged = false; }, 0);
      // The ones picked go with it; a tap from now on starts a new pick.
      this.unpick();
      try {
        if (ev.type === 'pointerup') await this.hooks.drop?.(ev.clientX, phone.matches ? ev.clientY - 10 : ev.clientY, ids);
        else this.hooks.end?.();
      } finally {
        this.dragging = false;
        this.later = false;
        this.soon();
      }
    };
    // On the document: the row can be drawn again while it's held.
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
  }

  // ---------- the switcher in the title ----------

  async switcher() {
    if (this.switchEl) { this.closeSwitch(); return; }
    const all = (await this.hooks.sources?.()) || [];
    const box = (this.switchEl = make('div', 'pu-switch'));
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Switch project');
    const input = make('input', 'pu-find');
    input.type = 'text';
    input.placeholder = 'A project or page…';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Find a project or page');
    const list = make('div', 'pu-opts');
    list.setAttribute('role', 'listbox');
    box.append(input, list);
    let hi = 0;
    let shown = [];
    const fits = (o, q) => !q || o.title.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || o.title.toLowerCase().includes(q);
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      shown = all.filter((o) => fits(o, q)).slice(0, 40);
      hi = Math.max(0, Math.min(hi, shown.length - 1));
      list.replaceChildren(...shown.map((o, n) => {
        const b = make('button', `pu-opt${n === hi ? ' hi' : ''}${o.id === this.id ? ' current' : ''}`);
        b.setAttribute('role', 'option');
        const dot = make('i', 'pu-dot');
        if (o.color) dot.style.background = o.color;
        b.append(dot, make('span', 'pu-on', o.title || 'Untitled'));
        if (o.hint) b.append(make('span', 'pu-oh', o.hint));
        b.addEventListener('click', () => this.pick(o.id));
        return b;
      }));
      if (!shown.length) list.append(make('p', 'pu-empty', 'Nothing by that name.'));
      list.querySelector('.hi')?.scrollIntoView?.({ block: 'nearest' });
    };
    input.addEventListener('input', () => { hi = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); hi = (hi + 1) % Math.max(1, shown.length); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hi = (hi - 1 + shown.length) % Math.max(1, shown.length); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[hi]) this.pick(shown[hi].id); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeSwitch(); this.title.focus(); }
    });
    this.el.append(box);
    draw();
    if (!phone.matches) input.focus();
    this.outside = (e) => { if (!box.contains(e.target) && !this.title.contains(e.target)) this.closeSwitch(); };
    setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0);
  }

  closeSwitch() {
    if (!this.switchEl) return;
    this.switchEl.remove();
    this.switchEl = null;
    document.removeEventListener('pointerdown', this.outside, true);
  }

  // Switching never moves or closes the plan.
  async pick(id) {
    this.closeSwitch();
    this.id = id;
    this.picked.clear();
    keep('pullFrom', id);
    this.body.scrollTop = 0;
    await this.draw();
  }
}
