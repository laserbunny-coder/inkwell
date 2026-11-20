// The zoom, Part 1 (Nov 17 2026): one ruler at the bottom of the window, on
// the computer and on the phone alike, with Now in the middle.
//
//   when:  Month · Week · Today | Now | Project · Desk · Library  :where
//
// Every stop is a place Inkwell already has (Plan's Today list, the week,
// four of the weeks ahead, the project's page, the Desk, the Library). The
// Year has no stop of its own: Month again (or 1 again) opens it, the stop
// then reads Year, and once more comes back to the four weeks. Going to a stop is go(place), so Back, Forward and Android's back
// keep working; each step pushes a place, so Back is "out one step".
//
// The ruler takes the place of the rail, the phone's bottom bar and Today's
// Now / Page / Plan / Calendar switch. "Classic layout" (Look) brings those
// back until the old views are retired.
//
// Keys, when the caret is not in text (press Esc first when it is):
//   1 to 7 a stop (1 again: the Year) · Left and Right walk the ruler · Esc or minus out one step ·
//   Enter or plus in one step · / Go. Alt + ` is Now from anywhere, in text too.
// Phone: tap a stop, pinch in to step out, pinch out to step in, swipe
// sideways for the week before or after.
import { make } from '../dom.js';
import { media } from '../device.js';
import { popMenu, closeMenu } from '../menu.js';
import { getEntry } from '../db.js';
import { worldOf, worldStats, pagesIn } from '../library.js';
import { isoToday, isoOf } from '../dates.js';
import { inPane } from '../panes.js';
import { todayFace, facePlace, faceTo } from '../plan.js';
import { addDays, weekOf } from '../tasks.js';
import { addCommands } from './commandlist.js';
import { body, gone, root, state } from '../main.js';
import { go, lastPlace } from './routing.js';
import { frame } from './workpages.js';
import { plan, deskPage } from './talking.js';
import { lookHere, hidden } from './pagesettings.js';

const roomy = media('roomy');
const touch = media('touch');
const calm = matchMedia('(prefers-reduced-motion: reduce)');

// The seven stops, in order; the number keys follow the list.
export const STOPS = [
  { id: 'month', word: 'Month', title: 'Month: the next four weeks (again for the Year)' },
  { id: 'week', word: 'Week', title: 'Week: seven days and what’s for any day this week' },
  { id: 'today', word: 'Today', title: 'Today: the list, the day’s page or the hours' },
  { id: 'now', word: 'Now', title: 'Now: the one thing you’re on' },
  { id: 'project', word: 'Project', title: 'Project: the one you’re in, or the last one you were in' },
  { id: 'desk', word: 'Desk', title: 'Desk: your projects, what needs you and who’s working' },
  { id: 'library', word: 'Library', title: 'Library: every area and project' }
];
const at = (id) => STOPS.findIndex((s) => s.id === id);
const NOW = at('now'); // everything about sides counts from Now, wherever it sits in the list

const PIECE_VIEWS = ['world', 'project', 'write', 'grid', 'production', 'deliver', 'stage', 'compare'];
// The stop a place belongs to.
export function stopOf(place) {
  const v = place?.view || 'write';
  if (v === 'plan') {
    const t = place.tab || 'week';
    return t === 'now' ? 'now' : t === 'year' || t === 'ahead' || t === 'pace' ? 'month' : t === 'week' ? 'week' : 'today';
  }
  if (v === 'notebook') return !place.pageId || String(place.pageId).startsWith('day-') ? 'today' : 'project';
  if (v === 'desk') return 'desk';
  if (['library', 'drawer', 'tags'].includes(v)) return 'library';
  if (PIECE_VIEWS.includes(v)) return 'project';
  return null;
}

let ruler = null;
let mic = null;
let when = null;
let glass = null;
let more = null;
let aa = null;
let np = null;
let lit = null;
let needs = 0;

// ---------- where the stops lead ----------

