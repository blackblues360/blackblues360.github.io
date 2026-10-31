import {accountRequest,currentAccount} from './client.mjs';

// JSONB may reorder object keys; compare JSON values rather than input bytes.
export function canonicalJSON(value,depth=0){
  if(depth>64)throw new Error('文档嵌套过深，无法安全处理');
  if(Array.isArray(value))return `[${value.map(item=>canonicalJSON(item,depth+1)).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJSON(value[key],depth+1)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sameJSON=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
export const listToolDocuments=app=>accountRequest((db,id,signal)=>db.from('tool_documents').select('id,app_id,title,revision,updated_at').eq('user_id',id).eq('app_id',app).order('updated_at',{ascending:false}).abortSignal(signal));
export const getToolDocument=(app,id)=>accountRequest((db,owner,signal)=>db.from('tool_documents').select('*').eq('user_id',owner).eq('app_id',app).eq('id',id).maybeSingle().abortSignal(signal));
export async function createToolDocument(record){
  if(!['plate-layout','sop-timeline'].includes(record.app_id)||record.schema_version!==1)throw new Error('文档类型或版本不支持');
  if(new TextEncoder().encode(JSON.stringify(record)).length>7340032)throw new Error('文档请求超过7 MiB，请先导出本地文件');
  const epoch=currentAccount().epoch;
  const {id,app_id,title,content,schema_version}=record;
  try{return await accountRequest((db,_owner,signal)=>db.from('tool_documents').insert({id,app_id,title,content,schema_version}).select().single().abortSignal(signal));}
  catch(error){
    if(error.code!=='23505'||currentAccount().epoch!==epoch)throw error;
    const saved=await getToolDocument(app_id,id);
    if(currentAccount().epoch!==epoch)throw new Error('账户已切换，本次结果已忽略');
    if(saved&&saved.revision===1&&saved.schema_version===schema_version&&saved.title===title&&sameJSON(saved.content,content))return saved;
    throw new Error('同一文档已有不同内容或已删除，请保留本页内容并另存副本');
  }
}
export async function deleteToolDocument(id,revision){
  const rows=await accountRequest((db,_owner,signal)=>db.rpc('delete_tool_document',{p_id:id,p_expected_revision:revision}).abortSignal(signal));
  if(!rows?.length)throw new Error('版本冲突或文档已删除，请刷新后核对');
}
export const listDeletedDocuments=()=>accountRequest((db,_owner,signal)=>db.rpc('list_deleted_tool_documents').abortSignal(signal));
export async function restoreToolDocument(id,revision){
  const rows=await accountRequest((db,_owner,signal)=>db.rpc('restore_tool_document',{p_id:id,p_expected_revision:revision}).abortSignal(signal));
  if(!rows?.length)throw new Error('版本冲突，或文档已恢复/永久删除');
  return rows[0];
}
export async function purgeToolDocument(id,revision){
  const rows=await accountRequest((db,_owner,signal)=>db.rpc('purge_tool_document',{p_id:id,p_expected_revision:revision}).abortSignal(signal));
  if(!rows?.length)throw new Error('版本冲突，或文档不在回收站中');
}
