import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,execute} from '../core.mjs';
import {collectStudyImage} from '../study-png.mjs';
const at='2026-11-01T09:00:00+08:00',generatedAt='2026-11-10T09:00:00+08:00';
const run=(db,type,data)=>execute(db,{type,data:{at,...data}},'qa');
function setup(){
  let db=run(empty(),'entity',{type:'mouse',name:'PNG小鼠'});
  db=run(db,'study',{name:'PNG项目',description:'私密说明'});const studyId=db.studies[0].id;
  for(const name of ['对照组','处理组'])db=run(db,'cohort',{studyId,name});
  return run(db,'membership',{entityId:db.entities[0].id,studyId,cohortId:db.cohorts[0].id,reason:'初次原因'});
}
const opts=db=>({studyId:db.studies[0].id,generatedAt});
test('project overview handles an empty project and rejects invalid scope or time',()=>{
  const db=run(empty(),'study',{name:'空项目'}),data=collectStudyImage(db,opts(db));assert.equal(data.currentCount,0);assert.deepEqual(data.rows[0].lines,[]);
  assert.throws(()=>collectStudyImage(db,{studyId:'missing'}),/不存在/);assert.throws(()=>collectStudyImage(db,{...opts(db),cohortId:'foreign'}),/不属于/);assert.throws(()=>collectStudyImage(db,{...opts(db),generatedAt:'bad'}),/时间无效/);
});
test('transfers preserve original measurement groups and deduplicate project historical mice',()=>{
  let db=setup();const entityId=db.entities[0].id,studyId=db.studies[0].id;
  db=run(db,'event',{entityId,eventType:'体重测量',value:20});
  db=run(db,'membership',{entityId,studyId,cohortId:db.cohorts[1].id,at:'2026-11-04T09:00:00+08:00',reason:'转组原因'});
  const data=collectStudyImage(db,opts(db));assert.equal(data.historicalCount,1);assert.equal(data.currentCount,1);assert.match(data.rows[0].lines[0],/当前有效 0 只.*体重 1 条/);assert.match(data.rows[0].lines[1],/当前有效 1 只.*体重 0 条/);
  const past=collectStudyImage(db,{...opts(db),cohortId:db.cohorts[0].id});assert.equal(past.currentCount,0);assert.equal(past.historicalCount,1);assert.equal(past.rows[2].lines.length,1);
});
test('ended mice remain valid members but are not counted as managed',()=>{
  let db=setup();db=run(db,'event',{entityId:db.entities[0].id,eventType:'实际处置',at:'2026-11-03T09:00:00+08:00',method:'测试',reason:'实验结束'});
  const data=collectStudyImage(db,opts(db));assert.equal(data.currentCount,1);assert.match(data.rows[0].lines[0],/当前有效 1 只 · 其中在管 0 只/);assert.match(data.rows[1].lines[0],/已结束/);
});
test('overview note and history controls are read only and do not change event scope',()=>{
  const db=setup(),before=JSON.stringify(db),data=collectStudyImage(db,opts(db)),privateData=collectStudyImage(db,{...opts(db),includeNotes:true}),current=collectStudyImage(db,{...opts(db),includeHistory:false});
  assert.doesNotMatch(JSON.stringify(data),/私密说明|初次原因/);assert.match(privateData.description,/私密说明/);assert.match(JSON.stringify(privateData.rows),/初次原因/);assert.equal(current.rows.length,2);assert.equal(current.eventCount,data.eventCount);assert.equal(JSON.stringify(db),before);
});