async function liveWorld(id) {
  if (!id) return null;
  const w = await getEntry(id);
  return w && !gone(w) && w.kind === 'world' ? w : null;
}
// The Project stop: the project you're in; else the one thing's project; else the last one.
async function projectPlace() {
  if (stopOf(lastPlace) === 'project' && state.worldId && (await liveWorld(state.worldId))) return { view: 'world', id: state.worldId };
  const cur = plan?.now?.m?.cur;
  const row = cur?.item?.row || null;
  if (row) {
    const w = await worldOf(row).catch(() => null);
    if (w && !gone(w)) return { view: 'world', id: w.id };
  }
  let last = null;
  try { last = localStorage.getItem('lastWorld'); } catch { /* no storage here */ }
  if (await liveWorld(last)) return { view: 'world', id: last };
  return { view: 'desk' };
}

async function placeOfStop(id) {
  const today = isoToday();
  if (id === 'month') return { view: 'plan', tab: 'ahead' };
  if (id === 'week') return { view: 'plan', tab: 'week' };
  if (id === 'today') return facePlace(todayFace(), today);
  if (id === 'now') return { view: 'plan', tab: 'now' };
  if (id === 'project') return projectPlace();
  if (id === 'desk') return { view: 'desk' };
  return { view: 'library', area: null };
}

// ---------- moving ----------

const motion = () => (calm.matches ? 'off' : root.dataset.motion || 'full');
// How the next place arrives: in (nearer to Now), out (further), next or prev (across Now).
function wayOf(from, to) {
  const a = at(from);
  const b = at(to);
  if (a < 0 || b < 0) return 'rise';
  if (a === b) return 'out';
  if ((a - NOW) * (b - NOW) < 0) return b > a ? 'next' : 'prev';
  return Math.abs(b - NOW) < Math.abs(a - NOW) ? 'in' : 'out';
}

let moving = 0;
// Go somewhere along the ruler, with the zoom's motion: the View Transitions
// API where the browser has it, a plain fade where it doesn't, and nothing at
// all with motion off or reduced motion asked for.
export async function zoomGo(place, way = 'rise') {
  const m = motion();
  if (m === 'off' || !document.startViewTransition || document.hidden) return go(place);
  const turn = ++moving;
  root.dataset.zt = m === 'gentle' ? 'fade' : way;
  let shown;
  try {
    const t = document.startViewTransition(() => {
      shown = go(place);
      // A slow place (a big project) mustn't hold the screen still: what's there by then moves.
      return Promise.race([shown, new Promise((r) => setTimeout(r, 220))]);
    });
    const end = () => { if (turn === moving) delete root.dataset.zt; };
    t.finished.then(end, end);
    // A quick second step skips this one: that's fine, not an error.
    t.ready.catch(() => {});
    t.updateCallbackDone.catch(() => {});
  } catch {
    delete root.dataset.zt;
    return go(place);
  }
  return shown;
}

function dayWordOf(p) {
  const d = p?.view === 'plan' && p.tab === 'day' ? p.day : null;
  const today = isoOf();
  if (!d || d === today) return 'Today';
  if (d === addDays(today, 1)) return touch.matches ? 'Tmrw' : 'Tomorrow';
  const dt = new Date(`${d}T12:00`);
  return `${dt.toLocaleDateString('en-US', { weekday: 'short' })} ${dt.getDate()}`;
}
const onYear = (p = lastPlace) => p?.view === 'plan' && p.tab === 'year';
// The Year, from the Month stop (or back to the four weeks with on false).
export function toYear(on = true) {
  return zoomGo(on ? { view: 'plan', tab: 'year' } : { view: 'plan', tab: 'ahead' }, on ? 'out' : 'in');
}

export async function toStop(id) {
  const from = stopOf(lastPlace);
  // Month again: the Year, and again back to the four weeks.
  if (id === 'month' && from === 'month') return toYear(!onYear());
  // The Project stop again from inside a piece: out to the project's own page.
  // Now again while a line is open: back to the one thing.
  if (id === from && id !== 'project' && !(id === 'now' && lastPlace?.line)) return;
  const place = await placeOfStop(id);
  if (id === 'today') faceTo(todayFace());
  if (JSON.stringify(place) === JSON.stringify(lastPlace)) return;
  return zoomGo(place, wayOf(from, id));
}

