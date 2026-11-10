// Phone alerts: Inkwell buzzes this phone or computer even when it's closed
// (Web Push; public/sw.js shows them). They used to come from Daybook; once a
// device turns them on here, they come from Inkwell instead (the server sends
// to Inkwell's devices only, as soon as there is one).
// What to hear about is one switch per kind, kept on the account so every
// device agrees (alert_prefs, shared with Daybook):
//   review  the 9 pm "Your day review"
//   week    Monday's "Your week"
//   month   "Your month", early in a new month
//   needs   a Claude thread putting something on Needs you
// Turning alerts on signs this device up (push_subs, marked app 'inkwell').

import { make } from './menu.js';

const KEY = 'inkwell-alerts';
export const KINDS = [
  { k: 'review', name: 'Day review at 9 pm', hint: 'The nudge to look back over today.' },
  { k: 'needs', name: 'Needs you', hint: 'When a Claude thread needs a decision, is blocked on you, or has something to try.' },
  { k: 'week', name: 'Your week, on Mondays', hint: 'Last week summed up, and the things you said you’d do.' },
  { k: 'month', name: 'Your month', hint: 'Last month summed up, early in a new month.' }
];
const DEFAULTS = { review: true, needs: true, week: true, month: true, notes: false };

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const keep = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* full */ } };
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const phone = () => /Android|iPhone|iPad/.test(navigator.userAgent);
const device = () => (/Android/.test(navigator.userAgent) ? 'Android phone' : /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Windows/.test(navigator.userAgent) ? 'Windows computer' : 'This device');
export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// Signs this device up (or reuses its sign-up) and saves it on the server.
// fresh: a new sign-up even if the browser still holds one; a changed
// notification setting can leave it holding one the push service dropped.
async function signUp(backend, fresh = false) {
  const reg = await navigator.serviceWorker.ready;
  const { key } = await backend.invoke('alerts', { action: 'key' });
  if (!key) throw new Error('no key');
  let sub = await reg.pushManager.getSubscription();
  if (sub && (fresh || (sub.options?.applicationServerKey && b64(sub.options.applicationServerKey) !== key))) {
    const old = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    sub = null;
    await backend.dropPushSub(old).catch(() => {});
  }
  sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64(key) });
  const j = sub.toJSON();
  await backend.savePushSub({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: device(), app: 'inkwell' });
  return j.endpoint;
}

// Each time Inkwell opens with alerts on, make sure this device is still
// signed up: the phone's push service can drop it on its own.
export function renewAlerts(backend) {
  const s = read();
  if (!backend?.savePushSub || !s.on || !supported()) return;
  if (Notification.permission !== 'granted') { keep({ ...s, on: false }); return; }
  signUp(backend, true).catch((e) => console.warn('alerts: renew', e));
}

async function test(backend, endpoint) {
  if (!endpoint) endpoint = (await (await navigator.serviceWorker.ready).pushManager.getSubscription())?.endpoint;
  const r = await backend.invoke('alerts', { action: 'test', endpoint, app: 'inkwell' });
  return !!r?.sent;
}

// The panel: on or off for this device, a test, and the switches.
export async function openAlerts({ backend, signedIn, toast }) {
  if (!signedIn || !backend?.savePushSub) { toast('Sign in to sync first: alerts reach this device through your account.'); return; }
  let prefs = { ...DEFAULTS };
  try { prefs = { ...DEFAULTS, ...((await backend.alertPrefs()) || {}) }; } catch (e) { console.warn(e); }
  const back = make('div', 'ask-backdrop');
  const box = make('div', 'ask al-panel');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Phone alerts');
  const status = make('p', 'al-status');
  const msg = make('p', 'al-msg');
  const onBtn = make('button', 'pill primary al-on');
  const testBtn = make('button', 'ghost-btn al-test', 'Send a test');
  const list = make('div', 'al-kinds');
  for (const { k, name, hint } of KINDS) {
    const label = make('label', 'al-kind');
    const box2 = document.createElement('input');
    box2.type = 'checkbox';
    box2.checked = prefs[k] !== false;
    box2.dataset.kind = k;
    const words = make('span', 'al-words');
    words.append(make('b', '', name), make('small', '', hint));
    label.append(box2, words);
    list.append(label);
    box2.addEventListener('change', async () => {
      prefs = { ...prefs, [k]: box2.checked };
      try { await backend.saveAlertPrefs(prefs); msg.textContent = ''; } catch { msg.textContent = 'Couldn’t save that. Check your connection.'; box2.checked = !box2.checked; prefs[k] = box2.checked; }
    });
  }
  const close = make('button', 'ghost-btn', 'Done');
  const row = make('div', 'ask-actions');
  row.append(testBtn, close);
  box.append(make('h2', '', 'Phone alerts'), status, onBtn, msg, list, row);
  back.append(box);
  document.body.append(back);

  const draw = () => {
    const s = read();
    const on = !!s.on && supported() && Notification.permission === 'granted';
    onBtn.hidden = !supported() || Notification.permission === 'denied';
    testBtn.hidden = !on;
    onBtn.textContent = on ? 'Turn off here' : 'Turn on alerts here';
    onBtn.className = on ? 'ghost-btn al-on' : 'pill primary al-on';
    status.textContent = !supported() ? 'This browser can’t show alerts. On your phone, open Inkwell from its home screen icon.'
      : Notification.permission === 'denied' ? 'Notifications are blocked for Inkwell. Allow them in your phone’s settings (Apps, then Inkwell, then Notifications), then come back.'
        : on ? `Alerts are on for this ${phone() ? 'phone' : 'computer'}. They come from Inkwell now, not Daybook.`
          : 'Get a buzz for the things below, even when Inkwell is closed.';
  };
  draw();
  const done = () => back.remove();
  close.addEventListener('click', done);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) done(); });
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); } });
  onBtn.addEventListener('click', async () => {
    const s = read();
    onBtn.disabled = true;
    try {
      if (s.on) {
        keep({ ...s, on: false });
        const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
        if (sub) { await backend.dropPushSub(sub.endpoint).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
        msg.textContent = 'Alerts are off for this device.';
      } else {
        msg.textContent = 'Turning alerts on…';
        if (await Notification.requestPermission() !== 'granted') { msg.textContent = 'Inkwell needs permission to show notifications. Tap Allow when your phone asks.'; return; }
        const endpoint = await signUp(backend);
        keep({ ...s, on: true });
        msg.textContent = (await test(backend, endpoint)) ? 'Alerts are on. A test should buzz in a few seconds.' : 'Alerts are on, but the test didn’t go out. Turn them off and on again.';
      }
    } catch (e) {
      console.warn('alerts', e);
      msg.textContent = 'Couldn’t turn alerts on. Check your connection and try again.';
    } finally { onBtn.disabled = false; draw(); }
  });
  testBtn.addEventListener('click', async () => {
    msg.textContent = 'Sending…';
    try { msg.textContent = (await test(backend)) ? 'Test sent. It should buzz in a few seconds.' : 'The test didn’t go out. Turn alerts off and on again.'; } catch { msg.textContent = 'The test didn’t go out. Check your connection.'; }
  });
  (onBtn.hidden ? close : onBtn).focus();
}
