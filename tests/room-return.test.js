"use strict";
/* node tests/room-return.test.js
 * Coming back to a friend room (against the in-memory database): presence is
 * announced again after a reconnect, so a blink inside the grace keeps the duel
 * going; a page reloaded with ?room=CODE in the middle of a duel comes back to
 * the room with that duel called off (it cannot be rejoined: the board lived in
 * the old page), the friend is told why, and the next duel starts as usual. */
const assert = require("assert");
const FN = require("../src/firebase-net.js");
const { treeDb } = require("./treedb.js");

let passed = 0;
function ok(name, cond, extra) { assert.ok(cond, "FAIL: " + name + (extra ? " (" + extra + ")" : "")); passed++; console.log("  ok  " + name + (extra ? "  " + extra : "")); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
// a handle onto the same database that can be switched off, like a page that died
function killable(db) {
  let dead = false; const wrapped = new Map();
  return {
    kill() { dead = true; },
    ref(p) {
      const r = db.ref(p);
      const w = (f) => (...a) => (dead ? Promise.resolve({ committed: false }) : f(...a));
      return Object.assign({}, r, {
        set: w(r.set), update: w(r.update), remove: w(r.remove), transaction: w(r.transaction),
        on: (ev, cb) => { const g = (s) => { if (!dead) cb(s); }; wrapped.set(cb, g); return r.on(ev, g); },
        off: (ev, cb) => r.off(ev, wrapped.get(cb) || cb),
      });
    },
  };
}
const R = "sixfold/friends/BK22/room";

(async () => {
  // ---- a reconnect inside the grace: presence comes back by itself, the duel goes on ----
  {
    const db = treeDb();
    const A = await FN.openRoom(db, "BK22", { uid: "uA", name: "Stephen", graceMs: 80, roundMs: 0 });
    const B = await FN.openRoom(db, "BK22", { uid: "uB", name: "Jessie", graceMs: 80, roundMs: 0 });
    const da = [], dbb = []; A.on("duel", (d) => da.push(d)); B.on("duel", (d) => dbb.push(d));
    const gone = [], back = []; A.on("gone", (g) => gone.push(g)).on("back", (b) => back.push(b));
    await A.setReady(true); await B.setReady(true); await tick(5);
    const sA = A.session(da[0]), sB = B.session(dbb[0]);
    let dropped = 0; sA.onDisconnect(() => dropped++);
    // the server runs B's onDisconnect during a blink (its presence is removed)
    await db.ref(R + "/here/uB").remove(); await tick(5);
    ok("after its presence was removed by the server, B announces itself again", !!db._get(R + "/here/uB") && db._get(R + "/here/uB").name === "Jessie");
    ok("and is not marked as having left", db._get(R + "/left/uB") == null);
    await db.ref(".info/connected").set(false); await db.ref(R + "/here/uB").remove();
    await db.ref(".info/connected").set(true); await tick(5);
    ok("a reconnect (.info/connected true) also leaves B announced", !!db._get(R + "/here/uB"));
    await tick(120);
    ok("A's duel did not count the blink as a drop (inside the grace)", dropped === 0);
    const [ra, rb] = await Promise.all([sA.exchangeStance(1, 0), sB.exchangeStance(1, 4)]);
    ok("the duel carries on: the next round resolves", ra.oppPick === 4 && rb.oppPick === 0);
    ok("A's room saw B come back after each blink", A.view().friend && A.view().friend.name === "Jessie" && back.length === gone.length && back.length >= 1, gone.length + " blinks");
    sA.close(); sB.close(); await A.leave(); await B.leave();
  }

  // ---- a reload in the middle of a duel: back in the room, the duel called off ----
  {
    const db = treeDb();
    const A = await FN.openRoom(db, "BK22", { uid: "uA", name: "Stephen", graceMs: 12000, roundMs: 0 });
    const oldB = killable(db);
    const B = await FN.openRoom(oldB, "BK22", { uid: "uB", name: "Jessie", graceMs: 12000, roundMs: 0 });
    const da = [], dbb = [], endedA = []; A.on("duel", (d) => da.push(d)); B.on("duel", (d) => dbb.push(d)); A.on("ended", (e) => endedA.push(e));
    await A.setReady(true); await B.setReady(true); await tick(5);
    const sA = A.session(da[0]); let dropped = 0; sA.onDisconnect(() => dropped++);
    const pA = sA.exchangeStance(1, 2);  // A has picked; B's page is about to reload
    // B's page dies; the server removes its presence and ready
    oldB.kill(); await db.ref(R + "/here/uB").remove(); await db.ref(R + "/ready/uB").remove();
    const B2 = await FN.openRoom(db, "BK22", { uid: "uB", name: "Jessie", graceMs: 12000, roundMs: 0 });
    const d2 = []; B2.on("duel", (d) => d2.push(d));
    await tick(5);
    ok("the reloaded page is back in the room with its friend", B2.view().friend && B2.view().friend.name === "Stephen");
    ok("it knows its duel was called off (to say so)", B2.staleDuel() === 1);
    ok("it did not start the old duel again", d2.length === 0);
    ok("the duel is marked called off because of the reload", (db._get(R + "/ended/1") || {}).why === "reload");
    ok("A hears why the duel was called off", endedA.length === 1 && endedA[0].n === 1 && endedA[0].why === "reload");
    ok("no score for it", A.view().score.me === 0 && A.view().score.friend === 0);
    ok("A's duel did not also count a drop (B came back inside the grace)", dropped === 0);
    sA.close(); pA.catch(() => {});
    // the next duel starts as usual
    await A.setReady(true); await B2.setReady(true); await tick(5);
    ok("both ready again: duel 2 starts on both", da.length === 2 && d2.length === 1 && da[1].n === 2 && d2[0].id === da[1].id);
    const s2a = A.session(da[1]), s2b = B2.session(d2[0]);
    const [x, y] = await Promise.all([s2a.exchangeStance(1, 3), s2b.exchangeStance(1, 1)]);
    ok("and its rounds resolve", x.oppPick === 1 && y.oppPick === 3);
    s2a.close(); s2b.close();
    // a page opened on a room whose last duel finished normally says nothing
    A.reportResult(2, true); B2.reportResult(2, false); await tick(5);
    const B3 = await FN.openRoom(db, "BK22", { uid: "uB", name: "Jessie", roundMs: 0 });
    ok("a reload after a finished duel finds nothing to call off", B3.staleDuel() === 0 && A.view().score.me === 1);
    await B3.leave(); await A.leave();
  }

  // ---- an old tab's late disconnect lands after the reloaded page announced ----
  {
    const db = treeDb();
    const A = await FN.openRoom(db, "BK22", { uid: "uA", name: "Stephen", roundMs: 0, now: () => 100 });
    const oldB = killable(db);
    await FN.openRoom(oldB, "BK22", { uid: "uB", name: "Jessie", roundMs: 0, now: () => 50 });
    oldB.kill();                           // the old page is gone, its presence not yet removed
    const B2 = await FN.openRoom(db, "BK22", { uid: "uB", name: "Jessie", roundMs: 0, now: () => 900 });
    ok("the reloaded page keeps its seat (its first arrival time)", db._get(R + "/here/uB").at === 50 && B2.view().friend.name === "Stephen");
    await db.ref(R + "/here/uB").remove(); await tick(5);   // the late onDisconnect
    ok("the late removal is undone: B2 is announced again", !!db._get(R + "/here/uB") && A.view().friend && A.view().friend.name === "Jessie");
    await B2.leave(); await A.leave();
  }
  console.log("\n  room-return.test.js: " + passed + " checks passed");
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
