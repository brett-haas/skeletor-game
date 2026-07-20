/* ============================================================================
 *  SOUND ENGINE — the no-op contract under the headless harness.
 *
 *  In a real browser SFX synthesizes chiptune SFX + music via Web Audio. Under
 *  Node there is no AudioContext, so the engine MUST stay inert: `enabled` is
 *  false and every public method returns without throwing. That is what lets
 *  the SFX.*() calls sprinkled through engine.js run harmlessly during tests.
 *  These tests lock that contract in place so a future change can't quietly
 *  make the sound engine explode the whole suite.
 * ========================================================================== */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./harness');

test('SFX is exposed and inert under the headless harness', () => {
  const g = createGame();
  const SFX = g.classes.SFX;
  assert.ok(SFX, 'SFX global is published by the harness');
  assert.equal(SFX.enabled, false, 'no AudioContext under Node -> disabled');
  assert.equal(SFX.ctx, null, 'context is never created without a real AudioContext');
});

test('every public SFX method is a safe no-op (never throws headless)', () => {
  const SFX = createGame().classes.SFX;
  assert.doesNotThrow(() => {
    SFX.resume();
    SFX.fire('DEFAULT'); SFX.fire('SPREAD'); SFX.fire('LASER'); SFX.fire('FLAME');
    SFX.jump(); SFX.hit(); SFX.enemyKill(); SFX.bossHit(); SFX.powerup();
    SFX.playerDeath(); SFX.menuSelect(); SFX.bossDefeat(); SFX.levelClear();
    SFX.victoryJingle(); SFX.gameOverJingle();
    SFX.playMusic('menu'); SFX.playMusic('level'); SFX.playMusic('boss');
    SFX.duckMusic(true); SFX.duckMusic(false); SFX.stopMusic();
  });
});

test('toggleMute flips the muted flag', () => {
  const SFX = createGame().classes.SFX;
  const start = SFX.muted;
  SFX.toggleMute();
  assert.equal(SFX.muted, !start, 'mute toggles');
  SFX.toggleMute();
  assert.equal(SFX.muted, start, 'and toggles back');
});

test('a full playthrough drives the SFX/music hooks without throwing', () => {
  // Exercises the engine paths that now call SFX (fire, jump, mute key,
  // _syncMusic across states) to prove the wiring is harness-safe.
  const g = createGame();
  g.start();
  g.tap('KeyM');                 // mute toggle path in update()
  g.hold('KeyD', 'KeyJ');
  assert.doesNotThrow(() => g.step(120));
  g.tap('KeyK');                 // jump path
  assert.doesNotThrow(() => g.step(30));
});
