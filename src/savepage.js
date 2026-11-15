// The little window the Save to Inkwell bookmark opens (save.html?url=&title=).
// It keeps the link in the inbox, then asks any Inkwell already open in this
// browser to take it: that one puts it on today's page, quietly, and this
// window says so and closes itself. When no Inkwell answers, this window
// grows into Inkwell itself, which lands the link as it opens.
import { keepShare, SAVE_CHANNEL } from './inbox.js';

const asked = new URLSearchParams(location.search);
const url = asked.get('url') || '';
const title = asked.get('title') || '';
const said = document.getElementById('sv-said');
const what = document.getElementById('sv-what');
what.textContent = title || url;

// How long an open Inkwell gets to answer before a new one is opened.
const WAIT = Number(asked.get('wait')) || 900;

function openInkwell() {
  said.textContent = 'Opening Inkwell…';
  // Opened by the bookmark, so this window may grow; a browser that says no
  // still opens Inkwell here.
  try { window.moveTo(screen.availLeft || 0, screen.availTop || 0); window.resizeTo(screen.availWidth, screen.availHeight); } catch { /* fine */ }
  location.replace(new URL('./', location.href).href);
}

async function save() {
  if (!url) { said.textContent = 'Nothing to save on this page'; setTimeout(() => window.close(), 2500); return; }
  try { await keepShare({ url, title }); } catch (e) {
    // No storage here (a private window, say): Inkwell itself takes the link.
    console.error(e);
    location.replace(new URL(`./?save=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`, location.href).href);
    return;
  }
  if (!('BroadcastChannel' in window)) { openInkwell(); return; }
  const ch = new BroadcastChannel(SAVE_CHANNEL);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const answered = new Promise((resolve) => {
    ch.onmessage = (e) => { if (e.data?.heard === id) resolve(true); };
    setTimeout(() => resolve(false), WAIT);
  });
  ch.postMessage({ save: id });
  if (await answered) {
    ch.close();
    said.textContent = 'Saved to today’s page';
    said.classList.add('done');
    document.title = 'Saved to Inkwell';
    setTimeout(() => window.close(), 1400);
  } else {
    ch.close();
    openInkwell();
  }
}
save();
