/* ============================================================================
 *  SKELETOR'S CONQUEST — GAME ENGINE
 *  Centralized state machine, rAF loop, systems, HUD, menus.
 * ========================================================================== */

'use strict';

/* ============================================================================
 * [9] GAME ENGINE — centralized state machine + rAF loop
 * ========================================================================== */

class GameEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;

    // On touch, the DOM pause button owns the top-right corner — the HUD must
    // yield that ground and centre its weapon/barrier readouts instead. Set by
    // the bootstrap's `body.touch` class before this engine is constructed.
    this.isTouch = !!(typeof document !== 'undefined' && document.body
      && document.body.classList && document.body.classList.contains('touch'));

    this.input = new Input();
    this.state = STATE.MENU;

    this.frame = 0;
    this.lastTime = 0;
    this.accum = 0;
    this.STEP = 1000 / 60;    // fixed 60Hz logic step

    // Persistent run stats.
    this.lives = 3;
    this.score = 0;
    this.levelIndex = 0;
    this.powerupsDisabled = false;   // hidden 'P' toggle — pure-combat run

    // Per-level actor pools.
    this._resetPools();

    this.camera = new Camera(VW, VH);
    this.level = null;
    this.boss = null;
    this.player = null;

    this.bannerText = '';
    this.bannerT = 0;
    this.transitionT = 0;
    this.shakeT = 0; this.shakeMag = 0;
    this.flashT = 0;

    this._applyViewport();
    window.addEventListener('resize', () => this._applyViewport());

    document.getElementById('boot').style.display = 'none';
  }

  _resetPools() {
    this.enemies = [];
    this.shots = [];       // player projectiles
    this.enemyShots = [];  // enemy/boss projectiles
    this.powerups = [];
    this.particles = [];
  }

  // The area (in CSS px) the canvas may occupy: the full viewport on touch,
  // or the viewport minus a strip for the desktop hint bar. Guarded — the test
  // harness has no <body>, and must keep the fixed default VW.
  _viewportArea() {
    const body = (typeof document !== 'undefined') ? document.body : null;
    const touch = !!(body && body.classList && body.classList.contains('touch'));
    return {
      body,
      touch,
      w: Math.max(1, window.innerWidth - (touch ? 0 : 8)),
      h: Math.max(1, window.innerHeight - (touch ? 0 : 44)),
    };
  }

  // ADAPTIVE VIEWPORT — reshape VW to the screen so the canvas fills it exactly.
  //   The whole trick: make the virtual canvas's aspect ratio EQUAL the
  //   available area's aspect (VH fixed, VW = VH * aspect). Then _fitCanvas
  //   scales it up with zero letterbox and zero distortion. In portrait you see
  //   a narrow tall slice; in landscape a gloriously wide one. Skipped under the
  //   harness (no body), which keeps the 16:9 default so tests stay stable.
  _applyViewport() {
    const area = this._viewportArea();
    if (area.body) {
      // Clamp the aspect so a freakishly thin window can't birth a degenerate
      // world (min ~2.4:1 tall, max ~3.2:1 wide).
      const aspect = clamp(area.w / area.h, 0.42, 3.2);
      VW = Math.max(2, 2 * Math.round((VH * aspect) / 2));  // keep it even
    }
    // Resize the backing store, then restore context state (a width/height
    // write resets the 2D context, re-enabling smoothing we don't want).
    if (this.canvas.width !== VW) this.canvas.width = VW;
    if (this.canvas.height !== VH) this.canvas.height = VH;
    this.ctx.imageSmoothingEnabled = false;
    this._fitCanvas(area);
  }

  // Scale the virtual canvas up to FILL the (aspect-matched) available area.
  //   Fractional scaling — no cowardly floored-integer scale leaving voids.
  _fitCanvas(area) {
    const { w, h } = area || this._viewportArea();
    const scale = Math.max(1, Math.min(w / VW, h / VH));
    this.canvas.style.width = VW * scale + 'px';
    this.canvas.style.height = VH * scale + 'px';
  }

  /* ---- LEVEL LIFECYCLE ---- */
  levelFactories = [
    (e) => new Level1(e),
    (e) => new Level2(e),
    (e) => new Level3(e),
  ];

  startGame() {
    this.lives = 3;
    this.score = 0;
    this.levelIndex = 0;
    this.loadLevel(0);
    this.state = STATE.PLAYING;
    SFX.menuSelect();
  }

  loadLevel(idx) {
    this._resetPools();
    this.boss = null;
    this.level = this.levelFactories[idx](this);
    this.player = new Player(this.level.startX, this.level.startY);
    this.player.mode = this.level.mode;
    this.camera = new Camera(this.level.worldW, this.level.worldH);
    this.level.build();
    this.banner(`${this.level.name}: ${this.level.subtitle}`, 150);
  }

  advanceLevel() {
    if (this.levelIndex >= this.levelFactories.length - 1) {
      this.state = STATE.VICTORY;
      SFX.stopMusic();
      SFX.victoryJingle();
    } else {
      this.levelIndex++;
      this.state = STATE.LEVEL_TRANSITION;
      this.transitionT = 120;
    }
  }

  /* ---- SPAWN HELPERS (called by weapons/levels/bosses) ---- */
  spawnPlayerShot(x, y, vx, vy, opts) {
    this.shots.push(new Projectile(x, y, vx, vy, opts));
  }
  spawnDepthBolt(lane, z, speedZ, color) {
    // A depth-space enemy bolt, tracked toward the near plane.
    const b = { lane, z, speedZ: speedZ + 0.006, color, depthBolt: true, dead: false };
    this.enemyShots.push(b);
  }
  spawnBurst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(0.5, 3);
      this.particles.push(new Particle(x, y, Math.cos(a) * s, Math.sin(a) * s, color, randInt(14, 26), rand(1, 3)));
    }
  }
  banner(text, frames) { this.bannerText = text; this.bannerT = frames; }
  shake(mag) { this.shakeT = 12; this.shakeMag = mag; }

  /* ---- PLAYER DEATH / RESPAWN ---- */
  killPlayer() {
    const p = this.player;
    if (p.dead || p.invulnerable) return;
    p.dead = true;
    this.spawnBurst(p.x + p.w / 2, p.y + p.h / 2, PAL.bone, 20);
    this.spawnBurst(p.x + p.w / 2, p.y + p.h / 2, PAL.hood, 12);
    this.shake(10);
    this.flashT = 8;
    this.lives--;
    this.banner('SKELETOR FALLS!', 60);
    SFX.playerDeath();

    setTimeout(() => {}, 0); // (no async needed; respawn handled in update)
    this._respawnTimer = 45;
  }

  respawn() {
    const p = this.player;
    // Let the level reset any respawn-sensitive hazards (e.g. L3's collapsing
    // climb ledges) BEFORE we snap the player onto the floor beneath them.
    this.level.onRespawn();
    // Restart any in-progress boss fight so its HP starts fresh — the damaged
    // instance is dropped and re-spawned at full health when the player returns.
    this.level.resetBossFight();
    this.boss = null;
    // Sweep the field clear of in-flight projectiles. A boss/subboss barrage
    // airborne at the moment of death would otherwise linger and cut the
    // freshly respawned player down before the mercy i-frames could help.
    this.enemyShots.length = 0;
    this.shots.length = 0;
    p.dead = false;
    p.weapon = WEAPON.DEFAULT;   // one-hit death = weapon loss
    p.barrierTime = 0;
    p.invuln = 90;               // brief mercy i-frames
    p.vx = 0; p.vy = 0;
    // Clear jump forgiveness: the timers only tick during live movement, so a
    // jump buffered mid-air before death would freeze and fire involuntarily
    // the instant we snap the player back onto solid ground.
    p.jumpBufferT = 0; p.coyoteT = 0;
    if (this.level.mode === MODE.SIDE) {
      // The level owns its geometry, so IT resolves the respawn position. This
      // lets tall/multi-phase levels (L3's 1400px shaft + hallway) place the
      // player correctly instead of a one-size-fits-all X-only checkpoint scan.
      const { x, y, onGround } = this.level.respawnPos(p);
      p.x = x; p.y = y; p.onGround = !!onGround;
    } else {
      p.lane = 0;
    }
  }

  /* ============================ MAIN LOOP ============================ */
  start() {
    const loop = (t) => {
      if (!this.lastTime) this.lastTime = t;
      let delta = t - this.lastTime;
      this.lastTime = t;
      if (delta > 100) delta = 100; // avoid spiral-of-death on tab-out
      this.accum += delta;
      while (this.accum >= this.STEP) {
        this.update();
        this.accum -= this.STEP;
      }
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* ============================ UPDATE ============================ */
  update() {
    this.frame++;
    const inp = this.input;

    // Global: pause toggle.
    if (inp.tapped('Space')) {
      if (this.state === STATE.PLAYING) this.state = STATE.PAUSED;
      else if (this.state === STATE.PAUSED) this.state = STATE.PLAYING;
    }

    // Global: mute toggle (M) — for the minion who craves SILENCE.
    if (inp.tapped('KeyM')) SFX.toggleMute();

    // Hidden: powerup toggle (P) — a pure-combat run for the true master.
    // Works anytime; toggling OFF clears any pickups already on the field but
    // never strips a weapon/shield the player already holds.
    if (inp.tapped('KeyP')) {
      this.powerupsDisabled = !this.powerupsDisabled;
      if (this.powerupsDisabled) this.powerups.length = 0;
      SFX.menuSelect();
      this.banner(this.powerupsDisabled ? 'POWERUPS DISABLED' : 'POWERUPS RESTORED', 70);
    }

    switch (this.state) {
      case STATE.MENU:
        if (inp.tapped('Enter') || inp.tapped('KeyK')) this.startGame();
        break;

      case STATE.PLAYING:
        this._updatePlaying();
        break;

      case STATE.PAUSED:
        break;

      case STATE.LEVEL_TRANSITION:
        if (--this.transitionT <= 0) {
          this.loadLevel(this.levelIndex);
          this.state = STATE.PLAYING;
        }
        break;

      case STATE.GAME_OVER:
      case STATE.VICTORY:
        if (inp.tapped('Enter')) { this.state = STATE.MENU; }
        break;
    }

    if (this.bannerT > 0) this.bannerT--;
    if (this.shakeT > 0) this.shakeT--;
    if (this.flashT > 0) this.flashT--;

    this._syncMusic();
    inp.endFrame();
  }

  /* ---- Background-music orchestration ----
   * Maps the state machine to a looping track each frame. playMusic() dedups
   * by name, so calling it every frame is a no-op once the loop is running;
   * the level<->boss switch rides `this.boss` automatically. Victory / game-
   * over stings and the boss-defeat fanfare fire once at their transitions
   * (see advanceLevel / _updatePlaying / boss-defeat). Inert under the harness. */
  _syncMusic() {
    switch (this.state) {
      case STATE.MENU:
        SFX.playMusic('menu');
        break;
      case STATE.PLAYING:
        SFX.duckMusic(false);
        SFX.playMusic(this.boss ? 'boss' : 'level');
        break;
      case STATE.PAUSED:
        SFX.duckMusic(true);
        break;
      case STATE.LEVEL_TRANSITION:
      case STATE.VICTORY:
      case STATE.GAME_OVER:
        SFX.stopMusic();
        break;
    }
  }

  _updatePlaying() {
    const p = this.player;
    const lvl = this.level;
    const inp = this.input;

    // Handle respawn timer / game over.
    if (p.dead) {
      if (this._respawnTimer > 0 && --this._respawnTimer === 0) {
        if (this.lives <= 0) { this.state = STATE.GAME_OVER; SFX.gameOverJingle(); return; }
        this.respawn();
      }
      // Still update particles while dead.
      this._updateParticles();
      return;
    }

    // Tick invuln / barrier. BARRIER never touches p.weapon, so there is
    // nothing to revert when it lapses — the bubble simply pops.
    if (p.invuln > 0) p.invuln--;
    if (p.barrierTime > 0) p.barrierTime--;

    // ---- Movement per perspective mode ----
    if (lvl.mode === MODE.SIDE) this._sideMovement(p);
    else this._depthMovement(p);

    // ---- Firing (8-dir aim, hold-to-autofire) ----
    if (p.cooldown > 0) p.cooldown--;
    if (inp.fire && p.cooldown <= 0) this._fire(p);

    // ---- Level logic + spawners ----
    lvl.update(this.STEP);

    // ---- Entities ----
    this._updateEnemies();
    this._updateShots();
    this._updateEnemyShots();
    this._updatePowerups();
    this._updateParticles();
    if (this.boss) this._updateBoss();

    // ---- Camera ----
    if (lvl.mode === MODE.SIDE) {
      this.camera.follow(p, { followY: lvl.worldH > VH });
    }

    // ---- Level completion (boss defeated) ----
    if (this.boss && this.boss.dead) {
      this.score += 5000;
      this.boss = null;
      this.banner('CONQUEST! LEVEL CLEARED!', 120);
      this._levelClearTimer = 90;
      SFX.bossDefeat();
    }
    if (this._levelClearTimer > 0 && --this._levelClearTimer === 0) {
      this.advanceLevel();
    }
  }

  /* ---- SIDE-scroll movement + AABB platform collision ---- */
  _sideMovement(p) {
    const inp = this.input;

    const dir = inp.right ? 1 : inp.left ? -1 : 0;
    if (dir) {
      p.facing = dir;
      // Reversal (pressed dir opposes current vx) gets a TURN_BOOST kick — a
      // snappy NES skid. From rest (vx=0, sign 0) it's a normal accel, so
      // takeoff is unchanged and the hold-one-direction regression bots never
      // trip the boost.
      const boost = Math.sign(p.vx) === -dir ? TURN_BOOST : 1;
      p.vx += dir * MOVE_ACCEL * boost;
    } else {
      if (p.onGround) p.vx *= GROUND_FRICTION;   // 0.75 — quick stop on foot
      else            p.vx *= AIR_DRAG;          // 0.96 — carry momentum in air
      if (Math.abs(p.vx) < IDLE_CREEP_EPSILON) p.vx = 0;  // #8: kill sub-pixel idle creep
    }
    p.vx = clamp(p.vx, -MOVE_MAX_SPEED, MOVE_MAX_SPEED);

    // Drop-through: hold DOWN + tap jump while standing on a thin (one-way)
    // platform. Down alone is 8-way aim-down, so it must NOT drop you — that
    // was the old bug (aiming down through your own footing). A latched timer
    // keeps the platform intangible long enough to clear the land tolerance;
    // the down+jump tap is consumed here so it can't ALSO trigger a jump.
    const dropInput = inp.down && inp.jumpTapped() && p.onGround && p.onOneWay;
    if (dropInput) p.dropT = 8;
    if (p.dropT > 0) p.dropT--;
    const dropping = p.dropT > 0;

    // Jump (K). Edge-triggered, but BUFFERED both ways so touch taps aren't
    // eaten by endFrame(): a press is remembered for JUMP_BUFFER frames (fires
    // the instant you land) and COYOTE_TIME frames of grace let you jump just
    // after stepping off a ledge.
    if (inp.jumpTapped() && !dropInput) p.jumpBufferT = JUMP_BUFFER;
    if (p.onGround) p.coyoteT = COYOTE_TIME;
    if (p.jumpBufferT > 0 && p.coyoteT > 0) {
      p.vy = JUMP_VELOCITY;
      p.onGround = false;
      p.jumpBufferT = 0;
      p.coyoteT = 0;
      p.jumpCut = false;   // fresh jump: full rise until the button is released
      SFX.jump();
    }
    if (p.jumpBufferT > 0) p.jumpBufferT--;
    if (p.coyoteT > 0) p.coyoteT--;

    // Variable jump height (#1): cut the rise the instant jump is RELEASED while
    // ascending — a held->released edge the sim actually observes. A real quick
    // tap is held for a few frames then released, so it short-hops; an instant
    // synthetic tap (test bots) is never seen as held, so it yields a full jump
    // and the pit/climb regression guards stay honest.
    const jumpHeldNow = inp.jumpHeld();
    if (p.vy < 0 && p.jumpWasHeld && !jumpHeldNow && !p.jumpCut) {
      // Cut the rise, but never below MIN_JUMP_VELOCITY — the shortest tap still
      // hops with authority instead of a limp flea-hop.
      p.vy = Math.min(p.vy * JUMP_CUT, -MIN_JUMP_VELOCITY);
      p.jumpCut = true;
    }
    p.jumpWasHeld = jumpHeldNow;

    // Gravity (#2): asymmetric, applied to the JUMP the player is shaping. A
    // full (held) jump keeps the tuned symmetric arc — Level 3's climb spacing
    // and He-Man's dodge windows are calibrated to that airtime. The moment the
    // player releases early (jumpCut), gravity jumps to the heavier FALL_GRAVITY
    // so the truncated arc snaps back down instead of drifting — that snap is the
    // felt difference between a short hop and a full leap.
    const g = p.jumpCut ? FALL_GRAVITY : RISE_GRAVITY;
    p.vy = clamp(p.vy + g, -20, MAX_FALL);

    // Integrate X, then resolve horizontal collisions against solid platforms.
    p.x += p.vx;
    p.x = clamp(p.x, 0, this.level.worldW - p.w);
    // Boss arena wall: a boss may expose `wallX`, the world-x the player's right
    // edge may not pass while it lives (Man-At-Arms fires only toward his front,
    // so slipping behind him left a risk-free dead zone). Only bosses that define
    // wallX are affected.
    if (this.boss && typeof this.boss.wallX === 'number') {
      const wall = this.boss.wallX - p.w;
      // Kill rightward momentum when the wall actually caps advance, so a lingering
      // +vx doesn't fire the TURN_BOOST skid the instant the player turns to retreat.
      if (p.x > wall) { p.x = wall; if (p.vx > 0) p.vx = 0; }
    }
    for (const plat of this.level.platforms) {
      if (plat.gone) continue;
      if (plat.h <= 12) continue;            // thin one-way ledges never block sideways
      const box = { x: p.x, y: p.y, w: p.w, h: p.h };
      if (aabb(box, plat)) {
        if (p.vx > 0)      p.x = plat.x - p.w;       // moving right → snap to left face
        else if (p.vx < 0) p.x = plat.x + plat.w;    // moving left  → snap to right face
        p.vx = 0;
      }
    }

    // Integrate Y, resolve vertical collisions (land on tops).
    p.y += p.vy;
    p.onGround = false;
    for (const plat of this.level.platforms) {
      if (plat.gone) continue;
      // Thin platforms (h<=12) are one-way; skip when dropping.
      const oneWay = plat.h <= 12;
      const box = { x: plat.x, y: plat.y, w: plat.w, h: plat.h };
      if (aabb(p.hitbox ? p.hitbox() : p, box) || aabb({ x: p.x, y: p.y, w: p.w, h: p.h }, box)) {
        const feetPrev = p.y - p.vy + p.h;
        if (p.vy >= 0 && feetPrev <= plat.y + 6) {
          if (oneWay && dropping) continue; // fall through
          p.y = plat.y - p.h;
          p.vy = 0;
          p.onGround = true;
          p.onOneWay = oneWay;
          p.jumpCut = false;   // grounded: next fall/jump starts at the tuned rate
          // Trigger collapsing platforms.
          if (plat.collapsing && !plat.triggered) plat.triggered = true;
        } else if (!oneWay) {
          // Hit underside / sides of solid block: push out vertically.
          if (p.vy < 0 && p.y - p.vy >= plat.y + plat.h - 2) {
            p.y = plat.y + plat.h; p.vy = 0;
          }
        }
      }
    }

    // Pits / falling off the world = instant death.
    if (p.y > this.level.worldH + 20) this.killPlayer();
  }

  /* ---- DEPTH movement (behind-the-back corridor) ---- */
  _depthMovement(p) {
    const inp = this.input;
    const laneSpd = 0.03;
    if (inp.left)  { p.lane -= laneSpd; p.facing = -1; }
    if (inp.right) { p.lane += laneSpd; p.facing = 1; }
    p.lane = clamp(p.lane, -0.92, 0.92);
    // Keep a nominal screen box for shot origin & HUD.
    const pr = this.level.proj.project(p.lane, 1);
    p.x = pr.sx - p.w / 2;
    p.y = pr.sy - p.h;
  }

  /* ---- Firing ---- */
  _fire(p) {
    const inp = this.input;
    const wpn = Weapons[p.weapon] || Weapons[WEAPON.DEFAULT];

    if (this.level.mode === MODE.SIDE) {
      const aim = inp.aimVector(p.facing);
      const ox = p.x + p.w / 2 + aim.x * 8;
      const oy = p.y + 10 + aim.y * 6;
      wpn.fire(this, ox, oy, aim);
    } else {
      // DEPTH: shots fly "into" the screen (up + slight lane-based x).
      const pr = this.level.proj.project(p.lane, 1);
      const aim = { x: (inp.left ? -0.4 : inp.right ? 0.4 : 0), y: -1 };
      const m = Math.hypot(aim.x, aim.y) || 1;
      aim.x /= m; aim.y /= m;
      wpn.fire(this, pr.sx, pr.sy - p.h, aim);
    }
    p.cooldown = wpn.cooldown;
    SFX.fire(p.weapon);
  }

  /* ---- Enemy updates + behaviors ---- */
  _updateEnemies() {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.t++;
      if (e.hurtT > 0) e.hurtT--;

      switch (e.behavior) {
        case 'turret':
          if (--e.fireT <= 0) {
            e.fireT = randInt(60, 110);
            const a = Math.atan2((p.y + p.h / 2) - (e.y + e.h / 2), (p.x) - e.x);
            this.enemyShots.push(new Projectile(e.x + e.w / 2, e.y + 4,
              Math.cos(a) * 2.4, Math.sin(a) * 2.4,
              { kind: 'ebolt', r: 3, color: PAL.blood, life: 160 }));
          }
          break;

        case 'homing-turret':
          if (--e.fireT <= 0) {
            e.fireT = randInt(80, 130);
            // Launch AT the player with a real speed (~2). The homing lerp keeps
            // the current magnitude, so the initial launch speed IS the flight
            // speed — a 0.5 dribble homed on nothing and hit nothing.
            const a = Math.atan2((p.y + p.h / 2) - (e.y + e.h / 2), p.x - e.x);
            this.enemyShots.push(new Projectile(e.x + e.w / 2, e.y + e.h / 2,
              Math.cos(a) * 2, Math.sin(a) * 2,
              { kind: 'ebolt', r: 3, color: PAL.purple, life: 200, homing: 0.025 }));
          }
          break;

        case 'walker':
        case 'elite': {
          // Patrol / advance toward player; gravity-bound.
          e.vy = clamp((e.vy || 0) + GRAVITY, -10, MAX_FALL);
          e.x += e.vx;
          e.y += e.vy;
          // Simple ground snap.
          for (const plat of this.level.platforms) {
            if (plat.gone) continue;
            const box = { x: plat.x, y: plat.y, w: plat.w, h: plat.h };
            if (aabb(e.hitbox(), box) && e.vy >= 0 && (e.y + e.h - e.vy) <= plat.y + 6) {
              e.y = plat.y - e.h; e.vy = 0; e.grounded = true;
            }
          }
          // Turn at world edges / periodically.
          if (e.t % 140 === 0) e.vx *= -1;
          if (e.behavior === 'elite' && (--e.fireT <= 0)) {
            e.fireT = randInt(70, 110);
            const dir = sign(p.x - e.x) || -1;
            this.enemyShots.push(new Projectile(e.x + e.w / 2, e.y + 6, dir * 2.6, 0,
              { kind: 'ebolt', r: 3, color: PAL.cyan, life: 150 }));
          }
          break;
        }

        case 'battleram': {
          // Teela charges back and forth; lethal on contact.
          e.x += e.data.dir * e.data.chargeSpd;
          if (e.x < e.homeX - 260) e.data.dir = 1;
          if (e.x > e.homeX + 30) e.data.dir = -1;
          if (!p.invulnerable && aabb(p.hitbox(), e.hitbox())) this.killPlayer();
          if (e.t % 50 === 0) {
            // Aim at the player instead of a fixed horizontal line — a standing
            // target must no longer be spared by a bolt that sails overhead.
            const a = Math.atan2((p.y + p.h / 2) - (e.y + 10), p.x - e.x);
            this.enemyShots.push(new Projectile(e.x, e.y + 10, Math.cos(a) * 3, Math.sin(a) * 3,
              { kind: 'ebolt', r: 3, color: PAL.blood, life: 120 }));
          }
          break;
        }
      }

      // Contact damage for grounded foes (SIDE mode).
      if (this.level.mode === MODE.SIDE && e.behavior !== 'battleram') {
        if (!p.invulnerable && aabb(p.hitbox(), e.hitbox())) this.killPlayer();
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  /* ---- Player projectile updates + collisions ---- */
  _updateShots() {
    for (const s of this.shots) {
      s.update(this);
      // Off-screen cull. BOTH axes must be camera-relative for SIDE — same as
      // the enemy-shot cull below. In Level 3's vertical climb the camera scrolls
      // in Y, so testing raw world-y against the screen box (VH+40) killed every
      // player shot the instant it spawned (world-y sits ~1300, far past 280),
      // leaving the weapon dead for the whole climb. Match the render transform
      // (world - cam) on both axes so shots live wherever the camera is looking.
      if (this.level.mode === MODE.SIDE) {
        const relX = s.x - this.camera.x;
        const relY = s.y - this.camera.y;
        if (relX < -40 || relX > VW + 40 || relY < -40 || relY > VH + 40) s.dead = true;
      } else {
        if (s.x < -20 || s.x > VW + 20 || s.y < -20 || s.y > VH + 20) s.dead = true;
      }

      // vs enemies.
      for (const e of this.enemies) {
        if (e.dead) continue;
        let box;
        if (this.level.mode === MODE.DEPTH && e.behavior === 'depth-crawler') {
          const pr = this.level.proj.project(e.lane, e.z);
          const half = 10 * pr.scale + 3;
          box = { x: pr.sx - half, y: pr.sy - half * 1.4, w: half * 2, h: half * 2 };
        } else {
          box = e.hitbox();
        }
        if (!s.hitSet.has(e) && aabb(s.hitbox(), box)) {
          e.damage(s.dmg);
          this.spawnBurst(s.x, s.y, e.color, 4);
          if (e.dead) this._onEnemyKilled(e);
          else SFX.hit();
          if (s.pierce) s.hitSet.add(e);
          else { s.dead = true; break; }
        }
      }

      // vs boss.
      if (!s.dead && this.boss && this.boss.hitTest) {
        const absorbed = this.boss.hitTest(s);
        if (absorbed) SFX.bossHit();
        if (absorbed && !s.pierce) s.dead = true;
      }
    }
    this.shots = this.shots.filter((s) => !s.dead);
  }

  _onEnemyKilled(e) {
    this.score += 100;
    SFX.enemyKill();
    this.spawnBurst(e.x + e.w / 2, e.y + e.h / 2, e.color, 8);
    if (e.drop && !this.powerupsDisabled) {
      // Spawn the power-up where the foe fell.
      if (this.level.mode === MODE.DEPTH) {
        const pr = this.level.proj.project(e.lane, e.z);
        const pu = new PowerUp(pr.sx - 7, pr.sy - 7, e.drop);
        pu.depth = true; pu.lane = e.lane; pu.z = e.z;
        this.powerups.push(pu);
      } else {
        this.powerups.push(new PowerUp(e.x, e.y - 10, e.drop));
      }
    }
  }

  /* ---- Enemy projectile updates + collisions ---- */
  _updateEnemyShots() {
    const p = this.player;
    for (const s of this.enemyShots) {
      if (s.depthBolt) {
        // Depth-space enemy bolt travelling to the near plane.
        s.z += s.speedZ;
        if (s.z >= 1) {
          if (Math.abs(s.lane - p.lane) < 0.2 && !p.invulnerable) this.killPlayer();
          s.dead = true;
        }
        continue;
      }
      // Grenade fuse -> fragmentation burst.
      if (s.kind === 'grenade') {
        s.vy = (s.vy || 0) + (s.grav || 0);
        if (--s.fuse <= 0) {
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            this.enemyShots.push(new Projectile(s.x, s.y, Math.cos(a) * 3, Math.sin(a) * 3,
              { kind: 'shard', r: 2, color: PAL.ember, life: 60 }));
          }
          s.dead = true;
          continue;
        }
      }
      s.update(this);
      // Cull. Both axes must be camera-relative: in the vertical Level 3 climb
      // the camera scrolls in Y, so testing raw world-y against the screen box
      // culled every bolt the instant it spawned (its world-y sits far below the
      // viewport top). Match the render transform (world - cam) on both axes.
      if (this.level.mode === MODE.SIDE) {
        const relX = s.x - this.camera.x;
        const relY = s.y - this.camera.y;
        if (relX < -60 || relX > VW + 60 || relY > VH + 60 || relY < -60) s.dead = true;
      } else if (s.x < -30 || s.x > VW + 30 || s.y > VH + 30 || s.y < -30) s.dead = true;

      // Lethal vs player.
      if (!s.dead && !p.dead && !p.invulnerable) {
        let box;
        if (this.level.mode === MODE.DEPTH || s.screenSpace) {
          box = { x: p.x, y: p.y, w: p.w, h: p.h };
        } else box = p.hitbox();
        if (aabb(s.hitbox(), box)) { this.killPlayer(); s.dead = true; }
      }
    }
    this.enemyShots = this.enemyShots.filter((s) => !s.dead);
  }

  /* ---- Power-up updates + pickup ---- */
  _updatePowerups() {
    const p = this.player;
    for (const pu of this.powerups) {
      pu.t++;
      if (this.level.mode === MODE.SIDE) {
        // Gentle float + settle onto ground.
        if (!pu.grounded) {
          pu.vy += GRAVITY * 0.5;
          pu.y += pu.vy;
          for (const plat of this.level.platforms) {
            if (plat.gone) continue;
            if (aabb(pu.hitbox(), { x: plat.x, y: plat.y, w: plat.w, h: plat.h }) && pu.vy >= 0) {
              pu.y = plat.y - pu.h; pu.vy = 0; pu.grounded = true;
            }
          }
        }
        pu.floatY = Math.sin(pu.t * 0.15) * 2;
      }
      // Pickup.
      let box;
      if (pu.depth) box = { x: pu.x, y: pu.y, w: pu.w, h: pu.h };
      else box = { x: pu.x, y: pu.y + (pu.floatY || 0), w: pu.w, h: pu.h };
      const pbox = this.level.mode === MODE.DEPTH ? { x: p.x, y: p.y, w: p.w, h: p.h } : p.hitbox();
      if (aabb(pbox, box)) {
        p.setWeapon(pu.type);
        this.score += 250;
        SFX.powerup();
        this.spawnBurst(pu.x, pu.y, PAL.havoc, 12);
        this.banner(`GAINED: ${Weapons[pu.type].name}!`, 70);
        pu.dead = true;
      }
      // Depth pickups drift toward the player plane so they can be caught.
      if (pu.depth) { pu.z = Math.min(1, (pu.z || 0) + 0.004);
        const pr = this.level.proj.project(pu.lane, pu.z);
        pu.x = pr.sx - pu.w / 2; pu.y = pr.sy - pu.h;
        if (pu.z >= 1 && pu.t > 200) pu.dead = true;
      }
      if (pu.t > 700) pu.dead = true;
    }
    this.powerups = this.powerups.filter((pu) => !pu.dead);
  }

  _updateParticles() {
    for (const pt of this.particles) pt.update();
    this.particles = this.particles.filter((pt) => !pt.dead);
  }

  _updateBoss() {
    this.boss.update();
    // Boss-specific contact death for Man-At-Arms grenades handled in shots.
  }

  /* ============================ RENDER ============================ */
  render() {
    const ctx = this.ctx;
    ctx.save();

    // Screen shake offset.
    let shx = 0, shy = 0;
    if (this.shakeT > 0) {
      shx = rand(-this.shakeMag, this.shakeMag);
      shy = rand(-this.shakeMag, this.shakeMag);
    }
    ctx.translate(shx, shy);

    ctx.fillStyle = PAL.black;
    ctx.fillRect(-8, -8, VW + 16, VH + 16);

    switch (this.state) {
      case STATE.MENU:            this._renderMenu(ctx); break;
      case STATE.LEVEL_TRANSITION:this._renderTransition(ctx); break;
      case STATE.GAME_OVER:       this._renderGameOver(ctx); break;
      case STATE.VICTORY:         this._renderVictory(ctx); break;
      case STATE.PLAYING:
      case STATE.PAUSED:
        this._renderWorld(ctx);
        this._renderHUD(ctx);
        if (this.state === STATE.PAUSED) this._renderPause(ctx);
        break;
    }

    // White flash on death.
    if (this.flashT > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flashT / 8 * 0.6})`;
      ctx.fillRect(-8, -8, VW + 16, VH + 16);
    }

    ctx.restore();
  }

  _renderWorld(ctx) {
    const cam = this.camera;
    const lvl = this.level;

    lvl.renderWorld(ctx, cam);

    // ---- Power-ups ----
    for (const pu of this.powerups) {
      const sx = (lvl.mode === MODE.SIDE ? pu.x - cam.x : pu.x);
      const sy = (lvl.mode === MODE.SIDE ? pu.y - cam.y + (pu.floatY || 0) : pu.y);
      this._drawPowerup(ctx, sx, sy, pu.type);
    }

    // ---- Enemies ----
    for (const e of this.enemies) {
      if (lvl.mode === MODE.DEPTH && e.behavior === 'depth-crawler') {
        this._drawDepthEnemy(ctx, e);
      } else {
        this._drawEnemy(ctx, e, cam);
      }
    }

    // ---- Boss ----
    if (this.boss) this.boss.render(ctx, cam);

    // ---- Player (Skeletor) ----
    const p = this.player;
    if (!p.dead) {
      const sx = (lvl.mode === MODE.SIDE ? p.x - cam.x : p.x);
      const sy = (lvl.mode === MODE.SIDE ? p.y - cam.y : p.y);
      const aim = this.input.aimVector(p.facing);
      // Only when grounded — the feet-anchored shadow then sits on whatever
      // platform he stands on, and never floats beneath him mid-jump.
      if (lvl.mode === MODE.SIDE && p.onGround) drawShadow(ctx, sx + p.w / 2, sy + p.h, p.w);
      drawSkeletor(ctx, sx, sy, p.w, p.h, p.facing, p.weapon, aim, p.invulnerable);
      // Barrier spirits orbiting.
      if (p.barrierTime > 0) this._drawBarrier(ctx, sx + p.w / 2, sy + p.h / 2, p.barrierTime);
    }

    // ---- Player shots ----
    for (const s of this.shots) this._drawShot(ctx, s, cam);

    // ---- Enemy shots ----
    for (const s of this.enemyShots) this._drawEnemyShot(ctx, s, cam);

    // ---- Particles ----
    for (const pt of this.particles) {
      const sx = (lvl.mode === MODE.SIDE ? pt.x - cam.x : pt.x);
      const sy = (lvl.mode === MODE.SIDE ? pt.y - cam.y : pt.y);
      ctx.globalAlpha = clamp(pt.life / pt.max, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.fillRect(sx - pt.r / 2, sy - pt.r / 2, pt.r, pt.r);
    }
    ctx.globalAlpha = 1;

    // ---- Banner ----
    if (this.bannerT > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, VH / 2 - 14, VW, 22);
      this._text(ctx, this.bannerText, VW / 2, VH / 2, PAL.havoc, 'center', 10);
    }
  }

  _drawShot(ctx, s, cam) {
    const sx = (this.level.mode === MODE.SIDE ? s.x - cam.x : s.x);
    const sy = (this.level.mode === MODE.SIDE ? s.y - cam.y : s.y);
    if (s.kind === 'ring') {
      ctx.strokeStyle = s.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(sx, sy, s.r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sx, sy, s.r - 3, 0, Math.PI * 2); ctx.stroke();
    } else if (s.kind === 'skull') {
      ctx.fillStyle = s.color;
      ctx.fillRect(sx - s.r, sy - s.r, s.r * 2, s.r * 2);
      ctx.fillStyle = PAL.black;
      ctx.fillRect(sx - 1, sy - 1, 1, 1); ctx.fillRect(sx + 1, sy - 1, 1, 1);
    } else if (s.kind === 'flame') {
      // Fades as it dies; a white-hot core gives each ember real heat.
      const a = clamp(s.life / 16, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(sx, sy, s.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = a * 0.95;
      ctx.fillStyle = PAL.havoc;
      ctx.beginPath(); ctx.arc(sx, sy, s.r * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(sx, sy, s.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  _drawEnemyShot(ctx, s, cam) {
    if (s.depthBolt) {
      const pr = this.level.proj.project(s.lane, s.z);
      const r = 2 + pr.scale * 3;
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(pr.sx, pr.sy, r, 0, Math.PI * 2); ctx.fill();
      return;
    }
    const sx = ((this.level.mode === MODE.SIDE && !s.screenSpace) ? s.x - cam.x : s.x);
    const sy = ((this.level.mode === MODE.SIDE && !s.screenSpace) ? s.y - cam.y : s.y);
    ctx.fillStyle = s.color;
    if (s.kind === 'grenade') { ctx.fillRect(sx - s.r, sy - s.r, s.r * 2, s.r * 2); }
    else { ctx.beginPath(); ctx.arc(sx, sy, s.r, 0, Math.PI * 2); ctx.fill(); }
  }

  _drawEnemy(ctx, e, cam) {
    const x = e.x - cam.x, y = e.y - cam.y;
    const hurt = e.hurtT > 0;

    if (e.behavior === 'turret') {
      // ---- Palace Guard turret: squat, floor-bolted bunker with a fixed forward cannon ----
      const hull = hurt ? PAL.white : PAL.steel;
      const dir = (this.player && this.player.x < e.x) ? -1 : 1;
      // Heavy base plate bolted to the ground (wider than the housing).
      ctx.fillStyle = PAL.stoneD; ctx.fillRect(x - 1, y + e.h - 5, e.w + 2, 5);
      ctx.fillStyle = PAL.black;  ctx.fillRect(x - 1, y + e.h - 1, e.w + 2, 1);
      ctx.fillStyle = PAL.gray; // floor bolts
      for (let bx = x + 1; bx < x + e.w; bx += 5) ctx.fillRect(bx, y + e.h - 3, 1, 1);
      // Boxy armored housing with bevelled edges.
      ctx.fillStyle = hull;    ctx.fillRect(x + 2, y + 4, e.w - 4, e.h - 8);
      ctx.fillStyle = PAL.gray; ctx.fillRect(x + 2, y + 4, e.w - 4, 1); ctx.fillRect(x + 2, y + 4, 1, e.h - 8);
      ctx.fillStyle = PAL.stone; ctx.fillRect(x + e.w - 3, y + 4, 1, e.h - 8);
      // Angry red energy core slit.
      ctx.fillStyle = PAL.bloodDk; ctx.fillRect(x + 4, y + 8, e.w - 8, 4);
      ctx.fillStyle = PAL.blood;   ctx.fillRect(x + 5, y + 9, e.w - 10, 2);
      ctx.fillStyle = PAL.white;   ctx.fillRect(x + e.w / 2 - 1, y + 9, 2, 2);
      // Corner rivets.
      ctx.fillStyle = PAL.gray;
      ctx.fillRect(x + 3, y + 5, 1, 1); ctx.fillRect(x + e.w - 4, y + 5, 1, 1);
      // Single thick FIXED cannon aimed at the player.
      const bx = dir < 0 ? x - 6 : x + e.w - 2;
      ctx.fillStyle = PAL.stoneD; ctx.fillRect(bx, y + 6, 8, 5);
      ctx.fillStyle = PAL.gray;   ctx.fillRect(bx, y + 6, 8, 1);
      ctx.fillStyle = PAL.black;  ctx.fillRect(dir < 0 ? x - 7 : x + e.w + 5, y + 5, 2, 7);

    } else if (e.behavior === 'homing-turret') {
      // ---- Homing energy turret: a FLOATING octagonal eye-drone with orbiting nodes ----
      const core = hurt ? PAL.white : PAL.purple;
      const hull = hurt ? PAL.white : PAL.steel;
      const cx = x + e.w / 2, cy = y + e.h / 2;
      // Orbiting ring nodes on either side (imply spin).
      ctx.fillStyle = PAL.purpleDk;
      ctx.fillRect(x - 3, cy - 2, 4, 4); ctx.fillRect(x + e.w - 1, cy - 2, 4, 4);
      ctx.fillStyle = PAL.cyan;
      ctx.fillRect(x - 3, cy - 2, 4, 1); ctx.fillRect(x + e.w - 1, cy + 1, 4, 1);
      // Octagonal hull (two overlapping bars chamfer the corners — no legs, no base).
      ctx.fillStyle = hull;
      ctx.fillRect(x + 3, y + 1, e.w - 6, e.h - 2); ctx.fillRect(x + 1, y + 3, e.w - 2, e.h - 6);
      ctx.fillStyle = PAL.gray;  ctx.fillRect(x + 3, y + 1, e.w - 6, 1);
      ctx.fillStyle = PAL.stone; ctx.fillRect(x + 3, y + e.h - 2, e.w - 6, 1);
      // Sensor fins top & bottom.
      ctx.fillStyle = PAL.stoneD; ctx.fillRect(cx - 1, y - 2, 2, 3); ctx.fillRect(cx - 1, y + e.h - 1, 2, 3);
      // Big central purple eye with a cyan slit pupil.
      ctx.fillStyle = PAL.purpleDk; ctx.fillRect(x + 4, y + 4, e.w - 8, e.h - 8);
      ctx.fillStyle = core;         ctx.fillRect(x + 5, y + 5, e.w - 10, e.h - 10);
      ctx.fillStyle = PAL.cyan;     ctx.fillRect(cx - 1, y + 5, 2, e.h - 10);
      ctx.fillStyle = PAL.white;    ctx.fillRect(cx - 1, cy - 1, 2, 2);
      // Hover thruster glow beneath — proof it floats.
      ctx.fillStyle = PAL.purpleDk; ctx.fillRect(cx - 3, y + e.h + 2, 6, 2);
      ctx.fillStyle = PAL.cyan;     ctx.fillRect(cx - 1, y + e.h + 4, 2, 1);

    } else if (e.behavior === 'battleram') {
      // ---- Teela on the Battle Ram: the Filmation vehicle — a low, BLUE sky-sled with
      // a swept pointed nose dropping toward the ground, a gray griffin-head prow, and a
      // tall faceted rear launcher housing that towers over the cockpit, riding on two fat
      // black wheels. Teela sits hunched into the charge, one hand on the cowl, the other
      // raising a silver sword high. Authored facing LEFT (the canonical charge, dir -1);
      // when charging RIGHT the whole rig is mirrored about the entity's centre so the
      // prow always leads.
      const dir = (e.data && e.data.dir > 0) ? 1 : -1;
      const cx = x + e.w / 2;
      const body   = hurt ? PAL.white : PAL.hood;      // blue hull
      const bodyHi = hurt ? PAL.white : PAL.hoodHi;    // lit blue facets
      const bodyDk = hurt ? PAL.white : PAL.hoodDk;    // shadow blue facets
      const rim    = hurt ? PAL.white : PAL.cyan;      // bright leading-edge glint
      const metal  = hurt ? PAL.white : PAL.steel;     // griffin head / sword blade
      const metalHi = hurt ? PAL.white : PAL.gray;     // metal highlight
      const metalDk = hurt ? PAL.white : PAL.steelDk;  // metal shadow
      const rocket = hurt ? PAL.white : PAL.blood;     // spring-rocket firing tip

      ctx.save();
      if (dir > 0) { ctx.translate(cx * 2, 0); ctx.scale(-1, 1); } // mirror to face right

      // Two fat black wheels with a small dark hub.
      for (const [wx, wy, r] of [[x + 15, y + 28, 6], [x + 34, y + 27, 7]]) {
        ctx.fillStyle = PAL.black;   ctx.beginPath(); ctx.arc(wx, wy, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hurt ? PAL.white : PAL.stoneD;
        ctx.beginPath(); ctx.arc(wx, wy, 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = metalDk; ctx.fillRect(wx, wy, 1, 1);
      }
      // Blue hull: swept nose (front-left) dropping to the ground, mid chassis, cockpit floor.
      ctx.fillStyle = body;
      ctx.fillRect(x - 8, y + 22, 10, 5); ctx.fillRect(x - 9, y + 24, 3, 3);   // nose tip
      ctx.fillRect(x + 2, y + 18, 10, 9); ctx.fillRect(x + 10, y + 14, 10, 12); // rising deck
      ctx.fillRect(x + 18, y + 12, 16, 15);                                     // cockpit floor
      ctx.fillStyle = bodyDk; ctx.fillRect(x - 8, y + 26, 10, 1);              // nose underside shadow
      ctx.fillStyle = rim;                                                     // cyan leading-edge glint
      ctx.fillRect(x - 8, y + 22, 10, 1); ctx.fillRect(x + 2, y + 18, 8, 1); ctx.fillRect(x + 10, y + 14, 9, 1);
      // Gray griffin head at the sky-sled prow: hooked beak, fierce eye, swept crest.
      ctx.fillStyle = metalHi; ctx.fillRect(x - 9, y + 22, 4, 3);
      ctx.fillStyle = metal;   ctx.fillRect(x - 10, y + 24, 3, 3);
      ctx.fillStyle = metalDk; ctx.fillRect(x - 9, y + 25, 4, 1); ctx.fillRect(x - 3, y + 19, 3, 2);
      ctx.fillStyle = metalHi; ctx.fillRect(x, y + 18, 2, 2);
      if (!hurt) { ctx.fillStyle = PAL.white; ctx.fillRect(x - 6, y + 21, 2, 2); ctx.fillStyle = PAL.black; ctx.fillRect(x - 5, y + 21, 1, 1); }
      // Tall faceted rear launcher housing (the towering back), with a red-tipped spring rocket.
      ctx.fillStyle = body;   ctx.fillRect(x + 30, y - 6, 15, 33); ctx.fillRect(x + 33, y - 11, 7, 5); ctx.fillRect(x + 40, y - 3, 5, 4);
      ctx.fillStyle = bodyHi; ctx.fillRect(x + 30, y - 6, 2, 33); ctx.fillRect(x + 30, y - 6, 15, 1);
      ctx.fillRect(x + 33, y - 11, 2, 6); ctx.fillRect(x + 33, y - 11, 7, 1);
      ctx.fillStyle = bodyDk; ctx.fillRect(x + 43, y - 6, 2, 33); ctx.fillRect(x + 30, y + 25, 15, 2);
      ctx.fillStyle = metal;  ctx.fillRect(x + 40, y - 6, 4, 3);
      ctx.fillStyle = rocket; ctx.fillRect(x + 41, y - 9, 3, 3);
      // Cockpit: seat-back tying the rider to the launcher, footwell lip, windshield cowl.
      ctx.fillStyle = body;   ctx.fillRect(x + 26, y + 2, 4, 11); ctx.fillRect(x + 9, y + 11, 6, 5);
      ctx.fillStyle = bodyHi; ctx.fillRect(x + 26, y + 2, 4, 1); ctx.fillRect(x + 9, y + 11, 6, 1);
      ctx.fillStyle = bodyDk; ctx.fillRect(x + 16, y + 15, 12, 2); ctx.fillRect(x + 9, y + 15, 6, 1);

      // ---- Teela, seated & hunched into the charge, sword raised ----
      if (hurt) {
        ctx.fillStyle = PAL.white;
        ctx.fillRect(x + 9, y - 2, 22, 22);                                    // rider block
        ctx.fillRect(x + 27, y - 16, 2, 15); ctx.fillRect(x + 25, y - 3, 6, 2); // raised sword
      } else {
        // white leotard (seat + torso), gold belt/sash, yoke and snake emblem
        ctx.fillStyle = PAL.white;  ctx.fillRect(x + 20, y + 12, 9, 5); ctx.fillRect(x + 15, y + 5, 9, 8);
        ctx.fillStyle = PAL.boneSh; ctx.fillRect(x + 20, y + 16, 9, 1); ctx.fillRect(x + 15, y + 5, 1, 8);
        ctx.fillStyle = PAL.havoc;  ctx.fillRect(x + 20, y + 11, 9, 2); ctx.fillRect(x + 22, y + 13, 2, 4);
        ctx.fillRect(x + 15, y + 4, 9, 2); ctx.fillRect(x + 17, y + 7, 2, 4);
        // bare legs bent forward into the footwell -> red boots with white fur tops
        ctx.fillStyle = PAL.skin;   ctx.fillRect(x + 15, y + 15, 7, 3);
        ctx.fillStyle = PAL.skinSh; ctx.fillRect(x + 16, y + 18, 6, 3);
        ctx.fillStyle = PAL.blood;  ctx.fillRect(x + 12, y + 19, 5, 4); ctx.fillRect(x + 18, y + 19, 4, 4);
        ctx.fillStyle = PAL.white;  ctx.fillRect(x + 12, y + 18, 5, 1); ctx.fillRect(x + 18, y + 18, 4, 1);
        // head, red-orange hair bun, gold tiara
        ctx.fillStyle = PAL.skin;   ctx.fillRect(x + 12, y + 2, 6, 6);
        ctx.fillStyle = PAL.skinSh; ctx.fillRect(x + 12, y + 2, 1, 6);
        ctx.fillStyle = PAL.black;  ctx.fillRect(x + 13, y + 5, 1, 1);
        ctx.fillStyle = PAL.teela;  ctx.fillRect(x + 12, y - 1, 7, 4); ctx.fillRect(x + 17, y, 4, 5);
        ctx.fillStyle = PAL.havoc;  ctx.fillRect(x + 13, y + 2, 5, 1);
        // front arm on the cowl (white wrist cuff), rear arm raised
        ctx.fillStyle = PAL.skin;   ctx.fillRect(x + 11, y + 8, 5, 4); ctx.fillRect(x + 24, y, 3, 5); ctx.fillRect(x + 25, y - 3, 3, 3);
        ctx.fillStyle = PAL.white;  ctx.fillRect(x + 9, y + 10, 3, 3);
        ctx.fillStyle = PAL.gray;   ctx.fillRect(x + 9, y + 12, 4, 2);
        // raised silver sword
        ctx.fillStyle = metal;      ctx.fillRect(x + 27, y - 16, 2, 14);
        ctx.fillStyle = PAL.gray;   ctx.fillRect(x + 28, y - 16, 1, 14); ctx.fillRect(x + 24, y - 3, 6, 2);
        ctx.fillStyle = PAL.boneHi; ctx.fillRect(x + 29, y - 16, 1, 3);
        ctx.fillStyle = PAL.brown;  ctx.fillRect(x + 26, y - 1, 2, 2);
      }

      ctx.restore();

    } else if (e.behavior === 'elite') {
      // ---- Grayskull Elite: a TALL, regal knight — plumed helm, broad pauldrons, spear ----
      const body = hurt ? PAL.white : PAL.steel;
      const dir = e.vx < 0 ? -1 : 1;
      // Disciplined armored legs.
      ctx.fillStyle = PAL.stoneD;
      ctx.fillRect(x + 4, y + e.h - 6, 4, 6); ctx.fillRect(x + e.w - 8, y + e.h - 6, 4, 6);
      ctx.fillStyle = PAL.black;
      ctx.fillRect(x + 3, y + e.h - 2, 5, 2); ctx.fillRect(x + e.w - 8, y + e.h - 2, 5, 2);
      // Cape draped behind the body.
      ctx.fillStyle = PAL.cyanDk; ctx.fillRect(x + 2, y + 7, e.w - 4, e.h - 11);
      // Tall cuirass torso with a lit/shaded edge and a cyan spine trim.
      ctx.fillStyle = body;      ctx.fillRect(x + 4, y + 8, e.w - 8, e.h - 13);
      ctx.fillStyle = PAL.gray;  ctx.fillRect(x + 4, y + 8, 1, e.h - 13);
      ctx.fillStyle = PAL.stone; ctx.fillRect(x + e.w - 5, y + 8, 1, e.h - 13);
      ctx.fillStyle = PAL.cyan;  ctx.fillRect(x + e.w / 2 - 1, y + 9, 2, e.h - 16);
      ctx.fillStyle = PAL.stoneD; ctx.fillRect(x + 5, y + 14, e.w - 10, 2); // belt
      // Broad pauldrons — wider than the torso, marking his rank.
      ctx.fillStyle = body;
      ctx.fillRect(x + 1, y + 7, 5, 4); ctx.fillRect(x + e.w - 6, y + 7, 5, 4);
      ctx.fillStyle = PAL.gray;
      ctx.fillRect(x + 1, y + 7, 5, 1); ctx.fillRect(x + e.w - 6, y + 7, 5, 1);
      ctx.fillStyle = PAL.cyanDk;
      ctx.fillRect(x + 1, y + 10, 5, 1); ctx.fillRect(x + e.w - 6, y + 10, 5, 1);
      // Helmeted head + visor + glowing cyan eyes.
      ctx.fillStyle = body;      ctx.fillRect(x + 6, y + 2, 6, 6);
      ctx.fillStyle = PAL.gray;  ctx.fillRect(x + 6, y + 2, 6, 1);
      ctx.fillStyle = PAL.black; ctx.fillRect(x + 6, y + 4, 6, 2);
      ctx.fillStyle = PAL.cyan;  ctx.fillRect(x + 6, y + 4, 1, 1); ctx.fillRect(x + 11, y + 4, 1, 1);
      // Tall plume crest rising above the helm.
      ctx.fillStyle = PAL.blood;   ctx.fillRect(x + e.w / 2 - 1, y - 4, 2, 6);
      ctx.fillStyle = PAL.bloodDk; ctx.fillRect(x + e.w / 2 - 1, y - 4, 2, 2);
      // Vertical spear on the facing side, taller than he is.
      const sx = dir < 0 ? x - 2 : x + e.w;
      ctx.fillStyle = PAL.brown; ctx.fillRect(sx, y - 6, 2, e.h + 4);
      ctx.fillStyle = PAL.gray;  ctx.fillRect(sx - 1, y - 10, 4, 5);
      ctx.fillStyle = PAL.cyan;  ctx.fillRect(sx, y - 11, 2, 2);

    } else {
      // ---- Grunt: a hunched, scrappy foot brute with a raised club ----
      const body = hurt ? PAL.white : e.color;         // blood (jungle) or toxic (cavern)
      const dir = e.vx < 0 ? -1 : 1;
      // Wide, bent brutish stance.
      ctx.fillStyle = PAL.jungleD;
      ctx.fillRect(x + 2, y + e.h - 6, 4, 6); ctx.fillRect(x + e.w - 6, y + e.h - 6, 4, 6);
      ctx.fillStyle = PAL.black;
      ctx.fillRect(x + 1, y + e.h - 2, 5, 2); ctx.fillRect(x + e.w - 6, y + e.h - 2, 5, 2);
      // Slouched torso — a shadowed hunch on the back side.
      ctx.fillStyle = body;      ctx.fillRect(x + 1, y + 7, e.w - 2, e.h - 11);
      ctx.fillStyle = PAL.clayDk; ctx.fillRect(x + 1, y + 7, 3, e.h - 11);      // hunched back
      ctx.fillRect(x + 3, y + 11, e.w - 5, 2);                                  // belt
      // Slab shoulders hunkered up around the sunken head.
      ctx.fillStyle = body;
      ctx.fillRect(x, y + 5, 6, 5); ctx.fillRect(x + e.w - 6, y + 5, 6, 5);
      // Small head sunk low between the shoulders.
      ctx.fillStyle = PAL.clay;  ctx.fillRect(x + 5, y + 3, 6, 6);
      ctx.fillStyle = PAL.black; ctx.fillRect(x + 5, y + 5, 6, 2);
      ctx.fillStyle = PAL.blood; ctx.fillRect(x + 5, y + 5, 1, 1); ctx.fillRect(x + 10, y + 5, 1, 1); // eyes
      // Crude club raised on the facing side, extends above the hitbox.
      const cxL = dir < 0;
      ctx.fillStyle = PAL.clayDk;
      ctx.fillRect(cxL ? x - 2 : x + e.w - 1, y - 1, 3, 7);                      // handle + fist
      ctx.fillStyle = PAL.stoneD;
      ctx.fillRect(cxL ? x - 4 : x + e.w - 3, y - 6, 7, 5);                      // club head
      ctx.fillStyle = PAL.gray;
      ctx.fillRect(cxL ? x - 4 : x + e.w - 3, y - 6, 7, 1);                      // highlight
    }

    // No floating HP pip on normal enemies — the rabble's remaining life is
    // hidden from the player by design. Only bosses/mid-bosses show health, via
    // their dedicated top/bottom HUD bars (_healthBar).
  }

  _drawDepthEnemy(ctx, e) {
    const pr = this.level.proj.project(e.lane, e.z);
    const s = Math.max(0.15, pr.scale);
    const w = 20 * s, h = 20 * s;
    ctx.fillStyle = e.hurtT > 0 ? PAL.white : e.color;
    ctx.fillRect(pr.sx - w / 2, pr.sy - h, w, h);
    // Eyes.
    ctx.fillStyle = PAL.blood;
    ctx.fillRect(pr.sx - w / 4, pr.sy - h * 0.7, Math.max(1, 3 * s), Math.max(1, 3 * s));
    ctx.fillRect(pr.sx + w / 8, pr.sy - h * 0.7, Math.max(1, 3 * s), Math.max(1, 3 * s));
  }

  _drawPowerup(ctx, sx, sy, type) {
    const color = {
      [WEAPON.SPREAD]: PAL.toxic, [WEAPON.LASER]: PAL.purple,
      [WEAPON.FLAME]: PAL.ember, [WEAPON.BARRIER]: PAL.cyan,
      [WEAPON.DEFAULT]: PAL.bone,
    }[type] || PAL.havoc;
    const letter = { [WEAPON.SPREAD]:'S', [WEAPON.LASER]:'L', [WEAPON.FLAME]:'F', [WEAPON.BARRIER]:'B' }[type] || '?';
    ctx.fillStyle = PAL.black; ctx.fillRect(sx - 1, sy - 1, 16, 16);
    ctx.fillStyle = color; ctx.fillRect(sx, sy, 14, 14);
    ctx.fillStyle = PAL.black;
    this._text(ctx, letter, sx + 7, sy + 3, PAL.black, 'center', 8);
  }

  _drawBarrier(ctx, cx, cy, time) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const a = this.frame * 0.15 + (i / n) * Math.PI * 2;
      const r = 18;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      ctx.fillStyle = PAL.cyan;
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Ring flickers as it nears expiry.
    const expiring = time < 120 && Math.floor(this.frame / 6) % 2 === 0;
    ctx.strokeStyle = expiring ? 'rgba(75,214,214,0.3)' : 'rgba(75,214,214,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.stroke();
  }

  /* ---- HUD ---- */
  _renderHUD(ctx) {
    // Top bar.
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, VW, 14);
    this._text(ctx, `SCORE ${String(this.score).padStart(6, '0')}`, 4, 4, PAL.bone, 'left', 8);

    // Lives (little skulls).
    for (let i = 0; i < this.lives; i++) {
      const x = 120 + i * 12;
      ctx.fillStyle = PAL.bone;
      ctx.fillRect(x, 3, 8, 8);
      ctx.fillStyle = PAL.blood;
      ctx.fillRect(x + 1, 6, 2, 2); ctx.fillRect(x + 5, 6, 2, 2);
    }

    // Weapon indicator. On touch it centres to clear the top-right pause
    // button; on desktop it hugs the right edge as before.
    if (this.isTouch) {
      this._text(ctx, Weapons[this.player.weapon].name, VW / 2, 4, PAL.havoc, 'center', 8);
    } else {
      this._text(ctx, Weapons[this.player.weapon].name, VW - 4, 4, PAL.havoc, 'right', 8);
    }

    // Barrier timer — stacked just beneath the weapon name, same alignment.
    if (this.player.barrierTime > 0) {
      const secs = Math.ceil(this.player.barrierTime / 60);
      if (this.isTouch) {
        this._text(ctx, `BARRIER ${secs}s`, VW / 2, 16, PAL.cyan, 'center', 8);
      } else {
        this._text(ctx, `BARRIER ${secs}s`, VW - 4, 16, PAL.cyan, 'right', 8);
      }
    }

    // MID-BOSS health bar (amber, top-center). Shown while a level's mid-boss
    // is alive — currently Teela on the Battle Ram in the Vine Jungle. Lives at
    // the top so it never clashes with the stage-boss bar along the bottom.
    const mb = this.level && this.level.midBoss;
    if (mb && !mb.dead) {
      const w = 130;
      this._healthBar(ctx, (VW - w) / 2, 30, w, mb.hp / mb.maxHp, PAL.hero, 'TEELA & BATTLE RAM');
    }

    // STAGE-BOSS health bar (crimson, bottom).
    if (this.boss) {
      this._healthBar(ctx, 20, VH - 12, VW - 40, this.boss.hp / this.boss.maxHp, PAL.blood, this._bossName());
    }

    // Muted indicator — a quiet little reminder the Havoc Staff is silenced.
    if (typeof SFX !== 'undefined' && SFX.muted) {
      this._text(ctx, 'MUTED', 4, VH - 12, PAL.stone, 'left', 7);
    }
  }

  // Reusable labeled health bar: dark trough, colored fill, bone frame + label.
  _healthBar(ctx, x, y, w, frac, color, label) {
    ctx.fillStyle = PAL.stoneD; ctx.fillRect(x, y, w, 6);
    ctx.fillStyle = color; ctx.fillRect(x, y, w * clamp(frac, 0, 1), 6);
    ctx.strokeStyle = PAL.bone; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, 6);
    if (label) this._text(ctx, label, x + w / 2, y - 10, PAL.bone, 'center', 8);
  }

  _bossName() {
    if (this.boss instanceof ManAtArms) return 'MAN-AT-ARMS';
    if (this.boss instanceof SorceressStratos) return this.boss.stratos.alive ? 'STRATOS + SORCERESS' : 'THE SORCERESS';
    if (this.boss instanceof HeManBattleCat) return this.boss.phase === 1 ? 'BATTLE CAT' : 'HE-MAN';
    return 'BOSS';
  }

  /* ---- Menu / transition / end screens ---- */
  _renderMenu(ctx) {
    // Ominous backdrop.
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, PAL.sky2); g.addColorStop(1, PAL.black);
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);

    // Floating head emblem — Skeletor's hooded skull in the style of the
    // vintage '80s Mattel figure: a purple cowl framing a yellow bare-bone
    // skull, hollow sockets lit by red eye-fire, and the signature
    // gritted-teeth grimace. Authored on a 40x44 grid, symmetric about x=20.
    const cy = 70 + Math.sin(this.frame * 0.05) * 4;
    // Snap the origin to whole pixels: a fractional offset would smear every
    // block across two pixels and shimmer as the head bobs. Integer origin =
    // crisp blocks that float in clean 1px steps.
    const ex = Math.round(VW / 2 - 20), ey = Math.round(cy - 18);   // local (0,0) origin
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(ex + x, ey + y, w, h); };

    // ---- Purple hood cowl: a rounded arch draping to a floating point ----
    R(17, 0, 6, 1, PAL.purple); R(15, 1, 10, 1, PAL.purple); R(13, 2, 14, 1, PAL.purple);
    R(12, 3, 16, 1, PAL.purple); R(11, 4, 18, 1, PAL.purple); R(10, 5, 20, 1, PAL.purple);
    R(10, 6, 20, 1, PAL.purple); R(9, 7, 22, 1, PAL.purple);
    R(9, 9, 22, 22, PAL.purple);                                // side frames around the face
    R(10, 31, 20, 1, PAL.purple); R(11, 32, 18, 1, PAL.purple); R(13, 33, 14, 1, PAL.purple);
    R(15, 34, 10, 1, PAL.purple); R(17, 35, 6, 1, PAL.purple);  // cowl closes under the chin
    R(9, 7, 1, 26, PAL.purpleDk); R(9, 7, 10, 1, PAL.purpleDk); // dark left/top rim
    R(29, 9, 2, 23, PAL.purpleDk);                              // inner right fold shadow
    R(30, 7, 1, 26, PAL.purpleHi); R(20, 0, 11, 1, PAL.purpleHi); // lit right rim + crown gleam
    R(17, 35, 6, 1, PAL.purpleDk);                              // cowl bottom rim shadow

    // ---- Yellow bare-bone skull inset in the cowl opening ----
    R(14, 7, 12, 1, PAL.skull); R(13, 8, 14, 1, PAL.skull); R(13, 9, 14, 1, PAL.skull);
    R(12, 10, 16, 1, PAL.skull); R(12, 11, 16, 1, PAL.skull); R(12, 12, 16, 1, PAL.skull);
    R(12, 13, 16, 1, PAL.skull); R(13, 14, 14, 1, PAL.skull); R(13, 15, 14, 1, PAL.skull);
    R(14, 16, 12, 1, PAL.skull);
    R(12, 17, 16, 10, PAL.skull);                               // main face block
    R(13, 27, 14, 1, PAL.skull); R(14, 28, 12, 1, PAL.skull); R(15, 29, 10, 1, PAL.skull); // jaw taper
    R(12, 7, 1, 20, PAL.skullSh); R(13, 7, 14, 1, PAL.skullSh); // left edge + brow ridge
    R(26, 10, 2, 17, PAL.skullHi); R(20, 25, 6, 1, PAL.skullHi); // lit cheekbone + chin gleam
    R(13, 29, 13, 1, PAL.skullSh);                              // jaw shadow

    // ---- Hollow eye sockets with an angry inner brow, lit by red eye-fire ----
    R(13, 11, 5, 5, PAL.black); R(22, 11, 5, 5, PAL.black);
    R(17, 11, 1, 2, PAL.skullSh); R(22, 11, 1, 2, PAL.skullSh); // inner-top brow points
    R(13, 15, 5, 1, PAL.skullSh); R(22, 15, 5, 1, PAL.skullSh); // lower socket rim
    R(15, 13, 2, 2, PAL.blood); R(23, 13, 2, 2, PAL.blood);     // burning red eyes

    // ---- Nasal cavity ----
    R(19, 17, 3, 2, PAL.black); R(20, 19, 1, 1, PAL.black);

    // ---- Gritted-teeth grimace (the vintage toy's signature) ----
    R(13, 21, 15, 6, PAL.skull);                                // teeth block
    R(13, 24, 15, 1, PAL.black);                                // clench line between the rows
    for (let tx = 14; tx < 28; tx += 2) { R(tx, 21, 1, 3, PAL.black); R(tx, 25, 1, 2, PAL.black); }
    R(12, 21, 1, 6, PAL.black); R(28, 21, 1, 6, PAL.black);     // mouth corners
    R(13, 20, 15, 1, PAL.skullSh);                              // upper-lip shadow

    this._text(ctx, "SKELETOR'S CONQUEST", VW / 2, 120, PAL.purple, 'center', 14);
    this._text(ctx, 'THE ROAD TO GRAYSKULL', VW / 2, 140, PAL.havoc, 'center', 10);

    if (Math.floor(this.frame / 30) % 2 === 0) {
      this._text(ctx, 'PRESS ENTER TO CONQUER', VW / 2, 180, PAL.bone, 'center', 9);
    }
    this._text(ctx, 'WASD MOVE/AIM · J FIRE · K JUMP · SPACE PAUSE · M MUTE', VW / 2, 210, PAL.stone, 'center', 7);
  }

  _renderTransition(ctx) {
    ctx.fillStyle = PAL.black; ctx.fillRect(0, 0, VW, VH);
    this._text(ctx, 'ONWARD TO', VW / 2, 100, PAL.purple, 'center', 10);
    const next = ['THE VINE JUNGLE', 'THE CAVERNS OF WHISPERS', 'CASTLE GRAYSKULL'][this.levelIndex];
    this._text(ctx, next, VW / 2, 124, PAL.havoc, 'center', 12);
    this._text(ctx, 'HEHEHEHEHE!', VW / 2, 150, PAL.bone, 'center', 9);
  }

  _renderGameOver(ctx) {
    ctx.fillStyle = PAL.black; ctx.fillRect(0, 0, VW, VH);
    this._text(ctx, 'CURSE YOU, HE-MAN!', VW / 2, 90, PAL.blood, 'center', 12);
    this._text(ctx, 'SKELETOR IS DEFEATED', VW / 2, 116, PAL.bone, 'center', 9);
    this._text(ctx, `SCORE ${this.score}`, VW / 2, 140, PAL.havoc, 'center', 9);
    this._text(ctx, 'PRESS ENTER — I WILL RETURN!', VW / 2, 180, PAL.purple, 'center', 8);
  }

  _renderVictory(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, PAL.purpleDk); g.addColorStop(1, PAL.black);
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
    this._text(ctx, 'GRAYSKULL IS MINE!', VW / 2, 90, PAL.havoc, 'center', 14);
    this._text(ctx, 'THE UNIVERSE BOWS TO SKELETOR', VW / 2, 118, PAL.bone, 'center', 9);
    this._text(ctx, `FINAL SCORE ${this.score}`, VW / 2, 142, PAL.toxic, 'center', 9);
    this._text(ctx, 'HEHEHEHEHE! — PRESS ENTER', VW / 2, 180, PAL.purple, 'center', 8);
  }

  _renderPause(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, VW, VH);
    this._text(ctx, 'PAUSED', VW / 2, 100, PAL.havoc, 'center', 14);
    this._text(ctx, 'SILENCE! SKELETOR SCHEMES...', VW / 2, 124, PAL.bone, 'center', 8);
    this._text(ctx, 'PRESS SPACE TO RESUME', VW / 2, 150, PAL.purple, 'center', 8);
  }

  /* ---- Crisp bitmap-ish text using canvas font ---- */
  _text(ctx, str, x, y, color, align = 'left', size = 8) {
    ctx.font = `${size}px "Courier New", monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillText(str, x + 1, y + 1);   // drop shadow
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }
}
