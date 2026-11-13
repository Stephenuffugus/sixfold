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

**Juice / game-feel pass 1 (2026-06-18):** added `src/audio.js` — a Web Audio
synth with NO sound files (cosmetic; keeps the single zero-asset file). Exported
as **`Sfx`**, NOT `Audio` (that would clobber the built-in HTMLAudioElement
ctor). Lazy context primed on first pointer gesture (browser autoplay rule).
Cues wired to a synced impact (~330ms into the reveal), plus haptics
(`navigator.vibrate`), a clean-finish screen flash, and a real Victory/Defeat
result overlay (`#resultscreen`) with rounds/unpredictability/streak/sunbeams +
Duel-again / Change-foe. Win streak best persists in `localStorage`.
`audioCues` + `haptics` (already in the assists a11y model) now default **on**
and are surfaced as Sound/Haptics toggles; assists test unaffected (it only
checks `colorblind`). build ORDER gains `audio` first; domcheck tracks the 9th
global; render-check now plays a full match and screenshots the result screen.
All effects reduced-motion safe. Next polish candidates the user may pick:
visual identity (dojo backdrop/art), flow & retention, in-match clarity. Bigger
roadmap the user floated: async Ghost-duel PvP → live PvP, with a sunbeam/dew
*wager* — keep wagers OFF the combat path (pillar) and flag gambling/ratings
implications for an Asia launch to the game manager.

**Visual identity pass (2026-06-18):** art direction locked to **paper +
watercolor** (owner call — not one of the presets). Built a data-driven
`#scene` backdrop with `THEMES` (dojo/sunset/bamboo/torii), each a future
unlockable "area" — adding one = a `THEMES` entry + a `ridgeURI` silhouette
kind. Watercolor washes (blurred screen-blend), feTurbulence paper grain,
sun/moon disc, silhouette ridge, vignette — all CSS/SVG, zero assets. Frosted
panels (backdrop-blur), grounded fighters, brush wordmark underline. Arena
picker in the foe drawer. `ART_SHEET.md` style line updated to the watercolor
house style + a starter roster of 8 character concepts mapped to foe ids; the
owner generates sheets in Midjourney/GPT and they drop in via one `REGISTRY`
line. Owner's stated direction for the product: a LARGE unlockable cast +
many areas as single-player rewards (cosmetic per pillar) — the theme + skin
registries are the foundation for that.

**Serious audit + testplay (2026-06-18, 20-fighter build):**
- Pillar/fairness INTACT: harness all targets met; a truly-random player wins
  ~50% on EVERY Ascent rung regardless of difficulty/archetype. So the difficulty
  knob never raises the AI's raw strength — it only punishes *predictability*
  harder (and lets a reading player exploit a low-diff AI for >50%). Felt
  difficulty is real for humans (who leak patterns) but caps at 50% for perfect
  unpredictable play. Implication: the 23-rung campaign's challenge is
  collection + learning unpredictability, not an escalating raw-strength wall.
- BALANCE SPIKE: a patterned (stance-rotation) player vs Mirror @ rung 4 wins
  only ~4.5% (Mirror hard-counters rotations). Reader foes (trickster/ghost/echo)
  sit ~28-37% for patterned play; habit foes ~50%. Curve is archetype-driven and
  jagged, not monotonic in the displayed ★ difficulty. Mirror appearing at rung 4
  is an early wall for beginners who fall into rhythms.
- PERF: cold load ~284ms; lazy-cache SW (precache shell + ronin only) keeps it
  flat as the roster grows; no console errors; 23-rung ladder scrolls.
- ART: 20 distinct sheets; anchor/scale varies (standing vs crouched-yokai vs
  floating-spirit). Minor at game scale; a per-skin anchorY/scale would normalize.
- Quick-win shipped: Ascent auto-scrolls to the current rung on open.
See the session's audit report for the prioritized improvement list.

(continued below as work lands…)

## 2026-11-13 — multiplayer-live: Firebase switched on, Play a friend

