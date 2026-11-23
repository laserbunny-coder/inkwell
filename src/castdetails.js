// Cast and places (Studio polish, build 2): one person's or one place's
// details, opened from its name on the look wall, on the project's Make or
// inside a film. The words come from its Bible page (the same page
// underneath, so nothing is typed twice): how it looks, who plays them, a
// place's lighting, other names; and, folded, what AI tools need: the
// character sheet or angles, and each tool's ID. Also the rules every shot
// keeps to, folded at the top of the wall.
import { getEntry, putEntries } from './db.js';
import { addFile, fileUrl } from './files.js';
import { make } from './dom.js';
import { setElement, viewSlots, toolIdsFor, toolIdsOf, ASPECTS, RATES, rulesOf, typeOf, ELEMENT_TYPES } from './production.js';

// Saves after a pause while typing, and at once on leaving the box.
const timers = new Map();
const later = (key, fn) => { clearTimeout(timers.get(key)?.t); timers.set(key, { t: setTimeout(() => { timers.delete(key); fn(); }, 500), fn }); };
const now = (key) => { const x = timers.get(key); if (!x) return; clearTimeout(x.t); timers.delete(key); x.fn(); };

const kindWord = (type) => (type === 'location' ? 'Place' : typeOf(type).label);

// hooks: changed(rows), redraw(), toast(text, action), menu(anchor, items),
// openPage(id), close(). opts: ai (the For AI tools fold starts open).
export function castDetails(el, hooks, opts = {}) {
  const x = el.fields?.element || {};
  const box = make('section', 'cd');
  box.dataset.element = el.id;
  box.setAttribute('aria-label', `${el.title || 'Untitled'}: details`);
  const head = make('div', 'cd-head');
  head.append(make('h3', 'cd-name', el.title || 'Untitled'), make('span', 'cd-kind', kindWord(x.type)));
  const more = make('button', 'cd-more', '⋯');
  more.type = 'button';
  more.setAttribute('aria-label', `More for ${el.title || 'this one'}`);
  more.addEventListener('click', () => hooks.menu(more, [
    { label: 'Open their Bible page', run: () => hooks.openPage(el.id) },
    { label: 'Kind', sub: ELEMENT_TYPES.map((t) => ({ label: t.id === 'location' ? 'Place' : t.label, current: t.id === (x.type || 'other'), run: async () => { hooks.changed([await setElement(el.id, { type: t.id })]); hooks.redraw(); } })) },
    { label: 'Not in the cast and places', run: async () => { hooks.changed([await setElement(el.id, null)]); hooks.close(); hooks.redraw(); hooks.toast(`“${el.title}” is a plain Bible page again`); } }
  ]));
  const close = make('button', 'ghost-btn cd-close', 'Close');
  close.type = 'button';
  close.addEventListener('click', () => hooks.close());
  head.append(make('span', 'cd-sp'), more, close);
  box.append(head);

  const field = (key, label, placeholder, multi = false) => {
    const i = make(multi ? 'textarea' : 'input', `cd-in${multi ? ' multi' : ''}`);
    i.value = key === 'also' ? (x.also || []).join(', ') : x[key] || '';
    i.placeholder = placeholder;
    i.setAttribute('aria-label', label);
    if (multi) i.rows = 3;
    const save = async () => hooks.changed([await setElement(el.id, { [key]: key === 'also' ? i.value.split(',').map((s) => s.trim()).filter(Boolean) : i.value })]);
    i.addEventListener('input', () => later(`${el.id}:${key}`, save));
    i.addEventListener('blur', () => now(`${el.id}:${key}`));
    const w = make('label', 'cd-field');
    w.append(make('span', 'cd-label', label), i);
    return w;
  };
  const type = x.type || 'other';
  box.append(field('snippet', 'Description', type === 'character' ? 'How they look, in plain words. Goes into every prompt they’re in.' : 'How it looks, in plain words. Goes into every prompt it’s in.', true));
  if (type === 'character') box.append(field('playedBy', 'Played by', 'Who plays them'));
  if (type === 'location') box.append(field('lighting', 'Lighting', 'One line, the same every time: late afternoon sun through blinds, warm, long shadows'));
  box.append(field('also', 'Also called', 'Other names in the script, comma between'));

  // What AI tools need, folded unless the film is made with them.
  const slots = viewSlots(type);
  const ids = toolIdsFor(type);
  if (slots.length || ids.length) {
    const open = opts.ai || (typeof opts.foldOpen === 'boolean' ? opts.foldOpen : false);
    const fold = make('button', 'cd-fold', `${open ? '▾' : '▸'} For AI tools${open ? '' : ' (sheets and tool IDs)'}`);
    fold.type = 'button';
    fold.setAttribute('aria-expanded', String(open));
    const inner = make('div', 'cd-ai');
    inner.hidden = !open;
    fold.addEventListener('click', () => {
      inner.hidden = !inner.hidden;
      fold.setAttribute('aria-expanded', String(!inner.hidden));
      fold.textContent = `${inner.hidden ? '▸' : '▾'} For AI tools${inner.hidden ? ' (sheets and tool IDs)' : ''}`;
    });
    if (slots.length) {
      inner.append(make('span', 'cd-label', type === 'character' ? 'Character sheet' : 'Angles'));
      const row = make('div', 'cd-slots');
      for (const slot of slots) row.append(slotEl(el, slot, hooks));
      inner.append(row);
    }
    if (ids.length) {
      const have = toolIdsOf(el);
      const grid = make('div', 'cd-ids');
      for (const t of ids) {
        const i = make('input', 'cd-in');
        i.value = have[t.id] || '';
        i.placeholder = t.placeholder;
        i.setAttribute('aria-label', t.label);
        const save = async () => {
          const fresh = await getEntry(el.id);
          const cur = fresh.fields?.element || {};
          const v = i.value.trim();
          if (t.id === 'lora') { hooks.changed([await setElement(el.id, { look: v })]); return; }
          const next = { ...(cur.ids || {}) };
          if (v) next[t.id] = v; else delete next[t.id];
          hooks.changed([await setElement(el.id, { ids: next })]);
        };
        i.addEventListener('input', () => later(`${el.id}:id:${t.id}`, save));
        i.addEventListener('blur', () => now(`${el.id}:id:${t.id}`));
        const w = make('label', 'cd-field');
        w.append(make('span', 'cd-label', t.label), i);
        grid.append(w);
      }
      inner.append(grid);
    }
    box.append(fold, inner);
  }
  const page = make('button', 'cd-page', 'Open their Bible page ›');
  page.type = 'button';
  page.title = 'The rest of their notes';
  page.addEventListener('click', () => hooks.openPage(el.id));
  box.append(page);
  return box;
}

