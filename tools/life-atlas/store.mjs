import {empty,validate} from './core.mjs';
const ready=new Promise((resolve,reject)=>{const r=indexedDB.open('blackblues-life-atlas-v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('workspaces');r.result.createObjectStore('snapshots',{autoIncrement:true});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
export async function load(owner){const db=await ready;return new Promise((resolve,reject)=>{const r=db.transaction('workspaces').objectStore('workspaces').get(owner);r.onsuccess=()=>{try{resolve(r.result?validate(r.result):empty());}catch(e){reject(e);}};r.onerror=()=>reject(r.error);});}
export async function getSnapshots(owner){const db=await ready;return new Promise((resolve,reject)=>{const r=db.transaction('snapshots').objectStore('snapshots').getAll();r.onsuccess=()=>resolve(r.result.filter(s=>s.owner===owner));r.onerror=()=>reject(r.error);});}
export async function save(owner,next,expected,{restore=false}={}){
  validate(next);const db=await ready;return new Promise((resolve,reject)=>{const t=db.transaction(['workspaces','snapshots'],'readwrite'),s=t.objectStore('workspaces'),r=s.get(owner);let failure;
    r.onsuccess=()=>{if((r.result?.revision||0)!==expected){failure=Error('另一页面已更新数据，请刷新后重试。当前输入仍保留。');t.abort();return;}if(restore)t.objectStore('snapshots').add({owner,at:new Date().toISOString(),data:r.result||empty()});s.put(next,owner);};t.oncomplete=()=>resolve();t.onabort=t.onerror=()=>reject(failure||t.error||Error('保存失败，未覆盖原数据'));});
}
