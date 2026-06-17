# SIXFOLD — Systems Spec & Build Plan

> Stance-duel engine. Pillar: **skill is the only currency, art is the only purchase.** Nothing in any system below changes damage or the odds of a round in fair play. All additions deliver *expression*, *information*, or *symmetric depth*.

Validated base engine (do not change without re-running the sim harness):
`N=6 stances · HP=4 · CLEAN=2 · GLANCE=1 · escalation +1 after round 6`
Resolution: `d=(theirs−mine) mod 6` → 0 **clash → Clash Bind (§3.5)**, 1 clean(me), 2 glance(me), 3 whiff, 4 glance(them), 5 clean(them). Every stance beats 2 / loses 2 / whiffs 1 / mirrors 1. **With the Clash Bind: median match ≈5 rounds, p90 ≈7, dead rounds ≈19%** (60k-match sim).

**The keystone:** Systems 1–3 all consume one shared module — the **Predictor**. Spec it first (Section 0); everything else depends on it.

---

## Contents
- 0. Predictor module (shared foundation)
- 1. AI Personalities
- 2. Stance Ribbon + Predictability (entropy) Score
- 3. Resolve Meter (info-spend) — **Insight + Foresight only**
- 3.5 Clash Bind (mini-RPS on mirror)
- 4. Animation layer (CSS3 pivot + strike frame)
- 4.5 Assists & Accessibility (single-player QoL, inert in competitive)
- 5. Contracts (events + data shapes — code against these)
- 6. Parallel agent build plan + acceptance tests

---

## 0. PREDICTOR MODULE — `predictor.js`

An online ensemble of cheap predictors. Each watches a pick-stream and predicts the next pick; we track each one's running accuracy. The best one = "how readable this stream is."

```
predictors = {
  frequency:  hist => argmaxCount(hist.slice(-WINDOW)),     // favourite stance
  repeat:     hist => hist.at(-1),                          // "they repeat"
  cycle:      hist => detectStep(hist),                     // rotation/metronome detector
  markov1:    hist => mostCommonAfter(hist, hist.at(-1)),   // P(next | prev)
  antiRepeat: hist => leastRecent(hist)                     // "they avoid repeating"
}
WINDOW = 12
```

```
class Ensemble {
  acc = {name:{hits,total}}
  observe(actualPick) {
    for name: if lastGuess[name]===actualPick: acc[name].hits++; acc[name].total++
    history.push(actualPick)
    for name: lastGuess[name] = predictors[name](history)
  }
  best() { return maxBy(name => acc[name].total>=3 ? acc[name].hits/acc[name].total : 0) }
}
```

### Public API (all three systems use only this)
```
predict(history)     -> { pick, confidence:0..1, predictorName }   // confidence = best().accuracy
readability(history) -> { score, tell }
   // score = clamp( (best().accuracy − 1/6) / (5/6), 0, 1 )    0 = unreadable, 1 = open book
   // tell  = humanLabel(best().predictorName)
```
A second, tiny ensemble instance tracks the **Clash Bind** stream (3 symbols) for the same purposes inside the bind (§3.5).

**Why keystone:** AI reads you with `predict()`, your score is `readability()`, Foresight surfaces `predict()`. One module, tested once.

---

## 1. AI PERSONALITIES — `personalities.js`

Each personality = its **habit** (the tell you exploit) + how well it **reads** you (the threat) + an **entropy floor** (its ceiling). Difficulty is one knob: scales reading up, telegraph down. No stat changes, ever.

```
aiChoose(profile, ctx) -> stance
  dist=[0..0]
  bias = profile.bias(ctx); read = profile.read(ctx)
  for i: dist[i] = profile.wBias*bias[i] + profile.wRead*read[i] + profile.wNoise*(1/6)
  applyTriggers(profile, dist, ctx); normalize(dist); return sample(dist)   // seeded RNG
```
`read(ctx)`: `p=predict(playerHist)`; if `p.confidence>readThreshold` mass on `counter(p.pick)` softened by `readStrength`; else uniform.

### Bias builders
`favorStance(s,k)` · `homeArc(center,w,k)` · `winStay(k)` · `neverRepeat(lastAi)` · `rotate(step,dir)` · `mirrorPlayer(playerHist)` · `adaptiveCounter(playerHist)`

