// Synthetic data only, in fresh Playwright contexts; never attaches to a user profile.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
(async()=>{
  const {emptyDocument}=await import(pathToFileURL(path.resolve(__dirname,'../../sop-timeline/core.mjs')));
  const {createState}=await import(pathToFileURL(path.resolve(__dirname,'../core.mjs')));
  const base=process.env.SAFETY_TEST_URL||'http://127.0.0.1:8765';
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'blackblues-safety-'));
  const browser=await chromium.launch({headless:true,channel:'msedge'}),checks=[],errors=[];
  const sopKey='blackblues.sop-timeline.v1',plateKey='blackblues.plate-layout.v1';
  const raw=(page,key)=>page.evaluate(k=>localStorage.getItem(k),key);
  const upload=(page,id,text,name='test.json')=>page.locator(id).setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(text)});
  async function fileAction(page,id){if(await page.locator('#exportMenu').count()){if(!await page.locator('#exportMenu').isVisible())await page.locator('[popovertarget="exportMenu"]').click();if(!await page.locator('#exportMenu details').evaluate(el=>el.open))await page.locator('#exportMenu details summary').click();}await page.locator(id).click();}
  async function session(tool,key,value){
    const context=await browser.newContext({viewport:{width:1536,height:1080},acceptDownloads:true});
    await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
    await context.addInitScript(({key,value,tool})=>{
      if(location.pathname.startsWith(`/tools/${tool}/`)&&!sessionStorage.getItem('safety-seeded')){
        if(value!==null)localStorage.setItem(key,value);
        sessionStorage.setItem('safety-seeded','yes');
      }
    },{key,value,tool});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${base}/tools/${tool}/`);
    await page.locator(tool==='sop-timeline'?'#paper h1':'#plate [data-well="A1"]').waitFor();
    return {context,page};
  }
  async function check(name,run){await run();checks.push(name);console.log(`PASS: ${name}`);}
  try{
    await check('SOP valid restore, edit and reload',async()=>{
      const d=emptyDocument();d.name='restored';const {context,page}=await session('sop-timeline',sopKey,JSON.stringify(d));
      assert.equal(await page.locator('#draftRecovery').isHidden(),true);
      await page.locator('[data-doc="name"]').fill('edited');await page.locator('[data-doc="name"]').press('Tab');
      assert.equal(JSON.parse(await raw(page,sopKey)).name,'edited');await page.reload();assert.equal(await page.locator('[data-doc="name"]').textContent(),'edited');await context.close();
    });
    for(const [name,text] of [['JSON parse failure','{broken\n原始草稿'],['document validation failure','{"version":1}']]){
      await check(`SOP ${name}: editing and unload preserve raw text`,async()=>{
        const {context,page}=await session('sop-timeline',sopKey,text);
        assert.equal(await page.locator('#draftRecovery').isVisible(),true);assert.equal(await page.locator('.workspace').evaluate(el=>el.inert),true);
        await page.locator('[data-doc="name"]').evaluate(el=>{el.textContent='simulated edit';el.dispatchEvent(new Event('input',{bubbles:true}));});
        await page.locator('[data-component="operation"]').evaluate(el=>el.click());await page.keyboard.press('Control+s');
        assert.equal(await raw(page,sopKey),text);
        await page.close();const probe=await context.newPage();await probe.goto(`${base}/`);assert.equal(await raw(probe,sopKey),text);await context.close();
      });
    }
    await check('SOP broken raw download is exact and restart cancel is non-destructive',async()=>{
      const text='{bad\n中文';const {context,page}=await session('sop-timeline',sopKey,text);
      const pending=page.waitForEvent('download');await page.locator('#exportBrokenDraft').click();const download=await pending;
      assert.equal(await fs.readFile(await download.path(),'utf8'),text);
      page.once('dialog',d=>d.dismiss());await page.locator('#restartDraft').click();assert.equal(await raw(page,sopKey),text);await context.close();
    });
    await check('SOP confirmed restart backs up raw and resumes autosave',async()=>{
      const text='{bad';const {context,page}=await session('sop-timeline',sopKey,text);
      page.once('dialog',d=>d.accept());await page.locator('#restartDraft').click();
      assert.equal(await page.locator('#draftRecovery').isHidden(),true);assert.equal(await raw(page,`${sopKey}.recovery`),text);
      assert.equal(JSON.parse(await raw(page,sopKey)).blocks.length,0);
      await page.locator('[data-doc="name"]').fill('new document');await page.locator('[data-doc="name"]').press('Tab');assert.equal(JSON.parse(await raw(page,sopKey)).name,'new document');await context.close();
    });
    await check('SOP valid recovery file requires confirmation and retains damaged original',async()=>{
      const {context,page}=await session('sop-timeline',sopKey,'{bad'),doc=emptyDocument();doc.name='recovered file';
      page.once('dialog',d=>d.accept());await upload(page,'#fileInput',JSON.stringify(doc),'recovered.soptime');
      await page.waitForFunction(()=>document.querySelector('#draftRecovery').hidden);
      assert.equal(JSON.parse(await raw(page,sopKey)).name,doc.name);assert.equal(await raw(page,`${sopKey}.recovery`),'{bad');await context.close();
    });
    await check('plate native JSON export roundtrips',async()=>{
      const state=createState('6');state.plate.title='original';const {context,page}=await session('plate-layout',plateKey,JSON.stringify(state));
      const pending=page.waitForEvent('download');await fileAction(page,'#exportJson');const download=await pending;
      assert.deepEqual(JSON.parse(await fs.readFile(await download.path(),'utf8')),state);await context.close();
    });
    await check('plate invalid JSON and future versions leave storage unchanged',async()=>{
      const text=JSON.stringify(createState('6'));const {context,page}=await session('plate-layout',plateKey,text);
      for(const invalid of ['{broken',JSON.stringify({...createState(),version:2})]){
        await upload(page,'#jsonInput',invalid);await page.waitForFunction(()=>document.querySelector('#jsonInput').value==='');
        assert.equal(await raw(page,plateKey),text);assert.equal(await page.locator('#importDialog').isVisible(),false);
      }await context.close();
    });
    await check('plate preview exposes normalization, backs up before confirm, and cancellation preserves data',async()=>{
      const text=JSON.stringify(createState('6')),{context,page}=await session('plate-layout',plateKey,text);
      const incoming=createState('12');incoming.ui.wellScale=999;incoming.wells.A1='missing-label';const original=JSON.stringify(incoming,null,3);
      await upload(page,'#jsonInput',original);await page.locator('#importDialog').waitFor({state:'visible'});
      assert.match(await page.locator('#importSummary').textContent(),/12 孔板/);assert.match(await page.locator('#importChanges').textContent(),/state.ui.wellScale/);
      assert.equal(await raw(page,plateKey),text);assert.equal(JSON.parse(await raw(page,`${plateKey}.import-backup`)).storageText,text);
      const pending=page.waitForEvent('download');await page.locator('#downloadImportOriginal').click();const download=await pending;assert.equal(await fs.readFile(await download.path(),'utf8'),original);
      const normalizedDownload=page.waitForEvent('download');await page.locator('#downloadImportNormalized').click();
      const normalized=JSON.parse(await fs.readFile(await (await normalizedDownload).path(),'utf8'));
      assert.equal(normalized.ui.wellScale,110);assert.equal(normalized.wells.A1,null);
      await page.locator('#cancelImport').click();assert.equal(await raw(page,plateKey),text);await context.close();
    });
    await check('plate confirm, undo/redo and persistent backup restoration',async()=>{
      const text=JSON.stringify(createState('6')),{context,page}=await session('plate-layout',plateKey,text),incoming=createState('24');incoming.plate.title='imported';
      await upload(page,'#jsonInput',JSON.stringify(incoming));await page.locator('#confirmImport').click();
      const backupDownload=page.waitForEvent('download');await fileAction(page,'#exportImportBackup');
      assert.equal(JSON.parse(await fs.readFile(await (await backupDownload).path(),'utf8')).storageText,text);
      assert.equal(JSON.parse(await raw(page,plateKey)).plate.type,'24');await page.locator('#undo').click();assert.equal(JSON.parse(await raw(page,plateKey)).plate.type,'6');await page.locator('#redo').click();
      await page.reload();page.once('dialog',d=>d.accept());await fileAction(page,'#restoreImportBackup');assert.equal(JSON.parse(await raw(page,plateKey)).plate.type,'6');await context.close();
    });
    await check('plate backup quota failure refuses import without touching current data',async()=>{
      const text=JSON.stringify(createState('6')),{context,page}=await session('plate-layout',plateKey,text);
      await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.endsWith('.import-backup'))throw new DOMException('quota','QuotaExceededError');return set.call(this,k,v);};});
      await upload(page,'#jsonInput',JSON.stringify(createState('12')));await page.waitForFunction(()=>document.querySelector('#jsonInput').value==='');
      assert.equal(await page.locator('#importDialog').isVisible(),false);assert.equal(await raw(page,plateKey),text);await context.close();
    });
    await check('plate external storage change while previewing is not overwritten',async()=>{
      const text=JSON.stringify(createState('6')),{context,page}=await session('plate-layout',plateKey,text);
      await upload(page,'#jsonInput',JSON.stringify(createState('12')));await page.locator('#importDialog').waitFor({state:'visible'});
      await page.evaluate(key=>localStorage.setItem(key,'external change'),plateKey);await page.locator('#confirmImport').click();
      assert.equal(await raw(page,plateKey),'external change');assert.equal(await page.locator('#plate [data-well]').count(),6);await context.close();
    });
    await check('browser contexts isolate synthetic local storage',async()=>{
      const a=await session('plate-layout',plateKey,JSON.stringify(createState('6'))),b=await session('plate-layout',plateKey,null);
      assert.equal(await raw(b.page,plateKey),null);assert.notEqual(await raw(a.page,plateKey),null);await a.context.close();await b.context.close();
    });
    await check('identical-state import does not falsely block backup restoration',async()=>{
      const state=createState('6'),text=JSON.stringify(state,null,2),{context,page}=await session('plate-layout',plateKey,text);
      await upload(page,'#jsonInput',text);await page.locator('#confirmImport').click();
      page.once('dialog',d=>d.accept());await fileAction(page,'#restoreImportBackup');
      assert.match(await page.locator('#notice').textContent(),/已恢复导入前备份/);
      assert.deepEqual(JSON.parse(await raw(page,plateKey)),state);await context.close();
    });
    // Visual artifacts use synthetic fixtures only.
    const broken=await session('sop-timeline',sopKey,'{broken');await broken.page.screenshot({path:path.join(output,'sop-recovery.png'),fullPage:true});await broken.context.close();
    const plate=await session('plate-layout',plateKey,JSON.stringify(createState('6')));await plate.page.screenshot({path:path.join(output,'plate-json.png'),fullPage:true});await plate.context.close();
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:checks.length,checks,output,uncaughtErrors:errors}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
