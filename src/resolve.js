/* SIXFOLD — resolve.js  (spec §3)  Insight + Foresight only.
 *
 * Converts DEAD rounds into a resource that buys INFORMATION, never force.
 * Honesty is structural, not promised:
 *   - the only gains are SYMMETRIC (whiff -> +1 both, bind-entered -> +1 both),
 *     so player and AI meters always hold identical totals;
 *   - spend() mutates ONLY the meter and returns an info descriptor — it has no
 *     HP/damage field and cannot reach the engine's damage path.
 * Focus (the damage spend) was deliberately cut so the meter is unimpeachable.
 *
 * API (frozen, spec §5):
 *   gain(outcome) ; onBindEntered() ; spend(side, action) -> InfoReveal|null ; state()
 * Use createResolve() per match (the engine owns one instance).
 */
(function (root) {
  "use strict";

  const RESOLVE_MAX = 3;
  const COST = { INSIGHT: 1, FORESIGHT: 2 };

  function createResolve(opts) {
    opts = opts || {};
    // comeback drip (taking a clean -> +1 victim) is OFF by default: it would make
    // per-player gains unequal and break the "gain identically" guarantee. Opt-in only.
    const comebackDrip = !!opts.comebackDrip;
    // optional symmetric starting stipend (both sides) so the perception layer
    // (Insight/Foresight) is usable in short matches. Symmetric => pillar-safe.
    const start = Math.max(0, Math.min(RESOLVE_MAX, opts.startWith || 0));
    const state = { player: start, ai: start };

    // accept both the meter's native keys ("player"/"ai") and the engine's
    // side convention ("P"/"A") so callers can't silently miss the meter.
    const SIDE = { P: "player", A: "ai", player: "player", ai: "ai" };
    const norm = (s) => SIDE[s] || s;
    const add = (side, n) => { side = norm(side); state[side] = Math.min(RESOLVE_MAX, state[side] + n); };
    const both = (n) => { add("player", n); add("ai", n); };

    function gain(outcome) {
      if (!outcome) return;
      if (outcome.kind === "whiff") both(1);                 // symmetric
      else if (comebackDrip && outcome.kind === "clean" && outcome.winner) {
        add(outcome.winner === "P" ? "ai" : "player", 1);    // victim only (opt-in)
      }
    }

    function onBindEntered() { both(1); }                    // fires on entering any bind

    // returns InfoReveal {side, action, cost} on success, else null. NO damage field.
    function spend(side, action) {
      side = norm(side);
      const cost = COST[action];
      if (cost == null) return null;
      if (state[side] < cost) return null;
      state[side] -= cost;
      return { side, action, cost };
    }

    function canSpend(side, action) {
      const cost = COST[action];
      return cost != null && state[norm(side)] >= cost;
    }

    function reset() { state.player = start; state.ai = start; }

    return {
      gain, onBindEntered, spend, canSpend, reset,
      state: () => ({ player: state.player, ai: state.ai }),
      MAX: RESOLVE_MAX, COST,
    };
  }

  const api = { createResolve, RESOLVE_MAX, COST };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Resolve = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
