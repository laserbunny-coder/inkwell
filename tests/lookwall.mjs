// The look wall (a world's Make page, Looks): rows of every version of every
// character and place, a star on the one that stays, set aside to narrow,
// pictures finding their row (dropped on it, named for it, or waiting in
// Unsorted), Together (each scene's place and cast, or every character in
// each place when there's no script), healing a row that lost a picture,
// keys, and a phone with no sideways scroll.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { pageFirst } from './pagefirst.mjs';
import assert from 'node:assert/strict';
import { lookOf, starPatch, asidePatch, standIn, nextPick, elementForName, lostLooks } from '../src/production.js';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let failed = 0;
const checkNow = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); } };

// ---------- without a browser ----------

const EL = (id, x) => ({ id, title: id, fields: { element: { type: 'character', ...x } } });
checkNow('star and set aside: one pick, starring brings back, setting aside the pick takes the star', () => {
  const e = EL('mom', { refs: ['a', 'b', 'c'], aside: ['b'] });
  assert.deepEqual(starPatch(e, 'b'), { pick: 'b', aside: [] });
  const starred = EL('mom', { refs: ['a', 'b', 'c'], pick: 'a' });
  assert.deepEqual(starPatch(starred, 'a'), { pick: null }, 'starring the pick again takes it away');
  assert.deepEqual(asidePatch(starred, 'a'), { aside: ['a'], pick: null });
  assert.deepEqual(asidePatch(EL('m', { refs: ['a'], aside: ['a'] }), 'a'), { aside: [] }, 'one tap brings it back');
  assert.equal(lookOf(EL('m', { refs: ['a'], pick: 'gone' })).pick, null, 'a pick that left the row is no pick');
});
checkNow('stand-ins and the next version: no pick shows the first kept one; tapping goes round the kept ones', () => {
  const e = EL('k', { refs: ['a', 'b', 'c'], aside: ['a'] });
  assert.deepEqual(standIn(e), { id: 'b', stand: true });
  assert.equal(nextPick(e), 'c');
  assert.equal(nextPick(EL('k', { refs: ['a', 'b', 'c'], pick: 'c' })), 'a');
  assert.equal(nextPick(EL('k', { refs: [] })), null);
});
checkNow('a file name finds its row: the longest name wins, a tie or nothing is no guess', () => {
  const els = [EL('Mom', { also: ['Mother'] }), EL('Kenji', {}), EL('Kenji’s room', { type: 'location' }), { ...EL('Ken', {}), title: 'Ken' }];
  els[2].title = 'Kenji room';
  assert.equal(elementForName('Kenji v3 bold.png', els), 'Kenji');
  assert.equal(elementForName('mother_warm_cel.jpg', els), 'Mom');
  assert.equal(elementForName('kenji-room-night.png', els), 'Kenji’s room', 'the longest name');
  assert.equal(elementForName('Kendo.png', els), null, 'a name inside a word is no match');
  assert.equal(elementForName('IMG_2041.png', els), null);
  assert.equal(elementForName('Mom and Kenji.png', els), null, 'two equally good names: never guess');
});
checkNow('healing: a look its row lost goes back; a reference taken off by hand or a sheet view does not', () => {
  const els = [EL('mom', { refs: ['a'] })];
  const files = [
    { id: 'a', fields: { element: 'mom', look: {} } },
    { id: 'b', fields: { element: 'mom', look: { by: 'claude' } } },
    { id: 'c', fields: { element: 'mom' } },
    { id: 'd', fields: { element: 'mom', look: {}, view: 'front' } },
    { id: 'e', deleted: true, fields: { element: 'mom', look: {} } }
  ];
  assert.deepEqual(lostLooks(els, files), { mom: ['b'] });
});

// ---------- in the app ----------

const PORT = 4263;
const server = await serve(PORT);
const SHOTS = process.env.SHOTS || '';

const table = new Map();
const bucket = new Map();
let clock = Date.parse('2026-11-16T00:00:00Z');
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
  if (op === 'upload') { bucket.set(arg.path, arg); return true; }
  if (op === 'download') return bucket.get(arg) || null;
  return true;
}
const fake = () => {
  const toB64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(blob); });
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: (rows) => window.__remote('push', rows),
    pull: (since, from) => window.__remote('pull', { since, from }),
    async upload(path, blob, type) { await window.__remote('upload', { path, type, data: await toB64(blob) }); },
    async download(path) {
      const f = await window.__remote('download', path);
      if (!f) throw new Error('not found');
      return new Blob([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], { type: f.type });
    },
    subscribe() {}, unsubscribe() {}
  };
};

