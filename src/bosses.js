/* ============================================================================
 *  SKELETOR'S CONQUEST — BOSSES
 *  Man-At-Arms, Sorceress & Stratos, He-Man & Battle Cat.
 * ========================================================================== */

'use strict';

/* ============================================================================
 * [8] BOSSES
 *   Each boss is an object with hp, update(), render(), and a hitTest for
 *   player projectiles. They report `dead` when defeated.
 * ========================================================================== */

// ---- 8a. MAN-AT-ARMS (L1) ------------------------------------------------
// Multi-tiered defensive wall: center laser + fragmentation grenades.
// WEAKNESS: the core generator beneath his platform.
class ManAtArms {
  constructor(engine, x, groundY) {
    this.engine = engine;
    this.x = x; this.groundY = groundY;
    this.w = 70; this.h = 90;
    this.y = groundY - this.h;
    this.hp = 40; this.maxHp = 40;
    this.dead = false;
    this.t = 0;
    this.laserT = 120;
    this.grenadeT = 90;
    this.laserActive = 0;
    this.hurtT = 0;
    // Core generator hitbox sits under the platform (the only weak point).
    this.core = { ox: 22, oy: 70, w: 26, h: 20 };
  }

  coreBox() {
    return { x: this.x + this.core.ox, y: this.y + this.core.oy, w: this.core.w, h: this.core.h };
  }

  update() {
    this.t++;
    if (this.hurtT > 0) this.hurtT--;
    const p = this.engine.player;

    // Center laser: telegraph then fire a lethal horizontal beam.
    if (--this.laserT <= 0) {
      this.laserActive = 60;
      this.laserT = 200;
    }
    if (this.laserActive > 0) {
      this.laserActive--;
      // Beam becomes lethal after a short charge.
      if (this.laserActive < 40) {
        const beamY = this.y + 34;
        const pb = p.hitbox();
        if (!p.invulnerable && p.x < this.x && pb.y < beamY + 4 && pb.y + pb.h > beamY - 4) {
          this.engine.killPlayer();
        }
      }
    }

    // Fragmentation grenades: lobbed toward the player, burst into shards.
    if (--this.grenadeT <= 0) {
      this.grenadeT = randInt(120, 170);
      const gx = this.x + 10, gy = this.y + 20;
      const nade = new Projectile(gx, gy, -3.2, -4.5, {
        kind: 'grenade', r: 4, color: PAL.steel, life: 80, dmg: 1,
      });
      nade.grav = GRAVITY * 0.6;
      nade.fuse = 46;
      this.engine.enemyShots.push(nade);
    }
  }

  // Player projectile hit test — only the core takes damage.
  hitTest(proj) {
    const cb = this.coreBox();
    if (aabb(proj.hitbox(), cb)) {
      this.hp -= proj.dmg; this.hurtT = 6;
      this.engine.spawnBurst(cb.x + cb.w / 2, cb.y + cb.h / 2, PAL.havoc, 8);
      if (this.hp <= 0) this.dead = true;
      return true;
    }
    // The armored wall body blocks (and stops) non-piercing shots harmlessly.
    if (aabb(proj.hitbox(), { x: this.x, y: this.y, w: this.w, h: this.core.oy })) {
      this.engine.spawnBurst(proj.x, proj.y, PAL.steel, 3);
      return true; // absorbed, no damage
    }
    return false;
  }

