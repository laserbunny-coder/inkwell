// Fountain in and out, without a browser.
import assert from 'node:assert/strict';
import { fromFountain, toFountain, fromOutline, looksLikeOutline, detect, assignCodes, codeOrder } from '../src/script.js';

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
  const rows = lines.map((l) => (l.el === 'section' ? { kind: 'scene', title: l.text, fields: { synopsis: l.synopsis } } : { kind: 'para', fields: { el: l.el }, content: [{ type: 'text', text: l.text }] }));
  const out = toFountain(title, rows);
  assert.match(out, /^Title: The Harbour\n\n# The light goes out\n= Mara finds the keeper\.\n\nINT\. LIGHTHOUSE - NIGHT\n\nRain/);
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

check('numbers scenes 1, 2, 3 the first time', () => {
  assert.deepEqual(assignCodes([null, null, null]), ['1', '2', '3']);
});

check('a scene added later never renumbers the others: 3A between 3 and 4, A1 before 1, the next number at the end', () => {
  assert.deepEqual(assignCodes(['1', '2', '3', null, '4']), ['1', '2', '3', '3A', '4']);
  assert.deepEqual(assignCodes(['1', '2', '3', '3A', null, '4']), ['1', '2', '3', '3A', '3B', '4']);
  assert.deepEqual(assignCodes([null, '1', '2']), ['A1', '1', '2']);
  assert.deepEqual(assignCodes(['1', '2', null, null]), ['1', '2', '3', '4']);
  assert.deepEqual(assignCodes(['1', '3', null]), ['1', '3', '4']);
});

check('scene numbers carry on across chapters', () => {
  assert.deepEqual(assignCodes([null, null], { before: '7', used: ['1', '2', '3', '4', '5', '6', '7'] }), ['8', '9']);
  assert.deepEqual(assignCodes([null], { before: '7', after: '8', used: ['7', '8'] }), ['7A']);
});

check('a pasted copy of a scene gets its own number, and the first keeps its own', () => {
  assert.deepEqual(assignCodes(['1', '2', '2', '3']), ['1', '2', '2A', '3']);
  assert.deepEqual(assignCodes(['5'], { used: ['5'] }).length, 1);
  assert.notEqual(assignCodes(['5'], { used: ['5'] })[0], '5');
});

check('scene numbers sort the way a script reads them', () => {
  assert.deepEqual(['10', '3A', 'A1', '1', '3', '2', '3B'].sort(codeOrder), ['A1', '1', '2', '3', '3A', '3B', '10']);
});

check('scene numbers go out to Fountain as #3A# and come back in', () => {
  const rows = [{ kind: 'para', fields: { el: 'scene', code: '3A' }, content: [{ type: 'text', text: 'INT. DOJO - NIGHT' }] }];
  const out = toFountain('Pilot', rows);
  assert.match(out, /INT\. DOJO - NIGHT #3A#/);
  const back = fromFountain(out).lines[0];
  assert.equal(back.text, 'INT. DOJO - NIGHT');
  assert.equal(back.code, '3A');
});

check('sections nest (# act, ## sequence, ### scene) and keep their summaries, both ways', () => {
  const src = `Title: Ninja Bunch

# Act One
= The family moves in.

## The new dojo

### Breakfast fight
= Mom wins without looking up.

INT. KITCHEN - MORNING

KENJI
Pass the rice.
`;
  const { lines } = fromFountain(src);
  const secs = lines.filter((l) => l.el === 'section');
  assert.deepEqual(secs.map((l) => [l.text, l.level || 1, l.synopsis || '']), [['Act One', 1, 'The family moves in.'], ['The new dojo', 2, ''], ['Breakfast fight', 3, 'Mom wins without looking up.']]);
  const rows = lines.map((l) => (l.el === 'section' ? { kind: 'scene', title: l.text, fields: { level: l.level, synopsis: l.synopsis } } : { kind: 'para', fields: { el: l.el }, content: [{ type: 'text', text: l.text }] }));
  const out = toFountain('Ninja Bunch', rows);
  assert.match(out, /\n# Act One\n= The family moves in\.\n\n## The new dojo\n\n### Breakfast fight\n= Mom wins without looking up\.\n/);
  assert.deepEqual(fromFountain(out).lines, lines);
});

check('notes in a script ([[…]]) come in beside their line instead of being dropped', () => {
  const { lines } = fromFountain(`INT. DOJO - NIGHT
= Kenji alone.

Kenji sweeps. [[make this funnier]]

[[a note on its own]]

KENJI
Again.
`);
  assert.deepEqual(lines.map((l) => [l.el, l.text, l.notes || []]), [
    ['scene', 'INT. DOJO - NIGHT', ['Kenji alone.']],
    ['action', 'Kenji sweeps.', ['make this funnier', 'a note on its own']],
    ['character', 'KENJI', []],
    ['dialogue', 'Again.', []]
  ]);
});

check('Fountain pasted out of Workflowy or Tana as bullets reads as a script', () => {
  const pasted = `- Title: Ninja Bunch
- # Act One
  - ## The new dojo
    - INT. KITCHEN - MORNING
    - The family eats in silence.
    - MOM
    - (not looking up)
    - Elbows.
    - KENJI
      - Pass the rice.
    - CUT TO:`;
  assert.ok(looksLikeOutline(pasted));
  assert.ok(!looksLikeOutline(sample));
  const { title, lines } = fromOutline(pasted);
  assert.equal(title, 'Ninja Bunch');
  assert.deepEqual(lines.map((l) => [l.el, l.text, l.level || 1]), [
    ['section', 'Act One', 1], ['section', 'The new dojo', 2], ['scene', 'INT. KITCHEN - MORNING', 1],
    ['action', 'The family eats in silence.', 1], ['character', 'MOM', 1], ['paren', '(not looking up)', 1], ['dialogue', 'Elbows.', 1],
    ['character', 'KENJI', 1], ['dialogue', 'Pass the rice.', 1], ['transition', 'CUT TO:', 1]
  ]);
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
