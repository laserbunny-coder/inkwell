// Checks delete, restore and the Trash through the connector, with a pretend
// database: run with  node --experimental-strip-types supabase/functions/mcp/tools.test.ts
// The pretend database stamps deleted_at the way the trigger in
// migrations/20261101230000_trash.sql does.
import assert from "node:assert/strict";
import { type Db, handle, INSTRUCTIONS, type Row, type Update } from "./tools.ts";

const today = new Date().toISOString().slice(0, 10);
const add = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const row = (id: string, more: Partial<Row> = {}): Row => ({
  id, parent_id: null, title: id, notes: null, done: false, day: null, start_min: null, after_min: null, duration_min: 60, sort: 1, color: null,
  due: null, link: null, kind: null, area_id: null, deleted: false, ...more,
});
const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();

const store = new Map<string, Row>();
for (const r of [
  row("area-biz", { kind: "area", title: "Business" }),
  row("proj", { title: "Website", area_id: "area-biz", color: "area" }),
  row("s1", { parent_id: "proj", title: "Write copy", day: today, sort: 1, time_log: [{ start: ago(3), end: ago(2) }] }),
  row("s2", { parent_id: "proj", title: "Pick colours", sort: 2 }),
  row("old-step", { parent_id: "proj", title: "Old idea", sort: 3, deleted: true, deleted_at: ago(48) }),
  row("blk", { kind: "block", focus_on: "proj", title: "Website", day: today, start_min: 540, duration_min: 120 }),
  row("loose", { title: "Call the bank", day: today, area_id: "area-biz" }),
  row("walk", { title: "Walk", day: add(today, -7), repeat_rule: { every: "day" } }),
  row(`walk~${today}`, { title: "Walk", day: today, series_id: "walk", occurs_on: today, done: true, time_log: [{ start: ago(5), end: ago(4.5) }] }),
]) store.set(r.id, r);

let clock = Date.now();
const db: Db = {
  async load() { return [...store.values()].filter((r) => !r.deleted || r.occurs_on).map((r) => { const c = { ...r }; delete c.deleted_at; return c; }); },
  async loadDeleted(since) { return [...store.values()].filter((r) => r.deleted && r.deleted_at && r.deleted_at >= since).sort((a, b) => b.deleted_at!.localeCompare(a.deleted_at!)).map((r) => ({ ...r })); },
  async save(rows) {
    const at = new Date(clock += 60e3).toISOString(); // each save is a new moment, a minute later
    for (const r0 of rows) {
      const old = store.get(r0.id), r = { ...old, ...r0 } as Row;
      if (!("deleted_at" in r0) && old) r.deleted_at = old.deleted_at;
      if (!r.deleted || (r.series_id && !r.occurs_on)) r.deleted_at = null; else if (!r.deleted_at) r.deleted_at = at;
      store.set(r.id, r);
    }
  },
  async getFreeHours() { return 20; }, async setFreeHours() {}, async timeZone() { return "UTC"; },
  async listNotes() { return []; }, async addNote() { throw new Error("no"); },
  async listNeeds() { return []; }, async openNeed() { return null; }, async addNeed() { throw new Error("no"); }, async updateNeed() { throw new Error("no"); }, async getNeed() { return null; },
  async listUpdates(since, limit) { return updates.filter((u) => u.created_at >= since).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit); },
  async addUpdate(u) { const r = { ...u, id: `u${updates.length + 1}`, created_at: new Date().toISOString() } as Update; updates.push(r); return r; },
};
const updates: Update[] = [];
let n = 0;
async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await handle({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }, db) as { result: { content: { text: string }[]; isError?: boolean } };
  const text = r.result.content[0].text;
  if (r.result.isError) return { error: text };
  return JSON.parse(text);
}
const titles = (L: { title: string }[]) => L.map((x) => x.title).sort();

// The tools are listed and explained
const list = await handle({ jsonrpc: "2.0", id: 0, method: "tools/list" }, db) as { result: { tools: { name: string }[] } };
for (const t of ["delete_item", "restore_item", "list_deleted"]) assert.ok(list.result.tools.some((x) => x.name === t), t);
assert.match(INSTRUCTIONS, /delete_item/); assert.match(INSTRUCTIONS, /restore_item/); assert.match(INSTRUCTIONS, /list_deleted/);

