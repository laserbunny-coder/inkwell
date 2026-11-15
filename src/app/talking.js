// Capture (talk, and it lands on today's page) and walk and talk (say it,
// and it lands where you are).
import { putEntries, children, getEntry, byKind, isTrashed } from '../db.js';
import { popMenu, ask, askText, showCopy, toast } from '../menu.js';
import { noteTypes } from '../model.js';
import { MAX_BYTES } from '../files.js';
import { titleOf, dayId } from '../notebook.js';
import { taskHint } from '../pages.js';
import { CaptureScreen, writeOutPending, writeOutAgain, requeueBlank } from '../capture.js';
import { onVoiceChip, switchVoice, voiceText, voiceInfo, knownModes, fetchModes, placeDraft, placeVoice, placeScribeWaiting, RAW } from '../voice.js';
import { takeShares, snapshotPending } from '../share.js';
import { meetingPending, addMeetingFile, meetingFromLine, audioOn, renameSpeaker, speakersOn, mine, sendMeetingToAcro } from '../meeting.js';
import { DayReview } from '../review.js';
import { TagsPage } from '../tags.js';
import { DeskPage } from '../desk.js';
import { ProjectPage } from '../projectpage.js';
import { Plan, tabFor, isCal } from '../plan.js';
import { Through } from '../through.js';
import { looseOn } from '../loose.js';
import { addTask, stepsHome, loadTasks, dayPlan } from '../tasks.js';
import { readNow, nowSide, setNowSide } from '../now.js';
import { NowStrip } from '../nowstrip.js';
import { writeThought, fileThought, waitingThoughts } from '../thoughts.js';
import { dayBody, layOutDay, writeClose } from '../dayends.js';
import { ensureTrainingLine, seedTraining, TRAINING_PAGE } from '../training.js';
import { inPane, host as paneHost } from '../panes.js';
import { aheadSource } from '../ahead.js';
import { events as calendarEvents } from '../calendar.js';
import { bookType, bookOf } from '../library.js';
import { isoToday } from '../dates.js';
import { addCommands } from './commandlist.js';
import { $, editor, inNotebook, root, state, store, view } from '../main.js';
import { touch } from './scriptbar.js';
import { currentEditor, notebook } from './notebookview.js';
import { go, historyMode, lastPlace, openEntry, placeOf, setHistoryMode } from './routing.js';
import { applyRemote, caretAfter, setCaretAfter, sync } from './syncwiring.js';
import { nextDate, renderWorld } from './libraryview.js';
import { frame, nav } from './workpages.js';
import { hidden, setShown } from './pagesettings.js';
import { writing } from './commands.js';
import { closePalette, menuSpot, showTidy } from './quickinserts.js';
import { openBeside, openEntryBeside, openInMain, openTalk, pull, pullFromProject } from './beside.js';
let tagsPage = null; // the Tags page (set up with capture, below)
let deskPage = null; // the Desk: every project, what needs you (below)
let plan = null; // the plan: tasks by day, on a day's page and as Week and Pace (below)
let nowStrip = null; // the strip that travels: the one thing, away from Today (below)
let projectPage = null; // what a project's page borrows from the Desk (below)
let through = null; // Go through: loose lines and the Desk's calls, one at a time (below)
let dayReview = null; // the day review under a day page (set up with capture, below)

// ---------- capture: talk, and it lands on today's page ----------

const askServer = (body) => (window.__claude ? window.__claude(body) : sync.invoke('inkwell', body));
const canAskServer = () => !!window.__claude || (!!sync.user && navigator.onLine && !!sync.backend?.invoke);
// Until writing-out is set up, the recording's chip says so; nothing else nags.
// Once a session, after the first sync: recordings from the last week that
// came back with no words (and so were never written up) get another go.
let blankChecked = null;
function blankOnce() {
  blankChecked ||= requeueBlank().catch((e) => { console.warn(e); return 0; });
  return blankChecked;
}
// Recordings Scribe kept here (its mode has "Keep in Inkwell" on) arrive by
// sync with their words; each sync, any not written up yet are, like a Capture.
let scribing = null;
function scribeKept() {
  scribing ||= placeScribeWaiting().then((rows) => (rows.length ? applyRemote(rows) : null)).catch((e) => console.warn(e)).finally(() => { scribing = null; });
  return scribing;
}
// Ctrl + K on a recording's line: write it out again.
async function writeLineOutAgain() {
  const id = notebook.currentLine();
  if (!id || !(await writeOutAgain(id))) { toast('Put the cursor on a line with a recording on it.'); return; }
  toast('Writing it out again…');
  writeOut();
}
function writeOut() {
  const opts = { ask: askServer, canAsk: canAskServer, onRows: (rows) => applyRemote(rows).then(() => fileSaid(rows)), typing: (id) => notebook.typingOn(id) };
  return Promise.all([writeOutPending({ ...opts, draft: { context: draftContext, deliver: deliverDraft } }), snapshotPending(opts), meetingPending({ ...opts, ...meetingOpts })]);
}
// ---------- out of your head (Now's line, Part 3) ----------

