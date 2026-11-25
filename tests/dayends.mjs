// The two ends of the day (One thing at a time, Part 4, Nov 15 2026).
// Morning: "Talk the day through" on Now when nothing is laid out. What he
// says is heard as the day and laid out at once, with Undo: tasks already on
// today stay in it, a sixth big thing and any thought go to the page (and
// get filed). Evening: "Close the day" from Now after 5 pm and from the 9 pm
// card: what he did, a line for what the screen didn't see, two questions
// and "What is first tomorrow", written on today's page under one line.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4286;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const TODAY = '2026-11-16';
const YESTERDAY = '2026-11-15';
const TOMORROW = '2026-11-17';
const at = (s) => `${TODAY}T${s}:00-08:00`;
const EVENTS = [{ id: 'c1:lesson', title: 'Private lesson', start: at('13:00'), end: at('14:00'), allDay: false, calendar: 'Acro' }];

const now = Date.parse(at('09:00'));
const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 20 * 864e5, updated_at: now - 2 * 36e5 };
const row = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const task = (id, parent, sort, text, t = {}) => row(id, 'line', parent, sort, {
  text, content: [{ type: 'text', text }],
  fields: { done: false, box: true, task: { v: 1, day: TODAY, est: null, done_at: null, actual: null, log: [], run: null, order: sort, ...t } }
});
const SEED = [
  row('page-tasks', 'page', null, 0, { title: 'Tasks' }),
  task('t_hook', 'page-tasks', 1, 'Write the two-minute hook'),
  task('t_nate', 'page-tasks', 2, 'Reply to Nate'),
  task('t_old', 'page-tasks', 3, 'Send the invoice', { day: YESTERDAY }),
  task('t_tmrw', 'page-tasks', 4, 'Shoot the cold open', { day: TOMORROW, order: 1 }),
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

const SAID = 'Nate first, then storyboard scene three, then the hook. Email the venue. Edit the trailer, color the short, mix the sound, write the newsletter. Had an idea for a gag about a ninja scared of cats.';
const HEARD = {
  items: [
    { task: 't_nate', text: '', small: true },
    { task: '', text: 'Storyboard scene three', small: false },
    { task: 't_hook', text: '', small: false },
    { task: '', text: 'Email the venue', small: true },
    { task: '', text: 'Edit the trailer', small: false },
    { task: '', text: 'Color the short', small: false },
    { task: '', text: 'Mix the sound', small: false },
    { task: '', text: 'Write the newsletter', small: false },
  ],
  thoughts: ['A gag about a ninja scared of cats'],
  said: 'Here is the day as I heard it',
};

const browser = withoutSync(await chromium.launch());
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const byId = async (p, id) => (await all(p)).find((r) => r.id === id);
const onNow = (p) => p.waitForFunction(() => document.documentElement.dataset.view === 'plan' && document.querySelector('#plan-sheet')?.dataset.tab === 'now' && !!document.querySelector('#plan-sheet .now-view'));
const thing = (p) => p.locator('#plan-sheet .np-tx').first().innerText();
const settle = async (p) => { await sleep(400); await still(p); };
const press = async (p, key) => { await p.evaluate(() => document.activeElement?.blur?.()); await p.keyboard.press(key); await settle(p); };
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(100); } return v; };
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const sheet = (p) => p.locator('#plan-sheet');
const go = async (p, place) => { await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place); await p.waitForFunction((pl) => document.documentElement.dataset.view === pl.view && (!pl.tab || document.querySelector('#plan-sheet')?.dataset.tab === pl.tab), place); await settle(p); };
// The two ends of the day are offered at the top of Today's list.
const toToday = (p) => go(p, { view: 'plan', tab: 'day' });

