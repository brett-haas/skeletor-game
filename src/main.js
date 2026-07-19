/* ============================================================================
 *  SKELETOR'S CONQUEST — BOOTSTRAP
 *  Seize the throne — instantiate the engine on load.
 * ========================================================================== */

'use strict';

/* ============================================================================
 * [10] BOOTSTRAP — seize the throne.
 * ========================================================================== */

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('screen');
  // Mark the body BEFORE the engine measures the viewport — the adaptive
  // reshape needs to know whether to reserve space for the desktop hint bar.
  if (isTouchDevice() && document.body) document.body.classList.add('touch');
  const engine = new GameEngine(canvas);
  engine.start();
  // Expose for tinkering from the console, my minion.
  window.SKELETOR = engine;

  setupTouchControls(engine);
});

/* Is this a touch-PRIMARY device? `?touch` / `?touch=1` forces YES (desktop
 * testing), `?touch=0` forces NO (keyboard on a hybrid machine); otherwise gate
 * on `pointer: coarse` rather than mere touch-capability. Shared by the
 * bootstrap and setupTouchControls so both agree. */
function isTouchDevice() {
  const q = typeof location !== 'undefined' ? (location.search || '') : '';
  const forceOff = /[?&]touch=0\b/.test(q);
  const forceOn = !forceOff && /[?&]touch(=1)?\b/.test(q);
  const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  return forceOn || (!forceOff && coarse);
}

/* ============================================================================
 * TOUCH CONTROLS — the fingertip legion.
 *   On-screen pad + buttons that feed the SAME key Sets the keyboard does
 *   (via input.press / input.release), so the engine is none the wiser.
 *   Entirely inert on non-touch devices and under the test harness, which has
 *   neither `ontouchstart` nor a `document.body`.
 * ========================================================================== */
function setupTouchControls(engine) {
  // The bootstrap already added `touch` to <body> for touch-primary devices;
  // wire the controls only when it did. (Inert under the harness — no body.)
  if (typeof document === 'undefined' || !document.body
      || !document.body.classList.contains('touch')) return;

  // Banish the browser's chrome-bars: request true fullscreen on the FIRST
  // user gesture (the API demands one), then never again. Best-effort — some
  // browsers (iOS Safari) forbid it, in which case the adaptive scaling already
  // fills the viewport. Re-fit once fullscreen settles, since innerHeight jumps
  // when the bars vanish (and the aspect — hence VW — shifts with it).
  const refit = () => { if (typeof engine._applyViewport === 'function') engine._applyViewport(); };
  const goFullscreen = () => {
    document.removeEventListener('pointerdown', goFullscreen);
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) {
      try {
        const p = req.call(el);
        if (p && p.then) p.then(refit, refit); else setTimeout(refit, 100);
      } catch (_) { /* No matter — the scaling stands on its own. */ }
    }
  };
  document.addEventListener('pointerdown', goFullscreen);
  document.addEventListener('fullscreenchange', refit);

  const input = engine.input;
  const $ = (id) => document.getElementById(id);

  /* ---- Left thumb: 8-way directional pad -> Arrow keys ---- */
  const pad = $('pad');
  const DIRS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  let held = { up: false, down: false, left: false, right: false };

  function applyDir(next) {
    for (const k in DIRS) {
      if (next[k] && !held[k]) input.press(DIRS[k]);
      else if (!next[k] && held[k]) input.release(DIRS[k]);
    }
    held = next;
    // Light the pressed arm(s) of the NES cross D-pad.
    if (pad) {
      pad.classList.toggle('up', next.up);
      pad.classList.toggle('down', next.down);
      pad.classList.toggle('left', next.left);
      pad.classList.toggle('right', next.right);
    }
  }

  function padMove(e) {
    const r = pad.getBoundingClientRect();
    const radius = r.width / 2;
    const dx = e.clientX - (r.left + radius);
    const dy = e.clientY - (r.top + radius);
    const dead = radius * 0.30;   // deadzone: no direction near center
    const t = radius * 0.30;      // per-axis threshold -> clean diagonals
    const live = Math.hypot(dx, dy) >= dead;
    applyDir({
      left:  live && dx < -t,
      right: live && dx > t,
      up:    live && dy < -t,
      down:  live && dy > t,
    });
  }

  function padEnd() {
    applyDir({ up: false, down: false, left: false, right: false });
    if (pad) pad.classList.remove('active');
  }

  if (pad) {
    // Only the FIRST pointer to land steers; a stray second touch (palm graze,
    // thumb roll) must not hijack or release the thumb that is still aiming.
    let padId = null;
    pad.addEventListener('pointerdown', (e) => {
      if (padId !== null) return;      // already steering with another finger
      padId = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      pad.classList.add('active');
      padMove(e);
      e.preventDefault();
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === padId) padMove(e);
    });
    const end = (e) => {
      if (e.pointerId !== padId) return;
      padId = null;
      padEnd();
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    // Same safety net as the buttons: a stolen capture must not strand a
    // direction key in the held Set and send the player walking forever.
    pad.addEventListener('lostpointercapture', (e) => {
      if (e.pointerId === padId) { padId = null; padEnd(); }
    });
  }

  /* ---- Right thumb + menu: momentary buttons ---- */
  function holdButton(el, onDown, onUp) {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      el.classList.add('active');
      onDown();
      e.preventDefault();
    });
    const up = () => { el.classList.remove('active'); if (onUp) onUp(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    // Safety net: if the browser steals capture (fullscreen swap, gesture
    // takeover) the pointerup may never land — release anyway so no key sticks.
    el.addEventListener('lostpointercapture', up);
  }

  holdButton($('btnFire'), () => input.press('KeyJ'), () => input.release('KeyJ'));
  holdButton($('btnJump'), () => input.press('KeyK'), () => input.release('KeyK'));
  // One button covers every menu transition: SPACE toggles pause while
  // PLAYING/PAUSED; ENTER starts from the menu and returns from game-over /
  // victory. The states are mutually exclusive, so firing both is harmless.
  holdButton($('btnMenu'),
    () => { input.press('Space'); input.press('Enter'); },
    () => { input.release('Space'); input.release('Enter'); });

  // Re-fit on orientation changes (some browsers don't emit `resize`).
  // A rotate flips the aspect, so re-run the full reshape, not just the scale.
  window.addEventListener('orientationchange', refit);
}
