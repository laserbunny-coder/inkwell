// Books from before worlds, brought up to date on two devices without losing
// anything; who wrote what; and scene numbers once a script is numbered.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4189;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);

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
};

// What a vault looked like before worlds: books at the top with their pages
// right inside them, a notes collection, and a book in the Trash.
const put = (r) => {
  const at = tick();
  table.set(r.id, { parent_id: null, sort: 0, title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: at, ...r, user_id: 'u1', updated_at: at });
};
const para = (id, parent, sort, text, fields = {}) => put({ id, kind: 'para', parent_id: parent, sort, text, content: [{ type: 'text', text }], fields });
put({ id: 'area-writing', kind: 'area', title: 'Writing', sort: 1 });
put({ id: 'area-personal', kind: 'area', title: 'Personal', sort: 2 });
put({ id: 'pr_harbour', kind: 'project', title: 'The Harbour', area_id: 'area-writing', fields: { type: 'novel', levels: ['Act', 'Chapter', 'Scene'], order: 2 } });
put({ id: 'ac_h', kind: 'act', parent_id: 'pr_harbour', title: 'Act One', sort: 1 });
put({ id: 'ch_h1', kind: 'chapter', parent_id: 'ac_h', title: 'The light', sort: 1, fields: { words: 9 } });
para('pa_h1', 'ch_h1', 0, 'The lighthouse keeper counted the ships.');
para('pa_h2', 'ch_h1', 1, 'Mara wrote the letter.');
put({ id: 'pg_research', kind: 'page', parent_id: 'pr_harbour', title: 'Research', sort: 1 });
put({ id: 'li_r1', kind: 'line', parent_id: 'pg_research', sort: 1, text: 'Tide tables for 1912', content: [{ type: 'text', text: 'Tide tables for 1912' }] });
put({ id: 'pg_idea', kind: 'page', parent_id: 'pr_harbour', title: 'Idea', sort: 0 });
put({ id: 'pr_xmas', kind: 'project', title: 'Christmas', area_id: 'area-personal', fields: { type: 'notes' } });
put({ id: 'pg_gifts', kind: 'page', parent_id: 'pr_xmas', title: 'Gifts', sort: 1 });
put({ id: 'pr_pilot', kind: 'project', title: 'Pilot', area_id: 'area-writing', fields: { type: 'screenplay', levels: ['Act', 'Script', 'Scene'] } });
put({ id: 'ac_p', kind: 'act', parent_id: 'pr_pilot', title: 'Screenplay', sort: 1 });
put({ id: 'ch_p1', kind: 'chapter', parent_id: 'ac_p', title: 'Script', sort: 1, fields: { words: 12 } });
para('pa_p1', 'ch_p1', 0, 'INT. DOJO - NIGHT', { el: 'scene' });
para('pa_p2', 'ch_p1', 1, 'Kenji sweeps the floor.', { el: 'action' });
para('pa_p3', 'ch_p1', 2, 'EXT. ROOF - NIGHT', { el: 'scene' });
para('pa_p4', 'ch_p1', 3, 'Rain.', { el: 'action' });
const trashedAt = Date.parse('2026-10-19T00:00:00Z');
put({ id: 'pr_old', kind: 'project', title: 'Old draft', area_id: 'area-writing', fields: { type: 'novel', trashed: trashedAt, trashedWith: 'pr_old' } });
put({ id: 'ac_o', kind: 'act', parent_id: 'pr_old', title: 'Act One', sort: 1, fields: { trashed: trashedAt, trashedWith: 'pr_old' } });
put({ id: 'ch_o1', kind: 'chapter', parent_id: 'ac_o', title: 'Chapter 1', sort: 1, fields: { trashed: trashedAt, trashedWith: 'pr_old' } });
para('pa_o1', 'ch_o1', 0, 'Words worth keeping.', { trashed: trashedAt, trashedWith: 'pr_old' });
const before = new Map([...table.values()].map((r) => [r.id, { ...r }]));

