// Reads the signed-in person's Google Calendar events for a date range.
// Read-only: this function never writes to Google Calendar.
import { admin, cors, json, userFrom } from "../_shared/common.ts";

type GEvent = {
  id: string;
  status?: string;
  summary?: string;
  colorId?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

async function accessToken(refresh: string): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  return (await res.json()).access_token ?? null;
}

async function google(path: string, token: string) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${await res.text()}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const user = await userFrom(req);
  if (!user) return json({ error: "Not signed in" }, 401);

  const { timeMin, timeMax } = await req.json();
  if (!timeMin || !timeMax) return json({ error: "timeMin and timeMax are required" }, 400);

  const { data: row } = await admin()
    .from("google_tokens").select("refresh_token").eq("user_id", user.id).maybeSingle();
  if (!row) return json({ connected: false, events: [] });

  const token = await accessToken(row.refresh_token);
  if (!token) return json({ connected: false, reconnect: true, events: [] });

  try {
    const [list, palette] = await Promise.all([
      google("/users/me/calendarList?minAccessRole=reader", token),
      google("/colors", token).catch(() => ({})), // Google's event colour palette, for events given their own colour
    ]);
    const eventColors: Record<string, { background?: string }> = palette.event ?? {};
    const cals = (list.items ?? []).filter((c: { selected?: boolean; primary?: boolean }) => c.selected || c.primary);
    const q = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "500" });
    const perCal = await Promise.all(cals.map(async (c: { id: string; backgroundColor?: string; summary?: string }) => {
      const data = await google(`/calendars/${encodeURIComponent(c.id)}/events?${q}`, token);
      return (data.items ?? [] as GEvent[])
        .filter((e: GEvent) => e.status !== "cancelled")
        .filter((e: GEvent) => !(e.attendees ?? []).some((a) => a.self && a.responseStatus === "declined"))
        .map((e: GEvent) => ({
          id: `${c.id}:${e.id}`,
          title: e.summary || "(No title)",
          start: e.start?.dateTime ?? e.start?.date,
          end: e.end?.dateTime ?? e.end?.date,
          allDay: !e.start?.dateTime,
          calendar: c.summary,
          color: (e.colorId && eventColors[e.colorId]?.background) || c.backgroundColor,
        }));
    }));
    return json({ connected: true, events: perCal.flat() });
  } catch (err) {
    console.error(err);
    return json({ connected: true, error: "Couldn't read Google Calendar", events: [] }, 502);
  }
});
