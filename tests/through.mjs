// Go through: the last week's loose lines, and the Desk's calls, one card at
// a time with the likeliest answer lit. A stand-in (window.__desk) plays
// Daybook for the calls.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4265;
const DIST = process.env.DIST;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(DIST ? ['--outDir', DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;

const NOW = '2026-11-09T14:04:00-08:00';
const T = (s) => new Date(`${s}-08:00`).toISOString();
const NB = 'https://claude.ai/code/project/chan_nb';
const INK = 'https://claude.ai/code/project/chan_ink';

// What Daybook holds, and what was asked of it.
const db = {
  needs: [
    { id: 'n1', kind: 'review', title: 'Try the AI production tools on Reel 4', project: 'The Ninja Bunch', link: `${NB}?thread=tools`, project_link: NB, created_at: T('2026-11-03T22:53:00'), body: 'Your December 14 tests lean on this.\nGuide: https://claude.ai/artifact/abc' },
    { id: 'n2', kind: 'decision', title: 'Pick Kenji’s final character sheet', project: 'The Ninja Bunch', link: `${NB}?thread=sheet`, project_link: NB, created_at: T('2026-11-08T10:09:00'), body: 'Two sheets are starred. Reel 3 prompts wait on the pick.' },
    { id: 'n3', kind: 'blocked', title: 'Say “go” on moving tasks into Inkwell', project: 'Inkwell', link: `${INK}?thread=tasks`, project_link: INK, created_at: T('2026-11-07T09:00:00'), body: '' },
  ],
};
const calls = [];

const browser = withoutSync(await chromium.launch());
async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, ...extra });
  await ctx.exposeFunction('__db', (op, a, b) => {
    calls.push([op, a, b]);
    if (op === 'desk' || op === 'all') return { needs: db.needs.filter((n) => op === 'all' || !n.resolved_at).map((n) => ({ ...n })), updates: [] };
    const n = db.needs.find((x) => x.id === a);
    if (op === 'done') n.resolved_at = new Date(NOW).toISOString();
    if (op === 'later') n.snoozed_until = b;
    return null;
  });
  await ctx.addInitScript(() => {
    window.__claude = () => ({});
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
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return page;
}
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const lineNamed = async (p, start) => (await all(p)).find((r) => r.kind === 'line' && !r.deleted && (r.text || '').startsWith(start));
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const today = async (p) => {
  await p.evaluate(() => document.querySelector('#view-toggle').click());
  await p.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
  await still(p);
  await sleep(300);
};
// The card that's up: its words, the line under them, the lit answer.
const card = (p) => p.evaluate(() => ({
  count: document.querySelector('.thru-count')?.textContent || '',
  big: document.querySelector('.thru-big')?.textContent || '',
  ctx: document.querySelector('.thru-ctx')?.innerText || '',
  lit: document.querySelector('.thru-opt.sug .thru-label')?.textContent || '',
  enter: document.querySelector('.thru-opt.sug .thru-enter')?.textContent || '',
  options: [...document.querySelectorAll('.thru-opt')].map((b) => `${b.dataset.key} ${b.querySelector('.thru-label').textContent}`),
}));
// The next card is up once the one that left is gone and nothing is moving.
const cardIs = async (p, start) => { await p.waitForFunction((s) => (document.querySelector('.thru-big')?.textContent || '').startsWith(s), start); await still(p); };
const closed = (p) => p.waitForFunction(() => !document.querySelector('.thru'));
const rings = (p) => p.locator('#outline-editor li.is-loose').count();
const foot = (p) => p.evaluate(() => { const f = document.querySelector('#loose-foot'); return f.hidden ? '' : f.innerText.replace(/\s+/g, ' ').trim(); });
const footIs = (p, text) => p.waitForFunction((t) => { const f = document.querySelector('#loose-foot'); return (f.hidden ? '' : f.innerText.replace(/\s+/g, ' ').trim()) === t; }, text);

async function seed(p) {
  await p.evaluate(() => document.querySelector('#library-toggle').click());
  await p.waitForFunction(() => document.documentElement.dataset.view === 'library');
  await sleep(300);
  await p.evaluate(() => { document.querySelector('#lib-new').hidden = false; });
  await p.locator('.lib-shape[data-shape="life"]').click();
  await p.fill('#lib-new-title', 'The Ninja Bunch');
  await p.locator('#lib-new .pill').click();
  await p.waitForFunction(() => document.documentElement.dataset.view === 'world');
  await sleep(300);
  await p.evaluate(async (now) => {
    const put = (rows) => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const tx = r.result.transaction('entries', 'readwrite'); for (const x of rows) tx.objectStore('entries').put(x); tx.oncomplete = res; }; });
    const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now, updated_at: now, sort: 1 };
    let n = 0;
    const line = (id, parent, text, extra = {}) => ({ ...base, id, kind: 'line', parent_id: parent, sort: (n += 1), text, content: [{ type: 'text', text }], fields: { done: false, gather: null, gathered: null, mirror: null }, ...extra });
    await put([
      { ...base, id: 'day-2026-11-09', kind: 'day', title: '2026-11-09' },
      { ...base, id: 'day-2026-11-08', kind: 'day', title: '2026-11-08' },
      { ...base, id: 'day-2026-10-30', kind: 'day', title: '2026-10-30' },
      line('l1', 'day-2026-11-09', 'Call Dana about the storyboards before Friday'),
      line('l2', 'day-2026-11-09', 'Kenji should lose the roof fight on purpose, for the Ninja Bunch rematch'),
      line('l3', 'day-2026-11-09', 'What if the lighthouse keeper only talks through the logbook'),
      line('l4', 'day-2026-11-09', 'Rain all morning'),
      line('l4a', 'l4', 'The gutters held'),
      line('l5', 'day-2026-11-09', 'Mika’s theme, slowed down #music', { tags: ['music'] }),
      line('l7', 'day-2026-11-08', 'Order the 8 TB storage drive'),
      line('l8', 'day-2026-10-30', 'An old thought that never got filed'),
    ]);
  }, new Date(NOW).getTime());
  await p.reload();
  await p.waitForFunction(() => document.documentElement.dataset.started === '1');
  await today(p);
}

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

