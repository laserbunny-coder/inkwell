// Calendar events and area hours in Today. Google Calendar is read through the server's
// "calendar" function (a stand-in here: window.__calendar). Events are faint
// lines over a day's plan and in each day of Week; today's plan also says how
// much time is left before the day ends, less what's still on the calendar.
// Under the week, each area's hours worked against the hours it should get.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4272;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const NOW = '2026-11-09T14:04:00-08:00'; // a Monday, 2:04 pm

const at = (s) => `${s}:00-08:00`;
const EVENTS = [
  { id: 'c1:dentist', title: 'Dentist', start: at('2026-11-09T16:00'), end: at('2026-11-09T17:00'), allDay: false, calendar: 'Michael', color: '#7986cb' },
  { id: 'c1:standup', title: 'Standup with Nate', start: at('2026-11-09T09:30'), end: at('2026-11-09T10:00'), allDay: false, calendar: 'Acro', color: '#33b679' },
  { id: 'c1:dana', title: 'Call with Dana', start: at('2026-11-09T16:30'), end: at('2026-11-09T17:30'), allDay: false, calendar: 'Michael', color: '#7986cb' },
  { id: 'c2:bday', title: 'Arrow’s birthday', start: '2026-11-09', end: '2026-11-10', allDay: true, calendar: 'Family', color: '#e67c73' },
  { id: 'c2:fest', title: 'Film festival', start: '2026-11-12', end: '2026-11-15', allDay: true, calendar: 'Michael', color: '#7986cb' },
  { id: 'c1:prep', title: 'Shoot prep', start: at('2026-11-10T10:00'), end: at('2026-11-10T12:00'), allDay: false, calendar: 'Michael', color: '#7986cb' },
];

// For the area hours: two areas with projects, and work ticked off in them.
const now = Date.parse(NOW);
const DAY = 864e5;
const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 30 * DAY, updated_at: now - 2 * 36e5 };
const row0 = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const done = (id, parent, sort, text, when, actual, t = {}) => row0(id, 'line', parent, sort, {
  text, content: [{ type: 'text', text }],
  fields: { done: true, box: true, task: { v: 1, day: when.slice(0, 10), est: 60, done_at: Date.parse(at(when)), actual, log: [], run: null, order: sort, ...t } }
});
const AREAS = [
  // Filmmaking, Business and Personal are there from the start.
  row0('ar_ai', 'area', 'area-filmmaking', 51, { title: 'AI video', fields: { color: '#7BC8A4' } }),
  row0('wd_nb', 'world', null, 1, { title: 'The Ninja Bunch', area_id: 'ar_ai', fields: { shape: 'show' } }),
  row0('steps-wd_nb', 'page', 'wd_nb', 10, { title: 'Steps' }),
  row0('wd_acro', 'world', null, 2, { title: 'Acro ads', area_id: 'area-business', fields: { life: true } }),
  row0('steps-wd_acro', 'page', 'wd_acro', 10, { title: 'Steps' }),
  row0('page-tasks', 'page', null, 9000, { title: 'Tasks' }),
  // This week (Monday the 9th): an hour and a half, and a repeat done once.
  done('a1', 'steps-wd_nb', 1, 'Board Reel 1', '2026-11-09T10:00', 90),
  row0('a2', 'line', 'steps-wd_nb', 2, { text: 'Post a clip', content: [{ type: 'text', text: 'Post a clip' }], fields: { done: false, box: true, task: { v: 1, day: '2026-11-16', est: 30, done_at: null, actual: null, log: [], run: null, order: 2, repeat: { every: 'week', n: 1, days: [1], from: '2026-11-02' }, did: [['2026-11-09', 30, Date.parse(at('2026-11-09T11:00'))]] } } }),
  done('a3', 'steps-wd_acro', 1, 'Ad copy for the fall intake', '2026-11-09T12:00', 45),
  // Not counted: last week's, Nate's, a habit, and one outside any project.
  done('a4', 'steps-wd_nb', 3, 'Reel 1 prompts', '2026-11-05T15:00', 120),
  done('a5', 'steps-wd_acro', 2, 'Call the print shop', '2026-11-09T09:00', 60, { owner: 'nate' }),
  done('a6', 'page-tasks', 1, 'Tidy the desk', '2026-11-09T08:00', 20),
];
const seed = (rows) => new Promise((res, rej) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => {
    const tx = r.result.transaction(['entries', 'outbox'], 'readwrite');
    for (const x of rows) { tx.objectStore('entries').put(x); tx.objectStore('outbox').put({ id: x.id }); }
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  };
});