// A thought typed on Now: on today's page at once, filed in the background.
async function thoughtFromNow(text) {
  const got = await writeThought(text);
  if (!got) return;
  await applyRemote(got.rows);
  toast('On today’s page', { label: 'Show', run: () => go({ view: 'notebook', pageId: got.line.parent_id, line: got.line.id }) });
  fileSoon(got.line.id);
}
// Filed one at a time, in the order they came.
let filing = Promise.resolve();
function fileSoon(id, { dump = false } = {}) {
  if (!canAskServer()) return filing;
  filing = filing.then(() => fileThought(id, { ask: askServer, items: plan?.items || [], today: isoToday(), dump, wrote: (rows) => applyRemote(rows).then(() => notebook.redrawMarks()), toast })).catch((e) => console.warn(e));
  return filing;
}
// Today's thoughts that didn't get an answer (offline): once there's a way to ask.
async function fileWaiting() {
  if (!canAskServer()) return;
  for (const r of await waitingThoughts(isoToday())) fileSoon(r.id);
}
// Said into Now's mic: once it's written out, it's filed like a typed one.
let nowMic = false; // true (a thought) or 'day' (the morning talk)
async function micFromNow(kind) {
  nowMic = kind === 'day' ? 'day' : true;
  await openCapture({ into: null });
}
function fileSaid(rows) {
  for (const r of rows) {
    if (r.kind === 'line' && !r.deleted && r.fields?.thought?.state === 'voice' && String(r.fields?.voice?.raw || '').trim()) {
      const kept = { ...r, fields: { ...r.fields, thought: { ...r.fields.thought, words: String(r.fields.voice.raw).trim(), state: 'waiting' } } };
      putEntries([kept]).then(() => fileSoon(kept.id));
    }
    // Said into the morning talk: the words go into its box.
    if (r.kind === 'line' && !r.deleted && r.fields?.dayTalk === 'voice' && String(r.fields?.voice?.raw || '').trim()) {
      const kept = { ...r, fields: { ...r.fields, dayTalk: 'used' }, updated_at: Date.now() };
      putEntries([kept]).then(() => { plan?.now.heardWords(String(r.fields.voice.raw)); toast('Your words are in the box'); });
    }
  }
}
// "Keep it on the page": a brain dump on a day's page, its loose lines filed (never a plan change).
async function keepOnPage(day) {
  if (!canAskServer()) { toast('Filing needs a connection; the lines stay on the page'); return; }
  const lines = await looseOn(day);
  if (!lines.length) return;
  toast(lines.length === 1 ? 'Filing it…' : `Filing ${lines.length} lines…`);
  for (const r of lines) fileSoon(r.id, { dump: true });
  await filing;
  looseSoon();
  toast(lines.length === 1 ? 'Filed. It stays on the page too' : `Filed ${lines.length} lines. They stay on the page too`);
}

// ---------- the two ends of the day (Now, Part 4) ----------

// Morning: what he said, heard as the day and laid out at once (Undo puts
// today back). Thoughts, and a sixth big thing, go on the page and are filed.
async function talkDayFromNow(words) {
  if (!canAskServer()) return { error: 'Talking the day through needs a connection. Your words are still here.' };
  const today = isoToday();
  let out;
  try { out = await askServer(dayBody(words, { items: plan?.items || [], today, events: plan?.cal || [] })); } catch (e) { console.warn(e); out = null; }
  if (!out || out.error) return { error: `${out?.error || 'That didn’t go through.'} Your words are still here.` };
  const laid = await layOutDay(out, { items: plan.items, today });
  await plan.wrote(laid.rows);
  const written = [];
  for (const t of laid.page) {
    const got = await writeThought(t);
    if (got) { written.push(got.line.id); await applyRemote(got.rows); }
  }
  for (const id of written) fileSoon(id, { dump: true });
  toast(out.said || 'Here is the day as I heard it', {
    label: 'Undo',
    run: async () => {
      const back = [];
      for (const u of [...laid.undo].reverse()) back.push(...(await u()));
      await plan.wrote(back);
      if (plan.now.mode === 'heard') plan.now.mode = null;
      await plan.now.save({ laid: false });
      plan.redraw();
      toast(written.length ? 'Today is back as it was. What went to the page stays there' : 'Today is back as it was');
    }
  });
  return { page: laid.page.length, added: laid.added };
}
// Evening: written on today's page under "Close of the day"; the first thing
// for tomorrow goes to the top of tomorrow.
async function closeDayFromNow(answers) {
  const today = isoToday();
  const got = await writeClose(answers, { items: plan?.items || [], today });
  await applyRemote(got.rows.filter((r) => r !== got.first));
  if (got.first) await plan.wrote([got.first]);
  else await plan.refresh();
  const first = got.first ? ` “${got.first.text}” is first tomorrow.` : '';
  toast(`The day is closed. It’s on today’s page.${first}`, { label: 'Show', run: () => go({ view: 'notebook', pageId: `day-${today}`, line: got.line.id }) });
}
// From the 9 pm card on today's page.
async function closeDayFromCard() {
  if (!plan) return;
  await go({ view: 'plan', tab: 'now' });
  plan.now.openClose();
}

