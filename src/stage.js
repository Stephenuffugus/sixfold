/* SIXFOLD — stage.js  (spec §4)
 *
 * Choreography over 2 frames/character + GPU transforms. Pivot toward the stance
 * on select; lunge + strike-frame on reveal; the OUTCOME picks the finish. Also
 * owns the locked-blades hold and the Clash Bind prompt UI.
 *
 * API (frozen, spec §5):
 *   toStance(side, stance) ; playReveal(pPick, aPick, outcome) -> Promise
 *   lockBlades() ; bindPrompt() -> Promise<Bind>
 *   setFrame(side, name) -> show an atlas frame (idle/strike/hit/ko/guard/win);
 *     glue sets el._framePos before play. No-op for the vector placeholder.
 *
 * Defensive: every method no-ops / resolves immediately if the DOM or the
 * configured elements are absent (so tests and headless play never throw).
 */
(function (root) {
  "use strict";

  // stance -> lean transform (player faces right; opponent wrapper mirrors it)
  const POSE = [
    "translateY(-6px) rotate(0deg)",          // 0 Heaven  ↑
    "translate(5px,-4px) rotate(7deg)",       // 1 Tiger   ↗
    "translate(5px,4px) rotate(13deg)",       // 2 River   ↘
    "translateY(5px) scaleY(.96)",            // 3 Earth   ↓
    "translate(-5px,4px) rotate(-13deg)",     // 4 Crane   ↙
    "translate(-5px,-4px) rotate(-7deg)",     // 5 Shadow  ↖
  ];
  const NEUTRAL = "translate(0,0) rotate(0deg)";

  let els = {};        // {pArt, aArt, hub, spark, roundlbl, verdict, sub}
  let reduced = false;
  let timed = false;   // timed modes give the bind a snap timer
  const hasDoc = (typeof document !== "undefined");

  function init(refs) {
    els = refs || {};
    reduced = !!(refs && refs.reducedMotion);
    timed = !!(refs && refs.timed);
    if (hasDoc && typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion:reduce)").matches) {
      reduced = true;
    }
  }
  function setReduced(v) { reduced = !!v; }
  function setTimed(v) { timed = !!v; }

  function art(side) { return side === "P" ? els.pArt : els.aArt; }
  function wait(ms) { return new Promise((res) => setTimeout(res, reduced ? 0 : ms)); }

  // Show a named atlas frame (idle/strike/hit/ko/guard/win). For atlas skins the
  // glue precomputes el._framePos[name] = "x% y%"; we just shift background-position
  // (instant cut). No-op for the vector placeholder (no .sprite child) — its pose
  // is carried entirely by the CSS transforms below.
  function frameEl(el, name) {
    if (!el || !el.querySelector) return;
    const sp = el.querySelector(".sprite");
    if (sp && el._framePos && el._framePos[name]) sp.style.backgroundPosition = el._framePos[name];
  }
  function setFrame(side, name) { frameEl(art(side), name); }

  function applyPose(el, stance, extra) {
    if (!el) return;
    const base = POSE[stance] != null ? POSE[stance] : NEUTRAL;
    el.style.transform = extra ? base + " " + extra : base;
  }

  function toStance(side, stance) {
    const el = art(side);
    if (!el) return;
    el.classList.remove("locked", "striking", "flinch", "knock");
    frameEl(el, "idle");
    applyPose(el, stance);
  }

  function spark() {
    if (!els.spark || reduced) return;
    els.spark.classList.remove("go"); void els.spark.offsetWidth; els.spark.classList.add("go");
  }

  // reveal timeline (spec §4): wind-up -> strike+lunge -> IMPACT branch -> settle
  function playReveal(pPick, aPick, outcome) {
    const p = art("P"), a = art("A");
    // pivots
    applyPose(p, pPick); applyPose(a, aPick);
    if (!hasDoc || (!p && !a)) return Promise.resolve();

    const lunge = "translateX(6px) scale(1.02)";
    return wait(120).then(() => {
      // strike frame + lunge to centre (both inners move +x; opp wrapper mirrors)
      frameEl(p, "strike"); frameEl(a, "strike");
      applyPose(p, pPick, lunge); applyPose(a, aPick, lunge);
      return wait(220);
    }).then(() => {
      // IMPACT branch on outcome
      const k = outcome && outcome.kind;
      const loser = outcome && outcome.winner ? (outcome.winner === "P" ? a : p) : null;
      if (k === "clean") {
        spark();
        if (loser) { loser.classList.add("knock"); frameEl(loser, "hit"); }
        if (els.hub) { els.hub.classList.add("finish"); }
      } else if (k === "glance") {
        spark();
        if (loser) { loser.classList.add("flinch"); frameEl(loser, "hit"); }
      } else if (k === "whiff") {
        // pass-through: brief over-lunge then recover, no contact
        applyPose(p, pPick, "translateX(9px)"); applyPose(a, aPick, "translateX(9px)");
      } else if (k === "clash") {
        spark(); // harmless bind tie -> mutual recoil handled by settle
      }
      const finishing = k === "clean" && outcome && (outcome.dmg || 0) >= 2;
      return wait(finishing && !reduced ? 600 * 1.6 : 600);
    }).then(() => {
      // settle: strike->idle, pivot neutral, clear lunge/finish
      frameEl(p, "idle"); frameEl(a, "idle");
      if (els.hub) els.hub.classList.remove("finish");
      if (p) { p.classList.remove("flinch", "knock"); applyPose(p, pPick); }
      if (a) { a.classList.remove("flinch", "knock"); applyPose(a, aPick); }
    });
  }

  function lockBlades() {
    const p = art("P"), a = art("A");
    [p, a].forEach((el) => { if (el) { frameEl(el, "guard"); el.classList.add("locked"); } });
    spark();
  }
  function unlock() {
    [art("P"), art("A")].forEach((el) => { if (el) { el.classList.remove("locked"); frameEl(el, "idle"); } });
  }

  // Clash Bind prompt: flip the hub to 3 buttons, resolve on tap. Optional snap
  // timer in timed modes (auto-picks a random bind on timeout). Returns Promise<Bind>.
  const BINDS = [{ id: 0, name: "Drive", glyph: "⤚" }, { id: 1, name: "Slip", glyph: "⤳" }, { id: 2, name: "Trap", glyph: "⤲" }];
  function bindPrompt() {
    if (!hasDoc || !els.hub) return Promise.resolve(Math.floor(Math.random() * 3));
    const hub = els.hub;
    const prevHTML = hub.innerHTML;
    return new Promise((resolve) => {
      hub.classList.add("bind-mode");
      hub.innerHTML =
        '<div class="bind-title">BIND</div><div class="bind-row">' +
        BINDS.map((b) => `<button class="bindbtn" data-b="${b.id}" aria-label="${b.name}"><span class="bg">${b.glyph}</span><span class="bn">${b.name}</span></button>`).join("") +
        "</div>";
      let done = false, timer = null;
      function pick(b) {
        if (done) return; done = true;
        if (timer) clearTimeout(timer);
        hub.classList.remove("bind-mode");
        hub.innerHTML = prevHTML;
        unlock();
        resolve(b);
      }
      Array.prototype.forEach.call(hub.querySelectorAll(".bindbtn"), (btn) => {
        btn.addEventListener("click", () => pick(parseInt(btn.getAttribute("data-b"), 10)));
      });
      if (timed) timer = setTimeout(() => pick(Math.floor(Math.random() * 3)), 2000);
    });
  }

  const api = { init, setReduced, setTimed, toStance, setFrame, playReveal, lockBlades, unlock, bindPrompt, POSE, BINDS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Stage = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
