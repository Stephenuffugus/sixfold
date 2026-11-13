"use strict";
/* node tests/room-leave.test.js
 * A friend who leaves in the middle of a duel always reaches the other phone as ONE
 * "gone" with why "left" and an empty seat, whichever of their writes lands first
 * (the duel's ended/<n> quit, or their left + presence removal), and also when only
 * one of them ever lands. Coming back with the same code is still "back".
 * Against the in-memory database. */
const assert = require("assert");
const FN = require("../src/firebase-net.js");
const { treeDb } = require("./treedb.js");

let passed = 0;
function ok(name, cond, extra) { assert.ok(cond, "FAIL: " + name + (extra ? " (" + extra + ")" : "")); passed++; console.log("  ok  " + name + (extra ? "  " + extra : "")); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

// A's phone, which can be switched off (its page closed: it hears and writes nothing more)
function killable(db) {
  let dead = false;
  const wrap = (r) => ({
    set: (v) => dead ? Promise.resolve() : r.set(v), update: (v) => dead ? Promise.resolve() : r.update(v),
    remove: () => dead ? Promise.resolve() : r.remove(), get: () => r.get(),
    on: (ev, cb) => r.on(ev, (s) => { if (!dead) cb(s); }), off: () => {},
    transaction: (fn) => dead ? Promise.resolve({ committed: false }) : r.transaction(fn),
    onDisconnect: () => ({ remove: () => Promise.resolve() }), push: () => ({ key: "k" }), child: (c) => wrap(r.child(c)),
  });
  return { ref: (p) => wrap(db.ref(p)), kill: () => { dead = true; } };
}
async function setup(code) {
  const db = treeDb();
  const ROOT = "sixfold/friends/" + code + "/room";
  const adb = killable(db);
  const A = await FN.openRoom(adb, code, { uid: "uA", name: "Ash", tidyMs: 20, roundMs: 0 });
  const B = await FN.openRoom(db, code, { uid: "uB", name: "Bo", tidyMs: 20, roundMs: 0 });
  const da = [], ev = [];
  A.on("duel", (d) => da.push(d));
  ["gone", "ended", "back"].forEach((k) => B.on(k, (x) => ev.push(Object.assign({ k }, x))));
  await A.setReady(true); await B.setReady(true); await tick(5);
  assert.ok(da.length === 1, "duel started");
  adb.kill();   // A's page is closing: what lands below is what the database gets
  return { db, ROOT, A, B, ev, n: da[0].n };
}
const gones = (ev) => ev.filter((e) => e.k === "gone");

(async () => {
  // the real leave: ended quit first, then left, then presence removed
  for (const [label, order] of [
    ["ended first, then left and presence", ["ended", "left", "here"]],
    ["left and presence first, then ended", ["left", "here", "ended"]],
    ["presence first, then left, then ended", ["here", "left", "ended"]],
    ["only the duel's ended ever lands", ["ended"]],
    ["only left ever lands", ["left"]],
    ["only left and the presence removal land", ["left", "here"]],
  ]) {
    const s = await setup("LV" + passed.toString(36).toUpperCase().slice(-1).replace(/[01IO]/, "Z") + "Q");
    for (const w of order) {
      if (w === "ended") await s.db.ref(s.ROOT + "/ended/" + s.n).set({ why: "quit", by: "uA" });
      if (w === "left") await s.db.ref(s.ROOT + "/left/uA").set(123);
      if (w === "here") await s.db.ref(s.ROOT + "/here/uA").remove();
      await tick(2);
    }
    const g = gones(s.ev);
    if (order[0] === "here") ok(label + ": first a drop, then the same friend left (the last word is left)", g.length === 2 && g[0].why === "lost" && g[1].why === "left", JSON.stringify(s.ev));
    else ok(label + ": exactly one gone, why left", g.length === 1 && g[0].why === "left" && g[0].name === "Ash", JSON.stringify(s.ev));
    ok(label + ": the seat is empty", s.B.view().friend === null);
    if (order.indexOf("ended") >= 0) ok(label + ": the ended quit is reported too", s.ev.some((e) => e.k === "ended" && e.why === "quit" && e.n === s.n));
    ok(label + ": the gone comes before or without the ended (the page calls the duel off on gone)", s.ev[0].k === "gone", s.ev.map((e) => e.k).join(","));
  }
  // a dropped connection (no quit, no left) is still "lost", not "left"
  {
    const s = await setup("LVDR");
    await s.db.ref(s.ROOT + "/here/uA").remove(); await tick(2);
    const g = gones(s.ev);
    ok("a dropped connection is gone with why lost", g.length === 1 && g[0].why === "lost");
  }
  // a friend who quit and then comes back with the same code is back in the seat
  {
    const s = await setup("LVBK");
    await s.db.ref(s.ROOT + "/ended/" + s.n).set({ why: "quit", by: "uA" });
    await s.db.ref(s.ROOT + "/left/uA").set(1); await s.db.ref(s.ROOT + "/here/uA").remove(); await tick(2);
    const A2 = await FN.openRoom(s.db, "LVBK", { uid: "uA", name: "Ash", tidyMs: 20, roundMs: 0 }); await tick(5);
    ok("coming back after a quit is back, and the seat is filled", s.ev.some((e) => e.k === "back") && s.B.view().friend && s.B.view().friend.uid === "uA", JSON.stringify(s.ev));
    ok("and the returning page sees its friend", A2.view().friend && A2.view().friend.uid === "uB");
  }
  // B itself quitting is never taken as B's friend leaving
  {
    const s = await setup("LVME");
    s.B.endDuel(s.n, "quit"); await tick(2);
    ok("my own quit does not empty my friend's seat", s.B.view().friend && gones(s.ev).length === 0);
  }
  console.log(`\nroom-leave: ${passed} passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
