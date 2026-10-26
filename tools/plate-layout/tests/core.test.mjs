import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLATE_TYPES, wellIds, createState, restoreState, cleanText, assignLabel, setLabelColor,
  clearSelectedLabels, deleteLabel, usedLabels, nextColor, plateMarkup,
  buildExportSvg, exportFilename, wrapText, textColor
} from '../core.mjs';

test('four plate formats have unique row-major coordinates and correct boundaries', () => {
  for (const [type, spec] of Object.entries(PLATE_TYPES)) {
    const ids = wellIds(type);
    assert.equal(ids.length, Number(type));
    assert.equal(new Set(ids).size, Number(type));
    assert.equal(ids[0], 'A1');
    assert.equal(ids.at(-1), `${String.fromCharCode(64 + spec.rows)}${spec.cols}`);
    assert.equal(ids[spec.cols], 'B1');
  }
  assert.throws(() => wellIds('48'));
  assert.throws(() => wellIds('__proto__'));
});

test('new plans start with a blank 96-well plate and separate selection state', () => {
  const state = createState();
  assert.equal(state.plate.type, '96');
  assert.equal(Object.keys(state.wells).length, 96);
  assert.ok(Object.values(state.wells).every(value => value === null));
  state.ui.selected = ['A1'];
  assert.equal(state.wells.A1, null);
});

test('assign, reuse, overwrite and selective clear preserve unrelated wells', () => {
  const state = createState();
  state.ui.selected = ['A1', 'A2', 'H12'];
  const control = assignLabel(state, 'Control', nextColor(state.labels));
  const originalColor = control.color;
  state.ui.selected = ['B1'];
  assert.equal(assignLabel(state, '  CONTROL  ', '#ff0000').id, control.id);
  assert.equal(state.labels.length, 1);
  assert.equal(state.labels[0].color, originalColor);
  state.ui.selected = ['A1'];
  const ova = assignLabel(state, 'OVA', nextColor(state.labels));
  assert.notEqual(ova.id, control.id);
  assert.equal(state.wells.A1, ova.id);
  assert.equal(state.wells.A2, control.id);
  clearSelectedLabels(state);
  assert.equal(state.wells.A1, null);
  assert.equal(state.wells.H12, control.id);
  assert.equal(state.wells.B1, control.id);
  assert.deepEqual(usedLabels(state).map(label => [label.name, label.wells.length]), [['Control', 3]]);
  assert.equal(state.labels.length, 2, 'unused templates remain in the library');
});

test('invalid input fails before changing any assignments', () => {
  const state = createState('6');
  assert.throws(() => assignLabel(state, 'OVA', '#aabbcc'), /选择/);
  state.ui.selected = ['A1'];
  assert.throws(() => assignLabel(state, '   ', '#aabbcc'), /名称/);
  assert.throws(() => assignLabel(state, 'OVA', 'red'), /颜色/);
  assert.equal(state.labels.length, 0);
  assignLabel(state, 'Control', '#aabbcc');
  const before = JSON.stringify(state);
  assert.throws(() => assignLabel(state, 'Other', '#AABBCC'), /已被/);
  assert.equal(JSON.stringify(state), before);
});

