// Checks the Acro HQ <-> Inkwell task sync plan and the meetings mirror with pretend data:
// run with  node --experimental-strip-types supabase/functions/acro-tasks/inkwell.test.ts
import assert from "node:assert/strict";
import type { Task } from "./sync.ts";
import { carryLinks, type IInput, type ILink, type Line, planInkwell } from "./inkwell.ts";
import { meetingLines, planMeetings, writeOut } from "./meetings.ts";

const task = (id: string, version: number, more: Record<string, unknown> = {}): Task => ({
  id, version, data: { title: id, notes: "", due: "", status: "todo", assignee: "Michael", ...more },
});
const line = (id: string, more: Partial<Line> & { task?: Record<string, unknown> } = {}): Line => {
  const { task: t, ...rest } = more;
  return {
    id, kind: "line", parent_id: "steps-wd", sort: 1024, text: id, content: null, tags: [], deleted: false,
    fields: { done: false, box: true, task: { v: 1, day: null, est: null, done_at: null, actual: null, log: [], run: null, order: 0, ...(t ?? {}) } }, ...rest,
  };
};
let n = 0;
const base = (o: Partial<IInput>): IInput => ({
  tasks: [], lines: [], notes: new Map(), links: [], acro: new Set(), under: new Map(), firstRun: false, stepsId: "steps-wd",
  now: 5000, today: "2026-11-10", boardUrl: "https://hq.example", newId: () => `n${++n}`, ...o,
});
const set = (st: any) => st.patch?.set ?? {};

// Daybook's links move onto the lines the import made; links to things not brought in stay where they are.
assert.deepEqual(carryLinks([{ item_id: "abc-1", task_id: "t1" }, { item_id: "zzz", task_id: "t2" }, { item_id: "li-x", task_id: "t3" }], new Set(["li-db-abc-1"])),
  [{ from: "abc-1", to: "li-db-abc-1", task_id: "t1" }]);

// First Inkwell run: a carried-over link is looked at afresh and the board's wording wins; open board tasks
// come over with their owner (Nate's too); what's already in the Acro project is only marked.
const carried = line("li-db-abc-1", { parent_id: "page-tasks", text: "QuickBooks", task: { day: "2026-11-12" } });
const loose = line("li-old", { text: "Order the NAS" });
let steps = planInkwell(base({
  firstRun: true,
  tasks: [task("t1", 4, { title: "QuickBooks catch-up", due: "2026-11-14", notes: "Ask Dana for the 1099s" }), task("nate1", 2, { title: "Film the promo", assignee: "Nate", due: "2026-11-20" }), task("old", 2, { status: "done" })],
  lines: [carried, loose], links: [{ item_id: "li-db-abc-1", task_id: "t1", seen: null }], acro: new Set(["li-old"]),
}));
const first = steps.find((s) => s.link?.item_id === "li-db-abc-1")!;
assert.equal(first.why, "board changed");
assert.equal(set(first).text, "QuickBooks catch-up");
assert.equal(set(first).fields.task.day, "2026-11-12", "planned for a working day: the day stays");
assert.equal(set(first).fields.hq.due, "2026-11-14", "and the due date is kept beside it");
assert.equal(set(first).fields.hq.id, "t1");
assert.ok(!first.board, "nothing goes to the board on a first look");
const noteIns = steps.find((s) => s.why === "board notes")!;
assert.equal(noteIns.insert![0].parent_id, "li-db-abc-1");
assert.equal(noteIns.insert![0].text, "Ask Dana for the 1099s");
assert.ok(steps.some((s) => s.why.startsWith("already") && s.link!.item_id === "li-old"));
const nate = steps.find((s) => s.why === "new on the board")!;
assert.equal(nate.insert![0].text, "Film the promo");
assert.equal(nate.insert![0].parent_id, "steps-wd");
assert.equal(nate.insert![0].fields.task.owner, "Nate");
assert.equal(nate.insert![0].fields.task.day, "2026-11-20");
assert.equal(nate.insert![0].fields.task.mark, "date");
assert.equal(steps.filter((s) => s.why === "new on the board").length, 1, "done ones stay on the board");

// Notes Daybook brought in under the line aren't added twice.
steps = planInkwell(base({ tasks: [task("t1", 4, { notes: "Ask Dana" })], lines: [carried], links: [{ item_id: carried.id, task_id: "t1", seen: null }], under: new Map([[carried.id, "Ask Dana"]]) }));
assert.ok(!steps.some((s) => s.why === "board notes"));

