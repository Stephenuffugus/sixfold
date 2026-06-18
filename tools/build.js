#!/usr/bin/env node
"use strict";
/* SIXFOLD inliner — a ONE-SHOT, not a runtime build.
 *
 * Stitches the tested /src modules + anim.css into the editable template
 * (sixfold.src.html) to produce the shipped, dependency-free sixfold.html.
 * The shipped file runs with ZERO tooling; this script is only for regenerating
 * it after editing /src.  Run:  node tools/build.js
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

// dependency order: predictor -> resolve -> readout -> personalities -> skins -> stage -> assists -> engine
const ORDER = ["predictor", "resolve", "readout", "personalities", "skins", "stage", "assists", "engine"];

const modules = ORDER.map((n) => {
  const code = fs.readFileSync(path.join(root, "src", n + ".js"), "utf8");
  return `/* ============================ ${n}.js ============================ */\n${code}`;
}).join("\n\n");

const animCss = fs.readFileSync(path.join(root, "src", "anim.css"), "utf8");

let tpl = fs.readFileSync(path.join(root, "sixfold.src.html"), "utf8");
if (tpl.indexOf("/*__ANIM_CSS__*/") < 0 || tpl.indexOf("/*__MODULES__*/") < 0) {
  console.error("template missing /*__ANIM_CSS__*/ or /*__MODULES__*/ marker");
  process.exit(1);
}
tpl = tpl.replace("/*__ANIM_CSS__*/", animCss);
tpl = tpl.replace("/*__MODULES__*/", modules);

const out = path.join(root, "sixfold.html");
fs.writeFileSync(out, tpl);
console.log(`wrote ${out}  (${tpl.length} bytes, ${ORDER.length} modules inlined)`);
