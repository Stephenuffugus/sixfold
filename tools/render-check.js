"use strict";
// Render the SHIPPED game in a real headless Chromium at a phone viewport,
// measure where every wheel node actually lands, flag overlaps/clipping, and
// screenshot the wheel + the bind overlay + the how-to guide.
// Run: node tools/render-check.js
const { chromium } = require("playwright");
const path = require("path");
const root = path.join(__dirname, "..");

(async () => {
  const browser = await chromium.launch();
  const sizes = [
    { name: "iphone12", w: 390, h: 844 },
    { name: "small", w: 320, h: 700 },
  ];
  let anyFail = false;
  for (const s of sizes) {
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
    // Skip the first-run guide so it doesn't cover the wheel during measurement.
    await page.addInitScript(() => { try { localStorage.setItem("sixfold_seen", "1"); } catch (e) {} });
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
    await page.goto("http://localhost:8080/index.html", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);

    const data = await page.evaluate(() => {
      const ww = document.querySelector(".wheelwrap");
      const wb = ww ? ww.getBoundingClientRect() : null;
      const nodes = [...document.querySelectorAll(".node")].map((el, i) => {
        const r = el.getBoundingClientRect();
        return {
          i, name: (el.querySelector(".n") || {}).textContent || "?",
          cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2),
          w: Math.round(r.width), visible: r.width > 0 && r.height > 0,
        };
      });
      return { nodeCount: nodes.length, nodes, innerW: window.innerWidth,
        wheelH: wb ? Math.round(wb.height) : null };
    });

    const overlaps = [];
    for (let a = 0; a < data.nodes.length; a++)
      for (let b = a + 1; b < data.nodes.length; b++) {
        const A = data.nodes[a], B = data.nodes[b];
        const d = Math.hypot(A.cx - B.cx, A.cy - B.cy);
        if (d < A.w * 0.9) overlaps.push(`${A.name}↔${B.name} dist=${Math.round(d)}px`);
      }
    const clipped = data.nodes.filter((n) => n.cx < 0 || n.cx > data.innerW || !n.visible).map((n) => n.name);

    const fail = data.nodeCount !== 6 || overlaps.length || clipped.length || errors.length;
    anyFail = anyFail || fail;
    console.log(`\n=== ${s.name} ${s.w}x${s.h} ===`);
    console.log(`nodes=${data.nodeCount} wheelH=${data.wheelH}`);
    console.log("OVERLAPS:", overlaps.length ? overlaps : "none");
    console.log("CLIPPED:", clipped.length ? clipped : "none");
    console.log("CONSOLE ERRORS:", errors.length ? errors : "none");

    await page.screenshot({ path: path.join(root, `render-${s.name}.png`), fullPage: true });

    // capture the dramatized overlays at phone size only
    if (s.name === "iphone12") {
      await page.evaluate(() => { Stage.bindPrompt(); }); // fire-and-forget: don't await the pending promise
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(root, "render-bind.png") });
      await page.evaluate(() => { const b = document.querySelector("#bindstage .bindbtn-lg"); if (b) b.click(); });
      await page.waitForTimeout(400);
      await page.evaluate(() => document.getElementById("howbtn").click());
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(root, "render-howto.png") });
    }
    await page.close();
  }
  await browser.close();
  console.log(anyFail ? "\nRENDER-CHECK: FAILED" : "\nRENDER-CHECK: layout OK at all sizes");
  process.exit(anyFail ? 1 : 0);
})();
