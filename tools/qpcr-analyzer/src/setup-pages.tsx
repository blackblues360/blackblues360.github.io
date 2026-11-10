import { useRef, useState, type CSSProperties, type FormEvent, type PointerEvent } from 'react';
import { autoLayout, masterMix, rnaRecipe } from './engine';
import { wellName, type Config, type Dataset, type Project, type Sample } from './model';
import { template } from './project';
import { csv, download, Empty, fmt, Icon, InlineTextForm, Metrics, NumberEdit, palette, Panel, Table, Tabs, type Change } from './ui';

type SetupProps = { project: Project; change: Change };
const projectFields = [
  ['name', '实验名称'], ['date', '实验日期'], ['purpose', '实验目的'],
  ['tissue', '细胞 / 组织'], ['conditions', '处理条件'],
] as const;

export function ExperimentPage({ project: p, data, change, openImport, openPrep }: SetupProps & { data?: Dataset; openImport: () => void; openPrep: () => void }) {
  const [editing, setEditing] = useState(false);
  const cycles = Math.max(0, ...(data?.wells.map(well => well.amplification.length) ?? []));
  const total = Object.values(p.config.pcr).reduce((sum, value) => sum + value, 0);
  async function saveInfo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await change('修改实验信息', next => {
      for (const [key] of projectFields) next[key] = String(form.get(key) ?? '').trim();
    });
    if (saved) setEditing(false);
  }
  return <div className="page-grid overview-grid">
    <Panel className="experiment-card">
      <div className="dna-banner">
        <div><span>EXPERIMENT WORKSPACE</span><strong>从样本到表达</strong><small>RT-qPCR · 实验项目</small></div>
        <img src={new URL('./dna.svg', import.meta.url).href} alt=""/>
      </div>
      <div className="experiment-title">
        <div><h2>{p.name}</h2><div className="tag-row"><span className="tag">{p.config.rows * p.config.columns} 孔板</span><span className="tag muted">{p.config.instrument}</span></div></div>
        <button type="button" className="icon-button" aria-label="编辑实验信息" onClick={() => setEditing(!editing)}><Icon name="edit" size={16}/></button>
      </div>
      {editing ? <form className="edit-info" onSubmit={saveInfo}>
        {projectFields.map(([key, label]) => <label key={key}>{label}<input name={key} type={key === 'date' ? 'date' : 'text'} required={key === 'name'} defaultValue={p[key]}/></label>)}
        <div className="actions"><button className="primary" type="submit">保存信息</button><button type="button" onClick={() => setEditing(false)}>取消</button></div>
      </form> : <dl className="key-values info-list">
        {projectFields.slice(1).map(([key, label]) => <div key={key}><dt><Icon name="file" size={15}/>{label}</dt><dd>{fmt(p[key])}</dd></div>)}
        <div><dt><Icon name="experiment" size={15}/>检测方式</dt><dd>RT-qPCR</dd></div>
        <div><dt><Icon name="activity" size={15}/>内参基因</dt><dd>{fmt(p.config.references.join('、'))}</dd></div>
      </dl>}
    </Panel>
    <div className="stack">
      <Panel title="实验概览">
        <Metrics items={[
          { label: '样本', value: p.samples.length, icon: 'experiment' },
          { label: 'Target', value: p.targets.length, icon: 'activity', tone: 'mint' },
          { label: '有效孔', value: data?.wells.length ?? 0, icon: 'plate', tone: 'blue' },
          { label: '扩增循环', value: cycles || '—', icon: 'chart', tone: 'blue' },
        ]}/>
      </Panel>
      <Panel title="实验方案" action={<button onClick={openPrep}><Icon name="settings" size={15}/>编辑方案</button>}>
        <dl className="key-values">
          <div><dt>排板方向</dt><dd>{p.config.orientation === 'sample-rows' ? '行 = Sample，列 = Target' : '行 = Target，列 = Sample'}</dd></div>
          <div><dt>技术重复</dt><dd>{[...new Set(p.targets.map(target => target.replicates))].join(' / ') || '—'}</dd></div>
          <div><dt>qPCR 总体系</dt><dd>{fmt(total)} μL</dd></div>
          <div><dt>RNA 投入量</dt><dd>{fmt(p.config.rnaInput / 1000)} μg</dd></div>
          <div><dt>RT 反应体积</dt><dd>{p.config.rtTotal} μL → 稀释至 {p.config.rtTotal + p.config.rtWaterAfter} μL</dd></div>
          <div><dt>Master Mix 额外配置</dt><dd>{fmt(p.config.excess * 100)}%</dd></div>
        </dl>
      </Panel>
      {!data && <Panel><Empty title="添加第一份实验数据" text="导入仪器记录后即可查看孔板、曲线和分析结果。" action={<button className="primary" onClick={openImport}><Icon name="upload" size={16}/>数据导入</button>}/></Panel>}
    </div>
  </div>;
}

