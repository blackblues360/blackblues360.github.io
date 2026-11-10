import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import * as XLSX from 'xlsx';
import { wellName, type Dataset, type Well } from './model';

const xml = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false });
const list = <T>(v: T | T[] | undefined): T[] => v === undefined ? [] : Array.isArray(v) ? v : [v];
export const numeric = (v: unknown): number | null => v === null || v === undefined || String(v).trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const blank = (well: string): Well => ({ well, sample: '', target: '', task: '', ct: null, ctRaw: '', tm: null, instrumentOmit: false, amplification: [], melt: [] });
function finish(d: Dataset) {
  if (!d.wells.length) throw new Error('未解析到有效孔，请确认文件是 QuantStudio 导出格式');
  d.samples = [...new Set(d.wells.map(w => w.sample).filter(Boolean))];
  d.targets = [...new Set(d.wells.map(w => w.target).filter(Boolean))];
  return d;
}
export async function parseEds(bytes: Uint8Array): Promise<Dataset> {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const read = async (name: string, required = true) => {
    const f = zip.file(`apldbio/sds/${name}`);
    if (!f) { if (required) throw new Error(`EDS 缺少 ${name}`); return ''; }
    const text = await f.async('string');
    if (text.length > 30_000_000) throw new Error(`EDS ${name} 超出解析限制`);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('不支持含外部实体的 XML');
    return text;
  };
  const [expText, plateText, results, meltText, filterText, protocol, analysisProtocol, multi] = await Promise.all(['experiment.xml', 'plate_setup.xml', 'analysis_result.txt', 'meltcuve_result.txt', 'filterdata.xml', 'tcprotocol.xml', 'analysis_protocol.xml', 'multicomponentdata.xml'].map(n => read(n, !['multicomponentdata.xml', 'filterdata.xml'].includes(n))));
  const exp = xml.parse(expText).Experiment, plate = xml.parse(plateText).Plate;
  const rows = Number(plate.Rows), columns = Number(plate.Columns);
  if (rows !== 8 || columns !== 12) throw new Error('此版本 EDS 适配仅验证过 96 孔板');
  const wells = new Map<number, Well>();
  const get = (i: number) => { if (!Number.isInteger(i) || i < 0 || i >= rows * columns) throw new Error(`非法 EDS 孔索引 ${i}`); if (!wells.has(i)) wells.set(i, blank(wellName(i, columns))); return wells.get(i)!; };
  for (const feature of list<any>(plate.FeatureMap)) {
    for (const v of list<any>(feature.FeatureValue)) {
      const item = v.FeatureItem;
      if (feature.Feature.Id === 'sample') get(Number(v.Index)).sample = String(item.Sample.Name ?? '');
      if (feature.Feature.Id === 'detector-task') {
        const tasks = list<any>(item.DetectorTaskList.DetectorTask);
        if (tasks.length !== 1) throw new Error('此版本不支持同孔多 Target');
        const w = get(Number(v.Index)); w.target = String(tasks[0].Detector.Name); w.task = String(tasks[0].Task);
      }
    }
  }
  for (const v of list<any>(plate.Wells?.Well)) if (wells.has(Number(v.Index))) get(Number(v.Index)).instrumentOmit = v.IsOmit === 'true';
  let current: Well | undefined;
  for (const line of results.split(/[\r\n]+/)) {
    const a = line.split('\t');
    if (/^\d+$/.test(a[0])) { current = get(Number(a[0])); current.ctRaw = a[4] ?? ''; current.ct = numeric(a[4]); }
    else if (current && ['Rn values', 'Delta Rn values'].includes(a[0])) {
      a.slice(1).forEach((v, i) => { current!.amplification[i] ??= { cycle: i + 1, rn: null, deltaRn: null }; current!.amplification[i][a[0] === 'Rn values' ? 'rn' : 'deltaRn'] = numeric(v); });
    }
  }
  current = undefined;
  for (const line of meltText.split(/[\r\n]+/)) {
    const a = line.split('\t');
    if (/^\d+$/.test(a[0])) { current = get(Number(a[0])); current.tm = numeric(a[4]); }
    else if (current && ['Sample Temperatures', 'Rn values', 'Delta Rn Sample Temperatures', 'Delta Rn values'].includes(a[0])) {
      const field = ({ 'Sample Temperatures': 'temperature', 'Rn values': 'rn', 'Delta Rn Sample Temperatures': 'derivativeTemperature', 'Delta Rn values': 'derivative' } as const)[a[0] as 'Sample Temperatures'];
      a.slice(1).forEach((v, i) => { current!.melt[i] ??= { temperature: NaN, rn: null, derivative: null }; const n = numeric(v); if (n !== null) current!.melt[i][field] = n; });
    }
  }
  if (filterText) for (const point of list<any>(xml.parse(filterText).PlatePointDataCollection.PlatePointData)) {
    if (Number(point.Stage) !== 2) continue;
    const cycle = Number(point.Cycle);
    for (const data of list<any>(point.PlateData)) {
      const attrs = Object.fromEntries(list<any>(data.Attribute).map(a => [a.key, a.value]));
      String(data.WellData).trim().split(/\s+/).forEach((v, i) => {
        const w = wells.get(i), a = w?.amplification.find(a => a.cycle === cycle);
        if (a) { a.raw ??= {}; a.raw[String(attrs.FILTER_SET)] = Number(v); }
      });
    }
  }
  return finish({ name: String(exp.Name), format: 'eds', instrument: exp.InstrumentTypeId === 'QS7Flex' ? 'QuantStudio 7 Flex' : String(exp.InstrumentTypeId ?? '未知仪器'), rows, columns, wells: [...wells.values()], samples: [], targets: [], metadata: { experiment: exp, thermalProtocol: xml.parse(protocol), analysisProtocol: xml.parse(analysisProtocol), chemistry: exp.ChemistryType }, rawTables: { 'experiment.xml': expText, 'plate_setup.xml': plateText, 'analysis_result.txt': results, 'meltcuve_result.txt': meltText, 'filterdata.xml': filterText, 'tcprotocol.xml': protocol, 'analysis_protocol.xml': analysisProtocol, 'multicomponentdata.xml': multi }, warnings: [] });
}

