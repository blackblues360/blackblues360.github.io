import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,execute,validate} from '../core.mjs';
import {collectEntityReport,renderEntityReport} from '../reports.mjs';
const at='2026-11-10T10:00:00+08:00',later='2026-11-11T10:00:00+08:00';
const create=()=>execute(empty(),{type:'entity',data:{name:'母本',type:'cell',subtype:'培养批次',at,passage:3}});
const render=(db,id,options={})=>renderEntityReport(db,id,{generatedAt:later,...options});
test('report scope traverses the requested direction without unrelated sibling branches',()=>{
  let db=create();const parent=db.entities[0].id;
  db=execute(db,{type:'event',data:{entityId:parent,eventType:'传代',at:later,count:2,keepParent:true}});
  const child=db.entities[1].id,sibling=db.entities[2].id;
  db=execute(db,{type:'event',data:{entityId:child,eventType:'传代',at:later,count:1,keepParent:true}});
  const grandchild=db.entities[3].id;
  assert.deepEqual(collectEntityReport(db,child).entities.map(e=>e.id),[child]);
  assert.deepEqual(new Set(collectEntityReport(db,child,{scope:'upstream'}).entities.map(e=>e.id)),new Set([parent,child]));
  assert.deepEqual(new Set(collectEntityReport(db,child,{scope:'downstream'}).entities.map(e=>e.id)),new Set([child,grandchild]));
  assert.deepEqual(new Set(collectEntityReport(db,child,{scope:'lineage'}).entities.map(e=>e.id)),new Set([parent,child,grandchild]));
  assert.ok(!collectEntityReport(db,child,{scope:'lineage'}).entities.some(e=>e.id===sibling));
});
test('shared input participation includes the actual event once without adding its profile to lineage',()=>{
  let db=create();const cell=db.entities[0].id;
  db=execute(db,{type:'entity',data:{name:'小鼠',type:'mouse',at}});const mouse=db.entities[1].id;
  db=execute(db,{type:'event',data:{entityId:mouse,eventType:'荷瘤',relatedId:cell,at:later,cellCount:1000000,volume:100,volumeUnit:'μL',site:'皮下'}});
  const report=collectEntityReport(db,mouse,{scope:'lineage'});
  assert.deepEqual(report.entities.map(e=>e.id),[mouse]);assert.equal(report.events.filter(e=>e.type==='荷瘤').length,1);
  assert.match(render(db,mouse),/输入材料/);
});
test('all sample lifecycles and original events survive freeze and thaw report generation',()=>{
  let db=execute(empty(),{type:'entity',data:{name:'样品',type:'sample',at}});const id=db.entities[0].id;
  db=execute(db,{type:'event',data:{entityId:id,eventType:'冻存',at:later,temperature:'-80°C'}});
  db=execute(db,{type:'event',data:{entityId:id,eventType:'解冻',at:'2026-11-12T10:00:00+08:00'}});
  const before=JSON.stringify(db),report=collectEntityReport(db,id);
  assert.equal(report.lifecycles.length,3);assert.equal(report.events.length,3);
  assert.match(render(db,id),/来源生命周期编号/);assert.equal(JSON.stringify(db),before);validate(db);
});
test('plans remain a distinct optional section and cannot become actual events',()=>{
  let db=create();const id=db.entities[0].id;
  db=execute(db,{type:'plan',data:{entityId:id,name:'未来换液计划',eventType:'换液',at:'2026-12-01T10:00:00+08:00'}});
  assert.equal(collectEntityReport(db,id).plans.length,0);
  const report=collectEntityReport(db,id,{includePlans:true});assert.equal(report.plans.length,1);assert.equal(report.events.length,1);
  assert.doesNotMatch(render(db,id),/未来换液计划/);assert.match(render(db,id,{includePlans:true}),/计划记录 · 不代表已发生事件/);
});
test('correction report retains both original and appended reason with an explicit event reference',()=>{
  let db=create();const id=db.entities[0].id,original=db.events[0].id;
  db=execute(db,{type:'event',data:{entityId:id,eventType:'修正记录',at:later,correctedFrom:original,note:'原因：更正备注'}});
  const html=render(db,id);assert.match(html,/追加修正的原事件/);assert.ok(html.includes(original));assert.match(html,/更正备注/);assert.equal(collectEntityReport(db,id).events.length,2);
});
test('notes option removes nested profile and event notes; HTML content is escaped',()=>{
  let db=execute(empty(),{type:'entity',data:{name:'<script>unsafe</script>',type:'cell',subtype:'培养批次',at,attributes:{notes:'私有备注',source:'公共来源'}}});
  const id=db.entities[0].id;db.events[0].note='事件私有备注';db.events[0].data.profile={attributes:{notes:'嵌套私有备注',source:'公共来源'}};
  const html=render(db,id,{includeNotes:false});assert.doesNotMatch(html,/私有备注/);assert.match(html,/公共来源/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/\[object Object\]/);
});
test('legacy unknown date and passage stay unknown with import row provenance',()=>{
  const db=create(),id=db.entities[0].id;db.entities[0].passage=null;
  db.storageHistory.push({entityId:id,location:'旧冻存盒/A1',validFrom:null,validTo:null,source:'legacy_snapshot'});
  db.events[0].inventorySourceName='已有库存.csv';db.events[0].inventorySourceRow=4;
  const html=render(db,id);assert.match(html,/P 未知/);assert.match(html,/原日期未知/);assert.match(html,/已有库存.csv · 原表第 4 行/);assert.match(html,/Asia\/Shanghai/);
});
test('measurement report preserves zero values, units and original times without mutating data',()=>{
  const db=create(),id=db.entities[0].id;db.events.push({...db.events[0],id:'measurement',type:'肿瘤测量',at:later,data:{value:0,unit:'mm³',length:0,width:0}});
  const before=JSON.stringify(db),html=render(db,id);assert.match(html,/小鼠纵向测量/);assert.match(html,/>0<\/td>/);assert.match(html,/mm³/);assert.equal(JSON.stringify(db),before);
});
test('invalid entity or scope cannot silently broaden the export',()=>{
  const db=create();assert.throws(()=>collectEntityReport(db,'missing'),/不存在/);assert.throws(()=>collectEntityReport(db,db.entities[0].id,{scope:'all'}),/范围/);
});
