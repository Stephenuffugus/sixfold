const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => { try{localStorage.setItem("sixfold_seen","1");}catch(e){} });
  const errs=[]; page.on("console",m=>{if(m.type()==="error")errs.push(m.text());}); page.on("pageerror",e=>errs.push("PE:"+e.message));
  await page.goto("http://localhost:8080/index.html",{waitUntil:"networkidle"});
  await page.waitForTimeout(500);
  await page.click("#collbtn");
  await page.waitForTimeout(500);
  const shown = await page.$eval("#collection", el=>el.classList.contains("show"));
  const cards = await page.$$eval("#collection .ccard", els=>els.length);
  const got = await page.$$eval("#collection .ccard.got", els=>els.length);
  const prog = await page.$eval("#collection .prog", el=>el.textContent);
  await page.screenshot({ path: "render-collection.png" });
  console.log("collection shown:", shown, "| cards:", cards, "| unlocked-cards:", got, "| prog:", JSON.stringify(prog));
  console.log("CONSOLE ERRORS:", errs.length?errs:"none");
  await b.close();
})();
