// The frame: a rail of words down the left for the rooms, one switch at the
// top centre for the place you're in, and the looks and the motion that go
// with them.
//
// The rail and the switch are made of the same buttons the top bar always had
// (they keep their ids and what they do); this file only moves them into place
// on a wide screen and puts them back on a narrow one, where the phone's own
// bar takes over.

import { setFont, currentFont } from './fonts.js';

const root = document.documentElement;
// A rail needs room and a pointer; a touch screen keeps its bottom bar.
const wide = matchMedia('(min-width: 701px) and (hover: hover)');

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };

// ---------- looks ----------

// Each look is a set of colours and typefaces in frame.css ([data-look]).
export const LOOKS = [
  { id: 'midnight', name: 'Midnight Ink', about: 'Blue-black page, ink-blue accent, a tall serif for titles.', bar: '#0E1117', swatch: ['#0E1117', '#E9E6DF', '#9FB6F2'] },
  { id: 'lamplight', name: 'Lamplight', about: 'Warm dark, like a desk lamp at night. The look Inkwell grew up with.', bar: '#171412', swatch: ['#171412', '#EEE7DB', '#DDA98E'] },
  { id: 'graphite', name: 'Graphite', about: 'Neutral black and white, no colour at all. Sans titles.', bar: '#0F0F10', swatch: ['#0F0F10', '#EEEEEC', '#858583'] },
  { id: 'typewriter', name: 'Typewriter', about: 'A plain-text notebook: one fixed-width font for everything.', bar: '#0F1315', swatch: ['#0F1315', '#DCE3E5', '#7FD1C3'], font: 'https://fonts.googleapis.com/css2?family=Cascadia+Code:ital,wght@0,400;0,500;0,700;1,400&display=swap' },
  { id: 'paper', name: 'Paper', about: 'Light, for daylight and for reading printouts.', bar: '#F3F3EF', swatch: ['#F3F3EF', '#1B1F28', '#2C4DA8'], light: true }
];
export const DEFAULT_LOOK = 'midnight';
const lookById = (id) => LOOKS.find((l) => l.id === id) || LOOKS[0];
export const currentLook = () => lookById(root.dataset.look || DEFAULT_LOOK);

