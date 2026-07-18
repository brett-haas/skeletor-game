/* ============================================================================
 *  SKELETOR'S CONQUEST — INPUT MANAGER
 *  Set-based multi-key capture + 8-directional aim vectoring.
 * ========================================================================== */

'use strict';

/* ============================================================================
 * [2] INPUT MANAGER
 *   A Set captures concurrent key state so diagonal aim vectors are exact.
 *   `pressed` holds edge-triggered keys (consumed once) for jump/start/pause.
 * ========================================================================== */

class Input {
  constructor() {
    this.keys = new Set();      // currently held (raw key codes)
    this.pressed = new Set();   // pressed THIS frame (edge)
    this._bind();
  }

  _bind() {
    const codeFor = (e) => e.code;
    window.addEventListener('keydown', (e) => {
      const c = codeFor(e);
      // Stop the browser from scrolling on our control keys.
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(c)) e.preventDefault();
      if (!e.repeat) this.pressed.add(c);
      this.keys.add(c);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(codeFor(e)));
    window.addEventListener('blur', () => this.keys.clear());
  }

  held(code)     { return this.keys.has(code); }
  tapped(code)   { return this.pressed.has(code); }
  endFrame()     { this.pressed.clear(); }

  // ---- Synthetic input (on-screen touch controls) ----
  // Touch buttons feed the SAME key Sets the keyboard does, so the engine
  // never learns of their existence. `press` mirrors a keydown edge; `release`
  // mirrors a keyup. Skeletor's will, delivered by fingertip or key alike.
  // Every touch press is a discrete, intentional tap, so ALWAYS re-arm the
  // edge — never guard on `keys.has`. A dropped pointerup (fullscreen swap,
  // lost capture, a finger sliding off) would otherwise leave the code stuck
  // in `keys` and silently swallow every future press. That was the curse.
  press(code)   { this.pressed.add(code); this.keys.add(code); }
  release(code) { this.keys.delete(code); }

  // ---- Semantic control helpers (WASD + J/K/Space) ----
  get up()    { return this.held('KeyW') || this.held('ArrowUp'); }
  get down()  { return this.held('KeyS') || this.held('ArrowDown'); }
  get left()  { return this.held('KeyA') || this.held('ArrowLeft'); }
  get right() { return this.held('KeyD') || this.held('ArrowRight'); }
  // `tapped` catches a jab so fast it pressed AND released between two sim
  // steps (its release clears `keys` but never `pressed`) — one shot still fires.
  get fire()  { return this.held('KeyJ') || this.tapped('KeyJ'); }

  // Jump is edge-triggered on K alone. ArrowUp is bound to AIM-up (see the `up`
  // getter and aimVector), never to jump — so it is deliberately excluded. The
  // old one-liner tangled in a self-cancelling `... === false && ...` clause
  // that (by operator precedence) collapsed back to plain `tapped('KeyK')`.
  jumpTapped()  { return this.tapped('KeyK'); }

  /**
   * 8-directional AIM vector, fully decoupled from movement.
   * Returns a normalized-ish {x,y}. Defaults to `facing` when idle.
   */
  aimVector(facing) {
    let ax = 0, ay = 0;
    if (this.left)  ax -= 1;
    if (this.right) ax += 1;
    if (this.up)    ay -= 1;
    if (this.down)  ay += 1;

    if (ax === 0 && ay === 0) {
      ax = facing; ay = 0;            // idle -> shoot where you face
    }
    // Normalize so diagonals aren't faster than cardinals.
    const m = Math.hypot(ax, ay) || 1;
    return { x: ax / m, y: ay / m };
  }
}