  render(ctx, cam) {
    const x = this.x - cam.x, y = this.y - cam.y;
    const R = (rx, ry, rw, rh, c) => { ctx.fillStyle = c; ctx.fillRect(x + rx, y + ry, rw, rh); };
    const hurt = this.hurtT > 0;

    // ---- Fortified battlement wall ----
    R(0, 0, this.w, 68, hurt ? PAL.white : PAL.steel);
    // Crenellations along the top.
    for (let cxp = 0; cxp < this.w; cxp += 14) R(cxp, -4, 8, 5, hurt ? PAL.white : PAL.steel);
    // Riveted armor plates in three tiers.
    for (const ty of [6, 26, 44]) {
      R(4, ty, this.w - 8, 14, PAL.stoneD);
      R(6, ty + 2, this.w - 12, 10, hurt ? PAL.gray : '#6b7486');
      ctx.fillStyle = PAL.gray;
      ctx.fillRect(x + 8, y + ty + 4, 1, 1); ctx.fillRect(x + this.w - 9, y + ty + 4, 1, 1);
      ctx.fillRect(x + 8, y + ty + 8, 1, 1); ctx.fillRect(x + this.w - 9, y + ty + 8, 1, 1);
    }

    // ---- Man-At-Arms bust above the wall ----
    // Orange helmet dome + crest + side flaps.
    R(26, -15, 18, 9, hurt ? PAL.white : PAL.ember);
    R(33, -19, 4, 5, PAL.brown);                 // crest
    R(24, -12, 3, 8, PAL.ember); R(43, -12, 3, 8, PAL.ember); // ear flaps
    // Visor slit with glowing eyes.
    R(27, -7, 16, 2, PAL.black);
    ctx.fillStyle = PAL.havoc;
    ctx.fillRect(x + 30, y - 7, 2, 1); ctx.fillRect(x + 38, y - 7, 2, 1);
    // Exposed lower face + big moustache.
    R(28, -5, 14, 5, hurt ? PAL.white : PAL.skin);
    R(28, -2, 14, 2, PAL.brown);
    R(34, -1, 2, 1, PAL.skin);                   // moustache part

    // ---- Center laser cannon (with barrel + muzzle) ----
    R(-8, 28, 12, 10, PAL.stoneD);
    R(-6, 30, 10, 6, PAL.blood);
    R(-12, 31, 6, 4, PAL.gray);
    if (this.laserActive > 0) {
      const charging = this.laserActive >= 40;
      ctx.strokeStyle = charging ? 'rgba(255,210,63,0.5)' : PAL.blood;
      ctx.lineWidth = charging ? 2 : 5;
      ctx.beginPath(); ctx.moveTo(x - 12, y + 33); ctx.lineTo(-cam.x, y + 33); ctx.stroke();
    }

    // ---- Exposed CORE GENERATOR (the weak point) — pulsing when alive ----
    const cb = this.coreBox();
    const cx = cb.x - cam.x, cy = cb.y - cam.y;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 0.2);
    ctx.fillStyle = PAL.stoneD; ctx.fillRect(cx - 2, cy - 2, cb.w + 4, cb.h + 4); // housing
    ctx.fillStyle = `rgba(255,210,63,${0.5 + pulse * 0.5})`;
    ctx.fillRect(cx, cy, cb.w, cb.h);
    ctx.fillStyle = PAL.blood;
    ctx.fillRect(cx + 5, cy + 5, cb.w - 10, cb.h - 10);
    ctx.fillStyle = PAL.white;
    ctx.fillRect(cx + cb.w / 2 - 1, cy + cb.h / 2 - 1, 2, 2);
    ctx.strokeStyle = PAL.havoc; ctx.lineWidth = 1; ctx.strokeRect(cx, cy, cb.w, cb.h);
  }
}

// ---- 8b. SORCERESS & STRATOS (L2) ---------------------------------------
// Aerial tag-team, now fought in a side-scroll arena. Stratos swoops across
// the top bombing rocks; the Sorceress teleports and fires homing bolts. She
// is WARDED (invulnerable) until Stratos is shot down — kill him first.
class SorceressStratos {
  constructor(engine, x, groundY) {
    this.engine = engine;
    this.groundY = groundY;
    this.dead = false;
    this.arena = { minX: x - 250, maxX: x + 20 };
    const cx = x - 130;

    // Stratos flits across the top of the arena.
    this.stratos = {
      x: cx, y: groundY - 150, w: 34, h: 22, hp: 16, maxHp: 16,
      dir: 1, dropT: 60, alive: true, hurtT: 0,
    };
    // Sorceress teleports around; vulnerable only after Stratos falls.
    this.sorc = {
      x: cx - 40, y: groundY - 110, w: 16, h: 30, hp: 22, maxHp: 22,
      tpT: 120, boltT: 80, hurtT: 0,
    };
    this.maxHp = this.stratos.maxHp + this.sorc.maxHp;
  }

  get hp() { return (this.stratos.alive ? this.stratos.hp : 0) + this.sorc.hp; }