const put = (r) => {
  const at = tick();
  table.set(r.id, { parent_id: null, sort: 0, title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: Date.parse(at), ...r, user_id: 'u1', updated_at: at });
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==', 'base64');
const pic = (id, title, fields) => {
  put({ id, kind: 'file', title, fields: { type: 'image/png', size: 70, look: { by: 'me' }, ...fields } });
  bucket.set(`u1/${id}`, { path: `u1/${id}`, type: 'image/png', data: PNG.toString('base64') });
};

put({ id: 'area-writing', kind: 'area', title: 'Writing', sort: 1 });
// A world with a script: two scenes.
put({ id: 'wd_nb', kind: 'world', title: 'The Ninja Bunch', area_id: 'area-writing', fields: { production: { code: 'NB' } } });
put({ id: 'pr_reel', kind: 'project', parent_id: 'wd_nb', title: 'Reel 4', area_id: 'area-writing', sort: 1, fields: { type: 'screenplay', numbered: true } });
put({ id: 'ac_r', kind: 'act', parent_id: 'pr_reel', title: 'Screenplay', sort: 1 });
put({ id: 'ch_r', kind: 'chapter', parent_id: 'ac_r', title: 'Script', sort: 1 });
let n = 0;
const l = (id, text, el, extra = {}) => put({ id, kind: 'para', parent_id: 'ch_r', sort: (n += 1024), text, content: [{ type: 'text', text }], fields: { el, ...extra } });
l('pp_1', 'INT. KITCHEN - MORNING', 'scene', { code: '1' });
l('pp_2', 'Mother flips a pancake. Kenji sneaks in.', 'action');
l('pp_3', 'EXT. ROOF - NIGHT', 'scene', { code: '2' });
l('pp_4', 'Kenji alone on the roof.', 'action');
put({ id: 'pg_chars', kind: 'page', parent_id: 'wd_nb', title: 'Characters', sort: 1 });
put({ id: 'pg_mom', kind: 'page', parent_id: 'pg_chars', title: 'Mom', sort: 1, fields: { element: { type: 'character', also: ['Mother'], refs: ['fi_m1', 'fi_m2', 'fi_m3'] } } });
put({ id: 'pg_kenji', kind: 'page', parent_id: 'pg_chars', title: 'Kenji', sort: 2, fields: { element: { type: 'character', refs: ['fi_k1'] } } });
put({ id: 'pg_places', kind: 'page', parent_id: 'wd_nb', title: 'Places', sort: 2 });
put({ id: 'pg_kitchen', kind: 'page', parent_id: 'pg_places', title: 'Kitchen', sort: 1, fields: { element: { type: 'location', refs: ['fi_p1'] } } });
put({ id: 'pg_roof', kind: 'page', parent_id: 'pg_places', title: 'Roof', sort: 2, fields: { element: { type: 'location' } } });
put({ id: 'pg_props', kind: 'page', parent_id: 'wd_nb', title: 'Props', sort: 3 });
put({ id: 'pg_katana', kind: 'page', parent_id: 'pg_props', title: 'Katana', sort: 1, fields: { element: { type: 'prop' } } });
pic('fi_m1', 'Mom warm cel.png', { element: 'pg_mom', look: { by: 'me', from: 'ComfyUI' } });
pic('fi_m2', 'Mom bold cel.png', { element: 'pg_mom', look: { by: 'claude', from: 'Nano Banana', prompt: 'Mom, bold cel' } });
pic('fi_m3', 'Mom chibi.png', { element: 'pg_mom' });
pic('fi_k1', 'Kenji warm.png', { element: 'pg_kenji' });
pic('fi_k2', 'Kenji lost.png', { element: 'pg_kenji', look: { by: 'claude', from: 'Seedream' } }); // its row lost it
pic('fi_p1', 'Kitchen morning.png', { element: 'pg_kitchen' });
// A world with no pieces at all (The Ninja Bunch today).
put({ id: 'wd_new', kind: 'world', title: 'New Show', area_id: 'area-writing' });
put({ id: 'pg_n_chars', kind: 'page', parent_id: 'wd_new', title: 'Characters', sort: 1 });
put({ id: 'pg_n_a', kind: 'page', parent_id: 'pg_n_chars', title: 'Aiko', sort: 1, fields: { element: { type: 'character', refs: ['fi_a1', 'fi_a2'] } } });
put({ id: 'pg_n_places', kind: 'page', parent_id: 'wd_new', title: 'Places', sort: 2 });
put({ id: 'pg_n_street', kind: 'page', parent_id: 'pg_n_places', title: 'Street', sort: 1, fields: { element: { type: 'location', refs: ['fi_s1'], pick: 'fi_s1' } } });
pic('fi_a1', 'Aiko one.png', { element: 'pg_n_a' });
pic('fi_a2', 'Aiko two.png', { element: 'pg_n_a' });
pic('fi_s1', 'Street.png', { element: 'pg_n_street' });

const browser = pageFirst(await chromium.launch());
async function device(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark', ...opts });
  await ctx.exposeFunction('__remote', remote);
  await ctx.addInitScript(fake);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  if (process.env.THROTTLE) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE) });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#editor .ProseMirror', { state: 'attached' });
  await page.waitForFunction(() => document.documentElement.dataset.started === '1', null, { timeout: 15000 }).catch(() => {});
  return page;
}
const settle = async (p) => {
  await p.waitForFunction(() => window.__sync && !window.__sync.running, null, { timeout: 5000 }).catch(() => {});
  await p.evaluate(() => window.__sync.run());
  await sleep(300);
};
const go = (p, place) => p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
const el = (id) => table.get(id).fields.element;
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
// The wall on screen (the project's Make or a film; the other stays drawn, hidden).
const row = (p, id) => p.locator(`.lw-row[data-row="${id}"]:visible`);
const tile = (p, rowId, fileId) => row(p, rowId).locator(`.lw-tile[data-id="${fileId}"]`);
// Waits for what's saved here to reach the pretend cloud.
const until = async (p, fn, what) => {
  for (let i = 0; i < 20; i++) { await settle(p); if (fn()) return; await sleep(200); }
  throw new Error(`never happened: ${what}`);
};
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`); }
}
const openWall = async (p, world) => {
  await go(p, { view: 'stage', id: world, page: 'make', sub: 'looks' });
  await p.waitForSelector('#stage-view .lw .lw-main', { timeout: 15000 });
};

try {
  const laptop = await device();
  await settle(laptop);
  await laptop.evaluate(() => localStorage.removeItem('lookwall'));
  await openWall(laptop, 'wd_nb');

  await check('Make opens on Cast and places: rows for characters, then places, then props; each says its scenes by their names', async () => {
    assert.equal(await laptop.locator('.st-chips .chip[data-sub="looks"]').getAttribute('aria-selected'), 'true');
    assert.equal((await laptop.locator('.st-chips .chip[data-sub="looks"]').innerText()).trim(), 'Cast and places');
    assert.equal(await laptop.locator('.st-chips .chip[data-sub="kit"]').count(), 0, 'no Kit chip');
    const rows = await laptop.locator('.lw-row').evaluateAll((xs) => xs.map((x) => x.dataset.row));
    assert.deepEqual(rows, ['pg_mom', 'pg_kenji', 'pg_kitchen', 'pg_roof', 'pg_katana']);
    const head = await row(laptop, 'pg_mom').locator('.lw-row-h').innerText();
    assert.match(head, /In Mother flips a pancake/);
    assert.doesNotMatch(head, /INT\.|KITCHEN/, 'never the slug line');
    assert.match(await row(laptop, 'pg_kenji').locator('.lw-row-h').innerText(), /In Mother flips a pancake.*, Kenji alone on the roof/);
    // Size, captions, set aside and the keys live in ⋯, not on the wall.
    assert.equal(await laptop.locator('.lw-ctl input').count(), 0, 'no sliders or ticks up top');
    await row(laptop, 'pg_mom').locator('.lw-tile img').first().waitFor({ timeout: 8000 });
  });

  await check('healing: a look its row lost (saved over from another device) is back on the row', async () => {
    await tile(laptop, 'pg_kenji', 'fi_k2').waitFor({ timeout: 5000 });
    await until(laptop, () => el('pg_kenji').refs.includes('fi_k2'), 'fi_k2 back in refs');
  });

  await check('star and set aside, by tap: one pick per row, set aside fades, the pick shows in the header', async () => {
    await tile(laptop, 'pg_mom', 'fi_m2').locator('.lw-pic').click();
    assert.equal(await tile(laptop, 'pg_mom', 'fi_m2').getAttribute('data-focus'), 'true');
    await tile(laptop, 'pg_mom', 'fi_m2').locator('[data-act="star"]').click();
    await laptop.waitForSelector('.lw-row[data-row="pg_mom"] .lw-tile[data-id="fi_m2"][data-star="true"] .lw-badge');
    await until(laptop, () => el('pg_mom').pick === 'fi_m2', 'pick saved');
    await tile(laptop, 'pg_mom', 'fi_m3').locator('.lw-pic').click();
    await tile(laptop, 'pg_mom', 'fi_m3').locator('[data-act="aside"]').click();
    await laptop.waitForSelector('.lw-tile[data-id="fi_m3"][data-out="true"]');
    await until(laptop, () => el('pg_mom').aside?.includes('fi_m3'), 'aside saved');
    await shot(laptop, 'wall');
  });

  await check('keys: arrows move, S stars, X sets aside (and takes the star), Enter opens large, Escape closes, 2 and 1 switch views', async () => {
    await tile(laptop, 'pg_mom', 'fi_m1').locator('.lw-pic').click();
    await laptop.keyboard.press('ArrowRight');
    assert.equal(await tile(laptop, 'pg_mom', 'fi_m2').getAttribute('data-focus'), 'true');
    await laptop.keyboard.press('x');
    await laptop.waitForSelector('.lw-tile[data-id="fi_m2"][data-out="true"][data-star="false"]');
    await until(laptop, () => !el('pg_mom').pick && el('pg_mom').aside.includes('fi_m2'), 'set aside the pick');
    await laptop.keyboard.press('s');
    await laptop.waitForSelector('.lw-tile[data-id="fi_m2"][data-out="false"][data-star="true"]');
    await until(laptop, () => el('pg_mom').pick === 'fi_m2' && !el('pg_mom').aside.includes('fi_m2'), 'starring brings it back');
    await laptop.keyboard.press('ArrowDown');
    assert.equal(await tile(laptop, 'pg_kenji', 'fi_k1').getAttribute('data-focus'), 'true');
    await laptop.keyboard.press('Enter');
    await laptop.waitForSelector('.lw-lb .lw-big img');
    assert.match(await laptop.locator('.lw-lb-cap').innerText(), /Kenji, Kenji warm/);
    await laptop.keyboard.press('ArrowRight');
    assert.match(await laptop.locator('.lw-lb-cap').innerText(), /Kenji lost[\s\S]*Made in Seedream/);
    await laptop.keyboard.press('s');
    await until(laptop, () => el('pg_kenji').pick === 'fi_k2', 'starred in the large view');
    await shot(laptop, 'large');
    await laptop.keyboard.press('Escape');
    await laptop.locator('.lw-lb').waitFor({ state: 'detached' });
    await laptop.keyboard.press('2');
    await laptop.waitForSelector('.lw[data-view="side"] .lw-tiles.big');
    assert.equal(await laptop.locator('.lw-row').count(), 1, 'one row, large');
    await laptop.keyboard.press('1');
    await laptop.waitForSelector('.lw[data-view="wall"]');
    assert.equal(await laptop.locator('.lw-row').count(), 5);
  });

  await check('pictures onto a row: Add pictures puts them on that row, with where they came from', async () => {
    await row(laptop, 'pg_roof').locator('.lw-addpics input').setInputFiles([{ name: 'any name.png', mimeType: 'image/png', buffer: PNG }]);
    await row(laptop, 'pg_roof').locator('.lw-tile').first().waitFor({ timeout: 8000 });
    await until(laptop, () => (el('pg_roof').refs || []).length === 1, 'roof has the picture');
    const f = table.get(el('pg_roof').refs[0]);
    assert.equal(f.fields.element, 'pg_roof');
    assert.equal(f.fields.look.by, 'me');
  });

  await check('dropped outside any row: a name finds its row, the rest wait in Unsorted and Move to… puts them on a row', async () => {
    await laptop.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'kenji v3 bold.png', { type: 'image/png' }));
      dt.items.add(new File([bytes], 'IMG_2041.png', { type: 'image/png' }));
      document.querySelector('.lw-add').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, PNG.toString('base64'));
    await row(laptop, 'unsorted').waitFor({ timeout: 8000 });
    await until(laptop, () => el('pg_kenji').refs.length === 3, 'kenji found by name');
    assert.equal(await row(laptop, 'unsorted').locator('.lw-tile').count(), 1);
    await shot(laptop, 'unsorted');
    await row(laptop, 'unsorted').locator('.lw-tile .lw-pic').click();
    await row(laptop, 'unsorted').locator('[data-act="move"]').click();
    await laptop.locator('.pop-menu .pop-item', { hasText: 'Kitchen (Place)' }).click();
    await row(laptop, 'unsorted').waitFor({ state: 'detached', timeout: 5000 });
    await until(laptop, () => el('pg_kitchen').refs.length === 2, 'moved to the kitchen');
    const moved = table.get(el('pg_kitchen').refs[1]);
    assert.equal(moved.fields.element, 'pg_kitchen');
    assert.equal(moved.fields.unsorted, undefined);
  });

  await check('Together with a script: each scene’s place and cast; tapping tries the next version and makes it the pick', async () => {
    await laptop.keyboard.press('3');
    await laptop.waitForSelector('.lw[data-view="together"] .lw-scene.main');
    const main = laptop.locator('.lw-scene.main');
    const who = await main.locator('.lw-who').allInnerTexts();
    assert.deepEqual(who.map((w) => w.split(':')[0]), ['Kitchen', 'Mom', 'Kenji']);
    assert.equal(await laptop.locator('.lw-strip .lw-scene').count(), 2, 'every scene below');
    const before = el('pg_mom').pick;
    await main.locator('.lw-cell', { hasText: 'Mom' }).click();
    await until(laptop, () => el('pg_mom').pick && el('pg_mom').pick !== before && !el('pg_mom').aside.includes(el('pg_mom').pick), 'next kept version is the pick');
    // The roof scene: a place with a stand-in (no pick yet).
    await laptop.locator('.lw-steps button', { hasText: 'Kenji alone' }).click();
    await laptop.waitForFunction(() => /Roof/.test(document.querySelector('.lw-scene.main')?.innerText || ''));
    assert.ok(await laptop.locator('.lw-scene.main .lw-stand', { hasText: 'stand-in' }).count());
    await shot(laptop, 'together');
  });

  await check('Together without a script: every character’s pick beside each place', async () => {
    await openWall(laptop, 'wd_new');
    await laptop.waitForSelector('.lw[data-view="together"] .lw-scene.main');
    const who = await laptop.locator('.lw-scene.main .lw-who').allInnerTexts();
    assert.deepEqual(who.map((w) => w.split(':')[0]), ['Street', 'Aiko']);
    assert.match(await laptop.locator('.lw-together-h').innerText(), /No script yet/);
    await laptop.locator('.lw-scene.main .lw-cell', { hasText: 'Aiko' }).click();
    await until(laptop, () => el('pg_n_a').pick === 'fi_a2', 'second Aiko is the pick (the first was the stand-in)');
    await laptop.keyboard.press('1');
  });

  await check('a new world: Add a character makes a page in the bible with its own row', async () => {
    await laptop.locator('.lw-add button', { hasText: '+ Character' }).click();
    await laptop.locator('.ask-input').fill('Grandpa');
    await laptop.keyboard.press('Enter');
    await laptop.waitForSelector('.lw-row .lw-name:text-is("Grandpa")');
    await until(laptop, () => [...table.values()].some((r) => r.title === 'Grandpa' && r.fields?.element?.type === 'character' && r.parent_id === 'pg_n_chars'), 'Grandpa in Characters');
  });

  await check('a name opens their details beside the wall: Played by saves to the same Bible page and shows on the row', async () => {
    await openWall(laptop, 'wd_nb');
    await row(laptop, 'pg_mom').locator('.lw-name').click();
    await laptop.waitForSelector('.lw-grid.lw-beside .lw-side .cd[data-element="pg_mom"]');
    assert.equal(await row(laptop, 'pg_mom').locator('.lw-name').getAttribute('aria-expanded'), 'true');
    const cd = laptop.locator('.lw-side .cd');
    assert.equal(await cd.locator('input[aria-label="Also called"]').inputValue(), 'Mother');
    await cd.locator('input[aria-label="Played by"]').fill('Ana Ruiz');
    await cd.locator('textarea[aria-label="Description"]').fill('Forties, flour on her sleeves');
    await cd.locator('textarea[aria-label="Description"]').blur();
    await until(laptop, () => el('pg_mom').playedBy === 'Ana Ruiz' && el('pg_mom').snippet === 'Forties, flour on her sleeves', 'details saved');
    assert.match(await row(laptop, 'pg_mom').locator('.lw-row-h').innerText(), /played by Ana Ruiz/);
    // This world's reel is generated, so For AI tools starts open; it folds away.
    await cd.locator('.cd-ai .cd-slot').first().waitFor();
    await cd.locator('.cd-fold').click();
    assert.equal(await cd.locator('.cd-ai').isHidden(), true);
    await cd.locator('.cd-fold').click();
    await shot(laptop, 'details-beside');
    await cd.locator('.cd-close').click();
    await laptop.locator('.lw-side .cd').waitFor({ state: 'detached' });
    assert.equal(await laptop.locator('.lw-grid.lw-beside').count(), 0);
  });

  await check('⋯ > Details open > Under the row: details sit under the name, in one column; kept on this device', async () => {
    await laptop.locator('.lw-more:visible').click();
    await laptop.locator('.pop-menu .pop-item', { hasText: 'Details open' }).click();
    await laptop.locator('.pop-menu .pop-item', { hasText: 'Under the row' }).click();
    await row(laptop, 'pg_kenji').locator('.lw-name').click();
    await row(laptop, 'pg_kenji').locator('.cd').waitFor();
    assert.equal(await laptop.locator('.lw-side .cd').count(), 0);
    assert.equal(JSON.parse(await laptop.evaluate(() => localStorage.getItem('lookwall'))).details, 'under');
    await shot(laptop, 'details-under');
    await laptop.keyboard.press('Escape');
    await row(laptop, 'pg_kenji').locator('.cd').waitFor({ state: 'detached' });
    await laptop.locator('.lw-more:visible').click();
    await laptop.locator('.pop-menu .pop-item', { hasText: 'Details open' }).click();
    await laptop.locator('.pop-menu .pop-item', { hasText: 'Beside the wall' }).click();
  });

  await check('Rules for every shot: folded to one line at the top, saved on the world', async () => {
    await laptop.locator('.cd-rules-line').click();
    await laptop.locator('.cd-rules-box textarea[aria-label="Style rules"]').fill('Warm cel, film grain');
    await laptop.locator('.cd-rules-box textarea[aria-label="Style rules"]').blur();
    await until(laptop, () => table.get('wd_nb').fields?.production?.style === 'Warm cel, film grain', 'style saved');
    await laptop.locator('.cd-rules-line').click();
  });

  await check('inside a film: the Cast and places tab is the same wall, with only who and what is in it', async () => {
    await go(laptop, { view: 'production', id: 'pr_reel', tab: 'kit' });
    await laptop.waitForSelector('.pd-body[data-tab="kit"] .lw .lw-row');
    assert.equal((await laptop.locator('.chip[data-tab="kit"]').innerText()).trim(), 'Cast and places');
    const rows = await laptop.locator('.pd-body .lw-row').evaluateAll((xs) => xs.map((x) => x.dataset.row));
    assert.deepEqual(rows, ['pg_mom', 'pg_kenji', 'pg_kitchen', 'pg_roof'], 'the katana is in no scene of this film');
    const first = tile(laptop, 'pg_kenji', 'fi_k2');
    assert.equal(await first.getAttribute('data-star'), 'true');
    // Keys work here too.
    await tile(laptop, 'pg_mom', 'fi_m1').locator('.lw-pic').click();
    await laptop.keyboard.press('ArrowRight');
    assert.equal(await tile(laptop, 'pg_mom', 'fi_m2').getAttribute('data-focus'), 'true');
    await shot(laptop, 'film');
  });

  await check('Remove in the large view takes a picture off its row, with an Undo', async () => {
    await tile(laptop, 'pg_kitchen', 'fi_p1').locator('.lw-pic').click();
    await tile(laptop, 'pg_kitchen', 'fi_p1').locator('[data-act="open"]').click();
    await laptop.locator('.lw-lb .lw-big').waitFor();
    await laptop.locator('.lw-lb [data-act="remove"]').click();
    await until(laptop, () => !el('pg_kitchen').refs.includes('fi_p1') && table.get('fi_p1').deleted, 'removed');
    await laptop.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(1000);
    await until(laptop, () => el('pg_kitchen').refs.includes('fi_p1') && !table.get('fi_p1').deleted, 'back');
  });

  await check('One at a time (in ⋯): one row with nothing else; the choice is kept on this device', async () => {
    await openWall(laptop, 'wd_nb');
    assert.equal(await laptop.locator('.lw-lb').count(), 0, 'the film’s large view closed on leaving it');
    await laptop.locator('.lw-more:visible').click();
    await laptop.locator('.pop-menu .pop-item', { hasText: 'How much at once' }).click();
    await laptop.locator('.pop-menu .pop-item', { hasText: 'One at a time' }).click();
    await laptop.waitForFunction(() => document.querySelectorAll('#stage-view .lw-row').length === 1);
    await laptop.reload();
    await laptop.waitForSelector('#editor .ProseMirror', { state: 'attached' });
    await openWall(laptop, 'wd_nb');
    await laptop.waitForSelector('#stage-view .lw-row');
    assert.equal(await laptop.locator('#stage-view .lw-row').count(), 1);
    await laptop.locator('.lw-more:visible').click();
    await laptop.locator('.pop-menu .pop-item', { hasText: 'How much at once' }).click();
    await laptop.locator('.pop-menu .pop-item', { hasText: 'Everything' }).click();
  });

  assert.deepEqual(laptop.errors, []);

  const phone = await device({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await settle(phone);
  await openWall(phone, 'wd_nb');
  await check('a phone: one column, two or three across, tap shows Star and Set aside, no sideways scroll', async () => {
    await phone.locator('.lw-row[data-row="pg_mom"] .lw-tile img').first().waitFor({ timeout: 8000 });
    const cols = await phone.locator('.lw-row[data-row="pg_mom"] .lw-tiles').evaluate((x) => getComputedStyle(x).gridTemplateColumns.split(' ').length);
    assert.ok(cols === 2 || cols === 3, `columns ${cols}`);
    assert.equal(await phone.locator('.lw-keys').count(), 0, 'no keys line on a phone');
    await phone.locator('.lw-row[data-row="pg_mom"] .lw-tile .lw-pic').first().tap();
    assert.ok(await phone.locator('.lw-row[data-row="pg_mom"] .lw-tile[data-focus="true"] [data-act="star"]').isVisible());
    const wide = await phone.evaluate(() => Math.max(document.documentElement.scrollWidth, document.querySelector('#stage-view')?.scrollWidth || 0) - innerWidth);
    assert.ok(wide <= 0, `${wide}px sideways`);
    await shot(phone, 'phone');
  });
  await check('a phone: a name opens their details under its row, never beside', async () => {
    await phone.locator('.lw-row[data-row="pg_mom"] .lw-name').tap();
    await phone.locator('.lw-row[data-row="pg_mom"] .cd').waitFor();
    assert.equal(await phone.locator('.lw-side .cd').count(), 0);
    assert.equal(await phone.locator('.lw-row[data-row="pg_mom"] .cd input[aria-label="Played by"]').inputValue(), 'Ana Ruiz');
    const wide = await phone.evaluate(() => Math.max(document.documentElement.scrollWidth, document.querySelector('#stage-view')?.scrollWidth || 0) - innerWidth);
    assert.ok(wide <= 0, `${wide}px sideways`);
    await phone.locator('.lw-row[data-row="pg_mom"] .cd').scrollIntoViewIfNeeded();
    await shot(phone, 'phone-details');
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
console.log('lookwall: all passed');
