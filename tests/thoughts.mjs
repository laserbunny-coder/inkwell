// Out of your head (One thing at a time, Part 3, Nov 15 2026). One line at
// the bottom of Now: a thought goes on today's page with the time, in his
// words, and he stays on the one thing. Claude files it afterwards (Drawer,
// Not planned, Workshop, To look up) with a quiet note on the line; a plain
// instruction about today changes the plan instead, with Undo. "Keep it on
// the page" files a brain dump the same way.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4284;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const TODAY = '2026-11-16';
const at = (s) => `${TODAY}T${s}:00-08:00`;

const now = Date.parse(at('09:00'));
const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 20 * 864e5, updated_at: now - 2 * 36e5 };
const row = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const task = (id, parent, sort, text, t = {}) => row(id, 'line', parent, sort, {
  text, content: [{ type: 'text', text }],
  fields: { done: false, box: true, task: { v: 1, day: TODAY, est: null, done_at: null, actual: null, log: [], run: null, order: sort, ...t } }
});
const SEED = [
  row('page-tasks', 'page', null, 0, { title: 'Tasks' }),
  task('t_hook', 'page-tasks', 1, 'Write the two-minute hook'),
  task('t_nate', 'page-tasks', 2, 'Reply to Nate'),
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

// What Claude says about each thought.
const ANSWERS = {
  'Kenji sings about the dentist': { kind: 'file', places: [{ where: 'drawer', text: '' }], moves: [], said: 'Filed in the Drawer' },
  'Renew the passport next month': { kind: 'file', places: [{ where: 'later', text: 'Renew the passport' }], moves: [], said: 'Waits under Not planned' },
  'An app that reads scripts aloud': { kind: 'file', places: [{ where: 'workshop', text: '' }, { where: 'lookup', text: '' }], moves: [], said: 'In the Workshop' },
  'Feeling good about today': { kind: 'none', places: [], moves: [], said: '' },
  'put reply to nate first': { kind: 'plan', places: [], moves: [{ type: 'first', task: 't_nate', text: '', first: false }], said: 'Put “Reply to Nate” first' },
  'add call the passport office': { kind: 'plan', places: [], moves: [{ type: 'add_today', task: '', text: 'Call the passport office', first: false }], said: 'Added “Call the passport office” to today' },
  'A heist where the vault is a bakery': { kind: 'file', places: [{ where: 'drawer', text: '' }], moves: [], said: '' },
};

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
const onNow = (p) => p.waitForFunction(() => document.documentElement.dataset.view === 'plan' && document.querySelector('#plan-sheet')?.dataset.tab === 'now' && !!document.querySelector('#plan-sheet .now-view'));
const thing = (p) => p.locator('#plan-sheet .np-tx').first().innerText();
const go = async (p, place) => { await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place); await p.waitForFunction((pl) => document.documentElement.dataset.view === pl.view, place); await settle(p); };
const toNow = async (p) => { await go(p, { view: 'plan', tab: 'now' }); await onNow(p); };
const toPage = (p) => go(p, { view: 'notebook', pageId: `day-${TODAY}` });
const settle = async (p) => { await sleep(400); await still(p); };
const press = async (p, key) => { await p.evaluate(() => document.activeElement?.blur?.()); await p.keyboard.press(key); await settle(p); };
const line = async (p, words) => (await all(p)).find((r) => r.kind === 'line' && r.parent_id === `day-${TODAY}` && r.fields?.thought && (r.fields.thought.words === words));
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(100); } return v; };
// Out of your head: Alt + J opens a small box from anywhere (the zoom).
const think = async (p, words) => { await p.keyboard.press('Alt+J'); const i = p.locator('#zm-thought-in'); await i.waitFor(); await i.fill(words); await i.press('Enter'); await settle(p); };
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, rowDetails: false, todayNow: true, ...extra });
  const asked = [];
  await ctx.exposeFunction('__toClaude', (body) => { asked.push(body); return ANSWERS[body.text] || { kind: 'none', places: [], moves: [], said: '' }; });
  await ctx.addInitScript(() => { window.__claude = (body) => window.__toClaude(body); window.__calendar = async () => ({ connected: true, events: [] }); });
  const page = await ctx.newPage();
  page.errors = [];
  page.asked = asked;
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.install({ time: new Date(at('09:04')) });
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  await page.evaluate(seed, SEED);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return { ctx, page };
}

