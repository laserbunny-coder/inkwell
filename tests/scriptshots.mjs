// The script with its shots beside it (Nov 22 2026, Part 1: by scene). A
// Shots switch on a script (Alt + B) shows each scene's storyboard frames:
// beside the text on a computer with room, under each scene line in one
// column, a thin strip of pictures beside a phone held upright and two
// columns on a phone held sideways. A click picks a shot and a second opens
// it floating over the page; neither ever scrolls the page. Scenes go by
// their own names, never by slug lines. Shots added here are ordinary shots,
// so Make sees them.
//
// SHOTS_DIR=folder also saves dark-mode screenshots for the guide.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';
import { screenKind, sceneTitle, sceneName } from '../src/scenename.js';

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
const SHOT_LIST = [
  [['The truck alone on the flats, hood up.', 'Extreme wide, locked off', '#c9774f'], ['Mara in the engine, June on the tailgate behind her.', 'Two-shot, medium wide', '#7a8f6b'], ['The dipstick comes out dry.', 'Insert', '#8a6fa8'], ['June says it to her sister’s back.', 'Close-up, June', null], ['Mara, eyes down. She answers without looking up.', 'Close-up, Mara', null]],
  [['Two figures, the truck a dot, the line trailing behind them.', 'High wide', '#5d7f9e'], ['The stick cuts the crust. The camera tracks with it.', 'Low tracking insert', null], ['The sisters walk toward us, talking.', 'Walking two-shot, handheld', null]],
  [['The diner, alone in the heat.', 'Wide, outside', '#b0894f']]
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
}
// Shots under each scene, a few with a picture (a plain coloured frame).
async function addShots() {
  await p.evaluate(async (list) => {
    const ss = window.__scriptShots;
    const anchors = ss.anchors();
    for (let i = 0; i < list.length; i++) {
      for (const [what, framing, colour] of list[i]) {
        const sh = await ss.add(anchors[i].eid, { what, framing, focus: false });
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
const scrollY = () => p.evaluate(() => Math.round(window.scrollY));
async function noMove(act, label) {
  const before = await scrollY();
  const text = await p.locator('.wv-line >> nth=1').evaluate((e) => Math.round(e.getBoundingClientRect().top));
  await act();
  await sleep(500);
  assert.equal(await scrollY(), before, `${label}: the page scrolled`);
  assert.equal(await p.locator('.wv-line >> nth=1').evaluate((e) => Math.round(e.getBoundingClientRect().top)), text, `${label}: the script moved`);
}
async function tap(sel) {
  let b = await p.locator(sel).boundingBox();
  const vh = p.viewportSize().height;
  if (b.y < 0 || b.y + Math.min(b.height, 30) > vh) { await p.locator(sel).scrollIntoViewIfNeeded(); await sleep(150); b = await p.locator(sel).boundingBox(); }
  if (p.__touch) await p.touchscreen.tap(b.x + b.width / 2, b.y + Math.min(b.height / 2, 20));
  else await p.mouse.click(b.x + b.width / 2, b.y + Math.min(b.height / 2, 20));
}

try {
  p = await open({ viewport: { width: 1400, height: 860 } });

  await check('desktop: Shots shows only on a script, off at first, and the script is only text', async () => {
    await newPiece('New screenplay', 'Salt Road', 'Script');
    await saltRoad();
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-able')));
    assert.ok(await p.locator('.zm-shots').isVisible(), 'the Shots button is on the top line');
    assert.equal(await p.locator('.ss-side .ss-frame, .ss-strip').count(), 0);
    await addShots();
    assert.equal(await p.locator('.ss-side .ss-frame, .ss-strip').count(), 0, 'still put away');
  });

  await check('desktop: Alt + B puts each scene’s frames beside it, level with its line, and the words keep their place', async () => {
    await p.evaluate(() => window.scrollTo(0, 0));
    const wrap = await p.locator('#editor p[data-el="action"] >> nth=0').evaluate((e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]);
    await p.keyboard.press('Alt+b');
    await p.waitForSelector('.ss-side .ss-group');
    await sleep(900);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-beside')));
    assert.equal(await p.locator('.ss-side .ss-frame:not(.ss-add)').count(), 9);
    assert.equal(await p.locator('.ss-side .ss-add').count(), 3, '+ shot at the end of each scene');
    assert.deepEqual(await p.locator('#editor p[data-el="action"] >> nth=0').evaluate((e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]), wrap, 'the text column keeps its width');
    // Scene 2's frames start level with its line.
    const line = await p.locator('.wv-line >> nth=1').evaluate((e) => e.getBoundingClientRect().top);
    const group = await p.locator('.ss-group >> nth=1').evaluate((e) => e.getBoundingClientRect().top);
    assert.ok(Math.abs(line - group) < 2 || group > line, `scene 2's frames at ${Math.round(group)}, its line at ${Math.round(line)}`);
    assert.equal(await p.locator('.ss-group >> nth=1 >> .ss-code').first().textContent(), 'S02-01');
    assert.equal(await p.locator('.zm-shots').getAttribute('aria-pressed'), 'true');
    await snap('1-desktop-beside');
  });

  await check('desktop: one click picks a shot, a second opens it floating; nothing scrolls or moves', async () => {
    await p.evaluate(() => window.scrollTo(0, 260));
    await sleep(200);
    await noMove(() => tap('.ss-group >> nth=1 >> .ss-frame >> nth=0'), 'pick');
    assert.equal(await p.locator('.ss-side .ss-frame.sel').count(), 1);
    assert.equal(await p.locator('.ss-pop').count(), 0);
    await snap('2-desktop-picked');
    await noMove(() => tap('.ss-group >> nth=1 >> .ss-frame >> nth=0'), 'open');
    assert.equal(await p.locator('.ss-pop').count(), 1);
    assert.match(await p.locator('.ss-pop .ss-in').textContent(), /In Scene 2 · The walk/);
    assert.doesNotMatch(await p.locator('.ss-pop').textContent(), /EXT\./, 'no slug line in the open shot');
    await snap('3-desktop-open');
    // Typing in it changes the frame at once, with no redraw.
    const frame = p.locator('.ss-group >> nth=1 >> .ss-frame >> nth=0');
    const handle = await frame.elementHandle();
    await p.locator('.ss-pop .ss-what-in').fill('Two figures, small, the truck a dot behind.');
    assert.equal(await frame.locator('.ss-what').textContent(), 'Two figures, small, the truck a dot behind.');
    assert.ok(await handle.evaluate((e) => e.isConnected), 'the same frame, not drawn again');
    await noMove(() => p.keyboard.press('Escape'), 'close');
    assert.equal(await p.locator('.ss-pop').count(), 0);
    await sleep(700);
  });

  await check('desktop: + shot adds an ordinary shot that Make sees, with the next number', async () => {
    await tap('.ss-group >> nth=2 >> .ss-add');
    await p.waitForSelector('.ss-pop .ss-what-in');
    assert.equal(await p.evaluate(() => document.activeElement?.classList.contains('ss-what-in')), true, 'the caret is in What happens');
    await p.keyboard.type('Mara on the cordless, June asleep on the counter.');
    await p.keyboard.press('Enter');
    await sleep(800);
    assert.equal(await p.locator('.ss-group >> nth=2 >> .ss-frame:not(.ss-add)').count(), 2);
    assert.equal(await p.locator('.ss-group >> nth=2 >> .ss-code >> nth=1').textContent(), 'S03-02');
    const made = await p.evaluate(async () => { const ss = window.__scriptShots; const a = ss.anchors()[2]; const { shotsUnder } = { shotsUnder: null }; return (ss.shots.get(a.eid) || []).map((s) => [s.kind, s.text, s.fields.piece === ss.pieceId]); });
    assert.deepEqual(made.at(-1), ['shot', 'Mara on the cordless, June asleep on the counter.', true]);
  });

  await check('desktop: Remove sends a shot to the Trash, and Undo brings it back', async () => {
    await tap('.ss-group >> nth=2 >> .ss-frame >> nth=1');
    await tap('.ss-group >> nth=2 >> .ss-frame >> nth=1');
    await p.locator('.ss-pop .ss-act', { hasText: 'Remove' }).click();
    await sleep(500);
    assert.equal(await p.locator('.ss-group >> nth=2 >> .ss-frame:not(.ss-add)').count(), 1);
    await p.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(500);
    assert.equal(await p.locator('.ss-group >> nth=2 >> .ss-frame:not(.ss-add)').count(), 2);
  });

  await check('desktop: in the script (one column), a strip of frames under each scene line', async () => {
    await run('Shots: in the script');
    await p.waitForSelector('.ss-strip');
    await sleep(900);
    assert.equal(await p.locator('.ss-strip').count(), 3);
    assert.equal(await p.locator('.ss-side .ss-frame').count(), 0);
    assert.equal(await p.locator('.ss-strip >> nth=0 >> .ss-frame:not(.ss-add)').count(), 5);
    // The strip is under its scene's line, not in the words.
    const line = await p.locator('.wv-line >> nth=0').evaluate((e) => e.getBoundingClientRect().bottom);
    const strip = await p.locator('.ss-strip >> nth=0').evaluate((e) => e.getBoundingClientRect().top);
    assert.ok(strip >= line - 1, 'the strip comes after the scene line');
    await p.locator('.ss-strip >> nth=0').scrollIntoViewIfNeeded();
    await p.evaluate(() => window.scrollBy(0, -40));
    await sleep(200);
    await noMove(() => tap('.ss-strip >> nth=0 >> .ss-frame >> nth=1'), 'pick in the strip');
    await noMove(() => tap('.ss-strip >> nth=0 >> .ss-frame >> nth=1'), 'open in the strip');
    assert.equal(await p.locator('.ss-pop').count(), 1);
    await snap('4-desktop-column');
    await p.keyboard.press('Escape');
    // Typing in the script still works with the strips there.
    await p.locator('#editor p[data-el="action"] >> nth=0').click();
    await p.keyboard.press('End');
    await p.keyboard.type(' Wind.');
    assert.match(await p.locator('#editor p[data-el="action"] >> nth=0').textContent(), /sky\. Wind\.$/);
    await run('Shots: beside the script');
    await p.waitForSelector('.ss-side .ss-group');
  });

  await check('desktop: Alt + B puts them away again, and that is remembered for this script', async () => {
    await p.keyboard.press('Alt+b');
    await sleep(900);
    assert.equal(await p.locator('.ss-side .ss-frame, .ss-strip').count(), 0);
    assert.equal(await p.evaluate(() => localStorage.getItem(`shotsOn:${window.__scriptShots.pieceId}`)), null);
    await p.keyboard.press('Alt+b');
    await p.waitForSelector('.ss-side .ss-group');
    assert.equal(await p.evaluate(() => localStorage.getItem(`shotsOn:${window.__scriptShots.pieceId}`)), '1');
  });

  await check('desktop: Open in Make lands on that shot', async () => {
    await tap('.ss-group >> nth=0 >> .ss-frame >> nth=2');
    await tap('.ss-group >> nth=0 >> .ss-frame >> nth=2');
    const id = await p.locator('.ss-pop .ss-detail').getAttribute('data-shot');
    await p.locator('.ss-pop .ss-act', { hasText: 'Open in Make' }).click();
    await p.waitForFunction(() => document.documentElement.dataset.view === 'production');
    await p.waitForSelector(`#prod-view [data-shot="${id}"]`, { state: 'attached', timeout: 8000 });
    assert.equal(await p.locator('.ss-side .ss-frame').count(), 0, 'nothing of it stays in Make');
    await p.goBack();
    await p.waitForFunction(() => !document.documentElement.dataset.view);
    await p.waitForSelector('.ss-side .ss-group');
  });

  await check('desktop: Classic shows the same shots, scenes still by name', async () => {
    await run('Script view: Classic');
    await sleep(900);
    assert.equal(await p.locator('.ss-side .ss-group').count(), 3);
    const head = await p.locator('#editor p[data-el="scene"] >> nth=1').evaluate((e) => e.getBoundingClientRect().top);
    const group = await p.locator('.ss-group >> nth=1').evaluate((e) => e.getBoundingClientRect().top);
    assert.ok(Math.abs(head - group) < 2, 'level with its heading');
    await tap('.ss-group >> nth=1 >> .ss-frame >> nth=0');
    await tap('.ss-group >> nth=1 >> .ss-frame >> nth=0');
    assert.match(await p.locator('.ss-pop .ss-in').textContent(), /The walk/);
    await p.keyboard.press('Escape');
    await run('Script view: Woven');
    await sleep(600);
  });

  await check('desktop: a window too narrow for both columns puts the shots in the script', async () => {
    await p.setViewportSize({ width: 980, height: 800 });
    await sleep(900);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-column')));
    assert.equal(await p.locator('.ss-strip').count(), 3);
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
    await p.evaluate(() => window.__scriptShots.toggle());
    await p.waitForSelector('.ss-strip');
    await sleep(900);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-column')));
    await p.locator('.ss-strip >> nth=0').scrollIntoViewIfNeeded();
    await p.evaluate(() => window.scrollBy(0, 60));
    await sleep(200);
    await snap('5-phone-column');
    await noMove(() => tap('.ss-strip >> nth=0 >> .ss-frame >> nth=0'), 'pick');
    await noMove(() => tap('.ss-strip >> nth=0 >> .ss-frame >> nth=0'), 'open');
    assert.equal(await p.locator('.ss-sheet').count(), 1);
    assert.match(await p.locator('.ss-sheet .ss-where').textContent(), /Shot 1 of 9/);
    await snap('6-phone-sheet');
    await tap('.ss-sheet .ss-nav button[aria-label="Next shot"]');
    assert.match(await p.locator('.ss-sheet .ss-where').textContent(), /Shot 2 of 9/);
    await tap('.ss-sheet .ss-nav button[aria-label="Close"]');
    assert.equal(await p.locator('.ss-sheet').count(), 0);
  });

  await check('phone upright: beside is a thin strip of pictures down the right edge', async () => {
    await p.evaluate(() => window.__scriptShots.sitAt('beside'));
    await p.waitForSelector('.ss-side .ss-thumb');
    await sleep(900);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-rail')));
    const w = await p.locator('.ss-side').evaluate((e) => e.getBoundingClientRect().width);
    assert.ok(w < 90, `the strip is thin (${Math.round(w)}px)`);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll');
    await p.evaluate(() => window.scrollTo(0, 0));
    await snap('7-phone-rail');
    await noMove(() => tap('.ss-group >> nth=0 >> .ss-thumb >> nth=2'), 'pick a picture');
    await noMove(() => tap('.ss-group >> nth=0 >> .ss-thumb >> nth=2'), 'open it');
    assert.equal(await p.locator('.ss-sheet').count(), 1);
    await tap('.ss-sheet .ss-nav button[aria-label="Close"]');
  });

  await check('phone sideways: two real columns', async () => {
    await p.setViewportSize({ width: 915, height: 412 });
    await sleep(900);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('ss-sideways')));
    assert.equal(await p.locator('.ss-side .ss-frame:not(.ss-add)').count(), 9);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll');
    await p.evaluate(() => window.scrollTo(0, 0));
    await snap('8-phone-sideways');
    await tap('.ss-group >> nth=0 >> .ss-frame >> nth=0');
    await tap('.ss-group >> nth=0 >> .ss-frame >> nth=0');
    assert.equal(await p.locator('.ss-sheet.side').count(), 1, 'the sheet sits at the side');
    await snap('9-phone-sideways-open');
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
