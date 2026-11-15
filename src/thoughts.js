// Out of your head (One thing at a time, Part 3, Nov 15 2026). A thought that
// comes up while he's on the one thing goes on today's page as a line with the
// time, in his words, unchanged, and he stays where he is. Afterwards, in the
// background, Claude says where it belongs (server mode "thought",
// supabase/functions/inkwell/thoughts.ts) and copies or pointers go there:
//   a story idea      → a copy tagged #drawer (the Drawer)
//   a task for later  → a task under Not planned
//   an app or tool    → a copy tagged #workshop
//   something to find → a copy tagged #lookup
// The copies live on one page, "Filed thoughts" (each remembers its line).
// The line itself only gets a quiet note ("Filed under the Drawer",
// Look switch "Where a thought was filed") and stops counting as loose.
// A thought that is plainly an instruction about today ("put the hook first")
// changes the plan instead, with Undo, and the line comes off the page.

import { addLine } from './capture.js';
import { getEntry, putEntries, children } from './db.js';
import { entry, tagsIn } from './model.js';
import { GAP } from './order.js';
import { addTask, setTask, isoOf, taskOf, dayPlan } from './tasks.js';

export const FILED_PAGE = 'pg_filed-thoughts';
export const WHERE = { drawer: 'the Drawer', later: 'Not planned', workshop: 'the Workshop', lookup: 'To look up' };
const TAG = { drawer: 'drawer', workshop: 'workshop', lookup: 'lookup' };
const clock = (d = new Date()) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, ' ').toLowerCase();

// The words of the thought (the time it was said comes first on the line).
export const thoughtWords = (row) => String(row?.fields?.thought?.words ?? row?.text ?? '').trim();
// What a filed line's note says, or '' (none, or not filed yet).
export function filedNote(row) {
  const th = row?.fields?.thought;
  if (!th?.to?.length) return '';
  return `Filed under ${th.to.map((w) => WHERE[w] || w).join(' and ')}`;
}

// On today's page, now: "9:04 am Call the passport office".
export async function writeThought(text, day = isoOf()) {
  const words = String(text || '').trim();
  if (!words) return null;
  const said = clock();
  return addLine([{ type: 'text', text: `${said} ${words}` }], { capture: 'thought', said, thought: { words, state: 'waiting' } }, day);
}

async function filedPage(rows) {
  let page = await getEntry(FILED_PAGE);
  if (!page || page.deleted) {
    page = { ...(page || entry('page', { id: FILED_PAGE, title: 'Filed thoughts', parent_id: null, sort: 0 })), deleted: false, updated_at: Date.now() };
    rows.push(page);
  }
  return page;
}

// Copies and pointers, and the line's note. Returns the rows written.
async function putAway(line, places) {
  const rows = [];
  const made = [];
  const words = thoughtWords(line);
  let sort = 0;
  for (const p of places) {
    if (p.where === 'later') {
      const t = await addTask({ text: p.text || words, day: null });
      const task = t.find((r) => r.kind === 'line');
      if (task) { task.fields.thought = { from: line.id }; made.push(task.id); }
      rows.push(...t);
      continue;
    }
    const tag = TAG[p.where];
    if (!tag) continue;
    await filedPage(rows);
    if (!sort) sort = Math.max(0, ...(await children(FILED_PAGE)).map((r) => r.sort || 0));
    sort += GAP;
    // No link back to the day: today's page mustn't fill up with "Linked from".
    const text = `${words} #${tag}`;
    const copy = entry('line', { parent_id: FILED_PAGE, sort, text, content: [{ type: 'text', text }], tags: tagsIn(text), links: [], fields: { done: false, gather: null, gathered: null, mirror: null, thought: { from: line.id, day: line.parent_id } } });
    rows.push(copy);
    made.push(copy.id);
  }
  const kept = { ...line, fields: { ...line.fields, sorted: true, thought: { ...line.fields.thought, state: 'filed', to: places.map((p) => p.where), copies: made } }, updated_at: Date.now() };
  rows.push(kept);
  await putEntries(rows);
  return rows;
}

