import type { ReactNode } from 'react';
import type { Project } from './model';

export const pages = [
  { id: 'experiment', label: '实验信息', icon: 'experiment', title: '实验信息', description: '管理实验基本信息、方案和项目文件。' },
  { id: 'prep', label: '实验准备', icon: 'prep', title: '实验准备', description: '计算 RNA、逆转录和 qPCR 反应体系。' },
  { id: 'plate', label: '孔板设计', icon: 'plate', title: '孔板设计', description: '按样本、靶标和技术重复规划孔位。' },
  { id: 'import', label: '数据导入', icon: 'upload', title: '数据导入', description: '导入 QuantStudio EDS 或 XLSX，核对仪器记录。' },
  { id: 'qc', label: '质量控制', icon: 'shield', title: '质量控制', description: '检查 Ct、技术重复和扩增曲线，记录孔位取舍。' },
  { id: 'quant', label: '定量分析', icon: 'activity', title: '定量分析', description: '按生物学样本计算 ΔCt、ΔΔCt 和相对表达量。' },
  { id: 'stats', label: '统计与图表', icon: 'chart', title: '统计与图表', description: '汇总各组结果，查看个体数据点并导出图表。' },
  { id: 'history', label: '日志与版本', icon: 'history', title: '日志与版本', description: '追溯数据、参数和分析版本的变化。' },
] as const;
export type PageId = (typeof pages)[number]['id'];
export type Change = (action: string, mutate: (next: Project) => void | Promise<void>, detail?: unknown) => Promise<boolean>;

const paths = {
  experiment: 'M9 3h6m-5 0v6l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3M8 14h8',
  prep: 'M9 3h6M10 3v9l-4 4v3h12v-3l-4-4V3M8 15h8',
  plate: 'M4 4h16v16H4zM4 9h16M4 15h16M9 4v16M15 4v16',
  upload: 'M7 18H6a4 4 0 0 1-.4-8 6.4 6.4 0 0 1 12.5 1A3.5 3.5 0 0 1 18 18h-1M12 20V11m-3 3 3-3 3 3',
  shield: 'M12 3 4 6v5c0 5 3 8 8 10 5-2 8-5 8-10V6zM8.5 12l2.5 2.5 4.5-5',
  activity: 'M3 12h4l3-7 4 14 3-7h4',
  chart: 'M4 4v16h16M8 16v-4m4 4V8m4 8v-6',
  history: 'M3 12a9 9 0 1 1 2.7 6.4M3 7v5h5m4-5v5l3 2',
  file: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6',
  download: 'M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12 4 4L19 6',
  chevron: 'm9 6 6 6-6 6',
  edit: 'm4 16-1 5 5-1L20 8l-4-4zM13 7l4 4',
  settings: 'M4 7h16M4 17h16M9 4v6m6 4v6',
  folder: 'M3 6h7l2 2h9v12H3z',
  alert: 'm12 4 9 16H3zM12 10v4m0 3h.01',
  search: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm5 11 5 5',
} as const;
export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
export function Brand() {
  return <div className="brand">
    <svg viewBox="0 0 38 38" aria-hidden="true"><rect width="38" height="38" rx="11" fill="#e2f4ee"/><path d="M8 26c3.5 0 5-4.5 7-11s3.5-9 5.5-5c2 4 3.5 17 6.5 17 1.5 0 2.3-2 3-5M8 22c2.5 0 4 5 6.5 5s3-5 4.5-11" fill="none" stroke="#07836d" strokeWidth="2.15" strokeLinecap="round"/></svg>
    <div><strong>qPCR Analyzer</strong><small>RT-qPCR Analysis Suite</small></div>
  </div>;
}
export const fmt = (value: unknown, digits = 4) => typeof value === 'number' ? Number(value.toFixed(digits)).toString() : value === null || value === undefined || value === '' ? '—' : String(value);
export const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
export const palette = ['#128570', '#e4ab51', '#7375e7', '#8e9daf', '#42a9bf', '#cf749a', '#78a95e', '#9f81ca'];

export function Panel({ title, note, action, className = '', children }: { title?: string; note?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return <section className={'panel ' + className}>
    {title && <div className="panel-head"><div><h2>{title}</h2>{note && <p>{note}</p>}</div>{action && <div className="panel-actions">{action}</div>}</div>}
    {children}
  </section>;
}
export function Tabs<T extends string>({ values, active, onChange, label }: { values: [T, string][]; active: T; onChange: (v: T) => void; label: string }) {
  return <div className="tabs" role="group" aria-label={label}>{values.map(([id, title]) =>
    <button type="button" key={id} aria-pressed={active === id} onClick={() => onChange(id)}>{title}</button>)}</div>;
}
export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return <div className="empty"><span className="icon-tile"><Icon name="folder" size={22}/></span><strong>{title}</strong>{text && <p>{text}</p>}{action}</div>;
}
export function Table({ headers, rows, empty = '暂无数据', onRow, activeRow }: {
  headers: string[]; rows: ReactNode[][]; empty?: string; onRow?: (index: number) => void; activeRow?: number;
}) {
  return <div className="table-wrap"><table><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
    {rows.length ? rows.map((row, index) => <tr key={index} className={activeRow === index ? 'active-row' : ''}>
      {row.map((value, col) => <td key={col}>{col === 0 && onRow ? <button className="text-button" type="button" onClick={() => onRow(index)}>{value}</button> : value}</td>)}
    </tr>) : <tr><td className="empty-cell" colSpan={headers.length}>{empty}</td></tr>}
  </tbody></table></div>;
}
export function Metrics({ items }: { items: { label: string; value: ReactNode; icon: keyof typeof paths; tone?: string }[] }) {
  return <div className="metrics">{items.map(item => <div className="metric" key={item.label}>
    <span className={'icon-tile ' + (item.tone ?? '')}><Icon name={item.icon} size={16}/></span>
    <strong>{item.value}</strong><span>{item.label}</span>
  </div>)}</div>;
}
export function NumberEdit({ label, value, onSave, step = 'any' }: {
  label: string; value: number | null; onSave: (value: number | null) => void; step?: number | 'any';
}) {
  return <input key={String(value)} type="number" aria-label={label} defaultValue={value ?? ''} step={step}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    onBlur={event => {
      const next = event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber;
      if (next !== value && (next === null || Number.isFinite(next))) onSave(next);
    }}/>;
}
export function download(data: Uint8Array | string, name: string, type = 'application/octet-stream') {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function csv(rows: unknown[][]) {
  return '\uFEFF' + rows.map(row => row.map(value => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n');
}
