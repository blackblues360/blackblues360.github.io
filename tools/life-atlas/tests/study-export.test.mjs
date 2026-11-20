import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,execute,validate} from '../core.mjs';
import {collectStudyReport,studyMembershipCSV,renderStudyReport} from '../study-export.mjs';
import {parseInventoryTable} from '../inventory-import.mjs';
const at='2026-11-01T09:00:00+08:00',join='2026-11-02T09:00:00+08:00',move='2026-11-04T09:00:00+08:00',exit='2026-11-05T09:00:00+08:00',generatedAt='2026-11-10T09:00:00+08:00';
const run=(db,type,data)=>execute(db,{type,data:{at,...data}},'qa');
function setup(){
  let db=run(empty(),'entity',{type:'mouse',name:'M1'});
  for(const name of ['Study A','Study B'])db=run(db,'study',{name,description:'私密项目说明'});
  for(const [studyId,name] of [[db.studies[0].id,'对照组'],[db.studies[0].id,'处理组'],[db.studies[1].id,'其他项目组']])db=run(db,'cohort',{studyId,name});
  return run(db,'membership',{entityId:db.entities[0].id,studyId:db.studies[0].id,cohortId:db.cohorts[0].id,at:join,reason:'最初入组'});
}
const options=db=>({studyId:db.studies[0].id,generatedAt});
const weight=(db,time,value=20,extra={})=>run(db,'event',{entityId:db.entities[0].id,eventType:'体重测量',at:time,value,...extra});

