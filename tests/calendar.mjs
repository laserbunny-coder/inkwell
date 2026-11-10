// Calendar events and area hours in Today. Google Calendar is read through the server's
// "calendar" function (a stand-in here: window.__calendar). Events are faint
// lines over a day's plan and in each day of Week; today's plan also says how
// much time is left before the day ends, less what's still on the calendar.
// Under the week, each area's hours worked against the hours it should get.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4272;
const DIST = process.env.DIST;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(DIST ? ['--outDir', DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
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

  await check('“left today” is the time from now to the end of your day, less what’s still on the calendar', async () => {
    assert.equal(await page.locator('#plan .pl-left').count(), 0, 'nothing to do: nothing to weigh');
    await add(page, 'Cut the trailer 2h');
    // 2:04 pm to 10 pm is 7 h 56 min; 4 to 5:30 is taken (the two overlap).
    assert.equal(await page.locator('#plan .pl-left').innerText(), '6 h 25 min left today');
    assert.match(await page.locator('#plan .pl-left').getAttribute('title'), /Until 10 pm, less what’s on your calendar/);
    assert.ok(await page.locator('#plan .pl-left').evaluate((b) => !b.classList.contains('over')));
    assert.equal(await page.locator('#plan .pl-sum').innerText(), '2 h to do');
    await add(page, 'Grade Reel 1 6h');
    assert.ok(await page.locator('#plan .pl-left').evaluate((b) => b.classList.contains('over')), 'more to do than time left');
    await shot(page, 'calendar-day');
  });

  await check('a click on it changes when your day ends', async () => {
    await page.locator('#plan .pl-left').click();
    await page.locator('.ask-input').fill('18:00');
    await page.locator('.ask .pill.primary').click();
    await page.waitForFunction(() => document.querySelector('#plan .pl-left')?.textContent === '2 h 25 min left today');
    assert.match(await page.locator('#plan .pl-left').getAttribute('title'), /Until 6 pm/);
    assert.equal((await all(page)).find((r) => r.id === 'settings-plan').fields.dayEnd, 18);
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
    assert.ok(first.indexOf('pw-ev') < first.indexOf('pw-task'), first.join(' '));
    assert.equal(await page.locator('.pl-meter-v').innerText(), '8 h of 45 h');
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
    // Left today no longer takes the events off.
    assert.equal(await page.locator('#plan .pl-left').innerText(), '3 h 55 min left today');
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await day(page, '2026-11-09');
    await sleep(500);
    assert.equal(await page.locator('#plan .pl-ev').count(), 0);
    await page.evaluate(() => localStorage.removeItem('cal-mode'));
  });

  await check('under Look: the events and “left today” can each be switched off', async () => {
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await day(page, '2026-11-09');
    await page.waitForSelector('#plan .pl-ev');
    await page.evaluate(() => document.documentElement.classList.add('hide-calendar', 'hide-hoursleft'));
    assert.ok(await page.locator('#plan .pl-cal').isHidden());
    assert.ok(await page.locator('#plan .pl-left').isHidden());
    await page.evaluate(() => document.documentElement.classList.remove('hide-calendar', 'hide-hoursleft'));
    assert.ok(await page.locator('input[data-show="calendar"]').count() && await page.locator('input[data-show="hoursleft"]').count());
    assert.deepEqual(page.errors, []);
  });

  await check('under the week: hours worked in each area this week, against the hours you mean to give it', async () => {
    const p = await open({ width: 1440, height: 900 });
    await p.evaluate(seed, AREAS);
    await p.reload();
    await p.waitForFunction(() => document.documentElement.dataset.started === '1');
    await go(p, { view: 'plan', tab: 'week' });
    await p.waitForSelector('.pw-areas .pa-row');
    const rows = () => p.locator('.pa-row').evaluateAll((els) => els.map((e) => `${e.querySelector('.pl-meter-n').textContent}: ${e.querySelector('.pl-meter-v').textContent}`));
    // Only areas with hours show until one is given a target. AI video's
    // two hours count for Filmmaking, the area it sits in.
    assert.deepEqual(await rows(), ['Filmmaking: 2 h', 'Business: 0.8 h']);
    await p.locator('.pa-more').click();
    const offered = await p.locator('.pop-menu .pop-item').allInnerTexts();
    assert.ok(offered.includes('AI video') && offered.includes('Personal') && !offered.includes('Filmmaking'), offered.join(' | '));
    await p.locator('.pop-menu .pop-item', { hasText: 'AI video' }).click();
    await p.locator('.ask-input').fill('10');
    await p.locator('.ask .pill.primary').click();
    await p.waitForFunction(() => document.querySelectorAll('.pa-row').length === 3);
    // An area inside another comes right under it.
    assert.deepEqual(await rows(), ['Filmmaking: 2 h', 'AI video: 2 h of 10 h', 'Business: 0.8 h']);
    assert.equal(await p.locator('.pa-row[data-area="ar_ai"] .pl-track i').evaluate((i) => i.style.width), '20%');
    await p.locator('.pa-row[data-area="area-filmmaking"] .pl-meter-v').click();
    await p.locator('.ask-input').fill('1.5');
    await p.locator('.ask .pill.primary').click();
    await p.waitForFunction(() => document.querySelector('.pa-row[data-area="area-filmmaking"] .pl-meter-v')?.textContent === '2 h of 1.5 h');
    assert.ok(await p.locator('.pa-row[data-area="area-filmmaking"] .pl-track i').evaluate((i) => i.classList.contains('met')));
    assert.deepEqual((await all(p)).find((r) => r.id === 'settings-plan').fields.areas, { ar_ai: 10, 'area-filmmaking': 1.5 });
    await shot(p, 'calendar-areas');
    // The week before: its own hours; an area with a target shows even at nothing.
    await p.locator('#plan-sheet [data-act="week-prev"]').click();
    await p.waitForFunction(() => history.state?.week === '2026-11-02');
    // AI video reads the same in both weeks, so wait for Business (no hours that week) to go.
    await p.waitForFunction(() => !document.querySelector('.pa-row[data-area="area-business"]') && document.querySelector('.pa-row[data-area="ar_ai"] .pl-meter-v')?.textContent === '2 h of 10 h');
    assert.deepEqual(await rows(), ['Filmmaking: 2 h of 1.5 h', 'AI video: 2 h of 10 h']);
    // 0 takes a target away.
    await p.locator('.pa-row[data-area="area-filmmaking"] .pl-meter-v').click();
    await p.locator('.ask-input').fill('0');
    await p.locator('.ask .pill.primary').click();
    await p.waitForFunction(() => document.querySelector('.pa-row[data-area="area-filmmaking"] .pl-meter-v')?.textContent === '2 h');
    await p.evaluate(() => document.documentElement.classList.add('hide-areahours'));
    assert.ok(await p.locator('.pw-areas').isHidden());
    assert.ok(await p.locator('input[data-show="areahours"]').count());
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });

  await check('on a phone the events fit, and nothing spills', async () => {
    const phone = await open(undefined, { ...devices['Pixel 7'] });
    await day(phone, '2026-11-09');
    await phone.waitForSelector('#plan .pl-ev');
    await add(phone, 'Cut the trailer 2h');
    assert.equal(await phone.locator('#plan .pl-left').innerText(), '6 h 25 min left today');
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(wide <= 1, `the page spills ${wide}`);
    await shot(phone, 'calendar-phone');
    await go(phone, { view: 'plan', tab: 'week' });
    await phone.waitForSelector('.pw-ev');
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
