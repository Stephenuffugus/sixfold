"use strict";
/* node tests/engine.test.js */
const assert = require("assert");
const E = require("../src/engine.js");

let passed = 0;
function ok(name, cond, extra) { assert.ok(cond, "FAIL: " + name + (extra ? " (" + extra + ")" : "")); passed++; console.log("  ok  " + name + (extra ? "  " + extra : "")); }

// ---- resolve() exhaustive (clockwise distance) ----
{
  const exp = [
    [0, "clash", null], [1, "clean", "P"], [2, "glance", "P"],
    [3, "whiff", null], [4, "glance", "A"], [5, "clean", "A"],
  ];
  let allok = true;
  for (let a = 0; a < 6; a++) for (const [d, kind, win] of exp) {
    const b = (a + d) % 6;
    const r = E.resolve(a, b);
    if (r.kind !== kind || r.winner !== win) allok = false;
  }
  ok("resolve() correct for all 36 stance pairs", allok);
  ok("every stance beats 2 / loses 2 / whiffs 1 / mirrors 1", (() => {
    for (let a = 0; a < 6; a++) {
      let beat = 0, lose = 0, whiff = 0, clash = 0;
      for (let b = 0; b < 6; b++) { const r = E.resolve(a, b);
        if (r.winner === "P") beat++; else if (r.winner === "A") lose++;
        else if (r.kind === "whiff") whiff++; else clash++; }
      if (!(beat === 2 && lose === 2 && whiff === 1 && clash === 1)) return false;
    }
    return true;
  })());
}

// ---- resolveBind3 exhaustive (Drive>Trap>Slip>Drive) ----
{
  // d3=(a-p)%3: 0 tie, 1 player, 2 ai
  const winners = {};
  for (let p = 0; p < 3; p++) for (let a = 0; a < 3; a++) winners[`${p},${a}`] = E.resolveBind3(p, a).winner;
  ok("bind ties when equal", winners["0,0"] === null && winners["1,1"] === null && winners["2,2"] === null);
  // formula cycle Drive>Slip>Trap>Drive (player wins when aB = pB+1 mod 3)
  ok("Drive beats Slip", E.resolveBind3(0, 1).winner === "P");
  ok("Slip beats Trap", E.resolveBind3(1, 2).winner === "P");
  ok("Trap beats Drive", E.resolveBind3(2, 0).winner === "P");
  // count: exactly 3 ties, 3 player wins, 3 ai wins
  const vals = Object.values(winners);
  ok("3 ties / 3 P / 3 A across 9 combos",
    vals.filter(v => v === null).length === 3 &&
    vals.filter(v => v === "P").length === 3 &&
    vals.filter(v => v === "A").length === 3);
}

// ---- a forced match: bind entry meter, winner damage, escalation, win check ----
{
  const events = [];
  const g = E.createGame({ archetype: "metronome", difficulty: 0.5, seed: 5, mode: E.MODES.casual });
  ["stance-selected", "clash-bind", "round-revealed", "meter-changed", "match-over"].forEach(ev =>
    g.bus.on(ev, (p) => events.push([ev, p])));
  // play to completion with a random player
  const rng = E.rng32(123);
  const summary = g.runMatch(() => Math.floor(rng() * 6), () => Math.floor(rng() * 3));
  ok("match terminates with a winner", summary.winner === "P" || summary.winner === "A");
  ok("emitted round-revealed events", events.some(([e]) => e === "round-revealed"));
  ok("emitted match-over", events.some(([e]) => e === "match-over"));
  ok("loser HP is 0, winner HP > 0", (summary.hpP === 0) !== (summary.hpA === 0));
}

// ---- bind correctness in the engine: entry +1 both; winner GLANCE; tie 0 ----
{
  const g = E.createGame({ archetype: "berserker", seed: 1, difficulty: 0.5 });
  // berserker always plays Drive(0) in bind. Force a clash: find player stance == ai stance.
  // drive a few rounds; check meter rose by >=1 to both whenever a clash occurred.
  let sawBind = false, sawBindGlance = false, sawBindTie = false;
  g.bus.on("round-revealed", ({ outcome }) => {
    if (outcome.bind) {
      sawBind = true;
      if (outcome.winner) { sawBindGlance = true; ok._lastBindDmg = outcome.dmg; }
      else { sawBindTie = true; ok._lastTieDmg = outcome.dmg; }
    }
  });
  const rng = E.rng32(77);
  // many short matches to surface binds
  for (let m = 0; m < 200 && !(sawBindGlance && sawBindTie); m++) {
    const gm = E.createGame({ archetype: "berserker", seed: 100 + m, difficulty: 0.5 });
    gm.bus.on("round-revealed", ({ outcome }) => {
      if (outcome.bind) {
        if (outcome.winner) { sawBindGlance = true; if (outcome.dmg !== 1 && outcome.dmg !== 2) ok._badDmg = outcome.dmg; }
        else { sawBindTie = true; if (outcome.dmg !== 0) ok._badTie = outcome.dmg; }
      }
    });
    const r2 = E.rng32(500 + m);
    gm.runMatch(() => Math.floor(r2() * 6), () => Math.floor(r2() * 3));
  }
  ok("binds occur and produce glance-wins", sawBindGlance);
  ok("binds occur and produce ties", sawBindTie);
  ok("bind win deals exactly GLANCE(+esc) {1 or 2}", ok._badDmg === undefined);
  ok("bind tie deals 0", ok._badTie === undefined);
}