// Meetings: your tasks become tasks here (a business one goes to Acro HQ).
const meetingOpts = {
  me: () => sync.user?.user_metadata?.full_name || sync.user?.user_metadata?.name || '',
  base: () => location.origin + location.pathname,
  onDone: (it, notes, to) => {
    const sent = to === 'acro' ? notes.tasks.length : notes.tasks.filter((t) => mine(t.owner, meetingOpts.me())).length;
    const where = to === 'acro' ? 'Acro HQ' : 'your plan';
    toast(`Meeting notes ready: ${notes.title}${sent ? ` (${sent} task${sent === 1 ? '' : 's'} to ${where})` : to === 'acro' ? ' (sent to Acro HQ)' : ''}`, { label: 'Open', run: () => openEntry(`pg_meet-${it.file}`) });
  }
};
// Ctrl+K on a meeting page: send it (again) to Acro HQ, as the page stands now.
async function meetingToAcro() {
  const pid = notebook.page?.id;
  await notebook.close();
  try {
    const rows = await sendMeetingToAcro(pid, { ask: askServer, base: location.origin + location.pathname });
    await applyRemote(rows);
    toast('Sent to Acro HQ');
  } catch (e) {
    toast(e.code === 'no-acro' ? 'Sending to Acro HQ isn’t set up yet' : canAskServer() ? 'Couldn’t reach Acro HQ. Try again in a minute' : 'Go online and sign in to send it');
  }
}
// Ctrl+K: the recording on this line becomes a meeting, or pick a recording file.
async function makeMeeting() {
  const id = inNotebook() ? notebook.currentLine() : null;
  const line = id ? await getEntry(id) : null;
  if (audioOn(line)) {
    await notebook.close();
    await meetingFromLine(line.id);
    toast(canAskServer() ? 'Writing out the meeting…' : 'It’ll be written out once you’re online and signed in');
    writeOut();
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*,.m4a,.mp3,.wav,.webm,.ogg,.aac';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    await Promise.all([store.close(editor.state.doc), notebook.close()]);
    const added = await addMeetingFile(file);
    if (!added) { toast(`“${file.name}” is over ${Math.round(MAX_BYTES / 1048576)} MB. In Voice Recorder, set Recording quality lower and record again`); return; }
    await applyRemote(added.rows);
    await go({ view: 'notebook', pageId: added.line.parent_id, line: added.line.id });
    toast(canAskServer() ? 'Writing out the meeting…' : 'It’ll be written out once you’re online and signed in');
    writeOut();
  });
  input.click();
}
async function fixSpeaker() {
  const pid = notebook.page?.id;
  const names = await speakersOn(pid);
  popMenu(null, names.map((from) => ({ label: from, run: async () => {
    const to = await askText({ title: `Rename ${from}`, body: 'Every line they said gets the new name.', value: from, ok: 'Rename' });
    if (!to || to === from) return;
    await notebook.close();
    await applyRemote(await renameSpeaker(pid, from, to));
  } })), menuSpot());
}
// A link from anywhere to ?open=<id> opens that line where it
// lives, once this device has it.
let asking = null;
function setAsking(value) { return (asking = value); }
async function openAsked() {
  if (!asking) return;
  const row = await getEntry(asking);
  if (!row) return;
  asking = null;
  openEntry(row.id);
}
// Things shared into Inkwell from other apps land on today's page, with the
// caret at the end of the last one (Enter starts a line under it).
let landing = null;
// `quiet` (a link saved from the browser while you're working here): it goes
// on today's page without taking you away from where you are.
function landShares({ quiet = false } = {}) {
  landing ||= landSharesNow(quiet).finally(() => { landing = null; });
  return landing;
}
async function landSharesNow(quiet = false) {
  const skipped = [];
  const added = await takeShares(skipped).catch((e) => { console.error(e); return []; });
  if (skipped.length) toast(`“${skipped[0]}” is over ${Math.round(MAX_BYTES / 1048576)} MB, too big to keep. For meetings, set Voice Recorder’s Recording quality lower`);
  if (!added.length) return;
  const last = added.at(-1);
  if (quiet) {
    await applyRemote(added.flatMap((a) => a.rows));
    const show = { label: 'Show', run: () => go({ view: 'notebook', pageId: last.line.parent_id, line: last.line.id }) };
    toast(added.length === 1 ? `Saved to today’s page: ${last.line.text || 'the link'}` : `${added.length} links saved to today’s page`, show);
    writeOut();
    return;
  }
  await Promise.all([store.close(editor.state.doc), notebook.close()]);
  await applyRemote(added.flatMap((a) => a.rows));
  await go({ view: 'notebook', pageId: last.line.parent_id, line: last.line.id });
  toast(added.length === 1 ? 'Kept on today’s page' : `${added.length} things kept on today’s page`);
  writeOut();
}
// Lands a capture on today's page and shows it there.
async function showCapture({ line, rows }) {
  await applyRemote(rows);
  await go({ view: 'notebook', pageId: line.parent_id, line: line.id });
  writeOut();
}
let capture; // set in wireTalking()
// ---------- walk and talk: say it, and it lands where you are ----------

