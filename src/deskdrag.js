// Moving things around the Desk by hand: a project card in the grid, a row in
// the wings or backstage, a call inside a card, a thread in a card's crew.
//
// With a mouse: press on it and drag (a click still clicks). On a phone, as in
// the day plan and the outline: press and hold until it lifts (a quick swipe
// still scrolls), then slide it where it goes. A line shows where it will land.
//
// Anything that can move carries data-drag (its kind) and data-key; the lists
// it can move within carry data-drop with the same kind. A project can go
// from one list to another (the grid, the wings, backstage); a call or a
// thread stays in its own list. drop({ kind, key, from, to, keys }) hears the
// move: to is the list it landed in, keys that list's order after the move.

const HOLD = 400; // ms held on a phone before it lifts
const START = 6; // px a mouse moves before a press becomes a drag

export function deskDrags(root, { drop, busy }) {
  let d = null; // { el, kind, x, y, lastX, lastY, moving, touch, armed, timer, lift, dx, dy, spot, raf }
  const html = document.documentElement;
  const bar = document.createElement('div');
  bar.className = 'dk-dropbar';
  bar.hidden = true;

  const movable = (target) => {
    if (target.closest?.('input, select, textarea, [contenteditable="plaintext-only"], [contenteditable="true"], .dk-more, .dk-span, .dk-switch')) return null;
    return target.closest?.('[data-drag]');
  };

  // The list under a point that this kind can land in, and where in it.
  const spotAt = (x, y) => {
    const under = document.elementFromPoint(x, y);
    let list = under?.closest?.(`[data-drop="${d.kind}"]`);
    // A call or a thread only moves within its own list: away from it, it goes back.
    if (d.kind !== 'seat') {
      list = d.el.closest(`[data-drop="${d.kind}"]`);
      const r = list.getBoundingClientRect();
      if (x < r.left - 40 || x > r.right + 40 || y < r.top - 40 || y > r.bottom + 40) return null;
    }
    if (!list) {
      // Between lists (a gap, a heading): the nearest list of this kind.
      let best = null, far = Infinity;
      for (const l of root.querySelectorAll(`[data-drop="${d.kind}"]`)) {
        const r = l.getBoundingClientRect();
        const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        if (dist < far) { far = dist; best = l; }
      }
      if (!best || far > 80) return null;
      list = best;
    }
    const items = [...list.children].filter((c) => c.dataset.drag === d.kind);
    const grid = getComputedStyle(list).display === 'grid' && getComputedStyle(list).gridTemplateColumns.split(' ').length > 1;
    let best = null, far = Infinity;
    for (const it of items) {
      const r = it.getBoundingClientRect();
      const cx = Math.max(r.left, Math.min(x, r.right)), cy = Math.max(r.top, Math.min(y, r.bottom));
      const dist = Math.hypot(x - cx, y - cy);
      if (dist < far) { far = dist; best = { it, r }; }
    }
    if (!best) return { list, before: null, grid, empty: true };
    const { it, r } = best;
    const after = grid ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
    return { list, before: after ? it.nextElementSibling : it, ref: it, after, grid, r };
  };

  const showBar = (s) => {
    if (!s) { bar.hidden = true; return; }
    if (!bar.isConnected) document.body.append(bar);
    bar.hidden = false;
    const lr = s.list.getBoundingClientRect();
    if (s.empty) { Object.assign(bar.style, { left: `${lr.left}px`, top: `${lr.top}px`, width: `${lr.width}px`, height: '2px' }); bar.className = 'dk-dropbar'; return; }
    if (s.grid) {
      const x = s.after ? s.r.right : s.r.left;
      Object.assign(bar.style, { left: `${x - 1}px`, top: `${s.r.top + 8}px`, width: '2px', height: `${Math.max(24, s.r.height - 16)}px` });
      bar.className = 'dk-dropbar up';
    } else {
      const y = s.after ? s.r.bottom : s.r.top;
      Object.assign(bar.style, { left: `${s.r.left}px`, top: `${y - 1}px`, width: `${s.r.width}px`, height: '2px' });
      bar.className = 'dk-dropbar';
    }
  };

  // The page scrolls inside <main> on a desktop and as a whole on a phone.
  const scroller = () => {
    const m = root.closest('main');
    return m && m.scrollHeight > m.clientHeight + 2 && getComputedStyle(m).overflowY !== 'visible' ? m : null;
  };

  const begin = () => {
    d.moving = true;
    busy(true);
    const r = d.el.getBoundingClientRect();
    // A whole project card would cover the page: what rides along is its name.
    const card = d.el.matches('.dk-chair');
    const lift = card ? document.createElement('div') : d.el.cloneNode(true);
    if (card) lift.append(d.el.querySelector('h3').cloneNode(true));
    lift.removeAttribute('data-drag');
    lift.querySelectorAll('[data-drag], [data-drop], [id]').forEach((x) => { x.removeAttribute('data-drag'); x.removeAttribute('data-drop'); x.removeAttribute('id'); });
    lift.classList.add('dk-lift');
    lift.setAttribute('aria-hidden', 'true');
    Object.assign(lift.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${card ? Math.min(r.width, 380) : d.kind === 'seat' ? Math.min(r.width, 520) : r.width}px` });
    if (card) lift.classList.add('dk-lift-card');
    // Inside the Desk, so it keeps the Desk's own look.
    root.append(lift);
    d.lift = lift;
    d.dx = d.x - r.left;
    // On a phone it rides just above the finger, so where it lands stays in sight.
    d.dy = d.touch ? lift.offsetHeight + 14 : card ? Math.min(d.y - r.top, lift.offsetHeight / 2) : d.y - r.top;
    d.dx = card ? Math.min(d.dx, lift.offsetWidth - 20) : d.dx;
    d.el.classList.add('dk-dragging');
    html.classList.add('dk-moving');
    getSelection()?.removeAllRanges?.();
    if (d.touch) navigator.vibrate?.(8);
    const edge = 72;
    const step = () => {
      if (!d?.moving) return;
      const y = d.lastY;
      const speed = y < edge ? -Math.ceil((edge - y) / 6) : y > innerHeight - edge ? Math.ceil((y - (innerHeight - edge)) / 6) : 0;
      if (speed) {
        const s = scroller();
        if (s) s.scrollTop += speed; else window.scrollBy(0, speed);
        d.spot = spotAt(d.lastX, y);
        showBar(d.spot);
      }
      d.raf = requestAnimationFrame(step);
    };
    d.raf = requestAnimationFrame(step);
  };

  const follow = (x, y) => {
    d.lastX = x;
    d.lastY = y;
    d.lift.style.left = `${x - d.dx}px`;
    d.lift.style.top = `${y - d.dy}px`;
    d.spot = spotAt(x, y);
    showBar(d.spot);
  };

  const end = () => {
    if (!d) return;
    clearTimeout(d.timer);
    cancelAnimationFrame(d.raf);
    d.lift?.remove();
    d.el.classList.remove('dk-dragging', 'dk-armed');
    html.classList.remove('dk-moving');
    bar.hidden = true;
    if (d.armed || d.moving) {
      // A held thing stays out of picking words for a moment after.
      html.classList.add('dk-calm');
      setTimeout(() => html.classList.remove('dk-calm'), 400);
    }
    const was = d;
    d = null;
    if (was.moving) busy(false);
  };

  const land = () => {
    const { el, kind, spot } = d;
    const from = el.closest(`[data-drop="${kind}"]`);
    end();
    if (!spot) return;
    const { list, before } = spot;
    // Let go where it already was: nothing to do.
    if (before === el || (list === from && (before ? before.previousElementSibling === el : list.lastElementChild === el))) return;
    list.insertBefore(el, before);
    const keys = [...list.children].map((c) => c.dataset.key).filter(Boolean);
    drop({ kind, key: el.dataset.key, from, to: list, keys });
  };

  // ---- a mouse (or a pen) ----
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0 || d) return;
    const el = movable(e.target);
    if (!el) return;
    d = { el, kind: el.dataset.drag, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moving: false, touch: false };
    const move = (ev) => {
      if (!d) return;
      if (!d.moving) {
        if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < START) return;
        begin();
      }
      ev.preventDefault();
      follow(ev.clientX, ev.clientY);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cancel);
      if (!d) return;
      if (!d.moving) { end(); return; }
      // The click that ends a drag isn't a click on whatever is underneath.
      const swallow = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
      addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => removeEventListener('click', swallow, { capture: true }), 0);
      land();
    };
    const cancel = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel); end(); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', cancel);
  });
  // Links and their text would start the browser's own drag instead.
  root.addEventListener('dragstart', (e) => { if (movable(e.target)) e.preventDefault(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && d?.moving) { e.preventDefault(); end(); } }, true);

  // ---- a finger ----
  root.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { end(); return; }
    const el = movable(e.target);
    if (!el) return;
    end();
    const { clientX: x, clientY: y } = e.touches[0];
    d = { el, kind: el.dataset.drag, x, y, lastX: x, lastY: y, moving: false, touch: true, armed: false };
    d.timer = setTimeout(() => {
      if (!d) return;
      d.armed = true;
      el.classList.add('dk-armed');
      html.classList.add('dk-calm');
      getSelection()?.removeAllRanges?.();
      navigator.vibrate?.(12);
    }, HOLD);
  }, { passive: true });
  root.addEventListener('touchmove', (e) => {
    if (!d?.touch) return;
    const { clientX: x, clientY: y } = e.touches[0];
    if (!d.armed) {
      if (Math.hypot(x - d.x, y - d.y) > 10) end(); // a scroll, not a hold
      return;
    }
    e.preventDefault();
    if (!d.moving) {
      if (Math.hypot(x - d.x, y - d.y) < START) return;
      begin();
    }
    follow(x, y);
  }, { passive: false });
  root.addEventListener('touchend', (e) => {
    if (!d?.touch) return;
    if (!d.moving) {
      // Held still and let go: it settles back, and nothing underneath is tapped.
      if (d.armed) e.preventDefault();
      end();
      return;
    }
    e.preventDefault();
    land();
  });
  root.addEventListener('touchcancel', () => { if (d?.touch) end(); });
  // Android's own long-press menu comes at about half a second: once held, it waits.
  root.addEventListener('contextmenu', (e) => {
    if (d?.touch && (d.armed || d.moving)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
}

// Put things in the order you left them. Anything the list hasn't seen yet
// (a new project, a new call) comes first, in the order it would have had, so
// nothing new is ever tucked out of sight.
export function inOrder(list, keyOf, order) {
  if (!Array.isArray(order) || !order.length) return list;
  const at = new Map(order.map((k, i) => [k, i]));
  const fresh = list.filter((x) => !at.has(keyOf(x)));
  const known = list.filter((x) => at.has(keyOf(x))).sort((a, b) => at.get(keyOf(a)) - at.get(keyOf(b)));
  return [...fresh, ...known];
}

// A list's new order, keeping the places of things not on screen just now
// (a project that has dropped out of the last two weeks keeps its spot).
export function mergeOrder(shown, stored = []) {
  const seen = new Set(shown);
  const out = [...shown];
  stored.forEach((k, i) => {
    if (seen.has(k)) return;
    // Put it back after whatever came before it last time.
    let j = i - 1;
    while (j >= 0 && !out.includes(stored[j])) j -= 1;
    out.splice(j < 0 ? 0 : out.indexOf(stored[j]) + 1, 0, k);
    seen.add(k);
  });
  return out;
}
