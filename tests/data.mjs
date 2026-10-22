// Checks for the data underneath: ordering, link names after a rename, the
// "two versions" screen, the whole-vault backup, and forgetting old deletions.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(`${process.execPath.replace(/bin\/node$/, '')}lib/node_modules/playwright`)); }

const PORT = 4181;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));

const all = (store = 'entries') => p.evaluate((s) => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); };
}), store);
const put = (store, rows) => p.evaluate(([s, rs]) => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const tx = r.result.transaction(s, 'readwrite'); for (const x of rs) tx.objectStore(s).put(x); tx.oncomplete = () => res(); };
}), [store, rows]);
const paras = async () => (await all()).filter((e) => e.kind === 'para' && !e.deleted);
const command = async (name) => {
  await p.keyboard.press('Control+K');
  await p.keyboard.type(name);
  await sleep(200);
  await p.keyboard.press('Enter');
};
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

try {
  await p.goto(`http://localhost:${PORT}/`);
  await p.waitForSelector('#editor .ProseMirror');

  await check('moving a paragraph rewrites only that paragraph', async () => {
    await p.locator('#editor .ProseMirror').click();
    for (const t of ['First.', 'Second.', 'Third.']) { await p.keyboard.type(t); await p.keyboard.press('Enter'); }
    await p.keyboard.press('Backspace');
    await sleep(800);
    const before = new Map((await paras()).map((e) => [e.id, e.updated_at]));
    assert.equal(before.size, 3);
    await p.keyboard.press('Alt+Shift+ArrowUp');
    await p.keyboard.press('Alt+Shift+ArrowUp');
    await sleep(800);
    assert.match(await p.locator('#editor .ProseMirror').innerText(), /^Third\.\s+First\.\s+Second\./);
    const after = await paras();
    const changed = after.filter((e) => e.updated_at !== before.get(e.id));
    assert.equal(changed.length, 1, 'only one paragraph rewritten');
    assert.equal(changed[0].text, 'Third.');
    await p.reload();
    await p.waitForSelector('#editor .ProseMirror');
    await sleep(400);
    assert.match(await p.locator('#editor .ProseMirror').innerText(), /^Third\.\s+First\.\s+Second\./);
  });

  await check('renaming a page updates the links to it', async () => {
    await p.keyboard.press('Control+J');
    await p.waitForSelector('#outline-editor .ProseMirror-focused');
    await p.keyboard.type('See [[');
    await p.waitForSelector('.picker', { state: 'visible' });
    // On a slow machine the picker can show a moment before its box has the caret.
    await p.waitForFunction(() => document.activeElement === document.querySelector('.picker input'));
    await p.keyboard.type('Harbour');
    // Under load the list can lag the typing; wait until the list has caught up.
    await p.waitForFunction(() => /Harbour/.test(document.querySelector('.picker li[aria-selected="true"]')?.textContent || ''));
    await p.keyboard.press('Enter');
    await p.waitForSelector('#outline-editor a.ref');
    await sleep(300);
    await p.locator('#outline-editor a.ref').click();
    await sleep(500);
    assert.equal(await p.locator('#nb-title').innerText(), 'Harbour');
    await p.locator('#nb-title').click();
    await p.keyboard.press('End');
    await p.keyboard.type(' office');
    await p.keyboard.press('Enter');
    await sleep(800);
    const line = (await all()).find((e) => e.kind === 'line' && e.links?.length);
    assert.equal(line.content.find((n) => n.type === 'entryRef').attrs.title, 'Harbour office');
    assert.match(line.text, /Harbour office/);
    await command('Today');
    await sleep(600);
    assert.equal(await p.locator('#outline-editor a.ref').innerText(), 'Harbour office');
  });

  await check('a paragraph changed on two devices can be settled on the two versions screen', async () => {
    await p.keyboard.press('Control+J');
    await sleep(400);
    const first = (await paras()).find((e) => e.text === 'First.');
    await put('conflicts', [{ ...first, text: 'First, from the phone.', content: [{ type: 'text', text: 'First, from the phone.' }], saved_at: Date.now() }]);
    await p.reload();
    await p.waitForSelector('#versions', { state: 'visible' });
    assert.equal(await p.locator('#versions').innerText(), '1 to check');
    await p.locator('#versions').click();
    await p.waitForSelector('.versions-pair');
    const panel = await p.locator('.versions').innerText();
    assert.match(panel, /On this device[\s\S]*First\.[\s\S]*From the other device[\s\S]*First, from the phone\./i);
    await p.locator('.versions button', { hasText: 'Use the other' }).click();
    await sleep(300);
    assert.equal(await p.locator('#versions').isVisible(), false);
    await p.keyboard.press('Escape');
    await sleep(1200);
    assert.match(await p.locator('#editor .ProseMirror').innerText(), /First, from the phone\./i);
    assert.equal((await all('conflicts')).length, 0);
  });

  await check('everything downloads as one backup of plain files', async () => {
    const [download] = await Promise.all([p.waitForEvent('download'), command('Back up everything')]);
    assert.match(download.suggestedFilename(), /^Inkwell vault \d{4}-\d\d-\d\d\.zip$/);
    const buf = await readFile(await download.path());
    assert.equal(buf.readUInt32LE(0), 0x04034b50, 'a zip file');
    const s = buf.toString('utf8');
    assert.ok(s.includes('vault.json'));
    assert.ok(s.includes('Loose pages/Harbour office.md'));
    assert.ok(/Daily pages\/\d{4}-\d\d-\d\d\.md/.test(s));
    assert.ok(/Library\/No area\/Untitled novel\/Untitled novel\.md|Library\/[^\n]*\.md/.test(s));
    assert.ok(s.includes('- See [[Harbour office]]'));
    assert.ok(s.includes('Third.'));
  });

  await check('old deletions are forgotten once the cloud has them', async () => {
    await put('entries', [
      { id: 'old_sent', kind: 'para', parent_id: 'x', sort: 1, deleted: true, updated_at: 1000, created_at: 1000, tags: [], links: [] },
      { id: 'old_unsent', kind: 'para', parent_id: 'x', sort: 2, deleted: true, updated_at: 1000, created_at: 1000, tags: [], links: [] }
    ]);
    await put('outbox', [{ id: 'old_unsent' }]);
    // As on a device whose clean-up hasn't run yet.
    await put('meta', [{ key: 'forgotThrough', value: 0 }]);
    await p.reload();
    await p.waitForSelector('#editor .ProseMirror');
    await sleep(800);
    let ids = (await all()).map((e) => e.id);
    assert.ok(!ids.includes('old_sent'));
    assert.ok(ids.includes('old_unsent'));
    // Once it's sent, the next pass forgets it too.
    await p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('writing');
      r.onsuccess = () => { const tx = r.result.transaction('outbox', 'readwrite'); tx.objectStore('outbox').delete('old_unsent'); tx.oncomplete = () => res(); };
    }));
    await p.reload();
    await p.waitForSelector('#editor .ProseMirror');
    await sleep(800);
    ids = (await all()).map((e) => e.id);
    assert.ok(!ids.includes('old_unsent'));
  });

  await check('a paragraph sent to today becomes a line there, keeping its id', async () => {
    if (await p.evaluate(() => document.documentElement.dataset.view)) await p.keyboard.press('Control+J');
    await p.waitForSelector('#editor .ProseMirror', { state: 'visible' });
    await p.locator('#editor .ProseMirror p').last().click();
    await p.keyboard.press('End');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Send me to the notebook.');
    await sleep(800);
    const before = (await paras()).find((e) => e.text === 'Send me to the notebook.');
    await command('Send selection to');
    await sleep(400);
    await p.keyboard.type('Today');
    await sleep(300);
    await p.keyboard.press('Enter');
    await sleep(1000);
    const now = (await all()).find((e) => e.id === before.id);
    assert.equal(now.kind, 'line');
    assert.equal(now.deleted, false);
    assert.match(now.parent_id, /^day-/);
    assert.doesNotMatch(await p.locator('#editor .ProseMirror').innerText(), /Send me to the notebook/);
  });

  await check('a line with lines under it sent to a chapter becomes paragraphs in order', async () => {
    await p.keyboard.press('Control+J');
    await p.waitForSelector('#outline-editor .ProseMirror', { state: 'visible' });
    await sleep(400);
    assert.match(await p.locator('#outline-editor').innerText(), /Send me to the notebook/);
    await p.locator('#outline-editor li').last().click();
    await p.keyboard.press('End');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Parent line');
    await p.keyboard.press('Enter');
    await p.keyboard.press('Tab');
    await p.keyboard.type('Child line');
    await sleep(800);
    await p.locator('#outline-editor p', { hasText: 'Parent line' }).click();
    const chapter = (await all()).find((e) => e.kind === 'chapter' && !e.deleted);
    await command('Send selection to');
    await sleep(400);
    await p.keyboard.type(chapter.title);
    await sleep(300);
    await p.keyboard.press('Enter');
    await sleep(1200);
    const rows = await all();
    const parent = rows.find((e) => e.text === 'Parent line');
    const child = rows.find((e) => e.text === 'Child line');
    assert.equal(parent.kind, 'para');
    assert.equal(child.kind, 'para');
    assert.equal(parent.parent_id, chapter.id);
    assert.equal(child.parent_id, chapter.id);
    assert.ok(parent.sort < child.sort, 'parent comes first');
    assert.ok(!parent.deleted && !child.deleted);
    assert.doesNotMatch(await p.locator('#outline-editor').innerText(), /Parent line/);
    await p.keyboard.press('Control+J');
    await p.waitForSelector('#editor .ProseMirror', { state: 'visible' });
    await sleep(800);
    assert.match(await p.locator('#editor .ProseMirror').innerText(), /Parent line\s+Child line/);
  });

  await check('no page errors', async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
