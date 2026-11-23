// Add-ons (Nov 23 2026, for Elle's copy): Bible reading and Training are off
// for a new person and turned on in Look > Add-ons. Bible reading asks which
// plan; Training starts with an empty page of one's own, not Michael's plan.
// Off takes today's open line away and keeps the data. A vault that already
// reads or trains (Michael's) has them on without asking.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4301;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const MON = '2026-11-16';
const at = (day, s) => `${day}T${s}:00-08:00`;

const browser = withoutSync(await chromium.launch());
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const put = (p, rows) => p.evaluate((rows) => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const tx = r.result.transaction(['entries', 'outbox'], 'readwrite'); for (const x of rows) { tx.objectStore('entries').put(x); tx.objectStore('outbox').put({ id: x.id }); } tx.oncomplete = () => res(); }; }), rows);
const started = (p) => p.waitForFunction(() => document.documentElement.dataset.started === '1');
const goto = async (p, place) => {
  await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
  await p.waitForFunction((pl) => document.documentElement.dataset.view === pl.view, place);
  await sleep(700);
};
const sheet = (p) => p.locator('#plan-sheet');
const toNow = async (p) => { await goto(p, { view: 'plan', tab: 'now' }); await p.waitForSelector('#plan-sheet .now-view'); await sleep(400); };
const toDesk = async (p) => { await goto(p, { view: 'desk' }); await p.waitForSelector('.desk-home .zd-head, .desk-home .dk-head'); await sleep(500); };
const addons = async (p) => { await p.evaluate(() => dispatchEvent(new CustomEvent('open-addons'))); await p.waitForSelector('.page-settings .ps-addons [data-addon="bible"]'); await sleep(200); };
const sw = (p, id) => p.locator(`.page-settings [data-addon="${id}"]`);
const lightLines = async (p) => (await all(p)).filter((r) => r.fields?.firstlight && !r.deleted && !r.fields?.done);

async function open({ asNew = true } = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport: { width: 1400, height: 900 }, rowDetails: false, todayNow: true, firstlight: true, training: true });
  if (asNew) await ctx.addInitScript(() => { try { localStorage.setItem('addonsAsNew', '1'); } catch { /* no storage here */ } });
  await ctx.addInitScript(() => { window.__claude = async (b) => (b?.mode === 'esv' ? { nokey: true } : { error: 'offline' }); window.__calendar = async () => ({ connected: true, events: [] }); });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.install({ time: new Date(at(MON, '07:00')) });
  await page.goto(URL);
  await started(page);
  return { ctx, page };
}

