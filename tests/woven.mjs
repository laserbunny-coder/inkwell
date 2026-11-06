// Woven scripts: flowing prose with the scene headings hidden as faint lines.
// Guessing headings from the words, the Enter and Tab flow, the scene card,
// titles, slash marks, Classic and back, looks, and Prepare for shoot.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { parseSlug, buildSlug, guessScene, placeList, missing } from '../src/woven.js';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(`${process.execPath.replace(/bin\/node$/, '')}lib/node_modules/playwright`)); }

let failed = 0;
const errors = [];
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); if (process.env.STACK) console.log(e.stack); }
}

// ---------- without a browser ----------

await check('scene headings read into place, time and kind, and back out the same', async () => {
  const cases = ['INT. BAKERY KITCHEN - NIGHT', 'EXT. ALLEY - CONTINUOUS', 'INT./EXT. CAR - DAY', 'INTERCUT - KITCHEN / OFFICE - DAY', 'MONTAGE - STREET', 'INT. ROOFTOPS - NIGHT (FLASHBACK)', 'INT. HOUSE - UPSTAIRS - MORNING', 'TALKING HEAD'];
  for (const c of cases) assert.equal(buildSlug(parseSlug(c)), c);
  assert.deepEqual(parseSlug('ext. alley - continuous'), { ie: 'EXT.', place: 'ALLEY', time: 'CONTINUOUS', kind: 'continuous', place2: '' });
  assert.deepEqual(parseSlug('INT. HOUSE - UPSTAIRS'), { ie: 'INT.', place: 'HOUSE - UPSTAIRS', time: '', kind: 'cut', place2: '' });
  assert.equal(parseSlug('INTERCUT - KITCHEN / OFFICE - DAY').place2, 'OFFICE');
  assert.equal(buildSlug({ ie: 'INT.', place: '', time: 'NIGHT', kind: 'cut' }), 'INT. - NIGHT');
  assert.deepEqual(parseSlug('INT. - NIGHT'), { ie: 'INT.', place: '', time: 'NIGHT', kind: 'cut', place2: '' });
});

await check('a scene heading is guessed from the first words, the bible and the script', async () => {
  const places = placeList([{ name: 'Bakery', ie: 'INT.', also: ['the counter'] }, { name: 'Alley' }]);
  assert.deepEqual(guessScene('Night. The bakery is dark except for one lamp.', null, places), { ie: 'INT.', place: 'BAKERY', time: 'NIGHT', kind: 'cut', place2: '' });
  assert.equal(buildSlug(guessScene('Out the back door and into the alley, he skids to a stop.', null, places)), 'EXT. ALLEY');
  assert.equal(buildSlug(guessScene('Later. The table is empty.', { ie: 'EXT.', place: 'STREET' }, places)), 'EXT. STREET - LATER');
  assert.equal(buildSlug(guessScene('Fifty years ago. A young Grandpa runs.', null, places)), '(FLASHBACK)');
  assert.equal(buildSlug(guessScene('Kenji, straight to camera, flour on his nose.', null, places)), 'TALKING HEAD');
  assert.deepEqual(missing(parseSlug('TALKING HEAD'), places), []);
  assert.deepEqual(missing(parseSlug('EXT. ALLEY'), places), ['time']);
  assert.equal(guessScene('He waits.', null, places), null);
  assert.equal(buildSlug(guessScene('Morning at the bakery counter, still warm.', null, [])), 'INT. BAKERY COUNTER - MORNING');
  assert.equal(buildSlug(guessScene('That afternoon, up in the dojo, Kenji spreads the letter.', null, [])), 'INT. DOJO - AFTERNOON');
});

// ---------- in the app ----------

const PORT = 4193;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const browser = withoutSync(await chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(e.message));
const all = () => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const els = () => p.$$eval('#editor .ProseMirror > p', (ps) => ps.map((x) => `${x.dataset.el || 'action'}:${x.dataset.el === 'scene' ? x.textContent.toUpperCase() : x.textContent}`));
// Clicks a line and waits for the editor to have the caret there.
const clickOn = async (text) => {
  await p.locator('#editor p', { hasText: text }).click();
  await p.waitForFunction((t) => window.__editor.state.selection.$from.parent.textContent.includes(t), text);
};
const run = async (label) => {
  await p.keyboard.press('Control+K');
  await p.keyboard.type(label);
  await p.waitForFunction((l) => document.querySelector('#palette-list li')?.textContent.includes(l), label);
  await p.keyboard.press('Enter');
};

