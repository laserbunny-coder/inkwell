// Writes up Acro HQ's meeting recordings (see work.ts). Woken by HQ the moment a recording is added
// (its MEETING_WAKE_URL), and every 5 minutes by the database's job as a backstop. A wake carries
// nothing: this only goes and looks, through HQ's own connector (the ACRO_CONNECTOR_URL secret), so
// anyone calling it can at most make it look. It answers at once and does the work in the background,
// one stage per run, waking itself again while there's more.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { json } from "../_shared/common.ts";
import { callTool } from "../inkwell/acro.ts";
import { hear } from "../inkwell/speech.ts";
import { step, SCHEMA } from "./work.ts";

const MODEL = "claude-opus-5-5";
const MAX_HOPS = 8;

async function think(system: string, prompt: string) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw Object.assign(new Error("No Claude key"), { code: "no-claude" });
  const client = new Anthropic({ apiKey: key });
  // Streamed: a long meeting needs the room, and the SDK refuses a non-streamed request this large.
  const response = await client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system,
    messages: [{ role: "user", content: prompt }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    // @ts-ignore: server-side fallback parameter (beta)
    fallbacks: "default",
  }).finalMessage();
  if (response.stop_reason === "refusal") throw new Error("Claude wouldn't write notes for this meeting.");
  if (response.stop_reason === "max_tokens") throw new Error("Claude's notes were cut off.");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No notes came back from Claude.");
  return JSON.parse(text.text);
}

let running = false;

async function run(selfUrl: string, hop: number) {
  const url = Deno.env.get("ACRO_CONNECTOR_URL");
  if (!url || !/^https:\/\//.test(url) || running) return;
  running = true;
  let more = false;
  try {
    more = (await step({ tool: (name, args) => callTool(url, name, args), hear, think })) === "more";
  } catch (e) {
    console.error("meeting step failed", e);
  } finally {
    running = false;
  }
  if (more && hop < MAX_HOPS) {
    await fetch(selfUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hop: hop + 1 }), signal: AbortSignal.timeout(10_000) })
      .catch((e) => console.log("couldn't wake the next step:", e?.message || e));
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Not found" }, 404);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const hop = Math.max(0, Math.min(MAX_HOPS, Number(body?.hop) || 0));
  const base = Deno.env.get("SUPABASE_URL") || new URL(req.url).origin;
  const work = run(`${base.replace(/\/+$/, "")}/functions/v1/acro-meetings`, hop);
  // @ts-ignore: EdgeRuntime is Supabase's, for work that goes on after the answer.
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work); else await work;
  return json({ ok: true }, 202);
});
