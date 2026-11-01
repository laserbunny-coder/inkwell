// Runs the test files one after another (npm test), or one share of them:
// `node tests/all.mjs 2/3` runs the second of three shares, so three
// machines can each take a third at once. Shares are balanced by how long
// each file takes; a new file without a time counts as 20 seconds.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

// About how many seconds each test file takes. Every tests/*.mjs file runs,
// listed here or not, so a new one can't be missed.
const FILES = {
  order: 1, script: 1, stats: 1, run: 81, alts: 11, data: 20, sync: 29, tidy: 39,
  search: 15, history: 24, caret: 8, files: 8, slash: 6, worlds: 17, structure: 33,
  capture: 21, voice: 21, share: 7, lists: 25, daybook: 12, review: 14, tags: 9,
  production: 29, revise: 28, pages: 18, nav: 11, shapes: 16, stagesets: 18, ghosttap: 12, outliner: 20
};

const names = [...Object.keys(FILES), ...readdirSync('tests').filter((f) => f.endsWith('.mjs') && f !== 'all.mjs').map((f) => f.slice(0, -4)).filter((n) => !(n in FILES)).sort()]
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

for (const name of run) {
  const r = spawnSync(process.execPath, [`tests/${name}.mjs`], { stdio: 'inherit' });
  if (r.status !== 0) { console.log(`\ntests/${name}.mjs failed`); process.exit(r.status || 1); }
}
