// A warning before a lesson or meeting (Nov 17 2026, the settings review).
// The strip that travels went with the old layout; what stays of it: five
// minutes before a calendar event, a quiet line at the top centre with its
// name and time ("Private lesson · 3:00 pm"), on every stop and in true focus.
// A tap puts it away; it leaves by itself when the event starts.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4283;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const TODAY = '2026-11-16';
const at = (s) => `${TODAY}T${s}:00-08:00`;
const EVENTS = [{ id: 'c1:lesson', title: 'Private lesson', start: at('15:00'), end: at('16:00'), allDay: false, calendar: 'Acro' }];

const now = Date.parse(at('09:00'));
const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 20 * 864e5, updated_at: now - 2 * 36e5 };
const row = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const task = (id, parent, sort, text, content, t = {}) => row(id, 'line', parent, sort, {
  text, content: content || [{ type: 'text', text }],
  fields: { done: false, box: true, task: { v: 1, day: TODAY, est: null, done_at: null, actual: null, log: [], run: null, order: sort, ...t } }
});
const SEED = [
  row('wd_nb', 'world', null, 1, { title: 'The Ninja Bunch', area_id: 'area-filmmaking', fields: { shape: 'show' } }),
  row('pr_hook', 'project', 'wd_nb', 1, { title: 'Reel 5', fields: { type: 'screenplay', stage: 'Writing', label: 'Reel' } }),
  row('ac_h', 'act', 'pr_hook', 1, { title: 'Screenplay' }),
  row('ch_hook', 'chapter', 'ac_h', 1, { title: 'Two-minute hook', fields: { words: 9 } }),
  row('pb_h', 'para', 'ch_hook', 1024, { text: 'Mom flips pancakes with a katana.', content: [{ type: 'text', text: 'Mom flips pancakes with a katana.' }], fields: { el: 'action' } }),
  row('pg_notes', 'page', 'wd_nb', 2, { title: 'Hook notes' }),
  row('page-tasks', 'page', null, 0, { title: 'Tasks' }),
  // Written on the world's notes page, linking to the script it's about.
  task('t_hook', 'pg_notes', 1024, 'Write the two-minute hook', [{ type: 'text', text: 'Write the ' }, { type: 'entryRef', attrs: { id: 'ch_hook', title: 'Two-minute hook' } }]),
  // Written on the world's notes page, with no link: it opens there.
  task('t_names', 'pg_notes', 2048, 'Name the three ninjas'),
  // On the Tasks page: nowhere to go.
  task('t_nate', 'page-tasks', 3072, 'Reply to Nate')
];
const seed = (rows) => new Promise((res, rej) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => {
    const tx = r.result.transaction(['entries', 'outbox'], 'readwrite');
    for (const x of rows) { tx.objectStore('entries').put(x); tx.objectStore('outbox').put({ id: x.id }); }
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  };
});

const browser = withoutSync(await chromium.launch());
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const warn = (p) => p.evaluate(() => { const w = document.querySelector('.ev-warn'); if (!w || w.hidden) return null; const r = w.getBoundingClientRect(); const cs = getComputedStyle(w); return { text: w.textContent, top: r.top, mid: r.left + r.width / 2, color: cs.color, opacity: cs.opacity }; });
const warnNow = async (p, want) => {
  for (let i = 0; i < 40; i++) { const w = await warn(p); if (!!w === want) return w; await sleep(100); }
  return warn(p);
};
const nudge = (p) => p.evaluate(() => window.__nowStrip?.soon());

async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, ...extra });
  await ctx.addInitScript((events) => { window.__calendar = async () => ({ connected: true, events }); }, EVENTS);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.install({ time: new Date(at('09:04')) });
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  await page.evaluate(seed, SEED);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return { ctx, page };
}

try {
  const { page } = await open({ width: 1400, height: 900 });

  await check('the strip that travels is gone: nothing under the top bar away from Today', async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('6');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'desk');
    await sleep(500);
    assert.equal(await page.locator('.now-strip').count(), 0);
    assert.equal(await warn(page), null, 'no event soon: nothing at the top');
  });

  await check('five minutes before a lesson: a quiet line at the top centre with its name and time', async () => {
    await page.clock.setSystemTime(new Date(at('14:56')));
    await nudge(page);
    const w = await warnNow(page, true);
    assert.equal(w?.text, 'Private lesson · 3:00 pm');
    assert.ok(w.top < 40, `at the top (${w.top})`);
    assert.ok(Math.abs(w.mid - 700) < 4, `in the centre (${w.mid})`);
    await shot(page, 'warn-desk');
  });

  await check('it shows on every stop, and in a draft while typing (true focus), where nothing else shows', async () => {
    for (const k of ['7', '3', '4']) {
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.keyboard.press(k);
      await sleep(300);
      assert.ok(await warnNow(page, true), `on stop ${k}`);
    }
    await page.keyboard.press('5');
    await sleep(300);
    await page.keyboard.press('Control+J');
    await page.keyboard.press('Control+J');
    await page.waitForFunction(() => !document.documentElement.dataset.view);
    await page.locator('#editor .ProseMirror').click();
    await page.keyboard.type('Words. ');
    await page.waitForFunction(() => document.body.classList.contains('typing'));
    await sleep(400);
    const w = await warnNow(page, true);
    assert.ok(w && Number(w.opacity) > 0.9, 'still there in true focus');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.zm-ruler')).opacity), '0', 'the ruler has faded');
    await shot(page, 'warn-focus');
    await page.keyboard.press('Escape');
  });

  await check('a click puts it away, and it stays away for that event', async () => {
    await page.locator('.ev-warn').click();
    assert.equal(await warnNow(page, false), null);
    await page.clock.setSystemTime(new Date(at('14:57')));
    await nudge(page);
    await sleep(400);
    assert.equal(await warn(page), null);
  });

  await check('it leaves by itself when the event starts', async () => {
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await page.clock.setSystemTime(new Date(at('14:58')));
    await nudge(page);
    assert.ok(await warnNow(page, true), 'back after a reload, before it starts');
    await page.clock.setSystemTime(new Date(at('15:00')));
    await page.clock.runFor(2000);
    await nudge(page);
    assert.equal(await warnNow(page, false), null);
  });
  assert.deepEqual(page.errors, []);

  // ---------- the phone ----------
  const { page: phone } = await open({ width: 412, height: 915 }, { hasTouch: true, isMobile: true });
  await check('phone: the same quiet line at the top, a tap puts it away', async () => {
    await phone.clock.setSystemTime(new Date(at('14:56')));
    await nudge(phone);
    const w = await warnNow(phone, true);
    assert.equal(w?.text, 'Private lesson · 3:00 pm');
    assert.ok(w.top < 80, `at the top (${w.top})`);
    // Just under the top line, never over the date (Nov 18 2026).
    const line = await phone.evaluate(() => [...document.querySelectorAll('.topbar, .zm-top')].map((e) => e.getBoundingClientRect()).find((r) => r.height > 0)?.bottom || 0);
    assert.ok(w.top >= line - 1, `under the top line (${w.top} < ${line})`);
    await shot(phone, 'warn-phone');
    await phone.locator('.ev-warn').tap();
    assert.equal(await warnNow(phone, false), null);
  });
  assert.deepEqual(phone.errors, []);
} catch (e) {
  failed += 1;
  console.log(`FAIL ${e.message}`);
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