export function setLook(id, { keep = true } = {}) {
  const look = lookById(id);
  root.dataset.look = look.id;
  // Older rules still ask whether the page is light or dark.
  root.dataset.theme = look.light ? 'light' : 'dark';
  if (look.font && !document.getElementById(`look-font-${look.id}`)) {
    const l = make('link');
    l.rel = 'stylesheet'; l.href = look.font; l.id = `look-font-${look.id}`;
    document.head.appendChild(l);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', look.bar);
  // Typewriter is one fixed-width face for everything, the writing too; leaving it gives your font back.
  if (keep) {
    const before = read('fontBefore');
    if (look.id === 'typewriter' && currentFont().group !== 'mono') { save('fontBefore', currentFont().id); setFont('cascadia'); }
    else if (look.id !== 'typewriter' && before) { if (currentFont().id === 'cascadia') setFont(before); save('fontBefore', null); }
  }
  if (keep) {
    save('look', look.id);
    save('theme', look.light ? 'light' : 'dark');
    if (!look.light) save('darkLook', look.id);
  }
  document.dispatchEvent(new CustomEvent('inkwell:look', { detail: look.id }));
  return look;
}
// Light and dark, for the old shortcut: Paper, or the dark look you last used.
export function toggleLight() {
  return setLook(currentLook().light ? read('darkLook') || DEFAULT_LOOK : 'paper');
}

// ---------- motion ----------

export const MOTIONS = [['full', 'Full'], ['gentle', 'Fades only'], ['off', 'Off']];
const calm = matchMedia('(prefers-reduced-motion: reduce)');
export const currentMotion = () => root.dataset.motion || 'full';
export function setMotion(m, { keep = true } = {}) {
  root.dataset.motion = MOTIONS.some(([id]) => id === m) ? m : 'full';
  if (keep) save('motion', root.dataset.motion);
}
const moves = () => currentMotion() === 'full';

// The order rooms sit in, so going "forward" slides one way and back the other.
const TIME = ['notebook', 'plan'];
const LIBRARY = ['library', 'drawer', 'tags'];
const PAGES = ['overview', 'gather', 'shape', 'write', 'revise', 'make', 'deliver', 'notes', 'meetings'];
const roomOf = (v) => (TIME.includes(v) ? 'today' : v === 'desk' ? 'desk' : LIBRARY.includes(v) ? 'library' : 'project');

// ---------- the frame ----------

export class Frame {
  // hooks: projects() → [{ id, title, color, current }], openProject(id),
  // contents() (open the list of chapters), hasContents() → bool, keyLabel(text),
  // page() → the active page tab id or null
  constructor(hooks) {
    this.hooks = hooks;
    this.on = false;
    this.homes = new Map();
    this.last = null;
    this.build();
    wide.addEventListener('change', () => this.apply());
    window.addEventListener('resize', () => this.glide());
    document.fonts?.addEventListener?.('loadingdone', () => this.glide());
    // Another look sets the words in another face, so the highlight finds them again.
    document.addEventListener('inkwell:look', () => { this.glide(); setTimeout(() => this.glide(), 250); });
    // Once the rest of the app has set itself up (the hooks reach into it).
    queueMicrotask(() => this.apply());
  }

  build() {
    const k = (text) => this.hooks.keyLabel?.(text) || text;
    const rail = (this.rail = make('nav', 'rail'));
    rail.setAttribute('aria-label', 'Rooms');
    this.brand = make('div', 'rail-brand', 'Inkwell');
    this.rooms = make('div', 'rail-rooms');
    this.pill = make('span', 'rail-pill');
    this.pill.setAttribute('aria-hidden', 'true');
    this.projLabel = make('div', 'rail-label', 'Projects');
    this.projects = make('div', 'rail-projects');
    this.contents = make('button', 'rail-item rail-contents', 'Contents');
    this.contents.title = k('The chapters and pages of what you’re writing (⌘1 keeps it open)');
    this.contents.addEventListener('click', () => this.hooks.contents?.());
    this.contents.hidden = true;
    this.tools = make('div', 'rail-tools');
    rail.append(this.brand, this.rooms, this.projLabel, this.projects, this.contents, make('span', 'rail-grow'), this.tools);

    // The switch for the place you're in, at the top centre.
    this.mid = make('div', 'tb-m');
    this.switch = make('div', 'place-switch');
    this.switch.setAttribute('role', 'group');
    this.switch.setAttribute('aria-label', 'Views of the Library');
    this.shelves = make('button', 'tb-btn', 'Shelves');
    this.shelves.dataset.cmd = 'library';
    this.shelves.id = 'shelves-toggle';
    this.shelves.title = 'Shelves: your areas and worlds';
    this.swPill = make('span', 'switch-pill');
    this.swPill.setAttribute('aria-hidden', 'true');
    // The Desk's two views: what's on stage, and every thread there has been.
    this.deskSwitch = make('div', 'place-switch desk-switch');
    this.deskSwitch.setAttribute('role', 'group');
    this.deskSwitch.setAttribute('aria-label', 'Views of the Desk');
    this.dkPill = make('span', 'switch-pill');
    this.dkPill.setAttribute('aria-hidden', 'true');
    this.onStage = make('button', 'tb-btn', 'On stage');
    this.onStage.dataset.cmd = 'desk';
    this.onStage.title = 'On stage: every project, what needs you and who’s working on it';
    this.history = make('button', 'tb-btn', 'History');
    this.history.dataset.cmd = 'desk-history';
    this.history.title = 'History: every Claude thread, newest first';
    this.deskSwitch.append(this.dkPill, this.onStage, this.history);
    this.deskSwitch.hidden = true;
    // Today from three distances: the day, the week, and looking back.
    this.todaySwitch = make('div', 'place-switch today-switch');
    this.todaySwitch.setAttribute('role', 'group');
    this.todaySwitch.setAttribute('aria-label', 'Views of Today');
    this.tdPill = make('span', 'switch-pill');
    this.tdPill.setAttribute('aria-hidden', 'true');
    this.dayBtn = make('button', 'tb-btn', 'Day');
    this.dayBtn.dataset.cmd = 'today';
    this.dayBtn.title = 'Day: today’s plan on top of today’s page';
    this.weekBtn = make('button', 'tb-btn', 'Week');
    this.weekBtn.dataset.cmd = 'week';
    this.weekBtn.title = 'Week: seven days, and what isn’t on a day yet';
    this.paceBtn = make('button', 'tb-btn', 'Pace');
    this.paceBtn.dataset.cmd = 'pace';
    this.paceBtn.title = 'Pace: what you planned against what it really took';
    this.todaySwitch.append(this.tdPill, this.dayBtn, this.weekBtn, this.paceBtn);
    this.todaySwitch.hidden = true;
    // Page tabs are redrawn each time, so their highlight lives beside them and slides.
    this.tabsPill = make('span', 'tabs-pill');
    this.tabsPill.setAttribute('aria-hidden', 'true');
    this.left = make('div', 'tb-l');
    this.right = make('div', 'tb-r');
  }

  // Put a thing somewhere new, remembering where it came from.
  move(el, into, label) {
    if (!el) return;
    if (!this.homes.has(el)) this.homes.set(el, { parent: el.parentNode, next: el.nextSibling, text: el.textContent });
    into.append(el);
    if (label !== undefined) el.textContent = label;
  }

  apply() {
    const want = wide.matches && !root.classList.contains('in-pane');
    if (want === this.on) return;
    this.on = want;
    const $ = (s) => document.querySelector(s);
    const bar = $('.topbar');
    if (want) {
      this.move($('#view-toggle'), this.rooms);
      this.move($('#desk-toggle'), this.rooms);
      this.move($('#library-toggle'), this.rooms);
      this.rail.prepend(this.pill);
      const k = (text) => this.hooks.keyLabel?.(text) || text;
      const tool = (el, label, keys) => { this.move(el, this.tools, label); if (el && keys) el.dataset.keys = k(keys); };
      tool($('#mic-toggle'), 'Capture', '⌥C');
      tool($('#go-toggle'), 'Go', '⌘O');
      tool($('#palette-toggle'), 'Everything', '⌘K');
      tool($('.tb-view [data-cmd="page"]'), 'Look');
      this.switch.append(this.swPill, this.shelves);
      this.move($('#drawer-toggle'), this.switch);
      this.move($('#tags-toggle'), this.switch);
      this.mid.append(this.tabsPill, this.switch, this.deskSwitch, this.todaySwitch);
      this.move($('#page-tabs'), this.mid);
      this.move($('#tb-back'), this.left);
      this.move($('#crumb'), this.left);
      for (const id of ['chapter-links-chip', 'words', 'status', 'versions', 'sync', 'notes-toggle', 'focus-toggle']) this.move(document.getElementById(id), this.right);
      bar.append(this.left, this.mid, this.right);
      document.body.prepend(this.rail);
      root.classList.add('has-rail');
    } else {
      // Back where they were, last moved first, so each one's old neighbour is home again.
      for (const [el, home] of [...this.homes].reverse()) {
        if (home.next && home.next.parentNode === home.parent) home.parent.insertBefore(el, home.next);
        else home.parent.append(el);
        el.textContent = home.text;
        delete el.dataset.keys;
      }
      this.homes.clear();
      this.left.remove(); this.mid.remove(); this.right.remove(); this.rail.remove();
      root.classList.remove('has-rail');
    }
    this.here(this.last);
    this.drawProjects();
  }

  // Which way the next place lies from this one, for the way it arrives.
  turn(from, to, page, tab) {
    if (!moves()) { delete root.dataset.turn; this.lastTab = tab || null; return; }
    const a = roomOf(from);
    const b = roomOf(to);
    let turn = 'rise';
    // Day, Week and Pace are one room from further and further back.
    const far = (v, t) => (v === 'plan' ? (t === 'pace' ? 2 : 1) : 0);
    if (a === b && a === 'today' && far(from, this.lastTab) !== far(to, tab)) turn = far(to, tab) > far(from, this.lastTab) ? 'out' : 'in';
    else if (a === b && a === 'desk') turn = tab === 'history' ? 'fwd' : this.lastTab === 'history' ? 'back' : 'rise';
    else if (a === b && a === 'library') turn = LIBRARY.indexOf(to) > LIBRARY.indexOf(from) ? 'fwd' : LIBRARY.indexOf(to) < LIBRARY.indexOf(from) ? 'back' : 'rise';
    else if (a === b && a === 'project' && page && this.lastPage && page !== this.lastPage) turn = PAGES.indexOf(page) > PAGES.indexOf(this.lastPage) ? 'fwd' : 'back';
    else if (a !== b && b === 'project') turn = 'in';
    else if (a !== b && a === 'project') turn = 'out';
    root.dataset.turn = turn;
    this.lastPage = page || null;
    this.lastTab = tab || null;
    if (from === to) { root.classList.remove('turned'); void root.offsetWidth; root.classList.add('turned'); }
    else root.classList.remove('turned');
  }

  // Light up where you are, in the rail and on the switch.
  here(place) {
    this.last = place || this.last;
    this.page = this.hooks.page?.() || null;
    if (!this.on) return;
    const v = root.dataset.view || 'write';
    const lib = LIBRARY.includes(v);
    this.switch.hidden = !lib;
    if (lib) {
      const at = { library: this.shelves, drawer: document.getElementById('drawer-toggle'), tags: document.getElementById('tags-toggle') }[v];
      for (const b of this.switch.querySelectorAll('button')) { if (b === at) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    }
    this.deskSwitch.hidden = v !== 'desk';
    if (v === 'desk') {
      const at = this.last?.tab === 'history' ? this.history : this.onStage;
      for (const b of [this.onStage, this.history]) { if (b === at) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    }
    const day = v === 'plan' || (v === 'notebook' && !!this.hooks.onDay?.());
    this.todaySwitch.hidden = !day;
    if (day) {
      const at = v === 'plan' ? (this.last?.tab === 'pace' ? this.paceBtn : this.weekBtn) : this.dayBtn;
      for (const b of [this.dayBtn, this.weekBtn, this.paceBtn]) { if (b === at) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    }
    // The Library is one room: its word in the rail stays lit on the Drawer and Tags too.
    const libBtn = document.getElementById('library-toggle');
    if (lib) libBtn?.setAttribute('aria-current', 'page');
    this.contents.hidden = !this.hooks.hasContents?.();
    this.drawProjects();
    this.glide();
  }

  // How many things need you, beside Desk. Amber means nothing else in the app.
  count(n) {
    const b = document.getElementById('desk-toggle');
    if (!b) return;
    if (n > 0) b.dataset.n = String(n); else delete b.dataset.n;
    b.setAttribute('aria-label', n > 0 ? `Desk, ${n} waiting on you` : 'Desk');
  }

  async drawProjects() {
    if (!this.on) return;
    const turn = (this.drawing = (this.drawing || 0) + 1);
    let list = [];
    try { list = (await this.hooks.projects?.()) || []; } catch { list = []; }
    if (turn !== this.drawing) return;
    this.projLabel.hidden = !list.length;
    const have = new Map([...this.projects.children].map((b) => [b.dataset.id, b]));
    const next = list.map((p) => {
      const b = have.get(p.id) || make('button', 'rail-item rail-project');
      b.dataset.id = p.id;
      if (!b.firstChild) { b.append(make('span', 'rail-dot'), make('span', 'rail-name')); b.addEventListener('click', () => this.hooks.openProject?.(b.dataset.id)); }
      b.querySelector('.rail-dot').style.background = p.color || '';
      b.querySelector('.rail-name').textContent = p.title || 'Untitled';
      b.title = p.title || 'Untitled';
      if (p.current) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      return b;
    });
    this.projects.replaceChildren(...next);
    this.glide();
  }

  // The highlight slides to the lit word instead of jumping.
  glide() {
    if (!this.on) return;
    requestAnimationFrame(() => {
      const put = (pill, box, at) => {
        if (!at || at.offsetParent === null) { pill.style.opacity = '0'; return; }
        const a = at.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        pill.style.opacity = '1';
        pill.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px)`;
        pill.style.width = `${a.width}px`;
        pill.style.height = `${a.height}px`;
      };
      const lit = this.rail.querySelector('.rail-rooms [aria-current="page"], .rail-projects [aria-current="page"]');
      if (!lit) this.pill.style.opacity = '0';
      else {
        const a = lit.getBoundingClientRect();
        const b = this.rail.getBoundingClientRect();
        this.pill.style.opacity = '1';
        this.pill.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top + this.rail.scrollTop}px)`;
        this.pill.style.width = `${a.width}px`;
        this.pill.style.height = `${a.height}px`;
      }
      put(this.swPill, this.switch, this.switch.querySelector('[aria-current="page"]'));
      put(this.dkPill, this.deskSwitch, this.deskSwitch.querySelector('[aria-current="page"]'));
      put(this.tdPill, this.todaySwitch, this.todaySwitch.querySelector('[aria-current="page"]'));
      const tabs = document.getElementById('page-tabs');
      put(this.tabsPill, this.mid, tabs && !tabs.hidden ? tabs.querySelector('.pt-tab.on') : null);
    });
  }
}

// ---------- the Look part of the Aa panel ----------

export function lookPicker(panel) {
  const box = make('div', 'look-pick');
  const head = make('span', 'row');
  const name = make('span', '', '');
  head.append(make('span', '', 'Look'), name);
  const list = make('div', 'look-list');
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', 'Look');
  for (const l of LOOKS) {
    const b = make('button', 'look-opt');
    b.dataset.look = l.id;
    b.setAttribute('role', 'radio');
    b.title = l.about;
    const sw = make('span', 'look-swatch');
    sw.style.background = l.swatch[0];
    const a = make('span', '', 'Aa');
    a.style.color = l.swatch[1];
    const dot = make('i');
    dot.style.background = l.swatch[2];
    sw.append(a, dot);
    b.append(sw, make('span', 'look-name', l.name));
    b.addEventListener('click', () => setLook(l.id));
    list.append(b);
  }
  const mrow = make('span', 'row');
  mrow.append(make('span', '', 'Motion'));
  const mlist = make('div', 'motion-list');
  mlist.setAttribute('role', 'radiogroup');
  mlist.setAttribute('aria-label', 'Motion');
  for (const [id, label] of MOTIONS) {
    const b = make('button', 'motion-opt', label);
    b.dataset.motion = id;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => { setMotion(id); sync(); });
    mlist.append(b);
  }
  const sync = () => {
    const look = currentLook();
    name.textContent = look.name;
    for (const b of list.children) b.setAttribute('aria-checked', String(b.dataset.look === look.id));
    for (const b of mlist.children) b.setAttribute('aria-checked', String(b.dataset.motion === currentMotion()));
  };
  document.addEventListener('inkwell:look', sync);
  box.append(head, list, mrow, mlist);
  panel.prepend(box);
  sync();
  return { sync };
}

// First paint already has the look (index.html sets it); this fills in the rest.
export function startLook() {
  const stored = read('look');
  setLook(stored || (read('theme') === 'light' ? 'paper' : DEFAULT_LOOK), { keep: false });
  const m = read('motion');
  setMotion(m || (calm.matches ? 'gentle' : 'full'), { keep: false });
}
