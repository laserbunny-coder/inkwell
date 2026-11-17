// Not a test file of its own. The zoom (Nov 2026) is how Inkwell opens now,
// with one ruler at the bottom; the older tests were written for the rail, the
// phone's bottom bar and Today's switch, which "Classic layout" (Look) still
// brings back until Part 6 retires them. So every new context in a test that
// uses this opens in the Classic layout, unless the test asks for the zoom
// ({ zoom: true }). tests/zoom.mjs tests the zoom itself.
export function classic(browser) {
  const open = browser.newContext.bind(browser);
  browser.newContext = async (opts = {}) => {
    const { zoom = false, ...rest } = opts;
    const ctx = await open(rest);
    if (!zoom) await ctx.addInitScript(() => { try { if (!localStorage.getItem('layout')) localStorage.setItem('layout', 'classic'); } catch { /* no storage here */ } });
    return ctx;
  };
  return browser;
}
