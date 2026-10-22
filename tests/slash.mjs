// The / insert menu, Ctrl+Shift+; (time) and Ctrl+; (today), on a computer and
// on a phone (the + on the row above the keyboard).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4191;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const TIME = /\b\d{1,2}:\d{2} (am|pm)\b/;
const pad = (n) => String(n).padStart(2, '0');
const iso = (n = 0) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const browser = await chromium.launch();
const errors = [];
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 5).join('\n     ')}`); }
}
const menuShown = (p) => p.evaluate(() => !document.querySelector('.slash').hidden);
const labels = (p) => p.evaluate(() => [...document.querySelectorAll('.slash li .label')].map((l) => l.textContent));

try {
  const p = await (await browser.newContext()).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(URL);
  await p.waitForSelector('#editor .ProseMirror');
  await sleep(500);
  const ed = () => p.locator('#editor .ProseMirror');
  const clear = () => p.evaluate(() => { window.__editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }); window.__editor.commands.focus('end'); });

  await check('/ after a space opens the menu, typing narrows it, Enter puts in the time', async () => {
    await clear();
    await p.keyboard.type('Met her at /');
    await p.waitForFunction(() => !document.querySelector('.slash').hidden);
    assert.ok((await labels(p)).includes('Time'));
    assert.ok(!(await labels(p)).includes('Friday'), 'weekdays wait until something is typed');
    await p.keyboard.type('ti');
    assert.equal((await labels(p))[0], 'Time');
    await p.keyboard.press('Enter');
    assert.equal(await menuShown(p), false);
    const t = await ed().innerText();
    assert.match(t, TIME);
    assert.ok(!t.includes('/'), t);
  });

  await check('a / inside a word (and/or, 10/22) leaves the menu shut', async () => {
    await clear();
    await p.keyboard.type('this and/or that on 10/22');
    assert.equal(await menuShown(p), false);
    assert.match(await ed().innerText(), /and\/or that on 10\/22/);
  });

  await check('a space or Esc closes it and the / stays as typed', async () => {
    await clear();
    await p.keyboard.type('/ then');
    assert.equal(await menuShown(p), false);
    await p.keyboard.press('Enter');
    await p.keyboard.type('/ti');
    assert.equal(await menuShown(p), true);
    await p.keyboard.press('Escape');
    assert.equal(await menuShown(p), false);
    await p.keyboard.type('m');
    assert.equal(await menuShown(p), false, 'stays shut after Esc');
    assert.match(await ed().innerText(), /\/ then\n+\/tim/);
  });

  await check('/tomorrow puts in a link to tomorrow, which opens that day', async () => {
    await clear();
    await p.keyboard.type('Call back /tomorr');
    await p.keyboard.press('Enter');
    const id = await p.evaluate(() => document.querySelector('#editor a[data-ref]')?.getAttribute('data-ref'));
    assert.equal(id, `day-${iso(1)}`);
    await p.click('#editor a[data-ref]');
    await p.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    await p.waitForFunction((want) => window.__notebook.page?.id === want, `day-${iso(1)}`);
    await p.keyboard.press('Control+J');
    await p.waitForFunction(() => (document.documentElement.dataset.view || 'write') === 'write');
    await sleep(300);
  });

  await check('Ctrl+Shift+; puts in the time and Ctrl+; today’s date', async () => {
    await clear();
    await p.keyboard.press('Control+Shift+Semicolon');
    await p.keyboard.press('Control+Semicolon');
    assert.match(await ed().innerText(), TIME);
    const id = await p.evaluate(() => document.querySelector('#editor a[data-ref]')?.getAttribute('data-ref'));
    assert.equal(id, `day-${iso(0)}`);
  });

  await check('on the day page, /now writes the time with a line tucked under it', async () => {
    await p.keyboard.press('Control+J');
    await p.waitForFunction(() => document.querySelector('#nb-kind')?.textContent === 'Today');
    await sleep(400);
    await p.evaluate(() => { window.__notebook.editor.commands.focus('end'); });
    await p.keyboard.type('/now');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Walked the dog');
    const shape = await p.evaluate(() => {
      const lis = [...document.querySelectorAll('#outline-editor li')];
      const entry = lis.find((li) => li.querySelector(':scope > p')?.textContent === 'Walked the dog');
      return { parent: entry?.parentElement.closest('li')?.querySelector(':scope > p')?.textContent };
    });
    assert.match(shape.parent || '', /^\d{1,2}:\d{2} (am|pm)$/, JSON.stringify(shape));
  });

  // On a phone: + on the row above the keyboard opens the same menu; a tap picks.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const q = await ctx.newPage();
  q.on('pageerror', (e) => errors.push(e.message));
  await q.goto(URL);
  await q.waitForSelector('#editor .ProseMirror');
  await sleep(500);

  await check('on a phone, + opens the menu and a tap puts in the time, keyboard kept', async () => {
    await q.evaluate(() => localStorage.setItem('place', JSON.stringify({ view: 'notebook' })));
    await q.reload();
    await q.waitForSelector('#outline-editor .ProseMirror');
    await sleep(600);
    await q.evaluate(() => { window.__notebook.editor.commands.focus('end'); });
    await q.waitForFunction(() => !document.querySelector('.outline-bar').hidden);
    const plus = await q.locator('.outline-bar [data-do="insert"]').boundingBox();
    await q.touchscreen.tap(plus.x + plus.width / 2, plus.y + plus.height / 2);
    await q.waitForFunction(() => !document.querySelector('.slash').hidden);
    const item = await q.locator('.slash li', { hasText: 'Time' }).first().boundingBox();
    await q.touchscreen.tap(item.x + 20, item.y + item.height / 2);
    await sleep(200);
    assert.equal(await menuShown(q), false);
    assert.ok(await q.evaluate(() => window.__notebook.editor.isFocused), 'the text kept the caret');
    assert.match(await q.locator('#outline-editor').innerText(), TIME);
  });

  assert.deepEqual(errors, []);
} catch (e) {
  failed += 1;
  console.log(`FAIL ${e.message}`);
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all slash checks passed');
