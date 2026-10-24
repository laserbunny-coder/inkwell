// The day review: Ctrl + K on a day page asks Claude to look back over it.
// A few sentences on the day, then a card for each thread with a choice: Add
// to Daybook (words and area editable first), Keep thinking (onto the "Still
// thinking about" page, with a link back), Split into parts, or Let go.
// Things still being mulled come back in later reviews, and the 9 pm note's
// link (?review=<date>) opens a day's review. window.__claude stands in for
// Claude, window.__daybook for Daybook's table and window.__areas for its areas.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4191;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const tasks = new Map();
const asked = [];
function daybook(task) { tasks.set(task.id, { ...tasks.get(task.id), ...task }); return true; }
function claude(body) {
  if (body.mode !== 'review') return {};
  asked.push(body);
  const find = (re) => body.lines.find((l) => re.test(l.text))?.id;
  if (body.mulling?.length && !find(/Dana/)) {
    return { summary: 'A short day. You wrote about the bakery again.', threads: [], still: [{ id: body.mulling[0].id, note: 'You came back to it today.' }] };
  }
  const dana = find(/Dana/), bakery = find(/bakery/), ramble = find(/ramble/);
  return {
    summary: 'You spent the day on The Ninja Bunch: storyboards, a new idea for where the ninjas grew up, and a list of odds and ends.\n\nBy evening you were tired.',
    threads: [
      dana && { title: 'Storyboards with Dana', gist: 'Talk to Dana before Friday.', lines: [dana], suggest: 'daybook', task: { title: 'Call Dana about the storyboards', area_id: 'area-film' }, parts: [] },
      bakery && { title: 'Ninjas raised by a bakery', gist: 'A backstory idea.', lines: [bakery], suggest: 'mull', task: { title: 'Develop the bakery backstory', area_id: '' }, parts: [] },
      ramble && { title: 'Odds and ends', gist: 'Three separate things.', lines: [ramble], suggest: 'split', task: { title: 'Odds and ends', area_id: '' }, parts: [
        { title: 'Fix the bike', gist: '', lines: [ramble], suggest: 'daybook', task: { title: 'Fix the bike', area_id: 'area-personal' } },
        { title: 'Sea shanty theme song', gist: '', lines: [ramble], suggest: 'mull', task: { title: 'Try a sea shanty theme', area_id: '' } },
        { title: 'More SD cards', gist: '', lines: [ramble], suggest: 'let_go', task: { title: 'Buy SD cards', area_id: '' } }
      ] }
    ].filter(Boolean),
    still: []
  };
}
const fake = () => {
  window.__claude = (body) => window.__toClaude(body);
  window.__daybook = (task) => window.__toDaybook(task);
  window.__areas = async () => [{ id: 'area-film', title: 'Filmmaking' }, { id: 'area-personal', title: 'Personal' }];
};

const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const command = async (p, name) => {
  await p.keyboard.press('Control+K');
  await p.keyboard.type(name);
  await sleep(250);
  await p.keyboard.press('Enter');
  await sleep(500);
};
const card = (p, title) => p.locator('.dr-card', { has: p.locator('.dr-title', { hasText: title }) });

const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: 'dark' });
await ctx.exposeFunction('__toClaude', claude);
await ctx.exposeFunction('__toDaybook', daybook);
await ctx.addInitScript(fake);
const page = await ctx.newPage();
page.errors = [];
page.on('pageerror', (e) => page.errors.push(e.message));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

