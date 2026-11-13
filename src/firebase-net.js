/* SIXFOLD — firebase-net.js  (PHASE 2 backend, live: inlined and connected on demand)
 *
 * Implements the EXACT Net transport seam (see net.js) against a Firebase
 * Realtime Database, so going live is `Net.configure(FirebaseBackend(db))` and
 * nothing above the seam changes. It is inlined by tools/build.js; the SDK itself
 * is fetched only when a player opens online play (see connect() below), so the
 * offline game still boots and plays with the network off.
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
 *
 * NAMESPACE: every path lives under a root (default "sixfold"), so the studio's
 * shared database keeps Sixfold in its own branch:
 *   sixfold/lobby/$uid, sixfold/duels/$id            (public "Find a rival")
 *   sixfold/friends/$CODE/lobby, .../duels           (private "Play a friend")
 * A friend duel is the SAME protocol (presence, claim, commit-reveal) run inside
 * a private root: pass opts.root = friendRoot(code) and opts.friend = true.
 *
 * LIVE: the SDK is NOT loaded with the page. connect() fetches it on demand when a
 * player opens online play, probes the database, and rejects with plain words if
 * anything is unreachable or refused, so the offline game never waits on the net.
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
  // anything read off the wire is untrusted: names land in the page, so keep them
  // short and free of markup; ratings are clamped numbers.
  function cleanName(n) { var s = String(n == null ? "" : n).replace(/[<>&"'`\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 20); return s || "Rival"; }
  function cleanRating(r) { r = Number(r); return (r >= 0 && r <= 5000) ? Math.round(r) : 1000; }

  /* ---------------- namespacing + friend codes ---------------- */
  var ROOT = "sixfold";
  // friend codes: 4 chars from A-Z + 2-9 without the look-alikes I, O, 0, 1.
  // (The database rule checks the same set: /^[A-HJ-NP-Z2-9]{4}$/.)
  var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;
  function newFriendCode(rng) {
    var r = (typeof rng === "function") ? rng : rand, s = "";
    for (var i = 0; i < 4; i++) s += CODE_ALPHABET.charAt(Math.floor(r() * CODE_ALPHABET.length) % CODE_ALPHABET.length);
    return s;
  }
  // tidy what a player typed: upper case, drop spaces/dashes; null if not a code
  function normalizeCode(str) {
    var s = String(str == null ? "" : str).toUpperCase().replace(/[^A-Z0-9]/g, "");
    return CODE_RE.test(s) ? s : null;
  }
  function friendRoot(code) { return ROOT + "/friends/" + code; }
  function pathsFor(rootPath) {
    var r = String(rootPath || ROOT).replace(/\/+$/, "");
    return { root: r, lobby: r + "/lobby", duels: r + "/duels" };
  }

  /* ---------------- the backend ---------------- */
  // db: thin RTDB handle. opts.root (default "sixfold"), opts.friend (private
  // lobby: no rating band, no Sentinel), opts.searchTimeoutMs/tickMs optional.
  function FirebaseBackend(db, opts) {
    opts = opts || {};
    if (!db) throw new Error("FirebaseBackend requires a database handle");
    var SEARCH_TIMEOUT = opts.searchTimeoutMs || (Matchmaker ? Matchmaker.SEARCH_TIMEOUT_MS : 13000);
    var TICK = opts.tickMs || 1000;
    var P = pathsFor(opts.root);
    var FRIEND = !!opts.friend;
    // public: past the timeout, a human who is still searching gets a short grace
    // (any rating) before the Sentinel offer, so two lone humans always meet.
    var HUMAN_GRACE = opts.humanGraceMs == null ? 8000 : opts.humanGraceMs;
    var FRIEND_WAIT = opts.friendWaitMs || 10 * 60 * 1000;  // host waits up to 10 min
    var JOIN_WAIT = opts.joinWaitMs || 8000;                // joiner gives up on an empty code

    /* presence: <root>/lobby/$uid = {name,rating,ts,status}; auto-removed on disconnect */
    function announce(uid, info) {
      var ref = db.ref(P.lobby + "/" + uid);
      try { ref.onDisconnect().remove(); } catch (e) {}
      var w = ref.set({ name: info.name || "Rival", rating: info.rating || 1000, ts: nowMs(), status: "searching" });
      if (w && w.catch) w.catch(function () {});
      return w;
    }
    function leaveLobby(uid) { try { var w = db.ref(P.lobby + "/" + uid).remove(); if (w && w.catch) w.catch(function () {}); return w; } catch (e) {} }

    /* read the current lobby as a matchmaker pool */
    function readPool() {
      return db.ref(P.lobby).get().then(function (snap) {
        var v = (snap && snap.val && snap.val()) || {};
        return Object.keys(v).map(function (id) { var e = v[id] || {}; return { id: id, name: cleanName(e.name), rating: cleanRating(e.rating), online: true, status: e.status }; });
      });
    }

    /* try to CLAIM an opponent atomically. Two locks, mine first then theirs:
       if both searchers claim each other at the same instant, each holds its OWN
       lock, so neither can take the other's and both back off and retry (instead
       of building two duels that never meet). A searcher already claimed by
       someone else finds its own lock taken and stands down. The winner creates
       the duel and points both lobbies at it. returns duelId|null. */
    function takeLock(ref, myUid) {
      return ref.transaction(function (cur) {
        if (cur) return; // already held -> abort
        return myUid;
      }).then(function (res) { return !!(res && res.committed && res.snapshot && res.snapshot.val() === myUid); });
    }
    function dropLock(ref, myUid) {
      return ref.transaction(function (cur) { if (cur === myUid) return null; return; })
        .then(function () {}, function () {});
    }
    function tryClaim(myUid, opp, me) {
      var myLock = db.ref(P.lobby + "/" + myUid + "/lock");
      var oppLock = db.ref(P.lobby + "/" + opp.id + "/lock");
      return takeLock(myLock, myUid).then(function (mine) {
        if (!mine) return null;                     // someone claimed ME: their duel is on its way
        return takeLock(oppLock, myUid).then(function (theirs) {
          if (!theirs) return dropLock(myLock, myUid).then(function () { return null; });
          // the rival must still be present (a transaction on a vanished node would
          // recreate it as a ghost we then wait on forever)
          return db.ref(P.lobby + "/" + opp.id).get().then(function (snap) {
            var v = (snap && snap.val && snap.val()) || {};
            if (!v.name) {
              return Promise.all([dropLock(myLock, myUid), db.ref(P.lobby + "/" + opp.id).remove()]).then(function () { return null; });
            }
            // we own the claim — create the duel node (a = claimer, b = claimed)
            var duelId = "d_" + myUid + "_" + opp.id + "_" + nowMs();
            var duel = { a: myUid, b: opp.id, aName: me.name, bName: opp.name, aRating: me.rating, bRating: opp.rating, ts: nowMs(), state: "live" };
            return db.ref(P.duels + "/" + duelId).set(duel).then(function () {
              return Promise.all([
                db.ref(P.lobby + "/" + myUid).update({ status: "busy", matchedDuel: duelId }),
                db.ref(P.lobby + "/" + opp.id).update({ status: "busy", matchedDuel: duelId }),
              ]).then(function () { return duelId; });
            });
          });
        });
      }).catch(function () { return null; });
    }

    /* findMatch — drives presence + claim loop + Sentinel fallback. Same Search
       shape as the LocalMock (onState/acceptSentinel/keepSearching/cancel). */
    function findMatch(o) {
      o = o || {};
      var clock = o.clock || { setTimeout: function (f, ms) { return root.setTimeout(f, ms); }, clearTimeout: function (id) { root.clearTimeout(id); } };
      var uid = o.selfId || ("anon_" + Math.floor(rand() * 1e9));
      var me = { name: o.name || "Rival", rating: o.rating || 1000 };
      var role = o.role === "join" ? "join" : "host";   // friend lobby only
      var elapsed = 0, cancelled = false, settled = false, matched = false, nameIdx = 0;
      var subs = [];
      var emit = function (s) { if (!cancelled) subs.forEach(function (f) { try { f(s); } catch (e) {} }); };

      // listen for being claimed BY someone else (we become side 'b')
      // (Our OWN claim also writes this field, and a real database fires local
      // writes at once, so openClaimedDuel reads the duel node to learn its side.)
      var lobbyRef = db.ref(P.lobby + "/" + uid + "/matchedDuel");
      var onMatched = function (snap) {
        var duelId = snap && snap.val && snap.val();
        // a human claim is honoured even while the Sentinel offer is showing
        if (!duelId || matched || cancelled) return;
        matched = settled = true; lobbyRef.off("value", onMatched);
        openClaimedDuel(duelId, uid).then(function (sess) {
          emit({ state: "matched", opponent: sess.meta, session: sess });
        }, function () { emit({ state: "error", reason: "duel-unreadable" }); });
      };
      lobbyRef.on("value", onMatched);

      announce(uid, me);

      function tick() {
        if (cancelled || settled) return;
        elapsed += TICK;
        readPool().then(function (pool) {
          if (cancelled || settled) return;
          var searching = pool.filter(function (p) { return p.status === "searching"; });
          // the rating band: a friend lobby has none (you came for that person);
          // the public lobby widens to ANY rating once the timeout is reached, so
          // two lone humans far apart in rating still meet instead of each being
          // handed a Sentinel (the band schedule alone stops at +-500 before 13s).
          var bandElapsed = (FRIEND || elapsed >= SEARCH_TIMEOUT) ? Infinity : elapsed;
          var cand = Matchmaker.pickOpponent(searching, me.rating, bandElapsed, { selfId: uid });
          if (cand) {
            tryClaim(uid, cand, me).then(function (duelId) {
              if (cancelled || settled) return;
              if (duelId) {
                matched = settled = true; lobbyRef.off("value", onMatched);
                var sess = openCreatedDuel(duelId, uid, normalize(cand));
                emit({ state: "matched", opponent: sess.meta, session: sess });
              } else { schedule(true); } // lost the race — retry after a jittered beat
            });
            return;
          }
          // "is any other human waiting?" counts only SEARCHING entries: a finished
          // duel leaves a busy entry behind until that tab closes.
          var anyone = Matchmaker.pickOpponent(searching, me.rating, Infinity, { selfId: uid });
          if (FRIEND) {
            if (role === "join" && !anyone && elapsed >= JOIN_WAIT) return endFriend("friend-missing");
            if (elapsed >= FRIEND_WAIT) return endFriend("friend-timeout");
            emit({ state: "searching", elapsedMs: elapsed, half: Infinity, friend: true });
            return schedule();
          }
          if (!anyone && elapsed >= Math.min(SEARCH_TIMEOUT, 2600)) return offerSentinel();
          if (elapsed >= SEARCH_TIMEOUT + (anyone ? HUMAN_GRACE : 0)) return offerSentinel();
          emit({ state: "searching", elapsedMs: elapsed, half: elapsed >= SEARCH_TIMEOUT ? Infinity : Matchmaker.bandFor(elapsed) });
          schedule();
        }).catch(function (e) {
          if (cancelled || settled) return;
          if (isPermissionError(e)) { settled = true; return emit({ state: "error", reason: "permission-denied" }); }
          schedule();
        });
      }
      function endFriend(why) {
        if (settled || cancelled) return;
        settled = true; try { lobbyRef.off("value", onMatched); } catch (e) {}
        leaveLobby(uid);
        emit({ state: why });
      }
      function offerSentinel() { if (!settled && !cancelled) { settled = true; emit({ state: "sentinel-offer", opponent: Matchmaker.sentinelFor(me.rating, rand, nameIdx++) }); } }
      function schedule(jitter) { clock.setTimeout(tick, jitter ? Math.round(TICK * (0.35 + rand())) : TICK); }
      clock.setTimeout(function () { emit({ state: "searching", elapsedMs: 0, half: Matchmaker.bandFor(0) }); tick(); }, 0);

      var handle = {
        onState: function (cb) { if (typeof cb === "function") subs.push(cb); return handle; },
        acceptSentinel: function () {
          if (cancelled || matched || FRIEND) return null;
          matched = settled = true;
          leaveLobby(uid); try { lobbyRef.off("value", onMatched); } catch (e) {}
          var opp = Matchmaker.sentinelFor(me.rating, rand, nameIdx++);
          // Sentinel runs LOCALLY (no peer) — reuse the same local AI session as
          // the mock so a fallback duel never needs the network at all.
          var sess = root.Net.makeSession(opp, { seed: (me.rating ^ 0x9e37) >>> 0 });
          emit({ state: "matched", opponent: opp, session: sess });
          return sess;
        },
        keepSearching: function () { if (!cancelled && !matched) { settled = false; elapsed = 0; schedule(); } return handle; },
        cancel: function () { cancelled = true; try { lobbyRef.off("value", onMatched); } catch (e) {} leaveLobby(uid); },
      };
      return handle;
    }

    function normalize(c) { return { id: c.id, name: c.name || "Rival", kind: "human", rating: c.rating || 1000, tierName: c.tierName, friend: FRIEND }; }

    /* open a duel I CREATED (I am side 'a') */
    function openCreatedDuel(duelId, myUid, opponent) { return makeRtdbSession(db, duelId, myUid, "a", opponent, P); }
    /* open a duel I was pointed at; the duel node says which side I am (normally
       'b', the claimed one; 'a' if this is our own claim echoing back) */
    function openClaimedDuel(duelId, myUid) {
      return db.ref(P.duels + "/" + duelId).get().then(function (snap) {
        var d = (snap && snap.val && snap.val()) || {};
        if (!d.a || !d.b) throw new Error("duel node missing");
        var mine = d.a === myUid ? "a" : "b";
        var opp = mine === "a"
          ? { id: d.b, name: cleanName(d.bName), kind: "human", rating: cleanRating(d.bRating), friend: FRIEND }
          : { id: d.a, name: cleanName(d.aName), kind: "human", rating: cleanRating(d.aRating), friend: FRIEND };
        return makeRtdbSession(db, duelId, myUid, mine, opp, P);
      });
    }

    return { name: FRIEND ? "firebase-friend" : "firebase", findMatch: findMatch, paths: P, friend: FRIEND, _db: db };
  }

  function isPermissionError(e) {
    var s = e ? (String(e.code || "") + " " + String(e.message || e)) : "";
    return /permission/i.test(s);
  }

  /* ---------------- RTDB-backed duel session (commit-reveal relay) ---------------- */
  function makeRtdbSession(db, duelId, myUid, mySide, opponent, paths) {
    var P = paths || pathsFor(ROOT);
    var oppSide = mySide === "a" ? "b" : "a";
    var base = P.duels + "/" + duelId;
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
              // a valid reveal is a whole stance 0..5 (rounds) or bind 0..2 (binds)
              var top = kind === "rounds" ? 6 : 3, rv = ov.reveal;
              if (typeof rv !== "number" || rv < 0 || rv >= top || Math.floor(rv) !== rv) return reject(new Error("reveal out of range"));
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
    var oppPresenceRef = db.ref(P.lobby + "/" + opponent.id);
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
      if (!cfg || !firebase || !firebase.initializeApp || !firebase.database || !root.Net) return false;
      if (!root.firebase.apps || !root.firebase.apps.length) firebase.initializeApp(cfg);
      var db = wrapCompat(firebase.database());
      liveDb = db;
      root.Net.configure(FirebaseBackend(db));
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- on-demand connect (the live path) ---------------- */
  // The page never loads the SDK at boot. connect() loads it the first time a
  // player opens online play, initialises the app, then PROBES the database with
  // one small read. Resolves with the db handle (and switches Net to Firebase) or
  // rejects with an Error whose .reason is one of:
  //   "not-configured" | "sdk-unreachable" | "db-unreachable" | "permission-denied"
  // friendlyError(err) turns that into plain words for the player.
  var SDK_VERSION = "9.23.0";
  var SDK_URLS = [
    "https://www.gstatic.com/firebasejs/" + SDK_VERSION + "/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/" + SDK_VERSION + "/firebase-database-compat.js",
  ];
  var liveDb = null, sdkLoading = null;
  function fail(reason, cause) { var e = new Error(reason); e.reason = reason; e.cause = cause; return e; }
  function withTimeout(p, ms, reason) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = root.setTimeout(function () { if (!done) { done = true; reject(fail(reason)); } }, ms);
      p.then(function (v) { if (!done) { done = true; root.clearTimeout(t); resolve(v); } },
        function (e) { if (!done) { done = true; root.clearTimeout(t); reject(e); } });
    });
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var doc = root.document;
      if (!doc || !doc.createElement) return reject(fail("sdk-unreachable"));
      var s = doc.createElement("script");
      s.src = src; s.async = true; s.crossOrigin = "anonymous";
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(fail("sdk-unreachable")); };
      (doc.head || doc.body || doc.documentElement).appendChild(s);
    });
  }
  function loadSdk(ms) {
    if (root.firebase && root.firebase.database) return Promise.resolve(root.firebase);
    if (!sdkLoading) {
      sdkLoading = loadScript(SDK_URLS[0]).then(function () { return loadScript(SDK_URLS[1]); })
        .then(function () {
          if (!root.firebase || !root.firebase.database) throw fail("sdk-unreachable");
          return root.firebase;
        });
      sdkLoading.catch(function () { sdkLoading = null; });  // a later tap may retry
    }
    return withTimeout(sdkLoading, ms, "sdk-unreachable");
  }
  function connect(o) {
    o = o || {};
    if (liveDb && !o.reprobe) return Promise.resolve(liveDb);
    var cfg = root.SIXFOLD_FIREBASE;
    if (!cfg || !cfg.databaseURL) return Promise.reject(fail("not-configured"));
    return loadSdk(o.sdkTimeoutMs || 12000).then(function (firebase) {
      var app;
      try { app = (firebase.apps && firebase.apps.length) ? firebase.app() : firebase.initializeApp(cfg); }
      catch (e) { throw fail("sdk-unreachable", e); }
      var database = app.database ? app.database() : firebase.database();
      // the probe: one tiny read of the public lobby. Refused -> the rules are not
      // open to us; silent -> the database cannot be reached from here.
      var probe = database.ref(ROOT + "/lobby").limitToFirst(1).get();
      return withTimeout(probe, o.dbTimeoutMs || 9000, "db-unreachable").then(function () {
        liveDb = wrapCompat(database);
        if (root.Net) root.Net.configure(FirebaseBackend(liveDb));
        return liveDb;
      }, function (e) {
        if (e && e.reason) throw e;
        if (isPermissionError(e)) throw fail("permission-denied", e);
        throw fail("db-unreachable", e);
      });
    });
  }
  function friendlyError(e) {
    var r = (e && e.reason) || (isPermissionError(e) ? "permission-denied" : "db-unreachable");
    if (r === "permission-denied") return "The online server said no (permission denied). Online play is not switched on yet.";
    if (r === "not-configured") return "Online play is not set up in this build.";
    if (r === "sdk-unreachable") return "Could not load online play. Check your connection and try again.";
    return "Could not reach the online server. Check your connection and try again.";
  }
  // a friend backend on the live db (connect() first)
  function friendBackend(code, db) { return FirebaseBackend(db || liveDb, { root: friendRoot(code), friend: true }); }
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

  var api = { FirebaseBackend: FirebaseBackend, makeRtdbSession: makeRtdbSession, tryActivate: tryActivate, _hash: hash,
    ROOT: ROOT, CODE_ALPHABET: CODE_ALPHABET, CODE_RE: CODE_RE, newFriendCode: newFriendCode, normalizeCode: normalizeCode,
    friendRoot: friendRoot, pathsFor: pathsFor, friendBackend: friendBackend,
    connect: connect, friendlyError: friendlyError, isPermissionError: isPermissionError, SDK_URLS: SDK_URLS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.FirebaseNet = api; try { tryActivate(); } catch (e) {} }
})(typeof globalThis !== "undefined" ? globalThis : this);
