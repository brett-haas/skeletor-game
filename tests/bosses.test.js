/* ============================================================================
 *  BOSSES — the weak-point mechanics that define each fight:
 *    • Man-At-Arms: only the exposed core takes damage; the wall absorbs.
 *    • Sorceress: warded (invulnerable) until Stratos is shot down.
 *    • He-Man: on foot, deflects shots EXCEPT while charging his sword.
 * ========================================================================== */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./harness');

// A stand-in for a player projectile centred at (x, y).
function shot(x, y, dmg = 1) {
  return { x, y, dmg, pierce: false, hitbox: () => ({ x: x - 3, y: y - 3, w: 6, h: 6 }) };
}

test('Man-At-Arms: the wall absorbs hits, only the core takes damage', () => {
  const g = createGame();
  g.loadLevel(0);
  const boss = new g.classes.ManAtArms(g.engine, 1000, 200);
  const full = boss.hp;

  // Strike the armored wall body (upper region) -> absorbed, no damage.
  const body = shot(boss.x + 35, boss.y + 30);
  assert.equal(boss.hitTest(body), true, 'wall registers the hit');
  assert.equal(boss.hp, full, 'wall takes no damage');

  // Strike the exposed core generator beneath -> real damage.
  const core = boss.coreBox();
  const hit = shot(core.x + core.w / 2, core.y + core.h / 2, 3);
  assert.equal(boss.hitTest(hit), true);
  assert.ok(boss.hp < full, 'the core is the weak point');
});

test('Man-At-Arms: arena lock keeps the player at his front — no slipping behind', () => {
  const g = createGame();
  g.loadLevel(0);

  // Trip the boss gate so Man-At-Arms materialises at world end.
  g.player.x = g.level.bossX;
  g.step(1);
  assert.ok(g.boss instanceof g.classes.ManAtArms, 'Man-At-Arms spawned at the gate');

  const p = g.player;
  const wall = g.boss.wallX;               // front face of the war-machine
  assert.equal(wall, g.boss.x, 'wall sits at the machine front');

  // Barrel RIGHT into (and past) him for a good while. keepAlive() each frame
  // so the beam/grenades never end the run early and we isolate the position.
  g.hold('KeyD');
  for (let i = 0; i < 240; i++) {
    g.keepAlive();
    g.step(1);
    assert.ok(p.x + p.w <= wall + 1e-6,
      `frame ${i}: right edge ${p.x + p.w} must stay at/left of the wall ${wall}`);
  }
  g.release('KeyD');

  // ...and he should be pinned flush to the front, not stalled short of it.
  assert.ok(p.x + p.w >= wall - 1, 'player advances right up to the wall');
});

