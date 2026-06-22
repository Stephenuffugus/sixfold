/* SIXFOLD — net.js  (multiplayer transport SEAM)
 *
 * One interface, two backends. Phase 1 ships the LocalMock (no server, fully
 * offline-testable). Phase 2 swaps in a Firebase backend with the SAME shape —
 * Net.configure(FirebaseBackend) and nothing above this layer changes.
 *
 * A backend provides:
 *   findMatch({rating,name,tier,rng,clock}) -> Search
 *   Search:  onState(cb), acceptSentinel(), keepSearching(), cancel()
 *            states: {state:"searching",elapsedMs,half}
 *                    {state:"matched", opponent, session}
 *                    {state:"sentinel-offer", opponent}
 *   Session: meta, exchangeStance(round,myPick,oppCtx)->Promise<{oppPick}>
 *            exchangeBind(round,myBind,oppCtx)->Promise<{oppBind}>
 *            onDisconnect(cb), close(), simulateDisconnect()
 *
 * THE INTEGRITY RULE (commit-reveal): neither side may learn the other's pick
 * before both have committed. exchangeStance/exchangeBind enforce it — the
 * opponent's pick is decided WITHOUT reference to myPick. (In the mock the foe
 * is an AI that reads only history; over a real wire it's a hash-then-reveal
 * handshake. Either way myPick can't leak.) This is what keeps a live duel as
 * symmetric and unexploitable as the single-player game — the fairness pillar.
 */
