/* ============================================================================
 *  SKELETOR'S CONQUEST — CONFIG & CONSTANTS
 *  Resolution, physics, enums, and the sharp retro palette.
 * ========================================================================== */

'use strict';

/* ============================================================================
 * [0] CONFIG & CONSTANTS
 * ========================================================================== */

// VW is ADAPTIVE: the engine reshapes it at runtime to match the viewport's
// aspect ratio (see GameEngine._applyViewport), so the canvas fills any screen
// edge-to-edge with no letterbox and no distortion. VH stays fixed so the
// vertical scale — jump heights, level layouts — never shifts. 426 is the
// 16:9 default used before a real viewport is measured (and under the tests).
let VW = 426;     // virtual canvas width  (adaptive; 16:9 default)
const VH = 240;   // virtual canvas height (fixed)
const GRAVITY = 0.45;
const MAX_FALL = 8;
const GROUND_FRICTION = 0.75;

// Jump forgiveness. JUMP_BUFFER: frames a jump press is remembered so a tap
// made just BEFORE landing still fires on touchdown. COYOTE_TIME: frames after
// walking off a ledge you may still jump. Both exist because fingertip timing
// on a touchscreen is as sloppy as Beast Man — the edge alone drops taps.
const JUMP_BUFFER = 6;
const COYOTE_TIME = 6;

// Centralized state-machine states.
const STATE = {
  MENU: 'MENU',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  LEVEL_TRANSITION: 'LEVEL_TRANSITION',
  GAME_OVER: 'GAME_OVER',
  VICTORY: 'VICTORY',
};

// Active power-up types.
const WEAPON = {
  DEFAULT: 'DEFAULT',
  SPREAD: 'SPREAD',
  LASER: 'LASER',
  FLAME: 'FLAME',
  BARRIER: 'BARRIER',
};

// Perspective modes drive how movement, camera & collision behave.
const MODE = { SIDE: 'SIDE', DEPTH: 'DEPTH' };

// Sharp retro palette — the colors of villainy.
const PAL = {
  black:  '#05060a',
  bone:   '#e9e4d0',   // Skeletor's skull
  boneSh: '#b8b199',
  hood:   '#3a6ea5',   // his blue cowl
  hoodDk: '#26507d',
  purple: '#7d4bd6',
  purpleDk:'#4a2a86',
  havoc:  '#ffd23f',   // Havoc Staff energy / pickups
  blood:  '#c0392b',
  ember:  '#ff7b2e',
  toxic:  '#5bd94f',
  sky1:   '#1a1030',
  sky2:   '#3a1f4d',
  jungle: '#123a1f',
  jungleD:'#0a2413',
  stone:  '#4a4a5a',
  stoneD: '#2b2b38',
  steel:  '#8a94a6',
  white:  '#ffffff',
  cyan:   '#4bd6d6',
  hero:   '#f2c14e',   // He-Man tan/gold
  // Extra character tones for the detailed sprites.
  skin:   '#e8b98f',   // flesh (He-Man, Teela, Man-At-Arms)
  skinSh: '#c8945f',   // flesh shadow
  hair:   '#f4d35e',   // He-Man's blond
  fur:    '#e08a2e',   // Battle Cat's orange
  furDk:  '#a85e18',   // Battle Cat stripes / shadow
  teela:  '#e86a2e',   // Teela's copper hair
  brown:  '#7a4a24',   // Man-At-Arms moustache / straps
  gray:   '#c7ccd6',   // light metal highlight
};
