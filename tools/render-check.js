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

    // capture the dramatized overlays + result screen at phone size only
    if (s.name === "iphone12") {
      // arena themes (click each option in the arena picker)
      const themes = await page.evaluate(() => [...document.querySelectorAll("#arenas .opt")].map((o) => o.textContent.trim()));
      for (let t = 0; t < themes.length; t++) {
        await page.evaluate((i) => document.querySelectorAll("#arenas .opt")[i].click(), t);
        await page.waitForTimeout(750);
        await page.screenshot({ path: path.join(root, `render-theme${t}.png`) });
      }
      console.log("THEMES:", themes);
      await page.evaluate(() => document.querySelectorAll("#arenas .opt")[0].click());
      await page.waitForTimeout(400);
      // play a full match to a result screen (drives the real juice + flow path).
      // weakest AI + cycling all 6 stances (high unpredictability) → usually a win.
      await page.evaluate(() => { const d = document.getElementById("diff"); if (d) { d.value = "0.05"; if (d.oninput) d.oninput(); } document.getElementById("rematch").click(); });
      await page.waitForTimeout(400);
      for (let k = 0; k < 50; k++) {
        const st = await page.evaluate(() => ({
          result: document.getElementById("resultscreen").classList.contains("show"),
          bind: document.getElementById("bindstage").classList.contains("show"),
        }));
        if (st.result) break;
        if (st.bind) await page.evaluate(() => { const b = document.querySelector("#bindstage .bindbtn-lg"); if (b) b.click(); });
        else await page.evaluate((i) => { const n = document.querySelectorAll(".node"); if (n.length) n[i % 6].click(); }, k);
        await page.waitForTimeout(1100);
      }
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(root, "render-result.png") });

      await page.evaluate(() => { const b = document.getElementById("resAgain"); if (b) b.click(); });
      await page.waitForTimeout(300);
      await page.evaluate(() => document.getElementById("howbtn").click());
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(root, "render-howto.png") });

      await page.evaluate(() => { document.getElementById("howto").classList.remove("show"); Stage.bindPrompt(); });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(root, "render-bind.png") });
    }
    await page.close();
  }
  await browser.close();
  console.log(anyFail ? "\nRENDER-CHECK: FAILED" : "\nRENDER-CHECK: layout OK at all sizes");
  process.exit(anyFail ? 1 : 0);
})();
