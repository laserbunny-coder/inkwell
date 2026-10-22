// On a phone with the keyboard up, the caret stays put while you type: a tap
// may bring it clear of the keyboard once, and typing never throws the page
// around. The keyboard is stood in for by a smaller visual viewport.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4190;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const SCREEN = 800;
const KEYBOARD = 340;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: SCREEN }, hasTouch: true, isMobile: true });
// A keyboard 340px tall: what's visible ends above it, as Chrome on Android reports.
await ctx.addInitScript(([screen, keyboard]) => {
  const vv = new EventTarget();
  Object.assign(vv, { width: 390, height: screen - keyboard, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { value: vv });
}, [SCREEN, KEYBOARD]);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 5).join('\n     ')}`); }
}
const caretY = (ed) => p.evaluate((which) => {
  const e = which === 'nb' ? window.__notebook.editor : window.__editor;
  return Math.round(e.view.coordsAtPos(e.state.selection.head).top);
}, ed);
const visibleBottom = SCREEN - KEYBOARD;

try {
  await p.goto(URL);
  await p.waitForSelector('#editor .ProseMirror');
  await sleep(500);

  await check('in a chapter, typing keeps the caret where the tap put it', async () => {
    await p.evaluate(() => {
      const ps = Array.from({ length: 80 }, (_, k) => ({ type: 'paragraph', content: [{ type: 'text', text: `Paragraph ${k + 1}, long enough to wrap onto a second row on a phone.` }] }));
      window.__editor.commands.setContent({ type: 'doc', content: ps }, { emitUpdate: true });
      window.__editor.commands.blur();
    });
    await sleep(300);
    // A paragraph about two thirds of the way down what's visible.
    const target = await p.evaluate((y) => {
      const ps = [...document.querySelectorAll('#editor .ProseMirror p')];
      window.scrollTo(0, ps[40].getBoundingClientRect().top + window.scrollY - y);
      return 40;
    }, 260);
    await sleep(200);
    const box = await p.locator('#editor .ProseMirror p').nth(target).boundingBox();
    await p.touchscreen.tap(box.x + 40, box.y + 6);
    await sleep(500);
    const afterTap = await caretY('ed');
    assert.ok(afterTap > 40 && afterTap < visibleBottom - 40, `after the tap the caret is at ${afterTap}px`);
    for (const k of ' and more words') { await p.keyboard.type(k); await sleep(30); }
    await sleep(400);
    const afterTyping = await caretY('ed');
    assert.ok(Math.abs(afterTyping - afterTap) < 40, `the caret moved from ${afterTap}px to ${afterTyping}px while typing`);
  });

  await check('on the day page, typing in the middle keeps the caret still', async () => {
    await p.keyboard.press('Control+J');
    await p.waitForFunction(() => document.querySelector('#nb-kind')?.textContent === 'Today');
    await p.evaluate(() => {
      const li = (k) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Line ${k + 1} of the day, with a few words more to wrap.` }] }] });
      window.__notebook.editor.commands.setContent({ type: 'doc', content: [{ type: 'bulletList', content: Array.from({ length: 70 }, (_, k) => li(k)) }] }, { emitUpdate: true });
      window.__notebook.editor.commands.blur();
    });
    await sleep(400);
    await p.evaluate((y) => {
      const ps = [...document.querySelectorAll('#outline-editor li > p')];
      window.scrollTo(0, ps[35].getBoundingClientRect().top + window.scrollY - y);
    }, 300);
    await sleep(200);
    const box = await p.locator('#outline-editor li > p').nth(35).boundingBox();
    await p.touchscreen.tap(box.x + 40, box.y + 6);
    await sleep(500);
    const afterTap = await caretY('nb');
    assert.ok(afterTap > 40 && afterTap < visibleBottom - 40, `after the tap the caret is at ${afterTap}px`);
    for (const k of ' then a space') { await p.keyboard.type(k); await sleep(30); }
    await sleep(400);
    const afterTyping = await caretY('nb');
    assert.ok(Math.abs(afterTyping - afterTap) < 40, `the caret moved from ${afterTap}px to ${afterTyping}px while typing`);
  });

  await check('a caret tapped low still comes up clear of the keyboard row', async () => {
    const bar = await p.locator('.outline-bar').boundingBox();
    const box = await p.evaluate((floor) => {
      const ps = [...document.querySelectorAll('#outline-editor li > p')];
      const low = ps.find((x) => x.getBoundingClientRect().top > floor - 30);
      const r = low.getBoundingClientRect();
      return { x: r.left, y: r.top };
    }, bar.y);
    await p.touchscreen.tap(box.x + 40, box.y + 6);
    await sleep(500);
    const y = await caretY('nb');
    const barNow = await p.locator('.outline-bar').boundingBox();
    assert.ok(y < barNow.y - 20, `caret at ${y}px, row at ${Math.round(barNow.y)}px`);
    await p.keyboard.type(' x');
    await sleep(400);
    const y2 = await caretY('nb');
    assert.ok(Math.abs(y2 - y) < 40, `the caret moved from ${y}px to ${y2}px while typing`);
  });

  await check('no page errors', async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