// Out one step: further from Now on the time side, or up and out on the place side.
export async function zoomOut() {
  const p = lastPlace;
  const s = stopOf(p);
  if (s === 'now') return toStop('today');
  if (s === 'today' && p?.view === 'plan' && p.day) { const w = weekOf(p.day)[0]; return zoomGo({ view: 'plan', tab: 'week', ...(w === weekOf(isoOf())[0] ? {} : { week: w }) }, 'out'); }
  if (s === 'today') return toStop('week');
  if (s === 'week' && p?.week && p.week > weekOf(isoOf())[0]) return zoomGo({ view: 'plan', tab: 'ahead', week: p.week }, 'out');
  if (s === 'week') return toStop('month');
  if (s === 'month') return onYear(p) ? null : toYear(true);
  if (s === 'project') {
    if (p?.view === 'world') return toStop('desk');
    let w = state.worldId && (await liveWorld(state.worldId));
    if (!w && p?.view === 'notebook' && p.pageId) { const pg = await getEntry(p.pageId); w = pg ? await worldOf(pg).catch(() => null) : null; }
    return zoomGo(w ? { view: 'world', id: w.id } : { view: 'library', area: null }, 'out');
  }
  if (s === 'desk') return toStop('library');
  if (s === 'library' && (p?.view !== 'library' || p.area)) return zoomGo({ view: 'library', area: null }, 'out');
  return null;
}
// In one step: toward Now.
export function zoomIn() {
  if (onYear()) return toYear(false);
  const i = at(stopOf(lastPlace));
  if (i < 0 || i === NOW) return null;
  return toStop(STOPS[i + (i < NOW ? 1 : -1)].id);
}
function walk(dir) {
  if (onYear() && dir > 0) return toStop('week');
  const i = at(stopOf(lastPlace));
  const to = STOPS[(i < 0 ? NOW : i) + dir];
  return to ? toStop(to.id) : null;
}
// Earlier or later, where a stop has them (Part 1: the week).
function pan(dir) {
  const p = lastPlace;
  if (p?.view === 'plan' && (p.tab || 'week') === 'week') {
    const mon = weekOf(p.week || isoOf())[0];
    const next = addDays(mon, dir * 7);
    return zoomGo({ view: 'plan', tab: 'week', ...(next === weekOf(isoOf())[0] ? {} : { week: next }) }, dir > 0 ? 'next' : 'prev');
  }
  // A day on Today's stop: the day before or after (Part 3).
  if (p?.view === 'plan' && p.tab === 'day') {
    const d = addDays(p.day || isoOf(), dir);
    return zoomGo({ view: 'plan', tab: 'day', ...(d === isoOf() ? {} : { day: d }) }, dir > 0 ? 'next' : 'prev');
  }
  // The four weeks: four weeks on (Part 3).
  if (p?.view === 'plan' && p.tab === 'ahead') {
    const from = addDays(weekOf(p.week || isoOf())[0], dir * 28);
    return zoomGo({ view: 'plan', tab: 'ahead', ...(from === weekOf(isoOf())[0] ? {} : { week: from }) }, dir > 0 ? 'next' : 'prev');
  }
  // Where (Part 4): the next project, the next piece, the next bible page.
  return panPlace(p, dir);
}
async function panPlace(p, dir) {
  const way = dir > 0 ? 'next' : 'prev';
  const step = (ids, id) => { const i = ids.indexOf(id); return i < 0 ? null : ids[i + dir] || null; };
  if (p?.view === 'world' && p.id) {
    const ids = await deskPage.order().catch(() => []);
    const to = step(ids, p.id);
    return to ? zoomGo({ view: 'world', id: to }, way) : null;
  }
  if (p?.view === 'project' && p.id) {
    const w = await worldOf(await getEntry(p.id)).catch(() => null);
    if (!w) return null;
    const ids = (await worldStats(w)).pieces.map((x) => x.row.id);
    const to = step(ids, p.id);
    return to ? zoomGo({ view: 'project', id: to }, way) : null;
  }
  if (p?.view === 'notebook' && p.pageId && !p.pageId.startsWith('day-')) {
    const pg = await getEntry(p.pageId);
    const w = pg ? await worldOf(pg).catch(() => null) : null;
    if (!w || pg.parent_id !== w.id) return null;
    const ids = (await pagesIn(w.id)).map((x) => x.id);
    const to = step(ids, p.pageId);
    return to ? zoomGo({ view: 'notebook', pageId: to }, way) : null;
  }
  return null;
}

