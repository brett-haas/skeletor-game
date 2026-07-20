/* ============================================================================
 *  TEST HARNESS — mounts SKELETOR'S CONQUEST in a headless mock realm.
 *
 *  The game is written as classic <script> files that share one global scope.
 *  Here we concatenate them, run them inside a fresh function scope per game
 *  (so every test gets an isolated engine), and stub out just enough of the
 *  browser (canvas 2D context, window, document, rAF) to let the real engine
 *  loop run. Tests then drive it deterministically frame-by-frame.
 *
 *  These are INTEGRATION tests: they exercise the actual GameEngine update/
 *  render loop, collisions, levels and bosses — not isolated functions.
 *
 *  Usage:
 *    const { createGame } = require('./harness');
 *    const g = createGame();            // fresh, seeded (deterministic) game
 *    g.start();                         // MENU -> PLAYING
 *    g.hold('KeyD', 'KeyJ'); g.step(60);
 *    assert.equal(g.engine.state, g.C.STATE.PLAYING);
 * ========================================================================== */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SRC_DIR = path.join(__dirname, '..', 'src');

// Load order mirrors index.html's <script> tags exactly.
const LOAD_ORDER = [
  'config.js', 'sound.js', 'utils.js', 'input.js', 'camera.js', 'weapons.js',
  'entities.js', 'bosses.js', 'levels.js', 'engine.js', 'main.js',
];

// Names lifted out of the game's scope so tests can construct/inspect them.
const EXPORTS = [
  'GameEngine', 'Input', 'Camera', 'DepthProjector', 'Weapons',
  'Player', 'Projectile', 'Enemy', 'PowerUp', 'Particle',
  'Level', 'Level1', 'Level2', 'Level3',
  'ManAtArms', 'SorceressStratos', 'HeManBattleCat',
  'STATE', 'WEAPON', 'MODE', 'PAL', 'VW', 'VH', 'GRAVITY', 'AIR_DRAG', 'BARRIER_TIME',
  'MOVE_ACCEL', 'MOVE_MAX_SPEED', 'JUMP_VELOCITY', 'TURN_BOOST',
  'RISE_GRAVITY', 'FALL_GRAVITY',
  'clamp', 'lerp', 'rand', 'randInt', 'sign', 'aabb',
  'SFX',
];

// Concatenate the game once at module load, with an epilogue that publishes
// the game's classes/constants onto globalThis for capture after each run.
const GAME_SOURCE =
  LOAD_ORDER.map((f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8')).join('\n\n') +
  `\n;globalThis.__SKELETOR_EXPORTS__ = { ${EXPORTS.join(', ')} };`;

// The pristine native Math.random, captured once at module load — BEFORE any
// createGame() overwrites the global with a seeded PRNG. seed:0 games restore
// this so "real random" means real random, not the last test's leftover seed.
const NATIVE_RANDOM = Math.random;

// A seedable PRNG so "random" enemy/hazard timing is reproducible in tests.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A canvas 2D context that accepts every call/assignment and returns sane
// stubs for the few methods whose return value the engine actually reads.
function mockContext() {
  const noop = () => {};
  return new Proxy({}, {
    get(target, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop: noop });
      }
      if (prop === 'measureText') return () => ({ width: 8 });
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return typeof prop === 'string' ? (target[prop] ?? noop) : noop;
    },
    set() { return true; },
  });
}

/**
 * Build a fresh, isolated game instance.
 * @param {object} [opts]
 * @param {number} [opts.seed=1] Deterministic RNG seed (set 0 for real random).
 * @param {boolean} [opts.render=true] Also call engine.render() each step to
 *        catch drawing exceptions (recommended).
 */
function createGame(opts = {}) {
  const seed = opts.seed === undefined ? 1 : opts.seed;
  const doRender = opts.render !== false;

  // ---- Fresh browser stubs ----
  const ctx = mockContext();
  const canvas = { width: 426, height: 240, style: {}, getContext: () => ctx };
  const listeners = Object.create(null);
  const addListener = (type, fn) => {
    (listeners[type] || (listeners[type] = [])).push(fn);
  };

  global.window = { innerWidth: 1280, innerHeight: 800, addEventListener: addListener };
  global.document = {
    getElementById: (id) => (id === 'screen' ? canvas : { style: {} }),
    addEventListener: addListener,
  };
  global.performance = { now: () => 0 };
  global.requestAnimationFrame = () => 0; // never auto-runs; tests step manually
  Math.random = seed !== 0 ? mulberry32(seed) : NATIVE_RANDOM;

  // ---- Run a fresh copy of the whole game in an isolated function scope ----
  // new Function bodies close over the GLOBAL scope (so window/document/etc.
  // resolve to our stubs) while their top-level declarations stay local to
  // this invocation — giving perfect per-test isolation with no redeclaration.
  // eslint-disable-next-line no-new-func
  new Function(GAME_SOURCE)();
  const G = globalThis.__SKELETOR_EXPORTS__;

  // main.js registers the bootstrap on DOMContentLoaded; fire it to build the
  // engine and set window.SKELETOR.
  (listeners.DOMContentLoaded || []).forEach((fn) => fn());
  const engine = global.window.SKELETOR;

  // ---- Input helpers ----
  const fire = (type, code) =>
    (listeners[type] || []).forEach((fn) => fn({ code, repeat: false, preventDefault() {} }));

  const api = {
    engine,
    classes: G,
    C: { STATE: G.STATE, WEAPON: G.WEAPON, MODE: G.MODE, VW: G.VW, VH: G.VH, GRAVITY: G.GRAVITY, BARRIER_TIME: G.BARRIER_TIME },

    get player() { return engine.player; },
    get level() { return engine.level; },
    get boss() { return engine.boss; },

    /** Hold key(s) down (stay held across frames until released). */
    hold(...codes) { codes.forEach((c) => fire('keydown', c)); return api; },
    /** Release held key(s). */
    release(...codes) { codes.forEach((c) => fire('keyup', c)); return api; },
    /** Clear all held keys. */
    releaseAll() { engine.input.keys.clear(); return api; },
    /** A single-frame press (edge trigger), e.g. jump / start / pause. */
    tap(code) { fire('keydown', code); fire('keyup', code); return api; },

    /** Advance the simulation n logic frames (rendering each, by default). */
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        engine.update();
        if (doRender) engine.render();
      }
      return api;
    },

    /** MENU -> PLAYING. */
    start() { api.tap('Enter'); api.step(1); return api; },

    /** Jump straight to a level in PLAYING state. */
    loadLevel(i) {
      engine.levelIndex = i;
      engine.loadLevel(i);
      engine.state = G.STATE.PLAYING;
      return api;
    },

    /** Keep the player alive on a SIDE level: pin to the ground, refresh
     *  i-frames. Used by progression tests that verify flow, not skill. */
    keepAlive() {
      const p = engine.player;
      const g = engine.level.groundY;
      if (g !== undefined) { p.y = g - p.h; p.vy = 0; p.onGround = true; }
      p.invuln = Math.max(p.invuln, 4);
      return api;
    },
  };

  return api;
}

module.exports = { createGame };
