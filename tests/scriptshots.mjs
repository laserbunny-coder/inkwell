// The script with its shots beside it (Nov 22 2026). Part 1: a Shots switch
// on a script (Alt + B) shows the shots beside the text on a computer with
// room, a thin strip of pictures beside a phone held upright (or a narrow
// window) and two columns on a phone held sideways. The one-column way went
// on Nov 24 2026 (Michael): the Shots button is a plain on and off. A click picks a
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
// The margin beside a line (where the tramlines are): a tap there, or where it is.
async function marginAt(words, dy = 0.5) {
  let l = await line(words).boundingBox();
  const vh = p.viewportSize().height;
  if (l.y < 70 || l.y + l.height > vh - 120) { await line(words).evaluate((e) => window.scrollBy(0, e.getBoundingClientRect().top - window.innerHeight / 3)); await sleep(250); l = await line(words).boundingBox(); }
  const g = await p.locator('.ss-gut').boundingBox();
  return { x: g.x + g.width / 2, y: l.y + l.height * dy };
}
async function tapMargin(words) {
  const { x, y } = await marginAt(words);
  if (p.__touch) await p.touchscreen.tap(x, y); else await p.mouse.click(x, y);
  await sleep(250);
}
// A finger on the screen (CDP touch events), moved through points.
async function finger(points, { hold = 0, id = 7 } = {}) {
  const cdp = await p.context().newCDPSession(p);
  const pt = ([x, y]) => [{ x: Math.round(x), y: Math.round(y), id }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(points[0]) });
  if (hold) await sleep(hold);
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    for (let k = 1; k <= 6; k += 1) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt([x0 + ((x1 - x0) * k) / 6, y0 + ((y1 - y0) * k) / 6]) }); await sleep(16); }
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
}
// Where line i of scene e is on the screen.
const pbox = (e, i) => p.evaluate(([e, i]) => { const ss = window.__scriptShots; const a = ss.anchors()[e]; const r = ss.editor.view.nodeDOM(a.paras[i].pos).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, mid: (r.top + r.bottom) / 2 }; }, [e, i]);
const toastSays = (re) => p.waitForFunction((src) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(src).test(t.textContent || '')), re.source, { timeout: 6000 }).catch(async (e) => { console.log('TOAST', re.source, await p.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' || ')), JSON.stringify(await block())); throw e; });
const undo = async () => { await p.locator('.toast button', { hasText: 'Undo' }).last().click(); await sleep(700); };
const block = () => p.evaluate(() => { const b = window.__scriptShots.block(); return b ? { kind: b.kind, from: b.from, to: b.to, n: window.__scriptShots.linesNow(b.a, b) } : null; });

