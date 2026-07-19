# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**SKELETOR'S CONQUEST: THE ROAD TO GRAYSKULL** — an NES-style run-and-gun in
vanilla JS + HTML5 Canvas. No engine, no framework, no dependencies, no build
step. All art is drawn procedurally with canvas primitives in a low-res virtual
space with a **fixed 240px height** and an **adaptive width** (`VW`, 16:9 / 426
by default) that the engine reshapes to the viewport's aspect ratio, then
CSS-scales up (fractionally) to fill the screen with no letterbox.

## Commands

```bash
open index.html                       # play (macOS); or open in any browser
npm test                              # run the full integration suite
node --test tests/state.test.js       # run one test file
node --test --test-name-pattern="pit" tests/physics.test.js   # one test by name
```

Play requires only a browser. Tests require Node 18+ (developed on Node 24).
There is no lint step and no runtime install (`package.json` has no deps).

## Architecture

### No modules — one shared global scope

The game is classic `<script>` files that all execute in the same global scope;
there is no `import`/`export` and no bundler. Everything (classes, `const`
enums, helper functions) is a global. Two consequences dominate:

- **Load order is dependency order and it is load-bearing.** The `<script>`
  tags in `index.html` (config → utils → input → camera → weapons → entities →
  bosses → levels → engine → main) must stay topologically sorted: a file may
  only reference globals defined in files above it.
- **The test harness re-declares this exact order in two places.** When you add
  a source file, add it to BOTH `index.html`'s script list AND
  `tests/harness.js` `LOAD_ORDER`. When you add a class or constant the tests
  need to construct or inspect, add its name to `tests/harness.js` `EXPORTS` —
  otherwise it won't be visible to any test. This coupling is the single most
  common way to break the suite.

### Engine (`engine.js`, the ~1000-line core)

`GameEngine` is a centralized state machine (`STATE.MENU/PLAYING/PAUSED/
LEVEL_TRANSITION/GAME_OVER/VICTORY`) running a **fixed-timestep** loop: `start()`
drives an rAF loop with an accumulator that calls `update()` at a fixed 60Hz
(`this.STEP`) and `render()` once per frame. **Keep simulation in `update()` and
drawing in `render()`** — the tests call them separately and step the sim
frame-by-frame, so any logic that sneaks into `render()` won't be exercised.

Actors live in flat per-level pools on the engine (`enemies`, `shots`,
`enemyShots`, `powerups`, `particles`), reset by `_resetPools()` on each
`loadLevel`. Levels/weapons/bosses never push to these arrays directly — they
call engine spawn helpers (`spawnPlayerShot`, `spawnDepthBolt`, `spawnBurst`).

Levels are registered in the `levelFactories` array; `advanceLevel()` walks it
and triggers `VICTORY` past the last entry. To add a level: write the class,
add a factory entry, wire it into the harness load order.

### Two perspective modes

Every level declares `mode` = `MODE.SIDE` or `MODE.DEPTH`. This switches
movement (`_sideMovement` vs `_depthMovement`), camera, collision, and
shot/enemy handling throughout the engine — grep for `MODE.DEPTH` to see the
branches. **All three shipped levels are `SIDE`.** The `DEPTH` pseudo-3D path
(`DepthProjector`, depth-scaled entities, `spawnDepthBolt`) is fully implemented
but dormant; it's kept working but unused. Don't assume code is dead because no
level hits it.

### Entities are data-driven

- `Enemy` (`entities.js`) is one flexible class steered by a `behavior` string;
  the per-behavior logic is a `switch` in `engine._updateEnemies()`. Add an enemy
  type by adding a `behavior` case there, not a subclass.
- `Weapons` (`weapons.js`) is a map keyed by the `WEAPON` enum; each entry is
  `{ name, cooldown, fire(engine, ox, oy, aim) }`. `fire` spawns projectiles via
  the engine. Death reverts the player to `WEAPON.DEFAULT` (one-hit death = weapon
  loss). `BARRIER` is not a weapon at all but a status pickup (`WEAPON.BARRIER`
  routes through `Player.setWeapon` to grant a timed window of i-frames + the
  bubble — duration is `BARRIER_TIME` in `config.js` — while leaving your current
  weapon intact); its `Weapons` entry is name-only, no `fire`.
- **Bosses** (`bosses.js`) are the exception: standalone classes (not `Enemy`,
  no shared base) each with `update()`, `render(ctx, cam)`, and `hitTest(proj)`.
  The engine routes player shots to `boss.hitTest` and reads `boss.dead` for
  level completion. Each has a scripted weak point (Man-At-Arms core, Sorceress
  ward gated by Stratos, He-Man vulnerable only mid sword-charge).

### Levels (`levels.js`)

`Level` base class + `Level1/2/3`. `build()` lays out geometry and spawns;
`update(dt)` runs hazards and boss gates; `renderWorld(ctx, cam)` paints the
backdrop. Enemies/bosses appear via **spawners** — position-triggered
(`atX`) for horizontal levels, height-triggered (`byHeight`/`atY`) for the
vertical climb in Level 3. Respawn uses `checkpointFor(x)`.

### Rendering & collision conventions

- Screen position is always `world - cam` (e.g. `Math.floor(x - cam.x)`); use the
  shared draw helpers in `utils.js` (`drawPlatforms`, `drawSkeletor`, `drawShadow`).
- Collision is AABB via `aabb(a, b)` in `utils.js`. Entities expose a `hitbox()`;
  the player's is deliberately smaller than its sprite (forgiving).
- All coordinates are in the virtual space (`VW`×`VH`) — never touch the scaled
  CSS pixel size except in `_applyViewport()` / `_fitCanvas()`. Note `VW` is a
  `let`, not a `const`: `_applyViewport()` rewrites it to match the viewport
  aspect (on resize/orientation change too), so read it live — never cache it.
  `VH` is fixed at 240, so vertical layout and physics never shift. Under the
  test harness (no `<body>`) `VW` keeps its 426 default, which is why the suite
  stays deterministic.

## Tests are integration tests, not unit tests

`tests/harness.js` concatenates the real `src/*.js`, runs each game in an
isolated `new Function` scope (per-test isolation with no global bleed), stubs
the canvas 2D context / `window` / `document` / rAF, and **seeds `Math.random`**
(mulberry32) so runs are deterministic. Tests then drive the real engine:
`hold`/`release`/`tap` synthetic keys and `step(n)` the sim, asserting on live
engine state. `keepAlive()` and `loadLevel(i)` let progression tests skip past
skill. `physics.test.js` includes a **regression guard that every pit is
jumpable or bridged** — keep it green when editing level geometry or jump/gravity
constants (`GRAVITY`, `MAX_FALL` in `config.js`).
