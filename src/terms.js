import { getEntry, byKind, getMeta } from './db.js';

// Names to listen for when a recording is written out: the people, places and
// things in the world you're talking about (its pages and pieces), every
// world's name, and the people from earlier meetings. The speech service is
// told them, so "Gristlemaw" doesn't come back as "gristle more".

const MAX = 100;
// Page names every world has say nothing about what's said.
const PLAIN = /^(idea|ideas|overview|gather|notes|research|bible|characters|places|draft|meeting( \d{4}-\d\d-\d\d)?|(untitled|chapter|act|scene|episode|season)\b.*)$/i;
const usable = (t) => typeof t === 'string' && t.trim().length >= 2 && t.trim().length < 50 && t.trim().split(/\s+/).length <= 5 && !PLAIN.test(t.trim());

// The world an entry sits in, if any.
async function worldOf(id) {
  let r = id ? await getEntry(id) : null;
  for (let i = 0; r && i < 60; i++) {
    if (r.kind === 'world') return r;
    r = r.parent_id ? await getEntry(r.parent_id) : null;
  }
  return null;
}

// `near` is where the words are going (a chapter, a page), or nothing for
// the day page.
export async function speechTerms(near = null) {
  const out = [];
  const add = (t) => { if (usable(t) && !out.includes(t.trim())) out.push(t.trim()); };
  const world = await worldOf(near);
  if (world) {
    add(world.title);
    // Everything under that world, nearest first: its pages and pieces.
    const parentOf = new Map();
    const rows = [...await byKind('page'), ...await byKind('project')];
    for (const r of rows) parentOf.set(r.id, r.parent_id);
    const inWorld = (r) => { let p = r.parent_id; for (let i = 0; p && i < 60; i++) { if (p === world.id) return true; p = parentOf.get(p); } return false; };
    for (const r of rows) if (inWorld(r)) add(r.title);
  }
  for (const p of (await getMeta('meetingPeople')) || []) add(p);
  for (const w of await byKind('world')) add(w.title);
  return out.slice(0, MAX);
}
