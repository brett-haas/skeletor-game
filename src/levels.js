/* ============================================================================
 *  SKELETOR'S CONQUEST — LEVELS
 *  Level base + L1 Vine Jungle, L2 Caverns, L3 Grayskull.
 * ========================================================================== */

'use strict';

/* ============================================================================
 * [7] LEVEL BASE + FACTORIES
 *   Each level owns its geometry, spawns, update() and renderWorld().
 *   Shared entity systems live on the engine.
 * ========================================================================== */

class Level {
  constructor(engine, cfg) {
    this.engine = engine;
    this.mode = cfg.mode;
    this.worldW = cfg.worldW || VW;
    this.worldH = cfg.worldH || VH;
    this.name = cfg.name;
    this.subtitle = cfg.subtitle || '';
    this.platforms = [];      // {x,y,w,h,collapsing?,fallT?}
    this.spawners = [];       // {atX, done, make()}
    this.checkpoints = [64];  // respawn x positions (SIDE)
    this.boss = null;
    this.bossTriggered = false;
    this.complete = false;
    this.startX = 40;
    this.startY = 120;
  }

  // Overridden per level.
  build() {}
  update(dt) {}
  renderWorld(ctx, cam) {}

  // Trigger x-based spawners as the player advances.
  runSpawners(px) {
    for (const s of this.spawners) {
      if (!s.done && px >= s.atX) { s.done = true; s.make(); }
    }
  }

  // Nearest checkpoint at or behind x.
  checkpointFor(x) {
    let best = this.checkpoints[0];
    for (const c of this.checkpoints) if (c <= x + 40) best = c;
    return best;
  }
}

/* -------------------------------------------------------------------------
 *  LEVEL 1 — THE VINE JUNGLE  (SIDE-SCROLLER)
 *  Run-and-gun. Collapsing platforms + Palace Guard turrets.
 *  Mid-boss: Teela on the Battle Ram. Stage boss: Man-At-Arms.
 * ---------------------------------------------------------------------- */
class Level1 extends Level {
  constructor(engine) {
    super(engine, {
      mode: MODE.SIDE, worldW: 3600, worldH: VH,
      name: 'LEVEL 1', subtitle: 'THE VINE JUNGLE',
    });
    this.groundY = 200;
    this.startX = 40; this.startY = 150;
    this.midBoss = null;
    this.midBossDead = false;
  }

  build() {
    const G = this.groundY;
    // Continuous ground with two deadly pits.
    this.platforms.push({ x: 0,    y: G, w: 620,  h: 40 });
    this.platforms.push({ x: 700,  y: G, w: 700,  h: 40 });      // pit @620-700
    this.platforms.push({ x: 1500, y: G, w: 900,  h: 40 });      // pit @1400-1500
    this.platforms.push({ x: 2400, y: G, w: 1200, h: 40 });

    // Elevated ledges.
    this.platforms.push({ x: 260, y: 150, w: 90, h: 10 });
    this.platforms.push({ x: 900, y: 140, w: 110, h: 10 });
    this.platforms.push({ x: 1180, y: 120, w: 90, h: 10 });

    // Collapsing platforms bridging the second pit region.
    this.platforms.push({ x: 1410, y: 160, w: 40, h: 10, collapsing: true });
    this.platforms.push({ x: 1460, y: 160, w: 40, h: 10, collapsing: true });

    this.checkpoints = [40, 760, 1520, 2450, 3050];

    // ---- Palace Guard turrets (fixed, fire at player) ----
    const turret = (x) => ({
      atX: x - 200, done: false, make: () => {
        this.engine.enemies.push(new Enemy(x, this.groundY - 18, {
          w: 18, h: 18, hp: 3, behavior: 'turret', color: PAL.steel,
          fireT: randInt(30, 70),
        }));
      },
    });
    this.spawners.push(turret(420), turret(1050), turret(1250), turret(2650), turret(2900));

    // ---- Roaming jungle guards ----
    const walker = (x, drop = null) => ({
      atX: x - 180, done: false, make: () => {
        const e = new Enemy(x, this.groundY - 18, {
          w: 16, h: 18, hp: 2, behavior: 'walker', color: PAL.blood, vx: -0.8,
        });
        e.drop = drop; this.engine.enemies.push(e);
      },
    });
    this.spawners.push(walker(520), walker(980, WEAPON.SPREAD), walker(1300),
                       walker(2500), walker(2750, WEAPON.FLAME));

    // ---- MID-BOSS: Teela on the Battle Ram ----
    this.spawners.push({
      atX: 2000, done: false, make: () => {
        this.midBoss = new Enemy(2320, this.groundY - 34, {
          w: 46, h: 34, hp: 26, behavior: 'battleram', color: PAL.hero,
          data: { dir: -1, chargeSpd: 2.6 },
        });
        this.engine.enemies.push(this.midBoss);
        this.engine.banner('MID-BOSS: TEELA & BATTLE RAM', 150);
      },
    });

    // ---- STAGE BOSS trigger at world end ----
    this.bossX = 3380;
  }

