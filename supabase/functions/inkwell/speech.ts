// Speech to text, in one place for everything that's said out loud: Inkwell's
// Capture and talk-into-a-draft, Scribe the dictation app, and meetings.
//
// ElevenLabs Scribe v2 writes it out (the ELEVENLABS_API_KEY secret). It is
// taught the names in the person's worlds (keyterms), labels speakers when
// asked, and takes a recording of any length in one go. Each transcript is
// deleted from ElevenLabs as soon as its words are back, so nothing said is
// kept there. If ElevenLabs fails, OpenAI's gpt-transcribe writes it out
// instead (it takes up to 25 MB, about an hour and 45 minutes of an Inkwell
// or Scribe recording, and can't tell speakers apart). Until the ElevenLabs
// key is added, everything goes to OpenAI as before.

const OPENAI_LIMIT = 25 * 1024 * 1024;
const ELEVEN = "https://api.elevenlabs.io/v1/speech-to-text";

export type Said = { s: number; t: number; text: string };
type Word = { text?: string; start?: number; end?: number; type?: string; speaker_id?: string };
// `tried`: each step on the way, such as ["elevenlabs: no words", "elevenlabs without names: no words", "openai: ok"].
export type Heard = { text: string; said: Said[]; duration: number; by: "elevenlabs" | "openai"; tried?: string[] };
export type HearOpts = { hint: string; terms?: string[]; speakers?: boolean; url?: string };

const fail = (message: string, status: number, code?: string) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