export function parseXlsx(bytes: Uint8Array): Dataset {
  const book = XLSX.read(bytes, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false });
  const names = ['Sample Setup', 'Amplification Data', 'Results', 'Melt Curve Raw Data'];
  const tables: Record<string, unknown[][]> = {}, records: Record<string, Record<string, unknown>[]> = {};
  for (const name of names) {
    if (!book.Sheets[name]) throw new Error(`XLSX 缺少工作表：${name}`);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: null });
    tables[name] = rows;
    const headerIndex = rows.findIndex(r => r.includes('Well') && (r.includes('Sample Name') || r.includes('Cycle') || r.includes('Reading')));
    if (headerIndex < 0) throw new Error(`无法识别 ${name} 字段标题`);
    const headers = rows[headerIndex].map(v => String(v ?? '').trim());
    records[name] = rows.slice(headerIndex + 1).filter(r => numeric(r[headers.indexOf('Well')]) !== null).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
  }
  const wells = new Map<number, Well>();
  for (const r of records['Sample Setup']) {
    if (!r['Sample Name'] && !r['Target Name']) continue;
    const i = Number(r.Well) - 1, w = blank(wellName(i));
    w.sample = String(r['Sample Name'] ?? ''); w.target = String(r['Target Name'] ?? ''); w.task = String(r.Task ?? ''); wells.set(i, w);
  }
  for (const r of records.Results) {
    const i = Number(r.Well) - 1, w = wells.get(i);
    if (!w) throw new Error(`Results 孔 ${r.Well} 未在 Sample Setup 配置`);
    w.ctRaw = String(r.CT ?? r.Ct ?? ''); w.ct = numeric(w.ctRaw); w.tm = numeric(r.Tm1); w.instrumentOmit = String(r.Omit).toLowerCase() === 'true';
    if (String(r['Sample Name'] ?? '') !== w.sample || String(r['Target Name'] ?? '') !== w.target) throw new Error(`XLSX 内部映射冲突 ${w.well}`);
  }
  for (const r of records['Amplification Data']) {
    const w = wells.get(Number(r.Well) - 1);
    if (w) w.amplification.push({ cycle: Number(r.Cycle), rn: numeric(r.Rn), deltaRn: numeric(r['Delta Rn']) });
  }
  for (const r of records['Melt Curve Raw Data']) {
    const w = wells.get(Number(r.Well) - 1);
    if (w) w.melt.push({ temperature: Number(r.Temperature), derivativeTemperature: Number(r.Temperature), rn: numeric(r.Fluorescence), derivative: numeric(r.Derivative) });
  }
  const metaRows = tables.Results.slice(0, 40);
  const allText = metaRows.flat().join(' ');
  return finish({ name: String(metaRows.find(r => r.some(v => String(v).includes('Experiment Name')))?.find((v, i) => i > 0 && v) ?? 'QuantStudio 实验'), format: 'xlsx', instrument: /QuantStudio.*7|QS7Flex/i.test(allText) ? 'QuantStudio 7 Flex' : '未知仪器（XLSX 未识别型号）', rows: 8, columns: 12, wells: [...wells.values()], samples: [], targets: [], metadata: { header: metaRows }, rawTables: tables, warnings: [] });
}
export interface Comparison { matches: boolean; checked: number; differences: { well: string; field: string; left: unknown; right: unknown }[]; tolerance: number }
export function compareDatasets(a: Dataset, b: Dataset, tolerance = 0.0001): Comparison {
  const differences: Comparison['differences'] = []; let checked = 0;
  const check = (well: string, field: string, left: unknown, right: unknown) => { checked++; if (typeof left === 'number' && typeof right === 'number' && Number.isFinite(left) && Number.isFinite(right) ? Math.abs(left - right) > tolerance : left !== right) differences.push({ well, field, left, right }); };
  check('', 'rows', a.rows, b.rows); check('', 'columns', a.columns, b.columns);
  for (const name of new Set([...a.wells, ...b.wells].map(w => w.well))) {
    const x = a.wells.find(w => w.well === name), y = b.wells.find(w => w.well === name);
    if (!x || !y) { check(name, 'well', Boolean(x), Boolean(y)); continue; }
    for (const key of ['sample', 'target', 'ct', 'tm'] as const) check(name, key, x[key], y[key]);
    check(name, 'amplification.length', x.amplification.length, y.amplification.length);
    x.amplification.forEach((v, i) => { for (const key of ['cycle', 'rn', 'deltaRn'] as const) check(name, `amp.${i}.${key}`, v[key], y.amplification[i]?.[key]); });
    check(name, 'melt.length', x.melt.length, y.melt.length);
    x.melt.forEach((v, i) => { const t = y.melt[i]; check(name, `melt.${i}.temperature`, v.derivativeTemperature ?? v.temperature, t?.derivativeTemperature ?? t?.temperature); check(name, `melt.${i}.rn`, v.rn, t?.rn); check(name, `melt.${i}.derivative`, v.derivative, t?.derivative); });
  }
  return { matches: differences.length === 0, checked, differences, tolerance };
}
export async function parseFile(name: string, bytes: Uint8Array) {
  if (bytes.length > 80_000_000) throw new Error('文件超过 80 MB 限制');
  if (/\.eds$/i.test(name)) return parseEds(bytes);
  if (/\.xlsx$/i.test(name)) return parseXlsx(bytes);
  throw new Error('请选择 .eds 或 .xlsx 文件');
}
