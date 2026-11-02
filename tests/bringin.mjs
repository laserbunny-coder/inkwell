// Bring in old notes: a section pasted (plain, Markdown or rich text) or an
// exported file (.opml, .md) becomes a page with its nesting kept, where Claude
// suggests; old to-dos come in as plain lines and the live ones can go to
// Daybook; the drawer gets one #drawer line; Brought in lists it all, with Undo.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4241;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const fake = () => {
  const t = new Date().toISOString();
  const row = (r) => ({ sort: 1, title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: t, updated_at: t, ...r });
  const SEED = [
    row({ id: 'wd_nb', kind: 'world', parent_id: null, title: 'Ninja Bunch', area_id: 'area-filmmaking' }),
    row({ id: 'pg_kenji', kind: 'page', parent_id: 'wd_nb', title: 'Kenji' }),
    row({ id: 'li_k1', kind: 'line', parent_id: 'pg_kenji', text: 'Afraid of the dentist #gags', content: [{ type: 'text', text: 'Afraid of the dentist #gags' }], tags: ['gags'], fields: { done: false } }),
  ];
  window.__pushed = [];
  window.__asked = [];
  window.__tasks = [];
  window.__relinked = [];
  window.__answer = null;
  window.__claude = async (body) => { window.__asked.push(body); return window.__answer ? window.__answer(body) : { home: '', title: '', about: '', tags: [], todos: [] }; };
  window.__daybook = async (task) => { window.__tasks.push(task); };
  window.__relink = async (from, to) => { window.__relinked.push([from, to]); return 2; };
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: async (rows) => { window.__pushed.push(...rows); return rows.map((r) => ({ id: r.id, updated_at: new Date().toISOString() })); },
    pull: async (since, from) => (since < '2000' && from === 0 && !localStorage.getItem('seeded') ? (localStorage.setItem('seeded', '1'), SEED) : []),
    async upload() {}, async download() { throw new Error('not found'); },
    subscribe() {}, unsubscribe() {}
  };
};

const get = (p, id) => p.evaluate((id) => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').get(id); q.onsuccess = () => res(q.result); };
}), id);
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const command = async (p, name) => {
  await p.keyboard.press('Control+K');
  await p.keyboard.type(name);
  await sleep(300);
  await p.keyboard.press('Enter');
  await sleep(500);
};
const paste = (p, { text = '', html = '' }) => p.evaluate(({ text, html }) => {
  const dt = new DataTransfer();
  if (text) dt.setData('text/plain', text);
  if (html) dt.setData('text/html', html);
  document.querySelector('.bi-paste').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, { text, html });
// The tree under an entry, as indented text.
const treeOf = async (p, id) => {
  const rows = (await all(p)).filter((r) => !r.deleted && r.kind !== 'about');
  const out = [];
  const walk = (pid, d) => rows.filter((r) => r.parent_id === pid).sort((a, b) => a.sort - b.sort).forEach((r) => { out.push(`${'  '.repeat(d)}${r.text}`); walk(r.id, d + 1); });
  walk(id, 0);
  return out.join('\n');
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: 'dark' });
await ctx.addInitScript(fake);
const page = await ctx.newPage();
page.errors = [];
page.on('pageerror', (e) => page.errors.push(e.message));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

const WORKFLOWY = `- Ninja Bunch gags
  - Kenji hides in the dentist's ceiling
    - [ ] film the ceiling tile bit
  - Sensei falls asleep mid-lesson
- [x] old: buy foam swords
- [ ] call the voice actor back`;

