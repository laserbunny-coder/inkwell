// The two ends of the day (One thing at a time, Part 4, Nov 15 2026).
//
// Morning: "Talk the day through". When nothing is laid out yet, Now asks
// "What is in front of you today?". What he says goes to Claude (server mode
// "day", supabase/functions/inkwell/day.ts), which hears it as the day in
// order. The app lays today out from that at once, with Undo, and Now shows
// it as "The day as I heard it": the real plan list, so dragging it is
// dragging the plan, with the tasks already on today in it from the start.
// More than five big things, and anything that is a thought, go to today's
// page and get filed the way Part 3 files a thought.
//
// Evening: "Close the day". What the screen saw (done, worked on, events that
// happened), a line for what it didn't, two questions and "What is first
// tomorrow?". It's written on today's page under one line, and the first
// thing goes to the top of tomorrow. Nothing undone is counted.

import { addLine } from './capture.js';
import { getEntry, putEntries } from './db.js';
import { addTask, setTask, taskOf, dayPlan, addDays, isoOf } from './tasks.js';
import { clockWord } from './calendar.js';
import { isTraining, addTrainingLine, trainingToday } from './training.js';

export const BIG_MOST = 5;
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const isSmallTask = (i) => !!(i?.task?.small || i?.task?.habit);

// What's on today, as one list (carried first, as Plan and Now show it).
export const onToday = (items, today) => {
  const dp = dayPlan(items, today, today);
  return [...dp.carried, ...dp.open].filter((i) => !i.ghost && i.mine);
};

// What the server is told.
export function dayBody(words, { items, today, events = [] }) {
  return {
    mode: 'day',
    words: clip(words, 6000),
    today,
    now: new Date().toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' }),
    plan: onToday(items, today).map((i) => ({ id: i.row.id, text: clip(i.row.text, 200), small: isSmallTask(i) })),
    events: events.filter((e) => e.day === today && !e.allDay).sort((a, b) => a.start - b.start).map((e) => ({ title: clip(e.title, 120), at: `${clockWord(e.start)} to ${clockWord(e.end)}` }))
  };
}

// The answer, laid out on today. Every task already on today stays on it (the
// ones the answer missed go after, in their order). A sixth big thing that is
// new doesn't become a task: its words go to the page with the thoughts.
// → { rows, undo, page: [words for today's page], added, n }
export async function layOutDay(out, { items, today }) {
  const was = onToday(items, today);
  const byId = new Map(was.map((i) => [i.row.id, i]));
  const order = [];
  const seen = new Set();
  for (const it of Array.isArray(out?.items) ? out.items : []) {
    if (it.task) { if (byId.has(it.task) && !seen.has(it.task)) { seen.add(it.task); order.push({ item: byId.get(it.task), small: !!it.small }); } } else if (clip(it.text, 200)) order.push({ text: clip(it.text, 200), small: !!it.small });
  }
  for (const i of was) if (!seen.has(i.row.id)) order.push({ item: i, small: isSmallTask(i), missed: true });
  const page = (Array.isArray(out?.thoughts) ? out.thoughts : []).map((t) => clip(t, 400)).filter(Boolean);
  let big = 0;
  const rows = [];
  const undo = [];
  let n = 0;
  let added = 0;
  for (const o of order) {
    if (o.item) {
      const t = o.item.task;
      const small = o.missed ? !!t.small : o.small;
      if (!small && !t.habit && !isTraining(o.item.row)) big++;
      n++;
      const before = { day: t.day ?? null, order: t.order ?? 0, small: !!t.small };
      const patch = { day: today, order: n, ...(small !== !!t.small && !t.habit ? { small } : {}) };
      const r = await setTask(o.item.row.id, patch);
      if (r) rows.push(r);
      undo.push(async () => { const back = await setTask(o.item.row.id, before); return back ? [back] : []; });
      continue;
    }
    // "Training" said in the morning is the day's training line, never a second one.
    if (/^(do |go )?training$/i.test(o.text)) {
      if (trainingToday(items, today)) continue;
      n++;
      const made = await addTrainingLine(items, today);
      const line = made.find((r) => r.kind === 'line');
      if (line) { const r = await setTask(line.id, { order: n }); rows.push(...made.filter((x) => x !== line), r || line); const id = line.id; undo.push(async () => { const x = await getEntry(id); if (!x) return []; const gone = { ...x, deleted: true, updated_at: Date.now() }; await putEntries([gone]); return [gone]; }); }
      continue;
    }
    if (!o.small && big >= BIG_MOST) { page.push(o.text); continue; }
    if (!o.small) big++;
    n++;
    const made = await addTask({ text: o.text, day: today, order: n });
    let line = made.find((r) => r.kind === 'line');
    if (line && o.small) { line = await setTask(line.id, { small: true }); made[made.findIndex((r) => r.kind === 'line')] = line; }
    rows.push(...made);
    added++;
    if (line) {
      const id = line.id;
      undo.push(async () => { const r = await getEntry(id); if (!r) return []; const gone = { ...r, deleted: true, updated_at: Date.now() }; await putEntries([gone]); return [gone]; });
    }
  }
  return { rows, undo, page, added, n };
}

