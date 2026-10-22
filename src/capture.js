import { putEntries, getEntry, children, getMeta, setMeta, topTags, CLAUDE } from './db.js';
import { entry, tagsIn } from './model.js';
import { GAP } from './order.js';
import { addFile, localFile, uploadPending, lengthLabel } from './files.js';
import { setFileNote } from './filenode.js';

// Capture: an idea in seconds, asking nothing. Tap, talk, tap Done. The
// recording is kept on this device first (piece by piece while you talk, so
// even a crash or a dead battery keeps what was said), then lands on today's
// page as a #idea line with the recording on it. When there's a connection
// it's written out, and Claude adds a short tidy outline under it. Your words
// are never changed.

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
async function addLine(content, fields, day = today()) {
  const dayId = `day-${day}`;
  const rows = [];
  const dayRow = await getEntry(dayId);
  if (!dayRow || dayRow.deleted) rows.push({ ...(dayRow || entry('day', { id: dayId, title: day })), deleted: false, updated_at: Date.now() });
  const kids = await children(dayId);
  const sort = kids.length ? Math.max(...kids.map((k) => k.sort || 0)) + GAP : GAP;
  const text = textOf(content);
  const line = entry('line', { parent_id: dayId, sort, text, content, tags: tagsIn(text), fields: { done: false, gather: null, gathered: null, mirror: null, ...fields } });
  rows.push(line);
  await putEntries(rows);
  return { line, rows };
}

// The words of a line as the outline saves them: a recording or picture adds none.
function textOf(content) {
  return (content || []).map((n) => (n.type === 'text' ? n.text : n.type === 'entryRef' ? n.attrs?.title || '' : '')).join('');
}

const fileNode = (row) => ({ type: 'file', attrs: { id: row.id, name: row.title, type: row.fields.type, size: row.fields.size, duration: row.fields.duration || 0 } });

