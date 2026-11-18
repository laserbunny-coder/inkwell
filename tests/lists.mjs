// Watch and read lists: on a page marked as one (Ctrl + K), Claude links each
// title you've moved on from to its page, leaving your words as typed. The
// line you're typing on, lines that already have a link, and lines that
// weren't found are left alone. window.__claude stands in for the server.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4189;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const fake = () => {
  window.__asked = [];
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: async (rows) => rows.map((r) => ({ id: r.id, updated_at: new Date().toISOString() })),
    pull: async () => [], async upload() {}, async download() { throw new Error('not found'); },
    subscribe() {}, unsubscribe() {}
  };
  const known = {
    'spirited away': { label: 'Spirited Away (2001)', url: 'https://www.imdb.com/title/tt0245429/', note: 'Miyazaki' },
    'paddington 2': { label: 'Paddington 2 (2017)', url: 'https://www.imdb.com/title/tt4468740/', note: '' }
  };
  window.__claude = async (body) => {
    window.__asked.push(body);
    if (body.mode !== 'lookup') throw new Error('unexpected');
    return known[body.text.replace(/#\S+/g, '').trim().toLowerCase()] || { label: '', url: '', note: '' };
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
  await sleep(400);
};
const linkOf = (l) => (l?.content || []).flatMap((n) => n.marks || []).find((m) => m.type === 'link')?.attrs.href || null;

const browser = await chromium.launch();
const ctx = await browser.newContext();
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
  await page.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
  await sleep(500);
  await command(page, 'New page');
  await page.waitForSelector('#outline-editor .ProseMirror');
  await page.keyboard.type('To watch');
  await page.keyboard.press('Enter');
  await sleep(300);

  await check('Ctrl + K offers to make a page a watch list', async () => {
    await command(page, 'Make this page a watch list');
    assert.match(await page.locator('.toast').innerText(), /link each title on this watch list/);
  });

  await check('a title you’ve moved on from gets linked, and the line you’re on doesn’t', async () => {
    await page.keyboard.type('Spirited Away #anime');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Paddington 2');
    await sleep(900);
    await page.waitForFunction(() => /imdb\.com\/title\/tt0245429/.test(document.querySelector('#outline-editor .ProseMirror')?.innerHTML || ''), null, { timeout: 9000 });
    const all = await lines(page);
    const spirited = all.find((l) => /Spirited Away/.test(l.text));
    assert.equal(spirited.text, 'Spirited Away #anime', 'your words stay as typed');
    assert.equal(linkOf(spirited), 'https://www.imdb.com/title/tt0245429/');
    assert.ok(!spirited.content.find((n) => /#anime/.test(n.text))?.marks?.length, 'the #tag isn’t part of the link');
    assert.equal(spirited.fields.lookup.label, 'Spirited Away (2001)');
    assert.ok(!(await page.evaluate(() => window.__asked)).some((a) => /Paddington/.test(a.text)), 'the line being typed isn’t looked up');
  });

  await check('once you move on, that one is linked too', async () => {
    await page.keyboard.press('Enter');
    await page.keyboard.type('Some film nobody has heard of');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /tt4468740/.test(document.querySelector('#outline-editor .ProseMirror')?.innerHTML || ''), null, { timeout: 9000 });
    await sleep(800);
    const all = await lines(page);
    assert.equal(linkOf(all.find((l) => /Paddington/.test(l.text))), 'https://www.imdb.com/title/tt4468740/');
    assert.equal(linkOf(all.find((l) => /nobody/.test(l.text))), null, 'not found stays plain');
  });

  await check('each line is looked up once for the words it has', async () => {
    const before = (await page.evaluate(() => window.__asked)).length;
    await page.keyboard.type('x');
    await page.keyboard.press('Enter');
    await sleep(5000);
    const asked = (await page.evaluate(() => window.__asked)).slice(before).map((a) => a.text);
    assert.ok(!asked.some((t) => /Spirited|Paddington|nobody/.test(t)), asked.join(', '));
  });

  await check('a page that isn’t a list is never looked up', async () => {
    await command(page, 'Stop Claude linking titles');
    const before = (await page.evaluate(() => window.__asked)).length;
    await page.keyboard.type('Totoro');
    await page.keyboard.press('Enter');
    await sleep(5000);
    assert.equal((await page.evaluate(() => window.__asked)).length, before);
  });

  await check('no page errors', async () => { assert.deepEqual(page.errors, []); });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('lists: all passed');
