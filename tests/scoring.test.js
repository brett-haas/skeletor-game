/* ============================================================================
 *  SCORING — the three exact point awards (+100 kill, +250 pickup, +5000 level
 *  clear) and the clean-slate reset on a fresh run. These fire through the real
 *  engine loop; the only prior score check in the suite was a loose `score > 0`
 *  in the playthrough, satisfied by boss bonuses alone and pinning no value.
 * ========================================================================== */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./harness');

test('killing an enemy awards exactly +100', () => {
  const g = createGame();
  g.loadLevel(0);
  const { Enemy } = g.classes;
  const p = g.player;

  // A lone, 1-HP foe well clear of the player (no contact death), with a shot
  // parked dead-centre on it so a single step lands the killing blow.
  g.engine.enemies.length = 0;
  const e = new Enemy(p.x + 40, p.y, { hp: 1, behavior: 'walker' });
  g.engine.enemies.push(e);
  g.engine.shots.length = 0;
  g.engine.spawnPlayerShot(e.x + e.w / 2, e.y + e.h / 2, 0, 0, { r: 3, dmg: 1, kind: 'skull' });

  const before = g.engine.score;
  g.step(1);

  assert.equal(e.dead, true, 'the foe falls to the bone bolt');
  assert.equal(g.engine.score, before + 100, 'a kill is worth exactly 100');
});

test('grabbing a power-up awards exactly +250 and swaps the weapon', () => {
  const g = createGame();
  g.loadLevel(0);
  const { PowerUp, WEAPON } = { ...g.classes, WEAPON: g.C.WEAPON };
  const p = g.player;
  p.setWeapon(WEAPON.DEFAULT);

  g.engine.powerups.length = 0;
  const pu = new PowerUp(p.x, p.y, WEAPON.SPREAD);
  pu.grounded = true;             // pin it so it can't drift off the player this frame
  g.engine.powerups.push(pu);

  const before = g.engine.score;
  g.step(1);

  assert.equal(p.weapon, WEAPON.SPREAD, 'the pickup replaces the current weapon');
  assert.equal(g.engine.score, before + 250, 'a pickup is worth exactly 250');
});

test('clearing a level awards +5000 and runs the clear -> advance sequence', () => {
  const g = createGame({ render: false });   // no draw pass, so a bare boss stub suffices
  g.loadLevel(0);                 // level 0 of 3 — not the finale

  // Stand in for the defeated stage boss. _updateBoss still ticks .update()
  // before the completion block reads .dead, so the stub carries a no-op.
  g.engine.boss = { dead: true, update() {} };
  const before = g.engine.score;
  g.step(1);

  assert.equal(g.engine.score, before + 5000, 'a level clear is worth exactly 5000');
  assert.equal(g.engine.boss, null, 'the vanquished boss is cleared');
  assert.equal(g.engine.bannerText, 'CONQUEST! LEVEL CLEARED!', 'the clear banner is raised');
  // The completion frame arms the timer to 90 AND decrements it the same tick.
  assert.equal(g.engine._levelClearTimer, 89, 'the advance timer is armed and ticking');

  g.step(89);                     // let the timer expire -> advanceLevel()
  assert.equal(g.engine.levelIndex, 1, 'the campaign advances to level 2');
  assert.equal(g.engine.state, g.C.STATE.LEVEL_TRANSITION, 'entering the transition');
});

test('startGame resets score, lives and levelIndex to a clean run', () => {
  const g = createGame();
  // Soil the state as a mid-campaign run would leave it.
  g.engine.score = 12345;
  g.engine.lives = 1;
  g.engine.levelIndex = 2;

  g.engine.startGame();

  assert.equal(g.engine.score, 0, 'score wiped to zero');
  assert.equal(g.engine.lives, 3, 'lives restored to three');
  assert.equal(g.engine.levelIndex, 0, 'back to the first level');
});
