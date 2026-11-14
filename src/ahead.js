// Weeks ahead: Today from furthest back. Six weeks as columns, a lane for
// each project on stage. A bar is a stretch of work (a step with a first and
// a last day), a diamond is a date to hit (amber: it can't move), and the top
// line weighs each week's planned hours against the hours you have. Bars and
// diamonds are ordinary task lines (tasks.js); nothing is copied.

import { popMenu, askText } from './menu.js';
import { getEntry, byKind, isTrashed } from './db.js';
import { areas, areaColor, editedAt, worldOf } from './library.js';
import { seatsFor, deskSettings } from './desk.js';
import { aheadPlan, addTask, setTask, moveTask, tickTask, renameTask, plainLine, parseEst, stepsHome, hours, addDays, dateOf } from './tasks.js';

export const WEEKS = 6;
const DAY = 864e5;
const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};
const long = (iso, opts) => dateOf(iso).toLocaleDateString('en-US', opts);
const md = (iso) => long(iso, { month: 'short', day: 'numeric' });
const isDay = (v) => /^\d{4}-\d\d-\d\d$/.test(String(v || ''));
const ownerWord = (o) => (o ? String(o).charAt(0).toUpperCase() + String(o).slice(1) : '');

// The lanes and the dates that aren't tasks. fetchDesk(sinceIso) → the
// Desk's { needs, updates } or null: with it the lanes are seated exactly as
// the Desk seats them. → { lanes: [{ id, title, color, faint }], dates }
export async function aheadSource(fetchDesk, now = Date.now()) {
  const [list, all, settings] = [await byKind('world'), await areas(), await deskSettings()];
  const areaById = new Map(all.map((a) => [a.id, a]));
  const worlds = list.filter((w) => !w.deleted && !isTrashed(w))
    .map((w) => ({ id: w.id, title: w.title, color: areaColor(areaById.get(w.area_id)), edited: editedAt(w), star: w.fields?.star || '' }));
  let data = null;
  try { data = await fetchDesk?.(new Date(now - 14 * DAY).toISOString()); } catch (e) { console.warn(e); }
  const updates = (data?.updates || []).map((u) => ({ ...u, at: u.at || Date.parse(u.created_at) })).sort((a, b) => a.at - b.at);
  const seats = seatsFor({ worlds, needs: data?.needs || [], updates, settings, now }).filter((s) => s.world && s.stage !== 'back');
  const lanes = [...seats.filter((s) => s.stage === 'on'), ...seats.filter((s) => s.stage === 'wings')]
    .map((s) => ({ id: s.world.id, title: s.world.title || 'Untitled', color: s.color, faint: s.stage !== 'on' }));
  // Shoot days are dates too.
  const ids = new Set(lanes.map((l) => l.id));
  const dates = [];
  for (const d of await byKind('shootday')) {
    if (d.deleted || !isDay(d.fields?.date)) continue;
    const piece = await getEntry(d.parent_id);
    if (!piece || piece.deleted || isTrashed(piece)) continue;
    const world = await worldOf(piece);
    if (!world || !ids.has(world.id)) continue;
    dates.push({ world: world.id, iso: d.fields.date, text: `Shoot day · ${piece.title || 'Untitled'}`, hard: false, go: { view: 'production', id: piece.id, day: d.id } });
  }
  return { lanes, dates };
}

// ---------- drawing ----------

