// Days as Inkwell keeps them: "YYYY-MM-DD" in this device's own time zone.
// The one copy of these helpers; every module imports them from here.

export const pad = (n) => String(n).padStart(2, '0');
// A Date (or milliseconds) → its day, "2026-11-14".
export const isoOf = (d = new Date()) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
// Today, on this device.
export const isoToday = () => isoOf(new Date());
// "2026-11-14" → a Date at midnight that day, local time.
export const dateOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
// A day n days after (or before, n < 0) this one.
export const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); };
