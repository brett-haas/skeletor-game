/* ============================================================================
 *  SKELETOR'S CONQUEST — MATH / UTILITY + SHARED DRAW HELPERS
 *  clamp/lerp/aabb and procedural sprite drawing.
 * ========================================================================== */

'use strict';

/* ============================================================================
 * [1] MATH / UTILITY
 * ========================================================================== */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};

// Axis-Aligned Bounding Box overlap test — the backbone of SIDE collision.
function aabb(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/* ============================================================================
 *  SHARED RENDER HELPERS
 * ========================================================================== */

function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

// Soft contact shadow beneath a character (screen coords) — grounds the sprite.
function drawShadow(ctx, cx, groundY, w) {
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = PAL.black;
  ctx.beginPath();
  ctx.ellipse(cx, groundY, w * 0.5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlatforms(ctx, cam, platforms, top, side) {
  for (const plat of platforms) {
    if (plat.gone) continue;
    const sx = Math.floor(plat.x - cam.x);
    const sy = Math.floor(plat.y - cam.y);
    if (sx > VW || sx + plat.w < 0 || sy > VH || sy + plat.h < 0) continue;
    ctx.fillStyle = side; ctx.fillRect(sx, sy, plat.w, plat.h);
    ctx.fillStyle = top;  ctx.fillRect(sx, sy, plat.w, Math.min(6, plat.h));
    if (plat.collapsing) {
      ctx.fillStyle = PAL.blood;
      ctx.fillRect(sx + 2, sy + 2, 3, 3);
    }
  }
}

// Draw Skeletor himself (procedural sprite) at screen coords.
function drawSkeletor(ctx, sx, sy, w, h, facing, weapon, aim, invuln) {
  ctx.save();
  // Flicker while invulnerable.
  if (invuln && (Math.floor(performance.now() / 60) % 2 === 0)) ctx.globalAlpha = 0.45;

  // Pixel helper: fill an axis-aligned block in sprite-local coords.
  const R = (x, y, ww, hh, c) => { ctx.fillStyle = c; ctx.fillRect(sx + x, sy + y, ww, hh); };
  const midX = sx + w / 2;

  // ---- Purple hood: a rounded dome framing the face, draping to the shoulders ----
  R(5, 0, 4, 1, PAL.purple);          // rounded crown
  R(4, 1, 6, 1, PAL.purple);
  R(3, 2, 8, 1, PAL.purple);
  R(2, 3, 10, 1, PAL.purple);         // brow band
  R(2, 4, 2, 6, PAL.purple);          // left cheek frame
  R(10, 4, 2, 6, PAL.purple);         // right cheek frame
  R(0, 10, 14, 2, PAL.purple);        // shoulder drape
  R(5, 0, 4, 1, PAL.purpleDk);        // crown top cap (dark)
  R(4, 1, 2, 1, PAL.purpleDk);        // dome upper-left shadow
  R(2, 3, 1, 7, PAL.purpleDk);        // left frame shadow
  R(2, 10, 3, 2, PAL.purpleDk);       // drape left shadow
  R(4, 1, 5, 1, PAL.purpleHi);        // top-lit dome gleam
  R(11, 4, 1, 6, PAL.purpleHi);       // right frame gleam
  R(0, 10, 14, 1, PAL.purpleHi);      // collar top gleam
  R(0, 11, 14, 1, PAL.purpleDk);      // collar trim

  // ---- Yellow bare-bone skull inset in the hood (lit from the right) ----
  R(4, 4, 6, 6, PAL.skull);
  R(4, 4, 1, 6, PAL.skullSh);         // left cheek shadow
  R(4, 4, 6, 1, PAL.skullSh);         // brow ridge
  R(8, 5, 1, 4, PAL.skullHi);         // lit cheekbone highlight
  // Hollow eye sockets with an angry outer slant (dark — pure Filmation).
  R(4, 5, 2, 2, PAL.black);
  R(8, 5, 2, 2, PAL.black);
  R(4, 5, 1, 1, PAL.skullSh);         // outer brow slant (left)
  R(9, 5, 1, 1, PAL.skullSh);         // outer brow slant (right)
  // Nasal cavity and a grinning row of teeth.
  R(6, 7, 2, 1, PAL.black);
  R(4, 8, 6, 1, PAL.skull);           // teeth band
  R(5, 8, 1, 1, PAL.black);           // tooth gaps
  R(7, 8, 1, 1, PAL.black);
  R(9, 8, 1, 1, PAL.black);
  R(4, 9, 6, 1, PAL.skullSh);         // jaw shadow

  // ---- Blue muscular torso with a gray armor breastplate ----
  R(2, 12, 10, 4, PAL.demonBlue);     // bare blue chest / shoulders
  R(4, 12, 6, 4, PAL.steel);          // gray breastplate
  R(4, 12, 1, 4, PAL.steelDk);        // plate shadow
  R(9, 12, 1, 4, PAL.gray);           // plate highlight
  R(4, 12, 6, 1, PAL.gray);           // collar gleam
  R(6, 13, 2, 2, PAL.steelDk);        // central rib groove

  // ---- Blue arms with gray bracers ----
  R(0, 12, 2, 5, PAL.demonBlue);      // left arm
  R(12, 12, 2, 5, PAL.demonBlue);     // right arm
  R(0, 12, 1, 5, facing < 0 ? PAL.demonBlueHi : PAL.demonBlueSh);   // lit/shade flips with facing
  R(13, 12, 1, 5, facing < 0 ? PAL.demonBlueSh : PAL.demonBlueHi);
  R(0, 15, 2, 2, PAL.steel);          // left bracer
  R(12, 15, 2, 2, PAL.steel);         // right bracer

  // ---- Purple loincloth with a central flap ----
  R(4, 16, 6, 3, PAL.purple);
  R(6, 16, 2, 3, PAL.purpleDk);       // central flap crease
  R(facing < 0 ? 4 : 9, 16, 1, 3, PAL.purpleHi);  // lit-side highlight streak
  R(facing < 0 ? 9 : 4, 16, 1, 3, PAL.purpleDk);  // shaded side

  // ---- Blue legs and purple boots ----
  R(4, 19, 2, 2, PAL.demonBlue);      // left thigh
  R(8, 19, 2, 2, PAL.demonBlue);      // right thigh
  R(4, 19, 1, 2, PAL.demonBlueSh);
  R(9, 19, 1, 2, PAL.demonBlueHi);
  R(3, 20, 3, 2, PAL.purple);         // left boot
  R(8, 20, 3, 2, PAL.purple);         // right boot
  R(3, 20, 1, 2, PAL.purpleDk);
  R(10, 20, 1, 2, PAL.purpleHi);

  // ---- Havoc Staff aimed along the fire vector ----
  const handX = midX + facing * 2, handY = sy + 14;
  const len = 13;
  const ex = handX + aim.x * len, ey = handY + aim.y * len;
  // Shaft.
  ctx.lineCap = 'round';
  ctx.strokeStyle = PAL.brown; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(handX, handY); ctx.lineTo(ex, ey); ctx.stroke();
  // Ram-skull head of the staff.
  ctx.fillStyle = PAL.bone;
  ctx.beginPath(); ctx.arc(ex, ey, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = PAL.boneSh; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(ex - 2.5, ey - 1, 2.4, Math.PI * 0.2, Math.PI * 1.1); ctx.stroke(); // horn
  ctx.beginPath(); ctx.arc(ex + 2.5, ey - 1, 2.4, -Math.PI * 0.1, Math.PI * 0.8); ctx.stroke();
  // Glowing orb — tinted by the active weapon.
  const orbColor = {
    [WEAPON.DEFAULT]: PAL.havoc, [WEAPON.SPREAD]: PAL.toxic,
    [WEAPON.LASER]: PAL.purple, [WEAPON.FLAME]: PAL.ember,
    [WEAPON.BARRIER]: PAL.cyan,
  }[weapon] || PAL.havoc;
  // Soft radiant halo behind the orb, then the bright core.
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = orbColor;
  ctx.beginPath(); ctx.arc(ex, ey, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = orbColor;
  ctx.beginPath(); ctx.arc(ex, ey, 1.5, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}