// plan: the Plan (plan.js) whose sheet this draws into; it brings the tasks,
// the free hours, the switch and the hooks.
export function drawAhead(plan) {
  // Not under a bar that's being dragged: it draws when the drag ends.
  if (plan.aheadHeld) return;
  const today = plan.today;
  const src = plan.aheadSrc || { lanes: [], dates: [] };
  const model = aheadPlan(plan.items, { today, weeks: WEEKS, free: plan.free, lanes: src.lanes, dates: src.dates });
  // A project in the wings only gets a lane when something of its is in view.
  model.lanes = model.lanes.filter((l) => !l.faint || l.bars.length || l.dates.length || l.loose.length || plan.aheadAdd?.world === l.id);
  plan.ahead = model;
  const sheet = plan.sheet;
  const adding = plan.aheadAdd;
  const held = sheet.querySelector('.ah-add input')?.value ?? adding?.value ?? '';

  const head = make('header', 'pl-top');
  const left = make('div');
  left.append(make('div', 'pl-eyebrow', 'Six weeks'), make('h1', '', 'Weeks ahead'));
  const side = make('div', 'pl-side');
  if (plan.hooks.talk?.()) {
    const b = make('button', 'ghost-btn ah-talk', '✦ Plan it out with Claude');
    b.dataset.act = 'ahead-talk';
    b.title = 'Talk the weeks through with Claude, beside this (Alt + T)';
    side.append(b);
  }
  const pull = plan.pullButton();
  if (pull) side.append(pull);
  side.append(plan.switchRow('ahead'));
  head.append(left, side);

  const wrap = make('div', 'ah-wrap');
  const grid = make('div', 'ah');
  grid.style.setProperty('--weeks', String(WEEKS));
  grid.append(make('div', 'ah-corner'));
  model.weeks.forEach((w) => {
    const h = make('div', `ah-h${w.now ? ' now' : ''}${w.over ? ' over' : ''}`);
    const hrs = make('span', 'ah-hrs', `${hours(w.min)} h of ${hours(model.free)} h`);
    const track = make('span', 'pl-track');
    const fill = make('i', w.over ? 'over' : '');
    fill.style.width = `${Math.min(100, model.free ? (w.min / model.free) * 100 : 0)}%`;
    track.append(fill);
    const open = make('button', 'ah-week', md(w.iso));
    open.dataset.act = 'ahead-week';
    open.dataset.week = w.iso;
    open.title = w.now ? 'This week: open it day by day' : `The week of ${long(w.iso, { month: 'long', day: 'numeric' })}: open it day by day`;
    h.append(open, hrs, track);
    grid.append(h);
  });

  for (const lane of model.lanes) {
    const name = make('button', `ah-p${lane.faint ? ' faint' : ''}`);
    name.dataset.act = 'ahead-open';
    name.dataset.world = lane.id;
    name.title = lane.faint ? 'In the wings. Open the project’s page' : 'Open the project’s page';
    const dot = make('i', 'ah-dot');
    if (lane.color) dot.style.background = lane.color;
    name.append(dot, make('span', '', lane.title));
    const box = make('div', `ah-lane${lane.faint ? ' faint' : ''}`);
    box.dataset.world = lane.id;
    // Behind everything, a place to click in each week.
    const slots = make('div', 'ah-slots');
    model.weeks.forEach((w) => {
      const s = make('button', `ah-slot${w.now ? ' now' : ''}`);
      s.dataset.act = 'ahead-add';
      s.dataset.week = w.iso;
      s.setAttribute('aria-label', `Add to ${lane.title}, the week of ${long(w.iso, { month: 'long', day: 'numeric' })}`);
      s.append(make('span', '', '+'));
      slots.append(s);
    });
    const rows = make('div', 'ah-rows');
    for (const d of lane.dates) {
      const b = make('button', `ah-dia${d.hard ? ' hard' : ''}`);
      b.style.gridColumn = String(d.col);
      b.dataset.act = 'ahead-date';
      if (d.item) b.dataset.task = d.item.row.id;
      else b.dataset.go = JSON.stringify(d.go || null);
      b.title = `${long(d.iso, { weekday: 'long', month: 'long', day: 'numeric' })}${d.hard ? ' · this date can’t move' : ''}`;
      b.append(make('i'), make('b', '', `${long(d.iso, { weekday: 'short' })} ${dateOf(d.iso).getDate()}`), make('span', '', d.text));
      rows.append(b);
    }
    for (const bar of lane.bars) {
      const i = bar.item;
      const b = make('button', `ah-bar${bar.early ? ' early' : ''}${bar.late ? ' late' : ''}${i.mine ? '' : ' theirs'}`);
      b.style.gridColumn = `${bar.from} / ${bar.to + 1}`;
      b.dataset.act = 'ahead-bar';
      b.dataset.task = i.row.id;
      b.dataset.from = String(bar.from);
      b.dataset.to = String(bar.to);
      b.title = `${md(i.task.day)} to ${md(i.task.until)}`;
      b.append(make('span', 'ah-t', i.row.text || 'Untitled'));
      if (!i.mine) b.append(make('span', 'ah-own', ownerWord(i.task.owner)));
      if (!bar.late) { const grip = make('i', 'ah-grip'); grip.setAttribute('aria-hidden', 'true'); b.append(grip); }
      rows.append(b);
    }
    // Loose in a week: quiet, with no day.
    for (const m of lane.loose) {
      const b = make('button', 'ah-loose');
      b.style.gridColumn = String(m.col);
      b.dataset.act = 'ahead-loose';
      b.dataset.task = m.item.row.id;
      b.title = `Some day that week: ${m.text}`;
      b.append(make('span', '', m.text));
      rows.append(b);
    }
    if (adding && adding.world === lane.id) {
      const col = model.weeks.findIndex((w) => w.iso === adding.week) + 1;
      if (col > 0) {
        const f = make('div', 'ah-add');
        f.style.gridColumn = `${col} / ${Math.min(WEEKS, col + 1) + 1}`;
        const input = make('input');
        input.type = 'text';
        input.value = held;
        input.placeholder = adding.day ? `What’s on ${long(adding.day, { weekday: 'short', month: 'short', day: 'numeric' })}?` : 'What happens this week?';
        input.setAttribute('aria-label', adding.day ? `A date to hit in ${lane.title}` : `A stretch of work in ${lane.title}`);
        input.addEventListener('keydown', (e) => addKey(plan, e));
        input.addEventListener('blur', () => { if (plan.aheadAdd === adding && !input.value.trim()) { plan.aheadAdd = null; f.remove(); } });
        f.append(input);
        rows.append(f);
      }
    }
    box.append(slots, rows);
    grid.append(name, box);
  }
  wrap.append(grid);
  const parts = [head, wrap];
  if (!model.lanes.length) parts.push(make('p', 'pl-note', 'Nothing is on stage. A project gets a lane here once it’s on stage at the Desk.'));
  else {
    if (model.note) parts.push(make('p', 'pl-note ah-note', model.note));
    if (!model.lanes.some((l) => l.bars.length || l.dates.length || l.loose.length)) parts.push(make('p', 'pl-note', 'Click a week in a project’s lane to say what happens then.'));
  }
  sheet.replaceChildren(...parts);
  const input = sheet.querySelector('.ah-add input');
  if (input) { input.focus({ preventScroll: true }); input.setSelectionRange(input.value.length, input.value.length); }
}

