"use strict";
/* node tests/matchmaker.test.js */
const assert = require("assert");
const M = require("../src/matchmaker.js");
const P = require("../src/personalities.js");

let passed = 0;
function ok(name, cond, extra) { assert.ok(cond, "FAIL: " + name + (extra ? " (" + extra + ")" : "")); passed++; console.log("  ok  " + name + (extra ? "  " + extra : "")); }

// ---- band widening ----
{
  ok("band widens monotonically with elapsed",
    M.bandFor(0) <= M.bandFor(5000) && M.bandFor(5000) <= M.bandFor(12000) && M.bandFor(20000) === Infinity);
  ok("first band is tight", M.bandFor(0) <= 100);
}

// ---- pickOpponent ----
{
  const pool = [
    { id: "a", rating: 1000 }, { id: "b", rating: 1060 }, { id: "c", rating: 1400 }, { id: "self", rating: 1005 },
  ];
  ok("excludes self", M.pickOpponent(pool, 1005, 0, { selfId: "self" }).id !== "self");
  ok("within a tight band picks the closest", M.pickOpponent(pool, 1005, 0, { selfId: "self" }).id === "a");
  ok("a far rival is out of the tight band but in the wide one",
    M.pickOpponent([{ id: "c", rating: 1400 }], 1000, 0) === null &&
    M.pickOpponent([{ id: "c", rating: 1400 }], 1000, 20000).id === "c");
  ok("busy opponents are skipped", M.pickOpponent(pool, 1005, 0, { selfId: "self", busy: ["a"] }).id === "b");
  ok("empty pool -> null", M.pickOpponent([], 1000, 99999) === null);
  ok("offline candidates ignored", M.pickOpponent([{ id: "x", rating: 1000, online: false }], 1000, 0) === null);
  // deterministic tiebreak: equal gaps -> lexicographically smaller id
  const tie = [{ id: "zeb", rating: 1010 }, { id: "abe", rating: 990 }];
  ok("ties broken deterministically by id", M.pickOpponent(tie, 1000, 0).id === "abe");
}

// ---- fallback timing ----
{
  ok("matched short-circuits", M.fallbackDecision(0, true) === "matched");
  ok("keeps searching before timeout", M.fallbackDecision(M.SEARCH_TIMEOUT_MS - 1, false) === "searching");
  ok("offers sentinel after timeout", M.fallbackDecision(M.SEARCH_TIMEOUT_MS, false) === "offer-sentinel");
}

// ---- rating -> difficulty (pillar: difficulty is the only knob) ----
{
  const lo = M.ratingToDifficulty(200), hi = M.ratingToDifficulty(3000);
  ok("difficulty in [0.12,1.0]", lo >= 0.12 && lo <= 1 && hi >= 0.12 && hi <= 1);
  ok("difficulty rises with rating", M.ratingToDifficulty(1000) < M.ratingToDifficulty(1800));
  ok("top ratings approach max difficulty", hi >= 0.95);
}

// ---- sentinelFor ----
{
  const s = M.sentinelFor(1000, () => 0.5, 0);
  ok("sentinel is labelled a sentinel", s.kind === "sentinel");
  ok("sentinel rating matches the player (fair-but-reduced stakes)", s.rating === 1000);
  ok("sentinel uses a real archetype", P.ids().indexOf(s.archetype) >= 0);
  ok("sentinel has a difficulty in range", s.difficulty >= 0.12 && s.difficulty <= 1);
  const lowS = M.sentinelFor(300, () => 0, 0), highS = M.sentinelFor(2300, () => 0, 0);
  ok("higher-rank sentinels skew to harder archetypes",
    (P.ARCHES[highS.archetype].stars || 3) >= (P.ARCHES[lowS.archetype].stars || 3));
  ok("sentinel name is non-empty", typeof s.name === "string" && s.name.length > 0);
}

console.log("\n  matchmaker.test.js: " + passed + " checks passed");
