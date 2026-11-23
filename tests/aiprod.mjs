// AI production tools on Make and Deliver: how each shot is generated
// (model, seconds, first and last frame, the line it's timed to, shots made
// in one generation), the cost (an estimate from the price list, what was
// really spent), the price list itself (synced, kept up to date by Claude),
// kit locks (show rules, character sheets, location lighting, tool IDs), the
// Resolve hand-off (an EDL of the starred takes), and tries Claude brings
// back through the connector arriving on every device.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { pageFirst } from './pagefirst.mjs';
import assert from 'node:assert/strict';
import { estimate, spent, runsOf, toEdl, timecode, cutEvents, priceOf, priceList, toolIdsOf, SEED_PRICES, money } from '../src/production.js';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let failed = 0;
const checkNow = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); } };

// ---------- without a browser ----------

const S = (id, gen = {}, more = {}) => ({ id, text: id, fields: { gen, ...more } });
checkNow('runs: shots sharing a group next to each other are one generation', () => {
  const r = runsOf([S('a'), S('b', {}, { group: 'g' }), S('c', {}, { group: 'g' }), S('d'), S('e', {}, { group: 'g' })]);
  assert.deepEqual(r.map((x) => x.shots.map((s) => s.id)), [['a'], ['b', 'c'], ['d'], ['e']]);
});
checkNow('the estimate: seconds x price x tries, a group once, the piece model where a shot has none, live shots left out', () => {
  const list = priceList(null);
  assert.deepEqual(list, SEED_PRICES);
  assert.equal(priceOf(list, 'kling 3.0').usd, 0.08);
  assert.equal(priceOf(list, 'Kling 3.0 (Higgsfield)').usd, 0.08, 'a longer name still finds it');
  assert.equal(priceOf(list, 'nothing like it'), null);
  const shots = [S('a', { secs: 4 }), S('b', { secs: 3, model: 'Seedance 2.0' }, { group: 'g' }), S('c', { secs: 2 }, { group: 'g' }), S('d', {}, { made: 'live' }), S('e', { model: 'Mystery 9' })];
  const e = estimate(shots, list, { model: 'Kling 3.0', tries: 2, live: (sh) => sh.fields.made === 'live' });
  // a: 4 s x 0.08 x 2 = 0.64; b+c: 5 s x 0.30 x 2 = 3.00; e: no price.
  assert.equal(Math.round(e.usd * 100) / 100, 3.64);
  assert.equal(e.secs, 14);
  assert.deepEqual(e.unpriced, ['Mystery 9']);
  assert.equal(e.shots, 4);
  assert.equal(money(3.64), '$3.64');
  assert.equal(money(1234.5), '$1,234.5');
});
checkNow('spend: the cost on every try, all of it or in a month', () => {
  const shots = [{ fields: { tries: [{ at: 10, cost: 1.2 }, { at: 20, cost: 0.4, cost_est: true }, { at: 30 }] } }, { fields: { tries: [{ at: 40, cost: 2 }] } }];
  assert.equal(spent(shots).usd, 3.6);
  assert.equal(spent(shots, { from: 15, to: 40 }).usd, 0.4);
});
checkNow('tool IDs: the old locked look is the ComfyUI LoRA', () => {
  assert.deepEqual(toolIdsOf({ fields: { element: { look: 'mom_v2', ids: { soul: 's1', kling: ' ' } } } }), { soul: 's1', lora: 'mom_v2' });
  assert.deepEqual(toolIdsOf({ fields: { element: { look: 'old', ids: { lora: 'new' } } } }), { lora: 'new' });
});
checkNow('timecode and the EDL: CMX 3600, back to back from one hour, reel named by shot code', () => {
  assert.equal(timecode(24 * 3600 + 25, 24), '01:00:01:01');
  assert.equal(timecode(30, 29.97), '00:00:01:00', '29.97 is counted at 30');
  const edl = toEdl([{ code: 'NB-E01-S01-01', file: 'NB-E01-S01-01.mp4', secs: 2, what: 'Mom' }, { code: 'NB-E01-S01-02', file: 'x.png', secs: 1.5, still: true }], { title: 'Reel 4', fps: 24 });
  const lines = edl.split('\r\n');
  assert.equal(lines[0], 'TITLE: Reel 4');
  assert.equal(lines[1], 'FCM: NON-DROP FRAME');
  assert.equal(lines[3], '001  NB-E01-S01-01 V     C        00:00:00:00 00:00:02:00 01:00:00:00 01:00:02:00');
  assert.equal(lines[4], '* FROM CLIP NAME: NB-E01-S01-01.mp4');
  assert.equal(lines[7], '002  NB-E01-S01-02 V     C        00:00:00:00 00:00:01:12 01:00:02:00 01:00:03:12');
  assert.match(edl, /COMMENT: NB-E01-S01-02 \(still stand-in\)/);
});
checkNow('the rough cut: starred takes, a shared take split by its shots, stills where there is no take', () => {
  const files = new Map([['v1', { name: 'one.mp4', secs: 4 }], ['v2', { name: 'group.mp4', secs: 10 }], ['p1', { name: 'still.png', secs: 0 }]]);
  const shots = [
    { id: 'a', text: 'A', fields: { gen: { secs: 4 }, star: { video: 'v1' } } },
    { id: 'b', text: 'B', fields: { gen: { secs: 3 }, group: 'g', star: { video: 'v2' } } },
    { id: 'c', text: 'C', fields: { gen: { secs: 2 }, group: 'g' } },
    { id: 'd', text: 'D', fields: { star: { still: 'p1' } } },
    { id: 'e', text: 'E', fields: {} }
  ];
  const ev = cutEvents([{ shots, code: (sh) => `X-${sh.id}` }], files);
  assert.deepEqual(ev.map((e) => [e.code, e.file_id, Math.round(e.secs * 100) / 100, Math.round(e.from * 100) / 100, !!e.still]), [
    ['X-a', 'v1', 4, 0, false], ['X-b', 'v2', 6, 0, false], ['X-c', 'v2', 4, 6, false], ['X-d', 'p1', 5, 0, true]
  ]);
  assert.equal(cutEvents([{ shots, code: (sh) => sh.id }], files, { stills: false }).length, 3);
});