// ---------- drawing ----------

const glassIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>';
const micIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';

function build() {
  ruler = make('nav', 'zm-ruler');
  ruler.setAttribute('aria-label', 'Zoom: when and where');
  // Two equal halves around Now, so Now sits in the exact middle.
  const row = make('div', 'zm-row');
  const halfL = make('div', 'zm-half l');
  const halfR = make('div', 'zm-half r');
  halfL.append(make('span', 'zm-cap', 'when'));
  STOPS.forEach((s, i) => {
    const b = make('button', `zm-stop${s.id === 'now' ? ' home' : ''}`);
    b.type = 'button';
    b.dataset.stop = s.id;
    b.title = `${s.title} (${i + 1})`;
    b.append(make('span', 'zm-word', s.word));
    b.addEventListener('click', () => toStop(s.id));
    if (i < NOW) { halfL.append(b); if (i < NOW - 1) halfL.append(make('i', 'zm-sep')); } else if (i > NOW) { if (i > NOW + 1) halfR.append(make('i', 'zm-sep')); halfR.append(b); } else row.append(halfL, make('i', 'zm-sep mid'), b, make('i', 'zm-sep mid'));
  });
  halfR.append(make('span', 'zm-cap', 'where'));
  row.append(halfR);
  ruler.append(row);

  mic = make('button', 'zm-mic');
  mic.type = 'button';
  mic.dataset.cmd = 'mic';
  mic.title = 'Talk: your words land where you are (Alt + C)';
  mic.setAttribute('aria-label', 'Talk');
  mic.innerHTML = micIcon;

  when = make('span', 'zm-when');
  glass = make('button', 'zm-go');
  glass.type = 'button';
  glass.dataset.cmd = 'go';
  glass.title = 'Go: anywhere by name, jump back, every command (Ctrl + O, or / when you’re not typing)';
  glass.setAttribute('aria-label', 'Go');
  glass.innerHTML = glassIcon;
  // Not planned · N (Part 3): opens the shelf of lines with no time yet.
  np = make('button', 'zm-np', 'Not planned');
  np.type = 'button';
  np.title = 'Lines with no day and no time yet: drag one into the plan, or onto a ruler stop';
  np.addEventListener('click', () => plan?.shelf?.toggle());
  // Aa: Look, on its own beside More (Nov 20 2026), at full strength.
  aa = make('button', 'zm-aa', 'Aa');
  aa.type = 'button';
  aa.title = 'Look: colours, fonts, what shows (Alt + L)';
  aa.setAttribute('aria-label', 'Look');
  aa.setAttribute('aria-expanded', 'false');
  aa.addEventListener('click', () => lookHere());
  const ps = document.querySelector('.page-settings');
  if (ps) new MutationObserver(() => aa.setAttribute('aria-expanded', String(!ps.hidden))).observe(ps, { attributes: true, attributeFilter: ['hidden'] });
  more = make('button', 'zm-more', '⋯');
  more.type = 'button';
  more.title = 'More: notes beside the text, Beside, every command';
  more.setAttribute('aria-label', 'More');
  more.addEventListener('click', () => moreMenu());
  document.body.append(ruler, mic);
}