export function PrepPage({ project: p, change, importTemplate }: SetupProps & { importTemplate: (file: File) => void }) {
  const [mode, setMode] = useState<'rna' | 'mix' | 'samples' | 'advanced'>('rna');
  const [adding, setAdding] = useState<'sample' | 'target' | null>(null);
  const [configText, setConfigText] = useState('');
  const c = p.config;
  const mix = masterMix(p.layout, c);
  const total = Object.values(c.pcr).reduce((sum, value) => sum + value, 0);
  const mixRows = mix.map(row => [row.target, row.wells, ...Object.values(row.components), row.total, row.cdnaSeparate]);
  const mixHeaders = ['Target', '孔数', 'SYBR μL', 'F μL', 'R μL', '水 μL', 'Mix 合计 μL', '另加 cDNA μL'];
  const updateSample = (index: number, values: Partial<Sample>) => change('修改样本', next => { Object.assign(next.samples[index], values); });
  const updateRt = (key: 'rnaInput' | 'rtMix' | 'rtTotal' | 'rtWaterAfter', value: number | null) => {
    if (value !== null) void change('修改逆转录体系', next => { next.config[key] = value; });
  };
  return <>
    <Tabs label="实验准备视图" active={mode} onChange={value => { setMode(value); setAdding(null); }} values={[[ 'rna', 'RNA 与逆转录' ], [ 'mix', 'Master Mix' ], [ 'samples', '样本与靶标' ], [ 'advanced', '高级参数' ]]}/>
    {mode === 'rna' && <div className="page-grid prep-grid">
      <Panel title="RNA 与 RT 体系计算" note="填写 RNA 浓度后自动计算加样和补水体积。">
        <Table headers={['Sample', '浓度 (ng/μL)', 'RNA (μL)', '5× RT Mix (μL)', '水 (μL)', '状态']} empty="导入数据或在「样本与靶标」添加样本"
          rows={p.samples.map((sample, index) => {
            const recipe = rnaRecipe(sample, c);
            const tone = recipe.water !== null && recipe.water < 0 ? 'danger' : sample.concentration === null ? 'muted' : recipe.issues.length ? 'warn' : '';
            return [<strong>{sample.id}</strong>,
              <NumberEdit label={sample.id + ' RNA 浓度'} value={sample.concentration} onSave={value => updateSample(index, { concentration: value })}/>,
              fmt(recipe.volume), fmt(c.rtMix), fmt(recipe.water),
              <span className={'tag ' + tone} title={recipe.issues.join('；')}>{recipe.issues.length ? recipe.issues[0] : '✓ 正常'}</span>];
          })}/>
        <div className="panel-foot">RNA 体积 = RNA 投入量 ÷ 浓度。水量 = RT 总体积 − RT Mix − RNA 体积。</div>
      </Panel>
      <div className="stack">
        <Panel title="逆转录体系" note="修改数值并离开输入框即可保存。">
          <dl className="key-values editable-values">
            <div><dt>RNA 投入量</dt><dd><NumberEdit label="RNA 投入量 (μg)" value={c.rnaInput / 1000} onSave={value => updateRt('rnaInput', value === null ? null : value * 1000)}/> μg</dd></div>
            <div><dt>5× RT Mix</dt><dd><NumberEdit label="5× RT Mix" value={c.rtMix} onSave={value => updateRt('rtMix', value)}/> μL</dd></div>
            <div><dt>RT 总体积</dt><dd><NumberEdit label="RT 总体积" value={c.rtTotal} onSave={value => updateRt('rtTotal', value)}/> μL</dd></div>
            <div><dt>RT 后加水</dt><dd><NumberEdit label="RT 后加水" value={c.rtWaterAfter} onSave={value => updateRt('rtWaterAfter', value)}/> μL</dd></div>
          </dl>
        </Panel>
        <Panel title="逆转录程序">
          <ol className="timeline compact">{c.rtProgram.map((step, i) => <li key={i}><strong>{step.temperature} °C</strong><span>{step.minutes === null ? 'Hold' : step.minutes + ' min'}</span></li>)}</ol>
        </Panel>
        <div className="callout"><Icon name="check"/><div><strong>RT 后稀释</strong><p>加 {c.rtWaterAfter} μL 无核酸酶水，最终 cDNA 体积 {c.rtTotal + c.rtWaterAfter} μL。</p></div></div>
      </div>
    </div>}
    {mode === 'mix' && <div className="page-grid prep-grid">
      <Panel title="Master Mix · 随孔板更新" note={'单孔 ' + fmt(total) + ' μL，额外配置 ' + fmt(c.excess * 100) + '%。'}
        action={<button onClick={async () => {
          const saved = await change('导出配液清单', () => {}, { format: 'csv' });
          if (saved) download(csv([mixHeaders, ...mixRows]), 'master-mix.csv', 'text/csv');
        }} disabled={!mix.length}><Icon name="download" size={16}/>导出配液 CSV</button>}>
        <Table headers={mixHeaders} rows={mixRows.map(row => row.map(value => fmt(value)))} empty="分配孔位后显示配液量"/>
        <div className="panel-foot">按设计孔板计算用量，cDNA 单独加入。</div>
      </Panel>
      <Panel title="单孔反应体系">
        <dl className="key-values editable-values">
          {([['sybr', 'SYBR'], ['forward', '正向引物'], ['reverse', '反向引物'], ['cdna', 'cDNA'], ['water', '水']] as const).map(([key, label]) =>
            <div key={key}><dt>{label}</dt><dd><NumberEdit label={label + ' (μL)'} value={c.pcr[key]} onSave={value => {
              if (value !== null) void change('修改 qPCR 体系', next => { next.config.pcr[key] = value; });
            }}/> μL</dd></div>)}
          <div><dt>额外配置</dt><dd><NumberEdit label="额外配置 (%)" value={c.excess * 100} onSave={value => {
            if (value !== null) void change('修改额外配置比例', next => { next.config.excess = value / 100; });
          }}/> %</dd></div>
        </dl>
      </Panel>
    </div>}
    {mode === 'samples' && <div className="stack">
      <Panel title="样本与实验设计" note="填写生物学 ID、分组、控制孔类型和每个样本的 Target。"
        action={<button aria-expanded={adding === 'sample'} onClick={() => setAdding(adding === 'sample' ? null : 'sample')}><Icon name="plus" size={16}/>添加样本</button>}>
        {adding === 'sample' && <InlineTextForm label="样本名称" submit="保存样本" onCancel={() => setAdding(null)}
          validate={id => p.samples.some(sample => sample.id === id) ? '样本名称重复' : undefined}
          onSave={id => change('新增样本', next => {
            next.samples.push({ id, group: '', biologicalId: id, control: 'sample', concentration: null, availableRna: null });
          })}/>}
        <Table headers={['Sample', '生物学 ID', '分组', '类型', '可用 RNA (ng)', 'Targets（逗号分隔）']} rows={p.samples.map((sample, i) => [
          <strong>{sample.id}</strong>,
          ...(['biologicalId', 'group'] as const).map(key => <input key={sample[key]} aria-label={sample.id + ' ' + key} defaultValue={sample[key]} onBlur={event => {
            const value = event.currentTarget.value.trim();
            if (value !== sample[key]) void updateSample(i, { [key]: value });
          }}/>),
          <select aria-label={sample.id + ' 控制类型'} value={sample.control} onChange={event => updateSample(i, { control: event.target.value as Sample['control'] })}>
            {['sample', 'NTC', 'No-RT', 'positive'].map(value => <option key={value}>{value}</option>)}
          </select>,
          <NumberEdit label={sample.id + ' 可用 RNA'} value={sample.availableRna} onSave={value => updateSample(i, { availableRna: value })}/>,
          <input key={sample.targets?.join(',') ?? ''} aria-label={sample.id + ' Targets'} placeholder="全部" defaultValue={sample.targets?.join(',') ?? ''} onBlur={event => {
            const value = event.currentTarget.value.trim();
            if (value !== (sample.targets?.join(',') ?? '')) void updateSample(i, { targets: value ? value.split(',').map(v => v.trim()).filter(Boolean) : undefined });
          }}/>,
        ])}/>
      </Panel>
      <Panel title="Target 与技术重复"
        action={<button aria-expanded={adding === 'target'} onClick={() => setAdding(adding === 'target' ? null : 'target')}><Icon name="plus" size={16}/>添加 Target</button>}>
        {adding === 'target' && <InlineTextForm label="Target 名称" submit="保存 Target" onCancel={() => setAdding(null)}
          validate={name => p.targets.some(target => target.name === name) ? 'Target 名称重复' : undefined}
          onSave={name => change('新增 Target', next => {
            next.targets.push({ name, replicates: 3, efficiency: null, primerForward: '', primerReverse: '' });
          })}/>}
        <Table headers={['Target', '重复数', '效率 (0–1，记录用)', 'Forward primer', 'Reverse primer']} rows={p.targets.map((target, i) => [
          <strong>{target.name}</strong>,
          <NumberEdit label={target.name + ' 重复数'} value={target.replicates} step={1} onSave={value => {
            if (value !== null) void change('修改 Target', next => { next.targets[i].replicates = value; });
          }}/>,
          <NumberEdit label={target.name + ' 效率'} value={target.efficiency} onSave={value => change('修改 Target', next => { next.targets[i].efficiency = value; })}/>,
          ...(['primerForward', 'primerReverse'] as const).map(key => <input key={target[key]} aria-label={target.name + ' ' + key} defaultValue={target[key]} onBlur={event => {
            const value = event.currentTarget.value.trim();
            if (value !== target[key]) void change('修改 Target', next => { next.targets[i][key] = value; });
          }}/>),
        ])}/>
      </Panel>
    </div>}
    {mode === 'advanced' && <Panel title="体系与高级设置" note="编辑 RT 程序、板规格、质控阈值和其他实验参数。">
      <div className="actions">
        <button onClick={() => setConfigText(JSON.stringify(c, null, 2))}>读取当前参数</button>
        <button onClick={() => download(JSON.stringify(template(p), null, 2), 'qpcr-template.json', 'application/json')}><Icon name="download" size={16}/>导出方案模板</button>
        <label className="button"><Icon name="upload" size={16}/>导入模板为新项目<input type="file" accept=".json" onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) importTemplate(file);
        }}/></label>
      </div>
      <textarea aria-label="高级参数 JSON" value={configText} placeholder="读取当前参数后编辑 JSON" onChange={event => setConfigText(event.target.value)}/>
      <button className="primary" onClick={() => change('应用实验参数', next => {
        const config = JSON.parse(configText) as Config;
        if (!config.qc || !config.pcr || !Array.isArray(config.references) || config.method !== 'ddct') throw new Error('参数结构不完整');
        next.config = config;
        masterMix(next.layout, config);
      })}>应用参数</button>
    </Panel>}
  </>;
}

