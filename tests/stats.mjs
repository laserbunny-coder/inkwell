import assert from 'node:assert/strict';
import { measure, progress, dayOf } from '../src/stats.js';

// Progress from daily tallies, and estimates for days before tallies began.
const DAY = 86400000;
const noon = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
const now = noon(2026, 10, 21);
const row = (id, kind, parent, text, created, extra = {}) => ({ id, kind, parent_id: parent, text, created_at: created, updated_at: created, deleted: false, fields: {}, ...extra });
const base = [
  row('p1', 'project', null, '', now - 5 * DAY, { title: 'Novel', fields: { type: 'novel' } }),
  row('a1', 'act', 'p1', '', now - 5 * DAY),
  row('c1', 'chapter', 'a1', '', now - 5 * DAY),
  row('x1', 'para', 'c1', 'one two three', now - 2 * DAY),
  row('x2', 'para', 'c1', 'four five', now - DAY),
  row('s1', 'project', null, '', now - 5 * DAY, { title: 'Script', fields: { type: 'screenplay' } }),
  row('sa', 'act', 's1', '', now - 5 * DAY),
  row('sc', 'chapter', 'sa', '', now - 5 * DAY),
  row('y1', 'para', 'sc', 'INT. HOUSE - DAY', now - DAY, { fields: { el: 'scene' } }),
  row('d1', 'day', null, '', now - DAY),
  row('l1', 'line', 'd1', 'a note line', now - DAY),
  row('gone', 'para', 'c1', 'deleted words here', now - DAY, { deleted: true })
];

const m = measure(base);
assert.equal(m.books.p1.w, 5);
assert.equal(m.books.s1.w, 4);
assert.ok(m.books.s1.l > 0);
assert.equal(m.notes, 3);

// A kept copy of a draft (New draft from this one) isn't new writing; a draft set aside to start from scratch still counts.
const copied = [...base,
  row('dc', 'draft', 'p1', '', now, { fields: { n: 1, copy: true } }), row('dca', 'act', 'dc', '', now), row('dcc', 'chapter', 'dca', '', now),
  row('cx', 'para', 'dcc', 'one two three four five', now),
  row('dk', 'draft', 'p1', '', now, { fields: { n: 1 } }), row('dka', 'act', 'dk', '', now), row('dkc', 'chapter', 'dka', '', now),
  row('kx', 'para', 'dkc', 'old words', now - 3 * DAY)];
assert.equal(measure(copied).books.p1.w, 7);

// No tallies yet: every day is an estimate from when things were started.
let p = progress(base, { unit: 'day', count: 3, now });
assert.deepEqual(p.series.p1.map((x) => x.w), [3, 2, 0]);
assert.deepEqual(p.series.all.map((x) => x.w), [3, 9, 0]);
assert.equal(p.totals.all.w, 12);

// The first tally starts from what was there before today; today's writing is the difference.
const today = dayOf(now);
const tally = (day, end, start) => ({ id: `tally-${day}`, kind: 'tally', deleted: false, created_at: now, updated_at: now, fields: { day, end, ...(start ? { start } : {}) } });
const grown = [...base.filter((r) => r.id !== 'x2'), { ...base.find((r) => r.id === 'x2'), text: 'four five six seven' }];
const m2 = measure(grown);
const start = { books: { p1: { w: 5, l: 0 }, s1: m.books.s1 }, notes: 3 };
p = progress([...grown, tally(today, { books: m2.books, notes: m2.notes }, start)], { unit: 'day', count: 2, now });
assert.equal(p.series.p1[1].w, 2, 'two words added today');
assert.equal(p.series.all[1].w, 2);
assert.equal(p.estimatedBefore, today);

// A later day counts from the tally before it; a quiet day counts nothing.
const later = now + 2 * DAY;
const t2 = tally(dayOf(later), { books: { ...m2.books, p1: { w: 20, l: 0 } }, notes: m2.notes });
p = progress([...grown, tally(today, { books: m2.books, notes: m2.notes }, start), t2], { unit: 'day', count: 3, now: later });
assert.deepEqual(p.series.p1.map((x) => x.w), [2, 0, 13]);

// Weeks and months add their days up.
p = progress([...grown, tally(today, { books: m2.books, notes: m2.notes }, start), t2], { unit: 'week', count: 2, now: later });
// (Estimated days use paragraphs as they are now, so yesterday reads 4: close enough.)
  assert.equal(p.series.p1.reduce((n, x) => n + x.w, 0), 3 + 4 + 2 + 13);

// A deleted book doesn't count against everything else.
const t3 = tally(dayOf(later + DAY), { books: { s1: m2.books.s1 }, notes: m2.notes });
p = progress([...grown, tally(today, { books: m2.books, notes: m2.notes }, start), t2, t3], { unit: 'day', count: 1, now: later + DAY });
assert.equal(p.series.all[0].w, 0);

console.log('ok   progress counts by day, week and month');

// A world's total is every piece in it, however deep (a season holding its episodes), and nothing outside it.
const inWorld = [...base,
  row('w1', 'world', null, '', now - 5 * DAY, { title: 'The Ninja Bunch' }),
  row('e1', 'project', 'w1', '', now - 5 * DAY, { title: 'Pilot', fields: { type: 'screenplay' } }),
  row('e1a', 'act', 'e1', '', now - 5 * DAY), row('e1c', 'chapter', 'e1a', '', now - 5 * DAY),
  row('e1x', 'para', 'e1c', 'KENJI bows low', now - DAY),
  row('se', 'project', 'w1', '', now - 5 * DAY, { title: 'Season 1', fields: { type: 'lines' } }),
  row('e2', 'project', 'se', '', now - 5 * DAY, { title: 'Episode 2', fields: { type: 'novel' } }),
  row('e2a', 'act', 'e2', '', now - 5 * DAY), row('e2c', 'chapter', 'e2a', '', now - 5 * DAY),
  row('e2x', 'para', 'e2c', 'the dojo smells of rice', now)
];
const mw = measure(inWorld);
assert.equal(mw.info.e1.world, 'w1');
assert.equal(mw.info.e2.world, 'w1', 'an episode inside a season still belongs to the world');
assert.equal(mw.info.p1.world, null);
assert.deepEqual(mw.worlds, { w1: { title: 'The Ninja Bunch' } });
p = progress(inWorld, { unit: 'day', count: 2, now });
assert.equal(p.totals.w1.w, 3 + 5);
assert.deepEqual(p.series.w1.map((x) => x.w), [3, 5]);
assert.equal(p.totals.all.w, 12 + 8, 'worlds are not counted twice in everything');
console.log('ok   word total for each world\n\nall passed');