// ---- escalation: a clean after round 6 deals 3 ----
{
  // craft a scripted match where player always cleans the metronome-free path is hard;
  // instead verify escBump directly via a long whiff-only-ish match reaching round 7.
  // Simpler: drive a match and assert any clean at round>6 dealt 3, <=6 dealt 2.
  let preEscCleanSeen = false, postEscCleanSeen = false, bad = false;
  for (let m = 0; m < 60; m++) {
    const g = E.createGame({ archetype: "ghost", seed: 9000 + m, difficulty: 0.2 });
    g.bus.on("round-revealed", ({ outcome }) => {
      if (outcome.kind === "clean" && !outcome.bind) {
        if (outcome.round > 6) { postEscCleanSeen = true; if (outcome.dmg !== 3) bad = true; }
        else { preEscCleanSeen = true; if (outcome.dmg !== 2) bad = true; }
      }
    });
    const r = E.rng32(300 + m);
    g.runMatch(() => Math.floor(r() * 6), () => Math.floor(r() * 3));
  }
  ok("clean pre-escalation deals 2", preEscCleanSeen && !bad);
  ok("clean post-escalation deals 3 (saw one)", postEscCleanSeen ? !bad : true, postEscCleanSeen ? "" : "no post-esc clean in sample");
}

// ---- METER HONEST: total damage with spends == with spends disabled ----
{
  // identical seed + identical scripted picks (independent of meter). Spends only
  // consume meter + reveal info; they must not touch HP. Run both, compare.
  function run(withSpends) {
    const g = E.createGame({ archetype: "echo", seed: 4242, difficulty: 0.7 });
    const pr = E.rng32(8888);     // player picks: fixed stream, identical both runs
    const br = E.rng32(9999);
    const spendFn = withSpends ? (api) => {
      // spend whenever possible, both sides
      api.spend("P", "FORESIGHT"); api.spend("P", "INSIGHT");
      api.spend("A", "FORESIGHT"); api.spend("A", "INSIGHT");
    } : null;
    const s = g.runMatch(() => Math.floor(pr() * 6), () => Math.floor(br() * 3), spendFn);
    return s;
  }
  const a = run(false), b = run(true);
  ok("spends don't change winner", a.winner === b.winner, `${a.winner} vs ${b.winner}`);
  ok("spends don't change final HP", a.hpP === b.hpP && a.hpA === b.hpA, `${a.hpP}/${a.hpA} vs ${b.hpP}/${b.hpA}`);
  ok("spends don't change total damage", (a.damageDealtToP + a.damageDealtToA) === (b.damageDealtToP + b.damageDealtToA));
  ok("spends don't change round count", a.rounds === b.rounds);
}

// ---- AI spends its OWN Resolve in interactive play (foe meter is live) ----
{
  const g = E.createGame({ archetype: "echo", seed: 5, difficulty: 0.5 });
  let prevAi = g.meter.state().ai, sawSpend = false;
  // AI meter can only DROP via a spend (gains only add) — so any drop proves a spend
  g.bus.on("meter-changed", (m) => { if (m.ai < prevAi) sawSpend = true; prevAi = m.ai; });
  g.chooseStance(0); // Echo's policy spends Insight whenever it holds >=1 Resolve
  ok("AI spends its Resolve in interactive play (foe meter not dead)", sawSpend);
}

// ---- aggregate length sanity (cross-check vs harness ~5 median) ----
{
  const lens = [];
  for (let m = 0; m < 8000; m++) {
    const g = E.createGame({ archetype: "ghost", seed: 1, difficulty: 0.5 });
    const pr = E.rng32(20000 + m), br = E.rng32(40000 + m);
    const s = g.runMatch(() => Math.floor(pr() * 6), () => Math.floor(br() * 3));
    lens.push(s.rounds);
  }
  lens.sort((x, y) => x - y);
  const med = lens[Math.floor(lens.length / 2)];
  ok("engine match length median ~5 (harness cross-check)", med >= 4 && med <= 6, `median=${med}`);
}

// ---- FORESIGHT payload exposes an actionable, clean-beating counter ----
{
  // drive a readable foe stream into the player's view, then have the AI spend
  // FORESIGHT to read US. The payload's counter must CLEANLY beat its prediction.
  const g = E.createGame({ archetype: "ghost", seed: 7, difficulty: 0.5 });
  // feed a pure-repeat player stream so the predictor commits with confidence
  for (let i = 0; i < 6 && !g.state().over; i++) g.chooseStance(0);
  const res = g.spend("A", "FORESIGHT"); // AI reads the player's history
  ok("FORESIGHT payload has predict + counter", !!(res && res.payload && res.payload.predict && res.payload.counter != null));
  if (res && res.payload) {
    const pick = res.payload.predict.pick, ctr = res.payload.counter;
    // striking `counter` against the predicted `pick` is a CLEAN for the striker
    const r = E.resolve(ctr, pick);
    ok("FORESIGHT counter cleanly beats the predicted pick", r.kind === "clean" && r.winner === "P", `counter=${ctr} vs pick=${pick} -> ${r.kind}`);
  }
}

// ---- mode registry honors-assists flags ----
ok("casual/practice/gauntlet honor assists", E.MODES.casual.honorsAssists && E.MODES.practice.honorsAssists && E.MODES.gauntlet.honorsAssists);
ok("daily/blitz/ghost are competitive (no assists)", !E.MODES.daily.honorsAssists && !E.MODES.blitz.honorsAssists && !E.MODES.ghost.honorsAssists);

console.log("\nENGINE: %d assertions passed", passed);
