// Phone alerts: Inkwell buzzes this phone or computer even when it's closed
// (Web Push; public/sw.js shows them). The server sends to the devices that
// turned them on here. Since Nov 18 2026 there is one kind: a Claude thread
// putting something on Needs you. So the whole choice is on or off for this
// device. Turning alerts on signs this device up (push_subs, marked app
// 'inkwell').

import { make } from './menu.js';
import { mobileOS } from './device.js';

const KEY = 'inkwell-alerts';

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const keep = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* full */ } };
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const phone = mobileOS;
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

// The panel: on or off for this device, and a test.
export async function openAlerts({ backend, signedIn, toast }) {
  if (!signedIn || !backend?.savePushSub) { toast('Sign in to sync first: alerts reach this device through your account.'); return; }
  const back = make('div', 'ask-backdrop');
  const box = make('div', 'ask al-panel');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Phone alerts');
  const status = make('p', 'al-status');
  const msg = make('p', 'al-msg');
  const onBtn = make('button', 'pill primary al-on');
  const testBtn = make('button', 'ghost-btn al-test', 'Send a test');
  const close = make('button', 'ghost-btn', 'Done');
  const row = make('div', 'ask-actions');
  row.append(testBtn, close);
  box.append(make('h2', '', 'Phone alerts'), status, onBtn, msg, row);
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
        : on ? `Alerts are on for this ${phone() ? 'phone' : 'computer'}: you hear when a Claude thread needs you.`
          : 'Get a buzz when a Claude thread needs you, even when Inkwell is closed.';
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
