// The Inkwell connector for Claude (an MCP server). Its address carries a
// secret made in Inkwell under "Connect Claude to Inkwell"; whoever has the
// address can read that person's writing and add to it, so it's treated like
// a password. It's a separate secret from Daybook's connector.
import { admin, cors } from "../_shared/common.ts";
import { type Db, type Entry, handle } from "./tools.ts";
import type { Note, Update } from "../mcp/tools.ts";

// Needs you items and Catch-up lines: the same lists Daybook's connector writes.
const UPDATE_COLS = "id,project,project_link,link,thread,text,place,state,created_at";
const NOTE_COLS = "id,author,title,body,link,task_ids,created_at,read_at,kind,project,project_link,resolved_at";

const COLS = "id,kind,parent_id,sort,title,text,content,tags,type,fields,area_id,links,deleted,created_at,updated_at";
// The outline leaves out the words, which is most of the size.
const SHAPE_COLS = "id,kind,parent_id,sort,title,type,fields,area_id,deleted,created_at,updated_at";
const SHAPE_KINDS = ["area", "world", "project", "page", "act", "chapter"];

const headers = {
  ...cors,
  "Access-Control-Allow-Headers": cors["Access-Control-Allow-Headers"] + ", mcp-session-id, mcp-protocol-version",
  "Content-Type": "application/json",
};

async function sha256(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function tokenFrom(req: Request): string | null {
  const url = new URL(req.url);
  const m = /\/inkwell-mcp\/([0-9a-f]{48})\/?$/.exec(url.pathname);
  if (m) return m[1];
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  return /^[0-9a-f]{48}$/.test(bearer) ? bearer : null;
}

// A picture or video from a generator's link, brought home. Only https, only
// public hosts, at most 50 MB, given up after a minute.
const MAX = 50 * 1024 * 1024;
const PRIVATE = /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;
async function fetchFile(url: string): Promise<{ bytes: Uint8Array; type: string; name: string } | null> {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" || PRIVATE.test(u.hostname)) return null;
  try {
    const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
    if (!res.ok || !res.body) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!/^(image|video)\//.test(type)) { await res.body.cancel(); return null; }
    if (Number(res.headers.get("content-length") ?? 0) > MAX) { await res.body.cancel(); return null; }
    const parts: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > MAX) return null;
      parts.push(chunk);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { bytes.set(p, at); at += p.length; }
    const cd = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(res.headers.get("content-disposition") ?? "")?.[1];
    const name = decodeURIComponent(cd ?? u.pathname.split("/").filter(Boolean).at(-1) ?? "").slice(0, 200);
    return { bytes, type, name };
  } catch {
    return null;
  }
}

const full = (r: Partial<Entry>): Entry => ({ text: "", content: null, tags: [], links: [], ...r } as Entry);

