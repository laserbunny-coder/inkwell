// Business meetings from Inkwell go to Acro HQ, Michael and Nate's board: the
// meeting itself (title, date, summary, write-out) and its tasks, each with
// who's doing it. Acro HQ is reached through its Acro Meta connector, the same
// one both Claudes use; its address (which works like a password) is the
// ACRO_CONNECTOR_URL secret. Sending again updates the same cards rather than
// adding more, and never moves a task someone has already started or finished.
import { json } from "../_shared/common.ts";

const BY = "Inkwell";
const AREAS = ["Content", "Social", "Ads", "Live", "Admin"];
const SCHOOLS = ["Flip & Dance", "Cheer", "Both"];
const ID = /^inkwell-[A-Za-z0-9_\-.~:]{1,180}$/;

type Task = { id?: string; title?: string; notes?: string; assignee?: string; due?: string; area?: string; school?: string };
type Meeting = { id?: string; title?: string; date?: string; summary?: string; transcript?: string };
export type AcroBody = { meeting?: Meeting; tasks?: Task[] };

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const fail = (message: string, status: number, code?: string) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

// One tool call on the connector (plain JSON-RPC; the connector keeps no session).
export async function callTool(url: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw fail("Acro HQ didn't answer. It'll try again.", 504);
  }
  if (res.status === 404) throw fail("The Acro HQ connector address isn't right.", 503, "no-acro");
  if (!res.ok) throw fail(`Acro HQ returned an error (${res.status}).`, 502);
  const out = await res.json();
  if (out?.error) throw fail(`Acro HQ refused it: ${out.error.message ?? "unknown"}`, 502);
  const r = out?.result ?? {};
  if (r.isError) throw Object.assign(fail(String(r.content?.[0]?.text ?? "Acro HQ refused it."), 422), { tool: true });
  return (r.structuredContent ?? {}) as Record<string, unknown>;
}

// The version of a doc that's there already, or null for a new one.
async function versionOf(url: string, collection: string, id: string): Promise<{ version: number; data: Record<string, unknown> } | null> {
  try {
    const doc = await callTool(url, "board_get", { collection, id });
    return { version: Number(doc.version), data: (doc.data ?? {}) as Record<string, unknown> };
  } catch (err) {
    if ((err as { tool?: boolean }).tool && /^No /.test((err as Error).message)) return null;
    throw err;
  }
}

export function tidyTask(t: Task) {
  return {
    id: str(t.id, 200),
    title: str(t.title, 200),
    notes: str(t.notes, 4000),
    assignee: ["Michael", "Nate"].find((p) => p.toLowerCase() === str(t.assignee, 40).split(/\s+/)[0]?.toLowerCase()) ?? "",
    due: /^\d{4}-\d{2}-\d{2}$/.test(str(t.due, 10)) ? str(t.due, 10) : "",
    area: AREAS.includes(str(t.area, 20)) ? str(t.area, 20) : "Admin",
    school: SCHOOLS.includes(str(t.school, 20)) ? str(t.school, 20) : "Both",
  };
}

export async function sendToAcro(body: AcroBody): Promise<Response> {
  const url = Deno.env.get("ACRO_CONNECTOR_URL");
  if (!url || !/^https:\/\//.test(url)) return json({ error: "Sending to Acro HQ isn't set up yet.", code: "no-acro" }, 503);
  const tasks = (body.tasks ?? []).map(tidyTask).filter((t) => t.title && ID.test(t.id)).slice(0, 40);
  const m = body.meeting ?? {};
  const meetingId = str(m.id, 200);
  const docs: { collection: string; id: string; data: Record<string, unknown>; fresh: Record<string, unknown> }[] = [];
  if (ID.test(meetingId)) {
    docs.push({
      collection: "meetings", id: meetingId,
      data: { title: str(m.title, 200) || "Meeting", date: str(m.date, 10), summary: str(m.summary, 20000), transcript: str(m.transcript, 200000) },
      fresh: { createdAt: Date.now() },
    });
  }
  for (const t of tasks) {
    const { id, ...data } = t;
    docs.push({ collection: "tasks", id, data, fresh: { status: "todo", createdAt: Date.now() } });
  }
  if (!docs.length) return json({ sent: 0 });
  try {
    const now = await Promise.all(docs.map((d) => versionOf(url, d.collection, d.id)));
    const writes = docs.map((d, i) => {
      const cur = now[i];
      if (!cur) return { collection: d.collection, id: d.id, data: { ...d.data, ...d.fresh }, mode: "set" };
      // A task already started or done keeps where it is; only its words change.
      return { collection: d.collection, id: d.id, data: d.data, mode: "update", if_version: cur.version };
    });
    await callTool(url, "board_write", { by: BY, writes });
    return json({ sent: tasks.length, meeting: ID.test(meetingId) });
  } catch (err) {
    const e = err as Error & { code?: string; status?: number };
    console.error(e);
    return json({ error: e.message, code: e.code ?? null }, e.status ?? 500);
  }
}
