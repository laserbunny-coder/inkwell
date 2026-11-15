// Checks how the morning talk's answer is made safe: node --experimental-strip-types supabase/functions/inkwell/dayshape.test.ts
import assert from "node:assert/strict";
import { cleanDay } from "./dayshape.ts";

const ids = new Set(["t1", "t2"]);

// Known tasks once each, unknown ids dropped, new ones need words.
const out = cleanDay({
  items: [
    { task: "t2", text: "whatever", small: false },
    { task: "nope", text: "Ghost", small: false },
    { task: "", text: "  Call   the passport office ", small: true },
    { task: "t2", text: "", small: false },
    { task: "", text: "", small: false },
    { task: "", text: "call the passport office", small: true },
    { task: "t1", text: "", small: "yes" },
  ],
  thoughts: ["A gag about a ninja who is scared of cats", "", 7],
  said: "Here is the day as I heard it",
}, ids);
assert.deepEqual(out.items, [
  { task: "t2", text: "", small: false },
  { task: "", text: "Call the passport office", small: true },
  { task: "t1", text: "", small: false },
]);
assert.deepEqual(out.thoughts, ["A gag about a ninja who is scared of cats", "7"]);
assert.equal(out.said, "Here is the day as I heard it");

// Garbage in, nothing out.
assert.deepEqual(cleanDay(null, ids), { items: [], thoughts: [], said: "" });
assert.deepEqual(cleanDay({ items: "x", thoughts: {} }, ids), { items: [], thoughts: [], said: "" });

console.log("day: all passed");