// ---------- in the app ----------

const PORT = 4251;
const server = await serve(PORT);
const SHOTS = process.env.SHOTS || '';

const table = new Map();
const bucket = new Map();
const tasks = [];
let clock = Date.parse('2026-10-20T00:00:00Z');
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
  if (op === 'task') { tasks.push(arg); return true; }
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
  window.__asked = [];
  window.__claude = async (body) => {
    window.__asked.push(body);
    if (body.mode !== 'production') throw new Error('Not now');
    const el = (name) => body.elements.find((e) => e.name === name)?.id;
    if (body.task === 'breakdown') {
      const dojo = body.scenes.find((s) => /DOJO/.test(s.heading));
      return { scenes: dojo ? [{ scene: dojo.id, elements: [el('Katana')].filter(Boolean), missing: [{ name: 'Red apron', type: 'wardrobe' }] }] : [] };
    }
    if (body.task === 'shots') return { shots: [{ what: 'The gate in the rain', framing: 'Wide', after: '' }, { what: 'Kenji turns', framing: 'Close-up', after: '' }] };
    if (body.task === 'prompts') return { shots: body.scenes[0].shots.map((s) => ({ shot: s.id, still: `Still for ${s.what}`, video: `Video for ${s.what}`, elements: [] })) };
    if (body.task === 'captions') return { captions: body.platforms.map((p) => ({ platform: p.toLowerCase(), text: `Caption for ${p}` })) };
    return {};
  };
};

const put = (r) => {
  const at = tick();
  table.set(r.id, { parent_id: null, sort: 0, title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: Date.parse(at), ...r, user_id: 'u1', updated_at: at });
};
const para = (id, parent, sort, text, fields = {}) => put({ id, kind: 'para', parent_id: parent, sort, text, content: text ? [{ type: 'text', text }] : null, fields });
put({ id: 'area-writing', kind: 'area', title: 'Writing', sort: 1 });
put({ id: 'wd_nb', kind: 'world', title: 'The Ninja Bunch', area_id: 'area-writing' });
put({ id: 'pr_reel', kind: 'project', parent_id: 'wd_nb', title: 'Reel 4: Breakfast', area_id: 'area-writing', sort: 1, fields: { type: 'screenplay', numbered: true, levels: ['Act', 'Script', 'Scene'] } });
put({ id: 'ac_r', kind: 'act', parent_id: 'pr_reel', title: 'Screenplay', sort: 1 });
put({ id: 'ch_r', kind: 'chapter', parent_id: 'ac_r', title: 'Script', sort: 1 });
let n = 0;
const l = (id, text, el, extra = {}) => para(id, 'ch_r', (n += 1024), text, { el, ...extra });
l('pp_1', 'INT. KITCHEN - MORNING', 'scene', { code: '1' });
l('pp_2', 'Mother flips a pancake. Kenji sneaks in with the KATANA.', 'action');
l('pp_3', 'MOM', 'character');
l('pp_4', 'Sit.', 'dialogue');
l('pp_5', 'EXT. DOJO - DAY', 'scene', { code: '2' });
l('pp_6', 'Rain. A stranger at the gate.', 'action');
l('pp_7', 'KENJI', 'character');
l('pp_8', 'Who are you?', 'dialogue');
l('pp_9', 'KENJI', 'character');
l('pp_10', '(beat)', 'paren');
l('pp_11', 'Go home.', 'dialogue');
put({ id: 'no_p', kind: 'note', parent_id: 'pp_2', type: 'production', text: 'The apron must be the red one', fields: { chapter_id: 'ch_r' } });
put({ id: 'pg_chars', kind: 'page', parent_id: 'wd_nb', title: 'Characters', sort: 1 });
put({ id: 'pg_mom', kind: 'page', parent_id: 'pg_chars', title: 'Mom', sort: 1, fields: { element: { type: 'character', also: ['Mother'], snippet: 'Short, calm, grey bun' } } });
put({ id: 'pg_kenji', kind: 'page', parent_id: 'pg_chars', title: 'Kenji', sort: 2, fields: { element: { type: 'character' } } });
put({ id: 'pg_places', kind: 'page', parent_id: 'wd_nb', title: 'Places', sort: 2 });
put({ id: 'pg_kitchen', kind: 'page', parent_id: 'pg_places', title: 'Kitchen', sort: 1, fields: { element: { type: 'location' } } });
put({ id: 'pg_props', kind: 'page', parent_id: 'wd_nb', title: 'Props', sort: 3 });
put({ id: 'pg_katana', kind: 'page', parent_id: 'pg_props', title: 'Katana', sort: 1 });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==', 'base64');

