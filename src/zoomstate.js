// Is the zoom on? (Nov 17 2026, Part 1 of the zoom build.)
//
// The zoom is one ruler at the bottom: Year, Weeks, Week, Today | Now |
// Project, Desk, Library. It takes the place of the rail on a computer, the
// phone's bottom bar and Today's Now / Page / Plan / Calendar switch. Until
// the old views are retired (Part 6), one Look switch, "Classic layout",
// brings all of those back. It is kept per device in localStorage "layout".
//
// index.html puts html.zoom on before the first paint, so nothing jumps.
// A pane beside never has the ruler: it is a window inside the window.

const root = document.documentElement;

export const zoomOn = () => root.classList.contains('zoom');

export function classicLayout() {
  try { return localStorage.getItem('layout') === 'classic'; } catch { return false; }
}

export function setClassicLayout(on) {
  try { if (on) localStorage.setItem('layout', 'classic'); else localStorage.removeItem('layout'); } catch { /* private window */ }
  root.classList.toggle('zoom', !on && window.parent === window);
  document.dispatchEvent(new CustomEvent('inkwell:layout', { detail: on ? 'classic' : 'zoom' }));
}
