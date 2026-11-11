// Fixing text by voice, from the Scribe keyboard. The person holds Fix and
// says what to change ("make it Tuesday", "Nate, N A T E", "make that
// friendlier"). The keyboard sends the words to change (what they selected,
// what Scribe just typed, or the line before the cursor), a little of the
// text on either side, and the recording; Claude hands back those words with
// the change made. Names they spelled out can be remembered, so the speech
// service hears them right next time (spellings.ts).
//
// Only plain helpers live here, so they can be checked without the server:
//   node --experimental-strip-types supabase/functions/scribe/fix.test.ts
import type { Model } from "./modes.ts";

export const FIX_HINT = "Someone telling their dictation keyboard how to change text they just typed: a correction, a name spelled out letter by letter, or a rewording.";

// Room for a whole paragraph to be reworded; the context on either side only helps Claude understand.
export const TARGET_MAX = 4000;
export const AROUND_MAX = 800;

export const FIX_SYSTEM = `You fix text someone dictated with Scribe, their voice keyboard. They picked a piece of text (they selected it, or Scribe just typed it in), then said out loud how to change it. Hand back that piece of text with the change made.

- Change only what they asked. Every other word, the punctuation, the line breaks and their voice stay exactly as they are.
- They may correct a word or a name ("Nate, not Nait", "it's spelled N A T E"), swap something ("make it Tuesday"), add or cut ("add see you then at the end", "drop the last sentence"), fix punctuation, or reword ("make that friendlier", "shorter", "more formal"). A rewording keeps their meaning and their facts and adds nothing they didn't say.
- If they spell something letter by letter, use exactly that spelling, with normal capitals for a name.
- The text before and after is there only to help you understand. Never change it or repeat it in your answer.
- learn: the names or unusual words whose spelling they corrected, exactly as now spelled in your text, so the speech service hears them right next time. Empty for any other kind of change (rewording, swapping a day, adding words). At most three.
- scope: "part" almost always: text is the picked text with the change made. When the whole box is given too and they clearly mean all of it ("the whole thing", "all of it", "the whole message", "everything", "throughout", "everywhere"), scope is "whole" and text is the entire box with the change made. A change that fits inside the picked text stays "part".
- unchanged: true, with the text exactly as it was, when what they said isn't a change to this text (silence, a stray word, talking to someone else).
- Plain text, no Markdown, nothing added before or after it.`;

export const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scope", "text", "learn", "unchanged"],
  properties: {
    scope: { type: "string", enum: ["part", "whole"] },
    text: { type: "string", description: "The picked text (or, with scope whole, the whole box) with the change made." },
    learn: { type: "array", items: { type: "string" } },
    unchanged: { type: "boolean" },
  },
};

export type FixRequest = { text: string; before: string; after: string; how: string; said: string; modeName: string; modePrompt: string; app: string; whole?: string };

/**
 * What Claude is told: the text to change, what's around it, and what they
 * said. With the whole box (when it's short enough to change in one go), the
 * box stands in for the text around, and they can ask to change all of it.
 */
export function fixContent(r: FixRequest): string {
  const where = r.how === "selection" ? "They selected this text" : r.how === "last" ? "Scribe just typed this text in" : "This is the text just before their cursor";
  const whole = r.whole?.trim() ? r.whole : "";
  const lines = [
    `${where}:\n<text>\n${r.text}\n</text>`,
    whole ? `Everything in the box, the picked text included (change all of it only when they ask about the whole thing):\n<whole>\n${whole}\n</whole>` : "",
    !whole && r.before.trim() ? `Just before it (don't change):\n<before>\n${r.before}\n</before>` : "",
    !whole && r.after.trim() ? `Just after it (don't change):\n<after>\n${r.after}\n</after>` : "",
    r.modePrompt.trim() ? `How they usually write here (mode "${r.modeName}"): ${r.modePrompt.trim()}` : "",
    r.app ? `They're typing into: ${r.app}` : "",
    `What they said to change:\n<said>\n${r.said}\n</said>`,
  ];
  return lines.filter(Boolean).join("\n\n");
}

/**
 * Which Claude makes the fix: the mode's own, except that a short fix in an
 * Opus mode goes to Sonnet, since the keyboard is open and waiting.
 */
export function fixModel(mode: Model, length: number): Model {
  return mode === "opus" && length <= 600 ? "sonnet" : mode;
}

const usable = (t: string) => t.length >= 2 && t.length < 50 && t.split(/\s+/).length <= 5 && !/[<>{}[\]\\\r\n*%]/.test(t);

/**
 * Names worth remembering from a fix: only ones now in the new text and not
 * in the old (so a real correction), a few words at most, three at most.
 */
export function cleanLearn(learn: unknown, before: string, after: string): string[] {
  if (!Array.isArray(learn)) return [];
  const out: string[] = [];
  for (const raw of learn) {
    if (typeof raw !== "string") continue;
    const t = raw.replace(/\s+/g, " ").trim();
    if (!usable(t) || !after.includes(t) || before.includes(t)) continue;
    if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= 3) break;
  }
  return out;
}

export type FixResult = { scope: "part" | "whole"; text: string; learn: string[]; unchanged: boolean };

/**
 * Claude's answer made safe to type in: the edges of what was changed stay as
 * they were (Claude tends to trim spaces and line breaks), an empty answer
 * keeps the text, and names to remember are checked. Scope "whole" counts
 * only when the whole box was sent.
 */
export function finishFix(text: string, out: Record<string, unknown>, whole = ""): FixResult {
  const scope = out.scope === "whole" && whole.trim() ? "whole" : "part";
  const base = scope === "whole" ? whole : text;
  const fixed = typeof out.text === "string" && out.text.trim() ? out.text.replace(/\r\n?/g, "\n").trim() : base.trim();
  const result = base.match(/^\s*/)![0] + fixed + base.match(/\s*$/)![0];
  const unchanged = out.unchanged === true || result === base;
  if (unchanged) return { scope: "part", text, learn: [], unchanged: true };
  return { scope, text: result, learn: cleanLearn(out.learn, base, result), unchanged: false };
}

/** A spelling to keep: tidied, or null if it can't be one. */
export function cleanSpelling(t: unknown): string | null {
  if (typeof t !== "string") return null;
  const s = t.replace(/\s+/g, " ").trim();
  return usable(s) ? s : null;
}

/** Remembered spellings first (they were asked for), then the names from Inkwell, without repeats. */
export function listenFor(spellings: string[], names: string[], max = 100): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of [...spellings, ...names]) {
    const k = t.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t.trim());
    if (out.length >= max) break;
  }
  return out;
}