const shots = process.env.SHOTS;
try {
  await page.goto(URL);
  await page.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
  await sleep(500);
  await page.keyboard.press('Control+J');
  await page.waitForSelector('#outline-editor .ProseMirror');
  await page.click('#outline-editor .ProseMirror');
  for (const t of ['Call Dana about the Ninja Bunch storyboards before Friday', 'What if the ninjas were raised by a bakery #idea',
    'Long ramble: need to fix the bike, also the theme song should be a sea shanty, and buy more SD cards', 'Tired today.']) {
    await page.keyboard.type(t);
    await page.keyboard.press('Enter');
  }
  await sleep(700);

  await check('Ctrl + K asks Claude to review the day: a summary, then a card for each thread', async () => {
    await command(page, 'Review the day');
    await page.waitForSelector('.day-review .dr-card', { timeout: 5000 });
    assert.equal(asked.length, 1);
    assert.equal(asked[0].lines.length, 4, 'every line with words goes');
    assert.deepEqual(asked[0].areas.map((a) => a.title), ['Filmmaking', 'Personal'], 'with Daybook’s areas');
    assert.match(await page.textContent('.dr-summary'), /Ninja Bunch/);
    assert.equal(await page.locator('.dr-summary p').count(), 2, 'a longer summary keeps its paragraphs');
    assert.equal(await page.locator('.dr-card').count(), 3);
    assert.match(await page.textContent('.dr-toggle'), /3 to sort/);
    assert.equal(await card(page, 'Storyboards with Dana').locator('.dr-suggested').textContent(), 'Add to Daybook', 'Claude’s suggestion stands out');
    assert.match(await card(page, 'Storyboards with Dana').locator('.dr-line').textContent(), /Call Dana/, 'with the line it came from');
    const review = (await all(page)).find((r) => r.kind === 'review');
    assert.equal(review.parent_id.slice(0, 4), 'day-', 'kept with its day');
  });

  if (shots) await page.screenshot({ path: `${shots}/desktop-6-day-review.png` });

  await check('Add to Daybook: change the words and area first, then it goes, linked back to the line', async () => {
    const c = card(page, 'Storyboards with Dana');
    await c.locator('[data-choice="daybook"]').click();
    await page.waitForSelector('.dr-task input');
    assert.equal(await page.inputValue('.dr-task input'), 'Call Dana about the storyboards');
    assert.equal(await page.inputValue('.dr-task select'), 'area-film', 'Claude’s guess at the area');
    if (shots) await page.screenshot({ path: `${shots}/desktop-7-review-task.png` });
    await page.fill('.dr-task input', 'Call Dana about the storyboards (Friday)');
    await page.selectOption('.dr-task select', 'area-personal');
    await page.click('.dr-send');
    await page.waitForFunction(() => /Sent to Daybook/.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 5000 });
    assert.equal(tasks.size, 1);
    const [task] = tasks.values();
    assert.equal(task.title, 'Call Dana about the storyboards (Friday)');
    assert.equal(task.area_id, 'area-personal');
    const line = (await all(page)).find((r) => r.kind === 'line' && /Call Dana/.test(r.text));
    assert.equal(task.link, `${URL}?open=${line.id}`);
    assert.equal(line.fields.daybook.id, task.id);
    assert.match(await card(page, 'Storyboards with Dana').textContent(), /In Daybook · Personal/);
  });

  await check('Keep thinking puts it on “Still thinking about”, linked to the line; Undo takes it off', async () => {
    await card(page, 'Ninjas raised by a bakery').locator('[data-choice="mull"]').click();
    await sleep(500);
    let rows = await all(page);
    const src = rows.find((r) => r.kind === 'line' && /bakery/.test(r.text) && r.parent_id.startsWith('day-'));
    const mullPage = rows.find((r) => r.id === 'pg_mulling');
    assert.equal(mullPage.title, 'Still thinking about');
    let mull = rows.find((r) => r.parent_id === 'pg_mulling' && !r.deleted);
    assert.match(mull.text, /^Ninjas raised by a bakery/);
    assert.equal(mull.content.find((n) => n.type === 'entryRef').attrs.id, src.id);
    await card(page, 'Ninjas raised by a bakery').locator('.dr-outcome button').click();
    await sleep(500);
    rows = await all(page);
    assert.ok(!rows.some((r) => r.parent_id === 'pg_mulling' && !r.deleted), 'Undo takes the line off again');
    await card(page, 'Ninjas raised by a bakery').locator('[data-choice="mull"]').click();
    await sleep(500);
    assert.ok((await all(page)).some((r) => r.parent_id === 'pg_mulling' && !r.deleted));
  });

  await check('Split shows the parts, each with its own choices', async () => {
    await card(page, 'Odds and ends').locator('[data-choice="split"]').click();
    await page.waitForSelector('.dr-split');
    assert.equal(await page.locator('.dr-split .dr-card').count(), 3);
    assert.match(await page.textContent('.dr-toggle'), /3 to sort/);
    await card(page, 'More SD cards').locator('[data-choice="let_go"]').click();
    await sleep(300);
    await card(page, 'Sea shanty theme song').locator('[data-choice="let_go"]').click();
    await sleep(300);
    await card(page, 'Fix the bike').locator('[data-choice="daybook"]').click();
    assert.equal(await page.inputValue('.dr-task select'), 'area-personal');
    await page.click('.dr-send');
    await sleep(600);
    assert.equal(tasks.size, 2);
    assert.ok([...tasks.values()].some((t) => t.title === 'Fix the bike' && t.area_id === 'area-personal'));
    assert.equal((await page.textContent('.dr-toggle')).trim(), 'Day review', 'nothing left to sort');
  });

  await check('once it’s all sorted, the review stays folded at the bottom of the day', async () => {
    await page.reload();
    await page.waitForSelector('.dr-toggle:not([hidden])', { timeout: 5000 });
    assert.equal(await page.isVisible('.dr-summary'), false);
    await page.click('.dr-toggle');
    assert.equal(await page.isVisible('.dr-summary'), true);
    assert.match(await card(page, 'More SD cards').textContent(), /Let go/);
  });

  await check('Review again keeps what you decided', async () => {
    await page.click('.dr-again');
    await sleep(800);
    assert.equal(asked.length, 2);
    assert.equal(asked[1].lines.length, 1, 'only the line not yet sorted goes');
    assert.match(await card(page, 'Storyboards with Dana').textContent(), /In Daybook/);
  });

  // An earlier day, for the link from the 9 pm note.
  await check('on an earlier day with a few lines, there’s a quiet “Review the day”', async () => {
    await page.click('#nb-prev');
    await sleep(600);
    await page.click('#outline-editor .ProseMirror');
    await page.keyboard.type('Thought about the bakery thing in the shower');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Long walk');
    await sleep(900);
    await page.waitForSelector('.dr-start:not([hidden])', { timeout: 5000 });
  });

  await check('the 9 pm note’s link opens that day’s review, and what’s being mulled comes back', async () => {
    const iso = (await all(page)).find((r) => r.kind === 'line' && /shower/.test(r.text)).parent_id.slice(4);
    await page.keyboard.press('Control+Shift+O');
    await sleep(500);
    await page.goto(`${URL}?review=${iso}`);
    await page.waitForFunction(() => !location.search.includes('review='), null, { timeout: 8000 });
    await page.waitForSelector('.dr-card', { timeout: 8000 });
    assert.equal(asked.at(-1).mulling.length, 1);
    assert.match(asked.at(-1).mulling[0].text, /bakery/);
    assert.match(await page.textContent('#nb-kind'), /Daily page/);
    const c = page.locator('.dr-card').first();
    assert.match(await c.textContent(), /Still on your mind\?.*Ninjas raised by a bakery.*came back to it today/s);
    if (shots) await page.screenshot({ path: `${shots}/desktop-8-still-thinking.png` });
    await c.locator('[data-choice="let_go"]').click();
    await sleep(500);
    const mull = (await all(page)).find((r) => r.parent_id === 'pg_mulling' && !r.deleted);
    assert.equal(mull.fields.done, true, 'let go: struck through on the page');
  });

  await check('the review can be hidden (Show: Day review on day pages)', async () => {
    await page.evaluate(() => { localStorage.setItem('hide', JSON.stringify(['review'])); });
    await page.reload();
    await page.waitForSelector('#outline-editor .ProseMirror');
    await sleep(800);
    assert.equal(await page.isVisible('.day-review'), false);
    await page.evaluate(() => localStorage.removeItem('hide'));
  });

  await check('no page errors', async () => { assert.deepEqual(page.errors, []); });

  if (shots) {
    const phone = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await phone.exposeFunction('__toClaude', claude);
    await phone.exposeFunction('__toDaybook', daybook);
    await phone.addInitScript(fake);
    const pp = await phone.newPage();
    await pp.goto(URL);
    await pp.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
    await sleep(600);
    await pp.keyboard.press('Control+J');
    await pp.waitForSelector('#outline-editor .ProseMirror');
    await pp.click('#outline-editor .ProseMirror');
    for (const t of ['Call Dana about the Ninja Bunch storyboards before Friday', 'What if the ninjas were raised by a bakery #idea', 'Long ramble: need to fix the bike, also the theme song should be a sea shanty, and buy more SD cards']) {
      await pp.keyboard.type(t);
      await pp.keyboard.press('Enter');
    }
    await sleep(700);
    await pp.keyboard.press('Control+K');
    await pp.keyboard.type('Review the day');
    await sleep(250);
    await pp.keyboard.press('Enter');
    await pp.waitForSelector('.dr-card');
    await pp.evaluate(() => document.activeElement?.blur());
    await sleep(400);
    await pp.locator('.day-review').scrollIntoViewIfNeeded();
    await pp.evaluate(() => window.scrollBy(0, -40));
    await pp.screenshot({ path: `${shots}/phone-6-day-review.png` });
    await phone.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('review: all passed');
