import { allSets, setById, stageSetOf, stagesIn, stageOf, bookType, TYPE_NAMES, TOOLS, toolsIn } from './library.js';
import { newId } from './model.js';

// A project's workflow: the steps (stages) its pieces go through and the
// tools on Make. The same editor shows at New, filled in from what you're
// making, and later from the project's ⋯ menu, Workflow…. Steps can be
// renamed, dragged (or Alt + Left / Right) into a new order, removed and
// added; the last step is always out in the world. A piece on a step you
// remove moves to the one before it, and the dialog says so before you save;
// renaming a step carries its pieces with it. Save as my own keeps a
// workflow to start the next project from.

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};

const rowsFor = (set, world) => stagesIn(set, world).map((name) => ({ name, was: name }));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The editor's state for one project (a real one, or the one being made).
function workflowState(world, editing) {
  const lists = {};
  const tools = {};
  for (const set of allSets()) { lists[set.id] = rowsFor(set, world); tools[set.id] = [...toolsIn(set, world)]; }
  return { world, editing, lists, tools, more: !!setById(editing).more, naming: false };
}

// Main sets as chips; Live action, Stage and your own under More.
function setChips(st, pick) {
  const box = make('div', 'ask-choices se-tabs');
  const sets = allSets();
  const shown = sets.filter((s) => !s.more || st.more || s.id === st.editing);
  for (const set of shown) {
    const b = make('button', 'chip' + (set.id === st.editing ? ' on' : ''), set.name);
    b.dataset.set = set.id;
    b.setAttribute('aria-pressed', String(set.id === st.editing));
    if (set.own) b.title = 'Your own workflow';
    b.addEventListener('click', () => pick(set.id));
    box.append(b);
  }
  if (sets.some((s) => s.more && s.id !== st.editing)) {
    const more = make('button', 'ghost-btn se-more', st.more ? 'Fewer' : 'More ▾');
    more.setAttribute('aria-expanded', String(st.more));
    more.addEventListener('click', () => { st.more = !st.more; pick(st.editing); });
    box.append(more);
  }
  return box;
}

