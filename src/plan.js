// The plan. Today is one room seen from four distances: Day (the plan on top
// of the day's page), Week (seven days and the tray of things not on a day
// yet), Weeks ahead (six weeks, a lane for each project: ahead.js) and Pace
// (what you planned against what it really took). Tasks are
// ordinary lines with a day (see tasks.js), gathered here from wherever they
// live. Plain text on hairlines; nothing is copied.

import { popMenu, askText, ask } from './menu.js';
import { trash, restore } from './trash.js';
import {
  loadTasks, dayPlan, weekPlan, pace, planSettings, savePlanSettings, setTask, unTask, tickTask, tookTask, startTimer, stopTimer,
  addTask, renameTask, arrange, weave, plainLine, parseEst, readSpan, timed, span, hours, isoOf, addDays, dateOf, weekOf, dayWord, TASKS_PAGE, stepsPage, stepsHome,
  moveTask, isStretch, stretchWord, isRepeat, repeatWord, readDays, parseAdd, history, occItem, setRepeat, skipTask, rollTicked, dow, areaHours
} from './tasks.js';
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
const TABS = [['day', 'Day', 'today'], ['week', 'Week', 'week'], ['ahead', 'Weeks ahead', 'ahead'], ['pace', 'Pace', 'pace']];
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
    this.tab = ['pace', 'day', 'ahead'].includes(place.tab) ? place.tab : 'week';
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

  redraw() {
    if (this.renaming) return;
    if (this.dayShown) this.drawDay();
    if (this.stepsShown) this.drawSteps();
    if (this.pageShown) { if (this.tab === 'pace') this.drawPace(); else if (this.tab === 'ahead') drawAhead(this); else if (this.tab === 'day') this.drawDay(this.sheet, this.today); else this.drawWeek(); }
  }

  // Calendar events for the days showing: what's kept draws at once, and the
  // latest follows when it differs.
  loadCalendar(turn) {
    const week = this.pageShown && this.tab === 'week' ? weekOf(this.week || this.today) : null;
    const range = this.dayShown ? [this.day, this.day] : week ? [week[0], week[6]] : this.pageShown && this.tab === 'day' ? [this.today, this.today] : null;
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

  // List or Calendar, remembered on this device.
  get dayView() { try { return localStorage.getItem('planView') || 'list'; } catch { return 'list'; } }
  set dayView(v) { try { localStorage.setItem('planView', v); } catch { /* no storage here */ } }
  viewSwitch(asCal) {
    const row = make('div', 'pl-view');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'See the plan as');
    for (const [id, label] of [['list', 'List'], ['cal', 'Calendar']]) {
      const b = make('button', '', label);
      b.dataset.act = `view-${id}`;
      b.setAttribute('aria-pressed', String((id === 'cal') === asCal));
      row.append(b);
    }
    return row;
  }

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

  switchRow(current) {
    const row = make('div', 'pl-switch');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Views of Today');
    for (const [id, label, cmd] of TABS) {
      const b = make('button', '', label);
      b.dataset.cmd = cmd;
      if (id === current) b.setAttribute('aria-current', 'page');
      row.append(b);
    }
    return row;
  }

  // ---------- Day ----------

  drawDay(box = this.box, day = this.day) {
    const today = this.today;
    const p = dayPlan(this.items, day, today);
    const held = this.held(box);
    const head = make('div', 'pl-head');
    head.append(make('h2', 'pl-label', 'Plan'));
    const said = [];
    // Time estimates are off unless switched on under Look: then it's only how many.
    const est = this.estimates;
    if (p.todo.length) said.push(est && p.left ? `${span(p.left)} to do` : `${p.todo.length} to do`);
    if (p.done.length) said.push(est && p.spent ? `${span(p.spent)} done` : `${p.done.length} done`);
    head.append(make('span', 'pl-sum', said.join(' · ')));
    const evs = this.cal.filter((e) => e.day === day);
    // Today: the time still free before your day ends, less what's on the calendar.
    if (est && day === today && p.todo.length) {
      const free = Math.floor(freeLeft(evs, Date.now(), this.dayEnd) / 5) * 5;
      const left = make('button', `pl-left${p.left > free ? ' over' : ''}`, `${span(free)} left today`);
      left.dataset.act = 'dayend';
      const h = Math.floor(this.dayEnd);
      const m = Math.round((this.dayEnd % 1) * 60);
      left.title = `Until ${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 || h === 24 ? 'am' : 'pm'}${evs.some((e) => !e.allDay) ? ', less what’s on your calendar' : ''}: click to change when your day ends`;
      head.append(left);
    }
    // List | Calendar: the same tasks as an order, or placed by hand on the day's hours.
    const asCal = this.dayView === 'cal' && !this.hooks.off?.('planview');
    head.append(this.viewSwitch(asCal), this.switchRow('day'));
    // A pile left from earlier days: go through it one at a time.
    if (day === today && p.carried.length >= 5 && this.hooks.goThrough && box === this.box) {
      const b = make('button', 'pl-thru', `${p.carried.length} from earlier days · Go through`);
      b.dataset.act = 'thru-carried';
      b.title = 'One at a time: keep it for today, take it off the day, or delete it';
      head.append(b);
    }
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
      ...p.carried.flatMap((i) => this.taskRow(i, { carried: true, next: day === today && i === p.next })),
      ...(timed.length ? weave(p.open, timed, day, Date.now(), today).flatMap((x) => (x.event ? [this.wovenEvent(x.event, x.at)] : row(x.item))) : p.open.flatMap(row))
    ];
    const below = p.done.flatMap((i) => this.taskRow(i, {}));
    const typing = !asCal && this.typingIn(box, day);
    if (asCal) {
      box.replaceChildren(head, cal, drawCalendar(this, day, [...p.carried, ...p.open], evs));
    } else if (typing) {
      // Adding one after another: the box stays where it is, the rest is drawn around it.
      for (const el of [...box.children]) if (el !== typing.list) el.remove();
      box.prepend(head, cal);
      typing.list.dataset.day = day;
      this.fillAround(typing.list, typing.row, above, below);
    } else {
      const list = make('div', 'pl-list');
      list.dataset.day = day;
      list.append(...above, this.addRow(day, 'Add a task'), ...below);
      box.replaceChildren(head, cal, list);
      this.restore(box, held);
    }
    box.dataset.n = String(p.todo.length + p.done.length);
    this.just = null;
    if (box === this.box) this.backAgain();
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
    const at = (i) => i.task.day || '9999';
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

  addRow(day, placeholder) {
    // A form, so a phone keyboard's Enter (or Go) sends it like a desktop Enter does.
    const row = make('form', 'pl-add');
    row.noValidate = true;
    row.addEventListener('submit', (e) => { e.preventDefault(); this.add(input); });
    // A click anywhere on the row goes into the box, as it did when the row was a label.
    row.addEventListener('click', (e) => { if (e.target !== input) input.focus(); });
    const ring = make('span', 'pl-check ghost');
    ring.setAttribute('aria-hidden', 'true');
    const input = make('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    // "Enter", not "Done": the keyboard stays up for the next one.
    input.setAttribute('enterkeyhint', 'enter');
    input.setAttribute('aria-label', day ? `Add a task for ${dayWord(day, this.today)}` : 'Add a task, not on a day yet');
    input.dataset.add = day || 'tray';
    row.append(ring, input);
    return row;
  }

  taskRow(i, { carried = false, next = false, when = false, drag = true, place = null }) {
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
    if (carried) title.append(make('span', 'pl-from', `from ${dayWord(t.day, this.today)}`));
    const meta = make('div', 'pl-meta');
    const where = place ?? this.placeOf(i);
    if (where) {
      const a = make('button', 'pl-place', where);
      a.dataset.act = 'open';
      a.title = 'Open it where it’s written';
      meta.append(a);
    }
    // A task kept in step with the Acro HQ board: whose it is (when it isn't
    // yours), and a way to its card there.
    if (t.owner && t.owner !== 'me') meta.append(make('span', 'pl-owner', String(t.owner)));
    const hq = i.row.fields?.hq;
    if (hq?.link && /^https:\/\//.test(hq.link)) {
      const a = make('a', 'pl-hq', 'HQ');
      a.href = hq.link;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = 'Open it on the Acro HQ board';
      meta.append(a);
    }
    // On a project's page a step says its day; click to move it.
    if (when && !done) {
      const stretch = isStretch(t);
      const late = stretch ? t.until < this.today : t.day && t.day < this.today;
      const word = stretch ? stretchWord(t) : `${t.mark ? '◆ ' : ''}${dayWord(t.day, this.today)}`;
      if (rep) row.dataset.repeat = repeatWord(t.repeat);
      const d = make('button', `pl-when${t.day ? (late ? ' late' : '') : ' unset'}${t.mark === 'hard' ? ' hard' : ''}`, word);
      d.dataset.act = 'day';
      d.setAttribute('aria-label', stretch ? `From ${word}; click to move it` : t.day ? `${t.mark ? 'A date to hit: ' : 'Planned for '}${dayWord(t.day, this.today)}${t.mark === 'hard' ? ', and it can’t move' : ''}; click to move it` : 'Not on a day yet; click to pick one');
      meta.append(d);
    }
    if (!done && !ghost && !t.habit) {
      const play = make('button', 'pl-play');
      play.innerHTML = t.run ? ICON.pause : ICON.play;
      play.dataset.act = 'timer';
      play.setAttribute('aria-label', t.run ? 'Stop the timer' : 'Start the timer');
      meta.append(play);
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
    meta.append(est, more);
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
    side.append(this.meter(w.min, this.free * 60), nav, this.switchRow('week'));
    head.append(left, side);

    const grid = make('div', 'pw-week');
    for (const d of w.days) {
      const col = make('section', `pw-day${d.today ? ' today' : ''}${d.iso < today ? ' past' : ''}`);
      col.dataset.day = d.iso;
      const h = make('button', 'pw-h');
      h.dataset.act = 'open-day';
      h.title = 'Open this day';
      h.append(make('b', '', String(dateOf(d.iso).getDate())), make('span', '', `${long(d.iso, { weekday: 'short' })}${d.min ? ` · ${span(d.min)}` : ''}`));
      col.append(h);
      for (const e of this.cal.filter((x) => x.day === d.iso)) col.append(this.eventLine(e, 'pw-ev'));
      for (const i of d.open) col.append(this.chip(i));
      for (const i of d.done) col.append(this.chip(i));
      col.append(this.addRow(d.iso, 'Add'));
      grid.append(col);
    }
    const tray = make('section', 'pw-tray');
    tray.dataset.day = '';
    tray.append(make('h2', 'pl-label', 'Not on a day yet'));
    const chips = make('div', 'pw-chips');
    for (const i of w.tray) chips.append(this.chip(i));
    chips.append(this.addRow(null, 'Add'));
    tray.append(chips);
    const parts = [head, grid, tray];
    const byArea = this.areaRows(first);
    if (byArea) parts.push(byArea);
    if (w.late && thisWeek) parts.push(make('p', 'pl-note', `${w.late} still open from before this week. ${w.late === 1 ? 'It waits' : 'They wait'} at the top of today’s plan.`));
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
    const mins = i.task.habit ? 0 : done ? i.task.actual || i.task.est : i.task.est;
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
    if (act === 'view-list' || act === 'view-cal') { this.dayView = act.slice(5); return this.redraw(); }
    if (act === 'thru-carried') return this.hooks.goThrough?.();
    if (act === 'free') return this.askFree();
    if (act === 'dayend') return this.askDayEnd();
    if (act === 'area-target') return this.askTarget(el.closest('[data-area]').dataset.area);
    if (act === 'area-pick') {
      const shown = new Set([...this.sheet.querySelectorAll('.pa-row')].map((r) => r.dataset.area));
      return popMenu(el, (this.areaList || []).filter((a) => !shown.has(a.id)).map((a) => ({ label: a.title || 'Untitled', run: () => this.askTarget(a.id) })));
    }
    if (act === 'all-done') { this.allDone = !this.allDone; return this.drawSteps(); }
    if (act === 'kid') {
      if (e.target.closest('a[href]')) return;
      const of = el.closest('[data-kids-of]')?.dataset.kidsOf;
      if (of) this.left(of);
      return of && this.hooks.openTask?.(of, el.dataset.line);
    }
    if (!i) return;
    if (act === 'day') return popMenu(el, this.dayItems(i));
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
    if (how === 'delete') {
      const row = await getEntry(it.id);
      if (!row || isTrashed(row)) return null;
      await trash(row);
      await this.wrote([await getEntry(it.id)]);
      return async () => { await restore(it.id); await this.wrote([await getEntry(it.id)]); };
    }
    return null;
  }

  // ---------- picking several, and deleting ----------

  select(id, row, on = !this.sel?.has(id)) {
    this.sel ||= new Set();
    if (on) this.sel.add(id); else this.sel.delete(id);
    (row || this.box.querySelector(`[data-task="${CSS.escape(id)}"]`))?.classList.toggle('sel', on);
    if (this.sel.size) this.hooks.toast?.(`${this.sel.size} picked · Ctrl + Shift + Backspace deletes, Esc lets go`);
  }
  unselect() {
    for (const id of this.sel || []) for (const r of document.querySelectorAll(`[data-task="${CSS.escape(id)}"]`)) r.classList.remove('sel');
    this.sel = new Set();
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
    const hq = list.filter((i) => i.row.fields?.hq);
    if (hq.length) {
      const yes = await ask({
        title: hq.length === 1 ? 'This task is on the Acro HQ board' : `${hq.length} of these are on the Acro HQ board`,
        body: 'Deleting here takes it out of Inkwell only. It stays on the board, where you or Nate can remove it.',
        ok: 'Delete from Inkwell', danger: true
      });
      if (!yes) return false;
    }
    const gone = [];
    let lines = 0;
    for (const i of list) {
      const row = await getEntry(i.row.id);
      if (!row || row.deleted || isTrashed(row)) continue;
      const n = await trash(row);
      lines += n - 1;
      gone.push({ id: row.id, text: row.text || 'Untitled', from: i.world?.title || (i.root?.kind === 'page' ? i.root.title : '') });
    }
    if (!gone.length) return false;
    this.unselect();
    this.lastGone = gone.map((g) => g.id);
    await this.wrote(await Promise.all(this.lastGone.map((id) => getEntry(id))));
    const one = gone[0];
    const under = lines ? ` and ${lines === 1 ? 'the line' : `${lines} lines`} under it` : '';
    const said = gone.length === 1 ? `Deleted “${one.text}”${under}${one.from ? `, from ${one.from}` : ''}` : `Deleted ${gone.length} tasks${theirs.length ? ` (Nate’s ${theirs.length === 1 ? 'one stays' : 'stay'})` : ''}`;
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

  // Alt + Up / Alt + Down on a task moves it one place in its day (past an
  // event, in a woven plan).
  nudge(e) {
    const row = e.target.closest?.('.pl-list [data-task][data-move]');
    if (!row) return false;
    const list = row.closest('.pl-list');
    const seq = [...list.querySelectorAll('.pl-task[data-move]:not(.carried):not(.ghost), .pl-wev')];
    const at = seq.indexOf(row);
    const to = at + (e.key === 'ArrowUp' ? -1 : 1);
    e.preventDefault();
    if (at < 0 || to < 0 || to >= seq.length) return true;
    seq.splice(to, 0, ...seq.splice(at, 1));
    const id = row.dataset.task;
    const which = e.target.dataset.act || 'words';
    this.settle(list, seq, id).then(() => {
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
    if (e.key === 'Escape' && this.sel?.size && !e.target.closest?.('input')) { this.unselect(); return; }
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
    input.value = '';
    addTask({ text: title, day, est, repeat, order: this.lastOrder(day), home: steps ? stepsHome(this.world) : null }).then(async (rows) => {
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

  // Which day: today, tomorrow, another, or none.
  dayItems(i) {
    const t = i.task;
    const today = this.today;
    const days = [];
    for (let n = 2; n <= 7; n++) {
      const iso = addDays(today, n);
      days.push({ label: long(iso, { weekday: 'long', month: 'short', day: 'numeric' }), current: t.day === iso, run: () => this.move(i, iso) });
    }
    days.push({ label: 'Pick a date…', run: async () => { const v = await askText({ title: 'Which day?', type: 'date', value: '', ok: 'Move' }); if (v && /^\d{4}-\d\d-\d\d$/.test(String(v))) this.move(i, String(v)); } });
    return [
      { label: 'Today', current: t.day === today, run: () => this.move(i, today) },
      { label: 'Tomorrow', current: t.day === addDays(today, 1), run: () => this.move(i, addDays(today, 1)) },
      { label: 'Another day', sub: days },
      { label: 'Not on a day yet', current: !t.day, run: () => this.move(i, null) }
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
    items.push('sep', ...this.dayItems(i), 'sep',
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
      const list = target?.closest?.('.pl-list');
      if (!list) return null;
      // In a woven plan the events count as places too: a task can go just above or below one.
      const rows = [...list.querySelectorAll('.pl-task:not(.done):not(.carried):not(.ghost), .pl-wev')].filter((r) => r.dataset.task !== id);
      let after = null;
      for (const r of rows) { const b = r.getBoundingClientRect(); if (e.clientY > b.top + b.height / 2) after = r; }
      return { list, rows, after };
    };
    const show = (s) => {
      clear();
      if (!s) return;
      if (s.zone) s.zone.classList.add('drop-on');
      else if (s.after) s.after.classList.add('drop-after');
      else (s.rows[0] || s.list.querySelector('.pl-add'))?.classList.add('drop-before');
    };
    const land = async (s, moved) => {
      if (!s) return;
      if (s.zone) {
        const day = s.zone.dataset.day || null;
        const i = this.item(moved);
        if (!i || (i.task.day || null) === day) return this.refresh();
        return this.wrote(await setTask(moved, { day, order: this.lastOrder(day) }));
      }
      const seq = [...s.rows];
      seq.splice(s.after ? seq.indexOf(s.after) + 1 : 0, 0, { id: moved });
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

  // On a touch screen there's no mouse drag: press and hold a task, then
  // slide it to its new place (or, in Week, onto another day). Holding still
  // instead brings up the task's menu as before; a quick swipe still scrolls.
  touchDrags(root, { spot, show, clear, land, setId }) {
    const HOLD = 320;
    let t = null; // { row, id, x, y, armed, moving, timer }
    const end = () => {
      if (!t) return;
      clearTimeout(t.timer);
      t.row.classList.remove('dragging', 'pl-armed');
      document.documentElement.classList.remove('pl-touchdrag');
      t = null;
      setId(null);
      clear();
    };
    const at = (x, y) => spot({ clientY: y }, document.elementFromPoint(x, y));
    root.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return end();
      const row = e.target.closest?.('[data-task][data-move]');
      if (!row || e.target.closest('input')) return;
      const { clientX: x, clientY: y } = e.touches[0];
      t = { row, id: row.dataset.task, x, y, armed: false, moving: false };
      t.timer = setTimeout(() => {
        if (!t) return;
        t.armed = true;
        row.classList.add('pl-armed');
        navigator.vibrate?.(12);
      }, HOLD);
    }, { passive: true });
    root.addEventListener('touchmove', (e) => {
      if (!t) return;
      const { clientX: x, clientY: y } = e.touches[0];
      if (!t.armed) {
        if (Math.hypot(x - t.x, y - t.y) > 10) end(); // a scroll, not a hold
        return;
      }
      e.preventDefault();
      if (!t.moving) {
        if (Math.hypot(x - t.x, y - t.y) < 6) return;
        t.moving = true;
        setId(t.id);
        t.row.classList.add('dragging');
        document.documentElement.classList.add('pl-touchdrag');
      }
      show(at(x, y));
      // Near the top or bottom edge, the page scrolls along.
      const edge = 60;
      if (y < edge) window.scrollBy(0, -12);
      else if (y > window.innerHeight - edge) window.scrollBy(0, 12);
    }, { passive: false });
    root.addEventListener('touchend', (e) => {
      if (!t) return;
      const was = t;
      if (!was.moving) return end();
      e.preventDefault(); // no tap on whatever is under the finger
      const { clientX: x, clientY: y } = e.changedTouches[0];
      const s = at(x, y);
      end();
      land(s, was.id);
    });
    root.addEventListener('touchcancel', end);
    // The long-press menu only when the task wasn't moved.
    root.addEventListener('contextmenu', (e) => { if (t?.moving) { e.preventDefault(); e.stopImmediatePropagation(); } else end(); }, true);
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
