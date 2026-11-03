// After 9 pm, today's page shows a quiet card to look back over the day, once
// there's something on it and no review yet. "Not tonight" puts it away for
// the night; "Review the day" asks Claude, and then the card is gone.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4249;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const asked = [];
function claude(body) {
  if (body.mode !== 'review') return {};
  asked.push(body);
  return { summary: 'A day of packing lists for the Ninja Bunch shoot.', threads: [], still: [] };
}

const browser = withoutSync(await chromium.launch());
const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport: { width: 1280, height: 860 } });
await ctx.exposeFunction('__toClaude', claude);
await ctx.addInitScript(() => { window.__claude = (body) => window.__toClaude(body); });
const page = await ctx.newPage();
page.errors = [];
page.on('pageerror', (e) => page.errors.push(e.message));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const at = (time) => page.clock.setFixedTime(new Date(`${time}-08:00`));
const today = async () => {
  await page.reload();
  await page.waitForSelector('main.notebook #outline-editor .ProseMirror', { state: 'visible' });
  await sleep(1200);
};
const shown = () => page.locator('.evening-card').isVisible();

try {
  await at('2026-11-03T20:30:00');
  await page.goto(URL);
  await page.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  if ((await page.evaluate(() => document.documentElement.dataset.view)) !== 'notebook') await page.keyboard.press('Control+J');
  await page.waitForSelector('main.notebook #outline-editor .ProseMirror', { state: 'visible' });

  await check('before 9 pm there is no card', async () => {
    await page.click('#outline-editor .ProseMirror');
    await page.keyboard.type('Kenji’s sword prop: check the glue');
    await sleep(1500);
    assert.equal(await shown(), false);
  });

  await check('after 9 pm, with lines on today and no review, the card shows at the top', async () => {
    await at('2026-11-03T21:05:00');
    await today();
    assert.equal(await shown(), true);
    assert.match(await page.locator('.evening-card').innerText(), /after 9/);
    // Above the lines.
    const card = await page.locator('.evening-card').boundingBox();
    const lines = await page.locator('#outline-editor').boundingBox();
    assert.ok(card.y < lines.y);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/evening-card.png` });
  });

  await check('"Not tonight" puts it away for the rest of the night', async () => {
    await page.locator('.evening-card .ec-skip').click();
    assert.equal(await shown(), false);
    await today();
    assert.equal(await shown(), false);
    await page.evaluate(() => localStorage.removeItem('eveningSkip'));
    await today();
    assert.equal(await shown(), true);
  });

  await check('it can be switched off under Aa', async () => {
    await page.evaluate(() => document.querySelector('[data-show="nudge"]').click());
    assert.equal(await shown(), false);
    await page.evaluate(() => document.querySelector('[data-show="nudge"]').click());
    assert.equal(await shown(), true);
  });

  await check('"Review the day" asks Claude, and the card goes once the review is in', async () => {
    await page.locator('.evening-card .ec-start').click();
    await page.waitForSelector('.day-review .dr-toggle', { state: 'visible', timeout: 5000 });
    assert.equal(asked.length, 1);
    assert.equal(await shown(), false);
    await today();
    assert.equal(await shown(), false);
  });

  await check('an empty today gets no card, even late', async () => {
    await at('2026-11-04T22:15:00');
    await today();
    assert.equal(await page.evaluate(() => document.querySelector('#nb-title').textContent.length > 0), true);
    assert.equal(await shown(), false);
  });

  await check('the Notes button stays in place, dimmed, outside a draft', async () => {
    assert.equal(await page.locator('#notes-toggle').isDisabled(), true);
    assert.equal(await page.locator('#notes-toggle').isVisible(), true);
    await page.keyboard.press('Control+J');
    await page.waitForFunction(() => !document.documentElement.dataset.view);
    assert.equal(await page.locator('#notes-toggle').isDisabled(), false);
    await page.keyboard.press('Control+J');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    assert.equal(await page.locator('#notes-toggle').isDisabled(), true);
  });

  await check('no page errors', async () => assert.deepEqual(page.errors, []));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
