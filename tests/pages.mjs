// The workflow pages: the tabs in the top strip (hidden while writing, faint
// on pages you look at, full with Alt held, gone in focus), Alt + 0 to 6; a
// world's Overview; Gather with File into… and Go through; Shape (Bible,
// Timeline, Relationships, Promises; a piece's Develop page); Write; Revise
// (with a new draft from this one); Make (the stage board, kit, shoot days);
// Deliver (files, share, posting); the Today panel; the Drawer; and life
// projects. window.__claude stands in for Claude.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4196;
const server = await serve(PORT);
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
// A project is one outline (Nov 2026): no strip; a part zoomed into says its plain name.
const partTitle = (p) => p.locator('#stage-view .st-title').innerText();
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

const browser = withoutSync(await chromium.launch());
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

  await check('a world’s home: its sentence and one outline that says what’s in each part', async () => {
    await go(page, { view: 'world', id: 'wd_nb' });
    await page.waitForSelector('#wh-outline [data-part="ideas"] .wo-meta');
    assert.equal(await page.locator('#wh-logline').innerText(), 'A family bakery raises a troupe of hopeless ninjas.');
    assert.deepEqual(await page.locator('#wh-outline > li > .wo-row > .wo-name').allInnerTexts(), ['Ideas', 'Bible', 'Pieces', 'Make', 'Deliver', 'About']);
    assert.match(await page.locator('#wh-outline [data-part="ideas"] .wo-row').innerText(), /Ideas\s*3\s*to sort/);
    assert.match(await page.locator('#wh-outline [data-part="pieces"] .wo-meta').innerText(), /1 writing · 1 posted/i);
    assert.match(await page.locator('#wh-outline [data-part="make"] .wo-meta').innerText(), /1 shoot day/);
    assert.ok(await page.locator('#page-tabs').isHidden(), 'no page strip for a project');
  });

  await check('one button moves a piece on to its next status, on the board and on the piece; Undo takes it back', async () => {
    // Pieces, zoomed into: By stage shows the board, worded as what is happening.
    await page.evaluate(() => window.__go({ view: 'stage', id: history.state.id, page: 'write' })); // the Pieces zoom (One home: one piece is drawn as that piece)
    await page.locator('#wh-as').click();
    await page.waitForSelector('#wh-pieces', { state: 'detached' }); // the board takes the list’s place
    await page.waitForSelector('.stage-board:visible .sb-card');
    const cols = await page.locator('.stage-board:visible .sb-col').evaluateAll((els) => els.filter((c) => c.querySelector('.sb-card')).map((c) => `${c.dataset.stage} ${c.querySelectorAll('.sb-card').length}`));
    assert.deepEqual(cols, ['Writing 1', 'Posted 1']);
    // The way on shows when you point at a piece.
    await page.locator('.stage-board:visible .sb-card[data-id="pr_reel2"]').hover();
    await page.waitForSelector('.stage-board:visible .sb-card[data-id="pr_reel2"] .sb-next');
    assert.match(await page.locator('.stage-board:visible .sb-card[data-id="pr_reel2"] .sb-next').innerText(), /^Start boarding/);
    // The last status has nowhere to go.
    assert.equal(await page.locator('.stage-board:visible .sb-card[data-id="pr_reel1"] .sb-next').count(), 0);
    await shot(page, 'status-board');
    await page.locator('.stage-board:visible .sb-card[data-id="pr_reel2"] .sb-next').click();
    await page.waitForSelector('.stage-board:visible .sb-col[data-stage="Boarding"] .sb-card[data-id="pr_reel2"]');
    assert.equal((await get(page, 'pr_reel2')).fields.stage, 'Boarding');
    assert.match(await page.locator('.toast').innerText(), /Reel 2: Breakfast: Boarding/);
    await page.locator('.toast button', { hasText: 'Undo' }).click();
    await page.waitForSelector('.stage-board:visible .sb-col[data-stage="Writing"] .sb-card[data-id="pr_reel2"]');
    assert.equal((await get(page, 'pr_reel2')).fields.stage, 'Written');
    // On the piece (One home): the top of its Outline.
    await go(page, { view: 'grid', id: 'pr_reel2', mode: 'outline' });
    await page.waitForSelector('.ph1-next');
    assert.equal(await page.locator('.ph1-word').innerText(), 'Writing');
    assert.equal(await page.locator('.ph1-next').innerText(), '→ Start boarding');
    await shot(page, 'status-piece');
    await page.locator('.ph1-next').click();
    await page.waitForFunction(() => document.querySelector('.ph1-word')?.textContent === 'Boarding');
    assert.equal(await page.locator('.ph1-next').innerText(), '→ Start generating');
    await page.locator('.toast button', { hasText: 'Undo' }).click();
    await page.waitForFunction(() => document.querySelector('.ph1-word')?.textContent === 'Writing');
    await go(page, { view: 'stage', id: 'wd_nb', page: 'write' });
    await page.waitForSelector('.stage-board:visible .sb-card');
    // As a list again.
    await page.locator('#wh-as').click();
    await page.waitForSelector('#wh-pieces li');
  });

  await check('a piece has no row of tabs: it opens on its text, with ‹ its project at the top', async () => {
    await go(page, { view: 'project', id: 'pr_reel2' });
    await page.waitForFunction(() => !document.documentElement.dataset.view);
    await page.mouse.move(700, 4);
    await page.waitForFunction(() => /‹\s*The Ninja Bunch/.test(document.querySelector('#crumb')?.textContent || ''));
    assert.ok(await page.locator('#page-tabs').isHidden(), 'no strip in a piece');
    await shot(page, 'pages-overview');
  });

  await check('in a project, Alt + 1 zooms into Ideas (Gather’s page, by its plain name)', async () => {
    await go(page, { view: 'world', id: 'wd_nb' });
    await page.waitForSelector('#wh-outline [data-part="ideas"]');
    await page.keyboard.press('Alt+Digit1');
    await page.waitForSelector('.st-card');
    assert.equal(await viewOf(page), 'stage');
    assert.equal(await partTitle(page), 'Ideas');
    assert.match(await page.locator('#crumb').innerText(), /The Ninja Bunch ▾\s*›\s*Ideas/);
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
    assert.equal(await partTitle(page), 'Bible');
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
    assert.match(await page.locator('#crumb').innerText(), /The Ninja Bunch/);
  });

  // ---------- Make, Deliver, Revise at the size of the world ----------

  await check('Make for the world: tools only, Cast and places and every shoot day (the status board lives in Pieces)', async () => {
    await go(page, { view: 'world', id: 'wd_nb' });
    await page.waitForSelector('#wh-outline [data-part="make"]');
    await page.keyboard.press('Alt+Digit4');
    await page.waitForSelector('.st-chips .chip[data-sub="looks"]');
    assert.deepEqual(await page.locator('.st-chips .chip').evaluateAll((els) => els.map((e) => e.dataset.sub)), ['looks', 'days']);
    assert.equal(await page.locator('#st-board').count(), 0);
    // Make opens on Cast and places; a name opens what's written about them.
    await page.waitForSelector('.st-chips .chip[data-sub="looks"].on');
    await page.locator('#stage-view .lw-row[data-row="pg_kenji"] .lw-name').click();
    await page.waitForSelector('#stage-view .cd[data-element="pg_kenji"]');
    await shot(page, 'pages-make-tools');
    // His locked look (written before the look wall) shows under For AI tools.
    const vals = await page.locator('#stage-view .cd[data-element="pg_kenji"] input, #stage-view .cd[data-element="pg_kenji"] textarea').evaluateAll((xs) => xs.map((x) => x.value));
    assert.ok(vals.includes('Nine, red headband'), vals.join(' | '));
    await page.locator('#stage-view .cd[data-element="pg_kenji"] .cd-close').click();
    await page.locator('.st-chips .chip[data-sub="days"]').click();
    await page.waitForSelector('.st-days li');
    assert.match(await page.locator('.st-days').innerText(), /Sat, Jan 16, 2027 · call 07:30\s*Reel 2: Breakfast · Echo Park/);
  });

  await check('Deliver for the world: what’s ready to post and what’s posted, with its links', async () => {
    await page.keyboard.press('Alt+Digit5');
    await page.waitForSelector('.st-posted');
    const t = await page.locator('.st-body').innerText();
    assert.match(t, /Out in the world[\s\S]*Reel 1: The Audition[\s\S]*Youtube/i);
  });

  await check('Continuity for the world (under Pieces): checked against canon, by Claude', async () => {
    await page.keyboard.press('Alt+Digit3');
    await page.locator('.st-more-link', { hasText: 'Continuity' }).click();
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
    // The Develop page lives on behind the Outline head's "Grow it with Claude".
    await go(page, { view: 'stage', id: 'pr_reel2', page: 'shape' });
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

  await check('Make for a piece is production without Posting; Deliver is one page: the script, for the edit, out', async () => {
    await go(page, { view: 'production', id: 'pr_reel2' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'production');
    await page.waitForSelector('.prod-view .gv-levels .chip');
    { const t = await page.locator('.prod-view .gv-levels .chip').allInnerTexts(); assert.deepEqual(t, ['Shots', 'Storyboard', 'Cast and places', 'Shoot days'], JSON.stringify(t)); }
    await go(page, { view: 'deliver', id: 'pr_reel2' });
    await page.waitForFunction(() => document.documentElement.dataset.view === 'deliver');
    await page.waitForSelector('.pd-group[data-group="out"]');
    assert.equal(await page.locator('.prod-view .gv-levels .chip:visible').count(), 0, 'no tabs');
    assert.deepEqual(await page.locator('.pd-group-h').allInnerTexts(), ['The script', 'For the edit', 'Out']);
    assert.match(await page.locator('.pd-group[data-group="edit"]').innerText(), /Hand-off for Resolve/);
    await shot(page, 'pages-deliver');
    assert.match(await page.locator('#crumb').innerText(), /Deliver/);
  });

  await check('new draft from this one: a copy is kept as the draft, the text you carry on in keeps its ids', async () => {
    await go(page, { view: 'stage', id: 'pr_reel2', page: 'revise' });
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

  await check('writing: the bar and the tabs stay where they are', async () => {
    assert.equal(await viewOf(page), 'write');
    await page.mouse.move(700, 500);
    await sleep(400);
    assert.ok(await shown(page), 'the bar stays while writing');
    assert.ok(await page.locator('#page-tabs').isHidden(), 'no row of tabs in a piece (One home)');
    assert.ok(await page.locator('.pv-seg').isVisible(), 'Outline · Write · Grid instead');
  });

  // ---------- the desk ----------

  await check('the Drawer: ideas with no home, by month; pull one into a world, or take it out', async () => {
    await command(page, 'The Drawer');
    await page.waitForFunction(() => document.documentElement.dataset.view === 'drawer');
    await page.waitForSelector('.st-drawer .st-card');
    // Out on the desk there are no page tabs: Drawer is lit in the Library's switch instead.
    assert.deepEqual(await tabs(page), []);
    assert.ok(await page.locator('#page-tabs').isHidden());
    assert.equal(await page.locator('#drawer-toggle').getAttribute('aria-current'), 'page');
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

  await check('one place for each thing: a page that isn’t a day has no Today or calendar of its own', async () => {
    await go(page, { view: 'notebook', pageId: 'pg_kenji' });
    await page.waitForFunction(() => document.querySelector('#nb-title')?.textContent === 'Kenji');
    assert.ok(await page.locator('#nb-today').isHidden());
    assert.ok(await page.locator('.nb-date').isHidden());
    // A bible page belongs to its project: no strip, the ruler's Project stop is lit.
    assert.ok(await page.locator('#page-tabs').isHidden());
    assert.equal(await page.locator('.zm-stop[data-stop="project"]').getAttribute('aria-current'), 'page');
  });

  // ---------- life projects ----------

  await check('a life project: Overview, Gather and Notes only, steps for tasks, and never shared', async () => {
    await page.evaluate(() => document.querySelector('#library-toggle').click());
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
    assert.deepEqual(await page.locator('#wh-outline > li > .wo-row > .wo-name').allInnerTexts(), ['Ideas', 'Notes', 'About']);
    assert.equal(await page.locator('#wh-task-box').count(), 0, 'no Daybook box: Daybook is retired');
    assert.ok(await page.locator('#wh-next-row').isVisible());
    await shot(page, 'pages-life');
    await page.keyboard.press('Alt+Digit2');
    await page.waitForSelector('.st-body[data-page="notes"]');
    assert.equal(await partTitle(page), 'Notes');
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
