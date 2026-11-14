// What's when: loose time (a week, a month, later), one When picker, the
// planning page with its six headings, and lines pulled in from a project
// (beside on a computer, the bottom half on a phone), which also feed Week and
// Weeks ahead.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4291;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;

// Friday November 13 2026, 9:10 am in Los Angeles. Tomorrow is Saturday the
// 14th; this week ends Sunday the 15th; next week is the 16th to the 22nd;
// "This month" is the 23rd to the 30th.
const NOW = '2026-11-13T09:10:00-08:00';
const now = Date.parse(NOW);
const DAY = 864e5;
const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 20 * DAY, updated_at: now - 36e5 };
const row = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const line = (id, parent, sort, text, fields = {}) => row(id, 'line', parent, sort, { text, content: [{ type: 'text', text }], fields: { done: false, ...fields } });
const task = (id, parent, sort, text, t = {}) => line(id, parent, sort, text, { box: true, task: { v: 1, day: null, est: null, done_at: null, actual: null, log: [], run: null, order: sort, ...t } });
const SEED = [
  row('wd_nb', 'world', null, 1, { title: 'The Ninja Bunch', area_id: 'area-filmmaking', fields: { shape: 'show' }, updated_at: now - 1000 }),
  row('steps-wd_nb', 'page', 'wd_nb', 2048, { title: 'Steps' }),
  line('st_1', 'steps-wd_nb', 1, 'Pick the stills'),
  line('st_2', 'steps-wd_nb', 2, 'Board Reel 3'),
  line('st_2a', 'st_2', 1, 'Kenji close-up'),
  task('st_3', 'steps-wd_nb', 3, 'Write Kenji’s verse', { day: '2026-11-13' }),
  task('st_4', 'steps-wd_nb', 4, 'Rough cut Reel 2', { span: { kind: 'week', start: '2026-11-16' } }),
  task('st_5', 'steps-wd_nb', 5, 'Send boards to Nate', { day: '2026-11-17' }),
  task('st_6', 'steps-wd_nb', 6, 'Color pass', { span: { kind: 'month', start: '2026-11-01' } }),
  task('st_7', 'steps-wd_nb', 7, 'Song for Reel 4', { span: { kind: 'later', start: null } }),
  task('st_8', 'steps-wd_nb', 8, 'Old loose one', { span: { kind: 'week', start: '2026-11-02' } }),
  line('st_9', 'steps-wd_nb', 9, 'Pick a voice for Mochi'),
  row('pg_kenji', 'page', 'wd_nb', 100, { title: 'Kenji' }),
  line('kj_1', 'pg_kenji', 1, 'Find his laugh'),
  row('wd_acro', 'world', null, 2, { title: 'Acro ads', area_id: 'area-business', fields: { life: true }, updated_at: now - 5000 }),
  row('steps-wd_acro', 'page', 'wd_acro', 1, { title: 'Steps' }),
  line('ac_1', 'steps-wd_acro', 1, 'Spending limit on the ad account'),
  row('page-tasks', 'page', null, 0, { title: 'Tasks' }),
  task('tk_old', 'page-tasks', 1, 'Call the printer', { day: '2026-11-11' }),
  task('tk_nate', 'page-tasks', 2, 'Film the tumbling class', { day: '2026-11-13', owner: 'nate' }),
];
const seed = (rows) => new Promise((res, rej) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => {
    const tx = r.result.transaction(['entries', 'outbox'], 'readwrite');
    for (const x of rows) { tx.objectStore('entries').put(x); tx.objectStore('outbox').put({ id: x.id }); }
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  };
  r.onerror = () => rej(r.error);
});
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const get = async (p, id) => (await all(p)).find((r) => r.id === id);
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const under = (p, bucket) => p.locator(`.ww-sec[data-bucket="${bucket}"] .pl-task .pl-words`).allInnerTexts();
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const centre = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

