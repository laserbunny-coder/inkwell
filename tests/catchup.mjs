// Catch-up: what Claude threads did today across every Claude project, and
// what needs you. The real list lives in Daybook's tables; here a stand-in
// (window.__catchup) plays Daybook, and window.__claude plays the server.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4261;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;

const T = (s) => new Date(`${s}-08:00`).toISOString();
const NOW = '2026-11-06T14:04:00';
const HQ = 'https://claude.ai/code/project/chan_hq';
const INK = 'https://claude.ai/code/project/chan_ink';

// What Daybook holds. done/later change it the way the real tables would.
const db = {
  needs: [
    { id: 'n1', kind: 'decision', title: 'Cheer launch: settle the drill shooting approach with Nate', project: 'Acro and Cheer HQ', link: `${HQ}?thread=a`, project_link: HQ, created_at: T('2026-11-01T00:09:00'), body: '' },
    { id: 'n2', kind: 'blocked', title: 'Send the Skool dashboard screenshot and the retention table', project: 'Acro and Cheer HQ', link: `${HQ}?thread=b`, project_link: HQ, created_at: T('2026-11-01T00:15:00'), body: '' },
    { id: 'n3', kind: 'review', title: 'Try the checklists and the 9 pm review card', project: 'Inkwell', link: `${INK}?thread=c`, project_link: INK, created_at: T('2026-11-03T00:32:00'), body: 'Guide: https://claude.ai/artifact/TWiva1NCJiSjZgkvJNXGiy' },
    { id: 'n4', kind: 'review', title: 'Try side-by-side panes (middle-click the dots)', project: 'Inkwell', link: `${INK}?thread=d`, project_link: INK, created_at: T('2026-11-05T03:43:00'), body: '' },
    { id: 'n5', kind: 'review', title: 'Try Woven scripts on a Ninja Bunch reel', project: 'Inkwell', link: `${INK}?thread=e`, project_link: INK, created_at: T('2026-11-06T11:15:00'), body: '' },
  ],
  updates: [
    { id: 'u0', project: 'Inkwell', project_link: INK, link: `${INK}?thread=old`, thread: 'Old thread', text: 'Yesterday’s thing', place: null, state: 'done', created_at: T('2026-11-05T16:00:00') },
    { id: 'u1', project: 'Acro and Cheer HQ', project_link: HQ, link: `${HQ}?thread=h`, thread: 'Hold and swap reels', text: 'Hold, one-tap swap, re-makes and retries are live on the board', place: 'https://acro-hq.laserbunny.workers.dev', state: 'live', created_at: T('2026-11-06T01:24:00') },
    { id: 'u2', project: 'Inkwell', project_link: INK, link: `${INK}?thread=e`, thread: 'Build Woven scripts', text: 'Woven step 2 (Prepare for shoot) is in testing on the Ninja Bunch pilot', place: `${URL}?open=day-2026-11-06`, state: 'working', created_at: T('2026-11-06T11:30:00') },
    { id: 'u3', project: 'Acro and Cheer HQ', project_link: HQ, link: `${HQ}?thread=r`, thread: 'Re-cut reels', text: 'Two reels re-cut after your notes, back on the board', place: null, state: 'done', created_at: T('2026-11-06T13:15:00') },
  ],
};
const calls = [];
const asked = [];

