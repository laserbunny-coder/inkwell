// Inkwell connects Google Calendar itself: the command list says whether it is
// connected, Connect starts Google's sign-in asking for the calendar (read
// only), and coming back connected says so and looks again.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4277;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const pick = async (p, name) => {
  if (!(await p.locator('#palette-input').isVisible())) await p.keyboard.press('Control+K');
  await p.waitForSelector('#palette-list li');
  await p.locator('#palette-input').fill(name);
  await p.waitForFunction((n) => document.querySelector('#palette-list li')?.textContent.includes(n), name);
  await p.locator('#palette-input').press('Enter');
};

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 4).join('\n     ')}`); }
}

const calls = [];
const fake = () => {
  const call = (name, arg) => window.__call(name, arg);
  window.__has = false;
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: async (rows) => rows.map((r) => ({ id: r.id, updated_at: new Date().toISOString() })),
    pull: async () => [],
    async upload() {}, async download() { throw new Error('not found'); },
    subscribe() {}, unsubscribe() {},
    desk: async () => ({ needs: [], updates: [] }), deskAll: async () => ({ needs: [], updates: [] }),
    alertPrefs: async () => ({}), saveAlertPrefs: async () => {}, savePushSub: async () => {}, dropPushSub: async () => {},
    hasCalendar: async () => window.__has,
    connectCalendar: () => call('connectCalendar', null),
    invoke: (name, body) => call('invoke', { name, body }).then(() => (name === 'calendar' ? { connected: window.__has, events: [] } : {}))
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

  const open = async () => {
    await pick(page, 'Google Calendar');
    await page.waitForSelector('.ask');
  };

  await check('not connected yet: Ctrl + K, “Google Calendar” offers to connect, and Connect asks Google', async () => {
    await open();
    assert.match(await page.locator('.ask').innerText(), /Connect your Google Calendar[\s\S]*only reads/);
    await page.locator('.ask button', { hasText: /^Connect$/ }).click();
    await sleep(200);
    assert.ok(calls.some(([n]) => n === 'connectCalendar'));
  });

  await check('back from Google: it says so and asks the calendar again', async () => {
    const before = calls.filter(([n, a]) => n === 'invoke' && a.name === 'calendar').length;
    await page.evaluate(() => { window.__has = true; dispatchEvent(new CustomEvent('calendar-connected', { detail: { ok: true } })); });
    await page.waitForFunction(() => /Google Calendar is connected/.test(document.querySelector('.toast')?.textContent || ''));
    await page.evaluate(() => document.querySelector('#view-toggle')?.click());
    await sleep(800);
    assert.ok(calls.filter(([n, a]) => n === 'invoke' && a.name === 'calendar').length >= before);
  });

  await check('connected: the command says so and offers to connect again', async () => {
    await open();
    assert.match(await page.locator('.ask').innerText(), /Your Google Calendar is connected/);
    await page.keyboard.press('Escape');
    assert.deepEqual(page.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nGoogle Calendar: all good');
