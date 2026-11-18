// What a phone alert says and which devices get it (no Deno or database here,
// so it can be checked on its own: node --experimental-strip-types alerts/message.test.ts).
import type { Sub } from "../_shared/webpush.ts";

export type Note = { id: string; user_id: string; author: string | null; title: string | null; body: string | null; link: string | null; kind: string | null; project: string | null; resolved_at: string | null };
export type Kind = "needs" | "review" | "week" | "month" | "notes";
const KIND = { decision: "a decision", blocked: "blocked on you", review: "ready to review" } as Record<string, string>;
export const APP = "https://laserbunny-coder.github.io/daybook/";
export const INKWELL = "https://laserbunny-coder.github.io/inkwell/";
export type App = "daybook" | "inkwell";
export type SubRow = Sub & { app?: string | null };

/** Once any Inkwell device is signed up, alerts go to Inkwell's devices only. */
export function targets(subs: SubRow[]): { app: App; subs: Sub[] } {
  const ink = subs.filter((s) => s.app === "inkwell");
  const list = ink.length ? ink : subs.filter((s) => s.app !== "inkwell");
  return { app: ink.length ? "inkwell" : "daybook", subs: list.map(({ endpoint, p256dh, auth }) => ({ endpoint, p256dh, auth })) };
}

/** What kind of note it is. */
export function kindOf(n: Pick<Note, "kind" | "author" | "title">): Kind {
  if (n.kind) return "needs";
  const inkwell = (n.author ?? "") === "Inkwell", title = n.title ?? "";
  if (inkwell && title === "Your day review") return "review";
  if (inkwell && (title.startsWith("Your week") || title === "Your tidy pass in Inkwell")) return "week";
  if (inkwell && title.startsWith("Your month")) return "month";
  return "notes";
}

/** Only Needs you buzzes a phone (Nov 18 2026): the rest are still written, quietly. */
export const buzzes = (k: Kind) => k === "needs";

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** What the notification says, and where tapping it goes. */
export function message(n: Note, app: App = "daybook") {
  const k = kindOf(n);
  if (app === "inkwell") {
    // Inkwell's own links open in Inkwell; the Needs you link is the Claude thread.
    const m = message(n, "daybook");
    const url = k === "needs" ? n.link || INKWELL + "?desk" : k === "notes" ? INKWELL + "?desk" : n.link || INKWELL;
    return { ...m, url, ...(k === "week" ? { body: "Last week summed up, and the things you said you'd do." } : {}) };
  }
  if (k === "needs") {
    return {
      title: clip(n.title || "Something needs you", 80),
      body: `${n.project ? n.project + " · " : ""}${KIND[n.kind!] ?? "needs you"}`,
      tag: "needs-" + n.id, url: n.link || APP + "?needs", ttl: 24 * 3600,
    };
  }
  if (k === "week") {
    return { title: clip(n.title || "Your week", 80), body: "Last week in Inkwell, and the things you said you'd do. Tap + to make any a task.", tag: "week", url: APP + "?notes", ttl: 24 * 3600 };
  }
  if (k === "month") {
    return { title: clip(n.title || "Your month", 80), body: "Last month in Inkwell, summed up.", tag: "month", url: n.link || APP + "?notes", ttl: 48 * 3600 };
  }
  return { title: clip(n.title || `A note from ${n.author || "Claude"}`, 80), body: clip(n.body || "", 160), tag: "note-" + n.id, url: APP + "?notes", ttl: 12 * 3600 };
}