test('colors are unique, editable through stable IDs, and survive round-trip storage', () => {
  const state = createState();
  for (const [index, id] of wellIds('96').entries()) {
    state.ui.selected = [id];
    assignLabel(state, `Label ${index + 1}`, nextColor(state.labels));
  }
  assert.equal(new Set(state.labels.map(label => label.color)).size, 96);
  assert.ok(state.labels.every(label => /^#[\da-f]{6}$/.test(label.color)));
  assert.throws(() => setLabelColor(state, 'label-1', state.labels[1].color), /已被/);
  setLabelColor(state, 'label-1', '#123456');
  assert.equal(usedLabels(state)[0].color, '#123456');
  assert.deepEqual(restoreState(JSON.parse(JSON.stringify(state))), state);
});

test('deleting a label clears exactly its references and active label', () => {
  const state = createState('6');
  state.ui.selected = ['A1', 'B3'];
  const first = assignLabel(state, 'First', '#aabbcc');
  state.ui.selected = ['A2'];
  const second = assignLabel(state, 'Second', '#ddeeff');
  deleteLabel(state, first.id);
  assert.equal(state.wells.A1, null);
  assert.equal(state.wells.B3, null);
  assert.equal(state.wells.A2, second.id);
  assert.equal(state.ui.activeLabelId, second.id);
  deleteLabel(state, second.id);
  assert.equal(state.ui.activeLabelId, null);
});

test('restore rejects unsupported versions and strips dangling or invalid references', () => {
  assert.throws(() => restoreState({ version: 2, plate: { type: '96' } }));
  assert.throws(() => restoreState({ version: 1, plate: { type: '__proto__' } }));
  const state = createState('6');
  state.labels = [{ id: 'label-1', name: 'Control', color: '#aabbcc' }, { id: 'bad', name: 'Invalid', color: 'url(javascript:alert(1))' }];
  state.wells.A1 = 'label-1';
  state.wells.A2 = 'missing';
  state.wells.H12 = 'label-1';
  state.ui.selected = ['B3', 'H12', 'A1', 'A1'];
  state.ui.wellScale = 900;
  const restored = restoreState(state);
  assert.equal(restored.labels.length, 1);
  assert.equal(restored.wells.A1, 'label-1');
  assert.equal(restored.wells.A2, null);
  assert.equal(Object.keys(restored.wells).length, 6);
  assert.deepEqual(restored.ui.selected, ['A1', 'B3']);
  assert.equal(restored.ui.wellScale, 110);
});

test('live SVG has accessible coordinates and selected rings; export excludes editing state', () => {
  const state = createState();
  state.ui.selected = ['A1', 'H12'];
  assignLabel(state, 'OVA', '#aabbcc');
  const live = plateMarkup(state);
  assert.equal((live.content.match(/data-well=/g) || []).length, 96);
  assert.equal((live.content.match(/aria-pressed="true"/g) || []).length, 2);
  assert.ok(live.content.includes('aria-label="H12：OVA"'));
  state.ui.showAxes = false;
  state.ui.showIds = false;
  const exported = buildExportSvg(state);
  assert.ok(!exported.svg.includes('data-well='));
  assert.ok(!exported.svg.includes('aria-pressed'));
  assert.ok(!exported.svg.includes('stroke="#386f61"'));
  assert.ok(!exported.svg.includes('>H12</text>'));
  assert.ok(exported.svg.includes('2 孔位 (2.1%)'));
  assert.ok(exported.svg.includes('A1, H12'));
  assert.ok(exported.svg.includes('fill="#ffffff"'));
});

test('export respects all combinations of well numbering and legend visibility', () => {
  const state = createState();
  state.ui.selected = ['A1', 'H12'];
  assignLabel(state, 'OVA', '#aabbcc');
  const withLegend = buildExportSvg(state).height;
  for (const showIds of [true, false]) {
    for (const exportLegend of [true, false]) {
      state.ui.showIds = showIds;
      state.ui.exportLegend = exportLegend;
      const result = buildExportSvg(state);
      assert.equal(result.svg.includes('>H12</text>'), showIds);
      assert.equal(result.svg.includes('标签图例 / Legend'), exportLegend);
      assert.equal(result.svg.includes('2 孔位 (2.1%)'), exportLegend);
      assert.equal(result.svg.includes('A1, H12'), exportLegend);
      assert.ok(result.svg.includes('>OVA</text>'), 'well labels remain without a legend');
      assert.equal((result.svg.match(/class="well-circle"/g) || []).length, 96);
      assert.ok(exportLegend ? result.height === withLegend : result.height < withLegend);
    }
  }
  const blank = createState('6');
  blank.ui.exportLegend = false;
  assert.ok(!buildExportSvg(blank).svg.includes('No labels assigned'));
});

test('export settings restore persistently and older saves keep their numbering preference', () => {
  const state = createState();
  state.ui.showIds = false;
  state.ui.exportLegend = false;
  const restored = restoreState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.ui.showIds, false);
  assert.equal(restored.ui.exportLegend, false);
  delete state.ui.exportLegend;
  const legacy = restoreState(state);
  assert.equal(legacy.ui.showIds, false);
  assert.equal(legacy.ui.exportLegend, true);
});

test('user text is escaped in SVG while full label names remain in the legend', () => {
  const state = createState('6');
  const title = '<实验> "OVA" & LPS';
  const name = '<script>alert("x")</script> & 抗原呈递';
  state.plate.title = title;
  state.ui.selected = ['A1'];
  assignLabel(state, name, '#aabbcc');
  const exported = buildExportSvg(state);
  assert.ok(exported.svg.includes('&lt;实验&gt; &quot;OVA&quot; &amp; LPS'));
  assert.ok(exported.svg.includes('&lt;script&gt;'));
  assert.ok(!exported.svg.includes('<script>'));
  assert.ok(plateMarkup(state).content.includes('抗原呈递'));
});

test('empty and maximum-length legends fit an automatically sized export', () => {
  const state = createState();
  const blank = buildExportSvg(state);
  assert.ok(blank.svg.includes('No labels assigned'));
  for (const [index, id] of wellIds('96').entries()) {
    state.ui.selected = [id];
    assignLabel(state, `处理组 ${index} ${'中文长标签WW'.repeat(20)}`, nextColor(state.labels));
  }
  state.plate.title = '实验名称'.repeat(40);
  const large = buildExportSvg(state);
  assert.ok(large.height > blank.height + 2000);
  assert.equal((large.svg.match(/1 孔位 \(1.0%\)/g) || []).length, 96);
  assert.equal((large.svg.match(/class="well-circle"/g) || []).length, 96);
  assert.equal(wrapText('中文WW'.repeat(40), 200, 17).join(''), '中文WW'.repeat(40));
});

test('download names use local calendar dates and replace filesystem-unsafe characters', () => {
  const date = new Date(2026, 9, 21, 0, 1);
  assert.equal(exportFilename('', 'png', date), 'plate-layout-2026-10-21.png');
  assert.equal(exportFilename('BMDC / OVA:实验', 'jpg', date), 'BMDC - OVA-实验.jpg');
  assert.equal(exportFilename('...', 'png', date), 'plate-layout-2026-10-21.png');
  assert.equal(textColor('#000000'), '#ffffff');
  assert.equal(textColor('#ffffff'), '#20343c');
});

test('export titles append the export day in Chinese without changing the saved title', () => {
  const state = createState('6');
  state.plate.title = 'BMDC 实验';
  const first = buildExportSvg(state, new Date(2026, 9, 22, 0, 1));
  const next = buildExportSvg(state, new Date(2026, 9, 23, 0, 1));
  assert.ok(first.svg.includes('BMDC 实验 · 2026年10月22日'));
  assert.ok(next.svg.includes('BMDC 实验 · 2026年10月23日'));
  assert.equal(state.plate.title, 'BMDC 实验');
  state.plate.title = '';
  assert.ok(buildExportSvg(state, new Date(2027, 0, 2)).svg.includes('孔板铺板方案 · 2027年1月2日'));
  state.plate.title = '中文长标题'.repeat(32);
  const long = buildExportSvg(state, new Date(2026, 9, 22));
  const lines = [...long.svg.matchAll(/font-size="31" font-weight="650">(.*?)<\/text>/g)].map(match => match[1]);
  assert.ok(lines.join('').endsWith('2026年10月22日'));
  assert.ok(lines.length > 1);
});

test('XML-forbidden characters and split surrogate pairs cannot corrupt image exports', () => {
  assert.equal(cleanText('A\ufffe B\uffff C\ud800 D\udc00'), 'A B C D');
  assert.equal(cleanText('😀'), '😀');
  assert.equal(cleanText('A'.repeat(159) + '😀'), 'A'.repeat(159));
  const state = createState('6');
  state.plate.title = 'A\ufffe B';
  assert.ok(!buildExportSvg(state).svg.includes('\ufffe'));
});

test('unsafe stored label IDs cannot cause newly created groups to share an identity', () => {
  const raw = createState('6');
  raw.labels = [{ id: 'label-9007199254740992', name: 'Invalid', color: '#aabbcc' }];
  raw.wells.A1 = raw.labels[0].id;
  const state = restoreState(raw);
  assert.equal(state.labels.length, 0);
  assert.equal(state.wells.A1, null);
  state.ui.selected = ['A1'];
  const first = assignLabel(state, 'First', nextColor(state.labels));
  state.ui.selected = ['A2'];
  const second = assignLabel(state, 'Second', nextColor(state.labels));
  assert.notEqual(first.id, second.id);
  assert.notEqual(state.wells.A1, state.wells.A2);
});
