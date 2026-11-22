// One shot, open: the card that floats over the script (src/scriptshots.js),
// a popover on a computer and a sheet on a phone. It is its own piece so
// Make can grow it (a filmed shot's note and reference frame, a generated
// shot's prompts and tries) and show the same card. It draws; the caller
// keeps the shot (opts.edit, opts.picture, opts.make, opts.remove).
import { plain as make } from './dom.js';
import { shotStage, SHOT_STAGES } from './production.js';

// opts: code, scene (its name), pic (element), close() or null, edit(patch
// {text}|{framing}), done() (Enter), blur(), picture(file), make(), remove().
export function shotCard(sh, opts) {
  const d = make('div', 'ss-detail');
  d.dataset.shot = sh.id;
  if (opts.pic) d.append(opts.pic);
  const top = make('div', 'ss-top');
  const stage = SHOT_STAGES.find((s) => s.id === shotStage(sh))?.label || '';
  top.append(make('span', 'ss-code', opts.code || ''), make('span', 'ss-stage', stage));
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
  const acts = make('div', 'ss-acts');
  if (opts.picture) {
    const add = make('label', 'ss-act', 'Add a picture');
    const file = make('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;
    file.addEventListener('change', () => { const f = file.files?.[0]; if (f) opts.picture(f); });
    add.append(file);
    acts.append(add);
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
  d.append(top, what, framing, where, acts);
  return d;
}
