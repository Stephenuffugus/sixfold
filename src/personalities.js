/* SIXFOLD — personalities.js  (spec §1)
 *
 * Each personality = a HABIT (the tell you exploit) + how well it READS you
 * (the threat) + an entropy floor (noise = its ceiling). Difficulty is ONE knob:
 * it scales reading up and the telegraph (noise) down. No stat ever changes —
 * personalities only shift the *distribution* a fighter picks from. Symmetry and
 * the validated damage model are untouched (engine owns all damage).
 *
 * API (frozen, spec §5):
 *   create(id, rng)            -> profile instance (per-match params fixed here)
 *   aiChoose(profile, ctx)     -> Stance 0..5
 *   bindChoose(profile, ctx)   -> Bind 0..2
 *   spendPolicy(profile, ctx)  -> {action,cost} | null
 */
(function (root) {
  "use strict";
  const Predictor = (typeof require !== "undefined") ? require("./predictor.js") : root.Predictor;

  const N = 6;
  const counter = (p) => ((p - 1) % N + N) % N;          // stance that CLEAN-hits p
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrap = (i) => ((i % N) + N) % N;

  function normalize(d) {
    let s = 0;
    for (const x of d) s += x;
    if (s <= 0) return new Array(N).fill(1 / N);
    return d.map((x) => x / s);
  }
  function sample(d, rng) {
    const nd = normalize(d);
    let r = rng();
    for (let i = 0; i < nd.length; i++) { r -= nd[i]; if (r <= 0) return i; }
    return nd.length - 1;
  }
  function uniform() { return new Array(N).fill(1 / N); }
  // normalized distribution with `purity` mass concentrated on `target`
  function peak(target, purity) {
    const d = new Array(N).fill((1 - purity) / N);
    d[wrap(target)] += purity;
    return d;
  }
  // arc of width 3 centred on `center`: most purity on centre, the rest on neighbours
  function peakArc(center, purity) {
    const d = new Array(N).fill((1 - purity) / N);
    d[wrap(center)] += purity * 0.6;
    d[wrap(center - 1)] += purity * 0.2;
    d[wrap(center + 1)] += purity * 0.2;
    return d;
  }

  // ---------- bias builders: (profile, ctx) -> normalized distribution ----------
  const BIAS = {
    favorStance: (p, ctx) => peak(p.favStance, 0.78),
    homeArc:     (p, ctx) => peakArc(p.center, 0.85),
    winStay:     (p, ctx) => {
      const ai = ctx.aiHist;
      if (ai.length && ctx.lastOutcome && ctx.lastOutcome.winner === "A") {
        return peak(ai[ai.length - 1], 0.85);       // repeat the stance that just hit
      }
      return peak(ai.length ? ai[ai.length - 1] : 0, 0.25); // mild lean otherwise
    },
    neverRepeat: (p, ctx) => {
      const ai = ctx.aiHist;
      const d = new Array(N).fill(1);
      if (ai.length) d[ai[ai.length - 1]] = 0.02;    // almost never the last pick
      return normalize(d);
    },
    rotate: (p, ctx) => {
      const ai = ctx.aiHist;
      const base = ai.length ? ai[ai.length - 1] : (p.phase || 0);
      return peak(base + p.dir * p.step, 0.9);        // march a fixed step
    },
    mirrorPlayer: (p, ctx) => {
      const ph = ctx.playerHist;
      if (!ph.length) return uniform();
      return peak(ph[ph.length - 1], 0.85);           // play YOUR last stance
    },
    adaptiveCounter: (p, ctx) => readDist(p, ctx, 0.5).dist, // Echo's bias IS a read
  };

  // ---------- the read (threat): predict the player and aim a counter ----------
  // yomi depth: 1 = counter the predicted pick (clean hit); 2 = one level deeper.
  function readDist(p, ctx, readThreshold) {
    if (!p.readStrength) return { dist: uniform(), confidence: 0 };
    const pr = Predictor.predict(ctx.playerHist, N);
    if (pr.confidence > readThreshold) {
      const target = wrap(pr.pick - (p.yomi || 1));   // yomi=1 -> counter(predicted)
      return { dist: peak(target, p.readStrength), confidence: pr.confidence };
    }
    return { dist: uniform(), confidence: pr.confidence };
  }

  // ---------- difficulty knob (spec §1) ----------
  function knob(profile, skill) {
    return {
      wBias: profile.w.bias,
      wRead: lerp(profile.w.read * 0.4, profile.w.read * 1.3, skill),
      wNoise: lerp(profile.w.noise * 1.4, profile.w.noise * 0.7, skill),
      readThreshold: lerp(0.30, 0.14, skill),
    };
  }

  function applyTriggers(profile, dist, ctx) {
    if (!profile.triggers) return;
    for (const t of profile.triggers) {
      if (t.when(ctx)) t.effect(dist, ctx);
    }
  }

  function aiChoose(profile, ctx) {
    ctx.profile = profile;                 // triggers read per-match params from here
    const skill = (ctx.difficulty == null) ? 0.5 : ctx.difficulty;
    const k = knob(profile, skill);
    const bias = BIAS[profile.bias](profile, ctx);
    const read = readDist(profile, ctx, k.readThreshold).dist;
    const dist = new Array(N);
    for (let i = 0; i < N; i++) {
      dist[i] = k.wBias * bias[i] + k.wRead * read[i] + k.wNoise * (1 / N);
    }
    applyTriggers(profile, dist, ctx);
    return sample(dist, ctx.rng);
  }

  // ---------- Clash Bind choice: Bind 0..2 (Drive>Trap>Slip>Drive) ----------
  // AI beats player bind pb by playing (pb+2)%3  (d3=(a-p)%3==2 => ai wins)
  const beatsBind = (pb) => (pb + 2) % 3;
  function bindChoose(profile, ctx) {
    const rng = ctx.rng;
    switch (profile.bind) {
      case "drive": return 0;                                   // Berserker always Drive
      case "antiread": {                                        // Trickster anti-reads
        const pr = Predictor.predict(ctx.bindHistP || [], 3);
        if (pr.confidence > 0.25) return beatsBind(pr.pick);
        return Math.floor(rng() * 3);
      }
      case "read": {                                            // Echo reads the bind stream
        const pr = Predictor.predict(ctx.bindHistP || [], 3);
        if (pr.confidence > 0.30) return beatsBind(pr.pick);
        return Math.floor(rng() * 3);
      }
      default: return Math.floor(rng() * 3);                    // Ghost & co: random
    }
  }

  // ---------- spend policy: flavor only, never power (engine guarantees) ----------
  function spendPolicy(profile, ctx) {
    const r = (ctx.resolve && ctx.resolve.ai) || 0;
    switch (profile.spend) {
      case "never": return null;                                // Berserker
      case "hoard-foresight":                                   // Ghost
        if (ctx.aiHP <= 2 && r >= 2) return { action: "FORESIGHT", cost: 2 };
        return null;
      case "foresight-on-doubt": {                              // Echo
        const pr = Predictor.predict(ctx.playerHist, N);
        if (pr.confidence < 0.3 && r >= 2) return { action: "FORESIGHT", cost: 2 };
        if (r >= 1) return { action: "INSIGHT", cost: 1 };
        return null;
      }
      default:                                                  // occasional Insight
        if (r >= 3) return { action: "INSIGHT", cost: 1 };
        return null;
    }
  }

  // ---------- roster (ship 8) ----------
  const ARCHES = {
    berserker: {
      name: "Berserker", tell: "Repeats the stance that just hit — counter the repeat.",
      stars: 1, w: { bias: 0.60, read: 0.10, noise: 0.30 },
      bias: "winStay", readStrength: 0.6, yomi: 1, bind: "drive", spend: "never",
      triggers: [{ when: (c) => c.aiHP > c.playerHP, effect: (d, c) => {
        const ai = c.aiHist; if (ai.length) d[ai[ai.length - 1]] *= 2.2; // ahead -> lean harder
      } }],
    },
    stone: {
      name: "Stone", tell: "Picks bunch in one arc — counter the cluster.",
      stars: 2, w: { bias: 0.72, read: 0.08, noise: 0.20 },
      bias: "homeArc", readStrength: 0.45, yomi: 1, bind: "random", spend: "insight",
      // low HP -> narrow onto the home-arc centre
      triggers: [{ when: (c) => c.aiHP <= 2, effect: (d, c) => {
        const ctr = c.profile && c.profile.center;
        if (ctr != null) d[ctr] *= 2.2;
      } }],
    },
    drunkard: {
      name: "Drunkard", tell: "Never repeats — eliminate its last pick.",
      stars: 2, w: { bias: 0.74, read: 0.08, noise: 0.18 },
      bias: "neverRepeat", readStrength: 0.45, yomi: 1, bind: "random", spend: "insight",
    },
    mirror: {
      name: "Mirror", tell: "Plays YOUR last stance — counter your own previous move.",
      stars: 2, w: { bias: 0.80, read: 0.00, noise: 0.20 },
      bias: "mirrorPlayer", readStrength: 0, yomi: 1, bind: "random", spend: "insight",
    },
    metronome: {
      name: "Metronome", tell: "Marches a fixed step — find the cadence, stay ahead.",
      stars: 3, w: { bias: 0.75, read: 0.00, noise: 0.25 },
      bias: "rotate", readStrength: 0, yomi: 1, bind: "random", spend: "insight",
    },
    trickster: {
      name: "Trickster", tell: "Beats your counter — don't take the bait, go a level deeper.",
      stars: 4, w: { bias: 0.20, read: 0.55, noise: 0.25 },
      bias: "favorStance", readStrength: 0.85, yomi: 2, bind: "antiread", spend: "insight",
    },
    ghost: {
      name: "Ghost", tell: "Near-random + sharp read — survive on your own unpredictability.",
      stars: 5, w: { bias: 0.05, read: 0.35, noise: 0.60 },
      bias: "favorStance", readStrength: 0.9, yomi: 1, bind: "random", spend: "hoard-foresight",
    },
    echo: {
      name: "Echo", tell: "Learns you in real time — it does to you what you do to others.",
      stars: 5, w: { bias: 0.10, read: 0.65, noise: 0.25 },
      bias: "adaptiveCounter", readStrength: 0.9, yomi: 1, bind: "read", spend: "foresight-on-doubt",
    },
  };

  function create(id, rng) {
    const base = ARCHES[id];
    if (!base) throw new Error("unknown personality: " + id);
    const p = JSON.parse(JSON.stringify({
      id, name: base.name, tell: base.tell, stars: base.stars,
      w: base.w, bias: base.bias, readStrength: base.readStrength,
      yomi: base.yomi, bind: base.bind, spend: base.spend,
    }));
    p.triggers = base.triggers || [];   // functions don't survive JSON; re-attach
    // per-match fixed params
    if (id === "stone") p.center = Math.floor(rng() * N);
    if (id === "metronome") { p.step = rng() < 0.5 ? 1 : 2; p.dir = rng() < 0.5 ? 1 : -1; p.phase = Math.floor(rng() * N); }
    if (id === "trickster" || id === "ghost") p.favStance = Math.floor(rng() * N);
    return p;
  }

  const ids = () => Object.keys(ARCHES);
  const api = {
    create, aiChoose, bindChoose, spendPolicy,
    ids, counter, ARCHES,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Personalities = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
