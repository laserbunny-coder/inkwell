// First light (One thing at a time, Part 5, Nov 15 2026). The first time
// Today opens each day, Now shows today's reading before anything else: six
// chapters from four tracks that each go round by themselves. Without the ESV
// key the names link to esv.org and "I read it" moves the places; with it,
// Read here shows one chapter per screen, then "Amen. Show me the day", which
// ticks his Bible habit. "Not this morning" and a missed day move nothing.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4288;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const MON = '2026-11-16';
const TUE = '2026-11-17';
const WED = '2026-11-18';
const at = (day, s) => `${day}T${s}:00-08:00`;

const now = Date.parse(at(MON, '07:00'));
const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 20 * 864e5, updated_at: now - 2 * 36e5 };
const row = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const task = (id, parent, sort, text, t = {}) => row(id, 'line', parent, sort, {
  text, content: [{ type: 'text', text }],
  fields: { done: false, box: true, task: { v: 1, day: MON, est: null, done_at: null, actual: null, log: [], run: null, order: sort, ...t } }
});
const SEED = [
  row('page-tasks', 'page', null, 0, { title: 'Tasks' }),
  task('t_hook', 'page-tasks', 1, 'Write the two-minute hook'),
  task('t_bible', 'page-tasks', 2, 'Bible reading', { habit: true, repeat: { every: 'day', n: 1, from: MON }, did: [['2026-11-12', null, 0], ['2026-11-13', null, 0]] })
];
const CHAPTER = 'The Creation of the World\n\n[1] In the beginning, God created the heavens and the earth. [2] The earth was without form and void.\n\n  And God said,\n    “Let there be light.”\n\nScripture quotations are from the ESV® Bible, copyright © 2001 by Crossway.';

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
const reading = async (p) => (await all(p)).find((r) => r.id === 'settings-plan')?.fields?.reading;
const sheet = (p) => p.locator('#plan-sheet');
const settle = async (p) => { await sleep(400); await still(p); };
const press = async (p, key) => { await p.evaluate(() => document.activeElement?.blur?.()); await p.keyboard.press(key); await settle(p); };
const shot = async (p, name) => { if (SHOTS) { await p.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const refs = (p) => sheet(p).locator('.now-reading li').allInnerTexts();
const light = (p) => sheet(p).locator('.now-light').count();
const started = (p) => p.waitForFunction(() => document.documentElement.dataset.started === '1');
const onNow = (p) => p.waitForFunction(() => document.documentElement.dataset.view === 'plan' && document.querySelector('#plan-sheet')?.dataset.tab === 'now' && !!document.querySelector('#plan-sheet .now-view'));
async function toNow(p) { await p.evaluate(() => { history.pushState({ view: 'plan', tab: 'now' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'plan', tab: 'now' } })); }); await onNow(p); await settle(p); }
async function dayIs(p, day, time = '07:00') { await p.clock.setSystemTime(new Date(at(day, time))); await p.reload(); await started(p); await toNow(p); }

async function open(viewport, { key = false, ...extra } = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, rowDetails: false, todayNow: true, firstlight: true, ...extra });
  await ctx.addInitScript(({ key, text }) => {
    window.__asked = [];
    window.__claude = async (b) => {
      if (b?.mode !== 'esv') return { error: 'offline' };
      window.__asked.push(b.ref);
      if (!key) return { nokey: true };
      const at = text.indexOf('\n\nScripture');
      return { ref: b.ref, text: text.slice(0, at).replace('In the beginning', `${b.ref}: In the beginning`), notice: text.slice(at + 2) };
    };
    window.__calendar = async () => ({ connected: true, events: [] });
  }, { key, text: CHAPTER });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.install({ time: new Date(at(MON, '07:00')) });
  await page.goto(URL);
  await started(page);
  await page.evaluate((rows) => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const tx = r.result.transaction(['entries', 'outbox'], 'readwrite'); for (const x of rows) { tx.objectStore('entries').put(x); tx.objectStore('outbox').put({ id: x.id }); } tx.oncomplete = () => res(); }; }), SEED);
  await page.reload();
  await started(page);
  return { ctx, page };
}

