// Order among siblings. Sort numbers are spaced apart, so moving or inserting
// one item gives it a number between its new neighbours and leaves everyone
// else alone. Fewer rewritten entries means less to sync and fewer chances
// for two devices to clash. Only when there's no room left does a list get
// renumbered, once.

export const GAP = 1024;

// `old` is each item's current sort number in its new position (undefined for
// new items or ones that just arrived here). Returns the sort number each item
// should have, keeping as many of the old ones as possible.
export function placeSorts(old) {
  const n = old.length;
  const keep = new Array(n).fill(false);
  // The longest run of old numbers that are still in increasing order stays put.
  const tails = [];
  const prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const v = old[i];
    if (!Number.isFinite(v)) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (old[tails[mid]] < v) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  for (let i = tails.at(-1) ?? -1; i >= 0; i = prev[i]) keep[i] = true;

  const out = old.slice();
  let i = 0;
  while (i < n) {
    if (keep[i]) { i++; continue; }
    let j = i;
    while (j < n && !keep[j]) j++;
    const k = j - i;
    const before = i > 0 ? out[i - 1] : null;
    const after = j < n ? out[j] : null;
    if (before === null && after === null) for (let m = 0; m < k; m++) out[i + m] = GAP * (m + 1);
    else if (after === null) for (let m = 0; m < k; m++) out[i + m] = before + GAP * (m + 1);
    else if (before === null) for (let m = 0; m < k; m++) out[i + m] = after - GAP * (k - m);
    else {
      if (after - before <= k) return old.map((_v, m) => GAP * (m + 1));
      for (let m = 0; m < k; m++) out[i + m] = before + Math.floor(((after - before) * (m + 1)) / (k + 1));
    }
    i = j;
  }
  return out;
}

// Sibling order, with the id as a tie-break so every device agrees even if
// two of them picked the same number while apart.
export const bySort = (a, b) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
