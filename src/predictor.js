/* SIXFOLD — predictor.js  (spec §0, the keystone)
 *
 * An online ensemble of cheap predictors. Each watches a pick-stream and guesses
 * the next pick; we track each one's running accuracy. The best one tells us how
 * READABLE the stream is. Three systems consume only the public API below:
 *   - AI reads the player via predict()
 *   - the player's unpredictability score is readability()
 *   - Foresight surfaces predict()
 *
 * Pure & stateless public API: predict()/readability() each replay the whole
 * history through a fresh ensemble. Histories are short (<~24), so O(n) is fine
 * and the functions stay referentially transparent (contract demands it).
 *
 * Parameterized by alphabet size N: N=6 for stances, N=3 for the Clash Bind.
 */
(function (root) {
  "use strict";

  const WINDOW = 12;

  // --- individual predictors: history (incl. just-played pick) -> next guess ---
  // Each returns a guess in 0..N-1, or null when it has no opinion yet.
  function argmaxCount(hist, N) {
    if (!hist.length) return null;
    const recent = hist.slice(-WINDOW);
    const c = new Array(N).fill(0);
    for (const x of recent) c[x]++;
    let best = 0;
    for (let i = 1; i < N; i++) if (c[i] > c[best]) best = i;
    return best;
  }

  function detectStep(hist, N) {
    // rotation / metronome: if the last two transitions share a step, extrapolate.
    // Abstain (null) without a steady cadence so cycle is never penalised on
    // non-rotations and reaches accuracy 1.0 on true rotations (ties -> cycle wins).
    if (hist.length < 3) return null;
    const d1 = (hist[hist.length - 1] - hist[hist.length - 2] + N) % N;
    const d2 = (hist[hist.length - 2] - hist[hist.length - 3] + N) % N;
    // a steady NON-ZERO step is a rotation; step 0 is a repeat (repeat's job).
    if (d1 === d2 && d1 !== 0) return (hist[hist.length - 1] + d1) % N;
    return null; // no rotation cadence -> abstain (don't pollute accuracy)
  }

  function mostCommonAfter(hist, N) {
    // markov-1: given the current last symbol, what most often follows it?
    if (hist.length < 2) return null;
    const prev = hist[hist.length - 1];
    const c = new Array(N).fill(0);
    let seen = 0;
    for (let i = 0; i < hist.length - 1; i++) {
      if (hist[i] === prev) { c[hist[i + 1]]++; seen++; }
    }
    if (!seen) return null;
    let best = 0;
    for (let i = 1; i < N; i++) if (c[i] > c[best]) best = i;
    return best;
  }

  function leastRecent(hist, N) {
    // antiRepeat ("they avoid repeating"): the symbol seen least recently.
    if (!hist.length) return null;
    let bestSym = 0, bestAge = -1;
    for (let s = 0; s < N; s++) {
      let age = hist.length; // never seen -> maximally "due"
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i] === s) { age = hist.length - 1 - i; break; }
      }
      if (age > bestAge) { bestAge = age; bestSym = s; }
    }
    return bestSym;
  }

  const PREDICTORS = {
    cycle:      detectStep,                                  // checked before markov on ties
    repeat:     (h) => (h.length ? h[h.length - 1] : null),
    frequency:  argmaxCount,
    markov1:    mostCommonAfter,
    antiRepeat: leastRecent,
  };
  const NAMES = Object.keys(PREDICTORS);

  const LABELS = {
    cycle:      "Rotates in a fixed pattern",
    repeat:     "Repeats the last stance",
    frequency:  "Favours one stance",
    markov1:    "Predictable transitions",
    antiRepeat: "Never repeats the same stance",
    none:       "Unreadable",
  };
  function humanLabel(name) { return LABELS[name] || LABELS.none; }

  class Ensemble {
    constructor(N) {
      this.N = N || 6;
      this.history = [];
      this.acc = {};
      this.lastGuess = {};
      for (const n of NAMES) { this.acc[n] = { hits: 0, total: 0 }; this.lastGuess[n] = null; }
    }
    observe(actual) {
      // score the guesses made *before* this pick (only count predictors that committed)
      for (const n of NAMES) {
        const g = this.lastGuess[n];
        if (g !== null && g !== undefined) {
          this.acc[n].total++;
          if (g === actual) this.acc[n].hits++;
        }
      }
      this.history.push(actual);
      for (const n of NAMES) this.lastGuess[n] = PREDICTORS[n](this.history, this.N);
    }
    // best = highest accuracy among predictors with enough evidence; ties -> NAMES order.
    best() {
      let bestName = "none", bestAcc = 0;
      for (const n of NAMES) {
        const { hits, total } = this.acc[n];
        const a = total >= 3 ? hits / total : 0;
        if (a > bestAcc) { bestAcc = a; bestName = n; }
      }
      return { name: bestName, accuracy: bestAcc };
    }
  }

  function buildEnsemble(history, N) {
    const e = new Ensemble(N);
    for (const pick of history) e.observe(pick);
    return e;
  }

  function predict(history, N) {
    N = N || 6;
    if (!history || !history.length) {
      return { pick: 0, confidence: 0, predictorName: "none" };
    }
    const e = buildEnsemble(history, N);
    const b = e.best();
    let pick = e.lastGuess[b.name];
    if (pick === null || pick === undefined) pick = history[history.length - 1];
    return { pick, confidence: b.accuracy, predictorName: b.name };
  }

  function readability(history, N) {
    N = N || 6;
    const e = buildEnsemble(history || [], N);
    const b = e.best();
    const base = 1 / N;
    const score = Math.max(0, Math.min(1, (b.accuracy - base) / (1 - base)));
    return { score, tell: humanLabel(b.name), predictorName: b.name, confidence: b.accuracy };
  }

  const api = { predict, readability, humanLabel, Ensemble, WINDOW };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Predictor = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
