// Bringing Daybook in. Daybook's projects, steps, tasks, repeats, time logs
// and done history become Inkwell's own: a project is a world (a life
// project unless one of that name is already here), its steps are task lines
// on its Steps page, a task on its own is a line on the Tasks page. Daybook
// itself is only read. Each thing brought in keeps the id it had there in its
// own id, so bringing in again adds only what's new and never doubles up.

import { entry, tagsIn } from './model.js';
import { GAP } from './order.js';
import { getEntry, getMany, putEntries, children, byKind, getMeta, setMeta } from './db.js';
import { TASKS_PAGE, PLAN_ID, stepsPage, isoOf, dateOf, lands, nextOn } from './tasks.js';

const clean = (s) => String(s || '').trim();
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
const key = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '');
export const lineId = (id) => `li-db-${key(id)}`;
const noteId = (id, n) => `li-dbn-${key(id)}-${n}`;
const ms = (t) => { const n = Date.parse(t); return Number.isFinite(n) ? n : null; };
const day = (d) => (d ? String(d).slice(0, 10) : null);
const short = (iso) => dateOf(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const clockOf = (min) => { const h = Math.floor(min / 60); const m = min % 60; return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`; };

// Daybook's repeat rule → Inkwell's. Daybook counts Sunday as 0.
export function ruleOf(r, from) {
  if (!r?.every || !from) return null;
  const until = r.until ? { until: day(r.until) } : {};
  const n = Math.max(1, Number(r.interval) || 1);
  if (r.every === 'day') return { every: 'day', n, from, ...until };
  if (r.every === 'weekday') return { every: 'weekdays', n: 1, from, ...until };
  if (r.every === 'week') {
    const days = [...new Set((r.days || []).map((d) => (Number(d) === 0 ? 7 : Number(d))).filter((d) => d >= 1 && d <= 7))].sort((a, b) => a - b);
    return { every: 'week', n, ...(days.length ? { days } : {}), from, ...until };
  }
  if (r.every === 'month') {
    // "On the 15th": start from a 15th, so the rule lands there.
    let start = from;
    const dom = Number(r.dom) || 0;
    if (dom >= 1 && dom <= 31) {
      const d = dateOf(from);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      start = isoOf(new Date(d.getFullYear(), d.getMonth(), Math.min(dom, last)));
      if (dom > 28) start = isoOf(new Date(d.getFullYear(), 0, dom)); // January has every day of the month
    }
    return { every: 'month', n, from: start, ...until };
  }
  return null;
}

// Everything to write, worked out without touching anything.
// items: Daybook's rows. have: { areas, worlds (Inkwell's own), ids: Set of
// every entry id already here (deleted ones too, so what you threw away stays
// away), lines: Map of the lines here that were once sent to Daybook, targets:
// area hours set, planRow, tasksEnd, stepsEnd }.
// → { rows, plan: { areas: [{ title, isNew }], projects: [{ title, isNew, steps }],
//      tasks, steps, repeats, habits, done, home, already, left: [{ what, n }] },
//    before: the rows that were changed (not made), as they were }
export function planImport(items, have, now = Date.now()) {
  const today = isoOf(now);
  const live = (items || []).filter((i) => i && !i.deleted && !i.deleted_at);
  const gone = (items || []).length - live.length;
  const byId = new Map(live.map((i) => [i.id, i]));
  const kids = new Map();
  for (const i of live) if (i.parent_id && byId.has(i.parent_id)) { if (!kids.has(i.parent_id)) kids.set(i.parent_id, []); kids.get(i.parent_id).push(i); }
  for (const list of kids.values()) list.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const labels = new Map(live.filter((i) => i.kind === 'label').map((i) => [i.id, clean(i.title)]));
  const rows = [];
  const plan = { areas: [], projects: [], tasks: 0, steps: 0, repeats: 0, habits: 0, done: 0, home: 0, already: 0, left: [] };
  const before = [];
  const here = (id) => have.ids.has(id);
  const put = (row) => { if (here(row.id)) { plan.already += 1; return false; } rows.push(row); return true; };

  // ---- areas ----
  const areaOf = new Map(); // Daybook area id → Inkwell area id
  const targets = { ...(have.targets || {}) };
  let areaSort = Math.max(0, ...have.areas.map((a) => a.sort || 0));
  for (const a of live.filter((i) => i.kind === 'area').sort((x, y) => (x.sort || 0) - (y.sort || 0))) {
    const match = have.areas.find((x) => !x.deleted && same(x.title, a.title));
    const id = match ? match.id : `ar-db-${key(a.id)}`.slice(0, 60);
    areaOf.set(a.id, id);
    if (!match && !here(id)) {
      areaSort += 1;
      rows.push(entry('area', { id, title: clean(a.title) || 'Untitled', sort: areaSort, fields: { color: a.color || '#A39A8B', fromDaybook: a.id } }));
    }
    plan.areas.push({ title: clean(a.title), isNew: !match && !here(id) });
    // The hours a week it was meant to get carry over, unless one is set here.
    const hours = Number(a.week_minutes) > 0 ? Math.round((Number(a.week_minutes) / 60) * 10) / 10 : 0;
    if (hours && !(Number(targets[id]) > 0)) targets[id] = hours;
  }
  if (JSON.stringify(targets) !== JSON.stringify(have.targets || {})) {
    const prev = have.planRow || entry('settings', { id: PLAN_ID, title: 'Plan' });
    before.push(have.planRow || { ...prev, deleted: true });
    rows.push({ ...prev, fields: { ...(prev.fields || {}), areas: targets }, deleted: false, updated_at: now });
  }

  // ---- the times a repeating task was done ----
  const series = new Map(); // series id → [[day, minutes, at]]
  for (const i of live) {
    if (!i.series_id || !i.done) continue;
    const d = day(i.occurs_on) || day(i.day) || (i.done_at ? isoOf(ms(i.done_at)) : null);
    if (!d) continue;
    if (!series.has(i.series_id)) series.set(i.series_id, []);
    series.get(i.series_id).push([d, Number(i.actual_minutes) > 0 ? Number(i.actual_minutes) : null, ms(i.done_at) || dateOf(d).getTime() + 12 * 36e5]);
  }

  // ---- one item → its line (and the lines under it) ----
  const line = (i, parentId, sort, { project = false } = {}) => {
    const sub = (kids.get(i.id) || []).filter((k) => !k.series_id);
    const tags = (Array.isArray(i.labels) ? i.labels : []).map((l) => labels.get(l) || '').filter(Boolean).map((t) => `#${t.replace(/\s+/g, '-')}`);
    const text = [clean(i.title) || 'Untitled', ...tags.filter((t) => !clean(i.title).includes(t))].join(' ');
    const from = day(i.day) || day(i.start) || day(i.due) || today;
    const repeat = ruleOf(i.repeat_rule, from);
    const did = [...(series.get(i.id) || []), ...(Array.isArray(i.days_done) ? i.days_done : Object.keys(i.days_done || {})).map((d) => [day(d), null, dateOf(day(d)).getTime() + 12 * 36e5])]
      .filter((d) => d[0]).sort((a, b) => a[2] - b[2]);
    const t = { v: 1, day: day(i.day), est: sub.length ? null : Number(i.duration_min) > 0 ? Number(i.duration_min) : null, done_at: i.done ? ms(i.done_at) || (day(i.day) ? dateOf(day(i.day)).getTime() + 12 * 36e5 : ms(i.updated_at) || now) : null, actual: Number(i.actual_minutes) > 0 ? Number(i.actual_minutes) : null, log: [], run: null, order: Number(i.day_sort) || Number(i.sort) || 0 };
    // What the timer really recorded (not the guesses made at tick-off).
    for (const s of Array.isArray(i.time_log) ? i.time_log : []) { const [a, b] = [ms(s.start), ms(s.end)]; if (a && b && b > a && !s.guess && !s.est) t.log.push([a, b]); }
    const said = []; // what has no field of its own goes under it, in words
    if (repeat) {
      t.repeat = repeat;
      if (i.habit) t.habit = true;
      if (did.length) t.did = did.slice(-400);
      // Due on the first day it lands on from today that isn't done yet.
      const done = new Set(did.map((d) => d[0]));
      let next = lands(repeat, today) ? today : nextOn(repeat, today);
      while (next && done.has(next)) next = nextOn(repeat, next);
      t.day = next || t.day;
      if (!next) { t.repeat = null; said.push(`Repeated until ${short(repeat.until)}`); }
      t.done_at = null; t.actual = null;
    } else if (sub.length && day(i.start) && day(i.due) && day(i.due) >= day(i.start)) {
      // A part of a project with a first and a last day: a stretch of work.
      t.day = day(i.start); t.until = day(i.due);
    } else if (i.milestone) {
      t.day = day(i.day) || day(i.due); if (t.day) t.mark = i.hard_deadline ? 'hard' : 'date';
    } else if (day(i.due) && !t.day && !i.done) {
      t.day = day(i.due); t.mark = i.hard_deadline ? 'hard' : 'date';
    }
    if (day(i.due) && day(i.due) !== t.day && day(i.due) !== t.until) said.push(`Due ${short(day(i.due))}${i.hard_deadline ? ' (can’t move)' : ''}`);
    if (Number.isFinite(i.start_min) && i.start_min !== null && !i.done && !repeat) said.push(`At ${clockOf(Number(i.start_min))}`);
    if (i.waits_on && byId.has(i.waits_on)) said.push(`Waits on: ${clean(byId.get(i.waits_on).title)}`);
    const done = !!i.done && !t.repeat;
    const count = () => {
      if (project) plan.steps += 1; else plan.tasks += 1;
      if (t.repeat) plan.repeats += 1;
      if (t.habit) plan.habits += 1;
      if (done) plan.done += 1;
    };
    // A line here that was once sent to Daybook: the task comes home to it.
    const origin = !sub.length && String(i.id).startsWith('inkwell-') ? have.lines?.get(String(i.id).slice(8)) : null;
    if (origin) {
      if (origin.fields?.task?.v) { plan.already += 1; return; }
      before.push(origin);
      rows.push({ ...origin, fields: { ...(origin.fields || {}), done: done || !!origin.fields?.done, box: true, fromDaybook: i.id, task: t }, updated_at: now });
      count();
      plan.home += 1;
      return;
    }
    const made = put(entry('line', {
      id: lineId(i.id), parent_id: parentId, sort, text, content: [{ type: 'text', text }], tags: tagsIn(text), links: [],
      fields: { done, gather: null, gathered: null, mirror: null, box: true, fromDaybook: i.id, task: t },
      created_at: ms(i.updated_at) || now, updated_at: now
    }));
    if (made) count();
    // Its notes, a line each, and its link: under it, as on any page.
    let n = 0;
    const under = (content, words, links = []) => { n += 1; put(entry('line', { id: noteId(i.id, n), parent_id: lineId(i.id), sort: n * GAP, text: words, content, tags: [], links, fields: { fromDaybook: i.id }, updated_at: now })); };
    for (const s of said) under([{ type: 'text', text: s }], s);
    for (const p of clean(i.notes).split(/\n+/).map(clean).filter(Boolean)) under([{ type: 'text', text: p }], p);
    const url = clean(i.link);
    if (/^https?:\/\//i.test(url)) {
      // A link back into Inkwell reads as what it is; any other shows its address.
      const back = (url.match(/[?&]open=([^&#\s]+)/) || [])[1];
      const words = back ? 'Where this came from' : url;
      under([{ type: 'text', text: words, marks: [{ type: 'link', attrs: { href: url } }] }], words, back ? [decodeURIComponent(back)] : []);
    }
    sub.forEach((k, x) => line(k, lineId(i.id), (n + x + 1) * GAP, { project }));
  };

  // ---- projects and tasks on their own ----
  const tops = live.filter((i) => !i.kind && !i.parent_id && !i.series_id).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  let worldSort = Math.max(0, ...have.worlds.map((w) => w.sort || 0));
  const tasksPage = have.ids.has(TASKS_PAGE);
  let loose = 0;
  for (const i of tops) {
    const sub = (kids.get(i.id) || []).filter((k) => !k.series_id);
    if (!sub.length) {
      if (!loose && !tasksPage && !rows.some((r) => r.id === TASKS_PAGE)) rows.push(entry('page', { id: TASKS_PAGE, title: 'Tasks', parent_id: null, sort: 0 }));
      loose += 1;
      line(i, TASKS_PAGE, (have.tasksEnd || 0) + loose * GAP);
      continue;
    }
    // A project: the world of that name if there is one, else a new life project.
    const match = have.worlds.find((w) => !w.deleted && same(w.title, i.title));
    const wid = match ? match.id : `wd-db-${key(i.id)}`;
    const isNew = !match && !here(wid);
    if (isNew) {
      worldSort += 1;
      rows.push(entry('world', { id: wid, title: clean(i.title) || 'Untitled', area_id: areaOf.get(i.area_id) || null, sort: worldSort, fields: { shape: 'one', life: true, fromDaybook: i.id }, updated_at: now }));
    }
    const sp = stepsPage(wid);
    if (!here(sp)) rows.push(entry('page', { id: sp, title: 'Steps', parent_id: wid, sort: 9000 }));
    const start = rows.length;
    let n = 0;
    // What the project itself said: its notes and link on a page of their own, and its date as a date to hit.
    const words = clean(i.notes).split(/\n+/).map(clean).filter(Boolean);
    const link = clean(i.link) && /^https?:\/\//i.test(clean(i.link)) ? clean(i.link) : '';
    if (words.length || link) {
      const pid = `pg-db-${key(i.id)}`;
      if (!here(pid)) {
        rows.push(entry('page', { id: pid, title: 'From Daybook', parent_id: wid, sort: 8000, fields: { fromDaybook: i.id } }));
        words.forEach((p, x) => rows.push(entry('line', { id: noteId(i.id, `p${x}`), parent_id: pid, sort: (x + 1) * GAP, text: p, content: [{ type: 'text', text: p }], tags: tagsIn(p) })));
        if (link) rows.push(entry('line', { id: noteId(i.id, 'plink'), parent_id: pid, sort: (words.length + 1) * GAP, text: link, content: [{ type: 'text', text: link, marks: [{ type: 'link', attrs: { href: link } }] }] }));
      }
    }
    if (day(i.due) && !i.done) {
      const text = `${clean(i.title)} due`;
      put(entry('line', { id: `li-dbd-${key(i.id)}`, parent_id: sp, sort: GAP / 2, text, content: [{ type: 'text', text }], tags: [], links: [],
        fields: { done: false, box: true, fromDaybook: i.id, task: { v: 1, day: day(i.due), est: null, done_at: null, actual: null, log: [], run: null, order: 0, mark: i.hard_deadline ? 'hard' : 'date' } } }));
    }
    const stepsBefore = plan.steps;
    sub.forEach((k) => { n += 1; line(k, sp, (have.stepsEnd?.get(wid) || 0) + n * GAP, { project: true }); });
    plan.projects.push({ title: clean(i.title), isNew, steps: plan.steps - stepsBefore, added: rows.length - start });
  }

  const blocks = live.filter((i) => i.kind === 'block').length;
  if (blocks) plan.left.push({ what: blocks === 1 ? 'area time block' : 'area time blocks', n: blocks });
  if (gone) plan.left.push({ what: gone === 1 ? 'thing in Daybook’s trash' : 'things in Daybook’s trash', n: gone });
  return { rows, plan, before };
}

// The plan, said in a few plain lines.
export function sayPlan(plan, rows) {
  const out = [];
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const fresh = plan.projects.filter((p) => p.isNew);
  const joined = plan.projects.filter((p) => !p.isNew && p.added);
  if (fresh.length) out.push(`${n(fresh.length, 'project becomes', 'projects become')} a life project here: ${fresh.map((p) => p.title).join(', ')}.`);
  if (joined.length) out.push(`${n(joined.length, 'project joins', 'projects join')} the one of the same name already here: ${joined.map((p) => p.title).join(', ')}.`);
  if (plan.steps) out.push(`${n(plan.steps, 'step goes', 'steps go')} onto those projects’ Steps.`);
  if (plan.tasks) out.push(`${n(plan.tasks, 'task', 'tasks')} on ${plan.tasks === 1 ? 'its own goes' : 'their own go'} onto the Tasks page.`);
  if (plan.home) out.push(`${n(plan.home, 'of them comes', 'of them come')} home to the line here ${plan.home === 1 ? 'it was' : 'they were'} sent from.`);
  const extra = [plan.repeats ? n(plan.repeats, 'repeats', 'repeat') : '', plan.habits ? n(plan.habits, 'is a habit', 'are habits') : '', plan.done ? n(plan.done, 'is already done', 'are already done') : ''].filter(Boolean);
  if (extra.length) out.push(`Of all those, ${extra.join(', ')}.`);
  const areas = plan.areas.filter((a) => a.isNew);
  if (areas.length) out.push(`${n(areas.length, 'new area', 'new areas')}: ${areas.map((a) => a.title).join(', ')}.`);
  if (plan.already) out.push(`${n(plan.already, 'thing is', 'things are')} already here from before and ${plan.already === 1 ? 'is' : 'are'} left as ${plan.already === 1 ? 'it is' : 'they are'}.`);
  if (plan.left.length) out.push(`Left behind on purpose: ${plan.left.map((l) => `${l.n} ${l.what}`).join(', ')}.`);
  if (!rows.length) return ['Everything in Daybook is already here. There’s nothing new to bring in.'];
  out.push('Daybook itself isn’t changed.');
  return out;
}

// ---------- doing it ----------

const UNDO = 'daybookIn'; // meta: the last time, so it can be taken back
const gone = (r) => !r || (r.deleted && r.fields?.undone);

// What's here already, as planImport wants it. Read twice: once to learn
// every id this could make, then again knowing which of those exist.
export async function gather(items) {
  const planRow = (await getEntry(PLAN_ID)) || null;
  const worlds = await byKind('world');
  const have = {
    areas: await byKind('area'), worlds, ids: new Set(), lines: new Map(),
    planRow: planRow && !planRow.deleted ? planRow : null,
    targets: planRow && !planRow.deleted && planRow.fields?.areas && typeof planRow.fields.areas === 'object' ? planRow.fields.areas : {},
    tasksEnd: 0, stepsEnd: new Map()
  };
  const first = planImport(items, have);
  const ids = [...new Set(first.rows.map((r) => r.id))];
  const found = await getMany(ids);
  found.forEach((r, x) => {
    if (gone(r)) return;
    // A Tasks or Steps page that was thrown away is made again, or what goes on it would never show.
    if (r.kind === 'page' && (r.deleted || r.fields?.trashed) && (r.id === TASKS_PAGE || r.id.startsWith('steps-'))) return;
    have.ids.add(ids[x]);
  });
  const sent = (items || []).map((i) => String(i?.id || '')).filter((id) => id.startsWith('inkwell-')).map((id) => id.slice(8));
  (await getMany(sent)).forEach((r) => { if (r && !r.deleted && r.kind === 'line') have.lines.set(r.id, r); });
  const lastSort = async (pageId) => (await children(pageId)).filter((r) => r.kind === 'line').at(-1)?.sort || 0;
  have.tasksEnd = await lastSort(TASKS_PAGE);
  for (const w of worlds) { const end = await lastSort(stepsPage(w.id)); if (end) have.stepsEnd.set(w.id, end); }
  return have;
}

// Writes the plan, and remembers what it did so it can be taken back.
export async function bringIn({ rows, before }, now = Date.now()) {
  if (!rows.length) return [];
  const changed = new Set(before.map((r) => r.id));
  await putEntries(rows);
  await setMeta(UNDO, { at: now, made: rows.filter((r) => !changed.has(r.id)).map((r) => r.id), before });
  return rows;
}

export const lastTime = async () => { const last = await getMeta(UNDO); return last?.made?.length || last?.before?.length ? last : null; };

// Takes the last time back: what it made goes (and may come in again another
// time), what it changed is as it was. Words you've changed since are kept.
export async function takeBack(now = Date.now()) {
  const last = await lastTime();
  if (!last) return [];
  const rows = [];
  for (const r of await getMany(last.made)) if (r && !r.deleted) rows.push({ ...r, deleted: true, fields: { ...(r.fields || {}), undone: true }, updated_at: now });
  for (const was of last.before) {
    const r = await getEntry(was.id);
    if (!r) continue;
    if (was.id === PLAN_ID) rows.push({ ...r, fields: { ...(r.fields || {}), areas: was.deleted ? {} : was.fields?.areas || {} }, updated_at: now });
    else {
      const fields = { ...(r.fields || {}), done: !!was.fields?.done };
      delete fields.task; delete fields.fromDaybook; delete fields.box;
      if (was.fields && 'box' in was.fields) fields.box = was.fields.box;
      rows.push({ ...r, fields, updated_at: now });
    }
  }
  if (rows.length) await putEntries(rows);
  await setMeta(UNDO, null);
  return rows;
}

const make = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };

// The box: reads Daybook, says what would come in, and waits for a yes.
// hooks: { read: () => Daybook's rows (or null when it can't be reached),
//          applied: (rows) => …, toast, open: (id) => … }
export async function openDaybookIn(hooks) {
  document.querySelector('.dbin')?.remove();
  const back = make('div', 'ask-backdrop dbin');
  const box = make('div', 'ask dbin-box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Bring in Daybook');
  const body = make('div', 'dbin-body');
  const row = make('div', 'ask-actions');
  const no = make('button', 'ghost-btn', 'Not now');
  const yes = make('button', 'pill primary', 'Bring it in');
  yes.hidden = true;
  row.append(no, yes);
  box.append(make('h2', '', 'Bring in Daybook'), body, row);
  back.append(box);
  document.body.append(back);
  const close = () => back.remove();
  no.addEventListener('click', close);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  no.focus();
  const say = (...lines) => body.replaceChildren(...lines.map((l) => (typeof l === 'string' ? make('p', '', l) : l)));

  const undo = async () => {
    const rows = await takeBack();
    await hooks.applied(rows);
    hooks.toast('Taken back. Everything is as it was before.');
  };
  const look = async () => {
    yes.hidden = true;
    say('Reading Daybook…');
    let items = null;
    try { items = await hooks.read(); } catch (e) { console.warn(e); }
    if (!back.isConnected) return;
    if (!items) { say('Daybook can’t be reached just now. Sign in and be online, then try again. Nothing was changed.'); return; }
    const got = planImport(items, await gather(items));
    const parts = sayPlan(got.plan, got.rows).map((l) => make('p', 'dbin-line', l));
    const fresh = got.plan.projects.filter((p) => p.added);
    if (fresh.length > 3) {
      // The projects, one to a line, for a look before saying yes.
      const det = make('details', 'dbin-list');
      det.append(make('summary', '', `The ${fresh.length} projects`));
      const ul = make('ul');
      for (const p of fresh) ul.append(make('li', '', `${p.title}${p.steps ? ` · ${p.steps} step${p.steps === 1 ? '' : 's'}` : ''}${p.isNew ? '' : ' · already here'}`));
      det.append(ul);
      parts.push(det);
    }
    const last = await lastTime();
    if (last) {
      const when = new Date(last.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const b = make('button', 'link-btn dbin-undo', `Take back what came in on ${when}`);
      b.addEventListener('click', async () => { b.disabled = true; await undo(); if (back.isConnected) look(); });
      parts.push(b);
    }
    say(...parts);
    yes.hidden = !got.rows.length;
    no.textContent = got.rows.length ? 'Not now' : 'Close';
    yes.onclick = async () => {
      yes.disabled = true;
      const rows = await bringIn(got);
      await hooks.applied(rows);
      close();
      const n = got.plan.tasks + got.plan.steps;
      hooks.toast(`Daybook is in: ${n} task${n === 1 ? '' : 's'}${got.plan.projects.length ? ` across ${got.plan.projects.length} project${got.plan.projects.length === 1 ? '' : 's'}` : ''}.`, { label: 'Undo', run: undo });
    };
  };
  await look();
}
