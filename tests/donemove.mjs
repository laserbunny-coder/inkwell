// Done tasks move like open ones (Michael, Nov 27 2026: "select, drag and
// move done tasks just like undone tasks"). On Today's list a done one drags
// to a new place, steps with Alt + Up / Down, has Move to the top / bottom in
// its menu, and is picked with Shift; on the Week it sits in its day's order
// and drags to another day (it was then done on that day). On a phone a hold
// lifts it. A done one never goes off a day (it shows on the day it was done).
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4297;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const NOW = new Date('2026-11-11T14:04:00-08:00');
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
const named = async (p, t) => (await all(p)).find((r) => r.text === t && !r.deleted);
const go = async (p, tab) => {
  await p.evaluate((tab) => { const x = { view: 'plan', tab }; history.pushState(x, ''); dispatchEvent(new PopStateEvent('popstate', { state: x })); }, tab);
  await p.waitForFunction((tab) => document.documentElement.dataset.view === 'plan' && document.querySelector('#plan-sheet')?.dataset.tab === tab, tab);
  await sleep(400);
};
const words = (p) => p.locator('#plan-sheet .pl-task .pl-words').evaluateAll((els) => els.map((e) => (e.tagName === 'TEXTAREA' ? e.value : e.textContent).trim()));
const row = (p, text) => p.locator('#plan-sheet .pl-task', { hasText: text });
const add = async (p, text) => { const input = p.locator('#plan-sheet input[data-add]').first(); await input.fill(text); await input.press('Enter'); await sleep(350); };
const tick = async (p, text) => { await row(p, text).locator('.pl-check').click(); await sleep(500); };
const open = async (ctx) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.clock.install({ time: NOW });
  await p.goto(URL);
  await p.waitForFunction(() => document.documentElement.dataset.started === '1');
  await sleep(600);
  return p;
};

