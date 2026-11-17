import test from 'node:test';
import assert from 'node:assert/strict';
import {EMPTY_LIBRARY, changeLibrary, readLibrary, suggestLibraryColor} from '../label-library.mjs';

const groupId = 'a66f78bf-bbf2-4067-be48-0635f560d53d';

test('learning a label twice preserves its chosen color and classification', () => {
  let library = changeLibrary(EMPTY_LIBRARY, {type: 'createGroup', id: groupId, name: '刺激条件'});
  library = changeLibrary(library, {type: 'addLabel', name: 'OVA + LPS', color: '#c1aabb', groupId});
  assert.equal(changeLibrary(library, {type: 'remember', name: ' ova   + lps ', color: '#123456'}), library);
  const recolored = changeLibrary(library, {type: 'setColor', name: 'OVA + LPS', color: '#aaccee'});
  assert.deepEqual(readLibrary(recolored).labels, [{name: 'OVA + LPS', color: '#aaccee', groupId}]);
  assert.equal(library.labels[0].color, '#c1aabb');
});

test('moving a label preserves its color, and deleting its category leaves it unclassified', () => {
  let library = changeLibrary(EMPTY_LIBRARY, {type: 'createGroup', id: groupId, name: '分组一'});
  library = changeLibrary(library, {type: 'remember', name: 'Control', color: '#a9c9ed'});
  library = changeLibrary(library, {type: 'moveLabel', name: 'control', groupId});
  assert.deepEqual(library.labels[0], {name: 'Control', color: '#a9c9ed', groupId});
  library = changeLibrary(library, {type: 'removeGroup', id: groupId});
  assert.equal(library.labels[0].groupId, null);
  library = changeLibrary(library, {type: 'removeLabel', name: 'Control'});
  assert.deepEqual(library, EMPTY_LIBRARY);
});

test('automatic colors avoid those already used by the account and the current plan', () => {
  const library = changeLibrary(EMPTY_LIBRARY, {type: 'remember', name: 'Control', color: '#a9c9ed'});
  const localColors = [{color: '#f4dc91'}];
  const color = suggestLibraryColor(library, null, localColors);
  assert.match(color, /^#[a-f0-9]{6}$/);
  assert.notEqual(color, library.labels[0].color);
  assert.notEqual(color, localColors[0].color);
  assert.throws(() => readLibrary({groups: [], labels: [{name: 'A', color, groupId}]}), /无法读取/);
});
