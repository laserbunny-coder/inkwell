// Training streak and charts (Part 7): the rules, with no browser.
// Sunday neither counts nor breaks; today still to come doesn't break; a
// missed day starts again silently and keeps the best; "on my own" counts;
// under 2 shows no number; the grid's four kinds of day; a ladder chart
// breaks at a move up; best yet only against the same step, never for a
// first number; the one-time fill from the daily pages' lines.
import assert from 'node:assert/strict';
import { streakOf, streakLine, gridOf, gridCount, cellTip, seriesOf, chartSentence, pointSentence, bestYet, gateLine, entryFromLines, trimLog, shortStep, dow } from '../src/trainstats.js';

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const e = (d, h = false, n = {}, st = {}, more = {}) => ({ d, s: h ? 'Hard A' : 'Light', h, n, st, ...more });
// Nov 2026: Mon 9 … Sat 14, Sun 15, Mon 16 … Sat 21, Sun 22.
assert.equal(dow('2026-11-15'), 0);

check('Sunday neither counts nor breaks', () => {
  const log = [e('2026-11-13'), e('2026-11-14'), e('2026-11-16')];
  assert.deepEqual(streakOf(log, '2026-11-16'), { cur: 3, best: 3 });
  // Training on a Sunday doesn't add to it either.
  assert.deepEqual(streakOf([...log, e('2026-11-15')], '2026-11-16'), { cur: 3, best: 3 });
});

check('today still to come does not break the streak', () => {
  const log = [e('2026-11-12'), e('2026-11-13'), e('2026-11-14')];
  assert.equal(streakOf(log, '2026-11-16').cur, 3, 'Monday, not trained yet');
  assert.equal(streakOf(log, '2026-11-15').cur, 3, 'a Sunday today');
});

check('a missed day starts again silently and keeps the best', () => {
  const log = [e('2026-11-09'), e('2026-11-10'), e('2026-11-11'), e('2026-11-12'), e('2026-11-16'), e('2026-11-17')];
  const s = streakOf(log, '2026-11-18');
  assert.deepEqual(s, { cur: 2, best: 4 });
  assert.equal(streakLine(s), '2 days in a row. Best 4.');
  assert.ok(!/miss|lost|broke|0/.test(streakLine(s)));
  assert.equal(streakOf(log, '2026-11-19').cur, 0, 'a day gone by');
  assert.equal(streakLine(streakOf(log, '2026-11-19')), 'Best: 4 days in a row.');
});

check('"I trained on my own" counts', () => {
  const log = [e('2026-11-16'), { d: '2026-11-17', s: 'On my own', h: false, own: true, n: {}, st: {} }];
  assert.equal(streakOf(log, '2026-11-17').cur, 2);
});

check('under 2 days shows no number; equal to the best says so', () => {
  assert.equal(streakLine(streakOf([], '2026-11-16')), '');
  assert.equal(streakLine(streakOf([e('2026-11-16')], '2026-11-16')), '');
  assert.equal(streakLine({ cur: 9, best: 9 }), '9 days in a row. Your best yet.');
  assert.equal(streakLine({ cur: 1, best: 1 }), '');
});

check('the grid: hard, light, no session, today not yet, and nothing', () => {
  const log = [e('2026-11-09', true), e('2026-11-10'), e('2026-11-12', true)];
  const cols = gridOf(log, '2026-11-18');
  assert.equal(cols.length, 12);
  assert.equal(cols[0].length, 6);
  const at = (d) => cols.flat().find((c) => c.d === d);
  assert.equal(at('2026-11-09').kind, 'h');
  assert.equal(at('2026-11-10').kind, 'l');
  assert.equal(at('2026-11-11').kind, 'm');
  assert.equal(at('2026-11-18').kind, 't');
  assert.equal(at('2026-11-19').kind, null, 'still to come');
  assert.equal(at('2026-11-02').kind, null, 'before he started');
  assert.equal(cols[11][0].d, '2026-11-16', 'this week last, from Monday');
  assert.equal(gridCount(cols), 3);
  assert.equal(cellTip(at('2026-11-09')), 'Last week, Monday: hard day');
  assert.equal(cellTip(at('2026-11-18')), 'Today: not yet');
});

