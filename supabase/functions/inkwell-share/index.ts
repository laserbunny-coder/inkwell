// Inkwell's share links: someone with the link reads a piece or a bible page
// and leaves comments, no account needed. The link's secret is the share id;
// what they read is the copy the writer's app published into writing_shares,
// so nothing else of the writer's (other worlds, day pages, Daybook) is ever
// within reach. The writer's own replies and resolves go straight to the
// tables from Inkwell, under row-level security; this is only for readers.
import { admin, cors, json, userFrom } from "../_shared/common.ts";

type Block = { id?: string };
type Content = { chapters?: { blocks?: Block[] }[] };

const TOKEN = /^[A-Za-z0-9]{20,64}$/;
const str = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

// Every paragraph or line id in the shared copy, so a comment can only be
// pinned to something that's there.
export function blockIds(content: Content): Set<string> {
  const ids = new Set<string>();
  for (const ch of content?.chapters ?? []) for (const b of ch?.blocks ?? []) if (typeof b?.id === "string") ids.add(b.id);
  return ids;
}

const COMMENT_COLS = "id,parent_id,block,quote,name,text,owner,resolved,created_at";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Not found" }, 404);
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const token = String(body?.token ?? "");
  if (!body || !TOKEN.test(token)) return json({ error: "This link isn't right. Ask for it again." }, 400);
  const sb = admin();
  const { data: share, error } = await sb.from("writing_shares")
    .select("id,user_id,kind,title,content,can_comment,revoked,updated_at").eq("id", token).maybeSingle();
  if (error) { console.error(error); return json({ error: "Couldn't open this. Try again." }, 500); }
  if (!share || share.revoked) return json({ error: "This link has been turned off.", code: "gone" }, 404);

  if (body.op === "read" || !body.op) {
    const since = typeof body.since === "string" ? body.since : null;
    let q = sb.from("writing_comments").select(COMMENT_COLS).eq("share_id", token).order("created_at").limit(2000);
    if (since) q = q.gt("created_at", since);
    const { data: comments, error: cErr } = await q;
    if (cErr) { console.error(cErr); return json({ error: "Couldn't open this. Try again." }, 500); }
    // Only the words and comments, never who owns them or where they live.
    return json({
      title: share.title,
      kind: share.kind,
      content: since ? undefined : share.content,
      updated_at: share.updated_at,
      can_comment: share.can_comment,
      comments,
    });
  }

  if (body.op === "comment") {
    if (!share.can_comment) return json({ error: "Comments are turned off for this link." }, 403);
    const text = str(body.text, 4000).trim();
    if (!text) return json({ error: "Write something first." }, 400);
    const block = body.block == null ? null : str(body.block, 80);
    if (block && !blockIds(share.content as Content).has(block)) return json({ error: "That part isn't in the shared text any more. Reload to see the latest." }, 409);
    let parent: string | null = null;
    if (body.parent != null) {
      const { data: p } = await sb.from("writing_comments").select("id,block").eq("share_id", token).eq("id", str(body.parent, 40)).maybeSingle();
      if (!p) return json({ error: "That comment is gone." }, 404);
      parent = p.id;
    }
    // A link passed around too far shouldn't flood the writer.
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await sb.from("writing_comments").select("id", { count: "exact", head: true }).eq("share_id", token).gt("created_at", hourAgo);
    if ((count ?? 0) >= 150) return json({ error: "Lots of comments just now. Try again in a while." }, 429);
    // The writer reading their own link (signed in on this browser) replies as themselves.
    const user = await userFrom(req);
    const owner = !!user && user.id === share.user_id;
    const name = str(body.name, 60).trim() || (owner ? str(user?.user_metadata?.full_name, 60) || "The writer" : "A reader");
    const row = {
      share_id: token,
      parent_id: parent,
      block: parent ? null : block,
      quote: parent ? "" : str(body.quote, 500),
      name,
      text,
      guest: str(body.guest, 40) || null,
      user_id: user?.id ?? null,
      owner,
    };
    const { data, error: iErr } = await sb.from("writing_comments").insert(row).select(COMMENT_COLS).single();
    if (iErr) { console.error(iErr); return json({ error: "Couldn't send that. Try again." }, 500); }
    return json({ comment: data });
  }

  return json({ error: "Unknown request" }, 400);
});