### Roster (ship 8, scalable)
| # | Name | wBias/wRead/wNoise | Bias | Read | Trigger | Diff | Tell |
|---|------|--------------------|------|------|---------|------|------|
| 1 | Berserker | .60/.10/.30 | winStay | weak | ahead → +winStay | ★☆☆☆☆ | Repeats the stance that just hit — counter the repeat. |
| 2 | Stone | .65/.10/.25 | homeArc(c,3) | weak | low HP → narrow | ★★☆☆☆ | Picks bunch in one arc — counter the cluster. |
| 3 | Drunkard | .55/.15/.30 | neverRepeat | weak | — | ★★☆☆☆ | Never repeats — eliminate its last pick. |
| 4 | Mirror | .80/.00/.20 | mirrorPlayer | none | — | ★★☆☆☆ | Plays YOUR last stance — counter your own previous move. |
| 5 | Metronome | .75/.00/.25 | rotate(step,dir) | none | — | ★★★☆☆ | Marches a fixed step — find the cadence, stay ahead. |
| 6 | Trickster | .20/.55/.25 | favorStance(rand) | level-2 | — | ★★★★☆ | Beats your counter — don't take the bait, go level-3. |
| 7 | Ghost | .05/.35/.60 | uniform | strong | — | ★★★★★ | Near-random + sharp read — survive on your own unpredictability + meter. |
| 8 | Echo (Rival) | .10/.65/.25 | adaptiveCounter | strong/adaptive | mirrors your readability | ★★★★★ | Learns you in real time — it does to you what you do to others. |

### Triggers
```
applyTriggers(profile,dist,ctx): for t in profile.triggers: if t.when(ctx): reweight dist by t.effect
```
### Difficulty (ladder knob 0..1)
```
wRead:  lerp(wRead*0.4, wRead*1.3, skill)
wNoise: lerp(wNoise*1.4, wNoise*0.7, skill)
readThreshold: lerp(0.30, 0.14, skill)
```
### Bind + Resolve behaviour
`bindChoose(profile,ctx)->0..2` (Drive/Slip/Trap; flavor: Berserker always Drive, Trickster anti-reads, Ghost random). `spendPolicy(profile,ctx)->{action,cost}|null` (Berserker never spends; Ghost hoards then Foresights low-HP; Echo Foresights when read confidence dips). Flavor, not power.

---

## 2. STANCE RIBBON + PREDICTABILITY SCORE — `readout.js`

### 2a. Ribbon (pure information UI)
Strip under each fighter: last `K=5` picks, newest-first, glyphs tinted by the outcome each produced. **Both** ribbons always visible. Mechanically inert.
Data: `playerHist[]`, `aiHist[]`, `outcomes[]`.

### 2b. Predictability score (the differentiator)
```
read = readability(playerHist)
readScorePct        = round(read.score*100)     // 0 unreadable … 100 open book
unpredictabilityPct = 100 - readScorePct        // the number players fight to raise
```
Live **Unpredictability** bar once `playerHist.length>=4`, shown for both — a duel of reads.

> Histogram entropy `H/log2(6)` alone is insufficient (a perfect rotation has a flat histogram yet is 100% predictable). The ensemble's cycle + markov predictors catch sequential tells, so Read Score is the honest measure. Keep entropy only as a secondary "spread" dial if wanted.

### 2c. Post-match readout (teaching payoff)
```
"Your biggest tell: " + read.tell
"Most exploitable moment: round " + worstRound
"Unpredictability: " + unpredictabilityPct + "%  (last 20 duels avg: " + rolling + "%)"
```
Optional lifetime **Yomi rating** (ELO-lite, weighted by opponent difficulty × your unpredictability). Additive, never gates content.

---

## 3. RESOLVE METER — `resolve.js`  (Insight + Foresight only)

Converts dead rounds into a resource spent only on **information, never force.** Focus was cut to keep the meter unimpeachably honest.

### Economy
```
RESOLVE_MAX = 3
gain:  whiff → +1 to BOTH ·  clash(bind) → +1 to BOTH on ENTERING the bind, regardless of who wins it
       (keeps meter fuel intact now that most binds resolve to damage; +optional comeback drip: taking a clean → +1 victim)
spends (commit before your next pick):
  INSIGHT   cost 1 → extend opponent ribbon to last 10 + reveal their Resolve
  FORESIGHT cost 2 → highlight predict(opponentHist).pick on the wheel for the next reveal
```

### Hard guarantees (QA must verify)
- A spend NEVER changes CLEAN/GLANCE/bind damage, escalation, or HP.
- Foresight surfaces a *prediction* that can be wrong — useless vs the Ghost, gold vs the Metronome. Self-balancing.
- Meter is identical for both fighters; the AI spends via `spendPolicy`. Symmetry intact.
- Because nothing alters damage, the validated match-length model holds. Re-confirm in the harness.

