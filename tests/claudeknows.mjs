// What Claude knows: Claude's one-line abouts and weekly summaries arrive by
// sync like everything else but stay out of sight: never as lines on the page
// they describe, never in search. The panel (Ctrl + K, What Claude knows)
// shows them; you can write your own line (Claude leaves it alone), hand it
// back to Claude, or switch it off.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4193;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const fake = () => {
  const t = new Date().toISOString();
  const row = (r) => ({ sort: 1, title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: t, updated_at: t, ...r });
  const SEED = [
    row({ id: 'pg_kenji', kind: 'page', parent_id: null, title: 'Kenji' }),
    row({ id: 'li_k1', kind: 'line', parent_id: 'pg_kenji', text: 'Afraid of the dentist', content: [{ type: 'text', text: 'Afraid of the dentist' }], fields: { done: false } }),
    row({ id: 'ab-pg_kenji', kind: 'about', parent_id: 'pg_kenji', text: 'Kenji, the nervous ninja: fears and running gags.', fields: { by: 'claude', edited_by: 'claude', of: 'pg_kenji' } }),
    row({ id: 'dg-week-2026-10-26', kind: 'digest', parent_id: null, title: 'Week of Oct 26 – Nov 1, 2026', text: 'You spent the week on the Ninja Bunch.\n\nAlso a gift for Mom.', fields: { period: 'week', from: '2026-10-26', to: '2026-11-01', by: 'claude', threads: [{ title: 'Dentist reel', gist: 'Kenji faces the dentist.', ids: ['li_k1'] }] } }),
    row({ id: 'dg-month-2026-10', kind: 'digest', parent_id: null, title: 'October 2026', text: 'October was about Inkwell and the Ninja Bunch.', fields: { period: 'month', from: '2026-10-01', to: '2026-10-31', by: 'claude' } }),
  ];
  window.__pushed = [];
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: async (rows) => { window.__pushed.push(...rows); return rows.map((r) => ({ id: r.id, updated_at: new Date().toISOString() })); },
    pull: async (since, from) => (since < '2000' && from === 0 && !localStorage.getItem('seeded') ? (localStorage.setItem('seeded', '1'), SEED) : []),
    async upload() {}, async download() { throw new Error('not found'); },
    subscribe() {}, unsubscribe() {}
  };
};

const get = (p, id) => p.evaluate((id) => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').get(id); q.onsuccess = () => res(q.result); };
}), id);
const command = async (p, name) => {
  await p.keyboard.press('Control+K');
  await p.keyboard.type(name);
  await sleep(300);
  await p.keyboard.press('Enter');
  await sleep(500);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: 'dark' });
await ctx.addInitScript(fake);
const page = await ctx.newPage();
page.errors = [];
page.on('pageerror', (e) => page.errors.push(e.message));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

try {
  await page.goto(URL);
  for (let i = 0; i < 40 && !(await get(page, 'ab-pg_kenji')); i++) await sleep(250);
  // Open the page the about describes. The app must have settled where it
  // starts first, or it writes its own place over this one on a slow machine.
  await page.waitForFunction(() => !!document.documentElement.dataset.view && !!localStorage.getItem('place'), null, { timeout: 20000 }).catch(() => {});
  await sleep(500);
  await page.evaluate(() => localStorage.setItem('place', JSON.stringify({ view: 'notebook', pageId: 'pg_kenji' })));
  await page.reload();
  await page.waitForSelector('#outline-editor .ProseMirror');
  await sleep(800);

  await check('the about never shows as a line on its page, even though it syncs down', async () => {
    const text = await page.locator('#outline-editor .ProseMirror').innerText();
    assert.match(text, /Afraid of the dentist/);
    assert.doesNotMatch(text, /nervous ninja/);
  });

  await check('What Claude knows shows the about (Claude’s) and the summaries, folded', async () => {
    await command(page, 'What Claude knows');
    const box = page.locator('.ck');
    await box.waitFor();
    assert.equal(await box.locator('.ck-input').inputValue(), 'Kenji, the nervous ninja: fears and running gags.');
    assert.match(await box.locator('.ck-about .ck-note').innerText(), /Written by Claude/);
    const sums = await box.locator('.ck-digest summary').allInnerTexts();
    assert.deepEqual(sums, ['October 2026', 'Week of Oct 26 – Nov 1, 2026']);
    assert.equal(await box.locator('.ck-digest[open]').count(), 0);
    await box.locator('.ck-digest summary').nth(1).click();
    assert.match(await box.locator('.ck-digest').nth(1).innerText(), /gift for Mom[\s\S]*Dentist reel/);
  });

  await check('your own line: saved as yours, so Claude leaves it alone', async () => {
    const box = page.locator('.ck');
    await box.locator('.ck-input').fill('Kenji: the scaredy-cat ninja.');
    await box.getByRole('button', { name: 'Save as mine' }).click();
    await sleep(300);
    const r = await get(page, 'ab-pg_kenji');
    assert.equal(r.text, 'Kenji: the scaredy-cat ninja.');
    assert.notEqual(r.fields.edited_by, 'claude');
    assert.equal(r.fields.history[0].text, 'Kenji, the nervous ninja: fears and running gags.');
    assert.equal(r.fields.history[0].by, 'claude');
    assert.match(await box.locator('.ck-about .ck-note').innerText(), /Written by you/);
  });

  await check('hand it back to Claude: emptied and marked Claude’s, to be written fresh', async () => {
    const box = page.locator('.ck');
    await box.getByRole('button', { name: 'Let Claude write it' }).click();
    await sleep(300);
    const r = await get(page, 'ab-pg_kenji');
    assert.equal(r.text, '');
    assert.equal(r.fields.edited_by, 'claude');
  });

  await check('switch it off, and back on', async () => {
    const box = page.locator('.ck');
    await box.getByRole('button', { name: 'Switch off' }).click();
    await sleep(300);
    assert.equal((await get(page, 'ab-pg_kenji')).fields.off, true);
    assert.match(await box.innerText(), /Switched off/);
    await box.getByRole('button', { name: 'Switch back on' }).click();
    await sleep(300);
    assert.ok(!(await get(page, 'ab-pg_kenji')).fields.off);
    await page.keyboard.press('Escape');
    await sleep(200);
    assert.equal(await page.locator('.ck').count(), 0);
  });

  await check('the changes go up to the cloud like any other entry', async () => {
    await sleep(2500);
    assert.ok((await page.evaluate(() => window.__pushed.map((r) => r.id))).includes('ab-pg_kenji'));
  });

  await check('on a day page it shows just the summaries', async () => {
    await page.evaluate(() => localStorage.setItem('place', JSON.stringify({ view: 'notebook', pageId: 'day-2000-01-01' })));
    await page.reload();
    await page.waitForSelector('#outline-editor .ProseMirror');
    await sleep(800);
    await command(page, 'What Claude knows');
    const box = page.locator('.ck');
    await box.waitFor();
    assert.equal(await box.locator('.ck-about').count(), 0);
    assert.equal(await box.locator('.ck-digest').count(), 2);
    await page.keyboard.press('Escape');
  });

  await check('no errors on the page', async () => assert.deepEqual(page.errors, []));
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nclaudeknows: all passed');
