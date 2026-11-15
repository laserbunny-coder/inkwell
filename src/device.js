// One answer to "what kind of screen is this?", for the JS and the CSS alike.
//
// The CSS writes these as custom media, `@media (--touch)` and so on; the
// build (vite.config.js) swaps each one for its query below, so the two can
// never drift apart. Layout breakpoints that only fit one view (a 1,100 px
// plan column, a 1,500 px desk) stay where they are: they're about room on
// the screen, not about the device.
//
// The questions, and what each answers in the edge cases:
// - touch: nothing hovers (no mouse). Phones and tablets. A touch laptop with
//   a trackpad or mouse hovers, so it is NOT touch: it gets the computer's
//   layout and keys, and taps still work there.
// - mouse: the opposite of touch. A touch laptop is a mouse device.
// - phone: touch with a finger-sized pointer. Phones and tablets alike. A
//   small desktop window is never a phone, however narrow.
// - finger: the main pointer is a finger, hovering or not (things a finger
//   can't do, such as dragging a button to the bookmarks bar).
// - narrow: 700 px wide or less, whatever the device. A small desktop window
//   gets the narrow layout (one column, phone-sized text) but keeps its keys,
//   its hover and its top bar.
// - wide: 701 px or more. A tablet held sideways is wide (and still touch).
// - roomy: wide AND a mouse: the computer's layout with its edge panels that
//   come down as the mouse nears them.
// - compact: under 900 px wide, or touch. Panels that need room beside the
//   text (Beside, the pull pane, the Calendar's hour grid) step aside here.
// - smallish: narrow, or touch. Pop-ups that become bottom sheets.
export const QUERIES = {
  touch: '(hover: none)',
  mouse: '(hover: hover)',
  phone: '(hover: none) and (pointer: coarse)',
  finger: '(pointer: coarse)',
  narrow: '(max-width: 700px)',
  wide: '(min-width: 701px)',
  roomy: '(min-width: 701px) and (hover: hover)',
  compact: '(max-width: 899px), (hover: none)',
  smallish: '(max-width: 700px), (hover: none)'
};

const lists = {};
// The live MediaQueryList for a question (for .matches and change events).
export function media(name) {
  if (!QUERIES[name]) throw new Error(`device.js: no question called ${name}`);
  return (lists[name] ||= window.matchMedia(QUERIES[name]));
}

// Asked afresh each time, as the code did before (a test or a browser may
// swap window.matchMedia after start).
const now = (name) => window.matchMedia(QUERIES[name]).matches;
export const isTouch = () => now('touch');
export const isPhone = () => now('phone');
export const isNarrow = () => now('narrow');
export const isCompact = () => now('compact');

// Calls fn whenever the answer to any of the named questions changes (a window
// resized past 700 px, a mouse plugged into a tablet). Returns a stop function.
export function onDeviceChange(fn, names = Object.keys(QUERIES)) {
  const ls = names.map(media);
  for (const l of ls) l.addEventListener('change', fn);
  return () => { for (const l of ls) l.removeEventListener('change', fn); };
}

// The operating system is a phone's or tablet's (for wording such as "this
// phone"; alerts are per device, and a touch laptop is still a computer).
export const mobileOS = () => /Android|iPhone|iPad/.test(navigator.userAgent);
