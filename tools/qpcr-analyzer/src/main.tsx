import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HistoryPage, QcPage, QuantPage, StatsPage } from './analysis-pages';
import { analyze } from './engine';
import { ImportPage } from './import-page';
import { newProject, type Dataset, type Project } from './model';
import { addSource, analysisKey, createVersion, exportProject, fromTemplate, hash, importProject, listProjects, log, saveProject, snapshot, validateProject } from './project';
import { ExperimentPage, PlatePage, PrepPage } from './setup-pages';
import { Brand, download, Icon, pages, time, type Change, type PageId } from './ui';
import './style.css';

function currentPage(): PageId {
  return pages.find(page => '#' + page.id === location.hash)?.id ?? 'experiment';
}
async function parseFile(file: File, bytes: Uint8Array): Promise<Dataset> {
  const worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('解析超时')), 60000);
      worker.onmessage = event => event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.dataset);
      worker.onerror = event => reject(new Error(event.message));
      worker.postMessage({ name: file.name, bytes });
    });
  } finally {
    clearTimeout(timer);
    worker.terminate();
  }
}

function App() {
  const [project, setProject] = useState(newProject);
  const [saved, setSaved] = useState<Project[]>([]);
  const [active, setActive] = useState(currentPage);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const onHashChange = () => { setActive(currentPage()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(() => {
    listProjects().then(value => {
      const projects = value.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setSaved(projects);
      if (projects[0]) setProject(projects[0]);
    }).catch(e => setError('无法读取本地项目：' + e.message)).finally(() => {
      lock.current = false;
      setBusy(false);
    });
  }, []);

  const page = pages.find(item => item.id === active)!;
  const data = project.sources.find(source => source.id === project.activeSource)?.dataset;
  const result = useMemo(() => {
    try { return { analysis: analyze(project), error: '' }; }
    catch (e) { return { analysis: null, error: String(e) }; }
  }, [analysisKey(project)]);

  function go(id: PageId) {
    if (id === active) return;
    if (!lock.current) setStatus('');
    location.hash = id;
    setActive(id);
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
  }
  async function task(fn: () => Promise<void>) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError('');
    try { await fn(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  async function persist(next: Project, expected?: string) {
    await saveProject(next, expected);
    setProject(next);
    setSaved((await listProjects()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }
  const change: Change = (action, mutate, detail) => task(async () => {
    const next = structuredClone(project);
    const before = snapshot(next);
    await mutate(next);
    await log(next, action, detail ?? { before, after: snapshot(next) });
    validateProject(next);
    const recalculate = next.sources.length && (analysisKey(next) !== analysisKey(project) || action === '重新分析' || action === '恢复版本');
    if (recalculate) await createVersion(next);
    await persist(next, project.updatedAt);
    setStatus(action + '，已保存到本地' + (recalculate ? '并生成分析版本' : ''));
  });
  function loadFiles(files: File[]) {
    void task(async () => {
      const next = structuredClone(project);
      let notice = '';
      for (const file of files) {
        setStatus('正在本地解析 ' + file.name + '…');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const dataset = await parseFile(file, bytes);
        const added = await addSource(next, { id: crypto.randomUUID(), name: file.name, hash: await hash(bytes), bytes, dataset });
        if (added.comparison && !added.comparison.matches) {
          await log(next, '交叉验证未通过（未合并）', added.comparison);
          await persist(next, project.updatedAt);
          setStatus('');
          throw new Error('与当前实验不一致，已阻止合并。' + added.comparison.differences.length + ' 处差异可在处理日志中查看。其他实验请新建项目后导入。');
        }
        notice = added.duplicate ? '相同文件已存在，已跳过重复导入' : '已导入 ' + file.name;
        if (added.comparison) notice += ' · ' + added.comparison.checked.toLocaleString() + ' 项交叉验证通过';
      }
      if (next.sources.length !== project.sources.length) await createVersion(next);
      await persist(next, project.updatedAt);
      setStatus(notice);
    });
  }
  function importTemplate(file: File) {
    void task(async () => {
      const next = fromTemplate(JSON.parse(await file.text()));
      await log(next, '导入实验方案模板', {});
      await persist(next);
      setStatus('已从模板新建项目');
    });
  }

  const props = { project, change };
  const analysisProps = { ...props, analysis: result.analysis };
  return <div className="shell">
    <aside className="sidebar">
      <Brand/>
      <div className="nav-label">实验工作流</div>
      <nav aria-label="实验工作流">
        {pages.map(item => <a key={item.id} href={'#' + item.id} aria-current={active === item.id ? 'page' : undefined}
          onClick={event => { event.preventDefault(); go(item.id); }}>
          <Icon name={item.icon}/><span>{item.label}</span>
          {active === item.id && <Icon name="chevron" size={14}/>}
        </a>)}
      </nav>
      <div className="sidebar-footer"><span className="local-dot"/><div><strong>本地模式</strong><small>数据存储于此浏览器</small></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="breadcrumb"><Icon name="folder" size={17}/><span>实验项目</span><Icon name="chevron" size={12}/><strong>{page.label}</strong></div>
        <div className="project-picker"><select aria-label="本地项目" disabled={busy} value={project.id} onChange={event => {
          const next = saved.find(item => item.id === event.target.value);
          if (next) {
            setProject(structuredClone(next));
            setError('');
            setStatus('已打开本地项目');
          }
        }}><option value={project.id}>{project.name}</option>{saved.filter(item => item.id !== project.id).map(item =>
          <option key={item.id} value={item.id}>{item.name} · {time(item.updatedAt)}</option>)}</select></div>
      </header>
      <main>
        <div className="page-head">
          <div><div className="eyebrow">WORKSPACE / {String(pages.indexOf(page) + 1).padStart(2, '0')}</div>
            <h1 ref={heading} tabIndex={-1}>{page.title}</h1><p>{page.description}</p></div>
          <div className="actions project-actions">
            <button disabled={busy} onClick={() => change('手动保存', () => {})}><Icon name="check" size={16}/>保存项目</button>
            <button disabled={busy} onClick={() => task(async () => {
              const next = newProject();
              await log(next, '新建项目', {});
              await persist(next);
              setStatus('已新建项目');
              go('experiment');
            })}><Icon name="plus" size={16}/>新建项目</button>
            <label className={'button' + (busy ? ' disabled' : '')}><Icon name="upload" size={16}/>恢复项目
              <input aria-label="恢复项目" type="file" accept=".qpcrproj" disabled={busy} onChange={event => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (!file) return;
                void task(async () => {
                  const next = await importProject(new Uint8Array(await file.arrayBuffer()));
                  next.id = crypto.randomUUID();
                  await log(next, '从备份恢复为独立项目', {});
                  await persist(next);
                  setStatus('项目校验通过，已恢复为独立副本');
                });
              }}/>
            </label>
            <button className="primary" disabled={busy} onClick={() => task(async () => {
              const next = structuredClone(project);
              await log(next, '导出完整项目', { format: 'qpcrproj' });
              const bytes = await exportProject(next);
              await persist(next, project.updatedAt);
              download(bytes, next.name + '.qpcrproj');
              setStatus('完整项目已导出');
            })}><Icon name="download" size={16}/>导出完整项目</button>
          </div>
        </div>
        <div role="status" className={busy || status ? 'status' : 'status sr-only'}>
          <Icon name={busy ? 'activity' : 'check'} size={15}/>{busy ? '处理中 · ' : ''}{status || '项目数据会自动保存'}
        </div>
        {error && <div role="alert" className="error"><Icon name="alert"/>{error}</div>}
        {result.error && ['qc', 'quant', 'stats'].includes(active) && <div role="alert" className="error">{result.error}</div>}
        <fieldset key={project.id + ':' + active} disabled={busy}>
          {active === 'experiment' && <ExperimentPage {...props} data={data} openImport={() => go('import')} openPrep={() => go('prep')}/>}
          {active === 'prep' && <PrepPage {...props} importTemplate={importTemplate}/>}
          {active === 'plate' && <PlatePage {...props} data={data}/>}
          {active === 'import' && <ImportPage {...props} data={data} loadFiles={loadFiles} openQc={() => go('qc')}/>}
          {active === 'qc' && <QcPage {...analysisProps}/>}
          {active === 'quant' && <QuantPage {...analysisProps}/>}
          {active === 'stats' && <StatsPage {...analysisProps} openQuant={() => go('quant')}/>}
          {active === 'history' && <HistoryPage {...props}/>}
        </fieldset>
        <footer><span>qPCR Analyzer</span><span>RT-qPCR Analysis Suite</span></footer>
      </main>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
