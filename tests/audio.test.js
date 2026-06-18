"use strict";
/* audio.js — defensive no-op without Web Audio, and exercises every cue against
 * a mock AudioContext (no real sound, just that the synth graph builds cleanly). */
const assert = require("assert");
let n = 0;
function ok(msg, cond) { assert.ok(cond, msg); n++; }

// ---- 1) headless / no Web Audio: must be a safe no-op ----
{
  delete require.cache[require.resolve("../src/audio.js")];
  const Sfx = require("../src/audio.js");
  ok("exports unlock/setEnabled/play", ["unlock", "setEnabled", "play"].every((k) => typeof Sfx[k] === "function"));
  assert.doesNotThrow(() => { Sfx.unlock(); Sfx.setEnabled(false); Sfx.setEnabled(true); Sfx.play("clean"); Sfx.play("nope"); });
  ok("no-ops without Web Audio (no throw)", true);
}

// ---- 2) with a mock AudioContext: every cue builds a graph without throwing ----
{
  let oscs = 0, bufs = 0, started = 0;
  function node(extra) { return Object.assign({ connect() {}, start() { started++; }, stop() {} }, extra || {}); }
  function param() { return { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
  class MockAC {
    constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = "running"; this.destination = node(); }
    createGain() { return node({ gain: param() }); }
    createOscillator() { oscs++; return node({ type: "sine", frequency: param() }); }
    createBiquadFilter() { return node({ type: "lowpass", frequency: { value: 0 } }); }
    createBuffer(ch, len) { bufs++; return { getChannelData: () => new Float32Array(len) }; }
    createBufferSource() { return node({ buffer: null }); }
    resume() { return Promise.resolve(); }
  }
  global.window = { AudioContext: MockAC };
  delete require.cache[require.resolve("../src/audio.js")];
  const Sfx = require("../src/audio.js");
  Sfx.unlock();
  const cues = ["tap", "glance", "clean", "whiff", "bind", "bindwin", "bindlose", "victory", "defeat"];
  assert.doesNotThrow(() => cues.forEach((c) => Sfx.play(c)));
  ok("all cues build a graph without throwing", oscs > 0 && started > 0);
  ok("noise cues allocate buffers", bufs > 0);
  Sfx.setEnabled(false);
  const before = oscs;
  Sfx.play("clean");
  ok("muted = silent (no new nodes)", oscs === before);
  delete global.window;
}

console.log(`AUDIO: ${n} assertions passed`);
