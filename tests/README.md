# Tests — Skeletor's Conquest

Integration tests that drive the **real** `GameEngine` loop in a headless mock
canvas. No dependencies, no browser, no build step — they use Node's built-in
`node:test` runner.

## Run

```bash
npm test
# or directly:
node --test tests/*.test.js
```

Requires Node 18+ (developed on Node 24).

## What's covered

| File | Verifies |
|------|----------|
| `state.test.js` | State machine: MENU → PLAYING → PAUSED → LEVEL_TRANSITION → GAME_OVER / VICTORY, respawn + weapon-loss |
| `physics.test.js` | Jump/gravity, pit death, and a **regression guard** that every pit is jumpable or bridged |
| `weapons.test.js` | Each weapon's shot shape, cooldown, BARRIER i-frames, FLAME DPS + range falloff |
| `levels.test.js` | Per-level mode/bounds, spawner triggers, lethal hazards, boss gates |
| `bosses.test.js` | Weak-point mechanics: Man-At-Arms core, Sorceress ward, He-Man charge window |
| `playthrough.test.js` | Assisted full-campaign run to VICTORY + chaotic-input crash-safety soak |

## How it works

`harness.js` concatenates the `src/*.js` files (in the same order as
`index.html`), runs them in an isolated function scope per game, and stubs the
canvas 2D context, `window`, `document`, and `requestAnimationFrame`. Tests then
step the simulation frame-by-frame with synthetic key input and assert on live
engine state. RNG is seeded per game so runs are deterministic.

The tests are **integration/behavioral**, not unit tests — they exercise the
actual update/render loop, collisions, levels, and bosses.
