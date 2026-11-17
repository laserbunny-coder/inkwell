// The Save to Inkwell bookmark on a computer: clicked on some other site, it
// opens a little window that hands the link to the Inkwell already open in
// this browser (which keeps your place and says so), then closes itself.
// With no Inkwell open, that window becomes Inkwell and the link lands there.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { bookmarklet } from '../src/savebutton.js';
import { classic } from './classic.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4196;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const MARK = bookmarklet(URL).replace(/^javascript:/, '');

const lines = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').index('kind').getAll('line'); q.onsuccess = () => res(q.result.filter((l) => !l.deleted)); };
}));

const browser = classic(await chromium.launch());
const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
// No server: the snapshot just waits.
await ctx.addInitScript(() => { window.__claude = async () => { throw Object.assign(new Error('offline'), { status: 503 }); }; });
// Some other site, where the bookmark gets clicked.
await ctx.route('https://example.org/**', (r) => r.fulfill({ contentType: 'text/html', body: `<title>${decodeURIComponent(new globalThis.URL(r.request().url()).pathname.slice(1))}</title><p>A post</p>` }));

let failed = 0;
const errors = [];
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); return p; };

// Clicks the bookmark on a page of example.org; returns the window it opened.
async function clickBookmark(name) {
  const site = watch(await ctx.newPage());
  await site.goto(`https://example.org/${encodeURIComponent(name)}`);
  const [popup] = await Promise.all([ctx.waitForEvent('page'), site.evaluate(MARK)]);
  watch(popup);
  return { site, popup };
}
const started = (p) => p.waitForFunction(() => document.documentElement.dataset.started === '1', null, { timeout: 15000 });

try {
  const app = watch(await ctx.newPage());
  await app.goto(URL);
  await started(app);
  await app.keyboard.press('Control+Shift+O');
  await app.waitForFunction(() => document.documentElement.dataset.view === 'library');

  await check('with Inkwell open, the link lands there quietly: you stay where you are, a note says so, and the little window closes', async () => {
    const { site, popup } = await clickBookmark('Ninja stunt reel');
    await popup.waitForFunction(() => /Saved/.test(document.getElementById('sv-said')?.textContent || ''), null, { timeout: 5000 });
    await popup.waitForEvent('close', { timeout: 5000 });
    await app.waitForFunction(() => /Saved to today’s page/.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 5000 });
    assert.equal(await app.evaluate(() => document.documentElement.dataset.view), 'library', 'still in the Library');
    const saved = (await lines(app)).filter((l) => l.fields?.url === 'https://example.org/Ninja%20stunt%20reel');
    assert.equal(saved.length, 1, 'one line for it');
    assert.match(saved[0].parent_id, /^day-\d{4}-\d{2}-\d{2}$/, 'on today’s page');
    assert.equal(saved[0].text, 'Ninja stunt reel');
    // Show takes you there.
    await app.locator('.toast .toast-action', { hasText: 'Show' }).click();
    await app.waitForFunction(() => /Ninja stunt reel/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), null, { timeout: 5000 });
    assert.equal(ctx.pages().filter((p) => p.url().startsWith(URL)).length, 1, 'no second Inkwell');
    await site.close();
  });

  await check('with two Inkwell windows open, the link still lands only once', async () => {
    const second = watch(await ctx.newPage());
    await second.goto(URL);
    await started(second);
    const { site, popup } = await clickBookmark('Two windows');
    await popup.waitForEvent('close', { timeout: 5000 });
    await sleep(1500);
    const saved = (await lines(app)).filter((l) => l.fields?.url === 'https://example.org/Two%20windows');
    assert.equal(saved.length, 1);
    await second.close();
    await site.close();
  });

  await check('with no Inkwell open, the little window becomes Inkwell, on today’s page with the link', async () => {
    await app.close();
    const { popup } = await clickBookmark('Nobody home');
    await popup.waitForURL((u) => u.href === URL, { timeout: 8000 });
    await started(popup);
    await popup.waitForFunction(() => /Nobody home/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), null, { timeout: 8000 });
    const saved = (await lines(popup)).filter((l) => l.fields?.url === 'https://example.org/Nobody%20home');
    assert.equal(saved.length, 1);
  });

  await check('no errors on any page', async () => {
    assert.deepEqual(errors.filter((e) => !/offline/.test(e)), []);
  });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
