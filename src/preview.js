// "Try Studio as a new person" (Nov 23 2026): ?preview=new opens this tab as
// a brand-new Studio copy. The small script at the top of index.html gives the
// tab its own storage (its own local data, kept in this tab only), so it
// never reads or changes your writing, and here nothing syncs or signs in.
// ?preview=new again starts over; ?preview=off leaves.
let on = false;
try { on = sessionStorage.getItem('inkwell-preview') === 'new'; } catch { /* no storage here */ }
export const PREVIEW = on;