try {
  await p.goto(URL);
  await p.waitForSelector('#editor .ProseMirror');
  await sleep(500);

  await check('a script switches to Woven: the writing font, no INT./EXT. lines', async () => {
    await run('New screenplay');
    await p.waitForSelector('#lib-new', { state: 'visible' });
    await p.fill('#lib-new-title', 'Rent Day');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelector('#nb-title')?.textContent === 'Idea');
    await sleep(400);
    await p.keyboard.press('Control+O');
    await p.keyboard.type('Script · Rent Day');
    await p.waitForFunction(() => document.querySelector('#palette-list li')?.textContent.includes('Script · Rent Day'));
    await p.keyboard.press('Enter');
    await p.waitForSelector('html.script #editor p[data-el="scene"]');
    await p.locator('#editor p[data-el="scene"]').click();
    await p.keyboard.type('int. bakery - morning');
    await p.keyboard.press('Enter');
    await p.keyboard.type('A letter slaps down beside the till.');
    await sleep(300);
    await run('Script view: Woven');
    await p.waitForFunction(() => document.documentElement.classList.contains('woven'));
    assert.equal(await p.locator('#editor p[data-el="scene"]').isVisible(), false);
    assert.equal(await p.locator('.wv-line').count(), 1);
    const font = await p.locator('#editor .ProseMirror').evaluate((x) => getComputedStyle(x).fontFamily);
    assert.match(font, /Newsreader/);
    await sleep(800);
    assert.equal((await all()).find((e) => e.kind === 'project' && e.title === 'Rent Day').fields.woven, true);
  });

  await check('Enter twice starts a scene, and its heading is guessed from the words', async () => {
    await clickOn('A letter slaps');
    await p.keyboard.press('End'); await sleep(100);
    await p.keyboard.press('Enter');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Night. Out in the alley, Kenji counts the coins.');
    await p.waitForFunction(() => document.querySelectorAll('.wv-line').length === 2);
    const rows = await els();
    assert.deepEqual(rows, ['scene:INT. BAKERY - MORNING', 'action:A letter slaps down beside the till.', 'scene:EXT. ALLEY - NIGHT', 'action:Night. Out in the alley, Kenji counts the coins.']);
    assert.equal(await p.locator('.wv-line').nth(1).getAttribute('data-status'), 'guess');
  });

  await check('Enter after dialogue goes to the next name, then action; Tab makes a parenthetical', async () => {
    await p.keyboard.press('Enter');
    await p.keyboard.type('KENJI');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Fourteen fifty.');
    await p.keyboard.press('Enter');
    await p.keyboard.type('MOM');
    await p.keyboard.press('Enter');
    await p.keyboard.press('Enter'); // empty words → (how)
    await p.keyboard.type('not looking up');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Plates, Kenji.');
    await p.keyboard.press('Enter');
    await p.keyboard.press('Enter'); // empty name → action
    await p.keyboard.type('He sets the table.');
    const rows = (await els()).slice(4);
    assert.deepEqual(rows, ['character:KENJI', 'dialogue:Fourteen fifty.', 'character:MOM', 'paren:(not looking up)', 'dialogue:Plates, Kenji.', 'action:He sets the table.']);
    const nameAlign = await p.locator('#editor p[data-el="character"]').first().evaluate((x) => getComputedStyle(x).textAlign);
    assert.equal(nameAlign, 'center');
  });

  await check('the caret steps over the hidden headings', async () => {
    await clickOn('Night. Out in the alley');
    await p.keyboard.press('Home'); await sleep(100);
    await p.keyboard.press('ArrowLeft');
    const where = await p.evaluate(() => window.__editor.state.selection.$from.parent.textContent);
    assert.equal(where, 'A letter slaps down beside the till.');
  });

  await check('the dot opens the scene card; picks stay open and write the heading', async () => {
    await p.locator('.wv-line').nth(1).locator('.wv-dot').click();
    await p.waitForSelector('.wv-pop', { state: 'visible' });
    await p.locator('.wv-pop .wv-chip', { hasText: 'Dusk' }).click();
    assert.equal(await p.locator('.wv-pop').isVisible(), true);
    await p.locator('.wv-pop .wv-chip', { hasText: 'Continuous' }).click();
    await p.locator('.wv-pop').getByRole('button', { name: 'Cut', exact: true }).click();
    await p.locator('.wv-pop .wv-chip', { hasText: 'Night' }).click();
    await p.locator('.wv-pop-title').fill('Counting the coins');
    await p.locator('.wv-pop-done').click();
    await p.waitForFunction(() => document.querySelector('.wv-pop').hidden);
    assert.equal((await els())[2], 'scene:EXT. ALLEY - NIGHT');
    await p.waitForFunction(() => document.querySelectorAll('.wv-line')[1]?.textContent.includes('Counting the coins'));
    assert.equal(await p.locator('.wv-line').nth(1).getAttribute('data-status'), 'set');
    // Set by hand: rewriting the first words no longer moves it.
    await clickOn('Night. Out in the alley');
    await p.keyboard.press('Home'); await sleep(100);
    await p.keyboard.type('Morning. In the kitchen. ');
    await sleep(200);
    assert.equal((await els())[2], 'scene:EXT. ALLEY - NIGHT');
    await sleep(800);
    const title = (await all()).find((e) => e.kind === 'scene' && e.title === 'Counting the coins');
    assert.equal(title.fields.level, 3);
  });

  await check('Ctrl + Shift + Enter splits a scene; /continuous marks it; Backspace joins it back', async () => {
    await clickOn('He sets the table.');
    await p.keyboard.press('End'); await sleep(100);
    await p.keyboard.press('Control+Shift+Enter');
    await p.keyboard.type('She watches him.');
    await p.waitForFunction(() => document.querySelectorAll('.wv-line').length === 3);
    await p.keyboard.type(' /continuous');
    await p.waitForSelector('.slash', { state: 'visible' });
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelectorAll('.wv-line')[2]?.dataset.kind === 'continuous');
    assert.equal((await els()).at(-2), 'scene:EXT. ALLEY - CONTINUOUS');
    await p.keyboard.press('Home'); await sleep(100);
    await p.keyboard.press('Backspace');
    await p.waitForFunction(() => document.querySelectorAll('.wv-line').length === 2);
  });

  await check('Classic shows the headings again, in Courier, and Woven comes back as it was', async () => {
    await run('Script view: Classic');
    await p.waitForFunction(() => !document.documentElement.classList.contains('woven'));
    assert.equal(await p.locator('#editor p[data-el="scene"]').first().isVisible(), true);
    assert.match(await p.locator('#editor .ProseMirror').evaluate((x) => getComputedStyle(x).fontFamily), /Courier/);
    assert.equal(await p.locator('.wv-line').count(), 0);
    await run('Script view: Woven');
    await p.waitForFunction(() => document.querySelectorAll('.wv-line').length === 2);
  });

  await check('Focus keeps just the faint line; the titles come back with Ctrl + Shift + .', async () => {
    await clickOn('He sets');
    await p.keyboard.press('Control+.');
    await p.waitForFunction(() => document.documentElement.classList.contains('focus'));
    assert.equal(await p.locator('.wv-line').nth(1).locator('.wv-dot').isVisible(), false);
    assert.equal(await p.locator('.wv-line').nth(1).locator('.wv-title').evaluate((x) => getComputedStyle(x).visibility), 'hidden');
    await p.keyboard.press('Control+Shift+.');
    await p.waitForFunction(() => getComputedStyle(document.querySelectorAll('.wv-line')[1].querySelector('.wv-title')).visibility === 'visible');
    await p.keyboard.press('Control+Shift+.');
    await p.keyboard.press('Control+.');
    await p.waitForFunction(() => !document.documentElement.classList.contains('focus'));
  });

  await check('a look per script: Kung fu titles in red brush lettering', async () => {
    await p.keyboard.press('Control+K');
    await p.keyboard.type('this script’s look');
    await p.waitForFunction(() => document.querySelector('#palette-list li')?.textContent.includes('look'));
    await p.keyboard.press('Enter');
    await p.waitForSelector('.woven-look .wv-preset', { state: 'visible' });
    await p.locator('.wv-preset', { hasText: 'Kung fu' }).click();
    await p.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--wv-title-font').includes('Shojumaru'));
    await sleep(800);
    const look = (await all()).find((e) => e.kind === 'project' && e.title === 'Rent Day').fields.look;
    assert.equal(look.preset, 'kungfu');
    assert.equal(look.titleColor, '#d8432f');
    await p.locator('#page-done').click();
  });

  await check('Prepare for shoot fills what it can and asks the rest, without touching the words', async () => {
    await p.evaluate(() => {
      window.__claude = async (body) => {
        window.__asked = body;
        if (body.mode !== 'woven') return {};
        return { scenes: [{ n: 1, ie: 'EXT.', place: 'STREET', time: 'NIGHT', title: 'The letter' }], questions: [], places: [] };
      };
    });
    const words = (await els()).filter((r) => !r.startsWith('scene:'));
    await run('Woven: prepare for shoot');
    await p.waitForSelector('.wv-sheet h3, .wv-sheet-ready');
    const asked = await p.evaluate(() => window.__asked);
    assert.equal(asked.task, 'prepare');
    assert.equal(asked.scenes.length, 2);
    assert.deepEqual((await els()).filter((r) => !r.startsWith('scene:')), words);
    // Scene 1 was set by hand (INT. BAKERY - MORNING), so it stays; it only gets its title.
    assert.equal((await els())[0], 'scene:INT. BAKERY - MORNING');
    await p.waitForFunction(() => document.querySelectorAll('.wv-line')[0]?.textContent.includes('The letter'));
    assert.match(await p.locator('.wv-sheet-places').innerText(), /Bakery, Alley/);
    await p.locator('.wv-sheet .pill', { hasText: 'place pages' }).click();
    await p.waitForFunction(() => document.querySelector('.wv-sheet .pill')?.textContent === 'Made');
    await sleep(500);
    const pages = (await all()).filter((e) => e.kind === 'page' && e.fields?.element?.type === 'location').map((e) => `${e.title}:${e.fields.place?.ie}`);
    assert.deepEqual(pages.sort(), ['Alley:EXT.', 'Bakery:INT.']);
    await p.locator('.wv-sheet-foot .pill').click();
  });

  await check('it all survives a reload, with real scene headings underneath', async () => {
    await sleep(800);
    await p.reload();
    await p.waitForSelector('html.woven .wv-line');
    assert.equal(await p.locator('.wv-line').count(), 2);
    const rows = (await all()).filter((e) => e.kind === 'para' && e.fields?.el === 'scene' && !e.deleted).map((e) => e.text.toUpperCase()).sort();
    assert.deepEqual(rows, ['EXT. ALLEY - NIGHT', 'INT. BAKERY - MORNING']);
  });

  await check('a new script starts in Woven when that is what you used last, ready to type in', async () => {
    await run('New screenplay');
    await p.waitForSelector('#lib-new', { state: 'visible' });
    await p.fill('#lib-new-title', 'Reel Five');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelector('#nb-title')?.textContent === 'Idea');
    await sleep(400);
    await p.keyboard.press('Control+O');
    await p.keyboard.type('Script · Reel Five');
    await p.waitForFunction(() => document.querySelector('#palette-list li')?.textContent.includes('Script · Reel Five'));
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.documentElement.classList.contains('woven') && document.querySelectorAll('#editor .ProseMirror > p').length === 2);
    await p.locator('#editor p[data-el="action"]').click();
    await p.waitForFunction(() => window.__editor.state.selection.$from.parent.attrs.el === 'action');
    await p.keyboard.type('Dawn. Out in the parking lot, the van will not start.');
    await p.waitForFunction(() => window.__editor.state.doc.firstChild.textContent === 'EXT. PARKING LOT - DAWN');
  });

  assert.deepEqual(errors, []);
} catch (e) {
  failed += 1;
  console.log(`FAIL ${e.message}`);
} finally {
  if (errors.length) console.log('page errors:', errors);
  await browser.close();
  server.kill();
}
if (!failed) console.log("all woven checks passed");
process.exit(failed ? 1 : 0);