// One voice button, one rule: in a chapter Claude writes it into the draft
// just after the paragraph the caret is on; on a page it goes on that page,
// after the line you're on; anywhere else (and on a day) it goes on today.
// Today's page always gets a line for it, linking to where it went.
async function captureSpot() {
  if (writing() && state.chapterId) return draftSpot();
  const page = inNotebook() && !notebook.isDay ? notebook.page : null;
  // The title as shown (a page named a moment ago may not be saved yet).
  if (page && !page.deleted) return { page: page.id, title: $('#nb-title')?.textContent.trim() || titleOf(page), after: notebook.currentLine() };
  return null;
}
async function captureHere(opts = {}) {
  await openCapture({ ...opts, into: await captureSpot() });
}
async function draftSpot() {
  const chapter = await getEntry(state.chapterId);
  const block = editor.state.selection.$from.node(1);
  return { chapter: state.chapterId, title: chapter?.title || 'this chapter', after: block?.attrs.eid || null };
}
// Picks a recording file for Capture; it lands where you are, like talking.
async function fromRecordingFile() {
  // The file picker needs this tap, so it opens first and Capture follows.
  const into = await captureSpot();
  await openCapture({ start: false, into });
  capture.pick.click();
}
// What Claude needs to know about where the words go: the text just before,
// whether it's a script, and what's being written.
async function draftContext(into) {
  const chapter = await getEntry(into.chapter);
  if (!chapter) return {};
  const book = await bookOf(chapter);
  const kids = (await children(chapter.id)).filter((k) => k.kind === 'para' || k.kind === 'heading').sort((a, b) => a.sort - b.sort);
  const at = kids.findIndex((k) => k.id === into.after);
  const before = kids.slice(0, at >= 0 ? at + 1 : kids.length).map((k) => (k.text || '').trim()).filter(Boolean).join('\n\n').slice(-3000);
  return { before, script: !!book && bookType(book) === 'screenplay', book: [book?.title, chapter.title].filter(Boolean).join(', ') };
}
// The words land in the chapter (an open one is saved first, then refreshed).
// If the chapter's gone, they land on the day page like any capture.
async function deliverDraft(it, answer) {
  if (state.chapterId === it.into.chapter) await store.flush(editor.state.doc);
  const { script } = await draftContext(it.into);
  const types = await noteTypes();
  const rows = await placeDraft({ ...it.into, line: it.line }, answer, { script, noteType: types[0]?.id || null });
  const line = await getEntry(it.line);
  const raw = String(answer.raw || '').trim();
  if (rows === null) return placeVoice(it, answer, {});
  if (line && raw) {
    const kept = { ...line, fields: { ...line.fields, voice: { raw, mode: answer.mode || 'scene', into: it.into.chapter } }, updated_at: Date.now() };
    await putEntries([kept]);
    rows.push(kept);
  }
  const first = rows.find((r) => r.kind === 'para');
  // Still on the spot you talked into: carry on writing after what you said.
  const here = state.chapterId === it.into.chapter && editor.state.selection.$from.node(1)?.attrs.eid;
  if (here && (here === it.into.after || !it.into.after)) setCaretAfter(rows.filter((r) => r.kind === 'para' && !r.deleted && r.fields?.voice).at(-1)?.id || null);
  if (first) toast(`Your words are in “${it.into.title || 'the draft'}”`, state.chapterId === it.into.chapter ? null : { label: 'Show', run: () => openEntry(first.id) });
  else if (raw === '') toast('Nothing was heard in that recording');
  return rows;
}
// "Written out by ElevenLabs", or by the backup when ElevenLabs came back blank.
const SERVICE = { elevenlabs: 'ElevenLabs', openai: 'OpenAI (the backup)' };
function heardNote({ by, tried }) {
  const blank = (tried || []).some((t) => /^elevenlabs.*: (no words|failed)/.test(t));
  return `Written out by ${SERVICE[by] || by}${by === 'openai' && blank ? ', ElevenLabs came back blank' : ''}`;
}

// Your modes, the same ones Scribe uses: rename one, change what it does or
// which Claude writes it, add one, or delete one.
async function openModes(anchor = $('#palette-toggle')) {
  if (!canAskServer()) { toast('Your modes live on your account; sign in and get online to change them'); return; }
  let modes;
  try { modes = await fetchModes(askServer); } catch { toast('Couldn’t reach your modes. Try again.'); return; }
  const save = async (item) => {
    try {
      const out = await askServer({ mode: 'voice-save-mode', item });
      if (out?.error) throw new Error(out.error);
      await fetchModes(askServer);
      toast(`Saved “${item.name}”. Scribe has it too.`);
    } catch (e) { toast(e.message || 'Couldn’t save that mode. Try again.'); }
  };
  const CLAUDES = [['haiku', 'Haiku: quick, for light jobs'], ['sonnet', 'Sonnet: everyday writing'], ['opus', 'Opus: when the writing matters']];
  popMenu(anchor, [
    { note: 'Your modes, shared with Scribe' },
    ...modes.map((m) => ({ label: m.name, sub: [
      { label: 'Rename…', run: async () => { const name = await askText({ title: 'Rename this mode', value: m.name }); if (name && name !== m.name) save({ ...m, name }); } },
      { label: 'What it does…', run: async () => { const prompt = await askText({ title: `What ${m.name} does`, body: 'In plain words, how what you say gets written up.', value: m.prompt || '' }); if (prompt !== null && prompt !== m.prompt) save({ ...m, prompt }); } },
      { label: 'Which Claude writes it', sub: CLAUDES.map(([id, label]) => ({ label, current: m.model === id, run: () => save({ ...m, model: id }) })) },
      'sep',
      { label: 'Delete', danger: true, run: async () => {
        if (!(await ask({ title: `Delete “${m.name}”?`, body: 'It goes from Scribe too. Anything already written up with it stays as it is.', ok: 'Delete', danger: true }))) return;
        const out = await askServer({ mode: 'voice-delete-mode', id: m.id }).catch((e) => ({ error: e.message }));
        if (out?.error) { toast(out.error); return; }
        await fetchModes(askServer);
        toast(`Deleted “${m.name}”`);
      } }
    ] })),
    'sep',
    { label: 'New mode…', run: async () => {
      const name = await askText({ title: 'New mode', placeholder: 'Like “Pitch” or “Lyrics”', ok: 'Next' });
      if (!name) return;
      const prompt = await askText({ title: `What ${name} does`, body: 'In plain words, how what you say gets written up.', ok: 'Add' });
      if (prompt) save({ name, prompt, model: 'opus' });
    } }
  ]);
}