// ---------- doing ----------

function addKey(plan, e) {
  const input = e.target;
  const adding = plan.aheadAdd;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); plan.aheadAdd = null; drawAhead(plan); return; }
  if (e.key !== 'Enter' || !adding) return;
  e.preventDefault();
  e.stopPropagation();
  const typed = input.value.trim();
  if (!typed) return;
  const lane = plan.ahead.lanes.find((l) => l.id === adding.world);
  plan.aheadAdd = null;
  input.value = '';
  // A date to hit may say how long it takes; a stretch is as long as its weeks.
  const { title, est } = adding.day ? parseEst(typed) : { title: typed, est: null };
  const home = stepsHome({ id: adding.world });
  const what = adding.day
    ? { text: title, day: adding.day, est, mark: 'date', order: plan.lastOrder(adding.day), home }
    : { text: title, day: adding.week, until: addDays(adding.week, 6), home };
  addTask(what).then((rows) => plan.wrote(rows)).then(() => {
    if (lane?.faint) plan.hooks.toast?.(`${lane.title} is in the wings: its lane shows while something of its is in these weeks`);
  });
}

// A click in the Weeks ahead sheet. → true when it was one of ours.
export function aheadClick(plan, act, el) {
  if (act === 'ahead-talk') { plan.hooks.talk?.()?.(); return true; }
  if (act === 'ahead-week') { plan.hooks.go({ view: 'plan', tab: 'week', ...(el.dataset.week === plan.ahead?.weeks[0].iso ? {} : { week: el.dataset.week }) }); return true; }
  if (act === 'ahead-open') { plan.hooks.go({ view: 'world', id: el.dataset.world }); return true; }
  if (act === 'ahead-add') {
    const world = el.closest('[data-world]').dataset.world;
    const week = el.dataset.week;
    const start = (day) => { plan.aheadAdd = { world, week, day, value: '' }; drawAhead(plan); };
    const first = week < plan.today ? plan.today : week;
    const days = [];
    for (let iso = first; iso <= addDays(week, 6); iso = addDays(iso, 1)) days.push({ label: long(iso, { weekday: 'long', month: 'short', day: 'numeric' }), run: () => start(iso) });
    popMenu(el, [
      { label: 'A stretch of work this week', run: () => start(null) },
      { label: 'A date to hit', sub: days }
    ]);
    return true;
  }
  if (act === 'ahead-date') {
    const i = el.dataset.task ? plan.item(el.dataset.task) : null;
    if (i) dateMenu(plan, i, el);
    else { const place = JSON.parse(el.dataset.go || 'null'); if (place) plan.hooks.go(place); }
    return true;
  }
  if (act === 'ahead-loose') {
    const i = plan.item(el.dataset.task);
    if (i) plan.menu(i, el);
    return true;
  }
  if (act === 'ahead-bar') {
    if (plan.aheadDragged) { plan.aheadDragged = false; return true; }
    const i = plan.item(el.dataset.task);
    if (i) barMenu(plan, i, el);
    return true;
  }
  return false;
}

