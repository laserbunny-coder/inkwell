// Today with tasks. A task is an ordinary line with a day; the plan on top of
// a day's page gathers them, Week shows seven days and the tray, Pace looks
// back at planned against real.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4264;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const NOW = '2026-11-09T14:04:00-08:00'; // a Monday

// The switch is lit at the very end of a move: wait for it rather than read it at once.
const TAB = { Day: 'calday', Week: 'week', 'Six weeks': 'ahead', Pace: 'pace' };
const ZOOM = '#plan-sheet .pl-zoom [aria-pressed="true"]';
// Calendar, then a zoom (Week, Pace…), the way a click gets there.
const zoomTo = async (p, label, tap = false) => {
  const cal = p.locator(tap ? '.tp-switch .pl-switch button, #plan-sheet .pl-switch button' : '.today-switch button[data-cmd="calendar"]', { hasText: 'Calendar' }).first();
  if (await p.evaluate(() => document.documentElement.dataset.view !== 'plan' || !document.querySelector('#plan-sheet .pl-zoom'))) { if (tap) await cal.tap(); else await cal.click(); }
  await p.waitForSelector('#plan-sheet .pl-zoom');
  const b = p.locator(`#plan-sheet .pl-zoom button[data-tab="${TAB[label]}"]`);
  if (tap) await b.tap(); else await b.click();
  await p.waitForFunction(([z, l]) => document.querySelector(z)?.innerText.trim() === l, [ZOOM, label]);
};
const lit = (p, sel, text) => p.waitForFunction(([s, t]) => document.querySelector(s)?.innerText.trim() === t, [sel, text]);

const browser = withoutSync(await chromium.launch());
async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, ...extra });
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
const tasks = async (p) => (await all(p)).filter((r) => r.fields?.task && !r.deleted);
const taskNamed = async (p, text) => (await tasks(p)).find((r) => r.text === text);
const viewOf = (p) => p.evaluate(() => document.documentElement.dataset.view || 'write');
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
// Today, Tomorrow and the rest of the times are in the When picker (from "When…" in the menu).
const WHEN = { Today: 'Today', Tomorrow: 'Tomorrow', 'Not on a day yet': 'Not planned' };
const pick = async (p, label) => {
  if (WHEN[label]) {
    // A step's label opens the picker straight away; a menu has "When…".
    await p.waitForSelector('.when-pick, .pop-menu');
    if (!(await p.locator('.when-pick').count())) await p.locator('.pop-menu .pop-item', { hasText: 'When' }).first().click();
    await p.waitForSelector('.when-pick');
    await p.locator('.when-pick .wp-opt', { hasText: WHEN[label] }).first().click();
  } else await p.locator('.pop-menu .pop-item', { hasText: label }).first().click();
  await sleep(300);
};
const words = (p, root = '#plan') => p.locator(`${root} .pl-task .pl-words`).allInnerTexts();
const row = (p, text) => p.locator('#plan .pl-task', { hasText: text });
const today = async (p) => {
  await p.evaluate(() => document.querySelector('#view-toggle').click());
  await p.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
  await still(p);
  await sleep(300);
};
const add = async (p, text, box = '#plan input[data-add]') => {
  const input = p.locator(box).first();
  await input.fill(text);
  await input.press('Enter');
  await sleep(350);
};

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

