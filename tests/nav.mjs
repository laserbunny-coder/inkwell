// Getting around: the place you're in is always named, Back names where it
// goes, and Ctrl + O (or a tap on the place, on a phone) opens the Go panel:
// the last few places, the path up, this piece's pages and the desk.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4201;
const server = await serve(PORT);
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
// The Aa panel: the Aa button beside ⋯ (Look left the ⋯ menu Nov 20 2026).
const look = async (p) => {
  await p.locator('.zm-aa').click();
  await p.waitForSelector('.page-settings', { state: 'visible' });
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
    await p.waitForSelector('.palette.box', { state: 'visible' });
    assert.equal(await p.evaluate(() => document.activeElement?.id), 'palette-input');
    assert.equal(await p.locator('.box-recent .box-chip.first .go-name').innerText(), 'Today');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.notebook', { state: 'visible' });
    assert.equal(await p.locator('.palette').isVisible(), false);
    await p.waitForFunction(() => document.querySelector('#tb-back')?.textContent === '‹ Library');
  });

  await check('typing in the box finds anything', async () => {
    await p.keyboard.press('Control+O');
    await p.waitForSelector('.palette.box', { state: 'visible' });
    await p.keyboard.type('Library');
    await sleep(200);
    assert.equal(await p.locator('#palette-input').inputValue(), 'Library');
    assert.match(await p.locator('#palette-list li').first().innerText(), /^Library/);
    await p.keyboard.press('Escape');
  });

  await check('Escape closes the box; one ruler along the bottom names the stops, and the room you’re in is lit', async () => {
    await p.keyboard.press('Control+O');
    await p.waitForSelector('.palette.box', { state: 'visible' });
    await p.keyboard.press('Escape');
    await p.waitForSelector('.palette', { state: 'hidden' });
    await toToday(p);
    assert.equal(await p.locator('.rail').isVisible(), false, 'no rail any more');
    assert.deepEqual(await p.locator('.zm-ruler .zm-stop .zm-word').allInnerTexts(), ['Year', 'Month', 'Week', 'Today', 'Project', 'Desk', 'Library']);
    const r = await p.locator('.zm-ruler').boundingBox();
    assert.ok(r.y + r.height >= 800 - 2, 'the ruler sits at the bottom');
    await p.locator('.zm-ruler [data-stop="library"]').click();
    await p.waitForFunction(() => document.documentElement.dataset.view === 'library');
    await p.waitForFunction(() => document.querySelector('.zm-ruler [data-stop="library"]')?.getAttribute('aria-current') === 'page');
    await p.locator('.zm-go').click();
    await p.waitForSelector('.palette.box', { state: 'visible' });
    await p.keyboard.press('Escape');
    await p.waitForSelector('.palette', { state: 'hidden' });
  });

  await check('the looks: one tap changes the whole app, and it sticks after a reload', async () => {
    const bg = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(await p.evaluate(() => document.documentElement.dataset.look), 'midnight');
    assert.equal(await bg(), 'rgb(14, 17, 23)');
    await look(p);
    assert.deepEqual(await p.locator('.look-opt .look-name').allInnerTexts(), ['Midnight Ink', 'Lamplight', 'Ember', 'Candle', 'Night shift', 'Graphite', 'Typewriter', 'Paper']);
    await p.locator('.look-opt', { hasText: 'Paper' }).click();
    assert.equal(await p.evaluate(() => document.documentElement.dataset.look), 'paper');
    assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'light');
    assert.notEqual(await bg(), 'rgb(14, 17, 23)');
    // The warm night looks: soft words on near-black, still easy to read.
    for (const [name, look, ground] of [['Ember', 'ember', 'rgb(19, 17, 15)'], ['Candle', 'candle', 'rgb(26, 22, 17)'], ['Night shift', 'night', 'rgb(17, 12, 7)']]) {
      await p.locator('.look-opt', { hasText: name }).click();
      assert.equal(await p.evaluate(() => document.documentElement.dataset.look), look);
      assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
      assert.equal(await bg(), ground);
    }
    await p.locator('.look-opt', { hasText: 'Lamplight' }).click();
    assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await p.locator('#page-done').click();
    await p.reload();
    await p.waitForSelector('.zm-more');
    await sleep(500);
    assert.equal(await p.evaluate(() => document.documentElement.dataset.look), 'lamplight');
    // Motion: Full, Fades only, Off.
    await look(p);
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

  await check('on a phone the same ruler runs along the bottom, with Go; a stop lights where you are', async () => {
    await settle(ph);
    assert.equal(await ph.locator('.zm-ruler').isVisible(), true);
    assert.deepEqual(await ph.locator('.zm-ruler .zm-stop .zm-word').allInnerTexts(), ['Year', 'Month', 'Week', 'Today', 'Project', 'Desk', 'Library']);
    await ph.locator('.zm-ruler [data-stop="library"]').tap();
    await ph.waitForFunction(() => document.documentElement.dataset.view === 'library');
    await ph.waitForFunction(() => document.querySelector('.zm-ruler [data-stop="library"]')?.getAttribute('aria-current') === 'page');
    const wide = await ph.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(wide <= 0, `page is ${wide}px too wide`);
  });

  await check('on a phone Go opens the box, and the box finds the look by name', async () => {
    for (const word of ['theme', 'look', 'candle', 'night shift']) {
      await settle(ph);
      await ph.locator('.zm-go').tap();
      await ph.waitForSelector('.palette.box', { state: 'visible' });
      await ph.fill('#palette-input', word);
      await sleep(150);
      assert.match(await ph.locator('#palette-list').innerText(), /Look, page and text settings/, `"${word}" finds the look`);
      await ph.keyboard.press('Escape');
      await ph.waitForSelector('.palette', { state: 'hidden' });
    }
  });
  await phone.close();

  await check('no page errors', async () => { assert.deepEqual(errors, []); });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `${failed} failed` : 'nav: all passed');
process.exit(failed ? 1 : 0);
