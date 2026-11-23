// Add-ons (Nov 23 2026, for Elle's copy and anyone after her): the personal
// routines, Bible reading and Training, are off for a new person and set up
// by whoever turns them on (Look > Add-ons). Michael's own copy has them on
// without asking, because his data already has them: a reading place or log,
// or the Training page.
//
// Where it lives: settings-plan fields.addons = { bible: bool, training: bool }.
// Only a switch someone flipped is saved; until then it follows the data, so a
// fresh device that hasn't synced yet never writes "off" over his "on".
//
// Off means: no line on Today, no block on the Desk, nothing in Now. The data
// stays, so turning it back on finds everything where it was.

import { getEntry } from './db.js';
import { autoOn } from './auto.js';
import { PLAN_ID, savePlanSettings } from './tasks.js';

export const ADDONS = [
  { id: 'bible', label: 'Bible reading', auto: 'firstlight', about: 'A few chapters each morning, from a plan you pick. It comes first on Today and keeps a streak on the Desk.' },
  { id: 'training', label: 'Training', auto: 'training', about: 'Your own sessions, one exercise at a time in Now, with a streak and charts on the Desk.' }
];

let cache = null;

// What the data says, for a switch nobody has flipped.
async function inferred() {
  const plan = await getEntry(PLAN_ID);
  const r = plan && !plan.deleted ? plan.fields?.reading : null;
  const bible = !!(r && typeof r === 'object' && (r.read || r.made || r.days?.length || r.ot || r.ps || r.wi || r.nt || r.plan));
  const page = await getEntry('pg_training');
  const training = !!(page && !page.deleted);
  return { bible, training, set: (plan && !plan.deleted && plan.fields?.addons) || {} };
}

// → { bible, training }: true when on.
export async function loadAddons() {
  const { bible, training, set } = await inferred();
  const out = {};
  for (const a of ADDONS) {
    const seen = a.id === 'bible' ? bible : training;
    // Automated test runs turn a routine on with autoOn (src/auto.js), as before.
    let asNew = false;
    try { asNew = localStorage.getItem('addonsAsNew') === '1'; } catch {}
    const test = typeof navigator !== 'undefined' && navigator.webdriver && !asNew && autoOn(a.auto);
    out[a.id] = typeof set[a.id] === 'boolean' ? set[a.id] : (seen || !!test);
  }
  cache = out;
  return out;
}

// The last answer, for code that can't wait (null until loaded once).
export const addonOnNow = (id) => !!cache?.[id];

export async function addonOn(id) {
  return !!(await loadAddons())[id];
}

export async function setAddon(id, on) {
  const plan = await getEntry(PLAN_ID);
  const set = { ...((plan && !plan.deleted && plan.fields?.addons) || {}), [id]: !!on };
  const row = await savePlanSettings({ addons: set });
  await loadAddons();
  try { window.dispatchEvent(new CustomEvent('addons-changed', { detail: { id, on: !!on } })); } catch {}
  return row;
}
