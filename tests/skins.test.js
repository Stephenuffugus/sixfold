"use strict";
const S = require("../src/skins.js");
let n = 0;
function ok(name, cond, extra) { n++; if (!cond) { console.error("  FAIL", name, extra || ""); process.exit(1); } console.log("  ok ", name); }

// ---- registry ----
ok("six canonical frames", S.FRAMES.length === 6 && S.FRAMES[0] === "idle" && S.FRAMES[5] === "win");
ok("placeholder is first and vector", S.list()[0].id === "placeholder" && S.list()[0].kind === "vector");
ok("demo skin present and is atlas", !!S.list().find((s) => s.id === "inkblade" && s.kind === "atlas"));
ok("get falls back to placeholder for unknown id", S.get("nope").id === "placeholder");

// ---- atlas math (2x3 grid) ----
const ink = S.get("inkblade");
ok("idle is top-left", S.atlasPos(ink, "idle") === "0% 0%");
ok("hit is top-right (last col)", S.atlasPos(ink, "hit") === "100% 0%");
ok("ko is bottom-left", S.atlasPos(ink, "ko") === "0% 100%");
ok("win is bottom-right", S.atlasPos(ink, "win") === "100% 100%");
ok("strike is mid-top (col 1 of 3)", S.atlasPos(ink, "strike") === "50% 0%");
ok("guard is mid-bottom", S.atlasPos(ink, "guard") === "50% 100%");
ok("unknown frame is safe (0% 0%)", S.atlasPos(ink, "bogus") === "0% 0%");

// ---- src generation ----
const src = S.src(ink, "#3f6fb0");
ok("demo atlas is an inline svg data-uri", typeof src === "string" && src.indexOf("data:image/svg+xml,") === 0);
ok("demo atlas carries the requested palette", decodeURIComponent(src).indexOf("#3f6fb0") >= 0);
ok("vector skin has no src", S.src(S.get("placeholder")) === null);

// ---- pillar: skins expose no combat surface (art only, never power) ----
ok("no damage/odds/meter fields on a skin meta", (() => {
  const keys = Object.keys(ink).join(",").toLowerCase();
  return ["dmg", "damage", "hp", "odds", "meter", "bonus", "buff"].every((bad) => keys.indexOf(bad) < 0);
})());

console.log("\nSKINS: " + n + " assertions passed");
