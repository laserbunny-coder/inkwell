// Acro HQ's meeting recordings (Michael, Nov 2): a recording added on HQ's Meetings tab (or shared to HQ
// from the phone) waits there as a meetings doc with status "new". Each step here takes one meeting one
// stage further, through HQ's Acro Meta connector:
//   new     -> written: ElevenLabs writes it out with the speakers told apart (../inkwell/speech.ts)
//   written -> ready:   Claude names the speakers and writes the summary, decisions and suggested tasks,
//                       with HQ's business context (settings/brief, open tasks) and Michael's own rules
//                       (settings/meetings.rules, edited on the board's "Meeting rules"), plus what Claude
//                       could do itself: each goes up as a card on HQ's Review (approvals, kind "change",
//                       action "ad-new" | "reel-new" | "claude-job" | "claude-build"), and one yes there starts the
//                       work: on Michael's PC (acro-hq video/jobs.py) or, for claude-build, by Claude in the cloud. Nothing is made before that yes.
// A step claims its meeting first (status writing/thinking, lockedUntil), so two runs never do the same one,
// and a run that dies is picked up again once the lock runs out.
import type { Said } from "../inkwell/speech.ts";

export type Tool = (name: string, args: Record<string, unknown>) => Promise<Record<string, any>>;
export type Hear = (blob: null, name: string, opts: { hint: string; terms: string[]; speakers: boolean; url: string }) => Promise<{ said: Said[]; duration: number }>;
export type Think = (system: string, prompt: string) => Promise<Record<string, unknown>>;
export type Deps = { tool: Tool; hear: Hear; think: Think; now?: () => number };

const BY = "Claude (meetings)";
const LOCK_MS = 6 * 60e3;
const TRIES = 3;
const DOC_MAX = 230_000; // board docs are capped at 256 KB
const AREAS = ["Content", "Social", "Ads", "Live", "Admin"];
const SCHOOLS = ["Flip & Dance", "Cheer", "Both"];
const DEFAULT_TITLE = "Meeting recording";
// What Claude can be asked to do from a meeting, and the HQ card action each becomes (acro-hq HANDOFF "Meeting recordings").
const JOBS = ["ad", "reel", "build", "other"];
const ACTION: Record<string, string> = { ad: "ad-new", reel: "reel-new", build: "claude-build", other: "claude-job" };
const HINT = "A business meeting between Michael and Nate, who run two online acrobatics schools on Skool: Flippin' Dance Acrobatics and Better Tumbling for Cheerleaders.";
const TERMS = ["Acro HQ", "Flip & Dance", "Flippin' Dance Acrobatics", "Better Tumbling for Cheerleaders", "Skool", "SkoolKit", "Instagram", "TikTok", "Meta Ads", "acro", "cheer", "tumbling"];

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const stamp = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export const SYSTEM = `You write up a recorded business meeting for Acro HQ, the shared board of Michael and Nate, who run two paid online acrobatics schools on Skool: Flippin' Dance Acrobatics ("Flip & Dance", acro for dancers) and Better Tumbling for Cheerleaders ("Cheer"). The notes go on the board's Meetings tab, and the tasks you suggest are added to the task board only if Michael or Nate tick them.

The write-out is split by speaker (S0, S1, …) by a machine that sometimes splits one person in two or runs two together; [m:ss] is when each part starts.

- speakers: a name for each speaker id, from how they address each other or what they say. Usually Michael and Nate; use the team list. If you can't tell, "Speaker 1", "Speaker 2" by id order. Two ids that are clearly the same person get the same name.
- title: a short name for the meeting in plain words, like "Summer camp and ad budget". No date.
- summary: 3 to 8 short points in plain words: what was talked about, what was worked out, and what's still open. Keep their own terms and names. No Markdown.
- decisions: each thing they agreed on or settled, one short sentence each. Only real decisions, not ideas floated.
- tasks: things only a PERSON can do (Michael and Nate decided this, Nov 2): filming, being on camera, logging in to an account or approving access, paying, buying, talking to people, coaching, choosing between options only they can judge. Each as a short title starting with a verb. assignee: who will do it (one of the team), or "" if nobody took it. area: Content (videos and posts to make), Social (social accounts), Ads (paid ads), Live (live classes and events) or Admin (everything else). school: "Flip & Dance", "Cheer", or "Both" if it's for both or unclear. due: a date (YYYY-MM-DD) only if one was said, worked out from the meeting date, else "". notes: what's needed to do it, from the meeting: context, and where they apply the direct links and short numbered steps (the board's standing rule for every task). Never invent links or steps that weren't said or aren't obvious.
- Don't suggest a task that's already open on the board (the list is given); mention it in notes of a related task if the meeting changed it.
- claude: everything else that should get done: anything they'd simply ask Claude to do, whether they said "Claude" or not ("let's set up a schedule", "we should run that now", "this is broken", "it should also..."). Michael and Nate want these as one-tap Approve cards, never as tasks for themselves: the yes starts the work. Prefer this over a task whenever Claude could do it. type "build": anything that needs the code, the board, the numbers (Meta, Instagram, TikTok, Skool), scheduled tasks or automations: build or change a feature, fix a bug, set up or change a schedule, run an analysis or the weekly review now, change how suggestions or the daily reels work (rules, prompts, settings). Claude in the cloud does it with the full repo and connectors. type "ad": make new video ads (Claude writes ad edit plans from their real footage and renders them; each ad still needs its own approval before it goes into Meta Ads, paused). type "reel": make social reels (a skill, a format such as breakdown, slow-mo, progression, one-drill or mistake-fix, an angle). type "other": pure writing Claude can do from what it already knows, with no numbers or code: drafting captions, a Skool post, an email, a script or a shot list (done on Michael's PC). When a job needs data, code or a schedule, it's "build". Claude can't film, post, spend, message anyone or change accounts: those parts are tasks. title: what Claude will make, starting with a verb ("Make 2 ads for dance moms about ..."). why: one sentence on what was said. ask: what happens on yes, in plain words. count: how many (1 to 3; 1 for "build" and "other"). notes: everything from the meeting Claude needs to do it well: who it's for, the angle, skill, format, hook, offer, what to avoid. Only what was said; leave this empty when they asked Claude for nothing. A task only a person can do goes in tasks, not here; when a job has a person part (e.g. approve access), put the job here and the person part in tasks.
- Use only what was said. Never invent tasks, decisions, names or details.
- Michael's own rules for meeting notes come last, if there are any. Follow them; where they conflict with the above, they win.`;

