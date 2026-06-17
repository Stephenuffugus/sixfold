/* SIXFOLD — readout.js  (spec §2)
 *
 * Pure information UI: the stance ribbon (both fighters, always visible) and the
 * live UNPREDICTABILITY score — the number players fight to raise. Mechanically
 * inert. The score is the predictor ensemble's read, NOT histogram entropy: a
 * perfect rotation has flat histogram yet is 100% predictable, and the ensemble's
 * cycle/markov predictors catch exactly those sequential tells.
 *
 * API (frozen, spec §5): render(playerHist, aiHist, outcomes) ; postMatch(...)
 * Scoring helpers are pure and unit-tested; DOM rendering is defensive (no-op
 * without a document / supplied elements).
 */
(function (root) {
  "use strict";
  const Predictor = (typeof require !== "undefined") ? require("./predictor.js") : root.Predictor;

  const N = 6;
  const GLYPHS = ["↑", "↗", "↘", "↓", "↙", "↖"];   // Heaven Tiger River Earth Crane Shadow
  const RIBBON_K = 5;

  // ---- pure scoring ----
  function readScorePct(hist) {
    return Math.round(Predictor.readability(hist || [], N).score * 100);
  }
  function unpredictabilityPct(hist) {
    return 100 - readScorePct(hist);
  }
  // biggest tell + the round where the player was most readable so far
  function biggestTell(hist) {
    const h = hist || [];
    const overall = Predictor.readability(h, N);
    let worstRound = 0, worstScore = -1;
    for (let r = 4; r <= h.length; r++) {
      const s = Predictor.readability(h.slice(0, r), N).score;
      if (s > worstScore) { worstScore = s; worstRound = r; }
    }
    return { tell: overall.tell, worstRound, worstScore: Math.max(0, worstScore) };
  }

  // ribbon cells: last K picks newest-first, tinted by the outcome each produced
  const TINT = { clean: "seal", glance: "jade", whiff: "steel", clash: "white" };
  function ribbonData(hist, outcomes, k) {
    k = k || RIBBON_K;
    const out = [];
    const h = hist || [], oc = outcomes || [];
    const start = Math.max(0, h.length - k);
    for (let i = h.length - 1; i >= start; i--) {
      const o = oc[i];
      out.push({ stance: h[i], glyph: GLYPHS[h[i]], tint: o ? (TINT[o.kind] || "steel") : "steel" });
    }
    return out; // newest-first
  }

  // ---- defensive DOM rendering ----
  function elById(id) { return (typeof document !== "undefined") ? document.getElementById(id) : null; }

  function renderRibbon(el, hist, outcomes, k) {
    if (!el) return;
    const cells = ribbonData(hist, outcomes, k);
    el.innerHTML = "";
    for (const c of cells) {
      const span = document.createElement("span");
      span.className = "ribbon-cell tint-" + c.tint;
      span.textContent = c.glyph;
      el.appendChild(span);
    }
  }
  function renderBar(el, pct, label) {
    if (!el) return;
    el.style.setProperty("--pct", pct + "%");
    const fill = el.querySelector(".bar-fill");
    if (fill) fill.style.width = pct + "%";
    const num = el.querySelector(".bar-num");
    if (num) num.textContent = pct + "%";
    if (label) el.setAttribute("aria-label", label + ": " + pct + "% unpredictable");
  }

  // render(playerHist, aiHist, outcomes) — updates ribbons + bars if the DOM exists.
  // Element ids (created by the shipped HTML): #pribbon #aribbon #pbar #abar,
  // and the bars only show once a fighter has >=4 picks (spec §2b).
  function render(playerHist, aiHist, outcomes, opts) {
    opts = opts || {};
    const pk = opts.ribbonK || RIBBON_K, ak = opts.aiRibbonK || RIBBON_K;
    renderRibbon(elById("pribbon"), playerHist, outcomes, pk);
    renderRibbon(elById("aribbon"), aiHist, outcomes, ak);
    if ((playerHist || []).length >= 4) {
      const pb = elById("pbar");
      if (pb) { pb.classList.add("show"); renderBar(pb, unpredictabilityPct(playerHist), "You"); }
    }
    if ((aiHist || []).length >= 4) {
      const ab = elById("abar");
      if (ab) { ab.classList.add("show"); renderBar(ab, unpredictabilityPct(aiHist), "Opponent"); }
    }
  }

  // post-match teaching payoff (spec §2c)
  function postMatch(playerHist, summary) {
    const t = biggestTell(playerHist);
    const up = unpredictabilityPct(playerHist);
    const result = {
      tell: t.tell,
      worstRound: t.worstRound,
      unpredictabilityPct: up,
      rollingAvg: summary && summary.rollingAvg != null ? summary.rollingAvg : null,
    };
    const el = elById("postmatch");
    if (el) {
      el.innerHTML =
        `<div>Your biggest tell: <b>${t.tell}</b></div>` +
        (t.worstRound ? `<div>Most exploitable moment: round ${t.worstRound}</div>` : "") +
        `<div>Unpredictability: <b>${up}%</b>` +
        (result.rollingAvg != null ? ` <span class="dim">(last 20 avg: ${result.rollingAvg}%)</span>` : "") +
        `</div>`;
    }
    return result;
  }

  const api = {
    render, postMatch,
    readScorePct, unpredictabilityPct, biggestTell, ribbonData, GLYPHS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Readout = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
