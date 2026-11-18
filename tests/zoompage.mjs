// The zoom, Part 2 (Nov 2026): Now as a page. The one thing as its own page
// (where-line, heading, circle, notes, Not now, "N more today"); First light
// as the first line of the day; any line opens there without moving
// ("Bring to today", "Back to", a hollow Now dot); the door into a step's
// piece; "Write a note"; the thought box on Alt + J; the phone.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4234;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const browser = withoutSync(await chromium.launch());
const errors = [];
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const place = (p) => p.evaluate(() => history.state);
const at = async (p, stop) => {
  await p.waitForFunction((s) => !document.documentElement.dataset.zt && document.querySelector('.zm-stop[aria-current]')?.dataset.stop === s, stop, { timeout: 8000 });
  await sleep(250);
};
const blur = (p) => p.evaluate(() => document.activeElement?.blur());
const heading = (p) => p.locator('.np-tx').innerText();
const task = (p, re) => p.evaluate((src) => { const i = window.__plan.items.find((x) => new RegExp(src).test(x.row.text)); return i ? { id: i.row.id, day: i.task.day || null, done: !!i.row.fields?.done, for: i.task.for || null, span: i.task.span || null } : null; }, re);
const open = async (ctx) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(URL);
  await p.waitForFunction(() => document.documentElement.dataset.started === '1');
  await sleep(600);
  return p;
};
// Tasks typed into the box (Ctrl + K): Enter for today, Ctrl + Enter for a trailing day word.
async function add(p, text, dayWord = false) {
  await p.keyboard.press('Control+K');
  await sleep(200);
  await p.keyboard.type(text);
  await sleep(350);
  await p.keyboard.press(dayWord ? 'Control+Enter' : 'Enter');
  await sleep(500);
}