const write = async (plan, row) => { if (row) await plan.wrote(row); };
const days = (a, b) => Math.round((dateOf(b) - dateOf(a)) / DAY);

async function rename(plan, i) {
  if (!plainLine(i.row)) return plan.hooks.openEntry(i.row.id);
  const v = await askText({ title: 'Its words', value: i.row.text || '', ok: 'Save' });
  if (v && String(v).trim() && String(v).trim() !== i.row.text) await write(plan, await renameTask(i.row.id, String(v)));
}

function barMenu(plan, i, anchor, at) {
  const t = i.task;
  const weeksLong = Math.floor(days(t.day, t.until) / 7) + 1;
  const items = [
    { label: 'Done', run: async () => write(plan, await tickTask(i.row.id, true)) },
    'sep',
    { label: 'A week earlier', run: async () => write(plan, await moveTask(i.row.id, addDays(t.day, -7))) },
    { label: 'A week later', run: async () => write(plan, await moveTask(i.row.id, addDays(t.day, 7))) },
    { label: 'A week longer', run: async () => write(plan, await setTask(i.row.id, { until: addDays(t.until, 7) })) },
    ...(weeksLong > 1 ? [{ label: 'A week shorter', run: async () => write(plan, await setTask(i.row.id, { until: addDays(t.until, -7) })) }] : []),
    { label: 'Pick the days…', run: async () => {
      const a = await askText({ title: 'Its first day', type: 'date', value: t.day, ok: 'Next' });
      if (!isDay(a)) return;
      const b = await askText({ title: 'Its last day', type: 'date', value: t.until < a ? a : t.until, ok: 'Save' });
      if (!isDay(b) || b < a) return;
      await write(plan, await setTask(i.row.id, { day: String(a), until: String(b) }));
    } },
    'sep',
    { label: plainLine(i.row) ? 'Change the words…' : 'Change the words where it’s written', run: () => rename(plan, i) },
    { label: 'Open it where it’s written', run: () => plan.hooks.openEntry(i.row.id) },
    { label: 'A plain step again', run: async () => { await write(plan, await setTask(i.row.id, { until: null })); plan.hooks.toast?.(`It’s a step on ${md(t.day)} now, still where it was written`); } }
  ];
  popMenu(anchor, items, at);
}

