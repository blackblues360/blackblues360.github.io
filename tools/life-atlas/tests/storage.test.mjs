import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,execute,validate} from '../core.mjs';
import {storageBoxes} from '../storage.mjs';
const at='2026-11-01T10:00:00+08:00',next='2026-11-02T10:00:00+08:00',last='2026-11-03T10:00:00+08:00';
const run=(db,type,data)=>execute(db,{type,data:{at,...data}});
const vial=(db,name='vial')=>run(db,'entity',{type:'cell',subtype:'冻存管',name,dormant:true});
const move=(db,id,location,time=next)=>run(db,'event',{entityId:id,eventType:'转移',location,at:time});
const boxData={kind:'sample',facility:'Lab',room:'R1',equipment:'F1',rack:'Rack1',code:'B1',name:'样品盒',rows:5,columns:7};
const state=(db,action,reason='盒管理原因',time=last)=>run(db,'storage-box-state',{boxId:'BOX-LN01-A-01',action,reason,at:time});

test('cell boxes are fixed 9x9; sample boxes use custom dimensions',()=>{
  const db=run(empty(),'storage-box',boxData);assert.equal(storageBoxes(db).at(-1).rows,5);assert.equal(storageBoxes(db).at(-1).columns,7);
  assert.throws(()=>run(db,'storage-box',{...boxData,kind:'cell',code:'B2'}),/9×9/);
  assert.throws(()=>run(db,'storage-box',boxData),/已存在/);validate(db);
  let nested=run(db,'storage-box',{...boxData,facility:'LN01',room:'A',equipment:'01',rack:'R2',code:'B2'});nested=run(nested,'entity',{type:'sample',name:'nested'});nested=move(nested,nested.entities[0].id,nested.storageBoxes.at(-1).path+'/A1');validate(nested);
});
test('moving closes old position interval and preserves source events',()=>{
  let db=vial(empty());const id=db.entities[0].id;db=move(db,id,'LN01/A/01/A1');db=move(db,id,'LN01/A/01/B2',last);
  assert.equal(db.storageHistory.length,2);assert.equal(db.storageHistory[0].validTo,last);assert.equal(db.storageHistory[1].validFrom,last);assert.equal(db.entities[0].location,'LN01/A/01/B2');assert.equal(db.storageHistory[0].exitEventId,db.events.at(-1).id);validate(db);
});
test('occupied cells, invalid coordinates and incompatible boxes fail without mutation',()=>{
  let db=vial(vial(empty(),'v1'),'v2');db=move(db,db.entities[0].id,'LN01/A/01/A1');const before=structuredClone(db),id=db.entities[1].id;
  assert.throws(()=>move(db,id,'LN01/A/01/A1'),/占用/);assert.throws(()=>move(db,id,'LN01/A/01/J1'),/坐标/);assert.throws(()=>move(db,id,'LN01/A/02/A1'),/不存在/);assert.deepEqual(db,before);
  db=run(db,'storage-box',boxData);assert.throws(()=>move(db,id,db.storageBoxes.at(-1).path+'/A1'),/类型/);
});
test('taking out frees slot, return retains identity and history',()=>{
  let db=vial(empty());const id=db.entities[0].id;db=move(db,id,'LN01/A/01/A1');db=run(db,'event',{entityId:id,eventType:'取出',reason:'使用前核对',at:last});
  assert.equal(db.entities[0].location,'');assert.equal(db.entities[0].status,'stored');assert.equal(db.storageHistory[0].validTo,last);
  db=run(db,'event',{entityId:id,eventType:'归还',location:'LN01/A/01/A1',at:'2026-11-04T10:00:00+08:00'});assert.equal(db.entities.length,1);assert.equal(db.storageHistory.length,2);validate(db);
});
test('revival and sample activation release physical storage independently',()=>{
  let db=vial(empty());const id=db.entities[0].id;db=move(db,id,'LN01/A/01/A1');db=run(db,'event',{entityId:id,eventType:'复苏',at:last});assert.equal(db.entities[0].location,'');assert.equal(db.storageHistory[0].validTo,last);validate(db);
  db=run(empty(),'entity',{type:'sample',name:'stored sample',dormant:true,location:'Freezer shelf'});const sample=db.entities[0].id;db=run(db,'event',{entityId:sample,eventType:'启动计时',at:next});assert.equal(db.entities[0].location,'');assert.equal(db.storageHistory[0].validTo,next);validate(db);
});
test('sample storage bounds work and mouse cages permit multiple individuals',()=>{
  let db=run(empty(),'storage-box',boxData);db=run(db,'entity',{type:'sample',name:'S1',dormant:true});db=move(db,db.entities[0].id,db.storageBoxes.at(-1).path+'/E7');validate(db);
  assert.throws(()=>move(db,db.entities[0].id,db.storageBoxes.at(-1).path+'/F1',last),/坐标/);
  for(const name of ['M1','M2'])db=run(db,'entity',{type:'mouse',name,location:'SPF/Room/Rack/A1'});assert.equal(db.entities.filter(e=>e.location==='SPF/Room/Rack/A1').length,2);validate(db);
});
test('legacy caches retain unknown entry times and original events',()=>{
  let db=vial(empty());db=move(db,db.entities[0].id,'LN01/A/01/A1');delete db.storageBoxes;delete db.storageHistory;const before=structuredClone(db.events);validate(db);
  const migrated=move(db,db.entities[0].id,'LN01/A/01/B1',last);assert.equal(migrated.storageHistory[0].validFrom,null);assert.equal(migrated.storageHistory[0].source,'legacy_snapshot');assert.deepEqual(migrated.events.slice(0,before.length),before);assert.equal(db.storageHistory,undefined);validate(migrated);
});
test('restore rejects invalid position histories and cached mismatches',()=>{
  let db=vial(empty());db=move(db,db.entities[0].id,'LN01/A/01/A1');let bad=structuredClone(db);bad.entities[0].location='LN01/A/01/B1';assert.throws(()=>validate(bad),/不一致/);
  bad=structuredClone(db);bad.storageHistory[0].eventId='missing';assert.throws(()=>validate(bad),/来源/);
  bad=structuredClone(db);bad.storageHistory[0].validFrom=at;assert.throws(()=>validate(bad),/来源/);
  bad=structuredClone(db);bad.storageHistory.push({...bad.storageHistory[0],id:'duplicate-active'});assert.throws(()=>validate(bad),/多个/);validate(JSON.parse(JSON.stringify(db)));
});
test('historical occupancy cannot be overwritten by another entity backfill',()=>{
  let db=vial(vial(empty(),'v1'),'v2');db=move(db,db.entities[0].id,'LN01/A/01/A1');db=run(db,'event',{entityId:db.entities[0].id,eventType:'取出',reason:'test',at:last});
  assert.throws(()=>move(db,db.entities[1].id,'LN01/A/01/A1','2026-11-02T12:00:00+08:00'),/历史占用/);
  db=move(db,db.entities[1].id,'LN01/A/01/A1',last);validate(db);
});

