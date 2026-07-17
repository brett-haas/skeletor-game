/* ============================================================================
 *  PLAYTHROUGH — end-to-end progression + crash-safety ("soak").
 *
 *  1) An ASSISTED bot drives the whole campaign L1 -> L2 -> L3 -> VICTORY.
 *     It keeps Skeletor alive (this verifies FLOW and boss WEAK-POINT damage
 *     paths, not player skill) and defeats each boss by striking its actual
 *     weak point, then asserts the state machine reaches VICTORY with no throw.
 *
 *  2) A chaos-soak hammers each level with random input and simply requires
 *     that nothing ever throws — deaths, respawns and game-overs included.
 * ========================================================================== */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./harness');

// A stand-in player projectile centred at (x, y).
function shot(x, y, dmg = 4) {
  return { x, y, dmg, pierce: false, hitbox: () => ({ x: x - 3, y: y - 3, w: 6, h: 6 }) };
}

// Apply damage to whichever boss is present, at its correct weak point.
function hammer(boss, C) {
  if (boss instanceof C.ManAtArms) {
    const cb = boss.coreBox();
    boss.hitTest(shot(cb.x + cb.w / 2, cb.y + cb.h / 2, 3));
  } else if (boss instanceof C.SorceressStratos) {
    const s = boss.stratos, q = boss.sorc;
    if (s.alive) boss.hitTest(shot(s.x + s.w / 2, s.y + s.h / 2));
    else boss.hitTest(shot(q.x + q.w / 2, q.y + q.h / 2));
  } else if (boss instanceof C.HeManBattleCat) {
    if (boss.phase === 1) {
      boss.hitTest(shot(boss.cat.x + boss.cat.w / 2, boss.cat.y + boss.cat.h / 2));
    } else {
      boss.hero.charging = true; // open the sword-charge weak window
      boss.hitTest(shot(boss.hero.x + boss.hero.w / 2, boss.hero.y + boss.hero.h / 2));
    }
  }
}

test('full campaign reaches VICTORY: L1 -> L2 -> L3', () => {
  const g = createGame();
  const { STATE } = g.C;
  g.start();
  assert.equal(g.engine.state, STATE.PLAYING);

  const levelsSeen = new Set();
  let frames = 0;
  const MAX = 40000;

  while (g.engine.state !== STATE.VICTORY && frames < MAX) {
    if (g.engine.state === STATE.PLAYING) {
      levelsSeen.add(g.engine.levelIndex);
      if (g.boss) {
        hammer(g.boss, g.classes);        // strike the weak point
      } else {
        g.hold('KeyD', 'KeyJ');           // advance to the boss gate
        g.player.x += 6;
      }
      g.keepAlive();
    }
    g.step(1);
    frames++;
  }

  assert.equal(g.engine.state, STATE.VICTORY, `campaign completed (frames=${frames})`);
  assert.deepEqual([...levelsSeen].sort(), [0, 1, 2], 'played all three levels');
  assert.ok(g.engine.score > 0, 'score accumulated along the way');
});

test('every level survives chaotic input without ever throwing', () => {
  const keys = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyK'];
  for (const idx of [0, 1, 2]) {
    const g = createGame({ seed: 100 + idx });
    g.loadLevel(idx);
    for (let i = 0; i < 900; i++) {
      if (i % 6 === 0) {
        g.releaseAll();
        g.hold(keys[Math.floor(Math.random() * keys.length)], 'KeyJ');
      }
      if (i % 41 === 0) g.tap('KeyK');
      g.step(1); // throws here would fail the test
    }
    assert.ok(true, `level ${idx + 1} soaked 900 frames of chaos`);
  }
});
