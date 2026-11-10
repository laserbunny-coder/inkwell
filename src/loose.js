// Loose lines. A line jotted on a day's page that hasn't been filed anywhere
// yet: no tag, no link, not a task, not sent to the Drawer, and not looked at
// in "Go through". It carries a small ring until you say what it is. Only the
// last week's days count, so old pages never nag.
//
// Going through one writes the answer onto the line itself (fields.sorted),
// so it syncs like any other change and can be taken back.

import { getEntry, putEntries, children } from './db.js';
import { bySort } from './order.js';
import { setTask, isoOf, addDays } from './tasks.js';
import { LOOSE_DAYS, isLoose } from './loosemark.js';
import { addLink, getReview } from './review.js';
import { intoDrawer } from './stages.js';

export { LOOSE_DAYS, isLoose, inWindow, dayOfPage } from './loosemark.js';

export async function looseOn(iso) {
  return (await children(`day-${iso}`)).filter(isLoose).sort(bySort);
}

// The last week's loose lines: today's first, then yesterday's, and so on.
export async function looseRecent(today = isoOf(), days = LOOSE_DAYS) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const iso = addDays(today, -i);
    for (const row of await looseOn(iso)) out.push({ row, day: iso });
  }
  return out;
}

// ---------- a first guess ----------

const DO_FIRST = /^(call|phone|ring|email|e-mail|text|message|reply to|write to|ask|tell|remind|buy|order|get|pick up|book|schedule|reschedule|cancel|renew|pay|send|post|mail|return|fix|finish|check|look up|find|sign|print|clean|measure|update|back up|install|set up|make an appointment)\b/i;
const HAS_WHEN = /\b(today|tonight|tomorrow|this week|next week|by (mon|tues|wednes|thurs|fri|satur|sun)day|before (mon|tues|wednes|thurs|fri|satur|sun)day|on (mon|tues|wednes|thurs|fri|satur|sun)day|by the \d+|deadline|due)\b/i;
const SPARK = /^(what if|idea:|idea for|maybe a|imagine|a (film|story|song|show|short|reel|book|game|sketch) (about|where)|someone who|a [a-z]+ who)\b/i;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// What a review card suggests, in Go through's words.
const FROM_REVIEW = { daybook: 'task', drawer: 'drawer', mull: 'keep', let_go: 'keep' };

// The answer to light up first. `thread` is the day review's card holding
// this line, when Claude has read the day (then it's Claude's guess);
// otherwise it's read off the words. `worlds`: [{ id, title }].
export function guess(row, { worlds = [], thread = null } = {}) {
  const text = (row.text || '').trim();
  if (thread && !thread.choice) {
    const why = thread.gist || thread.title || '';
    if (thread.suggest === 'daybook') return { how: 'task', why, claude: true };
    if (thread.link?.id) return { how: 'file', to: { id: thread.link.id, title: thread.link.title }, why, claude: true };
    if (FROM_REVIEW[thread.suggest]) return { how: FROM_REVIEW[thread.suggest], why, claude: true };
  }
  if (DO_FIRST.test(text) || (HAS_WHEN.test(text) && text.length < 120)) return { how: 'task', why: HAS_WHEN.test(text) ? 'It names a day' : 'It reads like something to do', claude: false };
  // Longest names first, so "The Ninja Bunch" wins over a project called "Ninja".
  for (const w of [...worlds].filter((x) => (x.title || '').trim().length > 2).sort((a, b) => b.title.length - a.title.length)) {
    const name = w.title.trim();
    const bare = name.replace(/^the\s+/i, '');
    if (new RegExp(`(^|[^\\p{L}\\p{N}])(${esc(name)}|${esc(bare)})($|[^\\p{L}\\p{N}])`, 'iu').test(text)) return { how: 'file', to: { id: w.id, title: name }, why: `It names ${name}`, claude: false };
  }
  if (SPARK.test(text)) return { how: 'drawer', why: 'It reads like a spark with no home yet', claude: false };
  return { how: 'keep', why: '', claude: false };
}

// The open cards of a day's review, by the lines they hold.
export async function reviewThreads(iso) {
  const by = new Map();
  const review = (await getReview(iso))?.fields.review;
  for (const t of review?.threads || []) {
    for (const id of t.lines || []) if (!by.has(id)) by.set(id, t);
    for (const p of t.parts || []) for (const id of p.lines || []) if (!by.has(id)) by.set(id, { ...p, link: p.link || t.link });
  }
  return by;
}

// ---------- answering ----------

// how: 'task' (on today's plan), 'tray' (a task, not on a day yet), 'file'
// (linked to `to`), 'drawer', 'keep'. Returns the rows written and the line
// as it was, for taking it back.
export async function sortLine(id, how, { to = null, today = isoOf(), order = Date.now() / 1000, now = Date.now() } = {}) {
  const before = await getEntry(id);
  if (!before || before.deleted) return { rows: [], before: null };
  if (how === 'task' || how === 'tray') await setTask(id, { day: how === 'task' ? today : null, order });
  else if (how === 'file' && to?.id) await addLink([id], to);
  else if (how === 'drawer') await intoDrawer(id);
  const row = await getEntry(id);
  const next = { ...row, fields: { ...(row.fields || {}), sorted: { at: now, how } }, updated_at: now };
  await putEntries([next]);
  return { rows: [next], before };
}

// Takes an answer back: the line is as it was, and loose again.
export async function unsort(before, now = Date.now()) {
  if (!before) return [];
  const row = { ...before, updated_at: now };
  await putEntries([row]);
  return [row];
}
