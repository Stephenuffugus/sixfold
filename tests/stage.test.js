"use strict";
/* node tests/stage.test.js  — headless: stage must never throw without a DOM */
const assert = require("assert");
const S = require("../src/stage.js");

let passed = 0;
function ok(name, cond) { assert.ok(cond, "FAIL: " + name); passed++; console.log("  ok  " + name); }

S.init({}); // no element refs, no document

ok("POSE has 6 stance transforms", S.POSE.length === 6);
ok("Heaven leans up", /translateY\(-6px\)/.test(S.POSE[0]));
ok("Earth crouches", /scaleY\(\.96\)/.test(S.POSE[3]));
ok("each pose is a transform string", S.POSE.every(p => typeof p === "string" && p.length > 0));
ok("3 bind options Drive/Slip/Trap", S.BINDS.length === 3 && S.BINDS[0].name === "Drive" && S.BINDS[2].name === "Trap");

ok("toStance no-ops safely without DOM", (() => { S.toStance("P", 2); S.toStance("A", 5); return true; })());
ok("lockBlades no-ops safely", (() => { S.lockBlades(); S.unlock(); return true; })());

// playReveal returns a resolving promise even headless
let revealed = false;
S.playReveal(2, 4, { kind: "clean", winner: "P", dmg: 2 }).then(() => { revealed = true; });

// bindPrompt resolves to a valid bind even headless (no hub)
S.bindPrompt().then((b) => {
  ok("bindPrompt resolves to 0..2 headless", b >= 0 && b <= 2);
  ok("playReveal promise resolved", revealed);
  console.log("\nSTAGE: %d assertions passed", passed);
}).catch((e) => { console.error("FAIL", e); process.exit(1); });
