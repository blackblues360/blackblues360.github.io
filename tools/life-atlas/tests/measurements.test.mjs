import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,execute,validate} from '../core.mjs';
import {cohortMeasurements,measurementSeries,measurementCSV,measurementsPage} from '../measurements.mjs';
const at='2026-11-01T09:00:00+08:00',join='2026-11-02T09:00:00+08:00',move='2026-11-04T09:00:00+08:00';
const run=(db,type,data)=>execute(db,{type,data:{at,...data}},'qa');
function setup(){
  let db=run(empty(),'entity',{type:'mouse',name:'M1'});
  for(const name of ['Study A','Study B'])db=run(db,'study',{name});
  for(const [studyId,name] of [[db.studies[0].id,'A'],[db.studies[0].id,'B'],[db.studies[1].id,'C']])db=run(db,'cohort',{studyId,name});
  db=run(db,'membership',{entityId:db.entities[0].id,studyId:db.studies[0].id,cohortId:db.cohorts[0].id,at:join});
  return db;
}
const metric=(db,at,value=20,extra={})=>run(db,'event',{entityId:db.entities[0].id,eventType:'体重测量',value,at,...extra});
const filter=db=>({studyId:db.studies[0].id,eventType:'体重测量'});

test('measurements use group membership when measured, retaining transferred and exited history',()=>{
  let db=setup();db=metric(db,at,19);db=metric(db,join,20);db=metric(db,'2026-11-03T09:00:00+08:00',21);
  db=run(db,'membership',{entityId:db.entities[0].id,studyId:db.studies[0].id,cohortId:db.cohorts[1].id,at:move,reason:'transfer'});
  db=metric(db,move,22);
  db=run(db,'membership',{entityId:db.entities[0].id,studyId:db.studies[0].id,cohortId:'',at:'2026-11-05T09:00:00+08:00',reason:'exit'});
  db=metric(db,'2026-11-05T09:00:00+08:00',23);
  assert.deepEqual(cohortMeasurements(db,{...filter(db),cohortId:db.cohorts[0].id}).map(p=>p.value),[20,21]);
  assert.deepEqual(cohortMeasurements(db,{...filter(db),cohortId:db.cohorts[1].id}).map(p=>p.value),[22]);validate(db);
});
test('explicit project attribution excludes other studies; unassigned records use membership intervals',()=>{
  let db=setup();db=run(db,'membership',{entityId:db.entities[0].id,studyId:db.studies[1].id,cohortId:db.cohorts[2].id,at:join});
  db=metric(db,join,20,{studyId:db.studies[1].id,cohortId:db.cohorts[2].id});db=metric(db,move,21);
  assert.deepEqual(cohortMeasurements(db,filter(db)).map(p=>p.value),[21]);
  assert.deepEqual(cohortMeasurements(db,{studyId:db.studies[1].id}).map(p=>p.value),[20,21]);
  assert.equal(cohortMeasurements(db,filter(db))[0].assignment,'按历史成员有效期归属');
});
test('invalid values, unit mismatches, wrong groups and non-subject participation never become points',()=>{
  let db=metric(setup(),join);const original=db.events.at(-1);
  for(const [value,unit] of [['20','g'],[NaN,'g'],[-1,'g'],[20,'kg'],[undefined,'g']]){
    const copy=structuredClone(db);copy.events.at(-1).data={value,unit};assert.deepEqual(cohortMeasurements(copy,filter(copy)),[]);
  }
  assert.deepEqual(cohortMeasurements(db,{...filter(db),cohortId:db.cohorts[2].id}),[]);
  assert.deepEqual(cohortMeasurements(db,{...filter(db),eventType:'给药'}),[]);
  const copy=structuredClone(db);copy.events.at(-1).participants[0].role='input';copy.events.at(-1).entityIds.unshift('missing');assert.deepEqual(cohortMeasurements(copy,filter(copy)),[]);
  assert.equal(original.data.value,20);
});
test('returning to a previous group starts a separate curve segment',()=>{
  let db=metric(setup(),join);const entityId=db.entities[0].id,studyId=db.studies[0].id;
  db=run(db,'membership',{entityId,studyId,cohortId:db.cohorts[1].id,at:move,reason:'transfer'});
  db=run(db,'membership',{entityId,studyId,cohortId:db.cohorts[0].id,at:'2026-11-05T09:00:00+08:00',reason:'return'});
  db=metric(db,'2026-11-06T09:00:00+08:00',22);
  const points=cohortMeasurements(db,{...filter(db),cohortId:db.cohorts[0].id});assert.equal(measurementSeries(points).length,2);
  assert.equal(measurementSeries([{...points[0],lifecycleId:'a'},{...points[0],lifecycleId:'b'}]).length,2);validate(db);
});
test('append-only corrections mark original values without replacing them',()=>{
  let db=metric(setup(),join);const eventId=db.events.at(-1).id;
  db=run(db,'event',{entityId:db.entities[0].id,eventType:'修正记录',correctedFrom:eventId,note:'核对记录',at:move});
  const points=cohortMeasurements(db,filter(db));assert.equal(points.length,1);assert.equal(points[0].value,20);assert.deepEqual(points[0].correctionIds,[db.events.at(-1).id]);
  assert.match(measurementsPage(db,filter(db)),/有追加修正/);validate(db);
});
test('tumor data preserve explicit method, raw dimensions, time and event IDs in CSV',()=>{
  let db=setup();db=run(db,'event',{entityId:db.entities[0].id,eventType:'肿瘤测量',method:'长径×短径²/2',length:10,width:4,at:join});
  const points=cohortMeasurements(db,{...filter(db),eventType:'肿瘤测量'}),csv=measurementCSV(points);
  assert.equal(points[0].value,80);assert.equal(points[0].unit,'mm³');assert.match(csv,/长径×短径²\/2/);assert.ok(csv.includes(db.events.at(-1).id));assert.ok(csv.includes(join));assert.match(csv,/"10","4"/);validate(db);
});
test('chart is read-only, escapes user text, and places points by elapsed real time',()=>{
  let db=metric(setup(),join);db=metric(db,'2026-11-03T09:00:00+08:00',21);db=metric(db,'2026-11-12T09:00:00+08:00',22);
  db.entities[0].name='<script>alert(1)</script>';const before=structuredClone(db),html=measurementsPage(db,filter(db));
  assert.ok(html.includes('cx="160"'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.match(html,/UTC\+8/);assert.deepEqual(db,before);
  assert.match(measurementsPage(setup(),filter(db)),/暂无此类有效测量/);assert.equal(measurementsPage(empty()),'');
});
test('CSV protects spreadsheet formulas, quotes and multiline names',()=>{
  const db=metric(setup(),join),points=cohortMeasurements(db,filter(db));points[0].name=' =HYPERLINK("x")\nline';
  const csv=measurementCSV(points);assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes('"\' =HYPERLINK(""x"")\nline"'));
});
