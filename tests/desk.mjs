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
const crumbIs = (p, re) => p.waitForFunction((src) => new RegExp(src).test(document.querySelector('#crumb')?.innerText || ''), re.source);
const calls = [];
const asked = [];

const browser = withoutSync(await chromium.launch());
async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, ...extra });
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

  await check('Desk sits in the rail between Today and Library, and shows how many things need you', async () => {
    assert.deepEqual(await page.locator('.rail-rooms button').allInnerTexts(), ['Today', 'Desk', 'Library']);
    await page.keyboard.press('Control+Shift+U');
    await page.waitForSelector('.desk-home .dk-chair', { state: 'visible' });
    assert.equal(await viewOf(page), 'desk');
    await page.waitForFunction(() => document.querySelector('#desk-toggle')?.getAttribute('aria-current') === 'page');
    assert.equal(await page.locator('#desk-toggle').getAttribute('data-n'), '4');
    assert.equal(await page.locator('#desk-toggle').getAttribute('aria-label'), 'Desk, 4 waiting on you');
    await crumbIs(page, /^Desk$/);
    assert.match(await page.locator('.dk-calls').innerText(), /4 calls waiting · about 27 min/);
    assert.match(await page.locator('.dk-eyebrow').innerText(), /MONDAY, NOV 9/i);
  });

  await check('the top-centre switch is On stage and History, with the pill on the lit one', async () => {
    assert.deepEqual(await page.locator('.desk-switch button').allInnerTexts(), ['On stage', 'History']);
    await lit(page, '.desk-switch [aria-current="page"]', 'On stage');
    assert.ok(await page.locator('.place-switch:not(.desk-switch):not(.today-switch)').isHidden(), 'the Library’s switch is away');
    assert.ok(await page.locator('.dk-switch').isHidden(), 'no second switch on the page');
    await still(page);
    await page.waitForFunction(() => {
      const pill = document.querySelector('.desk-switch .switch-pill').getBoundingClientRect();
      const lit = document.querySelector('.desk-switch [aria-current="page"]').getBoundingClientRect();
      return Math.abs(pill.left - lit.left) < 2 && Math.abs(pill.width - lit.width) < 2;
    });
  });

  await check('a Claude project and your project of the same name share one seat', async () => {
    const names = await page.locator('.dk-chair h3 .dk-name').allInnerTexts();
    assert.deepEqual(names.slice().sort(), ['Acro and Cheer HQ', 'Harbor spot', 'Inkwell', 'The Ninja Bunch', 'Untitled novel']);
    // What needs you comes first; projects with nothing waiting sit after.
    assert.deepEqual(names.slice(3).sort(), ['Harbor spot', 'Untitled novel']);
    const nb = page.locator('.dk-chair', { has: page.locator('.dk-name', { hasText: 'The Ninja Bunch' }) });
    assert.equal(await nb.count(), 1);
    const waiting = (await nb.locator('.dk-call-t').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
    assert.equal(waiting.length, 2);
    assert.match(waiting[0], /^decide ?Pick Kenji’s final character sheet$/i, 'answers before things to try');
    assert.match(waiting[1], /^try ?Try the AI production tools on Reel 4$/i);
    assert.match(await nb.locator('.dk-call-m').last().innerText(), /10 min · 5 days/);
    assert.match(await nb.locator('.dk-now').innerText(), /Reel 3 prompts are half drafted\s+12 min ago/);
    // Yours opens in Inkwell; Claude's alone opens in Claude.
    assert.equal(await nb.locator('h3 .dk-name').evaluate((e) => e.tagName), 'BUTTON');
    assert.equal(await page.locator('.dk-chair h3 a.dk-name', { hasText: 'Acro and Cheer HQ' }).getAttribute('href'), HQ);
  });

  await check('crew: threads still working pulse, ones gone quiet say since when, finished ones are counted', async () => {
    const nb = page.locator('.dk-chair', { has: page.locator('.dk-name', { hasText: 'The Ninja Bunch' }) });
    assert.match(await nb.locator('a.dk-crew').innerText(), /Draft Reel 3 prompts\s+12 min ago/);
    assert.equal(await nb.locator('a.dk-crew').getAttribute('href'), `${NB}?thread=sheet`);
    assert.equal(await nb.locator('.dk-pulse:not(.off)').count(), 1);
    assert.match(await nb.locator('.dk-done').innerText(), /1 thread finished this week/);
    const ink = page.locator('.dk-chair', { has: page.locator('.dk-name', { hasText: /^Inkwell$/ }) });
    assert.match(await ink.locator('a.dk-crew').innerText(), /Tidy the old imports\s+quiet since Nov 2/);
    assert.equal(await ink.locator('.dk-pulse.off').count(), 1);
  });

  await check('Claude’s read sits under the title, asked once with what’s shown', async () => {
    await page.waitForSelector('.dk-read:not(.stale):not([hidden])');
    assert.match(await page.locator('.dk-read').innerText(), /Kenji’s character sheet is the one real decision/);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].needs.length, 4);
    assert.equal(asked[0].updates.length, 4, 'today’s lines only');
  });

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

  await check('a north star is written right on the Desk and kept on the project', async () => {
    const nb = page.locator('.dk-chair', { has: page.locator('.dk-name', { hasText: 'The Ninja Bunch' }) });
    assert.equal(await nb.locator('.dk-star').getAttribute('data-ph'), 'North star: what is this for?');
    await nb.locator('.dk-star').click();
    await page.keyboard.type('Reels first. One a week, each one funnier than the last.');
    await page.keyboard.press('Enter');
    await sleep(300);
    const w = (await all(page)).find((r) => r.kind === 'world' && r.title === 'The Ninja Bunch');
    assert.equal(w.fields.star, 'Reels first. One a week, each one funnier than the last.');
    assert.equal(await page.locator('.dk-chair h3 .dk-name', { hasText: 'Acro and Cheer HQ' }).locator('xpath=ancestor::section').locator('.dk-star').count(), 0, 'a Claude project has none');
  });

  await check('a call’s menu: the thread, its guide, Done and Later', async () => {
    const row = page.locator('.dk-call[data-id="n1"]');
    assert.equal(await row.getAttribute('href'), `${NB}?thread=sheet`);
    await row.click();
    assert.deepEqual(await page.locator('.pop-menu .pop-item').allInnerTexts(), ['Open the thread', 'Open the guide', 'Done: take it off the list', 'Later: back tomorrow morning']);
    await pick(page, 'Later');
    await page.waitForFunction(() => !document.querySelector('.dk-call[data-id="n1"]'));
    assert.equal(db.needs.find((n) => n.id === 'n1').snoozed_until, new Date('2026-11-10T07:00:00-08:00').toISOString());
    assert.match(await page.locator('.dk-later').innerText(), /1 set aside until tomorrow morning/);
    assert.equal(await page.locator('#desk-toggle').getAttribute('data-n'), '3');
    await page.locator('.dk-later').getByRole('button', { name: 'Bring back' }).click();
    await page.waitForSelector('.dk-call[data-id="n1"]');
    assert.equal(db.needs.find((n) => n.id === 'n1').snoozed_until, null);
    await page.locator('.dk-call[data-id="n3"]').click();
    await pick(page, 'Done');
    await page.waitForFunction(() => !document.querySelector('.dk-call[data-id="n3"]'));
    assert.ok(db.needs.find((n) => n.id === 'n3').resolved_at);
    assert.match(await page.locator('.dk-calls').innerText(), /3 calls waiting · about 22 min/);
  });

  await check('⋯ moves a project to the wings or backstage, and back to automatic', async () => {
    const harbor = () => page.locator('[data-key]', { has: page.locator('.dk-name', { hasText: 'Harbor spot' }) });
    assert.equal(await harbor().evaluate((e) => e.className), 'dk-chair');
    await harbor().locator('.dk-more').click();
    assert.deepEqual(await page.locator('.pop-menu .pop-item').allInnerTexts(), ['On stage', 'In the wings', 'Backstage']);
    assert.equal(await page.locator('.pop-menu .pop-item.current').innerText(), 'On stage');
    await pick(page, 'Backstage');
    await page.waitForSelector('.dk-back .dk-row');
    assert.match(await page.locator('.dk-back .dk-label').innerText(), /Backstage/i);
    assert.equal(await harbor().evaluate((e) => e.className), 'dk-row s-back');
    const set = (await all(page)).find((r) => r.id === 'settings-desk');
    assert.equal(Object.values(set.fields.stage)[0], 'back');
    await harbor().locator('.dk-more').click();
    await pick(page, 'In the wings');
    await page.waitForSelector('.dk-wings .dk-row');
    await harbor().locator('.dk-more').click();
    await pick(page, 'Let Inkwell decide');
    await page.waitForFunction(() => !document.querySelector('.dk-wings, .dk-back'));
    assert.equal(await harbor().evaluate((e) => e.className), 'dk-chair');
  });

  await check('a Claude project can be tied to one of yours, and separated again', async () => {
    const acro = page.locator('.dk-chair', { has: page.locator('.dk-name', { hasText: 'Acro and Cheer HQ' }) });
    await acro.locator('.dk-more').click();
    await pick(page, 'This is one of my projects');
    await pick(page, 'Harbor spot');
    await page.waitForFunction(() => ![...document.querySelectorAll('.dk-chair .dk-name')].some((n) => n.textContent === 'Acro and Cheer HQ'));
    const harbor = page.locator('.dk-chair', { has: page.locator('.dk-name', { hasText: 'Harbor spot' }) });
    assert.match(await harbor.locator('.dk-now').innerText(), /Three reels drafted/);
    await harbor.locator('.dk-more').click();
    await pick(page, 'Separate from “Acro and Cheer HQ”');
    await page.waitForFunction(() => [...document.querySelectorAll('.dk-chair .dk-name')].some((n) => n.textContent === 'Acro and Cheer HQ'));
  });

  await check('a project’s name opens it; Back returns to the Desk', async () => {
    await page.locator('.dk-chair h3 button.dk-name', { hasText: 'The Ninja Bunch' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'world');
    await page.waitForFunction(() => document.querySelector('#tb-back')?.textContent === '‹ Desk');
    await page.locator('#tb-back').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'desk');
    await page.waitForSelector('.dk-chair');
  });

  await check('an Inkwell place in the catch-up opens right here', async () => {
    await page.locator('.dk-catchup .dk-ev', { hasText: 'Reel 3 prompts' }).locator('a.dk-place').click();
    // The day counts as visited once it's in the browser's own history.
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook' && history.state?.view === 'notebook');
    await page.goBack();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'desk');
    await page.waitForSelector('.dk-chair');
    await lit(page, '.desk-switch [aria-current="page"]', 'On stage');
  });

  await check('History: every thread, newest activity first, answered and finished ones too', async () => {
    await page.locator('.desk-switch button', { hasText: 'History' }).click();
    await page.waitForSelector('.dk-thread');
    await lit(page, '.desk-switch [aria-current="page"]', 'History');
    await crumbIs(page, /Desk\s*›\s*History/);
    assert.equal(await page.locator('.dk-head h1').innerText(), 'History');
    const names = await page.locator('.dk-thread .dk-name').allInnerTexts();
    assert.deepEqual(names, ['Make this week’s Acro reels', 'Draft Reel 3 prompts', 'Redesign Inkwell from the ground up', 'Overnight stills', 'Try opening two things side by side', 'Try the AI production tools on Reel 4', 'Tidy the old imports', 'Choose the speech-to-text service', 'Rethink the screenplay']);
    // The reels were answered a moment ago (Done above), so that thread moved last.
    const first = page.locator('.dk-thread').nth(1);
    assert.equal(await first.locator('.dk-name').getAttribute('href'), `${NB}?thread=sheet`);
    assert.match(await first.locator('.dk-rr').innerText(), /Waiting on you · 12 min ago/);
    assert.match(await first.locator('.dk-waits').innerText(), /Decide: Pick Kenji’s final character sheet/);
    assert.match(await page.locator('.dk-thread', { hasText: 'Tidy the old imports' }).locator('.dk-rr').innerText(), /Gone quiet · Nov 2/);
    assert.match(await page.locator('.dk-thread', { hasText: 'speech-to-text' }).locator('.dk-rr').innerText(), /Finished · Nov 1/);
    assert.match(await page.locator('.dk-thread', { hasText: 'Acro reels' }).locator('.dk-rr').innerText(), /Finished/);
    if (SHOTS) { await still(page); await page.screenshot({ path: `${SHOTS}/desk-history.png` }); }
  });

  await check('History filters and searches every line a thread ever logged', async () => {
    assert.deepEqual((await page.locator('.dk-filters button').allInnerTexts()).map((t) => t.replace(/\s+/g, '')), ['Everything9', 'Waitingonyou3', 'Closedwithlooseends0', 'Working0', 'Gonequiet1', 'Finished5']);
    await page.locator('.dk-filters button', { hasText: 'Waiting on you' }).click();
    assert.equal(await page.locator('.dk-thread').count(), 3);
    await page.locator('.dk-filters button', { hasText: 'Everything' }).click();
    await page.locator('.dk-search input').fill('stills');
    assert.deepEqual(await page.locator('.dk-thread .dk-name').allInnerTexts(), ['Overnight stills']);
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.dk-search') != null), true, 'the caret stays in the box');
    await page.locator('.dk-search input').fill('nothing like this');
    assert.match(await page.locator('.dk-none').innerText(), /Nothing matches/);
    await page.locator('.dk-search input').fill('');
    assert.equal(await page.locator('.dk-thread').count(), 9);
  });

  await check('“finished this week” on a seat opens History already narrowed', async () => {
    await page.locator('.desk-switch button', { hasText: 'On stage' }).click();
    await page.waitForSelector('.dk-chair');
    await page.locator('.dk-chair', { has: page.locator('.dk-name', { hasText: 'The Ninja Bunch' }) }).locator('.dk-done').click();
    await page.waitForSelector('.dk-thread');
    assert.equal(await page.locator('.dk-search input').inputValue(), 'The Ninja Bunch');
    assert.deepEqual(await page.locator('.dk-thread .dk-name').allInnerTexts(), ['Overnight stills']);
    await page.locator('.dk-search input').fill('');
    await page.locator('.dk-filters button', { hasText: 'Everything' }).click();
  });

  await check('Ctrl + K finds the Desk and History; Go lists Desk among the rooms', async () => {
    await page.keyboard.press('Control+J');
    await page.waitForSelector('.notebook', { state: 'visible' });
    await sleep(300);
    await page.keyboard.press('Control+O');
    await page.waitForSelector('.go-panel', { state: 'visible' });
    assert.deepEqual(await page.locator('.go-desk .go-tab-name').allInnerTexts(), ['Today', 'Desk', 'Library', 'Drawer', 'Tags']);
    await page.locator('.go-desk .go-tab', { hasText: 'Desk' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'desk');
    await page.waitForSelector('.dk-chair');
  });

  await check('Look switches: Claude’s line and the number beside Desk can each be put away', async () => {
    const flip = (k, on) => page.evaluate(([key, v]) => { const c = document.querySelector(`[data-show="${key}"]`); c.checked = v; c.dispatchEvent(new Event('change')); }, [k, on]);
    await flip('deskread', false);
    assert.ok(await page.locator('.dk-read').isHidden());
    await flip('deskcount', false);
    assert.equal(await page.locator('#desk-toggle').evaluate((e) => getComputedStyle(e, '::after').display), 'none');
    await flip('deskread', true);
    await flip('deskcount', true);
    assert.ok(await page.locator('.dk-read').isVisible());
  });

  await check('Focus hides the rail and the bar; the Desk stays', async () => {
    await page.keyboard.press('Control+.');
    await page.waitForFunction(() => document.documentElement.classList.contains('focus'));
    assert.ok(await page.locator('.dk-chair').first().isVisible());
    await page.keyboard.press('Control+.');
    await page.waitForFunction(() => !document.documentElement.classList.contains('focus'));
  });

  await check('more than three things to try on one project fold into one line', async () => {
    for (const [i, title] of ['Try Woven scripts', 'Try the checklists', 'Try the Manuscripts row'].entries()) db.needs.push({ id: `t${i}`, kind: 'review', title, project: 'Inkwell', link: `${INK}?thread=t${i}`, project_link: INK, created_at: T('2026-11-06T10:00:00'), body: '' });
    await page.keyboard.press('Control+J');
    await page.keyboard.press('Control+Shift+U');
    await page.waitForSelector('.dk-tries');
    const ink = page.locator('.dk-chair', { has: page.locator('.dk-name', { hasText: /^Inkwell$/ }) });
    assert.match(await ink.locator('.dk-tries summary').innerText(), /4 to try, about 10 minutes each/);
    assert.equal(await ink.locator('.dk-tries').evaluate((d) => d.open), false);
    assert.equal(await ink.locator('.dk-call:visible').count(), 0);
    await ink.locator('.dk-tries summary').click();
    assert.equal(await ink.locator('.dk-tries .dk-call:visible').count(), 4);
    assert.match(await page.locator('.dk-calls').innerText(), /6 calls waiting · about 52 min/);
    db.needs.splice(-3);
  });

  await check('signed out, your own projects still show, with one line on how to see the rest', async () => {
    await page.evaluate(() => { window.__saved = window.__desk; window.__desk = null; });
    await page.keyboard.press('Control+J');
    await page.keyboard.press('Control+Shift+U');
    await page.waitForSelector('.dk-note');
    assert.match(await page.locator('.dk-note').innerText(), /Sign in/);
    assert.deepEqual((await page.locator('.dk-chair h3 .dk-name').allInnerTexts()).sort(), ['Harbor spot', 'The Ninja Bunch', 'Untitled novel']);
    assert.equal(await page.locator('.dk-catchup').count(), 0);
    await page.evaluate(() => { window.__desk = window.__saved; });
  });

  await check('every look draws the Desk without a scroll bar across', async () => {
    await page.keyboard.press('Control+J');
    await page.keyboard.press('Control+Shift+U');
    await page.waitForSelector('.dk-call');
    for (const look of ['lamplight', 'graphite', 'typewriter', 'paper', 'midnight']) {
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
        await page.locator('.desk-switch button', { hasText: 'History' }).click();
        await page.waitForSelector('.dk-thread');
        await page.locator('.desk-switch button', { hasText: 'On stage' }).click();
        await page.waitForSelector('.dk-call[data-id="n9"]');
      };
      const chips = async () => (await page.locator('.dk-filters button').allInnerTexts()).map((t) => t.replace(/\s+/g, ''));
      await stage();
      await page.waitForSelector('.dk-call[data-id="n9"] .dk-closed');
      assert.equal(await page.locator('.dk-call[data-id="n9"] .dk-closed').innerText(), 'thread closed');
      assert.equal(await page.locator('.dk-closed').count(), 1, 'only the closed thread’s call');
      assert.match(await page.locator('.dk-calls').innerText(), /\d+ calls waiting · about [^·]+ · 1 from closed threads/);
      if (SHOTS) { await still(page); await page.screenshot({ path: `${SHOTS}/desk-closed.png` }); }

      await page.locator('.desk-switch button', { hasText: 'History' }).click();
      await page.waitForSelector('.dk-thread');
      assert.deepEqual((await chips()).slice(1, 3), ['Waitingonyou4', 'Closedwithlooseends1']);
      await page.locator('.dk-filters button', { hasText: 'Closed with loose ends' }).click();
      assert.deepEqual(await page.locator('.dk-thread .dk-name').allInnerTexts(), ['Six-dot handle menus']);
      assert.match(await page.locator('.dk-thread .dk-rr').innerText(), /Closed, still open/);
      assert.equal(await page.locator('.dk-thread .dk-rr').evaluate((e) => getComputedStyle(e).color), await page.locator('.dk-waits').first().evaluate((e) => getComputedStyle(e).color), 'in the signal colour');
      if (SHOTS) { await still(page); await page.screenshot({ path: `${SHOTS}/desk-history-closed.png` }); }

      // Switched off under Look: no tag, no chip, and the thread reads as waiting on you.
      const flip = (on) => page.evaluate((v) => { const c = document.querySelector('[data-show="closedtag"]'); c.checked = v; c.dispatchEvent(new Event('change')); }, on);
      await flip(false);
      await page.waitForFunction(() => !document.querySelector('.dk-filters [data-f="loose"]'));
      assert.match(await page.locator('.dk-thread', { hasText: 'Six-dot' }).locator('.dk-rr').innerText(), /Waiting on you/);
      await flip(true);
      await page.locator('.dk-filters button', { hasText: 'Everything' }).click();

      // Written in again: a newer line that isn't "Closed:" opens it, and the tag goes.
      db.updates.push({ id: 'u10', project: 'Inkwell', project_link: INK, link, thread: 'Six-dot handle menus', text: 'Back on it: the menus need one more fix', place: null, state: 'working', created_at: T('2026-11-09T13:00:00') });
      await page.locator('.desk-switch button', { hasText: 'On stage' }).click();
      await page.waitForSelector('.dk-call[data-id="n9"]');
      await page.waitForFunction(() => !document.querySelector('.dk-closed'));
      assert.doesNotMatch(await page.locator('.dk-calls').innerText(), /from closed/);
      await page.locator('.desk-switch button', { hasText: 'History' }).click();
      await page.waitForSelector('.dk-thread');
      assert.deepEqual((await chips()).slice(1, 3), ['Waitingonyou4', 'Closedwithlooseends0']);

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
      assert.doesNotMatch(await page.locator('.dk-calls').innerText(), /from closed/);
    } finally {
      // Leave the shared fixtures as they were for the checks after this one.
      for (const [list, ids] of [[db.needs, ['n9']], [db.updates, ['u9', 'u10']]]) for (const id of ids) { const i = list.findIndex((x) => x.id === id); if (i >= 0) list.splice(i, 1); }
    }
  });

  await check('no page errors on desktop', async () => { assert.deepEqual(page.errors, []); });

  // ---- a narrower window: two columns ----
  const mid = await open({ width: 1000, height: 800 });
  await check('at 1000 wide the seats sit two across and nothing spills', async () => {
    await mid.keyboard.press('Control+Shift+U');
    await mid.waitForSelector('.dk-chair');
    const xs = await mid.locator('.dk-chair').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().x)))]);
    assert.equal(xs.length, 2);
    assert.ok((await mid.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
    assert.deepEqual(mid.errors, []);
  });

  // ---- phone ----
  const phone = await open({ width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await check('on a phone the bar is Today, Desk, the mic, Library and Go, with the count on Desk', async () => {
    await sleep(1000);
    await phone.waitForFunction(() => { document.activeElement?.blur(); return !document.body.classList.contains('kb-up') && !document.querySelector('.outline-bar')?.offsetParent && !document.querySelector('.script-bar')?.offsetParent; });
    await sleep(200);
    assert.deepEqual(await phone.locator('.placebar .pb-word').allInnerTexts(), ['Today', 'Desk', 'Library', 'Go']);
    await phone.locator('.pb-desk').tap();
    await phone.waitForSelector('.dk-chair', { state: 'visible' });
    assert.equal(await phone.locator('.pb-desk').getAttribute('aria-current'), 'page');
    assert.equal(await phone.locator('.pb-desk').getAttribute('data-n'), '3');
    const boxes = await phone.locator('.dk-chair').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
    assert.equal(new Set(boxes).size, 1, 'one column');
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(wide <= 391, `page is ${wide} wide`);
    if (SHOTS) { await phone.waitForSelector('.dk-read:not([hidden])'); await still(phone); await phone.screenshot({ path: `${SHOTS}/desk-phone.png` }); }
  });

  await check('on a phone the switch is on the page, and History stacks', async () => {
    assert.deepEqual(await phone.locator('.dk-switch button').allInnerTexts(), ['On stage', 'History']);
    await phone.locator('.dk-switch button', { hasText: 'History' }).tap();
    await phone.waitForSelector('.dk-thread');
    assert.equal(await phone.locator('.dk-switch [aria-current="page"]').innerText(), 'History');
    await still(phone);
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(wide <= 391, `page is ${wide} wide`);
    if (SHOTS) { await still(phone); await phone.screenshot({ path: `${SHOTS}/desk-history-phone.png` }); }
  });

  await check('the menu moved into the Go sheet as Everything', async () => {
    await phone.locator('.pb-place').tap();
    await phone.waitForSelector('.go-panel', { state: 'visible' });
    assert.deepEqual(await phone.locator('.go-desk .go-tab-name').allInnerTexts(), ['Today', 'Desk', 'Library', 'Drawer', 'Tags']);
    await phone.locator('.go-all').tap();
    await phone.waitForSelector('.palette', { state: 'visible' });
    assert.equal(await phone.locator('.go-panel').isVisible(), false);
    assert.deepEqual(phone.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall desk checks passed');