try {
  const { page } = await open({ width: 1400, height: 900 });

  await check('Alt + J: a small box to get it out of your head, and the mic', async () => {
    await toNow(page);
    assert.equal(await thing(page), 'Write the two-minute hook');
    await page.keyboard.press('Alt+J');
    assert.equal(await page.locator('#zm-thought-in').getAttribute('placeholder'), 'Get it out of your head');
    assert.equal(await page.locator('.zm-mic').isVisible(), true);
    await shot(page, 'out-line');
    await page.locator('#zm-thought-in').press('Escape');
    assert.equal(await page.locator('.zm-thought').isHidden(), true, 'Esc closes it');
    assert.equal(await page.evaluate(() => document.querySelector('#plan-sheet').dataset.tab), 'now', 'and stays on Now');
  });

  await check('a thought goes on today’s page with the time, in his words, and Now stays', async () => {
    await think(page, 'Kenji sings about the dentist');
    assert.equal(await thing(page), 'Write the two-minute hook');
    assert.equal(await page.evaluate(() => document.querySelector('#plan-sheet').dataset.tab), 'now');
    const l = await until(() => line(page, 'Kenji sings about the dentist'));
    assert.equal(l.text, '9:04 am Kenji sings about the dentist');
    assert.equal(await page.locator('.zm-thought').isHidden(), true, 'the box goes');
  });

  await check('filed afterwards: a copy in the Drawer, the line unchanged, and a quiet note', async () => {
    const l = await until(async () => { const x = await line(page, 'Kenji sings about the dentist'); return x?.fields.thought.state === 'filed' ? x : null; });
    assert.deepEqual(l.fields.thought.to, ['drawer']);
    assert.equal(l.text, '9:04 am Kenji sings about the dentist', 'his words are untouched');
    const copy = (await all(page)).find((r) => r.id === l.fields.thought.copies[0]);
    assert.equal(copy.parent_id, 'pg_filed-thoughts');
    assert.ok(copy.tags.includes('drawer'));
    assert.match(copy.text, /^Kenji sings about the dentist /);
    const asked = page.asked.find((b) => b.text === 'Kenji sings about the dentist');
    assert.equal(asked.mode, 'thought');
    assert.deepEqual(asked.plan.map((t) => t.id), ['t_hook', 't_nate']);
  });

  await check('a task for another day waits under Not planned; app ideas go to the Workshop and To look up', async () => {
    await think(page, 'Renew the passport next month');
    await think(page, 'An app that reads scripts aloud');
    await think(page, 'Feeling good about today');
    const later = await until(async () => (await all(page)).find((r) => r.text === 'Renew the passport' && r.fields?.task));
    assert.equal(later.fields.task.day, null);
    const app = await until(async () => { const x = await line(page, 'An app that reads scripts aloud'); return x?.fields.thought.state === 'filed' ? x : null; });
    assert.deepEqual(app.fields.thought.to, ['workshop', 'lookup']);
    const kept = await until(async () => { const x = await line(page, 'Feeling good about today'); return x?.fields.thought.state === 'kept' ? x : null; });
    assert.ok(kept, 'a passing note just stays on the page');
  });

  await check('on today’s page: “Filed under …” after the line (Look switch), and nothing loose', async () => {
    await toPage(page);
    const notes = await page.locator('#outline-editor .thought-note').allInnerTexts();
    assert.deepEqual(notes, ['Filed under the Drawer', 'Filed under Not planned', 'Filed under the Workshop and To look up']);
    assert.equal(await page.locator('#outline-editor .is-loose').count(), 0);
    await shot(page, 'filed-notes');
    await page.evaluate(() => { const h = JSON.parse(localStorage.getItem('hide') || '[]'); h.push('nowfiled'); localStorage.setItem('hide', JSON.stringify(h)); document.documentElement.classList.add('hide-nowfiled'); });
    assert.equal(await page.locator('#outline-editor .thought-note').first().isVisible(), false);
    await page.evaluate(() => { localStorage.setItem('hide', JSON.stringify(JSON.parse(localStorage.getItem('hide')).filter((x) => x !== 'nowfiled'))); document.documentElement.classList.remove('hide-nowfiled'); });
  });

  await check('an instruction about today changes the plan instead, with Undo, and nothing stays on the page', async () => {
    await toNow(page);
    await think(page, 'put reply to nate first');
    const moved = await until(async () => { const r = (await all(page)).find((x) => x.id === 't_nate'); return r.fields.task.order < 1 ? r : null; });
    assert.ok(moved, 'Reply to Nate goes first');
    const gone = await until(async () => (await all(page)).find((r) => r.fields?.thought?.words === 'put reply to nate first' && r.deleted));
    assert.ok(gone, 'the line comes off the page');
    assert.match(await page.locator('.toast').last().innerText(), /Put “Reply to Nate” first/);
    await shot(page, 'plan-toast');
    await page.locator('.toast button', { hasText: 'Undo' }).last().click();
    await settle(page);
    const back = (await all(page)).find((x) => x.id === 't_nate');
    assert.equal(back.fields.task.order, 2);
    assert.equal((await all(page)).find((r) => r.id === gone.id).deleted, false, 'Undo puts the line back too');
  });

  await check('“add …” puts a new task on today', async () => {
    await think(page, 'add call the passport office');
    const t = await until(async () => (await all(page)).find((r) => r.text === 'Call the passport office' && r.fields?.task && !r.deleted));
    assert.equal(t.fields.task.day, TODAY);
  });

  await check('Keep it on the page: a brain dump’s loose lines are filed, and stay on the page', async () => {
    await page.evaluate(seed, [row('li_dump', 'line', `day-${TODAY}`, 9e6, { text: 'A heist where the vault is a bakery', content: [{ type: 'text', text: 'A heist where the vault is a bakery' }], fields: { done: false, gather: null, gathered: null, mirror: null } })]);
    await toPage(page);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await toPage(page);
    await page.waitForSelector('#loose-foot .loose-keep');
    await shot(page, 'keep-on-page');
    await page.locator('#loose-foot .loose-keep').click();
    const l = await until(async () => { const r = (await all(page)).find((x) => x.id === 'li_dump'); return r.fields?.thought?.state === 'filed' ? r : null; });
    assert.deepEqual(l.fields.thought.to, ['drawer']);
    assert.equal(l.text, 'A heist where the vault is a bakery');
    assert.equal(l.deleted, false);
    assert.equal(page.asked.find((b) => b.text === 'A heist where the vault is a bakery').dump, true);
  });

  await check('the mic opens Capture, and Now stays behind it', async () => {
    await toNow(page);
    await page.locator('.zm-mic').click();
    await page.waitForFunction(() => !document.querySelector('.capture')?.hidden);
    await page.keyboard.press('Escape');
    await settle(page);
    assert.equal(await page.evaluate(() => document.querySelector('#plan-sheet').dataset.tab), 'now');
  });

  await check('the new switches are in All commands', async () => {
    await page.keyboard.press('Control+k');
    await page.waitForFunction(() => !document.querySelector('.palette')?.hidden);
    for (const q of ['Show or hide the line to get it out of your head', 'Show or hide where a thought was filed']) {
      await page.locator('.palette input').fill(q);
      await sleep(250);
      assert.ok(await page.locator('.palette li', { hasText: q }).count() > 0, q);
    }
    await page.keyboard.press('Escape');
  });
  assert.deepEqual(page.errors, []);

  // ---------- the phone ----------
  const { page: phone } = await open({ width: 412, height: 915 }, { hasTouch: true, isMobile: true });
  await check('phone: the mic sized for a thumb, and the thought box from Ctrl + K', async () => {
    await toNow(phone);
    const mic = await phone.locator('.zm-mic').boundingBox();
    assert.ok(mic.height >= 40, `mic ${mic.height}`);
    await phone.keyboard.press('Control+k');
    await phone.locator('.palette input').fill('Get it out of your head');
    await phone.locator('.palette li', { hasText: 'Get it out of your head' }).first().tap();
    const i = phone.locator('#zm-thought-in');
    await i.waitFor();
    await i.fill('Kenji sings about the dentist');
    await shot(phone, 'phone-out');
    await i.press('Enter');
    await settle(phone);
    assert.equal(await thing(phone), 'Write the two-minute hook');
    const l = await until(async () => { const x = await line(phone, 'Kenji sings about the dentist'); return x?.fields.thought.state === 'filed' ? x : null; });
    assert.ok(l);
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
