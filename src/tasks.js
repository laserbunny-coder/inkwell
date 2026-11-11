// Tasks. A task is an ordinary line with a few task fields beside its words
// (fields.task): the day it's planned for, how long you think it takes, when
// it was done and how long it really took. It lives wherever it was written
// (a project page, a daily page, the Tasks page for ones added straight to a
// plan); the plan gathers tasks by day. Nothing is copied.
//
// fields.task = { v: 1, day: 'YYYY-MM-DD' | null, est: minutes | null,
//   done_at: ms | null, actual: minutes | null, log: [[start, end], …],
//   run: ms | null (the timer is going since then), order: number, owner,
//   until: 'YYYY-MM-DD' | null, mark: 'date' | 'hard' | null }
// A line's own "done" (fields.done) is the tick; done_at says when.
// A task with an "until" is a stretch of work, from its day through that
// day: a bar in Weeks ahead, not something on one day's plan. A task with a
// "mark" is a date to hit (hard: it can't move): a diamond in Weeks ahead,
// and still a task on its day.
// A task with a "repeat" comes round again: it stays ONE line, and ticking it
// writes the day into "did" and moves it on to the next day it lands on.
//   repeat: { every: 'day' | 'weekdays' | 'week' | 'month', n: every n-th,
//             days: [1..7] (Monday = 1; for 'week'), from: first day }
//   did: [[day, minutes | null, when ticked (ms)], …], habit: true | false
// A habit is a repeat that's kept up rather than planned: it has no hours.

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
  return [isStretch(task) ? stretchWord(task) : `${isRepeat(task) ? '↻ ' : ''}${dayWord(dueDay(task, today), today)}`, task.est && !task.habit ? span(task.est) : null, task.run ? 'timing' : null].filter(Boolean).join(' · ');
}