try {
  const ctx = await browser.newContext({ firstlight: true, colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
  const p = await open(ctx);
  // Typed inside the piece Inkwell opens on: a step for that piece.
  assert.equal(await p.evaluate(() => document.documentElement.dataset.view || 'write'), 'write');
  await add(p, 'Polish the ending tomorrow', true);
  // Typed from the Library: steps with no piece of their own.
  await p.keyboard.press('Control+Shift+O');
  await p.waitForFunction(() => document.documentElement.dataset.view === 'library');
  await add(p, 'Rewrite the cold open');
  await add(p, 'Board scene 3');
  await add(p, 'Color pass on the trailer next week', true);
  await blur(p);

  await check('Bible reading is the first line of the day, and Now opens on it as a page', async () => {
    await p.keyboard.press('4');
    await at(p, 'now');
    await p.waitForSelector('.np-tx');
    assert.equal(await heading(p), 'Bible reading');
    assert.match(await p.locator('.np-crumb').innerText(), /Every day/);
    assert.ok(await p.locator('.np-kind .now-reading li').count() >= 4, 'the reading list under it');
    assert.ok(await task(p, '^Bible reading$'), 'a line of the day');
  });

  await check('read: Bible reading is done and the next line simply is the one thing (no gate)', async () => {
    await p.keyboard.press('i');
    await p.waitForFunction(() => document.querySelector('.np-tx')?.textContent === 'Rewrite the cold open');
    assert.equal((await task(p, '^Bible reading$')).done, true);
    assert.equal(await p.locator('.now-acts .now-btn.go', { hasText: 'Begin' }).count(), 0, 'no Begin gate');
    assert.match(await p.locator('.np-foot').innerText(), /Not now/);
    assert.match(await p.locator('.np-foot').innerText(), /1 more today/);
  });

  await check('Write a note puts a line under it, and it shows on the page', async () => {
    await p.fill('.np-notein', 'Start on the rooftop');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => /Start on the rooftop/.test(document.querySelector('.np-notes .pl-kids')?.textContent || ''));
    await blur(p);
  });

  await check('Not now: later today, enough for today, or any day this week (3)', async () => {
    await p.keyboard.press('n');
    await p.waitForSelector('.now-choice');
    assert.deepEqual((await p.locator('.now-choice .nc-l').allInnerTexts()), ['Later today', 'Enough for today', 'Any day this week']);
    await p.keyboard.press('Escape');
    await p.waitForSelector('.now-choice', { state: 'detached' });
  });

  await check('a line from another week only opens: nothing moves, the Now dot is hollow, Back to and Bring to today', async () => {
    const before = await task(p, 'Color pass');
    assert.ok(before.span || before.day, 'planned for later');
    await p.evaluate((id) => window.__plan.openLine(id), before.id);
    await p.waitForFunction(() => history.state?.line);
    await at(p, 'now');
    assert.equal(await heading(p), 'Color pass on the trailer');
    assert.equal(await p.locator('.zm-stop.home.away').count(), 1, 'hollow dot');
    const foot = await p.locator('.np-foot').innerText();
    assert.match(foot, /Bring to today/);
    assert.match(foot, /Back to: Rewrite the cold open/);
    assert.deepEqual(await task(p, 'Color pass'), before, 'it stays where it was');
  });

  await check('4 goes back to the one thing', async () => {
    await blur(p);
    await p.keyboard.press('4');
    await p.waitForFunction(() => !history.state?.line && document.querySelector('.np-tx')?.textContent === 'Rewrite the cold open');
    assert.equal(await p.locator('.zm-stop.home.away').count(), 0);
  });

  await check('Bring to today (B): on today, after the one thing, and he is on it', async () => {
    const id = (await task(p, 'Color pass')).id;
    await p.evaluate((x) => window.__plan.openLine(x), id);
    await p.waitForFunction(() => history.state?.line);
    await blur(p);
    await p.keyboard.press('b');
    await p.waitForFunction(() => !history.state?.line && document.querySelector('.np-tx')?.textContent === 'Color pass on the trailer');
    assert.equal((await task(p, 'Color pass')).day, await p.evaluate(() => window.__plan.today));
  });

  await check('a line on today, opened from Today, becomes the one thing', async () => {
    await p.keyboard.press('3');
    await at(p, 'today');
    await p.locator('.pl-words', { hasText: 'Board scene 3' }).first().click();
    await p.waitForFunction(() => history.state?.tab === 'now' && !history.state?.line && document.querySelector('.np-tx')?.textContent === 'Board scene 3', null, { timeout: 8000 });
  });

  await check('a step added inside a piece shows the piece under its heading; Enter is in its text, at the end', async () => {
    const t = await task(p, 'Polish the ending');
    assert.ok(t?.for, 'tied to the piece it was added in');
    await p.evaluate((x) => window.__plan.openLine(x), t.id);
    await p.waitForSelector('.np-door');
    await p.waitForFunction(() => document.querySelector('.np-door-h b')?.textContent !== '…');
    await blur(p);
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.documentElement.dataset.view !== 'plan', null, { timeout: 8000 });
    await p.waitForFunction(() => document.activeElement?.isContentEditable, null, { timeout: 4000 });
    await sleep(400); // the editor settles its cursor a frame or two later
  });

  await check('Alt + J opens the thought box anywhere; Enter files it and it closes', async () => {
    await p.keyboard.press('Escape');
    await p.keyboard.press('Alt+KeyJ');
    await p.waitForSelector('.zm-thought:not([hidden]) input');
    await p.keyboard.type('Call about the grade');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.zm-thought', { state: 'hidden' });
    await p.waitForFunction(() => /On today’s page/.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 5000 });
  });
  await ctx.close();

  // ---------- the phone ----------
  const pctx = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' });
  const ph = await open(pctx);
  await ph.keyboard.press('Control+K');
  await sleep(200);
  await ph.keyboard.type('Rewrite the cold open');
  await sleep(350);
  await ph.keyboard.press('Enter');
  await sleep(500);
  await check('phone: Now is the same page, and Not now fits without sideways scroll', async () => {
    await ph.locator('.zm-stop[data-stop="now"]').tap();
    await at(ph, 'now');
    await ph.waitForSelector('.np-tx');
    await ph.locator('[data-now="notnow"]').tap();
    await ph.waitForSelector('.now-choice');
    assert.ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
    assert.equal(await ph.locator('.zm-ruler').isVisible(), true);
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