try {
  // ---------- no key yet (Crossway's approval takes weeks) ----------
  const { page } = await open({ width: 1400, height: 900 });

  await check('before anything else: today’s reading, six chapters from the four tracks', async () => {
    await toNow(page);
    assert.equal(await light(page), 1);
    assert.equal(await sheet(page).locator('.now-light .now-eyebrow').innerText(), 'FIRST LIGHT');
    assert.equal(await sheet(page).locator('.now-light .now-thing').innerText(), 'Today’s reading');
    assert.deepEqual(await refs(page), ['Genesis 1', 'Genesis 2', 'Psalm 1', 'Proverbs 1', 'Matthew 1', 'Matthew 2']);
  });

  await check('no key: the names link to esv.org, no Read here, “I read it”', async () => {
    await page.waitForFunction(() => window.__asked.length > 0);
    await settle(page);
    assert.equal(await sheet(page).locator('[data-now="lread"]').count(), 0);
    assert.equal(await sheet(page).locator('[data-now="ldone"]').innerText(), 'I read it');
    const a = sheet(page).locator('.now-reading a').first();
    assert.equal(await a.getAttribute('href'), 'https://www.esv.org/Genesis+1/');
    assert.equal(await a.getAttribute('target'), '_blank');
    assert.equal(await sheet(page).locator('.now-reading a').nth(2).getAttribute('href'), 'https://www.esv.org/Psalm+1/');
    await shot(page, 'light-nokey');
  });

  await check('I read it: the places move on, the habit is ticked, the day shows', async () => {
    await press(page, 'i');
    assert.equal(await light(page), 0);
    const r = await reading(page);
    assert.equal(r.read, MON);
    assert.deepEqual([r.ot, r.ps, r.wi, r.nt], [2, 1, 1, 2]);
    const habit = (await all(page)).find((x) => x.id === 't_bible');
    assert.ok((habit.fields.task.did || []).some((d) => d[0] === MON), 'Bible habit ticked for today');
    assert.match(await page.locator('.toast').last().innerText(), /Read\. Tomorrow’s chapters are next/);
    await page.reload(); await started(page); await toNow(page);
    assert.equal(await light(page), 0, 'once a day');
  });

  await check('Not this morning (Esc) moves nothing, and a missed day changes nothing', async () => {
    await dayIs(page, TUE);
    assert.deepEqual(await refs(page), ['Genesis 3', 'Genesis 4', 'Psalm 2', 'Proverbs 2', 'Matthew 3', 'Matthew 4']);
    await press(page, 'Escape');
    assert.equal(await light(page), 0);
    assert.equal((await reading(page)).skip, TUE);
    await page.reload(); await started(page); await toNow(page);
    assert.equal(await light(page), 0);
    await dayIs(page, WED);
    assert.deepEqual((await refs(page)).slice(0, 3), ['Genesis 3', 'Genesis 4', 'Psalm 2']);
  });

  await check('the morning after a day with no mark: “I read yesterday too” marks it and moves the places', async () => {
    const before = await reading(page);
    await shot(page, 'read-yesterday');
    await sheet(page).locator('[data-now="lyest"]').click();
    await settle(page);
    const r = await reading(page);
    assert.ok(r.days.includes(TUE), 'yesterday marked');
    assert.ok(!r.days.includes(WED), 'today untouched');
    assert.deepEqual([r.ot, r.ps, r.wi, r.nt], [before.ot + 2, before.ps + 1, before.wi + 1, before.nt + 2]);
    assert.deepEqual((await refs(page)).slice(0, 3), ['Genesis 5', 'Genesis 6', 'Psalm 3']);
    assert.equal(await sheet(page).locator('[data-now="lyest"]').count(), 0, 'gone once yesterday is marked');
    assert.match(await page.locator('.toast').last().innerText(), /Yesterday is marked as read/);
    await page.locator('.toast .toast-action').click();
    await settle(page);
    assert.deepEqual(await reading(page), before);
    assert.deepEqual((await refs(page)).slice(0, 3), ['Genesis 3', 'Genesis 4', 'Psalm 2']);
  });

  await check('Set where I am: a book and a chapter per track; each goes round at its end', async () => {
    await sheet(page).locator('[data-now="lset"]').click();
    await settle(page);
    const f = sheet(page).locator('.now-tracks');
    await f.locator('select[data-trk="ot"]').selectOption({ label: '2 Kings' });
    await f.locator('input[data-trk="ot"]').fill('4');
    await f.locator('select[data-trk="wi"]').selectOption({ label: 'Ecclesiastes' });
    await f.locator('input[data-trk="wi"]').fill('12');
    await f.locator('select[data-trk="nt"]').selectOption({ label: 'Revelation' });
    await f.locator('input[data-trk="nt"]').fill('22');
    await shot(page, 'light-set');
    await sheet(page).locator('[data-now="lsetok"]').click();
    await settle(page);
    assert.deepEqual(await refs(page), ['2 Kings 4', '2 Kings 5', 'Psalm 2', 'Ecclesiastes 12', 'Revelation 22', 'Matthew 1']);
    await press(page, 'i');
    await page.evaluate(() => { window.__plan.now.light.open(); window.__plan.redraw(); });
    await settle(page);
    assert.deepEqual(await refs(page), ['2 Kings 6', '2 Kings 7', 'Psalm 3', 'Proverbs 1', 'Matthew 2', 'Matthew 3']);
    await press(page, 'Escape');
  });

  await check('the Desk: reading streak, seven days a week, and where you are in each track', async () => {
    const desk = async () => { await page.evaluate(() => { history.pushState({ view: 'today' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'today' } })); }); await page.evaluate(() => { history.pushState({ view: 'desk' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'desk' } })); }); await page.waitForSelector('.dk-reading'); await settle(page); };
    await desk();
    // Filled once from the Bible habit's history: Nov 12 and 13, then Mon and Wed.
    assert.deepEqual((await reading(page)).days, ['2026-11-12', '2026-11-13', MON, WED]);
    assert.match(await page.locator('.dk-reading .dk-label').innerText(), /^READING\s*FOUR TRACKS$/i);
    assert.equal(await page.locator('.dk-reading .tr-big').innerText(), 'Best: 2 days in a row.');
    assert.equal(await page.locator('.rd-grid g').count() >= 7, true);
    assert.equal(await page.locator('.rd-grid g[data-kind="r"]').count(), 4);
    assert.match(await page.locator('.dk-reading .tr-rd').innerText(), /^Read on 4 days in the last 12 weeks\. Tap a day in the past week to correct it\.$/);
    // Sunday is a reading day: Nov 15 shows as not read, not left out.
    assert.equal(await page.locator('.rd-grid g[data-day="2026-11-15"]').getAttribute('data-kind'), 'm');
    assert.equal(await page.locator('.rd-grid g[data-day="2026-11-15"]').getAttribute('class'), 'rd-tap');
    assert.equal(await page.locator('.rd-grid .rd-tap').count(), 7, 'only the past seven days can be changed');
    // Tap Tuesday: read, the streak joins up, the places stay.
    const places = await reading(page);
    await page.locator('.rd-grid g[data-day="2026-11-17"]').click();
    await page.waitForFunction(() => /3 days in a row/.test(document.querySelector('.dk-reading .tr-big')?.textContent || ''));
    assert.equal(await page.locator('.dk-reading .tr-big').innerText(), '3 days in a row. Your best yet.');
    const r = await reading(page);
    assert.deepEqual([r.ot, r.ps, r.wi, r.nt], [places.ot, places.ps, places.wi, places.nt]);
    assert.ok(r.days.includes('2026-11-17'));
    await shot(page, 'read-desk');
    // Tapping it again puts it back.
    await page.locator('.rd-grid g[data-day="2026-11-17"]').click();
    await page.waitForFunction(() => /^Best: 2/.test(document.querySelector('.dk-reading .tr-big')?.textContent || ''));
    assert.deepEqual((await reading(page)).days, ['2026-11-12', '2026-11-13', MON, WED]);
    // The four tracks: short words, a thin meter, times through counted.
    const words = await page.locator('.rd-track .rd-g').allInnerTexts();
    assert.deepEqual(words, ['2 Kings 6', 'Psalm 3 of 150', 'Proverbs 1 · second time through', 'Matthew 2 · second time through']);
    assert.deepEqual(await page.locator('.rd-track .rd-t').allInnerTexts(), ['Old Testament', 'Psalms', 'Wisdom', 'New Testament']);
    assert.equal(await page.locator('.rd-meter').first().getAttribute('aria-label'), 'Old Testament: chapter 319 of 736');
    // Above Training, when Training shows.
    // Each switch hides its part; both off, the block is gone.
    await page.evaluate(() => document.documentElement.classList.add('hide-readprogress'));
    await desk();
    assert.equal(await page.locator('.rd-track').count(), 0);
    assert.equal(await page.locator('.rd-grid').count(), 1);
    await page.evaluate(() => document.documentElement.classList.add('hide-readstreak'));
    await page.evaluate(() => { history.pushState({ view: 'today' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'today' } })); });
    await page.evaluate(() => { history.pushState({ view: 'desk' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'desk' } })); });
    await settle(page); await sleep(600);
    assert.equal(await page.locator('.dk-reading').count(), 0);
    await page.evaluate(() => document.documentElement.classList.remove('hide-readprogress', 'hide-readstreak'));
    await toNow(page);
  });

  await check('with the switch off, nothing before the day', async () => {
    await page.evaluate(() => { const h = JSON.parse(localStorage.getItem('hide') || '[]'); h.push('firstlight'); localStorage.setItem('hide', JSON.stringify(h)); });
    await dayIs(page, '2026-11-19');
    assert.equal(await light(page), 0);
  });
  assert.deepEqual(page.errors, []);

  // ---------- with the key ----------
  const { page: k } = await open({ width: 1400, height: 900 }, { key: true });
  await check('with the key: Read here, one chapter per screen in the reading face', async () => {
    await toNow(k);
    await k.waitForFunction(() => !!document.querySelector('[data-now="lread"]'));
    assert.equal(await sheet(k).locator('[data-now="ldone"]').innerText(), 'I read it on paper');
    assert.equal(await sheet(k).locator('.now-reading a').count(), 0);
    await shot(k, 'light-list');
    await press(k, 'r');
    await k.waitForSelector('.now-scripture .sc-p');
    assert.equal(await sheet(k).locator('.now-light .now-eyebrow').innerText(), 'FIRST LIGHT · 1 OF 6');
    assert.equal(await sheet(k).locator('.now-light .now-thing').innerText(), 'Genesis 1');
    assert.equal(await sheet(k).locator('.sc-h').first().innerText(), 'The Creation of the World');
    assert.equal(await sheet(k).locator('.sc-v').first().innerText(), '1');
    assert.match(await sheet(k).locator('.now-esv').innerText(), /Scripture quotations are from the ESV® Bible[\s\S]*ESV · www\.esv\.org/);
    assert.equal(await sheet(k).locator('.now-esv a').getAttribute('href'), 'https://www.esv.org/');
    assert.equal(await k.locator('.now-out').count(), 0, 'nothing else on the screen');
    await shot(k, 'light-read');
  });

  await check('Next chapter, Back, then “Amen. Show me the day”', async () => {
    await press(k, 'ArrowRight');
    await k.waitForFunction(() => /Genesis 2: In the beginning/.test(document.querySelector('.now-scripture')?.innerText || ''));
    await sheet(k).locator('[data-now="lback"]').click();
    await settle(k);
    assert.equal(await sheet(k).locator('.now-light .now-thing').innerText(), 'Genesis 1');
    for (let n = 0; n < 5; n++) { await press(k, 'ArrowRight'); }
    assert.equal(await sheet(k).locator('.now-light .now-thing').innerText(), 'Matthew 2');
    assert.equal(await sheet(k).locator('[data-now="ldone"]').innerText(), 'Amen. Show me the day');
    const kept = await k.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('firstLight')).ch));
    assert.equal(kept.length, 6, 'today’s chapters kept on the device');
    // Two days already read: after Amen, one quiet line on the next screen.
    await k.evaluate(() => { window.__plan.now.light.st.days = ['2026-11-14', '2026-11-15']; });
    await sheet(k).locator('[data-now="ldone"]').click();
    await settle(k);
    assert.equal(await light(k), 0);
    assert.equal((await reading(k)).read, MON);
    assert.equal(await sheet(k).locator('.now-rnote').innerText(), 'Reading done. 3 days in a row.');
    await shot(k, 'read-done');
  });

  await check('the next day, yesterday’s chapters are dropped', async () => {
    await dayIs(k, TUE);
    await k.waitForFunction(() => !!document.querySelector('[data-now="lread"]'));
    const s = await k.evaluate(() => JSON.parse(localStorage.getItem('firstLight')));
    assert.equal(s.day, TUE);
    assert.deepEqual(Object.keys(s.ch), ['Genesis 3']);
  });
  assert.deepEqual(k.errors, []);

  // ---------- the phone ----------
  const { page: phone } = await open({ width: 412, height: 915 }, { key: true, hasTouch: true, isMobile: true });
  await check('phone: the list and a chapter fit, nothing spills', async () => {
    await toNow(phone);
    await phone.waitForFunction(() => !!document.querySelector('[data-now="lread"]'));
    assert.equal(await phone.evaluate(() => document.scrollingElement.scrollWidth <= 412), true);
    await shot(phone, 'phone-light');
    await sheet(phone).locator('[data-now="lread"]').tap();
    await phone.waitForSelector('.now-scripture .sc-p');
    assert.equal(await phone.evaluate(() => document.scrollingElement.scrollWidth <= 412), true);
    await shot(phone, 'phone-light-read');
  });

  await check('phone: the reading block fits, one line per track', async () => {
    await phone.evaluate(() => { window.__plan.now.light.st.days = []; });
    const fresh = row('settings-plan', 'settings', null, 0, { title: 'Plan' });
    await phone.evaluate(async (fresh) => { const r = indexedDB.open('writing'); await new Promise((res) => { r.onsuccess = () => { const tx = r.result.transaction(['entries'], 'readwrite'); const os = tx.objectStore('entries'); const g = os.get('settings-plan'); g.onsuccess = () => { const row = g.result || fresh; row.fields = { ...row.fields, reading: { ...(row.fields.reading || {}), filled: true, days: ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'], rounds: { wi: 1 }, wi: 30, ot: 120 } }; os.put(row); }; tx.oncomplete = res; }; }); }, fresh);
    await phone.evaluate(() => { history.pushState({ view: 'desk' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'desk' } })); });
    await phone.waitForSelector('.dk-reading .rd-track');
    await phone.locator('.dk-reading').scrollIntoViewIfNeeded();
    await settle(phone);
    assert.equal(await phone.evaluate(() => document.scrollingElement.scrollWidth <= 412), true, 'no sideways scroll');
    const hs = await phone.locator('.rd-line').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    assert.ok(hs.every((h) => h < 40), `one line each: ${hs}`);
    assert.equal(await phone.locator('.rd-track[data-track="wi"] .rd-g').innerText(), 'Proverbs 31 · second time through');
    await phone.locator('.dk-reading').evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await settle(phone);
    await shot(phone, 'phone-read-desk');
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
