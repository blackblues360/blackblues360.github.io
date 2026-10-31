const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const {emptyDocument}=await import('../core.mjs');
  const output=process.env.SOP_TEST_OUTPUT||await fs.mkdtemp(path.join(os.tmpdir(),'sop-text-'));await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    const page=await browser.newPage({viewport:{width:1536,height:1080},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const base=process.env.SOP_TEST_URL||'http://127.0.0.1:8765',key='blackblues.sop-timeline.v1',first='1、示例示例',second='2、实力';
    const model=emptyDocument();model.groups=[{id:'g',title:'换行测试'}];model.notes=[];model.blocks=[{id:'text',group:'g',lane:'operation',start:0,duration:300,text:'',environment:'',object:'样本'},{id:'next',group:'g',lane:'operation',start:300,duration:300,text:'后续步骤',environment:'',object:'样本'}];
    await page.goto(`${base}/tools/sop-timeline/`);await page.locator('#fileInput').setInputFiles({name:'text.soptime',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(model))});const editor=page.locator('[data-text="text"]');await editor.waitFor();
    const stored=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
    const lineGeometry=()=>editor.evaluate((el,{first,second})=>{const find=value=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode,index=node.textContent.indexOf(value);if(index>=0){const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+value.length);const r=range.getBoundingClientRect(),root=el.getBoundingClientRect();return r.y-root.y;}}return null;};return {first:find(first),second:find(second),height:el.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(el).lineHeight)};},{first,second});
    const blur=async()=>{await page.locator('#saveDefaults').click();await page.waitForFunction(()=>!document.activeElement?.matches('[data-text]'));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
    // Real Enter, rather than assigning an already-normalized HTML fixture.
    await editor.fill(first);await editor.press('End');await editor.press('Enter');await page.keyboard.insertText(second);const typing=await lineGeometry();await blur();
    assert.equal(await editor.innerText(),`${first}\n${second}`,'Enter must survive blur without joining the lines or adding a trailing blank');assert.deepEqual(await lineGeometry(),typing);
    const html=(await stored()).blocks[0].text;for(let i=0;i<3;i++){await page.reload();await editor.waitFor();assert.equal(await editor.innerText(),`${first}\n${second}`);assert.equal((await stored()).blocks[0].text,html);}
    await editor.fill(first+second);await editor.evaluate((el,length)=>{const selection=getSelection(),range=document.createRange(),walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);walker.nextNode();range.setStart(walker.currentNode,length);range.collapse(true);selection.removeAllRanges();selection.addRange(range);el.focus();},first.length);await editor.press('Enter');const middle=await lineGeometry();await blur();assert.deepEqual(await lineGeometry(),middle);assert.equal(await editor.innerText(),`${first}\n${second}`);
    await editor.fill(first);await editor.press('Home');await editor.press('Enter');const leading=await lineGeometry();await blur();assert.deepEqual(await lineGeometry(),leading);await page.reload();await editor.waitFor();assert.deepEqual(await lineGeometry(),leading);
    // Shift+Enter and a deliberately empty line retain their original geometry.
    await editor.fill(first);await editor.press('End');await editor.press('Shift+Enter');await page.keyboard.insertText(second);const soft=await lineGeometry();await blur();assert.deepEqual(await lineGeometry(),soft);assert.equal(await editor.innerText(),`${first}\n${second}`);
    await editor.fill(first);await editor.press('End');await editor.press('Enter');await editor.press('Enter');await page.keyboard.insertText(second);const blank=await lineGeometry();assert.ok(Math.abs(blank.second-blank.first-2*blank.lineHeight)<1);await blur();assert.deepEqual(await lineGeometry(),blank);
    await page.reload();await editor.waitFor();assert.deepEqual(await lineGeometry(),blank);
    // Formatting and imported paragraph wrappers must not lose the separator.
    const formatted={...structuredClone(model),blocks:[{...model.blocks[0],text:`<p><b>${first}</b></p><p><i>${second}</i></p>`},model.blocks[1]]};await page.locator('#fileInput').setInputFiles({name:'paragraphs.soptime',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(formatted))});await page.waitForFunction(()=>document.querySelector('[data-text="text"] b'));
    assert.equal(await editor.innerText(),`${first}\n${second}`);assert.equal(await editor.locator('b').count(),1);assert.equal(await editor.locator('i').count(),1);assert.equal(await editor.locator('p').count(),0);
    // Save a typed blank line and verify the same line positions after reopening.
    await editor.fill(first);await editor.press('End');await editor.press('Enter');await editor.press('Enter');await page.keyboard.insertText(second);await blur();const savedGeometry=await lineGeometry();await page.evaluate(()=>window.showSaveFilePicker=undefined);
    let pending=page.waitForEvent('download');await page.locator('#save').click();const download=await pending,saved=path.join(output,'multiline.soptime');await download.saveAs(saved);await page.locator('#fileInput').setInputFiles(saved);assert.deepEqual(await lineGeometry(),savedGeometry);assert.deepEqual((await stored()).blocks.map(b=>[b.start,b.duration]),model.blocks.map(b=>[b.start,b.duration]));
    await page.screenshot({path:path.join(output,'multiline.png'),fullPage:true});pending=page.waitForEvent('download');await page.locator('#png').click();await(await pending).saveAs(path.join(output,'multiline-export.png'));
    const popup=page.waitForEvent('popup');await page.locator('#pdf').click();const print=await popup;await print.waitForLoadState();const texts=print.locator('.print-page svg text[x="246"]');assert.deepEqual(await texts.allTextContents(),[first,'',second,'后续步骤']);assert.equal(Number(await texts.nth(2).getAttribute('y'))-Number(await texts.nth(0).getAttribute('y')),50);
    await print.emulateMedia({media:'print'});await print.pdf({path:path.join(output,'multiline.pdf'),preferCSSPageSize:true,printBackground:true});await print.close();assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,output,checks:['Enter and blur','no trailing blank line','repeated reload','Shift+Enter','intentional blank line','bold/italic paragraphs','file roundtrip','PNG/PDF line positions']}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