  update(dt) {
    const p = this.engine.player;
    this.runSpawners(p.x);

    if (this.midBoss && this.midBoss.dead && !this.midBossDead) {
      this.midBossDead = true;
      this.engine.banner('THE RAM IS SCRAP! PRESS ON!', 120);
    }

    // Boss arena gate: once the player reaches the end, summon Man-At-Arms.
    if (!this.bossTriggered && p.x >= this.bossX - 120) {
      this.bossTriggered = true;
      this.boss = new ManAtArms(this.engine, this.bossX, this.groundY);
      this.engine.boss = this.boss;
      this.engine.banner('STAGE BOSS: MAN-AT-ARMS', 160);
    }

    // Animate collapsing platforms that have been triggered.
    for (const plat of this.platforms) {
      if (plat.collapsing && plat.triggered) {
        plat.fallT = (plat.fallT || 0) + 1;
        if (plat.fallT > 22) plat.y += (plat.fallT - 22) * 0.6;
        if (plat.y > VH + 40) plat.gone = true;
      }
    }
  }

  renderWorld(ctx, cam) {
    // Layered jungle sky.
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, PAL.sky1); g.addColorStop(1, PAL.jungleD);
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);

    // Parallax vines (far).
    ctx.strokeStyle = 'rgba(30,90,45,0.5)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 30; i++) {
      const vx = ((i * 180 - cam.x * 0.4) % (this.worldW)) ;
      ctx.beginPath();
      ctx.moveTo(vx, 0);
      ctx.quadraticCurveTo(vx + 14, 70, vx - 6, 150);
      ctx.stroke();
    }

    // Ground & platforms.
    drawPlatforms(ctx, cam, this.platforms, PAL.jungle, PAL.jungleD);

    // Foreground grass on ground top.
    ctx.fillStyle = PAL.toxic;
    for (const plat of this.platforms) {
      if (plat.gone) continue;
      const sx = plat.x - cam.x;
      if (sx > VW || sx + plat.w < 0) continue;
      for (let gx = 0; gx < plat.w; gx += 8) {
        ctx.fillRect(sx + gx, plat.y - cam.y - 2, 2, 3);
      }
    }
  }
}

/* -------------------------------------------------------------------------
 *  LEVEL 2 — THE CAVERNS OF WHISPERS  (SIDE-SCROLLER)
 *  A flat descent through the caverns. It keeps its OWN wicked identity so it
 *  never feels like the jungle: snapping floor-spike traps, toggling laser
 *  gates, and rolling boulders that barrel down the tunnel toward you.
 *  Boss: The Sorceress & Stratos (aerial tag-team).
 *
 *  (The engine's pseudo-3D DEPTH machinery is left intact and dormant — a
 *   conqueror discards no weapon — but this level no longer uses it.)
 * ---------------------------------------------------------------------- */