const blank = () => ({ v: 1, day: null, est: null, done_at: null, actual: null, log: [], run: null, order: 0 });
export const taskOf = (row) => (row?.fields?.task?.v ? row.fields.task : null);
// A stretch of work: it has a first day and a last.
export const isStretch = (task) => !!(task?.day && task.until && task.until >= task.day);
const short = (iso) => dateOf(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
// "Nov 16 to 29", "Nov 30 to Dec 13".
export function stretchWord(task) {
  const a = dateOf(task.day);
  const b = dateOf(task.until);
  if (task.day === task.until) return short(task.day);
  return `${short(task.day)} to ${a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear() ? b.getDate() : short(task.until)}`;
}

// ---------- repeating ----------

const DAY = 864e5;
const NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const between = (a, b) => Math.round((dateOf(b) - dateOf(a)) / DAY);
// Monday = 1 … Sunday = 7.
export const dow = (iso) => ((dateOf(iso).getDay() + 6) % 7) + 1;
export const isRepeat = (task) => !!task?.repeat?.every;
const nth = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const listed = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

// Does this rule land on that day?
export function lands(rule, iso) {
  if (!rule?.every || !rule.from || iso < rule.from || (rule.until && iso > rule.until)) return false;
  const n = Math.max(1, Number(rule.n) || 1);
  if (rule.every === 'day') return between(rule.from, iso) % n === 0;
  if (rule.every === 'weekdays') return dow(iso) <= 5;
  if (rule.every === 'week') {
    const days = rule.days?.length ? rule.days : [dow(rule.from)];
    if (!days.includes(dow(iso))) return false;
    return (between(weekOf(rule.from)[0], weekOf(iso)[0]) / 7) % n === 0;
  }
  if (rule.every === 'month') {
    const [a, d] = [dateOf(rule.from), dateOf(iso)];
    // The 31st lands on the last day of a shorter month.
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if (d.getDate() !== Math.min(a.getDate(), last)) return false;
    return ((d.getFullYear() - a.getFullYear()) * 12 + d.getMonth() - a.getMonth()) % n === 0;
  }
  return false;
}
// The next day it lands on after that one (null: it has run out).
export function nextOn(rule, after) {
  for (let k = 1; k <= 800; k++) {
    const iso = addDays(after, k);
    if (rule?.until && iso > rule.until) return null;
    if (lands(rule, iso)) return iso;
  }
  return null;
}
const firstOn = (rule, day) => (lands(rule, day) ? day : nextOn(rule, day));
// "Every day", "Weekdays", "Every Monday", "Monday, Wednesday and Friday",
// "Every other week on Monday", "Every month on the 14th".
export function repeatWord(rule) {
  if (!rule?.every) return '';
  const n = Math.max(1, Number(rule.n) || 1);
  if (rule.every === 'day') return n === 1 ? 'Every day' : n === 2 ? 'Every other day' : `Every ${n} days`;
  if (rule.every === 'weekdays') return 'Weekdays';
  if (rule.every === 'week') {
    const days = (rule.days?.length ? [...rule.days].sort((a, b) => a - b) : [dow(rule.from)]).map((d) => NAMES[d - 1]);
    if (n > 1) return `Every ${n === 2 ? 'other week' : `${n} weeks`} on ${listed(days)}`;
    return days.length === 1 ? `Every ${days[0]}` : listed(days);
  }
  if (rule.every === 'month') return `${n === 1 ? 'Every month' : `Every ${n} months`} on the ${nth(dateOf(rule.from).getDate())}`;
  return '';
}
// "Mon, Wed and Fri" → [1, 3, 5] (null when a word isn't a day).
export function readDays(text) {
  const words = String(text || '').toLowerCase().split(/\s*,\s*|\s+and\s+|\s*&\s*|\s+/).filter(Boolean);
  const out = words.map((w) => NAMES.findIndex((n) => w.length >= 3 && (n.toLowerCase().startsWith(w) || `${n.toLowerCase()}s` === w)) + 1);
  return words.length && out.every(Boolean) ? [...new Set(out)].sort((a, b) => a - b) : null;
}
// "Stretch every day" → the words and a rule. Said at the end of what you
// type: every day, daily, weekdays, every week, weekly, every other week,
// every 3 days, every month, monthly, every Mon and Thu.
const D = '(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*';
const SAYS = [
  [/\s+(?:every\s*day|each\s+day|daily)$/i, () => ({ every: 'day' })],
  [/\s+every\s+other\s+day$/i, () => ({ every: 'day', n: 2 })],
  [/\s+every\s+(\d+)\s+days$/i, (m) => ({ every: 'day', n: Number(m[1]) })],
  [/\s+(?:every\s+weekday|(?:on\s+)?weekdays)$/i, () => ({ every: 'weekdays' })],
  [/\s+(?:every\s+other\s+week|biweekly)$/i, () => ({ every: 'week', n: 2 })],
  [/\s+every\s+(\d+)\s+weeks$/i, (m) => ({ every: 'week', n: Number(m[1]) })],
  [/\s+(?:every\s+week|weekly)$/i, () => ({ every: 'week' })],
  [/\s+(?:every\s+month|monthly)$/i, () => ({ every: 'month' })],
  [new RegExp(`\\s+every\\s+(${D}(?:(?:\\s*,\\s*|\\s+and\\s+|\\s*&\\s*|\\s+)${D})*)$`, 'i'), (m) => { const days = readDays(m[1]); return days ? { every: 'week', days } : null; }]
];
export function parseRepeat(text) {
  const t = (text || '').trim();
  for (const [re, make] of SAYS) {
    const m = t.match(re);
    if (!m) continue;
    const rule = make(m);
    const title = t.slice(0, m.index).trim();
    if (rule && title && (!rule.n || (rule.n >= 1 && rule.n <= 52))) return { title, rule };
  }
  return { title: t, rule: null };
}
// What's typed into an "add" box: the words, how long, and whether it repeats.
export function parseAdd(text) {
  let { title, est } = parseEst(text);
  const r = parseRepeat(title);
  if (r.rule) {
    title = r.title;
    if (est == null) { const again = parseEst(title); if (again.est) { title = again.title; est = again.est; } }
  }
  return { title, est, repeat: r.rule };
}

// The day a task is due. One that repeats and was missed moves up to the
// latest day it has come round since, so a daily one is always today's.
export function dueDay(task, today = isoOf()) {
  if (!isRepeat(task) || !task.day || task.day >= today) return task?.day || null;
  for (let iso = today; iso > task.day; iso = addDays(iso, -1)) if (lands(task.repeat, iso)) return iso;
  return task.day;
}
// The days after its due day that a repeating task comes round on, in a range.
export function comingOn(task, from, to, today = isoOf()) {
  if (!isRepeat(task) || !task.day) return [];
  const out = [];
  const due = dueDay(task, today);
  const after = due > today ? due : today;
  for (let iso = from > after ? from : addDays(after, 1); iso <= to; iso = addDays(iso, 1)) if (lands(task.repeat, iso)) out.push(iso);
  return out;
}
// Looking back at one that repeats: how many in a row, and the last four
// weeks day by day. → { streak, done, due, weeks: [[{ iso, state }] × 7] × 4 }
// state: 'done' | 'missed' | 'open' (due and not ticked yet) | 'ahead' | 'off'.
export function history(task, today = isoOf()) {
  const did = new Set((task.did || []).map((d) => d[0]));
  const rule = task.repeat;
  // Each day it came round, with whether it was ticked before the next one.
  const start = rule?.from && rule.from > addDays(today, -400) ? rule.from : addDays(today, -400);
  const came = [];
  for (let iso = start; iso <= today; iso = addDays(iso, 1)) if (lands(rule, iso)) came.push({ iso, done: false });
  came.forEach((c, n) => {
    const until = came[n + 1]?.iso || addDays(today, 1);
    for (let iso = c.iso; iso < until; iso = addDays(iso, 1)) if (did.has(iso)) { c.done = true; break; }
  });
  // The latest one may still be open: that doesn't break a run.
  const run = came.length && !came.at(-1).done ? came.slice(0, -1) : came;
  let streak = 0;
  for (let n = run.length - 1; n >= 0 && run[n].done; n--) streak += 1;
  const by = new Map(came.map((c) => [c.iso, c]));
  const first = addDays(weekOf(today)[0], -21);
  const weeks = [];
  let [done, due] = [0, 0];
  for (let w = 0; w < 4; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) {
      const iso = addDays(first, w * 7 + d);
      const c = by.get(iso);
      const state = did.has(iso) ? 'done' : iso > today ? (lands(rule, iso) ? 'ahead' : 'off') : c && !c.done ? (c === came.at(-1) ? 'open' : 'missed') : 'off';
      if (iso <= today && c && !(c === came.at(-1) && !c.done)) { due += 1; if (c.done) done += 1; }
      row.push({ iso, state });
    }
    weeks.push(row);
  }
  return { streak, done, due, weeks };
}
// A done time of a repeating task, shaped like any finished task.
export function occItem(i, day) {
  const d = [...(i.task.did || [])].reverse().find((x) => x[0] === day);
  if (!d) return null;
  return { ...i, occ: day, row: { ...i.row, fields: { ...i.row.fields, done: true } }, task: { ...i.task, day, done_at: d[2] || dateOf(day).getTime(), actual: d[1] ?? null, run: null, log: [] } };
}
const didOn = (items, day) => items.filter((i) => isRepeat(i.task) && (i.task.did || []).some((d) => d[0] === day && d[2] !== i.task.done_at)).map((i) => occItem(i, day));

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
export async function loadTasks(today = isoOf()) {
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
    // One that repeats shows on the day it's due now (see dueDay).
    const task = isRepeat(row.fields.task) ? { ...row.fields.task, day: dueDay(row.fields.task, today) } : row.fields.task;
    // Its notes: the lines written under it (blank ones don't count).
    const notes = (await children(row.id)).filter((c) => c.kind === 'line' && String(c.text || '').trim()).length;
    out.push({ row, task, root, world, mine: !task.owner || task.owner === 'me', notes });
  }
  return out;
}

