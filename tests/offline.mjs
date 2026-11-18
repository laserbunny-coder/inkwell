// Offline: the rooms that load on demand (Make and Deliver, a world's pages
// and the Drawer, print, Woven's prep, Bring in) are fetched a little after
// the app starts, so the service worker keeps them. With no signal later,
// the app still starts and those rooms still open.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4295;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

// The chunks the build split off (everything in assets but the two pages' own).
const lazy = readdirSync('dist/assets').filter((f) => /^(prodview|stagepage|print|wovenprep|bringin)-.*\.js$/.test(f));
const browser = withoutSync(await chromium.launch());
try {
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  // The service worker takes over on the first visit; a reload puts the page under it.
  await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready.then(() => true), null, { timeout: 15000 });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.started === '1' && !!navigator.serviceWorker.controller);

  await check('the rooms that load on demand are kept by the service worker soon after start', async () => {
    assert.equal(lazy.length, 5, `found ${lazy.join(', ')}`);
    const kept = () => page.evaluate(async (names) => {
      const keys = await caches.keys();
      const urls = (await Promise.all(keys.map(async (k) => (await (await caches.open(k)).keys()).map((r) => r.url)))).flat();
      return names.filter((n) => urls.some((u) => u.endsWith(`/assets/${n}`)));
    }, lazy);
    let got = [];
    for (let i = 0; i < 40 && got.length < lazy.length; i++) { await sleep(500); got = await kept(); }
    assert.deepEqual(got.sort(), [...lazy].sort());
  });

  await check('with no signal the app starts, and the Drawer (a room that loads on demand) opens', async () => {
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1', null, { timeout: 15000 });
    await page.evaluate(() => { const pl = { view: 'drawer' }; history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'drawer' && document.querySelector('#stage-view')?.children.length > 0, null, { timeout: 10000 });
    await ctx.setOffline(false);
  });

  await check('no page errors', async () => { assert.deepEqual(errors, []); });
  await ctx.close();
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\noffline: ${failed} failed` : '\noffline: all passed');
process.exit(failed ? 1 : 0);