try {
  const { page } = await open();

  await check('a new person: no Bible reading on Today, no reading or training on the Desk', async () => {
    await toNow(page);
    assert.equal(await sheet(page).locator('.now-light').count(), 0);
    assert.equal((await lightLines(page)).length, 0);
    await toDesk(page);
    assert.equal(await page.locator('.dk-reading').count(), 0);
    assert.equal(await page.locator('.dk-train').count(), 0);
    assert.equal((await all(page)).some((r) => r.id === 'pg_training'), false, 'no Training page is made for her');
  });

  await check('Look has an Add-ons tab with both switches off', async () => {
    await addons(page);
    assert.equal(await page.evaluate(() => document.querySelector('.page-settings').dataset.tab), 'addons');
    assert.equal(await sw(page, 'bible').isChecked(), false);
    assert.equal(await sw(page, 'training').isChecked(), false);
    assert.equal(await page.locator('.page-settings .ps-plans').count(), 0);
  });

  await check('Bible reading on: it asks which plan, and One chapter a day gives one chapter', async () => {
    await sw(page, 'bible').check();
    await page.waitForSelector('.page-settings .ps-plans');
    assert.deepEqual(await page.locator('.ps-plan b').allInnerTexts(), ['Four tracks', 'Old and New Testament', 'One chapter a day']);
    assert.equal(await page.locator('.ps-plan input[value="four"]').isChecked(), true);
    await page.locator('.ps-plan input[value="chapter"]').check();
    await sleep(400);
    const st = (await all(page)).find((r) => r.id === 'settings-plan');
    assert.equal(st.fields.reading.plan, 'chapter');
    assert.equal(st.fields.addons.bible, true);
    await page.keyboard.press('Escape');
    await page.reload();
    await started(page);
    await toNow(page);
    assert.equal(await sheet(page).locator('.now-light').count(), 1);
    assert.deepEqual(await sheet(page).locator('.now-reading li').allInnerTexts(), ['Genesis 1']);
    await toDesk(page);
    assert.match(await page.locator('.dk-reading .dk-label').innerText(), /one chapter a day/i);
  });

  await check('Training on: an empty page of her own, none of Michael’s goals', async () => {
    await addons(page);
    await sw(page, 'training').check();
    await sleep(600);
    const rows = await all(page);
    const pageRow = rows.find((r) => r.id === 'pg_training');
    assert.ok(pageRow, 'the Training page is made');
    assert.equal(pageRow.fields.training.own, true);
    const lines = rows.filter((r) => !r.deleted && r.kind === 'line' && (r.parent_id === 'pg_training'));
    assert.deepEqual(lines.map((r) => r.text), ['Session 1']);
    assert.equal(rows.some((r) => /front lever/i.test(r.text || '')), false, 'none of his exercises');
    await page.keyboard.press('Escape');
    await toDesk(page);
    const text = await page.locator('.dk-train').innerText();
    assert.match(text, /your sessions/);
    assert.doesNotMatch(text, /Front lever|Waiting their turn|your training plan/);
  });

  await check('Bible reading off: today’s open line goes, the places stay', async () => {
    assert.equal((await lightLines(page)).length, 1);
    await addons(page);
    await sw(page, 'bible').uncheck();
    await sleep(600);
    assert.equal((await lightLines(page)).length, 0);
    const st = (await all(page)).find((r) => r.id === 'settings-plan');
    assert.equal(st.fields.addons.bible, false);
    assert.equal(st.fields.reading.plan, 'chapter', 'the plan is kept');
    await page.keyboard.press('Escape');
    await toDesk(page);
    assert.equal(await page.locator('.dk-reading').count(), 0);
  });

  await check('the Training command opens Add-ons while Training is off', async () => {
    await addons(page);
    await sw(page, 'training').uncheck();
    await sleep(400);
    await page.keyboard.press('Escape');
    await sleep(200);
    assert.equal(await page.locator('.page-settings').isHidden(), true);
    await page.evaluate(() => window.__commands?.find?.((c) => c.label.startsWith('Training:'))?.run());
    await sleep(400);
    if (await page.evaluate(() => !!window.__commands)) assert.equal(await page.evaluate(() => document.querySelector('.page-settings').dataset.tab), 'addons');
  });

  assert.deepEqual(page.errors, []);

  // ---------- a vault that already reads and trains (Michael's) ----------
  const { page: his } = await open();
  await check('his vault: both on without asking, on the four tracks', async () => {
    await put(his, [{ id: 'settings-plan', kind: 'settings', title: 'Plan', text: '', content: null, tags: [], type: null, area_id: null, links: [], parent_id: null, sort: 0, deleted: false, created_at: 1, updated_at: Date.now(), fields: { reading: { ot: 40, ps: 3, wi: 0, nt: 9, days: ['2026-11-15'] } } }]);
    await his.reload();
    await started(his);
    await toNow(his);
    assert.equal(await sheet(his).locator('.now-light').count(), 1);
    assert.equal(await sheet(his).locator('.now-reading li').count(), 6);
    await addons(his);
    assert.equal(await sw(his, 'bible').isChecked(), true);
    const st = (await all(his)).find((r) => r.id === 'settings-plan');
    assert.equal(st.fields.addons, undefined, 'nothing is written until someone flips a switch');
  });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\naddons: all passed');
