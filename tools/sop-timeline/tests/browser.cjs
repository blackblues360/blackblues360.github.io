// Development only. Run with NODE_PATH pointing to an installed Playwright package.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const output=process.env.SOP_TEST_OUTPUT||await fs.mkdtemp(path.join(os.tmpdir(),'sop-timeline-'));
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    const context=await browser.newContext({viewport:{width:1536,height:1080},acceptDownloads:true});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const base=process.env.SOP_TEST_URL||'http://127.0.0.1:8000',url=`${base}/tools/sop-timeline/`,key='blackblues.sop-timeline.v1';
    const stored=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
    const load=async doc=>{await page.locator('#fileInput').setInputFiles({name:'test.soptime',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});await page.waitForFunction(({key,count,first})=>{const d=JSON.parse(localStorage.getItem(key));return d?.blocks.length===count&&d.blocks[0]?.id===first;},{key,count:doc.blocks.length,first:doc.blocks[0]?.id});await page.locator('.time-block').first().waitFor();};
    await page.goto(url);await page.locator('.time-block').first().waitFor();
    assert.equal(await page.locator('.time-block').count(),8);assert.match(await page.locator('#summary').textContent(),/52 min/);
    await page.screenshot({path:path.join(output,'editor.png'),fullPage:true});
    const text=page.locator('[data-text]').first();await text.fill('中文测试：轻轻混匀，避免气泡。');await text.press('Tab');await page.locator('#saveDefaults').click();
    assert.equal((await stored()).blocks[0].text,'中文测试：轻轻混匀，避免气泡。');
    await page.reload();assert.equal(await page.locator('[data-text]').first().textContent(),'中文测试：轻轻混匀，避免气泡。');
    const initial=await stored();
    // Rich text grows immediately while focused and shrinks without changing time.
    const first=page.locator('[data-text]').first(),body=page.locator('.timeline-body').first();const oldHeight=await body.evaluate(el=>el.offsetHeight);
    await first.fill('长文字即时自动排版。'.repeat(80));await page.waitForTimeout(50);assert.ok(await body.evaluate(el=>el.offsetHeight)>oldHeight);await first.fill(initial.blocks[0].text);await first.press('Tab');assert.deepEqual((await stored()).blocks.map(b=>[b.start,b.duration]),initial.blocks.map(b=>[b.start,b.duration]));
    // Drag whole group, then undo; internal text and timing remain associated.
    const firstGroup=initial.groups[0].id,lastGroup=initial.groups.at(-1).id;
    for(const g of initial.groups)await page.locator(`[data-collapse="${g.id}"]`).click();
    await page.locator(`[data-group-drag="${lastGroup}"]`).scrollIntoViewIfNeeded();
    await page.locator(`[data-group-drag="${lastGroup}"]`).dragTo(page.locator(`[data-group-drag="${firstGroup}"]`));assert.equal((await stored()).groups[0].id,lastGroup);await page.locator('#undo').click();assert.equal((await stored()).groups[0].id,firstGroup);
    // C / D: direct duration edit and downstream behavior via real UI.
    const group=initial.groups[0].id;
    const model={...initial,groups:[{id:group,title:'联动测试',collapsed:false}],notes:[],blocks:[
      {id:'a',group,lane:'operation',start:0,duration:1800,text:'保持不变',environment:'室温',object:'试剂'},
      {id:'b',group,lane:'wait',start:0,duration:1800,text:'中文避光孵育',environment:'4°C 避光',object:'样本'},
      {id:'c',group,lane:'operation',start:1800,duration:300,text:'后继操作',environment:'室温',object:'样本'}]};
    await load(model);await page.locator('[data-duration="b"]').fill('40 min');await page.locator('[data-duration="b"]').press('Enter');
    let d=await stored();assert.equal(d.blocks[0].duration,1800);assert.equal(d.blocks[1].duration,2400);assert.equal(d.blocks[2].start,2400);
    await page.locator('#undo').click();d=await stored();assert.equal(d.blocks[2].start,1800);
    await page.locator('#redo').click();assert.equal((await stored()).blocks[2].start,2400);
    await page.locator('[data-duration="b"]').fill('20 min');await page.locator('[data-duration="b"]').press('Enter');assert.equal((await stored()).blocks[1].duration,1800);
    // Resize tail on last block must extend beyond the current diagram end.
    const handle=page.locator('[data-resize="c"]');await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+45,{steps:12});await page.mouse.up();assert.ok((await stored()).blocks[2].duration>300);
    // Drag wrong lane must preserve state; drag a wait block into its own lane.
    await load(model);const before=await stored();const wrong=page.locator('.lane-operation');await page.locator('[data-component="wait"]').dragTo(wrong,{targetPosition:{x:5,y:6}});assert.deepEqual(await stored(),before);
    const waitLane=page.locator('.lane-wait');await page.locator('[data-component="wait"]').dragTo(waitLane,{targetPosition:{x:5,y:6}});assert.equal((await stored()).blocks.length,4);
    // B: simultaneous text must have distinct vertical bounds while both time heads align.
    await load(model);const a=await page.locator('.time-block[data-id="a"]').boundingBox(),b=await page.locator('.time-block[data-id="b"]').boundingBox();assert.ok(Math.abs(a.y-b.y)<1);
    const ta=await page.locator('[data-text-id="a"]').boundingBox(),tb=await page.locator('[data-text-id="b"]').boundingBox();assert.ok(ta.y+ta.height<=tb.y||tb.y+tb.height<=ta.y);
    // Independent width settings do not change true time.
    await page.locator('[data-setting="operationWidth"]').fill('150');await page.locator('[data-setting="operationWidth"]').dispatchEvent('change');assert.deepEqual((await stored()).blocks,model.blocks);
    // Copy/paste/delete and undo are one complete transaction each.
    await page.locator('.time-block[data-id="c"]').click({position:{x:10,y:20}});await page.locator('#copy').click();await page.locator('#paste').click();assert.equal((await stored()).blocks.length,4);await page.locator('#delete').click();assert.equal((await stored()).blocks.length,3);await page.locator('#undo').click();assert.equal((await stored()).blocks.length,4);
    // Save fallback: downloads JSON and reopens exactly.
    await page.evaluate(()=>{window.showSaveFilePicker=undefined;});
    const downloadPromise=page.waitForEvent('download');await page.locator('#save').click();const file=await downloadPromise;const savedFile=path.join(output,'roundtrip.soptime');await file.saveAs(savedFile);const saved=JSON.parse(await fs.readFile(savedFile,'utf8'));assert.deepEqual(saved,await stored());
    await page.locator('#fileInput').setInputFiles(savedFile);await page.waitForTimeout(150);assert.deepEqual(await stored(),saved);
    const pngPromise=page.waitForEvent('download');await page.locator('#png').click();const png=await pngPromise;const pngFile=path.join(output,'timeline.png');await png.saveAs(pngFile);const pngData=await fs.readFile(pngFile);assert.ok(pngData.length>10000);assert.equal(pngData.subarray(1,4).toString(),'PNG');
    // H: long Chinese timeline, oversized individual text, print pagination.
    const long=structuredClone(model);long.blocks=[];long.groups=[];
    for(let i=0;i<18;i++){const gid=`group-${i}`;long.groups.push({id:gid,title:`中文步骤 ${i+1}`,collapsed:false});long.blocks.push({...model.blocks[0],id:`block-${i}`,group:gid,start:i*300,duration:300,text:i===3?'超长中文实验步骤，不要截断这段文字。'.repeat(200):`中文实验操作 ${i+1}，记录处理条件。`,object:'样本'});}
    await load(long);const popupPromise=page.waitForEvent('popup');await page.locator('#pdf').click();const print=await popupPromise;await print.waitForLoadState();const count=await print.locator('.print-page').count();assert.ok(count>=3);await print.emulateMedia({media:'print'});await print.pdf({path:path.join(output,'timeline-a4.pdf'),preferCSSPageSize:true,printBackground:true});await print.screenshot({path:path.join(output,'print-pages.png'),fullPage:true});
    const printText=await print.locator('body').textContent();assert.match(printText,/中文步骤 18/);assert.match(printText,/续/);assert.match(printText,/总耗时/);await print.close();
    await load(initial);await page.screenshot({path:path.join(output,'editor-final.png'),fullPage:true});
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,printPages:count,output,checks:['edit','restore','live text layout','group drag','resize','undo/redo','drag lanes','simultaneous text','width','copy/paste/delete','file roundtrip','PNG','Chinese multipage PDF']}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
