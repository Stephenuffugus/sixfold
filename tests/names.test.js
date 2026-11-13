"use strict";
/* node tests/names.test.js
 * A display name is never rude: the matcher sees through case, spacing, symbols,
 * digits for letters and held down letters, and lets ordinary names through
 * (including names and places that merely contain a short rude word).
 * The caught names are written rot13 encoded so this file reads clean. */
const assert = require("assert");
const Names = require("../src/names.js");
const FN = require("../src/firebase-net.js");

let passed = 0;
function ok(name, cond, extra) { assert.ok(cond, "FAIL: " + name + (extra ? " (" + extra + ")" : "")); passed++; console.log("  ok  " + name + (extra ? "  " + extra : "")); }
const rot = (s) => s.replace(/[a-zA-Z]/g, (c) => { const b = c <= "Z" ? 65 : 97; return String.fromCharCode((c.charCodeAt(0) - b + 13) % 26 + b); });

const CAUGHT = ["Shhhpx", "s h p x", "S.H.P.X", "fu1g", "n$$", "N F F", "o1gpu", "Ovgpul", "a1tt3e", "qvpx", "Qvpxf", "ovt pbpx",
  "P0PX", "ch55l", "Nff ung", "xlf", "zbgures", "shpxre99", "PHAG", "j_u_b_e_r", "uvgyre88", "fu!!!g", "fyhg", "Encr", "s@t", "SNTTBG",
  "fuvgurnq", "Shpx lbh", "obbbbo", "anmv"].map(rot);
const ALLOWED = ["Ash", "Mika", "Jessie", "Cassandra", "Dickens", "Peacock", "Hancock", "Grape", "Essex", "Analyst", "Raccoon",
  "Spicey", "Matsushita", "Therapist", "Swankster", "Nazir", "Thorny", "Cocktail", "Assassin", "Passion", "Shoe", "Kappa Grappler",
  "Player 2", "Ronin99", "Sakura", "Takeshi", "Hoenn", "Skunk", "Classy", "Bass", "As", "Sussex", "Scrappy"];

(() => {
  ok("the lists load and decode", Names._lists().whole > 10 && Names._lists().token > 10);
  CAUGHT.forEach((n, i) => ok("caught name #" + (i + 1) + " (" + rot(n) + ", stored encoded)", Names.isRude(n)));
  ALLOWED.forEach((n) => ok("allowed: " + n, !Names.isRude(n)));
  ok("an empty name is not rude", !Names.isRude("") && !Names.isRude(null));
  ok("clean() turns a caught name into Player", Names.clean(CAUGHT[0]) === "Player");
  ok("clean() leaves an ordinary name alone", Names.clean("Jessie") === "Jessie");
  // names read off the database go through the same check
  ok("firebase-net cleanName shows a caught name as Player", FN._cleanName(CAUGHT[3], "Rival") === "Player");
  ok("firebase-net cleanName keeps an ordinary name", FN._cleanName("Kappa Grappler", "Rival") === "Kappa Grappler");
  ok("firebase-net cleanName still falls back when empty", FN._cleanName("", "Rival") === "Rival");
  console.log(`\nnames: ${passed} passed`);
})();
