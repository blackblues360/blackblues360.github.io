import JSZip from 'jszip';
import { analyze } from './engine';
import { ENGINE_VERSION, newProject, type Project, type Snapshot, type Source } from './model';
import { compareDatasets, parseFile } from './parsers';

export async function hash(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
const logQueues = new WeakMap<Project, Promise<void>>();
export async function log(p: Project, action: string, detail: unknown) {
  const pending = (logQueues.get(p) ?? Promise.resolve()).then(async () => {
    const entry = { at: new Date().toISOString(), action, detail: structuredClone(detail), previousHash: p.events.at(-1)?.hash ?? '' };
    p.events.push({ ...entry, hash: await hash(JSON.stringify(entry)) }); p.updatedAt = new Date(Math.max(Date.parse(entry.at), Date.parse(p.updatedAt) + 1)).toISOString();
  });
  logQueues.set(p, pending.catch(() => {})); await pending;
}
export function snapshot(p: Project): Snapshot {
  return structuredClone({ config: p.config, samples: p.samples, targets: p.targets, layout: p.layout, exclusions: p.exclusions, mappings: p.mappings, activeSource: p.activeSource });
}
export function analysisKey(p: Project) {
  return JSON.stringify({ source: p.activeSource, hashes: p.sources.map(s => s.hash), samples: p.samples.map(s => ({ id: s.id, biologicalId: s.biologicalId, group: s.group, control: s.control })), exclusions: p.exclusions, mappings: p.mappings, references: p.config.references, calibratorGroup: p.config.calibratorGroup, calibratorSample: p.config.calibratorSample, qc: p.config.qc, efficiency: p.config.equalEfficiencyConfirmed });
}
export async function addSource(p: Project, s: Source) {
  if (p.sources.some(v => v.hash === s.hash)) return { duplicate: true, comparison: null };
  const primary = p.sources[0];
  const comparison = primary ? compareDatasets(primary.dataset, s.dataset) : null;
  if (comparison && !comparison.matches) return { duplicate: false, comparison };
  if (await hash(s.bytes) !== s.hash) throw new Error('原始文件哈希不一致');
  p.sources.push(structuredClone(s));
  if (!primary) {
    p.activeSource = s.id; p.name = s.dataset.name;
    p.config.instrument = s.dataset.instrument;
    p.samples = s.dataset.samples.map(id => ({ id, biologicalId: id, group: '', control: 'sample', concentration: null, availableRna: null }));
    p.targets = s.dataset.targets.map(name => ({ name, replicates: 3, efficiency: null, primerForward: '', primerReverse: '' }));
    p.layout = s.dataset.wells.map(w => ({ plate: 1, well: w.well, sample: w.sample, target: w.target, replicate: s.dataset.wells.filter(v => v.sample === w.sample && v.target === w.target).findIndex(v => v.well === w.well) + 1, control: 'sample' }));
  }
  await log(p, '导入及解析', { name: s.name, hash: s.hash, instrument: s.dataset.instrument, wells: s.dataset.wells.length, crossValidation: comparison });
  return { duplicate: false, comparison };
}
export async function createVersion(p: Project) {
  const input = snapshot(p), result = analyze(p);
  const sourceIds = p.sources.map(s => s.id);
  const inputHash = await hash(JSON.stringify({ snapshot: input, sourceIds, activeSource: p.activeSource, hashes: p.sources.map(s => s.hash) }));
  const v = { id: crypto.randomUUID(), at: new Date().toISOString(), engine: ENGINE_VERSION, sourceIds, inputHash, snapshot: input, result };
  p.versions.push(v); await log(p, '重新分析', { version: v.id, inputHash, issues: result.issues.length, formula: result.formula }); return v;
}
export async function restoreVersion(p: Project, id: string) {
  const v = p.versions.find(v => v.id === id); if (!v) throw new Error('找不到分析版本');
  if (typeof v.snapshot.activeSource !== 'string' || v.snapshot.activeSource && !p.sources.some(s => s.id === v.snapshot.activeSource)) throw new Error('此历史版本没有可验证的分析来源，无法恢复');
  const before = snapshot(p); Object.assign(p, structuredClone(v.snapshot)); await log(p, '恢复历史分析状态', { version: id, before, after: snapshot(p) });
}
const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const req = indexedDB.open('qpcr-analyzer-v1', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('projects', { keyPath: 'id' });
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
});
async function dbOperation<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', mode), req = run(tx.objectStore('projects'));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('本地数据库操作失败')); };
  });
}
export async function saveProject(p: Project, expectedUpdatedAt?: string): Promise<void> {
  validateProject(p);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects'), req = store.get(p.id); let conflict = false;
    req.onsuccess = () => {
      if (expectedUpdatedAt && req.result && req.result.updatedAt !== expectedUpdatedAt) { conflict = true; tx.abort(); } else store.put(p);
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error(conflict ? '此项目已被其他页面修改。请重新打开本地项目后继续，避免覆盖新数据。' : `本地保存失败：${tx.error?.message ?? '存储不可用'}`)); };
  });
}
export const listProjects = () => dbOperation<Project[]>('readonly', s => s.getAll());
export const loadProject = (id: string) => dbOperation<Project | undefined>('readonly', s => s.get(id));

