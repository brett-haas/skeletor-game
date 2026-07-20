/* ============================================================================
 *  SKELETOR'S CONQUEST — SOUND ENGINE
 *  Procedural Web Audio: chiptune SFX + a looping tracker for background music.
 *  No asset files — every bleep and every march is SYNTHESIZED from oscillators
 *  and noise, worthy of Eternia's 8-bit age. HEHEHEHEHE!
 * ========================================================================== */

'use strict';

/* ============================================================================
 * [1b] SOUND ENGINE
 *
 *   HEADLESS GUARD: the test harness runs this under Node with a stubbed
 *   `window` that has no AudioContext. When none is found, `enabled` stays
 *   false and EVERY public method returns at once — so the SFX.*() calls
 *   sprinkled through the engine are harmless no-ops and the suite stays green.
 *   In a real browser the context is created LAZILY on the first user gesture
 *   (resume()), because the craven autoplay policy forbids sound before one.
 * ========================================================================== */

class SoundEngine {
  constructor() {
    const AC = (typeof window !== 'undefined')
      && (window.AudioContext || window.webkitAudioContext);
    this._AC = AC || null;
    this.enabled = !!AC;      // false under the Node harness -> total no-op
    this.ctx = null;          // lazily built in resume() (autoplay policy)
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;

    // Mute persists across reloads so a minion who craves SILENCE keeps it.
    this.muted = false;
    try {
      if (typeof localStorage !== 'undefined') {
        this.muted = localStorage.getItem('skeletor.muted') === '1';
      }
    } catch (_) { /* private-mode paranoia — no matter */ }

    // Music scheduler state (the looping chiptune march).
    this._music = null;       // { name, bpm, channels:[...], timer }
    this._musicName = null;   // currently-playing track name (dedup switches)
    this._ducked = false;
  }

  /* ---- Bring the context to life on the first user gesture ---- */
  resume() {
    if (!this.enabled) return;
    if (!this.ctx) {
      try {
        this.ctx = new this._AC();
      } catch (_) { this.enabled = false; return; }
      // master -> destination; sfx & music each get their own sub-bus so music
      // can be DUCKED (paused screen) without touching the SFX volume.
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.24;   // music LURKS faint beneath the carnage
      this.musicBus.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /* ---- Mute controls ---- */
  toggleMute() { this.setMuted(!this.muted); }
  setMuted(m) {
    this.muted = !!m;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('skeletor.muted', this.muted ? '1' : '0');
      }
    } catch (_) { /* no matter */ }
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.9;
  }

  /* ========================================================================
   * LOW-LEVEL SYNTH HELPERS
   * ==================================================================== */

