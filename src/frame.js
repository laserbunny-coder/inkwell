// The frame: the top line on a computer, and the looks and the motion that go
// with them. (The rail of rooms down the left, the switches at the top centre
// and the phone's bottom bar went with the old layout on Nov 17 2026: the
// ruler at the bottom, app/zoom.js, goes between the stops now.)
//
// The top line is made of the same buttons the top bar always had (they keep
// their ids and what they do); this file only moves them into place on a wide
// screen and puts them back on a narrow one.

import { setFont, currentFont } from './fonts.js';
import { media } from './device.js';
import { make } from './dom.js';

const root = document.documentElement;
// The computer's top line needs room and a pointer.
const wide = media('roomy');

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };

// ---------- looks ----------

// Each look is a set of colours and typefaces in frame.css ([data-look]).
export const LOOKS = [
  { id: 'midnight', name: 'Midnight Ink', about: 'Blue-black page, ink-blue accent, a tall serif for titles.', bar: '#0E1117', swatch: ['#0E1117', '#E9E6DF', '#9FB6F2'] },
  { id: 'lamplight', name: 'Lamplight', about: 'Warm dark, like a desk lamp at night. The look Inkwell grew up with.', bar: '#171412', swatch: ['#171412', '#EEE7DB', '#DDA98E'] },
  { id: 'ember', name: 'Ember', about: 'Warm near-black, soft grey words, an orange glow. Easy on the eyes.', bar: '#13110F', swatch: ['#13110F', '#BEB6A9', '#E2843A'] },
  { id: 'candle', name: 'Candle', about: 'The softest: brown-black page, dimmer words, honey accent.', bar: '#1A1611', swatch: ['#1A1611', '#AFA493', '#D9A050'] },
  { id: 'night', name: 'Night shift', about: 'Almost no blue light: sepia words for late nights.', bar: '#110C07', swatch: ['#110C07', '#C9A67A', '#E8873A'] },
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
  // hooks: page() → the active page tab id or null
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
    // The top line on a computer: where you are on the left, a project's pages
    // in the middle, the words and sync on the right.
    this.mid = make('div', 'tb-m');
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
      this.mid.append(this.tabsPill);
      this.move($('#page-tabs'), this.mid);
      this.move($('#tb-back'), this.left);
      this.move($('#crumb'), this.left);
      for (const id of ['chapter-links-chip', 'words', 'status', 'versions', 'sync', 'notes-toggle', 'beside-toggle']) this.move(document.getElementById(id), this.right);
      bar.append(this.left, this.mid, this.right);
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
      this.left.remove(); this.mid.remove(); this.right.remove();
      root.classList.remove('has-rail');
    }
    this.here(this.last);
  }

  // Which way the next place lies from this one, for the way it arrives.
  turn(from, to, page, tab) {
    // The zoom moves the whole view itself (app/zoom.js): no second motion inside it.
    if (!moves() || root.dataset.zt) { delete root.dataset.turn; this.lastTab = tab || null; return; }
    const a = roomOf(from);
    const b = roomOf(to);
    let turn = 'rise';
    if (a === b && a === 'desk') turn = tab === 'history' ? 'fwd' : this.lastTab === 'history' ? 'back' : 'rise';
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

  // Where you are now: the page tab's highlight follows.
  here(place) {
    this.last = place || this.last;
    this.page = this.hooks.page?.() || null;
    if (this.on) this.glide();
  }

  // How many things need you (the ruler's Desk stop shows it: app/zoom.js).
  count(n) {
    const b = document.getElementById('desk-toggle');
    if (!b) return;
    if (n > 0) b.dataset.n = String(n); else delete b.dataset.n;
    b.setAttribute('aria-label', n > 0 ? `Desk, ${n} waiting on you` : 'Desk');
  }

  // The highlight slides to the lit page tab instead of jumping.
  glide() {
    if (!this.on) return;
    requestAnimationFrame(() => {
      const pill = this.tabsPill;
      const tabs = document.getElementById('page-tabs');
      const at = tabs && !tabs.hidden ? tabs.querySelector('.pt-tab.on') : null;
      if (!at || at.offsetParent === null) { pill.style.opacity = '0'; return; }
      const a = at.getBoundingClientRect();
      const b = this.mid.getBoundingClientRect();
      pill.style.opacity = '1';
      pill.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px)`;
      pill.style.width = `${a.width}px`;
      pill.style.height = `${a.height}px`;
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
