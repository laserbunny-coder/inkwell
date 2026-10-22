// Writing fonts for the Aa panel. The stacks live in style.css (as
// [data-font=…], which the picker's buttons use too) so the first paint is right; this file loads each font
// only when it is picked or the panel opens.

export const FONTS = [
  { id: 'newsreader', name: 'Newsreader', group: 'serif', about: "Inkwell's default. Made for long reading on screens, warm and calm." },
  { id: 'literata', name: 'Literata', group: 'serif', about: 'The closest free match to a Kindle. Google made it for its e-book app.' },
  { id: 'charis', name: 'Charis', group: 'serif', about: 'A sturdy, classic book face based on Charter. Clear even at small sizes.', family: 'Charis SIL', spec: 'ital,wght@0,400;0,700;1,400;1,700' },
  { id: 'garamond', name: 'EB Garamond', group: 'serif', about: 'Old-style printed book, centuries-old shapes. Elegant and literary.', family: 'EB Garamond', spec: 'ital,wght@0,400;0,500;0,700;1,400' },
  { id: 'georgia', name: 'Georgia', group: 'serif', about: 'The familiar web serif. Built into Windows and Android, so nothing to load.' },
  { id: 'inter', name: 'Inter', group: 'sans', about: "Inkwell's interface font. Neutral and very clean." },
  { id: 'geist', name: 'Geist', group: 'sans', about: 'The modern favorite right now. Crisp, geometric and quiet.', family: 'Geist', spec: 'wght@400;500;700' },
  { id: 'atkinson', name: 'Atkinson Hyperlegible', group: 'sans', about: 'Designed for the easiest possible reading. Every letter is distinct.', family: 'Atkinson Hyperlegible Next', spec: 'ital,wght@0,400;0,500;0,700;1,400' },
  { id: 'plexsans', name: 'IBM Plex Sans', group: 'sans', about: 'A sans with some character. Slightly technical, very even.', family: 'IBM Plex Sans', spec: 'ital,wght@0,400;0,500;0,700;1,400' },
  // The two iA Writer fonts ship with the app (src/fonts), so they work offline from the start.
  { id: 'iamono', name: 'iA Writer Mono', group: 'mono', about: "The iA Writer app's font, loved by writers. Focused, typewriter-like but softer." },
  { id: 'iaquattro', name: 'iA Writer Quattro', group: 'mono', about: "iA Writer's in-between: mostly fixed-width, but wide letters get more room. Easy on long drafts." },
  { id: 'jetbrains', name: 'JetBrains Mono', group: 'mono', about: 'The most popular coding mono. Tall letters, very clear.', family: 'JetBrains Mono', spec: 'ital,wght@0,400;0,500;0,700;1,400' },
  { id: 'geistmono', name: 'Geist Mono', group: 'mono', about: "Geist's mono sibling. Minimal and modern.", family: 'Geist Mono', spec: 'wght@400;500;700' },
  { id: 'courier', name: 'Courier Prime', group: 'mono', about: 'The classic typewriter look, the screenplay standard.' },
];
export const FONT_GROUPS = [['serif', 'Serif'], ['sans', 'Sans'], ['mono', 'Mono']];
export const DEFAULT_FONT = 'newsreader';

const fam = (f) => f.family.replace(/ /g, '+');
// The full font, for writing in. Fonts already loaded by index.html have no family here.
export const fontHref = (f) => f.family && `https://fonts.googleapis.com/css2?family=${fam(f)}:${f.spec}&display=swap`;

function addSheet(href, id) {
  if (!href || document.getElementById(id)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href; l.id = id;
  document.head.appendChild(l);
}

export const fontById = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
export const currentFont = () => fontById(document.documentElement.dataset.font || DEFAULT_FONT);

export function setFont(id) {
  const f = fontById(id);
  document.documentElement.dataset.font = f.id;
  addSheet(fontHref(f), `font-${f.id}`);
  try {
    localStorage.setItem('font', f.id);
    // index.html loads it before first paint next time.
    if (fontHref(f)) localStorage.setItem('fontHref', fontHref(f)); else localStorage.removeItem('fontHref');
  } catch { /* private window */ }
  return f;
}

// Each picker button shows its font in its own face. The stylesheets are tiny and
// the browser only downloads the faces it draws, so this costs one regular face each.
export function loadPreviews() {
  for (const f of FONTS) addSheet(fontHref(f), `font-${f.id}`);
}
