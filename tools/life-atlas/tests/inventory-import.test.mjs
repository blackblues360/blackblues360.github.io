import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,execute,validate} from '../core.mjs';
import {parseInventoryTable,suggestInventoryMapping,previewInventoryImport,inventoryTemplate} from '../inventory-import.mjs';
const at='2026-11-02T10:00:00+08:00';
const options=db=>({boxId:db.storageBoxes?.[0].id||'BOX-LN01-A-01',duplicates:'error',at});
const preview=(db,text,extra={})=>{const table=parseInventoryTable(text);return previewInventoryImport(db,table,suggestInventoryMapping(table.headers),{...options(db),...extra});};
const text='细胞名称,管号,格位,P数,实际冻存日期\nB16,OLD-1,A1,P3,2020/2/29\nMutuDC,OLD-2,A2,未知,未知';
const command=(p,extra={})=>({type:'inventory-import',key:'IMPORT-test',data:{at,items:p.items,skippedRows:p.skippedRows,sourceName:'旧库存.csv',...extra}});

test('CSV supports BOM, quoted commas, multiline cells and escaped quotes with physical source lines',()=>{
  const table=parseInventoryTable('\ufeff细胞名称,格位,备注\r\nB16,A1,"一行,两行\r\n引号""内容"""\r\nMutuDC,A2,末行');
  assert.equal(table.rows[0].values[2],'一行,两行\n引号"内容"');assert.deepEqual(table.rows.map(r=>r.line),[2,4]);
});
test('Excel paste and semicolon files use their own separators and preserve empty cells',()=>{
  const table=parseInventoryTable('名称\t管号\t坐标\tP\nB16\t\tA1\t0\nMutuDC\tID2\tA2\t');
  assert.equal(table.rows[0].values[1],'');assert.equal(table.rows[1].values[3],'');
  assert.equal(parseInventoryTable('名称;坐标\nB16;A1').rows[0].values[1],'A1');
});
test('malformed quotes, column overflow and oversized input never produce partial imports',()=>{
  for(const input of ['名称,坐标\n"B16,A1','名称,坐标\n"B16"extra,A1','名称,坐标\nB16,A1,extra','名称,坐标', 'x'.repeat(2000001)])assert.throws(()=>parseInventoryTable(input));
  assert.throws(()=>parseInventoryTable('名称,坐标\n'+Array.from({length:501},(_,i)=>`B${i},A1`).join('\n')),/500/);
  assert.ok(inventoryTemplate().startsWith('\ufeff'));assert.match(inventoryTemplate(),/实际冻存日期/);
});
test('automatic mapping normalizes Chinese fields, P numbers, dates and split row/column coordinates',()=>{
  const db=empty(),before=structuredClone(db),p=preview(db,'名称\t行\t列\t传代次数\t冻存日期\nB16\t1\t01\tP0\t2020年2月29日\nMutuDC\tB\t2\tN/A\t');
  assert.equal(p.errors.length,0);assert.equal(p.items[0].data.location,'LN01/A/01/A1');assert.equal(p.items[0].data.passage,0);assert.equal(p.items[0].data.attributes.frozenDate,'2020-02-29');assert.equal(p.items[1].data.passage,null);assert.equal(p.items[1].data.location,'LN01/A/01/B2');assert.deepEqual(db,before);
  const lineNames=preview(db,'细胞系,格位\nB16,A1');assert.equal(lineNames.errors.length,0);assert.equal(lineNames.items[0].data.name,'B16');assert.equal(lineNames.items[0].data.cellLineId,undefined);
});
test('mapping requires distinct valid columns and consistent combined/split coordinates',()=>{
  const table=parseInventoryTable('a,b,c\nB16,A1,A2'),db=empty();
  assert.throws(()=>previewInventoryImport(db,table,{name:0,coordinate:0},options(db)),/同一列/);
  assert.throws(()=>previewInventoryImport(db,table,{name:0,coordinate:7},options(db)),/不存在/);
  assert.throws(()=>previewInventoryImport(db,table,{name:0},options(db)),/格位/);
  assert.ok(preview(db,'名称,格位,行,列\nB16,A1,B,2').errors.length);
});
test('duplicate codes or positions within a file flag both source rows',()=>{
  const p=preview(empty(),'名称,管号,格位\nB16,ONE,A1\nMutuDC,ONE,A2\nOther,TWO,A1');
  assert.equal(p.errors.length,3);assert.ok(p.rows[0].errors.some(e=>e.includes('第 3 行')));assert.ok(p.rows[0].errors.some(e=>e.includes('第 4 行')));assert.equal(p.items.length,0);
});
test('existing stock can only be skipped after matching provided facts; it is never overwritten',()=>{
  let db=execute(empty(),{type:'inventory-register',data:{at,name:'B16',code:'OLD-1',location:'LN01/A/01/A1',passage:3,attributes:{frozenDate:'2020-02-29'}}});const before=structuredClone(db);
  assert.equal(preview(db,text).errors.length,1);
  const p=preview(db,text,{duplicates:'skip-matching'});assert.equal(p.items.length,1);assert.deepEqual(p.skippedRows,[2]);assert.deepEqual(db,before);
  assert.equal(preview(db,text.replace('P3','P4'),{duplicates:'skip-matching'}).errors.length,1);
  assert.equal(preview(db,text.replace('OLD-1,A1','OLD-1,B1'),{duplicates:'skip-matching'}).errors.length,1);
  const next=execute(db,command(p));assert.equal(next.entities.length,2);assert.deepEqual(next.entities[0],before.entities[0]);validate(next);
});
test('cell boxes resolve explicit paths and unique names while rejecting ambiguity and out-of-bounds slots',()=>{
  let db=execute(empty(),{type:'storage-box',data:{at,kind:'cell',facility:'Lab',room:'R',equipment:'F',rack:'Rack',code:'B2',name:'盒 01',rows:9,columns:9}});
  assert.equal(preview(db,'名称,格位,冻存盒\nB16,A1,盒 01').errors.length,1);
  const p=preview(db,'名称,格位,冻存盒\nB16,A1,Lab/R/F/Rack/B2');assert.equal(p.errors.length,0);assert.equal(p.items[0].data.location,'Lab/R/F/Rack/B2/A1');
  assert.equal(preview(db,'名称,格位\nB16,J1').errors.length,1);
});
test('batch import is atomic, traces every source row, and retries do not create duplicate tubes',()=>{
  const db=empty(),p=preview(db,text),cmd=command(p),next=execute(db,cmd,'qa');
  assert.equal(next.entities.length,2);assert.equal(next.events[0].inventorySourceRow,2);assert.equal(next.events[1].inventorySourceRow,3);assert.equal(next.events[0].inventorySourceName,'旧库存.csv');assert.equal(next.audit.at(-1).count,2);assert.equal(next.audit.at(-1).action,'inventory-import');assert.equal(next.entities[1].passage,null);assert.equal(next.lifecycles[1].startAt,null);assert.equal(execute(next,cmd),next);assert.equal(db.entities.length,0);validate(JSON.parse(JSON.stringify(next)));
  const changed=structuredClone(cmd);changed.data.items[0].data.name='changed';assert.throws(()=>execute(next,changed),/不同内容/);
  const invalid=structuredClone(cmd);invalid.data.items[1].data.location=invalid.data.items[0].data.location;assert.throws(()=>execute(db,invalid),/占用/);assert.equal(db.entities.length,0);
});
test('row errors include field validation, unknown dates stay empty, and automatic codes do not overwrite named codes',()=>{
  const p=preview(empty(),'名称,格位,P数,实际冻存日期,每管数量,数量单位\nB16,A1,-1,,1,cells\nMutuDC,A2,,2026-02-30,,\nOther,A3,,,0,cells');assert.equal(p.errors.length,3);
  const collision=preview(empty(),'名称,管号,格位\nB16,,A1\nOther,CL-0001,A2');assert.equal(collision.errors.length,1);
  const existing=execute(empty(),{type:'entity',data:{at,type:'cell',name:'已占编号',code:'CL-0002'}}),p2=preview(existing,'名称,格位\nB16,A1');assert.equal(p2.rows[0].code,'CL-0003');const imported=execute(existing,command(p2));assert.equal(imported.entities.at(-1).code,'CL-0003');assert.equal(imported.entities[0].code,'CL-0002');validate(imported);
});
test('restore rejects missing import summaries, repeated rows and corrupt request metadata',()=>{
  const db=execute(empty(),command(preview(empty(),text)));
  for(const mutate of [copy=>copy.audit.pop(),copy=>{copy.events[1].inventorySourceRow=2;},copy=>{copy.audit.at(-1).count=3;},copy=>{copy.audit.at(-1).request='invalid';},copy=>{const request=JSON.parse(copy.audit.at(-1).request);request.items[1].sourceRow=2;copy.audit.at(-1).request=JSON.stringify(request);},copy=>{copy.audit.at(-1).skippedRows=[-1];}]){const bad=structuredClone(db);mutate(bad);assert.throws(()=>validate(bad));}
});