test('Man-At-Arms laser is a FAIR jump: the whole survivable window is bracketed', () => {
  // Guards the "jump the beam" contract AND the honesty of its telegraph, across
  // the FULL survivable window (not just its roomy early edge). The red cue locks
  // when laserActive <= laserSafeCue; the beam is lethal when laserActive <
  // laserLethal. In the real engine we leap at a chosen frame and check survival:
  //   - standing (never jump)          -> dies (and the beam truly fired)
  //   - earliest cue frame (safeCue)   -> survives (generous clearance)
  //   - latest survivable (lethal+1)   -> survives (the razor-thin far edge)
  //   - one frame later (lethal)       -> dies (proves the window's late edge is real)
  // Bracketing both edges means a future tuning change that narrows the window
  // from EITHER side fails this test loudly, rather than sliding by on the early
  // edge's slack.
  const runBeam = (jumpAt) => {
    // jumpAt: (boss) => laserActive value to leap at, or null to never jump.
    const g = createGame();
    g.loadLevel(0);
    const p = g.player;
    p.x = g.level.bossX;                    // trip the boss gate
    g.step(1);
    const boss = g.boss;
    assert.ok(boss instanceof g.classes.ManAtArms, 'Man-At-Arms spawned at the gate');
    const target = jumpAt === null ? null : jumpAt(boss);
    let firedLethal = false;
    for (let f = 0; f < 700 && !p.dead; f++) {
      boss.grenadeT = 999;                 // isolate the beam: suppress grenades
      p.x = boss.x - 40;                   // pin in front, within the beam's reach
      // Leap at the chosen charge frame (a full jump: a synthetic tap is never
      // rise-cut). Grounded between cycles, so it re-arms for every beam.
      if (target !== null && p.onGround && boss.laserActive === target) g.tap('KeyK');
      g.step(1);
      // Sample AFTER the step that applied the gate, mirroring the engine's exact
      // lethal condition (laserActive < laserLethal). Checked post-step because a
      // standing player dies on the very frame the first lethal value appears, so a
      // top-of-loop read would exit before ever observing it.
      if (boss.laserActive > 0 && boss.laserActive < boss.laserLethal) firedLethal = true;
    }
    return { dead: p.dead, firedLethal };
  };

  const stand = runBeam(null);
  assert.ok(stand.firedLethal, 'the beam reached its lethal phase (sanity: it actually fired)');
  assert.equal(stand.dead, true, 'a player who never jumps is killed by the beam');

  assert.equal(runBeam((b) => b.laserSafeCue).dead, false,
    'leaping at the earliest cue frame (red locks) clears the beam');

  assert.equal(runBeam((b) => b.laserLethal + 1).dead, false,
    'leaping at the LATEST survivable frame still clears the beam (far edge pinned)');

  assert.equal(runBeam((b) => b.laserLethal).dead, true,
    'leaping one frame past the window is fatal (the late edge is real)');
});

test('arena lock is opt-in: only Man-At-Arms exposes a numeric wallX', () => {
  const g = createGame();
  // The clamp keys off `typeof boss.wallX === 'number'`, so the other bosses
  // must NOT define one — their fights rely on free movement around them.
  const maa = new g.classes.ManAtArms(g.engine, 1000, 200);
  const ss = new g.classes.SorceressStratos(g.engine, 3000, 200);
  const hm = new g.classes.HeManBattleCat(g.engine, 2000, 200);
  assert.equal(typeof maa.wallX, 'number', 'Man-At-Arms walls the arena');
  assert.notEqual(typeof ss.wallX, 'number', 'Sorceress/Stratos does not wall');
  assert.notEqual(typeof hm.wallX, 'number', 'He-Man/Battle Cat does not wall');
});

test('Sorceress is warded until Stratos falls, then vulnerable', () => {
  const g = createGame();
  g.loadLevel(1);
  const boss = new g.classes.SorceressStratos(g.engine, 3000, 200);

  // Sorceress hit while Stratos lives -> deflected by the ward.
  const q = boss.sorc;
  const sorcHitEarly = shot(q.x + q.w / 2, q.y + q.h / 2, 5);
  const sorcHpBefore = q.hp;
  assert.equal(boss.hitTest(sorcHitEarly), true, 'the ward registers the hit');
  assert.equal(q.hp, sorcHpBefore, 'warded: no damage while Stratos lives');

  // Shoot Stratos down.
  const s = boss.stratos;
  while (s.alive) {
    boss.hitTest(shot(s.x + s.w / 2, s.y + s.h / 2, 4));
  }
  assert.equal(boss.stratos.alive, false);

  // Now the Sorceress bleeds.
  const before = boss.sorc.hp;
  boss.hitTest(shot(q.x + q.w / 2, q.y + q.h / 2, 4));
  assert.ok(boss.sorc.hp < before, 'vulnerable once Stratos is gone');
});

test('Sorceress defeat requires killing BOTH; then the boss is dead', () => {
  const g = createGame();
  g.loadLevel(1);
  const boss = new g.classes.SorceressStratos(g.engine, 3000, 200);
  const s = boss.stratos, q = boss.sorc;
  while (s.alive) boss.hitTest(shot(s.x + s.w / 2, s.y + s.h / 2, 4));
  let guard = 0;
  while (!boss.dead && guard++ < 200) boss.hitTest(shot(q.x + q.w / 2, q.y + q.h / 2, 4));
  assert.equal(boss.dead, true, 'both halves down -> boss defeated');
});

