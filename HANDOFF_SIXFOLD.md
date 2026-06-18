# HANDOFF — Build SIXFOLD

**You are a Claude Code instance picking this project up cold. Read this whole file, then read `SIXFOLD_SPEC.md` (the source of truth) before writing anything.** This doc tells you what to build, in what order, and the lines you must never cross. When in doubt, the spec wins; when the spec is silent, the invariants below win.

---

## 1. Mission

SIXFOLD is a mobile-first stance-duel game: a 6-stance "power wheel" reimagining of rock-paper-scissors where two warriors lock a hidden stance each round and the clockwise distance between picks decides the exchange. Matches last under a minute. The combat engine is already designed, simulated, and validated. Your job is to build three new systems on top of it (AI personalities, a predictability/read score, an info-only Resolve meter), a clash-bind mini-game, a CSS3 animation layer, and an assists/accessibility layer — then ship it as a single self-contained HTML file.

The whole design exists in `SIXFOLD_SPEC.md`. This handoff is the operational wrapper around it.

---

## 2. Who this is for / context you won't otherwise have

- **Developer:** solo indie dev (SWS Strategic Media LLC). Builds single-file vanilla HTML/CSS/JS PWAs, Firebase backends, deploys to GitHub Pages / static hosts. **No build steps. No frameworks. No npm runtime deps.** Often works from a phone, so the shipped artifact must be one file that just opens.
- **Portfolio fit:** this will eventually live inside the **Lucid Winds** ecosystem as a single-player-vs-computer mode, minting "sunbeams" (cross-game currency) on a win via an existing Cloud Function. Treat Firebase/sunbeam wiring as a clearly-fenced *later* phase — do not block the core game on it.
- **A prototype already exists:** `sixfold.html` contains the validated engine, a reader AI, the wheel UI, the reveal/HP loop, and a cosmetic customizer. Use it as your visual + engine starting point. Everything in the spec is built *on top of* what's there.

---

## 3. THE PILLAR — non-negotiable invariants (violating any of these is a failed build)

1. **Skill is the only currency; art is the only purchase.** Nothing a player unlocks, equips, grinds, or buys may change damage or the odds of a round in fair play.
2. **The engine constants are validated. Do not change them without re-running the harness and updating the spec:**
   `N=6 · HP=4 · CLEAN=2 · GLANCE=1 · escalation +1 after round 6`.
3. **Symmetry is sacred.** Both fighters always have identical mechanics, meter, and bind. No positional or stance advantage. (Harness proves this: reader-vs-random ≈ 50%.)
4. **The Resolve meter spends only buy *information*, never force.** Total damage with spends enabled must equal total damage with them disabled.
5. **Assists are inert in any ranked / seeded / shared / PvP context.** Accessibility is free and always on, never gated.
6. **Ship one file.** The deliverable is a dependency-free `sixfold.html`. You may develop in modules for testing, but the shipped game is a single static file with everything inlined — no runtime imports, no toolchain the dev has to run.

If a request (even a future one) conflicts with these, stop and flag it rather than silently breaking the pillar.

---

## 4. Repo conventions

- **Language:** vanilla ES2020 JS, modern CSS, semantic HTML. No TypeScript, no bundler, no CSS framework.
- **Dependencies:** zero at runtime. Google Fonts via `<link>` is fine (degrade gracefully). Node is used *only* for unit tests and the sim harness, never shipped.
- **Style:** small pure functions, clear names, terse comments that explain *why*. Mobile-first CSS; transform/opacity-only animation; visible keyboard focus; `prefers-reduced-motion` respected.
- **Tests:** plain `node` assert scripts in `/tests` (e.g. `node tests/predictor.test.js`). No test framework.
- **Commits:** one concern per commit, present-tense summary. Leave the tree green.

---

## 5. Project structure to create

```
/                       (repo root, GitHub Pages)
  sixfold.html          ← SHIPPED artifact (single file, everything inlined). Start from existing prototype.
  SIXFOLD_SPEC.md       ← source of truth (already present)
  HANDOFF.md            ← this file; keep it current for the next instance
  /src                  ← dev modules (NOT shipped directly; inlined into sixfold.html at the end)
    engine.js           ← resolve(), constants, match loop, Clash Bind resolution, event bus, mode registry
    predictor.js        ← shared ensemble (build FIRST)
    personalities.js    ← 8 AI archetypes + aiChoose + bindChoose + spendPolicy
    resolve.js          ← meter economy + Insight + Foresight
    readout.js          ← stance ribbon + unpredictability bars + post-match tell
    assists.js          ← accessibility settings + assist charms + inert-in-competitive rule
    stage.js            ← pivot/strike/lunge choreography + locked-blades + bind prompt UI
    anim.css            ← transform tables, keyframes, reduced-motion
  /tools
    harness.py          ← Monte-Carlo validator (re-run to prove nothing drifted)
  /tests
    *.test.js           ← per-module unit tests (node)
  FINDINGS.md           ← log decisions, surprises, and anything the next instance must know
```

