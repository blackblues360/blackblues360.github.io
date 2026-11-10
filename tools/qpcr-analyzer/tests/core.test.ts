import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { analyze, autoLayout, masterMix, rnaRecipe } from '../src/engine';
import { defaults, newProject, type Dataset, type Well } from '../src/model';
import { createVersion, exportProject, hash, importProject, log, saveProject, loadProject, restoreVersion } from '../src/project';
import { compareDatasets, numeric } from '../src/parsers';

const sample = (id: string, group = '') => ({ id, group, biologicalId: id, control: 'sample' as const, concentration: 200, availableRna: null });
const target = (name: string, replicates = 3) => ({ name, replicates, efficiency: null, primerForward: '', primerReverse: '' });
function fixture() {
  const p = newProject(); p.samples = [sample('c1', 'control'), sample('c2', 'control'), sample('t1', 'treated')];
  p.targets = [target('ref'), target('gene')]; p.config.references = ['ref']; p.config.calibratorGroup = 'control'; p.config.equalEfficiencyConfirmed = true;
  const wells: Well[] = []; let i = 0;
  for (const [id, ref, gene] of [['c1', 20, 24], ['c2', 21, 27], ['t1', 20, 23]] as const) for (const [t, ct] of [['ref', ref], ['gene', gene]] as const) for (const delta of [-.1, 0, .1]) wells.push({ well: `A${++i}`, sample: id, target: t, task: '', ct: ct + delta, ctRaw: String(ct + delta), tm: null, instrumentOmit: false, amplification: [], melt: [] });
  const dataset: Dataset = { name: 'test', format: 'eds', instrument: 'test', rows: 8, columns: 12, samples: p.samples.map(s => s.id), targets: ['ref', 'gene'], wells, metadata: {}, rawTables: {}, warnings: [] };
  p.sources = [{ id: 'fixture', name: 'a.eds', hash: '', bytes: new Uint8Array([1, 2, 3]), dataset }]; p.activeSource = 'fixture'; return p;
}
test('RNA / RT and per-target master mix propagate volumes, exclude cDNA', () => {
  const c = defaults(), s = sample('a');
  assert.equal(rnaRecipe(s, c).volume, 10); assert.equal(rnaRecipe(s, c).water, 6); assert.equal(rnaRecipe(s, c).dilution, 3);
  assert.ok(rnaRecipe({ ...s, concentration: 10 }, c).issues.length);
  const layout = autoLayout([s], [target('g')], c), r = masterMix(layout, c)[0];
  assert.equal(r.wells, 3); assert.ok(Math.abs(r.total - 11.25 * 3.3) < 1e-10); assert.equal(r.cdnaSeparate, 11.25);
  c.pcr.sybr = 8; assert.ok(masterMix(layout, c)[0].total > r.total);
  assert.throws(() => masterMix([...layout, layout[0]], c), /冲突/);
});
test('layout keeps adjacent replicates and splits plates without collisions', () => {
  const c = defaults(), a = autoLayout(Array.from({ length: 12 }, (_, i) => sample(String(i))), [target('g', 3), target('h', 2)], c);
  assert.equal(a.length, 60); assert.equal(a.at(-1)?.plate, 2); assert.equal(new Set(a.map(v => `${v.plate}:${v.well}`)).size, a.length);
  assert.deepEqual(a.slice(0, 3).map(a => a.well), ['A1', 'A2', 'A3']);
  c.orientation = 'sample-columns'; assert.deepEqual(autoLayout([sample('a')], [target('g')], c).map(a => a.well), ['A1', 'B1', 'C1']);
});
test('known ΔΔCt calculation averages technical wells, then calibrator biological samples', () => {
  const p = fixture(), a = analyze(p), q = a.quant.find(q => q.sample === 't1')!;
  assert.equal(a.means.length, 6); assert.equal(q.deltaCt, 3); assert.equal(q.deltaDeltaCt, -2); assert.equal(q.foldChange, 4);
  p.config.equalEfficiencyConfirmed = false; assert.equal(analyze(p).quant[0].foldChange, null);
  p.config.references = ['unknown']; assert.equal(analyze(p).quant.length, 0);
});
test('multi-reference, manual exclusion, NTC and missing Ct', () => {
  const p = fixture(); p.config.references = ['ref', 'gene']; assert.equal(analyze(p).quant.length, 0);
  p.config.references = ['ref']; const before = JSON.stringify(p.sources); p.exclusions.A18 = 'bad curve';
  assert.equal(analyze(p).means.find(m => m.sample === 't1' && m.target === 'gene')?.n, 2); assert.equal(JSON.stringify(p.sources), before);
  p.samples[2].control = 'NTC' as any; assert.equal(analyze(p).quant.length, 2); assert.ok(analyze(p).issues.some(i => i.code === 'positive-control'));
  p.sources[0].dataset.wells[0].ct = null; assert.ok(analyze(p).issues.some(i => i.code === 'missing-ct'));
});
test('cross-validation detects curves and missing wells; blank Ct is never zero', () => {
  const a = fixture().sources[0].dataset, b = structuredClone(a); b.wells[0].ct = 9;
  assert.equal(compareDatasets(a, b).matches, false); b.wells.pop(); assert.ok(compareDatasets(a, b).differences.some(d => d.field === 'well'));
  for (const v of ['', null, undefined, 'Undetermined', 'NaN']) assert.equal(numeric(v), null);
});
test('IndexedDB, version restoration, portable project and integrity verification', async () => {
  const p = fixture(); p.sources[0].hash = await hash(p.sources[0].bytes); await log(p, 'created', {}); const v = await createVersion(p);
  p.config.calibratorGroup = 'changed'; await restoreVersion(p, v.id); assert.equal(p.config.calibratorGroup, 'control');
  await saveProject(p); assert.deepEqual(await loadProject(p.id), p);
  const backup = newProject(); await Promise.all([log(backup, 'a', {}), log(backup, 'b', {})]); await createVersion(backup);
  const restored = await importProject(await exportProject(backup)); assert.deepEqual(restored, backup);
  backup.events[0].action = 'tampered'; await assert.rejects(importProject(await exportProject(backup)), /日志完整性/);
});
test('shared biological ID cannot borrow references from another group', () => {
  const p = fixture(); p.samples[1].biologicalId = p.samples[0].biologicalId; p.samples[1].group = 'different';
  assert.throws(() => analyze(p), /多个分组/);
});
test('calibrator alias resolves by biological ID and restored version restores source', async () => {
  const p = fixture(); p.samples.push({ ...p.samples[0], id: 'alias' }); p.config.calibratorSample = 'alias';
  assert.equal(analyze(p).quant.find(q => q.sample === 't1')?.foldChange, 2);
  const v = await createVersion(p); p.activeSource = 'different'; await restoreVersion(p, v.id); assert.equal(p.activeSource, 'fixture');
});
test('stale browser write is rejected atomically', async () => {
  const p = newProject(); await saveProject(p); const originalAt = p.updatedAt;
  await log(p, 'changed', {}); await saveProject(p, originalAt);
  await assert.rejects(saveProject({ ...p, name: 'stale' }, originalAt), /其他页面修改/);
});
test('multiple references normalize on Ct scale with equal weight per reference', () => {
  const p = fixture(); const source = p.sources[0];
  const extra = source.dataset.wells.filter(w => w.target === 'ref').map((w, i) => ({ ...w, well: `B${i + 1}`, target: 'ref2', ct: w.ct! + 2 }));
  source.dataset.wells.push(...extra); p.config.references = ['ref', 'ref2'];
  const q = analyze(p).quant.find(q => q.sample === 't1')!;
  assert.equal(q.referenceCt, 21); assert.equal(q.deltaCt, 2); assert.equal(q.foldChange, 4);
});
test('melt peak spacing compares to the last accepted peak', () => {
  const p = fixture(); const w = p.sources[0].dataset.wells[0];
  p.config.qc.peakSeparation = .75;
  w.melt = Array.from({ length: 13 }, (_, i) => ({ temperature: 79.75 + i * .25, rn: 1, derivative: i % 2 ? 2 : 0 }));
  assert.ok(analyze(p).issues.some(i => i.well === w.well && i.code === 'melt-review'));
});
