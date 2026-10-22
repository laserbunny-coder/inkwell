// Pictures and files: pasted into a chapter or a line, kept on the device,
// sent to the cloud's file storage, fetched by another device, and included
// in the backup. Uses the same stand-in for Supabase as tests/sync.mjs, with
// a stand-in for file storage too.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4183;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const table = new Map();
const bucket = new Map();
let clock = Date.parse('2026-10-20T00:00:00Z');
function remote(op, arg) {
  if (op === 'push') {
    const stamp = new Date((clock += 1000)).toISOString();
    return arg.map((r) => {
      table.set(r.id, { ...r, user_id: 'u1', updated_at: stamp });
      return { id: r.id, updated_at: stamp };
    });
  }
  if (op === 'pull') {
    return [...table.values()].filter((r) => r.updated_at > arg.since)
      .sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : 1))
      .slice(arg.from, arg.from + 500);
  }
  if (op === 'upload') { bucket.set(arg.path, arg); return true; }
  if (op === 'download') return bucket.get(arg) || null;
}

const fake = () => {
  const toB64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(blob); });
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }),
    onAuth() {},
    signIn() {},
    signOut() {},
    push: (rows) => window.__remote('push', rows),
    pull: (since, from) => window.__remote('pull', { since, from }),
    async upload(path, blob, type) { await window.__remote('upload', { path, type, data: await toB64(blob) }); },
    async download(path) {
      const f = await window.__remote('download', path);
      if (!f) throw new Error('not found');
      return new Blob([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], { type: f.type });
    },
    subscribe() {},
    unsubscribe() {}
  };
};

// A small red PNG, made in the page.
const pastePicture = (p, sel) => p.evaluate(async (sel) => {
  const c = document.createElement('canvas');
  c.width = 40; c.height = 30;
  const g = c.getContext('2d');
  g.fillStyle = '#c33'; g.fillRect(0, 0, 40, 30);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'red.png', { type: 'image/png' }));
  document.querySelector(sel).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, sel);
const fileEntries = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').index('kind').getAll('file'); q.onsuccess = () => res(q.result); };
}));

const browser = await chromium.launch();
async function device() {
  const ctx = await browser.newContext();
  await ctx.exposeFunction('__remote', remote);
  await ctx.addInitScript(fake);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(URL);
  await page.waitForSelector('#editor .ProseMirror');
  return page;
}
const syncNow = (p) => p.evaluate(() => window.__sync.run());

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

try {
  const laptop = await device();
  await laptop.locator('#editor .ProseMirror').click();
  await laptop.keyboard.type('The harbour at dawn: ');

  await check('a pasted picture shows in the chapter and is kept on the device', async () => {
    await pastePicture(laptop, '#editor .ProseMirror');
    await laptop.waitForSelector('#editor .file-embed.picture img[src^="blob:"]', { timeout: 5000 });
    const files = await fileEntries(laptop);
    assert.equal(files.length, 1);
    assert.equal(files[0].fields.type, 'image/png');
    await sleep(900);
    await laptop.reload();
    await laptop.waitForSelector('#editor .file-embed.picture img[src^="blob:"]', { timeout: 5000 });
    assert.match(await laptop.locator('#editor .ProseMirror').innerText(), /The harbour at dawn/);
  });

  await check('it goes up to the cloud with the paragraph', async () => {
    await syncNow(laptop);
    // A sync already under way finishes first; wait for both to land.
    const para = () => [...table.values()].find((r) => r.kind === 'para' && /harbour at dawn/.test(r.text));
    for (let i = 0; i < 40 && !(bucket.size && para()); i++) { await sleep(150); if (i === 10) await syncNow(laptop); }
    const [file] = await fileEntries(laptop);
    assert.ok(bucket.has(`u1/${file.id}`), 'uploaded to the person’s folder');
    assert.ok(para().content.some((n) => n.type === 'file' && n.attrs.id === file.id));
  });

  await check('another device fetches the picture the first time it shows', async () => {
    const phone = await device();
    await syncNow(phone);
    await sleep(500);
    await phone.reload();
    await phone.waitForSelector('#editor .ProseMirror');
    await syncNow(phone);
    await phone.waitForSelector('#editor .file-embed.picture img[src^="blob:"]', { timeout: 8000 });
    assert.deepEqual(phone.errors, []);
    await phone.context().close();
  });

  await check('a file pasted on a line shows as a chip', async () => {
    await laptop.keyboard.press('Control+J');
    await laptop.waitForSelector('#outline-editor .ProseMirror', { state: 'visible' });
    await laptop.locator('#outline-editor li').last().click();
    await laptop.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['Dear Ellen,'], 'letter.txt', { type: 'text/plain' }));
      document.querySelector('#outline-editor .ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await laptop.waitForSelector('#outline-editor .file-embed.chip', { timeout: 5000 });
    assert.match(await laptop.locator('#outline-editor .file-embed.chip').innerText(), /letter\.txt/);
  });

  await check('the backup includes the files and links them from the Markdown', async () => {
    await sleep(900);
    const files = await laptop.evaluate(() => window.__vaultFiles?.().then((fs) => fs.map((f) => ({ path: f.path, text: f.text || '', bytes: f.bytes ? f.bytes.length : 0 }))));
    assert.ok(files, 'vault files available');
    const pics = files.filter((f) => f.path.startsWith('Files/'));
    assert.equal(pics.length, 2, files.map((f) => f.path).join(', '));
    assert.ok(pics.every((f) => f.bytes > 0));
    const book = files.find((f) => f.path.endsWith('.md') && f.text.includes('harbour at dawn'));
    assert.match(book.text, /!\[red\.png\]\(<(\.\.\/)+Files\/fi_[a-z0-9_]+-red\.png>\)/);
  });

  await check('no page errors', async () => assert.deepEqual(laptop.errors, []));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
