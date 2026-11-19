import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,execute,validate} from '../core.mjs';
import {storageBoxes} from '../storage.mjs';
const at='2026-11-01T10:00:00+08:00',next='2026-11-02T10:00:00+08:00',last='2026-11-03T10:00:00+08:00';
const run=(db,type,data)=>execute(db,{type,data:{at,...data}});
const vial=(db,name='vial')=>run(db,'entity',{type:'cell',subtype:'冻存管',name,dormant:true});
const move=(db,id,location,time=next)=>run(db,'event',{entityId:id,eventType:'转移',location,at:time});
const boxData={kind:'sample',facility:'Lab',room:'R1',equipment:'F1',rack:'Rack1',code:'B1',name:'样品盒',rows:5,columns:7};

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
