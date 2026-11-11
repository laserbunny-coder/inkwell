// Scribe keeps its recordings in Inkwell. When a dictation's mode has "Keep in
// Inkwell" on, the recording goes into Inkwell's file storage and a line goes
// on that day's page, the same shape as a Capture made in Inkwell: the
// recording, the time it was said and #idea. The line carries what was heard
// and what Scribe typed in (fields.scribe); Inkwell writes it up from those
// the next time it opens or syncs (word for word kept, the mode's chip to
// switch), without hearing it a second time.
import { admin } from "../_shared/common.ts";
import type { Mode } from "./modes.ts";

const GAP = 1024;
const MAX_BYTES = 50 * 1024 * 1024; // the same as a file added in Inkwell

export type Keep = {
  said: string; text: string; mode: Mode; app: string; duration: number; heardBy?: string;
  // From the Record tile: Inkwell's own write-up (paragraphs, notes to self, a title).
  blocks?: { text: string; el: string; new_scene: boolean }[]; notes?: { text: string; after: number }[]; title?: string;
};
type Row = Record<string, unknown> & { id: string; kind: string };

export function newId(prefix: string): string {
  const t = Date.now().toString(36).padStart(9, "0");
  const r = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join("");
  return `${prefix}_${t}${r}`;
}

/** The date (YYYY-MM-DD) and the time ("3:42 pm") where the person is. */
export function localTime(tz: string | null, now = new Date()): { day: string; clock: string } {
  const zone = (() => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/Los_Angeles" }); return tz || "America/Los_Angeles"; } catch { return "America/Los_Angeles"; } })();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const clock = now.toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).replace(/\s/g, " ").toLowerCase();
  return { day, clock };
}

const extOf = (type: string, name: string) => {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name || "");
  if (m) return m[1].toLowerCase();
  return /mp4|m4a|aac/.test(type) ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("mpeg") ? "mp3" : type.includes("wav") ? "wav" : "webm";
};

/** The rows Inkwell gets: the recording's file entry and the line on the day page. */
export function rowsFor(o: { fileId: string; lineId: string; type: string; size: number; name: string; day: string; clock: string; sort: number; keep: Keep }): { file: Row; line: Row } {
  const { keep } = o;
  const duration = Math.max(0, Math.round(keep.duration || 0));
  const file: Row = {
    id: o.fileId, kind: "file", parent_id: null, sort: 0, title: o.name, text: "", content: null, tags: [], type: null,
    area_id: null, links: [], deleted: false,
    fields: { type: o.type, size: o.size, duration, from: "scribe" },
  };
  const node = { type: "file", attrs: { id: o.fileId, name: o.name, type: o.type, size: o.size, duration } };
  const after = ` ${o.clock} #idea`;
  const line: Row = {
    id: o.lineId, kind: "line", parent_id: `day-${o.day}`, sort: o.sort, title: "", text: after, content: [node, { type: "text", text: after }],
    tags: ["idea"], type: null, area_id: null, links: [], deleted: false,
    fields: {
      done: false, gather: null, gathered: null, mirror: null, capture: "voice", said: o.clock,
      scribe: {
        raw: keep.said, text: keep.text, mode: keep.mode.id, name: keep.mode.name, app: keep.app || null, by: keep.heardBy || null,
        ...(keep.blocks?.length ? { blocks: keep.blocks, notes: keep.notes ?? [] } : {}), ...(keep.title ? { title: keep.title } : {}),
      },
    },
  };
  return { file, line };
}

async function timeZone(userId: string): Promise<string | null> {
  const { data, error } = await admin().auth.admin.getUserById(userId);
  if (error) return null;
  const tz = data.user?.user_metadata?.tz;
  return typeof tz === "string" && tz ? tz : null;
}

/**
 * Files the recording in Inkwell. Errors are logged, never thrown, after a
 * dictation (what was typed in has already gone back); with `strict` (the
 * Record tile, where Inkwell is the only place it goes) they're thrown, so the
 * phone keeps the recording and tries again.
 */
export async function keepInInkwell(userId: string, audio: File, keep: Keep, now = new Date(), strict = false): Promise<string | null> {
  try {
    if (!audio.size || audio.size > MAX_BYTES || !keep.said.trim()) return null;
    const sb = admin();
    const { day, clock } = localTime(await timeZone(userId), now);
    const type = (audio.type || "audio/mp4").split(";")[0];
    const fileId = newId("fi");
    const name = `Scribe ${clock}.${extOf(type, audio.name)}`;
    const up = await sb.storage.from("writing-files").upload(`${userId}/${fileId}`, audio, { contentType: type, upsert: false });
    if (up.error) throw up.error;
    // The day only exists once something's written on it.
    const dayId = `day-${day}`;
    const { data: had, error: hErr } = await sb.from("writing_entries").select("deleted").eq("user_id", userId).eq("id", dayId).maybeSingle();
    if (hErr) throw hErr;
    const { error: dErr } = !had
      ? await sb.from("writing_entries").upsert(
        { user_id: userId, id: dayId, kind: "day", parent_id: null, sort: 0, title: day, text: "", content: null, tags: [], type: null, area_id: null, links: [], deleted: false, fields: {} },
        { onConflict: "id", ignoreDuplicates: true },
      )
      : had.deleted ? await sb.from("writing_entries").update({ deleted: false }).eq("user_id", userId).eq("id", dayId) : { error: null };
    if (dErr) throw dErr;
    const { data: kids, error: kErr } = await sb.from("writing_entries").select("sort").eq("user_id", userId).eq("parent_id", dayId).eq("deleted", false).order("sort", { ascending: false }).limit(1);
    if (kErr) throw kErr;
    const sort = (Number(kids?.[0]?.sort) || 0) + GAP;
    const { file, line } = rowsFor({ fileId, lineId: newId("li"), type, size: audio.size, name, day, clock, sort, keep });
    const { error } = await sb.from("writing_entries").insert([file, line].map((r) => ({ ...r, user_id: userId })));
    if (error) throw error;
    return line.id;
  } catch (err) {
    console.error("couldn't keep the recording in Inkwell", err);
    if (strict) throw err;
    return null;
  }
}

// Page names every world has say nothing about what's said (as Inkwell's terms.js).
const PLAIN = /^(idea|ideas|overview|gather|notes|research|bible|characters|places|draft|meeting( \d{4}-\d\d-\d\d)?|(untitled|chapter|act|scene|episode|season)\b.*)$/i;
export const usable = (t: unknown): t is string =>
  typeof t === "string" && t.trim().length >= 2 && t.trim().length < 50 && t.trim().split(/\s+/).length <= 5 && !PLAIN.test(t.trim());

/** Names to listen for: every world's name, then its pages and pieces (Inkwell's own list for a day-page capture). */
export async function namesFrom(userId: string, max = 100): Promise<string[]> {
  try {
    const { data, error } = await admin().from("writing_entries").select("title,kind").eq("user_id", userId).eq("deleted", false).in("kind", ["world", "page", "project"]).limit(2000);
    if (error) throw error;
    const out: string[] = [];
    for (const kind of ["world", "project", "page"]) {
      for (const r of data ?? []) if (r.kind === kind && usable(r.title) && !out.includes(r.title.trim())) out.push(r.title.trim());
    }
    return out.slice(0, max);
  } catch (err) {
    console.warn("no names to listen for", err);
    return [];
  }
}