async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, rowDetails: false, todayNow: true, ...extra });
  const asked = [];
  await ctx.exposeFunction('__toClaude', (body) => {
    asked.push(body);
    if (body.mode === 'day') return HEARD;
    return { kind: 'none', places: [], moves: [], said: '' };
  });
  await ctx.addInitScript((events) => { window.__claude = (body) => window.__toClaude(body); window.__calendar = async () => ({ connected: true, events }); }, EVENTS);
  const page = await ctx.newPage();
  page.errors = [];
  page.asked = asked;
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

  await check('morning: Today offers “Talk the day through” when nothing is laid out', async () => {
    await toToday(page);
    assert.equal(await sheet(page).locator('[data-now="talkday"]').count(), 1);
    assert.equal(await sheet(page).locator('[data-now="closeday"]').count(), 0, 'no close of the day in the morning');
    await shot(page, 'morning-gate');
    await sheet(page).locator('[data-now="talkday"]').click();
    await onNow(page);
    await settle(page);
    assert.equal(await sheet(page).locator('.now-q').innerText(), 'What is in front of you today?');
    assert.equal(await sheet(page).locator('.now-talk .now-mic').isVisible(), true, 'and the mic');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'now-talk-box');
  });

  await check('what he says goes to Claude with today’s tasks (carried ones too) and events', async () => {
    await sheet(page).locator('#now-talk-box').fill(SAID);
    await shot(page, 'morning-talk');
    await page.keyboard.press('Control+Enter');
    await until(() => sheet(page).locator('.now-heard').count());
    await settle(page);
    const body = page.asked.find((b) => b.mode === 'day');
    assert.equal(body.words, SAID);
    assert.deepEqual(body.plan.map((t) => t.id).sort(), ['t_hook', 't_nate', 't_old']);
    assert.equal(body.events[0].title, 'Private lesson');
  });

  await check('the day as heard: one list in his order, and how many went to the page', async () => {
    assert.match(await sheet(page).locator('.now-heard .now-eyebrow').innerText(), /the day as i heard it/i);
    assert.match(await sheet(page).locator('.now-heard').innerText(), /One more thing went to today’s page, to be filed/);
    const words = await sheet(page).locator('.now-heard-list .pl-words').allInnerTexts();
    assert.deepEqual(words.slice(0, 2), ['Storyboard scene three', 'Write the two-minute hook']);
    assert.ok(words.includes('Send the invoice'), 'the carried task is in the same list');
    assert.ok(words.includes('Write the newsletter'), 'today holds as many as he says (no five at most)');
    const rows = await all(page);
    const t = (text) => rows.find((r) => r.text === text && r.fields?.task && !r.deleted);
    assert.equal(t('Email the venue').fields.task.small, true);
    assert.equal(t('Storyboard scene three').fields.task.day, TODAY);
    assert.equal((await byId(page, 't_nate')).fields.task.small, true);
    assert.equal((await byId(page, 't_old')).fields.task.day, TODAY);
    // The thought is on today's page, filed as a brain dump.
    const lines = rows.filter((r) => r.parent_id === `day-${TODAY}` && r.fields?.thought);
    assert.deepEqual(lines.map((r) => r.fields.thought.words).sort(), ['A gag about a ninja scared of cats']);
    await until(() => page.asked.filter((b) => b.mode === 'thought').length === 1);
    assert.ok(page.asked.filter((b) => b.mode === 'thought').every((b) => b.dump === true));
    assert.match(await page.locator('.toast').last().innerText(), /Here is the day as I heard it/);
    await shot(page, 'morning-heard');
  });

  await check('Undo puts today back as it was', async () => {
    await page.locator('.toast button', { hasText: 'Undo' }).last().click();
    await settle(page);
    const rows = await all(page);
    assert.equal(rows.find((r) => r.text === 'Storyboard scene three' && r.fields?.task)?.deleted, true);
    assert.equal((await byId(page, 't_old')).fields.task.day, YESTERDAY);
    assert.equal((await byId(page, 't_hook')).fields.task.order, 1);
    assert.equal(!!(await byId(page, 't_nate')).fields.task.small, false);
    assert.equal(await sheet(page).locator('.now-heard').count(), 0);
    await toToday(page);
    assert.equal(await sheet(page).locator('[data-now="talkday"]').count(), 1, 'offered again');
  });

  await check('Begin starts the first, and the morning talk isn’t offered again today', async () => {
    await sheet(page).locator('[data-now="talkday"]').click();
    await onNow(page);
    await sheet(page).locator('#now-talk-box').fill(SAID);
    await sheet(page).locator('[data-now="talk-send"]').click();
    await until(() => sheet(page).locator('.now-heard').count());
    await settle(page);
    await press(page, 'b');
    // The one thing is Now zoomed in (Today and Now as one, Nov 25 2026).
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook' && (window.__plan.items || []).find((i) => i.row.id === history.state?.zoom)?.row.text === 'Storyboard scene three', null, { timeout: 8000 });
    await page.evaluate(() => window.__plan.now.done());
    await settle(page);
    await page.evaluate(() => window.__plan.now.done());
    await settle(page);
    await toToday(page);
    assert.equal(await sheet(page).locator('[data-now="talkday"]').count(), 0);
  });

  await check('a typed answer that fails keeps his words in the box', async () => {
    await page.evaluate(() => { window.__was = window.__claude; window.__claude = async () => ({ error: 'Claude is busy right now.' }); });
    await page.evaluate(() => window.__plan.now.openTalk());
    await settle(page);
    await sheet(page).locator('#now-talk-box').fill('Something more');
    await sheet(page).locator('[data-now="talk-send"]').click();
    await until(() => sheet(page).locator('.now-talk-note').innerText());
    assert.match(await sheet(page).locator('.now-talk-note').innerText(), /busy.*Your words are still here/);
    assert.equal(await sheet(page).locator('#now-talk-box').inputValue(), 'Something more');
    await page.evaluate(() => { window.__claude = window.__was; });
    await press(page, 'Escape');
    assert.equal(await sheet(page).locator('.now-talk').count(), 0);
  });

  await check('evening: from 5 pm Today offers “Close the day”', async () => {
    await page.clock.setSystemTime(new Date(at('17:30')));
    await toToday(page);
    await page.evaluate(() => window.__plan.redraw());
    await settle(page);
    assert.equal(await sheet(page).locator('[data-now="closeday"]').count(), 1);
    await shot(page, 'evening-gate');
    await sheet(page).locator('[data-now="closeday"]').click();
    await onNow(page);
    await settle(page);
    assert.equal(await sheet(page).locator('.now-close-h').innerText(), 'Here is what you did');
  });

  await check('here is what you did: done, and the event that happened, nothing counted', async () => {
    const did = await sheet(page).locator('.now-did li').allInnerTexts();
    assert.ok(did.includes('Storyboard scene three'), did.join(' | '));
    assert.equal(did.filter((t) => !/ · /.test(t)).length, 2, `two done: ${did.join(' | ')}`);
    assert.ok(did.includes('1 pm · Private lesson'), `the event: ${did.join(' | ')}`);
    assert.doesNotMatch(await sheet(page).locator('.now-close').innerText(), /overdue|not done|left undone/i);
    const qs = await sheet(page).locator('.now-closeform .now-q').allInnerTexts();
    assert.deepEqual(qs, ['Where did you feel most alive and in step today?', 'Where did you feel drained or out of step?', 'What is first tomorrow?']);
  });

  await check('close the day: written on today’s page under one line, the first thing on top of tomorrow', async () => {
    const add = sheet(page).locator('.now-addin');
    await add.fill('Walked the dog');
    await add.press('Enter');
    await settle(page);
    assert.ok((await sheet(page).locator('.now-did li').allInnerTexts()).includes('Walked the dog'));
    await sheet(page).locator('#now-close-alive').fill('Storyboarding with music on');
    await sheet(page).locator('#now-close-drained').fill('Email');
    await sheet(page).locator('#now-close-first').fill('Finish the storyboard');
    await shot(page, 'evening-close');
    await sheet(page).locator('[data-now="close-save"]').click();
    await settle(page);
    const rows = await all(page);
    const top = rows.find((r) => r.parent_id === `day-${TODAY}` && r.text === 'Close of the day');
    assert.ok(top, 'one line on today’s page');
    const kids = rows.filter((r) => r.parent_id === top.id).sort((a, b) => a.sort - b.sort).map((r) => r.text);
    assert.deepEqual(kids, ['Also: Walked the dog', 'Most alive and in step: Storyboarding with music on', 'Drained or out of step: Email', 'First tomorrow: Finish the storyboard']);
    const first = rows.find((r) => r.text === 'Finish the storyboard' && r.fields?.task);
    assert.equal(first.fields.task.day, TOMORROW);
    assert.ok(first.fields.task.order < (await byId(page, 't_tmrw')).fields.task.order, 'on top of tomorrow');
    assert.match(await page.locator('.toast').last().innerText(), /The day is closed/);
    assert.equal(await sheet(page).locator('[data-now="closeday"]').count(), 0);
    await toToday(page);
    assert.equal(await sheet(page).locator('[data-now="closeday"]').count(), 0, 'not offered once closed');
  });

  await check('the commands are in All commands; their switches went (always on)', async () => {
    const list = await page.evaluate(() => window.__commandList().map((c) => c.label));
    for (const q of ['Show or hide the morning talk on Now', 'Show or hide the close of the day']) assert.ok(!list.includes(q), q);
    await page.keyboard.press('Control+k');
    await page.waitForFunction(() => !document.querySelector('.palette')?.hidden);
    for (const q of ['Talk the day through', 'Close the day']) {
      await page.locator('.palette input').fill(q);
      await sleep(250);
      assert.ok(await page.locator('.palette li', { hasText: q }).count() > 0, q);
    }
    await page.keyboard.press('Escape');
  });
  assert.deepEqual(page.errors, []);

  // ---------- the phone, in the evening, before closing ----------
  const { page: phone } = await open({ width: 412, height: 915 }, { hasTouch: true, isMobile: true });
  await check('phone: the morning talk fits, with a thumb-sized mic', async () => {
    await toToday(phone);
    await sheet(phone).locator('[data-now="talkday"]').first().tap();
    await onNow(phone);
    await settle(phone);
    const box = await sheet(phone).locator('#now-talk-box').boundingBox();
    assert.ok(box.width > 300 && box.x + box.width <= 412, `box ${box.x} ${box.width}`);
    const mic = await sheet(phone).locator('.now-talk .now-mic').boundingBox();
    assert.ok(mic.height >= 44, `mic ${mic.height}`);
    await sheet(phone).locator('#now-talk-box').fill(SAID);
    await shot(phone, 'phone-talk');
    await sheet(phone).locator('[data-now="talk-send"]').tap();
    await until(() => sheet(phone).locator('.now-heard').count());
    await settle(phone);
    await shot(phone, 'phone-heard');
    assert.equal(await phone.evaluate(() => document.scrollingElement.scrollWidth <= 412), true, 'no sideways scroll');
  });

  await check('phone: in the evening Today offers Close the day, and it opens on Now', async () => {
    // An old device that hid both gets them back: they are always on now.
    await phone.evaluate(() => { localStorage.setItem('hide', JSON.stringify(['nowtalk', 'nowclose'])); });
    await phone.clock.setSystemTime(new Date(at('21:10')));
    await phone.reload();
    await phone.waitForFunction(() => document.documentElement.dataset.started === '1');
    await sleep(1500); // it opens on Now, which zooms into the one thing a moment later
    await toToday(phone);
    await sheet(phone).locator('[data-now="closeday"]').first().tap();
    await onNow(phone);
    await settle(phone);
    assert.equal(await sheet(phone).locator('.now-close-h').innerText(), 'Here is what you did');
    const save = await sheet(phone).locator('[data-now="close-save"]').boundingBox();
    assert.ok(save.height >= 44, `button ${save.height}`);
    await shot(phone, 'phone-close');
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
