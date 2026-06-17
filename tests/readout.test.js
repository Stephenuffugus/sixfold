"use strict";
/* node tests/readout.test.js */
const assert = require("assert");
const R = require("../src/readout.js");
const P = require("../src/predictor.js");

let passed = 0;
function ok(name, cond, extra) { assert.ok(cond, "FAIL: " + name + (extra ? " (" + extra + ")" : "")); passed++; console.log("  ok  " + name + (extra ? "  " + extra : "")); }

// ---- one-stance spammer scores < 15% unpredictability ----
{
  const spam = new Array(20).fill(2);
  const up = R.unpredictabilityPct(spam);
  ok("one-stance spammer < 15% unpredictable", up < 15, `up=${up}%`);
}

// ---- a bot that counters its own predicted move scores > 80% unpredictability ----
{
  // self-defeating: at each step, predict our own next move and play something
  // that the predictor would NOT expect (the counter of its own guess).
  const hist = [2]; // seed
  for (let i = 0; i < 40; i++) {
    const pr = P.predict(hist, 6);
    // play a move that breaks whatever pattern the ensemble locked onto:
    // counter our own predicted pick (forces the predictor to keep missing)
    const next = ((pr.pick - 1) % 6 + 6) % 6 === hist[hist.length - 1]
      ? (pr.pick + 2) % 6 : ((pr.pick - 1) % 6 + 6) % 6;
    hist.push(next);
  }
  const up = R.unpredictabilityPct(hist);
  ok("self-countering bot > 80% unpredictable", up > 80, `up=${up}%`);
}

// ---- rotation is highly predictable -> low unpredictability ----
{
  const rot = []; for (let i = 0; i < 24; i++) rot.push(i % 6);
  const up = R.unpredictabilityPct(rot);
  ok("rotation is predictable (< 30% unpredictable)", up < 30, `up=${up}%`);
}

// ---- biggestTell reports a tell + a worst round within range ----
{
  const rot = []; for (let i = 0; i < 12; i++) rot.push(i % 6);
  const t = R.biggestTell(rot);
  ok("biggestTell names the rotation tell", /rotat/i.test(t.tell), t.tell);
  ok("worstRound within history", t.worstRound >= 4 && t.worstRound <= rot.length, `r=${t.worstRound}`);
}

// ---- ribbon: newest-first, last K, tinted by outcome ----
{
  const hist = [0, 1, 2, 3, 4, 5];
  const outs = hist.map((_, i) => ({ kind: ["clean", "glance", "whiff", "clash", "clean", "glance"][i] }));
  const cells = R.ribbonData(hist, outs, 5);
  ok("ribbon returns K cells", cells.length === 5);
  ok("ribbon newest-first", cells[0].stance === 5 && cells[4].stance === 1);
  ok("ribbon glyph matches stance", cells[0].glyph === R.GLYPHS[5]);
  ok("ribbon tints by outcome", cells[0].tint === "jade"); // stance5 outcome 'glance' -> jade
}

// ---- empty / short safe ----
ok("unpredictability on empty is 100 (no read)", R.unpredictabilityPct([]) === 100);
ok("render is a safe no-op without DOM", (() => { R.render([0, 1, 2, 3], [0, 1], []); return true; })());
ok("postMatch returns a result object without DOM", (() => {
  const r = R.postMatch([0, 1, 2, 3, 4]); return typeof r.unpredictabilityPct === "number";
})());

console.log("\nREADOUT: %d assertions passed", passed);
