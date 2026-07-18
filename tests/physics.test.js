/* ============================================================================
 *  PHYSICS — jump, gravity, one-way platforms, pit death, and the crucial
 *  regression guard: every pit in every SIDE level must be clearable by a
 *  running jump (the bug that swallowed Skeletor in the caverns).
 * ========================================================================== */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./harness');

// Measure a real running jump by driving the engine: how far it carries you
// horizontally, and how high it lifts you (for reaching bridge platforms).
function measureJump(g) {
  g.loadLevel(0);
  const p = g.player;
  p.x = 100; p.y = g.level.groundY - p.h; p.onGround = true; p.vx = 0; p.vy = 0;
  g.hold('KeyD');
  g.step(20);                       // build to full run speed on the ground
  const launchX = p.x, launchY = p.y;
  g.tap('KeyK');                    // leap
  let reach = 0, height = 0, airborne = false;
  for (let i = 0; i < 90; i++) {
    g.step(1);
    if (!p.onGround) airborne = true;
    reach = Math.max(reach, p.x - launchX);
    height = Math.max(height, launchY - p.y);
    if (airborne && p.onGround) break; // landed
  }
  g.release('KeyD');
  return { reach, height };
}

test('jump launches the player upward off the ground', () => {
  const g = createGame();
  g.loadLevel(0);
  const p = g.player;
  p.y = g.level.groundY - p.h; p.onGround = true; p.vy = 0;
  g.tap('KeyK').step(1);
  assert.ok(p.vy < 0, 'jump gives upward (negative) velocity');
  assert.equal(p.onGround, false);
});

test('jumpTapped() edge-triggers on K only — ArrowUp (aim-up) never jumps', () => {
  const g = createGame();
  g.start();
  const inp = g.engine.input;

  assert.equal(inp.jumpTapped(), false, 'nothing pressed -> no jump');

  // ArrowUp is bound to AIM-up, not jump; it must never register a jump tap.
  inp.pressed.add('ArrowUp');
  assert.equal(inp.jumpTapped(), false, 'ArrowUp does not trigger a jump');
  inp.pressed.clear();

  // K is the sole jump key.
  inp.pressed.add('KeyK');
  assert.equal(inp.jumpTapped(), true, 'K edge-triggers the jump');
});

test('gravity pulls a falling player downward', () => {
  const g = createGame();
  g.loadLevel(0);
  const p = g.player;
  p.onGround = false; p.vy = 0; p.y = 50;
  const v0 = p.vy;
  g.step(1);
  assert.ok(p.vy > v0, 'downward velocity increases under gravity');
});

test('falling into a bottomless pit is lethal', () => {
  const g = createGame();
  g.loadLevel(0);
  g.engine.lives = 5;
  const p = g.player;
  // Drop the player far below the world with no platform beneath.
  p.x = 640; p.y = g.level.worldH + 100; p.onGround = false;
  const before = g.engine.lives;
  g.step(2);
  assert.ok(g.engine.lives < before || p.dead, 'a pit fall kills the player');
});

test('REGRESSION: every pit is crossable — jumpable, or spanned by a bridge', () => {
  const g = createGame();
  const { reach, height } = measureJump(g);
  assert.ok(reach > 40, `sanity: jump reach should be substantial (got ${reach})`);
  assert.ok(height > 30, `sanity: jump height should be substantial (got ${height})`);

  const TOL = 6; // small landing/timing tolerance

  for (const idx of [0, 1, 2]) {
    g.loadLevel(idx);
    const lvl = g.level;
    const groundY = lvl.groundY;
    // Floor platforms = those sitting at the level's ground line.
    const floor = lvl.platforms
      .filter((pl) => pl.y === groundY)
      .sort((a, b) => a.x - b.x);

    for (let i = 0; i < floor.length - 1; i++) {
      const gapStart = floor[i].x + floor[i].w;
      const gapEnd = floor[i + 1].x;
      const gap = gapEnd - gapStart;
      if (gap <= 0) continue; // touching/overlapping platforms: not a pit

      // A wide pit is fair if a reachable "bridge" platform spans it — e.g.
      // Level 1's collapsing platforms over the second chasm.
      const bridged = lvl.platforms.some((pl) => {
        if (pl.y === groundY) return false;               // must be above the floor
        const rise = groundY - pl.y;
        const overlapsGap = pl.x < gapEnd && pl.x + pl.w > gapStart;
        const reachable = rise > 0 && rise <= height + TOL;
        return overlapsGap && reachable;
      });

      assert.ok(
        gap <= reach + TOL || bridged,
        `level ${idx + 1}: pit of ${gap}px is neither jumpable ` +
        `(reach ${Math.round(reach)}px) nor bridged`
      );
    }
  }
});

