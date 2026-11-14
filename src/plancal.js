// The day plan's Calendar: the day hour by hour, arranged by hand. A task is
// on it only where you put it (task.on = { day, at: minutes from midnight },
// task.len in minutes); nothing is worked out for you, time estimates aren't
// used, and the list's order and the calendar never move each other.
// Everything snaps to 15 minutes. Drag a block to move it, its bottom edge to
// make it longer or shorter, up past the top to take it off; click an empty
// spot to write a new task there. A phone holds a moment before dragging, so
// the page still scrolls.

import { setTask, addTask, span, minutesOf } from './tasks.js';

export const SNAP = 15;
const PX = 1; // pixels a minute: 60 an hour
const GUTTER = 52;
const HOLD = 320;

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};
export const hm = (min) => {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
};
const snap = (min) => Math.round(min / SNAP) * SNAP;
const placed = (i, day) => i.task.on && i.task.on.day === day && Number.isFinite(i.task.on.at);
const lenOf = (i) => Math.max(SNAP, Number(i.task.len) || 30);

// Side by side where things overlap, as a calendar does.
function lanes(list) {
  const sorted = [...list].sort((a, b) => a.s - b.s || b.e - a.e);
  let group = [];
  let end = -1;
  const flush = () => {
    const cols = [];
    for (const x of group) {
      let c = cols.findIndex((e) => e <= x.s);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = x.e;
      x.col = c;
    }
    for (const x of group) x.cols = cols.length;
    group = [];
  };
  for (const x of sorted) {
    if (group.length && x.s >= end) { flush(); end = -1; }
    group.push(x);
    end = Math.max(end, x.e);
  }
  flush();
}