export function validateProject(p: Project) {
  const c = p.config;
  if (!c || !c.qc || !c.pcr || !Array.isArray(c.references) || c.method !== 'ddct' || !['sample-rows', 'sample-columns'].includes(c.orientation)) throw new Error('实验参数结构不完整');
  if (![c.rows, c.columns].every(v => Number.isInteger(v) && v > 0 && v <= 26)) throw new Error('板规格应为 1–26 行 / 列');
  if (![c.rnaInput, c.rtTotal, c.rtMix, c.rtWaterAfter, c.minPipette, c.excess, ...Object.values(c.pcr), ...Object.values(c.qc)].every(v => Number.isFinite(v) && v >= 0) || c.rnaInput === 0 || c.rtTotal === 0 || c.rtMix > c.rtTotal) throw new Error('体系 / QC 参数必须为有效非负数，RNA 投入及 RT 总体积须大于零');
  if (c.qc.ctMin >= c.qc.ctMax || c.qc.peakFraction > 1 || !Number.isInteger(c.qc.minReplicates)) throw new Error('QC 范围或阈值无效');
  if (!Array.isArray(c.rtProgram) || c.rtProgram.some(s => !Number.isFinite(s.temperature) || s.minutes !== null && (!Number.isFinite(s.minutes) || s.minutes < 0))) throw new Error('RT 程序无效');
  if (new Set(p.samples.map(s => s.id)).size !== p.samples.length || p.samples.some(s => !s.id || !s.biologicalId.trim() || !['sample', 'NTC', 'No-RT', 'positive'].includes(s.control) || [s.concentration, s.availableRna].some(v => v !== null && (!Number.isFinite(v) || v < 0)))) throw new Error('样本 ID 重复、缺失或 RNA 参数无效');
  if (new Set(p.targets.map(t => t.name)).size !== p.targets.length || p.targets.some(t => !t.name || !Number.isInteger(t.replicates) || t.replicates < 1 || t.efficiency !== null && (!Number.isFinite(t.efficiency) || t.efficiency < 0 || t.efficiency > 1))) throw new Error('Target、重复数或效率记录无效');
  const occupied = new Set<string>();
  for (const a of p.layout) {
    const row = a.well.charCodeAt(0) - 65, col = Number(a.well.slice(1)) - 1, key = `${a.plate}:${a.well}`;
    if (!Number.isInteger(a.plate) || a.plate < 1 || !/^[A-Z][1-9]\d*$/.test(a.well) || row < 0 || row >= c.rows || col >= c.columns || occupied.has(key) || !p.samples.some(s => s.id === a.sample) || !p.targets.some(t => t.name === a.target)) throw new Error(`孔位越界、冲突或映射无效：${key}`);
    occupied.add(key);
  }
  if (p.activeSource && !p.sources.some(s => s.id === p.activeSource)) throw new Error('分析来源不存在');
  if (Object.values(p.exclusions).some(v => typeof v !== 'string' || !v.trim())) throw new Error('排除理由不能为空');
}

export async function exportProject(p: Project) {
  const zip = new JSZip();
  const content = { ...p, sources: p.sources.map(({ bytes, ...s }) => s) };
  const text = JSON.stringify(content); zip.file('project.json', text); zip.file('manifest.json', JSON.stringify({ schema: 1, engine: ENGINE_VERSION, projectHash: await hash(text) }));
  for (const s of p.sources) zip.file(`sources/${s.id}.bin`, s.bytes);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
export async function importProject(bytes: Uint8Array): Promise<Project> {
  if (bytes.length > 200_000_000) throw new Error('项目文件超过 200 MB');
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const text = await zip.file('project.json')?.async('string'), manifest = await zip.file('manifest.json')?.async('string');
  if (!text || !manifest) throw new Error('项目文件缺少项目数据或校验清单');
  if (JSON.parse(manifest).engine !== ENGINE_VERSION) throw new Error('项目解析器版本不兼容，需要迁移后才能恢复');
  if (await hash(text) !== JSON.parse(manifest).projectHash) throw new Error('项目内容校验失败');
  const p = JSON.parse(text) as Project;
  if (p.schema !== 1 || !p.id || !Array.isArray(p.sources) || !Array.isArray(p.events) || !Array.isArray(p.versions) || !Array.isArray(p.samples) || !Array.isArray(p.targets) || !Array.isArray(p.layout) || !p.config?.qc || !p.config.pcr || !p.exclusions || !p.mappings) throw new Error('不支持的项目结构 / 版本');
  let previousHash = '';
  for (const e of p.events) { const { hash: h, ...entry } = e; if (entry.previousHash !== previousHash || await hash(JSON.stringify(entry)) !== h) throw new Error('处理日志完整性校验失败'); previousHash = h; }
  for (const s of p.sources) {
    if (!/^[\w-]+$/.test(s.id)) throw new Error('非法原始文件 ID');
    const b = await zip.file(`sources/${s.id}.bin`)?.async('uint8array');
    if (!b || await hash(b) !== s.hash) throw new Error(`原始文件校验失败 ${s.name}`);
    s.bytes = b;
    const reparsed = await parseFile(s.name, b);
    if (JSON.stringify(reparsed) !== JSON.stringify(s.dataset)) throw new Error(`解析数据与原始文件不一致：${s.name}`);
  }
  validateProject(p); analyze(p); return p;
}
export function template(p: Project) { return { schema: 1, config: p.config, targets: p.targets, samples: p.samples.map(s => ({ ...s, concentration: null, availableRna: null })) }; }
export function fromTemplate(value: ReturnType<typeof template>) { if (value.schema !== 1 || !value.config?.pcr || !Array.isArray(value.targets) || !Array.isArray(value.samples)) throw new Error('模板格式无效'); return { ...newProject(), ...structuredClone(value), id: crypto.randomUUID() } as Project; }
