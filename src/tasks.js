// Tasks. A task is an ordinary line with a few task fields beside its words
// (fields.task): the day it's planned for, how long you think it takes, when
// it was done and how long it really took. It lives wherever it was written
// (a project page, a daily page, the Tasks page for ones added straight to a
// plan); the plan gathers tasks by day. Nothing is copied.
//
// fields.task = { v: 1, day: 'YYYY-MM-DD' | null, est: minutes | null,
//   done_at: ms | null, actual: minutes | null, log: [[start, end], …],
//   run: ms | null (the timer is going since then), order: number, owner }
// A line's own "done" (fields.done) is the tick; done_at says when.

import { getEntry, putEntries, tasked, children, isTrashed } from './db.js';
import { entry, newId, tagsIn } from './model.js';
import { GAP } from './order.js';

export const TASKS_PAGE = 'page-tasks';
export const PLAN_ID = 'settings-plan';
export const FREE_HOURS = 45;

const pad = (n) => String(n).padStart(2, '0');
export const isoOf = (d = new Date()) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
export const dateOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); };
// The week a day is in, Monday first.
export const weekOf = (iso) => {
  const d = dateOf(iso);
  const back = (d.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_x, i) => addDays(iso, i - back));
};

// "30 min", "1 h 30 min".
export const span = (m) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);
// "7.5" for seven and a half hours.
export const hours = (m) => String(Math.round(m / 6) / 10);

// "Board Reel 2 1h 30m" → the words and 90. A time at the end of what you
// typed is how long you think it takes.
const UNIT = '(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)';
const TAIL = new RegExp(`(?:^|\\s)(\\d+(?:[.,]\\d+)?)\\s*${UNIT}(?:\\s*(\\d+)\\s*(?:m|min|mins|minutes))?$`, 'i');
export function parseEst(text) {
  const t = (text || '').trim();
  const m = t.match(TAIL);
  if (!m) return { title: t, est: null };
  const n = Number(m[1].replace(',', '.'));
  const est = Math.round(/^h/i.test(m[2]) ? n * 60 + Number(m[3] || 0) : n);
  const title = t.slice(0, m.index).trim();
  if (!title || !est || est > 24 * 60) return { title: t, est: null };
  return { title, est };
}
// What someone types into "how long": "45", "45m", "1h", "1.5h", "1h 20m".
export function readSpan(text) {
  const t = (text || '').trim();
  if (/^\d+$/.test(t)) return Number(t) || null;
  return parseEst(`x ${t}`).est;
}

