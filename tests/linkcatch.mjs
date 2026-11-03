// Saving links on a computer: a web address pasted or typed on a line of its
// own (on a day or any page) gets what an Android share gets, and the Save
// to Inkwell bookmark (?save=) lands a page on today. window.__claude
// stands in for the server.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4193;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const table = new Map();
let clock = Date.parse('2026-10-20T00:00:00Z');
function remote(op, arg) {
  if (op === 'push') {
    const stamp = new Date((clock += 1000)).toISOString();
    return arg.map((r) => { table.set(r.id, { ...r, user_id: 'u1', updated_at: stamp }); return { id: r.id, updated_at: stamp }; });
  }
  if (op === 'pull') return [...table.values()].filter((r) => r.updated_at > arg.since).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)).slice(arg.from, arg.from + 500);
  if (op === 'snapshot') {
    if (arg.includes('x.com')) return { title: 'Kenji Dance on X: “This choreography is unreal”', summary: 'A post by Kenji Dance on X with a short dance video of a four-person ninja routine.', site: 'X', image: null, tag: '#choreography' };
    if (arg.includes('tiktok.com')) return { title: 'Rooftop chase in one take', summary: 'A TikTok of a one-take rooftop chase.', site: 'TikTok', image: null, tag: '#stunts' };
    return { title: 'Ninja Bunch fan wiki', summary: 'A fan wiki about the Ninja Bunch.', site: 'example.com', image: null, tag: '#research' };
  }
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
    window.__asked.push(body);
    if (body.mode !== 'snapshot') throw new Error('unexpected');
    return window.__remote('snapshot', body.url);
  };
};