The `/src` split exists so logic is testable in isolation and so work can be parallelized (Section 7). The **final integration step** inlines `/src` into one `<script>` block (and `anim.css` into one `<style>`) inside `sixfold.html`, in dependency order, wrapped in an IIFE. That inline is a one-shot you perform — not a build the dev runs.

---

## 6. Read the spec, then implement these (all detailed in `SIXFOLD_SPEC.md`)

| Spec § | System | One-line gist |
|---|---|---|
| 0 | **Predictor** | online ensemble; `predict()` + `readability()`. **Build first — everything depends on it.** |
| 1 | **AI Personalities** | 8 archetypes as habit + read + entropy floor; one difficulty knob; `bindChoose`. |
| 2 | **Ribbon + Predictability score** | visible pick history + live "Unpredictability" bar + post-match biggest-tell. |
| 3 | **Resolve meter** | dead rounds → resource; spends are **Insight + Foresight only** (Focus is cut). |
| 3.5 | **Clash Bind** | mirror triggers a fast Drive/Slip/Trap RPS; winner deals a **glance**; tie is harmless; +1 Resolve to both on entry. |
| 4 | **Animation** | 2 frames/character (idle+strike) + CSS3 pivot/lunge; per-outcome choreography incl. locked-blades. |
| 4.5 | **Assists & Accessibility** | free always-on accessibility vs casual-only assist charms that go inert in competitive. |
| 5 | **Contracts** | frozen module APIs + event bus. Code against these so modules never collide. |
| 6 | **Acceptance tests** | the QA gate. The build is "done" only when all pass. |

The keystone is the **Predictor** (§0): the same module powers the AI's read, the player's score, and the meter's Foresight. Get it right and tested before anything consumes it.

---

## 7. Build sequence

You can dispatch subagents per module or work solo in this order — either way, honor the dependency order and the frozen contracts in spec §5.

**Phase 0 — Foundation (do alone, first)**
1. Author/confirm `CONTRACTS` (spec §5) as comments at the top of `engine.js`: shared types, frozen APIs, event-bus event names. Nothing else may deviate from these.
2. Build a **mock engine** that emits the event bus with stubbed data, so UI/animation work can start before real logic lands.
3. Stand up `/tools/harness.py` (port the model from spec §3.5 + the base engine) and confirm the baseline + bind targets in Section 8 before building features.

**Phase 1 — Predictor** (`predictor.js` + `tests/predictor.test.js`). Blocks everything. Verify: `readability` ≈ 0 on a uniform stream, ≈ 1 on a pure-repeat stream; ≥90% correct predictor attribution on crafted streams (repeat / rotation / favourite).

**Phase 2 — parallel on top of the Predictor**
- `personalities.js` (+ tests): 8 profiles, `aiChoose`, `bindChoose`, `spendPolicy`, difficulty knob.
- `resolve.js` (+ tests): meter economy, `onBindEntered`, Insight, Foresight.
- `readout.js`: ribbon + unpredictability bars + post-match tell.
- `assists.js`: accessibility settings + assist charms + `active(mode)` honoring the competitive flag.
- `stage.js` + `anim.css`: can proceed from Phase 0 against the mock (pivot table, reveal timeline, locked-blades + bind prompt, reduced-motion).

**Phase 3 — Engine + integration** (`engine.js`, Agent-F role)
- Implement real `resolve()`, the **Clash Bind** branch (spec §3.5), escalation, win check, the mode registry with `honorsAssists`, and the event bus.
- Wire all modules. Re-run `/tools/harness.py` and confirm Section 8 metrics are unchanged.
- **Inline** everything into single-file `sixfold.html`. Re-test the shipped file in a browser (desktop + mobile width).
- Update `HANDOFF.md` and `FINDINGS.md`.

---

## 8. Definition of done (acceptance gate — all must pass)

