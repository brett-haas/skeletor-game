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
| `physics.test.js` | Jump/gravity, pit death, a **regression guard** that every pit is jumpable or bridged, and Level 3's climb (collapsing ledges, fatal falls) + hallway-respawn placement |
| `input.test.js` | Aim vectoring: diagonal normalization (~0.7071) and the idle-facing divide-by-zero guard |
| `weapons.test.js` | Each weapon's shot shape, cooldown, BARRIER i-frames, FLAME DPS + range falloff |
| `projectiles.test.js` | `Projectile` entity physics: homing steering (`homingKeepSpeed` holds constant speed through a hard turn, default homing bleeds speed toward zero) and `grow` radius-swell (Light-Ring laser ring) |
| `combat.test.js` | Life-loss rules: exactly one life per death, the dead/invulnerable guard, enemy contact death |
| `scoring.test.js` | Score awards (+100 kill, +250 pickup, +5000 level clear) and the `startGame` reset |
| `powerups.test.js` | Power-up lifecycle: drop-on-death, fall-and-settle, weapon grant on pickup, timeout expiry |
| `levels.test.js` | Per-level mode/bounds, spawner triggers, lethal hazards, boss gates |
| `bosses.test.js` | Weak-point mechanics: Man-At-Arms core, Sorceress ward, He-Man charge window |
| `playthrough.test.js` | Assisted full-campaign run to VICTORY + chaotic-input crash-safety soak |
| `sound.test.js` | Procedural audio: headless no-op guard, every SFX method crash-safe, mute toggle, playthrough drives the SFX/music hooks |
| `harness.test.js` | The harness rig's own contract: seeded-PRNG determinism, `seed:0` restores native randomness |

## How it works

`harness.js` concatenates the `src/*.js` files (in the same order as
`index.html`), runs them in an isolated function scope per game, and stubs the
canvas 2D context, `window`, `document`, and `requestAnimationFrame`. Tests then
step the simulation frame-by-frame with synthetic key input and assert on live
engine state. RNG is seeded per game so runs are deterministic.

Most tests are **integration/behavioral** — they drive the actual update/render
loop, collisions, levels, and bosses. A handful are focused **unit checks** of
pure functions or single methods where an end-to-end path would add noise
without adding coverage: the aim-vector math (`input.test.js`), the boss
weak-point `hitTest` gating (`bosses.test.js`), and a few direct-method guards
(e.g. `killPlayer`, `setWeapon`).
