import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from '../vendor/sheetjs-0.20.3.mjs';
import {readInventoryWorkbook,inventoryWorksheetText} from '../inventory-workbook.mjs';
import {parseInventoryGrid,parseInventoryTable,suggestInventoryMapping,previewInventoryImport} from '../inventory-import.mjs';
import {empty,execute,validate} from '../core.mjs';
const buffer=(rows,bookType='xlsx',change=()=>{})=>{const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,'旧库存');change(ws,wb);return XLSX.write(wb,{type:'array',bookType});};
const at='2026-11-02T09:00:00+08:00';
test('XLSX and legacy XLS preserve Chinese, formatted tube codes and calendar dates',async()=>{
  for(const type of ['xlsx','xls']){
    const wb=await readInventoryWorkbook(buffer([['细胞名称','管号','格位','实际冻存日期'],['中文细胞',1,'A1',43890]],type,ws=>{ws.B2.z='0000';ws.D2.z='yyyy-mm-dd';}));
    const table=parseInventoryTable(await inventoryWorksheetText(wb,'旧库存'));assert.deepEqual(table.rows[0].values,['中文细胞','0001','A1','2020-02-29']);
  }
});
test('only the selected worksheet is decoded; missing, formula and merged sheets are rejected',async()=>{
  const wb=await readInventoryWorkbook(buffer([['名称','格位'],['正常','A1']],'xlsx',(ws,w)=>{const formula=XLSX.utils.aoa_to_sheet([['名称','格位'],['旧缓存','A2']]);formula.A2.f='1+1';XLSX.utils.book_append_sheet(w,formula,'公式页');const merged=XLSX.utils.aoa_to_sheet([['名称','格位'],['合并','A3']]);merged['!merges']=[XLSX.utils.decode_range('A2:B2')];XLSX.utils.book_append_sheet(w,merged,'合并页');}));
  assert.match(await inventoryWorksheetText(wb,'旧库存'),/正常/);await assert.rejects(inventoryWorksheetText(wb,'公式页'),/公式/);await assert.rejects(inventoryWorksheetText(wb,'合并页'),/合并/);await assert.rejects(inventoryWorksheetText(wb,'不存在'),/不存在/);
});
test('1904 workbook dates are read using their calendar without a timezone day shift',async()=>{
  const wb=await readInventoryWorkbook(buffer([['名称','格位','日期'],['细胞','A1',1]],'xlsx',(ws,w)=>{ws.C2.z='yyyy-mm-dd';w.Workbook={WBProps:{date1904:true}};}));assert.match(await inventoryWorksheetText(wb,'旧库存'),/1904-01-02/);
});
test('invalid files, oversized input, dimensions and Excel error values stop decoding',async()=>{
  await assert.rejects(readInventoryWorkbook(new ArrayBuffer(2000001)),/2 MB/);await assert.rejects(readInventoryWorkbook(new TextEncoder().encode('pretend xlsx').buffer),/不是有效/);
  const wb=await readInventoryWorkbook(buffer([['名称','格位'],['细胞','A1']],'xlsx',ws=>{ws['!ref']='A1:CC600';}));await assert.rejects(inventoryWorksheetText(wb,'旧库存'),/超出/);
  const error=await readInventoryWorkbook(buffer([['名称','格位'],['细胞','A1']],'xlsx',ws=>{ws.A2={t:'e',v:7};}));await assert.rejects(inventoryWorksheetText(error,'旧库存'),/错误值/);
});
test('grid flattens nonempty slots and preserves physical source cells independently of slot labels',()=>{
  const table=parseInventoryGrid('\t2\t1\nB\t中文细胞｜OLD-2｜P3｜2020-02-29\t\nA\t\tMutuDC');assert.equal(table.rows.length,2);assert.deepEqual(table.rows.map(r=>r.sourceCell),['B2','C3']);assert.deepEqual(table.rows.map(r=>r.values[2]),['B2','A1']);
  const preview=previewInventoryImport(empty(),table,suggestInventoryMapping(table.headers),{boxId:'BOX-LN01-A-01',duplicates:'error',at});assert.equal(preview.errors.length,0);assert.equal(preview.items[0].data.passage,3);assert.equal(preview.items[1].data.passage,null);
  const db=execute(empty(),{type:'inventory-import',key:'grid-test',data:{at,items:preview.items,skippedRows:[],sourceName:'库.xlsx / 旧库存'}});assert.equal(db.events[1].inventorySourceCell,'C3');assert.equal(db.lifecycles[0].startAt,null);validate(JSON.parse(JSON.stringify(db)));
});
test('ambiguous grid axes, too many fields and all-empty boxes cannot create records',()=>{
  for(const text of ['\t1\t1\nA\tx\ty','\t0\nA\tx','\t1\nJ\tx','\t1\nA\tx\nA\ty','标题\t1\nA\tx','\t1\nA\tx|id|P1|date|extra','\t1\nA\t'])assert.throws(()=>parseInventoryGrid(text));
});
test('grid duplicates and existing occupied slots use the same atomic conflict checks as lists',()=>{
  const table=parseInventoryGrid('\t1\t2\nA\t细胞|SAME\t细胞|SAME'),opts={boxId:'BOX-LN01-A-01',duplicates:'error',at};const p=previewInventoryImport(empty(),table,suggestInventoryMapping(table.headers),opts);assert.equal(p.errors.length,2);
  const db=execute(empty(),{type:'inventory-register',data:{at,name:'已有',location:'LN01/A/01/A1'}}),t=parseInventoryGrid('\t1\nA\t新细胞');assert.equal(previewInventoryImport(db,t,suggestInventoryMapping(t.headers),opts).errors.length,1);assert.equal(db.entities.length,1);
});
test('full 9 by 9 grid imports 81 independent tubes and template remains a valid empty grid',async()=>{
  const text='\t'+Array.from({length:9},(_,i)=>i+1).join('\t')+'\n'+Array.from({length:9},(_,i)=>String.fromCharCode(65+i)+'\t'+Array.from({length:9},(_,j)=>'细胞|T'+i+j).join('\t')).join('\n');
  const table=parseInventoryGrid(text),p=previewInventoryImport(empty(),table,suggestInventoryMapping(table.headers),{boxId:'BOX-LN01-A-01',duplicates:'error',at});assert.equal(p.items.length,81);assert.equal(p.errors.length,0);assert.equal(p.items.at(-1).sourceCell,'J10');assert.match(p.items.at(-1).data.location,/I9$/);
  const {inventoryGridTemplate}=await import('../inventory-import.mjs');assert.throws(()=>parseInventoryGrid(inventoryGridTemplate()),/没有可导入/);
});
test('restored backups reject altered or malformed grid provenance and imports remain idempotent',()=>{
  const table=parseInventoryGrid('\t1\nA\t细胞|T1'),p=previewInventoryImport(empty(),table,suggestInventoryMapping(table.headers),{boxId:'BOX-LN01-A-01',duplicates:'error',at}),command={type:'inventory-import',key:'grid-idempotent',data:{at,items:p.items,skippedRows:[],sourceName:'库.xlsx / 盒位'}};
  const db=execute(empty(),command);assert.equal(execute(db,command),db);for(const cell of ['A0','C4',null]){const bad=structuredClone(db);bad.events[0].inventorySourceCell=cell;assert.throws(()=>validate(bad),/导入/);}const bad=structuredClone(command);bad.data.items[0].sourceCell='A0';assert.throws(()=>execute(empty(),bad),/单元格/);
});
