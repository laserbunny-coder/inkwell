// Two devices (separate browser profiles) syncing through a stand-in for
// Supabase that behaves the same way: the server stamps updated_at, and pulls
// return everything changed since a time.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4181;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const table = new Map();
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
}

const fake = () => {
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }),
    onAuth() {},
    signIn() {},
    signOut() {},
    push: (rows) => window.__remote('push', rows),
    pull: (since, from) => window.__remote('pull', { since, from }),
    subscribe() {},
    unsubscribe() {}
  };
};

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
const text = (p) => p.locator('#editor .ProseMirror').innerText();
const syncNow = (p) => p.evaluate(() => window.__sync.run());
const words = (p) => p.locator('#editor .ProseMirror').innerText();

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

try {
  const laptop = await device();
  await laptop.keyboard.type('From the laptop.');
  await sleep(600);
  await syncNow(laptop);

  await check('writing on one device reaches the cloud', async () => {
    const paras = [...table.values()].filter((r) => r.kind === 'para');
    assert.equal(paras.length, 1);
    assert.equal(paras[0].text, 'From the laptop.');
  });

  await sleep(50);
  const phone = await device();
  await sleep(500);
  await syncNow(phone);
  await sleep(300);

  await check('a new device picks up the same book and drops its own empty starter', async () => {
    assert.equal(await text(phone), 'From the laptop.');
    const live = [...table.values()].filter((r) => r.kind === 'project' && !r.deleted);
    assert.equal(live.length, 1);
  });

  await check('writing on the second device shows up on the first', async () => {
    await phone.locator('#editor .ProseMirror p').last().click();
    await phone.keyboard.press('End');
    await phone.keyboard.press('Enter');
    await phone.keyboard.type('And from the phone.');
    await sleep(600);
    await syncNow(phone);
    await syncNow(laptop);
    await sleep(300);
    assert.match(await text(laptop), /From the laptop\.\s+And from the phone\./);
  });

  await check('the cursor stays put when the other device changes a different paragraph', async () => {
    await laptop.locator('#editor .ProseMirror p').first().click();
    await laptop.keyboard.press('End');
    await phone.locator('#editor .ProseMirror p').last().click();
    await phone.keyboard.press('End');
    await phone.keyboard.type(' More.');
    await sleep(600);
    await syncNow(phone);
    await syncNow(laptop);
    await sleep(300);
    await laptop.keyboard.type(' Still here.');
    assert.match(await text(laptop), /From the laptop\. Still here\.\s+And from the phone\. More\./);
  });

  await check('editing the same paragraph on both while apart keeps both versions', async () => {
    await sleep(600);
    await syncNow(laptop);
    await syncNow(phone);
    await sleep(300);
    // Laptop goes offline and edits paragraph one.
    await laptop.evaluate(() => { window.__savedUser = window.__sync.user; window.__sync.user = null; });
    await laptop.locator('#editor .ProseMirror p').first().click();
    await laptop.keyboard.press('End');
    await laptop.keyboard.type(' Laptop edit.');
    await sleep(600);
    // Phone edits the same paragraph and syncs first.
    await phone.locator('#editor .ProseMirror p').first().click();
    await phone.keyboard.press('End');
    await phone.keyboard.type(' Phone edit.');
    await sleep(600);
    await syncNow(phone);
    // Laptop comes back.
    await laptop.evaluate(() => { window.__sync.user = window.__savedUser; return window.__sync.run(); });
    await syncNow(phone);
    await sleep(300);
    assert.match(await text(laptop), /Laptop edit\./);
    assert.match(await text(phone), /Laptop edit\./);
    const conflicts = await laptop.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('writing');
      r.onsuccess = () => { const q = r.result.transaction('conflicts').objectStore('conflicts').getAll(); q.onsuccess = () => res(q.result); };
    }));
    assert.ok(conflicts.some((c) => c.text.includes('Phone edit.')), 'phone version kept as a conflict copy');
  });

  await check('no page errors', async () => assert.deepEqual([...laptop.errors, ...phone.errors], []));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
