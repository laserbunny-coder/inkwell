// The Desk: every project on one page with what needs you and who's working
// on it, and History, every Claude thread there has been. The calls and the
// updates live in Daybook's tables; here a stand-in (window.__desk) plays
// Daybook, and window.__claude plays the server.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4263;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;

const T = (s) => new Date(`${s}-08:00`).toISOString();
const NOW = '2026-11-09T14:04:00';
const HQ = 'https://claude.ai/code/project/chan_hq';
const INK = 'https://claude.ai/code/project/chan_ink';
const NB = 'https://claude.ai/code/project/chan_nb';

// What Daybook holds. done/later change it the way the real tables would.
const db = {
  needs: [
    { id: 'n1', kind: 'decision', title: 'Pick Kenji’s final character sheet', project: 'The Ninja Bunch', link: `${NB}?thread=sheet`, project_link: NB, created_at: T('2026-11-08T10:09:00'), body: 'Guide: https://claude.ai/artifact/kenjiSheets' },
    { id: 'n2', kind: 'review', title: 'Try the AI production tools on Reel 4', project: 'The Ninja Bunch', link: `${NB}?thread=tools`, project_link: NB, created_at: T('2026-11-03T22:53:00'), body: '' },
    { id: 'n3', kind: 'blocked', title: 'Approve three reels on the HQ board', project: 'Acro and Cheer HQ', link: `${HQ}?thread=reels`, project_link: HQ, created_at: T('2026-11-09T11:15:00'), body: '' },
    { id: 'n4', kind: 'review', title: 'Try opening two things side by side', project: 'Inkwell', link: `${INK}?thread=panes`, project_link: INK, created_at: T('2026-11-05T03:43:00'), body: '' },
    // Answered long ago: only History knows it.
    { id: 'n0', kind: 'decision', title: 'Choose the speech-to-text service', project: 'Inkwell', link: `${INK}?thread=stt`, project_link: INK, created_at: T('2026-11-01T09:00:00'), resolved_at: T('2026-11-01T12:00:00'), body: '' },
  ],
  updates: [
    { id: 'u0', project: 'Inkwell', project_link: INK, link: `${INK}?thread=old`, thread: 'Rethink the screenplay', text: 'Woven scripts are live', place: null, state: 'live', created_at: T('2026-10-20T16:00:00') },
    { id: 'u1', project: 'Inkwell', project_link: INK, link: `${INK}?thread=stuck`, thread: 'Tidy the old imports', text: 'Started sorting the old imports', place: null, state: 'working', created_at: T('2026-11-02T16:00:00') },
    { id: 'u2', project: 'The Ninja Bunch', project_link: NB, link: `${NB}?thread=stills`, thread: 'Overnight stills', text: 'Reel 4: six stills generated overnight, named by shot code', place: null, state: 'done', created_at: T('2026-11-09T06:40:00') },
    { id: 'u3', project: 'Acro and Cheer HQ', project_link: HQ, link: `${HQ}?thread=reels`, thread: 'Make this week’s Acro reels', text: 'Three reels drafted and waiting on the HQ board', place: 'https://acro-hq.laserbunny.workers.dev', state: 'done', created_at: T('2026-11-09T08:05:00') },
    { id: 'u4', project: 'The Ninja Bunch', project_link: NB, link: `${NB}?thread=sheet`, thread: 'Draft Reel 3 prompts', text: 'Reel 3 prompts are half drafted', place: `${URL}?open=day-2026-11-09`, state: 'working', created_at: T('2026-11-09T13:52:00') },
    { id: 'u5', project: 'Inkwell', project_link: INK, link: `${INK}?thread=redesign`, thread: 'Redesign Inkwell from the ground up', text: 'The new frame is live: rail, switch, five looks', place: null, state: 'live', created_at: T('2026-11-09T09:30:00') },
  ],
};
// The switch and the path are lit at the very end of a move, after the page
// itself is drawn: wait for them rather than read them at once.
const lit = (p, sel, text) => p.waitForFunction(([s, t]) => document.querySelector(s)?.innerText.trim() === t, [sel, text]);
const goto = async (p, place) => {
  await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
  await p.waitForFunction((pl) => document.documentElement.dataset.view === pl.view, place);
  await p.waitForSelector(place.tab === 'history' ? '.dk-thread, .dk-none, .dk-empty' : '.desk-home .zd-head, .desk-home .dk-head');
  await sleep(400);
  // On stage, the calls, the crew and the catch-up sit folded under one line.
  if (place.view === 'desk' && place.tab !== 'history' && await p.locator('.zd-crewline').count() && !(await p.locator('.zd-crew-in').count())) {
    await p.locator('.zd-crewline').click();
    await p.waitForSelector('.zd-crew-in');
  }
};
const calls = [];
const asked = [];