try {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport: { width: 1280, height: 860 } });
  const p = await open(ctx);
  await go(p, 'day');
  for (const t of ['Call Dana', 'Order the storage drive', 'Board reel 2']) await add(p, t);
  await p.evaluate(() => document.activeElement?.blur());
  await tick(p, 'Call Dana');

  await check('Today: a done task can be dragged like an open one', async () => {
    assert.deepEqual(await words(p), ['Call Dana', 'Order the storage drive', 'Board reel 2']);
    const r = row(p, 'Call Dana');
    assert.equal(await r.getAttribute('data-move'), '1');
    assert.equal(await r.getAttribute('draggable'), 'true');
    await r.dragTo(row(p, 'Board reel 2'), { targetPosition: { x: 200, y: 20 } });
    await sleep(600);
    assert.deepEqual(await words(p), ['Order the storage drive', 'Board reel 2', 'Call Dana']);
    assert.ok((await named(p, 'Call Dana')).fields.done, 'still done');
  });

  await check('Today: an open task drags past a done one, one place at a time', async () => {
    await row(p, 'Order the storage drive').dragTo(row(p, 'Call Dana'), { targetPosition: { x: 200, y: 20 } });
    await sleep(600);
    assert.deepEqual(await words(p), ['Board reel 2', 'Call Dana', 'Order the storage drive']);
  });

  await check('Today: Alt + Up steps a done task one place', async () => {
    await row(p, 'Call Dana').locator('.pl-words').focus();
    await p.keyboard.press('Alt+ArrowUp');
    await sleep(600);
    assert.deepEqual(await words(p), ['Call Dana', 'Board reel 2', 'Order the storage drive']);
  });

  await check('Today: a done task’s menu has Move to the bottom', async () => {
    await row(p, 'Call Dana').click({ button: 'right', position: { x: 200, y: 12 } });
    const item = p.locator('.pop-menu button', { hasText: 'Move to the bottom' });
    await item.waitFor({ timeout: 3000 });
    await item.click();
    await sleep(600);
    assert.deepEqual(await words(p), ['Board reel 2', 'Order the storage drive', 'Call Dana']);
  });

  await check('Today: Shift + click picks a done task with the open ones', async () => {
    await row(p, 'Order the storage drive').locator('.pl-words').click({ modifiers: ['Shift'] });
    await row(p, 'Call Dana').locator('.pl-words').click({ modifiers: ['Shift'] });
    await sleep(300);
    assert.equal(await p.locator('#plan-sheet .pl-task.sel').count(), 2);
    await p.keyboard.press('Escape');
    await sleep(300);
  });

  await check('Week: a done task sits in its day’s order and drags to another day', async () => {
    await go(p, 'week');
    assert.deepEqual(await p.locator('.pw-day.today .pw-t').allInnerTexts(), ['Board reel 2', 'Order the storage drive', 'Call Dana']);
    const chip = p.locator('.pw-task.done', { hasText: 'Call Dana' });
    assert.equal(await chip.getAttribute('data-move'), '1');
    const was = (await named(p, 'Call Dana')).fields.task.done_at;
    await chip.dragTo(p.locator('.pw-day[data-day="2026-11-10"]'), { targetPosition: { x: 40, y: 120 } });
    await sleep(700);
    assert.deepEqual(await p.locator('.pw-day[data-day="2026-11-10"] .pw-t').allInnerTexts(), ['Call Dana']);
    const t = (await named(p, 'Call Dana')).fields.task;
    assert.equal(t.day, '2026-11-10');
    assert.equal(new Date(t.done_at).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }), '2026-11-10');
    assert.equal(was - t.done_at, 864e5, 'same time of day, one day earlier');
    assert.ok((await named(p, 'Call Dana')).fields.done, 'still done');
  });

  await check('Week: a done task dropped on Not planned stays on its day', async () => {
    await p.locator('.pw-task.done', { hasText: 'Call Dana' }).dragTo(p.locator('.pw-np'), { targetPosition: { x: 40, y: 40 } });
    await sleep(700);
    assert.deepEqual(await p.locator('.pw-day[data-day="2026-11-10"] .pw-t').allInnerTexts(), ['Call Dana']);
    assert.equal((await named(p, 'Call Dana')).fields.task.day, '2026-11-10');
  });

  await check('Week: back to today, at its place', async () => {
    await p.locator('.pw-task.done', { hasText: 'Call Dana' }).dragTo(p.locator('.pw-day.today .pw-task', { hasText: 'Board reel 2' }), { targetPosition: { x: 20, y: 2 } });
    await sleep(700);
    assert.deepEqual(await p.locator('.pw-day.today .pw-t').allInnerTexts(), ['Call Dana', 'Board reel 2', 'Order the storage drive']);
  });
  await ctx.close();

  // A phone: hold a done task, slide it.
  const pctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  const phone = await open(pctx);
  await go(phone, 'day');
  await phone.waitForFunction(() => { document.activeElement?.blur(); return !document.body.classList.contains('kb-up'); });
  for (const t of ['Call Dana', 'Order the storage drive', 'Board reel 2']) await add(phone, t);
  await phone.evaluate(() => document.activeElement?.blur());
  await sleep(300);
  await row(phone, 'Board reel 2').locator('.pl-check').tap();
  await sleep(600);
  const cdp = await pctx.newCDPSession(phone);
  await check('phone: hold a done task, then slide it to the top', async () => {
    assert.deepEqual(await words(phone), ['Call Dana', 'Order the storage drive', 'Board reel 2']);
    const b = await row(phone, 'Board reel 2').locator('.pl-title').boundingBox();
    const top = await row(phone, 'Call Dana').boundingBox();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(450);
    assert.ok(await phone.locator('#plan-sheet .pl-task.pl-armed', { hasText: 'Board reel 2' }).count(), 'the held task lights up');
    for (let k = 1; k <= 8; k += 1) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + ((top.y + 4 - y) * k) / 8 }] }); await sleep(30); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(700);
    assert.deepEqual(await words(phone), ['Board reel 2', 'Call Dana', 'Order the storage drive']);
    assert.ok((await named(phone, 'Board reel 2')).fields.done, 'still done');
  });
  await pctx.close();
} catch (e) {
  failed += 1;
  console.log(`FAIL ${e.stack}`);
} finally {
  await browser.close();
  server.kill();
}
const real = errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError/.test(e));
if (real.length) { console.log(`page errors:\n  ${real.join('\n  ')}`); failed += 1; }
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
