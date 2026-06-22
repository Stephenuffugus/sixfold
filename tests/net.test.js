"use strict";
/* node tests/net.test.js */
const assert = require("assert");
const Net = require("../src/net.js");

let passed = 0;
function ok(name, cond, extra) { assert.ok(cond, "FAIL: " + name + (extra ? " (" + extra + ")" : "")); passed++; console.log("  ok  " + name + (extra ? "  " + extra : "")); }

// a synchronous fake clock: timers queue, pump() runs them (FIFO, batched)
function fakeClock() {
  let q = [];
  return {
    setTimeout: (fn) => { q.push(fn); return q.length; },
    clearTimeout: () => {},
    pump: (n) => { let i = 0; n = n || 500; while (q.length && i++ < n) { const b = q.splice(0); b.forEach((f) => f()); } },
    pending: () => q.length,
  };
}
const ctx = { playerHist: [], aiHist: [], bindHistP: [], bindHistA: [], round: 1 };

(async () => {
  // ---- empty pool (the honest Phase-1 default) always reaches a Sentinel offer ----
  {
    const clock = fakeClock();
    const mock = Net.LocalMock();
    const states = [];
    const search = mock.findMatch({ rating: 1000, selfId: "me", clock, rng: () => 0.5 });
    search.onState((s) => states.push(s));
    clock.pump();
    const last = states[states.length - 1];
    ok("empty pool -> searching... then sentinel-offer", states.some((s) => s.state === "searching") && last.state === "sentinel-offer");
    ok("sentinel offer carries a sentinel opponent", last.opponent && last.opponent.kind === "sentinel");
  }

  // ---- a populated pool matches a nearby human through the full pipeline ----
  {
    const clock = fakeClock();
    const mock = Net.LocalMock();
    mock.setPool([{ id: "rival1", name: "Kage", rating: 1010 }, { id: "far", rating: 1800 }]);
    let matched = null;
    const search = mock.findMatch({ rating: 1000, selfId: "me", clock, rng: () => 0.3 });
    search.onState((s) => { if (s.state === "matched") matched = s; });
    clock.pump();
    ok("nearby human is matched", matched && matched.opponent.id === "rival1" && matched.opponent.kind === "human");
    ok("match yields a live session", matched.session && typeof matched.session.exchangeStance === "function");
  }

  // ---- accepting a sentinel offer opens a session ----
  {
    const clock = fakeClock();
    const mock = Net.LocalMock();
    let session = null;
    const search = mock.findMatch({ rating: 900, selfId: "me", clock, rng: () => 0.5 });
    search.onState((s) => { if (s.state === "sentinel-offer") session = search.acceptSentinel(); });
    clock.pump();
    ok("acceptSentinel returns a session", session && typeof session.exchangeStance === "function");
    ok("session meta is the sentinel", session.meta.kind === "sentinel");
  }

  // ---- cancel stops the search ----
  {
    const clock = fakeClock();
    const mock = Net.LocalMock();
    const states = [];
    const search = mock.findMatch({ rating: 1000, clock, rng: () => 0.5 });
    search.onState((s) => states.push(s));
    search.cancel();
    clock.pump();
    ok("cancelled search emits nothing", states.length === 0);
  }

  // ---- COMMIT-REVEAL: the foe's pick is independent of my pick ----
  {
    const clock = fakeClock();
    const opp = { id: "s", name: "Sentinel", kind: "sentinel", archetype: "ghost", difficulty: 0.6, rating: 1000 };
    // two identical sessions (same seed) — feed DIFFERENT myPicks, SAME ctx
    const sA = Net.makeSession(opp, { clock, latencyMs: 1, seed: 12345 });
    const sB = Net.makeSession(opp, { clock, latencyMs: 1, seed: 12345 });
    const pa = sA.exchangeStance(1, 0, ctx);  // I commit "0"
    const pb = sB.exchangeStance(1, 5, ctx);  // I commit "5"
    clock.pump();
    const ra = await pa, rb = await pb;
    ok("foe pick is identical regardless of MY pick (commit-reveal holds)", ra.oppPick === rb.oppPick);
    ok("foe pick is a valid stance 0..5", ra.oppPick >= 0 && ra.oppPick < 6);
    ok("a commit blob was produced", typeof ra.myCommit === "string" && ra.myCommit.length > 0);
    ok("session reports it decided independently", sA._decidedIndependently() === true);
  }

  // ---- bind exchange resolves to a valid bind ----
  {
    const clock = fakeClock();
    const opp = { id: "s", kind: "sentinel", archetype: "ghost", difficulty: 0.5, rating: 1000 };
    const s = Net.makeSession(opp, { clock, latencyMs: 1, seed: 7 });
    const p = s.exchangeBind(1, 1, ctx);
    clock.pump();
    const r = await p;
    ok("bind exchange returns a valid bind 0..2", r.oppBind >= 0 && r.oppBind < 3);
  }

  // ---- disconnect fires and poisons further exchanges ----
  {
    const clock = fakeClock();
    const opp = { id: "s", kind: "human", archetype: "ghost", difficulty: 0.5, rating: 1000 };
    const s = Net.makeSession(opp, { clock, latencyMs: 1, seed: 3 });
    let discReason = null;
    s.onDisconnect((d) => { discReason = d.reason; });
    s.simulateDisconnect("rage-quit");
    ok("onDisconnect fires with a reason", discReason === "rage-quit");
    let rejected = false;
    try { await s.exchangeStance(2, 0, ctx); } catch (e) { rejected = true; }
    ok("exchange after disconnect rejects", rejected === true);
  }

  console.log("\n  net.test.js: " + passed + " checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
