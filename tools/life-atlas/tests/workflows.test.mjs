import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,execute,validate,lifecycle} from '../core.mjs';
import {fieldLabel} from '../event-fields.mjs';
const at='2026-11-01T10:00:00+08:00',later='2026-11-02T10:00:00+08:00';
function workspace(type='mouse',count=1){let db=empty();for(let i=0;i<count;i++)db=execute(db,{type:'entity',data:{type,subtype:type==='cell'?'培养批次':type,name:type+' '+i,at}});return db;}
const event=(db,eventType,data={})=>execute(db,{type:'event',data:{entityId:db.entities[0].id,eventType,at:later,...data}});
const drug={drug:'test drug',dose:5,doseUnit:'mg/kg',route:'test route'};

test('dosing fields are required, numeric, and saved with immutable labels',()=>{
  const db=workspace();assert.throws(()=>event(db,'给药'),/药物/);
  assert.throws(()=>event(db,'给药',{...drug,dose:Infinity}),/数值无效/);
  const next=event(db,'给药',{...drug,operator:'researcher'}),ev=next.events.at(-1);
  assert.equal(ev.data.dose,5);assert.equal(ev.data.doseUnit,'mg/kg');assert.equal(ev.data.operator,'researcher');
  assert.equal(fieldLabel(ev,'dose'),'剂量');assert.equal(ev.templateVersion,'preset-v2');validate(next);
  const bad=structuredClone(next);bad.events.at(-1).fieldSchema={};assert.throws(()=>validate(bad),/字段快照/);
});
test('tumor volume preserves explicit method and raw dimensions',()=>{
  const db=workspace();const measured=event(db,'肿瘤测量',{method:'手动体积',value:77});assert.equal(measured.events.at(-1).data.value,77);
  const calculated=event(db,'肿瘤测量',{method:'长径×短径²/2',length:10,width:4});assert.deepEqual(calculated.events.at(-1).data,{method:'长径×短径²/2',length:10,width:4,value:80,unit:'mm³'});
  assert.throws(()=>event(db,'肿瘤测量',{method:'长径×短径²/2',length:10}),/长径和短径/);
});
test('partial use and partial consumption retain active lifecycle',()=>{
  const db=workspace('cell');let next=event(db,'实验使用',{purpose:'test',usedQuantity:3,unit:'mL',allUsed:'部分使用',remainingQuantity:2});
  assert.equal(next.entities[0].status,'active');assert.equal(next.entities[0].quantity,2);assert.equal(lifecycle(next,next.entities[0].id).endAt,null);
  next=event(next,'实验使用',{purpose:'test',usedQuantity:2,unit:'mL',allUsed:'全部使用'});assert.equal(next.entities[0].status,'ended');assert.equal(next.entities[0].quantity,0);
  const sample=workspace('sample');assert.equal(event(sample,'消耗',{purpose:'test',usedQuantity:1,remainingQuantity:2,unit:'mL'}).entities[0].status,'active');
  assert.throws(()=>event(db,'实验使用',{purpose:'test',usedQuantity:1,unit:'mL',allUsed:'全部使用',remainingQuantity:5}),/剩余数量必须为零/);
});
test('known sample quantities cannot be over-allocated or silently change units',()=>{
  let db=workspace('sample');db=event(db,'分装',{count:2,quantity:1,unit:'mL',purpose:'test',keepParent:false,longTerm:false});
  const id=db.entities[1].id,base={entityId:id,count:2,quantity:0.75,unit:'mL',purpose:'test',keepParent:false,longTerm:false};
  assert.throws(()=>event(db,'分装',base),/超过/);assert.throws(()=>event(db,'分装',{...base,quantity:0.5,unit:'μL'}),/单位/);
  const next=event(db,'分装',{...base,quantity:0.5});assert.equal(next.entities[1].quantity,0);assert.equal(next.entities[1].status,'ended');validate(next);
});
test('aliquots preserve per-unit quantities and require explicit parent/use choices',()=>{
  const db=workspace('sample'),data={count:2,quantity:0.5,unit:'mL',purpose:'store',keepParent:false,longTerm:true};
  assert.throws(()=>event(db,'分装',{...data,keepParent:undefined}),/母本/);
  assert.throws(()=>event(db,'分装',{...data,longTerm:undefined}),/用途/);
  const next=event(db,'分装',data);assert.equal(next.entities[1].quantity,0.5);assert.equal(next.entities[2].unit,'mL');assert.equal(next.entities[0].status,'ended');validate(next);
});
test('batch dosing creates independent personalized records and idempotent retry',()=>{
  const db=workspace('mouse',2),command={type:'batch',key:'batch-a',data:{eventType:'给药',...drug,at:later,items:db.entities.map((e,i)=>({entityId:e.id,dose:5+i}))}};
  const next=execute(db,command);assert.equal(next.events.length-db.events.length,2);assert.deepEqual(next.events.slice(-2).map(e=>e.data.dose),[5,6]);assert.equal(new Set(next.events.slice(-2).map(e=>e.batchId)).size,1);assert.notEqual(next.events.at(-1).id,next.events.at(-2).id);assert.equal(execute(next,command),next);validate(next);
});
test('batch failure never changes original workspace or leaves partial records',()=>{
  const db=workspace('mouse',2),before=structuredClone(db),command={type:'batch',key:'batch-b',data:{eventType:'给药',...drug,at:later,items:db.entities.map((e,i)=>({entityId:e.id,dose:i===1?-1:5}))}};
  assert.throws(()=>execute(db,command),/剂量/);assert.deepEqual(db,before);
  command.data.items[1]={...command.data.items[0]};assert.throws(()=>execute(db,command),/重复/);
});
test('postponing twice and cancelling preserve original time and audit history',()=>{
  let db=workspace();db=execute(db,{type:'plan',data:{entityId:db.entities[0].id,name:'dose',eventType:'给药',at:later}});const id=db.plans[0].id;
  for(const nextAt of ['2026-11-03T10:00:00+08:00','2026-11-04T10:00:00+08:00'])db=execute(db,{type:'plan-update',data:{planId:id,action:'postpone',nextAt,reason:'reschedule'}});
  assert.equal(db.plans[0].scheduledAt,later);assert.equal(db.plans[0].history.length,2);
  assert.throws(()=>execute(db,{type:'plan-update',data:{planId:id,action:'cancel'}}),/原因/);
  db=execute(db,{type:'plan-update',data:{planId:id,action:'cancel',reason:'cancel test'}});assert.equal(db.plans[0].status,'cancelled');assert.equal(db.audit.at(-1).objectId,id);
  assert.throws(()=>event(db,'给药',{...drug,planId:id}),/计划无效/);validate(db);
});
test('postponed plan completes once using the planned template',()=>{
  let db=workspace();db=execute(db,{type:'plan',data:{entityId:db.entities[0].id,name:'dose',eventType:'给药',at:later}});const id=db.plans[0].id;
  db=execute(db,{type:'plan-update',data:{planId:id,action:'postpone',nextAt:'2026-11-03T10:00:00+08:00',reason:'test'}});
  assert.throws(()=>event(db,'体重测量',{value:20,planId:id}),/不一致/);
  db=event(db,'给药',{...drug,planId:id});assert.equal(db.plans[0].status,'completed');assert.equal(db.plans[0].scheduledAt,later);assert.equal(db.events.at(-1).planId,id);
  assert.throws(()=>event(db,'给药',{...drug,planId:id}),/已完成/);validate(db);
});
