// Today rebalanced (Nov 14 2026). On a phone: one line of header, one switch
// (Page, Plan, Calendar), one row per task, no cursor on arrival.
// Earlier days fold into one line that is never a place tasks get stuck: To
// today (Alt + Shift + T) with Undo, a Today button on each, Pick several. On a
// computer the plan sits beside the page or on top (Alt + P). With time
// estimates off, no hours anywhere. No sideways scroll anywhere on a phone.
// (Plan and Calendar themselves: tests/planviews.mjs.)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4292;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const browser = withoutSync(await chromium.launch());

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`); }
}
const started = (p) => p.waitForFunction(() => document.documentElement.dataset.started === '1');
const go = async (p, place) => {
  await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
  await p.waitForFunction((pl) => (document.documentElement.dataset.view || 'write') === pl.view, place);
  await sleep(450);
};
const add = async (p, text) => { const input = p.locator('#plan input[data-add]').first(); await input.fill(text); await input.press('Enter'); await sleep(250); };
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const named = async (p, text) => (await all(p)).find((r) => r.text === text && r.fields?.task);
const words = (p) => p.locator('#plan .pl-task:not(.done) .pl-words').allInnerTexts();
const OLD = { '2026-11-09': ['Renew the domain', 'Invoice for October'], '2026-11-10': ['Email the gym', 'Reply to the festival'], '2026-11-12': ['Balance pass'] };
const TODAY = ['Pick up the drives', 'Grade reel 1', 'Call Dana'];

// A device with five tasks left from earlier days and three for today (Sat, Nov 14).
async function device(opts, { estimates = false } = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', estimates, todayPage: false, ...opts });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  let first = true;
  for (const [d, list] of Object.entries(OLD)) {
    await p.clock.setFixedTime(new Date(`${d}T09:00:00-08:00`));
    if (first) await p.goto(URL); else await p.reload();
    first = false;
    await started(p);
    await go(p, { view: 'notebook', pageId: `day-${d}` });
    for (const t of list) await add(p, t);
  }
  await p.clock.setFixedTime(new Date('2026-11-14T08:30:00-08:00'));
  await p.reload();
  await started(p);
  await go(p, { view: 'notebook', pageId: 'day-2026-11-14' });
  for (const t of TODAY) await add(p, t);
  await p.evaluate(() => document.activeElement?.blur());
  await sleep(200);
  return p;
}

try {
  // ---------- phone ----------
  const phone = await device({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

  await check('phone: arriving on Today leaves the keyboard down and the bottom bar showing', async () => {
    await go(phone, { view: 'desk' });
    await go(phone, { view: 'notebook', pageId: 'day-2026-11-14' });
    assert.ok(!(await phone.evaluate(() => document.activeElement?.closest?.('.ProseMirror'))), 'no cursor in the page');
    assert.ok(!(await phone.evaluate(() => document.body.classList.contains('kb-up'))));
    assert.ok(await phone.locator('.placebar').isVisible(), 'the bar at the bottom');
  });

  await check('phone: one line of header and one switch of three in one row', async () => {
    assert.equal(await phone.locator('#nb-title').innerText(), 'Sat, Nov 14');
    assert.ok(!(await phone.locator('#nb-kind').isVisible()), 'no TODAY eyebrow');
    assert.ok(!(await phone.locator('.nb-date').isVisible()), 'no calendar icon');
    assert.deepEqual(await phone.locator('.tp-switch button').allInnerTexts(), ['Page', 'Plan', 'Calendar']);
    const tops = await phone.locator('.tp-switch button').evaluateAll((bs) => [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top)))]);
    assert.equal(tops.length, 1, 'one row');
    assert.equal(await phone.locator('.tp-switch [aria-current="page"]').innerText(), 'Plan', 'Plan the first time');
  });

  await check('phone: one row per task with estimates off (no timer, no empty second row)', async () => {
    assert.equal(await phone.locator('#plan .pl-play').count(), 0);
    const r = await phone.locator('#plan .pl-task', { hasText: 'Call Dana' }).boundingBox();
    assert.ok(r.height < 48, `one row (${r.height}px)`);
  });

  await check('phone: earlier days fold into one line, and unfold in place', async () => {
    assert.match(await phone.locator('#plan .pl-early-n').innerText(), /5 from earlier days/);
    assert.equal(await phone.locator('#plan .pl-task.carried').count(), 0, 'folded');
    assert.deepEqual(await words(phone), TODAY);
    await phone.locator('#plan .pl-early-n').click();
    await phone.waitForFunction(() => document.querySelectorAll('#plan .pl-task.carried').length === 5);
    assert.equal(await phone.locator('#plan .pl-task.carried').first().locator('.pl-from').innerText(), 'from Mon, Nov 9');
    assert.equal(await phone.locator('#plan .pl-task.carried .pl-today').count(), 5, 'a Today button on each');
  });

  await check('phone: the Today button moves one onto today, at the top', async () => {
    await phone.locator('#plan .pl-task', { hasText: 'Balance pass' }).locator('.pl-today').click();
    await phone.waitForFunction(() => document.querySelectorAll('#plan .pl-task.carried').length === 4);
    assert.equal((await named(phone, 'Balance pass')).fields.task.day, '2026-11-14');
    const w = await words(phone);
    assert.equal(w[4], 'Balance pass', 'first of today’s own, under the four still from earlier');
  });

  await check('phone: Pick several turns the circles into tick boxes, and the bar moves the picked ones', async () => {
    await phone.locator('#plan .pl-early-more').click();
    await phone.locator('.pop-item', { hasText: 'Pick several' }).click();
    await phone.waitForSelector('.pl-pickbar');
    await phone.locator('#plan .pl-task', { hasText: 'Renew the domain' }).locator('.pl-check').click();
    await phone.locator('#plan .pl-task', { hasText: 'Email the gym' }).locator('.pl-check').click();
    assert.match(await phone.locator('.pl-pick-n').innerText(), /2 picked/);
    assert.ok(!(await named(phone, 'Renew the domain')).fields.done, 'picking doesn’t tick');
    await phone.locator('.pl-pick-b', { hasText: 'Tomorrow' }).click();
    await phone.waitForFunction(() => document.querySelectorAll('#plan .pl-task.carried').length === 2);
    assert.equal((await named(phone, 'Renew the domain')).fields.task.day, '2026-11-15');
    assert.equal((await named(phone, 'Email the gym')).fields.task.day, '2026-11-15');
    await phone.waitForFunction(() => !document.querySelector('.pl-pickbar'));
  });

  await check('phone: Page shows the page alone, the choice is remembered, and a sideways swipe flips back', async () => {
    await phone.locator('.tp-switch button', { hasText: 'Page' }).click();
    await phone.waitForFunction(() => document.querySelector('.notebook').dataset.tp === 'page');
    assert.ok(!(await phone.locator('#plan').isVisible()), 'no plan');
    assert.ok(await phone.locator('#outline-editor').isVisible(), 'the page');
    await phone.reload();
    await started(phone);
    await go(phone, { view: 'notebook', pageId: 'day-2026-11-14' });
    assert.equal(await phone.evaluate(() => document.querySelector('.notebook').dataset.tp), 'page', 'remembered');
    const cdp = await phone.context().newCDPSession(phone);
    const y = 600;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 320, y }] });
    for (const x of [280, 220, 160, 110]) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await sleep(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await phone.waitForFunction(() => document.querySelector('.notebook').dataset.tp === 'plan');
  });

  await check('phone: no sideways scroll in any room', async () => {
    for (const place of [{ view: 'notebook', pageId: 'day-2026-11-14' }, { view: 'desk' }, { view: 'library' }, { view: 'tags' }, { view: 'drawer' }, { view: 'plan', tab: 'when' }, { view: 'plan', tab: 'week' }, { view: 'plan', tab: 'ahead' }]) {
      await go(phone, place);
      const [sw, cw] = await phone.evaluate(() => [document.scrollingElement.scrollWidth, document.scrollingElement.clientWidth]);
      assert.ok(sw <= cw, `${place.view}${place.tab ? ` ${place.tab}` : ''}: ${sw} > ${cw}`);
    }
  });

  await check('phone: no page errors', async () => { assert.deepEqual(phone.errors, []); });

  // ---------- computer ----------
  const pc = await device({ viewport: { width: 1280, height: 800 } });

  await check('computer: the plan sits in a column beside the page, earlier days folded', async () => {
    assert.ok(await pc.evaluate(() => document.querySelector('.notebook').classList.contains('plan-side')));
    const plan = await pc.locator('#plan').boundingBox();
    const page = await pc.locator('#outline-editor').boundingBox();
    assert.ok(plan.x > page.x + page.width - 4, 'to the right of the page');
    assert.ok(plan.y < 200, 'at the top, no scrolling');
    assert.equal(await pc.locator('#plan .pl-task.carried').count(), 0);
  });

  await check('computer: Alt + P puts it on top, and the choice survives a reload', async () => {
    await pc.keyboard.press('Alt+KeyP');
    await pc.waitForFunction(() => !document.querySelector('.notebook').classList.contains('plan-side'));
    const plan = await pc.locator('#plan').boundingBox();
    const page = await pc.locator('#outline-editor').boundingBox();
    assert.ok(plan.y < page.y, 'above the page');
    assert.match(await pc.locator('#plan .pl-flip').innerText(), /To the side/);
    await pc.reload();
    await started(pc);
    await go(pc, { view: 'notebook', pageId: 'day-2026-11-14' });
    assert.ok(!(await pc.evaluate(() => document.querySelector('.notebook').classList.contains('plan-side'))), 'still on top');
    await pc.locator('#plan .pl-flip').click();
    await pc.waitForFunction(() => document.querySelector('.notebook').classList.contains('plan-side'));
  });

  await check('computer: To today (Alt + Shift + T) moves them all to the top of today, Undo puts each back', async () => {
    await pc.locator('#outline-editor .ProseMirror').click();
    await pc.keyboard.press('Alt+Shift+KeyT');
    await pc.waitForFunction(() => /5 moved to today/.test(document.querySelector('.toast')?.textContent || ''));
    assert.deepEqual(await words(pc), ['Renew the domain', 'Invoice for October', 'Email the gym', 'Reply to the festival', 'Balance pass', ...TODAY]);
    assert.equal(await pc.locator('#plan .pl-early').count(), 0);
    await pc.locator('.toast .toast-action', { hasText: 'Undo' }).click();
    await pc.waitForFunction(() => document.querySelector('#plan .pl-early'));
    assert.equal((await named(pc, 'Renew the domain')).fields.task.day, '2026-11-09');
    assert.equal((await named(pc, 'Reply to the festival')).fields.task.day, '2026-11-10');
    assert.equal((await named(pc, 'Balance pass')).fields.task.day, '2026-11-12');
  });

  await check('computer: with estimates off there are no hours in Week, Weeks ahead or the switch', async () => {
    await go(pc, { view: 'plan', tab: 'week' });
    const text = await pc.locator('#plan-sheet').innerText();
    assert.doesNotMatch(text, /\d+(\.\d)? h\b|\d+ min\b/);
    assert.equal(await pc.locator('.pw-areas').count(), 0);
    assert.ok(!(await pc.locator('[data-cmd="pace"]').first().isVisible()), 'no Pace');
    await go(pc, { view: 'plan', tab: 'ahead' });
    assert.equal(await pc.locator('.ah-hrs').count(), 0);
  });

  await check('computer: no page errors', async () => { assert.deepEqual(pc.errors, []); });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nToday rebalanced: all good');
process.exit(failed ? 1 : 0);
