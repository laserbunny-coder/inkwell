// One home (Nov 20 2026), Part 2: the project page holds its pieces. A
// piece line's ▸ shows its scenes (a novel's chapters), each opening the
// text there, then "Open the outline ›". A project with one piece draws its
// Pieces line as that piece, named by its label (a ⋯ switch turns it off).
// "→ next" says what starts and the toast offers "Go there ›". The Bible
// lists pages made inside a piece; Make has a Shots line per piece.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4298;
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
put({ id: 'ch_1', kind: 'chapter', parent_id: 'ac_1', title: 'Script', sort: 1, fields: { words: 420 } });
put({ id: 'sc_1', kind: 'scene', parent_id: 'ch_1', sort: 1024, title: 'Breakfast', fields: { level: 3, synopsis: 'Nobody can pass the syrup like a normal person.' } });
para('pp_1', 'ch_1', 2048, 'INT. KITCHEN - MORNING', { el: 'scene' });
para('pp_2', 'ch_1', 3072, 'Mother flips a pancake. Kenji sneaks in with the katana.', { el: 'action' });
put({ id: 'sc_2', kind: 'scene', parent_id: 'ch_1', sort: 4096, title: 'The gate', fields: { level: 3 } });
para('pp_3', 'ch_1', 5120, 'EXT. DOJO - DAY', { el: 'scene' });
para('pp_4', 'ch_1', 6144, 'Rain. A stranger at the gate.', { el: 'action' });
put({ id: 'pg_chars', kind: 'page', parent_id: 'pr_nb', title: 'Characters', sort: 1 });
put({ id: 'sh_1', kind: 'shot', parent_id: 'pp_1', sort: 1024, text: 'Wide on the kitchen', fields: { n: 1, piece: 'pr_nb' } });
put({ id: 'sh_2', kind: 'shot', parent_id: 'pp_1', sort: 2048, text: 'Close on the syrup', fields: { n: 2 } });
// A project with two pieces: a novel (chapters) and a short.
put({ id: 'wd_wh', kind: 'world', title: 'Winter Harbour', area_id: 'area-film', sort: 2 });
put({ id: 'pr_nov', kind: 'project', parent_id: 'wd_wh', title: 'The Harbour Book', area_id: 'area-film', sort: 1, fields: { type: 'novel', label: 'Novel', stage: 'Drafting' } });
put({ id: 'ac_n', kind: 'act', parent_id: 'pr_nov', title: 'Part one', sort: 1 });
put({ id: 'ch_a', kind: 'chapter', parent_id: 'ac_n', title: 'The ferry', sort: 1, fields: { synopsis: 'Ada misses the last boat on purpose.', words: 1200 } });
para('pn_1', 'ch_a', 1024, 'The ferry horn went twice and Ada did not move.');
put({ id: 'ch_b', kind: 'chapter', parent_id: 'ac_n', title: 'Low tide', sort: 2, fields: { words: 800 } });
para('pn_2', 'ch_b', 1024, 'At low tide the harbour showed its bones.');
put({ id: 'pg_map', kind: 'page', parent_id: 'pr_nov', title: 'Harbour map', sort: 1 });
put({ id: 'pr_sh', kind: 'project', parent_id: 'wd_wh', title: 'Gulls', area_id: 'area-film', sort: 2, fields: { type: 'screenplay', label: 'Short', stage: 'Idea' } });
put({ id: 'ch_s', kind: 'chapter', parent_id: 'pr_sh', title: 'Script', sort: 1 });
para('ps_1', 'ch_s', 1024, 'EXT. PIER - DAWN', { el: 'scene' });