// Free hours a week and the like: one entry, so every device agrees.
export async function planSettings() {
  const row = await getEntry(PLAN_ID);
  const f = row && !row.deleted ? row.fields || {} : {};
  // dayEnd: the hour your day ends (22 = 10 pm), for "left today".
  // areas: { area id: the hours a week you mean to give it }.
  return { areas: f.areas && typeof f.areas === 'object' ? f.areas : {}, free: Number(f.free) > 0 ? Number(f.free) : FREE_HOURS, dayEnd: Number(f.dayEnd) > 0 && Number(f.dayEnd) <= 24 ? Number(f.dayEnd) : 22 };
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
// A habit has no hours.
const est = (i) => (i.task.habit ? 0 : i.task.est || 0);
const real = (i) => (i.task.habit ? 0 : i.task.actual ?? i.task.est ?? 0);
// A repeating task on a later day it comes round on: shown, not yet tickable.
const ghosts = (items, day, today) => items.filter((i) => !isDone(i) && isRepeat(i.task) && i.task.day && day > i.task.day && day > today && lands(i.task.repeat, day)).map((i) => ({ ...i, ghost: day }));

// One day's plan: what's still open (things carried over from earlier days
// first, on today's plan only), then what's done.
export function dayPlan(items, day, today = isoOf()) {
  const mine = items.filter((i) => i.mine && !isStretch(i.task));
  const open = [...mine.filter((i) => !isDone(i) && i.task.day === day), ...ghosts(mine, day, today)].sort(byOrder);
  const carried = day === today ? mine.filter((i) => !isDone(i) && i.task.day && i.task.day < today).sort((a, b) => (a.task.day < b.task.day ? -1 : a.task.day > b.task.day ? 1 : byOrder(a, b))) : [];
  const done = [...mine.filter((i) => isDone(i) && doneDay(i) === day), ...didOn(mine, day)].sort((a, b) => (a.task.done_at || 0) - (b.task.done_at || 0));
  const todo = [...carried, ...open];
  return { open, carried, done, todo, next: todo.find((i) => !i.ghost) || null, left: todo.reduce((a, i) => a + est(i), 0), spent: done.reduce((a, i) => a + real(i), 0) };
}

// Woven: a day's timed calendar events among its open tasks, as one list of
// { event } and { item } in the order they're drawn. A task sits after the event
// it was put after (task.at = { day, after: minutes from midnight }); one never
// put anywhere sits after the last event that has begun by now (on another day,
// on top). A moved or deleted event lets its tasks fall in after the one before.
export const minutesOf = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
export function weave(open, events, day, now = Date.now(), today = isoOf()) {
  const evs = events.filter((e) => !e.allDay && e.day === day).map((e) => ({ e, at: minutesOf(e.start) })).sort((a, b) => a.at - b.at || a.e.start - b.e.start);
  const fallback = day === today ? minutesOf(now) : day < today ? 24 * 60 : -1;
  const segment = (i) => {
    const a = i.task.at && i.task.at.day === day && Number.isFinite(i.task.at.after) ? i.task.at.after : fallback;
    let s = -1;
    evs.forEach((x, n) => { if (x.at <= a) s = n; });
    return s;
  };
  const by = new Map();
  for (const i of open) { const s = segment(i); if (!by.has(s)) by.set(s, []); by.get(s).push(i); }
  const out = (by.get(-1) || []).map((item) => ({ item }));
  evs.forEach((x, n) => { out.push({ event: x.e, at: x.at }); for (const item of by.get(n) || []) out.push({ item }); });
  return out;
}

// A week: seven days, and the tray of open tasks not on a day yet.
export function weekPlan(items, anyDay, today = isoOf()) {
  const mine = items.filter((i) => i.mine && !isStretch(i.task));
  const days = weekOf(anyDay).map((iso) => {
    // A habit shows on the day it's due, not all along the week.
    const open = [...mine.filter((i) => !isDone(i) && i.task.day === iso), ...ghosts(mine, iso, today).filter((i) => !i.task.habit)].sort(byOrder);
    const done = [...mine.filter((i) => isDone(i) && doneDay(i) === iso), ...didOn(mine, iso)].sort((a, b) => (a.task.done_at || 0) - (b.task.done_at || 0));
    return { iso, today: iso === today, open, done, min: open.reduce((a, i) => a + est(i), 0) + done.reduce((a, i) => a + real(i), 0) };
  });
  const tray = mine.filter((i) => !isDone(i) && !i.task.day).sort(byOrder);
  // Still open from before this week: they wait on today's plan.
  const late = mine.filter((i) => !isDone(i) && i.task.day && i.task.day < days[0].iso).length;
  return { days, tray, late, min: days.reduce((a, d) => a + d.min, 0) };
}

// Hours worked in a week, by area: what was ticked off that week (what it
// really took) in each project's area, and in the areas that area sits in.
// areas: [{ id, parent_id }]. → Map(area id → minutes). Habits have no hours.
export function areaHours(items, areas, anyDay) {
  const days = weekOf(anyDay);
  const [first, last] = [days[0], days[6]];
  const up = new Map(areas.map((a) => [a.id, a.parent_id || null]));
  const out = new Map();
  const add = (areaId, min) => {
    for (let id = areaId, n = 0; id && min > 0 && n < 12; id = up.get(id), n++) out.set(id, (out.get(id) || 0) + min);
  };
  for (const i of items) {
    const area = i.world?.area_id;
    if (!i.mine || !area || i.task.habit) continue;
    if (isDone(i)) { const d = doneDay(i); if (d >= first && d <= last) add(area, real(i)); }
    if (isRepeat(i.task)) for (const d of i.task.did || []) if (d[0] >= first && d[0] <= last && d[2] !== i.task.done_at) add(area, d[1] ?? (i.task.est || 0));
  }
  return out;
}

// Weeks ahead: the next weeks as columns, a lane for each project.
// lanes: [{ id, title, color, faint }] in the order they should show.
// dates: [{ world, iso, text, hard, go }] from outside the tasks (shoot days).
// → { weeks: [{ iso (its Monday), last, now, min, over }], free (minutes),
//     lanes: [{ …lane, bars: [{ item, from, to, early, late }],
//               dates: [{ col, iso, text, hard, item | null, go }] }],
//     note } where from/to/col count weeks from 1.
export function aheadPlan(items, { today = isoOf(), weeks = 6, free = FREE_HOURS, lanes = [], dates = [] } = {}) {
  const first = weekOf(today)[0];
  const cols = Array.from({ length: weeks }, (_x, n) => {
    const iso = addDays(first, n * 7);
    return { iso, last: addDays(iso, 6), now: n === 0, min: 0, over: false };
  });
  const end = cols[weeks - 1].last;
  // Whole days first, so a clock change in between can't shift a week.
  const colOf = (iso) => Math.floor(Math.round((dateOf(iso) - dateOf(first)) / 864e5) / 7) + 1;
  // Each week's hours: your tasks on its days (what's done this week counts
  // as what it took), the same sum the Week view shows.
  for (const i of items) {
    if (!i.mine || isStretch(i.task)) continue;
    const day = isDone(i) ? doneDay(i) : i.task.day;
    if (!day || day < first || day > end) continue;
    cols[colOf(day) - 1].min += isDone(i) ? real(i) : est(i);
  }
  // One that repeats: the times it's been done, and the days it comes round.
  for (const i of items) {
    if (!i.mine || !isRepeat(i.task) || i.task.habit) continue;
    for (const d of i.task.did || []) if (d[0] >= first && d[0] <= end && d[2] !== i.task.done_at) cols[colOf(d[0]) - 1].min += d[1] ?? (i.task.est || 0);
    if (!isDone(i)) for (const iso of comingOn(i.task, first, end, today)) cols[colOf(iso) - 1].min += est(i);
  }
  for (const c of cols) c.over = c.min > free * 60;
  const out = lanes.map((lane) => {
    const mine = items.filter((i) => i.world?.id === lane.id && !isDone(i));
    const bars = mine.filter((i) => isStretch(i.task) && i.task.until >= first && i.task.day <= end)
      .sort((a, b) => a.task.day.localeCompare(b.task.day) || byOrder(a, b))
      .map((i) => ({ item: i, from: Math.max(1, colOf(i.task.day)), to: Math.min(weeks, colOf(i.task.until)), early: i.task.day < first, late: i.task.until > end }));
    const marks = mine.filter((i) => i.task.mark && i.task.day && !isStretch(i.task) && i.task.day >= first && i.task.day <= end)
      .map((i) => ({ col: colOf(i.task.day), iso: i.task.day, text: i.row.text || 'Untitled', hard: i.task.mark === 'hard', item: i, go: null }));
    const other = dates.filter((d) => d.world === lane.id && d.iso >= first && d.iso <= end)
      .map((d) => ({ col: colOf(d.iso), iso: d.iso, text: d.text, hard: !!d.hard, item: null, go: d.go || null }));
    return { ...lane, bars, dates: [...marks, ...other].sort((a, b) => a.iso.localeCompare(b.iso)) };
  });
  const full = cols.find((c) => c.over);
  const long = (iso) => dateOf(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const note = full ? `${full.now ? 'This week' : `The week of ${long(full.iso)}`} is over your ${hours(free * 60)} hours by ${hours(full.min - free * 60)}.` : '';
  return { weeks: cols, free: free * 60, lanes: out, note };
}

// Looking back: what was ticked off in the last days, planned against real.
export function pace(items, now = Date.now(), days = 7) {
  const since = now - days * 864e5;
  // Each time a repeating task was done counts on its own; habits have no hours.
  const again = items.filter((i) => i.mine && isRepeat(i.task) && !i.task.habit)
    .flatMap((i) => (i.task.did || []).filter((d) => (d[2] || 0) >= since && d[2] !== i.task.done_at).map((d) => ({ ...i, task: { ...i.task, done_at: d[2], actual: d[1] ?? null, log: [], run: null } })));
  const done = [...items.filter((i) => i.mine && !i.task.habit && isDone(i) && (i.task.done_at || 0) >= since), ...again].sort((a, b) => b.task.done_at - a.task.done_at);
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
// A new first day for a task. A stretch keeps its length; off its day, it's
// no longer a stretch.
export const moveTask = (id, day, order) => change(id, (r) => {
  const t = taskOf(r);
  const patch = { day, ...(order ? { order } : {}) };
  if (t && isStretch(t)) patch.until = day ? addDays(day, Math.round((dateOf(t.until) - dateOf(t.day)) / 864e5)) : null;
  // Only this time moves; off its day altogether, it no longer repeats.
  if (t && isRepeat(t) && !day) { patch.repeat = null; patch.habit = false; }
  withTask(r, patch);
  if (r.fields.box !== true) r.fields.box = true;
});
// The line stays, with its box; it's only no longer on any plan.
export const unTask = (id) => change(id, (r) => { if (!r.fields.task) return false; delete r.fields.task; });

const stop = (task, now) => { if (task.run) { task.log = [...(task.log || []), [task.run, now]]; task.run = null; } };

// A repeating task that's been ticked: the day goes into its history and the
// line opens again on the next day it lands on. With none left it stays done.
function roll(r, now) {
  const t = r.fields.task;
  const at = t.done_at || now;
  const day = isoOf(at);
  const min = t.actual ?? (timed({ log: t.log }) || null);
  t.did = [...(t.did || []), [day, min, at]].slice(-400);
  const next = nextOn(t.repeat, t.day && t.day > day ? t.day : day);
  if (!next) return;
  Object.assign(t, { day: next, done_at: null, actual: null, log: [], run: null });
  r.fields.done = false;
}

// Done (or not after all). A running timer stops with the tick. occ: the day
// of a repeating task's done time to take back.
export const tickTask = (id, done, now = Date.now(), occ = null) => change(id, (r) => {
  withTask(r, {});
  const t = r.fields.task;
  stop(t, now);
  if (isRepeat(t) && !done) {
    // Take back the last time it was done (that day's, when one is named).
    const did = [...(t.did || [])];
    const n = occ ? did.map((d) => d[0]).lastIndexOf(occ) : did.length - 1;
    if (n < 0) return false;
    const [day] = did.splice(n, 1)[0];
    t.did = did;
    if (r.fields.done) { r.fields.done = false; t.done_at = null; t.actual = null; }
    else if (!t.day || day < t.day) t.day = lands(t.repeat, day) ? day : dueDay({ ...t, day }, isoOf(now));
    return undefined;
  }
  r.fields.done = !!done;
  t.done_at = done ? now : null;
  if (!done) t.actual = null;
  if (done && isRepeat(t)) roll(r, now);
  return undefined;
}, now);
// How long it took. For a repeating task: that time it was done (the last).
export const tookTask = (id, minutes, occ = null) => change(id, (r) => {
  const m = minutes > 0 ? Math.round(minutes) : null;
  const t = taskOf(r);
  if (t && isRepeat(t) && (t.did || []).length) {
    const did = t.did.map((d) => [...d]);
    const n = occ ? did.map((d) => d[0]).lastIndexOf(occ) : did.length - 1;
    if (n < 0) return false;
    did[n][1] = m;
    withTask(r, { did, ...(r.fields.done ? { actual: m } : {}) });
    return undefined;
  }
  withTask(r, { actual: m });
  return undefined;
});
// Ticked somewhere that doesn't know about repeating (in its words on a page,
// by Claude, on a device with an older copy): move those on. → rows written.
export async function rollTicked(now = Date.now()) {
  const out = [];
  for (const row of await tasked()) {
    const t = taskOf(row);
    if (row.kind !== 'line' || !row.fields?.done || !isRepeat(t)) continue;
    const at = t.done_at || now;
    if ((t.did || []).some((d) => d[2] === at) || !nextOn(t.repeat, t.day && t.day > isoOf(at) ? t.day : isoOf(at))) continue;
    out.push(await change(row.id, (r) => { withTask(r, { done_at: at }); roll(r, now); }, now));
  }
  return out.filter(Boolean);
}
// Makes a task repeat (rule without "from"), or stop (null). It starts on the
// first day the rule lands on, from the day it's on.
export const setRepeat = (id, rule, today = isoOf()) => change(id, (r) => {
  withTask(r, {});
  const t = r.fields.task;
  if (!rule) { t.repeat = null; t.habit = false; }
  else {
    const base = t.day && t.day > today ? t.day : today;
    const full = { n: 1, ...rule, from: base };
    full.from = firstOn(full, base) || base;
    Object.assign(t, { repeat: full, day: full.from, until: null, mark: null });
  }
  if (r.fields.box !== true) r.fields.box = true;
});
// Not this time: on to the next day it lands on, with nothing written down.
export const skipTask = (id, today = isoOf()) => change(id, (r) => {
  const t = taskOf(r);
  if (!t || !isRepeat(t)) return false;
  const due = dueDay(t, today);
  const next = nextOn(t.repeat, due && due > today ? due : today);
  if (!next) return false;
  withTask(r, { day: next });
  return undefined;
});

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
export async function addTask({ text, day = null, est = null, order = 0, home = null, until = null, mark = null, repeat = null }) {
  const now = Date.now();
  if (repeat) {
    const base = day && day > isoOf(now) ? day : isoOf(now);
    repeat = { n: 1, ...repeat, from: base };
    repeat.from = firstOn(repeat, base) || base;
    day = repeat.from;
    until = mark = null;
  }
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
    fields: { done: false, gather: null, gathered: null, mirror: null, box: true, task: { ...blank(), day, est, order, ...(until ? { until } : {}), ...(mark ? { mark } : {}), ...(repeat ? { repeat } : {}) } }
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
// pin: { id, after } puts that one task after the calendar event starting at
// `after` minutes (-1: before them all) on this day, in a woven plan.
export async function arrange(ids, day, pin = null) {
  const out = [];
  for (let n = 0; n < ids.length; n++) {
    const row = await getEntry(ids[n]);
    const t = taskOf(row);
    const at = pin && pin.id === ids[n] ? { day, after: pin.after } : null;
    if (!t || (t.order === n + 1 && t.day === day && (!at || (t.at?.day === day && t.at?.after === at.after)))) continue;
    out.push(await change(ids[n], (r) => { withTask(r, { order: n + 1, day, ...(at ? { at } : {}) }); }));
  }
  return out.filter(Boolean);
}
