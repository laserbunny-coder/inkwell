// Story structure: a script's sections nest (act, sequence, scene) and carry
// summaries; scripts come in from Fountain files or bullets pasted out of an
// outliner; and the plot grid shows the manuscript as a table whose rows are
// the real chapters, scenes, sections or episodes, so dragging a row moves
// the writing, and whose cells are the margin notes, each in a thread.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { promiseState } from '../src/grid.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4195;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const SHOTS = process.env.SHOTS || '';

const table = new Map();
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
}
const fake = () => {
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: (rows) => window.__remote('push', rows),
    pull: (since, from) => window.__remote('pull', { since, from }),
    subscribe() {}, unsubscribe() {}
  };
  // The server: Claude fills a thread from the draft, or checks the promises.
  window.__asked = [];
  window.__claude = async (body) => {
    window.__asked.push(body);
    if (body.mode !== 'grid') throw new Error('Not now');
    const row = (title) => body.rows.find((r) => r.title === title)?.id;
    if (body.task === 'fill') return { cells: [{ row: row('Message found'), text: 'Seal broken', beat: 'promise' }, { row: row('Siege begins'), text: 'The hive moves', beat: '' }, { row: row('Arrive at the temple'), text: 'Should be skipped', beat: '' }].filter((c) => c.row) };
    return { findings: [{ kind: 'quiet', thread: body.threads[1].id, row: row('Monks gather'), text: 'The goo disappears for three chapters.' }] };
  };
};

