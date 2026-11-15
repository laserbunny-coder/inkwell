// Before and after, pixel by pixel: every room on a phone and a computer, in a
// dark and a light look, from two builds of the app. Not part of npm test:
// for clean-ups that must not change what you see.
// Run: BEFORE=path/to/old/dist node tests/perf/compare-shots.mjs   (AFTER defaults to dist;
// OUT=folder keeps the shots and a diff for each room that differs)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const BEFORE = process.env.BEFORE;
const AFTER = process.env.AFTER || 'dist';
const OUT = process.env.OUT || null;
if (!BEFORE) { console.log('Set BEFORE to the old build folder'); process.exit(2); }
const serve = (dir, port) => spawn('node_modules/.bin/vite', ['preview', '--outDir', dir, '--port', String(port), '--strictPort'], { stdio: 'pipe' });
const servers = [serve(BEFORE, 4296), serve(AFTER, 4297)];
await sleep(2000);

// A fixed moment, so clocks and "today" match in both.
const NOW = new Date('2026-11-12T10:30:00-08:00').getTime();
const DAY = 864e5;
const iso = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const today = iso(NOW);

function rows() {
  const out = [];
  let t = NOW - 5 * 3600e3;
  const put = (r) => out.push({ parent_id: null, sort: 0, title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, ...r, created_at: NOW - DAY, updated_at: (t += 1000) });
  const txt = (s) => (s ? [{ type: 'text', text: s }] : null);
  put({ id: 'area-writing', kind: 'area', title: 'Writing', sort: 1 });
  put({ id: 'area-filmmaking', kind: 'area', title: 'Filmmaking', sort: 2 });
  put({ id: 'wd-ninja', kind: 'world', title: 'The Ninja Bunch', area_id: 'area-filmmaking', sort: 1 });
  put({ id: 'pg_chars', kind: 'page', parent_id: 'wd-ninja', title: 'Characters', sort: 1024 });
  ['Kenji, the youngest ninja', 'Grandpa, who runs the bakery', 'Mom, short and calm'].forEach((s, i) => put({ id: `li_c${i}`, kind: 'line', parent_id: 'pg_chars', sort: (i + 1) * 1024, text: s, content: txt(s) }));
  put({ id: 'pr_ep1', kind: 'project', parent_id: 'wd-ninja', title: 'Breakfast', area_id: 'area-filmmaking', sort: 1, fields: { type: 'screenplay', label: 'Episode', stage: 'Written' } });
  put({ id: 'ac_ep1', kind: 'act', parent_id: 'pr_ep1', title: 'Screenplay', sort: 1024 });
  put({ id: 'ch_ep1', kind: 'chapter', parent_id: 'ac_ep1', title: 'Script', sort: 1024 });
  [['scene', 'INT. KITCHEN - MORNING'], ['action', 'Grandpa flips a pancake. It sticks to the ceiling.'], ['character', 'KENJI'], ['dialogue', 'Is that a ninja move?']]
    .forEach(([el, s], i) => put({ id: `ps_${i}`, kind: 'para', parent_id: 'ch_ep1', sort: (i + 1) * 1024, text: s, content: txt(s), fields: { el } }));
  put({ id: `day-${today}`, kind: 'day', title: today, created_at: NOW });
  ['Called Dana about the storyboards', 'What if the ninjas were raised by a bakery #idea'].forEach((s, i) => put({ id: `li_d${i}`, kind: 'line', parent_id: `day-${today}`, sort: (i + 1) * 1024, text: s, content: txt(s) }));
  put({ id: 'page-tasks', kind: 'page', title: 'Tasks', sort: 1 });
  ['Board reel 2', 'Order the storage drive', 'Pack the van'].forEach((s, i) => put({ id: `li_t${i}`, kind: 'line', parent_id: 'page-tasks', sort: (i + 1) * 1024, text: s, content: txt(s), fields: { done: false, box: true, task: { v: 1, day: i < 2 ? today : null, est: null, done_at: null, actual: null, log: [], run: null, order: i, span: null } } }));
  return out;
}