const browser = pageFirst(await chromium.launch());
async function device(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark', acceptDownloads: true, ...opts });
  await ctx.exposeFunction('__remote', remote);
  await ctx.addInitScript(fake);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  // THROTTLE=8 copies the slow publish runner here.
  if (process.env.THROTTLE) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE) });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#editor .ProseMirror', { state: 'attached' });
  await sleep(800);
  return page;
}
const syncNow = (p) => p.evaluate(() => window.__sync.run());
const settle = async (p) => {
  await p.waitForFunction(() => window.__sync && !window.__sync.running, null, { timeout: 5000 }).catch(() => {});
  await syncNow(p);
  await sleep(300);
};
const go = (p, place) => p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
const row = (id) => table.get(id);
const live = () => [...table.values()].filter((r) => !r.deleted);
const shots = () => live().filter((r) => r.kind === 'shot').sort((a, b) => a.sort - b.sort);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const scene = (p, id) => p.locator(`.pd-scene[data-scene="${id}"]`);
const pick = async (p, label) => { await p.locator('.pop-menu .pop-item', { hasText: label }).first().click(); await sleep(250); };
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`); }
}

// The reel already has a piece code and some shots, with renders from earlier.
const fileRow = (id, title, type, shotId) => {
  put({ id, kind: 'file', title, fields: { type, size: 70, shot: shotId } });
  bucket.set(`u1/${id}`, { path: `u1/${id}`, type, data: PNG.toString('base64') });
};
table.get('wd_nb').fields = { production: { code: 'NB' } };
table.get('pr_reel').fields = { ...table.get('pr_reel').fields, code: 'E01' };
fileRow('fi_still_a', 'NB-E01-S01-01 a.png', 'image/png', 'sh_a');
fileRow('fi_take_a', 'kling take.mp4', 'video/mp4', 'sh_a');
fileRow('fi_still_b', 'NB-E01-S01-02 a.png', 'image/png', 'sh_b');
const T0 = Date.parse('2026-11-03T20:00:00Z');
put({ id: 'sh_a', kind: 'shot', parent_id: 'pp_1', sort: 1024, text: 'Mom flips the pancake', fields: { n: '1', framing: 'Medium', piece: 'pr_reel', still: 'Mom at the stove', video: 'She flips it high', gen: { secs: 4 }, tries: [{ id: 'tr_a1', at: T0, by: 'me', still: 'Mom at the stove', video: 'She flips it high', files: ['fi_still_a', 'fi_take_a'] }], star: { still: 'fi_still_a', video: 'fi_take_a' } } });
put({ id: 'sh_b', kind: 'shot', parent_id: 'pp_1', sort: 2048, text: 'Pancake in the air', fields: { n: '2', piece: 'pr_reel', gen: { secs: 3 }, tries: [{ id: 'tr_b1', at: T0, by: 'me', still: '', video: '', files: ['fi_still_b'] }], star: { still: 'fi_still_b' } } });
put({ id: 'sh_c', kind: 'shot', parent_id: 'pp_1', sort: 3072, text: 'Kenji in the doorway', fields: { n: '3', piece: 'pr_reel' } });
put({ id: 'sh_d', kind: 'shot', parent_id: 'pp_5', sort: 1024, text: 'The gate in the rain', fields: { n: '1', piece: 'pr_reel', made: 'live' } });
put({ id: 'bd-pp_1', kind: 'breakdown', parent_id: 'pp_1', fields: { add: [], drop: [], sig: 'x', piece: 'pr_reel' } });

const costText = (p) => p.locator('.pd-cost').innerText();
const openShot = async (p, id) => {
  const box = p.locator(`.pd-shot[data-shot="${id}"]`);
  await box.locator('.pd-toggle').waitFor({ state: 'visible', timeout: 15000 });
  if (!(await box.locator('.pd-detail').count())) await box.locator('.pd-toggle').click();
  // The settings fold into one line; Change opens them in place.
  await p.waitForSelector(`.pd-shot[data-shot="${id}"] .pd-genline`);
  if (!(await box.locator('.pd-gen').count())) await box.locator('.pd-genline .ghost-btn', { hasText: 'Change' }).click();
  await p.waitForSelector(`.pd-shot[data-shot="${id}"] .pd-gen`);
  return box;
};
// Types into a box and commits it, again if a redraw on the slow runner
// swapped the box out before the change landed.
const setInput = async (p, sel, value, done) => {
  for (let i = 0; ; i++) {
    const el = p.locator(sel).first();
    await el.fill(String(value));
    await el.dispatchEvent('change');
    await sleep(300);
    if (await done()) return;
    if (i === 3) throw new Error(`${sel} didn't keep ${value}`);
  }
};
const costIs = (p, re) => async () => { await p.waitForFunction((src) => new RegExp(src).test(document.querySelector('.pd-cost')?.innerText || ''), re.source, { timeout: 4000 }).catch(() => {}); return re.test(await costText(p)); };
const blur = async (p) => { await p.locator('.gv-title').click(); await sleep(500); };

