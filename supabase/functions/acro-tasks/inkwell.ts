// Acro HQ tasks <-> Inkwell (the move off Daybook; spec /mnt/project-files/inkwell-tasks/build-spec.md).
// Once Daybook has been brought into Inkwell, the board syncs with Inkwell instead of Daybook's Business area:
//   - Every open board task shows up in Inkwell, on the Acro project's Steps page, with its owner: Michael's
//     are on his day, anyone else's (Nate's) only on planning views. Each line links back to its board task.
//   - A new task line Michael (or a Claude) adds anywhere in the Acro project goes onto the board, as his
//     unless he gave it to someone else.
//   - Words, due date, owner and done move both ways. Only the owner ticks a task done: ticking someone
//     else's in Inkwell doesn't reach the board (the board puts it back). If both sides changed the same
//     thing between two runs, the board wins.
//   - The board's notes come over as one line under the task (kept up to date); notes written in Inkwell
//     go to the board when the task is new there.
//   - A board task deleted goes to Inkwell's Trash if it wasn't done. A task of Michael's he deletes in Inkwell
//     (the app marks it hqDelete) is deleted on the board too, once it has been in the Trash a minute (time
//     for Undo). Putting a whole page or project in the Trash, or a Claude's delete, never touches the board.
//     Brought back from the Trash after that, it's a new task line again, and goes back on the board.
// Links Daybook made (acro_task_links.item_id = a Daybook id) carry over to the line the import made for that
// item (li-db-<id>), and are looked at afresh (the board's wording wins). This file only plans; index.ts runs it.

import { type BoardWrite, PERSON, taskLink, type Task } from "./sync.ts";

export type Line = {
  id: string; kind: string; parent_id: string | null; sort: number; text: string; content: unknown; tags: string[];
  fields: Record<string, any>; deleted: boolean;
};
export type IVals = { title: string; due: string; done: boolean; who: string; notes: string };
export type ISeen = { v: number; b: IVals; i: IVals };
export type ILink = { item_id: string; task_id: string | null; seen: ISeen | null };
export type IStep = {
  why: string;
  board?: BoardWrite;
  insert?: Line[];
  patch?: { id: string; set: Partial<Line> };
  link?: ILink;
  unlink?: string;
  /** A board task to delete (Michael deleted it in Inkwell). */
  boardDelete?: { id: string; if_version: number };
};
export type IInput = {
  tasks: Task[];
  /** Every live task line in the Acro project, and every line linked to a board task (wherever it is now). */
  lines: Line[];
  /** Notes lines the sync made (li-hqn-<task id>), by task id. */
  notes: Map<string, Line>;
  /** Ids of the lines that are in the Acro project (anywhere in it). */
  acro: Set<string>;
  /** The words of the lines under each task line (not the sync's notes line), joined. */
  under: Map<string, string>;
  links: ILink[];
  /** Lines in the Acro project from before Inkwell's first run: left alone, never sent to the board. */
  firstRun: boolean;
  stepsId: string;
  now: number; today: string; boardUrl: string; newId: () => string;
};

const GAP = 1024;
/** How long a task deleted in Inkwell waits in the Trash before it comes off the board (time for Undo). */
export const UNDO_TIME = 60_000;
const s = (v: unknown) => (typeof v === "string" ? v : "");
const clean = (t: string) => t.replace(/\s+/g, " ").trim();
const who = (a: unknown) => (s(a).trim() || PERSON);
export const boardIVals = (t: Task): IVals => ({ title: s(t.data.title), due: s(t.data.due).slice(0, 10), done: t.data.status === "done", who: who(t.data.assignee), notes: s(t.data.notes) });
const ownerOf = (task: Record<string, any> | undefined) => (task?.owner && task.owner !== "me" ? String(task.owner) : PERSON);
/** A line's due date: its day when that's a date to hit (or it has only that day), else what the board last said. */
export function lineDue(l: Line): string {
  const t = l.fields?.task;
  if (t?.mark && t.day) return t.day;
  return s(l.fields?.hq?.due);
}
export const lineIVals = (l: Line, notes: string): IVals => ({ title: s(l.text), due: lineDue(l), done: !!l.fields?.done, who: ownerOf(l.fields?.task), notes });

const blankTask = () => ({ v: 1, day: null, est: null, done_at: null, actual: null, log: [], run: null, order: 0 });
const textRow = (text: string) => ({ text, content: text ? [{ type: "text", text }] : null, tags: [...new Set([...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1].toLowerCase()))] });

