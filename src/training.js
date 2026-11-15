// Training (One thing at a time, Part 6, Nov 15 2026). Training works like
// the morning reading: it comes up as the next thing in the day and he
// follows it, head down.
//
// Where it lives: one page, "Training", written as an outline. Its top lines
// are the sessions (the two evaluations first, once each; then the ones that
// take turns), one line per exercise under each, and a ladder's steps as
// lines under its exercise. The amounts (sets, minutes, what to record, the
// mark, the link) are fields on the line, edited by tapping them on the page.
// The page row keeps the place in the round and the last numbers, so they
// sync like anything else:
//   fields.training = { round, order: [session names], step: { lad: i },
//     last: { k: n }, lastSets: { k: n }, lastMin: { k: n },
//     at: { day, i, res: [line texts] } | null, made: day }
//
// Each day (not Sunday) a plain task line "Training" goes on today, early
// afternoon by default, and he drags it like any other line. It never counts
// toward the five big things. A missed day changes nothing: the place moves
// only when a session is finished or he trained on his own.

import { getEntry, putEntries, children } from './db.js';
import { entry } from './model.js';
import { GAP } from './order.js';
import { addTask, setTask, tickTask, isoOf, dateOf } from './tasks.js';
import { addLine } from './capture.js';

export const TRAINING_PAGE = 'pg_training';
export const PLAN_URL = 'https://claude.ai/artifact/7kTRn4UhijdxmAS5RGbMN4';
export const isTraining = (row) => !!row?.fields?.training && row.kind === 'line' && row.id !== TRAINING_PAGE && !!row.fields?.task;
const AFTERNOON = 13 * 60;

// ---------- the seed (the training plan, Nov 15 2026; all numbers are his to change) ----------

