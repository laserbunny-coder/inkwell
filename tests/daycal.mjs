// The day plan's Calendar: the day hour by hour, arranged by hand. A task is
// on it only where you put it; it snaps to 15 minutes; the list's order and
// the calendar never move each other.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4279;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const NOW = '2026-11-09T14:04:00-08:00'; // a Monday, 2:04 pm
const TODAY = '2026-11-09';
const at = (s) => `${s}:00-08:00`;
const EVENTS = [
  { id: 'c1:standup', title: 'Standup with Nate', start: at('2026-11-09T09:30'), end: at('2026-11-09T10:00'), allDay: false, calendar: 'Acro' },
  { id: 'c1:dentist', title: 'Dentist', start: at('2026-11-09T16:00'), end: at('2026-11-09T17:00'), allDay: false, calendar: 'Michael' },
];
const PX = 1; // pixels a minute

const browser = withoutSync(await chromium.launch());
async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, estimates: false, ...extra });
  await ctx.addInitScript((events) => { window.__calendar = async () => ({ connected: true, events }); }, EVENTS);
  const page = await ctx.newPage();
  page.ctx = ctx;
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
const named = async (p, text) => (await all(p)).find((r) => r.text === text && r.fields?.task);
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const go = async (p, place) => {
  await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
  await p.waitForFunction((pl) => (document.documentElement.dataset.view || 'write') === pl.view && history.state?.view === pl.view, place);
  await still(p);
  await sleep(350);
};
const add = async (p, text) => { const input = p.locator('#plan input[data-add]').first(); await input.fill(text); await input.press('Enter'); await sleep(400); };
const blk = (p, text) => p.locator('#plan-sheet .dc-blk', { hasText: text });
const chip = (p, text) => p.locator('#plan-sheet .dc-chip', { hasText: text });
const chips = (p) => p.locator('#plan-sheet .dc-chip').allInnerTexts();
const words = (p) => p.locator('#plan .pl-task:not(.done) .pl-words').allInnerTexts();
// Where on the screen a time of day is, on the grid.
const yOf = async (p, min) => p.evaluate(([m, px]) => { const g = document.querySelector('#plan-sheet .dc-grid'); return g.getBoundingClientRect().top + (m - Number(g.dataset.from)) * px; }, [min, PX]);
const xOf = async (p) => p.evaluate(() => { const g = document.querySelector('#plan-sheet .dc-grid').getBoundingClientRect(); return g.left + g.width * 0.6; });
const drag = async (p, x, y0, y1) => {
  await p.mouse.move(x, y0);
  await p.mouse.down();
  for (let k = 1; k <= 8; k++) { await p.mouse.move(x, y0 + ((y1 - y0) * k) / 8); await sleep(16); }
  await p.mouse.up();
  await sleep(450);
};
// Near the top of a block: its bottom edge is for making it longer.
const centre = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 8), b }; };
const placedAt = async (p, text) => (await named(p, text))?.fields.task.on;
const shot = async (p, name) => { if (SHOTS) { await p.evaluate(() => document.querySelector('.toast')?.remove()); await still(p); await sleep(250); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 10).join('\n     ')}`); }
}

try {
  const page = await open({ width: 1440, height: 1000 });
  // Yesterday's task, put on yesterday's calendar at 10 am and not done.
  await page.evaluate(async () => {
    const now = Date.now();
    const row = { id: 'ln_old', kind: 'line', parent_id: 'page-tasks', sort: 1, title: '', text: 'Back up the drives', content: [{ type: 'text', text: 'Back up the drives' }], tags: [], links: [], type: null, area_id: null, deleted: false, created_at: now, updated_at: now, fields: { done: false, box: true, task: { v: 1, day: '2026-11-08', est: null, done_at: null, actual: null, log: [], run: null, order: 1, on: { day: '2026-11-08', at: 600 }, len: 60 } } };
    const page = { id: 'page-tasks', kind: 'page', parent_id: null, sort: 9000, title: 'Tasks', text: '', content: null, tags: [], links: [], type: null, area_id: null, deleted: false, created_at: now, updated_at: now, fields: {} };
    await new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const tx = r.result.transaction('entries', 'readwrite'); tx.objectStore('entries').put(page); tx.objectStore('entries').put(row); tx.oncomplete = res; }; });
  });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  await go(page, { view: 'notebook', pageId: `day-${TODAY}` });
  await add(page, 'Cut the trailer');
  await add(page, 'Email Dana the boards');
  await add(page, 'Print the call sheet');
  const order = await words(page);

  await check('Calendar’s Day shows the day by the hour, with nothing placed yet', async () => {
    assert.equal(await page.locator('#plan .pl-view').count(), 0, 'no List | Calendar inside the plan any more');
    await page.locator('.today-switch button', { hasText: 'Calendar' }).click();
    await page.waitForSelector('#plan-sheet .pl-zoom');
    await page.locator('#plan-sheet .pl-zoom button[data-tab="calday"]').click();
    await page.waitForSelector('#plan-sheet .dc-grid');
    assert.deepEqual(await chips(page), order, 'every open task waits above, yesterday’s too');
    assert.equal(await page.locator('#plan-sheet .dc-blk').count(), 0, 'yesterday’s time doesn’t carry over');
    assert.deepEqual(await page.locator('#plan-sheet .dc-ev .dc-w').allInnerTexts(), ['Standup with Nate', 'Dentist']);
    assert.equal(await page.locator('#plan-sheet .dc-now').count(), 1);
    assert.equal(await page.locator('#plan-sheet .dc-hour span').first().innerText(), '7 am');
  });

  await check('a click on a waiting task puts it in the next free half hour', async () => {
    await chip(page, 'Cut the trailer').click();
    await page.waitForSelector('#plan-sheet .dc-blk');
    assert.deepEqual(await placedAt(page, 'Cut the trailer'), { day: TODAY, at: 14 * 60 + 30 });
    assert.equal((await named(page, 'Cut the trailer')).fields.task.len, 30);
    assert.match(await blk(page, 'Cut the trailer').locator('.dc-t').innerText(), /2:30 pm · 30 min/);
    await chip(page, 'Email Dana').click();
    await page.waitForFunction(() => document.querySelectorAll('#plan-sheet .dc-blk').length === 2);
    assert.equal((await placedAt(page, 'Email Dana the boards')).at, 15 * 60, 'the next free one, not on top of the first');
  });

  await check('drag a block to move it: it snaps to 15 minutes', async () => {
    const c = await centre(blk(page, 'Cut the trailer'));
    await drag(page, c.x, c.y, c.y + 105 * PX); // 1 h 45 min down
    assert.equal((await placedAt(page, 'Cut the trailer')).at, 16 * 60 + 15);
    assert.match(await blk(page, 'Cut the trailer').locator('.dc-t').innerText(), /4:15 pm · 30 min/);
    // Beside the Dentist, not on top of it.
    const [a, b] = [await blk(page, 'Cut the trailer').boundingBox(), await page.locator('#plan-sheet .dc-ev', { hasText: 'Dentist' }).boundingBox()];
    assert.ok(a.x >= b.x + b.width - 1 || b.x >= a.x + a.width - 1, 'overlaps sit side by side');
  });

  await check('drag its bottom edge to make it longer', async () => {
    const e = await blk(page, 'Cut the trailer').locator('.dc-edge').boundingBox();
    await drag(page, e.x + e.width / 2, e.y + e.height / 2, e.y + e.height / 2 + 47 * PX);
    assert.equal((await named(page, 'Cut the trailer')).fields.task.len, 75);
    assert.match(await blk(page, 'Cut the trailer').locator('.dc-t').innerText(), /4:15 pm · 1 h 15 min/);
  });

  await check('drag a waiting task onto a time', async () => {
    const c = await centre(chip(page, 'Print the call sheet'));
    await drag(page, c.x, c.y, await yOf(page, 19 * 60 + 5));
    assert.deepEqual(await placedAt(page, 'Print the call sheet'), { day: TODAY, at: 19 * 60 });
    assert.deepEqual(await chips(page), ['Back up the drives']);
  });

  await check('click an empty spot and write: a new task right there, and on the list at the end', async () => {
    await page.mouse.click(await xOf(page), await yOf(page, 11 * 60 + 10));
    const input = page.locator('#plan-sheet .dc-new input');
    await input.waitFor();
    assert.equal(await input.getAttribute('placeholder'), 'A task at 11 am');
    await input.fill('Call the print shop');
    await input.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('#plan-sheet .dc-blk')].some((b) => /Call the print shop/.test(b.textContent)));
    const t = (await named(page, 'Call the print shop')).fields.task;
    assert.deepEqual([t.day, t.on, t.len], [TODAY, { day: TODAY, at: 11 * 60 }, 30]);
    await shot(page, 'daycal');
  });

  await check('the calendar never reorders the list, and the list never moves a block', async () => {
    await go(page, { view: 'notebook', pageId: `day-${TODAY}` });
    await page.waitForSelector('#plan .pl-list');
    assert.deepEqual(await words(page), [...order, 'Call the print shop']);
    assert.equal(await page.locator('#plan .pl-task .pl-est:visible').count(), 0, 'no times on the list');
    await page.locator('#plan .pl-task', { hasText: 'Print the call sheet' }).locator('.pl-words').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForFunction(() => document.querySelectorAll('#plan .pl-task .pl-words')[1]?.textContent === 'Print the call sheet' || document.querySelectorAll('#plan .pl-task .pl-words')[2]?.textContent === 'Print the call sheet');
    await sleep(300);
    assert.deepEqual(await placedAt(page, 'Print the call sheet'), { day: TODAY, at: 19 * 60 });
    await go(page, { view: 'plan', tab: 'calday' });
    await page.waitForSelector('#plan-sheet .dc-grid');
  });

  await check('drag a block up past the top to take it off the calendar', async () => {
    const c = await centre(blk(page, 'Email Dana'));
    const top = await page.locator('#plan-sheet .dc-grid').boundingBox();
    await drag(page, c.x, c.y, top.y - 60);
    assert.equal((await named(page, 'Email Dana the boards')).fields.task.on, null);
    assert.ok((await chips(page)).includes('Email Dana the boards'));
  });

  await check('a click on a block zooms into the task, and Alt + Left comes back to the calendar', async () => {
    await blk(page, 'Call the print shop').click();
    await page.waitForFunction(() => /Call the print shop/.test(document.querySelector('#outline-editor li.zoom-root')?.textContent || ''), null, { timeout: 15000 });
    await page.keyboard.press('Alt+ArrowLeft');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'plan' && !!document.querySelector('#plan-sheet .dc-grid'));
  });

  await check('Calendar opens on the zoom used last on this device', async () => {
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await go(page, { view: 'notebook', pageId: `day-${TODAY}` });
    await page.locator('.today-switch button', { hasText: 'Calendar' }).click();
    await page.waitForSelector('#plan-sheet .dc-grid');
    assert.deepEqual(page.errors, []);
  });

  // The phone: hold, then slide.
  const phone = await open({ width: 412, height: 915 }, { hasTouch: true, isMobile: true, todayPage: false });
  const cdp = await phone.ctx.newCDPSession(phone);
  await check('phone: the calendar fits, and a block moves after a hold', async () => {
    await go(phone, { view: 'notebook', pageId: `day-${TODAY}` });
    await add(phone, 'Charge the batteries');
    await phone.locator('.tp-switch button', { hasText: 'Calendar' }).tap();
    await phone.waitForSelector('#plan-sheet .pl-zoom');
    await still(phone);
    await sleep(600);
    await phone.locator('#plan-sheet .pl-zoom button[data-tab="calday"]').tap();
    await phone.waitForSelector('#plan-sheet .dc-grid');
    // On a phone what isn't on the calendar waits below the hours, folded into one line.
    assert.match(await phone.locator('#plan-sheet .dc-tray-fold').innerText(), /1 not on the calendar/);
    await phone.locator('#plan-sheet .dc-tray-fold').tap();
    await phone.locator('#plan-sheet .dc-chip', { hasText: 'Charge' }).tap();
    await phone.waitForSelector('#plan-sheet .dc-blk');
    assert.equal((await placedAt(phone, 'Charge the batteries')).at, 14 * 60 + 30);
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'nothing spills');
    await phone.evaluate(() => document.querySelector('#plan-sheet .dc-blk').scrollIntoView({ block: 'center' }));
    await sleep(200);
    const c = await centre(phone.locator('#plan-sheet .dc-blk'));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
    await sleep(450);
    for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x, y: c.y + (60 * PX * k) / 8 }] }); await sleep(30); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await phone.waitForFunction(() => /3:30 pm/.test(document.querySelector('#plan-sheet .dc-blk .dc-t')?.textContent || ''));
    assert.equal((await placedAt(phone, 'Charge the batteries')).at, 15 * 60 + 30);
    await shot(phone, 'daycal-phone');
    assert.deepEqual(phone.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nthe day calendar: all good');
process.exit(failed ? 1 : 0);