// A picture slot on a character sheet or a place's angles.
function slotEl(e, slot, hooks) {
  const x = e.fields.element;
  const id = x.views?.[slot.id];
  const tile = make('label', 'cd-slot' + (id ? '' : ' add'));
  tile.dataset.slot = slot.id;
  tile.title = id ? `${slot.label}: change the picture` : `Add the ${slot.label.toLowerCase()} view`;
  if (id) fileUrl(id).then((url) => { if (url) { const img = make('img'); img.src = url; img.alt = slot.label; tile.prepend(img); } else tile.classList.add('missing'); });
  tile.append(make('span', 'cd-slot-label', slot.label));
  const input = make('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    const row = await addFile(f, { element: e.id, view: slot.id });
    if (!row) { hooks.toast('That picture is over 50 MB.'); return; }
    const fresh = await getEntry(e.id);
    hooks.changed([await setElement(e.id, { views: { ...(fresh.fields?.element?.views || {}), [slot.id]: row.id } })]);
    hooks.redraw();
  });
  tile.append(input);
  if (id) {
    const del = make('button', 'cd-x', '×');
    del.type = 'button';
    del.setAttribute('aria-label', `Remove the ${slot.label.toLowerCase()} view`);
    del.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const fresh = await getEntry(e.id);
      const views = { ...(fresh.fields?.element?.views || {}) };
      delete views[slot.id];
      hooks.changed([await setElement(e.id, { views })]);
      hooks.redraw();
    });
    tile.append(del);
  }
  return tile;
}