// The calendar for `day`: tasks (open, not repeats' later days) and timed events.
export function drawCalendar(plan, day, tasks, events) {
  const today = plan.today;
  const open = tasks.filter((i) => !i.ghost && !i.row.fields?.done);
  const on = open.filter((i) => placed(i, day));
  const off = open.filter((i) => !placed(i, day));
  const evs = events.filter((e) => !e.allDay).map((e) => {
    const s = minutesOf(e.start);
    const end = new Date(e.end).toDateString() !== new Date(e.start).toDateString() ? 24 * 60 : minutesOf(e.end);
    return { e, s, e2: Math.max(s + SNAP, end) };
  });
  const starts = [...on.map((i) => i.task.on.at), ...evs.map((x) => x.s)];
  const ends = [...on.map((i) => i.task.on.at + lenOf(i)), ...evs.map((x) => x.e2)];
  const from = Math.floor(Math.min(7 * 60, ...starts) / 60) * 60;
  const to = Math.min(24 * 60, Math.ceil(Math.max(Math.round(plan.dayEnd * 60), ...ends) / 60) * 60);

  const box = make('div', 'dc');
  box.dataset.day = day;
  const tray = make('div', 'dc-tray');
  tray.hidden = !off.length;
  // On a phone they wait below the hours, folded into one line.
  const small = matchMedia('(hover: none)').matches;
  if (small) {
    const t = make('button', 'dc-tray-l dc-tray-fold', `${plan.calTrayOpen ? '▾' : '▸'} ${off.length} not on the calendar`);
    t.setAttribute('aria-expanded', String(!!plan.calTrayOpen));
    t.addEventListener('click', (e) => { e.stopPropagation(); plan.calTrayOpen = !plan.calTrayOpen; plan.redraw(); });
    tray.append(t);
    tray.classList.toggle('folded', !plan.calTrayOpen);
  } else tray.append(make('span', 'dc-tray-l', 'Not on the calendar:'));
  for (const i of off) {
    const c = make('button', 'dc-chip', i.row.text || 'Untitled');
    c.dataset.task = i.row.id;
    c.title = 'Click to put it in the next free half hour, or drag it to a time';
    tray.append(c);
  }
  const grid = make('div', 'dc-grid');
  grid.style.height = `${(to - from) * PX}px`;
  grid.dataset.from = String(from);
  grid.dataset.to = String(to);
  grid.setAttribute('aria-label', 'Your day, hour by hour: click an empty spot to add a task there');
  for (let m = from; m <= to; m += 60) {
    const line = make('div', 'dc-hour');
    line.style.top = `${(m - from) * PX}px`;
    if (m < to) line.append(make('span', '', hm(m)));
    grid.append(line);
  }
  const items = [
    ...evs.map((x) => ({ s: x.s, e: x.e2, ev: x.e })),
    ...on.map((i) => ({ s: i.task.on.at, e: i.task.on.at + lenOf(i), i }))
  ];
  lanes(items);
  const place = (el, x) => {
    // Under 45 minutes there's room for one line: the words, then the time.
    el.classList.toggle('short', x.e - x.s < 45);
    el.style.top = `${(x.s - from) * PX}px`;
    el.style.height = `${Math.max(SNAP, x.e - x.s) * PX - 2}px`;
    el.style.left = `calc(${GUTTER}px + (100% - ${GUTTER + 4}px) * ${x.col / x.cols})`;
    el.style.width = `calc((100% - ${GUTTER + 4}px) / ${x.cols} - 4px)`;
  };
  for (const x of items) {
    if (x.ev) {
      const el = make('div', `dc-ev${x.ev.end < Date.now() ? ' past' : ''}`);
      el.dataset.event = x.ev.id;
      el.append(make('span', 'dc-w', x.ev.title), make('span', 'dc-t', `${hm(x.s)} · ${span(x.e - x.s)}`));
      el.title = `${x.ev.title} · ${hm(x.s)} to ${hm(x.e)}${x.ev.calendar ? ` · ${x.ev.calendar}` : ''}`;
      place(el, x);
      grid.append(el);
      continue;
    }
    const el = make('div', `dc-blk${x.i.task.run ? ' timing' : ''}`);
    el.dataset.task = x.i.row.id;
    el.dataset.at = String(x.s);
    el.dataset.len = String(x.e - x.s);
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `${x.i.row.text || 'Untitled'}, ${hm(x.s)} to ${hm(x.e)}: click to open it, drag to move it`);
    el.append(make('span', 'dc-w', x.i.row.text || 'Untitled'), make('span', 'dc-t', `${hm(x.s)} · ${span(x.e - x.s)}`));
    const edge = make('span', 'dc-edge');
    edge.title = 'Drag to make it longer or shorter';
    el.append(edge);
    place(el, x);
    grid.append(el);
  }
  if (day === today) {
    const now = minutesOf(Date.now());
    if (now >= from && now <= to) {
      const line = make('div', 'dc-now');
      line.style.top = `${(now - from) * PX}px`;
      grid.append(line);
    }
  }
  if (small) box.append(grid, tray); else box.append(tray, grid);
  wire(plan, box, grid, day, { from, to, on, evs });
  return box;
}

// The next free half hour (from now on today, else from the top) that `len` fits in.
function nextFree(plan, day, { from, to, on, evs }, len) {
  const taken = [...on.map((i) => [i.task.on.at, i.task.on.at + lenOf(i)]), ...evs.map((x) => [x.s, x.e2])];
  let s = day === plan.today ? Math.ceil(minutesOf(Date.now()) / 30) * 30 : Math.max(from, 9 * 60);
  for (; s + len <= to; s += 30) if (!taken.some(([a, b]) => a < s + len && b > s)) return s;
  return Math.max(from, Math.min(to - len, s - 30));
}

