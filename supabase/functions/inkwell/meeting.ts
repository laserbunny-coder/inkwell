// Meetings in Inkwell: a recording of a meeting (already in the person's
// folder in the writing-files bucket) is written out with each speaker told
// apart (speech.ts: ElevenLabs fetches it by link and labels the speakers),
// then Claude names the speakers and writes the summary, the decisions and the
// tasks. Two steps, so the words are kept even if the notes fail.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { admin, json } from "../_shared/common.ts";
import { hear, type Said } from "./speech.ts";

const HINT = "A meeting between two or more people: business planning for a dance and cheer school, or a film production meeting.";

export async function writeOutMeeting(userId: string, body: { file?: string; terms?: string[] }): Promise<Response> {
  if (typeof body.file !== "string" || !/^[\w-]+$/.test(body.file)) return json({ error: "Missing recording" }, 400);
  const { data, error } = await admin().storage.from("writing-files").createSignedUrl(`${userId}/${body.file}`, 60 * 60);
  if (error || !data?.signedUrl) return json({ error: "The recording hasn't reached the cloud yet." }, 404);
  try {
    const { said, duration } = await hear(null, "meeting", { hint: HINT, terms: body.terms, speakers: true, url: data.signedUrl });
    return json({ said, duration });
  } catch (err) {
    const e = err as Error & { code?: string; status?: number };
    console.error(e);
    // Without a speaker-labelling service set up, the app waits for one.
    return json({ error: e.message, code: e.code === "no-transcriber" ? "no-meeting-transcriber" : e.code ?? null }, e.status ?? 500);
  }
}

const SYSTEM = `You turn a written-out meeting into notes its owner can use. The owner runs a dance and cheer business with their partner, and is also a writer and filmmaker, so a meeting is usually business or a film production meeting.

The write-out is split by speaker (S0, S1, …) by a machine that sometimes splits one person in two or runs two together; [m:ss] is when each part starts.

- speakers: a name for each speaker id, from how they address each other or what they say about themselves. The owner's own name, if given, is the person who recorded it. If you can't tell, use "Speaker 1", "Speaker 2" (by id order). Two ids that are clearly the same person get the same name.
- title: a short name for the meeting in plain words, like "Summer camp plans with Nate". No date.
- kind: "business" for the dance and cheer business (classes, students, staff, marketing, money, the gym), "filmmaking" for films, shows, scripts, shoots and production, else "other".
- summary: a few short paragraphs in plain words: what it was about, what was worked out, and anything left open. Keep their own terms and names. No Markdown.
- decisions: each thing they agreed on or settled, one short sentence each. Only real decisions, not ideas floated.
- tasks: each thing someone said they'd do or that clearly needs doing, as a short task title starting with a verb. owner is the name of whoever will do it (one of the speaker names), or "" if nobody took it. notes is a sentence of context if the title needs it, else "". due is a date (YYYY-MM-DD) only if one was said, based on the meeting date, else "".
- For a business meeting, each task also gets area (Content for videos and posts to make, Social for social accounts, Ads for paid ads, Live for live classes and events, Admin for everything else) and school (the business runs two online schools: "Flip & Dance" for acro and dance, "Cheer" for cheer; "Both" if it's for both or unclear). For other meetings, area and school are "".
- Use only what was said. Never invent tasks, decisions, names or details.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "kind", "speakers", "summary", "decisions", "tasks"],
  properties: {
    title: { type: "string" },
    kind: { type: "string", enum: ["business", "filmmaking", "other"] },
    speakers: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "name"], properties: { id: { type: "integer" }, name: { type: "string" } } } },
    summary: { type: "array", items: { type: "string" } },
    decisions: { type: "array", items: { type: "string" } },
    tasks: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["title", "owner", "notes", "due", "area", "school"], properties: { title: { type: "string" }, owner: { type: "string" }, notes: { type: "string" }, due: { type: "string" }, area: { type: "string", enum: ["Content", "Social", "Ads", "Live", "Admin", ""] }, school: { type: "string", enum: ["Flip & Dance", "Cheer", "Both", ""] } } },
    },
  },
};

const stamp = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

type NotesBody = { said?: Said[]; me?: string; people?: string[]; date?: string };

export function notesPrompt(body: NotesBody): string {
  const said = (body.said ?? []).filter((x) => x && typeof x.text === "string");
  const parts: string[] = [];
  if (body.date) parts.push(`Meeting date: ${body.date}`);
  if (body.me) parts.push(`The owner (who recorded it): ${str(body.me, 60)}`);
  const people = (body.people ?? []).filter((p) => typeof p === "string").slice(0, 20);
  if (people.length) parts.push(`People in earlier meetings: ${people.join(", ")}`);
  parts.push(`The meeting, written out:\n\n${said.map((x) => `S${Number(x.s) || 0} [${stamp(Number(x.t) || 0)}]: ${x.text}`).join("\n").slice(0, 400_000)}`);
  return parts.join("\n\n");
}

export function tidyNotes(out: Record<string, unknown>) {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    title: str(out.title, 120) || "Meeting",
    kind: ["business", "filmmaking"].includes(out.kind as string) ? out.kind : "other",
    speakers: arr(out.speakers).map((s: { id?: unknown; name?: unknown }) => ({ id: Number(s?.id) || 0, name: str(s?.name, 60) })).filter((s) => s.name),
    summary: arr(out.summary).map((s) => str(s, 3000)).filter(Boolean).slice(0, 8),
    decisions: arr(out.decisions).map((s) => str(s, 400)).filter(Boolean).slice(0, 30),
    tasks: arr(out.tasks).map((t: Record<string, unknown>) => ({
      title: str(t?.title, 200), owner: str(t?.owner, 60), notes: str(t?.notes, 600),
      due: /^\d{4}-\d{2}-\d{2}$/.test(str(t?.due, 10)) ? str(t?.due, 10) : "",
      area: str(t?.area, 20), school: str(t?.school, 20),
    })).filter((t) => t.title).slice(0, 40),
  };
}

export async function meetingNotes(client: Anthropic, body: NotesBody): Promise<Response> {
  if (!Array.isArray(body.said) || !body.said.length) return json({ error: "Nothing was said in that recording." }, 400);
  try {
    // Streamed: a long meeting needs the room, and the SDK refuses a
    // non-streamed request this large.
    const response = await client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 32000,
      system: SYSTEM,
      messages: [{ role: "user", content: notesPrompt(body) }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-ignore: server-side fallback parameter (beta)
      fallbacks: "default",
    }).finalMessage();
    if (response.stop_reason === "refusal") return json({ error: "Claude wouldn't write notes for this meeting." }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "Claude's notes were cut off. Try again." }, 502);
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json({ error: "No notes came back. Try again." }, 502);
    return json(tidyNotes(JSON.parse(text.text)));
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy right now. Try again in a minute." }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "The Claude API key isn't set up correctly." }, 500);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude returned an error (${err.status}).` }, 502);
    return json({ error: "Something went wrong asking Claude." }, 500);
  }
}