### State
```
resolve = { player:0, ai:0 }
onRoundResolved(outcome): if outcome.kind in {whiff} both +1
onBindEntered(): both +1            // fires the moment a clash triggers a bind
spend(side,action): if resolve[side]>=cost: resolve[side]-=cost; emit 'info-revealed'
```

---

## 3.5 CLASH BIND — mini-RPS on a mirror — `engine.js` + `stage.js`

When stances mirror (`d=0`), blades lock. Instead of a dead round, both fighters make **one fast 3-way pick** — the bind — and the winner lands a **glance**. This is the literal "it whittles down to easy rock-paper-scissors" climax of a locked exchange.

### Why glance (validated)
60k-match sim, random play:

| variant | med | p90 | p99 | dead% |
|---|---|---|---|---|
| baseline (clash = nothing) | 5 | 8 | 11 | 28% |
| **bind → winner GLANCE (1)** | **5** | **7** | **9** | **19%** |
| bind → winner CLEAN (2) | 4 | 7 | 9 | 18% |

GLANCE keeps median at 5 (zero retuning), tightens the tail (8→7), and cuts dead rounds 28%→19%. CLEAN is a viable "more dramatic, slightly faster" alt; not chosen.

### Rules
```
on resolve()==clash:
  onBindEntered()                       // +1 Resolve to both
  pBind = await player 3-choice (Drive=0, Slip=1, Trap=2)
  aBind = personalities.bindChoose(profile, ctx)
  d3 = (aBind − pBind) mod 3            // 0 tie, 1 player wins, 2 ai wins   (Drive>Trap>Slip>Drive)
  if d3==0: outcome = {kind:'clash', winner:null, dmg:0}      // bind stalemate, harmless spark
  else:     outcome = {kind:'glance', winner:(d3==1?'P':'A'), dmg: GLANCE + escBump}
  outcome.bind = { p:pBind, a:aBind }
```
- **Best-of-one.** A tie sparks off as the old harmless clash — no looping, never drags.
- Symmetric RPS-3 → pure skill. The bind has its own short history; the Predictor's second instance can read/feed it, and Foresight may optionally preview the opponent's bind pick (toggle).
- Cycle is reskinnable; Drive/Slip/Trap is the default. Per the `d3` formula above (the authoritative one — matches the harness), the cycle is **Drive>Slip>Trap>Drive** (player wins when `aBind = pBind+1 mod 3`). An earlier draft's parenthetical named the reverse cycle; the formula wins. Stats are convention-independent (still 50/50, ⅓ tie).
- Timing: adds ~0.8 quick choices per match on average. In timed modes give the bind a short snap timer (≈2s); in untimed solo it just waits.

### UI
The wheel hub flips to a 3-button bind prompt; both characters hold a **locked-blades** pose (§4). On resolve, hub returns to the round display.

---

## 4. ANIMATION LAYER — CSS3 pivot + strike frame — `anim.css` + `stage.js`

Limited-animation illusion from **2 frames per character** + GPU transforms. Pivot toward the stance direction on select; swap to a held **strike frame** and lunge on reveal; the outcome picks the choreography.

### Art contract (the only art rule — give to the image pipeline)
Per warrior: `idle.png` + `strike.png` (required); `hit.png` + `ko.png` (optional). Same canvas, **fixed pivot anchor** (e.g. 50% x / 88% y), transparent bg, consistent scale, **facing right.** Anchor consistency is what aligns transforms across hundreds of characters. Opponent = same art with `scaleX(-1)`.

### Stance → pose transform (lean, don't spin)
| Stance | Glyph | transform (player faces right) |
|---|---|---|
| Heaven | ↑ | `translateY(-6px) rotate(0)` weapon-high |
| Tiger | ↗ | `translate(5px,-4px) rotate(7deg)` |
| River | ↘ | `translate(5px,4px) rotate(13deg)` |
| Earth | ↓ | `translateY(5px) scaleY(.96)` crouch |
| Crane | ↙ | `translate(-5px,4px) rotate(-13deg)` |
| Shadow | ↖ | `translate(-5px,-4px) rotate(-7deg)` |

```css
.fighter-art{ transition: transform .18s cubic-bezier(.34,1.4,.5,1); transform-origin:50% 88%; will-change:transform; }
.opp{ transform: scaleX(-1); }
```

### Reveal timeline (ms)
```
t0    select   pivot to stance (idle held)                 ~180 ease
t+0   lock     wind-up translateX(-6) scale(.98)            120
REVEAL opp pivots simultaneously
t+0   strike   BOTH idle→strike.png; lunge to centre        220
t+220 IMPACT   branch on outcome
t+600 settle   strike→idle; pivot neutral; clear lunge
```