const browser = withoutSync(await chromium.launch());
async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, ...extra });
  await ctx.exposeFunction('__db', (op, a, b) => {
    calls.push([op, a, b]);
    if (op === 'fetch') return { needs: db.needs.filter((n) => !n.resolved_at).map((n) => ({ ...n })), updates: db.updates.filter((u) => u.created_at >= a).map((u) => ({ ...u })) };
    const n = db.needs.find((x) => x.id === a);
    if (op === 'done') n.resolved_at = new Date().toISOString();
    if (op === 'later') n.snoozed_until = b;
    return null;
  });
  await ctx.exposeFunction('__toClaude', (body) => {
    if (body.mode !== 'catchup') return {};
    asked.push(body);
    return { line: 'Acro HQ’s hold-and-swap went live overnight. Two things need a real answer from you, both five days old; three are try-it items.' };
  });
  await ctx.addInitScript(() => {
    window.__claude = (body) => window.__toClaude(body);
    window.__catchup = {
      catchup: (since) => window.__db('fetch', since),
      doneNeed: (id) => window.__db('done', id),
      laterNeed: (id, until) => window.__db('later', id, until),
    };
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.setFixedTime(new Date(`${NOW}-08:00`));
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return page;
}

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

try {
  const page = await open({ width: 1280, height: 900 });
  // Seen before: this morning at 9:40.
  await page.evaluate(() => localStorage.setItem('catchupSeen', String(Date.parse('2026-11-06T09:40:00-08:00'))));

  await check('Ctrl + Shift + U opens Catch-up, and the top bar button is lit', async () => {
    await page.keyboard.press('Control+Shift+U');
    await page.waitForSelector('.catchup-home .cu-item', { state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.view), 'catchup');
    assert.equal(await page.locator('#catchup-toggle').getAttribute('aria-current'), 'page');
    assert.match(await page.locator('.cu-date').innerText(), /FRIDAY, NOV 6 · 2:04 PM/i);
    assert.match(await page.locator('.cu-seen').innerText(), /new since you last looked \(9:40 am\)/);
  });

  await check('decisions and blocked work sit on top; try-it items fold into one group', async () => {
    const top = await page.locator('.cu-needs > .cu-item .cu-t').allInnerTexts();
    assert.deepEqual(top.map((t) => t.replace(/^(Decide|Do)/, '').trim()), ['Cheer launch: settle the drill shooting approach with Nate', 'Send the Skool dashboard screenshot and the retention table']);
    assert.match(await page.locator('.cu-needs > .cu-label').innerText(), /Needs you · 5/i);
    assert.match(await page.locator('.cu-tries summary').innerText(), /Try when you have 10 minutes\s*3\s*1 new/);
    assert.equal(await page.locator('.cu-tries').evaluate((d) => d.open), false);
    assert.match(await page.locator('.cu-needs > .cu-item').first().locator('.cu-m').innerText(), /Acro and Cheer HQ · waiting 5 days/);
  });

  await check('every line links to its thread; a guide in the details comes along', async () => {
    assert.equal(await page.locator('.cu-needs > .cu-item .cu-t').first().getAttribute('href'), `${HQ}?thread=a`);
    await page.locator('.cu-tries summary').click();
    const row = page.locator('.cu-tries .cu-item', { hasText: 'checklists' });
    assert.equal(await row.locator('a.cu-place').getAttribute('href'), 'https://claude.ai/artifact/TWiva1NCJiSjZgkvJNXGiy');
    assert.equal(await row.locator('a.cu-place').innerText(), 'Guide');
  });

  await check('what happened today: grouped by project, newest project first, yesterday left out', async () => {
    const groups = await page.locator('.cu-happened .cu-proj').allInnerTexts();
    assert.deepEqual(groups, ['Acro and Cheer HQ', 'Inkwell']);
    const text = await page.locator('.cu-happened').innerText();
    assert.doesNotMatch(text, /Yesterday’s thing/);
    assert.match(text, /1:24 am\s*Live\s*Hold, one-tap swap/);
    assert.match(text, /Still working · 1\s*Build Woven scripts/i);
    assert.equal(await page.locator('.cu-happened .cu-ev', { hasText: 'Two reels' }).locator('.cu-new').count(), 1);
    assert.equal(await page.locator('.cu-happened .cu-ev', { hasText: 'Hold, one-tap' }).locator('.cu-new').count(), 0);
    assert.equal(await page.locator('.cu-happened .cu-ev', { hasText: 'Hold, one-tap' }).locator('a.cu-place').innerText(), 'acro-hq.laserbunny.workers.dev');
  });

  await check('Claude’s read sits at the top, asked once with what’s shown', async () => {
    await page.waitForSelector('.cu-read:not(.stale):not([hidden])');
    assert.match(await page.locator('.cu-read').innerText(), /hold-and-swap went live/);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].updates.length, 3);
    assert.equal(asked[0].needs.length, 5);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/d-catchup.png` });
  });

  await check('Done takes a Needs you item off the list (Daybook too)', async () => {
    await page.locator('.cu-needs > .cu-item', { hasText: 'Skool' }).getByRole('button', { name: 'Done' }).click();
    await page.waitForFunction(() => !document.querySelector('.cu-item[data-id="n2"]'));
    assert.ok(calls.some(([op, id]) => op === 'done' && id === 'n2'));
    assert.ok(db.needs.find((n) => n.id === 'n2').resolved_at);
  });

  await check('Later sets one aside until 7 am tomorrow, and it can come back', async () => {
    await page.locator('.cu-tries .cu-item', { hasText: 'panes' }).getByRole('button', { name: 'Later' }).click();
    await page.waitForFunction(() => !document.querySelector('.cu-item[data-id="n4"]'));
    assert.equal(db.needs.find((n) => n.id === 'n4').snoozed_until, new Date('2026-11-07T07:00:00-08:00').toISOString());
    assert.match(await page.locator('.cu-later-note').innerText(), /1 set aside until tomorrow morning/);
    await page.locator('.cu-later-note').getByRole('button', { name: 'Bring back' }).click();
    await page.waitForSelector('.cu-item[data-id="n4"]');
    assert.equal(db.needs.find((n) => n.id === 'n4').snoozed_until, null);
  });

  await check('an Inkwell place opens right here', async () => {
    await page.locator('.cu-happened .cu-ev', { hasText: 'Woven step 2' }).locator('a.cu-place').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    await page.goBack();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'catchup');
  });

  await check('Aa switches: the top bar button and Claude’s line can each be put away', async () => {
    await page.evaluate(() => { const c = document.querySelector('[data-show="catchup"]'); c.checked = false; c.dispatchEvent(new Event('change')); });
    assert.equal(await page.locator('#catchup-toggle').isVisible(), false);
    await page.evaluate(() => { const c = document.querySelector('[data-show="cuclaude"]'); c.checked = false; c.dispatchEvent(new Event('change')); });
    await page.keyboard.press('Control+J');
    await page.keyboard.press('Control+Shift+U');
    await sleep(800);
    await page.waitForFunction(() => document.querySelector('.cu-item') && !document.querySelector('.cu-read')?.offsetParent);
    await page.evaluate(() => { for (const k of ['catchup', 'cuclaude']) { const c = document.querySelector(`[data-show="${k}"]`); c.checked = true; c.dispatchEvent(new Event('change')); } });
    assert.equal(await page.locator('#catchup-toggle').isVisible(), true);
  });

  await check('signed out, it says how to see it', async () => {
    await page.evaluate(() => { window.__saved = window.__catchup; window.__catchup = null; });
    await page.keyboard.press('Control+J');
    await page.keyboard.press('Control+Shift+U');
    await page.waitForSelector('.cu-empty');
    assert.match(await page.locator('.cu-empty').innerText(), /Sign in/);
    await page.evaluate(() => { window.__catchup = window.__saved; });
  });

  await check('no page errors on desktop', async () => { assert.deepEqual(page.errors, []); });

  // ---- phone ----
  const phone = await open({ width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await check('on a phone it opens from Go and stacks into one column', async () => {
    await phone.evaluate(() => localStorage.setItem('catchupSeen', String(Date.parse('2026-11-06T09:40:00-08:00'))));
    await sleep(1000);
    await phone.waitForFunction(() => { document.activeElement?.blur(); return !document.body.classList.contains('kb-up') && !document.querySelector('.outline-bar')?.offsetParent && !document.querySelector('.script-bar')?.offsetParent; });
    await sleep(200);
    await phone.locator('.pb-place').tap();
    await phone.waitForSelector('.go-panel', { state: 'visible' });
    await phone.locator('.go-desk .go-tab', { hasText: 'Catch-up' }).tap();
    await phone.waitForSelector('.cu-item', { state: 'visible' });
    const needs = await phone.locator('.cu-needs').boundingBox(), happened = await phone.locator('.cu-happened').boundingBox();
    assert.ok(happened.y > needs.y + needs.height - 1, 'happened sits under needs');
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(wide <= 391, `page is ${wide} wide`);
    if (SHOTS) {
      await phone.waitForSelector('.cu-read:not([hidden])');
      await phone.screenshot({ path: `${SHOTS}/p-catchup.png` });
      await phone.locator('.cu-tries summary').click();
      await phone.screenshot({ path: `${SHOTS}/p-catchup-tries.png`, fullPage: true });
    }
    assert.deepEqual(phone.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall catch-up checks passed');
