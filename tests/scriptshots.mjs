// The script with its shots beside it (Nov 22 2026). Part 1: a Shots switch
// on a script (Alt + B) shows the shots beside the text on a computer with
// room, in the script in one column, a thin strip of pictures beside a phone
// held upright and two columns on a phone held sideways. A click picks a
// shot and a second opens it floating over the page; neither ever scrolls
// the page. Scenes go by their own names, never by slug lines. Shots added
// here are ordinary shots, so Make sees them.
// Part 2: each shot sits on the lines it covers, with tramlines, dotted marks
// beside lines without a shot, and a bar over picked lines to add a shot for
// them or move one there.
//
// SHOTS_DIR=folder also saves dark-mode screenshots for the guide.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';
import { screenKind, sceneTitle, sceneName } from '../src/scenename.js';
import { snap as snapLines, resolve, bareLines, lanes, placeAmong, linesIn } from '../src/shotlines.js';

const require = createRequire(import.meta.url);
let chromium, devices;
try { ({ chromium, devices } = require('playwright')); } catch { ({ chromium, devices } = require(`${process.execPath.replace(/bin\/node$/, '')}lib/node_modules/playwright`)); }

let failed = 0;
const errors = [];
let p;
const SHOTS = process.env.SHOTS_DIR || '';
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) {
    failed += 1;
    const at = (e.stack || '').split('\n').find((l) => l.includes('scriptshots.mjs')) || '';
    console.log(`FAIL ${name}\n     ${e.message}\n     ${at.trim()}`);
  }
}
const checkNow = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); } };
const snap = async (name) => { if (SHOTS) { await sleep(300); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };

// ---------- without a browser ----------

checkNow('the kind of screen: a computer, a phone upright, a phone sideways', () => {
  assert.equal(screenKind(1280, 800, false), 'computer');
  assert.equal(screenKind(412, 900, true), 'phone');
  assert.equal(screenKind(900, 412, true), 'sideways');
  assert.equal(screenKind(900, 412, false), 'computer', 'a short computer window is still a computer');
  assert.equal(screenKind(600, 900, false), 'phone', 'a narrow window gets the one-column layout');
});
checkNow('a scene goes by its own name, or its first words, never its slug line', () => {
  assert.equal(sceneTitle({ title: 'The turn-off', slug: 'EXT. SALT FLATS ROAD - DAWN' }), 'The turn-off');
  assert.equal(sceneTitle({ title: '', first: 'A white pickup sits dead on the shoulder, hood up.', slug: 'EXT. ROAD' }), 'A white pickup sits dead on…');
  assert.equal(sceneName({ n: '3', title: 'The diner' }), 'Scene 3 · The diner');
  assert.equal(sceneName({ n: '4', title: '', first: '' }), 'Scene 4');
});

checkNow('a name and what is said under it are one line, and a shot is never lost', () => {
  const paras = [['action', 'A'], ['character', 'JUNE'], ['dialogue', 'Hi.'], ['character', 'MARA'], ['paren', '(low)'], ['dialogue', 'Hey.'], ['action', ''], ['action', 'B']].map(([el, text], i) => ({ id: `p${i}`, el, text }));
  assert.deepEqual(snapLines(paras, 2, 2), { from: 1, to: 2 }, 'a pick on dialogue reaches back to the name');
  assert.deepEqual(snapLines(paras, 0, 3), { from: 0, to: 5 }, 'one that ends on a name reaches through the speech');
  assert.equal(linesIn(paras, 0, 7), 4, 'A, June, Mara and B (the empty line is no line)');
  assert.equal(resolve({ fields: {} }, paras), null, 'on no lines');
  assert.equal(resolve({ fields: { from: 'gone', to: 'gone2' } }, paras), null, 'its lines were deleted: back at its scene');
  assert.deepEqual(resolve({ fields: { from: 'gone', to: 'p2' } }, paras), { from: 1, to: 2 }, 'one end left: it keeps that');
  const shots = [{ id: 'a', sort: 1024, fields: { n: '01', from: 'p0', to: 'p0' } }, { id: 'b', sort: 2048, fields: { n: '02', from: 'p0', to: 'p2' } }, { id: 'c', sort: 3072, fields: { n: '03', from: 'p7', to: 'p7' } }];
  assert.deepEqual(bareLines(shots, paras), [3], 'only Mara’s line has no shot');
  assert.deepEqual([...lanes(shots, paras)], [['a', 0], ['b', 1], ['c', 0]], 'two shots on the same line sit side by side');
  const at = placeAmong(shots, paras, 3);
  assert.equal(at.index, 2, 'between 02 and 03');
  assert.ok(at.sort > 2048 && at.sort < 3072);
});

// ---------- in the app ----------

const PORT = 4312;
const server = await serve(PORT);
const browser = withoutSync(await chromium.launch());

async function open(ctxOpts) {
  const ctx = await browser.newContext({ colorScheme: 'dark', ...ctxOpts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#editor .ProseMirror', { state: 'attached' });
  await sleep(500);
  return page;
}
const run = async (label) => {
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.keyboard.press('Control+K');
  await p.waitForFunction(() => document.activeElement?.id === 'palette-input');
  await p.locator('#palette-input').fill(label);
  const item = p.locator('#palette-list li', { hasText: label }).first();
  await item.waitFor();
  await item.click();
};
async function newPiece(kind, title, chapter) {
  await run(kind);
  await p.waitForSelector('#lib-new', { state: 'visible' });
  await p.fill('#lib-new-title', title);
  await p.keyboard.press('Enter');
  await sleep(900);
  await p.keyboard.press('Control+O');
  await p.waitForFunction(() => document.activeElement?.id === 'palette-input');
  await p.locator('#palette-input').fill(`${chapter} · ${title}`);
  await p.waitForFunction((t) => document.querySelector('.palette[data-loaded]') && new RegExp(`^${t}`).test(document.querySelector('#palette-list li.box-row')?.textContent || ''), chapter);
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelectorAll('#editor .ProseMirror > *').length > 0);
  await sleep(400);
}

// Salt Road, the mock-up's sample film: three named scenes, written straight
// into the editor, then shots under them as Make would keep them.
const SCENES = [
  ['The turn-off', 'EXT. SALT FLATS ROAD - DAWN', [
    ['action', 'A white pickup sits dead on the shoulder, hood up. Nothing else for miles but salt and sky.'],
    ['action', 'MARA, thirties, leans into the engine. JUNE, nine, watches from the tailgate, legs swinging.'],
    ['character', 'June'], ['dialogue', 'Is it broken broken, or just broken?'],
    ['character', 'Mara'], ['dialogue', 'Just broken.'],
    ['action', 'Mara pulls the dipstick. Bone dry. She wipes it on her jeans anyway.'],
    ['character', 'June'], ['dialogue', 'Dad would’ve checked the oil.'],
    ['action', 'Mara doesn’t look up.'],
    ['character', 'Mara'], ['dialogue', 'Dad would’ve taken the highway.']]],
  ['The walk', 'EXT. SALT FLATS - LATER', [
    ['action', 'They walk. The truck is a white dot behind them. June drags a stick, cutting a line in the crust.'],
    ['character', 'June'], ['dialogue', 'How far is it?'],
    ['character', 'Mara'], ['dialogue', 'See that shimmer? Past that.'],
    ['character', 'June'], ['dialogue', 'That’s not a real thing. That’s just heat.'],
    ['action', 'Mara stops. She looks at the line June has drawn, all the way back to the truck.'],
    ['character', 'Mara'], ['dialogue', 'Then we’ll know the way back.']]],
  ['The diner', 'INT. ROADSIDE DINER - DAY', [
    ['action', 'A bell on the door. One WAITRESS, one trucker, one fan turning.'],
    ['action', 'June climbs onto a stool and lays the stick on the counter like a trophy.'],
    ['character', 'Waitress'], ['dialogue', 'Long walk?'],
    ['character', 'June'], ['dialogue', 'Eleven thousand steps. I counted.'],
    ['action', 'Mara sets her phone on the counter. No signal. The waitress slides the cordless over without being asked.'],
    ['character', 'Mara'], ['paren', '(dialing)'], ['dialogue', 'Thanks.']]]
];
// Each shot on the lines it covers (indexes in its scene): Scene 1 leaves
// one line bare, Scene 2 has two shots on the same line and two lines bare,
// Scene 3's one shot is on no lines yet.
const SHOT_LIST = [
  [['The truck alone on the flats, hood up.', 'Extreme wide, locked off', '#c9774f', 0, 0], ['Mara in the engine, June on the tailgate behind her.', 'Two-shot, medium wide', '#7a8f6b', 1, 5], ['The dipstick comes out dry.', 'Insert', '#8a6fa8', 6, 6], ['June says it to her sister’s back.', 'Close-up, June', null, 7, 8], ['Mara, eyes down. She answers without looking up.', 'Close-up, Mara', null, 10, 11]],
  [['Two figures, the truck a dot, the line trailing behind them.', 'High wide', '#5d7f9e', 0, 0], ['The stick cuts the crust. The camera tracks with it.', 'Low tracking insert', null, 0, 0], ['The sisters walk toward us, talking.', 'Walking two-shot, handheld', null, 1, 6]],
  [['The diner, alone in the heat.', 'Wide, outside', '#b0894f', null, null]]
];
async function saltRoad() {
  await p.evaluate((scenes) => {
    const ed = window.__editor;
    const { schema } = ed.state;
    const nodes = [];
    for (const [title, slug, paras] of scenes) {
      nodes.push(schema.nodes.sceneBreak.create({ level: 3, title }));
      nodes.push(schema.nodes.paragraph.create({ el: 'scene' }, schema.text(slug)));
      for (const [el, text] of paras) nodes.push(schema.nodes.paragraph.create({ el }, schema.text(text)));
    }
    ed.view.dispatch(ed.state.tr.replaceWith(0, ed.state.doc.content.size, nodes));
  }, SCENES);
  await p.waitForFunction(() => document.querySelectorAll('.wv-line[data-eid]').length >= 3);
  await sleep(700); // saved, so the headings are entries shots can hang under
  await p.waitForFunction(() => window.__scriptShots.anchors().every((a) => a.paras.length > 5));
  E = await p.evaluate(() => window.__scriptShots.anchors().map((a) => a.eid));
}
let E = [];
// Shots under each scene, on their lines, a few with a picture (a plain coloured frame).
async function addShots() {
  await p.evaluate(async (list) => {
    const ss = window.__scriptShots;
    const anchors = ss.anchors();
    for (let i = 0; i < list.length; i++) {
      for (const [what, framing, colour, from, to] of list[i]) {
        const sh = await ss.add(anchors[i].eid, { what, framing, focus: false, from, to });
        if (!colour) continue;
        const c = document.createElement('canvas');
        c.width = 320; c.height = 180;
        const g = c.getContext('2d');
        g.fillStyle = colour; g.fillRect(0, 0, 320, 180);
        g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, 120); g.lineTo(320, 110); g.stroke();
        g.beginPath(); g.arc(200, 90, 26, 0, 7); g.stroke();
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        await ss.addPicture(sh.id, new File([blob], 'frame.png', { type: 'image/png' }));
      }
    }
    ss.close();
    ss.pick(null);
  }, SHOT_LIST);
  await sleep(400);
}
// A scene's shots, beside the text or in it.
const card = (scene, i, where = '.ss-side') => `${where} .ss-card[data-eid="${E[scene]}"] >> nth=${i}`;
const thumb = (scene, i) => `.ss-side .ss-thumb[data-eid="${E[scene]}"] >> nth=${i}`;
const count = (scene) => p.locator(`.ss-head[data-eid="${E[scene]}"] .ss-count`).first().textContent();
// A line of the script by its words.
const line = (words) => p.locator('#editor p', { hasText: words }).first();
const top = (loc) => loc.evaluate((e) => Math.round(e.getBoundingClientRect().top));
const scrollY = () => p.evaluate(() => Math.round(window.scrollY));
async function noMove(act, label) {
  const before = await scrollY();
  const text = await p.locator('.wv-line >> nth=1').evaluate((e) => Math.round(e.getBoundingClientRect().top));
  await act();
  await sleep(500);
  assert.equal(await scrollY(), before, `${label}: the page scrolled`);
  assert.equal(await p.locator('.wv-line >> nth=1').evaluate((e) => Math.round(e.getBoundingClientRect().top)), text, `${label}: the script moved`);
}
async function tap(sel, opts = {}) {
  const loc = typeof sel === 'string' ? p.locator(sel) : sel;
  let b = await loc.boundingBox();
  const vh = p.viewportSize().height;
  if (b.y < 0 || b.y + Math.min(b.height, 30) > vh) {
    await loc.evaluate((e) => window.scrollBy(0, e.getBoundingClientRect().top - window.innerHeight / 3));
    await sleep(250);
    b = await loc.boundingBox();
  }
  const x = b.x + (opts.x ?? b.width / 2);
  const y = b.y + Math.min(b.height / 2, 20);
  if (p.__touch) await p.touchscreen.tap(x, y);
  else {
    if (opts.shift) await p.keyboard.down('Shift');
    await p.mouse.click(x, y);
    if (opts.shift) await p.keyboard.up('Shift');
  }
}
const sel = () => p.evaluate(() => window.__scriptShots.sel);

try {
  p = await open({ viewport: { width: 1400, height: 860 } });

  await check('desktop: Shots shows only on a script, off at first, and the script is only text', async () => {
    await newPiece('New screenplay', 'Salt Road', 'Script');
    await saltRoad();
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-able')));
    assert.ok(await p.locator('.zm-shots').isVisible(), 'the Shots button is on the top line');
    assert.equal(await p.locator('.ss-side .ss-card, .ss-rows, .ss-tram').count(), 0);
    await addShots();
    assert.equal(await p.locator('.ss-side .ss-card, .ss-rows, .ss-tram').count(), 0, 'still put away');
  });

  await check('desktop: Alt + B puts each shot beside its first line, with tramlines, and the words keep their place', async () => {
    await p.evaluate(() => window.scrollTo(0, 0));
    const wrap = await p.locator('#editor p[data-el="action"] >> nth=0').evaluate((e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]);
    await p.keyboard.press('Alt+b');
    await p.waitForSelector('.ss-side .ss-card');
    await sleep(900);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-beside')));
    assert.equal(await p.locator('.ss-side .ss-card').count(), 9);
    assert.deepEqual(await p.locator('#editor p[data-el="action"] >> nth=0').evaluate((e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]), wrap, 'the text column keeps its width');
    // The two-shot sits level with its first line (Mara in the engine).
    const first = await top(line('MARA, thirties'));
    const shot = await top(p.locator(card(0, 1)));
    assert.ok(Math.abs(first - shot) <= 8, `the two-shot at ${shot}, its first line at ${first}`);
    assert.equal(await p.locator('.ss-tram').count(), 8, 'a tramline for each shot on lines');
    assert.equal(await count(0), '5 shots · 1 line without one');
    assert.equal(await count(1), '3 shots · 2 lines without one');
    assert.equal(await count(2), '1 shot · 6 lines without one');
    assert.equal(await p.locator('.ss-bare').count(), 9, 'a dotted mark beside each line without a shot');
    // Scene 2's first two shots cover the same line: their tramlines sit side by side.
    const [a, b] = await p.evaluate((e) => [...document.querySelectorAll('.ss-tram')].filter((t) => window.__scriptShots.find(t.dataset.shot)?.a.eid === e).slice(0, 2).map((t) => t.offsetLeft), E[1]);
    assert.notEqual(a, b);
    assert.match(await p.locator(card(2, 0)).textContent(), /Not on any lines yet/);
    assert.equal(await p.locator('.zm-shots').getAttribute('aria-pressed'), 'true');
    await snap('1-desktop-lines');
  });

  await check('desktop: one click picks a shot and lights its lines, a second opens it; nothing scrolls or moves', async () => {
    await p.evaluate(() => window.scrollTo(0, 0));
    await sleep(200);
    await noMove(() => tap(card(0, 1)), 'pick');
    assert.equal(await p.locator('.ss-side .ss-card.sel').count(), 1);
    assert.equal(await p.locator('.ss-pop').count(), 0);
    assert.equal(await p.locator('.ss-hl:not(.pick)').count(), 1, 'its lines are lit');
    assert.equal(await p.locator('.ss-links path').count(), 1, 'a line joins the tramline to the shot');
    const lit = await p.locator('.ss-hl:not(.pick)').evaluate((e) => [Math.round(e.getBoundingClientRect().top), Math.round(e.getBoundingClientRect().bottom)]);
    assert.ok(lit[0] <= await top(line('MARA, thirties')) && lit[1] >= await top(line('Just broken')), 'lit from Mara in the engine to Just broken');
    await snap('2-desktop-picked');
    await noMove(() => tap(card(0, 1)), 'open');
    assert.equal(await p.locator('.ss-pop').count(), 1);
    assert.match(await p.locator('.ss-pop .ss-in').textContent(), /In Scene 1 · The turn-off/);
    assert.match(await p.locator('.ss-pop .ss-covers').textContent(), /Covers 3 lines, from “MARA, thirties/);
    assert.doesNotMatch(await p.locator('.ss-pop').textContent(), /EXT\./, 'no slug line in the open shot');
    await snap('3-desktop-open');
    // Typing in it changes the shot at once, with no redraw.
    const frame = p.locator(card(0, 1));
    const handle = await frame.elementHandle();
    await p.locator('.ss-pop .ss-what-in').fill('Mara in the engine, June swinging her legs behind her.');
    assert.equal(await frame.locator('.ss-what').textContent(), 'Mara in the engine, June swinging her legs behind her.');
    assert.ok(await handle.evaluate((e) => e.isConnected), 'the same frame, not drawn again');
    await noMove(() => p.keyboard.press('Escape'), 'close');
    assert.equal(await p.locator('.ss-pop').count(), 0);
    await p.keyboard.press('Escape');
    await sleep(700);
  });

  await check('desktop: a click on a line lights the shots on it and offers a shot for it, above the line', async () => {
    await p.evaluate(() => window.scrollTo(0, 0));
    await sleep(200);
    await noMove(() => tap(line('Is it broken broken')), 'click a line');
    assert.equal(await p.locator('.ss-side .ss-card.on').count(), 1, 'the two-shot covers it');
    assert.equal(await p.evaluate(() => window.__scriptShots.lines?.from), 2, 'a click on what June says picks her name too');
    assert.ok(await p.locator('.ss-bar').isVisible());
    assert.match(await p.locator('.ss-bar').textContent(), /\+ Shot for this line/);
    const bar = await p.locator('.ss-bar').boundingBox();
    const pick = await p.locator('.ss-hl.pick').boundingBox();
    assert.ok(bar.y + bar.height <= pick.y + 1 || bar.y >= pick.y + pick.height - 1, 'the bar never covers the picked lines');
    await snap('4-desktop-line');
    // Typing puts the bar away.
    await p.keyboard.press('End');
    await p.keyboard.press('ArrowLeft');
    assert.ok(await p.locator('.ss-bar').isHidden());
  });

  await check('desktop: + Shot for this line on a line with none takes a lettered number between its neighbours', async () => {
    await tap(line('Mara doesn’t look up'));
    await sleep(200);
    await p.locator('.ss-bar button', { hasText: '+ Shot' }).click();
    await p.waitForSelector('.ss-pop .ss-what-in');
    assert.equal(await p.evaluate(() => document.activeElement?.classList.contains('ss-what-in')), true, 'the caret is in What happens');
    assert.equal(await p.locator('.ss-pop .ss-code').first().textContent(), 'S01-04A');
    await p.keyboard.type('Mara, not looking up.');
    await p.keyboard.press('Enter');
    await sleep(800);
    assert.equal(await count(0), '6 shots');
    const made = await p.evaluate(() => { const ss = window.__scriptShots; const a = ss.anchors()[0]; return ss.ordered(a).map((s) => s.text); });
    assert.equal(made[4], 'Mara, not looking up.', 'it sits in order, on its line');
  });

  await check('desktop: Shift + click picks several lines, and Move shot here puts a shot on them (Undo puts it back)', async () => {
    await tap(card(2, 0));
    await tap(line('A bell on the door'));
    await tap(line('June climbs onto a stool'), { shift: true });
    await sleep(200);
    assert.equal(await p.evaluate(() => [window.__scriptShots.lines.from, window.__scriptShots.lines.to].join()), '0,1');
    assert.match(await p.locator('.ss-bar').textContent(), /\+ Shot for these lines/);
    await p.locator('.ss-bar button', { hasText: /Move shot \S+ here/ }).click();
    await sleep(800);
    assert.equal(await count(2), '1 shot · 4 lines without one');
    assert.doesNotMatch(await p.locator(card(2, 0)).textContent(), /Not on any lines/);
    await p.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(700);
    assert.equal(await count(2), '1 shot · 6 lines without one');
  });

  await check('desktop: Alt + Down and Alt + Up step shot to shot', async () => {
    await tap(card(0, 0));
    const ids = await p.evaluate(() => window.__scriptShots.all().map((x) => x.sh.id));
    assert.equal(await sel(), ids[0]);
    await p.keyboard.press('Alt+ArrowDown');
    assert.equal(await sel(), ids[1]);
    await p.keyboard.press('Alt+ArrowDown');
    assert.equal(await sel(), ids[2]);
    await p.keyboard.press('Alt+ArrowUp');
    assert.equal(await sel(), ids[1]);
    await p.keyboard.press('Escape');
  });

  await check('desktop: Remove sends a shot to the Trash, and Undo brings it back', async () => {
    await tap(card(1, 2));
    await tap(card(1, 2));
    await p.locator('.ss-pop .ss-act', { hasText: 'Remove' }).click();
    await sleep(500);
    assert.equal(await p.locator(`.ss-side .ss-card[data-eid="${E[1]}"]`).count(), 2);
    await p.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(500);
    assert.equal(await p.locator(`.ss-side .ss-card[data-eid="${E[1]}"]`).count(), 3);
  });

  await check('desktop: in the script (one column), each shot right above its first line', async () => {
    await run('Shots: in the script');
    await p.waitForSelector('.ss-rows .ss-card');
    await sleep(900);
    assert.equal(await p.locator('.ss-side .ss-card').count(), 0);
    assert.equal(await p.locator('.ss-rows .ss-card').count(), 10);
    // The two-shot's row is right before Mara in the engine.
    const next = await p.locator(card(0, 1, '.ss-rows')).evaluate((e) => e.closest('.ss-rows').nextElementSibling?.textContent || '');
    assert.match(next, /^MARA, thirties/);
    assert.ok(await p.locator('.ss-tram').count() >= 8, 'tramlines in the margin');
    assert.ok(await p.evaluate(() => [...document.querySelectorAll('.ss-tram')].every((t) => t.getBoundingClientRect().right < window.__editor.view.dom.querySelector('p[data-el=action]').getBoundingClientRect().left + 9)), 'tramlines stay in the margin, off the words');
    await p.locator(card(0, 1, '.ss-rows')).scrollIntoViewIfNeeded();
    await p.evaluate(() => window.scrollBy(0, -40));
    await sleep(200);
    await noMove(() => tap(card(0, 1, '.ss-rows')), 'pick in the script');
    await noMove(() => tap(card(0, 1, '.ss-rows')), 'open in the script');
    assert.equal(await p.locator('.ss-pop').count(), 1);
    await snap('5-desktop-column');
    await p.keyboard.press('Escape');
    await p.keyboard.press('Escape');
    // Typing in the script still works with the rows there.
    await tap(line('A white pickup sits dead'));
    await p.waitForFunction(() => window.__editor.state.selection.$from.parent.textContent.startsWith('A white pickup'), null, { timeout: 3000 }).catch(() => {});
    assert.ok(await p.evaluate(() => window.__editor.state.selection.$from.parent.textContent.startsWith('A white pickup')), 'the click put the caret in the line');
    await p.evaluate(() => { const { state } = window.__editor; const $f = state.selection.$from; window.__editor.commands.setTextSelection($f.end()); });
    await p.keyboard.type(' Wind.');
    assert.match(await p.locator('#editor p[data-el="action"] >> nth=0').textContent(), /sky\. Wind\.$/);
    await run('Shots: beside the script');
    await p.waitForSelector('.ss-side .ss-card');
  });

  await check('desktop: a shot whose lines are deleted goes back to its scene, never lost', async () => {
    await p.evaluate(() => {
      const ed = window.__editor;
      let at = null;
      ed.state.doc.forEach((n, pos) => { if (n.textContent.startsWith('Mara pulls the dipstick')) at = [pos, pos + n.nodeSize]; });
      ed.view.dispatch(ed.state.tr.delete(at[0], at[1]));
    });
    await sleep(900);
    assert.equal(await p.locator(`.ss-side .ss-card[data-eid="${E[0]}"]`).count(), 6, 'still six shots in Scene 1');
    assert.match(await p.locator(card(0, 0)).textContent(), /dipstick[\s\S]*Not on any lines yet/, 'the dipstick shot waits at the scene line');
    await p.keyboard.press('Control+z');
    await sleep(900);
    assert.equal(await count(0), '6 shots', 'Undo puts the line back, and the shot on it');
  });

  await check('desktop: Alt + B puts them away again, and that is remembered for this script', async () => {
    await p.locator('#editor p[data-el="action"] >> nth=0').click();
    await p.keyboard.press('Alt+b');
    await sleep(900);
    assert.equal(await p.locator('.ss-side .ss-card, .ss-rows, .ss-tram').count(), 0);
    assert.equal(await p.evaluate(() => localStorage.getItem(`shotsOn:${window.__scriptShots.pieceId}`)), null);
    await p.keyboard.press('Alt+b');
    await p.waitForSelector('.ss-side .ss-card');
    assert.equal(await p.evaluate(() => localStorage.getItem(`shotsOn:${window.__scriptShots.pieceId}`)), '1');
  });

  await check('desktop: Open in Make lands on that shot, and Make says how many lines it covers', async () => {
    await tap(card(0, 1));
    await tap(card(0, 1));
    const id = await p.locator('.ss-pop .ss-detail').getAttribute('data-shot');
    await p.locator('.ss-pop .ss-act', { hasText: 'Open in Make' }).click();
    await p.waitForFunction(() => document.documentElement.dataset.view === 'production');
    await p.waitForSelector(`#prod-view [data-shot="${id}"]`, { state: 'attached', timeout: 8000 });
    assert.equal(await p.locator(`#prod-view [data-shot="${id}"] .pd-covers`).first().textContent(), 'covers 3 lines');
    assert.equal(await p.locator('.ss-side .ss-card').count(), 0, 'nothing of it stays in Make');
    await p.goBack();
    await p.waitForFunction(() => !document.documentElement.dataset.view);
    await p.waitForSelector('.ss-side .ss-card');
  });

  await check('desktop: Classic shows the same shots, scenes still by name', async () => {
    await run('Script view: Classic');
    await sleep(900);
    assert.equal(await p.locator('.ss-side .ss-card').count(), 10);
    const head = await p.locator('#editor p[data-el="scene"] >> nth=1').evaluate((e) => e.getBoundingClientRect().top);
    const at = await p.locator(`.ss-head[data-eid="${E[1]}"]`).evaluate((e) => e.getBoundingClientRect().top);
    assert.ok(at >= head - 2, 'its count at its heading, or under the shots above when they crowd');
    await tap(card(1, 2));
    await tap(card(1, 2));
    assert.match(await p.locator('.ss-pop .ss-in').textContent(), /The walk/);
    await p.keyboard.press('Escape');
    await run('Script view: Woven');
    await sleep(600);
  });

  await check('desktop: a window too narrow for both columns puts the shots in the script', async () => {
    await p.setViewportSize({ width: 980, height: 800 });
    await sleep(900);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-column')));
    assert.equal(await p.locator('.ss-rows .ss-card').count(), 10);
    await p.setViewportSize({ width: 1400, height: 860 });
    await sleep(900);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-beside')));
  });

  await check('phone upright: in the script by default; the sheet opens over the page and steps shot to shot', async () => {
    p = await open({ ...devices['Pixel 7'], colorScheme: 'dark' });
    p.__touch = true;
    await newPiece('New screenplay', 'Salt Road', 'Script');
    await saltRoad();
    await addShots();
    // The Shots button is in reach in the top bar, even with versions to check (those live in ⋯).
    await p.evaluate(() => document.documentElement.classList.add('to-check'));
    for (const sel of ['.zm-shots', '.zm-aa', '.zm-more', '.pv-seg']) {
      const b = await p.locator(`.topbar ${sel}`).boundingBox();
      assert.ok(b && b.x >= 0 && b.x + b.width <= 412, `${sel} is on screen`);
    }
    await p.evaluate(() => document.documentElement.classList.remove('to-check'));
    await p.evaluate(() => window.__scriptShots.toggle());
    await p.waitForSelector('.ss-rows .ss-card');
    await sleep(900);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-column')));
    await p.locator(card(0, 1, '.ss-rows')).scrollIntoViewIfNeeded();
    await p.evaluate(() => window.scrollBy(0, 80));
    await sleep(200);
    await snap('6-phone-column');
    await noMove(() => tap(card(0, 1, '.ss-rows')), 'pick');
    await noMove(() => tap(card(0, 1, '.ss-rows')), 'open');
    assert.equal(await p.locator('.ss-sheet').count(), 1);
    assert.match(await p.locator('.ss-sheet .ss-where').textContent(), /Shot 2 of 9/);
    await snap('7-phone-sheet');
    await tap('.ss-sheet .ss-nav button[aria-label="Next shot"]');
    assert.match(await p.locator('.ss-sheet .ss-where').textContent(), /Shot 3 of 9/);
    await tap('.ss-sheet .ss-nav button[aria-label="Close"]');
    assert.equal(await p.locator('.ss-sheet').count(), 0);
  });

  await check('phone upright: + pictures at a scene fills its shots without a picture, then makes new shots; Undo takes them back', async () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    const add = p.locator('.ss-addpics').first();
    await add.scrollIntoViewIfNeeded();
    const b = await add.boundingBox();
    assert.ok(b && b.height >= 28 && b.x + b.width <= 412, 'easy to tap, on screen');
    await snap('11-phone-add-pictures');
    const before = await p.locator('.ss-card').count();
    await add.locator('input').setInputFiles([1, 2, 3, 4, 5, 6].map((i) => ({ name: `frame${i}.png`, mimeType: 'image/png', buffer: PNG })));
    await p.waitForFunction(() => /6 pictures:/.test(document.querySelector('.toast')?.textContent || ''));
    const text = await p.locator('.toast').textContent();
    const made = Number((text.match(/(\d+) new shots?/) || [0, 0])[1]);
    assert.ok(/on shots? without one/.test(text) || made === 6, text);
    await p.waitForFunction((n) => document.querySelectorAll('.ss-card').length === n, before + made);
    await sleep(300);
    await snap('12-phone-pictures-in');
    await tap('.toast button');
    await p.waitForFunction((n) => document.querySelectorAll('.ss-card').length === n, before);
  });

  await check('phone upright: beside is a thin strip of pictures, each level with its lines', async () => {
    // Picked from ⋯ the way Michael did (Nov 23): it really moves them beside.
    await tap('.zm-more');
    await p.getByText('Shots beside the script').waitFor();
    { const b = await p.getByText('Shots beside the script').boundingBox(); await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); }
    await p.waitForSelector('.ss-side .ss-thumb');
    await sleep(900);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-rail')));
    const w = await p.locator('.ss-side').evaluate((e) => e.getBoundingClientRect().width);
    assert.ok(w < 90, `the strip is thin (${Math.round(w)}px)`);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll');
    assert.ok(await p.locator('.ss-tram').count() >= 8, 'tramlines beside the words');
    await p.evaluate(() => window.scrollTo(0, 0));
    await snap('8-phone-rail');
    await noMove(() => tap(thumb(0, 2)), 'pick a picture');
    await noMove(() => tap(thumb(0, 2)), 'open it');
    assert.equal(await p.locator('.ss-sheet').count(), 1);
    await tap('.ss-sheet .ss-nav button[aria-label="Close"]');
  });

  await check('phone sideways: two real columns', async () => {
    await p.setViewportSize({ width: 915, height: 412 });
    await sleep(900);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-sideways')));
    assert.equal(await p.locator('.ss-side .ss-card').count(), 9);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll');
    await p.evaluate(() => window.scrollTo(0, 0));
    await snap('9-phone-sideways');
    await tap(card(0, 1));
    await tap(card(0, 1));
    assert.equal(await p.locator('.ss-sheet.side').count(), 1, 'the sheet sits at the side');
    await snap('10-phone-sideways-open');
  });

  assert.deepEqual(errors, []);
} catch (e) {
  failed += 1;
  console.log(`FAIL ${e.message}`);
} finally {
  if (errors.length) console.log('page errors:', errors);
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nscript beside shots: all passed');
process.exit(failed ? 1 : 0);
