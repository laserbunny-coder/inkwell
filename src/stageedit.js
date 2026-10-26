import { STAGE_SETS, setById, stageSetOf, stagesIn, stageOf, bookType, TYPE_NAMES } from './library.js';

// A project's stages: which set its scripts, prose and outlines go through,
// and its own names for a set's stages (rename, add, remove, reorder). The
// last stage is always out in the world. A piece on a stage you remove moves
// to the stage before it, and the dialog says so before you save; renaming
// a stage carries its pieces with it.

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};

// world: the project; pieces: every piece in it. Resolves the rows to save
// (the world and any pieces whose stage changed), or null if cancelled.
export function editStages(world, pieces) {
  return new Promise((resolve) => {
    const stageFor = { ...(world.fields?.stageFor || {}) };
    const lists = Object.fromEntries(STAGE_SETS.map((set) => [set.id, stagesIn(set, world).map((name) => ({ name, was: name }))]));
    const inUse = () => [...new Set(pieces.map((p) => stageSetOf(p, { fields: { ...world.fields, stageFor } }).id))];
    let editing = inUse()[0] || 'ai';

    const back = make('div', 'ask-backdrop');
    const box = make('div', 'ask stage-edit');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Stages');
    back.append(box);
    document.body.append(back);
    const done = (v) => { back.remove(); resolve(v); };
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } });

    // Where the pieces on each stage would end up.
    const moves = (setId) => {
      const list = lists[setId];
      const out = [];
      for (const p of pieces) {
        // Where it is now, in the set its kind goes through after this edit.
        const w = { fields: { ...world.fields, stageFor } };
        if (stageSetOf(p, w).id !== setId) continue;
        const at = stageOf(p, w);
        if (list.some((r) => r.was === at)) continue;
        const old = stagesIn(setById(setId), world);
        let i = old.indexOf(at);
        let to = null;
        while (i-- > 0 && !to) to = list.find((r) => r.was === old[i]);
        out.push({ p, from: at, to: (to || list[0]).name });
      }
      return out;
    };

    const draw = () => {
      box.replaceChildren();
      box.append(make('h2', '', `Stages in ${world.title || 'this project'}`));
      const types = [...new Set(['screenplay', 'novel', 'lines', ...pieces.map((p) => bookType(p))])].filter((t) => TYPE_NAMES[t]);
      const uses = make('div', 'se-uses');
      for (const t of types) {
        const row = make('label', 'se-use');
        row.append(make('span', '', `${TYPE_NAMES[t]} go through`));
        const sel = make('select');
        sel.setAttribute('aria-label', `${TYPE_NAMES[t]} go through`);
        sel.dataset.type = t;
        for (const set of STAGE_SETS) sel.append(Object.assign(make('option', '', set.name), { value: set.id }));
        sel.value = stageSetOf({ fields: { type: t } }, { fields: { ...world.fields, stageFor } }).id;
        sel.addEventListener('change', () => { stageFor[t] = sel.value; editing = sel.value; draw(); });
        row.append(sel);
        uses.append(row);
      }
      box.append(uses);

      const tabs = make('div', 'ask-choices se-tabs');
      for (const set of STAGE_SETS) {
        const b = make('button', 'chip' + (set.id === editing ? ' on' : ''), set.name);
        b.dataset.set = set.id;
        b.addEventListener('click', () => { editing = set.id; draw(); });
        tabs.append(b);
      }
      box.append(make('p', 'hint', 'Edit a set’s stages for this project:'), tabs);

      const list = lists[editing];
      const ul = make('ol', 'se-list');
      list.forEach((r, i) => {
        const li = make('li', 'se-row');
        const name = make('input', 'ask-input se-name');
        name.value = r.name;
        name.setAttribute('aria-label', `Stage ${i + 1}`);
        name.addEventListener('input', () => { r.name = name.value; });
        name.addEventListener('change', () => draw());
        const up = make('button', 'ghost-btn', '↑');
        up.setAttribute('aria-label', `Move ${r.name} earlier`);
        up.disabled = i === 0;
        up.addEventListener('click', () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); });
        const down = make('button', 'ghost-btn', '↓');
        down.setAttribute('aria-label', `Move ${r.name} later`);
        down.disabled = i === list.length - 1;
        down.addEventListener('click', () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; draw(); });
        const del = make('button', 'ghost-btn', 'Remove');
        del.disabled = list.length <= 2;
        del.addEventListener('click', () => { list.splice(i, 1); draw(); });
        li.append(name, up, down, del);
        if (i === list.length - 1) li.append(make('span', 'se-out', 'out in the world'));
        ul.append(li);
      });
      box.append(ul);
      const add = make('button', 'ghost-btn', '+ Add a stage');
      add.addEventListener('click', () => { list.splice(Math.max(0, list.length - 1), 0, { name: 'New stage', was: null }); draw(); box.querySelectorAll('.se-name')[list.length - 2]?.select(); });
      const reset = make('button', 'ghost-btn', `Back to the usual ${setById(editing).name} stages`);
      reset.addEventListener('click', () => {
        // Each usual stage takes the pieces of the stage now in its place,
        // so a renamed stage goes back to its old name with its pieces.
        const now = lists[editing].filter((r) => r.was);
        const usual = setById(editing).stages;
        lists[editing] = usual.map((name, i) => ({ name, was: now.find((r) => r.was === name)?.was || (now.length === usual.length ? now[i].was : null) }));
        draw();
      });
      const tools = make('div', 'se-tools');
      tools.append(add, reset);
      box.append(tools);

      const m = moves(editing);
      if (m.length) {
        const warn = make('p', 'hint se-moves');
        warn.textContent = m.map(({ p, from, to }) => `${p.title || 'Untitled'} is on ${from}; it will move to ${to}.`).join(' ');
        box.append(warn);
      }
      const acts = make('div', 'ask-actions');
      const no = make('button', 'ghost-btn', 'Cancel');
      no.addEventListener('click', () => done(null));
      const yes = make('button', 'pill primary', 'Save');
      yes.addEventListener('click', save);
      acts.append(no, yes);
      box.append(acts);
    };

    const save = () => {
      const t = Date.now();
      const stageLists = {};
      for (const set of STAGE_SETS) {
        const names = lists[set.id].map((r) => r.name.trim()).filter(Boolean);
        if (names.length >= 2 && JSON.stringify(names) !== JSON.stringify(set.stages)) stageLists[set.id] = names;
      }
      const fields = { ...world.fields, stageFor, stageLists };
      if (!Object.keys(stageLists).length) delete fields.stageLists;
      if (!Object.keys(stageFor).length) delete fields.stageFor;
      const rows = [{ ...world, fields, updated_at: t }];
      // Pieces follow a renamed stage, and leave a removed one.
      for (const set of STAGE_SETS) {
        const renamed = new Map(lists[set.id].filter((r) => r.was && r.was !== r.name.trim()).map((r) => [r.was, r.name.trim()]));
        const moved = new Map(moves(set.id).map((x) => [x.p.id, x.to]));
        for (const p of pieces) {
          if (stageSetOf(p, { fields }).id !== set.id) continue;
          const at = stageOf(p, { fields: { ...world.fields, stageFor } });
          // A piece whose kind changed sets keeps its point (Boarded becomes Prepped).
          const to = moved.get(p.id) || renamed.get(at) || (p.fields?.stage && at !== p.fields.stage ? at : null);
          if (to && to !== p.fields?.stage) rows.push({ ...p, fields: { ...p.fields, stage: to }, updated_at: t });
        }
      }
      done(rows);
    };

    draw();
    box.querySelector('select, input')?.focus();
  });
}
