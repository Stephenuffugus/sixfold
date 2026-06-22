"use strict";
/* node tests/firebase-net.test.js
 * Exercises the Phase-2 Firebase backend's commit-reveal relay against an in-
 * memory RTDB mock (two real clients on one db). This is the part that can't be
 * tested against a live project without standing one up, so we prove it here. */
const assert = require("assert");
const FN = require("../src/firebase-net.js");

let passed = 0;
function ok(name, cond, extra) { assert.ok(cond, "FAIL: " + name + (extra ? " (" + extra + ")" : "")); passed++; console.log("  ok  " + name + (extra ? "  " + extra : "")); }

// minimal in-memory RTDB: flat path->value store with per-path value listeners,
// synchronous notify, merge-on-update, and a transaction primitive.
function memDb() {
  const store = {}, listeners = {};
  const snap = (p) => ({ val: () => (p in store ? store[p] : null) });
  const notify = (p) => (listeners[p] || []).slice().forEach((cb) => cb(snap(p)));
  function ref(p) {
    return {
      set: (v) => { store[p] = v; notify(p); return Promise.resolve(); },
      update: (v) => { store[p] = Object.assign({}, store[p] || {}, v); notify(p); return Promise.resolve(); },
      remove: () => { delete store[p]; notify(p); return Promise.resolve(); },
      get: () => Promise.resolve(snap(p)),
      on: (ev, cb) => { (listeners[p] = listeners[p] || []).push(cb); cb(snap(p)); return cb; },
      off: (ev, cb) => { listeners[p] = (listeners[p] || []).filter((f) => f !== cb); },
      transaction: (fn) => { const next = fn(p in store ? store[p] : null); if (next === undefined) return Promise.resolve({ committed: false, snapshot: snap(p) }); store[p] = next; notify(p); return Promise.resolve({ committed: true, snapshot: snap(p) }); },
      onDisconnect: () => ({ remove: () => Promise.resolve() }),
      push: () => ({ key: "k" }),
      child: (c) => ref(p + "/" + c),
    };
  }
  return { ref, _store: store };
}

(async () => {
  // ---- module is INERT without config (can't break the Phase-1 ship) ----
  {
    ok("tryActivate() is a no-op without window.SIXFOLD_FIREBASE", FN.tryActivate() === false);
    ok("requiring the backend exposes the seam factory", typeof FN.FirebaseBackend === "function" && typeof FN.makeRtdbSession === "function");
    const Net = require("../src/net.js");
    ok("Net stays on the LocalMock backend (firebase not activated)", Net.backend().name === "local-mock");
  }

  // ---- commit-reveal relay: two clients exchange a stance, agree, stay honest ----
  {
    const db = memDb();
    const A = FN.makeRtdbSession(db, "d1", "uidA", "a", { id: "uidB", name: "B", rating: 1000 });
    const B = FN.makeRtdbSession(db, "d1", "uidB", "b", { id: "uidA", name: "A", rating: 1000 });
    const [ra, rb] = await Promise.all([A.exchangeStance(1, 3), B.exchangeStance(1, 5)]);
    ok("client A receives B's stance", ra.oppPick === 5);
    ok("client B receives A's stance", rb.oppPick === 3);
    ok("A's reveal was gated on B's COMMIT, never B's pick (independent)", A._decidedIndependently() === true);
    // a second round on the same duel
    const [ra2, rb2] = await Promise.all([A.exchangeStance(2, 0), B.exchangeStance(2, 4)]);
    ok("relay works across multiple rounds", ra2.oppPick === 4 && rb2.oppPick === 0);
    // and a bind exchange
    const [ba, bb] = await Promise.all([A.exchangeBind(2, 1), B.exchangeBind(2, 2)]);
    ok("bind exchange relays correctly", ba.oppBind === 2 && bb.oppBind === 1);
  }

  // ---- commit-reveal stored shape: commit precedes reveal in the DB ----
  {
    const db = memDb();
    const A = FN.makeRtdbSession(db, "d2", "uidA", "a", { id: "uidB", rating: 1000 });
    const B = FN.makeRtdbSession(db, "d2", "uidB", "b", { id: "uidA", rating: 1000 });
    await Promise.all([A.exchangeStance(1, 2), B.exchangeStance(1, 4)]);
    const aCell = db._store["duels/d2/rounds/1/a"], bCell = db._store["duels/d2/rounds/1/b"];
    ok("each side stored BOTH a commit and a matching reveal", aCell.commit && aCell.reveal === 2 && bCell.commit && bCell.reveal === 4);
    const FNapi = require("../src/firebase-net.js");
    ok("stored reveal verifies against the stored commit (no tampering)",
      FNapi._hash("1:" + aCell.reveal + ":" + aCell.salt) === aCell.commit);
  }

  // ---- disconnect: presence vanishing poisons further exchanges ----
  {
    const db = memDb();
    // seed opponent presence so the session watches it
    await db.ref("lobby/uidB").set({ name: "B", rating: 1000 });
    const A = FN.makeRtdbSession(db, "d3", "uidA", "a", { id: "uidB", name: "B", rating: 1000 });
    let reason = null; A.onDisconnect((d) => { reason = d.reason; });
    await db.ref("lobby/uidB").remove();           // opponent drops
    ok("opponent presence removal fires onDisconnect", reason === "left");
    let rejected = false;
    try { await A.exchangeStance(5, 0); } catch (e) { rejected = true; }
    ok("exchange after a disconnect rejects", rejected === true);
  }

  console.log("\n  firebase-net.test.js: " + passed + " checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