try {
  const page = await open({ width: 1440, height: 900 });
  await seed(page);

  await check('loose lines carry a ring, and the day says how many', async () => {
    await page.waitForFunction(() => document.querySelectorAll('#outline-editor li.is-loose').length === 4);
    await footIs(page, '4 loose lines Go through them');
    const ringed = await page.locator('#outline-editor li.is-loose > p').allInnerTexts();
    assert.deepEqual(ringed.map((t) => t.split(' ')[0]), ['Call', 'Kenji', 'What', 'Rain']);
    // A tagged line and a line indented under another are not loose.
    assert.equal(await page.locator('#outline-editor li.is-loose', { hasText: 'Mika’s theme' }).count(), 0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/through-rings.png` });
  });

  await check('Go through opens on the first one, with the likeliest answer lit', async () => {
    await page.locator('#loose-foot button').click();
    await page.waitForSelector('.thru');
    await still(page);
    const c = await card(page);
    assert.equal(c.count, 'Loose lines · 1 of 5');
    assert.equal(c.big, 'Call Dana about the storyboards before Friday');
    assert.match(c.ctx, /^Today/);
    assert.match(c.ctx, /It names a day|something to do/);
    assert.equal(c.lit, 'A task for today');
    assert.equal(c.enter, 'Enter');
    assert.deepEqual(c.options, ['T A task for today', 'W A task, not on a day yet', 'F File into a project…', 'D Into the Drawer', 'K Keep it on the day', 'S Skip for now']);
    assert.equal(await page.locator('.thru-undo').count(), 0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/through-card.png` });
  });

  await check('Enter takes the lit answer: the line is a task on today’s plan', async () => {
    await page.keyboard.press('Enter');
    await cardIs(page, 'Kenji should lose');
    const l1 = await lineNamed(page, 'Call Dana');
    assert.equal(l1.fields.task.day, '2026-11-09');
    assert.equal(l1.fields.sorted.how, 'task');
    await page.waitForFunction(() => [...document.querySelectorAll('#plan .pl-task .pl-words')].some((w) => w.textContent.startsWith('Call Dana')));
    assert.equal((await card(page)).count, 'Loose lines · 2 of 5');
  });

  await check('Z takes the last answer back, and the card returns', async () => {
    assert.equal(await page.locator('.thru-undo').innerText(), 'Undo the last one');
    await page.keyboard.press('z');
    await cardIs(page, 'Call Dana');
    const l1 = await lineNamed(page, 'Call Dana');
    assert.equal(l1.fields.task, undefined);
    assert.equal(l1.fields.sorted, undefined);
    assert.equal((await card(page)).count, 'Loose lines · 1 of 5');
    await page.keyboard.press('t');
    await cardIs(page, 'Kenji should lose');
    assert.equal((await lineNamed(page, 'Call Dana')).fields.task.day, '2026-11-09');
  });

  await check('a line that names a project is offered that project, and F links it there', async () => {
    const c = await card(page);
    assert.equal(c.lit, 'File into The Ninja Bunch');
    assert.match(c.ctx, /It names The Ninja Bunch/);
    await page.keyboard.press('f');
    await cardIs(page, 'What if the lighthouse');
    const l2 = await lineNamed(page, 'Kenji should lose');
    const world = (await all(page)).find((r) => r.kind === 'world' && r.title === 'The Ninja Bunch');
    assert.ok(l2.links.includes(world.id));
    assert.equal(l2.fields.sorted.how, 'file');
    assert.ok(l2.content.some((n) => n.type === 'entryRef' && n.attrs.id === world.id));
  });

  await check('a spark is offered the Drawer; D tags it #drawer', async () => {
    assert.equal((await card(page)).lit, 'Into the Drawer');
    await page.keyboard.press('d');
    await cardIs(page, 'Rain all morning');
    const l3 = await lineNamed(page, 'What if the lighthouse');
    assert.ok(l3.tags.includes('drawer'));
  });

  await check('S skips; yesterday’s line follows today’s; W makes a task with no day', async () => {
    assert.equal((await card(page)).lit, 'Keep it on the day');
    await page.keyboard.press('s');
    await cardIs(page, 'Order the 8 TB');
    const c = await card(page);
    assert.match(c.ctx, /^Yesterday/);
    assert.equal(c.count, 'Loose lines · 5 of 5');
    assert.equal(await page.locator('.thru-undo').count(), 0, 'a skip leaves nothing to undo');
    await page.keyboard.press('w');
    await closed(page);
    const l7 = await lineNamed(page, 'Order the 8 TB');
    assert.equal(l7.fields.task.day, null);
    assert.equal(l7.fields.task.v, 1);
  });

  await check('at the end it says what’s left; the ring and the count follow', async () => {
    await page.waitForFunction(() => /1 left for next time/.test(document.querySelector('.toast')?.textContent || ''));
    await footIs(page, '1 loose line Go through it');
    await page.waitForFunction(() => document.querySelectorAll('#outline-editor li.is-loose').length === 1);
    // What was filed shows on the page itself: a label on the task, the link, the tag.
    assert.match(await page.locator('#outline-editor li', { hasText: 'Call Dana' }).locator('.task-chip').innerText(), /Today/);
  });

  await check('Ctrl + K finds it; with no guess, F lists your projects; K keeps the line as a note', async () => {
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').fill('go through loose');
    await sleep(300);
    assert.match(await page.locator('#palette-list li').first().innerText(), /Go through loose lines/);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.thru');
    await cardIs(page, 'Rain all morning');
    assert.equal((await card(page)).count, 'Loose lines · 1 of 1');
    await page.keyboard.press('f');
    await page.waitForSelector('.thru-pick');
    const places = (await card(page)).options;
    assert.ok(places.some((o) => /^\d The Ninja Bunch$/.test(o)), places.join(', '));
    assert.equal(places.at(-1), 'B Back');
    await page.keyboard.press('b');
    await page.waitForFunction(() => !document.querySelector('.thru-pick'));
    await page.keyboard.press('k');
    await closed(page);
    await page.waitForFunction(() => /All sorted/.test(document.querySelector('.toast')?.textContent || ''));
    const l4 = await lineNamed(page, 'Rain all morning');
    assert.equal(l4.fields.sorted.how, 'keep');
    assert.equal(l4.text, 'Rain all morning');
    await footIs(page, '');
    assert.equal(await rings(page), 0);
  });

  await check('with nothing loose, it says so and doesn’t open', async () => {
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').fill('go through loose');
    await sleep(300);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Nothing loose this week/.test(document.querySelector('.toast')?.textContent || ''));
    assert.equal(await page.locator('.thru').count(), 0);
  });

  await check('a line typed just now is loose once it’s saved; Esc stops and leaves it so; a tag files it', async () => {
    await page.locator('#outline-editor').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Fresh thought about the harbor');
    await footIs(page, '1 loose line Go through it');
    await page.waitForFunction(() => document.querySelectorAll('#outline-editor li.is-loose').length === 1);
    await page.locator('#loose-foot button').click();
    await page.waitForSelector('.thru');
    await cardIs(page, 'Fresh thought');
    await page.keyboard.press('Escape');
    await closed(page);
    assert.equal((await lineNamed(page, 'Fresh thought')).fields.sorted, undefined);
    assert.equal(await rings(page), 1);
    // Typing goes to the page again, not to a card that's gone.
    await page.locator('#outline-editor li', { hasText: 'Fresh thought' }).locator('p').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' #harbor');
    await footIs(page, '');
    await page.waitForFunction(() => document.querySelectorAll('#outline-editor li.is-loose').length === 0);
  });

  await check('the Look switch puts the rings and the count away', async () => {
    await page.locator('#outline-editor').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('One more loose thing');
    await footIs(page, '1 loose line Go through it');
    await page.evaluate(() => { const c = document.querySelector('[data-show="loose"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.ok(await page.locator('#loose-foot').isHidden());
    const ring = () => page.locator('#outline-editor li.is-loose > .line-gutter .bullet').evaluate((b) => getComputedStyle(b, '::after').boxShadow);
    assert.equal(await ring(), 'none');
    await page.evaluate(() => { const c = document.querySelector('[data-show="loose"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.ok(await page.locator('#loose-foot').isVisible());
    assert.notEqual(await ring(), 'none');
  });

  await check('older days carry no rings and no count', async () => {
    await page.evaluate(() => { history.pushState({ view: 'notebook', pageId: 'day-2026-10-30' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'notebook', pageId: 'day-2026-10-30' } })); });
    await page.waitForFunction(() => /October 30/.test(document.querySelector('#nb-title')?.textContent || ''));
    await sleep(500);
    assert.equal(await rings(page), 0);
    assert.equal(await foot(page), '');
    await today(page);
  });

  await check('the Desk’s calls: “Go through them” walks decisions first, then things to do, then things to try', async () => {
    await page.keyboard.press('Control+Shift+U');
    await page.waitForSelector('.desk-home .dk-chair', { state: 'visible' });
    await page.locator('.dk-calls .dk-through').click();
    await page.waitForSelector('.thru');
    await still(page);
    const c = await card(page);
    assert.equal(c.count, 'Needs you · 1 of 3');
    assert.equal(c.big, 'Pick Kenji’s final character sheet');
    assert.match(c.ctx, /DECIDE\s*The Ninja Bunch · about 2 min · waiting 1 day/i);
    assert.match(c.ctx, /Two sheets are starred/);
    assert.equal(c.lit, 'Open the thread');
    assert.deepEqual(c.options, ['O Open the thread', 'D Done: take it off the list', 'L Later: ask me tomorrow morning', 'S Skip for now']);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/through-calls.png` });
  });

  await check('O opens the thread in a new tab and the card stays; D and L answer in Daybook', async () => {
    const [tab] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('o')]);
    assert.equal(tab.url(), `${NB}?thread=sheet`);
    await tab.close();
    assert.equal((await card(page)).big, 'Pick Kenji’s final character sheet');
    await page.keyboard.press('d');
    await cardIs(page, 'Say “go”');
    assert.ok(calls.some(([op, id]) => op === 'done' && id === 'n2'));
    assert.match((await card(page)).ctx, /DO\s*Inkwell · about 5 min · waiting 2 days/i);
    await page.keyboard.press('l');
    await cardIs(page, 'Try the AI production tools');
    const later = calls.find(([op, id]) => op === 'later' && id === 'n3');
    assert.ok(later);
    assert.equal(new Date(later[2]).toISOString(), new Date('2026-11-10T07:00:00-08:00').toISOString());
    // The guide's address is left out of the reason.
    assert.match((await card(page)).ctx, /Your December 14 tests lean on this\.$/);
    await page.keyboard.press('s');
    await closed(page);
    await page.waitForFunction(() => /1 left for next time/.test(document.querySelector('.toast')?.textContent || ''));
  });

  await check('the Desk follows: one call left, so no “Go through them”', async () => {
    await page.waitForFunction(() => /1 call waiting/.test(document.querySelector('.dk-calls')?.textContent || ''));
    assert.equal(await page.locator('.dk-calls .dk-through').count(), 0);
    assert.equal(await page.locator('#desk-toggle').getAttribute('data-n'), '1');
  });

  await check('every look draws the card; motion off shows it at once; no page errors', async () => {
    await today(page);
    await page.locator('#loose-foot button').click();
    await page.waitForSelector('.thru');
    for (const look of ['midnight', 'lamplight', 'graphite', 'typewriter', 'paper']) {
      await page.evaluate((l) => { document.documentElement.dataset.look = l; }, look);
      const box = await page.locator('.thru').boundingBox();
      assert.ok(box.width > 400 && box.height > 250, look);
      const [ink, bg] = await page.locator('.thru-big').evaluate((e) => [getComputedStyle(e).color, getComputedStyle(e.closest('.thru')).backgroundColor]);
      assert.notEqual(ink, bg, look);
    }
    await page.evaluate(() => { document.documentElement.dataset.look = 'midnight'; document.documentElement.dataset.motion = 'off'; });
    await page.keyboard.press('k');
    await closed(page);
    await page.evaluate(() => { document.documentElement.dataset.motion = 'full'; });
    assert.deepEqual(page.errors, []);
  });

  // ---------- phone ----------
  const phone = await open({ width: 390, height: 820 }, { hasTouch: true, isMobile: true });
  await seed(phone);

  await check('phone: the card comes up from the bottom, answers are tapped, nothing spills', async () => {
    await footIs(phone, '4 loose lines Go through them');
    await phone.locator('#loose-foot button').tap();
    await phone.waitForSelector('.thru');
    await still(phone);
    const box = await phone.locator('.thru').boundingBox();
    assert.ok(Math.abs(box.y + box.height - 820) < 2, 'the sheet sits on the bottom edge');
    assert.equal(Math.round(box.width), 390);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
    assert.ok(await phone.locator('.thru-opt kbd').first().isHidden());
    if (SHOTS) await phone.screenshot({ path: `${SHOTS}/through-phone.png` });
    await phone.locator('.thru-opt', { hasText: 'A task for today' }).tap();
    await cardIs(phone, 'Kenji should lose');
    assert.equal((await lineNamed(phone, 'Call Dana')).fields.task.day, '2026-11-09');
    await phone.locator('.thru-stop').tap();
    await closed(phone);
    await footIs(phone, '3 loose lines Go through them');
    assert.deepEqual(phone.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nGo through: all good');
