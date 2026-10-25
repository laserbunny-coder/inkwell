// Getting around: the place you're in is always named, Back names where it
// goes, and Ctrl + O (or a tap on the place, on a phone) opens the Go panel:
// the last few places, the path up, this piece's pages and the desk.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4201;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const browser = await chromium.launch();
const errors = [];

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const viewOf = (p) => p.evaluate(() => document.documentElement.dataset.view || 'write');
const toToday = async (p) => {
  await p.keyboard.press('Control+J');
  await sleep(300);
  if (!(await p.locator('.notebook').isVisible())) await p.keyboard.press('Control+J');
  await p.waitForSelector('.notebook', { state: 'visible' });
  await sleep(300);
};

try {
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(URL);
  await p.waitForSelector('#editor .ProseMirror');
  await sleep(500);

  await check('on a computer the place line names where you are, and Back names the last place', async () => {
    await toToday(p);
    assert.match(await p.locator('.placeline .pl-path').innerText(), /Today/);
    await p.keyboard.press('Control+Shift+O');
    await p.waitForFunction(() => document.documentElement.dataset.view === 'library');
    await sleep(300);
    assert.equal(await p.locator('.placeline .pl-back').innerText(), '‹ Today');
    assert.equal(await p.locator('.placebar').isVisible(), false, 'no phone bar on a computer');
  });

  await check('Ctrl + O then Enter flips straight back', async () => {
    await p.keyboard.press('Control+O');
    await p.waitForSelector('.go-panel', { state: 'visible' });
    assert.equal(await p.evaluate(() => document.activeElement?.className), 'go-find');
    assert.equal(await p.locator('.go-chip.first .go-name').innerText(), 'Today');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.notebook', { state: 'visible' });
    assert.equal(await p.locator('.go-panel').isVisible(), false);
    assert.equal(await p.locator('.placeline .pl-back').innerText(), '‹ Library');
  });

  await check('the Go panel’s desk reaches Today, the Drawer, the Library and Tags', async () => {
    await p.keyboard.press('Control+O');
    await p.waitForSelector('.go-panel', { state: 'visible' });
    assert.deepEqual(await p.locator('.go-desk .go-tab-name').allInnerTexts(), ['Today', 'Drawer', 'Library', 'Tags']);
    await p.locator('.go-desk .go-tab', { hasText: 'Tags' }).click();
    await p.waitForFunction(() => document.documentElement.dataset.view === 'tags');
    await p.keyboard.press('Control+O');
    await p.waitForSelector('.go-panel', { state: 'visible' });
    await p.locator('.go-desk .go-tab', { hasText: 'Drawer' }).click();
    await p.waitForFunction(() => document.documentElement.dataset.view === 'drawer');
  });

  await check('typing in the Go panel finds anything', async () => {
    await p.keyboard.press('Control+O');
    await p.waitForSelector('.go-panel', { state: 'visible' });
    await p.keyboard.type('Library');
    await p.waitForSelector('.palette', { state: 'visible' });
    assert.equal(await p.locator('#palette-input').inputValue(), 'Library');
    assert.equal(await p.locator('.go-panel').isVisible(), false);
    await p.keyboard.press('Escape');
  });

  await check('Escape closes the Go panel, and the corner keeps its labels', async () => {
    await p.keyboard.press('Control+O');
    await p.waitForSelector('.go-panel', { state: 'visible' });
    await p.keyboard.press('Escape');
    await p.waitForSelector('.go-panel', { state: 'hidden' });
    await p.locator('#go-toggle').click({ force: true });
    await p.waitForSelector('.go-panel', { state: 'visible' });
    await p.keyboard.press('Escape');
    await toToday(p);
    assert.equal(await p.locator('#view-toggle').innerText(), 'Today');
  });
  await ctx.close();

  const phone = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const ph = await phone.newPage();
  ph.on('pageerror', (e) => errors.push(e.message));
  await ph.goto(URL);
  await ph.waitForSelector('#editor .ProseMirror');
  await sleep(500);

  await check('on a phone a bar along the bottom names the place, with Today, the mic and Menu', async () => {
    await ph.evaluate(() => document.activeElement?.blur());
    await ph.locator('.pb-today').tap();
    await ph.waitForSelector('.notebook', { state: 'visible' });
    await ph.evaluate(() => document.activeElement?.blur());
    await sleep(300);
    assert.equal(await ph.locator('.placebar').isVisible(), true);
    assert.match(await ph.locator('.pb-place .pb-name').innerText(), /^Today/);
    assert.equal(await ph.locator('.corner').isVisible(), false, 'the corner buttons are gone on a phone');
    assert.equal(await ph.locator('.pb-menu').getAttribute('aria-label'), 'Menu');
  });

  await check('on a phone the Go sheet opens from the place, and Back returns', async () => {
    await ph.locator('.pb-place').tap();
    await ph.waitForSelector('.go-panel', { state: 'visible' });
    assert.equal(await ph.locator('.placebar').isVisible(), false, 'the bar steps aside for the sheet');
    assert.notEqual(await ph.evaluate(() => document.activeElement?.className), 'go-find', 'no keyboard over the sheet');
    await ph.locator('.go-desk .go-tab', { hasText: 'Library' }).tap();
    await ph.waitForFunction(() => document.documentElement.dataset.view === 'library');
    await sleep(300);
    assert.equal(await ph.locator('.pb-back').innerText(), '‹ Today');
    await ph.locator('.pb-back').tap();
    await ph.waitForSelector('.notebook', { state: 'visible' });
    assert.equal(await viewOf(ph), 'notebook');
    const wide = await ph.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(wide <= 0, `page is ${wide}px too wide`);
  });

  await check('in focus the phone bar shrinks to a handle that brings it back', async () => {
    await ph.evaluate(() => document.activeElement?.blur());
    await ph.evaluate(() => document.documentElement.classList.add('focus'));
    await sleep(200);
    assert.equal(await ph.locator('.placebar').isVisible(), false);
    await ph.locator('.pb-handle').tap();
    await ph.waitForSelector('.placebar', { state: 'visible' });
    await ph.evaluate(() => document.documentElement.classList.remove('focus'));
  });
  await phone.close();

  await check('no page errors', async () => { assert.deepEqual(errors, []); });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `${failed} failed` : 'nav: all passed');
process.exit(failed ? 1 : 0);
