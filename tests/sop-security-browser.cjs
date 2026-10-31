const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
(async()=>{
  const {sampleDocument}=await import('../tools/sop-timeline/core.mjs');
  const browser=await chromium.launch({headless:true,channel:'msedge'}),base=process.env.SAFETY_TEST_URL||'http://127.0.0.1:8765',checks=[];
  try{
    const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const model=sampleDocument();model.name='安全测试\u0001 <img src=x onerror="window.__xss=1">';
    model.blocks[0].text='<b>安全加粗</b><img src=x onerror="window.__xss=1"><svg onload="window.__xss=2"></svg><a href="javascript:window.__xss=3">链接文字</a><iframe srcdoc="<script>parent.__xss=4</script>"></iframe>';
    await context.addInitScript(doc=>{if(!sessionStorage.getItem('security-seeded')){localStorage.setItem('blackblues.sop-timeline.v1',JSON.stringify(doc));sessionStorage.setItem('security-seeded','yes');}},model);
    await page.goto(`${base}/tools/sop-timeline/`);await page.locator('[data-text]').first().waitFor();
    assert.equal(await page.evaluate(()=>window.__xss),undefined);assert.equal(await page.locator('#paper img,#paper iframe,#paper svg[onload],#paper a[href^="javascript:"]').count(),0);checks.push('untrusted localStorage content is safely rendered');
    await page.locator('#fileInput').setInputFiles({name:'malicious.soptime',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(model))});
    assert.equal(await page.locator('#paper img,#paper iframe,#paper [onerror]').count(),0);assert.equal(await page.evaluate(()=>window.__xss),undefined);checks.push('untrusted file import uses the same safe rendering boundary');
    const editor=page.locator('[data-text]').first();await editor.evaluate(el=>{const transfer=new DataTransfer();transfer.setData('text/html','<img src=x onerror="window.__xss=9">');transfer.setData('text/plain','外部纯文本');el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));});
    assert.equal(await page.locator('#paper img').count(),0);assert.ok((await editor.textContent()).includes('外部纯文本'));checks.push('external HTML drop is inserted as plain text');
    const pending=page.waitForEvent('download');await page.locator('#png').click();const download=await pending,bytes=await fs.readFile(await download.path());assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');checks.push('XML-forbidden control characters cannot break PNG export');
    const next=page.waitForEvent('popup');await page.locator('#pdf').click();const popup=await next;await popup.waitForLoadState();assert.equal(await popup.evaluate(()=>window.__xss),undefined);assert.equal(await popup.locator('img,iframe,object').count(),0);await popup.close();checks.push('print preview does not execute imported markup');
    assert.deepEqual(errors,[]);await context.close();console.log(JSON.stringify({passed:checks.length,checks}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
