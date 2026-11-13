"use strict";
/* node tests/duel-tidy.test.js
 * Find a rival tidies up after itself (against the in-memory database): a public
 * duel's record under sixfold/duels/<id> (both names, ratings, every pick) is
 * removed a few moments after the duel closes, each player's busy lobby entry goes
 * with it (but never a NEW search the same tab has started since), a search that
 * ends takes its lobby entry with it, the server is told to drop the record if a
 * phone drops, and nothing else in the database is touched. */
const assert = require("assert");
const FN = require("../src/firebase-net.js");
const { treeDb } = require("./treedb.js");
global.Net = global.Net || require("../src/net.js");

let passed = 0;
function ok(name, cond, extra) { assert.ok(cond, "FAIL: " + name + (extra ? " (" + extra + ")" : "")); passed++; console.log("  ok  " + name + (extra ? "  " + extra : "")); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
const T = 40; // tidy delay in the tests
const FAST = { tickMs: 15, searchTimeoutMs: 400, humanGraceMs: 400, tidyMs: T };

// the tree db, plus a record of every path the code asks the server to remove on a drop
function spyDb() {
  const db = treeDb(), drops = [];
  const ref0 = db.ref;
  db.ref = (p) => { const r = ref0(p); r.onDisconnect = () => ({ remove: () => { drops.push(p); return Promise.resolve(); }, cancel: () => Promise.resolve() }); return r; };
  db.drops = drops;
  return db;
}
function searchUntil(backend, opts, endStates) {
  endStates = endStates || ["matched", "sentinel-offer", "error"];
  return new Promise((resolve) => {
    const h = backend.findMatch(opts);
    h.onState((s) => { if (endStates.indexOf(s.state) >= 0) resolve({ s, h }); });
  });
}

(async () => {
  const db = spyDb();
  // things that are not this duel's: a friend room, another duel, another searcher
  await db.ref("sixfold/friends/NB22/room/here/uN").set({ name: "Neighbour", at: 1 });
  await db.ref("sixfold/duels/d_other/rounds/1/a").set({ commit: "c" });
  const outside = () => JSON.stringify([db._get("sixfold/friends"), db._get("sixfold/duels/d_other")]);
  const before = outside();

  const pubA = FN.FirebaseBackend(db, FAST), pubB = FN.FirebaseBackend(db, FAST);
  const [ma, mb] = await Promise.all([
    searchUntil(pubA, { selfId: "uA", name: "Ash", rating: 1000 }),
    searchUntil(pubB, { selfId: "uB", name: "Bo", rating: 1010 }),
  ]);
  ok("two searchers meet", ma.s.state === "matched" && mb.s.state === "matched");
  const sa = ma.s.session, sb = mb.s.session;
  const duels = db._get("sixfold/duels") || {};
  const id = Object.keys(duels).filter((k) => k !== "d_other")[0];
  ok("the duel's record exists with both names while it runs", !!id && duels[id].aName && duels[id].bName);
  ok("each phone asks the server to remove the duel's record if it drops",
    db.drops.filter((p) => p === "sixfold/duels/" + id).length === 2, JSON.stringify(db.drops));
  await Promise.all([sa.exchangeStance(1, 1), sb.exchangeStance(1, 3)]);
  ok("the picks are in the record during the duel", db._get("sixfold/duels/" + id + "/rounds/1/" + (duels[id].a === "uA" ? "a" : "b") + "/reveal") === 1);
  ok("both lobby entries are busy and point at the duel", db._get("sixfold/lobby/uA/matchedDuel") === id && db._get("sixfold/lobby/uB/matchedDuel") === id);

  // ---- the result: both pages close their sessions ----
  sa.close(); sb.close(); await tick(5);
  ok("just after the result the record is still there (the slower phone may be reading)", !!db._get("sixfold/duels/" + id));
  await tick(T * 3);
  ok("a few moments after the result the duel's record is gone", db._get("sixfold/duels/" + id) == null);
  ok("both busy lobby entries are gone too", db._get("sixfold/lobby/uA") == null && db._get("sixfold/lobby/uB") == null, JSON.stringify(db._get("sixfold/lobby")));
  ok("nothing else was touched", outside() === before);

  // ---- a tab that searches again at once keeps its new entry ----
  {
    const [m1, m2] = await Promise.all([
      searchUntil(pubA, { selfId: "uA", name: "Ash", rating: 1000 }),
      searchUntil(pubB, { selfId: "uB", name: "Bo", rating: 1000 }),
    ]);
    const id2 = m1.s.session && db._get("sixfold/lobby/uA/matchedDuel");
    m1.s.session.close(); m2.s.session.close();
    // uA starts a new search straight away, before the tidy runs
    const again = pubA.findMatch({ selfId: "uA", name: "Ash", rating: 1000 });
    await tick(T * 3);
    ok("the old duel's record is gone", !!id2 && db._get("sixfold/duels/" + id2) == null);
    ok("the new search's lobby entry under the same id survives the old duel's tidy", !!db._get("sixfold/lobby/uA") && db._get("sixfold/lobby/uA/status") === "searching", JSON.stringify(db._get("sixfold/lobby/uA")));
    // ---- a search that ends takes its lobby entry with it ----
    again.cancel(); await tick(5);
    ok("cancelling a search removes its lobby entry", db._get("sixfold/lobby/uA") == null);
  }
  {
    const lone = FN.FirebaseBackend(db, Object.assign({}, FAST, { searchTimeoutMs: 60 }));
    const r = await searchUntil(lone, { selfId: "uL", name: "Lone", rating: 1000 });
    ok("a lone searcher is offered a Sentinel", r.s.state === "sentinel-offer");
    ok("presence is set to vanish when the page closes", db.drops.indexOf("sixfold/lobby/uL") >= 0);
    r.h.acceptSentinel(); await tick(5);
    ok("taking the Sentinel ends the search and removes the lobby entry", db._get("sixfold/lobby/uL") == null);
  }

  // ---- a drop: the other phone's close still tidies ----
  {
    const [m1, m2] = await Promise.all([
      searchUntil(pubA, { selfId: "uA", name: "Ash", rating: 1000 }),
      searchUntil(pubB, { selfId: "uB", name: "Bo", rating: 1000 }),
    ]);
    const id3 = db._get("sixfold/lobby/uA/matchedDuel");
    let dropped = false; m1.s.session.onDisconnect(() => { dropped = true; });
    // B's page dies: the server removes its presence (its onDisconnect)
    await db.ref("sixfold/lobby/uB").remove(); await tick(5);
    ok("A sees B drop", dropped);
    m1.s.session.close(); await tick(T * 3);
    ok("A's close removes the record of the duel B dropped out of", db._get("sixfold/duels/" + id3) == null);
    ok("and A's own busy entry", db._get("sixfold/lobby/uA") == null);
    m2.s.session.close();
  }

  // ---- friend room duels keep the room's own tidy (no change) ----
  {
    const s = FN.makeRtdbSession(db, "r_x", "uR", "a", { id: "uQ", rating: 1000 }, { root: "sixfold/friends/RM22", lobby: "sixfold/friends/RM22/lobby", duels: "sixfold/friends/RM22/duels" });
    await db.ref("sixfold/friends/RM22/duels/r_x/rounds/1/a").set({ commit: "c" });
    s.close(); await tick(T * 3);
    ok("a session without a tidy option leaves its record to its owner", !!db._get("sixfold/friends/RM22/duels/r_x"));
    await db.ref("sixfold/friends/RM22").remove();
  }

  ok("the database ends with only what was there before", outside() === before && db._get("sixfold/lobby") == null, JSON.stringify(db._get("sixfold/lobby")));
  console.log(`\nduel-tidy: ${passed} passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