Run `python3 tools/harness.py` and the node tests. Required results:

- **Length/fairness (with bind):** median ≈ 5 rounds, p90 ≈ 7, dead rounds ≈ 19%, reader-vs-random ≈ 50%.
- **Bind:** random bind ≈ 50/50; bind tie ≈ ⅓ of binds; entering a bind grants +1 Resolve to both; winner deals exactly GLANCE(+escBump); tie deals 0.
- **Personalities:** a scripted player using each archetype's intended counter wins ≥ 65% at mid difficulty; **Ghost stays 48–52%** (unexploitable); difficulty knob monotonically raises AI win-rate.
- **Meter honest:** over 10k rounds, total damage with spends == with spends disabled; player and AI gain identically.
- **Unpredictability feedback:** a bot that counters its own predicted move scores > 80% unpredictability; a one-stance spammer scores < 15%.
- **Assists honest:** with a charm equipped, a competitive-flagged match yields identical timer + visible info to assists-off; casual honors the charm; accessibility available with zero unlocks.
- **Animation:** 60fps on mid mobile; reduced-motion hard-swaps with no transforms; every outcome (clean / glance / whiff / bind-win / bind-tie) has a distinct choreography; frames align across 3+ character art sets via the fixed anchor.
- **Ship test:** `sixfold.html` opens and plays fully offline with no console errors, no network calls except optional fonts.

Do not declare done until every box is green. If you must deviate from a validated number, re-run the harness, justify it in `FINDINGS.md`, and update the spec.

---

## 9. Art contract (for whoever generates characters — bake the rule into the loader)

Each warrior ships **2 PNGs** (`idle`, `strike`; optional `hit`, `ko`): same canvas, **fixed pivot anchor (≈50% x / 88% y), transparent background, consistent scale, facing right.** The opponent is the same art mirrored with `scaleX(-1)`. Anchor consistency is what makes the CSS transforms line up across hundreds of characters. The game must run with placeholder shapes when art is absent (as the prototype does) — never hard-block on assets.

---

## 10. Later phases (fenced — do not block the core game on these)

- **PWA-ify:** add `manifest.webmanifest` + a minimal service worker for offline/install. Keep `sixfold.html` the single source.
- **Modes:** Daily Duel (seeded), Gauntlet/Ascent ladder, Blitz (timed), Ghost duels (replay a recorded pick-pattern as async PvP).
- **Lucid Winds / Firebase:** on `'match-over'`, mint sunbeams = `base + difficulty*k + unpredictabilityBonus` via the existing Cloud Function. Registry unlocks (cosmetic warriors + assist charms) persisted in Firestore. **None of this may touch fair-play combat.**
- **Juice:** Web Audio stings (koto on glance, taiko on clean), victory poses, dojo backdrops, taunt emotes — all cosmetic.

---

## 11. Phase status (updated 2026-06-18)

- [x] Phase 0 — CONTRACTS + `tools/harness.py`; Section 8 baseline + bind numbers reproduced.
- [x] Phase 1 — `predictor.js` + 19 tests.
- [x] Phase 2 — `personalities.js`, `resolve.js`, `readout.js`, `assists.js` + tests.
- [x] Phase 3 — `engine.js` (resolve, Clash Bind, bus, mode registry), `stage.js` + `anim.css`,
      and the `tools/build.js` inliner producing the single-file `sixfold.html`.
- [x] `tools/domcheck.js` — headless full-match smoke test (incl. binds + meter spends).
- [x] All 7 test suites green (111 assertions); harness all targets met; build current.

**The build meets every acceptance-gate item that can be verified without a GPU.**
The ONE open item: a live-browser visual pass on the §4 animation (real 60fps on a
mid mobile, and how the per-outcome choreography actually *looks*). Open `sixfold.html`
in a browser and confirm: distinct finishes for clean/glance/whiff/bind-win/bind-tie,
reduced-motion hard-swaps cleanly, no console errors offline. That's the last box.

Fenced/later (Section 10): PWA manifest+SW, extra modes, Firebase/sunbeam wiring, juice.

## 12. Handoff hygiene (for the next instance)

Before you stop: leave the tree green, append a dated entry to `FINDINGS.md` (decisions made, anything surprising, open questions), and update the first-session checklist / Phase status in this file so the next Claude Code instance can resume cold. Never leave the engine constants or the pillar invariants changed without a `FINDINGS.md` justification and a spec update.
