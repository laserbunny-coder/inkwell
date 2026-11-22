// Runs the test files one after another (npm test), or one share of them:
// `node tests/all.mjs 2/3` runs the second of three shares, so three
// machines can each take a third at once. Shares are balanced by how long
// each file takes; a new file without a time counts as 20 seconds.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

// About how many seconds each test file takes. Every tests/*.mjs file runs,
// listed here or not, so a new one can't be missed.
const FILES = {
  order: 1, script: 1, today: 60, hstrip: 25, stats: 1, run: 81, alts: 11, data: 20, sync: 29, tidy: 39,
  search: 15, history: 24, caret: 8, files: 8, slash: 6, worlds: 17, structure: 33,
  capture: 21, voice: 21, share: 7, lists: 25, tags: 9,
  production: 29, revise: 28, pages: 18, nav: 11, shapes: 16, stagesets: 18, ghosttap: 12, outliner: 20, claudeknows: 15, bringin: 12, tidypass: 25, checklists: 14, linkcatch: 12, scribe: 12, aiprod: 30, zoompage: 60, panes: 30, woven: 25, desk: 40, plan: 40, through: 30, beside: 40, project: 35, talk: 40, repeats: 40, calendar: 30, box: 40, phoneplan: 25, alerts: 15, hq: 15, gcal: 12, dayweave: 25, daycal: 30, plantidy: 25, phonedrag: 15, linedecos: 15, whenpage: 60, barfocus: 30, offline: 20, savebox: 15, finish: 20, now: 60, eventwarn: 30, thoughts: 45, dayends: 45, training: 50, trainstats: 2, readstats: 2, firstlight: 45, lookwall: 30, zoom: 60, zoomtime: 70, zoomwhere: 60, suggest: 25, cast: 30, projectoutline: 40, arrange: 70, steady: 25
};

// Modules the tests share, not tests of their own.
const HELPERS = new Set(['all', 'kit', 'nosync', 'pagefirst', 'outliner-kit']);
const names = [...Object.keys(FILES), ...readdirSync('tests').filter((f) => f.endsWith('.mjs') && !HELPERS.has(f.slice(0, -4))).map((f) => f.slice(0, -4)).filter((n) => !(n in FILES)).sort()]
  .filter((n) => readdirSync('tests').includes(`${n}.mjs`));

const [part, parts] = (process.argv[2] || '1/1').split('/').map(Number);
// The longest files go first, each to the share with the least so far.
const loads = Array.from({ length: parts }, () => ({ secs: 0, files: [] }));
for (const name of [...names].sort((a, b) => (FILES[b] || 20) - (FILES[a] || 20))) {
  const least = loads.reduce((a, b) => (b.secs < a.secs ? b : a));
  least.secs += FILES[name] || 20;
  least.files.push(name);
}
const mine = new Set(loads[part - 1].files);
const run = names.filter((n) => mine.has(n));
if (parts > 1) console.log(`share ${part} of ${parts}: ${run.join(', ')} (about ${loads[part - 1].secs} s)`);

// Every file runs, so one run lists every failure; the share fails at the end.
const failed = [];
for (const name of run) {
  const r = spawnSync(process.execPath, [`tests/${name}.mjs`], { stdio: 'inherit' });
  if (r.status !== 0) { console.log(`\ntests/${name}.mjs failed`); failed.push(name); }
}
if (failed.length) { console.log(`\n${failed.length} failed: ${failed.join(', ')}`); process.exit(1); }
