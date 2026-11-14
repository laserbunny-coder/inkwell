// Page, Plan, Calendar (Nov 14 2026, build 1b). Plan is one outline from
// today outward (earlier days, Today, Tomorrow, This week, Next week, the
// month, Later, Not planned), each heading folding with its count and
// remembered. Calendar is one view with a zoom: Day, Week, Six weeks (Alt + 3
// steps it). On a phone the week fits one screen and a day opens in Plan.
// Old places (What's when, Weeks ahead) still land on the right view.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4293;
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
const add = async (p, text) => { const input = p.locator('#plan input[data-add]').first(); await input.fill(text); await input.press('Enter'); await sleep(250); };
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const named = async (p, text) => (await all(p)).find((r) => r.text === text && r.fields?.task);
const OLD = { '2026-11-12': ['Balance pass'] };
const TODAY = ['Pick up the drives', 'Grade reel 1', 'Call Dana', 'Book the hall'];

async function device(opts, { estimates = false, todayPage = false } = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', estimates, todayPage, ...opts });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('pv')) { sessionStorage.setItem('pv', '1'); localStorage.setItem('todayPhone', 'plan'); } } catch { /* no storage */ } });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  let first = true;
  for (const [d, list] of Object.entries(OLD)) {
    await p.clock.setFixedTime(new Date(`${d}T09:00:00-08:00`));
    if (first) await p.goto(URL); else await p.reload();
    first = false;
    await started(p);
    await go(p, { view: 'notebook', pageId: `day-${d}` });
    for (const t of list) await add(p, t);
  }
  await p.clock.setFixedTime(new Date('2026-11-14T08:30:00-08:00'));
  await p.reload();
  await started(p);
  await go(p, { view: 'notebook', pageId: 'day-2026-11-14' });
  for (const t of TODAY) await add(p, t);
  await p.evaluate(() => document.activeElement?.blur());
  await sleep(200);
  return p;
}
const heads = (p, root) => p.locator(`${root} .ww-sec .ww-name`).allInnerTexts();
const HEADS = ['Today', 'Tomorrow', 'This week', 'Next week', 'This month', 'Later', 'Not planned'];

