// Today as an outline (Nov 25 2026, Michael: "the today view is just kind of
// an aggregate... but it's still an outliner view"). On Today's list a click
// on a task's words puts the cursor in them; Tab starts a line under it, and
// the lines under a task, opened in place, are written right there ([] , Tab,
// Enter). The faded six dots zoom in on a click (the zoom is Now); Ctrl +
// Down / Up open and close a task's lines; Alt + Right zooms in. On a phone
// the dots show on the line you're on, and the others still take a tap.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4291;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const browser = withoutSync(await chromium.launch());
const errors = [];
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const open = async (ctx) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(URL);
  await p.waitForFunction(() => document.documentElement.dataset.started === '1');
  await sleep(600);
  return p;
};
const toList = async (p) => {
  await p.evaluate(() => { const x = { view: 'plan', tab: 'day' }; history.pushState(x, ''); dispatchEvent(new PopStateEvent('popstate', { state: x })); });
  await p.waitForFunction(() => document.documentElement.dataset.view === 'plan' && document.querySelector('#plan-sheet')?.dataset.tab === 'day');
  await sleep(400);
};
const add = async (p, text) => { const input = p.locator('#plan-sheet input[data-add]').first(); await input.fill(text); await input.press('Enter'); await sleep(350); };
const row = (p, text) => p.locator('#plan-sheet .pl-ol', { hasText: text });
const zoomedOn = (p, text) => p.waitForFunction((t) => document.documentElement.dataset.view === 'notebook' && (window.__plan.items || []).find((i) => i.row.id === history.state?.zoom)?.row.text === t, text, { timeout: 8000 });

