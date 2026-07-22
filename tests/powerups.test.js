/* ============================================================================
 *  POWER-UPS — the full pickup lifecycle, which had ZERO coverage: a slain
 *  drop-carrier spawns a collectible; it settles onto solid ground; touching it
 *  grants the weapon; and an uncollected one times out. (weapons.test.js sets
 *  weapons via setWeapon directly, bypassing this entire path.)
 * ========================================================================== */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./harness');

test('a slain drop-carrying enemy spawns a collectible power-up', () => {
  const g = createGame();
  g.loadLevel(0);
  const { Enemy } = g.classes;
  const W = g.C.WEAPON;
  const p = g.player;

  g.engine.enemies.length = 0;
  g.engine.powerups.length = 0;
  const e = new Enemy(p.x + 40, p.y, { hp: 1, behavior: 'walker', drop: W.FLAME });
  g.engine.enemies.push(e);
  g.engine.spawnPlayerShot(e.x + e.w / 2, e.y + e.h / 2, 0, 0, { r: 3, dmg: 1, kind: 'skull' });
  g.step(1);

  assert.equal(e.dead, true, 'the carrier falls');
  assert.equal(g.engine.powerups.length, 1, 'a pickup drops where it fell');
  assert.equal(g.engine.powerups[0].type, W.FLAME, 'carrying the promised weapon');
});

test('no power-up spawns from a slain carrier while powerups are disabled', () => {
  const g = createGame();
  g.loadLevel(0);
  const { Enemy } = g.classes;
  const W = g.C.WEAPON;
  const p = g.player;

  g.engine.powerupsDisabled = true;   // the hidden pure-combat toggle
  g.engine.enemies.length = 0;
  g.engine.powerups.length = 0;
  const e = new Enemy(p.x + 40, p.y, { hp: 1, behavior: 'walker', drop: W.FLAME });
  g.engine.enemies.push(e);
  g.engine.spawnPlayerShot(e.x + e.w / 2, e.y + e.h / 2, 0, 0, { r: 3, dmg: 1, kind: 'skull' });
  g.step(1);

  assert.equal(e.dead, true, 'the carrier still falls');
  assert.equal(g.engine.powerups.length, 0, 'but its drop is strangled in the cradle');
});

test("the hidden 'P' key toggles the disable flag and sweeps the field", () => {
  const g = createGame();
  g.loadLevel(0);
  const { PowerUp } = g.classes;

  g.engine.powerups.length = 0;
  g.engine.powerups.push(new PowerUp(g.player.x + 60, g.player.y, g.C.WEAPON.LASER));

  // First tap: disable — flag flips and any pickup on the field is swept away.
  g.tap('KeyP'); g.step(1);
  assert.equal(g.engine.powerupsDisabled, true, 'the flag flips on');
  assert.equal(g.engine.powerups.length, 0, 'and the field is cleared');

  // Second tap: restore — flag flips back, nothing re-spawns.
  g.tap('KeyP'); g.step(1);
  assert.equal(g.engine.powerupsDisabled, false, 'the flag flips back off');
  assert.equal(g.engine.powerups.length, 0, 'and nothing is conjured back');
});

test('a power-up settles onto the ground and grants its weapon when touched', () => {
  const g = createGame();
  g.loadLevel(0);
  const { PowerUp } = g.classes;
  const W = g.C.WEAPON;
  const p = g.player;
  p.setWeapon(W.DEFAULT);

  g.engine.powerups.length = 0;
  const pu = new PowerUp(p.x + 60, p.y - 40, W.LASER);   // spawned airborne
  g.engine.powerups.push(pu);
  g.step(90);                                            // fall + settle

  assert.equal(pu.grounded, true, 'gravity settles it onto a platform');

  // Skeletor steps onto it.
  p.x = pu.x; p.y = pu.y;
  g.step(1);

  assert.equal(p.weapon, W.LASER, 'the grounded pickup is claimed');
  assert.equal(g.engine.powerups.length, 0, 'and consumed');
});

test('an uncollected power-up expires after 700 frames', () => {
  const g = createGame();
  g.loadLevel(0);
  const { PowerUp } = g.classes;
  const p = g.player;

  g.engine.powerups.length = 0;
  // Far from the player so it is never picked up before it times out.
  g.engine.powerups.push(new PowerUp(p.x + 240, p.y, g.C.WEAPON.SPREAD));

  g.step(699);
  assert.equal(g.engine.powerups.length, 1, 'still lingering just before the timeout');
  g.step(3);
  assert.equal(g.engine.powerups.length, 0, 'gone once t passes 700');
});
