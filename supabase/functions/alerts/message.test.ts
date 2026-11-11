// Checks what phone alerts say and where they go:
// node --experimental-strip-types supabase/functions/alerts/message.test.ts
import assert from "node:assert/strict";
import { message, targets } from "./message.ts";

const d = { endpoint: "https://push/d", p256dh: "p", auth: "a", app: "daybook" };
const i = { endpoint: "https://push/i", p256dh: "p", auth: "a", app: "inkwell" };
const old = { endpoint: "https://push/o", p256dh: "p", auth: "a" }; // signed up before apps were named

// Daybook's devices until an Inkwell one signs up; then Inkwell's only.
assert.deepEqual(targets([d, old]), { app: "daybook", subs: [d, old].map(({ endpoint, p256dh, auth }) => ({ endpoint, p256dh, auth })) });
assert.deepEqual(targets([d, i, old]).app, "inkwell");
assert.deepEqual(targets([d, i, old]).subs.map((s) => s.endpoint), ["https://push/i"]);
assert.deepEqual(targets([]), { app: "daybook", subs: [] });

const n = (more: Record<string, unknown>) => ({ id: "n1", user_id: "u", author: "Claude", title: "Pick a look", body: "", link: "https://claude.ai/t", kind: null, project: "Inkwell", resolved_at: null, ...more });
// Needs you: the Claude thread either way.
assert.equal(message(n({ kind: "decision" }), "inkwell").url, "https://claude.ai/t");
assert.equal(message(n({ kind: "decision" }), "inkwell").body, "Inkwell · a decision");
// Day review: Inkwell's review link; no mention of Daybook.
const r = message(n({ author: "Inkwell", title: "Your day review", link: "https://laserbunny-coder.github.io/inkwell/?review=2026-11-10" }), "inkwell");
assert.equal(r.url, "https://laserbunny-coder.github.io/inkwell/?review=2026-11-10");
assert.doesNotMatch(r.body, /Daybook/);
// Your week: its link (the tidy pass) in Inkwell, not Daybook's Notes.
const w = message(n({ author: "Inkwell", title: "Your week: Nov 2 to 8", link: "https://laserbunny-coder.github.io/inkwell/?tidy=2026-11-02" }), "inkwell");
assert.equal(w.url, "https://laserbunny-coder.github.io/inkwell/?tidy=2026-11-02");
assert.equal(message(n({ author: "Inkwell", title: "Your week: Nov 2 to 8" }), "daybook").url, "https://laserbunny-coder.github.io/daybook/?notes");
// Any other note: the Desk in Inkwell.
assert.equal(message(n({ link: null }), "inkwell").url, "https://laserbunny-coder.github.io/inkwell/?desk");
console.log("alerts message: all checks passed");