// In step afterwards: Inkwell renames and re-dates → the board; the board ticks done → Inkwell.
const synced = line("li-a", { text: "Renamed here", task: { day: "2026-11-15", mark: "date" }, fields: undefined as any });
synced.fields = { done: false, box: true, task: { v: 1, day: "2026-11-15", mark: "date", order: 0 }, hq: { id: "t1", due: "2026-11-14" } };
const seenV = { title: "QuickBooks catch-up", due: "2026-11-14", done: false, who: "Michael", notes: "" };
steps = planInkwell(base({ tasks: [task("t1", 4, { title: "QuickBooks catch-up", due: "2026-11-14" })], lines: [synced], links: [{ item_id: "li-a", task_id: "t1", seen: { v: 4, b: seenV, i: seenV } }] }));
assert.equal(steps[0].why, "Inkwell changed");
assert.deepEqual(steps[0].board!.data, { title: "Renamed here", due: "2026-11-15" });
assert.equal(steps[0].board!.if_version, 4);
steps = planInkwell(base({ tasks: [task("t1", 5, { title: "QuickBooks catch-up", due: "2026-11-14", status: "done" })], lines: [line("li-b", { text: "QuickBooks catch-up", task: { day: "2026-11-14", mark: "date" } })], links: [{ item_id: "li-b", task_id: "t1", seen: { v: 4, b: seenV, i: seenV } }] }));
assert.equal(set(steps[0]).fields.done, true);
assert.equal(set(steps[0]).fields.task.done_at, 5000);

// Only the owner ticks a task done: Michael ticking Nate's in Inkwell is put back.
const nv = { ...seenV, who: "Nate" };
const ticked = line("li-n", { text: "QuickBooks catch-up", task: { owner: "Nate", day: "2026-11-14", mark: "date" } });
ticked.fields.done = true;
steps = planInkwell(base({ tasks: [task("t9", 3, { title: "QuickBooks catch-up", due: "2026-11-14", assignee: "Nate" })], lines: [ticked], links: [{ item_id: "li-n", task_id: "t9", seen: { v: 3, b: nv, i: nv } }] }));
assert.ok(!steps[0].board, "nothing sent");
assert.equal(set(steps[0]).fields.done, false);
// …but handing a task to Nate from Inkwell does reach the board.
const handed = line("li-h", { text: "QuickBooks catch-up", task: { owner: "Nate", day: "2026-11-14", mark: "date" } });
steps = planInkwell(base({ tasks: [task("t1", 4, { title: "QuickBooks catch-up", due: "2026-11-14" })], lines: [handed], links: [{ item_id: "li-h", task_id: "t1", seen: { v: 4, b: seenV, i: seenV } }] }));
assert.deepEqual(steps[0].board!.data, { assignee: "Nate" });

// A new task line in the Acro project goes onto the board, with its notes and a link home.
const fresh = line("li-new", { text: "Call the insurance agent", task: { day: "2026-11-11", mark: "date" } });
steps = planInkwell(base({ lines: [fresh], acro: new Set(["li-new"]), under: new Map([["li-new", "Policy renews in Dec"]]) }));
const up = steps.find((s) => s.why === "new in Inkwell")!;
assert.equal(up.board!.id, "inkwell-li-new");
assert.equal(up.board!.data.assignee, "Michael");
assert.equal(up.board!.data.due, "2026-11-11");
assert.match(String(up.board!.data.notes), /Policy renews in Dec\n\nhttps:\/\/laserbunny-coder\.github\.io\/inkwell\/\?open=li-new/);
assert.equal(set(up).fields.hq.id, "inkwell-li-new");
// Sent to the board but the run was cut short before the link was kept: picked up again, not sent twice.
steps = planInkwell(base({ tasks: [task("inkwell-li-new", 1, { title: "Call the insurance agent" })], lines: [fresh], acro: new Set(["li-new"]) }));
assert.deepEqual(steps.map((s) => s.why), ["found on the board"]);
assert.equal(steps[0].link!.task_id, "inkwell-li-new");
// The line was marked but the board write failed: it is sent again.
const marked = line("li-new", { text: "Call the insurance agent", task: { day: "2026-11-11", mark: "date" } });
marked.fields.hq = { id: "inkwell-li-new", due: "2026-11-11" };
assert.equal(planInkwell(base({ lines: [marked], acro: new Set(["li-new"]) }))[0].why, "new in Inkwell");
// A copy of a synced line (it names someone else's board task) is left alone.
const copy = line("li-copy", { text: "Call the insurance agent", task: { day: "2026-11-11" } });
copy.fields.hq = { id: "t1" };
assert.equal(planInkwell(base({ lines: [copy], acro: new Set(["li-copy"]) })).length, 0);
// A task line outside the Acro project stays out of HQ.
assert.equal(planInkwell(base({ lines: [fresh], acro: new Set() })).length, 0);

// A board task deleted: an open line goes to Inkwell's Trash; a done one stays.
steps = planInkwell(base({ lines: [line("li-c")], links: [{ item_id: "li-c", task_id: "gone", seen: { v: 1, b: seenV, i: seenV } }] }));
assert.equal(set(steps[0]).fields.trashed, 5000);
assert.equal(steps[0].link!.task_id, null);

