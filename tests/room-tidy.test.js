"use strict";
/* node tests/room-tidy.test.js
 * The friend room keeps itself tidy (against the in-memory database): a finished
 * or called off duel leaves only its score (its rounds under .../duels/<id> go),
 * the last player out removes the room, a room found empty starts clean, and
 * nothing outside the room's own code is ever touched. */
const assert = require("assert");
const FN = require("../src/firebase-net.js");
const { treeDb } = require("./treedb.js");

let passed = 0;
function ok(name, cond, extra) { assert.ok(cond, "FAIL: " + name + (extra ? " (" + extra + ")" : "")); passed++; console.log("  ok  " + name + (extra ? "  " + extra : "")); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
const T = 30; // tidy delay in the tests

(async () => {
  const db = treeDb();
  // a neighbour code and something outside the friends branch: never touched
  await db.ref("sixfold/friends/NB22/room/here/uN").set({ name: "Neighbour", at: 1 });
  await db.ref("sixfold/friends/NB22/duels/r1_x/rounds/1/a").set({ commit: "c" });
  await db.ref("sixfold/lobby/uL").set({ name: "Lobby", rating: 1000 });
  const outside = () => JSON.stringify([db._get("sixfold/friends/NB22"), db._get("sixfold/lobby")]);
  const before = outside();

  const CODE = "TD4Y", ROOT = "sixfold/friends/TD4Y";
  const A = await FN.openRoom(db, CODE, { uid: "uA", name: "Stephen", tidyMs: T, roundMs: 0 });
  const B = await FN.openRoom(db, CODE, { uid: "uB", name: "Jessie", tidyMs: T, roundMs: 0 });
  const da = [], dbb = []; A.on("duel", (d) => da.push(d)); B.on("duel", (d) => dbb.push(d));

  // ---- duel 1 to a result ----
  await A.setReady(true); await B.setReady(true); await tick(5);
  const s1a = A.session(da[0]), s1b = B.session(dbb[0]);
  await Promise.all([s1a.exchangeStance(1, 1), s1b.exchangeStance(1, 2)]);
  ok("while duel 1 runs, its rounds are in the database", !!db._get(ROOT + "/duels/" + da[0].id + "/rounds/1"));
  A.reportResult(1, true); B.reportResult(1, false); await tick(5);
  ok("just after the result the record is still there (the slower phone may be reading)", !!db._get(ROOT + "/duels/" + da[0].id));
  await tick(T * 3);
  ok("a few moments after the result, duel 1's record is gone", db._get(ROOT + "/duels/" + da[0].id) == null);
  ok("the score stays in the room", A.view().score.me === 1 && B.view().score.friend === 1 && !!db._get(ROOT + "/room/won/1"));
  s1a.close(); s1b.close();

  // ---- duel 2 called off ----
  await A.setReady(true); await B.setReady(true); await tick(5);
  const s2a = A.session(da[1]);
  await db.ref(ROOT + "/duels/" + da[1].id + "/rounds/1/a").set({ commit: "zz" });
  A.endDuel(2, "quit"); await tick(T * 3);
  ok("a called off duel's record goes too", db._get(ROOT + "/duels/" + da[1].id) == null && !!db._get(ROOT + "/room/ended/2"));
  ok("and the score is unchanged by it", A.view().score.me === 1 && A.view().score.friend === 0);
  s2a.close();

  // ---- one leaves: the room stays for the other ----
  await A.leave(); await tick(5);
  ok("one player left: the room is still there for the other", !!db._get(ROOT + "/room/here/uB") && !!db._get(ROOT + "/room/won/1"));
  // ---- the last one out removes the room ----
  await B.leave(); await tick(5);
  ok("both left: the room record is gone", db._get(ROOT) == null, JSON.stringify(db._get(ROOT)));
  ok("nothing outside the room's own code was touched", outside() === before);

  // ---- a room found empty starts clean (a score left by a dropped session) ----
  await db.ref(ROOT + "/room/won/1").set({ w: "uOld", l: "uOld2" });
  await db.ref(ROOT + "/room/duel").set({ n: 4, id: "r4_old", a: "uOld", b: "uOld2" });
  await db.ref(ROOT + "/duels/r4_old/rounds/1/a").set({ commit: "c" });
  const C = await FN.openRoom(db, CODE, { uid: "uC", name: "Jo", tidyMs: T });
  ok("entering an empty room clears what an earlier visit left", db._get(ROOT + "/room/won") == null && db._get(ROOT + "/room/duel") == null && db._get(ROOT + "/duels") == null);
  ok("and the newcomer is in it", !!db._get(ROOT + "/room/here/uC") && C.view().nextN === 1);
  const D = await FN.openRoom(db, CODE, { uid: "uD", name: "Al", tidyMs: T });
  await tick(5);
  ok("a second player entering does not clear the first one's room", !!db._get(ROOT + "/room/here/uC") && D.view().friend && D.view().friend.name === "Jo");
  await D.leave(); await C.leave(); await tick(5);
  ok("emptied again: gone again", db._get(ROOT) == null);
  ok("still nothing outside the code touched", outside() === before);
  console.log("\n  room-tidy.test.js: " + passed + " checks passed");
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
