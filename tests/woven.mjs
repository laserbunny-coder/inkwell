// Woven scripts: flowing prose with the scene headings hidden as faint lines.
// Guessing headings from the words, the Enter and Tab flow, the scene card,
// titles, slash marks, Classic and back, looks, and Prepare for shoot.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { parseSlug, buildSlug, guessScene, placeList, missing } from '../src/woven.js';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(`${process.execPath.replace(/bin\/node$/, '')}lib/node_modules/playwright`)); }

let failed = 0;
const errors = [];
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) {
    failed += 1;
    const at = (e.stack || '').split('\n').find((l) => l.includes('woven.mjs')) || '';
    let seen = '';
    try { seen = await p.evaluate(() => [...document.querySelectorAll('.toast, .palette:not([hidden]), .wv-sheet')].map((x) => `${x.className}: ${x.innerText.slice(0, 200)}`).join(' | ')); } catch {}
    console.log(`FAIL ${name}\n     ${e.message}\n     ${at.trim()}${seen ? `\n     on screen: ${seen}` : ''}`);
    if (process.env.STACK) console.log(e.stack);
  }
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
const server = await serve(PORT);
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
// On a busy machine a click can land while the editor is still redrawing
// (a scene card just closed); click once more if the caret didn't follow.
const clickOn = async (text) => {
  const there = (timeout) => p.waitForFunction((t) => window.__editor.state.selection.$from.parent.textContent.includes(t), text, { timeout });
  await p.locator('#editor p', { hasText: text }).click();
  try { await there(5000); } catch { await p.locator('#editor p', { hasText: text }).click(); await there(30000); }
};
const run = async (label) => {
  // Wait for the palette to have focus and fill it whole, so no typed letters
  // are lost on a slow machine, then choose the command by its name. A panel
  // that was just closed hands the caret back to the text on the next frame;
  // let that happen first, or it lands after the palette has opened.
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.keyboard.press('Control+K');
  await p.waitForFunction(() => document.activeElement?.id === 'palette-input');
  await p.locator('#palette-input').fill(label);
  const item = p.locator('#palette-list li', { hasText: label }).first();
  await item.waitFor();
  await item.click();
};

