// Production: a script's scenes with the elements they use (found in the
// words, added or taken out by hand, or by Claude), shots under each scene
// with codes that never change, prompts and renders with a star on the one
// that worked, the storyboard, the kit (bible pages as elements), shoot days
// with a one-page call sheet that goes to Daybook, posting captions, and the
// shot list and subtitles out to Resolve. window.__claude stands in for the
// server and window.__daybook for Daybook.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { shotCode, shotNumber, shotForName, findElements, sceneElements, withRenders, withPrompts, shotStage, toSrt, speechesIn, toCsv, dayTask, guessType, pad } from '../src/production.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let failed = 0;
const checkNow = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); } };

// ---------- without a browser ----------

checkNow('shot codes: show, piece, scene and shot, padded for file names', () => {
  assert.equal(shotCode({ show: 'NB', piece: 'E01', scene: '3A', shot: '4' }), 'NB-E01-S03A-04');
  assert.equal(shotCode({ show: 'nb', scene: '12', shot: '1A' }), 'NB-S12-01A');
  assert.equal(shotCode({ shot: '2' }), '02');
  assert.equal(pad('A1'), 'A01');
});
checkNow('a shot added between 1 and 2 is 1A; at the end it carries on', () => {
  assert.equal(shotNumber(['1', '2'], 1), '1A');
  assert.equal(shotNumber(['1', '2']), '3');
  assert.equal(shotNumber([], 0), '1');
  assert.equal(shotNumber(['1', '1A', '2'], 2), '1B');
});
checkNow('a file name with a shot code finds its shot (the longest code wins)', () => {
  const codes = new Map([['NB-E01-S01-01', 'a'], ['NB-E01-S01-01A', 'b'], ['NB-E01-S02-01', 'c']]);
  assert.equal(shotForName('nb-e01-s01-01a take 3.mp4', codes), 'b');
  assert.equal(shotForName('NB-E01-S02-01.png', codes), 'c');
  assert.equal(shotForName('random.png', codes), null);
});
checkNow('elements are found by name, by another name, or by the name over a line', () => {
  const els = [{ id: 'm', title: 'Mom', fields: { element: { also: ['Mother'] } } }, { id: 'k', title: 'Kenji', fields: { element: {} } }, { id: 'kt', title: 'Katana', fields: { element: {} } }, { id: 'o', title: 'Om', fields: { element: {} } }];
  assert.deepEqual(findElements('Mother waits. The KATANA gleams.', [], els), ['m', 'kt']);
  assert.deepEqual(findElements('Nobody here.', ['KENJI (V.O.)'], els), ['k']);
  assert.deepEqual(findElements('Momentum builds.', [], els), [], 'not inside other words');
  assert.deepEqual(sceneElements(['m', 'kt'], { fields: { add: ['k'], drop: ['kt'] } }), ['m', 'k']);
});
checkNow('renders keep the prompts that made them; new prompts keep the old ones', () => {
  let f = { still: 'A', video: 'B' };
  f = withRenders(f, ['f1'], 'me', 1);
  f = withRenders(f, ['f2'], 'me', 2);
  assert.equal(f.tries.length, 1, 'same prompts, same try');
  assert.deepEqual(f.tries[0].files, ['f1', 'f2']);
  f = { ...f, still: 'A2' };
  f = withRenders(f, ['f3'], 'me', 3);
  assert.equal(f.tries.length, 2);
  f = withPrompts(f, { still: 'C', video: 'D' }, 'claude', 4);
  assert.equal(f.tries.length, 2, 'A2/B was already kept with its render');
  f = withPrompts(f, { still: 'E' }, 'me', 5);
  assert.equal(f.tries.length, 3, 'C/D had no render, so it is kept now');
  assert.equal(f.tries[2].by, 'claude');
  assert.equal(f.video, 'D');
  assert.equal(shotStage({ fields: f }), 'renders');
  assert.equal(shotStage({ fields: { ...f, star: { still: 'f1' } } }), 'still');
  assert.equal(shotStage({ fields: {} }), 'plan');
});
checkNow('subtitles: one per speech, in order, names left out unless asked', () => {
  const rows = [['character', 'MOM'], ['dialogue', 'Sit.'], ['action', 'He sits.'], ['character', 'KENJI (V.O.)'], ['dialogue', 'Who are you?'], ['character', 'KENJI'], ['paren', '(beat)'], ['dialogue', 'Go home.']].map(([el, text]) => ({ text, fields: { el } }));
  const sp = speechesIn(rows);
  assert.deepEqual(sp, [{ who: 'MOM', text: 'Sit.' }, { who: 'KENJI', text: 'Who are you?' }, { who: 'KENJI', text: 'Go home.' }]);
  const srt = toSrt(sp);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:01,999\nSit\.\n/);
  assert.match(srt, /3\n00:00:04,000 --> 00:00:05,999\nGo home\.\n/);
  assert.match(toSrt(sp, { names: true }), /MOM: Sit\./);
});
checkNow('the shot list is CSV that Excel and Resolve read', () => {
  assert.equal(toCsv([['a', 'b,c'], ['say "hi"', '']]), 'a,"b,c"\r\n"say ""hi""",\r\n');
});
checkNow('a shoot day goes to Daybook on its date at call time', () => {
  const t = dayTask({ id: 'sd_1', fields: { date: '2027-02-03', call: '07:30', place: 'Echo Park', notes: 'Bring rain covers' } }, { title: 'Reel 4' }, 'https://x/inkwell/');
  assert.deepEqual(t, { id: 'inkwell-sd_1', title: 'Shoot: Reel 4 at Echo Park', notes: 'Bring rain covers', link: 'https://x/inkwell/?open=sd_1', deleted: false, day: '2027-02-03', start_min: 450 });
});
checkNow('a bible page is guessed from the page it sits in', () => {
  assert.equal(guessType('Characters'), 'character');
  assert.equal(guessType('Places'), 'location');
  assert.equal(guessType('Costumes'), 'wardrobe');
  assert.equal(guessType('Rules'), null);
});