// Keeps a finished recording and puts it on today's page. Returns the rows written.
export async function saveRecording(blob, duration, started = new Date()) {
  const type = (blob.type || 'audio/webm').split(';')[0];
  const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
  const file = new File([blob], `Voice ${clock(started)}.${ext}`, { type });
  const row = await addFile(file, { duration: Math.round(duration) });
  if (!row) return null;
  const content = [fileNode(row), { type: 'text', text: ' #idea' }];
  const { line, rows } = await addLine(content, { capture: 'voice' }, dayOf(started));
  await queue({ line: line.id, file: row.id, wrote: line.text, duration: Math.round(duration), at: Date.now() });
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
// out, and Claude's outline goes under it. `ask` sends a request to the
// server; `onRows` is told what changed so an open page can show it.
export function writeOutPending({ ask, canAsk, onRows }) {
  busy ||= (async () => {
    clearTimeout(retry);
    const items = await waiting();
    for (const it of items) setFileNote(it.file, 'waiting to be written out');
    if (!items.length || !canAsk()) return;
    await uploadPending();
    for (const it of items) {
      const kept = await localFile(it.file);
      if (kept && !kept.uploaded) continue; // still going up; next time
      setFileNote(it.file, 'writing out…');
      let answer;
      try {
        answer = await ask({ mode: 'capture', file: it.file, duration: it.duration || 0, tags: await topTags(40) });
      } catch (e) {
        setFileNote(it.file, e.code === 'no-transcriber' ? 'waiting for writing-out to be set up' : 'waiting to be written out');
        if (e.code === 'no-transcriber') break;
        console.warn('capture write-out failed, will retry', e);
        continue;
      }
      const rows = await placeWriteOut(it, answer || {});
      await unqueue(it.line);
      setFileNote(it.file, '');
      if (rows.length) onRows(rows);
    }
  })().catch((e) => console.error(e)).finally(() => {
    busy = null;
    // Anything still waiting gets another go in a few minutes.
    waiting().then((left) => { if (left.length) retry = setTimeout(() => writeOutPending({ ask, canAsk, onRows }), 3 * 60 * 1000); });
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

// The words go into the capture's line (after the recording, before #idea).
// If you've already written on that line, they go just under it instead, so
// nothing you typed is touched. Claude's outline lines go under that, then
// links to anything it named; Claude's #tag goes on the line.
export async function placeWriteOut(it, { transcript = '', outline = [], tag = '', refs = [] }) {
  const line = await getEntry(it.line);
  if (!line || line.deleted) return [];
  const words = transcript.trim();
  const rows = [];
  const kids = await children(line.id);
  let sort = kids.length ? Math.max(...kids.map((k) => k.sort || 0)) : 0;
  const child = (id, text, by, content = text ? [{ type: 'text', text }] : null) => {
    sort += GAP;
    const prev = kids.find((k) => k.id === id);
    return { ...(prev || entry('line', { id })), kind: 'line', parent_id: line.id, sort: prev?.sort ?? sort, text, content, tags: tagsIn(text), links: [], deleted: false, updated_at: Date.now(), fields: { ...(prev?.fields || {}), done: false, gather: null, gathered: null, mirror: null }, ...(by ? { _by: by } : {}) };
  };
  let top = line;
  if (words) {
    if (line.text === it.wrote) {
      const content = [...(line.content || []).filter((n) => n.type !== 'text'), { type: 'text', text: ` ${words} #idea` }];
      const text = textOf(content);
      top = { ...line, content, text, tags: tagsIn(text) };
    } else rows.push(child(`${line.id}-t`, words));
  }
  const tagged = withTag(top, tag);
  if (tagged !== line) rows.unshift({ ...tagged, updated_at: Date.now() });
  outline.filter((s) => typeof s === 'string' && s.trim()).slice(0, 12).forEach((s, i) => rows.push(child(`${line.id}-o${i + 1}`, s.trim(), CLAUDE)));
  refs.filter((r) => r?.label && /^https?:\/\//.test(r.url || '')).slice(0, 6).forEach((r, i) => rows.push(child(`${line.id}-r${i + 1}`, r.label, CLAUDE, linkContent(r.label, r.url))));
  if (rows.length) await putEntries(rows);
  return rows;
}

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

  async show({ start = autostart() } = {}) {
    this.el.hidden = false;
    document.documentElement.classList.add('capturing');
    this.render('ready');
    this.big.focus();
    if (start) await this.start();
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
    await clearPieces();
    const type = recorderType();
    const mr = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
    const started = new Date();
    const rec = this.rec = { mr, stream, started, at: performance.now(), type: mr.mimeType || type || 'audio/webm', parts: [], i: 0 };
    mr.addEventListener('dataavailable', (e) => {
      if (!e.data?.size || rec.dropped) return;
      rec.parts.push(e.data);
      // Each piece is kept as it arrives, so a crash keeps everything up to here.
      keepPiece({ i: rec.i++, started: started.getTime(), type: rec.type, blob: e.data }).catch(() => {});
    });
    mr.start(4000);
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

  async finish() {
    const rec = this.rec;
    if (!rec) return;
    this.render('saving');
    const ended = new Promise((res) => rec.mr.addEventListener('stop', res, { once: true }));
    rec.mr.stop();
    await ended;
    this.stopDevices();
    this.rec = null;
    const duration = performance.now() - rec.at;
    const blob = new Blob(rec.parts, { type: rec.type });
    let saved = null;
    try {
      saved = blob.size ? await saveRecording(blob, duration, rec.started) : null;
    } catch (e) {
      console.error(e);
    }
    if (!saved) { this.render('error', 'That recording couldn’t be kept. It’s still on this device; reopen Inkwell to bring it back.'); return; }
    await clearPieces();
    this.close();
    this.onSaved(saved);
  }

  async cancel() {
    if (this.rec) {
      const rec = this.rec;
      rec.dropped = true;
      const ended = new Promise((res) => rec.mr.addEventListener('stop', res, { once: true }));
      try { rec.mr.stop(); await ended; } catch { /* already stopped */ }
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

// A recording cut off by a crash, a closed app or a dead battery: whatever
// was kept goes on today's page like any other capture.
export async function recoverRecording() {
  let parts;
  try { parts = await allPieces(); } catch { return null; }
  if (!parts.length) return null;
  parts.sort((a, b) => a.i - b.i);
  // Only one recording's pieces are ever kept, and only while it's going.
  const { started, type } = parts[0];
  const blob = new Blob(parts.map((p) => p.blob), { type });
  const duration = Math.max(1000, parts.length * 4000);
  const saved = await saveRecording(blob, duration, new Date(started));
  await clearPieces();
  return saved;
}
