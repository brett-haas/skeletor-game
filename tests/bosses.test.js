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