async function openCapture(opts) {
  if (!$('.palette').hidden) closePalette(false);
  // Anything typed is saved first, so the new line can't clash with it.
  await Promise.all([store.close(editor.state.doc), notebook.close()]);
  capture.show(opts);
}
// The Desk: every project with what needs you and who's working on it, and
// History, every Claude thread there has been. Calls and updates live in
// Daybook's side of the database.
const deskBackend = () => window.__desk || (sync.user && sync.backend?.desk ? sync.backend : null);
// A call was answered or set aside, here or in a pane: whatever shows calls looks again.
function callsChanged() {
  projectPage?.stale();
  if (view() === 'world') renderWorld();
  else if (view() === 'desk') deskPage.load({ quiet: true });
  else deskPage.peek();
}
// Under a recent day's lines: how many are still loose, and the way in.
let looseTimer = 0;
function looseSoon() { clearTimeout(looseTimer); looseTimer = setTimeout(looseFoot, 250); }
async function looseFoot() {
  const foot = $('#loose-foot');
  if (!foot) return;
  const page = inNotebook() && notebook.looseDay ? notebook.page : null;
  const n = page ? (await looseOn(page.title)).length : 0;
  // The page changed while counting: the newer count wins.
  if ((inNotebook() && notebook.looseDay ? notebook.page.id : null) !== (page?.id || null)) return looseFoot();
  foot.hidden = !n;
  if (!n) { foot.replaceChildren(); return; }
  if (foot.dataset.n === String(n) && foot.firstChild) return;
  foot.dataset.n = String(n);
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = n === 1 ? 'Go through it' : 'Go through them';
  b.title = 'One at a time: a task, a project, the Drawer, or just a note for the day';
  b.addEventListener('click', () => through.open('loose'));
  const words = document.createElement('span');
  words.textContent = n === 1 ? '1 loose line' : `${n} loose lines`;
  // Or file them all at once, as a brain dump: they stay on the page too.
  const keep = document.createElement('button');
  keep.type = 'button';
  keep.className = 'loose-keep';
  keep.textContent = 'Keep it on the page';
  keep.title = 'Claude files each line where it belongs (the Drawer, Not planned, the Workshop, To look up); the lines stay here as you wrote them';
  keep.addEventListener('click', () => keepOnPage(page.title));
  foot.replaceChildren(document.createElement('i'), words, b, ...(hidden().has('nowout') ? [] : [keep]));
}
// Today's views, for Alt + 1 to 4: Now, Page, Plan, Calendar.
function todayKey(n) {
  if (n === 1) return go({ view: 'plan', tab: 'now' });
  if (n === 2) return touch.matches ? plan.goTab('page') : go({ view: 'notebook', pageId: dayId(isoToday()) });
  if (n === 3) return touch.matches ? plan.goTab('plan') : go({ view: 'plan', tab: 'plan' });
  return view() === 'plan' && isCal(tabFor(lastPlace?.tab)) ? plan.stepZoom() : plan.goTab('cal');
}
// Where Today opens: on Now when something is current or today has open
// tasks; otherwise on today's page, as before.
async function todayOpensOnNow() {
  try { if (localStorage.getItem('todayOpens') === 'page') return false; } catch { /* no storage here */ }
  const [st, items] = await Promise.all([readNow(), loadTasks()]);
  if (st.task) return true;
  const p = dayPlan(items, isoToday(), isoToday());
  return p.todo.some((i) => !i.ghost);
}
async function openToday() {
  if (await todayOpensOnNow()) return go({ view: 'plan', tab: 'now' });
  return go({ view: 'notebook', pageId: dayId(isoToday()) });
}
function inToday() {
  if (view() === 'plan') return true;
  return inNotebook() && !!notebook.page && notebook.isDay && !notebook.zoom;
}
// The plan beside today's page (on a wide enough computer) or on top of it in
// one column, as on a phone. Kept on this device.
const planLayout = () => (hidden().has('planside') ? 'top' : 'side');
function flipPlan() {
  // On Now: the one thing on the left and the day as a line on the right, or one column.
  if (view() === 'plan' && tabFor(lastPlace?.tab) === 'now') {
    const on = !nowSide();
    setNowSide(on);
    plan.redraw();
    toast(on ? 'The day sits beside the one thing (Alt + P: one column)' : 'One column (Alt + P puts the day beside)');
    return;
  }
  const was = planLayout();
  const y = document.scrollingElement?.scrollTop || 0;
  setShown('planside', was !== 'side');
  plan.redraw();
  if (document.scrollingElement) document.scrollingElement.scrollTop = y;
  if (view() === 'notebook' && notebook.isDay) toast(was === 'side' ? 'The plan is on top of the page (Alt + P puts it beside)' : 'The plan is beside the page (Alt + P puts it on top)');
}

