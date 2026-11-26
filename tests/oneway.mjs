// One way everywhere (Michael, Nov 25 2026), with a mouse on a page: a line
// is its words. A click puts the cursor there; a press on a line you're not
// typing in and a drag moves it; held still and let go, or a right-click, is
// its menu; a double-click zooms in. No six dots; the fold triangle sits at
// the far right. Zoomed into a line with nothing under it, an empty line
// waits there to write in, and goes again if left empty.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { setOutline, readOutline } from './outliner-kit.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4313;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const browser = withoutSync(await chromium.launch());
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); if (process.env.STACK) console.log(e.stack); }
}

const START = `
Alpha
Bravo
  Bravo kid
Charlie`;

try {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(URL);
  await p.waitForSelector('#editor .ProseMirror');
  await p.keyboard.press('Control+J');
  await p.waitForFunction(() => document.querySelector('#nb-kind')?.textContent === 'Today');
  const words = (t) => p.locator('#outline-editor li > p', { hasText: new RegExp(`^${t}$`) }).first();
  const at = async (t) => { const b = await words(t).boundingBox(); return { x: b.x + 12, y: b.y + b.height / 2, b }; };
  const plain = async () => (await readOutline(p)).replace(/\|/g, '');
  const fresh = async () => { await setOutline(p, START); await p.evaluate(() => document.activeElement?.blur()); await sleep(200); };
  const menu = p.locator('.handle-menu');

  await check('no six dots on a line, even under the pointer', async () => {
    await fresh();
    await words('Charlie').hover();
    await sleep(250);
    const shown = await p.evaluate(() => [...document.querySelectorAll('#outline-editor .bullet .grip')].some((g) => g.getBoundingClientRect().width && getComputedStyle(g).display !== 'none'));
    assert.equal(shown, false);
  });

  await check('after a click, the keys move the cursor from there (Ctrl + End, Enter, type)', async () => {
    await fresh();
    const a = await at('Alpha');
    await p.mouse.click(a.x, a.y);
    await sleep(80); // as fast as a person: the editor settles its focus in 20 ms
    await p.keyboard.press('Control+End');
    await sleep(100);
    await p.keyboard.press('Enter');
    await p.keyboard.type('Delta');
    await sleep(200);
    const lines = (await plain()).split('\n').map((l) => l.trim());
    assert.equal(lines.at(-1), 'Delta', lines.join(' / '));
    assert.ok(lines.includes('Alpha'), lines.join(' / '));
  });

  await check('a click on a line puts the cursor where it lands', async () => {
    await fresh();
    const a = await at('Charlie');
    await p.mouse.click(a.x, a.y);
    await sleep(200);
    assert.ok((await readOutline(p)).split('\n').find((l) => l.replace('|', '') === 'Charlie')?.includes('|'), 'the cursor is in “Charlie”');
  });

  await check('a press and a drag moves a line, with a copy riding along; nothing is picked', async () => {
    await fresh();
    const from = await at('Charlie');
    const to = await at('Alpha');
    await p.mouse.move(from.x, from.y);
    await p.mouse.down();
    await p.mouse.move(from.x, to.b.y + 3, { steps: 12 });
    assert.equal(await p.locator('.line-lift').count(), 1, 'a copy rides along');
    await p.mouse.up();
    await sleep(300);
    assert.equal(await plain(), ['Charlie', 'Alpha', 'Bravo', '  Bravo kid'].join('\n'));
    assert.equal(await p.evaluate(() => String(getSelection())), '', 'no words picked');
  });

  await check('in the line you are typing in, a drag picks words', async () => {
    await fresh();
    const a = await at('Charlie');
    await p.mouse.click(a.x, a.y);
    await sleep(200);
    await p.mouse.move(a.b.x + 2, a.y);
    await p.mouse.down();
    await p.mouse.move(a.b.x + a.b.width - 2, a.y, { steps: 6 });
    await p.mouse.up();
    assert.equal(await p.evaluate(() => String(getSelection())), 'Charlie');
    assert.equal(await plain(), START.trim());
  });

  await check('held still and let go, its menu comes up; a right-click too', async () => {
    await fresh();
    const a = await at('Bravo');
    await p.mouse.move(a.x, a.y);
    await p.mouse.down();
    await sleep(600);
    await p.mouse.up();
    await menu.waitFor();
    await p.keyboard.press('Escape');
    await p.waitForSelector('.handle-menu', { state: 'detached' });
    await p.mouse.click(a.x, a.y, { button: 'right' });
    await menu.waitFor();
    await p.keyboard.press('Escape');
    await p.waitForSelector('.handle-menu', { state: 'detached' });
    assert.equal(await plain(), START.trim());
  });

  await check('the fold triangle sits at the far right of its line', async () => {
    await fresh();
    const li = p.locator('#outline-editor li', { has: p.locator(':scope > p', { hasText: /^Bravo$/ }) }).first();
    const f = await li.locator(':scope > .line-gutter .fold').boundingBox();
    const line = await li.locator(':scope > p').boundingBox();
    assert.ok(f.x + f.width >= line.x + line.width - 4, `at the right (${Math.round(f.x + f.width)} vs ${Math.round(line.x + line.width)})`);
    await li.locator(':scope > .line-gutter .fold').click();
    await p.waitForSelector('#outline-editor li.folded');
    await li.locator(':scope > .line-gutter .fold').click();
    await p.waitForFunction(() => !document.querySelector('#outline-editor li.folded'));
  });

  await check('a double-click zooms in; a line with nothing under it gets an empty line to write in', async () => {
    await fresh();
    const a = await at('Charlie');
    await p.mouse.dblclick(a.x, a.y);
    await p.waitForFunction(() => document.querySelector('#outline-editor li.zoom-root > p')?.textContent === 'Charlie');
    // The zoom's motion (280 ms) runs first: a click lands once the page is still.
    await p.waitForFunction(() => !document.documentElement.dataset.zt);
    const empty = p.locator('#outline-editor li.zoom-root > ul > li > p');
    assert.equal(await empty.count(), 1, 'one empty line under it');
    const e = await empty.boundingBox();
    await p.mouse.click(e.x + 10, e.y + e.height / 2);
    await p.keyboard.type('Charlie kid');
    await p.evaluate(() => document.activeElement?.blur());
    await p.evaluate(() => window.__outline.view.dispatch(window.__outline.state.tr.setMeta(window.__foldKey, { zoom: null })));
    await sleep(300);
    assert.equal(await plain(), ['Alpha', 'Bravo', '  Bravo kid', 'Charlie', '  Charlie kid'].join('\n'));
  });

  await check('typing straight after a double-click writes under the title, not in it', async () => {
    await fresh();
    const a = await at('Alpha');
    await p.mouse.dblclick(a.x, a.y);
    await p.waitForFunction(() => document.querySelector('#outline-editor li.zoom-root > p')?.textContent === 'Alpha');
    await sleep(100);
    await p.keyboard.type('Alpha kid');
    await p.evaluate(() => document.activeElement?.blur());
    await p.evaluate(() => window.__outline.view.dispatch(window.__outline.state.tr.setMeta(window.__foldKey, { zoom: null })));
    await sleep(300);
    assert.equal(await plain(), ['Alpha', '  Alpha kid', 'Bravo', '  Bravo kid', 'Charlie'].join('\n'));
  });

  await check('left empty, that line goes again when you zoom out', async () => {
    await fresh();
    const a = await at('Alpha');
    await p.mouse.dblclick(a.x, a.y);
    await p.waitForFunction(() => document.querySelector('#outline-editor li.zoom-root > p')?.textContent === 'Alpha');
    assert.equal(await p.locator('#outline-editor li.zoom-root > ul > li').count(), 1);
    await p.evaluate(() => window.__outline.view.dispatch(window.__outline.state.tr.setMeta(window.__foldKey, { zoom: null })));
    await sleep(300);
    assert.equal(await plain(), START.trim());
  });

  await check('zoomed back out, the page sits exactly where it was (Esc, and the mouse\'s back button)', async () => {
    const long = Array.from({ length: 70 }, (_, i) => `Line ${i + 1}${i % 7 === 3 ? `\n  Under ${i + 1}` : ''}`).join('\n');
    await setOutline(p, long);
    await p.evaluate(() => document.activeElement?.blur());
    await sleep(200);
    const top = (t) => p.evaluate((t) => [...document.querySelectorAll('#outline-editor li > p')].find((x) => x.textContent === t)?.getBoundingClientRect().top, t);
    for (const [name, out] of [['Line 46', 'esc'], ['Line 32', 'back']]) {
      await words(name).scrollIntoViewIfNeeded();
      await p.mouse.wheel(0, 120);
      await sleep(300);
      const y0 = await top(name);
      const a = await at(name);
      await p.mouse.dblclick(a.x, a.y);
      await p.waitForFunction((n) => document.querySelector('#outline-editor li.zoom-root > p')?.textContent === n, name);
      await p.waitForFunction(() => !document.documentElement.dataset.zt);
      await sleep(150);
      if (out === 'esc') { await p.evaluate(() => document.activeElement?.blur()); await p.evaluate(() => window.__outline.view.dispatch(window.__outline.state.tr.setMeta(window.__foldKey, { zoom: null }))); }
      else await p.goBack();
      await p.waitForFunction(() => !document.querySelector('#outline-editor li.zoom-root'));
      await p.waitForFunction(() => !document.documentElement.dataset.zt);
      await sleep(750); // what's above settles; the line is held where it was meanwhile
      const y1 = await top(name);
      assert.ok(Math.abs(y1 - y0) < 3, `${name} (${out}) was at ${Math.round(y0)}, came back at ${Math.round(y1)}`);
    }
  });

  await check('no page errors', async () => { assert.deepEqual(errors, []); });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\none way: all good');
process.exit(failed ? 1 : 0);
