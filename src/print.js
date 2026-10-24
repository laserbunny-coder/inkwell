// Print, or save as PDF from the print window: a piece laid out the way an
// agent, a producer or a reader expects it. A novel in standard manuscript
// format (a title page, double spaced, each chapter on a new page, # for a
// scene break); a script in screenplay format (Courier, the usual indents,
// numbered pages). Notes, grid data, section headings and summaries never
// print: only the words do.

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// A block's words with its bold and italic.
function fill(e, runs, upper = false) {
  for (const [t, f] of runs) {
    const parts = t.split('\n');
    parts.forEach((part, i) => {
      if (i) e.append(document.createElement('br'));
      if (!part) return;
      const s = upper ? part.toUpperCase() : part;
      if (!f) { e.append(document.createTextNode(s)); return; }
      let node = document.createTextNode(s);
      if (f.includes('i')) { const x = document.createElement('em'); x.append(node); node = x; }
      if (f.includes('b')) { const x = document.createElement('strong'); x.append(node); node = x; }
      e.append(node);
    });
  }
  return e;
}

const roundWords = (n) => (n < 1000 ? Math.max(100, Math.round(n / 100) * 100) : Math.round(n / 1000) * 1000);

export function printable({ title, type, chapters, author = '', words = 0 }) {
  const script = type === 'screenplay';
  const doc = el('div', `print-doc ${script ? 'pr-script' : 'pr-novel'}`);
  doc.dataset.title = (title || 'Untitled').toUpperCase();
  doc.dataset.author = author.split(/\s+/).at(-1) || '';
  // Title page.
  const tp = el('section', 'pr-title-page');
  if (script) {
    tp.append(el('div', 'pr-big', (title || 'Untitled').toUpperCase()), el('div', 'pr-by', 'Written by'), el('div', 'pr-author', author));
  } else {
    const corner = el('div', 'pr-corner');
    corner.append(el('div', '', author), el('div', 'pr-count', `about ${roundWords(words).toLocaleString()} words`));
    tp.append(corner, el('div', 'pr-big', title || 'Untitled'), el('div', 'pr-by', author ? `by ${author}` : ''));
  }
  doc.append(tp);
  for (const ch of chapters) {
    const sec = el('section', 'pr-chapter');
    if (!script) sec.append(el('h2', 'pr-ch-title', ch.title));
    for (const b of ch.blocks) {
      if (b.kind === 'scene') {
        // A script's sections are for finding your way, not for the page.
        if (!script) sec.append(el('p', 'pr-break', '#'));
        continue;
      }
      if (!b.text.trim() && !script) continue;
      if (script) {
        const kind = b.el || 'action';
        if (!b.text.trim()) continue;
        const p = fill(el('p', `pr-${kind}`), b.runs, kind === 'scene' || kind === 'character' || kind === 'transition');
        if (kind === 'scene' && b.code) { p.prepend(el('span', 'pr-code pr-code-l', b.code)); p.append(el('span', 'pr-code pr-code-r', b.code)); }
        sec.append(p);
      } else if (b.kind === 'heading') sec.append(fill(el('h3', 'pr-h'), b.runs));
      else sec.append(fill(el('p', 'pr-p'), b.runs));
    }
    doc.append(sec);
  }
  return doc;
}

// Opens the print window on the piece; "Save as PDF" is one of its printers.
export function printPiece(info) {
  document.querySelector('.print-doc')?.remove();
  const doc = printable(info);
  document.body.append(doc);
  document.documentElement.classList.add('printing-doc');
  const done = () => {
    document.documentElement.classList.remove('printing-doc');
    doc.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  // Fonts and layout settle first, or the first page can come out blank.
  setTimeout(() => window.print(), 60);
  return doc;
}
