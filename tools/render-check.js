"use strict";
// Render the SHIPPED game in a real headless Chromium at a phone viewport,
// measure where every wheel node actually lands, flag overlaps/clipping,
// and screenshot it. Run: node tools/render-check.js
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const sizes = [
    { name: "iphone12", w: 390, h: 844 },
    { name: "small", w: 320, h: 700 },
  ];
  for (const s of sizes) {
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
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
        const cs = getComputedStyle(el);
        return {
          i, name: (el.querySelector(".n") || {}).textContent || "?",
          x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
          cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2),
          display: cs.display, visible: r.width > 0 && r.height > 0,
        };
      });
      return {
        nodeCount: nodes.length, nodes,
        wheel: wb ? { x: Math.round(wb.x), y: Math.round(wb.y), w: Math.round(wb.width), h: Math.round(wb.height) } : null,
        innerW: window.innerWidth, scrollW: document.documentElement.scrollWidth,
      };
    });

    // overlap detection (centers closer than one radius => visually merged)
    const overlaps = [];
    for (let a = 0; a < data.nodes.length; a++)
      for (let b = a + 1; b < data.nodes.length; b++) {
        const A = data.nodes[a], B = data.nodes[b];
        const d = Math.hypot(A.cx - B.cx, A.cy - B.cy);
        if (d < A.w * 0.9) overlaps.push(`${A.name}↔${B.name} dist=${Math.round(d)}px (w=${A.w})`);
      }
    const clipped = data.nodes.filter((n) => n.cx < 0 || n.cx > data.innerW || !n.visible)
      .map((n) => `${n.name} cx=${n.cx} (innerW=${data.innerW})`);

    console.log(`\n=== ${s.name} ${s.w}x${s.h} ===`);
    console.log(`nodes=${data.nodeCount}  innerW=${data.innerW} scrollW=${data.scrollW}  wheel=`, data.wheel);
    data.nodes.forEach((n) => console.log(`  ${String(n.i)} ${(n.name||"").padEnd(7)} center=(${n.cx},${n.cy}) ${n.w}x${n.h} vis=${n.visible}`));
    console.log("OVERLAPS:", overlaps.length ? overlaps : "none");
    console.log("CLIPPED/OFFSCREEN:", clipped.length ? clipped : "none");
    console.log("CONSOLE ERRORS:", errors.length ? errors : "none");

    await page.screenshot({ path: path.join(__dirname, "..", `render-${s.name}.png`), fullPage: true });
    await page.close();
  }
  await browser.close();
})();
