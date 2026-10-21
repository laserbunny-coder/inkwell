// Fountain in and out, without a browser.
import assert from 'node:assert/strict';
import { fromFountain, toFountain, detect } from '../src/script.js';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); } };

const sample = `Title: The Harbour
Author: M

# The light goes out
= Mara finds the keeper.

INT. LIGHTHOUSE - NIGHT

Rain against the glass. MARA climbs the stairs.

MARA
(out of breath)
Is anyone up here?

KEEPER (O.S.)
Only the light.

CUT TO:

.UNDERWATER

!SILENCE.
`;

check('reads a Fountain script into elements', () => {
  const { title, lines } = fromFountain(sample);
  assert.equal(title, 'The Harbour');
  assert.deepEqual(lines.map((l) => l.el), ['section', 'scene', 'action', 'character', 'paren', 'dialogue', 'character', 'dialogue', 'transition', 'scene', 'action']);
  assert.equal(lines[6].text, 'KEEPER (O.S.)');
  assert.equal(lines[9].text, 'UNDERWATER');
  assert.equal(lines[10].text, 'SILENCE.');
});

check('writes elements back out as Fountain that reads the same', () => {
  const { title, lines } = fromFountain(sample);
  const rows = lines.map((l) => (l.el === 'section' ? { kind: 'scene', title: l.text } : { kind: 'para', fields: { el: l.el }, content: [{ type: 'text', text: l.text }] }));
  const out = toFountain(title, rows);
  assert.match(out, /^Title: The Harbour\n\n# The light goes out\n\nINT\. LIGHTHOUSE - NIGHT\n\nRain/);
  assert.match(out, /\nMARA\n\(out of breath\)\nIs anyone up here\?\n/);
  assert.match(out, /\n\.UNDERWATER\n/);
  assert.deepEqual(fromFountain(out).lines, lines);
});

check('spots scene headings, transitions and character names as you type', () => {
  assert.equal(detect('int. kitchen - day'), 'scene');
  assert.equal(detect('SMASH CUT TO:'), 'transition');
  assert.equal(detect('MARA'), 'character');
  assert.equal(detect('She waits.'), null);
  assert.equal(detect('BANG!'), null);
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
