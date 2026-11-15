// Is the phone's keyboard up? The one answer the bottom of the phone goes by.
import { media } from './device.js';
//
// It used to be "the caret is in some text" (focus), but Android's back
// gesture puts the keyboard away and leaves the caret where it was, and a page
// can take the caret by itself without any keyboard. Either way the bar stayed
// hidden. So the keyboard counts as up only when it is really coming or there:
//
//  - a tap on something you type in, and the caret arriving
//    there, brings it up (the phone opens it for a tap; this is how we know
//    before it has finished sliding up);
//  - the visible part of the page shrinking by more than a keyboard's worth
//    while the caret is in text (it came up some other way);
//  - it goes down when the caret leaves the text, when the visible page grows
//    back after having shrunk (Android back, the keyboard's own hide key), or
//    when down() is called (the row's down arrow).
//
// A page that puts the caret in its text by itself, with no tap, therefore
// leaves the keyboard down and the bar showing. A physical keyboard on a
// phone never shrinks the page, so the row shows only after a tap.
//
// Sets body.kb-up and tells whoever listens. Nothing else may set kb-up.

const SHRUNK = 150; // px of page hidden: a keyboard is in the way
const GROWN = 80; // back within this of the full height: it has gone

const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName) && !/^(checkbox|radio|range|button|submit|color|file)$/.test(el.type)) && !el.closest('.palette.box');
const editableAt = (t) => t?.closest?.('[contenteditable="true"], input, textarea');

class Keyboard {
  constructor() {
    this.up = false;
    this.armed = 0; // when a finger last touched something you type in
    this.shrunk = false; // the page shrank while the caret was in text
    this.listeners = new Set();
    this.touch = media('touch');
    this.full = window.innerHeight;
    document.addEventListener('pointerdown', (e) => {
      if (!this.touch.matches) return;
      if (typing(editableAt(e.target)) || typing(e.target)) this.armed = Date.now();
    }, true);
    // A tap on text that already has the caret brings the keyboard back up.
    document.addEventListener('click', (e) => {
      if (!this.touch.matches || !this.armed || Date.now() - this.armed > 1000) return;
      if (typing(document.activeElement) && document.activeElement.contains(e.target)) this.set(true);
    }, true);
    document.addEventListener('focusin', (e) => {
      if (!this.touch.matches || !typing(e.target)) return;
      if (Date.now() - this.armed < 1000 || this.hidden() > SHRUNK) this.set(true);
    });
    document.addEventListener('focusout', () => setTimeout(() => {
      if (!typing(document.activeElement)) { this.shrunk = false; this.set(false); }
    }, 50));
    const vv = window.visualViewport;
    const measure = () => {
      if (!this.touch.matches) return;
      const gone = this.hidden();
      if (gone > SHRUNK) { if (typing(document.activeElement)) { this.shrunk = true; this.set(true); } }
      else if (gone < GROWN && this.shrunk) { this.shrunk = false; this.set(false); }
    };
    vv?.addEventListener('resize', measure);
    vv?.addEventListener('scroll', measure);
    // Turning the phone changes the full height; the keyboard isn't up then.
    window.addEventListener('resize', () => { if (!this.up) this.full = window.innerHeight; });
    window.addEventListener('orientationchange', () => { this.full = window.innerHeight; });
  }

  // How much of the page the keyboard (or anything) hides at the bottom.
  hidden() {
    const vv = window.visualViewport;
    if (!vv) return 0;
    return Math.max(this.full, window.innerHeight) - (vv.height + vv.offsetTop);
  }

  set(up) {
    if (up === this.up) return;
    this.up = up;
    document.body.classList.toggle('kb-up', up);
    for (const f of this.listeners) f(up);
  }

  // The row's down arrow: the caret leaves the text, so the phone drops the keyboard.
  down() {
    const el = document.activeElement;
    this.shrunk = false;
    this.set(false);
    if (typing(el)) el.blur();
  }

  onChange(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
}

export const keyboard = new Keyboard();
// Tests stand in for the phone opening its keyboard with window.__keyboard.set(true).
window.__keyboard = keyboard;
