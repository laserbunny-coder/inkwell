// The day plan's Calendar: the day hour by hour, arranged by hand. A task is
// on it only where you put it (task.on = { day, at: minutes from midnight },
// task.len in minutes); nothing is worked out for you, time estimates aren't
// used, and the list's order and the calendar never move each other.
// Everything snaps to 15 minutes. Drag a block to move it, the handle on its
// bottom edge to make it longer or shorter, up past the top to take it off;
// click an empty spot to write a new task there. A phone holds a moment before
// dragging a block, so the page still scrolls; the handle moves at once.
// What has no time yet waits in the Unscheduled sheet, to tap or drag in.
// Pinch (or Ctrl + scroll) zooms the hours; the zoom is kept on
// this device.

import { setTask, addTask, span, minutesOf } from './tasks.js';
import { isCompact } from './device.js';
import { make } from './dom.js';

export const SNAP = 15;
const GUTTER = 52;
const HOLD = 320;
// Pixels a minute: 1 is 60 an hour. 'fit' fits the day's hours on the screen.
const ZMIN = 0.3;
const ZMAX = 4;
const clampZ = (z) => Math.max(ZMIN, Math.min(ZMAX, z));
const readZoom = () => { try { const v = localStorage.getItem('calHours'); return v === 'fit' ? 'fit' : clampZ(Number(v) || 1); } catch { return 1; } };
const keepZoom = (z) => { try { localStorage.setItem('calHours', String(z)); } catch { /* private window */ } };
// A length on the grid, in minutes, at the grid's zoom (--px).
const Y = (min, less = 0) => `calc(var(--px, 1) * ${min}px${less ? ` - ${less}px` : ''})`;
const phoneish = isCompact;
// The phone's bar at the bottom: the sheet sits on it, and drags scroll above it.
const barH = () => {
  const bar = document.querySelector('.placebar');
  const r = bar?.getBoundingClientRect();
  // (It's fixed to the screen, so it has no offsetParent: look at where it is.)
  return phoneish() && r && r.height && r.top < innerHeight && getComputedStyle(bar).visibility !== 'hidden' ? Math.max(0, Math.round(innerHeight - r.top)) : 0;
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
  const small = phoneish();
  if (!off.length) plan.calSheetOpen = false;
  // The bar: Unscheduled (what has no time yet).
  const bar = make('div', 'dc-bar');
  const un = make('button', 'dc-unsched', `Unscheduled · ${off.length}`);
  un.hidden = !off.length;
  un.setAttribute('aria-expanded', String(!!plan.calSheetOpen));
  un.title = 'Tasks for today with no time yet: tap one, or drag it onto a time';
  un.addEventListener('click', (e) => { e.stopPropagation(); plan.calSheetOpen = !plan.calSheetOpen; plan.redraw(); });
  bar.append(un);
  // The sheet: one line each, tap for the next free half hour, or drag onto a time.
  const sheet = make('div', 'dc-sheet');
  sheet.hidden = !plan.calSheetOpen;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Unscheduled: tasks for today with no time yet');
  const sh = make('div', 'dc-sh');
  sh.append(make('span', 'dc-sh-t', 'Unscheduled'), make('span', 'dc-sh-n', String(off.length)));
  const x = make('button', 'dc-sh-x', '×');
  x.title = 'Close (Esc)';
  x.setAttribute('aria-label', 'Close Unscheduled');
  x.addEventListener('click', (e) => { e.stopPropagation(); plan.calSheetOpen = false; plan.redraw(); });
  sh.append(x);
  const tip = make('p', 'dc-sh-tip', small ? 'Tap one for the next free half hour, or hold it and slide it onto a time.' : 'Click one for the next free half hour, or drag it onto a time.');
  const rows = make('div', 'dc-rows');
  for (const i of off) {
    const c = make('button', 'dc-chip', i.row.text || 'Untitled');
    c.dataset.task = i.row.id;
    c.title = 'Click to put it in the next free half hour, or drag it to a time';
    rows.append(c);
  }
  sheet.append(make('div', 'dc-sh-grab'), sh, tip, rows);
  sheet.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); plan.calSheetOpen = false; plan.redraw(); } });
  const grid = make('div', 'dc-grid');
  grid.style.height = Y(to - from);
  grid.dataset.from = String(from);
  grid.dataset.to = String(to);
  grid.setAttribute('aria-label', 'Your day, hour by hour: click an empty spot to add a task there');
  for (let m = from; m <= to; m += 60) {
    const line = make('div', 'dc-hour');
    line.style.top = Y(m - from);
    if (m < to) line.append(make('span', '', hm(m)));
    grid.append(line);
  }
  const items = [
    ...evs.map((x) => ({ s: x.s, e: x.e2, ev: x.e })),
    ...on.map((i) => ({ s: i.task.on.at, e: i.task.on.at + lenOf(i), i }))
  ];
  lanes(items);
  const place = (el, x) => {
    el.dataset.len = String(x.e - x.s);
    el.style.top = Y(x.s - from);
    el.style.height = Y(Math.max(SNAP, x.e - x.s), 2);
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
    el.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown Alt+Shift+ArrowUp Alt+Shift+ArrowDown');
    el.append(make('span', 'dc-w', x.i.row.text || 'Untitled'), make('span', 'dc-t', `${hm(x.s)} · ${span(x.e - x.s)}`));
    place(el, x);
    // The handle on its bottom edge: drag it to make the block longer or shorter.
    const handle = make('div', 'dc-handle');
    handle.dataset.task = x.i.row.id;
    handle.title = 'Drag to make it longer or shorter (Alt + Shift + Up or Down)';
    handle.setAttribute('aria-hidden', 'true');
    handle.style.top = Y(x.e - from, 5);
    handle.style.left = el.style.left;
    handle.style.width = el.style.width;
    grid.append(el, handle);
  }
  if (day === today) {
    const now = minutesOf(Date.now());
    if (now >= from && now <= to) {
      const line = make('div', 'dc-now');
      line.style.top = Y(now - from);
      grid.append(line);
    }
  }
  box.append(bar, grid, sheet);
  setZoom(grid, plan.dcZoom ?? (plan.dcZoom = readZoom()), box);
  // 'fit' needs the grid on the screen to measure.
  sheet.style.setProperty('--dc-bar', `${barH()}px`);
  if (!sheet.hidden) requestAnimationFrame(() => sheet.style.setProperty('--dc-bar', `${barH()}px`));
  if (plan.dcZoom === 'fit') requestAnimationFrame(() => { if (grid.isConnected) setZoom(grid, 'fit', box); });
  // A block moved with the keys keeps the focus through the redraws that follow
  // (the save, then sync): the block focused now, or the one just moved.
  const was = document.activeElement?.classList?.contains('dc-blk') ? document.activeElement.dataset.task : null;
  if (was) plan.dcFocus = { id: was, until: Date.now() + 1500 };
  if (plan.dcFocus && plan.dcFocus.until > Date.now()) {
    const want = plan.dcFocus;
    requestAnimationFrame(() => {
      const el = grid.isConnected && grid.querySelector(`.dc-blk[data-task="${CSS.escape(want.id)}"]`);
      if (el && document.activeElement !== el && (document.activeElement === document.body || !document.activeElement || document.activeElement.closest?.('.dc'))) el.focus();
    });
  }
  wire(plan, box, grid, day, { from, to, on, evs });
  return box;
}