class Level2 extends Level {
  constructor(engine) {
    super(engine, {
      mode: MODE.SIDE, worldW: 3200, worldH: VH,
      name: 'LEVEL 2', subtitle: 'THE CAVERNS OF WHISPERS',
    });
    this.groundY = 200;
    this.startX = 40; this.startY = 150;
    this.hazards = [];        // spikes / laser gates / rolling boulders
    this.boulderT = 120;      // countdown to the next rolling boulder
  }

  build() {
    const G = this.groundY;
    // Cavern floor with a few chasms to leap.
    this.platforms.push({ x: 0,    y: G, w: 560,  h: 40 });
    this.platforms.push({ x: 632,  y: G, w: 668,  h: 40 });   // pit @560-632  (72px)
    this.platforms.push({ x: 1372, y: G, w: 808,  h: 40 });   // pit @1300-1372 (72px)
    this.platforms.push({ x: 2252, y: G, w: 948,  h: 40 });   // pit @2180-2252 (72px)

    // Rocky ledges to climb and take cover on.
    this.platforms.push({ x: 300,  y: 150, w: 90,  h: 10 });
    this.platforms.push({ x: 780,  y: 138, w: 100, h: 10 });
    this.platforms.push({ x: 1120, y: 120, w: 90,  h: 10 });
    this.platforms.push({ x: 1900, y: 140, w: 110, h: 10 });

    this.checkpoints = [40, 700, 1460, 2300, 2700];

    // ---- Fixed floor-spike traps (pop up on a cycle) ----
    const spike = (x, phase = 0) => this.hazards.push({
      type: 'spikes', x, y: G - 14, w: 40, h: 14, t: phase, cycle: 110, up: false,
    });
    spike(430); spike(900, 55); spike(1180, 0); spike(1980, 40); spike(2500, 70);

    // ---- Laser gates (vertical beams that toggle on/off) ----
    const laser = (x, phase = 0) => this.hazards.push({
      type: 'laser', x, y: 0, w: 6, h: G, t: phase, onFor: 80, offFor: 70, on: false,
    });
    laser(760, 0); laser(1220, 40); laser(2360, 20); laser(2620, 90);

    // ---- Cavern crawlers + a turret or two (reuse SIDE behaviors) ----
    const crawler = (x, drop = null) => ({
      atX: x - 180, done: false, make: () => {
        const e = new Enemy(x, G - 18, {
          w: 16, h: 18, hp: 2, behavior: 'walker', color: PAL.toxic, vx: -1.0,
        });
        e.drop = drop; this.engine.enemies.push(e);
      },
    });
    const turret = (x) => ({
      atX: x - 200, done: false, make: () => {
        this.engine.enemies.push(new Enemy(x, G - 18, {
          w: 18, h: 18, hp: 3, behavior: 'turret', color: PAL.steel,
          fireT: randInt(30, 70),
        }));
      },
    });
    this.spawners.push(
      crawler(520), turret(840), crawler(1000, WEAPON.SPREAD),
      crawler(1520), turret(1700), crawler(2000, WEAPON.LASER),
      crawler(2400, WEAPON.BARRIER), crawler(2800, WEAPON.FLAME)
    );

    // ---- Rolling-boulder zone (boulders roll while you're inside it) ----
    this.boulderZone = [700, 3000];

    this.bossX = 3040;
  }

  // A boulder appears ahead (off the right of the view) and rolls left at you.
  spawnBoulder() {
    const p = this.engine.player;
    this.hazards.push({
      type: 'boulder', x: p.x + VW * 0.75, y: this.groundY - 22,
      w: 22, h: 22, vx: -2.6, vy: 0, rot: 0,
    });
  }

