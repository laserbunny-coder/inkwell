// The plot grid in Inkwell: the story as a table, its chapters, scenes or
// episodes down the side and its threads (a character's journey, a mystery,
// a romance) across the top, each cell a short note. Claude helps two ways,
// only when asked:
// - fill: read the draft and write the notes for one thread, row by row, so
//   the writer can read that thread straight down its column;
// - check: read the whole grid and the draft and point out promises the story
//   makes and never pays off, threads that go quiet too long, and payoffs
//   with nothing set up before them.
// Nothing here writes anywhere: Inkwell shows what comes back and the writer
// keeps or deletes it.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { json } from "../_shared/common.ts";

const SYSTEM = `You help a novelist and screenwriter with the plot grid in Inkwell, their writing app. The grid lays the story out as a table, like the hand-drawn grid J.K. Rowling planned her books on: rows are the story's units in order (chapters, scenes, sections of a script, or the episodes of a season), and each column is a thread the writer wants to follow down the story: a character's journey, a mystery, a romance, a running gag. A cell is a short note on what that thread does in that row.

The writer thinks of each thread as a promise in Brandon Sanderson's sense: the story promises something (a question, a danger, a want, a mystery), makes progress on it, and pays it off. A note can be marked as a promise, progress or a payoff.

Rows come labelled R1, R2… in story order, threads T1, T2…, with the text of each row (sometimes cut short) and the notes already in the grid. Use the writer's names. Never invent events that aren't in the text or the notes.`;

const FILL = `Fill in the column for thread {T}: for each row where this thread actually shows up in the text, write one short note (a few words to one sentence, in the present tense, the way someone fills in a planning grid: "Refuses the call", "Finds the second key") on what this thread does there. Leave out rows where it doesn't appear. Skip rows that already have a note for this thread. Mark a note as a promise when the row sets up something the story owes the reader for this thread, a payoff when it delivers on one, progress when it moves one along; otherwise no beat.`;

const CHECK = `Read the grid and the text and point out, most important first:
- promises: things the story sets up and never pays off (marked promises without a payoff after them, and promises the text makes that aren't marked yet);
- quiet: a thread that disappears for a long stretch and might have been dropped;
- payoff: a payoff with nothing set up before it.
Each finding names its thread and the row it's about, and says in one or two plain sentences what you noticed. Don't praise and don't suggest rewrites; just what's there. At most 12 findings, and none if the story keeps its promises.`;

const FILL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cells"],
  properties: {
    cells: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["row", "text", "beat"],
        properties: {
          row: { type: "string" },
          text: { type: "string" },
          beat: { type: "string", enum: ["", "promise", "progress", "payoff"] },
        },
      },
    },
  },
};

const CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "thread", "row", "text"],
        properties: {
          kind: { type: "string", enum: ["promise", "quiet", "payoff"] },
          thread: { type: "string" },
          row: { type: "string" },
          text: { type: "string" },
        },
      },
    },
  },
};

type Note = { thread: string; text: string; beat?: string };
type Row = { id: string; title: string; summary?: string; text?: string; notes?: Note[] };
type Thread = { id: string; title: string; tag?: string };
export type GridBody = { task?: "fill" | "check"; piece?: string; thread?: string; rows?: Row[]; threads?: Thread[] };

const str = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

