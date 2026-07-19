/* ============================================================================
 *  INPUT — the 8-directional aim vector, decoupled from movement. Diagonals are
 *  normalized so they are no faster than cardinals, and an idle aim falls back
 *  to `facing`. The `|| 1` guard on the magnitude keeps a facing-0 idle from
 *  dividing by zero and poisoning every projectile spawn with NaN.
 * ========================================================================== */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./harness');

const DIAG = Math.SQRT1_2;   // ~0.7071 — a normalized diagonal component
const EPS = 1e-9;

// Aim with a given set of held codes and facing, off a clean key Set.
function aim(g, codes, facing) {
  const inp = g.engine.input;
  inp.keys.clear();
  codes.forEach((c) => inp.keys.add(c));
  return inp.aimVector(facing);
}

test('diagonals are normalized (~0.7071 each), never faster than cardinals', () => {
  const g = createGame();
  const v = aim(g, ['KeyW', 'KeyD'], 1);   // up-right
  assert.ok(Math.abs(v.x - DIAG) < EPS, 'x component normalized');
  assert.ok(Math.abs(v.y + DIAG) < EPS, 'y component normalized (up is negative)');
  assert.ok(Math.abs(Math.hypot(v.x, v.y) - 1) < EPS, 'magnitude is 1, not sqrt(2)');
});

test('idle with facing 0 yields a zero vector, never NaN (the || 1 guard)', () => {
  const g = createGame();
  const v = aim(g, [], 0);
  assert.equal(v.x, 0);
  assert.equal(v.y, 0);
  assert.ok(!Number.isNaN(v.x) && !Number.isNaN(v.y), 'no divide-by-zero NaN');
});
