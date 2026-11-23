// The Aa panel's Show tab, and what an older device's switches become.
// (The phone bar and Focus went with the old layout, Nov 17 2026.)
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { SHOWS, REMOVED } from '../src/shows.js';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4294;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const browser = withoutSync(await chromium.launch());
const errors = [];
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 6).join('\n     ')}`); }
}
try {
  const H = 915;
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 412, height: H }, hasTouch: true, isMobile: true, quietDrafts: true, todayPage: false, training: true, firstlight: true });
  await ctx.addInitScript((h) => {
    const vv = new EventTarget();
    Object.assign(vv, { width: 412, height: h, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: vv });
    window.__kb = (up) => { vv.height = up ? h - 320 : h; vv.dispatchEvent(new Event('resize')); };
    // An older device: switches that have since gone, and some still here.
    if (!localStorage.getItem('hide')) localStorage.setItem('hide', JSON.stringify(['dots', 'handle', 'synopsis', 'plan', 'took', 'loose', 'calendar', 'claude']));
  }, H);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(URL);
  await p.waitForSelector('#editor .ProseMirror');
  await sleep(800);
  const run = async (label) => {
    // A box that just closed hands the caret back on the next frame; let it.
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await p.keyboard.press('Control+K');
    await p.waitForFunction(() => document.activeElement?.id === 'palette-input');
    await p.locator('#palette-input').fill(label);
    const item = p.locator('#palette-list li', { hasText: label }).first();
    await item.waitFor();
    await item.click();
  };

  await check('an older device keeps what it chose, and the switches that went are simply on (bullets stay off)', async () => {
    const hide = await p.evaluate(() => JSON.parse(localStorage.getItem('hide')));
    for (const gone of ['dots', 'handle', 'synopsis', 'plan', 'took', 'loose', 'calendar']) assert.ok(!hide.includes(gone), `${gone} is on again`);
    assert.ok(hide.includes('claude'), 'a kept switch stays off');
    assert.ok(hide.includes('bullets'), 'bullets stay off');
  });

  await check('the Aa panel: Look, Text, Show and Add-ons; Show is one short list of eight, no groups', async () => {
    await run('Look, page and text settings');
    await p.waitForSelector('.page-settings:not([hidden])');
    assert.deepEqual(await p.locator('.ps-tab').allInnerTexts(), ['Look', 'Text', 'Show', 'Add-ons']);
    await p.locator('.ps-tab[data-pane="show"]').tap();
    assert.equal(await p.locator('.ps-show .ps-group').count(), 0, 'no folding groups');
    assert.equal(SHOWS.length, 8);
    const text = await p.locator('.ps-show').innerText();
    for (const s of SHOWS) assert.ok(text.includes(s.label), s.label);
    // A switch and its command are the same thing.
    await p.locator('.ps-show .switch:has([data-show="claude"]) input').tap();
    assert.ok(!(await p.evaluate(() => document.documentElement.classList.contains('hide-claude'))));
    await p.locator('#page-done').tap();
  });

  await check('removed switches have no command left; every kept one has one', async () => {
    const list = await p.evaluate(() => window.__commandList().map((c) => c.label));
    for (const gone of ['Show or hide note dots', 'Show or hide the six-dot handle', 'Show or hide bullets on notebook lines', 'Show or hide mode chips on voice captures', 'Show or hide section summaries']) assert.ok(!list.includes(gone), gone);
    for (const s of SHOWS.filter((x) => x.cmd)) assert.ok(s.choice ? s.choice.every(([, l]) => list.includes(`${s.cmd}: ${l}`)) : list.includes(s.cmd), s.cmd);
    // The page's own list of what went matches shows.js (index.html cleans old devices with it).
    const html = (await import('node:fs')).readFileSync('index.html', 'utf8');
    const inline = [...html.matchAll(/const gone\d* = (\[[^\]]*\])/g)].flatMap((m) => JSON.parse(m[1].replace(/'/g, '"')));
    for (const id of REMOVED) assert.ok(inline.includes(id), `index.html cleans ${id}`);
    for (const s of SHOWS) assert.ok(!inline.includes(s.id), `${s.id} is still a switch, so not cleaned`);
  });
  await ctx.close();
} finally {
  if (errors.length) { failed += 1; console.log(`FAIL page errors\n     ${errors.join('\n     ')}`); }
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