try {
  const laptop = await device();
  await settle(laptop);
  await go(laptop, { view: 'production', id: 'pr_reel', tab: 'shots' });
  await laptop.waitForSelector('.pd-scene[data-scene="pp_1"] .pd-shot');

  await check('Make shows the cost: an estimate from the price list and what was spent', async () => {
    await laptop.waitForSelector('.pd-cost');
    const t = await costText(laptop);
    // No model yet: every shot is unpriced, and nothing is spent.
    assert.match(t, /About \$0\s+to make 3 generated shots, 12 s/, t);
    assert.match(t, /No price for No model/);
    assert.match(t, /Spent \$0 here/);
    assert.match(t, /Prices from Nov 3/);
    await setInput(laptop, '.pd-cost input[aria-label^="Model for finals"]', 'Kling 3.0', costIs(laptop, /About \$2\.88/));
    // 4 + 3 + 5 s at $0.08, twice; the live dojo shot isn't generated.
    await setInput(laptop, '.pd-cost input[aria-label="Tries per shot"]', 2, costIs(laptop, /About \$1\.92\s+to make 3 generated shots, 12 s/));
    await settle(laptop);
    assert.deepEqual(row('pr_reel').fields.gen, { model: 'Kling 3.0', tries: 2 });
  });

  await check('a shot’s generation details: model, seconds, first and last frame, the line it’s timed to', async () => {
    const box = await openShot(laptop, 'sh_a');
    const g = box.locator('.pd-gen');
    assert.equal(await g.locator('input[aria-label="Model"]').getAttribute('placeholder'), 'Kling 3.0', 'the piece’s model shows as the default');
    const stored = (k, v) => async () => { await settle(laptop); return row('sh_a').fields.gen?.[k] === v; };
    await setInput(laptop, '.pd-shot[data-shot="sh_a"] .pd-gen input[aria-label="Model"]', 'Seedance 2.0', stored('model', 'Seedance 2.0'));
    await setInput(laptop, '.pd-shot[data-shot="sh_a"] .pd-gen input[aria-label="Length in seconds"]', 6, stored('secs', 6));
    for (let i = 0; i < 4 && !(await stored('first', 'fi_still_a')()); i++) await laptop.locator('.pd-shot[data-shot="sh_a"] .pd-gen select[aria-label="First frame"]').selectOption('fi_still_a');
    await sleep(300);
    for (let i = 0; i < 4 && !(await stored('sync', 'MOM: Sit.')()); i++) await laptop.locator('.pd-shot[data-shot="sh_a"] .pd-gen select[aria-label="Timed to"]').selectOption('MOM: Sit.');
    await sleep(400);
    await settle(laptop);
    assert.deepEqual(row('sh_a').fields.gen, { secs: 6, model: 'Seedance 2.0', first: 'fi_still_a', sync: 'MOM: Sit.' });
    // 6 s at $0.30 + 8 s at $0.08, twice.
    await laptop.waitForFunction(() => /About \$4\.88/.test(document.querySelector('.pd-cost')?.innerText || ''));
    await shot(laptop, 'gen-details');
  });

  await check('two shots made in one generation: one bracket, counted once, each keeps its code', async () => {
    await laptop.locator('.pd-shot[data-shot="sh_b"] .pd-shot-row .more-btn').click();
    await pick(laptop, 'Make with the next shot, in one generation');
    await laptop.waitForSelector('.pd-shot[data-shot="sh_c"].grouped.group-last');
    await settle(laptop);
    assert.ok(row('sh_b').fields.group);
    assert.equal(row('sh_c').fields.group, row('sh_b').fields.group);
    const codes = await scene(laptop, 'pp_1').locator('.pd-code').evaluateAll((els) => els.map((e) => e.dataset.code));
    assert.deepEqual(codes, ['NB-E01-S01-01', 'NB-E01-S01-02', 'NB-E01-S01-03']);
    await openShot(laptop, 'sh_b');
    assert.match(await laptop.locator('.pd-shot[data-shot="sh_b"] .pd-gen-run').textContent(), /one generation with shots 2 to 3 \(8 s\)/);
    // Same seconds and model (the group's first), so the same estimate.
    assert.match(await costText(laptop), /About \$4\.88/);
    await laptop.locator('.pd-shot[data-shot="sh_c"] .pd-shot-row .more-btn').click();
    await pick(laptop, 'Make on its own again');
    await settle(laptop);
    assert.equal(row('sh_c').fields.group, undefined);
    assert.equal(row('sh_b').fields.group, undefined, 'a group of one is no group');
    await laptop.locator('.pd-shot[data-shot="sh_b"] .pd-shot-row .more-btn').click();
    await pick(laptop, 'Make with the next shot, in one generation');
    await settle(laptop);
    assert.equal(row('sh_c').fields.group, row('sh_b').fields.group);
  });

  await check('the price list: edited on Make, synced, and the estimate follows on another device', async () => {
    await laptop.locator('.pd-cost-prices').click();
    await laptop.waitForSelector('.pd-modal .pd-price-row');
    const at = await laptop.evaluate(() => [...document.querySelectorAll('.pd-price-row:not(.head)')].findIndex((r) => r.querySelector('input[aria-label="Model"]').value === 'Kling 3.0'));
    await laptop.locator('.pd-price-row:not(.head)').nth(at).locator('input[aria-label="Dollars"]').fill('0.1');
    await shot(laptop, 'prices');
    await laptop.locator('.pd-modal .pill', { hasText: 'Save' }).click();
    await laptop.waitForFunction(() => !document.querySelector('.pd-modal'));
    await settle(laptop);
    const list = row('prices').fields.list;
    const k3 = list.find((p) => p.model === 'Kling 3.0');
    assert.equal(k3.usd, 0.1);
    assert.equal(k3.by, 'me');
    assert.equal(list.find((p) => p.model === 'Seedance 2.0').checked, '2026-11-03', 'untouched prices keep their date');
    // 6 s at $0.30 + 8 s at $0.10, twice.
    await laptop.waitForFunction(() => /About \$5\.20/.test(document.querySelector('.pd-cost')?.innerText || ''));
    const phone = await device({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await settle(phone);
    await go(phone, { view: 'production', id: 'pr_reel', tab: 'shots' });
    await phone.waitForFunction(() => /About \$5\.20/.test(document.querySelector('.pd-cost')?.innerText || ''), null, { timeout: 6000 });
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(wide <= 1, `page scrolls sideways by ${wide}px`);
    await openShot(phone, 'sh_a');
    const wide2 = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(wide2 <= 1, `the generation details scroll sideways by ${wide2}px`);
    await shot(phone, 'phone-shot');
    assert.deepEqual(phone.errors, []);
    await phone.context().close();
  });

  await check('a try Claude brings back through the connector shows up: model, cost, spend, star', async () => {
    // What the connector's add_try and star write: a file row with the shot, a try with model and cost.
    fileRow('fi_hf_c', 'NB-E01-S01-03 higgsfield.mp4', 'video/mp4', 'sh_c');
    const c = row('sh_c');
    put({ ...c, fields: { ...c.fields, tries: [{ id: 'tr_c1', at: Date.now(), by: 'claude', still: '', video: 'Kenji steps in', files: ['fi_hf_c'], links: ['https://higgsfield.ai/job/123'], model: 'Kling 3.0', secs: 5, settings: 'seed 42', cost: 0.4 }], star: { video: 'fi_hf_c' }, star_by: 'claude' } });
    await settle(laptop);
    await laptop.waitForFunction(() => /Spent \$0\.40 here/.test(document.querySelector('.pd-cost')?.innerText || ''), null, { timeout: 6000 });
    assert.match(await costText(laptop), /\$0\.40 in [A-Z][a-z]+/, 'and this month');
    await openShot(laptop, 'sh_c');
    await laptop.waitForSelector('.pd-shot[data-shot="sh_c"] .pd-render.starred[data-file="fi_hf_c"]');
    assert.match(await laptop.locator('.pd-shot[data-shot="sh_c"] .pd-render[data-file="fi_hf_c"]').getAttribute('title'), /Claude · Kling 3\.0 · 5 s · \$0\.40/);
    assert.equal(await laptop.locator('.pd-shot[data-shot="sh_c"] .pd-link').getAttribute('href'), 'https://higgsfield.ai/job/123');
    assert.equal(await laptop.locator('.pd-shot[data-shot="sh_c"]').getAttribute('data-stage'), 'take');
  });

  await check('a render whose try was lost (two devices saving the shot at once) goes back on its shot', async () => {
    fileRow('fi_lost', 'NB-E01-S01-02 b.png', 'image/png', 'sh_b');
    await settle(laptop);
    await go(laptop, { view: 'production', id: 'pr_reel', tab: 'shots' });
    await laptop.waitForFunction(() => !!document.querySelector('.pd-shot[data-shot="sh_b"]'));
    await sleep(500);
    await settle(laptop);
    const tries = row('sh_b').fields.tries;
    assert.ok(tries.some((t) => t.files.includes('fi_lost') && t.healed), JSON.stringify(tries));
    assert.equal(tries.filter((t) => t.files.includes('fi_lost')).length, 1, 'only once');
    await go(laptop, { view: 'production', id: 'pr_reel', tab: 'shots' });
    await sleep(500);
    await settle(laptop);
    assert.equal(row('sh_b').fields.tries.filter((t) => t.files.includes('fi_lost')).length, 1, 'still only once');
  });

  await check('what a try really cost, typed in the viewer, adds to the spend', async () => {
    await openShot(laptop, 'sh_a');
    await laptop.locator('.pd-shot[data-shot="sh_a"] .pd-render[data-file="fi_take_a"]').click();
    await laptop.waitForSelector('.pd-viewer .pd-cost-input');
    await laptop.locator('.pd-viewer .pd-cost-input').fill('1.25');
    await laptop.locator('.pd-viewer .pd-cost-input').dispatchEvent('change');
    await sleep(400);
    await laptop.keyboard.press('Escape');
    await settle(laptop);
    assert.equal(row('sh_a').fields.tries[0].cost, 1.25);
    await laptop.waitForFunction(() => /Spent \$1\.65 here/.test(document.querySelector('.pd-cost')?.innerText || ''));
  });

  await check('Cast and places: the rules for every shot, a character sheet, place lighting and tool IDs', async () => {
    await laptop.locator('.gv-levels .chip[data-tab="kit"]').click();
    await laptop.waitForSelector('.pd-body .cd-rules-line');
    await laptop.locator('.pd-body .cd-rules-line').click();
    const rules = laptop.locator('.pd-body .cd-rules-box');
    await rules.locator('select[aria-label="Frame"]').selectOption('9:16');
    await sleep(300);
    await rules.locator('textarea[aria-label="Always and never"]').fill('Kenji is always a head shorter than Mom.\nNever any text in frame.');
    await blur(laptop);
    // A name opens their details; on an AI film For AI tools starts open.
    await laptop.locator('.pd-body .lw-row[data-row="pg_mom"] .lw-name').click();
    const mom = laptop.locator('.pd-body .cd[data-element="pg_mom"]');
    await mom.waitFor();
    assert.equal(await mom.locator('.cd-ai').isVisible(), true, 'open on an AI film');
    assert.deepEqual(await mom.locator('.cd-slot .cd-slot-label').allTextContents(), ['Front', '3/4', 'Side', 'Back']);
    await mom.locator('.cd-slot[data-slot="front"] input[type=file]').setInputFiles({ name: 'mom front.png', mimeType: 'image/png', buffer: PNG });
    await laptop.waitForSelector('.pd-body .cd[data-element="pg_mom"] .cd-slot[data-slot="front"] img');
    await laptop.locator('.pd-body .cd[data-element="pg_mom"] input[aria-label="Higgsfield Soul ID"]').fill('soul_mom_01');
    await laptop.locator('.pd-body .cd[data-element="pg_mom"] input[aria-label="ComfyUI LoRA"]').fill('mom_v2');
    await blur(laptop);
    await laptop.locator('.pd-body .lw-row[data-row="pg_kitchen"] .lw-name').click();
    const kitchen = laptop.locator('.pd-body .cd[data-element="pg_kitchen"]');
    await kitchen.waitFor();
    await kitchen.locator('input[aria-label="Lighting"]').fill('Low morning sun through the blinds, warm');
    await kitchen.locator('input[aria-label="Kling reference"]').fill('kl_kitchen');
    assert.equal(await kitchen.locator('input[aria-label="Higgsfield Soul ID"]').count(), 0, 'Soul IDs are for characters');
    await blur(laptop);
    await settle(laptop);
    assert.deepEqual(row('wd_nb').fields.production, { code: 'NB', aspect: '9:16', constraints: 'Kenji is always a head shorter than Mom.\nNever any text in frame.' });
    const m = row('pg_mom').fields.element;
    assert.ok(m.views.front);
    assert.equal(row(m.views.front).kind, 'file');
    assert.deepEqual(m.ids, { soul: 'soul_mom_01' });
    assert.equal(m.look, 'mom_v2');
    assert.equal(row('pg_kitchen').fields.element.lighting, 'Low morning sun through the blinds, warm');
    assert.deepEqual(row('pg_kitchen').fields.element.ids, { kling: 'kl_kitchen' });
    await shot(laptop, 'kit');
    // No switches: how the film is made decides what shows (an AI film shows the tool IDs).
    await laptop.locator('.gv-tools .more-btn').click();
    assert.equal(await laptop.locator('.pop-menu .pop-item', { hasText: /^(Hide|Show) / }).count(), 0, 'no show and hide switches in ⋯');
    await laptop.keyboard.press('Escape');
    assert.equal(await laptop.locator('.pd-body .cd-ids').first().isVisible(), true);
  });

  await check('the kit reaches Claude’s prompts: rules, lighting, IDs, sheet, and each shot’s model and timing', async () => {
    await laptop.locator('.gv-levels .chip[data-tab="shots"]').click();
    await scene(laptop, 'pp_1').locator('.pd-add .ghost-btn', { hasText: 'Claude: write prompts' }).click();
    await laptop.waitForFunction(() => window.__asked.some((b) => b.task === 'prompts'));
    const ask = await laptop.evaluate(() => window.__asked.filter((b) => b.task === 'prompts').at(-1));
    assert.equal(ask.rules, 'Frame 9:16\nKenji is always a head shorter than Mom.\nNever any text in frame.');
    const mom = ask.elements.find((e) => e.name === 'Mom');
    assert.deepEqual(mom.ids, { soul: 'soul_mom_01', lora: 'mom_v2' });
    assert.deepEqual(mom.views, ['front']);
    assert.equal(ask.elements.find((e) => e.name === 'Kitchen').lighting, 'Low morning sun through the blinds, warm');
    const a = ask.scenes[0].shots.find((s) => s.id === 'sh_a');
    assert.deepEqual([a.model, a.secs, a.sync], ['Seedance 2.0', 6, 'MOM: Sit.']);
    const c = ask.scenes[0].shots.find((s) => s.id === 'sh_c');
    assert.equal(c.model, 'Kling 3.0', 'the piece’s model where the shot has none');
    assert.ok(c.group);
    await laptop.waitForFunction(() => !document.querySelector('.gv-claude'));
    await settle(laptop);
  });

  await check('a shot’s kit .zip carries the sheet, the lighting, the IDs and the rules', async () => {
    const box = await openShot(laptop, 'sh_a');
    const [kit] = await Promise.all([laptop.waitForEvent('download'), box.locator('.ghost-btn', { hasText: 'Download kit' }).click()]);
    const zip = await readFile(await kit.path(), 'latin1');
    assert.match(zip, /Generate: Seedance 2\.0, 6 s/);
    assert.match(zip, /Timed to: MOM: Sit\./);
    assert.match(zip, /Mom \(Character\) \[Higgsfield Soul: soul_mom_01; LoRA: mom_v2\]: Short, calm, grey bun/);
    assert.match(zip, /Lighting: Low morning sun through the blinds, warm/);
    assert.match(zip, /SHOW RULES\nFrame 9:16, 24 fps\nKenji is always/);
    assert.match(zip, /References\/Mom front\.png/);
  });

  await check('Deliver: the rough cut for Resolve, and the hand-off with every take named by its code', async () => {
    // The piece's Share and post (One home: Alt + 6 no longer leads there; its ⋯ does).
    await go(laptop, { view: 'deliver', id: 'pr_reel' });
    await laptop.waitForFunction(() => document.documentElement.dataset.view === 'deliver');
    await laptop.waitForSelector('.pd-handoff');
    assert.equal(await laptop.locator('.pd-file:visible').count(), 0, 'the single files start folded');
    await laptop.locator('.pd-fold', { hasText: 'One file at a time' }).click();
    await shot(laptop, 'deliver');
    const [edl] = await Promise.all([laptop.waitForEvent('download'), laptop.locator('.pd-file', { hasText: 'Rough cut (.edl)' }).click()]);
    assert.equal(edl.suggestedFilename(), 'Reel 4- Breakfast.edl');
    const text = await readFile(await edl.path(), 'utf8');
    const lines = text.split('\r\n');
    assert.equal(lines[0], 'TITLE: Reel 4: Breakfast');
    // Shot 1: its take (6 s, as long as the shot says, since the fake take has no length).
    assert.equal(lines[3], '001  NB-E01-S01-01 V     C        00:00:00:00 00:00:06:00 01:00:00:00 01:00:06:00');
    assert.equal(lines[4], '* FROM CLIP NAME: NB-E01-S01-01.mp4');
    // Shots 2 and 3 share shot 3's Higgsfield take: two parts of one file, named by the run's first shot.
    assert.match(text, /002  NB-E01-S01-02 V     C        00:00:00:00 00:00:03:00 01:00:06:00 01:00:09:00\r\n\* FROM CLIP NAME: NB-E01-S01-02\.mp4\r\n\* COMMENT: NB-E01-S01-02 Pancake/);
    assert.match(text, /003  NB-E01-S01-02 V     C        00:00:03:00 00:00:08:00 01:00:09:00 01:00:14:00\r\n\* FROM CLIP NAME: NB-E01-S01-02\.mp4\r\n\* COMMENT: NB-E01-S01-03 Kenji/);
    assert.doesNotMatch(text, /S02-01/, 'the dojo shot has nothing starred');
    const [hand] = await Promise.all([laptop.waitForEvent('download'), laptop.locator('.pd-handoff').click()]);
    const zip = await readFile(await hand.path(), 'latin1');
    assert.match(zip, /Rough cut\.edl/);
    assert.match(zip, /Takes\/NB-E01-S01-01\.mp4/);
    assert.match(zip, /Takes\/NB-E01-S01-02\.mp4/);
    assert.doesNotMatch(zip, /Takes\/NB-E01-S01-03/);
    assert.match(zip, /Shot list\.csv/);
    assert.match(zip, /Subtitles\.srt/);
    assert.match(zip, /Source clip filename/);
  });

  await check('a filmed shot in an AI film: Got it in one tap, no models or prompts; the cost line stays for the rest', async () => {
    await go(laptop, { view: 'production', id: 'pr_reel' });
    await laptop.waitForFunction(() => document.documentElement.dataset.view === 'production');
    await laptop.locator('.gv-levels .chip[data-tab="shots"]').click();
    await laptop.waitForSelector('.pd-cost');
    const live = laptop.locator('.pd-shot[data-shot="sh_d"]');
    assert.equal(await live.locator('.pd-made').innerText(), 'Live action', 'filmed, inside an AI film, says so');
    assert.equal(await live.locator('.pd-stage').count(), 0, 'Planned or Got it, not the five stages');
    await live.locator('.pd-toggle').click();
    await laptop.waitForSelector('.pd-shot[data-shot="sh_d"] .pd-detail.filmed');
    assert.equal(await live.locator('.pd-gen, .pd-genline, textarea[aria-label="Still prompt"]').count(), 0, 'nothing about models or prompts');
    await live.locator('.pd-note').fill('35mm, slow push in');
    await blur(laptop);
    assert.equal(await scene(laptop, 'pp_5').locator('.pd-left').innerText(), '1 of 1 still to get');
    await live.locator('.pd-got').click();
    await laptop.waitForFunction(() => document.querySelector('.pd-shot[data-shot="sh_d"] .pd-got')?.getAttribute('aria-pressed') === 'true');
    await settle(laptop);
    assert.ok(row('sh_d').fields.got > 0, 'Got it is when');
    assert.equal(row('sh_d').fields.note, '35mm, slow push in');
    assert.equal(await scene(laptop, 'pp_5').locator('.pd-left').innerText(), 'All got');
    await shot(laptop, 'filmed');
    await laptop.locator('.pd-shot[data-shot="sh_d"] .pd-got').click();
    await laptop.waitForFunction(() => document.querySelector('.pd-shot[data-shot="sh_d"] .pd-got')?.getAttribute('aria-pressed') === 'false');
    await settle(laptop);
    assert.equal(row('sh_d').fields.got, undefined, 'a second tap: still to get');
  });

  await check('Storyboard: the frames are the shooting checklist (tick, N of M got, Left to shoot); an empty frame offers Sketch and Photo', async () => {
    await laptop.locator('.gv-levels .chip[data-tab="board"]').click();
    await laptop.waitForSelector('.pd-board .pd-card');
    const card = laptop.locator('.pd-card[data-shot="sh_d"]');
    assert.equal(await card.locator('.pd-tick').count(), 1, 'a filmed shot has a tick on its frame');
    assert.equal(await laptop.locator('.pd-card:not([data-shot="sh_d"]) .pd-tick').count(), 0, 'generated shots have none');
    assert.match(await laptop.locator('.pd-got-count').innerText(), /^0 of 1 got$/);
    await card.locator('.pd-tick').click();
    await laptop.waitForFunction(() => document.querySelector('.pd-card[data-shot="sh_d"] .pd-tick')?.getAttribute('aria-pressed') === 'true');
    await settle(laptop);
    assert.ok(row('sh_d').fields.got > 0, 'one tap on the frame: got');
    assert.equal(await laptop.locator('.ss-pop, .pd-shot.open').count(), 0, 'without opening the shot');
    assert.match(await laptop.locator('.pd-got-count').innerText(), /^1 of 1 got$/);
    await laptop.locator('.pd-leftonly').click();
    await laptop.waitForSelector('.pd-leftonly[aria-pressed="true"]');
    assert.equal(await laptop.locator('.pd-card[data-shot="sh_d"]').count(), 0, 'Left to shoot hides it');
    await laptop.locator('.pd-leftonly').click();
    await laptop.waitForSelector('.pd-card[data-shot="sh_d"]');
    await laptop.locator('.pd-card[data-shot="sh_d"] .pd-tick').click();
    await laptop.waitForFunction(() => document.querySelector('.pd-card[data-shot="sh_d"] .pd-tick')?.getAttribute('aria-pressed') === 'false');
    // An empty frame: Sketch and Photo right in it; the sketch lands as its board frame.
    const empty = laptop.locator('.pd-card:has(.pd-empty)').first();
    const id = await empty.getAttribute('data-shot');
    assert.deepEqual(await empty.locator('.pd-empty-btn').allTextContents(), ['Sketch', 'Photo']);
    await empty.locator('.pd-empty-btn', { hasText: 'Sketch' }).click();
    await laptop.waitForSelector('.sk-pad canvas');
    await laptop.evaluate(() => {
      const cv = document.querySelector('.sk-pad canvas');
      const r = cv.getBoundingClientRect();
      const at = (x, y) => ({ clientX: r.left + x * r.width, clientY: r.top + y * r.height, pointerType: 'mouse', pointerId: 1, pressure: 0.5, bubbles: true, buttons: 1 });
      cv.dispatchEvent(new PointerEvent('pointerdown', at(0.2, 0.3)));
      cv.dispatchEvent(new PointerEvent('pointermove', at(0.6, 0.7)));
      cv.dispatchEvent(new PointerEvent('pointerup', at(0.6, 0.7)));
    });
    await laptop.locator('.sk-pad .sk-btn.go').click();
    await laptop.waitForFunction((id) => document.querySelector(`.pd-card[data-shot="${id}"] .pd-pic img`), id);
    await settle(laptop);
    assert.ok(row(id).fields.star?.board, 'the sketch is its board frame');
    // Arrow keys step frame to frame; One column shows the words beside.
    await laptop.locator('.pd-card').first().focus();
    await laptop.keyboard.press('ArrowRight');
    assert.equal(await laptop.evaluate(() => [...document.querySelectorAll('.pd-card')].indexOf(document.activeElement)), 1);
    await laptop.locator('.pd-lay').click();
    await laptop.waitForSelector('.pd-board.column');
    await laptop.locator('.pd-lay').click();
    await laptop.waitForSelector('.pd-board:not(.column)');
  });

  assert.deepEqual(laptop.errors, []);
} catch (e) {
  failed += 1;
  console.log(`FAIL ${e.message}`);
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('aiprod: all passed');
