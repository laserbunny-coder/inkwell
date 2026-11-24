// One shot, open: the card that floats over the script (src/scriptshots.js),
// a popover on a computer and a sheet on a phone. It is its own piece so
// Make can grow it (a filmed shot's note and reference frame, a generated
// shot's prompts and tries) and show the same card. It draws; the caller
// keeps the shot (opts.edit, opts.picture, opts.make, opts.remove).
import { plain as make } from './dom.js';
import { shotStage, SHOT_STAGES } from './production.js';

// opts: code, scene (its name), status (its word: Planned, Got it, Still picked…),
// got ({ on, set(on) }) for a filmed shot's Got it tick, covers (the lines it covers, said plainly), pic (element), close() or null, edit(patch
// {text}|{framing}), done() (Enter), blur(), picture(file), make(), remove().
export function shotCard(sh, opts) {
  const d = make('div', 'ss-detail');
  d.dataset.shot = sh.id;
  if (opts.pic) d.append(opts.pic);
  const top = make('div', 'ss-top');
  const stage = opts.status || SHOT_STAGES.find((s) => s.id === shotStage(sh))?.label || '';
  top.append(make('span', 'ss-code', opts.code || ''), make('span', 'ss-stage', stage));
  if (opts.got) {
    // The same Got it as Make's: one tap, a filmed shot is in the can.
    const g = make('button', 'ss-got', opts.got.on ? '✓ Got it' : 'Got it');
    g.type = 'button';
    g.setAttribute('aria-pressed', String(!!opts.got.on));
    g.addEventListener('click', () => opts.got.set(!opts.got.on));
    top.append(g);
  }
  if (opts.close) {
    const x = make('button', 'ss-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', () => opts.close());
    top.append(x);
  }
  const field = (cls, value, placeholder, key) => {
    const f = make('input', `ss-field ${cls}`);
    f.value = value || '';
    f.placeholder = placeholder;
    f.setAttribute('aria-label', placeholder);
    f.addEventListener('input', () => opts.edit?.({ [key]: f.value }));
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); opts.done?.(); } });
    f.addEventListener('blur', () => opts.blur?.());
    return f;
  };
  const what = field('ss-what-in', sh.text, 'What happens', 'text');
  const framing = field('ss-framing-in', sh.fields?.framing, 'Framing: wide, close-up, insert…', 'framing');
  const where = make('p', 'ss-in', opts.scene ? `In ${opts.scene}` : '');
  const covers = opts.covers ? make('p', 'ss-covers', opts.covers) : null;
  // Where it starts and ends: each end's first words, a line earlier or later.
  let ends = null;
  if (opts.ends) {
    ends = make('div', 'ss-ends');
    for (const [k, label] of [['start', 'Starts at'], ['end', 'Ends at']]) {
      const e = opts.ends[k];
      const row = make('div', `ss-end ss-end-${k}`);
      row.append(make('span', 'ss-end-label', label), make('span', 'ss-end-words', `“${e.words}”`));
      for (const [d, sym, name] of [['up', '↑', 'a line earlier'], ['down', '↓', 'a line later']]) {
        const b = make('button', `ss-step ss-step-${d}`, sym);
        b.type = 'button';
        b.setAttribute('aria-label', `${label} ${name}`);
        b.disabled = !e[d];
        if (e[d]) b.addEventListener('click', () => e[d]());
        row.append(b);
      }
      ends.append(row);
    }
  }
  const acts = make('div', 'ss-acts');
  // Sketch: a blank pad; Draw over it: the frame faint beneath; Keep
  // drawing: the sketch shown, opened again (each makes a new try).
  if (opts.sketch) {
    for (const [k, label] of [['blank', 'Sketch'], ['over', 'Draw over it'], ['again', 'Keep drawing']]) {
      if (!opts.sketch[k]) continue;
      const b = make('button', `ss-act ss-sketch-${k}`, label);
      b.type = 'button';
      b.addEventListener('click', () => opts.sketch[k]());
      acts.append(b);
    }
  }
  if (opts.picture) {
    const add = make('label', 'ss-act', 'Add pictures');
    const file = make('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.multiple = true;
    file.hidden = true;
    file.addEventListener('change', () => { const fs = [...(file.files || [])]; file.value = ''; if (fs.length) opts.picture(fs); });
    add.append(file);
    acts.append(add);
  }
  if (opts.place) {
    const pl = make('button', 'ss-act ss-place', opts.place.label);
    pl.type = 'button';
    pl.addEventListener('click', () => opts.place.run());
    acts.append(pl);
  }
  if (opts.unplace) {
    const off = make('button', 'ss-act ss-unplace', 'Take off lines');
    off.type = 'button';
    off.addEventListener('click', () => opts.unplace());
    acts.append(off);
  }
  if (opts.make) {
    const mk = make('button', 'ss-act', 'Open in Make ›');
    mk.type = 'button';
    mk.addEventListener('click', () => opts.make());
    acts.append(mk);
  }
  if (opts.remove) {
    const del = make('button', 'ss-act end', 'Remove');
    del.type = 'button';
    del.addEventListener('click', () => opts.remove());
    acts.append(del);
  }
  // The shot's pictures and sketches, newest first, each with its star.
  let strip = null;
  if (opts.frames?.list?.length > 1 || opts.frames?.list?.some((f) => f.board)) {
    strip = make('div', 'ss-frames');
    for (const f of opts.frames.list) {
      const t = make('div', `ss-frame${f.shown ? ' shown' : ''}`);
      t.dataset.file = f.id;
      const img = make('img');
      img.alt = f.board ? 'Sketch' : 'Picture';
      f.url.then((u) => { if (u) img.src = u; }).catch(() => {});
      const show = make('button', 'ss-frame-pic');
      show.type = 'button';
      show.setAttribute('aria-label', f.board ? 'Show this sketch' : 'Show this picture');
      show.append(img);
      show.addEventListener('click', () => opts.frames.show(f.id));
      const star = make('button', 'ss-frame-star', f.star ? '★' : '☆');
      star.type = 'button';
      star.setAttribute('aria-pressed', String(!!f.star));
      star.setAttribute('aria-label', f.star ? 'The picked one (tap to unpick)' : 'Pick this one');
      star.addEventListener('click', () => opts.frames.star(f.id));
      t.append(show, star);
      if (f.board) t.append(make('span', 'ss-frame-kind', 'sketch'));
      strip.append(t);
    }
  }
  // For an image model by hand (Gemini, ChatGPT), and the sketch to give it.
  let tools = null;
  if (opts.copyPrompt || opts.savePicture) {
    tools = make('div', 'ss-acts ss-quiet');
    if (opts.copyPrompt) { const b = make('button', 'ss-act ss-copy', 'Copy the prompt'); b.type = 'button'; b.title = 'Words for Gemini or ChatGPT: the look, the shot, its lines, who and where. Paste with the sketch.'; b.addEventListener('click', () => opts.copyPrompt()); tools.append(b); }
    if (opts.savePicture) { const b = make('button', 'ss-act ss-save', 'Save picture'); b.type = 'button'; b.addEventListener('click', () => opts.savePicture()); tools.append(b); }
  }
  d.append(top, what, framing, where, ...(covers ? [covers] : []), ...(ends ? [ends] : []), ...(strip ? [strip] : []), acts, ...(tools ? [tools] : []));
  return d;
}
