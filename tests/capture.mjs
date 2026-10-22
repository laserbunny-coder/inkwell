// Voice capture: the home-screen shortcut opens Capture, a recording is kept
// piece by piece, lands on today's page as #idea with a play button, and is
// written out (with Claude's outline under it) once there's a connection. A
// recording cut short is brought back. Chrome's fake microphone stands in for
// a real one, and window.__claude for the server.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4187;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const table = new Map();
const bucket = new Map();
let clock = Date.parse('2026-10-20T00:00:00Z');
function remote(op, arg) {
  if (op === 'push') {
    const stamp = new Date((clock += 1000)).toISOString();
    return arg.map((r) => { table.set(r.id, { ...r, user_id: 'u1', updated_at: stamp }); return { id: r.id, updated_at: stamp }; });
  }
  if (op === 'pull') return [...table.values()].filter((r) => r.updated_at > arg.since).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)).slice(arg.from, arg.from + 500);
  if (op === 'upload') { bucket.set(arg.path, arg); return true; }
  if (op === 'download') return bucket.get(arg) || null;
}
const fake = () => {
  const toB64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(blob); });
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: (rows) => window.__remote('push', rows),
    pull: (since, from) => window.__remote('pull', { since, from }),
    async upload(path, blob, type) { await window.__remote('upload', { path, type, data: await toB64(blob) }); },
    async download(path) {
      const f = await window.__remote('download', path);
      if (!f) throw new Error('not found');
      return new Blob([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], { type: f.type });
    },
    subscribe() {}, unsubscribe() {}
  };
  // The server: no speech service until a test says there is one.
  window.__asked = [];
  window.__claude = async (body) => {
    window.__asked.push(body);
    if (!window.__transcriber) { const e = new Error('Writing out recordings isn’t set up yet.'); e.code = 'no-transcriber'; throw e; }
    return window.__transcriber(body);
  };
};

const lines = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').index('kind').getAll('line'); q.onsuccess = () => res(q.result.filter((l) => !l.deleted)); };
}));
const pieceCount = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('inkwell-capture');
  r.onsuccess = () => { const q = r.result.transaction('pieces').objectStore('pieces').count(); q.onsuccess = () => res(q.result); };
}));
const outlineText = (p) => p.locator('#outline-editor .ProseMirror').innerText();

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ permissions: ['microphone'] });
await ctx.exposeFunction('__remote', remote);
await ctx.addInitScript(fake);
const page = await ctx.newPage();
page.errors = [];
page.on('pageerror', (e) => page.errors.push(e.message));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

async function record(ms) {
  await page.waitForSelector('.capture:not([hidden])');
  if ((await page.getAttribute('.capture', 'data-state')) !== 'recording') await page.click('.cap-big');
  await page.waitForSelector('.capture[data-state="recording"]');
  await sleep(ms);
  await page.click('.cap-big');
  await page.waitForSelector('.capture', { state: 'hidden', timeout: 8000 });
}