// The steps and tools of the set being edited, and what you can do with them.
function stepsAndTools(st, redraw, hooks) {
  const wrap = make('div', 'se-panel');
  const list = st.lists[st.editing];
  const set = setById(st.editing);
  const moveTo = (i, j) => {
    if (j < 0 || j >= list.length || i === j) return;
    const [r] = list.splice(i, 1);
    list.splice(j, 0, r);
    redraw();
    wrap.ownerDocument.querySelectorAll('.se-name')[j]?.focus();
  };

  wrap.append(make('p', 'se-label', 'Steps · drag to reorder, click to rename'));
  const ul = make('ol', 'se-list');
  list.forEach((r, i) => {
    const li = make('li', 'se-row');
    li.dataset.i = i;
    const grip = make('span', 'se-grip', '⋮⋮');
    grip.title = 'Drag to move (or Alt + Left / Right while renaming)';
    grip.setAttribute('aria-hidden', 'true');
    // Pointer drag, so it works with a finger on the phone too.
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture?.(e.pointerId);
      li.classList.add('dragging');
      const over = (ev) => {
        const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.se-row');
        return t && ul.contains(t) ? Number(t.dataset.i) : null;
      };
      const move = (ev) => { const j = over(ev); ul.querySelectorAll('.se-row').forEach((x) => x.classList.toggle('drop', Number(x.dataset.i) === j && j !== i)); };
      const end = (ev) => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', end);
        grip.removeEventListener('pointercancel', end);
        li.classList.remove('dragging');
        const j = ev.type === 'pointerup' ? over(ev) : null;
        if (j !== null && j !== i) moveTo(i, j);
        else ul.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', end);
      grip.addEventListener('pointercancel', end);
    });
    const name = make('input', 'se-name');
    name.value = r.name;
    name.style.width = `${Math.max(4, r.name.length + 1)}ch`;
    name.setAttribute('aria-label', `Step ${i + 1}`);
    // No redraw on change: it fires as the input loses focus, and redrawing
    // then would swallow the click (on Save, say) that took the focus.
    name.addEventListener('input', () => { r.name = name.value; name.style.width = `${Math.max(4, name.value.length + 1)}ch`; });
    name.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); moveTo(i, i + (e.key === 'ArrowLeft' ? -1 : 1)); }
      if (e.key === 'Enter') e.preventDefault();
    });
    const del = make('button', 'se-del', '×');
    del.setAttribute('aria-label', `Remove ${r.name || `step ${i + 1}`}`);
    del.title = list.length <= 2 ? 'A workflow needs at least two steps' : 'Remove this step';
    del.disabled = list.length <= 2;
    del.addEventListener('click', () => { list.splice(i, 1); redraw(); });
    li.append(grip, name);
    if (i === list.length - 1) {
      const out = make('span', 'se-out', 'out');
      out.title = 'The last step means out in the world: posted, published, performed';
      li.append(out);
    }
    li.append(del);
    ul.append(li);
  });
  const add = make('button', 'se-add', '+ Step');
  add.addEventListener('click', () => {
    list.splice(Math.max(0, list.length - 1), 0, { name: 'New step', was: null });
    redraw();
    wrap.ownerDocument.querySelectorAll('.se-name')[list.length - 2]?.select();
  });
  const li = make('li', 'se-row se-row-add');
  li.append(add);
  ul.append(li);
  wrap.append(ul);

  wrap.append(make('p', 'se-label', 'Tools on Make · click to turn on or off'));
  const tools = make('div', 'ask-choices se-toolchips');
  const on = st.tools[st.editing];
  for (const t of TOOLS) {
    const b = make('button', 'chip' + (on.includes(t.id) ? ' on' : ''), t.label);
    b.dataset.tool = t.id;
    b.setAttribute('aria-pressed', String(on.includes(t.id)));
    b.addEventListener('click', () => {
      st.tools[st.editing] = on.includes(t.id) ? on.filter((x) => x !== t.id) : TOOLS.map((x) => x.id).filter((x) => x === t.id || on.includes(x));
      redraw();
    });
    tools.append(b);
  }
  if (!on.length) tools.append(make('span', 'hint se-notools', 'None: Make points to Deliver'));
  wrap.append(tools);

  const acts = make('div', 'se-tools');
  if (st.naming) {
    const nm = make('input', 'ask-input se-own-name');
    nm.value = set.own ? set.name : `My ${set.name.toLowerCase()}`;
    nm.setAttribute('aria-label', 'Name for your workflow');
    const keep = make('button', 'pill', 'Keep');
    const no = make('button', 'ghost-btn', 'Cancel');
    const doKeep = async () => {
      const title = nm.value.trim();
      if (!title) return nm.focus();
      const stages = list.map((r) => r.name.trim()).filter(Boolean);
      const row = { id: newId('wf'), kind: 'workflow', parent_id: null, sort: 0, title, text: '', fields: { base: set.base || set.id, stages: stages.length >= 2 ? stages : set.stages, tools: [...on] }, created_at: Date.now(), updated_at: Date.now() };
      await hooks.keepOwn(row);
      // The project now goes the way of the new workflow; the set it came from
      // goes back to how it was.
      const was = st.editing;
      st.lists[row.id] = list.map((r) => ({ name: r.name.trim(), was: r.name.trim() })).filter((r) => r.name);
      st.tools[row.id] = [...on];
      st.lists[was] = rowsFor(set, st.world);
      st.tools[was] = [...toolsIn(set, st.world)];
      st.naming = false;
      st.editing = row.id;
      hooks.switched?.(was, row.id);
      redraw();
    };
    keep.addEventListener('click', doKeep);
    nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doKeep(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); st.naming = false; redraw(); } });
    no.addEventListener('click', () => { st.naming = false; redraw(); });
    acts.append(nm, keep, no);
    wrap.append(acts);
    queueMicrotask(() => nm.select());
    return wrap;
  }
  if (hooks.keepOwn) {
    const own = make('button', 'ghost-btn se-keep', 'Save as my own workflow…');
    own.title = 'Keep these steps and tools to start your next project from';
    own.addEventListener('click', () => { st.naming = true; redraw(); });
    acts.append(own);
  }
  const changed = !same(list.map((r) => r.name), set.stages) || !same(on, set.tools || []);
  if (changed) {
    const reset = make('button', 'ghost-btn se-reset', `Back to the usual ${set.name}`);
    reset.addEventListener('click', () => {
      // Each usual step takes the pieces of the step now in its place, so a
      // renamed step goes back to its old name with its pieces.
      const now = list.filter((r) => r.was);
      const usual = set.stages;
      st.lists[st.editing] = usual.map((name, i) => ({ name, was: now.find((r) => r.was === name)?.was || (now.length === usual.length ? now[i].was : null) }));
      st.tools[st.editing] = [...(set.tools || [])];
      redraw();
    });
    acts.append(reset);
  }
  wrap.append(acts);
  return wrap;
}

// What to store on a world for the sets edited: only what differs from the set.
function listsToSave(st) {
  const stageLists = {};
  const toolLists = {};
  for (const set of allSets()) {
    const names = (st.lists[set.id] || []).map((r) => r.name.trim()).filter(Boolean);
    if (names.length >= 2 && !same(names, set.stages)) stageLists[set.id] = names;
    const tools = st.tools[set.id] || [];
    if (!same(tools, set.tools || [])) toolLists[set.id] = tools;
  }
  return { stageLists, toolLists };
}

