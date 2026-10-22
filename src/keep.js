import { outboxIds, getEntry } from './db.js';

// Keeping the writing on this device safe.
//
// Browsers may clear a website's saved data when space runs low, or (Safari)
// after weeks without a visit. Asking for persistent storage tells the browser
// this app's data is precious, so it's never cleared without asking.
//
// And if changes made here haven't reached the cloud for a day or more, the
// sync button says so, so a device that's been signed out or offline for a
// long time doesn't quietly hold the only copy.

export async function keepStorage() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export const STALE_AFTER = 24 * 36e5;

// When the oldest change still waiting to go to the cloud was made (or null).
export async function oldestUnsent() {
  const ids = await outboxIds();
  let oldest = null;
  for (const id of ids.slice(0, 2000)) {
    const e = await getEntry(id);
    if (e?.updated_at && (oldest === null || e.updated_at < oldest)) oldest = e.updated_at;
  }
  return oldest;
}

export function unsentLabel(since, now = Date.now()) {
  const days = Math.floor((now - since) / (24 * 36e5));
  return days >= 2 ? `Not synced for ${days} days` : 'Not synced since yesterday';
}

export function unsentFilesLabel(count, since, now = Date.now()) {
  const days = Math.floor((now - since) / (24 * 36e5));
  const what = count === 1 ? '1 picture or file' : `${count} pictures or files`;
  return `${what} not uploaded ${days >= 2 ? `for ${days} days` : 'since yesterday'}`;
}

// How full the cloud's file space is, as a warning to show once at 80% and
// again at 95% (null when there's nothing new to say). `warned` is the last
// level already shown.
export function spaceWarning(bytes, space, warned = 0) {
  const pct = Math.floor((bytes / space) * 100);
  const level = pct >= 95 ? 95 : pct >= 80 ? 80 : 0;
  if (!level || level <= warned) return null;
  return { level, text: `Picture and file space is ${pct}% full (${mb(bytes)} of ${mb(space)}). Upgrading the cloud plan adds room; nothing is lost if it fills, but new ones stay on this device.` };
}

export const mb = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`);