const browser = withoutSync(await chromium.launch());
async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', reducedMotion: 'reduce', timezoneId: 'America/Los_Angeles', viewport, ...extra });
  await ctx.exposeFunction('__db', (op, a, b) => {
    calls.push([op, a, b]);
    if (op === 'desk') return { needs: db.needs.filter((n) => !n.resolved_at).map((n) => ({ ...n })), updates: db.updates.filter((u) => u.created_at >= a).map((u) => ({ ...u })) };
    if (op === 'all') return { needs: db.needs.map((n) => ({ ...n })), updates: db.updates.map((u) => ({ ...u })) };
    const n = db.needs.find((x) => x.id === a);
    if (op === 'done') n.resolved_at = T(NOW);
    if (op === 'later') n.snoozed_until = b;
    return null;
  });
  await ctx.exposeFunction('__toClaude', (body) => {
    if (body.mode !== 'catchup') return {};
    asked.push(body);
    return { line: 'Reel 4’s stills came in overnight. Kenji’s character sheet is the one real decision; the rest can wait for a quiet ten minutes.' };
  });
  await ctx.addInitScript(() => {
    window.__claude = (body) => window.__toClaude(body);
    window.__desk = {
      desk: (since) => window.__db('desk', since),
      deskAll: () => window.__db('all'),
      doneNeed: (id) => window.__db('done', id),
      laterNeed: (id, until) => window.__db('later', id, until),
    };
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.setFixedTime(new Date(`${NOW}-08:00`));
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return page;
}
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const viewOf = (p) => p.evaluate(() => document.documentElement.dataset.view || 'write');
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const pick = async (p, label) => { await p.locator('.pop-menu .pop-item', { hasText: label }).first().click(); await sleep(250); };
// A project of your own, made the way a person makes one.
async function newProject(p, title) {
  await p.evaluate(() => document.querySelector('#library-toggle').click());
  await p.waitForFunction(() => document.documentElement.dataset.view === 'library');
  await sleep(300);
  await p.evaluate(() => document.querySelector('[data-cmd="new-book"], #lib-new-btn')?.click());
  await p.evaluate(() => { document.querySelector('#lib-new').hidden = false; });
  await p.locator('.lib-shape[data-shape="life"]').click();
  await p.fill('#lib-new-title', title);
  await p.locator('#lib-new .pill').click();
  await p.waitForFunction(() => document.documentElement.dataset.view === 'world');
  await sleep(300);
}

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

try {
  const page = await open({ width: 1440, height: 900 });
  await page.evaluate(() => localStorage.setItem('deskSeen', String(Date.parse('2026-11-09T07:00:00-08:00'))));
  await newProject(page, 'The Ninja Bunch');
  await newProject(page, 'Harbor spot');
  await goto(page, { view: 'desk' });






  await check('catch-up underneath: today’s lines newest first, each opening its thread, a dot on the new', async () => {
    const rows = await page.locator('.dk-catchup .dk-ev').allInnerTexts();
    assert.equal(rows.length, 4);
    assert.match(rows[0], /1:52 pm\s+The Ninja Bunch\s+Reel 3 prompts are half drafted\s+Inkwell\s+WORKING/i);
    assert.match(rows[3], /6:40 am/);
    assert.equal(await page.locator('.dk-catchup .dk-ev', { hasText: 'Three reels' }).locator('.dk-evt > a').first().getAttribute('href'), `${HQ}?thread=reels`);
    assert.equal(await page.locator('.dk-catchup .dk-ev', { hasText: 'Three reels' }).locator('a.dk-place').innerText(), 'acro-hq.laserbunny.workers.dev');
    assert.equal(await page.locator('.dk-catchup .dk-ev', { hasText: 'Three reels' }).locator('.dk-new').count(), 1);
    assert.equal(await page.locator('.dk-catchup .dk-ev', { hasText: 'six stills' }).locator('.dk-new').count(), 0);
    await page.locator('.dk-span').selectOption('week');
    await page.waitForFunction(() => document.querySelectorAll('.dk-catchup .dk-ev').length === 4);
    assert.doesNotMatch(await page.locator('.dk-catchup').innerText(), /Started sorting/);
    await page.locator('.dk-span').selectOption('today');
    if (SHOTS) { await still(page); await page.screenshot({ path: `${SHOTS}/desk.png` }); await page.screenshot({ path: `${SHOTS}/desk-full.png`, fullPage: true }); }
  });






  await check('an Inkwell place in the catch-up opens right here', async () => {
    await page.locator('.dk-catchup .dk-ev', { hasText: 'Reel 3 prompts' }).locator('a.dk-place').click();
    // The day counts as visited once it's in the browser's own history.
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook' && history.state?.view === 'notebook');
    await page.goBack();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'desk');
    await page.waitForSelector('.desk-home .dk-catchup');
  });

  await check('History: every thread, newest activity first, answered and finished ones too', async () => {
    await goto(page, { view: 'desk', tab: 'history' });
    await page.waitForSelector('.dk-thread');
    assert.equal(await page.locator('.dk-head h1').innerText(), 'History');
    const names = await page.locator('.dk-thread .dk-name').allInnerTexts();
    assert.deepEqual(names, ['Draft Reel 3 prompts', 'Make this week’s Acro reels', 'Redesign Inkwell from the ground up', 'Overnight stills', 'Try opening two things side by side', 'Try the AI production tools on Reel 4', 'Tidy the old imports', 'Choose the speech-to-text service', 'Rethink the screenplay']);
    const first = page.locator('.dk-thread').nth(0);
    assert.equal(await first.locator('.dk-name').getAttribute('href'), `${NB}?thread=sheet`);
    assert.match(await first.locator('.dk-rr').innerText(), /Waiting on you · 12 min ago/);
    assert.match(await first.locator('.dk-waits').innerText(), /Decide: Pick Kenji’s final character sheet/);
    assert.match(await page.locator('.dk-thread', { hasText: 'Tidy the old imports' }).locator('.dk-rr').innerText(), /Gone quiet · Nov 2/);
    assert.match(await page.locator('.dk-thread', { hasText: 'speech-to-text' }).locator('.dk-rr').innerText(), /Finished · Nov 1/);
    assert.match(await page.locator('.dk-thread', { hasText: 'Acro reels' }).locator('.dk-rr').innerText(), /Waiting on you/);
    if (SHOTS) { await still(page); await page.screenshot({ path: `${SHOTS}/desk-history.png` }); }
  });

  await check('History filters and searches every line a thread ever logged', async () => {
    assert.deepEqual((await page.locator('.dk-filters button').allInnerTexts()).map((t) => t.replace(/\s+/g, '')), ['Everything9', 'Waitingonyou4', 'Closedwithlooseends0', 'Working0', 'Gonequiet1', 'Finished4']);
    await page.locator('.dk-filters button', { hasText: 'Waiting on you' }).click();
    assert.equal(await page.locator('.dk-thread').count(), 4);
    await page.locator('.dk-filters button', { hasText: 'Everything' }).click();
    await page.locator('.dk-search input').fill('stills');
    assert.deepEqual(await page.locator('.dk-thread .dk-name').allInnerTexts(), ['Overnight stills']);
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.dk-search') != null), true, 'the caret stays in the box');
    await page.locator('.dk-search input').fill('nothing like this');
    assert.match(await page.locator('.dk-none').innerText(), /Nothing matches/);
    await page.locator('.dk-search input').fill('');
    assert.equal(await page.locator('.dk-thread').count(), 9);
  });


  await check('Ctrl + K finds the Desk and History', async () => {
    await page.keyboard.press('Control+J');
    await page.waitForSelector('.notebook', { state: 'visible' });
    await sleep(300);
    await page.keyboard.press('Control+K');
    await page.waitForFunction(() => document.activeElement?.id === 'palette-input');
    await page.locator('#palette-input').fill('History: every Claude thread');
    await page.locator('#palette-list li', { hasText: 'History: every Claude thread' }).first().click();
    await page.waitForSelector('.dk-thread');
    await goto(page, { view: 'desk' });
    await page.waitForSelector('.desk-home .dk-catchup');
  });




  await check('signed out, your own projects still show, with one line on how to see the rest', async () => {
    await page.evaluate(() => { window.__saved = window.__desk; window.__desk = null; });
    await page.keyboard.press('Control+J');
    await page.keyboard.press('Control+Shift+U');
    await page.waitForSelector('.dk-note');
    assert.match(await page.locator('.dk-note').innerText(), /Sign in/);
    assert.deepEqual((await page.locator('.zd-proj .zd-name').allInnerTexts()).sort(), ['Harbor spot', 'The Ninja Bunch', 'Untitled novel']);
    assert.equal(await page.locator('.dk-catchup').count(), 0);
    await page.evaluate(() => { window.__desk = window.__saved; });
  });

  await check('every look draws the Desk without a scroll bar across', async () => {
    await goto(page, { view: 'desk' });
    await page.waitForSelector('.dk-call');
    for (const look of ['lamplight', 'ember', 'candle', 'night', 'graphite', 'typewriter', 'paper', 'midnight']) {
      await page.evaluate((l) => document.querySelector(`.look-opt[data-look="${l}"]`).click(), look);
      await sleep(150);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(wide <= 1, `${look}: ${wide}px too wide`);
      if (SHOTS) { await still(page); await page.screenshot({ path: `${SHOTS}/desk-${look}.png` }); }
    }
  });

  await check('a call from a thread closed with it still open says “thread closed”, and History has a filter for it', async () => {
    const link = `${INK}?thread=closedone`;
    // Closed ten days ago (older than the week the stage reads), one try-out still open.
    db.needs.push({ id: 'n9', kind: 'review', title: 'Try the six-dot handle menus', project: 'Inkwell', link, project_link: INK, created_at: T('2026-10-30T09:00:00'), body: '' });
    db.updates.push({ id: 'u9', project: 'Inkwell', project_link: INK, link, thread: 'Six-dot handle menus', text: 'Closed: menus are live; one try-out still open', place: null, state: 'done', created_at: T('2026-10-30T10:00:00') });
    try {
      const stage = async () => {
        await goto(page, { view: 'desk', tab: 'history' });
        await page.waitForSelector('.dk-thread');
        await goto(page, { view: 'desk' });
        await page.waitForSelector('.dk-call[data-id="n9"]');
      };
      const chips = async () => (await page.locator('.dk-filters button').allInnerTexts()).map((t) => t.replace(/\s+/g, ''));
      await stage();
      await page.waitForSelector('.dk-call[data-id="n9"] .dk-closed');
      assert.equal(await page.locator('.dk-call[data-id="n9"] .dk-closed').innerText(), 'thread closed');
      assert.equal(await page.locator('.dk-closed').count(), 1, 'only the closed thread’s call');
      if (SHOTS) { await still(page); await page.screenshot({ path: `${SHOTS}/desk-closed.png` }); }

      await goto(page, { view: 'desk', tab: 'history' });
      await page.waitForSelector('.dk-thread');
      assert.deepEqual((await chips()).slice(1, 3), ['Waitingonyou5', 'Closedwithlooseends1']);
      await page.locator('.dk-filters button', { hasText: 'Closed with loose ends' }).click();
      assert.deepEqual(await page.locator('.dk-thread .dk-name').allInnerTexts(), ['Six-dot handle menus']);
      assert.match(await page.locator('.dk-thread .dk-rr').innerText(), /Closed, still open/);
      assert.equal(await page.locator('.dk-thread .dk-rr').evaluate((e) => getComputedStyle(e).color), await page.locator('.dk-waits').first().evaluate((e) => getComputedStyle(e).color), 'in the signal colour');
      if (SHOTS) { await still(page); await page.screenshot({ path: `${SHOTS}/desk-history-closed.png` }); }

      await page.locator('.dk-filters button', { hasText: 'Everything' }).click();

      // Written in again: a newer line that isn't "Closed:" opens it, and the tag goes.
      db.updates.push({ id: 'u10', project: 'Inkwell', project_link: INK, link, thread: 'Six-dot handle menus', text: 'Back on it: the menus need one more fix', place: null, state: 'working', created_at: T('2026-11-09T13:00:00') });
      await goto(page, { view: 'desk' });
      await page.waitForSelector('.dk-call[data-id="n9"]');
      await page.waitForFunction(() => !document.querySelector('.dk-closed'));
      await goto(page, { view: 'desk', tab: 'history' });
      await page.waitForSelector('.dk-thread');
      assert.deepEqual((await chips()).slice(1, 3), ['Waitingonyou5', 'Closedwithlooseends0']);

      // Closed again, then answered: Done takes it off, tag and all.
      db.updates.pop();
      await stage();
      await page.waitForSelector('.dk-call[data-id="n9"] .dk-closed');
      // On a phone-wide window the tag wraps rather than spills.
      const size = page.viewportSize();
      await page.setViewportSize({ width: 390, height: 844 });
      await sleep(200);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, 'nothing spills at phone width');
      await page.setViewportSize(size);
      await page.locator('.dk-call[data-id="n9"]').click();
      await pick(page, 'Done');
      await page.waitForFunction(() => !document.querySelector('.dk-call[data-id="n9"]'));
      assert.equal(await page.locator('.dk-closed').count(), 0);
    } finally {
      // Leave the shared fixtures as they were for the checks after this one.
      for (const [list, ids] of [[db.needs, ['n9']], [db.updates, ['u9', 'u10']]]) for (const id of ids) { const i = list.findIndex((x) => x.id === id); if (i >= 0) list.splice(i, 1); }
    }
  });

  // ---- arranging by hand ----





  await check('no page errors on desktop', async () => { assert.deepEqual(page.errors, []); });


  // ---- phone ----
  const phone = await open({ width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });


  await check('on a phone History stacks and fits', async () => {
    await goto(phone, { view: 'desk', tab: 'history' });
    await phone.waitForSelector('.dk-thread');
    await still(phone);
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(wide <= 391, `page is ${wide} wide`);
    if (SHOTS) { await still(phone); await phone.screenshot({ path: `${SHOTS}/desk-history-phone.png` }); }
  });

} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall desk checks passed');
