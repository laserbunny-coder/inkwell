// Claude's tidy pass: suggestions made on the server (a batch of kind 'tidy')
// come down by sync, show on the pass, and nothing changes until a yes. Each
// yes does what it says, reaches the other device, and can be undone there or
// here; a no stays a no. Claude's own changes through the connector (kind
// 'change') are listed with an Undo, which is refused when the thing was
// changed since. No yes or undo ever removes writing.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4197;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

// The cloud, shared by both devices (as in tests/sync.mjs), which the server also writes to.
const table = new Map();
let clock = Date.parse('2026-11-02T12:00:00Z');
const stamp = () => new Date((clock += 1000)).toISOString();
function remote(op, arg) {
  if (op === 'push') return arg.map((r) => { const at = stamp(); table.set(r.id, { ...r, user_id: 'u1', updated_at: at }); return { id: r.id, updated_at: at }; });
  if (op === 'pull') {
    return [...table.values()].filter((r) => r.updated_at > arg.since)
      .sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : 1))
      .slice(arg.from, arg.from + 500);
  }
}
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const TODAY = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY = `day-${TODAY}`;
const at = new Date().toISOString();
const row = (r) => ({ sort: 1024, title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: at, ...r });
const line = (id, parent, text, more = {}) => row({ id, kind: 'line', parent_id: parent, text, content: [{ type: 'text', text }], tags: [...text.matchAll(/#([\w-]+)/g)].map((m) => m[1].toLowerCase()), fields: { done: false }, ...more });
// What the server writes (the weekly job, or the connector).
function serverWrite(rows) { for (const r of rows) table.set(r.id, { ...r, user_id: 'u1', updated_at: stamp() }); }

const item = (type, a, b, title, more = {}) => ({ key: [type, a, b].filter(Boolean).join(':'), type, a, b, title, why: `Why: ${title}`, choice: null, by: 'claude', ...more });
serverWrite([
  row({ id: 'wd_x1', kind: 'world', title: 'Christmas', area_id: null, sort: 1 }),
  row({ id: 'pg_x1', kind: 'page', parent_id: 'wd_x1', title: 'I want to plan Christmas', sort: 1 }),
  line('li_x1', 'pg_x1', 'Ask Mom about dinner'),
  row({ id: 'wd_x2', kind: 'world', title: 'Christmas 2026 Planning', area_id: null, sort: 2 }),
  row({ id: 'pg_gifts', kind: 'page', parent_id: 'wd_x2', title: 'Gifts', sort: 1 }),
  line('li_g1', 'pg_gifts', 'Ramen kit for Mom'),
  row({ id: 'wd_ninja', kind: 'world', title: 'The Ninja Bunch', area_id: 'area-writing', sort: 3 }),
  row({ id: 'pg_kenji', kind: 'page', parent_id: 'wd_ninja', title: 'Kenji', sort: 1 }),
  row({ id: DAY, kind: 'day', title: TODAY }),
  row({ id: 'li_d1', kind: 'line', parent_id: DAY, sort: 1024, text: 'Kenji should sing about the dentist Kenji', content: [{ type: 'text', text: 'Kenji should sing about the dentist ' }, { type: 'entryRef', attrs: { id: 'pg_kenji', title: 'Kenji' } }], links: ['pg_kenji'], fields: { done: false } }),
  line('li_d2', DAY, 'A heist film where the vault is a bakery', { sort: 2048 }),
  line('li_d3', DAY, 'New video model looks great #ai', { sort: 3072 }),
  line('li_d4', DAY, 'Kling 3 is out #ai-tools', { sort: 4096 }),
  line('li_d5', DAY, 'Buy more tape', { sort: 5120 }),
  line('li_d6', DAY, 'Move this to Gifts', { sort: 6144 }),
  row({ id: 'td-week-2026-11-02', kind: 'tidy', title: 'Tidy pass', fields: { by: 'claude', tidy: { at, week: '2026-11-02', items: [
    item('merge', 'wd_x1', 'wd_x2', 'Put everything in “Christmas” into “Christmas 2026 Planning”'),
    item('file', 'li_d1', 'pg_kenji', 'File “Kenji should sing…” on “Kenji”'),
    item('drawer', 'li_d2', null, 'Put “A heist film…” in the Drawer'),
    { ...item('tags', 'ai', 'ai-tools', 'Fold #ai into #ai-tools'), key: 'tags:ai>ai-tools' },
    item('life', 'wd_x2', null, 'Make “Christmas 2026 Planning” a life project'),
    item('area', 'wd_x2', 'area-personal', 'Move “Christmas 2026 Planning” to Personal'),
    { ...item('rename', 'wd_x2', null, 'Rename “Christmas 2026 Planning” to “Christmas 2026”', { text: 'Christmas 2026' }), key: 'rename:wd_x2>christmas 2026' },
  ] } } }),
  // Claude's own changes through the connector, already made.
  line('li_done', DAY, 'Order the cabin', { sort: 7168, fields: { done: true, claude: { change: 'cx_1' } } }),
  row({ id: 'cx_1', kind: 'change', title: 'Ticked “Order the cabin”', fields: { by: 'claude', change: { type: 'done', target: 'li_done', title: 'Ticked “Order the cabin”', before: { done: false }, after: { done: true }, at, why: 'You said you booked it' } } }),
  line('li_moved', 'pg_gifts', 'Wrap them on the 20th', { sort: 9000, fields: { done: false, claude: { change: 'cx_2' } } }),
  row({ id: 'cx_2', kind: 'change', title: 'Moved “Wrap them on the 20th” to Gifts', fields: { by: 'claude', change: { type: 'move', target: 'li_moved', title: 'Moved “Wrap them on the 20th” to Gifts', before: { parent_id: DAY, sort: 8192 }, after: { parent_id: 'pg_gifts', sort: 9000 }, at: new Date(Date.now() + 1000).toISOString() } } }),
  line('li_changed', DAY, 'Call the venue', { sort: 10000, fields: { done: false } }),
  row({ id: 'cx_3', kind: 'change', title: 'Ticked “Call the venue”', fields: { by: 'claude', change: { type: 'done', target: 'li_changed', title: 'Ticked “Call the venue”', before: { done: false }, after: { done: true }, at: new Date(Date.now() + 2000).toISOString() } } }),
  // A task Claude moved to another day, and a day it put in order.
  line('li_task', 'pg_gifts', 'Book the movers', { sort: 9500, fields: { done: false, box: true, task: { v: 1, day: '2026-11-12', est: 60, done_at: null, actual: null, log: [], run: null, order: 4 }, claude: { change: 'cx_4' } } }),
  row({ id: 'cx_4', kind: 'change', title: 'Changed “Book the movers”: to 2026-11-12, 60 min', fields: { by: 'claude', change: { type: 'task', target: 'li_task', title: 'Changed “Book the movers”: to 2026-11-12, 60 min', before: { task: { day: '2026-11-10', est: 30, order: 1 }, box: true }, after: { task: { day: '2026-11-12', est: 60, order: 4 } }, at: new Date(Date.now() + 3000).toISOString() } } }),
  line('li_t2', 'pg_gifts', 'Pack the books', { sort: 9600, fields: { done: false, box: true, task: { v: 1, day: '2026-11-10', est: null, done_at: null, actual: null, log: [], run: null, order: 1 } } }),
  row({ id: 'cx_5', kind: 'change', title: 'Reordered today: “Pack the books”', fields: { by: 'claude', change: { type: 'order', target: '2026-11-10', title: 'Reordered today: “Pack the books”', before: { order: { li_t2: 2 } }, after: { order: { li_t2: 1 } }, at: new Date(Date.now() + 4000).toISOString() } } }),
]);

const fake = () => {
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: (rows) => window.__remote('push', rows),
    pull: (since, from) => window.__remote('pull', { since, from }),
    async upload() {}, async download() { throw new Error('not found'); },
    subscribe() {}, unsubscribe() {}
  };
  // Claude, for the "look things over now" button: the server makes a batch.
  window.__claude = async (body) => (body.mode === 'tidy' ? window.__tidyNow() : {});
};

const browser = await chromium.launch();
async function device() {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, colorScheme: 'dark' });
  await ctx.exposeFunction('__remote', remote);
  await ctx.exposeFunction('__tidyNow', () => {
    serverWrite([row({ id: 'td_now1', kind: 'tidy', title: 'Tidy pass', fields: { by: 'claude', tidy: { at: new Date().toISOString(), week: null, items: [item('trash_empty', 'wd_x1', null, 'Put the empty world “Christmas” in the Trash')] } } })]);
    return { id: 'td_now1', count: 1 };
  });
  await ctx.addInitScript(fake);
  await ctx.addInitScript(() => { if (!localStorage.getItem('place')) localStorage.setItem('place', JSON.stringify({ view: 'notebook', pageId: `day-${new Date().toLocaleDateString('en-CA')}` })); });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(URL);
  await page.waitForSelector('#outline-editor .ProseMirror');
  for (let i = 0; i < 40 && !(await get(page, 'td-week-2026-11-02')); i++) await sleep(250);
  await sleep(600);
  return page;
}
const get = (p, id) => p.evaluate((id) => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').get(id); q.onsuccess = () => res(q.result); };
}), id);
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const syncNow = async (p) => { await p.evaluate(() => window.__sync.run()); await sleep(300); };
const both = async (a, b) => { await syncNow(a); await syncNow(b); };
const command = async (p, name) => {
  await p.keyboard.press('Control+K');
  await p.keyboard.type(name);
  await sleep(300);
  await p.keyboard.press('Enter');
  await sleep(600);
};
const card = (p, text) => p.locator('.tp-card', { hasText: text });
const yes = async (p, text) => { await card(p, text).locator('.tp-yes').click(); await sleep(600); };
const words = async (p) => (await all(p)).filter((r) => r.kind === 'line' && !r.deleted).map((r) => (r.text || '').replace(/#[\w-]+/g, '').trim()).sort();

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 4).join('\n     ')}`); }
}

try {
  const a = await device();
  const b = await device();
  const before = await words(a);

  await check('suggestions and Claude’s changes come down by sync and never show as writing', async () => {
    const text = await a.locator('#outline-editor .ProseMirror').innerText();
    assert.doesNotMatch(text, /Fold #ai|Ticked/);
    assert.equal((await get(a, 'td-week-2026-11-02')).fields.tidy.items.length, 7);
  });

  await check('today shows a quiet tidy line, which can be switched off', async () => {
    await a.waitForSelector('.tidy-nudge:not([hidden])');
    assert.match(await a.locator('.tidy-nudge').innerText(), /tidy pass · 7 to look at · claude changed 5 things/i);
    await a.evaluate(() => document.documentElement.classList.add('hide-tidy'));
    assert.equal(await a.locator('.tidy-nudge').isVisible(), false);
    await a.evaluate(() => document.documentElement.classList.remove('hide-tidy'));
  });

  await check('the pass opens from Ctrl + K and lists each suggestion with why, Yes and No', async () => {
    await command(a, 'Tidy pass');
    await a.waitForSelector('.tp');
    assert.equal(await a.locator('.tp-card').count(), 7);
    assert.match(await a.locator('.tp .ck-lead').innerText(), /7 tidy-ups/);
    assert.match(await card(a, 'Fold #ai').innerText(), /Why: Fold/);
    assert.equal(await a.locator('.tp-change').count(), 5);
    // Nothing changed just by looking.
    assert.equal((await get(a, 'wd_x1')).fields.trashed, undefined);
  });

  await check('merge moves everything across, puts the emptied world in the Trash, and reaches the other device', async () => {
    await yes(a, 'Put everything in');
    assert.equal((await get(a, 'pg_x1')).parent_id, 'wd_x2');
    assert.ok((await get(a, 'wd_x1')).fields.trashed);
    assert.equal((await get(a, 'li_x1')).text, 'Ask Mom about dinner');
    assert.match(await card(a, 'Put everything in').innerText(), /Merged\s*Undo/);
    await both(a, b);
    assert.equal((await get(b, 'pg_x1')).parent_id, 'wd_x2');
    assert.ok((await get(b, 'wd_x1')).fields.trashed);
  });

  await check('undo on the other device puts it back as it was, and that syncs too', async () => {
    await command(b, 'Tidy pass');
    await b.waitForSelector('.tp');
    assert.match(await card(b, 'Put everything in').innerText(), /Merged/);
    await card(b, 'Put everything in').locator('.tp-undo').click();
    await sleep(700);
    assert.equal((await get(b, 'pg_x1')).parent_id, 'wd_x1');
    assert.equal((await get(b, 'wd_x1')).fields.trashed, undefined);
    assert.ok(await card(b, 'Put everything in').locator('.tp-yes').isVisible(), 'waits again');
    await both(b, a);
    await a.evaluate(() => {}); // the open pass redraws from sync
    await sleep(400);
    assert.equal((await get(a, 'pg_x1')).parent_id, 'wd_x1');
    assert.ok(await card(a, 'Put everything in').locator('.tp-yes').isVisible());
    await b.keyboard.press('Escape');
  });

  await check('file puts a mirror on the bible page and the line stays on the day; undo takes it back', async () => {
    await yes(a, 'File “Kenji');
    const mirror = (await all(a)).find((r) => r.parent_id === 'pg_kenji' && r.fields?.mirror === 'li_d1' && !r.deleted);
    assert.ok(mirror);
    assert.equal((await get(a, 'li_d1')).parent_id, DAY);
    await card(a, 'File “Kenji').locator('.tp-undo').click();
    await sleep(600);
    assert.equal((await get(a, mirror.id)).deleted, true);
    await yes(a, 'File “Kenji');
  });

  await check('drawer adds #drawer, undo takes only the tag off', async () => {
    await yes(a, 'heist film');
    assert.ok((await get(a, 'li_d2')).tags.includes('drawer'));
    await card(a, 'heist film').locator('.tp-undo').click();
    await sleep(600);
    assert.equal((await get(a, 'li_d2')).text, 'A heist film where the vault is a bakery');
    await yes(a, 'heist film');
  });

  await check('folding a tag changes only the tag, and undo changes back only those lines', async () => {
    await yes(a, 'Fold #ai');
    assert.equal((await get(a, 'li_d3')).text, 'New video model looks great #ai-tools');
    await card(a, 'Fold #ai').locator('.tp-undo').click();
    await sleep(600);
    assert.equal((await get(a, 'li_d3')).text, 'New video model looks great #ai');
    assert.equal((await get(a, 'li_d4')).text, 'Kling 3 is out #ai-tools', 'a line that had #ai-tools all along keeps it');
    await yes(a, 'Fold #ai');
  });

  await check('life project, area and rename each do what they say', async () => {
    await yes(a, 'a life project');
    assert.equal((await get(a, 'wd_x2')).fields.life, true);
    await yes(a, 'to Personal');
    assert.equal((await get(a, 'wd_x2')).area_id, 'area-personal');
    await yes(a, 'Rename');
    assert.equal((await get(a, 'wd_x2')).title, 'Christmas 2026');
  });

  await check('no leaves it as it is and is remembered on the other device', async () => {
    await card(a, 'Put everything in').locator('.tp-no').click();
    await sleep(600);
    assert.match(await card(a, 'Put everything in').innerText(), /Left as it is/);
    assert.equal((await get(a, 'wd_x1')).fields.trashed, undefined);
    await both(a, b);
    const items = (await get(b, 'td-week-2026-11-02')).fields.tidy.items;
    assert.equal(items[0].choice, 'no');
    assert.equal(items.filter((i) => i.choice === 'yes').length, 6);
    assert.equal((await get(b, 'wd_x2')).title, 'Christmas 2026');
    assert.equal((await get(b, 'wd_x2')).fields.life, true);
  });

  await check('Claude’s changes can be undone: a tick and a move go back', async () => {
    const ch = (t) => a.locator('.tp-change', { hasText: t });
    await ch('Order the cabin').locator('.tp-undo').click();
    await sleep(600);
    assert.equal((await get(a, 'li_done')).fields.done, false);
    assert.match(await ch('Order the cabin').innerText(), /Undone/);
    await ch('Wrap them').locator('.tp-undo').click();
    await sleep(600);
    assert.equal((await get(a, 'li_moved')).parent_id, DAY);
    assert.equal((await get(a, 'cx_2')).fields.change.undone_by, 'me');
  });

  await check('Claude’s task changes can be undone: the day and estimate, and a day’s order', async () => {
    const ch = (t) => a.locator('.tp-change', { hasText: t });
    await ch('Book the movers').locator('.tp-undo').click();
    await sleep(600);
    const t = (await get(a, 'li_task')).fields.task;
    assert.deepEqual([t.day, t.est, t.order], ['2026-11-10', 30, 1]);
    await ch('Reordered today').locator('.tp-undo').click();
    await sleep(600);
    assert.equal((await get(a, 'li_t2')).fields.task.order, 2);
    assert.match(await ch('Reordered today').innerText(), /Undone/);
  });

  await check('undo of a change is refused when the thing was changed since', async () => {
    // cx_3 says it ticked "Call the venue", but the line isn't ticked now.
    await a.locator('.tp-change', { hasText: 'Call the venue' }).locator('.tp-undo').click();
    await sleep(500);
    assert.match(await a.locator('.toast').last().innerText(), /changed it since/);
    assert.ok(!(await get(a, 'cx_3')).fields.change.undone_at);
    assert.equal((await get(a, 'li_changed')).fields.done, false);
  });

  await check('asking for a pass now brings new suggestions in', async () => {
    await a.locator('.tp-ask .ghost-btn').click();
    await a.waitForSelector('.tp-card:has-text("empty world")', { timeout: 5000 });
    await yes(a, 'empty world');
    // It has words in it (Ask Mom about dinner), so it stays.
    assert.match(await a.locator('.toast').last().innerText(), /has writing in it/);
    assert.equal((await get(a, 'wd_x1')).fields.trashed, undefined);
  });

  await check('no yes or undo removed any writing', async () => {
    await both(a, b);
    const after = await words(a);
    for (const w of before) assert.ok(after.includes(w), `“${w}” is still there`);
    for (const r of (await all(b)).filter((x) => x.kind === 'line')) assert.equal(r.deleted && !r.fields?.mirror, false, `${r.text} still there`);
  });

  await check('the pass link (?tidy=) opens it, and the nudge counts are gone once looked at', async () => {
    await a.keyboard.press('Escape');
    await a.goto(`${URL}?tidy=2026-11-02`);
    await a.waitForSelector('.tp', { timeout: 6000 });
    assert.match(await a.locator('.tp .ck-lead').innerText(), /Nothing waiting|tidy-up/);
  });

  await check('a line the connector moves or ticks updates the open day page on the next sync', async () => {
    await b.goto(URL);
    await b.waitForSelector('#outline-editor .ProseMirror');
    await sleep(800);
    assert.match(await b.locator('#outline-editor .ProseMirror').innerText(), /Buy more tape/);
    // What the connector does: only parent_id/sort, or fields, on the row as stored.
    const t5 = table.get('li_d5');
    serverWrite([{ ...t5, parent_id: 'pg_gifts', sort: 99999, fields: { ...t5.fields, claude: { change: 'cx_9' } } }]);
    const t6 = table.get('li_d6');
    serverWrite([{ ...t6, fields: { ...t6.fields, done: true, claude: { change: 'cx_10' } } }]);
    await syncNow(b);
    await sleep(600);
    const text = await b.locator('#outline-editor .ProseMirror').innerText();
    assert.doesNotMatch(text, /Buy more tape/);
    assert.equal(await b.locator('#outline-editor li[data-done]', { hasText: 'Move this to Gifts' }).count(), 1, 'shows ticked');
    assert.equal((await get(b, 'li_d6')).fields.done, true);
    assert.equal((await get(b, 'li_d5')).text, 'Buy more tape');
  });

  await check('no errors', async () => {
    assert.deepEqual(a.errors, []);
    assert.deepEqual(b.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall tidy pass checks passed');
