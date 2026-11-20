// Character names in scripts (Nov 20 2026): typing on a character line lists
// the names already spoken in this project's scripts, like screenplay
// software. Only this project's, never names from another project.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
let chromium, devices;
try { ({ chromium, devices } = require('playwright')); } catch { ({ chromium, devices } = require(`${process.execPath.replace(/bin\/node$/, '')}lib/node_modules/playwright`)); }

let failed = 0;
const errors = [];
let p;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) {
    failed += 1;
    const at = (e.stack || '').split('\n').find((l) => l.includes('cast.mjs')) || '';
    console.log(`FAIL ${name}\n     ${e.message}\n     ${at.trim()}`);
  }
}

const PORT = 4194;
const server = await serve(PORT);
const browser = withoutSync(await chromium.launch());

async function open(ctxOpts) {
  const ctx = await browser.newContext({ colorScheme: 'dark', ...ctxOpts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#editor .ProseMirror', { state: 'attached' });
  await sleep(500);
  return page;
}
const run = async (label) => {
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.keyboard.press('Control+K');
  await p.waitForFunction(() => document.activeElement?.id === 'palette-input');
  await p.locator('#palette-input').fill(label);
  const item = p.locator('#palette-list li', { hasText: label }).first();
  await item.waitFor();
  await item.click();
};
// A new screenplay in a project of its own, open on its script (in Woven).
async function newScript(title) {
  await run('New screenplay');
  await p.waitForSelector('#lib-new', { state: 'visible' });
  await p.fill('#lib-new-title', title);
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelector('#nb-title')?.textContent === 'Idea');
  await sleep(400);
  await p.keyboard.press('Control+O');
  await p.waitForFunction(() => document.activeElement?.id === 'palette-input');
  await p.locator('#palette-input').fill(`Script · ${title}`);
  await p.waitForFunction((t) => document.querySelector('.palette[data-loaded]') && new RegExp(`^Script\\s*chapter · ${t}`).test(document.querySelector('#palette-list li.box-row')?.textContent || ''), title);
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.documentElement.classList.contains('woven') && document.querySelectorAll('#editor .ProseMirror > p').length === 2);
  await p.locator('#editor p[data-el="action"]').click();
}
const els = () => p.$$eval('#editor .ProseMirror > p', (ps) => ps.map((x) => `${x.dataset.el || 'action'}:${x.textContent}`));
const shown = () => p.$$eval('.suggest:not([hidden]) li .label', (ls) => ls.map((l) => l.textContent));
const here = () => p.evaluate(() => window.__editor.state.selection.$from.parent.attrs.el);

