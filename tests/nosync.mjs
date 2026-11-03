// Not a test file of its own: tests that don't stand in for the cloud use
// this, so they run as a device without sync whether or not the build has the
// Supabase settings (the publish run's build does). Every new context opens
// with window.__syncBackend = null, unless the test sets its own stand-in.
export function withoutSync(browser) {
  const open = browser.newContext.bind(browser);
  browser.newContext = async (opts) => {
    const ctx = await open(opts);
    await ctx.addInitScript(() => { if (!('__syncBackend' in window)) window.__syncBackend = null; });
    return ctx;
  };
  return browser;
}
