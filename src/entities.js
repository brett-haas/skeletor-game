/* ============================================================================
 *  SKELETOR'S CONQUEST — ENTITIES
 *  Player, Projectile, Enemy, PowerUp, Particle.
 * ========================================================================== */

'use strict';

/* ============================================================================
 * [6] ENTITIES
 * ========================================================================== */

// ---- 6a. Player (Skeletor himself) --------------------------------------
class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.w = 14; this.h = 22;
    this.vx = 0; this.vy = 0;
    this.onGround = false;
    this.facing = 1;
    this.mode = MODE.SIDE;

    this.jumpBufferT = 0;   // frames a buffered jump press survives
    this.coyoteT = 0;       // frames of grace after leaving the ground
    this.dropT = 0;         // frames a thin platform stays intangible (drop-through)
    this.onOneWay = false;  // is the ground beneath us a one-way (thin) platform?

    this.weapon = WEAPON.DEFAULT;
    this.cooldown = 0;

    this.invuln = 0;        // frames of i-frames (post-respawn / barrier)
    this.barrierTime = 0;   // frames remaining of BARRIER power
    this.dead = false;

    this.lane = 0;          // DEPTH mode lane position [-1,1]
    this.animT = 0;
  }

  setWeapon(w) {
    this.weapon = w;
    if (w === WEAPON.BARRIER) {
      this.barrierTime = 60 * 20;   // 20 seconds at 60fps
      this.invuln = Math.max(this.invuln, this.barrierTime);
    }
  }

  get invulnerable() { return this.invuln > 0; }

  hitbox() {
    // Slightly forgiving hitbox — a villain must survive to scheme again.
    return { x: this.x + 2, y: this.y + 2, w: this.w - 4, h: this.h - 3 };
  }
}

// ---- 6b. Projectile (player & enemy) ------------------------------------
class Projectile {
  constructor(x, y, vx, vy, opts) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.r = opts.r || 3;
    this.color = opts.color || PAL.bone;
    this.life = opts.life || 90;
    this.kind = opts.kind || 'skull';
    this.pierce = !!opts.pierce;
    this.dmg = opts.dmg || 1;
    this.grow = opts.grow || 0;
    this.homing = opts.homing || 0;
    this.dead = false;
    this.hitSet = new Set();  // for piercing: don't double-hit an enemy
    this.rot = 0;
  }

  get w() { return this.r * 2; }
  get h() { return this.r * 2; }
  hitbox() { return { x: this.x - this.r, y: this.y - this.r, w: this.r * 2, h: this.r * 2 }; }

  update(engine) {
    if (this.homing && engine.player && !engine.player.dead) {
      const p = engine.player;
      const tx = p.x + p.w / 2, ty = p.y + p.h / 2;
      const a = Math.atan2(ty - this.y, tx - this.x);
      const spd = Math.hypot(this.vx, this.vy) || 2;
      this.vx = lerp(this.vx, Math.cos(a) * spd, this.homing);
      this.vy = lerp(this.vy, Math.sin(a) * spd, this.homing);
    }
    this.x += this.vx;
    this.y += this.vy;
    this.r += this.grow;
    this.rot += 0.3;
    if (--this.life <= 0) this.dead = true;
  }
}

// ---- 6c. Enemy ----------------------------------------------------------
// A flexible enemy driven by a `behavior` string. Used by all levels.
class Enemy {
  constructor(x, y, opts = {}) {
    this.x = x; this.y = y;
    this.w = opts.w || 16;
    this.h = opts.h || 16;
    this.hp = opts.hp || 1;
    this.maxHp = this.hp;
    this.behavior = opts.behavior || 'walker';
    this.color = opts.color || PAL.blood;
    this.vx = opts.vx || 0;
    this.vy = opts.vy || 0;
    this.fireT = opts.fireT || randInt(40, 90);
    this.dead = false;
    this.t = 0;
    this.drop = opts.drop || null;   // weapon to drop on death
    this.z = opts.z !== undefined ? opts.z : 0;  // DEPTH mode depth
    this.lane = opts.lane || 0;
    this.speedZ = opts.speedZ || 0;
    this.homeX = x;
    this.data = opts.data || {};
    this.hurtT = 0;
    this.grounded = false;
  }

  hitbox() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }

  damage(n) {
    this.hp -= n;
    this.hurtT = 6;
    if (this.hp <= 0) this.dead = true;
  }
}

// ---- 6d. PowerUp --------------------------------------------------------
class PowerUp {
  constructor(x, y, type) {
    this.x = x; this.y = y;
    this.w = 14; this.h = 14;
    this.type = type;   // WEAPON.*
    this.vy = -2;
    this.t = 0;
    this.dead = false;
    this.grounded = false;
  }
  hitbox() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
}

// ---- 6e. Particle (pure visual flourish) --------------------------------
class Particle {
  constructor(x, y, vx, vy, color, life, r = 2) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.color = color; this.life = life; this.max = life; this.r = r;
    this.dead = false;
    this.grav = 0;
  }
  update() {
    this.x += this.vx; this.y += this.vy; this.vy += this.grav;
    if (--this.life <= 0) this.dead = true;
  }
}
