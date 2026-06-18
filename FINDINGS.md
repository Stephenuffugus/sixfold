# SIXFOLD — Findings Log

Append-only. Newest entries at top. Record decisions, surprises, deviations from
validated numbers (with justification), and anything the next instance needs.

---

## 2026-06-18 — Skin system + art sheet + stale-art-ref fix

Added a cosmetic **skin layer** (`src/skins.js`, +15 tests). A skin = one sprite
atlas (2×3: idle/strike/hit/ko/guard/win); frames are sliced by CSS
`background-position`, so the artist's single sheet IS the game asset and a new
skin is one REGISTRY line + rebuild. Ships a generated vector demo ("Inkblade")
so the pipeline is exercised with no art files. `ART_SHEET.md` is the artist
brief (grid, anchor/contract, one-shot generation prompt, drop-in steps, 3/2-frame
fallbacks). Pillar held: skins expose no damage/odds/meter surface (asserted).

- **stage.js** gained `setFrame(side,name)` (frozen-API addition) and now hard-cuts
  atlas frames through choreography (strike on lunge, hit on the loser, guard in the
  bind, idle on settle); the glue sets win/ko on match-over. Decoupled from Skins:
  the glue precomputes `el._framePos`, stage just shifts background-position. Vector
  placeholder has no `.sprite`, so frame calls are inert and pose rides the CSS
  transform — unchanged behavior.
- **Latent bug fixed (would have shown in the browser pass):** `newGame()` called
  `Stage.init()` with the art elements, then `renderFighter()` *replaced* those
  elements via innerHTML — so Stage animated detached, stale nodes. Reordered to
  render first, init second. All pose/lunge/flinch transforms now target live nodes.
- **domcheck:** added `encodeURIComponent` to the sandbox (the demo atlas needs it)
  and `Skins` to the global check (now 8 modules). Still deterministic + green.
- Shipped file grew ~83.8k → ~91k bytes (the new module). Build order now
  predictor→resolve→readout→personalities→**skins**→stage→assists→engine.

---

## 2026-06-18 — Phase 3 complete (animation + single-file ship)

`stage.js` + `anim.css` (spec §4) and the `tools/build.js` inliner landed, producing
the shipped single-file `sixfold.html`. `tools/domcheck.js` runs the inlined script in
a `vm` sandbox with a minimal DOM stub and drives a full match (incl. binds + meter
spends) headlessly — all smoke checks pass with no npm deps.

- **State at handoff:** 7 suites / 111 assertions green; harness all targets met; build
  byte-identical to a fresh `node tools/build.js`; domcheck passes.
- **Bind choreography matches spec §4 by construction:** engine emits bind-tie as
  `{kind:"clash"}` (→ stage spark + mutual recoil) and bind-win as `{kind:"glance"}`
  (→ shove + loser flinch). So each of clean/glance/whiff/bind-win/bind-tie has a
  distinct `playReveal` branch — the "distinct choreography per outcome" gate is
  satisfied structurally, not just by no-error.
- **anim.css is transform/opacity only** (compositor-friendly) with a fixed 50%/88%
  pivot anchor, and `@media (prefers-reduced-motion:reduce)` kills all transitions/
  animations while `stage.wait()` collapses to 0ms — reduced-motion hard-swaps.
- **build byte-count gotcha:** `build.js` logs `tpl.length` (UTF-8 char count, ~83.6k);
  the file on disk is ~83.8k bytes due to multibyte glyphs. Not a staleness bug.
- **Only open acceptance item:** live-browser visual pass (real 60fps on mid mobile +
  the actual look of the choreography). Everything else in §8/§6 is automated-green.

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

**Phase 2 complete.** `resolve.js`/`assists.js`/`readout.js` + `engine.js`, all
tested (predictor 19, personalities 16, resolve 15, assists 16, readout 12,
engine 24 = 102 assertions). Harness still green.

**Spec inconsistency fixed (bind cycle):** §3.5's `d3` formula (`(aB−pB)%3`,
`1`=player wins) and its parenthetical flavor ("Drive>Trap>Slip>Drive") describe
OPPOSITE RPS cycles. The formula is authoritative — the harness and
`personalities.beatsBind` already use it — so the real cycle is
**Drive>Slip>Trap>Drive** (player wins when `aB=pB+1`). Updated the spec prose
and engine comment to match. No stats change (RPS is symmetric either way).

**Meter honesty proven at the engine level:** identical seed + identical scripted
picks, run with all spends firing vs no spends — winner, final HP, total damage,
and round count are byte-identical. Spends consume meter + emit info only; they
never reach the damage path and never consume the RNG, so picks are unchanged.

**Deployed live (2026-06-18):** GitHub Pages from `main`/root —
https://stephenuffugus.github.io/sixfold/ . The codespace's `GITHUB_TOKEN`
cannot enable Pages via API (403 "not accessible by integration"); the first
enable must be done by the repo owner in Settings → Pages. After that, every
push to `main` auto-publishes. PWA paths are all relative, so the project
subpath (`/sixfold/`) works without a base href.

**Mobile wheel collapse (fixed):** `.wheelwrap` is a direct child of the body
column flexbox. On a phone the page exceeds viewport height, so flexbox shrank
the wheel vertically *despite* `height:296px` — down to ~21px on a 320px screen,
piling all 6 stance nodes on top of each other. Fix: `flex-shrink:0` on
`.wheelwrap`. Added `tools/render-check.js` (Playwright, dev-only) — renders the
shipped game at phone viewports, measures every node's box, and fails on
overlap/clipping. This is the regression test the headless `domcheck` stub
*can't* be (no layout engine). `node_modules` + screenshots are gitignored;
runtime stays zero-dep.

**Playtest polish (2026-06-18):** (1) Clash Bind moved out of the 120px hub into
a full-screen overlay (`#bindstage`): backdrop blur+dim, `.hero` scales .5→1 with
an overshoot bezier so the choices rush forward, big buttons labelled with what
they beat, screen-shake on entry, reduced-motion safe. (2) First-run "How to
duel" overlay (`#howto`, remembered via `localStorage.sixfold_seen`) because the
teaching rings only fire on hover and so never show on touch — this was the
"confusing" feedback. `Stage.bindPrompt()` now needs `els.bindStage`; SW cache
bumped (→ v3) on each deploy so phones drop the stale shell.

(continued below as work lands…)
