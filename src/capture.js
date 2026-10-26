import { putEntries, getEntry, children, getMeta, setMeta, topTags } from './db.js';
import { refsIn, foldAway } from './outline.js';
import { entry, tagsIn } from './model.js';
import { GAP } from './order.js';
import { addFile, localFile, uploadPending, lengthLabel } from './files.js';
import { setFileNote } from './filenode.js';
import { placeVoice } from './voice.js';

// Capture: an idea in seconds, asking nothing. Tap, talk, tap Done. The
// recording is kept on this device first (piece by piece while you talk, so
// even a crash or a dead battery keeps what was said), then lands on today's
// page as a #idea line with the recording on it. When there's a connection
// it's written out and Claude writes it up in the mode that fits (voice.js),
// with the word-for-word text always kept. Aimed at a chapter, the write-up
// goes into the draft instead, and the day page keeps the recording.

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const clock = (d = new Date()) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, ' ').toLowerCase();

// ---------- the recording, kept as it's made ----------

const DRAFTS = 'inkwell-capture';
let dbp = null;
function open() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DRAFTS, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('pieces', { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
const result = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
async function pieces(mode = 'readonly') { return (await open()).transaction('pieces', mode).objectStore('pieces'); }
async function keepPiece(p) { return result((await pieces('readwrite')).add(p)); }
async function allPieces() { return result((await pieces()).getAll()); }
async function clearPieces() { return result((await pieces('readwrite')).clear()); }

// Opus in WebM where the browser can (Chrome, Android), else whatever it records.
function recorderType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return '';
}

export const canRecord = () => !!navigator.mediaDevices?.getUserMedia && recorderType() !== null;

// ---------- putting a capture on today's page ----------

// Adds a line at the end of today's page (making the day if it's new) and
// returns the rows written.
export async function addLine(content, fields, day = today(), { page = null, after = null } = {}) {
  const rows = [];
  // On a page: just after the line you were on (as its next sibling), else at the end.
  let parent = page;
  if (!page) {
    parent = `day-${day}`;
    const dayRow = await getEntry(parent);
    if (!dayRow || dayRow.deleted) rows.push({ ...(dayRow || entry('day', { id: parent, title: day })), deleted: false, updated_at: Date.now() });
  }
  const at = after ? await getEntry(after) : null;
  if (at && !at.deleted && at.kind === 'line') parent = at.parent_id;
  const kids = (await children(parent)).filter((k) => !k.deleted).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const i = at ? kids.findIndex((k) => k.id === at.id) : -1;
  const sort = i >= 0
    ? (kids[i + 1] ? (kids[i].sort + kids[i + 1].sort) / 2 : kids[i].sort + GAP)
    : kids.length ? Math.max(...kids.map((k) => k.sort || 0)) + GAP : GAP;
  const text = textOf(content);
  const line = entry('line', { parent_id: parent, sort, text, content, tags: tagsIn(text), links: refsIn(content), fields: { done: false, gather: null, gathered: null, mirror: null, ...fields } });
  rows.push(line);
  await putEntries(rows);
  return { line, rows };
}

// The words of a line as the outline saves them: a recording or picture adds none.
function textOf(content) {
  return (content || []).map((n) => (n.type === 'text' ? n.text : n.type === 'entryRef' ? n.attrs?.title || '' : '')).join('');
}

const fileNode = (row) => ({ type: 'file', attrs: { id: row.id, name: row.title, type: row.fields.type, size: row.fields.size, duration: row.fields.duration || 0 } });

// Keeps a finished recording and puts it on today's page. `into` aims it
// somewhere else: at a chapter ({ chapter, title, after }) the words go into
// the draft and the day page keeps the recording with a link to where they
// went; at a page ({ page, title, after }) the recording and its write-up go
// on that page and the day page gets a line linking to it. Returns the rows written.
export async function saveRecording(blob, duration, started = new Date(), { into = null, name = '' } = {}) {
  const type = (blob.type || 'audio/webm').split(';')[0];
  const ext = /mp4|m4a|aac/.test(type) ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('mpeg') ? 'mp3' : type.includes('wav') ? 'wav' : 'webm';
  const file = new File([blob], name || `Voice ${clock(started)}.${ext}`, { type });
  const row = await addFile(file, { duration: Math.round(duration) });
  if (!row) return null;
  // The time it was said goes just after the recording, so the day page reads like a log.
  const said = clock(started);
  const day = dayOf(started);
  if (into?.page) { const pg = await getEntry(into.page); if (!pg || pg.deleted) into = null; } // the page is gone: today, like any capture
  if (into?.page) {
    const { line, rows } = await addLine([fileNode(row), { type: 'text', text: ` ${said} #idea` }], { capture: 'voice', said }, day, { page: into.page, after: into.after });
    const log = await addLine([{ type: 'text', text: `${said} said on ` }, { type: 'entryRef', attrs: { id: into.page, title: into.title || 'a page' } }], { capture: 'voice-link', said, on: line.id }, day);
    await queue({ line: line.id, file: row.id, wrote: line.text, duration: Math.round(duration), at: Date.now() });
    return { line, rows: [row, ...rows, ...log.rows] };
  }
  const content = into
    ? [fileNode(row), { type: 'text', text: ` ${said} into ` }, { type: 'entryRef', attrs: { id: into.chapter, title: into.title || 'the draft' } }, { type: 'text', text: ' #draft' }]
    : [fileNode(row), { type: 'text', text: ` ${said} #idea` }];
  const { line, rows } = await addLine(content, { capture: 'voice', said, ...(into ? { into } : {}) }, day);
  await queue({ line: line.id, file: row.id, wrote: line.text, duration: Math.round(duration), at: Date.now(), ...(into ? { into } : {}) });
  return { line, rows: [row, ...rows] };
}

const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ---------- writing it out, when there's a connection ----------

// Captures waiting to be written out, kept on the device that made them.
async function waiting() { return (await getMeta('captureQueue')) || []; }
async function queue(item) { await setMeta('captureQueue', [...(await waiting()).filter((q) => q.line !== item.line), item]); }
async function unqueue(lineId) { await setMeta('captureQueue', (await waiting()).filter((q) => q.line !== lineId)); }

export async function pendingCaptures() { return waiting(); }

let busy = null;
let retry = null;

// Works through what's waiting: the recording goes up, comes back written
// out and written up, and lands on the page (or in the chapter it was aimed
// at). `ask` sends a request to the server; `onRows` is told what changed so
// an open page can show it. `draft` knows about chapters: `context(into)`
// gives the text before the spot, and `deliver(it, answer)` puts the words in.
export function writeOutPending({ ask, canAsk, onRows, draft = null }) {
  busy ||= (async () => {
    clearTimeout(retry);
    const items = await waiting();
    for (const it of items) setFileNote(it.file, 'waiting to be written out');
    if (!items.length || !canAsk()) return;
    await uploadPending();
    for (const it of items) {
      const kept = await localFile(it.file);
      if (kept && !kept.uploaded) continue; // still going up; next time
      setFileNote(it.file, it.into ? 'writing it into the draft…' : 'writing out…');
      let answer;
      try {
        const where = it.into && draft ? { place: 'draft', ...(await draft.context(it.into)) } : { place: 'day', tags: await topTags(40) };
        answer = await ask({ mode: 'voice', file: it.file, duration: it.duration || 0, ...where });
      } catch (e) {
        setFileNote(it.file, e.code === 'no-transcriber' ? 'waiting for writing-out to be set up' : 'waiting to be written out');
        if (e.code === 'no-transcriber') break;
        console.warn('capture write-out failed, will retry', e);
        continue;
      }
      const rows = it.into && draft ? await draft.deliver(it, answer || {}) : await placeVoice(it, answer || {}, { withTag });
      await unqueue(it.line);
      setFileNote(it.file, '');
      if (rows.length) await onRows(rows);
      // The write-up shows as its first line; the rest stays folded under it.
      // (If you'd already written on the line, the write-up itself is under
      // it, so it stays open.)
      const host = rows.find((r) => r.id === it.line)?.fields?.voice?.host;
      if (!(it.into && draft) && host === it.line && rows.some((r) => r.parent_id === it.line && !r.deleted && r.kind === 'line')) foldAway(it.line);
    }
  })().catch((e) => console.error(e)).finally(() => {
    busy = null;
    // Anything still waiting gets another go in a few minutes.
    waiting().then((left) => { if (left.length) retry = setTimeout(() => writeOutPending({ ask, canAsk, onRows, draft }), 3 * 60 * 1000); });
  });
  return busy;
}

// Claude's one #tag goes at the end of a line (unless it's there already),
// and the line remembers it was Claude's (fields.claude_tag).
export function withTag(row, tag) {
  const t = String(tag || '').toLowerCase().replace(/^#/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');
  if (!t || (row.tags || []).includes(t)) return row;
  const content = [...(row.content || []), { type: 'text', text: ` #${t}` }];
  const text = textOf(content);
  return { ...row, content, text, tags: tagsIn(text), fields: { ...row.fields, claude_tag: t } };
}

// A link to something the capture named (a film, a book), as Claude's line.
export const linkContent = (label, url) => [{ type: 'text', text: label, marks: [{ type: 'link', attrs: { href: url } }] }];

// ---------- the Capture screen ----------

const AUTOSTART = 'captureAutostart';
export const autostart = () => { try { return localStorage.getItem(AUTOSTART) === 'on'; } catch { return false; } };

export class CaptureScreen {
  // onSaved(result) runs once a capture is on today's page; onClose() when the
  // screen goes away without one.
  constructor(el, { onSaved, onClose, toast }) {
    this.el = el;
    this.onSaved = onSaved;
    this.onClose = onClose;
    this.toast = toast;
    this.rec = null;
    this.big = el.querySelector('.cap-big');
    this.time = el.querySelector('.cap-time');
    this.hint = el.querySelector('.cap-hint');
    this.level = el.querySelector('.cap-level');
    this.where = el.querySelector('.cap-into');
    this.dest = el.querySelector('.cap-dest');
    // A thought that doesn't belong where you are goes to today instead.
    el.querySelector('.cap-today').addEventListener('click', () => {
      this.aim(null);
      if (this.rec) this.rec.into = null;
      this.big.focus();
    });
    this.pick = el.querySelector('.cap-file input');
    this.pick.addEventListener('change', () => { const f = this.pick.files?.[0]; this.pick.value = ''; if (f) this.fromFile(f); });
    this.auto = el.querySelector('.cap-auto input');
    this.auto.checked = autostart();
    this.auto.addEventListener('change', () => { try { localStorage.setItem(AUTOSTART, this.auto.checked ? 'on' : 'off'); } catch { /* ignore */ } });
    this.big.addEventListener('click', () => (this.rec ? this.finish() : this.start()));
    el.querySelector('.cap-cancel').addEventListener('click', () => this.cancel());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.cancel(); }
      if (e.key === 'Enter' && this.rec) { e.preventDefault(); this.finish(); }
    });
  }

  get isOpen() { return !this.el.hidden; }

  // `into` aims what's said at a chapter ({ chapter, title, after }) or a
  // page ({ page, title, after }); without it, it goes on today's page.
  async show({ start = autostart(), into = null } = {}) {
    this.aim(into);
    this.el.hidden = false;
    document.documentElement.classList.add('capturing');
    this.render('ready');
    this.big.focus();
    if (start) await this.start();
  }

  // Says where what's said will land.
  aim(into) {
    this.into = into;
    this.where.hidden = false;
    this.where.classList.toggle('today', !into);
    this.dest.textContent = !into ? 'Onto today’s page' : into.chapter ? `Into ${into.title || 'the draft'}` : `Onto ${into.title || 'this page'}`;
    this.el.setAttribute('aria-label', into?.chapter ? 'Talk into the draft' : 'Capture an idea');
  }

  render(state, note = '') {
    this.el.dataset.state = state;
    const label = { ready: 'Tap to talk', starting: 'Starting…', recording: 'Tap when you’re done', saving: 'Keeping it…', error: note }[state];
    this.hint.textContent = label;
    this.big.setAttribute('aria-label', state === 'recording' ? 'Done. Keep this idea' : 'Start talking');
    if (state !== 'recording') this.time.textContent = '';
  }

  async start() {
    if (this.rec || this.starting) return;
    if (!canRecord()) { this.render('error', 'This browser can’t record. Try Chrome.'); return; }
    this.starting = true;
    this.render('starting');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      this.starting = false;
      this.render('error', e?.name === 'NotAllowedError' ? 'Inkwell needs the microphone. Allow it in Chrome’s site settings, then tap again.' : 'The microphone didn’t start. Tap to try again.');
      return;
    }
    await within(4000, clearPieces()).catch((e) => console.warn(e));
    const type = recorderType();
    const mr = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
    const started = new Date();
    const rec = this.rec = { mr, stream, started, at: performance.now(), type: mr.mimeType || type || 'audio/webm', parts: [], i: 0, into: this.into };
    mr.addEventListener('dataavailable', (e) => {
      if (!e.data?.size || rec.dropped) return;
      rec.parts.push(e.data);
      // Each piece is kept as it arrives, so a crash keeps everything up to here.
      keepPiece({ i: rec.i++, started: started.getTime(), type: rec.type, blob: e.data, into: rec.into }).catch(() => {});
    });
    rec.stopped = new Promise((res) => { mr.addEventListener('stop', res, { once: true }); mr.addEventListener('error', res, { once: true }); });
    // If the phone takes the microphone away (a call, another app, the
    // screen going off), what was said up to then is kept, not left hanging.
    rec.stopped.then(() => { if (this.rec === rec && !rec.finishing && !rec.dropped) this.finish({ cutOff: true }); });
    mr.start(1000);
    this.starting = false;
    this.render('recording');
    this.tick = setInterval(() => { this.time.textContent = lengthLabel(performance.now() - rec.at) || '0:00'; }, 250);
    this.time.textContent = '0:00';
    this.meter(stream);
    // Keep the screen on while recording (a phone on the dashboard).
    try { this.lock = await navigator.wakeLock?.request('screen'); } catch { this.lock = null; }
  }

  // A soft ring that grows with your voice, so you can see it's listening.
  meter(stream) {
    try {
      const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const draw = () => {
        if (!this.rec) return;
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        this.level.style.setProperty('--lvl', Math.min(1, peak / 64).toFixed(2));
        this.raf = requestAnimationFrame(draw);
      };
      draw();
    } catch { /* no meter, still records */ }
  }

  stopDevices() {
    clearInterval(this.tick);
    cancelAnimationFrame(this.raf);
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.lock?.release().catch(() => {});
    this.lock = null;
    this.level.style.setProperty('--lvl', 0);
    this.rec?.stream.getTracks().forEach((t) => t.stop());
  }

  async finish({ cutOff = false } = {}) {
    const rec = this.rec;
    if (!rec || rec.finishing) return;
    rec.finishing = true;
    this.render('saving');
    await stopRecorder(rec);
    this.stopDevices();
    this.rec = null;
    const duration = performance.now() - rec.at;
    const blob = new Blob(rec.parts, { type: rec.type });
    if (!blob.size) { this.render('error', 'Nothing was recorded. Tap to try again.'); return; }
    // Every step has a time limit, so this screen can't get stuck; a save
    // that finishes late still lands on the page.
    const saving = saveRecording(blob, duration, rec.started, { into: rec.into });
    let saved = null;
    try {
      saved = await within(20000, saving);
    } catch (e) {
      console.error(e);
      saving.then(async (late) => { if (late) { await within(4000, clearPieces()).catch(() => {}); if (!this.rec) this.close(); this.onSaved(late); } }).catch(() => {});
    }
    if (!saved) { this.render('error', 'That recording is taking a while to keep. It’s safe on this device; reopen Inkwell if it doesn’t appear.'); return; }
    await within(4000, clearPieces()).catch((e) => console.warn(e));
    this.close();
    await this.onSaved(saved);
    if (cutOff) this.toast('The phone stopped the microphone; what you said up to then is kept');
  }

  // A recording made somewhere else (the phone's recorder app, a file on the
  // computer) goes in just like one made here.
  async fromFile(file) {
    if (this.rec || !/^audio\/|^video\/(mp4|webm)/.test(file.type || '') && !/\.(m4a|mp3|wav|ogg|opus|webm|aac|amr|3gp)$/i.test(file.name)) {
      if (!this.rec) this.render('error', 'That isn’t a recording Inkwell can use. Try an audio file.');
      return;
    }
    this.render('saving');
    const duration = await lengthOf(file);
    const type = file.type && file.type.startsWith('audio/') ? file.type : 'audio/mp4';
    const saved = await saveRecording(new Blob([file], { type }), duration, new Date(file.lastModified || Date.now()), { into: this.into, name: file.name }).catch((e) => { console.error(e); return null; });
    if (!saved) { this.render('error', 'That file couldn’t be kept. Is it too big (over 50 MB)?'); return; }
    this.close();
    await this.onSaved(saved);
  }

  async cancel() {
    if (this.rec) {
      const rec = this.rec;
      rec.dropped = true;
      await stopRecorder(rec);
      this.stopDevices();
      this.rec = null;
      await clearPieces();
      if (performance.now() - rec.at > 3000) this.toast('Recording thrown away');
    }
    this.close();
    this.onClose();
  }

  close() {
    this.el.hidden = true;
    document.documentElement.classList.remove('capturing');
  }
}