// The zoom, in pixels a minute: 'fit' fits from the grid's top to the bottom of the screen.
function fitPx(grid) {
  const span = Number(grid.dataset.to) - Number(grid.dataset.from);
  const r = grid.getBoundingClientRect();
  const bar = barH();
  let room = innerHeight - bar - Math.max(0, r.top) - 16;
  if (room < 240) room = innerHeight * 0.7;
  return clampZ(room / Math.max(60, span));
}
const pxOf = (grid) => parseFloat(grid.style.getPropertyValue('--px')) || 1;
function setZoom(grid, z, box = grid.parentElement) {
  const px = z === 'fit' ? fitPx(grid) : clampZ(z);
  grid.style.setProperty('--px', String(Math.round(px * 1000) / 1000));
  // Under 45 pixels there's room for one line: the words, then the time; under 20, just the words.
  for (const el of grid.querySelectorAll('.dc-blk, .dc-ev')) {
    const h = (Number(el.dataset.len) || 30) * px;
    el.classList.toggle('short', h < 45);
    el.classList.toggle('tiny', h < 20);
  }
  grid.classList.toggle('dc-tight', px < 0.55);
  return px;
}
// What scrolls the calendar: the nearest scrolling box, else the page.
function scroller(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement || document.documentElement;
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
  const at = (clientY) => from + (clientY - grid.getBoundingClientRect().top) / pxOf(grid);
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
    // Alt + Up or Down moves it 15 minutes; with Shift, makes it 15 minutes shorter or longer.
    if (blk && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      const step = e.key === 'ArrowUp' ? -SNAP : SNAP;
      const at0 = Number(blk.dataset.at);
      const len0 = Number(blk.dataset.len);
      plan.dcFocus = { id: blk.dataset.task, until: Date.now() + 1500 };
      if (e.shiftKey) { const len = Math.max(SNAP, Math.min(to - at0, len0 + step)); if (len !== len0) save(blk.dataset.task, { len }); }
      else { const a = Math.max(from, Math.min(to - len0, at0 + step)); if (a !== at0) save(blk.dataset.task, { on: { day, at: a } }); }
    }
  });
  // Ctrl + scroll (and a touchpad's pinch) zooms the hours, keeping the time under the pointer still.
  const zoomAt = (px, clientY) => {
    const m = at(clientY);
    plan.dcZoom = clampZ(px);
    const got = setZoom(grid, plan.dcZoom, box);
    const now = grid.getBoundingClientRect().top + (m - from) * got;
    scroller(grid).scrollBy(0, now - clientY);
  };
  grid.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomAt(pxOf(grid) * Math.exp(-e.deltaY * 0.0025), e.clientY);
    clearTimeout(plan.dcZoomKeep);
    plan.dcZoomKeep = setTimeout(() => keepZoom(plan.dcZoom), 300);
  }, { passive: false });

  const write = (min) => {
    grid.querySelector('.dc-new')?.remove();
    const row = make('div', 'dc-new');
    row.style.top = Y(min - from);
    row.style.height = Y(30, 2);
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
    const handle = kind === 'size' ? grid.querySelector(`.dc-handle[data-task="${CSS.escape(el.dataset.task)}"]`) : null;
    return { el, i, kind, handle, x0: x, y0: y, x, y, at0: Number(el.dataset.at) || 0, len0: Number(el.dataset.len) || lenOf(i), moved: false, ghost: null, at: null, len: null, off: false };
  };
  // Near the top or bottom of the screen while dragging, the calendar scrolls.
  const edgeScroll = () => {
    if (!d?.moved) return;
    const bar = barH();
    const low = innerHeight - bar - 48;
    const dy = d.y > low ? Math.min(18, (d.y - low) / 3 + 4) : d.y < 56 && d.kind !== 'move' ? -Math.min(18, (56 - d.y) / 3 + 4) : 0;
    if (dy) { const sc = scroller(grid); const before = sc.scrollTop; sc.scrollBy(0, dy); if (sc.scrollTop !== before) show(d.x, d.y); }
  };
  const show = (x, y) => {
    if (!d) return;
    d.x = x;
    d.y = y;
    if (!d.moved) {
      if (Math.hypot(x - d.x0, y - d.y0) < 5) return;
      d.moved = true;
      plan.renaming = true;
      d.el.classList.add('dragging');
      d.handle?.classList.add('active');
      document.documentElement.classList.add('dc-dragging');
      // Dragged out of Unscheduled: the sheet slips down out of the way.
      if (d.kind === 'chip') box.querySelector('.dc-sheet')?.classList.add('dc-sheet-low');
      d.scroll = setInterval(edgeScroll, 30);
      d.top0 = grid.getBoundingClientRect().top;
    }
    const px = pxOf(grid);
    const top = grid.getBoundingClientRect().top;
    // Scrolled while dragging: count from where the grid is now.
    const dy = y - d.y0 + (d.top0 - top);
    if (d.kind === 'size') {
      d.len = Math.max(SNAP, snap(d.len0 + dy / px));
      d.len = Math.min(d.len, to - d.at0);
      d.el.style.height = Y(d.len, 2);
      d.el.dataset.len = String(d.len);
      if (d.handle) d.handle.style.top = Y(d.at0 + d.len - from, 5);
      d.el.querySelector('.dc-t').textContent = `${hm(d.at0)} · ${span(d.len)}`;
      return;
    }
    if (d.kind === 'move') {
      d.off = y < top - 24;
      d.el.classList.toggle('dc-off', d.off);
      d.at = Math.max(from, Math.min(to - d.len0, snap(d.at0 + dy / px)));
      d.el.style.top = Y(d.at - from);
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
      d.ghost.style.height = Y(d.len0, 2);
      d.ghost.classList.toggle('short', d.len0 * pxOf(grid) < 45);
      d.ghost.classList.toggle('tiny', d.len0 * pxOf(grid) < 20);
      grid.append(d.ghost);
    }
    d.ghost.hidden = !over;
    if (!over) { d.at = null; return; }
    d.at = Math.max(from, Math.min(to - d.len0, Math.floor(at(y) / SNAP) * SNAP));
    d.ghost.style.top = Y(d.at - from);
    d.ghost.querySelector('.dc-t').textContent = `${hm(d.at)} · ${span(d.len0)}`;
  };
  const finish = async (cancel) => {
    const x = d;
    d = null;
    if (!x) return;
    document.documentElement.classList.remove('dc-dragging');
    x.el.classList.remove('dragging', 'dc-held');
    x.handle?.classList.remove('active');
    box.querySelector('.dc-sheet')?.classList.remove('dc-sheet-low');
    clearInterval(x.scroll);
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
    const h = e.target.closest?.('.dc-handle');
    if (h) { const b = grid.querySelector(`.dc-blk[data-task="${CSS.escape(h.dataset.task)}"]`); return b ? { el: b, kind: 'size' } : null; }
    const blk = e.target.closest?.('.dc-blk:not(.preview)');
    if (blk) return { el: blk, kind: 'move' };
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
  let pinch = null;
  const two = (e) => {
    const [a, b] = [e.touches[0], e.touches[1]];
    return { dist: Math.max(24, Math.abs(a.clientY - b.clientY), Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) * 0.6), mid: (a.clientY + b.clientY) / 2 };
  };
  box.addEventListener('touchstart', (e) => {
    // Two fingers on the hours: pinch to zoom.
    if (e.touches.length === 2 && grid.contains(e.target)) {
      if (hold) { clearTimeout(hold.timer); const was = hold.armed; hold = null; if (was) finish(true); }
      const g = two(e);
      pinch = { d0: g.dist, px0: pxOf(grid) };
      return;
    }
    if (e.touches.length !== 1) return;
    const t = target(e);
    if (!t) return;
    const p = e.touches[0];
    clearTimeout(hold?.timer);
    // The handle needs no hold: it is only for making the block longer or shorter.
    if (t.kind === 'size') {
      hold = { t, x: p.clientX, y: p.clientY, armed: true };
      d = begin(t.el, p.clientX, p.clientY, 'size');
      return;
    }
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
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const g = two(e);
      zoomAt(pinch.px0 * (g.dist / pinch.d0), g.mid);
      return;
    }
    if (!hold) return;
    const p = e.touches[0];
    if (!hold.armed) {
      if (Math.hypot(p.clientX - hold.x, p.clientY - hold.y) > 8) { clearTimeout(hold.timer); hold = null; }
      return;
    }
    e.preventDefault();
    show(p.clientX, p.clientY);
  }, { passive: false });
  const lift = (cancel) => (e) => {
    if (pinch) { if (!e.touches?.length) { pinch = null; keepZoom(plan.dcZoom); } return; }
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