export function PlatePage({ project: p, data, change }: SetupProps & { data?: Dataset }) {
  const [plate, setPlate] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [swapMode, setSwapMode] = useState(false);
  const drag = useRef<{ pointerId: number; start: number; end: number; previous: string[]; append: boolean } | null>(null);
  const dragged = useRef(false);
  const [sample, setSample] = useState('');
  const [target, setTarget] = useState('');
  const plateCount = Math.max(1, ...p.layout.map(a => a.plate));
  const activePlate = Math.min(plate, plateCount);
  const assignments = p.layout.filter(a => a.plate === activePlate);
  const { rows, columns } = p.config;

  function startSelection(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (!event.isPrimary || event.button !== 0) return;
    dragged.current = false;
    if (swapMode) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      start: index,
      end: index,
      previous: selected,
      append: event.ctrlKey || event.metaKey,
    };
  }

  function extendSelection(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const well = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-well-index]');
    if (!well || !event.currentTarget.contains(well)) return;
    const index = Number(well.dataset.wellIndex);
    if (index === active.end) return;
    active.end = index;
    dragged.current = true;
    const startRow = Math.floor(active.start / columns), endRow = Math.floor(index / columns);
    const startCol = active.start % columns, endCol = index % columns;
    const next = new Set(active.append ? active.previous : []);
    for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row++) {
      for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col++) {
        next.add(wellName(row * columns + col, columns));
      }
    }
    setSelected([...next]);
  }

  function finishSelection(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (cancelled) setSelected(active.previous);
    drag.current = null;
  }

  return <div className="page-grid plate-grid">
    <div className="stack">
      <Panel title="布局设置">
        <div className="form-stack">
          <label>孔板规格<select aria-label="孔板规格" value={rows + 'x' + columns} onChange={async event => {
            const [r, c] = event.target.value.split('x').map(Number);
            if (await change('修改孔板规格', next => { next.config.rows = r; next.config.columns = c; })) setSelected([]);
          }}>
            <option value="8x12">96-well (8 × 12)</option><option value="16x24">384-well (16 × 24)</option>
            {!['8x12', '16x24'].includes(rows + 'x' + columns) && <option value={rows + 'x' + columns}>{rows} × {columns}</option>}
          </select></label>
          <label>排板方向<select value={p.config.orientation} onChange={event => {
            const value = event.target.value as Config['orientation'];
            void change('修改排板方向', next => { next.config.orientation = value; });
          }}><option value="sample-rows">行 = Sample</option><option value="sample-columns">列 = Sample</option></select></label>
          <label>板号<select value={activePlate} onChange={event => { setPlate(Number(event.target.value)); setSelected([]); }}>
            {Array.from({ length: plateCount }, (_, i) => <option key={i + 1} value={i + 1}>Plate {i + 1}</option>)}
          </select></label>
          <button className="primary" disabled={!p.samples.length || !p.targets.length} onClick={() => change('自动排板', next => {
            next.layout = autoLayout(next.samples, next.targets, next.config);
            setPlate(1);
            setSelected([]);
          })}><Icon name="plate" size={16}/>自动排板</button>
        </div>
      </Panel>
      <Panel title="Target 图例">
        <ul className="legend">{p.targets.map((item, i) => <li key={item.name}><i style={{ background: palette[i % palette.length] }}/><span>{item.name}</span><small>{assignments.filter(a => a.target === item.name).length} 孔</small></li>)}
          <li><i className="empty-dot"/><span>空孔</span><small>{rows * columns - assignments.length} 孔</small></li>
        </ul>
      </Panel>
    </div>
    <div className="stack">
      <Panel title={'Plate ' + activePlate}
        note={swapMode ? '拖动已分配的孔位，与目标孔位交换。' : '点击选择单孔，从一个孔拖到另一个孔可框选。按住 Ctrl / ⌘ 可追加。'}
        action={<><span className="tag">{assignments.length} / {rows * columns} 已分配</span>
          <button type="button" className="plate-swap" aria-pressed={swapMode} onClick={() => setSwapMode(!swapMode)}>交换模式</button></>}>
        <div className="plate-scroll"><div className={'plate' + (swapMode ? '' : ' plate-select')} style={{ '--columns': columns } as CSSProperties}
          onPointerMove={extendSelection} onPointerUp={event => finishSelection(event)}
          onPointerCancel={event => finishSelection(event, true)} onLostPointerCapture={event => finishSelection(event, true)}>
          <span/>{Array.from({ length: columns }, (_, i) => <span className="coordinate" key={i}>{i + 1}</span>)}
          {Array.from({ length: rows }, (_, row) => <div className="plate-row" key={row}>
            <span className="coordinate">{String.fromCharCode(65 + row)}</span>
            {Array.from({ length: columns }, (_, col) => {
              const well = wellName(row * columns + col, columns);
              const assignment = assignments.find(a => a.well === well);
              const index = p.targets.findIndex(t => t.name === assignment?.target);
              const title = well + (assignment ? ' · ' + assignment.sample + ' · ' + assignment.target : ' · 空孔');
              return <button key={well} type="button" className="well" aria-label={title} title={title} aria-pressed={selected.includes(well)} data-well-index={row * columns + col}
                style={{ '--well-color': index < 0 ? '#e8eeed' : palette[index % palette.length] } as CSSProperties}
                onPointerDown={event => startSelection(event, row * columns + col)}
                draggable={swapMode && Boolean(assignment)} onClick={event => {
                  if (event.detail && dragged.current) return;
                  setSelected(previous => event.ctrlKey || event.metaKey
                    ? previous.includes(well) ? previous.filter(value => value !== well) : [...previous, well] : [well]);
                }}
                onDragStart={event => event.dataTransfer.setData('text/qpcr-well', well)}
                onDragOver={event => { if (swapMode) event.preventDefault(); }} onDrop={event => {
                  if (!swapMode) return;
                  event.preventDefault();
                  const from = event.dataTransfer.getData('text/qpcr-well');
                  if (from === well || !assignments.some(a => a.well === from)) return;
                  void change('交换设计孔位', next => {
                    const origin = next.layout.find(a => a.plate === activePlate && a.well === from);
                    const destination = next.layout.find(a => a.plate === activePlate && a.well === well);
                    if (origin) origin.well = well;
                    if (destination) destination.well = from;
                  });
                }}/>;
            })}
          </div>)}
        </div></div>
        <div className="panel-foot">{rows * columns} 孔 · 已分配 {assignments.length} · 空孔 {rows * columns - assignments.length}</div>
      </Panel>
      <Panel title="孔位分配" note={selected.length ? '已选 ' + selected.length + ' 孔 · ' + selected.join('、') : '在上方孔板选择需要调整的孔位。'}>
        <div className="actions">
          <select aria-label="分配样本" value={sample} onChange={event => setSample(event.target.value)}><option value="">选择样本</option>{p.samples.map(s => <option key={s.id}>{s.id}</option>)}</select>
          <select aria-label="分配 Target" value={target} onChange={event => setTarget(event.target.value)}><option value="">选择 Target</option>{p.targets.map(t => <option key={t.name}>{t.name}</option>)}</select>
          <button className="primary" disabled={!selected.length || !sample || !target} onClick={() => change('手动分配设计孔', next => {
            const info = next.samples.find(s => s.id === sample);
            if (!info) throw new Error('请选择有效样本');
            next.layout = next.layout.filter(a => a.plate !== activePlate || !selected.includes(a.well));
            selected.forEach((well, index) => next.layout.push({ plate: activePlate, well, sample, target, replicate: index + 1, control: info.control }));
          })}>分配选中孔</button>
          <button disabled={!selected.length} onClick={() => change('清空设计孔', next => {
            next.layout = next.layout.filter(a => a.plate !== activePlate || !selected.includes(a.well));
          })}>清空选中孔</button>
          {data && activePlate === 1 && <button disabled={!selected.length || !sample || !target} onClick={() => change('修改分析孔位映射', next => {
            for (const well of selected) {
              if (!data.wells.some(w => w.well === well)) throw new Error('原始数据没有 ' + well);
              next.mappings[well] = { sample, target };
            }
          })}>重新映射仪器孔</button>}
        </div>
      </Panel>
    </div>
  </div>;
}