const browser = withoutSync(await chromium.launch());
async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, ...extra });
  const asked = [];
  await ctx.exposeFunction('__calAsked', (a, b) => { asked.push([a, b]); });
  await ctx.addInitScript((events) => {
    window.__calendar = async (a, b) => {
      window.__calAsked(a, b);
      const mode = localStorage.getItem('cal-mode');
      if (mode === 'down') throw new Error('offline');
      if (mode === 'none') return { connected: false, events: [] };
      return { connected: true, events };
    };
  }, EVENTS);
  const page = await ctx.newPage();
  page.asked = asked;
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return page;
}
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const go = async (p, place) => {
  await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
  await p.waitForFunction((pl) => (document.documentElement.dataset.view || 'write') === pl.view && history.state?.view === pl.view, place);
  await still(p);
  await sleep(350);
};
const day = (p, d) => go(p, { view: 'notebook', pageId: `day-${d}` });
const lines = (p, sel = '#plan .pl-ev') => p.locator(sel).evaluateAll((els) => els.map((e) => [...e.querySelectorAll('span')].map((s) => s.textContent).join(' | ')));
const add = async (p, text) => { const input = p.locator('#plan input[data-add]').first(); await input.fill(text); await input.press('Enter'); await sleep(400); };
const shot = async (p, name) => { if (SHOTS) { await p.evaluate(() => document.querySelector('.toast')?.remove()); await still(p); await sleep(250); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 10).join('\n     ')}`); }
}

try {
  const page = await open({ width: 1440, height: 900 });
  await day(page, '2026-11-09');

  await check('today’s calendar sits over the plan as faint lines: all day first, then by the clock; what’s over is fainter', async () => {
    await page.waitForSelector('#plan .pl-ev');
    assert.deepEqual(await lines(page), [
      'All day | Arrow’s birthday',
      '9:30 am | Standup with Nate | 30 min',
      '4 pm | Dentist | 1 h',
      '4:30 pm | Call with Dana | 1 h',
    ]);
    assert.deepEqual(await page.locator('#plan .pl-ev').evaluateAll((els) => els.map((e) => e.classList.contains('past'))), [false, true, false, false]);
    assert.match(await page.locator('#plan .pl-ev', { hasText: 'Dentist' }).getAttribute('title'), /Dentist · 4 pm to 5 pm · Michael/);
    // It asked for this one day, midnight to midnight here.
    assert.deepEqual(page.asked[0], ['2026-11-09T08:00:00.000Z', '2026-11-10T08:00:00.000Z']);
    // Events aren't tasks: nothing to tick, nothing written.
    assert.equal(await page.locator('#plan .pl-ev .pl-check').count(), 0);
    assert.ok(!(await all(page)).some((r) => /Dentist/.test(r.text || r.title || '')));
  });

  await check('another day’s page has that day’s events, and no “left today”', async () => {
    await day(page, '2026-11-10');
    await page.waitForSelector('#plan .pl-ev');
    assert.deepEqual(await lines(page), ['10 am | Shoot prep | 2 h']);
    assert.equal(await page.locator('#plan .pl-left').count(), 0);
    await day(page, '2026-11-11');
    await sleep(400);
    assert.equal(await page.locator('#plan .pl-ev').count(), 0);
    assert.ok(await page.locator('#plan .pl-cal').isHidden());
  });

  await check('Week has each day’s events on top of its tasks; one that runs for days is on each of them', async () => {
    await go(page, { view: 'plan', tab: 'week' });
    await page.waitForSelector('.pw-day .pw-ev');
    const on = (d) => lines(page, `.pw-day[data-day="${d}"] .pw-ev`);
    assert.deepEqual(await on('2026-11-09'), ['All day | Arrow’s birthday', '9:30 am | Standup with Nate', '4 pm | Dentist', '4:30 pm | Call with Dana']);
    assert.deepEqual(await on('2026-11-10'), ['10 am | Shoot prep']);
    assert.deepEqual(await on('2026-11-11'), []);
    for (const d of ['2026-11-12', '2026-11-13', '2026-11-14']) assert.deepEqual(await on(d), ['All day | Film festival']);
    assert.deepEqual(await on('2026-11-15'), []);
    assert.deepEqual(page.asked.at(-1), ['2026-11-09T08:00:00.000Z', '2026-11-16T08:00:00.000Z']);
    // Events come before the tasks in a day, and the week's hours don't count them.
    const first = await page.locator('.pw-day[data-day="2026-11-09"] > *').evaluateAll((els) => els.map((e) => e.className.split(' ')[0]));
    if (first.includes('pw-task')) assert.ok(first.indexOf('pw-ev') < first.indexOf('pw-task'), first.join(' '));
    await shot(page, 'calendar-week');
  });

  await check('what was last seen is kept: with no connection the events still show', async () => {
    await page.evaluate(() => localStorage.setItem('cal-mode', 'down'));
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await day(page, '2026-11-09');
    await page.waitForSelector('#plan .pl-ev');
    assert.equal(await page.locator('#plan .pl-ev').count(), 4);
    assert.deepEqual(page.errors, []);
  });

  await check('with Google Calendar not connected there are no events, and nothing stale is left', async () => {
    await page.evaluate(() => localStorage.setItem('cal-mode', 'none'));
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await day(page, '2026-11-09');
    await page.waitForFunction(() => !document.querySelector('#plan .pl-ev'));
    assert.ok(await page.locator('#plan .pl-cal').isHidden());
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await day(page, '2026-11-09');
    await sleep(500);
    assert.equal(await page.locator('#plan .pl-ev').count(), 0);
    await page.evaluate(() => localStorage.removeItem('cal-mode'));
  });

  await check('the events are always there: no switch for them under Look', async () => {
    await page.evaluate(() => localStorage.setItem('hide', JSON.stringify(['calendar'])));
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await day(page, '2026-11-09');
    await page.waitForSelector('#plan .pl-ev');
    assert.ok(await page.locator('#plan .pl-cal').isVisible(), 'an old hidden choice brings them back');
    assert.equal(await page.locator('input[data-show="calendar"]').count(), 0);
    assert.deepEqual(page.errors, []);
  });

  await check('on a phone the events fit, and nothing spills', async () => {
    const phone = await open(undefined, { ...devices['Pixel 7'], todayPage: false });
    await day(phone, '2026-11-09');
    // (On a phone the day's page shows its words; the plan is the List face.)
    await phone.waitForSelector('#plan .pl-ev', { state: 'attached' });
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(wide <= 1, `the page spills ${wide}`);
    await shot(phone, 'calendar-phone');
    await go(phone, { view: 'plan', tab: 'week' });
    await phone.waitForSelector('.pw-rows .pw-row');
    const wide2 = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(wide2 <= 1, `the week spills ${wide2}`);
    assert.deepEqual(phone.errors, []);
    await phone.context().close();
  });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall calendar checks passed');
