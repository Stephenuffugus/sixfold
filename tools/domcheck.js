#!/usr/bin/env node
"use strict";
/* Headless smoke test of the SHIPPED sixfold.html.
 *
 * Runs the inlined <script> in a vm context with a minimal DOM stub (no npm deps).
 * In a vm sandbox `module`/`require` are undefined, so the module IIFEs attach to
 * the sandbox global exactly as they do in a browser. We then drive a full match
 * through the real UI glue (wheel taps + bind prompt) and assert no errors thrown
 * and the match reaches a winner.   Run:  node tools/domcheck.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "sixfold.html"), "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("no <script> found"); process.exit(1); }
const scriptSrc = m[1];

// ---- minimal DOM ----
let timers = [];
function makeEl(tag) {
  const el = {
    tagName: (tag || "div").toUpperCase(), _id: "", _cls: new Set(), _attrs: {},
    style: { setProperty() {}, removeProperty() {} },
    children: [], _listeners: {}, _html: "", textContent: "", value: "", checked: false, disabled: false,
    offsetWidth: 0,
    classList: {
      add: (...c) => c.forEach((x) => el._cls.add(x)),
      remove: (...c) => c.forEach((x) => el._cls.delete(x)),
      toggle: (c, f) => { const has = el._cls.has(c); const on = f === undefined ? !has : !!f; on ? el._cls.add(c) : el._cls.delete(c); return on; },
      contains: (c) => el._cls.has(c),
    },
    get className() { return [...el._cls].join(" "); },
    set className(v) { el._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
    setAttribute: (k, v) => { el._attrs[k] = String(v); },
    getAttribute: (k) => (k in el._attrs ? el._attrs[k] : null),
    appendChild: (c) => { el.children.push(c); c.parentNode = el; return c; },
    addEventListener: (ev, fn) => { (el._listeners[ev] = el._listeners[ev] || []).push(fn); },
    removeEventListener() {},
    dispatch: (ev) => {
      (el._listeners[ev] || []).forEach((f) => f({ target: el }));
      const on = el["on" + ev]; // page wires rematch/spend/etc. via .onclick, not addEventListener
      if (typeof on === "function") on({ target: el });
    },
    scrollIntoView() {},
    querySelector: (sel) => el.querySelectorAll(sel)[0] || null,
    querySelectorAll: (sel) => {
      // we only need ".bindbtn-lg" (parsed from innerHTML) and ".fighter-art"/".bar-fill"/".bar-num"/".rpips"
      if (sel === ".bindbtn-lg" || sel === ".bindbtn") return el._bindbtns || [];
      // children scan by class
      const want = sel.replace(/^\./, "");
      return el.children.filter((c) => c._cls && c._cls.has(want));
    },
    get innerHTML() { return el._html; },
    set innerHTML(v) {
      el._html = String(v);
      el.children = [];
      el._bindbtns = null;
      // special-case the bind prompt markup so the prompt path resolves
      if (/bindbtn/.test(el._html)) {
        el._bindbtns = [0, 1, 2].map((i) => {
          const b = makeEl("button"); b._cls.add("bindbtn"); b.setAttribute("data-b", String(i)); return b;
        });
      }
    },
  };
  return el;
}

const idCache = {};
function byId(id) { return idCache[id] || (idCache[id] = (() => { const e = makeEl("div"); e._id = id; return e; })()); }

// seed the static-HTML child elements the glue queries (the stub can't parse HTML).
function seedChild(parentId, cls, tag) { const c = makeEl(tag || "div"); c._cls.add(cls); byId(parentId).appendChild(c); return c; }
seedChild("presolve", "rpips", "span");
["pbar", "abar"].forEach((b) => { seedChild(b, "bar-fill"); seedChild(b, "bar-num", "span"); });

const document = {
  getElementById: byId,
  createElement: makeEl,
  querySelectorAll: (sel) => {
    // static [data-a11y] inputs aren't modeled; return [] (glue tolerates it)
    if (sel === "[data-a11y]") return [];
    return [];
  },
  documentElement: makeEl("html"),
  body: (() => { const b = makeEl("body"); return b; })(),
};
// Deterministic Math.random so this smoke test is reproducible (no flaky binds).
// mulberry32 seeded with a fixed constant; everything else delegates to real Math.
const seededMath = Object.create(Math);
seededMath.random = (() => {
  let s = 0x9e3779b9 >>> 0;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();

const sandbox = {
  console, Math: seededMath, Date, JSON, Array, Object, String, Number, Boolean, parseInt, parseFloat, isNaN, encodeURIComponent,
  setTimeout: (fn, ms) => { timers.push(fn); return timers.length; },
  clearTimeout: () => {},
  document,
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  getComputedStyle: () => ({ getPropertyValue: () => "#ffffff" }),
  localStorage: (() => { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; } }; })(),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

async function drain() { // run queued timers AND interleave microtasks (reveal chain)
  for (let i = 0; i < 200 && timers.length; i++) {
    const batch = timers.splice(0);
    for (const t of batch) t();
    await Promise.resolve(); await Promise.resolve();
  }
}
const finished = () => byId("rematch").style.display === "block" || /VICTORY|DEFEAT/.test(byId("verdict").textContent);

(async () => {
  let failed = false;
  try {
    vm.createContext(sandbox);
    vm.runInContext(scriptSrc, sandbox, { filename: "sixfold-inline.js" });
    console.log("  ok  page script loaded without throwing");
    await drain();

    ["Sfx", "Music", "Predictor", "Personalities", "Rank", "Matchmaker", "Net", "Resolve", "Readout", "Skins", "Stage", "Assists", "Engine"].forEach((g) => {
      if (!sandbox[g]) { console.error("  FAIL missing global", g); failed = true; }
    });
    if (!failed) console.log("  ok  all 13 module globals present");

    const wheel = byId("wheel");
    const nodes = wheel.children.filter((c) => c._cls.has("node"));
    if (nodes.length !== 6) { console.error("  FAIL wheel has", nodes.length, "nodes"); failed = true; }
    else console.log("  ok  wheel built 6 stance nodes");

    // play multiple matches until a Clash Bind is exercised through the glue
    let matches = 0, taps = 0, binds = 0, guard = 0;
    while (matches < 40 && guard++ < 4000) {
      if (finished()) {
        if (binds >= 1 && matches >= 1) break;
        byId("rematch").dispatch("click"); await drain(); matches++;
      }
      // tap-to-aim then tap-to-strike (two taps on the SAME stance commit it);
      // cycle ALL 6 stances so a mirror (clash) is reliably hit
      const s = guard % 6;
      nodes[s].dispatch("click"); await drain();   // aim
      nodes[s].dispatch("click"); await drain();   // strike
      const bindStage = byId("bindstage");
      if (bindStage._bindbtns && bindStage._bindbtns.length) { binds++; bindStage._bindbtns[binds % 3].dispatch("click"); await drain(); }
      taps++;
    }
    if (matches >= 1 && finished()) console.log(`  ok  played ${matches}+ matches to a winner (${taps} taps)`);
    else { console.error("  FAIL matches did not finish"); failed = true; }
    if (binds >= 1) console.log(`  ok  Clash Bind resolved through the glue (${binds}x)`);
    else { console.error("  FAIL never exercised a bind"); failed = true; }

    // exercise the spend (meter) UI path on a fresh match
    byId("rematch").dispatch("click"); await drain();
    byId("insightbtn").dispatch("click"); await drain();
    byId("foresightbtn").dispatch("click"); await drain();
    console.log("  ok  rematch + spend buttons fire without error");
  } catch (e) {
    console.error("  FAIL runtime error:", e && e.stack || e);
    failed = true;
  }
  console.log(failed ? "\nDOMCHECK: FAILED" : "\nDOMCHECK: all smoke checks passed");
  process.exit(failed ? 1 : 0);
})();
