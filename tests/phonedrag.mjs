// Moving lines on a phone, as in Workflowy: every line shows faint six dots;
// a finger on them slides the line (with what's under it) at once, before or
// after another line, or, let go further right, as the first line under it.
// A tap on the dots still zooms in (or opens the menu of the line you're on).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { setOutline, readOutline } from './outliner-kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4282;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
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
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  const ph = await ctx.newPage();
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
  const drag = async (from, to, { lookMid = null } = {}) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    await sleep(30);
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

  await check('every line shows faint six dots on a phone, and nothing spills', async () => {
    await setOutline(ph, START);
    await blurred();
    for (const t of ['Board reel 2', 'Call Dana', 'Order rope']) {
      const d = dots(t);
      assert.ok(await d.isVisible(), `dots on “${t}”`);
      assert.ok(Number(await d.locator('.grip').evaluate((g) => getComputedStyle(g).opacity)) > 0.2, `faintly visible on “${t}”`);
    }
    assert.ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'nothing spills');
  });

  await check('a finger on the dots slides the line at once, with what is under it, and a copy rides under the finger', async () => {
    await setOutline(ph, START);
    await blurred();
    const from = await centre(dots("Kenji's verse"));
    const to = await centre(words('Call Dana'));
    let lifted = 0;
    await drag(from, { x: from.x, y: to.b.y + to.b.height - 3 }, { lookMid: async () => { lifted = await ph.locator('.line-lift').count(); } });
    assert.equal(lifted, 1, 'the line lifts and follows the finger');
    assert.equal(await ph.locator('.line-lift').count(), 0, 'and is gone once it lands');
    const plain = (await readOutline(ph)).replace(/\|/g, '');
    assert.equal(plain, ['Board reel 2', 'Call Dana', "Kenji's verse", '  Rhymes for the chorus', 'Order rope'].join('\n'));
    assert.equal(await ph.evaluate(() => document.activeElement?.closest?.('.ProseMirror') ? 'editor' : 'none'), 'none', 'the keyboard stays down');
  });

  await check('let go further to the right, and the line goes under the one above, as its first line', async () => {
    await setOutline(ph, START);
    await blurred();
    const from = await centre(dots('Order rope'));
    const to = await centre(words('Board reel 2'));
    await drag(from, { x: to.b.x + 90, y: to.b.y + to.b.height - 3 });
    assert.equal((await readOutline(ph)).replace(/\|/g, ''), ["Kenji's verse", '  Rhymes for the chorus', 'Board reel 2', '  Order rope', 'Call Dana'].join('\n'));
  });

  await check('a line can go to the very top', async () => {
    await setOutline(ph, START);
    await blurred();
    const from = await centre(dots('Call Dana'));
    const to = await centre(words("Kenji's verse"));
    await drag(from, { x: from.x, y: to.b.y + 3 });
    assert.equal((await readOutline(ph)).replace(/\|/g, ''), ['Call Dana', "Kenji's verse", '  Rhymes for the chorus', 'Board reel 2', 'Order rope'].join('\n'));
  });

  await check('a quick tap on the dots still zooms into the line', async () => {
    await setOutline(ph, START);
    await blurred();
    const d = await centre(dots("Kenji's verse"));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: d.x, y: d.y }] });
    await sleep(80);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await ph.waitForFunction(() => /Kenji/.test(document.querySelector('#outline-editor li.zoom-root > p')?.textContent || ''));
    await ph.evaluate(() => window.__outline.view.dispatch(window.__outline.state.tr.setMeta(window.__foldKey, { zoom: null })));
    assert.equal((await readOutline(ph)).replace(/\|/g, ''), START.trim());
  });

  await check('with the six-dot handle switched off under Look, the dots go away', async () => {
    await ph.evaluate(() => document.documentElement.classList.add('hide-handle'));
    assert.equal(await dots('Board reel 2').isVisible(), false);
    await ph.evaluate(() => document.documentElement.classList.remove('hide-handle'));
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nphone drag: all good');
process.exit(failed ? 1 : 0);
