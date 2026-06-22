/* SIXFOLD — firebase-net.js  (PHASE 2 backend — ready, not active in Phase 1)
 *
 * Implements the EXACT Net transport seam (see net.js) against a Firebase
 * Realtime Database, so going live is `Net.configure(FirebaseBackend(db))` and
 * nothing above the seam changes. This file is NOT inlined into the Phase-1 ship
 * (it's left out of tools/build.js ORDER on purpose) — Phase 1 stays lean and
 * 100% offline. Wire it per PHASE2_FIREBASE.md when you create a project.
 *
 * Why a DB and not WebRTC: a stance duel is lockstep + low-frequency (a handful
 * of tiny messages per round), so a realtime DB IS the channel — no signaling,
 * no NAT traversal. The DB does three jobs: presence (who's online), a rank-
 * banded matchmaking claim, and a per-round commit-reveal relay.
 *
 * INTEGRITY (the same rule as the mock, now enforced over the wire):
 *   each side writes a COMMIT (hash of pick+salt) first; only after BOTH commits
 *   exist does either reveal its pick; the reveal is verified against the commit
 *   (hash(reveal) must equal the stored commit). Neither side can see or change
 *   its pick after seeing the other's — a live duel is as unexploitable as solo.
 *
 * The `db` passed in is a thin abstraction (a subset of the firebase compat
 * Database API) so the relay is unit-testable against an in-memory mock:
 *   db.ref(path) -> { set, update, remove, get, on, off, transaction,
 *                     onDisconnect()->{remove}, push()->{key}, child(p) }
 * In production pass `firebase.database()` (compat) — its API is a superset.
 */
