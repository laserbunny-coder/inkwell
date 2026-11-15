// Training (One thing at a time, Part 6, Nov 15 2026). A line "Training" on
// each day but Sunday; in Now one exercise at a time with set dots, minutes
// and one number; sessions take turns (two evaluations once, then Hard A,
// Light, Light, Hard B, Light, Light) and hold their place; a ladder asks
// before moving up; the session lands on today's page; the Desk shows the
// goals; the Training page holds the plan as an outline.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4287;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const MON = '2026-11-16';
const TUE = '2026-11-17';
const WED = '2026-11-18';
const SUN = '2026-11-22';
const at = (day, s) => `${day}T${s}:00-08:00`;

const now = Date.parse(at(MON, '09:00'));
const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 20 * 864e5, updated_at: now - 2 * 36e5 };
const row = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const task = (id, parent, sort, text, t = {}) => row(id, 'line', parent, sort, {
  text, content: [{ type: 'text', text }],
  fields: { done: false, box: true, task: { v: 1, day: MON, est: null, done_at: null, actual: null, log: [], run: null, order: sort, ...t } }
});
const SEED = [row('page-tasks', 'page', null, 0, { title: 'Tasks' }), task('t_hook', 'page-tasks', 1, 'Write the two-minute hook')];

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
const put = (p, rows) => p.evaluate((rows) => new Promise((res, rej) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => {
    const tx = r.result.transaction(['entries', 'outbox'], 'readwrite');
    for (const x of rows) { tx.objectStore('entries').put(x); tx.objectStore('outbox').put({ id: x.id }); }
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  };
}), rows);
const state = async (p) => (await all(p)).find((r) => r.id === 'pg_training')?.fields?.training;
const patchState = async (p, patch) => { const pg = (await all(p)).find((r) => r.id === 'pg_training'); await put(p, [{ ...pg, fields: { ...pg.fields, training: { ...pg.fields.training, ...patch } }, updated_at: Date.now() }]); };
const lines = async (p, day) => (await all(p)).filter((r) => r.kind === 'line' && !r.deleted && r.fields?.training === true && r.fields?.task?.day === day);
const sheet = (p) => p.locator('#plan-sheet');
const settle = async (p) => { await sleep(400); await still(p); };
const press = async (p, key) => { await p.evaluate(() => document.activeElement?.blur?.()); await p.keyboard.press(key); await settle(p); };
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(100); } return v; };
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const eyebrow = (p) => sheet(p).locator('.now-train .now-eyebrow').innerText();
const thing = (p) => sheet(p).locator('.now-thing').first().innerText();
const started = (p) => p.waitForFunction(() => document.documentElement.dataset.started === '1');
const onNow = (p) => p.waitForFunction(() => document.documentElement.dataset.view === 'plan' && document.querySelector('#plan-sheet')?.dataset.tab === 'now' && !!document.querySelector('#plan-sheet .now-view'));
async function toNow(p) { await p.evaluate(() => { history.pushState({ view: 'plan', tab: 'now' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'plan', tab: 'now' } })); }); await onNow(p); await settle(p); }
async function dayIs(p, day, time = '13:30') { await p.clock.setSystemTime(new Date(at(day, time))); await p.reload(); await started(p); await toNow(p); }
// Begin training from the gate (it's the next thing, or chosen from the list).
async function beginTraining(p) {
  const id = (await lines(p, await p.evaluate(() => window.__plan.today)))[0].id;
  await p.evaluate((id) => window.__plan.now.begin(id), id);
  await settle(p);
}
const skipTo = async (p, name) => { for (let n = 0; n < 20; n++) { if ((await thing(p)).startsWith(name)) return; await press(p, 's'); } throw new Error(`never reached ${name}`); };

async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, rowDetails: false, todayNow: true, training: true, ...extra });
  await ctx.addInitScript(() => { window.__claude = async () => ({ error: 'offline' }); window.__calendar = async () => ({ connected: true, events: [] }); });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.install({ time: new Date(at(MON, '09:04')) });
  await page.goto(URL);
  await started(page);
  await page.evaluate((rows) => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const tx = r.result.transaction(['entries', 'outbox'], 'readwrite'); for (const x of rows) { tx.objectStore('entries').put(x); tx.objectStore('outbox').put({ id: x.id }); } tx.oncomplete = () => res(); }; }), SEED);
  await page.reload();
  await started(page);
  return { ctx, page };
}

