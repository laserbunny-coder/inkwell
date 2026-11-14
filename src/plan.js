// The plan. Today is one room in three words: Page (the day's page, with its
// plan beside or on top), Plan (one outline from today outward) and Calendar
// (Day, Week, Six weeks: ahead.js, and Pace: what you planned against what it
// really took). Tasks are
// ordinary lines with a day (see tasks.js), gathered here from wherever they
// live. Plain text on hairlines; nothing is copied.

import { popMenu, askText } from './menu.js';
import { trash, restore } from './trash.js';
import {
  loadTasks, dayPlan, weekPlan, pace, planSettings, savePlanSettings, setTask, unTask, tickTask, tookTask, startTimer, stopTimer,
  addTask, renameTask, arrange, arrangeCarried, weave, plainLine, parseEst, readSpan, timed, span, hours, isoOf, addDays, dateOf, weekOf, dayWord, TASKS_PAGE, stepsPage, stepsHome,
  moveTask, isStretch, stretchWord, isRepeat, repeatWord, readDays, parseAdd, history, occItem, setRepeat, skipTask, rollTicked, dow, areaHours,
  setWhen, whenSnap, whenBack, rankAll, horizon, whenHeadings, whenOf, whenWord, spanOf, taskOf
} from './tasks.js';
import { pickWhen, currentChoice } from './when.js';
import { areas, areaColor } from './library.js';
import { drawAhead, aheadClick, aheadContext, aheadDrags } from './ahead.js';
import { clockWord, freeLeft } from './calendar.js';
import { drawCalendar } from './plancal.js';
import { children, getEntry, isTrashed } from './db.js';

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};
const ICON = {
  play: '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M4 2.5v11l9-5.500z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M3 8.500l3.200 3.200L13 4.800" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
const ESTS = [5, 10, 15, 30, 45, 60, 90, 120, 180];
// Today in three words, each with one job: Page (where you write today),
// Plan (where you decide what's when: one list from today outward) and
// Calendar (where you look: the same plan drawn on time, with a zoom of Day,
// Week and Six weeks, and Pace while time estimates are on). On a computer
// the first is "Today": the page and the plan together. Keys: Alt + 1, 2, 3.
export const ZOOMS = [['calday', 'Day'], ['week', 'Week'], ['ahead', 'Six weeks'], ['pace', 'Pace']];
const CAL = new Set(ZOOMS.map((z) => z[0]));
export const isCal = (tab) => CAL.has(tab);
// A remembered place or an old link: What's when is Plan now.
export const tabFor = (tab) => (tab === 'when' ? 'plan' : ['plan', 'day', ...CAL].includes(tab) ? tab : 'week');
const TABS = [['today', 'Today', 'today', 'Alt+1'], ['plan', 'Plan', 'plan', 'Alt+2'], ['cal', 'Calendar', 'calendar', 'Alt+3']];
const PHONE_TABS = [['page', 'Page', 'today-page'], ['plan', 'Plan', 'today-plan'], ['cal', 'Calendar', 'calendar']];
const clip = (t, n = 40) => { const s = String(t || 'Untitled').replace(/\s+/g, ' ').trim() || 'Untitled'; return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const hover = matchMedia('(hover: hover)');
const long = (iso, opts) => dateOf(iso).toLocaleDateString('en-US', opts);
// "12:04" while a timer runs.
const clock = (task, now) => {
  const s = Math.floor(((task.log || []).reduce((a, [x, y]) => a + Math.max(0, y - x), 0) + (task.run ? Math.max(0, now - task.run) : 0)) / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
};

// hooks: view() → the view showing, changed(rows) (rows this wrote, for the
// page that may have them open), openEntry(id), go(place), toast(text),
// off(name) → is that part switched off under Look, beside(id) → a way to
// open that entry beside (null when there's none), ahead() → the lanes and
// dates for Weeks ahead, talk() → a way to open Claude beside (or null).
// steps is where a project's own tasks show on its page.
export class Plan {
  constructor({ box, sheet, steps = null, hooks }) {
    this.box = box;
    this.sheet = sheet;
    this.steps = steps;
    this.hooks = hooks;
    this.day = null; // the day whose plan sits on the day page
    this.world = null; // the project whose steps show on its page
    this.allDone = false;
    this.tab = 'week';
    this.week = null; // any day of the week shown (null: this week)
    this.items = [];
    this.free = 45;
    this.dayEnd = 22; // the hour the day ends, for "left today"
    this.cal = []; // calendar events for the days showing
    this.calKey = '';
    this.took = null; // the task just ticked, asked how long it took
    this.just = null;
    for (const el of [box, sheet, steps].filter(Boolean)) {
      el.addEventListener('click', (e) => this.click(e));
      el.addEventListener('keydown', (e) => this.key(e));
      el.addEventListener('dblclick', (e) => this.dblclick(e));
      el.addEventListener('contextmenu', (e) => {
        if (el === sheet && aheadContext(this, e)) return;
        const row = e.target.closest('[data-task]');
        if (!row || e.target.closest('input')) return;
        e.preventDefault();
        this.menu(this.item(row.dataset.task), row, { left: e.clientX, top: e.clientY });
      });
      if (el !== steps) this.drags(el);
    }
    // On a phone: Page, Plan, When, Week, Ahead, in one row above the day.
    this.phoneSw = make('nav', 'tp-switch');
    this.phoneSw.hidden = true;
    box.before(this.phoneSw);
    this.swipes(box.closest('.notebook'));
    // The plan beside the page needs a wide window: crossing 1100 px moves it.
    matchMedia('(min-width: 1100px)').addEventListener('change', () => { if (this.dayShown) this.redraw(); });
    this.swipes(sheet);
    this.aheadSrc = null; // the lanes and dates Weeks ahead was last drawn with
    this.aheadAdd = null; // { world, week, day } while something is being typed into a lane
    aheadDrags(this, sheet);
  }

  item(id) { return this.items.find((i) => i.row.id === id) || null; }
  get today() { return isoOf(); }
  get dayShown() { return !!this.day && this.hooks.view() === 'notebook'; }
  get pageShown() { return this.hooks.view() === 'plan'; }
  get stepsShown() { return !!this.world && !!this.steps && this.hooks.view() === 'world'; }

  // The end of a day's list (or of the tray): where something new goes.
  lastOrder(day) {
    return Math.max(0, ...this.items.filter((i) => (i.task.day || null) === (day || null)).map((i) => i.task.order || 0)) + 1;
  }

  // ---------- showing ----------

  // The day page calls this whenever it opens a page: a day gets its plan.
  async showDay(page) {
    this.day = page?.kind === 'day' ? page.title : null;
    this.took = this.just = null;
    this.box.hidden = !this.day;
    this.phoneShow(!!this.day && !hover.matches && !this.hooks.off?.('plan'));
    this.dock();
    if (this.day) await this.refresh();
    else this.box.replaceChildren();
  }

  // A project's page calls this when it opens: its own tasks, wherever in
  // the project they're written.
  async showSteps(world) {
    if (this.world?.id !== world?.id) this.allDone = false;
    this.world = world || null;
    if (this.world) await this.refresh();
    else this.steps?.replaceChildren();
  }

  async showPage(place) {
    // 'day' is today's plan on its own: what "Plan" shows beside another page.
    // What's when is Plan now; Week, Weeks ahead and Pace are zooms of Calendar.
    this.tab = tabFor(place.tab);
    if (isCal(this.tab)) this.calZoom = this.tab;
    this.week = place.week || null;
    this.aheadAdd = null;
    this.aheadHeld = false;
    this.sheet.dataset.tab = this.tab;
    await this.refresh();
  }

  // Something changed that the plan may show: look again, once things settle.
  soon() {
    if (this.writing) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 150);
  }

  async refresh() {
    // A repeating task ticked in its words on a page moves on to its next day.
    if (!this.rolling) {
      this.rolling = true;
      try { const rolled = await rollTicked(); if (rolled.length) await this.hooks.changed?.(rolled); } catch (e) { console.warn(e); } finally { this.rolling = false; }
    }
    if (!this.dayShown && !this.pageShown && !this.stepsShown) return;
    const turn = (this.turn = (this.turn || 0) + 1);
    const [items, settings, src, areaList] = await Promise.all([loadTasks(), planSettings(), this.pageShown && this.tab === 'ahead' ? this.hooks.ahead?.() : null, this.pageShown && this.tab === 'week' ? areas() : null]);
    if (turn !== this.turn) return;
    this.items = items;
    this.free = settings.free;
    this.dayEnd = settings.dayEnd;
    this.targets = settings.areas;
    if (areaList) this.areaList = areaList;
    if (src) this.aheadSrc = src;
    this.loadCalendar(turn);
    this.redraw();
    this.tickClock();
  }

  // On a computer, at 1100 px and wider, the plan can sit in its own column
  // beside the day's page (Alt + P flips it back on top, as on a phone).
  dock() {
    const main = this.box.closest('.notebook') || this.phoneSw.closest('.notebook');
    if (!main) return;
    const side = this.dayShown && hover.matches && this.hooks.layout?.() === 'side';
    if (side && this.box.parentElement !== main) main.append(this.box);
    else if (!side && this.box.parentElement === main) this.phoneSw.after(this.box);
    main.classList.toggle('plan-side', side);
  }

  redraw() {
    if (this.renaming) return;
    this.dock();
    if (this.dayShown) this.drawDay();
    if (this.stepsShown) this.drawSteps();
    if (this.pageShown) {
      if (this.tab === 'pace') this.drawPace();
      else if (this.tab === 'ahead') drawAhead(this);
      else if (this.tab === 'day') this.drawDay(this.sheet, this.today);
      else if (this.tab === 'calday') this.drawCalDay();
      else if (this.tab === 'plan') this.drawOutline(this.sheet);
      else this.drawWeek();
    }
    this.hooks.redrawn?.();
  }

  // Calendar events for the days showing: what's kept draws at once, and the
  // latest follows when it differs.
  loadCalendar(turn) {
    const week = this.pageShown && this.tab === 'week' ? weekOf(this.week || this.today) : null;
    const range = this.dayShown ? [this.day, this.day] : week ? [week[0], week[6]] : this.pageShown && ['day', 'calday', 'plan'].includes(this.tab) ? [this.today, this.today] : null;
    if (!range || !this.hooks.calendar || this.hooks.off?.('calendar')) { this.cal = []; this.calKey = ''; return; }
    const key = range.join('|');
    const got = this.hooks.calendar(range[0], range[1]);
    if (got.now) this.cal = got.now;
    else if (key !== this.calKey) this.cal = [];
    this.calKey = key;
    got.fresh.then((list) => {
      if (turn !== this.turn || !list || JSON.stringify(list) === JSON.stringify(this.cal)) return;
      this.cal = list;
      this.redraw();
    });
  }

  // One calendar event, said quietly.
  eventLine(e, cls) {
    const el = make('div', `${cls}${!e.allDay && e.end < Date.now() ? ' past' : ''}`);
    el.dataset.event = e.id;
    const dot = make('i');
    if (e.color) dot.style.background = e.color;
    const mins = e.allDay ? 0 : Math.round((e.end - e.start) / 6e4);
    el.append(dot, make('span', 'ev-t', e.allDay ? 'All day' : clockWord(e.start)), make('span', 'ev-w', e.title));
    if (mins && cls === 'pl-ev') el.append(make('span', 'ev-d', span(mins)));
    el.title = `${e.title}${e.allDay ? '' : ` · ${clockWord(e.start)} to ${clockWord(e.end)}`}${e.calendar ? ` · ${e.calendar}` : ''}`;
    return el;
  }

  // An event in a woven plan: fixed at its place; tasks go above or below it.
  wovenEvent(e, at) {
    const el = this.eventLine(e, 'pl-ev');
    el.classList.add('pl-wev');
    el.dataset.at = String(at);
    return el;
  }

  get estimates() { return !this.hooks.off?.('estimates'); }

  // After the plan writes: the open page hears about it, and the plan redraws.
  async wrote(rows) {
    const list = [rows].flat().filter(Boolean);
    this.writing = true;
    try { if (list.length) await this.hooks.changed?.(list); } finally { this.writing = false; }
    await this.refresh();
  }

  // What's typed in an "add" box, and where the caret is, survive a redraw.
  held(root) {
    const el = document.activeElement;
    if (!el || !root.contains(el) || !el.matches('input[data-add]')) return null;
    return { key: el.dataset.add, value: el.value };
  }
  restore(root, held) {
    if (!held) return;
    const el = [...root.querySelectorAll('input[data-add]')].find((i) => i.dataset.add === held.key);
    if (!el) return;
    el.value = held.value;
    el.focus({ preventScroll: true });
  }
  // The add box being typed in, if it's in this list: kept in place through a
  // redraw rather than drawn anew, because a phone's keyboard closes when the
  // box it types into is taken away (and focusing a new one doesn't reopen it).
  typingIn(box, key) {
    const el = document.activeElement;
    if (!el?.matches?.('input[data-add]') || el.dataset.add !== key || !box.contains(el)) return null;
    const row = el.closest('.pl-add');
    const list = row?.parentElement;
    return list?.classList.contains('pl-list') ? { row, list } : null;
  }
  // Fills a list around its add row: `before` above it, `after` below. The
  // row itself never leaves the page, so the caret and the keyboard stay.
  fillAround(list, row, before, after) {
    for (const el of [...list.children]) if (el !== row) el.remove();
    row.before(...before);
    row.after(...after);
  }

  // Today, Plan, Calendar (Page, Plan, Calendar on a phone). On a calendar the
  // zoom comes with it: a row under the switch on a phone, beside it on a computer.
  switchRow(current) {
    const small = !hover.matches;
    const row = make('div', `pl-switch${small ? ' pl-switch-phone' : ''}`);
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Views of Today');
    const here = isCal(current) ? 'cal' : current === 'day' ? (small ? 'plan' : 'today') : current;
    for (const [id, label, cmd, keys] of small ? PHONE_TABS : TABS) {
      const b = make('button', '', label);
      b.dataset.cmd = cmd;
      if (keys) b.title = `${label} (${keys.replace('+', ' + ')}${id === 'cal' ? ', again for the next zoom' : ''})`;
      if (id === here) b.setAttribute('aria-current', 'page');
      row.append(b);
    }
    if (!isCal(current)) return row;
    const both = make('div', 'pl-switches');
    both.append(row, this.zoomRow(current));
    return both;
  }
  zoomRow(current) {
    const row = make('div', 'pl-zoom');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'How far to look');
    for (const [tab, label] of ZOOMS) {
      if (tab === 'pace' && !this.estimates) continue;
      const b = make('button', '', label);
      b.dataset.act = 'zoom';
      b.dataset.tab = tab;
      b.setAttribute('aria-pressed', String(tab === current));
      if (hover.matches) b.title = `${label} (Alt + 3 steps the zoom)`;
      row.append(b);
    }
    return row;
  }
  // The zoom the calendar opens on: the one used last on this device.
  get calZoom() {
    let z = 'week';
    try { z = localStorage.getItem('calZoom') || 'week'; } catch { /* no storage here */ }
    return isCal(z) && (z !== 'pace' || this.estimates) ? z : 'week';
  }
  set calZoom(v) { try { localStorage.setItem('calZoom', v); } catch { /* no storage here */ } }
  // Alt + 3 in a calendar: the next zoom (Day, Week, Six weeks, then Day again).
  stepZoom() {
    const list = ZOOMS.map((z) => z[0]).filter((z) => z !== 'pace' || this.estimates);
    const at = this.pageShown && isCal(this.tab) ? list.indexOf(this.tab) : -1;
    const to = at < 0 ? this.calZoom : list[(at + 1) % list.length];
    this.calZoom = to;
    return this.hooks.go({ view: 'plan', tab: to });
  }

  // ---------- the day on a phone: Page or Plan ----------

  // Page or Plan, the last one picked on this device (Plan the first time).
  get phoneDay() { try { return localStorage.getItem('todayPhone') === 'page' ? 'page' : 'plan'; } catch { return 'plan'; } }
  set phoneDay(v) { try { localStorage.setItem('todayPhone', v); } catch { /* no storage here */ } }
  // On a phone a day's page opens on one of the two, with the switch above it.
  phoneShow(on) {
    const nb = this.box.closest('.notebook');
    const sw = this.phoneSw;
    if (!nb) return;
    nb.classList.toggle('tp-on', !!on);
    if (on) nb.dataset.tp = this.phoneDay; else delete nb.dataset.tp;
    if (sw) {
      sw.hidden = !on;
      if (on) sw.replaceChildren(this.switchRow(this.phoneDay === 'page' ? 'page' : 'plan'));
    }
  }
  // On a phone, today's Plan is the whole outline, from today outward.
  get outlineHere() { return this.dayShown && !hover.matches && this.day === this.today; }
  // A sideways swipe on a phone flips to the view next door. A hold on a task
  // (to move it), a hold on a line, picked words and Six weeks' own sideways
  // scroll all keep the finger.
  swipes(root) {
    if (!root) return;
    let s = null;
    root.addEventListener('touchstart', (e) => {
      s = null;
      if (hover.matches || e.touches.length !== 1) return;
      if (e.target.closest?.('.ah-wrap, .dc, .pu, input, textarea, .pop-menu, .pl-pickbar, .pl-zoom')) return;
      s = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }, { passive: true });
    root.addEventListener('touchend', (e) => {
      const was = s;
      s = null;
      if (!was) return;
      const html = document.documentElement;
      if (['pl-touchdrag', 'line-holding', 'pl-calm', 'pull-dropping'].some((c) => html.classList.contains(c))) return;
      const dx = e.changedTouches[0].clientX - was.x;
      const dy = e.changedTouches[0].clientY - was.y;
      if (Date.now() - was.t > 700 || Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy)) return;
      if (getSelection && !getSelection()?.isCollapsed) return;
      this.flipBy(dx < 0 ? 1 : -1);
    }, { passive: true });
  }
  flipBy(n) {
    const order = ['page', 'plan', 'cal'];
    const here = this.dayShown ? (this.day === this.today ? this.phoneDay : null) : this.pageShown ? (isCal(this.tab) ? 'cal' : this.tab === 'plan' ? 'plan' : null) : null;
    const at = order.indexOf(here);
    const to = order[at + n];
    if (at < 0 || !to) return false;
    this.goTab(to);
    return true;
  }
  // Open one of Today's views (Page and Plan are today's page on a phone).
  goTab(id) {
    if (id === 'day') id = 'plan';
    if (id === 'page' || id === 'plan') {
      if (this.dayShown && this.day === this.today) return this.setPhoneDay(id);
      this.phoneDay = id;
      return this.hooks.go({ view: 'notebook', pageId: `day-${this.today}` });
    }
    if (id === 'cal') return this.hooks.go({ view: 'plan', tab: this.calZoom });
    return this.hooks.go({ view: 'plan', tab: id });
  }
  setPhoneDay(v) {
    if (v !== 'page' && v !== 'plan') return;
    this.phoneDay = v;
    if (this.dayShown && !hover.matches) { this.phoneShow(true); this.redraw(); }
    document.scrollingElement?.scrollTo?.(0, 0);
  }

  // "From a project": a project's lines open next to the plan (beside it on
  // a computer, in the bottom half on a phone), to drag onto it.
  pullButton() {
    if (!this.hooks.pull) return null;
    const b = make('button', 'ghost-btn pl-pull', 'From a project');
    b.dataset.act = 'pull';
    b.title = 'Open a project next to the plan and drag its steps in';
    b.setAttribute('aria-pressed', String(!!this.hooks.pulling?.()));
    return b;
  }

  // ---------- Day ----------

  // A day's list, as the plan on its page and as Today in the outline: the
  // tasks from earlier days (folded past three), today's own in your order
  // with events woven in, Add a task, then what's done.
  dayBits(day) {
    const today = this.today;
    const p = dayPlan(this.items, day, today);
    const evs = this.cal.filter((e) => e.day === day);
    // A repeat's missed day stays in sight on top: it isn't stuck, it comes
    // round again by itself, so it never hides in the fold.
    const missed = p.carried.filter((i) => isRepeat(i.task));
    const old = p.carried.filter((i) => !isRepeat(i.task));
    const early = day === today ? this.earlyLine(old) : null;
    const showOld = !early || early.open;
    // Woven: timed events sit among the tasks, at their place in the day; all-day
    // ones (and every event, with "Events among the tasks" off) stay on top.
    const woven = !this.hooks.off?.('woven');
    const timed = woven ? evs.filter((e) => !e.allDay) : [];
    const top = woven ? evs.filter((e) => e.allDay) : evs;
    const cal = make('div', 'pl-cal');
    cal.setAttribute('aria-label', 'On your calendar');
    for (const e of top) cal.append(this.eventLine(e, 'pl-ev'));
    cal.hidden = !top.length;
    const row = (i) => this.taskRow(i, { next: day === today && i === p.next });
    const above = [
      ...missed.flatMap((i) => this.taskRow(i, { carried: true, next: day === today && i === p.next })),
      ...(early ? [early.el] : []),
      ...(showOld ? old.flatMap((i) => this.taskRow(i, { carried: true, next: day === today && i === p.next })) : []),
      ...(timed.length ? weave(p.open, timed, day, Date.now(), today).flatMap((x) => (x.event ? [this.wovenEvent(x.event, x.at)] : row(x.item))) : p.open.flatMap(row))
    ];
    const below = p.done.flatMap((i) => this.taskRow(i, {}));
    return { p, evs, cal, above, below };
  }

  // The list itself, kept in place while something is being typed into it.
  dayListIn(box, day, bits, cls = 'pl-list') {
    const typing = this.typingIn(box, day);
    if (typing) {
      typing.list.dataset.day = day;
      this.fillAround(typing.list, typing.row, bits.above, bits.below);
      return { list: typing.list, typing: true };
    }
    const list = make('div', cls);
    list.dataset.day = day;
    list.append(...bits.above, this.addRow(day, 'Add a task', { pull: true }), ...bits.below);
    return { list, typing: false };
  }

  drawDay(box = this.box, day = this.day) {
    if (box === this.box && this.outlineHere && this.phoneDay === 'plan') return this.drawOutline(box);
    const today = this.today;
    const bits = this.dayBits(day);
    const { p, evs } = bits;
    const held = this.held(box);
    const head = make('div', 'pl-head');
    head.append(make('h2', 'pl-label', 'Plan'));
    const said = [];
    // Time estimates are off unless switched on under Look: then it's only how many.
    const est = this.estimates;
    if (p.todo.length) said.push(est && p.left ? `${span(p.left)} to do` : `${p.todo.length} to do`);
    if (p.done.length) said.push(est && p.spent ? `${span(p.spent)} done` : `${p.done.length} done`);
    head.append(make('span', 'pl-sum', said.join(' · ')));
    // Today: the time still free before your day ends, less what's on the calendar.
    if (est && day === today && p.todo.length) head.append(this.leftToday(p, evs));
    // On a computer the plan sits beside the page or on top of it: one click flips it.
    const flip = this.hooks.layout && box === this.box && hover.matches ? this.hooks.layout() : null;
    if (flip) {
      const b = make('button', 'ghost-btn pl-flip', flip === 'side' ? '⤒ On top' : '⇥ To the side');
      b.dataset.act = 'flip';
      b.title = flip === 'side' ? 'The plan on top of the page, in one column (Alt + P)' : 'The plan in a column beside the page (Alt + P)';
      head.append(b);
    }
    head.append(this.switchRow('day'));
    const { list, typing } = this.dayListIn(box, day, bits);
    // Today on a computer: Tomorrow and This week as two folded lines under the
    // day (drop a task on one to push it out), then the rest of the plan as one.
    const more = box === this.box && day === today && hover.matches ? this.furtherLines() : [];
    if (typing) {
      for (const el of [...box.children]) if (el !== list) el.remove();
      box.prepend(head, bits.cal);
      list.after(...more);
    } else {
      box.replaceChildren(head, bits.cal, list, ...more);
      this.restore(box, held);
    }
    box.dataset.n = String(p.todo.length + p.done.length);
    this.just = null;
    if (box === this.box) this.backAgain();
  }

  // "6 h 25 min left today": the time still free before your day ends.
  leftToday(p, evs) {
    const free = Math.floor(freeLeft(evs, Date.now(), this.dayEnd) / 5) * 5;
    const left = make('button', `pl-left${p.left > free ? ' over' : ''}`, `${span(free)} left today`);
    left.dataset.act = 'dayend';
    const h = Math.floor(this.dayEnd);
    const m = Math.round((this.dayEnd % 1) * 60);
    left.title = `Until ${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 || h === 24 ? 'am' : 'pm'}${evs.some((e) => !e.allDay) ? ', less what’s on your calendar' : ''}: click to change when your day ends`;
    return left;
  }

  // Under today's list on a computer: "Tomorrow · 2", "This week · 4" and
  // "Further out · 9". Each opens Plan; the first two take a dropped task.
  furtherLines() {
    const { heads } = this.whenModel();
    const n = (id) => heads.find((x) => x.id === id)?.items.length || 0;
    const far = ['next', 'month', 'later'].reduce((a, id) => a + n(id), 0) + this.unplanned().length;
    const box = make('div', 'pl-further');
    const line = (id, label, count) => {
      const sec = make('section', 'ww-sec folded pl-fline');
      if (id) sec.dataset.bucket = id;
      const hd = make('h2', 'ww-h');
      const b = make('button', 'ww-fold');
      b.dataset.act = 'open-plan';
      if (id) b.dataset.bucket = id;
      b.title = id ? `Open Plan at ${label} (or drop a task here to move it there)` : 'Open Plan: the whole list, from today outward (Alt + 2)';
      b.append(make('span', 'ww-tri', '▸'), make('span', 'ww-name', label), make('span', 'ww-n', count ? String(count) : ''));
      if (!id) b.append(make('span', 'pl-fline-go', 'Open Plan'));
      hd.append(b);
      sec.append(hd);
      if (id) {
        const list = make('div', 'pl-list ww-list');
        list.dataset.bucket = id;
        list.hidden = true;
        sec.append(list);
      }
      box.append(sec);
    };
    line('tomorrow', 'Tomorrow', n('tomorrow'));
    line('week', 'This week', n('week'));
    line(null, 'Further out', far);
    return [box];
  }

  // A calendar's Day: today's hours, with the tasks placed on them by hand.
  drawCalDay() {
    const day = this.today;
    const p = dayPlan(this.items, day, day);
    const evs = this.cal.filter((e) => e.day === day);
    const woven = !this.hooks.off?.('woven');
    const top = woven ? evs.filter((e) => e.allDay) : evs;
    const cal = make('div', 'pl-cal');
    for (const e of top) cal.append(this.eventLine(e, 'pl-ev'));
    cal.hidden = !top.length;
    this.sheet.replaceChildren(this.calHead('calday', long(day, { weekday: 'long', month: 'long', day: 'numeric' })), cal, drawCalendar(this, day, [...p.carried, ...p.open], evs));
    this.just = null;
  }
  // The top of a calendar zoom (and of Plan): its name, then From a project and the switch.
  calHead(tab, eyebrow) {
    const head = make('header', 'pl-top');
    const left = make('div');
    left.append(make('div', 'pl-eyebrow', eyebrow), make('h1', '', tab === 'plan' ? 'Plan' : 'Calendar'));
    const side = make('div', 'pl-side');
    side.append(...[tab === 'plan' || tab === 'week' ? this.pullButton() : null].filter(Boolean), this.switchRow(tab));
    head.append(left, side);
    return head;
  }

  // ---------- earlier days: one line, never a place tasks get stuck ----------

  // Open (unfolded) for the rest of today, once tapped.
  get earlyOpen() { try { return localStorage.getItem('earlyOpen') === this.today; } catch { return false; } }
  set earlyOpen(on) { try { if (on) localStorage.setItem('earlyOpen', this.today); else localStorage.removeItem('earlyOpen'); } catch { /* no storage here */ } }

  // The ones the line's actions move: not a repeat's missed day (it comes
  // round again by itself), and never Nate's.
  earlyIds(carried = dayPlan(this.items, this.today, this.today).carried) {
    return carried.filter((i) => !i.ghost && !i.occ && !isRepeat(i.task) && this.canRemove(i)).map((i) => i.row.id);
  }

  // The line: "▸ 8 from earlier days", To today, Go through, ⋯. Three or fewer
  // never fold; with "Fold earlier days" off under Look they're always open.
  earlyLine(carried, { fold = true } = {}) {
    if (carried.length <= 3) return null;
    const foldable = fold && !this.hooks.off?.('foldearlier');
    const open = !foldable || this.earlyOpen;
    const el = make('div', `pl-early${open ? ' open' : ''}`);
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'From earlier days');
    const n = make('button', 'pl-early-n');
    n.dataset.act = 'early-fold';
    n.append(make('span', 'pl-early-tri', foldable ? (open ? '▾' : '▸') : ''), make('span', '', `${carried.length} from earlier days`));
    if (foldable) { n.setAttribute('aria-expanded', String(open)); n.title = open ? 'Fold them into this line' : 'Show them here'; } else if (fold) n.disabled = true;
    else { n.dataset.act = 'open-today'; n.title = 'They wait at the top of today’s plan: open it'; }
    const acts = make('span', 'pl-early-acts');
    const btn = (act, label, title) => { const b = make('button', 'pl-early-b', label); b.dataset.act = act; b.title = title; acts.append(b); return b; };
    btn('early-today', 'To today', `Every one onto today, at the top${hover.matches ? ' (Alt + Shift + T)' : ''}`);
    if (this.hooks.goThrough) btn('thru-carried', 'Go through', 'One at a time: keep it for today, take it off the day, check it off or delete it');
    const more = btn('early-more', '⋯', 'More for these');
    more.classList.add('pl-early-more');
    more.setAttribute('aria-label', 'More for the tasks from earlier days');
    more.setAttribute('aria-haspopup', 'menu');
    el.append(n, acts);
    return { el, open };
  }

  earlyMenu(anchor) {
    const ids = this.earlyIds();
    if (!ids.length) return;
    popMenu(anchor, [
      { label: `All to today${hover.matches ? '  (Alt + Shift + T)' : ''}`, run: () => this.bringToday() },
      { label: 'All to another day…', run: () => this.pickWhenFor(ids, { anchor }) },
      { label: 'All off the day (they wait under Not planned)', run: () => this.applyWhen(ids, null, '') },
      'sep',
      { label: 'Pick several', run: () => this.startPicking() },
      { label: 'Always show them open', current: !!this.hooks.off?.('foldearlier'), run: () => this.hooks.show?.('foldearlier', !!this.hooks.off?.('foldearlier')) }
    ]);
  }

  // To today: every one from earlier days (or just `ids`) onto today, at the
  // top of today's list in the order they had. Undo puts each one back.
  async bringToday(ids = null) {
    if (!this.items?.length) await this.refresh();
    const today = this.today;
    const p = dayPlan(this.items, today, today);
    const moving = ids || this.earlyIds(p.carried);
    if (!moving.length) { this.hooks.toast?.('Nothing left from earlier days'); return; }
    const rest = p.open.filter((i) => !i.ghost && !moving.includes(i.row.id)).map((i) => i.row.id);
    const seq = [...moving, ...rest];
    const snaps = (await Promise.all(seq.map((id) => whenSnap(id)))).filter(Boolean);
    await this.wrote(await arrange(seq, today));
    this.unselect();
    const words = moving.length === 1 ? `“${clip((await getEntry(moving[0]))?.text)}” moved to today` : `${moving.length} moved to today`;
    this.hooks.toast?.(words, { label: 'Undo', run: async () => {
      const back = [];
      for (const x of snaps) back.push(await whenBack(x));
      await this.wrote(back.filter(Boolean));
      this.hooks.toast?.('Put back as they were');
    } });
  }

  // ---------- picking several ----------

  // On a phone, "Pick several" turns the circles into tick boxes; on a
  // computer Shift + click picks. Either way a bar offers what to do with them.
  startPicking() {
    this.picking = true;
    if (this.dayShown && this.box.querySelector('.pl-early') && !this.earlyOpen && !this.hooks.off?.('foldearlier')) this.earlyOpen = true;
    this.redraw();
    this.pickBar();
  }
  stopPicking() {
    this.picking = false;
    this.unselect();
    this.redraw();
  }

  pickBar() {
    const n = this.sel?.size || 0;
    let bar = document.querySelector('.pl-pickbar');
    for (const el of [this.box, this.sheet, this.steps].filter(Boolean)) el.classList.toggle('picking', !!this.picking);
    if (!n && !this.picking) { bar?.remove(); return; }
    if (!bar) {
      bar = make('div', 'pl-pickbar');
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'The tasks picked');
      bar.addEventListener('click', (e) => this.pickAct(e));
      document.body.append(bar);
    }
    const said = make('b', 'pl-pick-n', n ? `${n} picked` : 'Tap tasks to pick them');
    const b = (act, label, title = '') => { const x = make('button', `pl-pick-b${act === 'del' ? ' danger' : ''}`, label); x.dataset.pick = act; if (title) x.title = title; x.disabled = !n && act !== 'stop'; return x; };
    bar.replaceChildren(said,
      b('today', 'Today'), b('tomorrow', 'Tomorrow'), b('when', 'When…', 'Alt + W'), b('off', 'Off the day', 'Not planned: they wait under Not planned in Plan'),
      b('done', 'Done'), b('del', 'Delete', 'Ctrl + Shift + Backspace'), b('stop', this.picking ? 'Done picking' : '✕', hover.matches ? 'Let go (Esc)' : 'Stop picking'));
  }

  async pickAct(e) {
    const el = e.target.closest('[data-pick]');
    if (!el) return;
    const act = el.dataset.pick;
    const ids = [...(this.sel || [])];
    const today = this.today;
    if (act === 'stop') return this.stopPicking();
    if (!ids.length) return;
    const done = () => { this.picking = false; this.pickBar(); };
    if (act === 'today') {
      // Ones from earlier days land on top of today, the rest at the end.
      await this.applyWhen(ids, { day: today }, 'Today');
    } else if (act === 'tomorrow') await this.applyWhen(ids, { day: addDays(today, 1) }, 'Tomorrow');
    else if (act === 'when') return this.pickWhenFor(ids, { anchor: el });
    else if (act === 'off') await this.applyWhen(ids, null, '');
    else if (act === 'done') {
      const list = ids.map((x) => this.item(x)).filter((i) => i && !i.ghost && !i.occ && !(i.task.owner && i.task.owner !== 'me'));
      const rows = [];
      for (const i of list) rows.push(await tickTask(i.row.id, true, Date.now()));
      this.unselect();
      await this.wrote(rows.filter(Boolean));
      this.hooks.toast?.(list.length === 1 ? `“${clip(list[0].row.text)}” done` : `${list.length} done`, { label: 'Undo', run: async () => {
        const back = [];
        for (const i of list) back.push(await tickTask(i.row.id, false, Date.now()));
        await this.wrote(back.filter(Boolean));
      } });
    } else if (act === 'del') await this.remove(ids.map((x) => this.item(x)).filter(Boolean));
    done();
  }

  // Back out of a task zoomed into from here: the page is where it was.
  backAgain() {
    const b = this.leftAt;
    if (!b || Date.now() - b.at > 30 * 60000 || !this.box.querySelector(`[data-task="${CSS.escape(b.id)}"]`)) return;
    this.leftAt = null;
    const put = () => { const el = document.scrollingElement; if (el && Math.abs(el.scrollTop - b.y) > 4) el.scrollTop = b.y; };
    requestAnimationFrame(put);
    setTimeout(put, 250);
  }

  // ---------- Steps: a project's tasks on its page ----------

  drawSteps() {
    const box = this.steps;
    const w = this.world;
    const today = this.today;
    const mine = this.items.filter((i) => i.world?.id === w.id);
    const at = (i) => i.task.day || spanOf(i.task)?.start || (spanOf(i.task) ? '9998' : '9999');
    const open = mine.filter((i) => !i.row.fields?.done).sort((a, b) => at(a).localeCompare(at(b)) || (a.task.order || 0) - (b.task.order || 0) || (a.row.created_at || 0) - (b.row.created_at || 0));
    const done = mine.filter((i) => i.row.fields?.done).sort((a, b) => (b.task.done_at || 0) - (a.task.done_at || 0));
    const held = this.held(box);
    const head = make('h2', 'wp-sec', 'Steps');
    if (mine.length) head.append(make('span', 'wp-more', `${done.length} of ${mine.length} done`));
    // Where a step is written, unless it's the project's own Steps page.
    const place = (i) => (i.root.id === stepsPage(w.id) ? '' : i.root.title || 'Untitled');
    const above = open.flatMap((i) => this.taskRow(i, { when: true, drag: false, place: place(i) }));
    const few = 3;
    const below = (this.allDone ? done : done.slice(0, few)).flatMap((i) => this.taskRow(i, { when: true, drag: false, place: place(i) }));
    if (done.length > few) {
      const b = make('button', 'wp-link pl-alldone', this.allDone ? 'Fewer' : `${done.length - few} more done`);
      b.dataset.act = 'all-done';
      below.push(b);
    }
    const typing = this.typingIn(box, 'steps');
    if (typing) {
      for (const el of [...box.children]) if (el !== typing.list) el.remove();
      box.prepend(head);
      this.fillAround(typing.list, typing.row, above, below);
    } else {
      const list = make('div', 'pl-list');
      const add = this.addRow(null, 'Add a step');
      add.querySelector('input').dataset.add = 'steps';
      add.querySelector('input').setAttribute('aria-label', `Add a step to ${w.title || 'this project'}`);
      list.append(...above, add, ...below);
      box.replaceChildren(head, list);
    }
    box.dataset.n = String(mine.length);
    box.dataset.today = today;
    this.restore(box, held);
    this.just = null;
    this.hooks.steps?.();
  }

  addRow(day, placeholder, { pull = false } = {}) {
    // A form, so a phone keyboard's Enter (or Go) sends it like a desktop Enter does.
    const row = make('form', 'pl-add');
    row.noValidate = true;
    row.addEventListener('submit', (e) => { e.preventDefault(); this.add(input); });
    // A click anywhere on the row goes into the box, as it did when the row was a label.
    row.addEventListener('click', (e) => { if (e.target !== input && !e.target.closest('.pl-from-project')) input.focus(); });
    const ring = make('span', 'pl-check ghost');
    ring.setAttribute('aria-hidden', 'true');
    const input = make('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    // "Enter", not "Done": the keyboard stays up for the next one.
    input.setAttribute('enterkeyhint', 'enter');
    input.setAttribute('aria-label', day ? `Add a task for ${dayWord(day, this.today)}` : 'Add a task for any day this week');
    input.dataset.add = day || 'tray';
    row.append(ring, input);
    // "From a project", where you'd add a task: a project's lines open next
    // to the plan, to drag in.
    if (pull && this.hooks.pull) {
      const b = make('button', 'pl-from-project', 'From a project');
      b.dataset.act = 'pull';
      b.title = 'Open a project next to the plan and drag its lines in';
      b.setAttribute('aria-pressed', String(!!this.hooks.pulling?.()));
      row.classList.add('with-pull');
      row.append(b);
    }
    return row;
  }

  taskRow(i, { carried = false, next = false, when = false, drag = true, place = null, tag = '' }) {
    const t = i.task;
    const id = i.row.id;
    const done = !!i.row.fields?.done;
    const rep = isRepeat(t);
    const ghost = !!i.ghost;
    const row = make('div', `pl-task${done ? ' done' : ''}${next ? ' next' : ''}${t.run ? ' timing' : ''}${carried ? ' carried' : ''}${this.just === id && !ghost ? ' justdone' : ''}${ghost ? ' ghost' : ''}${t.habit ? ' habit' : ''}`);
    row.dataset.task = id;
    if (this.sel?.has(id)) row.classList.add('sel');
    if (i.occ) row.dataset.occ = i.occ;
    if (ghost) row.dataset.ghost = i.ghost;
    if (!done && !ghost && drag) {
      row.dataset.move = '1';
      if (hover.matches) row.draggable = true;
      // The six dots say it can be moved: drag it, or press and hold on a phone.
      const grip = make('span', 'pl-grip', '⠿');
      grip.setAttribute('aria-hidden', 'true');
      grip.title = hover.matches ? 'Drag to move it (or Alt + Up / Alt + Down)' : 'Press and hold, then slide to move it';
      row.append(grip);
    }
    const check = make('button', 'pl-check');
    check.innerHTML = ICON.check;
    check.dataset.act = 'tick';
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', String(done));
    check.setAttribute('aria-label', done ? 'Done; click to untick' : ghost ? 'It comes round on this day' : 'Tick when done');
    if (ghost) check.setAttribute('aria-disabled', 'true');
    const title = make('div', 'pl-title');
    const words = make('button', 'pl-words', i.row.text || 'Untitled');
    words.dataset.act = t.habit ? 'history' : 'words';
    words.title = t.habit ? 'A habit: click for how it’s going' : hover.matches && plainLine(i.row) ? 'Click to open it, double-click to change the words' : 'Open it';
    title.append(words);
    // Lines written under a task are its notes. As in an outliner, a small
    // triangle shows them right here, under the task, and hides them again.
    const open = !!i.notes && !ghost && this.unfolded(id);
    if (i.notes) {
      const n = make('button', `pl-fold${open ? ' open' : ''}`, open ? '▾' : '▸');
      n.dataset.act = 'fold';
      n.title = `${open ? 'Hide' : 'Show'} ${i.notes === 1 ? 'the line' : `the ${i.notes} lines`} under it`;
      n.setAttribute('aria-label', n.title);
      n.setAttribute('aria-expanded', String(open));
      title.append(n);
    }
    if (rep) {
      const mark = make('button', 'pl-rep', '↻');
      mark.dataset.act = 'history';
      mark.title = `${repeatWord(t.repeat)}${t.habit ? ' · a habit' : ''}`;
      mark.setAttribute('aria-label', `${repeatWord(t.repeat)}${t.habit ? ', a habit' : ''}: how it’s going`);
      title.append(mark);
    }
    if (tag) title.append(make('span', 'pl-from ww-date', tag));
    // Its details in two parts: what it is (where it's written, whose, the day
    // it was planned for), which a phone puts on a small line under the words
    // only when there's something to say; and what to do with it, at the end
    // of the first row.
    const meta = make('div', 'pl-meta');
    const sub = make('span', 'pl-sub');
    const acts = make('span', 'pl-acts');
    if (carried) sub.append(make('span', 'pl-from', `from ${long(t.day, { weekday: 'short', month: 'short', day: 'numeric' })}`));
    const where = place ?? this.placeOf(i);
    if (where) {
      const a = make('button', 'pl-place', where);
      a.dataset.act = 'open';
      a.title = 'Open it where it’s written';
      sub.append(a);
    }
    // A task kept in step with the Acro HQ board: whose it is (when it isn't
    // yours), and a way to its card there.
    if (t.owner && t.owner !== 'me') sub.append(make('span', 'pl-owner', String(t.owner)));
    const hq = i.row.fields?.hq;
    if (hq?.link && /^https:\/\//.test(hq.link)) {
      const a = make('a', 'pl-hq', 'HQ');
      a.href = hq.link;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = 'Open it on the Acro HQ board';
      sub.append(a);
    }
    // On a project's page a step says its day; click to move it.
    if (when && !done) {
      const stretch = isStretch(t);
      const late = stretch ? t.until < this.today : t.day && t.day < this.today;
      const loose = !stretch && spanOf(t);
      const word = stretch ? stretchWord(t) : loose ? whenWord(t, this.today) : t.day ? `${t.mark ? '◆ ' : ''}${dayWord(t.day, this.today)}` : 'When?';
      if (rep) row.dataset.repeat = repeatWord(t.repeat);
      const d = make('button', `pl-when${t.day || loose ? (late ? ' late' : '') : ' unset'}${loose ? ' loose' : ''}${t.mark === 'hard' ? ' hard' : ''}`, word);
      d.dataset.act = 'day';
      d.setAttribute('aria-label', stretch ? `From ${word}; click to move it` : loose ? `${word}; click to change when (Alt + W)` : t.day ? `${t.mark ? 'A date to hit: ' : 'Planned for '}${dayWord(t.day, this.today)}${t.mark === 'hard' ? ', and it can’t move' : ''}; click to change when (Alt + W)` : 'Not planned; click to say when (Alt + W)');
      sub.append(d);
    }
    // From an earlier day: one tap puts it on today.
    if (carried && !ghost && !rep) {
      const b = make('button', 'pl-today', 'Today');
      b.dataset.act = 'one-today';
      b.title = 'Put it on today, at the top';
      b.setAttribute('aria-label', `Put “${i.row.text || 'Untitled'}” on today`);
      acts.append(b);
    }
    // The timer goes with time estimates: with them off it isn't there at all.
    if (!done && !ghost && !t.habit && (this.estimates || t.run)) {
      const play = make('button', 'pl-play');
      play.innerHTML = t.run ? ICON.pause : ICON.play;
      play.dataset.act = 'timer';
      play.setAttribute('aria-label', t.run ? 'Stop the timer' : 'Start the timer');
      acts.append(play);
    }
    const est = make('button', 'pl-est');
    est.dataset.act = 'est';
    if (t.run) { est.textContent = clock(t, Date.now()); est.dataset.timer = id; est.classList.add('live'); est.setAttribute('aria-label', 'Time on the clock'); }
    else if (done && !this.estimates) { est.textContent = t.actual ? span(t.actual) : ''; est.hidden = !t.actual; est.setAttribute('aria-label', 'How long it took'); }
    else if (done) { est.textContent = t.actual && t.est && t.actual !== t.est ? `${span(t.est)} → ${span(t.actual)}` : t.actual || t.est ? span(t.actual || t.est) : ''; est.setAttribute('aria-label', 'How long it took'); }
    // With estimates off, an open task says nothing about how long it takes.
    else if (!this.estimates) est.hidden = true;
    else { est.textContent = t.est ? span(t.est) : 'how long?'; if (!t.est) est.classList.add('unset'); est.setAttribute('aria-label', t.est ? `Takes about ${span(t.est)}; click to change` : 'Say how long it takes'); }
    // A habit has no hours: nothing to guess, nothing to say afterwards.
    if (t.habit) est.hidden = true;
    const more = make('button', 'pl-more', '⋯');
    more.dataset.act = 'more';
    more.setAttribute('aria-label', 'More for this task');
    more.setAttribute('aria-haspopup', 'menu');
    acts.append(est, more);
    meta.append(sub, acts);
    if (!sub.childElementCount) row.classList.add('one-row');
    row.append(check, title, meta);
    const out = [row];
    if (open) out.push(this.kidsBox(id));
    if (this.took === id && done) out.push(this.tookRow(i));
    return out;
  }

  // ---------- a task's lines, shown under it ----------

  unfolded(id) { return this.folds().includes(id); }
  folds() { try { return JSON.parse(localStorage.getItem('planOpen') || '[]'); } catch { return []; } }
  fold(id, open) {
    const all = this.folds().filter((x) => x !== id);
    if (open) all.push(id);
    try { localStorage.setItem('planOpen', JSON.stringify(all.slice(-200))); } catch { /* no storage here */ }
  }

  // The lines under a task, nested as they're written. A click on one opens
  // the task as a page with the cursor on that line, to write there; a link
  // in one opens as a link does anywhere.
  kidsBox(id) {
    const box = make('div', 'pl-kids');
    box.dataset.kidsOf = id;
    const fill = async (parent, ul, depth, left) => {
      for (const r of await children(parent)) {
        if (r.kind !== 'line' || left.n <= 0) continue;
        left.n -= 1;
        const li = make('li', `pl-kid${r.fields?.done ? ' done' : ''}`);
        const p = make('div', 'pl-kid-text');
        p.dataset.act = 'kid';
        p.dataset.line = r.id;
        p.append(...lineBits(r));
        if (!p.textContent.trim()) continue;
        li.append(p);
        ul.append(li);
        if (depth < 4) {
          const sub = make('ul');
          await fill(r.id, sub, depth + 1, left);
          if (sub.childElementCount) li.append(sub);
        }
      }
    };
    const ul = make('ul');
    box.append(ul);
    fill(id, ul, 1, { n: 80 }).catch((e) => console.error(e));
    return box;
  }

  // "How long did it take?", right under the task just ticked.
  tookRow(i) {
    const t = i.task;
    const row = make('div', 'pl-took');
    row.dataset.took = i.row.id;
    row.append(make('span', '', 'How long did it take?'));
    const on = timed(t);
    const base = t.est ? [...new Set([Math.max(5, Math.round(t.est / 2 / 5) * 5), t.est, Math.round((t.est * 1.5) / 5) * 5, t.est * 2])] : [15, 30, 60, 120];
    const add = (m, label, lit) => {
      const b = make('button', lit ? 'on' : '', label);
      b.dataset.act = 'took';
      b.dataset.m = String(m);
      row.append(b);
    };
    if (on) add(on, `${span(on)} timed`, true);
    for (const m of base) if (m !== on) add(m, `${span(m)}${m === t.est ? ' as planned' : ''}`);
    const other = make('button', '', 'Another…');
    other.dataset.act = 'took-other';
    row.append(other);
    return row;
  }

  // Where a task lives, said short. Nothing for the Tasks page, or for the
  // very day page the plan sits on.
  placeOf(i) {
    if (i.world) return i.world.title || 'Untitled';
    if (i.root.id === TASKS_PAGE) return '';
    if (i.root.kind === 'day') return i.root.title === (this.pageShown ? this.today : this.day) && (this.dayShown || this.tab === 'day') ? '' : long(i.root.title, { month: 'short', day: 'numeric' });
    return i.root.title || 'Untitled';
  }

  // ---------- What's when ----------

  // The six headings and what's under each: Today and Tomorrow as on their
  // day's plan, the rest in the order you put them.
  whenModel() {
    const today = this.today;
    const h = horizon(today);
    const heads = whenHeadings(h).map((x) => ({ ...x, items: [] }));
    const by = new Map(heads.map((x) => [x.id, x]));
    for (const i of this.items) {
      if (!i.mine || i.row.fields?.done || isStretch(i.task)) continue;
      const w = whenOf(i.task, h);
      if (w && w !== 'today' && w !== 'tomorrow') by.get(w).items.push(i);
    }
    const p = dayPlan(this.items, today, today);
    by.get('today').items = [...p.carried, ...p.open.filter((i) => !i.ghost)];
    by.get('tomorrow').items = dayPlan(this.items, h.tomorrow, today).open.filter((i) => !i.ghost);
    const at = (i) => i.task.day || spanOf(i.task)?.start || '';
    for (const x of heads.slice(2)) {
      const n = (i) => (i.task.rank?.h === x.key && Number.isFinite(i.task.rank?.n) ? i.task.rank.n : Infinity);
      x.items.sort((a, b) => n(a) - n(b) || at(a).localeCompare(at(b)) || (a.task.order || 0) - (b.task.order || 0) || (a.row.created_at || 0) - (b.row.created_at || 0));
    }
    return { h, heads };
  }

  // Which headings of Plan are open on this device: Today, until you open more.
  planOpen() {
    try { const v = JSON.parse(localStorage.getItem('planOpen') || 'null'); if (Array.isArray(v)) return new Set(v); } catch { /* no storage here */ }
    return new Set(['today']);
  }
  planFold(id, open) {
    const all = this.planOpen();
    if (open) all.add(id); else all.delete(id);
    try { localStorage.setItem('planOpen', JSON.stringify([...all])); } catch { /* no storage here */ }
  }

  // Every open task of yours with no day and no time.
  unplanned(h = horizon(this.today)) {
    return this.items.filter((i) => i.mine && !i.row.fields?.done && !isStretch(i.task) && !i.ghost && !whenOf(i.task, h));
  }

  // Plan: one outline from today outward. The tasks from earlier days fold
  // into their own line; Today is the real day list (your order, repeats,
  // events woven in, Add a task); then Tomorrow, This week, Next week, the
  // month, Later and Not planned, each folding with its count. Drop a task
  // or a project's step on any heading, folded or open.
  drawOutline(box = this.sheet) {
    const { h, heads } = this.whenModel();
    const today = h.today;
    const opens = this.planOpen();
    const held = this.held(box);
    const inDay = box === this.box;
    const head = inDay ? null : this.calHead('plan', long(today, { weekday: 'long', month: 'long', day: 'numeric' }));
    const sec = (id, label, n, cls = '') => {
      const open = opens.has(id);
      const el = make('section', `ww-sec${open ? '' : ' folded'}${n ? '' : ' empty'}${cls}`);
      el.dataset.bucket = id;
      const hd = make('h2', 'ww-h');
      const fold = make('button', 'ww-fold');
      fold.dataset.act = 'ww-fold';
      fold.setAttribute('aria-expanded', String(open));
      fold.setAttribute('aria-label', `${open ? 'Fold' : 'Unfold'} ${label}`);
      fold.append(make('span', 'ww-tri', open ? '▾' : '▸'), make('span', 'ww-name', label), make('span', 'ww-n', n ? String(n) : ''));
      hd.append(fold);
      el.append(hd);
      return { el, open };
    };
    // Today: the day list itself.
    const bits = this.dayBits(today);
    const t = sec('today', 'Today', bits.p.todo.length, ' ol-today');
    if (this.estimates && bits.p.todo.length) t.el.querySelector('.ww-h').append(this.leftToday(bits.p, bits.evs));
    const { list, typing } = this.dayListIn(box, today, bits, 'pl-list ww-list');
    list.hidden = !t.open;
    bits.cal.hidden = bits.cal.hidden || !t.open;
    const shortDay = (iso) => `${long(iso, { weekday: 'short' })} ${dateOf(iso).getDate()}`;
    const rest = [];
    for (const x of heads.slice(1)) {
      const s = sec(x.id, x.label, x.items.length);
      const l = make('div', 'pl-list ww-list');
      l.dataset.bucket = x.id;
      l.hidden = !s.open;
      // A day inside a loose heading says which ("Wed 18"); none says "any day".
      const loose = x.id !== 'tomorrow';
      if (s.open) l.append(...x.items.flatMap((i) => this.taskRow(i, {
        tag: !loose ? '' : i.task.day ? shortDay(i.task.day) : x.id === 'later' && spanOf(i.task) && spanOf(i.task).kind !== 'later' ? whenWord(i.task, today) : x.id === 'week' || x.id === 'next' ? 'any day' : ''
      })));
      s.el.append(l);
      rest.push(s.el);
    }
    rest.push(this.unplannedSec(h, opens.has('none')));
    if (typing) {
      // Adding one after another: Today stays where it is, the rest is drawn around it.
      const keep = list.closest('.ww-sec');
      for (const el of [...box.children]) if (el !== keep) el.remove();
      for (const el of [...keep.children]) if (el !== list) el.remove();
      keep.className = t.el.className;
      keep.prepend(...t.el.children, bits.cal);
      keep.before(...[head].filter(Boolean));
      keep.after(...rest);
    } else {
      t.el.append(bits.cal, list);
      box.replaceChildren(...[head].filter(Boolean), t.el, ...rest);
      this.restore(box, held);
    }
    box.classList.toggle('pl-outline', true);
    box.dataset.n = String(bits.p.todo.length + bits.p.done.length);
    this.just = null;
    if (box === this.box) this.backAgain();
  }

  // Not planned: grouped by project, each group folded with its count, then
  // "Tasks with no project". It never counts toward Today and never nags.
  unplannedSec(h, open) {
    const list = this.unplanned(h);
    const groups = new Map();
    for (const i of list) {
      const key = i.world?.id || '';
      if (!groups.has(key)) groups.set(key, { key, title: i.world?.title || 'Tasks with no project', items: [] });
      groups.get(key).items.push(i);
    }
    const sorted = [...groups.values()].sort((a, b) => (!a.key) - (!b.key) || String(a.title).localeCompare(String(b.title)));
    this.groupsOpen ||= new Set();
    const sec = make('section', `ww-sec ww-none${open ? '' : ' folded'}${list.length ? '' : ' empty'}`);
    sec.dataset.bucket = 'none';
    const hd = make('h2', 'ww-h');
    const fold = make('button', 'ww-fold');
    fold.dataset.act = 'ww-fold';
    fold.setAttribute('aria-expanded', String(open));
    fold.setAttribute('aria-label', `${open ? 'Fold' : 'Unfold'} Not planned`);
    fold.append(make('span', 'ww-tri', open ? '▾' : '▸'), make('span', 'ww-name', 'Not planned'), make('span', 'ww-n', list.length ? String(list.length) : ''));
    hd.append(fold);
    const body = make('div', 'pl-list ww-list');
    body.dataset.bucket = 'none';
    body.hidden = !open;
    if (open) {
      for (const g of sorted) {
        const on = this.groupsOpen.has(g.key);
        const gb = make('button', 'ww-group');
        gb.dataset.act = 'ww-group';
        gb.dataset.group = g.key;
        gb.setAttribute('aria-expanded', String(on));
        gb.append(make('span', 'ww-tri', on ? '▾' : '▸'), make('span', 'ww-name', g.title), make('span', 'ww-n', String(g.items.length)));
        body.append(gb);
        if (on) body.append(...g.items.sort((a, b) => (a.row.created_at || 0) - (b.row.created_at || 0)).flatMap((i) => this.taskRow(i, { place: '' })));
      }
    }
    sec.append(hd, body);
    return sec;
  }

  // Every task under a heading, in its order, with these at the end: where a
  // drop on a folded heading (or one of the lines under today's list) lands.
  bucketSeq(bucket, ids) {
    if (bucket === 'none') return ids;
    const head = this.whenModel().heads.find((x) => x.id === bucket);
    return [...(head?.items || []).map((i) => i.row.id).filter((x) => !ids.includes(x)), ...ids];
  }

  // The ones a move carries: all that are picked, when the one moved is one of them.
  movingIds(id) { return this.sel?.size > 1 && this.sel.has(id) ? [...this.sel] : [id]; }

  // Lines put under a heading of What's when, in `seq` (every id under it, in
  // order). One already under it keeps its exact day; the rest get the
  // heading's time. A plain line becomes a task. Says so, with Undo.
  async placeIn(bucket, seq, moved) {
    // Onto Not planned: off its day and out of its time.
    if (bucket === 'none') return this.applyWhen(moved, null, '');
    const h = horizon(this.today);
    const head = whenHeadings(h).find((x) => x.id === bucket);
    if (!head) return;
    const snaps = (await Promise.all([...new Set([...moved, ...seq])].map((id) => whenSnap(id)))).filter(Boolean);
    const rows = [];
    let made = 0;
    let changed = 0;
    for (const id of moved) {
      const t = taskOf(await getEntry(id));
      if (!t) made += 1;
      if (t && whenOf(t, h) === bucket) continue;
      changed += 1;
      rows.push(await setWhen(id, head.when));
    }
    if (head.when.day) {
      // Ones still carried over from an earlier day keep their place among those.
      const day = head.when.day;
      const fresh = [];
      for (const id of seq) { const t = taskOf(await getEntry(id)); if (t?.day && t.day < day && !moved.includes(id)) continue; fresh.push(id); }
      rows.push(...(await arrange(fresh, day)));
    } else rows.push(...(await rankAll(seq, head.key)));
    await this.wrote(rows.filter(Boolean));
    this.unselect();
    const words = moved.length === 1 ? `“${clip((await getEntry(moved[0]))?.text)}”` : `${moved.length} lines`;
    this.saidWhen(snaps, changed || made ? `${words} → ${head.label}` : `${words} moved`, made, moved.length);
  }

  // When for some lines, from the picker (or a drop on a day or a week).
  async applyWhen(ids, when, label) {
    const list = [];
    let theirs = 0;
    for (const id of ids) {
      const r = await getEntry(id);
      const t = taskOf(r);
      if (!r || r.deleted) continue;
      if (t?.owner && t.owner !== 'me') { theirs += 1; continue; }
      list.push(id);
    }
    if (!list.length) { if (theirs) this.hooks.toast?.('That’s Nate’s task: it stays as he has it'); return []; }
    const snaps = (await Promise.all(list.map((id) => whenSnap(id)))).filter(Boolean);
    const made = snaps.filter((x) => !x.task).length;
    const rows = [];
    const day = when?.day || null;
    let n = day ? this.lastOrder(day) : 0;
    for (const id of list) rows.push(await setWhen(id, when, day ? { order: n++ } : {}));
    await this.wrote(rows.filter(Boolean));
    this.unselect();
    const words = list.length === 1 ? `“${clip((await getEntry(list[0]))?.text)}”` : `${list.length} lines`;
    this.saidWhen(snaps, when ? `${words} → ${label}` : `${words}: not planned`, made);
    return rows;
  }

  saidWhen(snaps, text, made, n = snaps.length) {
    const task = made ? (n === 1 ? ' · now a task' : made === n ? ' · now tasks' : ` · ${made} now tasks`) : '';
    this.hooks.toast?.(`${text}${task}`, { label: 'Undo', run: async () => {
      const back = [];
      for (const x of snaps) back.push(await whenBack(x));
      await this.wrote(back.filter(Boolean));
      this.hooks.toast?.('Put back as it was');
    } });
  }

  // The When picker for some lines (Alt + W, the menu, the label on a step).
  async pickWhenFor(ids, { anchor = null, at = null } = {}) {
    ids = [...new Set(ids.filter(Boolean))];
    if (!ids.length) return;
    const t = taskOf(await getEntry(ids[0]));
    await pickWhen({
      anchor, at,
      title: ids.length > 1 ? `When · ${ids.length} lines` : 'When',
      current: ids.length === 1 ? currentChoice(t, this.today) : null,
      pick: (c) => this.applyWhen(ids, c.when, c.label)
    });
  }

  // Alt + W where the keyboard is: the tasks picked, or the one it's on.
  whenKey() {
    const row = document.activeElement?.closest?.('[data-task]');
    const ids = this.sel?.size ? [...this.sel] : row && (this.box.contains(row) || this.sheet.contains(row) || this.steps?.contains(row)) ? [row.dataset.task] : [];
    if (!ids.length) return false;
    this.pickWhenFor(ids, { anchor: row || null });
    return true;
  }

  // ---------- lines pulled in from a project ----------

  // Where a line dragged from the project pane would land, under (x, y).
  pullSpot(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const zone = el.closest?.('.pz');
    if (zone) return { pz: zone };
    const rowsOf = (list) => [...list.querySelectorAll('.pl-task:not(.done):not(.ghost)')].filter((r) => !list.hidden && r.getClientRects().length);
    const afterIn = (rows) => { let after = null; for (const r of rows) { const b = r.getBoundingClientRect(); if (y > b.top + b.height / 2) after = r; } return after; };
    // A heading of Plan (or one of the lines under today's list): open or folded.
    {
      const sec = el.closest?.('.ww-sec');
      if (sec && ((this.dayShown && this.box.contains(sec)) || (this.pageShown && this.sheet.contains(sec)))) {
        const list = sec.querySelector('.ww-list');
        const all = rowsOf(list);
        // Over the heading itself: at the end of it.
        const onHead = !!el.closest('.ww-h') || list.hidden;
        const rest = all.filter((r) => !r.classList.contains('carried'));
        const after = onHead ? all.at(-1) || null : afterIn(all);
        return { bucket: sec.dataset.bucket, list, rows: rest, after: after && after.classList.contains('carried') ? null : after, sec };
      }
      if (this.pageShown && this.tab === 'plan') return null;
    }
    if (this.pageShown && this.tab === 'week') {
      const zone2 = el.closest?.('.pw-day, .pw-tray');
      return zone2 && this.sheet.contains(zone2) ? { zone: zone2 } : null;
    }
    if (this.pageShown && this.tab === 'ahead') {
      if (!el.closest?.('.ah')) return null;
      const col = [...this.sheet.querySelectorAll('.ah-h')].find((c) => { const b = c.getBoundingClientRect(); return x >= b.left && x < b.right; });
      const week = col?.querySelector('.ah-week')?.dataset.week;
      return week ? { week, col } : null;
    }
    if (this.dayShown || (this.pageShown && this.tab === 'day')) {
      const box = this.dayShown ? this.box : this.sheet;
      const list = el.closest?.('.pl-list');
      if (list && box.contains(list)) {
        const all = rowsOf(list);
        const rest = all.filter((r) => !r.classList.contains('carried'));
        const after = afterIn(all);
        return { day: list.dataset.day, list, rows: rest, after: after && after.classList.contains('carried') ? null : after };
      }
      return el.closest?.('.pl-head') && box.contains(el) ? { day: box.querySelector('.pl-list')?.dataset.day || this.today, list: box.querySelector('.pl-list'), rows: [], after: null, top: true } : null;
    }
    return null;
  }

  pullShow(s) {
    for (const x of document.querySelectorAll('.pull-over, .drop-before, .drop-after, .drop-on')) x.classList.remove('pull-over', 'drop-before', 'drop-after', 'drop-on');
    if (!s) return false;
    if (s.pz) s.pz.classList.add('pull-over');
    else if (s.zone) s.zone.classList.add('drop-on');
    else if (s.col) s.col.classList.add('pull-over');
    else if (s.sec && (s.list.hidden || !s.rows.length)) s.sec.classList.add('pull-over');
    else if (s.after) s.after.classList.add('drop-after');
    else if (s.rows?.[0]) s.rows[0].classList.add('drop-before');
    else if (s.sec) s.sec.classList.add('pull-over');
    else if (s.list) (s.list.querySelector('.pl-add') || s.list).classList.add('drop-before');
    return true;
  }

  // Let go: the lines get their When there, and stay where they're written.
  async pullDrop(s, ids) {
    this.pullShow(null);
    if (!s || !ids.length) return false;
    const h = horizon(this.today);
    const seqWith = (rows, after) => {
      const seq = rows.map((r) => r.dataset.task).filter((x) => !ids.includes(x));
      seq.splice(after ? seq.indexOf(after.dataset.task) + 1 : 0, 0, ...ids);
      return seq;
    };
    if (s.pz) {
      const { kind, value } = s.pz.dataset;
      if (kind === 'bucket') {
        // A folded heading opens after the drop, so you see where it went.
        this.planFold(value, true);
        const head = this.whenModel().heads.find((x) => x.id === value);
        await this.placeIn(value, [...(head?.items || []).map((i) => i.row.id).filter((x) => !ids.includes(x)), ...ids], ids);
        return true;
      }
      if (kind === 'day') { await this.applyWhen(ids, { day: value }, long(value, { weekday: 'long' })); return true; }
      if (kind === 'week') { await this.applyWhen(ids, { span: { kind: 'week', start: value } }, value <= h.mon0 ? 'This week' : value === h.mon1 ? 'Next week' : `the week of ${long(value, { month: 'short', day: 'numeric' })}`); return true; }
      return false;
    }
    if (s.bucket) {
      if (!s.sec?.classList.contains('pl-fline')) this.planFold(s.bucket, true);
      await this.placeIn(s.bucket, s.list?.hidden ? this.bucketSeq(s.bucket, ids) : seqWith(s.rows, s.after), ids);
      return true;
    }
    if (s.zone) {
      const day = s.zone.dataset.day || null;
      const mon = weekOf(this.week || this.today)[0];
      await this.applyWhen(ids, day ? { day } : { span: { kind: 'week', start: mon } }, day ? long(day, { weekday: 'long' }) : mon <= h.mon0 ? 'Any day this week' : `Any day, week of ${long(mon, { month: 'short', day: 'numeric' })}`);
      return true;
    }
    if (s.week) { await this.applyWhen(ids, { span: { kind: 'week', start: s.week } }, s.week <= h.mon0 ? 'This week' : s.week === h.mon1 ? 'Next week' : `the week of ${long(s.week, { month: 'short', day: 'numeric' })}`); return true; }
    if (s.day) {
      if (s.day === h.today || s.day === h.tomorrow) await this.placeIn(s.day === h.today ? 'today' : 'tomorrow', seqWith(s.rows, s.after), ids);
      else await this.applyWhen(ids, { day: s.day }, long(s.day, { weekday: 'long' }));
      return true;
    }
    return false;
  }

  // On a phone, while a line slides up from the bottom half, the plan on top
  // folds into a few big places to drop it on: the six headings (the week's
  // days and "Any day" on Week, the six weeks on Weeks ahead).
  pullZones(on) {
    document.querySelector('.pull-zones')?.remove();
    document.documentElement.classList.toggle('pull-dropping', !!on);
    if (!on) return;
    const h = horizon(this.today);
    const box = make('div', 'pull-zones');
    box.setAttribute('aria-hidden', 'true');
    const zone = (kind, value, label, n) => {
      const z = make('div', 'pz');
      z.dataset.kind = kind;
      z.dataset.value = value;
      z.append(make('span', 'pz-l', label), make('span', 'pz-n', n ? String(n) : ''));
      box.append(z);
    };
    if (this.pageShown && this.tab === 'week') {
      const w = weekPlan(this.items, this.week || this.today, this.today);
      for (const d of w.days) zone('day', d.iso, `${long(d.iso, { weekday: 'long' })} ${dateOf(d.iso).getDate()}`, d.open.length);
      zone('week', w.days[0].iso, w.days[0].iso <= h.mon0 ? 'Any day this week' : 'Any day that week', w.tray.length);
    } else if (this.pageShown && this.tab === 'ahead') {
      for (let n = 0; n < 6; n++) { const iso = addDays(h.mon0, n * 7); zone('week', iso, n === 0 ? 'This week' : n === 1 ? 'Next week' : `Week of ${long(iso, { month: 'short', day: 'numeric' })}`, 0); }
    } else {
      for (const x of this.whenModel().heads) zone('bucket', x.id, x.label, x.items.length);
      zone('bucket', 'none', 'Not planned', this.unplanned(h).length);
    }
    document.body.append(box);
  }

  // ---------- Week ----------

  drawWeek() {
    const today = this.today;
    const w = weekPlan(this.items, this.week || today, today);
    const held = this.held(this.sheet);
    const first = w.days[0].iso;
    const last = w.days[6].iso;
    const thisWeek = w.days.some((d) => d.today);
    const head = make('header', 'pl-top');
    const left = make('div');
    left.append(make('div', 'pl-eyebrow', thisWeek ? 'This week' : first > today ? 'A week ahead' : 'A week back'));
    const same = first.slice(0, 7) === last.slice(0, 7);
    left.append(make('h1', '', `${long(first, { month: 'long', day: 'numeric' })} to ${long(last, same ? { day: 'numeric' } : { month: 'long', day: 'numeric' })}`));
    const side = make('div', 'pl-side');
    const nav = make('div', 'pl-nav');
    const prev = make('button', 'ghost-btn', '‹');
    prev.dataset.act = 'week-prev';
    prev.setAttribute('aria-label', 'The week before');
    const now = make('button', 'ghost-btn', 'This week');
    now.dataset.act = 'week-now';
    now.hidden = thisWeek;
    const next = make('button', 'ghost-btn', '›');
    next.dataset.act = 'week-next';
    next.setAttribute('aria-label', 'The week after');
    nav.append(prev, now, next);
    side.append(...(this.estimates ? [this.meter(w.min, this.free * 60)] : []), nav, ...[this.pullButton()].filter(Boolean), this.switchRow('week'));
    head.append(left, side);

    // On a phone the whole week fits one screen: a row a day (its first
    // titles and how many), then Any day. Days gone by are dimmed and say
    // what's left; a tap opens that day in Plan. Each row takes a drop.
    if (!hover.matches) {
      const rows = make('div', 'pw-rows');
      const line = (cls, day, label, sub, list, n) => {
        const r = make('section', `${cls} pw-row`);
        r.dataset.day = day;
        const b = make('button', 'pw-rb');
        b.dataset.act = 'week-day';
        b.append(make('b', 'pw-rd', label), make('span', 'pw-rs', sub), make('span', 'pw-rt', list.map((i) => i.row.text || 'Untitled').join(', ') || 'nothing'), make('span', 'pw-rn', n));
        if (!list.length) b.querySelector('.pw-rt').classList.add('none');
        r.append(b);
        rows.append(r);
      };
      for (const d of w.days) {
        const open = d.open.filter((i) => !i.ghost);
        const past = d.iso < today;
        line(`pw-day${d.today ? ' today' : ''}${past ? ' past' : ''}`, d.iso, String(dateOf(d.iso).getDate()), long(d.iso, { weekday: 'short' }), d.open, open.length ? (past ? `${open.length} left` : String(open.length)) : '');
      }
      line('pw-tray', '', 'Any', 'day', w.tray, w.tray.length ? String(w.tray.length) : '');
      const parts = [head, rows];
      if (w.late && thisWeek) {
        const before = dayPlan(this.items, today, today).carried.filter((i) => i.task.day < first);
        const el = this.earlyLine(before, { fold: false });
        if (el) { el.el.classList.add('pw-late'); el.el.querySelector('.pl-early-n span:last-child').textContent = `${before.length} from before this week`; parts.push(el.el); }
      }
      this.sheet.replaceChildren(...parts);
      return;
    }
    const grid = make('div', 'pw-week');
    for (const d of w.days) {
      const col = make('section', `pw-day${d.today ? ' today' : ''}${d.iso < today ? ' past' : ''}`);
      col.dataset.day = d.iso;
      const h = make('button', 'pw-h');
      h.dataset.act = 'open-day';
      h.title = 'Open this day';
      h.append(make('b', '', String(dateOf(d.iso).getDate())), make('span', '', `${long(d.iso, { weekday: 'short' })}${d.min && this.estimates ? ` · ${span(d.min)}` : ''}`));
      col.append(h);
      for (const e of this.cal.filter((x) => x.day === d.iso)) col.append(this.eventLine(e, 'pw-ev'));
      for (const i of d.open) col.append(this.chip(i));
      for (const i of d.done) col.append(this.chip(i));
      col.append(this.addRow(d.iso, 'Add'));
      grid.append(col);
    }
    const tray = make('section', 'pw-tray');
    tray.dataset.day = '';
    tray.append(make('h2', 'pl-label', thisWeek ? 'Any day this week' : 'Any day that week'));
    const chips = make('div', 'pw-chips');
    for (const i of w.tray) chips.append(this.chip(i));
    chips.append(this.addRow(null, 'Add'));
    tray.append(chips);
    const parts = [head, grid, tray];
    // Hours by area go with time estimates: with them off, no hours anywhere.
    const byArea = this.estimates ? this.areaRows(first) : null;
    if (byArea) parts.push(byArea);
    // Left from before this week: the same line as on today's plan, with its ways out.
    if (w.late && thisWeek) {
      const before = dayPlan(this.items, today, today).carried.filter((i) => i.task.day < first);
      const line = this.earlyLine(before, { fold: false });
      if (line) { line.el.classList.add('pw-late'); line.el.querySelector('.pl-early-n span:last-child').textContent = `${before.length} from before this week`; parts.splice(1, 0, line.el); }
      else parts.push(make('p', 'pl-note', `${w.late} still open from before this week. ${w.late === 1 ? 'It waits' : 'They wait'} at the top of today’s plan.`));
    }
    this.sheet.replaceChildren(...parts);
    this.restore(this.sheet, held);
  }

  chip(i) {
    const done = !!i.row.fields?.done;
    const b = make('button', `pw-task${done ? ' done' : ''}${i.task.run ? ' timing' : ''}${i.ghost ? ' ghost' : ''}${i.task.habit ? ' habit' : ''}`);
    b.dataset.task = i.row.id;
    b.dataset.act = 'more';
    if (i.occ) b.dataset.occ = i.occ;
    if (i.ghost) { b.dataset.ghost = i.ghost; b.title = `${repeatWord(i.task.repeat)}: it comes round on this day`; }
    if (!done && !i.ghost) { b.dataset.move = '1'; if (hover.matches) b.draggable = true; }
    b.append(make('span', 'pw-t', i.row.text || 'Untitled'));
    const mins = i.task.habit || !this.estimates ? 0 : done ? i.task.actual || i.task.est : i.task.est;
    if (mins) b.append(make('small', '', span(mins)));
    else if (isRepeat(i.task) && !done) b.append(make('small', 'pw-rep', '↻'));
    return b;
  }

  // Under the week: hours worked in each area against the hours you mean to
  // give it. An area shows once it has a target, or hours this week.
  areaRows(anyDay) {
    // An area that sits in another comes right under it.
    const list = [];
    const walk = (parent) => { for (const a of this.areaList || []) if ((a.parent_id || null) === parent && !list.includes(a)) { list.push(a); walk(a.id); } };
    walk(null);
    for (const a of this.areaList || []) if (!list.includes(a)) list.push(a);
    if (!list.length) return null;
    const worked = areaHours(this.items, list, anyDay);
    const targets = this.targets || {};
    const shown = list.filter((a) => Number(targets[a.id]) > 0 || (!a.parent_id && worked.get(a.id)));
    const box = make('section', 'pw-areas');
    box.append(make('h2', 'pl-label', 'Areas this week'));
    const rows = make('div', 'pa-rows');
    for (const a of shown) {
      const min = worked.get(a.id) || 0;
      const of = Number(targets[a.id]) > 0 ? Number(targets[a.id]) * 60 : 0;
      const m = make('div', 'pl-meter pa-row');
      m.dataset.area = a.id;
      const dot = make('i', 'pa-dot');
      dot.style.background = areaColor(a);
      const name = make('span', `pl-meter-n${a.parent_id ? ' sub' : ''}`);
      name.append(dot, a.title || 'Untitled');
      const track = make('span', 'pl-track');
      const fill = make('i', of && min >= of ? 'met' : '');
      fill.style.width = `${of ? Math.min(100, (min / of) * 100) : 0}%`;
      track.append(fill);
      if (!of) track.classList.add('bare');
      const say = make('button', 'pl-meter-v', of ? `${hours(min)} h of ${hours(of)} h` : `${hours(min)} h`);
      say.dataset.act = 'area-target';
      say.title = of ? 'Hours a week you mean to give this area: click to change' : 'Click to say how many hours a week this area should get';
      m.append(name, track, say);
      rows.append(m);
    }
    const rest = list.filter((a) => !shown.includes(a));
    if (rest.length) {
      const more = make('button', 'wp-link pa-more', shown.length ? 'Another area…' : 'Give an area its hours…');
      more.dataset.act = 'area-pick';
      rows.append(more);
    }
    box.append(rows);
    return box;
  }

  async askTarget(areaId) {
    const a = (this.areaList || []).find((x) => x.id === areaId);
    if (!a) return;
    const now = Number(this.targets?.[areaId]) || 0;
    const v = await askText({ title: `Hours a week for ${a.title || 'this area'}`, value: now ? String(now) : '', type: 'number', placeholder: '10', ok: 'Save', body: 'The week shows the hours you worked in it against this. 0 takes the target away.' });
    if (v === null || v === undefined || v === false) return;
    const n = Number(v);
    if (!String(v).trim() || !(n >= 0) || n > 168) return;
    const next = { ...(this.targets || {}) };
    if (n > 0) next[areaId] = n; else delete next[areaId];
    await this.wrote(await savePlanSettings({ areas: next }));
  }

  // This week's hours against the hours you have.
  meter(value, of) {
    const m = make('div', 'pl-meter');
    const track = make('span', 'pl-track');
    const fill = make('i', value > of ? 'over' : '');
    fill.style.width = `${Math.min(100, of ? (value / of) * 100 : 0)}%`;
    track.append(fill);
    const say = make('button', 'pl-meter-v', `${hours(value)} h of ${hours(of)} h`);
    say.dataset.act = 'free';
    say.title = 'Your free hours in a week: click to change';
    m.append(track, say);
    return m;
  }

  // ---------- Pace ----------

  drawPace() {
    const p = pace(this.items, Date.now());
    const head = make('header', 'pl-top');
    const left = make('div');
    left.append(make('div', 'pl-eyebrow', 'Looking back · last 7 days'), make('h1', '', 'Pace'));
    const side = make('div', 'pl-side');
    side.append(this.switchRow('pace'));
    head.append(left, side);
    const parts = [head];
    if (!p.rows.length) {
      parts.push(make('p', 'pl-note', 'Nothing ticked off in the last 7 days yet. Tick a task and say how long it took, and it shows here, planned against real.'));
      this.sheet.replaceChildren(...parts);
      return;
    }
    if (p.measured) {
      const ratio = p.real / p.planned;
      const read = ratio > 1.15 ? `It took about ${ratio >= 2 ? `${Math.round(ratio * 10) / 10} times` : `${Math.round((ratio - 1) * 100)}% longer than`} what you planned.`
        : ratio < 0.85 ? `It took about ${Math.round((1 - ratio) * 100)}% less than you planned.` : 'Your guesses were close.';
      parts.push(make('p', 'pl-read', `You planned ${span(p.planned)} and it took ${span(p.real)}. ${read}`));
    }
    const max = Math.max(...p.rows.map((r) => Math.max(r.est || 0, r.real || 0)), 1);
    const table = make('div', 'pc-table');
    table.setAttribute('role', 'table');
    const th = make('div', 'pc-row pc-head');
    th.append(make('span', '', 'Task'), make('span', 'pc-n', 'Planned'), make('span', 'pc-n', 'Real'), make('span', ''));
    table.append(th);
    for (const r of p.rows) {
      const row = make('div', 'pc-row');
      row.dataset.task = r.id;
      const t = make('button', 'pc-t', r.title);
      t.dataset.act = 'open';
      t.title = 'Open it where it’s written';
      const bars = make('span', 'pc-bars');
      const a = make('i');
      a.style.width = `${((r.est || 0) / max) * 100}%`;
      const b = make('i', r.est && r.real > r.est * 2 ? 'over' : 'real');
      b.style.width = `${((r.real || 0) / max) * 100}%`;
      bars.append(a, b);
      row.append(t, make('span', 'pc-n', r.est ? span(r.est) : '–'), make('span', 'pc-n', r.real ? span(r.real) : '–'), bars);
      table.append(row);
    }
    parts.push(table);
    const groups = (title, list) => {
      if (!list.length) return;
      parts.push(make('h2', 'pl-label pc-sub', title));
      const box = make('div', 'pc-groups');
      const top = list[0][1];
      for (const [name, min] of list.slice(0, 8)) {
        const m = make('div', 'pl-meter');
        const track = make('span', 'pl-track');
        const fill = make('i');
        fill.style.width = `${(min / top) * 100}%`;
        track.append(fill);
        m.append(make('span', 'pl-meter-n', name), track, make('span', 'pl-meter-v', span(min)));
        box.append(m);
      }
      parts.push(box);
    };
    groups('Time by project', p.byProject);
    groups('Time by tag', p.byTag);
    this.sheet.replaceChildren(...parts);
  }

  // ---------- doing ----------

  click(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act.startsWith('ahead-')) return aheadClick(this, act, el);
    const row = el.closest('[data-task], [data-took]');
    let i = row ? this.item(row.dataset.task || row.dataset.took) : null;
    // One time a repeating task was done, or a later day it comes round on.
    if (i && row.dataset.occ) i = occItem(i, row.dataset.occ);
    if (i && row.dataset.ghost) i = { ...i, ghost: row.dataset.ghost };
    if (act === 'week-prev' || act === 'week-next') return this.hooks.go({ view: 'plan', tab: 'week', week: addDays(weekOf(this.week || this.today)[0], act === 'week-prev' ? -7 : 7) });
    if (act === 'week-now') return this.hooks.go({ view: 'plan', tab: 'week' });
    if (act === 'open-day') return this.hooks.go({ view: 'notebook', pageId: `day-${el.closest('[data-day]').dataset.day}` });
    if (act === 'zoom') { this.calZoom = el.dataset.tab; return this.hooks.go({ view: 'plan', tab: el.dataset.tab }); }
    if (act === 'open-plan') { if (el.dataset.bucket) this.planFold(el.dataset.bucket, true); return this.hooks.go({ view: 'plan', tab: 'plan' }); }
    if (act === 'thru-carried') return this.hooks.goThrough?.();
    if (act === 'week-day') {
      // A day of the week on a phone: that day in Plan (Any day: Plan, at This week).
      const day = el.closest('[data-day]').dataset.day;
      if (!day) { this.planFold('week', true); return this.goTab('plan'); }
      if (day === this.today) return this.goTab('plan');
      this.phoneDay = 'plan';
      return this.hooks.go({ view: 'notebook', pageId: `day-${day}` });
    }
    if (act === 'open-today') return this.hooks.go({ view: 'notebook', pageId: `day-${this.today}` });
    if (act === 'early-fold') { this.earlyOpen = !this.earlyOpen; return this.redraw(); }
    if (act === 'early-today') return this.bringToday();
    if (act === 'early-more') return this.earlyMenu(el);
    if (act === 'flip') return this.hooks.flip?.();
    if (act === 'free') return this.askFree();
    if (act === 'dayend') return this.askDayEnd();
    if (act === 'area-target') return this.askTarget(el.closest('[data-area]').dataset.area);
    if (act === 'area-pick') {
      const shown = new Set([...this.sheet.querySelectorAll('.pa-row')].map((r) => r.dataset.area));
      return popMenu(el, (this.areaList || []).filter((a) => !shown.has(a.id)).map((a) => ({ label: a.title || 'Untitled', run: () => this.askTarget(a.id) })));
    }
    if (act === 'all-done') { this.allDone = !this.allDone; return this.drawSteps(); }
    if (act === 'pull') return this.hooks.pull?.();
    if (act === 'ww-group') { this.groupsOpen ||= new Set(); const k = el.dataset.group; if (this.groupsOpen.has(k)) this.groupsOpen.delete(k); else this.groupsOpen.add(k); return this.redraw(); }
    if (act === 'ww-fold') { const sec = el.closest('.ww-sec'); this.planFold(sec.dataset.bucket, sec.classList.contains('folded')); return this.redraw(); }
    if (act === 'kid') {
      if (e.target.closest('a[href]')) return;
      const of = el.closest('[data-kids-of]')?.dataset.kidsOf;
      if (of) this.left(of);
      return of && this.hooks.openTask?.(of, el.dataset.line);
    }
    if (!i) return;
    // Picking several: a tap on the box or the words picks it.
    if (this.picking && (act === 'tick' || act === 'words') && !i.ghost && !i.occ) return this.select(i.row.id, row);
    if (act === 'one-today') return this.bringToday([i.row.id]);
    if (act === 'day') return this.pickWhenFor(this.movingIds(i.row.id), { anchor: el });
    if (act === 'history') return popMenu(el, this.historyItems(i));
    if (act === 'tick' && i.ghost) return this.hooks.toast?.(`It comes round on ${long(i.ghost, { weekday: 'long' })}. Tick it then, or tick the one that’s due.`);
    if (act === 'tick') return this.tick(i, !i.row.fields?.done);
    if (act === 'timer') return this.timerFor(i);
    if (act === 'est') return i.row.fields?.done ? this.askTook(i) : popMenu(el, this.estItems(i));
    if (act === 'more') return this.menu(i, el);
    if (act === 'open') return this.hooks.openEntry(i.row.id);
    if (act === 'fold') { this.fold(i.row.id, !this.unfolded(i.row.id)); return this.redraw(); }
    if (act === 'words' && e.shiftKey && !i.ghost && !i.occ) { clearTimeout(this.opening); return this.select(i.row.id, row); }
    if (act === 'words') {
      // Ctrl + click: beside, as before.
      if ((e.ctrlKey || e.metaKey) && this.hooks.beside?.(i.row.id)) { clearTimeout(this.opening); return this.hooks.openTask(i.row.id, null, { beside: true }); }
      // A double-click changes the words, so wait a moment before opening.
      if (!hover.matches || !plainLine(i.row)) return this.open(i);
      clearTimeout(this.opening);
      this.opening = setTimeout(() => this.open(i), 260);
      return;
    }
    if (act === 'took') return this.tookFor(i, Number(el.dataset.m));
    if (act === 'took-other') return this.askTook(i);
  }

  // Open a task the way an outliner zooms into a line: it becomes the page,
  // its lines under it, and Back (Alt + Left) comes out to the plan again.
  open(i) {
    clearTimeout(this.opening);
    this.left(i.row.id);
    return (this.hooks.openTask || this.hooks.openEntry)(i.row.id);
  }

  // ---------- Go through what's left from earlier days ----------

  async carriedList() {
    if (!this.items) await this.refresh();
    const p = dayPlan(this.items || [], this.today, this.today);
    return p.carried.filter((i) => !i.ghost && !i.occ && !isRepeat(i.task)).map((i) => ({
      id: i.row.id, text: (i.row.text || 'Untitled').trim(), day: i.task.day, hq: !!i.row.fields?.hq,
      where: i.world?.title || (i.root?.kind === 'page' ? i.root.title : ''), canDelete: this.canRemove(i)
    }));
  }

  // One answer from Go through; gives back how to take it back.
  async carriedAnswer(it, how) {
    const was = (await getEntry(it.id))?.fields?.task?.day ?? it.day;
    if (how === 'keep' || how === 'notoday') {
      await this.wrote(await setTask(it.id, { day: how === 'keep' ? this.today : null }));
      return async () => this.wrote(await setTask(it.id, { day: was }));
    }
    if (how === 'done') {
      await this.wrote(await tickTask(it.id, true, Date.now()));
      return async () => this.wrote(await tickTask(it.id, false, Date.now()));
    }
    if (how === 'delete') {
      const row = await getEntry(it.id);
      if (!row || isTrashed(row)) return null;
      await trash(hqGoes(row));
      await this.wrote([await getEntry(it.id)]);
      return async () => { await restore(it.id); await this.wrote([await getEntry(it.id)]); };
    }
    return null;
  }

  // ---------- picking several, and deleting ----------

  select(id, row, on = !this.sel?.has(id)) {
    this.sel ||= new Set();
    if (on) this.sel.add(id); else this.sel.delete(id);
    for (const r of document.querySelectorAll(`.pl-task[data-task="${CSS.escape(id)}"]`)) {
      r.classList.toggle('sel', on);
      r.querySelector('.pl-check')?.setAttribute('aria-pressed', String(on));
    }
    row?.classList.toggle('sel', on);
    this.pickBar();
  }
  unselect() {
    for (const id of this.sel || []) for (const r of document.querySelectorAll(`[data-task="${CSS.escape(id)}"]`)) r.classList.remove('sel');
    this.sel = new Set();
    this.pickBar();
  }

  // Nate's tasks are his to finish or remove on the board; a repeat's single day isn't a line.
  canRemove(i) { return !!i && !i.ghost && !i.occ && !(i.task?.owner && i.task.owner !== 'me'); }

  // Delete: the real line and everything under it go to the Trash, wherever
  // it's written, with Undo (the toast, or Ctrl + Z here). Only a task kept in
  // step with the Acro HQ board asks first, since the board keeps its own.
  async remove(items) {
    const theirs = items.filter((i) => i?.task?.owner && i.task.owner !== 'me');
    const list = items.filter((i) => this.canRemove(i));
    if (theirs.length && !list.length) { this.hooks.toast?.('That’s Nate’s task: it stays on the board for him'); return false; }
    if (!list.length) return false;
    // A task on the Acro HQ board comes off the board too (a minute or so later, so Undo still has time).
    const onBoard = list.filter((i) => i.row.fields?.hq).length;
    const gone = [];
    let lines = 0;
    for (const i of list) {
      const row = await getEntry(i.row.id);
      if (!row || row.deleted || isTrashed(row)) continue;
      const n = await trash(hqGoes(row));
      lines += n - 1;
      gone.push({ id: row.id, text: row.text || 'Untitled', from: i.world?.title || (i.root?.kind === 'page' ? i.root.title : '') });
    }
    if (!gone.length) return false;
    this.unselect();
    this.lastGone = gone.map((g) => g.id);
    await this.wrote(await Promise.all(this.lastGone.map((id) => getEntry(id))));
    const one = gone[0];
    const under = lines ? ` and ${lines === 1 ? 'the line' : `${lines} lines`} under it` : '';
    const board = onBoard ? (gone.length === 1 ? ', and from the HQ board' : ` (${onBoard === gone.length ? 'from the HQ board too' : `${onBoard} from the HQ board too`})`) : '';
    const said = gone.length === 1 ? `Deleted “${one.text}”${under}${one.from ? `, from ${one.from}` : ''}${board}` : `Deleted ${gone.length} tasks${board}${theirs.length ? ` (Nate’s ${theirs.length === 1 ? 'one stays' : 'stay'})` : ''}`;
    this.hooks.toast?.(said, { label: 'Undo', run: () => this.undoRemove() });
    return true;
  }

  async undoRemove() {
    const ids = this.lastGone;
    if (!ids?.length) return;
    this.lastGone = null;
    for (const id of ids) await restore(id);
    await this.wrote(await Promise.all(ids.map((id) => getEntry(id))));
    this.hooks.toast?.(ids.length === 1 ? 'It’s back' : `${ids.length} tasks are back`);
  }

  left(id) { if (this.box?.contains(document.activeElement) || this.box?.querySelector(`[data-task="${CSS.escape(id)}"]`)) this.leftAt = { id, y: document.scrollingElement?.scrollTop || 0, at: Date.now() }; }

  dblclick(e) {
    const el = e.target.closest('.pl-words[data-act="words"]');
    const row = el?.closest('[data-task]');
    const i = row && this.item(row.dataset.task);
    if (!i || !plainLine(i.row) || row.dataset.occ || row.dataset.ghost) return;
    clearTimeout(this.opening);
    e.preventDefault();
    this.rename(i, el);
  }

  // A day's list in its new order, tasks and (woven) events, with `moved` in
  // its new place: the tasks' order is saved, and in a woven plan the moved
  // one remembers which event it now follows.
  async settle(list, seq, moved) {
    const woven = seq.some((x) => x.classList?.contains('pl-wev'));
    let ev = -1;
    let pin = null;
    const ids = [];
    for (const x of seq) {
      if (x.classList?.contains('pl-wev')) { ev = Number(x.dataset.at); continue; }
      const id = x.dataset?.task || x.id;
      ids.push(id);
      if (id === moved && woven) pin = { id, after: ev };
    }
    return this.wrote(await arrange(ids, list.dataset.day, pin));
  }

  // Moves a task to the start or the end of its day's list (past any events).
  toEnd(list, id, top) {
    // One from an earlier day goes to the top or bottom of those.
    if (list.querySelector(`.pl-task.carried[data-task="${CSS.escape(id)}"]`)) {
      const ids = [...list.querySelectorAll('.pl-task.carried[data-move]')].map((x) => x.dataset.task).filter((x) => x !== id);
      if (top) ids.unshift(id); else ids.push(id);
      return arrangeCarried(ids).then((rows) => this.wrote(rows));
    }
    const seq = [...list.querySelectorAll('.pl-task[data-move]:not(.carried):not(.ghost), .pl-wev')].filter((x) => x.dataset.task !== id);
    if (top) seq.unshift({ id }); else seq.push({ id });
    return this.settle(list, seq, id);
  }

  // Alt + Up / Alt + Down on a task moves it one place in its day (past an
  // event, in a woven plan).
  nudge(e) {
    const row = e.target.closest?.('.pl-list [data-task][data-move]');
    if (!row) return false;
    const list = row.closest('.pl-list');
    const old = row.classList.contains('carried');
    const seq = [...list.querySelectorAll(old ? '.pl-task.carried[data-move]' : '.pl-task[data-move]:not(.carried):not(.ghost), .pl-wev')];
    const at = seq.indexOf(row);
    const to = at + (e.key === 'ArrowUp' ? -1 : 1);
    e.preventDefault();
    if (at < 0 || to < 0 || to >= seq.length) return true;
    seq.splice(to, 0, ...seq.splice(at, 1));
    const id = row.dataset.task;
    const which = e.target.dataset.act || 'words';
    (old ? arrangeCarried(seq.map((x) => x.dataset.task)).then((rows) => this.wrote(rows)) : this.settle(list, seq, id)).then(() => {
      // Keep the keyboard on the task that moved, so it can go on moving.
      const box = list.isConnected ? list : document;
      (box.querySelector(`[data-task="${id}"] [data-act="${which}"]`) || box.querySelector(`[data-task="${id}"] .pl-words`))?.focus();
    });
    return true;
  }

  key(e) {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.nudge(e)) return;
    const onTask = !e.target.closest?.('input, textarea, [contenteditable="true"]') && e.target.closest?.('[data-task]');
    // Ctrl + Shift + Backspace, as in the outline: the task (or the ones picked) to the Trash.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'Backspace' || e.key === 'Delete') && (onTask || this.sel?.size)) {
      e.preventDefault();
      const ids = this.sel?.size ? [...this.sel] : [onTask.dataset.task];
      this.remove(ids.map((x) => this.item(x)).filter(Boolean));
      return;
    }
    // Shift + Down / Up on a task picks it and the next one, for a group delete.
    if (onTask && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const rows = [...onTask.closest('.pl-list, .pl-steps, .pl-sheet, #plan')?.querySelectorAll('.pl-task[data-move]') || []];
      const at = rows.indexOf(onTask);
      const next = rows[at + (e.key === 'ArrowDown' ? 1 : -1)];
      if (at < 0 || !next) return;
      e.preventDefault();
      if (!this.sel?.has(onTask.dataset.task)) this.select(onTask.dataset.task, onTask);
      this.select(next.dataset.task, next, true);
      next.querySelector('.pl-words')?.focus();
      return;
    }
    if (e.key === 'Escape' && (this.sel?.size || this.picking) && !e.target.closest?.('input')) { if (this.picking) this.stopPicking(); else this.unselect(); return; }
    // Ctrl + Z right after a delete here brings it back.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && this.lastGone && !e.target.closest?.('input, textarea, [contenteditable="true"]')) {
      e.preventDefault();
      this.undoRemove();
      return;
    }
    const input = e.target.closest?.('input[data-add]');
    if (!input) return;
    if (e.key === 'Escape') { input.value = ''; input.blur(); return; }
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    this.add(input);
  }

  // What's in an add box becomes a task; the box empties and keeps the caret.
  add(input) {
    if (!input.value.trim()) return;
    const { title, est, repeat } = parseAdd(input.value);
    const steps = input.dataset.add === 'steps' && this.world;
    const day = steps || input.dataset.add === 'tray' ? null : input.dataset.add;
    // Added under "Any day this week": loose in that week.
    const loose = input.dataset.add === 'tray' ? { kind: 'week', start: weekOf(this.week || this.today)[0] } : null;
    input.value = '';
    addTask({ text: title, day, est, repeat, span: loose, order: this.lastOrder(day), home: steps ? stepsHome(this.world) : null }).then(async (rows) => {
      await this.wrote(rows);
      // One that repeats starts on the first day it lands on: say so when that isn't here.
      const made = rows.at(-1)?.fields?.task;
      if (repeat && made && made.day !== (day || this.today)) this.hooks.toast?.(`${repeatWord(made.repeat)}: the first one is ${dayWord(made.day, this.today) === 'Tomorrow' ? 'tomorrow' : `on ${long(made.day, { weekday: 'long', month: 'short', day: 'numeric' })}`}`);
    });
  }

  async tick(i, done) {
    const row = await tickTask(i.row.id, done, Date.now(), i.occ || null);
    const id = i.row.id;
    this.just = done ? id : null;
    this.took = null;
    if (done && row && !row.fields.task.habit) {
      // With the question switched off, a timed task still keeps its time.
      if (this.hooks.off?.('took')) { const on = timed(row.fields.task); if (on) await tookTask(id, on); }
      else if (this.dayShown) this.took = id;
    }
    await this.wrote(row);
  }

  async tookFor(i, minutes) {
    this.took = null;
    await this.wrote(await tookTask(i.row.id, minutes, i.occ || null));
  }

  async askTook(i) {
    const v = await askText({ title: 'How long did it take?', value: i.task.actual ? String(i.task.actual) : '', placeholder: '45, 1h, 1h 20m', ok: 'Save', body: i.row.text || '' });
    if (v === null || v === undefined || v === false) return;
    const m = readSpan(String(v));
    if (!m) { if (String(v).trim()) this.hooks.toast?.('Didn’t catch that. Try 45, 1h or 1h 20m.'); return; }
    await this.tookFor(i, m);
  }

  async timerFor(i) {
    await this.wrote(i.task.run ? await stopTimer(i.row.id) : await startTimer(i.row.id));
  }

  // A stretch of work keeps its length when its first day moves.
  async move(i, day) {
    await this.wrote(await moveTask(i.row.id, day, this.lastOrder(day)));
  }

  async est(i, minutes) {
    await this.wrote(await setTask(i.row.id, { est: minutes }));
  }

  async askEst(i) {
    const v = await askText({ title: 'How long does it take?', value: i.task.est ? String(i.task.est) : '', placeholder: '45, 1h, 1h 20m', ok: 'Save', body: i.row.text || '' });
    if (v === null || v === undefined || v === false) return;
    const m = readSpan(String(v));
    if (!m) { if (String(v).trim()) this.hooks.toast?.('Didn’t catch that. Try 45, 1h or 1h 20m.'); return; }
    await this.est(i, m);
  }

  async askFree() {
    const v = await askText({ title: 'Free hours in a week', value: String(this.free), type: 'number', ok: 'Save', body: 'The hours you really have for tasks in a week. Each week’s plan is weighed against it.' });
    const n = Number(v);
    if (!v || !(n > 0) || n > 168) return;
    await this.wrote(await savePlanSettings({ free: n }));
  }

  async askDayEnd() {
    const pad = (n) => String(n).padStart(2, '0');
    const v = await askText({ title: 'When does your day end?', type: 'time', value: `${pad(Math.floor(this.dayEnd) % 24)}:${pad(Math.round((this.dayEnd % 1) * 60))}`, ok: 'Save', body: '“Left today” counts from now to then, less what’s on your calendar.' });
    const m = /^(\d{1,2}):(\d\d)/.exec(String(v || ''));
    if (!m) return;
    const hour = Number(m[1]) + Number(m[2]) / 60;
    if (!(hour > 0)) return;
    await this.wrote(await savePlanSettings({ dayEnd: hour }));
  }

  estItems(i) {
    const t = i.task;
    return [
      ...ESTS.map((m) => ({ label: span(m), current: t.est === m, run: () => this.est(i, m) })),
      { label: 'Another length…', run: () => this.askEst(i) },
      { label: 'No estimate', current: !t.est, run: () => this.est(i, null) }
    ];
  }

  // The menu for a task, the same wherever the task shows (the plan, a week,
  // the label after its words on a page).
  menu(i, anchor, at) {
    if (!i) return;
    const t = i.task;
    const done = !!i.row.fields?.done;
    const items = [];
    const rep = isRepeat(t);
    // One time a repeating task was done: take it back, or say how long it took.
    if (i.occ) {
      items.push({ label: 'Not done after all', run: () => this.tick(i, false) });
      if (!t.habit) items.push({ label: t.actual ? `It took ${span(t.actual)}` : 'How long it took…', run: () => this.askTook(i) });
      items.push('sep', { label: 'How it’s going', sub: this.historyItems(i) }, { label: 'Open it where it’s written', run: () => this.hooks.openEntry(i.row.id) });
      return popMenu(anchor, items, at);
    }
    if (done) items.push({ label: 'Not done after all', run: () => this.tick(i, false) }, { label: t.actual ? `It took ${span(t.actual)}` : 'How long it took…', run: () => this.askTook(i) });
    else {
      items.push({ label: 'Done', run: () => this.tick(i, true) });
      items.push({ label: t.run ? 'Stop the timer' : 'Start the timer', run: () => this.timerFor(i) });
    }
    // On a phone, a quick way to the ends of the day without sliding past everything.
    const list = !done && anchor?.dataset?.move && anchor.closest?.('.pl-list');
    if (list) items.push('sep', { label: 'Move to the top', run: () => this.toEnd(list, i.row.id, true) }, { label: 'Move to the bottom', run: () => this.toEnd(list, i.row.id, false) });
    items.push('sep', { label: `When…${hover.matches ? '  (Alt + W)' : ''}`, run: () => this.pickWhenFor(this.movingIds(i.row.id), { anchor, at }) }, 'sep',
      ...(t.habit || !this.estimates ? [] : [{ label: t.est ? `Takes ${span(t.est)}` : 'How long it takes', sub: this.estItems(i) }]),
      // It can come round again; one that does can be a habit, with no hours.
      ...(!done && !isStretch(t) && !t.mark ? [{ label: rep ? repeatWord(t.repeat) : 'Repeat', sub: this.repeatItems(i) }] : []),
      ...(!done && rep ? [
        { label: 'A habit', current: !!t.habit, run: async () => { await this.wrote(await setTask(i.row.id, { habit: !t.habit })); if (!t.habit) this.hooks.toast?.('A habit now: no hours, and a click on it shows how it’s going'); } },
        { label: 'Skip this one', run: async () => this.wrote(await skipTask(i.row.id)) },
        { label: 'How it’s going', sub: this.historyItems(i) },
      ] : []),
      ...(plainLine(i.row) ? [{ label: 'Change the words…', run: async () => { const v = await askText({ title: 'Its words', value: i.row.text || '', ok: 'Save' }); if (v && String(v).trim() && String(v).trim() !== i.row.text) await this.wrote(await renameTask(i.row.id, String(v))); } }] : []),
      // With a day, it can be a date to hit: a diamond in Weeks ahead.
      ...(!done && t.day && !isStretch(t) && !rep ? [
        { label: 'A date to hit', current: !!t.mark, run: async () => this.wrote(await setTask(i.row.id, { mark: t.mark ? null : 'date' })) },
        ...(t.mark ? [{ label: 'This date can’t move', current: t.mark === 'hard', run: async () => this.wrote(await setTask(i.row.id, { mark: t.mark === 'hard' ? 'date' : 'hard' })) }] : [])
      ] : []),
      // On the Acro HQ board: hand it to Nate (it leaves your day, stays on the plan) or take it back.
      ...(i.row.fields?.hq && !done ? [t.owner && t.owner !== 'me'
        ? { label: 'Make it mine', run: async () => { await this.wrote(await setTask(i.row.id, { owner: null })); this.hooks.toast?.('Yours again: it’s on your day, and on the board as yours'); } }
        : { label: 'Hand to Nate', run: async () => { await this.wrote(await setTask(i.row.id, { owner: 'Nate' })); this.hooks.toast?.('Handed to Nate: it goes on the board as his and leaves your day'); } }] : []),
      'sep',
      { label: 'Open it where it’s written', run: () => this.hooks.openEntry(i.row.id) },
      ...(this.hooks.beside?.(i.row.id) ? [{ label: 'Open it beside', run: this.hooks.beside(i.row.id) }] : []),
      { label: 'Not a task any more', run: async () => { await this.wrote(await unTask(i.row.id)); this.hooks.toast?.('It’s a plain line again, still where it was written'); } },
      ...(this.canRemove(i) ? ['sep', { label: this.sel?.size > 1 && this.sel.has(i.row.id) ? `Delete ${this.sel.size} tasks` : 'Delete', danger: true, run: () => this.remove(this.sel?.size > 1 && this.sel.has(i.row.id) ? [...this.sel].map((x) => this.item(x)).filter(Boolean) : [i]) }] : [])
    );
    popMenu(anchor, items, at);
  }

  // How often it comes round. It starts from the day it's on (or today).
  repeatItems(i) {
    const t = i.task;
    const r = t.repeat || null;
    const base = t.day && t.day > this.today ? t.day : this.today;
    const day = long(base, { weekday: 'long' });
    const d = dow(base);
    const n = dateOf(base).getDate();
    const is = (every, k = 1, days = null) => !!r && r.every === every && (r.n || 1) === k && (!days || JSON.stringify(r.days?.length ? r.days : [dow(r.from)]) === JSON.stringify(days));
    const set = (rule) => async () => this.wrote(await setRepeat(i.row.id, rule));
    return [
      { label: 'Doesn’t repeat', current: !r, run: set(null) },
      { label: 'Every day', current: is('day'), run: set({ every: 'day' }) },
      { label: 'Weekdays', current: is('weekdays'), run: set({ every: 'weekdays' }) },
      { label: `Every ${day}`, current: is('week', 1, [d]), run: set({ every: 'week', days: [d] }) },
      { label: `Every other ${day}`, current: is('week', 2, [d]), run: set({ every: 'week', n: 2, days: [d] }) },
      { label: `Every month on the ${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`, current: is('month'), run: set({ every: 'month' }) },
      { label: 'Pick the days…', run: async () => {
        const v = await askText({ title: 'Which days of the week?', value: r?.every === 'week' && r.days?.length ? r.days.map((x) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][x - 1]).join(', ') : '', placeholder: 'Mon, Wed, Fri', ok: 'Save' });
        if (v === null || v === undefined || v === false || !String(v).trim()) return;
        const days = readDays(String(v));
        if (!days) { this.hooks.toast?.('Didn’t catch that. Try Mon, Wed, Fri.'); return; }
        await set({ every: 'week', days })();
      } }
    ];
  }

  // How a repeating task is going: in a row, and the last four weeks.
  historyItems(i) {
    const t = i.task;
    const h = history(this.item(i.row.id)?.row.fields.task || t, this.today);
    const grid = make('div', 'hb');
    grid.setAttribute('role', 'img');
    const head = make('div', 'hb-row hb-head');
    for (const d of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) head.append(make('span', '', d));
    grid.append(head);
    for (const week of h.weeks) {
      const row = make('div', 'hb-row');
      for (const d of week) {
        const c = make('i', `hb-${d.state}${d.iso === this.today ? ' today' : ''}`);
        c.title = `${long(d.iso, { weekday: 'short', month: 'short', day: 'numeric' })}${d.state === 'done' ? ': done' : d.state === 'missed' ? ': missed' : d.state === 'open' ? ': still open' : ''}`;
        row.append(c);
      }
      grid.append(row);
    }
    const said = h.streak > 1 ? `${h.streak} in a row` : h.streak === 1 ? 'Done the last time' : h.done ? 'Not the last time' : 'Not done yet';
    const count = h.due ? ` · ${h.done} of the last ${h.due}` : '';
    grid.setAttribute('aria-label', `${said}${count}. The last four weeks, day by day.`);
    return [
      { note: `${repeatWord(t.repeat)}${t.habit ? ' · a habit' : ''}`, plain: true },
      { note: `${said}${count}`, plain: true },
      { el: grid }
    ];
  }

  // The label after a task's words on a page was clicked.
  async chipMenu(id, anchor) {
    this.items = await loadTasks();
    const i = this.item(id);
    if (i) this.menu(i, anchor);
  }

  // New words for a task, right in the plan.
  rename(i, el) {
    const input = make('input', 'pl-rename');
    input.type = 'text';
    input.value = i.row.text || '';
    input.setAttribute('aria-label', 'The task’s words');
    this.renaming = true;
    let over = false;
    const finish = async (save) => {
      if (over) return;
      over = true;
      this.renaming = false;
      const text = input.value.trim();
      if (save && text && text !== i.row.text) await this.wrote(await renameTask(i.row.id, text));
      else await this.refresh();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    el.replaceWith(input);
    input.focus();
    input.select();
  }

  // ---------- dragging ----------

  // Day: drag a task up or down to reorder. Week: drag it to another day, or
  // to the tray.
  drags(root) {
    let id = null;
    const clear = () => root.querySelectorAll('.drop-before, .drop-after, .drop-on').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-on'));
    const spot = (e, target = e.target) => {
      const zone = target?.closest?.('.pw-day, .pw-tray');
      if (zone) return { zone };
      // What's when: over a heading (or a folded one), at the end of it.
      const sec = target?.closest?.('.ww-sec');
      let list = target?.closest?.('.pl-list');
      if (sec && (!list || target.closest('.ww-h') || list.hidden)) {
        list = sec.querySelector('.ww-list');
        const rest = [...list.querySelectorAll('.pl-task:not(.done):not(.ghost):not(.carried)')].filter((r) => r.dataset.task !== id);
        return { list, rows: rest, after: list.hidden ? rest.at(-1) || null : rest.at(-1) || null, sec };
      }
      if (!list) return null;
      // In a woven plan the events count as places too: a task can go just above or below one.
      const all = [...list.querySelectorAll('.pl-task:not(.done):not(.ghost), .pl-wev')].filter((r) => r.dataset.task !== id);
      let after = null;
      for (const r of all) { const b = r.getBoundingClientRect(); if (e.clientY > b.top + b.height / 2) after = r; }
      // Tasks from earlier days sit on top. One of those can move among them
      // (they keep their day); today's own tasks can go as high as just under them.
      const old = all.filter((r) => r.classList.contains('carried'));
      const rest = all.filter((r) => !r.classList.contains('carried'));
      const inOld = old.length > 0 && (after ? after.classList.contains('carried') : true);
      const movingOld = !!list.querySelector(`.pl-task.carried[data-task="${CSS.escape(id || '')}"]`);
      if (inOld && movingOld) return { list, rows: old, after, carried: true };
      return { list, rows: rest, after: inOld ? null : after };
    };
    const show = (s) => {
      clear();
      root.querySelectorAll('.pull-over').forEach((x) => x.classList.remove('pull-over'));
      if (!s) return;
      if (s.sec && (s.list.hidden || !s.rows.length)) s.sec.classList.add('pull-over');
      else if (s.zone) s.zone.classList.add('drop-on');
      else if (s.after) s.after.classList.add('drop-after');
      else (s.rows[0] || s.list.querySelector('.pl-add'))?.classList.add('drop-before');
    };
    const land = async (s, moved) => {
      root.querySelectorAll('.pull-over').forEach((x) => x.classList.remove('pull-over'));
      if (!s) return;
      const ids = this.movingIds(moved);
      if (s.zone) {
        // A day of the week, or "Any day this week".
        const day = s.zone.dataset.day || null;
        const i = this.item(moved);
        if (!i) return this.refresh();
        if (ids.length === 1 && day && (i.task.day || null) === day) return this.refresh();
        return this.pullDrop({ zone: s.zone }, ids);
      }
      // A heading of Plan: its time, at that place under it (a folded one opens).
      const bucket = s.list?.dataset.bucket || (s.sec && s.list?.hidden ? s.sec.dataset.bucket : null);
      if (bucket && !s.carried) {
        if (!s.sec?.classList.contains('pl-fline')) this.planFold(bucket, true);
        let seq = s.rows.map((r) => r.dataset.task).filter((x) => !ids.includes(x));
        seq.splice(s.after ? seq.indexOf(s.after.dataset.task) + 1 : 0, 0, ...ids);
        if (s.list.hidden) seq = this.bucketSeq(bucket, ids);
        return this.placeIn(bucket, seq, ids);
      }
      const seq = [...s.rows];
      seq.splice(s.after ? seq.indexOf(s.after) + 1 : 0, 0, { id: moved });
      if (s.carried) return this.wrote(await arrangeCarried(seq.map((x) => x.dataset?.task || x.id)));
      return this.settle(s.list, seq, moved);
    };
    this.touchDrags(root, { spot, show, clear, land, setId: (v) => { id = v; } });
    root.addEventListener('dragstart', (e) => {
      const row = e.target.closest?.('[data-task][draggable="true"]');
      if (!row) return;
      id = row.dataset.task;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.textContent.trim());
      requestAnimationFrame(() => row.classList.add('dragging'));
    });
    root.addEventListener('dragend', () => { id = null; clear(); root.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging')); });
    root.addEventListener('dragover', (e) => {
      if (!id) return;
      const s = spot(e);
      if (!s) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      show(s);
    });
    root.addEventListener('drop', async (e) => {
      if (!id) return;
      const s = spot(e);
      const moved = id;
      id = null;
      clear();
      if (!s) return;
      e.preventDefault();
      return land(s, moved);
    });
  }

  // On a touch screen, as in Workflowy (and as in the outline): press and hold
  // anywhere on a task and it lifts, then follows the finger (a quick swipe
  // still scrolls). On its six dots it slides at once; a tap there zooms in,
  // and holding them still brings up its menu. Near the top or bottom of the
  // screen the page scrolls along for as long as the finger stays there.
  touchDrags(root, { spot, show, clear, land, setId }) {
    const HOLD = 400; // ms held on a task before it lifts
    const MENU_HOLD = 450; // ms held still on the dots before the menu comes
    let t = null; // { row, id, x, y, armed, moving, grip, timer, lift, dy, lastX, lastY, raf }
    const end = () => {
      if (!t) return;
      clearTimeout(t.timer);
      cancelAnimationFrame(t.raf);
      t.lift?.remove();
      t.row.classList.remove('dragging', 'pl-armed');
      const html = document.documentElement;
      html.classList.remove('pl-touchdrag');
      // A task that was held stays out of typing, as in the outline: no
      // keyboard and no words picked, so the next one can be held straight away.
      if (t.armed) {
        html.classList.add('pl-calm');
        getSelection()?.removeAllRanges?.();
        if (document.activeElement?.closest?.('#plan, .pl-list') && document.activeElement !== document.body) document.activeElement.blur();
        clearTimeout(this.calmTimer);
        this.calmTimer = setTimeout(() => { html.classList.remove('pl-calm'); getSelection()?.removeAllRanges?.(); }, 400);
      }
      t = null;
      setId(null);
      clear();
    };
    // The finger on the dots sits in the margin, so a miss there is tried again across the middle.
    const at = (x, y) => spot({ clientY: y }, document.elementFromPoint(x, y)) || spot({ clientY: y }, document.elementFromPoint(innerWidth / 2, y));
    const arm = () => {
      if (!t) return;
      t.armed = true;
      t.row.classList.add('pl-armed');
      clearTimeout(this.calmTimer);
      document.documentElement.classList.add('pl-calm');
      getSelection()?.removeAllRanges?.();
      if (!t.grip) navigator.vibrate?.(12);
    };
    const begin = () => {
      t.moving = true;
      setId(t.id);
      const b = t.row.getBoundingClientRect();
      // A copy of the task rides under the finger; the task itself waits, faded, where it was.
      const lift = t.row.cloneNode(true);
      lift.classList.remove('pl-armed', 'sel');
      lift.classList.add('pl-lift');
      lift.removeAttribute('data-task');
      lift.querySelectorAll('[data-task], [data-act]').forEach((x) => { x.removeAttribute('data-task'); x.removeAttribute('data-act'); });
      lift.setAttribute('aria-hidden', 'true');
      Object.assign(lift.style, { left: `${b.left}px`, width: `${b.width}px`, top: `${b.top}px` });
      document.body.append(lift);
      t.lift = lift;
      // It rides just above the finger, so the line where it will land stays in sight.
      t.dy = b.height + 14;
      t.row.classList.add('dragging');
      document.documentElement.classList.add('pl-touchdrag');
      navigator.vibrate?.(8);
      // Near an edge, keep scrolling while the finger stays there.
      const edge = 72;
      const step = () => {
        if (!t?.moving) return;
        const y = t.lastY;
        // With a project open in the bottom half, its top is the bottom edge.
        const floor = this.hooks.floor?.() || innerHeight;
        const speed = y < edge ? -Math.ceil((edge - y) / 6) : y > floor - edge ? Math.ceil((y - (floor - edge)) / 6) : 0;
        if (speed) { window.scrollBy(0, speed); show(at(t.lastX, y)); }
        t.raf = requestAnimationFrame(step);
      };
      t.raf = requestAnimationFrame(step);
    };
    root.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return end();
      const row = e.target.closest?.('[data-task][data-move]');
      if (!row || e.target.closest('input')) return;
      const { clientX: x, clientY: y } = e.touches[0];
      end();
      const grip = !!e.target.closest('.pl-grip');
      t = { row, id: row.dataset.task, x, y, lastX: x, lastY: y, armed: false, moving: false, grip };
      if (grip) {
        // The dots: a slide moves it at once, a tap zooms in, holding still brings up its menu.
        arm();
        t.timer = setTimeout(() => {
          if (!t || t.moving) return;
          t.menued = true;
          navigator.vibrate?.(12);
          this.menu(this.item(t.id), t.row, { left: t.x, top: t.y });
        }, MENU_HOLD);
      } else t.timer = setTimeout(arm, HOLD);
    }, { passive: true });
    root.addEventListener('touchmove', (e) => {
      if (!t) return;
      const { clientX: x, clientY: y } = e.touches[0];
      if (!t.armed) {
        if (Math.hypot(x - t.x, y - t.y) > 10) end(); // a scroll, not a hold
        return;
      }
      e.preventDefault();
      if (t.menued) return;
      t.lastX = x;
      t.lastY = y;
      if (!t.moving) {
        if (Math.hypot(x - t.x, y - t.y) < 6) return;
        clearTimeout(t.timer);
        begin();
      }
      t.lift.style.top = `${y - t.dy}px`;
      show(at(x, y));
    }, { passive: false });
    root.addEventListener('touchend', (e) => {
      if (!t) return;
      const was = t;
      if (!was.moving) {
        end();
        // Held still and let go: it settles back (a menu that came stays open).
        // A quick tap on the dots goes on to zoom in.
        if ((was.armed && !was.grip) || was.menued) e.preventDefault();
        return;
      }
      e.preventDefault(); // no tap on whatever is under the finger
      const { clientX: x, clientY: y } = e.changedTouches[0];
      const s = at(x, y);
      end();
      land(s, was.id);
    });
    root.addEventListener('touchcancel', end);
    // A phone's own long-press menu would end the hold before the finger
    // moves (Android sends it at about half a second): once a task is held
    // it waits (the dots bring up the task's own menu).
    root.addEventListener('contextmenu', (e) => {
      if (t?.armed || t?.moving) { e.preventDefault(); e.stopImmediatePropagation(); } else end();
    }, true);
  }

  // A running timer counts up on the page once a second.
  tickClock() {
    clearInterval(this.clockTimer);
    const running = this.items.filter((i) => i.task.run);
    if (!running.length) return;
    this.clockTimer = setInterval(() => {
      if (!this.dayShown && !this.pageShown && !this.stepsShown) { clearInterval(this.clockTimer); return; }
      for (const el of document.querySelectorAll('[data-timer]')) {
        const i = this.item(el.dataset.timer);
        if (i) el.textContent = clock(i.task, Date.now());
      }
    }, 1000);
  }
}