(function (root) {
  "use strict";
  const req = (typeof require !== "undefined");
  const Personalities = req ? require("./personalities.js") : root.Personalities;
  const Matchmaker = req ? require("./matchmaker.js") : root.Matchmaker;

  // tiny non-crypto hash, only to model a real commit blob (djb2)
  function hash(s) { let h = 5381; s = String(s); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
  // mulberry32 — deterministic rng from a seed (independent foe randomness)
  function rng32(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function defaultClock() {
    const g = root;
    return {
      setTimeout: (fn, ms) => (g.setTimeout ? g.setTimeout(fn, ms) : (fn(), 0)),
      clearTimeout: (id) => { if (g.clearTimeout) g.clearTimeout(id); },
    };
  }

  /* ---------------- LocalMock backend ---------------- */
  // No server. The "online pool" is empty by default — which is the HONEST Phase-1
  // state (there is no backend, so there are no live rivals). That means findMatch
  // always falls through to the Sentinel offer, exactly what the player is told.
  // Tests/Phase-2 can inject a pool to exercise the full human-match pipeline.
  function LocalMock() {
    let pool = [];                 // [{id,name,rating,online}]
    const busy = new Set();
    const cfg = { latencyMs: 220, tickMs: 600, noPoolMs: 2600 };

    function setPool(p) { pool = Array.isArray(p) ? p.slice() : []; }
    function setLatency(ms) { cfg.latencyMs = Math.max(0, ms | 0); }

    function findMatch(opts) {
      opts = opts || {};
      const clock = opts.clock || defaultClock();
      const rng = opts.rng || rng32(((opts.rating || 1000) * 2654435761) >>> 0);
      const myRating = opts.rating || 1000;
      let elapsed = 0, cancelled = false, settled = false, sawCandidate = false;
      const subs = [];
      let nameIdx = 0;
      const emit = (s) => { if (!cancelled) subs.forEach((f) => { try { f(s); } catch (e) {} }); };

      function makeSentinel() {
        return Matchmaker.sentinelFor(myRating, rng, (nameIdx++));
      }
      function openSession(opponent) {
        settled = true;
        return makeSession(opponent, { clock, latencyMs: cfg.latencyMs, seed: ((myRating ^ hashNum(opponent.id)) >>> 0) });
      }
      function tick() {
        if (cancelled || settled) return;
        elapsed += cfg.tickMs;
        const cand = Matchmaker.pickOpponent(pool, myRating, elapsed, { selfId: opts.selfId, busy });
        if (cand) sawCandidate = true;
        const decision = Matchmaker.fallbackDecision(elapsed, !!cand);
        if (decision === "matched") {
          busy.add(cand.id);
          emit({ state: "matched", opponent: normalizeHuman(cand), session: openSession(normalizeHuman(cand)) });
          return;
        }
        // empty-pool: don't make the player wait the full timeout to be told the
        // truth — we know immediately there's no one, so offer the Sentinel sooner.
        const effectiveTimeout = sawCandidate ? Matchmaker.SEARCH_TIMEOUT_MS : Math.min(Matchmaker.SEARCH_TIMEOUT_MS, cfg.noPoolMs);
        if (elapsed >= effectiveTimeout) {
          settled = true;
          emit({ state: "sentinel-offer", opponent: makeSentinel() });
          return;
        }
        emit({ state: "searching", elapsedMs: elapsed, half: Matchmaker.bandFor(elapsed) });
        clock.setTimeout(tick, cfg.tickMs);
      }
      // kick off
      clock.setTimeout(() => { emit({ state: "searching", elapsedMs: 0, half: Matchmaker.bandFor(0) }); tick(); }, 0);

      const handle = {
        onState(cb) { if (typeof cb === "function") subs.push(cb); return handle; },
        acceptSentinel() {
          if (cancelled) return null;
          const opp = makeSentinel();
          const session = openSession(opp);
          emit({ state: "matched", opponent: opp, session });
          return session;
        },
        keepSearching() { if (!cancelled) { settled = false; elapsed = 0; clock.setTimeout(tick, cfg.tickMs); } return handle; },
        cancel() { cancelled = true; },
      };
      return handle;
    }

    return { name: "local-mock", findMatch, setPool, setLatency, _pool: () => pool };
  }

  function hashNum(s) { let h = 2166136261 >>> 0; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function normalizeHuman(c) {
    return { id: c.id, name: c.name || "Rival", kind: "human", rating: c.rating || 1000,
      // a mock "human" is AI-backed locally; difficulty derives from THEIR rating
      difficulty: Matchmaker.ratingToDifficulty(c.rating || 1000),
      archetype: c.archetype || "ghost", tierName: c.tierName };
  }

  /* ---------------- Session (the duel channel) ---------------- */
  // Both human-mock and Sentinel use the same AI-backed local opponent. The ONLY
  // observable difference is meta.kind (-> labelling + rank stakes). The opponent's
  // pick is computed from history+its own rng — never from the local player's pick.
  function makeSession(opponent, o) {
    o = o || {};
    const clock = o.clock || defaultClock();
    const latency = o.latencyMs == null ? 220 : o.latencyMs;
    const oppRng = rng32((o.seed || 1) >>> 0);
    const oppDiff = opponent.difficulty == null ? 0.5 : opponent.difficulty;
    const oppProfile = Personalities ? Personalities.create(opponent.archetype || "ghost", oppRng) : null;
    let dead = false; const discSubs = []; let lastIndependent = false;

    // build the foe's view of the world: it reads the LOCAL player via playerHist,
    // plays from aiHist; override difficulty+rng with the foe's own.
    function foeCtx(oppCtx) { return Object.assign({}, oppCtx, { difficulty: oppDiff, rng: oppRng }); }

    function decideStance(oppCtx) {
      if (!oppProfile) return Math.floor(oppRng() * 6);
      return Personalities.aiChoose(oppProfile, foeCtx(oppCtx));
    }
    function decideBind(oppCtx) {
      if (!oppProfile) return Math.floor(oppRng() * 3);
      return Personalities.bindChoose(oppProfile, foeCtx(oppCtx));
    }

    // commit-reveal stance exchange. myPick is committed (hashed) first; the foe's
    // pick is decided WITHOUT it; then both reveal. Resolves to the foe's pick.
    function exchangeStance(round, myPick, oppCtx) {
      return new Promise((resolve, reject) => {
        if (dead) return reject(new Error("disconnected"));
        const myCommit = hash(round + ":" + myPick + ":" + (o.seed || 0));   // model the commit blob
        const oppPick = decideStance(oppCtx || {});                          // independent of myPick
        lastIndependent = true;
        clock.setTimeout(() => {
          if (dead) return reject(new Error("disconnected"));
          resolve({ oppPick, myCommit, round });
        }, latency);
      });
    }
    function exchangeBind(round, myBind, oppCtx) {
      return new Promise((resolve, reject) => {
        if (dead) return reject(new Error("disconnected"));
        const oppBind = decideBind(oppCtx || {});
        clock.setTimeout(() => { if (dead) return reject(new Error("disconnected")); resolve({ oppBind, round }); }, latency);
      });
    }

    function onDisconnect(cb) { if (typeof cb === "function") discSubs.push(cb); }
    function fireDisconnect(reason) { if (dead) return; dead = true; discSubs.forEach((f) => { try { f({ reason: reason || "left" }); } catch (e) {} }); }

    return {
      meta: opponent,
      exchangeStance, exchangeBind,
      onDisconnect, close: () => { dead = true; },
      simulateDisconnect: (reason) => fireDisconnect(reason),
      _decidedIndependently: () => lastIndependent,
    };
  }

  /* ---------------- public Net facade ---------------- */
  let backend = LocalMock();
  const Net = {
    configure(b) { if (b) backend = b; return Net; },
    backend() { return backend; },
    findMatch(opts) { return backend.findMatch(opts); },
    // expose for tests / Phase-1 demos
    LocalMock, makeSession, _hash: hash, _rng32: rng32,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Net;
  else root.Net = Net;
})(typeof globalThis !== "undefined" ? globalThis : this);
