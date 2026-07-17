/* ============================================================================
 *  HARNESS CONTRACT — the test rig's own guarantees:
 *    • a given seed installs a deterministic PRNG (reproducible runs),
 *    • seed:0 restores TRUE native randomness, not the previous test's seed.
 * ========================================================================== */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./harness');

// The pristine native Math.random, captured before any createGame() seeds the
// global. node's test runner isolates each file in its own process, so at this
// module's load time Math.random is still the real, unseeded function.
const NATIVE_RANDOM = Math.random;

test('a given seed installs a deterministic PRNG (same seed -> same stream)', () => {
  createGame({ seed: 42 });
  const seqA = Array.from({ length: 5 }, () => Math.random());
  createGame({ seed: 42 });
  const seqB = Array.from({ length: 5 }, () => Math.random());
  assert.deepEqual(seqA, seqB, 'identical seeds produce an identical PRNG stream');
});

test('seed:0 restores native randomness rather than reusing the last seed', () => {
  createGame({ seed: 7 });                 // installs a seeded mulberry32 globally
  assert.notEqual(Math.random, NATIVE_RANDOM, 'a seeded game overrides Math.random');

  createGame({ seed: 0 });                 // documented as "real random"
  assert.equal(Math.random, NATIVE_RANDOM,
    'seed:0 restores the true native Math.random, not a leftover seeded PRNG');
});
