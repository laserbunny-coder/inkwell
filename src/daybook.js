import { getMeta, setMeta } from './db.js';

// The queue of tasks still going to Daybook. Daybook is retired: only the
// day review and a shoot day still send there, until they move over too.
// Offline, a task waits and goes with the next sync.

async function waiting() { return (await getMeta('daybookQueue')) || []; }

// Puts a task in the queue for Daybook (replacing one with the same id).
export async function queueTask(task) {
  await setMeta('daybookQueue', [...(await waiting()).filter((t) => t.id !== task.id), task]);
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
