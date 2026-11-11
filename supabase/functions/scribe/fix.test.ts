// Checks the fix-by-voice helpers: node --experimental-strip-types supabase/functions/scribe/fix.test.ts
import assert from "node:assert/strict";
import { cleanLearn, cleanSpelling, finishFix, fixContent, fixModel, listenFor } from "./fix.ts";

// Only real corrections are remembered: in the new text, not in the old.
assert.deepEqual(cleanLearn(["Nate"], "Hey Nait, see you Thursday", "Hey Nate, see you Thursday"), ["Nate"]);
assert.deepEqual(cleanLearn(["Thursday"], "Hey Nait, see you Thursday", "Hey Nate, see you Thursday"), []);
assert.deepEqual(cleanLearn(["Kenji"], "Hey Nait", "Hey Nate"), [], "not in the new text");
assert.deepEqual(cleanLearn(["Nate", "nate", "Ninja Bunch"], "Nait and the ninja bunch", "Nate and the Ninja Bunch"), ["Nate", "Ninja Bunch"]);
assert.deepEqual(cleanLearn(["a"], "x", "a"), [], "too short");
assert.deepEqual(cleanLearn(["one two three four five six"], "", "one two three four five six"), [], "too many words");
assert.deepEqual(cleanLearn("Nate", "", "Nate"), [], "not a list");
assert.deepEqual(cleanLearn(["A1", "B2", "C3", "D4"], "", "A1 B2 C3 D4"), ["A1", "B2", "C3"], "three at most");

assert.equal(cleanSpelling("  Nate  "), "Nate");
assert.equal(cleanSpelling("Kenji\nTanaka"), "Kenji Tanaka");
assert.equal(cleanSpelling("[Nate]"), null);
assert.equal(cleanSpelling("Na*"), null, "no wildcards");
assert.equal(cleanSpelling(42), null);

// Spellings come first and repeats (any case) are dropped.
assert.deepEqual(listenFor(["Nate", "Kenji"], ["The Ninja Bunch", "kenji", "Nate"]), ["Nate", "Kenji", "The Ninja Bunch"]);
assert.equal(listenFor(Array.from({ length: 150 }, (_, i) => `Name ${i}`), []).length, 100);

// A short fix in an Opus mode goes to Sonnet; everything else keeps the mode's model.
assert.equal(fixModel("opus", 120), "sonnet");
assert.equal(fixModel("opus", 2000), "opus");
assert.equal(fixModel("haiku", 120), "haiku");
assert.equal(fixModel("sonnet", 3000), "sonnet");

// The request names where the text came from and leaves out empty parts.
const c = fixContent({ text: "Hey Nait", before: "", after: " See you.", how: "last", said: "Nate, N A T E", modeName: "Text", modePrompt: "", app: "com.whatsapp" });
assert.match(c, /Scribe just typed this text in:\n<text>\nHey Nait\n<\/text>/);
assert.doesNotMatch(c, /<before>/);
assert.match(c, /<after>\n See you.\n<\/after>/);
assert.doesNotMatch(c, /mode "Text"/);
assert.match(c, /<said>\nNate, N A T E\n<\/said>/);
assert.match(fixContent({ text: "x", before: "", after: "", how: "selection", said: "y", modeName: "Email", modePrompt: "Formal.", app: "" }), /They selected this text[\s\S]*mode "Email"\): Formal\./);

// The answer keeps the picked text's own edges, and "no change" keeps it whole.
assert.deepEqual(finishFix("Hey Nait, see you Thursday.", { text: "Hey Nate, see you Thursday.", learn: ["Nate"], unchanged: false }), { text: "Hey Nate, see you Thursday.", learn: ["Nate"], unchanged: false });
assert.deepEqual(finishFix(" line one\n", { text: "Line one.", learn: [], unchanged: false }), { text: " Line one.\n", learn: [], unchanged: false });
assert.deepEqual(finishFix("Thursday", { text: "Tuesday", learn: ["Tuesday"], unchanged: true }), { text: "Thursday", learn: [], unchanged: true });
assert.deepEqual(finishFix("Thursday", { text: "  ", learn: [], unchanged: false }), { text: "Thursday", learn: [], unchanged: true });
assert.deepEqual(finishFix("Thursday", {}), { text: "Thursday", learn: [], unchanged: true });

console.log("fix helpers: all good");
