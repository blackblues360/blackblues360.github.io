import { useRef, useState } from 'react';
import { utils, write } from 'xlsx';
import { mappedWells } from './engine';
import { mean, sd, type Analysis, type Project, type Quant, type Well } from './model';
import { restoreVersion, snapshot } from './project';
import { csv, download, Empty, fmt, Icon, Metrics, palette, Panel, Table, Tabs, time, type Change } from './ui';

type AnalysisProps = { project: Project; analysis: Analysis | null; change: Change };
type Series = { name: string; values: [number, number][] };
function Curve({ title, axis, series }: { title: string; axis: string; series: Series[] }) {
  const points = series.flatMap(line => line.values).filter(point => point.every(Number.isFinite));
  if (!points.length) return <Empty title="暂无曲线" text="选择有仪器曲线的孔位。"/>;
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(0, ...ys), ymax = Math.max(...ys);
  const x = (value: number) => 52 + (value - xmin) / (xmax - xmin || 1) * 390;
  const y = (value: number) => 207 - (value - ymin) / (ymax - ymin || 1) * 176;
  return <div className="plot">
    <svg className="chart-svg" viewBox="0 0 470 251" role="img" aria-label={title}>
      <title>{title}</title>
      {[0, 1, 2, 3, 4].map(i => {
        const value = ymin + (ymax - ymin) * i / 4;
        return <g key={i}><line x1="52" x2="442" y1={y(value)} y2={y(value)} className="gridline"/><text x="43" y={y(value) + 3} textAnchor="end">{fmt(value, 3)}</text></g>;
      })}
      <path d="M52 31V207H442" className="axis"/>
      {[0, 1, 2, 3, 4].map(i => {
        const value = xmin + (xmax - xmin) * i / 4;
        return <text key={i} x={x(value)} y="225" textAnchor="middle">{fmt(value, 1)}</text>;
      })}
      <text x="247" y="245" textAnchor="middle">{axis}</text>
      {series.map((line, index) => <polyline key={line.name} fill="none" stroke={palette[index % palette.length]} strokeWidth="2.1" strokeLinejoin="round"
        points={line.values.filter(point => point.every(Number.isFinite)).map(([px, py]) => x(px) + ',' + y(py)).join(' ')}><title>{line.name}</title></polyline>)}
    </svg>
    <ul className="legend inline">{series.map((line, index) => <li key={line.name}><i style={{ background: palette[index % palette.length] }}/>{line.name}</li>)}</ul>
  </div>;
}