export function prompt(b: GridBody) {
  const rows = (b.rows ?? []).filter((r) => r && typeof r.id === "string").slice(0, 400);
  const threads = (b.threads ?? []).filter((t) => t && typeof t.id === "string" && typeof t.title === "string").slice(0, 40);
  const tLabel = new Map(threads.map((t, i) => [t.id, `T${i + 1}`]));
  // The text shares one budget, so a long novel is cut evenly rather than
  // losing its last chapters.
  const total = rows.reduce((n, r) => n + (typeof r.text === "string" ? r.text.length : 0), 0);
  const BUDGET = 400000;
  const share = total > BUDGET ? BUDGET / total : 1;
  const parts: string[] = [];
  if (b.piece) parts.push(`The story: ${str(b.piece, 200)}`);
  parts.push(`Threads:\n${threads.map((t) => `${tLabel.get(t.id)}: ${str(t.title, 120)}${t.tag ? ` (#${str(t.tag, 60)})` : ""}`).join("\n") || "(none yet)"}`);
  const shown = rows.map((r, i) => {
    const text = typeof r.text === "string" ? r.text.slice(0, Math.max(400, Math.floor(r.text.length * share))) : "";
    const cut = typeof r.text === "string" && text.length < r.text.length ? " […]" : "";
    const notes = (r.notes ?? []).filter((n) => n && tLabel.has(n.thread) && typeof n.text === "string" && n.text.trim())
      .map((n) => `  [${tLabel.get(n.thread)}${n.beat ? `, ${n.beat}` : ""}] ${str(n.text, 500)}`);
    return [`R${i + 1}: ${str(r.title, 200)}`, r.summary ? `  Summary: ${str(r.summary, 1000)}` : "", ...notes, text ? `  Text:\n${text}${cut}` : ""].filter(Boolean).join("\n");
  });
  parts.push(`The rows, in story order:\n\n${shown.join("\n\n")}`);
  const target = b.task === "fill" ? tLabel.get(String(b.thread)) : null;
  parts.push(b.task === "fill" ? FILL.replace("{T}", target ?? "") : CHECK);
  return { text: parts.join("\n\n"), rows, threads, target };
}

export function tidy(task: "fill" | "check", out: { cells?: { row: string; text: string; beat: string }[]; findings?: { kind: string; thread: string; row: string; text: string }[] }, ctx: ReturnType<typeof prompt>) {
  const rowId = (label: string) => ctx.rows[Number(String(label).replace(/^R/i, "")) - 1]?.id ?? null;
  const threadId = (label: string) => ctx.threads[Number(String(label).replace(/^T/i, "")) - 1]?.id ?? null;
  if (task === "fill") {
    const seen = new Set<string>();
    const cells = [];
    for (const c of out.cells ?? []) {
      const row = rowId(c.row);
      const text = str(c.text, 400).trim();
      if (!row || !text || seen.has(row)) continue;
      seen.add(row);
      cells.push({ row, text, beat: ["promise", "progress", "payoff"].includes(c.beat) ? c.beat : null });
    }
    return { cells };
  }
  const findings = [];
  for (const f of out.findings ?? []) {
    const text = str(f.text, 800).trim();
    if (!text) continue;
    findings.push({ kind: ["promise", "quiet", "payoff"].includes(f.kind) ? f.kind : "promise", thread: threadId(f.thread), row: rowId(f.row), text });
  }
  return { findings: findings.slice(0, 12) };
}

export async function grid(client: Anthropic, body: GridBody): Promise<Response> {
  const task = body.task === "fill" ? "fill" : "check";
  const ctx = prompt({ ...body, task });
  if (!ctx.rows.length) return json({ error: "There's nothing in the grid to read yet." }, 400);
  if (task === "fill" && !ctx.target) return json({ error: "Which thread? It's no longer in the grid." }, 400);
  try {
    // Streamed: the SDK refuses a non-streamed request this large.
    const response = await client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 32000,
      system: SYSTEM,
      messages: [{ role: "user", content: ctx.text }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: task === "fill" ? FILL_SCHEMA : CHECK_SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-ignore: server-side fallback parameter (beta)
      fallbacks: "default",
    }).finalMessage();
    if (response.stop_reason === "refusal") return json({ error: "Claude wouldn't read this one." }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "Claude's answer was cut off. Try again." }, 502);
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json({ error: "No answer came back. Try again." }, 502);
    return json(tidy(task, JSON.parse(text.text), ctx));
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy right now. Try again in a minute." }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "The Claude API key isn't set up correctly." }, 500);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude returned an error (${err.status}).` }, 502);
    return json({ error: "Something went wrong asking Claude." }, 500);
  }
}
