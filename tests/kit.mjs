// Not a test file of its own: what the test files share.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { get } from 'node:http';

// The built app (dist, or DIST) served on its own port. Resolves once the
// server answers, rather than after a fixed wait, so a slow machine can't
// start a test before the page is there.
export async function serve(port) {
  const dist = process.env.DIST;
  const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(port), '--strictPort', ...(dist ? ['--outDir', dist] : [])], { stdio: 'pipe' });
  const until = Date.now() + 20000;
  for (;;) {
    // node:http, not fetch: fetch refuses some ports outright (4190 is one).
    if (await answers(port)) return server;
    if (Date.now() > until) { server.kill(); throw new Error(`the app did not start on port ${port}`); }
    await sleep(150);
  }
}

const answers = (port) => new Promise((done) => {
  const req = get({ host: 'localhost', port, path: '/', timeout: 2000 }, (res) => { res.resume(); done(res.statusCode === 200); });
  req.on('error', () => done(false));
  req.on('timeout', () => { req.destroy(); done(false); });
});