function moreMenu() {
  const writingNow = !root.dataset.view;
  const click = (sel) => () => document.querySelector(sel)?.click();
  const items = [
    ...(writingNow ? [{ label: 'Notes beside the text (Ctrl + 2)', run: click('#notes-toggle') }] : []),
    { label: 'Beside: a pane next to this (Ctrl + \\)', run: click('#beside-toggle') },
    'sep',
    { label: 'Every command (Ctrl + K)', run: () => { closeMenu(); document.querySelector('#palette-toggle')?.click(); } }
  ];
  popMenu(more, items);
}

// The date and time, at the left of the top line.
function tick() {
  if (!when) return;
  const d = new Date();
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, ' ');
  when.textContent = `${day} · ${time}`;
}

// The top line's own bits: on a computer they join the bar's left and right;
// elsewhere they go at the ends of the top bar.
function place() {
  if (!when) return;
  const bar = document.querySelector('.topbar');
  const left = bar?.querySelector(':scope > .tb-l');
  const right = bar?.querySelector(':scope > .tb-r');
  if (left && right) { left.prepend(when); right.append(np, glass, aa, more); } else if (bar) { bar.prepend(when); bar.append(np, glass, aa, more); }
}

function light(place) {
  lit = stopOf(place);
  if (!ruler) return;
  // On the Year the Month stop reads Year, and stays lit.
  const word = ruler.querySelector('[data-stop="month"] .zm-word');
  if (word) word.textContent = onYear(place) ? 'Year' : 'Month';
  // Another day on Today's stop: the stop says which (Part 3).
  const tw = ruler.querySelector('[data-stop="today"] .zm-word');
  if (tw) tw.textContent = dayWordOf(place);
  for (const b of ruler.querySelectorAll('.zm-stop')) {
    if (b.dataset.stop === lit) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  // Visiting a line (not the one thing): the Now dot is hollow (Part 2).
  const home = ruler.querySelector('[data-stop="now"]');
  const away = lit === 'now' && !!place?.line;
  home?.classList.toggle('away', away);
  if (home) home.title = away ? 'Back to the one thing (4)' : `${STOPS[NOW].title} (${NOW + 1})`;
  body.classList.toggle('in-piece', !!place && (!place.view || place.view === 'write' || (place.view === 'notebook' && !!place.pageId && !String(place.pageId).startsWith('day-'))));
}

function count(n) {
  needs = n;
  const b = ruler?.querySelector('[data-stop="desk"]');
  if (!b) return;
  b.classList.toggle('need', n > 0);
  b.setAttribute('aria-label', n > 0 ? `Desk, ${n} waiting on you` : 'Desk');
}

// ---------- the thought box (Alt + J) ----------

// Nothing sits on Now for it: one key from anywhere opens a small box, the
// thought is filed as before (thoughts.js), and he stays where he was.
let tbox = null;
function thoughtBox() {
  if (!tbox) {
    tbox = make('form', 'zm-thought');
    tbox.setAttribute('role', 'dialog');
    tbox.setAttribute('aria-label', 'Get it out of your head');
    const input = make('input');
    input.type = 'text';
    input.id = 'zm-thought-in';
    input.placeholder = 'Get it out of your head';
    input.autocomplete = 'off';
    input.enterKeyHint = 'done';
    input.setAttribute('aria-label', 'Get it out of your head: it is filed, and you stay here');
    const hint = make('small', '', 'Enter files it · Esc closes');
    tbox.append(input, hint);
    tbox.hidden = true;
    tbox.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      closeThought();
      await plan?.hooks?.thought?.(text);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeThought(); } });
    input.addEventListener('blur', () => setTimeout(() => { if (!input.value.trim()) closeThought(); }, 150));
    document.body.append(tbox);
  }
  tbox.hidden = false;
  body.classList.add('thought-on');
  tbox.querySelector('input').focus();
}
function closeThought() { if (tbox) tbox.hidden = true; body.classList.remove('thought-on'); }

// ---------- keys ----------

const inText = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const busy = () => !!document.querySelector('.pop-menu, .ask-backdrop, dialog[open], .palette:not([hidden]), .page-settings:not([hidden]), .go-panel, .history:not([hidden]), .shortcuts:not([hidden])');

