import {accountRequest,currentAccount} from './client.mjs';

export async function loadProfile() {
  let profile = await accountRequest((db,id,signal) => db.from('profiles').select('*').eq('id',id).maybeSingle().abortSignal(signal));
  if (!profile) {
    try { profile = await accountRequest((db,id,signal) => db.from('profiles').insert({id}).select().single().abortSignal(signal)); }
    catch (error) {
      if (error.code !== '23505') throw error;
      profile = await accountRequest((db,id,signal) => db.from('profiles').select('*').eq('id',id).single().abortSignal(signal));
    }
  }
  return profile;
}
export const updateNickname = display_name => accountRequest((db,id,signal) => db.from('profiles').update({display_name}).eq('id',id).select().single().abortSignal(signal));
export const listAnniversaries = () => accountRequest((db,id,signal) => db.from('anniversaries').select('*').eq('user_id',id).order('event_date').abortSignal(signal));
export async function saveAnniversary(record) {
  if (new TextEncoder().encode(JSON.stringify(record)).length>131072) throw new Error('纪念日请求超过128 KiB，本页修改仍保留，请缩短备注。');
  if (record.revision === null) {
    const {id,title,event_date,repeat_annually,notes} = record;
    try { return await accountRequest((db,user_id,signal) => db.from('anniversaries').insert({id,user_id,title,event_date,repeat_annually,notes}).select().single().abortSignal(signal)); }
    catch (error) {
      if (error.code !== '23505') throw error;
      const saved = await accountRequest((db,owner,signal) => db.from('anniversaries').select('*').eq('id',id).eq('user_id',owner).maybeSingle().abortSignal(signal));
      if (saved && ['title','event_date','repeat_annually','notes'].every(key => saved[key] === record[key])) return saved;
      throw new Error('同一记录已有不同的云端内容，请另存副本或读取云端版本。');
    }
  }
  const rows = await accountRequest((db,_id,signal) => db.rpc('save_anniversary', {
    p_id:record.id,p_expected_revision:record.revision,p_title:record.title,p_event_date:record.event_date,
    p_repeat_annually:record.repeat_annually,p_notes:record.notes
  }).abortSignal(signal));
  if (!rows?.length) throw new Error('版本冲突或记录已删除。本页修改保留，可另存副本，或确认后载入云端版本。');
  return rows[0];
}
export async function deleteAnniversary(record) {
  const rows = await accountRequest((db,_id,signal) => db.rpc('delete_anniversary',{p_id:record.id,p_expected_revision:record.revision}).abortSignal(signal));
  if (!rows?.length) throw new Error('版本冲突或记录已删除，请刷新列表后重试。');
}
// Shared revision-checked save used by both tool document managers.
export async function saveToolDocument(record) {
  if(new TextEncoder().encode(JSON.stringify(record)).length>7340032)throw new Error('文档请求超过7 MiB，本地内容仍需保留。');
  const rows = await accountRequest((db,_id,signal) => db.rpc('save_tool_document', {
    p_id:record.id,p_expected_revision:record.revision,p_title:record.title,p_content:record.content,p_schema_version:record.schema_version
  }).abortSignal(signal));
  if (!rows?.length) throw new Error('文档版本冲突或已不可见，本地内容仍需保留。');
  return rows[0];
}
export async function exportPrivateData() {
  const initial = currentAccount();
  const result = {version:1,exportedAt:new Date().toISOString()};
  for (const table of ['profiles','anniversaries','tool_documents']) {
    const rows = [];
    for (let start=0;;start+=100) {
      const page = await accountRequest((db,id,signal) => db.from(table).select('*').eq(table==='profiles'?'id':'user_id',id).order('id').range(start,start+99).abortSignal(signal));
      if (currentAccount().epoch !== initial.epoch) throw new Error('账户已切换，导出已取消');
      rows.push(...page); if (page.length<100) break;
    }
    result[table] = rows;
  }
  return result;
}
