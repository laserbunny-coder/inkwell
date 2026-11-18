// Today on the zoom (since the old layout went, Nov 17 2026): no cursor on
// arrival, tasks left from earlier days as one quiet line that is never a
// place tasks get stuck (the triangle shows them, To today with Alt + Shift +
// T and Undo), and no sideways scroll anywhere on a phone.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4292;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const browser = withoutSync(await chromium.launch());

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`); }
}
const started = (p) => p.waitForFunction(() => document.documentElement.dataset.started === '1');
const go = async (p, place) => {
  await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
  await p.waitForFunction((pl) => (document.documentElement.dataset.view || 'write') === pl.view, place);
  await sleep(450);
};
const add = async (p, text) => { const input = p.locator('#plan-sheet input[data-add]').first(); await input.fill(text); await input.press('Enter'); await sleep(250); };
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const named = async (p, text) => (await all(p)).find((r) => r.text === text && r.fields?.task);
const OLD = { '2026-11-09': ['Renew the domain', 'Invoice for October'], '2026-11-10': ['Email the gym', 'Reply to the festival'], '2026-11-12': ['Balance pass'] };
const TODAY = ['Pick up the drives', 'Grade reel 1', 'Call Dana'];

// A device with five tasks left from earlier days and three for today (Sat, Nov 14).
// Each goes in on Today's list (the clock set to its day).
async function device(opts) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', ...opts });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  let first = true;
  for (const [d, list] of Object.entries(OLD)) {
    await p.clock.setFixedTime(new Date(`${d}T09:00:00-08:00`));
    if (first) await p.goto(URL); else await p.reload();
    first = false;
    await started(p);
    await go(p, { view: 'plan', tab: 'day' });
    for (const t of list) await add(p, t);
  }
  await p.clock.setFixedTime(new Date('2026-11-14T08:30:00-08:00'));
  await p.reload();
  await started(p);
  await go(p, { view: 'plan', tab: 'day' });
  for (const t of TODAY) await add(p, t);
  await p.evaluate(() => document.activeElement?.blur());
  return p;
}
const toToday = (p) => go(p, { view: 'plan', tab: 'day' });

try {
  // ---------- phone ----------
  const phone = await device({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

  await check('phone: arriving on Today leaves the keyboard down', async () => {
    await go(phone, { view: 'desk' });
    await go(phone, { view: 'plan', tab: 'day' });
    assert.ok(!(await phone.evaluate(() => document.activeElement?.closest?.('.ProseMirror, input, textarea'))), 'no cursor');
  });

  await check('phone: earlier days are one quiet line, and the triangle shows them in place', async () => {
    const line = phone.locator('#plan-sheet .pl-early.quiet');
    await line.waitFor();
    assert.match(await line.innerText(), /5 left from earlier days/);
    assert.equal(await phone.locator('#plan-sheet .pl-task.carried').count(), 0);
    await line.locator('.pl-early-tri').tap();
    await phone.waitForFunction(() => document.querySelectorAll('#plan-sheet .pl-task.carried').length === 5);
    await phone.locator('#plan-sheet .pl-early-tri').tap();
    await phone.waitForFunction(() => !document.querySelector('#plan-sheet .pl-task.carried'));
  });

  await check('phone: no sideways scroll in any stop', async () => {
    for (const place of [{ view: 'notebook', pageId: 'day-2026-11-14' }, { view: 'desk' }, { view: 'library' }, { view: 'tags' }, { view: 'drawer' }, { view: 'plan', tab: 'day' }, { view: 'plan', tab: 'now' }, { view: 'plan', tab: 'week' }, { view: 'plan', tab: 'calday' }]) {
      await go(phone, place);
      const [sw, cw] = await phone.evaluate(() => [document.scrollingElement.scrollWidth, document.scrollingElement.clientWidth]);
      assert.ok(sw <= cw, `${place.view}${place.tab ? ` ${place.tab}` : ''}: ${sw} > ${cw}`);
    }
  });

  await check('phone: no page errors', async () => { assert.deepEqual(phone.errors, []); });

  // ---------- computer ----------
  const pc = await device({ viewport: { width: 1280, height: 800 } });

  await check('computer: To today (Alt + Shift + T) moves them all to the top of today, Undo puts each back', async () => {
    await toToday(pc);
    await pc.keyboard.press('Alt+Shift+KeyT');
    await pc.waitForFunction(() => /5 moved to today/.test(document.querySelector('.toast')?.textContent || ''));
    const words = () => pc.evaluate(() => [...document.querySelectorAll('#plan-sheet .pl-list [data-task] .pl-words')].map((el) => el.textContent.trim()));
    await pc.waitForFunction(() => document.querySelectorAll('#plan-sheet .pl-list [data-task] .pl-words').length >= 8).catch(() => {});
    assert.deepEqual(await words(), ['Renew the domain', 'Invoice for October', 'Email the gym', 'Reply to the festival', 'Balance pass', ...TODAY]);
    assert.equal(await pc.locator('#plan-sheet .pl-early').count(), 0);
    await pc.locator('.toast .toast-action', { hasText: 'Undo' }).click();
    await pc.waitForFunction(() => document.querySelector('#plan-sheet .pl-early'));
    assert.equal((await named(pc, 'Renew the domain')).fields.task.day, '2026-11-09');
    assert.equal((await named(pc, 'Reply to the festival')).fields.task.day, '2026-11-10');
    assert.equal((await named(pc, 'Balance pass')).fields.task.day, '2026-11-12');
  });

  await check('computer: no hours anywhere in Week', async () => {
    await go(pc, { view: 'plan', tab: 'week' });
    const text = await pc.locator('#plan-sheet').innerText();
    assert.doesNotMatch(text, /\d+(\.\d)? h\b|\d+ min\b/);
    assert.equal(await pc.locator('.pw-areas').count(), 0);
  });

  await check('computer: no page errors', async () => { assert.deepEqual(pc.errors, []); });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nToday: all good');
process.exit(failed ? 1 : 0);
