// Moving lines on a phone, as in Workflowy: hold a finger still on a line's
// words and it lifts, then follows the finger (with what's under it), before
// or after another line, or, let go further right, as the first line under it.
// Held still and let go, its menu comes up. A tap on the words puts the
// cursor there; a quick swipe scrolls. No six dots (one way everywhere).
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { setOutline, readOutline } from './outliner-kit.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4282;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const browser = withoutSync(await chromium.launch());
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); if (process.env.STACK) console.log(e.stack); }
}

const START = `
Kenji's verse
  Rhymes for the chorus
Board reel 2
Call Dana
Order rope`;

try {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  const ph = await ctx.newPage();
  // A morning, so the evening's "Look back over today?" card can't come in above the lines mid-check.
  await ph.clock.install({ time: new Date('2026-11-11T10:00:00-08:00') });
  const errors = [];
  ph.on('pageerror', (e) => errors.push(e.message));
  await ph.goto(URL);
  await ph.waitForSelector('#editor .ProseMirror');
  await ph.keyboard.press('Control+J');
  await ph.waitForFunction(() => document.querySelector('#nb-kind')?.textContent === 'Today');
  const cdp = await ctx.newCDPSession(ph);
  const dots = (text) => ph.locator('#outline-editor li', { has: ph.locator(':scope > p', { hasText: text }) }).first().locator(':scope > .line-gutter .bullet');
  const words = (text) => ph.locator('#outline-editor li > p', { hasText: text }).first();
  const centre = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
  // One finger: down on (x, y), then slide to (x2, y2) in small steps, then up.
  const drag = async (from, to, { lookMid = null, wait = 30 } = {}) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    await sleep(wait);
    const steps = 10;
    for (let k = 1; k <= steps; k += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps }] });
      await sleep(25);
    }
    if (lookMid) await lookMid();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
  };
  const blurred = async () => { await ph.evaluate(() => document.activeElement?.blur()); await sleep(200); };

  await check('no six dots on any line on a phone, and nothing spills', async () => {
    await setOutline(ph, START);
    await blurred();
    for (const t of ['Board reel 2', 'Call Dana', 'Order rope']) assert.equal(await dots(t).isVisible(), false, `no dots on “${t}”`);
    assert.ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'nothing spills');
  });

  // Held by the start of its words, so letting go straight below stays at the same depth.
  const startOf = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + 10, y: b.y + b.height / 2, b }; };
  await check('a line held by its words slides, with what is under it, and a copy rides under the finger', async () => {
    await setOutline(ph, START);
    await blurred();
    const from = await startOf(words("Kenji's verse"));
    const to = await centre(words('Call Dana'));
    let lifted = 0;
    await drag(from, { x: from.x, y: to.b.y + to.b.height - 3 }, { wait: 500, lookMid: async () => { lifted = await ph.locator('.line-lift').count(); } });
    assert.equal(lifted, 1, 'the line lifts and follows the finger');
    assert.equal(await ph.locator('.line-lift').count(), 0, 'and is gone once it lands');
    assert.equal((await readOutline(ph)).replace(/\|/g, ''), ['Board reel 2', 'Call Dana', "Kenji's verse", '  Rhymes for the chorus', 'Order rope'].join('\n'));
    assert.equal(await ph.evaluate(() => document.activeElement?.closest?.('.ProseMirror') ? 'editor' : 'none'), 'none', 'the keyboard stays down');
  });

  await check('a line can go to the very top', async () => {
    await setOutline(ph, START);
    await blurred();
    const from = await startOf(words('Call Dana'));
    const to = await centre(words("Kenji's verse"));
    await drag(from, { x: from.x, y: to.b.y + 3 }, { wait: 500 });
    assert.equal((await readOutline(ph)).replace(/\|/g, ''), ['Call Dana', "Kenji's verse", '  Rhymes for the chorus', 'Board reel 2', 'Order rope'].join('\n'));
  });

  await check('hold a finger on a line’s words: it pops out, then follows the finger to its new place', async () => {
    await setOutline(ph, START);
    await blurred();
    const from = await centre(words('Order rope'));
    const to = await centre(words('Board reel 2'));
    let popped = 0, moved = 0, scrolled = -1;
    const y0 = await ph.evaluate(() => scrollY);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    await sleep(500);
    popped = await ph.locator('.line-lift').count();
    // Android's own long-press menu comes at about half a second: it is held back.
    const stopped = await words('Order rope').evaluate((p) => !p.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    for (let k = 1; k <= 10; k += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x, y: from.y + ((to.b.y + 3 - from.y) * k) / 10 }] });
      await sleep(25);
    }
    moved = await ph.locator('.line-drop:not([hidden])').count();
    scrolled = await ph.evaluate((y) => scrollY - y, y0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
    assert.equal(popped, 1, 'the line pops out once held');
    assert.ok(stopped, 'the phone’s own menu is held back');
    assert.equal(moved, 1, 'a line shows where it will land');
    assert.equal(scrolled, 0, 'the page stays put while the line moves');
    assert.equal((await readOutline(ph)).replace(/\|/g, ''), ["Kenji's verse", '  Rhymes for the chorus', 'Order rope', 'Board reel 2', 'Call Dana'].join('\n'));
    assert.equal(await ph.locator('.line-lift').count(), 0, 'and the copy is gone once it lands');
    assert.equal(await ph.evaluate(() => document.activeElement?.closest?.('.ProseMirror') ? 'editor' : 'none'), 'none', 'the keyboard stays down');
  });

  await check('a line held by its words carries what is under it, and can go under another line', async () => {
    await setOutline(ph, START);
    await blurred();
    // A whole step to the right of where it was picked up: one level in.
    const from = await centre(words("Kenji's verse"));
    const to = await centre(words('Call Dana'));
    await drag(from, { x: from.x + 60, y: to.b.y + to.b.height - 3 }, { wait: 500 });
    assert.equal((await readOutline(ph)).replace(/\|/g, ''), ['Board reel 2', 'Call Dana', "  Kenji's verse", '    Rhymes for the chorus', 'Order rope'].join('\n'));
  });

  await check('held still and let go, the line settles back, nothing changes, and its menu comes up', async () => {
    await setOutline(ph, START);
    await blurred();
    const at = await centre(words('Call Dana'));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
    await sleep(550);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await ph.waitForSelector('.as-sheet, .hm-menu, .handle-menu, [role="menu"]', { timeout: 3000 });
    assert.equal((await readOutline(ph)).replace(/\|/g, ''), START.trim());
    assert.equal(await ph.locator('.line-lift, .line-drop').count(), 0);
    await ph.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await sleep(300);
  });

  await check('a quick swipe over the words scrolls and moves nothing, and a tap puts the cursor there', async () => {
    await setOutline(ph, START);
    await blurred();
    const at = await centre(words('Board reel 2'));
    await drag(at, { x: at.x, y: at.y + 160 }, { wait: 40 });
    assert.equal((await readOutline(ph)).replace(/\|/g, ''), START.trim());
    assert.equal(await ph.locator('.line-lift').count(), 0, 'nothing lifted');
    await blurred();
    const c = await centre(words('Call Dana'));
    await ph.touchscreen.tap(c.x, c.y);
    await sleep(300);
    assert.ok((await readOutline(ph)).split('\n').find((l) => l.includes('Call')).includes('|'), 'the cursor is in “Call Dana”');
  });

  // Nov 26 2026: a hold always picks the line, and it stays picked.
  const pickedText = () => ph.evaluate(() => [...document.querySelectorAll('#outline-editor li > p')].filter((p) => getComputedStyle(p).backgroundColor !== 'rgba(0, 0, 0, 0)').map((p) => p.textContent));
  await check('in the line you are typing in, a hold picks it up too, and the keyboard goes down', async () => {
    await setOutline(ph, START);
    const c = await centre(words('Call Dana'));
    await ph.touchscreen.tap(c.x, c.y);
    await sleep(300);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
    await sleep(500);
    assert.equal(await ph.locator('.line-lift').count(), 1, 'it lifts');
    assert.equal(await ph.evaluate(() => !!document.activeElement?.closest?.('.ProseMirror')), false, 'out of typing');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await ph.waitForSelector('.as-sheet, .hm-menu, .handle-menu, [role="menu"]', { timeout: 3000 });
    assert.equal((await readOutline(ph)).replace(/\|/g, ''), START.trim());
    assert.deepEqual(await pickedText(), ['Call Dana'], 'it stays picked while its menu is up');
    await ph.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await sleep(300);
  });

  await check('a finger that drifts a little while it holds still picks the line up', async () => {
    await setOutline(ph, START);
    await blurred();
    const c = await centre(words('Order rope'));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
    for (const [dx, dy] of [[3, 2], [6, -3], [9, 4], [5, 7]]) { await sleep(70); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x + dx, y: c.y + dy }] }); }
    await sleep(250);
    assert.equal(await ph.locator('.line-lift').count(), 1, 'it lifts');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
    assert.equal((await readOutline(ph)).replace(/\|/g, ''), START.trim(), 'a drift moves nothing');
    await ph.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await sleep(300);
  });

  await check('a long line that wraps: held on a word, the phone cannot pick words, and it moves in one go', async () => {
    const LONG = 'Order rope and the soft mats for Saturday, and ask the gym about the loft space for the shoot';
    const OUT = START.replace('Order rope', LONG);
    await setOutline(ph, OUT);
    await blurred();
    const w = words('soft mats');
    const b = (await centre(w)).b;
    assert.ok(b.height > 40, 'it wraps');
    const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const to = await centre(words("Kenji's verse"));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    await sleep(300);
    // What the phone's own long press does on a word, before the hold lifts the line.
    const stopped = await ph.evaluate(() => {
      const p = [...document.querySelectorAll('#outline-editor li > p')].find((q) => q.textContent.includes('soft mats'));
      const e = new Event('selectstart', { bubbles: true, cancelable: true });
      p.firstChild.dispatchEvent(e);
      return { stopped: e.defaultPrevented, sel: getComputedStyle(p).webkitUserSelect || getComputedStyle(p).userSelect };
    });
    assert.equal(stopped.stopped, true, 'the phone may not start picking words');
    assert.equal(stopped.sel, 'none');
    await sleep(250);
    assert.equal(await ph.locator('.line-lift').count(), 1, 'it lifts');
    for (let k = 1; k <= 10; k += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x, y: from.y + ((to.b.y + 3 - from.y) * k) / 10 }] });
      await sleep(25);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
    assert.equal((await readOutline(ph)).replace(/\|/g, '').split('\n')[0], LONG, 'moved in one go');
    // A quick double tap still picks a word: nothing is stopped in the first moments.
    const early = await ph.evaluate(() => { const e = new Event('selectstart', { bubbles: true, cancelable: true }); document.querySelector('#outline-editor li > p').dispatchEvent(e); return e.defaultPrevented; });
    assert.equal(early, false, 'no hold, nothing stopped');
    const other = await centre(words('Call Dana'));
    await ph.touchscreen.tap(other.x, other.y);
    await sleep(300);
    await blurred();
  });

  await check('after a move the line stays picked; a slide on it moves it again at once; a tap elsewhere lets it go', async () => {
    await setOutline(ph, START);
    await blurred();
    const from = await centre(words('Order rope'));
    const to = await centre(words('Board reel 2'));
    await drag(from, { x: from.x, y: to.b.y + 3 }, { wait: 500 });
    assert.deepEqual(await pickedText(), ['Order rope'], 'still picked after it lands');
    // Picked: no hold needed, a slide moves it.
    const again = await centre(words('Order rope'));
    const top = await centre(words("Kenji's verse"));
    await drag(again, { x: again.x, y: top.b.y + 3 }, { wait: 30 });
    assert.equal((await readOutline(ph)).replace(/\|/g, '').split('\n')[0], 'Order rope', 'moved at once');
    assert.deepEqual(await pickedText(), ['Order rope']);
    const other = await centre(words('Call Dana'));
    await ph.touchscreen.tap(other.x, other.y);
    await sleep(300);
    assert.deepEqual(await pickedText(), [], 'a tap elsewhere lets it go');
    await blurred();
  });

  await check('after a move it stays a move: no cursor or keyboard, nothing picked, and the next line can be held straight away', async () => {
    await setOutline(ph, START);
    // Typing in “Call Dana” first, keyboard up.
    const c = await centre(words('Call Dana'));
    await ph.touchscreen.tap(c.x, c.y);
    await sleep(300);
    assert.equal(await ph.evaluate(() => !!document.activeElement?.closest?.('.ProseMirror')), true, 'typing to begin with');
    const from = await centre(words('Order rope'));
    const to = await centre(words('Board reel 2'));
    await drag(from, { x: from.x, y: to.b.y + 3 }, { wait: 500 });
    assert.equal((await readOutline(ph)).replace(/\|/g, ''), ["Kenji's verse", '  Rhymes for the chorus', 'Order rope', 'Board reel 2', 'Call Dana'].join('\n'));
    assert.equal(await ph.evaluate(() => !!document.activeElement?.closest?.('.ProseMirror')), false, 'out of typing: the keyboard goes down');
    assert.equal(await ph.evaluate(() => String(getSelection())), '', 'no words picked');
    // The line just moved can be held and moved again at once.
    const again = await centre(words('Order rope'));
    const top = await centre(words("Kenji's verse"));
    await drag(again, { x: again.x, y: top.b.y + 3 }, { wait: 500 });
    assert.equal((await readOutline(ph)).replace(/\|/g, ''), ['Order rope', "Kenji's verse", '  Rhymes for the chorus', 'Board reel 2', 'Call Dana'].join('\n'));
    // And another one after it.
    const next = await centre(words('Call Dana'));
    const top2 = await centre(words('Order rope'));
    await drag(next, { x: next.x, y: top2.b.y + 3 }, { wait: 500 });
    assert.equal((await readOutline(ph)).replace(/\|/g, ''), ['Call Dana', 'Order rope', "Kenji's verse", '  Rhymes for the chorus', 'Board reel 2'].join('\n'));
    assert.equal(await ph.evaluate(() => !!document.activeElement?.closest?.('.ProseMirror')), false, 'still out of typing');
    // A tap goes back to typing.
    const t = await centre(words('Board reel 2'));
    await ph.touchscreen.tap(t.x, t.y);
    await sleep(300);
    assert.ok((await readOutline(ph)).split('\n').find((l) => l.includes('Board')).includes('|'), 'a tap puts the cursor there');
  });

  await check('a double tap on a line’s words zooms into it; one tap only puts the cursor there', async () => {
    await setOutline(ph, START);
    await blurred();
    const c = await centre(words('Board reel 2'));
    await ph.touchscreen.tap(c.x, c.y);
    await sleep(500);
    assert.equal(await ph.locator('#outline-editor li.zoom-root').count(), 0, 'one tap: no zoom');
    await ph.touchscreen.tap(c.x, c.y);
    await sleep(120);
    await ph.touchscreen.tap(c.x, c.y);
    await ph.waitForFunction(() => /Board reel 2/.test(document.querySelector('#outline-editor li.zoom-root > p')?.textContent || ''));
    await ph.evaluate(() => window.__outline.view.dispatch(window.__outline.state.tr.setMeta(window.__foldKey, { zoom: null })));
  });

  await check('no page errors', async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nphone drag: all good');
process.exit(failed ? 1 : 0);
