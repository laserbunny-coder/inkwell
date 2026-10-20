// Sibling ordering: moving one item only renumbers that item.
import assert from 'node:assert/strict';
import { placeSorts, GAP } from '../src/order.js';

const same = (a, b) => a.filter((v, i) => v === b[i]).length;

// New list: evenly spaced.
assert.deepEqual(placeSorts([undefined, undefined, undefined]), [GAP, 2 * GAP, 3 * GAP]);
// Nothing moved: nothing changes.
assert.deepEqual(placeSorts([1024, 2048, 3072]), [1024, 2048, 3072]);
// Last moved to first: only it changes, and goes before the rest.
let out = placeSorts([3072, 1024, 2048]);
assert.equal(same(out, [3072, 1024, 2048]), 2);
assert.ok(out[0] < out[1] && out[1] < out[2]);
// Insert in the middle: only the new one gets a number.
out = placeSorts([1024, undefined, 2048]);
assert.deepEqual([out[0], out[2]], [1024, 2048]);
assert.ok(out[1] > 1024 && out[1] < 2048);
// Old tightly numbered lists (1, 2, 3) fall back to one renumbering when there's no room.
out = placeSorts([1, undefined, 2, 3]);
assert.ok(out.every((v, i) => i === 0 || v > out[i - 1]));
// Appending to an old list keeps the old numbers.
assert.deepEqual(placeSorts([1, 2, 3, undefined]), [1, 2, 3, 3 + GAP]);
// Many inserts at the same spot stay in order.
let list = [GAP, 2 * GAP];
for (let i = 0; i < 40; i++) {
  const old = [list[0], undefined, ...list.slice(1)];
  list = placeSorts(old);
  assert.ok(list.every((v, j) => j === 0 || v > list[j - 1]), `order kept after ${i + 1} inserts`);
  assert.ok(list.every(Number.isInteger));
}
console.log('ok   ordering only renumbers what moved');
