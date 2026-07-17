/* ============================================================================
 *  LEVELS — each level loads with the right perspective + bounds, spawners
 *  trigger as you advance, hazards are lethal, and boss gates fire.
 * ========================================================================== */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./harness');

test('all three levels load side-scrolling with sane bounds', () => {
  const g = createGame();
  const { MODE } = g.C;

  g.loadLevel(0);
  assert.equal(g.level.mode, MODE.SIDE);
  assert.match(g.level.subtitle, /VINE JUNGLE/);
  assert.ok(g.level.worldW >= 320);

  g.loadLevel(1);
  assert.equal(g.level.mode, MODE.SIDE, 'caverns are now side-scrolling');
  assert.match(g.level.subtitle, /CAVERNS/);

  g.loadLevel(2);
  assert.equal(g.level.mode, MODE.SIDE);
  assert.match(g.level.subtitle, /GRAYSKULL/);
});

test('the dormant DEPTH perspective still exists as an engine capability', () => {
  const g = createGame();
  // We converted L2 to SIDE but deliberately kept the pseudo-3D machinery.
  assert.ok(g.C.MODE.DEPTH, 'DEPTH mode constant remains');
  assert.equal(typeof g.classes.DepthProjector, 'function', 'projector class remains');
});

test('advancing past a spawner trigger spawns enemies (L1)', () => {
  const g = createGame();
  g.loadLevel(0);
  assert.equal(g.engine.enemies.length, 0, 'no enemies before any trigger');
  g.level.runSpawners(2001);       // pass the mid-boss + early triggers
  assert.ok(g.engine.enemies.length > 0, 'enemies appear once triggered');
  assert.ok(g.level.midBoss, 'the Battle Ram mid-boss is summoned by x2000');
});

test('caverns hazards are seeded and a raised spike is lethal (L2)', () => {
  const g = createGame();
  g.loadLevel(1);
  const spikes = g.level.hazards.filter((h) => h.type === 'spikes');
  const lasers = g.level.hazards.filter((h) => h.type === 'laser');
  assert.ok(spikes.length > 0 && lasers.length > 0, 'spikes and laser gates exist');

  // Stand the player squarely on a spike and force it up.
  const s = spikes[0];
  const p = g.player;
  p.x = s.x + 4; p.y = g.level.groundY - p.h; p.onGround = true; p.invuln = 0;
  g.engine.lives = 5;
  s.t = Math.floor(s.cycle * 0.75); // guarantees the "up" half of the cycle
  const before = g.engine.lives;
  g.step(1);
  assert.ok(g.engine.lives < before || p.dead, 'a raised spike kills the player');
});

test('rolling boulders spawn while inside the boulder zone (L2)', () => {
  const g = createGame();
  g.loadLevel(1);
  const p = g.player;
  p.x = 1000; p.y = g.level.groundY - p.h; p.onGround = true;
  let sawBoulder = false;
  for (let i = 0; i < 300 && !sawBoulder; i++) {
    g.keepAlive();
    g.step(1);
    sawBoulder = g.level.hazards.some((h) => h.type === 'boulder');
  }
  assert.ok(sawBoulder, 'boulders roll through the tunnel');
});

test('each level gates in its correct boss', () => {
  const { STATE } = createGame().C;

  // L1 -> Man-At-Arms
  let g = createGame();
  g.loadLevel(0);
  g.player.x = g.level.bossX - 100;
  g.step(2);
  assert.ok(g.boss instanceof g.classes.ManAtArms, 'L1 boss is Man-At-Arms');

  // L2 -> Sorceress & Stratos
  g = createGame();
  g.loadLevel(1);
  g.player.x = g.level.bossX - 100;
  g.step(2);
  assert.ok(g.boss instanceof g.classes.SorceressStratos, 'L2 boss is Sorceress & Stratos');

  // L3 -> He-Man & Battle Cat (hallway phase)
  g = createGame();
  g.loadLevel(2);
  g.level.phase = 'hallway';
  g.player.x = g.level.bossX - 100;
  g.player.y = g.level.groundY - g.player.h;
  g.step(2);
  assert.ok(g.boss instanceof g.classes.HeManBattleCat, 'L3 boss is He-Man & Battle Cat');
});
