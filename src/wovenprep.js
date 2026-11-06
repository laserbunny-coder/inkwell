import { scenesOf, parseSlug, buildSlug, missing, writeSlug, TITLE_LEVEL, WOVEN, TIME_CHOICES, setMarker, findScene } from './woven.js';

// Prepare for shoot: everything a Woven script needs before a schedule,
// shot list or call sheet can be made from it, filled in for you. Your words
// never change. Only the hidden scene headings are filled where they're
// blank or still guessed, and titles go on scenes that have none. All of it
// is one step, so Ctrl + Z (or Undo on the note) takes it all back.
//
// First the easy part, done right here: a "continuous" scene is in the same
// place as the one before it. Then Claude reads the scenes (when you're signed
// in and online) and fills the rest; what neither can tell becomes a short
// list of one-tap questions. Places the script uses that the world's bible
// doesn't have yet can become place pages in one go.

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-/])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// hooks: { editor, places(doc), biblePlaces(), ask(body), canAsk(), piece(), toast(msg, action), makePlaces(list) }
export async function prepareForShoot(hooks) {
  const editor = hooks.editor;
  const sheet = new PrepSheet(hooks);
  sheet.busy('Reading the scenes…');
  // Every stretch gets a heading to hold its place and time, the opening one too.
  const top = scenesOf(editor.state.doc).find((s) => !s.node);
  if (top) {
    const at = top.titlePos !== null ? top.titlePos + editor.state.doc.nodeAt(top.titlePos).nodeSize : top.at;
    editor.view.dispatch(editor.state.tr.insert(at, editor.state.schema.nodes.paragraph.create({ el: 'scene', guess: true })).setMeta(WOVEN, { set: true }));
  }
  const scenes = scenesOf(editor.state.doc);
  if (!scenes.length) { sheet.done({ filled: 0, questions: [], places: [], titles: [], note: 'There are no scenes here yet. Write a little first.' }); return; }
  const places = hooks.places(editor.state.doc);
  const fills = new Map(); // scene eid → marker
  const titles = new Map(); // scene eid → title
  let prev = null;
  for (const s of scenes) {
    const m = { ...s.marker };
    if (m.kind === 'continuous' && !m.place && prev?.place) { m.place = prev.place; m.ie ||= prev.ie; }
    if (buildSlug(m) !== buildSlug(s.marker)) fills.set(s.eid, m);
    prev = m;
  }
  let questions = [];
  let note = '';
  let newPlaces = [];
  if (hooks.canAsk()) {
    try {
      const body = {
        mode: 'woven', task: 'prepare', piece: hooks.piece() || '',
        places: places.filter((p) => p.slug !== 'TALKING HEAD').map((p) => ({ name: p.slug, ie: p.ie || '', ...(p.notime ? { notime: true } : {}) })).slice(0, 200),
        scenes: scenes.map((s) => {
          const m = fills.get(s.eid) || s.marker;
          return { n: s.n, heading: buildSlug(m), known: { ie: m.ie, place: m.place, time: m.time, kind: m.kind, place2: m.place2 }, guessed: !!s.node?.attrs.guess, title: s.title, text: s.text.slice(0, 1500) };
        })
      };
      const got = await hooks.ask(body);
      for (const a of got?.scenes || []) {
        const s = scenes[Number(a.n) - 1];
        if (!s) continue;
        const was = fills.get(s.eid) || s.marker;
        const guessed = !s.node?.textContent.trim() || s.node.attrs.guess;
        const m = { ...was };
        // Only blanks (or guesses) are filled: what you set stays yours.
        for (const k of ['ie', 'place', 'time', 'place2']) if (a[k] && (!m[k] || guessed)) m[k] = String(a[k]).toUpperCase().slice(0, 80);
        if (a.kind && guessed && ['cut', 'continuous', 'intercut', 'flashback', 'montage'].includes(a.kind)) m.kind = a.kind;
        if (buildSlug(m) !== buildSlug(s.marker)) fills.set(s.eid, m);
        if (a.title && !s.title) titles.set(s.eid, String(a.title).slice(0, 80));
      }
      questions = (got?.questions || []).map((q) => ({ scene: scenes[Number(q.n) - 1], ask: q.ask, field: q.field, options: (q.options || []).slice(0, 5) })).filter((q) => q.scene && q.ask && ['ie', 'place', 'time', 'kind', 'place2'].includes(q.field));
      newPlaces = (got?.places || []).filter((p) => p?.name);
    } catch (e) {
      note = `Claude couldn’t read it just now (${e.message || 'no answer'}), so only the easy ones were filled.`;
    }
  } else note = 'Claude needs you signed in and online, so only the easy ones were filled. The rest are below.';

  // One step for everything, so one undo takes it all back.
  const tr = editor.state.tr;
  for (const s of [...scenes].reverse()) {
    const m = fills.get(s.eid);
    const pos = findScene(tr.doc, { eid: s.eid })?.pos;
    if (pos === undefined || pos === null) continue;
    if (m) writeSlug(tr, pos, buildSlug(m), false);
    const t = titles.get(s.eid);
    if (t) tr.insert(pos, editor.state.schema.nodes.sceneBreak.create({ level: TITLE_LEVEL, title: t }));
  }
  if (tr.docChanged) editor.view.dispatch(tr.setMeta(WOVEN, { set: true }));

  // Whatever is still missing becomes a question, unless Claude asked already.
  const after = scenesOf(editor.state.doc);
  const asked = new Set(questions.map((q) => `${q.scene.eid}:${q.field}`));
  for (const s of after) {
    for (const f of missing(s.marker, places)) {
      if (asked.has(`${s.eid}:${f}`)) continue;
      const where = s.marker.place ? titleCase(s.marker.place) : `“${(s.first || '').slice(0, 40)}…”`;
      if (f === 'ie') questions.push({ scene: s, field: 'ie', ask: `${where}: inside or outside?`, options: [{ label: 'Inside', value: 'INT.' }, { label: 'Outside', value: 'EXT.' }, { label: 'Both', value: 'INT./EXT.' }] });
      if (f === 'time') questions.push({ scene: s, field: 'time', ask: `${where}: what time of day?`, options: TIME_CHOICES.slice(0, 6).map((t) => ({ label: titleCase(t), value: t })) });
      if (f === 'place') questions.push({ scene: s, field: 'place', ask: `Where is “${(s.first || s.title || '').slice(0, 50)}…”?`, options: [] });
      if (f === 'place2') questions.push({ scene: s, field: 'place2', ask: `${where}: intercut with where?`, options: [] });
    }
  }
  // Places the script uses that have no page in the bible yet.
  const bible = new Set(hooks.biblePlaces().map((p) => (p.slug || p.name || '').toUpperCase()));
  const used = new Map();
  for (const s of after) for (const p of [s.marker.place, s.marker.place2]) if (p && p !== 'TALKING HEAD' && !bible.has(p) && !used.has(p)) used.set(p, { name: titleCase(p), ie: s.marker.ie || newPlaces.find((x) => String(x.name).toUpperCase() === p)?.ie || '' });
  sheet.done({ filled: fills.size, titled: titles.size, questions, places: [...used.values()], note, stepped: tr.docChanged });
}

