import {validate} from './core.mjs?v=20261124.2';
export async function checksum(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function encodeBackup(owner,state){
  validate(state.pending.data);
  const payload=JSON.stringify({format:'life-atlas-cloud-backup',owner,deviceId:state.deviceId,createdAt:state.pending.createdAt,data:state.pending.data});
  if(new TextEncoder().encode(payload).length>5242880)throw Error('备份超过 5 MiB，请先导出 JSON；本地数据保持不变');
  return {p_id:state.pending.id,p_device_id:state.deviceId,p_revision:state.pending.data.revision,p_payload:payload,p_checksum:await checksum(payload)};
}
export async function decodeBackup(row,owner){
  if(row.user_id!==owner||typeof row.payload!=='string'||new TextEncoder().encode(row.payload).length>5242880||await checksum(row.payload)!==row.checksum)throw Error('备份账户或完整性校验失败，未修改本地数据');
  const body=JSON.parse(row.payload);
  if(body.format!=='life-atlas-cloud-backup'||body.owner!==owner||body.deviceId!==row.device_id||body.data?.revision!==row.local_revision)throw Error('备份格式或来源不一致');
  return validate(body.data);
}
export function createBackupRunner({owner,read,update,upload,active,onChange=()=>{}}){
  let running=false;
  return async function run(){
    if(running||!active())return;running=true;let queuedId;
    try{
      const state=await read();if(!active()||!state.enabled||!state.pending||state.pending.expired)return;queuedId=state.pending.id;
      onChange('上传中');const request=await encodeBackup(owner,state);if(!active())return;
      await upload(request);if(!active())return;
      await update(current=>({...current,pending:current.pending?.id===request.p_id?null:current.pending,lastSuccess:current.lastSuccess?.revision>request.p_revision?current.lastSuccess:{at:new Date().toISOString(),revision:request.p_revision,id:request.p_id},error:''}));
      if(active())onChange('备份成功');
    }catch(error){if(active()){try{await update(current=>({...current,pending:error.code==='22023'&&current.pending?.id===queuedId?{...current.pending,expired:true}:current.pending,error:error.code==='22023'?'旧请求已超过保留窗口；请点击立即备份，重新抓取本机副本':'云备份失败：'+(error.message||'请稍后重试')}));}catch{}onChange(error.code==='22023'?'旧请求已过期，请手动重新备份':'备份失败，将自动重试');}}
    finally{running=false;}
  };
}
