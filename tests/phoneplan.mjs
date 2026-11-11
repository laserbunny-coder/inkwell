// Today on the phone: a finger on a task's six dots slides it at once, as in
// Workflowy; anywhere else on the task, press and hold first, then slide.
// Holding still and letting go brings up the menu.
// Coming back after a few hours, or on a new day, the phone opens on Today.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4274;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const NOW = new Date('2026-11-09T14:04:00-08:00');

const browser = withoutSync(await chromium.launch());
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const words = (p) => p.locator('#plan .pl-task .pl-words').allInnerTexts();
const started = (p) => p.waitForFunction(() => document.documentElement.dataset.started === '1');
const onToday = (p) => p.evaluate(() => document.documentElement.dataset.view === 'notebook' && !!document.querySelector('#plan') && !document.querySelector('#plan').hidden);

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

// One finger: down, hold, slide in small steps, up.
async function hold(cdp, x, y, ms) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(ms);
}
async function slide(cdp, x, from, to) {
  const steps = 8;
  for (let k = 1; k <= steps; k += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + ((to - from) * k) / steps }] });
    await sleep(30);
  }
}
const lift = (cdp) => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
const centre = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

try {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  const phone = await ctx.newPage();
  phone.errors = [];
  phone.on('pageerror', (e) => phone.errors.push(e.message));
  await phone.clock.install({ time: NOW });
  await phone.goto(URL);
  await started(phone);
  await phone.evaluate(() => document.querySelector('#view-toggle').click());
  await phone.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
  await still(phone);
  await phone.waitForFunction(() => { document.activeElement?.blur(); return !document.body.classList.contains('kb-up'); });
  for (const t of ['Call Dana', 'Order the storage drive', 'Board reel 2']) {
    const input = phone.locator('#plan input[data-add]').first();
    await input.fill(t);
    await input.press('Enter');
    await sleep(350);
  }
  await phone.evaluate(() => document.activeElement?.blur());
  await sleep(300);
  const cdp = await ctx.newCDPSession(phone);

  await check('phone: hold a task, then slide it to a new place in the day', async () => {
    assert.deepEqual(await words(phone), ['Call Dana', 'Order the storage drive', 'Board reel 2']);
    const a = await centre(phone.locator('#plan .pl-task', { hasText: 'Board reel 2' }).locator('.pl-title'));
    const top = await centre(phone.locator('#plan .pl-task', { hasText: 'Call Dana' }));
    await hold(cdp, a.x, a.y, 450);
    assert.ok(await phone.locator('#plan .pl-task.pl-armed', { hasText: 'Board reel 2' }).count(), 'the held task lights up');
    await slide(cdp, a.x, a.y, top.y - 12);
    assert.ok(await phone.locator('#plan .pl-task.dragging').count(), 'it is being moved');
    await lift(cdp);
    await phone.waitForFunction(() => document.querySelector('#plan .pl-task .pl-words')?.innerText === 'Board reel 2');
    assert.deepEqual(await words(phone), ['Board reel 2', 'Call Dana', 'Order the storage drive']);
  });

  await check('phone: a finger on the six dots slides the task at once, no waiting, and a copy rides under the finger', async () => {
    const g = await centre(phone.locator('#plan .pl-task', { hasText: 'Order the storage drive' }).locator('.pl-grip'));
    const top = await centre(phone.locator('#plan .pl-task', { hasText: 'Board reel 2' }));
    await hold(cdp, g.x, g.y, 20);
    await slide(cdp, g.x, g.y, top.y - 12);
    assert.equal(await phone.locator('.pl-lift').count(), 1, 'the task lifts and follows the finger');
    await lift(cdp);
    await phone.waitForFunction(() => document.querySelector('#plan .pl-task .pl-words')?.innerText === 'Order the storage drive');
    assert.deepEqual(await words(phone), ['Order the storage drive', 'Board reel 2', 'Call Dana']);
    assert.equal(await phone.locator('.pl-lift').count(), 0, 'and is gone once it lands');
  });

  await check('phone: the phone’s own long-press menu doesn’t end a hold; the task still slides', async () => {
    const row = phone.locator('#plan .pl-task', { hasText: 'Call Dana' });
    const a = await centre(row.locator('.pl-title'));
    const top = await centre(phone.locator('#plan .pl-task', { hasText: 'Order the storage drive' }));
    await hold(cdp, a.x, a.y, 400);
    // Android sends a contextmenu about half a second into a long press.
    const stopped = await row.evaluate((r) => !r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    assert.ok(stopped, 'the long-press menu is held back');
    assert.equal(await phone.locator('.pop-menu').count(), 0, 'no menu yet');
    await slide(cdp, a.x, a.y, top.y - 12);
    await lift(cdp);
    await phone.waitForFunction(() => document.querySelector('#plan .pl-task .pl-words')?.innerText === 'Call Dana');
    assert.deepEqual(await words(phone), ['Call Dana', 'Order the storage drive', 'Board reel 2']);
  });

  await check('phone: holding still and letting go opens the task’s menu, which can send it to the bottom or the top', async () => {
    const a = await centre(phone.locator('#plan .pl-task', { hasText: 'Call Dana' }).locator('.pl-title'));
    await hold(cdp, a.x, a.y, 450);
    await lift(cdp);
    await phone.waitForSelector('.pop-menu');
    await phone.locator('.pop-menu .pop-item', { hasText: 'Move to the bottom' }).click();
    await phone.waitForFunction(() => [...document.querySelectorAll('#plan .pl-task .pl-words')].at(-1)?.innerText === 'Call Dana');
    assert.deepEqual(await words(phone), ['Order the storage drive', 'Board reel 2', 'Call Dana']);
    const b = await centre(phone.locator('#plan .pl-task', { hasText: 'Board reel 2' }).locator('.pl-title'));
    await hold(cdp, b.x, b.y, 450);
    await lift(cdp);
    await phone.waitForSelector('.pop-menu');
    await phone.locator('.pop-menu .pop-item', { hasText: 'Move to the top' }).click();
    await phone.waitForFunction(() => document.querySelector('#plan .pl-task .pl-words')?.innerText === 'Board reel 2');
    assert.deepEqual(await words(phone), ['Board reel 2', 'Order the storage drive', 'Call Dana']);
  });

  await check('phone: a quick swipe over the tasks moves nothing', async () => {
    const a = await centre(phone.locator('#plan .pl-task', { hasText: 'Call Dana' }).locator('.pl-title'));
    await hold(cdp, a.x, a.y, 40);
    await slide(cdp, a.x, a.y, a.y + 120);
    await lift(cdp);
    await sleep(400);
    assert.deepEqual(await words(phone), ['Board reel 2', 'Order the storage drive', 'Call Dana']);
  });

  await check('phone: six dots show on every task that can move, and a tap zooms into the task and Back comes out again', async () => {
    assert.equal(await phone.locator('#plan .pl-task[data-move] .pl-grip').count(), 3);
    assert.ok(Number(await phone.locator('#plan .pl-grip').first().evaluate((g) => getComputedStyle(g).opacity)) > 0.5, 'no hover on a phone: always there');
    assert.equal(await phone.locator('.pane-frame').count(), 0, 'sliding a task opened nothing');
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'nothing spills');
    await phone.locator('#plan .pl-task', { hasText: 'Call Dana' }).locator('.pl-words').tap();
    await phone.waitForFunction(() => /Call Dana/.test(document.querySelector('#outline-editor li.zoom-root')?.textContent || ''));
    assert.equal(await phone.locator('.pane-frame').count(), 0, 'it opens in place, as a page');
    await phone.goBack();
    await phone.waitForFunction(() => !document.querySelector('#outline-editor li.zoom-root') && document.querySelectorAll('#plan .pl-task').length === 3);
  });

  await check('phone: the new order is kept', async () => {
    await phone.reload();
    await started(phone);
    await phone.waitForFunction(() => document.querySelectorAll('#plan .pl-task').length === 3);
    assert.deepEqual(await words(phone), ['Board reel 2', 'Order the storage drive', 'Call Dana']);
  });

  await check('phone: back within a few hours, it opens where you left off', async () => {
    await phone.evaluate(() => document.querySelector('[data-room="library"], #rail [data-go="library"]')?.click());
    await phone.evaluate(() => { const p = JSON.parse(localStorage.getItem('place')); if (p.view === 'notebook') localStorage.setItem('place', JSON.stringify({ view: 'library' })); });
    await phone.goto('about:blank');
    await phone.clock.fastForward('01:00:00');
    await phone.goto(URL);
    await started(phone);
    assert.equal(await phone.evaluate(() => JSON.parse(localStorage.getItem('place')).view), 'library');
    assert.equal(await onToday(phone), false);
  });

  await check('phone: back after more than three hours, it opens on Today with the plan on top', async () => {
    await phone.evaluate(() => localStorage.setItem('place', JSON.stringify({ view: 'library' })));
    await phone.goto('about:blank'); // leaving the app
    await phone.clock.fastForward('04:00:00');
    await phone.goto(URL);
    await started(phone);
    assert.equal(await onToday(phone), true);
    assert.deepEqual(phone.errors, []);
  });
  await ctx.close();

  await check('computer: it always opens where you left off', async () => {
    const c = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport: { width: 1440, height: 900 } });
    const p = await c.newPage();
    await p.clock.install({ time: NOW });
    await p.goto(URL);
    await started(p);
    await p.evaluate(() => { localStorage.setItem('place', JSON.stringify({ view: 'library' })); localStorage.setItem('placeAt', String(Date.now() - 2 * 86400000)); });
    await p.reload();
    await started(p);
    assert.equal(await onToday(p), false);
    await c.close();
  });
} finally {
  await browser.close();
  server.kill();
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nToday on the phone: all good');
