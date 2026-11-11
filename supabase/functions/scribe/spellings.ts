// Spellings Scribe remembers: names (or unusual words) the person corrected
// with a voice fix and asked Scribe to remember. The speech service is told
// them first, before the names from Inkwell, so they come back spelled right.
// They can be seen and taken out again in the Scribe app.
import { admin } from "../_shared/common.ts";
import { cleanSpelling, listenFor } from "./fix.ts";
import { namesFrom } from "./keep.ts";

const MAX = 200;

export async function spellingsOf(userId: string): Promise<string[]> {
  const { data, error } = await admin().from("scribe_spellings").select("term").eq("user_id", userId).order("created_at", { ascending: false }).limit(MAX);
  if (error) throw error;
  return (data ?? []).map((r) => String(r.term));
}

/** Keeps a spelling (again, it moves to the front); answers the whole list, or an error to show. */
export async function remember(userId: string, term: unknown): Promise<string[] | string> {
  const t = cleanSpelling(term);
  if (!t) return "That doesn't look like a name to remember.";
  // One entry per word whatever its capitals: the new spelling replaces the old.
  await admin().from("scribe_spellings").delete().eq("user_id", userId).ilike("term", t.replace(/[%_\\]/g, "\\$&"));
  const { error } = await admin().from("scribe_spellings").insert({ user_id: userId, term: t });
  if (error) throw error;
  return await spellingsOf(userId);
}

export async function forget(userId: string, term: unknown): Promise<string[]> {
  if (typeof term === "string" && term.trim()) {
    const { error } = await admin().from("scribe_spellings").delete().eq("user_id", userId).eq("term", term.trim());
    if (error) throw error;
  }
  return await spellingsOf(userId);
}

/** What the speech service listens for: remembered spellings, then Inkwell's names. */
export async function termsFor(userId: string): Promise<string[]> {
  const spellings = await spellingsOf(userId).catch((err) => { console.warn("no spellings", err); return [] as string[]; });
  return listenFor(spellings, await namesFrom(userId));
}
