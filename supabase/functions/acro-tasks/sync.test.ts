// Checks the Acro HQ <-> Daybook task sync plan with pretend data:
// run with  node --experimental-strip-types supabase/functions/acro-tasks/sync.test.ts
import assert from "node:assert/strict";
import { businessTasks, type Item, type Link, plan, type Task } from "./sync.ts";

const item = (id: string, more: Partial<Item> = {}): Item => ({
  id, parent_id: null, title: id, notes: null, done: false, due: null, link: null, kind: null, area_id: "biz", deleted: false, sort: 1, ...more,
});
const task = (id: string, version: number, more: Record<string, unknown> = {}): Task => ({
  id, version, data: { title: id, notes: "", due: "", status: "todo", assignee: "Michael", ...more },
});
let n = 0;
const base = { businessId: "biz", userId: "u", firstRun: false, now: 1000, boardUrl: "https://hq.example", newId: () => `new${++n}` };
const vals = (title: string, done = false, notes = "", due = "") => ({ title, notes, due, done });

// Which items count as business tasks
const tree: Item[] = [
  item("biz", { kind: "area", area_id: null }), item("home", { kind: "area", area_id: null }),
  item("proj", { title: "NAS" }), item("step", { parent_id: "proj" }), item("gone-step", { parent_id: "proj", deleted: true }),
  item("loose"), item("personal", { area_id: "home" }), item("rep", { repeat_rule: { every: "month" } }), item("habit", { habit: true }),
  item("trash", { deleted: true }), item("block", { kind: "block" }),
];
assert.deepEqual(businessTasks(tree, "biz").map((i) => i.id).sort(), ["loose", "step"], "leaves under Business only");

// First run: what's already in Daybook is only marked; Michael's open board tasks come over; Nate's and done ones don't
let steps = plan({ ...base, firstRun: true, items: tree, links: [], tasks: [task("t1", 3), task("nate", 1, { assignee: "Nate" }), task("old", 2, { status: "done" })] });
assert.deepEqual(steps.filter((s) => s.why.startsWith("already")).map((s) => s.link!.item_id).sort(), ["loose", "step"]);
assert.ok(steps.every((s) => !s.board), "first run writes nothing to the board");
const ins = steps.filter((s) => s.insertItem);
assert.equal(ins.length, 1);
assert.equal(ins[0].insertItem!.title, "t1"); assert.equal(ins[0].insertItem!.link, "https://hq.example/?task=t1"); assert.equal(ins[0].insertItem!.area_id, "biz");
assert.deepEqual(ins[0].link!.seen, { v: 3, b: vals("t1"), i: vals("t1") });

// A linked pair
const seen = { v: 3, b: vals("t1"), i: vals("t1") };
const L: Link[] = [{ item_id: "i1", task_id: "t1", seen }];

// Nothing changed: nothing to do
steps = plan({ ...base, items: [item("i1", { title: "t1" })], links: L, tasks: [task("t1", 3)] });
assert.equal(steps.length, 0);

// Checked off in Daybook -> done on the board
steps = plan({ ...base, items: [item("i1", { title: "t1", done: true })], links: L, tasks: [task("t1", 3)] });
assert.equal(steps.length, 1);
assert.deepEqual(steps[0].board, { collection: "tasks", id: "t1", mode: "update", if_version: 3, data: { status: "done", doneAt: 1000, doneBy: "Michael" } });
assert.equal(steps[0].item, undefined); assert.equal(steps[0].link!.seen!.v, 4); assert.equal(steps[0].link!.seen!.b.done, true);

// Done on the board -> checked off in Daybook
steps = plan({ ...base, items: [item("i1", { title: "t1" })], links: L, tasks: [task("t1", 4, { status: "done" })] });
assert.equal(steps[0].board, undefined); assert.deepEqual(steps[0].item, { id: "i1", patch: { done: true } });

// "doing" on the board isn't done
steps = plan({ ...base, items: [item("i1", { title: "t1" })], links: L, tasks: [task("t1", 4, { status: "doing" })] });
assert.equal(steps.length, 1); assert.equal(steps[0].why, "first look"); assert.ok(!steps[0].board && !steps[0].item);

// Reopened in Daybook -> back to To do on the board
const Ld: Link[] = [{ item_id: "i1", task_id: "t1", seen: { v: 4, b: vals("t1", true), i: vals("t1", true) } }];
steps = plan({ ...base, items: [item("i1", { title: "t1" })], links: Ld, tasks: [task("t1", 4, { status: "done" })] });
assert.deepEqual(steps[0].board!.data, { status: "todo", doneAt: { __delete__: true }, doneBy: { __delete__: true } });

