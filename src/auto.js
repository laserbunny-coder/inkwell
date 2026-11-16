// What comes by itself each day (Training's line, First light before the
// day) stays out of automated test runs (navigator.webdriver) unless a test
// turns it on: localStorage 'autoOn' = 'training,firstlight'. Real browsers
// are never automated, so for Michael it is always on.
export function autoOn(name) {
  if (!navigator.webdriver) return true;
  try { return (localStorage.getItem('autoOn') || '').split(',').includes(name); } catch { return false; }
}