test('He-Man: kill Battle Cat to reach phase 2, then only the charge is a window', () => {
  const g = createGame();
  g.loadLevel(2);
  const boss = new g.classes.HeManBattleCat(g.engine, 2400, 200);
  assert.equal(boss.phase, 1);

  // Down the Cat.
  boss.cat.hp = 1;
  boss.hitTest(shot(boss.cat.x + boss.cat.w / 2, boss.cat.y + boss.cat.h / 2, 4));
  boss.update();                      // detects the KO, flips to phase 2
  assert.equal(boss.phase, 2, 'Battle Cat down -> He-Man fights on foot');

  const hero = boss.hero;
  const at = shot(hero.x + hero.w / 2, hero.y + hero.h / 2, 4);

  // Not charging -> He-Man deflects; no damage.
  hero.charging = false;
  const hpBefore = hero.hp;
  boss.hitTest(at);
  assert.equal(hero.hp, hpBefore, 'shots deflected while not charging');

  // Charging his sword -> weak spot open.
  hero.charging = true;
  boss.hitTest(shot(hero.x + hero.w / 2, hero.y + hero.h / 2, 4));
  assert.ok(hero.hp < hpBefore, 'vulnerable only during the sword charge');
});

test('REGRESSION: a piercing shot damages a boss weak point only ONCE per shot', () => {
  // Guards the pierce-dedup in every boss hitTest. A LASER ring lingers over a
  // weak point for many frames; without the proj.hitSet gate it would re-bite
  // every overlapping frame and melt bosses instantly. A real Projectile is
  // born with a hitSet (entities.js), so we mirror that here.
  const pierceShot = (x, y, dmg = 3) => ({
    x, y, dmg, pierce: true, hitSet: new Set(),
    hitbox: () => ({ x: x - 3, y: y - 3, w: 6, h: 6 }),
  });

  // --- Man-At-Arms core ---
  const g1 = createGame();
  g1.loadLevel(0);
  const maa = new g1.classes.ManAtArms(g1.engine, 1000, 200);
  const cb = maa.coreBox();
  const ring = pierceShot(cb.x + cb.w / 2, cb.y + cb.h / 2, 3);
  const maaBefore = maa.hp;
  maa.hitTest(ring);
  assert.equal(maa.hp, maaBefore - 3, 'first overlap deals damage');
  maa.hitTest(ring);
  maa.hitTest(ring);
  assert.equal(maa.hp, maaBefore - 3, 'same shot never re-damages the core');

  // --- He-Man mid-charge weak spot ---
  const g2 = createGame();
  g2.loadLevel(2);
  const hm = new g2.classes.HeManBattleCat(g2.engine, 2400, 200);
  hm.cat.hp = 1;
  hm.hitTest(shot(hm.cat.x + hm.cat.w / 2, hm.cat.y + hm.cat.h / 2, 4));
  hm.update();                          // flips to phase 2 (He-Man on foot)
  assert.equal(hm.phase, 2);
  const hero = hm.hero;
  hero.charging = true;                 // open the weak spot
  const heroRing = pierceShot(hero.x + hero.w / 2, hero.y + hero.h / 2, 3);
  const heroBefore = hero.hp;
  hm.hitTest(heroRing);
  assert.equal(hero.hp, heroBefore - 3, 'charge window: first overlap deals damage');
  hm.hitTest(heroRing);
  hm.hitTest(heroRing);
  assert.equal(hero.hp, heroBefore - 3, 'same shot never re-damages the charge weak spot');
});

