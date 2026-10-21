import { createClient } from '@supabase/supabase-js';
import config from './config.js';
import { getEntry, putEntries, outboxIds, clearOutbox, addConflict, getMeta, setMeta } from './db.js';

// Keeps this device's entries in step with the cloud (the Supabase project
// shared with Daybook). The device is always the first copy: writing works
// with no signal, changes queue in the outbox, and they go up when there's a
// connection. Changes from other devices come down and are merged entry by
// entry, so two devices only clash when the same paragraph was changed on both
// while apart. Then this device's version wins and the other is kept as a
// conflict copy, so nothing is lost.

const COLUMNS = ['id', 'kind', 'parent_id', 'sort', 'title', 'text', 'content', 'tags', 'type', 'fields', 'area_id', 'links', 'deleted'];
const PAGE = 500;

function toRemote(e) {
  const row = {};
  for (const c of COLUMNS) row[c] = e[c] ?? null;
  row.title = row.title || '';
  row.text = row.text || '';
  row.tags = row.tags || [];
  row.fields = row.fields || {};
  row.links = row.links || [];
  row.deleted = !!row.deleted;
  row.sort = row.sort || 0;
  row.created_at = new Date(e.created_at || Date.now()).toISOString();
  return row;
}

function toLocal(r) {
  const { user_id, ...rest } = r;
  return { ...rest, created_at: Date.parse(r.created_at), updated_at: Date.parse(r.updated_at) };
}

// The real backend: Supabase. Tests swap in a fake with the same five methods.
function supabaseBackend() {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null;
  const sb = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' }
  });
  let channel = null;
  return {
    async user() {
      const { data } = await sb.auth.getSession();
      return data.session?.user || null;
    },
    onAuth(fn) { sb.auth.onAuthStateChange((_e, session) => fn(session?.user || null)); },
    signIn() {
      return sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
    },
    signOut() { return sb.auth.signOut(); },
    async push(rows) {
      const { data, error } = await sb.from('writing_entries').upsert(rows).select('id,updated_at');
      if (error) throw error;
      return data;
    },
    async pull(since, from) {
      const { data, error } = await sb.from('writing_entries').select('*').gt('updated_at', since)
        .order('updated_at').order('id').range(from, from + PAGE - 1);
      if (error) throw error;
      return data;
    },
    subscribe(userId, fn) {
      if (channel) sb.removeChannel(channel);
      channel = sb.channel(`writing-${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'writing_entries', filter: `user_id=eq.${userId}` }, fn)
        .subscribe();
    },
    unsubscribe() { if (channel) sb.removeChannel(channel); channel = null; }
  };
}

export class Sync {
  constructor({ onStatus, onRemote }) {
    this.onStatus = onStatus;
    this.onRemote = onRemote;
    this.backend = window.__syncBackend || supabaseBackend();
    this.user = null;
    this.busy = false;
    this.again = false;
    this.timer = null;
    this.retry = 2000;
    // When each entry was last sent from here, by the server's clock. A pull
    // can bring back our own earlier send while the entry has changed again
    // here; that's an echo, not another device, so it mustn't count as a clash.
    try { this.sent = new Map(Object.entries(JSON.parse(localStorage.getItem('sentStamps') || '{}'))); } catch { this.sent = new Map(); }
  }

  remember(stamps) {
    for (const [id, at] of stamps) if (at) this.sent.set(id, at);
    while (this.sent.size > 5000) this.sent.delete(this.sent.keys().next().value);
    try { localStorage.setItem('sentStamps', JSON.stringify(Object.fromEntries(this.sent))); } catch { /* full */ }
  }

  get available() { return !!this.backend; }

  async start() {
    if (!this.backend) return this.onStatus('off');
    this.backend.onAuth?.((user) => {
      const was = this.user?.id;
      this.user = user;
      if (user && user.id !== was) this.begin();
      if (!user) { this.backend.unsubscribe(); this.onStatus('signed-out'); }
    });
    this.user = await this.backend.user();
    if (!this.user) return this.onStatus('signed-out');
    await this.begin();
  }

  async begin() {
    this.backend.subscribe(this.user.id, () => this.soon(400));
    window.addEventListener('online', () => this.soon(0));
    clearInterval(this.poll);
    this.poll = setInterval(() => this.soon(0), 60000);
    await this.run();
  }

  signIn() { return this.backend?.signIn(); }
  async signOut() { await this.backend?.signOut(); this.user = null; this.onStatus('signed-out'); }

  // Called after every local write.
  soon(ms = 1500) {
    if (!this.user) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), ms);
  }

  async run() {
    if (!this.user) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    this.onStatus('syncing');
    try {
      // Pull first, so a paragraph changed on both devices is noticed (and the
      // other version kept) before ours overwrites it in the cloud.
      await this.pull();
      await this.push();
      this.retry = 2000;
      this.onStatus(navigator.onLine === false ? 'offline' : 'synced');
    } catch (e) {
      console.warn('sync failed, will retry', e);
      this.onStatus('offline');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.run(), this.retry);
      this.retry = Math.min(this.retry * 2, 60000);
    } finally {
      this.busy = false;
      if (this.again) { this.again = false; this.soon(0); }
    }
  }

  async push() {
    const ids = await outboxIds();
    for (let i = 0; i < ids.length; i += PAGE) {
      const local = (await Promise.all(ids.slice(i, i + PAGE).map(getEntry))).filter(Boolean);
      if (!local.length) continue;
      const stamped = await this.backend.push(local.map(toRemote));
      const stamps = new Map((stamped || []).map((r) => [r.id, Date.parse(r.updated_at)]));
      this.remember(stamps);
      await clearOutbox(local.map((e) => ({ id: e.id, updated_at: e.updated_at, server_at: stamps.get(e.id) })));
    }
  }

  async pull() {
    const since = (await getMeta('syncSince')) || '1970-01-01T00:00:00Z';
    const pending = new Set(await outboxIds());
    const changed = [];
    let latest = since;
    for (let from = 0; ; ) {
      const rows = await this.backend.pull(since, from);
      from += rows.length;
      if (!rows.length) break;
      const take = [];
      for (const r of rows) {
        const incoming = toLocal(r);
        const mine = await getEntry(r.id);
        if (pending.has(r.id)) {
          // Our own earlier send coming back: nothing new.
          if (incoming.updated_at <= (this.sent.get(r.id) || 0)) continue;
          // Changed here too and not sent yet: keep ours, save theirs.
          if (mine && (mine.text !== incoming.text || mine.title !== incoming.title || mine.deleted !== incoming.deleted)) await addConflict(incoming);
          continue;
        }
        if (mine && mine.updated_at === incoming.updated_at) continue;
        take.push(incoming);
      }
      if (take.length) { await putEntries(take, { fromSync: true }); changed.push(...take); }
      latest = rows[rows.length - 1].updated_at;
      if (rows.length < PAGE) break;
    }
    if (latest !== since) await setMeta('syncSince', latest);
    if (changed.length) await this.onRemote(changed);
  }
}