try {
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 860 } });
  const p = await open(ctx);
  await toList(p);
  for (const t of ['Rewrite the dojo scene', 'Reply to the gym about Saturday', 'Find the script']) await add(p, t);
  await p.evaluate(() => document.activeElement?.blur());

  await check('a click on the words puts the cursor in them; Enter keeps the new words', async () => {
    await row(p, 'Reply to the gym').locator('.pl-words').click();
    const input = p.locator('#plan-sheet .pl-ol-in');
    await input.waitFor();
    await p.keyboard.press('End');
    await p.keyboard.type(' (10am?)');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => [...document.querySelectorAll('#plan-sheet .pl-words')].some((w) => w.textContent === 'Reply to the gym about Saturday (10am?)'));
    assert.equal(await p.evaluate(() => document.documentElement.dataset.view), 'plan', 'still on Today');
  });

  await check('Tab starts a line under it, written in place; [] makes a box', async () => {
    await row(p, 'Reply to the gym').locator('.pl-words').click();
    await p.locator('#plan-sheet .pl-ol-in').waitFor();
    await p.keyboard.press('Tab');
    await p.waitForFunction(() => document.activeElement?.closest?.('.pl-lines'), null, { timeout: 5000 });
    await p.keyboard.type('Ask about the 10am slot');
    await p.keyboard.press('Enter');
    await p.keyboard.type('[] Check the calendar');
    await sleep(1200);
    const rows = await all(p);
    const task = rows.find((r) => r.text === 'Reply to the gym about Saturday (10am?)');
    const kids = rows.filter((r) => r.parent_id === task.id && !r.deleted).map((r) => r.text);
    assert.ok(kids.includes('Ask about the 10am slot'), kids.join(' | '));
    assert.ok(kids.includes('Check the calendar'), kids.join(' | '));
    assert.ok(await p.locator('#plan-sheet .pl-lines [role="checkbox"]').count() >= 1, 'a box');
    await p.keyboard.press('Escape');
  });

  await check('Ctrl + Up closes its lines, Ctrl + Down opens them again', async () => {
    await row(p, 'Reply to the gym').locator('.pl-words').focus();
    await p.keyboard.press('Control+ArrowUp');
    await p.waitForFunction(() => !document.querySelector('#plan-sheet .pl-lines'));
    await row(p, 'Reply to the gym').locator('.pl-words').focus();
    await p.keyboard.press('Control+ArrowDown');
    await p.waitForFunction(() => /Ask about the 10am slot/.test(document.querySelector('#plan-sheet .pl-lines')?.textContent || ''));
  });

  await check('no six dots, even under the pointer; a double-click on the line zooms in (Now)', async () => {
    const grip = row(p, 'Rewrite the dojo').locator('.pl-grip');
    await row(p, 'Rewrite the dojo').hover();
    await sleep(250);
    assert.equal(Number(await grip.evaluate((g) => getComputedStyle(g).opacity)), 0, 'no dots on hover');
    await row(p, 'Rewrite the dojo').locator('.pl-words').dblclick();
    await zoomedOn(p, 'Rewrite the dojo scene');
    await p.locator('.nz-strip:not([hidden])').waitFor();
  });

  await check('a right-click on the line is the task’s menu, Zoom in first; there is no ⋯ on the line', async () => {
    await p.evaluate(() => document.activeElement?.blur());
    await p.keyboard.press('Alt+ArrowLeft');
    await p.waitForFunction(() => document.documentElement.dataset.view === 'plan' && document.querySelector('#plan-sheet')?.dataset.tab === 'day');
    await sleep(400);
    assert.equal(await row(p, 'Find the script').locator('.pl-more').isVisible(), false);
    await row(p, 'Find the script').locator('.pl-words').click({ button: 'right' });
    const menu = p.locator('.pop-menu');
    await menu.waitFor();
    assert.match(await menu.innerText(), /^Zoom in/);
    await menu.locator('[role="menuitem"]', { hasText: 'Zoom in' }).first().click();
    await zoomedOn(p, 'Find the script');
    await p.goBack();
    await p.waitForFunction(() => document.documentElement.dataset.view === 'plan' && document.querySelector('#plan-sheet')?.dataset.tab === 'day');
    await sleep(400);
  });

  await check('held still with the mouse and let go, the line’s menu comes up (and nothing else happens)', async () => {
    const b = await row(p, 'Find the script').locator('.pl-words').boundingBox();
    await p.mouse.move(b.x + 10, b.y + b.height / 2);
    await p.mouse.down();
    await sleep(650);
    await p.mouse.up();
    const menu = p.locator('.pop-menu');
    await menu.waitFor();
    assert.match(await menu.innerText(), /^Zoom in/);
    assert.equal(await p.locator('#plan-sheet .pl-ol-in').count(), 0, 'not typing in it');
    await p.keyboard.press('Escape');
    await sleep(300);
  });
  await check('the triangle sits at the far right of the line on a computer too', async () => {
    const r = await row(p, 'Reply to the gym').boundingBox();
    const f = await row(p, 'Reply to the gym').locator('.pl-fold').boundingBox();
    assert.ok(f.x + f.width > r.x + r.width - 60, `near the right edge (${Math.round(f.x)} of ${Math.round(r.x + r.width)})`);
  });
  await check('Alt + Right on a task zooms in, and Alt + Left goes out to the list', async () => {
    await row(p, 'Find the script').locator('.pl-words').focus();
    await p.keyboard.press('Alt+ArrowRight');
    await zoomedOn(p, 'Find the script');
    await p.evaluate(() => document.activeElement?.blur());
    await p.keyboard.press('Alt+ArrowLeft');
    await p.waitForFunction(() => document.documentElement.dataset.view === 'plan' && document.querySelector('#plan-sheet')?.dataset.tab === 'day');
  });
  await ctx.close();

  // ---------- the phone ----------
  const pctx = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' });
  const ph = await open(pctx);
  await toList(ph);
  for (const t of ['Rewrite the dojo scene', 'Find the script']) await add(ph, t);
  await ph.evaluate(() => document.activeElement?.blur());
  await sleep(300);
  await check('phone: no dots show, even on the line you are on', async () => {
    const id = await row(ph, 'Find the script').getAttribute('data-task');
    const mine = ph.locator(`#plan-sheet .pl-ol[data-task="${id}"] .pl-grip`);
    await row(ph, 'Find the script').locator('.pl-words').tap();
    await ph.locator('#plan-sheet .pl-ol-in').waitFor();
    await sleep(200);
    assert.equal(Number(await mine.evaluate((x) => getComputedStyle(x).opacity)), 0);
    await ph.locator('#plan-sheet .pl-ol-in').press('Enter');
    await sleep(500);
    assert.ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
  });
  await check('phone: a double tap on a task’s words zooms into it', async () => {
    const b = await row(ph, 'Rewrite the dojo').locator('.pl-words').boundingBox();
    const x = b.x + 20, y = b.y + b.height / 2;
    await ph.touchscreen.tap(x, y);
    await sleep(120);
    await ph.touchscreen.tap(x, y);
    await zoomedOn(ph, 'Rewrite the dojo scene');
    await ph.goBack();
    await ph.waitForFunction(() => document.querySelector('#plan-sheet')?.dataset.tab === 'day' && document.querySelectorAll('#plan-sheet .pl-ol').length === 2);
    await sleep(400);
  });
  await check('phone: a double tap anywhere on the line zooms, not only on its words', async () => {
    // A spot on the row that isn't the words, the tick box or a button.
    const spot = await ph.evaluate(() => {
      const r = [...document.querySelectorAll('#plan-sheet .pl-task.pl-ol')].find((x) => /Rewrite the dojo/.test(x.textContent));
      const b = r.getBoundingClientRect();
      for (let x = b.right - 4; x > b.left; x -= 6) {
        const el = document.elementFromPoint(x, b.top + b.height / 2);
        if (el && r.contains(el) && !el.closest('.pl-words, .pl-rename, .pl-check, button, a, input')) return { x, y: b.top + b.height / 2 };
      }
      return null;
    });
    assert.ok(spot, 'an empty spot on the row');
    await ph.touchscreen.tap(spot.x, spot.y);
    await sleep(150);
    await ph.touchscreen.tap(spot.x, spot.y);
    await zoomedOn(ph, 'Rewrite the dojo scene');
    await ph.goBack();
    await ph.waitForFunction(() => document.querySelector('#plan-sheet')?.dataset.tab === 'day' && document.querySelectorAll('#plan-sheet .pl-ol').length === 2);
    await sleep(400);
  });
  await check('phone: two taps further apart than a double tap only type', async () => {
    const b = await row(ph, 'Find the script').locator('.pl-words').boundingBox();
    const x = b.x + 20, y = b.y + b.height / 2;
    await ph.touchscreen.tap(x, y);
    await sleep(600);
    await ph.touchscreen.tap(x, y);
    await sleep(500);
    assert.equal(await ph.evaluate(() => document.querySelector('#plan-sheet')?.dataset.tab), 'day');
    assert.equal(await ph.locator('#plan-sheet .pl-ol-in').count(), 1, 'still typing in it');
    await ph.locator('#plan-sheet .pl-ol-in').press('Enter');
    await sleep(400);
  });
  await check('phone: the words are the box itself, so the tap lands the phone’s own cursor (and keyboard) there', async () => {
    const w = row(ph, 'Find the script').locator('.pl-words');
    assert.equal(await w.evaluate((x) => x.tagName), 'TEXTAREA', 'a box to type in, not a button swapped for one');
    await w.evaluate((x) => { x.dataset.same = '1'; });
    const b = await w.boundingBox();
    await ph.touchscreen.tap(b.x + 20, b.y + b.height / 2);
    await sleep(500);
    assert.equal(await ph.evaluate(() => document.activeElement?.dataset?.same), '1', 'the very box that was tapped has the cursor');
    await ph.keyboard.press('End');
    await ph.keyboard.type(' today');
    await ph.keyboard.press('Enter');
    await ph.waitForFunction(() => [...document.querySelectorAll('#plan-sheet .pl-words')].some((x) => x.value === 'Find the script today'));
    await ph.waitForFunction(() => document.activeElement?.tagName === 'BODY' && !document.querySelector('#plan-sheet .pl-ol-in'), null, { timeout: 4000 }).catch(() => {});
    assert.equal(await ph.evaluate(() => document.activeElement?.tagName), 'BODY', 'Enter ends it');
    // Back as it was, for the checks after this one.
    const w2 = row(ph, 'Find the script').locator('.pl-words');
    const b2 = await w2.boundingBox();
    await ph.touchscreen.tap(b2.x + 20, b2.y + b2.height / 2);
    await sleep(400);
    await ph.keyboard.press('End');
    for (let k = 0; k < 6; k++) await ph.keyboard.press('Backspace');
    await ph.keyboard.press('Enter');
    await ph.waitForFunction(() => [...document.querySelectorAll('#plan-sheet .pl-words')].some((x) => x.value === 'Find the script'));
    await sleep(300);
  });
  await check('phone: hold the line and let go: it is picked, with its options, Zoom in among them', async () => {
    const b = await row(ph, 'Find the script').locator('.pl-words').boundingBox();
    const cdp = await pctx.newCDPSession(ph);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + 20, y: b.y + b.height / 2 }] });
    await sleep(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await ph.waitForSelector('.zm-movebar:not([hidden]), [data-mb="open"]', { timeout: 5000 });
    assert.match(await ph.locator('[data-mb="open"]').innerText(), /Zoom in/);
  });
  await check('phone: the triangle sits at the far right of the line, on the task and on the lines under it', async () => {
    await ph.keyboard.press('Escape').catch(() => {});
    await ph.evaluate(() => document.activeElement?.blur());
    await row(ph, 'Rewrite the dojo').locator('.pl-words').tap();
    await ph.locator('#plan-sheet .pl-ol-in').waitFor();
    await ph.keyboard.press('Tab');
    await ph.waitForFunction(() => document.activeElement?.closest?.('.pl-lines'), null, { timeout: 5000 });
    await ph.keyboard.type('Kenji enters late');
    await ph.keyboard.press('Enter');
    await ph.keyboard.press('Tab');
    await ph.keyboard.type('He trips on the mat');
    await sleep(1200);
    await ph.evaluate(() => document.activeElement?.blur());
    await ph.reload();
    await ph.waitForFunction(() => document.documentElement.dataset.started === '1');
    await toList(ph);
    const at = await ph.evaluate(() => {
      const f = document.querySelector('#plan-sheet .pl-ol .pl-fold');
      const r = f?.closest('.pl-task').getBoundingClientRect();
      const sub = document.querySelector('#plan-sheet .pl-lines li.has-kids > .line-gutter .fold');
      const li = sub?.closest('li').getBoundingClientRect();
      return f && sub && { task: r.right - f.getBoundingClientRect().right, line: li.right - sub.getBoundingClientRect().right, wide: innerWidth };
    });
    assert.ok(at, 'both triangles are there');
    assert.ok(at.task < 16, `task triangle ${at.task}px from the right`);
    assert.ok(at.line < 16, `line triangle ${at.line}px from the right`);
  });
  await pctx.close();
} finally {
  await browser.close();
  server.kill();
}
const real = errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError/.test(e));
if (real.length) { console.log(`page errors:\n  ${real.join('\n  ')}`); failed += 1; }
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