try {
  await check('the home-screen shortcut opens Capture, and the address is cleaned up', async () => {
    await page.goto(`${URL}?capture=voice`);
    await page.waitForSelector('.capture:not([hidden])', { timeout: 8000 });
    assert.equal(await page.getAttribute('.capture', 'data-state'), 'ready');
    assert.ok(!page.url().includes('capture'), page.url());
  });

  await check('talking is kept piece by piece while it records', async () => {
    await page.click('.cap-big');
    await page.waitForSelector('.capture[data-state="recording"]');
    await sleep(4600);
    assert.match(await page.locator('.cap-time').innerText(), /^0:0[4-6]$/);
    assert.ok(await pieceCount(page) >= 1, 'a piece is on the device');
  });

  await check('Done puts it on today’s page as #idea, with a play button and its length', async () => {
    await page.click('.cap-big');
    await page.waitForSelector('.capture', { state: 'hidden', timeout: 8000 });
    await page.waitForSelector('#outline-editor .file-embed.audio', { timeout: 5000 });
    assert.match(await page.locator('#nb-kind').innerText(), /Today/i);
    assert.match(await page.locator('#outline-editor .file-embed.audio small').first().innerText(), /^0:0[4-6]$/);
    const [line] = (await lines(page)).filter((l) => l.fields?.capture === 'voice');
    assert.ok(line, 'a capture line');
    assert.deepEqual(line.tags, ['idea']);
    assert.equal(line.content[0].type, 'file');
    assert.equal(await pieceCount(page), 0, 'pieces cleared once kept');
  });

  await check('with no speech service yet, it says it’s waiting and keeps the recording', async () => {
    await page.waitForFunction(() => /set up/.test(document.querySelector('#outline-editor .file-embed.audio .note')?.textContent || ''), null, { timeout: 8000 });
    const q = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const g = r.result.transaction('meta').objectStore('meta').get('captureQueue'); g.onsuccess = () => res(g.result?.value || []); }; }));
    assert.equal(q.length, 1);
  });

  await check('once it’s set up, the words go into the line and Claude’s outline goes under it', async () => {
    await page.evaluate(() => {
      window.__transcriber = async () => ({ transcript: 'Ninjas who are terrible at hiding, filmed like a nature documentary.', outline: ['Premise: ninjas who can’t hide', 'Images: nature-documentary framing'] });
      window.dispatchEvent(new Event('online'));
    });
    await page.waitForFunction(() => /terrible at hiding/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), null, { timeout: 8000 });
    const text = await outlineText(page);
    assert.match(text, /Ninjas who are terrible at hiding, filmed like a nature documentary\. #idea/);
    assert.match(text, /Premise: ninjas who can’t hide/);
    const all = await lines(page);
    const cap = all.find((l) => l.fields?.capture === 'voice');
    const kids = all.filter((l) => l.parent_id === cap.id);
    assert.equal(kids.length, 2);
    assert.ok(kids.every((k) => k.fields.by === 'claude'), 'outline lines are Claude’s');
    assert.equal(cap.content[0].type, 'file', 'the recording stays on the line');
    assert.equal(await page.locator('#outline-editor .file-embed.audio .note').first().innerText(), '');
    const asked = await page.evaluate(() => window.__asked.at(-1));
    assert.equal(asked.mode, 'capture');
    assert.ok(bucket.has(`u1/${asked.file}`), 'the recording went up before asking');
  });

  await check('if you already wrote on the line, the words go under it and yours stay', async () => {
    await page.evaluate(() => { window.__transcriber = null; });
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Capture an idea');
    await page.keyboard.press('Enter');
    await record(1500);
    await page.waitForSelector('#outline-editor .file-embed.audio >> nth=1');
    await sleep(300);
    await page.keyboard.press('End');
    await page.keyboard.type(' bunny version');
    await sleep(900);
    await page.evaluate(() => {
      window.__transcriber = async () => ({ transcript: 'What if the ninjas were rabbits.', outline: [] });
      window.dispatchEvent(new Event('online'));
    });
    await page.waitForFunction(() => /ninjas were rabbits/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), null, { timeout: 8000 });
    const all = await lines(page);
    const mine = all.find((l) => /bunny version/.test(l.text));
    assert.ok(mine, 'your words kept');
    const under = all.find((l) => l.parent_id === mine.id);
    assert.equal(under?.text, 'What if the ninjas were rabbits.');
  });

  await check('Cancel throws a recording away and leaves the page as it was', async () => {
    const before = (await lines(page)).length;
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Capture an idea');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.capture:not([hidden])');
    await page.click('.cap-big');
    await page.waitForSelector('.capture[data-state="recording"]');
    await sleep(1200);
    await page.click('.cap-cancel');
    await page.waitForSelector('.capture', { state: 'hidden' });
    await sleep(500);
    assert.equal((await lines(page)).length, before);
    assert.equal(await pieceCount(page), 0);
  });

  await check('a recording cut short by the app closing is brought back on reopening', async () => {
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Capture an idea');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.capture:not([hidden])');
    await page.click('.cap-big');
    await page.waitForSelector('.capture[data-state="recording"]');
    await sleep(4600);
    const before = (await lines(page)).filter((l) => l.fields?.capture === 'voice').length;
    await page.reload();
    await page.waitForSelector('#outline-editor .ProseMirror');
    await page.waitForFunction((n) => document.querySelectorAll('#outline-editor .file-embed.audio').length > n, before, { timeout: 8000 });
    assert.equal((await lines(page)).filter((l) => l.fields?.capture === 'voice').length, before + 1);
    assert.match(await page.locator('.toast').innerText(), /cut short/);
    assert.equal(await pieceCount(page), 0);
  });

  await check('“Start recording as soon as Capture opens” starts it with no tap', async () => {
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Capture an idea');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.capture:not([hidden])');
    await page.check('.cap-auto input');
    await page.click('.cap-cancel');
    await page.goto(`${URL}?capture=voice`);
    await page.waitForSelector('.capture[data-state="recording"]', { timeout: 8000 });
    await page.click('.cap-cancel');
    await page.waitForSelector('.capture', { state: 'hidden' });
  });

  await check('the play button plays the recording', async () => {
    await page.locator('#outline-editor .file-embed.audio .play').first().click();
    await page.waitForSelector('#outline-editor .file-embed.audio.playing', { timeout: 5000 });
    await page.locator('#outline-editor .file-embed.audio .play').first().click();
    await page.waitForSelector('#outline-editor .file-embed.audio.playing', { state: 'detached', timeout: 5000 });
  });

  await check('the manifest offers Capture on a long-press of the icon', async () => {
    const m = await (await fetch(`${URL}manifest.webmanifest`)).json();
    assert.equal(m.shortcuts[0].url, './?capture=voice');
  });

  await check('no page errors', async () => { assert.deepEqual(page.errors, []); });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('capture: all passed');
