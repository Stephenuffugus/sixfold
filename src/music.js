/* SIXFOLD — music.js  (cosmetic ambient music layer)
 *
 * Streams real MP3 loops (unlike audio.js, which is the zero-asset SFX synth).
 * One track plays at a time; switching arenas CROSSFADES to that biome's track.
 * Uses HTMLAudioElement (streams long files, native gapless-ish looping) rather
 * than Web Audio buffers (which would hold whole 5-min songs in memory).
 *
 * PILLAR: purely cosmetic. Never reads or affects combat state.
 *
 * Autoplay: browsers block audio before a user gesture, so play() just records
 * the wanted track and tries; the glue calls unlock() on the first tap to start.
 *
 * API:  play(url)  unlock()  setEnabled(bool)  setVolume(0..1)  isEnabled()
 * Defensive: every call no-ops when Audio is unavailable (tests / headless).
 */
(function (root) {
  "use strict";
  const hasAudio = (typeof Audio !== "undefined");
  let enabled = true, vol = 0.4, cur = null, curUrl = null, want = null, fades = [];

  function stopFades() { fades.forEach(clearInterval); fades = []; }
  function fade(a, to, ms, done) {
    const steps = Math.max(1, Math.round(ms / 40));
    const from = (typeof a.volume === "number") ? a.volume : 0;
    const d = (to - from) / steps;
    let i = 0;
    const t = setInterval(() => {
      i++;
      try { a.volume = Math.max(0, Math.min(1, from + d * i)); } catch (e) {}
      if (i >= steps) { clearInterval(t); fades = fades.filter((x) => x !== t); if (done) done(); }
    }, 40);
    fades.push(t);
  }
  function tryPlay(a) { try { const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }

  function swap(url) {
    if (!hasAudio || !enabled || !url) return;
    if (url === curUrl && cur && !cur.paused) return;
    const old = cur;
    const next = new Audio();
    next.src = url; next.loop = true; next.preload = "auto"; next.volume = 0;
    tryPlay(next);
    cur = next; curUrl = url;
    fade(next, vol, 900);
    if (old) fade(old, 0, 900, () => { try { old.pause(); old.src = ""; } catch (e) {} });
  }

  function play(url) { want = url; if (enabled) swap(url); }
  function unlock() {
    if (!enabled || !hasAudio) return;
    if (cur && cur.paused) { tryPlay(cur); if (cur.volume < vol) fade(cur, vol, 600); }
    else if (!cur && want) swap(want);
  }
  function setEnabled(v) {
    enabled = !!v;
    if (!enabled) { stopFades(); if (cur) { const o = cur; fade(o, 0, 300, () => { try { o.pause(); } catch (e) {} }); cur = null; curUrl = null; } }
    else if (want) swap(want);
  }
  function setVolume(v) { vol = Math.max(0, Math.min(1, v)); if (cur && !cur.paused) cur.volume = vol; }

  const api = { play, unlock, setEnabled, setVolume, isEnabled: () => enabled };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Music = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