try {
  const page = await open({ width: 1440, height: 900 });
  await today(page);

  await check('a day’s page has its plan on top, and the top-centre switch is Today, Plan, Calendar', async () => {
    assert.ok(await page.locator('#plan').isVisible());
    assert.equal(await page.locator('#plan .pl-label').innerText(), 'PLAN');
    assert.equal(await page.locator('#plan input[data-add]').getAttribute('placeholder'), 'Add a task');
    assert.deepEqual(await page.locator('.today-switch button').allInnerTexts(), ['Today', 'Plan', 'Calendar']);
    await lit(page, '.today-switch [aria-current="page"]', 'Today');
    assert.ok(await page.locator('.place-switch:not(.desk-switch):not(.today-switch)').isHidden(), 'the Library’s switch is away');
    assert.ok(await page.locator('#plan .pl-switch').isHidden(), 'with the rail, no second switch in the page');
  });

  await check('a task typed into the plan lands on today, and a time at the end is how long it takes', async () => {
    // The very same box stays (a phone keyboard closes if the focused box is swapped for a new one).
    await page.evaluate(() => { document.querySelector('#plan input[data-add]').__kept = true; });
    assert.equal(await page.locator('#plan input[data-add]').getAttribute('enterkeyhint'), 'enter', 'a phone keyboard shows Enter, not Done');
    await add(page, 'Call Dana about the storyboards 30m');
    await add(page, 'Board Reel 2 1h 30m');
    await add(page, 'Order the storage drive');
    assert.equal(await page.evaluate(() => document.activeElement?.__kept === true), true, 'the same box, still with the caret');
    assert.deepEqual(await words(page), ['Call Dana about the storyboards', 'Board Reel 2', 'Order the storage drive']);
    assert.equal(await page.locator('#plan .pl-sum').innerText(), '2 h to do');
    assert.equal(await row(page, 'Call Dana').locator('.pl-est').innerText(), '30 min');
    assert.equal(await row(page, 'Board Reel 2').locator('.pl-est').innerText(), '1 h 30 min');
    assert.ok(await row(page, 'Call Dana').evaluate((el) => el.classList.contains('next')), 'the first one is what’s next');
    const t = await taskNamed(page, 'Call Dana about the storyboards');
    assert.equal(t.kind, 'line');
    assert.equal(t.parent_id, 'page-tasks', 'it lives on the Tasks page');
    assert.equal(t.fields.task.day, '2026-11-09');
    assert.equal(t.fields.task.est, 30);
    assert.equal(t.fields.box, true);
    const home = (await all(page)).find((r) => r.id === 'page-tasks');
    assert.equal(home.title, 'Tasks');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.add), '2026-11-09', 'the caret stays in the box for the next one');
  });

  await check('how long: a click on the time offers lengths, and the total follows', async () => {
    await row(page, 'Order the storage drive').hover();
    await row(page, 'Order the storage drive').locator('.pl-est').click();
    await pick(page, '15 min');
    assert.equal(await row(page, 'Order the storage drive').locator('.pl-est').innerText(), '15 min');
    assert.equal(await page.locator('#plan .pl-sum').innerText(), '2 h 15 min to do');
    assert.equal((await taskNamed(page, 'Order the storage drive')).fields.task.est, 15);
  });

  await check('the timer: one at a time, counting on the page; ticking asks how long it took with the timed answer lit', async () => {
    await row(page, 'Board Reel 2').hover();
    await row(page, 'Board Reel 2').locator('.pl-play').click();
    await sleep(300);
    await row(page, 'Call Dana').hover();
    await row(page, 'Call Dana').locator('.pl-play').click();
    await sleep(300);
    assert.equal(await page.locator('#plan .pl-task.timing').count(), 1, 'starting one stops the other');
    assert.ok(await row(page, 'Call Dana').evaluate((el) => el.classList.contains('timing')));
    await page.clock.setFixedTime(new Date('2026-11-09T14:16:00-08:00'));
    await sleep(1300);
    assert.equal(await row(page, 'Call Dana').locator('.pl-est').innerText(), '12:00');
    await row(page, 'Call Dana').locator('.pl-check').click();
    await sleep(400);
    const took = page.locator('#plan .pl-took');
    assert.ok(await took.isVisible());
    assert.equal(await took.locator('button.on').innerText(), '12 min timed');
    assert.ok((await took.locator('button').allInnerTexts()).includes('30 min as planned'));
    await took.locator('button.on').click();
    await sleep(350);
    assert.equal(await page.locator('#plan .pl-took').count(), 0);
    const done = row(page, 'Call Dana');
    assert.ok(await done.evaluate((el) => el.classList.contains('done')));
    assert.equal(await done.locator('.pl-est').innerText(), '30 min → 12 min');
    assert.equal(await page.locator('#plan .pl-sum').innerText(), '1 h 45 min to do · 12 min done');
    const t = await taskNamed(page, 'Call Dana about the storyboards');
    assert.equal(t.fields.done, true);
    assert.equal(t.fields.task.actual, 12);
    assert.equal(t.fields.task.run, null);
    assert.equal(t.fields.task.log.length, 1);
    assert.ok(t.fields.task.done_at > 0);
    assert.deepEqual(await words(page), ['Board Reel 2', 'Order the storage drive', 'Call Dana about the storyboards'], 'done sinks under the open ones');
  });

  await check('unticking brings it back, with nothing kept of the answer', async () => {
    await row(page, 'Call Dana').locator('.pl-check').click();
    await sleep(350);
    const t = await taskNamed(page, 'Call Dana about the storyboards');
    assert.equal(t.fields.done, false);
    assert.equal(t.fields.task.done_at, null);
    assert.equal(t.fields.task.actual, null);
    assert.ok(!(await row(page, 'Call Dana').evaluate((el) => el.classList.contains('done'))));
    await row(page, 'Call Dana').locator('.pl-check').click();
    await sleep(350);
    await page.locator('#plan .pl-took button', { hasText: 'as planned' }).click();
    await sleep(350);
    assert.equal((await taskNamed(page, 'Call Dana about the storyboards')).fields.task.actual, 30);
  });

  await check('Ctrl + Shift + Enter makes any line a task where it’s written, with a quiet label after its words', async () => {
    await page.locator('#outline-editor').click();
    await page.keyboard.type('Email the storyboard notes');
    await page.keyboard.press('Control+Shift+Enter');
    await sleep(600);
    const li = page.locator('#outline-editor li', { hasText: 'Email the storyboard notes' });
    assert.equal(await li.locator('.task-chip').innerText(), 'Today');
    assert.equal(await li.locator('.line-box').count(), 1, 'it has a box to tick');
    assert.ok((await words(page)).includes('Email the storyboard notes'), 'and it’s on the plan');
    assert.equal(await row(page, 'Email the storyboard notes').locator('.pl-place').count(), 0, 'no “where” for a line on this very page');
    const t = await taskNamed(page, 'Email the storyboard notes');
    assert.equal(t.parent_id, 'day-2026-11-09', 'it stays where it was written');
    assert.equal(t.fields.task.day, '2026-11-09');
    // The words are still ordinary words.
    await page.keyboard.type(' to Dana');
    await sleep(700);
    assert.equal((await taskNamed(page, 'Email the storyboard notes to Dana')).fields.task.day, '2026-11-09');
    assert.ok((await words(page)).includes('Email the storyboard notes to Dana'));
  });

  await check('ticking its box on the page ticks it on the plan, and the other way round', async () => {
    const li = page.locator('#outline-editor li', { hasText: 'Email the storyboard notes to Dana' });
    await li.locator('.line-box').click();
    await sleep(800);
    assert.ok(await row(page, 'Email the storyboard notes').evaluate((el) => el.classList.contains('done')));
    let t = await taskNamed(page, 'Email the storyboard notes to Dana');
    assert.equal(t.fields.done, true);
    assert.ok(t.fields.task.done_at > 0, 'done on the page says when, too');
    assert.equal(await li.locator('.task-chip').innerText(), 'Done');
    await row(page, 'Email the storyboard notes').locator('.pl-check').click();
    await sleep(800);
    assert.equal(await li.locator('.line-box').getAttribute('aria-checked'), 'false');
    assert.equal(await li.locator('.task-chip').innerText(), 'Today');
    t = await taskNamed(page, 'Email the storyboard notes to Dana');
    assert.equal(t.fields.done, false);
  });

  await check('the label on the page opens the same menu: Tomorrow takes it off today’s plan', async () => {
    const li = page.locator('#outline-editor li', { hasText: 'Email the storyboard notes to Dana' });
    await li.locator('.task-chip').click();
    await sleep(300);
    await pick(page, 'Tomorrow');
    await sleep(400);
    assert.equal(await li.locator('.task-chip').innerText(), 'Tomorrow');
    assert.ok(!(await words(page)).includes('Email the storyboard notes to Dana'));
    assert.equal((await taskNamed(page, 'Email the storyboard notes to Dana')).fields.task.day, '2026-11-10');
    await li.locator('.task-chip').click();
    await sleep(300);
    await pick(page, 'Takes');
    await pick(page, '45 min');
    await sleep(300);
    assert.equal(await li.locator('.task-chip').innerText(), 'Tomorrow · 45 min');
  });

  await check('a double-click on a task’s words changes them in place', async () => {
    await row(page, 'Order the storage drive').locator('.pl-words').dblclick();
    const input = page.locator('#plan .pl-rename');
    await input.fill('Order the 8 TB storage drive');
    await input.press('Enter');
    await sleep(400);
    assert.ok((await words(page)).includes('Order the 8 TB storage drive'));
    const t = await taskNamed(page, 'Order the 8 TB storage drive');
    assert.deepEqual(t.content, [{ type: 'text', text: 'Order the 8 TB storage drive' }]);
    assert.equal(t.fields.task.est, 15, 'the rest of the task is as it was');
    await sleep(400);
    assert.equal(await page.locator('.pane').count(), 0, 'a double-click doesn’t open it as well');
  });

  await check('six dots show a task can be moved; Alt + Up and Alt + Down move it with the keyboard', async () => {
    const r = row(page, 'Order the 8 TB');
    const op = () => r.locator('.pl-grip').evaluate((g) => getComputedStyle(g).opacity);
    await page.mouse.move(5, 5);
    await sleep(200);
    assert.equal(await op(), '0', 'quiet until the pointer is on it');
    await r.hover();
    await sleep(200);
    assert.equal(await op(), '1');
    assert.equal(await row(page, 'Call Dana').locator('.pl-grip').count(), 0, 'a done task has none');
    assert.deepEqual((await words(page)).slice(0, 2), ['Board Reel 2', 'Order the 8 TB storage drive']);
    await r.locator('.pl-words').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForFunction(() => document.querySelector('#plan .pl-task .pl-words')?.textContent === 'Order the 8 TB storage drive');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Order the 8 TB storage drive', 'the keyboard stays on it');
    await page.keyboard.press('Alt+ArrowUp');
    await sleep(300);
    assert.equal((await words(page))[0], 'Order the 8 TB storage drive', 'the top is the top');
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForFunction(() => document.querySelector('#plan .pl-task .pl-words')?.textContent === 'Board Reel 2');
    assert.equal((await taskNamed(page, 'Board Reel 2')).fields.task.order < (await taskNamed(page, 'Order the 8 TB storage drive')).fields.task.order, true, 'the order is saved');
    await page.evaluate(() => document.documentElement.classList.add('hide-taskgrip'));
    assert.equal(await r.locator('.pl-grip').isVisible(), false, 'Look can switch the dots off');
    await page.evaluate(() => document.documentElement.classList.remove('hide-taskgrip'));
  });

  await check('a click on a task zooms into it, Alt + Left zooms back out to the plan, Ctrl + click opens it beside', async () => {
    await row(page, 'Order the 8 TB').locator('.pl-words').click();
    await page.waitForFunction(() => /Order the 8 TB/.test(document.querySelector('#outline-editor li.zoom-root')?.textContent || ''));
    assert.equal(await viewOf(page), 'notebook');
    assert.equal(await page.locator('.pane-frame').count(), 0, 'nothing opened beside');
    await page.keyboard.press('Alt+ArrowLeft');
    await page.waitForFunction(() => !document.querySelector('#outline-editor li.zoom-root') && document.querySelectorAll('#plan .pl-task').length >= 2);
    await row(page, 'Order the 8 TB').locator('.pl-words').click({ modifiers: ['Control'] });
    await page.waitForFunction(() => {
      const d = [...document.querySelectorAll('.pane-frame')].at(-1)?.contentDocument;
      return d?.documentElement?.dataset.started === '1' && /Order the 8 TB/.test(d.querySelector('#outline-editor li.zoom-root')?.textContent || '');
    }, null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => !!document.querySelector('#outline-editor li.zoom-root')), false, 'the main view stays on the day');
    await page.evaluate(() => window.__panes.closeAll());
    await page.waitForFunction(() => !document.querySelector('.pane'));
  });

  await check('dragging a task up changes the day’s order, and it holds after a reload', async () => {
    assert.deepEqual((await words(page)).slice(0, 2), ['Board Reel 2', 'Order the 8 TB storage drive']);
    await row(page, 'Order the 8 TB').dragTo(row(page, 'Board Reel 2'), { targetPosition: { x: 200, y: 4 } });
    await sleep(500);
    assert.deepEqual((await words(page)).slice(0, 2), ['Order the 8 TB storage drive', 'Board Reel 2']);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await today(page);
    assert.deepEqual((await words(page)).slice(0, 2), ['Order the 8 TB storage drive', 'Board Reel 2']);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/plan-day.png` });
  });

  await check('the ⋯ menu: “Open it where it’s written” goes to the Tasks page, which has no plan of its own', async () => {
    await row(page, 'Board Reel 2').hover();
    await row(page, 'Board Reel 2').locator('.pl-more').click();
    await sleep(250);
    await pick(page, 'Open it where it’s written');
    await page.waitForFunction(() => document.querySelector('#nb-title')?.textContent === 'Tasks');
    await sleep(400);
    assert.ok(await page.locator('#plan').isHidden());
    assert.ok(await page.locator('.today-switch').isHidden());
    const li = page.locator('#outline-editor li', { hasText: 'Board Reel 2' });
    assert.equal(await li.locator('.task-chip').innerText(), 'Today · 1 h 30 min');
    await today(page);
    assert.ok(await page.locator('#plan').isVisible());
  });

  await check('Week: seven days from Monday, today’s tasks under today, hours against the hours you have', async () => {
    await zoomTo(page, 'Week');
    await still(page);
    await sleep(300);
    await lit(page, '.today-switch [aria-current="page"]', 'Calendar');
    assert.equal(await page.locator('#view-toggle').getAttribute('aria-current'), 'page', 'Today stays lit in the rail');
    assert.equal(await page.locator('#plan-sheet h1').innerText(), 'November 9 to 15');
    assert.equal(await page.locator('#plan-sheet .pl-eyebrow').innerText(), 'THIS WEEK');
    assert.equal(await page.locator('.pw-day').count(), 7);
    assert.deepEqual(await page.locator('.pw-day.today .pw-t').allInnerTexts(), ['Order the 8 TB storage drive', 'Board Reel 2', 'Call Dana about the storyboards']);
    assert.deepEqual(await page.locator('.pw-day[data-day="2026-11-10"] .pw-t').allInnerTexts(), ['Email the storyboard notes to Dana']);
    // 15 + 90 open and 30 real on Monday, 45 on Tuesday: 3 hours.
    assert.equal(await page.locator('#plan-sheet .pl-meter-v').innerText(), '3 h of 45 h');
    assert.equal(await page.locator('#tb-back').isVisible(), true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/plan-week.png` });
  });

  await check('Week: drag a task to another day, or to “Not on a day yet”', async () => {
    await page.locator('.pw-task', { hasText: 'Board Reel 2' }).dragTo(page.locator('.pw-day[data-day="2026-11-11"]'), { targetPosition: { x: 40, y: 120 } });
    await sleep(500);
    assert.deepEqual(await page.locator('.pw-day[data-day="2026-11-11"] .pw-t').allInnerTexts(), ['Board Reel 2']);
    assert.equal((await taskNamed(page, 'Board Reel 2')).fields.task.day, '2026-11-11');
    await page.locator('.pw-task', { hasText: 'Order the 8 TB' }).dragTo(page.locator('.pw-tray'));
    await sleep(500);
    assert.deepEqual(await page.locator('.pw-tray .pw-t').allInnerTexts(), ['Order the 8 TB storage drive']);
    assert.equal((await taskNamed(page, 'Order the 8 TB storage drive')).fields.task.day, null);
    assert.equal(await page.locator('#plan-sheet .pl-meter-v').innerText(), '2.8 h of 45 h', 'the tray isn’t on the week’s hours');
  });

  await check('Week: add straight to a day or to the tray; a click on a task opens its menu', async () => {
    await add(page, 'Film the tumbling class 2h', '.pw-day[data-day="2026-11-13"] input[data-add]');
    assert.deepEqual(await page.locator('.pw-day[data-day="2026-11-13"] .pw-t').allInnerTexts(), ['Film the tumbling class']);
    await add(page, 'Headlamp for Arrow', '.pw-tray input[data-add]');
    assert.deepEqual(await page.locator('.pw-tray .pw-t').allInnerTexts(), ['Order the 8 TB storage drive', 'Headlamp for Arrow']);
    await page.locator('.pw-task', { hasText: 'Headlamp for Arrow' }).click();
    await sleep(250);
    await pick(page, 'Today');
    await sleep(300);
    assert.ok((await page.locator('.pw-day.today .pw-t').allInnerTexts()).includes('Headlamp for Arrow'));
  });

  await check('Week: the week after and back; a click on a date opens that day with its plan', async () => {
    await page.locator('#plan-sheet [data-act="week-next"]').click();
    await sleep(500);
    assert.equal(await page.locator('#plan-sheet h1').innerText(), 'November 16 to 22');
    assert.equal(await page.locator('#plan-sheet .pl-eyebrow').innerText(), 'A WEEK AHEAD');
    await page.locator('#plan-sheet [data-act="week-now"]').click();
    await sleep(500);
    assert.equal(await page.locator('#plan-sheet h1').innerText(), 'November 9 to 15');
    await page.locator('.pw-day[data-day="2026-11-11"] .pw-h').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    await still(page);
    await sleep(400);
    assert.match(await page.locator('#nb-title').innerText(), /Wednesday, November 11/);
    assert.deepEqual(await words(page), ['Board Reel 2']);
    assert.equal(await row(page, 'Board Reel 2').evaluate((el) => el.classList.contains('next')), false, '“next” is only for today');
  });

  await check('free hours: a click on the hours changes what a week is weighed against', async () => {
    await zoomTo(page, 'Week');
    await sleep(400);
    await page.locator('#plan-sheet .pl-meter-v').click();
    await page.locator('.ask-input').fill('30');
    await page.locator('.ask .pill.primary').click();
    await sleep(400);
    assert.match(await page.locator('#plan-sheet .pl-meter-v').innerText(), /of 30 h$/);
    const s = (await all(page)).find((r) => r.id === 'settings-plan');
    assert.equal(s.fields.free, 30);
  });

  await check('Pace: what was ticked off, planned against real, and where the time went', async () => {
    await zoomTo(page, 'Pace');
    await still(page);
    await sleep(400);
    assert.equal(await page.locator('#plan-sheet h1').innerText(), 'Pace');
    const rows = page.locator('.pc-row:not(.pc-head)');
    assert.equal(await rows.count(), 1);
    assert.deepEqual(await rows.first().locator('.pc-n').allInnerTexts(), ['30 min', '30 min']);
    assert.match(await page.locator('.pl-read').innerText(), /You planned 30 min and it took 30 min\. Your guesses were close\./);
    assert.match(await page.locator('.pc-groups').first().innerText(), /No project/);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/plan-pace.png` });
  });

  await check('Go and Ctrl + K know Calendar’s week and pace; Back leads back', async () => {
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').fill('calendar week');
    await sleep(300);
    assert.match(await page.locator('#palette-list li').first().innerText(), /Calendar: week/);
    await page.keyboard.press('Enter');
    await sleep(500);
    assert.equal(await viewOf(page), 'plan');
    await lit(page, ZOOM, 'Week');
    await page.goBack();
    await sleep(500);
    await lit(page, ZOOM, 'Pace');
  });

  await check('the next morning, what’s still open waits at the top of today’s plan, marked with its day', async () => {
    await page.clock.setFixedTime(new Date('2026-11-10T08:30:00-08:00'));
    await today(page);
    await page.evaluate(() => document.querySelector('[data-cmd="today"]').click());
    await sleep(600);
    assert.match(await page.locator('#nb-title').innerText(), /Tuesday, November 10/);
    const list = await words(page);
    assert.deepEqual(list, ['Headlamp for Arrow', 'Email the storyboard notes to Dana']);
    assert.ok(await row(page, 'Headlamp for Arrow').evaluate((el) => el.classList.contains('carried')));
    assert.equal(await row(page, 'Headlamp for Arrow').locator('.pl-from').innerText(), 'from Mon, Nov 9');
    assert.equal(await row(page, 'Email the storyboard notes').locator('.pl-place').innerText(), 'Nov 9', 'a task written on another day says where');
    assert.ok(await row(page, 'Headlamp for Arrow').evaluate((el) => el.classList.contains('next')));
    // Yesterday's page still shows what was done that day.
    await page.locator('#nb-prev').click();
    await sleep(600);
    assert.deepEqual(await page.locator('#plan .pl-task.done .pl-words').allInnerTexts(), ['Call Dana about the storyboards']);
    await page.clock.setFixedTime(new Date(NOW));
    await today(page);
  });

  await check('“Not a task any more” leaves a plain line where it was', async () => {
    await page.locator('#outline-editor li', { hasText: 'Email the storyboard notes to Dana' }).locator('.task-chip').click();
    await sleep(250);
    await pick(page, 'Not a task any more');
    await sleep(500);
    const li = page.locator('#outline-editor li', { hasText: 'Email the storyboard notes to Dana' });
    assert.equal(await li.count(), 1);
    assert.equal(await li.locator('.task-chip').count(), 0);
    const r = (await all(page)).find((x) => x.text === 'Email the storyboard notes to Dana');
    assert.equal(r.fields.task, undefined);
    assert.equal(r.deleted, false);
  });

  await check('deleting a task’s line takes it off the plan', async () => {
    await page.locator('#outline-editor').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Water the ferns');
    await page.keyboard.press('Control+Shift+Enter');
    await sleep(600);
    assert.ok((await words(page)).includes('Water the ferns'));
    await page.keyboard.press('Control+Shift+Backspace');
    await sleep(900);
    assert.ok(!(await words(page)).includes('Water the ferns'));
  });

  await check('every part can be switched off under Look; Focus leaves only the words', async () => {
    await page.evaluate(() => { const c = document.querySelector('[data-show="plan"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.ok(await page.locator('#plan').isHidden());
    await page.evaluate(() => { const c = document.querySelector('[data-show="plan"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.ok(await page.locator('#plan').isVisible());
    await page.locator('#outline-editor').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Stretch');
    await page.keyboard.press('Control+Shift+Enter');
    await sleep(500);
    const chip = page.locator('#outline-editor li', { hasText: 'Stretch' }).locator('.task-chip');
    assert.ok(await chip.isVisible());
    await page.evaluate(() => { const c = document.querySelector('[data-show="taskchips"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.ok(await chip.isHidden());
    await page.evaluate(() => { const c = document.querySelector('[data-show="taskchips"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    // With the question off, ticking just ticks.
    await page.evaluate(() => { const c = document.querySelector('[data-show="took"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
    await row(page, 'Stretch').locator('.pl-check').click();
    await sleep(400);
    assert.equal(await page.locator('#plan .pl-took').count(), 0);
    await page.evaluate(() => { const c = document.querySelector('[data-show="took"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.keyboard.press('Control+.');
    await sleep(300);
    assert.ok(await page.locator('#plan').isHidden());
    assert.ok(await chip.isHidden());
    await page.keyboard.press('Control+.');
    await sleep(300);
    assert.ok(await page.locator('#plan').isVisible());
  });

  await check('a task inside a project says which, and opens there', async () => {
    await page.evaluate(() => document.querySelector('#library-toggle').click());
    await page.waitForFunction(() => document.documentElement.dataset.view === 'library');
    await sleep(300);
    await page.evaluate(() => document.querySelector('[data-cmd="new-book"], #lib-new-btn')?.click());
    await page.evaluate(() => { document.querySelector('#lib-new').hidden = false; });
    await page.locator('.lib-shape[data-shape="life"]').click();
    await page.fill('#lib-new-title', 'The Ninja Bunch');
    await page.locator('#lib-new .pill').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'world');
    await sleep(300);
    const world = (await all(page)).find((r) => r.kind === 'world' && r.title === 'The Ninja Bunch');
    // A page of the project, with one line.
    await page.evaluate(async (wid) => {
      const put = (rows) => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const tx = r.result.transaction('entries', 'readwrite'); for (const x of rows) tx.objectStore('entries').put(x); tx.oncomplete = res; }; });
      const now = Date.now();
      const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now, updated_at: now, sort: 1 };
      await put([
        { ...base, id: 'pg_nb_notes', kind: 'page', parent_id: wid, title: 'Reel 3 notes' },
        { ...base, id: 'li_nb_1', kind: 'line', parent_id: 'pg_nb_notes', text: 'Pick Kenji’s second verse', content: [{ type: 'text', text: 'Pick Kenji’s second verse' }], fields: { done: false, gather: null, gathered: null, mirror: null } }
      ]);
    }, world.id);
    await page.evaluate(() => { history.pushState({ view: 'notebook', pageId: 'pg_nb_notes' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'notebook', pageId: 'pg_nb_notes' } })); });
    await page.waitForFunction(() => document.querySelector('#nb-title')?.textContent === 'Reel 3 notes');
    await sleep(400);
    await page.locator('#outline-editor li p').first().click();
    await page.keyboard.press('Control+Shift+Enter');
    await sleep(600);
    assert.equal(await page.locator('#outline-editor .task-chip').innerText(), 'Today');
    await today(page);
    const r = row(page, 'Pick Kenji’s second verse');
    assert.equal(await r.locator('.pl-place').innerText(), 'The Ninja Bunch');
    await r.locator('.pl-place').click();
    await page.waitForFunction(() => document.querySelector('#nb-title')?.textContent === 'Reel 3 notes');
    await today(page);
  });

  await check('all five looks keep the plan readable; no page errors', async () => {
    for (const look of ['lamplight', 'ember', 'candle', 'night', 'graphite', 'typewriter', 'paper', 'midnight']) {
      await page.evaluate((l) => document.querySelector(`.look-opt[data-look="${l}"]`).click(), look);
      await sleep(150);
      const c = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('#plan .pl-words')); return [s.color, getComputedStyle(document.body).backgroundColor]; });
      assert.notEqual(c[0], c[1], look);
    }
    assert.deepEqual(page.errors, []);
  });
  await page.context().close();

  // ---------- a narrow window ----------
  const mid = await open({ width: 1000, height: 800 });
  await today(mid);
  await add(mid, 'Board Reel 2 1h');
  await check('1000 px: the week folds to four columns without spilling', async () => {
    await zoomTo(mid, 'Week');
    await still(mid);
    const w = await mid.evaluate(() => [document.documentElement.scrollWidth, innerWidth, getComputedStyle(document.querySelector('.pw-week')).gridTemplateColumns.split(' ').length]);
    assert.ok(w[0] <= w[1], `no sideways scroll (${w[0]} in ${w[1]})`);
    assert.equal(w[2], 4);
    assert.deepEqual(mid.errors, []);
  });
  await mid.context().close();

  // ---------- phone ----------
  const phone = await open({ width: 412, height: 915 }, { hasTouch: true, isMobile: true, todayPage: false });
  await today(phone);
  await phone.waitForFunction(() => { document.activeElement?.blur(); return !document.body.classList.contains('kb-up'); });
  await check('phone: the plan sits on top of today, with Page, Plan, Calendar above it', async () => {
    assert.ok(await phone.locator('#plan').isVisible());
    assert.deepEqual(await phone.locator('.tp-switch .pl-switch button').allInnerTexts(), ['Page', 'Plan', 'Calendar']);
    await add(phone, 'Call Dana 30m');
    await add(phone, 'Order the storage drive');
    assert.deepEqual(await words(phone), ['Call Dana', 'Order the storage drive']);
    assert.ok(await row(phone, 'Call Dana').locator('.pl-play').isVisible(), 'no hover on a phone, so the timer and ⋯ show');
    assert.ok(await row(phone, 'Call Dana').locator('.pl-more').isVisible());
    const w = await phone.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.ok(w[0] <= w[1], `no sideways scroll (${w[0]} in ${w[1]})`);
    if (SHOTS) await phone.screenshot({ path: `${SHOTS}/plan-phone-day.png` });
  });
  await check('phone: tick, answer how long, and move a task with the ⋯ menu', async () => {
    await row(phone, 'Call Dana').locator('.pl-check').tap();
    await sleep(400);
    await phone.locator('#plan .pl-took button', { hasText: 'as planned' }).tap();
    await sleep(400);
    assert.equal((await taskNamed(phone, 'Call Dana')).fields.task.actual, 30);
    await row(phone, 'Order the storage drive').locator('.pl-more').tap();
    await sleep(300);
    await pick(phone, 'Tomorrow');
    await sleep(400);
    assert.equal((await taskNamed(phone, 'Order the storage drive')).fields.task.day, '2026-11-10');
  });
  await check('phone: Week is a row a day on one screen, and nothing spills', async () => {
    await zoomTo(phone, 'Week', true);
    await still(phone);
    await sleep(300);
    assert.equal(await phone.locator('#plan-sheet .pl-switch [aria-current="page"]').innerText(), 'Calendar');
    assert.equal(await phone.locator('.pw-rows .pw-day').count(), 7);
    assert.equal(await phone.locator('.pw-day[data-day="2026-11-10"] .pw-rt').innerText(), 'Order the storage drive');
    const w = await phone.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.ok(w[0] <= w[1], `no sideways scroll (${w[0]} in ${w[1]})`);
    if (SHOTS) await phone.screenshot({ path: `${SHOTS}/plan-phone-week.png` });
    await zoomTo(phone, 'Pace', true);
    await sleep(500);
    assert.equal(await phone.locator('#plan-sheet h1').innerText(), 'Pace');
    await phone.locator('#plan-sheet .pl-switch button', { hasText: 'Plan' }).tap();
    await phone.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    assert.deepEqual(phone.errors, []);
  });
  await phone.context().close();
} finally {
  await browser.close();
  server.kill();
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nToday with tasks: all good');
