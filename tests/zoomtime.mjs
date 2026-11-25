// The zoom, Part 3 (Nov 2026): Today, Week, Month and Year, and moving a line
// across time. Today's afternoon and evening dividers (places in the order,
// a Look switch away); "N left from earlier days"; a day goes into its own
// page and out to its week; Month is four weeks with days as dots; the Year
// lists its months' lines. A line is picked (Up / Down, right-click, a hold
// on a phone) and moved out, in or to the neighbour (Ctrl + arrows or the
// small bar), dragged onto a day, a week or a ruler stop, and every move says
// so with Undo. Not planned is a shelf on the top line.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4236;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const browser = withoutSync(await chromium.launch());
const errors = [];
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); if (process.env.STACK) console.log(e.stack); }
}
const place = (p) => p.evaluate(() => history.state);
const at = async (p, stop) => {
  await p.waitForFunction((s) => !document.documentElement.dataset.zt && document.querySelector('.zm-stop[aria-current]')?.dataset.stop === s, stop, { timeout: 8000 });
  await sleep(300);
};
const blur = (p) => p.evaluate(() => document.activeElement?.blur());
const task = (p, re) => p.evaluate((src) => { const i = window.__plan.items.find((x) => new RegExp(src).test(x.row.text)); return i ? { id: i.row.id, day: i.task.day || null, span: i.task.span || null, done: !!i.row.fields?.done } : null; }, re);
const SHOTS = process.env.SHOTS;
const today = (p) => p.evaluate(() => window.__plan.today);
const toast = (p) => p.evaluate(() => document.querySelector('.toast')?.textContent || '');
const open = async (ctx) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(URL);
  await p.waitForFunction(() => document.documentElement.dataset.started === '1');
  await sleep(600);
  return p;
};
async function add(p, text, dayWord = false) {
  await p.keyboard.press('Control+K');
  await sleep(200);
  await p.keyboard.type(text);
  await sleep(350);
  await p.keyboard.press(dayWord ? 'Control+Enter' : 'Enter');
  await sleep(500);
}
async function run(p, label) {
  await p.keyboard.press('Control+K');
  await p.waitForFunction(() => document.activeElement?.id === 'palette-input');
  await p.locator('#palette-input').fill(label);
  const item = p.locator('#palette-list li', { hasText: label }).first();
  await item.waitFor();
  await item.click();
  await sleep(400);
}
const listText = (p) => p.evaluate(() => [...document.querySelectorAll('#plan-sheet .pl-list [data-task]')].filter((el) => !el.parentElement.closest('[data-task]')).map((el) => (el.dataset.part ? `[${el.dataset.part}]` : el.querySelector('.pl-words')?.textContent || el.textContent).trim()));

