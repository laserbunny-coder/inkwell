// First steps (Nov 23 2026, Studio onboarding): a new Studio copy starts with
// a sample short film and a First steps card on the Desk. Each of the six
// steps runs a short click-through; every step of every tour must find the
// thing it rings, so a build that moves a button fails here instead of
// quietly breaking the tour. All six done: delete the sample, the card goes.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4303;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;

const browser = withoutSync(await chromium.launch());
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const started = (p) => p.waitForFunction(() => document.documentElement.dataset.started === '1');
const all = (p) => p.evaluate(() => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); }; }));
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, ...extra });
  await ctx.addInitScript(() => { try { localStorage.setItem('edition', 'studio'); } catch { /* no storage here */ } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(URL);
  await started(page);
  await page.waitForSelector('.dk-first');
  await sleep(300);
  return page;
}

// Walks a step's tour to the end: each step must ring its thing (or be a
// plain tip), and Next, or a tap on the ringed thing, moves on.
async function walk(p, id) {
  await p.locator(`.dk-first-step[data-step="${id}"]`).click();
  const seen = [];
  for (let k = 0; k < 8; k++) {
    await p.waitForSelector('.tour-tip', { timeout: 4000 });
    await sleep(250);
    const n = await p.locator('.tour-n').innerText();
    const ring = await p.locator('.tour-ring').count();
    const next = p.locator('.tour-next');
    seen.push({ n, ring });
    if (await next.count()) {
      const last = (await next.innerText()) === 'Done';
      await next.click();
      if (last) break;
    } else {
      assert.equal(ring, 1, `${id} ${n}: a tap step rings its thing`);
      await p.locator('[data-tour-target]').click();
      await p.waitForFunction((n) => document.querySelector('.tour-n')?.textContent !== n, n);
    }
  }
  await p.waitForSelector('.tour-tip', { state: 'detached' });
  await p.waitForFunction(() => document.documentElement.dataset.view === 'desk');
  await sleep(400);
  return seen;
}

try {
  const page = await open({ width: 1400, height: 900 });

  await check('a new Studio copy: the sample film and the First steps card on the Desk', async () => {
    const rows = await all(page);
    const world = rows.find((r) => r.id === 'wd_sample_salt');
    assert.equal(world?.title, 'Salt Road');
    assert.equal(rows.filter((r) => r.kind === 'project' && !r.fields?.sample && !r.deleted).length, 0, 'no Untitled novel');
    assert.deepEqual(await page.locator('.dk-first-step .dk-first-t').allInnerTexts(), ['Write a scene', 'Add a character to the bible', 'Break the scene into shots', 'Pin a look on the look wall', 'Send someone a read link', 'Talk an idea in']);
    await shot(page, 'first-steps');
  });

  // Which tour steps ring something (the rest are plain tips by design).
  const RINGS = { scene: [1, 1, 1], bible: [1, 1], shots: [1, 0], look: [1, 0], share: [1], talk: [1] };
  for (const [id, want] of Object.entries(RINGS)) {
    await check(`the “${id}” tour finds everything it points at, and ticks its step`, async () => {
      const seen = await walk(page, id);
      assert.deepEqual(seen.map((s) => s.ring), want, JSON.stringify(seen));
      // The last one done: the card says so instead of listing the steps.
      if (id === 'talk') assert.equal(await page.locator('.dk-first-end').count(), 1);
      else assert.equal(await page.locator(`.dk-first-step[data-step="${id}"].done`).count(), 1);
    });
  }

  await check('all six: delete the sample, and the card goes', async () => {
    await page.waitForSelector('.dk-first-end');
    await page.locator('.dk-first-acts .pill', { hasText: 'Delete the sample' }).click();
    await sleep(600);
    assert.equal(await page.locator('.dk-first').count(), 0);
    const w = (await all(page)).find((r) => r.id === 'wd_sample_salt');
    assert.ok(w.deleted || w.fields?.trashed, 'the sample is in the Trash');
  });

  await check('Stop ends a tour, Escape too, and nothing is ticked', async () => {
    await page.evaluate(() => window.__commandList && null);
    // Show me around brings the card back.
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.palette[data-loaded]');
    await page.keyboard.type('Show me around');
    await sleep(300);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.dk-first');
  });

  const phone = await open({ width: 400, height: 850 }, { isMobile: true, hasTouch: true });
  await check('on a phone: the tip fits the screen and the tour still finds its things', async () => {
    await phone.locator('.dk-first-step[data-step="talk"]').click();
    await phone.waitForSelector('.tour-tip');
    await sleep(300);
    const box = await phone.locator('.tour-tip').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 400, `inside the screen: ${JSON.stringify(box)}`);
    assert.equal(await phone.locator('.tour-ring').count(), 1);
    await shot(phone, 'first-steps-phone');
    await phone.locator('.tour-stop').click();
    await sleep(200);
    assert.equal(await phone.locator('.tour-tip').count(), 0);
    assert.equal(await phone.locator('.dk-first-step.done').count(), 0);
  });

  for (const p of [page, phone]) assert.deepEqual(p.errors, []);
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nfirststeps: all passed');
