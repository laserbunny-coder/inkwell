// Now: one thing at a time (Nov 15 2026). Today's first view: the thing you're
// on in large type, Done and Not now under it, and a gate before the next one.
// What's current is kept with the plan's settings, so the devices agree.
// Small things ride as one entry; a calendar event takes over five minutes
// before it starts; a sixth big thing added to today waits under Not planned.
// Plan rows are plain: the grip, the tick and the words.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4281;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const TODAY = '2026-11-16';
const at = (s) => `${TODAY}T${s}:00-08:00`;
const EVENTS = [{ id: 'c1:lesson', title: 'Private lesson', start: at('15:00'), end: at('16:00'), allDay: false, calendar: 'Acro' }];

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
const task = async (p, text) => (await all(p)).find((r) => r.text === text && r.fields?.task);
const pointer = async (p) => (await all(p)).find((r) => r.id === 'settings-plan')?.fields?.now || null;
const onNow = (p) => p.waitForFunction(() => document.documentElement.dataset.view === 'plan' && document.querySelector('#plan-sheet')?.dataset.tab === 'now' && !!document.querySelector('#plan-sheet .now-view'));
const thing = (p) => p.locator('#plan-sheet .now-thing').first().innerText();
const settle = async (p) => { await sleep(350); await still(p); };
const press = async (p, key) => { await p.evaluate(() => document.activeElement?.blur?.()); await p.keyboard.press(key); await settle(p); };
const add = async (p, text) => { const input = p.locator('#plan input[data-add]').first(); await input.fill(text); await input.press('Enter'); await sleep(350); };
const listWords = (p) => p.evaluate(() => [...document.querySelectorAll('#plan-sheet .now-list > .pl-task, #plan-sheet .now-list > .pl-wev')].map((el) => (el.classList.contains('pl-wev') ? `@ ${el.querySelector('.ev-w').textContent}` : el.querySelector('.pl-words').textContent)));
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, rowDetails: false, todayNow: true, ...extra });
  await ctx.addInitScript((events) => { window.__calendar = async () => ({ connected: true, events }); }, EVENTS);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.install({ time: new Date(`${TODAY}T09:04:00-08:00`) });
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return { ctx, page };
}