// Whether anything an Esc in text closes first was open as the key went down
// (the editor marks every key it sees as handled, so that can't tell us).
let escCloses = false;
const POPS = '.slash:not([hidden]), .suggest:not([hidden]), .picker:not([hidden]), .alt-panel:not([hidden]), .tag-results:not([hidden]), .notebook.zoomed, .woven-pick:not([hidden])';
function keyFirst(e) {
  if (e.key === 'Escape') escCloses = busy() || !!document.querySelector(POPS);
}

function key(e) {
  if (e.isComposing) return;
  const m = e.ctrlKey || e.metaKey;
  const t = e.target;
  // Esc in text: out of the text, and everything that faded comes back.
  if (e.key === 'Escape' && !m && !e.altKey && inText(t)) {
    if (escCloses || t.closest?.('.palette, .pop-menu, .ask, .page-settings, .slash, .picker, .suggest')) return;
    if (t.isContentEditable) { t.blur(); body.classList.remove('typing', 'peek-top', 'peek-bottom'); e.preventDefault(); }
    return;
  }
  // Alt + J: the thought box, from anywhere, in text too.
  if (e.altKey && !m && !e.shiftKey && e.code === 'KeyJ') { e.preventDefault(); thoughtBox(); return; }
  // Alt + ` (the key left of 1): Now, from anywhere, in text too.
  if (e.altKey && !m && !e.shiftKey && e.code === 'Backquote') { e.preventDefault(); toStop('now'); return; }
  if (e.defaultPrevented) return;
  if (m || e.altKey) return;
  if (inText(t) || inText(document.activeElement) || busy() || e.repeat && /^[1-7]$/.test(e.key)) return;
  const k = e.key;
  let run = null;
  if (/^[1-7]$/.test(k) && !e.shiftKey) run = () => toStop(STOPS[Number(k) - 1].id);
  else if (k === 'ArrowLeft' && !e.shiftKey) run = () => walk(-1);
  else if (k === 'ArrowRight' && !e.shiftKey) run = () => walk(1);
  else if ((k === 'ArrowLeft' || k === 'ArrowRight') && e.shiftKey) run = () => pan(k === 'ArrowLeft' ? -1 : 1);
  else if (k === 'Escape' || k === '-') run = () => zoomOut();
  else if (k === '+' || k === '=' || (k === 'Enter' && !t.closest?.('button, a, summary, [role="button"], [role="menuitem"], [role="option"], [role="radio"], [role="tab"], [data-task]'))) run = () => zoomIn();
  else if (k === '/') run = () => document.querySelector('.zm-go')?.click();
  if (!run) return;
  e.preventDefault();
  run();
}

// ---------- pinch and swipe on the phone ----------

