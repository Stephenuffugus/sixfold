"use strict";
/* node tests/assists.test.js */
const assert = require("assert");
const A = require("../src/assists.js");

let passed = 0;
function ok(name, cond) { assert.ok(cond, "FAIL: " + name); passed++; console.log("  ok  " + name); }

const casual = { id: "casual", honorsAssists: true };
const ranked = { id: "daily", honorsAssists: false, seeded: true };
const pvp = { id: "ghost-duel", honorsAssists: false };

A._reset();

// ---- accessibility: free, always available, mode-independent ----
ok("a11y settings available with zero unlocks", typeof A.settings().colorblind === "boolean");
A.setSetting("colorblind", true);
ok("a11y toggles persist in-session", A.settings().colorblind === true);
ok("a11y unaffected by mode (no mode arg needed)", A.settings().colorblind === true);
ok("unknown a11y key is ignored safely", A.setSetting("nonsense", true) && !("nonsense" in A.settings()));

// ---- charms: equip + the inert-in-competitive rule ----
A.equip("eye");
ok("charm equips in casual", A.current() && A.current().id === "eye");
ok("active() returns charm in casual (honorsAssists)", A.active(casual) && A.active(casual).id === "eye");
ok("active() returns NULL in ranked/seeded", A.active(ranked) === null);
ok("active() returns NULL in PvP", A.active(pvp) === null);
ok("active(undefined mode) is null (safe default)", A.active(undefined) === null);

// equipping a charm does NOT leak into competitive
ok("competitive ignores equipped charm entirely", A.active(ranked) === null && A.current().id === "eye");

// status labels
ok("competitive shows 'Assists off' banner", A.statusLabel(ranked) === "Assists off — competitive");
ok("casual shows the equipped charm", A.statusLabel(casual).indexOf("Eye") >= 0);

// unequip
A.equip(null);
ok("unequip clears charm", A.current() === null);
ok("active() null when nothing equipped (casual)", A.active(casual) === null);

// can't equip a locked/unknown charm
A._reset();
A.equip("nonexistent");
ok("equipping unknown charm is a no-op", A.current() === null);

// every charm only touches time/info/clarity — never power
ok("no charm touches damage/odds", Object.values(A.CHARMS).every(c => ["time", "info", "clarity"].includes(c.touches)));

console.log("\nASSISTS: %d assertions passed", passed);
