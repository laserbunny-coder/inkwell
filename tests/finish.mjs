// Finishing a project: it's put away, not deleted. Off the Desk, the rail
// and the plan (its open tasks go with it), onto the Library's Finished
// shelf with everything still in it; reopening brings it all back. On a
// computer and on a phone.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4291;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;

// Saturday Nov 14 2026, 7:30 pm in Los Angeles.
const NOW = '2026-11-14T19:30:00-08:00';
const now = Date.parse(NOW);
const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 40 * 864e5, updated_at: now - 36e5 };
const row = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const task = (id, parent, sort, text, t = {}, done = false) => row(id, 'line', parent, sort, {
  text, content: [{ type: 'text', text }],
  fields: { done, box: true, task: { v: 1, day: null, est: null, done_at: done ? now - 864e5 : null, actual: null, log: [], run: null, order: sort, ...t } }
});
const SEED = [
  row('wd_nas', 'world', null, 1, { title: 'NAS', area_id: 'area-personal', fields: { life: true, logline: 'The home server: drives, backups, Plex.' } }),
  row('pg_drives', 'page', 'wd_nas', 1024, { title: 'Drives' }),
  row('li_d1', 'line', 'pg_drives', 1024, { text: 'Four 8 TB drives in RAID 5', content: [{ type: 'text', text: 'Four 8 TB drives in RAID 5' }] }),
  row('steps-wd_nas', 'page', 'wd_nas', 2048, { title: 'Steps' }),
  task('st_1', 'steps-wd_nas', 1024, 'Order the drives', {}, true),
  task('st_2', 'steps-wd_nas', 2048, 'Label the drives', { day: '2026-11-14', est: 15 }),
  row('wd_nb', 'world', null, 2, { title: 'The Ninja Bunch', area_id: 'area-filmmaking', fields: { shape: 'show' } }),
  row('steps-wd_nb', 'page', 'wd_nb', 2048, { title: 'Steps' }),
  task('st_nb', 'steps-wd_nb', 1024, 'Board Reel 2', { day: '2026-11-14', est: 60 }),
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

const browser = withoutSync(await chromium.launch());
async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, ...extra });
  await ctx.addInitScript(() => {
    window.__desk = { desk: async () => ({ needs: [], updates: [] }), deskAll: async () => ({ needs: [], updates: [] }), doneNeed: async () => null, laterNeed: async () => null };
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  await page.evaluate(seed, SEED);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return page;
}
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const get = async (p, id) => (await all(p)).find((r) => r.id === id);
const go = async (p, place) => { await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place); await sleep(700); };
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const shot = async (p, name) => { if (SHOTS) { await still(p); await sleep(200); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const deskText = (p) => p.locator('main.desk-home').innerText();
const todayTasks = (p) => p.locator('#plan .pl-task:not(.done) .pl-words').allInnerTexts();
const cards = async (p) => { await p.waitForSelector('#lib-zoom:not([hidden]) .zl-name'); return p.locator('#lib-zoom .zl-area .zl-name').allInnerTexts(); };
const shelf = (p) => p.locator('#lib-zoom .zl-done .zl-chip').allInnerTexts();
const nasPage = async (p) => { await go(p, { view: 'world', id: 'wd_nas' }); await p.waitForFunction(() => document.querySelector('#wh-title')?.textContent === 'NAS'); await sleep(400); };

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`); }
}

try {
  const page = await open({ width: 1440, height: 900 });

  await check('before: NAS is on the Desk, in the Library and its task is on Today', async () => {
    await go(page, { view: 'desk' });
    assert.match(await deskText(page), /NAS/);
    await go(page, { view: 'notebook', pageId: 'day-2026-11-14' });
    await page.waitForSelector('#plan .pl-task');
    assert.ok((await todayTasks(page)).includes('Label the drives'));
    await go(page, { view: 'library' });
    assert.ok((await cards(page)).includes('NAS'));
    assert.deepEqual(await shelf(page), [], 'nothing on the Finished shelf yet');
  });

  await check('⋯ > Finish project… asks once, says what happens to its open task, and nothing is deleted', async () => {
    await nasPage(page);
    await page.locator('#wh-more .more-btn').click();
    await shot(page, 'finish-1-menu');
    await page.locator('.pop-menu .pop-item', { hasText: 'Finish project…' }).click();
    await page.waitForSelector('.ask');
    assert.match(await page.locator('.ask h2').innerText(), /Finish “NAS”\?/);
    assert.match(await page.locator('.ask p').innerText(), /1 open task goes away with it and comes back if you reopen it/);
    await shot(page, 'finish-2-ask');
    await page.locator('.ask .pill', { hasText: 'Finish it' }).click();
    await sleep(600);
    const w = await get(page, 'wd_nas');
    assert.equal(typeof w.fields.finished, 'number');
    assert.ok(!w.fields.trashed && !w.deleted);
    for (const id of ['pg_drives', 'li_d1', 'st_1', 'st_2']) { const r = await get(page, id); assert.ok(r && !r.deleted && !r.fields.trashed, `${id} is still there`); }
    assert.match(await page.locator('.toast').innerText(), /“NAS” is finished/);
  });

  await check('its own page says Finished with Reopen, and still shows its steps', async () => {
    await page.evaluate(() => document.querySelector('.toast')?.remove());
    await nasPage(page);
    assert.match(await page.locator('#wh-finished').innerText(), /Finished today/);
    assert.match(await page.locator('#wh-seat').innerText(), /^finished$/i, 'it sits nowhere on the Desk');
    assert.ok(await page.locator('#wh-finished .wp-link', { hasText: 'Reopen' }).isVisible());
    assert.ok((await page.locator('#wh-steps .pl-words').allInnerTexts()).includes('Label the drives'));
    await shot(page, 'finish-3-page');
  });

  await check('after: off the Desk and Today; on the Library’s Finished shelf', async () => {
    await go(page, { view: 'desk' });
    assert.doesNotMatch(await deskText(page), /NAS/);
    await go(page, { view: 'notebook', pageId: 'day-2026-11-14' });
    await page.waitForSelector('#plan .pl-task');
    const t = await todayTasks(page);
    assert.ok(!t.includes('Label the drives') && t.includes('Board Reel 2'), t.join(', '));
    await go(page, { view: 'library' });
    assert.ok(!(await cards(page)).includes('NAS'));
    assert.deepEqual(await shelf(page), ['NAS']);
    await page.locator('#lib-zoom .zl-done').scrollIntoViewIfNeeded();
    await shot(page, 'finish-4-shelf');
  });

  await check('Ctrl + K still finds it, as a finished project', async () => {
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.palette[data-loaded]');
    await page.keyboard.type('NAS');
    await sleep(400);
    assert.match(await page.locator('.palette').innerText(), /finished project/);
    await page.keyboard.press('Escape');
  });

  await check('Reopen (shelf, then its page) brings it back everywhere, with its open task', async () => {
    await go(page, { view: 'library' });
    await page.locator('#lib-zoom .zl-done .zl-chip', { hasText: 'NAS' }).click();
    await page.waitForFunction(() => document.querySelector('#wh-title')?.textContent === 'NAS');
    await page.locator('#wh-finished .wp-link', { hasText: 'Reopen' }).click();
    await sleep(600);
    assert.equal((await get(page, 'wd_nas')).fields.finished, undefined);
    await go(page, { view: 'library' });
    assert.ok((await cards(page)).includes('NAS'));
    assert.deepEqual(await shelf(page), []);
    await go(page, { view: 'notebook', pageId: 'day-2026-11-14' });
    await page.waitForSelector('#plan .pl-task');
    assert.ok((await todayTasks(page)).includes('Label the drives'));
    await go(page, { view: 'desk' });
    assert.match(await deskText(page), /NAS/);
  });

  await check('Undo on the toast takes a finish back', async () => {
    await nasPage(page);
    await page.locator('#wh-more .more-btn').click();
    await page.locator('.pop-menu .pop-item', { hasText: 'Finish project…' }).click();
    await page.locator('.ask .pill', { hasText: 'Finish it' }).click();
    await sleep(500);
    await page.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(500);
    assert.equal((await get(page, 'wd_nas')).fields.finished, undefined);
  });
  assert.deepEqual(page.errors, []);

  const phone = await open({ width: 412, height: 915 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 });
  await check('on a phone: the same ⋯ menu finishes it, and the shelf fits the screen', async () => {
    await nasPage(phone);
    await phone.locator('#wh-more .more-btn').click();
    await phone.locator('.pop-menu .pop-item', { hasText: 'Finish project…' }).click();
    await phone.waitForSelector('.ask');
    await shot(phone, 'finish-5-phone-ask');
    await phone.locator('.ask .pill', { hasText: 'Finish it' }).click();
    await sleep(600);
    await phone.evaluate(() => document.querySelector('.toast')?.remove());
    await shot(phone, 'finish-6-phone-page');
    await go(phone, { view: 'library' });
    await phone.waitForSelector('#lib-zoom .zl-done .zl-chip');
    await phone.locator('#lib-zoom .zl-done').scrollIntoViewIfNeeded();
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(wide <= 1, `no sideways scroll (${wide}px)`);
    await shot(phone, 'finish-7-phone-shelf');
  });
  assert.deepEqual(phone.errors, []);
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