// Before: the old step deleted two days ago is already in the Trash
let L = await call("list_deleted");
assert.deepEqual(titles(L.deleted), ["Old idea"]);

// 1. Delete a plain task
let r = await call("delete_item", { id: "loose" });
assert.equal(r.deleted.what, "task");
assert.equal(store.get("loose")!.deleted, true); assert.ok(store.get("loose")!.deleted_at);
r = await call("list_tasks");
assert.ok(!r.tasks.some((x: Row) => x.id === "loose"), "deleted task hidden from list_tasks");
r = await call("get_next_task", { area: "Business" });
assert.notEqual(r.next?.id, "loose");

// 2. Delete a project: its steps and its time block go with it; the step deleted before stays apart
const hoursBefore = (await call("get_free_hours")).weeks[0].scheduled_hours;
r = await call("delete_item", { id: "proj" });
assert.equal(r.deleted.what, "project"); assert.equal(r.deleted.steps_deleted, 2); assert.equal(r.deleted.time_blocks_removed, 1);
for (const id of ["proj", "s1", "s2", "blk"]) assert.equal(store.get(id)!.deleted, true, id);
assert.equal(store.get("old-step")!.deleted_at, store.get("old-step")!.deleted_at); // untouched
r = await call("list_projects"); assert.equal(r.projects.length, 0, "deleted project hidden from list_projects");
r = await call("list_tasks", { area: "Business" }); assert.equal(r.tasks.length, 0);
r = await call("list_blocks"); assert.equal(r.blocks.length, 0, "its block is gone from the plan");
const hoursAfter = (await call("get_free_hours")).weeks[0].scheduled_hours;
assert.ok(hoursAfter < hoursBefore, `week's hours drop (${hoursBefore} -> ${hoursAfter})`);
r = await call("get_area_progress", { from: today, to: today });
assert.ok(!JSON.stringify(r).includes("Write copy"), "deleted step's recorded time is left out of area progress");
r = await call("get_item", { id: "s1" }); assert.ok(r.error, "a deleted item can't be fetched");

// The Trash shows the project once (with its steps), the task, and the older step on its own
L = await call("list_deleted");
assert.deepEqual(titles(L.deleted), ["Call the bank", "Old idea", "Website"]);
assert.equal(L.deleted.find((x: { title: string }) => x.title === "Website").steps, 2);
assert.equal(L.deleted[0].title, "Website", "newest first");

