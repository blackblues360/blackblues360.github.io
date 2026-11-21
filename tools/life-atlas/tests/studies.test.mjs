import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,execute,validate} from '../core.mjs';
import {membershipAt} from '../studies.mjs';
const at='2026-11-01T09:00:00+08:00',join='2026-11-02T09:00:00+08:00',move='2026-11-03T09:00:00+08:00';
const run=(db,type,data)=>execute(db,{type,data:{at,...data}},'test-actor');
const state=(db,action,reason='项目管理原因',at='2026-11-10T09:00:00+08:00')=>run(db,'study-state',{studyId:db.studies[0].id,action,reason,at});
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

test('archive preserves members, events and lifecycle and appends state history and audit',()=>{
  let db=setup();const studyId=db.studies[0].id,entityId=db.entities[0].id;db=run(db,'membership',{studyId,entityId,cohortId:db.cohorts[0].id,at:join});db=run(db,'event',{entityId,studyId,eventType:'体重测量',at:move,value:20});
  const before=structuredClone(db),archived=state(db,'archive');assert.equal(archived.studies[0].status,'archived');assert.deepEqual(archived.events,before.events);assert.deepEqual(archived.memberships,before.memberships);assert.deepEqual(archived.lifecycles,before.lifecycles);assert.deepEqual(archived.entities,before.entities);assert.equal(archived.audit.at(-1).action,'study-state');assert.equal(archived.studies[0].stateHistory[0].actor,'test-actor');assert.equal(db.studies[0].status,undefined);validate(archived);validate(JSON.parse(JSON.stringify(archived)));
});
test('archive blocks group and member changes and project-linked new events atomically',()=>{
  let db=setup();const studyId=db.studies[0].id,entityId=db.entities[0].id;db=run(db,'membership',{studyId,entityId,cohortId:db.cohorts[0].id,at:join});db=state(db,'archive');const before=JSON.stringify(db);
  assert.throws(()=>run(db,'cohort',{studyId,name:'新组'}),/已归档/);assert.throws(()=>run(db,'membership',{entityId,studyId,cohortId:'',at:move,reason:'退出'}),/已归档/);assert.throws(()=>run(db,'event',{entityId,studyId,eventType:'体重测量',at:'2026-11-11T09:00:00+08:00',value:21}),/已归档/);assert.equal(JSON.stringify(db),before);
});
test('restore requires reason, retains archive history and enables edits again',()=>{
  let db=state(setup(),'archive');db=state(db,'restore','重新开始','2026-11-11T09:00:00+08:00');assert.equal(db.studies[0].status,'active');assert.equal(db.studies[0].archivedAt,null);assert.deepEqual(db.studies[0].stateHistory.map(h=>h.action),['archive','restore']);db=run(db,'cohort',{studyId:db.studies[0].id,name:'恢复后新组'});validate(db);
});
test('invalid and repeated state transitions fail without changing original data',()=>{
  const db=setup(),before=JSON.stringify(db);assert.throws(()=>state(db,'restore'),/状态已变化/);assert.throws(()=>state(db,'archive',' '),/原因/);assert.throws(()=>state(db,'bad'),/操作无效/);assert.throws(()=>state(db,'archive','原因','2026-10-01T09:00:00+08:00'),/早于/);const archived=state(db,'archive');assert.throws(()=>state(archived,'archive'),/状态已变化/);assert.equal(JSON.stringify(db),before);
});
test('backup validation rejects malformed archive metadata and keeps legacy projects readable',()=>{
  validate(setup());const db=state(setup(),'archive');for(const change of [s=>s.status='bad',s=>s.archivedAt=null,s=>s.stateHistory[0].reason='',s=>s.stateHistory[0].action='restore',s=>s.stateHistory[0].at='invalid']){const bad=structuredClone(db);change(bad.studies[0]);assert.throws(()=>validate(bad),/项目/);}
});
test('archive does not stop unrelated mouse records, other projects or appended corrections',()=>{
  let db=setup();const entityId=db.entities[0].id,studyId=db.studies[0].id;db=run(db,'membership',{entityId,studyId,cohortId:db.cohorts[0].id,at:join});db=run(db,'event',{entityId,studyId,eventType:'体重测量',at:move,value:20});const eventId=db.events.at(-1).id;db=state(db,'archive');db=run(db,'event',{entityId,eventType:'修正记录',correctedFrom:eventId,at:'2026-11-11T09:00:00+08:00',note:'补充说明'});db=run(db,'event',{entityId,eventType:'体重测量',at:'2026-11-12T09:00:00+08:00',value:21});db=run(db,'cohort',{studyId:db.studies[1].id,name:'另一项目新组'});validate(db);
});