const LADDERS = {
  lever: { goal: 'front lever', mark: 10, steps: ['Tuck front lever', 'Advanced tuck front lever', 'One-leg front lever', 'Straddle front lever', 'Front lever'] },
  // Added Nov 15, to train a push beside the pull.
  planche: { goal: 'straddle planche', mark: 10, steps: ['Planche lean', 'Tuck planche', 'Advanced tuck planche', 'Straddle planche'] }
};
const WARM = { k: 'warm', t: 'Warm up', m: 10, mw: 'minutes. Scapular pulls, leg swings, skips, three easy build-up runs' };
const WRIST = { k: 'wrist', t: 'Wrist preparation', m: 5, mw: 'minutes' };
const STRENGTH = [
  { k: 'pikelift', t: 'Pike leg lifts', n: 3, w: 'sets', u: 'reps', q: 'Reps' },
  { k: 'lsit', t: 'L-sit', n: 3, w: 'holds', u: 'seconds', q: 'Shortest hold' },
  { k: 'legs', t: 'Squat or split squat', n: 3, w: 'sets', d: 'Heavy, 5 or 6 reps a set' },
  { k: 'calf', t: 'Single-leg calf raises', n: 3, w: 'sets', d: '10 slow reps each leg' },
  { k: 'nordic', t: 'Nordic hamstring curls', n: 2, w: 'sets', u: 'reps', q: 'Reps' }
];
const LEVER = [
  { k: 'lever', t: 'Front lever hold', lad: 'lever', n: 5, w: 'holds', d: 'About 70% of your best time, 2 to 3 minutes apart', u: 'seconds', q: 'Shortest hold' },
  { k: 'lowers', t: 'Front lever lowers', n: 3, w: 'sets', d: '3 slow lowers a set' }
];
const PLANCHE = [
  { k: 'planche', t: 'Planche hold', lad: 'planche', n: 5, w: 'holds', d: 'About 70% of your best time. Take turns with the lever holds if you like', u: 'seconds', q: 'Shortest hold' },
  { k: 'ppu', t: 'Pseudo planche push-ups', n: 3, w: 'sets', u: 'reps', q: 'Reps' }
];
export const SEED = [
  { n: 'Evaluation 1', once: true, x: [WARM,
    { k: 'reach', t: 'Standing reach', d: 'Side to a wall, feet flat, chalk on your fingertips', u: 'inches', q: 'Reach' },
    { k: 'vtest', t: 'Vertical jump test', n: 5, w: 'jumps', d: 'No step, full rest. Enter your best jump minus your reach', u: 'inches', q: 'Vertical' },
    { k: 'btest', t: 'Broad jump test', n: 3, w: 'jumps', d: 'Two feet, stick the landing', u: 'inches', q: 'Best jump' },
    { k: 'ltest', t: 'Front lever test', d: 'One all-out hold in each position you can reach, 3 to 5 minutes apart. Enter the hardest one you held', u: 'seconds', q: 'Hold' },
    { k: 'ptest', t: 'Planche test', d: 'One all-out hold in the hardest position you can reach: lean, tuck, advanced tuck or straddle', u: 'seconds', q: 'Hold' },
    { k: 'pulltest', t: 'Pull-up test', d: 'One strict set from a full hang', u: 'reps', q: 'Reps' }] },
  { n: 'Evaluation 2', once: true, x: [WRIST,
    { k: 'walltest', t: 'Wall handstand test', d: 'Chest to wall. Stop when your line breaks', u: 'seconds', q: 'Hold' },
    { k: 'free', t: 'Free handstand test', n: 5, w: 'attempts', u: 'seconds', q: 'Best hold' },
    { k: 'presslow', t: 'Press lowering test', d: 'From a wall handstand, lower through straddle as slowly as you can', u: 'seconds', q: 'Control' },
    { k: 'lsit', t: 'L-sit test', d: 'One hold', u: 'seconds', q: 'Hold' },
    { k: 'pikelift', t: 'Pike leg lift test', d: 'Seated pike, hands beside your knees, lift both heels', u: 'reps', q: 'Reps' },
    { k: 'flex', t: 'Pancake, pike and shoulders', d: 'Take a side photo of each and note what reaches the floor' }] },
  { n: 'Hard A', hard: true, x: [WARM,
    { k: 'pogo', t: 'Pogo hops', n: 3, w: 'sets', d: '15 hops a set' },
    { k: 'vert', t: 'Vertical jumps', n: 4, w: 'sets', d: '5 jumps a set, full effort, full rest' },
    { k: 'broad', t: 'Broad jumps', n: 3, w: 'sets', d: '4 jumps a set' },
    { k: 'sprintA', t: 'Short sprints', n: 4, w: 'sprints', d: '20 yards at about 80% effort, walk back' },
    ...LEVER,
    { k: 'pull', t: 'Pull-ups', n: 3, w: 'sets', u: 'reps', q: 'Reps' },
    ...PLANCHE,
    ...STRENGTH] },
  { n: 'Light', x: [WRIST,
    { k: 'wall', t: 'Wall handstand holds', m: 2, mw: 'minutes in total, chest to wall', u: 'seconds', q: 'Longest hold' },
    { k: 'free', t: 'Free handstand practice', m: 10, mw: 'minutes', u: 'seconds', q: 'Best hold' },
    { k: 'plower', t: 'Press lowers', n: 5, w: 'lowers', d: 'From a wall handstand through straddle. Long rests' },
    { k: 'toelift', t: 'Toe lifts', n: 5, w: 'attempts', d: 'Straddle stand, hands down, lean until your toes float' },
    { k: 'scap', t: 'Scapular pulls', n: 2, w: 'sets', d: '8 easy reps a set' },
    { k: 'hollow', t: 'Hollow hold', n: 2, w: 'holds', d: '30 seconds each' },
    { k: 'pancake', t: 'Pancake stretch', n: 3, w: 'holds', d: '60 seconds each' },
    { k: 'pike', t: 'Pike stretch', n: 3, w: 'holds', d: '60 seconds each' },
    { k: 'shoulder', t: 'Shoulder stretch', n: 2, w: 'holds', d: '45 seconds each' },
    { k: 'lifts', t: 'Active leg lifts', n: 5, w: 'lifts', d: 'At the end of your pancake and pike range' }] },
  { n: 'Hard B', hard: true, x: [WARM,
    { k: 'sprint', t: 'Sprints', n: 5, w: 'sprints', d: '20 yards at about 80% effort, walk back' },
    { k: 'vert', t: 'Vertical jumps', n: 3, w: 'sets', d: '5 jumps a set, full effort, full rest' },
    { k: 'pogo', t: 'Pogo hops', n: 3, w: 'sets', d: '15 hops a set' },
    ...LEVER,
    { k: 'rows', t: 'Tuck front lever rows', n: 3, w: 'sets', u: 'reps', q: 'Reps' },
    ...PLANCHE,
    ...STRENGTH] }
];
// After the two evaluations, the round: Hard A, Light, Light, Hard B, Light, Light.
export const ROUND = ['Hard A', 'Light', 'Light', 'Hard B', 'Light', 'Light'];
// On the Desk: the goals on stage, and those waiting their turn.
export const WAITING = ['Muscle-up', 'One-arm handstand', 'Vertical of 35, then 40'];

