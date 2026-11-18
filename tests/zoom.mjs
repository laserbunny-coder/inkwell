// The zoom, Part 1 (Nov 2026): one ruler at the bottom, Year · Weeks · Week ·
// Today | Now | Project · Desk · Library, on the computer and the phone. Its
// keys (1 to 8, Left and Right, Esc or minus out, Enter or plus in, Alt + `),
// Today's faces, the Year and the four weeks, the keyboard as the phone's
// switch, pinch and swipe, true focus, and "Classic layout" bringing back the rail.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4233;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const browser = withoutSync(await chromium.launch());
const errors = [];
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const place = (p) => p.evaluate(() => history.state);
const lit = (p) => p.evaluate(() => document.querySelector('.zm-stop[aria-current]')?.dataset.stop || null);
// A zoom step is done when its motion has ended and the ruler lights the new stop.
const at = async (p, stop) => {
  await p.waitForFunction((s) => !document.documentElement.dataset.zt && document.querySelector('.zm-stop[aria-current]')?.dataset.stop === s, stop, { timeout: 8000 });
  await sleep(150);
};
const blur = (p) => p.evaluate(() => document.activeElement?.blur());
const open = async (ctx) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(URL);
  await p.waitForFunction(() => document.documentElement.dataset.started === '1');
  await sleep(600);
  return p;
};