  // Equal-temperament note-name -> frequency ('A4', 'C#5', 'Eb3', 'r'=rest).
  _freq(note) {
    if (!note || note === 'r' || note === '-') return 0;
    const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(note);
    if (!m) return 0;
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
    const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    const midi = base + acc + (parseInt(m[3], 10) + 1) * 12;   // MIDI number
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // A single tone with a fast attack + exponential decay. `slideTo` ramps the
  // pitch for zaps/slides. `when` lets callers sequence notes (stings/music).
  _blip({ freq, dur = 0.12, type = 'square', vol = 0.4, slideTo = null,
          bus = null, when = 0 }) {
    if (!this.ctx || !freq) return;
    const t0 = when || this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);        // snappy attack
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);        // decay to silence
    osc.connect(g).connect(bus || this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // A burst of filtered white noise — hits, kills, explosions, drums.
  _noise({ dur = 0.12, vol = 0.4, bandpass = 1200, q = 0.8, bus = null, when = 0 }) {
    if (!this.ctx) return;
    const t0 = when || this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = bandpass; bp.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(bus || this.sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // Play an ordered run of notes back-to-back (fanfares / stings).
  _sequence(notes, { type = 'square', vol = 0.4, bus = null, gap = 0 } = {}) {
    if (!this.ctx) return;
    let t = this.ctx.currentTime;
    for (const [note, dur] of notes) {
      const f = this._freq(note);
      if (f) this._blip({ freq: f, dur, type, vol, bus, when: t });
      t += dur + gap;
    }
  }

  /* ========================================================================
   * PUBLIC SOUND EFFECTS — one short, punchy sound per game event.
   * ==================================================================== */

  fire(weapon) {
    if (!this.enabled) return; this.resume(); if (!this.ctx) return;
    switch (weapon) {
      case 'SPREAD': // chk-chk — a scatter of quick bright chirps
        this._blip({ freq: 720, dur: 0.06, type: 'square', vol: 0.22, slideTo: 500 });
        this._noise({ dur: 0.05, vol: 0.12, bandpass: 2600 });
        break;
      case 'LASER': // zap — a rising energy sweep
        this._blip({ freq: 220, dur: 0.22, type: 'sawtooth', vol: 0.28, slideTo: 900 });
        break;
      case 'FLAME': // whoosh — low airy noise
        this._noise({ dur: 0.09, vol: 0.16, bandpass: 700, q: 0.5 });
        break;
      default: // BONE BOLT — a classic descending pew
        this._blip({ freq: 880, dur: 0.09, type: 'square', vol: 0.25, slideTo: 300 });
    }
  }

  jump() {
    if (!this.enabled) return; this.resume(); if (!this.ctx) return;
    this._blip({ freq: 300, dur: 0.14, type: 'square', vol: 0.28, slideTo: 620 });
  }

  hit() {
    if (!this.enabled) return; this.resume(); if (!this.ctx) return;
    this._noise({ dur: 0.05, vol: 0.18, bandpass: 1800, q: 1.2 });
  }

  enemyKill() {
    if (!this.enabled) return; this.resume(); if (!this.ctx) return;
    this._noise({ dur: 0.18, vol: 0.32, bandpass: 900, q: 0.6 });
    this._blip({ freq: 240, dur: 0.16, type: 'square', vol: 0.16, slideTo: 90 });
  }

  bossHit() {
    if (!this.enabled) return; this.resume(); if (!this.ctx) return;
    this._blip({ freq: 160, dur: 0.07, type: 'square', vol: 0.22, slideTo: 110 });
    this._noise({ dur: 0.04, vol: 0.12, bandpass: 2200, q: 1.5 });
  }

  powerup() {
    if (!this.enabled) return; this.resume(); if (!this.ctx) return;
    this._sequence([['E5', 0.08], ['G5', 0.08], ['B5', 0.08], ['E6', 0.16]],
      { type: 'square', vol: 0.3 });
  }

  playerDeath() {
    if (!this.enabled) return; this.resume(); if (!this.ctx) return;
    this._blip({ freq: 400, dur: 0.5, type: 'sawtooth', vol: 0.32, slideTo: 60 });
    this._noise({ dur: 0.4, vol: 0.16, bandpass: 500, q: 0.4 });
  }

  menuSelect() {
    if (!this.enabled) return; this.resume(); if (!this.ctx) return;
    this._sequence([['C5', 0.08], ['G5', 0.14]], { type: 'square', vol: 0.32 });
  }

  bossDefeat() {
    if (!this.enabled) return; this.resume(); if (!this.ctx) return;
    this._sequence([['C5', 0.12], ['E5', 0.12], ['G5', 0.12], ['C6', 0.28]],
      { type: 'square', vol: 0.34 });
    this._noise({ dur: 0.5, vol: 0.14, bandpass: 800, q: 0.4, when: this.ctx.currentTime });
  }

  levelClear() {
    if (!this.enabled) return; this.resume(); if (!this.ctx) return;
    this._sequence([['G4', 0.1], ['C5', 0.1], ['E5', 0.2]], { type: 'square', vol: 0.32 });
  }

  victoryJingle() {
    if (!this.enabled) return; this.resume(); if (!this.ctx) return;
    this._sequence(
      [['C5', 0.16], ['E5', 0.16], ['G5', 0.16], ['C6', 0.16], ['G5', 0.16], ['C6', 0.5]],
      { type: 'square', vol: 0.34 });
  }

  gameOverJingle() {
    if (!this.enabled) return; this.resume(); if (!this.ctx) return;
    this._sequence([['A4', 0.22], ['F4', 0.22], ['D4', 0.22], ['A3', 0.6]],
      { type: 'sawtooth', vol: 0.3 });
  }

  /* ========================================================================
   * BACKGROUND MUSIC — a lookahead tracker.
   *   The classic "two clocks": a coarse setInterval wakes us ~every 40ms and
   *   we SCHEDULE any notes whose start time falls inside a short horizon
   *   against the AudioContext's sample-accurate clock. Frame hitches never
   *   smear the beat. Each channel loops on its own running cursor.
   * ==================================================================== */

  playMusic(name) {
    if (!this.enabled) return; this.resume(); if (!this.ctx) return;
    if (this._musicName === name && this._music) { this.duckMusic(false); return; }
    this.stopMusic();
    const track = SoundEngine.TRACKS[name];
    if (!track) return;
    this._musicName = name;
    const beat = 60 / track.bpm;
    const start = this.ctx.currentTime + 0.06;
    this._music = {
      name,
      beat,
      channels: track.channels.map((ch) => ({
        events: ch.events, voice: ch.voice, idx: 0, nextTime: start,
      })),
      timer: setInterval(() => this._scheduleMusic(), 40),
    };
    this.duckMusic(false);
    this._scheduleMusic();   // prime the pump immediately
  }

  _scheduleMusic() {
    const m = this._music;
    if (!m || !this.ctx) return;
    const now = this.ctx.currentTime;
    const horizon = now + 0.2;
    for (const ch of m.channels) {
      // Catch-up clamp: a backgrounded tab throttles setInterval to ~1s+ while
      // the AudioContext clock keeps advancing, so on refocus ch.nextTime can be
      // seconds behind `now`. Without this, the loop below would dump every
      // missed note at once (Web Audio fires past-timed notes immediately) — a
      // jarring cluster and a CPU spike. Resync to the clock and march on.
      if (ch.nextTime < now) ch.nextTime = now;
      while (ch.nextTime < horizon) {
        const [note, beats] = ch.events[ch.idx];
        const dur = beats * m.beat;
        this._playVoice(ch.voice, note, ch.nextTime, dur);
        ch.nextTime += dur;
        ch.idx = (ch.idx + 1) % ch.events.length;   // loop this channel
      }
    }
  }

  _playVoice(voice, note, when, dur) {
    if (note === 'r' || note === '-') return;   // rest
    if (voice === 'drum') {
      // Percussion tokens: 'x' kick-ish thud, 'h' hat-ish tick.
      if (note === 'h') this._noise({ dur: 0.03, vol: 0.10, bandpass: 6000, q: 1, bus: this.musicBus, when });
      else this._noise({ dur: 0.09, vol: 0.20, bandpass: 180, q: 0.6, bus: this.musicBus, when });
      return;
    }
    const freq = this._freq(note);
    if (!freq) return;
    // Voices: `lead` sings the melody (bright pulse); `harmony` shimmers the
    // arpeggiated broken chords that give the fantasy sheen (soft triangle);
    // `bass` grounds the root (warm triangle).
    let cfg;
    if (voice === 'bass') cfg = { type: 'triangle', vol: 0.34 };
    else if (voice === 'harmony') cfg = { type: 'triangle', vol: 0.11 };
    else cfg = { type: 'square', vol: 0.17 };
    // Slightly clipped note length so repeated notes retrigger cleanly.
    this._blip({ freq, dur: Math.max(0.05, dur * 0.9), type: cfg.type, vol: cfg.vol, bus: this.musicBus, when });
  }

  stopMusic() {
    if (this._music && this._music.timer) clearInterval(this._music.timer);
    this._music = null;
    this._musicName = null;
    // Scheduled tails are short and simply ring out — no abrupt click.
  }

  duckMusic(on) {
    this._ducked = !!on;
    if (this.musicBus && this.ctx) {
      const t = this.ctx.currentTime;
      this.musicBus.gain.cancelScheduledValues(t);
      this.musicBus.gain.linearRampToValueAtTime(on ? 0.06 : 0.24, t + 0.15);
    }
  }
}

/* ============================================================================
 * TRACK DATA — compact chiptune loops. Each channel is an array of
 * [noteName|'r', beats] events; `lead`/`bass` are pitched, `drum` uses tokens.
 * ========================================================================== */
SoundEngine.TRACKS = {
  // Title screen — a SINISTER theme in A harmonic minor over the villain's
  // progression i–bII–V–i (Am – Bb Neapolitan – E7 – Am). Chromatic neighbor
  // tones stalk the melody; the bar-3 arpeggio is a full G#-diminished-seventh
  // — the pure sound of a lurking evil. HEHEHEHEHE!
  menu: {
    bpm: 96,
    channels: [
      { voice: 'lead', events: [
        ['A4', 1], ['Bb4', 1], ['A4', 1], ['G#4', 1],    // Am — creeping semitones
        ['F5', 1], ['E5', 1], ['Bb4', 2],                // drop to the Neapolitan (dread)
        ['G#4', 1], ['B4', 1], ['D5', 1], ['F5', 1],     // rising G#dim7 tension
        ['E5', 2], ['A4', 2] ] },                        // resolve to the tonic
      { voice: 'harmony', events: [
        ['A3', 0.5], ['C4', 0.5], ['E4', 0.5], ['C4', 0.5], ['A3', 0.5], ['C4', 0.5], ['E4', 0.5], ['C4', 0.5],
        ['Bb3', 0.5], ['D4', 0.5], ['F4', 0.5], ['D4', 0.5], ['Bb3', 0.5], ['D4', 0.5], ['F4', 0.5], ['D4', 0.5],
        ['G#3', 0.5], ['B3', 0.5], ['D4', 0.5], ['F4', 0.5], ['G#3', 0.5], ['B3', 0.5], ['D4', 0.5], ['F4', 0.5],
        ['A3', 0.5], ['C4', 0.5], ['E4', 0.5], ['C4', 0.5], ['A3', 0.5], ['C4', 0.5], ['E4', 0.5], ['C4', 0.5] ] },
      { voice: 'bass', events: [
        ['A2', 4], ['Bb2', 4], ['E2', 4], ['A2', 4] ] },
      { voice: 'drum', events: [
        ['x', 2], ['r', 2] ] },
    ],
  },

  // In-level — a dark quest march in E harmonic minor over i–bVI–bII–V
  // (Em – C – F Neapolitan – B7). The melody twists on the augmented-second
  // (C→D#) and the tritone, so even the adventuring theme reeks of menace.
  level: {
    bpm: 150,
    channels: [
      { voice: 'lead', events: [
        ['E5', 0.5], ['G5', 0.5], ['B5', 0.5], ['G5', 0.5], ['F#5', 0.5], ['E5', 0.5], ['D#5', 1],   // Em -> leading tone
        ['C5', 0.5], ['D#5', 0.5], ['E5', 0.5], ['G5', 0.5], ['F#5', 0.5], ['D#5', 0.5], ['E5', 1],  // C, aug-2nd C->D#
        ['F5', 0.5], ['A5', 0.5], ['C6', 0.5], ['A5', 0.5], ['G5', 0.5], ['F5', 0.5], ['C5', 1],     // F (Neapolitan)
        ['B4', 0.5], ['D#5', 0.5], ['F#5', 0.5], ['B5', 0.5], ['A5', 0.5], ['F#5', 0.5], ['D#5', 1] ] }, // B7 dominant
      { voice: 'harmony', events: [
        ['E4', 0.5], ['G4', 0.5], ['B4', 0.5], ['G4', 0.5], ['E4', 0.5], ['G4', 0.5], ['B4', 0.5], ['G4', 0.5],
        ['C4', 0.5], ['E4', 0.5], ['G4', 0.5], ['E4', 0.5], ['C4', 0.5], ['E4', 0.5], ['G4', 0.5], ['E4', 0.5],
        ['F4', 0.5], ['A4', 0.5], ['C5', 0.5], ['A4', 0.5], ['F4', 0.5], ['A4', 0.5], ['C5', 0.5], ['A4', 0.5],
        ['D#4', 0.5], ['F#4', 0.5], ['A4', 0.5], ['F#4', 0.5], ['D#4', 0.5], ['F#4', 0.5], ['A4', 0.5], ['F#4', 0.5] ] },
      { voice: 'bass', events: [
        ['E2', 1], ['E2', 1], ['E2', 1], ['E2', 1],
        ['C2', 1], ['C2', 1], ['C2', 1], ['C2', 1],
        ['F2', 1], ['F2', 1], ['F2', 1], ['F2', 1],
        ['B2', 1], ['B2', 1], ['B2', 1], ['B2', 1] ] },
      { voice: 'drum', events: [
        ['x', 0.5], ['h', 0.5] ] },
    ],
  },

  // Boss fight — FASTER and downright diabolical: E harmonic minor, chromatic
  // lead, and a bar of D#-diminished-seventh arpeggio (the vii°7) for that
  // cackling, unresolved dread. Whipped along well above the field tempo.
  boss: {
    bpm: 186,
    channels: [
      { voice: 'lead', events: [
        ['E5', 0.5], ['F5', 0.5], ['E5', 0.5], ['D#5', 0.5],
        ['E5', 0.5], ['B4', 0.5], ['D5', 0.5], ['C5', 0.5],
        ['B4', 0.5], ['A#4', 0.5], ['B4', 0.5], ['E5', 0.5], ['B4', 1], ['r', 1] ] },
      { voice: 'harmony', events: [
        ['E4', 0.5], ['G4', 0.5], ['B4', 0.5], ['G4', 0.5], ['E4', 0.5], ['G4', 0.5], ['B4', 0.5], ['G4', 0.5],
        ['D#4', 0.5], ['F#4', 0.5], ['A4', 0.5], ['C5', 0.5], ['D#4', 0.5], ['F#4', 0.5], ['A4', 0.5], ['C5', 0.5] ] },
      { voice: 'bass', events: [
        ['E2', 1], ['E2', 1], ['E2', 1], ['E2', 1],
        ['B2', 0.5], ['B2', 0.5], ['B2', 1], ['B2', 0.5], ['A#2', 0.5], ['B2', 1] ] },
      { voice: 'drum', events: [
        ['x', 0.5], ['h', 0.25], ['h', 0.25] ] },
    ],
  },
};

/* ============================================================================
 * The one global instance — summoned once, commanded from the engine's throne.
 * Shares the classic-script global scope, exactly like `Weapons` and `Input`.
 * ========================================================================== */
const SFX = new SoundEngine();
