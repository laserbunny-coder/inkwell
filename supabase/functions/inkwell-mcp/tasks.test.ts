// Checks the connector's task, Needs you and Catch-up tools against a small
// pretend vault: run with  node --experimental-strip-types supabase/functions/inkwell-mcp/tasks.test.ts
import assert from "node:assert/strict";
import { type Db, type Entry, handle } from "./tools.ts";
import { addDays, dow, lands, nextOn } from "./taskrules.ts";

const TZ = "America/Los_Angeles";
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const T = (d: string) => new Date(d).toISOString();
const e = (id: string, kind: string, parent_id: string | null, more: Partial<Entry> = {}): Entry => ({
  id, kind, parent_id, sort: 1, title: "", text: "", content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false,
  created_at: T("2026-10-27T18:00:00Z"), updated_at: T("2026-10-27T18:00:00Z"), ...more,
});
const task = (day: string | null, more: Record<string, unknown> = {}) => ({ done: false, box: true, task: { v: 1, day, est: null, done_at: null, actual: null, log: [], run: null, order: 0, ...more } });

const rows: Entry[] = [
  e("area-business", "area", null, { title: "Business" }),
  e("wd-acro", "world", null, { title: "Acro", area_id: "area-business", fields: { life: true } }),
  e("steps-wd-acro", "page", "wd-acro", { title: "Steps" }),
  e("li-a1", "line", "steps-wd-acro", { text: "QuickBooks catch-up", sort: 1024, fields: task(TODAY, { est: 45, order: 1 }) }),
  e("li-a2", "line", "steps-wd-acro", { text: "Order the NAS", sort: 2048, fields: task(TODAY, { est: 30, order: 2 }) }),
  e("li-a3", "line", "li-a2", { text: "Synology or QNAP? #gear", sort: 1024, fields: { done: false } }),
  e("li-old", "line", "steps-wd-acro", { text: "Call the accountant", sort: 3072, fields: task(addDays(TODAY, -2), { est: 15, order: 1 }) }),
  e("li-nate", "line", "steps-wd-acro", { text: "Film the class promo", sort: 4096, fields: task(TODAY, { owner: "Nate" }) }),
  e("pg-ideas", "page", null, { title: "Ideas" }),
  e("li-plain", "line", "pg-ideas", { text: "Try a dolly zoom", fields: { done: false } }),
  e("li-walk", "line", "page-tasks", { text: "Walk", fields: task(addDays(TODAY, -3), { repeat: { every: "day", n: 1, from: addDays(TODAY, -10) }, habit: true }) }),
  e("page-tasks", "page", null, { title: "Tasks" }),
];
const needs: any[] = [];
const ups: any[] = [];

const db: Db = {
  outline: async () => rows.filter((r) => ["area", "world", "project", "page", "act", "chapter"].includes(r.kind) && !r.deleted),
  get: async (ids) => rows.filter((r) => ids.includes(r.id)),
  kids: async (ids) => rows.filter((r) => r.parent_id && ids.includes(r.parent_id) && !r.deleted),
  find: async () => [], tags: async () => [], rollup: async () => [], linkedFrom: async () => [],
  byKind: async (kinds) => rows.filter((r) => kinds.includes(r.kind) && !r.deleted),
  updateAbout: async () => {},
  insert: async (rs) => { for (const r of rs) { r.created_at ??= new Date().toISOString(); r.updated_at ??= r.created_at; } rows.push(...rs); },
  timeZone: async () => TZ,
  change: async (id, was, patch) => {
    const r = rows.find((x) => x.id === id);
    if (!r || ["about", "digest", "change", "tidy"].includes(r.kind) || (was && r.updated_at !== was)) return false;
    Object.assign(r, patch, { updated_at: new Date(Date.parse(r.updated_at!) + 1000).toISOString() });
    return true;
  },
  markChange: async (id, fields) => { const r = rows.find((x) => x.id === id && x.kind === "change"); if (r) r.fields = fields; },
  fileLinks: async (ids) => ids.map(() => null), keepFile: async () => {}, fetchFile: async () => null,
  tasks: async () => rows.filter((r) => r.kind === "line" && !r.deleted && (r.fields as any)?.task),
  setSettings: async (id, fields) => { const r = rows.find((x) => x.id === id); if (!r) return false; r.fields = fields; return true; },
  listNeeds: async (limit, all) => needs.filter((n) => all || !n.resolved_at).slice(0, limit),
  openNeed: async (link) => needs.find((n) => n.link === link && !n.resolved_at) ?? null,
  getNeed: async (id) => needs.find((n) => n.id === id) ?? null,
  addNeed: async (n) => { const x = { ...n, id: crypto.randomUUID(), task_ids: [], created_at: new Date().toISOString(), read_at: null, resolved_at: null }; needs.push(x); return x as any; },
  updateNeed: async (id, patch) => { const x = needs.find((n) => n.id === id); Object.assign(x, patch); return x; },
  listUpdates: async (since) => ups.filter((u) => u.created_at >= since).reverse(),
  addUpdate: async (u) => { const x = { ...u, id: crypto.randomUUID(), created_at: new Date().toISOString() }; ups.push(x); return x as any; },
};

