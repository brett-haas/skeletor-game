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

    setTimeout(() => {}, 0); // (no async needed; respawn handled in update)
    this._respawnTimer = 45;
  }

  respawn() {
    const p = this.player;
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
      const cx = this.level.checkpointFor(p.x);
      p.x = cx;
      // Snap onto the actual floor beneath the checkpoint column. The old
      // `Math.min(startY - 30, VH)` clamp assumed a screen-height world and
      // dropped Skeletor into the void on tall levels (L3's 1400px shaft):
      // both startY and VH sat far above the real floor, so every respawn
      // fell to its death in an endless loop. Find the lowest solid platform
      // spanning the checkpoint and stand on it.
      const centerX = cx + p.w / 2;
      let floorY = null;
      for (const plat of this.level.platforms) {
        if (plat.gone) continue;
        if (plat.x <= centerX && plat.x + plat.w >= centerX) {
          if (floorY === null || plat.y > floorY) floorY = plat.y;
        }
      }
      if (floorY !== null) {
        p.y = floorY - p.h;
        p.onGround = true;
      } else {
        // No platform under this column — fall back to a height inside the world.
        p.y = Math.min(this.level.startY - 30, this.level.worldH - p.h);
      }
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

    inp.endFrame();
  }

  _updatePlaying() {
    const p = this.player;
    const lvl = this.level;
    const inp = this.input;

    // Handle respawn timer / game over.
    if (p.dead) {
      if (this._respawnTimer > 0 && --this._respawnTimer === 0) {
        if (this.lives <= 0) { this.state = STATE.GAME_OVER; return; }
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
      // Off-screen cull (world space for SIDE; screen for DEPTH).
      if (this.level.mode === MODE.SIDE) {
        const relX = s.x - this.camera.x;
        if (relX < -40 || relX > VW + 40 || s.y < -40 || s.y > VH + 40) s.dead = true;
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
          if (s.pierce) s.hitSet.add(e);
          else { s.dead = true; break; }
        }
      }

      // vs boss.
      if (!s.dead && this.boss && this.boss.hitTest) {
        const absorbed = this.boss.hitTest(s);
        if (absorbed && !s.pierce) s.dead = true;
      }
    }
    this.shots = this.shots.filter((s) => !s.dead);
  }

  _onEnemyKilled(e) {
    this.score += 100;
    this.spawnBurst(e.x + e.w / 2, e.y + e.h / 2, e.color, 8);
    if (e.drop) {
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

    if (e.behavior === 'turret' || e.behavior === 'homing-turret') {
      // ---- Palace Guard turret: bunkered emplacement with a swivel barrel ----
      const energy = e.behavior === 'homing-turret' ? PAL.purple : PAL.blood;
      const hull = hurt ? PAL.white : PAL.steel;
      const barrelDir = (this.player && this.player.x < e.x) ? -1 : 1;
      // Barrel aimed roughly at the player.
      ctx.fillStyle = PAL.stoneD;
      ctx.fillRect(x + e.w / 2 - 2 + barrelDir * 4, y - 3, 4, 7);
      // Base plate + armored dome.
      ctx.fillStyle = PAL.stoneD; ctx.fillRect(x, y + e.h - 4, e.w, 4);
      ctx.fillStyle = hull; ctx.fillRect(x + 1, y + 2, e.w - 2, e.h - 5);
      ctx.fillStyle = PAL.gray; ctx.fillRect(x + 1, y + 2, e.w - 2, 1);
      // Glowing energy core.
      ctx.fillStyle = energy; ctx.fillRect(x + 3, y + 5, e.w - 6, 4);
      ctx.fillStyle = PAL.white; ctx.fillRect(x + e.w / 2 - 1, y + 6, 2, 2);
      // Rivets.
      ctx.fillStyle = PAL.gray;
      ctx.fillRect(x + 2, y + e.h - 3, 1, 1); ctx.fillRect(x + e.w - 3, y + e.h - 3, 1, 1);

    } else if (e.behavior === 'battleram') {
      // ---- Teela on the Battle Ram ----
      const steel = hurt ? PAL.white : PAL.steel;
      // Vehicle chassis + panel lines.
      ctx.fillStyle = steel; ctx.fillRect(x, y + 12, e.w, e.h - 12);
      ctx.fillStyle = PAL.stoneD;
      ctx.fillRect(x, y + 12, e.w, 2);
      ctx.fillRect(x + e.w * 0.5, y + 15, 2, e.h - 17);
      // Bronze ram head at the front with curled horns + battering spike.
      ctx.fillStyle = PAL.hero; ctx.fillRect(x - 8, y + 14, 12, 12);
      ctx.fillStyle = PAL.brown; ctx.fillRect(x - 8, y + 14, 12, 2);
      ctx.fillStyle = PAL.black; ctx.fillRect(x - 5, y + 18, 2, 2); // eye
      ctx.strokeStyle = PAL.bone; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x - 6, y + 15, 4, Math.PI * 0.7, Math.PI * 1.7); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + 2, y + 15, 4, Math.PI * 1.3, Math.PI * 2.3); ctx.stroke();
      ctx.fillStyle = PAL.gray; ctx.fillRect(x - 12, y + 19, 5, 3);
      // Wheels with hubs.
      for (const wx of [x + 12, x + e.w - 12]) {
        ctx.fillStyle = PAL.stoneD;
        ctx.beginPath(); ctx.arc(wx, y + e.h, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = PAL.gray;
        ctx.fillRect(wx - 1, y + e.h - 5, 2, 10); ctx.fillRect(wx - 5, y + e.h - 1, 10, 2);
      }
      // ---- Teela riding atop ----
      const tx = x + e.w / 2 - 4, ty = y - 8;
      ctx.fillStyle = PAL.skinSh; ctx.fillRect(tx + 1, y + 6, 2, 6); ctx.fillRect(tx + 5, y + 6, 2, 6); // legs
      ctx.fillStyle = hurt ? PAL.white : PAL.gray; ctx.fillRect(tx, ty + 6, 8, 8);   // armor
      ctx.fillStyle = PAL.havoc; ctx.fillRect(tx, ty + 9, 8, 2);                     // gold belt
      ctx.fillStyle = PAL.skin; ctx.fillRect(tx + 1, ty, 6, 6);                      // head
      ctx.fillStyle = PAL.teela; ctx.fillRect(tx, ty - 2, 8, 3); ctx.fillRect(tx - 1, ty, 2, 6); // hair
      ctx.strokeStyle = PAL.havoc; ctx.lineWidth = 1;                               // staff
      ctx.beginPath(); ctx.moveTo(tx + 9, ty - 2); ctx.lineTo(tx + 9, ty + 13); ctx.stroke();

    } else {
      // ---- Foot soldier: jungle guard (walker) or Grayskull elite ----
      const isElite = e.behavior === 'elite';
      const dir = e.vx < 0 ? -1 : 1;
      const body = hurt ? PAL.white : (isElite ? PAL.steel : e.color);
      const dark = isElite ? PAL.stoneD : PAL.jungleD;
      const trim = isElite ? PAL.cyan : PAL.havoc;
      // Legs.
      ctx.fillStyle = dark;
      ctx.fillRect(x + 2, y + e.h - 5, 4, 5);
      ctx.fillRect(x + e.w - 6, y + e.h - 5, 4, 5);
      // Torso + chest plate + center trim.
      ctx.fillStyle = body; ctx.fillRect(x + 1, y + 5, e.w - 2, e.h - 9);
      ctx.fillStyle = dark; ctx.fillRect(x + 2, y + 7, e.w - 4, 3);
      ctx.fillStyle = trim; ctx.fillRect(x + e.w / 2 - 1, y + 6, 2, e.h - 12);
      // Helmet + visor slit + glowing eyes.
      ctx.fillStyle = body; ctx.fillRect(x + 3, y, e.w - 6, 6);
      ctx.fillStyle = PAL.black; ctx.fillRect(x + 3, y + 2, e.w - 6, 2);
      ctx.fillStyle = isElite ? PAL.cyan : PAL.blood;
      ctx.fillRect(x + e.w / 2 - 3, y + 2, 1, 1); ctx.fillRect(x + e.w / 2 + 2, y + 2, 1, 1);
      if (isElite) { ctx.fillStyle = PAL.blood; ctx.fillRect(x + e.w / 2 - 1, y - 3, 2, 3); } // crest
      // Weapon arm toward facing.
      ctx.fillStyle = PAL.stoneD;
      ctx.fillRect(dir < 0 ? x - 3 : x + e.w - 1, y + 7, 4, 2);
    }

    // Tiny HP pips for tougher foes.
    if (e.maxHp > 1) {
      ctx.fillStyle = PAL.toxic;
      ctx.fillRect(x, y - 4, e.w * (e.hp / e.maxHp), 2);
    }
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

    // Floating skull emblem.
    const cy = 70 + Math.sin(this.frame * 0.05) * 4;
    ctx.fillStyle = PAL.bone;
    ctx.fillRect(VW / 2 - 16, cy - 16, 32, 30);
    ctx.fillStyle = PAL.blood;
    ctx.fillRect(VW / 2 - 9, cy - 6, 5, 6); ctx.fillRect(VW / 2 + 4, cy - 6, 5, 6);
    ctx.fillStyle = PAL.black;
    ctx.fillRect(VW / 2 - 6, cy + 6, 3, 6); ctx.fillRect(VW / 2, cy + 6, 3, 6); ctx.fillRect(VW / 2 + 5, cy + 6, 3, 6);

    this._text(ctx, "SKELETOR'S CONQUEST", VW / 2, 120, PAL.purple, 'center', 14);
    this._text(ctx, 'THE ROAD TO GRAYSKULL', VW / 2, 140, PAL.havoc, 'center', 10);

    if (Math.floor(this.frame / 30) % 2 === 0) {
      this._text(ctx, 'PRESS ENTER TO CONQUER', VW / 2, 180, PAL.bone, 'center', 9);
    }
    this._text(ctx, 'WASD MOVE/AIM · J FIRE · K JUMP · SPACE PAUSE', VW / 2, 210, PAL.stone, 'center', 7);
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