test('occupied box cannot archive; emptied box retains closed history and original events',()=>{
  let db=vial(empty());db=move(db,db.entities[0].id,'LN01/A/01/A1');const before=JSON.stringify(db);assert.throws(()=>state(db,'archive'),/仍有库存/);assert.equal(JSON.stringify(db),before);db=run(db,'event',{entityId:db.entities[0].id,eventType:'取出',reason:'测试移出',at:last});const snapshot=structuredClone(db),archived=state(db,'archive');assert.deepEqual(archived.events,snapshot.events);assert.deepEqual(archived.storageHistory,snapshot.storageHistory);assert.equal(archived.storageBoxes[0].status,'archived');assert.equal(archived.audit.at(-1).action,'storage-box-state');validate(JSON.parse(JSON.stringify(archived)));
});
test('archived box refuses new stock and movement while restore reopens same physical box',()=>{
  let db=state(vial(empty()),'archive');assert.throws(()=>move(db,db.entities[0].id,'LN01/A/01/A1',last),/已归档/);assert.throws(()=>run(db,'inventory-register',{name:'外部库存',location:'LN01/A/01/A1',at:last}),/已归档/);db=state(db,'restore','重新启用','2026-11-04T10:00:00+08:00');db=move(db,db.entities[0].id,'LN01/A/01/A1','2026-11-05T10:00:00+08:00');assert.equal(db.storageBoxes[0].stateHistory.length,2);assert.equal(db.storageBoxes[0].path,'LN01/A/01');validate(db);
});
test('archive and restore reject blank reasons, repeated states, earlier and future changes',()=>{
  const db=state(empty(),'archive');assert.throws(()=>state(db,'archive'),/状态已变化/);assert.throws(()=>state(db,'restore',' '),/原因/);assert.throws(()=>state(db,'restore','原因',at),/时间/);assert.throws(()=>state(db,'restore','原因','2099-01-01T00:00:00Z'),/时间/);assert.throws(()=>state(empty(),'restore'),/状态已变化/);
});
test('legacy boxes remain readable but imported invalid archive state or history is rejected',()=>{
  validate(vial(empty()));const db=state(empty(),'archive');for(const change of [b=>b.status='bad',b=>b.archivedAt=null,b=>b.stateHistory[0].reason='',b=>b.stateHistory[0].action='restore']){const copy=structuredClone(db);change(copy.storageBoxes[0]);assert.throws(()=>validate(copy),/冻存盒/);}const corrupt=vial(empty());corrupt.entities[0].location='LN01/A/01/A1';corrupt.storageBoxes=db.storageBoxes;assert.throws(()=>validate(corrupt),/已归档/);
});
test('archived path stays reserved and nested child occupancy does not belong to parent box',()=>{
  let db=run(empty(),'storage-box',{...boxData,facility:'LN01',room:'A',equipment:'01',rack:'X',code:'Y',kind:'cell',rows:9,columns:9});db=vial(db);db=move(db,db.entities[0].id,'LN01/A/01/X/Y/A1');db=state(db,'archive');assert.equal(db.storageBoxes[0].status,'archived');assert.equal(db.entities[0].location,'LN01/A/01/X/Y/A1');validate(db);assert.throws(()=>run(db,'storage-box',{...boxData,facility:'LN01',room:'A',equipment:'01',rack:'X',code:'Y',kind:'cell',rows:9,columns:9}),/已存在/);
});

test('inventory preview cannot resolve an archived target or named box',async()=>{
  const {parseInventoryTable,suggestInventoryMapping,previewInventoryImport}=await import('../inventory-import.mjs');const db=state(empty(),'archive'),table=parseInventoryTable('名称,格位,盒路径\n细胞,A1,LN01/A/01');assert.equal(previewInventoryImport(db,table,suggestInventoryMapping(table.headers),{boxId:'BOX-LN01-A-01',duplicates:'error',at:last}).errors.length,1);
});

test('archived empty box remains exportable with explicit archived status',async()=>{
  const {renderStorageReport,storageInventoryCSV}=await import('../storage-export.mjs');const db=state(empty(),'archive');assert.match(renderStorageReport(db),/已归档（不可存入）/);assert.match(storageInventoryCSV(db,{includeEmpty:true}),/细胞盒（已归档）/);assert.equal(db.storageBoxes[0].status,'archived');
});
