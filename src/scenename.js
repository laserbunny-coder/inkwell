// Small, plain helpers for the shots beside the script (scriptshots.js),
// kept apart so Make and the tests can use them without the editor.

export const clip = (s, n = 40) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// What kind of screen this is, for where the shots sit. A phone held
// sideways is short and touch; a narrow window is a phone held upright.
export function screenKind(w = window.innerWidth, h = window.innerHeight, coarse = matchMedia('(pointer: coarse)').matches) {
  if (coarse && w > h && h <= 520) return 'sideways';
  if (w <= 700) return 'phone';
  return 'computer';
}

// What a scene is called wherever it is named: its own title; with none, its
// first words (as the Outline does); never its slug line. The slug (place
// and time) is separate, for a faint aside the writer chooses to see.
export function sceneTitle(a) {
  const t = (a?.title || '').trim();
  if (t) return t;
  const words = (a?.first || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const w = words.slice(0, 6).join(' ').replace(/[,.;:!?]+$/, '');
  return clip(words.length > 6 ? `${w}…` : w, 40);
}
export const sceneName = (a) => { const t = sceneTitle(a); return t ? `Scene ${a.n} · ${t}` : `Scene ${a?.n || ''}`.trim(); };

