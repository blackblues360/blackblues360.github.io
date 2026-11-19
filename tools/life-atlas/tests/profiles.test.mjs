import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,execute,age,lifecycle,isCellReference,validate} from '../core.mjs';
import {animalAge} from '../profiles.mjs';
const at='2026-11-01T10:00:00+08:00',later='2026-11-02T10:00:00+08:00';
const run=(db,type,data)=>execute(db,{type,data:{at,...data}},'tester');
const mouse=()=>run(empty(),'entity',{type:'mouse',name:'M1',attributes:{strain:'C57BL/6J',sex:'雌',genotype:'未知',birthDate:'2026-10-01',ethicsId:'TEST-001',source:'测试来源'}});

test('animal age and management D0 use independent real dates',()=>{
  const db=mouse(),e=db.entities[0];assert.equal(age(db,e.id,at),'D0');assert.equal(animalAge(e,at),'4 周 3 天（31 天）');assert.equal(lifecycle(db,e.id).startAt,at);assert.equal(e.attributes.birthDate,'2026-10-01');
  assert.equal(animalAge({attributes:{}},at),'未知');assert.equal(animalAge({attributes:{birthDate:'2024-02-29'}},'2024-03-01T00:01:00+08:00'),'0 周 1 天（1 天）');validate(db);
});
test('future birth, impossible dates, unsupported sex and negative passage are rejected',()=>{
  const input={type:'mouse',name:'M1',at};
  for(const attributes of [{birthDate:'2026-11-02'},{birthDate:'2026-02-30'},{sex:'invalid'}])assert.throws(()=>run(empty(),'entity',{...input,attributes}),/日期|选项/);
  assert.throws(()=>run(empty(),'entity',{type:'cell',name:'C1',passage:-1}),/非负整数/);
});
test('cell-line reference is separate from active culture and cannot run experiments',()=>{
  const db=run(empty(),'entity',{type:'cell',subtype:'细胞系',name:'B16',attributes:{species:'小鼠',cellType:'肿瘤细胞',defaultConditions:'测试培养条件'}}),id=db.entities[0].id;
  assert.equal(age(db,id,later),'基础档案');assert.equal(lifecycle(db,id).startAt,null);
  assert.throws(()=>run(db,'event',{entityId:id,eventType:'培养',at:later}),/基础档案/);
  assert.throws(()=>run(db,'plan',{entityId:id,eventType:'培养',name:'invalid',at:later}),/培养批次/);validate(db);
});
test('line association, P number and culture conditions survive passage, freeze and revival',()=>{
  let db=run(empty(),'entity',{type:'cell',subtype:'细胞系',name:'B16',attributes:{defaultConditions:'测试条件'}});const lineId=db.entities[0].id;
  db=run(db,'entity',{type:'cell',subtype:'培养批次',name:'P3',passage:3,cellLineId:lineId});const culture=db.entities[1];assert.equal(culture.attributes.conditions,'测试条件');assert.equal(db.relations[0].parentId,lineId);
  db=run(db,'event',{entityId:culture.id,eventType:'传代',keepParent:false,count:1,conditions:'新条件',at:later});const child=db.entities.at(-1);
  db=run(db,'event',{entityId:child.id,eventType:'冻存',count:1,quantity:1000000,unit:'cells',cryoprotectant:'测试冻存液',at:'2026-11-03T10:00:00+08:00'});const vial=db.entities.at(-1);
  db=run(db,'event',{entityId:vial.id,eventType:'复苏',at:'2026-11-04T10:00:00+08:00'});const revived=db.entities.at(-1);
  assert.equal(revived.cellLineId,lineId);assert.equal(revived.passage,4);assert.equal(revived.attributes.conditions,'新条件');assert.equal(age(db,revived.id,'2026-11-04T10:00:00+08:00'),'D0');validate(JSON.parse(JSON.stringify(db)));
});
test('profile revisions preserve original event, identity, lifecycle and prior values',()=>{
  const db=mouse(),id=db.entities[0].id,before=structuredClone(db);
  assert.throws(()=>run(db,'profile-update',{entityId:id,attributes:{source:'更正来源'}}),/原因/);
  const revised=run(db,'profile-update',{entityId:id,attributes:{source:'更正来源'},reason:'核对原始记录',at:later});
  assert.deepEqual(revised.events[0],before.events[0]);assert.deepEqual(revised.lifecycles,before.lifecycles);assert.equal(revised.entities[0].code,before.entities[0].code);assert.equal(revised.events.at(-1).data.before.attributes.source,'测试来源');assert.equal(revised.events.at(-1).data.after.attributes.source,'更正来源');assert.equal(revised.audit.at(-1).action,'profile-update');validate(revised);
});
test('genotyping updates current profile while preserving each independent result',()=>{
  let db=mouse();const id=db.entities[0].id;
  for(const [result,date] of [['WT',later],['HET','2026-11-03T10:00:00+08:00']])db=run(db,'event',{entityId:id,eventType:'基因分型',method:'测试方法',result,at:date});
  assert.equal(db.entities[0].attributes.genotype,'HET');assert.equal(db.events.at(-2).data.result,'WT');assert.equal(db.events.at(-1).data.previousGenotype,'WT');assert.equal(db.entities.length,1);validate(db);
});
test('old records remain readable and invalid profile/line snapshots cannot restore',()=>{
  const db=mouse();delete db.entities[0].attributes;delete db.events[0].data.profile;validate(db);
  let bad=structuredClone(db);bad.entities[0].cellLineId='missing';assert.throws(()=>validate(bad),/细胞系/);
  bad=structuredClone(db);bad.events[0].data.profile='invalid';assert.throws(()=>validate(bad),/快照/);
  bad=structuredClone(db);bad.entities[0].attributes={birthDate:'2099-01-01'};assert.throws(()=>validate(bad),/不能晚于/);
});
test('profile correction does not prevent recording an earlier biological event',()=>{
  let db=mouse();const id=db.entities[0].id;
  db=run(db,'profile-update',{entityId:id,attributes:{source:'补充'},reason:'补记档案',at:'2026-11-03T10:00:00+08:00'});
  db=run(db,'event',{entityId:id,eventType:'体重测量',value:20,at:later});assert.equal(db.events.at(-1).at,later);validate(db);
});
test('current culture conditions update through events and feed later branches',()=>{
  let db=run(empty(),'entity',{type:'cell',subtype:'培养批次',name:'C1',attributes:{conditions:'原条件'}});const id=db.entities[0].id;
  db=run(db,'event',{entityId:id,eventType:'换液',conditions:'核对后的条件',at:later});assert.equal(db.events.at(-1).data.previousConditions,'原条件');
  db=run(db,'event',{entityId:id,eventType:'传代',keepParent:true,count:1,at:'2026-11-03T10:00:00+08:00'});assert.equal(db.entities.at(-1).attributes.conditions,'核对后的条件');validate(db);
  assert.throws(()=>run(db,'profile-update',{entityId:id,attributes:{conditions:'核对后的条件',notes:''},reason:'无实际变动'}),/没有变化/);
});
test('legacy timed cell-line records keep their real lifecycle and remain operable',()=>{
  let db=run(empty(),'entity',{type:'cell',subtype:'培养批次',name:'旧版正在培养的细胞系',passage:2});
  db.entities[0].subtype='细胞系';const id=db.entities[0].id;
  assert.equal(isCellReference(db,db.entities[0]),false);assert.equal(age(db,id,later),'D1');
  db=run(db,'event',{entityId:id,eventType:'换液',conditions:'核对旧记录条件',at:later});
  db=run(db,'plan',{entityId:id,eventType:'换液',name:'继续观察',at:'2026-11-04T10:00:00+08:00'});
  db=run(db,'event',{entityId:id,eventType:'传代',keepParent:true,count:1,at:'2026-11-03T10:00:00+08:00'});
  assert.equal(db.entities.at(-1).cellLineId,id);assert.equal(db.entities.at(-1).attributes.conditions,'核对旧记录条件');assert.equal(db.entities.at(-1).passage,3);assert.equal(lifecycle(db,id).startAt,at);validate(db);
});