let n = 0;
async function call(name: string, args: Record<string, unknown> = {}) {
  const r: any = await handle({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }, db);
  const text = r.result.content[0].text;
  return r.result.isError ? { error: text } : JSON.parse(text);
}
const get = (id: string) => rows.find((r) => r.id === id)! as any;

// The rules match the app's.
assert.equal(dow("2026-11-09"), 1, "Nov 9 2026 is a Monday");
assert.ok(lands({ every: "week", days: [1, 3], from: "2026-11-09" }, "2026-11-11"));
assert.ok(!lands({ every: "week", n: 2, days: [1], from: "2026-11-09" }, "2026-11-16"));
assert.equal(nextOn({ every: "month", from: "2026-01-31" }, "2026-01-31"), "2026-02-28");
assert.equal(nextOn({ every: "weekdays", from: "2026-11-09" }, "2026-11-13"), "2026-11-16");

// The tools are offered.
const tl: any = await handle({ jsonrpc: "2.0", id: 0, method: "tools/list" }, db);
for (const t of ["list_tasks", "add_task", "update_task", "order_day", "free_hours", "raise_needs_you", "clear_needs_you", "list_needs_you", "log_update", "list_updates"]) assert.ok(tl.result.tools.some((x: any) => x.name === t), t);
assert.ok(!tl.result.tools.find((x: any) => x.name === "raise_needs_you").description.includes("Daybook"));
const init: any = await handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} }, db);
assert.match(init.result.instructions, /Tasks and plans live in Inkwell/);

// Today: the day's own tasks, the one carried over, the habit that's due today; not Nate's.
let l = await call("list_tasks", { from: "today" });
assert.deepEqual(l.tasks.map((t: any) => t.text).sort(), ["Call the accountant", "Order the NAS", "QuickBooks catch-up", "Walk"]);
const old = l.tasks.find((t: any) => t.text === "Call the accountant");
assert.equal(old.carried_from, addDays(TODAY, -2));
assert.equal(l.tasks.find((t: any) => t.text === "Walk").repeats, "Every day");
assert.equal(l.tasks.find((t: any) => t.text === "QuickBooks catch-up").where, "Acro › Steps");
assert.equal(l.tasks.find((t: any) => t.text === "QuickBooks catch-up").project, "Acro");
assert.match(l.tasks[0].link, /^https:\/\/laserbunny-coder\.github\.io\/inkwell\/\?open=li-/);
l = await call("list_tasks", { from: "today", everyone: true });
assert.ok(l.tasks.some((t: any) => t.text === "Film the class promo" && t.owner === "Nate"));
// A week ahead: the habit on every day.
l = await call("list_tasks", { from: addDays(TODAY, 1), to: addDays(TODAY, 7) });
assert.equal(l.tasks.filter((t: any) => t.text === "Walk").length, 7);

// Add a task to a project: on its Steps page, at the end of the day's order, with notes and a link under it.
const a = await call("add_task", { text: "Send the HQ invoice 20m", to: "wd-acro", day: "today", notes: ["From the HQ board"], link: "https://acro-hq.laserbunny.workers.dev/t/9" });
assert.equal(a.to, "Acro › Steps");
assert.equal(a.est_minutes, 20);
const line = get(a.id);
assert.equal(line.text, "Send the HQ invoice");
assert.equal(line.parent_id, "steps-wd-acro");
assert.equal(line.fields.by, "claude");
assert.equal(line.fields.task.day, TODAY);
assert.equal(line.fields.task.order, 3, "after QuickBooks (1) and the NAS (2)");
assert.deepEqual(rows.filter((r) => r.parent_id === a.id).map((r) => r.text), ["From the HQ board", "https://acro-hq.laserbunny.workers.dev/t/9"]);
// Straight to a plan: the Tasks page. A world without a Steps page gets one.
const b = await call("add_task", { text: "Stretch", repeat: { every: "week", days: ["mon", "thu"] }, habit: true });
assert.equal(get(b.id).parent_id, "page-tasks");
assert.ok(["Monday and Thursday"].includes(b.repeats));
assert.ok([1, 4].includes(dow(get(b.id).fields.task.day)));
rows.push(e("wd-ninja", "world", null, { title: "The Ninja Bunch" }));
const c = await call("add_task", { text: "Board reel 2", to: "wd-ninja", day: addDays(TODAY, 3), until: addDays(TODAY, 9) });
assert.equal(get("steps-wd-ninja").title, "Steps");
assert.equal(get(c.id).fields.task.until, addDays(TODAY, 9));
assert.ok((await call("add_task", { text: "x", until: "2026-12-01" })).error, "a stretch needs a day");

