/* ============================================================================
 *  SKELETOR'S CONQUEST — CAMERA + DEPTH PROJECTOR
 *  2D follow-camera (SIDE) and pseudo-3D projection (DEPTH).
 * ========================================================================== */

'use strict';

/* ============================================================================
 * [3] CAMERA — 2D tracking for SIDE-scrolling levels (L1, L3).
 *   Supports both horizontal and vertical follow with hard clamping.
 * ========================================================================== */

class Camera {
  constructor(worldW, worldH) {
    this.x = 0;
    this.y = 0;
    this.worldW = worldW;
    this.worldH = worldH;
    this.smooth = 0.15;
  }

  // Follow a target, biasing it toward the left-third for run-and-gun sight.
  follow(target, opts = {}) {
    const anchorX = opts.anchorX !== undefined ? opts.anchorX : VW * 0.4;
    const anchorY = opts.anchorY !== undefined ? opts.anchorY : VH * 0.55;
    const tx = target.x + target.w / 2 - anchorX;
    const ty = target.y + target.h / 2 - anchorY;

    if (opts.hard) {
      this.x = tx; this.y = ty;
    } else {
      this.x = lerp(this.x, tx, this.smooth);
      this.y = lerp(this.y, ty, opts.followY ? this.smooth : 0);
    }
    // Hard clamp to world bounds.
    this.x = clamp(this.x, 0, Math.max(0, this.worldW - VW));
    this.y = opts.followY ? clamp(this.y, 0, Math.max(0, this.worldH - VH)) : 0;
  }
}

/* ============================================================================
 * [4] DEPTH PROJECTOR — pseudo-3D scaling for the "behind-the-back" corridor.
 *   z = 0 far (horizon)  ->  z = 1 near (player plane at bottom).
 *   Projects a world lane-x (-1..1) + z into screen coords + scale.
 * ========================================================================== */

class DepthProjector {
  constructor() {
    this.horizonY = VH * 0.30;   // vanishing region
    this.floorY   = VH * 0.92;   // near floor at player's feet
    this.laneSpan = VW * 0.46;   // half-width of corridor at the near plane
  }

  // z in [0,1]; laneX in [-1,1]. Returns {sx, sy, scale}.
  project(laneX, z) {
    const zz = clamp(z, 0, 1);
    // Perspective easing so far objects cluster near the horizon.
    const t = zz * zz;                       // quadratic depth curve
    const sy = lerp(this.horizonY, this.floorY, t);
    const scale = lerp(0.12, 1.0, t);
    const halfW = lerp(VW * 0.06, this.laneSpan, t);
    const sx = VW / 2 + laneX * halfW;
    return { sx, sy, scale };
  }
}
