// Search inside the writing (Ctrl+Shift+F), the Library's sort, and the
// sidebar's way to every loose page.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4187;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);

const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 1300, height: 850 } })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const results = () => p.locator('#palette-list li').allInnerTexts();
const search = async (q) => {
  await sleep(200);
  await p.keyboard.press('Control+Shift+F');
  await p.waitForSelector('.palette', { state: 'visible' });
  await p.waitForFunction(() => document.activeElement?.id === 'palette-input');
  await p.keyboard.type(q);
  await p.waitForFunction((t) => document.querySelector('#palette-input').value === t, q);
  // The index is built when search opens; wait for it rather than a fixed time.
  await p.waitForFunction(() => !document.querySelector('#palette-list')?.textContent.includes('Looking…'));
  await sleep(150);
};
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 4).join('\n     ')}`); }
}

try {
  await p.goto(`http://localhost:${PORT}/`);
  await p.waitForSelector('#editor .ProseMirror');
  await sleep(400);
  await p.locator('#editor .ProseMirror').click();
  await p.keyboard.type('The lighthouse keeper counted the ships.');
  await p.keyboard.press('Enter');
  await p.keyboard.type('Later, at the café, Mara wrote the letter.');
  await p.keyboard.press('Alt+N');
  await sleep(300);
  await p.keyboard.type('Check the harbour tide tables');
  await sleep(600);
  await p.locator('#editor .ProseMirror p').first().click();
  await p.keyboard.press('Control+J');
  await p.waitForSelector('#outline-editor .ProseMirror-focused');
  await sleep(500); // the day page grabs focus back once it has loaded
  await p.keyboard.type('Phone the archivist about the lighthouse logbooks');
  await p.waitForFunction(() => document.querySelector('#outline-editor').textContent.includes('lighthouse logbooks'));
  await sleep(800);

  await check('finds words in a chapter, a daily page and a note, in any order and without accents', async () => {
    await search('lighthouse');
    const r = await results();
    assert.equal(r.length, 2, r.join(' | '));
    assert.ok(r.some((x) => /lighthouse keeper/.test(x) && /Chapter 1/.test(x)), r.join(' | '));
    assert.ok(r.some((x) => /archivist/.test(x)), r.join(' | '));
    await p.keyboard.press('Escape');
    await search('cafe mara');
    assert.match((await results())[0], /at the café, Mara/);
    await p.keyboard.press('Escape');
    await search('tide harbour');
    assert.match((await results())[0], /Note/);
    await p.keyboard.press('Escape');
    await search('zebra');
    assert.match((await results())[0], /Nothing found/);
    await p.keyboard.press('Escape');
  });

  await check('a result opens where it lives, with the caret on it', async () => {
    await search('mara letter');
    await p.keyboard.press('Enter');
    await sleep(600);
    assert.equal(await p.evaluate(() => document.documentElement.dataset.view || 'write'), 'write');
    const para = await p.evaluate(() => window.__editor.state.selection.$from.parent.textContent);
    assert.match(para, /Mara wrote the letter/);
  });

  await check('Ctrl+O offers to search inside the writing when no title matches', async () => {
    await p.keyboard.press('Control+O');
    await sleep(300);
    await p.keyboard.type('keeper');
    await sleep(300);
    const r = await results();
    assert.match(r.at(-1), /Search inside your writing for “keeper”/);
    await p.keyboard.press('Enter');
    await sleep(500);
    assert.match((await results())[0], /lighthouse keeper/);
    await p.keyboard.press('Escape');
  });

  await check('the Trash is left out of search', async () => {
    const book = await p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('writing');
      r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result.find((e) => e.kind === 'project')); };
    }));
    await p.evaluate((id) => window.dispatchEvent(new PopStateEvent('popstate', { state: { view: 'world', id } })), book.parent_id);
    await sleep(500);
    await p.locator('#wh-more .more-btn').click();
    await p.locator('.pop-menu button', { hasText: 'Move to Trash' }).click();
    await p.locator('.ask .pill', { hasText: 'Move to Trash' }).click();
    await sleep(600);
    await search('lighthouse');
    const r = await results();
    assert.equal(r.length, 1, r.join(' | '));
    assert.match(r[0], /archivist/);
    await p.keyboard.press('Escape');
  });

  await check('the Library sorts by title, and the sidebar reaches every loose page', async () => {
    await p.evaluate(async () => {
      const r = indexedDB.open('writing');
      await new Promise((res) => { r.onsuccess = res; });
      const tx = r.result.transaction('entries', 'readwrite');
      const now = Date.now();
      for (const [i, t] of ['Zephyr', 'Anchor', 'Moss'].entries()) tx.objectStore('entries').put({ id: `pr_t${i}`, kind: 'project', title: t, area_id: 'area-writing', parent_id: null, sort: 0, text: '', content: null, tags: [], type: null, fields: { type: 'notes' }, links: [], deleted: false, created_at: now + i, updated_at: now - i * 1000 });
      for (let i = 0; i < 15; i++) tx.objectStore('entries').put({ id: `pg_l${i}`, kind: 'page', title: `Loose ${i}`, parent_id: null, area_id: null, sort: 0, text: '', content: null, tags: [], type: null, fields: {}, links: [], deleted: false, created_at: now, updated_at: now - i });
      await new Promise((res) => { tx.oncomplete = res; });
    });
    await p.reload();
    await p.waitForSelector('#editor .ProseMirror', { state: 'attached' });
    await sleep(600);
    await p.keyboard.press('Control+Shift+O');
    await sleep(400);
    assert.deepEqual(await p.locator('#lib-books .card-title').allInnerTexts(), ['Zephyr', 'Anchor', 'Moss']);
    await p.locator('#lib-sort').selectOption('title');
    await sleep(300);
    assert.deepEqual(await p.locator('#lib-books .card-title').allInnerTexts(), ['Anchor', 'Moss', 'Zephyr']);
    assert.match(await p.locator('#outline-tree .tree-more').innerText(), /All 15 loose pages/);
  });

  await check('My order: dragging a card or Move earlier puts books where you want them, and it sticks', async () => {
    await p.locator('#lib-sort').selectOption('custom');
    await sleep(300);
    const titles = () => p.locator('#lib-books .card-title').allInnerTexts();
    assert.deepEqual(await titles(), ['Zephyr', 'Anchor', 'Moss']);
    await p.locator('.card-wrap', { hasText: 'Moss' }).locator('.card').dragTo(p.locator('.card-wrap', { hasText: 'Zephyr' }), { targetPosition: { x: 10, y: 40 } });
    await sleep(500);
    assert.deepEqual(await titles(), ['Moss', 'Zephyr', 'Anchor']);
    await p.locator('.card-wrap', { hasText: 'Anchor' }).hover();
    await p.locator('.card-wrap', { hasText: 'Anchor' }).locator('.more-btn').click();
    await p.locator('.pop-menu button', { hasText: 'Move earlier' }).click();
    await sleep(500);
    assert.deepEqual(await titles(), ['Moss', 'Anchor', 'Zephyr']);
    await p.reload();
    await p.waitForSelector('#editor .ProseMirror', { state: 'attached' });
    await sleep(600);
    await p.keyboard.press('Control+Shift+O');
    await sleep(400);
    assert.deepEqual(await titles(), ['Moss', 'Anchor', 'Zephyr']);
  });

  await check('no page errors', async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
