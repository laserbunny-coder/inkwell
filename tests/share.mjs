// Share into Inkwell: what Android hands the service worker (a page, a link
// in some text, a picture) lands on today's page with an empty line under it,
// and a shared link gets a snapshot (title, picture, short summary) once
// there's a connection. window.__claude stands in for the server.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4188;
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
  if (op === 'snapshot') {
    if (arg.includes('gone.example')) return { __error: 'The page couldn’t be read', status: 422 };
    if (arg.includes('instagram.com')) {
      // A 1x1 PNG, put in the person's folder as the server would.
      bucket.set('u1/fi_snapshot1', { path: 'u1/fi_snapshot1', type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' });
      return { title: 'Ninja reel by @studio', summary: 'A short reel of a ninja failing to hide behind a lamppost.', site: 'Instagram', image: { id: 'fi_snapshot1', type: 'image/png', size: 68, name: 'Ninja reel.png' } };
    }
    return { title: 'Somebody else’s title', summary: 'A fan wiki about the Ninja Bunch.', site: 'example.com', image: null };
  }
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
  window.__asked = [];
  window.__claude = async (body) => {
    window.__asked.push(body);
    if (body.mode !== 'snapshot') throw new Error('unexpected');
    const out = await window.__remote('snapshot', body.url);
    if (out?.__error) throw Object.assign(new Error(out.__error), { status: out.status });
    return out;
  };
};

const lines = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').index('kind').getAll('line'); q.onsuccess = () => res(q.result.filter((l) => !l.deleted)); };
}));
const outlineText = (p) => p.locator('#outline-editor .ProseMirror').innerText();

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.exposeFunction('__remote', remote);
await ctx.addInitScript(fake);
const page = await ctx.newPage();
page.errors = [];
page.on('pageerror', (e) => page.errors.push(e.message));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

// What Android does: a form posted to ./share, which the service worker takes.
async function share(fields, file) {
  await page.evaluate(async ({ fields, file }) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    if (file) {
      const c = document.createElement('canvas'); c.width = 30; c.height = 20;
      const g = c.getContext('2d'); g.fillStyle = '#3a6'; g.fillRect(0, 0, 30, 20);
      form.append('files', new File([await new Promise((r) => c.toBlob(r, 'image/png'))], file, { type: 'image/png' }));
    }
    const res = await fetch('./share', { method: 'POST', body: form });
    window.__landed = res.url;
  }, { fields, file });
  assert.match(await page.evaluate(() => window.__landed), /\?share=1$/, 'the service worker took it and sent the app on');
  await page.goto(`${URL}?share=1`);
  await page.waitForSelector('#outline-editor .ProseMirror');
}

try {
  await page.goto(URL);
  await page.waitForSelector('#editor .ProseMirror');
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(async () => { await page.reload(); await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }); });

  await check('a page shared from Chrome lands on today’s page as a link, with the caret on an empty line under it', async () => {
    await share({ title: 'The Ninja Bunch fan wiki', text: '', url: 'https://example.com/ninjas' });
    await page.waitForFunction(() => /Ninja Bunch fan wiki/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), null, { timeout: 8000 });
    assert.ok(!page.url().includes('share'), 'address cleaned up');
    assert.match(await page.locator('#nb-kind').innerText(), /Today/i);
    const a = page.locator('#outline-editor a[href="https://example.com/ninjas"]');
    assert.equal(await a.innerText(), 'The Ninja Bunch fan wiki');
    await page.keyboard.type('Use the wiki’s fight list for episode 3');
    await sleep(900);
    const all = await lines(page);
    const top = all.find((l) => l.fields?.url === 'https://example.com/ninjas');
    const spark = all.find((l) => l.parent_id === top.id && /fight list/.test(l.text));
    assert.ok(spark, 'what it sparked is written under it');
  });

  await check('the snapshot keeps its summary under the link, and a name you gave isn’t replaced', async () => {
    await page.waitForFunction(() => /fan wiki about the Ninja Bunch/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), null, { timeout: 8000 });
    const all = await lines(page);
    const top = all.find((l) => l.fields?.url === 'https://example.com/ninjas');
    assert.equal(top.fields.snapshot.summary, 'A fan wiki about the Ninja Bunch.');
    assert.match(top.text, /The Ninja Bunch fan wiki/);
    const kids = all.filter((l) => l.parent_id === top.id).sort((a, b) => a.sort - b.sort);
    assert.match(kids[0].text, /fight list/, 'your line first');
    assert.equal(kids[1].fields.by, 'claude');
  });

  await check('an Instagram link in the shared text gets the post’s title and picture from its snapshot', async () => {
    await share({ title: '', text: 'Check this out https://www.instagram.com/p/abc123/', url: '' });
    await page.waitForFunction(() => /Ninja reel by @studio/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), null, { timeout: 8000 });
    const all = await lines(page);
    const top = all.find((l) => l.fields?.url === 'https://www.instagram.com/p/abc123/');
    assert.equal(top.content[0].type, 'file');
    assert.equal(top.content[0].attrs.id, 'fi_snapshot1');
    assert.match(top.text, /Ninja reel by @studio/);
    assert.match(top.text, /Check this out/);
    await page.waitForSelector('#outline-editor .file-embed.picture img[src^="blob:"]', { timeout: 8000 });
  });

  await check('a shared picture lands with its words, and a page that can’t be read stays a plain link', async () => {
    await share({ title: '', text: 'Concept art for the bakery https://gone.example/x', url: '' }, 'bakery.png');
    await page.waitForFunction(() => /Concept art for the bakery/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), null, { timeout: 8000 });
    const all = await lines(page);
    const top = all.find((l) => l.fields?.url === 'https://gone.example/x');
    assert.equal(top.content[0].type, 'file');
    assert.equal(top.content[0].attrs.type, 'image/png');
    await sleep(800);
    const q = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const g = r.result.transaction('meta').objectStore('meta').get('snapshotQueue'); g.onsuccess = () => res(g.result?.value || []); }; }));
    assert.equal(q.length, 0, 'not retried forever');
  });

  await check('nothing is placed twice', async () => {
    const before = (await lines(page)).length;
    await page.goto(`${URL}?share=1`);
    await page.waitForSelector('#outline-editor .ProseMirror');
    await sleep(800);
    assert.equal((await lines(page)).length, before);
  });

  await check('the manifest offers Inkwell in Android’s Share menu', async () => {
    const m = await (await fetch(`${URL}manifest.webmanifest`)).json();
    assert.equal(m.share_target.action, './share');
    assert.equal(m.share_target.method, 'POST');
  });

  await check('no page errors', async () => { assert.deepEqual(page.errors, []); });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('share: all passed');
