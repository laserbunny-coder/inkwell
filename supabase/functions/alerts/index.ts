// Phone alerts (Web Push).
// From the app (signed in): "key" hands out the public key a browser subscribes with, "test" buzzes
// the person's own devices (or just one), so they can check it gets through Do Not Disturb.
// From the database (a new note, shown by the secret in push_config): checks the person's switches
// (review, needs, notes, and Inkwell's Monday "Your week" and "Your month" letters)
// in alert_prefs and sends the note to each device they turned alerts on for.
import { admin, cors, json, userFrom } from "../_shared/common.ts";
import { send, type Sub, vapidPublic } from "../_shared/webpush.ts";
import { SUBJECT, vapid } from "../_shared/vapid.ts";
import { APP, DEFAULTS, INKWELL, kindOf, message, type Prefs, type SubRow, targets } from "./message.ts";

async function deliver(subs: Sub[], payload: Record<string, unknown>, ttl: number) {
  const db = admin(), jwk = await vapid();
  let sent = 0;
  for (const s of subs) {
    const st = await send(s, payload, jwk, SUBJECT, ttl).catch((e) => { console.error(e); return 0; });
    if (st === 404 || st === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint);
    else if (st >= 200 && st < 300) sent++;
    else console.warn("push status", st);
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  const args = await req.json().catch(() => ({})) as { action?: string; note?: string; endpoint?: string };

  // A new note, from the database trigger
  const secret = req.headers.get("x-cron-secret");
  if (secret) {
    const { data: cfg } = await db.from("push_config").select("cron_secret").eq("id", 1).single();
    if (!cfg || secret !== cfg.cron_secret) return json({ error: "Not allowed" }, 401);
    const { data: n } = await db.from("notes").select("id,user_id,author,title,body,link,kind,project,resolved_at").eq("id", args.note ?? "").maybeSingle();
    if (!n || n.resolved_at) return json({ sent: 0, skipped: "no open note" });
    const { data: p } = await db.from("alert_prefs").select("review,needs,notes,week,month").eq("user_id", n.user_id).maybeSingle();
    const prefs = { ...DEFAULTS, ...(p ?? {}) } as Prefs, k = kindOf(n);
    if (!prefs[k]) return json({ sent: 0, skipped: `${k} alerts are off` });
    const { data: subs } = await db.from("push_subs").select("endpoint,p256dh,auth,app").eq("user_id", n.user_id);
    const to = targets((subs ?? []) as SubRow[]);
    const { ttl, ...m } = message(n, to.app);
    return json({ sent: await deliver(to.subs, m, ttl), kind: k, app: to.app });
  }

  // From the app
  const user = await userFrom(req);
  if (!user) return json({ error: "Not signed in" }, 401);
  if (args.action === "key") return json({ key: vapidPublic(await vapid()) });
  if (args.action === "test") {
    let q = db.from("push_subs").select("endpoint,p256dh,auth").eq("user_id", user.id);
    if (args.endpoint) q = q.eq("endpoint", args.endpoint);
    const { data: subs } = await q;
    const ink = (args as { app?: string }).app === "inkwell";
    const sent = await deliver(subs ?? [], { title: ink ? "Inkwell alerts are on" : "Daybook alerts are on", body: "This is how a Needs you or your 9 pm day review will look.", tag: "test", url: ink ? INKWELL : APP }, 600);
    return json({ sent, devices: subs?.length ?? 0 });
  }
  return json({ error: "Unknown action" }, 400);
});
