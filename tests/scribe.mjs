// Scribe keeps its recordings here: with "Keep in Inkwell" on for a mode, the
// server files each recording on that day's page with what was heard and what
// Scribe typed in (fields.scribe). When it arrives by sync it's written up
// like a Capture, in Scribe's mode, from those words: nothing heard twice,
// word for word kept, the mode's #tag. window.__remote stands in for the
// server's tables.
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

const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const DAY = `day-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const table = new Map();
let clock = Date.parse('2026-10-20T00:00:00Z');
const stamp = () => new Date((clock += 1000)).toISOString();
// What the server's Scribe step writes (supabase/functions/scribe/keep.ts in daybook).
function filed(n, said, typed, mode, name) {
  const node = { type: 'file', attrs: { id: `fi_s${n}`, name: `Scribe 9:4${n} pm.m4a`, type: 'audio/mp4', size: 900, duration: 61000 } };
  table.set(`fi_s${n}`, { id: `fi_s${n}`, user_id: 'u1', kind: 'file', parent_id: null, sort: 0, title: node.attrs.name, text: '', content: null, tags: [], type: null, area_id: null, links: [], deleted: false, fields: { type: 'audio/mp4', size: 900, duration: 61000, from: 'scribe' }, updated_at: stamp() });
  table.set(`li_s${n}`, {
    id: `li_s${n}`, user_id: 'u1', kind: 'line', parent_id: DAY, sort: 1024 * n, title: '', text: ` 9:4${n} pm #idea`, content: [node, { type: 'text', text: ` 9:4${n} pm #idea` }],
    tags: ['idea'], type: null, area_id: null, links: [], deleted: false, updated_at: stamp(),
    fields: { done: false, gather: null, gathered: null, mirror: null, capture: 'voice', said: `9:4${n} pm`, scribe: { raw: said, text: typed, mode, name, app: 'com.google.android.keep', by: 'elevenlabs' } }
  });
}
function remote(op, arg) {
  if (op === 'push') {
    const at = stamp();
    return arg.map((r) => { table.set(r.id, { ...r, user_id: 'u1', updated_at: at }); return { id: r.id, updated_at: at }; });
  }
  if (op === 'pull') return [...table.values()].filter((r) => r.updated_at > arg.since).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)).slice(arg.from, arg.from + 500);
}
const fake = () => {
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: (rows) => window.__remote('push', rows),
    pull: (since, from) => window.__remote('pull', { since, from }),
    async upload() {}, async download() { throw new Error('not found'); },
    subscribe() {}, unsubscribe() {}
  };
  window.__asked = [];
  window.__claude = async (body) => {
    window.__asked.push(body.mode);
    if (body.mode === 'voice-modes') return { modes: [{ id: 'journal', name: 'Journal' }, { id: 'idea', name: 'Idea' }, { id: 'text', name: 'Text message' }] };
    throw new Error('Not now');
  };
};
const entries = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result.filter((l) => !l.deleted)); };
}));

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.exposeFunction('__remote', remote);
await ctx.addInitScript(fake);
const page = await ctx.newPage();
page.errors = [];
page.on('pageerror', (e) => page.errors.push(e.message));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

try {
  filed(1, 'Um okay so today I walked the dog and um I thought about the opening number. And then the rooftop shot.', 'Today I walked the dog and thought about the opening number.\n\nThen the rooftop shot.\nAnd the lantern.', 'journal', 'Journal');
  filed(2, 'Running late be there at six', 'Running late be there at six', 'text', 'Text message');
  await page.goto(URL);
  await page.waitForSelector('#editor .ProseMirror');

  await check('a journal kept by Scribe is written up from its words, in Journal', async () => {
    await page.waitForFunction(() => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const g = r.result.transaction('entries').objectStore('entries').get('li_s1'); g.onsuccess = () => res(!!g.result?.fields?.voice); }; }), null, { timeout: 15000 });
    const all = await entries(page);
    const line = all.find((r) => r.id === 'li_s1');
    assert.equal(line.fields.voice.mode, 'journal');
    assert.match(line.fields.voice.raw, /^Um okay so today/, 'word for word kept');
    assert.equal(line.content[0].type, 'file', 'the recording stays first');
    assert.ok(line.content.some((n) => n.type === 'voice' && n.attrs.name === 'Journal'), 'the mode chip');
    assert.match(line.text, /9:41 pm/);
    assert.match(line.text, /Today I walked the dog/);
    assert.match(line.text, /#journal/);
    assert.doesNotMatch(line.text, /#idea/);
    const under = all.filter((r) => r.parent_id === 'li_s1' && r.kind === 'line').map((r) => r.text);
    assert.deepEqual(under, ['Then the rooftop shot.', 'And the lantern.']);
    assert.ok(!(await page.evaluate(() => window.__asked)).includes('voice'), 'not heard or written again');
  });

  await check('a text message kept by Scribe keeps its mode, even typed as said', async () => {
    await page.waitForFunction(() => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const g = r.result.transaction('entries').objectStore('entries').get('li_s2'); g.onsuccess = () => res(!!g.result?.fields?.voice); }; }), null, { timeout: 15000 });
    const line = (await entries(page)).find((r) => r.id === 'li_s2');
    assert.equal(line.fields.voice.mode, 'text');
    assert.match(line.text, /Running late be there at six #message$/);
  });

  await check('the write-up goes back up, and isn’t made twice', async () => {
    for (let i = 0; i < 40 && !table.get('li_s1')?.fields?.voice; i++) await sleep(150);
    assert.ok(table.get('li_s1').fields.voice, 'pushed');
    await page.reload();
    await page.waitForSelector('#editor .ProseMirror');
    await sleep(2500);
    const under = (await entries(page)).filter((r) => r.parent_id === 'li_s1' && r.kind === 'line');
    assert.equal(under.length, 2);
  });

  await check('it shows on today’s page', async () => {
    await page.keyboard.press('Control+J');
    await page.waitForFunction(() => /Today I walked the dog/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), null, { timeout: 8000 });
    await page.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => {});
  });

  await check('no page errors', async () => { assert.deepEqual(page.errors, []); });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('scribe: all passed');
