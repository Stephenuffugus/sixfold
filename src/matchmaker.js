/* SIXFOLD — matchmaker.js  (rank-banded pairing + Sentinel fallback)
 *
 * PURE policy, no I/O, no timers. Given a candidate pool (whoever the transport
 * says is online + waiting) and how long we've been searching, decide who to
 * pair with — and when to stop waiting and offer a Sentinel instead.
 *
 * Two rulings from the design council live here:
 *  - rank-banded: prefer an opponent close in rating; WIDEN the band the longer
 *    you wait (so a quiet ladder still finds *someone* eventually).
 *  - honest fallback: after SEARCH_TIMEOUT with no human, offer a Sentinel — a
 *    fair AI tuned to the player's rank — clearly labelled, at reduced stakes.
 *
 * Difficulty is the ONLY knob the Sentinel uses (the fairness pillar): rating
 * maps to a difficulty band, never to an odds advantage.
 */
(function (root) {
  "use strict";
  const req = (typeof require !== "undefined");
  const Personalities = req ? require("./personalities.js") : root.Personalities;
  const Rank = req ? require("./rank.js") : root.Rank;

  // widening rating-band schedule (half-width). The longer we search, the looser.
  const BANDS = [
    { until: 4000,  half: 75 },     // 0–4s : near-mirror rivals
    { until: 9000,  half: 200 },    // 4–9s : same neighbourhood
    { until: 15000, half: 500 },    // 9–15s: anyone roughly comparable
    { until: Infinity, half: Infinity }, // >15s: anyone online at all
  ];
  const SEARCH_TIMEOUT_MS = 13000;  // after this, with no human, offer a Sentinel

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // half-width of the acceptable rating band at a given search elapsed (ms)
  function bandFor(elapsedMs) {
    for (const b of BANDS) if (elapsedMs < b.until) return b.half;
    return Infinity;
  }

  // choose the best opponent in `pool` within the current band, or null.
  // pool entries: {id,name,rating,...}. opts.selfId excludes yourself; opts.busy
  // is a Set/array of ids already in a match; opts.tieIndex breaks ties stably.
  function pickOpponent(pool, myRating, elapsedMs, opts) {
    opts = opts || {};
    const half = bandFor(elapsedMs);
    const busy = toSet(opts.busy);
    let best = null, bestGap = Infinity;
    const list = pool || [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || c.id == null) continue;
      if (opts.selfId != null && c.id === opts.selfId) continue;
      if (busy.has(c.id)) continue;
      if (c.online === false) continue;
      const gap = Math.abs((c.rating || 0) - myRating);
      if (gap > half) continue;
      // closest rating wins; deterministic tiebreak by id so it's reproducible
      if (gap < bestGap || (gap === bestGap && best && String(c.id) < String(best.id))) {
        best = c; bestGap = gap;
      }
    }
    return best;
  }

  // what should the search UI do right now?
  //   "matched"        -> a human pairing exists (caller passes it in)
  //   "searching"      -> keep waiting, show the widening band
  //   "offer-sentinel" -> waited long enough with no human; offer the bot fallback
  function fallbackDecision(elapsedMs, hasHumanMatch) {
    if (hasHumanMatch) return "matched";
    if (elapsedMs >= SEARCH_TIMEOUT_MS) return "offer-sentinel";
    return "searching";
  }

  // map a rating to a fair difficulty in [0.12, 1.0]. Anchored so the start
  // rating sits low-mid and Master tops out near 1.0 (pillar: difficulty only).
  function ratingToDifficulty(rating) {
    const lo = Rank ? Rank.RATING_FLOOR : 200;
    const hi = (Rank && Rank.TIERS.length) ? Rank.TIERS[Rank.TIERS.length - 1].min + 250 : 2400;
    const t = clamp((rating - lo) / (hi - lo), 0, 1);
    return Math.round((0.12 + t * 0.88) * 100) / 100;
  }

  // archetypes grouped by star rating, so a Sentinel's "style" scales with rank.
  function archetypesByDifficulty(diff) {
    if (!Personalities) return ["ghost"];
    const ids = Personalities.ids();
    // target star tier 1..5 from difficulty
    const targetStars = clamp(Math.round(diff * 4) + 1, 1, 5);
    const byStars = ids.filter((id) => {
      const a = Personalities.ARCHES[id];
      return a && Math.abs((a.stars || 3) - targetStars) <= 1;
    });
    return byStars.length ? byStars : ids;
  }

  // build a Sentinel opponent descriptor for a player at `rating`.
  // rngFloat()->[0,1) optional (deterministic in tests); idx varies the name.
  function sentinelFor(rating, rngFloat, idx) {
    const difficulty = ratingToDifficulty(rating);
    const pool = archetypesByDifficulty(difficulty);
    const r = (typeof rngFloat === "function") ? rngFloat() : 0.5;
    const archetype = pool[Math.min(pool.length - 1, Math.floor(r * pool.length))];
    const tier = Rank ? Rank.tierFor(rating) : { name: "" };
    const name = sentinelName(tier.name, idx == null ? Math.floor(r * SENTINEL_NAMES.length) : idx);
    return {
      id: "sentinel:" + archetype + ":" + Math.round(rating),
      name, kind: "sentinel",
      rating: Math.round(rating),     // matched to the player so stakes are fair-but-reduced
      archetype, difficulty,
      tierName: tier.name,
    };
  }

  const SENTINEL_NAMES = ["Echoing Sentinel", "Hollow Rival", "Drifting Shade", "Phantom Aspirant",
    "Silent Understudy", "Mirror Sentinel", "Wandering Shadow", "Quiet Challenger"];
  function sentinelName(tierName, idx) {
    const base = SENTINEL_NAMES[((idx | 0) % SENTINEL_NAMES.length + SENTINEL_NAMES.length) % SENTINEL_NAMES.length];
    return tierName ? (base) : base;
  }

  function toSet(x) {
    if (!x) return new Set();
    if (x instanceof Set) return x;
    return new Set(x);
  }

  const api = {
    BANDS, SEARCH_TIMEOUT_MS,
    bandFor, pickOpponent, fallbackDecision,
    ratingToDifficulty, archetypesByDifficulty, sentinelFor,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Matchmaker = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
