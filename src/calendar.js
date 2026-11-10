// Google Calendar events, read-only, as faint lines in Today's plan. They
// come from the server function "calendar" (it only ever reads); Inkwell
// connects the calendar itself (Ctrl + K, "Google Calendar"). What was last seen is kept on this device, so the plan draws at
// once and still shows them offline.

import { isoOf, addDays, dateOf } from './tasks.js';

const KEY = 'inkwell-calendar';
const FRESH = 5 * 60 * 1000;
const mem = new Map(); // "from|to" → { at, events }
const asking = new Map(); // "from|to" → the question on its way

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
const keep = (key, events) => {
  try {
    const all = read();
    all[key] = { at: Date.now(), events };
    // A handful of ranges is plenty: the newest stay.
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, 8);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keys.map((k) => [k, all[k]]))));
  } catch { /* no room, or private window: it just isn't kept */ }
};

// What the server sends → one entry per day an event is on:
// { id, title, day, start (ms | null), end (ms | null), allDay, calendar, color }
export function shape(list, from, to) {
  const out = [];
  for (const e of list || []) {
    if (!e?.start) continue;
    const base = { id: String(e.id || ''), title: String(e.title || '(No title)'), calendar: e.calendar || '', color: e.color || '' };
    if (e.allDay) {
      // Google's last day is the day after the event ends.
      const first = String(e.start).slice(0, 10);
      const last = e.end ? addDays(String(e.end).slice(0, 10), -1) : first;
      for (let day = first < from ? from : first; day <= (last > to ? to : last); day = addDays(day, 1)) out.push({ ...base, day, start: null, end: null, allDay: true });
    } else {
      const start = Date.parse(e.start);
      const end = Date.parse(e.end || e.start);
      if (!Number.isFinite(start)) continue;
      const day = isoOf(start);
      if (day < from || day > to) continue;
      out.push({ ...base, day, start, end: Number.isFinite(end) && end > start ? end : start, allDay: false });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : (a.allDay ? 0 : 1) - (b.allDay ? 0 : 1) || (a.start || 0) - (b.start || 0) || a.title.localeCompare(b.title)));
}

// fetcher(timeMinIso, timeMaxIso) → the server's { connected, events } (or
// null with no way to ask). → { now: what's kept for that range (or null),
// fresh: a promise of the latest (null when it can't be had) }.
export function events(fetcher, from, to) {
  const key = `${from}|${to}`;
  const held = mem.get(key) || read()[key] || null;
  const now = held ? held.events : null;
  if (held && mem.has(key) && Date.now() - held.at < FRESH) return { now, fresh: Promise.resolve(now) };
  // One question at a time for a range, however often the plan redraws.
  if (asking.has(key)) return { now, fresh: asking.get(key) };
  const fresh = (async () => {
    try {
      const res = await fetcher?.(dateOf(from).toISOString(), dateOf(addDays(to, 1)).toISOString());
      if (!res || res.error) return now;
      // Not connected (any more): nothing to show, and nothing kept.
      const list = res.connected === false ? [] : shape(res.events, from, to);
      mem.set(key, { at: Date.now(), events: list });
      keep(key, list);
      return list;
    } catch (e) { console.warn(e); return now; } finally { asking.delete(key); }
  })();
  asking.set(key, fresh);
  return { now, fresh };
}

// Forget what was asked, so the next look goes to the server (just connected).
export function forgetCalendar() { mem.clear(); }

// "9:30 am", "2 pm".
export function clockWord(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

// Minutes still free today: from now to the end of your day, less the events
// still to come (two at once count once).
export function freeLeft(list, now, endHour = 22) {
  const d = new Date(now);
  const stop = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(endHour), Math.round((endHour % 1) * 60)).getTime();
  if (stop <= now) return 0;
  const spans = (list || []).filter((e) => !e.allDay && e.end > now && e.start < stop).map((e) => [Math.max(e.start, now), Math.min(e.end, stop)]).sort((a, b) => a[0] - b[0]);
  let busy = 0;
  let at = now;
  for (const [s, e] of spans) { if (e <= at) continue; busy += e - Math.max(s, at); at = e; }
  return Math.max(0, Math.round((stop - now - busy) / 6e4));
}