// Its commands in the box (Ctrl + K); commandinfo.js has their hints and words.
addCommands(() => [
  { group: 'go', label: 'Now: the one thing you’re on', keys: 'Alt+1', words: ['now', 'one thing', 'focus', 'current', 'today', 'next'], run: () => todayKey(1) },
  { group: 'go', label: 'Today: today’s page with its plan', keys: 'Alt+2', words: ['today', 'plan', 'day', 'tasks', 'page'], run: () => todayKey(2) },
  { group: 'go', label: 'Bring earlier days to today (every task left from before, onto today)', keys: 'Alt+Shift+T', words: ['carried', 'earlier', 'overdue', 'late', 'move', 'today', 'left over'], run: () => plan.bringToday() },
  { group: 'go', label: 'Plan: today, tomorrow, this week, next week, this month, later, not planned', keys: 'Alt+2', words: ['what’s when', 'whats when', 'when', 'planning', 'schedule', 'later', 'month', 'next week', 'loose', 'not planned', 'outline'], run: () => todayKey(3) },
  { group: 'new', label: 'Capture an idea by voice (it lands where you are)', keys: '⌥C', words: ['dictate', 'voice', 'walk', 'speak', 'talk', 'draft'], run: () => captureHere() },
  { group: 'new', label: 'Capture from a recording file…', words: ['audio', 'voice memo', 'upload', 'draft'], run: () => fromRecordingFile() },
  { group: 'write', label: 'Your voice modes (shared with Scribe)…', words: ['journal', 'scene', 'idea', 'email', 'mode'], run: () => openModes() },
  { group: 'plan', label: 'Now: Done with the one thing', keys: 'D', words: ['done', 'finished', 'tick', 'check', 'now', 'one thing'], run: () => plan.now.done(), when: onNow },
  { group: 'plan', label: 'Now: Not now (later today, enough for today, another day)', keys: 'N', words: ['not now', 'later', 'tomorrow', 'set aside', 'postpone', 'another day', 'worked on'], run: () => { plan.now.asking = true; plan.redraw(); }, when: () => onNow() && !!plan.now.model().cur },
  { group: 'plan', label: 'Now: Begin the next thing', keys: 'B', words: ['begin', 'start', 'next', 'go', 'now', 'gate'], run: () => { const m = plan.now.model(); if (m.cand) plan.now.begin(m.cand.group ? 'smalls' : m.cand.item.row.id); }, when: () => onNow() && !plan.now.model().cur },
  { group: 'go', label: 'Training: the sessions and their exercises', words: ['training', 'workout', 'exercise', 'sessions', 'calisthenics', 'parkour', 'handstand', 'front lever', 'vertical'], run: async () => { await seedTraining(); openEntry(TRAINING_PAGE); }, when: () => !hidden().has('training') },
  { group: 'plan', label: 'Talk the day through (what is in front of you today)', words: ['morning', 'talk', 'day', 'lay out', 'plan the day', 'say', 'brain dump', 'start', 'now'], run: async () => { await go({ view: 'plan', tab: 'now' }); plan.now.openTalk(); }, when: () => !!plan && !hidden().has('nowtalk') },
  { group: 'plan', label: 'Close the day (what you did, two questions, first thing tomorrow)', words: ['evening', 'close', 'end', 'day', 'reflect', 'journal', 'done', 'tomorrow', 'shutdown', 'wrap up'], run: () => closeDayFromCard(), when: () => !!plan && !hidden().has('nowclose') },
  { group: 'plan', label: 'Now: what is next today (show or hide the list)', keys: 'Space', words: ['next', 'list', 'more today', 'choose another', 'queue', 'what is next'], run: () => { plan.now.listOpen = !plan.now.listOpen; plan.redraw(); }, when: onNow },
  { group: 'plan', label: 'Now: the day beside the one thing, or one column', keys: 'Alt+P', words: ['side by side', 'column', 'beside', 'layout', 'flip', 'now'], run: () => flipPlan(), when: () => onNow() && !touch.matches },
  { group: 'view', label: 'Plan beside the page, or on top in one column', keys: 'Alt+P', words: ['plan', 'side', 'column', 'top', 'layout', 'flip'], run: () => flipPlan(), when: () => !touch.matches },
  { group: 'go', label: 'Go through loose lines: the last week’s unfiled lines, one at a time', words: ['sort', 'file', 'loose', 'triage', 'review', 'inbox', 'tidy'], run: () => through.open('loose') },
  { group: 'go', label: 'Go through the tasks left from earlier days: keep, not today, or delete', words: ['carried', 'overdue', 'old tasks', 'pile', 'triage', 'clear'], run: () => through.open('carried') },
  { group: 'go', label: 'Go through what needs you: the Desk’s calls, one at a time', words: ['calls', 'needs you', 'decide', 'desk', 'triage', 'waiting'], run: () => through.open('calls') },
  { group: 'tidy', label: 'Review the day with Claude (what to plan, what to keep thinking about)', keys: '', run: () => dayReview.run(), when: () => inNotebook() && notebook.isDay },
  { group: 'new', label: 'Make meeting notes from a recording (summary, decisions, tasks, who said what)…', keys: '', run: () => setTimeout(makeMeeting, 120) },
  { group: 'tidy', label: 'Send this meeting to Acro HQ (summary and tasks, for you and Nate)', keys: '', run: () => setTimeout(meetingToAcro, 120), when: () => inNotebook() && !!notebook.page?.fields?.meeting && canAskServer() },
  { group: 'tidy', label: 'Fix a speaker’s name in this meeting…', keys: '', run: () => setTimeout(fixSpeaker, 120), when: () => inNotebook() && !!notebook.page?.fields?.meeting },
  { group: 'tidy', label: 'Write out this recording again', keys: '', words: ['transcribe', 'voice', 'retry', 'audio'], run: writeLineOutAgain, when: () => inNotebook() && !!notebook.currentLine() && canAskServer() }
]);

