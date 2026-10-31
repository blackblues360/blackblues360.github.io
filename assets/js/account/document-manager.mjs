import {observeAccount,currentAccount,readableError} from './client.mjs';
import {saveToolDocument} from './data.mjs';
import {canonicalJSON,sameJSON,listToolDocuments,getToolDocument,createToolDocument,deleteToolDocument,listDeletedDocuments,restoreToolDocument,purgeToolDocument} from './documents.mjs';
import {acquireDraftGuard} from '../draft-lock.mjs';

export function mountDocumentManager(adapter){
  const bar=document.createElement('section');bar.className='cloud-bar';bar.dataset.cloudPanel='';
  bar.innerHTML='<span id="cloudIdentity">游客 · 本机方案</span><span id="cloudStatus" role="status" aria-live="polite">本地编辑</span><button id="cloudManage" type="button">云端方案</button><button id="cloudSave" type="button" hidden>保存到云端</button><button id="cloudLocal" type="button" hidden>返回本机方案</button><button id="cloudExport" type="button">导出当前文件</button><button id="cloudRecoveryExport" type="button" hidden>导出恢复副本</button><a href="../../account/">账户中心</a>';
  document.body.prepend(bar);
  const dialog=document.createElement('dialog');dialog.id='cloudDialog';dialog.className='cloud-doc-dialog';dialog.dataset.cloudPanel='';
  dialog.innerHTML='<header><h2>云端文档</h2><button id="cloudClose" type="button">关闭</button></header><p id="cloudDialogStatus" role="status"></p><div class="cloud-actions"><button id="cloudListView" type="button">当前工具</button><button id="cloudTrashView" type="button">统一回收站</button><button id="cloudDraftView" type="button">本机未同步草稿</button><button id="cloudNew" type="button">新建云端文档</button><button id="cloudImportLocal" type="button">导入当前本机方案</button></div><label id="cloudNameLabel" hidden>云端文档名称<input id="cloudName" maxlength="1000"></label><section id="cloudImportPreview" hidden><h3>核对本机方案</h3><p id="cloudImportSummary"></p><label><input id="cloudImportSelected" type="checkbox" checked>导入这个方案，保留本机原件</label><div class="cloud-actions"><button id="cloudBackupSource" type="button">下载原始备份</button><button id="cloudConfirmImport" type="button" disabled>备份后确认导入</button></div></section><button id="cloudRawExport" type="button" hidden>导出无法读取的原始数据</button><div id="cloudList"></div><div id="cloudConflict" class="cloud-actions" hidden><button id="cloudCopy" type="button">另存为新文档</button><button id="cloudReload" type="button">确认后重载云端</button></div>';
  document.body.append(dialog);
  dialog.insertAdjacentHTML('beforeend','<div class="cloud-actions"><button id="cloudRecoveryImport" type="button">导入恢复副本</button><input id="cloudRecoveryFile" type="file" accept=".json,application/json" hidden></div>');
  const $=id=>document.getElementById(id);
  let owner=null,current=null,guest=null,cache=null,cacheKey=null,pendingCreate=null,dirty=false,busy=false,sequence=0,context=0,listRequest=0,view='list',failedRaw=null,preview=null;
  const memoryDrafts=new Map();let exportedCreate=null;
  const manager={get cloudMode(){return current!==null;},get contextToken(){return `${currentAccount().epoch}:${context}`;},changed,importContent};
  function status(text,state='local'){ $('cloudStatus').textContent=text;$('cloudStatus').dataset.state=state; }
  function info(text){$('cloudDialogStatus').textContent=text;}
  function setBusy(value){busy=value;$('cloudName').disabled=value;for(const button of dialog.querySelectorAll('button:not(#cloudClose):not(#cloudRawExport)'))button.disabled=value;for(const id of ['cloudSave','cloudLocal'])$(id).disabled=value;if(!value){$('cloudConfirmImport').disabled=!preview?.backedUp;if(dirty&&$('cloudStatus').dataset.state==='saved')status('本页已修改 · 尚未保存到云端','dirty');}}
  function download(value,name){const url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  function envelope(inputDraft=adapter.pendingInput?.()){return {version:1,owner,appId:adapter.appId,id:current.id,revision:current.revision,title:$('cloudName').value,content:adapter.read(),dirty,pendingCreate,inputDraft};}
  function writeCache(inputDraft){if(!current)return false;const saved=structuredClone(envelope(inputDraft));memoryDrafts.set(cacheKey,saved);if(!cache?.canWrite)return false;try{cache.setItem(cacheKey,JSON.stringify(saved));return true;}catch{status('本机云端草稿未能保存，请导出恢复副本；编辑内容仍在。','error');return false;}}
  function changed(){sequence++;if(!current)return;dirty=true;if(!busy)status(navigator.onLine?'本页已修改 · 尚未保存到云端':'当前离线 · 修改仍保留',navigator.onLine?'dirty':'offline');queueMicrotask(()=>writeCache());}
  function rawFailure(value,error){failedRaw=value;$('cloudRawExport').hidden=false;info(`无法安全加载：${readableError(error)}。当前内容和本机原件保持不变，可导出原始数据。`);}
  function validCache(raw,id){const saved=JSON.parse(raw);if(!/^[-a-f0-9]{36}$/.test(id)||saved.version!==1||saved.owner!==owner||saved.appId!==adapter.appId||saved.id!==id||typeof saved.title!=='string'||!(saved.revision===null||(Number.isSafeInteger(saved.revision)&&saved.revision>0)))throw new Error('草稿身份或格式不匹配');if(saved.inputDraft&&!adapter.restoreInput)throw new Error('此工具不支持恢复该输入草稿');adapter.validate(saved.content,saved.inputDraft);if(saved.pendingCreate){const pending=saved.pendingCreate;if(saved.revision!==null||pending.id!==id||pending.app_id!==adapter.appId||pending.schema_version!==1||typeof pending.title!=='string')throw new Error('待确认创建快照无效');adapter.validate(pending.content);}return saved;}
  async function enter(record,content,options={}){
    const epoch=currentAccount().epoch,turn=++context,start=sequence,initiatingOwner=owner,oldCache=cache,oldKey=cacheKey;
    const key=`blackblues.cloud-draft.v1:${owner}:${adapter.appId}:${record.id}`;
    const guard=oldKey===key&&oldCache?oldCache:await acquireDraftGuard(key,text=>{if(cacheKey===key&&owner===initiatingOwner)status(text,'error');});
    if(currentAccount().epoch!==epoch||context!==turn||sequence!==start){if(guard!==oldCache)guard.release();if(currentAccount().epoch===epoch)info('等待草稿权限期间出现新编辑，已保留本页内容，请重新打开。');return false;}
    let saved=null,cachedRaw=null,original=null;
    const remembered=options.memory||(!options.ignoreMemory&&memoryDrafts.get(key));
    const memory=remembered&&(options.memory||remembered.dirty||remembered.pendingCreate||remembered.inputDraft)?remembered:null;
    if(memory){cachedRaw=JSON.stringify(memory);try{saved=validCache(cachedRaw,record.id);}catch(error){if(guard!==oldCache)guard.release();throw error;}if(!options.memory&&!options.useCache&&!confirm('此文档有本页未同步草稿，是否恢复？取消将保留草稿并停止打开。请先导出恢复副本再决定是否放弃。')){if(guard!==oldCache)guard.release();info('未同步草稿保持不变，可从本机未同步草稿列表恢复。');return false;}}
    try{original=guard.getItem(key);if(memory){if(original!==null&&original!==cachedRaw){if(guard.canWrite)guard.setItem(`${key}.before-recovery.${crypto.randomUUID()}`,original);else guard.suspend('旧草稿保持不变，恢复副本仅在本页内存中编辑，请导出文件。');}}else{cachedRaw=original;if(cachedRaw){saved=validCache(cachedRaw,record.id);if(!options.useCache&&(saved.dirty||saved.pendingCreate||saved.inputDraft)){if(!confirm('此文档有本机未同步草稿，是否恢复？取消将读取云端版本，并保留原草稿不写回。')){guard.suspend('原未同步草稿已保留，本页仅使用文件备份。');saved=null;}}else if(!options.useCache)saved=null;}}}
    catch(error){guard.suspend('本机云端草稿无法读取，原文已保留，本页请导出文件。');rawFailure(memory?original:cachedRaw,error);}
    const next=saved?adapter.validate(saved.content):content;
    if(!current)guest=structuredClone(adapter.read());else writeCache();
    if(oldCache&&oldCache!==guard)oldCache.release();cache=guard;cacheKey=key;
    current={id:record.id,revision:saved?saved.revision:record.revision};pendingCreate=saved?.pendingCreate||null;dirty=Boolean(options.dirty||saved?.dirty||saved?.inputDraft);
    $('cloudName').value=saved?saved.title:record.title;$('cloudNameLabel').hidden=false;$('cloudSave').hidden=false;$('cloudLocal').hidden=false;$('cloudRecoveryExport').hidden=false;exportedCreate=null;
    adapter.apply(next);if(saved?.inputDraft){if(dialog.open)dialog.close();adapter.restoreInput?.(saved.inputDraft);}
    sequence++;status(dirty?'已恢复本机修改 · 尚未保存到云端':'云端版本已载入',dirty?'dirty':'saved');
    if(!guard.canWrite)status(`${guard.reason} 云端保存仍按版本校验，请手动导出文件。`,'error');
    writeCache();return true;
  }
  async function importContent(content){
    if(busy)return false;if(!owner)throw new Error('请先登录账户');
    const epoch=currentAccount().epoch;adapter.flush();const next=adapter.validate(content);setBusy(true);
    try{return await enter({id:crypto.randomUUID(),revision:null,title:adapter.title(next)||'未命名文档'},next,{dirty:true});}
    finally{if(currentAccount().epoch===epoch)setBusy(false);}
  }
  async function save(){
    if(busy)return;if(!owner){info('请先在账户中心登录');dialog.showModal();return;}
    if(!current){prepareImport();if(!dialog.open)dialog.showModal();return;}
    adapter.flush();const epoch=currentAccount().epoch,turn=context,start=sequence,id=current.id;
    let sent;
    try{
      const content=adapter.validate(adapter.read()),title=$('cloudName').value.trim();if(!title)throw new Error('请填写云端文档名称');
      sent=pendingCreate||{id,app_id:adapter.appId,title,content:structuredClone(content),schema_version:1};
      if(current.revision===null){pendingCreate=sent;if(!writeCache()&&exportedCreate!==canonicalJSON(sent))throw new Error('本机无法可靠保存创建凭据。请先点击“导出恢复副本”，保存包含文档ID和发送快照的文件，再重试。');}
      setBusy(true);status('正在保存…','saving');
      const saved=current.revision===null?await createToolDocument(sent):await saveToolDocument({...sent,revision:current.revision});
      if(currentAccount().epoch!==epoch||context!==turn||current?.id!==id)return;
      if(current.revision===null){const verified=await getToolDocument(adapter.appId,id);if(currentAccount().epoch!==epoch||context!==turn)return;if(!verified||verified.revision!==saved.revision||verified.title!==sent.title||!sameJSON(verified.content,sent.content))throw new Error('创建结果核对未完成，请保留草稿后重试');}
      current.revision=saved.revision;pendingCreate=null;
      dirty=sequence!==start||!sameJSON(adapter.read(),sent.content)||$('cloudName').value.trim()!==sent.title;
      status(dirty?'已保存发送时的版本 · 本页还有未保存修改':'云端已保存',dirty?'dirty':'saved');$('cloudConflict').hidden=true;writeCache();
    }catch(error){if(currentAccount().epoch===epoch&&context===turn){dirty=true;const conflict=/版本冲突|已有不同/.test(error.message||'');status(readableError(error),conflict?'conflict':navigator.onLine?'error':'offline');info(readableError(error));$('cloudConflict').hidden=false;writeCache();}}
    finally{if(currentAccount().epoch===epoch&&context===turn)setBusy(false);}
  }
  async function openRecord(record,reload=false){
    if(busy)return;if(current&&dirty&&!confirm('当前有未保存修改。请先导出文件，确认后才会放弃本页修改。'))return;
    adapter.flush();const epoch=currentAccount().epoch,start=sequence,turn=context;setBusy(true);
    try{
      const row=await getToolDocument(adapter.appId,record.id);
      if(currentAccount().epoch!==epoch||context!==turn)return;
      if(sequence!==start)throw new Error('读取期间产生了新编辑，已保留本页内容，请重新打开');
      if(!row)throw new Error('文档已删除或当前账户不可访问');
      let content;try{if(row.schema_version!==1)throw new Error('文档版本不支持');content=adapter.validate(row.content);}catch(error){rawFailure(row,error);return;}
      if(reload&&cache?.canWrite){const raw=cache.getItem(cacheKey);if(raw)cache.setItem(`${cacheKey}.before-reload.${crypto.randomUUID()}`,raw);}
      if(reload&&cache?.canWrite)cache.setItem(cacheKey,JSON.stringify({...envelope(),dirty:false,pendingCreate:null,inputDraft:null,revision:row.revision,content:row.content,title:row.title}));
      const entered=await enter(row,content,{ignoreMemory:reload});if(entered&&currentAccount().epoch===epoch&&dialog.open)dialog.close();
    }catch(error){if(currentAccount().epoch===epoch)info(readableError(error));}
    finally{if(currentAccount().epoch===epoch)setBusy(false);}
  }
  function localMode(){
    if(busy)return;if(current&&dirty&&!confirm('云端还有未保存修改。将保留当前账户草稿；本机无法写入时仅在此页面内存中保留，请先导出恢复副本。确认返回本机方案？'))return;
    const input=adapter.pendingInput?.();adapter.flush();writeCache(input);cache?.release();cache=null;cacheKey=null;current=null;pendingCreate=null;dirty=false;context++;
    if(guest)adapter.apply(guest);guest=null;$('cloudNameLabel').hidden=true;$('cloudSave').hidden=true;$('cloudLocal').hidden=true;$('cloudRecoveryExport').hidden=true;status('本机方案 · 未自动上传');
  }
  function prepareImport(){
    if(current){info('请先返回本机方案，再核对并导入原件。');return;}
    if(!owner){info('请先在账户中心登录，游客方案不会自动上传。');return;}
    try{if(!adapter.canImportLocal())throw new Error('请先处理无法恢复的本机原草稿，不能上传回退或示例内容');adapter.flush();const content=adapter.validate(adapter.read()),raw=adapter.localRaw();preview={content:structuredClone(content),raw,source:JSON.stringify({version:1,rawStorageText:raw,importContent:content},null,2),sequence,backedUp:false};$('cloudImportSummary').textContent=`${adapter.summary(content)}。备份包含浏览器原始文本及实际待导入的当前完整方案，成功后保留本机原件。`;$('cloudImportPreview').hidden=false;$('cloudImportSelected').checked=true;$('cloudConfirmImport').disabled=true;info('先下载原文与当前方案的备份，再确认导入。');}
    catch(error){let raw=null;try{raw=adapter.localRaw();}catch{}rawFailure(raw,error);}
  }
  async function refreshList(nextView=view){
    if(!owner){info('请先在账户中心登录。游客本地功能仍可使用。');return;}
    view=nextView;const request=++listRequest,epoch=currentAccount().epoch;$('cloudList').replaceChildren();info('正在读取…');
    try{
      let rows;
      if(view==='drafts'){
        rows=[];const prefix=`blackblues.cloud-draft.v1:${owner}:${adapter.appId}:`;
        try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key.startsWith(prefix)||!/^[-a-f0-9]{36}$/.test(key.slice(prefix.length)))continue;try{const saved=validCache(localStorage.getItem(key),key.slice(prefix.length));if(saved.dirty||saved.pendingCreate||saved.inputDraft)rows.push(saved);}catch{rows.push({id:key.slice(prefix.length),title:'无法读取的原始草稿',invalid:true});}}}catch{}
        for(const [key,saved] of memoryDrafts){if(key.startsWith(prefix)&&(saved.dirty||saved.pendingCreate||saved.inputDraft)&&!rows.some(row=>!row.invalid&&sameJSON(row,saved)))rows.push({...saved,memory:true});}
      }else rows=view==='trash'?await listDeletedDocuments():await listToolDocuments(adapter.appId);
      if(currentAccount().epoch!==epoch||request!==listRequest)return;
      info(view==='trash'?'回收站保留两个工具的删除记录，不自动清理。':`${rows.length} 个${view==='drafts'?'本机未同步草稿':'云端方案'}`);
      for(const row of rows){
        const item=document.createElement('section');item.className='cloud-doc-row';const detail=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('small');name.textContent=row.title;meta.textContent=view==='trash'?`${row.app_id==='plate-layout'?'孔板':'SOP'} · 删除于 ${new Date(row.deleted_at).toLocaleString()}`:view==='drafts'?row.memory?'仅在此页面内存中，请导出恢复副本':'仅在当前账户的本机分区':new Date(row.updated_at).toLocaleString();detail.append(name,meta);item.append(detail);
        const button=(text,action)=>{const el=document.createElement('button');el.type='button';el.textContent=text;el.disabled=busy;el.onclick=()=>{const epoch=currentAccount().epoch;action().catch(error=>{if(currentAccount().epoch===epoch)info(readableError(error));});};item.append(el);};
        if(view==='list'){
          button('打开',()=>openRecord(row));button('删除',async()=>{if(busy||!confirm(`将“${row.title}”移到回收站？`))return;const turn=currentAccount().epoch;setBusy(true);try{await deleteToolDocument(row.id,row.revision);if(currentAccount().epoch!==turn)return;if(current?.id===row.id){dirty=true;status('云端已删除 · 本页修改仍可导出或另存','conflict');$('cloudConflict').hidden=false;writeCache();}}finally{if(currentAccount().epoch===turn)setBusy(false);}await refreshList();});
        }else if(view==='trash'){
          button('恢复',async()=>{if(busy)return;const turn=currentAccount().epoch;setBusy(true);try{await restoreToolDocument(row.id,row.revision);}finally{if(currentAccount().epoch===turn)setBusy(false);}if(currentAccount().epoch===turn)await refreshList('trash');});
          button('永久删除',async()=>{if(busy||!confirm(`永久删除“${row.title}”？内容将无法在应用内恢复。`)||!confirm('再次确认：清空文档正文和名称，保留防止旧请求复活的历史名额；已有备份不受此操作影响。'))return;const turn=currentAccount().epoch;setBusy(true);try{await purgeToolDocument(row.id,row.revision);}finally{if(currentAccount().epoch===turn)setBusy(false);}if(currentAccount().epoch===turn)await refreshList('trash');});
        }else button(row.invalid?'导出原文':'恢复草稿',async()=>{const epoch=currentAccount().epoch,key=`blackblues.cloud-draft.v1:${owner}:${adapter.appId}:${row.id}`,memory=row.memory?memoryDrafts.get(key):null,raw=memory?JSON.stringify(memory):localStorage.getItem(key);if(row.invalid){download(raw,'unreadable-cloud-draft.json');return;}if(busy||current&&dirty&&!confirm('请先导出本页修改，确认后恢复该账户的草稿。'))return;const saved=validCache(raw,row.id);setBusy(true);try{if(await enter({id:row.id,revision:saved.revision,title:saved.title},adapter.validate(saved.content),{useCache:true,memory})&&currentAccount().epoch===epoch)dialog.close();}finally{if(currentAccount().epoch===epoch)setBusy(false);}});
        $('cloudList').append(item);
      }
    }catch(error){if(currentAccount().epoch===epoch&&request===listRequest)info(readableError(error));}
  }
  observeAccount(({user})=>{
    if((user?.id||null)===owner)return;
    const pendingInput=adapter.pendingInput?.();if(current){adapter.flush();writeCache(pendingInput);}
    context++;listRequest++;cache?.release();cache=null;cacheKey=null;current=null;pendingCreate=null;dirty=false;busy=false;owner=user?.id||null;
    if(guest)adapter.apply(guest);guest=null;preview=null;failedRaw=null;$('cloudRawExport').hidden=true;$('cloudImportPreview').hidden=true;$('cloudConflict').hidden=true;$('cloudNameLabel').hidden=true;$('cloudSave').hidden=true;$('cloudLocal').hidden=true;$('cloudRecoveryExport').hidden=true;$('cloudList').replaceChildren();setBusy(false);
    let localFound=false;try{localFound=adapter.localRaw()!==null;}catch{}
    $('cloudIdentity').textContent=user?user.email:'游客 · 本机方案';status(user?localFound?'发现本机方案 · 可核对后导入云端':'本机方案未上传 · 可新建云端文档':'游客模式 · 仅在本机编辑');info(user?'选择云端文档，或核对后导入本机方案。':'请先登录，游客原件不会自动上传。');
  });
  $('cloudName').addEventListener('input',changed);
  document.addEventListener('input',event=>{if(!event.target.closest('[data-cloud-panel]'))changed();},true);
  $('cloudManage').onclick=()=>{dialog.showModal();refreshList();};$('cloudClose').onclick=()=>dialog.close();$('cloudSave').onclick=save;$('cloudLocal').onclick=localMode;$('cloudExport').onclick=()=>adapter.export();
  $('cloudListView').onclick=()=>refreshList('list');$('cloudTrashView').onclick=()=>refreshList('trash');$('cloudDraftView').onclick=()=>refreshList('drafts');$('cloudImportLocal').onclick=prepareImport;
  $('cloudNew').onclick=async()=>{const epoch=currentAccount().epoch;try{if(current&&dirty&&!confirm('请先导出本页修改。确认新建云端文档？'))return;if(await importContent(adapter.create())&&currentAccount().epoch===epoch)info('新文档尚未上传，请填写名称并点击保存。');}catch(error){if(currentAccount().epoch===epoch)info(readableError(error));}};
  $('cloudBackupSource').onclick=()=>{if(!preview)return;download(preview.source,`${adapter.appId}-before-cloud.json`);preview.backedUp=true;$('cloudConfirmImport').disabled=false;};
  $('cloudConfirmImport').onclick=async()=>{if(busy||!preview?.backedUp||!$('cloudImportSelected').checked)return;try{if(sequence!==preview.sequence||adapter.localRaw()!==preview.raw)throw new Error('本机方案已改变，请重新预览和备份');const source=preview.source;if(await importContent(preview.content)){if(cache?.canWrite)cache.setItem(`${cacheKey}.source-backup`,source);$('cloudImportPreview').hidden=true;preview=null;await save();}}catch(error){info(readableError(error));}};
  $('cloudCopy').onclick=async()=>{const epoch=currentAccount().epoch;try{if(await importContent(adapter.read())&&currentAccount().epoch===epoch)info('已准备独立副本，请手动保存。');}catch(error){if(currentAccount().epoch===epoch)info(readableError(error));}};
  $('cloudRecoveryExport').onclick=()=>{if(!current)return;const input=adapter.pendingInput?.();adapter.flush();const saved=envelope(input);download(saved,`${adapter.appId}-cloud-recovery.json`);exportedCreate=pendingCreate?canonicalJSON(pendingCreate):null;};
  $('cloudRecoveryImport').onclick=()=>$('cloudRecoveryFile').click();
  $('cloudRecoveryFile').onchange=async()=>{const file=$('cloudRecoveryFile').files[0],epoch=currentAccount().epoch,turn=context,start=sequence;let raw=null,handling=false;try{if(!file||busy)return;handling=true;setBusy(true);if(file.size>16777216)throw new Error('恢复副本超过16 MiB');raw=await file.text();if(currentAccount().epoch!==epoch)return;if(context!==turn||sequence!==start)throw new Error('读取文件期间账户、文档或编辑已改变，请重新选择恢复文件');const value=JSON.parse(raw),saved=validCache(raw,value.id);if(current&&dirty&&!confirm('请先导出本页修改，确认恢复文件中的草稿？'))return;if(await enter({id:saved.id,revision:saved.revision,title:saved.title},adapter.validate(saved.content),{useCache:true,memory:saved})&&currentAccount().epoch===epoch)dialog.close();}catch(error){if(currentAccount().epoch===epoch)rawFailure(raw,error);}finally{if(currentAccount().epoch===epoch){if(handling)setBusy(false);$('cloudRecoveryFile').value='';}}};
  $('cloudReload').onclick=()=>{if(current?.revision!==null&&current)openRecord(current,true);};
  $('cloudRawExport').onclick=()=>download(failedRaw,'unreadable-cloud-original.json');
  window.addEventListener('offline',()=>{if(current)status('当前离线 · 请保留或导出修改，恢复后手动重试','offline');});
  window.addEventListener('online',()=>{if(current&&dirty)status('网络已恢复 · 请手动重试保存','dirty');});
  window.addEventListener('beforeunload',event=>{if(!current)return;const input=adapter.pendingInput?.();adapter.flush();writeCache(input);if(dirty||busy){event.preventDefault();event.returnValue='';}});
  return manager;
}
