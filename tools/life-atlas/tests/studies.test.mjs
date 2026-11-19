import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,execute,validate} from '../core.mjs';
import {membershipAt} from '../studies.mjs';
const at='2026-11-01T09:00:00+08:00',join='2026-11-02T09:00:00+08:00',move='2026-11-03T09:00:00+08:00';
const run=(db,type,data)=>execute(db,{type,data:{at,...data}},'test-actor');
function setup(){let db=run(empty(),'entity',{type:'mouse',name:'M1'});db=run(db,'entity',{type:'mouse',name:'M2'});db=run(db,'study',{name:'Study A'});db=run(db,'study',{name:'Study B'});for(const [studyId,name] of [[db.studies[0].id,'Control'],[db.studies[0].id,'Treatment'],[db.studies[1].id,'Control']])db=run(db,'cohort',{studyId,name});return db;}

test('same mouse can join multiple projects with independent groups',()=>{
  let db=setup();const entityId=db.entities[0].id;
  for(const cohort of [db.cohorts[0],db.cohorts[2]])db=run(db,'membership',{entityId,studyId:cohort.studyId,cohortId:cohort.id,at:join});
  assert.equal(db.memberships.length,2);assert.ok(membershipAt(db,entityId,db.studies[0].id,move));assert.ok(membershipAt(db,entityId,db.studies[1].id,move));validate(db);
});
test('transfer and exit retain historical intervals and require reasons',()=>{
  let db=setup();const entityId=db.entities[0].id,studyId=db.studies[0].id,old=db.cohorts[0].id,next=db.cohorts[1].id;
  db=run(db,'membership',{entityId,studyId,cohortId:old,at:join});
  assert.throws(()=>run(db,'membership',{entityId,studyId,cohortId:next,at:move}),/原因/);
  db=run(db,'membership',{entityId,studyId,cohortId:next,at:move,reason:'reassign'});
  assert.equal(membershipAt(db,entityId,studyId,join).cohortId,old);assert.equal(membershipAt(db,entityId,studyId,move).cohortId,next);assert.equal(db.memberships[0].exitReason,'reassign');
  db=run(db,'membership',{entityId,studyId,cohortId:'',at:'2026-11-04T09:00:00+08:00',reason:'finish'});assert.equal(membershipAt(db,entityId,studyId),undefined);assert.equal(db.memberships.length,2);validate(db);
});
test('free tags coexist with groups, and removals retain history',()=>{
  let db=setup();const entityId=db.entities[0].id;db=run(db,'membership',{entityId,studyId:db.studies[0].id,cohortId:db.cohorts[0].id,at:join});
  db=run(db,'tag',{entityId,name:'待分型',action:'add',at:join});assert.throws(()=>run(db,'tag',{entityId,name:'待分型',action:'add',at:move}),/已经存在/);
  db=run(db,'tag',{entityId,name:'待分型',action:'remove',at:move});assert.ok(db.entityTags[0].removedAt);assert.equal(db.memberships[0].leftAt,null);
  db=run(db,'tag',{entityId,name:'待分型',action:'add',at:move});assert.equal(db.entityTags.length,2);assert.equal(db.tags.length,1);validate(JSON.parse(JSON.stringify(db)));
});
test('cross-project groups, backdated transfers and overlapping imports fail',()=>{
  let db=setup();const entityId=db.entities[0].id,studyId=db.studies[0].id;
  assert.throws(()=>run(db,'membership',{entityId,studyId,cohortId:db.cohorts[2].id,at:join}),/不属于/);
  db=run(db,'membership',{entityId,studyId,cohortId:db.cohorts[0].id,at:move});assert.throws(()=>run(db,'membership',{entityId,studyId,cohortId:db.cohorts[1].id,at:join,reason:'backdate'}),/顺序/);
  const bad=structuredClone(db);bad.memberships.push({...bad.memberships[0],id:'MB-duplicate',cohortId:db.cohorts[1].id});assert.throws(()=>validate(bad),/重叠/);validate(empty());
});
test('batch project metadata reflects membership at execution time',()=>{
  let db=setup();const entityId=db.entities[0].id,studyId=db.studies[0].id,cohortId=db.cohorts[0].id;
  db=run(db,'membership',{entityId,studyId,cohortId,at:join});
  const command={type:'batch',key:'project-batch',data:{eventType:'体重测量',value:20,at:move,studyId,cohortId,items:[{entityId}]}};
  const next=execute(db,command);assert.equal(next.events.at(-1).studyId,studyId);assert.equal(next.events.at(-1).cohortId,cohortId);validate(next);
  assert.throws(()=>execute(db,{...command,key:'invalid-batch',data:{...command.data,items:[{entityId:db.entities[1].id}]}}),/不属于/);assert.equal(db.events.length,2);
});
