// Checks how a filed thought's answer is made safe: node --experimental-strip-types supabase/functions/inkwell/filing.test.ts
import assert from "node:assert/strict";
import { cleanFiling } from "./filing.ts";

const ids = new Set(["t1", "t2"]);

// Known places, once each; unknown ones dropped.
assert.deepEqual(cleanFiling({ kind: "file", places: [{ where: "drawer", text: "" }, { where: "drawer", text: "" }, { where: "moon", text: "" }, { where: "lookup", text: "" }], moves: [], said: "Filed in the Drawer" }, ids), {
  kind: "file", places: [{ where: "drawer", text: "" }, { where: "lookup", text: "" }], moves: [], said: "Filed in the Drawer",
});

// Plan moves only on today's tasks; add_today needs words.
const plan = cleanFiling({ kind: "plan", places: [], moves: [{ type: "first", task: "t2", text: "", first: false }, { type: "first", task: "nope", text: "", first: false }, { type: "add_today", task: "", text: "", first: true }, { type: "add_today", task: "", text: "Call the passport office", first: false }], said: "x" }, ids);
assert.equal(plan.kind, "plan");
assert.deepEqual(plan.moves.map((m) => m.type + ":" + (m.task || m.text)), ["first:t2", "add_today:Call the passport office"]);

// A plan answer with nothing usable is nothing; with places it's filed.
assert.equal(cleanFiling({ kind: "plan", places: [], moves: [{ type: "first", task: "gone", text: "", first: false }], said: "" }, ids).kind, "none");
assert.equal(cleanFiling({ kind: "plan", places: [{ where: "later", text: "Renew passport" }], moves: [], said: "" }, ids).kind, "file");

// A brain dump never changes the plan.
const dumped = cleanFiling({ kind: "plan", places: [], moves: [{ type: "first", task: "t1", text: "", first: false }], said: "" }, ids, true);
assert.equal(dumped.kind, "none");
assert.deepEqual(dumped.moves, []);

// Garbage in, nothing out.
assert.deepEqual(cleanFiling(null, ids), { kind: "none", places: [], moves: [], said: "" });
assert.equal(cleanFiling({ kind: "file", places: [] }, ids).kind, "none");

console.log("thoughts: all passed");