// The rules every shot keeps to: the style in words, the frame, the frame
// rate, and what must always or never be true. Folded to one line.
// hooks: changed(rows). world: the world entry.
export function rulesFold(world, hooks, open = false) {
  const p = world.fields?.production || {};
  const r = rulesOf(world);
  const wrap = make('div', 'cd-rules');
  const line = [p.style, r.aspect, r.fps ? `${r.fps} fps` : ''].filter(Boolean).join(' · ');
  const btn = make('button', 'cd-rules-line', `${open ? '▾' : '▸'} Rules for every shot${line ? `: ${line}` : ''}`);
  btn.type = 'button';
  btn.setAttribute('aria-expanded', String(open));
  const box = make('div', 'cd-rules-box');
  box.hidden = !open;
  btn.addEventListener('click', () => { box.hidden = !box.hidden; btn.setAttribute('aria-expanded', String(!box.hidden)); btn.textContent = `${box.hidden ? '▸' : '▾'} Rules for every shot${line ? `: ${line}` : ''}`; });
  const save = async (patch) => {
    const fresh = await getEntry(world.id);
    const row = { ...fresh, fields: { ...fresh.fields, production: { ...(fresh.fields?.production || {}), ...patch } }, updated_at: Date.now() };
    await putEntries([row]);
    hooks.changed([row]);
  };
  const style = make('textarea', 'cd-in multi');
  style.rows = 2;
  style.value = p.style || '';
  style.placeholder = 'The look every shot keeps to: “Dusty, low sun, anamorphic”';
  style.setAttribute('aria-label', 'Style rules');
  style.addEventListener('input', () => later(`${world.id}:style`, () => save({ style: style.value })));
  style.addEventListener('blur', () => now(`${world.id}:style`));
  const sw = make('label', 'cd-field');
  sw.append(make('span', 'cd-label', 'Style'), style);
  const row = make('div', 'cd-rules-row');
  const pick = (label, values, value, key, blank) => {
    const sel = make('select', 'cd-in');
    if (blank) sel.append(new Option(blank, ''));
    for (const v of values) sel.append(new Option(key === 'fps' ? `${v} fps` : v, v));
    sel.value = value;
    sel.setAttribute('aria-label', label);
    sel.addEventListener('change', () => save({ [key]: sel.value }));
    const w = make('label', 'cd-field');
    w.append(make('span', 'cd-label', label), sel);
    return w;
  };
  row.append(pick('Frame', ASPECTS, r.aspect, 'aspect', 'Not set'), pick('Frame rate', RATES, r.fps, 'fps'));
  const an = make('textarea', 'cd-in multi');
  an.rows = 3;
  an.value = r.constraints;
  an.placeholder = 'Always and never, one per line: Kenji is always a head shorter than Mom. Never any text in frame.';
  an.setAttribute('aria-label', 'Always and never');
  an.addEventListener('input', () => later(`${world.id}:constraints`, () => save({ constraints: an.value })));
  an.addEventListener('blur', () => now(`${world.id}:constraints`));
  const aw = make('label', 'cd-field');
  aw.append(make('span', 'cd-label', 'Always and never'), an);
  box.append(sw, row, aw);
  wrap.append(btn, box);
  return wrap;
}

// Leaving the wall: anything still waiting to save, saves.
export function flushDetails() { for (const k of [...timers.keys()]) now(k); }
