// Acro HQ tasks <-> Daybook (Michael chose this on Nov 3). The HQ board is the one true list of business
// tasks; the ones assigned to Michael also live in Daybook's Business area, and the two are kept in step:
//   - A board task assigned to Michael that isn't done shows up in Daybook (Business area, linked back to it).
//   - A new task Michael (or a Claude) adds anywhere under Daybook's Business area goes onto the board as his.
//   - Checking off, reopening, or changing the title, notes or due date on either side changes the other.
//     If both sides changed the same thing between two runs, the board wins.
//   - A board task deleted, or given to someone else (Nate's tasks stay on the board only), goes to
//     Daybook's Trash if it wasn't done. Deleting in Daybook never deletes anything on the board.
// What was in the Business area before the first run is left alone (marked "skip"), except copies matched
// to their board task by hand. Repeating tasks and habits are never synced.
// This file only plans; index.ts reads both sides, runs the plan and saves the links.

export const PERSON = "Michael";
export const BY = "Daybook";

export type Item = {
  id: string; parent_id: string | null; title: string | null; notes: string | null; done: boolean; due: string | null;
  link: string | null; kind: string | null; area_id: string | null; deleted: boolean; sort: number | null;
  repeat_rule?: unknown; series_id?: string | null; habit?: boolean | null;
};
export type Task = { id: string; version: number; data: Record<string, any> };
export type Vals = { title: string; notes: string; due: string; done: boolean };
export type Seen = { v: number; b: Vals; i: Vals; prefer?: "daybook" };
export type Link = { item_id: string; task_id: string | null; seen: Seen | null };
export type BoardWrite = { collection: "tasks"; id: string; data: Record<string, unknown>; mode: "update" | "set"; if_version?: number };
// One unit of work: the board write (if any) goes first; if it's refused, nothing else in the step happens.
export type Step = {
  why: string;
  board?: BoardWrite;
  insertItem?: Record<string, unknown>;
  item?: { id: string; patch: Record<string, unknown> };
  link?: Link;        // saved after the writes
  unlink?: string;    // item id whose link row goes
};
export type Input = {
  tasks: Task[]; items: Item[]; links: Link[]; businessId: string; userId: string;
  firstRun: boolean; now: number; boardUrl: string; newId: () => string;
};

const FIELDS: (keyof Vals)[] = ["title", "notes", "due", "done"];
const s = (v: unknown) => (typeof v === "string" ? v : "");
export const boardVals = (t: Task): Vals => ({ title: s(t.data.title), notes: s(t.data.notes), due: s(t.data.due), done: t.data.status === "done" });
export const itemVals = (i: Item): Vals => ({ title: s(i.title), notes: s(i.notes), due: s(i.due), done: !!i.done });
export const taskLink = (boardUrl: string, id: string) => `${boardUrl.replace(/\/+$/, "")}/?task=${encodeURIComponent(id)}`;

function toBoard(p: Partial<Vals>, now: number) {
  const d: Record<string, unknown> = {};
  if (p.title !== undefined) d.title = p.title;
  if (p.notes !== undefined) d.notes = p.notes;
  if (p.due !== undefined) d.due = p.due;
  if (p.done === true) Object.assign(d, { status: "done", doneAt: now, doneBy: PERSON });
  if (p.done === false) Object.assign(d, { status: "todo", doneAt: { __delete__: true }, doneBy: { __delete__: true } });
  return d;
}
function toItem(p: Partial<Vals>) {
  const d: Record<string, unknown> = {};
  if (p.title !== undefined) d.title = p.title;
  if (p.notes !== undefined) d.notes = p.notes || null;
  if (p.due !== undefined) d.due = p.due || null;
  if (p.done !== undefined) d.done = p.done;
  return d;
}

/** Tasks under the Business area: no steps of their own, not repeating, not a habit, not deleted. */
export function businessTasks(items: Item[], businessId: string) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const hasKids = new Set(items.filter((i) => !i.deleted && i.parent_id).map((i) => i.parent_id!));
  const area = (i: Item) => {
    let cur: Item | undefined = i;
    for (let n = 0; cur && n < 50; n++) {
      if (!cur.parent_id) return cur.area_id;
      const up = byId.get(cur.parent_id);
      if (!up || up.deleted) return null;
      cur = up;
    }
    return null;
  };
  return items.filter((i) => !i.kind && !i.deleted && !hasKids.has(i.id) && !i.repeat_rule && !i.series_id && !i.habit && area(i) === businessId);
}