test('missing project, foreign cohort and invalid generation date cannot widen export',()=>{
  const db=setup();assert.throws(()=>collectStudyReport(db,{studyId:'missing'}),/不存在/);assert.throws(()=>collectStudyReport(db,{...options(db),cohortId:db.cohorts[2].id}),/不属于/);assert.throws(()=>collectStudyReport(db,{...options(db),generatedAt:'invalid'}),/时间无效/);
});
test('a new project without groups or mice exports without modifying legacy collections',()=>{
  const db=run(empty(),'study',{name:'空项目'}),before=JSON.stringify(db),report=collectStudyReport(db,options(db));
  assert.equal(report.entities.length,0);assert.equal(report.events.length,0);assert.match(renderStudyReport(db,options(db)),/暂无记录/);assert.equal(studyMembershipCSV(db,options(db)).split('\r\n').length,1);assert.equal(JSON.stringify(db),before);validate(db);
});
test('project events use subject membership, exclude other projects and distinguish inferred attribution',()=>{
  let db=setup();db=run(db,'membership',{entityId:db.entities[0].id,studyId:db.studies[1].id,cohortId:db.cohorts[2].id,at:join});
  db=weight(db,join,20,{studyId:db.studies[1].id});db=weight(db,move,21);
  const report=collectStudyReport(db,options(db));assert.equal(report.events.length,1);assert.equal(report.events[0].event.data.value,21);assert.equal(report.events[0].assignment,'按历史成员有效期归属');assert.equal(report.measurements['体重测量'].length,1);validate(db);
});
test('transfer and exit use inclusive join and exclusive exit boundaries',()=>{
  let db=setup();db=weight(db,at,19);db=weight(db,join,20);db=weight(db,'2026-11-03T09:00:00+08:00',21);
  db=run(db,'membership',{entityId:db.entities[0].id,studyId:db.studies[0].id,cohortId:db.cohorts[1].id,at:move,reason:'转组'});db=weight(db,move,22);
  db=run(db,'membership',{entityId:db.entities[0].id,studyId:db.studies[0].id,cohortId:'',at:exit,reason:'退出'});db=weight(db,exit,23);
  assert.deepEqual(collectStudyReport(db,options(db)).events.map(r=>r.event.data.value),[20,21,22]);assert.deepEqual(collectStudyReport(db,{...options(db),cohortId:db.cohorts[0].id}).events.map(r=>r.event.data.value),[20,21]);assert.equal(collectStudyReport(db,options(db)).currentMemberships.length,0);validate(db);
});
test('corrections and correction chains remain with the original historical group after exit',()=>{
  let db=weight(setup(),join);const original=db.events.at(-1).id,entityId=db.entities[0].id,studyId=db.studies[0].id;
  db=run(db,'membership',{entityId,studyId,cohortId:db.cohorts[1].id,at:move,reason:'转组'});db=weight(db,move,22);const other=db.events.at(-1).id;
  db=run(db,'membership',{entityId,studyId,cohortId:'',at:exit,reason:'退出'});
  db=run(db,'event',{entityId,eventType:'修正记录',correctedFrom:original,at:'2026-11-06T09:00:00+08:00',note:'更正原测量备注'});const correction=db.events.at(-1).id;
  db=run(db,'event',{entityId,eventType:'修正记录',correctedFrom:correction,at:'2026-11-07T09:00:00+08:00',note:'补充更正原因'});
  db=run(db,'event',{entityId,eventType:'修正记录',correctedFrom:other,at:'2026-11-08T09:00:00+08:00',note:'另一组的修正'});
  const report=collectStudyReport(db,{...options(db),cohortId:db.cohorts[0].id});assert.equal(report.events.length,3);assert.ok(report.events.every(r=>r.membership.cohortId===db.cohorts[0].id));assert.equal(report.measurements['体重测量'][0].value,20);assert.doesNotMatch(renderStudyReport(db,{...options(db),cohortId:db.cohorts[0].id,includeNotes:true}),/另一组的修正/);validate(db);
});
test('shared input corrections remain traceable without importing the input entity as a project member',()=>{
  let db=setup();db=run(db,'entity',{type:'cell',subtype:'培养批次',name:'输入细胞'});const cell=db.entities.at(-1);
  db=weight(db,join,20,{relatedId:cell.id});const original=db.events.at(-1).id;
  db=run(db,'event',{entityId:cell.id,eventType:'修正记录',correctedFrom:original,at:move,note:'补充共享事件说明'});
  const report=collectStudyReport(db,options(db));assert.equal(report.entities.length,1);assert.equal(report.events.length,2);assert.equal(report.events[1].entity.id,db.entities[0].id);assert.match(renderStudyReport(db,{...options(db),includeNotes:true}),/输入细胞/);validate(db);
});
test('current-only member CSV does not remove historical events or replace transferred periods',()=>{
  let db=weight(setup(),join);db=run(db,'membership',{entityId:db.entities[0].id,studyId:db.studies[0].id,cohortId:db.cohorts[1].id,at:move,reason:'转组'});db=weight(db,move,22);
  const all=parseInventoryTable(studyMembershipCSV(db,options(db))),current=parseInventoryTable(studyMembershipCSV(db,{...options(db),includeHistory:false}));
  assert.equal(all.rows.length,2);assert.equal(current.rows.length,1);assert.equal(current.rows[0].values[current.headers.indexOf('分组')],'处理组');
  const html=renderStudyReport(db,{...options(db),includeHistory:false});assert.doesNotMatch(html,/成员有效期与转组历史<\/h2>/);assert.match(html,/20 g/);assert.match(html,/22 g/);validate(db);
});
test('an ended mouse can retain valid membership while being counted separately from managed living mice',()=>{
  let db=setup();db=run(db,'event',{entityId:db.entities[0].id,eventType:'实际处置',at:move,method:'测试处置记录',reason:'实验结束'});
  const report=collectStudyReport(db,options(db));assert.equal(report.currentMemberships.length,1);const table=parseInventoryTable(studyMembershipCSV(db,options(db)));assert.equal(table.rows[0].values[table.headers.indexOf('当前实体状态')],'已结束');assert.match(renderStudyReport(db,options(db)),/其中仍在管/);validate(db);
});
test('invalid units stay in raw events but not measurement plots; legacy zero tumor volume is retained',()=>{
  let db=weight(setup(),join);db.events.at(-1).data.unit='kg';
  db=run(db,'event',{entityId:db.entities[0].id,eventType:'肿瘤测量',at:move,method:'手动体积',value:1});db.events.at(-1).data.value=0;
  const report=collectStudyReport(db,options(db));assert.equal(report.measurements['体重测量'].length,0);assert.equal(report.measurements['肿瘤测量'][0].value,0);assert.equal(report.events.length,2);const html=renderStudyReport(db,options(db));assert.match(html,/1 条数值或单位不符合/);assert.match(html,/0 mm³/);assert.match(html,/kg/);
});
test('returning to a previous cohort keeps curve segments separate',()=>{
  let db=weight(setup(),join);db=weight(db,'2026-11-03T09:00:00+08:00',21);const entityId=db.entities[0].id,studyId=db.studies[0].id;
  db=run(db,'membership',{entityId,studyId,cohortId:db.cohorts[1].id,at:move,reason:'转组'});db=run(db,'membership',{entityId,studyId,cohortId:db.cohorts[0].id,at:exit,reason:'回组'});db=weight(db,'2026-11-06T09:00:00+08:00',23);
  const svg=renderStudyReport(db,{...options(db),cohortId:db.cohorts[0].id}).match(/<svg[\s\S]*?<\/svg>/)[0];assert.equal((svg.match(/<circle /g)||[]).length,3);assert.equal((svg.match(/<polyline /g)||[]).length,1);validate(db);
});
test('CSV quotes multiline reasons, blocks formula prefixes and explicitly marks Shanghai timestamps',()=>{
  let db=setup();db.entities[0].name=' \t=1+1';db.memberships[0].reason='第一行,"说明"\n第二行';db.entities[0].attributes.genotype='+SUM(1,2)';
  const csv=studyMembershipCSV(db,{...options(db),includeNotes:true}),table=parseInventoryTable(csv),row=table.rows[0].values,index=name=>table.headers.indexOf(name);
  assert.ok(csv.startsWith('\ufeff'));assert.equal(row[index('小鼠名称')],"' \t=1+1");assert.equal(row[index('当前基因型')],"'+SUM(1,2)");assert.equal(row[index('入组原因')],'第一行,"说明"\n第二行');assert.equal(row[index('入组时间（Asia/Shanghai）')],join);assert.equal(row[index('生成时间（Asia/Shanghai）')],generatedAt);
});
test('optional notes include nested profile snapshots; HTML remains escaped and reports remain readonly',()=>{
  let db=setup();db=run(db,'profile-update',{entityId:db.entities[0].id,at:join,reason:'私密修订原因',attributes:{notes:'私密嵌套备注',strain:'C57'}});db.entities[0].name='<script>bad</script>';
  const before=JSON.stringify(db),html=renderStudyReport(db,options(db));assert.doesNotMatch(html,/私密项目说明|私密嵌套备注|私密修订原因|<script>/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/\[object Object\]/);assert.match(renderStudyReport(db,{...options(db),includeNotes:true}),/私密嵌套备注/);assert.doesNotMatch(studyMembershipCSV(db,options(db)),/入组原因|最初入组/);assert.equal(JSON.stringify(db),before);
});
test('plans never become project actual events and optional report sections can be omitted',()=>{
  let db=weight(setup(),join);db=run(db,'plan',{entityId:db.entities[0].id,name:'未来计划不会变成实际操作',at:'2026-12-01T09:00:00+08:00'});
  const html=renderStudyReport(db,{...options(db),includeMeasurements:false,includeEvents:false});assert.doesNotMatch(html,/未来计划不会变成实际操作|<svg|实际事件与追加修正 ·/);assert.equal(collectStudyReport(db,options(db)).events.length,1);validate(db);
});