export function QcPage({ project: p, analysis, change }: AnalysisProps) {
  const [tab, setTab] = useState<'overview' | 'amp' | 'melt' | 'wells'>('overview');
  const [selection, setSelection] = useState('');
  const [query, setQuery] = useState('');
  const [signal, setSignal] = useState<'deltaRn' | 'rn' | 'raw'>('deltaRn');
  const wells = mappedWells(p);
  const ids = selection ? new Set(selection.split(',').map(value => value.trim().toUpperCase())) : new Set(wells.slice(0, 1).map(w => w.well));
  const chosen = wells.filter(well => ids.has(well.well));
  const warnings = analysis?.issues.filter(issue => issue.well) ?? [];
  const review = new Set(warnings.map(issue => issue.well));
  const excluded = wells.filter(well => well.instrumentOmit || Boolean(p.exclusions[well.well]));
  const means = analysis?.means ?? [];
  const rows = wells.filter(well => [well.well, well.sample, well.target].some(text => text.toLowerCase().includes(query.toLowerCase())));
  const ampSeries: Series[] = chosen.map(well => ({ name: well.well, values: well.amplification.map(point => [
    point.cycle, (signal === 'raw' ? point.raw?.['x1-m1'] : point[signal]) ?? NaN,
  ]) }));
  function toggleWell(well: Well) {
    const excludedReason = p.exclusions[well.well];
    const reason = excludedReason ? '' : prompt('排除 ' + well.well + ' 的理由（必填）');
    if (reason === null) return;
    void change(excludedReason ? '恢复人工排除孔' : '人工排除孔', next => {
      if (excludedReason) delete next.exclusions[well.well];
      else {
        if (!reason.trim()) throw new Error('必须填写排除理由');
        next.exclusions[well.well] = reason.trim();
      }
    });
  }
  return <>
    <Tabs label="质控视图" active={tab} onChange={setTab} values={[['overview', '概览'], ['amp', '扩增曲线'], ['melt', '熔解曲线'], ['wells', '孔位与排除']]}/>
    <Metrics items={[
      { label: '正常孔', value: wells.filter(w => !review.has(w.well) && !excluded.includes(w)).length, icon: 'check' },
      { label: '待检查孔', value: wells.filter(w => review.has(w.well) && !excluded.includes(w)).length, icon: 'alert', tone: 'amber' },
      { label: '已排除孔', value: excluded.length, icon: 'shield', tone: 'red' },
      { label: 'Ct 缺失', value: wells.filter(w => w.ct === null).length, icon: 'activity', tone: 'blue' },
      { label: '控制孔扩增', value: new Set(warnings.filter(issue => issue.code === 'positive-control').map(issue => issue.well)).size, icon: 'experiment', tone: 'purple' },
    ]}/>
    {tab === 'overview' && <div className="page-grid qc-grid">
      <Panel title="技术重复汇总" note="选择一行可叠加查看该组的扩增曲线。">
        <Table headers={['样本 / Target', 'n', 'Mean Ct', 'SD', 'Range', '状态']} rows={means.map(row => [
          <span><strong>{row.sample}</strong><small className="cell-note">{row.target}</small></span>,
          row.n, fmt(row.mean), fmt(row.sd), fmt(row.range),
          <span className={'tag ' + (row.wells.some(id => review.has(id)) ? 'warn' : '')}>{row.wells.some(id => review.has(id)) ? '待检查' : '正常'}</span>,
        ])} activeRow={means.findIndex(row => row.wells.join(',') === selection)} onRow={index => setSelection(means[index].wells.join(','))}/>
      </Panel>
      <div className="stack">
        <Panel title="扩增曲线" note="ΔRn · 扩增循环" action={<button onClick={() => setTab('amp')}>查看详情<Icon name="chevron" size={13}/></button>}>
          <Curve title="扩增曲线" axis="循环数" series={chosen.map(well => ({ name: well.well, values: well.amplification.map(point => [point.cycle, point.deltaRn ?? NaN]) }))}/>
        </Panel>
        <Panel title="质控提示" note={'共 ' + warnings.length + ' 条孔位提示'}>
          <ul className="issue-list">{warnings.slice(0, 5).map((issue, index) => <li key={index}><span className="tag warn">{issue.well}</span><span>{issue.message}</span></li>)}</ul>
          {!warnings.length && <p className="muted-copy">当前没有孔位提示。</p>}
          {warnings.length > 5 && <button onClick={() => setTab('wells')}>查看全部孔位</button>}
        </Panel>
      </div>
    </div>}
    {(tab === 'amp' || tab === 'melt') && <Panel title={tab === 'amp' ? '扩增曲线' : '熔解曲线'}>
      <div className="actions chart-controls">
        <label>孔位<input aria-label="曲线孔位" placeholder="A1,A2,A3" value={selection || wells[0]?.well || ''} onChange={event => setSelection(event.target.value)}/></label>
        {tab === 'amp' && <label>信号<select value={signal} onChange={event => setSignal(event.target.value as typeof signal)}><option value="deltaRn">ΔRn</option><option value="rn">Rn</option><option value="raw">原始滤光信号</option></select></label>}
      </div>
      {tab === 'amp' ? <Curve title="扩增曲线" axis="循环数" series={ampSeries}/> : <div className="page-grid two-cols">
        <Curve title="熔解曲线 · Rn" axis="温度 (°C)" series={chosen.map(well => ({
          name: well.well + ' · Tm ' + fmt(well.tm, 2) + ' °C',
          values: well.melt.map(point => [point.temperature, point.rn ?? NaN]),
        }))}/>
        <Curve title="熔解导数曲线" axis="重采样温度 (°C)" series={chosen.map(well => ({
          name: well.well, values: well.melt.map(point => [point.derivativeTemperature ?? point.temperature, point.derivative ?? NaN]),
        }))}/>
      </div>}
    </Panel>}
    {tab === 'wells' && <Panel title="孔的纳入与排除" note="保留仪器 Ct 和 Omit 状态，人工排除需填写理由。"
      action={<label className="search"><Icon name="search" size={16}/><input aria-label="搜索孔位" placeholder="孔位、样本或 Target" value={query} onChange={event => setQuery(event.target.value)}/></label>}>
      <Table headers={['Well', 'Sample', 'Target', '仪器 Ct', '纳入状态', '质控提示', '操作']} rows={rows.map(well => [
        well.well, well.sample, well.target, fmt(well.ct),
        <span className={'tag ' + (well.instrumentOmit || p.exclusions[well.well] ? 'muted' : '')}>{well.instrumentOmit ? '仪器 Omit' : p.exclusions[well.well] ?? '纳入'}</span>,
        warnings.filter(issue => issue.well === well.well).map(issue => issue.message).join(' · ') || '—',
        <button disabled={well.instrumentOmit} onClick={() => toggleWell(well)}>{p.exclusions[well.well] ? '恢复' : '排除'}</button>,
      ])} onRow={index => { setSelection(rows[index].well); setTab('amp'); }}/>
    </Panel>}
  </>;
}

