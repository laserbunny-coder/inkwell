# Working on Inkwell with Claude

## GitHub limits

On Nov 6, 2026 Michael's GitHub account was suspended for too much automated
activity. It was restored on Nov 9, 2026, and Michael gave the go-ahead for
normal GitHub use the same evening. These limits stay in force so it does not
happen again. They apply to every Claude thread, agent and session that touches
this repository.

- One builder at a time: never run several agents or threads that push to
  GitHub at once, across ALL of Michael's projects (they share one GitHub
  account). Build big features one part after another.
- Commit in batches, not after every small edit. One pull request per finished
  feature or fix. Add follow-up fixes to the open PR instead of opening new
  ones.
- Don't re-run failed workflows. After one failure, stop and tell Michael.
- Only push to main, deploy or publish when Michael says the update is ready.
- Never loop GitHub's API (bulk issues, comments, labels or branches).
- If GitHub returns any rate-limit error, stop all GitHub activity and tell
  Michael.
- If the account is ever suspended again: don't commit, push or open PRs until
  Michael says GitHub is restored and gives the go-ahead. Work can be planned
  and built on a local copy, but nothing goes to GitHub.

## Cloudflare, every time

Inkwell is published in two places: GitHub Pages (the usual address) and a
Cloudflare Worker named `inkwell` (https://inkwell.laserbunny.workers.dev), so
the app stays up if GitHub is ever unavailable again. Michael's rule (Nov 9,
2026): every time an update is published on GitHub, publish the same build to
Cloudflare right after. Since Nov 10, 2026 the publish workflow does this by
itself (job "Publish to Cloudflare", using the `CLOUDFLARE_API_TOKEN` secret).
If that job is skipped or fails, fall back to publishing from Michael's desktop
PC with `npx wrangler deploy`, which needs his go while that session runs.

## Copies of the code away from GitHub

The code must never live only on GitHub. After each batch of work, save a copy
(a tar of the working folder with its .git, or a git bundle) to the project's
shared files under `code-backup/`.

## The server lives here now

Since Nov 2026 the server half of Inkwell (Supabase migrations and functions,
including Scribe's and Acro HQ's) is in `supabase/` in this repository, not in
the Daybook repo. Server changes go here; `server.yml` runs the server checks
on a pull request and publishes from main once the Supabase secrets are set in
this repository. A pull request that only touches `supabase/` does not
republish the app.
