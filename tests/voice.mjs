// Walk-and-talk: a capture is written up in the mode Claude picked, with a
// chip on the line; a tap shows the same words in another mode or word for
// word, keeping edits. Aimed at a chapter, what's said goes into the draft as
// paragraphs with the raw words one flip away and notes to self in the margin.
// A recording file works the same way. Typewriter mode keeps the line still.
// Chrome's fake microphone stands in for a real one, and window.__claude for
// the server.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4193;
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
    async download() { throw new Error('not found'); },
    subscribe() {}, unsubscribe() {}
  };
  // The server: the account's modes, and a write-up for each recording.
  window.__asked = [];
  window.__modes = [
    { id: 'text', name: 'Text message', prompt: 'A text.', model: 'haiku' },
    { id: 'idea', name: 'Idea', prompt: 'An idea.', model: 'opus' },
    { id: 'journal', name: 'Journal', prompt: 'Light cleanup.', model: 'opus' },
    { id: 'scene', name: 'Scene', prompt: 'Prose.', model: 'opus' },
    { id: 'pitch', name: 'Pitch', prompt: 'Made in Scribe.', model: 'sonnet' }
  ];
  window.__claude = async (body) => {
    window.__asked.push(body);
    if (body.mode === 'voice-modes') return { modes: window.__modes };
    if (body.mode === 'voice-save-mode') { const m = { id: body.item.id || 'lyrics', ...body.item }; window.__modes = [...window.__modes.filter((x) => x.id !== m.id), m]; return { mode: m }; }
    if (body.mode === 'voice' && window.__voice) return window.__voice(body);
    const e = new Error('Not now'); throw e;
  };
};

const all = (p, kind) => p.evaluate((k) => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').index('kind').getAll(k); q.onsuccess = () => res(q.result.filter((l) => !l.deleted)); };
}), kind);
const outlineText = (p) => p.locator('#outline-editor .ProseMirror').innerText();

// One second of silence, as a WAV file someone might share from a recorder app.
const dir = mkdtempSync(join(tmpdir(), 'inkwell-voice-'));
const wav = (() => {
  const rate = 8000; const n = rate; const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
})();
const wavPath = join(dir, 'Walk by the river.wav');
writeFileSync(wavPath, wav);

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ permissions: ['microphone', 'clipboard-read', 'clipboard-write'], colorScheme: 'dark', viewport: { width: 1280, height: 860 } });
await ctx.exposeFunction('__remote', remote);
await ctx.addInitScript(fake);
const page = await ctx.newPage();
page.errors = [];
page.on('pageerror', (e) => page.errors.push(e.message));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
async function palette(text) {
  await page.keyboard.press('Control+K');
  await page.waitForSelector('.palette:not([hidden])');
  await page.keyboard.type(text);
  await sleep(150);
  await page.keyboard.press('Enter');
}
async function record(ms) {
  await page.waitForSelector('.capture:not([hidden])');
  if ((await page.getAttribute('.capture', 'data-state')) !== 'recording') await page.click('.cap-big');
  await page.waitForSelector('.capture[data-state="recording"]');
  await sleep(ms);
  await page.click('.cap-big');
  await page.waitForSelector('.capture', { state: 'hidden', timeout: 8000 });
}
const capLine = async () => (await all(page, 'line')).filter((l) => l.fields?.capture === 'voice').sort((a, b) => b.created_at - a.created_at)[0];
const kidsOf = async (id) => (await all(page, 'line')).filter((l) => l.parent_id === id).sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
async function pick(label) {
  await page.click('#outline-editor .voice-chip >> nth=-1');
  await page.waitForSelector('.pop-menu');
  await page.locator('.pop-menu .pop-item', { hasText: new RegExp(`^${label}$`) }).click();
}

const RAW = 'So um today I walked the river and I kept thinking about my dad. Scratch that. I kept thinking about the bridge. Note to self call mum.';