try {
  await p.goto(URL);
  await p.waitForSelector('#editor .ProseMirror');
  await sleep(500);

  await check('a new script opens in Woven; Classic and back: the writing font, no INT./EXT. lines', async () => {
    await run('New screenplay');
    await p.waitForSelector('#lib-new', { state: 'visible' });
    await p.fill('#lib-new-title', 'Rent Day');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelector('#nb-title')?.textContent === 'Idea');
    await sleep(400);
    await p.keyboard.press('Control+O');
    await p.keyboard.type('Script · Rent Day');
    await p.waitForFunction(() => document.querySelector('.palette[data-loaded]') && /^Script\s*chapter · Rent Day/.test(document.querySelector('#palette-list li.box-row')?.textContent || ''));
    await p.keyboard.press('Enter');
    // A new script opens in Woven; Classic shows the heading to type into.
    await p.waitForFunction(() => document.documentElement.classList.contains('woven'));
    await sleep(300);
    await run('Script view: Classic');
    await p.waitForSelector('html.script:not(.woven) #editor p[data-el="scene"]');
    await p.locator('#editor p[data-el="scene"]').click();
    await p.keyboard.type('int. bakery - morning');
    // A Woven script already has its first action line under the heading.
    await p.keyboard.press('ArrowDown');
    await p.keyboard.type('A letter slaps down beside the till.');
    await sleep(300);
    await run('Script view: Woven');
    await p.waitForFunction(() => document.documentElement.classList.contains('woven'));
    await p.waitForFunction(() => document.querySelectorAll('.wv-line').length === 1);
    assert.equal(await p.locator('#editor p[data-el="scene"]').isVisible(), false);
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

  await check('while you write, the scroll bar goes clear (the wheel still scrolls); moving the mouse brings it back', async () => {
    const bar = () => p.evaluate(() => getComputedStyle(document.documentElement).scrollbarColor);
    await p.keyboard.type(' ');
    await p.waitForFunction(() => document.body.classList.contains('typing'));
    assert.equal(await bar(), 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)');
    await p.mouse.move(200, 200); await p.mouse.move(400, 400); await p.mouse.move(600, 500);
    await p.waitForFunction(() => !document.body.classList.contains('typing'));
    assert.notEqual(await bar(), 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)');
    await p.keyboard.press('Backspace');
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

  await check('the scene line has three touch points: the right end’s place and time open the scene card; the middle names the scene', async () => {
    // Nothing sits out in the margin: the line itself is what you tap, in three parts.
    const zones = await p.locator('.wv-line').nth(1).evaluate((l) => {
      const bar = l.querySelector('.wv-bar').getBoundingClientRect();
      return ['l', 'm', 'r'].map((k) => { const r = l.querySelector(`.wv-zone.${k}`).getBoundingClientRect(); return Math.round(((r.left - bar.left) / bar.width) * 100) + ':' + Math.round((r.width / bar.width) * 100); });
    });
    assert.deepEqual(zones, ['0:25', '25:50', '75:25']);
    await p.locator('.wv-line').nth(1).locator('.wv-zone.r').click();
    await p.waitForSelector('.wv-notes .wv-slug');
    await p.locator('.wv-notes .wv-slug').click();
    await p.waitForSelector('.wv-pop', { state: 'visible' });
    await p.locator('.wv-pop .wv-chip', { hasText: 'Dusk' }).click();
    assert.equal(await p.locator('.wv-pop').isVisible(), true);
    await p.locator('.wv-pop .wv-chip', { hasText: 'Continuous' }).click();
    await p.locator('.wv-pop').getByRole('button', { name: 'Cut', exact: true }).click();
    await p.locator('.wv-pop .wv-chip', { hasText: 'Night' }).click();
    assert.equal(await p.locator('.wv-pop-title').count(), 0, 'the title lives in the plan now');
    await p.locator('.wv-pop-done').click();
    await p.waitForFunction(() => document.querySelector('.wv-pop').hidden);
    assert.equal((await els())[2], 'scene:EXT. ALLEY - NIGHT');
    assert.match(await p.locator('.wv-notes .wv-slug').innerText(), /EXT\. ALLEY - NIGHT/i);
    await p.locator('.wv-line').nth(1).locator('.wv-zone.r').click();
    await p.waitForFunction(() => !document.querySelector('.wv-notes'));
    // The middle: the plan, with the title in it.
    await p.locator('.wv-line').nth(1).locator('.wv-zone.m').click();
    await p.waitForSelector('.wv-plan .wv-p-title');
    await p.locator('.wv-plan .wv-p-title').fill('Counting the coins');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.activeElement?.classList.contains('wv-p-sum'));
    await p.keyboard.press('Escape');
    await p.locator('.wv-line').nth(1).locator('.wv-zone.m').click();
    await p.waitForFunction(() => !document.querySelector('.wv-plan'));
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

  await check('name colour: a chip in Woven, its own in Classic (plain until picked), and Custom takes any colour', async () => {
    const nameC = () => p.$eval('#editor p[data-el="character"]', (x) => getComputedStyle(x).color);
    const ink = await p.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--ink)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
    // The Aa button beside ⋯ opens straight on this script's Text tab.
    await p.locator('.zm-aa').click();
    await p.waitForSelector('.woven-names .wv-swatch', { state: 'visible' });
    assert.equal(await p.evaluate(() => document.querySelector('.page-settings').dataset.tab), 'text');
    await p.locator('.woven-names .wv-swatch', { hasText: 'Green' }).click();
    await p.waitForFunction(() => getComputedStyle(document.querySelector('#editor p[data-el="character"]')).color === 'rgb(90, 163, 107)');
    await p.locator('.woven-names .wv-swatch', { hasText: 'Plain' }).click();
    await p.waitForFunction((c) => getComputedStyle(document.querySelector('#editor p[data-el="character"]')).color === c, ink);
    // Classic: plain to start with (Woven's pick stays Woven's).
    await p.locator('[data-sv="classic"]').click();
    await p.waitForFunction(() => !document.documentElement.classList.contains('woven'));
    assert.equal(await nameC(), ink);
    await p.locator('.woven-names .wv-custom input').evaluate((i) => { i.value = '#ff8800'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); });
    await p.waitForFunction(() => getComputedStyle(document.querySelector('#editor p[data-el="character"]')).color === 'rgb(255, 136, 0)');
    assert.equal(await p.locator('.woven-names .wv-custom').evaluate((x) => x.classList.contains('current')), true);
    await sleep(800);
    const f = (await all()).find((e) => e.kind === 'project' && e.title === 'Rent Day').fields;
    assert.equal(f.classicNames, '#ff8800');
    assert.equal(f.look.names, 'ink');
    await p.locator('[data-sv="woven"]').click();
    await p.waitForFunction(() => document.documentElement.classList.contains('woven'));
    assert.equal(await nameC(), ink);
    await p.locator('#page-done').click();
  });

  await check('the plan under the line: a summary on the heading, an old one joined, threads made and marked, not in the margin', async () => {
    // An older summary on the title section (from the grid, or Classic) shows, joined with the heading's.
    const sec = (await all()).find((e) => e.kind === 'scene' && e.title === 'Counting the coins');
    await p.evaluate((id) => {
      const ed = window.__editor;
      let at = null;
      ed.state.doc.forEach((n, pos) => { if (n.attrs.eid === id) at = pos; });
      ed.view.dispatch(ed.state.tr.setNodeMarkup(at, undefined, { ...ed.state.doc.nodeAt(at).attrs, synopsis: 'Kenji counts.' }));
    }, sec.id);
    await p.locator('.wv-line').nth(1).locator('.wv-zone.m').click();
    await p.waitForSelector('.wv-plan .wv-p-sum');
    assert.equal(await p.locator('.wv-plan .wv-p-sum').inputValue(), 'Kenji counts.');
    // While open, the line shows only the number.
    assert.equal((await p.locator('.wv-line').nth(1).locator('.wv-title').innerText()).trim(), '2');
    await p.locator('.wv-plan .wv-p-sum').fill('Kenji counts the coins. It is not enough.');
    await p.keyboard.press('Enter');
    await sleep(900);
    const heading = (await all()).find((e) => e.kind === 'para' && e.fields?.el === 'scene' && /ALLEY/i.test(e.text) && !e.deleted);
    assert.equal(heading.fields.synopsis, 'Kenji counts the coins. It is not enough.');
    assert.ok(!(await all()).find((e) => e.id === sec.id).fields.synopsis, 'the title section’s copy was cleared');
    // + thread, + New thread: a thread is made and its line added here, caret in it.
    await p.locator('.wv-plan .wv-addb', { hasText: '+ thread' }).click();
    await p.locator('.wv-plan .wv-tchip.new').click();
    await p.keyboard.type('Saving the bakery');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.activeElement?.classList.contains('wv-bt'));
    await p.keyboard.type('He decides to raise it himself');
    await p.locator('.wv-plan .wv-beat .wv-mk').click();
    assert.equal(await p.locator('.wv-plan .wv-beat .wv-mk').innerText(), '◇');
    await sleep(900);
    const rows = await all();
    const thread = rows.find((e) => e.kind === 'thread' && e.title === 'Saving the bakery');
    assert.ok(thread, 'the thread was made in the world');
    const line = rows.find((e) => e.kind === 'note' && e.fields?.thread === thread.id && !e.deleted);
    assert.equal(line.parent_id, heading.id);
    assert.equal(line.fields.beat, 'promise');
    assert.equal(line.text, 'He decides to raise it himself');
    // Not drawn in the margin as well.
    await p.keyboard.press('Control+2');
    await sleep(300);
    assert.equal(await p.locator(`.note[data-note="${line.id}"]`).count(), 0);
    await p.keyboard.press('Control+2');
    // × takes it away, with Undo.
    await p.locator('.wv-plan .wv-beat .wv-x').click();
    await p.waitForFunction(() => !document.querySelector('.wv-plan .wv-beat'));
    await p.locator('.toast button', { hasText: 'Undo' }).click();
    await p.waitForSelector('.wv-plan .wv-beat');
    // An existing thread is a chip.
    await p.locator('.wv-plan .wv-addb', { hasText: '+ thread' }).click();
    assert.deepEqual(await p.locator('.wv-plan .wv-tchip:not(.new)').allInnerTexts(), ['Saving the bakery']);
    await p.locator('.wv-plan .wv-addb', { hasText: 'Done' }).click();
    await p.locator('.wv-line').nth(1).locator('.wv-zone.m').click();
    await p.waitForFunction(() => !document.querySelector('.wv-plan'));
  });

  await check('the right end: notes for the scene, + note in your own category', async () => {
    await p.locator('.wv-line').nth(0).locator('.wv-zone.r').click();
    await p.waitForSelector('.wv-notes');
    assert.match(await p.locator('.wv-notes .wv-slug').innerText(), /INT\. BAKERY - MORNING/i);
    await p.locator('.wv-notes .wv-addb').click();
    await p.waitForFunction(() => document.activeElement?.closest('.wv-note'));
    await p.keyboard.type('Hold on the red stamp');
    await sleep(900);
    const n = (await all()).find((e) => e.kind === 'note' && e.text === 'Hold on the red stamp');
    assert.ok(n && !['comment', 'claude'].includes(n.type) && !n.fields?.thread);
    await p.locator('.wv-line').nth(0).locator('.wv-zone.r').click();
    await p.waitForFunction(() => !document.querySelector('.wv-notes'));
  });

  await check('the left end turns titles on and off, and the line you tapped does not move', async () => {
    // An act above, so something comes and goes over the line.
    await p.evaluate(() => { const ed = window.__editor; ed.view.dispatch(ed.state.tr.insert(0, ed.state.schema.nodes.sceneBreak.create({ level: 1, title: 'The rent' }))); window.scrollTo(0, 0); });
    await p.waitForSelector('.scene-break[data-level="1"]');
    await sleep(200);
    const y = async () => (await p.locator('.wv-line').nth(1).boundingBox()).y;
    const before = await y();
    await p.locator('.wv-line').nth(1).locator('.wv-zone.l').click();
    await p.waitForFunction(() => document.documentElement.classList.contains('hide-sections'));
    assert.equal((await p.locator('.wv-line').nth(1).locator('.wv-title').innerText()).trim(), '', 'a bare rule');
    assert.ok(Math.abs((await y()) - before) < 2, `moved ${(await y()) - before}px`);
    await p.keyboard.press('Control+Shift+Period');
    await p.waitForFunction(() => !document.documentElement.classList.contains('hide-sections'));
    assert.ok(Math.abs((await y()) - before) < 2);
    assert.match(await p.locator('.wv-line').nth(1).innerText(), /Counting the coins/i);
    // Mid-page too, with the key: the line under the pointer stays.
    await p.evaluate(() => window.scrollTo(0, 120));
    const box = await p.locator('.wv-line').nth(1).boundingBox();
    await p.mouse.move(box.x + 20, box.y + 5);
    const mid = await y();
    await p.keyboard.press('Control+Shift+Period');
    await p.waitForFunction(() => document.documentElement.classList.contains('hide-sections'));
    assert.ok(Math.abs((await y()) - mid) < 2, `moved ${(await y()) - mid}px`);
    await p.keyboard.press('Control+Shift+Period');
    await p.waitForFunction(() => !document.documentElement.classList.contains('hide-sections'));
    assert.ok(Math.abs((await y()) - mid) < 2);
  });

  await check('Ctrl + Shift + Comma and the Plan button open every scene’s plan; Write · Grid sits in the top bar', async () => {
    await p.keyboard.press('Control+Shift+Comma');
    await p.waitForFunction(() => document.querySelectorAll('.wv-plan').length === 2);
    assert.equal(await p.locator('.pv-plan').getAttribute('aria-pressed'), 'true');
    await p.locator('.pv-plan').click();
    await p.waitForFunction(() => document.querySelectorAll('.wv-plan').length === 0);
    assert.deepEqual(await p.locator('.pv-seg button').allInnerTexts(), ['Write', 'Grid']);
    // The grid: one row per scene, named by its title.
    await p.locator('.pv-seg button', { hasText: 'Grid' }).click();
    await p.waitForSelector('.gv-table');
    await p.waitForFunction(() => [...document.querySelectorAll('.gv-row .gv-name')].map((x) => x.textContent).join('|').includes('2 · Counting the coins'));
    assert.equal(await p.locator('.gv-row').count(), 2);
    assert.match(await p.locator('.gv-row').nth(1).innerText(), /Kenji counts the coins/);
    await p.locator('.pv-seg button', { hasText: 'Write' }).click();
    await p.waitForFunction(() => !document.documentElement.dataset.view && document.querySelector('.wv-line'));
  });

  await check('# then space starts a new scene, its title waiting in the plan', async () => {
    await clickOn('He sets the table.');
    await p.keyboard.press('End');
    await p.keyboard.press('Enter');
    await p.keyboard.type('# ');
    await p.waitForFunction(() => document.activeElement?.classList.contains('wv-p-title'));
    await p.keyboard.type('Plates');
    await p.keyboard.press('Enter');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => document.querySelectorAll('.wv-line').length === 3);
    await sleep(900);
    assert.ok((await all()).some((e) => e.kind === 'scene' && e.title === 'Plates' && !e.deleted && e.fields.level === 3));
    // Fold it again and take the scene away, so the checks after see two.
    await p.locator('.wv-line').nth(2).locator('.wv-zone.m').click();
    await p.waitForFunction(() => !document.querySelector('.wv-plan'));
    await p.keyboard.press('Control+Z'); await p.keyboard.press('Control+Z'); await p.keyboard.press('Control+Z');
    await p.waitForFunction(() => document.querySelectorAll('.wv-line').length === 2);
  });

  await check('reading: scrolling down slides the top bar and the ruler away; a little back up brings them back', async () => {
    await p.evaluate(() => { const ed = window.__editor; const sc = ed.state.schema; ed.view.dispatch(ed.state.tr.insert(ed.state.doc.content.size, Array.from({ length: 30 }, () => sc.nodes.paragraph.create({ el: 'action' }, sc.text('The till rings again and again, all morning long.'))))); document.activeElement?.blur(); window.scrollTo(0, 0); });
    await p.evaluate(() => document.body.classList.remove('typing'));
    await sleep(300);
    await p.mouse.move(640, 400);
    await p.mouse.wheel(0, 700);
    await p.waitForFunction(() => document.body.classList.contains('scroll-away'));
    await sleep(300);
    assert.ok((await p.locator('.topbar').boundingBox()).y < -10, 'the top bar slid up out of view');
    await p.mouse.wheel(0, -120);
    await p.waitForFunction(() => !document.body.classList.contains('scroll-away'));
    await p.mouse.wheel(0, 700);
    await p.waitForFunction(() => document.body.classList.contains('scroll-away'));
    // On Windows the mouse at the top edge brings it back too.
    await p.mouse.move(640, 20);
    await p.waitForFunction(() => !document.body.classList.contains('scroll-away'));
    await p.evaluate(() => window.scrollTo(0, 0));
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

  await check('a new script starts in Woven on any device, even one that last picked Classic, ready to type in', async () => {
    await p.evaluate(() => localStorage.setItem('scriptView', 'classic'));
    await run('New screenplay');
    await p.waitForSelector('#lib-new', { state: 'visible' });
    await p.fill('#lib-new-title', 'Reel Five');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelector('#nb-title')?.textContent === 'Idea');
    await sleep(400);
    await p.keyboard.press('Control+O');
    await p.keyboard.type('Script · Reel Five');
    // Once the places are read, the chapter is on top ("Script", chapter · Reel Five).
    await p.waitForFunction(() => document.querySelector('.palette[data-loaded]') && /^Script\s*chapter · Reel Five/.test(document.querySelector('#palette-list li.box-row')?.textContent || ''));
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