class PrepSheet {
  constructor(hooks) {
    this.hooks = hooks;
    document.querySelector('.wv-sheet')?.remove();
    this.el = make('div', 'wv-sheet');
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Prepare for shoot');
    const card = make('div', 'wv-sheet-card');
    this.card = card;
    this.el.append(card);
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.close(); });
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } });
    document.body.append(this.el);
  }

  close() { this.el.remove(); this.hooks.editor.commands.focus(); }

  busy(text) {
    this.card.replaceChildren(make('h2', '', 'Prepare for shoot'), make('p', 'wv-sheet-busy', text));
  }

  done({ filled, titled = 0, questions, places, note, stepped }) {
    const c = this.card;
    c.replaceChildren(make('h2', '', 'Prepare for shoot'));
    const said = [];
    if (filled) said.push(`Filled in ${filled} scene heading${filled === 1 ? '' : 's'}`);
    if (titled) said.push(`named ${titled} scene${titled === 1 ? '' : 's'}`);
    const sum = make('p', 'wv-sheet-sum', said.length ? `${said.join(' and ')}. Your words weren’t touched.` : 'Nothing needed filling in.');
    if (stepped) {
      const undo = make('button', 'ghost-btn', 'Undo');
      undo.type = 'button';
      undo.addEventListener('click', () => { this.hooks.editor.chain().focus().undo().run(); this.close(); this.hooks.toast('Prepare for shoot undone'); });
      sum.append(' ', undo);
    }
    c.append(sum);
    if (note) c.append(make('p', 'wv-sheet-note', note));
    if (questions.length) {
      c.append(make('h3', '', questions.length === 1 ? 'One thing to answer' : `${questions.length} things to answer`));
      const list = make('ul', 'wv-qs');
      for (const q of questions) list.append(this.question(q));
      c.append(list);
    } else c.append(make('p', 'wv-sheet-ready', 'Every scene has its place and time. Ready for a breakdown and shot list.'));
    if (places.length) {
      c.append(make('h3', '', 'New places'));
      const p = make('p', 'wv-sheet-places', `${places.map((x) => x.name).join(', ')} ${places.length === 1 ? 'isn’t' : 'aren’t'} in the world’s bible yet. A place page keeps its inside or outside, pictures and notes for the shoot.`);
      const b = make('button', 'pill', places.length === 1 ? 'Make its page' : `Make ${places.length} place pages`);
      b.type = 'button';
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await this.hooks.makePlaces(places); b.textContent = 'Made'; } catch (e) { b.disabled = false; this.hooks.toast(e.message || 'Couldn’t make them'); }
      });
      c.append(p, b);
    }
    const foot = make('div', 'wv-sheet-foot');
    const close = make('button', 'pill', 'Done');
    close.type = 'button';
    close.addEventListener('click', () => this.close());
    foot.append(close);
    c.append(foot);
    close.focus();
  }

  question(q) {
    const li = make('li', 'wv-q');
    li.append(make('span', 'wv-q-n', `Scene ${q.scene.node?.attrs.code || q.scene.n}`), make('span', 'wv-q-ask', q.ask));
    const answer = (value) => {
      const s = findScene(this.hooks.editor.state.doc, { eid: q.scene.eid });
      if (!s?.node || !value) return;
      setMarker(this.hooks.editor, s.pos, { ...s.marker, [q.field]: String(value).toUpperCase() });
      li.classList.add('answered');
      li.querySelectorAll('button, input').forEach((x) => { x.disabled = true; });
    };
    const box = make('div', 'wv-chips');
    for (const o of q.options) {
      const b = make('button', 'wv-chip', o.label || titleCase(String(o.value)));
      b.type = 'button';
      b.addEventListener('click', () => answer(o.value || o.label));
      box.append(b);
    }
    if (!q.options.length || q.field === 'place' || q.field === 'place2') {
      const i = make('input', 'wv-q-in');
      i.placeholder = 'Type it';
      i.setAttribute('list', 'wv-places');
      i.setAttribute('aria-label', q.ask);
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); answer(i.value.trim()); } });
      i.addEventListener('change', () => answer(i.value.trim()));
      box.append(i);
    }
    li.append(box);
    return li;
  }
}

export { parseSlug };