function wire(plan, box, grid, day, ctx) {
  const { from, to } = ctx;
  const at = (clientY) => from + (clientY - grid.getBoundingClientRect().top) / PX;
  const save = async (id, patch) => plan.wrote(await setTask(id, patch));

  // A click on a block opens it; on a chip, it goes in the next free half hour;
  // on an empty spot, a new task is written there.
  box.addEventListener('click', (e) => {
    if (plan.dcDragged) return;
    const blk = e.target.closest('.dc-blk');
    if (blk) { const i = plan.item(blk.dataset.task); if (i) plan.open(i); return; }
    const chip = e.target.closest('.dc-chip');
    if (chip) {
      const i = plan.item(chip.dataset.task);
      if (!i) return;
      const len = lenOf(i);
      return save(i.row.id, { on: { day, at: nextFree(plan, day, ctx, len) }, len });
    }
    if (e.target === grid || e.target.classList.contains('dc-hour')) write(Math.max(from, Math.min(to - SNAP, Math.floor(at(e.clientY) / SNAP) * SNAP)));
  });
  box.addEventListener('keydown', (e) => {
    const blk = e.target.closest?.('.dc-blk');
    if (blk && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const i = plan.item(blk.dataset.task); if (i) plan.open(i); }
  });

  const write = (min) => {
    grid.querySelector('.dc-new')?.remove();
    const row = make('div', 'dc-new');
    row.style.top = `${(min - from) * PX}px`;
    row.style.height = `${30 * PX - 2}px`;
    const input = make('input');
    input.type = 'text';
    input.placeholder = `A task at ${hm(min)}`;
    input.autocomplete = 'off';
    input.setAttribute('enterkeyhint', 'done');
    input.setAttribute('aria-label', `A new task at ${hm(min)}`);
    row.append(input);
    grid.append(row);
    plan.renaming = true;
    let over = false;
    const finish = async (keep) => {
      if (over) return;
      over = true;
      plan.renaming = false;
      const text = input.value.trim();
      row.remove();
      if (!keep || !text) return plan.redraw();
      // On today's list too, at the end; on the calendar where it was written.
      const rows = await addTask({ text, day, order: plan.lastOrder(day) });
      const line = rows.at(-1);
      await plan.wrote([...rows, await setTask(line.id, { on: { day, at: min }, len: 30 })]);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.focus();
  };

  // ---- dragging: a block (move, or its edge to resize) or a chip onto the grid ----
  let d = null;
  const begin = (el, x, y, kind) => {
    const i = plan.item(el.dataset.task);
    if (!i) return null;
    return { el, i, kind, x0: x, y0: y, at0: Number(el.dataset.at) || 0, len0: Number(el.dataset.len) || lenOf(i), moved: false, ghost: null, at: null, len: null, off: false };
  };
  const show = (x, y) => {
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(x - d.x0, y - d.y0) < 5) return;
      d.moved = true;
      plan.renaming = true;
      d.el.classList.add('dragging');
      document.documentElement.classList.add('dc-dragging');
    }
    const top = grid.getBoundingClientRect().top;
    if (d.kind === 'size') {
      d.len = Math.max(SNAP, snap(d.len0 + (y - d.y0) / PX));
      d.len = Math.min(d.len, to - d.at0);
      d.el.style.height = `${d.len * PX - 2}px`;
      d.el.querySelector('.dc-t').textContent = `${hm(d.at0)} · ${span(d.len)}`;
      return;
    }
    if (d.kind === 'move') {
      d.off = y < top - 24;
      d.el.classList.toggle('dc-off', d.off);
      d.at = Math.max(from, Math.min(to - d.len0, snap(d.at0 + (y - d.y0) / PX)));
      d.el.style.top = `${(d.at - from) * PX}px`;
      d.el.querySelector('.dc-t').textContent = d.off ? 'Take it off the calendar' : `${hm(d.at)} · ${span(d.len0)}`;
      return;
    }
    // A chip: a block follows the pointer over the grid.
    const r = grid.getBoundingClientRect();
    const over = y >= r.top && y <= r.bottom && x >= r.left && x <= r.right;
    if (!d.ghost) {
      d.ghost = make('div', 'dc-blk preview');
      d.ghost.append(make('span', 'dc-w', d.i.row.text || 'Untitled'), make('span', 'dc-t', ''));
      d.ghost.style.left = `${GUTTER}px`;
      d.ghost.style.width = `calc(100% - ${GUTTER + 8}px)`;
      d.ghost.style.height = `${d.len0 * PX - 2}px`;
      grid.append(d.ghost);
    }
    d.ghost.hidden = !over;
    if (!over) { d.at = null; return; }
    d.at = Math.max(from, Math.min(to - d.len0, Math.floor(at(y) / SNAP) * SNAP));
    d.ghost.style.top = `${(d.at - from) * PX}px`;
    d.ghost.querySelector('.dc-t').textContent = `${hm(d.at)} · ${span(d.len0)}`;
  };
  const finish = async (cancel) => {
    const x = d;
    d = null;
    if (!x) return;
    document.documentElement.classList.remove('dc-dragging');
    x.el.classList.remove('dragging', 'dc-held');
    x.ghost?.remove();
    if (!x.moved) return;
    plan.renaming = false;
    // The click that follows a drag isn't a click on what was dragged.
    plan.dcDragged = true;
    setTimeout(() => { plan.dcDragged = false; }, 0);
    const id = x.i.row.id;
    if (cancel) return plan.redraw();
    if (x.kind === 'size') return x.len !== x.len0 ? save(id, { len: x.len }) : plan.redraw();
    if (x.kind === 'move') return x.off ? save(id, { on: null }) : x.at !== x.at0 ? save(id, { on: { day, at: x.at } }) : plan.redraw();
    return x.at != null ? save(id, { on: { day, at: x.at }, len: x.len0 }) : plan.redraw();
  };
  const target = (e) => {
    const blk = e.target.closest?.('.dc-blk:not(.preview)');
    if (blk) return { el: blk, kind: e.target.closest('.dc-edge') ? 'size' : 'move' };
    const chip = e.target.closest?.('.dc-chip');
    return chip ? { el: chip, kind: 'chip' } : null;
  };

  // With a mouse: straight away.
  box.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const t = target(e);
    if (!t) return;
    d = begin(t.el, e.clientX, e.clientY, t.kind);
    if (!d) return;
    if (t.kind !== 'chip') e.preventDefault();
    const move = (ev) => show(ev.clientX, ev.clientY);
    const up = (ev) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); finish(ev.type === 'pointercancel'); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  // On a touch screen: hold a moment first; a quick swipe still scrolls.
  let hold = null;
  box.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = target(e);
    if (!t) return;
    const p = e.touches[0];
    clearTimeout(hold?.timer);
    hold = { t, x: p.clientX, y: p.clientY, armed: false };
    hold.timer = setTimeout(() => {
      if (!hold) return;
      hold.armed = true;
      d = begin(t.el, hold.x, hold.y, t.kind);
      t.el.classList.add('dc-held');
      navigator.vibrate?.(10);
    }, HOLD);
  }, { passive: true });
  box.addEventListener('touchmove', (e) => {
    if (!hold) return;
    const p = e.touches[0];
    if (!hold.armed) {
      if (Math.hypot(p.clientX - hold.x, p.clientY - hold.y) > 8) { clearTimeout(hold.timer); hold = null; }
      return;
    }
    e.preventDefault();
    show(p.clientX, p.clientY);
  }, { passive: false });
  const lift = (cancel) => () => {
    if (!hold) return;
    clearTimeout(hold.timer);
    const was = hold.armed;
    hold = null;
    if (was) finish(cancel);
  };
  box.addEventListener('touchend', lift(false));
  box.addEventListener('touchcancel', lift(true));
  // Holding still shouldn't bring up the browser's own menu.
  // (A right-click on a block or a chip still brings up the task's menu.)
  box.addEventListener('contextmenu', (e) => { if (hold?.armed) { e.preventDefault(); e.stopPropagation(); } });
}