- Transport is live against the studio project `focus-grove-fffa8` (RTDB `focus-grove-fffa8-default-rtdb`). The page carries only the public config; `FirebaseNet.connect()` fetches the 9.23.0 compat SDK on the first online tap, probes `sixfold/lobby`, and rejects with a reason (`sdk-unreachable`, `db-unreachable`, `permission-denied`, `not-configured`) that `friendlyError` turns into plain words. Offline boot is unchanged.
- Every path is under `sixfold/`: `sixfold/lobby`, `sixfold/duels`, and private lobbies `sixfold/friends/<CODE>/{lobby,duels}` (code: 4 of A-Z 2-9 without I O 0 1). The rules live in the lucid-winds repo (`database.rules.json`, `sixfold` branch beside `party`); Stephen deploys them.
- Friend duels reuse the same presence + claim + commit-reveal; they are unranked in the glue (`pvpOpp.friend`): no `applyResult`, no sunbeams, no Lucid Winds mint, leaving costs nothing.
- Fixed while wiring: (1) the claim now takes the claimer's OWN lock first, so two searchers who claim each other on the same tick no longer build two duels that never meet; (2) a claimer's own `matchedDuel` write echoes into its listener, so the side is read off the duel node instead of assumed `b`; (3) past the 13 s timeout the public band goes to any rating (plus an 8 s grace while another human is searching), so two lone humans far apart in rating meet instead of both getting Sentinels; (4) names/ratings/reveals off the wire are sanitised and range checked; (5) `Rank.createLadder` gives EVERY fresh install the same `playerId` (`p_g7bayja5`, seeded counter), so the wire uses a random per page load id instead. Worth fixing in rank.js before a global leaderboard.
- Still open: a player who closes the tab mid-duel is caught by presence, but one who taps away to another app keeps presence and the other side waits on a commit that never comes (no per-round timeout). Duel nodes are never deleted.

## 2026-11-13 — friend-room: Play a friend is a ROOM

- A friend code is now a room at `sixfold/friends/<CODE>/room` (`FirebaseNet.openRoom`): `here/<uid>` presence (onDisconnect remove, re-sent on `.info/connected`, keeps its original `at`), `left/<uid>` on an explicit leave, `ready/<uid>=n` (ready for duel n, also the rematch vote), `duel={n,id,a,b}` written once per n by a transaction, `won/<n>={w,l}` (session score), `ended/<n>` (a duel called off: lost, quit, unready), `say/<uid>` (last emote or call). Duels run the same commit-reveal under `.../friends/<CODE>/duels/<id>`. Rules unchanged (everything is under the open friends path).
- The old friend lobby (`friendBackend`, `findMatch` role host/join) is still in firebase-net.js and tested, but the page no longer uses it. An old cached client and a new one on the same code will not meet.
- Room duels watch the friend's room presence with a 12 s grace (`makeRtdbSession` sopts.graceMs), so a blink offline does not end a duel. A drop past the grace, a quit, or a Ready taken back at the last instant calls the duel off: no winner, no score, both back in the room.
- Talk (`say`) is a separate small write, validated on read (six known emote ids, or a whole stance 0..5 for a call), limited to one per 2 s per sender. It never touches the rounds/binds paths; a test floods it during a round and the round still resolves on the committed picks.
- Still open: no per-round timeout (a friend who backgrounds the app but keeps the socket open leaves the other waiting on a pick); room nodes (won, ended) are never cleaned up.

## 2026-11-13 — room-polish: a round cannot hang, the room tidies itself

- Per round clock (friend room duels only, `ROUND_MS` 30 s): the first commit's transaction writes `rounds/$n/t` (server time: the compat wrapper adds `serverNow()` from `.info/serverTimeOffset`). Past `t + 30 s` EITHER phone may write `rounds/$n/miss = "a"|"b"` by a transaction; the commit is a transaction on the same node, so a late commit and the miss cannot both land. The missed side takes a clean hit: its stance is (present pick + 1) mod 6, its bind (present bind + 1) mod 3, so both engines score the same round. The present side still reveals its committed pick, checked against its commit; nothing is revealed before the round is settled. Talk never touches these paths (a test floods it during the clock). The hub shows a quiet countdown for the last 10 s on both phones.
- TWO missed rounds in a row by one side call the duel off (`ended/$n.why = "idle"`, "<Name> stopped picking"); the second miss applies no hit, so an abandoned duel is never a cheap knockout win. A pick in between resets the count; a lone miss that knocks out a player already at 2 hearts is a normal loss. (Was three, which could never fire with HP 4 and a clean hit of 2.) While the duel's Talk panel is open, messages show at the top of the screen.
- Coming back: the room re-announces its presence whenever a snapshot shows it missing (a blink the server already counted, or an old tab's late onDisconnect). A tab keeps its room id in sessionStorage, so a reload returns to the same seat; the reloaded page finds its unfinished duel, calls it off (`why: "reload"`) and says "Your duel was called off". It does not rejoin the duel (the board lived in the old page).
- Tidy: a duel's record under `.../duels/<id>` is removed 8 s after its result or call off (only the score stays in the room); the last one to leave removes `sixfold/friends/<CODE>` by a transaction that aborts if anyone is still in it; a room found empty on entry is cleared first. Still open: if the LAST player drops (no Leave), the record stays until someone next opens that code.
- Same names read "Player 1" / "Player 2" by seat; a nameless player is "Player", never "Rival".