test('REGRESSION: Level 3 vertical climb is actually completable — a bot climbs it', () => {
  // The pit guard above only checks HORIZONTAL gaps; it was blind to Level 3's
  // vertical shaft. That shaft has shipped broken twice: once with ledges 120px
  // apart (beyond a jump's ~70px reach) and once with the top ledges tucked
  // UNDER the solid hallway floor's overhang (you can't rise into a solid slab
  // from below). A static reachability check missed the second bug entirely, so
  // this guard instead DRIVES the real engine: a simple climbing bot picks the
  // next ledge above, walks under it, and jumps — and must reach the hallway.
  const g = createGame();
  g.loadLevel(2);
  const lvl = g.level;
  const p = g.player;
  const plats = () => lvl.platforms.filter((pl) => !pl.gone);
  const feet = (pl) => (pl === p ? p.y + p.h : pl.y);
  const goal = plats().find((pl) => pl.y === lvl.groundY && pl.w > 1000);
  assert.ok(goal, 'sanity: Level 3 should have a long hallway floor at groundY');

  const bodyOverlap = (pl) => p.x < pl.x + pl.w && pl.x < p.x + p.w;
  const currentPlat = () => {
    let best = null;
    for (const pl of plats()) {
      if (Math.abs(pl.y - (p.y + p.h)) <= 4 && bodyOverlap(pl)) {
        if (!best || pl.y < best.y) best = pl;
      }
    }
    return best;
  };
  const nextAbove = (cur) => {
    let best = null;
    for (const pl of plats()) {
      if (pl.y >= cur.y) continue;
      if (!(pl.x < cur.x + cur.w && cur.x < pl.x + pl.w)) continue; // horizontal overlap
      if (!best || pl.y > best.y) best = pl;                        // closest above
    }
    return best;
  };
  const overlapMid = (a, b) =>
    (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2;

  let holding = null;
  const setHold = (dir) => {
    if (holding === dir) return;
    if (holding) g.release(holding);
    if (dir) g.hold(dir);
    holding = dir;
  };

  let reached = false;
  for (let frame = 0; frame < 2000; frame++) {
    p.invuln = Math.max(p.invuln, 4);   // isolate the climb from combat deaths
    if (p.dead) break;
    // On the hallway floor (feet at groundY, right of its left edge)?
    if (p.onGround && Math.abs((p.y + p.h) - goal.y) <= 4 && p.x + p.w / 2 >= 60) {
      reached = true; break;
    }
    const cur = currentPlat();
    if (cur) {
      if (p.y + p.h <= 258) {
        setHold('KeyD');                                   // near top: run-and-jump to mount hallway
        if (p.onGround) g.tap('KeyK');
      } else {
        const nxt = nextAbove(cur);
        if (nxt) {
          const target = overlapMid(cur, nxt), c = p.x + p.w / 2;
          setHold(c < target - 3 ? 'KeyD' : c > target + 3 ? 'KeyA' : null);
          if (p.onGround) g.tap('KeyK');                   // hop every landing, carrying momentum
        } else {
          setHold(null);
        }
      }
    }
    g.step(1);
  }

  assert.ok(
    reached,
    `Level 3 is not climbable: a bot could not reach the hallway floor from the ` +
    `start floor within 2000 frames (stuck at y=${Math.round(p.y)}, x=${Math.round(p.x)})`
  );
});
