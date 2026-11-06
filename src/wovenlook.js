// A Woven script's look: the faint line, the names, the dialogue and the
// scene titles, set per script so each one can feel like its genre (red
// brush-stroke titles for a kung fu comedy, a typewriter for noir). It only
// changes how the page looks, never the words, and Classic, the PDF and
// Fountain stay standard. The writing font itself is the Aa panel's, per
// device, like everywhere else in Inkwell.

export const TITLE_FONTS = [
  { id: 'same', name: 'The writing font', about: 'Titles in the same font as the words' },
  { id: 'ui', name: 'Inter', about: 'Quiet, small interface letters', stack: 'var(--ui)' },
  { id: 'shojumaru', name: 'Shojumaru', about: 'Kung fu movie poster', family: 'Shojumaru' },
  { id: 'yuji', name: 'Yuji Syuku', about: 'Japanese brush lettering', family: 'Yuji Syuku' },
  { id: 'zhimang', name: 'Zhi Mang Xing', about: 'Wild brush script', family: 'Zhi Mang Xing' },
  { id: 'marker', name: 'Permanent Marker', about: 'Felt pen on a storyboard', family: 'Permanent Marker' },
  { id: 'elite', name: 'Special Elite', about: 'Worn typewriter, noir', family: 'Special Elite' },
  { id: 'bebas', name: 'Bebas Neue', about: 'Tall movie-poster capitals', family: 'Bebas Neue' },
  { id: 'cinzel', name: 'Cinzel', about: 'Carved in stone, epic', family: 'Cinzel', spec: 'wght@600' },
  { id: 'creepster', name: 'Creepster', about: 'Horror, dripping', family: 'Creepster' },
  { id: 'bungee', name: 'Bungee', about: 'Loud comic-book signs', family: 'Bungee' },
  { id: 'playfair', name: 'Playfair Display', about: 'Elegant drama', family: 'Playfair Display', spec: 'ital,wght@0,600;1,600' },
  { id: 'caveat', name: 'Caveat', about: 'Handwritten notes', family: 'Caveat', spec: 'wght@600' },
  { id: 'pixel', name: 'Press Start 2P', about: 'Retro video game', family: 'Press Start 2P' }
];
const fontById = (id) => TITLE_FONTS.find((f) => f.id === id) || TITLE_FONTS[0];
const fontHref = (f) => f.family && `https://fonts.googleapis.com/css2?family=${f.family.replace(/ /g, '+')}${f.spec ? `:${f.spec}` : ''}&display=swap`;
export function loadTitleFont(id) {
  const f = fontById(id);
  const href = fontHref(f);
  if (!href || document.getElementById(`tfont-${f.id}`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href; l.id = `tfont-${f.id}`;
  document.head.append(l);
}
export const loadAllTitleFonts = () => TITLE_FONTS.forEach((f) => loadTitleFont(f.id));

// Michael's own pick from the prototype: hairline, faint, ink, full width,
// blue names, centred dialogue, centred titles.
export const DEFAULT_LOOK = {
  lineW: 'hair', lineFade: 'faint', lineColor: 'ink', lineLen: 'full',
  names: 'blue', dialogue: 'center', titlePos: 'center',
  titleFont: 'same', titleColor: 'muted', titleCaps: false, titleSize: 'small'
};

export const PRESETS = [
  { id: 'plain', name: 'Plain', look: {} },
  { id: 'kungfu', name: 'Kung fu', look: { lineColor: '#d8432f', lineFade: 'soft', names: '#d8432f', titleFont: 'shojumaru', titleColor: '#d8432f', titleCaps: true, titleSize: 'big' } },
  { id: 'brush', name: 'Brush', look: { titleFont: 'yuji', titleColor: '#d8432f', titleSize: 'big', lineFade: 'soft' } },
  { id: 'noir', name: 'Noir', look: { lineFade: 'soft', names: 'ink', titleFont: 'elite', titleColor: 'ink', titleCaps: true } },
  { id: 'horror', name: 'Horror', look: { lineColor: '#b83a3a', names: '#b83a3a', titleFont: 'creepster', titleColor: '#b83a3a', titleSize: 'big' } },
  { id: 'epic', name: 'Epic', look: { lineColor: '#b8963e', lineFade: 'soft', names: 'ink', titleFont: 'cinzel', titleColor: '#b8963e', titleCaps: true } },
  { id: 'comic', name: 'Comic', look: { lineW: 'thin', lineFade: 'soft', lineColor: '#3f7fd6', names: '#3f7fd6', titleFont: 'bungee', titleColor: '#3f7fd6' } },
  { id: 'notebook', name: 'Notebook', look: { titleFont: 'caveat', titleColor: 'accent', titleSize: 'big', names: 'copper' } }
];

export const OPTIONS = [
  { key: 'lineW', label: 'Line', items: [['hair', 'Hair'], ['thin', 'Thin'], ['bold', 'Bold']] },
  { key: 'lineFade', label: 'Fade', items: [['faint', 'Faint'], ['soft', 'Soft'], ['clear', 'Clear']] },
  { key: 'lineColor', label: 'Line colour', items: [['ink', 'Ink'], ['accent', 'Copper'], ['title', 'Like the titles']] },
  { key: 'lineLen', label: 'Length', items: [['full', 'Full'], ['short', 'Short']] },
  { key: 'names', label: 'Names', items: [['blue', 'Blue'], ['copper', 'Copper'], ['ink', 'Ink']] },
  { key: 'dialogue', label: 'Dialogue', items: [['center', 'Centred'], ['left', 'Indented']] },
  { key: 'titlePos', label: 'Titles', items: [['center', 'Centre'], ['left', 'Left']] },
  { key: 'titleColor', label: 'Title colour', items: [['muted', 'Grey'], ['accent', 'Copper'], ['ink', 'Ink'], ['#d8432f', 'Red'], ['#b8963e', 'Gold'], ['#3f7fd6', 'Blue']] },
  { key: 'titleSize', label: 'Title size', items: [['small', 'Small'], ['big', 'Big']] },
  { key: 'titleCaps', label: 'Capitals', items: [[false, 'Off'], [true, 'On']] }
];

const HEX = /^#[0-9a-f]{6}$/i;
// Only known values get through (a look can come from Claude or from sync).
export function cleanLook(look) {
  const out = { ...DEFAULT_LOOK };
  if (!look || typeof look !== 'object') return out;
  for (const o of OPTIONS) {
    const v = look[o.key];
    if (o.items.some(([id]) => id === v) || ((o.key === 'titleColor' || o.key === 'lineColor' || o.key === 'names') && HEX.test(v || ''))) out[o.key] = v;
  }
  if (TITLE_FONTS.some((f) => f.id === look.titleFont)) out.titleFont = look.titleFont;
  if (typeof look.preset === 'string') out.preset = look.preset;
  if (typeof look.name === 'string') out.name = look.name.slice(0, 40);
  return out;
}
export const presetLook = (id) => cleanLook({ ...(PRESETS.find((p) => p.id === id)?.look || {}), preset: id });

const colour = (v, fallback) => (HEX.test(v || '') ? v : { ink: 'var(--ink)', accent: 'var(--accent)', copper: 'var(--accent)', muted: 'var(--muted)', blue: 'var(--wv-blue)' }[v] || fallback);

export function applyLook(root, look) {
  const props = ['--wv-line-w', '--wv-line-o', '--wv-line-c', '--wv-line-len', '--wv-name-c', '--wv-title-font', '--wv-title-c', '--wv-title-size', '--wv-title-case', '--wv-title-track'];
  if (!look) { props.forEach((p) => root.style.removeProperty(p)); root.classList.remove('wv-dl-left', 'wv-tleft'); return; }
  const l = cleanLook(look);
  const titleC = colour(l.titleColor, 'var(--muted)');
  const f = fontById(l.titleFont);
  if (f.family) loadTitleFont(f.id);
  const set = (k, v) => root.style.setProperty(k, v);
  set('--wv-line-w', { hair: '1px', thin: '1.5px', bold: '2.5px' }[l.lineW]);
  set('--wv-line-o', { faint: '.18', soft: '.38', clear: '.75' }[l.lineFade]);
  set('--wv-line-c', l.lineColor === 'title' ? titleC : colour(l.lineColor, 'var(--ink)'));
  set('--wv-line-len', l.lineLen === 'short' ? '38%' : '100%');
  set('--wv-name-c', colour(l.names, 'var(--wv-blue)'));
  set('--wv-title-font', f.stack || (f.family ? `'${f.family}', var(--prose)` : 'var(--prose)'));
  set('--wv-title-c', titleC);
  set('--wv-title-size', l.titleSize === 'big' ? '1.05em' : '.8em');
  set('--wv-title-case', l.titleCaps ? 'uppercase' : 'none');
  set('--wv-title-track', l.titleCaps ? '.08em' : '.01em');
  root.classList.toggle('wv-dl-left', l.dialogue === 'left');
  root.classList.toggle('wv-tleft', l.titlePos === 'left');
}

const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// The "Look" part of the Aa panel for a Woven script.
// hooks: { look(), save(look), ask(text) → Promise<look|null>, canAsk() }
export function renderLook(box, hooks) {
  const look = cleanLook(hooks.look());
  box.replaceChildren();
  const presets = make('div', 'wv-presets');
  presets.setAttribute('role', 'radiogroup');
  presets.setAttribute('aria-label', 'Look');
  for (const p of PRESETS) {
    const b = make('button', 'wv-preset', p.name);
    b.type = 'button';
    const pl = presetLook(p.id);
    const f = fontById(pl.titleFont);
    if (f.family) { loadTitleFont(f.id); b.style.fontFamily = `'${f.family}', var(--ui)`; }
    b.style.color = colour(pl.titleColor, '');
    const cur = (look.preset || 'plain') === p.id;
    b.classList.toggle('current', cur);
    b.setAttribute('aria-checked', String(cur));
    b.addEventListener('click', () => { hooks.save(presetLook(p.id)); renderLook(box, hooks); });
    presets.append(b);
  }
  if (look.preset === 'own' || look.preset === 'claude') {
    const b = make('button', 'wv-preset current', look.name || (look.preset === 'claude' ? 'Claude’s' : 'Your own'));
    b.type = 'button';
    b.setAttribute('aria-checked', 'true');
    presets.append(b);
  }
  box.append(presets);

  const more = make('details', 'wv-tune');
  const sum = make('summary', '', 'Fine-tune this look');
  more.append(sum);
  const set = (k, v) => { hooks.save({ ...cleanLook(hooks.look()), [k]: v, preset: 'own', name: 'Your own' }); renderLook(box, hooks); box.querySelector('.wv-tune').open = true; };
  for (const o of OPTIONS) {
    const row = make('div', 'wv-tune-row');
    row.append(make('span', 'wv-tune-label', o.label));
    const chips = make('div', 'wv-chips');
    for (const [id, label] of o.items) {
      const b = make('button', 'wv-chip', label);
      b.type = 'button';
      const cur = look[o.key] === id;
      b.classList.toggle('current', cur);
      b.setAttribute('aria-pressed', String(cur));
      b.addEventListener('click', () => set(o.key, id));
      chips.append(b);
    }
    row.append(chips);
    more.append(row);
  }
  const frow = make('div', 'wv-tune-row wv-fonts');
  frow.append(make('span', 'wv-tune-label', 'Title font'));
  const fl = make('div', 'wv-chips');
  for (const f of TITLE_FONTS) {
    const b = make('button', 'wv-chip wv-font', f.name);
    b.type = 'button';
    b.title = f.about;
    if (f.family) b.style.fontFamily = `'${f.family}', var(--ui)`;
    else if (f.id === 'same') b.style.fontFamily = 'var(--prose)';
    const cur = look.titleFont === f.id;
    b.classList.toggle('current', cur);
    b.setAttribute('aria-pressed', String(cur));
    b.addEventListener('click', () => set('titleFont', f.id));
    fl.append(b);
  }
  frow.append(fl);
  more.append(frow);
  more.addEventListener('toggle', () => { if (more.open) loadAllTitleFonts(); });
  box.append(more);

  const ask = make('form', 'wv-ask');
  const input = make('input');
  input.placeholder = 'Or describe it: “an old Shaw Brothers kung fu film”';
  input.setAttribute('aria-label', 'Describe a look for Claude');
  const go = make('button', 'ghost-btn', 'Ask Claude');
  go.type = 'submit';
  ask.append(input, go);
  ask.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (!hooks.canAsk()) { hooks.toast?.('Claude needs you signed in and online to make a look.'); return; }
    go.disabled = true; go.textContent = 'Thinking…';
    try {
      const got = await hooks.ask(text);
      if (got) { hooks.save({ ...cleanLook(got), preset: 'claude', name: (got.name || 'Claude’s').slice(0, 40) }); renderLook(box, hooks); }
    } catch (err) { hooks.toast?.(err.message || 'Claude couldn’t make a look just now.'); }
    go.disabled = false; go.textContent = 'Ask Claude';
  });
  box.append(ask);
}