function dateMenu(plan, i, anchor, at) {
  const t = i.task;
  const hard = t.mark === 'hard';
  const items = [
    { label: 'Done', run: async () => write(plan, await tickTask(i.row.id, true)) },
    'sep',
    { label: 'This date can’t move', current: hard, run: async () => write(plan, await setTask(i.row.id, { mark: hard ? 'date' : 'hard' })) }
  ];
  if (!hard) {
    items.push(
      ...(addDays(t.day, -7) >= plan.today ? [{ label: 'A week earlier', run: async () => write(plan, await moveTask(i.row.id, addDays(t.day, -7))) }] : []),
      { label: 'A week later', run: async () => write(plan, await moveTask(i.row.id, addDays(t.day, 7))) },
      { label: 'Pick the day…', run: async () => { const v = await askText({ title: 'Which day?', type: 'date', value: t.day, ok: 'Move' }); if (isDay(v)) await write(plan, await moveTask(i.row.id, String(v))); } }
    );
  }
  items.push('sep',
    { label: plainLine(i.row) ? 'Change the words…' : 'Change the words where it’s written', run: () => rename(plan, i) },
    { label: 'Open it where it’s written', run: () => plan.hooks.openEntry(i.row.id) },
    { label: 'Not a date to hit any more', run: async () => { await write(plan, await setTask(i.row.id, { mark: null })); plan.hooks.toast?.('It’s a plain step again, still on its day'); } }
  );
  popMenu(anchor, items, at);
}

// Right-click on a bar or a diamond: the same menu, where the pointer is.
export function aheadContext(plan, e) {
  const el = e.target.closest?.('.ah-bar, .ah-dia[data-task]');
  if (!el) return false;
  const i = plan.item(el.dataset.task);
  if (!i) return false;
  e.preventDefault();
  (el.classList.contains('ah-bar') ? barMenu : dateMenu)(plan, i, el, { left: e.clientX, top: e.clientY });
  return true;
}

// With a mouse: drag a bar to another week, or its right edge to make it
// longer or shorter. Whole weeks; the menu does the same by keyboard or touch.
export function aheadDrags(plan, root) {
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const bar = e.target.closest?.('.ah-bar');
    if (!bar || !root.contains(bar)) return;
    const lane = bar.closest('.ah-rows');
    const col = lane.getBoundingClientRect().width / WEEKS;
    drag = { bar, x: e.clientX, col, grip: !!e.target.closest('.ah-grip'), from: Number(bar.dataset.from), to: Number(bar.dataset.to), by: 0, moved: false, id: e.pointerId };
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 6) return;
    if (!drag.moved) { drag.moved = true; plan.aheadHeld = true; drag.bar.classList.add('dragging'); try { drag.bar.setPointerCapture(drag.id); } catch { /* gone */ } }
    let by = Math.round(dx / drag.col);
    // Stay inside the six weeks; a bar can't end before it starts.
    by = drag.grip ? Math.max(drag.from - drag.to, Math.min(WEEKS - drag.to, by)) : Math.max(1 - drag.from, Math.min(WEEKS - drag.to, by));
    if (by === drag.by) return;
    drag.by = by;
    drag.bar.style.gridColumn = drag.grip ? `${drag.from} / ${drag.to + by + 1}` : `${drag.from + by} / ${drag.to + by + 1}`;
  });
  const end = async (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    d.bar.classList.remove('dragging');
    if (!d.moved) return;
    plan.aheadHeld = false;
    // The click that follows a drag isn't a click on the bar.
    plan.aheadDragged = true;
    setTimeout(() => { plan.aheadDragged = false; }, 0);
    const i = plan.item(d.bar.dataset.task);
    if (!i || !d.by || e.type === 'pointercancel') { drawAhead(plan); return; }
    const row = d.grip ? await setTask(i.row.id, { until: addDays(i.task.until, d.by * 7) }) : await moveTask(i.row.id, addDays(i.task.day, d.by * 7));
    await write(plan, row);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
}
