// How quickly Inkwell opens and gets around with a vault-sized account. Not part
// of npm test: measurement only, run before and after a change and compare.
// Seeds an account through a stand-in for the server (like the tests), then on a
// computer at full speed, a quarter and a sixth of the CPU, and on a phone at a
// quarter, measures: opening the app (to html[data-started]), switching rooms
// (Today, Library, Desk, Plan, a world) and typing on today's page.
// Run: node tests/perf/startup.mjs   (OUT=file.json to keep the numbers)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const OUT = process.env.OUT || 'perf-startup.json';
const RUNS = Number(process.env.RUNS || 5);
const PORT = 4278;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const APP = `http://localhost:${PORT}/`;

const DAY = 864e5;
const now = Date.now();
const iso = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const today = iso(now);

let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const WORDS = 'the lighthouse keeper counted ships while his sister read the log aloud and gulls wheeled over salt grey water a lamp burned through fog she wrote letters nobody answered rope tide harbour bread kitchen window morning quietly remembered never stairs brass winter storm night ninja bakery grandpa rolling pin'.split(' ');
const sentence = (n = 6 + Math.floor(rnd() * 10)) => { const w = Array.from({ length: n }, () => WORDS[Math.floor(rnd() * WORDS.length)]); w[0] = w[0][0].toUpperCase() + w[0].slice(1); return `${w.join(' ')}.`; };

// About a year of use: 4 areas, 12 worlds with bible pages, 365 daily pages,
// 400 tasks, a novel and a script.
function account() {
  const table = new Map();
  let clock = now - 6 * 3600e3;
  const stamp = () => new Date((clock += 1)).toISOString();
  const put = (r) => table.set(r.id, { parent_id: null, sort: 0, title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, ...r, created_at: new Date(r.created_at || now - DAY).toISOString(), user_id: 'u1', updated_at: stamp() });
  const txt = (t) => [{ type: 'text', text: t }];
  const areas = ['writing', 'filmmaking', 'business', 'personal'];
  areas.forEach((a, i) => put({ id: `area-${a}`, kind: 'area', title: a[0].toUpperCase() + a.slice(1), sort: i + 1 }));
  let n = 0;
  const line = (parent, text, sort, fields = {}) => { const id = `li_${n++}`; put({ id, kind: 'line', parent_id: parent, sort, text, content: txt(text), fields: { done: false, ...fields } }); return id; };
  for (let w = 0; w < 12; w++) {
    const wid = `wd_${w}`;
    put({ id: wid, kind: 'world', title: `World ${w} ${WORDS[w]}`, area_id: `area-${areas[w % 4]}`, sort: w + 1 });
    for (let p = 0; p < 8; p++) {
      const pid = `pg_${w}_${p}`;
      put({ id: pid, kind: 'page', parent_id: wid, title: `Page ${p} of ${w}`, sort: (p + 1) * 1024 });
      for (let l = 0; l < 30; l++) line(pid, sentence(), (l + 1) * 1024);
    }
  }
  for (let d = 0; d < 365; d++) {
    const id = `day-${iso(now - d * DAY)}`;
    put({ id, kind: 'day', title: iso(now - d * DAY), created_at: now - d * DAY });
    for (let l = 0; l < 12; l++) line(id, sentence(), (l + 1) * 1024);
  }
  put({ id: 'pg_tasks', kind: 'page', title: 'Tasks', sort: 1 });
  for (let t = 0; t < 400; t++) line('pg_tasks', sentence(5), (t + 1) * 1024, { task: true, day: t % 3 ? iso(now + (t % 30 - 10) * DAY) : null, done: t % 5 === 0 });
  put({ id: 'pr_novel', kind: 'project', parent_id: 'wd_0', title: 'The novel', area_id: 'area-writing', sort: 1, fields: { type: 'novel', levels: ['Act', 'Chapter'], label: 'Novel', stage: 'Drafted' } });
  put({ id: 'ac_novel', kind: 'act', parent_id: 'pr_novel', title: 'Act One', sort: 1024 });
  for (let c = 0; c < 20; c++) {
    put({ id: `ch_${c}`, kind: 'chapter', parent_id: 'ac_novel', title: `Chapter ${c + 1}`, sort: (c + 1) * 1024 });
    for (let i = 0; i < 40; i++) { const t = `${sentence()} ${sentence()} ${sentence()}`; put({ id: `pn_${c}_${i}`, kind: 'para', parent_id: `ch_${c}`, sort: (i + 1) * 1024, text: t, content: txt(t) }); }
  }
  return table;
}

