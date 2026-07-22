/* ============================================================================
 *  PROJECTILES — the homing-steering contract.
 *
 *  A homing Projectile steers by lerping its velocity toward the player each
 *  frame. Because a lerp between two equal-length vectors is SHORTER than
 *  either (a chord is shorter than the radius), naive steering bleeds speed
 *  toward zero over successive turns — a homing bolt that turns hard slows to
 *  a crawl and stalls mid-air. `homingKeepSpeed` opts a projectile into
 *  renormalizing that result back to a constant pace.
 *
 *  The flag is OPT-IN: the Level 2 Sorceress bolt uses it; the Level 3 homing
 *  turret does NOT, so its bolts keep their original speed-decay behavior.
 *  These tests pin both sides of that switch.
 * ========================================================================== */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./harness');

// Launch a bolt and return its speed (|v|) sampled after each of `frames`
// updates. The player is pinned up-and-left of the bolt, which is launched to
// the right — a genuine 2D turn that forces sustained steering.
function steerSpeeds(keepSpeed, frames = 40) {
  const g = createGame();
  g.loadLevel(1);
  const p = g.player;
  p.x = 100; p.y = 100; p.dead = false;
  const b = new g.classes.Projectile(400, 400, 2.0, 0, {
    homing: 0.035, homingKeepSpeed: keepSpeed, life: 999,
  });
  const speeds = [];
  for (let i = 0; i < frames; i++) {
    b.update(g.engine);
    speeds.push(Math.hypot(b.vx, b.vy));
  }
  return speeds;
}

test('homingKeepSpeed holds a bolt at constant speed through a hard turn', () => {
  const speeds = steerSpeeds(true);
  for (const s of speeds) {
    assert.ok(Math.abs(s - 2.0) < 1e-6,
      `speed must stay locked at the 2.0 launch pace (got ${s})`);
  }
});

test('without homingKeepSpeed, steering bleeds speed toward zero (default, unchanged)', () => {
  const speeds = steerSpeeds(false);
  assert.ok(speeds[0] < 2.0, 'speed already dips on the first turning frame');
  // Over a sustained turn it collapses to a crawl — the original stall bug that
  // the Level 3 turret still relies on for its balance.
  assert.ok(speeds.at(-1) < 0.6,
    `speed should decay to a crawl (got ${speeds.at(-1)})`);
});

test('homingKeepSpeed is off by default — a plain homing bolt still decays', () => {
  const g = createGame();
  g.loadLevel(1);
  const b = new g.classes.Projectile(0, 0, 2, 0, { homing: 0.03 });
  assert.equal(b.homingKeepSpeed, false, 'the flag is opt-in, never on by accident');
});