function onNow() { return view() === 'plan' && tabFor(lastPlace?.tab) === 'now'; }

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wireTalking() {
  capture = new CaptureScreen($('.capture'), {
    onSaved: async (saved) => {
      // Said into Now's mic: it goes on today's page and you stay on Now.
      if (nowMic === 'day' && !saved.line.fields?.into) {
        nowMic = false;
        const kept = { ...saved.line, fields: { ...saved.line.fields, dayTalk: 'voice', sorted: true } };
        await putEntries([kept]);
        await applyRemote([...saved.rows.filter((r) => r.id !== kept.id), kept]);
        toast('Kept. Your words go into the box once they’re written out');
        writeOut();
        return;
      }
      if (nowMic && !saved.line.fields?.into) {
        nowMic = false;
        const kept = { ...saved.line, fields: { ...saved.line.fields, thought: { words: '', state: 'voice' } } };
        await putEntries([kept]);
        await applyRemote([...saved.rows.filter((r) => r.id !== kept.id), kept]);
        toast('On today’s page. It’s filed once it’s written out');
        writeOut();
        return;
      }
      nowMic = false;
      // Aimed at the draft: you stay where you were writing, and the words follow.
      if (saved.line.fields?.into?.chapter) { toast('Kept. Claude is writing it into the draft…'); applyRemote(saved.rows).then(() => { if (writing()) editor.commands.focus(); writeOut(); }); return; }
      toast(saved.line.parent_id?.startsWith('day-') ? 'Kept on today’s page' : 'Kept here, and noted on today’s page');
      showCapture(saved);
    },
    onClose: () => { if (!onNow()) currentEditor().commands.focus(); },
    toast
  });
  // Thoughts that waited for a connection get filed once there is one.
  window.addEventListener('online', () => fileWaiting());
  setTimeout(() => fileWaiting(), 4000);
  // A tap on a capture's mode chip: the same words in another mode, or word for word.
  onVoiceChip(async (lineId, chip) => {
    const info = await voiceInfo(lineId);
    if (!info) return;
    const modes = await knownModes();
    if (canAskServer()) fetchModes(askServer).catch(() => {});
    const use = (id, name) => async () => {
      if (id === info.mode) return;
      if (!info.made.includes(id) && !canAskServer()) { toast('Writing it up another way needs a connection'); return; }
      await notebook.close();
      if (!info.made.includes(id)) toast(`Writing it up as ${name}…`);
      try {
        await applyRemote(await switchVoice(lineId, id, askServer));
      } catch (e) { console.error(e); toast(e.message || 'Claude couldn’t write it up that way this time'); }
    };
    popMenu(chip, [
      { label: 'Word for word', current: info.mode === RAW, run: use(RAW, 'Word for word') },
      ...modes.map((m) => ({ label: m.name, current: info.mode === m.id, run: use(m.id, m.name) })),
      'sep',
      { label: 'Copy this version', run: async () => { await notebook.close(); const t = await voiceText(lineId); try { await navigator.clipboard.writeText(t); toast('Copied, ready to paste'); } catch { showCopy({ title: 'Copy this version', value: t }); } } },
      { label: 'Change your modes…', run: () => openModes() },
      ...(info.by ? ['sep', { note: heardNote(info), plain: true }] : [])
    ]);
  });
  if (!inPane) window.addEventListener('online', () => writeOut());
  // The day review: Claude sums up a day's page and sorts what's on it, and you
  // decide each thing (a task, keep thinking, split, let go).
  dayReview = new DayReview($('.day-review'), {
    card: $('.evening-card'),
    closed: () => !!plan?.now?.st?.closed || hidden().has('nowclose'),
    closeDay: () => closeDayFromCard(),
    ask: askServer,
    canAsk: canAskServer,
    base: () => location.origin + location.pathname,
    onRows: (rows) => applyRemote(rows),
    onOpen: (id) => openEntry(id),
    toast
  });
  // The day closed on Now: the 9 pm card stops offering it.
  document.addEventListener('inkwell:now', () => dayReview?.renderCard());
  $('.tidy-nudge').addEventListener('click', () => showTidy());
  // The Tags page: every tag, grouped, merged and gone through one by one.
  tagsPage = new TagsPage({
    sheet: $('#tags-sheet'),
    go: async (place, { replace = false } = {}) => {
      const mode = historyMode;
      if (replace) setHistoryMode('replace');
      try { await go(place); } finally { setHistoryMode(mode); }
    },
    open: (id) => openEntry(id),
    ask: askServer,
    canAsk: canAskServer,
    changed: (rows) => applyRemote(rows),
    toast
  });
  deskPage = new DeskPage({
    sheet: $('#desk-sheet'),
    fetch: (since) => { const b = deskBackend(); return b ? b.desk(since) : null; },
    fetchAll: () => { const b = deskBackend(); return b ? b.deskAll() : null; },
    done: (id) => deskBackend().doneNeed(id),
    later: (id, until) => deskBackend().laterNeed(id, until),
    ask: askServer,
    canAsk: canAskServer,
    open: (id) => openEntry(id),
    go: (place) => go(place),
    base: () => location.origin + location.pathname,
    changed: (rows) => applyRemote(rows),
    onCount: (n) => { frame.count(n); nav.count(n); },
    // The Desk's order changed (a drag, or what's on stage): the rail follows.
    ordered: () => frame.drawProjects(),
    // "Add one" under "No next step yet": the project's Steps page, the caret on a new step.
    addStep: async (id) => {
      const world = await getEntry(id);
      if (!world) return;
      const rows = await addTask({ text: '', home: stepsHome(world) });
      await applyRemote(rows);
      await openEntry(rows.at(-1).id);
    },
    through: () => through.open('calls'),
    // A call answered from a project's own page: that page looks again.
    acted: () => { projectPage?.stale(); if (view() === 'world') renderWorld(); },
    // ✦ Talk it through, from the Desk's head (not from inside a pane, and not with Beside off).
    talk: () => (inPane || !paneHost() || root.classList.contains('hide-panes') ? null : () => openTalk()),
    toast
  });
  if (!inPane) window.__callsChanged = callsChanged;
  // A project's own page borrows the Desk: its seat, north star, calls, crew
  // and turns (projectpage.js).
  projectPage = new ProjectPage({ seat: $('#wh-seat'), facts: $('#wh-facts'), calls: $('#wh-calls'), crew: $('#wh-crew'), turns: $('#wh-turns') }, {
    fetch: (since) => { const b = deskBackend(); return b ? b.desk(since) : null; },
    // Answering a call here is the Desk answering it; then both look again.
    call: (c, now) => deskPage.call(c, now, () => false),
    go: (place) => go(place),
    history: (name) => { deskPage.filter = 'all'; deskPage.query = name; go({ view: 'desk', tab: 'history' }); },
    changed: (rows) => applyRemote(rows),
    showing: (id) => view() === 'world' && state.worldId === id
  });
  // Go through (through.js): the last week's loose lines, or the Desk's calls,
  // one card at a time.
  through = new Through({
    toast,
    changed: (rows) => applyRemote(rows),
    worlds: async () => (await byKind('world')).filter((w) => !w.deleted && !isTrashed(w) && !w.fields?.finished).sort((a, b) => b.updated_at - a.updated_at).map((w) => ({ id: w.id, title: w.title || 'Untitled' })),
    calls: { list: () => deskPage.waiting(), done: (id) => deskPage.callDone(id), later: (id) => deskPage.callLater(id) },
    // Tasks left on today from earlier days: keep, take off the day, or delete.
    carried: { list: () => plan.carriedList(), answer: (it, how) => plan.carriedAnswer(it, how) },
    onClose: () => { looseFoot(); plan?.soon(); }
  });
  // The plan: tasks gathered by day (plan.js). On a day's page it sits on top;
  // Week and Pace are their own page.
  plan = new Plan({
    box: $('#plan'),
    sheet: $('#plan-sheet'),
    steps: $('#wh-steps'),
    hooks: {
      stepHint: (w) => taskHint(w),
      view,
      changed: (rows) => applyRemote(rows),
      // Beside, a task's place opens in the main window and the plan stays.
      openEntry: (id) => (inPane && view() === 'plan' ? openInMain(id) : openEntry(id)),
      beside: (id) => (inPane || root.classList.contains('hide-panes') || !paneHost() ? null : () => openEntryBeside(id)),
      // A click on a task zooms into it, as an outliner does: the task becomes
      // the page, its lines under it (the cursor on `line`, if given), and Back
      // (Alt + Left) comes out to the plan. Ctrl + click and the menu open it beside.
      openTask: async (id, line = null, { beside = false } = {}) => {
        const at = await placeOf(id);
        if (!at) return;
        const place = at.view === 'notebook' && at.line ? { view: 'notebook', pageId: at.pageId, zoom: at.line, ...(line ? { line } : {}) } : at;
        if (beside && !inPane && !root.classList.contains('hide-panes') && paneHost()) return openBeside(place);
        if (inPane && view() === 'plan') return paneHost()?.hooks.goMain(place);
        return go(place);
      },
      go: (place) => go(place),
      goThrough: () => through.open('carried'),
      off: (name) => hidden().has(name),
      show: (name, on) => setShown(name, on),
      // Beside or on top: only where there's room for beside (a computer, 1100 px and wider).
      layout: () => (inPane || touch.matches || !matchMedia('(min-width: 1100px)').matches ? null : planLayout()),
      flip: () => flipPlan(),
      // A project's steps were drawn again: its next date may have moved.
      steps: () => { if (view() === 'world' && state.worldId) projectPage?.setDate(nextDate(state.worldId)); },
      // Weeks ahead: the lanes as the Desk seats them, and shoot days.
      ahead: () => aheadSource((since) => { const b = deskBackend(); return b ? b.desk(since) : null; }),
      talk: () => (inPane || !paneHost() || root.classList.contains('hide-panes') ? null : () => openTalk()),
      // Google Calendar, read-only, through the server's calendar function.
      calendar: (from, to) => calendarEvents((a, b) => (window.__calendar ? window.__calendar(a, b) : sync.user && sync.invoke ? sync.invoke('calendar', { timeMin: a, timeMax: b }) : null), from, to),
      // Pull from a project: its lines open next to the plan, to drag in.
      pull: inPane ? null : () => pullFromProject(),
      pulling: () => !!pull?.isOpen,
      floor: () => pull?.floor() || 0,
      redrawn: () => { pull?.soon(); nowStrip?.soon(); },
      thought: (text) => thoughtFromNow(text),
      mic: (kind) => micFromNow(kind),
      talkDay: (words) => talkDayFromNow(words),
      // Training (Part 6): today's line, once a day, not on Sunday.
      daily: (items, today) => (inPane || hidden().has('training') ? [] : ensureTrainingLine(items, today)),
      closeDay: (answers) => closeDayFromNow(answers),
      toast
    }
  });
  window.__plan = plan;
  // Away from Today, the one thing travels in a thin strip (not in a pane).
  if (!inPane) window.__nowStrip = nowStrip = new NowStrip({ plan, view, inToday, go: (place) => go(place), off: (name) => hidden().has(name) });
  if (inNotebook() && notebook.page) plan.showDay(notebook.page);
}

export { nowStrip, openToday, todayOpensOnNow, askServer, asking, blankOnce, canAskServer, capture, captureHere, dayReview, deskBackend, deskPage, flipPlan, inToday, landShares, looseFoot, looseSoon, openAsked, openCapture, plan, projectPage, scribeKept, setAsking, showCapture, tagsPage, todayKey, wireTalking, writeOut };
