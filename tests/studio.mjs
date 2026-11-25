// Studio (Nov 23 2026, Elle's copy): built with VITE_EDITION=studio (here a
// device with localStorage edition = studio). Without the day tools it opens
// on the Desk, the ruler is Project, Desk and Library, the plan's places and
// the day's commands are gone, and Look > Add-ons turns the day tools on.
// The full edition (Michael's) never changes.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4302;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;

const browser = withoutSync(await chromium.launch());
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const started = (p) => p.waitForFunction(() => document.documentElement.dataset.started === '1');
const view = (p) => p.evaluate(() => document.documentElement.dataset.view);
const goto = async (p, place) => { await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place); await sleep(700); };
const stops = (p) => p.locator('.zm-ruler .zm-stop:visible .zm-word').allInnerTexts();
const commands = (p) => p.evaluate(() => window.__commandList().map((c) => c.label));

async function open(viewport, studio = true) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport });
  if (studio) await ctx.addInitScript(() => { try { localStorage.setItem('edition', 'studio'); } catch { /* no storage here */ } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(URL);
  await started(page);
  await sleep(500);
  return page;
}
// The box's own list, for what it would offer.
const boxHas = async (p, label) => { await p.keyboard.press('Control+k'); await p.waitForSelector('.palette[data-loaded]'); await p.keyboard.type(label.slice(0, 18)); await sleep(300); const t = await p.locator('.palette').innerText(); await p.keyboard.press('Escape'); await sleep(200); return t.includes(label); };

try {
  const page = await open({ width: 1400, height: 900 });

  await check('Studio opens on the Desk, with Project, Desk and Library on the ruler', async () => {
    assert.equal(await view(page), 'desk');
    assert.deepEqual(await stops(page), ['Project', 'Desk', 'Library']);
    assert.equal(await page.locator('.zm-np').isVisible(), false);
  });

  await check('a new Studio Library starts with Writing and Filmmaking', async () => {
    const areas = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result.filter((x) => x.kind === 'area' && !x.deleted).map((x) => x.title).sort()); }; }));
    assert.deepEqual(areas, ['Filmmaking', 'Writing']);
  });

  await check('the plan’s places open the Desk, and the 4 key does nothing of the day', async () => {
    await goto(page, { view: 'plan', tab: 'week' });
    assert.equal(await view(page), 'desk');
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('4');
    await sleep(500);
    assert.equal(await view(page), 'desk');
  });

  await check('the day’s commands leave Go', async () => {
    assert.equal(await boxHas(page, 'Talk the day through'), false);
    assert.equal(await boxHas(page, 'Add-ons: Bible reading, Training'), true);
  });

  await check('Look > Add-ons: Day tools on brings Today, Now, Week and Month back', async () => {
    await page.evaluate(() => dispatchEvent(new CustomEvent('open-addons')));
    await page.waitForSelector('.page-settings [data-addon="daytools"]');
    assert.equal(await page.locator('.page-settings [data-addon="daytools"]').isChecked(), false);
    await page.locator('.page-settings [data-addon="daytools"]').check();
    await sleep(500);
    await page.keyboard.press('Escape');
    assert.deepEqual(await stops(page), ['Year', 'Month', 'Week', 'Today', 'Project', 'Desk', 'Library']);
    await goto(page, { view: 'plan', tab: 'week' });
    assert.equal(await view(page), 'plan');
    assert.equal(await boxHas(page, 'Talk the day through'), true);
  });

  await check('it syncs: the setting is on the plan’s settings row, and stays after a reload', async () => {
    await page.reload();
    await started(page);
    await sleep(400);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('no-day')), false);
    await page.evaluate(() => dispatchEvent(new CustomEvent('open-addons')));
    await page.waitForSelector('.page-settings [data-addon="daytools"]');
    await page.locator('.page-settings [data-addon="daytools"]').uncheck();
    await sleep(500);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('no-day')), true);
    assert.equal(await view(page), 'desk');
  });

  const phone = await open({ width: 400, height: 850 });
  await check('on the phone: three stops across the bar', async () => {
    assert.deepEqual(await stops(phone), ['Project', 'Desk', 'Library']);
    const w = await phone.locator('.zm-ruler .zm-stop:visible').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    assert.ok(w.every((x) => x > 60), `wide enough to tap: ${w}`);
  });

  const full = await open({ width: 1400, height: 900 }, false);
  await check('the full edition: no Day tools switch, seven stops', async () => {
    assert.deepEqual(await stops(full), ['Year', 'Month', 'Week', 'Today', 'Project', 'Desk', 'Library']);
    await full.evaluate(() => dispatchEvent(new CustomEvent('open-addons')));
    await full.waitForSelector('.page-settings [data-addon="bible"]');
    assert.equal(await full.locator('.page-settings [data-addon="daytools"]').count(), 0);
  });

  for (const p of [page, phone, full]) assert.deepEqual(p.errors, []);
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nstudio: all passed');
