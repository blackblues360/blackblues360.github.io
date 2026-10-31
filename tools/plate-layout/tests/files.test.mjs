import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../core.mjs';
import {prepareImport,backupBeforeImport,readImportBackup} from '../files.mjs';

test('native v1 JSON roundtrips with an exact semantic preview',()=>{
  const state=createState('6');state.labels=[{id:'label-1',name:'control',color:'#a9c9ed'}];state.wells.A1='label-1';
  const text=JSON.stringify(state,null,2),prepared=prepareImport(text);
  assert.equal(prepared.rawText,text);assert.deepEqual(prepared.normalized,state);
  assert.deepEqual(prepared.changes,[]);assert.deepEqual(prepared.summary,{type:'6',labels:1,assigned:1});
});
test('normalization is explicit and retains raw text separately',()=>{
  const state=createState('12');state.labels=[{id:'bad',name:'bad',color:'#ffffff'}];state.wells.A1='bad';state.ui.wellScale=999;delete state.ui.exportLegend;
  const text=JSON.stringify(state),prepared=prepareImport(text);
  assert.equal(prepared.rawText,text);assert.equal(prepared.normalized.labels.length,0);
  assert.ok(prepared.changes.includes('state.labels.0'));assert.ok(prepared.changes.includes('state.wells.A1'));
  assert.ok(prepared.changes.includes('state.ui.wellScale'));assert.ok(prepared.changes.includes('state.ui.exportLegend'));
  assert.equal(state.wells.A1,'bad');
});
test('unknown versions, malformed shapes, invalid JSON and oversized inputs are rejected',()=>{
  for(const text of ['{','{}','[]',JSON.stringify({...createState(),version:2}),JSON.stringify({...createState(),labels:{}}),JSON.stringify({...createState(),wells:[]})]) assert.throws(()=>prepareImport(text));
  assert.throws(()=>prepareImport(' '.repeat(5000001)),/5 MB/);
});
test('backup preserves raw storage text and editor snapshot independently',()=>{
  const values=new Map([['plate','{unreadable-original']]),store={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  const state=createState('24');backupBeforeImport(store,'plate',state);state.plate.title='later';
  assert.equal(values.get('plate'),'{unreadable-original');
  assert.equal(JSON.parse(values.get('plate.import-backup')).storageText,'{unreadable-original');
  assert.equal(readImportBackup(store,'plate').plate.title,'');
});
test('backup failures cannot change primary storage or current state',()=>{
  const state=createState(),before=structuredClone(state),store={getItem:()=> 'original',setItem(){throw new Error('quota');}};
  assert.throws(()=>backupBeforeImport(store,'plate',state),/quota/);assert.deepEqual(state,before);
});
test('later import previews retain older backups under separate archive keys',()=>{
  const values=new Map(),store={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  backupBeforeImport(store,'plate',createState('6'));const original=values.get('plate.import-backup');
  backupBeforeImport(store,'plate',createState('12'));
  assert.ok([...values].some(([k,v])=>k.startsWith('plate.import-backup.')&&v===original));
  assert.equal(readImportBackup(store,'plate').plate.type,'12');
});
