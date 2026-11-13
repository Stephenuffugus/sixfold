"use strict";
/* node tests/room-names.test.js
 * Names in a friend room (against the in-memory database): two players with the
 * same name are told apart by seat ("Player 1", "Player 2") everywhere the name
 * shows (the room, the duel, a call), names stay cleaned, and a nameless player
 * is a Player, never a Rival. */
const assert = require("assert");
const FN = require("../src/firebase-net.js");
const { treeDb } = require("./treedb.js");

let passed = 0;
function ok(name, cond, extra) { assert.ok(cond, "FAIL: " + name + (extra ? " (" + extra + ")" : "")); passed++; console.log("  ok  " + name + (extra ? "  " + extra : "")); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

(async () => {
  {
    const db = treeDb();
    const A = await FN.openRoom(db, "NM22", { uid: "uA", name: "", now: () => 10, roundMs: 0 });
    ok("a nameless player is Player, never Rival", A.view().me.name === "Player");
    const B = await FN.openRoom(db, "NM22", { uid: "uB", name: "Player", now: () => 20, roundMs: 0 });
    await tick();
    const a = A.view(), b = B.view();
    ok("two Players: the first seat reads Player 1 and the second Player 2 on A", a.me.name === "Player 1" && a.friend.name === "Player 2", a.me.name + " / " + a.friend.name);
    ok("and the same seats on B", b.me.name === "Player 2" && b.friend.name === "Player 1", b.me.name + " / " + b.friend.name);
    const sayB = []; B.on("say", (s) => sayB.push(s));
    A.say("call", 2); await tick();
    ok("a call is shown with the seat name", sayB.length === 1 && sayB[0].name === "Player 1");
    const da = [], dbb = []; A.on("duel", (d) => da.push(d)); B.on("duel", (d) => dbb.push(d));
    await A.setReady(true); await B.setReady(true); await tick(5);
    ok("the duel carries the seat names", da[0].aName === "Player 1" && da[0].bName === "Player 2");
    const sA = A.session(da[0]), sB = B.session(dbb[0]);
    ok("each phone's foe in the duel is the other seat", sA.meta.name === "Player 2" && sB.meta.name === "Player 1");
    sA.close(); sB.close();
    B.setName("Jessie"); await tick();
    ok("once one takes a real name, both read plainly again", A.view().me.name === "Player" && A.view().friend.name === "Jessie" && B.view().friend.name === "Player");
    B.setName("player"); await tick();
    ok("the same name in other letters still counts as the same", A.view().friend.name === "player 2" && A.view().me.name === "Player 1");
    await A.leave(); await B.leave();
  }
  {
    const db = treeDb();
    const A = await FN.openRoom(db, "NM33", { uid: "uA", name: "<i>Jo</i>", now: () => 10, roundMs: 0 });
    const B = await FN.openRoom(db, "NM33", { uid: "uB", name: "i Jo /i", now: () => 20, roundMs: 0 });
    await tick();
    ok("names are cleaned of markup the way they always were", A.view().me.name.indexOf("<") < 0 && !/[<>]/.test(B.view().friend.name));
    const C = await FN.openRoom(db, "NM44", { uid: "uC", name: "Stephen", roundMs: 0 });
    const D = await FN.openRoom(db, "NM44", { uid: "uD", name: "Jessie", roundMs: 0 });
    await tick();
    ok("different names are left alone", C.view().me.name === "Stephen" && C.view().friend.name === "Jessie" && D.view().friend.name === "Stephen");
    await A.leave(); await B.leave(); await C.leave(); await D.leave();
  }
  ok("seatNames on its own", JSON.stringify(FN.seatNames("Player", "Player")) === '["Player 1","Player 2"]' && JSON.stringify(FN.seatNames("A", "B")) === '["A","B"]');
  console.log("\n  room-names.test.js: " + passed + " checks passed");
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
