/* ============================================================================
 *  SKELETOR'S CONQUEST — BOOTSTRAP
 *  Seize the throne — instantiate the engine on load.
 * ========================================================================== */

'use strict';

/* ============================================================================
 * [10] BOOTSTRAP — seize the throne.
 * ========================================================================== */

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('screen');
  const engine = new GameEngine(canvas);
  engine.start();
  // Expose for tinkering from the console, my minion.
  window.SKELETOR = engine;
});