export function plan(inp: Input): Step[] {
  const steps: Step[] = [];
  const tasks = new Map(inp.tasks.map((t) => [t.id, t]));
  const items = new Map(inp.items.map((i) => [i.id, i]));
  const linkedItems = new Set(inp.links.map((l) => l.item_id));
  const linkedTasks = new Set(inp.links.filter((l) => l.task_id).map((l) => l.task_id!));

  // 1. Pairs already linked.
  for (const l of inp.links) {
    if (!l.task_id) continue;
    const it = items.get(l.item_id);
    if (!it) { steps.push({ why: "Daybook item gone", unlink: l.item_id }); continue; }
    if (it.deleted) continue; // in Daybook's Trash: leave both alone (restoring it picks the sync up again)
    const t = tasks.get(l.task_id);
    if (!t || t.data.assignee !== PERSON) {
      steps.push({
        why: t ? "board task given to someone else" : "board task deleted",
        item: it.done ? undefined : { id: it.id, patch: { deleted: true } },
        link: { item_id: it.id, task_id: null, seen: null },
      });
      continue;
    }
    const b = boardVals(t), i = itemVals(it);
    // A copy matched by hand has no "seen" yet: seen null means the board's wording wins, prefer "daybook" means
    // Daybook's does. Either way done on either side counts, and an empty field never wipes a filled one.
    const first = !l.seen || !!l.seen.prefer;
    const seen: Seen = first ? { v: -1, b, i } : l.seen!;
    const boardMoved = t.version !== seen.v;
    const toI: Partial<Vals> = {}, toB: Partial<Vals> = {};
    for (const f of FIELDS) {
      const bCh = boardMoved && b[f] !== seen.b[f], iCh = i[f] !== seen.i[f];
      if (b[f] === i[f]) continue;
      if (first) {
        if (f === "done") { if (b.done) toI.done = true; else toB.done = true; }
        else if (!b[f] || (l.seen?.prefer === "daybook" && i[f])) (toB as any)[f] = i[f];
        else (toI as any)[f] = b[f];
        continue;
      }
      if (bCh || !iCh) (toI as any)[f] = b[f];   // board changed (or neither did but they differ): board wins
      else (toB as any)[f] = i[f];               // only Daybook changed it
    }
    if (toI.title === "") delete toI.title;
    const nb = { ...b, ...toB }, ni = { ...i, ...toI };
    const wrote = Object.keys(toB).length > 0;
    const step: Step = { why: "in step", link: { item_id: it.id, task_id: t.id, seen: { v: t.version + (wrote ? 1 : 0), b: nb, i: ni } } };
    if (wrote) step.board = { collection: "tasks", id: t.id, data: toBoard(toB, inp.now), mode: "update", if_version: t.version };
    if (Object.keys(toI).length) step.item = { id: it.id, patch: toItem(toI) };
    const sameSeen = l.seen && JSON.stringify(l.seen) === JSON.stringify(step.link!.seen);
    if (step.board || step.item || !sameSeen) { step.why = wrote && step.item ? "both changed" : wrote ? "Daybook changed" : step.item ? "board changed" : "first look"; steps.push(step); }
  }

  // 2. New in Daybook's Business area. On the very first run everything already there is only marked as seen.
  for (const it of businessTasks(inp.items, inp.businessId)) {
    if (linkedItems.has(it.id)) continue;
    if (inp.firstRun || it.done || !s(it.title).trim()) { steps.push({ why: "already in Daybook before the sync", link: { item_id: it.id, task_id: null, seen: null } }); continue; }
    const id = `daybook-${it.id}`.slice(0, 200);
    if (tasks.has(id) || linkedTasks.has(id)) continue;
    const i = itemVals(it);
    const notes = [i.notes, it.link ? it.link : ""].filter(Boolean).join("\n\n");
    const link = it.link || taskLink(inp.boardUrl, id);
    steps.push({
      why: "new in Daybook",
      board: { collection: "tasks", id, mode: "set", data: { title: i.title, notes, due: i.due, assignee: PERSON, status: "todo", area: "Admin", school: "Both", createdAt: inp.now, order: inp.now, fromDaybook: true } },
      item: it.link ? undefined : { id: it.id, patch: { link } },
      link: { item_id: it.id, task_id: id, seen: { v: 1, b: { ...i, notes }, i } },
    });
  }

  // 3. New on the board for Michael and not done: add to Daybook's Business area, at the bottom.
  let sort = Math.max(0, ...inp.items.filter((i) => !i.parent_id && i.area_id === inp.businessId).map((i) => Number(i.sort) || 0)) + 1;
  for (const t of inp.tasks) {
    if (t.data.assignee !== PERSON || t.data.status === "done" || linkedTasks.has(t.id)) continue;
    const b = boardVals(t);
    if (!b.title.trim()) continue;
    const id = inp.newId();
    steps.push({
      why: "new on the board",
      insertItem: { id, user_id: inp.userId, parent_id: null, area_id: inp.businessId, title: b.title, notes: b.notes || null, due: b.due || null, done: false, link: taskLink(inp.boardUrl, t.id), sort: sort++, duration_min: 30 },
      link: { item_id: id, task_id: t.id, seen: { v: t.version, b, i: { ...b, done: false } } },
    });
  }
  return steps;
}