// A task kept in step with the Acro HQ board, deleted here, is deleted on the
// board too: the mark tells the board sync it was meant (a page or project
// put in the Trash doesn't take its board tasks with it).
const hqGoes = (row) => (row.fields?.hq?.id ? { ...row, fields: { ...row.fields, hqDelete: Date.now() } } : row);

// A line's words as written: its links as links, its [[links]] as names.
function lineBits(r) {
  const nodes = Array.isArray(r.content) ? r.content : Array.isArray(r.content?.content) ? r.content.content : null;
  if (!nodes) return [document.createTextNode(String(r.text || ''))];
  const out = [];
  for (const n of nodes) {
    if (n.type === 'text') {
      const href = n.marks?.find((m) => m.type === 'link')?.attrs?.href;
      if (href && /^https?:\/\//i.test(href)) {
        const a = make('a', 'pl-kid-link', n.text || href);
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener';
        out.push(a);
      } else out.push(document.createTextNode(n.text || ''));
    } else if (n.type === 'entryRef') {
      const a = make('span', 'pl-kid-ref', n.attrs?.title || 'Untitled');
      out.push(a);
    } else if (n.type === 'hardBreak') out.push(document.createTextNode(' '));
  }
  return out.length ? out : [document.createTextNode(String(r.text || ''))];
}
