// Into the work and back (One thing at a time, Part 2, Nov 15 2026). Under the
// one thing, a faint line names where it lives and opens it (Enter or O).
// Away from Today a thin strip keeps the one thing in view: its name (back to
// Now), Done and Not now. In a draft only the text shows unless the Look says
// a dot or the strip; in Focus nothing; five minutes before a calendar event
// its name reaches the draft too.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4283;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const TODAY = '2026-11-16';
const at = (s) => `${TODAY}T${s}:00-08:00`;
const EVENTS = [{ id: 'c1:lesson', title: 'Private lesson', start: at('15:00'), end: at('16:00'), allDay: false, calendar: 'Acro' }];

const now = Date.parse(at('09:00'));
const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 20 * 864e5, updated_at: now - 2 * 36e5 };
const row = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const task = (id, parent, sort, text, content, t = {}) => row(id, 'line', parent, sort, {
  text, content: content || [{ type: 'text', text }],
  fields: { done: false, box: true, task: { v: 1, day: TODAY, est: null, done_at: null, actual: null, log: [], run: null, order: sort, ...t } }
});
const SEED = [
  row('wd_nb', 'world', null, 1, { title: 'The Ninja Bunch', area_id: 'area-filmmaking', fields: { shape: 'show' } }),
  row('pr_hook', 'project', 'wd_nb', 1, { title: 'Reel 5', fields: { type: 'screenplay', stage: 'Writing', label: 'Reel' } }),
  row('ac_h', 'act', 'pr_hook', 1, { title: 'Screenplay' }),
  row('ch_hook', 'chapter', 'ac_h', 1, { title: 'Two-minute hook', fields: { words: 9 } }),
  row('pb_h', 'para', 'ch_hook', 1024, { text: 'Mom flips pancakes with a katana.', content: [{ type: 'text', text: 'Mom flips pancakes with a katana.' }], fields: { el: 'action' } }),
  row('pg_notes', 'page', 'wd_nb', 2, { title: 'Hook notes' }),
  row('page-tasks', 'page', null, 0, { title: 'Tasks' }),
  // Written on the world's notes page, linking to the script it's about.
  task('t_hook', 'pg_notes', 1024, 'Write the two-minute hook', [{ type: 'text', text: 'Write the ' }, { type: 'entryRef', attrs: { id: 'ch_hook', title: 'Two-minute hook' } }]),
  // Written on the world's notes page, with no link: it opens there.
  task('t_names', 'pg_notes', 2048, 'Name the three ninjas'),
  // On the Tasks page: nowhere to go.
  task('t_nate', 'page-tasks', 3072, 'Reply to Nate')
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
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const pointer = async (p) => (await all(p)).find((r) => r.id === 'settings-plan')?.fields?.now || null;
const onNow = (p) => p.waitForFunction(() => document.documentElement.dataset.view === 'plan' && document.querySelector('#plan-sheet')?.dataset.tab === 'now' && !!document.querySelector('#plan-sheet .now-view'));
const thing = (p) => p.locator('#plan-sheet .now-thing').first().innerText();
const settle = async (p) => { await sleep(400); await still(p); };
const press = async (p, key) => { await p.evaluate(() => document.activeElement?.blur?.()); await p.keyboard.press(key); await settle(p); };
const strip = (p) => p.evaluate(() => { const s = document.querySelector('.now-strip'); return s && !s.hidden ? { kind: [...s.classList].find((c) => c.startsWith('ns-k-'))?.slice(5), text: s.innerText.replace(/\s+/g, ' ').trim(), top: s.getBoundingClientRect().top, bottom: s.getBoundingClientRect().bottom } : null; });
// The strip as it settles (it redraws a moment after a change).
const stripNow = async (p, kind) => {
  for (let i = 0; i < 30; i++) { const s = await strip(p); if ((s?.kind || null) === kind) return s; await sleep(100); }
  return strip(p);
};
const setHide = (p, id, off) => p.evaluate(([id, off]) => {
  const h = new Set(JSON.parse(localStorage.getItem('hide') || '[]'));
  if (off) h.add(id); else h.delete(id);
  localStorage.setItem('hide', JSON.stringify([...h]));
  document.documentElement.classList.toggle(`hide-${id}`, off);
  document.dispatchEvent(new CustomEvent('inkwell:now'));
}, [id, off]);
const setWrite = (p, v) => p.evaluate((v) => { localStorage.setItem('nowWrite', v); document.dispatchEvent(new CustomEvent('inkwell:now')); }, v);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const inDraft = (p) => p.waitForFunction(() => !document.documentElement.dataset.view && /katana/.test(document.querySelector('#editor')?.innerText || ''));

async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, rowDetails: false, todayNow: true, ...extra });
  await ctx.addInitScript((events) => { window.__calendar = async () => ({ connected: true, events }); }, EVENTS);
  const page = await ctx.newPage();
  page.errors = [];
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

  await check('under the one thing, one faint line names where it lives', async () => {
    await page.evaluate(() => document.querySelector('#view-toggle').click());
    await onNow(page);
    await settle(page);
    await press(page, 'b');
    assert.equal(await thing(page), 'Write the two-minute hook');
    assert.equal((await page.locator('#plan-sheet .now-where').innerText()).replace(/\s+/g, ' ').trim(), 'The Ninja Bunch · Two-minute hook ›');
    assert.equal(await stripNow(page, null), null, 'no strip on Today');
    await shot(page, 'where-line');
  });

  await check('O opens it: the script, with only the text (no strip, no dot)', async () => {
    await press(page, 'o');
    await inDraft(page);
    await settle(page);
    assert.equal(await stripNow(page, null), null);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('has-nowstrip')), false);
    await shot(page, 'draft-nothing');
  });

  await check('away from Today (the Desk), the strip: the name, Done and Not now, under the top bar', async () => {
    await page.evaluate(() => document.querySelector('#desk-toggle').click());
    await page.waitForFunction(() => document.documentElement.dataset.view === 'desk');
    await settle(page);
    const s = await stripNow(page, 'strip');
    assert.equal(s?.kind, 'strip');
    assert.equal(s.text, 'Write the two-minute hook Done Not now');
    const bar = await page.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().bottom);
    assert.ok(Math.abs(s.top - bar) <= 1, `under the top bar (${s.top} vs ${bar})`);
    await shot(page, 'strip-desk');
  });

  await check('the strip’s name goes back to Now', async () => {
    await page.locator('.now-strip .ns-name').click();
    await onNow(page);
    await settle(page);
    assert.equal(await thing(page), 'Write the two-minute hook');
    assert.equal(await stripNow(page, null), null);
  });

  await check('Enter opens it too; in a draft “A small dot” shows a dot that opens the strip', async () => {
    await press(page, 'Enter');
    await inDraft(page);
    await setWrite(page, 'dot');
    await settle(page);
    assert.equal((await stripNow(page, 'dot'))?.kind, 'dot');
    await shot(page, 'draft-dot');
    await page.locator('.now-strip .ns-dot').click();
    await settle(page);
    assert.equal((await stripNow(page, 'strip'))?.kind, 'strip');
    await shot(page, 'draft-dot-open');
  });

  await check('“The strip” stays in a draft; Focus shows nothing whatever the choice', async () => {
    await setWrite(page, 'strip');
    await settle(page);
    assert.equal((await stripNow(page, 'strip'))?.kind, 'strip');
    await page.keyboard.press('Control+.');
    await page.waitForFunction(() => document.documentElement.classList.contains('focus'));
    await settle(page);
    assert.equal(await stripNow(page, null), null);
    await page.keyboard.press('Control+.');
    await page.waitForFunction(() => !document.documentElement.classList.contains('focus'));
    await setWrite(page, 'none');
    await settle(page);
    assert.equal(await stripNow(page, null), null);
  });

  await check('five minutes before a calendar event its name reaches the draft, also in Focus', async () => {
    await page.clock.setSystemTime(new Date(at('14:56')));
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('inkwell:now')));
    await settle(page);
    const s = await stripNow(page, 'event');
    assert.equal(s?.kind, 'event');
    assert.equal(s.text, 'Private lesson, in 4 minutes');
    await shot(page, 'draft-event');
    await page.keyboard.press('Control+.');
    await page.waitForFunction(() => document.documentElement.classList.contains('focus'));
    await settle(page);
    assert.equal((await stripNow(page, 'event'))?.kind, 'event', 'Focus follows the same switch');
    await setHide(page, 'nowevents', true);
    await settle(page);
    assert.equal(await stripNow(page, null), null, 'switched off: nothing');
    await page.keyboard.press('Control+.');
    await page.waitForFunction(() => !document.documentElement.classList.contains('focus'));
    await setHide(page, 'nowevents', false);
    await page.clock.setSystemTime(new Date(at('18:30')));
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('inkwell:now')));
    await settle(page);
    assert.equal(await stripNow(page, null), null, 'after the event, only the text again');
  });

  await check('the strip’s Done marks it done and goes to Now’s gate', async () => {
    await page.evaluate(() => document.querySelector('#library-toggle').click());
    await page.waitForFunction(() => document.documentElement.dataset.view === 'library');
    await settle(page);
    await page.locator('.now-strip [data-ns="done"]').click();
    await onNow(page);
    await settle(page);
    assert.equal((await all(page)).find((r) => r.id === 't_hook').fields.done, true);
    assert.match(await page.locator('#plan-sheet .now-was').innerText(), /Write the two-minute hook\s+Done\./);
    assert.equal((await pointer(page)).task, null);
  });

  await check('a task written on a page opens there; one on the Tasks page has no line', async () => {
    await press(page, 'b');
    assert.equal(await thing(page), 'Name the three ninjas');
    assert.equal((await page.locator('#plan-sheet .now-where').innerText()).replace(/\s+/g, ' ').trim(), 'The Ninja Bunch · Hook notes ›');
    await page.locator('#plan-sheet .now-where').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook' && /Hook notes/.test(document.querySelector('#nb-title')?.textContent || ''));
    await settle(page);
    assert.equal((await stripNow(page, 'strip'))?.kind, 'strip', 'a page is not a draft: the strip shows');
  });

  await check('the strip’s Not now opens Now with its three choices', async () => {
    await page.locator('.now-strip [data-ns="notnow"]').click();
    await onNow(page);
    await settle(page);
    assert.equal(await page.locator('#plan-sheet .now-choice').count(), 3);
    await press(page, '3');
    await press(page, 'b');
    assert.equal(await thing(page), 'Reply to Nate');
    assert.equal(await page.locator('#plan-sheet .now-where').count(), 0);
  });

  await check('Look: the strip that travels, off: nothing away from Today', async () => {
    await page.evaluate(() => document.querySelector('#desk-toggle').click());
    await page.waitForFunction(() => document.documentElement.dataset.view === 'desk');
    await settle(page);
    assert.equal((await stripNow(page, 'strip'))?.kind, 'strip');
    await setHide(page, 'nowstrip', true);
    await settle(page);
    assert.equal(await stripNow(page, null), null);
    await setHide(page, 'nowstrip', false);
  });

  await check('the new switches are in the Show tab and in All commands', async () => {
    await page.keyboard.press('Control+k');
    await page.waitForFunction(() => !document.querySelector('.palette')?.hidden);
    for (const q of ['While you write a draft, show: A small dot', 'Show or hide the strip that travels', 'Show or hide fixed times while you write', 'Show or hide where the one thing lives']) {
      await page.locator('.palette input').fill(q);
      await sleep(250);
      assert.ok(await page.locator('.palette li', { hasText: q }).count() > 0, q);
    }
    await page.keyboard.press('Escape');
  });

  assert.deepEqual(page.errors, []);

  // ---------- the phone ----------
  const { page: phone } = await open({ width: 412, height: 915 }, { hasTouch: true, isMobile: true });
  await check('phone: the strip at the top, the bottom still one thing only', async () => {
    await phone.evaluate(() => document.querySelector('#view-toggle').click());
    await onNow(phone);
    await settle(phone);
    await phone.locator('#plan-sheet .now-btn.go').tap();
    await settle(phone);
    assert.equal(await thing(phone), 'Write the two-minute hook');
    await shot(phone, 'phone-where');
    await phone.evaluate(() => document.querySelector('#desk-toggle').click());
    await phone.waitForFunction(() => document.documentElement.dataset.view === 'desk');
    await settle(phone);
    const s = await stripNow(phone, 'strip');
    assert.equal(s?.kind, 'strip');
    assert.ok(s.top < 120, `at the top (${s.top})`);
    const h = await phone.evaluate(() => [...document.querySelectorAll('.now-strip button')].map((b) => b.getBoundingClientRect().height));
    assert.ok(h.every((x) => x >= 36), `big enough for a thumb (${h})`);
    await shot(phone, 'phone-strip');
    await phone.locator('.now-strip .ns-name').tap();
    await onNow(phone);
    await phone.locator('#plan-sheet .now-where').tap();
    await inDraft(phone);
    await settle(phone);
    assert.equal(await stripNow(phone, null), null, 'in the script: only the text');
    await shot(phone, 'phone-draft');
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