test('He-Man is BEATABLE: a no-invuln dodge-and-shoot bot wins both phases -> VICTORY', () => {
  // The unit tests above prove the weak-point gating; this drives the whole
  // fight in the real engine with NO invulnerability to prove it is winnable by
  // skill: Battle Cat prowls to point-blank then lunges (leap it, timed off its
  // approach), and He-Man's sword slash spawns a shockwave on the player the
  // instant the charge completes (be airborne before it fires). The bot holds
  // position, fires right the whole time, and only ever jumps to dodge.
  const g = createGame();
  g.loadLevel(2);
  const lvl = g.level;
  const p = g.player;
  const eng = g.engine;
  lvl.phase = 'hallway';
  p.x = lvl.bossX - 140; p.y = lvl.groundY - p.h;   // the boss gate triggers here
  p.vx = 0; p.vy = 0; p.onGround = true; p.facing = 1;
  g.step(2);
  assert.ok(eng.boss, 'boss spawns at the hallway gate');

  const pcx = () => p.x + p.w / 2;
  // Predicted frames until Battle Cat's body reaches the player (Infinity = safe).
  const lungeArrival = (c) => {
    const cCx = c.x + c.w / 2;
    const gap = Math.max(0, Math.abs(pcx() - cCx) - (c.w / 2 + p.w / 2));
    if (c.state === 'windup') return (30 - c.t) + gap / 5.2;
    if (c.state === 'lunge') return Math.sign(c.dir) === Math.sign(pcx() - cCx) ? gap / 5.2 : Infinity;
    return Infinity;
  };

  let reachedPhase2 = false;
  g.hold('KeyJ');   // fire continuously; no horizontal input, so facing stays right
  for (let frame = 0; frame < 12000; frame++) {
    if (p.dead || eng.state === 'VICTORY') break;
    const b = eng.boss;
    if (!b) { g.step(1); continue; }  // boss dead: ride out the level-cleared timer to VICTORY
    if (b.phase === 2) reachedPhase2 = true;

    let jump = false;
    for (const w of b.shockwaves) if (Math.abs(pcx() - w.x) < 52) jump = true;         // ground shockwaves
    for (const s of eng.enemyShots) if (Math.abs(s.x - pcx()) < 48 && (s.vx || 0) !== 0) jump = true; // bolts
    if (b.phase === 1) { const a = lungeArrival(b.cat); if (a >= 2 && a <= 13) jump = true; } // leap the cat
    if (b.phase === 2 && b.hero.charging && b.hero.chargeT >= 84 && b.hero.chargeT <= 89) jump = true; // pre-slash

    if (jump && p.onGround) g.tap('KeyK');
    g.step(1);
  }
  g.release('KeyJ');

  assert.ok(reachedPhase2, 'the bot downs Battle Cat and reaches He-Man (phase 2)');
  assert.equal(eng.state, 'VICTORY', 'a fair player can defeat both phases without dying');
  assert.equal(p.dead, false, 'and survive the fight');
});

