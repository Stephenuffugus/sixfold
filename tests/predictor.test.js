"use strict";
/* node tests/predictor.test.js  — no framework, plain assert */
const assert = require("assert");
const P = require("../src/predictor.js");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, "FAIL: " + name);
  passed++;
  console.log("  ok  " + name);
}

// ---- readability bounds ----
// "Unreadable" means genuine randomness, not balance: a perfectly balanced
// round-robin is itself readable (antiRepeat nails it). So we test that TRUE
// random streams score ~0 in expectation. Deterministic PRNG for repeatability.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function randomStream(seed, len, N) {
  const rng = makeRng(seed);
  const out = [];
  for (let i = 0; i < len; i++) out.push(Math.floor(rng() * N));
  return out;
}
let sum = 0;
const TRIALS = 300;
for (let s = 1; s <= TRIALS; s++) sum += P.readability(randomStream(s * 7 + 1, 40, 6)).score;
const meanUniform = sum / TRIALS;
console.log("mean readability over %d random streams: %s", TRIALS, meanUniform.toFixed(4));
ok("random streams readability ~0 (mean < 0.15)", meanUniform < 0.15);
const uniform = randomStream(99, 40, 6);
ok("a single random stream is low (< 0.35)", P.readability(uniform).score < 0.35);

const pureRepeatRuns = []; // long runs -> repeat predictor dominates, frequency does not
[1, 5, 3, 0, 4, 2, 1, 5].forEach((v) => { for (let i = 0; i < 4; i++) pureRepeatRuns.push(v); });
const rr = P.readability(pureRepeatRuns);
console.log("repeat-runs: score=%s tell=%s", rr.score.toFixed(3), rr.tell);
ok("repeat-runs readability > 0.60 (open book)", rr.score > 0.6);

const constStream = new Array(20).fill(3);
ok("constant stream readability ~1", P.readability(constStream).score > 0.95);

// ---- attribution on crafted streams ----
function attributes(stream, expected) {
  const r = P.readability(stream);
  return r.predictorName === expected;
}

// repeat: long runs, changing value -> 'repeat' (not 'frequency': no single favourite)
ok("attributes repeat", attributes(pureRepeatRuns, "repeat"));

// rotation by +1 -> 'cycle'
const rotation = [];
for (let i = 0; i < 24; i++) rotation.push(i % 6);
console.log("rotation tell: %s", P.readability(rotation).predictorName);
ok("attributes cycle (rotation +1)", attributes(rotation, "cycle"));

// rotation by +2 -> 'cycle'
const rot2 = [];
for (let i = 0; i < 24; i++) rot2.push((i * 2) % 6);
ok("attributes cycle (rotation +2)", attributes(rot2, "cycle"));

// favourite: i.i.d. biased toward one stance (the favourite may land twice in a
// row, which is what separates it from an alternation pattern) -> 'frequency'
function favouriteStream(seed, len, fav, p) {
  const rng = makeRng(seed);
  const out = [];
  for (let i = 0; i < len; i++) {
    out.push(rng() < p ? fav : Math.floor(rng() * 6));
  }
  return out;
}
const fav = favouriteStream(123, 40, 2, 0.6);
console.log("favourite tell: %s score=%s", P.readability(fav).predictorName, P.readability(fav).score.toFixed(3));
ok("attributes frequency (favourite)", attributes(fav, "frequency"));

// attribution overall accuracy check across the crafted set
const crafted = [
  [pureRepeatRuns, "repeat"],
  [rotation, "cycle"],
  [rot2, "cycle"],
  [fav, "frequency"],
];
let hits = 0;
crafted.forEach(([s, e]) => { if (attributes(s, e)) hits++; });
console.log("attribution: %d/%d", hits, crafted.length);
ok("attribution >= 90% on crafted streams", hits / crafted.length >= 0.9);

// ---- predict() returns counter-able info ----
const pr = P.predict(rotation);
ok("predict on rotation is confident", pr.confidence > 0.6);
ok("predict on rotation names cycle", pr.predictorName === "cycle");
const pNext = (rotation[rotation.length - 1] + 1) % 6;
ok("predict on rotation picks the next step", pr.pick === pNext);

const pu = P.predict(uniform);
ok("predict on uniform is low confidence", pu.confidence < 0.5);

// ---- empty / tiny histories don't throw ----
ok("predict([]) safe", typeof P.predict([]).pick === "number" && P.predict([]).confidence === 0);
ok("readability([]) safe ~0", P.readability([]).score === 0);
ok("predict([2]) safe", typeof P.predict([2]).pick === "number");

// ---- 3-symbol bind instance (N=3) ----
const bindRepeat = [0, 0, 0, 1, 1, 1, 2, 2, 2, 0, 0, 0];
const br = P.readability(bindRepeat, 3);
console.log("bind repeat-runs (N=3): score=%s tell=%s", br.score.toFixed(3), br.tell);
ok("bind readability high on repeat-runs", br.score > 0.5);
let bsum = 0;
for (let s = 1; s <= TRIALS; s++) bsum += P.readability(randomStream(s * 13 + 5, 40, 3), 3).score;
const bMeanUniform = bsum / TRIALS;
console.log("mean bind readability over %d random N=3 streams: %s", TRIALS, bMeanUniform.toFixed(4));
ok("bind readability ~0 on random streams (mean < 0.25)", bMeanUniform < 0.25);
const bp = P.predict(bindRepeat, 3);
ok("bind predict pick in 0..2", bp.pick >= 0 && bp.pick <= 2);

console.log("\nPREDICTOR: %d assertions passed", passed);
