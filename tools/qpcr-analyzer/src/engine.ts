import { mean, sd, wellName, type Analysis, type Assignment, type Config, type Issue, type Project, type Sample, type Target, type Well } from './model';

export function rnaRecipe(sample: Sample, c: Config) {
  const issues: string[] = [];
  const volume = sample.concentration !== null && sample.concentration > 0 ? c.rnaInput / sample.concentration : null;
  const water = volume === null ? null : c.rtTotal - c.rtMix - volume;
  if (volume === null) issues.push('RNA 浓度缺失或无效');
  if (water !== null && water < 0) issues.push('RNA 体积超出可用体系，水体积为负');
  if (volume !== null && volume < c.minPipette) issues.push('RNA 体积低于最小移液体积');
  if (water !== null && water > 0 && water < c.minPipette) issues.push('水体积低于最小移液体积');
  if (sample.availableRna !== null && sample.availableRna < c.rnaInput) issues.push('可用 RNA 质量不足');
  if (c.rnaInput <= 0 || c.rtTotal <= 0 || c.rtMix < 0 || c.rtMix > c.rtTotal || c.rtWaterAfter < 0) issues.push('RT 参数无效');
  return { volume, water, total: c.rtTotal, finalVolume: c.rtTotal + c.rtWaterAfter, dilution: (c.rtTotal + c.rtWaterAfter) / c.rtTotal, issues, formula: `${c.rnaInput} ng ÷ ${sample.concentration ?? '缺失'} ng/μL；水 = ${c.rtTotal} − ${c.rtMix} − RNA` };
}
export function masterMix(layout: Assignment[], c: Config) {
  if (Object.values(c.pcr).some(v => !Number.isFinite(v) || v < 0) || c.excess < 0 || !Number.isFinite(c.excess)) throw new Error('qPCR 体积和额外比例必须是非负数');
  const counts = new Map<string, number>();
  const occupied = new Set<string>();
  for (const a of layout) {
    const key = `${a.plate}:${a.well}`;
    if (occupied.has(key)) throw new Error(`孔位冲突 ${key}`);
    occupied.add(key); counts.set(a.target, (counts.get(a.target) ?? 0) + 1);
  }
  return [...counts].map(([target, wells]) => {
    const factor = wells * (1 + c.excess);
    const components = { sybr: c.pcr.sybr * factor, forward: c.pcr.forward * factor, reverse: c.pcr.reverse * factor, water: c.pcr.water * factor };
    return { target, wells, factor, components, total: Object.values(components).reduce((a, b) => a + b, 0), cdnaSeparate: c.pcr.cdna * wells, reactionTotal: Object.values(c.pcr).reduce((a, b) => a + b, 0), formula: `单孔体积 × ${wells} × (1 + ${c.excess})` };
  });
}
export function autoLayout(samples: Sample[], targets: Target[], c: Config): Assignment[] {
  if (![c.rows, c.columns].every(v => Number.isInteger(v) && v >= 1 && v <= 26)) throw new Error('板行列数须为 1–26 的整数');
  const major = c.orientation === 'sample-rows' ? c.rows : c.columns;
  const minor = c.orientation === 'sample-rows' ? c.columns : c.rows;
  const output: Assignment[] = []; let lane = 0;
  for (const s of samples) {
    let offset = 0;
    for (const t of targets.filter(t => !s.targets || s.targets.includes(t.name))) {
      if (!Number.isInteger(t.replicates) || t.replicates < 1 || t.replicates > minor) throw new Error(`${t.name} 重复数须在 1–${minor} 之间`);
      if (offset + t.replicates > minor) { lane++; offset = 0; }
      for (let rep = 1; rep <= t.replicates; rep++, offset++) {
        const row = c.orientation === 'sample-rows' ? lane % major : offset;
        const col = c.orientation === 'sample-rows' ? offset : lane % major;
        output.push({ plate: Math.floor(lane / major) + 1, well: wellName(row * c.columns + col, c.columns), sample: s.id, target: t.name, replicate: rep, control: s.control });
      }
    }
    lane++;
  }
  return output;
}
export function mappedWells(p: Project): Well[] {
  return (p.sources.find(s => s.id === p.activeSource)?.dataset.wells ?? []).map(w => ({ ...w, ...(p.mappings[w.well] ?? {}) }));
}
export function analyze(p: Project): Analysis {
  const c = p.config, issues: Issue[] = [], buckets = new Map<string, { sample: Sample; target: string; wells: Well[] }>();
  const biologicalGroups = new Map<string, string>();
  for (const s of p.samples) {
    if (biologicalGroups.has(s.biologicalId) && biologicalGroups.get(s.biologicalId) !== s.group) throw new Error(`生物学 ID ${s.biologicalId} 被分配到多个分组`);
    biologicalGroups.set(s.biologicalId, s.group);
  }
  const wells = mappedWells(p), occupied = new Set<string>();
  for (const w of wells) {
    const s = p.samples.find(s => s.id === w.sample);
    const add = (code: string, message: string) => issues.push({ well: w.well, sample: w.sample, target: w.target, code, message });
    if (occupied.has(w.well)) add('mapping-conflict', '孔位映射冲突'); occupied.add(w.well);
    if (!s || !w.target) { add('mapping', '样本或 Target 信息缺失'); continue; }
    if (!s.biologicalId.trim()) { add('biological-id', '请指定生物学样本 ID'); continue; }
    if (w.ct === null) add('missing-ct', 'Ct 缺失 / Undetermined');
    else if (w.ct < c.qc.ctMin || w.ct > c.qc.ctMax) add('ct-range', 'Ct 超出设定范围（仅标记，不自动排除）');
    if ((s.control === 'NTC' || s.control === 'No-RT') && w.ct !== null && w.ct <= c.qc.controlCt) add('positive-control', `${s.control} 孔出现扩增`);
    if (w.amplification.length) {
      const values = w.amplification.map(v => v.deltaRn).filter((v): v is number => v !== null);
      if (values.length < 3 || mean(values.slice(-3)) - mean(values.slice(0, 3)) < c.qc.amplificationRise) add('amplification-review', '扩增曲线增幅偏低，建议人工查看');
    } else add('amplification-missing', '扩增曲线缺失');
    if (w.melt.length) {
      const values = w.melt.map(v => v.derivative ?? 0), max = Math.max(...values);
      const peaks = w.melt.filter((v, i) => i > 0 && i < values.length - 1 && values[i] > max * c.qc.peakFraction && values[i] > values[i - 1] && values[i] >= values[i + 1]);
      const separated: typeof peaks = [];
      for (const peak of peaks) if (!separated.length || peak.temperature - separated.at(-1)!.temperature >= c.qc.peakSeparation) separated.push(peak);
      if (max <= 0 || separated.length !== 1) add('melt-review', `熔解导数峰数 ${separated.length}，建议人工查看（启发式检查）`);
    } else add('melt-missing', '熔解曲线缺失');
    if (p.exclusions[w.well] || w.instrumentOmit || w.ct === null || s.control === 'NTC' || s.control === 'No-RT') continue;
    const key = JSON.stringify([s.biologicalId, w.target]);
    if (!buckets.has(key)) buckets.set(key, { sample: s, target: w.target, wells: [] });
    const bucket = buckets.get(key)!;
    if (bucket.sample.group !== s.group) throw new Error(`生物学 ID ${s.biologicalId} 被分配到多个分组`);
    bucket.wells.push(w);
  }
  const means = [...buckets.values()].map(b => {
    const ct = b.wells.map(w => w.ct!), deviation = sd(ct), range = Math.max(...ct) - Math.min(...ct);
    if (ct.length < c.qc.minReplicates || (deviation !== null && deviation > c.qc.sd) || range > c.qc.range) for (const w of b.wells) issues.push({ well: w.well, sample: b.sample.id, target: b.target, code: 'replicates', message: `技术重复 n=${ct.length}, SD=${deviation?.toFixed(3) ?? 'NA'}, Range=${range.toFixed(3)}（未自动排除）` });
    return { biologicalId: b.sample.biologicalId, sample: b.sample.id, group: b.sample.group, target: b.target, n: ct.length, mean: mean(ct), sd: deviation, range, wells: b.wells.map(w => w.well) };
  });
  if (!c.references.length) issues.push({ code: 'references', message: '尚未选择内参' });
  if (!c.equalEfficiencyConfirmed) issues.push({ code: 'efficiency', message: '需确认 2^-ΔΔCt 的扩增效率适用前提；未确认前不输出 Fold Change' });
  const quant: Analysis['quant'] = [];
  for (const m of means.filter(m => !c.references.includes(m.target))) {
    const refs = c.references.map(t => means.find(r => r.biologicalId === m.biologicalId && r.target === t));
    if (!refs.length || refs.some(r => !r)) { issues.push({ sample: m.sample, target: m.target, code: 'missing-reference', message: '缺少对应生物学样本的有效内参' }); continue; }
    const referenceCt = mean(refs.map(r => r!.mean));
    quant.push({ biologicalId: m.biologicalId, sample: m.sample, group: m.group, target: m.target, ct: m.mean, referenceCt, deltaCt: m.mean - referenceCt, deltaDeltaCt: null, foldChange: null });
  }
  for (const q of quant) {
    const calibrationId = p.samples.find(s => s.id === c.calibratorSample)?.biologicalId;
    const calibration = quant.filter(v => v.target === q.target && (c.calibratorSample ? v.biologicalId === calibrationId : Boolean(c.calibratorGroup) && v.group === c.calibratorGroup));
    if (!calibration.length) { issues.push({ target: q.target, code: 'calibrator', message: '找不到有效校准样本 / 校准组' }); continue; }
    q.deltaDeltaCt = q.deltaCt - mean(calibration.map(v => v.deltaCt));
    q.foldChange = c.equalEfficiencyConfirmed ? 2 ** -q.deltaDeltaCt : null;
  }
  return { means, quant, issues, formula: '技术重复 Ct 算术均值 → ΔCt = Target − 内参平均 Ct → ΔΔCt = ΔCt − 校准组平均 ΔCt → FC = 2^(−ΔΔCt)；独立统计单位为 biologicalId。Ct 尺度不报告 CV。' };
}
