// One home (Nov 20 2026), Part 1: a piece has no second home. Inside a
// script the top reads ‹ <project>, then Outline · Write · Grid; the Outline
// opens with the piece's label, name, stage, "→ next" and its sentence; no
// way is left to land on an Overview for a script; Alt + 0 is the project
// page from inside the piece; the ⋯ menu leads to the piece's places.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4231;
const server = await serve(PORT);
const SHOTS = process.env.SHOTS || '';

const table = new Map();
let clock = Date.parse('2026-11-20T00:00:00Z');
const tick = () => new Date((clock += 1000)).toISOString();
function remote(op, arg) {
  if (op === 'push') {
    const stamp = tick();
    return arg.map((r) => { table.set(r.id, { ...r, user_id: 'u1', updated_at: stamp }); return { id: r.id, updated_at: stamp }; });
  }
  if (op === 'pull') {
    return [...table.values()].filter((r) => r.updated_at > arg.since)
      .sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : 1))
      .slice(arg.from, arg.from + 500);
  }
}
const fake = () => {
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: (rows) => window.__remote('push', rows),
    pull: (since, from) => window.__remote('pull', { since, from }),
    subscribe() {}, unsubscribe() {}
  };
};
const put = (r) => {
  const at = tick();
  table.set(r.id, { parent_id: null, sort: 0, title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: Date.parse(at), ...r, user_id: 'u1', updated_at: at });
};
const para = (id, parent, sort, text, fields = {}) => put({ id, kind: 'para', parent_id: parent, sort, text, content: text ? [{ type: 'text', text }] : null, fields });
put({ id: 'area-film', kind: 'area', title: 'Filmmaking', sort: 1 });
put({ id: 'wd_nb', kind: 'world', title: 'NB', area_id: 'area-film' });
put({ id: 'pr_nb', kind: 'project', parent_id: 'wd_nb', title: 'NB', area_id: 'area-film', sort: 1, fields: { type: 'screenplay', woven: true, stage: 'Writing', develop: { paragraph: 'Kenji wants out. The family wants him in.' } } });
put({ id: 'ac_1', kind: 'act', parent_id: 'pr_nb', title: 'Screenplay', sort: 1 });
put({ id: 'ch_1', kind: 'chapter', parent_id: 'ac_1', title: 'Script', sort: 1 });
put({ id: 'sc_1', kind: 'scene', parent_id: 'ch_1', sort: 1024, title: 'Breakfast', fields: { level: 3, synopsis: 'Nobody can pass the syrup like a normal person.' } });
para('pp_1', 'ch_1', 2048, 'INT. KITCHEN - MORNING', { el: 'scene' });
para('pp_2', 'ch_1', 3072, 'Mother flips a pancake. Kenji sneaks in with the katana.', { el: 'action' });
put({ id: 'sc_2', kind: 'scene', parent_id: 'ch_1', sort: 4096, title: 'The gate', fields: { level: 3 } });
para('pp_3', 'ch_1', 5120, 'EXT. DOJO - DAY', { el: 'scene' });
para('pp_4', 'ch_1', 6144, 'Rain. A stranger at the gate.', { el: 'action' });
put({ id: 'pg_chars', kind: 'page', parent_id: 'pr_nb', title: 'Characters', sort: 1 });