// True when a write-out is just the hint said back (no real speech).
export function echoesHint(text: string, hint: string): boolean {
  const words = (s: string) => (s.toLowerCase().match(/[a-z']+/g) || []).filter((w) => w.length > 3);
  const said = words(text);
  if (!said.length) return !text.trim();
  const hinted = new Set(words(hint));
  return said.length <= 20 && said.filter((w) => hinted.has(w)).length / said.length >= 0.85;
}

// Names the services accept as keyterms: one line, a few words, no brackets.
export function cleanTerms(terms: unknown): string[] {
  if (!Array.isArray(terms)) return [];
  const out = new Set<string>();
  for (const t of terms) {
    if (typeof t !== "string") continue;
    const s = t.replace(/[<>{}[\]\\\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    if (s.length >= 2 && s.length < 50 && s.split(" ").length <= 5) out.add(s);
    if (out.size >= 100) break;
  }
  return [...out];
}

// ElevenLabs' words, run together into what each person said in one go.
export function merge(words: Word[]): Said[] {
  const out: Said[] = [];
  for (const w of words) {
    if (w.type === "audio_event") continue;
    const s = Number(String(w.speaker_id ?? "").replace(/\D/g, "")) || 0;
    const last = out.at(-1);
    const text = w.text ?? "";
    if (w.type === "spacing") { if (last) last.text += text || " "; continue; }
    if (!text) continue;
    // A new line when someone else speaks, or at a sentence end once a line runs long.
    if (last && last.s === s && !(last.text.length > 1500 && /[.?!]\s*$/.test(last.text))) { last.text += text; continue; }
    out.push({ s, t: Math.round(Number(w.start) || 0), text });
  }
  return out.map((x) => ({ ...x, text: x.text.replace(/\s+/g, " ").trim() })).filter((x) => x.text);
}

async function elevenlabs(key: string, audio: { blob?: Blob; name?: string; url?: string }, o: HearOpts, terms: string[]): Promise<Heard> {
  const form = new FormData();
  form.append("model_id", "scribe_v2");
  if (audio.url) form.append("source_url", audio.url);
  else form.append("file", audio.blob!, audio.name || "recording.webm");
  form.append("tag_audio_events", "false");
  form.append("timestamps_granularity", "word");
  if (o.speakers) form.append("diarize", "true");
  for (const t of terms) form.append("keyterms", t);
  let res: Response;
  try {
    res = await fetch(ELEVEN, { method: "POST", headers: { "xi-api-key": key }, body: form, signal: AbortSignal.timeout(140_000) });
  } catch {
    throw fail("The speech service took too long. It'll try again.", 504);
  }
  // Names it won't take shouldn't cost the recording: once more without them.
  if (res.status === 422 && terms.length) {
    console.error("keyterms refused", await res.text().catch(() => ""));
    return elevenlabs(key, audio, o, []);
  }
  if (res.status === 401 || res.status === 403) throw fail("The speech service's key isn't set up correctly.", 503, "no-transcriber");
  if (res.status === 402) throw fail("The speech service is out of credit.", 503, "no-transcriber");
  if (!res.ok) { console.error(await res.text().catch(() => "")); throw fail(`The speech service returned an error (${res.status}).`, 502); }
  const out = await res.json();
  forget(key, out?.transcription_id ?? out?.transcript_id);
  const words: Word[] = Array.isArray(out?.words) ? out.words : [];
  const said = merge(words);
  const text = o.speakers ? said.map((x) => x.text).join(" ") : String(out?.text ?? "").trim();
  const duration = Math.round(Math.max(0, ...words.map((w) => Number(w.end) || 0)));
  // No words back is worth a note in the logs: it's the clue when a recording comes back blank.
  if (!text) console.warn("ElevenLabs heard no words", JSON.stringify({ size: audio.blob?.size ?? null, url: !!audio.url, terms: terms.length, language: out?.language_code ?? null, probability: out?.language_probability ?? null, words: words.length, kinds: [...new Set(words.map((w) => w.type))] }));
  return { text, said, duration, by: "elevenlabs" };
}

// The transcript is deleted from ElevenLabs once its words are back. Best
// effort: a failure is logged, never in the way of the words.
function forget(key: string, id: unknown) {
  if (typeof id !== "string" || !/^[\w-]+$/.test(id)) { console.warn("no transcript id to delete"); return; }
  fetch(`${ELEVEN}/transcripts/${id}`, { method: "DELETE", headers: { "xi-api-key": key } })
    .then((r) => { if (!r.ok && r.status !== 404) console.warn("couldn't delete transcript", id, r.status); })
    .catch((err) => console.warn("couldn't delete transcript", id, err));
}

async function openai(blob: Blob, name: string, o: HearOpts, terms: string[]): Promise<Heard> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw fail("Writing out recordings isn't set up yet.", 503, "no-transcriber");
  if (blob.size > OPENAI_LIMIT) throw fail("That recording is too long for the backup speech service. It'll try again.", 413);
  const form = new FormData();
  form.append("file", blob, name);
  form.append("model", "gpt-transcribe");
  // English, with a hint at what's usually said and the names to expect. On a
  // near-silent recording the service can echo the hint back, so a write-out
  // that is mostly the hint's own words is dropped.
  form.append("languages[]", "en");
  form.append("prompt", o.hint);
  for (const t of terms) form.append("keywords[]", t);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(140_000) });
  } catch {
    throw fail("The speech service took too long. It'll try again.", 504);
  }
  if (res.status === 401) throw fail("The speech service's key isn't set up correctly.", 503, "no-transcriber");
  if (!res.ok) { console.error(await res.text().catch(() => "")); throw fail(`The speech service returned an error (${res.status}).`, 502); }
  const out = await res.json();
  const said = typeof out.text === "string" ? out.text.trim() : "";
  const text = said && !echoesHint(said, o.hint) ? said : "";
  return { text, said: text ? [{ s: 0, t: 0, text }] : [], duration: 0, by: "openai" };
}

// Writes out a recording. `blob` is the recording itself; for a big one kept
// in storage, `o.url` lets ElevenLabs fetch it, and `load` gets the blob only
// if OpenAI has to step in. Speaker labels (`o.speakers`) only come from
// ElevenLabs, so a meeting doesn't fall back; it waits and tries again.
export async function hear(blob: Blob | null, name: string, o: HearOpts, load?: () => Promise<Blob>): Promise<Heard> {
  const terms = cleanTerms(o.terms);
  const key = Deno.env.get("ELEVENLABS_API_KEY");
  const tried: string[] = [];
  const note = (step: string, h: Heard) => { tried.push(`${step}: ${h.text ? "ok" : "no words"}`); return h; };
  if (key) {
    try {
      const audio = o.url ? { url: o.url } : { blob: blob!, name };
      let heard = note("elevenlabs", await elevenlabs(key, audio, o, terms));
      // A blank answer for a real recording: once more without the names to
      // listen for, then (below) the backup service, before calling it silent.
      if (!heard.text && terms.length) heard = note("elevenlabs without names", await elevenlabs(key, audio, o, []));
      if (heard.text || o.speakers || !Deno.env.get("OPENAI_API_KEY") || (blob?.size ?? 0) > OPENAI_LIMIT || (!blob && !load)) return { ...heard, tried };
      console.warn("ElevenLabs heard nothing, trying OpenAI");
    } catch (err) {
      tried.push(`elevenlabs: failed (${(err as Error).message})`);
      const size = blob?.size ?? 0;
      if (o.speakers || !Deno.env.get("OPENAI_API_KEY") || size > OPENAI_LIMIT) throw err;
      console.error("ElevenLabs failed, trying OpenAI", err);
    }
  } else if (o.speakers) {
    throw fail("Writing out meetings isn't set up yet.", 503, "no-meeting-transcriber");
  } else tried.push("elevenlabs: no key");
  return { ...note("openai", await openai(blob ?? await load!(), name, o, terms)), tried };
}
