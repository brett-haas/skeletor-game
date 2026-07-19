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

test('turnaround boost: reversing at full speed skids faster than plain accel (#6)', () => {
  const g = createGame();
  g.loadLevel(0);
  const p = g.player;
  p.x = 100; p.y = g.level.groundY - p.h; p.onGround = true; p.vx = 0; p.vy = 0;

  // Build to full rightward speed on the ground.
  g.hold('KeyD');
  g.step(20);
  assert.ok(p.vx > 2, `should reach near max right speed (got ${p.vx})`);

  // Slam left; count frames until velocity actually flips to <= 0.
  g.release('KeyD');
  g.hold('KeyA');
  let frames = 0;
  for (let i = 1; i <= 10; i++) {
    g.step(1);
    if (p.vx <= 0) { frames = i; break; }
  }
  g.release('KeyA');

  assert.ok(frames > 0, 'velocity should reverse when the d-pad flips');
  // Plain accel (MOVE_ACCEL/frame) from ~max speed needs ~4 frames to cross
  // zero; the TURN_BOOST kick doubles the decel and crosses in ~2. This guard
  // FAILS if the boost is removed.
  assert.ok(frames <= 3, `reversal should skid within 3 frames, got ${frames}`);
});

test('idle velocity snaps to exact zero after release — no sub-pixel creep (#8)', () => {
  const g = createGame();
  g.loadLevel(0);
  const p = g.player;
  p.x = 100; p.y = g.level.groundY - p.h; p.onGround = true; p.vx = 0; p.vy = 0;

  // Build to speed on the ground, then let go of the d-pad entirely.
  g.hold('KeyD');
  g.step(20);
  assert.ok(p.vx > 2, `should reach near max right speed (got ${p.vx})`);
  g.release('KeyD');

  // GROUND_FRICTION decay is geometric: without the IDLE_CREEP_EPSILON snap, vx
  // approaches zero asymptotically and stays a tiny non-zero residual FOREVER.
  // 30 idle frames is far past the ~14 needed to fall below the 0.05 threshold.
  g.step(30);

  // Strict zero — this FAILS if the snap-to-zero line is removed (residual ~1e-4).
  assert.strictEqual(p.vx, 0, `idle vx should snap to exact 0, got ${p.vx}`);
});

// Drive a straight-up jump and return its peak height above the launch point.
// variant: 'tap'  — an instant edge press (reads as NEVER held → full jump);
//          'full' — hold jump through the whole arc (no release edge → full jump);
//          <number N> — hold jump for N frames then release mid-rise (a CUT short hop).
function jumpApex(g, variant) {
  g.loadLevel(0);
  const p = g.player;
  p.x = 100; p.y = g.level.groundY - p.h; p.onGround = true; p.vx = 0; p.vy = 0;
  const launchY = p.y;
  if (variant === 'tap') {
    g.tap('KeyK');
  } else {
    g.hold('KeyK');
    if (typeof variant === 'number') { g.step(variant); g.release('KeyK'); }
  }
  let apex = 0, airborne = false;
  for (let i = 0; i < 90; i++) {
    g.step(1);
    if (!p.onGround) airborne = true;
    apex = Math.max(apex, launchY - p.y);
    if (airborne && p.onGround) break;   // landed
  }
  g.release('KeyK');   // clean up the held-jump variants
  return apex;
}

test('variable jump height: a short-held jump hops well below a full-held jump (#1)', () => {
  const full = jumpApex(createGame(), 'full');
  const shortHop = jumpApex(createGame(), 2);   // released after 2 frames → cut
  assert.ok(shortHop < full * 0.75,
    `short hop (${shortHop.toFixed(1)}) should be well below full jump (${full.toFixed(1)})`);

  // LOAD-BEARING INVARIANT: an instant synthetic tap is never seen as "held", so
  // it must yield the FULL jump — not a short hop. Every pit/climb/boss bot in
  // the suite jumps via tap(); if this ever short-hops, those regression guards
  // silently go soft. This assert is their canary.
  const tap = jumpApex(createGame(), 'tap');
  assert.ok(Math.abs(tap - full) < 1,
    `instant tap must equal a full held jump (tap ${tap.toFixed(2)}, full ${full.toFixed(2)})`);
});

