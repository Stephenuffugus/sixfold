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

// a TREE in-memory RTDB (parent reads see children, listeners fire for writes
// above or below their path, only on change) so the full findMatch pipeline
// (presence, lobby read, two-lock claim, duel node) runs against it.
function treeDb() {
  const data = {};
  const listeners = [];   // {path, cb, last}
  const segs = (p) => String(p).split("/").filter(Boolean);
  const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
  function getAt(p) { let n = data; for (const s of segs(p)) { if (n == null || typeof n !== "object" || !(s in n)) return null; n = n[s]; } return clone(n); }
  function setAt(p, v) {
    const ss = segs(p); let n = data; const chain = [];
    for (let i = 0; i < ss.length - 1; i++) { if (n[ss[i]] == null || typeof n[ss[i]] !== "object") n[ss[i]] = {}; chain.push([n, ss[i]]); n = n[ss[i]]; }
    const last = ss[ss.length - 1];
    if (v == null) delete n[last]; else n[last] = clone(v);
    for (let i = chain.length - 1; i >= 0; i--) { const [par, k] = chain[i]; if (par[k] && typeof par[k] === "object" && !Object.keys(par[k]).length) delete par[k]; }
  }
  const related = (a, b) => { const x = segs(a), y = segs(b), n = Math.min(x.length, y.length); for (let i = 0; i < n; i++) if (x[i] !== y[i]) return false; return true; };
  const snap = (v) => ({ val: () => clone(v) });
  function notify(w) {
    listeners.slice().forEach((l) => {
      if (!related(l.path, w) || listeners.indexOf(l) < 0) return;
      const v = getAt(l.path), j = JSON.stringify(v);
      if (j === l.last) return; l.last = j; l.cb(snap(v));
    });
  }
  function ref(p) {
    return {
      set: (v) => { setAt(p, v); notify(p); return Promise.resolve(); },
      update: (v) => { Object.keys(v).forEach((k) => setAt(p + "/" + k, v[k])); notify(p); return Promise.resolve(); },
      remove: () => { setAt(p, null); notify(p); return Promise.resolve(); },
      get: () => Promise.resolve(snap(getAt(p))),
      on: (ev, cb) => { const l = { path: p, cb, last: JSON.stringify(getAt(p)) }; listeners.push(l); cb(snap(getAt(p))); return cb; },
      off: (ev, cb) => { for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].path === p && listeners[i].cb === cb) listeners.splice(i, 1); },
      transaction: (fn) => { const next = fn(getAt(p)); if (next === undefined) return Promise.resolve({ committed: false, snapshot: snap(getAt(p)) }); setAt(p, next); notify(p); return Promise.resolve({ committed: true, snapshot: snap(getAt(p)) }); },
      onDisconnect: () => ({ remove: () => Promise.resolve() }),
      push: () => ({ key: "k" }),
      child: (c) => ref(p + "/" + c),
    };
  }
  return { ref, _data: data, _get: getAt };
}
// run a search until it settles on matched / sentinel-offer / a friend end state
function searchUntil(backend, opts, endStates) {
  endStates = endStates || ["matched", "sentinel-offer", "friend-missing", "friend-timeout", "error"];
  return new Promise((resolve) => {
    const h = backend.findMatch(opts); const seen = [];
    h.onState((s) => { seen.push(s.state); if (endStates.indexOf(s.state) >= 0) resolve({ s, h, seen }); });
  });
}
const FAST = { tickMs: 15, searchTimeoutMs: 150, joinWaitMs: 120 };

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
    const aCell = db._store["sixfold/duels/d2/rounds/1/a"], bCell = db._store["sixfold/duels/d2/rounds/1/b"];
    ok("each side stored BOTH a commit and a matching reveal", aCell.commit && aCell.reveal === 2 && bCell.commit && bCell.reveal === 4);
    const FNapi = require("../src/firebase-net.js");
    ok("stored reveal verifies against the stored commit (no tampering)",
      FNapi._hash("1:" + aCell.reveal + ":" + aCell.salt) === aCell.commit);
  }

  // ---- disconnect: presence vanishing poisons further exchanges ----
  {
    const db = memDb();
    // seed opponent presence so the session watches it
    await db.ref("sixfold/lobby/uidB").set({ name: "B", rating: 1000 });
    const A = FN.makeRtdbSession(db, "d3", "uidA", "a", { id: "uidB", name: "B", rating: 1000 });
    let reason = null; A.onDisconnect((d) => { reason = d.reason; });
    await db.ref("sixfold/lobby/uidB").remove();   // opponent drops
    ok("opponent presence removal fires onDisconnect", reason === "left");
    let rejected = false;
    try { await A.exchangeStance(5, 0); } catch (e) { rejected = true; }
    ok("exchange after a disconnect rejects", rejected === true);
  }

  // ---- namespacing: the public lobby + duel live under sixfold/, nothing at the root ----
  {
    const db = treeDb();
    const be = FN.FirebaseBackend(db, FAST);
    ok("public backend paths are under sixfold/", be.paths.lobby === "sixfold/lobby" && be.paths.duels === "sixfold/duels");
    // the classic race: two humans start together and each finds the other on the same tick
    const [ra, rb] = await Promise.all([
      searchUntil(be, { selfId: "uA", name: "Ann", rating: 1000 }),
      searchUntil(be, { selfId: "uB", name: "Ben", rating: 1010 }),
    ]);
    ok("two humans who claim each other at once still meet (two-lock claim)", ra.s.state === "matched" && rb.s.state === "matched",
      ra.s.state + "/" + rb.s.state);
    ok("each side sees the other as its opponent", ra.s.opponent.id === "uB" && rb.s.opponent.id === "uA");
    ok("the database root holds only the sixfold branch", JSON.stringify(Object.keys(db._data)) === '["sixfold"]', Object.keys(db._data).join(","));
    const duels = db._get("sixfold/duels") || {};
    ok("exactly one duel node was created, under sixfold/duels", Object.keys(duels).length === 1);
    const [xa, xb] = await Promise.all([ra.s.session.exchangeStance(1, 2), rb.s.session.exchangeStance(1, 5)]);
    ok("a round relays over the matched sessions", xa.oppPick === 5 && xb.oppPick === 2);
    const id = Object.keys(duels)[0];
    ok("the round's commit + reveal sit under sixfold/duels/<id>/rounds", !!(db._get("sixfold/duels/" + id + "/rounds/1/a") || {}).commit);
    ok("a public duel is not marked friendly", !ra.s.opponent.friend && !rb.s.opponent.friend);
  }

  // ---- two lone humans with a WIDE rating gap meet instead of each getting a Sentinel ----
  {
    const db = treeDb();
    const be = FN.FirebaseBackend(db, FAST);
    const [ra, rb] = await Promise.all([
      searchUntil(be, { selfId: "lo", rating: 900 }),
      searchUntil(be, { selfId: "hi", rating: 2300 }),
    ]);
    ok("a 1400-point gap still matches the only two humans online", ra.s.state === "matched" && rb.s.state === "matched", ra.seen.slice(-2).join(">"));
    const sole = await searchUntil(FN.FirebaseBackend(treeDb(), FAST), { selfId: "solo", rating: 1000 });
    ok("alone in the lobby, the Sentinel offer still comes", sole.s.state === "sentinel-offer");
  }

  // ---- friend codes ----
  {
    let bad = 0;
    for (let i = 0; i < 2000; i++) { const c = FN.newFriendCode(); if (!FN.CODE_RE.test(c) || /[IO01]/.test(c)) bad++; }
    ok("2000 generated friend codes are 4 chars from A-Z/2-9 without I, O, 0, 1", bad === 0);
    ok("typed codes are tidied (case, spaces, dash)", FN.normalizeCode(" ab-c7 ") === "ABC7");
    ok("look-alike or short codes are refused", FN.normalizeCode("AB1D") === null && FN.normalizeCode("ABOD") === null && FN.normalizeCode("ABC") === null);
    ok("friend root is sixfold/friends/<CODE>", FN.friendRoot("K7QX") === "sixfold/friends/K7QX" && FN.FirebaseBackend(treeDb(), { root: FN.friendRoot("K7QX") }).paths.lobby === "sixfold/friends/K7QX/lobby");
  }

  // ---- friend lobby: same code meets, another code sees nobody ----
  {
    const db = treeDb();
    const K1 = FN.FirebaseBackend(db, Object.assign({ root: FN.friendRoot("K7QX"), friend: true }, FAST));
    const K2 = FN.FirebaseBackend(db, Object.assign({ root: FN.friendRoot("ZZ42"), friend: true }, FAST));
    // a stranger is already HOSTING a different code, and another waits in the public lobby
    const pub = FN.FirebaseBackend(db, FAST);
    const strangerHost = K2.findMatch({ selfId: "uS", name: "Sam", rating: 1000, role: "host" });
    const strangerStates = []; strangerHost.onState((s) => strangerStates.push(s.state));
    const publicSearch = pub.findMatch({ selfId: "uP", name: "Pat", rating: 1000 });
    const pubStates = []; publicSearch.onState((s) => pubStates.push(s.state));
    const host = searchUntil(K1, { selfId: "uH", name: "Host", rating: 1000, role: "host" });
    await new Promise((r) => setTimeout(r, 60));    // the friend types the code a moment later
    const join = searchUntil(K1, { selfId: "uJ", name: "Jess", rating: 2400, role: "join" });
    const [rh, rj] = await Promise.all([host, join]);
    ok("host and joiner with the same code are matched with each other", rh.s.state === "matched" && rj.s.state === "matched"
      && rh.s.opponent.id === "uJ" && rj.s.opponent.id === "uH");
    ok("both sides know the duel is a friendly (unranked) one", rh.s.opponent.friend === true && rj.s.opponent.friend === true);
    ok("the friend duel lives under sixfold/friends/K7QX/duels", Object.keys(db._get("sixfold/friends/K7QX/duels") || {}).length === 1);
    ok("no friend player leaked into the public lobby", !db._get("sixfold/lobby/uH") && !db._get("sixfold/lobby/uJ"));
    ok("the other code's host never saw them and is still waiting", strangerStates.indexOf("matched") < 0 && !!db._get("sixfold/friends/ZZ42/lobby/uS")
      && !db._get("sixfold/friends/ZZ42/lobby/uH") && !db._get("sixfold/friends/ZZ42/duels"));
    const [xh, xj] = await Promise.all([rh.s.session.exchangeStance(1, 0), rj.s.session.exchangeStance(1, 3)]);
    ok("a round relays over the friend duel", xh.oppPick === 3 && xj.oppPick === 0);
    // a third player joins a code nobody hosts
    const lost = await searchUntil(FN.FirebaseBackend(db, Object.assign({ root: FN.friendRoot("QQQQ"), friend: true }, FAST)), { selfId: "u3", role: "join" });
    ok("joining a code nobody is hosting ends in friend-missing, never a Sentinel", lost.s.state === "friend-missing" && lost.seen.indexOf("sentinel-offer") < 0);
    ok("the public searcher was never handed a friend player", pubStates.indexOf("matched") < 0);
    strangerHost.cancel(); publicSearch.cancel();
    await new Promise((r) => setTimeout(r, 40));
    ok("cancel removes the stranger's presence", !db._get("sixfold/friends/ZZ42/lobby/uS"));
  }

  // ---- connect() refuses in plain words when there is no config (node has no window) ----
  {
    let err = null; try { await FN.connect(); } catch (e) { err = e; }
    ok("connect() without config rejects as not-configured", err && err.reason === "not-configured");
    ok("permission errors are recognised and worded plainly", FN.isPermissionError({ code: "PERMISSION_DENIED", message: "permission_denied at /sixfold" })
      && /permission denied/.test(FN.friendlyError({ reason: "permission-denied" })) && !/[\u2013\u2014]/.test(FN.friendlyError({ reason: "permission-denied" })));
  }

  console.log("\n  firebase-net.test.js: " + passed + " checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
