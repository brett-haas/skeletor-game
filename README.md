# SKELETOR'S CONQUEST: THE ROAD TO GRAYSKULL

An NES-style action run-and-gun built with **vanilla JavaScript** and the
**HTML5 Canvas** — no engine, no frameworks, no external assets. Every sprite,
background, and effect is drawn procedurally with canvas primitives at a low
retro resolution scaled up with crisp, pixelated rendering. The virtual height
is a fixed 240px; the width adapts to the viewport's aspect ratio (16:9 by
default) so the canvas fills any screen edge-to-edge — no letterbox bars, no
distortion — on desktop and mobile alike.

Play as Skeletor and fight your way across three levels to storm Castle
Grayskull.

## Play

Just open the file — no build step, no server:

```bash
open index.html          # macOS
# or double-click index.html in any modern browser
```

Press **ENTER** on the title screen to begin.

### Controls

| Key | Action |
|-----|--------|
| **W A S D** | Move and aim (8-directional; movement and aim are independent) |
| **W / A / S / D combos** | Diagonal aiming (e.g. W+D aims up-right) |
| **J** | Fire (hold for auto-fire) |
| **K** | Jump |
| **Space** | Pause / resume |
| **Enter** | Start game / return to menu from an end screen |

Aiming is decoupled from movement: run one way while firing another, in any of
the eight directions.

#### Touch (mobile)

On touch-primary devices (phones, tablets) an on-screen control layer appears
automatically: a left-thumb directional pad for 8-way move/aim, **FIRE** (hold)
and **JUMP** buttons on the right, and a **❚❚** button for pause / start /
continue. Touch input feeds the same controls as the keyboard, so nothing about
gameplay changes. The canvas fills the whole viewport (widescreen when held in
landscape, a narrower slice in portrait), and the first tap requests true
fullscreen to banish the browser's chrome bars where the platform allows it.

Detection uses the `pointer: coarse` media query, so keyboard-driven hybrid
laptops keep the desktop layout. Override with a query string:

- `index.html?touch` — force the touch overlay on (handy for testing on a
  desktop with a mouse)
- `index.html?touch=0` — force the desktop layout, even on a touch device

## Power-ups

Defeated enemies may drop a pickup. Grabbing a weapon replaces your current
one; **dying reverts you to the default**. Barrier is the exception — it is a
status boost, not a weapon, so it leaves whatever you are wielding intact.

| Pickup | Weapon | Behavior |
|--------|--------|----------|
| **S** | Spread Curse | Five skull projectiles in a wide fan — great for crowds |
| **L** | Light-Ring Laser | Slow, massive ring that pierces walls and enemies |
| **F** | Flame Spit | Short-range, high-DPS stream — melts foes up close, useless at range |
| **B** | Barrier | Temporary invulnerability — keeps your current weapon |

## Scoring & lives

You begin with **3 lives** and a score of zero. The HUD shows your six-digit
score (top-left, zero-padded) and a row of skull icons for remaining lives.

| Deed | Points |
|------|--------|
| Destroy an enemy | **+100** |
| Grab a power-up | **+250** |
| Clear a level (defeat its boss) | **+5000** |

Every death costs one life and respawns you at the last checkpoint (each level
has several). When your last life is spent, it's **GAME OVER** — and your final
score is tallied on the end screen.

## Levels

1. **The Vine Jungle** — Horizontal run-and-gun with collapsing platforms and
   Palace Guard turrets. Mid-boss: Teela on the Battle Ram. Stage boss:
   **Man-At-Arms** (weak point: the core reactor on his laser war-machine).
2. **The Caverns of Whispers** — A side-scrolling descent with snapping floor
   spikes, toggling laser gates, and rolling boulders. Boss: **The Sorceress &
   Stratos** (shoot down Stratos to drop the Sorceress's ward).
3. **Castle Grayskull** — A vertical climb into a final hallway packed with
   elite guards and homing turrets. Final boss: **He-Man & Battle Cat**
   (down the Cat, then strike He-Man only while his sword is charging).

**One-hit deaths:** touching an enemy, projectile, or pit is instant death —
you lose your weapon and respawn at the last checkpoint.

## Project structure

```
skeletor-game/
├── index.html          # canvas shell; loads src/ scripts in dependency order
├── package.json        # test script only — no runtime dependencies
├── src/
│   ├── config.js       # resolution, physics constants, enums, palette
│   ├── utils.js        # math, AABB collision, shared draw helpers
│   ├── input.js        # keyboard/touch state + 8-directional aim vectoring
│   ├── camera.js       # 2D follow-camera + (dormant) pseudo-3D projector
│   ├── weapons.js      # the five weapon fire factories
│   ├── entities.js     # Player, Projectile, Enemy, PowerUp, Particle
│   ├── bosses.js       # Man-At-Arms, Sorceress & Stratos, He-Man & Battle Cat
│   ├── levels.js       # Level base class + the three levels
│   ├── engine.js       # GameEngine: state machine, main loop, systems, HUD
│   └── main.js         # bootstrap + on-screen touch controls
└── tests/              # integration test suite (see tests/README.md)
```

The code is split into classic `<script>` modules loaded in dependency order;
they share one global scope, so no bundler or import/export is required.

### Architecture notes

- **Centralized state machine** (`GameEngine`) driving a fixed-timestep
  `requestAnimationFrame` loop. States: `MENU`, `PLAYING`, `PAUSED`,
  `LEVEL_TRANSITION`, `GAME_OVER`, `VICTORY`.
- **Two perspective modes.** All three levels currently run in side-scrolling
  `SIDE` mode. A pseudo-3D `DEPTH` mode (perspective projector, depth-scaled
  entities) remains implemented and available for future use.
- **Camera** with horizontal/vertical follow and hard world-clamping.
- **Input** captured via a `Set` for precise concurrent multi-key aiming, with
  edge-triggered presses for jump/pause/start. On-screen touch controls feed the
  same `Set` via `input.press`/`input.release`, so the engine is input-agnostic.
- **Collision:** axis-aligned bounding boxes (AABB) for side-scrolling levels.

## Tests

Integration tests drive the real engine loop in a headless mock canvas — no
browser, no dependencies, using Node's built-in test runner:

```bash
npm test
# or: node --test tests/*.test.js
```

Coverage includes the state machine, jump/pit physics (with a regression guard
that every pit is crossable), weapon behavior and balance, level hazards and
boss weak points, and a full-campaign playthrough. See
[`tests/README.md`](tests/README.md) for details.

## Requirements

- **Play:** any modern browser (Chrome, Edge, Safari, Firefox).
- **Tests:** Node.js 18+ (developed on Node 24).

No installation, no dependencies.