test('cut jump falls under heavier FALL_GRAVITY; a full jump keeps RISE_GRAVITY (#2)', () => {
  const { RISE_GRAVITY, FALL_GRAVITY } = createGame().classes;

  // Launch a jump variant, then return the per-frame downward vy gain during
  // early descent (vy > 0 but well under MAX_FALL) — that Δvy IS the gravity.
  const descentGravity = (variant) => {
    const g = createGame();
    g.loadLevel(0);
    const p = g.player;
    p.x = 100; p.y = g.level.groundY - p.h; p.onGround = true; p.vx = 0; p.vy = 0;
    g.hold('KeyK');
    if (typeof variant === 'number') { g.step(variant); g.release('KeyK'); }
    for (let i = 0; i < 90; i++) {
      const before = p.vy;
      g.step(1);
      if (before > 0.3 && p.vy < 3) { g.release('KeyK'); return p.vy - before; }
    }
    g.release('KeyK');
    throw new Error(`never measured a clean descent frame for variant ${variant}`);
  };

  const fullFall = descentGravity('full');   // held through apex → no cut
  const cutFall  = descentGravity(2);         // released early → jumpCut latches

  assert.ok(Math.abs(fullFall - RISE_GRAVITY) < 1e-6,
    `full-jump descent should be RISE_GRAVITY ${RISE_GRAVITY}, got ${fullFall}`);
  assert.ok(Math.abs(cutFall - FALL_GRAVITY) < 1e-6,
    `cut-jump descent should be FALL_GRAVITY ${FALL_GRAVITY}, got ${cutFall}`);
  // The whole point of #2: a cut jump snaps down harder than a full one. FAILS if
  // gravity is made symmetric again.
  assert.ok(cutFall > fullFall,
    `cut jump (${cutFall}) must fall faster than a full jump (${fullFall})`);
});