const blankState = () => ({ round: 0, order: [...ROUND], step: { lever: 0, planche: 0 }, last: {}, lastSets: {}, lastMin: {}, at: null, made: null });

// The page and its outline, written once.
export async function seedTraining() {
  const had = await getEntry(TRAINING_PAGE);
  if (had && !had.deleted) return [];
  const rows = [];
  const page = entry('page', { id: TRAINING_PAGE, title: 'Training', parent_id: null, sort: 0 });
  page.fields = { ...page.fields, training: blankState() };
  rows.push(page);
  const line = (parent, sort, text, fields) => {
    const r = entry('line', { parent_id: parent, sort, text, content: [{ type: 'text', text }], tags: [], links: [], fields: { done: false, gather: null, gathered: null, mirror: null, ...fields } });
    rows.push(r);
    return r;
  };
  SEED.forEach((s, si) => {
    const top = line(TRAINING_PAGE, (si + 1) * GAP, s.n, { session: { once: !!s.once, hard: !!s.hard } });
    s.x.forEach((x, xi) => {
      const { t, lad, ...ex } = x;
      const r = line(top.id, (xi + 1) * GAP, t, { ex: { ...ex, ...(lad ? { lad, mark: LADDERS[lad].mark, goal: LADDERS[lad].goal } : {}) } });
      if (lad) LADDERS[lad].steps.forEach((st, i) => line(r.id, (i + 1) * GAP, st, { ladstep: { lad, i } }));
    });
  });
  await putEntries(rows);
  return rows;
}

// ---------- reading it ----------

const sorted = (rows) => rows.filter((r) => !r.deleted && r.kind === 'line').sort((a, b) => (a.sort || 0) - (b.sort || 0));

// → { page, state, sessions: [{ id, name, once, x: [ex] }] } or null.
export async function readTraining() {
  const page = await getEntry(TRAINING_PAGE);
  if (!page || page.deleted) return null;
  const state = { ...blankState(), ...(page.fields?.training || {}) };
  const sessions = [];
  for (const top of sorted(await children(TRAINING_PAGE))) {
    const x = [];
    for (const r of sorted(await children(top.id))) {
      const ex = { ...(r.fields?.ex || {}), id: r.id, t: r.text || 'Untitled' };
      if (!ex.k) ex.k = r.id;
      if (ex.lad) ex.steps = sorted(await children(r.id)).map((s) => s.text || '');
      x.push(ex);
    }
    sessions.push({ id: top.id, name: top.text || 'Session', once: !!top.fields?.session?.once, hard: !!top.fields?.session?.hard || /^hard\b/i.test(top.text || ''), x });
  }
  return { page, state, sessions };
}

// The session whose turn it is. Easing in (he asked on Nov 15): the first
// time through the round, a hard day's exercises with 3 or more sets show
// one set fewer.
export function sessionAt(tr, round = tr.state.round) {
  const once = tr.sessions.filter((s) => s.once);
  if (round < once.length) return once[round];
  const order = (tr.state.order || ROUND).map((n) => tr.sessions.find((s) => !s.once && s.name === n)).filter(Boolean);
  const turn = order.length ? order : tr.sessions.filter((s) => !s.once);
  if (!turn.length) return null;
  const s = turn[(round - once.length) % turn.length];
  if (!s.hard || round - once.length >= turn.length) return s;
  return { ...s, ease: true, x: s.x.map((x) => (x.n >= 3 ? { ...x, n: x.n - 1 } : x)) };
}

// An exercise's name: a ladder says the step he's on.
export function exName(ex, state) {
  if (!ex.lad || !ex.steps?.length) return ex.t;
  const i = Math.min(state.step?.[ex.lad] || 0, ex.steps.length - 1);
  return `${ex.steps[i]} hold`;
}

export async function saveState(patch) {
  const page = await getEntry(TRAINING_PAGE);
  if (!page) return null;
  const kept = { ...page, fields: { ...page.fields, training: { ...blankState(), ...(page.fields?.training || {}), ...patch } }, updated_at: Date.now() };
  await putEntries([kept]);
  return kept;
}

// ---------- the line on today ----------