const browser = withoutSync(await chromium.launch());
async function open(opts) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', ...opts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  await page.evaluate(seed, SEED);
  await page.evaluate(() => { localStorage.setItem('lastWorld', 'wd_nb'); });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return { ctx, page };
}
// A mouse drag from one point to another, in small steps.
async function drag(p, from, to) {
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  for (let k = 1; k <= 12; k++) { await p.mouse.move(from.x + ((to.x - from.x) * k) / 12, from.y + ((to.y - from.y) * k) / 12); await sleep(16); }
  await sleep(80);
  await p.mouse.up();
  await sleep(500);
}

try {
  // ---------- the rules, worked out on their own ----------
  const { horizon, whenOf, whenHeadings, looseWord, weekPlan, dayPlan } = await import('../src/tasks.js');
  await check('loose time: the headings move with the weeks, and a month near its end shows the next one by name', async () => {
    const h = horizon('2026-11-13');
    assert.deepEqual(whenHeadings(h).map((x) => x.label), ['Today', 'Tomorrow', 'This week', 'Next week', 'This month', 'Later']);
    assert.equal(whenOf({ day: '2026-11-11' }, h), 'today', 'a day gone by is today’s (carried over)');
    assert.equal(whenOf({ day: '2026-11-15' }, h), 'week');
    assert.equal(whenOf({ day: '2026-11-22' }, h), 'next');
    assert.equal(whenOf({ day: '2026-11-30' }, h), 'month');
    assert.equal(whenOf({ day: '2026-12-01' }, h), 'later');
    assert.equal(whenOf({ day: null, span: { kind: 'week', start: '2026-11-02' } }, h), 'week', 'a week gone by rolls on into this week');
    assert.equal(whenOf({ day: null, span: { kind: 'week', start: '2026-11-16' } }, h), 'next');
    assert.equal(whenOf({ day: null, span: { kind: 'week', start: '2026-11-23' } }, h), 'month');
    assert.equal(whenOf({ day: null, span: { kind: 'month', start: '2026-12-01' } }, h), 'later');
    const end = horizon('2026-11-24');
    assert.equal(end.month.label, 'December');
    assert.equal(whenOf({ day: null, span: { kind: 'month', start: '2026-11-01' } }, end), 'next', 'November, nearly over, sits under next week');
    assert.equal(whenOf({ day: null, span: { kind: 'month', start: '2026-12-01' } }, end), 'month');
    assert.equal(looseWord({ span: { kind: 'week', start: '2026-11-02' } }, '2026-11-13'), 'This week');
    // A December into January: the year is said.
    assert.equal(horizon('2026-12-28').month.label, 'January 2027');
  });
  await check('loose time: a task in a week or month is on no day’s list and never carried over; the Week tray holds the week’s loose ones', async () => {
    const it = (id, t) => ({ row: { id, fields: {} }, task: { day: null, order: 0, ...t }, mine: true });
    const items = [it('a', { span: { kind: 'week', start: '2026-11-09' } }), it('b', { span: { kind: 'week', start: '2026-11-02' } }), it('c', { span: { kind: 'month', start: '2026-11-01' } }), it('d', {}), it('e', { day: '2026-11-12' })];
    const p = dayPlan(items, '2026-11-13', '2026-11-13');
    assert.deepEqual(p.carried.map((i) => i.row.id), ['e']);
    assert.deepEqual(p.open.map((i) => i.row.id), []);
    const w = weekPlan(items, '2026-11-13', '2026-11-13');
    assert.deepEqual(w.tray.map((i) => i.row.id).sort(), ['a', 'b'], 'this week’s loose tasks (and older weeks’), not ones with no When');
    assert.deepEqual(w.days.flatMap((d) => d.open).map((i) => i.row.id), ['e'], 'only the task on its own day');
    assert.deepEqual(weekPlan(items, '2026-11-20', '2026-11-13').tray.map((i) => i.row.id), [], 'next week’s tray has none of these');
  });

  // ---------- a computer ----------
  const { page } = await open({ viewport: { width: 1440, height: 900 } });

  await check('the switch at the top is Day, What’s when, Week, Weeks ahead, Pace, and What’s when has six headings with counts', async () => {
    await page.evaluate(() => document.querySelector('#view-toggle').click());
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    assert.deepEqual(await page.locator('.today-switch button').allInnerTexts(), ['Day', 'What’s when', 'Week', 'Weeks ahead', 'Pace']);
    await page.locator('.today-switch button', { hasText: 'What’s when' }).click();
    await page.waitForSelector('.ww-sec');
    await still(page);
    assert.deepEqual(await page.locator('.ww-name').allInnerTexts(), ['Today', 'Tomorrow', 'This week', 'Next week', 'This month', 'Later']);
    assert.deepEqual(await under(page, 'today'), ['Call the printer', 'Write Kenji’s verse'], 'carried over first; Nate’s task isn’t on your page');
    assert.deepEqual(await under(page, 'week'), ['Old loose one'], 'a week gone by rolls on quietly');
    assert.deepEqual(await under(page, 'next'), ['Rough cut Reel 2', 'Send boards to Nate']);
    assert.equal(await page.locator('.ww-sec[data-bucket="next"] .ww-date').innerText(), 'Tue 17', 'an exact day says its date');
    assert.deepEqual(await under(page, 'month'), ['Color pass']);
    assert.deepEqual(await under(page, 'later'), ['Song for Reel 4']);
    assert.equal(await page.locator('.ww-sec[data-bucket="next"] .ww-n').innerText(), '2');
    assert.equal(await page.locator('.ww-sec[data-bucket="today"] .pl-task', { hasText: 'Call the printer' }).locator('.pl-place').count(), 0, 'the Tasks page needs no name');
    assert.equal(await page.locator('.ww-sec[data-bucket="next"] .pl-place').first().innerText(), 'The Ninja Bunch', 'the project, faint at the right');
    assert.ok(await page.locator('.ww-sec[data-bucket="today"] .pl-task.carried .pl-from', { hasText: 'from' }).count());
  });

  await check('Pull from a project opens the last project beside the plan; the plan stays where it is', async () => {
    const before = await page.locator('.ww-sec').first().boundingBox();
    await page.locator('.pl-pull:visible').click();
    await page.waitForSelector('.pull:not([hidden]) .pu-line');
    assert.equal(await page.locator('.pu-name').innerText(), 'The Ninja Bunch');
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('pulling')));
    const lines = await page.locator('.pu-line .pu-words').allInnerTexts();
    assert.deepEqual(lines.slice(0, 4), ['Pick the stills', 'Board Reel 3', 'Kenji close-up', 'Write Kenji’s verse']);
    assert.equal(await page.locator('.pu-line[data-id="st_4"] .pu-whenis').innerText(), 'Next week');
    const after = await page.locator('.ww-sec').first().boundingBox();
    assert.ok(after.x <= before.x + 1 && after.width > 300, 'the plan keeps its place on the left');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.view), 'plan');
    await shot(page, 'd-when-pull');
  });

  await check('drag a plain line from the project onto “Next week”: it becomes a task loose in next week, and stays in its project', async () => {
    const from = await centre(page.locator('.pu-line[data-id="st_1"] .pu-words'));
    const to = await centre(page.locator('.ww-sec[data-bucket="next"] .ww-h'));
    await drag(page, from, to);
    await page.waitForFunction(() => [...document.querySelectorAll('.ww-sec[data-bucket="next"] .pl-words')].some((x) => x.textContent === 'Pick the stills'));
    const r = await get(page, 'st_1');
    assert.equal(r.parent_id, 'steps-wd_nb');
    assert.deepEqual(r.fields.task.span, { kind: 'week', start: '2026-11-16' });
    assert.equal(r.fields.task.day, null);
    assert.equal(r.fields.box, true);
    assert.match(await page.locator('.toast').innerText(), /“Pick the stills” → Next week · now a task/);
    assert.deepEqual(await under(page, 'next'), ['Rough cut Reel 2', 'Send boards to Nate', 'Pick the stills']);
    await page.waitForFunction(() => document.querySelector('.pu-line[data-id="st_1"] .pu-whenis')?.textContent === 'Next week');
  });

  await check('Undo puts the line back as it was: a plain line again', async () => {
    await page.locator('.toast .toast-action', { hasText: 'Undo' }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('.ww-sec[data-bucket="next"] .pl-words')].some((x) => x.textContent === 'Pick the stills'));
    const r = await get(page, 'st_1');
    assert.equal(r.fields.task, undefined);
    assert.notEqual(r.fields.box, true);
  });

  await check('drop a line among the ones under a heading: it lands where the line shows', async () => {
    const from = await centre(page.locator('.pu-line[data-id="st_9"] .pu-words'));
    const t = await page.locator('.ww-sec[data-bucket="next"] .pl-task', { hasText: 'Rough cut Reel 2' }).boundingBox();
    await drag(page, from, { x: t.x + 120, y: t.y + t.height - 3 });
    await page.waitForFunction(() => [...document.querySelectorAll('.ww-sec[data-bucket="next"] .pl-words')].some((x) => x.textContent === 'Pick a voice for Mochi'));
    assert.deepEqual(await under(page, 'next'), ['Rough cut Reel 2', 'Pick a voice for Mochi', 'Send boards to Nate']);
  });

  await check('pick two lines in the project and drag them together onto “Later”', async () => {
    await page.locator('.pu-line[data-id="st_2"] .pu-words').click();
    await page.locator('.pu-line[data-id="kj_1"]').count() || await page.locator('.pu-sec', { hasText: 'Kenji' }).click();
    await page.waitForSelector('.pu-line[data-id="kj_1"]');
    await page.locator('.pu-line[data-id="kj_1"] .pu-words').click();
    assert.equal(await page.locator('.pu-count').innerText(), '2 picked');
    await page.setViewportSize({ width: 1440, height: 1200 }); // the heading clear of the strip that scrolls
    await sleep(200);
    const from = await centre(page.locator('.pu-line[data-id="st_2"] .pu-words'));
    const to = await centre(page.locator('.ww-sec[data-bucket="later"] .ww-h'));
    await drag(page, from, to);
    await page.waitForFunction(() => document.querySelectorAll('.ww-sec[data-bucket="later"] .pl-task').length === 3);
    assert.deepEqual(await under(page, 'later'), ['Song for Reel 4', 'Board Reel 3', 'Find his laugh']);
    assert.deepEqual((await get(page, 'kj_1')).fields.task.span, { kind: 'later', start: null });
    assert.equal((await get(page, 'kj_1')).parent_id, 'pg_kenji');
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await check('the When picker by keyboard: Alt + W on a task, type “fri”, Enter', async () => {
    await page.locator('.ww-sec[data-bucket="month"] .pl-words', { hasText: 'Color pass' }).focus();
    await page.keyboard.press('Alt+KeyW');
    await page.waitForSelector('.when-pick');
    assert.deepEqual((await page.locator('.when-pick .wp-opt:not(.chip) .wp-l').allInnerTexts()).slice(0, 7), ['Today', 'Tomorrow', 'This week', 'Next week', 'This month', 'Later', 'Not planned']);
    assert.ok(await page.locator('.when-pick .wp-opt.current', { hasText: 'This month' }).count(), 'its time now is lit');
    await shot(page, 'd-when-picker');
    await page.keyboard.type('fri');
    assert.deepEqual(await page.locator('.when-pick .wp-opt .wp-l').allInnerTexts(), ['Fri 20']);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.ww-sec[data-bucket="next"] .pl-words')].some((x) => x.textContent === 'Color pass'));
    const r = await get(page, 'st_6');
    assert.equal(r.fields.task.day, '2026-11-20');
    assert.equal(r.fields.task.span, null, 'a day and a span never go together');
  });

  await check('Esc closes the picker; Esc again closes the project pane and gives the plan its width back', async () => {
    await page.locator('.ww-sec[data-bucket="later"] .pl-words', { hasText: 'Song for Reel 4' }).focus();
    await page.keyboard.press('Alt+KeyW');
    await page.waitForSelector('.when-pick');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.when-pick').count(), 0);
    await page.locator('.ww-h').first().click({ position: { x: 600, y: 5 } }).catch(() => {});
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.documentElement.classList.contains('pulling'));
    assert.ok(await page.locator('.pull').isHidden());
  });

  await check('fold a heading: it stays folded, and its count still shows', async () => {
    await page.locator('.ww-sec[data-bucket="later"] .ww-fold').click();
    await page.waitForSelector('.ww-sec[data-bucket="later"].folded');
    assert.ok(await page.locator('.ww-sec[data-bucket="later"] .ww-list').isHidden());
    assert.equal(await page.locator('.ww-sec[data-bucket="later"] .ww-n').innerText(), '3');
    await page.reload();
    await page.waitForSelector('.ww-sec');
    assert.ok(await page.locator('.ww-sec[data-bucket="later"].folded').count(), 'still folded after a reload');
    await page.locator('.ww-sec[data-bucket="later"] .ww-fold').click();
  });

  await check('a loose task is on no day’s plan: today’s page shows only today’s and the carried-over one', async () => {
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    await page.waitForSelector('#plan .pl-task');
    const words = await page.locator('#plan .pl-task .pl-words').allInnerTexts();
    assert.deepEqual(words, ['Call the printer', 'Write Kenji’s verse']);
  });

  await check('Week: from Week alone, one press and one drag puts a project step on a day; the tray is “Any day this week”', async () => {
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await page.waitForSelector('.pw-week');
    assert.equal(await page.locator('.pw-tray .pl-label').innerText(), 'ANY DAY THIS WEEK');
    assert.deepEqual(await page.locator('.pw-tray .pw-task .pw-t').allInnerTexts(), ['Old loose one'], 'no task without a When is listed');
    await page.locator('.pl-pull:visible').click();
    await page.waitForSelector('.pull:not([hidden]) .pu-line');
    const from = await centre(page.locator('.pu-line', { hasText: 'Pick the stills' }).locator('.pu-words'));
    const sat = await centre(page.locator('.pw-day[data-day="2026-11-14"] .pw-h'));
    await drag(page, from, { x: sat.x, y: sat.y + 60 });
    await page.waitForFunction(() => [...document.querySelectorAll('.pw-day[data-day="2026-11-14"] .pw-t')].some((x) => x.textContent === 'Pick the stills'));
    assert.equal((await get(page, 'st_1')).fields.task.day, '2026-11-14');
    await shot(page, 'd-week-pull');
  });

  await check('Week: a drop on the tray gives the week with no day', async () => {
    const from = await centre(page.locator('.pu-line', { hasText: 'Pick a voice for Mochi' }).locator('.pu-words'));
    const tray = await centre(page.locator('.pw-tray .pl-label'));
    await drag(page, from, tray);
    await page.waitForFunction(() => [...document.querySelectorAll('.pw-tray .pw-t')].some((x) => x.textContent === 'Pick a voice for Mochi'));
    assert.deepEqual((await get(page, 'st_9')).fields.task.span, { kind: 'week', start: '2026-11-09' });
  });

  await check('Weeks ahead: a task loose in a week is a quiet mark in its week; a drop on a week gives it that week', async () => {
    await page.locator('.today-switch button', { hasText: 'Weeks ahead' }).click();
    await page.waitForSelector('.ah');
    assert.ok(await page.locator('.pull').isVisible(), 'the project pane stays open from view to view');
    const mark = page.locator('.ah-loose', { hasText: 'Rough cut Reel 2' });
    assert.equal(await mark.count(), 1);
    assert.equal(await mark.evaluate((el) => el.style.gridColumn), '2');
    const from = await centre(page.locator('.pu-line', { hasText: 'Board Reel 3' }).locator('.pu-words'));
    const col = await centre(page.locator('.ah-h').nth(3));
    await drag(page, from, { x: col.x, y: col.y + 80 });
    await page.waitForFunction(() => [...document.querySelectorAll('.ah-loose')].some((x) => x.textContent === 'Board Reel 3'));
    assert.deepEqual((await get(page, 'st_2')).fields.task.span, { kind: 'week', start: '2026-11-30' });
    await shot(page, 'd-ahead-pull');
  });

  await check('the pane’s title switches project: click, type a few letters, Enter; the plan doesn’t move', async () => {
    await page.locator('.pu-title').click();
    await page.waitForSelector('.pu-switch');
    await page.keyboard.type('acr');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.pu-name')?.textContent === 'Acro ads');
    assert.deepEqual(await page.locator('.pu-line .pu-words').allInnerTexts(), ['Spending limit on the ad account']);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.view), 'plan');
    await page.locator('.pu-x').click();
  });

  await check('Ctrl + click on a project in the rail opens it beside a planning view; right-click offers Open beside', async () => {
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await page.waitForSelector('.pw-week');
    await page.locator('.rail-project', { hasText: 'Acro ads' }).click({ modifiers: ['Control'] });
    await page.waitForFunction(() => document.querySelector('.pu-name')?.textContent === 'Acro ads');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.view), 'plan', 'the Week stays');
    await page.locator('.pu-x').click();
    await page.locator('.rail-project', { hasText: 'The Ninja Bunch' }).click({ button: 'right' });
    await page.locator('.pop-menu .pop-item', { hasText: 'Open beside' }).click();
    await page.waitForFunction(() => document.querySelector('.pu-name')?.textContent === 'The Ninja Bunch');
    await page.locator('.pu-x').click();
  });

  await check('in an outline, Alt + W plans the line the cursor is on (and makes it a task)', async () => {
    await page.evaluate(() => localStorage.setItem('place', JSON.stringify({ view: 'notebook', pageId: 'steps-wd_acro' })));
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await page.waitForSelector('#outline-editor li');
    await page.locator('#outline-editor li p', { hasText: 'Spending limit' }).click();
    await page.keyboard.press('Alt+KeyW');
    await page.waitForSelector('.when-pick');
    await page.keyboard.type('later');
    await page.keyboard.press('Enter');
    await sleep(800);
    const r = await get(page, 'ac_1');
    assert.deepEqual(r.fields.task?.span, { kind: 'later', start: null });
    assert.match(await page.locator('#outline-editor li', { hasText: 'Spending limit' }).locator('.task-chip').innerText(), /Later/);
  });

  assert.deepEqual(page.errors, []);

  // ---------- a phone ----------
  const { ctx: pctx, page: phone } = await open({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });
  const cdp = await pctx.newCDPSession(phone);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });

  await check('phone: What’s when, and Pull from a project opens the project in the bottom half', async () => {
    await phone.evaluate(() => document.querySelector('#view-toggle').click());
    await phone.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    await phone.waitForSelector('#plan .pl-switch [data-cmd="when"]');
    await phone.evaluate(() => document.querySelector('#plan .pl-switch [data-cmd="when"]').click());
    await phone.waitForSelector('.ww-sec');
    await phone.locator('.pl-pull:visible').click();
    await phone.waitForSelector('.pull:not([hidden]) .pu-line');
    assert.ok(await phone.evaluate(() => document.documentElement.classList.contains('pulling-phone')));
    const b = await phone.locator('.pull').boundingBox();
    assert.ok(b.y > 250 && b.y < 600, `the pane is the bottom half (top at ${b.y})`);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= 360), true, 'no sideways scroll at 360 px');
    await shot(phone, 'p-when-split');
  });

  await check('phone: slide a line up by its dots; the top folds into six places; let go on “This week”', async () => {
    const g = await centre(phone.locator('.pu-line[data-id="st_1"] .pu-grip'));
    await touch('touchStart', g.x, g.y);
    await sleep(40);
    for (let k = 1; k <= 6; k++) { await touch('touchMove', g.x, g.y - k * 20); await sleep(30); }
    await phone.waitForSelector('.pull-zones .pz');
    assert.deepEqual(await phone.locator('.pull-zones .pz-l').allInnerTexts(), ['Today', 'Tomorrow', 'This week', 'Next week', 'This month', 'Later']);
    const z = await centre(phone.locator('.pz[data-value="week"]'));
    for (let k = 1; k <= 8; k++) { await touch('touchMove', g.x, g.y - 120 + ((z.y + 10 - (g.y - 120)) * k) / 8); await sleep(30); }
    assert.ok(await phone.locator('.pz[data-value="week"].pull-over').count(), 'the place under the finger lights up');
    await shot(phone, 'p-zones');
    await touch('touchEnd', 0, 0);
    await phone.waitForFunction(() => !document.querySelector('.pull-zones'));
    await phone.waitForFunction(() => [...document.querySelectorAll('.ww-sec[data-bucket="week"] .pl-words')].some((x) => x.textContent === 'Pick the stills'));
    assert.deepEqual((await get(phone, 'st_1')).fields.task.span, { kind: 'week', start: '2026-11-09' });
    const toast = await phone.locator('.toast').boundingBox();
    assert.ok(toast.y < 120, 'the toast sits at the top, clear of the bottom half');
  });

  await check('phone: tap lines to pick them, then When in the pane’s bar opens the When sheet', async () => {
    await sleep(1000); // a person's next tap, not one in the same instant as the drop
    await phone.locator('.pu-line[data-id="st_9"] .pu-words').tap();
    assert.equal(await phone.locator('.pu-count').innerText(), '1 picked');
    await phone.locator('.pu-when').tap();
    await phone.waitForSelector('.when-pick.sheet');
    const s = await phone.locator('.when-pick.sheet').boundingBox();
    assert.ok(s.y + s.height >= 770, 'a sheet from the bottom');
    await shot(phone, 'p-when-sheet');
    await phone.locator('.when-pick .wp-opt', { hasText: 'Tomorrow' }).tap();
    await phone.waitForFunction(() => [...document.querySelectorAll('.ww-sec[data-bucket="tomorrow"] .pl-words')].some((x) => x.textContent === 'Pick a voice for Mochi'));
    assert.equal((await get(phone, 'st_9')).fields.task.day, '2026-11-14');
  });

  await check('phone: Week folds into seven days and “Any day this week” while a line slides up', async () => {
    await phone.evaluate(() => document.querySelector('.pl-switch [data-cmd="week"]').click());
    await phone.waitForSelector('.pw-week');
    assert.ok(await phone.locator('.pull').isVisible());
    await phone.locator('.pu-line[data-id="st_2"]').scrollIntoViewIfNeeded();
    const g = await centre(phone.locator('.pu-line[data-id="st_2"] .pu-grip'));
    await touch('touchStart', g.x, g.y);
    for (let k = 1; k <= 6; k++) { await touch('touchMove', g.x, g.y - k * 20); await sleep(30); }
    await phone.waitForSelector('.pull-zones .pz');
    assert.equal(await phone.locator('.pull-zones .pz').count(), 8);
    const z = await centre(phone.locator('.pz[data-value="2026-11-15"]'));
    for (let k = 1; k <= 6; k++) { await touch('touchMove', g.x, g.y - 120 + ((z.y + 10 - (g.y - 120)) * k) / 6); await sleep(30); }
    await touch('touchEnd', 0, 0);
    await phone.waitForFunction(() => [...document.querySelectorAll('.pw-day[data-day="2026-11-15"] .pw-t')].some((x) => x.textContent === 'Board Reel 3'));
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= 360), true, 'no sideways scroll at 360 px');
  });

  assert.deepEqual(phone.errors, []);
} catch (e) {
  failed += 1;
  console.log(`FAIL ${e.stack || e.message}`);
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
