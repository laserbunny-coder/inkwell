// Keeps Michael's Acro HQ board tasks and Daybook's Business area in step (see sync.ts). Woken every 2 minutes
// by the database job (migrations/20261103030000_acro_tasks.sql). A wake carries nothing: it only goes and
// looks, through HQ's Acro Meta connector (the ACRO_CONNECTOR_URL secret), so anyone calling it can at most
// make it look. One run at a time (a lock in acro_task_sync).
import { admin, json } from "../_shared/common.ts";
import { callTool } from "../inkwell/acro.ts";
import { BY, type Item, type Link, plan, type Task } from "./sync.ts";
import { carryLinks, type ILink, type Line, planInkwell } from "./inkwell.ts";
import { MEETINGS_PAGE, type Meeting, type Page, planMeetings } from "./meetings.ts";

const BOARD_URL = "https://acro-hq.laserbunny.workers.dev";
const CUT = "(cut; board_get has all of it)";
const COLS = "id,parent_id,title,notes,done,due,link,kind,area_id,deleted,sort,repeat_rule,series_id,habit";

async function boardTasks(url: string): Promise<Task[]> {
  const out: Task[] = [];
  for (let offset = 0; offset < 5000; offset += 200) {
    const r = await callTool(url, "board_list", { collection: "tasks", limit: 200, offset });
    const docs = (r.docs ?? []) as Task[];
    out.push(...docs.map((d) => ({ id: d.id, version: Number(d.version), data: d.data ?? {} })));
    if (docs.length < 200) break;
  }
  // board_list shortens long notes; fetch the whole task for those
  for (const t of out) {
    if (typeof t.data.notes === "string" && t.data.notes.endsWith(CUT)) {
      const d = await callTool(url, "board_get", { collection: "tasks", id: t.id }) as unknown as Task;
      t.data = d.data ?? t.data; t.version = Number(d.version);
    }
  }
  return out;
}

const ENTRY_COLS = "id,kind,parent_id,sort,title,text,content,tags,fields,area_id,deleted,updated_at";
type Row = Line & { title?: string; area_id?: string | null; updated_at?: string };