// "Today", "Tomorrow", "Thu", "Nov 14": a day, said the short way.
export function dayWord(iso, today = isoOf()) {
  if (!iso) return 'No day';
  if (iso === today) return 'Today';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  if (iso === addDays(today, -1)) return 'Yesterday';
  const d = dateOf(iso);
  if (iso > today && iso <= addDays(today, 6)) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
// The quiet label after a task's words where it's written.
export function chipLabel(task, done = false, today = isoOf()) {
  if (done) return task.actual ? `Done · ${span(task.actual)}` : 'Done';
  return [dayWord(task.day, today), task.est ? span(task.est) : null, task.run ? 'timing' : null].filter(Boolean).join(' · ');
}

const blank = () => ({ v: 1, day: null, est: null, done_at: null, actual: null, log: [], run: null, order: 0 });
export const taskOf = (row) => (row?.fields?.task?.v ? row.fields.task : null);

// Minutes on the clock for a task: what the timer has recorded, and what it's
// recording now.
export function timed(task, now = Date.now()) {
  const ms = (task.log || []).reduce((a, [s, e]) => a + Math.max(0, e - s), 0) + (task.run ? Math.max(0, now - task.run) : 0);
  return ms ? Math.max(1, Math.round(ms / 6e4)) : 0;
}

// ---------- reading ----------

// Every task with where it lives: { row, task, root (its page, day or piece),
// world (the project it's in, if any), mine }. Tasks inside something in the
// Trash are left out.
export async function loadTasks() {
  const rows = (await tasked()).filter((r) => r.kind === 'line' && !r.fields?.mirror);
  const seen = new Map();
  const get = async (id) => {
    if (!id) return null;
    if (!seen.has(id)) seen.set(id, (await getEntry(id)) || null);
    return seen.get(id);
  };
  const out = [];
  for (const row of rows) {
    let root = null;
    let world = null;
    let ok = true;
    let at = await get(row.parent_id);
    for (let i = 0; at && i < 60; i++) {
      if (at.deleted || isTrashed(at)) { ok = false; break; }
      if (!root && ['day', 'page', 'chapter', 'project'].includes(at.kind)) root = at;
      if (at.kind === 'world') { world = at; break; }
      at = await get(at.parent_id);
    }
    if (!ok || !root) continue;
    const task = row.fields.task;
    out.push({ row, task, root, world, mine: !task.owner || task.owner === 'me' });
  }
  return out;
}

// Free hours a week and the like: one entry, so every device agrees.
export async function planSettings() {
  const row = await getEntry(PLAN_ID);
  const f = row && !row.deleted ? row.fields || {} : {};
  return { free: Number(f.free) > 0 ? Number(f.free) : FREE_HOURS };
}
export async function savePlanSettings(next) {
  const prev = await getEntry(PLAN_ID);
  const row = { ...(prev || entry('settings', { id: PLAN_ID, title: 'Plan' })), fields: { ...(prev?.fields || {}), ...next }, deleted: false, updated_at: Date.now() };
  await putEntries([row]);
  return row;
}

// ---------- working it out (no page, so it can be checked on its own) ----------

const byOrder = (a, b) => (a.task.order || 0) - (b.task.order || 0) || (a.row.created_at || 0) - (b.row.created_at || 0) || (a.row.id < b.row.id ? -1 : 1);
const isDone = (i) => !!i.row.fields?.done;
// A finished task belongs to the day it was finished.
const doneDay = (i) => (i.task.done_at ? isoOf(i.task.done_at) : i.task.day);
const est = (i) => i.task.est || 0;
const real = (i) => i.task.actual ?? i.task.est ?? 0;

// One day's plan: what's still open (things carried over from earlier days
// first, on today's plan only), then what's done.
export function dayPlan(items, day, today = isoOf()) {
  const mine = items.filter((i) => i.mine);
  const open = mine.filter((i) => !isDone(i) && i.task.day === day).sort(byOrder);
  const carried = day === today ? mine.filter((i) => !isDone(i) && i.task.day && i.task.day < today).sort((a, b) => (a.task.day < b.task.day ? -1 : a.task.day > b.task.day ? 1 : byOrder(a, b))) : [];
  const done = mine.filter((i) => isDone(i) && doneDay(i) === day).sort((a, b) => (a.task.done_at || 0) - (b.task.done_at || 0));
  const todo = [...carried, ...open];
  return { open, carried, done, todo, next: todo[0] || null, left: todo.reduce((a, i) => a + est(i), 0), spent: done.reduce((a, i) => a + real(i), 0) };
}

// A week: seven days, and the tray of open tasks not on a day yet.
export function weekPlan(items, anyDay, today = isoOf()) {
  const mine = items.filter((i) => i.mine);
  const days = weekOf(anyDay).map((iso) => {
    const open = mine.filter((i) => !isDone(i) && i.task.day === iso).sort(byOrder);
    const done = mine.filter((i) => isDone(i) && doneDay(i) === iso).sort((a, b) => (a.task.done_at || 0) - (b.task.done_at || 0));
    return { iso, today: iso === today, open, done, min: open.reduce((a, i) => a + est(i), 0) + done.reduce((a, i) => a + real(i), 0) };
  });
  const tray = mine.filter((i) => !isDone(i) && !i.task.day).sort(byOrder);
  // Still open from before this week: they wait on today's plan.
  const late = mine.filter((i) => !isDone(i) && i.task.day && i.task.day < days[0].iso).length;
  return { days, tray, late, min: days.reduce((a, d) => a + d.min, 0) };
}

// Looking back: what was ticked off in the last days, planned against real.
export function pace(items, now = Date.now(), days = 7) {
  const since = now - days * 864e5;
  const done = items.filter((i) => i.mine && isDone(i) && (i.task.done_at || 0) >= since).sort((a, b) => b.task.done_at - a.task.done_at);
  const rows = done.map((i) => ({ id: i.row.id, title: i.row.text || 'Untitled', est: i.task.est, real: i.task.actual ?? (timed(i.task) || null), item: i }));
  const both = rows.filter((r) => r.est && r.real);
  const sum = (list, k) => list.reduce((a, r) => a + (r[k] || 0), 0);
  const group = (key) => {
    const m = new Map();
    for (const r of rows) for (const k of key(r.item)) m.set(k, (m.get(k) || 0) + (r.real || r.est || 0));
    return [...m].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  };
  return {
    rows,
    planned: sum(both, 'est'),
    real: sum(both, 'real'),
    measured: both.length,
    byProject: group((i) => [i.world?.title || 'No project']),
    byTag: group((i) => (i.row.tags || []).map((t) => `#${t}`)),
  };
}

// ---------- writing ----------

async function change(id, fn, now = Date.now()) {
  const row = await getEntry(id);
  if (!row || row.deleted) return null;
  const next = { ...row, fields: { ...(row.fields || {}) } };
  if (fn(next) === false) return null;
  next.updated_at = now;
  await putEntries([next]);
  return next;
}
const withTask = (row, patch) => { row.fields.task = { ...blank(), ...(row.fields.task || {}), ...patch }; };

// Makes a line a task (or changes its day, estimate, place in the day).
// A task has a box to tick.
export const setTask = (id, patch = {}) => change(id, (r) => { withTask(r, patch); if (r.fields.box !== true) r.fields.box = true; });
// The line stays, with its box; it's only no longer on any plan.
export const unTask = (id) => change(id, (r) => { if (!r.fields.task) return false; delete r.fields.task; });

const stop = (task, now) => { if (task.run) { task.log = [...(task.log || []), [task.run, now]]; task.run = null; } };

// Done (or not after all). A running timer stops with the tick.
export const tickTask = (id, done, now = Date.now()) => change(id, (r) => {
  withTask(r, {});
  const t = r.fields.task;
  stop(t, now);
  r.fields.done = !!done;
  t.done_at = done ? now : null;
  if (!done) t.actual = null;
}, now);
export const tookTask = (id, minutes) => change(id, (r) => { withTask(r, { actual: minutes > 0 ? Math.round(minutes) : null }); });

// One timer at a time: starting one stops whichever was going.
export async function startTimer(id, now = Date.now()) {
  const out = [];
  for (const r of await tasked()) {
    if (r.id !== id && r.fields?.task?.run) out.push(await change(r.id, (x) => { withTask(x, {}); stop(x.fields.task, now); }, now));
  }
  out.push(await change(id, (r) => { withTask(r, {}); if (!r.fields.task.run) r.fields.task.run = now; }, now));
  return out.filter(Boolean);
}
export const stopTimer = (id, now = Date.now()) => change(id, (r) => { withTask(r, {}); stop(r.fields.task, now); }, now);

// A task added straight to a plan lives on the Tasks page, a page like any
// other: open it to add notes under a task, or move the line into a project.
// A step added on a project's page lives on that project's Steps page (home).
export const stepsPage = (worldId) => `steps-${worldId}`;
export const stepsHome = (world) => ({ id: stepsPage(world.id), title: 'Steps', parent_id: world.id });
export async function addTask({ text, day = null, est = null, order = 0, home = null }) {
  const now = Date.now();
  const rows = [];
  const at = home || { id: TASKS_PAGE, title: 'Tasks', parent_id: null };
  let page = await getEntry(at.id);
  if (!page || page.deleted) {
    // A project's Steps page goes after its other pages.
    const after = at.parent_id ? Math.max(0, ...(await children(at.parent_id)).filter((r) => r.kind === 'page').map((r) => r.sort || 0)) + GAP : 0;
    page = entry('page', { id: at.id, title: at.title, parent_id: at.parent_id || null, sort: after });
    rows.push(page);
  } else if (isTrashed(page)) { page = { ...page, fields: { ...page.fields, trashed: null }, updated_at: now }; rows.push(page); }
  const last = (await children(at.id)).filter((r) => r.kind === 'line').at(-1);
  const line = entry('line', {
    id: newId('li'), parent_id: at.id, sort: (last?.sort || 0) + GAP, text, content: text ? [{ type: 'text', text }] : null, tags: tagsIn(text), links: [],
    fields: { done: false, gather: null, gathered: null, mirror: null, box: true, task: { ...blank(), day, est, order } }
  });
  rows.push(line);
  await putEntries(rows);
  return rows;
}

// New words for a task whose line is plain words (one with links or tags
// drawn in it is edited where it lives).
export const plainLine = (row) => !row.content || (row.content.length === 1 && row.content[0].type === 'text' && !row.content[0].marks?.length);
export const renameTask = (id, text) => change(id, (r) => {
  if (!text.trim() || !plainLine(r)) return false;
  r.text = text.trim();
  r.content = [{ type: 'text', text: r.text }];
  r.tags = tagsIn(r.text);
});

// A day's order after a drag: each task takes its place in the list (and the
// day, for one dragged in from another). Only rows that change are written.
export async function arrange(ids, day) {
  const out = [];
  for (let n = 0; n < ids.length; n++) {
    const row = await getEntry(ids[n]);
    const t = taskOf(row);
    if (!t || (t.order === n + 1 && t.day === day)) continue;
    out.push(await change(ids[n], (r) => { withTask(r, { order: n + 1, day }); }));
  }
  return out.filter(Boolean);
}