const mark = async (line, state) => {
  const kept = { ...line, fields: { ...line.fields, ...(state === 'kept' ? { sorted: true } : {}), thought: { ...line.fields.thought, state } }, updated_at: Date.now() };
  await putEntries([kept]);
  return [kept];
};

// Today's plan, as the server sees it: ids and words, in order.
function planFor(items, today) {
  const dp = dayPlan(items, today, today);
  return [...dp.carried, ...dp.open].filter((i) => !i.ghost && i.mine).map((i) => ({ id: i.row.id, text: i.row.text || '' }));
}

// Plan moves → the rows written and how to undo them.
async function applyMoves(moves, { items, today }) {
  const rows = [];
  const undo = [];
  const orders = items.filter((i) => i.task.day === today).map((i) => i.task.order || 0);
  let lo = Math.min(0, ...orders);
  let hi = Math.max(0, ...orders);
  for (const m of moves) {
    if (m.type === 'add_today') {
      const t = await addTask({ text: m.text, day: today, order: m.first ? --lo : ++hi });
      const line = t.find((r) => r.kind === 'line');
      rows.push(...t);
      if (line) undo.push(async () => { const r = await getEntry(line.id); if (r) { const gone = { ...r, deleted: true, updated_at: Date.now() }; await putEntries([gone]); return [gone]; } return []; });
      continue;
    }
    const row = await getEntry(m.task);
    const t = taskOf(row);
    if (!t) continue;
    const was = { day: t.day ?? null, order: t.order ?? 0 };
    const patch = m.type === 'first' ? { day: today, order: --lo } : m.type === 'last' ? { day: today, order: ++hi } : { day: null, order: 0 };
    const moved = await setTask(m.task, patch);
    if (moved) rows.push(moved);
    undo.push(async () => { const r = await setTask(m.task, was); return r ? [r] : []; });
  }
  return { rows, undo };
}

// Files one thought. ask(body) → the server's answer; wrote(rows) shows rows
// written; toast(text, action). dump: from a brain dump on the page (filed
// only, never a plan change). Returns what happened: 'plan' | 'file' | 'none'
// | 'waiting' (no answer: it stays loose on the page, to file later).
export async function fileThought(lineId, { ask, items = [], today = isoOf(), dump = false, wrote = async () => {}, toast = () => {} }) {
  let line = await getEntry(lineId);
  if (!line || line.deleted) return 'none';
  if (!line.fields?.thought) line = { ...line, fields: { ...line.fields, thought: { words: String(line.text || '').trim(), state: 'waiting' } } };
  const words = thoughtWords(line);
  let out;
  try { out = await ask({ mode: 'thought', text: words, today, plan: planFor(items, today), dump }); } catch (e) { console.warn(e); return 'waiting'; }
  if (!out || out.error || !['plan', 'file', 'none'].includes(out.kind)) return 'waiting';
  line = await getEntry(lineId);
  if (!line || line.deleted) return 'none';
  if (!line.fields?.thought) line = { ...line, fields: { ...line.fields, thought: { words, state: 'waiting' } } };
  if (out.kind === 'plan' && !dump && out.moves?.length) {
    const { rows, undo } = await applyMoves(out.moves, { items, today });
    const gone = { ...line, deleted: true, updated_at: Date.now() };
    await putEntries([gone]);
    await wrote([...rows, gone]);
    toast(out.said || 'Today’s plan changed', {
      label: 'Undo',
      run: async () => {
        const back = [];
        for (const u of undo.reverse()) back.push(...(await u()));
        const r = await getEntry(lineId);
        if (r) { const kept = { ...r, deleted: false, updated_at: Date.now() }; await putEntries([kept]); back.push(kept); }
        await wrote(back);
      }
    });
    return 'plan';
  }
  if (out.kind === 'file' && out.places?.length) {
    await wrote(await putAway(line, out.places));
    return 'file';
  }
  await wrote(await mark(line, 'kept'));
  return 'none';
}

// Today's thoughts still waiting for an answer (made offline, or the answer
// didn't come): filed once there's a connection.
export async function waitingThoughts(today = isoOf()) {
  return (await children(`day-${today}`)).filter((r) => !r.deleted && r.fields?.thought?.state === 'waiting');
}