// ---------------------------------------------------------------------------
// Health-bar contract — one invariant guarding EVERY stage boss's bar.
//
// The HUD draws `boss.hp / boss.maxHp` and clamps the result to [0,1]
// (engine.js _healthBar). That clamp HIDES a mismatched bar — it just sits at
// the wrong length instead of glitching — which is exactly why He-Man's summed
// maxHp (34+26=60 while hp returned only the active phase) shipped unnoticed,
// stuck at ~57% then capped at ~43%. So we read hp/maxHp directly and assert
// the contract every bar must honor:
//   • full at spawn (hp === maxHp),
//   • within [0,1] once damaged,
//   • (sequential-phase bosses) refills to full at the next phase,
//   • empty once the boss is defeated.
// Each boss's UNIQUE weak-point mechanic is covered by its own test above.
// ---------------------------------------------------------------------------
const bossSpecs = [
  {
    name: 'Man-At-Arms',
    make: (g) => new g.classes.ManAtArms(g.engine, 1000, 200),
    hurt: (boss) => {
      const c = boss.coreBox();
      boss.hitTest(shot(c.x + c.w / 2, c.y + c.h / 2, 4));
    },
    kill: (boss) => {
      let n = 0;
      while (!boss.dead && n++ < 300) {
        const c = boss.coreBox();
        boss.hitTest(shot(c.x + c.w / 2, c.y + c.h / 2, 4));
      }
    },
  },
  {
    name: 'Sorceress & Stratos',
    make: (g) => new g.classes.SorceressStratos(g.engine, 3000, 200),
    hurt: (boss) => {
      const s = boss.stratos;
      boss.hitTest(shot(s.x + s.w / 2, s.y + s.h / 2, 4));
    },
    kill: (boss) => {
      const s = boss.stratos, q = boss.sorc;
      let n = 0;
      while (s.alive && n++ < 300) boss.hitTest(shot(s.x + s.w / 2, s.y + s.h / 2, 4));
      n = 0;
      while (!boss.dead && n++ < 300) boss.hitTest(shot(q.x + q.w / 2, q.y + q.h / 2, 4));
    },
  },
  {
    name: 'He-Man & Battle Cat',
    make: (g) => new g.classes.HeManBattleCat(g.engine, 2400, 200),
    hurt: (boss) => {
      const c = boss.cat;
      boss.hitTest(shot(c.x + c.w / 2, c.y + c.h / 2, 4));
    },
    // Sequential phases: down the Cat -> He-Man on foot. update() detects the KO.
    advancePhase: (boss) => {
      let n = 0;
      while (boss.phase === 1 && n++ < 300) {
        boss.cat.hp = 1;
        boss.hitTest(shot(boss.cat.x + boss.cat.w / 2, boss.cat.y + boss.cat.h / 2, 4));
        boss.update();
      }
    },
    kill: (boss) => {
      let n = 0;
      while (boss.phase === 1 && n++ < 300) {
        boss.cat.hp = 1;
        boss.hitTest(shot(boss.cat.x + boss.cat.w / 2, boss.cat.y + boss.cat.h / 2, 4));
        boss.update();
      }
      n = 0;
      while (!boss.dead && n++ < 300) {
        boss.hero.charging = true;   // hold the weak-spot window open
        boss.hero.chargeT = 0;
        boss.hitTest(shot(boss.hero.x + boss.hero.w / 2, boss.hero.y + boss.hero.h / 2, 4));
        boss.update();               // _updateHero flips `dead` once hp <= 0
      }
    },
  },
];

for (const spec of bossSpecs) {
  test(`REGRESSION: ${spec.name} health bar obeys the hp/maxHp contract`, () => {
    const g = createGame();
    g.loadLevel(0);                  // give the engine a player for boss AI
    const clamp = g.classes.clamp;
    const boss = spec.make(g);
    const raw = () => boss.hp / boss.maxHp;      // what the HUD divides
    const shown = () => clamp(raw(), 0, 1);      // what the HUD actually paints

    // Full at spawn.
    assert.equal(boss.hp, boss.maxHp, `${spec.name}: hp === maxHp at spawn`);
    assert.equal(raw(), 1, `${spec.name}: bar reads full at spawn`);

    // Damaged -> drops, still within (0,1).
    spec.hurt(boss);
    assert.ok(raw() > 0 && raw() < 1,
      `${spec.name}: bar within (0,1) after damage (got ${raw()})`);

    // Sequential-phase bosses refill to full at the next phase.
    if (spec.advancePhase) {
      spec.advancePhase(boss);
      assert.equal(boss.hp, boss.maxHp,
        `${spec.name}: hp === maxHp at the start of the next phase`);
      assert.equal(raw(), 1, `${spec.name}: bar refills to full on phase change`);
    }

    // Defeated -> the painted bar empties.
    spec.kill(boss);
    assert.equal(boss.dead, true, `${spec.name}: can be brought down`);
    assert.equal(shown(), 0, `${spec.name}: bar empties on defeat`);
  });
}

/* ----------------------------------------------------------------------------
 *  RESPAWN RESETS THE FIGHT — a boss chipped down before Skeletor falls must
 *  return at FULL health when he respawns; a killed mid-boss stays killed.
 * ------------------------------------------------------------------------- */

