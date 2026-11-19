import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,execute,lifecycle,age,validate} from '../core.mjs';
import {passageLabel,profileEventDetails} from '../profiles.mjs';
const at='2026-11-01T10:00:00+08:00',later='2026-11-02T10:00:00+08:00';
const run=(db,type,data,key)=>execute(db,{type,key,data:{at,...data}},'qa-stock');
const stock=(db,extra={},key)=>run(db,'inventory-register',{name:'已有冻存细胞',location:'LN01/A/01/A1',...extra},key);

test('existing stock registers directly into an empty box without inventing culture or freeze history',()=>{
  const before=empty(),db=stock(before),e=db.entities[0],event=db.events[0];
  assert.equal(e.subtype,'冻存管');assert.equal(e.status,'stored');assert.equal(e.passage,null);assert.equal(passageLabel(e),'P 未知');assert.equal(lifecycle(db,e.id).startAt,null);assert.equal(age(db,e.id),'未启动');
  assert.equal(event.type,'历史库存登记');assert.equal(event.at,at);assert.equal(e.createdAt,at);assert.equal(db.events.some(e=>['培养','冻存'].includes(e.type)),false);assert.equal(db.relations.length,0);assert.equal(db.storageHistory[0].validFrom,at);assert.equal(db.storageHistory[0].eventId,event.id);assert.equal(event.data.profile.quantity,null);assert.equal(db.audit[0].action,'inventory-register');
  assert.equal(before.entities.length,0);assert.match(profileEventDetails(db,event),/不代表今天进行了冻存/);validate(db);
});
test('known freeze date, passage, quantity and cell-line origin preserve their separate meanings',()=>{
  let db=run(empty(),'entity',{type:'cell',subtype:'细胞系',name:'B16'});const lineId=db.entities[0].id;
  db=stock(db,{code:'LEGACY-1',passage:6,cellLineId:lineId,quantity:1000000,unit:'cells',attributes:{frozenDate:'2020-02-29',cryoprotectant:'测试冻存液',source:'旧库存台账'}});
  const e=db.entities.at(-1),event=db.events.at(-1);assert.equal(e.passage,6);assert.equal(e.quantity,1000000);assert.equal(e.attributes.frozenDate,'2020-02-29');assert.equal(e.cellLineId,lineId);assert.equal(event.at,at);assert.equal(event.data.profile.passage,6);assert.equal(event.data.profile.quantity,1000000);assert.equal(db.relations[0].parentId,lineId);validate(JSON.parse(JSON.stringify(db)));
});
test('duplicate identifiers, occupied slots and bad positions fail atomically',()=>{
  const db=stock(empty(),{code:'OLD-1'}),before=structuredClone(db);
  for(const extra of [{code:'OLD-1',location:'LN01/A/01/A2'},{code:'OLD-2'},{location:'LN01/A/01/J1'},{location:'LN01/A/02/A1'},{location:'实验台'}])assert.throws(()=>stock(db,extra));
  assert.deepEqual(db,before);
});
test('invalid historical dates, passage and quantities cannot become stock records',()=>{
  for(const extra of [{attributes:{frozenDate:'2099-01-01'}},{attributes:{frozenDate:'2026-02-30'}},{passage:-1},{passage:1.5},{quantity:0,unit:'cells'},{quantity:'x',unit:'cells'},{quantity:10},{unit:'cells'}])assert.throws(()=>stock(empty(),extra));
  const db=stock(empty(),{passage:0,quantity:null});assert.equal(db.entities[0].passage,0);assert.equal(db.entities[0].quantity,undefined);validate(db);
});
test('unknown passage survives revival, passage and freeze; D0 starts at actual revival',()=>{
  let db=stock(empty());const id=db.entities[0].id;
  db=run(db,'event',{entityId:id,eventType:'复苏',at:later});const culture=db.entities.at(-1);
  assert.equal(db.entities[0].status,'ended');assert.equal(db.entities[0].location,'');assert.equal(culture.passage,null);assert.equal(lifecycle(db,culture.id).startAt,later);assert.equal(age(db,culture.id,later),'D0');
  db=run(db,'event',{entityId:culture.id,eventType:'传代',count:1,keepParent:true,at:'2026-11-03T10:00:00+08:00'});const child=db.entities.at(-1);assert.equal(child.passage,null);
  db=run(db,'event',{entityId:child.id,eventType:'冻存',count:1,quantity:1000,unit:'cells',cryoprotectant:'测试',at:'2026-11-04T10:00:00+08:00'});assert.equal(db.entities.at(-1).passage,null);validate(db);
});
test('registration retries are idempotent and snapshots remain immutable through profile edits',()=>{
  const db=stock(empty(),{attributes:{frozenDate:'2020-01-01'}},'stock-key');assert.equal(stock(db,{location:'LN01/A/01/A2'},'stock-key'),db);
  const snapshot=structuredClone(db.events[0]),next=run(db,'profile-update',{entityId:db.entities[0].id,reason:'核对原始台账',attributes:{frozenDate:'2020-01-02'},at:later});
  assert.deepEqual(next.events[0],snapshot);assert.equal(next.entities[0].attributes.frozenDate,'2020-01-02');validate(next);
});
test('malformed inventory snapshots and registration origins are rejected on restore',()=>{
  const db=stock(empty());
  for(const mutate of [copy=>{copy.events[0].data.profile.passage='unknown';},copy=>{copy.events[0].data.profile.quantity=-1;},copy=>{copy.entities[0].registrationKind='invalid';},copy=>{copy.events[0].type='培养';}]){
    const bad=structuredClone(db);mutate(bad);assert.throws(()=>validate(bad));
  }
  validate(JSON.parse(JSON.stringify(db)));
});
