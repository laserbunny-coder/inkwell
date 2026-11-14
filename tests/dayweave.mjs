// The day plan as an order: your calendar's events sit among the tasks at
// their place in the day, and a task is dragged (or Alt + Up / Down) above or
// below one. Time estimates start off on a new device: no lengths on the rows,
// no hours in the head, only how many.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4278;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const NOW = '2026-11-09T14:04:00-08:00'; // a Monday, 2:04 pm
const at = (s) => `${s}:00-08:00`;
const EVENTS = [
  { id: 'c1:standup', title: 'Standup with Nate', start: at('2026-11-09T09:30'), end: at('2026-11-09T10:00'), allDay: false, calendar: 'Acro' },
  { id: 'c1:dentist', title: 'Dentist', start: at('2026-11-09T16:00'), end: at('2026-11-09T17:00'), allDay: false, calendar: 'Michael' },
  { id: 'c1:dana', title: 'Call with Dana', start: at('2026-11-09T18:00'), end: at('2026-11-09T18:30'), allDay: false, calendar: 'Michael' },
  { id: 'c2:bday', title: 'Arrow’s birthday', start: '2026-11-09', end: '2026-11-10', allDay: true, calendar: 'Family' },
];

const browser = withoutSync(await chromium.launch());
async function open(viewport, extra = {}) {
  // A fresh device: time estimates are as a new install has them (off).
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, estimates: false, ...extra });
  await ctx.addInitScript((events) => {
    window.__calendar = async () => {
      const gone = localStorage.getItem('cal-gone');
      return { connected: true, events: events.filter((e) => e.id !== gone) };
    };
  }, EVENTS);
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
const named = async (p, text) => (await all(p)).find((r) => r.text === text && r.fields?.task);
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const go = async (p, place) => {
  await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
  await p.waitForFunction((pl) => (document.documentElement.dataset.view || 'write') === pl.view && history.state?.view === pl.view, place);
  await still(p);
  await sleep(350);
};
const add = async (p, text) => { const input = p.locator('#plan input[data-add]').first(); await input.fill(text); await input.press('Enter'); await sleep(400); };
// The list as drawn: events as "@ title", tasks by their words.
const seq = (p) => p.evaluate(() => [...document.querySelectorAll('#plan .pl-list > .pl-task:not(.done), #plan .pl-list > .pl-wev')].map((el) => (el.classList.contains('pl-wev') ? `@ ${el.querySelector('.ev-w').textContent}` : el.querySelector('.pl-words').textContent)));
const seqIs = (p, want) => p.waitForFunction((w) => JSON.stringify([...document.querySelectorAll('#plan .pl-list > .pl-task:not(.done), #plan .pl-list > .pl-wev')].map((el) => (el.classList.contains('pl-wev') ? `@ ${el.querySelector('.ev-w').textContent}` : el.querySelector('.pl-words').textContent))) === JSON.stringify(w), want, { timeout: 8000 }).catch(async () => { assert.deepEqual(await seq(p), want); });
const row = (p, text) => p.locator('#plan .pl-task', { hasText: text });
const ev = (p, text) => p.locator('#plan .pl-wev', { hasText: text });
const shot = async (p, name) => { if (SHOTS) { await p.evaluate(() => document.querySelector('.toast')?.remove()); await still(p); await sleep(250); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const look = (p, name, on) => p.evaluate(([n, v]) => { const c = document.querySelector(`[data-show="${n}"]`); if (c.checked !== v) c.click(); }, [name, on]);

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 10).join('\n     ')}`); }
}

try {
  const page = await open({ width: 1440, height: 900 });
  await go(page, { view: 'notebook', pageId: 'day-2026-11-09' });
  await page.waitForSelector('#plan .pl-wev');

  await check('a new device: no time estimates, only how many; a length typed at the end is kept quietly', async () => {
    await add(page, 'Cut the trailer 2h');
    await add(page, 'Email Dana the boards');
    await add(page, 'Print the call sheet');
    assert.equal(await page.locator('#plan .pl-sum').innerText(), '3 to do');
    assert.equal(await page.locator('#plan .pl-left').count(), 0, 'no hours left today');
    assert.equal(await page.locator('#plan .pl-task .pl-est:visible').count(), 0, 'no lengths on the rows');
    assert.equal((await named(page, 'Cut the trailer')).fields.task.est, 120);
    await row(page, 'Cut the trailer').locator('.pl-more').click();
    await page.waitForSelector('.pop-menu .pop-item');
    assert.equal(await page.locator('.pop-menu .pop-item', { hasText: /How long it takes|Takes/ }).count(), 0, 'and the menu doesn’t ask');
    await page.mouse.click(5, 450);
    await page.waitForFunction(() => !document.querySelector('.pop-menu'));
  });

  await check('events sit among the tasks at their place; new tasks go after what has begun by now', async () => {
    assert.deepEqual(await page.locator('#plan .pl-cal .pl-ev').allInnerTexts().then((t) => t.map((x) => x.replace(/\s+/g, ' ').trim())), ['All day Arrow’s birthday']);
    await seqIs(page, ['@ Standup with Nate', 'Cut the trailer', 'Email Dana the boards', 'Print the call sheet', '@ Dentist', '@ Call with Dana']);
    assert.ok(await ev(page, 'Standup').evaluate((e) => e.classList.contains('past')), 'the morning’s standup is over: faint');
    assert.equal(await ev(page, 'Dentist').locator('.pl-check').count(), 0, 'nothing to tick on an event');
    assert.equal(await ev(page, 'Dentist').getAttribute('draggable'), null, 'and it can’t be moved');
    await shot(page, 'dayweave-list');
  });

  await check('drag a task below an event: it stays there, and after a reload too', async () => {
    const to = await ev(page, 'Dentist').boundingBox();
    await row(page, 'Print the call sheet').dragTo(ev(page, 'Call with Dana'), { targetPosition: { x: 200, y: 2 } });
    await seqIs(page, ['@ Standup with Nate', 'Cut the trailer', 'Email Dana the boards', '@ Dentist', 'Print the call sheet', '@ Call with Dana']);
    assert.ok(to);
    assert.deepEqual((await named(page, 'Print the call sheet')).fields.task.at, { day: '2026-11-09', after: 16 * 60 });
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await go(page, { view: 'notebook', pageId: 'day-2026-11-09' });
    await page.waitForSelector('#plan .pl-wev');
    await seqIs(page, ['@ Standup with Nate', 'Cut the trailer', 'Email Dana the boards', '@ Dentist', 'Print the call sheet', '@ Call with Dana']);
  });

  await check('drag a task to the very top: above the morning’s standup', async () => {
    await row(page, 'Email Dana').dragTo(ev(page, 'Standup'), { targetPosition: { x: 200, y: 2 } });
    await seqIs(page, ['Email Dana the boards', '@ Standup with Nate', 'Cut the trailer', '@ Dentist', 'Print the call sheet', '@ Call with Dana']);
    assert.equal((await named(page, 'Email Dana the boards')).fields.task.at.after, -1);
  });

  await check('Alt + Down and Alt + Up step a task past an event, one place at a time', async () => {
    await row(page, 'Cut the trailer').locator('.pl-words').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await seqIs(page, ['Email Dana the boards', '@ Standup with Nate', '@ Dentist', 'Cut the trailer', 'Print the call sheet', '@ Call with Dana']);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Cut the trailer');
    await page.waitForFunction(() => document.activeElement?.textContent === 'Cut the trailer');
    await page.keyboard.press('Alt+ArrowDown');
    await seqIs(page, ['Email Dana the boards', '@ Standup with Nate', '@ Dentist', 'Print the call sheet', 'Cut the trailer', '@ Call with Dana']);
    await page.waitForFunction(() => document.activeElement?.textContent === 'Cut the trailer');
    await page.keyboard.press('Alt+ArrowUp');
    await seqIs(page, ['Email Dana the boards', '@ Standup with Nate', '@ Dentist', 'Cut the trailer', 'Print the call sheet', '@ Call with Dana']);
    await page.waitForFunction(() => document.activeElement?.textContent === 'Cut the trailer');
    await page.keyboard.press('Alt+ArrowUp');
    await seqIs(page, ['Email Dana the boards', '@ Standup with Nate', 'Cut the trailer', '@ Dentist', 'Print the call sheet', '@ Call with Dana']);
    assert.equal((await named(page, 'Cut the trailer')).fields.task.at.after, 9 * 60 + 30);
  });

  await check('an event that goes away lets its tasks fall in after the one before', async () => {
    await page.evaluate(() => localStorage.setItem('cal-gone', 'c1:dentist'));
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await go(page, { view: 'notebook', pageId: 'day-2026-11-09' });
    await page.waitForSelector('#plan .pl-wev');
    await seqIs(page, ['Email Dana the boards', '@ Standup with Nate', 'Cut the trailer', 'Print the call sheet', '@ Call with Dana']);
    await page.evaluate(() => localStorage.removeItem('cal-gone'));
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await go(page, { view: 'notebook', pageId: 'day-2026-11-09' });
    await seqIs(page, ['Email Dana the boards', '@ Standup with Nate', 'Cut the trailer', '@ Dentist', 'Print the call sheet', '@ Call with Dana']);
  });

  await check('Look: events apart puts them back on top; time estimates bring the lengths and hours back', async () => {
    await look(page, 'woven', false);
    await page.waitForFunction(() => !document.querySelector('#plan .pl-wev'));
    assert.equal(await page.locator('#plan .pl-cal .pl-ev').count(), 4);
    assert.deepEqual(await page.locator('#plan .pl-task:not(.done) .pl-words').allInnerTexts(), ['Email Dana the boards', 'Cut the trailer', 'Print the call sheet'], 'the order holds');
    await look(page, 'woven', true);
    await page.waitForSelector('#plan .pl-wev');
    await look(page, 'estimates', true);
    await page.waitForFunction(() => /2 h to do/.test(document.querySelector('#plan .pl-sum')?.textContent || ''));
    assert.equal(await row(page, 'Cut the trailer').locator('.pl-est').innerText(), '2 h');
    assert.equal(await page.locator('#plan .pl-left').count(), 1);
    await look(page, 'estimates', false);
    await page.waitForFunction(() => document.querySelector('#plan .pl-sum')?.textContent === '3 to do');
  });

  await check('the whole plan still works the same with time estimates off: tick, and it sinks', async () => {
    await row(page, 'Email Dana').locator('.pl-check').click();
    await page.waitForFunction(() => document.querySelector('#plan .pl-task.done'));
    assert.equal(await page.locator('#plan .pl-sum').innerText(), '2 to do · 1 done');
    assert.deepEqual(page.errors, []);
  });

  const phone = await open({ width: 412, height: 915 }, { hasTouch: true, isMobile: true, todayPage: false });
  await check('phone: the events sit in the list there too, and nothing spills', async () => {
    await go(phone, { view: 'notebook', pageId: 'day-2026-11-09' });
    await add(phone, 'Charge the camera batteries');
    await phone.waitForSelector('#plan .pl-wev');
    assert.deepEqual(await seq(phone), ['@ Standup with Nate', 'Charge the camera batteries', '@ Dentist', '@ Call with Dana']);
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await shot(phone, 'dayweave-phone');
    assert.deepEqual(phone.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nthe woven day: all good');
process.exit(failed ? 1 : 0);
