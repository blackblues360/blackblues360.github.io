import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,execute,validate} from '../core.mjs';
const at='2026-11-01T10:00:00+08:00',later='2026-11-03T10:00:00+08:00';
function setup(){let db=empty();for(const [i,slot] of ['A1','A2'].entries())db=execute(db,{type:'inventory-register',data:{at,name:'管'+i,code:'T'+i,location:'LN01/A/01/'+slot,passage:3}});return db;}
const command=db=>({type:'storage-batch-move',key:'MOVE-test',data:{at:later,reason:'整理库存',items:db.entities.map((e,i)=>({entityId:e.id,from:e.location,location:'LN01/A/01/B'+(i+1)}))}});
test('batch relocation keeps identities, passage and lifecycles while closing and opening individual intervals',()=>{
  const db=setup(),cmd=command(db),next=execute(db,cmd,'tester');assert.deepEqual(next.entities.map(e=>e.location),['LN01/A/01/B1','LN01/A/01/B2']);assert.deepEqual(next.lifecycles,db.lifecycles);assert.deepEqual(next.entities.map(e=>[e.id,e.passage]),db.entities.map(e=>[e.id,e.passage]));assert.equal(next.events.filter(e=>e.storageMoveBatchId==='MOVE-test').length,2);assert.equal(next.storageHistory.filter(h=>h.validTo===later).length,2);assert.equal(db.entities[0].location,'LN01/A/01/A1');validate(JSON.parse(JSON.stringify(next)));
});
test('same batch can be retried once and changed content or orphaned markers is rejected',()=>{
  const db=setup(),cmd=command(db),next=execute(db,cmd);assert.equal(execute(next,cmd),next);const changed=structuredClone(cmd);changed.data.reason='different';assert.throws(()=>execute(next,changed),/不同内容/);const broken=structuredClone(next);broken.audit.pop();assert.throws(()=>execute(broken,cmd),/已被使用/);
});
test('duplicate destinations, occupied slots and direct swaps cannot partially relocate tubes',()=>{
  for(const locations of [['B1','B1'],['B1','A1'],['A2','A1']]){const db=setup(),before=JSON.stringify(db),cmd=command(db);cmd.data.items.forEach((i,n)=>i.location='LN01/A/01/'+locations[n]);assert.throws(()=>execute(db,cmd),/重复|占用/);assert.equal(JSON.stringify(db),before);}
});
test('stale original location and invalid entity or target cannot be silently accepted',()=>{
  for(const change of [c=>c.data.items[0].from='wrong',c=>c.data.items[0].entityId='missing',c=>c.data.items[0].location='free text',c=>c.data.items[0].location='LN01/A/01/Z99',c=>c.data.items[0].location='LN01/A/01/A1']){const db=setup(),cmd=command(db);change(cmd);assert.throws(()=>execute(db,cmd));assert.equal(db.events.length,2);}
});
test('failure on a later tube chronology leaves all earlier tube changes unsaved',()=>{
  let db=setup();db=execute(db,{type:'event',data:{entityId:db.entities[1].id,eventType:'转移',at:'2026-11-04T10:00:00+08:00',location:'LN01/A/01/C2'}});const before=JSON.stringify(db);assert.throws(()=>execute(db,command(db)),/不能早于|顺序/);assert.equal(JSON.stringify(db),before);
});
test('archived target and non-vial entities are excluded from batch transfer',()=>{
  let db=setup();db=execute(db,{type:'storage-box',data:{kind:'cell',facility:'L',room:'R',equipment:'F',rack:'A',code:'B',name:'目标',rows:9,columns:9,at}});const box=db.storageBoxes.at(-1);db=execute(db,{type:'storage-box-state',data:{boxId:box.id,action:'archive',reason:'停用',at:later}});const cmd=command(db);cmd.data.items[0].location=box.path+'/A1';assert.throws(()=>execute(db,cmd),/已归档/);
  const sample=execute(empty(),{type:'entity',data:{at,name:'样品',type:'sample'}});assert.throws(()=>execute(sample,command(sample)),/冻存管/);
});
test('backup validation rejects incomplete or altered transfer audit and event metadata',()=>{
  const db=setup(),next=execute(db,command(db));for(const change of [d=>d.audit.pop(),d=>d.events.pop(),d=>d.events.at(-1).storageMoveBatchId='missing',d=>d.audit.at(-1).count=1,d=>{const r=JSON.parse(d.audit.at(-1).request);r.items[0].from='wrong';d.audit.at(-1).request=JSON.stringify(r);}]){const bad=structuredClone(next);change(bad);assert.throws(()=>validate(bad));}
});
test('selection limits, reason, idempotency key and future time are enforced',()=>{
  const db=setup();for(const change of [c=>c.key='',c=>c.data.reason=' ',c=>c.data.items=[],c=>c.data.at='2099-01-01T00:00:00Z',c=>c.data.items=Array(101).fill(c.data.items[0])]){const cmd=command(db);change(cmd);assert.throws(()=>execute(db,cmd));}
});

test('a cross-box batch keeps the source box empty and points new intervals to the target box',()=>{
  let db=setup();db=execute(db,{type:'storage-box',data:{at,kind:'cell',facility:'L',room:'R',equipment:'F',rack:'Rack',code:'Box2',name:'跨盒目标',rows:9,columns:9}});const target=db.storageBoxes.at(-1),cmd=command(db);cmd.data.items.forEach((i,n)=>i.location=target.path+'/C'+(n+1));const next=execute(db,cmd);assert.ok(next.entities.every(e=>e.location.startsWith(target.path+'/')));assert.ok(next.storageHistory.filter(h=>!h.validTo).every(h=>h.location.startsWith(target.path+'/')));validate(next);
});
