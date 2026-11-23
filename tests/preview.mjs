// "Try Studio as a new person" (Nov 23 2026): ?preview=new opens a tab as a
// brand-new Studio copy, with its own local data, so Michael can walk the
// onboarding as Elle will. His own writing, settings and edition never change.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4304;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;

const browser = withoutSync(await chromium.launch());
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const started = (p) => p.waitForFunction(() => document.documentElement.dataset.started === '1', null, { timeout: 20000 });
const all = (p) => p.evaluate(() => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); }; }));
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };

for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, ...(name === 'phone' ? { hasTouch: true, isMobile: true } : {}) });
  const mine = await ctx.newPage();
  await mine.goto(URL);
  await started(mine);
  await mine.evaluate(() => localStorage.setItem('look', 'paper'));
  const before = (await all(mine)).length;

  const pv = await ctx.newPage();
  pv.errors = [];
  pv.on('pageerror', (e) => pv.errors.push(e.message));

  await check(`${name}: the preview opens as a new Studio person, on the Desk with First steps`, async () => {
    await pv.goto(URL + '?preview=new');
    await started(pv);
    await pv.waitForSelector('.dk-first', { timeout: 10000 });
    assert.ok(await pv.evaluate(() => document.documentElement.classList.contains('studio') && document.documentElement.classList.contains('preview')));
    assert.ok(await pv.isVisible('.preview-strip'));
    assert.ok(!pv.url().includes('preview='), 'the address is tidied');
    assert.equal(await pv.evaluate(() => document.documentElement.dataset.look), 'midnight', 'his look on this device is not carried in');
    const rows = await all(pv);
    assert.ok(rows.some((r) => r.fields?.sample), 'the sample film is there');
    await sleep(400);
    await shot(pv, `preview-${name}`);
  });

  await check(`${name}: his own copy is untouched (no sample, not Studio, his look kept)`, async () => {
    const other = await ctx.newPage();
    await other.goto(URL);
    await started(other);
    const rows = await all(other);
    assert.equal(rows.filter((r) => r.fields?.sample).length, 0);
    assert.ok(rows.length <= before + 2, `rows ${before} -> ${rows.length}`);
    assert.ok(!(await other.evaluate(() => document.documentElement.classList.contains('studio'))));
    assert.equal(await other.evaluate(() => localStorage.getItem('edition')), null);
    assert.equal(await other.evaluate(() => localStorage.getItem('look')), 'paper');
    await other.close();
  });

  await check(`${name}: a reload stays in the preview; Start over begins again; Back leaves it`, async () => {
    await pv.evaluate(() => localStorage.setItem('pvMark', '1'));
    await pv.reload();
    await started(pv);
    assert.equal(await pv.evaluate(() => localStorage.getItem('pvMark')), '1');
    assert.ok(await pv.isVisible('.preview-strip'));
    await Promise.all([pv.waitForNavigation(), pv.click('.preview-strip button:has-text("Start over")')]);
    await started(pv);
    await pv.waitForSelector('.dk-first');
    assert.equal(await pv.evaluate(() => localStorage.getItem('pvMark')), null);
    await Promise.all([pv.waitForNavigation(), pv.click('.preview-strip button:has-text("Leave")')]);
    await started(pv);
    assert.ok(!(await pv.evaluate(() => document.documentElement.classList.contains('studio'))));
    assert.equal(await pv.$('.preview-strip'), null);
    assert.equal(await pv.evaluate(() => localStorage.getItem('look')), 'paper');
  });

  await check(`${name}: no page errors`, async () => { assert.deepEqual(pv.errors, []); });
  await ctx.close();
}

await browser.close();
server.kill();
if (failed) { console.log(`\npreview: ${failed} failed`); process.exit(1); }
console.log('\npreview: all passed');