try {
  p = await open({ viewport: { width: 1280, height: 900 } });

  await check('a character line lists the names already spoken in this project, as you type', async () => {
    await newScript('Rent Day');
    await p.keyboard.type('Morning at the bakery counter. A letter slaps down.');
    await p.keyboard.press('Enter');
    await p.keyboard.type('KENJI');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Fourteen fifty.');
    await p.keyboard.press('Enter');
    await p.keyboard.type('MOM');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Plates, Kenji.');
    await p.keyboard.press('Enter');
    assert.equal(await here(), 'character');
    await p.keyboard.type('K');
    await p.waitForFunction(() => !document.querySelector('.suggest').hidden);
    assert.deepEqual(await shown(), ['KENJI']);
  });

  await check('Enter takes the name and goes on to the dialogue', async () => {
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => window.__editor.state.selection.$from.parent.attrs.el === 'dialogue');
    assert.equal((await els()).at(-2), 'character:KENJI');
    await p.keyboard.type('No more plates.');
  });

  await check('Tab takes the name and stays on it, for a (V.O.)', async () => {
    await p.keyboard.press('Enter');
    await p.keyboard.type('mo');
    await p.waitForFunction(() => !document.querySelector('.suggest').hidden);
    assert.deepEqual(await shown(), ['MOM']);
    await p.keyboard.press('Tab');
    await p.waitForFunction(() => document.querySelector('.suggest').hidden);
    assert.equal(await here(), 'character');
    await p.keyboard.type(' (V.O.)');
    await sleep(200);
    assert.equal(await p.locator('.suggest').isHidden(), true, 'a name already whole lists nothing');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => window.__editor.state.selection.$from.parent.attrs.el === 'dialogue');
    await p.keyboard.type('Then sell the van.');
    assert.equal((await els()).at(-2), 'character:MOM (V.O.)');
    // MOM just spoke, so on a new name line KENJI (who spoke before her) comes first.
    await p.keyboard.press('Enter');
    await p.keyboard.type('KAITO');
    await p.keyboard.press('Escape');
    await p.keyboard.press('Enter');
    await p.keyboard.type('He means it.');
    await p.keyboard.press('Enter');
    await p.keyboard.type('K');
    await p.waitForFunction(() => !document.querySelector('.suggest').hidden);
    assert.deepEqual(await shown(), ['KENJI', 'KAITO']);
    await p.keyboard.press('Escape');
    await p.keyboard.press('Backspace');
    await p.keyboard.press('Enter');
  });

  await check('a name typed in capitals on an action line is offered too; Esc leaves what you typed', async () => {
    await p.keyboard.press('Enter');
    await p.keyboard.press('Enter'); // empty name: back to action
    assert.equal(await here(), 'action');
    await p.keyboard.type('KE');
    await p.waitForFunction(() => !document.querySelector('.suggest').hidden);
    assert.deepEqual(await shown(), ['KENJI']);
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => document.querySelector('.suggest').hidden);
    await p.keyboard.type('N');
    await sleep(200);
    assert.equal(await p.locator('.suggest').isHidden(), true, 'Esc keeps it closed on this line');
    await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace');
  });

  await check('a click on a name takes it, and it becomes a character line', async () => {
    await p.keyboard.type('KEN');
    await p.waitForFunction(() => !document.querySelector('.suggest').hidden);
    await p.locator('.suggest li', { hasText: 'KENJI' }).click();
    await p.waitForFunction(() => window.__editor.state.selection.$from.parent.attrs.el === 'dialogue');
    assert.equal((await els()).at(-2), 'character:KENJI');
    await p.keyboard.type('Fine.');
    await sleep(900);
  });

  await check('another project never lists this one’s names, in Woven or Classic', async () => {
    await newScript('Harbour Lights');
    await p.keyboard.type('Fog on the pier.');
    await p.keyboard.press('Enter');
    await p.keyboard.type('MARA');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Anyone there?');
    await p.keyboard.press('Enter');
    await p.keyboard.type('K');
    await sleep(500);
    assert.equal(await p.locator('.suggest').isHidden(), true, 'KENJI is in Rent Day only');
    await p.keyboard.press('Backspace');
    await p.keyboard.type('M');
    await p.waitForFunction(() => !document.querySelector('.suggest').hidden);
    assert.deepEqual(await shown(), ['MARA']);
    await p.keyboard.press('Escape');
    await p.keyboard.press('Backspace');
    await run('Script view: Classic');
    await p.waitForFunction(() => !document.documentElement.classList.contains('woven'));
    await p.locator('#editor p[data-el="character"]').last().click();
    await p.keyboard.press('End');
    await p.keyboard.type('m');
    await p.waitForFunction(() => !document.querySelector('.suggest').hidden);
    assert.deepEqual(await shown(), ['MARA']);
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => window.__editor.state.selection.$from.parent.attrs.el === 'dialogue');
  });

  await check('on a phone the names sit in a row above the keyboard; a tap takes one', async () => {
    p = await open({ ...devices['Pixel 7'] });
    await newScript('Pocket Show');
    await p.keyboard.type('Rain.');
    await p.keyboard.press('Enter');
    await p.keyboard.type('JUNO');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Run!');
    await p.keyboard.press('Enter');
    await p.keyboard.type('J');
    await p.waitForFunction(() => !document.querySelector('.suggest').hidden);
    assert.equal(await p.locator('.suggest').evaluate((b) => b.classList.contains('row')), true);
    await p.locator('.suggest li', { hasText: 'JUNO' }).tap();
    await p.waitForFunction(() => window.__editor.state.selection.$from.parent.attrs.el === 'dialogue');
    assert.equal((await els()).at(-2), 'character:JUNO');
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
console.log(failed ? `\n${failed} failed` : '\ncharacter names: all passed');
process.exit(failed ? 1 : 0);