// ---------- the close of the day ----------

// What the screen saw today: done, worked on (set aside with "Enough for
// today"), and events that happened (marked over, or ended and not marked
// "It did not happen").
export function dayFacts({ items, today, events = [], marks = {}, now = Date.now() }) {
  const dp = dayPlan(items, today, today);
  const done = dp.done.filter((i) => i.mine).map((i) => clip(i.row.text, 140) || 'Untitled');
  const worked = items.filter((i) => i.mine && !i.row.fields?.done && Array.isArray(i.task?.worked) && i.task.worked.includes(today)).map((i) => clip(i.row.text, 140) || 'Untitled');
  const happened = events.filter((e) => e.day === today && !e.allDay && marks[e.id] !== 'missed' && (marks[e.id] === 'over' || e.end <= now))
    .sort((a, b) => a.start - b.start).map((e) => ({ title: clip(e.title, 140), at: clockWord(e.start) }));
  return { done, worked: [...new Set(worked)], events: happened };
}

export const ASK = {
  alive: 'Where did you feel most alive and in step today?',
  drained: 'Where did you feel drained or out of step?',
  first: 'What is first tomorrow?'
};

// Written on today's page under one line, "Close of the day". Only what was
// written goes in. "What is first tomorrow" also goes to the top of tomorrow.
// → { rows, line, first } (first: the new task's row, or null)
export async function writeClose({ also = [], alive = '', drained = '', first = '' }, { items, today }) {
  const rows = [];
  const top = await addLine([{ type: 'text', text: 'Close of the day' }], { close: today, sorted: true }, today);
  rows.push(...top.rows);
  const kids = [
    ...also.map((t) => clip(t, 400)).filter(Boolean).map((t) => `Also: ${t}`),
    ...(clip(alive, 1000) ? [`Most alive and in step: ${clip(alive, 1000)}`] : []),
    ...(clip(drained, 1000) ? [`Drained or out of step: ${clip(drained, 1000)}`] : []),
    ...(clip(first, 200) ? [`First tomorrow: ${clip(first, 200)}`] : [])
  ];
  for (const text of kids) {
    const k = await addLine([{ type: 'text', text }], { sorted: true }, today, { page: top.line.id });
    rows.push(...k.rows);
  }
  let task = null;
  if (clip(first, 200)) {
    const tomorrow = addDays(today, 1);
    const orders = items.filter((i) => i.task?.day === tomorrow).map((i) => i.task.order || 0);
    const made = await addTask({ text: clip(first, 200), day: tomorrow, order: Math.min(0, ...orders) - 1 });
    rows.push(...made);
    task = made.find((r) => r.kind === 'line') || null;
  }
  return { rows, line: top.line, first: task };
}

