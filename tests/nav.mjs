// Getting around: the place you're in is always named, Back names where it
// goes, and Ctrl + O (or a tap on the place, on a phone) opens the Go panel:
// the last few places, the path up, this piece's pages and the desk.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4201;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const browser = withoutSync(await chromium.launch());
const errors = [];

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const viewOf = (p) => p.evaluate(() => document.documentElement.dataset.view || 'write');
// The page puts the caret back in the text a moment after you arrive, which brings up the
// keyboard (and its own bar) on a phone; put the keyboard away, as a person would.
const settle = async (p) => {
  await sleep(1000);
  await p.waitForFunction(() => { document.activeElement?.blur(); return !document.body.classList.contains('kb-up') && !document.querySelector('.outline-bar')?.offsetParent && !document.querySelector('.script-bar')?.offsetParent; });
  await sleep(200);
};
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

  await check('on a computer the top bar names where you are, and its Back button names the last place', async () => {
    await toToday(p);
    assert.match(await p.locator('#crumb').innerText(), /Daily pages/);
    await p.keyboard.press('Control+Shift+O');
    await p.waitForFunction(() => document.documentElement.dataset.view === 'library');
    await sleep(300);
    await p.waitForFunction(() => document.querySelector('#tb-back')?.textContent === '‹ Today');
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
    await p.waitForFunction(() => document.querySelector('#tb-back')?.textContent === '‹ Library');
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

  await check('Escape closes the Go panel; the rail holds the rooms and the tools, and the bar above the page stays put', async () => {
    await p.keyboard.press('Control+O');
    await p.waitForSelector('.go-panel', { state: 'visible' });
    await p.keyboard.press('Escape');
    await p.waitForSelector('.go-panel', { state: 'hidden' });
    await toToday(p);
    assert.equal(await p.locator('.corner').count(), 0, 'no corner strip');
    assert.equal(await p.locator('.placeline').count(), 0, 'no place line');
    // The rail is always there: rooms on top, the tools at the foot.
    await p.mouse.move(640, 400);
    await sleep(300);
    assert.equal(await p.locator('.rail').isVisible(), true);
    assert.deepEqual(await p.locator('.rail-rooms button').allInnerTexts(), ['Today', 'Library']);
    assert.deepEqual(await p.locator('.rail-tools button').allInnerTexts(), ['Capture', 'Go', 'Everything', 'Look']);
    // The bar doesn't hide and come down any more: where you are is always in view.
    const bar = await p.locator('.topbar').evaluate((el) => ({ top: Math.round(el.getBoundingClientRect().top), opacity: getComputedStyle(el).opacity }));
    assert.deepEqual(bar, { top: 0, opacity: '1' });
    assert.equal(await p.locator('#crumb').isVisible(), true);
    // The page starts to the right of the rail, never under it.
    const edges = await p.evaluate(() => ({ rail: document.querySelector('.rail').getBoundingClientRect().right, page: document.querySelector('.notebook').getBoundingClientRect().left }));
    assert.ok(edges.page >= edges.rail, `page ${edges.page} starts under the rail ${edges.rail}`);
    await p.locator('#go-toggle').click();
    await p.waitForSelector('.go-panel', { state: 'visible' });
    await p.keyboard.press('Escape');
    await p.waitForSelector('.go-panel', { state: 'hidden' });
  });

  await check('the rail’s words stay in the same places everywhere, and the room you’re in is lit', async () => {
    const tools = () => p.locator('.rail button').evaluateAll((els) => els.filter((e) => e.offsetParent && !e.closest('.rail-projects')).map((e) => `${e.textContent}@${Math.round(e.getBoundingClientRect().y)}${e.getAttribute('aria-current') ? '*' : ''}`));
    // The pill behind the lit word has slid onto it.
    const pillOn = (sel) => p.waitForFunction((q) => { const a = document.querySelector('.rail-pill')?.getBoundingClientRect(); const b = document.querySelector(q)?.getBoundingClientRect(); return a && b && a.height > 0 && Math.abs(a.top - b.top) < 2; }, sel);
    await toToday(p);
    await sleep(300);
    const onToday = await tools();
    assert.ok(onToday.some((t) => t.startsWith('Today@') && t.endsWith('*')), onToday.join(' '));
    await pillOn('#view-toggle');
    await p.keyboard.press('Control+Shift+O');
    await p.waitForFunction(() => document.documentElement.dataset.view === 'library');
    await sleep(300);
    const onLibrary = await tools();
    assert.ok(onLibrary.some((t) => t.startsWith('Library@') && t.endsWith('*')), onLibrary.join(' '));
    assert.deepEqual(onLibrary.map((t) => t.replace('*', '')), onToday.map((t) => t.replace('*', '')), 'nothing moved');
    await pillOn('#library-toggle');
    // Inside the Library, the switch at the top centre has its three views; the Library stays lit in the rail.
    assert.deepEqual(await p.locator('.place-switch button').allInnerTexts(), ['Shelves', 'Drawer', 'Tags']);
    assert.equal(await p.locator('#shelves-toggle').getAttribute('aria-current'), 'page');
    await p.locator('#tags-toggle').click();
    await p.waitForFunction(() => document.documentElement.dataset.view === 'tags');
    await sleep(300);
    assert.equal(await p.locator('#tags-toggle').getAttribute('aria-current'), 'page');
    assert.equal(await p.locator('#library-toggle').getAttribute('aria-current'), 'page');
    await toToday(p);
    await sleep(300);
    assert.equal(await p.locator('.place-switch').isVisible(), false, 'no switch on Today yet');
  });

  await check('the five looks: one tap changes the whole app, and it sticks after a reload', async () => {
    const bg = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(await p.evaluate(() => document.documentElement.dataset.look), 'midnight');
    assert.equal(await bg(), 'rgb(14, 17, 23)');
    await p.locator('.rail-tools [data-cmd=page]').click();
    assert.deepEqual(await p.locator('.look-opt .look-name').allInnerTexts(), ['Midnight Ink', 'Lamplight', 'Graphite', 'Typewriter', 'Paper']);
    await p.locator('.look-opt', { hasText: 'Paper' }).click();
    assert.equal(await p.evaluate(() => document.documentElement.dataset.look), 'paper');
    assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'light');
    assert.notEqual(await bg(), 'rgb(14, 17, 23)');
    await p.locator('.look-opt', { hasText: 'Lamplight' }).click();
    assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await p.locator('#page-done').click();
    await p.reload();
    await p.waitForSelector('.rail-tools [data-cmd=page]');
    await sleep(500);
    assert.equal(await p.evaluate(() => document.documentElement.dataset.look), 'lamplight');
    // Motion: Full, Fades only, Off.
    await p.locator('.rail-tools [data-cmd=page]').click();
    assert.deepEqual(await p.locator('.motion-opt').allInnerTexts(), ['Full', 'Fades only', 'Off']);
    await p.locator('.motion-opt', { hasText: 'Off' }).click();
    assert.equal(await p.evaluate(() => document.documentElement.dataset.motion), 'off');
    await p.locator('.motion-opt', { hasText: 'Full' }).click();
    assert.equal(await p.evaluate(() => document.documentElement.dataset.motion), 'full');
    await p.locator('.look-opt', { hasText: 'Midnight Ink' }).click();
    await p.locator('#page-done').click();
    assert.equal(await p.evaluate(() => document.documentElement.dataset.look), 'midnight');
  });

  await check('Alt + Left goes back without flashing the tab numbers; holding Alt alone shows them', async () => {
    await p.keyboard.down('Alt');
    await p.keyboard.press('ArrowLeft');
    await sleep(600);
    assert.equal(await p.evaluate(() => document.body.classList.contains('alt-held')), false);
    await p.keyboard.up('Alt');
    await p.keyboard.down('Alt');
    await sleep(600);
    assert.equal(await p.evaluate(() => document.body.classList.contains('alt-held')), true);
    await p.keyboard.up('Alt');
    assert.equal(await p.evaluate(() => document.body.classList.contains('alt-held')), false);
  });
  await ctx.close();

  const phone = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const ph = await phone.newPage();
  ph.on('pageerror', (e) => errors.push(e.message));
  await ph.goto(URL);
  await ph.waitForSelector('#editor .ProseMirror');
  await sleep(500);

  await check('on a phone a bar along the bottom has Today, Library, the mic, Go and More, and lights the room you are in', async () => {
    await settle(ph);
    await ph.locator('.pb-today').tap();
    await ph.waitForSelector('.notebook', { state: 'visible' });
    await settle(ph);
    assert.equal(await ph.locator('.placebar').isVisible(), true);
    assert.deepEqual(await ph.locator('.placebar .pb-word').allInnerTexts(), ['Today', 'Library', 'Go', 'More']);
    assert.match(await ph.locator('.pb-place').getAttribute('aria-label'), /^Today/, 'Go still says where you are');
    assert.equal(await ph.locator('.pb-today').getAttribute('aria-current'), 'page');
    assert.equal(await ph.locator('.pb-lib').getAttribute('aria-current'), null);
    assert.equal(await ph.locator('#mic-toggle').isVisible(), false, 'the computer’s tools stay off the phone');
    assert.equal(await ph.locator('.pb-menu').getAttribute('aria-label'), 'Menu');
  });

  await check('on a phone the Go sheet opens from the place, and Back returns', async () => {
    await ph.locator('.pb-place').tap();
    await ph.waitForSelector('.go-panel', { state: 'visible' });
    assert.equal(await ph.locator('.placebar').isVisible(), false, 'the bar steps aside for the sheet');
    assert.notEqual(await ph.evaluate(() => document.activeElement?.className), 'go-find', 'no keyboard over the sheet');
    await ph.locator('.go-desk .go-tab', { hasText: 'Library' }).tap();
    await ph.waitForFunction(() => document.documentElement.dataset.view === 'library');
    await settle(ph);
    assert.equal(await ph.locator('.pb-lib').getAttribute('aria-current'), 'page', 'Library is lit');
    // Back is the first thing in the Go sheet.
    await ph.locator('.pb-place').tap();
    await ph.waitForSelector('.go-panel', { state: 'visible' });
    assert.match(await ph.locator('.go-chip.first .go-name').innerText(), /^Today/);
    await ph.locator('.go-chip.first').tap();
    await ph.waitForSelector('.notebook', { state: 'visible' });
    assert.equal(await viewOf(ph), 'notebook');
    const wide = await ph.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(wide <= 0, `page is ${wide}px too wide`);
  });

  await check('on a phone each thing has one place: no path, Menu or Aa at the top, and no top strip on the desk', async () => {
    await settle(ph);
    await ph.locator('.pb-lib').tap();
    await ph.waitForFunction(() => document.documentElement.dataset.view === 'library');
    await settle(ph);
    for (const sel of ['#crumb', '#palette-toggle', '[data-cmd="page"]', '#page-tabs']) assert.equal(await ph.locator(`.topbar ${sel}`).isVisible(), false, `${sel} shows at the top`);
    // Sync that's fine stays quiet; sync that needs you brings the strip back.
    const syncAs = (state) => ph.evaluate((st) => { const el = document.querySelector('#sync'); el.hidden = false; el.dataset.state = st; delete el.dataset.stale; el.textContent = st; }, state);
    await syncAs('synced');
    assert.equal(await ph.locator('.topbar').isVisible(), false, 'the desk has no top strip on a phone');
    await syncAs('signed-out');
    assert.equal(await ph.locator('.topbar #sync').isVisible(), true, 'signed out shows at the top');
    await syncAs('synced');
    await ph.locator('.pb-today').tap();
    await ph.waitForSelector('.notebook', { state: 'visible' });
  });

  await check('in focus the phone bar shrinks to a handle that brings it back', async () => {
    // The keyboard's own bar (and the outline buttons) sit there while typing, so put the keyboard away first.
    await settle(ph);
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
