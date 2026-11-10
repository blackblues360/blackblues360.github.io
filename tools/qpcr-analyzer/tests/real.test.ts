import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { parseFile, compareDatasets } from '../src/parsers';
import { newProject } from '../src/model';
import { addSource, createVersion, exportProject, hash, importProject } from '../src/project';

const prefix = process.env.QPCR_FIXTURE_PREFIX;
test('real QuantStudio pair: all mapped wells, every amplification/melt point and project round trip', { skip: !prefix ? 'Set QPCR_FIXTURE_PREFIX to the source path without extension' : false }, async () => {
  await access(`${prefix}.eds`); await access(`${prefix}.xlsx`);
  const aBytes = new Uint8Array(await readFile(`${prefix}.eds`)), bBytes = new Uint8Array(await readFile(`${prefix}.xlsx`));
  const a = await parseFile('test.eds', aBytes), b = await parseFile('test.xlsx', bBytes);
  for (const d of [a, b]) {
    assert.equal(d.instrument, 'QuantStudio 7 Flex'); assert.equal(d.wells.length, 90); assert.equal(d.samples.length, 12); assert.equal(d.targets.length, 8);
    assert.equal(d.rows * d.columns, 96);
    for (const w of d.wells) { assert.equal(w.amplification.length, 40); assert.equal(w.melt.length, 181); }
    for (const well of ['F7', 'F8', 'F9', 'G10', 'G11', 'G12']) assert.ok(!d.wells.some(w => w.well === well));
    const first = d.wells.find(w => w.well === 'A1')!;
    assert.equal(first.sample, '2xAC16-NC-1'); assert.equal(first.target, 'h-PRKAA2'); assert.ok(Math.abs(first.ct! - 27.609825) < .00001);
    assert.ok(Math.abs(first.amplification[0].rn! - .077859305) < 1e-7);
    assert.ok(Math.abs((first.melt[1].derivativeTemperature ?? first.melt[1].temperature) - 60.323677) < 1e-5);
  }
  const compared = compareDatasets(a, b); assert.deepEqual(compared.differences.slice(0, 10), []); assert.ok(compared.checked > 59000);
  const p = newProject();
  await addSource(p, { id: 'eds', name: 'test.eds', bytes: aBytes, hash: await hash(aBytes), dataset: a });
  await addSource(p, { id: 'xlsx', name: 'test.xlsx', bytes: bBytes, hash: await hash(bBytes), dataset: b });
  assert.equal(p.sources.length, 2); assert.equal(p.layout.length, 90);
  assert.equal((await addSource(p, p.sources[0])).duplicate, true);
  p.config.references = ['h-ACTIN']; p.config.calibratorSample = '1xAC16-NC-3'; p.config.equalEfficiencyConfirmed = true;
  await createVersion(p); assert.ok(p.versions[0].result.quant.length > 0);
  const restored = await importProject(await exportProject(p)); assert.equal(restored.sources[0].hash, await hash(aBytes)); assert.deepEqual(restored.versions, p.versions);
  console.log(JSON.stringify({ comparisonChecks: compared.checked, samples: a.samples.length, targets: a.targets.length, wells: a.wells.length, meanCtRows: p.versions[0].result.means.length, quantRows: p.versions[0].result.quant.length }));
});
