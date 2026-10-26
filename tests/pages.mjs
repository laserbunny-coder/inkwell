// The workflow pages: the tabs in the top strip (hidden while writing, faint
// on pages you look at, full with Alt held, gone in focus), Alt + 0 to 6; a
// world's Overview; Gather with File into… and Go through; Shape (Bible,
// Timeline, Relationships, Promises; a piece's Develop page); Write; Revise
// (with a new draft from this one); Make (the stage board, kit, shoot days);
// Deliver (files, share, posting); the Today panel; the Drawer; and life
// projects. window.__claude stands in for Claude.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4196;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const asked = [];
function claude(body) {
  if (body.mode !== 'pages') return {};
  asked.push(body);
  if (body.task === 'gather') return { picks: body.items.map((i) => ({ id: i.id, home: /Kenji/.test(i.text) ? 'pg_kenji' : /drawer/.test(i.text) ? 'drawer' : '', why: /Kenji/.test(i.text) ? 'It’s about Kenji' : '' })) };
  if (body.task === 'drawer') return { fits: body.items.filter((i) => /ninja/i.test(i.text)).map((i) => ({ id: i.id, why: 'A ninja gag for the bunch' })) };
  if (body.task === 'timeline') return { events: [{ what: 'Kenji fails the audition', when: 'Year 1, spring', piece: 'pr_reel1', after: '' }] };
  if (body.task === 'ties') return { ties: [{ a: 'pg_kenji', b: 'pg_mom', label: 'mother and son', why: 'She drives him to the audition' }] };
  if (body.task === 'develop') return body.step === 'people' ? { text: '', people: [{ name: 'Kenji', wants: 'to be a ninja', against: 'stage fright', learns: 'to fail in public' }] } : { text: 'Kenji, nine, auditions for a ninja troupe and freezes; Mom bakes her way into the dojo.', people: [] };
  if (body.task === 'continuity') return { issues: [{ where: 'BREAKFAST', issue: 'Kenji is twelve here', canon: 'Reel 1: he is nine' }] };
  return {};
}
const fake = () => { window.__claude = (body) => window.__toClaude(body); };

