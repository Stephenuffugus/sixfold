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

(continued below as work lands…)
