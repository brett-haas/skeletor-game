/* ============================================================================
 *  COMBAT — the life-loss guards and enemy contact death. One hazard must cost
 *  exactly ONE life, and a hit while already dead or mid-i-frames must cost
 *  NONE (the guard at the top of killPlayer is the only thing stopping a single
 *  frame from draining the whole run). Prior tests only ever checked "lives
 *  didn't drop FURTHER", never the single-decrement contract itself.
 * ========================================================================== */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./harness');

test('killPlayer costs exactly one life', () => {
  const g = createGame();
  g.loadLevel(0);
  const p = g.player;
  p.invuln = 0;
  g.engine.lives = 3;

  g.engine.killPlayer();

  assert.equal(g.engine.lives, 2, 'one death, one life — no more, no less');
  assert.equal(p.dead, true, 'Skeletor falls');
});

test('a hit while invulnerable costs no life', () => {
  const g = createGame();
  g.loadLevel(0);
  const p = g.player;
  p.invuln = 30;                  // mercy / barrier i-frames active
  g.engine.lives = 3;

  g.engine.killPlayer();

  assert.equal(g.engine.lives, 3, 'i-frames spare the life');
  assert.equal(p.dead, false, 'and spare Skeletor');
});

test('touching a grounded enemy kills a vulnerable player (SIDE contact)', () => {
  const g = createGame();
  g.loadLevel(0);
  const { Enemy } = g.classes;
  const p = g.player;
  p.invuln = 0;
  g.engine.lives = 3;

  g.engine.enemies.length = 0;
  // A foe sitting right on top of the player — bodies overlap.
  g.engine.enemies.push(new Enemy(p.x, p.y, { hp: 5, behavior: 'walker', w: 16, h: 22 }));
  g.step(1);

  assert.equal(p.dead, true, 'a touch is death');
  assert.equal(g.engine.lives, 2, 'and it costs one life');
});

test('an invulnerable player survives an overlapping enemy', () => {
  const g = createGame();
  g.loadLevel(0);
  const { Enemy } = g.classes;
  const p = g.player;
  p.invuln = 120;
  g.engine.lives = 3;

  g.engine.enemies.length = 0;
  g.engine.enemies.push(new Enemy(p.x, p.y, { hp: 5, behavior: 'walker', w: 16, h: 22 }));
  g.step(1);

  assert.equal(p.dead, false, 'the shield holds against contact');
  assert.equal(g.engine.lives, 3, 'no life lost');
});
