// Checks the ESV chapter helpers: node --experimental-strip-types supabase/functions/inkwell/esvref.test.ts
import assert from "node:assert/strict";
import { cleanRef, esvUrl, splitNotice } from "./esvref.ts";

assert.equal(cleanRef("2 Kings 4"), "2 Kings 4");
assert.equal(cleanRef("  Psalm   23 "), "Psalm 23");
assert.equal(cleanRef("Song of Solomon 3"), "Song of Solomon 3");
assert.equal(cleanRef("Genesis 1-3"), null);
assert.equal(cleanRef("John 3:16"), null);
assert.equal(cleanRef("Psalm 151"), null);
assert.equal(cleanRef("<script> 1"), null);
assert.equal(cleanRef(""), null);
assert.equal(cleanRef(null), null);

const u = new URL(esvUrl("2 Kings 4"));
assert.equal(u.host, "api.esv.org");
assert.equal(u.searchParams.get("q"), "2 Kings 4");
assert.equal(u.searchParams.get("include-copyright"), "true");
assert.equal(u.searchParams.get("include-footnotes"), "false");

const got = splitNotice({ passages: ["The Word\n\n[1] In the beginning.\n\nScripture quotations are from the ESV® Bible, copyright © 2001 by Crossway.\n"] });
assert.equal(got?.text, "The Word\n\n[1] In the beginning.");
assert.match(got?.notice || "", /^Scripture quotations/);
assert.deepEqual(splitNotice({ passages: ["[1] Just words."] }), { text: "[1] Just words.", notice: "" });
assert.equal(splitNotice({ passages: [] }), null);
assert.equal(splitNotice(null), null);
console.log("esvref: all passed");
