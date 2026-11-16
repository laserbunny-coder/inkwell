// Checks the reading plan and the training week: node --experimental-strip-types supabase/functions/inkwell-mcp/reading.test.ts
import assert from "node:assert/strict";
import { placeIn, todays, weekFrom, weekWords } from "./reading.ts";

assert.deepEqual(todays({}), ["Genesis 1", "Genesis 2", "Psalm 1", "Proverbs 1", "Matthew 1", "Matthew 2"]);
const k = placeIn("ot", "2 Kings 4") as { place: number };
const nt = placeIn("nt", "Revelation 22") as { place: number };
const wi = placeIn("wi", "ecclesiastes 12") as { place: number };
const ps = placeIn("ps", "Psalms 23") as { place: number };
assert.deepEqual(todays({ ot: k.place, ps: ps.place, wi: wi.place, nt: nt.place }), ["2 Kings 4", "2 Kings 5", "Psalm 23", "Ecclesiastes 12", "Revelation 22", "Matthew 1"]);
assert.deepEqual(placeIn("ot", "Genesis"), { place: 0 });
assert.deepEqual(placeIn("ot", "II Kings 1"), placeIn("ot", "2 Kings 1"));
assert.match((placeIn("ot", "Psalm 3") as { error: string }).error, /own tracks/);
assert.match((placeIn("ot", "Jude 2") as { error: string }).error, /Old Testament takes/);
assert.match((placeIn("nt", "Jude 2") as { error: string }).error, /Jude has 1 chapter\./);
assert.match((placeIn("wi", "Job 1") as { error: string }).error, /Proverbs or Ecclesiastes/);

const names = ["Hard A", "Light", "Hard B"];
assert.deepEqual(weekFrom({ Monday: "hard a", tue: "Light", wednesday: "rest", thursday: "Hard B", sunday: null }, names), { week: { 1: "Hard A", 2: "Light", 4: "Hard B" } });
assert.match((weekFrom({ funday: "Light" }, names) as { error: string }).error, /isn't a weekday/);
assert.match((weekFrom({ monday: "Leg day" }, names) as { error: string }).error, /no session called Leg day/);
assert.match((weekFrom(["x"], names) as { error: string }).error, /must be an object/);
assert.deepEqual(weekWords({ 1: "Hard A" }).tuesday, "rest");
console.log("reading: all passed");
