// Reading streak and progress (One thing at a time, Part 8, Nov 15 2026).
// Plain functions, no database, checked on their own (tests/readstats.mjs).
//
// The days he read are kept with First light's places (settings-plan
// fields.reading.days: local dates, oldest first), so they sync. A day is
// read when he finishes "Read here", taps "I read it" / "I read it on paper",
// or "I read yesterday too". Reading is seven days a week: Sunday counts
// here. Today never breaks the streak while it is still today, and a missed
// day simply starts the count again, silently.
//   fields.reading.rounds = { ot, ps, wi, nt }: times each track started over.

import { plusDays, dow, daysBetween, KEEP_DAYS } from './trainstats.js';

const DAYNAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// A clean list of days: unique, sorted, the last two years or so.
export function cleanDays(days, today) {
  const from = plusDays(today, -KEEP_DAYS);
  return [...new Set((days || []).filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= from && d <= today))].sort();
}
export const withDay = (days, d, today) => cleanDays([...(days || []), d], today);
export const withoutDay = (days, d) => (days || []).filter((x) => x !== d);

// → { cur, best }
export function readStreak(days, today) {
  const set = new Set(days || []);
  if (!set.size) return { cur: 0, best: 0 };
  const first = [...set].sort()[0];
  let run = 0;
  let best = 0;
  for (let d = first; d <= today; d = plusDays(d, 1)) {
    if (set.has(d)) { run += 1; if (run > best) best = run; } else if (d !== today) run = 0;
  }
  return { cur: run, best };
}

// Twelve weeks, Monday to Sunday: 12 columns (oldest first), 7 rows.
// kind: 'r' read, 'm' not read, 't' today not yet, null nothing (before the
// first day, or still to come). tap: a day in the past seven, which can be
// switched between read and not read.
export function readGrid(days, today) {
  const set = new Set(days || []);
  const first = set.size ? [...set].sort()[0] : null;
  const monday = plusDays(today, -((dow(today) + 6) % 7));
  const cols = [];
  for (let c = 0; c < 12; c++) {
    const wk = plusDays(monday, -(11 - c) * 7);
    const col = [];
    for (let r = 0; r < 7; r++) {
      const d = plusDays(wk, r);
      const back = daysBetween(d, today);
      let kind = null;
      if (set.has(d)) kind = 'r';
      else if (d === today) kind = 't';
      else if (d < today && ((first && d > first) || back <= 7)) kind = 'm';
      col.push({ d, kind, ago: 11 - c, day: DAYNAMES[(r + 1) % 7], tap: back >= 1 && back <= 7 });
    }
    cols.push(col);
  }
  return cols;
}
export const readCount = (cols) => cols.flat().filter((c) => c.kind === 'r').length;
export const readGridLine = (n) => (n
  ? `Read on ${n} ${n === 1 ? 'day' : 'days'} in the last 12 weeks. Tap a day in the past week to correct it.`
  : 'Each day you read adds a dot.');
const agoWords = (ago) => (ago === 0 ? 'This week' : ago === 1 ? 'Last week' : `${ago} weeks ago`);
export function readTip(c) {
  if (c.kind === 't') return 'Today: not yet';
  const what = c.kind === 'r' ? 'read' : 'not read';
  return `${agoWords(c.ago)}, ${c.day}: ${what}${c.tap ? '. Tap to change it' : ''}`;
}

const NTH = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
export const nth = (n) => NTH[n] || `${n}th`;
// The words on the right of a track: "Numbers 30", "Psalm 74 of 150",
// "Proverbs 31 · second time through".
export function trackWords(name, ch, books, total, rounds = 0) {
  const at = `${name} ${ch}${books === 1 ? ` of ${total}` : ''}`;
  return rounds > 0 ? `${at} · ${nth(rounds + 1)} time through` : at;
}

// The quiet line on the screen after reading, or ''.
export const doneLine = ({ cur }) => (cur >= 2 ? `Reading done. ${cur} days in a row.` : '');

// The days he kept his Bible habit, from its "did" list, and First light's last day.
export function daysFromHistory(st, habits = []) {
  const out = [];
  for (const t of habits) for (const d of t?.did || []) if (Array.isArray(d) && typeof d[0] === 'string') out.push(d[0]);
  if (typeof st?.read === 'string') out.push(st.read);
  return out;
}
