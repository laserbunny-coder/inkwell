import { putEntries, getEntry, getMeta, setMeta } from './db.js';

// Send a line to Daybook: it lands in Daybook's Inbox as a task, with a link
// back to the line here (?open=<id>), so a capture that turns into something
// to do keeps its notes in Inkwell. Sending again updates the same task
// rather than making another. Offline, it waits and goes with the next sync.

const TITLE_MAX = 140;

// The task Daybook gets: the line's words without its #tags as the title, the
// whole line in the notes when it's long, and the link back.
export function taskFor(line, base) {
  const words = (line.text || '').replace(/(^|\s)#[\p{L}\p{N}_-]+/gu, '').replace(/\s+/g, ' ').trim();
  const title = words.length > TITLE_MAX ? `${words.slice(0, TITLE_MAX - 1).replace(/\s+\S*$/, '')}…` : words;
  return {
    id: `inkwell-${line.id}`,
    title: title || 'From Inkwell',
    notes: words.length > TITLE_MAX ? words : null,
    link: `${base}?open=${encodeURIComponent(line.id)}`,
    deleted: false
  };
}

async function waiting() { return (await getMeta('daybookQueue')) || []; }

// Marks the line as sent (fields.daybook) and queues the task. Returns the row.
export async function sendToDaybook(lineId, base) {
  const line = await getEntry(lineId);
  if (!line || line.deleted || !(line.text || '').trim()) return null;
  const task = taskFor(line, base);
  await setMeta('daybookQueue', [...(await waiting()).filter((t) => t.id !== task.id), task]);
  const row = { ...line, fields: { ...line.fields, daybook: { id: task.id, at: Date.now() } }, updated_at: Date.now() };
  await putEntries([row]);
  return row;
}

let busy = null;
// Sends what's waiting. Resolves to how many went.
export function sendPending({ send, canSend }) {
  busy ||= (async () => {
    const tasks = await waiting();
    if (!tasks.length || !canSend()) return 0;
    let sent = 0;
    for (const t of tasks) {
      try { await send(t); } catch (e) { console.warn(e); break; }
      sent += 1;
      await setMeta('daybookQueue', (await waiting()).filter((q) => q !== t && q.id !== t.id));
    }
    return sent;
  })().catch((e) => { console.error(e); return 0; }).finally(() => { busy = null; });
  return busy;
}
