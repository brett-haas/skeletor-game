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

  // ---- Blue cowl: a pointed crown framing the face, draping to the shoulders ----
  R(6, 0, 2, 2, PAL.hoodDk);          // peak tip
  R(5, 1, 4, 1, PAL.hoodDk);
  R(3, 2, 8, 2, PAL.hoodDk);          // upper dome (dark)
  R(2, 3, 10, 3, PAL.hood);           // cowl brow
  R(2, 3, 10, 1, PAL.hoodHi);         // top-lit cowl gleam
  R(1, 5, 2, 6, PAL.hood);            // left cheek frame
  R(11, 5, 2, 6, PAL.hood);           // right cheek frame
  R(1, 5, 1, 6, PAL.hoodDk);          // left frame shadow
  R(12, 5, 1, 6, PAL.hoodHi);         // right frame gleam
  R(0, 11, 14, 3, PAL.hood);          // shoulder drape
  R(0, 11, 14, 1, PAL.hoodHi);        // collar top gleam
  R(0, 13, 14, 1, PAL.hoodDk);        // collar trim

  // ---- Skull face inset in the cowl (warm bone, lit from the right) ----
  R(3, 4, 8, 7, PAL.skull);
  R(3, 4, 2, 7, PAL.skullSh);         // left cheek shadow
  R(3, 4, 8, 1, PAL.skullSh);         // brow ridge
  R(9, 5, 1, 5, PAL.skullHi);         // lit cheekbone highlight
  R(6, 4, 3, 1, PAL.skullHi);         // brow sheen
  // Hollow eye sockets with a burning ember glow.
  R(4, 6, 2, 2, PAL.black);
  R(8, 6, 2, 2, PAL.black);
  R(5, 6, 1, 2, PAL.havoc);           // glowing inner slit
  R(8, 6, 1, 2, PAL.havoc);
  R(5, 7, 1, 1, PAL.ember);           // hotter ember core
  R(8, 7, 1, 1, PAL.ember);
  // Nasal cavity.
  R(6, 8, 2, 2, PAL.black);
  // Grinning teeth.
  R(4, 10, 6, 1, PAL.skullSh);        // jaw line
  R(5, 10, 1, 2, PAL.black);
  R(7, 10, 1, 2, PAL.black);
  R(9, 10, 1, 2, PAL.black);

  // ---- Purple robe with shading, a central fold, and a gold gorget clasp ----
  R(1, 13, 12, 9, PAL.purple);
  R(1, 13, 3, 9, PAL.purpleDk);       // left-side shadow
  R(6, 14, 2, 8, PAL.purpleDk);       // fold crease
  R(10, 13, 3, 9, PAL.purpleDk);      // right-side shadow
  R(facing < 0 ? 3 : 8, 14, 2, 7, PAL.purpleHi);  // lit-side highlight streak
  R(5, 13, 4, 2, PAL.havoc);          // gold gorget clasp at the throat
  R(6, 13, 2, 1, PAL.ember);          // clasp gleam
  R(0, 20, 14, 2, PAL.purpleDk);      // flared hem shadow
  R(2, 21, 3, 1, PAL.purple);         // hem folds
  R(9, 21, 3, 1, PAL.purple);
  // Bony hands peeking from the robe.
  R(0, 15, 2, 3, PAL.bone);
  R(12, 15, 2, 3, PAL.bone);

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
