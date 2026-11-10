import { useRef, useState } from 'react';
import type { Dataset, Project } from './model';
import { download, Empty, fmt, Icon, Panel, Table, Tabs, type Change } from './ui';

export function ImportPage({ project: p, data, change, loadFiles, openQc }: {
  project: Project; data?: Dataset; change: Change; loadFiles: (files: File[]) => void; openQc: () => void;
}) {
  const [view, setView] = useState<'files' | 'raw'>('files');
  const [dragging, setDragging] = useState(false);
  const [sheet, setSheet] = useState('');
  const [page, setPage] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const raw = data?.rawTables[sheet];
  const cycles = Math.max(0, ...(data?.wells.map(w => w.amplification.length) ?? []));
  const melt = Math.max(0, ...(data?.wells.map(w => w.melt.length) ?? []));
  const comparison = [...p.events].reverse().find(event => event.action === '导入及解析' &&
    (event.detail as { crossValidation?: { matches: boolean } } | undefined)?.crossValidation?.matches);
  const cross = (comparison?.detail as { crossValidation: { checked: number } } | undefined)?.crossValidation;
  return <>
    <Tabs label="导入视图" active={view} onChange={setView} values={[['files', '导入文件'], ['raw', '原始表格']]}/>
    {view === 'files' ? <div className="page-grid import-grid">
      <div className="stack">
        <Panel className="upload-panel">
          <div className={'drop-zone' + (dragging ? ' dragging' : '')}
            onDragOver={event => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={event => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) loadFiles(Array.from(event.dataTransfer.files)); }}>
            <span className="upload-icon"><Icon name="upload" size={32}/></span>
            <h2>拖拽仪器文件到此处</h2>
            <p>支持 .eds（仪器工程）和 .xlsx（导出工作簿）</p>
            <div className="actions"><button className="primary" onClick={() => fileInput.current?.click()}>选择文件</button>
              <button onClick={() => setView('raw')} disabled={!data}>查看原始数据</button></div>
            <input ref={fileInput} aria-label="选择仪器文件" className="hidden-input" type="file" accept=".eds,.xlsx" multiple onChange={event => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              if (files.length) loadFiles(files);
            }}/>
          </div>
        </Panel>
        <Panel title="已导入文件" note={p.sources.length + ' 份本地来源'}>
          {p.sources.length ? <ul className="files">{p.sources.map(source => <li key={source.id}>
            <span className="icon-tile"><Icon name="file"/></span><div><strong>{source.name}</strong><small>{source.dataset.format.toUpperCase()} · {fmt(source.bytes.length / 1048576, 1)} MB · SHA-256 已计算</small></div>
            <span className="tag"><Icon name="check" size={14}/>已解析</span>
            <button className="icon-button" aria-label={'下载原始文件 ' + source.name} title={source.hash} onClick={() => download(source.bytes, source.name)}><Icon name="download" size={17}/></button>
          </li>)}</ul> : <Empty title="等待导入文件" text="同一实验的 EDS 和 XLSX 可同时选择。"/>}
        </Panel>
      </div>
      <div className="stack">
        <Panel title="识别结果">
          <dl className="key-values">
            <div><dt>仪器</dt><dd>{fmt(data?.instrument)}</dd></div>
            <div><dt>孔板</dt><dd>{data ? data.rows * data.columns + ' 孔 · ' + data.wells.length + ' 有效孔' : '—'}</dd></div>
            <div><dt>Sample / Target</dt><dd>{data ? data.samples.length + ' / ' + data.targets.length : '—'}</dd></div>
            <div><dt>扩增循环</dt><dd>{cycles || '—'}</dd></div>
            <div><dt>熔解采集点</dt><dd>{melt || '—'}</dd></div>
          </dl>
          {data && <button onClick={openQc}>查看质量控制<Icon name="chevron" size={14}/></button>}
        </Panel>
        {cross && <div className="callout"><Icon name="shield" size={20}/><div><strong>来源属于同一次实验</strong><p>{cross.checked.toLocaleString()} 项交叉验证通过。孔位、Ct 和曲线数据已核对。</p></div></div>}
        <div className="privacy-note"><Icon name="shield" size={16}/>仪器文件保存在本机浏览器</div>
      </div>
    </div> : <Panel title="原始表格 / 文件" note="查看解析时保留的仪器记录。">
      <div className="actions">
        <label>数据来源<select value={p.activeSource} onChange={event => {
          const value = event.target.value;
          setSheet(''); setPage(0);
          void change('切换数据来源', next => { next.activeSource = value; });
        }}>{p.sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
        <label>原始表<select value={sheet} onChange={event => { setSheet(event.target.value); setPage(0); }}>
          <option value="">选择原始表</option>{Object.keys(data?.rawTables ?? {}).map(key => <option key={key}>{key}</option>)}
        </select></label>
      </div>
      {typeof raw === 'string' ? <><p className="muted-copy">预览前 30,000 字符。</p><pre>{raw.slice(0, 30000)}</pre></>
        : raw ? <>
          <div className="actions panel-foot"><button disabled={!page} onClick={() => setPage(page - 1)}>上一页</button>
            <span>第 {page + 1} 页 · {raw.length} 行</span><button disabled={(page + 1) * 100 >= raw.length} onClick={() => setPage(page + 1)}>下一页</button></div>
          <Table headers={['行', ...Array.from({ length: Math.max(0, ...raw.slice(page * 100, page * 100 + 100).map(row => row.length)) }, (_, i) => String(i + 1))]}
            rows={raw.slice(page * 100, page * 100 + 100).map((row, i) => [page * 100 + i + 1, ...row.map(value => fmt(value))])}/>
        </> : <Empty title="选择原始表" text="数据导入后可查看工作簿各表或 EDS 内部记录。"/>}
    </Panel>}
  </>;
}
