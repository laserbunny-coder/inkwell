// Phone alerts come from Inkwell: the command list opens Phone alerts, the
// switches are the account's (shared with Daybook), turning alerts on signs
// this device up as Inkwell's, and an alert for Needs you opens the Desk.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4275;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 4).join('\n     ')}`); }
}

const calls = [];
const fake = () => {
  const call = (name, arg) => window.__call(name, arg);
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: async (rows) => rows.map((r) => ({ id: r.id, updated_at: new Date().toISOString() })),
    pull: async () => [],
    async upload() {}, async download() { throw new Error('not found'); },
    subscribe() {}, unsubscribe() {},
    desk: async () => ({ needs: [{ id: 'n1', title: 'Pick a look', kind: 'decision', project: 'Inkwell', link: 'https://claude.ai/x', created_at: new Date().toISOString() }], updates: [] }),
    deskAll: async () => ({ needs: [], updates: [] }),
    alertPrefs: async () => ({ review: true, needs: true, notes: false, week: false, month: true }),
    saveAlertPrefs: (p) => call('saveAlertPrefs', p),
    savePushSub: (r) => call('savePushSub', r),
    dropPushSub: (e) => call('dropPushSub', e),
    invoke: (name, body) => call('invoke', { name, body }).then(() => (body.action === 'key' ? { key: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' } : { sent: 1 }))
  };
};

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, colorScheme: 'dark' });
  await ctx.exposeFunction('__call', (name, arg) => { calls.push([name, arg]); return null; });
  await ctx.addInitScript(fake);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  await sleep(500);
  await ctx.grantPermissions(['notifications'], { origin: URL.replace(/\/$/, '') });
  // No real push service here: stand in for the browser's sign-up.
  await page.evaluate(() => {
    const sub = { endpoint: 'https://push.example/abc', options: {}, toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: async () => true };
    const pm = { getSubscription: async () => null, subscribe: async () => sub };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager: pm }), register: async () => ({}) } });
    window.PushManager = window.PushManager || function () {};
    // Headless browsers keep notifications blocked: say yes when asked.
    Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'granted', requestPermission: async () => 'granted' } });
  });

  await check('Ctrl + K, “Phone alerts” opens the panel with the account’s switches', async () => {
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Phone alerts');
    await sleep(300);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.al-panel');
    assert.equal(await page.locator('.al-panel h2').innerText(), 'Phone alerts');
    const kinds = await page.locator('.al-kind b').allInnerTexts();
    assert.deepEqual(kinds, ['Day review at 9 pm', 'Needs you', 'Your week, on Mondays', 'Your month']);
    assert.equal(await page.locator('.al-kind input[data-kind="week"]').isChecked(), false, 'as the account has it');
    assert.equal(await page.locator('.al-kind input[data-kind="review"]').isChecked(), true);
  });

  await check('a switch is saved for the whole account', async () => {
    await page.locator('.al-kind input[data-kind="week"]').check();
    await sleep(300);
    const saved = calls.filter(([n]) => n === 'saveAlertPrefs').at(-1)?.[1];
    assert.equal(saved.week, true);
    assert.equal(saved.needs, true);
  });

  await check('turning alerts on asks permission and signs this device up as Inkwell’s', async () => {
    await page.locator('.al-on').click();
    await page.waitForFunction(() => /Alerts are on/.test(document.querySelector('.al-msg')?.textContent || ''));
    const sub = calls.find(([n]) => n === 'savePushSub')?.[1];
    assert.equal(sub.app, 'inkwell');
    assert.equal(sub.endpoint, 'https://push.example/abc');
    const test = calls.filter(([n, a]) => n === 'invoke' && a.body.action === 'test').at(-1)?.[1];
    assert.equal(test.body.app, 'inkwell');
    assert.match(await page.locator('.al-status').innerText(), /come from Inkwell now/);
    assert.equal(await page.locator('.al-on').innerText(), 'Turn off here');
    await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/alerts-panel.png` : '/dev/null' }).catch(() => {});
  });

  await check('turned off, this device’s sign-up is dropped', async () => {
    await page.evaluate(() => {
      const sub = { endpoint: 'https://push.example/abc', unsubscribe: async () => true };
      navigator.serviceWorker.ready.then((r) => { r.pushManager.getSubscription = async () => sub; });
    });
    await page.locator('.al-on').click();
    await sleep(400);
    assert.ok(calls.some(([n, e]) => n === 'dropPushSub' && e === 'https://push.example/abc'));
    assert.equal(await page.locator('.al-on').innerText(), 'Turn on alerts here');
    await page.keyboard.press('Escape');
  });

  await check('an alert for Needs you opens the Desk (?desk)', async () => {
    await page.goto(`${URL}?desk`);
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await page.waitForFunction(() => history.state?.view === 'desk');
  });

  await check('the service worker shows pushed alerts and opens their link', async () => {
    const sw = readFileSync('public/sw.js', 'utf8');
    assert.match(sw, /addEventListener\('push'/);
    assert.match(sw, /addEventListener\('notificationclick'/);
    assert.match(sw, /badge-96\.png/);
    assert.deepEqual(page.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nPhone alerts: all good');