const browser = await chromium.launch();
async function device() {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } });
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
const local = (p, store = 'entries') => p.evaluate((s) => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); };
}), store);
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
const live = () => [...table.values()].filter((r) => !r.deleted);
const row = (id) => table.get(id);

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 6).join('\n     ')}`); }
}

try {
  const laptop = await device();
  await settle(laptop);

  await check('a book from before worlds gets a world of the same name, with its pages as the bible', async () => {
    const w = row('wd-pr_harbour');
    assert.ok(w && !w.deleted && w.kind === 'world', 'world made');
    assert.equal(w.title, 'The Harbour');
    assert.equal(w.area_id, 'area-writing');
    assert.equal(w.fields.order, 2, 'My order kept');
    assert.equal(row('pr_harbour').parent_id, w.id);
    assert.equal(row('pg_research').parent_id, w.id);
    assert.equal(row('pg_idea').parent_id, w.id);
    assert.equal(row('li_r1').parent_id, 'pg_research');
  });

  await check('a notes collection becomes a world itself', async () => {
    assert.equal(row('pr_xmas').kind, 'world');
    assert.equal(row('pr_xmas').area_id, 'area-personal');
    assert.equal(row('pg_gifts').parent_id, 'pr_xmas');
    assert.ok(!table.has('wd-pr_xmas'));
  });

  await check('a book in the Trash stays in the Trash, in its world, with its words', async () => {
    const w = row('wd-pr_old');
    assert.equal(w.fields.trashed, trashedAt);
    assert.equal(row('pr_old').parent_id, w.id);
    assert.equal(row('pa_o1').text, 'Words worth keeping.');
  });

  await check('nothing was lost: every entry and every word is still there', async () => {
    for (const [id, was] of before) {
      const now = row(id);
      assert.ok(now, `${id} still there`);
      assert.equal(now.deleted, false, `${id} not deleted`);
      assert.equal(now.text, was.text, `${id} words`);
      assert.equal(now.title, was.title, `${id} title`);
      if (!['project', 'page'].includes(was.kind)) assert.equal(now.parent_id, was.parent_id, `${id} where`);
    }
    assert.ok(!live().some((r) => r.kind === 'project' && !r.parent_id), 'no book left outside a world');
  });

  await check('the Library shows worlds, and opening one shows its pieces and bible', async () => {
    await laptop.keyboard.press('Control+Shift+O');
    await sleep(500);
    const titles = await laptop.locator('#lib-books .card-title').allInnerTexts();
    for (const t of ['The Harbour', 'Christmas', 'Pilot']) assert.ok(titles.includes(t), titles.join(' | '));
    assert.ok(!titles.includes('Old draft'));
    await laptop.locator('.card', { hasText: 'The Harbour' }).first().click();
    await sleep(500);
    assert.equal(await laptop.evaluate(() => document.documentElement.dataset.view), 'world');
    assert.match(await laptop.locator('#wh-pieces').innerText(), /The Harbour/);
    const bible = await laptop.locator('#wh-recent').innerText();
    assert.match(bible, /Research/);
    assert.match(bible, /Idea/);
  });

  const phone = await device();
  await settle(phone);
  await settle(laptop);

  await check('a second device brought up to date ends up the same, with no clashes', async () => {
    const mine = await local(phone);
    const by = new Map(mine.map((r) => [r.id, r]));
    for (const id of ['wd-pr_harbour', 'pr_harbour', 'pg_research', 'pr_xmas', 'wd-pr_old', 'pa_h1']) {
      assert.equal(by.get(id)?.parent_id ?? null, row(id).parent_id ?? null, `${id} where`);
      assert.equal(by.get(id)?.kind, row(id).kind, `${id} kind`);
    }
    assert.ok(!mine.some((r) => r.kind === 'project' && !r.deleted && !r.parent_id));
    assert.deepEqual(await local(phone, 'conflicts'), []);
    assert.deepEqual(await local(laptop, 'conflicts'), []);
    // No stray empty books from a fresh start on either device.
    assert.ok(!live().some((r) => r.title === 'Untitled novel'), live().filter((r) => r.title === 'Untitled novel').map((r) => r.id).join(','));
  });

  await check('bringing it up to date twice changes nothing', async () => {
    const was = JSON.stringify([...table.values()].map((r) => [r.id, r.parent_id, r.kind, r.deleted]).sort());
    await phone.reload();
    await phone.waitForSelector('#editor .ProseMirror', { state: 'attached' });
    await sleep(800);
    await settle(phone);
    assert.equal(JSON.stringify([...table.values()].map((r) => [r.id, r.parent_id, r.kind, r.deleted]).sort()), was);
  });

  await check('what you write is marked as yours; what Claude adds stays Claude\'s when you edit it', async () => {
    await laptop.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate', { state: { view: 'write', chapterId: 'ch_h1' } })));
    await sleep(600);
    await laptop.locator('#editor .ProseMirror p').last().click();
    await laptop.keyboard.press('End');
    await laptop.keyboard.press('Enter');
    await laptop.keyboard.type('A new line from the laptop.');
    await sleep(900);
    await settle(laptop);
    const mine = live().find((r) => r.kind === 'para' && r.text === 'A new line from the laptop.');
    assert.ok(mine, 'saved');
    assert.equal(mine.fields.by, 'u1');
    assert.equal(mine.fields.edited_by, 'u1');
    assert.equal(row('pa_h1').fields.by, undefined, 'untouched paragraphs are left alone');

    // Claude adds a paragraph through the connector.
    put({ id: 'pa_claude', kind: 'para', parent_id: 'ch_h1', sort: 0.5, text: 'Fog rolled in.', content: [{ type: 'text', text: 'Fog rolled in.' }], fields: { by: 'claude', edited_by: 'claude' } });
    await settle(phone);
    await phone.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate', { state: { view: 'write', chapterId: 'ch_h1' } })));
    await sleep(600);
    await phone.locator('#editor .ProseMirror p', { hasText: 'Fog rolled in.' }).click();
    await phone.keyboard.press('End');
    await phone.keyboard.type(' Thick fog.');
    await sleep(900);
    await settle(phone);
    const c = row('pa_claude');
    assert.equal(c.text, 'Fog rolled in. Thick fog.');
    assert.equal(c.fields.by, 'claude');
    assert.equal(c.fields.edited_by, 'u1');
  });

  await check('scenes have no numbers until you choose Number the scenes', async () => {
    await laptop.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate', { state: { view: 'write', chapterId: 'ch_p1' } })));
    await sleep(600);
    assert.equal(row('pa_p1').fields.code, undefined);
    assert.equal(await laptop.locator('#editor [data-code]').count(), 0);
  });

  await check('Number the scenes asks first, then numbers 1, 2 and shows them', async () => {
    await command(laptop, 'Number the scenes');
    await laptop.locator('.ask .pill', { hasText: 'Number the scenes' }).click();
    await sleep(600);
    await settle(laptop);
    assert.equal(row('pr_pilot').fields.numbered, true);
    assert.equal(row('pa_p1').fields.code, '1');
    assert.equal(row('pa_p3').fields.code, '2');
    assert.deepEqual(await laptop.locator('#editor [data-code]').evaluateAll((els) => els.map((e) => e.dataset.code)), ['1', '2']);
  });

  await check('a scene added between 1 and 2 becomes 1A, and the others keep theirs', async () => {
    // The caret at the end of the first scene's action line.
    await laptop.evaluate(() => {
      const ed = window.__editor;
      let at = null;
      ed.state.doc.forEach((n, pos) => { if (n.textContent === 'Kenji sweeps the floor.') at = pos + n.nodeSize - 1; });
      ed.commands.focus();
      ed.commands.setTextSelection(at);
    });
    await laptop.keyboard.press('Enter');
    await laptop.keyboard.type('INT. KITCHEN - NIGHT');
    await laptop.keyboard.press('Enter');
    await laptop.keyboard.type('Kenji eats.');
    await sleep(900);
    await settle(laptop);
    const added = live().find((r) => r.text === 'INT. KITCHEN - NIGHT');
    assert.equal(added?.fields.el, 'scene');
    assert.equal(added?.fields.code, '1A');
    assert.equal(row('pa_p1').fields.code, '1');
    assert.equal(row('pa_p3').fields.code, '2');
  });

  await check('turning numbering off only hides the numbers', async () => {
    await command(laptop, 'Scene numbers: turn off');
    await sleep(500);
    await settle(laptop);
    assert.equal(row('pr_pilot').fields.numbered, false);
    assert.equal(row('pa_p3').fields.code, '2');
    assert.equal(await laptop.locator('#editor [data-code]').evaluateAll((els) => els.filter((e) => getComputedStyle(e, '::before').content !== 'none' && getComputedStyle(e, '::before').content !== 'normal').length), 0);
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