try {
  p = await open({ viewport: { width: 1400, height: 860 } });

  await check('desktop: Shots shows only on a script, off at first, and the script is only text', async () => {
    await newPiece('New screenplay', 'Salt Road', 'Script');
    await saltRoad();
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-able')));
    assert.ok(await p.locator('.zm-shots').isVisible(), 'the Shots button is on the top line');
    assert.equal(await p.locator('.ss-side .ss-card, .ss-side .ss-thumb, .ss-tram').count(), 0);
    await addShots();
    assert.equal(await p.locator('.ss-side .ss-card, .ss-side .ss-thumb, .ss-tram').count(), 0, 'still put away');
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
    assert.match(await p.locator('.ss-bar').textContent(), /^\+ Shot\+ Picture/);
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
    // A frame on no lines waits for its line; Escape lets that go (it stays the one picked last).
    await p.waitForSelector('.ss-banner:not([hidden])');
    assert.match(await p.locator('.ss-banner').textContent(), /Click the line shot \S+ belongs to/);
    await p.keyboard.press('Escape');
    await sleep(500);
    assert.ok(await p.locator('.ss-banner').isHidden());
    await tap(line('A bell on the door'));
    await tap(line('June climbs onto a stool'), { shift: true });
    await sleep(200);
    assert.equal(await p.evaluate(() => [window.__scriptShots.lines.from, window.__scriptShots.lines.to].join()), '0,1');
    assert.equal((await block()).n, 2, '2 lines picked');
    await p.locator('.ss-bar button', { hasText: /(Move|Put) shot \S+ here/ }).click();
    await sleep(800);
    assert.equal(await count(2), '1 shot · 4 lines without one');
    assert.doesNotMatch(await p.locator(card(2, 0)).textContent(), /Not on any lines/);
    await p.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(700);
    assert.equal(await count(2), '1 shot · 6 lines without one');
  });

  await check('desktop: a picked frame has a knob at each end; pull the bottom one with the mouse and it covers more lines (Undo puts it back)', async () => {
    await p.evaluate(() => window.scrollTo(0, 0));
    await sleep(200);
    await tap(card(0, 0));
    await sleep(300);
    const b0 = await block();
    assert.equal(b0.kind, 'shot');
    assert.equal(await p.locator('.ss-knob:not([hidden])').count(), 2, 'two knobs');
    assert.ok(!/\bpk\b/.test(await p.locator('.ss-band').getAttribute('class')), 'a solid band: a frame is on these lines');
    assert.ok(await p.locator('.ss-bar').isHidden(), 'a picked frame has no bar: a second click opens it, the knobs change its lines');
    await snap('22-desktop-knobs');
    // Two lines further down: the dipstick, then June's line.
    const k = await p.locator('.ss-knob[data-end="to"]').boundingBox();
    const target = await pbox(0, b0.to + 3);
    await p.mouse.move(k.x + k.width / 2, k.y + k.height / 2);
    await p.mouse.down();
    for (let i = 1; i <= 8; i += 1) { await p.mouse.move(k.x + k.width / 2, k.y + k.height / 2 + ((target.mid + 2 - k.y - k.height / 2) * i) / 8); await sleep(20); }
    assert.equal((await block()).n, b0.n + 2, 'the lines follow the knob while it is pulled');
    await p.mouse.up();
    await toastSays(new RegExp(`now covers ${b0.n + 2} lines`));
    assert.equal((await block()).kind, 'shot', 'still picked');
    await undo();
    assert.equal((await block()).n, b0.n, 'Undo puts it back');
  });

  await check('desktop: Shift + Down / Up and Alt + Shift + Down / Up change a picked frame by one line', async () => {
    const b0 = await block();
    await p.keyboard.press('Shift+ArrowDown');
    await p.waitForFunction((to) => window.__scriptShots.block().to > to, b0.to);
    await p.keyboard.press('Alt+Shift+ArrowDown');
    await p.waitForFunction((from) => window.__scriptShots.block().from > from, b0.from);
    await p.keyboard.press('Alt+Shift+ArrowUp');
    await p.waitForFunction((from) => window.__scriptShots.block().from === from, b0.from);
    await p.keyboard.press('Shift+ArrowUp');
    await p.waitForFunction((to) => window.__scriptShots.block().to === to, b0.to);
    assert.deepEqual(await block(), b0);
  });

  await check('desktop: the open shot says where it starts and ends, with a line earlier or later, and Take off lines (Undo)', async () => {
    const b0 = await block();
    await sleep(600); // past the guard that swallows a click right after a change
    await tap(card(0, 0));
    if (!(await p.locator('.ss-pop .ss-ends').count())) { await sleep(600); if (!(await p.locator('.ss-pop .ss-ends').count())) await tap(card(0, 0)); }
    await p.waitForSelector('.ss-pop .ss-ends');
    assert.match(await p.locator('.ss-pop .ss-end-start').textContent(), /Starts at“A white pickup/);
    assert.ok(await p.locator('.ss-pop .ss-end-start .ss-step-up').isDisabled(), 'it starts on the scene’s first line');
    await p.locator('.ss-pop .ss-end-end .ss-step-down').click();
    await p.waitForFunction((n) => window.__scriptShots.linesNow(window.__scriptShots.block().a, window.__scriptShots.block()) === n, b0.n + 1);
    assert.match(await p.locator('.ss-pop .ss-end-end').textContent(), /MARA, thirties/);
    await p.locator('.ss-pop .ss-end-end .ss-step-up').click();
    await p.waitForFunction((n) => window.__scriptShots.linesNow(window.__scriptShots.block().a, window.__scriptShots.block()) === n, b0.n);
    await p.locator('.ss-pop .ss-act', { hasText: 'Take off lines' }).click();
    await toastSays(/is off its lines/);
    assert.equal(await block(), null, 'on no lines now');
    assert.match(await p.locator('.ss-pop .ss-act.ss-place').textContent(), /^Put on lines$/);
    await undo();
    assert.deepEqual(await block(), b0, 'Undo puts it back on its lines');
    await p.evaluate(() => { window.__scriptShots.close(); window.__scriptShots.pick(null); });
    await sleep(300);
  });

  await check('desktop: a click in the margin picks a line with no caret; a drag down it picks several; Shift + click stretches them', async () => {
    await tapMargin('A bell on the door');
    let b = await block();
    assert.equal(b.kind, 'pick');
    assert.equal(b.n, 1);
    assert.equal(await p.evaluate(() => window.__editor.isFocused), false, 'no caret in the words');
    assert.ok(/\bpk\b/.test(await p.locator('.ss-band').getAttribute('class')), 'a broken band: no frame yet');
    assert.equal((await block()).n, 1);
    assert.match(await p.locator('.ss-bar').textContent(), /\+ Shot/);
    await p.keyboard.press('Escape');
    await sleep(200);
    const a = await marginAt('A bell on the door');
    const z = await marginAt('Long walk?');
    await p.mouse.move(a.x, a.y);
    await p.mouse.down();
    for (let i = 1; i <= 8; i += 1) { await p.mouse.move(a.x, a.y + ((z.y - a.y) * i) / 8); await sleep(20); }
    await p.mouse.up();
    await sleep(200);
    b = await block();
    assert.deepEqual([b.kind, b.from, b.to], ['pick', 0, 3], 'the bell, the stool and the waitress’s line');
    await snap('23-desktop-margin-pick');
    await tap(line('Eleven thousand steps'), { shift: true });
    await sleep(300);
    b = await block();
    assert.equal(b.to, 5, 'Shift + click reaches June’s line');
    await p.keyboard.press('Escape');
    await sleep(200);
    assert.equal(await block(), null);
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

  const doneIn = (id) => p.evaluate((x) => { const ss = window.__scriptShots; const c = ss.find(x); return !!(c && ss.doneOf(c.sh)); }, id);
  await check('desktop: hold a frame still and let go: it is got (a check on it, the count says so); hold again takes it back; G does the same', async () => {
    await p.evaluate(() => { window.__scriptShots.pick(null); window.scrollTo(0, 0); });
    await sleep(300);
    const id = await p.locator(card(0, 1)).getAttribute('data-shot');
    const b = await p.locator(card(0, 1)).boundingBox();
    await p.mouse.move(b.x + 40, b.y + 20);
    await p.mouse.down();
    await sleep(520);
    assert.ok(await p.locator(`.ss-side [data-shot="${id}"]`).evaluate((n) => n.classList.contains('ss-held')), 'the frame shows the hold');
    await p.mouse.up();
    await p.waitForFunction((x) => document.querySelector(`.ss-side [data-shot="${x}"]`)?.classList.contains('got'), id);
    assert.equal(await doneIn(id), true);
    assert.equal(await p.locator(`.ss-side [data-shot="${id}"] .ss-check`).count(), 1, 'a check on the picture');
    await toastSays(/: (got it|done) · 1 of 10/);
    assert.equal(await p.locator('.ss-pop').count(), 0, 'the hold opens nothing');
    assert.match(await count(0), /^1 of 6 got/);
    assert.equal(await p.locator('.zm-shots').getAttribute('data-got'), '1/10', 'the piece count by the Shots button');
    await snap('26-desktop-got');
    // Left only: got shots and their lines fade in place; nothing moves.
    const top = await p.locator(card(0, 2)).evaluate((e) => e.getBoundingClientRect().top);
    await p.evaluate(() => document.dispatchEvent(new CustomEvent('inkwell:shots-left')));
    await sleep(400);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-left-only')));
    assert.ok(await p.locator('.ss-fade').count() >= 1, 'its lines fade');
    assert.equal(await p.locator(card(0, 2)).evaluate((e) => e.getBoundingClientRect().top), top, 'nothing moves');
    await snap('27-desktop-left-only');
    await p.evaluate(() => document.dispatchEvent(new CustomEvent('inkwell:shots-left')));
    await sleep(300);
    assert.equal(await p.locator('.ss-fade').count(), 0);
    // Hold again: back to not got.
    await p.mouse.move(b.x + 40, b.y + 20);
    await p.mouse.down();
    await sleep(520);
    await p.mouse.up();
    await p.waitForFunction((x) => !document.querySelector(`.ss-side [data-shot="${x}"]`)?.classList.contains('got'), id);
    // G on the picked shot.
    await p.evaluate((x) => { window.__scriptShots.pick(x); document.activeElement?.blur(); }, id);
    await p.keyboard.press('g');
    await p.waitForFunction((x) => document.querySelector(`.ss-side [data-shot="${x}"]`)?.classList.contains('got'), id);
    await p.keyboard.press('g');
    await p.waitForFunction((x) => !document.querySelector(`.ss-side [data-shot="${x}"]`)?.classList.contains('got'), id);
    assert.equal(await count(0), '6 shots');
  });

  await check('desktop: the last shot got offers to move the piece on, and never moves it by itself', async () => {
    const ids = await p.evaluate(() => [...window.__scriptShots.shots.values()].flat().map((sh) => sh.id));
    const last = await p.locator(card(0, 1)).getAttribute('data-shot');
    await p.evaluate(async (list) => { const ss = window.__scriptShots; for (const x of list) await ss.setGot(x, true); await ss.reload(); }, ids.filter((x) => x !== last));
    const stage = await p.evaluate(() => window.__scriptShots.hooks.piece().fields?.stage || null);
    await sleep(700); // the frames settle beside their lines again
    const b = await p.locator(card(0, 1)).boundingBox();
    await p.mouse.move(b.x + 40, b.y + 20);
    await p.mouse.down();
    await sleep(520);
    await p.mouse.up();
    await toastSays(/All 10 shots got\. Move it on to /);
    assert.ok(await p.locator('.toast button', { hasText: 'Not yet' }).count() >= 1);
    assert.ok(await p.locator('.toast button', { hasText: /^Move to / }).count() >= 1);
    await snap('28-desktop-all-got');
    assert.equal(await p.evaluate(() => window.__scriptShots.hooks.piece().fields?.stage || null), stage, 'the stage stays until he says');
    await p.locator('.toast button', { hasText: 'Not yet' }).first().click();
    await p.evaluate(async (list) => { const ss = window.__scriptShots; for (const x of list) await ss.setGot(x, false); await ss.reload(); }, ids);
    await sleep(300);
    assert.equal(await p.locator('.ss-side .got').count(), 0);
  });

  await check('desktop: the Shots button is one tap: away, then back, with no menu', async () => {
    const shotsBtn = () => p.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.zm-shots').click(); });
    await shotsBtn();
    await sleep(700);
    assert.equal(await p.locator('.pop-menu').count(), 0, 'no menu');
    assert.equal(await p.locator('.ss-side .ss-card, .ss-side .ss-thumb, .ss-tram').count(), 0, 'put away');
    assert.equal(await p.locator('.zm-shots').getAttribute('aria-pressed'), 'false');
    await shotsBtn();
    await p.waitForSelector('.ss-side .ss-card');
    assert.equal(await p.locator('.pop-menu').count(), 0, 'no menu');
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-beside')));
    assert.equal(await p.locator('.zm-shots').getAttribute('aria-pressed'), 'true');
    // Every command (Ctrl + K) has no one-column choice any more.
    assert.equal(await p.evaluate(() => document.body.textContent.includes('one column')), false);
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
    await p.evaluate(() => window.__editor.commands.focus());
    await p.keyboard.press('Control+z');
    await sleep(900);
    assert.equal(await count(0), '6 shots', 'Undo puts the line back, and the shot on it');
    assert.ok(!/Not on any lines yet/.test(await p.locator(card(0, 0)).textContent()), 'and the dipstick shot is on its line again');
  });

  await check('desktop: Alt + B puts them away again, and that is remembered for this script', async () => {
    await p.locator('#editor p[data-el="action"] >> nth=0').click();
    await p.keyboard.press('Alt+b');
    await sleep(900);
    assert.equal(await p.locator('.ss-side .ss-card, .ss-side .ss-thumb, .ss-tram').count(), 0);
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

  const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  const shotsIn = (scene) => p.evaluate((i) => { const ss = window.__scriptShots; const a = ss.anchors()[i]; return ss.ordered(a).map((sh) => ({ id: sh.id, n: sh.fields?.n, from: a.paras.findIndex((x) => x.id === sh.fields?.from), to: a.paras.findIndex((x) => x.id === sh.fields?.to), still: sh.fields?.star?.still || null })); }, scene);

  await check('desktop: pick lines, + Picture: the picture becomes a shot covering exactly those lines (Undo takes it away)', async () => {
    await p.evaluate(() => window.scrollTo(0, 0));
    await tap(line('A bell on the door'));
    await tap(line('June climbs onto a stool'), { shift: true });
    await sleep(200);
    const had = (await shotsIn(2)).map((sh) => sh.id);
    await p.locator('.ss-bar .ss-barpic').click();
    assert.deepEqual(await p.locator('.pop-menu .pop-item').allTextContents(), ['Sketch', 'Photo or file'], '+ Picture: a sketch or a photo');
    const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.locator('.pop-menu .pop-item', { hasText: 'Photo or file' }).click()]);
    await chooser.setFiles([{ name: 'bell.png', mimeType: 'image/png', buffer: PNG1 }]);
    await p.waitForFunction(() => /with its picture/.test(document.querySelector('.toast')?.textContent || ''));
    await snap('13-desktop-picture-on-lines');
    const made = (await shotsIn(2)).find((sh) => !had.includes(sh.id));
    assert.ok(made?.still, 'its picture is its still');
    assert.deepEqual([made.from, made.to], [0, 1], 'it covers the two picked lines');
    await p.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(700);
    assert.equal((await shotsIn(2)).length, 1, 'Undo takes it away');
  });

  await check('desktop: drag a frame onto another line and it covers that line (Undo puts it back)', async () => {
    await p.evaluate(() => { window.__scriptShots.close(); window.__scriptShots.pick(null); });
    await p.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    const before = (await shotsIn(0))[0];
    const from = await p.locator(card(0, 0)).boundingBox();
    const to = await line('Is it broken broken').boundingBox();
    assert.ok(from.y > 0 && to.y + to.height < 760, `both on screen (${Math.round(from.y)}, ${Math.round(to.y)})`);
    await p.mouse.move(from.x + 20, from.y + 20);
    await p.mouse.down();
    for (let i = 1; i <= 12; i += 1) await p.mouse.move(from.x + 20 + ((to.x + 40 - from.x - 20) * i) / 12, from.y + 20 + ((to.y + to.height / 2 - from.y - 20) * i) / 12);
    assert.equal(await p.locator('.ss-ghost').count(), 1, 'a small frame follows the pointer');
    assert.ok(await p.locator('.ss-hl.pick').count() >= 1, 'the line it would land on is lit');
    assert.ok(await p.locator('.ss-bar').isHidden(), 'no bar while dragging');
    await snap('14-desktop-drag-frame');
    await p.mouse.up();
    await p.waitForFunction(() => /now covers 1 line/.test(document.querySelector('.toast')?.textContent || ''));
    const moved = (await shotsIn(0)).find((sh) => sh.id === before.id);
    assert.notEqual(moved.from, before.from, 'it moved');
    assert.equal(await p.locator('.ss-pop').count(), 0, 'a drop doesn’t open the shot');
    await p.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(700);
    assert.equal((await shotsIn(0)).find((sh) => sh.id === before.id).from, before.from, 'Undo puts it back');
  });

  await check('desktop: a picture dragged from the computer onto a line becomes a shot there', async () => {
    const n = (await shotsIn(0)).length;
    const box = await line('Mara doesn’t look up').boundingBox();
    await p.evaluate(async ({ x, y, b64 }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'frame.png', { type: 'image/png' }));
      const el = document.elementFromPoint(x, y);
      for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }, { x: box.x + 40, y: box.y + box.height / 2, b64: PNG1.toString('base64') });
    await p.waitForFunction(() => /with its picture/.test(document.querySelector('.toast')?.textContent || ''));
    const list = await shotsIn(0);
    assert.equal(list.length, n + 1);
    assert.ok(list.some((sh) => sh.still && sh.from >= 0), 'on its line, with its picture');
    assert.equal(await p.locator('#editor .file-node, #editor [data-type="file"]').count(), 0, 'nothing pasted into the script itself');
    await p.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(700);
    assert.equal((await shotsIn(0)).length, n);
    await p.evaluate(() => { window.__scriptShots.close(); window.__scriptShots.pick(null); });
  });

  // A pen stroke on the pad: pressure from light to firm.
  async function penStroke(pts, type = 'pen') {
    await p.evaluate(({ pts, type }) => {
      const cv = document.querySelector('.sk-pad canvas');
      const r = cv.getBoundingClientRect();
      const at = ([x, y, pr]) => ({ clientX: r.left + x * r.width, clientY: r.top + y * r.height, pressure: pr, pointerType: type, pointerId: type === 'pen' ? 7 : 9, isPrimary: true, bubbles: true, button: 0, buttons: 1 });
      cv.dispatchEvent(new PointerEvent('pointerdown', at(pts[0])));
      for (const q of pts.slice(1)) cv.dispatchEvent(new PointerEvent('pointermove', at(q)));
      cv.dispatchEvent(new PointerEvent('pointerup', { ...at(pts.at(-1)), buttons: 0 }));
    }, { pts, type });
  }

  await check('desktop: pick lines, + Picture, Sketch: the pad; a pen’s pressure sets the line; Done puts the sketch on those lines as a board frame', async () => {
    await p.evaluate(() => window.scrollTo(0, 0));
    await tap(line('A bell on the door'));
    await sleep(200);
    const had = (await shotsIn(2)).map((sh) => sh.id);
    await p.locator('.ss-bar .ss-barpic').click();
    await p.locator('.pop-menu .pop-item', { hasText: 'Sketch' }).click();
    await p.waitForSelector('.sk-pad canvas');
    await penStroke([[0.2, 0.5, 0.1], [0.3, 0.5, 0.2], [0.4, 0.52, 0.6], [0.5, 0.55, 1]]);
    const pr = await p.evaluate(() => window.__sketchPad.pad.strokes[0].pts.map((q) => q[2]));
    assert.deepEqual(pr.map((x) => Math.round(x * 10) / 10), [0.1, 0.2, 0.6, 1], 'pressure is kept per point');
    // Once a pen has been seen, a palm (one touch) draws nothing.
    await penStroke([[0.6, 0.3, 0.5], [0.7, 0.4, 0.5]], 'touch');
    assert.equal(await p.evaluate(() => window.__sketchPad.pad.strokes.length), 1, 'a palm after the pen draws nothing');
    await penStroke([[0.2, 0.2, 0.5], [0.35, 0.25, 0.5]]);
    assert.equal(await p.evaluate(() => window.__sketchPad.pad.strokes.length), 2);
    await p.keyboard.press('Control+z');
    assert.equal(await p.evaluate(() => window.__sketchPad.pad.strokes.length), 1, 'Ctrl + Z undoes');
    await snap('17-desktop-pad');
    await p.locator('.sk-pad .sk-btn.go').click();
    await p.waitForFunction(() => /with its sketch/.test(document.querySelector('.toast')?.textContent || ''));
    const made = (await shotsIn(2)).find((sh) => !had.includes(sh.id));
    assert.ok(made && made.from >= 0, 'a new shot on the picked line');
    const row = await p.evaluate((id) => { const ss = window.__scriptShots; return ss.find(id).sh.fields; }, made.id);
    assert.equal(row.tries.at(-1).kind, 'board');
    assert.equal(row.tries.at(-1).source, 'sketch');
    assert.ok(row.tries.at(-1).strokes, 'its strokes are kept');
    assert.ok(row.star?.board, 'it is the picked board frame');
    assert.equal(row.star?.still, undefined, 'never the still the video starts on');
    assert.equal(await p.evaluate((id) => { const ss = window.__scriptShots; return ss.still(ss.find(id).sh); }, made.id), row.star.board, 'the frame shows the sketch');
    await snap('18-desktop-sketch-on-lines');
    globalThis.__madeSketch = made.id;
  });

  await check('desktop: Keep drawing opens the sketch again; Copy the prompt has the shot, its lines and the scene', async () => {
    const id = globalThis.__madeSketch;
    await p.waitForSelector('.ss-pop .ss-sketch-again');
    await p.locator('.ss-pop .ss-sketch-again').click();
    await p.waitForSelector('.sk-pad canvas');
    assert.equal(await p.evaluate(() => window.__sketchPad.pad.strokes.length), 1, 'the strokes are back');
    await penStroke([[0.7, 0.7, 0.4], [0.8, 0.75, 0.8]]);
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => /Sketch kept/.test(document.querySelector('.toast')?.textContent || ''));
    const f = await p.evaluate((id) => window.__scriptShots.find(id).sh.fields, id);
    assert.equal(f.tries.length, 2, 'a new try, the first kept');
    assert.equal(f.tries[1].from, f.tries[0].id, 'it says which sketch it came from');
    assert.equal(f.star.board, f.tries[1].files[0], 'the new drawing is the picked frame now');
    assert.equal(await p.locator('.ss-pop .ss-frame').count(), 2, 'both in the strip');
    await snap('19-desktop-card-frames');
    const text = await p.evaluate(async (id) => { const ss = window.__scriptShots; const c = ss.find(id); return ss.copyPrompt(c.sh, c.a); }, id);
    assert.match(text, /storyboard frame/i);
    assert.match(text, /A bell on the door/, 'the line it covers');
    await p.evaluate(async (id) => { const ss = window.__scriptShots; await ss.remove(id); }, id);
    await sleep(500);
  });

  await check('desktop: a window too narrow for both columns keeps the shots beside, as a thin strip of pictures', async () => {
    await p.setViewportSize({ width: 980, height: 800 });
    await sleep(900);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-rail')));
    assert.equal(await p.locator('.ss-side .ss-thumb').count(), 10);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll');
    await p.setViewportSize({ width: 1400, height: 860 });
    await sleep(900);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-beside')));
  });

  await check('phone upright: beside as a thin strip; the sheet opens over the page and steps shot to shot', async () => {
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
    await p.waitForSelector('.ss-side .ss-thumb');
    await sleep(900);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-rail')));
    await p.locator(thumb(0, 1)).scrollIntoViewIfNeeded();
    await sleep(200);
    await noMove(() => tap(thumb(0, 1)), 'pick');
    await noMove(() => tap(thumb(0, 1)), 'open');
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
    const before = await p.locator('.ss-card, .ss-thumb').count();
    await add.locator('input').setInputFiles([1, 2, 3, 4, 5, 6].map((i) => ({ name: `frame${i}.png`, mimeType: 'image/png', buffer: PNG })));
    await p.waitForFunction(() => /6 pictures:/.test(document.querySelector('.toast')?.textContent || ''));
    const text = await p.locator('.toast').textContent();
    const made = Number((text.match(/(\d+) new shots?/) || [0, 0])[1]);
    assert.ok(/on shots? without one/.test(text) || made === 6, text);
    await p.waitForFunction((n) => document.querySelectorAll('.ss-card, .ss-thumb').length === n, before + made);
    await sleep(300);
    await snap('12-phone-pictures-in');
    await tap('.toast button');
    await p.waitForFunction((n) => document.querySelectorAll('.ss-card, .ss-thumb').length === n, before);
  });

  let madeHere = false;
  let placedId = null;
  await check('phone upright: an open shot’s Put on lines, then one tap in the margin puts it there, picked with its knobs', async () => {
    await p.evaluate(() => window.scrollTo(0, 0));
    const loose = (await shotsIn(0)).find((sh) => sh.from < 0);
    let id = loose?.id;
    madeHere = !id;
    if (!id) {
      // Make one that isn't on any lines yet.
      id = await p.evaluate(async () => { const ss = window.__scriptShots; const sh = await ss.add(ss.anchors()[0].eid, { focus: false }); ss.pick(null); return sh.id; });
      await sleep(600);
    }
    await tap(`.ss-side [data-shot="${id}"]`);
    await p.waitForSelector('.ss-banner:not([hidden])');
    await tap(`.ss-side [data-shot="${id}"]`);
    await p.locator('.ss-sheet .ss-act', { hasText: 'Put on lines' }).waitFor();
    await tap('.ss-sheet .ss-act >> text=Put on lines');
    assert.equal(await p.locator('.ss-sheet').count(), 0, 'the sheet steps aside');
    await p.waitForSelector('.ss-banner:not([hidden])');
    assert.match(await p.locator('.ss-banner').textContent(), /Tap the line shot \S+ belongs to/);
    await sleep(400);
    assert.ok(!(await p.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /belongs to/.test(t.textContent)))), 'the finger lifting off the button places nothing');
    assert.ok(await p.evaluate((id) => window.__scriptShots.placing === id, id), 'still waiting for its line');
    await snap('15-phone-put-on-lines');
    await tapMargin('Mara doesn’t look up');
    await p.waitForFunction(() => /is on 1 line\. Pull a knob/.test(document.querySelector('.toast')?.textContent || ''));
    assert.ok((await shotsIn(0)).find((sh) => sh.id === id).from >= 0, 'it is on the line now');
    assert.ok(await p.locator('.ss-banner').isHidden());
    assert.equal(await p.evaluate(() => window.__scriptShots.sel), id, 'it lands picked');
    assert.equal(await p.locator('.ss-knob:not([hidden])').count(), 2, 'its knobs show');
    assert.ok(await p.locator('.ss-bar').isHidden(), 'no bar on a picked frame');
    assert.equal(await p.evaluate(() => document.activeElement?.closest?.('.ProseMirror') ? 'editor' : 'not'), 'not', 'no caret, no keyboard');
    placedId = id;
  });

  await check('phone upright: with a finger: pull down from the top half of a one-line frame, pull up from just above it (Undo each)', async () => {
    const b0 = await block();
    assert.deepEqual([b0.kind, b0.n], ['shot', 1]);
    const { x } = await marginAt('Mara doesn’t look up');
    let me = await pbox(0, b0.from);
    const last = await pbox(0, b0.to + 2);
    // The first move decides: down holds the bottom end.
    await finger([[x, me.top + 4], [x, last.mid + 4]]);
    await toastSays(/now covers 2 lines/);
    assert.equal((await block()).n, 2);
    await undo();
    assert.equal((await block()).n, 1);
    // 18 px above the block still takes hold of its top end.
    me = await pbox(0, b0.from);
    const dip = await pbox(0, b0.from - 3);
    await finger([[x, me.top - 18], [x, dip.top - 8]]); // the end keeps its distance from the finger
    await toastSays(/now covers 3 lines/);
    const b1 = await block();
    assert.deepEqual([b1.from, b1.to], [b0.from - 3, b0.to], 'the dipstick, June’s line and this one');
    await snap('24-phone-pull');
    await undo();
    assert.deepEqual(await block(), b0);
  });

  await check('phone upright: a tap anywhere across the margin takes that line’s frame; hold and slide picks lines; a flick still scrolls', async () => {
    await p.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    const g = await p.locator('.ss-gut').boundingBox();
    const said = await pbox(0, 3);
    await p.touchscreen.tap(g.x + 3, said.mid);
    await sleep(300);
    const two = await p.evaluate(() => window.__scriptShots.sel);
    assert.ok(two, 'a frame is picked');
    assert.ok((await shotsIn(0)).find((sh) => sh.id === two).from <= 3, 'one that covers what June says');
    // Hold the margin, then slide: the bell, the stool and the waitress's line.
    const bell = await marginAt('A bell on the door');
    const walk = await marginAt('Long walk?');
    await finger([[bell.x, bell.y], [walk.x, walk.y]], { hold: 520 });
    let b = await block();
    assert.deepEqual([b.kind, b.from, b.to], ['pick', 0, 3]);
    assert.equal(await p.evaluate(() => window.__editor.isFocused), false, 'no keyboard');
    await snap('25-phone-margin-pick');
    // The bar over picked lines fits the phone, whatever it offers.
    assert.ok(await p.evaluate(() => { const ss = window.__scriptShots; const a = ss.block().a; ss.last = ss.ordered(a).at(-1)?.id; ss.paint(); return ss.last; }), 'a shot in that scene to move');
    await sleep(300);
    const bb = await p.locator('.ss-bar').boundingBox();
    assert.ok(bb && bb.x >= 0 && bb.x + bb.width <= 412, `the bar fits the screen (${Math.round(bb?.x)}..${Math.round(bb?.x + bb?.width)})`);
    assert.match(await p.locator('.ss-bar').textContent(), /\+ Shot\+ Picture(Move|Put) shot \S+ here/);
    await snap('30-phone-line-bar');
    // A quick flick down the margin (no hold) scrolls the page and picks nothing new.
    const y0 = await scrollY();
    const m = await marginAt('Eleven thousand steps');
    await finger([[m.x, m.y], [m.x, m.y - 220]]);
    assert.notEqual(await scrollY(), y0, 'the page scrolled');
    b = await block();
    assert.deepEqual([b.from, b.to], [0, 3], 'the pick is as it was');
    await p.evaluate(() => { window.__scriptShots.dropLines(); window.__scriptShots.pick(null); window.scrollTo(0, 0); });
    await sleep(300);
  });

  await check('phone upright: hold a frame, drag it onto a line, and it covers that line', async () => {
    await p.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    const list = await shotsIn(0);
    const sh = list.filter((x) => x.from >= 0).sort((a, b) => a.from - b.from)[0];
    const from = await p.locator(`.ss-side [data-shot="${sh.id}"]`).boundingBox();
    const to = await line('Is it broken broken').boundingBox();
    const cdp = await p.context().newCDPSession(p);
    const pt = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x + 30, from.y + 20) });
    await sleep(600);
    for (let i = 1; i <= 10; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from.x + 30 + ((to.x + 60 - from.x - 30) * i) / 10, from.y + 20 + ((to.y + to.height / 2 - from.y - 20) * i) / 10) });
      await sleep(30);
    }
    assert.equal(await p.locator('.ss-ghost').count(), 1, 'the frame follows the finger');
    assert.equal(await p.locator('.pop-menu').count(), 0, 'holding a frame opens no menu');
    await snap('16-phone-hold-drag');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForFunction(([id, was]) => { const ss = window.__scriptShots; const a = ss.anchors()[0]; const sh = ss.ordered(a).find((x) => x.id === id); return sh && a.paras.findIndex((x) => x.id === sh.fields?.from) !== was; }, [sh.id, sh.from], { timeout: 6000 }).catch(() => {});
    await toastSays(/now covers/);
    assert.notEqual((await shotsIn(0)).find((x) => x.id === sh.id).from, sh.from, 'it moved to the line');
    assert.equal(await doneIn(sh.id), false, 'a hold that slides moves the frame and ticks nothing');
    // The shot made for this check goes again, so the counts below stay as they were.
    if (madeHere && placedId) { await p.evaluate((id) => window.__scriptShots.remove(id), placedId); await sleep(600); }
    await p.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await sleep(400);
  });

  await check('phone upright: touch and hold a frame and let go: it is got; a short tap still only picks it', async () => {
    await p.evaluate(() => { window.__scriptShots.pick(null); window.scrollTo(0, 0); });
    await sleep(400);
    const id = await p.locator(thumb(0, 1)).getAttribute('data-shot');
    const b = await p.locator(thumb(0, 1)).boundingBox();
    const cdp = await p.context().newCDPSession(p);
    const pt = [{ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), id: 7 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await sleep(560);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForFunction((x) => document.querySelector(`.ss-side [data-shot="${x}"]`)?.classList.contains('got'), id);
    await sleep(500);
    assert.equal(await p.locator('.ss-sheet').count(), 0, 'the hold opens nothing');
    assert.equal(await p.locator('.ss-sgot').count(), 1, 'the scene line says how many are got');
    assert.match(await p.locator('.ss-sgot').textContent(), /^1 of \d+$/);
    await snap('29-phone-got');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await sleep(560);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForFunction((x) => !document.querySelector(`.ss-side [data-shot="${x}"]`)?.classList.contains('got'), id);
    await sleep(500);
    await noMove(() => tap(thumb(0, 1)), 'a tap picks');
    assert.equal(await doneIn(id), false, 'a tap ticks nothing');
    await p.evaluate(() => window.__scriptShots.pick(null));
  });

  await check('phone upright: tap a line, + Picture, Sketch, draw with a finger, Done: the frame is on that line', async () => {
    await p.evaluate(() => window.scrollTo(0, 0));
    const had = (await shotsIn(0)).map((sh) => sh.id);
    await tap(line('Dad would’ve checked'));
    await p.waitForSelector('.ss-bar:not([hidden]) .ss-barpic');
    // The bar can still change its buttons while the last check's reload
    // lands (a slow machine): wait until they hold still before tapping.
    await p.waitForFunction(() => new Promise((ok) => { const a = document.querySelector('.ss-bar')?.dataset.sig; const r0 = document.querySelector('.ss-bar .ss-barpic')?.getBoundingClientRect().x; setTimeout(() => ok(a && a === document.querySelector('.ss-bar')?.dataset.sig && r0 === document.querySelector('.ss-bar .ss-barpic')?.getBoundingClientRect().x), 400); }));
    await tap('.ss-bar .ss-barpic');
    await p.locator('.pop-menu .pop-item', { hasText: 'Sketch' }).waitFor();
    await tap(p.locator('.pop-menu .pop-item', { hasText: 'Sketch' }));
    await p.waitForSelector('.sk-pad canvas');
    const box = await p.locator('.sk-pad canvas').boundingBox();
    assert.ok(box.width >= 380, 'the pad takes the width of the phone');
    const cdp = await p.context().newCDPSession(p);
    const pt = (x, y) => [{ x: Math.round(box.x + box.width * x), y: Math.round(box.y + box.height * y), id: 3 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(0.2, 0.3) });
    for (let i = 1; i <= 8; i += 1) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(0.2 + i * 0.07, 0.3 + i * 0.05) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await p.evaluate(() => window.__sketchPad.pad.strokes.length), 1, 'one finger draws when there is no pen');
    // Two fingers tapped together: undo.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(0.5, 0.8) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(0.55, 0.8) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await p.evaluate(() => window.__sketchPad.pad.strokes.length), 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...pt(0.4, 0.5)[0], id: 4 }, { ...pt(0.6, 0.5)[0], id: 5 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await p.evaluate(() => window.__sketchPad.pad.strokes.length), 1, 'a two-finger tap undoes');
    await snap('20-phone-pad');
    await tap('.sk-pad .sk-btn.go');
    await p.waitForFunction(() => /with its sketch/.test(document.querySelector('.toast')?.textContent || ''));
    const made = (await shotsIn(0)).find((sh) => !had.includes(sh.id));
    assert.ok(made && made.from >= 0, 'on the tapped line');
    await p.evaluate(() => window.__scriptShots.close());
    await sleep(300);
    await snap('21-phone-sketch-in-script');
    await p.evaluate((id) => window.__scriptShots.remove(id), made.id);
    await sleep(600);
    await p.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await sleep(400);
  });

  await check('phone upright: one tap on Shots puts them away and one brings them back; ⋯ does the same', async () => {
    await tap('.zm-shots');
    await sleep(700);
    assert.equal(await p.locator('.pop-menu').count(), 0, 'no menu');
    assert.equal(await p.locator('.ss-side .ss-thumb').count(), 0, 'put away');
    await tap('.zm-shots');
    await p.waitForSelector('.ss-side .ss-thumb');
    await tap('.zm-more');
    await p.getByText('Put the shots away').waitFor();
    assert.equal(await p.getByText('one column').count(), 0);
    { const b = await p.getByText('Put the shots away').boundingBox(); await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); }
    await sleep(700);
    assert.equal(await p.locator('.ss-side .ss-thumb').count(), 0, 'put away from ⋯');
    await tap('.zm-more');
    await p.getByText('Shots beside the script').waitFor();
    { const b = await p.getByText('Shots beside the script').boundingBox(); await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); }
    await p.waitForSelector('.ss-side .ss-thumb');
  });

  await check('phone upright: beside is a thin strip of pictures, each level with its lines', async () => {
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