function dbFor(userId: string): Db {
  const sb = admin();
  const all = async (cols: string, build: (q: any) => any) => {
    const rows: Entry[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await build(sb.from("writing_entries").select(cols).eq("user_id", userId)).order("id").range(from, from + 999);
      if (error) throw error;
      rows.push(...(data as Entry[]).map(full));
      if (data.length < 1000) return rows;
    }
  };
  return {
    outline: () => all(SHAPE_COLS, (q) => q.in("kind", SHAPE_KINDS).eq("deleted", false)),
    async get(ids) {
      if (!ids.length) return [];
      const { data, error } = await sb.from("writing_entries").select(COLS).eq("user_id", userId).in("id", ids.slice(0, 200));
      if (error) throw error;
      return (data as Entry[]).map(full);
    },
    kids: (parentIds) => parentIds.length ? all(COLS, (q) => q.in("parent_id", parentIds.slice(0, 200)).eq("deleted", false)) : Promise.resolve([]),
    async find(o) {
      const { data, error } = await sb.rpc("inkwell_search", {
        p_user: userId, p_query: o.query, p_kinds: o.kinds, p_tag: o.tag, p_under: o.under,
        p_since: o.since, p_until: o.until, p_newest: o.newest, p_limit: o.limit,
      });
      if (error) throw error;
      return (data as Entry[]).map(full);
    },
    async tags(under) {
      const { data, error } = await sb.rpc("inkwell_tags", { p_user: userId, p_under: under });
      if (error) throw error;
      return data;
    },
    async rollup() {
      const { data, error } = await sb.rpc("inkwell_rollup", { p_user: userId });
      if (error) throw error;
      return data;
    },
    async linkedFrom(ids, limit) {
      if (!ids.length) return [];
      const { data, error } = await sb.rpc("inkwell_linked_from", { p_user: userId, p_ids: ids, p_limit: limit });
      if (error) throw error;
      return (data as Entry[]).map(full);
    },
    async byKind(kinds, limit) {
      const { data, error } = await sb.from("writing_entries").select(COLS).eq("user_id", userId).in("kind", kinds).eq("deleted", false)
        .order("updated_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return (data as Entry[]).map(full);
    },
    async updateAbout(id, patch) {
      // Only ever one of Claude's own abouts: the kind is part of the match.
      const { error } = await sb.from("writing_entries").update(patch).eq("user_id", userId).eq("id", id).eq("kind", "about");
      if (error) throw error;
    },
    async change(id, was, patch) {
      // Only where a line sits and its fields; the words are never part of it.
      const safe: Record<string, unknown> = {};
      for (const k of ["parent_id", "sort", "fields"] as const) if (k in patch) safe[k] = patch[k];
      let q = sb.from("writing_entries").update(safe).eq("user_id", userId).eq("id", id).not("kind", "in", "(about,digest,change,tidy)");
      if (was) q = q.eq("updated_at", was);
      const { data, error } = await q.select("id");
      if (error) throw error;
      return (data ?? []).length > 0;
    },
    async reword(id, was, patch) {
      // A line's words only (rename_line and its undo), never anything else.
      const { text, content, tags, links } = patch;
      let q = sb.from("writing_entries").update({ text, content, tags, links }).eq("user_id", userId).eq("id", id).eq("kind", "line");
      if (was) q = q.eq("updated_at", was);
      const { data, error } = await q.select("id");
      if (error) throw error;
      return (data ?? []).length > 0;
    },
    async markChange(id, fields) {
      const { error } = await sb.from("writing_entries").update({ fields }).eq("user_id", userId).eq("id", id).eq("kind", "change");
      if (error) throw error;
    },
    async insert(rows) {
      if (!rows.length) return;
      const { error } = await sb.from("writing_entries").insert(rows.map((r) => ({ ...r, user_id: userId })));
      if (error) throw error;
    },
    async fileLinks(ids) {
      if (!ids.length) return [];
      const { data, error } = await sb.storage.from("writing-files").createSignedUrls(ids.map((id) => `${userId}/${id}`), 86400);
      if (error) throw error;
      const byPath = new Map((data ?? []).map((d: { path: string | null; signedUrl: string | null; error: string | null }) => [d.path, d.error ? null : d.signedUrl]));
      return ids.map((id) => byPath.get(`${userId}/${id}`) ?? null);
    },
    async keepFile(id, bytes, type) {
      const { error } = await sb.storage.from("writing-files").upload(`${userId}/${id}`, bytes, { contentType: type, upsert: true });
      if (error) throw error;
    },
    fetchFile,
    tasks: () => all(COLS, (q) => q.eq("kind", "line").eq("deleted", false).not("fields->task", "is", null)),
    async setSettings(id, fields) {
      const { data, error } = await sb.from("writing_entries").update({ fields }).eq("user_id", userId).eq("id", id).eq("kind", "settings").select("id");
      if (error) throw error;
      return (data ?? []).length > 0;
    },
    async listNeeds(limit, includeCleared) {
      let q = sb.from("notes").select(NOTE_COLS).eq("user_id", userId).not("kind", "is", null);
      if (!includeCleared) q = q.is("resolved_at", null);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return data as Note[];
    },
    async openNeed(link) {
      const { data, error } = await sb.from("notes").select(NOTE_COLS).eq("user_id", userId).eq("link", link).not("kind", "is", null).is("resolved_at", null).maybeSingle();
      if (error) throw error;
      return data as Note | null;
    },
    async getNeed(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const { data, error } = await sb.from("notes").select(NOTE_COLS).eq("user_id", userId).eq("id", id).not("kind", "is", null).maybeSingle();
      if (error) throw error;
      return data as Note | null;
    },
    async addNeed(n) {
      const { data, error } = await sb.from("notes").insert({ ...n, task_ids: [], user_id: userId }).select(NOTE_COLS).single();
      if (error) throw error;
      return data as Note;
    },
    async updateNeed(id, patch) {
      const { data, error } = await sb.from("notes").update(patch).eq("user_id", userId).eq("id", id).select(NOTE_COLS).single();
      if (error) throw error;
      return data as Note;
    },
    async listUpdates(sinceIso, limit) {
      const { data, error } = await sb.from("claude_updates").select(UPDATE_COLS).eq("user_id", userId).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return data as Update[];
    },
    async addUpdate(u) {
      const { data, error } = await sb.from("claude_updates").insert({ ...u, user_id: userId }).select(UPDATE_COLS).single();
      if (error) throw error;
      return data as Update;
    },
    async timeZone() {
      const { data, error } = await sb.auth.admin.getUserById(userId);
      if (error) throw error;
      const tz = data.user?.user_metadata?.tz;
      return typeof tz === "string" && tz ? tz : null;
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });

  const token = tokenFrom(req);
  const { data: owner } = token
    ? await admin().from("inkwell_mcp_tokens").select("user_id").eq("token_hash", await sha256(token)).maybeSingle()
    : { data: null };
  if (!owner) {
    return new Response(JSON.stringify({ error: "This Inkwell connector address isn't valid. Make a new one in Inkwell with Connect Claude to Inkwell." }), { status: 404, headers });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), { status: 400, headers });
  }
  const db = dbFor(owner.user_id);
  const many = Array.isArray(body);
  const out = [];
  for (const m of many ? body as unknown[] : [body]) {
    const r = await handle(m as Parameters<typeof handle>[0], db);
    if (r) out.push(r);
  }
  if (!out.length) return new Response(null, { status: 202, headers });
  return new Response(JSON.stringify(many ? out : out[0]), { headers });
});