// world: the project; pieces: every piece in it; hooks.keepOwn(row) saves a
// workflow of your own. Resolves the rows to save (the world and any pieces
// whose step changed), or null if cancelled.
export function editStages(world, pieces, hooks = {}) {
  return new Promise((resolve) => {
    const stageFor = { ...(world.fields?.stageFor || {}) };
    const inUse = () => [...new Set(pieces.map((p) => stageSetOf(p, { fields: { ...world.fields, stageFor } }).id))];
    const st = workflowState(world, inUse()[0] || stageSetOf({ fields: { type: 'screenplay' } }, world).id);
    const lists = st.lists;

    const back = make('div', 'ask-backdrop');
    const box = make('div', 'ask stage-edit');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Workflow');
    back.append(box);
    document.body.append(back);
    const done = (v) => { back.remove(); resolve(v); };
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } });

    // Where the pieces on each step would end up.
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

    const panelHooks = {
      keepOwn: hooks.keepOwn,
      // Kinds that went the old way now go the way of your own workflow.
      switched: (from, to) => {
        for (const t of ['screenplay', 'novel', 'lines', ...pieces.map((p) => bookType(p))]) {
          if (stageSetOf({ fields: { type: t } }, { fields: { ...world.fields, stageFor } }).id === from) stageFor[t] = to;
        }
      }
    };

    const draw = () => {
      box.replaceChildren();
      box.append(make('h2', '', `Workflow for ${world.title || 'this project'}`));
      const types = [...new Set(['screenplay', 'novel', 'lines', ...pieces.map((p) => bookType(p))])].filter((t) => TYPE_NAMES[t]);
      const uses = make('div', 'se-uses');
      for (const t of types) {
        const row = make('label', 'se-use');
        row.append(make('span', '', `${TYPE_NAMES[t]} ${t === 'novel' ? 'goes' : 'go'} through`));
        const sel = make('select');
        sel.setAttribute('aria-label', `${TYPE_NAMES[t]} ${t === 'novel' ? 'goes' : 'go'} through`);
        sel.dataset.type = t;
        for (const set of allSets()) sel.append(Object.assign(make('option', '', set.name), { value: set.id }));
        sel.value = stageSetOf({ fields: { type: t } }, { fields: { ...world.fields, stageFor } }).id;
        sel.addEventListener('change', () => { stageFor[t] = sel.value; st.editing = sel.value; draw(); });
        row.append(sel);
        uses.append(row);
      }
      box.append(uses);
      box.append(make('p', 'hint', 'Change a workflow for this project:'), setChips(st, (id) => { st.editing = id; draw(); }));
      box.append(stepsAndTools(st, draw, panelHooks));

      const m = moves(st.editing);
      if (m.length) {
        const warn = make('p', 'hint se-moves');
        warn.textContent = m.map(({ p, from, to }) => `${p.title || 'Untitled'} is on ${from}; it will move to ${to}.`).join(' ');
        box.append(warn);
      }
      box.append(make('p', 'hint', 'Change it any time. Pieces keep their place.'));
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
      const { stageLists, toolLists } = listsToSave(st);
      const fields = { ...world.fields, stageFor, stageLists, toolLists };
      if (!Object.keys(stageLists).length) delete fields.stageLists;
      if (!Object.keys(toolLists).length) delete fields.toolLists;
      if (!Object.keys(stageFor).length) delete fields.stageFor;
      const rows = [{ ...world, fields, updated_at: t }];
      // Pieces follow a renamed step, and leave a removed one.
      for (const set of allSets()) {
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

// The "How it gets made" row on New: the usual workflow for what you're
// making, shown as a line, with Customize to open the editor in place.
// pick(setId) preselects (null hides it, for a life project or just pages);
// value() is what to store on the new project.
export function newWorkflow(host, hooks = {}) {
  let st = null;
  let open = false;
  let touched = false;
  const draw = () => {
    host.replaceChildren();
    host.hidden = !st;
    if (!st) return;
    host.append(make('div', 'se-label lib-new-how', 'How it gets made'));
    host.append(setChips(st, (id) => { touched = touched || id !== st.editing; st.editing = id; draw(); }));
    if (open) { host.append(stepsAndTools(st, draw, hooks)); return; }
    const set = setById(st.editing);
    const line = make('div', 'se-preview');
    const tools = st.tools[st.editing].map((id) => TOOLS.find((x) => x.id === id).label);
    line.append(make('span', 'se-steps', st.lists[st.editing].map((r) => r.name).join(' › ')));
    line.append(make('span', 'hint', tools.length ? `Make: ${tools.join(', ')}` : `Nothing to set up on Make${set.id === 'book' ? ' yet' : ''}`));
    const c = make('button', 'ghost-btn se-customize', 'Customize');
    c.addEventListener('click', () => { open = true; touched = true; draw(); host.querySelector('.se-name')?.focus(); });
    line.append(c);
    host.append(line);
  };
  return {
    pick(setId, { force = false } = {}) {
      if (!setId) { st = null; open = false; touched = false; draw(); return; }
      if (st && touched && !force) return;
      st = workflowState({ fields: {} }, setId);
      open = false;
      if (force) touched = false;
      draw();
    },
    reset() { st = null; open = false; touched = false; draw(); },
    value() {
      if (!st) return null;
      const { stageLists, toolLists } = listsToSave(st);
      return { set: st.editing, stageLists, toolLists };
    }
  };
}