  update() {
    const p = this.engine.player;

    // ---- STRATOS: swoops back and forth, bombing rocks ----
    if (this.stratos.alive) {
      const s = this.stratos;
      if (s.hurtT > 0) s.hurtT--;
      s.x += s.dir * 1.8;
      if (s.x < this.arena.minX) { s.x = this.arena.minX; s.dir = 1; }
      if (s.x > this.arena.maxX) { s.x = this.arena.maxX; s.dir = -1; }
      s.y = this.groundY - 150 + Math.sin(this.engine.frame * 0.05) * 12;  // bob
      if (--s.dropT <= 0) {
        s.dropT = randInt(55, 95);
        // A rock that falls to the ground, drifting toward the player.
        const rock = new Projectile(s.x + s.w / 2, s.y + s.h,
          clamp(sign(p.x - s.x) * 0.6, -1.2, 1.2), 2.6, {
            kind: 'rock', r: 6, color: PAL.stone, life: 200, dmg: 1,
          });
        this.engine.enemyShots.push(rock);
      }
    }

    // ---- SORCERESS: teleports, fires homing bolts ----
    const q = this.sorc;
    if (q.hurtT > 0) q.hurtT--;
    if (--q.tpT <= 0) {
      q.tpT = randInt(90, 150);
      this.engine.spawnBurst(q.x + q.w / 2, q.y + q.h / 2, PAL.cyan, 10);
      q.x = rand(this.arena.minX, this.arena.maxX);
      q.y = this.groundY - rand(60, 140);
      this.engine.spawnBurst(q.x + q.w / 2, q.y + q.h / 2, PAL.purple, 10);
    }
    if (--q.boltT <= 0) {
      q.boltT = this.stratos.alive ? randInt(90, 140) : randInt(55, 85);
      const b = new Projectile(q.x + q.w / 2, q.y + q.h / 2, 0, 0, {
        kind: 'bolt', r: 4, color: PAL.purple, life: 240, dmg: 1, homing: 0.035,
      });
      const a = Math.atan2((p.y + p.h / 2) - b.y, (p.x + p.w / 2) - b.x);
      b.vx = Math.cos(a) * 2.4; b.vy = Math.sin(a) * 2.4;
      this.engine.enemyShots.push(b);
    }

    if (!this.stratos.alive && this.sorc.hp <= 0) this.dead = true;
  }

  hitTest(proj) {
    // Stratos first.
    if (this.stratos.alive) {
      const s = this.stratos;
      if (aabb(proj.hitbox(), { x: s.x, y: s.y, w: s.w, h: s.h })) {
        s.hp -= proj.dmg; s.hurtT = 6;
        this.engine.spawnBurst(proj.x, proj.y, PAL.cyan, 6);
        if (s.hp <= 0) {
          s.alive = false;
          this.engine.banner('STRATOS DOWN! STRIKE THE SORCERESS!', 130);
        }
        return true;
      }
    }
    // Sorceress — vulnerable only once Stratos is gone; otherwise warded.
    const q = this.sorc;
    if (aabb(proj.hitbox(), { x: q.x, y: q.y, w: q.w, h: q.h })) {
      if (!this.stratos.alive) {
        q.hp -= proj.dmg; q.hurtT = 6;
        this.engine.spawnBurst(proj.x, proj.y, PAL.purple, 6);
        if (q.hp <= 0) this.dead = true;
      } else {
        this.engine.spawnBurst(proj.x, proj.y, PAL.cyan, 3);   // ward deflect
      }
      return true;
    }
    return false;
  }

