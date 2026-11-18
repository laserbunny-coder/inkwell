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
    // Drafts rest the phone's bar as a tab (Nov 14 2026); older tests tap the bar
    // straight away, so it stays up in drafts unless a test asks ({ quietDrafts: true }).
    // Plan rows start plain (Nov 15 2026); older tests click a row's details, so
    // they show unless a test asks ({ rowDetails: false }). Today opens on Now
    // when today has tasks; older tests expect the day's page, so it opens there
    // unless a test asks ({ todayNow: true }). Training puts a line on each day
    // (Nov 15 2026); older tests count today's lines, so it starts off unless a
    // test asks ({ training: true }). First light (the morning reading) comes
    // before anything else in Now, so it starts off too ({ firstlight: true }).
    const { estimates = true, todayPage = true, quietDrafts = false, rowDetails = true, todayNow = false, training = false, firstlight = false, ...rest } = opts;
    const ctx = await open(rest);
    if (todayPage) await ctx.addInitScript(() => { try { if (!localStorage.getItem('todayPhone')) localStorage.setItem('todayPhone', 'page'); } catch { /* no storage here */ } });
    await ctx.addInitScript(() => { if (!('__syncBackend' in window)) window.__syncBackend = null; });
    if (!quietDrafts) await ctx.addInitScript(() => { try { if (!localStorage.getItem('hide')) localStorage.setItem('hide', '["quietdrafts"]'); } catch { /* no storage here */ } });
    if (estimates) await ctx.addInitScript(() => { try { if (!localStorage.getItem('estimatesOff')) localStorage.setItem('estimatesOff', '1'); } catch { /* no storage here */ } });
    if (rowDetails) await ctx.addInitScript(() => { try { if (!localStorage.getItem('rowDetailsOff')) localStorage.setItem('rowDetailsOff', '1'); } catch { /* no storage here */ } });
    if (!training) await ctx.addInitScript(() => { try { if (!localStorage.getItem('trainingOffOnce')) { const h = JSON.parse(localStorage.getItem('hide') || '[]'); if (!h.includes('training')) h.push('training'); localStorage.setItem('hide', JSON.stringify(h)); localStorage.setItem('trainingOffOnce', '1'); } } catch { /* no storage here */ } });
    const on = [training && 'training', firstlight && 'firstlight'].filter(Boolean).join(',');
    if (on) await ctx.addInitScript((on) => { try { localStorage.setItem('autoOn', on); } catch { /* no storage here */ } }, on);
    if (!firstlight) await ctx.addInitScript(() => { try { if (!localStorage.getItem('firstlightOffOnce')) { const h = JSON.parse(localStorage.getItem('hide') || '[]'); if (!h.includes('firstlight')) h.push('firstlight'); localStorage.setItem('hide', JSON.stringify(h)); localStorage.setItem('firstlightOffOnce', '1'); } } catch { /* no storage here */ } });
    if (!todayNow) await ctx.addInitScript(() => { try { if (!localStorage.getItem('todayOpens')) localStorage.setItem('todayOpens', 'page'); } catch { /* no storage here */ } });
    return ctx;
  };
  return browser;
}