try {
  await page.goto(URL);
  await page.waitForSelector('#editor .ProseMirror');

  await check('a capture lands written up as Journal, with the chip, #journal and the note to self set apart', async () => {
    await page.evaluate((raw) => {
      window.__voice = async (b) => (b.use === 'scene'
        ? { raw, mode: 'scene', blocks: [{ text: 'The river ran slow under the bridge.', el: 'paragraph', new_scene: false }], notes: [] }
        : { raw, mode: 'journal', blocks: [{ text: 'Today I walked the river.', el: 'paragraph', new_scene: false }, { text: 'I kept thinking about the bridge.', el: 'paragraph', new_scene: false }], notes: [{ text: 'Call Mum.', after: 1 }], tag: '' });
    }, RAW);
    await palette('Capture an idea');
    await record(1500);
    await page.waitForFunction(() => /walked the river/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), null, { timeout: 10000 });
    const line = await capLine();
    assert.equal(await page.locator('#outline-editor .voice-chip').last().innerText(), 'Journal');
    assert.match(line.text, /Today I walked the river\. #journal$/, 'journaling isn’t filed as #idea');
    assert.deepEqual(line.tags, ['journal']);
    assert.equal(line.fields.voice.raw, RAW, 'word for word, kept');
    assert.deepEqual((await kidsOf(line.id)).map((k) => k.text), ['I kept thinking about the bridge.', 'Note to self: Call Mum.']);
    const asked = page.evaluate(() => window.__asked.find((a) => a.mode === 'voice'));
    assert.equal((await asked).place, 'day');
  });

  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/desktop-1-journal.png` });

  await check('the chip shows your modes (Scribe’s too), with the one showing ticked', async () => {
    await page.click('#outline-editor .voice-chip >> nth=-1');
    await page.waitForSelector('.pop-menu');
    await page.waitForFunction(() => /Pitch/.test(document.querySelector('.pop-menu')?.innerText || '') || window.__asked.some((a) => a.mode === 'voice-modes'));
    await page.keyboard.press('Escape');
    await page.click('#outline-editor .voice-chip >> nth=-1');
    await page.waitForSelector('.pop-menu .pop-item');
    const items = await page.locator('.pop-menu .pop-item').allInnerTexts();
    assert.deepEqual(items.slice(0, 6), ['Word for word', 'Text message', 'Idea', 'Journal', 'Scene', 'Pitch']);
    assert.equal(await page.locator('.pop-menu .pop-item.current').innerText(), 'Journal');
    assert.ok(items.includes('Copy this version'));
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/desktop-2-chip-menu.png` });
    await page.keyboard.press('Escape');
  });

  await check('Word for word shows exactly what was said, with no trip to the server', async () => {
    const before = await page.evaluate(() => window.__asked.length);
    await pick('Word for word');
    await page.waitForFunction(() => /Scratch that/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''));
    const line = await capLine();
    assert.ok(line.text.includes(RAW), line.text);
    assert.match(line.text, /#said$/);
    assert.deepEqual(await kidsOf(line.id), [], 'the paragraphs and note under it went');
    assert.equal(await page.evaluate((n) => window.__asked.slice(n).filter((a) => a.mode === 'voice').length, before), 0);
  });

  await check('another mode is written up from the same words, then kept', async () => {
    await pick('Scene');
    await page.waitForFunction(() => /river ran slow/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), null, { timeout: 8000 });
    const asked = await page.evaluate(() => window.__asked.filter((a) => a.mode === 'voice').at(-1));
    assert.equal(asked.use, 'scene');
    assert.equal(asked.transcript, RAW, 'the word-for-word text is sent, not the recording again');
    const line = await capLine();
    assert.equal(line.fields.voice.mode, 'scene');
    assert.ok(line.fields.voice.v.scene && line.fields.voice.v.journal && line.fields.voice.v.raw, 'every version made is kept');
  });

  await check('an edit to the version showing is kept when you flip away and back', async () => {
    await pick('Journal');
    await page.waitForFunction(() => /bridge\./.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''));
    const p = page.locator('#outline-editor li', { hasText: 'I kept thinking about the bridge.' }).last().locator('> p');
    await p.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' The old one.');
    await sleep(900);
    const n = await page.evaluate(() => window.__asked.length);
    await pick('Scene');
    await page.waitForFunction(() => /river ran slow/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''));
    await pick('Journal');
    await page.waitForFunction(() => /The old one\./.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''));
    assert.equal(await page.evaluate((k) => window.__asked.slice(k).filter((a) => a.mode === 'voice').length, n), 0, 'nothing re-asked');
    assert.match(await outlineText(page), /Note to self: Call Mum\./);
  });

  await check('Copy this version copies the words showing, ready to paste', async () => {
    await page.click('#outline-editor .voice-chip >> nth=-1');
    await page.locator('.pop-menu .pop-item', { hasText: 'Copy this version' }).click();
    await page.waitForFunction(() => /Copied/.test(document.querySelector('.toast')?.textContent || ''));
    const text = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(text, 'Today I walked the river.\n\nI kept thinking about the bridge. The old one.');
  });

  await check('your modes can be changed from Inkwell, and go to the account Scribe shares', async () => {
    await palette('Your voice modes');
    await page.waitForSelector('.pop-menu');
    await page.locator('.pop-menu .pop-item', { hasText: 'New mode…' }).click();
    await page.waitForSelector('.ask input');
    await page.keyboard.type('Lyrics');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /What Lyrics does/.test(document.querySelector('.ask')?.textContent || ''));
    await page.keyboard.type('Song lyrics, in verses and a chorus.');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__asked.some((a) => a.mode === 'voice-save-mode'));
    const saved = await page.evaluate(() => window.__asked.find((a) => a.mode === 'voice-save-mode').item);
    assert.deepEqual(saved, { name: 'Lyrics', prompt: 'Song lyrics, in verses and a chorus.', model: 'opus' });
    await page.waitForFunction(() => /Scribe has it too/.test(document.querySelector('.toast')?.textContent || ''));
  });

  await check('Alt + V in a chapter talks into the draft: paragraphs per beat, the raw words one flip away', async () => {
    await page.keyboard.press('Control+J');
    await page.waitForFunction(() => document.documentElement.dataset.view !== 'notebook');
    await page.click('#editor .ProseMirror');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('The house was quiet.');
    await page.keyboard.press('Enter');
    await sleep(700);
    await page.evaluate(() => {
      window.__voice = async () => ({
        raw: 'okay so she she opens the door. new paragraph. The hall is dark. note to self is it winter. next scene the kitchen at dawn',
        mode: 'scene',
        blocks: [
          { text: 'She opens the door.', el: 'paragraph', new_scene: false, said: 'okay so she she opens the door.' },
          { text: 'The hall is dark.', el: 'paragraph', new_scene: false, said: 'The hall is dark.' },
          { text: 'The kitchen, at dawn.', el: 'paragraph', new_scene: true, said: 'the kitchen at dawn' }
        ],
        notes: [{ text: 'Is it winter?', after: 1 }]
      });
    });
    await page.keyboard.press('Alt+V');
    await page.waitForSelector('.capture[data-state="recording"]');
    assert.match(await page.locator('.cap-into').innerText(), /^Talking into /);
    await sleep(1500);
    await page.keyboard.press('Alt+V');
    await page.waitForSelector('.capture', { state: 'hidden', timeout: 8000 });
    await page.waitForFunction(() => /She opens the door\./.test(document.querySelector('#editor .ProseMirror')?.innerText || ''), null, { timeout: 10000 });
    assert.notEqual(await page.evaluate(() => document.documentElement.dataset.view), 'notebook', 'you stay in the draft');
    await page.waitForFunction(() => window.__editor.state.selection.$from.parent.textContent === 'The kitchen, at dawn.');
    assert.equal(await page.evaluate(() => { const { $from } = window.__editor.state.selection; return $from.parentOffset === $from.parent.content.size; }), true, 'the caret is at the end of what you said, to carry on');
    const asked = await page.evaluate(() => window.__asked.filter((a) => a.mode === 'voice').at(-1));
    assert.equal(asked.place, 'draft');
    assert.match(asked.before, /The house was quiet\.$/, `Claude sees the text just before: ${JSON.stringify(asked.before.slice(-60))}`);
    const text = await page.locator('#editor .ProseMirror').innerText();
    assert.match(text, /The house was quiet\.\s+She opens the door\.\s+The hall is dark\./, 'in order, where the caret was, filling the empty line');
    const paras = (await all(page, 'para')).sort((a, b) => a.sort - b.sort);
    const door = paras.find((p) => p.text === 'She opens the door.');
    assert.deepEqual(door.fields.versions, [[{ type: 'text', text: 'She opens the door.' }], [{ type: 'text', text: 'okay so she she opens the door.' }]], 'what was really said is its other version');
    assert.equal(door.fields.by, 'claude', 'Claude’s words until you change them');
    assert.ok(!paras.some((p) => !p.text && p.sort > paras.find((q) => q.text === 'The house was quiet.').sort && p.sort < door.sort), 'no empty line left above');
    const hall = paras.find((p) => p.text === 'The hall is dark.');
    assert.equal(hall.fields.versions, undefined, 'said as written: nothing to flip to');
    assert.ok((await all(page, 'scene')).length >= 1, 'next scene made a scene break');
    const notes = await all(page, 'note');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].text, 'Is it winter?');
    assert.equal(notes[0].parent_id, hall.id, 'the note sits beside the paragraph it was said with');
    const day = await capLine();
    assert.match(day.text, /into .+ #draft$/, 'today’s page keeps the recording and says where it went');
    assert.ok(day.links.length === 1, 'linked to the chapter');
    assert.match(day.fields.voice.raw, /^okay so she/);
  });

  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/desktop-3-draft.png` });

  await check('the raw words are one flip away (Alt + Down)', async () => {
    await page.locator('#editor .ProseMirror p', { hasText: 'She opens the door.' }).click();
    await page.waitForFunction(() => window.__editor.state.selection.$from.parent.textContent === 'She opens the door.');
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForFunction(() => /okay so she she opens/.test(document.querySelector('#editor .ProseMirror')?.innerText || ''));
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForFunction(() => /She opens the door\./.test(document.querySelector('#editor .ProseMirror')?.innerText || ''));
  });

  await check('a recording file can be drafted from too', async () => {
    await page.evaluate(() => {
      window.__voice = async () => ({ raw: 'the river again', mode: 'scene', blocks: [{ text: 'The river again.', el: 'paragraph', new_scene: false, said: 'the river again' }], notes: [] });
    });
    const chooser = page.waitForEvent('filechooser');
    await palette('Draft from a recording file');
    await (await chooser).setFiles(wavPath);
    await page.waitForFunction(() => /The river again\./.test(document.querySelector('#editor .ProseMirror')?.innerText || ''), null, { timeout: 10000 });
    const files = await all(page, 'file');
    const f = files.find((x) => x.title === 'Walk by the river.wav');
    assert.ok(f, 'the file is kept under its own name');
    assert.ok(Math.abs((f.fields.duration || 0) - 1000) < 200, `its length is read (${f.fields.duration})`);
    const asked = await page.evaluate(() => window.__asked.filter((a) => a.mode === 'voice').at(-1));
    assert.equal(asked.place, 'draft');
  });

  await check('Typewriter mode keeps the line you’re on near the middle', async () => {
    await palette('Typewriter mode');
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('typewriter')));
    await page.click('#editor .ProseMirror');
    await page.keyboard.press('Control+End');
    for (let i = 0; i < 30; i++) { await page.keyboard.press('Enter'); await page.keyboard.type(`Line ${i}`); }
    await sleep(900);
    const y = await page.evaluate(() => { const s = getSelection(); const r = s.getRangeAt(0).getBoundingClientRect(); return r.top; });
    assert.ok(Math.abs(y - 860 * 0.45) < 80, `caret at ${y}`);
    assert.equal(await page.evaluate(() => localStorage.getItem('typewriter')), '1', 'remembered on this device');
    await palette('Typewriter mode');
    assert.ok(!(await page.evaluate(() => document.documentElement.classList.contains('typewriter'))));
  });

  await check('on a phone, the chip and its menu fit, and Talk sits on the writing bar', async () => {
    const phone = await browser.newContext({ permissions: ['microphone'], colorScheme: 'dark', viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
    await phone.exposeFunction('__remote', remote);
    await phone.addInitScript(fake);
    const p = await phone.newPage();
    p.on('pageerror', (e) => page.errors.push(e.message));
    await p.goto(URL);
    await p.waitForSelector('#editor .ProseMirror');
    await p.tap('#editor .ProseMirror');
    await sleep(500);
    assert.ok(await p.locator('.script-bar [data-talk]').isVisible(), 'Talk on the bar above the keyboard');
    if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/phone-1-talk-bar.png` });
    await p.goto(`${URL}?capture=voice`);
    await p.waitForSelector('.capture:not([hidden])');
    await p.evaluate(() => { window.__voice = async () => ({ raw: 'x', mode: 'journal', blocks: [{ text: 'A long walk and a longer think about the bridge and the river.', el: 'paragraph', new_scene: false }], notes: [{ text: 'Call Mum.', after: 0 }] }); });
    await p.tap('.cap-big');
    await p.waitForSelector('.capture[data-state="recording"]');
    await sleep(1300);
    await p.tap('.cap-big');
    await p.waitForFunction(() => /longer think/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), null, { timeout: 10000 });
    await p.tap('#outline-editor .voice-chip >> nth=-1');
    await p.waitForSelector('.pop-menu');
    const box = await p.locator('.pop-menu').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 412, 'the menu fits the screen');
    if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/phone-2-chip-menu.png` });
    await phone.close();
  });

  await check('no page errors', async () => { assert.deepEqual(page.errors, []); });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('voice: all passed');
