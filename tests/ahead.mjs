// Weeks ahead: Today from furthest back. Six weeks as columns with each
// week's hours on top, a lane for each project on stage, a bar for each
// stretch of work (a step with a first and a last day) and a diamond for each
// date to hit (amber when it can't move). A stand-in plays Daybook
// (window.__desk) and Claude (window.__claude), as in talk.mjs.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4270;
const DIST = process.env.DIST;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(DIST ? ['--outDir', DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;

// Monday Nov 9 2026, 2:04 pm in Los Angeles. The six weeks start Nov 9, 16,
// 23, 30, Dec 7 and Dec 14.
const NOW = '2026-11-09T14:04:00-08:00';
const now = Date.parse(NOW);
const T = (s) => new Date(`${s}-08:00`).toISOString();
const NB = 'https://claude.ai/code/project/chan_nb';
const INK = 'https://claude.ai/code/project/chan_ink';
const DAY = 864e5;

const fresh = () => ({
  needs: [
    { id: 'n1', kind: 'decision', title: 'Pick Kenji’s final character sheet', project: 'The Ninja Bunch', link: `${NB}?thread=sheet`, project_link: NB, created_at: T('2026-11-08T10:09:00'), body: '' },
  ],
  updates: [
    { id: 'u3', project: 'The Ninja Bunch', project_link: NB, link: `${NB}?thread=prompts`, thread: 'Draft Reel 3 prompts', text: 'Reel 3 prompts are half drafted', place: null, state: 'working', created_at: T('2026-11-09T13:52:00') },
    { id: 'u4', project: 'Inkwell', project_link: INK, link: `${INK}?thread=redesign`, thread: 'Redesign Inkwell from the ground up', text: 'The new frame is live: rail, switch, five looks', place: null, state: 'live', created_at: T('2026-11-09T09:30:00') },
  ],
});

const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 20 * DAY, updated_at: now - 2 * 36e5 };
const row = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const old = (days) => ({ created_at: now - 200 * DAY, updated_at: now - days * DAY });
const task = (id, parent, sort, text, t = {}, extra = {}) => row(id, 'line', parent, sort, {
  text, content: [{ type: 'text', text }],
  fields: { done: !!t.done_at, box: true, task: { v: 1, day: null, est: null, done_at: null, actual: null, log: [], run: null, order: sort, ...t } },
  ...extra
});
const SEED = [
  row('wd_nb', 'world', null, 1, { title: 'The Ninja Bunch', area_id: 'area-filmmaking', fields: { shape: 'show', star: 'Three finished reels that prove the look before the December 14 tests.' }, updated_at: now - DAY }),
  row('pr_reel2', 'project', 'wd_nb', 5, { title: 'Reel 2: Breakfast', fields: { type: 'screenplay', stage: 'Boarding', label: 'Reel' } }),
  row('sd_1', 'shootday', 'pr_reel2', 9, { fields: { date: '2026-12-10', call: '07:30', place: 'Echo Park', scenes: [], notes: '' } }),
  row('steps-wd_nb', 'page', 'wd_nb', 2048, { title: 'Steps' }),
  // Stretches of work: a first day and a last.
  task('st_a', 'steps-wd_nb', 1024, 'Reel 2: generate and edit', { day: '2026-11-09', until: '2026-11-22' }),
  task('st_b', 'steps-wd_nb', 2048, 'Reel 3: board and generate', { day: '2026-11-16', until: '2026-12-06' }),
  task('st_c', 'steps-wd_nb', 3072, 'Reel 3 prompts', { day: '2026-11-09', until: '2026-11-29', owner: 'claude' }),
  task('st_d', 'steps-wd_nb', 4096, 'Reel 4 finals, then cut all three', { day: '2026-11-30', until: '2026-12-27' }),
  task('st_old', 'steps-wd_nb', 4500, 'Character sheets', { day: '2026-10-26', until: '2026-11-15' }),
  // A date that can't move, and plain steps on days.
  task('st_e', 'steps-wd_nb', 5120, 'Tests start', { day: '2026-12-14', mark: 'hard' }),
  task('st_f', 'steps-wd_nb', 6144, 'Board Reel 2', { day: '2026-11-12', est: 90 }),
  task('st_g', 'steps-wd_nb', 7168, 'Write Kenji’s second verse', { day: '2026-11-09', est: 120 }),
  // Inkwell: on stage because its threads are busy.
  row('wd_ink', 'world', null, 2, { title: 'Inkwell', area_id: 'area-business', fields: { life: true }, ...old(12) }),
  row('steps-wd_ink', 'page', 'wd_ink', 1024, { title: 'Steps', ...old(12) }),
  task('ik_a', 'steps-wd_ink', 1024, 'Build the redesign, one part after another', { day: '2026-11-09', until: '2026-12-06', owner: 'claude' }, old(12)),
  task('ik_b', 'steps-wd_ink', 2048, 'Pick the look', { day: '2026-11-13', mark: 'date', est: 30 }, old(12)),
  // In the wings (touched this month): a lane only because something of its is in view.
  row('wd_scribe', 'world', null, 3, { title: 'Scribe', area_id: 'area-business', fields: { life: true }, ...old(10) }),
  row('steps-wd_scribe', 'page', 'wd_scribe', 1024, { title: 'Steps', ...old(10) }),
  task('sc_a', 'steps-wd_scribe', 1024, 'Android beta out', { day: '2026-12-02', mark: 'date' }, old(10)),
  // In the wings with nothing in these weeks, and backstage: no lane.
  row('wd_acro', 'world', null, 4, { title: 'Acro ads', area_id: 'area-business', fields: { life: true }, ...old(10) }),
  row('wd_camp', 'world', null, 5, { title: 'Camping', area_id: 'area-personal', fields: { life: true }, ...old(90) }),
  row('steps-wd_camp', 'page', 'wd_camp', 1024, { title: 'Steps', ...old(90) }),
  task('cp_a', 'steps-wd_camp', 1024, 'Book the site', { day: '2026-11-20', mark: 'date' }, old(90)),
  // Tasks on days, for the hours: 3 h 30 min open this week and one done
  // that took 45 min; the week of December 7 holds 50 hours.
  row('page-tasks', 'page', null, 0, { title: 'Tasks' }),
  task('tk_done', 'page-tasks', 512, 'Order the storage drive', { day: '2026-11-09', est: 30, actual: 45, done_at: now - 2 * 36e5 }),
  ...[0, 1, 2, 3, 4].map((n) => task(`tk_big${n}`, 'page-tasks', 1024 + n, `Edit day ${n + 1}`, { day: `2026-12-0${7 + n > 9 ? '' : ''}${String(7 + n).padStart(2, '0')}`.replace('2026-12-0', '2026-12-'), est: 600 })),
  // Somebody else's task on a day isn't your hours.
  task('tk_nate', 'page-tasks', 4096, 'Film the tumbling class', { day: '2026-11-17', est: 240, owner: 'nate' }),
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

const browser = withoutSync(await chromium.launch());
const ANSWER = {
  say: 'Reel 4 can start a week sooner if Reel 3 boards by Friday. Give the sound its own two weeks.',
  moves: [
    { type: 'add_step', task: '', project: 'wd_nb', call: '', day: '2026-12-07', until: '2026-12-20', stage: '', text: 'Sound pass on all three', minutes: 0, label: '', why: 'Nothing holds the sound yet', on: true },
    { type: 'move_task', task: 'st_e', project: '', call: '', day: '2026-12-21', until: '', stage: '', text: '', minutes: 0, label: 'Move the tests a week', why: 'More room', on: true },
  ]
};
async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, ...extra });
  const st = { db: fresh(), asked: [] };
  await ctx.exposeFunction('__db', (op, a) => {
    if (op === 'desk') return { needs: st.db.needs.map((n) => ({ ...n })), updates: st.db.updates.filter((u) => u.created_at >= a).map((u) => ({ ...u })) };
    if (op === 'all') return { needs: st.db.needs.map((n) => ({ ...n })), updates: st.db.updates.map((u) => ({ ...u })) };
    return null;
  });
  await ctx.exposeFunction('__toClaude', async (body) => {
    if (body.mode !== 'talk') return {};
    st.asked.push(body);
    return ANSWER;
  });
  await ctx.addInitScript(() => {
    window.__claude = (body) => window.__toClaude(body);
    window.__desk = { desk: (since) => window.__db('desk', since), deskAll: () => window.__db('all'), doneNeed: () => null, laterNeed: () => null };
  });
  const page = await ctx.newPage();
  page.st = st;
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  // The novel every new copy starts with goes backstage, out of the way.
  const novel = (await all(page)).find((r) => r.kind === 'world');
  await page.evaluate(seed, [...SEED, row('settings-desk', 'settings', null, 0, { title: 'Desk', fields: { stage: { [`w:${novel.id}`]: 'back' }, ties: {} } })]);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return page;
}
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const go = async (p, place) => {
  await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
  await p.waitForFunction((pl) => (document.documentElement.dataset.view || 'write') === pl.view && history.state?.view === pl.view, place);
  await still(p);
  await sleep(300);
};
const ahead = async (p) => {
  await go(p, { view: 'plan', tab: 'ahead' });
  await p.waitForSelector('.ah .ah-lane');
};
// Today, Tomorrow and the rest of the times are in the When picker (from "When…" in the menu).
const WHEN = { Today: 'Today', Tomorrow: 'Tomorrow', 'Not on a day yet': 'Not planned' };
const pick = async (p, label) => {
  if (WHEN[label]) {
    // A step's label opens the picker straight away; a menu has "When…".
    await p.waitForSelector('.when-pick, .pop-menu');
    if (!(await p.locator('.when-pick').count())) await p.locator('.pop-menu .pop-item', { hasText: 'When' }).first().click();
    await p.waitForSelector('.when-pick');
    await p.locator('.when-pick .wp-opt', { hasText: WHEN[label] }).first().click();
  } else await p.locator('.pop-menu .pop-item', { hasText: label }).first().click();
  await sleep(250);
};
const lanes = (p) => p.evaluate(() => [...document.querySelectorAll('.ah-p')].map((b) => `${b.innerText.trim()}${b.classList.contains('faint') ? ' (faint)' : ''}`));
// "1 / 3 Reel 2: generate and edit" for each bar in a lane.
const bars = (p, world) => p.evaluate((w) => [...document.querySelectorAll(`.ah-lane[data-world="${w}"] .ah-bar`)].map((b) => `${b.style.gridColumn} ${b.querySelector('.ah-t').textContent}`), world);
const dias = (p, world) => p.evaluate((w) => [...document.querySelectorAll(`.ah-lane[data-world="${w}"] .ah-dia`)].map((b) => `${b.style.gridColumn}${b.classList.contains('hard') ? ' hard' : ''} ${b.querySelector('b').textContent} ${b.querySelector('span').textContent}`), world);
const bar = (p, id) => p.locator(`.ah-bar[data-task="${id}"]`);
const dia = (p, id) => p.locator(`.ah-dia[data-task="${id}"]`);
const slot = (p, world, week) => p.locator(`.ah-lane[data-world="${world}"] .ah-slot[data-week="${week}"]`);
// The strip under a lane's bars, where the + is.
const tapSlot = async (p, world, week) => {
  const s = slot(p, world, week);
  const b = await s.boundingBox();
  await s.click({ position: { x: b.width - 14, y: b.height - 9 } });
};
const settled = (p, id, fn, arg) => p.waitForFunction(([i, f, a]) => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').get(i); q.onsuccess = () => res(new Function('row', 'a', `return ${f}`)(q.result, a)); };
}), [id, fn, arg]);
const shot = async (p, name) => { if (SHOTS) { await p.evaluate(() => document.querySelector('.toast')?.remove()); await still(p); await sleep(250); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };
async function pane(p) {
  await p.waitForFunction(() => {
    const f = [...document.querySelectorAll('.pane-frame')].at(-1);
    const d = f?.contentDocument?.documentElement;
    return d?.dataset?.started === '1' && d.dataset.view === 'talk' && !!f.contentDocument.querySelector('.tt-ask textarea');
  }, null, { timeout: 15000 });
  return p.frames().filter((f) => f.url().includes('?pane=')).at(-1);
}

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`); }
}

try {
  const page = await open({ width: 1440, height: 900 });

  await check('Calendar’s zoom has Six weeks after Week (Pace after it with estimates on), and it opens six weeks from this one', async () => {
    await go(page, { view: 'plan', tab: 'week' });
    assert.deepEqual(await page.locator('.today-switch .tb-btn').allInnerTexts(), ['Today', 'Plan', 'Calendar']);
    assert.deepEqual(await page.locator('#plan-sheet .pl-zoom button').allInnerTexts(), ['Day', 'Week', 'Six weeks', 'Pace']);
    await page.locator('#plan-sheet .pl-zoom button', { hasText: 'Six weeks' }).click();
    await page.waitForFunction(() => history.state?.tab === 'ahead' && document.querySelector('.today-switch [aria-current="page"]')?.textContent === 'Calendar');
    await page.waitForSelector('.ah .ah-lane');
    assert.equal(await page.locator('.pl-top h1').innerText(), 'Calendar');
    assert.deepEqual(await page.locator('.ah-week').allInnerTexts(), ['Nov 9', 'Nov 16', 'Nov 23', 'Nov 30', 'Dec 7', 'Dec 14']);
    assert.equal(await page.locator('.ah-h.now .ah-week').innerText(), 'Nov 9');
  });

  await check('each week’s hours are your tasks on its days, the same number Week shows; a week over your hours says so', async () => {
    const hrs = await page.locator('.ah-hrs').allInnerTexts();
    // 2 h + 1 h 30 min open, 30 min for Friday's date, and 45 min it really took.
    assert.equal(hrs[0], '4.8 h of 45 h');
    // Nate's four hours on the 17th aren't yours.
    assert.equal(hrs[1], '0 h of 45 h');
    assert.equal(hrs[4], '50 h of 45 h');
    assert.deepEqual(await page.locator('.ah-h').evaluateAll((els) => els.map((e) => e.classList.contains('over'))), [false, false, false, false, true, false]);
    assert.equal(await page.locator('.ah-note').innerText(), 'The week of December 7 is over your 45 hours by 5.');
    await go(page, { view: 'plan', tab: 'week' });
    assert.equal(await page.locator('.pl-meter-v').innerText(), '4.8 h of 45 h');
    await ahead(page);
  });

  await check('a lane for each project on stage; one in the wings shows, fainter, only while something of its is in view', async () => {
    assert.deepEqual(await lanes(page), ['The Ninja Bunch', 'Inkwell', 'Scribe (faint)']);
  });

  await check('a stretch of work is a bar over its weeks, cut off where it runs past either end; someone else’s says whose', async () => {
    assert.deepEqual(await bars(page, 'wd_nb'), [
      '1 / 2 Character sheets',
      '1 / 3 Reel 2: generate and edit',
      '1 / 4 Reel 3 prompts',
      '2 / 5 Reel 3: board and generate',
      '4 / 7 Reel 4 finals, then cut all three',
    ]);
    assert.ok(await bar(page, 'st_old').evaluate((b) => b.classList.contains('early')));
    assert.ok(await bar(page, 'st_d').evaluate((b) => b.classList.contains('late') && !b.querySelector('.ah-grip')));
    assert.equal(await bar(page, 'st_c').locator('.ah-own').innerText().then((t) => t.toLowerCase()), 'claude');
    assert.ok(await bar(page, 'st_c').evaluate((b) => b.classList.contains('theirs')));
    assert.equal(await bar(page, 'st_a').locator('.ah-own').count(), 0);
    assert.deepEqual(await bars(page, 'wd_ink'), ['1 / 5 Build the redesign, one part after another']);
    // No two bars of a lane sit on top of each other.
    const boxes = await page.locator('.ah-lane[data-world="wd_nb"] .ah-bar').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const [x, y] = [boxes[a], boxes[b]];
      assert.ok(x[2] <= y[0] + 1 || y[2] <= x[0] + 1 || x[3] <= y[1] + 1 || y[3] <= x[1] + 1, `bars ${a} and ${b} overlap`);
    }
  });

  await check('a date to hit is a diamond in its week, amber when it can’t move; a shoot day is one too', async () => {
    assert.deepEqual(await dias(page, 'wd_nb'), ['5 Thu 10 Shoot day · Reel 2: Breakfast', '6 hard Mon 14 Tests start']);
    assert.deepEqual(await dias(page, 'wd_ink'), ['1 Fri 13 Pick the look']);
    assert.deepEqual(await dias(page, 'wd_scribe'), ['4 Wed 2 Android beta out']);
    const [amber, plain] = [await dia(page, 'st_e').locator('i').evaluate((i) => getComputedStyle(i).backgroundColor), await dia(page, 'ik_b').locator('i').evaluate((i) => getComputedStyle(i).backgroundColor)];
    assert.notEqual(amber, plain);
    await shot(page, 'ahead');
  });

  await check('a stretch isn’t a task on any one day: Week and Day leave it out, and the project’s steps say its days', async () => {
    await go(page, { view: 'plan', tab: 'week' });
    const chips = await page.locator('.pw-task .pw-t').allInnerTexts();
    assert.ok(chips.includes('Write Kenji’s second verse') && chips.includes('Pick the look'));
    assert.ok(!chips.some((c) => /Reel 2: generate|Reel 3 prompts|Character sheets|Build the redesign/.test(c)), chips.join(' | '));
    await go(page, { view: 'notebook', pageId: 'day-2026-11-09' });
    await page.waitForSelector('#plan .pl-task');
    const today = await page.locator('#plan .pl-task .pl-words').allInnerTexts();
    assert.ok(today.includes('Write Kenji’s second verse') && !today.some((c) => /Character sheets|Reel 2: generate/.test(c)), today.join(' | '));
    await go(page, { view: 'world', id: 'wd_nb' });
    await page.waitForSelector('#wh-steps .pl-task');
    const when = (text) => page.locator('#wh-steps .pl-task', { hasText: text }).locator('.pl-when').innerText();
    assert.equal(await when('Reel 2: generate and edit'), 'Nov 9 to 22');
    assert.equal(await when('Reel 4 finals'), 'Nov 30 to Dec 27');
    assert.equal(await when('Tests start'), '◆ Dec 14');
    assert.ok(await page.locator('#wh-steps .pl-task', { hasText: 'Tests start' }).locator('.pl-when').evaluate((b) => b.classList.contains('hard')));
    await ahead(page);
  });

  await check('click a week in a lane: a stretch of work that week, typed right there', async () => {
    await tapSlot(page, 'wd_ink', '2026-11-23');
    await pick(page, 'A stretch of work this week');
    const input = page.locator('.ah-lane[data-world="wd_ink"] .ah-add input');
    await input.waitFor();
    assert.ok(await input.evaluate((el) => el === document.activeElement));
    assert.equal(await input.getAttribute('placeholder'), 'What happens this week?');
    await input.fill('Guide pages for every step');
    await input.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.ah-lane[data-world="wd_ink"] .ah-bar .ah-t')].some((b) => b.textContent === 'Guide pages for every step'));
    assert.deepEqual(await bars(page, 'wd_ink'), ['1 / 5 Build the redesign, one part after another', '3 / 4 Guide pages for every step']);
    const made = (await all(page)).find((r) => r.text === 'Guide pages for every step');
    assert.equal(made.parent_id, 'steps-wd_ink');
    assert.equal(made.fields.task.day, '2026-11-23');
    assert.equal(made.fields.task.until, '2026-11-29');
    assert.equal(made.fields.box, true);
    assert.equal(await page.locator('.ah-add').count(), 0);
  });

  await check('or a date to hit on a day of that week; Escape leaves nothing behind', async () => {
    await tapSlot(page, 'wd_ink', '2026-11-23');
    await pick(page, 'A date to hit');
    await pick(page, 'Wednesday, Nov 25');
    const input = page.locator('.ah-lane[data-world="wd_ink"] .ah-add input');
    await input.waitFor();
    assert.equal(await input.getAttribute('placeholder'), 'What’s on Wed, Nov 25?');
    await input.fill('Show Nate 30m');
    await input.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.ah-lane[data-world="wd_ink"] .ah-dia span')].some((b) => b.textContent === 'Show Nate'));
    assert.deepEqual(await dias(page, 'wd_ink'), ['1 Fri 13 Pick the look', '3 Wed 25 Show Nate']);
    const made = (await all(page)).find((r) => r.text === 'Show Nate');
    assert.deepEqual([made.fields.task.day, made.fields.task.mark, made.fields.task.est, made.fields.task.until ?? null], ['2026-11-25', 'date', 30, null]);
    // The week it's in counts its half hour.
    assert.equal((await page.locator('.ah-hrs').allInnerTexts())[2], '0.5 h of 45 h');
    // This week only offers the days still to come.
    await tapSlot(page, 'wd_nb', '2026-11-09');
    await page.locator('.pop-menu .pop-item', { hasText: 'A date to hit' }).click();
    assert.equal(await page.locator('.pop-menu .pop-item').first().innerText().then((t) => t.replace(/^.*\n/, '')), 'Monday, Nov 9');
    await page.keyboard.press('Escape');
    await tapSlot(page, 'wd_scribe', '2026-11-09');
    await pick(page, 'A stretch of work this week');
    await page.locator('.ah-add input').fill('Never mind');
    await page.locator('.ah-add input').press('Escape');
    assert.equal(await page.locator('.ah-add').count(), 0);
    assert.ok(!(await all(page)).some((r) => r.text === 'Never mind'));
  });

  await check('a bar’s menu moves it by weeks, makes it longer or shorter, or makes it a plain step again', async () => {
    const id = (await all(page)).find((r) => r.text === 'Guide pages for every step').id;
    await bar(page, 'st_a').click();
    await page.waitForSelector('.pop-menu');
    await shot(page, 'ahead-menu');
    await page.keyboard.press('Escape');
    await bar(page, id).click();
    assert.ok(await page.locator('.pop-menu .pop-item', { hasText: 'A week shorter' }).count() === 0, 'one week long: no shorter');
    await pick(page, 'A week later');
    await settled(page, id, 'row.fields.task.day === "2026-11-30" && row.fields.task.until === "2026-12-06"');
    await page.waitForFunction((i) => document.querySelector(`.ah-bar[data-task="${i}"]`)?.style.gridColumn === '4 / 5', id);
    await bar(page, id).click();
    await pick(page, 'A week longer');
    await page.waitForFunction((i) => document.querySelector(`.ah-bar[data-task="${i}"]`)?.style.gridColumn === '4 / 6', id);
    await bar(page, id).click();
    await pick(page, 'A week earlier');
    await page.waitForFunction((i) => document.querySelector(`.ah-bar[data-task="${i}"]`)?.style.gridColumn === '3 / 5', id);
    await bar(page, id).click();
    await pick(page, 'A week shorter');
    await page.waitForFunction((i) => document.querySelector(`.ah-bar[data-task="${i}"]`)?.style.gridColumn === '3 / 4', id);
    assert.deepEqual([(await get(page, id)).fields.task.day, (await get(page, id)).fields.task.until], ['2026-11-23', '2026-11-29']);
    await bar(page, id).click({ button: 'right' });
    await pick(page, 'A plain step again');
    await page.waitForFunction((i) => !document.querySelector(`.ah-bar[data-task="${i}"]`), id);
    const t = (await get(page, id)).fields.task;
    assert.deepEqual([t.day, t.until], ['2026-11-23', null]);
    assert.match(await page.locator('.toast').innerText(), /a step on Nov 23 now/);
  });

  await check('with a mouse: drag a bar to other weeks, or its right edge to change where it ends; never past the six weeks', async () => {
    const drag = async (loc, dx, { grip = false } = {}) => {
      // The sheet may be drawn once more just after a change: wait for a bar that stays.
      await sleep(350);
      let b = await loc.boundingBox();
      if (!b) { await sleep(300); b = await loc.boundingBox(); }
      const x = grip ? b.x + b.width - 3 : b.x + 30;
      const y = b.y + b.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx / 2, y, { steps: 4 });
      await page.mouse.move(x + dx, y, { steps: 4 });
      await page.mouse.up();
    };
    const col = await page.locator('.ah-lane[data-world="wd_nb"] .ah-rows').evaluate((r) => r.getBoundingClientRect().width / 6);
    await drag(bar(page, 'st_a'), col);
    await settled(page, 'st_a', 'row.fields.task.day === "2026-11-16" && row.fields.task.until === "2026-11-29"');
    await page.waitForFunction(() => document.querySelector('.ah-bar[data-task="st_a"]')?.style.gridColumn === '2 / 4');
    assert.equal(await page.locator('.pop-menu').count(), 0, 'a drag isn’t a click');
    await drag(bar(page, 'st_b'), -col, { grip: true });
    await settled(page, 'st_b', 'row.fields.task.day === "2026-11-16" && row.fields.task.until === "2026-11-29"');
    await page.waitForFunction(() => document.querySelector('.ah-bar[data-task="st_b"]')?.style.gridColumn === '2 / 4');
    // Far past the right edge: it stops at the sixth week.
    await drag(bar(page, 'st_a'), col * 9);
    await settled(page, 'st_a', 'row.fields.task.day === "2026-12-07" && row.fields.task.until === "2026-12-20"');
    await page.waitForFunction(() => document.querySelector('.ah-bar[data-task="st_a"]')?.style.gridColumn === '5 / 7');
    // A small wobble is a click: the menu opens and nothing moves.
    await drag(bar(page, 'st_b'), 3);
    await page.waitForSelector('.pop-menu');
    await page.keyboard.press('Escape');
    assert.equal((await get(page, 'st_b')).fields.task.day, '2026-11-16');
    // Back where they were, for the checks that follow.
    await drag(bar(page, 'st_a'), -col * 4);
    await settled(page, 'st_a', 'row.fields.task.day === "2026-11-09"');
    await drag(bar(page, 'st_b'), col, { grip: true });
    await settled(page, 'st_b', 'row.fields.task.until === "2026-12-06"');
  });

  await check('a diamond’s menu: say it can’t move (then nothing offers to move it), move one that can, or make it a plain step', async () => {
    await dia(page, 'ik_b').click();
    await pick(page, 'A week later');
    await settled(page, 'ik_b', 'row.fields.task.day === "2026-11-20"');
    await page.waitForFunction(() => document.querySelector('.ah-dia[data-task="ik_b"]')?.style.gridColumn === '2');
    await dia(page, 'ik_b').click();
    await pick(page, 'This date can’t move');
    await page.waitForFunction(() => document.querySelector('.ah-dia[data-task="ik_b"]')?.classList.contains('hard'));
    assert.equal((await get(page, 'ik_b')).fields.task.mark, 'hard');
    await dia(page, 'ik_b').click();
    const items = await page.locator('.pop-menu .pop-item').allInnerTexts();
    assert.ok(!items.some((t) => /week (earlier|later)|Pick the day/.test(t)), items.join(' | '));
    assert.ok(await page.locator('.pop-menu .pop-item.current', { hasText: 'This date can’t move' }).count());
    await pick(page, 'This date can’t move');
    await page.waitForFunction(() => !document.querySelector('.ah-dia[data-task="ik_b"]')?.classList.contains('hard'));
    await dia(page, 'sc_a').click();
    await pick(page, 'Not a date to hit any more');
    await settled(page, 'sc_a', '!row.fields.task.mark && row.fields.task.day === "2026-12-02"');
    // Scribe had only that in view: its lane goes with it.
    await page.waitForFunction(() => ![...document.querySelectorAll('.ah-p')].some((b) => b.innerText.trim() === 'Scribe'));
    assert.deepEqual(await lanes(page), ['The Ninja Bunch', 'Inkwell']);
  });

  await check('any task with a day can be made a date to hit from its own menu, on the project’s page too', async () => {
    await go(page, { view: 'world', id: 'wd_nb' });
    await page.waitForSelector('#wh-steps .pl-task');
    const row = page.locator('#wh-steps .pl-task', { hasText: 'Board Reel 2' });
    await row.hover();
    await row.locator('.pl-more').click();
    await pick(page, 'A date to hit');
    await settled(page, 'st_f', 'row.fields.task.mark === "date"');
    await page.waitForFunction(() => [...document.querySelectorAll('#wh-steps .pl-task')].find((r) => r.innerText.includes('Board Reel 2'))?.querySelector('.pl-when')?.textContent === '◆ Thu');
    await row.hover();
    await row.locator('.pl-more').click();
    assert.ok(await page.locator('.pop-menu .pop-item', { hasText: 'This date can’t move' }).count());
    await page.keyboard.press('Escape');
    // A stretch has no such line: it's days, not a day.
    const stretch = page.locator('#wh-steps .pl-task', { hasText: 'Reel 2: generate and edit' });
    await stretch.hover();
    await stretch.locator('.pl-more').click();
    assert.equal(await page.locator('.pop-menu .pop-item', { hasText: 'A date to hit' }).count(), 0);
    await page.keyboard.press('Escape');
    await ahead(page);
    assert.deepEqual(await dias(page, 'wd_nb'), ['1 Thu 12 Board Reel 2', '5 Thu 10 Shoot day · Reel 2: Breakfast', '6 hard Mon 14 Tests start']);
  });

  await check('moving a stretch’s first day from the project’s page keeps its length', async () => {
    await go(page, { view: 'world', id: 'wd_nb' });
    await page.waitForSelector('#wh-steps .pl-task');
    await page.locator('#wh-steps .pl-task', { hasText: 'Character sheets' }).locator('.pl-when').click();
    await pick(page, 'Tomorrow');
    // It was three weeks less a day long, and still is.
    await settled(page, 'st_old', 'row.fields.task.day === "2026-11-10" && row.fields.task.until === "2026-11-30"');
    await ahead(page);
    assert.ok((await bars(page, 'wd_nb')).includes('1 / 5 Character sheets'));
  });

  await check('Done takes a bar or a diamond out of the weeks, and the step is ticked where it’s written', async () => {
    await bar(page, 'st_old').click();
    await pick(page, 'Done');
    await page.waitForFunction(() => !document.querySelector('.ah-bar[data-task="st_old"]'));
    const r = await get(page, 'st_old');
    assert.ok(r.fields.done && r.fields.task.done_at);
    await dia(page, 'st_f').click();
    await pick(page, 'Done');
    await page.waitForFunction(() => !document.querySelector('.ah-dia[data-task="st_f"]'));
    assert.ok((await get(page, 'st_f')).fields.done);
  });

  await check('a week’s name opens that week day by day, a project’s name its page, a shoot day its call sheet', async () => {
    await page.locator('.ah-week', { hasText: 'Nov 23' }).click();
    await page.waitForFunction(() => history.state?.tab === 'week' && history.state?.week === '2026-11-23');
    await page.waitForFunction(() => /November 23 to 29/.test(document.querySelector('.pl-top h1')?.textContent || ''));
    assert.ok((await page.locator('.pw-task .pw-t').allInnerTexts()).includes('Show Nate'));
    await ahead(page);
    await page.locator('.ah-p', { hasText: 'Inkwell' }).click();
    await page.waitForFunction(() => history.state?.view === 'world' && history.state?.id === 'wd_ink');
    await ahead(page);
    await page.locator('.ah-dia', { hasText: 'Shoot day' }).click();
    await page.waitForFunction(() => history.state?.view === 'production' && history.state?.id === 'pr_reel2');
    await ahead(page);
  });

  await check('“Plan it out with Claude” opens the talk beside: Claude sees the six weeks, stretches and dates, and a stretch it offers, applied beside, lands as a bar here', async () => {
    await page.locator('.ah-talk').click();
    const f = await pane(page);
    assert.equal(await page.locator('.pane .pane-tab[aria-pressed="true"]').innerText(), 'Claude');
    await f.locator('.tt-ask textarea').fill('Plan the next six weeks');
    await f.locator('.tt-ask textarea').press('Enter');
    await f.waitForFunction(() => document.querySelectorAll('.tt-cl').length === 1 && !document.querySelector('.tt-wait'));
    const b = page.st.asked.at(-1);
    assert.deepEqual(b.weeks_ahead.map((w) => w.week_of), ['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14']);
    assert.equal(b.weeks_ahead[4].planned_minutes, 3000);
    const nb = b.projects.find((p) => p.id === 'wd_nb');
    assert.equal(nb.steps.find((s) => s.id === 'st_a').until, '2026-11-22');
    assert.equal(nb.steps.find((s) => s.id === 'st_e').date_to_hit, 'cannot move');
    assert.equal(b.projects.find((p) => p.id === 'wd_ink').steps.find((s) => s.id === 'ik_b').date_to_hit, 'can move');
    // Today's minutes are the tasks on today, not the stretches that start today.
    assert.equal(b.week[0].planned_minutes, 120);
    // The date that can't move isn't offered; the stretch is, with its days.
    const offered = await f.locator('.tt-move .tt-move-t').evaluateAll((els) => els.map((e) => e.firstChild.textContent));
    assert.deepEqual(offered, ['Add “Sound pass on all three” to The Ninja Bunch, Dec 7 to 20']);
    await f.locator('.tt-go').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.ah-lane[data-world="wd_nb"] .ah-bar')].some((x) => x.querySelector('.ah-t').textContent === 'Sound pass on all three' && x.style.gridColumn === '5 / 7'));
    const made = (await all(page)).find((r) => r.text === 'Sound pass on all three');
    assert.deepEqual([made.parent_id, made.fields.task.day, made.fields.task.until, made.fields.task.est], ['steps-wd_nb', '2026-12-07', '2026-12-20', null]);
    await shot(page, 'ahead-talk');
    await page.keyboard.press('Control+\\');
    await page.waitForFunction(() => !document.querySelector('.pane-frame') || document.querySelector('.panes')?.hidden !== false || !document.documentElement.classList.contains('has-panes'));
  });

  await check('under Look: the hours line can be switched off; with Beside off there’s no “Plan it out” button', async () => {
    await page.evaluate(() => { document.documentElement.classList.add('hide-aheadhours', 'hide-panes'); });
    assert.ok(await page.locator('.ah-hrs').first().isHidden());
    assert.ok(await page.locator('.ah-note').isHidden());
    assert.ok(await page.locator('.ah-talk').isHidden());
    assert.ok(await page.locator('.ah-week').first().isVisible());
    await page.evaluate(() => { document.documentElement.classList.remove('hide-aheadhours', 'hide-panes'); });
    assert.ok(await page.locator('input[data-show="aheadhours"]').count());
  });

  await check('the command list knows it, and the path says where you are', async () => {
    await go(page, { view: 'desk' });
    await page.keyboard.press('Control+k');
    await page.keyboard.type('weeks ahead');
    await page.waitForFunction(() => /six weeks/.test(document.querySelector('.cmd-item[aria-selected="true"], .palette-item.sel, [role="option"][aria-selected="true"]')?.textContent || ''));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => history.state?.view === 'plan' && history.state?.tab === 'ahead');
    await page.waitForSelector('.ah .ah-lane');
    assert.deepEqual(page.errors, []);
  });

  await check('nothing on stage: it says so instead of an empty grid', async () => {
    const bare = await open({ width: 1280, height: 800 });
    await bare.evaluate(seed, [row('settings-desk', 'settings', null, 0, { title: 'Desk', fields: { stage: Object.fromEntries(['wd_nb', 'wd_ink', 'wd_scribe', 'wd_acro', 'wd_camp'].map((w) => [`w:${w}`, 'back'])), ties: {} } })]);
    // Keep the novel backstage too.
    const novel = (await all(bare)).find((r) => r.kind === 'world' && !r.id.startsWith('wd_'));
    await bare.evaluate(seed, [row('settings-desk', 'settings', null, 0, { title: 'Desk', fields: { stage: Object.fromEntries(['wd_nb', 'wd_ink', 'wd_scribe', 'wd_acro', 'wd_camp', novel.id].map((w) => [`w:${w}`, 'back'])), ties: {} } })]);
    await bare.reload();
    await bare.waitForFunction(() => document.documentElement.dataset.started === '1');
    await go(bare, { view: 'plan', tab: 'ahead' });
    await bare.waitForSelector('.ah');
    assert.equal(await bare.locator('.ah-lane').count(), 0);
    assert.match(await bare.locator('.pl-note').innerText(), /Nothing is on stage/);
    assert.equal(await bare.locator('.ah-week').count(), 6);
    assert.deepEqual(bare.errors, []);
    await bare.context().close();
  });

  await check('on a phone the weeks scroll sideways under your thumb, project names stay put, a tap opens the menu, nothing spills', async () => {
    const phone = await open(undefined, { ...devices['Pixel 7'] });
    await go(phone, { view: 'plan', tab: 'ahead' });
    await phone.waitForSelector('.ah .ah-lane');
    assert.deepEqual(await phone.locator('.pl-switch button').allInnerTexts(), ['Page', 'Plan', 'Calendar']);
    assert.deepEqual(await phone.locator('.pl-zoom button').allInnerTexts(), ['Day', 'Week', 'Six weeks', 'Pace']);
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(wide <= 1, `the page spills ${wide}`);
    assert.ok(await phone.locator('.ah-wrap').evaluate((w) => w.scrollWidth > w.clientWidth + 100));
    await shot(phone, 'ahead-phone');
    await phone.locator('.ah-wrap').evaluate((w) => { w.scrollLeft = 400; });
    await sleep(200);
    const left = await phone.locator('.ah-p').first().evaluate((b) => b.getBoundingClientRect().left);
    assert.ok(left >= 0 && left < 40, `the name is at ${left}`);
    await phone.locator('.ah-wrap').evaluate((w) => { w.scrollLeft = 0; });
    await phone.locator('.ah-bar[data-task="st_a"]').tap();
    await phone.waitForSelector('.pop-menu');
    assert.ok(await phone.locator('.pop-menu .pop-item', { hasText: 'A week later' }).count());
    await phone.locator('.pop-menu .pop-item', { hasText: 'A week later' }).tap();
    await settled(phone, 'st_a', 'row.fields.task.day === "2026-11-16"');
    assert.deepEqual(phone.errors, []);
    await phone.context().close();
  });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall weeks ahead checks passed');