export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "speakers", "summary", "decisions", "tasks", "claude"],
  properties: {
    title: { type: "string" },
    speakers: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "name"], properties: { id: { type: "integer" }, name: { type: "string" } } } },
    summary: { type: "array", items: { type: "string" } },
    decisions: { type: "array", items: { type: "string" } },
    tasks: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["title", "assignee", "area", "school", "due", "notes"],
        properties: { title: { type: "string" }, assignee: { type: "string" }, area: { type: "string", enum: AREAS }, school: { type: "string", enum: SCHOOLS }, due: { type: "string" }, notes: { type: "string" } },
      },
    },
    claude: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["type", "title", "why", "ask", "school", "count", "notes"],
        properties: { type: { type: "string", enum: JOBS }, title: { type: "string" }, why: { type: "string" }, ask: { type: "string" }, school: { type: "string", enum: SCHOOLS }, count: { type: "integer" }, notes: { type: "string" } },
      },
    },
  },
};

type Doc = { id: string; version: number; data: Record<string, any> };

async function get(tool: Tool, collection: string, id: string): Promise<Doc | null> {
  try { return (await tool("board_get", { collection, id })) as Doc; }
  catch (e) { if ((e as { tool?: boolean }).tool && /^No /.test((e as Error).message)) return null; throw e; }
}

async function update(tool: Tool, id: string, version: number, data: Record<string, unknown>) {
  await tool("board_write", { by: BY, writes: [{ collection: "meetings", id, data, mode: "update", if_version: version }] });
  return version + 1;
}

