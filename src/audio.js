/* SIXFOLD — audio.js  (spec §10 juice; cosmetic only)
 *
 * A tiny Web Audio synth. There are NO sound FILES — every cue is generated at
 * play time, so the game stays a single zero-asset file. Lazy AudioContext
 * (browsers require a user gesture before audio), honored mute flag, pentatonic
 * palette for an East-Asian feel.
 *
 * PILLAR: audio is purely cosmetic. It never reads or affects combat state.
 *
 * API:
 *   unlock()                     resume/create the context (call on first tap)
 *   setEnabled(bool)             mute/unmute
 *   play(name)                   names below
 *     tap glance clean whiff bind bindwin bindlose victory defeat read
 *
 * Defensive: every call no-ops when Web Audio is absent (tests / headless).
 */
(function (root) {
  "use strict";

  const W = (typeof window !== "undefined") ? window : null;
  const hasWA = !!(W && (W.AudioContext || W.webkitAudioContext));
  let ctx = null, master = null, enabled = true;

  // pentatonic-ish note table (Hz) — minor pentatonic on A
  const A3 = 220, C4 = 261.63, D4 = 293.66, E4 = 329.63, G4 = 392, A4 = 440, C5 = 523.25, D5 = 587.33, E5 = 659.25;

  function ensure() {
    if (ctx || !hasWA) return ctx;
    try {
      const AC = W.AudioContext || W.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.34;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }
  function unlock() { ensure(); if (ctx && ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} } }
  function setEnabled(v) { enabled = !!v; }

  // --- primitives ---
  // plucked/struck tone with exponential decay; optional pitch glide
  function tone(freq, delay, dur, type, gain, glideTo) {
    const t0 = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "triangle";
    o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  // filtered noise burst — taiko body / impact / breath
  function noise(delay, dur, gain, cutoff, hp) {
    const t0 = ctx.currentTime + (delay || 0);
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = hp ? "highpass" : "lowpass"; f.frequency.value = cutoff || 700;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur);
  }

  const CUES = {
    tap()      { tone(A4, 0, 0.05, "triangle", 0.12); },
    // koto pluck: bright two-note grace
    glance()   { tone(D5, 0, 0.28, "triangle", 0.22); tone(A4, 0.04, 0.32, "triangle", 0.12); },
    // taiko: deep noise body + pitched thump
    clean()    { noise(0, 0.22, 0.5, 220); tone(110, 0, 0.34, "sine", 0.55, 64); tone(C4, 0.02, 0.18, "triangle", 0.18); },
    whiff()    { noise(0, 0.16, 0.14, 1600, true); },
    // steel lock: metallic detuned cling
    bind()     { tone(880, 0, 0.16, "square", 0.16); tone(1180, 0, 0.16, "square", 0.1); noise(0, 0.08, 0.18, 3000, true); },
    bindwin()  { tone(E5, 0, 0.22, "triangle", 0.2); tone(A4, 0.08, 0.26, "triangle", 0.14); },
    bindlose() { tone(A3, 0, 0.3, "sine", 0.28, 130); },
    // pentatonic rising flourish
    victory()  { [C5, D5, E5, A4].forEach((f, i) => tone(i === 3 ? f * 2 : f, i * 0.11, 0.5, "triangle", 0.2)); noise(0, 0.3, 0.18, 400); },
    // low descending minor
    defeat()   { tone(D4, 0, 0.4, "sine", 0.26, 110); tone(A3, 0.14, 0.5, "sine", 0.22, 90); },
    // called shot: bright ascending ping + airy breath — "you saw it coming"
    read()     { tone(A4, 0, 0.16, "triangle", 0.16); tone(E5, 0.05, 0.2, "triangle", 0.2); tone(A4 * 2, 0.11, 0.3, "triangle", 0.18); noise(0.08, 0.16, 0.1, 5200, true); },
  };

  function play(name) {
    if (!enabled || !hasWA) return;
    ensure();
    if (!ctx || !CUES[name]) return;
    try { CUES[name](); } catch (e) { /* never let juice break the game */ }
  }

  // Exported as `Sfx` (NOT `Audio` — that would clobber the built-in
  // HTMLAudioElement constructor on `window`).
  const api = { unlock, setEnabled, play };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Sfx = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