test('stage boss returns at full HP after the player dies and respawns', () => {
  const g = createGame();
  g.loadLevel(0);

  // Reach the Man-At-Arms gate so the boss spawns.
  g.player.x = g.level.bossX;
  g.step(1);
  assert.ok(g.boss, 'stage boss spawned at the gate');
  const maxHp = g.boss.maxHp;

  // Chip it down.
  g.boss.hp = Math.floor(maxHp / 2);
  assert.ok(g.boss.hp < maxHp);

  // Skeletor falls (clear i-frames so the kill lands), then respawns.
  g.player.invuln = 0;
  g.engine.killPlayer();
  g.step(50); // respawn timer is 45 frames

  assert.equal(g.boss, null, 'damaged boss instance is dropped on respawn');
  assert.equal(g.level.bossTriggered, false, 'boss trigger re-armed');

  // Walk back to the gate -> a pristine boss with full health.
  g.player.x = g.level.bossX;
  g.step(1);
  assert.ok(g.boss, 'a fresh boss re-spawns on return');
  assert.equal(g.boss.hp, g.boss.maxHp, 'the new boss starts at full HP');
});

test('living mid-boss re-spawns fresh after a respawn', () => {
  const g = createGame();
  g.loadLevel(0);

  // Trip the Battle Ram spawner (atX 2000) from just short of the Ram itself
  // (2320) so the drop-in doesn't collide with it on the spawn frame.
  g.player.x = 2100;
  g.step(1);
  assert.ok(g.level.midBoss, 'mid-boss spawned');
  const maxHp = g.level.midBoss.maxHp;
  g.level.midBoss.hp = 1; // nearly dead but still alive

  // Skeletor falls -> respawns at checkpoint 1520, BEHIND the spawner, so the
  // chipped Ram is torn down and no fresh one exists until he presses forward.
  g.player.invuln = 0;
  g.engine.killPlayer();
  g.step(50);
  assert.equal(g.level.midBoss, null, 'the chipped mid-boss is dropped on respawn');
  assert.equal(g.level.midBossSpawner.done, false, 'the spawner is re-armed');

  // Advance back past the trigger -> a pristine, full-HP Ram re-spawns.
  g.player.x = 2100;
  g.step(2);
  assert.ok(g.level.midBoss, 'a fresh mid-boss re-spawns on return');
  assert.equal(g.level.midBoss.hp, maxHp, 'the new mid-boss starts at full HP');
});

test('a defeated mid-boss is not resurrected by a later respawn', () => {
  const g = createGame();
  g.loadLevel(0);

  // Spawn and kill the mid-boss.
  g.player.x = 2100;
  g.step(1);
  g.level.midBoss.hp = 0;
  g.level.midBoss.dead = true;
  g.step(1); // level.update flags midBossDead
  assert.equal(g.level.midBossDead, true);

  // Later death must not bring the Ram back — even after walking past its gate.
  g.player.invuln = 0;
  g.engine.killPlayer();
  g.step(50);
  g.player.x = 2100;
  g.step(2);

  assert.equal(g.level.midBossSpawner.done, true, 'spawner is not re-armed for a beaten mid-boss');
  assert.ok(!g.level.midBoss || g.level.midBoss.dead, 'the beaten mid-boss stays beaten');
});

test('a bypassed living mid-boss is NOT re-materialized behind the player on respawn', () => {
  // The mid-boss gate (atX 2000) sits behind checkpoints 2450 and 3050, so a
  // player can slip past the still-living Battle Ram and die ahead of it. The
  // respawn must NOT re-arm the spawner — that would spawn a fresh full-HP Ram
  // behind the respawn point, outside its patrol range.
  const g = createGame();
  g.loadLevel(0);

  // Trip the spawner, chip the Ram, then advance well past it (checkpoint 2450).
  g.player.x = 2100;
  g.step(1);
  assert.ok(g.level.midBoss, 'mid-boss spawned');
  g.level.midBoss.hp = 5; // damaged but alive
  g.player.x = 2600;      // past the Ram; nearest checkpoint is 2450 (>= gate 2000)

  g.player.invuln = 0;
  g.engine.killPlayer();
  g.step(50);

  assert.equal(g.level.midBossSpawner.done, true, 'gate stays armed — no Ram re-spawns behind the player');
  // No pristine full-HP Ram was conjured at the gate.
  assert.ok(!g.level.midBoss || g.level.midBoss.hp !== g.level.midBoss.maxHp,
    'no fresh full-HP mid-boss appears behind the respawn point');
});
