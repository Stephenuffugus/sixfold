# SIXFOLD — Findings Log

Append-only. Newest entries at top. Record decisions, surprises, deviations from
validated numbers (with justification), and anything the next instance needs.

---

## 2026-06-17 — Phase 0 + 1 (cold start)

Picked the project up cold. Only spec, handoff, prototype (`sixfold.html`),
README existed. Working solo in dependency order rather than dispatching parallel
subagents — the modules share a frozen event bus and contracts, and the
acceptance gate is strict, so coherence beats parallelism here.

**Phase 0 complete.** `CONTRACTS.md` + `tools/harness.py` written; harness
reproduces every Section 8 target.

**dead% definition (resolved surprise):** my first pass pooled all dead rounds
over all rounds and got 22% (bind) / 33% (control) vs the spec's 19% / 28%.
The engine numbers (median 5, p90 7, p99 9, bind tie ⅓, 50/50 decisive,
reader 50%) matched *exactly*, so the gap was purely how dead% is averaged.
Switching to **mean-of-per-match-ratios** lands control at 28.2% and bind at
18.4% — matching the spec table to the decimal. Conclusion: the spec author
reports dead rounds as the per-match average, not pooled. Harness now prints
both; acceptance band 0.17–0.21. Engine constants unchanged.

**Phase 1 complete.** `src/predictor.js` + 19 tests green. Two design calls worth
noting: (1) `cycle` *abstains* (returns null) without a steady non-zero step, so
it never self-penalises and reaches accuracy 1.0 on true rotations — ties with
markov1 then resolve to `cycle` via NAMES order, giving the intended tell.
(2) "Unreadable" = genuine randomness, NOT balance — a perfect round-robin is
readable by `antiRepeat`. Tests assert mean readability over many *random*
streams ≈ 0, not that a hand-crafted "balanced" stream is.

**Phase 2 (personalities) complete.** `src/personalities.js` + 16 tests green.
- Tuned Drunkard/Stone weights (more habit, less noise) so their scripted
  counters clear the ≥65% bar — personality weights are design knobs, NOT the
  frozen engine constants, so this is in-bounds. All 5 habit archetypes beaten
  65–96%; Ghost 49.9% vs random (unexploitable); difficulty monotonic on Echo.
- **Two negative-modulo bugs in the TEST harness** (not the modules): `(b-a)%6`
  and `(aB-pB)%3` are negative in JS when the minuend is smaller, silently
  misclassifying outcomes and biasing wins toward the AI. Must always wrap
  `((x)%n+n)%n`. The engine/prototype already wrap correctly — the engine module
  MUST keep doing so.
- Test harness lesson: the player's bind pick must use an RNG stream INDEPENDENT
  of the AI's sampling RNG, or binds correlate with AI stances and skew win-rate.
- Insight: vs a uniform-random stance player, `d=(b−a)%6` is uniform regardless
  of the AI's pick, so any AI ≈ 49.86% vs random (matrix symmetry). Good sanity
  check for the meter/symmetry tests later.

(continued below as work lands…)
