// Not a test file of its own: a phone opens a day on its Plan the first time
// (Nov 14 2026). Tests that write in the day's page on a phone use this, so a
// day opens on its Page, as it did before. withoutSync (nosync.mjs) does the same.
export function pageFirst(browser) {
  const open = browser.newContext.bind(browser);
  browser.newContext = async (opts = {}) => {
    const ctx = await open(opts);
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('todayPhone')) localStorage.setItem('todayPhone', 'page'); } catch { /* no storage here */ } });
    return ctx;
  };
  return browser;
}
