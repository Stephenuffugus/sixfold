"use strict";
/* node tests/resolve.test.js */
const assert = require("assert");
const { createResolve, RESOLVE_MAX } = require("../src/resolve.js");

let passed = 0;
function ok(name, cond, extra) {
  assert.ok(cond, "FAIL: " + name + (extra ? "  (" + extra + ")" : ""));
  passed++;
  console.log("  ok  " + name);
}

// ---- gains are symmetric ----
{
  const m = createResolve();
  m.gain({ kind: "whiff", winner: null });
  ok("whiff gives +1 to both", m.state().player === 1 && m.state().ai === 1);
  m.gain({ kind: "clean", winner: "P" });
  ok("clean does NOT grant resolve (drip off)", m.state().player === 1 && m.state().ai === 1);
  m.gain({ kind: "glance", winner: "A" });
  ok("glance does not grant resolve", m.state().player === 1 && m.state().ai === 1);
  m.onBindEntered();
  ok("bind-entered gives +1 to both", m.state().player === 2 && m.state().ai === 2);
}

// ---- cap at MAX ----
{
  const m = createResolve();
  for (let i = 0; i < 10; i++) m.gain({ kind: "whiff" });
  ok("caps at RESOLVE_MAX", m.state().player === RESOLVE_MAX && m.state().ai === RESOLVE_MAX);
}

// ---- spends are info-only ----
{
  const m = createResolve();
  for (let i = 0; i < 3; i++) m.gain({ kind: "whiff" });          // both at 3
  const r1 = m.spend("player", "INSIGHT");
  ok("INSIGHT costs 1", r1 && r1.cost === 1 && m.state().player === 2);
  ok("spend returns NO damage field", r1 && !("dmg" in r1) && !("damage" in r1));
  const r2 = m.spend("player", "FORESIGHT");
  ok("FORESIGHT costs 2", r2 && r2.cost === 2 && m.state().player === 0);
  ok("insufficient meter -> null, no change", m.spend("player", "INSIGHT") === null && m.state().player === 0);
  ok("ai meter untouched by player spends", m.state().ai === 3);
}

// ---- gains identical for both over a random outcome stream (honesty) ----
{
  const m = createResolve();
  function rng32(s){let a=s>>>0;return()=>{a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
  const rng = rng32(42);
  const kinds = ["clean", "glance", "whiff", "clash"];
  // simulate gains only (spends would diverge by player choice, which is fine —
  // the guarantee is that GAINS are identical, never the spends)
  let pGain = 0, aGain = 0;
  for (let i = 0; i < 10000; i++) {
    const k = kinds[Math.floor(rng() * 4)];
    const before = m.state();
    if (k === "clash") m.onBindEntered(); else m.gain({ kind: k, winner: rng() < 0.5 ? "P" : "A" });
    const after = m.state();
    pGain += after.player - before.player;
    aGain += after.ai - before.ai;
  }
  ok("player and AI gain identically over 10k rounds", pGain === aGain, `p=${pGain} a=${aGain}`);
}

// ---- canSpend / reset ----
{
  const m = createResolve();
  ok("canSpend false when empty", !m.canSpend("player", "INSIGHT"));
  m.gain({ kind: "whiff" });
  ok("canSpend true at 1 for INSIGHT", m.canSpend("player", "INSIGHT"));
  ok("canSpend false at 1 for FORESIGHT", !m.canSpend("player", "FORESIGHT"));
  m.reset();
  ok("reset zeroes both", m.state().player === 0 && m.state().ai === 0);
}

console.log("\nRESOLVE: %d assertions passed", passed);
