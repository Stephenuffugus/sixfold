"use strict";
/* music.js — defensive no-op without HTMLAudio, and crossfade logic against a
 * mock Audio element (no real playback, just that the controller behaves). */
const assert = require("assert");
let n = 0;
function ok(msg, cond) { assert.ok(cond, msg); n++; }

// ---- 1) headless / no Audio: must be a safe no-op ----
{
  delete require.cache[require.resolve("../src/music.js")];
  const Music = require("../src/music.js");
  ok("exports play/unlock/setEnabled/setVolume/isEnabled",
    ["play", "unlock", "setEnabled", "setVolume", "isEnabled"].every((k) => typeof Music[k] === "function"));
  assert.doesNotThrow(() => { Music.play("music/x.mp3"); Music.unlock(); Music.setEnabled(false); Music.setEnabled(true); Music.setVolume(0.5); });
  ok("no-ops without Audio (no throw)", true);
}

// ---- 2) with a mock Audio: play() starts a track; switching swaps tracks ----
{
  const live = [];
  class MockAudio {
    constructor() { this.src = ""; this.loop = false; this.preload = ""; this.volume = 1; this.paused = true; live.push(this); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  global.Audio = MockAudio;
  global.setInterval = () => 0; global.clearInterval = () => {}; // freeze fades (no timers in test)
  delete require.cache[require.resolve("../src/music.js")];
  const Music = require("../src/music.js");

  Music.play("music/a.mp3");
  ok("play() creates + starts a track", live.length === 1 && live[0].src === "music/a.mp3" && live[0].loop === true && live[0].paused === false);

  Music.play("music/b.mp3");
  ok("switching tracks starts the new one", live.length === 2 && live[1].src === "music/b.mp3" && live[1].paused === false);

  Music.play("music/b.mp3");
  ok("same track twice = no extra element", live.length === 2);

  Music.setEnabled(false);
  ok("disable flips enabled off (fade-out then pause)", Music.isEnabled() === false);
  const count = live.length;
  Music.play("music/c.mp3");
  ok("disabled = no new track starts", live.length === count);

  delete global.Audio; delete global.setInterval; delete global.clearInterval;
}

console.log(`MUSIC: ${n} assertions passed`);