const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = Date.now();
const row = (id, kind, parent_id, sort, extra = {}) => ({ id, kind, parent_id, sort, title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now, updated_at: now, ...extra });
const ref = (id, title) => ({ type: 'entryRef', attrs: { id, title } });
const line = (id, text, extra = {}) => row(id, 'line', `day-${today}`, extra.sort || 1024, { text, content: [{ type: 'text', text }], tags: [...text.matchAll(/#([\w-]+)/g)].map((m) => m[1]), fields: { done: false }, ...extra });
const para = (id, ch, sort, text, el) => row(id, 'para', ch, sort, { text, content: [{ type: 'text', text }], fields: { el } });

const SEED = [
  row('wd_nb', 'world', null, 1, { title: 'The Ninja Bunch', fields: { logline: 'A family bakery raises a troupe of hopeless ninjas.' } }),
  row('pg_chars', 'page', 'wd_nb', 1, { title: 'Characters' }),
  row('pg_kenji', 'page', 'pg_chars', 1, { title: 'Kenji', fields: { element: { type: 'character', look: 'Nine, red headband' } } }),
  row('pg_mom', 'page', 'pg_chars', 2, { title: 'Mom', fields: { element: { type: 'character', look: 'Short, calm, grey bun' } } }),
  row('pg_kenji-l1', 'line', 'pg_kenji', 1024, { text: 'Nine years old. Wants it more than anyone.', content: [{ type: 'text', text: 'Nine years old. Wants it more than anyone.' }] }),
  row('pr_reel1', 'project', 'wd_nb', 1, { title: 'Reel 1: The Audition', fields: { type: 'screenplay', stage: 'Posted', posting: { youtube: { url: 'https://youtu.be/reel1' } } } }),
  row('ac_1', 'act', 'pr_reel1', 1, { title: 'Screenplay' }),
  row('ch_1', 'chapter', 'ac_1', 1, { title: 'Script', fields: { words: 12 } }),
  para('pa_1', 'ch_1', 1024, 'INT. DOJO - DAY', 'scene'),
  para('pa_2', 'ch_1', 2048, 'Kenji, nine, freezes in front of the sensei.', 'action'),
  row('pr_reel2', 'project', 'wd_nb', 2, { title: 'Reel 2: Breakfast', fields: { type: 'screenplay', stage: 'Written' } }),
  row('ac_2', 'act', 'pr_reel2', 1, { title: 'Screenplay' }),
  row('ch_2', 'chapter', 'ac_2', 1, { title: 'Script', fields: { words: 9 } }),
  para('pb_1', 'ch_2', 1024, 'INT. BAKERY - MORNING', 'scene'),
  para('pb_2', 'ch_2', 2048, 'Mom flips pancakes with a katana.', 'action'),
  row('sd_1', 'shootday', 'pr_reel2', 1, { fields: { date: '2027-01-16', call: '07:30', place: 'Echo Park', scenes: [], notes: '' } }),
  row(`day-${today}`, 'day', null, 0, { title: today }),
  line('li_a', 'Kenji is scared of the dark ', { sort: 1024, content: [{ type: 'text', text: 'Kenji is scared of the dark ' }, ref('wd_nb', 'The Ninja Bunch')], links: ['wd_nb'], text: 'Kenji is scared of the dark The Ninja Bunch' }),
  line('li_b', 'Grandpa was a real ninja once ', { sort: 2048, content: [{ type: 'text', text: 'Grandpa was a real ninja once ' }, ref('wd_nb', 'The Ninja Bunch')], links: ['wd_nb'], text: 'Grandpa was a real ninja once The Ninja Bunch', created_at: now - 1000 }),
  line('li_c', 'A bakery theme song ', { sort: 3072, content: [{ type: 'text', text: 'A bakery theme song ' }, ref('wd_nb', 'The Ninja Bunch')], links: ['wd_nb'], text: 'A bakery theme song The Ninja Bunch', created_at: now - 2000 }),
  line('li_d', 'A ninja who only fights at breakfast #drawer', { sort: 4096 }),
  line('li_e', 'Haunted lighthouse film #drawer', { sort: 5120 })
];

const seed = (rows) => new Promise((res, rej) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => {
    const tx = r.result.transaction(['entries', 'outbox'], 'readwrite');
    for (const x of rows) { tx.objectStore('entries').put(x); tx.objectStore('outbox').put({ id: x.id }); }
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  };
});
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const get = async (p, id) => (await all(p)).find((r) => r.id === id);
const go = (p, place) => p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
const viewOf = (p) => p.evaluate(() => document.documentElement.dataset.view || 'write');
const tabs = (p) => p.locator('#page-tabs .pt-tab').evaluateAll((els) => els.map((e) => e.dataset.page + (e.classList.contains('on') ? '*' : '')));
const GATHER = '.st-cards:not(.st-drawer-cards) > .st-card';
const pick = async (p, label) => { await p.locator('.pop-menu .pop-item', { hasText: label }).first().click(); await sleep(250); };
const shown = (p) => p.evaluate(() => { const r = document.querySelector('.topbar').getBoundingClientRect(); return r.bottom > 2; });
const command = async (p, name) => {
  await p.keyboard.press('Control+K');
  await p.keyboard.type(name);
  await sleep(250);
  await p.keyboard.press('Enter');
  await sleep(400);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1360, height: 900 } });
await ctx.exposeFunction('__toClaude', claude);
await ctx.addInitScript(fake);
const page = await ctx.newPage();
page.errors = [];
page.on('pageerror', (e) => page.errors.push(e.message));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`); }
}
const SHOTS = process.env.SHOTS;
const shot = async (p, name) => { if (SHOTS) { await p.evaluate(() => document.querySelector(".toast")?.remove()); await sleep(250); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };

try {
  await page.goto(URL);
  await page.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
  await sleep(500);
  await page.evaluate(seed, SEED);
  await page.reload();
  await page.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
  await sleep(700);

  // ---------- the strip ----------

  await check('a world’s overview: its sentence, where its pieces are, what’s next and what was written lately', async () => {
    await go(page, { view: 'world', id: 'wd_nb' });
    await page.waitForSelector('#wh-next li button');
    assert.equal(await page.locator('#wh-logline').innerText(), 'A family bakery raises a troupe of hopeless ninjas.');
    const bar = await page.locator('#wh-stagebar .wh-stage:not([hidden])').allInnerTexts();
    assert.deepEqual(bar, ['Written 1', 'Posted 1']);
    const next = await page.locator('#wh-next').innerText();
    assert.match(next, /Gather\s*3 things in to file/);
    assert.match(next, /Shoot day Sat, Jan 16 · Reel 2: Breakfast/);
    assert.match(next, /Board Reel 2: Breakfast/);
    assert.match(await page.locator('#wh-recent').innerText(), /Reel 1: The Audition/);
    assert.ok(await page.locator('#wh-board-toggle').count() === 0);
  });

  await check('the tabs sit in the top strip: Overview, then Gather to Deliver, faint on a page you look at', async () => {
    assert.deepEqual(await tabs(page), ['overview*', 'gather', 'shape', 'write', 'revise', 'make', 'deliver']);
    await page.mouse.move(700, 500);
    await sleep(500);
    assert.ok(await shown(page));
    assert.ok(await page.evaluate(() => document.body.classList.contains('looking')));
    const op = await page.evaluate(() => getComputedStyle(document.querySelector('.topbar')).opacity);
    assert.ok(Number(op) < 0.8, op);
    await shot(page, 'pages-overview');
  });

  await check('holding Alt shows each tab’s number, and Alt + 1 opens Gather', async () => {
    await page.keyboard.down('Alt');
    await sleep(150);
    assert.ok(await page.locator('#page-tabs .pt-num').first().isVisible());
    await shot(page, 'pages-alt');
    await page.keyboard.press('Digit1');
    await page.keyboard.up('Alt');
    await page.waitForSelector('.st-card');
    assert.equal(await viewOf(page), 'stage');
    assert.deepEqual(await tabs(page), ['overview', 'gather*', 'shape', 'write', 'revise', 'make', 'deliver']);
    assert.match(await page.locator('#crumb').innerText(), /The Ninja Bunch ▾\s*›\s*Gather/);
  });

  // ---------- Gather ----------

  await check('Gather lists what came in from the days; File into… puts it on a bible page as a mirror', async () => {
    assert.equal(await page.locator(GATHER).count(), 3);
    await shot(page, 'pages-gather');
    await page.locator('.st-card[data-id="li_c"] .st-file').click();
    await pick(page, 'A new page…');
    await page.locator('.ask input').fill('Music');
    await page.locator('.ask .primary').click();
    await sleep(700);
    const rows = await all(page);
    const music = rows.find((r) => r.kind === 'page' && r.title === 'Music');
    assert.equal(music.parent_id, 'wd_nb');
    const mirror = rows.find((r) => r.parent_id === music.id && r.kind === 'line');
    assert.equal(mirror.fields.mirror, 'li_c');
    assert.deepEqual(rows.find((r) => r.id === 'li_c').fields.filed, [music.id]);
    assert.equal(await page.locator(GATHER).count(), 2);
    await page.locator('.st-chips .chip[data-sub="filed"]').click();
    await page.waitForSelector('.st-card[data-id="li_c"] .st-went');
    assert.match(await page.locator('.st-card[data-id="li_c"] .st-went').innerText(), /→ Music/);
    await page.locator('.st-chips .chip[data-sub="open"]').click();
    await sleep(300);
  });

  await check('Go through: one at a time, with Claude’s pick of a home; nothing moves without a tap', async () => {
    await page.locator('.st-tools .pill', { hasText: 'Go through' }).click();
    await page.waitForSelector('.st-walk-acts .primary');
    assert.match(await page.locator('.st-walk-n').innerText(), /1 of 2/);
    assert.match(await page.locator('.st-walk-acts .primary').innerText(), /File into Kenji/);
    assert.equal(asked.at(-1).task, 'gather');
    assert.ok(asked.at(-1).homes.some((h) => h.id === 'pg_kenji'));
    await shot(page, 'pages-go-through');
    await page.locator('.st-walk-acts .primary').click();
    await page.waitForFunction(() => /2 of 2/.test(document.querySelector('.st-walk-n')?.textContent || ''));
    const k = (await all(page)).find((r) => r.parent_id === 'pg_kenji' && r.fields?.mirror === 'li_a');
    assert.ok(k, 'filed on Kenji');
    await page.locator('.st-walk-acts button', { hasText: 'Let go' }).click();
    await page.waitForSelector('.st-walk-done');
    assert.equal((await get(page, 'li_b')).fields.letgo, true);
    assert.ok(!(await get(page, 'li_b')).deleted);
    await page.locator('.st-walk .pill', { hasText: 'Done' }).click();
    await sleep(300);
  });

  await check('the drawer shelf in Gather: Claude picks ideas that fit; pulling one in links it and leaves it in the drawer', async () => {
    await page.locator('.st-drawer-shelf button', { hasText: 'Which fit here?' }).click();
    await page.waitForSelector('.st-drawer-cards .st-card.fits');
    assert.equal(await page.locator('.st-drawer-cards .st-card.fits').getAttribute('data-id'), 'li_d');
    await page.locator('.st-drawer-cards .st-card.fits button', { hasText: 'Pull in' }).click();
    await sleep(500);
    const r = await get(page, 'li_d');
    assert.deepEqual(r.fields.pulled, ['wd_nb']);
    assert.ok(r.tags.includes('drawer'));
    await page.waitForSelector('.st-cards:not(.st-drawer-cards) .st-card[data-id="li_d"]');
  });

  // ---------- Shape ----------

  await check('Shape is canon: the bible, with a line from the Today panel dropped onto a page filed there', async () => {
    await page.keyboard.press('Alt+Digit2');
    await page.waitForSelector('.st-bible li');
    assert.deepEqual(await tabs(page), ['overview', 'gather', 'shape*', 'write', 'revise', 'make', 'deliver']);
    const bible = await page.locator('.st-bible').innerText();
    assert.match(bible, /Characters[\s\S]*Kenji[\s\S]*Mom[\s\S]*Music/);
    await page.keyboard.press('Control+Shift+J');
    await page.waitForSelector('.today-panel .tp-line');
    await page.locator('.today-panel .tp-line[data-id="li_e"]').dragTo(page.locator('.st-bible li[data-id="pg_mom"]'));
    await sleep(600);
    assert.ok((await all(page)).some((r) => r.parent_id === 'pg_mom' && r.fields?.mirror === 'li_e'));
    await shot(page, 'pages-shape-bible');
  });

  await check('the Today panel: today’s lines beside anything, and a line added there lands on today', async () => {
    const add = page.locator('.today-panel .tp-add');
    await add.fill('Call the bakery about the shoot');
    await add.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.today-panel .tp-line')].some((b) => b.textContent === 'Call the bakery about the shoot'));
    const r = (await all(page)).find((x) => x.text === 'Call the bakery about the shoot');
    assert.equal(r.parent_id, `day-${today}`);
    await shot(page, 'pages-today-panel');
    await page.keyboard.press('Control+Shift+J');
    assert.ok(await page.locator('.today-panel').isHidden());
  });

  await check('the timeline: events in story order, with Claude finding them in the pieces', async () => {
    await page.locator('.st-chips .chip[data-sub="timeline"]').click();
    await page.locator('.st-tools button', { hasText: 'Find events' }).click();
    await page.waitForSelector('.st-suggest li');
    await page.locator('.st-suggest li button', { hasText: 'Add' }).click();
    await page.waitForSelector('.st-ev');
    const ev = (await all(page)).find((r) => r.kind === 'event');
    assert.equal(ev.title, 'Kenji fails the audition');
    assert.equal(ev.fields.piece, 'pr_reel1');
    assert.ok(await page.locator('.st-ev.canon').count() === 1, 'posted pieces are canon');
    await shot(page, 'pages-timeline');
  });

  await check('relationships: the characters in a ring, Claude’s suggested ties kept with a tap', async () => {
    await page.locator('.st-chips .chip[data-sub="ties"]').click();
    await page.waitForSelector('.st-web .st-node');
    assert.equal(await page.locator('.st-web .st-node').count(), 2);
    await page.locator('.st-tools button', { hasText: 'Suggest ties' }).click();
    await page.waitForSelector('.st-edge.sug', { state: 'attached' });
    await shot(page, 'pages-relationships');
    await page.locator('.st-suggest li button', { hasText: 'Keep' }).click();
    await page.waitForSelector('.st-ties li');
    const t = (await all(page)).find((r) => r.kind === 'tie');
    assert.deepEqual([t.fields.a, t.fields.b, t.title], ['pg_kenji', 'pg_mom', 'mother and son']);
  });

  await check('Arcs opens the world’s plot grid, still on the Shape tab', async () => {
    await page.locator('.st-chips .chip[data-sub="arcs"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'grid');
    await sleep(400);
    assert.deepEqual(await tabs(page), ['overview', 'gather', 'shape*', 'write', 'revise', 'make', 'deliver']);
  });

  // ---------- Make, Deliver, Revise at the size of the world ----------

  await check('Make for the world: the stage board, the kit and every shoot day', async () => {
    await page.keyboard.press('Alt+Digit5');
    await page.waitForSelector('#st-board .sb-card');
    assert.equal(await page.locator('.sb-col[data-stage="Posted"] .sb-card').count(), 1);
    await shot(page, 'pages-make-board');
    await page.locator('.st-chips .chip[data-sub="kit"]').click();
    await page.waitForSelector('.st-kit-el');
    assert.match(await page.locator('.st-body').innerText(), /Characters · 2[\s\S]*Kenji[\s\S]*Nine, red headband/i);
    await page.locator('.st-chips .chip[data-sub="days"]').click();
    await page.waitForSelector('.st-days li');
    assert.match(await page.locator('.st-days').innerText(), /Sat, Jan 16, 2027 · call 07:30\s*Reel 2: Breakfast · Echo Park/);
  });

  await check('Deliver for the world: what’s ready to post and what’s posted, with its links', async () => {
    await page.keyboard.press('Alt+Digit6');
    await page.waitForSelector('.st-posted');
    const t = await page.locator('.st-body').innerText();
    assert.match(t, /Posted[\s\S]*Reel 1: The Audition[\s\S]*Youtube/i);
  });

  await check('Revise for the world: continuity checked against canon, by Claude', async () => {
    await page.keyboard.press('Alt+Digit4');
    await page.waitForSelector('.st-continuity .pill');
    await page.locator('.st-continuity .pill').click();
    await page.waitForSelector('.st-issues li');
    assert.match(await page.locator('.st-issues').innerText(), /Kenji is twelve here[\s\S]*Canon: Reel 1: he is nine/);
    const b = asked.at(-1);
    assert.equal(b.task, 'continuity');
    assert.equal(b.canon[0].title, 'Reel 1: The Audition');
    assert.equal(b.piece.title, 'Reel 2: Breakfast');
  });

  // ---------- a piece ----------

  await check('a piece has the same tabs; Shape is its Develop page, small to big, with Claude growing a step', async () => {
    await go(page, { view: 'project', id: 'pr_reel2' });
    await sleep(500);
    assert.deepEqual(await tabs(page), ['overview*', 'gather', 'shape', 'write', 'revise', 'make', 'deliver']);
    await page.keyboard.press('Alt+Digit2');
    await page.waitForSelector('.st-dev');
    const ta = page.locator('.st-dev[data-step="sentence"] textarea');
    await ta.fill('Mom cooks breakfast with a sword.');
    await ta.blur();
    await sleep(400);
    assert.equal((await get(page, 'pr_reel2')).fields.develop.sentence, 'Mom cooks breakfast with a sword.');
    await page.locator('.st-dev[data-step="paragraph"] button', { hasText: 'Grow it' }).click();
    await page.waitForSelector('.st-dev[data-step="paragraph"] .st-offer');
    await shot(page, 'pages-develop');
    await page.locator('.st-dev[data-step="paragraph"] .st-offer .pill').click();
    await sleep(400);
    assert.match((await get(page, 'pr_reel2')).fields.develop.paragraph, /freezes/);
    assert.equal(asked.at(-1).develop.sentence, 'Mom cooks breakfast with a sword.');
  });

  await check('Make for a piece is production without Posting; Deliver has Files, Share and Posting', async () => {
    await page.keyboard.press('Alt+Digit5');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'production');
    await page.waitForSelector('.prod-view .gv-levels .chip');
    { const t = await page.locator('.prod-view .gv-levels .chip').allInnerTexts(); assert.deepEqual(t, ['Shots', 'Storyboard', 'Kit', 'Shoot days'], JSON.stringify(t)); }
    await page.keyboard.press('Alt+Digit6');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'deliver');
    await page.waitForSelector('.prod-view .gv-levels .chip[data-tab="files"]');
    assert.deepEqual(await page.locator('.prod-view .gv-levels .chip').allInnerTexts(), ['Files', 'Share', 'Posting']);
    assert.match(await page.locator('.pd-files').innerText(), /Print or PDF[\s\S]*Fountain[\s\S]*Shot list[\s\S]*subtitles/);
    await shot(page, 'pages-deliver');
    await page.locator('.prod-view .gv-levels .chip[data-tab="post"]').click();
    await page.waitForSelector('.pd-post-card');
    assert.match(await page.locator('#crumb').innerText(), /Deliver/);
  });

  await check('new draft from this one: a copy is kept as the draft, the text you carry on in keeps its ids', async () => {
    await page.keyboard.press('Alt+Digit4');
    await page.waitForSelector('.st-tool[data-action="draft-from"]');
    await shot(page, 'pages-revise');
    await page.locator('.st-tool[data-action="draft-from"]').click();
    await page.locator('.ask .primary').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === undefined || !document.documentElement.dataset.view);
    await sleep(600);
    const rows = await all(page);
    const draft = rows.find((r) => r.kind === 'draft' && r.parent_id === 'pr_reel2');
    assert.equal(draft.title, 'Draft 1');
    const act = rows.find((r) => r.kind === 'act' && r.parent_id === draft.id);
    const ch = rows.find((r) => r.kind === 'chapter' && r.parent_id === act.id);
    const copies = rows.filter((r) => r.parent_id === ch.id).map((r) => r.text);
    assert.deepEqual(copies.sort(), ['INT. BAKERY - MORNING', 'Mom flips pancakes with a katana.']);
    assert.equal((await get(page, 'pb_2')).parent_id, 'ch_2', 'the live text stays put');
    assert.equal((await get(page, 'pr_reel2')).fields.draft, 2);
  });

  await check('writing: the strip never shows, comes back at the top edge, and is gone in focus', async () => {
    assert.equal(await viewOf(page), 'write');
    assert.ok(!(await shown(page)), 'hidden while writing');
    await page.mouse.move(700, 4);
    await sleep(400);
    assert.ok(await shown(page), 'back at the top edge');
    assert.ok(await page.locator('#page-tabs').isVisible());
    assert.deepEqual(await tabs(page), ['overview', 'gather', 'shape', 'write*', 'revise', 'make', 'deliver']);
    await page.mouse.move(700, 500);
    await sleep(400);
    await page.keyboard.press('Control+.');
    await sleep(300);
    await page.keyboard.down('Alt');
    await sleep(150);
    assert.ok(await page.locator('#page-tabs').isHidden(), 'no tabs in focus');
    await page.keyboard.up('Alt');
    await page.keyboard.press('Control+.');
    await sleep(300);
  });

  // ---------- the desk ----------

  await check('the Drawer: ideas with no home, by month; pull one into a world, or take it out', async () => {
    await command(page, 'The Drawer');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'drawer');
    await page.waitForSelector('.st-drawer .st-card');
    assert.deepEqual(await tabs(page), ['today', 'drawer*', 'library', 'tags']);
    assert.equal(await page.locator('.st-drawer .st-card').count(), 2);
    assert.match(await page.locator('.st-drawer .st-card[data-id="li_d"] .st-went').innerText(), /→ The Ninja Bunch/);
    await shot(page, 'pages-drawer');
    await page.locator('.st-drawer .st-card[data-id="li_e"] button', { hasText: 'Out of the drawer' }).click();
    await sleep(500);
    const r = await get(page, 'li_e');
    assert.ok(!r.tags.includes('drawer'));
    assert.equal(r.text, 'Haunted lighthouse film');
    assert.equal(await page.locator('.st-drawer .st-card').count(), 1);
  });

  // ---------- life projects ----------

  await check('a life project: Overview, Gather and Notes only, tasks to Daybook, and never shared', async () => {
    await page.click('#page-tabs .pt-tab[data-page="library"]');
    await sleep(400);
    await page.evaluate(() => document.querySelector('[data-cmd="new-book"], #lib-new-btn')?.click());
    await page.evaluate(() => { document.querySelector('#lib-new').hidden = false; });
    await page.locator('.lib-shape[data-shape="life"]').click();
    await page.fill('#lib-new-title', 'Kitchen remodel');
    await page.locator('#lib-new .pill').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'world');
    await sleep(500);
    const w = (await all(page)).find((r) => r.kind === 'world' && r.title === 'Kitchen remodel');
    assert.equal(w.fields.life, true);
    assert.deepEqual(await tabs(page), ['overview*', 'gather', 'notes']);
    assert.ok(await page.locator('#wh-stagebar').isHidden());
    assert.ok(await page.locator('#wh-task-box').isVisible());
    await shot(page, 'pages-life');
    await page.keyboard.press('Alt+Digit2');
    await page.waitForSelector('.st-body[data-page="notes"]');
    assert.match(await page.locator('.st-head').innerText(), /notes/i);
    await go(page, { view: 'world', id: w.id });
    await sleep(400);
    await page.locator('#wh-more .more-btn').click();
    await pick(page, 'Meeting notes go here');
    await pick(page, 'Business meetings');
    await sleep(300);
    assert.deepEqual((await get(page, w.id)).fields.meetings, ['business']);
  });

  await check('no page errors', async () => {
    assert.deepEqual(page.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