// 3. Restore the project: steps and block come back, the older deleted step doesn't
r = await call("restore_item", { id: "proj" });
assert.equal(r.restored.id, "proj"); assert.equal(r.steps_restored, 2);
for (const id of ["proj", "s1", "s2", "blk"]) { assert.equal(store.get(id)!.deleted, false, id); assert.equal(store.get(id)!.deleted_at, null, id); }
assert.equal(store.get("old-step")!.deleted, true);
r = await call("list_projects"); assert.equal(r.projects[0].progress, "0/2 done");
assert.equal((await call("get_free_hours")).weeks[0].scheduled_hours, hoursBefore);
r = await call("restore_item", { id: "proj" }); assert.match(r.error, /isn't deleted/);

// Restoring a step whose project is deleted brings the project row back too, but not its other steps
await call("delete_item", { id: "proj" });
r = await call("restore_item", { id: "old-step" });
assert.deepEqual(r.also_restored.map((x: Row) => x.id), ["proj"]);
r = await call("get_item", { id: "proj" }); assert.deepEqual(r.steps.map((x: Row) => x.title), ["Old idea"]);
r = await call("restore_item", { id: "s1" }); assert.ok(!r.error); assert.equal(r.also_restored, undefined);

// 4. A repeating task: one repeat, then the whole series
const tomorrow = add(today, 1);
r = await call("delete_item", { id: `walk~${tomorrow}` });
assert.equal(r.deleted.what, "one repeat");
r = await call("list_tasks", { from: today, to: add(today, 3), include_done: true });
let walks = r.tasks.filter((x: Row) => x.series_id === "walk").map((x: Row) => x.day);
assert.ok(!walks.includes(tomorrow) && walks.includes(add(today, 2)) && walks.includes(today), "only that day is skipped");
L = await call("list_deleted"); assert.ok(L.deleted.some((x: { id: string; what: string }) => x.id === `walk~${tomorrow}` && x.what === "one repeat"));
r = await call("restore_item", { id: `walk~${tomorrow}` });
r = await call("list_tasks", { from: tomorrow, to: tomorrow });
assert.equal(r.tasks.filter((x: Row) => x.series_id === "walk").length, 1, "the repeat is back");

r = await call("delete_item", { id: "walk" });
assert.equal(r.deleted.what, "repeating task (every repeat)");
assert.equal(store.get(`walk~${today}`)!.deleted, true); assert.equal(store.get(`walk~${today}`)!.occurs_on, today, "keeps its day");
r = await call("list_tasks", { from: today, to: add(today, 3), include_done: true });
assert.equal(r.tasks.filter((x: Row) => x.series_id === "walk").length, 0, "no repeats left");
r = await call("list_tasks", { done_since: add(today, -1) });
assert.ok(!r.tasks.some((x: Row) => x.series_id === "walk"), "its finished repeat is out of the record too");
r = await call("get_area_progress", { from: today, to: today });
assert.ok(!JSON.stringify(r).includes("Walk"));
L = await call("list_deleted");
assert.equal(L.deleted.filter((x: { title: string }) => x.title === "Walk").length, 1, "the series shows once, not each repeat");
r = await call("restore_item", { id: "walk" });
r = await call("list_tasks", { from: today, to: add(today, 3), include_done: true });
walks = r.tasks.filter((x: Row) => x.series_id === "walk");
assert.equal(walks.length, 4); assert.equal(walks.find((x: Row) => x.day === today).done, true, "the stored repeat came back as it was");

// Things that aren't for delete_item
assert.match((await call("delete_item", { id: "area-biz" })).error, /area/);
assert.equal(store.get("blk")!.deleted, true, "the block went with the project's second delete, and restoring one step doesn't bring it back");
store.set("blk2", row("blk2", { kind: "block", focus_on: "area-biz", title: "Business", day: today, start_min: 600 }));
assert.match((await call("delete_item", { id: "blk2" })).error, /remove_block/);
assert.match((await call("delete_item", { id: "nope" })).error, /No item/);
assert.match((await call("restore_item", { id: "nope" })).error, /list_deleted/);

// A recording that's running when its task is deleted is closed, so it doesn't keep counting
store.set("rec", row("rec", { title: "Edit reel", time_log: [{ start: ago(1), end: null }] }));
await call("delete_item", { id: "rec" });
assert.ok(store.get("rec")!.time_log![0].end);

console.log("all trash checks passed");


// Updates: a thread logs what it did; the Catch-up reads them back
{
  const bad = await call("log_update", { text: "x", project: "Inkwell" });
  assert.match(bad.error, /link is required/);
  const wrong = await call("log_update", { text: "x", project: "Inkwell", link: "https://claude.ai/code/project/chan_1?thread=t", state: "shipped" });
  assert.match(wrong.error, /done, live or working/);
  const ok = await call("log_update", { text: "Woven scripts are live", state: "live", project: "Inkwell", thread: "Build Woven scripts", link: "https://claude.ai/code/project/chan_1?thread=t", place: "https://laserbunny-coder.github.io/inkwell/?open=w1" });
  assert.equal(ok.logged.state, "live"); assert.equal(ok.logged.place, "https://laserbunny-coder.github.io/inkwell/?open=w1");
  assert.equal(updates[0].project_link, "https://claude.ai/code/project/chan_1");
  const plain = await call("log_update", { text: "Started the catch-up", project: "Inkwell", link: "https://claude.ai/code/project/chan_1?thread=u" });
  assert.equal(plain.logged.state, "done"); assert.equal(plain.logged.place, undefined);
  const back = await call("list_updates");
  assert.deepEqual(back.updates.map((u: { text: string }) => u.text).sort(), ["Started the catch-up", "Woven scripts are live"]);
  assert.equal(back.updates.length, 2);
  assert.equal((await call("list_updates", { project: "acro" })).updates.length, 0);
  assert.ok(list.result.tools.some((x) => x.name === "log_update"));
  assert.match(INSTRUCTIONS, /log_update/);
}
console.log("updates ok");
