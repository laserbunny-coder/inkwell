// Acro HQ meetings, mirrored read-only into Inkwell (Michael, Nov 8): the notes are made and kept in HQ,
// and every written-up meeting also shows on a Meetings page inside the Acro project, one page per meeting,
// so business planning in Inkwell can search, link and quote them. Edits happen in HQ and flow over: a
// meeting's page is written again whenever its HQ doc changes. The full write-out is on a page of its own
// under the meeting, so the meeting page stays short. This file only plans; index.ts writes.

import type { Line } from "./inkwell.ts";

export type Meeting = { id: string; version: number; data: Record<string, any> };
export type Page = { id: string; kind: string; parent_id: string | null; sort: number; title: string; fields: Record<string, any>; deleted: boolean };
export type Have = { meetingsPage: Page | null; pages: Map<string, Page>; lines: Map<string, Line[]> };

const s = (v: unknown) => (typeof v === "string" ? v : "");
const GAP = 1024;
export const MEETINGS_PAGE = (worldId: string) => `pg-hq-meetings-${worldId}`.slice(0, 120);
export const meetingPage = (id: string) => `pg-hq-mtg-${id}`.slice(0, 120);
const outPage = (id: string) => `pg-hq-out-${id}`.slice(0, 120);
const lineId = (page: string, n: number) => `li-${page.slice(3)}-${n}`;
const textRow = (text: string) => ({ text, content: text ? [{ type: "text", text }] : null, tags: [] as string[] });
const bullets = (v: unknown) => (Array.isArray(v) ? v.map((x) => s(x).trim()) : s(v).split(/\n+/).map((x) => x.replace(/^[-•*]\s*/, "").trim())).filter(Boolean);

/** The lines a meeting page holds, in order: [text, children]. */
export function meetingLines(m: Meeting, boardUrl: string): [string, string[]][] {
  const d = m.data;
  const who = Array.isArray(d.speakers) ? [...new Set(d.speakers.map((x: any) => s(x?.name).trim()).filter(Boolean))] : [];
  const out: [string, string[]][] = [];
  if (who.length) out.push([`Who: ${who.join(", ")}`, []]);
  const summary = bullets(d.summary);
  if (summary.length) out.push(["Summary", summary]);
  const decisions = bullets(d.decisions);
  if (decisions.length) out.push(["Decisions", decisions]);
  const tasks = (Array.isArray(d.suggestions) ? d.suggestions : []).map((t: any) => [s(t?.title).trim(), s(t?.assignee).trim(), s(t?.due).trim()]).filter((t: string[]) => t[0])
    .map(([title, a, due]: string[]) => `${title}${a ? ` (${a}${due ? `, by ${due}` : ""})` : due ? ` (by ${due})` : ""}`);
  const jobs = (Array.isArray(d.claudeJobs) ? d.claudeJobs : []).map((j: any) => s(j?.title).trim()).filter(Boolean).map((t: string) => `${t} (Claude)`);
  if (tasks.length || jobs.length) out.push(["Action items", [...tasks, ...jobs]]);
  out.push([`Open it in Acro HQ: ${boardUrl.replace(/\/+$/, "")}/?meeting=${encodeURIComponent(m.id)}`, []]);
  return out;
}

/** The whole write-out, a line per turn: "Nate [0:16]: …". */
export function writeOut(m: Meeting): string[] {
  const names = new Map((Array.isArray(m.data.speakers) ? m.data.speakers : []).map((x: any) => [Number(x?.id), s(x?.name)]));
  const said = Array.isArray(m.data.said) ? m.data.said : [];
  const stamp = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  if (said.length) return said.map((x: any) => `${names.get(Number(x?.s)) || `Speaker ${Number(x?.s) + 1}`} [${stamp(Number(x?.t) || 0)}]: ${s(x?.text).trim()}`).filter((l: string) => !/:\s*$/.test(l));
  return s(m.data.transcript).split(/\n+/).map((x) => x.trim()).filter(Boolean);
}

/** Everything to write for the meetings that are new or changed in HQ. */
export function planMeetings(meetings: Meeting[], have: Have, worldId: string, boardUrl: string): { pages: Page[]; lines: Line[]; gone: string[] } {
  const pages: Page[] = [];
  const lines: Line[] = [];
  const gone: string[] = [];
  const home = MEETINGS_PAGE(worldId);
  if (!have.meetingsPage || have.meetingsPage.deleted) pages.push({ id: home, kind: "page", parent_id: worldId, sort: 0, title: "Meetings", fields: { by: "hq", hqMeetings: true }, deleted: false });
  // Newest first on the Meetings page: the place comes from the date, so a page written alone lands right.
  const place = (d: string) => { const t = Date.parse(s(d).slice(0, 10)); return Number.isFinite(t) ? 4102444800 - t / 1000 : 4102444800; };
  const ready = meetings.filter((m) => m.data.status === "ready" && s(m.data.title));
  ready.forEach((m) => {
    const id = meetingPage(m.id);
    const was = have.pages.get(id);
    if (was && !was.deleted && was.fields?.hq?.v === m.version) return;
    const title = `${s(m.data.date) ? `${s(m.data.date)} · ` : ""}${s(m.data.title).trim()}`;
    pages.push({ id, kind: "page", parent_id: home, sort: place(m.data.date), title, fields: { by: "hq", readonly: true, hq: { meeting: m.id, v: m.version } }, deleted: false });
    const write = (page: string, rows: [string, string[]][]) => {
      const made = new Set<string>();
      let k = 0;
      rows.forEach(([text, kids], i) => {
        const lid = lineId(page, k++);
        made.add(lid);
        lines.push({ id: lid, kind: "line", parent_id: page, sort: (i + 1) * GAP, ...textRow(text), fields: { done: false, by: "hq", readonly: true }, deleted: false } as Line);
        kids.forEach((kid, j) => {
          const cid = lineId(page, k++);
          made.add(cid);
          lines.push({ id: cid, kind: "line", parent_id: lid, sort: (j + 1) * GAP, ...textRow(kid), fields: { done: false, by: "hq", readonly: true }, deleted: false } as Line);
        });
      });
      for (const old of have.lines.get(page) ?? []) if (!made.has(old.id) && !old.deleted) gone.push(old.id);
    };
    write(id, meetingLines(m, boardUrl));
    const said = writeOut(m);
    if (said.length) {
      const op = outPage(m.id);
      pages.push({ id: op, kind: "page", parent_id: id, sort: GAP, title: "Write-out", fields: { by: "hq", readonly: true, hq: { meeting: m.id, v: m.version } }, deleted: false });
      write(op, said.map((t) => [t, []]));
    }
  });
  return { pages, lines, gone };
}
