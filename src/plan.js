// The plan. Today is one room seen from three distances: Day (the plan on top
// of the day's page), Week (seven days and the tray of things not on a day
// yet) and Pace (what you planned against what it really took). Tasks are
// ordinary lines with a day (see tasks.js), gathered here from wherever they
// live. Plain text on hairlines; nothing is copied.

import { popMenu, askText } from './menu.js';
import {
  loadTasks, dayPlan, weekPlan, pace, planSettings, savePlanSettings, setTask, unTask, tickTask, tookTask, startTimer, stopTimer,
  addTask, renameTask, arrange, plainLine, parseEst, readSpan, timed, span, hours, isoOf, addDays, dateOf, weekOf, dayWord, TASKS_PAGE
} from './tasks.js';

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
const TABS = [['day', 'Day', 'today'], ['week', 'Week', 'week'], ['pace', 'Pace', 'pace']];
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
// off(name) → is that part switched off under Look.
export class Plan {
  constructor({ box, sheet, hooks }) {
    this.box = box;
    this.sheet = sheet;
    this.hooks = hooks;
    this.day = null; // the day whose plan sits on the day page
    this.tab = 'week';
    this.week = null; // any day of the week shown (null: this week)
    this.items = [];
    this.free = 45;
    this.took = null; // the task just ticked, asked how long it took
    this.just = null;
    for (const el of [box, sheet]) {
      el.addEventListener('click', (e) => this.click(e));
      el.addEventListener('keydown', (e) => this.key(e));
      el.addEventListener('contextmenu', (e) => {
        const row = e.target.closest('[data-task]');
        if (!row || e.target.closest('input')) return;
        e.preventDefault();
        this.menu(this.item(row.dataset.task), row, { left: e.clientX, top: e.clientY });
      });
      this.drags(el);
    }
  }

  item(id) { return this.items.find((i) => i.row.id === id) || null; }
  get today() { return isoOf(); }
  get dayShown() { return !!this.day && this.hooks.view() === 'notebook'; }
  get pageShown() { return this.hooks.view() === 'plan'; }

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