const put = (r) => {
  const at = tick();
  table.set(r.id, { parent_id: null, sort: 0, title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: Date.parse(at), ...r, user_id: 'u1', updated_at: at });
};
const para = (id, parent, sort, text, fields = {}) => put({ id, kind: 'para', parent_id: parent, sort, text, content: text ? [{ type: 'text', text }] : null, tags: [...text.matchAll(/#([\w-]+)/g)].map((m) => m[1].toLowerCase()), fields });
put({ id: 'area-writing', kind: 'area', title: 'Writing', sort: 1 });
// A world with a novel (two acts, chapters with scene breaks), a script with
// nested sections, and a season of three episodes.
put({ id: 'wd_monks', kind: 'world', title: 'Monks vs. Zombies', area_id: 'area-writing' });
put({ id: 'pr_novel', kind: 'project', parent_id: 'wd_monks', title: 'Monks vs. Zombies', area_id: 'area-writing', sort: 1, fields: { type: 'novel', levels: ['Act', 'Chapter', 'Scene'] } });
put({ id: 'ac_1', kind: 'act', parent_id: 'pr_novel', title: 'Act One', sort: 1 });
put({ id: 'ac_2', kind: 'act', parent_id: 'pr_novel', title: 'Act Two', sort: 2 });
put({ id: 'ch_1', kind: 'chapter', parent_id: 'ac_1', title: 'Message found', sort: 1 });
put({ id: 'ch_2', kind: 'chapter', parent_id: 'ac_1', title: 'Monks gather', sort: 2 });
put({ id: 'ch_3', kind: 'chapter', parent_id: 'ac_1', title: 'Road to the jungle', sort: 3 });
put({ id: 'ch_4', kind: 'chapter', parent_id: 'ac_2', title: 'Arrive at the temple', sort: 1 });
put({ id: 'ch_5', kind: 'chapter', parent_id: 'ac_2', title: 'Siege begins', sort: 2 });
para('pa_11', 'ch_1', 1024, 'The message was carved in jade.');
put({ id: 'sc_12', kind: 'scene', parent_id: 'ch_1', sort: 2048, title: 'The seal' });
para('pa_12', 'ch_1', 3072, 'Tomb raiders break the seal. #goo');
para('pa_21', 'ch_2', 1024, 'The monks come down the mountain.');
put({ id: 'sc_22', kind: 'scene', parent_id: 'ch_2', sort: 2048, title: 'First attack' });
para('pa_22', 'ch_2', 3072, 'The village burns.');
para('pa_31', 'ch_3', 1024, 'Rain for a week.');
para('pa_41', 'ch_4', 1024, 'The temple steps.');
para('pa_51', 'ch_5', 1024, 'The hive moves as one. #goo');
put({ id: 'th_monk', kind: 'thread', parent_id: 'wd_monks', title: 'Ex-Yakuza monk', sort: 1024, fields: { tag: 'monk' } });
put({ id: 'th_goo', kind: 'thread', parent_id: 'wd_monks', title: 'The goo', sort: 2048, fields: { tag: 'goo' } });
put({ id: 'no_1', kind: 'note', parent_id: 'pa_11', text: 'Refuses the call', fields: { chapter_id: 'ch_1', thread: 'th_monk' } });
put({ id: 'no_2', kind: 'note', parent_id: 'pa_21', text: 'Meets the others', fields: { chapter_id: 'ch_2', thread: 'th_monk' } });
put({ id: 'no_5', kind: 'note', parent_id: 'pa_51', text: 'Won’t fight', fields: { chapter_id: 'ch_5', thread: 'th_monk' } });
// The script.
put({ id: 'pr_pilot', kind: 'project', parent_id: 'wd_monks', title: 'Pilot', area_id: 'area-writing', sort: 2, fields: { type: 'screenplay', levels: ['Act', 'Script', 'Scene'] } });
put({ id: 'ac_p', kind: 'act', parent_id: 'pr_pilot', title: 'Screenplay', sort: 1 });
put({ id: 'ch_p', kind: 'chapter', parent_id: 'ac_p', title: 'Script', sort: 1 });
let n = 0;
const s = (id, title, level, fields = {}) => put({ id, kind: 'scene', parent_id: 'ch_p', sort: (n += 1024), title, fields: { ...(level > 1 ? { level } : {}), ...fields } });
const l = (id, text, el) => para(id, 'ch_p', (n += 1024), text, { el });
s('sp_a1', 'Act One', 1);
s('sp_q1', 'The dojo', 2);
s('sp_s1', 'Breakfast fight', 3, { synopsis: 'Mom wins without looking up.' });
l('pp_1', 'INT. KITCHEN - MORNING', 'scene');
l('pp_2', 'Rice everywhere.', 'action');
s('sp_s2', 'The challenge', 3);
l('pp_3', 'EXT. DOJO - DAY', 'scene');
l('pp_4', 'A stranger at the gate.', 'action');
s('sp_q2', 'The road', 2);
s('sp_s3', 'Ambush', 3);
l('pp_5', 'EXT. FOREST - NIGHT', 'scene');
l('pp_6', 'Arrows.', 'action');
// A season of episodes, written as an outline.
put({ id: 'pr_s1', kind: 'project', parent_id: 'wd_monks', title: 'Season One', area_id: 'area-writing', sort: 3, fields: { type: 'lines', label: 'Season' } });
for (const [i, t] of ['Pilot', 'The Hive', 'Siege'].entries()) put({ id: `pr_e${i + 1}`, kind: 'project', parent_id: 'pr_s1', title: t, area_id: 'area-writing', sort: (i + 1) * 1024, fields: { type: 'lines', label: 'Episode' } });

const browser = await chromium.launch();
async function device(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark', ...opts });
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
const command = async (p, name) => {
  await p.keyboard.press('Control+K');
  await p.keyboard.type(name);
  await sleep(250);
  await p.keyboard.press('Enter');
  await sleep(300);
};
const go = (p, place) => p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
const row = (id) => table.get(id);
const live = () => [...table.values()].filter((r) => !r.deleted);
const kids = (id) => live().filter((r) => r.parent_id === id).sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`); }
}

try {
  await check('a promise is kept by the nearest payoff after it, not a later one', () => {
    const st = promiseState([
      { id: 'p', thread: 't', beat: 'promise', at: 1 },
      { id: 'far', thread: 't', beat: 'payoff', at: 9 },
      { id: 'other', thread: 'u', beat: 'payoff', at: 2 },
      { id: 'near', thread: 't', beat: 'payoff', at: 3 },
      { id: 'before', thread: 't', beat: 'payoff', at: 0 }
    ]);
    assert.deepEqual(st.get('p'), { paid: true, by: 'near' });
  });

  const laptop = await device();
  await settle(laptop);

  // ---------- a script's sections ----------

  await check('a script opens with its sections nested in the sidebar', async () => {
    await go(laptop, { view: 'write', chapterId: 'ch_p' });
    await laptop.waitForSelector('html.script #editor .scene-break[data-level="3"]');
    await laptop.waitForFunction(() => document.querySelector('#outline-scenes .tree-scene')?.textContent === 'Act One');
    // The tree is redrawn a moment after the chapter opens; read it once it has settled.
    await laptop.waitForFunction(() => [...document.querySelectorAll('#outline-scenes .tree-scene')].every((b) => b.isConnected && !Number.isNaN(parseFloat(getComputedStyle(b).paddingLeft))));
    await sleep(500);
    const tree = await laptop.locator('#outline-scenes .tree-scene').evaluateAll((bs) => bs.map((b) => [b.textContent, b.dataset.level || 'slug', parseFloat(getComputedStyle(b).paddingLeft)]));
    assert.deepEqual(tree.slice(0, 5).map((t) => t[0]), ['Act One', 'The dojo', 'Breakfast fight', 'INT. KITCHEN - MORNING', 'The challenge']);
    assert.ok(tree[1][2] > tree[0][2] && tree[2][2] > tree[1][2], `deeper sections indent: ${JSON.stringify(tree.slice(0, 4))}`);
    assert.ok(tree[3][2] > tree[2][2], 'a scene heading sits under its section');
    assert.equal(await laptop.locator('.scene-break[data-eid="sp_s1"] .scene-synopsis').inputValue(), 'Mom wins without looking up.');
    assert.ok(await laptop.locator('.scene-break[data-eid="sp_s1"] .scene-synopsis').isVisible(), 'a summary shows once written');
    assert.ok(!(await laptop.locator('.scene-break[data-eid="sp_s2"] .scene-synopsis').isVisible()), 'an empty one stays out of the way');
    await shot(laptop, 'script-sections');
  });

  await check('## then space starts a sequence, ### a scene, and Tab in the name goes a level deeper', async () => {
    await laptop.locator('#editor p[data-eid="pp_6"]').click();
    await laptop.keyboard.press('End');
    await laptop.keyboard.press('Enter');
    await laptop.keyboard.press('Enter');
    await laptop.keyboard.type('## ');
    await sleep(150);
    await laptop.keyboard.type('Homecoming');
    await laptop.keyboard.press('Tab');
    await sleep(200);
    await laptop.keyboard.press('Enter');
    await sleep(100);
    await laptop.keyboard.type('INT. DOJO - NIGHT');
    await sleep(900);
    await settle(laptop);
    const sec = live().find((r) => r.kind === 'scene' && r.title === 'Homecoming');
    assert.ok(sec, 'the section was saved');
    assert.equal(sec.fields.level, 3, 'Tab took it from sequence to scene');
    await laptop.locator('.scene-break[data-eid="sp_s2"] .scene-title').click();
    await laptop.keyboard.press('ArrowDown');
    await laptop.keyboard.type('Kenji is challenged');
    await laptop.keyboard.press('Enter');
    await sleep(900);
    await settle(laptop);
    assert.equal(row('sp_s2').fields.synopsis, 'Kenji is challenged');
    assert.equal(row('sp_s2').fields.level, 3);
  });

  await check('section summaries can be switched off, and a read-through hides sections', async () => {
    await command(laptop, 'Show or hide section summaries');
    assert.ok(!(await laptop.locator('.scene-break[data-eid="sp_s1"] .scene-synopsis').isVisible()));
    await command(laptop, 'Show or hide section summaries');
    assert.ok(await laptop.locator('.scene-break[data-eid="sp_s1"] .scene-synopsis').isVisible());
  });

  await check('focus mode is just the words: a script’s sections and summaries fold away, and come back after', async () => {
    const box = () => laptop.locator('.scene-break[data-eid="sp_s1"]').boundingBox();
    const before = await box();
    assert.ok(before.height > 20);
    await laptop.keyboard.press('Control+Period');
    await sleep(400);
    assert.ok(await laptop.evaluate(() => document.documentElement.classList.contains('focus')));
    assert.equal((await box()).height, 0, 'the section folds away');
    assert.equal((await laptop.locator('.scene-break[data-eid="sp_q1"]').boundingBox()).height, 0, 'sequences too');
    assert.ok(await laptop.locator('#editor p[data-el="scene"]', { hasText: 'INT. KITCHEN' }).isVisible(), 'the script itself stays');
    await laptop.keyboard.press('Control+Period');
    await sleep(400);
    assert.ok((await box()).height > 20, 'and is back after focus');
  });

  // ---------- the grid ----------

  await check('Ctrl+Shift+G shows the script as a grid: scenes as rows, acts and sequences heading them', async () => {
    await laptop.locator('#editor p[data-eid="pp_2"]').click();
    await laptop.keyboard.press('Control+Shift+G');
    await laptop.waitForSelector('html[data-view="grid"] .gv-table');
    const rows = await laptop.locator('.gv-table tbody tr').evaluateAll((trs) => trs.map((t) => (t.classList.contains('gv-group') ? `# ${t.textContent}` : t.querySelector('.gv-name').textContent)));
    assert.deepEqual(rows, ['# Act One', '# The dojo', 'Breakfast fight', 'The challenge', '# The road', 'Ambush', 'Homecoming']);
    assert.deepEqual(await laptop.locator('.gv-thread .gv-tname').allInnerTexts(), ['Ex-Yakuza monk', 'The goo']);
    assert.equal(await laptop.locator('.gv-row[data-id="sp_s1"] .gv-sum .gv-text').innerText(), 'Mom wins without looking up.');
    assert.equal(await laptop.locator('.gv-row[data-id="sp_s2"] .gv-sum .gv-text').innerText(), 'Kenji is challenged', 'the summary typed in the script');
    assert.deepEqual(await laptop.locator('.gv-levels .chip').allInnerTexts(), ['Acts', 'Sequences', 'Scenes', 'Scene headings']);
    await shot(laptop, 'grid-script');
  });

  await check('the rows switch levels: sequences, acts, scene headings', async () => {
    await laptop.locator('.gv-levels .chip', { hasText: 'Sequences' }).click();
    await sleep(300);
    assert.deepEqual(await laptop.locator('.gv-row .gv-name').allInnerTexts(), ['The dojo', 'The road']);
    await laptop.locator('.gv-levels .chip', { hasText: 'Scene headings' }).click();
    await sleep(300);
    assert.deepEqual(await laptop.locator('.gv-row .gv-name').allInnerTexts(), ['INT. KITCHEN - MORNING', 'EXT. DOJO - DAY', 'EXT. FOREST - NIGHT', 'INT. DOJO - NIGHT']);
    await laptop.locator('.gv-levels .chip', { hasText: /^Scenes$/ }).click();
    await sleep(300);
  });

  await check('dragging a scene row moves the scene, with everything in it, in the script', async () => {
    await laptop.locator('.gv-row[data-id="sp_s3"]').hover();
    await laptop.locator('.gv-row[data-id="sp_s3"] .gv-grip').dragTo(laptop.locator('.gv-row[data-id="sp_s1"]'), { targetPosition: { x: 50, y: 4 } });
    await sleep(500);
    await settle(laptop);
    const order = kids('ch_p').map((r) => r.id);
    const at = (id) => order.indexOf(id);
    assert.ok(at('sp_s3') < at('sp_s1') && at('sp_s3') > at('sp_q1'), `Ambush now opens the dojo sequence: ${order.join(' ')}`);
    assert.equal(at('pp_5'), at('sp_s3') + 1);
    assert.equal(at('pp_6'), at('sp_s3') + 2);
    assert.deepEqual(await laptop.locator('.gv-row .gv-name').allInnerTexts(), ['Ambush', 'Breakfast fight', 'The challenge', 'Homecoming']);
  });

  await check('back in the text, the scene is where the grid put it', async () => {
    await laptop.keyboard.press('Control+Shift+G');
    await laptop.waitForSelector('html:not([data-view]) #editor .scene-break[data-eid="sp_s3"]');
    const order = await laptop.locator('#editor .ProseMirror > [data-eid]').evaluateAll((els) => els.map((e) => e.dataset.eid));
    assert.ok(order.indexOf('sp_s3') < order.indexOf('sp_s1'));
    assert.equal(order[order.indexOf('sp_s3') + 1], 'pp_5');
  });

  await check('a novel’s grid: chapters down, threads across, margin notes in their thread’s cell, tagged lines too', async () => {
    await go(laptop, { view: 'grid', id: 'pr_novel' });
    await laptop.waitForSelector('.gv-row[data-id="ch_1"]');
    assert.deepEqual(await laptop.locator('.gv-row .gv-name').allInnerTexts(), ['Message found', 'Monks gather', 'Road to the jungle', 'Arrive at the temple', 'Siege begins']);
    assert.deepEqual(await laptop.locator('.gv-group').allInnerTexts(), ['ACT ONE', 'ACT TWO'].map((x) => x));
    const cell = (ch, th) => laptop.locator(`.gv-row[data-id="${ch}"] .gv-cell[data-thread="${th}"]`);
    assert.equal(await cell('ch_1', 'th_monk').locator('.gv-text').innerText(), 'Refuses the call');
    assert.match(await cell('ch_1', 'th_goo').innerText(), /Tomb raiders break the seal/);
    // The goo vanishes for three chapters: the grid shows it.
    assert.deepEqual(await laptop.locator('.gv-cell.gap[data-thread="th_goo"]').evaluateAll((els) => els.map((e) => e.closest('tr').dataset.id)), ['ch_2', 'ch_3', 'ch_4']);
    assert.deepEqual(await laptop.locator('.gv-cell.gap[data-thread="th_monk"]').evaluateAll((els) => els.map((e) => e.closest('tr').dataset.id)), ['ch_3', 'ch_4']);
  });

  await check('typing in an empty cell adds a note to that chapter, in that thread', async () => {
    await laptop.locator('.gv-row[data-id="ch_3"] .gv-cell[data-thread="th_goo"]').click({ position: { x: 100, y: 20 } });
    await laptop.keyboard.type('Spores in the rain');
    await laptop.keyboard.press('Enter');
    await sleep(700);
    await settle(laptop);
    const note = live().find((r) => r.kind === 'note' && r.text === 'Spores in the rain');
    assert.ok(note, 'saved');
    assert.equal(note.parent_id, 'ch_3');
    assert.equal(note.fields.thread, 'th_goo');
    assert.equal(note.fields.chapter_id, 'ch_3');
    await laptop.waitForFunction(() => !document.querySelector('.gv-row[data-id="ch_3"] .gv-cell[data-thread="th_goo"]').classList.contains('gap'));
  });

  await check('a summary typed in the grid is the chapter’s own, and survives writing in it', async () => {
    const sum = laptop.locator('.gv-row[data-id="ch_2"] .gv-sum .gv-text');
    await sum.click();
    await laptop.keyboard.type('They meet the raiders');
    await laptop.keyboard.press('Enter');
    await sleep(500);
    await settle(laptop);
    assert.equal(row('ch_2').fields.synopsis, 'They meet the raiders');
    await laptop.locator('.gv-row[data-id="ch_2"] .gv-open').click();
    await laptop.waitForSelector('html:not([data-view]) #editor p[data-eid="pa_22"]');
    await laptop.locator('#editor p[data-eid="pa_22"]').click();
    await laptop.keyboard.press('End');
    await laptop.keyboard.type(' Smoke for miles.');
    await sleep(900);
    await settle(laptop);
    assert.match(row('pa_22').text, /Smoke for miles/);
    assert.equal(row('ch_2').fields.synopsis, 'They meet the raiders', 'the word count save kept the summary');
    assert.ok(row('ch_2').fields.words > 0);
  });

  await check('in the margin, a note shows its thread, and giving a note a thread puts it in the grid', async () => {
    await laptop.keyboard.press('Control+2');
    await laptop.waitForSelector('.note');
    assert.equal(await laptop.locator('.note[data-note="no_2"] .note-thread').inputValue(), 'th_monk');
    await laptop.locator('#editor p[data-eid="pa_22"]').click();
    await laptop.keyboard.press('Control+Shift+N');
    await laptop.waitForFunction(() => document.activeElement?.closest('.note'));
    await laptop.keyboard.type('Village elder knows the goo');
    await sleep(500);
    await laptop.locator('.note:has(textarea:focus) .note-thread').selectOption('th_goo');
    await sleep(600);
    await laptop.keyboard.press('Control+2');
    await laptop.keyboard.press('Control+Shift+G');
    await laptop.waitForSelector('html[data-view="grid"] .gv-row[data-id="ch_2"]');
    await settle(laptop);
    const v = live().find((r) => r.kind === 'note' && /Village/.test(r.text));
    assert.match(await laptop.locator('.gv-row[data-id="ch_2"] .gv-cell[data-thread="th_goo"]').innerText(), /Village elder knows the goo/, JSON.stringify(v));
  });

  await check('dragging a chapter row to the other act moves the chapter there', async () => {
    await laptop.locator('.gv-row[data-id="ch_3"]').hover();
    await laptop.locator('.gv-row[data-id="ch_3"] .gv-grip').dragTo(laptop.locator('.gv-row[data-id="ch_5"]'), { targetPosition: { x: 50, y: 30 } });
    await sleep(500);
    await settle(laptop);
    assert.equal(row('ch_3').parent_id, 'ac_2');
    assert.deepEqual(kids('ac_2').filter((r) => r.kind === 'chapter').map((r) => r.id), ['ch_4', 'ch_5', 'ch_3']);
    assert.deepEqual(await laptop.locator('.gv-row .gv-name').allInnerTexts(), ['Message found', 'Monks gather', 'Arrive at the temple', 'Siege begins', 'Road to the jungle']);
  });

  await check('at scene level, dragging a scene into another chapter moves its paragraphs and their notes', async () => {
    await laptop.locator('.gv-levels .chip', { hasText: 'Scenes' }).click();
    await sleep(400);
    const names = await laptop.locator('.gv-row .gv-name').allInnerTexts();
    assert.ok(names.includes('The seal') && names.includes('First attack'), names.join(', '));
    await laptop.locator('.gv-row[data-id="sc_12"]').hover();
    await laptop.locator('.gv-row[data-id="sc_12"] .gv-grip').dragTo(laptop.locator('.gv-row[data-id="sc_22"]'), { targetPosition: { x: 50, y: 4 } });
    await sleep(500);
    await settle(laptop);
    assert.equal(row('sc_12').parent_id, 'ch_2');
    assert.equal(row('pa_12').parent_id, 'ch_2');
    const order = kids('ch_2').map((r) => r.id);
    assert.deepEqual(order.slice(order.indexOf('sc_12'), order.indexOf('sc_12') + 3), ['sc_12', 'pa_12', 'sc_22']);
    assert.deepEqual(kids('ch_1').map((r) => r.id), ['pa_11']);
  });

  await check('a promise not yet paid off is marked, and a payoff in another piece of the world keeps it', async () => {
    await laptop.locator('.gv-levels .chip', { hasText: 'Chapters' }).click();
    await sleep(300);
    const note = laptop.locator('.gv-row[data-id="ch_1"] .gv-cell[data-thread="th_monk"] .gv-note');
    await note.locator('.gv-mark').click();
    await laptop.locator('.pop-menu button', { hasText: 'Promise' }).click();
    await sleep(500);
    await settle(laptop);
    assert.equal(row('no_1').fields.beat, 'promise');
    assert.ok(await laptop.locator('.gv-note[data-note="no_1"]').evaluate((e) => e.classList.contains('unpaid')));
    // Paid off in the season's last episode.
    await go(laptop, { view: 'grid', id: 'pr_s1' });
    await laptop.waitForSelector('.gv-row[data-id="pr_e3"]');
    assert.deepEqual(await laptop.locator('.gv-row .gv-name').allInnerTexts(), ['Pilot', 'The Hive', 'Siege']);
    await laptop.locator('.gv-row[data-id="pr_e3"] .gv-cell[data-thread="th_monk"]').click({ position: { x: 100, y: 20 } });
    await laptop.keyboard.type('Takes up the sword again');
    await laptop.keyboard.press('Enter');
    await sleep(600);
    await laptop.locator('.gv-row[data-id="pr_e3"] .gv-cell[data-thread="th_monk"] .gv-mark').click();
    await laptop.locator('.pop-menu button', { hasText: 'Payoff' }).click();
    await sleep(500);
    await go(laptop, { view: 'grid', id: 'pr_novel' });
    await laptop.waitForSelector('.gv-note[data-note="no_1"]');
    assert.ok(!(await laptop.locator('.gv-note[data-note="no_1"]').evaluate((e) => e.classList.contains('unpaid'))), 'kept by the episode');
  });

  await check('a season’s grid has its episodes as rows, and dragging one reorders the season', async () => {
    await go(laptop, { view: 'grid', id: 'pr_s1' });
    await laptop.waitForSelector('.gv-row[data-id="pr_e3"]');
    await shot(laptop, 'grid-season');
    await laptop.locator('.gv-row[data-id="pr_e3"]').hover();
    await laptop.locator('.gv-row[data-id="pr_e3"] .gv-grip').dragTo(laptop.locator('.gv-row[data-id="pr_e2"]'), { targetPosition: { x: 50, y: 4 } });
    await sleep(500);
    await settle(laptop);
    assert.deepEqual(kids('pr_s1').map((r) => r.id), ['pr_e1', 'pr_e3', 'pr_e2']);
  });

  await check('a new thread is a new column, for every grid in the world', async () => {
    await laptop.locator('.gv-add-thread').click();
    await laptop.locator('.ask-input').fill('Tomb raiders');
    await laptop.keyboard.press('Enter');
    await sleep(500);
    await settle(laptop);
    const t = live().find((r) => r.kind === 'thread' && r.title === 'Tomb raiders');
    assert.equal(t.parent_id, 'wd_monks');
    assert.equal(t.fields.tag, 'tomb-raiders');
    await go(laptop, { view: 'grid', id: 'pr_novel' });
    await laptop.waitForSelector('.gv-thread[data-thread="' + t.id + '"]');
  });

  await check('Claude fills a thread from the draft (only empty cells), and Undo takes it back', async () => {
    await go(laptop, { view: 'grid', id: 'pr_novel' });
    await laptop.waitForSelector('.gv-row[data-id="ch_1"]');
    // Something already in the temple row for the goo, so Claude's is skipped there.
    await laptop.locator('.gv-row[data-id="ch_4"] .gv-cell[data-thread="th_goo"]').click({ position: { x: 100, y: 20 } });
    await laptop.keyboard.type('Green light under the steps');
    await laptop.keyboard.press('Enter');
    await sleep(600);
    await laptop.locator('.gv-thread[data-thread="th_goo"] .gv-tname').click();
    await laptop.locator('.pop-menu button', { hasText: 'Fill in from the draft' }).click();
    await laptop.waitForFunction(() => [...document.querySelectorAll('.gv-row[data-id="ch_5"] .gv-cell[data-thread="th_goo"] .gv-note')].some((n) => n.textContent.includes('The hive moves')));
    const asked = await laptop.evaluate(() => window.__asked.at(-1));
    assert.equal(asked.task, 'fill');
    assert.equal(asked.thread, 'th_goo');
    assert.ok(asked.rows.find((r) => r.title === 'Siege begins').text.includes('The hive moves as one'), 'Claude reads the draft');
    await settle(laptop);
    const made = live().filter((r) => r.kind === 'note' && r.fields?.by === 'claude');
    assert.deepEqual(made.map((n) => n.text).sort(), ['Seal broken', 'The hive moves']);
    assert.equal(made.find((n) => n.text === 'Seal broken').fields.beat, 'promise');
    assert.ok(!live().some((r) => r.kind === 'note' && r.text === 'Should be skipped'));
    await laptop.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(500);
    await settle(laptop);
    assert.equal(live().filter((r) => r.kind === 'note' && r.fields?.by === 'claude').length, 0);
  });

  await check('asking Claude about promises shows what it noticed, and a finding leads to its row', async () => {
    await laptop.locator('.gv-tools .more-btn').click();
    await laptop.locator('.pop-menu button', { hasText: 'promises not paid off' }).click();
    await laptop.waitForSelector('.gv-findings li');
    assert.match(await laptop.locator('.gv-findings').innerText(), /Goes quiet · The goo · Monks gather/);
    await laptop.locator('.gv-findings button').first().click();
    await laptop.waitForSelector('.gv-row[data-id="ch_2"].flash');
    await shot(laptop, 'grid-claude');
    await laptop.locator('.gv-claude button', { hasText: 'Close' }).click();
    await laptop.waitForSelector('.gv-claude', { state: 'detached' });
  });

  // ---------- the world: its board and its promises ----------

  await check('a world’s promises are listed (in Shape) with where they’re paid off', async () => {
    await go(laptop, { view: 'stage', id: 'wd_monks', page: 'shape', sub: 'promises' });
    await laptop.waitForSelector('.st-promises li');
    const items = await laptop.locator('.st-promises li').allInnerTexts();
    assert.equal(items.length, 1);
    assert.match(items[0], /Ex-Yakuza monk · Monks vs\. Zombies/);
    assert.match(items[0], /Refuses the call/);
    assert.match(items[0], /Paid off in Siege: Takes up the sword again/);
  });

  await check('the stage board (in Make) shows every piece by stage, and dragging a card moves it on', async () => {
    await go(laptop, { view: 'stage', id: 'wd_monks', page: 'make', sub: 'board' });
    await laptop.waitForSelector('#st-board .sb-card');
    const idea = await laptop.locator('.sb-col[data-stage="Idea"] .sb-title').allInnerTexts();
    assert.ok(['Monks vs. Zombies', 'Pilot', 'Season One', 'Pilot', 'The Hive', 'Siege'].every((t) => idea.includes(t)), idea.join(', '));
    await shot(laptop, 'stage-board');
    await laptop.locator('.sb-card[data-id="pr_e1"]').dragTo(laptop.locator('.sb-col[data-stage="Written"]'));
    await sleep(500);
    await settle(laptop);
    assert.equal(row('pr_e1').fields.stage, 'Written');
    await laptop.waitForSelector('.sb-col[data-stage="Written"] .sb-card[data-id="pr_e1"]');

  });

  // ---------- bringing a script in ----------

  await check('a script pasted out of Tana comes into the world, nested, with its notes', async () => {
    await go(laptop, { view: 'world', id: 'wd_monks' });
    await sleep(400);
    await command(laptop, 'Bring in a script');
    await laptop.waitForSelector('.ask-script');
    await laptop.locator('.ask-paste').fill(`- Title: Ninja Bunch
- # Act One
  - = The family moves in.
  - ## The new dojo
    - INT. KITCHEN - MORNING
    - The family eats in silence. [[funnier?]]
    - MOM
    - Elbows.`);
    assert.equal(await laptop.locator('.ask-script select').inputValue(), 'wd_monks', 'the world you are in comes first');
    await laptop.locator('.ask-script button[type="submit"]').click();
    await laptop.waitForSelector('html.script #editor .scene-break[data-level="2"]');
    await sleep(600);
    await settle(laptop);
    const piece = live().find((r) => r.kind === 'project' && r.title === 'Ninja Bunch');
    assert.equal(piece.parent_id, 'wd_monks');
    const secs = live().filter((r) => r.kind === 'scene' && ['Act One', 'The new dojo'].includes(r.title) && r.parent_id !== 'ch_p');
    assert.deepEqual(secs.map((r) => [r.title, r.fields.level || 1, r.fields.synopsis || '']).sort(), [['Act One', 1, 'The family moves in.'], ['The new dojo', 2, '']]);
    const eats = live().find((r) => r.kind === 'para' && r.text === 'The family eats in silence.');
    assert.ok(live().some((r) => r.kind === 'note' && r.parent_id === eats.id && r.text === 'funnier?'), 'the [[note]] is beside its line');
    assert.equal(live().find((r) => r.kind === 'para' && r.text === 'Elbows.').fields.el, 'dialogue');
  });

  // ---------- on a phone ----------

  const phone = await device({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await settle(phone);

  await check('on a phone the grid scrolls sideways with the names held still, and rows move from a tap menu', async () => {
    await go(phone, { view: 'grid', id: 'pr_novel' });
    await phone.waitForSelector('.gv-row[data-id="ch_1"]');
    assert.equal(await phone.locator('.gv-grip').count(), 0, 'no dragging on a phone');
    await shot(phone, 'grid-phone');
    await phone.locator('.gv-row[data-id="ch_1"] .gv-open').tap();
    await phone.locator('.pop-menu button', { hasText: 'Move down' }).tap();
    await sleep(600);
    await settle(phone);
    assert.deepEqual(kids('ac_1').filter((r) => r.kind === 'chapter').map((r) => r.id), ['ch_2', 'ch_1']);
    const left = await phone.locator('.gv-row[data-id="ch_1"] .gv-rtitle').evaluate((e) => e.getBoundingClientRect().left);
    await phone.locator('.gv-scroll').evaluate((e) => { e.scrollLeft = 300; });
    await sleep(100);
    assert.equal(await phone.locator('.gv-row[data-id="ch_1"] .gv-rtitle').evaluate((e) => e.getBoundingClientRect().left), left, 'the row names stay put');
  });

  await check('no page errors', async () => {
    assert.deepEqual(laptop.errors, []);
    assert.deepEqual(phone.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
