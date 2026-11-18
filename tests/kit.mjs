// Not a test file of its own: what the test files share.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

// The built app (dist, or DIST) served on its own port. Resolves once the
// server answers, rather than after a fixed wait, so a slow machine can't
// start a test before the page is there.
export async function serve(port) {
  const dist = process.env.DIST;
  const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(port), '--strictPort', ...(dist ? ['--outDir', dist] : [])], { stdio: 'pipe' });
  const until = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`http://localhost:${port}/`)).ok) return server; } catch { /* not up yet */ }
    if (Date.now() > until) throw new Error(`the app did not start on port ${port}`);
    await sleep(150);
  }
}