export function prompt(m: Record<string, any>, ctx: { team: string[]; brief: unknown; rules: string; open: { title: string; assignee: string }[] }) {
  const said: Said[] = Array.isArray(m.said) ? m.said : [];
  const parts = [
    `Team: ${ctx.team.join(", ")}`,
    m.date ? `Meeting date: ${m.date}` : "",
    m.recording?.by ? `Recorded by: ${m.recording.by}` : "",
    m.title && m.title !== DEFAULT_TITLE ? `Its name so far: ${m.title}` : "",
    ctx.brief ? `The business right now (from the board's brief):\n${JSON.stringify(ctx.brief).slice(0, 12000)}` : "",
    ctx.open.length ? `Tasks already open on the board:\n${ctx.open.map((t) => `- ${t.title}${t.assignee ? ` (${t.assignee})` : ""}`).join("\n")}` : "",
    `The meeting, written out:\n\n${said.map((x) => `S${Number(x.s) || 0} [${stamp(Number(x.t) || 0)}]: ${x.text}`).join("\n").slice(0, 400_000)}`,
    ctx.rules ? `Michael's rules for meeting notes:\n${ctx.rules.slice(0, 8000)}` : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

export function tidy(out: Record<string, any>, team: string[]) {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const person = (v: unknown) => team.find((p) => p.toLowerCase() === str(v, 40).split(/\s+/)[0]?.toLowerCase()) ?? "";
  return {
    title: str(out.title, 120),
    speakers: arr(out.speakers).map((s: any) => ({ id: Number(s?.id) || 0, name: str(s?.name, 60) })).filter((s) => s.name),
    summary: arr(out.summary).map((s) => str(s, 1000)).filter(Boolean).slice(0, 12),
    decisions: arr(out.decisions).map((s) => str(s, 400)).filter(Boolean).slice(0, 30),
    suggestions: arr(out.tasks).map((t: any) => ({
      title: str(t?.title, 200), assignee: person(t?.assignee),
      area: AREAS.includes(t?.area) ? t.area : "Admin", school: SCHOOLS.includes(t?.school) ? t.school : "Both",
      due: /^\d{4}-\d{2}-\d{2}$/.test(str(t?.due, 10)) ? str(t?.due, 10) : "", notes: str(t?.notes, 2000),
    })).filter((t) => t.title).slice(0, 30),
    jobs: arr(out.claude).map((j: any) => ({
      type: JOBS.includes(j?.type) ? j.type : "other", title: str(j?.title, 200), why: str(j?.why, 600), ask: str(j?.ask, 400),
      school: SCHOOLS.includes(j?.school) ? j.school : "Both", count: j?.type === "other" || j?.type === "build" ? 1 : Math.max(1, Math.min(3, Number(j?.count) || 1)), notes: str(j?.notes, 3000),
    })).filter((j) => j.title).slice(0, 8),
  };
}

type Job = ReturnType<typeof tidy>["jobs"][number];
const ASK: Record<string, string> = {
  ad: "On yes: Claude makes the ads on Michael's PC from your footage and puts each one on Review. Each still needs its own Approve... before it goes into Meta Ads (paused).",
  reel: "On yes: Claude makes the reels on Michael's PC and puts each one on Review > To post, for its own yes before it posts.",
  build: "On yes: Claude picks it up in the cloud within the hour (7 AM to 11 PM), does it with the repo and connectors, and says what it did on this card. Anything that would post or spend still waits for its own yes.",
  other: "On yes: Claude does it on Michael's PC and puts what it made on this card (and in the repo).",
};

// Claude's own jobs from a meeting, as cards on HQ's Review. One card per job, id from the meeting and the job's
// place, so "Write the notes again" refreshes cards still waiting and never touches one someone already decided.
async function putJobs(tool: Tool, m: { id: string; title: string; date: string }, jobs: Job[], now: number) {
  const out: { card: string; type: string; title: string }[] = [];
  const writes: Record<string, unknown>[] = [];
  for (const [i, j] of jobs.entries()) {
    const id = `mtg-${m.id}-${i + 1}`.slice(0, 200);
    const old = await get(tool, "approvals", id);
    out.push({ card: id, type: j.type, title: j.title });
    if (old && old.data?.status !== "waiting") continue;
    const data = {
      kind: "change", school: j.school, title: j.title, why: `From the meeting "${m.title}"${m.date ? ` (${m.date})` : ""}: ${j.why}`.slice(0, 1000),
      ask: (j.ask ? `${j.ask} ` : "") + ASK[j.type], date: m.date || "",
      action: { type: ACTION[j.type], count: j.count, notes: j.notes, meeting: { id: m.id, title: m.title } },
      createdBy: BY, createdAt: old?.data?.createdAt ?? now, status: "waiting",
    };
    writes.push(old ? { collection: "approvals", id, data, mode: "set", if_version: old.version } : { collection: "approvals", id, data, mode: "set" });
  }
  if (writes.length) await tool("board_write", { by: BY, writes });
  return out;
}

const lines = (said: Said[], names: Map<number, string>) =>
  said.map((x) => `${names.get(Number(x.s) || 0) ?? `Speaker ${(Number(x.s) || 0) + 1}`} [${stamp(Number(x.t) || 0)}]: ${x.text}`).join("\n");

// What failed, in words for the board, and whether to wait longer (not counted as a try).
function why(e: Error & { code?: string; status?: number }) {
  if (e.code === "no-transcriber" || e.code === "no-meeting-transcriber") return { text: "Waiting for the speech service (ElevenLabs) to be set up.", wait: 30 * 60e3 };
  if (e.code === "no-claude") return { text: "Waiting for Claude to be set up on Michael's server.", wait: 30 * 60e3 };
  return { text: e.message || "Something went wrong.", wait: 0 };
}

/** One meeting one stage further. "more" when there may be more to do, "idle" when nothing's waiting. */
export async function step(d: Deps): Promise<"more" | "idle"> {
  const now = (d.now ?? Date.now)();
  let pick: { id: string; stage: "new" | "written" } | null = null;
  for (const [status, stage] of [["new", "new"], ["writing", "new"], ["written", "written"], ["thinking", "written"]] as const) {
    const list = await d.tool("board_list", { collection: "meetings", where: [{ field: "status", op: "eq", value: status }], limit: 5 });
    const doc = (list.docs ?? []).find((x: Doc) => !(Number(x.data?.lockedUntil) > now));
    if (doc) { pick = { id: doc.id, stage }; break; }
  }
  if (!pick) return "idle";

  const doc = await get(d.tool, "meetings", pick.id);
  if (!doc || Number(doc.data.lockedUntil) > now) return "more";
  let v: number;
  try { v = await update(d.tool, doc.id, doc.version, { status: pick.stage === "new" ? "writing" : "thinking", lockedUntil: now + LOCK_MS }); }
  catch { return "more"; } // someone else took it
  const m = doc.data;

  try {
    if (pick.stage === "new") {
      const { url } = await d.tool("meeting_audio_link", { id: doc.id });
      const team = await teamOf(d.tool);
      const { said, duration } = await d.hear(null, "meeting", { hint: HINT, terms: [...new Set([...team, ...TERMS])], speakers: true, url });
      if (!said.length) {
        await update(d.tool, doc.id, v, { status: "failed", error: "Nothing was said in that recording.", lockedUntil: 0 });
        return "more";
      }
      await update(d.tool, doc.id, v, {
        status: "written", said, duration: Math.round(duration || 0), transcript: lines(said, new Map()).slice(0, 200_000),
        lockedUntil: 0, attempts: 0, error: null, note: null, writtenAt: now,
      });
      return "more";
    }

    const said: Said[] = Array.isArray(m.said) ? m.said : [];
    if (!said.length) {
      await update(d.tool, doc.id, v, { status: "new", lockedUntil: 0 });
      return "more";
    }
    const team = await teamOf(d.tool);
    const [brief, rules, open] = await Promise.all([
      get(d.tool, "settings", "brief").then((x) => x?.data ?? null),
      get(d.tool, "settings", "meetings").then((x) => str(x?.data?.rules, 8000)),
      d.tool("board_list", { collection: "tasks", where: [{ field: "status", op: "ne", value: "done" }], limit: 60 })
        .then((r) => (r.docs ?? []).map((x: Doc) => ({ title: str(x.data?.title, 200), assignee: str(x.data?.assignee, 40) })).filter((t: { title: string }) => t.title))
        .catch(() => []),
    ]);
    const notes = tidy(await d.think(SYSTEM, prompt(m, { team, brief, rules, open })), team);
    const names = new Map(notes.speakers.map((s) => [s.id, s.name]));
    const data: Record<string, unknown> = {
      status: "ready", speakers: notes.speakers, summary: notes.summary.map((x) => `- ${x}`).join("\n"), decisions: notes.decisions,
      suggestions: notes.suggestions, suggestionsDone: false, transcript: lines(said, names), lockedUntil: 0, attempts: 0, error: null, note: null, notesAt: now,
    };
    if (notes.title && (!m.title || m.title === DEFAULT_TITLE)) data.title = notes.title;
    // Claude's own jobs go up as cards to approve; a failure here doesn't lose the notes.
    try {
      data.claudeJobs = await putJobs(d.tool, { id: doc.id, title: String(data.title || m.title || DEFAULT_TITLE), date: str(m.date, 10) }, notes.jobs, now);
      data.jobsError = null;
    } catch (e) {
      console.error("couldn't put Claude's jobs on Review", e);
      data.claudeJobs = notes.jobs.map((j) => ({ card: "", type: j.type, title: j.title }));
      data.jobsError = "Couldn't put these on Review. Write the notes again to retry.";
    }
    // Room on the doc: the write-out with timestamps (kept for "Write the notes again") goes first.
    if (JSON.stringify({ ...m, ...data }).length > DOC_MAX) data.said = { __delete__: true };
    if (JSON.stringify({ ...m, ...data, said: undefined }).length > DOC_MAX) data.transcript = String(data.transcript).slice(0, 150_000) + "\n… (cut: the recording is longer than the board can hold)";
    await update(d.tool, doc.id, v, data);
    return "more";
  } catch (err) {
    const e = err as Error & { code?: string };
    console.error(e);
    const w = why(e);
    const tries = (Number(m.attempts) || 0) + (w.wait ? 0 : 1);
    const back = pick.stage;
    await update(d.tool, doc.id, v, tries >= TRIES
      ? { status: "failed", error: w.text, attempts: tries, lockedUntil: 0 }
      : { status: back, note: w.wait ? w.text : "Trying again in a few minutes.", attempts: tries, lockedUntil: now + (w.wait || 3 * 60e3 * tries) },
    ).catch((e2) => console.error("couldn't save the failure", e2));
    return "more";
  }
}

async function teamOf(tool: Tool): Promise<string[]> {
  const t = await get(tool, "settings", "team").catch(() => null);
  const people = Array.isArray(t?.data?.people) ? t!.data.people.map(String).filter(Boolean) : [];
  return people.length ? people : ["Michael", "Nate"];
}
