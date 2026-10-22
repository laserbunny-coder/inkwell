// Send a line to Daybook: Ctrl + K puts the line you're on in Daybook's Inbox
// as a task (its #tags left out) with a link back to the line, sent again it
// updates the same task, and offline it waits for a connection. The link
// back (?open=<id>) opens the line where it lives. window.__daybook stands in
// for Daybook's table.
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

const tasks = new Map();
let down = false;
function daybook(task) {
  if (down) return { __error: 'offline' };
  tasks.set(task.id, { ...tasks.get(task.id), ...task });
  return true;
}
const fake = () => {
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: async (rows) => rows.map((r) => ({ id: r.id, updated_at: new Date().toISOString() })),
    pull: async () => [], async upload() {}, async download() { throw new Error('not found'); },
    subscribe() {}, unsubscribe() {}
  };
  window.__daybook = async (task) => {
    const out = await window.__toDaybook(task);
    if (out?.__error) throw new Error(out.__error);
  };
};

const lines = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').index('kind').getAll('line'); q.onsuccess = () => res(q.result.filter((l) => !l.deleted)); };
}));
const command = async (p, name) => {
  await p.keyboard.press('Control+K');
  await p.keyboard.type(name);
  await sleep(250);
  await p.keyboard.press('Enter');
  await sleep(500);
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.exposeFunction('__toDaybook', daybook);
await ctx.addInitScript(fake);
const page = await ctx.newPage();
page.errors = [];
page.on('pageerror', (e) => page.errors.push(e.message));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

let lineId;
try {
  await page.goto(URL);
  await page.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
  await sleep(500);
  await page.keyboard.press('Control+J');
  await page.waitForSelector('#outline-editor .ProseMirror');
  await page.click('#outline-editor .ProseMirror');
  await page.keyboard.type('Ninja hoods: ask the costume shop if they can do twelve by March #ninja-bunch');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Something else');
  await page.keyboard.press('ArrowUp');
  await sleep(600);

  await check('Ctrl + K sends the line you’re on to Daybook’s Inbox, without its #tags, linked back here', async () => {
    await command(page, 'Send this line to Daybook');
    await page.waitForFunction(() => /Sent to Daybook/.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 5000 });
    assert.equal(tasks.size, 1);
    const [task] = tasks.values();
    assert.equal(task.title, 'Ninja hoods: ask the costume shop if they can do twelve by March');
    lineId = (await lines(page)).find((l) => /Ninja hoods/.test(l.text)).id;
    assert.equal(task.id, `inkwell-${lineId}`);
    assert.equal(task.link, `${URL}?open=${lineId}`);
    const line = (await lines(page)).find((l) => l.id === lineId);
    assert.equal(line.fields.daybook.id, task.id, 'the line remembers it went to Daybook');
    assert.match(line.text, /#ninja-bunch$/, 'your line is unchanged');
  });

  await check('sending it again updates the same task instead of adding another', async () => {
    await page.keyboard.press('End');
    await page.keyboard.type(', and in black');
    await sleep(600);
    await command(page, 'Send this line to Daybook');
    await sleep(500);
    assert.equal(tasks.size, 1);
    assert.match([...tasks.values()][0].title, /in black$/);
  });

  await check('offline, it waits and goes once there’s a connection', async () => {
    down = true;
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await sleep(400);
    await command(page, 'Send this line to Daybook');
    await page.waitForFunction(() => /once you’re online/.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 5000 });
    assert.equal(tasks.size, 1);
    down = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    for (let i = 0; i < 20 && tasks.size < 2; i++) await sleep(250);
    assert.equal(tasks.size, 2);
    assert.ok([...tasks.values()].some((t) => t.title === 'Something else'));
  });

  await check('a blank line can’t be sent', async () => {
    await page.keyboard.press('Enter');
    await sleep(400);
    await command(page, 'Send this line to Daybook');
    await page.waitForFunction(() => /Write something/.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 5000 });
    assert.equal(tasks.size, 2);
  });

  await check('the link back from Daybook opens the line where it lives', async () => {
    await page.keyboard.press('Control+Shift+O');
    await sleep(600);
    assert.notEqual(await page.evaluate(() => document.documentElement.dataset.view), 'notebook', 'somewhere else first');
    await page.goto(`${URL}?open=${lineId}`);
    await page.waitForFunction(() => !location.search.includes('open='), null, { timeout: 8000 });
    await page.waitForFunction(() => /Ninja hoods/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), null, { timeout: 8000 });
    await sleep(600);
    const at = await page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest('li')?.textContent || '');
    assert.match(at, /Ninja hoods/, 'the caret is on that line');
  });

  await check('no page errors', async () => { assert.deepEqual(page.errors, []); });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('daybook: all passed');