// Stops the recorder and waits for its last piece. A recorder the phone
// already stopped has nothing more to send, and none waits more than a few
// seconds, so Done can never hang.
async function stopRecorder(rec) {
  try { if (rec.mr.state !== 'inactive') rec.mr.stop(); } catch { /* already stopped */ }
  await within(4000, rec.stopped).catch(() => {});
}
// How long a recording file runs, from the browser's own reading of it (0 if it can't tell).
function lengthOf(file) {
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    const done = (ms) => { URL.revokeObjectURL(url); resolve(ms); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : 0);
    a.onerror = () => done(0);
    setTimeout(() => done(0), 5000);
    a.src = url;
  });
}
const within = (ms, promise) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('Took too long')), ms))]);

// A recording cut off by a crash, a closed app or a dead battery: whatever
// was kept goes on today's page like any other capture.
export async function recoverRecording() {
  let parts;
  try { parts = await allPieces(); } catch { return null; }
  if (!parts.length) return null;
  parts.sort((a, b) => a.i - b.i);
  // Only one recording's pieces are ever kept, and only while it's going.
  const { started, type, into } = parts[0];
  const blob = new Blob(parts.map((p) => p.blob), { type });
  const duration = Math.max(1000, parts.length * 1000);
  const saved = await saveRecording(blob, duration, new Date(started), { into: into || null });
  await clearPieces();
  return saved;
}
