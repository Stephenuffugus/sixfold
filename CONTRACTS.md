# SIXFOLD — Frozen Contracts (spec §5)

> Every module codes against these. Do not deviate. The engine is the **single
> source of truth** for `resolve()`, bind resolution, damage, escalation, and the
> win check. No other module computes damage.

## Engine constants (validated — do not change without re-running the harness)
```
N = 6        // stances
HP = 4
CLEAN = 2
GLANCE = 1
ESC_ROUND = 6   // escalation +1 applies when round > 6
RESOLVE_MAX = 3
WINDOW = 12     // predictor lookback
```

## Shared types
```
Stance  = 0..5
Bind    = 0..2          // Drive=0, Slip=1, Trap=2  (Drive>Trap>Slip>Drive)
Outcome = {
  kind:   'clean' | 'glance' | 'whiff' | 'clash',
  winner: 'P' | 'A' | null,
  dmg:    number,
  round:  number,
  bind?:  { p:Bind, a:Bind }
}
Ctx = {
  playerHist:Stance[], aiHist:Stance[],
  bindHistP:Bind[], bindHistA:Bind[],
  aiHP, playerHP, round, lastOutcome:Outcome|null,
  resolve:{player,ai}, mode, difficulty:0..1, rng
}
```
Note: a `'clash'` Outcome is the *bind stalemate* (tie, dmg 0). A bind that is
won is reported as `kind:'glance'` with `winner` set and `bind` populated.

## Module APIs (frozen)
```
predictor.predict(history, N=6)      -> { pick, confidence:0..1, predictorName }
predictor.readability(history, N=6)  -> { score:0..1, tell }

personalities.aiChoose(profile, ctx)    -> Stance
personalities.bindChoose(profile, ctx)  -> Bind
personalities.spendPolicy(profile, ctx) -> { action, cost } | null

resolve.gain(outcome)                -> void          // whiff -> +1 both
resolve.onBindEntered()              -> void          // +1 both on entering a bind
resolve.spend(side, action)          -> InfoReveal|null
resolve.state()                      -> { player, ai }

readout.render(playerHist, aiHist, outcomes) -> void
readout.postMatch(playerHist, summary)       -> void

stage.toStance(side, stance)                 -> void
stage.playReveal(pPick, aPick, outcome)      -> Promise<void>
stage.lockBlades()                           -> void
stage.bindPrompt()                           -> Promise<Bind>

assists.active(mode)                 -> charm | null    // null iff !mode.honorsAssists
assists.settings()                   -> AccessibilitySettings
```

## Event bus (engine emits, modules subscribe)
```
'stance-selected'  {side, stance}            -> stage.toStance pivots
'clash-bind'       {round}                   -> stage.lockBlades + bindPrompt
'round-revealed'   {pPick, aPick, outcome}   -> stage.playReveal, resolve.gain, readout.render
'meter-changed'    {player, ai}
'info-revealed'    {side, action, payload}   -> wheel highlights
'match-over'       {winner, summary}         -> readout post-match, reward stub
```
`summary` (match-over) = `{ winner, rounds, unpredictabilityPct, difficulty, worstRound, tell }`

## Mode registry
```
mode = { id, honorsAssists:boolean, timed:boolean, seeded:boolean }
// competitive (ranked/seeded/shared/PvP) => honorsAssists:false
```

## The pillar (any violation = failed build)
1. Skill is the only currency; art is the only purchase. No unlock changes damage/odds.
2. Engine constants validated — change only via harness + spec update.
3. Symmetry sacred — identical mechanics/meter/bind for both fighters.
4. Resolve spends buy **information only**, never force. Damage with spends == without.
5. Assists inert in any ranked/seeded/shared/PvP context. Accessibility always free.
6. Ship one dependency-free `sixfold.html`.
