// Checks the summary helpers: node --experimental-strip-types supabase/functions/inkwell-digest/digest.test.ts
import assert from "node:assert/strict";
import * as d from "./digest.ts";
assert.equal(d.mondayOf("2026-11-01"), "2026-10-26");
assert.equal(d.mondayOf("2026-10-26"), "2026-10-26");
assert.equal(d.weekTitle("2026-10-26"), "Week of Oct 26 – Nov 1, 2026");
assert.equal(d.weekTitle("2026-11-02"), "Week of Nov 2 – 8, 2026");
assert.equal(d.monthEnd("2026-02"), "2026-02-28");
assert.equal(d.dayStart("2026-11-02","America/Los_Angeles"), "2026-11-02T08:00:00.000Z");
let p = d.periodsDue("2026-11-02");
assert.equal(p.weeks.at(-1), "2026-10-26"); assert.equal(p.weeks.length, 8);
assert.ok(p.months.includes("2026-10")); assert.ok(!d.periodsDue("2026-11-01").months.includes("2026-10"));
const rows = [
 {id:"a",kind:"line",parent_id:"day-2026-10-27",title:"",text:"Gift idea #gift",tags:["gift"],fields:{},created_at:"2026-10-27T10:00:00Z"},
 {id:"b",kind:"line",parent_id:"a",title:"",text:"ramen kit",tags:[],fields:{},created_at:"2026-10-27T10:01:00Z"},
 {id:"c",kind:"line",parent_id:"day-2026-10-27",title:"",text:"claude note",tags:[],fields:{by:"claude"},created_at:"2026-10-27T10:02:00Z"},
 {id:"e",kind:"para",parent_id:"ch",title:"",text:"prose",tags:[],fields:{},created_at:"2026-10-27T10:03:00Z"},
];
const w = d.weekPrompt(rows as any, (r)=> r.kind==="para" ? "Novel › Ch 1" : "Daily page 2026-10-27");
const t = d.tidy({summary:"x",threads:[{title:"Gift",gist:"g",from:["L2","L9"]}],tags:["#Mom"]}, w.labels, "L");
assert.deepEqual(t.threads[0].ids,["b"]); assert.deepEqual(t.keywords,["mom"]);
// Promises: labels back to line ids, one per line, empty tasks dropped.
const t2 = d.tidy({ summary: "x", threads: [], tags: [], promises: [{ task: "Call the venue", from: "L1" }, { task: "Again", from: "L1" }, { task: "", from: "L2" }, { task: "Nope", from: "L9" }] }, w.labels, "L");
assert.deepEqual(t2.promises, [{ task: "Call the venue", line: "a" }]);
assert.ok(d.WEEK_SCHEMA.required.includes("promises") && !d.SCHEMA.required.includes("promises"));
// Done lines are marked for Claude.
const w2 = d.weekPrompt([{ ...rows[0], fields: { done: true } }] as any, () => "Daily page");
assert.match(w2.text, /\(done\)/);
// The Monday note: gist, offers for open promises only, the tidy count.
const week = { id: "dg-week-2026-10-26", title: "Week of Oct 26 – Nov 1, 2026", text: "You planned Christmas.\n\nMore.", fields: { promises: [{ task: "Book the cabin", line: "a" }, { task: "Call Nate", line: "b" }, { task: "Gone", line: "z" }] } };
const note = d.mondayNote(week, new Map([["a", { created_at: "2026-10-27T18:00:00Z" }], ["b", { done: true }]]), 3, "https://x/inkwell/", "America/Los_Angeles");
assert.equal(note.title, "Your week, Oct 26 – Nov 1");
assert.equal(note.offers.length, 1);
assert.deepEqual(note.offers[0], { id: "inkwell-week-2026-10-26-1", title: "Book the cabin", link: "https://x/inkwell/?open=a", day: "Tue" });
assert.match(note.body, /^You planned Christmas\./);
assert.match(note.body, /3 tidy-ups/);
assert.doesNotMatch(d.mondayNote(week, new Map(), 0, "", "UTC").body, /said you'd|tidy/);
console.log("ok");
const ml = d.monthLetter("2026-10", "You spent October on the Ninja Bunch.\n\nLater, gifts.", [{ title: "Ninja Bunch reels" }, { title: "Christmas" }]);
assert.equal(ml.title, "Your month, October");
assert.match(ml.body, /^You spent October on the Ninja Bunch\.\n\n\*\*What it was about:\*\* Ninja Bunch reels · Christmas/);
assert.doesNotMatch(ml.body, /gifts/);
console.log("month letter ok");