/** What a line becomes when the board's values reach it. */
function lineSet(l: Line, p: Partial<IVals>, taskId: string, now: number): Partial<Line> {
  const set: Partial<Line> = {};
  const fields = { ...(l.fields ?? {}) };
  const task = { ...blankTask(), ...(fields.task ?? {}) };
  if (p.title !== undefined && p.title.trim()) Object.assign(set, textRow(p.title));
  if (p.done !== undefined) { fields.done = p.done; task.done_at = p.done ? (task.done_at || now) : null; }
  if (p.who !== undefined) task.owner = p.who === PERSON ? null : p.who;
  if (p.due !== undefined) {
    // A due date is a date to hit on its day, unless the task is planned for a working day of its own.
    if (!p.due) { if (task.mark && task.mark !== "hard") task.mark = null; }
    else if (task.mark || !task.day) { task.day = p.due; task.mark = task.mark || "date"; }
  }
  fields.task = task;
  fields.box = true;
  fields.hq = { ...(fields.hq ?? {}), id: taskId, link: fields.hq?.link, due: p.due ?? fields.hq?.due ?? "" };
  set.fields = fields;
  return set;
}

function toBoard(p: Partial<IVals>, now: number) {
  const d: Record<string, unknown> = {};
  if (p.title !== undefined) d.title = p.title;
  if (p.due !== undefined) d.due = p.due;
  if (p.who !== undefined) d.assignee = p.who;
  if (p.done === true) Object.assign(d, { status: "done", doneAt: now, doneBy: PERSON });
  if (p.done === false) Object.assign(d, { status: "todo", doneAt: { __delete__: true }, doneBy: { __delete__: true } });
  return d;
}

/** The notes line under a task: made, changed, or left. */
function notesStep(lineId: string, taskId: string, want: string, have: Line | undefined): Line[] | { id: string; set: Partial<Line> } | null {
  const text = clean(want);
  if (!have) {
    if (!text) return null;
    return [{ id: `li-hqn-${taskId}`.slice(0, 120), kind: "line", parent_id: lineId, sort: 1, ...textRow(text), fields: { done: false, by: "hq", hqNotes: taskId }, deleted: false } as Line];
  }
  if (clean(have.text) === text && !have.deleted) return null;
  return { id: have.id, set: { ...textRow(text), deleted: false } };
}

