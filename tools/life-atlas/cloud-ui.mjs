import {currentAccount} from '../../assets/js/account/client.mjs';
import {getCloudState,setCloudEnabled,updateCloudState,save} from './store.mjs?v=20261124.2';
import {createBackupRunner,decodeBackup} from './cloud-backup.mjs?v=20261124.2';
import {uploadBackup,listBackups,getBackup} from './cloud-api.mjs?v=20261124.2';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚无记录';
export function createCloudUI({owner,active,getData,form,hide,onRestore,onChange,toast}){
  const epoch=currentAccount().epoch;
  let state={enabled:false,pending:null,lastSuccess:null,error:''},rows=[],progress='未启用';
  const allowed=()=>active()&&currentAccount().user?.id===owner&&currentAccount().epoch===epoch;
  const refresh=async()=>{state=await getCloudState(owner);};
  const run=createBackupRunner({owner,active:allowed,read:()=>getCloudState(owner),update:fn=>updateCloudState(owner,fn),upload:uploadBackup,onChange:message=>{progress=message;refresh().then(()=>{if(allowed())onChange();}).catch(()=>{});}});
  const label=()=>state.enabled?(progress==='上传中'?progress:state.pending?.expired?'旧请求已过期，请点击立即备份':state.error?'云备份失败，待重试':state.pending||state.lastSuccess?.revision!==getData().revision?'有待备份修改':state.lastSuccess?'云备份成功 · 修订 '+state.lastSuccess.revision:'等待备份'):'自动云备份未启用';
  return {
    label,
    async init(){await refresh();onChange();setTimeout(()=>run(),2000);setInterval(async()=>{try{await refresh();await run();}catch{}},120000);window.addEventListener('online',()=>run());},
    page(demo){const data=getData();return `<div class="backup-banner"><h2>${demo?'演示空间不上传云端':esc(label())}</h2><p>本机是工作副本，云端保存历史快照；备份不代表多设备实时同步。</p></div><div class="equal-grid"><section class="card"><div class="card-body"><h2>自动云备份</h2><p>启用后，本地保存会更新待备份队列，约每 2 分钟上传最新完整快照；失败保留队列并重试。页面关闭后暂停上传，重新打开继续。</p><p>每账户保留最近 20 份，单份最多 5 MiB。当前不包含附件或增量备份。</p><p>上次成功：${stamp(state.lastSuccess?.at)}${state.lastSuccess?' · 本机修订 '+state.lastSuccess.revision:''}</p><p class="error">${esc(state.error)}</p><button data-action="cloud-toggle" ${demo?'disabled':''}>${state.enabled?'暂停自动备份':'启用自动备份'}</button><button data-action="cloud-now" ${demo||!state.enabled?'disabled':''}>立即备份 / 重试</button></div></section><section class="card"><div class="card-body"><h2>本机 JSON 与保护快照</h2><p>${data.entities.length} 个实体 · ${data.events.length} 条事件</p><button data-action="export">导出完整 JSON</button><button data-action="import">从 JSON 预览恢复</button><button data-action="snapshots">下载恢复前保护快照</button></div></section></div><section class="card"><div class="card-head"><h2>云端历史版本</h2><button data-action="cloud-list" ${demo?'disabled':''}>刷新版本列表</button></div><div class="card-body"><p>恢复前校验账户、完整性及数据关联，先展示范围，再确认替换本机工作副本。确认时自动保存本机保护快照；其他设备不会被自动覆盖。</p>${rows.map(r=>`<div class="field-line"><span>快照 ${stamp(r.captured_at)} · 上传 ${stamp(r.created_at)} · 修订 ${r.local_revision} · ${r.device_id===state.deviceId?'此浏览器':'其他浏览器 / 设备'}</span><button data-cloud-restore="${esc(r.id)}">预览恢复</button></div>`).join('')||'<p class="muted">点击刷新读取当前账户云端版本。</p>'}</div></section>`;},
    async action(action,id){
      if(!allowed())throw Error('请在已登录的个人工作区操作');
      if(action==='toggle'){
        const enabled=!state.enabled;
        form(enabled?'启用自动云备份':'暂停自动云备份',`<p>${enabled?'将当前账户工作区自动上传到现有云服务，保留最近 20 份，不含附件。':'暂停后本机继续保存；已发出的上传可能完成，历史版本保留。'}</p><label><input type="checkbox" required>确认${enabled?'启用':'暂停'}</label>`,async()=>{if(!allowed())throw Error('账户已变化');await setCloudEnabled(owner,enabled);await refresh();hide();onChange();if(enabled)await run();});return;
      }
      if(action==='now'){await refresh();if(state.enabled&&(!state.pending||state.pending.expired))await setCloudEnabled(owner,true);await run();await refresh();if(allowed())onChange();return;}
      if(action==='list'){const result=await listBackups();if(!allowed())throw Error('账户已变化');rows=result;onChange();return;}
      if(action==='restore'){
        const row=await getBackup(id);if(!allowed())throw Error('账户已变化');const data=await decodeBackup(row,owner);if(!allowed())throw Error('账户已变化');const revision=getData().revision;
        form('确认云端恢复范围',`<p>${stamp(row.created_at)} · 修订 ${row.local_revision}</p><p>${data.entities.length} 个实体 · ${data.events.length} 条事件 · ${data.relations.length} 条谱系 · ${data.plans.length} 项计划</p><p>将替换本机工作副本。当前数据先存为本机保护快照。${row.device_id!==state.deviceId?'此版本来自其他浏览器 / 设备。':''}</p><label><input type="checkbox" required>确认恢复以上版本</label>`,async()=>{
          if(!allowed()||getData().revision!==revision)throw Error('账户或本机数据已变化，请重新预览');const next=structuredClone(data);next.revision=revision+1;next.audit.push({id:'LOG-'+crypto.randomUUID(),action:'cloud-restore',actor:owner,at:new Date().toISOString(),sourceBackupId:row.id,revision:next.revision});await save(owner,next,revision,{restore:true});if(!allowed())return;await refresh();hide();onRestore(next);toast('恢复完成，已保留本机保护快照');
        });document.querySelector('#editor [type=submit]').textContent='确认恢复此版本';
      }
    }
  };
}