const PLACES = {
  today: { view: 'notebook', pageId: `day-${today}` },
  library: { view: 'library', area: null },
  desk: { view: 'desk' },
  plan: { view: 'plan' },
  world: { view: 'world', id: 'wd-ninja' },
  script: { view: 'write', chapterId: 'ch_ep1' },
  bible: { view: 'notebook', pageId: 'pg_chars' },
  tags: { view: 'tags' },
  drawer: { view: 'drawer' },
  make: { view: 'production', id: 'pr_ep1' }
};

async function shoot(port, mode, look, name) {
  const browser = await chromium.launch();
  const opts = mode === 'phone' ? { ...devices['Pixel 7'] } : { viewport: { width: 1440, height: 900 } };
  const ctx = await browser.newContext({ ...opts, colorScheme: 'dark', timezoneId: 'America/Los_Angeles', locale: 'en-US', reducedMotion: 'reduce' });
  await ctx.addInitScript(({ look, place }) => {
    window.__syncBackend = null;
    try {
      localStorage.setItem('look', look);
      localStorage.setItem('place', JSON.stringify(place));
      localStorage.setItem('todayPhone', 'page');
    } catch { /* none */ }
  }, { look, place: PLACES[name] });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  // The account, written straight into the device's store, then opened afresh.
  await page.evaluate((list) => new Promise((res, rej) => { const q = indexedDB.open('writing'); q.onsuccess = () => { const tx = q.result.transaction('entries', 'readwrite'); for (const r of list) tx.objectStore('entries').put(r); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }; }), rows());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  await sleep(1500);
  await page.evaluate(() => { document.activeElement?.blur(); document.querySelector('.toast')?.remove(); });
  await sleep(400);
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  await browser.close();
  return png;
}

// How many pixels differ, worked out in a browser (no image library needed).
const judge = await chromium.launch();
const jp = await judge.newPage();
async function differ(a, b) {
  return jp.evaluate(async ([a, b]) => {
    const load = (b64) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = `data:image/png;base64,${b64}`; });
    const [x, y] = await Promise.all([load(a), load(b)]);
    if (x.width !== y.width || x.height !== y.height) return { n: -1 };
    const c = (img) => { const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height); };
    const p = c(x); const q = c(y);
    const out = document.createElement('canvas'); out.width = x.width; out.height = x.height; const og = out.getContext('2d'); const od = og.createImageData(x.width, x.height);
    let n = 0;
    for (let i = 0; i < p.data.length; i += 4) {
      const d = Math.abs(p.data[i] - q.data[i]) + Math.abs(p.data[i + 1] - q.data[i + 1]) + Math.abs(p.data[i + 2] - q.data[i + 2]);
      if (d > 24) { n++; od.data[i] = 255; od.data[i + 3] = 255; } else { od.data[i] = od.data[i + 1] = od.data[i + 2] = p.data[i] / 3; od.data[i + 3] = 255; }
    }
    og.putImageData(od, 0, 0);
    return { n, of: x.width * x.height, diff: out.toDataURL('image/png').split(',')[1] };
  }, [a.toString('base64'), b.toString('base64')]);
}

if (OUT) mkdirSync(OUT, { recursive: true });
const lines = [];
let changed = 0;
try {
  for (const mode of ['computer', 'phone']) {
    for (const look of ['midnight', 'paper']) {
      for (const name of Object.keys(PLACES)) {
        const [a, b] = [await shoot(4296, mode, look, name), await shoot(4297, mode, look, name)];
        const d = a.equals(b) ? { n: 0 } : await differ(a, b);
        const key = `${mode}-${look}-${name}`;
        if (d.n) changed++;
        lines.push(`${d.n ? 'DIFF' : 'same'} ${key}${d.n ? ` (${d.n < 0 ? 'size changed' : `${d.n} of ${d.of} pixels`})` : ''}`);
        console.log(lines.at(-1));
        if (OUT && d.n) { writeFileSync(`${OUT}/${key}-before.png`, a); writeFileSync(`${OUT}/${key}-after.png`, b); if (d.diff) writeFileSync(`${OUT}/${key}-diff.png`, Buffer.from(d.diff, 'base64')); }
      }
    }
  }
} finally {
  await judge.close();
  for (const s of servers) s.kill();
}
console.log(changed ? `\n${changed} differ` : '\nall the same');