try {
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
  const p = await open(ctx);
  await p.keyboard.press('Control+Shift+O');
  await p.waitForFunction(() => document.documentElement.dataset.view === 'library');
  for (const t of ['Pay the rent', 'Board scene 3', 'Call the grader']) await add(p, t);
  await add(p, 'Sand the ladder tomorrow', true);
  await add(p, 'Color pass on the trailer next week', true);
  await blur(p);

  await check('Today has two quiet dividers, Afternoon and Evening, as places in the order', async () => {
    await p.keyboard.press('4');
    await at(p, 'today');
    await p.waitForSelector('#plan-sheet .pl-part');
    assert.deepEqual(await p.locator('#plan-sheet .pl-part').allTextContents(), ['Afternoon', 'Evening']);
    assert.equal(await p.locator('#plan-sheet .pl-part[data-part="aft"]').getAttribute('draggable'), 'true');
    // Dragged above "Board scene 3": the afternoon starts there.
    await p.locator('#plan-sheet .pl-part[data-part="aft"]').dragTo(p.locator('#plan-sheet .pl-task', { hasText: 'Board scene 3' }).first(), { targetPosition: { x: 20, y: 2 } });
    await sleep(900);
    const parts = await p.evaluate(() => window.__plan.parts?.[window.__plan.today]);
    assert.ok(parts && typeof parts.aft === 'number', 'the divider’s place is kept');
    const rows = await listText(p);
    const a = rows.indexOf('[aft]');
    assert.ok(a >= 0 && rows.slice(a + 1).some((r) => /Board scene 3/.test(r)), `Board scene 3 is after the Afternoon divider: ${rows.join(' | ')}`);
    assert.ok(rows.slice(0, a).some((r) => /Pay the rent/.test(r)), 'Pay the rent stays in the morning');
  });

  await check('the dividers are always there: no switch for them any more', async () => {
    const list = await p.evaluate(() => window.__commandList().map((c) => c.label));
    assert.ok(!list.includes('Show or hide the afternoon and evening dividers'));
    await p.waitForSelector('#plan-sheet .pl-part');
  });

  await check('a line from an earlier day: one quiet line, "1 left from earlier days"', async () => {
    const { id } = await task(p, 'Call the grader');
    await p.evaluate(async (id) => { const t = window.__plan.today; const d = new Date(`${t}T12:00:00`); d.setDate(d.getDate() - 2); const iso = d.toLocaleDateString('en-CA'); await window.__plan.applyWhen([id], { day: iso }, 'then'); }, id);
    await sleep(600);
    await p.waitForSelector('#plan-sheet .pl-early.quiet');
    assert.match(await p.locator('#plan-sheet .pl-early.quiet .pl-early-n').innerText(), /^1 left from earlier days$/);
  });

  await check('Up / Down picks a line and shows its bar; Ctrl + Up moves it out, with Undo', async () => {
    await blur(p);
    await p.keyboard.press('ArrowDown');
    await p.waitForSelector('.zm-picked');
    await p.waitForSelector('.zm-movebar:not([hidden])');
    const picked = await p.evaluate(() => document.querySelector('.zm-picked').dataset.task);
    const rent = await task(p, 'Pay the rent');
    // Pick Pay the rent itself.
    for (let k = 0; k < 6 && (await p.evaluate(() => document.querySelector('.zm-picked')?.dataset.task)) !== rent.id; k += 1) await p.keyboard.press('ArrowDown');
    assert.equal(await p.evaluate(() => document.querySelector('.zm-picked')?.dataset.task), rent.id, `picked ${picked}`);
    assert.match(await p.locator('.zm-mb[data-mb="out"]').innerText(), /This week|Any day this week/);
    await p.keyboard.press('Control+ArrowUp');
    await p.waitForFunction(() => /week/i.test(document.querySelector('.toast')?.textContent || ''));
    let r = await task(p, 'Pay the rent');
    assert.equal(r.day, null);
    assert.equal(r.span?.kind, 'week');
    assert.match(await toast(p), /Undo/);
    // Out of sight but still picked: the bar names it, and Ctrl + Up takes it further.
    assert.equal(await p.locator('.zm-mb-name').isVisible(), true);
    await p.keyboard.press('Control+ArrowUp');
    await p.waitForFunction(() => /month/i.test(document.querySelector('.toast')?.textContent || ''));
    r = await task(p, 'Pay the rent');
    assert.equal(r.span?.kind, 'month');
    // Undo puts it back to the week.
    await p.locator('.toast button', { hasText: 'Undo' }).click();
    await p.waitForFunction(() => window.__plan.items.find((x) => /Pay the rent/.test(x.row.text))?.task.span?.kind === 'week');
    // Ctrl + Down: back into today.
    await p.keyboard.press('Control+ArrowDown');
    await sleep(800);
    r = await task(p, 'Pay the rent');
    assert.equal(r.day, await today(p), 'Ctrl + Down from this week is today');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('.zm-picked'));
    assert.equal(await p.locator('.zm-movebar').isVisible(), false);
  });

  await check('Ctrl + Right moves a picked line to the next day; Space ticks it', async () => {
    await p.locator('#plan-sheet .pl-task', { hasText: 'Board scene 3' }).first().click({ button: 'right' });
    await p.waitForSelector('.zm-picked');
    await p.keyboard.press('Control+ArrowRight');
    await sleep(800);
    const r = await task(p, 'Board scene 3');
    const t = await today(p);
    assert.ok(r.day > t, `next day: ${r.day}`);
    await p.keyboard.press('Control+ArrowLeft');
    await sleep(800);
    assert.equal((await task(p, 'Board scene 3')).day, t);
    await p.locator('#plan-sheet .pl-task', { hasText: 'Board scene 3' }).first().click({ button: 'right' });
    await p.keyboard.press(' ');
    await sleep(700);
    assert.equal((await task(p, 'Board scene 3')).done, true);
    await p.keyboard.press(' ');
    await sleep(700);
    assert.equal((await task(p, 'Board scene 3')).done, false);
    await p.keyboard.press('Escape');
  });

  await check('a day goes into its own page and back out to its week', async () => {
    await p.keyboard.press('3');
    await at(p, 'week');
    const day = await p.evaluate(() => { const t = window.__plan.today; const d = new Date(`${t}T12:00:00`); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA'); });
    await p.evaluate((d) => window.__plan.intoDay(d), day);
    await at(p, 'today');
    assert.equal((await place(p)).day, day);
    assert.match(await p.locator('.pl-top h1').first().innerText(), /Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/);
    assert.ok((await p.locator('#plan-sheet .pl-task', { hasText: 'Sand the ladder' }).count()) >= 1, 'tomorrow’s line is there');
    await p.keyboard.press('-');
    await at(p, 'week');
  });

  await check('dragging a line onto the ruler’s Today stop puts it on today', async () => {
    await p.locator('#plan-sheet [data-task]', { hasText: 'Sand the ladder' }).first().dragTo(p.locator('.zm-stop[data-stop="today"]'));
    await sleep(1000);
    assert.equal((await task(p, 'Sand the ladder')).day, await today(p));
    assert.match(await toast(p), /Today/);
  });

  await check('Month is four weeks, with days as dots, and a line dropped on a week goes there', async () => {
    await p.keyboard.press('2');
    await at(p, 'month');
    await p.waitForSelector('.mo-weeks');
    assert.equal(await p.locator('.mo-week').count(), 4);
    assert.match(await p.locator('.pl-top h1').first().innerText(), /Four weeks/);
    assert.ok((await p.locator('.mo-week.now .mo-dots i').count()) >= 1, 'this week shows its lines as dots');
    assert.ok((await p.locator('.mo-line', { hasText: 'Color pass on the trailer' }).count()) >= 1, 'next week’s line is under next week');
    // The trailer line onto the third week.
    const third = await p.locator('.mo-week').nth(2).getAttribute('data-drop');
    await p.locator('.mo-line', { hasText: 'Color pass on the trailer' }).first().dragTo(p.locator('.mo-week').nth(2).locator('.mo-wh'));
    await sleep(900);
    assert.equal((await task(p, 'Color pass')).span?.start, third.slice(5));
  });

  await check('Not planned is a shelf on the top line: + puts a line into the view', async () => {
    const { id } = await task(p, 'Color pass');
    await p.evaluate(async (id) => { await window.__plan.applyWhen([id], null, ''); }, id);
    await sleep(600);
    assert.match(await p.locator('.zm-np').innerText(), /Not planned · 1/);
    await p.locator('.zm-np').click();
    await p.waitForSelector('.zm-shelf:not([hidden]) .zm-shelf-row');
    assert.match(await p.locator('.zm-shelf-row').first().innerText(), /Color pass/);
    await p.locator('.zm-shelf-row .zm-shelf-plus').first().click();
    await sleep(800);
    const r = await task(p, 'Color pass');
    assert.equal(r.span?.kind, 'month', 'on the Month, + is sometime this month');
    assert.match(await p.locator('.zm-np').innerText(), /Not planned · 0/);
  });

  await check('a line dragged onto the shelf comes off its time', async () => {
    await p.locator('.mo-line', { hasText: 'Color pass' }).first().dragTo(p.locator('.zm-shelf'));
    await sleep(900);
    const r = await task(p, 'Color pass');
    assert.equal(r.day, null);
    assert.equal(r.span, null);
    await p.locator('.zm-shelf-x').click();
  });

  await check('the Year lists each month’s lines and takes a dropped line', async () => {
    const { id } = await task(p, 'Color pass');
    await p.evaluate(async (id) => { const t = window.__plan.today; await window.__plan.applyWhen([id], { span: { kind: 'month', start: `${t.slice(0, 7)}-01` } }, 'month'); }, id);
    await p.locator('.ah-year').click();
    await p.waitForSelector('.yr-month');
    assert.ok((await p.locator('.yr-month .yr-line', { hasText: 'Color pass' }).count()) >= 1, 'the month’s line is in its month');
    await p.locator('.yr-month .yr-line', { hasText: 'Color pass' }).first().dragTo(p.locator('.yr-later'));
    await sleep(900);
    assert.equal((await task(p, 'Color pass')).span?.kind, 'later', 'Sometime this year');
  });

  await check('the Year: lines on a day show with their date and drag to another month; Not planned sits beside it', async () => {
    const { id } = await task(p, 'Color pass');
    const t0 = await today(p);
    const day = `${t0.slice(0, 7)}-28`;
    await p.evaluate(async ([id, day]) => { await window.__plan.applyWhen([id], { day }, 'day'); }, [id, day]);
    await p.waitForFunction(() => /Color pass/.test(document.querySelector('.yr-month.yr-now')?.textContent || ''));
    const line = p.locator('.yr-month.yr-now .yr-line', { hasText: 'Color pass' });
    assert.match(await line.innerText(), /\d/, 'its date beside it');
    // Onto its own month: it keeps its day.
    await line.dragTo(p.locator('.yr-month.yr-now .yr-name'));
    await sleep(700);
    assert.equal((await task(p, 'Color pass')).day, day);
    // Onto the next month: sometime then.
    await line.dragTo(p.locator('.yr-month').nth(1));
    await sleep(900);
    assert.equal((await task(p, 'Color pass')).span?.kind, 'month');
    assert.equal(await p.locator('.yr-month').nth(1).locator('.yr-line', { hasText: 'Color pass' }).count(), 1);
    // Not planned beside the year: onto it, and from it back onto a month.
    assert.ok(await p.locator('.yr-wrap .pw-np').isVisible());
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/year.png` });
    await p.locator('.yr-month').nth(1).locator('.yr-line', { hasText: 'Color pass' }).dragTo(p.locator('.yr-wrap .pw-np'));
    await sleep(900);
    assert.equal((await task(p, 'Color pass')).span, null);
    await p.locator('.pw-np .pw-task', { hasText: 'Color pass' }).dragTo(p.locator('.yr-month').nth(2));
    await sleep(900);
    assert.equal((await task(p, 'Color pass')).span?.kind, 'month');
  });

  await p.close();
  await ctx.close();

  // The phone: a hold picks a line, and its bar moves it; nothing scrolls sideways.
  const pctx = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' });
  const ph = await open(pctx);
  await add(ph, 'Pay the rent');
  await add(ph, 'Board scene 3');
  await blur(ph);
  const cdp = await pctx.newCDPSession(ph);
  const hold = async (loc, ms = 600) => {
    const b = await loc.boundingBox();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(400);
  };

  await check('phone: a hold picks a line; the bar moves it out and back in', async () => {
    await ph.locator('.zm-stop[data-stop="today"]').tap();
    await at(ph, 'today');
    await ph.waitForSelector('#plan-sheet .pl-task');
    await hold(ph.locator('#plan-sheet .pl-task', { hasText: 'Pay the rent' }).first().locator('.pl-words').first());
    await ph.waitForSelector('.zm-movebar:not([hidden])');
    assert.ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
    const bar = await ph.locator('.zm-movebar').boundingBox();
    assert.ok(bar.x >= 0 && bar.x + bar.width <= 413, 'the bar fits the screen');
    await ph.locator('.zm-mb[data-mb="out"]').tap();
    await sleep(800);
    assert.equal((await task(ph, 'Pay the rent')).span?.kind, 'week');
    await ph.locator('.zm-mb[data-mb="in"]').tap();
    await sleep(800);
    assert.equal((await task(ph, 'Pay the rent')).day, await today(ph));
    await ph.locator('.zm-mb[data-mb="let"]').tap();
    assert.equal(await ph.locator('.zm-movebar').isVisible(), false);
  });

  await check('phone: Not planned sits on the top line', async () => {
    assert.equal(await ph.locator('.zm-np').isVisible(), true);
    await ph.locator('.zm-np').tap();
    await ph.waitForSelector('.zm-shelf:not([hidden])');
    assert.ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await ph.locator('.zm-shelf-x').tap();
  });

  await check('phone: the Month fits the screen', async () => {
    await ph.locator('.zm-stop[data-stop="month"]').tap();
    await at(ph, 'month');
    await ph.waitForSelector('.mo-weeks');
    assert.ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  });

  await check('phone: on the Year a held line slides onto another month', async () => {
    const { id } = await task(ph, 'Board scene 3');
    await ph.evaluate(async (id) => { const t = window.__plan.today; await window.__plan.applyWhen([id], { span: { kind: 'month', start: `${t.slice(0, 7)}-01` } }, 'month'); }, id);
    // The Year has its own stop again (Today and Now as one, Nov 25 2026).
    await ph.locator('.zm-stop[data-stop="year"]').tap();
    await ph.waitForFunction(() => document.querySelector('#plan-sheet')?.dataset.tab === 'year' && document.querySelector('.yr-month .yr-line'));
    await sleep(600);
    assert.ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
    if (SHOTS) { await sleep(1500); await ph.screenshot({ path: `${SHOTS}/year-phone.png` }); }
    const from = ph.locator('.yr-month.yr-now .yr-line', { hasText: 'Board scene 3' });
    const a = await from.boundingBox();
    const b = await ph.locator('.yr-month').nth(1).boundingBox();
    const [x0, y0] = [a.x + a.width / 2, a.y + a.height / 2];
    const [x1, y1] = [b.x + b.width / 2, b.y + 14];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    await sleep(550);
    for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * k) / 8, y: y0 + ((y1 - y0) * k) / 8 }] }); await sleep(30); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(900);
    const r = await task(ph, 'Board scene 3');
    assert.equal(r.span?.kind, 'month');
    assert.equal(await ph.locator('.yr-month').nth(1).locator('.yr-line', { hasText: 'Board scene 3' }).count(), 1);
  });

  await check('no page errors', async () => { assert.deepEqual(errors, []); });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
