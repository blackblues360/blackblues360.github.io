import * as account from '../../assets/js/account/client.mjs';
const request=operation=>{if(typeof account.accountRequest!=='function')throw Error('云备份连接不可用');return account.accountRequest(operation);};
export const uploadBackup=p=>request((db,_owner,signal)=>db.rpc('save_life_atlas_backup',p).abortSignal(signal));
export const listBackups=()=>request((db,owner,signal)=>db.from('life_atlas_backup_versions').select('id,user_id,device_id,local_revision,checksum,created_at,captured_at').eq('user_id',owner).order('created_at',{ascending:false}).limit(20).abortSignal(signal));
export const getBackup=id=>request((db,owner,signal)=>db.from('life_atlas_backups').select('*').eq('user_id',owner).eq('id',id).single().abortSignal(signal));