(function (root) {
  "use strict";
  var req = (typeof require !== "undefined");
  var Matchmaker = req ? require("./matchmaker.js") : root.Matchmaker;

  // djb2 — same commit hash as net.js LocalMock so behavior matches exactly
  function hash(s) { var h = 5381; s = String(s); for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
  function nowMs() { try { return Date.now(); } catch (e) { return 0; } }
  function rand() { try { return Math.random(); } catch (e) { return 0.5; } }
  function salt() { return (rand().toString(36).slice(2) + nowMs().toString(36)); }

  /* ---------------- the backend ---------------- */
  // db: thin RTDB handle. opts.now/opts.timeoutMs optional.
  function FirebaseBackend(db, opts) {
    opts = opts || {};
    if (!db) throw new Error("FirebaseBackend requires a database handle");
    var SEARCH_TIMEOUT = opts.searchTimeoutMs || (Matchmaker ? Matchmaker.SEARCH_TIMEOUT_MS : 13000);
    var TICK = opts.tickMs || 1000;

    /* presence: /lobby/$uid = {name,rating,ts,status}; auto-removed on disconnect */
    function announce(uid, info) {
      var ref = db.ref("lobby/" + uid);
      ref.onDisconnect().remove();
      return ref.set({ name: info.name || "Rival", rating: info.rating || 1000, ts: nowMs(), status: "searching" });
    }
    function leaveLobby(uid) { try { return db.ref("lobby/" + uid).remove(); } catch (e) {} }

    /* read the current lobby as a matchmaker pool */
    function readPool() {
      return db.ref("lobby").get().then(function (snap) {
        var v = (snap && snap.val && snap.val()) || {};
        return Object.keys(v).map(function (id) { return { id: id, name: v[id].name, rating: v[id].rating, online: true, status: v[id].status }; });
      });
    }

    /* try to CLAIM an opponent atomically: transaction on their lobby/lock.
       winner creates the duel and points both lobbies at it. returns duelId|null. */
    function tryClaim(myUid, opp, me) {
      var lockRef = db.ref("lobby/" + opp.id + "/lock");
      return lockRef.transaction(function (cur) {
        if (cur) return; // already claimed -> abort
        return myUid;
      }).then(function (res) {
        if (!res || !res.committed || res.snapshot.val() !== myUid) return null;
        // we own the claim — create the duel node (a = claimer, b = claimed)
        var duelId = "d_" + myUid + "_" + opp.id + "_" + nowMs();
        var duel = { a: myUid, b: opp.id, aName: me.name, bName: opp.name, aRating: me.rating, bRating: opp.rating, ts: nowMs(), state: "live" };
        return db.ref("duels/" + duelId).set(duel).then(function () {
          return Promise.all([
            db.ref("lobby/" + myUid).update({ status: "busy", matchedDuel: duelId }),
            db.ref("lobby/" + opp.id).update({ status: "busy", matchedDuel: duelId }),
          ]).then(function () { return duelId; });
        });
      }).catch(function () { return null; });
    }

    /* findMatch — drives presence + claim loop + Sentinel fallback. Same Search
       shape as the LocalMock (onState/acceptSentinel/keepSearching/cancel). */
    function findMatch(o) {
      o = o || {};
      var clock = o.clock || { setTimeout: function (f, ms) { return root.setTimeout(f, ms); }, clearTimeout: function (id) { root.clearTimeout(id); } };
      var uid = o.selfId || ("anon_" + Math.floor(rand() * 1e9));
      var me = { name: o.name || "You", rating: o.rating || 1000 };
      var elapsed = 0, cancelled = false, settled = false, nameIdx = 0;
      var subs = [];
      var emit = function (s) { if (!cancelled) subs.forEach(function (f) { try { f(s); } catch (e) {} }); };

      // listen for being claimed BY someone else (we become side 'b')
      var lobbyRef = db.ref("lobby/" + uid + "/matchedDuel");
      var onMatched = function (snap) {
        var duelId = snap && snap.val && snap.val();
        if (!duelId || settled || cancelled) return;
        settled = true; lobbyRef.off("value", onMatched);
        openClaimedDuel(duelId, uid).then(function (sess) {
          emit({ state: "matched", opponent: sess.meta, session: sess });
        });
      };
      lobbyRef.on("value", onMatched);

      announce(uid, me);

      function tick() {
        if (cancelled || settled) return;
        elapsed += TICK;
        readPool().then(function (pool) {
          if (cancelled || settled) return;
          var cand = Matchmaker.pickOpponent(pool.filter(function (p) { return p.status === "searching"; }), me.rating, elapsed, { selfId: uid });
          if (cand) {
            tryClaim(uid, cand, me).then(function (duelId) {
              if (cancelled || settled) return;
              if (duelId) {
                settled = true; lobbyRef.off("value", onMatched);
                var sess = openCreatedDuel(duelId, uid, normalize(cand));
                emit({ state: "matched", opponent: sess.meta, session: sess });
              } else { schedule(); } // lost the race — keep trying
            });
            return;
          }
          var anyone = Matchmaker.pickOpponent(pool, me.rating, Infinity, { selfId: uid });
          if (!anyone && elapsed >= Math.min(SEARCH_TIMEOUT, 2600)) return offerSentinel();
          if (elapsed >= SEARCH_TIMEOUT) return offerSentinel();
          emit({ state: "searching", elapsedMs: elapsed, half: Matchmaker.bandFor(elapsed) });
          schedule();
        }).catch(function () { schedule(); });
      }
      function offerSentinel() { if (!settled && !cancelled) { settled = true; emit({ state: "sentinel-offer", opponent: Matchmaker.sentinelFor(me.rating, rand, nameIdx++) }); } }
      function schedule() { clock.setTimeout(tick, TICK); }
      clock.setTimeout(function () { emit({ state: "searching", elapsedMs: 0, half: Matchmaker.bandFor(0) }); tick(); }, 0);

      var handle = {
        onState: function (cb) { if (typeof cb === "function") subs.push(cb); return handle; },
        acceptSentinel: function () {
          if (cancelled) return null;
          var opp = Matchmaker.sentinelFor(me.rating, rand, nameIdx++);
          // Sentinel runs LOCALLY (no peer) — reuse the same local AI session as
          // the mock so a fallback duel never needs the network at all.
          var sess = root.Net.makeSession(opp, { seed: (me.rating ^ 0x9e37) >>> 0 });
          emit({ state: "matched", opponent: opp, session: sess });
          return sess;
        },
        keepSearching: function () { if (!cancelled) { settled = false; schedule(); } return handle; },
        cancel: function () { cancelled = true; try { lobbyRef.off("value", onMatched); } catch (e) {} leaveLobby(uid); },
      };
      return handle;
    }

    function normalize(c) { return { id: c.id, name: c.name || "Rival", kind: "human", rating: c.rating || 1000, tierName: c.tierName }; }

    /* open a duel I CREATED (I am side 'a') */
    function openCreatedDuel(duelId, myUid, opponent) { return makeRtdbSession(db, duelId, myUid, "a", opponent); }
    /* open a duel I was CLAIMED into (I am side 'b'); read opponent off the node */
    function openClaimedDuel(duelId, myUid) {
      return db.ref("duels/" + duelId).get().then(function (snap) {
        var d = (snap && snap.val && snap.val()) || {};
        var opp = { id: d.a, name: d.aName || "Rival", kind: "human", rating: d.aRating || 1000 };
        return makeRtdbSession(db, duelId, myUid, "b", opp);
      });
    }

    return { name: "firebase", findMatch: findMatch, _db: db };
  }

  /* ---------------- RTDB-backed duel session (commit-reveal relay) ---------------- */
  function makeRtdbSession(db, duelId, myUid, mySide, opponent) {
    var oppSide = mySide === "a" ? "b" : "a";
    var base = "duels/" + duelId;
    var dead = false, discSubs = [];
    var lastIndependent = false;

    // generic commit-reveal exchange over a path (rounds/$n or binds/$n)
    function exchange(kind, n, myPick) {
      return new Promise(function (resolve, reject) {
        if (dead) return reject(new Error("disconnected"));
        var path = base + "/" + kind + "/" + n;
        var s = salt();
        var myCommit = hash(n + ":" + myPick + ":" + s);
        var oppRef = db.ref(path + "/" + oppSide);
        // 1) write my commit
        db.ref(path + "/" + mySide).update({ commit: myCommit }).then(function () {
          lastIndependent = true; // my reveal is gated on the opponent's commit, never their pick
          // 2) wait for opponent commit, THEN reveal mine
          var revealed = false;
          var onVal = function (snap) {
            if (dead) { try { oppRef.off("value", onVal); } catch (e) {} return reject(new Error("disconnected")); }
            var ov = (snap && snap.val && snap.val()) || {};
            if (!revealed && ov.commit != null) {
              revealed = true;
              db.ref(path + "/" + mySide).update({ reveal: myPick, salt: s });
            }
            // 3) once opponent has revealed, verify + resolve
            if (ov.reveal != null && ov.commit != null) {
              try { oppRef.off("value", onVal); } catch (e) {}
              var ok = hash(n + ":" + ov.reveal + ":" + ov.salt) === ov.commit;
              if (!ok) return reject(new Error("commit-reveal mismatch (cheat?)"));
              resolve(kind === "rounds" ? { oppPick: ov.reveal } : { oppBind: ov.reveal });
            }
          };
          oppRef.on("value", onVal);
        }).catch(reject);
      });
    }

    // watch for the opponent dropping (their lobby presence vanishing). on('value')
    // fires immediately with the current value, so only a TRANSITION present->absent
    // is a real drop — an initial null (presence not yet/ever seen) must NOT count.
    var oppPresenceRef = db.ref("lobby/" + opponent.id);
    var sawPresence = false;
    var onPres = function (snap) { var v = snap && snap.val && snap.val(); if (v) { sawPresence = true; } else if (sawPresence && !dead) { fireDisconnect("left"); } };
    try { oppPresenceRef.on("value", onPres); } catch (e) {}

    function fireDisconnect(reason) { if (dead) return; dead = true; try { oppPresenceRef.off("value", onPres); } catch (e) {} discSubs.forEach(function (f) { try { f({ reason: reason }); } catch (e) {} }); }

    return {
      meta: opponent,
      exchangeStance: function (n, myPick) { return exchange("rounds", n, myPick); },
      exchangeBind: function (n, myBind) { return exchange("binds", n, myBind); },
      onDisconnect: function (cb) { if (typeof cb === "function") discSubs.push(cb); },
      close: function () { dead = true; try { oppPresenceRef.off("value", onPres); } catch (e) {} },
      simulateDisconnect: function (r) { fireDisconnect(r || "left"); },
      _decidedIndependently: function () { return lastIndependent; },
    };
  }

  /* ---------------- activation bootstrap (INERT without config) ---------------- */
  // In the browser, going live = (a) load the firebase compat SDK, (b) define
  // window.SIXFOLD_FIREBASE = {...config}, (c) include this file in the build.
  // This never throws and does nothing unless BOTH the config and the SDK exist.
  function tryActivate() {
    try {
      var cfg = root.SIXFOLD_FIREBASE;
      var firebase = root.firebase;
      if (!cfg || !firebase || !firebase.initializeApp || !root.Net) return false;
      if (!root.firebase.apps || !root.firebase.apps.length) firebase.initializeApp(cfg);
      var db = wrapCompat(firebase.database());
      root.Net.configure(FirebaseBackend(db));
      return true;
    } catch (e) { return false; }
  }
  // adapt firebase compat Database to the thin handle the backend uses
  function wrapCompat(database) {
    function wrapRef(ref) {
      return {
        set: function (v) { return ref.set(v); },
        update: function (v) { return ref.update(v); },
        remove: function () { return ref.remove(); },
        get: function () { return ref.get(); },
        on: function (ev, cb) { return ref.on(ev, cb); },
        off: function (ev, cb) { return ref.off(ev, cb); },
        transaction: function (fn) { return ref.transaction(fn); },
        onDisconnect: function () { return ref.onDisconnect(); },
        push: function () { return ref.push(); },
        child: function (p) { return wrapRef(ref.child(p)); },
      };
    }
    return { ref: function (p) { return wrapRef(database.ref(p)); } };
  }

  var api = { FirebaseBackend: FirebaseBackend, makeRtdbSession: makeRtdbSession, tryActivate: tryActivate, _hash: hash };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.FirebaseNet = api; try { tryActivate(); } catch (e) {} }
})(typeof globalThis !== "undefined" ? globalThis : this);
