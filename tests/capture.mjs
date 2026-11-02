// Voice capture: the home-screen shortcut opens Capture, a recording is kept
// piece by piece, lands on today's page as #idea with a play button, and is
// written out (with Claude's outline under it) once there's a connection. A
// recording cut short is brought back. Chrome's fake microphone stands in for
// a real one, and window.__claude for the server.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4187;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const table = new Map();
const bucket = new Map();
let clock = Date.parse('2026-10-20T00:00:00Z');
function remote(op, arg) {
  if (op === 'push') {
    const stamp = new Date((clock += 1000)).toISOString();
    return arg.map((r) => { table.set(r.id, { ...r, user_id: 'u1', updated_at: stamp }); return { id: r.id, updated_at: stamp }; });
  }
  if (op === 'pull') return [...table.values()].filter((r) => r.updated_at > arg.since).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)).slice(arg.from, arg.from + 500);
  if (op === 'upload') { bucket.set(arg.path, arg); return true; }
  if (op === 'download') return bucket.get(arg) || null;
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
  // Keeps hold of the microphone, so a test can take it away like a phone call would.
  const gum = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  if (gum) navigator.mediaDevices.getUserMedia = async (c) => (window.__mic = await gum(c));
  // Stands in for the phone handing launches to the window (first the one
  // that opened it, as Chrome does, then any later ones).
  Object.defineProperty(window, 'launchQueue', { configurable: true, value: { setConsumer(fn) { window.__launch = fn; fn({ targetURL: location.href }); } } });
  // The server: no speech service until a test says there is one.
  window.__asked = [];
  window.__claude = async (body) => {
    window.__asked.push(body);
    if (!window.__transcriber) { const e = new Error('Writing out recordings isn’t set up yet.'); e.code = 'no-transcriber'; throw e; }
    return window.__transcriber(body);
  };
};

const lines = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').index('kind').getAll('line'); q.onsuccess = () => res(q.result.filter((l) => !l.deleted)); };
}));
const pieceCount = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('inkwell-capture');
  r.onsuccess = () => { const q = r.result.transaction('pieces').objectStore('pieces').count(); q.onsuccess = () => res(q.result); };
}));
const outlineText = (p) => p.locator('#outline-editor .ProseMirror').innerText();

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ permissions: ['microphone'], colorScheme: 'dark' });
await ctx.exposeFunction('__remote', remote);
await ctx.addInitScript(fake);
const page = await ctx.newPage();
page.errors = [];
page.on('pageerror', (e) => page.errors.push(e.message));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

async function record(ms) {
  await page.waitForSelector('.capture:not([hidden])');
  if ((await page.getAttribute('.capture', 'data-state')) !== 'recording') await page.click('.cap-big');
  await page.waitForSelector('.capture[data-state="recording"]');
  await sleep(ms);
  await page.click('.cap-big');
  await page.waitForSelector('.capture', { state: 'hidden', timeout: 8000 });
}

