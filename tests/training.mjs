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
const shot = async (p, name) => { if (SHOTS) { await p.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };
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

  await check('after the last one: a line on today’s page, the toast says so, and the place moves on', async () => {
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
    // Part 7: the log keeps the day, the session and its numbers.
    assert.deepEqual(st.log, [{ d: MON, s: 'Evaluation 1', h: true, n: { reach: 90, vtest: 24 }, st: {} }]);
    assert.match(await page.locator('.toast').last().innerText(), /Training: Evaluation 1, on today’s page\./);
    await shot(page, 'train-done');
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
    assert.deepEqual((await state(page)).log.at(-1), { d: WED, s: 'On my own', h: false, n: {}, st: {}, own: true });
  });

  await check('missed training never piles up: an old open line lapses, a second copy of today’s goes', async () => {
    // As when he was sick: Tuesday's line never ticked, and two devices each made today's.
    const tl = (id, day, made) => { const r = task(id, 'page-tasks', 50, 'Training', { day }); return { ...r, created_at: made, fields: { ...r.fields, training: true } }; };
    await put(page, [tl('tr_tue', TUE, Date.parse(at(TUE, '00:10'))), tl('tr_wed2', WED, Date.parse(at(WED, '00:20'))), tl('tr_wed3', WED, Date.parse(at(WED, '00:30')))]);
    await dayIs(page, WED);
    await until(async () => (await lines(page, TUE)).length === 0);
    assert.equal((await lines(page, TUE)).length, 0);
    // Today's done line stays; the open copies are gone.
    const wed = await lines(page, WED);
    assert.deepEqual(wed.map((r) => r.fields.done), [true]);
    // And Thursday, with Wednesday's line done and none open, brings just one.
    await dayIs(page, '2026-11-19');
    await until(async () => (await lines(page, '2026-11-19')).length === 1);
    assert.equal((await lines(page, '2026-11-19')).length, 1);
    // Friday after a missed Thursday: Thursday's goes, Friday's is the one line.
    await dayIs(page, '2026-11-20');
    await until(async () => (await lines(page, '2026-11-19')).length === 0);
    assert.deepEqual([(await lines(page, '2026-11-19')).length, (await lines(page, '2026-11-20')).length], [0, 1]);
    assert.equal(await page.locator('#plan .pl-task.carried').count(), 0);
    await shot(page, 'lapse-training');
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

  await check('legs: lunges on Hard A, pistols on Hard B, and jump squats wait for week 5', async () => {
    const names = async (r) => { await patchState(page, { round: r, at: null }); await page.evaluate(async () => { await window.__plan.now.train.load(); }); return page.evaluate(() => { const s = window.__plan.now.train.session(); return { name: s.name, x: s.x.map((x) => x.t) }; }); };
    const a = await names(2);
    assert.equal(a.name, 'Hard A');
    assert.ok(a.x.includes('Walking lunges with dumbbells') && !a.x.some((t) => /squat or split/i.test(t)));
    const b1 = await names(5);
    assert.equal(b1.name, 'Hard B');
    assert.ok(b1.x.includes('Pistol squats'));
    assert.ok(!b1.x.includes('Dumbbell jump squats'), 'not in week 1');
    const b4 = await names(5 + 6 * 3);
    assert.ok(!b4.x.includes('Dumbbell jump squats'), 'not in week 4');
    const b5 = await names(5 + 6 * 4);
    assert.equal(b5.name, 'Hard B');
    assert.equal(b5.x[b5.x.indexOf('Pogo hops') + 1], 'Dumbbell jump squats', 'week 5, after the pogo hops');
    // A page written before the fix is put right once.
    const rows = await all(page);
    const hb = rows.find((r) => r.parent_id === 'pg_training' && r.text === 'Hard B');
    const pis = rows.find((r) => r.parent_id === hb.id && r.text === 'Pistol squats');
    const jsq = rows.find((r) => r.parent_id === hb.id && r.text === 'Dumbbell jump squats');
    const pg = rows.find((r) => r.id === 'pg_training');
    const { seedv, ...oldTr } = pg.fields.training;
    assert.equal(seedv, 2);
    await put(page, [{ ...pis, text: 'Squat or split squat', content: [{ type: 'text', text: 'Squat or split squat' }], fields: { ...pis.fields, ex: { k: 'legs', n: 3, w: 'sets', d: 'Heavy, 5 or 6 reps a set' } } }, { ...jsq, deleted: true }, { ...pg, fields: { ...pg.fields, training: oldTr } }]);
    await page.reload(); await started(page); await toNow(page);
    const after = await until(async () => { const rs = await all(page); return rs.find((r) => r.id === 'pg_training')?.fields?.training?.seedv === 2 && rs; });
    const kids = after.filter((r) => r.parent_id === hb.id && !r.deleted).sort((x, y) => x.sort - y.sort);
    assert.ok(kids.some((r) => r.id === pis.id && r.text === 'Pistol squats' && r.fields.ex.k === 'pistol'));
    const t = kids.map((r) => r.text);
    assert.equal(t[t.indexOf('Pogo hops') + 1], 'Dumbbell jump squats');
    assert.equal(kids.find((r) => r.text === 'Dumbbell jump squats').fields.ex.from, 5);
    await patchState(page, { round: 2, at: null });
    await page.evaluate(async () => { await window.__plan.now.train.load(); });
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
    const was2 = Number(await sheet(page).locator('#now-tnum2').inputValue());
    await sheet(page).locator('[data-now="tnum2"][data-v="1"]').click();
    await settle(page);
    assert.equal(await sheet(page).locator('#now-tnum2').inputValue(), String(was2 + 1), 'the second number has its own plus');
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

  await check('the Desk: the streak, twelve weeks of dots, and a chart behind each goal', async () => {
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', MON, TUE];
    const log = days.map((d, i) => ({ d, s: i % 3 ? 'Light' : 'Hard A', h: !(i % 3), n: i % 3 ? { free: 20 + i } : { lever: i < 6 ? 6 + i : 2 + i / 3, planche: 8 }, st: i % 3 ? {} : { lever: i < 6 ? 0 : 1, planche: 0 } }));
    await patchState(page, { log });
    await page.evaluate(() => { history.pushState({ view: 'today' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'today' } })); });
    await page.evaluate(() => { history.pushState({ view: 'desk' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'desk' } })); });
    await page.waitForSelector('.dk-train .tr-streak');
    assert.equal(await page.locator('.tr-big').innerText(), '14 days in a row. Your best yet.');
    assert.equal(await page.locator('.tr-grid g[data-kind="h"]').count(), 5);
    assert.equal(await page.locator('.tr-grid g[data-kind="l"]').count(), 9);
    assert.match(await page.locator('.dk-train .tr-rd').first().innerText(), /^Trained 14 days in the last 12 weeks\. Sundays are off and never count\.$/);
    await page.locator('.tr-grid g[data-kind="h"]').first().hover();
    assert.equal(await page.locator('.dk-train .tr-rd').first().innerText(), '2 weeks ago, Monday: hard day');
    // A goal opens its chart; again closes it; one at a time.
    await page.locator('.dk-goal-btn[data-goal="lever"]').click();
    await page.waitForSelector('.tr-chart .tr-svg');
    assert.equal(await page.locator('.tr-chart').count(), 1);
    assert.equal(await page.locator('.tr-svg .tr-ln').count() + await page.locator('.tr-svg .tr-ln.old').count() >= 2, true, 'broken where he moved up');
    assert.equal(await page.locator('.tr-svg .tr-ln.old').count(), 1);
    assert.match(await page.locator('.tr-chart .tr-rd').innerText(), /^Advanced tuck front lever: 6\.33 seconds now, up from 4 at the start of this step\.$|^Advanced tuck front lever: .+ now, up from .+ at the start of this step\.$/);
    await page.locator('.tr-svg').focus();
    await page.keyboard.press('ArrowLeft');
    assert.match(await page.locator('.tr-chart .tr-rd').innerText(), /^Nov \d+: .+ seconds, advanced tuck$/);
    await page.locator('.dk-goal-btn[data-goal="free"]').click();
    await page.waitForSelector('.dk-goal-btn[data-goal="free"][aria-expanded="true"]');
    assert.equal(await page.locator('.tr-chart').count(), 1, 'one open at a time');
    assert.match(await page.locator('.tr-chart svg').innerHTML(), /Goal 120/);
    await page.locator('.dk-goal-btn[data-goal="free"]').click();
    await page.waitForSelector('.dk-goal-btn[data-goal="free"][aria-expanded="false"]');
    assert.equal(await page.locator('.tr-chart').count(), 0, 'tapping again closes it');
    await page.locator('.dk-goal-btn[data-goal="vtest"]').click();
    await page.waitForSelector('.dk-goal-btn[data-goal="vtest"][aria-expanded="true"]');
    assert.equal(await page.locator('.tr-chart').innerText(), 'Your chart starts with your first number.');
    await page.locator('.dk-goal-btn[data-goal="lever"]').click();
    await page.waitForSelector('.dk-goal-btn[data-goal="lever"][aria-expanded="true"]');
    await page.locator('.dk-train').scrollIntoViewIfNeeded();
    await shot(page, 'train-streak');
    // Always there now (Nov 17 2026): an old hide class changes nothing.
    await page.evaluate(() => document.documentElement.classList.add('hide-trainstreak', 'hide-traincharts'));
    await page.evaluate(() => { history.pushState({ view: 'today' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'today' } })); });
    await page.evaluate(() => { history.pushState({ view: 'desk' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'desk' } })); });
    await page.waitForSelector('.dk-train .tr-streak');
    await settle(page);
    assert.ok(await page.locator('.dk-train .dk-goal-btn').count() > 0);
    await page.evaluate(() => document.documentElement.classList.remove('hide-trainstreak', 'hide-traincharts'));
  });

  await check('the Training page: an outline, the amounts as a chip to tap', async () => {
    await page.evaluate(() => { history.pushState({ view: 'desk' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'desk' } })); });
    await page.waitForSelector('.dk-train');
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

  await check('no line on Sunday', async () => {
    await dayIs(page, SUN);
    assert.equal((await lines(page, SUN)).length, 0);
  });
  await check('a week set by Claude: each weekday its own session, the other days rest', async () => {
    await patchState(page, { round: 8, at: null, made: null, week: { 1: 'Hard B', 3: 'Light' } });
    await dayIs(page, '2026-11-30');
    assert.equal((await until(() => lines(page, '2026-11-30'))).length, 1, 'Monday has its line');
    assert.equal(await page.evaluate(() => window.__plan.now.train.session().name), 'Hard B');
    await dayIs(page, '2026-12-01');
    await sleep(800);
    assert.equal((await lines(page, '2026-12-01')).length, 0, 'Tuesday rests');
    await patchState(page, { week: null });
  });
  assert.deepEqual(page.errors, []);

  // ---------- the phone ----------
  const { page: phone } = await open({ width: 412, height: 915 }, { hasTouch: true, isMobile: true });
  await check('the log fills once from the Training lines on the daily pages', async () => {
    const day = '2026-11-14';
    const top = row('li_old', 'line', `day-${day}`, 5, { text: 'Training: Hard A', content: [{ type: 'text', text: 'Training: Hard A' }], fields: { training: 'done', done: false } });
    const k1 = row('li_old1', 'line', 'li_old', 1, { text: 'Tuck front lever hold with Planche lean hold: 8 and 6 seconds, 5 of 5 rounds' });
    const k2 = row('li_old2', 'line', 'li_old', 2, { text: 'Pull-ups with Pseudo planche push-ups: 6 reps and 9 reps' });
    await put(phone, [row(`day-${day}`, 'day', null, 0, { title: day }), top, k1, k2]);
    await phone.reload();
    await started(phone);
    await phone.evaluate(() => { history.pushState({ view: 'desk' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'desk' } })); });
    await phone.waitForSelector('.dk-train .tr-streak');
    const log = await until(async () => (await state(phone))?.log);
    assert.deepEqual(log, [{ d: day, s: 'Hard A', h: true, n: { lever: 8, planche: 6, pull: 6, ppu: 9 }, st: { lever: 0, planche: 0 } }]);
    await phone.locator('.dk-goal-btn[data-goal="lever"]').tap();
    await phone.waitForSelector('.tr-chart .tr-svg');
    assert.equal(await phone.evaluate(() => document.scrollingElement.scrollWidth <= 412), true, 'no sideways scroll');
    const w = await phone.locator('.tr-svg').boundingBox();
    assert.ok(w.width <= 380, `chart ${w.width}`);
    await shot(phone, 'phone-train-chart');
  });

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
