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

  // ---- Purple robe body (with shading + a central cloak fold) ----
  R(1, 11, 12, 11, PAL.purple);
  R(1, 11, 3, 11, PAL.purpleDk);      // left-side shadow
  R(6, 12, 2, 10, PAL.purpleDk);      // fold crease
  R(11, 11, 2, 11, PAL.purpleDk);     // right-side shadow
  // Lit-side highlight streak + top-shoulder sheen (light from the facing side).
  R(facing < 0 ? 3 : 8, 12, 2, 9, PAL.purpleHi);
  R(4, 11, 6, 1, PAL.purpleHi);
  // Bony hands peeking from the robe.
  R(0, 13, 2, 3, PAL.bone);
  R(12, 13, 2, 3, PAL.bone);

  // ---- Blue hood/cowl framing the face ----
  R(5, 0, 4, 2, PAL.hoodDk);          // pointed crown
  R(1, 1, 12, 4, PAL.hoodDk);         // hood top (dark)
  R(0, 3, 14, 8, PAL.hood);           // hood sides
  R(1, 3, 12, 1, PAL.hoodHi);         // top-lit cowl gleam
  R(0, 10, 14, 3, PAL.hood);          // shoulders / collar drape
  R(0, 12, 14, 1, PAL.hoodDk);        // collar trim

  // ---- Skull face inset in the hood ----
  R(3, 3, 8, 8, PAL.bone);
  R(3, 3, 2, 8, PAL.boneSh);          // left cheek shadow
  R(3, 3, 8, 1, PAL.boneSh);          // brow ridge
  R(9, 4, 1, 6, PAL.boneHi);          // lit cheekbone highlight
  R(6, 4, 3, 1, PAL.boneHi);          // brow sheen
  // Hollow eye sockets with a burning ember glow.
  R(4, 5, 2, 2, PAL.black);
  R(8, 5, 2, 2, PAL.black);
  R(5, 5, 1, 2, PAL.havoc);           // glowing inner slit
  R(8, 5, 1, 2, PAL.havoc);
  R(5, 6, 1, 1, PAL.ember);           // hotter ember core
  R(8, 6, 1, 1, PAL.ember);
  // Nasal cavity.
  R(6, 7, 2, 2, PAL.black);
  // Grinning teeth.
  R(4, 9, 6, 1, PAL.boneSh);
  R(5, 9, 1, 2, PAL.black);
  R(7, 9, 1, 2, PAL.black);
  R(9, 9, 1, 2, PAL.black);

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
