/* SIXFOLD — assists.js  (spec §4.5)
 *
 * Two STRICTLY separate buckets (conflating them is the trap):
 *
 *  A) Accessibility — FREE, always on, never equipped/unlocked/gated. Baseline
 *     quality. Available in every mode including competitive.
 *  B) Assist charms — one equip slot, casual/practice ONLY. They go completely
 *     inert the moment a result is ranked / seeded / shared / PvP. No charm ever
 *     touches damage or odds — only time, visible info, or clarity.
 *
 * The pillar guard lives in ONE place: active(mode) returns the equipped charm
 * IFF mode.honorsAssists, else null. Competitive modes always get null.
 */
(function (root) {
  "use strict";

  const hasLS = (typeof localStorage !== "undefined");
  const KEY = "sixfold.assists.v1";

  const DEFAULT_A11Y = {
    colorblind: false,      // colorblind-safe palette
    reducedMotion: false,   // also auto-detected from prefers-reduced-motion at the UI layer
    largeTapTargets: false,
    haptics: true,          // phone buzz on hits/bind (juice; on by default)
    slowReveal: false,      // longer reveal beat
    highContrast: false,
    audioCues: true,        // distinct sound per outcome (juice; on by default)
  };

  const CHARMS = {
    hourglass: { id: "hourglass", name: "Hourglass", glyph: "⌛",
      effect: "+seconds on the commit timer", touches: "time" },
    eye:       { id: "eye", name: "Eye", glyph: "👁",
      effect: "opponent ribbon always shows last 10", touches: "info" },
    compass:   { id: "compass", name: "Compass", glyph: "🧭",
      effect: "relationship preview always on", touches: "clarity" },
    scroll:    { id: "scroll", name: "Scroll", glyph: "📜",
      effect: "round-by-round outcome log", touches: "clarity" },
  };

  let stateObj = {
    a11y: Object.assign({}, DEFAULT_A11Y),
    equipped: null,                 // charm id or null
    unlocked: ["hourglass", "eye", "compass", "scroll"], // cosmetic unlocks; never gate a11y
  };

  function load() {
    if (!hasLS) return;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const j = JSON.parse(raw);
        stateObj.a11y = Object.assign({}, DEFAULT_A11Y, j.a11y || {});
        stateObj.equipped = j.equipped || null;
        if (Array.isArray(j.unlocked)) stateObj.unlocked = j.unlocked;
      }
    } catch (e) { /* ignore corrupt storage */ }
  }
  function save() {
    if (!hasLS) return;
    try { localStorage.setItem(KEY, JSON.stringify(stateObj)); } catch (e) { /* quota */ }
  }
  load();

  // ---- accessibility: free, always available, returned regardless of mode ----
  function settings() { return Object.assign({}, stateObj.a11y); }
  function setSetting(key, val) {
    if (!(key in DEFAULT_A11Y)) return settings();
    stateObj.a11y[key] = !!val;
    save();
    return settings();
  }

  // ---- assist charms ----
  function equip(charmId) {
    if (charmId === null) { stateObj.equipped = null; save(); return null; }
    if (!CHARMS[charmId]) return current();
    if (stateObj.unlocked.indexOf(charmId) < 0) return current();  // not owned
    stateObj.equipped = charmId;
    save();
    return current();
  }
  function current() { return stateObj.equipped ? CHARMS[stateObj.equipped] : null; }

  // THE pillar guard: charms are inert unless the mode honours assists.
  function active(mode) {
    if (!mode || !mode.honorsAssists) return null;
    return current();
  }

  // UI helper: the banner competitive modes must show.
  function statusLabel(mode) {
    if (mode && !mode.honorsAssists) return "Assists off — competitive";
    const c = current();
    return c ? ("Assist: " + c.name) : "Assists: none";
  }

  const api = {
    settings, setSetting, equip, current, active, statusLabel,
    CHARMS, DEFAULT_A11Y,
    _reset() { stateObj = { a11y: Object.assign({}, DEFAULT_A11Y), equipped: null,
      unlocked: ["hourglass", "eye", "compass", "scroll"] }; },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Assists = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