### Outcome choreography (driven by `resolve()`)
```
clean:  full lunge to contact; loser→hit.png + knockback + pip drop; finishing clean → duration ×1.6 slow-mo + flash
glance: partial lunge; loser small flinch (1 shake cycle)
whiff:  both lunge, stop short / pass-through; no contact; recover
clash:  enter LOCKED-BLADES hold (blades crossed at centre) → Clash Bind prompt (§3.5)
        bind win → short shove + loser flinch (glance) ; bind tie → spark + mutual recoil
```
Locked-blades is its own held pose (reuse `strike` mirrored toward centre, paused). Impact spark = 1-frame radial flash at hub. Screen-shake on clean reuses `.shake`.

### Performance & a11y
Transform/opacity only; 2 characters → 60fps trivially. Preload active duel's frames; lazy-load others. `@media (prefers-reduced-motion:reduce)`: skip lunges/shake, hard-swap frames, pivot instant.

### Asset hosting note (if "gcs" = Google Cloud Storage)
Serve frames from a bucket/CDN; preload `idle`+`strike` on selection, prefetch opponent's at match start. For hundreds of warriors, a per-character **sprite atlas** (one PNG + `background-position`) cuts requests and makes swaps instant. Cache-bust by content hash.

---

## 4.5 ASSISTS & ACCESSIBILITY — `assists.js` + settings

Two distinct buckets. Conflating them is the trap.

### A) Accessibility — FREE, always available, never equipped or unlocked (settings)
Colorblind-safe palette · reduced motion · larger tap targets · haptics · slower-reveal toggle · high-contrast · audio cue for each outcome. Never gated behind a slot, currency, or unlock. This is baseline quality, not a feature to earn.

### B) Assist charms — single equip slot, casual/practice ONLY, cosmetic-flavored, collectible
| Charm | Effect | Notes |
|---|---|---|
| Hourglass | +seconds on the commit timer | only meaningful where a timer exists (PvP/Blitz) |
| Eye | opponent ribbon always shows last 10 | (a permanent free Insight) |
| Compass | relationship preview always on | the clean/glance/safe rings, no hover needed |
| Scroll | round-by-round outcome log | comfort/recall |

### The one rule that protects the pillar
**Assist charms go completely inert the moment a result is ranked, seeded, shared, or PvP** — Daily Duel, leaderboards, Ghost duels, live matches all ignore the equipped charm. UI states "Assists off — competitive" on entering those modes. In casual/practice/for-fun Gauntlet (no integrity to protect) they apply freely.

### Implementation
```
mode = { id, honorsAssists:boolean }          // each mode declares this
assists.active(mode) -> charm|null            // returns equipped charm iff mode.honorsAssists
// engine/UI read assists.active(currentMode); competitive modes always get null
```
No assist touches damage or odds — only time, visible information, or clarity, and only where nothing is on the line.

---

## 5. CONTRACTS — code against these so agents don't collide — `CONTRACTS.md`

### Shared types
```
Stance = 0..5 ; Bind = 0..2
Outcome = { kind:'clean'|'glance'|'whiff'|'clash', winner:'P'|'A'|null, dmg:number, round:number, bind?:{p:Bind,a:Bind} }
Ctx = { playerHist:Stance[], aiHist:Stance[], bindHistP:Bind[], bindHistA:Bind[], aiHP, playerHP, round, lastOutcome:Outcome, resolve, mode }
```

### Module APIs (frozen)
```
predictor.predict(history)      -> { pick, confidence, predictorName }
predictor.readability(history)  -> { score, tell }
personalities.aiChoose(profile, ctx) -> Stance
personalities.bindChoose(profile, ctx) -> Bind
personalities.spendPolicy(profile, ctx) -> {action,cost}|null
resolve.gain(outcome) ; resolve.onBindEntered() ; resolve.spend(side, action) -> InfoReveal
readout.render(playerHist, aiHist, outcomes)
stage.toStance(side, stance) ; stage.playReveal(pPick, aPick, outcome) ; stage.lockBlades() ; stage.bindPrompt() -> Promise<Bind>
assists.active(mode) -> charm|null
```

### Event bus
```
'stance-selected'  {side, stance}           → stage.toStance pivots
'clash-bind'       {round}                   → stage.lockBlades + bindPrompt; engine awaits player Bind, calls personalities.bindChoose
'round-revealed'   {pPick, aPick, outcome}   → stage.playReveal, resolve.gain, readout.render
'meter-changed'    {player, ai}
'info-revealed'    {side, action, payload}   → wheel highlights
'match-over'       {winner, summary}         → readout post-match, reward stub
```
Engine is the single source of truth for `resolve(a,b)`, the bind resolution, damage, escalation, and win check. No other module computes damage.