function groupSummary(quant: Quant[]) {
  const groups = new Map<string, number[]>();
  for (const row of quant) {
    if (row.foldChange === null || !Number.isFinite(row.foldChange)) continue;
    const label = row.group || '未分组';
    const values = groups.get(label) ?? [];
    values.push(row.foldChange);
    groups.set(label, values);
  }
  return [...groups].map(([group, values]) => ({ group, values, n: values.length, mean: mean(values), sd: sd(values) }));
}
function FoldChart({ rows, svgRef, target }: { rows: Quant[]; svgRef?: React.Ref<SVGSVGElement>; target: string }) {
  const groups = groupSummary(rows);
  if (!groups.length) return <Empty title="等待 Fold Change 结果" text="选择内参与校准样本或对照组，并确认扩增效率前提。"/>;
  const width = Math.max(450, groups.length * 75 + 80);
  const stride = (width - 80) / groups.length;
  const maximum = Math.max(1, ...groups.flatMap(group => group.values)) * 1.13;
  const y = (value: number) => 214 - value / maximum * 174;
  return <div className="plot fold-plot">
    <svg ref={svgRef} className="chart-svg" xmlns="http://www.w3.org/2000/svg" viewBox={'0 0 ' + width + ' 263'} role="img" aria-label={target + ' Fold Change 分组均值和样本散点'}
      fontFamily="system-ui, sans-serif" fontSize="11" fill="#556b65">
      <title>{target} · Fold Change</title>
      <rect width={width} height="263" fill="#fff"/>
      <text x="49" y="22" fontSize="12" fontWeight="650" fill="#193a32">Fold Change · {target}</text>
      {[0, 1, 2, 3, 4].map(i => {
        const value = maximum * i / 4;
        return <g key={i}><line x1="49" x2={width - 15} y1={y(value)} y2={y(value)} stroke="#e7efec"/>
          <text x="41" y={y(value) + 4} textAnchor="end">{fmt(value, 2)}</text></g>;
      })}
      <line x1="49" y1={y(1)} x2={width - 15} y2={y(1)} stroke="#77908a" strokeDasharray="4 4"/>
      {groups.map((group, index) => {
        const center = 55 + stride * (index + 0.5);
        const barWidth = Math.min(57, stride * 0.54);
        const color = index === 0 && groups.length > 1 ? '#9ca9b7' : palette[index === 0 ? 0 : (index - 1) % palette.length];
        return <g key={group.group}>
          <rect x={center - barWidth / 2} y={y(group.mean)} width={barWidth} height={214 - y(group.mean)} rx="3" fill={color} opacity="0.9"><title>{group.group + ' 均值 ' + fmt(group.mean)}</title></rect>
          {group.values.map((value, i) => <circle key={i} cx={center + ((i * 5 % 9) - 4) * barWidth / 15} cy={y(value)} r="3.6" fill="white" stroke="#23483e" strokeWidth="1.2"><title>{group.group + ' · ' + fmt(value)}</title></circle>)}
          <text x={center} y="234" textAnchor="middle"><title>{group.group}</title>{group.group.length > 10 ? group.group.slice(0, 9) + '…' : group.group}</text>
          <text x={center} y="250" textAnchor="middle">n = {group.n}</text>
        </g>;
      })}
    </svg>
    <p className="muted-copy">柱形表示组均值，圆点表示各生物学样本，虚线表示 Fold Change = 1。</p>
  </div>;
}

const quantHeaders = ['样本', '生物学 ID', '分组', 'Target', 'Ct', 'Reference Ct', 'ΔCt', 'ΔΔCt', 'Fold Change'];
const quantCells = (row: Quant) => [row.sample, row.biologicalId, row.group, row.target, row.ct, row.referenceCt, row.deltaCt, row.deltaDeltaCt, row.foldChange];

