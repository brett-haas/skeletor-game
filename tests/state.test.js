/* ============================================================================
 *  STATE MACHINE — MENU / PLAYING / PAUSED / LEVEL_TRANSITION / GAME_OVER /
 *  VICTORY transitions, respawn, and weapon-loss on death.
 * ========================================================================== */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./harness');

test('boots into MENU', () => {
  const g = createGame();
  assert.equal(g.engine.state, g.C.STATE.MENU);
});

test('ENTER starts the game at level 1', () => {
  const g = createGame();
  g.start();
  assert.equal(g.engine.state, g.C.STATE.PLAYING);
  assert.equal(g.engine.levelIndex, 0);
  assert.ok(g.player, 'a player exists once playing');
});

test('SPACE toggles pause on and off', () => {
  const g = createGame();
  g.start();
  g.tap('Space').step(1);
  assert.equal(g.engine.state, g.C.STATE.PAUSED);
  g.tap('Space').step(1);
  assert.equal(g.engine.state, g.C.STATE.PLAYING);
});

test('running out of lives ends in GAME_OVER', () => {
  const g = createGame();
  g.start();
  g.engine.lives = 1;
  g.engine.killPlayer();      // -> dead, lives 0, respawn timer running
  g.step(60);
  assert.equal(g.engine.state, g.C.STATE.GAME_OVER);
});

test('death (with lives to spare) respawns and STRIPS the power-up', () => {
  const g = createGame();
  g.start();
  g.engine.lives = 3;
  g.player.setWeapon(g.C.WEAPON.SPREAD);
  assert.equal(g.player.weapon, g.C.WEAPON.SPREAD);
  g.engine.killPlayer();
  g.step(60);
  assert.equal(g.engine.state, g.C.STATE.PLAYING, 'still playing after respawn');
  assert.equal(g.player.dead, false);
  assert.equal(g.player.weapon, g.C.WEAPON.DEFAULT, 'one-hit death costs your weapon');
  assert.ok(g.player.invuln > 0, 'brief mercy i-frames on respawn');
});

test('clearing a non-final level runs LEVEL_TRANSITION then loads the next', () => {
  const g = createGame();
  g.start();               // level 0
  g.engine.advanceLevel(); // simulate a boss clear on L1
  assert.equal(g.engine.state, g.C.STATE.LEVEL_TRANSITION);
  g.step(130);             // transition timer elapses
  assert.equal(g.engine.state, g.C.STATE.PLAYING);
  assert.equal(g.engine.levelIndex, 1, 'advanced to level 2');
});

test('clearing the final level ends in VICTORY', () => {
  const g = createGame();
  g.start();
  g.engine.levelIndex = 2;         // final level
  g.engine.advanceLevel();
  assert.equal(g.engine.state, g.C.STATE.VICTORY);
});

test('ENTER from an end screen returns to MENU', () => {
  const g = createGame();
  g.start();
  g.engine.state = g.C.STATE.VICTORY;
  g.tap('Enter').step(1);
  assert.equal(g.engine.state, g.C.STATE.MENU);
});

// A player is "supported" when a solid floor platform spans their column and
// their feet rest on its top (the landing snap sets p.y = plat.y - p.h, so
// feet === plat.y). Respawning ANYWHERE else means the void.
function restingOnFloor(lvl, p, tol = 4) {
  const cx = p.x + p.w / 2;
  const feet = p.y + p.h;
  return lvl.platforms.some(
    (pl) => !pl.gone && pl.x <= cx && pl.x + pl.w >= cx && Math.abs(feet - pl.y) <= tol
  );
}

test('REGRESSION: respawn lands on solid ground at every checkpoint (all SIDE levels)', () => {
  // The old respawn clamped Y to the virtual SCREEN height (VH=240). In the
  // 1400px-tall Level 3 shaft that dropped Skeletor far below every platform,
  // into a fall-and-die loop. Respawn must snap onto the actual floor beneath
  // the checkpoint, whatever the world's height.
  for (const idx of [0, 1, 2]) {
    const g = createGame();
    g.start();
    g.loadLevel(idx);
    const lvl = g.level;
    for (const cx of lvl.checkpoints) {
      const p = g.player;
      g.engine.lives = 5;
      p.dead = false;
      p.invuln = 0;              // clear prior-respawn i-frames so the kill lands
      p.x = cx;                  // checkpointFor(cx) resolves to this checkpoint
      p.y = lvl.startY;
      g.engine.killPlayer();
      g.step(50);                // respawn fires at frame 45; still within i-frames
      assert.equal(g.engine.state, g.C.STATE.PLAYING,
        `L${idx + 1} @${cx}: still PLAYING after respawn`);
      assert.equal(p.dead, false, `L${idx + 1} @${cx}: alive after respawn`);
      assert.ok(p.y + p.h <= lvl.worldH,
        `L${idx + 1} @${cx}: respawn stays inside the world ` +
        `(feet=${(p.y + p.h).toFixed(0)}, worldH=${lvl.worldH})`);
      assert.ok(restingOnFloor(lvl, p),
        `L${idx + 1} @${cx}: respawn lands on a floor, not the void ` +
        `(y=${p.y.toFixed(0)})`);
    }
  }
});

test('REGRESSION: dying in tall Level 3 does not cause a respawn death-loop', () => {
  const g = createGame();
  g.start();
  g.loadLevel(2);                 // Castle Grayskull: 2600x1400 tall world
  const p = g.player;
  g.engine.lives = 5;
  p.x = 2000;                     // a hallway checkpoint, high above the shaft floor
  g.engine.killPlayer();
  const livesAfterDeath = g.engine.lives;   // one death only: 5 -> 4

  // Step well past the 45-frame respawn delay AND the 90-frame mercy i-frames,
  // clearing combat each frame so only respawn PHYSICS decides survival.
  for (let i = 0; i < 220; i++) {
    g.engine.enemies.length = 0;
    g.engine.enemyShots.length = 0;
    g.step(1);
  }

  assert.notEqual(g.engine.state, g.C.STATE.GAME_OVER,
    'no cascade to GAME_OVER from a respawn death-loop');
  assert.equal(g.engine.state, g.C.STATE.PLAYING);
  assert.equal(p.dead, false, 'player is alive, not mid-death');
  assert.equal(g.engine.lives, livesAfterDeath,
    'lives do not keep draining after a single death');
  assert.ok(p.y + p.h <= g.level.worldH,
    `player rests inside the world, not falling forever (y=${p.y.toFixed(0)})`);
});
