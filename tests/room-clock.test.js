"use strict";
/* node tests/room-clock.test.js
 * The per round clock of a friend room duel, against the in-memory database:
 * a round where one friend never picks settles after the clock, the SAME way on
 * both phones (the absent one takes a clean hit); a late pick is refused; a pick
 * in time cancels the clock; nothing committed is revealed early; two misses in
 * a row call the duel off; a flood of talk during the clock changes nothing. */
const assert = require("assert");
const FN = require("../src/firebase-net.js");
const Engine = require("../src/engine.js");
const { treeDb } = require("./treedb.js");

let passed = 0;
function ok(name, cond, extra) { assert.ok(cond, "FAIL: " + name + (extra ? " (" + extra + ")" : "")); passed++; console.log("  ok  " + name + (extra ? "  " + extra : "")); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
const MS = 90, TK = 10;
const PATHS = { lobby: "r/here", duels: "r/duels" };
function pair(db, id) {
  const opt = { roundMs: MS, tickMs: TK };
  const a = FN.makeRtdbSession(db, id, "uA", "a", { id: "uB" }, PATHS, opt);
  const b = FN.makeRtdbSession(db, id, "uB", "b", { id: "uA" }, PATHS, opt);
  const ev = { aClock: [], bClock: [], aMiss: [], bMiss: [], aIdle: [], bIdle: [] };
  a.onClock((c) => ev.aClock.push(c)); b.onClock((c) => ev.bClock.push(c));
  a.onMissed((m) => ev.aMiss.push(m)); b.onMissed((m) => ev.bMiss.push(m));
  a.onIdle((m) => ev.aIdle.push(m)); b.onIdle((m) => ev.bIdle.push(m));
  return { a, b, ev };
}
// the engine's own verdict from each phone's point of view (P = this phone)
const verdict = (mine, theirs) => Engine.resolve(mine, theirs);

(async () => {
  // ---- a normal round is untouched by the clock ----
  {
    const db = treeDb(); const { a, b } = pair(db, "d0");
    const [ra, rb] = await Promise.all([a.exchangeStance(1, 1), b.exchangeStance(1, 4)]);
    ok("both pick in time: the round resolves on the committed picks", ra.oppPick === 4 && rb.oppPick === 1 && !ra.missed && !rb.missed);
    ok("the first commit writes a server time beside the round", Number(db._get("r/duels/d0/rounds/1/t")) > 0);
    await tick(MS * 2);
    ok("a settled round never gets a miss later", db._get("r/duels/d0/rounds/1/miss") == null);
    a.close(); b.close();
  }

  // ---- B never picks: settled after the clock, the same on both phones ----
  {
    const db = treeDb(); const { a, b, ev } = pair(db, "d1");
    const pa = a.exchangeStance(1, 2);
    await tick(MS / 3);
    const early = db._get("r/duels/d1/rounds/1/a") || {};
    ok("while the clock runs, A's commit is there but its pick is not", early.commit != null && early.reveal == null && early.salt == null);
    const lastA = ev.aClock[ev.aClock.length - 1], lastB = ev.bClock[ev.bClock.length - 1];
    ok("A's clock says it waits on the friend", lastA && lastA.waitingOn === "opp" && lastA.n === 1 && lastA.remainingMs > 0 && lastA.remainingMs <= MS);
    ok("B's clock says it waits on B", lastB && lastB.waitingOn === "me" && lastB.n === 1);
    const ra = await pa;
    await tick(TK * 4);
    ok("A settles: B missed, A's stance cuts clean", ra.missed === "opp" && ra.myPick === 2 && ra.oppPick === 3, JSON.stringify(ra));
    ok("B's phone is told the round was settled without it", ev.bMiss.length === 1 && ev.bMiss[0].n === 1 && ev.bMiss[0].oppPick === 2 && ev.bMiss[0].myPick === 3);
    // the page then plays that round through the same call, whatever it would have tapped
    const rb = await b.exchangeStance(1, 5);
    ok("B's exchange returns the settled round, not its late tap", rb.missed === "me" && rb.myPick === 3 && rb.oppPick === 2, JSON.stringify(rb));
    const va = verdict(ra.myPick, ra.oppPick), vb = verdict(rb.myPick, rb.oppPick);
    ok("the engine reads it the same on both phones: a clean hit on B", va.kind === "clean" && va.winner === "P" && vb.kind === "clean" && vb.winner === "A");
    const node = db._get("r/duels/d1/rounds/1");
    ok("B's late tap was refused: no commit from B in the round", node.miss === "b" && !(node.b && node.b.commit));
    ok("the clock is closed on both phones", ev.aClock[ev.aClock.length - 1] === null && ev.bClock[ev.bClock.length - 1] === null);
    ok("one missed round does not call the duel off", ev.aIdle.length === 0 && ev.bIdle.length === 0);
    a.close(); b.close();
  }

  // ---- a pick just inside the clock cancels it ----
  {
    const db = treeDb(); const { a, b } = pair(db, "d2");
    const pa = a.exchangeStance(1, 0);
    await tick(MS / 2);
    const rb = await b.exchangeStance(1, 3); const ra = await pa;
    ok("B picks inside the clock: a normal round", !ra.missed && !rb.missed && ra.oppPick === 3 && rb.oppPick === 0);
    await tick(MS);
    ok("and no miss is written after it", db._get("r/duels/d2/rounds/1/miss") == null);
    a.close(); b.close();
  }

  // ---- the clock on a bind ----
  {
    const db = treeDb(); const { a, b, ev } = pair(db, "d3");
    const ra = await a.exchangeBind(2, 0);
    await tick(TK * 4);
    ok("A's bind settles when B misses it: B's bind is the one A's beats", ra.missed === "opp" && ra.oppBind === 1 && Engine.resolveBind3(0, 1).winner === "P");
    ok("B's phone hears the missed bind", ev.bMiss.length === 1 && ev.bMiss[0].kind === "binds" && ev.bMiss[0].myBind === 1 && ev.bMiss[0].oppBind === 0);
    const rb = await b.exchangeBind(2, 2);
    ok("and plays it as lost on its side", rb.missed === "me" && Engine.resolveBind3(rb.myBind, rb.oppBind).winner === "A");
    a.close(); b.close();
  }

  // ---- either phone can close the clock: A's phone is the slow one here ----
  {
    const db = treeDb();
    const a = FN.makeRtdbSession(db, "d4", "uA", "a", { id: "uB" }, PATHS, { roundMs: MS, tickMs: 100000 }); // A never ticks
    const b = FN.makeRtdbSession(db, "d4", "uB", "b", { id: "uA" }, PATHS, { roundMs: MS, tickMs: TK });
    const pa = a.exchangeStance(1, 4);
    const ra = await pa;
    ok("the absent side's own phone may write the miss on itself (the clock is in the data)", ra.missed === "opp" && db._get("r/duels/d4/rounds/1/miss") === "b");
    a.close(); b.close();
  }

  // ---- miss, pick, miss: the count resets, the duel goes on ----
  {
    const db = treeDb(); const { a, b, ev } = pair(db, "d5");
    const r1 = await a.exchangeStance(1, 1); await tick(TK * 3); await b.exchangeStance(1, 0);
    await Promise.all([a.exchangeStance(2, 2), b.exchangeStance(2, 5)]);
    const r3 = await a.exchangeStance(3, 4); await tick(TK * 3); await b.exchangeStance(3, 0);
    await tick(TK * 3);
    ok("miss, pick, miss: not two in a row, the duel goes on", ev.aIdle.length === 0 && ev.bIdle.length === 0);
    ok("and each lone miss was a clean hit as before", r1.missed === "opp" && r3.missed === "opp" && ev.bMiss.length === 2);
    a.close(); b.close();
  }

  // ---- miss, miss: the duel is called off, the second miss applies no hit ----
  {
    const db = treeDb();
    const A = await FN.openRoom(db, "QD2L", { uid: "uA", name: "Stephen", roundMs: MS, tickMs: TK });
    const B = await FN.openRoom(db, "QD2L", { uid: "uB", name: "Jessie", roundMs: MS, tickMs: TK });
    const da = [], dbb = []; A.on("duel", (d) => da.push(d)); B.on("duel", (d) => dbb.push(d));
    await A.setReady(true); await B.setReady(true); await tick(5);
    const sA = A.session(da[0]), sB = B.session(dbb[0]);
    const aIdle = [], bIdle = [], bMiss = []; sA.onIdle((x) => aIdle.push(x)); sB.onIdle((x) => bIdle.push(x)); sB.onMissed((m) => bMiss.push(m));
    // round 1: B misses, a clean hit
    const r1 = await sA.exchangeStance(1, 3); await tick(TK * 3); await sB.exchangeStance(1, 0);
    ok("miss 1 is a clean hit", r1.missed === "opp" && bMiss.length === 1 && aIdle.length === 0);
    // round 2: B misses again
    let settled2 = null; sA.exchangeStance(2, 1).then((r) => { settled2 = r; }, () => { settled2 = "closed"; });
    await tick(MS + TK * 6);
    ok("miss 2 in a row: both phones call the duel off", aIdle.length === 1 && bIdle.length === 1 && aIdle[0].side === "b" && !aIdle[0].mine && bIdle[0].mine && aIdle[0].n === 2);
    ok("the second miss applies no hit on either phone", settled2 === null && bMiss.length === 1);
    // what the page does with it: end the duel as idle, no result
    A.endDuel(1, "idle"); await tick(5);
    sA.close(); sB.close(); await tick(5);
    ok("called off as idle, no knockout recorded", (db._get("sixfold/friends/QD2L/room/ended/1") || {}).why === "idle" && db._get("sixfold/friends/QD2L/room/won") == null);
    ok("score unchanged on both sides", A.view().score.me === 0 && A.view().score.friend === 0 && B.view().score.me === 0 && B.view().score.friend === 0);
    await A.leave(); await B.leave();
  }

  // ---- a flood of talk during the clock changes nothing ----
  {
    const db = treeDb();
    const A = await FN.openRoom(db, "T4LK", { uid: "uA", name: "Stephen", roundMs: MS, tickMs: TK });
    const B = await FN.openRoom(db, "T4LK", { uid: "uB", name: "Jessie", roundMs: MS, tickMs: TK });
    const da = [], dbb = []; A.on("duel", (d) => da.push(d)); B.on("duel", (d) => dbb.push(d));
    await A.setReady(true); await B.setReady(true); await tick(5);
    const sA = A.session(da[0]), sB = B.session(dbb[0]);
    const missed = []; sB.onMissed((m) => missed.push(m));
    const pa = sA.exchangeStance(1, 5);
    await tick(5);
    const t0 = db._get("sixfold/friends/T4LK/duels/" + da[0].id + "/rounds/1/t");
    for (let i = 0; i < 60; i++) { await db.ref("sixfold/friends/T4LK/room/say/uB").set({ k: "c", v: i % 6, t: i, id: "f" + i }); await db.ref("sixfold/friends/T4LK/room/say/uA").set({ k: "e", v: "fire", t: i, id: "g" + i }); }
    ok("talk flood: A's pick still hidden mid clock", (db._get("sixfold/friends/T4LK/duels/" + da[0].id + "/rounds/1/a") || {}).reveal == null);
    const ra = await pa; await tick(TK * 4);
    const rb = await sB.exchangeStance(1, 0);
    ok("talk flood: the round settles by the clock exactly as without it", ra.missed === "opp" && ra.oppPick === 0 && rb.myPick === 0 && rb.oppPick === 5 && missed.length === 1);
    ok("talk flood: the clock's time was not moved", db._get("sixfold/friends/T4LK/duels/" + da[0].id + "/rounds/1/t") === t0);
    sA.close(); sB.close(); await A.leave(); await B.leave();
  }

  ok("a room duel's clock is 30 s by default", FN.ROUND_MS === 30000);
  console.log("\n  room-clock.test.js: " + passed + " checks passed");
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
