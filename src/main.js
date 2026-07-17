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
  const engine = new GameEngine(canvas);
  engine.start();
  // Expose for tinkering from the console, my minion.
  window.SKELETOR = engine;

  setupTouchControls(engine);
});

/* ============================================================================
 * TOUCH CONTROLS — the fingertip legion.
 *   On-screen pad + buttons that feed the SAME key Sets the keyboard does
 *   (via input.press / input.release), so the engine is none the wiser.
 *   Entirely inert on non-touch devices and under the test harness, which has
 *   neither `ontouchstart` nor a `document.body`.
 * ========================================================================== */
function setupTouchControls(engine) {
  // `?touch=0` forces the desktop layout even on a touch device (escape hatch
  // for keyboard users on hybrid machines); `?touch` (or `?touch=1`) forces it
  // ON for desktop testing. Absent an override, gate on `pointer: coarse` — a
  // touch-PRIMARY device — rather than mere touch-capability, so a Surface or
  // touch-laptop driven by keyboard keeps its desktop layout.
  const q = typeof location !== 'undefined' ? (location.search || '') : '';
  const forceOff = /[?&]touch=0\b/.test(q);
  const forceOn = !forceOff && /[?&]touch(=1)?\b/.test(q);
  const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  const hasTouch = forceOn || (!forceOff && coarse);
  if (!hasTouch || typeof document === 'undefined' || !document.body) return;

  document.body.classList.add('touch');
  if (typeof engine._fitCanvas === 'function') engine._fitCanvas();

  const input = engine.input;
  const $ = (id) => document.getElementById(id);

  /* ---- Left thumb: 8-way directional pad -> Arrow keys ---- */
  const pad = $('pad');
  const nub = pad && pad.querySelector('.nub');
  const DIRS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  let held = { up: false, down: false, left: false, right: false };

  function applyDir(next) {
    for (const k in DIRS) {
      if (next[k] && !held[k]) input.press(DIRS[k]);
      else if (!next[k] && held[k]) input.release(DIRS[k]);
    }
    held = next;
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
    if (nub) {
      const mag = Math.hypot(dx, dy) || 1;
      const c = Math.min(mag, radius) / mag;   // clamp nub inside the ring
      nub.style.transform = `translate(calc(-50% + ${dx * c}px), calc(-50% + ${dy * c}px))`;
    }
  }

  function padEnd() {
    applyDir({ up: false, down: false, left: false, right: false });
    if (pad) pad.classList.remove('active');
    if (nub) nub.style.transform = 'translate(-50%, -50%)';
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
  window.addEventListener('orientationchange', () => {
    if (typeof engine._fitCanvas === 'function') engine._fitCanvas();
  });
}
