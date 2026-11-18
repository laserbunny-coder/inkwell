// Now on the ruler: the one thing you're on, as a page. A calendar event takes
// over five minutes before it starts, and afterwards you pick the thing back
// up. Plan rows are plain: the grip, the tick and the words. (The gate, small
// things as one entry and five big things at most went on Nov 17 2026; the
// rest of the Now page is in zoompage.mjs.)
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4281;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const TODAY = '2026-11-16';
const at = (s) => `${TODAY}T${s}:00-08:00`;
const EVENTS = [{ id: 'c1:lesson', title: 'Private lesson', start: at('15:00'), end: at('16:00'), allDay: false, calendar: 'Acro' }];

const browser = withoutSync(await chromium.launch());
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const task = async (p, text) => (await all(p)).find((r) => r.text === text && r.fields?.task);
const pointer = async (p) => (await all(p)).find((r) => r.id === 'settings-plan')?.fields?.now || null;
const go = async (p, place) => {
  await p.evaluate((x) => { history.pushState(x, ''); dispatchEvent(new PopStateEvent('popstate', { state: x })); }, place);
  await p.waitForFunction((x) => document.documentElement.dataset.view === 'plan' && document.querySelector('#plan-sheet')?.dataset.tab === x.tab, place);
  await settle(p);
};
const onNow = async (p) => { await go(p, { view: 'plan', tab: 'now' }); await p.waitForSelector('#plan-sheet .now-view'); };
const heading = (p) => p.locator('#plan-sheet .np-tx').first().innerText();
const thing = (p) => p.locator('#plan-sheet .now-thing').first().innerText();
const settle = async (p) => { await sleep(350); await still(p); };
const press = async (p, key) => { await p.evaluate(() => document.activeElement?.blur?.()); await p.keyboard.press(key); await settle(p); };
const add = async (p, text) => { const input = p.locator('#plan-sheet input[data-add]').first(); await input.fill(text); await input.press('Enter'); await sleep(350); };
const listWords = (p) => p.evaluate(() => [...document.querySelectorAll('#plan-sheet .now-list > .pl-task, #plan-sheet .now-list > .pl-wev')].map((el) => (el.classList.contains('pl-wev') ? `@ ${el.querySelector('.ev-w').textContent}` : el.querySelector('.pl-words').textContent)));
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, rowDetails: false, todayNow: true, ...extra });
  await ctx.addInitScript((events) => { window.__calendar = async () => ({ connected: true, events }); }, EVENTS);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.install({ time: new Date(`${TODAY}T09:04:00-08:00`) });
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return { ctx, page };
}

try {
  const { page } = await open({ width: 1400, height: 900 });

  await check('Today’s list rows are plain: the tick and the words, nothing about time', async () => {
    await go(page, { view: 'plan', tab: 'day' });
    for (const t of ['Two-minute hook', 'Storyboard the cold open', 'Reply to Nate', 'Order passport photos']) await add(page, t);
    const row = page.locator('#plan-sheet .pl-task', { hasText: 'Storyboard the cold open' });
    assert.equal(await row.locator('.pl-check').isVisible(), true, 'the tick shows');
    assert.equal(await row.locator('.pl-est').isVisible(), false, 'no estimate or timer on the row');
  });

  await check('Now is simply the first thing: no Begin step', async () => {
    await onNow(page);
    assert.equal(await heading(page), 'Two-minute hook');
    assert.equal(await page.locator('#plan-sheet [data-now="begin"]').count(), 0, 'no gate');
    await shot(page, 'now-page');
  });

  await check('a calendar event takes over five minutes before it starts, then the thing is picked back up', async () => {
    await page.clock.setSystemTime(new Date(`${TODAY}T14:56:00-08:00`));
    await page.evaluate(() => window.__plan.redraw());
    await settle(page);
    assert.equal(await thing(page), 'Private lesson');
    assert.equal(await page.locator('#plan-sheet .now-eyebrow').innerText(), 'IN 4 MINUTES');
    await shot(page, 'now-event');
    await page.locator('#plan-sheet .now-btn', { hasText: 'It is over' }).click();
    await settle(page);
    await page.waitForSelector('#plan-sheet .np-tx');
    assert.equal(await page.locator('#plan-sheet [data-event]').count(), 0, 'the event has let go');
    await page.clock.setSystemTime(new Date(`${TODAY}T16:10:00-08:00`));
    assert.deepEqual(page.errors, []);
  });
  await page.context().close();

  // ---------- phone ----------
  const { page: phone } = await open({ width: 412, height: 915 }, { hasTouch: true, isMobile: true });
  await check('phone: the Now page fits, nothing spills', async () => {
    await go(phone, { view: 'plan', tab: 'day' });
    for (const t of ['Two-minute hook', 'Reply to Nate']) await add(phone, t);
    await phone.evaluate(() => document.activeElement?.blur());
    await onNow(phone);
    assert.equal(await heading(phone), 'Two-minute hook');
    const w = await phone.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.ok(w[0] <= w[1], `no sideways scroll (${w[0]} in ${w[1]})`);
    assert.deepEqual(phone.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nNow: all good');
