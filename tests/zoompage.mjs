// Today and Now as one (Nov 25 2026): Now is the zoom into a task on today,
// with the strip at the foot. Before that (Nov 2026), Now was a page: The one thing as its own page
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

  const strip = (p) => p.locator('.nz-strip:not([hidden])');
  const zoomedOn = async (p, re) => {
    await p.waitForFunction((src) => {
      const st = history.state;
      const t = document.querySelector('.zoom-root, .notebook [data-zoom-root]');
      return st?.view === 'notebook' && st?.zoom && new RegExp(src).test(window.__plan.items.find((i) => i.row.id === st.zoom)?.row.text || '');
    }, re, { timeout: 8000 });
    await sleep(300);
  };

  await check('Bible reading is the first line of the day, and Now opens on it as its own page', async () => {
    await p.keyboard.press('Alt+Backquote');
    await at(p, 'today');
    await p.waitForSelector('.np-tx');
    assert.equal(await heading(p), 'Bible reading');
    assert.match(await p.locator('.np-crumb').innerText(), /Every day/);
    assert.ok(await p.locator('.np-kind .now-reading li').count() >= 4, 'the reading list under it');
    assert.ok(await task(p, '^Bible reading$'), 'a line of the day');
  });

  await check('read: Bible reading is done, and Now is the zoom into the next task, with the strip at the foot', async () => {
    await p.keyboard.press('i');
    await zoomedOn(p, '^Rewrite the cold open');
    assert.equal((await task(p, '^Bible reading$')).done, true);
    await strip(p).waitFor();
    const s = await strip(p).innerText();
    assert.match(s, /Today/);
    assert.match(s, /Not now/);
    assert.match(s, /\d of \d/);
    assert.match(s, /Next/);
    assert.equal(await p.evaluate(() => document.querySelector('.zm-stop[aria-current]')?.dataset.stop), 'today');
    assert.equal(await p.locator('.zm-stop[data-stop="today"]').innerText(), 'Now');
  });

  await check('the title is the line itself: the cursor goes in, and [] makes a box under it', async () => {
    const title = p.locator('.notebook .ProseMirror [data-zoom-root], .notebook .ProseMirror .zoom-root').first();
    await title.click();
    await p.keyboard.press('End');
    await p.keyboard.press('Enter');
    await p.keyboard.type('[] Find the rooftop location');
    await sleep(600);
    assert.ok(await p.evaluate(() => /Find the rooftop location/.test(document.querySelector('.notebook')?.textContent || '')));
    assert.ok(await p.locator('#outline-editor [role="checkbox"]').count() >= 1, 'a box');
    await blur(p);
  });

  await check('Alt + Down is the next task on today, Alt + Up the one before', async () => {
    await blur(p);
    await p.keyboard.press('Alt+ArrowDown');
    await zoomedOn(p, '^Board scene 3');
    await p.keyboard.press('Alt+ArrowUp');
    await zoomedOn(p, '^Rewrite the cold open');
  });

  await check('Not now: later today, enough for today, or any day this week (3)', async () => {
    await strip(p).locator('[data-nz="notnow"]').click();
    await p.waitForSelector('.menu, [role="menu"]');
    const txt = await p.locator('.menu, [role="menu"]').first().innerText();
    for (const w of ['Later today', 'Enough for today', 'Any day this week']) assert.match(txt, new RegExp(w));
    await p.keyboard.press('Escape');
  });

  await check('Alt + Left from the task goes out to the day', async () => {
    await p.keyboard.press('Escape');
    await blur(p);
    await p.keyboard.press('Alt+ArrowLeft');
    await at(p, 'today');
    await p.waitForFunction(() => history.state?.view === 'plan');
    assert.equal(await strip(p).count(), 0);
  });

  await check('a line on today, opened from Today, is Now zoomed in', async () => {
    await p.locator('.pl-words', { hasText: 'Board scene 3' }).first().click();
    await zoomedOn(p, '^Board scene 3');
    await strip(p).waitFor();
  });

  await check('a line from another week opens zoomed in, with no Now strip, and nothing moves', async () => {
    const before = await task(p, 'Color pass');
    assert.ok(before.span || before.day, 'planned for later');
    await p.evaluate((id) => window.__plan.openLine(id), before.id);
    await zoomedOn(p, '^Color pass');
    await sleep(400);
    assert.equal(await strip(p).count(), 0);
    assert.deepEqual(await task(p, 'Color pass'), before, 'it stays where it was');
  });

  await check('Alt + J opens the thought box anywhere; Enter files it and it closes', async () => {
    await blur(p);
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
  await check('phone: tapping a task on Today is Now; the strip sits over the ruler and fits', async () => {
    await ph.locator('.zm-stop[data-stop="today"]').tap();
    await at(ph, 'today');
    await ph.locator('.pl-words', { hasText: 'Rewrite the cold open' }).first().tap();
    await zoomedOn(ph, '^Rewrite the cold open');
    await strip(ph).waitFor();
    assert.ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
    assert.equal(await ph.locator('.zm-ruler').isVisible(), true);
    const s = await strip(ph).boundingBox();
    const r = await ph.locator('.zm-ruler').boundingBox();
    assert.ok(s.y + s.height <= r.y + 1, 'the strip sits above the ruler');
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
