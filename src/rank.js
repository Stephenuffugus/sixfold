/* SIXFOLD — rank.js  (ranked-duel ladder)
 *
 * The competitive progression layer for live head-to-head duels. PURE math +
 * a tiny serializable ladder object; no DOM, no localStorage (the glue owns
 * persistence). Two ideas only:
 *
 *   1) a hidden Elo RATING (the matchmaking signal), and
 *   2) a visible TIER ladder derived from that rating (the feeling of climbing).
 *
 * Fairness pillar: rank rewards OUTCOMES of symmetric duels — it never touches
 * the combat math (no stat, no odds). A duel against a Sentinel (the no-opponent
 * fallback) moves rating at REDUCED stakes so it can't be farmed.
 *
 * The serialized shape is deliberately cloud-ready: {playerId,name,rating,wins,
 * losses,streak,peak,updatedAt,pending[]} drops straight into Firebase later
 * (pending[] = unsynced results to replay on first sync).
 */
(function (root) {
  "use strict";

  // visible tiers, ascending. `min` = inclusive rating floor. Gaps widen near the
  // top so the last climbs are the hardest (classic ladder shape).
  const TIERS = [
    { key: "stone",  name: "Stone",  glyph: "🪨", min: 0 },
    { key: "bronze", name: "Bronze", glyph: "🥉", min: 1000 },
    { key: "iron",   name: "Iron",   glyph: "⚔", min: 1250 },
    { key: "jade",   name: "Jade",   glyph: "🟢", min: 1500 },
    { key: "onyx",   name: "Onyx",   glyph: "🟣", min: 1800 },
    { key: "master", name: "Master", glyph: "👑", min: 2150 },
  ];
  const START_RATING = 1000;   // new players enter at the Bronze floor (Stone is below = demotion room)
  const RATING_FLOOR = 200;    // never sink below this
  const K_BASE = 32;           // Elo K-factor for a live duel
  const SENTINEL_STAKES = 0.4; // fraction of K applied to Sentinel (bot) duels
  // soft span used only to render a progress bar inside the top (open-ended) tier
  const MASTER_SPAN = 600;

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // tier index for a rating (highest tier whose floor it clears)
  function tierIndexFor(rating) {
    let idx = 0;
    for (let i = 0; i < TIERS.length; i++) if (rating >= TIERS[i].min) idx = i;
    return idx;
  }

  // full tier descriptor + progress toward the next tier (0..1) + rating-to-next.
  function tierFor(rating) {
    rating = Math.round(rating);
    const i = tierIndexFor(rating);
    const t = TIERS[i];
    const isTop = i === TIERS.length - 1;
    const floor = t.min;
    const ceil = isTop ? t.min + MASTER_SPAN : TIERS[i + 1].min;
    const progress = clamp((rating - floor) / (ceil - floor), 0, 1);
    const toNext = isTop ? 0 : Math.max(0, ceil - rating);
    return {
      index: i, key: t.key, name: t.name, glyph: t.glyph,
      rating, floor, ceil, isTop, progress,
      toNext, next: isTop ? null : TIERS[i + 1].name,
    };
  }

  // standard Elo expected score for `myRating` vs `oppRating`
  function expected(myRating, oppRating) {
    return 1 / (1 + Math.pow(10, (oppRating - myRating) / 400));
  }

  // rating change for one result. won=true|false. kind="live"|"sentinel".
  // Returns a signed integer delta (never zero on a decided result, so the bar
  // always visibly moves — min ±1).
  function ratingDelta(myRating, oppRating, won, kind) {
    const k = K_BASE * (kind === "sentinel" ? SENTINEL_STAKES : 1);
    const score = won ? 1 : 0;
    const raw = k * (score - expected(myRating, oppRating));
    let d = Math.round(raw);
    if (d === 0) d = won ? 1 : -1;           // guarantee a visible nudge
    // never let the floor make a loss a no-op either; floor is applied by caller
    return d;
  }

  // ---- ladder: a small stateful holder the glue persists verbatim ----
  function createLadder(saved) {
    saved = saved || {};
    const st = {
      v: 1,
      playerId: saved.playerId || genId(),
      name: saved.name || "You",
      rating: clampRating(saved.rating != null ? saved.rating : START_RATING),
      wins: saved.wins | 0,
      losses: saved.losses | 0,
      streak: saved.streak | 0,                 // current win streak (resets on loss)
      bestStreak: saved.bestStreak | 0,
      peak: saved.peak != null ? saved.peak : (saved.rating != null ? saved.rating : START_RATING),
      placements: saved.placements != null ? (saved.placements | 0) : 0, // ranked matches played
      updatedAt: saved.updatedAt || 0,
      pending: Array.isArray(saved.pending) ? saved.pending.slice() : [],
    };

    function clampRating(r) { return Math.max(RATING_FLOOR, Math.round(r)); }

    // apply one decided duel. opp = {rating,kind,name?,id?}. when = caller's clock.
    // returns {before,after,delta,promoted,demoted,tierBefore,tierAfter}.
    function applyResult(won, opp, when) {
      const before = st.rating;
      const oppRating = (opp && opp.rating != null) ? opp.rating : before;
      const kind = (opp && opp.kind === "sentinel") ? "sentinel" : "live";
      const tBefore = tierFor(before);
      const delta = ratingDelta(before, oppRating, won, kind);
      st.rating = clampRating(before + delta);
      const realDelta = st.rating - before;          // after floor clamp
      if (won) { st.wins++; st.streak++; if (st.streak > st.bestStreak) st.bestStreak = st.streak; }
      else { st.losses++; st.streak = 0; }
      if (st.rating > st.peak) st.peak = st.rating;
      st.placements++;
      st.updatedAt = when || st.updatedAt;
      const tAfter = tierFor(st.rating);
      // record for later cloud replay (bounded so storage can't grow without limit)
      st.pending.push({ won: !!won, delta: realDelta, oppId: opp && opp.id, oppRating, kind, at: st.updatedAt });
      if (st.pending.length > 200) st.pending.splice(0, st.pending.length - 200);
      return {
        before, after: st.rating, delta: realDelta,
        tierBefore: tBefore, tierAfter: tAfter,
        promoted: tAfter.index > tBefore.index,
        demoted: tAfter.index < tBefore.index,
        kind,
      };
    }

    function tier() { return tierFor(st.rating); }
    function winRate() { const n = st.wins + st.losses; return n ? Math.round((st.wins / n) * 100) : 0; }
    function toJSON() { return JSON.parse(JSON.stringify(st)); }
    function setName(n) { st.name = String(n || "You").slice(0, 14) || "You"; }
    // mark pending results as synced (Phase 2 cloud hook)
    function clearPending() { const p = st.pending.slice(); st.pending = []; return p; }

    return {
      get rating() { return st.rating; },
      get wins() { return st.wins; },
      get losses() { return st.losses; },
      get streak() { return st.streak; },
      get bestStreak() { return st.bestStreak; },
      get peak() { return st.peak; },
      get placements() { return st.placements; },
      get playerId() { return st.playerId; },
      get name() { return st.name; },
      applyResult, tier, winRate, toJSON, setName, clearPending,
    };
  }

  // small, dependency-free id (good enough as a stable local player key; Phase 2
  // can replace with the auth uid). Avoids Math.random reliance for determinism in
  // tests by mixing a passed seed when given.
  function genId(seed) {
    const base = (seed != null) ? seed : (idCounter++ ^ 0x9e3779b9);
    let x = (base >>> 0) || 1, out = "p_";
    for (let i = 0; i < 8; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; out += (x % 36).toString(36); }
    return out;
  }
  let idCounter = 1;

  const api = {
    TIERS, START_RATING, RATING_FLOOR, K_BASE, SENTINEL_STAKES,
    tierFor, tierIndexFor, expected, ratingDelta, createLadder, genId,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Rank = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