try {
  await page.goto(URL);
  for (let i = 0; i < 40 && !(await get(page, 'pg_kenji')); i++) await sleep(250);
  await sleep(500);

  await check('pasted from Workflowy: nesting kept, Claude fills in the place, title, about, tags and live to-dos', async () => {
    await page.evaluate(() => { window.__answer = (b) => ({ home: 'pg_kenji', title: 'Kenji gags', about: 'Old gag ideas for Kenji and Sensei.', tags: ['gags', 'ninja-bunch'], todos: [b.text.match(/\[(l\d+)\] \(to-do\) call/)[1]] }); });
    await command(page, 'Bring in old notes');
    await page.locator('.bi').waitFor();
    await paste(page, { text: WORKFLOWY });
    await page.waitForFunction(() => document.querySelector('.bi-title')?.value === 'Kenji gags');
    const asked = await page.evaluate(() => window.__asked.at(-1));
    assert.equal(asked.mode, 'bringin');
    assert.match(asked.text, /- \[l1\] Ninja Bunch gags\n  - \[l2\] Kenji hides/);
    assert.ok(asked.homes.some((h) => h.id === 'pg_kenji' && /Ninja Bunch › Kenji/.test(h.title)));
    assert.ok(asked.tags.includes('gags'));
    assert.equal(await page.locator('.bi-place').inputValue(), 'pg_kenji');
    assert.equal(await page.locator('.bi-about').inputValue(), 'Old gag ideas for Kenji and Sensei.');
    assert.equal(await page.locator('.bi-tags').inputValue(), 'gags, ninja-bunch');
    assert.match(await page.locator('.bi-tree').innerText(), /Ninja Bunch gags[\s\S]*Kenji hides/);
    const boxes = page.locator('.bi-todo input');
    assert.equal(await boxes.count(), 2);
    assert.deepEqual([await boxes.nth(0).isChecked(), await boxes.nth(1).isChecked()], [false, true]);
  });

  await check('Bring it in: a page inside Kenji, nested lines, tags, about, came from; one task to Daybook', async () => {
    await page.locator('.bi-app').selectOption('workflowy');
    await page.locator('.bi-go').click();
    await page.waitForFunction(() => !document.querySelector('.bi-tree'));
    const rows = await all(page);
    const pg = rows.find((r) => r.kind === 'page' && r.title === 'Kenji gags');
    assert.ok(pg, 'the page');
    assert.equal(pg.parent_id, 'pg_kenji');
    assert.deepEqual(pg.tags, ['gags', 'ninja-bunch']);
    assert.equal(pg.fields.from.app, 'workflowy');
    assert.equal((await get(page, `ab-${pg.id}`)).text, 'Old gag ideas for Kenji and Sensei.');
    assert.equal(await treeOf(page, pg.id), "Ninja Bunch gags\n  Kenji hides in the dentist's ceiling\n    film the ceiling tile bit\n  Sensei falls asleep mid-lesson\nold: buy foam swords\ncall the voice actor back");
    assert.ok(rows.filter((r) => r.parent_id && r.kind === 'line').every((r) => !r.fields?.done));
    await sleep(300);
    const tasks = await page.evaluate(() => window.__tasks);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, 'call the voice actor back');
    assert.match(tasks[0].link, /\?open=li_/);
  });

  await check('rich text from OneNote: headings hold what follows, lists nest, links and bold come along', async () => {
    await page.evaluate(() => { window.__answer = () => ({ home: '', title: '', about: '', tags: [], todos: [] }); });
    const html = `<html><body><div><h1>Story ideas 2014</h1><p>A dojo run by <b>rabbits</b>.</p><h2>Songs</h2><ul><li>Opening number<ul><li>see <a href="https://example.com/demo">the demo</a></li></ul></li><li>Finale</li></ul><p>Line one<br>Line two</p></div></body></html>`;
    await paste(page, { text: 'Story ideas 2014', html });
    await page.waitForSelector('.bi-tree');
    assert.equal(await page.locator('.bi-title').inputValue(), 'Story ideas 2014');
    // The app stays on the last one (you'll often bring in several from one app).
    assert.equal(await page.locator('.bi-app').inputValue(), 'workflowy');
    await page.locator('.bi-app').selectOption('onenote');
    await page.locator('.bi-place').selectOption('');
    await page.locator('.bi-go').click();
    await page.waitForFunction(() => !document.querySelector('.bi-tree'));
    const pg = (await all(page)).find((r) => r.kind === 'page' && r.title === 'Story ideas 2014');
    assert.equal(pg.parent_id, null);
    assert.equal(await treeOf(page, pg.id), 'A dojo run by rabbits.\nSongs\n  Opening number\n    see the demo\n  Finale\n  Line one\n  Line two');
    const lines = (await all(page)).filter((r) => r.kind === 'line');
    const demo = lines.find((r) => r.text === 'see the demo');
    assert.deepEqual(demo.content.find((n) => n.text === 'the demo').marks, [{ type: 'link', attrs: { href: 'https://example.com/demo' } }]);
    assert.deepEqual(lines.find((r) => r.text === 'A dojo run by rabbits.').content.find((n) => n.text === 'rabbits').marks, [{ type: 'bold' }]);
  });

  await check('an OPML file from Workflowy: its notes come in as lines inside', async () => {
    const opml = `<?xml version="1.0"?><opml version="2.0"><head><title>x</title></head><body><outline text="Bunny dojo"><outline text="Training montage" _note="slow-mo carrots"><outline text="Sensei &amp; the gong"/></outline></outline></body></opml>`;
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.bi').getByRole('button', { name: 'Choose files…' }).click();
    await (await chooser).setFiles({ name: 'dojo.opml', mimeType: 'text/xml', buffer: Buffer.from(opml) });
    await page.waitForSelector('.bi-tree');
    assert.equal(await page.locator('.bi-title').inputValue(), 'Bunny dojo');
    assert.equal(await page.locator('.bi-app').inputValue(), 'workflowy');
    await page.locator('.bi-go').click();
    await page.waitForFunction(() => !document.querySelector('.bi-tree'));
    const pg = (await all(page)).find((r) => r.kind === 'page' && r.title === 'Bunny dojo');
    assert.equal(pg.fields.from.name, 'dojo.opml');
    assert.equal(await treeOf(page, pg.id), 'Training montage\n  slow-mo carrots\n  Sensei & the gong');
  });

  await check('into the drawer: one #drawer line holding it all, on the Brought in page', async () => {
    await paste(page, { text: '# Robot mailman\n\nA short about a robot who delivers grudges.\n\n- he only has one stamp' });
    await page.waitForSelector('.bi-tree');
    await page.locator('.bi-place').selectOption('drawer');
    await page.locator('.bi-tags').fill('shorts');
    await page.locator('.bi-go').click();
    await page.waitForFunction(() => !document.querySelector('.bi-tree'));
    const line = (await all(page)).find((r) => r.kind === 'line' && /^Robot mailman/.test(r.text));
    assert.equal(line.parent_id, 'pg_brought-in');
    assert.equal(line.text, 'Robot mailman #shorts #drawer');
    assert.deepEqual(line.tags.sort(), ['drawer', 'shorts']);
    assert.equal(await treeOf(page, line.id), 'A short about a robot who delivers grudges.\nhe only has one stamp');
  });

  await check('a Thymer page: Daybook tasks pointing at it are switched to the new page', async () => {
    await paste(page, { text: 'Kitchen remodel\n  measure the island' });
    await page.waitForSelector('.bi-tree');
    await page.locator('.bi-app').selectOption('thymer');
    assert.ok(await page.locator('.bi-thymer').isVisible());
    await page.locator('.bi-thymer').fill('https://laserbunny.thymer.com/?open=ws1.abc123');
    await page.locator('.bi-go').click();
    await page.waitForFunction(() => window.__relinked.length === 1);
    const [[from, to]] = await page.evaluate(() => window.__relinked);
    assert.equal(from, 'https://laserbunny.thymer.com/?open=ws1.abc123');
    const pg = (await all(page)).find((r) => r.kind === 'page' && r.title === 'Kitchen remodel');
    assert.ok(to.endsWith(`?open=${pg.id}`));
    assert.equal(await treeOf(page, pg.id), 'measure the island');
  });

  await check('Brought in so far lists them newest first; Undo sends one to the Trash', async () => {
    const list = page.locator('.bi-list');
    await list.locator('summary').click();
    const names = await list.locator('.link-btn').allInnerTexts();
    assert.deepEqual(names, ['Kitchen remodel', 'Robot mailman', 'Bunny dojo', 'Story ideas 2014', 'Kenji gags']);
    await list.locator('li').nth(0).getByRole('button', { name: 'Undo' }).click();
    await sleep(400);
    const pg = (await all(page)).find((r) => r.kind === 'page' && r.title === 'Kitchen remodel');
    assert.ok(pg.fields.trashed);
    assert.equal(await page.locator('.bi-list summary').innerText(), 'Brought in so far (4)');
  });

  await check('open one from the list: the box closes and the page opens', async () => {
    if (!(await page.locator('.bi-list[open]').count())) await page.locator('.bi-list summary').click();
    await page.locator('.bi-list .link-btn', { hasText: 'Bunny dojo' }).click();
    await page.waitForSelector('#outline-editor .ProseMirror');
    await sleep(500);
    assert.equal(await page.locator('.bi').count(), 0);
    assert.match(await page.locator('#outline-editor .ProseMirror').innerText(), /Training montage[\s\S]*slow-mo carrots/);
  });

  await check('everything goes up to the cloud', async () => {
    await sleep(2500);
    const ids = await page.evaluate(() => window.__pushed.map((r) => r.id));
    assert.ok(ids.includes('pg_brought-in'));
  });

  await check('no errors on the page', async () => assert.deepEqual(page.errors, []));
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nbringin: all passed');