function gestures() {
  let pinch = null;
  let swipe = null;
  const gap = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
  const holding = () => ['pl-touchdrag', 'line-holding', 'pl-calm', 'pull-dropping', 'dk-dragging'].some((c) => root.classList.contains(c) || body.classList.contains(c));
  document.addEventListener('touchstart', (e) => {
    if (!touch.matches) return;
    // The hours of Today keep their own pinch (it zooms the hours, not the ruler).
    if (e.touches.length === 2) { pinch = e.target.closest?.('.dc-grid') ? null : { d: gap(e.touches), done: false }; swipe = null; return; }
    if (e.touches.length !== 1) { swipe = null; return; }
    pinch = null;
    const el = e.target;
    if (el.closest?.('.zm-ruler, .topbar, .ah-wrap, .page-tabs, input:focus, textarea:focus, .pop-menu, .palette, .pl-pickbar, .pl-zoom, .lw-strip, .hstrip, [contenteditable="true"]')) { swipe = null; return; }
    swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!pinch || pinch.done || e.touches.length !== 2 || holding()) return;
    const r = gap(e.touches) / pinch.d;
    // One step for each pinch: fingers together steps out, apart steps in.
    if (r < 0.68) { pinch.done = true; zoomOut(); } else if (r > 1.45) { pinch.done = true; zoomIn(); }
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!e.touches.length) pinch = null;
    const was = swipe;
    swipe = null;
    if (!was || e.touches.length || holding()) return;
    const dx = e.changedTouches[0].clientX - was.x;
    const dy = e.changedTouches[0].clientY - was.y;
    if (Date.now() - was.t > 700 || Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy)) return;
    if (getSelection && !getSelection()?.isCollapsed) return;
    pan(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ---------- true focus on the computer ----------

// Typing in a piece fades everything but the words. The mouse at the bottom
// edge brings the ruler back, at the top edge the top line; Esc brings back
// everything. (A plain mouse move no longer does, on the zoom.)
function edges() {
  document.addEventListener('mousemove', (e) => {
    if (!body.classList.contains('typing') || e.sourceCapabilities?.firesTouchEvents) return;
    const near = e.clientY > window.innerHeight - 56 ? 'bottom' : e.clientY < 56 ? 'top' : '';
    body.classList.toggle('peek-bottom', near === 'bottom');
    body.classList.toggle('peek-top', near === 'top');
  });
}

addCommands(() => [
  { group: 'go', label: 'Now, from anywhere', keys: 'Alt+`', words: ['now', 'one thing', 'ruler', 'zoom', 'current'], run: () => toStop('now'), when: () => !inPane },
  { group: 'go', label: 'Month: the next four weeks', keys: '1', words: ['month', 'four weeks', 'weeks', 'ahead', 'zoom', 'ruler'], run: () => (onYear() ? toYear(false) : toStop('month')), when: () => !inPane },
  { group: 'go', label: 'Year: twelve months from now', keys: '1 twice', words: ['year', 'months', 'zoom', 'ruler', 'sometime this year', 'later'], run: () => toYear(true), when: () => !inPane },
  { group: 'new', label: 'Get it out of your head: a thought, filed', keys: 'Alt+J', words: ['thought', 'capture', 'out of your head', 'note', 'idea', 'inbox', 'jot'], run: () => thoughtBox(), when: () => !inPane },
  { group: 'go', label: 'Zoom out one step', keys: 'Esc', words: ['zoom', 'out', 'step out', 'further', 'ruler', 'back'], run: () => zoomOut(), when: () => !inPane },
  { group: 'go', label: 'Zoom in one step', keys: 'Enter', words: ['zoom', 'in', 'step in', 'closer', 'ruler'], run: () => zoomIn(), when: () => !inPane }
]);

// Runs once at start-up, from main.js.
export function wireZoom() {
  if (inPane) return;
  build();
  tick();
  setInterval(tick, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  // After the frame has put the bar together (it does so in a microtask, and again on a resize across the line).
  queueMicrotask(() => setTimeout(place, 0));
  roomy.addEventListener('change', () => setTimeout(place, 0));
  document.addEventListener('inkwell:place', (e) => light(e.detail));
  document.addEventListener('inkwell:needs', (e) => count(e.detail || 0));
  // Places inside the stops ask for the zoom's motion (nowpage.js zoomTo).
  document.addEventListener('inkwell:zoomto', (e) => {
    const d = e.detail || {};
    if (d.stop) toStop(d.stop);
    else if (d.place) zoomGo(d.place, d.way || 'rise');
  });
  window.addEventListener('keydown', keyFirst, true);
  window.addEventListener('keydown', key);
  gestures();
  edges();
  // Ctrl + scroll over the ruler steps out and in (elsewhere it stays the browser's zoom).
  let wheelAt = 0;
  ruler.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || Math.abs(e.deltaY) < 1) return;
    e.preventDefault();
    if (Date.now() - wheelAt < 350) return;
    wheelAt = Date.now();
    if (e.deltaY > 0) zoomOut(); else zoomIn();
  }, { passive: false });
  if (!root.classList.contains('zoom')) root.classList.add('zoom');
  light(lastPlace);
}