try {
  const { page } = await open({ width: 1400, height: 900 });

  await check('a “Training” line is on today, after the rest, and the Training page is written', async () => {
    await toNow(page);
    const l = await until(() => lines(page, MON));
    assert.equal(l.length, 1);
    assert.equal(l[0].text, 'Training');
    assert.ok(l[0].fields.task.order > 1, 'after the rest');
    const rows = await all(page);
    const tops = rows.filter((r) => r.parent_id === 'pg_training' && !r.deleted).sort((a, b) => a.sort - b.sort).map((r) => r.text);
    assert.deepEqual(tops, ['Evaluation 1', 'Evaluation 2', 'Hard A', 'Light', 'Hard B']);
    await page.reload(); await started(page); await toNow(page);
    assert.equal((await lines(page, MON)).length, 1, 'never a second one');
  });

  await check('Begin: one exercise at a time, the minutes control, Enter is Done', async () => {
    await beginTraining(page);
    assert.equal(await eyebrow(page), 'TRAINING · EVALUATION 1 · 1 OF 7');
    assert.equal(await thing(page), 'Warm up');
    assert.equal(await sheet(page).locator('#now-tmin').inputValue(), '10');
    await shot(page, 'train-minutes');
    await sheet(page).locator('[data-now="tmin"][data-v="-1"]').click();
    await settle(page);
    assert.equal(await sheet(page).locator('#now-tmin').inputValue(), '9');
    await sheet(page).locator('#now-tmin').fill('5');
    await sheet(page).locator('#now-tmin').press('Enter');
    await settle(page);
    assert.equal(await thing(page), 'Standing reach');
    assert.equal((await state(page)).lastMin.warm, 5);
  });

  await check('set dots: all filled to start, tap one to bring it down; one number to record', async () => {
    await sheet(page).locator('#now-tnum').fill('90');
    await press(page, 'd');
    assert.equal(await thing(page), 'Vertical jump test');
    assert.equal(await sheet(page).locator('.now-dot.on').count(), 5);
    await sheet(page).locator('.now-dot').nth(3).click();
    await settle(page);
    assert.equal(await sheet(page).locator('.now-dot.on').count(), 4);
    assert.match(await sheet(page).locator('.now-setn').innerText(), /4 of 5 jumps/);
    await sheet(page).locator('[data-now="tnum"][data-v="1"]').click();
    await sheet(page).locator('#now-tnum').fill('24');
    await shot(page, 'train-sets');
    await press(page, 'd');
    assert.equal(await thing(page), 'Broad jump test');
    await sheet(page).locator('[data-now="tback"]').click();
    await settle(page);
    assert.equal(await thing(page), 'Vertical jump test', 'Back');
    assert.match(await sheet(page).locator('.now-tsay').innerText(), /Last time 24 inches, 4 of 5 jumps/);
  });

  await check('after the last one: the gate, a line on today’s page, and the place moves on', async () => {
    for (let n = 0; n < 5; n++) await press(page, 's');
    await until(async () => !(await sheet(page).locator('.now-train').count()));
    const st = await state(page);
    assert.equal(st.round, 1);
    const rows = await all(page);
    const top = rows.find((r) => r.parent_id === `day-${MON}` && r.text === 'Training: Evaluation 1');
    assert.ok(top, 'on today’s page');
    const kids = rows.filter((r) => r.parent_id === top.id).sort((a, b) => a.sort - b.sort).map((r) => r.text);
    assert.deepEqual(kids, ['Warm up: 5 of 10 minutes', 'Standing reach: 90 inches', 'Vertical jump test: 24 inches, 4 of 5 jumps']);
    const l = rows.find((r) => r.fields?.training === true && r.fields?.task?.day === MON);
    assert.equal(l.text, 'Training: Evaluation 1');
    assert.equal(l.fields.done, true);
    await shot(page, 'train-gate');
  });

  await check('a missed day changes nothing; the next session is still next', async () => {
    await dayIs(page, WED);
    assert.equal((await lines(page, WED)).length, 1);
    assert.equal((await state(page)).round, 1);
    await beginTraining(page);
    assert.match(await eyebrow(page), /EVALUATION 2 · 1 OF 7/);
  });

  await check('Not now > I trained on my own counts as a session', async () => {
    await press(page, 'n');
    assert.equal(await sheet(page).locator('.now-choice').count(), 4);
    await shot(page, 'train-notnow');
    await press(page, '4');
    assert.equal((await state(page)).round, 2);
    assert.ok((await all(page)).some((r) => r.parent_id === `day-${WED}` && r.text === 'Training: on my own'));
  });

  await check('the round after the evaluations: Hard A, Light, Light, Hard B, Light, Light', async () => {
    const seen = [];
    for (const r of [2, 3, 4, 5, 6, 7, 8]) {
      await patchState(page, { round: r, at: null });
      await page.evaluate(async () => { await window.__plan.now.train.load(); });
      seen.push(await page.evaluate(() => window.__plan.now.train.session().name));
    }
    assert.deepEqual(seen, ['Hard A', 'Light', 'Light', 'Hard B', 'Light', 'Light', 'Hard A']);
    await patchState(page, { round: 2, at: null });
  });

  await check('Hard A: fewer minutes from last time are shown, and the first week has one set fewer', async () => {
    await dayIs(page, TUE);
    await beginTraining(page);
    assert.equal(await eyebrow(page), 'TRAINING · HARD A · 1 OF 13');
    assert.match(await sheet(page).locator('.now-tsay').innerText(), /Last time 5 of 10 minutes/);
    await press(page, 's');
    assert.equal(await thing(page), 'Pogo hops');
    assert.equal(await sheet(page).locator('.now-dot').count(), 2, 'one set fewer the first time round');
    // The second time round, the full numbers.
    await patchState(page, { round: 8, at: null });
    await page.evaluate(async () => { await window.__plan.now.train.load(); window.__plan.redraw(); });
    await beginTraining(page);
    await press(page, 's');
    assert.equal(await thing(page), 'Pogo hops');
    assert.equal(await sheet(page).locator('.now-dot').count(), 3);
  });

  await check('a superset is one step: two names, one row of rounds, a number each', async () => {
    await skipTo(page, 'Tuck front lever hold');
    assert.equal(await sheet(page).locator('.now-with').innerText(), 'taking turns with');
    assert.equal(await sheet(page).locator('.now-thing').nth(1).innerText(), 'Planche lean hold');
    assert.match(await sheet(page).locator('.now-tsay').innerText(), /^5 rounds\. One of each, then rest about 2 minutes/);
    assert.match(await sheet(page).locator('.now-tsay').innerText(), /On the way to the front lever and the straddle planche/);
    assert.equal(await sheet(page).locator('.now-dot').count(), 5);
    assert.equal(await sheet(page).locator('.now-numl').count(), 2);
    assert.match(await sheet(page).locator('.now-train').innerText(), /lever seconds[\s\S]*planche seconds/);
    await shot(page, 'train-pair');
  });

  await check('a ladder moves up only with every round done at the mark, and he decides each one', async () => {
    await sheet(page).locator('.now-dot').nth(4).click(); // 4 of 5
    await sheet(page).locator('#now-tnum').fill('12');
    await sheet(page).locator('#now-tnum2').fill('11');
    await press(page, 'd');
    assert.equal(await sheet(page).locator('[data-now="tup"]').count(), 0, 'not with a round missing');
    assert.equal(await thing(page), 'Front lever lowers');
    await sheet(page).locator('[data-now="tback"]').click();
    await settle(page);
    assert.match(await sheet(page).locator('.now-tsay').innerText(), /Last time 12 and 11 seconds, 4 of 5 rounds/);
    assert.equal(await sheet(page).locator('#now-tnum2').inputValue(), '11');
    await sheet(page).locator('#now-tnum').fill('10');
    await press(page, 'd');
    assert.match(await thing(page), /Ready to move up to the advanced tuck front lever\?/);
    await shot(page, 'train-moveup');
    await sheet(page).locator('[data-now="tup"][data-v="1"]').click();
    await settle(page);
    assert.match(await thing(page), /11 seconds\. Ready to move up to the tuck planche\?/);
    await sheet(page).locator('[data-now="tup"][data-v="0"]').click();
    await settle(page);
    const st = await state(page);
    assert.equal(st.step.lever, 1);
    assert.equal(st.step.planche, 0);
    assert.equal(st.last.lever, 10);
    assert.equal(st.last.planche, 11);
    assert.equal(st.lastSets.holds, 5);
    assert.equal(await thing(page), 'Front lever lowers');
    await sheet(page).locator('[data-now="tback"]').click();
    await settle(page);
    assert.equal(await thing(page), 'Advanced tuck front lever hold');
  });

  await check('Later today keeps the place inside the session', async () => {
    await press(page, 'n');
    await press(page, '1');
    await beginTraining(page);
    assert.equal(await thing(page), 'Advanced tuck front lever hold');
  });

  await check('pull-ups and push-ups take turns too', async () => {
    await skipTo(page, 'Pull-ups');
    assert.equal(await sheet(page).locator('.now-thing').nth(1).innerText(), 'Pseudo planche push-ups');
    assert.match(await sheet(page).locator('.now-train').innerText(), /pull-up reps[\s\S]*push-up reps/);
    await sheet(page).locator('#now-tnum').fill('6');
    await sheet(page).locator('#now-tnum2').fill('9');
    await press(page, 'd');
    assert.equal(await thing(page), 'Pike leg lifts');
    await sheet(page).locator('[data-now="tback"]').click();
    await settle(page);
    assert.match(await sheet(page).locator('.now-tsay').innerText(), /Last time 6 and 9 reps\./);
    await press(page, 'n');
    await press(page, '1');
  });

  await check('the Desk: the goals on stage, where each stands, and the next session', async () => {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.evaluate(() => { history.pushState({ view: 'desk' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'desk' } })); });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'desk');
    await page.waitForSelector('.dk-train');
    const text = await page.locator('.dk-train').innerText();
    assert.match(text, /Vertical over 30 inches\s+24 inches/);
    assert.match(text, /Front lever\s+Advanced tuck front lever, 10 seconds/);
    assert.match(text, /Straddle planche\s+Planche lean, 11 seconds/);
    assert.match(text, /Next session: Hard A\./);
    await page.locator('.dk-train').scrollIntoViewIfNeeded();
    await shot(page, 'train-desk');
  });

  await check('the Training page: an outline, the amounts as a chip to tap', async () => {
    await page.locator('.dk-train button', { hasText: 'The Training page' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    await settle(page);
    const chips = await page.locator('#outline-editor .train-chip').allInnerTexts();
    assert.ok(chips.includes('10 min'), chips.slice(0, 5).join(' | '));
    assert.ok(chips.includes('5 rounds · taking turns'), chips.join(' | '));
    assert.ok(chips.includes('seconds · move up at 10'));
    await shot(page, 'train-page');
    await page.locator('#outline-editor .train-chip', { hasText: '10 min' }).first().click();
    await page.waitForSelector('.pop-menu');
    assert.ok(await page.locator('.pop-menu', { hasText: 'Minutes…' }).count());
    await page.keyboard.press('Escape');
  });

  await check('no line on Sunday; with the switch off, none at all', async () => {
    await dayIs(page, SUN);
    assert.equal((await lines(page, SUN)).length, 0);
    await page.evaluate(() => { const h = JSON.parse(localStorage.getItem('hide') || '[]'); h.push('training'); localStorage.setItem('hide', JSON.stringify(h)); });
    await dayIs(page, '2026-11-23');
    assert.equal((await lines(page, '2026-11-23')).length, 0);
    await page.evaluate(() => { localStorage.setItem('hide', JSON.stringify(JSON.parse(localStorage.getItem('hide')).filter((x) => x !== 'training'))); });
  });
  assert.deepEqual(page.errors, []);

  // ---------- the phone ----------
  const { page: phone } = await open({ width: 412, height: 915 }, { hasTouch: true, isMobile: true });
  await check('phone: one exercise, thumb-sized dots and steppers, nothing spills', async () => {
    await phone.evaluate(() => document.querySelector('#view-toggle').click());
    await onNow(phone);
    await settle(phone);
    await until(() => lines(phone, MON));
    await beginTraining(phone);
    await press(phone, 's');
    await press(phone, 's');
    assert.equal(await thing(phone), 'Vertical jump test');
    const dot = await sheet(phone).locator('.now-dot').first().boundingBox();
    assert.ok(dot.height >= 32, `dot ${dot.height}`);
    const step = await sheet(phone).locator('.now-step').first().boundingBox();
    assert.ok(step.height >= 44, `stepper ${step.height}`);
    await sheet(phone).locator('.now-dot').nth(2).tap();
    await settle(phone);
    assert.equal(await sheet(phone).locator('.now-dot.on').count(), 3);
    assert.equal(await phone.evaluate(() => document.scrollingElement.scrollWidth <= 412), true);
    await shot(phone, 'phone-train');
  });
  await check('phone: a superset fits, both numbers in reach', async () => {
    await patchState(phone, { round: 8, at: { day: MON, i: 5, res: [] } });
    await phone.evaluate(async () => { await window.__plan.now.train.load(); window.__plan.now.train.reset(); window.__plan.redraw(); });
    await settle(phone);
    assert.equal(await thing(phone), 'Tuck front lever hold');
    assert.equal(await sheet(phone).locator('.now-numl').count(), 2);
    assert.equal(await phone.evaluate(() => document.scrollingElement.scrollWidth <= 412), true);
    await shot(phone, 'phone-pair');
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
