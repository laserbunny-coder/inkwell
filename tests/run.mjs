// End-to-end checks in a real browser: writing is saved, survives a reload and
// a crash, paragraphs become entries, notes and history work.
// Run: npm run build && npm test
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(`${process.execPath.replace(/bin\/node$/, '')}lib/node_modules/playwright`)); }

const PORT = 4179;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const entries = () => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => {
    const q = r.result.transaction('entries').objectStore('entries').getAll();
    q.onsuccess = () => res(q.result);
  };
}));
const text = () => page.locator('#editor .ProseMirror').innerText();
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

try {
  await page.goto(URL);
  await page.waitForSelector('#editor .ProseMirror');

  await check('typing is saved as paragraph entries with stable ids and tags', async () => {
    await page.keyboard.type('The logbook was heavier than she expected. #lighthouse');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Her brother wrote it.');
    await sleep(800);
    const paras = (await entries()).filter((e) => e.kind === 'para' && !e.deleted);
    assert.equal(paras.length, 2);
    assert.ok(paras.every((p) => p.id.startsWith('pa_')));
    assert.notEqual(paras[0].id, paras[1].id);
    assert.deepEqual(paras.find((p) => p.text.includes('logbook')).tags, ['lighthouse']);
    assert.equal(await page.locator('#status').innerText(), 'Saved');
  });

  await check('text survives a reload', async () => {
    await page.reload();
    await page.waitForSelector('#editor .ProseMirror');
    await sleep(300);
    assert.match(await text(), /heavier than she expected[\s\S]*Her brother wrote it\./);
  });

  await check('paragraph ids stay the same across reloads and edits', async () => {
    const before = (await entries()).filter((e) => e.kind === 'para' && !e.deleted).map((e) => e.id).sort();
    await page.locator('#editor .ProseMirror p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Salt.');
    await sleep(800);
    const after = (await entries()).filter((e) => e.kind === 'para' && !e.deleted).map((e) => e.id).sort();
    assert.deepEqual(after, before);
  });

  await check('a crash before the save lands is recovered from the write-ahead copy', async () => {
    await page.locator('#editor .ProseMirror p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Unsaved words.');
    // Simulate the tab dying before IndexedDB finished: grab the write-ahead copy, then hard-reload without the debounce firing.
    const wal = await page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith('wal:')));
    assert.ok(wal, 'write-ahead copy exists while typing');
    const walValue = await page.evaluate((k) => localStorage.getItem(k), wal);
    const fresh = await ctx.newPage();
    await page.close();
    await fresh.goto('about:blank');
    await fresh.goto(URL);
    await fresh.evaluate(([k, v]) => localStorage.setItem(k, v), [wal, walValue]);
    await fresh.reload();
    await fresh.waitForSelector('#editor .ProseMirror');
    await sleep(800);
    assert.match(await fresh.locator('#editor .ProseMirror').innerText(), /Unsaved words\./);
    globalThis.p2 = fresh;
  });

  const p = globalThis.p2 || page;
  p.on('pageerror', (e) => errors.push(e.message));

  await check('scene break becomes a scene entry and shows in the outline', async () => {
    await p.locator('#editor .ProseMirror p').last().click();
    await p.keyboard.press('End');
    await p.keyboard.press('Enter');
    await p.keyboard.press('Control+Shift+Enter');
    await p.keyboard.type('Next morning.');
    await sleep(800);
    const all = await p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('writing');
      r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
    }));
    assert.equal(all.filter((e) => e.kind === 'scene' && !e.deleted).length, 1);
    await p.keyboard.press('Control+1');
    await sleep(500);
    assert.equal(await p.locator('.tree-scene').count(), 1);
    await p.keyboard.press('Control+1');
  });

  await check('a note attaches to its paragraph as its own entry', async () => {
    await sleep(400);
    await p.locator('#editor .ProseMirror p').first().click();
    await p.keyboard.press('Control+Shift+N');
    await sleep(300);
    await p.keyboard.type('Macro insert on the handwriting #props');
    await sleep(800);
    const all = await p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('writing');
      r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
    }));
    const note = all.find((e) => e.kind === 'note');
    const first = await p.locator('#editor .ProseMirror p').first().getAttribute('data-eid');
    assert.equal(note.parent_id, first);
    assert.deepEqual(note.tags, ['props']);
    const box = await p.locator('.note').boundingBox();
    const para = await p.locator('#editor .ProseMirror p').first().boundingBox();
    assert.ok(Math.abs(box.y - para.y) < 4, `note top ${box.y} vs paragraph top ${para.y}`);
  });

  await check('command menu opens and runs commands', async () => {
    await p.locator('#editor .ProseMirror p').first().click();
    await p.keyboard.press('Control+K');
    assert.equal(await p.locator('.palette').isVisible(), true);
    await p.keyboard.type('new chapter');
    await p.keyboard.press('Enter');
    await sleep(800);
    assert.equal(await p.locator('#chapter-title').innerText(), 'Chapter 2');
  });

  await check('earlier versions are kept and can be restored', async () => {
    await p.keyboard.type('First draft line.');
    await sleep(4800);
    await p.keyboard.press('Control+A');
    await p.keyboard.type('Rewritten.');
    await sleep(4800);
    await p.keyboard.press('Control+Shift+H');
    await sleep(500);
    const n = await p.locator('#history-list button').count();
    assert.ok(n >= 2, `expected 2+ versions, got ${n}`);
    await p.locator('#history-list button').nth(1).click();
    await p.locator('#history-restore').click();
    await sleep(800);
    assert.match(await p.locator('#editor .ProseMirror').innerText(), /First draft line\./);
  });

  await check('page width and text size change and stick after reload', async () => {
    await p.keyboard.press('Escape');
    await p.locator('#editor .ProseMirror p').first().click();
    const width = () => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--page-width').trim() || '660px');
    assert.equal(await width(), '660px');
    await p.keyboard.press('Alt+BracketRight');
    await p.keyboard.press('Alt+Equal');
    await sleep(400);
    assert.equal(await width(), '700px');
    await p.reload();
    await p.waitForSelector('#editor .ProseMirror');
    assert.equal(await p.locator('#editor .ProseMirror').evaluate((el) => getComputedStyle(el).fontSize), '22px');
    assert.equal(await width(), '700px');
  });

  const all = () => p.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('writing');
    r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
  }));
  const outlineText = () => p.locator('#outline-editor .ProseMirror').innerText();

  await check('today’s page: nested lines are saved as linked entries', async () => {
    await p.keyboard.press('Control+J');
    await p.waitForSelector('#outline-editor .ProseMirror-focused');
    await sleep(300);
    assert.equal(await p.locator('#nb-kind').innerText(), 'TODAY');
    await p.keyboard.type('Call the harbourmaster #research');
    await p.keyboard.press('Enter');
    await p.keyboard.press('Tab');
    await p.keyboard.type('Ask about the 1912 storm');
    await p.keyboard.press('Enter');
    await p.keyboard.type('See [[');
    await p.waitForSelector('.picker', { state: 'visible' });
    await p.keyboard.type('Lighthouse keeper');
    await p.keyboard.press('Enter');
    await sleep(800);
    const rows = await all();
    const lines = rows.filter((e) => e.kind === 'line' && !e.deleted);
    const day = rows.find((e) => e.kind === 'day');
    const page = rows.find((e) => e.kind === 'page' && e.title === 'Lighthouse keeper');
    assert.ok(day && page, 'day and page saved');
    const top = lines.find((l) => l.text.startsWith('Call'));
    const storm = lines.find((l) => l.text.startsWith('Ask'));
    const see = lines.find((l) => l.text.startsWith('See'));
    assert.equal(top.parent_id, day.id);
    assert.equal(storm.parent_id, top.id);
    assert.equal(see.parent_id, top.id);
    assert.deepEqual(top.tags, ['research']);
    assert.deepEqual(see.links, [page.id]);
    assert.match(see.text, /Lighthouse keeper/);
    await p.waitForFunction(() => document.querySelector('#shelves-tags').innerText.includes('#research'), null, { timeout: 3000 });
  });

  await check('a link opens its page, which shows where it was linked from', async () => {
    await p.locator('#outline-editor a.ref').click();
    await sleep(500);
    assert.equal(await p.locator('#nb-title').innerText(), 'Lighthouse keeper');
    await p.waitForSelector('.backlinks', { state: 'visible' });
    assert.match(await p.locator('#backlinks-list').innerText(), /See Lighthouse keeper/);
    await p.keyboard.type('Keeps the log in pencil');
    await sleep(700);
    await p.locator('#backlinks-list button').first().click();
    await sleep(500);
    assert.equal(await p.locator('#nb-kind').innerText(), 'TODAY');
    assert.match(await outlineText(), /Ask about the 1912 storm/);
  });

  await check('the notebook survives a reload and ⌘J goes back to writing', async () => {
    await p.reload();
    await p.waitForSelector('#outline-editor .ProseMirror');
    await sleep(500);
    assert.equal(await p.locator('.notebook').isVisible(), true);
    assert.match(await outlineText(), /Call the harbourmaster[\s\S]*Ask about the 1912 storm[\s\S]*See Lighthouse keeper/);
    await p.keyboard.press('Control+J');
    await sleep(300);
    assert.equal(await p.locator('.page').isVisible(), true);
    assert.equal(await p.locator('.notebook').isVisible(), false);
  });

  await check('no page errors', async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
