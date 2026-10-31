import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDocument} from '../core.mjs';
import {loadDraft,saveDraft,replaceFailedDraft} from '../draft.mjs';

const key='draft';
function storage(raw=null) {
  const values=new Map(raw===null?[]:[[key,raw]]);
  return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
}
test('missing and normally restored drafts have distinct states and remain writable',()=>{
  const store=storage(),missing=loadDraft(store,key);
  assert.equal(missing.status,'missing');
  const doc=emptyDocument();assert.equal(saveDraft(missing,store,key,doc),true);
  const restored=loadDraft(store,key);assert.equal(restored.status,'restored');assert.deepEqual(restored.document,doc);
});
for(const [name,raw] of [['invalid JSON','{broken'],['invalid document',JSON.stringify({version:1})],['empty stored text','']]) {
  test(`${name}: edits and unload saves cannot overwrite the original`,()=>{
    const store=storage(raw),recovery=loadDraft(store,key);
    assert.equal(recovery.status,'failed');assert.equal(recovery.raw,raw);
    const editing=emptyDocument();editing.name='edited fallback';
    assert.equal(saveDraft(recovery,store,key,editing),false);
    assert.equal(saveDraft(recovery,store,key,emptyDocument()),false);
    assert.equal(store.getItem(key),raw); // raw is also the exact export source.
  });
}
test('explicit replacement retains original recovery backup and enables normal saves',()=>{
  const raw='{broken',store=storage(raw),recovery=loadDraft(store,key),doc=emptyDocument();
  assert.equal(store.getItem(key),raw); // no implicit reset on loading
  const next=replaceFailedDraft(recovery,store,key,doc);
  assert.equal(store.getItem(`${key}.recovery`),raw);assert.equal(recovery.status,'restored');
  assert.deepEqual(JSON.parse(store.getItem(key)),next);
  assert.equal(saveDraft(recovery,store,key,next),true);
});
test('failed backup writes and changed drafts prevent replacement',()=>{
  const store=storage('{broken'),recovery=loadDraft(store,key);
  store.setItem(key,'changed elsewhere');
  assert.throws(()=>replaceFailedDraft(recovery,store,key,emptyDocument()),/其他页面/);
  assert.equal(store.getItem(key),'changed elsewhere');
  const blocked=storage('{broken'),failed=loadDraft(blocked,key);
  blocked.setItem=()=>{throw new Error('quota');};
  assert.throws(()=>replaceFailedDraft(failed,blocked,key,emptyDocument()),/quota/);
  assert.equal(blocked.getItem(key),'{broken');assert.equal(failed.status,'failed');
});
test('storage access errors remain a locked recovery failure',()=>{
  const store={getItem(){throw new Error('denied');},setItem(){assert.fail('must not write');}};
  const recovery=loadDraft(store,key);assert.equal(recovery.status,'failed');assert.equal(recovery.raw,null);
  assert.equal(saveDraft(recovery,store,key,emptyDocument()),false);
});
test('later recoveries archive rather than discard previous raw backups',()=>{
  const values=new Map([[key,'{new broken'],[`${key}.recovery`,'{older broken']]);
  const store={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  replaceFailedDraft(loadDraft(store,key),store,key,emptyDocument());
  assert.equal(values.get(`${key}.recovery`),'{new broken');
  assert.ok([...values].some(([k,v])=>k.startsWith(`${key}.recovery.`)&&v==='{older broken'));
});