export function planInkwell(inp: IInput): IStep[] {
  const steps: IStep[] = [];
  const tasks = new Map(inp.tasks.map((t) => [t.id, t]));
  const lines = new Map(inp.lines.map((l) => [l.id, l]));
  const linked = new Set(inp.links.map((l) => l.item_id));
  const linkedTasks = new Set(inp.links.filter((l) => l.task_id).map((l) => l.task_id!));

  // 1. Pairs already linked.
  for (const l of inp.links) {
    if (!l.task_id) continue;
    const ln = lines.get(l.item_id);
    if (!ln) { steps.push({ why: "Inkwell line gone", unlink: l.item_id }); continue; }
    const t = tasks.get(l.task_id);
    if (ln.deleted || ln.fields?.trashed) {
      // Deleted by Michael in Inkwell, meaning it: off the board too (his own tasks only), then it's
      // just a line in the Trash. Anything else in the Trash: leave both alone.
      const meant = Number(ln.fields?.hqDelete) > 0 && (ln.deleted || inp.now - Number(ln.fields?.trashed) >= UNDO_TIME);
      if (!meant) continue;
      if (t && boardIVals(t).who !== PERSON) continue;
      const { hq: _hq, hqDelete: _d, ...fields } = ln.fields;
      steps.push({
        why: t ? "deleted in Inkwell" : "deleted in both",
        ...(t ? { boardDelete: { id: t.id, if_version: t.version } } : {}),
        patch: { id: ln.id, set: { fields } },
        unlink: ln.id,
      });
      continue;
    }
    if (!t) {
      steps.push({
        why: "board task deleted",
        patch: ln.fields?.done ? undefined : { id: ln.id, set: { fields: { ...ln.fields, trashed: inp.now, trashedWith: ln.id } } },
        link: { item_id: ln.id, task_id: null, seen: null },
      });
      continue;
    }
    const noteLine = inp.notes.get(t.id);
    const b = boardIVals(t), i = lineIVals(ln, b.notes); // notes only ever flow board → Inkwell
    const first = !l.seen;
    const seen: ISeen = first ? { v: -1, b, i } : l.seen!;
    const boardMoved = t.version !== seen.v;
    const toI: Partial<IVals> = {}, toB: Partial<IVals> = {};
    for (const f of ["title", "due", "done", "who"] as const) {
      if (b[f] === i[f]) continue;
      if (first) { (toI as any)[f] = b[f]; continue; }        // carried over or matched: the board's wording wins
      const bCh = boardMoved && b[f] !== seen.b[f], iCh = i[f] !== seen.i[f];
      if (bCh || !iCh) (toI as any)[f] = b[f];
      else if (f === "done" && b.who !== PERSON) (toI as any)[f] = b[f]; // only the owner ticks it done
      else (toB as any)[f] = i[f];
    }
    if (toI.title === "") delete toI.title;
    const nb = { ...b, ...toB }, ni = { ...i, ...toI };
    const wrote = Object.keys(toB).length > 0;
    const step: IStep = { why: "in step", link: { item_id: ln.id, task_id: t.id, seen: { v: t.version + (wrote ? 1 : 0), b: nb, i: ni } } };
    if (wrote) step.board = { collection: "tasks", id: t.id, data: toBoard(toB, inp.now), mode: "update", if_version: t.version };
    const needHq = ln.fields?.hq?.id !== t.id;
    if (Object.keys(toI).length || needHq) step.patch = { id: ln.id, set: lineSet(ln, toI, t.id, inp.now) };
    if (step.patch) (step.patch.set.fields as any).hq.link = taskLink(inp.boardUrl, t.id);
    // Notes the line already has under it (brought in from Daybook, say) aren't added twice.
    const already = !noteLine && clean(b.notes) && clean(inp.under.get(ln.id) ?? "").includes(clean(b.notes));
    const ns = already ? null : notesStep(ln.id, t.id, b.notes, noteLine);
    const sameSeen = l.seen && JSON.stringify(l.seen) === JSON.stringify(step.link!.seen);
    if (step.board || step.patch || !sameSeen) {
      step.why = wrote && step.patch ? "both changed" : wrote ? "Inkwell changed" : step.patch ? "board changed" : "first look";
      steps.push(step);
    }
    if (ns) steps.push(Array.isArray(ns) ? { why: "board notes", insert: ns } : { why: "board notes", patch: ns });
  }

  // 2. New task lines in the Acro project. On Inkwell's very first run everything already there is only marked as seen.
  for (const ln of inp.lines) {
    if (linked.has(ln.id) || ln.deleted || ln.fields?.trashed || !ln.fields?.task || ln.fields?.hqNotes) continue;
    if (!inp.acro.has(ln.id)) continue;
    const id = `inkwell-${ln.id}`.slice(0, 200);
    // A line that already names a board task other than its own (a copy of a synced line) is left alone.
    if (ln.fields?.hq?.id && ln.fields.hq.id !== id) continue;
    if (linkedTasks.has(id)) continue;
    // Sent before but the link wasn't kept (a run cut short): pick the pair up again, the board's wording first.
    if (tasks.has(id)) { linkedTasks.add(id); steps.push({ why: "found on the board", link: { item_id: ln.id, task_id: id, seen: null } }); continue; }
    if (!ln.fields?.hq?.id && (inp.firstRun || ln.fields?.done || !s(ln.text).trim())) { steps.push({ why: "already in Inkwell before the sync", link: { item_id: ln.id, task_id: null, seen: null } }); continue; }
    const i = lineIVals(ln, inp.under.get(ln.id) ?? "");
    const link = `https://laserbunny-coder.github.io/inkwell/?open=${encodeURIComponent(ln.id)}`;
    const notes = [i.notes, link].filter(Boolean).join("\n\n");
    steps.push({
      why: "new in Inkwell",
      board: { collection: "tasks", id, mode: "set", data: { title: i.title, notes, due: i.due, assignee: i.who, status: "todo", area: "Admin", school: "Both", createdAt: inp.now, order: inp.now, fromInkwell: true } },
      patch: { id: ln.id, set: { fields: { ...ln.fields, hq: { id, link: taskLink(inp.boardUrl, id), due: i.due } } } },
      link: { item_id: ln.id, task_id: id, seen: { v: 1, b: { ...i, notes }, i: { ...i, notes } } },
    });
  }

  // 3. New on the board and not done (anyone's): a line on the Acro project's Steps page, at the bottom.
  let sort = Math.max(0, ...inp.lines.filter((l) => l.parent_id === inp.stepsId).map((l) => Number(l.sort) || 0)) + GAP;
  for (const t of inp.tasks) {
    if (t.data.status === "done" || linkedTasks.has(t.id)) continue;
    const b = boardIVals(t);
    if (!b.title.trim()) continue;
    const id = `li-hq-${inp.newId()}`;
    const line: Line = {
      id, kind: "line", parent_id: inp.stepsId, sort, ...textRow(b.title), deleted: false,
      fields: { done: false, box: true, by: "hq", task: { ...blankTask(), owner: b.who === PERSON ? null : b.who, ...(b.due ? { day: b.due, mark: "date" } : {}) }, hq: { id: t.id, link: taskLink(inp.boardUrl, t.id), due: b.due } },
    } as Line;
    sort += GAP;
    const ins: Line[] = [line];
    const ns = notesStep(id, t.id, b.notes, undefined);
    if (Array.isArray(ns)) ins.push(...ns);
    steps.push({ why: "new on the board", insert: ins, link: { item_id: id, task_id: t.id, seen: { v: t.version, b, i: { ...b, done: false } } } });
  }
  return steps;
}

/** Links Daybook made, moved onto the lines the import made for those items. */
export function carryLinks(links: { item_id: string; task_id: string | null }[], lineIds: Set<string>): { from: string; to: string; task_id: string | null }[] {
  const key = (id: string) => String(id).replace(/[^A-Za-z0-9_-]/g, "");
  return links.filter((l) => !l.item_id.startsWith("li-")).map((l) => ({ from: l.item_id, to: `li-db-${key(l.item_id)}`, task_id: l.task_id })).filter((m) => lineIds.has(m.to));
}
