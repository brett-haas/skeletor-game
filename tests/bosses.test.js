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
