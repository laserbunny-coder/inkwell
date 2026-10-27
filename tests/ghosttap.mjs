// On a phone the six-dot menu rises from the bottom, often right under the
// finger that opened it. The tap that opens it must never also press the
// item that lands under that finger (it used to check lines off).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(`${process.execPath.replace(/bin\/node$/, '')}lib/node_modules/playwright`)); }

const PORT = 4211;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const browser = await chromium.launch();
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); if (process.env.STACK) console.log(e.stack); }
}

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const ph = await ctx.newPage();
  const errors = [];
  ph.on('pageerror', (e) => errors.push(e.message));
  await ph.goto(URL);
  await ph.waitForSelector('#editor .ProseMirror');
  await ph.keyboard.press('Control+J');
  await ph.waitForFunction(() => document.querySelector('#nb-kind')?.textContent === 'Today');
  await ph.evaluate(() => window.__notebook.editor.commands.focus('end'));
  for (let i = 0; i < 24; i++) { await ph.keyboard.type(`Line ${i}`); await ph.keyboard.press('Enter'); }
  await ph.keyboard.type('Buy rope');
  await sleep(300);

  const cdp = await ctx.newCDPSession(ph);
  // What the page heard during a tap, to explain a failure.
  await ph.evaluate(() => {
    for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'click']) {
      document.addEventListener(t, (e) => window.__pe?.push(`${t}:${e.pointerType || ''}:${e.target.className?.baseVal ?? e.target.className}:${e.detail ?? ''}`), true);
    }
  });
  const menu = ph.locator('.handle-menu.as-sheet');
  const handle = ph.locator('#outline-editor li.here > .line-gutter .bullet');
  const done = () => ph.evaluate(() => [...document.querySelectorAll('#outline-editor li[data-done] > p')].map((p) => p.textContent));
  // Puts the line you're on at a height on the screen, then taps its handle
  // the way a finger does (down, a moment, up, then the browser's click).
  // Returns false when the handle can't sit there (the page can't scroll that
  // far, or a bar covers that spot), so that height is skipped.
  const tapHandleAt = async (y) => {
    await ph.evaluate((y) => {
      const p = document.querySelector('#outline-editor li.here > p');
      window.scrollBy(0, p.getBoundingClientRect().top - y);
    }, y);
    await sleep(150);
    await handle.waitFor({ state: 'visible' });
    const b = await handle.boundingBox();
    const x0 = b.x + b.width / 2, y0 = b.y + b.height / 2;
    const clear = await ph.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('li.here > .line-gutter .bullet'), [x0, y0]);
    if (!clear) return false;
    await ph.evaluate(() => { window.__pe = []; });
    // A real thumb rests a moment before lifting; the menu is up by then.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    await sleep(120);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(400);
    if (!(await menu.isVisible())) {
      const state = await ph.evaluate(() => ({ root: document.documentElement.className, here: document.querySelector('#outline-editor li.here > p')?.textContent, active: document.activeElement?.className, zoomed: !!document.querySelector('.notebook.zoomed'), done: document.querySelectorAll('#outline-editor li[data-done]').length, view: document.documentElement.dataset.view, events: window.__pe }));
      throw new Error(`no sheet after tapping the handle at ${Math.round(y0)}px: ${JSON.stringify(state)}`);
    }
    return true;
  };

  await check('the tap that opens the sheet presses nothing in it', async () => {
    // Every height the line can sit at, down to the row above the keyboard.
    const floor = await ph.evaluate(() => document.querySelector('.outline-bar').getBoundingClientRect().top);
    let tried = 0;
    for (let y = 120; y < floor - 30; y += 30) {
      if (!(await tapHandleAt(y))) continue;
      tried += 1;
      assert.deepEqual(await done(), [], `line checked off by the opening tap (line at ${y}px)`);
      assert.equal(await ph.locator('.notebook.zoomed').count(), 0, `zoomed in by the opening tap (line at ${y}px)`);
      assert.equal(await menu.isVisible(), true, `sheet still open (line at ${y}px)`);
      await ph.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      await ph.waitForSelector('.handle-menu', { state: 'detached' });
    }
    assert.ok(tried >= 10, `only ${tried} heights could be tried`);
  });

  await check('a second tap on Mark done still checks the line off', async () => {
    assert.equal(await tapHandleAt(500), true);
    await menu.locator('.item', { hasText: 'Mark done' }).tap();
    await ph.waitForFunction(() => [...document.querySelectorAll('#outline-editor li[data-done] > p')].some((p) => p.textContent === 'Buy rope'));
    assert.equal(await ph.locator('.handle-menu').count(), 0, 'sheet closes');
  });

  await check('no page errors', async () => { assert.deepEqual(errors, []); });
  await ctx.close();
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