let failed = 0;
const errors = [];
let p;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) {
    failed += 1;
    const at = (e.stack || '').split('\n').find((l) => l.includes('onehome.mjs')) || '';
    console.log(`FAIL ${name}\n     ${e.message}\n     ${at.trim()}`);
  }
}
const snap = async (n) => { if (SHOTS) { await sleep(300); await p.screenshot({ path: `${SHOTS}/${n}.png` }); } };
const view = () => p.evaluate(() => document.documentElement.dataset.view || 'write');
const until = (fn, arg, timeout = 30000) => p.waitForFunction(fn, arg, { timeout }).catch((e) => { throw new Error(`waited for ${String(fn).slice(0, 90)}: ${e.message.split('\n')[0]}`); });
// Go somewhere and wait to be there; once more if the app was still settling
// in (start-up can land on Today just after the first go).
const goThen = async (place, ready) => {
  for (let i = 0; ; i++) {
    await p.evaluate((pl) => window.__go(pl), place);
    try { await p.waitForFunction(ready, null, { timeout: 8000 }); return; } catch (e) { if (i >= 2) throw e; }
  }
};

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark', deviceScaleFactor: SHOTS ? 2 : 1 });
  await ctx.exposeFunction('__remote', remote);
  await ctx.addInitScript(fake);
  p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://localhost:${PORT}/`);
  await until(() => !!window.__grid);
  // Wait for the seeded rows to arrive.
  await until(() => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').get('pp_4'); q.onsuccess = () => res(!!q.result); }; }));

  await check('the project page opens the script in one tap, on its text', async () => {
    await goThen({ view: 'world', id: 'wd_nb' }, () => document.documentElement.dataset.view === 'world');
    await goThen({ view: 'project', id: 'pr_nb' }, () => !document.documentElement.dataset.view && window.__editor?.getText().includes('Kenji'));
  });

  await check('inside the script the crumb is the way back, and Alt + 0 is the project page', async () => {
    await p.mouse.move(400, 4);
    await until(() => /‹\s*NB/.test(document.querySelector('#crumb')?.textContent || ''));
    const crumb = await p.$eval('#crumb', (c) => c.textContent);
    assert.ok(!/NB.*›.*NB/.test(crumb), `no NB › NB: ${crumb}`);
    assert.equal(await p.$eval('#page-tabs', (t) => t.hidden), true, 'no row of tabs in a piece');
    await snap('a-write-top');
    // Alt + 0 from inside the piece: the project page (the text keeps the caret).
    await p.locator('#editor p', { hasText: 'Kenji' }).click();
    await p.keyboard.press('Alt+Digit0');
    await until(() => document.documentElement.dataset.view === 'world');
  });

  await check('there is no way left to land on an Overview for a script', async () => {
    await p.evaluate(() => window.__go({ view: 'project', id: 'pr_nb' }));
    await until(() => !document.documentElement.dataset.view);
    // The old Alt + 0 (Overview) from inside the piece is the project page now.
    await p.evaluate(() => window.__go({ view: 'grid', id: 'pr_nb', mode: 'outline' }));
    await until(() => !!document.querySelector('.grid-view .ph1'));
    await p.evaluate(() => window.__go({ view: 'project', id: 'pr_nb' }));
    await until(() => !document.documentElement.dataset.view);
    assert.notEqual(await view(), 'project');
  });

  await check('the Outline is the piece’s home: label, name, stage, next, sentence, More', async () => {
    await p.evaluate(() => window.__go({ view: 'grid', id: 'pr_nb', mode: 'outline' }));
    await until(() => !!document.querySelector('.grid-view .ph1'));
    const head = await p.$eval('.ph1', (h) => h.textContent);
    assert.match(head, /Screenplay/i);
    assert.match(head, /written as a script/);
    assert.match(head, /Writing/);
    assert.ok(await p.$('.ph1-next'), 'the → next button');
    assert.equal(await p.$eval('.ph1-name', (n) => n.textContent), 'NB');
    await p.evaluate(() => scrollTo(0, 0));
    await p.mouse.move(400, 4);
    await snap('b0-outline-top');
    await p.click('.ph1-sentence');
    await p.keyboard.type('A family of lethal ninjas fails to blend into suburbia.');
    await p.keyboard.press('Enter');
    await until(() => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').get('pr_nb'); q.onsuccess = () => res(/blend/.test(q.result?.fields?.develop?.sentence || '')); }; }));
    // More ▸ holds the paragraph, as the Develop page had it.
    await p.click('.ph1-more');
    assert.equal(await p.$eval('.ph1-dev textarea', (t) => t.value), 'Kenji wants out. The family wants him in.');
    await snap('b-outline-head');
    await p.click('.ph1-more');
  });

  await check('the piece’s ⋯ leads to its places, with no "Its page"', async () => {
    const items = await p.evaluate(async () => (await window.__bookMenu({ id: 'pr_nb' })).filter((x) => x && x.label).map((x) => x.label));
    assert.ok(!items.includes('Its page'), items.join(', '));
    const first = items.slice(0, 8).join(' | ');
    for (const w of ['Outline', 'Ideas for this', 'Drafts and notes', 'Fresh eyes', 'Shots', 'Share and post']) assert.ok(first.includes(w), `${w} in ${first}`);
  });

  await check('the stage moves on from the Outline head', async () => {
    await p.click('.ph1-next');
    await until(() => /Boarding/.test(document.querySelector('.ph1-word')?.textContent || ''));
  });

  await check('a piece page (Drafts and notes) has ‹ the project at the top', async () => {
    await p.evaluate(() => window.__go({ view: 'stage', id: 'pr_nb', page: 'revise' }));
    await p.mouse.move(400, 4);
    await until(() => /‹\s*NB.*Drafts and notes/.test(document.querySelector('#crumb')?.textContent || ''));
  });

  await ctx.close();

  // ---------- the phone ----------
  for (const width of [412, 360]) {
    const phone = await browser.newContext({ viewport: { width, height: 860 }, hasTouch: true, isMobile: true, colorScheme: 'dark', deviceScaleFactor: SHOTS ? 2 : 1 });
    await phone.exposeFunction('__remote', remote);
    await phone.addInitScript(fake);
    p = await phone.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`http://localhost:${PORT}/`);
    await until(() => !!window.__grid);
    await until(() => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').get('pp_4'); q.onsuccess = () => res(!!q.result); }; }));
    await check(`phone ${width}px: ‹ NB, then Outline · Write · Grid on one line; the Outline fits`, async () => {
      await goThen({ view: 'grid', id: 'pr_nb', mode: 'outline' }, () => !!document.querySelector('.grid-view .ph1') && !document.querySelector('#piece-back').hidden);
      const back = await p.$eval('#piece-back', (b) => ({ shown: !b.hidden && b.offsetParent !== null, text: b.textContent, top: b.getBoundingClientRect().top }));
      assert.ok(back.shown, 'the back button shows');
      assert.match(back.text, /‹\s*NB/);
      const seg = await p.$eval('.pv-seg', (s) => s.getBoundingClientRect().top);
      assert.ok(Math.abs(seg - back.top) < 14, `same line (${back.top} vs ${seg})`);
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'nothing scrolls sideways');
      await snap(`c-phone-${width}`);
      await p.tap('#piece-back');
      await until(() => document.documentElement.dataset.view === 'world');
    });
    await phone.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.log(`page errors:\n  ${errors.join('\n  ')}`); failed += 1; }
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
process.exit(0);
