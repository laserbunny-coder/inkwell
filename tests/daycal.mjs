// The day plan's Calendar: the day hour by hour, arranged by hand. A task is
// on it only where you put it; it snaps to 15 minutes; the list's order and
// the calendar never move each other.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4279;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const NOW = '2026-11-09T14:04:00-08:00'; // a Monday, 2:04 pm
const TODAY = '2026-11-09';
const at = (s) => `${s}:00-08:00`;
const EVENTS = [
  { id: 'c1:standup', title: 'Standup with Nate', start: at('2026-11-09T09:30'), end: at('2026-11-09T10:00'), allDay: false, calendar: 'Acro' },
  { id: 'c1:dentist', title: 'Dentist', start: at('2026-11-09T16:00'), end: at('2026-11-09T17:00'), allDay: false, calendar: 'Michael' },
];
const PX = 1; // pixels a minute

const browser = withoutSync(await chromium.launch());
async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', reducedMotion: 'reduce', timezoneId: 'America/Los_Angeles', viewport, estimates: false, ...extra });
  await ctx.addInitScript((events) => { window.__calendar = async () => ({ connected: true, events }); }, EVENTS);
  const page = await ctx.newPage();
  page.ctx = ctx;
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
const named = async (p, text) => (await all(p)).find((r) => r.text === text && r.fields?.task);
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const go = async (p, place) => {
  await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
  await p.waitForFunction((pl) => (document.documentElement.dataset.view || 'write') === pl.view && history.state?.view === pl.view, place);
  await still(p);
  await sleep(350);
};
const add = async (p, text, at = '#plan-sheet') => { const input = p.locator(`${at} input[data-add]`).first(); await input.fill(text); await input.press('Enter'); await sleep(400); };
const blk = (p, text) => p.locator('#plan-sheet .dc-blk', { hasText: text });
const chip = (p, text) => p.locator('#plan-sheet .dc-chip', { hasText: text });
const chips = (p) => p.locator('#plan-sheet .dc-chip').allInnerTexts();
const words = (p) => p.locator('#plan-sheet .pl-task:not(.done) .pl-words').allInnerTexts();
// Where on the screen a time of day is, on the grid.
const yOf = async (p, min) => p.evaluate(([m, px]) => { const g = document.querySelector('#plan-sheet .dc-grid'); return g.getBoundingClientRect().top + (m - Number(g.dataset.from)) * px; }, [min, PX]);
// Bring a time on the hours to the middle of the screen (on a slow machine it can sit below the fold).
const showTime = async (p, min) => { await p.evaluate(([m, px]) => { const g = document.querySelector('#plan-sheet .dc-grid'); const y = g.getBoundingClientRect().top + (m - Number(g.dataset.from)) * px; let s = g.parentElement; while (s && !(s.scrollHeight > s.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement; (s || document.scrollingElement).scrollBy(0, y - innerHeight / 2); }, [min, PX]); await sleep(200); };
const xOf = async (p) => p.evaluate(() => { const g = document.querySelector('#plan-sheet .dc-grid').getBoundingClientRect(); return g.left + g.width * 0.6; });
const drag = async (p, x, y0, y1) => {
  await p.mouse.move(x, y0);
  await p.mouse.down();
  for (let k = 1; k <= 8; k++) { await p.mouse.move(x, y0 + ((y1 - y0) * k) / 8); await sleep(16); }
  await p.mouse.up();
  await sleep(450);
};
// Near the top of a block: its bottom edge is for making it longer.
const centre = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 8), b }; };
const placedAt = async (p, text) => (await named(p, text))?.fields.task.on;
const shot = async (p, name) => { if (SHOTS) { await p.evaluate(() => document.querySelector('.toast')?.remove()); await still(p); await sleep(250); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 10).join('\n     ')}`); }
}

try {
  const page = await open({ width: 1440, height: 1000 });
  // Yesterday's task, put on yesterday's calendar at 10 am and not done.
  await page.evaluate(async () => {
    const now = Date.now();
    const row = { id: 'ln_old', kind: 'line', parent_id: 'page-tasks', sort: 1, title: '', text: 'Back up the drives', content: [{ type: 'text', text: 'Back up the drives' }], tags: [], links: [], type: null, area_id: null, deleted: false, created_at: now, updated_at: now, fields: { done: false, box: true, task: { v: 1, day: '2026-11-08', est: null, done_at: null, actual: null, log: [], run: null, order: 1, on: { day: '2026-11-08', at: 600 }, len: 60 } } };
    const page = { id: 'page-tasks', kind: 'page', parent_id: null, sort: 9000, title: 'Tasks', text: '', content: null, tags: [], links: [], type: null, area_id: null, deleted: false, created_at: now, updated_at: now, fields: {} };
    await new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const tx = r.result.transaction('entries', 'readwrite'); tx.objectStore('entries').put(page); tx.objectStore('entries').put(row); tx.oncomplete = res; }; });
  });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  await go(page, { view: 'plan', tab: 'day', day: TODAY });
  await add(page, 'Cut the trailer');
  await add(page, 'Email Dana the boards');
  await add(page, 'Print the call sheet');
  // The day's list folds what's left from earlier days into one line; the
  // calendar's waiting tasks hold it too, first.
  const order = ['Back up the drives', ...(await words(page))];

  await check('Calendar’s Day shows the day by the hour, with nothing placed yet', async () => {
    assert.equal(await page.locator('#plan-sheet .pl-view').count(), 0, 'no List | Calendar inside the plan any more');
    await go(page, { view: 'plan', tab: 'calday' });
    await page.waitForSelector('#plan-sheet .dc-grid');
    // What has no time yet waits behind one button.
    assert.equal(await page.locator('#plan-sheet .dc-unsched').innerText(), `Unscheduled · ${order.length}`);
    assert.equal(await page.locator('#plan-sheet .dc-sheet').isVisible(), false);
    await page.locator('#plan-sheet .dc-unsched').click();
    await page.waitForSelector('#plan-sheet .dc-sheet', { state: 'visible' });
    assert.deepEqual(await chips(page), order, 'every open task waits there, yesterday’s too');
    assert.equal(await page.locator('#plan-sheet .dc-blk').count(), 0, 'yesterday’s time doesn’t carry over');
    assert.deepEqual(await page.locator('#plan-sheet .dc-ev .dc-w').allInnerTexts(), ['Standup with Nate', 'Dentist']);
    assert.equal(await page.locator('#plan-sheet .dc-now').count(), 1);
    assert.equal(await page.locator('#plan-sheet .dc-hour span').first().innerText(), '7 am');
  });

  await check('a click on a waiting task puts it in the next free half hour', async () => {
    await chip(page, 'Cut the trailer').click();
    await page.waitForSelector('#plan-sheet .dc-blk');
    assert.deepEqual(await placedAt(page, 'Cut the trailer'), { day: TODAY, at: 14 * 60 + 30 });
    assert.equal((await named(page, 'Cut the trailer')).fields.task.len, 30);
    assert.match(await blk(page, 'Cut the trailer').locator('.dc-t').innerText(), /2:30 pm · 30 min/);
    await chip(page, 'Email Dana').click();
    await page.waitForFunction(() => document.querySelectorAll('#plan-sheet .dc-blk').length === 2);
    assert.equal((await placedAt(page, 'Email Dana the boards')).at, 15 * 60, 'the next free one, not on top of the first');
  });

  await check('drag a block to move it: it snaps to 15 minutes', async () => {
    const c = await centre(blk(page, 'Cut the trailer'));
    await drag(page, c.x, c.y, c.y + 105 * PX); // 1 h 45 min down
    assert.equal((await placedAt(page, 'Cut the trailer')).at, 16 * 60 + 15);
    assert.match(await blk(page, 'Cut the trailer').locator('.dc-t').innerText(), /4:15 pm · 30 min/);
    // Beside the Dentist, not on top of it.
    const [a, b] = [await blk(page, 'Cut the trailer').boundingBox(), await page.locator('#plan-sheet .dc-ev', { hasText: 'Dentist' }).boundingBox()];
    assert.ok(a.x >= b.x + b.width - 1 || b.x >= a.x + a.width - 1, 'overlaps sit side by side');
  });

  await check('drag the handle on its bottom edge to make it longer', async () => {
    // The handle shows when the pointer is over the block.
    const c = await centre(blk(page, 'Cut the trailer'));
    await page.mouse.move(c.x, c.y);
    const e = await page.evaluate(() => { const h = [...document.querySelectorAll('#plan-sheet .dc-handle')].find((x) => document.querySelector(`#plan-sheet .dc-blk[data-task="${x.dataset.task}"]`)?.textContent.includes('Cut the trailer')); const r = h.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    await page.mouse.move(e.x + e.width / 2, e.y + 3);
    await drag(page, e.x + e.width / 2, e.y + 3, e.y + 3 + 47 * PX);
    assert.equal((await named(page, 'Cut the trailer')).fields.task.len, 75);
    assert.match(await blk(page, 'Cut the trailer').locator('.dc-t').innerText(), /4:15 pm · 1 h 15 min/);
  });

  await check('drag a waiting task onto a time', async () => {
    const c = await centre(chip(page, 'Print the call sheet'));
    await drag(page, c.x, c.y, await yOf(page, 19 * 60 + 5));
    assert.deepEqual(await placedAt(page, 'Print the call sheet'), { day: TODAY, at: 19 * 60 });
    assert.deepEqual(await chips(page), ['Back up the drives']);
    assert.equal(await page.locator('#plan-sheet .dc-unsched').innerText(), 'Unscheduled · 1');
    // Esc puts the sheet away.
    await chip(page, 'Back up').focus();
    await page.keyboard.press('Escape');
    await page.waitForSelector('#plan-sheet .dc-sheet', { state: 'hidden' });
  });

  await check('with the keyboard: Alt + Down moves a block 15 minutes, Alt + Shift + Down makes it longer', async () => {
    await blk(page, 'Print the call sheet').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForFunction(() => /7:15 pm/.test(document.activeElement?.textContent || ''));
    await sleep(300); // the redraws after a save settle
    assert.deepEqual(await placedAt(page, 'Print the call sheet'), { day: TODAY, at: 19 * 60 + 15 });
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), await blk(page, 'Print the call sheet').textContent(), 'it keeps the focus');
    await page.keyboard.press('Alt+Shift+ArrowDown');
    await page.waitForFunction(() => /45 min/.test(document.activeElement?.textContent || ''));
    await sleep(300);
    assert.equal((await named(page, 'Print the call sheet')).fields.task.len, 45);
    await page.keyboard.press('Alt+Shift+ArrowUp');
    await page.waitForFunction(() => /7:15 pm · 30 min/.test(document.activeElement?.textContent || ''));
    await sleep(300);
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForFunction(() => /7 pm · 30 min/.test([...document.querySelectorAll('#plan-sheet .dc-blk')].find((b) => /Print the call/.test(b.textContent))?.textContent || ''));
    assert.deepEqual(await placedAt(page, 'Print the call sheet'), { day: TODAY, at: 19 * 60 });
  });

  await check('click an empty spot and write: a new task right there, and on the list at the end', async () => {
    await showTime(page, 11 * 60 + 10);
    await page.mouse.click(await xOf(page), await yOf(page, 11 * 60 + 10));
    const input = page.locator('#plan-sheet .dc-new input');
    await input.waitFor();
    assert.equal(await input.getAttribute('placeholder'), 'A task at 11 am');
    await input.fill('Call the print shop');
    await input.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('#plan-sheet .dc-blk')].some((b) => /Call the print shop/.test(b.textContent)));
    const t = (await named(page, 'Call the print shop')).fields.task;
    assert.deepEqual([t.day, t.on, t.len], [TODAY, { day: TODAY, at: 11 * 60 }, 30]);
    await shot(page, 'daycal');
  });

  await check('the calendar never reorders the list, and the list never moves a block', async () => {
    await go(page, { view: 'plan', tab: 'day', day: TODAY });
    await page.waitForSelector('#plan-sheet .pl-list');
    assert.deepEqual(await words(page), [...order.slice(1), 'Call the print shop']);
    assert.equal(await page.locator('#plan-sheet .pl-task .pl-est:visible').count(), 0, 'no times on the list');
    await page.locator('#plan-sheet .pl-task', { hasText: 'Print the call sheet' }).locator('.pl-words').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForFunction(() => document.querySelectorAll('#plan-sheet .pl-task .pl-words')[1]?.textContent === 'Print the call sheet' || document.querySelectorAll('#plan-sheet .pl-task .pl-words')[2]?.textContent === 'Print the call sheet');
    await sleep(300);
    assert.deepEqual(await placedAt(page, 'Print the call sheet'), { day: TODAY, at: 19 * 60 });
    await go(page, { view: 'plan', tab: 'calday' });
    await page.waitForSelector('#plan-sheet .dc-grid');
  });

  await check('drag a block up past the top to take it off the calendar', async () => {
    const c = await centre(blk(page, 'Email Dana'));
    const top = await page.locator('#plan-sheet .dc-grid').boundingBox();
    await drag(page, c.x, c.y, top.y - 60);
    assert.equal((await named(page, 'Email Dana the boards')).fields.task.on, null);
    assert.ok((await chips(page)).includes('Email Dana the boards'));
  });

  await check('a click on a block zooms into the task, and Alt + Left comes back to the calendar', async () => {
    await blk(page, 'Call the print shop').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook' && /Call the print shop/.test((window.__plan.items || []).find((i) => i.row.id === history.state?.zoom)?.row.text || ''), null, { timeout: 15000 });
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Alt+ArrowLeft');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'plan' && !!document.querySelector('#plan-sheet .dc-grid'));
    await sleep(1200); // the page it was zoomed into saves as it closes, and the hours redraw once
  });

  const px = () => page.evaluate(() => parseFloat(document.querySelector('#plan-sheet .dc-grid').style.getPropertyValue('--px')));
  // The − Fit day + buttons went (Nov 17 2026); Ctrl + scroll and a pinch still zoom.
  let zoomed = 0;
  await check('zoom: Ctrl + scroll zooms the hours, and blocks follow', async () => {
    assert.equal(await page.locator('#plan-sheet .dc-z-fit, #plan-sheet .dc-z-in').count(), 0, 'no zoom buttons');
    const before = await px();
    const gg = await page.locator('#plan-sheet .dc-grid').boundingBox();
    // Somewhere on the hours that's on the screen.
    await page.mouse.move(gg.x + gg.width * 0.6, Math.max(gg.y + 100, 300));
    // (Sent to the hours themselves: a real wheel here can land on the page behind.)
    await page.evaluate(([x, y]) => document.querySelector('#plan-sheet .dc-grid').dispatchEvent(new WheelEvent('wheel', { deltaY: -200, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true })), [gg.x + gg.width * 0.6, Math.max(gg.y + 100, 300)]);
    await sleep(400);
    zoomed = await px();
    assert.ok(zoomed > before * 1.3, 'Ctrl + scroll up zooms in');
    const b = await blk(page, 'Print the call sheet').boundingBox();
    assert.ok(Math.abs(b.height - (30 * zoomed - 2)) < 1.5, `a half hour is ${b.height}px`);
    // A drag still lands where it looks like it does, at any zoom.
    const was = (await placedAt(page, 'Print the call sheet')).at;
    // Zoomed in, the block can sit low on the screen: bring it up so an hour below it is still on screen.
    await blk(page, 'Print the call sheet').evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await sleep(300);
    const c = await centre(blk(page, 'Print the call sheet'));
    await drag(page, c.x, c.y, c.y + 60 * zoomed);
    assert.deepEqual(await placedAt(page, 'Print the call sheet'), { day: TODAY, at: was + 60 }, 'an hour later');
  });

  await check('the hours open on the zoom used last on this device', async () => {
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await go(page, { view: 'plan', tab: 'calday' });
    await page.waitForSelector('#plan-sheet .dc-grid');
    assert.ok(Math.abs((await px()) - zoomed) < 0.01);
    assert.deepEqual(page.errors, []);
  });

  // The phone: hold, then slide.
  const phone = await open({ width: 412, height: 915 }, { hasTouch: true, isMobile: true, todayPage: false });
  const cdp = await phone.ctx.newCDPSession(phone);
  await check('phone: the calendar fits, and a block moves after a hold', async () => {
    // A phone's day page hides its plan: add on Today's list, then its hours.
    await go(phone, { view: 'plan', tab: 'day' });
    await add(phone, 'Charge the batteries', '#plan-sheet');
    await go(phone, { view: 'plan', tab: 'calday' });
    await phone.waitForSelector('#plan-sheet .dc-grid');
    // On a phone what isn't on the calendar waits in a sheet from the bottom.
    assert.equal(await phone.locator('#plan-sheet .dc-unsched').innerText(), 'Unscheduled · 1');
    await phone.locator('#plan-sheet .dc-unsched').tap();
    await phone.waitForSelector('#plan-sheet .dc-sheet', { state: 'visible' });
    const sb = await phone.locator('#plan-sheet .dc-sheet').boundingBox();
    const barTop = await phone.evaluate(() => document.querySelector('.zm-ruler').getBoundingClientRect().top);
    assert.ok(Math.abs(sb.y + sb.height - barTop) < 2, `the sheet sits on the ruler (${sb.y + sb.height} / ${barTop})`);
    await shot(phone, 'daycal-phone-sheet');
    await phone.locator('#plan-sheet .dc-chip', { hasText: 'Charge' }).tap();
    await phone.waitForSelector('#plan-sheet .dc-blk');
    assert.equal((await placedAt(phone, 'Charge the batteries')).at, 14 * 60 + 30);
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'nothing spills');
    await phone.evaluate(() => document.querySelector('#plan-sheet .dc-blk').scrollIntoView({ block: 'center' }));
    await sleep(200);
    const c = await centre(phone.locator('#plan-sheet .dc-blk'));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
    await sleep(450);
    for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x, y: c.y + (60 * PX * k) / 8 }] }); await sleep(30); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await phone.waitForFunction(() => /3:30 pm/.test(document.querySelector('#plan-sheet .dc-blk .dc-t')?.textContent || ''));
    assert.equal((await placedAt(phone, 'Charge the batteries')).at, 15 * 60 + 30);
    await shot(phone, 'daycal-phone');
  });

  await check('phone: the handle makes a block longer straight away, no hold', async () => {
    const h = await phone.locator('#plan-sheet .dc-handle').boundingBox();
    const x = h.x + h.width / 2;
    const y = h.y + h.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (30 * PX * k) / 8 }] }); await sleep(20); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await phone.waitForFunction(() => /1 h/.test(document.querySelector('#plan-sheet .dc-blk .dc-t')?.textContent || ''));
    assert.equal((await named(phone, 'Charge the batteries')).fields.task.len, 60);
    assert.equal((await placedAt(phone, 'Charge the batteries')).at, 15 * 60 + 30, 'it didn’t move');
  });

  await check('phone: pinch the hours to zoom out, and in', async () => {
    await phone.waitForSelector('#plan-sheet .dc-grid');
    await sleep(400); // the redraws after the last save settle
    const pxp = () => phone.evaluate(() => parseFloat(document.querySelector('#plan-sheet .dc-grid').style.getPropertyValue('--px')));
    const before = await pxp();
    const g = await phone.locator('#plan-sheet .dc-grid').boundingBox();
    const x = g.x + g.width * 0.7;
    const mid = Math.min(g.y + g.height / 2, 500);
    const pinch = async (from, to) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: mid - from, id: 1 }, { x: x + 10, y: mid + from, id: 2 }] });
      for (let k = 1; k <= 8; k++) { const r = from + ((to - from) * k) / 8; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: mid - r, id: 1 }, { x: x + 10, y: mid + r, id: 2 }] }); await sleep(20); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(300);
    };
    await pinch(150, 60);
    const out = await pxp();
    assert.ok(out < before * 0.6, `fingers together: more of the day (${before} → ${out})`);
    await pinch(60, 120);
    assert.ok((await pxp()) > out * 1.5, 'fingers apart: zoom in');
    assert.equal(await phone.evaluate(() => visualViewport.scale), 1, 'the page itself didn’t zoom');
    assert.equal(await phone.evaluate(() => localStorage.getItem('calHours')), String(await pxp()));
    assert.equal((await placedAt(phone, 'Charge the batteries')).at, 15 * 60 + 30, 'a pinch moves nothing');
    assert.deepEqual(phone.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nthe day calendar: all good');
process.exit(failed ? 1 : 0);