try {
  // ---------- computer ----------
  const pc = await device({ viewport: { width: 1440, height: 900 } }, { estimates: false });

  await check('computer: the switch is Today, Plan, Calendar; under today’s list, Tomorrow, This week and Further out', async () => {
    assert.deepEqual(await pc.locator('.today-switch .tb-btn').allInnerTexts(), ['Today', 'Plan', 'Calendar']);
    const lines = await pc.locator('#plan .pl-further .ww-name').allInnerTexts();
    assert.deepEqual(lines, ['Tomorrow', 'This week', 'Further out']);
  });

  await check('computer: a task dropped on “Tomorrow” under today’s list goes to tomorrow, with Undo', async () => {
    const row = pc.locator('#plan .pl-task', { hasText: 'Book the hall' });
    await row.dragTo(pc.locator('#plan .pl-fline[data-bucket="tomorrow"] .ww-fold'));
    await pc.waitForFunction(async () => true);
    await sleep(500);
    assert.equal((await named(pc, 'Book the hall')).fields.task.day, '2026-11-15');
    assert.match(await pc.locator('.toast').innerText(), /Tomorrow/);
    assert.equal(await pc.locator('#plan .pl-fline[data-bucket="tomorrow"] .ww-n').innerText(), '1');
  });

  await check('computer: Alt + 2 is Plan, the whole outline; Today open, the rest folded', async () => {
    await pc.keyboard.press('Alt+2');
    await pc.waitForSelector('#plan-sheet .ww-sec');
    assert.deepEqual(await heads(pc, '#plan-sheet'), HEADS);
    const open = await pc.locator('#plan-sheet .ww-sec:not(.folded) .ww-name').allInnerTexts();
    assert.deepEqual(open, ['Today']);
    assert.equal(await pc.locator('#plan-sheet .ww-sec[data-bucket="tomorrow"] .ww-n').innerText(), '1');
  });

  await check('computer: Today in Plan is the same list as on today’s page', async () => {
    const inPlan = await pc.locator('#plan-sheet .ol-today .pl-task:not(.done) .pl-words').allInnerTexts();
    await pc.keyboard.press('Alt+1');
    await pc.waitForSelector('#plan .pl-task');
    const onPage = await pc.locator('#plan .pl-task:not(.done) .pl-words').allInnerTexts();
    assert.deepEqual(inPlan, onPage);
  });

  await check('computer: a heading folds and unfolds, and stays so after a reload; drag from Tomorrow to Today sets the day', async () => {
    await pc.keyboard.press('Alt+2');
    await pc.waitForSelector('#plan-sheet .ww-sec[data-bucket="tomorrow"]');
    await pc.locator('#plan-sheet .ww-sec[data-bucket="tomorrow"] .ww-fold').click();
    await pc.waitForSelector('#plan-sheet .ww-sec[data-bucket="tomorrow"]:not(.folded) .pl-task');
    await pc.reload();
    await started(pc);
    await pc.waitForSelector('#plan-sheet .ww-sec[data-bucket="tomorrow"]:not(.folded) .pl-task');
    await pc.locator('#plan-sheet .ww-sec[data-bucket="tomorrow"] .pl-task', { hasText: 'Book the hall' }).dragTo(pc.locator('#plan-sheet .ol-today .ww-fold'));
    await sleep(600);
    assert.equal((await named(pc, 'Book the hall')).fields.task.day, '2026-11-14');
  });

  await check('computer: Not planned holds tasks with no day, by project; dropped on Next week it gets that week', async () => {
    const row = pc.locator('#plan-sheet .ol-today .pl-task', { hasText: 'Call Dana' });
    await row.dragTo(pc.locator('#plan-sheet .ww-none .ww-fold'));
    await sleep(600);
    const t = (await named(pc, 'Call Dana')).fields.task;
    assert.ok(!t.day, 'off its day');
    assert.equal(await pc.locator('#plan-sheet .ww-none > .ww-h .ww-n').innerText(), '1');
    await pc.waitForSelector('#plan-sheet .ww-none:not(.folded)');
    assert.ok(await pc.locator('#plan-sheet .ww-none .ww-group', { hasText: 'Tasks with no project' }).count());
    await pc.locator('#plan-sheet .ww-none .ww-group').click();
    await pc.locator('#plan-sheet .ww-none .pl-task', { hasText: 'Call Dana' }).dragTo(pc.locator('#plan-sheet .ww-sec[data-bucket="next"] .ww-fold'));
    await sleep(600);
    const t2 = (await named(pc, 'Call Dana')).fields.task;
    assert.equal(t2.span?.kind, 'week');
    assert.equal(t2.span?.start, '2026-11-16');
    await pc.waitForSelector('#plan-sheet .ww-sec[data-bucket="next"]:not(.folded)');
    assert.equal(await pc.locator('#plan-sheet .ww-sec[data-bucket="next"] .pl-task .ww-date').innerText(), 'any day');
    await pc.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(600);
    assert.ok(!(await named(pc, 'Call Dana')).fields.task.span, 'Undo puts it back');
  });

  await check('computer: Alt + 3 is Calendar on the zoom used last; Alt + 3 again steps Day, Week, Six weeks', async () => {
    await pc.keyboard.press('Alt+3');
    await pc.waitForFunction(() => document.querySelector('#plan-sheet')?.dataset.tab === 'week');
    assert.equal(await pc.locator('.pl-zoom button[aria-pressed="true"]').innerText(), 'Week');
    assert.deepEqual(await pc.locator('.pl-zoom button').allInnerTexts(), ['Day', 'Week', 'Six weeks']);
    await pc.keyboard.press('Alt+3');
    await pc.waitForFunction(() => document.querySelector('#plan-sheet')?.dataset.tab === 'ahead');
    await pc.keyboard.press('Alt+3');
    await pc.waitForFunction(() => document.querySelector('#plan-sheet')?.dataset.tab === 'calday');
    await pc.waitForSelector('#plan-sheet .dc');
    await pc.keyboard.press('Alt+1');
    await pc.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    await sleep(400);
    await pc.keyboard.press('Alt+3');
    await pc.waitForFunction(() => document.documentElement.dataset.view === 'plan' && document.querySelector('#plan-sheet')?.dataset.tab === 'calday');
    await sleep(300);
    assert.equal(await pc.locator('.today-switch [aria-current="page"]').innerText(), 'Calendar');
  });

  await check('computer: old places land on the new views; no “What’s when” anywhere', async () => {
    await go(pc, { view: 'plan', tab: 'when' });
    await pc.waitForFunction(() => document.querySelector('#plan-sheet')?.dataset.tab === 'plan');
    assert.equal(await pc.locator('#plan-sheet h1').innerText(), 'Plan');
    await go(pc, { view: 'plan', tab: 'ahead' });
    await pc.waitForFunction(() => document.querySelector('#plan-sheet')?.dataset.tab === 'ahead');
    assert.equal(await pc.locator('.pl-zoom button[aria-pressed="true"]').innerText(), 'Six weeks');
    const text = await pc.evaluate(() => document.documentElement.outerHTML);
    assert.ok(!/What’s when|What's when/.test(text), 'no What’s when left on the screen');
    await pc.keyboard.press('Control+k');
    await pc.keyboard.type("what's when"); // a straight apostrophe, as a keyboard types it
    await sleep(300);
    assert.match(await pc.locator('#palette-list li').first().innerText(), /^Plan/);
    await pc.keyboard.press('Escape');
    assert.deepEqual(pc.errors, []);
  });

  // ---------- phone ----------
  const phone = await device({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

  await check('phone: Page, Plan, Calendar; Plan is the whole outline from today', async () => {
    await go(phone, { view: 'desk' });
    await go(phone, { view: 'notebook', pageId: 'day-2026-11-14' });
    assert.deepEqual(await phone.locator('.tp-switch .pl-switch button').allInnerTexts(), ['Page', 'Plan', 'Calendar']);
    assert.deepEqual(await heads(phone, '#plan'), HEADS);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  });

  await check('phone: Calendar’s week fits one screen, a row a day and Any day; a tap opens that day in Plan', async () => {
    await phone.locator('.tp-switch button', { hasText: 'Calendar' }).tap();
    await phone.waitForSelector('.pw-rows .pw-row');
    assert.equal(await phone.locator('.pw-rows .pw-row').count(), 8);
    const last = await phone.locator('.pw-rows .pw-row').last().boundingBox();
    const bar = await phone.locator('.placebar').boundingBox();
    assert.ok(last.y + last.height <= bar.y + 1, `the week ends at ${last.y + last.height}, the bar starts at ${bar.y}`);
    assert.match(await phone.locator('.pw-row.past', { hasText: 'Balance pass' }).innerText(), /1 left/);
    await phone.locator('.pw-row[data-day="2026-11-13"] .pw-rb').tap();
    await phone.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    await sleep(400);
    assert.match(await phone.locator('#nb-title').innerText(), /Nov 13|November 13/);
    assert.ok(await phone.locator('#plan .pl-head').isVisible(), 'that day’s plan');
    assert.deepEqual(phone.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall Page, Plan, Calendar checks passed');
