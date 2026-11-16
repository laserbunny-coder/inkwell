// The bottom of the phone, Focus within reach, and the Aa panel's Show tab
// (Nov 14 2026, "Make the bottom menu easy to reach").
//
// The phone's bottom holds one thing: the writing row while the keyboard is
// really up, else the bar, or in Focus and in a draft a tab that brings the
// bar up. A test can't open Android's keyboard, so the page's visible height
// is faked (as tests/caret.mjs does): window.__kb(true) shrinks it the way the
// keyboard does, __kb(false) gives it back the way Android's back gesture does.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { SHOWS, REMOVED } from '../src/shows.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4294;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const browser = withoutSync(await chromium.launch());
const errors = [];
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 6).join('\n     ')}`); }
}
// What's at the bottom right now.
const seen = (p) => p.evaluate(() => {
  const v = (q) => { const e = document.querySelector(q); return !!e && e.checkVisibility() && e.getBoundingClientRect().height > 0; };
  return { bar: v('.placebar'), row: v('.script-bar:not(.outline-bar)') || v('.outline-bar'), tab: v('.pb-tab'), chip: v('.pb-focus') };
});
const bottomIs = async (p, want, why) => {
  let got;
  for (let i = 0; i < 20; i++) { got = await seen(p); if (Object.entries(want).every(([k, v]) => got[k] === v)) return; await sleep(100); }
  assert.deepEqual(Object.fromEntries(Object.keys(want).map((k) => [k, got[k]])), want, why);
};

try {
  const H = 915;
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 412, height: H }, hasTouch: true, isMobile: true, quietDrafts: true, todayPage: false, training: true, firstlight: true });
  await ctx.addInitScript((h) => {
    const vv = new EventTarget();
    Object.assign(vv, { width: 412, height: h, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: vv });
    window.__kb = (up) => { vv.height = up ? h - 320 : h; vv.dispatchEvent(new Event('resize')); };
    // An older device: switches that have since gone, and some still here.
    if (!localStorage.getItem('hide')) localStorage.setItem('hide', JSON.stringify(['dots', 'handle', 'synopsis', 'plan', 'took', 'loose']));
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
    for (const gone of ['dots', 'handle', 'synopsis', 'plan', 'took']) assert.ok(!hide.includes(gone), `${gone} is on again`);
    assert.ok(hide.includes('loose'), 'a kept switch stays off');
    assert.ok(hide.includes('bullets'), 'bullets stay off');
    // “Show the plan on Today” was off: the day still opens on its page.
    assert.equal(await p.evaluate(() => localStorage.getItem('todayPhone')), 'page');
  });

  await check('a script: the keyboard brings the row, Android back brings the tab, the tab brings the bar', async () => {
    await run('New screenplay');
    await p.waitForSelector('#lib-new', { state: 'visible' });
    await p.fill('#lib-new-title', 'Rent Day');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelector('#nb-title')?.textContent === 'Idea');
    await sleep(400);
    await p.keyboard.press('Control+O');
    await p.waitForFunction(() => document.activeElement?.id === 'palette-input');
    await p.keyboard.type('Script · Rent Day');
    await p.waitForFunction(() => document.querySelector('.palette[data-loaded]') && /^Script\s*chapter · Rent Day/.test(document.querySelector('#palette-list li.box-row')?.textContent || ''));
    await p.keyboard.press('Enter');
    await p.waitForSelector('html.script #editor p[data-el="scene"]');
    await sleep(500);
    // Arriving puts the caret in the text by itself; no keyboard, so no row.
    await bottomIs(p, { row: false, tab: true, bar: false }, 'a draft rests as the tab, even with the caret in it');
    await p.locator('#editor p[data-el="scene"]').tap();
    await p.evaluate(() => window.__kb(true));
    await bottomIs(p, { row: true, tab: false, bar: false }, 'keyboard up: the row');
    await p.keyboard.type('int. bakery - morning');
    await p.keyboard.press('Enter');
    await p.keyboard.type('A letter slaps down beside the till.');
    // Android back: the keyboard goes, the caret stays.
    await p.evaluate(() => window.__kb(false));
    await bottomIs(p, { row: false, tab: true, bar: false }, 'keyboard down: the tab');
    assert.ok(await p.evaluate(() => window.__editor.isFocused), 'the caret is still in the script');
    await p.locator('.pb-tab').tap();
    await bottomIs(p, { bar: true, tab: false }, 'the tab brings the bar');
    await p.locator('#editor p').last().tap();
    await p.evaluate(() => window.__kb(true));
    await bottomIs(p, { row: true, bar: false }, 'a tap on the text: the keyboard and row again');
  });

  await check('the row’s down arrow puts the keyboard away; its Focus button turns Focus on', async () => {
    await p.locator('.script-bar:not(.outline-bar) [data-end="down"]').tap();
    await p.evaluate(() => window.__kb(false));
    await bottomIs(p, { row: false, tab: true }, 'down arrow');
    await p.locator('#editor p').last().tap();
    await p.evaluate(() => window.__kb(true));
    await bottomIs(p, { row: true }, 'row back');
    await p.locator('.script-bar:not(.outline-bar) [data-end="focus"]').tap();
    await p.waitForFunction(() => document.documentElement.classList.contains('focus'));
    assert.equal(await p.locator('.script-bar:not(.outline-bar) [data-end="focus"]').getAttribute('aria-pressed'), 'true');
    await p.evaluate(() => window.__kb(false));
    await p.locator('.script-bar:not(.outline-bar) [data-end="down"]').tap().catch(() => {});
    await p.evaluate(() => document.activeElement?.blur());
  });

  await check('in Focus the bar comes up with a way out of Focus', async () => {
    await bottomIs(p, { tab: true, bar: false }, 'Focus: the tab');
    await p.locator('.pb-tab').tap();
    await bottomIs(p, { bar: true, chip: true }, 'bar and chip');
    await p.locator('.pb-leave').tap();
    await p.waitForFunction(() => !document.documentElement.classList.contains('focus'));
  });

  await check('Go: Focus first, beside Aa Look; Look is no longer a room', async () => {
    await p.locator('.pb-tab').tap();
    await p.locator('.placebar .pb-place').tap();
    await p.waitForSelector('.palette.box:not([hidden]) .box-quick');
    const first = await p.evaluate(() => [...document.querySelectorAll('#palette-list > li')][0]?.className);
    assert.match(first, /box-quick/, 'Focus and Look are the first row');
    assert.equal(await p.locator('.box-rooms .box-chip', { hasText: 'Look' }).count(), 0);
    await p.locator('.box-focus').tap();
    await p.waitForFunction(() => document.documentElement.classList.contains('focus'));
    assert.ok(await p.locator('.palette').isHidden(), 'the box closes');
    await p.keyboard.press('Control+.');
    await p.waitForFunction(() => !document.documentElement.classList.contains('focus'));
  });

  await check('every other room shows the bar, wherever the caret is', async () => {
    await p.locator('.pb-tab').tap();
    await p.locator('.placebar .pb-today').tap();
    await p.waitForSelector('.notebook', { state: 'visible' });
    await sleep(400);
    await bottomIs(p, { bar: true, tab: false }, 'Today');
    // Focus on the day's Plan still shows the plan (Nov 14: it went blank).
    await p.locator('.tp-switch button', { hasText: 'Plan' }).tap();
    await p.waitForFunction(() => document.querySelector('.notebook').dataset.tp === 'plan');
    await p.keyboard.press('Control+.');
    await p.waitForFunction(() => document.documentElement.classList.contains('focus'));
    assert.ok(await p.locator('#plan').isVisible(), 'the plan stays in Focus');
    await p.keyboard.press('Control+.');
    await p.locator('.tp-switch button', { hasText: 'Page' }).tap();
    await p.locator('.placebar .pb-desk').tap();
    await p.waitForFunction(() => document.documentElement.dataset.view === 'desk');
    await bottomIs(p, { bar: true, tab: false }, 'Desk');
    await p.locator('.placebar .pb-lib').tap();
    await p.waitForFunction(() => document.documentElement.dataset.view === 'library');
    await bottomIs(p, { bar: true, tab: false }, 'Library');
  });

  await check('Quiet drafts off: a draft shows the bar too', async () => {
    await run('Quiet drafts');
    await p.locator('#lib-shelves, .lib-head').first().waitFor().catch(() => {});
    await p.keyboard.press('Control+O');
    await p.waitForFunction(() => document.activeElement?.id === 'palette-input');
    await p.keyboard.type('Script · Rent Day');
    await p.waitForFunction(() => document.querySelector('.palette[data-loaded]') && /^Script\s*chapter · Rent Day/.test(document.querySelector('#palette-list li.box-row')?.textContent || ''));
    await p.keyboard.press('Enter');
    await p.waitForSelector('html.script #editor p[data-el="scene"]');
    await bottomIs(p, { bar: true, tab: false }, 'bar in the draft');
    await run('Quiet drafts');
    await bottomIs(p, { bar: false, tab: true }, 'back to the tab');
  });

  await check('the Aa panel: three tabs, and Show in five groups opening on where you are', async () => {
    await run('Look, page and text settings');
    await p.waitForSelector('.page-settings:not([hidden])');
    assert.deepEqual(await p.locator('.ps-tab').allInnerTexts(), ['Look', 'Text', 'Show']);
    await p.locator('.ps-tab[data-pane="show"]').tap();
    const groups = await p.evaluate(() => [...document.querySelectorAll('.ps-group')].map((g) => `${g.dataset.group}${g.classList.contains('open') ? '*' : ''}`));
    assert.deepEqual(groups, ['writing*', 'pages', 'today', 'desk', 'around']);
    const rows = await p.evaluate(() => document.querySelectorAll('.ps-show .switch').length + document.querySelectorAll('.ps-chips').length + document.querySelectorAll('.ps-show .ps-choice').length);
    assert.equal(rows, 41, 'forty-one rows on a phone (Calendar zoom came with the Calendar build; Now added ten on Nov 15: four for the strip, two for out of your head, two for the ends of the day, one for Training, one for First light; Training streak and charts added two on Nov 16)');
    assert.ok(await p.evaluate(() => document.querySelector('.page-settings').scrollHeight < 900), 'short enough to read');
    // A switch and its command are the same thing.
    await p.locator('.ps-group[data-group="pages"] .ps-ghead').tap();
    await p.locator('.switch:has([data-show="loose"]) input').tap();
    assert.ok(!(await p.evaluate(() => document.documentElement.classList.contains('hide-loose'))));
    await p.locator('#page-done').tap();
  });

  await check('removed switches have no command left; every kept one has one', async () => {
    const list = await p.evaluate(() => window.__commandList().map((c) => c.label));
    for (const gone of ['Show or hide note dots', 'Show or hide the six-dot handle', 'Show or hide bullets on notebook lines', 'Show or hide mode chips on voice captures', 'Show or hide section summaries']) assert.ok(!list.includes(gone), gone);
    for (const s of SHOWS.filter((x) => x.cmd)) assert.ok(s.choice ? s.choice.every(([, l]) => list.includes(`${s.cmd}: ${l}`)) : list.includes(s.cmd), s.cmd);
    // The page's own list of what went matches shows.js (index.html cleans old devices with it).
    const html = (await import('node:fs')).readFileSync('index.html', 'utf8');
    const inline = JSON.parse(html.match(/const gone = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
    assert.deepEqual(inline, REMOVED);
  });
  await ctx.close();

  await check('the computer: in Focus a tab in the corner brings the rail back', async () => {
    const c = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
    const d = await c.newPage();
    d.on('pageerror', (e) => errors.push(e.message));
    await d.goto(URL);
    await d.waitForSelector('#editor .ProseMirror');
    await sleep(600);
    assert.ok(!(await d.locator('.pb-tab').isVisible()), 'no tab outside Focus');
    await d.keyboard.press('Control+.');
    await d.waitForFunction(() => document.documentElement.classList.contains('focus'));
    await sleep(500);
    assert.ok(!(await d.locator('.rail').isVisible()), 'the rail steps away');
    await d.locator('.pb-tab').click();
    await d.waitForFunction(() => getComputedStyle(document.querySelector('.rail')).visibility === 'visible');
    assert.ok(await d.locator('.pb-focus').isVisible(), 'with the way out');
    await d.locator('#editor .ProseMirror').click();
    await d.waitForFunction(() => getComputedStyle(document.querySelector('.rail')).visibility === 'hidden');
    await d.keyboard.press('Control+K');
    await d.waitForSelector('.box-quick');
    await d.locator('.box-focus').click();
    await d.waitForFunction(() => !document.documentElement.classList.contains('focus'));
    await c.close();
  });
} finally {
  if (errors.length) { failed += 1; console.log(`FAIL page errors\n     ${errors.join('\n     ')}`); }
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
