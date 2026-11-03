import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toolReturnPath} from '../assets/js/account/return-path.mjs';
test('tool return links only allow same-origin tool paths',()=>{
  const origin='https://blackblues.xyz';
  assert.equal(toolReturnPath('/tools/sop-timeline/?theme=light#paper',origin),'/tools/sop-timeline/?theme=light#paper');
  assert.equal(toolReturnPath(origin+'/tools/plate-layout/',origin),'/tools/plate-layout/');
  for(const path of [null,'','//evil.example/tools/x/','https://evil.example/tools/x/','javascript:alert(1)','/account/','/tools/../account/','https://user:pass@blackblues.xyz/tools/x/'])assert.equal(toolReturnPath(path,origin),null);
});