let failed = 0;
const errors = [];
let p;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) {
    failed += 1;
    const at = (e.stack || '').split('\n').find((l) => l.includes('onehome2.mjs')) || '';
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


const db = (id, test) => until(([i, t]) => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').get(i); q.onsuccess = () => res(new Function('x', `return ${t}`)(q.result)); }; }), [id, test]);
const openPart = async (part) => {
  const tog = `#wh-outline > li[data-part="${part}"] > .wo-row > .wo-tog`;
  await p.waitForSelector(tog);
  if ((await p.$eval(tog, (b) => b.getAttribute('aria-expanded'))) !== 'true') await p.click(tog);
  await p.waitForSelector(`#wh-outline > li[data-part="${part}"] > .wo-kids`);
};
const home = (id) => goThen({ view: 'world', id }, () => document.documentElement.dataset.view === 'world' && !!document.querySelector('#wh-outline > li[data-part]'));
// The rows a line takes (its own children, not its open list).
const rowsOf = (sel) => p.$$eval(sel, (ls) => ls.map((li) => {
  const tops = [...li.children].filter((c) => c.tagName !== 'UL' && !c.classList.contains('lk-dots') && c.offsetParent !== null && c.getBoundingClientRect().height).map((c) => c.getBoundingClientRect().top).sort((a, b) => a - b);
  return tops.filter((t, i) => i === 0 || t - tops[i - 1] > 18).length;
}));

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark', deviceScaleFactor: SHOTS ? 2 : 1 });
  await ctx.exposeFunction('__remote', remote);
  await ctx.addInitScript(fake);
  p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://localhost:${PORT}/`);
  await until(() => !!window.__grid);
  await db('ps_1', '!!x');

  await check('one script, right on the page: the Pieces line is the piece, by its label', async () => {
    await home('wd_nb');
    const one = '#wh-outline > li[data-part="pieces"].wo-one';
    await p.waitForSelector(one);
    assert.equal(await p.$eval(`${one} > .wo-item`, (b) => b.textContent), 'Screenplay');
    assert.ok(await p.$(`${one} > .wo-stage`), 'its stage dots');
    assert.ok(await p.$(`${one} > .wo-next`), 'its → next');
    assert.match(await p.$eval(`${one} > .wo-words`, (x) => x.textContent), /words/);
    assert.equal(await p.$eval('#wh-continue .wt-t', (x) => x.textContent), 'Screenplay', 'Continue reads the label');
  });

  await check('▸ shows its scenes (number, title, summary), then "Open the outline ›"', async () => {
    await p.click('#wh-outline > li.wo-one > .wo-ptog');
    await p.waitForSelector('.wo-one .wo-scene');
    const rows = await p.$$eval('.wo-one .wo-scene', (ls) => ls.map((l) => l.textContent));
    assert.equal(rows.length, 2, rows.join(' | '));
    assert.match(rows[0], /^1\s*Breakfast.*syrup/);
    assert.match(rows[1], /^2\s*The gate/);
    assert.match(await p.$eval('.wo-one .wo-scenes > li:last-child', (l) => l.textContent), /Open the outline ›/);
    await snap('a-one-open');
  });

  await check('the open state is kept (per piece, this device)', async () => {
    await home('wd_nb');
    await p.waitForSelector('.wo-one .wo-scene');
  });

  await check('a scene opens the text at that scene', async () => {
    await p.click('.wo-one .wo-scene:nth-child(2) .wo-item');
    await until(() => !document.documentElement.dataset.view && window.__editor?.getText().includes('Rain'));
  });

  await check('"Open the outline ›" opens the Outline', async () => {
    await home('wd_nb');
    await p.click('.wo-one .wo-ol .wo-item');
    await until(() => !!document.querySelector('.grid-view .ph1'));
  });

  await check('the name opens the text where you left off', async () => {
    await home('wd_nb');
    await p.click('#wh-outline > li.wo-one > .wo-item');
    await until(() => !document.documentElement.dataset.view && window.__editor?.getText().includes('Kenji'));
  });

  await check('→ next says what starts; the toast offers "Go there ›"', async () => {
    await home('wd_nb');
    const next = await p.$eval('.wo-one > .wo-next', (b) => b.textContent);
    assert.match(next, /^→ Start /, next);
    await p.click('.wo-one > .wo-next');
    await p.waitForSelector('.toast');
    assert.match(await p.$eval('.toast', (t) => t.textContent), /NB is at Boarding\..*Go there ›.*Undo/);
    assert.equal(await view(), 'world', 'it only moves the stage');
    await until(() => /Boarding/.test(document.querySelector('.wo-one .wo-stage')?.textContent || ''));
    await snap('b-next-toast');
    await p.click('.toast .toast-action');
    await until(() => document.documentElement.dataset.view === 'production');
  });

  await check('the Bible lists pages made inside the piece', async () => {
    await home('wd_nb');
    await openPart('bible');
    assert.ok((await p.$$eval('li[data-part="bible"] .wo-page .wo-item', (b) => b.map((x) => x.textContent))).includes('Characters'));
  });

  await check('Make has a Shots line for the piece, with its shot count', async () => {
    await openPart('make');
    const line = await p.$$eval('li[data-part="make"] > .wo-kids > li', (ls) => ls.map((l) => l.textContent).find((t) => /^Shots/.test(t)) || '');
    assert.match(line, /^Shots\s*2 shots/, line);
    await snap('c-bible-make');
  });

  await check('the ⋯ switch turns the one-script line back into Pieces, and on again', async () => {
    const flip = async () => {
      await p.click('#wh-more button');
      await p.locator('.pop-menu [role="menuitem"]', { hasText: 'Show the script on the project page' }).click();
    };
    await flip();
    await until(() => document.querySelector('#wh-outline > li[data-part="pieces"] .wo-name')?.textContent === 'Pieces');
    await db('wd_nb', 'x.fields.onePiece === false');
    await flip();
    await p.waitForSelector('#wh-outline > li[data-part="pieces"].wo-one');
  });

  await check('two pieces: Pieces lists them; ▸ on the novel shows its chapters', async () => {
    await home('wd_wh');
    assert.equal(await p.$('#wh-outline > li.wo-one'), null);
    await openPart('pieces');
    const nov = 'li[data-part="pieces"] .wo-piece[data-id="pr_nov"]';
    await p.waitForSelector(`${nov} > .wo-ptog`);
    assert.match(await p.$eval(nov, (l) => l.textContent), /2,000 words/);
    await p.click(`${nov} > .wo-ptog`);
    await p.waitForSelector(`${nov} .wo-scene`);
    const rows = await p.$$eval(`${nov} .wo-scene`, (ls) => ls.map((l) => l.textContent));
    assert.match(rows[0], /^1\s*The ferry.*last boat/);
    assert.match(rows[1], /^2\s*Low tide/);
    await snap('d-two-pieces');
    await p.click(`${nov} .wo-scene:nth-child(2) .wo-item`);
    await until(() => !document.documentElement.dataset.view && window.__editor?.getText().includes('bones'));
  });

  await check('two pieces: the Bible names the piece beside a page made in it', async () => {
    await home('wd_wh');
    await openPart('bible');
    const map = await p.$$eval('li[data-part="bible"] .wo-page', (ls) => ls.map((l) => l.textContent).find((t) => t.includes('Harbour map')) || '');
    assert.match(map, /Harbour map\s*The Harbour Book/);
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
    await db('ps_1', '!!x');
    await check(`phone ${width}px: the one-script line and piece lines take two rows at most`, async () => {
      await home('wd_nb');
      await p.waitForSelector('#wh-outline > li.wo-one');
      await snap(`e0-phone-one-${width}`);
      const [n] = await rowsOf('#wh-outline > li.wo-one');
      assert.ok(n <= 2, `${n} rows: ${await p.$eval('#wh-outline > li.wo-one', (li) => [...li.children].map((c) => `${c.className}@${Math.round(c.getBoundingClientRect().top)}`).join(' '))}`);
      await p.tap('#wh-outline > li.wo-one > .wo-ptog');
      await p.waitForSelector('.wo-one .wo-scene');
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'nothing scrolls sideways');
      await snap(`e-phone-one-${width}`);
      await home('wd_wh');
      await openPart('pieces');
      await p.waitForSelector('li[data-part="pieces"] .wo-piece');
      await snap(`f0-phone-pieces-${width}`);
      for (const k of await rowsOf('li[data-part="pieces"] .wo-piece')) assert.ok(k <= 2, `${k} rows: ${await p.$$eval('li[data-part="pieces"] .wo-piece', (ls) => ls.map((li) => [...li.children].map((c) => `${c.className}@${Math.round(c.getBoundingClientRect().top)}`).join(' ')).join(' / '))}`);
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'nothing scrolls sideways');
      await snap(`f-phone-pieces-${width}`);
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
