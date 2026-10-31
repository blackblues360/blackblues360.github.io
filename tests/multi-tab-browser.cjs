const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge'}),checks=[];
  const base=process.env.SAFETY_TEST_URL||'http://127.0.0.1:8765';
  try{
    for(const [tool,key,selector,value] of [['plate-layout','blackblues.plate-layout.v1','#planTitle','writer'],['sop-timeline','blackblues.sop-timeline.v1','[data-doc="name"]','writer']]){
      const context=await browser.newContext();const a=await context.newPage();await a.goto(`${base}/tools/${tool}/`);await a.locator(selector).fill(value);await a.locator(selector).press('Tab');
      const saved=await a.evaluate(k=>localStorage.getItem(k),key);assert.ok(saved);
      const b=await context.newPage();await b.goto(`${base}/tools/${tool}/`);await b.locator(selector).fill('other tab');await b.locator(selector).press('Tab');
      assert.match(await b.locator('#draftAccessNotice').textContent(),/另一标签页/);assert.equal(await b.evaluate(k=>localStorage.getItem(k),key),saved);
      await a.close();await b.reload();await b.locator(selector).fill('new writer');await b.locator(selector).press('Tab');assert.notEqual(await b.evaluate(k=>localStorage.getItem(k),key),saved);checks.push(`${tool}: single writer and close/reload takeover`);await context.close();
      const unsupported=await browser.newContext();await unsupported.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined}));const page=await unsupported.newPage();await page.goto(`${base}/tools/${tool}/`);await page.locator(selector).fill('file-only');await page.locator(selector).press('Tab');assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null);assert.match(await page.locator('#draftAccessNotice').textContent(),/不支持/);checks.push(`${tool}: unsupported locks use file-only mode`);await unsupported.close();
    }
    const context=await browser.newContext(),page=await context.newPage();await page.goto(`${base}/tools/plate-layout/`);await page.locator('#planTitle').fill('initial');
    const rogue=await context.newPage();await rogue.goto(base);await rogue.evaluate(()=>localStorage.setItem('blackblues.plate-layout.v1','uncooperative writer'));
    await page.locator('#draftAccessNotice').waitFor({state:'visible'});await page.locator('#planTitle').fill('stale');assert.equal(await page.evaluate(()=>localStorage.getItem('blackblues.plate-layout.v1')),'uncooperative writer');checks.push('external snapshot change suspends writes');await context.close();
    console.log(JSON.stringify({passed:checks.length,checks}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