test('releasing the d-pad mid-air preserves momentum via AIR_DRAG, not ground friction (#3)', () => {
  const g = createGame();
  const { AIR_DRAG } = g.classes;
  g.loadLevel(0);
  const p = g.player;
  p.x = 100; p.y = g.level.groundY - p.h; p.onGround = true; p.vx = 0; p.vy = 0;

  g.hold('KeyD'); g.step(20);          // build to full run speed on the ground
  g.tap('KeyK');  g.step(2);           // full jump (tap = not held) → airborne
  assert.equal(p.onGround, false, 'should be airborne before releasing the d-pad');

  g.release('KeyD');                   // let go mid-air → no directional input
  const before = p.vx;
  assert.ok(before > 1, `should carry real speed into the air, got ${before}`);
  g.step(1);
  const ratio = p.vx / before;

  // Airborne idle decay must be AIR_DRAG (0.96), NOT GROUND_FRICTION (0.75). If
  // the onGround gate regresses, this ratio collapses toward 0.75 and fails.
  assert.ok(Math.abs(ratio - AIR_DRAG) < 1e-6,
    `mid-air decay should equal AIR_DRAG ${AIR_DRAG}, got ratio ${ratio}`);
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

// Stand the player on a floating THIN (one-way) platform above a solid floor,
// with a controlled two-platform world so no real level geometry interferes.
// Returns { p, thin, floor } once the player has settled (onGround & onOneWay).
function standOnThinPlatform(g) {
  g.loadLevel(0);
  const thin  = { x: 150, y: 120, w: 100, h: 8 };  // h<=12 => one-way
  const floor = { x: 0,   y: 200, w: 400, h: 40 };  // h>12  => solid
  g.level.platforms = [floor, thin];
  const p = g.player;
  p.invuln = 99999;                 // ignore any stray enemy fire
  p.x = 190; p.y = 90; p.vx = 0; p.vy = 0; p.onGround = false;
  for (let i = 0; i < 40 && !p.onGround; i++) g.step(1);
  assert.ok(p.onGround && p.onOneWay,
    `setup: player should settle on the thin platform (onGround=${p.onGround}, onOneWay=${p.onOneWay})`);
  return { p, thin, floor };
}

test('aim-down (DOWN held) does NOT drop the player through a thin platform', () => {
  const g = createGame();
  const { p, thin } = standOnThinPlatform(g);
  const restY = p.y;
  g.hold('KeyS');          // hold DOWN to aim downward — must not drop us
  g.step(20);
  g.release('KeyS');
  assert.equal(p.onGround, true, 'still standing after aiming down');
  assert.ok(Math.abs(p.y - restY) < 1, `player stayed on the platform (y ${p.y} vs ${restY})`);
  assert.ok(p.y < thin.y, 'player never sank below the thin platform top');
});

test('DOWN + jump drops the player through a thin platform to the floor below', () => {
  const g = createGame();
  const { p, thin, floor } = standOnThinPlatform(g);
  g.hold('KeyS');          // hold DOWN...
  g.tap('KeyK');           // ...and tap jump: the deliberate drop combo
  let fellThrough = false;
  for (let i = 0; i < 60; i++) {
    g.step(1);
    if (p.y + p.h > thin.y + thin.h) fellThrough = true;  // cleared the thin plat
    if (fellThrough && p.onGround) break;                 // landed on the floor
  }
  g.release('KeyS');
  assert.ok(fellThrough, 'player dropped through the thin platform');
  assert.equal(p.onGround, true, 'player landed on the solid floor below');
  assert.equal(p.y, floor.y - p.h, 'player came to rest on the floor top');
});

test('DOWN + jump on SOLID ground still jumps (drop gate must not swallow the leap)', () => {
  const g = createGame();
  const { p, floor } = standOnThinPlatform(g);
  // Drop to the solid floor first so we are grounded on a non-one-way platform.
  p.x = 50; p.y = floor.y - p.h; p.vx = 0; p.vy = 0; p.onGround = false;
  g.step(1);
  assert.ok(p.onGround && !p.onOneWay, 'setup: standing on solid floor');
  g.hold('KeyS');
  g.tap('KeyK');
  g.step(1);
  g.release('KeyS');
  assert.ok(p.vy < 0, 'down+jump on solid ground still launches upward');
  assert.equal(p.onGround, false, 'player left the ground (jumped, not swallowed)');
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
          const aligned = Math.abs(c - target) <= 14;
          setHold(aligned ? null : (c < target ? 'KeyD' : 'KeyA'));
          // Settle over the target before hopping. The every-other collapsing
          // stepping stones are narrow launch windows; hopping mid-drift (the old
          // "hop every landing" bot) sails off the next ledge's far edge and — now
          // that a fall is fatal with no regen — dies. A careful climber lines up,
          // then hops nearly straight up onto the overlapping ledge above.
          if (p.onGround && aligned) g.tap('KeyK');
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

test('Level 3 climb: every-other ledge collapses, launchpad + exit are solid, respawn restores', () => {
  const g = createGame();
  g.loadLevel(2);
  const lvl = g.level;
  const N = 19;

  // The 19 zig-zag climb ledges are w:120,h:10 at y = 1370 - 56k. Odd k (from the
  // bottom ledge up) collapses EXCEPT the topmost stepping stone k=N, which stays
  // solid so the precise up-and-left mount onto the narrow exit ledge has stable
  // footing. So the collapsing set is odd k in [1, N-1] -> 1,3,5,…,17.
  const climbLedge = (k) =>
    lvl.platforms.find((pl) => pl.w === 120 && pl.h === 10 && pl.y === 1370 - 56 * k);

  for (let k = 1; k <= N; k++) {
    const pl = climbLedge(k);
    assert.ok(pl, `climb ledge k=${k} exists`);
    if (k % 2 === 1 && k !== N) {
      assert.ok(pl.collapsing, `odd ledge k=${k} should collapse`);
      assert.equal(pl.baseY, pl.y, `collapsing ledge k=${k} remembers its baseY`);
    } else {
      assert.ok(!pl.collapsing, `ledge k=${k} should stay solid`);
    }
  }
  assert.ok(climbLedge(N) && !climbLedge(N).collapsing, 'topmost stepping stone is solid');

  // The last platform before the hallway is the left-wall exit ledge; it must be
  // solid so the player always has firm footing to mount the hall.
  const exit = lvl.platforms.find((pl) => pl.x === 0 && pl.y === 250 && pl.w === 60);
  assert.ok(exit, 'exit ledge exists');
  assert.ok(!exit.collapsing, 'exit ledge before the hallway is NOT collapsing');

  // Drive a triggered ledge all the way to `gone`, one animation step at a time.
  const dropUntilGone = (pl) => {
    pl.triggered = true;
    let steps = 0;
    while (!pl.gone && steps++ < 400) lvl.update(0);
    assert.ok(pl.gone, `ledge at y=${pl.baseY} falls a screen and vanishes`);
    assert.ok(pl.y > pl.baseY, 'vanished ledge has descended below its origin');
  };

  // A fallen ledge stays gone — collapsing ledges do NOT regenerate on their own.
  const dead = climbLedge(1);
  dropUntilGone(dead);
  for (let i = 0; i < 200; i++) lvl.update(0);
  assert.ok(dead.gone, 'a fallen climb ledge does NOT regenerate on its own');

  // RESPAWN-RESET (the death path): the ONLY thing that brings a fallen ledge back
  // is a respawn, which restores the whole shaft so the re-climb from the bottom
  // is always fair. This is load-bearing: the ledge is genuinely gone above.
  g.engine.respawn();
  assert.ok(!dead.triggered, 'respawn clears triggered');
  assert.ok(!dead.gone, 'respawn clears gone');
  assert.equal(dead.fallT, 0, 'respawn resets fall timer');
  assert.equal(dead.y, dead.baseY, 'respawn restores ledge to its base height');
});

test('Level 3 climb: falling below your highest foothold is fatal (no soft-lock)', () => {
  const g = createGame();
  g.loadLevel(2);
  const lvl = g.level;
  const p = g.player;
  p.invuln = 0; p.barrierTime = 0;   // let a real death register

  // Establish a foothold partway up the shaft.
  p.onGround = true; p.x = 60; p.y = 600;
  lvl.update(0);                     // records the peak foothold at y=600
  assert.ok(!p.dead, 'standing on a foothold is safe');

  // A successful upward hop stays at/above the foothold — never fatal.
  p.onGround = false; p.y = 560;
  lvl.update(0);
  assert.ok(!p.dead, 'rising above your foothold is safe');

  // Dropping well below the foothold (a missed jump) is instant death.
  p.y = 640;
  lvl.update(0);
  assert.ok(p.dead, 'dropping more than a stride below your highest foothold is fatal');
});

// --- Horizontal collision push-out (MOVEMENT_REVIEW.md #4) --------------------
// A solid block whose top is NOT coplanar with the floor is a wall: the player
// must be stopped at its flank, not walk through it. A two-platform world keeps
// real level geometry out of the way.
function standLeftOfWall(g, wall) {
  g.loadLevel(0);
  const floor = { x: 0, y: 200, w: 400, h: 40 };  // h>12 => solid
  g.level.platforms = [floor, wall];
  const p = g.player;
  p.invuln = 99999;
  return { p, floor };
}

test('solid wall blocks the player moving right (no walk-through of its flank)', () => {
  const g = createGame();
  const wall = { x: 200, y: 120, w: 20, h: 80 };   // top 120, body 120-200: a raised wall
  const { p } = standLeftOfWall(g, wall);
  p.x = 100; p.y = 200 - p.h; p.vx = 0; p.vy = 0; p.onGround = true;
  g.hold('KeyD');
  g.step(40);
  g.release('KeyD');
  assert.ok(p.x + p.w <= wall.x + 0.5,
    `player stopped at the wall's left face (x ${p.x}, wall.x ${wall.x})`);
});

test('solid wall blocks the player moving left', () => {
  const g = createGame();
  const wall = { x: 200, y: 120, w: 20, h: 80 };
  const { p } = standLeftOfWall(g, wall);
  p.x = 300; p.y = 200 - p.h; p.vx = 0; p.vy = 0; p.onGround = true;
  g.hold('KeyA');
  g.step(40);
  g.release('KeyA');
  assert.ok(p.x >= wall.x + wall.w - 0.5,
    `player stopped at the wall's right face (x ${p.x}, wall right ${wall.x + wall.w})`);
});

test('thin one-way platform does NOT block horizontal movement (passes through its flank)', () => {
  const g = createGame();
  // y=190 makes the thin body span y[190..198], overlapping the walking player's
  // box y[178..200] — so aabb() WOULD fire and the h<=12 skip is the only reason
  // the player passes through. (Placed higher, the boxes never overlap and the
  // test would pass even with the guard deleted — false coverage.)
  const thin = { x: 200, y: 190, w: 100, h: 8 };   // h<=12 => one-way, must not block sideways
  const { p } = standLeftOfWall(g, thin);
  p.x = 100; p.y = 200 - p.h; p.vx = 0; p.vy = 0; p.onGround = true;
  g.hold('KeyD');
  g.step(120);             // enough frames at maxSpd 2.4 to clear the whole span
  g.release('KeyD');
  assert.ok(p.x > thin.x + thin.w,
    `player walked clear past the thin platform (x ${p.x}, thin right ${thin.x + thin.w})`);
});
