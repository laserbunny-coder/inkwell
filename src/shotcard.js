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
  const acts = make('div', 'ss-acts');
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
    const pl = make('button', 'ss-act', opts.place.label);
    pl.type = 'button';
    pl.addEventListener('click', () => opts.place.run());
    acts.append(pl);
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
  d.append(top, what, framing, where, ...(covers ? [covers] : []), acts);
  return d;
}