// Title renamed on the board, due date set in Daybook: each goes the other way
steps = plan({ ...base, items: [item("i1", { title: "t1", due: "2026-11-09" })], links: L, tasks: [task("t1", 4, { title: "Better name" })] });
assert.deepEqual(steps[0].item!.patch, { title: "Better name" }); assert.deepEqual(steps[0].board!.data, { due: "2026-11-09" });
assert.equal(steps[0].why, "both changed");

// Both changed the same thing: the board wins
steps = plan({ ...base, items: [item("i1", { title: "Daybook name" })], links: L, tasks: [task("t1", 4, { title: "Board name" })] });
assert.deepEqual(steps[0].item!.patch, { title: "Board name" }); assert.equal(steps[0].board, undefined);

// Given to Nate on the board -> Daybook copy goes to the Trash, and the sync lets go of it
steps = plan({ ...base, items: [item("i1", { title: "t1" })], links: L, tasks: [task("t1", 4, { assignee: "Nate" })] });
assert.deepEqual(steps[0].item, { id: "i1", patch: { deleted: true } }); assert.deepEqual(steps[0].link, { item_id: "i1", task_id: null, seen: null });
// ...but a done copy stays where it is
steps = plan({ ...base, items: [item("i1", { title: "t1", done: true })], links: L, tasks: [] });
assert.equal(steps[0].item, undefined); assert.equal(steps[0].why, "board task deleted");

// Deleted in Daybook: nothing happens on the board, and the task doesn't come back to Daybook
steps = plan({ ...base, items: [item("i1", { title: "t1", deleted: true, done: true })], links: L, tasks: [task("t1", 3)] });
assert.equal(steps.length, 0);

// A copy matched by hand (no seen yet): done on either side wins, other differences take the board's
steps = plan({ ...base, items: [item("i1", { title: "old wording", done: true })], links: [{ item_id: "i1", task_id: "t1", seen: null }], tasks: [task("t1", 7)] });
assert.deepEqual(steps[0].board!.data, { status: "done", doneAt: 1000, doneBy: "Michael" });
assert.deepEqual(steps[0].item!.patch, { title: "t1" });

// Matched with Daybook's wording preferred: Daybook's title and notes go to the board, the board's due date fills Daybook's empty one
steps = plan({ ...base, items: [item("i1", { title: "Daybook words", notes: "steps" })], links: [{ item_id: "i1", task_id: "t1", seen: { prefer: "daybook" } as any }], tasks: [task("t1", 7, { due: "2026-11-02", notes: "old" })] });
assert.deepEqual(steps[0].board!.data, { title: "Daybook words", notes: "steps" });
assert.deepEqual(steps[0].item!.patch, { due: "2026-11-02" });
assert.deepEqual(steps[0].link!.seen, { v: 8, b: vals("Daybook words", false, "steps", "2026-11-02"), i: vals("Daybook words", false, "steps", "2026-11-02") });

// New in Daybook's Business area (e.g. from Claude Duet) -> onto the board as Michael's
const marked: Link[] = [{ item_id: "loose", task_id: null, seen: null }, { item_id: "step", task_id: null, seen: null }];
steps = plan({ ...base, items: [...tree, item("fresh", { title: "Email Lon", notes: "about Dec", link: "https://thread", due: "2026-11-05" })], links: marked, tasks: [] });
assert.equal(steps.length, 1);
assert.deepEqual(steps[0].board!.data, { title: "Email Lon", notes: "about Dec\n\nhttps://thread", due: "2026-11-05", assignee: "Michael", status: "todo", area: "Admin", school: "Both", createdAt: 1000, order: 1000, fromDaybook: true });
assert.equal(steps[0].board!.id, "daybook-fresh"); assert.equal(steps[0].item, undefined, "keeps its own link");
// one without a link gets the board's
steps = plan({ ...base, items: [...tree, item("fresh2", { title: "Call gym" })], links: marked, tasks: [] });
assert.deepEqual(steps[0].item, { id: "fresh2", patch: { link: "https://hq.example/?task=daybook-fresh2" } });
// next run: in step, nothing to do
steps = plan({ ...base, items: [...tree, item("fresh2", { title: "Call gym", link: "x" })], links: [...marked, steps[0].link!], tasks: [task("daybook-fresh2", 1, { title: "Call gym" })] });
assert.equal(steps.length, 0);
// a personal task never goes
steps = plan({ ...base, items: [...tree, item("p2", { area_id: "home" })], links: marked, tasks: [] });
assert.equal(steps.length, 0);

console.log("acro-tasks sync: all checks passed");
