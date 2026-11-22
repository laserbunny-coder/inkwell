// Folding keeps the screen still (Nov 22 2026): a scene's plan, a scene's
// notes and a novel's scene break unfold under their line without moving it,
// and fold away the same way, even at the very end of a long script where the
// page gets shorter (it used to pull the page down: "when it collapses, it's
// moving"). Desktop and phone.
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
    const at = (e.stack || '').split('\n').find((l) => l.includes('steady.mjs')) || '';
    console.log(`FAIL ${name}\n     ${e.message}\n     ${at.trim()}`);
  }
}

const PORT = 4197;
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
// A new piece of its own kind, open on its first chapter.
async function newPiece(kind, title, chapter) {
  await run(kind);
  await p.waitForSelector('#lib-new', { state: 'visible' });
  await p.fill('#lib-new-title', title);
  await p.keyboard.press('Enter');
  await sleep(900);
  await p.keyboard.press('Control+O');
  await p.waitForFunction(() => document.activeElement?.id === 'palette-input');
  await p.locator('#palette-input').fill(`${chapter} · ${title}`);
  await p.waitForFunction((t) => document.querySelector('.palette[data-loaded]') && new RegExp(`^${t}`).test(document.querySelector('#palette-list li.box-row')?.textContent || ''), chapter);
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelectorAll('#editor .ProseMirror > *').length > 0);
  await sleep(400);
}
// A long script: six scenes of six lines, written straight into the editor.
async function longScript() {
  await p.evaluate(() => {
    const ed = window.__editor;
    const { schema } = ed.state;
    const nodes = [];
    for (let s = 0; s < 6; s++) {
      nodes.push(schema.nodes.paragraph.create({ el: 'scene' }, schema.text(`INT. ROOM ${s + 1} - DAY`)));
      for (let i = 0; i < (s === 5 ? 1 : 6); i++) nodes.push(schema.nodes.paragraph.create({ el: 'action' }, schema.text(`Scene ${s + 1}, line ${i + 1}: Kenji counts the coins on the counter again, slowly, one by one.`)));
    }
    ed.view.dispatch(ed.state.tr.replaceWith(0, ed.state.doc.content.size, nodes));
  });
  await p.waitForFunction(() => document.querySelectorAll('.wv-line').length >= 6);
  await sleep(400);
}
const topOf = (sel) => p.locator(sel).evaluate((e) => e.getBoundingClientRect().top);
// A click where the line is now, without scrolling it into view first.
async function press(sel) {
  const b = await p.locator(sel).boundingBox();
  if (p.__touch) await p.touchscreen.tap(b.x + b.width / 2, b.y + Math.min(b.height / 2, 10));
  else await p.mouse.click(b.x + b.width / 2, b.y + Math.min(b.height / 2, 10));
}
async function stays(sel, act, label) {
  const before = await topOf(sel);
  await act();
  await sleep(900); // past the settling
  const after = await topOf(sel);
  assert.ok(Math.abs(after - before) < 2, `${label}: moved ${Math.round(after - before)}px`);
}

try {
  p = await open({ viewport: { width: 1280, height: 800 } });

  await check('desktop: the last scene’s plan unfolds and folds at the very end of the page, and its line stays put', async () => {
    await newPiece('New screenplay', 'Rent Day', 'Script');
    await longScript();
    const last = '.wv-line >> nth=-1';
    const zone = '.wv-line >> nth=-1 >> .wv-zone.m';
    await p.evaluate(() => window.scrollTo(0, 1e6)); await sleep(300);
    await stays(last, () => press(zone), 'unfold');
    assert.equal(await p.locator('.wv-line').last().locator('.wv-plan').count(), 1);
    // At the very bottom with the plan open, then fold it: the page gets shorter.
    await p.evaluate(() => window.scrollTo(0, 1e6)); await sleep(300);
    await stays(last, () => press(zone), 'fold');
    assert.equal(await p.locator('.wv-line').last().locator('.wv-plan').count(), 0);
  });

  await check('desktop: the notes at the right end fold away the same way', async () => {
    const last = '.wv-line >> nth=-1';
    const zone = '.wv-line >> nth=-1 >> .wv-zone.r';
    await press(zone);
    await p.waitForSelector('.wv-line:last-child .wv-notes, .wv-notes', { state: 'attached' });
    await p.evaluate(() => window.scrollTo(0, 1e6)); await sleep(300);
    await stays(last, () => press(zone), 'fold the notes');
  });

  await check('desktop: the room left at the bottom goes once you scroll up', async () => {
    await p.mouse.wheel(0, -2000);
    await sleep(400);
    assert.equal(await p.locator('#editor .ProseMirror').evaluate((e) => e.style.marginBottom), '');
  });

  await check('a novel: a scene break near the end folds its plan without moving', async () => {
    await newPiece('New novel', 'Fog Town', 'Chapter 1');
    await p.locator('#editor .ProseMirror').click();
    for (let i = 0; i < 14; i++) { await p.keyboard.type(`Paragraph ${i + 1}. The fog came in off the harbour and stayed for days, thick enough to lean on.`); await p.keyboard.press('Enter'); }
    await p.keyboard.type('# ');
    await p.waitForFunction(() => document.activeElement?.matches('.nv-plan .wv-p-title'));
    await p.keyboard.type('The lighthouse');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => window.__editor.isFocused);
    for (let i = 0; i < 1; i++) { await p.keyboard.type(`After ${i + 1}. The lamp turns.`); await p.keyboard.press('Enter'); }
    await sleep(500);
    const brk = '#editor .scene-break >> nth=-1';
    await p.evaluate(() => window.scrollTo(0, 1e6)); await sleep(300);
    assert.equal(await p.locator('.nv-plan').count(), 1);
    await stays(brk, async () => { const b = await p.locator(brk).boundingBox(); await p.mouse.click(b.x + 4, b.y + 4); }, 'fold the break');
    assert.equal(await p.locator('.nv-plan').count(), 0);
    await p.evaluate(() => window.scrollTo(0, 1e6)); await sleep(300);
    await stays(brk, async () => { const b = await p.locator(brk).boundingBox(); await p.mouse.click(b.x + 4, b.y + 4); }, 'unfold the break');
    assert.equal(await p.locator('.nv-plan').count(), 1);
  });

  await check('phone: a tap folds the last scene’s plan at the end of the page, and the line stays put', async () => {
    p = await open({ ...devices['Pixel 7'] });
    p.__touch = true;
    await newPiece('New screenplay', 'Pocket Show', 'Script');
    await longScript();
    // Writing at the end, as you would be: the caret in the last line.
    const last = '.wv-line >> nth=-1';
    const zone = '.wv-line >> nth=-1 >> .wv-zone.m';
    await p.evaluate(() => window.scrollTo(0, 1e6)); await sleep(300);
    await stays(last, () => press(zone), 'unfold');
    await p.evaluate(() => window.scrollTo(0, 1e6)); await sleep(300);
    await stays(last, () => press(zone), 'fold');
    assert.equal(await p.locator('.wv-line').last().locator('.wv-plan').count(), 0);
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
console.log(failed ? `\n${failed} failed` : '\nsteady folding: all passed');
process.exit(failed ? 1 : 0);
