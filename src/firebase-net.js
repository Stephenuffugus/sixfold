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
  var Names = req ? require("./names.js") : root.Names;

  // djb2 — same commit hash as net.js LocalMock so behavior matches exactly
  function hash(s) { var h = 5381; s = String(s); for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
  function nowMs() { try { return Date.now(); } catch (e) { return 0; } }
  function rand() { try { return Math.random(); } catch (e) { return 0.5; } }
  function salt() { return (rand().toString(36).slice(2) + nowMs().toString(36)); }
  // anything read off the wire is untrusted: names land in the page, so keep them
  // short and free of markup; ratings are clamped numbers.
  // a rude name (src/names.js) shows as "Player", both before it is sent and when it is read
  function cleanName(n, fallback) {
    var s = String(n == null ? "" : n).replace(/[<>&"'`\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);
    if (s && Names && Names.isRude(s)) return "Player";
    return s || fallback || "Rival";
  }
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
    // a finished duel's record (both names, ratings, every pick) is removed this long
    // after the duel closes, the same tidy the friend rooms use; the delay lets the
    // slower phone read the last reveal. The player's own busy lobby entry goes too.
    var TIDY_MS = opts.tidyMs == null ? 8000 : opts.tidyMs;

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
      var me = { name: cleanName(o.name, "Rival"), rating: o.rating || 1000 };
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
    function openCreatedDuel(duelId, myUid, opponent) { return makeRtdbSession(db, duelId, myUid, "a", opponent, P, { tidyMs: TIDY_MS }); }
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
        return makeRtdbSession(db, duelId, myUid, mine, opp, P, { tidyMs: TIDY_MS });
      });
    }

    return { name: FRIEND ? "firebase-friend" : "firebase", findMatch: findMatch, paths: P, friend: FRIEND, _db: db };
  }

  function isPermissionError(e) {
    var s = e ? (String(e.code || "") + " " + String(e.message || e)) : "";
    return /permission/i.test(s);
  }

  /* ---------------- RTDB-backed duel session (commit-reveal relay) ---------------- */
  // sopts.graceMs: how long the rival's presence may be gone before the duel counts
  // them as dropped (0 = at once, the public lobby's rule). A friend room uses a
  // grace so a phone that blinks offline for a few seconds does not end the duel.
  // sopts.roundMs: the per round clock (friend room duels). Once one side has
  // committed, the other has roundMs to commit too; past it, EITHER phone may
  // mark the round missed (a transaction that loses to a late commit), and the
  // missed side takes a clean hit. The clock reads a timestamp written beside the
  // round (rounds/$n/t, server time), never one phone's private timer alone.
  function makeRtdbSession(db, duelId, myUid, mySide, opponent, paths, sopts) {
    var P = paths || pathsFor(ROOT);
    var GRACE = (sopts && sopts.graceMs > 0) ? sopts.graceMs : 0;
    var ROUND_MS = (sopts && sopts.roundMs > 0) ? sopts.roundMs : 0;
    var TICK_MS = (sopts && sopts.tickMs > 0) ? sopts.tickMs : 250;
    var serverNow = (sopts && typeof sopts.now === "function") ? sopts.now : (typeof db.serverNow === "function" ? function () { return db.serverNow(); } : nowMs);
    var graceTimer = null;
    var oppSide = mySide === "a" ? "b" : "a";
    var base = P.duels + "/" + duelId;
    var dead = false, discSubs = [];
    var lastIndependent = false;
    // sopts.tidyMs (the public duels): close() removes this duel's record and this
    // player's own lobby entry tidyMs later, and the server removes the record at once
    // if this phone drops (a public duel ends on a drop anyway). Room duels leave
    // their tidy to the room.
    var TIDY = (sopts && sopts.tidyMs != null && sopts.tidyMs >= 0) ? sopts.tidyMs : -1;
    var tidied = false;
    if (TIDY >= 0) { try { db.ref(base).onDisconnect().remove(); } catch (e) {} }
    function tidy() {
      if (TIDY < 0 || tidied) return;
      tidied = true;
      root.setTimeout(function () {
        quietP(db.ref(base).remove());
        // my lobby entry, only while it still points at THIS duel: the same tab may
        // already be searching again under the same id
        quietP(db.ref(P.lobby + "/" + myUid).transaction(function (cur) {
          if (!cur) return null;   // not known locally yet: a no-op the server retries with the real value
          if (cur.matchedDuel !== duelId) return;
          return null;
        }, undefined, false));
      }, TIDY);
    }

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
    var onPres = function (snap) {
      var v = snap && snap.val && snap.val();
      if (v) { sawPresence = true; if (graceTimer) { root.clearTimeout(graceTimer); graceTimer = null; } return; }
      if (!sawPresence || dead) return;
      if (!GRACE) return fireDisconnect("left");
      if (!graceTimer) graceTimer = root.setTimeout(function () { graceTimer = null; fireDisconnect("left"); }, GRACE);
    };
    try { oppPresenceRef.on("value", onPres); } catch (e) {}

    function fireDisconnect(reason) { if (dead) return; dead = true; if (typeof stopClock === "function") stopClock(); if (graceTimer) { root.clearTimeout(graceTimer); graceTimer = null; } try { oppPresenceRef.off("value", onPres); } catch (e) {} discSubs.forEach(function (f) { try { f({ reason: reason }); } catch (e) {} }); }

    /* ---- the round clock (only when ROUND_MS is set) ----
     * rounds/$n (and binds/$n) = { a:{commit,reveal,salt}, b:{...}, t, miss }
     *   t     server time of the FIRST commit (written by that commit's transaction)
     *   miss  "a" or "b": that side did not commit within ROUND_MS of t
     * A commit and a miss are both transactions on the same node, so exactly one
     * wins: a late commit after the miss is refused, a miss after the commit is
     * refused. The missed side's pick is then fixed by the rule (it takes a clean
     * hit: its stance is the one the present pick cuts, its bind the one the
     * present bind beats), so both phones settle the round the same way. The
     * present side still reveals its committed pick (checked against its commit);
     * nothing is revealed before the round is settled. */
    var duelRef = db.ref(base), duelData = {}, pending = {}, missTried = {}, missFired = {}, idleFired = false;
    var clockSubs = [], missSubs = [], idleSubs = [], ticker = null, lastClockKey = null;
    function o2(v) { return (v && typeof v === "object") ? v : {}; }
    function topOf(kind) { return kind === "rounds" ? 6 : 3; }
    function validPick(v, top) { return typeof v === "number" && v >= 0 && v < top && Math.floor(v) === v; }
    function oppRevealOk(kind, n, ov) {
      return ov.commit != null && ov.reveal != null && hash(n + ":" + ov.reveal + ":" + ov.salt) === ov.commit && validPick(ov.reveal, topOf(kind));
    }
    function shape(kind, oppV, myV, missed) {
      var r = kind === "rounds" ? { oppPick: oppV, myPick: myV } : { oppBind: oppV, myBind: myV };
      if (missed) r.missed = missed;
      return r;
    }
    function clockedExchange(kind, n, myPick) {
      return new Promise(function (resolve, reject) {
        if (dead) return reject(new Error("disconnected"));
        var key = kind + ":" + n, s = salt();
        var p = { kind: kind, n: n, myPick: myPick, salt: s, commit: hash(n + ":" + myPick + ":" + s), resolve: resolve, reject: reject, revealed: false, mine: false };
        pending[key] = p;
        db.ref(base + "/" + kind + "/" + n).transaction(function (cur) {
          var c = cur && typeof cur === "object" ? JSON.parse(JSON.stringify(cur)) : {};
          if (c.miss) return;                                   // settled without me
          if (c[mySide] && c[mySide].commit != null) return;    // already committed
          c[mySide] = { commit: p.commit };
          if (!c.t) c.t = serverNow();
          return c;
        }, undefined, false).then(function (res) {
          if (res && res.committed) p.mine = true;
          lastIndependent = true; // my reveal is gated on the opponent's commit (or a miss), never their pick
          evaluate();
        }, function (e) { delete pending[key]; reject(e); });
      });
    }
    function settle(key, val) { var p = pending[key]; if (!p) return; delete pending[key]; p.resolve(val); }
    // how many stance rounds in a row, ending at round n, the same side missed
    function streakAt(n) {
      var rs = o2(duelData.rounds), side = o2(rs[n]).miss, k = 0;
      if (!side) return 0;
      while (o2(rs[n - k]).miss === side) k++;
      return k;
    }
    function evaluate() {
      if (dead || idleFired) return;
      // TWO missed rounds in a row by the same side: that player has stopped
      // picking. The second miss applies no hit: the duel is called off (a cheap
      // knockout of an absent friend is not a win). A pick in between resets it.
      var rsAll = o2(duelData.rounds);
      Object.keys(rsAll).forEach(function (n) {
        if (idleFired || !(Number(n) > 0)) return;
        if (streakAt(Number(n)) >= 2) {
          idleFired = true;
          if (ticker) { root.clearInterval(ticker); ticker = null; }
          var side = o2(rsAll[n]).miss, ev = { side: side, mine: side === mySide, n: Number(n) };
          idleSubs.forEach(function (f) { try { f(ev); } catch (e) {} });
        }
      });
      if (idleFired) { emitClock(null); return; }
      Object.keys(pending).forEach(function (key) {
        var p = pending[key];
        var r = o2(o2(duelData[p.kind])[p.n]), mine = o2(r[mySide]), ov = o2(r[oppSide]), top = topOf(p.kind);
        if (r.miss === mySide) {
          // the clock ran out on me: the round is settled by the rule once the
          // other side's committed pick is revealed (and checked)
          if (oppRevealOk(p.kind, p.n, ov)) settle(key, shape(p.kind, ov.reveal, (ov.reveal + 1) % top, "me"));
          return;
        }
        if (!p.mine || mine.commit !== p.commit) return;       // my commit has not landed yet
        if (!p.revealed && (ov.commit != null || r.miss === oppSide)) {
          p.revealed = true;
          db.ref(base + "/" + p.kind + "/" + p.n + "/" + mySide).update({ reveal: p.myPick, salt: p.salt });
        }
        if (r.miss === oppSide) return settle(key, shape(p.kind, (p.myPick + 1) % top, p.myPick, "opp"));
        if (ov.reveal != null && ov.commit != null) {
          if (hash(p.n + ":" + ov.reveal + ":" + ov.salt) !== ov.commit) { delete pending[key]; return p.reject(new Error("commit-reveal mismatch (cheat?)")); }
          if (!validPick(ov.reveal, top)) { delete pending[key]; return p.reject(new Error("reveal out of range")); }
          settle(key, shape(p.kind, ov.reveal, p.myPick));
        }
      });
      // a round the clock ran out on me while I had not picked at all: tell the page
      ["rounds", "binds"].forEach(function (kind) {
        var all = o2(duelData[kind]);
        Object.keys(all).forEach(function (n) {
          var key = kind + ":" + n, r = o2(all[n]);
          if (r.miss !== mySide || pending[key] || missFired[key]) return;
          var ov = o2(r[oppSide]);
          if (!oppRevealOk(kind, n, ov)) return;
          missFired[key] = 1;
          var mv = (ov.reveal + 1) % topOf(kind), ev = { kind: kind, n: Number(n) };
          if (kind === "rounds") { ev.oppPick = ov.reveal; ev.myPick = mv; } else { ev.oppBind = ov.reveal; ev.myBind = mv; }
          missSubs.forEach(function (f) { try { f(ev); } catch (e) {} });
        });
      });
      runClock();
    }
    // the open clock: the newest round (a bind first) where exactly one side committed
    function openClock() {
      var kinds = ["binds", "rounds"];
      for (var k = 0; k < kinds.length; k++) {
        var all = o2(duelData[kinds[k]]), ns = Object.keys(all).map(Number).filter(function (x) { return x > 0; });
        if (!ns.length) continue;
        var n = Math.max.apply(null, ns), r = o2(all[n]);
        var ca = o2(r.a).commit != null, cb = o2(r.b).commit != null;
        if (r.miss || ca === cb || !(Number(r.t) > 0)) continue;
        return { kind: kinds[k], n: n, t: Number(r.t), waitingOn: o2(r[mySide]).commit != null ? "opp" : "me" };
      }
      return null;
    }
    function emitClock(c) { clockSubs.forEach(function (f) { try { f(c); } catch (e) {} }); }
    function runClock() {
      if (!ROUND_MS || dead) return;
      var c = openClock();
      if (!c) {
        if (ticker) { root.clearInterval(ticker); ticker = null; }
        if (lastClockKey !== null) { lastClockKey = null; emitClock(null); }
        return;
      }
      lastClockKey = c.kind + ":" + c.n;
      var rem = c.t + ROUND_MS - serverNow();
      emitClock({ kind: c.kind, n: c.n, waitingOn: c.waitingOn, remainingMs: Math.max(0, rem) });
      if (rem <= 0) tryMiss(c);
      if (!ticker) ticker = root.setInterval(runClock, TICK_MS);
    }
    function tryMiss(c) {
      var key = c.kind + ":" + c.n, t = serverNow();
      if (missTried[key] && t - missTried[key] < 1000) return;
      missTried[key] = t;
      quietP(db.ref(base + "/" + c.kind + "/" + c.n).transaction(function (cur) {
        var x = cur && typeof cur === "object" ? JSON.parse(JSON.stringify(cur)) : null;
        if (!x) return null;   // not known locally yet: a no-op the server retries with the real value
        if (x.miss) return;
        var ca = o2(x.a).commit != null, cb = o2(x.b).commit != null;
        if (ca === cb || !(Number(x.t) > 0) || serverNow() < Number(x.t) + ROUND_MS) return;
        x.miss = ca ? "b" : "a";
        return x;
      }, undefined, false));
    }
    function quietP(w) { if (w && w.catch) w.catch(function () {}); return w; }
    var onDuel = function (snap) { duelData = o2(snap && snap.val && snap.val()); evaluate(); };
    if (ROUND_MS) { try { duelRef.on("value", onDuel); } catch (e) {} }
    function stopClock() {
      if (ticker) { root.clearInterval(ticker); ticker = null; }
      if (ROUND_MS) { try { duelRef.off("value", onDuel); } catch (e) {} }
      Object.keys(pending).forEach(function (k) { var p = pending[k]; delete pending[k]; try { p.reject(new Error("disconnected")); } catch (e) {} });
    }

    return {
      meta: opponent,
      exchangeStance: function (n, myPick) { return ROUND_MS ? clockedExchange("rounds", n, myPick) : exchange("rounds", n, myPick); },
      exchangeBind: function (n, myBind) { return ROUND_MS ? clockedExchange("binds", n, myBind) : exchange("binds", n, myBind); },
      onDisconnect: function (cb) { if (typeof cb === "function") discSubs.push(cb); },
      // the round clock: cb({kind, n, waitingOn:"me"|"opp", remainingMs}) while a
      // round waits on one side, cb(null) when none does
      onClock: function (cb) { if (typeof cb === "function") clockSubs.push(cb); },
      // a round the clock settled while I had not picked: cb({kind, n, myPick|myBind, oppPick|oppBind})
      onMissed: function (cb) { if (typeof cb === "function") missSubs.push(cb); },
      // two missed rounds in a row by one side (no hit for the second): cb({side, mine, n})
      onIdle: function (cb) { if (typeof cb === "function") idleSubs.push(cb); },
      roundMs: ROUND_MS,
      close: function () { dead = true; stopClock(); if (graceTimer) { root.clearTimeout(graceTimer); graceTimer = null; } try { oppPresenceRef.off("value", onPres); } catch (e) {} tidy(); },
      simulateDisconnect: function (r) { fireDisconnect(r || "left"); },
      _decidedIndependently: function () { return lastIndependent; },
    };
  }


  /* ---------------- the friend ROOM (outlives a duel) ----------------
   * sixfold/friends/<CODE>/room holds everything two friends share between duels:
   *   here/<uid>  = {name, at}      presence (removed on disconnect, re-sent on reconnect)
   *   left/<uid>  = ts              set by an explicit "Leave the room"
   *   ready/<uid> = n               ready for duel number n (the rematch vote)
   *   duel        = {n,id,a,b,...}  the current duel; written once per n by a transaction
   *   won/<n>     = {w,l}           who won duel n (the session score)
   *   ended/<n>   = {why,by}        duel n was called off (a drop or a quit)
   *   say/<uid>   = {k,v,t,id}      the last emote ("e") or call ("c") from that player
   * The duel itself runs the SAME commit-reveal relay under .../friends/<CODE>/duels.
   * "say" is a separate small write: it never touches the rounds/binds paths, so an
   * emote or a call cannot carry, reveal or change a committed pick, and a flood of
   * them cannot hold up a round. A call is only talk and is never checked. */
  var EMOTES = [
    { id: "smirk", e: "😏", w: "Smirk" },
    { id: "eyes", e: "👀", w: "Eyes" },
    { id: "gasp", e: "😮", w: "Gasp" },
    { id: "respect", e: "🙇", w: "Respect" },
    { id: "fire", e: "🔥", w: "Fire" },
    { id: "yawn", e: "🥱", w: "Yawn" },
  ];
  var SAY_GAP_MS = 2000;
  var ROUND_MS_DEFAULT = 30000;   // a friend has 30 s to pick once the other has
  function emoteById(id) { for (var i = 0; i < EMOTES.length; i++) if (EMOTES[i].id === id) return EMOTES[i]; return null; }
  // a said thing off the wire is untrusted: only a known emote id or a whole stance 0..5
  function cleanSay(v) {
    if (!v || typeof v !== "object") return null;
    var id = (typeof v.id === "string" && v.id) ? v.id.slice(0, 32) : null;
    if (!id) return null;
    if (v.k === "e" && typeof v.v === "string" && emoteById(v.v)) return { kind: "emote", value: v.v, id: id };
    if (v.k === "c" && typeof v.v === "number" && v.v >= 0 && v.v < 6 && Math.floor(v.v) === v.v) return { kind: "call", value: v.v, id: id };
    return null;
  }
  // why a room duel was called off: lost (a drop), quit, unready, idle (three
  // missed rounds), reload (a phone reloaded the page mid duel)
  function endWhy(w) { return (w === "quit" || w === "unready" || w === "idle" || w === "reload") ? w : "lost"; }
  // two players with the same name (two "Player"s) are told apart by seat:
  // "Player 1" (the first seat) and "Player 2". Returns [first, second].
  function seatNames(n1, n2) {
    if (String(n1).toLowerCase() !== String(n2).toLowerCase()) return [n1, n2];
    return [String(n1).slice(0, 18) + " 1", String(n2).slice(0, 18) + " 2"];
  }
  function obj(v) { return (v && typeof v === "object") ? v : {}; }
  function safeKey(k) { return typeof k === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(k); }

  // openRoom(db, code, {uid, name, graceMs, now}) -> Promise<room>; rejects with
  // .reason "room-full" when two other players are already in it.
  function openRoom(db, code, o) {
    o = o || {};
    if (!CODE_RE.test(String(code || ""))) return Promise.reject(fail("bad-code"));
    var uid = String(o.uid || ("anon_" + Math.floor(rand() * 1e9)));
    var base = friendRoot(code) + "/room";
    return db.ref(base + "/here").get().then(function (snap) {
      var here = obj(snap && snap.val && snap.val());
      var others = Object.keys(here).filter(function (k) { return k !== uid && here[k]; });
      if (others.length >= 2) throw fail("room-full");
      // nobody else here: whatever the code holds is left over from an earlier
      // visit (a score, an old duel), so start the room clean
      // coming back with the same id (a reload): keep the seat you had
      var mine = here[uid], at = (mine && Number(mine.at) > 0) ? Number(mine.at) : null;
      return (others.length ? Promise.resolve() : clearIfEmpty(db, code, uid)).then(function () {
        var room = makeRoom(db, code, uid, o, others.length ? at : null);
        return room._enter().then(function () { return room; });
      });
    });
  }
  // remove everything under sixfold/friends/<CODE> (and nothing else) if nobody
  // but `except` is in its room. A transaction, so a player arriving at the same
  // moment keeps the room. Resolves true if the code was cleared.
  function clearIfEmpty(db, code, except) {
    if (!CODE_RE.test(String(code || ""))) return Promise.resolve(false);
    return db.ref(friendRoot(code)).transaction(function (cur) {
      // (the live SDK may first call this with null before it knows the server's
      // value: answer null, a no-op that the server retries with the real value)
      if (cur == null) return null;
      var here = obj(obj(obj(cur).room).here);
      if (Object.keys(here).some(function (k) { return k !== except && here[k]; })) return;
      return null;
    }, undefined, false).then(function (r) { return !!(r && r.committed); }, function () { return false; });
  }

  function makeRoom(db, code, uid, o, keepAt) {
    var now = o.now || nowMs;
    var base = friendRoot(code) + "/room";
    var name = cleanName(o.name, "Player");
    var joinedAt = keepAt || now();
    var announcing = false, entered = false;
    var st = { here: {}, ready: {}, duel: null, won: {}, ended: {}, say: {}, left: {} };
    var subs = { change: [], duel: [], say: [], ended: [], gone: [], back: [], stale: [] };
    var seenSay = {}, endedSeen = {}, startedN = 0, creating = 0, first = true, tidied = {}, tidyTimers = [], staleN = 0;
    var TIDY_MS = o.tidyMs == null ? 8000 : o.tidyMs;
    var lastFriend = null, friendHere = false, lastSayAt = -Infinity, gone = false;
    // a friend who quit a duel (ended why "quit" by them) has left the room, even before
    // their left/here writes arrive (or if those never do): departed[uid] is "here" while
    // their presence is still listed, "absent" once it is gone; seen again = they came back
    var departed = {}, quitSeen = {}, goneWhy = null;
    var roomRef = db.ref(base), infoRef = null;
    function emit(k, x) { (subs[k] || []).forEach(function (f) { try { f(x); } catch (e) {} }); }
    function quiet(w) { if (w && w.catch) w.catch(function () {}); return w; }

    function players() {
      return Object.keys(st.here).filter(function (k) { return safeKey(k) && st.here[k] && typeof st.here[k] === "object" && (k === uid || (!st.left[k] && !departed[k])); })
        .sort(function (x, y) { var ax = Number(st.here[x].at) || 0, ay = Number(st.here[y].at) || 0; return ax - ay || (x < y ? -1 : x > y ? 1 : 0); });
    }
    function wins(w, l) {
      var n = 0; Object.keys(st.won).forEach(function (k) { var r = st.won[k]; if (r && r.w === w && r.l === l) n++; }); return n;
    }
    function view() {
      var ps = players(), me = ps.indexOf(uid);
      var full = me >= 2;
      var seats = ps.slice(0, 2), f = null;
      if (!full) for (var i = 0; i < seats.length; i++) if (seats[i] !== uid) f = seats[i];
      var nextN = ((st.duel && Number(st.duel.n)) || 0) + 1;
      var myName = name, frName = f ? cleanName(st.here[f].name, "Player") : null;
      if (f) { var sn = seatNames(me === 0 ? myName : frName, me === 0 ? frName : myName); myName = me === 0 ? sn[0] : sn[1]; frName = me === 0 ? sn[1] : sn[0]; }
      return {
        code: code,
        me: { uid: uid, name: myName },
        friend: f ? { uid: f, name: frName } : null,
        full: full,
        nextN: nextN,
        myReady: st.ready[uid] === nextN,
        friendReady: !!(f && st.ready[f] === nextN),
        duelN: (st.duel && Number(st.duel.n)) || 0,
        score: f ? { me: wins(uid, f), friend: wins(f, uid) } : { me: 0, friend: 0 },
      };
    }
    function cleanDuel(d) {
      var sn = seatNames(cleanName(d.aName, "Player"), cleanName(d.bName, "Player"));
      return { n: Number(d.n) || 0, id: String(d.id), a: String(d.a), b: String(d.b), aName: sn[0], bName: sn[1] };
    }
    function createDuel(v) {
      if (creating >= v.nextN) return;
      creating = v.nextN;
      var ps = players(), a = ps[0], b = ps[1], nNext = v.nextN;
      if (!a || !b) return;
      var d = { n: nNext, id: "r" + nNext + "_" + now().toString(36) + "_" + Math.floor(rand() * 1e6).toString(36),
        a: a, b: b, aName: cleanName(st.here[a].name, "Player"), bName: cleanName(st.here[b].name, "Player"), ts: now() };
      // ONE writer: the first seat. (A transaction from both phones looked safe, but
      // the live SDK shows each phone its own optimistic duel before the server
      // picks one, so the two phones started two different duels and waited on
      // each other forever. Found by the two phone smoke run, 13 Nov.)
      if (a !== uid) return;
      quiet(db.ref(base + "/duel").set(d));
    }
    function onSnap(snap) {
      if (gone) return;
      var v = obj(snap && snap.val && snap.val());
      st = { here: obj(v.here), ready: obj(v.ready), duel: (v.duel && typeof v.duel === "object" && v.duel.id && v.duel.a && v.duel.b) ? v.duel : null,
        won: obj(v.won), ended: obj(v.ended), say: obj(v.say), left: obj(v.left) };
      // my own presence gone while I am still in the room (the server ran my
      // onDisconnect during a blink, or an old tab's disconnect landed after this
      // page's announce): say I am here again
      if (entered && !gone && !announcing && !(st.here[uid] && typeof st.here[uid] === "object")) {
        announcing = true;
        var aw = announce(); var done = function () { announcing = false; };
        if (aw && aw.then) aw.then(done, done); else done();
      }
      Object.keys(st.ended).forEach(function (n) {
        var e = obj(st.ended[n]), by = String(e.by || "");
        if (quitSeen[n]) return; quitSeen[n] = 1;
        if (first || e.why !== "quit" || !by || by === uid || !safeKey(by)) return;
        departed[by] = st.here[by] ? "here" : "absent";
      });
      Object.keys(departed).forEach(function (k) {
        if (!st.here[k]) departed[k] = "absent";
        else if (departed[k] === "absent") delete departed[k];
      });
      var vw = view();
      // emotes and calls: only the friend's, only new ones, only known values
      Object.keys(st.say).forEach(function (u) {
        if (u === uid) return;
        var s = cleanSay(st.say[u]);
        if (!s || seenSay[u] === s.id) return;
        seenSay[u] = s.id;
        if (!first && vw.friend && u === vw.friend.uid) emit("say", { from: u, name: vw.friend.name, kind: s.kind, value: s.value });
      });
      // the friend arriving, leaving, or dropping
      if (vw.friend) {
        if (!friendHere && !first) emit("back", vw.friend);
        friendHere = true; lastFriend = vw.friend; goneWhy = null;
      } else if (friendHere && lastFriend) {
        friendHere = false;
        goneWhy = (st.left[lastFriend.uid] || departed[lastFriend.uid]) ? "left" : "lost";
        emit("gone", { uid: lastFriend.uid, name: lastFriend.name, why: goneWhy });
      } else if (lastFriend && goneWhy === "lost" && (st.left[lastFriend.uid] || departed[lastFriend.uid])) {
        // their presence vanished first (it looked like a drop), then their leave or
        // quit landed: they left the room after all
        goneWhy = "left";
        emit("gone", { uid: lastFriend.uid, name: lastFriend.name, why: "left" });
      }
      // duels called off
      Object.keys(st.ended).forEach(function (n) {
        if (endedSeen[n]) return; endedSeen[n] = 1;
        var e = obj(st.ended[n]);
        if (!first) emit("ended", { n: Number(n) || 0, why: endWhy(e.why), by: String(e.by || "") });
      });
      // a duel that has a result (or was called off) leaves only its score: its
      // rounds under .../duels/<id> are removed a few seconds later (the delay lets
      // the slower phone finish reading the last reveal)
      if (st.duel && st.duel.id && safeKey(String(st.duel.id)) && (st.won[st.duel.n] || st.ended[st.duel.n]) && !tidied[st.duel.id]) {
        var tid = String(st.duel.id);
        tidied[tid] = 1;
        tidyTimers.push(root.setTimeout(function () { quiet(db.ref(friendRoot(code) + "/duels/" + tid).remove()); }, TIDY_MS));
      }
      // both ready for the same next duel: write it (once, whoever gets there first)
      if (vw.friend && !vw.full && vw.myReady && vw.friendReady) createDuel(vw);
      // a duel I am in and readied for has been written: start it, once
      var d = st.duel;
      if (first && d) {
        // a page that has just opened never starts a duel it finds. If that duel
        // is mine and unfinished, this page was reloaded in the middle of it: it
        // cannot be rejoined (the board lived in the old page), so call it off
        startedN = Number(d.n) || 0;
        var dn = startedN, en = obj(st.ended[dn]);
        if ((d.a === uid || d.b === uid) && !st.won[dn] && (!st.ended[dn] || en.why === "lost" || en.why === "reload")) {
          if (!st.ended[dn]) room.endDuel(dn, "reload");
          endedSeen[dn] = 1;
          staleN = dn;
          emit("stale", { n: dn });   // the live database answers after openRoom resolves
        }
      }
      if (d && (Number(d.n) || 0) > startedN && (d.a === uid || d.b === uid)) {
        startedN = Number(d.n) || 0;
        if (st.ready[uid] === startedN) emit("duel", cleanDuel(d));
        // written in the instant I took my Ready back: call it off so my friend is
        // not left alone in a duel nobody will play
        else if (!first) room.endDuel(startedN, "unready");
      }
      first = false;
      emit("change", vw);
    }
    function announce() {
      if (gone) return Promise.resolve();
      try { db.ref(base + "/here/" + uid).onDisconnect().remove(); } catch (e) {}
      try { db.ref(base + "/ready/" + uid).onDisconnect().remove(); } catch (e) {}
      return Promise.all([quiet(db.ref(base + "/left/" + uid).remove()), db.ref(base + "/here/" + uid).set({ name: name, at: joinedAt })]);
    }
    var onInfo = function (s) { if (s && s.val && s.val() === true) quiet(announce()); };

    var room = {
      code: code, uid: uid,
      on: function (k, cb) { if (subs[k] && typeof cb === "function") subs[k].push(cb); return room; },
      view: view,
      setReady: function (on) {
        if (gone) return null;
        var r = db.ref(base + "/ready/" + uid);
        return quiet(on ? r.set(view().nextN) : r.remove());
      },
      setName: function (nm) {
        name = cleanName(nm, "Player");
        if (!gone) quiet(db.ref(base + "/here/" + uid).update({ name: name }));
        return name;
      },
      // send an emote id or a call (stance 0..5). At most one every 2 s; false if refused.
      say: function (kind, value) {
        if (gone) return false;
        var k = kind === "call" ? "c" : kind === "emote" ? "e" : null;
        if (!k || !cleanSay({ k: k, v: value, id: "x" })) return false;
        var t = now();
        if (t - lastSayAt < SAY_GAP_MS) return false;
        lastSayAt = t;
        quiet(db.ref(base + "/say/" + uid).set({ k: k, v: value, t: t, id: salt() }));
        return true;
      },
      reportResult: function (n, iWon) {
        var v = view(); if (!v.friend || !n) return null;
        var rec = iWon ? { w: uid, l: v.friend.uid } : { w: v.friend.uid, l: uid };
        return quiet(db.ref(base + "/won/" + n).transaction(function (cur) { if (cur) return; return rec; }));
      },
      endDuel: function (n, why) {
        if (!n) return null;
        endedSeen[n] = 1;
        return quiet(db.ref(base + "/ended/" + n).transaction(function (cur) { if (cur) return; return { why: endWhy(why), by: uid }; }));
      },
      // the duel session for a duel this room started (the relay under .../duels)
      session: function (d) {
        var side = d.a === uid ? "a" : "b", oppId = side === "a" ? d.b : d.a;
        var sn = seatNames(cleanName(d.aName, "Player"), cleanName(d.bName, "Player"));
        var opp = { id: oppId, name: side === "a" ? sn[1] : sn[0], kind: "human", rating: 1000, friend: true, room: true, duelN: d.n };
        return makeRtdbSession(db, d.id, uid, side, opp,
          { root: friendRoot(code), lobby: base + "/here", duels: friendRoot(code) + "/duels" },
          { graceMs: o.graceMs == null ? 12000 : o.graceMs, roundMs: o.roundMs == null ? ROUND_MS_DEFAULT : o.roundMs, tickMs: o.tickMs, now: o.serverNow });
      },
      leave: function () {
        if (gone) return Promise.resolve();
        gone = true;
        try { roomRef.off("value", onSnap); } catch (e) {}
        try { if (infoRef) infoRef.off("value", onInfo); } catch (e) {}
        return Promise.all([
          quiet(db.ref(base + "/left/" + uid).set(now())),
          quiet(db.ref(base + "/ready/" + uid).remove()),
          quiet(db.ref(base + "/say/" + uid).remove()),
        ]).then(function () { return quiet(db.ref(base + "/here/" + uid).remove()); })
          // the last one out takes the room with them (only this code's own record)
          .then(function () { return clearIfEmpty(db, code, null); });
      },
      // the duel this page found interrupted when it opened (0 if none): read it
      // after openRoom resolves AND listen for "stale" (the live database's first
      // answer can come later), then say "Your duel was called off".
      staleDuel: function () { return staleN; },
      _enter: function () {
        return announce().then(function () {
          entered = true;
          roomRef.on("value", onSnap);
          try { infoRef = db.ref(".info/connected"); infoRef.on("value", onInfo); } catch (e) { infoRef = null; }
        });
      },
    };
    return room;
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
        transaction: function (fn, onComplete, applyLocally) { return applyLocally === false ? ref.transaction(fn, onComplete, false) : ref.transaction(fn); },
        onDisconnect: function () { return ref.onDisconnect(); },
        push: function () { return ref.push(); },
        child: function (p) { return wrapRef(ref.child(p)); },
      };
    }
    // server time: the local clock corrected by the server's offset, so a round
    // clock reads the same on both phones
    var offset = 0;
    try { database.ref(".info/serverTimeOffset").on("value", function (s) { offset = Number(s && s.val && s.val()) || 0; }); } catch (e) {}
    return { ref: function (p) { return wrapRef(database.ref(p)); }, serverNow: function () { return nowMs() + offset; } };
  }

  var api = { FirebaseBackend: FirebaseBackend, makeRtdbSession: makeRtdbSession, tryActivate: tryActivate, _hash: hash, _cleanName: cleanName,
    ROOT: ROOT, CODE_ALPHABET: CODE_ALPHABET, CODE_RE: CODE_RE, newFriendCode: newFriendCode, normalizeCode: normalizeCode,
    friendRoot: friendRoot, pathsFor: pathsFor, friendBackend: friendBackend,
    connect: connect, friendlyError: friendlyError, isPermissionError: isPermissionError, SDK_URLS: SDK_URLS,
    openRoom: openRoom, seatNames: seatNames, EMOTES: EMOTES, SAY_GAP_MS: SAY_GAP_MS, ROUND_MS: ROUND_MS_DEFAULT, cleanSay: cleanSay, liveDb: function () { return liveDb; } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.FirebaseNet = api; try { tryActivate(); } catch (e) {} }
})(typeof globalThis !== "undefined" ? globalThis : this);
