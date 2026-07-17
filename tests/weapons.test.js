/* ============================================================================
 *  WEAPONS — each power-up fires the right shape of shot, respects its
 *  cooldown, and the FLAME rebalance holds (top single-target DPS + falloff).
 *  BARRIER grants timed invulnerability.
 * ========================================================================== */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./harness');

// Fire exactly one volley of `weapon` (facing right) and return shots spawned.
function oneVolley(g, weapon) {
  g.loadLevel(0);
  const p = g.player;
  p.setWeapon(weapon);
  p.facing = 1;
  p.cooldown = 0;
  g.engine.shots.length = 0;
  g.hold('KeyJ');
  g.step(1);          // fires once (cooldown was 0)
  g.releaseAll();
  return g.engine.shots.slice();
}

test('each weapon fires the expected number of projectiles', () => {
  const g = createGame();
  const W = g.C.WEAPON;
  assert.equal(oneVolley(g, W.DEFAULT).length, 1, 'DEFAULT: one bolt');
  assert.equal(oneVolley(g, W.SPREAD).length, 5, 'SPREAD: five-skull fan');
  assert.equal(oneVolley(g, W.LASER).length, 1, 'LASER: one ring');
  assert.equal(oneVolley(g, W.FLAME).length, 2, 'FLAME: two embers per tick');
  assert.equal(oneVolley(g, W.BARRIER).length, 1, 'BARRIER: one bolt');
});

test('LASER shots pierce; DEFAULT shots do not', () => {
  const g = createGame();
  assert.equal(oneVolley(g, g.C.WEAPON.LASER)[0].pierce, true);
  assert.equal(oneVolley(g, g.C.WEAPON.DEFAULT)[0].pierce, false);
});

test('firing sets the weapon-specific cooldown', () => {
  const g = createGame();
  const { Weapons } = g.classes;
  oneVolley(g, g.C.WEAPON.FLAME);
  assert.equal(g.player.cooldown, Weapons[g.C.WEAPON.FLAME].cooldown);
});

test('BARRIER grants ~15s of invulnerability', () => {
  const g = createGame();
  g.loadLevel(0);
  g.player.setWeapon(g.C.WEAPON.BARRIER);
  assert.ok(g.player.barrierTime >= 60 * 14, 'roughly 15 seconds at 60fps');
  assert.ok(g.player.invulnerable, 'barrier makes you invulnerable');
});

// Measure single-target DPS against a parked, high-HP dummy.
function dps(g, weapon, gap) {
  g.loadLevel(0);
  const { Enemy } = g.classes;
  const p = g.player;
  g.step(30);                                  // let Skeletor settle on the floor
  p.setWeapon(weapon); p.facing = 1; p.cooldown = 0;
  const px = p.x, py = p.y;
  const dummy = new Enemy(px + gap, py - 2, { w: 20, h: 30, hp: 1e7, behavior: 'turret' });
  dummy.fireT = 1e9;
  g.engine.enemies = [dummy];
  g.hold('KeyJ');
  const FRAMES = 180;
  for (let i = 0; i < FRAMES; i++) {
    p.x = px; p.y = py; p.vx = 0; p.vy = 0; p.onGround = true;   // freeze in place
    g.step(1);
    dummy.dead = false; dummy.hp = Math.max(1, dummy.hp); dummy.x = px + gap; dummy.y = py - 2;
  }
  g.releaseAll();
  return (1e7 - dummy.hp) / (FRAMES / 60);
}

test('FLAME is the top single-target DPS, well above DEFAULT and SPREAD', () => {
  const g = createGame();
  const W = g.C.WEAPON;
  const flame = dps(g, W.FLAME, 18);
  const def = dps(g, W.DEFAULT, 18);
  const spread = dps(g, W.SPREAD, 18);
  assert.ok(flame > def * 3, `FLAME (${flame}) should dwarf DEFAULT (${def})`);
  assert.ok(flame > spread, `FLAME (${flame}) should beat SPREAD point-blank (${spread})`);
});

test('FLAME falls off hard at range (short-range weapon)', () => {
  const g = createGame();
  const near = dps(g, g.C.WEAPON.FLAME, 18);
  const far = dps(g, g.C.WEAPON.FLAME, 140);
  assert.ok(near > 40, `point-blank FLAME should be strong (got ${near})`);
  assert.ok(far < near * 0.25, `FLAME should be feeble at 140px (near ${near}, far ${far})`);
});
