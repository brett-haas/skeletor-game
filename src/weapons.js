/* ============================================================================
 *  SKELETOR'S CONQUEST — WEAPON DEFINITIONS
 *  DEFAULT / SPREAD / LASER / FLAME / BARRIER fire factories.
 * ========================================================================== */

'use strict';

/* ============================================================================
 * [5] WEAPON DEFINITIONS
 *   Each weapon: cooldown (frames), and a fire(engine, origin, aim) factory.
 *   BARRIER is a pure status overlay (invulnerability) — see Player.setWeapon;
 *   it keeps your current weapon and has no fire factory of its own.
 * ========================================================================== */

const Weapons = {
  [WEAPON.DEFAULT]: {
    name: 'BONE BOLT',
    cooldown: 10,               // snappier — you fall back to this on death
    fire(engine, ox, oy, aim) {
      engine.spawnPlayerShot(ox, oy, aim.x * 5.6, aim.y * 5.6, {
        kind: 'skull', r: 3, color: PAL.bone, life: 95,
      });
    },
  },

  [WEAPON.SPREAD]: {
    name: 'SPREAD CURSE',
    cooldown: 15,
    fire(engine, ox, oy, aim) {
      // 5 skulls in a fan. Tightened from a near-useless ~96° splay to a
      // focused arc so the pellets actually converge on mid-range foes,
      // with a little more speed and reach to match.
      const base = Math.atan2(aim.y, aim.x);
      const spread = 0.30; // radians between shots
      for (let i = -2; i <= 2; i++) {
        const a = base + i * spread;
        engine.spawnPlayerShot(ox, oy, Math.cos(a) * 5.0, Math.sin(a) * 5.0, {
          kind: 'skull', r: 2.5, color: PAL.toxic, life: 85,
        });
      }
    },
  },

  [WEAPON.LASER]: {
    name: 'LIGHT-RING LASER',
    cooldown: 34,
    fire(engine, ox, oy, aim) {
      // Slow, massive, wall/enemy-piercing ring of dark energy.
      engine.spawnPlayerShot(ox, oy, aim.x * 2.6, aim.y * 2.6, {
        kind: 'ring', r: 11, color: PAL.purple, life: 140,
        // One bite per target per shot (boss hitTests dedup via proj.hitSet,
        // same as the enemy loop), so dmg is tuned as a per-hit burst: strong
        // on bosses (~17 DPS at cd 34), well under FLAME's ~80 DPS up close.
        pierce: true, dmg: 10, grow: 0.12,
      });
    },
  },

  [WEAPON.FLAME]: {
    name: 'FLAME SPIT',
    cooldown: 3,               // fast, roaring stream of dark fire
    fire(engine, ox, oy, aim) {
      // Short range, but a MELTING torrent. Two fat embers per tick in a
      // TIGHT cone that rotates with your aim (no more wild scatter), each
      // dealing double damage. Highest single-target DPS in the arsenal —
      // the reward for fighting nose-to-nose — but the flame LICKS only a
      // short distance (embers expire fast), so it falls off sharply with
      // range. Hug your target or waste your breath.
      const base = Math.atan2(aim.y, aim.x);
      const tones = [PAL.havoc, PAL.ember, PAL.blood];
      for (let i = 0; i < 2; i++) {
        const a = base + rand(-0.16, 0.16);   // tight cone
        const spd = rand(4.4, 6.0);
        engine.spawnPlayerShot(ox + aim.x * 4, oy + aim.y * 4,
          Math.cos(a) * spd, Math.sin(a) * spd, {
            kind: 'flame', r: rand(3, 5), color: tones[i % tones.length],
            life: randInt(11, 16),   // ~55-80px reach: short, with falloff
            dmg: 2,                  // high damage output, per the spec
            shortRange: true,
          });
      }
    },
  },

  [WEAPON.BARRIER]: {
    // Not a weapon — a pure STATUS pickup (a timed window of i-frames + the
    // bubble, granted in Player.setWeapon; duration is BARRIER_TIME in config).
    // No `fire`: it never becomes p.weapon, so it never fires. Kept here only
    // so the pickup banner can read its name.
    name: 'BARRIER',
  },
};