// ---------- in the app ----------

const PORT = 4197;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
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
  window.__daybook = (task) => window.__remote('task', task);
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

const browser = await chromium.launch();
async function device(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark', acceptDownloads: true, ...opts });
  await ctx.exposeFunction('__remote', remote);
  await ctx.addInitScript(fake);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
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

try {
  const laptop = await device();
  await settle(laptop);

  await check('Ctrl+Shift+S from the script opens its production: scenes with codes, elements found, production notes', async () => {
    await go(laptop, { view: 'write', chapterId: 'ch_r' });
    await laptop.waitForSelector('html.script #editor p[data-eid="pp_2"]');
    await laptop.locator('#editor p[data-eid="pp_2"]').click();
    await laptop.keyboard.press('Control+Shift+S');
    await laptop.waitForSelector('html[data-view="production"] .pd-scene[data-scene="pp_1"]');
    const titles = await laptop.locator('.pd-scene-title').allTextContents();
    assert.deepEqual(titles, ['1INT. KITCHEN - MORNING', '2EXT. DOJO - DAY']);
    assert.deepEqual(await scene(laptop, 'pp_1').locator('.pd-chip:not(.add)').allTextContents(), ['Mom', 'Kenji', 'Kitchen'], 'Mom by another name, the kitchen in the heading');
    assert.deepEqual(await scene(laptop, 'pp_5').locator('.pd-chip:not(.add)').allTextContents(), ['Kenji'], 'Kenji by the name over his lines');
    assert.equal(await scene(laptop, 'pp_1').locator('.pd-notes li').textContent(), 'The apron must be the red one');
    await settle(laptop);
    assert.equal(row('wd_nb').fields.production.code, 'NB', 'the show got a code from its name');
    assert.equal(await laptop.locator('.crumb').textContent().then((t) => /Production/.test(t)).catch(() => true), true);
  });

  await check('a piece code, then shots: codes that never change, 1A for one added between', async () => {
    const pc = laptop.locator('.pd-code-input[aria-label="Piece code"]');
    await pc.fill('e01');
    await pc.press('Enter');
    await sleep(400);
    await scene(laptop, 'pp_1').locator('.pd-add .ghost-btn', { hasText: '+ Shot' }).click();
    await sleep(300);
    await laptop.keyboard.type('Mom flips the pancake');
    await laptop.keyboard.press('Enter');
    await sleep(200);
    await scene(laptop, 'pp_1').locator('.pd-add .ghost-btn', { hasText: '+ Shot' }).click();
    await sleep(300);
    await laptop.keyboard.type('Kenji in the doorway');
    await laptop.keyboard.press('Tab');
    await laptop.keyboard.type('Wide, low angle');
    await laptop.keyboard.press('Enter');
    await sleep(300);
    const first = scene(laptop, 'pp_1').locator('.pd-shot').first();
    await first.locator('.more-btn').click();
    await pick(laptop, 'Add a shot after this one');
    await laptop.keyboard.type('Pancake in the air');
    await laptop.keyboard.press('Enter');
    await sleep(400);
    await settle(laptop);
    const codes = await scene(laptop, 'pp_1').locator('.pd-code').allTextContents();
    assert.deepEqual(codes, ['NB-E01-S01-01', 'NB-E01-S01-01A', 'NB-E01-S01-02']);
    assert.equal(row('pr_reel').fields.code, 'E01');
    const s = shots();
    assert.deepEqual(s.map((x) => [x.parent_id, x.fields.n, x.text]), [['pp_1', '1', 'Mom flips the pancake'], ['pp_1', '1A', 'Pancake in the air'], ['pp_1', '2', 'Kenji in the doorway']]);
    assert.equal(s[2].fields.framing, 'Wide, low angle');
    assert.ok(row('bd-pp_1').fields.sig, 'the scene as it was when shots were planned');
    await shot(laptop, 'production-shots');
  });

  await check('the Kit: a bible page becomes an element, gets its look; the scene finds it', async () => {
    await laptop.locator('.gv-levels .chip[data-tab="kit"]').click();
    await laptop.waitForSelector('.pd-el[data-element="pg_mom"]');
    await laptop.locator('.pd-add .ghost-btn', { hasText: 'Use a bible page' }).click();
    await laptop.locator('.pop-menu .pop-item', { hasText: 'Katana' }).click();
    await laptop.locator('.pop-menu .pop-item', { hasText: 'Prop (likely)' }).click();
    await laptop.waitForSelector('.pd-el[data-element="pg_katana"]');
    await laptop.locator('.pd-el[data-element="pg_katana"] textarea[aria-label="Looks"]').fill('A battered wooden practice sword');
    await laptop.locator('.pd-el[data-element="pg_katana"] input[aria-label="Locked look"]').fill('katana_v2 LoRA');
    await laptop.locator('.pd-style').click();
    await laptop.keyboard.type('Flat cel shading, warm palette');
    await laptop.locator('.gv-title').click();
    await sleep(700);
    await settle(laptop);
    assert.deepEqual(row('pg_katana').fields.element, { type: 'prop', snippet: 'A battered wooden practice sword', look: 'katana_v2 LoRA' });
    assert.equal(row('wd_nb').fields.production.style, 'Flat cel shading, warm palette');
    await laptop.locator('.pd-el[data-element="pg_mom"] input[type=file]').setInputFiles({ name: 'mom-ref.png', mimeType: 'image/png', buffer: PNG });
    await laptop.waitForSelector('.pd-el[data-element="pg_mom"] .pd-refs .pd-render img');
    await settle(laptop);
    assert.equal(row('pg_mom').fields.element.refs.length, 1);
    await shot(laptop, 'production-kit');
    await laptop.locator('.gv-levels .chip[data-tab="shots"]').click();
    await laptop.waitForSelector('.pd-scene[data-scene="pp_1"]');
    assert.deepEqual(await scene(laptop, 'pp_1').locator('.pd-chip:not(.add)').allTextContents(), ['Mom', 'Kenji', 'Kitchen', 'Katana']);
  });

  await check('taking an element out of a scene, and adding one by hand', async () => {
    await scene(laptop, 'pp_1').locator('.pd-chip', { hasText: 'Kitchen' }).click();
    await pick(laptop, 'Take out of this scene');
    await scene(laptop, 'pp_5').locator('.pd-chip.add').click();
    await laptop.locator('.pop-menu .pop-item', { hasText: 'Characters' }).click();
    await laptop.locator('.pop-menu .pop-item', { hasText: 'Mom' }).click();
    await sleep(400);
    await settle(laptop);
    assert.deepEqual(await scene(laptop, 'pp_1').locator('.pd-chip:not(.add)').allTextContents(), ['Mom', 'Kenji', 'Katana']);
    assert.deepEqual(await scene(laptop, 'pp_5').locator('.pd-chip:not(.add)').allTextContents(), ['Kenji', 'Mom']);
    assert.deepEqual(row('bd-pp_1').fields.drop, ['pg_kitchen']);
    assert.deepEqual(row('bd-pp_5').fields.add, ['pg_mom']);
  });

  await check('prompts and renders: every render keeps the prompts that made it, the star picks the one', async () => {
    const sh = scene(laptop, 'pp_1').locator('.pd-shot').first();
    const id = await sh.getAttribute('data-shot');
    await sh.locator('.pd-toggle').click();
    await laptop.waitForSelector(`[data-shot="${id}"] textarea[aria-label="Still prompt"]`);
    await laptop.locator(`[data-shot="${id}"] textarea[aria-label="Still prompt"]`).fill('Mom at the stove, morning light');
    await laptop.locator(`[data-shot="${id}"] textarea[aria-label="Video prompt"]`).fill('She flips the pancake high');
    await laptop.locator('.gv-title').click();
    await sleep(700);
    await laptop.locator(`[data-shot="${id}"] .pd-renders input[type=file]`).setInputFiles([{ name: 'NB-E01-S01-01 a.png', mimeType: 'image/png', buffer: PNG }, { name: 'NB-E01-S01-01 b.png', mimeType: 'image/png', buffer: PNG }]);
    await laptop.waitForFunction((i) => document.querySelectorAll(`[data-shot="${i}"] .pd-renders .pd-render:not(.add)`).length === 2, id);
    await laptop.locator(`[data-shot="${id}"] textarea[aria-label="Still prompt"]`).fill('Mom at the stove, low sun, steam');
    await laptop.locator('.gv-title').click();
    await sleep(700);
    await laptop.locator(`[data-shot="${id}"] .pd-renders input[type=file]`).setInputFiles([{ name: 'take.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video') }]);
    await laptop.waitForFunction((i) => document.querySelectorAll(`[data-shot="${i}"] .pd-renders .pd-render:not(.add)`).length === 3, id);
    await settle(laptop);
    let f = row(id).fields;
    assert.equal(f.tries.length, 2);
    assert.equal(f.tries[0].still, 'Mom at the stove, morning light');
    assert.equal(f.tries[0].files.length, 2);
    assert.equal(f.tries[1].still, 'Mom at the stove, low sun, steam');
    const still = f.tries[0].files[1];
    await laptop.locator(`[data-shot="${id}"] .pd-render[data-file="${still}"]`).hover();
    await laptop.locator(`[data-shot="${id}"] .pd-render[data-file="${still}"] .pd-star`).click();
    await sleep(400);
    await settle(laptop);
    f = row(id).fields;
    assert.equal(f.star.still, still);
    assert.equal(await laptop.locator(`[data-shot="${id}"]`).getAttribute('data-stage'), 'still');
    assert.equal(await laptop.locator(`[data-shot="${id}"] .pd-stage`).textContent(), 'Still picked');
    assert.ok(await laptop.locator(`[data-shot="${id}"] .pd-earlier`).count(), 'earlier prompts are kept');
    assert.ok(live().filter((r) => r.kind === 'file').length >= 4, 'renders are files that sync');
    await shot(laptop, 'production-renders');
  });

  await check('files dropped anywhere find their shot by the code in their name', async () => {
    const target = shots().find((s) => s.fields.n === '2');
    await laptop.evaluate(async () => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'NB-E01-S01-02 v1.png', { type: 'image/png' }));
      dt.items.add(new File([new Uint8Array([1])], 'nothing.png', { type: 'image/png' }));
      document.querySelector('#prod-view').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await laptop.waitForFunction(() => /found their shot/.test(document.querySelector('.toast')?.textContent || ''));
    await settle(laptop);
    assert.equal(row(target.id).fields.tries[0].files.length, 1);
  });

  await check('the storyboard shows the starred still, in order', async () => {
    await laptop.locator('.gv-levels .chip[data-tab="board"]').click();
    await laptop.waitForSelector('.pd-board .pd-card');
    const codes = await laptop.locator('.pd-card-code').allTextContents();
    assert.deepEqual(codes, ['NB-E01-S01-01', 'NB-E01-S01-01A', 'NB-E01-S01-02']);
    await laptop.waitForSelector('.pd-card >> nth=0 >> .pd-pic img');
    await shot(laptop, 'production-board');
  });

  await check('Claude: a breakdown adds from the kit and suggests what the kit is missing', async () => {
    await laptop.locator('.gv-levels .chip[data-tab="shots"]').click();
    await laptop.locator('.gv-tools .more-btn').click();
    await pick(laptop, 'Break down every scene');
    await laptop.waitForSelector('.gv-claude .gv-findings button');
    const ask = await laptop.evaluate(() => window.__asked.at(-1));
    assert.equal(ask.task, 'breakdown');
    assert.equal(ask.scenes.length, 2);
    assert.deepEqual(ask.scenes[0].notes, ['The apron must be the red one'], 'production notes go with the scene');
    assert.equal(ask.style, 'Flat cel shading, warm palette');
    assert.deepEqual(await scene(laptop, 'pp_5').locator('.pd-chip:not(.add)').allTextContents(), ['Kenji', 'Mom', 'Katana']);
    await laptop.locator('.gv-claude .gv-findings button', { hasText: 'Red apron' }).click();
    await sleep(500);
    await settle(laptop);
    const apron = live().find((r) => r.kind === 'page' && r.title === 'Red apron');
    assert.equal(apron.fields.element.type, 'wardrobe');
    assert.equal(row(apron.parent_id).title, 'Wardrobe', 'it went in a Wardrobe page in the bible');
    assert.ok(row('bd-pp_5').fields.add.includes(apron.id));
  });

  await check('Claude: suggests shots for a scene, then writes their prompts (the old ones kept)', async () => {
    await scene(laptop, 'pp_5').locator('.pd-add .ghost-btn', { hasText: 'Claude: suggest shots' }).click();
    await laptop.waitForFunction(() => document.querySelectorAll('.pd-scene[data-scene="pp_5"] .pd-shot').length === 2);
    await settle(laptop);
    const made = shots().filter((s) => s.parent_id === 'pp_5');
    assert.deepEqual(made.map((s) => [s.fields.n, s.text, s.fields.framing, s.fields.by]), [['1', 'The gate in the rain', 'Wide', 'claude'], ['2', 'Kenji turns', 'Close-up', 'claude']]);
    await scene(laptop, 'pp_5').locator('.pd-add .ghost-btn', { hasText: 'Claude: write prompts' }).click();
    await laptop.waitForSelector('.pd-scene[data-scene="pp_5"] .pd-shot.open textarea');
    await settle(laptop);
    assert.equal(row(made[0].id).fields.still, 'Still for The gate in the rain');
    assert.equal(row(made[0].id).fields.prompt_by, 'claude');
    // Again: the first prompts become an earlier try.
    await scene(laptop, 'pp_1').locator('.pd-add .ghost-btn', { hasText: 'Claude: write prompts' }).click();
    await laptop.waitForFunction(() => [...document.querySelectorAll('.pd-scene[data-scene="pp_1"] textarea')].some((t) => t.value === 'Still for Mom flips the pancake'));
    await settle(laptop);
    const first = shots().find((s) => s.parent_id === 'pp_1' && s.fields.n === '1');
    assert.equal(first.fields.still, 'Still for Mom flips the pancake');
    assert.ok(first.fields.tries.some((t) => t.still === 'Mom at the stove, low sun, steam'), 'what was there is kept');
    const ask = await laptop.evaluate(() => window.__asked.at(-1));
    assert.deepEqual(ask.examples, [{ still: 'Mom at the stove, morning light', video: 'She flips the pancake high' }], 'the starred prompt is an example');
  });

  await check('a scene rewritten after its shots says so, until the shots are checked', async () => {
    const p2 = row('pp_2');
    put({ ...p2, text: 'Mother burns a pancake.', content: [{ type: 'text', text: 'Mother burns a pancake.' }] });
    await settle(laptop);
    await laptop.waitForSelector('.pd-scene[data-scene="pp_1"] .pd-changed', { timeout: 4000 });
    assert.equal(await scene(laptop, 'pp_5').locator('.pd-changed').count(), 0);
    await scene(laptop, 'pp_1').locator('.pd-changed').click();
    await pick(laptop, 'The shots still match');
    await sleep(300);
    assert.equal(await scene(laptop, 'pp_1').locator('.pd-changed').count(), 0);
  });

  await check('a shoot day: one-page call sheet from the breakdown, sent to Daybook on its day', async () => {
    await laptop.locator('.gv-levels .chip[data-tab="days"]').click();
    await laptop.locator('.pd-days .chip.add').click();
    await laptop.waitForSelector('.pd-dayform');
    await laptop.locator('.pd-dayform input[aria-label="Date"]').fill('2027-02-03');
    await laptop.locator('.pd-dayform input[aria-label="Date"]').dispatchEvent('change');
    await sleep(300);
    await laptop.locator('.pd-dayform input[aria-label="Call"]').fill('07:30');
    await laptop.locator('.pd-dayform input[aria-label="Call"]').dispatchEvent('change');
    await sleep(300);
    await laptop.locator('.pd-dayform input[aria-label="Where"]').fill('Echo Park');
    await laptop.locator('.pd-dayform input[aria-label="Where"]').dispatchEvent('change');
    await sleep(300);
    await laptop.locator('.pd-daypick .chip', { hasText: 'KITCHEN' }).click();
    await sleep(400);
    const sheet = await laptop.locator('.pd-sheet').innerText();
    assert.match(sheet, /Call 7:30 am/);
    assert.match(sheet, /Echo Park/);
    assert.match(sheet, /1\s+INT\. KITCHEN - MORNING/);
    assert.match(sheet, /NB-E01-S01-01A\s+Pancake in the air/);
    assert.match(sheet, /WHO’S NEEDED\s+Mom: Short, calm, grey bun/i);
    assert.match(sheet.trim(), /WHO’S NEEDED\s+Mom: Short, calm, grey bun$/i, 'Kenji and the katana left the scene in its rewrite');
    assert.match(sheet, /The apron must be the red one/);
    assert.doesNotMatch(sheet, /DOJO/);
    await laptop.locator('.pd-daypick .chip', { hasText: 'DOJO' }).click();
    await sleep(400);
    const both = await laptop.locator('.pd-sheet').innerText();
    assert.match(both, /WHO’S NEEDED\s+Mom: Short, calm, grey bun\s+Kenji\s+PROPS\s+Katana\s+WARDROBE\s+Red apron/i, JSON.stringify(both.slice(-300)));
    await laptop.locator('.pd-daypick .chip', { hasText: 'DOJO' }).click();
    await sleep(400);
    await shot(laptop, 'production-callsheet');
    await laptop.locator('.pd-dayform .pill', { hasText: 'Send to Daybook' }).click();
    await laptop.waitForFunction(() => /Daybook plan/.test(document.querySelector('.toast')?.textContent || ''));
    const t = tasks.at(-1);
    assert.equal(t.day, '2027-02-03');
    assert.equal(t.start_min, 450);
    assert.equal(t.title, 'Shoot: Reel 4: Breakfast at Echo Park');
    assert.match(t.link, /\?open=sd_/);
  });

  await check('posting: Claude drafts a caption per platform, links are kept for later', async () => {
    await laptop.locator('.gv-levels .chip[data-tab="post"]').click();
    await laptop.locator('.pd-add .pill', { hasText: 'Draft captions' }).click();
    await laptop.waitForFunction(() => document.querySelector('.pd-post-card[data-platform="tiktok"] textarea')?.value === 'Caption for TikTok');
    await laptop.locator('.pd-post-card[data-platform="youtube"] input').fill('https://youtu.be/abc');
    await laptop.locator('.pd-post-card[data-platform="youtube"] input').dispatchEvent('change');
    await sleep(400);
    await settle(laptop);
    assert.equal(row('pr_reel').fields.posting.youtube.url, 'https://youtu.be/abc');
    assert.equal(row('pr_reel').fields.posting.x.caption, 'Caption for X');
    await shot(laptop, 'production-posting');
  });

  await check('out to Resolve: the shot list as CSV, the dialogue as subtitles, a shot’s kit as a zip', async () => {
    assert.deepEqual(laptop.errors, []);
    await laptop.locator('.gv-tools .more-btn').click();
    const [csv] = await Promise.all([laptop.waitForEvent('download'), pick(laptop, 'Shot list for Resolve')]);
    const text = await readFile(await csv.path(), 'utf8');
    assert.match(text, /^﻿Shot,Scene,Scene heading/);
    assert.match(text, /NB-E01-S01-01,1,INT\. KITCHEN - MORNING,Mom flips the pancake,,Still picked/);
    assert.match(text, /NB-E01-S01-01 b\.png/);
    await laptop.locator('.gv-tools .more-btn').click();
    const [srt] = await Promise.all([laptop.waitForEvent('download'), pick(laptop, 'Dialogue for subtitles')]);
    assert.match(await readFile(await srt.path(), 'utf8'), /2\n00:00:02,000 --> 00:00:03,999\nWho are you\?/);
    await laptop.locator('.gv-levels .chip[data-tab="shots"]').click();
    await laptop.waitForSelector('.pd-scene[data-scene="pp_1"] .pd-shot');
    const first = scene(laptop, 'pp_5').locator('.pd-shot').first();
    if (!(await first.locator('.pd-detail').count())) await first.locator('.pd-toggle').click();
    await laptop.evaluate(() => { window.__draws = 0; const o = window.__production.draw.bind(window.__production); window.__production.draw = async () => { window.__draws++; return o(); }; });
    await sleep(2000);
    assert.ok(await laptop.evaluate(() => window.__draws) <= 1, 'it settles');
    const [kit] = await Promise.all([laptop.waitForEvent('download'), first.locator('.ghost-btn', { hasText: 'Download kit' }).click()]);
    assert.equal(kit.suggestedFilename(), 'NB-E01-S02-01 kit.zip');
    const zip = await readFile(await kit.path(), 'latin1');
    assert.match(zip, /NB-E01-S02-01 prompts\.txt/);
    assert.match(zip, /STILL PROMPT\nStill for The gate in the rain/);
    assert.match(zip, /References\/Mom 1\.png/);
    assert.match(zip, /Katana \(Prop\) \[katana_v2 LoRA\]: A battered wooden practice sword/);
  });

  await check('another device sees it all: shots, stars, renders, the kit', async () => {
    const other = await device();
    await settle(other);
    await go(other, { view: 'production', id: 'pr_reel', tab: 'shots' });
    await other.waitForSelector('.pd-scene[data-scene="pp_1"] .pd-shot');
    assert.deepEqual(await scene(other, 'pp_1').locator('.pd-code').allTextContents(), ['NB-E01-S01-01', 'NB-E01-S01-01A', 'NB-E01-S01-02']);
    const id = await scene(other, 'pp_1').locator('.pd-shot').first().getAttribute('data-shot');
    await scene(other, 'pp_1').locator('.pd-shot').first().locator('.pd-toggle').click();
    await other.waitForSelector(`[data-shot="${id}"] .pd-render.starred img`, { timeout: 5000 });
    assert.deepEqual(other.errors, []);
    await other.context().close();
  });

  await check('on a phone: the shots fit, nothing scrolls sideways', async () => {
    const phone = await device({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await settle(phone);
    await go(phone, { view: 'production', id: 'pr_reel', tab: 'shots' });
    await phone.waitForSelector('.pd-scene[data-scene="pp_1"] .pd-shot');
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(wide <= 1, `page scrolls sideways by ${wide}px`);
    await scene(phone, 'pp_1').locator('.pd-shot').first().locator('.pd-toggle').click();
    await sleep(400);
    await shot(phone, 'production-phone');
    await phone.locator('.gv-levels .chip[data-tab="kit"]').click();
    await sleep(400);
    const wide2 = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(wide2 <= 1, `kit scrolls sideways by ${wide2}px`);
    await shot(phone, 'production-phone-kit');
    assert.deepEqual(phone.errors, []);
    await phone.context().close();
  });

  await check('a shot link (?open=) opens the shot in production', async () => {
    const id = shots()[0].id;
    await laptop.evaluate(async (i) => { await window.__open?.(i); }, id).catch(() => {});
    await go(laptop, { view: 'library' });
    await laptop.goto(`http://localhost:${PORT}/?open=${id}`);
    await laptop.waitForSelector(`html[data-view="production"] [data-shot="${id}"].open`, { timeout: 6000 });
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
console.log('production: all passed');