try {
  const { page } = await open({ width: 1400, height: 900 });

  await check('Today opens on its page while nothing is on it; plan rows are plain', async () => {
    await page.evaluate(() => document.querySelector('#view-toggle').click());
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    await settle(page);
    for (const t of ['Two-minute hook', 'Storyboard the cold open', 'Reply to Nate', 'Order passport photos']) await add(page, t);
    const row = page.locator('#plan .pl-task', { hasText: 'Storyboard the cold open' });
    assert.equal(await row.locator('.pl-check').isVisible(), true, 'the tick shows');
    assert.equal(await row.locator('.pl-est').isVisible(), false, 'no estimate or timer on the row');
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('hide-rowdetails')), 'Details on plan rows starts off');
  });

  await check('⋯ > A small thing marks a task small', async () => {
    for (const t of ['Reply to Nate', 'Order passport photos']) {
      const row = page.locator('#plan .pl-task', { hasText: t });
      await row.hover();
      await row.locator('.pl-more').click();
      await page.locator('.pop-menu .pop-item', { hasText: 'A small thing' }).click();
      await sleep(300);
    }
    assert.equal((await task(page, 'Reply to Nate')).fields.task.small, true);
    assert.equal((await task(page, 'Order passport photos')).fields.task.small, true);
  });

  await check('the switch reads Now, Page, Plan, Calendar; Today opens on Now once today has tasks', async () => {
    assert.deepEqual(await page.locator('.tb-m .today-switch .tb-btn').allInnerTexts(), ['Now', 'Page', 'Plan', 'Calendar']);
    await page.evaluate(() => document.querySelector('#desk-toggle').click());
    await page.waitForFunction(() => document.documentElement.dataset.view === 'desk');
    await page.evaluate(() => document.querySelector('#view-toggle').click());
    await onNow(page);
    await settle(page);
    assert.equal(await page.locator('.today-switch .tb-btn[aria-current="page"]').innerText(), 'Now');
  });

  await check('the gate: Next, with Begin, and nothing current until Begin', async () => {
    assert.equal(await page.locator('#plan-sheet .now-eyebrow').innerText(), 'NEXT');
    assert.equal(await thing(page), 'Two-minute hook');
    assert.equal((await pointer(page))?.task || null, null);
    await shot(page, 'now-gate');
    await press(page, 'b');
    assert.equal(await thing(page), 'Two-minute hook');
    assert.equal(await page.locator('#plan-sheet .now-btn.go').innerText(), 'Done');
    const id = (await task(page, 'Two-minute hook')).id;
    const st = await pointer(page);
    assert.equal(st.task, id, 'the pointer is kept with the plan, so the phone sees it');
    assert.equal(st.day, TODAY);
  });

  await check('Alone: one quiet line, the next fixed time beside it; Space opens the list', async () => {
    assert.equal(await page.locator('#plan-sheet .now-more').innerText(), '2 more today');
    assert.equal(await page.locator('#plan-sheet .now-ev').innerText(), '3 pm · Private lesson');
    assert.equal(await page.locator('#plan-sheet .now-list').count(), 0, 'the list waits until asked');
    await shot(page, 'now-alone');
    await press(page, 'Space');
    assert.deepEqual(await listWords(page), ['Storyboard the cold open', 'A few small things', '@ Private lesson']);
    await shot(page, 'now-list');
  });

  await check('drag the small things above the next one: they keep their own order', async () => {
    await page.locator('#plan-sheet .now-group').dragTo(page.locator('#plan-sheet .now-list > .pl-task', { hasText: 'Storyboard the cold open' }), { targetPosition: { x: 200, y: 3 } });
    await settle(page);
    assert.deepEqual(await listWords(page), ['A few small things', 'Storyboard the cold open', '@ Private lesson']);
    const o = async (t) => (await task(page, t)).fields.task.order;
    assert.ok((await o('Reply to Nate')) < (await o('Order passport photos')));
    assert.ok((await o('Order passport photos')) < (await o('Storyboard the cold open')));
  });

  await check('inside the small things: their names, dragged into a new order', async () => {
    await page.locator('#plan-sheet .now-group .now-gfold').click();
    await settle(page);
    const names = () => page.locator('#plan-sheet .now-smalls .pl-task .pl-words').allInnerTexts();
    assert.deepEqual(await names(), ['Reply to Nate', 'Order passport photos']);
    await shot(page, 'now-smalls');
    await page.locator('#plan-sheet .now-smalls .pl-task', { hasText: 'Order passport photos' }).dragTo(page.locator('#plan-sheet .now-smalls .pl-task', { hasText: 'Reply to Nate' }), { targetPosition: { x: 200, y: 3 } });
    await settle(page);
    assert.deepEqual(await names(), ['Order passport photos', 'Reply to Nate']);
    assert.deepEqual(await listWords(page), ['A few small things', 'Storyboard the cold open', '@ Private lesson'], 'still first');
  });

  await check('D: done, then the gate says so in one faint line and offers the next', async () => {
    await press(page, 'd');
    assert.ok((await task(page, 'Two-minute hook')).fields.done);
    assert.match(await page.locator('#plan-sheet .now-was').innerText(), /Two-minute hook\s+Done\./);
    assert.equal(await thing(page), 'A few small things');
    assert.equal((await pointer(page)).task, null);
    await shot(page, 'now-done-gate');
  });

  await check('the small things, one at a time: Done and Skip this one', async () => {
    await press(page, 'b');
    assert.equal(await page.locator('#plan-sheet .now-eyebrow').innerText(), 'SMALL THINGS · 2 LEFT');
    assert.equal(await thing(page), 'Order passport photos');
    await shot(page, 'now-smalls-run');
    await page.locator('#plan-sheet .now-btn', { hasText: 'Skip this one' }).click();
    await settle(page);
    assert.equal(await thing(page), 'Reply to Nate');
    await page.locator('#plan-sheet .now-btn.go', { hasText: 'Done' }).click();
    await settle(page);
    assert.ok((await task(page, 'Reply to Nate')).fields.done);
    assert.equal((await task(page, 'Order passport photos')).fields.done, false, 'the skipped one stays for later');
    assert.match(await page.locator('#plan-sheet .now-was').innerText(), /The small things\s+Done\. 1 left for later\./);
  });

  await check('Not now > Enough for today: worked on, and back tomorrow', async () => {
    assert.equal(await thing(page), 'Storyboard the cold open');
    await press(page, 'b');
    await press(page, 'n');
    assert.equal(await page.locator('#plan-sheet .now-choice').count(), 3);
    await shot(page, 'now-notnow');
    await press(page, '2');
    const t = (await task(page, 'Storyboard the cold open')).fields.task;
    assert.equal(t.day, '2026-11-17');
    assert.deepEqual(t.worked, [TODAY]);
    assert.match(await page.locator('#plan-sheet .now-was').innerText(), /Enough for today\. It comes back tomorrow\./);
    assert.match(await page.locator('.toast').innerText(), /Undo/);
  });

  await check('Undo puts it back, and it is current again', async () => {
    await page.locator('.toast .toast-action', { hasText: 'Undo' }).click();
    await settle(page);
    await sleep(300);
    const t = (await task(page, 'Storyboard the cold open')).fields.task;
    assert.equal(t.day, TODAY);
    assert.equal(t.worked || null, null);
    assert.equal(await thing(page), 'Storyboard the cold open');
    assert.equal(await page.locator('#plan-sheet .now-btn.go').innerText(), 'Done');
  });

  await check('Not now > Later today: to the end of today’s order', async () => {
    await add2(page, 'Call the passport office');
    await press(page, 'n');
    await press(page, '1');
    const a = (await task(page, 'Storyboard the cold open')).fields.task;
    const b = (await task(page, 'Call the passport office')).fields.task;
    assert.equal(a.day, TODAY);
    assert.ok(a.order > b.order, 'after the one added later');
  });

  await check('Not now > Another day: off today, under Not planned', async () => {
    // Choose another: Call the passport office.
    await press(page, 'Space');
    await page.locator('#plan-sheet .now-list .pl-task', { hasText: 'Call the passport office' }).locator('.pl-words').click();
    await page.locator('.pop-menu .pop-item', { hasText: 'Do this now' }).click();
    await settle(page);
    assert.equal(await thing(page), 'Call the passport office');
    await press(page, 'n');
    await press(page, '3');
    const t = (await task(page, 'Call the passport office')).fields.task;
    assert.equal(t.day, null);
    assert.equal(t.span || null, null);
    assert.match(await page.locator('#plan-sheet .now-was').innerText(), /Off today\. It waits in Plan under Not planned\./);
  });

  await check('a calendar event takes over five minutes before it starts, then “You were on” it', async () => {
    await press(page, 'b');
    const was = await thing(page);
    await page.clock.setSystemTime(new Date(`${TODAY}T14:56:00-08:00`));
    await page.evaluate(() => window.__plan.redraw());
    await settle(page);
    assert.equal(await thing(page), 'Private lesson');
    assert.equal(await page.locator('#plan-sheet .now-eyebrow').innerText(), 'IN 4 MINUTES');
    assert.match(await page.locator('#plan-sheet .now-aside').innerText(), /^Set aside: /);
    assert.ok(was);
    await shot(page, 'now-event');
    await page.locator('#plan-sheet .now-btn', { hasText: 'It is over' }).click();
    await settle(page);
    assert.equal(await page.locator('#plan-sheet .now-eyebrow').innerText(), 'YOU WERE ON');
    assert.equal(await page.locator('#plan-sheet .now-btn.go').innerText(), 'Pick it back up');
    assert.match(await page.locator('#plan-sheet .now-was').innerText(), /Private lesson\s+Over\./);
    await page.locator('#plan-sheet .now-btn.go').click();
    await settle(page);
    assert.equal(await page.locator('#plan-sheet .now-btn.go').innerText(), 'Done');
    await page.clock.setSystemTime(new Date(`${TODAY}T16:10:00-08:00`));
  });

  await check('faces: With what is next, and The day as a line', async () => {
    await page.evaluate(() => { localStorage.setItem('nowFace', 'next'); window.__plan.redraw(); });
    await settle(page);
    assert.ok(await page.locator('#plan-sheet .now-next .now-list').count(), 'what is next fades beneath');
    await shot(page, 'now-face-next');
    await page.evaluate(() => { localStorage.setItem('nowFace', 'line'); window.__plan.redraw(); });
    await settle(page);
    assert.ok(await page.locator('#plan-sheet .now-thread .th-done').count() >= 2, 'done things on the line');
    assert.equal(await page.locator('#plan-sheet .now-thread .th-now .now-thing').count(), 1);
    await shot(page, 'now-face-line');
    await page.evaluate(() => { localStorage.setItem('nowFace', 'alone'); window.__plan.redraw(); });
  });

  await check('Alt + P on Now: the day beside the one thing, and back', async () => {
    await press(page, 'Alt+P');
    assert.equal(await page.locator('#plan-sheet .now-two').count(), 1);
    await shot(page, 'now-side');
    await press(page, 'Alt+P');
    assert.equal(await page.locator('#plan-sheet .now-two').count(), 0);
  });

  await check('Alt + 2, 3, 4: Page, Plan, Calendar; Alt + 1 back to Now, also with the caret in text', async () => {
    await press(page, 'Alt+2');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    await press(page, 'Alt+3');
    await page.waitForFunction(() => document.querySelector('#plan-sheet')?.dataset.tab === 'plan');
    await press(page, 'Alt+4');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'plan' && !['plan', 'now'].includes(document.querySelector('#plan-sheet')?.dataset.tab));
    await page.evaluate(() => document.querySelector('#library-toggle').click());
    await page.waitForFunction(() => document.documentElement.dataset.view === 'library');
    await page.evaluate(() => document.querySelector('#view-toggle').click());
    await onNow(page);
    await press(page, 'Alt+2');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    await page.locator('#outline-editor .ProseMirror, .notebook .ProseMirror').first().click();
    await page.keyboard.press('Alt+1');
    await onNow(page);
  });

  await check('with “Decide before the next thing” off, the next one starts by itself', async () => {
    await page.evaluate(() => { const h = JSON.parse(localStorage.getItem('hide') || '[]'); h.push('nowgate'); localStorage.setItem('hide', JSON.stringify(h)); document.documentElement.classList.add('hide-nowgate'); });
    const before = await thing(page);
    await press(page, 'd');
    assert.notEqual(await thing(page), before);
    assert.equal(await page.locator('#plan-sheet .now-btn.go').innerText(), 'Done', 'already begun');
    await page.evaluate(() => { const h = JSON.parse(localStorage.getItem('hide') || '[]').filter((x) => x !== 'nowgate'); localStorage.setItem('hide', JSON.stringify(h)); document.documentElement.classList.remove('hide-nowgate'); });
  });

  await check('five big things at most: a sixth added from the box waits under Not planned, with Undo', async () => {
    for (const t of ['Big one', 'Big two', 'Big three', 'Big four', 'Big five']) await boxTask(page, t);
    const open = (await all(page)).filter((r) => r.fields?.task?.day === TODAY && !r.fields.done && !r.fields.task.small && !r.fields.task.habit);
    assert.ok(open.length >= 5, `five or more big things on today (${open.length})`);
    await boxTask(page, 'Big six');
    const six = (await task(page, 'Big six')).fields.task;
    assert.equal(six.day, null);
    assert.match(await page.locator('.toast').innerText(), /Five big things are on today already/);
    await page.locator('.toast .toast-action', { hasText: 'Undo' }).click();
    await sleep(400);
    assert.equal((await task(page, 'Big six')).fields.task.day, TODAY);
  });

  await check('every new command is in All commands, under Plan and tasks', async () => {
    const list = await page.evaluate(() => window.__commandList());
    for (const l of ['Now: the one thing you’re on', 'Now: Done with the one thing', 'Now: Not now (later today, enough for today, another day)', 'Now: Begin the next thing', 'Now: what is next today (show or hide the list)', 'Show the one thing: Alone', 'Show or hide details on plan rows', 'Show or hide the five big things limit']) {
      const c = list.find((x) => x.label === l);
      assert.ok(c, `${l} is there`);
      assert.ok(c.hint && c.words?.length, `${l} has a hint and words`);
      if (l !== 'Now: the one thing you’re on') assert.equal(c.group, 'plan', `${l} is under Plan and tasks`);
    }
  });

  assert.deepEqual(page.errors, []);

  // ---------- the phone ----------
  const { page: phone, ctx: pctx } = await open({ width: 412, height: 915 }, { hasTouch: true, isMobile: true, todayPage: false });

  await check('phone: Now, Page, Plan, Calendar in one row that never wraps', async () => {
    await phone.evaluate(() => document.querySelector('#view-toggle').click());
    await phone.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    await settle(phone);
    for (const t of ['Hook for episode two', 'Answer the lesson emails', 'Back up the grade']) await add(phone, t);
    await phone.evaluate(() => document.activeElement?.blur());
    await phone.locator('.tp-switch button', { hasText: 'Now' }).tap();
    await onNow(phone);
    await settle(phone);
    const tops = await phone.locator('#plan-sheet .pl-switch-phone button').evaluateAll((bs) => bs.map((b) => [b.textContent, Math.round(b.getBoundingClientRect().top)]));
    assert.deepEqual(tops.map((x) => x[0]), ['Now', 'Page', 'Plan', 'Calendar']);
    assert.equal(new Set(tops.map((x) => x[1])).size, 1, 'one row');
    assert.ok(await phone.evaluate(() => { const r = document.querySelector('#plan-sheet .pl-switch-phone'); return r.scrollWidth <= r.clientWidth + 1; }), 'nothing hidden off the side');
    await shot(phone, 'phone-gate');
  });

  await check('phone: Begin, then the one thing in large type with Done and Not now', async () => {
    await phone.locator('#plan-sheet .now-btn.go', { hasText: 'Begin' }).tap();
    await settle(phone);
    assert.equal(await thing(phone), 'Hook for episode two');
    assert.ok(await phone.locator('#plan-sheet .now-btn', { hasText: 'Not now' }).isVisible());
    await shot(phone, 'phone-now');
    await phone.locator('#plan-sheet .now-more').tap();
    await settle(phone);
    assert.deepEqual(await listWords(phone), ['Answer the lesson emails', 'Back up the grade', '@ Private lesson']);
    assert.ok(await phone.locator('#plan-sheet .now-list .pl-grip').first().isVisible(), 'the six dots show on a phone');
    await shot(phone, 'phone-list');
  });

  await check('phone: the six dots slide a row to a new place in Now’s list', async () => {
    const cdp = await pctx.newCDPSession(phone);
    const box = async (t) => phone.locator('#plan-sheet .now-list .pl-task', { hasText: t }).boundingBox();
    const grip = await phone.locator('#plan-sheet .now-list .pl-task', { hasText: 'Back up the grade' }).locator('.pl-grip').boundingBox();
    const to = await box('Answer the lesson emails');
    const gx = grip.x + grip.width / 2;
    const gy = grip.y + grip.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: gx, y: gy }] });
    await sleep(60);
    for (let k = 1; k <= 8; k += 1) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: gx, y: gy + ((to.y + 4 - gy) * k) / 8 }] }); await sleep(30); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle(phone);
    await sleep(300);
    assert.deepEqual(await listWords(phone), ['Back up the grade', 'Answer the lesson emails', '@ Private lesson']);
  });

  await check('phone: Not now offers the three, big enough for a thumb', async () => {
    await phone.locator('#plan-sheet .now-btn', { hasText: 'Not now' }).tap();
    await settle(phone);
    const h = await phone.locator('#plan-sheet .now-choice').first().evaluate((b) => b.getBoundingClientRect().height);
    assert.ok(h >= 44, `tall enough (${h})`);
    await shot(phone, 'phone-notnow');
    await phone.locator('#plan-sheet .now-choice', { hasText: 'Later today' }).tap();
    await settle(phone);
    assert.match(await phone.locator('#plan-sheet .now-was').innerText(), /Set aside for later today\./);
  });

  assert.deepEqual(phone.errors, []);
} finally {
  await browser.close();
  server.kill();
}

// Adds a task to today on the Page, then comes back to Now.
async function add2(p, text) {
  await p.keyboard.press('Alt+2');
  await p.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
  await settle(p);
  await add(p, text);
  await p.evaluate(() => document.activeElement?.blur());
  await p.keyboard.press('Alt+1');
  await onNow(p);
  await settle(p);
}
// A task typed into the one box (Ctrl + K), for today.
async function boxTask(p, text) {
  await p.evaluate(() => document.activeElement?.blur?.());
  await p.keyboard.press('Control+k');
  await p.waitForFunction(() => !document.querySelector('.palette').hidden && document.querySelector('.palette')?.dataset.loaded !== undefined);
  await p.locator('#palette-input').fill(text);
  await sleep(250);
  await p.keyboard.press('Control+Enter');
  await sleep(600);
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
