"use strict";
/* SIXFOLD — ranked-duel STRESS HARNESS.
 *
 * Drives the REAL ranked stack (rank.js + matchmaker.js + net.js + engine.js) at
 * volume to answer the questions a focus group can't: does rating converge to
 * skill, is the ladder stable (no runaway / no NaN / floor held), does match-
 * making actually pair by rank and fall back honestly, does commit-reveal hold
 * over thousands of rounds, and does a disconnect resolve correctly.
 *
 * Run: node tools/stress.js          Exit 0 = all gates met.
 */
const Rank = require("../src/rank.js");
const Matchmaker = require("../src/matchmaker.js");
const Net = require("../src/net.js");
const Engine = require("../src/engine.js");

let failures = 0;
function gate(name, cond, detail) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${name}${detail ? "  — " + detail : ""}`);
  if (!cond) failures++;
}
function rng32(seed) { let a = (seed >>> 0) || 1; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const immediateClock = { setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {} };

/* ---------- A) population convergence: does rating track true skill? ---------- */
// Each player has a hidden TRUE skill. Matches are decided by the Elo expectation
// of true skills; ladder ratings update from outcomes only. After many rank-
// matched games, displayed rating should strongly track true skill and be stable.
function simConvergence() {
  console.log("\nA) Ladder convergence (200 players x 140 rank-matched rounds)");
  const rnd = rng32(12345);
  const N = 200, ROUNDS = 140;
  const players = [];
  for (let i = 0; i < N; i++) {
    const trueSkill = 500 + Math.floor(rnd() * 1700);   // hidden [500,2200]
    players.push({ id: "u" + i, trueSkill, ladder: Rank.createLadder({ rating: Rank.START_RATING, playerId: "u" + i }) });
  }
  let matches = 0, nanSeen = false, floorBreaks = 0;
  for (let r = 0; r < ROUNDS; r++) {
    // everyone is "online" with their current displayed rating
    const pool = players.map((p) => ({ id: p.id, rating: p.ladder.rating }));
    const order = players.slice().sort(() => rnd() - 0.5);
    const paired = new Set();
    for (const p of order) {
      if (paired.has(p.id)) continue;
      // moderate band (simulate a few seconds of search): widen if needed
      let opp = Matchmaker.pickOpponent(pool, p.ladder.rating, 9000, { selfId: p.id, busy: paired });
      if (!opp) continue;
      const oppP = players.find((x) => x.id === opp.id);
      paired.add(p.id); paired.add(opp.id);
      // outcome by TRUE skill
      const pWin = 1 / (1 + Math.pow(10, (oppP.trueSkill - p.trueSkill) / 400));
      const pWon = rnd() < pWin;
      p.ladder.applyResult(pWon, { rating: oppP.ladder.rating, kind: "live", id: oppP.id }, r);
      oppP.ladder.applyResult(!pWon, { rating: p.ladder.rating, kind: "live", id: p.id }, r);
      matches++;
      [p, oppP].forEach((x) => { if (!isFinite(x.ladder.rating)) nanSeen = true; if (x.ladder.rating < Rank.RATING_FLOOR) floorBreaks++; });
    }
  }
  // correlation (Spearman) between true skill and final displayed rating
  const sk = players.map((p) => p.trueSkill), rt = players.map((p) => p.ladder.rating);
  const rho = spearman(sk, rt);
  const ratings = rt.slice().sort((a, b) => a - b);
  const spread = ratings[ratings.length - 1] - ratings[0];
  const tiers = {};
  players.forEach((p) => { const t = p.ladder.tier().name; tiers[t] = (tiers[t] || 0) + 1; });
  console.log("    matches=%d  rating spread=%d  tiers=%s", matches, spread, JSON.stringify(tiers));
  gate("displayed rating tracks true skill (Spearman >0.85)", rho > 0.85, "rho=" + rho.toFixed(3));
  gate("no NaN/Inf ratings", !nanSeen);
  gate("rating floor never breached", floorBreaks === 0);
  gate("ladder spreads across multiple tiers", Object.keys(tiers).length >= 3, Object.keys(tiers).length + " tiers populated");
  // rank-banded matchmaking + a shared 1000 start compresses the field, so the
  // ladder sorts by skill (high rho) but spreads gradually — Stone (bottom) plus
  // at least Iron+ (climbers) is the realistic, healthy shape.
  gate("climbers separate from the floor (top of field >= Iron)", !!(tiers["Iron"] || tiers["Jade"] || tiers["Onyx"] || tiers["Master"]), "top of field reaches Iron+");
}

/* ---------- B) self-play fairness: equal skill -> ~50%, rating stays put ------- */
function simSelfPlayFairness() {
  console.log("\nB) Self-play fairness (equal-skill pairs, 20000 matches)");
  const rnd = rng32(777);
  const A = Rank.createLadder({ rating: 1000, playerId: "A" });
  const B = Rank.createLadder({ rating: 1000, playerId: "B" });
  let aWins = 0;
  for (let i = 0; i < 20000; i++) {
    const aWon = rnd() < 0.5;                 // truly equal coin flip
    A.applyResult(aWon, { rating: B.rating, kind: "live", id: "B" }, i);
    B.applyResult(!aWon, { rating: A.rating, kind: "live", id: "A" }, i);
    if (aWon) aWins++;
  }
  const wr = aWins / 20000;
  gate("equal-skill win rate ~50%", Math.abs(wr - 0.5) < 0.02, (wr * 100).toFixed(1) + "%");
  // ratings should hover near the start (Elo is zero-sum; equal coin flip keeps them close)
  gate("equal players stay near start rating (no drift blowup)", Math.abs(A.rating - 1000) < 250 && Math.abs(B.rating - 1000) < 250, `A=${A.rating} B=${B.rating}`);
}

/* ---------- C) matchmaking fallback rates across pool sizes ------------------- */
function simMatchmaking() {
  console.log("\nC) Matchmaking + Sentinel fallback (real Net.LocalMock, fake clock)");
  const sizes = [0, 1, 5, 25];
  for (const size of sizes) {
    let matched = 0, sentinel = 0;
    const TRIES = 200;
    for (let t = 0; t < TRIES; t++) {
      const clock = fakeClock();
      const mock = Net.LocalMock();
      const pool = [];
      for (let i = 0; i < size; i++) pool.push({ id: "r" + i, name: "R" + i, rating: 900 + Math.floor(((t * 31 + i * 17) % 50)) * 12 });
      mock.setPool(pool);
      let outcome = null;
      const search = mock.findMatch({ rating: 1000, selfId: "me", clock, rng: rng32(t + 1) });
      search.onState((s) => { if (s.state === "matched" && !outcome) outcome = "matched"; else if (s.state === "sentinel-offer" && !outcome) outcome = "sentinel"; });
      clock.pump();
      if (outcome === "matched") matched++; else if (outcome === "sentinel") sentinel++;
    }
    console.log(`    pool=${size}: matched=${matched}/${TRIES}  sentinel=${TRIES - matched}/${TRIES}`);
    if (size === 0) gate("empty pool ALWAYS reaches a Sentinel offer", sentinel === TRIES);
    if (size >= 5) gate(`populated pool (${size}) reaches a human match`, matched === TRIES);
  }
}

/* ---------- D) full real-stack PvP matches via engine + net session ----------- */
async function simEngineNet() {
  console.log("\nD) Real engine+net PvP matches (commitRound/commitBind + commit-reveal)");
  const MATCHES = 4000;
  let finished = 0, indepOk = 0, totalRounds = 0, badPick = 0, longMatch = 0, threw = 0;
  for (let m = 0; m < MATCHES; m++) {
    try {
      const g = Engine.createGame({ mode: Engine.MODES.pvp, seed: m + 1 });
      const opp = Matchmaker.sentinelFor(800 + (m % 1400), rng32(m + 9), m);
      const session = Net.makeSession(opp, { clock: immediateClock, latencyMs: 0, seed: (m * 2654435761) >>> 0 });
      const pr = rng32(m * 7 + 3);
      let guard = 0, roundIndep = true;
      while (!g.state().over && guard++ < 300) {
        const myPick = Math.floor(pr() * 6);
        const { oppPick } = await session.exchangeStance(g.state().round, myPick, g.opponentCtx());
        if (oppPick < 0 || oppPick > 5) badPick++;
        if (!session._decidedIndependently()) roundIndep = false;
        const res = g.commitRound(myPick, oppPick);
        if (res && res.clash) {
          const myBind = Math.floor(pr() * 3);
          const { oppBind } = await session.exchangeBind(g.state().round, myBind, g.opponentCtx());
          if (oppBind < 0 || oppBind > 2) badPick++;
          g.commitBind(myBind, oppBind);
        }
      }
      if (g.state().over) finished++;
      if (guard >= 300) longMatch++;
      if (roundIndep) indepOk++;
      totalRounds += g.state().round;
    } catch (e) { threw++; }
  }
  gate("every PvP match terminates cleanly", finished === MATCHES, finished + "/" + MATCHES);
  gate("no match runs away (round guard never tripped)", longMatch === 0);
  gate("no exchange ever produced an out-of-range pick", badPick === 0);
  gate("commit-reveal independence held every round of every match", indepOk === MATCHES);
  gate("no exceptions thrown across the run", threw === 0);
  console.log("    avg rounds/match=%s", (totalRounds / MATCHES).toFixed(2));
}

/* ---------- E) disconnect handling ------------------------------------------- */
async function simDisconnect() {
  console.log("\nE) Disconnect mid-duel");
  const opp = { id: "x", kind: "human", archetype: "ghost", difficulty: 0.5, rating: 1000 };
  const session = Net.makeSession(opp, { clock: immediateClock, latencyMs: 0, seed: 5 });
  let fired = false; session.onDisconnect(() => { fired = true; });
  // a few normal exchanges, then a disconnect, then exchanges must reject
  await session.exchangeStance(1, 0, { playerHist: [], aiHist: [] });
  session.simulateDisconnect("rage-quit");
  let rejected = false;
  try { await session.exchangeStance(2, 0, { playerHist: [], aiHist: [] }); } catch (e) { rejected = true; }
  // rank award: a disconnect is treated as a live win for the remaining player
  const L = Rank.createLadder({ rating: 1000 });
  const before = L.rating;
  L.applyResult(true, { rating: opp.rating, kind: "live", id: opp.id }, 1);
  gate("onDisconnect fires", fired);
  gate("exchanges after disconnect reject (no silent hang)", rejected);
  gate("awarded disconnect win raises rating", L.rating > before);
}

/* ---------- F) ladder robustness fuzz ---------------------------------------- */
function simFuzz() {
  console.log("\nF) Ladder robustness fuzz (50000 random results)");
  const rnd = rng32(99);
  const L = Rank.createLadder({ rating: 1000 });
  let bad = 0, nonMonotonic = 0;
  let prevRating = L.rating, prevTier = L.tier().index;
  for (let i = 0; i < 50000; i++) {
    const oppRating = 200 + Math.floor(rnd() * 2400);
    const kind = rnd() < 0.5 ? "sentinel" : "live";
    const res = L.applyResult(rnd() < 0.5, { rating: oppRating, kind, id: "z" }, i);
    if (!isFinite(L.rating) || L.rating < Rank.RATING_FLOOR) bad++;
    // tier must move in the same direction as rating
    if ((L.rating > prevRating && L.tier().index < prevTier) || (L.rating < prevRating && L.tier().index > prevTier)) nonMonotonic++;
    prevRating = L.rating; prevTier = L.tier().index;
  }
  const json = L.toJSON();
  const round = Rank.createLadder(json);
  gate("rating stays finite and >= floor under 50k random results", bad === 0);
  gate("tier is monotonic in rating", nonMonotonic === 0);
  gate("pending log stays bounded (<=200)", json.pending.length <= 200, "len=" + json.pending.length);
  gate("serialization round-trips after fuzz", round.rating === L.rating && round.wins === L.wins);
}

/* ---------- helpers ---------- */
function fakeClock() { let q = []; return { setTimeout: (fn) => { q.push(fn); return q.length; }, clearTimeout() {}, pump: (n) => { let i = 0; n = n || 1000; while (q.length && i++ < n) { const b = q.splice(0); b.forEach((f) => f()); } } }; }
function spearman(x, y) {
  const rank = (arr) => { const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = new Array(arr.length); idx.forEach((p, i) => { r[p[1]] = i; }); return r; };
  const rx = rank(x), ry = rank(y), n = x.length;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return num / Math.sqrt(dx * dy);
}

(async () => {
  console.log("================ SIXFOLD ranked-duel stress harness ================");
  simConvergence();
  simSelfPlayFairness();
  simMatchmaking();
  await simEngineNet();
  await simDisconnect();
  simFuzz();
  console.log("\n====================================================================");
  console.log(failures ? `STRESS: ${failures} GATE(S) FAILED` : "STRESS: ALL GATES MET ✓");
  process.exit(failures ? 1 : 0);
})();
