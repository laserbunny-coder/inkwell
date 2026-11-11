// Voice captures from Inkwell: the recording (already in the person's folder in
// the writing-files bucket) is written out by a speech service, then Claude
// adds a short tidy outline. Claude never rewrites the words themselves.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { admin, json } from "../_shared/common.ts";
import { refsIn, tagFor } from "./enrich.ts";
import { hear } from "./speech.ts";

const OUTLINE_SYSTEM = `You help a writer and filmmaker keep their ideas. They record ideas out loud (often while driving or walking) and the recording has been written out word for word. Under it, you add a short, tidy outline of the idea so it's easy to scan later.

- Use only what they said. Never add ideas, names, plot or details of your own, and never judge the idea.
- A few short lines, each starting with a label and a colon, in this order, and only the ones the recording actually has: Premise, Characters, World, Moments, Images, Lines (dialogue or jokes worth keeping), Questions (things they wondered or left open), Links (other projects or ideas they connected it to).
- Each line is a short phrase or two, in plain words, close to their wording. No Markdown, no bullets, no quotes around lines.
- If the recording is very short, or is a single thought, a reminder or a list, return no lines: the words already say it.`;

const OUTLINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outline"],
  properties: { outline: { type: "array", items: { type: "string" } } },
};

export const HINT = "Someone thinking out loud: journaling about their day, talking through an idea, or dictating a story, a scene or dialogue for a film or show.";

// Every recording is written out by speech.ts (ElevenLabs, with OpenAI as the
// backup). `terms` are names to listen for, such as the people and places in
// the person's worlds. Scribe, the dictation app, comes here too, with its own hint.
export async function transcribe(blob: Blob, name: string, _durationMs: number, hint = HINT, terms: string[] = []): Promise<string> {
  return (await hear(blob, name, { hint, terms })).text;
}

async function outlineOf(client: Anthropic, transcript: string): Promise<string[]> {
  if (transcript.split(/\s+/).length < 25) return [];
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: OUTLINE_SYSTEM,
    messages: [{ role: "user", content: `The recording, written out:\n\n${transcript.slice(0, 60000)}` }],
    output_config: { effort: "low", format: { type: "json_schema", schema: OUTLINE_SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    // @ts-ignore: server-side fallback parameter (beta)
    fallbacks: "default",
  });
  if (response.stop_reason !== "end_turn") return [];
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return [];
  const out = JSON.parse(text.text);
  return (out.outline ?? []).filter((s: unknown) => typeof s === "string").slice(0, 12);
}

type CaptureBody = { file?: string; transcript?: string; duration?: number; tags?: string[]; terms?: string[] };

export async function capture(client: Anthropic, userId: string, body: CaptureBody): Promise<Response> {
  let transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  try {
    if (!transcript) {
      if (typeof body.file !== "string" || !/^[\w-]+$/.test(body.file)) return json({ error: "Missing recording" }, 400);
      const { data, error } = await admin().storage.from("writing-files").download(`${userId}/${body.file}`);
      if (error || !data) return json({ error: "The recording hasn't reached the cloud yet." }, 404);
      const type = data.type || "audio/webm";
      const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("mpeg") ? "mp3" : type.includes("wav") ? "wav" : "webm";
      transcript = await transcribe(data, `capture.${ext}`, Number(body.duration) || 0, HINT, body.terms ?? []);
    }
  } catch (err) {
    const e = err as Error & { code?: string; status?: number };
    console.error(e);
    return json({ error: e.message, code: e.code ?? null }, e.status ?? 500);
  }
  // The words are kept even if Claude's part can't be done this time.
  const quiet = <T>(p: Promise<T>, empty: T) => p.catch((err) => { console.error(err); return empty; });
  const [outline, tag, refs] = await Promise.all([
    quiet(outlineOf(client, transcript), [] as string[]),
    quiet(tagFor(client, transcript, body.tags), ""),
    quiet(refsIn(client, transcript), [] as { label: string; url: string }[]),
  ]);
  return json({ transcript, outline, tag, refs });
}
