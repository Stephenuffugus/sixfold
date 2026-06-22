"use strict";
/* node tests/rank.test.js */
const assert = require("assert");
const R = require("../src/rank.js");

let passed = 0;
function ok(name, cond, extra) { assert.ok(cond, "FAIL: " + name + (extra ? " (" + extra + ")" : "")); passed++; console.log("  ok  " + name + (extra ? "  " + extra : "")); }

// ---- tiers ----
{
  ok("6 tiers, ascending floors", R.TIERS.length === 6 && R.TIERS.every((t, i) => i === 0 || t.min > R.TIERS[i - 1].min));
  ok("start rating sits at the Bronze floor", R.tierFor(R.START_RATING).key === "bronze");
  ok("below start -> Stone", R.tierFor(R.START_RATING - 200).key === "stone");
  ok("very high -> Master (top)", R.tierFor(99999).key === "master" && R.tierFor(99999).isTop);
  const mid = R.tierFor(1600);
  ok("progress within a tier is 0..1", mid.progress >= 0 && mid.progress <= 1 && mid.key === "jade");
  ok("toNext shrinks as you climb a tier", R.tierFor(1010).toNext > R.tierFor(1240).toNext);
  ok("top tier reports no next", R.tierFor(3000).next === null && R.tierFor(3000).toNext === 0);
}

// ---- Elo expectation + delta ----
{
  ok("expected ~0.5 vs equal", Math.abs(R.expected(1000, 1000) - 0.5) < 1e-9);
  ok("favourite expects >0.5", R.expected(1400, 1000) > 0.5);
  const up = R.ratingDelta(1000, 1000, true, "live");
  const dn = R.ratingDelta(1000, 1000, false, "live");
  ok("win raises, loss lowers", up > 0 && dn < 0);
  ok("equal-opp swing is symmetric (~K/2)", up === -dn && up === Math.round(R.K_BASE / 2));
  ok("beating a stronger foe gains more than an equal one",
    R.ratingDelta(1000, 1400, true, "live") > R.ratingDelta(1000, 1000, true, "live"));
  ok("losing to a weaker foe costs more",
    R.ratingDelta(1400, 1000, false, "live") < R.ratingDelta(1000, 1000, false, "live"));
  ok("sentinel stakes are reduced vs live",
    Math.abs(R.ratingDelta(1000, 1000, true, "sentinel")) < Math.abs(R.ratingDelta(1000, 1000, true, "live")));
  ok("delta never zero on a decided result",
    R.ratingDelta(2400, 200, true, "live") !== 0 && R.ratingDelta(200, 2400, false, "live") !== 0);
}

// ---- ladder lifecycle ----
{
  const L = R.createLadder({ rating: 1000, playerId: "p_test" });
  ok("fresh ladder at start rating", L.rating === 1000 && L.wins === 0 && L.losses === 0);
  const r1 = L.applyResult(true, { rating: 1000, kind: "live" }, 100);
  ok("win moves rating up + records W + streak", L.rating > 1000 && L.wins === 1 && L.streak === 1);
  ok("result reports before/after/delta", r1.before === 1000 && r1.after === L.rating && r1.delta === L.rating - 1000);
  const beforeLoss = L.rating;
  L.applyResult(false, { rating: 1000, kind: "live" }, 200);
  ok("loss lowers rating + resets streak", L.rating < beforeLoss && L.streak === 0 && L.losses === 1);
  ok("bestStreak retained after streak reset", L.bestStreak === 1);
  ok("winRate computed", L.winRate() === 50);
}

// ---- rating floor ----
{
  const L = R.createLadder({ rating: R.RATING_FLOOR + 5 });
  for (let i = 0; i < 50; i++) L.applyResult(false, { rating: 2400, kind: "live" }, i);
  ok("rating never sinks below the floor", L.rating >= R.RATING_FLOOR);
}

// ---- promotion / demotion detection ----
{
  const L = R.createLadder({ rating: R.TIERS[2].min - 8 }); // just under Iron
  const res = L.applyResult(true, { rating: 3000, kind: "live" }, 1); // big win pushes over
  ok("promotion detected when crossing a tier floor", res.promoted === true && res.tierAfter.index === res.tierBefore.index + 1);
  const L2 = R.createLadder({ rating: R.TIERS[2].min + 4 });
  const res2 = L2.applyResult(false, { rating: 100, kind: "live" }, 1);
  ok("demotion detected when dropping below a tier floor", res2.demoted === true);
}

// ---- provisional placements + placement protection ----
{
  const L = R.createLadder({ rating: R.START_RATING });
  const res = L.applyResult(false, { rating: 3000, kind: "live" }, 1);
  ok("placement loss can't fall below the entry tier", L.rating >= R.START_RATING && res.protected === true);
  ok("protected placement loss shows no demotion", res.demoted === false);
  ok("result flags inPlacements during the tryout", res.inPlacements === true);
}
{
  // provisional games move rating faster than settled games (2x K early)
  const A = R.createLadder({ rating: 1000 });
  const dProv = A.applyResult(true, { rating: 1000, kind: "live" }, 1).delta;   // placement -> 2x
  const B = R.createLadder({ rating: 1000 });
  for (let i = 0; i < R.PROVISIONAL_GAMES; i++) B.applyResult(true, { rating: 5, kind: "sentinel" }, i); // burn placements
  const dSettled = B.applyResult(true, { rating: 1000, kind: "live" }, 99).delta; // settled -> 1x
  ok("provisional placements move rating faster than settled games", dProv > dSettled, `prov=${dProv} settled=${dSettled}`);
}
{
  // after placements, protection lifts and demotion below the entry tier is possible
  const L = R.createLadder({ rating: R.START_RATING });
  for (let i = 0; i < R.PROVISIONAL_GAMES; i++) L.applyResult(true, { rating: 5, kind: "sentinel" }, i);
  for (let i = 0; i < 60; i++) L.applyResult(false, { rating: 3000, kind: "live" }, i);
  ok("after placements, a sustained skid can demote below the entry tier", L.rating < R.START_RATING && L.tier().key === "stone");
}

// ---- serialization is cloud-shaped + round-trips ----
{
  const L = R.createLadder({ rating: 1000, name: "Sten" });
  L.applyResult(true, { rating: 1100, kind: "live", id: "rivalX" }, 9);
  const json = L.toJSON();
  ["v", "playerId", "name", "rating", "wins", "losses", "streak", "peak", "pending"].forEach((k) =>
    assert.ok(k in json, "missing key " + k));
  ok("toJSON exposes the cloud-ready shape", true);
  ok("pending log records the result for later sync", json.pending.length === 1 && json.pending[0].oppId === "rivalX");
  const L2 = R.createLadder(json);
  ok("round-trips through JSON", L2.rating === L.rating && L2.wins === L.wins && L2.playerId === L.playerId);
}

// ---- ids ----
{
  ok("genId is deterministic for a seed", R.genId(42) === R.genId(42));
  ok("genId differs across seeds", R.genId(1) !== R.genId(2));
}

console.log("\n  rank.test.js: " + passed + " checks passed");
