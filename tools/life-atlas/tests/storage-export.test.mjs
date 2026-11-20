import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,execute,validate} from '../core.mjs';
import {collectStorageInventory,storageInventoryCSV,renderStorageReport} from '../storage-export.mjs';
import {parseInventoryTable} from '../inventory-import.mjs';
const at='2026-11-01T10:00:00+08:00',later='2026-11-02T10:00:00+08:00',last='2026-11-03T10:00:00+08:00';
const run=(db,type,data)=>execute(db,{type,data:{at,...data}});
const stock=(db,extra={})=>run(db,'inventory-register',{name:'已有细胞',location:'LN01/A/01/A1',...extra});
const box={kind:'sample',facility:'Lab',room:'R1',equipment:'Freezer',rack:'Rack',code:'B1',name:'样品盒',rows:2,columns:12};

test('empty and legacy exports are readonly and preserve the default 9x9 box',()=>{
  const db=empty(),before=JSON.stringify(db),report=collectStorageInventory(db);
  assert.equal(report.length,1);assert.equal(report[0].cells.length,81);assert.equal(report[0].occupied,0);assert.equal(report[0].empty,81);assert.equal(report[0].records.length,0);
  assert.equal(collectStorageInventory(db,{includeEmpty:true})[0].records.length,81);assert.equal(JSON.stringify(db),before);
});
test('custom sample box coordinates use row-major numeric column order',()=>{
  let db=run(empty(),'storage-box',box);const b=db.storageBoxes.at(-1);
  db=run(db,'entity',{name:'样品',type:'sample',dormant:true,location:b.path+'/B12'});
  const result=collectStorageInventory(db,{boxId:b.id,includeEmpty:true})[0];assert.equal(result.cells[9].coordinate,'A10');assert.equal(result.cells.at(-1).coordinate,'B12');assert.equal(result.records.at(-1).name,'样品');assert.equal(result.empty,23);assert.equal(result.occupied,1);validate(db);
});
test('registration time cannot become unknown freeze date or legacy position start',()=>{
  const db=stock(empty());delete db.storageHistory;const before=JSON.stringify(db),c=collectStorageInventory(db)[0].records[0];
  assert.equal(c.frozenDate,'未知');assert.equal(c.passage,'P 未知');assert.equal(c.storedAt,'未知');assert.match(c.timeSource,/未知/);assert.equal(JSON.stringify(db),before);
});
test('physical freeze date, location entry and registration retain their separate meanings',()=>{
  let db=stock(empty(),{passage:0,attributes:{frozenDate:'2020-02-29',source:'旧台账'}});const id=db.entities[0].id;
  db=run(db,'event',{entityId:id,eventType:'转移',location:'LN01/A/01/A2',at:later});
  const c=collectStorageInventory(db)[0].records[0];assert.equal(c.frozenDate,'2020-02-29');assert.equal(c.storedAt,'2026-11-02T10:00:00+08:00');assert.equal(c.passage,'P0');assert.equal(c.coordinate,'A2');validate(db);
});
test('taken-out, revived and external-location units cannot count as current box occupants',()=>{
  let db=stock(empty(),{code:'OLD-1'});const first=db.entities[0].id;
  db=stock(db,{code:'OLD-2',location:'LN01/A/01/A2'});const second=db.entities[1].id;
  db=run(db,'event',{entityId:first,eventType:'取出',reason:'实验前取出',at:later});
  db=run(db,'event',{entityId:second,eventType:'复苏',at:last});
  db=run(db,'entity',{type:'sample',name:'未分配到盒的样品',location:'冰箱隔板'});
  const report=collectStorageInventory(db)[0];assert.equal(report.occupied,0);assert.equal(report.records.length,0);assert.equal(report.empty,81);validate(db);
});
test('all-box scope and nested paths match the deepest box without double counting',()=>{
  let db=stock(empty());db=run(db,'storage-box',{...box,facility:'LN01',room:'A',equipment:'01',rack:'nested',code:'S'});const b=db.storageBoxes.at(-1);
  db=run(db,'entity',{name:'嵌套样品',type:'sample',dormant:true,location:b.path+'/A1'});
  const all=collectStorageInventory(db,{scope:'all'});assert.deepEqual(all.map(v=>v.occupied),[1,1]);assert.equal(collectStorageInventory(db,{boxId:b.id})[0].records[0].name,'嵌套样品');validate(db);
});
test('CSV preserves units, quoted multiline text and timezone while blocking formula prefixes',()=>{
  const db=stock(empty(),{quantity:1000000,unit:'cells',attributes:{notes:'第一行,有逗号\n第二行"引号"',source:'原台账'}});db.entities[0].name=' \t=1+1';db.entities[0].attributes.source='+SUM(1,2)';
  const csv=storageInventoryCSV(db,{generatedAt:'2026-11-19T20:00:00Z',includeNotes:true}),table=parseInventoryTable(csv),row=table.rows[0].values,index=name=>table.headers.indexOf(name);
  assert.ok(csv.startsWith('\ufeff'));assert.equal(row[index('实体名称')],"' \t=1+1");assert.equal(row[index('来源')],"'+SUM(1,2)");assert.equal(row[index('档案备注')],'第一行,有逗号\n第二行"引号"');assert.equal(row[index('当前数量')],'1000000');assert.equal(row[index('单位')],'cells');assert.equal(row[index('生成时间（Asia/Shanghai）')],'2026-11-20T04:00:00+08:00');
});
test('note selection affects CSV and report; user HTML cannot create markup',()=>{
  const db=stock(empty(),{name:'<script>bad</script>',attributes:{notes:'隐藏的档案备注'}});
  assert.doesNotMatch(storageInventoryCSV(db),/隐藏的档案备注|档案备注/);assert.match(storageInventoryCSV(db,{includeNotes:true}),/隐藏的档案备注/);
  const html=renderStorageReport(db);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/隐藏的档案备注/);assert.match(renderStorageReport(db,{includeNotes:true}),/隐藏的档案备注/);
});
test('26x26 layout splits into nine readable panels and covers every slot once',()=>{
  const db=run(empty(),'storage-box',{...box,rows:26,columns:26}),b=db.storageBoxes.at(-1),html=renderStorageReport(db,{boxId:b.id});
  assert.equal((html.match(/class="report-storage-grid"/g)||[]).length,9);assert.equal((html.match(/<b>[A-Z]\d+<\/b>/g)||[]).length,676);assert.match(html,/<b>Z26<\/b>/);assert.match(html,/空位 676/);assert.doesNotMatch(html,/min-width/);
});
test('freeze event fallback retains actual date, zero quantity and cell-line reference',()=>{
  let db=run(empty(),'entity',{type:'cell',subtype:'细胞系',name:'来源细胞系'});const line=db.entities[0];
  db=run(db,'entity',{type:'cell',subtype:'培养批次',name:'培养',passage:2,cellLineId:line.id});const id=db.entities.at(-1).id;
  db=run(db,'event',{entityId:id,eventType:'冻存',at:later,quantity:100,unit:'cells',cryoprotectant:'冻存液',temperature:'-80°C'});const vial=db.entities.at(-1);
  db=run(db,'event',{entityId:vial.id,eventType:'转移',location:'LN01/A/01/B2',at:last});delete db.entities.at(-1).attributes.frozenDate;db.entities.at(-1).quantity=0;
  const c=collectStorageInventory(db)[0].records[0];assert.equal(c.frozenDate,'2026-11-02');assert.equal(c.quantity,0);assert.equal(c.passage,'P2');assert.equal(c.storedAt,'2026-11-03T10:00:00+08:00');assert.equal(c.cellLine,`${line.name} · ${line.code}`);
});
test('invalid scope and explicit missing box cannot silently widen export',()=>{
  assert.throws(()=>collectStorageInventory(empty(),{scope:'everything'}),/范围/);assert.throws(()=>collectStorageInventory(empty(),{boxId:'missing'}),/不存在/);
});
test('inventory file provenance remains in exports without treating it as a new freeze event',()=>{
  const db=stock(empty());db.events[0].inventorySourceName='旧台账.csv';db.events[0].inventorySourceRow=4;
  const table=parseInventoryTable(storageInventoryCSV(db)),row=table.rows[0].values;
  assert.equal(row[table.headers.indexOf('库存导入文件')],'旧台账.csv');assert.equal(row[table.headers.indexOf('原表行号')],'4');assert.equal(row[table.headers.indexOf('实际冻存日期')],'未知');assert.match(renderStorageReport(db),/旧台账.csv · 原表第 4 行/);
});