  update(dt) {
    const p = this.engine.player;
    this.runSpawners(p.x);

    // Stream rolling boulders while inside the zone and before the boss.
    if (!this.bossTriggered && p.x > this.boulderZone[0] && p.x < this.boulderZone[1]) {
      if (--this.boulderT <= 0) { this.spawnBoulder(); this.boulderT = randInt(140, 220); }
    }

    // ---- Hazard logic (self-contained, like L1's collapsing platforms) ----
    const pb = p.hitbox();
    for (const h of this.hazards) {
      if (h.type === 'spikes') {
        h.t++;
        h.up = (h.t % h.cycle) > h.cycle * 0.5;
        if (h.up && !p.invulnerable &&
            aabb(pb, { x: h.x, y: h.y, w: h.w, h: h.h })) this.engine.killPlayer();
      } else if (h.type === 'laser') {
        h.t++;
        h.on = (h.t % (h.onFor + h.offFor)) < h.onFor;
        if (h.on && !p.invulnerable &&
            aabb(pb, { x: h.x, y: h.y, w: h.w, h: h.h })) this.engine.killPlayer();
      } else if (h.type === 'boulder') {
        h.x += h.vx; h.rot += 0.2;

        // Solid floor under the boulder's center? (ground platforms only)
        const bx = h.x + h.w / 2;
        const onFloor = this.platforms.some(
          (pf) => pf.y >= this.groundY && bx >= pf.x && bx <= pf.x + pf.w
        );
        if (onFloor) {
          h.vy = 0; h.y = this.groundY - h.h;         // roll along the floor
        } else {
          h.vy = Math.min(h.vy + GRAVITY, MAX_FALL);
          h.y += h.vy;                                // plunge into the chasm!
        }

        if (!p.invulnerable && aabb(pb, { x: h.x, y: h.y, w: h.w, h: h.h })) this.engine.killPlayer();
        if (h.x < this.engine.camera.x - 60 || h.y > VH + 40) h.dead = true;  // off-screen or fell in a pit
      }
    }
    this.hazards = this.hazards.filter((h) => !h.dead);

    // ---- Boss gate ----
    if (!this.bossTriggered && p.x >= this.bossX - 130) {
      this.bossTriggered = true;
      this.boss = new SorceressStratos(this.engine, this.bossX, this.groundY);
      this.engine.boss = this.boss;
      this.engine.banner('BOSS: SORCERESS & STRATOS', 160);
    }
  }

  renderWorld(ctx, cam) {
    // Cavern gradient.
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#0a0618'); g.addColorStop(0.6, PAL.sky2); g.addColorStop(1, '#140a20');
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);

    // Ceiling stalactites (parallax).
    ctx.fillStyle = PAL.stoneD;
    for (let i = 0; i < 40; i++) {
      const sx = i * 90 - cam.x * 0.6;
      if (sx < -20 || sx > VW + 20) continue;
      ctx.beginPath();
      ctx.moveTo(sx, 0); ctx.lineTo(sx + 16, 0); ctx.lineTo(sx + 8, 20 + (i % 3) * 10);
      ctx.closePath(); ctx.fill();
    }

    // Glowing cave crystals along the floor line.
    for (let i = 0; i < 30; i++) {
      const sx = i * 130 - cam.x * 0.8;
      if (sx < -10 || sx > VW + 10) continue;
      ctx.fillStyle = i % 2 ? PAL.purple : PAL.cyan;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(sx, this.groundY - 8, 3, 8);
      ctx.globalAlpha = 1;
    }

    // Floor & ledges.
    drawPlatforms(ctx, cam, this.platforms, PAL.stone, PAL.stoneD);

