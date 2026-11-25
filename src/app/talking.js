// Capture (talk, and it lands on today's page) and walk and talk (say it,
// and it lands where you are).
import { putEntries, children, getEntry, byKind, isTrashed } from '../db.js';
import { popMenu, ask, askText, showCopy, toast } from '../menu.js';
import { noteTypes, entry, newId, tagsIn, outline } from '../model.js';
import { GAP } from '../order.js';
import { ensureLightLine } from '../firstlight.js';
import { MAX_BYTES } from '../files.js';
import { titleOf, dayId } from '../notebook.js';
import { taskHint } from '../pages.js';
import { CaptureScreen, writeOutPending, writeOutAgain, requeueBlank } from '../capture.js';
import { onVoiceChip, switchVoice, voiceText, voiceInfo, knownModes, fetchModes, placeDraft, placeVoice, placeScribeWaiting, RAW } from '../voice.js';
import { takeShares, snapshotPending } from '../share.js';
import { meetingPending, addMeetingFile, meetingFromLine, audioOn, renameSpeaker, speakersOn, mine, sendMeetingToAcro } from '../meeting.js';
import { TagsPage } from '../tags.js';
import { DeskPage } from '../desk.js';
import { ProjectPage } from '../projectpage.js';
import { Plan, tabFor } from '../plan.js';
import { Through } from '../through.js';
import { looseOn } from '../loose.js';
import { addTask, stepsHome, loadTasks, dayPlan } from '../tasks.js';
import { readNow } from '../now.js';
import { EventWarn } from '../eventwarn.js';
import { NowZoom } from '../nowzoom.js';
import { writeThought, fileThought, waitingThoughts } from '../thoughts.js';
import { dayBody, layOutDay, writeClose } from '../dayends.js';
import { ensureTrainingLine, seedTraining, TRAINING_PAGE } from '../training.js';
import { autoOn } from '../auto.js';
import { addonOn } from '../addons.js';
import { STUDIO } from '../edition.js';
import { saveSteps } from '../firststeps.js';
import { inPane, host as paneHost } from '../panes.js';
import { events as calendarEvents } from '../calendar.js';
import { bookType, bookOf, kindName } from '../library.js';
import { isoToday } from '../dates.js';
import { addCommands } from './commandlist.js';
import { $, editor, inNotebook, state, store, view } from '../main.js';
import { currentEditor, notebook } from './notebookview.js';
import { go, historyMode, lastPlace, openBook, openEntry, placeOf, setHistoryMode } from './routing.js';
import { applyRemote, setCaretAfter, sync } from './syncwiring.js';
import { drawNextStep, nextDate, renderWorld } from './libraryview.js';
import { frame } from './workpages.js';
import { hidden, setShown } from './pagesettings.js';
import { writing } from './commands.js';
import { closePalette, menuSpot } from './quickinserts.js';
import { openBeside, openEntryBeside, openInMain, openTalk, pull, pullFromProject } from './beside.js';
let tagsPage = null; // the Tags page (set up with capture, below)
let deskPage = null; // the Desk: every project, what needs you (below)
let plan = null; // the plan: tasks by day, on a day's page and as Week and Pace (below)
let nowZoom = null; // Next, Not now and the way back while zoomed into a task on today (nowzoom.js)
let nowStrip = null; // the warning before a lesson or meeting (eventwarn.js, below)
let projectPage = null; // what a project's page borrows from the Desk (below)
let through = null; // Go through: loose lines and the Desk's calls, one at a time (below)

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
const queued = new Set(); // a thought already on its way isn't filed twice
function fileSoon(id, { dump = false } = {}) {
  if (!canAskServer() || queued.has(id)) return filing;
  queued.add(id);
  filing = filing.then(() => fileThought(id, { ask: askServer, items: plan?.items || [], today: isoToday(), dump, wrote: (rows) => applyRemote(rows).then(() => notebook.redrawMarks()), toast })).catch((e) => console.warn(e)).finally(() => queued.delete(id));
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
  // Pictures shared from Photos (no link): one tap puts them on a scene.
  const pics = added.filter((a) => !a.line.fields?.url && a.rows.some((r) => r.kind === 'file' && /^image\//.test(r.fields?.type || '')));
  const picN = pics.flatMap((a) => a.rows.filter((r) => r.kind === 'file' && /^image\//.test(r.fields?.type || ''))).length;
  if (picN) toast(`${picN === 1 ? 'A picture' : `${picN} pictures`} kept on today’s page`, { label: 'Put on a scene…', run: () => picturesToScene(pics) });
  else toast(added.length === 1 ? 'Kept on today’s page' : `${added.length} things kept on today’s page`);
  writeOut();
}

// Shared pictures onto a film's scene: they fill its shots without a picture,
// then make new shots; today's line for them goes (Undo brings all back).
async function picturesToScene(shares) {
  const { filmsForPictures, picturesOnScene, picturesText } = await import('../picturesin.js');
  const films = await filmsForPictures();
  if (!films.length) { toast('No script with scenes yet to put them on'); return; }
  const ids = shares.flatMap((a) => a.rows.filter((r) => r.kind === 'file' && /^image\//.test(r.fields?.type || '')).map((r) => r.id));
  const sceneItems = (f) => f.scenes.map((sc) => {
    const empty = sc.shots.filter((sh) => !(sh.fields?.tries || []).some((t) => t.files?.length || t.links?.length)).length;
    return { label: `${sc.name}${sc.shots.length ? ` · ${sc.shots.length} ${sc.shots.length === 1 ? 'shot' : 'shots'}${empty ? `, ${empty} without a picture` : ''}` : ''}`, run: () => place(f.film, sc) };
  });
  const place = async (film, sc) => {
    const r = await picturesOnScene(sc.id, ids, { pieceId: film.id });
    const lines = [];
    for (const a of shares) { const cur = await getEntry(a.line.id); if (cur && !cur.deleted) lines.push(cur); }
    if (r.filled + r.made && lines.length) await putEntries(lines.map((l) => ({ ...l, deleted: true, updated_at: Date.now() })));
    await go({ view: 'production', id: film.id, tab: 'shots' });
    toast(`${picturesText(r)} in ${sc.name}`, r.filled + r.made ? { label: 'Undo', run: async () => { await r.undo(); if (lines.length) await putEntries(lines.map((l) => ({ ...l, deleted: false, updated_at: Date.now() }))); await go({ view: 'production', id: film.id, tab: 'shots' }); } } : undefined);
  };
  const items = films.length === 1 ? sceneItems(films[0]) : films.map((f) => ({ label: f.film.title || 'Untitled', sub: sceneItems(f) }));
  popMenu(null, [{ note: films.length === 1 ? `Which scene of ${films[0].film.title || 'the script'}?` : 'Which film, then which scene?', plain: true }, ...items], { left: Math.max(8, window.innerWidth / 2 - 160), top: 72 });
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
// Its commands in the box (Ctrl + K); commandinfo.js has their hints and words.
addCommands(() => [
  { group: 'go', label: 'Bring earlier days to today (every task left from before, onto today)', keys: 'Alt+Shift+T', words: ['carried', 'earlier', 'overdue', 'late', 'move', 'today', 'left over'], run: () => plan.bringToday() },
  { group: 'new', label: 'Capture an idea by voice (it lands where you are)', keys: '⌥C', words: ['dictate', 'voice', 'walk', 'speak', 'talk', 'draft'], run: () => captureHere() },
  { group: 'new', label: 'Capture from a recording file…', words: ['audio', 'voice memo', 'upload', 'draft'], run: () => fromRecordingFile() },
  { group: 'write', label: 'Your voice modes (shared with Scribe)…', words: ['journal', 'scene', 'idea', 'email', 'mode'], run: () => openModes() },
  { group: 'plan', label: 'Now: Done with the one thing', keys: 'D', words: ['done', 'finished', 'tick', 'check', 'now', 'one thing'], run: () => plan.now.done(), when: onNow },
  { group: 'plan', label: 'Now: Not now (later today, enough for today, another day)', keys: 'N', words: ['not now', 'later', 'tomorrow', 'set aside', 'postpone', 'another day', 'worked on'], run: () => { plan.now.asking = true; plan.redraw(); }, when: () => onNow() && !!plan.now.model().cur },
  { group: 'go', label: 'Training: the sessions and their exercises', words: ['training', 'workout', 'exercise', 'sessions', 'calisthenics', 'parkour', 'handstand', 'front lever', 'vertical'], run: async () => { if (!(await addonOn('training'))) return window.dispatchEvent(new CustomEvent('open-addons')); await seedTraining(); openEntry(TRAINING_PAGE); } },
  { group: 'go', label: 'Try Studio as a new person (opens a new tab, your writing stays as it is)', words: ['studio', 'preview', 'new person', 'elle', 'onboarding', 'first steps', 'tour', 'test'], run: () => { window.open(location.pathname + '?preview=new', '_blank'); }, when: () => !STUDIO },
  { group: 'go', label: 'Show me around (First steps)', words: ['tour', 'help', 'start', 'learn', 'first steps', 'onboarding', 'how do i'], run: async () => { await saveSteps({ hidden: false }); await go({ view: 'desk' }); deskPage?.load?.({ quiet: true }); }, when: () => STUDIO },
  { group: 'view', label: 'Add-ons: Bible reading, Training', words: ['add-ons', 'addons', 'routines', 'bible', 'training', 'turn on', 'turn off'], run: () => window.dispatchEvent(new CustomEvent('open-addons')) },
  { group: 'plan', label: 'Today’s Bible reading', words: ['bible', 'reading', 'esv', 'scripture', 'first light', 'chapters', 'psalm', 'devotion', 'morning'], run: async () => { if (!(await addonOn('bible'))) return window.dispatchEvent(new CustomEvent('open-addons')); plan.now.light.open(); await go({ view: 'plan', tab: 'now' }); plan.redraw(); }, when: () => !!plan },
  { group: 'plan', label: 'Talk the day through (what is in front of you today)', words: ['morning', 'talk', 'day', 'lay out', 'plan the day', 'say', 'brain dump', 'start', 'now'], run: async () => { await go({ view: 'plan', tab: 'now' }); plan.now.openTalk(); }, when: () => !!plan },
  { group: 'plan', label: 'Close the day (what you did, two questions, first thing tomorrow)', words: ['evening', 'close', 'end', 'day', 'reflect', 'journal', 'done', 'tomorrow', 'shutdown', 'wrap up'], run: () => closeDayFromCard(), when: () => !!plan },
  { group: 'go', label: 'Go through loose lines: the last week’s unfiled lines, one at a time', words: ['sort', 'file', 'loose', 'triage', 'review', 'inbox', 'tidy'], run: () => through.open('loose') },
  { group: 'go', label: 'Keep this day’s loose lines on the page (Claude files each one)', words: ['brain dump', 'file', 'loose', 'keep', 'sort', 'inbox'], run: () => keepOnPage(notebook.page.title), when: () => inNotebook() && notebook.isDay && canAskServer() },
  { group: 'go', label: 'Go through the tasks left from earlier days: keep, not today, or delete', words: ['carried', 'overdue', 'old tasks', 'pile', 'triage', 'clear'], run: () => through.open('carried') },
  { group: 'go', label: 'Go through what needs you: the Desk’s calls, one at a time', words: ['calls', 'needs you', 'decide', 'desk', 'triage', 'waiting'], run: () => through.open('calls') },
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
    onCount: (n) => { frame.count(n); document.dispatchEvent(new CustomEvent('inkwell:needs', { detail: n })); },
    // The Desk's order changed (a drag, or what's on stage): the rail follows.
    ordered: () => {},
    // "Add one" under "No next step yet": the project's Steps page, the caret on a new step.
    addStep: async (id) => {
      const world = await getEntry(id);
      if (!world) return;
      const rows = await addTask({ text: '', home: stepsHome(world) });
      await applyRemote(rows);
      await openEntry(rows.at(-1).id);
    },
    through: () => through.open('calls'),
    // The zoom's Desk: a step opens as its own page.
    openLine: (id) => plan.openLine(id),
    // A call answered from a project's own page: that page looks again.
    acted: () => { projectPage?.stale(); if (view() === 'world') renderWorld(); },
    // ✦ Talk it through, from the Desk's head (not from inside a pane, and not with Beside off).
    talk: () => (inPane || !paneHost() ? null : () => openTalk()),
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
    calls: { list: () => deskPage.waiting(), done: (id) => deskPage.callDone(id), later: (id) => deskPage.callLater(id), today: (it) => deskPage.callToday(it) },
    // Tasks left on today from earlier days: keep, take off the day, or delete.
    carried: { list: () => plan.carriedList(), answer: (it, how) => plan.carriedAnswer(it, how) },
    onClose: () => { plan?.soon(); }
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
      beside: (id) => (inPane || !paneHost() ? null : () => openEntryBeside(id)),
      // A click on a task zooms into it, as an outliner does: the task becomes
      // the page, its lines under it (the cursor on `line`, if given), and Back
      // (Alt + Left) comes out to the plan. Ctrl + click and the menu open it beside.
      openTask: async (id, line = null, { beside = false } = {}) => {
        const at = await placeOf(id);
        if (!at) return;
        const place = at.view === 'notebook' && at.line ? { view: 'notebook', pageId: at.pageId, zoom: at.line, ...(line ? { line } : {}) } : at;
        if (beside && !inPane && paneHost()) return openBeside(place);
        if (inPane && view() === 'plan') return paneHost()?.hooks.goMain(place);
        return go(place);
      },
      // Where a task opens zoomed in (the zoom's Now: Today and Now as one, Nov 25 2026).
      taskPlace: async (id) => {
        const at = await placeOf(id);
        return at && at.view === 'notebook' && at.line ? { view: 'notebook', pageId: at.pageId, zoom: at.line } : null;
      },
      go: (place) => go(place),
      goThrough: () => through.open('carried'),
      off: (name) => hidden().has(name),
      show: (name, on) => setShown(name, on),
      // Beside or on top: only where there's room for beside (a computer, 1100 px and wider).
      // A project's steps were drawn again: its next date may have moved.
      steps: () => { if (view() === 'world' && state.worldId) { projectPage?.setDate(nextDate(state.worldId)); drawNextStep(); } },
      // Weeks ahead: the lanes as the Desk seats them, and shoot days.
      talk: () => (inPane || !paneHost() ? null : () => openTalk()),
      // Google Calendar, read-only, through the server's calendar function.
      calendar: (from, to) => calendarEvents((a, b) => (window.__calendar ? window.__calendar(a, b) : sync.user && sync.invoke ? sync.invoke('calendar', { timeMin: a, timeMax: b }) : null), from, to),
      // Pull from a project: its lines open next to the plan, to drag in.
      pull: inPane ? null : () => pullFromProject(),
      pulling: () => !!pull?.isOpen,
      floor: () => pull?.floor() || 0,
      redrawn: () => { pull?.soon(); nowStrip?.soon(); nowZoom?.soon(); },
      thought: (text) => thoughtFromNow(text),
      mic: (kind) => micFromNow(kind),
      talkDay: (words) => talkDayFromNow(words),
      // First light (Part 5): one ESV chapter from the server (no key yet: { nokey }).
      bible: (body) => (canAskServer() ? askServer(body) : null),
      // Training (Part 6): today's line, once a day, not on Sunday.
      // Not in automated test runs unless asked for (src/auto.js).
      daily: async (items, today) => {
        if (inPane) return [];
        // Each only when its add-on is on (src/addons.js).
        const rows = !autoOn('training') || !(await addonOn('training')) ? [] : await ensureTrainingLine(items, today);
        // First light is a line of the day on the zoom (Part 2).
        if (autoOn('firstlight') && (await addonOn('bible'))) rows.push(...(await ensureLightLine(items, today)));
        return rows;
      },
      // The zoom's line page (Part 2): the door into a step's piece, the pieces
      // to tie it to, into the text with the cursor at the end, a note under it.
      doorOf: (id) => doorOf(id),
      piecesOf: (worldId) => piecesOf(worldId),
      writeHere: (id) => writeHere(id),
      addNote: (id, text) => addNote(id, text),
      closeDay: (answers) => closeDayFromNow(answers),
      toast
    }
  });
  window.__plan = plan;
  // Five minutes before a calendar event, a quiet line at the top (not in a pane).
  if (!inPane) window.__nowStrip = nowStrip = new EventWarn({ plan, off: (name) => hidden().has(name) });
  // Zoomed into a task on today, that's Now: Next and the way back at the foot (nowzoom.js).
  if (!inPane) window.__nowZoom = nowZoom = new NowZoom({ plan, notebook: () => notebook, here: () => inNotebook() });
  if (inNotebook() && notebook.page) plan.showDay(notebook.page);
}

export { nowStrip, nowZoom, openToday, todayOpensOnNow, askServer, asking, blankOnce, canAskServer, capture, captureHere,  deskBackend, deskPage, inToday, landShares, openAsked, openCapture, plan, projectPage, scribeKept, setAsking, showCapture, tagsPage, wireTalking, writeOut };

// ---------- the zoom's line page (Part 2) ----------

const said = (t) => String(t || '').replace(/\s+/g, ' ').trim();
// The piece or page a step is for: its name, kind and size, its last two lines.
async function doorOf(id) {
  const r = await getEntry(id);
  if (!r || r.deleted || isTrashed(r)) return null;
  const lastOf = (rows) => rows.filter((x) => !x.deleted && said(x.text)).slice(-2).map((x) => ({ text: said(x.text), head: x.kind === 'scene' || x.kind === 'heading' || ['scene', 'character'].includes(x.fields?.el) }));
  if (r.kind === 'project' && bookType(r) !== 'lines') {
    const chs = (await outline(r.id)).flatMap((a) => a.chapters).filter((c) => !c.deleted);
    const last = chs.at(-1);
    const n = chs.length;
    return { id: r.id, name: r.title || 'Untitled', kind: kindName(r), size: n ? `${n} chapter${n === 1 ? '' : 's'}` : '', last: last ? lastOf(await children(last.id)) : [] };
  }
  if (r.kind === 'project' || r.kind === 'page' || r.kind === 'day') {
    const lines = (await children(r.id)).filter((x) => x.kind === 'line' && !x.deleted);
    const n = lines.length;
    return { id: r.id, name: r.title || titleOf(r) || 'Untitled', kind: r.kind === 'project' ? kindName(r) : r.kind === 'day' ? 'Day' : 'Page', size: n ? `${n} line${n === 1 ? '' : 's'}` : '', last: lastOf(lines) };
  }
  if (r.kind === 'chapter') return { id: r.id, name: r.title || 'Untitled', kind: 'Chapter', size: '', last: lastOf(await children(r.id)) };
  return null;
}

// A project's pieces, to tie a step to one.
async function piecesOf(worldId) {
  if (!worldId) return [];
  return (await children(worldId)).filter((r) => r.kind === 'project' && !r.deleted && !isTrashed(r)).map((r) => ({ id: r.id, name: r.title || 'Untitled', kind: kindName(r) }));
}

// Into the text, the cursor at the end, ready to type.
async function writeHere(id) {
  const r = await getEntry(id);
  if (!r || r.deleted) return;
  if (r.kind === 'project' && bookType(r) !== 'lines') await openBook(r.id);
  else await openEntry(id);
  // Once a key goes down he has moved on (Esc, Alt + J…): don't pull him back.
  let moved = false;
  const stop = () => { moved = true; };
  document.addEventListener('keydown', stop, { capture: true, once: true });
  const end = () => { if (moved) return; const ed = currentEditor(); try { ed?.commands.focus('end', { scrollIntoView: true }); } catch { /* not ready yet */ } };
  requestAnimationFrame(end);
  setTimeout(() => { end(); document.removeEventListener('keydown', stop, true); }, 350);
}

// "Write a note": one more line under it.
async function addNote(id, text) {
  const t = said(text);
  if (!t) return null;
  const kids = (await children(id)).filter((r) => !r.deleted);
  const row = entry('line', { id: newId('li'), parent_id: id, sort: (kids.at(-1)?.sort || 0) + GAP, text: t, content: [{ type: 'text', text: t }], tags: tagsIn(t), links: [], fields: { done: false } });
  await putEntries([row]);
  await applyRemote([row]);
  return row;
}
