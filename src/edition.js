// Studio (Nov 23 2026, Elle's copy): the writing-to-production side of
// Inkwell, opening on the Desk. Built with VITE_EDITION=studio, or a device
// with localStorage 'edition' = 'studio' (tests). Michael's build is the full
// edition and never changes.
//
// In Studio the day tools (Today, Now, Week, Month, the Year) are off until
// she turns them on in Look > Add-ons. The setting syncs:
// settings-plan fields.dayTools. Off: <html class="no-day">, the ruler keeps
// Project, Desk and Library, the day's commands leave Go, and a place in the
// plan opens the Desk instead.

import { getEntry } from './db.js';
import { PLAN_ID, savePlanSettings } from './tasks.js';

let local = '';
try { local = localStorage.getItem('edition') || ''; } catch { /* no storage here */ }
export const STUDIO = import.meta.env?.VITE_EDITION === 'studio' || local === 'studio';

// Outside a browser (the Node checks load the Library's code) there is no page.
const root = typeof document !== 'undefined' ? document.documentElement : { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } };
if (STUDIO) { root.classList.add('studio'); root.classList.add('no-day'); }

export const dayOff = () => root.classList.contains('no-day');

export async function loadDayTools() {
  if (!STUDIO) { root.classList.remove('no-day'); return true; }
  const plan = await getEntry(PLAN_ID);
  const on = !!(plan && !plan.deleted && plan.fields?.dayTools);
  root.classList.toggle('no-day', !on);
  return on;
}

export async function setDayTools(on) {
  const row = await savePlanSettings({ dayTools: !!on });
  await loadDayTools();
  try { window.dispatchEvent(new CustomEvent('daytools-changed', { detail: { on: !!on } })); } catch { /* old browser */ }
  return row;
}