check('a ladder chart breaks where he moved up', () => {
  const log = [
    e('2026-11-02', true, { lever: 8 }, { lever: 0 }), e('2026-11-05', true, { lever: 10 }, { lever: 0 }),
    e('2026-11-09', true, { lever: 4 }, { lever: 1 }), e('2026-11-12', true, { lever: 6 }, { lever: 1 })
  ];
  const pts = seriesOf(log, 'lever');
  assert.deepEqual(pts.map((p) => p.s), [0, 0, 1, 1]);
  const steps = ['Tuck front lever', 'Advanced tuck front lever', 'One-leg front lever', 'Straddle front lever', 'Front lever'];
  assert.equal(chartSentence({ k: 'lever', n: 'Front lever', u: 'seconds', lad: 'lever' }, pts, steps), 'Advanced tuck front lever: 6 seconds now, up from 4 at the start of this step.');
  assert.equal(pointSentence({ k: 'lever', u: 'seconds', lad: 'lever' }, pts[0], steps), 'Nov 2: 8 seconds, tuck');
  assert.equal(shortStep('Front lever'), 'Full');
  assert.equal(shortStep('Planche lean'), 'Lean');
  assert.equal(chartSentence({ k: 'vtest', n: 'Vertical', u: 'inches' }, []), 'Your chart starts with your first number.');
});

check('best yet: only against the same step, never for a first number', () => {
  const steps = { lever: ['Tuck front lever', 'Advanced tuck front lever'] };
  const a = e('2026-11-09', true, { lever: 10 }, { lever: 0 });
  const b = e('2026-11-12', true, { lever: 4 }, { lever: 1 });
  assert.deepEqual(bestYet([a, b], b, steps), [], 'the first number at a new step');
  const c = e('2026-11-16', true, { lever: 5 }, { lever: 1 });
  assert.deepEqual(bestYet([a, b, c], c, steps), ['advanced tuck front lever, 5 seconds'], 'beats 4 at its step, not 10 at the last');
  const d = e('2026-11-17', true, { lever: 5 }, { lever: 1 });
  assert.deepEqual(bestYet([a, b, c, d], d, steps), [], 'equal is not best');
  assert.deepEqual(bestYet([e('2026-11-02', true, { vtest: 24 }), e('2026-11-30', true, { vtest: 26 })], e('2026-11-30', true, { vtest: 26 })), ['vertical, 26 inches'], 'a copy of the entry (from the database) is not compared with itself');
  assert.equal(gateLine([a, b, c], c, '2026-11-16', { steps }), 'Best yet: advanced tuck front lever, 5 seconds.');
  assert.equal(gateLine([a, b, c], c, '2026-11-16', { steps, charts: false }), '');
  const run = [e('2026-11-13'), e('2026-11-14'), c];
  assert.equal(gateLine(run, c, '2026-11-16', { steps, charts: false }), '3 days in a row.');
});

check('the one-time fill reads Part 6 lines from the daily pages', () => {
  const names = new Map([
    ['tuck front lever hold', { k: 'lever', lad: 'lever', i: 0 }], ['planche lean hold', { k: 'planche', lad: 'planche', i: 0 }],
    ['vertical jump test', { k: 'vtest' }], ['free handstand practice', { k: 'free' }], ['pull-ups', { k: 'pull' }]
  ]);
  const sessions = new Map([['hard a', { hard: true }], ['light', {}], ['evaluation 1', { once: true }]]);
  const h = entryFromLines('2026-11-16', 'Training: Hard A', ['Warm up: 8 of 10 minutes', 'Tuck front lever hold with Planche lean hold: 8 and 6 seconds, 4 of 5 rounds', 'Pull-ups with Pseudo planche push-ups: 6 reps and 9 reps'], names, sessions);
  assert.deepEqual(h, { d: '2026-11-16', s: 'Hard A', h: true, n: { lever: 8, planche: 6, pull: 6 }, st: { lever: 0, planche: 0 } });
  const ev = entryFromLines('2026-11-14', 'Training: Evaluation 1', ['Vertical jump test: 24 inches, 5 of 5 jumps'], names, sessions);
  assert.equal(ev.h, true);
  assert.equal(ev.n.vtest, 24);
  const own = entryFromLines('2026-11-17', 'Training: on my own', [], names, sessions);
  assert.equal(own.own, true);
  assert.equal(own.h, false);
  assert.equal(entryFromLines('2026-11-17', 'Groceries', [], names, sessions), null);
});

check('the log keeps at least two years', () => {
  const log = [e('2024-08-01'), e('2024-12-01'), e('2026-11-16')];
  assert.deepEqual(trimLog(log, '2026-11-16').map((x) => x.d), ['2024-12-01', '2026-11-16']);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('training streak and charts: all good');
