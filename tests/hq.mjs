// Acro HQ tasks in Inkwell: a task kept in step with the board shows an HQ
// link to its card; Nate's show on the project's steps with his name and stay
// off your day; "Hand to Nate" gives one of yours to him.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4276;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const NOW = '2026-11-09T14:04:00-08:00';
const now = Date.parse(NOW);
const HQ = 'https://acro-hq.laserbunny.workers.dev';

const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 20 * 864e5, updated_at: now - 2 * 36e5 };
const row = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const task = (id, sort, text, t = {}, hq = null) => row(id, 'line', 'steps-wd_acro', sort, {
  text, content: [{ type: 'text', text }],
  fields: { done: false, box: true, by: 'hq', task: { v: 1, day: '2026-11-09', est: null, done_at: null, actual: null, log: [], run: null, order: sort, ...t }, ...(hq ? { hq: { id: hq, link: `${HQ}/?task=${hq}`, due: '' } } : {}) }
});
const SEED = [
  row('wd_acro', 'world', null, 1, { title: 'Acro HQ', area_id: 'area-business', fields: { life: true } }),
  row('steps-wd_acro', 'page', 'wd_acro', 2048, { title: 'Steps' }),
  task('li_q', 1024, 'QuickBooks catch-up', { est: 45 }, 't1'),
  task('li_n', 2048, 'Film the class promo', { owner: 'Nate' }, 't2'),
];
const seed = (rows) => new Promise((res, rej) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => {
    const tx = r.result.transaction(['entries', 'outbox'], 'readwrite');
    for (const x of rows) { tx.objectStore('entries').put(x); tx.objectStore('outbox').put({ id: x.id }); }
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  };
});
const get = (p, id) => p.evaluate((id) => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').get(id); q.onsuccess = () => res(q.result); };
}), id);
const go = (p, place) => p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 4).join('\n     ')}`); }
}

const browser = withoutSync(await chromium.launch());
try {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  await page.evaluate(seed, SEED);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');

  await check('on your day: your HQ task with a link to its card; Nate’s isn’t there', async () => {
    await page.evaluate(() => document.querySelector('#view-toggle').click());
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    await page.waitForFunction(() => document.querySelectorAll('#plan .pl-task').length >= 1);
    await still(page);
    const words = await page.locator('#plan .pl-task .pl-words').allInnerTexts();
    assert.deepEqual(words, ['QuickBooks catch-up']);
    const a = page.locator('#plan .pl-task', { hasText: 'QuickBooks' }).locator('a.pl-hq');
    assert.equal(await a.getAttribute('href'), `${HQ}/?task=t1`);
    assert.equal(await a.getAttribute('target'), '_blank');
  });

  await check('on the project’s page: Nate’s step shows with his name', async () => {
    await go(page, { view: 'world', id: 'wd_acro' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'world' && document.querySelectorAll('#wh-steps .pl-task').length >= 1);
    await still(page);
    const nate = page.locator('#wh-steps .pl-task', { hasText: 'Film the class promo' });
    assert.equal(await nate.count(), 1, 'planning views show everyone’s');
    assert.equal(await nate.locator('.pl-owner').innerText(), 'Nate');
  });

  await check('“Hand to Nate” gives it to him and it leaves your day; “Make it mine” takes it back', async () => {
    await page.evaluate(() => document.querySelector('#view-toggle').click());
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    await page.waitForFunction(() => document.querySelectorAll('#plan .pl-task').length >= 1);
    await page.locator('#plan .pl-task', { hasText: 'QuickBooks' }).click({ button: 'right' });
    await page.locator('.pop-menu .pop-item', { hasText: 'Hand to Nate' }).first().click();
    await sleep(500);
    assert.equal((await get(page, 'li_q')).fields.task.owner, 'Nate');
    await page.waitForFunction(() => ![...document.querySelectorAll('#plan .pl-task .pl-words')].some((x) => x.textContent === 'QuickBooks catch-up'));
    await go(page, { view: 'world', id: 'wd_acro' });
    await page.waitForFunction(() => [...document.querySelectorAll('#wh-steps .pl-task')].some((x) => /QuickBooks/.test(x.textContent)));
    await page.locator('#wh-steps .pl-task', { hasText: 'QuickBooks' }).click({ button: 'right' });
    await page.locator('.pop-menu .pop-item', { hasText: 'Make it mine' }).first().click();
    await sleep(500);
    assert.equal((await get(page, 'li_q')).fields.task.owner, null);
    assert.deepEqual(page.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nAcro HQ tasks: all good');
