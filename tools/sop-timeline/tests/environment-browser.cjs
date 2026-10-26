const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const {emptyDocument}=await import('../core.mjs');
  const output=process.env.SOP_TEST_OUTPUT||await fs.mkdtemp(path.join(os.tmpdir(),'sop-environment-'));await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    const page=await browser.newPage({viewport:{width:1536,height:1080},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const url=`${process.env.SOP_TEST_URL||'http://127.0.0.1:8000'}/tools/sop-timeline/`,key='blackblues.sop-timeline.v1';
    const stored=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
    const legacy=emptyDocument();legacy.groups=[{id:'g',title:'90 分钟等待与 5 分钟并行操作'}];delete legacy.environmentRanges;
    legacy.blocks=[
      {id:'wait',group:'g',lane:'wait',start:0,duration:5400,text:'长时间等待。',environment:'生物安全柜',object:'样本'},
      {id:'short',group:'g',lane:'operation',start:4800,duration:300,text:'仅此 5 分钟操作需要生物安全柜。',environment:'',object:'试剂'},
      {id:'next',group:'g',lane:'operation',start:5100,duration:300,text:'后续操作保持不变。',environment:'',object:'样本'},
      {id:'last',group:'g',lane:'operation',start:5400,duration:300,text:'实验收尾。',environment:'',object:'样本'}];
    await page.goto(url);await page.locator('#fileInput').setInputFiles({name:'legacy.soptime',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});await page.locator('[data-duration="wait"]').waitFor();
    await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key))?.environmentRanges?.length===1,key);
    await page.locator('#zoomOut').click();
    const before=await stored(),id=before.environmentRanges[0].id;
    const geometry=()=>page.evaluate(()=>[...document.querySelectorAll('.time-block,.block-texts,.time-line')].map(el=>{const r=el.getBoundingClientRect(),body=el.closest('.timeline-body').getBoundingClientRect();return {id:el.dataset.id||el.dataset.time,kind:el.className,x:r.x-body.x,y:r.y-body.y,width:r.width,height:r.height};}));
    const originalGeometry=await geometry();
    const targetY=time=>page.locator('.timeline-body').evaluate((body,time)=>{const m=body._mapping,paper=document.querySelector('#paper'),zoom=paper.getBoundingClientRect().width/paper.offsetWidth;return body.getBoundingClientRect().top+m.ys[m.nodes.indexOf(time)]*zoom;},time);
    const handle=edge=>page.locator(`[data-range-id="${id}"][data-environment-resize="${edge}"]`);
    const dragEdge=async(edge,time)=>{await handle(edge).scrollIntoViewIfNeeded();const box=await handle(edge).boundingBox(),y=await targetY(time);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,y,{steps:15});await page.mouse.up();};
    await dragEdge('start',4800);assert.equal((await stored()).environmentRanges[0].start,4800);
    await dragEdge('end',5100);let d=await stored();assert.deepEqual([d.environmentRanges[0].start,d.environmentRanges[0].end],[4800,5100]);assert.deepEqual(d.blocks,before.blocks);assert.deepEqual(d.groups,before.groups);assert.deepEqual(d.notes,before.notes);assert.deepEqual(d.layout,before.layout);assert.deepEqual(await geometry(),originalGeometry);
    await page.screenshot({path:path.join(output,'environment-minimal.png'),fullPage:true});
    // Cancelling a gesture restores the preview and leaves no history entry.
    const rangeGeometry=await page.locator('.env-run').evaluate(el=>({top:el.style.top,height:el.style.height}));
    const top=await handle('start').boundingBox();await page.mouse.move(top.x+top.width/2,top.y+top.height/2);await page.mouse.down();await page.mouse.move(top.x+top.width/2,await targetY(0),{steps:10});await handle('start').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();assert.deepEqual(await stored(),d);assert.deepEqual(await geometry(),originalGeometry);assert.deepEqual(await page.locator('.env-run').evaluate(el=>({top:el.style.top,height:el.style.height})),rangeGeometry);
    await page.keyboard.press('Control+z');assert.deepEqual((await stored()).environmentRanges.map(r=>[r.start,r.end]),[[4800,5400]]);await page.keyboard.press('Control+y');assert.deepEqual((await stored()).environmentRanges.map(r=>[r.start,r.end]),[[4800,5100]]);
    await dragEdge('end',5700);await dragEdge('start',0);assert.deepEqual((await stored()).environmentRanges.map(r=>[r.start,r.end]),[[0,5700]]);assert.deepEqual(await geometry(),originalGeometry);
    await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');assert.deepEqual((await stored()).environmentRanges.map(r=>[r.start,r.end]),[[4800,5100]]);
    await page.keyboard.press('Control+y');assert.equal((await stored()).environmentRanges[0].end,5700);await page.keyboard.press('Control+z');
    await page.reload();assert.deepEqual((await stored()).environmentRanges.map(r=>[r.start,r.end]),[[4800,5100]]);assert.deepEqual((await stored()).blocks,before.blocks);
    await page.evaluate(()=>window.showSaveFilePicker=undefined);let pending=page.waitForEvent('download');await page.locator('#save').click();const file=await pending,saved=path.join(output,'environment-range.soptime');await file.saveAs(saved);const data=JSON.parse(await fs.readFile(saved,'utf8'));assert.deepEqual(data.environmentRanges.map(r=>[r.start,r.end]),[[4800,5100]]);
    await page.locator('#fileInput').setInputFiles(saved);await page.locator('.env-run').waitFor();assert.deepEqual((await stored()).environmentRanges,data.environmentRanges);
    pending=page.waitForEvent('download');await page.locator('#png').click();const png=await pending;await png.saveAs(path.join(output,'environment-minimal.png-export.png'));
    const popup=page.waitForEvent('popup');await page.locator('#pdf').click();const print=await popup;await print.waitForLoadState();
    const environmentRect=print.locator('rect[fill="#edf8f3"]').first(),operationRect=print.locator('rect[fill="#d8e8fc"]').first();assert.equal(await print.locator('rect[fill="#edf8f3"]').count(),1);
    assert.ok(Math.abs(Number(await environmentRect.getAttribute('y'))-Number(await operationRect.getAttribute('y')))<=2);assert.ok(Math.abs(Number(await environmentRect.getAttribute('height'))-Number(await operationRect.getAttribute('height')))<=2);
    const exportedBounds=await environmentRect.evaluate(el=>{const r=el.getBoundingClientRect(),svg=el.closest('svg').getBoundingClientRect(),scale=744/svg.width;return {x:(r.x-svg.x)*scale,y:(r.y-svg.y)*scale,height:r.height*scale};});
    const pngBytes=[...await fs.readFile(path.join(output,'environment-minimal.png-export.png'))];
    const imageBounds=await page.evaluate(async({bytes,bounds})=>{const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const scale=bitmap.width/744,x=Math.round((bounds.x+4)*scale),data=ctx.getImageData(x,0,1,bitmap.height).data,rows=[];for(let y=0;y<bitmap.height;y++)if(data[y*4]===237&&data[y*4+1]===248&&data[y*4+2]===243)rows.push(y);return {first:rows[0],last:rows.at(-1),scale};},{bytes:pngBytes,bounds:exportedBounds});
    // PNG starts each group 5 units lower than the print header; compare actual
    // raster pixels, allowing only the rounded rectangle's corner antialiasing.
    assert.ok(Math.abs(imageBounds.first-(exportedBounds.y+5)*imageBounds.scale)<=4);assert.ok(Math.abs(imageBounds.last-(exportedBounds.y+5+exportedBounds.height)*imageBounds.scale)<=4);
    await print.emulateMedia({media:'print'});await print.pdf({path:path.join(output,'environment-minimal.pdf'),preferCSSPageSize:true,printBackground:true});await print.close();
    // Palette drop now creates only one smallest interval, not the long wait.
    await page.locator('.environment-label').click();await page.locator('#clearEnvironment').click();assert.deepEqual((await stored()).environmentRanges,[]);await page.reload();assert.equal(await page.locator('.env-run').count(),0);
    const y=await targetY(4800),body=await page.locator('.timeline-body').boundingBox();const card=await page.locator('[data-component="environment"]').boundingBox();await page.mouse.move(card.x+card.width/2,card.y+card.height/2);await page.mouse.down();await page.mouse.move(card.x+card.width/2+8,card.y+card.height/2,{steps:3});await page.mouse.move(body.x+body.width-30,y+12,{steps:15});await page.mouse.up();await page.locator('#environmentChoices button').filter({hasText:'生物安全柜'}).click();assert.deepEqual((await stored()).environmentRanges.map(r=>[r.start,r.end]),[[4800,5100]]);assert.deepEqual((await stored()).blocks,before.blocks);
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,output,checks:['legacy migration','top and bottom resize','5 min inside 90 min wait','other content geometry unchanged','cancel gesture','undo/redo','save/reopen/reload','PNG/PDF bounds','minimal palette drop']}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
