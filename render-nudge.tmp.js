const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => { try{localStorage.setItem("sixfold_seen","1");}catch(e){} });
  const errs=[];
  page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
  page.on("pageerror",e=>errs.push("PE:"+e.message));
  await page.goto("http://localhost:8080/index.html",{waitUntil:"networkidle"});
  await page.waitForTimeout(400);
  await page.evaluate(()=>{ window.__toasts=[]; const t=document.getElementById("toast");
    new MutationObserver(()=>{ if(t.classList.contains("show")) window.__toasts.push(t.textContent); }).observe(t,{attributes:true}); });
  // set difficulty to 0 so a readable player survives long enough to be warned
  await page.evaluate(()=>{ const d=document.getElementById("diff"); if(d){ d.value="0"; d.dispatchEvent(new Event("input",{bubbles:true})); } });
  const nodes = await page.$$(".node");
  let dangerEver=false;
  for(let i=0;i<14;i++){
    // restart if a result screen is up
    const resAgain = await page.$("#resAgain"); if(resAgain){ await resAgain.click().catch(()=>{}); await page.waitForTimeout(400); }
    await nodes[i%6].click().catch(()=>{});
    await page.waitForTimeout(850);
    const d = await page.$eval("#pbar", el=>el.classList.contains("danger")).catch(()=>false);
    if(d) dangerEver=true;
  }
  console.log("danger tint appeared:", dangerEver);
  console.log("toasts:", JSON.stringify(await page.evaluate(()=>window.__toasts)));
  console.log("CONSOLE ERRORS:", errs.length?errs:"none");
  await b.close();
})();
