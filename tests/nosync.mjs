// Not a test file of its own: tests that don't stand in for the cloud use
// this, so they run as a device without sync whether or not the build has the
// Supabase settings (the publish run's build does). Every new context opens
// with window.__syncBackend = null, unless the test sets its own stand-in.
export function withoutSync(browser) {
  const open = browser.newContext.bind(browser);
  browser.newContext = async (opts = {}) => {
    // Time estimates start off on a new device; most tests were written with them
    // showing, so they're on unless a test asks for a fresh device ({ estimates: false }).
    // A phone opens a day on its Plan the first time; most tests type in the
    // day's page, so it opens on the Page unless a test asks ({ todayPage: false }).
    const { estimates = true, todayPage = true, ...rest } = opts;
    const ctx = await open(rest);
    if (todayPage) await ctx.addInitScript(() => { try { if (!localStorage.getItem('todayPhone')) localStorage.setItem('todayPhone', 'page'); } catch { /* no storage here */ } });
    await ctx.addInitScript(() => { if (!('__syncBackend' in window)) window.__syncBackend = null; });
    if (estimates) await ctx.addInitScript(() => { try { if (!localStorage.getItem('estimatesOff')) localStorage.setItem('estimatesOff', '1'); } catch { /* no storage here */ } });
    return ctx;
  };
  return browser;
}