    // Hazards.
    for (const h of this.hazards) {
      const x = h.x - cam.x, y = h.y - cam.y;
      if (h.type === 'spikes') {
        const sp = h.up ? h.h : 3;
        ctx.fillStyle = h.up ? PAL.steel : PAL.stoneD;
        for (let sx = 0; sx < h.w; sx += 8) {
          ctx.beginPath();
          ctx.moveTo(x + sx, y + h.h);
          ctx.lineTo(x + sx + 4, y + h.h - sp);
          ctx.lineTo(x + sx + 8, y + h.h);
          ctx.closePath(); ctx.fill();
        }
      } else if (h.type === 'laser') {
        // Emitter nubs top & bottom; lethal beam between when on.
        ctx.fillStyle = PAL.blood;
        ctx.fillRect(x - 2, -cam.y, h.w + 4, 6);
        ctx.fillRect(x - 2, h.h - cam.y - 6, h.w + 4, 6);
        if (h.on) {
          ctx.fillStyle = 'rgba(192,57,43,0.85)';
          ctx.fillRect(x, -cam.y, h.w, h.h);
          ctx.fillStyle = PAL.white;
          ctx.fillRect(x + h.w / 2 - 1, -cam.y, 2, h.h);
        } else {
          ctx.strokeStyle = 'rgba(192,57,43,0.28)';
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(x + h.w / 2, -cam.y); ctx.lineTo(x + h.w / 2, h.h - cam.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else if (h.type === 'boulder') {
        const cx = x + h.w / 2, cy = y + h.h / 2, r = h.w / 2;
        ctx.fillStyle = PAL.stone;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = PAL.stoneD; ctx.lineWidth = 2; ctx.stroke();
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(h.rot) * r, cy + Math.sin(h.rot) * r);
        ctx.lineTo(cx - Math.cos(h.rot) * r, cy - Math.sin(h.rot) * r);
        ctx.stroke();
      }
    }
  }
}

/* -------------------------------------------------------------------------
 *  LEVEL 3 — CASTLE GRAYSKULL  (SIDE-SCROLLER: vertical climb + hallway)
 *  Elite guards + homing energy turrets. Boss: He-Man & Battle Cat.
 * ---------------------------------------------------------------------- */
class Level3 extends Level {
  constructor(engine) {
    super(engine, {
      mode: MODE.SIDE, worldW: 2600, worldH: 1400,
      name: 'LEVEL 3', subtitle: 'CASTLE GRAYSKULL',
    });
    this.phase = 'climb';     // 'climb' -> 'hallway'
    this.startX = 60; this.startY = 1330;
    this.groundY = 200;       // used in hallway phase
  }

  build() {
    // ---- CLIMB PHASE: a tall shaft of ledges rising to y=0 ----
    // World is tall (1400). Player climbs from bottom to top.
    // A single jump (vy=-8.2 under GRAVITY=0.45) rises only ~70px, so ledges
    // MUST sit within that reach vertically. The old layout spaced them 120px
    // apart — literally unclimbable. Two rules now govern the shaft:
    //   1. Each hop is ~56px, comfortably inside a jump.
    //   2. The shaft must NOT run up UNDER the solid hallway floor — that slab
    //      is 60px thick (it occupies y[200..260] across x>=60), and you cannot
    //      rise into a solid platform from below without cracking your skull on
    //      its underside. So the zig-zag stops safely beneath the slab and the
    //      climb EXITS up the LEFT wall (x<60, where nothing is overhead),
    //      mounting the hallway floor from its top-left corner.
    this.platforms.push({ x: 0, y: 1370, w: 300, h: 40 });  // start floor
    const gap = 56;
    const bandX = [40, 130];               // 120-wide ledges, alternating
    const N = 19;                          // odd -> top ledge is left-band (x40)
    for (let k = 1; k <= N; k++) {
      this.platforms.push({ x: bandX[(k - 1) % 2], y: 1370 - gap * k, w: 120, h: 10 });
    }
    // Left-wall exit ledge (x<60, clear of the overhang): the player hops onto
    // it from the top zig-zag ledge, then leaps up-and-right to mount the
    // hallway floor's top-left corner as they arc over its edge.
    this.platforms.push({ x: 0, y: 250, w: 60, h: 10 });
    // Hallway floor stretches far to the right along the top of the shaft.
    this.platforms.push({ x: 60, y: this.groundY, w: 2540, h: 60 });

    this.checkpoints = [60, 400, 800, 1400, 2000];

    // ---- Homing energy turrets on the climb ----
    // Stop at py>400 so the topmost turret (would-be py=280) is omitted: it sat
    // right where the player mounts the hallway floor and only cluttered the
    // transition. Turrets now flank py = 1240, 1000, 760, 520.
    let ci = 0;
    for (let py = 1240; py > 400; py -= 240) {
      const side = (ci++ % 2 === 0) ? 20 : 260;
      const cx = side, cy = py;
      this.spawners.push({
        atX: 0, // climb spawners trigger by height instead; see update()
        atY: cy + 120, done: false, byHeight: true,
        make: () => {
          this.engine.enemies.push(new Enemy(cx, cy, {
            w: 16, h: 16, hp: 3, behavior: 'homing-turret', color: PAL.purple,
            fireT: randInt(50, 100),
          }));
        },
      });
    }

    // ---- Hallway elite guards (x-triggered, appear after climb) ----
    const elite = (x, drop = null) => ({
      atX: x - 160, done: false, hallOnly: true, make: () => {
        const e = new Enemy(x, this.groundY - 22, {
          w: 18, h: 22, hp: 4, behavior: 'elite', color: PAL.steel, vx: -1.0,
        });
        e.drop = drop; this.engine.enemies.push(e);
      },
    });
    this.spawners.push(
      elite(400), elite(700, WEAPON.LASER), elite(1000),
      elite(1350, WEAPON.BARRIER), elite(1700), elite(2000, WEAPON.FLAME)
    );

    this.hallStartX = 200;   // where the hallway begins (top-left landing)
    this.bossX = 2450;
  }