export const trainingToday = (items, today) => items.find((i) => isTraining(i.row) && (i.task.day === today || (i.row.fields?.done && isoOf(i.task.done_at || 0) === today)));

// Today's line, once a day, not on Sunday, unless it was already made today
// (and since taken off). → rows written.
export async function ensureTrainingLine(items, today = isoOf()) {
  if (dateOf(today).getDay() === 0) return [];
  if (trainingToday(items, today)) return [];
  const rows = [...(await seedTraining())];
  const tr = await readTraining();
  if (!tr || tr.state.made === today) return rows;
  rows.push(...(await addTrainingLine(items, today)));
  const st = await saveState({ made: today });
  if (st) rows.push(st);
  return rows;
}

// A "Training" line on a day, after the rest (early afternoon among events).
export async function addTrainingLine(items, day) {
  const orders = items.filter((i) => i.task.day === day).map((i) => i.task.order || 0);
  const made = await addTask({ text: 'Training', day, order: Math.max(0, ...orders) + 1 });
  const i = made.findIndex((r) => r.kind === 'line');
  if (i < 0) return made;
  const line = { ...made[i], fields: { ...made[i].fields, training: true, task: { ...made[i].fields.task, at: { day, after: AFTERNOON } } } };
  made[i] = line;
  await putEntries([line]);
  return made;
}

// ---------- doing a session ----------

// One exercise's result, for the page: "Tuck front lever hold: 8 seconds, 4 of 5 holds".
export function resultLine(ex, name, { cur = null, sets = null, min = null } = {}) {
  const bits = [];
  if (ex.u && cur != null) bits.push(`${cur} ${ex.u}`);
  if (ex.n && sets != null && sets < ex.n) bits.push(`${sets} of ${ex.n} ${ex.w || 'sets'}`);
  else if (ex.n && sets != null && ex.u) bits.push(`${sets} of ${ex.n} ${ex.w || 'sets'}`);
  if (ex.m && min != null && min !== ex.m) bits.push(`${min} of ${ex.m} minutes`);
  return bits.length ? `${name}: ${bits.join(', ')}` : '';
}

// The session is over: a line on today's page with a child per number, the
// day's task ticked and named, the place moves on. → rows written.
export async function finishSession({ name, res = [], lineId = null, today = isoOf(), own = false }) {
  const rows = [];
  const title = own ? 'Training: on my own' : `Training: ${name}`;
  const top = await addLine([{ type: 'text', text: title }], { training: 'done', sorted: true }, today);
  rows.push(...top.rows);
  for (const text of res.filter(Boolean)) rows.push(...(await addLine([{ type: 'text', text }], { sorted: true }, today, { page: top.line.id })).rows);
  if (lineId) {
    const r = await getEntry(lineId);
    if (r && !r.deleted) {
      const named = { ...r, text: title, content: [{ type: 'text', text: title }], updated_at: Date.now() };
      await putEntries([named]);
      const ticked = await tickTask(lineId, true);
      rows.push(ticked || named);
    }
  }
  const page = await getEntry(TRAINING_PAGE);
  const st = await saveState({ round: (page?.fields?.training?.round || 0) + 1, at: null });
  if (st) rows.push(st);
  return { rows, line: top.line };
}

// ---------- the Desk ----------

// The goals on stage with where each stands, those waiting, and what's next.
export async function deskTraining() {
  const tr = await readTraining();
  if (!tr) return null;
  const L = tr.state.last || {};
  const xs = tr.sessions.flatMap((s) => s.x);
  const after = 'After your evaluation';
  const sec = (v, pre = '') => (v != null ? `${pre}${v} seconds` : after);
  const ladder = (lad) => { const x = xs.find((e) => e.lad === lad); return x ? `${exName(x, tr.state).replace(/ hold$/, '')}${L[x.k] != null ? `, ${L[x.k]} seconds` : ''}` : after; };
  const next = sessionAt(tr);
  return {
    goals: [
      ['Vertical over 30 inches', L.vtest != null ? `${L.vtest} inches` : after],
      ['Front lever', ladder('lever')],
      ['Straddle planche', ladder('planche')],
      ['Press to handstand', sec(L.presslow, 'Lowering, ')],
      ['Two-minute handstand', sec(L.free)]
    ],
    waiting: WAITING,
    next: next ? `${next.name}${next.ease ? ', one set fewer for your first week' : ''}` : ''
  };
}
