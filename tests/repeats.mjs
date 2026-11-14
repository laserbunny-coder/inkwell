// Repeats and habits. A task that repeats stays one line: ticking it writes
// the day into its history and moves it on to the next day it lands on. A
// habit is a repeat with no hours; a click on it shows how it's going.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4271;
const DIST = process.env.DIST;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(DIST ? ['--outDir', DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const NOW = '2026-11-09T14:04:00-08:00'; // a Monday
const now = Date.parse(NOW);
const DAY = 864e5;

const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 30 * DAY, updated_at: now - 2 * 36e5 };
const row0 = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const task = (id, sort, text, t = {}) => row0(id, 'line', 'page-tasks', sort, {
  text, content: [{ type: 'text', text }],
  fields: { done: false, box: true, task: { v: 1, day: null, est: null, done_at: null, actual: null, log: [], run: null, order: sort, ...t } }
});
const iso = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const noon = (day) => Date.parse(`${day}T12:00:00-08:00`);
// Morning pages: every day since Oct 19, missed once (Oct 31), not yet today.
const PAGES = [];
for (let d = Date.parse('2026-10-19T12:00:00-07:00'); iso(d) < '2026-11-09'; d += DAY) if (iso(d) !== '2026-10-31') PAGES.push([iso(d), null, d]);
const SEED = [
  row0('page-tasks', 'page', null, 9000, { title: 'Tasks' }),
  task('hb_pages', 1, 'Morning pages', { day: '2026-11-09', habit: true, repeat: { every: 'day', n: 1, from: '2026-10-19' }, did: PAGES }),
  task('rp_week', 2, 'Review the week', { day: '2026-11-09', est: 30, repeat: { every: 'week', n: 1, days: [1], from: '2026-10-26' }, did: [['2026-10-26', 25, noon('2026-10-26')], ['2026-11-02', 40, noon('2026-11-02')]] }),
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
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  await page.evaluate(seed, SEED);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return page;
}
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const named = async (p, text) => (await all(p)).find((r) => r.text === text && r.fields?.task && !r.deleted);
const T = async (p, text) => (await named(p, text)).fields.task;
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const go = async (p, place) => {
  await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
  await p.waitForFunction((pl) => (document.documentElement.dataset.view || 'write') === pl.view && history.state?.view === pl.view, place);
  await still(p);
  await sleep(350);
};
const day = (p, d) => go(p, { view: 'notebook', pageId: `day-${d}` });
const pick = async (p, label) => { await p.locator('.pop-menu .pop-item', { hasText: label }).first().click(); await sleep(300); };
const words = (p, sel = '#plan .pl-task') => p.locator(`${sel} .pl-words`).allInnerTexts();
const row = (p, text, more = '') => p.locator(`#plan .pl-task${more}`, { hasText: text });
const add = async (p, text, box = '#plan input[data-add]') => {
  const input = p.locator(box).first();
  await input.fill(text);
  await input.press('Enter');
  await sleep(400);
};
const menu = async (p, text, more = '') => { await row(p, text, more).first().hover(); await row(p, text, more).first().locator('.pl-more').click(); await p.waitForSelector('.pop-menu'); };
const shot = async (p, name) => { if (SHOTS) { await p.evaluate(() => document.querySelector('.toast')?.remove()); await still(p); await sleep(250); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 10).join('\n     ')}`); }
}

try {
  const page = await open({ width: 1440, height: 900 });
  await day(page, '2026-11-09');
  await page.waitForSelector('#plan .pl-task');

  await check('a task that repeats says so with a quiet ↻; a habit has no hours, so the plan’s sum leaves it out', async () => {
    assert.deepEqual(await words(page), ['Morning pages', 'Review the week']);
    assert.equal(await row(page, 'Morning pages').locator('.pl-rep').getAttribute('title'), 'Every day · a habit');
    assert.equal(await row(page, 'Review the week').locator('.pl-rep').getAttribute('title'), 'Every Monday');
    assert.ok(await row(page, 'Morning pages').locator('.pl-est').isHidden());
    assert.equal(await row(page, 'Morning pages').locator('.pl-play').count(), 0);
    assert.equal(await row(page, 'Review the week').locator('.pl-est').innerText(), '30 min');
    assert.equal(await page.locator('#plan .pl-sum').innerText(), '30 min to do');
  });

  await check('type it: “Stretch 10m every day”, “every Sun”, “weekdays”, “every Mon, Wed and Fri”, “monthly”, “every 3 days”', async () => {
    await add(page, 'Stretch 10m every day');
    let t = await T(page, 'Stretch');
    assert.deepEqual([t.day, t.est, t.repeat], ['2026-11-09', 10, { n: 1, every: 'day', from: '2026-11-09' }]);
    assert.equal(await row(page, 'Stretch').locator('.pl-rep').getAttribute('title'), 'Every day');
    // One that first lands on another day goes there, and says so.
    await add(page, 'Call Mom every Sun');
    assert.match(await page.locator('.toast').innerText(), /Every Sunday: the first one is on Sunday, Nov 15/);
    t = await T(page, 'Call Mom');
    assert.deepEqual([t.day, t.repeat.every, t.repeat.days, t.repeat.from], ['2026-11-15', 'week', [7], '2026-11-15']);
    assert.ok(!(await words(page)).includes('Call Mom'));
    await add(page, 'Standup weekdays 15m');
    t = await T(page, 'Standup');
    assert.deepEqual([t.day, t.est, t.repeat.every], ['2026-11-09', 15, 'weekdays']);
    await add(page, 'Run every Mon, Wed and Fri 30 min');
    t = await T(page, 'Run');
    assert.deepEqual([t.day, t.est, t.repeat.every, t.repeat.days], ['2026-11-09', 30, 'week', [1, 3, 5]]);
    assert.equal(await row(page, 'Run').locator('.pl-rep').getAttribute('title'), 'Monday, Wednesday and Friday');
    await add(page, 'Pay rent monthly');
    t = await T(page, 'Pay rent');
    assert.deepEqual([t.repeat.every, t.repeat.from], ['month', '2026-11-09']);
    assert.equal(await row(page, 'Pay rent').locator('.pl-rep').getAttribute('title'), 'Every month on the 9th');
    await add(page, 'Water the plants every 3 days');
    t = await T(page, 'Water the plants');
    assert.deepEqual([t.repeat.every, t.repeat.n], ['day', 3]);
    assert.equal(await row(page, 'Water the plants').locator('.pl-rep').getAttribute('title'), 'Every 3 days');
    // Words that only sound like it stay words.
    await add(page, 'Read the daily news');
    t = await T(page, 'Read the daily news');
    assert.equal(t.repeat ?? null, null);
    assert.equal(await row(page, 'Read the daily news').locator('.pl-rep').count(), 0);
  });

  await check('tick one: it’s done today and back tomorrow, still one line; untick takes that back', async () => {
    const before = (await all(page)).filter((r) => r.text === 'Stretch').length;
    await row(page, 'Stretch').locator('.pl-check').click();
    await sleep(400);
    assert.ok(await row(page, 'Stretch').evaluate((el) => el.classList.contains('done')), 'today it shows done');
    await page.locator('#plan .pl-took button', { hasText: 'as planned' }).click();
    await sleep(400);
    let r = await named(page, 'Stretch');
    assert.equal(r.fields.done, false, 'the line itself is open again');
    assert.equal(r.fields.task.day, '2026-11-10');
    assert.deepEqual(r.fields.task.did.map((d) => [d[0], d[1]]), [['2026-11-09', 10]]);
    assert.equal((await all(page)).filter((x) => x.text === 'Stretch').length, before, 'nothing was copied');
    assert.equal((await words(page)).filter((w) => w === 'Stretch').length, 1);
    assert.match(await page.locator('#plan .pl-sum').innerText(), /10 min done/);
    await row(page, 'Stretch').locator('.pl-check').click();
    await sleep(400);
    r = await named(page, 'Stretch');
    assert.deepEqual([r.fields.done, r.fields.task.day, r.fields.task.did], [false, '2026-11-09', []]);
    assert.ok(await row(page, 'Stretch').evaluate((el) => !el.classList.contains('done')));
  });

  await check('a habit: a click on it shows how it’s going, in a row and the last four weeks', async () => {
    await row(page, 'Morning pages').locator('.pl-words').click();
    await page.waitForSelector('.pop-menu .hb');
    assert.deepEqual(await page.locator('.pop-menu .pop-note').allInnerTexts(), ['Every day · a habit', '8 in a row · 20 of the last 21']);
    const count = (cls) => page.locator(`.pop-menu .hb .hb-row:not(.hb-head) i${cls}`).count();
    assert.deepEqual([await count(''), await count('.hb-done'), await count('.hb-missed'), await count('.hb-open'), await count('.hb-ahead')], [28, 20, 1, 1, 6]);
    assert.ok(await page.locator('.pop-menu .hb i.today').evaluate((c) => c.classList.contains('hb-open')));
    assert.match(await page.locator('.pop-menu .hb i.hb-missed').getAttribute('title'), /Oct 31: missed/);
    await shot(page, 'repeats-habit');
    await page.keyboard.press('Escape');
  });

  await check('ticking a habit asks nothing; the run grows', async () => {
    await row(page, 'Morning pages').locator('.pl-check').click();
    await sleep(400);
    assert.equal(await page.locator('#plan .pl-took').count(), 0);
    const t = await T(page, 'Morning pages');
    assert.deepEqual([t.day, t.did.length, t.did.at(-1)[0]], ['2026-11-10', 21, '2026-11-09']);
    await row(page, 'Morning pages').locator('.pl-rep').click();
    await page.waitForSelector('.pop-menu .hb');
    assert.equal(await page.locator('.pop-menu .pop-note').nth(1).innerText(), '9 in a row · 21 of the last 22');
    assert.ok(await page.locator('.pop-menu .hb i.today').evaluate((c) => c.classList.contains('hb-done')));
    await page.keyboard.press('Escape');
    // Done habits add no minutes either.
    assert.ok(!/done/.test(await page.locator('#plan .pl-sum').innerText()) || /1 done/.test(await page.locator('#plan .pl-sum').innerText()));
  });

  await check('the menu makes any task repeat, picks its days, skips one, makes it a habit or stops it', async () => {
    await add(page, 'Board Reel 2 1h');
    await menu(page, 'Board Reel 2');
    await pick(page, 'Repeat');
    assert.deepEqual(await page.locator('.pop-menu .pop-item').allInnerTexts().then((l) => l.map((x) => x.replace(/\s*›$/, '').trim())),
      ['Doesn’t repeat', 'Every day', 'Weekdays', 'Every Monday', 'Every other Monday', 'Every month on the 9th', 'Pick the days…']);
    await pick(page, 'Every Monday');
    let t = await T(page, 'Board Reel 2');
    assert.deepEqual(t.repeat, { n: 1, every: 'week', days: [1], from: '2026-11-09' });
    assert.equal(t.day, '2026-11-09');
    await menu(page, 'Board Reel 2');
    // The line that said "Repeat" now says how often.
    await page.locator('.pop-menu .pop-item', { hasText: 'Every Monday' }).click();
    assert.ok(await page.locator('.pop-menu .pop-item.current', { hasText: 'Every Monday' }).count());
    await pick(page, 'Pick the days…');
    await page.locator('.ask-input').fill('tue thu');
    await page.locator('.ask .pill.primary').click();
    await sleep(400);
    t = await T(page, 'Board Reel 2');
    assert.deepEqual([t.repeat.days, t.day], [[2, 4], '2026-11-10'], 'it starts on the first of those days');
    assert.ok(!(await words(page, '#plan .pl-task:not(.done)')).includes('Board Reel 2'));
    await day(page, '2026-11-10');
    await page.waitForSelector('#plan .pl-task');
    await menu(page, 'Board Reel 2');
    assert.ok(await page.locator('.pop-menu .pop-item', { hasText: 'Tuesday and Thursday' }).count());
    await pick(page, 'Skip this one');
    t = await T(page, 'Board Reel 2');
    assert.deepEqual([t.day, t.did || []], ['2026-11-12', []]);
    await day(page, '2026-11-12');
    await page.waitForSelector('#plan .pl-task');
    await menu(page, 'Board Reel 2');
    await pick(page, 'A habit');
    assert.equal((await T(page, 'Board Reel 2')).habit, true);
    assert.ok(await row(page, 'Board Reel 2').locator('.pl-est').isHidden());
    await menu(page, 'Board Reel 2');
    await pick(page, 'A habit');
    assert.equal((await T(page, 'Board Reel 2')).habit, false);
    await menu(page, 'Board Reel 2');
    await pick(page, 'Tuesday and Thursday');
    await pick(page, 'Doesn’t repeat');
    t = await T(page, 'Board Reel 2');
    assert.deepEqual([t.repeat, t.day, t.est], [null, '2026-11-12', 60]);
    assert.equal(await row(page, 'Board Reel 2').locator('.pl-rep').count(), 0);
  });

  await check('Week shows it on each day it comes round on, fainter; the hours count those, and never a habit', async () => {
    await go(page, { view: 'plan', tab: 'week' });
    await page.waitForSelector('.pw-day .pw-task');
    const on = (d, more = '') => page.locator(`.pw-day[data-day="${d}"] .pw-task${more} .pw-t`).allInnerTexts().then((l) => l.sort());
    assert.deepEqual(await on('2026-11-11', '.ghost'), ['Run', 'Standup', 'Stretch']);
    // A habit isn't strung along the week: it shows on the day it's due.
    assert.deepEqual(await on('2026-11-14', '.ghost'), ['Stretch']);
    assert.deepEqual(await on('2026-11-15'), ['Call Mom', 'Stretch', 'Water the plants']);
    // Today: the ones due are real, and the habit ticked this morning is done.
    assert.deepEqual(await on('2026-11-09', ':not(.done):not(.ghost)'), ['Pay rent', 'Read the daily news', 'Review the week', 'Run', 'Standup', 'Stretch', 'Water the plants']);
    assert.deepEqual(await on('2026-11-09', '.done'), ['Morning pages']);
    assert.equal(await page.locator('.pw-day[data-day="2026-11-11"] .pw-task.ghost').first().getAttribute('draggable'), null);
    // Stretch 7 × 10, Standup 5 × 15, Run 3 × 30, the review 30, Board Reel 2 1 h.
    assert.equal(await page.locator('.pl-meter-v').innerText(), '5.4 h of 45 h');
    await shot(page, 'repeats-week');
    // The week after: every one of them, none real yet.
    await page.locator('#plan-sheet [data-act="week-next"]').click();
    await page.waitForFunction(() => history.state?.week === '2026-11-16');
    await sleep(300);
    assert.deepEqual(await on('2026-11-16'), ['Review the week', 'Run', 'Standup', 'Stretch']);
    assert.equal(await page.locator('.pl-meter-v').innerText(), '4.4 h of 45 h');
    await page.evaluate(() => document.documentElement.classList.add('hide-repeatahead', 'hide-repeatmark'));
    assert.equal(await page.locator('.pw-task.ghost:visible').count(), 0);
    await page.evaluate(() => document.documentElement.classList.remove('hide-repeatahead', 'hide-repeatmark'));
    assert.ok(await page.locator('input[data-show="repeatahead"]').count() && await page.locator('input[data-show="repeatmark"]').count());
  });

  await check('on a later day’s page it’s there, fainter, and can’t be ticked before its day', async () => {
    await day(page, '2026-11-11');
    await page.waitForSelector('#plan .pl-task');
    assert.deepEqual((await words(page, '#plan .pl-task.ghost')).sort(), ['Morning pages', 'Run', 'Standup', 'Stretch']);
    await row(page, 'Standup').locator('.pl-check').click({ force: true });
    assert.match(await page.locator('.toast').innerText(), /comes round on Wednesday/);
    assert.deepEqual([(await T(page, 'Standup')).day, (await T(page, 'Standup')).did || []], ['2026-11-09', []]);
  });

  await check('the next morning a daily one is simply today’s; a weekly one that was missed waits on top', async () => {
    await page.clock.setFixedTime(new Date('2026-11-10T08:30:00-08:00'));
    await day(page, '2026-11-10');
    await page.waitForSelector('#plan .pl-task');
    await sleep(300);
    assert.ok(await row(page, 'Stretch').evaluate((el) => !el.classList.contains('carried') && !el.classList.contains('ghost')));
    assert.ok(await row(page, 'Morning pages').evaluate((el) => !el.classList.contains('carried') && !el.classList.contains('ghost')));
    assert.ok(await row(page, 'Review the week').evaluate((el) => el.classList.contains('carried')));
    assert.equal(await row(page, 'Review the week').locator('.pl-from').innerText(), 'from Mon, Nov 9');
    // Run is Monday, Wednesday and Friday: yesterday's is still open, and waits.
    assert.ok(await row(page, 'Run').evaluate((el) => el.classList.contains('carried')));
    await row(page, 'Stretch').locator('.pl-check').click();
    await sleep(400);
    await page.locator('#plan .pl-took button', { hasText: 'as planned' }).click();
    await sleep(400);
    let t = await T(page, 'Stretch');
    assert.deepEqual([t.day, t.did.map((d) => d[0])], ['2026-11-11', ['2026-11-10']]);
    // Late, the weekly one is done today and comes back next Monday.
    await row(page, 'Review the week').locator('.pl-check').click();
    await sleep(400);
    t = await T(page, 'Review the week');
    assert.deepEqual([t.day, t.did.at(-1)[0]], ['2026-11-16', '2026-11-10']);
  });

  await check('ticked in its words on a page, it moves on just the same', async () => {
    await page.locator('#outline-editor').click();
    await page.keyboard.type('Check the render queue');
    await page.keyboard.press('Control+Shift+Enter');
    await sleep(700);
    const li = page.locator('#outline-editor li', { hasText: 'Check the render queue' });
    await li.locator('.task-chip').click();
    await pick(page, 'Repeat');
    await pick(page, 'Every day');
    await sleep(500);
    assert.equal(await li.locator('.task-chip').innerText(), '↻ Today');
    await li.locator('.line-box').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#outline-editor li')].find((x) => x.textContent.includes('Check the render queue'))?.querySelector('.task-chip')?.textContent === '↻ Tomorrow', null, { timeout: 8000 });
    assert.equal(await li.locator('.line-box').getAttribute('aria-checked'), 'false');
    const r = await named(page, 'Check the render queue');
    assert.deepEqual([r.fields.done, r.fields.task.day, r.fields.task.did.map((d) => d[0])], [false, '2026-11-11', ['2026-11-10']]);
    assert.ok(await row(page, 'Check the render queue').evaluate((el) => el.classList.contains('done')), 'and today’s plan shows it done');
  });

  await check('Pace counts each time a repeating task was done, and never a habit; Weeks ahead weighs the days to come', async () => {
    await go(page, { view: 'plan', tab: 'pace' });
    await page.waitForSelector('.pc-row');
    const rows = await page.locator('.pc-t').allInnerTexts();
    assert.ok(rows.includes('Stretch') && rows.includes('Review the week'), rows.join(' | '));
    assert.ok(!rows.includes('Morning pages'));
    await go(page, { view: 'plan', tab: 'ahead' });
    await page.waitForSelector('.ah-hrs');
    // The week of Nov 16: Stretch 70, Standup 75, Run 90, the review 30.
    assert.equal((await page.locator('.ah-hrs').allInnerTexts())[1], '4.4 h of 45 h');
    assert.deepEqual(page.errors, []);
  });

  await check('on a phone: tap the ↻ for how it’s going; nothing spills', async () => {
    const phone = await open(undefined, { ...devices['Pixel 7'], todayPage: false });
    await day(phone, '2026-11-09');
    await phone.waitForSelector('#plan .pl-task');
    await phone.locator('#plan .pl-task', { hasText: 'Morning pages' }).locator('.pl-rep').tap();
    await phone.waitForSelector('.pop-menu .hb');
    const box = await phone.locator('.pop-menu').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 412, `the menu is at ${box.x} to ${box.x + box.width}`);
    await shot(phone, 'repeats-phone');
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(wide <= 1, `the page spills ${wide}`);
    assert.deepEqual(phone.errors, []);
    await phone.context().close();
  });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall repeats checks passed');
