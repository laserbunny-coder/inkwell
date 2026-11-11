// Scribe's starting modes: how a dictation is rewritten before it's typed in.
// Each one is plain words for Claude. `apps` are Android app ids and Windows
// program names where the mode picks itself; the first mode is the default
// everywhere else. These are copied to a person's own modes (scribe_modes)
// the first time Scribe asks for them; after that they change them there, by
// voice from the keyboard or by asking Claude. `model` is which Claude
// rewrites it: haiku for quick light jobs, sonnet for emails, opus where the
// writing matters. Inkwell's Capture and walk-and-talk drafting use the same
// modes, so a mode made in either app shows in both. `keep` files the
// recording and its words in Inkwell, on that day's page (keep.ts).
import { admin } from "../_shared/common.ts";

export type Model = "haiku" | "sonnet" | "opus";
export const MODELS: Model[] = ["haiku", "sonnet", "opus"];
export type Mode = { id: string; name: string; apps: string[]; prompt: string; model: Model; keep: boolean };

// Idea's instruction before it became an outline (2026-10-24); a mode still
// saying exactly this is moved to the new one.
export const OLD_IDEA_PROMPT = "A note to self about an idea, often a long ramble. Keep every idea, image, line and question they said, in their words, but put it in a sensible order, merge repeats, and break it into short paragraphs. Don't judge or add to the idea.";
export const IDEA_PROMPT = "A note to self about an idea, often a long ramble. Start with the idea itself in a sentence or two, then a short outline, one line per point, labelled where it fits (Premise, Characters, World, Moments, Images, Lines, Questions, Links). Keep every idea, image, line and question I said, in my words; merge repeats; don't judge or add to the idea.";

export const STARTER_MODES: Mode[] = [
  {
    id: "text",
    keep: false,
    name: "Text message",
    model: "haiku",
    apps: [
      "com.google.android.apps.messaging",
      "com.samsung.android.messaging",
      "com.whatsapp",
      "org.thoughtcrime.securesms",
      "com.facebook.orca",
      "com.instagram.android",
      "com.discord",
      "com.Slack",
    ],
    prompt: "A text message. Short and casual, the way they'd type it to a friend. Keep their wording and their voice; just make it read cleanly. No greeting or sign-off unless they said one. Contractions are fine. No emoji unless they asked for one.",
  },
  {
    id: "email",
    keep: false,
    name: "Email",
    model: "sonnet",
    apps: [
      "com.google.android.gm",
      "com.microsoft.office.outlook",
      "com.samsung.android.email.provider",
      "outlook.exe",
      "thunderbird.exe",
    ],
    prompt: "An email. Clear and warm, in short paragraphs. Start with a greeting using the person's name if they said who it's to, and end with a short sign-off and 'Michael'. Keep what they said and in the order that makes sense; don't add facts, promises or pleasantries they didn't say.",
  },
  {
    id: "clean",
    keep: false,
    name: "Clean only",
    model: "haiku",
    apps: [],
    prompt: "Clean up only: remove ums, false starts, repeats and filler, fix punctuation and capitals, and apply any corrections they made out loud ('no, I mean Thursday'). Change nothing else.",
  },
  {
    id: "idea",
    keep: true,
    name: "Idea",
    model: "opus",
    apps: [],
    prompt: IDEA_PROMPT,
  },
  {
    id: "journal",
    keep: true,
    name: "Journal",
    model: "opus",
    apps: [],
    prompt: "Journaling or thinking out loud. Light cleanup only: keep my words, my voice and everything I said, in the order I said it. Take out ums, false starts and repeats, fix punctuation, and start a new paragraph where the thought turns.",
  },
  {
    id: "scene",
    keep: true,
    name: "Scene",
    model: "opus",
    apps: [],
    prompt: "A scene or passage of a story I'm drafting out loud. Write it as finished prose in my words and my voice, a paragraph per beat, keeping every action, image and line of dialogue I said. For a screenplay, write it in screenplay format. Don't add story of your own.",
  },
];

export const MODEL_IDS: Record<Model, string> = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };
export const modelOf = (m: unknown): Model | null => (MODELS as unknown[]).includes(m) ? m as Model : null;
// Room for a long instruction pasted in from a chat with Claude.
export const PROMPT_MAX = 8000;

// A person's modes, in order; the starting set is copied in the first time.
export async function modesOf(userId: string): Promise<Mode[]> {
  const sb = admin();
  const { data, error } = await sb.from("scribe_modes").select("id,name,prompt,apps,model,keep").eq("user_id", userId).order("sort").order("id");
  if (error) throw error;
  if (data.length) return data as Mode[];
  const rows = STARTER_MODES.map((m, i) => ({ ...m, user_id: userId, sort: i * 10 }));
  const { error: e2 } = await sb.from("scribe_modes").upsert(rows, { onConflict: "user_id,id", ignoreDuplicates: true });
  if (e2) throw e2;
  return STARTER_MODES;
}

const clean = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");
export const cleanApps = (a: unknown) =>
  (Array.isArray(a) ? a : []).filter((x) => typeof x === "string" && x.trim()).map((x: string) => x.trim().slice(0, 100)).slice(0, 20);
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "mode";

// Adds or changes one of a person's modes. Returns the mode as saved, or the
// reason it wasn't.
export async function saveMode(userId: string, modes: Mode[], m: Record<string, unknown>): Promise<Mode | string> {
  const name = clean(m.name, 40);
  if (!name) return "A mode needs a name.";
  let id = clean(m.id, 40);
  if (!id) { id = slug(name); while (modes.some((x) => x.id === id)) id = `${slug(name)}-${Math.floor(Math.random() * 1000)}`; }
  const at = modes.findIndex((x) => x.id === id);
  // A phone app from before models came in sends none: keep what the mode had.
  const model = modelOf(m.model) ?? (at >= 0 ? modes[at].model : null) ?? "opus";
  // Inkwell has no say in which apps a mode is for, so it sends none: keep them.
  const apps = m.apps === undefined && at >= 0 ? modes[at].apps : cleanApps(m.apps);
  // An app from before "Keep in Inkwell" sends nothing for it: keep what the mode had.
  const keep = typeof m.keep === "boolean" ? m.keep : at >= 0 ? !!modes[at].keep : false;
  const row = { user_id: userId, id, name, prompt: clean(m.prompt, PROMPT_MAX), apps, model, keep, sort: at >= 0 ? at * 10 : modes.length * 10, updated_at: new Date().toISOString() };
  const { error } = await admin().from("scribe_modes").upsert(row, { onConflict: "user_id,id" });
  if (error) throw error;
  return { id, name: row.name, prompt: row.prompt, apps: row.apps, model, keep };
}

// Returns the reason it wasn't deleted, if it wasn't.
export async function deleteMode(userId: string, modes: Mode[], id: unknown): Promise<string | null> {
  if (modes.length <= 1) return "Keep at least one mode.";
  const { error } = await admin().from("scribe_modes").delete().eq("user_id", userId).eq("id", clean(id, 40));
  if (error) throw error;
  return null;
}