try {
  const ctx = await browser.newContext({ zoom: true, colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
  const p = await open(ctx);

  await check('the zoom is on by default: the ruler at the bottom, no rail, Now in the middle', async () => {
    assert.equal(await p.evaluate(() => document.documentElement.classList.contains('zoom')), true);
    assert.equal(await p.locator('.zm-ruler').isVisible(), true);
    assert.equal(await p.locator('.rail').isVisible(), false);
    const words = await p.locator('.zm-stop .zm-word').allInnerTexts();
    assert.deepEqual(words, ['Month', 'Week', 'Today', 'Now', 'Project', 'Desk', 'Library']);
    const r0 = await p.locator('.zm-ruler').boundingBox();
    const n0 = await p.locator('.zm-stop[data-stop="now"]').boundingBox();
    assert.ok(Math.abs(n0.x + n0.width / 2 - (r0.x + r0.width / 2)) <= 1.5, 'Now in the exact middle');
    const r = await p.locator('.zm-ruler').boundingBox();
    assert.ok(r.y + r.height >= 799, 'at the very bottom');
    assert.match(await p.locator('.topbar .zm-when').innerText(), /·/);
    assert.equal(await p.locator('.topbar .zm-go').isVisible(), true);
    assert.equal(await p.locator('.zm-mic').isVisible(), true);
  });

  await check('Esc leaves the text; then 1 to 7 jump to each stop', async () => {
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.activeElement?.isContentEditable);
    const want = { 1: ['month', 'plan', 'ahead'], 2: ['week', 'plan', 'week'], 3: ['today', 'plan', 'day'], 4: ['now', 'plan', 'now'], 6: ['desk', 'desk'], 7: ['library', 'library'] };
    for (const [k, [stop, view, tab]] of Object.entries(want)) {
      await blur(p);
      await p.keyboard.press(k);
      await at(p, stop);
      const pl = await place(p);
      assert.equal(pl.view, view, `key ${k}`);
      if (tab) assert.equal(pl.tab, tab, `key ${k}`);
    }
  });

  await check('a project opens on the Project stop; Esc steps out to the Desk, then the Library', async () => {
    await p.locator('.zl-row .zl-name').first().click();
    await at(p, 'project');
    assert.equal((await place(p)).view, 'world');
    await blur(p);
    await p.keyboard.press('Escape');
    await at(p, 'desk');
    await p.keyboard.press('Escape');
    await at(p, 'library');
    await p.keyboard.press('5');
    await at(p, 'project');
    assert.equal((await place(p)).view, 'world', 'Project goes back to the last project');
  });

  await check('Left and Right walk the ruler; minus steps out and Enter steps in, toward Now', async () => {
    await blur(p);
    await p.keyboard.press('ArrowLeft');
    await at(p, 'now');
    await p.keyboard.press('ArrowLeft');
    await at(p, 'today');
    await p.keyboard.press('-');
    await at(p, 'week');
    await p.keyboard.press('-');
    await at(p, 'month');
    await p.keyboard.press('Enter');
    await at(p, 'week');
    await p.keyboard.press('+');
    await at(p, 'today');
  });

  await check('Shift + Right is the week after; Back (Alt + Left) returns', async () => {
    await p.keyboard.press('2');
    await at(p, 'week');
    await p.keyboard.press('Shift+ArrowRight');
    await p.waitForFunction(() => !!history.state?.week);
    await p.keyboard.press('Alt+ArrowLeft');
    await p.waitForFunction(() => history.state?.tab === 'week' && !history.state?.week);
  });

  await check('Month is four weeks; 1 again (or the year) is twelve months with Sometime this year', async () => {
    await p.keyboard.press('1');
    await at(p, 'month');
    await p.waitForSelector('.mo-weeks');
    assert.equal(await p.locator('.mo-week').count(), 4, 'four weeks from this one');
    assert.equal(await p.locator('.mo-week').first().locator('.mo-day').count(), 7, 'a week shows its seven days');
    assert.match(await p.locator('.pl-top h1').first().innerText(), /Four weeks/);
    await p.keyboard.press('1');
    await p.waitForSelector('.yr-month');
    await at(p, 'month');
    assert.equal((await place(p)).tab, 'year');
    assert.equal(await p.locator('.zm-stop[data-stop="month"] .zm-word').innerText(), 'Year', 'the stop reads Year');
    await p.keyboard.press('-');
    await sleep(150);
    assert.equal((await place(p)).tab, 'year', 'out from the Year does nothing');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.mo-weeks');
    assert.equal(await p.locator('.zm-stop[data-stop="month"] .zm-word').innerText(), 'Month');
    await p.locator('.ah-year').click();
    await p.waitForSelector('.yr-month');
    assert.equal(await p.locator('.yr-month').count(), 12);
    assert.equal(await p.locator('.yr-later').isVisible(), true);
    await p.locator('.yr-month').nth(2).locator('.yr-name').click();
    await at(p, 'month');
    assert.equal((await place(p)).tab, 'ahead', 'a month opens as four weeks');
    assert.ok((await place(p)).week, 'from its first whole week');
  });

  await check('Today has three faces under its date, and comes back on the one used last', async () => {
    await p.keyboard.press('3');
    await at(p, 'today');
    assert.deepEqual(await p.locator('.plan-home .zm-faces button').allInnerTexts(), ['List', 'Page', 'Hours']);
    assert.equal(await p.locator('.pl-switch').count(), 0, 'no old Now / Page / Plan / Calendar switch');
    await p.locator('.zm-faces [data-face="hours"]').click();
    await p.waitForFunction(() => history.state?.tab === 'calday');
    await p.locator('.plan-home .zm-faces [data-face="page"]').click();
    await p.waitForFunction(() => history.state?.view === 'notebook');
    assert.equal(await lit(p), 'today');
    await p.waitForSelector('.notebook .zm-faces [data-face="page"][aria-current="page"]');
    await p.keyboard.press('Escape');
    await blur(p);
    await p.keyboard.press('4');
    await at(p, 'now');
    await p.keyboard.press('3');
    await at(p, 'today');
    assert.equal((await place(p)).view, 'notebook', 'Today opens on the Page face again');
    await p.locator('.notebook .zm-faces [data-face="list"]').click();
    await p.waitForFunction(() => history.state?.tab === 'day');
  });

  await check('Alt + ` is Now from anywhere, even while typing', async () => {
    await p.keyboard.press('5');
    await at(p, 'project');
    await p.locator('.zm-faces').count();
    await p.keyboard.press('7');
    await at(p, 'library');
    await p.keyboard.press('Control+J');
    await p.waitForFunction(() => document.activeElement?.isContentEditable);
    await p.keyboard.type('a line');
    await p.keyboard.press('Alt+Backquote');
    await at(p, 'now');
  });

  await check('/ opens Go; a number typed in text stays text', async () => {
    await blur(p);
    await p.keyboard.press('/');
    await p.waitForFunction(() => !document.querySelector('.palette')?.hidden);
    await p.keyboard.press('Escape');
    await p.keyboard.press('Control+J');
    await p.waitForFunction(() => document.activeElement?.isContentEditable);
    const before = await place(p);
    await p.keyboard.type(' 7 8');
    await sleep(300);
    assert.deepEqual(await place(p), before);
  });

  await check('true focus: typing in a piece fades the ruler and the top line; the bottom edge brings the ruler back; Esc everything', async () => {
    await p.keyboard.press('Escape');
    await blur(p);
    await p.keyboard.press('5');
    await at(p, 'project');
    await p.keyboard.press('Control+J');
    await p.keyboard.press('Control+J');
    await p.waitForFunction(() => !document.documentElement.dataset.view);
    await p.locator('#editor .ProseMirror').click();
    await p.keyboard.type('Words. ');
    await p.waitForFunction(() => document.body.classList.contains('typing') && document.body.classList.contains('in-piece'));
    await sleep(400);
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.zm-ruler')).opacity), '0');
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.topbar')).opacity), '0');
    await p.mouse.move(640, 790);
    await sleep(400);
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.zm-ruler')).opacity), '1');
    await p.mouse.move(640, 400);
    await p.keyboard.type('More.');
    await sleep(400);
    await p.keyboard.press('Escape');
    await sleep(400);
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.topbar')).opacity), '1');
    assert.equal(await p.evaluate(() => document.activeElement?.isContentEditable || false), false);
  });

  await check('an amber dot on Desk while something needs you', async () => {
    await p.evaluate(() => document.dispatchEvent(new CustomEvent('inkwell:needs', { detail: 2 })));
    assert.equal(await p.locator('.zm-stop[data-stop="desk"].need').count(), 1);
    await p.evaluate(() => document.dispatchEvent(new CustomEvent('inkwell:needs', { detail: 0 })));
    assert.equal(await p.locator('.zm-stop[data-stop="desk"].need').count(), 0);
  });

  await check('More holds Focus, Look and every command', async () => {
    await p.locator('.zm-more').click();
    const items = await p.locator('.pop-menu .pop-item').allInnerTexts();
    assert.ok(items.some((t) => /^Focus/.test(t)) && items.some((t) => /^Look/.test(t)) && items.some((t) => /command/.test(t)), items.join(' | '));
    await p.keyboard.press('Escape');
  });

  await check('Classic layout brings back the rail and Today’s switch, and stays on this device', async () => {
    await p.evaluate(() => document.activeElement?.blur());
    await p.keyboard.press('Control+K');
    await p.keyboard.type('classic layout');
    await sleep(300);
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => !document.documentElement.classList.contains('zoom'));
    assert.equal(await p.locator('.rail').isVisible(), true);
    assert.equal(await p.locator('.zm-ruler').isVisible(), false);
    await p.reload();
    await p.waitForFunction(() => document.documentElement.dataset.started === '1');
    assert.equal(await p.evaluate(() => document.documentElement.classList.contains('zoom')), false);
    await p.evaluate(() => document.querySelector('#classic-layout').click());
    await p.waitForFunction(() => document.documentElement.classList.contains('zoom'));
    assert.equal(await p.locator('.zm-ruler').isVisible(), true);
  });
  await ctx.close();

  // ---------- the phone ----------
  const pctx = await browser.newContext({ zoom: true, ...devices['Pixel 7'], colorScheme: 'dark' });
  const ph = await open(pctx);
  await check('phone: the ruler takes the bottom bar’s place; seven equal columns, Now in the middle; the top line has the glass', async () => {
    assert.equal(await ph.locator('.placebar').isVisible(), false);
    assert.equal(await ph.locator('.zm-ruler').isVisible(), true);
    assert.equal(await ph.locator('.zm-stop[data-stop="month"]').innerText(), 'Month');
    const boxes = await ph.locator('.zm-stop').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().width));
    assert.equal(boxes.length, 7);
    assert.ok(Math.max(...boxes) - Math.min(...boxes) < 1.5, 'equal columns');
    const n = await ph.locator('.zm-stop[data-stop="now"]').boundingBox();
    assert.ok(Math.abs(n.x + n.width / 2 - 412 / 2) <= 2, 'Now in the middle');
    assert.equal(await ph.locator('.topbar .zm-go').isVisible(), true);
    const w = await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    assert.ok(w, 'no sideways scroll');
  });
  await check('phone: the keyboard is the switch', async () => {
    await ph.evaluate(() => window.__keyboard.set(true));
    await sleep(200);
    assert.equal(await ph.locator('.zm-ruler').isVisible(), false);
    await ph.evaluate(() => window.__keyboard.down());
    await sleep(200);
    assert.equal(await ph.locator('.zm-ruler').isVisible(), true);
  });
  await check('phone: tap a stop; a swipe is the next week; a pinch steps out and back in', async () => {
    await ph.locator('.zm-stop[data-stop="week"]').tap();
    await at(ph, 'week');
    const cdp = await pctx.newCDPSession(ph);
    const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    await touch('touchStart', [{ x: 300, y: 500 }]);
    for (let x = 300; x >= 100; x -= 40) await touch('touchMove', [{ x, y: 504 }]);
    await touch('touchEnd', []);
    await ph.waitForFunction(() => !!history.state?.week);
    await touch('touchStart', [{ x: 100, y: 420 }, { x: 300, y: 420 }]);
    for (let d = 0; d <= 80; d += 10) await touch('touchMove', [{ x: 100 + d, y: 420 }, { x: 300 - d, y: 420 }]);
    await touch('touchEnd', []);
    await at(ph, 'month');
    await touch('touchStart', [{ x: 180, y: 420 }, { x: 220, y: 420 }]);
    for (let d = 0; d <= 100; d += 10) await touch('touchMove', [{ x: 180 - d, y: 420 }, { x: 220 + d, y: 420 }]);
    await touch('touchEnd', []);
    await at(ph, 'week');
    assert.equal(await ph.evaluate(() => visualViewport.scale), 1, 'the browser didn’t zoom the page');
  });
  await check('phone: Today’s page face shows the page, with the faces under the title', async () => {
    await ph.locator('.zm-stop[data-stop="today"]').tap();
    await at(ph, 'today');
    await ph.locator('.zm-faces [data-face="page"]').tap();
    await ph.waitForFunction(() => history.state?.view === 'notebook');
    await ph.waitForSelector('.notebook .tp-switch:not([hidden]) .zm-faces');
    assert.equal(await ph.evaluate(() => document.querySelector('.notebook').dataset.tp), 'page');
    assert.equal(await ph.locator('#outline-editor').isVisible(), true);
  });
  await pctx.close();
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.log('page errors:\n' + errors.join('\n')); failed += 1; }
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
