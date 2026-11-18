// One box for going, doing and adding: Ctrl + K (or Ctrl + O) on a computer,
// the Go button on a phone (a sheet from the bottom).
//
// Just opened: Jump back (Enter takes the first), the rooms, this project's
// pages when you're in one, "Right here" (the few commands that fit the room
// you're in), and "All commands ›".
// Typing: one list, best match first, of places, pages, pieces, tasks,
// commands and Catch-up lines, each saying what it is; then "+ Add task"
// (Ctrl + Enter; a word at the end sets the day), "+ Add a line to today's
// page" (Shift + Enter), and the deep search of every word (Ctrl + Shift + F).
// All commands: every command in groups, each with one line on what it does.
// On a computer two columns (groups, then the group's commands); on a phone a
// full-height sheet whose groups fold open in place. A command that can't
// run where you are is shown dimmed, with the reason.

import { GROUPS } from './commandinfo.js';
import { whenChoices } from './when.js';
import { addDays, dateOf, isoOf } from './tasks.js';
import { make } from './dom.js';

const USED = 'boxUsed';
const KEEP_USED = 8;
const HERE_MAX = 4;

// Straight and curly apostrophes are the same thing here ("what's when").
export const norm = (t) => String(t || '').toLowerCase().replace(/[’‘']/g, '').replace(/\s+/g, ' ').trim();

// How well a thing matches what's typed (lower is better, null: not at all).
// Its name first: the whole of it, then starting with it, then a word
// starting with it, then anywhere; then a name holding every word typed;
// then (for commands) its other words and its one line.
export function score(item, q, words) {
  const l = item.n;
  if (l === q) return 0;
  if (l.startsWith(q)) return l[q.length] === ' ' || l[q.length] === ':' ? 1 : 1.5;
  if (l.includes(` ${q}`)) return 2;
  if (l.includes(q)) return 3;
  if (words.length > 1 && words.every((w) => l.includes(w))) return 4;
  if (item.more) {
    if (item.more.some((w) => w.startsWith(q))) return 5;
    const all = `${l} ${item.more.join(' ')} ${item.h}`;
    if (words.every((w) => all.includes(` ${w}`) || all.startsWith(w))) return 6;
  }
  return null;
}

// "Call the dentist fri" → { title: 'Call the dentist', when: Friday }.
// The word or two at the end that names a day, a week, a month or Later,
// as the When picker names them. today: YYYY-MM-DD.
export function splitWhen(text, today = isoOf()) {
  const t = String(text || '').trim();
  const words = t.split(/\s+/);
  const choices = whenChoices(today).filter((c) => !c.chip && c.id !== 'none' && c.id !== 'date');
  const heads = new Map(choices.map((c) => [c.label.toLowerCase(), c]));
  const take = (n, choice) => {
    const title = words.slice(0, -n).join(' ').replace(/[,;:–-]+$/, '').trim();
    return title ? { title, choice } : null;
  };
  if (words.length > 2) {
    const two = words.slice(-2).join(' ').toLowerCase();
    if (heads.has(two)) return take(2, heads.get(two));
  }
  if (words.length > 1) {
    const one = words.at(-1).toLowerCase().replace(/[.!]$/, '');
    if (heads.has(one)) return take(1, heads.get(one));
    if (['tmr', 'tmrw', 'tomorow'].includes(one)) return take(1, heads.get('tomorrow'));
    // A weekday: the next one to come (tomorrow's is Tomorrow).
    if (one.length >= 3) {
      for (let n = 1; n <= 7; n++) {
        const iso = addDays(today, n);
        const name = dateOf(iso).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        if (name === one || (name.startsWith(one) && (one.length >= 3))) {
          if (n === 1) return take(1, heads.get('tomorrow'));
          const label = `${dateOf(iso).toLocaleDateString('en-US', { weekday: 'short' })}, ${dateOf(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
          return take(1, { id: `day-${iso}`, label, when: { day: iso } });
        }
      }
    }
  }
  return { title: t, choice: heads.get('today') };
}

export class Box {
  // el: the .palette element (input #palette-input, list #palette-list).
  // hooks: commands() → [command], usable(c), recent() → [{ place, name, context }],
  // jump(place), tabs() → { title, tabs } | null,
  // here() → the room tags for where you are, places() → Promise [{ label, what, run }],
  // tasks() → Promise [{ label, what, run }], catchup() → [{ label, what, run }],
  // addTask(title, choice, text), addLine(text), search(text), isTouch(), keyLabel(text),
  // closed(refocus), toast(text)
  constructor(el, hooks) {
    this.el = el;
    this.hooks = hooks;
    this.input = el.querySelector('#palette-input');
    this.list = el.querySelector('#palette-list');
    this.active = false;
    this.all = false;
    this.items = [];
    this.index = 0;
    this.side = 'list';
    this.group = null;
    this.folded = new Set();
    this.pushed = false;
    // The All commands columns (computer) and the sheet's head (phone).
    this.head = make('div', 'box-head');
    this.backBtn = make('button', 'box-back', '‹ Back');
    this.backBtn.addEventListener('click', () => this.short());
    this.head.append(this.backBtn, make('span', 'box-title', 'All commands'));
    this.head.hidden = true;
    this.groupsEl = make('ul', 'box-groups');
    this.groupsEl.setAttribute('role', 'listbox');
    this.groupsEl.setAttribute('aria-label', 'Groups');
    this.groupsEl.hidden = true;
    this.cols = make('div', 'box-cols');
    this.list.replaceWith(this.cols);
    this.cols.append(this.groupsEl, this.list);
    el.prepend(this.head);
    this.foot = make('p', 'box-foot');
    this.foot.hidden = true;
    el.append(this.foot);
    this.input.addEventListener('input', () => { if (this.active) { this.side = 'list'; this.draw(); } });
    this.input.addEventListener('keydown', (e) => { if (this.active) this.key(e); });
    // Esc works with the caret anywhere (on a phone the box opens without it).
    document.addEventListener('keydown', (e) => { if (this.active && e.key === 'Escape' && e.target !== this.input) this.key(e); });
    // On a phone, the sheet rises above the keyboard while you type in it.
    const vv = window.visualViewport;
    const fit = () => { if (vv) el.style.setProperty('--box-vh', `${Math.round(vv.height)}px`); };
    vv?.addEventListener('resize', fit);
    fit();
    this.input.addEventListener('focus', () => { if (this.active && this.hooks.isTouch()) el.classList.add('box-typing'); });
    this.input.addEventListener('blur', () => el.classList.remove('box-typing'));
    // A tap on the list while typing keeps the keyboard (and the sheet) where
    // they are, so the row under your finger is the one that runs.
    this.cols.addEventListener('pointerdown', (e) => { if (el.classList.contains('box-typing')) e.preventDefault(); });
  }

  get open() { return this.active && !this.el.hidden; }

  // Opened (the palette is already shown and its input empty).
  start({ all = false, find = true } = {}) {
    this.active = true;
    this.projects = this.projects || [];
    this.el.classList.add('box');
    this.el.setAttribute('aria-label', 'Go, do, or add a task');
    this.input.placeholder = this.hooks.isTouch() ? 'Go, do, or type a task…' : 'Go anywhere, do anything, or type a task…';
    this.loadMore();
    this.all = false;
    this.setAll(all, true);
    if (!find) this.input.blur();
  }

  // The places and tasks to search, read once each time the box opens (the
  // task and page indexes in the database), so each key only filters.
  loadMore() {
    this.places = null;
    this.tasks = null;
    const turn = (this.turn = {});
    delete this.el.dataset.loaded;
    // Your projects, in your Desk order, for the just-opened box.
    const projects = Promise.resolve().then(() => this.hooks.projects?.()).then((list) => { if (turn === this.turn) { this.projects = list || []; if (!this.input.value.trim() && !this.all) { const at = this.index; this.draw(); this.index = at; this.mark(false); } } }).catch(() => {});
    const places = Promise.resolve().then(() => this.hooks.places()).catch(() => []);
    const tasks = Promise.resolve().then(() => this.hooks.tasks()).catch(() => []);
    places.then((list) => { if (turn === this.turn) { this.places = list; if (this.input.value.trim() && !this.all) this.draw(); } });
    tasks.then((list) => { if (turn === this.turn) { this.tasks = list; if (this.input.value.trim() && !this.all) this.draw(); } });
    this.ready = Promise.all([places, tasks]);
    // Marked once everything has been read and drawn (the tests wait on it).
    Promise.all([projects, this.ready]).then(() => { if (turn === this.turn) this.el.dataset.loaded = ''; });
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.el.classList.remove('box', 'box-all', 'box-typing');
    this.head.hidden = true;
    this.groupsEl.hidden = true;
    this.foot.hidden = true;
    if (this.pushed) { this.pushed = false; this.popping = true; history.back(); }
  }

  // Android's back (and the browser's) while All commands is open: back to the short box.
  popped() {
    if (this.popping) { this.popping = false; return true; }
    if (this.active && this.all && this.pushed) { this.pushed = false; this.short(true); return true; }
    return false;
  }

  short(fromPop = false) {
    if (!fromPop && this.pushed) { this.pushed = false; this.popping = true; history.back(); }
    this.setAll(false);
  }

  setAll(on, fresh = false) {
    if (!fresh && on === this.all) return;
    this.all = on;
    this.el.classList.toggle('box-all', on);
    this.head.hidden = !(on && this.hooks.isTouch());
    this.groupsEl.hidden = !on || this.hooks.isTouch();
    this.input.value = '';
    this.input.placeholder = on ? (this.hooks.isTouch() ? 'Type a word, any word…' : 'All commands. Type to narrow the list…') : this.hooks.isTouch() ? 'Go, do, or type a task…' : 'Go anywhere, do anything, or type a task…';
    this.group = on ? 'used' : null;
    if (on && !this.usedList().length) this.group = 'here';
    if (on && !this.hereList().length && this.group === 'here') this.group = GROUPS[0].id;
    this.side = on && !this.hooks.isTouch() ? 'groups' : 'list';
    // A phone's Back button closes All commands first.
    if (on && this.hooks.isTouch() && !this.pushed) { history.pushState(history.state, ''); this.pushed = true; }
    // A phone keeps its keyboard down until you tap the search field.
    if (!this.hooks.isTouch()) this.input.focus();
    this.draw();
  }

  // ---------- what's listed ----------

  commands() { return this.hooks.commands().filter((c) => !c.urgent || this.hooks.usable(c)); }
  can(c) { return this.hooks.usable(c); }
  // A command that can't run here: listed (dimmed) when it can say why, else left out.
  shown(c) { return this.can(c) || !!c.needs; }

  usedList() {
    let names = [];
    try { names = JSON.parse(localStorage.getItem(USED) || '[]'); } catch { names = []; }
    const by = new Map(this.commands().map((c) => [c.label, c]));
    return names.map((n) => by.get(n)).filter((c) => c && this.shown(c));
  }
  remember(c) {
    if (!c?.label || !c.group) return;
    let names = [];
    try { names = JSON.parse(localStorage.getItem(USED) || '[]'); } catch { names = []; }
    names = [c.label, ...names.filter((n) => n !== c.label)].slice(0, KEEP_USED);
    try { localStorage.setItem(USED, JSON.stringify(names)); } catch { /* full */ }
  }
  // The commands that fit the room you're in.
  hereList(max = 99) {
    const at = new Set(this.hooks.here());
    return this.commands().filter((c) => c.where?.some((w) => at.has(w)) && this.can(c)).sort((a, b) => (a.rank ?? 900) - (b.rank ?? 900)).slice(0, max);
  }
  hereName() {
    const at = this.hooks.here();
    const names = { today: 'on Today', plan: 'in Plan', calendar: 'in Calendar', desk: 'on the Desk', library: 'in the Library', write: 'in this chapter', script: 'in this script', page: 'on this page', world: 'in this project' };
    return `Right here${names[at[0]] ? `, ${names[at[0]]}` : ''}`;
  }
  inGroup(id) {
    if (id === 'used') return this.usedList();
    if (id === 'here') return this.hereList();
    return this.commands().filter((c) => c.group === id && this.shown(c)).sort((a, b) => (a.rank ?? 900) - (b.rank ?? 900));
  }
  groupList() {
    const out = [];
    if (this.usedList().length) out.push({ id: 'used', label: 'Used lately' });
    if (this.hereList().length) out.push({ id: 'here', label: this.hereName() });
    return [...out, ...GROUPS];
  }

  // ---------- drawing ----------

  draw() {
    this.items = [];
    this.list.replaceChildren();
    this.foot.hidden = true;
    const q = norm(this.input.value);
    if (this.all) this.drawAll(q);
    else if (q) this.drawFound(q);
    else this.drawStart();
    if (this.index >= this.items.length) this.index = 0;
    this.mark();
  }

  section(label, cls = '') {
    const li = make('li', `box-sec ${cls}`, label);
    li.setAttribute('role', 'presentation');
    this.list.append(li);
    return li;
  }
  // A selectable row: { label, hint, what (right side), keys, dim, run, stay, cls }.
  row(it, into = this.list) {
    const li = make('li', `box-row ${it.cls || ''}`);
    li.setAttribute('role', 'option');
    const main = make('span', 'label');
    main.append(make('span', 'box-name', it.label));
    if (it.hint) main.append(make('span', 'hint', it.hint));
    li.append(main);
    const right = make('span', 'keys', it.side || '');
    li.append(right);
    if (it.dim) { li.classList.add('dim'); li.setAttribute('aria-disabled', 'true'); }
    if (it.stay) li.classList.add('opens');
    const i = this.items.length;
    it.el = li;
    this.items.push(it);
    li.addEventListener('click', () => this.run(it));
    li.addEventListener('mousemove', () => { if (this.index !== i || this.side !== 'list') { this.side = 'list'; this.index = i; this.mark(false); } });
    into.append(li);
    return li;
  }
  // A row of chips (Jump back, rooms, this project's pages); each chip is an item.
  chips(list, cls = '') {
    const li = make('li', `box-chips ${cls}`);
    li.setAttribute('role', 'presentation');
    for (const it of list) {
      const b = make('button', `box-chip ${it.cls || ''}`);
      b.tabIndex = -1;
      b.append(make('span', 'go-name', it.label));
      if (it.ctx) b.append(make('span', 'go-ctx', `· ${it.ctx}`));
      if (it.keys && !this.hooks.isTouch()) b.append(make('span', 'keys', it.keys));
      if (it.on) b.setAttribute('aria-current', 'page');
      const i = this.items.length;
      it.el = b;
      it.chip = true;
      this.items.push(it);
      b.addEventListener('click', () => this.run(it));
      b.addEventListener('mousemove', () => { if (this.index !== i) { this.index = i; this.mark(false); } });
      li.append(b);
    }
    this.list.append(li);
  }
  // What a command row says at the right: its key, or what it is.
  cmdRow(c, { kind = false } = {}) {
    const k = this.hooks.isTouch() ? '' : this.hooks.keyLabel(c.keys || '');
    const dim = !this.can(c);
    return {
      label: c.label, hint: dim ? c.needs : c.hint, dim, cmd: c,
      side: kind ? (k ? `command · ${k}` : 'command') : k,
      stay: dim,
      run: () => (dim ? this.hooks.toast(c.needs) : this.hooks.runCommand(c))
    };
  }

  drawStart() {
    const touch = this.hooks.isTouch();
    const urgent = this.hooks.commands().filter((c) => c.urgent && this.hooks.usable(c));
    for (const c of urgent) this.row({ ...this.cmdRow(c), cls: 'urgent' });
    // Focus and Look first, in every room: one tap each.
    this.quick();
    const recent = this.hooks.recent().slice(0, touch ? 4 : 5);
    if (recent.length) {
      this.section('Jump back');
      this.chips(recent.map((r, i) => ({ label: r.name, ctx: r.context, keys: i === 0 ? 'Enter' : '', cls: i === 0 ? 'first' : '', run: () => this.hooks.jump(r.place) })), 'box-recent');
    }
    const tabs = this.hooks.tabs();
    if (tabs) {
      this.section(tabs.title);
      this.chips(tabs.tabs.map((t) => ({ label: t.label, keys: t.keys, on: t.on, run: t.run })), 'box-tabs');
    }
    if (this.projects?.length) {
      this.section('Projects');
      this.chips(this.projects.map((w) => ({ label: w.title || 'Untitled', on: w.current, run: () => this.hooks.openProject(w.id) })), 'box-projects');
    }
    const here = this.hereList(HERE_MAX);
    if (here.length) {
      this.section(this.hereName());
      for (const c of here) this.row({ ...this.cmdRow(c), hint: '', side: touch ? '' : this.hooks.keyLabel(c.keys || '') || 'command' });
    }
    this.row({ label: 'All commands', cls: 'box-allrow', side: touch ? '›' : `${this.hooks.keyLabel('⌘K')} again ›`, stay: true, run: () => this.setAll(true) });
    // Enter on a just-opened box takes you back (the first of Jump back).
    const first = this.items.findIndex((x) => x.cls === 'first');
    // (never Focus or Look: Enter on an empty box shouldn't flip a switch).
    this.index = urgent.length ? 0 : first >= 0 ? first : Math.min(this.items.length - 1, 2);
  }

  // Focus (with its switch) and Aa Look, side by side at the top of the box.
  quick() {
    const touch = this.hooks.isTouch();
    const on = !!this.hooks.focusOn?.();
    const li = make('li', 'box-chips box-quick');
    li.setAttribute('role', 'presentation');
    const items = [
      { label: 'Focus', ctx: touch ? 'just the text' : this.hooks.keyLabel('⌘.'), cls: 'box-focus', sw: on, run: () => this.hooks.toggleFocus() },
      { label: 'Aa Look', ctx: touch ? 'colours, text, what shows' : '', cls: 'box-look', run: () => this.hooks.look() }
    ];
    for (const it of items) {
      const b = make('button', `box-chip ${it.cls}`);
      b.tabIndex = -1;
      const words = make('span', 'bq-words');
      words.append(make('span', 'go-name', it.label));
      if (it.ctx) words.append(make('span', 'bq-ctx', it.ctx));
      b.append(words);
      if ('sw' in it) { b.setAttribute('aria-pressed', String(it.sw)); b.append(make('span', 'bq-sw')); }
      const i = this.items.length;
      it.el = b; it.chip = true;
      this.items.push(it);
      b.addEventListener('click', () => this.run(it));
      b.addEventListener('mousemove', () => { if (this.index !== i) { this.index = i; this.mark(false); } });
      li.append(b);
    }
    this.list.append(li);
  }
  // Focus changed while the box is open (a key): its switch follows.
  refreshQuick() {
    const b = this.list.querySelector('.box-focus');
    if (b) b.setAttribute('aria-pressed', String(!!this.hooks.focusOn?.()));
  }

  // Everything that matches, best first.
  found(q) {
    const words = q.split(' ').filter(Boolean);
    const out = [];
    const kinds = { place: 0, task: 1, command: 2, catchup: 3 };
    const add = (item, kind, i) => {
      let s = score(item, q, words);
      // "Chapter 2 · Untitled novel": the name with where it is, as the row shows it.
      if (s == null && item.what) { s = score({ n: norm(`${item.label} · ${item.what}`) }, q, words); if (s != null) s += 3; }
      if (s != null) out.push({ item, kind, s: s + (item.dim ? 10 : 0), i });
    };
    (this.places || []).forEach((p, i) => add(p.n ? p : Object.assign(p, { n: norm(p.label) }), 'place', i));
    (this.tasks || []).forEach((t, i) => add(t.n ? t : Object.assign(t, { n: norm(t.label) }), 'task', i));
    this.commands().filter((c) => this.shown(c)).forEach((c, i) => {
      const it = { n: norm(c.label), more: (c.words || []).map(norm), h: norm(c.hint), c, dim: !this.can(c) };
      add(it, 'command', i);
    });
    (this.hooks.catchup() || []).forEach((u, i) => add(u.n ? u : Object.assign(u, { n: norm(u.label) }), 'catchup', i));
    out.sort((a, b) => a.s - b.s || kinds[a.kind] - kinds[b.kind] || a.i - b.i);
    return out;
  }

  drawFound(q) {
    const raw = this.input.value.trim();
    const hits = this.found(q).slice(0, 40);
    for (const h of hits) {
      if (h.kind === 'command') this.row(this.cmdRow(h.item.c, { kind: true }));
      else this.row({ label: h.item.label, side: h.item.what, run: h.item.run });
    }
    const exact = hits.some((h) => h.s === 0 && (h.kind === 'command' || h.kind === 'place'));
    if (!exact) {
      const { title, choice } = splitWhen(raw);
      const day = choice.id === 'today' ? 'today' : choice.label;
      this.row({ label: `+ Add task for ${day}: “${title}”`, cls: 'box-add', side: this.hooks.isTouch() ? '' : this.hooks.keyLabel(hits.length ? 'Ctrl+Enter' : 'Enter'), add: true, run: () => this.hooks.addTask(title, choice, raw) });
      this.row({ label: `+ Add a line to today’s page: “${raw}”`, cls: 'box-add line', side: this.hooks.isTouch() ? '' : this.hooks.keyLabel('Shift+Enter'), run: () => this.hooks.addLine(raw) });
    }
    if (hits.length < 3) this.row({ label: 'Not finding it? Browse all commands', cls: 'box-allrow', side: '›', stay: true, run: () => this.setAll(true) });
    this.row({ label: `Search every word of your writing for “${raw}”`, cls: 'box-deep', side: this.hooks.isTouch() ? '' : this.hooks.keyLabel('⌘⇧F'), stay: true, run: () => this.hooks.search(raw) });
    this.index = 0;
  }

  drawAll(q) {
    const touch = this.hooks.isTouch();
    const groups = this.groupList();
    if (q) {
      // Typing narrows every group at once, under its heading.
      const words = q.split(' ').filter(Boolean);
      const match = (c) => score({ n: norm(c.label), more: (c.words || []).map(norm), h: norm(c.hint) }, q, words) != null;
      let any = false;
      const left = [];
      for (const g of GROUPS) {
        const list = this.inGroup(g.id).filter(match);
        if (!list.length) continue;
        any = true;
        left.push(g);
        this.section(g.label, 'box-gh');
        for (const c of list) this.row(this.cmdRow(c));
      }
      if (!any) this.section('Nothing by that name. Try a word for what it does: “move”, “print”, “dark”.', 'box-none');
      if (!touch) this.drawGroups(left, null);
      this.index = this.side === 'list' ? Math.min(this.index, Math.max(0, this.items.length - 1)) : 0;
      this.foot.hidden = touch;
      this.foot.textContent = 'Up and Down move · Enter runs it · Esc back to the short box';
      return;
    }
    if (touch) {
      // Each group a heading that folds open in place.
      for (const g of groups) {
        const open = !this.folded.has(g.id) && (g.id === this.group || this.openGroups?.has(g.id));
        const head = this.row({ label: g.label, hint: '', side: open ? '▾' : '▸', cls: 'box-fold', stay: true, run: () => this.fold(g.id) });
        head.setAttribute('aria-expanded', String(!!open));
        if (open) for (const c of this.inGroup(g.id)) this.row({ ...this.cmdRow(c), cls: 'box-in' });
      }
      return;
    }
    // A computer: the groups at the left, the chosen group's commands at the right.
    this.drawGroups(groups, this.group);
    for (const c of this.inGroup(this.group)) this.row(this.cmdRow(c));
    this.foot.hidden = false;
    this.foot.textContent = 'Up and Down move · Right goes into a group, Left comes back · Enter runs it · Esc back to the short box';
  }

  fold(id) {
    this.openGroups = this.openGroups || new Set([this.group]);
    if (this.openGroups.has(id) && !this.folded.has(id)) { this.openGroups.delete(id); this.folded.add(id); }
    else { this.openGroups.add(id); this.folded.delete(id); }
    const at = this.items.findIndex((x) => x.label === this.groupList().find((g) => g.id === id)?.label);
    this.draw();
    this.index = Math.max(0, at);
    this.mark();
  }

  drawGroups(groups, on) {
    this.groupsEl.replaceChildren();
    this.groupItems = groups.map((g) => {
      const li = make('li', 'box-group', g.label);
      li.setAttribute('role', 'option');
      li.dataset.id = g.id;
      if (g.id === on) li.setAttribute('aria-current', 'true');
      li.addEventListener('click', () => { this.group = g.id; this.side = 'list'; this.input.value = ''; this.index = 0; this.draw(); this.input.focus(); });
      this.groupsEl.append(li);
      return { id: g.id, el: li };
    });
  }

  mark(scroll = true) {
    const gi = this.groupItems?.findIndex((g) => g.id === this.group) ?? -1;
    (this.groupItems || []).forEach((g, j) => g.el.setAttribute('aria-selected', String(this.all && this.side === 'groups' && j === gi)));
    this.items.forEach((it, j) => it.el.setAttribute('aria-selected', String(this.side === 'list' && j === this.index)));
    const at = this.side === 'groups' ? this.groupItems?.[gi]?.el : this.items[this.index]?.el;
    if (scroll) at?.scrollIntoView?.({ block: 'nearest' });
  }

  // ---------- keys ----------

  key(e) {
    const empty = !this.input.value;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      if (this.all && this.side === 'groups') {
        const gs = this.groupItems || [];
        const gi = gs.findIndex((g) => g.id === this.group);
        const next = gs[Math.min(gs.length - 1, Math.max(0, gi + d))];
        if (next) { this.group = next.id; this.index = 0; this.draw(); }
        return;
      }
      this.index = Math.min(this.items.length - 1, Math.max(0, this.index + d));
      this.mark();
      return;
    }
    if (this.all && !this.hooks.isTouch() && empty && e.key === 'ArrowRight' && this.side === 'groups') { e.preventDefault(); this.side = 'list'; this.index = 0; this.mark(); return; }
    if (this.all && !this.hooks.isTouch() && empty && e.key === 'ArrowLeft' && this.side === 'list') { e.preventDefault(); this.side = 'groups'; this.mark(); return; }
    if (!this.all && empty && e.key === 'ArrowRight' && this.items[this.index]?.chip) { e.preventDefault(); this.index = Math.min(this.items.length - 1, this.index + 1); this.mark(); return; }
    if (!this.all && empty && e.key === 'ArrowLeft' && this.items[this.index]?.chip) { e.preventDefault(); this.index = Math.max(0, this.index - 1); this.mark(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const raw = this.input.value.trim();
      // Shift + Enter: a line on today's page. Ctrl + Enter: always a task.
      if (!this.all && raw && e.shiftKey) { this.hooks.close(false); this.hooks.addLine(raw); return; }
      if (!this.all && raw && (e.ctrlKey || e.metaKey)) { const { title, choice } = splitWhen(raw); this.hooks.close(false); this.hooks.addTask(title, choice, raw); return; }
      if (this.all && this.side === 'groups') { this.side = 'list'; this.index = 0; this.mark(); return; }
      // Enter pressed before the places and tasks were read still finds them.
      const typed = this.input.value;
      if (raw && !this.all && (!this.places || !this.tasks)) {
        this.ready.then(([places, tasks]) => {
          if (!this.active || this.input.value !== typed) return;
          this.places = this.places || places;
          this.tasks = this.tasks || tasks;
          this.draw();
          const it = this.items[this.index];
          if (it) this.run(it);
        });
        return;
      }
      const it = this.items[this.index];
      if (it) this.run(it);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this.all) this.short();
      else this.hooks.close(!this.hooks.isTouch()); // on a phone no keyboard jumps up after
    }
  }

  run(it) {
    if (it.cmd && !it.dim) this.remember(it.cmd);
    if (it.stay) return it.run();
    // Leaving the box: the pushed Back step goes first, so the place you go to is the newest.
    if (this.pushed) { this.pushed = false; history.replaceState(history.state, ''); }
    // A command goes back to the text first (as the old menu did), a place needn't.
    this.hooks.close(!!it.cmd);
    it.run();
  }
}