const fake = () => {
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: (rows) => window.__remote('push', rows),
    pull: (since, from) => window.__remote('pull', { since, from }),
    async upload() {}, async download() { throw new Error('not found'); },
    subscribe() {}, unsubscribe() {}
  };
  try { localStorage.setItem('todayPhone', localStorage.getItem('todayPhone') || 'page'); } catch { /* none */ }
  // When the app says it has started, from the start of the navigation.
  const watch = () => { if (document.documentElement?.dataset.started) window.__startedAt = performance.now(); else setTimeout(watch, 2); };
  watch();
  window.__lat = [];
  addEventListener('keydown', (e) => { const t = performance.now(); requestAnimationFrame(() => setTimeout(() => window.__lat.push(performance.now() - t), 0)); }, true);
};

const table = account();
const remote = (op, arg) => {
  if (op === 'push') return arg.map((r) => ({ id: r.id, updated_at: new Date().toISOString() }));
  if (op === 'pull') return [...table.values()].filter((r) => r.updated_at > arg.since).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)).slice(arg.from, arg.from + 500);
};
const med = (a) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)]); };

const go = (page, place) => page.evaluate(async (place) => {
  const t0 = performance.now();
  history.pushState(place, ''); dispatchEvent(new PopStateEvent('popstate', { state: place }));
  for (let i = 0; i < 400 && (document.documentElement.dataset.view || 'write') !== place.view; i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return performance.now() - t0;
}, place);
const PLACES = {
  today: { view: 'notebook', pageId: `day-${today}` },
  library: { view: 'library', area: null },
  desk: { view: 'desk' },
  plan: { view: 'plan' },
  world: { view: 'world', id: 'wd_3' },
  chapter: { view: 'write', chapterId: 'ch_4' }
};

const dir = '/tmp/claude-perf-startup';
rmSync(dir, { recursive: true, force: true });
const results = {};
const MODES = [
  { name: 'computer, full speed', phone: false, rate: 1 },
  { name: 'computer, a quarter of the CPU', phone: false, rate: 4 },
  { name: 'computer, a sixth of the CPU', phone: false, rate: 6 },
  { name: 'phone (Pixel 7), a quarter of the CPU', phone: true, rate: 4 }
];
try {
  for (const mode of MODES) {
    const opts = mode.phone ? { ...devices['Pixel 7'] } : { viewport: { width: 1440, height: 900 } };
    const ctx = await chromium.launchPersistentContext(`${dir}-${mode.phone ? 'phone' : 'computer'}`, { ...opts, timezoneId: 'America/Los_Angeles', locale: 'en-US' });
    await ctx.exposeFunction('__remote', remote);
    await ctx.addInitScript(fake);
    const page = ctx.pages()[0] || await ctx.newPage();
    page.on('pageerror', (e) => console.log('page error:', e.message));
    await page.goto(APP);
    await page.waitForFunction(() => document.documentElement.dataset.started && window.__sync && !window.__sync.running, null, { timeout: 600000 });
    await page.evaluate(() => window.__sync.run());
    await page.waitForFunction(() => window.__sync && !window.__sync.running, null, { timeout: 600000 });
    await sleep(1500);
    const cdp = await ctx.newCDPSession(page);
    const r = results[mode.name] = {};
    const starts = [];
    for (let i = 0; i < RUNS; i++) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: mode.rate });
      await page.reload();
      await page.waitForFunction(() => window.__startedAt, null, { timeout: 120000 });
      starts.push(await page.evaluate(() => window.__startedAt));
      await sleep(1500);
    }
    r.start = med(starts);
    for (const [name, place] of Object.entries(PLACES)) {
      const times = [];
      for (let i = 0; i < 3; i++) { await go(page, PLACES.library.view === place.view ? PLACES.today : PLACES.library); await sleep(500); times.push(await go(page, place)); await sleep(500); }
      r[name] = med(times);
    }
    await go(page, PLACES.today); await sleep(800);
    await page.evaluate(() => { const ed = window.__outline; ed.commands.focus('end'); window.__lat.length = 0; });
    await page.keyboard.type(' quick brown words', { delay: 120 });
    await sleep(1500);
    r.typing = med(await page.evaluate(() => window.__lat));
    console.log(`${mode.name}: ${JSON.stringify(r)}`);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await ctx.close();
  }
  writeFileSync(OUT, JSON.stringify(results, null, 1));
  console.log('\n| | start | Today | Library | Desk | Plan | world | chapter | typing |\n|---|---|---|---|---|---|---|---|---|');
  for (const [k, r] of Object.entries(results)) console.log(`| ${k} | ${r.start} | ${r.today} | ${r.library} | ${r.desk} | ${r.plan} | ${r.world} | ${r.chapter} | ${r.typing} |`);
  console.log('(milliseconds, medians)');
} finally {
  server.kill();
}
