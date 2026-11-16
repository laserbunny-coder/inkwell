// Reading streak and progress (Part 8): the rules, with no browser. Sunday
// counts; today still to come doesn't break; a missed day starts again
// silently and keeps the best; the grid is twelve weeks by seven days and
// only the past week can be changed; the words on each track; the line
// after reading; the one-time fill from the Bible habit.
import assert from 'node:assert/strict';
import { readStreak, readGrid, readCount, readGridLine, readTip, trackWords, doneLine, daysFromHistory, cleanDays, withDay, withoutDay } from '../src/readstats.js';
import { streakLine } from '../src/trainstats.js';

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
// Nov 2026: Sat 14, Sun 15, Mon 16, Tue 17, Wed 18.

check('Sunday counts', () => {
  assert.deepEqual(readStreak(['2026-11-14', '2026-11-15', '2026-11-16'], '2026-11-16'), { cur: 3, best: 3 });
  assert.equal(readStreak(['2026-11-14', '2026-11-16'], '2026-11-16').cur, 1, 'a Sunday missed breaks it');
});

check('today still to come does not break it', () => {
  assert.equal(readStreak(['2026-11-14', '2026-11-15'], '2026-11-16').cur, 2);
  assert.equal(readStreak(['2026-11-14', '2026-11-15'], '2026-11-17').cur, 0);
});

check('a missed day starts again silently and keeps the best', () => {
  const s = readStreak(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-16', '2026-11-17'], '2026-11-18');
  assert.deepEqual(s, { cur: 2, best: 4 });
  assert.equal(streakLine(s), '2 days in a row. Best 4.');
  assert.equal(streakLine(readStreak(['2026-11-16'], '2026-11-16')), '', 'under 2, no number');
});

check('twelve weeks by seven days; only the past week can be changed', () => {
  const cols = readGrid(['2026-11-12', '2026-11-15', '2026-11-16'], '2026-11-18');
  assert.equal(cols.length, 12);
  assert.equal(cols[0].length, 7);
  const at = (d) => cols.flat().find((c) => c.d === d);
  assert.equal(cols[11][0].d, '2026-11-16', 'this week last, from Monday');
  assert.equal(cols[11][6].d, '2026-11-22', 'to Sunday');
  assert.equal(at('2026-11-15').kind, 'r');
  assert.equal(at('2026-11-17').kind, 'm');
  assert.equal(at('2026-11-18').kind, 't');
  assert.equal(at('2026-11-19').kind, null);
  assert.equal(at('2026-11-11').kind, 'm', 'in the past week, even before the first day');
  assert.equal(at('2026-11-10').kind, null, 'before he started and older than a week');
  assert.equal(at('2026-11-17').tap, true);
  assert.equal(at('2026-11-11').tap, true, 'seven days back');
  assert.equal(at('2026-11-10').tap, false);
  assert.equal(at('2026-11-18').tap, false, 'today moves by reading, not by a tap');
  assert.equal(readCount(cols), 3);
  assert.equal(readGridLine(3), 'Read on 3 days in the last 12 weeks. Tap a day in the past week to correct it.');
  assert.equal(readGridLine(0), 'Each day you read adds a dot.');
  assert.equal(readTip(at('2026-11-15')), 'Last week, Sunday: read. Tap to change it');
  assert.equal(readTip(at('2026-11-18')), 'Today: not yet');
});

check('the words on each track fit one line', () => {
  assert.equal(trackWords('Numbers', 30, 36, 736), 'Numbers 30');
  assert.equal(trackWords('Psalm', 74, 1, 150), 'Psalm 74 of 150');
  assert.equal(trackWords('Proverbs', 31, 2, 43, 1), 'Proverbs 31 · second time through');
  assert.equal(trackWords('Psalm', 3, 1, 150, 2), 'Psalm 3 of 150 · third time through');
});

check('after reading: one quiet line, only from 2 days', () => {
  assert.equal(doneLine({ cur: 13 }), 'Reading done. 13 days in a row.');
  assert.equal(doneLine({ cur: 1 }), '');
});

check('the one-time fill and the day list', () => {
  assert.deepEqual(daysFromHistory({ read: '2026-11-14' }, [{ did: [['2026-11-12', null, 0], ['2026-11-13', 5, 0]] }]), ['2026-11-12', '2026-11-13', '2026-11-14']);
  assert.deepEqual(cleanDays(['2026-11-13', '2026-11-12', '2026-11-13', 'x', '2026-11-20'], '2026-11-16'), ['2026-11-12', '2026-11-13'], 'unique, sorted, nothing ahead');
  assert.deepEqual(withDay(['2026-11-12'], '2026-11-10', '2026-11-16'), ['2026-11-10', '2026-11-12']);
  assert.deepEqual(withoutDay(['2026-11-10', '2026-11-12'], '2026-11-10'), ['2026-11-12']);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('reading streak and progress: all good');
