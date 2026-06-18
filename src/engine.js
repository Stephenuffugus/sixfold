/* SIXFOLD — engine.js  (spec §3.5 + §5)
 *
 * THE single source of truth for resolve(), Clash Bind resolution, damage,
 * escalation, and the win check. No other module computes damage.
 *
 * Validated constants (do NOT change without re-running tools/harness.py):
 *   N=6 · HP=4 · CLEAN=2 · GLANCE=1 · escalation +1 when round > 6
 *
 * Exposes: constants, resolve(), counter(), a tiny event bus, the mode registry,
 * and a Game controller that orchestrates a match (interactive OR headless).
 */
(function (root) {
  "use strict";
  const req = (typeof require !== "undefined");
  const Predictor    = req ? require("./predictor.js")    : root.Predictor;
  const Personalities = req ? require("./personalities.js") : root.Personalities;
  const Resolve      = req ? require("./resolve.js")       : root.Resolve;
  const Readout      = req ? require("./readout.js")       : root.Readout;

  const N = 6, HP = 4, CLEAN = 2, GLANCE = 1, ESC_ROUND = 6;

  // my pick a vs their pick b -> clockwise distance decides everything
  function resolve(a, b) {
    const d = ((b - a) % N + N) % N;
    if (d === 0) return { kind: "clash", winner: null };
    if (d === 1) return { kind: "clean", winner: "P" };
    if (d === 2) return { kind: "glance", winner: "P" };
    if (d === 3) return { kind: "whiff", winner: null };
    if (d === 4) return { kind: "glance", winner: "A" };
    return { kind: "clean", winner: "A" };               // d === 5
  }
  const counter = (p) => ((p - 1) % N + N) % N;

  // bind RPS-3: Drive=0, Slip=1, Trap=2. d3=(a-p) mod 3 -> 0 tie, 1 player, 2 ai.
  // The formula (authoritative, matches harness + personalities.beatsBind) yields
  // the cycle Drive>Slip>Trap>Drive. (Spec §3.5's parenthetical flavor named the
  // reverse cycle; the formula wins — stats are convention-independent. See FINDINGS.)
  function resolveBind3(pBind, aBind) {
    const d3 = ((aBind - pBind) % 3 + 3) % 3;
    if (d3 === 0) return { winner: null };
    return { winner: d3 === 1 ? "P" : "A" };
  }

  // ---- mode registry (spec §4.5): competitive => honorsAssists:false ----
  const MODES = {
    casual:   { id: "casual",   honorsAssists: true,  timed: false, seeded: false },
    practice: { id: "practice", honorsAssists: true,  timed: false, seeded: false },
    gauntlet: { id: "gauntlet", honorsAssists: true,  timed: false, seeded: false },
    daily:    { id: "daily",    honorsAssists: false, timed: false, seeded: true  },
    blitz:    { id: "blitz",    honorsAssists: false, timed: true,  seeded: false },
    ghost:    { id: "ghost",    honorsAssists: false, timed: false, seeded: false }, // async PvP replay
  };

  // ---- tiny event bus ----
  function makeBus() {
    const subs = {};
    return {
      on(evt, fn) { (subs[evt] = subs[evt] || []).push(fn); return () => {
        subs[evt] = (subs[evt] || []).filter((f) => f !== fn);
      }; },
      emit(evt, payload) { (subs[evt] || []).forEach((f) => { try { f(payload); } catch (e) {} }); },
    };
  }

  // mulberry32 seeded rng (deterministic for seeded modes/tests)
  function rng32(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- Game controller ----
  function createGame(opts) {
    opts = opts || {};
    const mode = opts.mode || MODES.casual;
    const difficulty = opts.difficulty == null ? 0.5 : opts.difficulty;
    const rng = opts.rng || rng32(opts.seed != null ? opts.seed : ((Date.now ? 0 : 0) || 1));
    const bus = opts.bus || makeBus();
    const meter = Resolve.createResolve({ startWith: 1 }); // symmetric stipend: perception usable in short matches
    const profile = Personalities.create(opts.archetype || "ghost", rng);

    const st = {
      hpP: HP, hpA: HP, round: 1, over: false,
      playerHist: [], aiHist: [], bindHistP: [], bindHistA: [],
      lastOutcome: null, outcomes: [], pending: null,
    };

    function ctx() {
      return {
        playerHist: st.playerHist, aiHist: st.aiHist,
        bindHistP: st.bindHistP, bindHistA: st.bindHistA,
        aiHP: st.hpA, playerHP: st.hpP, round: st.round,
        lastOutcome: st.lastOutcome, resolve: meter.state(), mode, difficulty, rng,
      };
    }

    function escBump() { return st.round > ESC_ROUND ? 1 : 0; }

    function applyDamage(outcome) {
      const bump = escBump();
      let dmg = 0;
      if (outcome.kind === "clean") dmg = CLEAN + bump;
      else if (outcome.kind === "glance") dmg = GLANCE + bump;
      outcome.dmg = dmg;
      if (outcome.winner === "P") st.hpA = Math.max(0, st.hpA - dmg);
      else if (outcome.winner === "A") st.hpP = Math.max(0, st.hpP - dmg);
    }

    function finalize(outcome) {
      outcome.round = st.round;
      applyDamage(outcome);
      meter.gain(outcome);                       // symmetric gains only
      st.lastOutcome = outcome;
      st.outcomes.push(outcome);
      bus.emit("meter-changed", meter.state());
      bus.emit("round-revealed", { pPick: st.playerHist[st.playerHist.length - 1],
        aPick: st.aiHist[st.aiHist.length - 1], outcome });
      if (st.hpP <= 0 || st.hpA <= 0) return matchOver();
      st.round++;
      return outcome;
    }

    function matchOver() {
      st.over = true;
      const winner = st.hpP > 0 ? "P" : "A";
      const tell = Readout.biggestTell(st.playerHist);
      const summary = {
        winner, rounds: st.round,
        unpredictabilityPct: Readout.unpredictabilityPct(st.playerHist),
        difficulty, worstRound: tell.worstRound, tell: tell.tell,
      };
      bus.emit("match-over", { winner, summary });
      return summary;
    }

    // interactive: player commits a stance. If it clashes, we enter the bind and
    // WAIT for submitBind(); otherwise the round resolves immediately.
    function chooseStance(pStance) {
      if (st.over || st.pending) return null;
      const aStance = Personalities.aiChoose(profile, ctx());
      st.playerHist.push(pStance);
      st.aiHist.push(aStance);
      bus.emit("stance-selected", { side: "P", stance: pStance });
      const r = resolve(pStance, aStance);
      if (r.kind === "clash") {
        meter.onBindEntered();                   // +1 both on ENTERING the bind
        bus.emit("meter-changed", meter.state());
        st.pending = { pStance, aStance };
        bus.emit("clash-bind", { round: st.round });
        return { clash: true };
      }
      bus.emit("stance-selected", { side: "A", stance: aStance });
      return finalize({ kind: r.kind, winner: r.winner });
    }

    // interactive: resolve the pending bind with the player's bind pick.
    function submitBind(pBind) {
      if (!st.pending) return null;
      const aBind = Personalities.bindChoose(profile, ctx());
      st.bindHistP.push(pBind);
      st.bindHistA.push(aBind);
      const b = resolveBind3(pBind, aBind);
      const pending = st.pending; st.pending = null;
      bus.emit("stance-selected", { side: "A", stance: pending.aStance });
      let outcome;
      if (b.winner === null) outcome = { kind: "clash", winner: null, bind: { p: pBind, a: aBind } };
      else outcome = { kind: "glance", winner: b.winner, bind: { p: pBind, a: aBind } };
      return finalize(outcome);
    }

    // spend Resolve to buy INFORMATION. Computes the revealed payload and emits
    // 'info-revealed'. Never alters damage/HP (Resolve.spend has no damage path).
    function spend(side, action) {
      const ok = meter.spend(side, action);
      if (!ok) return null;
      const oppHist = side === "P" ? st.aiHist : st.playerHist;
      let payload = {};
      if (action === "INSIGHT") {
        payload = { ribbon: oppHist.slice(-10), oppResolve: meter.state()[side === "P" ? "ai" : "player"] };
      } else if (action === "FORESIGHT") {
        payload = { predict: Predictor.predict(oppHist, N) };
      }
      bus.emit("meter-changed", meter.state());
      bus.emit("info-revealed", { side, action, payload });
      return { side, action, payload };
    }

    // headless driver for tests/sim: scripted stance + bind providers.
    function runMatch(stanceFn, bindFn, spendFn) {
      let guard = 0;
      while (!st.over && guard++ < 500) {
        if (spendFn) spendFn(api);               // optional interleaved spends
        const p = stanceFn(ctx());
        const res = chooseStance(p);
        if (res && res.clash) {
          const pb = bindFn ? bindFn(ctx()) : Math.floor(rng() * 3);
          submitBind(pb);
        }
      }
      return matchOverSummary();
    }
    function matchOverSummary() {
      return {
        winner: st.hpP > 0 ? "P" : "A",
        rounds: st.round, hpP: st.hpP, hpA: st.hpA,
        damageDealtToP: HP - st.hpP, damageDealtToA: HP - st.hpA,
      };
    }

    const api = {
      bus, mode, difficulty, profile, meter,
      chooseStance, submitBind, spend, runMatch,
      state: () => ({ hpP: st.hpP, hpA: st.hpA, round: st.round, over: st.over,
        playerHist: st.playerHist.slice(), aiHist: st.aiHist.slice(),
        outcomes: st.outcomes.slice(), pending: !!st.pending }),
    };
    return api;
  }

  const api = {
    N, HP, CLEAN, GLANCE, ESC_ROUND,
    resolve, counter, resolveBind3, MODES, makeBus, rng32, createGame,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