try {
  await check('the home-screen shortcut opens Capture, and the address is cleaned up', async () => {
    await page.goto(`${URL}?capture=voice`);
    await page.waitForSelector('.capture:not([hidden])', { timeout: 8000 });
    assert.equal(await page.getAttribute('.capture', 'data-state'), 'ready');
    assert.ok(!page.url().includes('capture'), page.url());
  });

  await check('talking is kept piece by piece while it records', async () => {
    await page.click('.cap-big');
    await page.waitForSelector('.capture[data-state="recording"]');
    await sleep(4600);
    assert.match(await page.locator('.cap-time').innerText(), /^0:0[4-6]$/);
    assert.ok(await pieceCount(page) >= 1, 'a piece is on the device');
  });

  await check('Done puts it on today’s page as #idea, with a play button and its length', async () => {
    await page.click('.cap-big');
    await page.waitForSelector('.capture', { state: 'hidden', timeout: 8000 });
    await page.waitForSelector('#outline-editor .file-embed.audio', { timeout: 5000 });
    assert.match(await page.locator('#nb-kind').innerText(), /Today/i);
    assert.match(await page.locator('#outline-editor .file-embed.audio small').first().innerText(), /^0:0[4-6]$/);
    const [line] = (await lines(page)).filter((l) => l.fields?.capture === 'voice');
    assert.ok(line, 'a capture line');
    assert.deepEqual(line.tags, ['idea']);
    assert.equal(line.content[0].type, 'file');
    assert.match(line.content[1].text, /^ \d{1,2}:\d\d [ap]m #idea$/, 'the time it was said comes just after the recording');
    assert.equal(await pieceCount(page), 0, 'pieces cleared once kept');
  });

  await check('with no speech service yet, it says it’s waiting and keeps the recording', async () => {
    await page.waitForFunction(() => /set up/.test(document.querySelector('#outline-editor .file-embed.audio .note')?.textContent || ''), null, { timeout: 8000 });
    const q = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const g = r.result.transaction('meta').objectStore('meta').get('captureQueue'); g.onsuccess = () => res(g.result?.value || []); }; }));
    assert.equal(q.length, 1);
  });

  await check('once it’s set up, it’s written up in the mode Claude picked, with a chip, Claude’s tag and links', async () => {
    await page.evaluate(() => {
      window.__transcriber = async () => ({
        raw: 'Um so ninjas who are terrible at hiding, filmed like a nature documentary. Note to self, look up Attenborough.',
        mode: 'idea',
        blocks: [{ text: 'Ninjas who are terrible at hiding, filmed like a nature documentary.', el: 'paragraph', new_scene: false }, { text: 'Premise: ninjas who can’t hide', el: 'paragraph', new_scene: false }, { text: 'Images: nature-documentary framing', el: 'paragraph', new_scene: false }],
        notes: [{ text: 'Look up Attenborough.', after: 0 }],
        tag: 'Ninja Bunch',
        refs: [{ label: 'Planet Earth (2006)', url: 'https://www.imdb.com/title/tt0795176/' }, { label: 'no link', url: 'javascript:alert(1)' }]
      });
      window.dispatchEvent(new Event('online'));
    });
    await page.waitForFunction(() => /terrible at hiding/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), null, { timeout: 8000 });
    const text = await outlineText(page);
    assert.match(text, /\d{1,2}:\d\d [ap]m\s*Idea\s*Ninjas who are terrible at hiding, filmed like a nature documentary\. #idea #ninja-bunch/, 'the time stays after the recording, then the mode chip, then the words');
    assert.equal(await page.locator('#outline-editor .voice-chip').first().innerText(), 'Idea');
    // The summary line shows; the rest of the write-up is folded under it.
    await page.waitForFunction(() => document.querySelector('#outline-editor li.folded')?.innerText.includes('terrible at hiding'));
    assert.doesNotMatch(await outlineText(page), /Premise: ninjas who can’t hide/);
    await page.locator('#outline-editor li.folded .fold').first().click();
    await page.waitForFunction(() => /Premise: ninjas who can’t hide/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''));
    const all = await lines(page);
    const cap = all.find((l) => l.fields?.capture === 'voice');
    assert.deepEqual(cap.tags, ['idea', 'ninja-bunch']);
    assert.equal(cap.fields.claude_tag, 'ninja-bunch', 'the line knows the tag was Claude’s');
    assert.match(cap.fields.voice.raw, /^Um so ninjas/, 'the word-for-word text is kept');
    const kids = all.filter((l) => l.parent_id === cap.id).sort((a, b) => a.sort - b.sort);
    assert.deepEqual(kids.map((k) => k.text), ['Note to self: Look up Attenborough.', 'Premise: ninjas who can’t hide', 'Images: nature-documentary framing', 'Planet Earth (2006)'], 'the note to self is set apart, the link is last and only the safe one');
    assert.ok(kids.every((k) => k.fields.by === 'claude'), 'Claude’s lines say so');
    assert.equal(kids[3].content[0].marks[0].attrs.href, 'https://www.imdb.com/title/tt0795176/');
    const asked = await page.evaluate(() => window.__asked.at(-1));
    assert.ok(Array.isArray(asked.tags), 'your tags are sent so Claude can reuse one');
    assert.equal(cap.content[0].type, 'file', 'the recording stays on the line');
    assert.equal(await page.locator('#outline-editor .file-embed.audio .note').first().innerText(), '');
    assert.equal(asked.mode, 'voice');
    assert.equal(asked.place, 'day');
    assert.ok(bucket.has(`u1/${asked.file}`), 'the recording went up before asking');
  });

  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/desktop-9-capture-time.png` });

  await check('if you already wrote on the line, the words go under it and yours stay', async () => {
    await page.evaluate(() => { window.__transcriber = null; });
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Capture an idea');
    await page.keyboard.press('Enter');
    await record(1500);
    await page.waitForSelector('#outline-editor .file-embed.audio >> nth=1');
    await sleep(300);
    await page.keyboard.press('End');
    await page.keyboard.type(' bunny version');
    await sleep(900);
    await page.evaluate(() => {
      window.__transcriber = async () => ({ raw: 'What if the ninjas were rabbits.', mode: 'idea', blocks: [{ text: 'What if the ninjas were rabbits.', el: 'paragraph', new_scene: false }], notes: [] });
      window.dispatchEvent(new Event('online'));
    });
    await page.waitForFunction(() => /ninjas were rabbits/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), null, { timeout: 8000 });
    const all = await lines(page);
    const mine = all.find((l) => /bunny version/.test(l.text));
    assert.ok(mine, 'your words kept');
    assert.match(mine.text, /bunny version$/, 'your line isn’t touched');
    const under = all.find((l) => l.parent_id === mine.id);
    assert.equal(under?.text.trim(), 'What if the ninjas were rabbits.');
    assert.equal(under.content[0].type, 'voice', 'the chip goes on the line under it');
  });

  await check('Cancel throws a recording away and leaves the page as it was', async () => {
    const before = (await lines(page)).length;
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Capture an idea');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.capture:not([hidden])');
    await page.click('.cap-big');
    await page.waitForSelector('.capture[data-state="recording"]');
    await sleep(1200);
    await page.click('.cap-cancel');
    await page.waitForSelector('.capture', { state: 'hidden' });
    await sleep(500);
    assert.equal((await lines(page)).length, before);
    assert.equal(await pieceCount(page), 0);
  });

  await check('a recording cut short by the app closing is brought back on reopening, even a two-second one', async () => {
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Capture an idea');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.capture:not([hidden])');
    await page.click('.cap-big');
    await page.waitForSelector('.capture[data-state="recording"]');
    await sleep(1800);
    const before = (await lines(page)).filter((l) => l.fields?.capture === 'voice').length;
    await page.reload();
    await page.waitForSelector('#outline-editor .ProseMirror');
    await page.waitForFunction((n) => document.querySelectorAll('#outline-editor .file-embed.audio').length > n, before, { timeout: 8000 });
    assert.equal((await lines(page)).filter((l) => l.fields?.capture === 'voice').length, before + 1);
    assert.match(await page.locator('.toast').innerText(), /cut short/);
    assert.equal(await pieceCount(page), 0);
  });

  await check('if the phone takes the microphone away, what was said is kept and Capture doesn’t hang', async () => {
    const before = (await lines(page)).filter((l) => l.fields?.capture === 'voice').length;
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Capture an idea');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.capture:not([hidden])');
    await page.click('.cap-big');
    await page.waitForSelector('.capture[data-state="recording"]');
    await sleep(1800);
    await page.evaluate(() => window.__mic.getTracks().forEach((t) => t.stop()));
    await page.waitForSelector('.capture', { state: 'hidden', timeout: 8000 });
    await page.waitForFunction(() => /stopped the microphone/.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 5000 }).catch(async (e) => { throw new Error(`toast: ${await page.locator('.toast').innerText()}`); });
    assert.equal((await lines(page)).filter((l) => l.fields?.capture === 'voice').length, before + 1);
    assert.equal(await pieceCount(page), 0);
  });

  await check('with the screen off, the recording pauses, says so when you’re back, and leaves that stretch out', async () => {
    const before = (await lines(page)).filter((l) => l.fields?.capture === 'voice').length;
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Capture an idea');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.capture:not([hidden])');
    await page.click('.cap-big');
    await page.waitForSelector('.capture[data-state="recording"]');
    await page.evaluate(() => { const mm = window.matchMedia; window.matchMedia = (q) => q === '(hover: none)' ? { matches: true } : mm(q); window.__mm = mm; });
    await sleep(2000);
    const screen = (off) => page.evaluate((off) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => off }); document.dispatchEvent(new Event('visibilitychange')); }, off);
    await screen(true);
    await sleep(5000);
    await screen(false);
    assert.match(await page.locator('.cap-hint').innerText(), /screen was off for [56] seconds.*Listening again/);
    await sleep(1500);
    assert.match(await page.locator('.cap-time').innerText(), /^0:0[3-4]$/, 'the clock leaves out the screen-off time');
    await page.click('.cap-big');
    await page.waitForSelector('.capture', { state: 'hidden', timeout: 8000 });
    await page.waitForFunction(() => /screen was off for/.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 5000 });
    const voice = (await lines(page)).filter((l) => l.fields?.capture === 'voice').sort((a, b) => a.created_at < b.created_at ? -1 : 1);
    assert.equal(voice.length, before + 1);
    const ms = voice.at(-1).content[0].attrs.duration;
    assert.ok(ms > 2500 && ms < 5000, `kept length ${ms}`);
    await page.evaluate(() => { delete document.hidden; window.matchMedia = window.__mm; });
  });

  await check('“Start recording as soon as Capture opens” starts it with no tap', async () => {
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Capture an idea');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.capture:not([hidden])');
    await page.check('.cap-auto input');
    await page.click('.cap-cancel');
    await page.goto(`${URL}?capture=voice`);
    await page.waitForSelector('.capture[data-state="recording"]', { timeout: 8000 });
    await page.click('.cap-cancel');
    await page.waitForSelector('.capture', { state: 'hidden' });
  });

  await check('Alt + C starts Capture recording, and Alt + C again keeps it', async () => {
    await page.evaluate(() => localStorage.setItem('captureAutostart', 'off'));
    await page.reload();
    await page.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
    await sleep(500);
    const before = (await lines(page)).filter((l) => l.fields?.capture === 'voice').length;
    await page.keyboard.press('Alt+C');
    await page.waitForSelector('.capture[data-state="recording"]', { timeout: 8000 });
    await sleep(1500);
    await page.keyboard.press('Alt+C');
    await page.waitForSelector('.capture', { state: 'hidden', timeout: 8000 });
    await sleep(500);
    assert.equal((await lines(page)).filter((l) => l.fields?.capture === 'voice').length, before + 1);
  });

  await check('the play button plays the recording', async () => {
    await page.locator('#outline-editor .file-embed.audio .play').first().click();
    await page.waitForSelector('#outline-editor .file-embed.audio.playing', { timeout: 5000 });
    await page.locator('#outline-editor .file-embed.audio .play').first().click();
    await page.waitForSelector('#outline-editor .file-embed.audio.playing', { state: 'detached', timeout: 5000 });
  });

  await check('once played, a bar opens to scrub through the recording', async () => {
    const chip = page.locator('#outline-editor .file-embed.audio').first();
    assert.ok(await chip.locator('.scrub').isVisible(), 'the bar is open after playing');
    assert.match(await chip.locator('small').first().innerText(), /^\d:\d\d \/ 0:0[4-6]$/);
    const box = await chip.locator('.scrub').boundingBox();
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
    await page.waitForFunction(() => /^0:0[2-4] \//.test(document.querySelector('#outline-editor .file-embed.audio small')?.textContent || ''), null, { timeout: 5000 });
    await chip.locator('.play').click();
    await page.waitForSelector('#outline-editor .file-embed.audio.playing', { timeout: 5000 });
    await sleep(400);
    await chip.locator('.play').click();
    const at = await page.evaluate(() => Number(document.querySelector('#outline-editor .file-embed.audio .scrub').value));
    assert.ok(at >= 2, `plays on from where you scrubbed to (at ${at}s)`);
    assert.ok(await page.evaluate(() => !document.querySelector('#outline-editor .ProseMirror-selectednode')), 'the editor didn’t grab the click');
  });

  await check('the Capture shortcut works while Inkwell is already open', async () => {
    await page.evaluate((u) => window.__launch({ targetURL: `${u}?capture=voice` }), URL);
    await page.waitForSelector('.capture:not([hidden])', { timeout: 5000 });
    await page.click('.cap-cancel');
    await page.waitForSelector('.capture', { state: 'hidden' });
    await page.evaluate((u) => window.__launch({ targetURL: u }), URL);
    await sleep(400);
    assert.ok(await page.locator('.capture').isHidden(), 'a plain launch doesn’t open Capture');
  });

  await check('the manifest offers Capture on a long-press of the icon', async () => {
    const m = await (await fetch(`${URL}manifest.webmanifest`)).json();
    assert.equal(m.shortcuts[0].url, './?capture=voice');
    assert.equal(m.launch_handler?.client_mode, 'navigate-existing', 'the open window is sent to the shortcut');
  });

  await check('no page errors', async () => { assert.deepEqual(page.errors, []); });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('capture: all passed');