export function QuantPage({ project: p, analysis, change }: AnalysisProps) {
  const [target, setTarget] = useState('');
  const quant = analysis?.quant ?? [];
  const targets = [...new Set(quant.map(row => row.target))];
  const firstComplete = quant.find(row => row.foldChange !== null && Number.isFinite(row.foldChange));
  const active = targets.includes(target) ? target : firstComplete?.target ?? targets[0] ?? '';
  const filtered = quant.filter(row => row.target === active);
  const groups = [...new Set(p.samples.map(s => s.group).filter(Boolean))];
  const c = p.config;
  return <div className="stack">
    <Panel title="相对定量设置" note="先对有效技术重复取 Ct 算术均值，再计算 ΔCt 与 ΔΔCt。"
      action={<span className="tag">2⁻ΔΔCt</span>}>
      <div className="quant-settings">
        <label>内参（可多选）<select multiple value={c.references} onChange={event => {
          const references = Array.from(event.target.selectedOptions, option => option.value);
          void change('更换内参', next => { next.config.references = references; });
        }}>{p.targets.map(item => <option key={item.name}>{item.name}</option>)}</select></label>
        <div className="form-stack">
          <label>校准组<select value={c.calibratorGroup} onChange={event => {
            const value = event.target.value;
            void change('更换校准组', next => { next.config.calibratorGroup = value; next.config.calibratorSample = ''; });
          }}><option value="">请选择</option>{groups.map(group => <option key={group}>{group}</option>)}</select></label>
          <label>或单个校准样本<select value={c.calibratorSample} onChange={event => {
            const value = event.target.value;
            void change('更换校准样本', next => { next.config.calibratorSample = value; });
          }}><option value="">使用校准组</option>{p.samples.map(item => <option key={item.id}>{item.id}</option>)}</select></label>
        </div>
        <div className="assumption">
          <label className="check-label"><input type="checkbox" checked={c.equalEfficiencyConfirmed} onChange={event => {
            const value = event.target.checked;
            void change('确认效率适用前提', next => { next.config.equalEfficiencyConfirmed = value; });
          }}/>已确认目标和内参扩增效率相近</label>
          <p>确认适用前提后生成 Fold Change。</p>
          <button disabled={!p.sources.length} onClick={() => change('重新分析', () => {})}><Icon name="activity" size={16}/>重新分析</button>
        </div>
      </div>
    </Panel>
    <div className="page-grid quant-grid">
      <Panel title="Fold Change" action={targets.length > 0 && <select aria-label="定量 Target" value={active} onChange={event => setTarget(event.target.value)}>{targets.map(item => <option key={item}>{item}</option>)}</select>}>
        <FoldChart rows={filtered} target={active}/>
      </Panel>
      <Panel title="ΔCt → ΔΔCt → Fold Change" note={active || '定量结果'}
        action={<button disabled={!quant.length} onClick={async () => {
          const saved = await change('导出定量结果', () => {}, { format: 'csv' });
          if (saved) download(csv([quantHeaders, ...quant.map(quantCells)]), 'relative-quantification.csv', 'text/csv');
        }}><Icon name="download" size={16}/>导出 CSV</button>}>
        <Table headers={['Sample', 'ΔCt', 'ΔΔCt', 'FC']} rows={filtered.map(row => [row.sample, fmt(row.deltaCt), fmt(row.deltaDeltaCt), fmt(row.foldChange)])} empty="设置内参后显示可计算的结果"/>
      </Panel>
    </div>
    <Panel title="计算说明" note={analysis?.formula}>
      <ul className="issue-list">{[...new Set(analysis?.issues.filter(issue =>
        !issue.well && (!issue.target || !active || issue.target === active)).map(issue => issue.message) ?? [])].map(message =>
        <li key={message}><Icon name="alert" size={16}/>{message}</li>)}</ul>
    </Panel>
  </div>;
}