// Deleted by Michael in Inkwell (marked hqDelete): after a minute in the Trash it comes off the board, and the
// line is just a line in the Trash. Before that minute (time for Undo), or put in the Trash without the mark
// (a page went), or Nate's: the board is left alone.
const hqLine = (id: string, trashed: number, more: Record<string, unknown> = {}) => {
  const l = line(id);
  l.fields = { ...l.fields, hq: { id: "t9" }, trashed, trashedWith: id, ...more };
  return l;
};
const t9 = task("t9", 7);
const lk = (id: string) => [{ item_id: id, task_id: "t9", seen: { v: 7, b: seenV, i: seenV } }];
steps = planInkwell(base({ now: 70_000, tasks: [t9], lines: [hqLine("li-d", 5000, { hqDelete: 5000 })], links: lk("li-d") }));
assert.equal(steps.length, 1);
assert.deepEqual(steps[0].boardDelete, { id: "t9", if_version: 7 });
assert.equal(steps[0].unlink, "li-d");
assert.equal(set(steps[0]).fields.hq, undefined, "no longer tied to a board task");
assert.equal(set(steps[0]).fields.hqDelete, undefined);
assert.equal(set(steps[0]).fields.trashed, 5000, "still in the Trash");
assert.equal(planInkwell(base({ now: 30_000, tasks: [t9], lines: [hqLine("li-d", 5000, { hqDelete: 5000 })], links: lk("li-d") })).length, 0, "Undo still has time");
assert.equal(planInkwell(base({ now: 70_000, tasks: [t9], lines: [hqLine("li-d", 5000)], links: lk("li-d") })).length, 0, "no mark: the board stays");
assert.equal(planInkwell(base({ now: 70_000, tasks: [task("t9", 7, { assignee: "Nate" })], lines: [hqLine("li-d", 5000, { hqDelete: 5000 })], links: lk("li-d") })).length, 0, "Nate's stays");
// Already gone from the board too: only the link goes.
steps = planInkwell(base({ now: 70_000, tasks: [], lines: [hqLine("li-d", 5000, { hqDelete: 5000 })], links: lk("li-d") }));
assert.equal(steps[0].why, "deleted in both");
assert.ok(!steps[0].boardDelete);
assert.equal(steps[0].unlink, "li-d");
// Brought back from the Trash afterwards (no hq, no link): a new task line, so it goes back on the board.
const back = line("li-d");
steps = planInkwell(base({ tasks: [], lines: [back], links: [], acro: new Set(["li-d"]) }));
assert.equal(steps[0].why, "new in Inkwell");
assert.equal(steps[0].board!.id, "inkwell-li-d");

// Meetings: one read-only page each, with who, summary, decisions, action items and a link; the write-out on its own page.
const m = { id: "rec-1", version: 9, data: { status: "ready", title: "First meeting test", date: "2026-11-01", summary: "- Plan is live.\n- Weekly for now.", decisions: ["Run it every Sunday."], speakers: [{ id: 0, name: "Nate" }, { id: 1, name: "Michael" }], suggestions: [{ title: "Fix Style Lab", assignee: "Nate", due: "2026-11-05" }], claudeJobs: [{ title: "Run the weekly review" }], said: [{ s: 0, t: 0, text: "Here's Wednesday." }, { s: 1, t: 16, text: "Okay." }] } };
assert.deepEqual(meetingLines(m, "https://hq.example").map(([t]) => t), ["Who: Nate, Michael", "Summary", "Decisions", "Action items", "Open it in Acro HQ: https://hq.example/?meeting=rec-1"]);
assert.deepEqual(meetingLines(m, "https://hq.example")[3][1], ["Fix Style Lab (Nate, by 2026-11-05)", "Run the weekly review (Claude)"]);
assert.deepEqual(writeOut(m), ["Nate [0:00]: Here's Wednesday.", "Michael [0:16]: Okay."]);
let mp = planMeetings([m, { id: "rec-2", version: 1, data: { status: "written", title: "Not yet" } }], { meetingsPage: null, pages: new Map(), lines: new Map() }, "wd", "https://hq.example");
assert.deepEqual(mp.pages.map((p) => p.title), ["Meetings", "2026-11-01 · First meeting test", "Write-out"]);
assert.equal(mp.pages[1].fields.readonly, true);
assert.equal(mp.lines.filter((l) => l.parent_id === "pg-hq-mtg-rec-1").length, 5);
// Unchanged in HQ: nothing written. Changed: written again, and lines no longer there go.
const pages = new Map(mp.pages.map((p) => [p.id, p]));
mp = planMeetings([m], { meetingsPage: pages.get("pg-hq-meetings-wd")!, pages, lines: new Map() }, "wd", "https://hq.example");
assert.equal(mp.pages.length + mp.lines.length, 0);
const old = [...pages.values()].find((p) => p.id === "pg-hq-mtg-rec-1")!;
const oldLines = new Map([["pg-hq-mtg-rec-1", Array.from({ length: 9 }, (_x, i) => line(`li-hq-mtg-rec-1-${i}`))]]);
mp = planMeetings([{ ...m, version: 10, data: { ...m.data, decisions: [] } }], { meetingsPage: pages.get("pg-hq-meetings-wd")!, pages: new Map([[old.id, old]]), lines: oldLines }, "wd", "https://hq.example");
assert.ok(mp.pages.some((p) => p.id === "pg-hq-mtg-rec-1" && p.fields.hq.v === 10));
assert.ok(mp.gone.length > 0);
assert.ok(!mp.lines.some((l) => l.text === "Decisions"));

console.log("acro-tasks inkwell: all checks passed");
