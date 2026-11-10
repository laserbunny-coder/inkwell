// Bring in Daybook: its projects, steps, tasks, repeats, time logs and done
// history become Inkwell's own. Daybook is only read (a stand-in here:
// window.__daybookItems). The box says what would come in before anything is
// written, bringing in again adds nothing twice, and the last time can be
// taken back.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4273;
const DIST = process.env.DIST;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(DIST ? ['--outDir', DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const NOW = '2026-11-09T14:04:00-08:00'; // a Monday, 2:04 pm

const at = (s) => `${s}:00-08:00`;
const it = (id, title, extra = {}) => ({ id, parent_id: null, title, notes: null, done: false, day: null, start_min: null, duration_min: 60, sort: 1, due: null, deleted: false, link: null, kind: null, area_id: null, start: null, milestone: false, hard_deadline: false, waits_on: null, done_at: null, actual_minutes: null, repeat_rule: null, series_id: null, occurs_on: null, time_log: [], habit: false, days_done: null, labels: [], updated_at: at('2026-11-01T09:00'), ...extra });
// What Daybook holds.
const DAYBOOK = [
  it('area-film', 'Filmmaking', { kind: 'area', sort: 1, week_minutes: 600 }),
  it('area-garden', 'Garden', { kind: 'area', sort: 2, color: '#7BC8A4' }),
  it('lb1', 'errand', { kind: 'label' }),
  it('blk1', 'Deep work', { kind: 'block', day: '2026-11-10' }),
  it('gone1', 'Old thing', { deleted: true }),
  // A project that is already a world here, by name.
  it('p-nb', 'The Ninja Bunch', { area_id: 'area-film', sort: 1, due: '2026-12-14', hard_deadline: true, notes: 'Reels first.\nThen the pilot.', link: 'https://example.com/ninja' }),
  it('s1', 'Board Reel 2', { parent_id: 'p-nb', sort: 1, day: '2026-11-10', duration_min: 90, notes: 'Use the dojo set.', link: 'https://example.com/board' }),
  it('s2', 'Reel 1 prompts', { parent_id: 'p-nb', sort: 2, done: true, day: '2026-11-05', done_at: at('2026-11-05T15:00'), actual_minutes: 120, time_log: [{ start: at('2026-11-05T13:00'), end: at('2026-11-05T15:00') }, { start: at('2026-11-05T15:00'), end: at('2026-11-05T16:00'), guess: true }] }),
  it('s3', 'Sound pass', { parent_id: 'p-nb', sort: 3, start: '2026-11-16', due: '2026-11-27' }),
  it('s3a', 'Foley', { parent_id: 's3', sort: 1, day: '2026-11-17', waits_on: 's1' }),
  it('s4', 'Festival entry', { parent_id: 'p-nb', sort: 4, milestone: true, due: '2026-11-20' }),
  // A project that is new here.
  it('p-shed', 'Build the shed', { area_id: 'area-garden', sort: 2 }),
  it('s5', 'Order lumber', { parent_id: 'p-shed', sort: 1, due: '2026-11-13' }),
  // Tasks on their own.
  it('t1', 'Renew passport', { sort: 3, day: '2026-11-11', duration_min: 30, labels: ['lb1'], start_min: 570 }),
  it('t2', 'Morning pages', { sort: 4, day: '2026-10-01', habit: true, repeat_rule: { every: 'day' }, days_done: ['2026-11-07', '2026-11-08'] }),
  it('t3', 'Review the week', { sort: 5, day: '2026-10-05', duration_min: 45, repeat_rule: { every: 'week', days: [1] } }),
  it('t3~2026-11-02', 'Review the week', { series_id: 't3', occurs_on: '2026-11-02', day: '2026-11-02', done: true, done_at: at('2026-11-02T17:00'), actual_minutes: 40 }),
  // One that was sent to Daybook from a line here: it comes home to that line.
  it('inkwell-li_sent', 'Email the venue', { sort: 6, day: '2026-11-12', duration_min: 20, link: 'http://localhost:4273/?open=li_sent' }),
];

const now = Date.parse(NOW);
const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 30 * 864e5, updated_at: now - 2 * 36e5 };
const row0 = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const HERE = [
  row0('wd_nb', 'world', null, 1, { title: 'The Ninja Bunch', area_id: 'area-filmmaking', fields: { shape: 'show' } }),
  row0('pg_notes', 'page', null, 5, { title: 'Loose notes' }),
  row0('li_sent', 'line', 'pg_notes', 1, { text: 'Email the venue about the 14th', content: [{ type: 'text', text: 'Email the venue about the 14th' }], fields: { done: false, daybook: { id: 'inkwell-li_sent', at: now - 864e5 } } }),
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
async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, ...extra });
  await ctx.addInitScript((items) => {
    window.__daybookItems = async () => {
      if (localStorage.getItem('db-mode') === 'down') throw new Error('offline');
      return JSON.parse(localStorage.getItem('db-items') || 'null') || items;
    };
  }, DAYBOOK);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return page;
}
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const live = async (p) => (await all(p)).filter((r) => !r.deleted && r.kind !== 'version');
const command = async (p, name) => {
  await p.keyboard.press('Control+K');
  await p.keyboard.type(name);
  await sleep(300);
  await p.keyboard.press('Enter');
};
// Opens the box and waits until it has read Daybook.
const box = async (p) => {
  await command(p, 'Bring in Daybook');
  await p.waitForSelector('.dbin-box');
  await p.waitForFunction(() => { const t = document.querySelector('.dbin-body')?.textContent || ''; return t && !t.startsWith('Reading'); });
  return p.locator('.dbin-body p').allInnerTexts();
};
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const shot = async (p, name) => { if (SHOTS) { await still(p); await sleep(250); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 12).join('\n     ')}`); }
}

try {
  const p = await open({ width: 1440, height: 900 });
  await p.evaluate(seed, HERE);
  await p.reload();
  await p.waitForFunction(() => document.documentElement.dataset.started === '1');
  const before = (await live(p)).length;

  await check('the box says what would come in, and nothing is written yet', async () => {
    const said = await box(p);
    const text = said.join(' ');
    assert.match(text, /1 project becomes a life project here: Build the shed\./);
    assert.match(text, /1 project joins the one of the same name already here: The Ninja Bunch\./);
    assert.match(text, /6 steps go onto those projects’ Steps\./);
    assert.match(text, /4 tasks on their own go onto the Tasks page\./);
    assert.match(text, /1 of them comes home to the line here it was sent from\./);
    assert.match(text, /2 repeat, 1 is a habit, 1 is already done/);
    assert.match(text, /1 new area: Garden\./);
    assert.match(text, /Left behind on purpose: 1 area time block, 1 thing in Daybook’s trash\./);
    assert.match(said.at(-1), /Daybook itself isn’t changed\./);
    assert.equal((await live(p)).length, before);
    await shot(p, 'daybookin-box');
    await p.locator('.dbin-box .ghost-btn').click();
    assert.equal(await p.locator('.dbin-box').count(), 0);
    assert.equal((await live(p)).length, before);
  });

  await check('saying yes brings it in: projects, steps, tasks, notes and links', async () => {
    await box(p);
    await p.locator('.dbin-box .pill.primary').click();
    await p.waitForSelector('.toast');
    assert.match(await p.locator('.toast span').first().innerText(), /Daybook is in: 10 tasks across 2 projects\./);
    const rows = await live(p);
    const by = (id) => rows.find((r) => r.id === id);
    // The new project is a life project in the new area; the old one keeps its world.
    assert.equal(by('wd-db-p-shed').fields.life, true);
    assert.equal(by('wd-db-p-shed').area_id, 'ar-db-area-garden');
    assert.equal(by('ar-db-area-garden').title, 'Garden');
    assert.ok(!rows.some((r) => r.kind === 'world' && r.id !== 'wd_nb' && r.title === 'The Ninja Bunch'));
    // A step: on the project's Steps page, with its day, minutes, notes and link under it.
    const s1 = by('li-db-s1');
    assert.equal(s1.parent_id, 'steps-wd_nb');
    assert.deepEqual([s1.fields.task.day, s1.fields.task.est, s1.fields.box, s1.fields.done], ['2026-11-10', 90, true, false]);
    assert.deepEqual(rows.filter((r) => r.parent_id === 'li-db-s1').sort((a, b) => a.sort - b.sort).map((r) => r.text), ['Use the dojo set.', 'https://example.com/board']);
    // A done one keeps when it was done and what the timer recorded (not the guess).
    const s2 = by('li-db-s2');
    assert.equal(s2.fields.done, true);
    assert.equal(s2.fields.task.done_at, Date.parse(at('2026-11-05T15:00')));
    assert.equal(s2.fields.task.actual, 120);
    assert.equal(s2.fields.task.log.length, 1);
    // A part with a first and last day is a stretch; its own part sits under it and says what it waits on.
    assert.deepEqual([by('li-db-s3').fields.task.day, by('li-db-s3').fields.task.until, by('li-db-s3').fields.task.est], ['2026-11-16', '2026-11-27', null]);
    assert.equal(by('li-db-s3a').parent_id, 'li-db-s3');
    assert.ok(rows.some((r) => r.parent_id === 'li-db-s3a' && r.text === 'Waits on: Board Reel 2'));
    // A milestone and the project's own date are dates to hit; the hard one can't move.
    assert.deepEqual([by('li-db-s4').fields.task.day, by('li-db-s4').fields.task.mark], ['2026-11-20', 'date']);
    assert.deepEqual([by('li-dbd-p-nb').fields.task.day, by('li-dbd-p-nb').fields.task.mark, by('li-dbd-p-nb').text], ['2026-12-14', 'hard', 'The Ninja Bunch due']);
    // The project's notes and link are on a page of their own.
    assert.deepEqual(rows.filter((r) => r.parent_id === 'pg-db-p-nb').sort((a, b) => a.sort - b.sort).map((r) => r.text), ['Reels first.', 'Then the pilot.', 'https://example.com/ninja']);
    // Due with no day: the date to hit is its day.
    assert.deepEqual([by('li-db-s5').parent_id, by('li-db-s5').fields.task.day, by('li-db-s5').fields.task.mark], ['steps-wd-db-p-shed', '2026-11-13', 'date']);
    // A task on its own: on the Tasks page, with its label as a tag and its time said under it.
    const t1 = by('li-db-t1');
    assert.equal(t1.parent_id, 'page-tasks');
    assert.equal(t1.text, 'Renew passport #errand');
    assert.deepEqual(t1.tags, ['errand']);
    assert.ok(rows.some((r) => r.parent_id === 'li-db-t1' && r.text === 'At 9:30 am'));
    // The area's hours a week carried over.
    assert.equal(by('settings-plan').fields.areas['area-filmmaking'], 10);
  });

  await check('repeats and habits come with their rule and the times they were done', async () => {
    const rows = await live(p);
    const by = (id) => rows.find((r) => r.id === id);
    const t2 = by('li-db-t2').fields.task;
    assert.equal(t2.habit, true);
    assert.equal(t2.repeat.every, 'day');
    assert.deepEqual(t2.did.map((d) => d[0]), ['2026-11-07', '2026-11-08']);
    assert.equal(t2.day, '2026-11-09');
    const t3 = by('li-db-t3').fields.task;
    assert.deepEqual([t3.repeat.every, t3.repeat.days, t3.est], ['week', [1], 45]);
    assert.deepEqual(t3.did.map((d) => [d[0], d[1]]), [['2026-11-02', 40]]);
    assert.equal(t3.day, '2026-11-09');
    // The done time of the series is history, not a line of its own.
    assert.ok(!rows.some((r) => r.id.includes('t32026-11-02')));
  });

  await check('a task once sent to Daybook comes home to its own line', async () => {
    const rows = await live(p);
    const sent = rows.find((r) => r.id === 'li_sent');
    assert.equal(sent.text, 'Email the venue about the 14th');
    assert.deepEqual([sent.fields.task.day, sent.fields.task.est, sent.fields.box], ['2026-11-12', 20, true]);
    assert.ok(!rows.some((r) => r.id === 'li-db-inkwell-li_sent'));
  });

  await check('what came in shows in Today and on the project', async () => {
    await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, { view: 'plan', tab: 'week' });
    await p.waitForSelector('#plan-sheet .pw-task');
    const week = await p.locator('#plan-sheet').innerText();
    for (const t of ['Board Reel 2', 'Renew passport', 'Review the week', 'Email the venue', 'Order lumber']) assert.ok(week.includes(t), `${t} is missing from the week`);
    await shot(p, 'daybookin-week');
  });

  await check('bringing in again adds nothing twice, only what is new', async () => {
    const said = await box(p);
    assert.deepEqual(said, ['Everything in Daybook is already here. There’s nothing new to bring in.']);
    assert.equal(await p.locator('.dbin-box .pill.primary').isVisible(), false);
    await p.locator('.dbin-box .ghost-btn').click();
    // Something new in Daybook since: only that comes.
    await p.evaluate((items) => localStorage.setItem('db-items', JSON.stringify(items)), [...DAYBOOK, it('t9', 'Book the dojo', { sort: 9, day: '2026-11-13' })]);
    const again = (await box(p)).join(' ');
    assert.match(again, /1 task on its own goes onto the Tasks page\./);
    assert.match(again, /already here from before/);
    const n = (await live(p)).length;
    await p.locator('.dbin-box .pill.primary').click();
    await p.waitForFunction(() => !document.querySelector('.dbin-box'));
    assert.equal((await live(p)).length, n + 1);
  });

  await check('a line you threw away stays away', async () => {
    await p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('writing');
      r.onsuccess = () => {
        const tx = r.result.transaction('entries', 'readwrite');
        const q = tx.objectStore('entries').get('li-db-t1');
        q.onsuccess = () => tx.objectStore('entries').put({ ...q.result, deleted: true, updated_at: Date.now() });
        tx.oncomplete = () => res();
      };
    }));
    const said = await box(p);
    assert.deepEqual(said, ['Everything in Daybook is already here. There’s nothing new to bring in.']);
    await p.locator('.dbin-box .ghost-btn').click();
  });

  await check('the last time can be taken back, and it can come in again', async () => {
    await box(p);
    await p.locator('.dbin-undo').click();
    await p.waitForFunction(() => /nothing new|onto the Tasks page/.test(document.querySelector('.dbin-body')?.textContent || '') && !document.querySelector('.dbin-undo'));
    let rows = await live(p);
    assert.ok(!rows.some((r) => r.id === 'li-db-t9'), 'the last one is gone');
    assert.ok(rows.some((r) => r.id === 'li-db-s1'), 'the first time stays');
    // It's offered again.
    assert.match((await p.locator('.dbin-body p').allInnerTexts()).join(' '), /1 task on its own/);
    await p.locator('.dbin-box .pill.primary').click();
    await p.waitForFunction(() => !document.querySelector('.dbin-box'));
    rows = await live(p);
    assert.ok(rows.some((r) => r.id === 'li-db-t9'));
  });

  await check('taking back the first time leaves things as they were', async () => {
    const q = await open({ width: 1280, height: 800 });
    await q.evaluate(seed, HERE);
    await q.reload();
    await q.waitForFunction(() => document.documentElement.dataset.started === '1');
    const was = (await live(q)).map((r) => r.id).sort();
    await box(q);
    await q.locator('.dbin-box .pill.primary').click();
    await q.waitForSelector('.toast .toast-action');
    await q.locator('.toast .toast-action').click();
    await q.waitForFunction(() => /Taken back/.test(document.querySelector('.toast')?.textContent || ''));
    const rows = await live(q);
    // The Tasks page and the plan settings may stay (empty); nothing else is new.
    assert.deepEqual(rows.map((r) => r.id).filter((id) => !['settings-plan'].includes(id)).sort(), was);
    const sent = rows.find((r) => r.id === 'li_sent');
    assert.ok(!sent.fields.task && !sent.fields.box, 'the line that was sent is a plain line again');
    assert.ok(!(rows.find((r) => r.id === 'settings-plan')?.fields.areas || {})['area-filmmaking']);
    assert.deepEqual(q.errors, []);
    await q.context().close();
  });

  await check('when Daybook can’t be reached it says so and changes nothing', async () => {
    await p.evaluate(() => localStorage.setItem('db-mode', 'down'));
    const n = (await live(p)).length;
    const said = await box(p);
    assert.match(said.join(' '), /can’t be reached/);
    assert.equal(await p.locator('.dbin-box .pill.primary').isVisible(), false);
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('.dbin-box').count(), 0);
    assert.equal((await live(p)).length, n);
    await p.evaluate(() => localStorage.removeItem('db-mode'));
  });

  await check('on a phone the box fits, and nothing broke', async () => {
    const phone = await open(null, { ...devices['Pixel 7'] });
    await phone.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })));
    await phone.keyboard.type('Bring in Daybook');
    await sleep(300);
    await phone.keyboard.press('Enter');
    await phone.waitForSelector('.dbin-box');
    await phone.waitForFunction(() => { const t = document.querySelector('.dbin-body')?.textContent || ''; return t && !t.startsWith('Reading'); });
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(wide <= 1, `spills ${wide}`);
    const b = await phone.locator('.dbin-box').boundingBox();
    assert.ok(b.x >= 0 && b.x + b.width <= 412 + 1, 'the box is on the screen');
    await shot(phone, 'daybookin-phone');
    assert.deepEqual(phone.errors, []);
    assert.deepEqual(p.errors, []);
    await phone.context().close();
  });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall daybookin checks passed');