export function StatsPage({ project: p, analysis, change, openQuant }: AnalysisProps & { openQuant: () => void }) {
  const [target, setTarget] = useState('');
  const svg = useRef<SVGSVGElement>(null);
  const available = (analysis?.quant ?? []).filter(row => row.foldChange !== null && Number.isFinite(row.foldChange));
  const targets = [...new Set(available.map(row => row.target))];
  const active = targets.includes(target) ? target : targets[0] ?? '';
  const rows = available.filter(row => row.target === active);
  const groups = groupSummary(rows);
  async function exportExcel() {
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([quantHeaders, ...rows.map(quantCells)]), '样本定量');
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([['Group', 'n', 'Mean FC', 'SD'], ...groups.map(g => [g.group, g.n, g.mean, g.sd])]), '描述性统计');
    const bytes = write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const saved = await change('导出统计工作簿', () => {}, { target: active, format: 'xlsx' });
    if (saved) download(new Uint8Array(bytes), 'qPCR-statistics.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  return <div className="stack">
    <div className="page-grid stats-grid">
      <Panel title="统计设置" note="按生物学样本汇总。">
        <div className="form-stack"><label>目标基因<select aria-label="统计 Target" value={active} onChange={event => setTarget(event.target.value)} disabled={!targets.length}>
          {!targets.length && <option value="">等待定量结果</option>}{targets.map(item => <option key={item}>{item}</option>)}
        </select></label></div>
        <dl className="key-values">
          <div><dt>统计方式</dt><dd>描述性统计</dd></div>
          <div><dt>汇总指标</dt><dd>Fold Change</dd></div>
          <div><dt>分组数</dt><dd>{groups.length}</dd></div>
          <div><dt>生物学样本</dt><dd>{rows.length}</dd></div>
        </dl>
        {!available.length && <button onClick={openQuant}>前往定量分析<Icon name="chevron" size={14}/></button>}
      </Panel>
      <Panel title="分组表达图" note={active || '由定量结果生成'} action={<>
        <button disabled={!rows.length} onClick={async () => {
          if (!svg.current) return;
          const markup = new XMLSerializer().serializeToString(svg.current);
          const saved = await change('导出统计图表', () => {}, { target: active, format: 'svg' });
          if (saved) download(markup, 'qPCR-fold-change.svg', 'image/svg+xml');
        }}><Icon name="download" size={16}/>导出 SVG</button>
        <button disabled={!rows.length} className="primary" onClick={exportExcel}><Icon name="download" size={16}/>导出 Excel</button>
      </>}>
        <FoldChart rows={rows} target={active} svgRef={svg}/>
      </Panel>
    </div>
    <Panel title="分组结果">
      <Table headers={['分组', '生物学样本数', 'Mean FC', 'SD']} rows={groups.map(g => [g.group, g.n, fmt(g.mean), fmt(g.sd)])}/>
    </Panel>
    <Panel title="最近分析记录">
      <ol className="timeline">{p.events.slice(-5).reverse().map(event => <li key={event.hash}><strong>{event.action}</strong><span>{time(event.at)}</span></li>)}</ol>
      {!p.events.length && <p className="muted-copy">项目操作会自动记录在此处。</p>}
    </Panel>
  </div>;
}

export function HistoryPage({ project: p, change }: Pick<AnalysisProps, 'project' | 'change'>) {
  const [compare, setCompare] = useState('');
  const version = p.versions.find(item => item.id === compare);
  return <div className="stack">
    <Metrics items={[
      { label: '分析版本', value: p.versions.length, icon: 'history' },
      { label: '日志条目', value: p.events.length, icon: 'file', tone: 'blue' },
      { label: '数据来源', value: p.sources.length, icon: 'folder', tone: 'mint' },
    ]}/>
    <Panel title="分析版本" note="恢复版本会将历史参数和数据来源写入一个新版本。">
      <Table headers={['版本', '创建时间', 'Ct 汇总', '定量行', '操作']} rows={p.versions.map((item, index) => [
        <span className="tag">V{index + 1}</span>, time(item.at), item.result.means.length, item.result.quant.length,
        <div className="actions"><button onClick={() => setCompare(compare === item.id ? '' : item.id)}>参数对照</button>
          <button onClick={() => change('恢复版本', next => restoreVersion(next, item.id))}>恢复</button></div>,
      ]).reverse()} empty="导入数据后生成初始分析版本"/>
      {version && <div className="page-grid two-cols compare"><div><h3>当前参数</h3><pre>{JSON.stringify(snapshot(p), null, 2)}</pre></div>
        <div><h3>历史参数</h3><pre>{JSON.stringify(version.snapshot, null, 2)}</pre></div></div>}
    </Panel>
    <Panel title="处理日志" note="展开条目查看操作细节、SHA-256 校验和前序记录。">
      {p.events.length ? <ol className="timeline history-list">{p.events.map(event => <li key={event.hash}><details>
        <summary><strong>{event.action}</strong><time>{time(event.at)}</time></summary>
        <pre>{JSON.stringify(event, null, 2)}</pre>
      </details></li>).reverse()}</ol> : <Empty title="暂无处理日志" text="导入、修改、分析和导出后，记录会显示在这里。"/>}
    </Panel>
  </div>;
}