async function entries(db: ReturnType<typeof admin>, userId: string, build: (q: any) => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await build(db.from("writing_entries").select(ENTRY_COLS).eq("user_id", userId)).order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...(data as Row[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

/** The board <-> Inkwell's Acro project, and HQ's meetings into it (see inkwell.ts, meetings.ts). */
async function runInkwell(db: ReturnType<typeof admin>, url: string, userId: string, firstRun: boolean, savedWorld: string | null, done: string[], failed: string[]) {
  const rows = await entries(db, userId, (q) => q.in("kind", ["area", "world", "page", "project", "day", "line"]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const live = (r: Row | undefined) => !!r && !r.deleted && !r.fields?.trashed;
  // The Acro project: the one chosen before; else a world called exactly "Acro HQ" or "Acro" (a life project
  // first); else one made in the Business area. The choice is kept so a renamed project stays the one.
  const named = rows.filter((r) => r.kind === "world" && live(r) && /^acro( hq)?$/i.test((r.title ?? "").trim()))
    .sort((a, b) => Number(!!b.fields?.life) - Number(!!a.fields?.life) || (b.title ?? "").length - (a.title ?? "").length || a.id.localeCompare(b.id));
  let world = savedWorld && live(byId.get(savedWorld)) ? byId.get(savedWorld)! : named[0];
  const make: Record<string, unknown>[] = [];
  if (!world) {
    const area = rows.find((r) => r.kind === "area" && live(r) && /^business$/i.test((r.title ?? "").trim()));
    world = { id: "wd-acro-hq", kind: "world", parent_id: null, sort: 0, title: "Acro HQ", text: "", content: null, tags: [], fields: { life: true, by: "hq" }, area_id: area?.id ?? null, deleted: false };
    if (!byId.has(world.id)) make.push({ ...world, user_id: userId });
  }
  const stepsId = `steps-${world.id}`;
  if (!live(byId.get(stepsId)) && !byId.has(stepsId)) make.push({ id: stepsId, kind: "page", parent_id: world.id, sort: 999999, title: "Steps", text: "", tags: [], fields: {}, deleted: false, user_id: userId });
  if (make.length) { const { error } = await db.from("writing_entries").upsert(make); if (error) throw error; }
  if (world.id !== savedWorld) await db.from("acro_task_sync").update({ world_id: world.id }).eq("user_id", userId);

  // Which lines are in the Acro project.
  const inWorld = new Map<string, boolean>();
  const inAcro = (r: Row): boolean => {
    if (inWorld.has(r.id)) return inWorld.get(r.id)!;
    let x: Row | undefined = r, yes = false;
    for (let n = 0; x && n < 60; n++) { if (x.id === world.id) { yes = true; break; } x = x.parent_id ? byId.get(x.parent_id) : undefined; }
    inWorld.set(r.id, yes);
    return yes;
  };
  const lines = rows.filter((r) => r.kind === "line");
  const kids = new Map<string, Row[]>();
  for (const l of lines) if (l.parent_id && !l.deleted) kids.set(l.parent_id, [...(kids.get(l.parent_id) ?? []), l]);

  // The first Inkwell run: Daybook's links move onto the lines the import made.
  if (firstRun) {
    const { data: old } = await db.from("acro_task_links").select("item_id,task_id").eq("user_id", userId).limit(10000);
    for (const m of carryLinks(old ?? [], new Set(lines.map((l) => l.id)))) {
      await db.from("acro_task_links").delete().eq("item_id", m.from).eq("user_id", userId);
      if (m.task_id) await db.from("acro_task_links").upsert({ item_id: m.to, user_id: userId, task_id: m.task_id, seen: null, updated_at: new Date().toISOString() });
    }
    // Links to Daybook items the import didn't bring over are dropped: Daybook no longer syncs, and their
    // board tasks come in afresh (a link holds its task, so a left-over one would block the new line's link).
    const { error: dropErr } = await db.from("acro_task_links").delete().eq("user_id", userId).not("item_id", "like", "li-%");
    if (dropErr) throw dropErr;
    await db.from("acro_task_sync").update({ target: "inkwell" }).eq("user_id", userId);
  }
  const [tasks, linksRes] = await Promise.all([boardTasks(url), db.from("acro_task_links").select("item_id,task_id,seen").eq("user_id", userId).like("item_id", "li-%").limit(10000)]);
  if (linksRes.error) throw linksRes.error;
  const links = (linksRes.data ?? []) as ILink[];
  const linkedIds = new Set(links.map((l) => l.item_id));
  const mine = lines.filter((l) => linkedIds.has(l.id) || (l.fields?.task && inAcro(l)));
  const notes = new Map(lines.filter((l) => l.fields?.hqNotes && !l.deleted).map((l) => [String(l.fields.hqNotes), l as Line]));
  const under = new Map(mine.map((l) => [l.id, (kids.get(l.id) ?? []).filter((k) => !k.fields?.hqNotes).map((k) => k.text).join("\n")]));
  const steps = planInkwell({
    tasks, lines: mine, notes, links, acro: new Set(mine.filter(inAcro).map((l) => l.id)), under, firstRun, stepsId,
    now: Date.now(), today: new Date().toISOString().slice(0, 10), boardUrl: BOARD_URL, newId: () => crypto.randomUUID(),
  });
  for (const st of steps) {
    const name = `${st.why}: ${st.link?.task_id ?? st.unlink ?? st.link?.item_id ?? st.patch?.id ?? st.insert?.[0]?.id}`;
    try {
      const saveLink = async () => {
        if (!st.link) return;
        const { error } = await db.from("acro_task_links").upsert({ ...st.link, user_id: userId, updated_at: new Date().toISOString() });
        if (error) throw error;
      };
      if (st.insert) {
        // The link first: if the lines then fail, the next run sees the line gone and tries again (no doubles).
        await saveLink();
        const { error } = await db.from("writing_entries").upsert(st.insert.map((r) => ({ ...r, user_id: userId })));
        if (error) throw error;
      } else {
        // The line first, then the board, then the link: whichever part fails, the next run sees where things
        // stand and finishes the job. A line changed in the app since it was read waits for the next run.
        // A board task deleted first: should the line's part fail, the next run finds it gone and tidies up.
        if (st.boardDelete) {
          try { await callTool(url, "board_delete", { by: "Inkwell", collection: "tasks", ...st.boardDelete }); }
          catch (e) { if (!/^No |not found/i.test((e as Error)?.message || "")) throw e; }
        }
        if (st.patch) {
          const was = byId.get(st.patch.id);
          let q = db.from("writing_entries").update(st.patch.set).eq("id", st.patch.id).eq("user_id", userId);
          if (was?.updated_at) q = q.eq("updated_at", was.updated_at);
          const { data, error } = await q.select("id");
          if (error) throw error;
          if (!data?.length) throw new Error("changed in Inkwell meanwhile");
        }
        if (st.board) await callTool(url, "board_write", { by: "Inkwell", writes: [st.board] });
        await saveLink();
      }
      if (st.unlink) await db.from("acro_task_links").delete().eq("item_id", st.unlink).eq("user_id", userId);
      done.push(name);
    } catch (e) {
      console.log("acro-tasks (inkwell) step failed", name, (e as Error)?.message || e);
      failed.push(name);
    }
  }

  // HQ's meetings, read-only, on the Acro project's Meetings page.
  try {
    const list = await callTool(url, "board_list", { collection: "meetings", where: [{ field: "status", op: "eq", value: "ready" }], limit: 200 });
    const home = MEETINGS_PAGE(world.id);
    const pages = new Map(rows.filter((r) => r.kind === "page" && r.id.startsWith("pg-hq-")).map((r) => [r.id, r as unknown as Page]));
    const byPage = new Map<string, Line[]>();
    for (const l of lines) {
      const m = /^li-(hq-(?:mtg|out)-.+)-\d+$/.exec(l.id);
      if (m) byPage.set(`pg-${m[1]}`, [...(byPage.get(`pg-${m[1]}`) ?? []), l]);
    }
    const docs = (list.docs ?? []) as Meeting[];
    const changed = docs.filter((d) => (pages.get(`pg-hq-mtg-${d.id}`.slice(0, 120))?.fields?.hq?.v) !== Number(d.version));
    // The list cuts long text: fetch each changed meeting whole.
    const full: Meeting[] = [];
    for (const d of changed.slice(0, 10)) full.push(await callTool(url, "board_get", { collection: "meetings", id: d.id }) as unknown as Meeting);
    const plan = planMeetings(full, { meetingsPage: (pages.get(home) ?? null) as Page | null, pages, lines: byPage }, world.id, BOARD_URL);
    const write = [...plan.pages.map((p) => ({ ...p, text: "", tags: [], user_id: userId })), ...plan.lines.map((l) => ({ ...l, user_id: userId }))];
    for (let i = 0; i < write.length; i += 500) { const { error } = await db.from("writing_entries").upsert(write.slice(i, i + 500)); if (error) throw error; }
    if (plan.gone.length) await db.from("writing_entries").update({ deleted: true }).eq("user_id", userId).in("id", plan.gone);
    if (plan.pages.length) done.push(`meetings: ${plan.pages.filter((p) => p.id.startsWith("pg-hq-mtg-")).length} written`);
  } catch (e) {
    console.log("acro meetings mirror failed", (e as Error)?.message || e);
    failed.push("meetings");
  }
  return { firstRun, target: "inkwell" };
}

export async function run() {
  const url = Deno.env.get("ACRO_CONNECTOR_URL");
  if (!url || !/^https:\/\//.test(url)) return { skipped: "no connector address" };
  const db = admin();
  const { data: areas, error: aErr } = await db.from("items").select("id,user_id").eq("kind", "area").eq("title", "Business").eq("deleted", false);
  if (aErr) throw aErr;
  const want = Deno.env.get("ACRO_DAYBOOK_USER");
  const area = (areas ?? []).find((a) => !want || a.user_id === want);
  if (!area || (!want && (areas ?? []).length > 1)) return { skipped: "no single Business area" };
  const userId = area.user_id as string;

  // One run at a time: take the lock for 90 seconds.
  const nowIso = new Date().toISOString();
  const { data: state } = await db.from("acro_task_sync").select("*").eq("user_id", userId).maybeSingle();
  const firstRun = !state;
  if (!state) {
    const { error } = await db.from("acro_task_sync").insert({ user_id: userId, locked_until: new Date(Date.now() + 90e3).toISOString() });
    if (error) return { skipped: "another run started" };
  } else {
    const { data: got } = await db.from("acro_task_sync").update({ locked_until: new Date(Date.now() + 90e3).toISOString() })
      .eq("user_id", userId).lt("locked_until", nowIso).select("user_id");
    if (!got?.length) return { skipped: "another run is going" };
  }

  const done: string[] = [], failed: string[] = [];
  try {
    // Once Daybook has been brought into Inkwell (and not taken back), the board syncs with Inkwell, for good.
    const { data: imported } = state?.target === "inkwell" ? { data: [1] } : await db.from("writing_entries").select("id").eq("user_id", userId).like("id", "li-db-%").eq("deleted", false).limit(1);
    if (imported?.length) return { ...(await runInkwell(db, url, userId, state?.target !== "inkwell", state?.world_id ?? null, done, failed)), done, failed };
    const [tasks, itemsRes, linksRes] = await Promise.all([
      boardTasks(url),
      db.from("items").select(COLS).eq("user_id", userId).limit(10000),
      db.from("acro_task_links").select("item_id,task_id,seen").eq("user_id", userId).limit(10000),
    ]);
    if (itemsRes.error) throw itemsRes.error;
    if (linksRes.error) throw linksRes.error;
    const steps = plan({
      tasks, items: (itemsRes.data ?? []) as Item[], links: (linksRes.data ?? []) as Link[],
      businessId: area.id as string, userId, firstRun, now: Date.now(), boardUrl: BOARD_URL, newId: () => crypto.randomUUID(),
    });
    for (const st of steps) {
      const name = `${st.why}: ${st.link?.task_id ?? st.unlink ?? st.link?.item_id}`;
      try {
        if (st.board) await callTool(url, "board_write", { by: BY, writes: [st.board] });
        if (st.insertItem) { const { error } = await db.from("items").insert(st.insertItem); if (error) throw error; }
        if (st.item) { const { error } = await db.from("items").update(st.item.patch).eq("id", st.item.id).eq("user_id", userId); if (error) throw error; }
        if (st.link) {
          const { error } = await db.from("acro_task_links").upsert({ ...st.link, user_id: userId, updated_at: new Date().toISOString() });
          if (error) throw error;
        }
        if (st.unlink) await db.from("acro_task_links").delete().eq("item_id", st.unlink).eq("user_id", userId);
        done.push(name);
      } catch (e) {
        // A refused board write (someone changed the task this moment) is simply tried again next run.
        console.log("acro-tasks step failed", name, (e as Error)?.message || e);
        failed.push(name);
      }
    }
  } finally {
    await db.from("acro_task_sync").update({ locked_until: new Date(0).toISOString(), last_run: new Date().toISOString(), last_result: { done: done.length, failed } }).eq("user_id", userId);
  }
  return { firstRun, done, failed };
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Not found" }, 404);
  try {
    const r = await run();
    return json({ ok: true, done: (r as any).done?.length ?? 0, failed: (r as any).failed?.length ?? 0, skipped: (r as any).skipped });
  } catch (e) {
    console.error("acro-tasks failed", e);
    return json({ ok: false }, 500);
  }
});