const lines = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').index('kind').getAll('line'); q.onsuccess = () => res(q.result.filter((l) => !l.deleted)); };
}));
const shown = (p, re) => p.waitForFunction((src) => new RegExp(src).test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), re.source, { timeout: 8000 });
const paste = (p, text) => p.evaluate((text) => {
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  document.querySelector('#outline-editor .ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, text);
const asked = (p) => p.evaluate(() => window.__asked.filter((a) => a.mode === 'snapshot').map((a) => a.url));
// A new empty line at the end of the page, not under anything.
const newLine = async (p) => {
  await p.evaluate(() => window.__outline.commands.focus('end'));
  await p.keyboard.press('Enter');
  await p.keyboard.press('Shift+Tab');
  await p.keyboard.press('Shift+Tab');
  await sleep(150);
};
const command = async (p, name) => {
  await p.keyboard.press('Control+K');
  await p.keyboard.type(name);
  await sleep(300);
  await p.keyboard.press('Enter');
  await sleep(400);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: 'dark' });
await ctx.exposeFunction('__remote', remote);
await ctx.addInitScript(fake);
const page = await ctx.newPage();
page.errors = [];
page.on('pageerror', (e) => page.errors.push(e.message));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const X = 'https://x.com/kenjidance/status/1852000000000000001';

try {
  await check('the Save to Inkwell bookmark (?save=) lands the page on today, named by its tab, with its summary under it', async () => {
    await page.goto(`${URL}?save=${encodeURIComponent('https://example.com/ninjas')}&title=${encodeURIComponent('The Ninja Bunch fan wiki')}`);
    await page.waitForSelector('#outline-editor .ProseMirror');
    await shown(page, /fan wiki about the Ninja Bunch/);
    assert.ok(!page.url().includes('save='), 'address cleaned up');
    assert.match(await page.locator('#nb-kind').innerText(), /Today/i);
    assert.equal(await page.locator('#outline-editor a[href="https://example.com/ninjas"]').innerText(), 'The Ninja Bunch fan wiki');
    const top = (await lines(page)).find((l) => l.fields?.url === 'https://example.com/ninjas');
    assert.equal(top.fields.capture, 'share');
    assert.ok(top.tags.includes('research'));
  });

  await check('a link from X pasted on an empty line shows the site at once, then its title, summary and tag', async () => {
    await newLine(page);
    await paste(page, `  ${X}  `);
    await page.locator(`#outline-editor a[href="${X}"]`).waitFor();
    assert.equal(await page.locator(`#outline-editor a[href="${X}"]`).innerText(), 'x.com', 'the site, not the long address');
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/d-pasted.png` });
    await shown(page, /This choreography is unreal/);
    await shown(page, /ninja routine/);
    const all = await lines(page);
    const top = all.find((l) => l.fields?.url === X);
    assert.match(top.text, /^Kenji Dance on X: “This choreography is unreal” #choreography$/);
    assert.equal(top.fields.capture, 'share');
    assert.equal(top.fields.claude_tag, 'choreography');
    const kid = all.find((l) => l.parent_id === top.id);
    assert.match(kid.text, /four-person ninja routine/);
    assert.equal(kid.fields.by, 'claude');
    assert.equal(top.parent_id.startsWith('day-'), true, 'on today');
  });

  await check('words typed after a pasted link stay, and the link still gets its title', async () => {
    await newLine(page);
    await paste(page, 'https://www.tiktok.com/@roofrunner/video/7400000000000000000');
    await page.keyboard.type(' for the episode 4 chase');
    await shown(page, /Rooftop chase in one take for the episode 4 chase/);
    const top = (await lines(page)).find((l) => /tiktok/.test(l.fields?.url || ''));
    assert.equal(await page.locator('#outline-editor a[href*="tiktok.com"]').innerText(), 'Rooftop chase in one take', 'your words aren’t part of the link');
    assert.match(top.text, /for the episode 4 chase/);
  });

  await check('a link typed by hand is caught once the caret leaves the line, never half-typed', async () => {
    const before = (await asked(page)).length;
    await newLine(page);
    await page.keyboard.type('https://example.com/ninja-costumes', { delay: 15 });
    await sleep(900);
    assert.equal((await asked(page)).length, before, 'nothing asked while typing');
    assert.equal(await page.locator('#outline-editor a[href="https://example.com/ninja-costumes"]').count(), 0);
    await page.keyboard.press('Enter');
    await page.locator('#outline-editor a[href="https://example.com/ninja-costumes"]').waitFor();
    for (let i = 0; i < 40 && !(await lines(page)).some((l) => l.fields?.url === 'https://example.com/ninja-costumes' && l.fields.snapshot); i++) await sleep(200);
    assert.deepEqual((await asked(page)).slice(before), ['https://example.com/ninja-costumes']);
    // The caret stayed on the new line under it.
    assert.equal(await page.evaluate(() => window.__outline.state.selection.$from.parent.textContent), '');
  });

  await check('a link in the middle of a sentence is left as it is', async () => {
    const before = (await asked(page)).length;
    await page.keyboard.type('Ask Kenji about https://example.com/fight-list before Friday');
    await page.keyboard.press('Enter');
    await paste(page, 'Ask Kenji https://example.com/other');
    await page.keyboard.press('Enter');
    await sleep(800);
    assert.equal((await asked(page)).length, before);
    const l = (await lines(page)).find((x) => /fight-list/.test(x.text));
    assert.ok(!l.fields?.url);
  });

  await check('an old line that is only an address isn’t caught by walking past it', async () => {
    const day = (await lines(page)).find((l) => l.fields?.url === X).parent_id;
    await page.evaluate((day) => new Promise((res) => {
      const r = indexedDB.open('writing');
      r.onsuccess = () => {
        const t = r.result.transaction('entries', 'readwrite');
        t.objectStore('entries').put({ id: 'li_oldlink', kind: 'line', parent_id: day, sort: 1e9, text: 'https://example.com/old', content: [{ type: 'text', text: 'https://example.com/old' }], tags: [], links: [], fields: { done: false }, deleted: false, created_at: 1, updated_at: 1 });
        t.oncomplete = () => res();
      };
    }), day);
    await page.reload();
    await page.waitForSelector('#outline-editor .ProseMirror');
    await shown(page, /example\.com\/old/);
    const before = (await asked(page)).length;
    await page.evaluate(() => window.__outline.commands.focus('end'));
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Control+Home');
    await sleep(600);
    assert.equal((await asked(page)).length, before);
    assert.ok(!(await lines(page)).find((l) => l.id === 'li_oldlink').fields?.url);
  });

  await check('on a page that isn’t a day, a pasted link is caught too', async () => {
    await command(page, 'New page');
    await page.keyboard.type('Ninja Bunch references');
    await page.keyboard.press('Enter');
    await sleep(200);
    await paste(page, 'https://example.com/ninja-history');
    await shown(page, /Ninja Bunch fan wiki/);
    const top = (await lines(page)).find((l) => l.fields?.url === 'https://example.com/ninja-history');
    assert.ok(top && !top.parent_id.startsWith('day-'), 'stays on the page');
  });

  await check('Ctrl + K offers a Save to Inkwell button to drag to the bookmarks bar', async () => {
    await page.keyboard.press('Escape');
    await command(page, 'Save links from your browser');
    const a = page.locator('.save-button a.save-drag');
    await a.waitFor();
    const href = await a.getAttribute('href');
    assert.match(href, /^javascript:/);
    assert.match(href, /\?save='\+encodeURIComponent\(location\.href\)/);
    assert.ok(href.includes(URL), 'opens this Inkwell');
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/d-button.png` });
    // What the bookmark does, run on another page, opens Inkwell with that page's address.
    const opened = await page.evaluate((code) => { let got = null; const w = window.open; window.open = (u, n) => { got = [u, n]; }; new Function(decodeURIComponent(code.slice('javascript:'.length)))(); window.open = w; return got; }, href);
    assert.equal(opened[1], 'inkwell');
    assert.match(opened[0], /\?save=http.*&title=/);
    await page.locator('.save-button button', { hasText: 'Done' }).click();
    await page.locator('.save-button').waitFor({ state: 'detached' });
  });

  await check('no page errors', async () => { assert.deepEqual(page.errors, []); });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('linkcatch: all passed');
