// The Daybook connector for Claude (an MCP server). Its address carries a
// secret made in the app under "Connect to Claude"; whoever has the address
// can read and change that person's tasks, so it's treated like a password.
import { admin, cors } from "../_shared/common.ts";
import { type Db, handle, type Note, type Row, type Update } from "./tools.ts";

const COLS = "id,parent_id,title,notes,done,day,start_min,after_min,duration_min,sort,day_sort,color,due,link,kind,area_id,start,milestone,hard_deadline,waits_on,done_at,actual_minutes,time_log,planned,repeat_rule,series_id,occurs_on,focus_on,week_minutes,habit,day_targets,time_pref,days_done,labels,deleted";

const UPDATE_COLS = "id,project,project_link,link,thread,text,place,state,created_at";

const NOTE_COLS = "id,author,title,body,link,task_ids,created_at,read_at,kind,project,project_link,resolved_at";

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
  const m = /\/mcp\/([0-9a-f]{48})\/?$/.exec(url.pathname);
  if (m) return m[1];
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  return /^[0-9a-f]{48}$/.test(bearer) ? bearer : null;
}

function dbFor(userId: string): Db {
  const sb = admin();
  return {
    async load() {
      const rows: Row[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("items").select(COLS).eq("user_id", userId).or("deleted.eq.false,occurs_on.not.is.null").order("id").range(from, from + 999);
        if (error) throw error;
        rows.push(...(data as Row[]));
        if (data.length < 1000) return rows;
      }
    },
    async loadDeleted(sinceIso) {
      const rows: Row[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("items").select(COLS + ",deleted_at").eq("user_id", userId).eq("deleted", true).gte("deleted_at", sinceIso).order("deleted_at", { ascending: false }).range(from, from + 999);
        if (error) throw error;
        rows.push(...(data as Row[]));
        if (data.length < 1000 || rows.length >= 5000) return rows;
      }
    },
    async save(rows) {
      // Rows that set done_at on purpose go apart from the rest: an upsert fills a missing
      // column with null, and done_at left out is what lets the database stamp check-offs
      for (const part of [rows.filter((r) => r.done_at !== undefined), rows.filter((r) => r.done_at === undefined)]) {
        if (!part.length) continue;
        const { error } = await sb.from("items").upsert(part.map((r) => ({ ...r, user_id: userId })));
        if (error) throw error;
      }
    },
    // Free hours live with the account (user_metadata.free_hours), where the app keeps them too
    async getFreeHours() {
      const { data, error } = await sb.auth.admin.getUserById(userId);
      if (error) throw error;
      const v = Number(data.user?.user_metadata?.free_hours);
      return v > 0 ? v : null;
    },
    async timeZone() {
      const { data, error } = await sb.auth.admin.getUserById(userId);
      if (error) throw error;
      const tz = data.user?.user_metadata?.tz;
      return typeof tz === "string" && tz ? tz : null;
    },
    async setFreeHours(hours) {
      const { data, error } = await sb.auth.admin.getUserById(userId);
      if (error) throw error;
      const { error: e2 } = await sb.auth.admin.updateUserById(userId, { user_metadata: { ...(data.user?.user_metadata ?? {}), free_hours: hours } });
      if (e2) throw e2;
    },
    async listNotes(limit, unreadOnly) {
      let q = sb.from("notes").select(NOTE_COLS).eq("user_id", userId).is("kind", null);
      if (unreadOnly) q = q.is("read_at", null);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return data as Note[];
    },
    async addNote(n) {
      const { data, error } = await sb.from("notes").insert({ ...n, user_id: userId }).select(NOTE_COLS).single();
      if (error) throw error;
      return data as Note;
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
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });

  const token = tokenFrom(req);
  const { data: owner } = token
    ? await admin().from("mcp_tokens").select("user_id").eq("token_hash", await sha256(token)).maybeSingle()
    : { data: null };
  if (!owner) {
    return new Response(JSON.stringify({ error: "This Daybook connector address isn't valid. Make a new one in Daybook under Connect to Claude." }), { status: 404, headers });
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
