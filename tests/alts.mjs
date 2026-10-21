// Alternates in a real browser: word versions and paragraph versions are added,
// flipped in place, saved, and stay out of exports.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(`${process.execPath.replace(/bin\/node$/, '')}lib/node_modules/playwright`)); }

const PORT = 4183;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const entries = () => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const para = () => page.locator('#editor .ProseMirror p').first().innerText();
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#editor .ProseMirror');
  await sleep(500);
  await page.keyboard.type('She walked to the harbour.');
  await sleep(400);

  await check('⌘⇧E on a word opens the panel and adds alternates', async () => {
    await page.evaluate(() => window.__editor.chain().focus().setTextSelection(7).run());
    await page.keyboard.press('Control+Shift+E');
    await page.waitForSelector('.alt-panel:not([hidden]) input');
    await page.keyboard.type('drifted');
    await page.keyboard.press('Enter');
    await page.keyboard.type('marched');
    await page.keyboard.press('Shift+Enter');
    assert.equal(await para(), 'She marched to the harbour.');
    assert.deepEqual(await page.locator('.alt-panel .alt-pick').allInnerTexts(), ['walked', 'drifted', 'marched']);
    assert.equal(await page.locator('.alt-panel li.current .alt-pick').innerText(), 'marched');
  });

  await check('⌥↓ flips the word in place', async () => {
    await page.keyboard.press('Escape');
    await page.locator('#editor .alt').click();
    await page.keyboard.press('Alt+ArrowDown');
    assert.equal(await para(), 'She walked to the harbour.');
    await page.keyboard.press('Alt+ArrowDown');
    assert.equal(await para(), 'She drifted to the harbour.');
  });

  await check('alternates are saved and come back after a reload', async () => {
    await sleep(800);
    const p = (await entries()).find((e) => e.kind === 'para' && !e.deleted);
    assert.equal(p.text, 'She drifted to the harbour.');
    await page.reload();
    await page.waitForSelector('#editor .alt');
    await sleep(500);
    assert.deepEqual(JSON.parse(await page.locator('#editor .alt').getAttribute('data-alts')), ['walked', 'drifted', 'marched']);
  });

  await check('a new paragraph version keeps the old one and flips back', async () => {
    await page.locator('#editor .ProseMirror p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Control+Shift+D');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.type('The harbour was empty when she got there.');
    assert.equal(await page.locator('#editor p[data-pv]').getAttribute('data-pv'), '2/2');
    await page.keyboard.press('Home');
    await page.keyboard.press('Alt+ArrowUp');
    assert.equal(await para(), 'She drifted to the harbour.');
    await page.keyboard.press('End');
    await page.keyboard.press('Alt+ArrowUp');
    assert.equal(await para(), 'The harbour was empty when she got there.');
    await sleep(800);
    const p = (await entries()).find((e) => e.kind === 'para' && !e.deleted);
    assert.equal(p.fields.versions.length, 2);
    assert.equal(p.fields.pvi, 1);
    assert.equal(p.text, 'The harbour was empty when she got there.');
  });

  await check('the versions panel lists paragraph versions and can drop one', async () => {
    await page.evaluate(() => { document.querySelector('#editor .ProseMirror').focus(); });
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Versions of this paragraph');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.alt-panel:not([hidden]) li');
    assert.equal(await page.locator('.alt-panel li').count(), 2);
    await page.locator('.alt-panel li:not(.current) .alt-drop').click({ force: true });
    assert.equal(await page.locator('.alt-panel li').count(), 1);
    assert.equal(await page.locator('#editor p[data-pv]').count(), 0);
  });

  await check('switching marks off hides the underline; focus hides it too', async () => {
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__editor.chain().focus().setTextSelection(7).run());
    await page.keyboard.press('Control+Shift+E');
    await page.waitForSelector('.alt-panel:not([hidden]) input');
    await page.keyboard.type('port');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    const deco = () => page.locator('#editor .alt').first().evaluate((el) => getComputedStyle(el).textDecorationLine);
    assert.equal(await deco(), 'underline');
    await page.evaluate(() => document.documentElement.classList.add('hide-alts'));
    assert.equal(await deco(), 'none');
    await page.evaluate(() => document.documentElement.classList.remove('hide-alts'));
    await page.evaluate(() => document.documentElement.classList.add('focus'));
    assert.equal(await deco(), 'none');
    await page.evaluate(() => document.documentElement.classList.remove('focus'));
  });

  await check('no page errors', async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