  update(dt) {
    const p = this.engine.player;

    // Height-based spawners for the climb (trigger when player rises past them).
    for (const s of this.spawners) {
      if (s.done) continue;
      if (s.byHeight) {
        // Climb turrets are a climb-phase threat only — never spawn them once
        // the fight has moved to the hallway (where a low p.y would trip them).
        if (this.phase === 'climb' && p.y <= s.atY) { s.done = true; s.make(); }
      } else if (this.phase === 'hallway') {
        if (p.x >= s.atX) { s.done = true; s.make(); }
      }
    }

    // Transition from climb to hallway once the player reaches the top landing.
    if (this.phase === 'climb' && p.y <= 200 && p.x < 120) {
      this.phase = 'hallway';
      // The climb is behind us: purge its floating turrets and their homing
      // bolts so they can't snipe the hallway boss fight from off-screen below.
      this.engine.enemies = this.engine.enemies.filter((e) => e.behavior !== 'homing-turret');
      this.engine.enemyShots = this.engine.enemyShots.filter((s) => !s.homing);
      this.engine.banner('THE FINAL HALLWAY', 130);
    }

    // Boss gate at the end of the hallway.
    if (this.phase === 'hallway' && !this.bossTriggered && p.x >= this.bossX - 140) {
      this.bossTriggered = true;
      this.boss = new HeManBattleCat(this.engine, this.bossX, this.groundY);
      this.engine.boss = this.boss;
      this.engine.banner('FINAL BOSS: HE-MAN & BATTLE CAT', 170);
    }
  }

  renderWorld(ctx, cam) {
    // Grayskull interior — cold stone and torchlight.
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#0c0a14'); g.addColorStop(1, '#1c1826');
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);

    // Distant brick pattern parallax.
    ctx.fillStyle = 'rgba(74,74,90,0.25)';
    for (let by = 0; by < VH + 40; by += 24) {
      for (let bx = 0; bx < VW + 40; bx += 40) {
        const ox = ((by / 24) % 2) * 20;
        const rx = ((bx + ox - cam.x * 0.3) % (VW + 40) + (VW + 40)) % (VW + 40);
        ctx.fillRect(rx, by - (cam.y * 0.3) % 24, 36, 20);
      }
    }

    drawPlatforms(ctx, cam, this.platforms, PAL.stone, PAL.stoneD);

    // Torches on some platforms for that final-gauntlet dread.
    for (const plat of this.platforms) {
      if (plat.w < 90) continue;
      const sx = plat.x - cam.x + 8, sy = plat.y - cam.y;
      if (sx < -10 || sx > VW + 10) continue;
      ctx.fillStyle = PAL.ember;
      ctx.beginPath(); ctx.arc(sx, sy - 6, 3 + Math.sin(this.engine.frame * 0.3 + plat.x) * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