  render(ctx, cam) {
    // ---- Stratos: winged jet-warrior ----
    if (this.stratos.alive) {
      const s = this.stratos;
      const x = s.x - cam.x, y = s.y - cam.y;
      const hurt = s.hurtT > 0;
      const flap = Math.sin(this.engine.frame * 0.4) * 7;
      // Grey wings with red tips, flapping.
      ctx.fillStyle = PAL.gray;
      ctx.beginPath();
      ctx.moveTo(x + 5, y + 8); ctx.lineTo(x - 18, y + 3 - flap);
      ctx.lineTo(x - 14, y + 11 - flap); ctx.lineTo(x + 3, y + 15); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + s.w - 5, y + 8); ctx.lineTo(x + s.w + 18, y + 3 - flap);
      ctx.lineTo(x + s.w + 14, y + 11 - flap); ctx.lineTo(x + s.w - 3, y + 15); ctx.closePath(); ctx.fill();
      ctx.fillStyle = PAL.blood;
      ctx.fillRect(x - 18, y + 2 - flap, 4, 3); ctx.fillRect(x + s.w + 14, y + 2 - flap, 4, 3);
      // Blue torso + red harness X.
      ctx.fillStyle = hurt ? PAL.white : PAL.hood;
      ctx.fillRect(x + 6, y + 4, s.w - 12, s.h - 4);
      ctx.strokeStyle = PAL.blood; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 8, y + 5); ctx.lineTo(x + s.w - 8, y + s.h - 2);
      ctx.moveTo(x + s.w - 8, y + 5); ctx.lineTo(x + 8, y + s.h - 2); ctx.stroke();
      // Head: aviator cap, goggles, beard.
      const hx = x + s.w / 2;
      ctx.fillStyle = PAL.skin; ctx.fillRect(hx - 4, y - 4, 8, 7);
      ctx.fillStyle = hurt ? PAL.white : PAL.hoodDk; ctx.fillRect(hx - 5, y - 6, 10, 4);
      ctx.fillStyle = PAL.black; ctx.fillRect(hx - 4, y - 2, 8, 2);
      ctx.fillStyle = PAL.cyan; ctx.fillRect(hx - 3, y - 2, 2, 1); ctx.fillRect(hx + 1, y - 2, 2, 1);
      ctx.fillStyle = PAL.gray; ctx.fillRect(hx - 3, y + 3, 6, 2);
    }

    // ---- Sorceress: falcon-masked, robed ----
    const q = this.sorc;
    const x = q.x - cam.x, y = q.y - cam.y;
    const hurt = q.hurtT > 0;
    const warded = this.stratos.alive;
    // Feathered cape.
    ctx.fillStyle = PAL.steel;
    ctx.beginPath();
    ctx.moveTo(x - 1, y + 6); ctx.lineTo(x - 6, y + q.h);
    ctx.lineTo(x + q.w + 6, y + q.h); ctx.lineTo(x + q.w + 1, y + 6); ctx.closePath(); ctx.fill();
    // Teal robe, tapering to the hem.
    ctx.fillStyle = hurt ? PAL.white : PAL.cyan;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 8); ctx.lineTo(x + q.w - 2, y + 8);
    ctx.lineTo(x + q.w + 2, y + q.h); ctx.lineTo(x - 2, y + q.h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = PAL.havoc; ctx.fillRect(x + q.w / 2 - 1, y + 12, 2, 5); // emblem
    // Falcon headdress with wing flares + downturned beak.
    ctx.fillStyle = PAL.white;
    ctx.fillRect(x, y - 2, q.w, 8);
    ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x - 5, y - 5); ctx.lineTo(x + 2, y - 1); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + q.w, y + 2); ctx.lineTo(x + q.w + 5, y - 5); ctx.lineTo(x + q.w - 2, y - 1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = PAL.skin; ctx.fillRect(x + 3, y + 4, q.w - 6, 5); // face
    ctx.fillStyle = PAL.purple; ctx.fillRect(x + 4, y + 5, 2, 1); ctx.fillRect(x + q.w - 6, y + 5, 2, 1);
    ctx.fillStyle = PAL.havoc;  // beak
    ctx.beginPath();
    ctx.moveTo(x + q.w / 2 - 2, y + 5); ctx.lineTo(x + q.w / 2 + 2, y + 5); ctx.lineTo(x + q.w / 2, y + 10);
    ctx.closePath(); ctx.fill();
    if (warded) {
      const a = 0.4 + 0.2 * Math.sin(this.engine.frame * 0.2);
      ctx.strokeStyle = `rgba(75,214,214,${a + 0.2})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x + q.w / 2, y + q.h / 2, 22, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

// ---- 8c. HE-MAN & BATTLE CAT (L3, FINAL) --------------------------------
// Phase 1: He-Man rides Battle Cat, lunging + ground shockwaves. Hit the Cat.
// Phase 2: He-Man on foot, deflects shots — weak spot ONLY when sword charges.
class HeManBattleCat {
  constructor(engine, x, groundY) {
    this.engine = engine;
    this.groundY = groundY;
    this.phase = 1;
    this.dead = false;

    // Phase 1 — Battle Cat.
    this.cat = {
      x: x, y: groundY - 30, w: 52, h: 30, hp: 34, maxHp: 34,
      state: 'idle', t: 0, dir: -1, hurtT: 0, homeX: x,
    };
    // Phase 2 — He-Man on foot.
    this.hero = {
      x: x + 10, y: groundY - 30, w: 18, h: 30, hp: 26, maxHp: 26,
      charging: false, chargeT: 0, cooldownT: 120, hurtT: 0, dir: -1,
    };
    this.shockwaves = [];
  }

  // hp/maxHp track the ACTIVE phase (the two fights are sequential, not
  // simultaneous like Sorceress & Stratos), so the HUD bar fills at the start
  // of each phase and drains cleanly to empty. Summing both pools left the bar
  // stuck at 57% (phase 1) then capped at 43% (phase 2), never full.
  get hp() { return this.phase === 1 ? this.cat.hp : this.hero.hp; }
  get maxHp() { return this.phase === 1 ? this.cat.maxHp : this.hero.maxHp; }

  update() {
    const p = this.engine.player;
    if (this.phase === 1) this._updateCat(p);
    else this._updateHero(p);

    // Ground shockwaves travel outward; lethal unless the player jumps.
    for (const w of this.shockwaves) {
      w.x += w.vx; w.life--;
      const pb = p.hitbox();
      const grounded = p.onGround;
      if (grounded && !p.invulnerable &&
          Math.abs((pb.x + pb.w / 2) - w.x) < 16 &&
          pb.y + pb.h > this.groundY - 14) {
        this.engine.killPlayer();
      }
      if (w.life <= 0) w.dead = true;
    }
    this.shockwaves = this.shockwaves.filter((w) => !w.dead);
  }

  _updateCat(p) {
    const c = this.cat;
    c.t++;
    if (c.hurtT > 0) c.hurtT--;

    if (c.state === 'idle') {
      // Track toward the player a bit, then wind up a lunge.
      c.x += sign((p.x) - c.x) * 0.6;
      if (c.t > 70) { c.state = 'windup'; c.t = 0; }
    } else if (c.state === 'windup') {
      if (c.t > 30) { c.state = 'lunge'; c.dir = sign(p.x - c.x) || -1; c.t = 0; }
    } else if (c.state === 'lunge') {
      c.x += c.dir * 5.2;
      // Lethal body check during the lunge.
      if (!p.invulnerable && aabb(p.hitbox(), { x: c.x, y: c.y, w: c.w, h: c.h })) {
        this.engine.killPlayer();
      }
      // On reaching a wall of the arena, slam -> shockwave.
      if (c.x < this.cat.homeX - 220 || c.x > this.cat.homeX + 40) {
        c.state = 'recover'; c.t = 0;
        this.shockwaves.push({ x: c.x + c.w / 2, vx: 3, life: 90 });
        this.shockwaves.push({ x: c.x + c.w / 2, vx: -3, life: 90 });
        this.engine.shake(8);
      }
    } else if (c.state === 'recover') {
      if (c.t > 45) { c.state = 'idle'; c.t = 0; }
    }

    if (c.hp <= 0) {
      this.phase = 2;
      this.hero.x = clamp(c.x, this.cat.homeX - 180, this.cat.homeX);
      this.engine.banner('BATTLE CAT DOWN! HE-MAN STANDS ALONE!', 150);
      this.engine.shake(12);
    }
  }

  _updateHero(p) {
    const h = this.hero;
    if (h.hurtT > 0) h.hurtT--;
    h.dir = sign(p.x - h.x) || -1;

    if (!h.charging) {
      // Pace toward the player and periodically fire deflectable bolts.
      h.x += sign(p.x - h.x) * 0.5;
      if (--h.cooldownT <= 0) {
        // Begin charging the sword with lightning -> opens the weak spot.
        h.charging = true; h.chargeT = 0;
      }
      // Occasional sword-bolt (harmless-looking but lethal) at the player.
      if (Math.random() < 0.02) {
        const b = new Projectile(h.x, h.y + 8, sign(p.x - h.x) * 3.4, 0, {
          kind: 'sword', r: 4, color: PAL.hero, life: 120, dmg: 1,
        });
        this.engine.enemyShots.push(b);
      }
    } else {
      h.chargeT++;
      // During the ~90-frame charge, the weak spot is exposed.
      if (h.chargeT > 90) {
        // Unleash a lethal wide slash shockwave, then reset.
        h.charging = false;
        h.cooldownT = randInt(120, 180);
        this.shockwaves.push({ x: h.x, vx: 3.5, life: 80 });
        this.shockwaves.push({ x: h.x, vx: -3.5, life: 80 });
        this.engine.shake(6);
      }
    }

    if (h.hp <= 0) this.dead = true;
  }

  hitTest(proj) {
    if (this.phase === 1) {
      const c = this.cat;
      if (aabb(proj.hitbox(), { x: c.x, y: c.y, w: c.w, h: c.h })) {
        c.hp -= proj.dmg; c.hurtT = 6;
        this.engine.spawnBurst(proj.x, proj.y, PAL.hero, 5);
        if (c.hp <= 0) c.hp = 0;
        return true;
      }
      return false;
    } else {
      const h = this.hero;
      const box = { x: h.x, y: h.y, w: h.w, h: h.h };
      if (aabb(proj.hitbox(), box)) {
        if (h.charging) {
          // Weak spot open — damage lands!
          h.hp -= proj.dmg; h.hurtT = 6;
          this.engine.spawnBurst(proj.x, proj.y, PAL.havoc, 6);
        } else {
          // He-Man deflects with his sword — sparks, no damage.
          this.engine.spawnBurst(proj.x, proj.y, PAL.white, 3);
        }
        return true;
      }
      return false;
    }
  }

  render(ctx, cam) {
    // Shockwaves along the ground.
    for (const w of this.shockwaves) {
      const sx = w.x - cam.x, sy = this.groundY - cam.y;
      const a = clamp(w.life / 90, 0, 1);
      ctx.strokeStyle = `rgba(255,210,63,${a})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sx, sy, 8 + (90 - w.life) * 0.2, Math.PI, Math.PI * 2);
      ctx.stroke();
    }

    if (this.phase === 1) {
      // ---- Battle Cat (armored green tiger) with He-Man astride ----
      const c = this.cat;
      const x = c.x - cam.x, y = c.y - cam.y;
      const hurt = c.hurtT > 0;
      const dir = c.dir < 0 ? -1 : 1;
      const green = hurt ? PAL.white : PAL.toxic;
      // Tail.
      const tailX = dir < 0 ? x + c.w - 2 : x + 2;
      ctx.strokeStyle = green; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tailX, y + 16);
      ctx.quadraticCurveTo(tailX + dir * 8, y + 4, tailX + dir * 2, y - 2);
      ctx.stroke();
      // Legs.
      ctx.fillStyle = PAL.furDk;
      for (const lx of [x + 6, x + 18, x + c.w - 22, x + c.w - 10]) ctx.fillRect(lx, y + c.h - 6, 5, 6);
      // Body + orange stripes.
      ctx.fillStyle = green; ctx.fillRect(x + 2, y + 8, c.w - 4, c.h - 12);
      ctx.fillStyle = PAL.furDk;
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 12 + i * 9, y + 9, 2, c.h - 14);
      // Orange saddle.
      ctx.fillStyle = PAL.ember; ctx.fillRect(x + c.w / 2 - 9, y + 6, 18, 4);
      // Red armored head/mask at the front.
      const hx = dir < 0 ? x - 8 : x + c.w - 14;
      ctx.fillStyle = hurt ? PAL.white : PAL.blood;
      ctx.fillRect(hx, y + 2, 18, 15);
      ctx.fillRect(hx + 6, y - 2, 6, 4);                 // crest
      ctx.fillStyle = PAL.havoc;                          // glowing eye
      ctx.fillRect(hx + (dir < 0 ? 3 : 11), y + 6, 3, 2);
      ctx.fillStyle = PAL.white;                          // fangs
      const jawX = dir < 0 ? hx + 1 : hx + 11;
      ctx.fillRect(jawX, y + 13, 6, 3);
      ctx.fillStyle = PAL.blood; ctx.fillRect(jawX + 2, y + 13, 2, 3);
      // ---- He-Man rider ----
      const rx = x + c.w / 2 - 6, ry = y - 16;
      ctx.fillStyle = hurt ? PAL.white : PAL.skin;
      ctx.fillRect(rx + 1, y - 2, 4, 8); ctx.fillRect(rx + 7, y - 2, 4, 8);  // legs astride
      ctx.fillRect(rx, ry + 4, 12, 12);                                       // torso
      ctx.strokeStyle = PAL.brown; ctx.lineWidth = 2;                         // harness X
      ctx.beginPath();
      ctx.moveTo(rx + 1, ry + 5); ctx.lineTo(rx + 11, ry + 13);
      ctx.moveTo(rx + 11, ry + 5); ctx.lineTo(rx + 1, ry + 13); ctx.stroke();
      ctx.fillStyle = PAL.skin; ctx.fillRect(rx + 3, ry, 6, 6);               // head
      ctx.fillStyle = PAL.hair;                                               // blond bowl cut
      ctx.fillRect(rx + 2, ry - 2, 8, 4); ctx.fillRect(rx + 2, ry, 2, 4); ctx.fillRect(rx + 8, ry, 2, 4);
      ctx.strokeStyle = PAL.gray; ctx.lineWidth = 2;                          // raised sword
      ctx.beginPath(); ctx.moveTo(rx + 12, ry + 2); ctx.lineTo(rx + 17, ry - 9); ctx.stroke();

    } else {
      // ---- He-Man on foot ----
      const h = this.hero;
      const x = h.x - cam.x, y = h.y - cam.y;
      const hurt = h.hurtT > 0;
      const dir = h.dir < 0 ? -1 : 1;
      // Legs: tan thighs, fur loincloth, boots.
      ctx.fillStyle = hurt ? PAL.white : PAL.skin;
      ctx.fillRect(x + 3, y + 17, 4, 6); ctx.fillRect(x + h.w - 7, y + 17, 4, 6);
      ctx.fillStyle = PAL.brown; ctx.fillRect(x + 2, y + 15, h.w - 4, 4);
      ctx.fillStyle = PAL.furDk;
      ctx.fillRect(x + 3, y + 23, 4, h.h - 23); ctx.fillRect(x + h.w - 7, y + 23, 4, h.h - 23);
      // Bare muscular torso + harness X.
      ctx.fillStyle = hurt ? PAL.white : PAL.skin;
      ctx.fillRect(x + 1, y + 6, h.w - 2, 11);
      ctx.strokeStyle = PAL.brown; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 7); ctx.lineTo(x + h.w - 2, y + 15);
      ctx.moveTo(x + h.w - 2, y + 7); ctx.lineTo(x + 2, y + 15); ctx.stroke();
      // Head + blond bowl cut.
      ctx.fillStyle = PAL.skin; ctx.fillRect(x + 4, y, h.w - 8, 7);
      ctx.fillStyle = PAL.hair;
      ctx.fillRect(x + 3, y - 2, h.w - 6, 4); ctx.fillRect(x + 3, y, 2, 4); ctx.fillRect(x + h.w - 5, y, 2, 4);
      ctx.fillStyle = PAL.black; ctx.fillRect(x + (dir < 0 ? 5 : h.w - 7), y + 3, 2, 1); // eye

      // Power Sword — glows with lightning while charging (weak-spot tell).
      const swX = x + (dir < 0 ? -5 : h.w);
      if (h.charging) {
        const glow = 0.5 + 0.5 * Math.sin(this.engine.frame * 0.6);
        ctx.strokeStyle = `rgba(75,214,214,${0.6 + glow * 0.4})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(swX, y - 14); ctx.lineTo(swX, y + 6); ctx.stroke();
        ctx.fillStyle = `rgba(255,210,63,${0.4 + glow * 0.6})`;   // weak-spot marker
        ctx.fillRect(x + 3, y + 8, h.w - 6, 6);
        ctx.strokeStyle = PAL.cyan; ctx.lineWidth = 1;            // lightning arcs
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(swX, y - 14 + i * 6);
          ctx.lineTo(swX + rand(-6, 6), y - 14 + i * 6 + rand(-3, 3));
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = PAL.gray; ctx.lineWidth = 2;            // hilt + blade
        ctx.beginPath(); ctx.moveTo(swX, y - 10); ctx.lineTo(swX, y + 6); ctx.stroke();
        ctx.strokeStyle = PAL.havoc; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(swX - 3, y + 2); ctx.lineTo(swX + 3, y + 2); ctx.stroke(); // crossguard
      }
    }
  }
}