---

## 6. PARALLEL AGENT BUILD PLAN

Single-file PWA → parallel edits to one file collide. **Build separate ES modules, each agent owns one file, integrate/inline last.** Everyone codes against Section 5 contracts so interfaces are stable before logic exists.

### Dependency graph
```
A (Predictor) ─┬─> B (Personalities, incl. bindChoose)
               ├─> C (Resolve)
               └─> D (Readout + Assists/Accessibility UI)
E (Animation, incl. locked-blades + bind prompt) ── against mock engine from day 0
F (Engine/Integration/QA, incl. Clash Bind resolution + mode/assist honor flags) ── contracts first, wire + inline + re-validate last
```

### Agent assignments
- **Agent A — `predictor.js`** *(first; blocks B/C/D)*. Ensemble + `predict` + `readability` + `humanLabel`. Unit-test crafted streams (repeat, rotation, favourite, uniform) and the bind's 3-symbol instance.
- **Agent B — `personalities.js`**. 8 profiles + `aiChoose` + `bindChoose` + builders + triggers + difficulty + `spendPolicy`. Depends on A.
- **Agent C — `resolve.js`**. Meter economy (incl. `onBindEntered`) + Insight + Foresight. Depends on A.
- **Agent D — `readout.js` + `assists.js`**. Ribbon, live unpredictability bars, post-match tell; Accessibility settings (free) and Assist charms with the inert-in-competitive rule. Depends on A + F's mode flag.
- **Agent E — `anim.css` + `stage.js`**. Pivot table, frame swap, reveal timeline, outcome choreography, **locked-blades pose + bind prompt UI**, reduced-motion. Mock engine, no deps — start immediately.
- **Agent F — `engine.js` + integration**. Author `CONTRACTS.md` + mock engine day 0 (unblocks E). Implement **Clash Bind resolution**, mode registry + `honorsAssists`, event bus. Wire A–E, **re-run the sim harness**, inline to single-file `sixfold.html`, write `CLAUDE.md` + `HANDOFF.md`.

### Order of operations
1. **F**: contracts + mock engine + event bus.
2. **A**: Predictor (+tests). **E**: animation + bind UI against mock, in parallel.
3. **B, C, D**: in parallel on A.
4. **F**: integrate, re-validate, inline, document.

### Acceptance tests (QA gate — Agent F)
- **Engine + bind unchanged:** harness gives median ≈5, p90 ≈7, dead ≈19%, reader-vs-random ≈50%.
- **Bind correctness:** random bind ≈50/50; bind tie ≈⅓ of binds; entering a bind grants +1 Resolve to both; winner deals exactly GLANCE(+escBump); a tie deals 0.
- **Predictor:** ≥90% attribution on crafted streams; `readability`≈0 uniform, ≈1 pure repeat.
- **Personalities exploitable as advertised:** scripted intended-counter wins ≥65% at mid difficulty; **Ghost 48–52%**; difficulty knob monotonically raises AI win-rate.
- **Meter honest:** over 10k rounds, total damage with spends == with spends disabled; AI and player gain identically.
- **Unpredictability feedback:** self-countering bot scores >80% unpredictability; one-stance spammer <15%.
- **Assists honest:** with a charm equipped, a competitive-flagged match yields identical timer + visible info to assists-off; casual honors the charm. Accessibility settings available with zero unlocks.
- **Animation:** 60fps mid-mobile; reduced-motion hard-swaps; every outcome (incl. bind win / bind tie) has a distinct choreography; frames align across 3+ art sets via the fixed anchor.

### Reward / Lucid Winds integration hooks
- `'match-over'` payload `{ winner, unpredictabilityPct, difficulty }` → mint sunbeams = `base + difficulty*k + unpredictabilityBonus`. Paid for skill and style, never power.
- Registry unlocks (cosmetic warriors, assist charms) keyed off wins / daily completion. No unlock affects fair-play combat.

---

## Locked decisions
- Meter = **Insight + Foresight** only (Focus cut).
- Clash → **mini-RPS bind, winner deals GLANCE** (median stays 5, dead rounds 28%→19%).
- Clash entry grants **+1 Resolve to both** regardless of bind result (preserves meter fuel).
- **Accessibility** = free/always-on settings; **Assist charms** = casual-only, inert in any ranked/seeded/shared/PvP context.