  async showPage(place) {
    this.tab = place.tab === 'pace' ? 'pace' : 'week';
    this.week = place.week || null;
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
    if (!this.dayShown && !this.pageShown) return;
    const turn = (this.turn = (this.turn || 0) + 1);
    const [items, settings] = await Promise.all([loadTasks(), planSettings()]);
    if (turn !== this.turn) return;
    this.items = items;
    this.free = settings.free;
    if (this.renaming) return;
    if (this.dayShown) this.drawDay();
    if (this.pageShown) { if (this.tab === 'pace') this.drawPace(); else this.drawWeek(); }
    this.tickClock();
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

  drawDay() {
    const box = this.box;
    const day = this.day;
    const today = this.today;
    const p = dayPlan(this.items, day, today);
    const held = this.held(box);
    const head = make('div', 'pl-head');
    head.append(make('h2', 'pl-label', 'Plan'));
    const said = [];
    if (p.todo.length) said.push(p.left ? `${span(p.left)} to do` : `${p.todo.length} to do`);
    if (p.done.length) said.push(p.spent ? `${span(p.spent)} done` : `${p.done.length} done`);
    head.append(make('span', 'pl-sum', said.join(' · ')), this.switchRow('day'));
    const list = make('div', 'pl-list');
    list.dataset.day = day;
    for (const i of p.carried) list.append(...this.taskRow(i, { carried: true, next: day === today && i === p.next }));
    for (const i of p.open) list.append(...this.taskRow(i, { next: day === today && i === p.next }));
    list.append(this.addRow(day, 'Add a task'));
    for (const i of p.done) list.append(...this.taskRow(i, {}));
    box.replaceChildren(head, list);
    box.dataset.n = String(p.todo.length + p.done.length);
    this.restore(box, held);
    this.just = null;
  }

  addRow(day, placeholder) {
    const row = make('label', 'pl-add');
    const ring = make('span', 'pl-check ghost');
    ring.setAttribute('aria-hidden', 'true');
    const input = make('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', day ? `Add a task for ${dayWord(day, this.today)}` : 'Add a task, not on a day yet');
    input.dataset.add = day || 'tray';
    row.append(ring, input);
    return row;
  }

  taskRow(i, { carried = false, next = false }) {
    const t = i.task;
    const id = i.row.id;
    const done = !!i.row.fields?.done;
    const row = make('div', `pl-task${done ? ' done' : ''}${next ? ' next' : ''}${t.run ? ' timing' : ''}${carried ? ' carried' : ''}${this.just === id ? ' justdone' : ''}`);
    row.dataset.task = id;
    if (!done && hover.matches) row.draggable = true;
    const check = make('button', 'pl-check');
    check.innerHTML = ICON.check;
    check.dataset.act = 'tick';
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', String(done));
    check.setAttribute('aria-label', done ? 'Done; click to untick' : 'Tick when done');
    const title = make('div', 'pl-title');
    const words = make('button', 'pl-words', i.row.text || 'Untitled');
    words.dataset.act = 'words';
    words.title = plainLine(i.row) ? 'Click to change the words' : 'Open it where it’s written';
    title.append(words);
    if (carried) title.append(make('span', 'pl-from', `from ${dayWord(t.day, this.today)}`));
    const meta = make('div', 'pl-meta');
    const place = this.placeOf(i);
    if (place) {
      const a = make('button', 'pl-place', place);
      a.dataset.act = 'open';
      a.title = 'Open it where it’s written';
      meta.append(a);
    }
    if (!done) {
      const play = make('button', 'pl-play');
      play.innerHTML = t.run ? ICON.pause : ICON.play;
      play.dataset.act = 'timer';
      play.setAttribute('aria-label', t.run ? 'Stop the timer' : 'Start the timer');
      meta.append(play);
    }
    const est = make('button', 'pl-est');
    est.dataset.act = 'est';
    if (t.run) { est.textContent = clock(t, Date.now()); est.dataset.timer = id; est.classList.add('live'); est.setAttribute('aria-label', 'Time on the clock'); }
    else if (done) { est.textContent = t.actual && t.est && t.actual !== t.est ? `${span(t.est)} → ${span(t.actual)}` : t.actual || t.est ? span(t.actual || t.est) : ''; est.setAttribute('aria-label', 'How long it took'); }
    else { est.textContent = t.est ? span(t.est) : 'how long?'; if (!t.est) est.classList.add('unset'); est.setAttribute('aria-label', t.est ? `Takes about ${span(t.est)}; click to change` : 'Say how long it takes'); }
    const more = make('button', 'pl-more', '⋯');
    more.dataset.act = 'more';
    more.setAttribute('aria-label', 'More for this task');
    more.setAttribute('aria-haspopup', 'menu');
    meta.append(est, more);
    row.append(check, title, meta);
    return this.took === id && done ? [row, this.tookRow(i)] : [row];
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
    if (i.root.kind === 'day') return this.dayShown && i.root.title === this.day ? '' : long(i.root.title, { month: 'short', day: 'numeric' });
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
    if (w.late && thisWeek) parts.push(make('p', 'pl-note', `${w.late} still open from before this week. ${w.late === 1 ? 'It waits' : 'They wait'} at the top of today’s plan.`));
    this.sheet.replaceChildren(...parts);
    this.restore(this.sheet, held);
  }

  chip(i) {
    const done = !!i.row.fields?.done;
    const b = make('button', `pw-task${done ? ' done' : ''}${i.task.run ? ' timing' : ''}`);
    b.dataset.task = i.row.id;
    b.dataset.act = 'more';
    if (!done && hover.matches) b.draggable = true;
    b.append(make('span', 'pw-t', i.row.text || 'Untitled'));
    const mins = done ? i.task.actual || i.task.est : i.task.est;
    if (mins) b.append(make('small', '', span(mins)));
    return b;
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
    const row = el.closest('[data-task], [data-took]');
    const i = row ? this.item(row.dataset.task || row.dataset.took) : null;
    if (act === 'week-prev' || act === 'week-next') return this.hooks.go({ view: 'plan', tab: 'week', week: addDays(weekOf(this.week || this.today)[0], act === 'week-prev' ? -7 : 7) });
    if (act === 'week-now') return this.hooks.go({ view: 'plan', tab: 'week' });
    if (act === 'open-day') return this.hooks.go({ view: 'notebook', pageId: `day-${el.closest('[data-day]').dataset.day}` });
    if (act === 'free') return this.askFree();
    if (!i) return;
    if (act === 'tick') return this.tick(i, !i.row.fields?.done);
    if (act === 'timer') return this.timerFor(i);
    if (act === 'est') return i.row.fields?.done ? this.askTook(i) : popMenu(el, this.estItems(i));
    if (act === 'more') return this.menu(i, el);
    if (act === 'open') return this.hooks.openEntry(i.row.id);
    if (act === 'words') return plainLine(i.row) ? this.rename(i, el) : this.hooks.openEntry(i.row.id);
    if (act === 'took') return this.tookFor(i, Number(el.dataset.m));
    if (act === 'took-other') return this.askTook(i);
  }

  key(e) {
    const input = e.target.closest?.('input[data-add]');
    if (!input) return;
    if (e.key === 'Escape') { input.value = ''; input.blur(); return; }
    if (e.key !== 'Enter' || !input.value.trim()) return;
    e.preventDefault();
    const { title, est } = parseEst(input.value);
    const day = input.dataset.add === 'tray' ? null : input.dataset.add;
    input.value = '';
    addTask({ text: title, day, est, order: this.lastOrder(day) }).then((rows) => this.wrote(rows));
  }

  async tick(i, done) {
    const row = await tickTask(i.row.id, done);
    const id = i.row.id;
    this.just = done ? id : null;
    this.took = null;
    if (done) {
      // With the question switched off, a timed task still keeps its time.
      if (this.hooks.off?.('took')) { const on = timed(row.fields.task); if (on) await tookTask(id, on); }
      else if (this.dayShown) this.took = id;
    }
    await this.wrote(row);
  }

  async tookFor(i, minutes) {
    this.took = null;
    await this.wrote(await tookTask(i.row.id, minutes));
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

  async move(i, day) {
    await this.wrote(await setTask(i.row.id, { day, order: this.lastOrder(day) }));
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
    const today = this.today;
    const done = !!i.row.fields?.done;
    const days = [];
    for (let n = 2; n <= 7; n++) {
      const iso = addDays(today, n);
      days.push({ label: long(iso, { weekday: 'long', month: 'short', day: 'numeric' }), current: t.day === iso, run: () => this.move(i, iso) });
    }
    days.push({ label: 'Pick a date…', run: async () => { const v = await askText({ title: 'Which day?', type: 'date', value: '', ok: 'Move' }); if (v && /^\d{4}-\d\d-\d\d$/.test(String(v))) this.move(i, String(v)); } });
    const items = [];
    if (done) items.push({ label: 'Not done after all', run: () => this.tick(i, false) }, { label: t.actual ? `It took ${span(t.actual)}` : 'How long it took…', run: () => this.askTook(i) });
    else {
      items.push({ label: 'Done', run: () => this.tick(i, true) });
      items.push({ label: t.run ? 'Stop the timer' : 'Start the timer', run: () => this.timerFor(i) });
    }
    items.push('sep',
      { label: 'Today', current: t.day === today, run: () => this.move(i, today) },
      { label: 'Tomorrow', current: t.day === addDays(today, 1), run: () => this.move(i, addDays(today, 1)) },
      { label: 'Another day', sub: days },
      { label: 'Not on a day yet', current: !t.day, run: () => this.move(i, null) },
      'sep',
      { label: t.est ? `Takes ${span(t.est)}` : 'How long it takes', sub: this.estItems(i) },
      'sep',
      { label: 'Open it where it’s written', run: () => this.hooks.openEntry(i.row.id) },
      { label: 'Not a task any more', run: async () => { await this.wrote(await unTask(i.row.id)); this.hooks.toast?.('It’s a plain line again, still where it was written'); } }
    );
    popMenu(anchor, items, at);
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
    const spot = (e) => {
      const zone = e.target.closest?.('.pw-day, .pw-tray');
      if (zone) return { zone };
      const list = e.target.closest?.('.pl-list');
      if (!list) return null;
      const rows = [...list.querySelectorAll('.pl-task:not(.done):not(.carried)')].filter((r) => r.dataset.task !== id);
      let after = null;
      for (const r of rows) { const b = r.getBoundingClientRect(); if (e.clientY > b.top + b.height / 2) after = r; }
      return { list, rows, after };
    };
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
      clear();
      if (s.zone) s.zone.classList.add('drop-on');
      else if (s.after) s.after.classList.add('drop-after');
      else (s.rows[0] || s.list.querySelector('.pl-add'))?.classList.add('drop-before');
    });
    root.addEventListener('drop', async (e) => {
      if (!id) return;
      const s = spot(e);
      const moved = id;
      id = null;
      clear();
      if (!s) return;
      e.preventDefault();
      if (s.zone) {
        const day = s.zone.dataset.day || null;
        const i = this.item(moved);
        if (!i || (i.task.day || null) === day) return this.refresh();
        return this.wrote(await setTask(moved, { day, order: this.lastOrder(day) }));
      }
      const ids = s.rows.map((r) => r.dataset.task);
      ids.splice(s.after ? ids.indexOf(s.after.dataset.task) + 1 : 0, 0, moved);
      return this.wrote(await arrange(ids, s.list.dataset.day));
    });
  }

  // A running timer counts up on the page once a second.
  tickClock() {
    clearInterval(this.clockTimer);
    const running = this.items.filter((i) => i.task.run);
    if (!running.length) return;
    this.clockTimer = setInterval(() => {
      if (!this.dayShown && !this.pageShown) { clearInterval(this.clockTimer); return; }
      for (const el of document.querySelectorAll('[data-timer]')) {
        const i = this.item(el.dataset.timer);
        if (i) el.textContent = clock(i.task, Date.now());
      }
    }, 1000);
  }
}