// Change one: another day, an estimate. Recorded with an Undo.
const u = await call("update_task", { id: "li-a2", day: "tomorrow", est_minutes: 60, why: "Shop opens tomorrow" });
assert.deepEqual(u.changed, [`to ${addDays(TODAY, 1)}`, "60 min"]);
assert.equal(get("li-a2").fields.task.day, addDays(TODAY, 1));
assert.equal(get("li-a2").fields.task.est, 60);
assert.equal(get("li-a2").text, "Order the NAS", "never the words");
const undo = await call("undo_change", { change_id: u.change_id });
assert.ok(undo.undone);
assert.equal(get("li-a2").fields.task.day, TODAY);
assert.equal(get("li-a2").fields.task.est, 30);
// Any line can become a task; undone, it's a plain line again.
const m = await call("update_task", { id: "li-plain", day: "today", est_minutes: 10 });
assert.equal(get("li-plain").fields.task.day, TODAY);
assert.equal(get("li-plain").fields.box, true);
await call("undo_change", { change_id: m.change_id });
assert.equal(get("li-plain").fields.task, undefined);
assert.equal(get("li-plain").fields.box, undefined);
assert.ok((await call("update_task", { id: "li-plain" })).error, "a task needs a day or an estimate");
// A hard date moved: a reminder that the person must have asked.
await call("update_task", { id: "li-a1", mark: "hard" });
assert.match((await call("update_task", { id: "li-a1", day: "tomorrow" })).note, /hard date/);
await call("update_task", { id: "li-a1", day: "today" });

// Order the day; the ones left out follow.
const o = await call("order_day", { day: "today", ids: [a.id, "li-a1"] });
assert.deepEqual(o.order.slice(0, 2), ["Send the HQ invoice", "QuickBooks catch-up"]);
l = await call("list_tasks", { from: "today", to: "today" });
assert.deepEqual(l.tasks.filter((t: any) => !t.carried_from && !t.repeats).map((t: any) => t.text), ["Send the HQ invoice", "QuickBooks catch-up", "Order the NAS"]);
assert.ok((await call("order_day", { day: "today", ids: ["li-nope"] })).error);
const ou = await call("undo_change", { change_id: o.change_id });
assert.ok(ou.undone);

// Tick a task: it keeps when. A repeating one comes round again on its next day.
const d1 = await call("mark_done", { line_id: "li-a1" });
assert.equal(d1.done, true);
assert.ok(get("li-a1").fields.task.done_at > 0);
const w = await call("mark_done", { line_id: "li-walk" });
assert.equal(w.comes_round_again, addDays(TODAY, 1));
assert.equal(get("li-walk").fields.done, false);
assert.equal(get("li-walk").fields.task.did.at(-1)[0], TODAY);
l = await call("list_tasks", { done_since: "today" });
assert.deepEqual(l.tasks.map((t: any) => t.text).sort(), ["QuickBooks catch-up", "Walk"]);
await call("update_task", { id: "li-a1", actual_minutes: 70 });
assert.equal(get("li-a1").fields.task.actual, 70);
// Taking the tick back on the repeating one puts it back as it was.
await call("undo_change", { change_id: w.change_id });
assert.equal(get("li-walk").fields.task.day, addDays(TODAY, -3));
assert.equal((get("li-walk").fields.task.did ?? []).length, 0);

// Free hours: 45 unless set, and how full each week is.
let f = await call("free_hours");
assert.equal(f.free_hours, 45);
assert.equal(f.weeks.length, 4);
assert.ok(f.weeks[0].planned_hours > 0);
f = await call("free_hours", { hours: 30 });
assert.equal(f.free_hours, 30);
assert.equal(get("settings-plan").fields.free, 30);
assert.ok((await call("free_hours", { hours: 0 })).error);

// Needs you and Catch-up, the same as through Daybook's connector.
const link = "https://claude.ai/code/project/chan_1?thread=t1";
const r1 = await call("raise_needs_you", { kind: "decision", title: "Pick a look", project: "Inkwell", link });
assert.equal(r1.raised.project_link, "https://claude.ai/code/project/chan_1");
const r2 = await call("raise_needs_you", { kind: "review", title: "Try the phone drag", project: "Inkwell", link });
assert.ok(r2.updated);
assert.equal((await call("list_needs_you")).open.length, 1);
assert.ok((await call("clear_needs_you", { link })).cleared);
assert.equal((await call("list_needs_you")).open.length, 0);
assert.ok((await call("raise_needs_you", { kind: "nope", title: "x", project: "Inkwell", link })).error);
const lu = await call("log_update", { text: "Phone drag is live", state: "live", project: "Inkwell", thread: "Finish moving off Daybook", link });
assert.equal(lu.logged.state, "live");
assert.equal((await call("list_updates")).updates.length, 1);

console.log("inkwell-mcp tasks: all checks passed");
