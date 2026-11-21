import {storageBoxes,locationBox} from './storage.mjs?v=20261121.6';
import {day} from './core.mjs?v=20261121.6';
import {passageLabel} from './profiles.mjs?v=20261121.6';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const timestamp=value=>value?new Date(Date.parse(value)+8*3600000).toISOString().slice(0,19)+'+08:00':'未知';
const states={active:'进行中',stored:'保存中',ended:'已结束'};

export function collectStorageInventory(db,{scope='box',boxId,includeEmpty=false}={}){
  if(!['box','all'].includes(scope))throw Error('存储导出范围不受支持');
  const all=storageBoxes(db),selected=all.find(b=>b.id===(boxId||all[0]?.id));
  if(scope==='box'&&!selected)throw Error('要导出的冻存盒不存在');
  const boxes=scope==='all'?all:[selected];
  return boxes.map(box=>{
    const occupants=new Map(db.entities.filter(e=>e.status!=='ended'&&locationBox(db,e.location)?.id===box.id).map(e=>[e.location,e]));
    const cells=Array.from({length:box.rows*box.columns},(_,i)=>{
      const coordinate=String.fromCharCode(65+Math.floor(i/box.columns))+(i%box.columns+1),location=box.path+'/'+coordinate,e=occupants.get(location);
      if(!e)return {coordinate,location,entity:null};
      const history=db.storageHistory?.find(h=>h.entityId===e.id&&h.location===location&&!h.validTo);
      const freeze=db.events.filter(v=>v.type==='冻存'&&v.entityIds.includes(e.id)).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).at(-1);
      const imported=db.events.find(v=>v.inventorySourceName&&v.entityIds.includes(e.id));
      const cellLine=db.entities.find(v=>v.id===e.cellLineId);
      return {coordinate,location,entity:e,code:e.code,name:e.name,state:states[e.status]||e.status,subtype:e.subtype,
        cellLine:cellLine?`${cellLine.name} · ${cellLine.code}`:e.cellLineId||'',passage:e.type==='cell'?passageLabel(e):'',
        frozenDate:e.attributes?.frozenDate||(freeze?day(freeze.at):'未知'),storedAt:timestamp(history?.validFrom),
        timeSource:history?.validFrom?'操作记录':'未知（旧位置快照或缺少来源）',
        quantity:Number.isFinite(e.quantity)?e.quantity:'未知',unit:e.unit||'',cryoprotectant:e.attributes?.cryoprotectant||freeze?.data?.cryoprotectant||'',source:e.attributes?.source||'',notes:e.attributes?.notes||'',importSource:imported?.inventorySourceName||'',importRow:imported?.inventorySourceRow??''};
    });
    return {box,cells,occupied:occupants.size,empty:box.rows*box.columns-occupants.size,records:includeEmpty?cells:cells.filter(c=>c.entity)};
  });
}

export function storageInventoryCSV(db,options={}){
  const {workspace='我的研究空间',generatedAt=new Date().toISOString(),includeNotes=false}=options,inventory=collectStorageInventory(db,options);
  const headers=['研究空间','生成时间（Asia/Shanghai）','盒名称','盒类型','盒路径','格位','占用状态','实体编号','实体名称','实体类型','当前状态','所属细胞系','传代次数','实际冻存日期','当前位置存入时间（Asia/Shanghai）','位置时间来源','当前数量','单位','冻存液','来源','库存导入文件','原表行号',...(includeNotes?['档案备注']:[])];
  const rows=inventory.flatMap(({box,records})=>records.map(c=>[workspace,timestamp(generatedAt),box.name,box.kind==='cell'?'细胞盒':'样品盒',box.path,c.coordinate,c.entity?'占用':'空位',c.code,c.name,c.subtype,c.state,c.cellLine,c.passage,c.frozenDate,c.storedAt,c.timeSource,c.quantity,c.unit,c.cryoprotectant,c.source,c.importSource,c.importRow,...(includeNotes?[c.notes]:[])]));
  // Quote every field and neutralize formula prefixes, including leading whitespace.
  const csv=value=>{let s=String(value??'');if(/^[\s\u0000-\u001f]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return '\ufeff'+[headers,...rows].map(row=>row.map(csv).join(',')).join('\r\n');
}

export function renderStorageReport(db,options={}){
  const {workspace='我的研究空间',generatedAt=new Date().toISOString(),includeNotes=false,includeEmpty=false,scope='box'}=options,inventory=collectStorageInventory(db,options);
  const occupied=inventory.reduce((n,b)=>n+b.occupied,0),capacity=inventory.reduce((n,b)=>n+b.cells.length,0);
  const boxes=inventory.map(({box,cells,records,occupied,empty})=>{
    // Large sample boxes are split into readable 9x9 panels rather than shrinking
    // a 26-column layout beyond legibility on A4 paper.
    let grids='';
    for(let row=0;row<box.rows;row+=9)for(let col=0;col<box.columns;col+=9){
      const rows=Math.min(9,box.rows-row),columns=Math.min(9,box.columns-col);
      grids+=`<div class="report-storage-grid"><h3>${esc(box.name)} · 格位布局 · ${String.fromCharCode(65+row)}-${String.fromCharCode(64+row+rows)} / ${col+1}-${col+columns}</h3><table><thead><tr><th></th>${Array.from({length:columns},(_,c)=>`<th>${col+c+1}</th>`).join('')}</tr></thead><tbody>${Array.from({length:rows},(_,r)=>`<tr><th>${String.fromCharCode(65+row+r)}</th>${Array.from({length:columns},(_,c)=>{const cell=cells[(row+r)*box.columns+col+c];return `<td class="${cell.entity?'report-occupied':''}"><b>${cell.coordinate}</b><span>${cell.entity?esc(cell.code):'空位'}</span></td>`;}).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    const list=records.length?`<div class="report-storage-list"><table><thead><tr>${['格位','编号 / 名称','类型 / 状态 / P 数','数量 / 单位','实际冻存日期','当前存入时间'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>${records.map(c=>c.entity?`<tbody><tr><td>${c.coordinate}</td><td>${esc(c.code)}<br>${esc(c.name)}</td><td>${esc(c.subtype)}<br>${esc(c.state)} ${esc(c.passage)}</td><td>${esc(c.quantity)} ${esc(c.unit)}</td><td>${esc(c.frozenDate)}</td><td>${esc(c.storedAt)}<br><small>${esc(c.timeSource)}</small></td></tr><tr class="report-storage-extra"><td colspan="6">${esc([c.cellLine&&'细胞系：'+c.cellLine,c.cryoprotectant&&'冻存液：'+c.cryoprotectant,c.source&&'来源：'+c.source,c.importSource&&'导入来源：'+c.importSource+' · 原表第 '+c.importRow+' 行',includeNotes&&c.notes&&'备注：'+c.notes].filter(Boolean).join('；')||'无附加档案信息')}</td></tr></tbody>`:`<tbody><tr><td>${c.coordinate}</td><td colspan="5">空位</td></tr></tbody>`).join('')}</table></div>`:'<p class="report-muted">本盒没有当前占用记录。</p>';
    return `<section class="report-section report-storage-box"><h2>${esc(box.name)} · ${box.kind==='cell'?'细胞冻存盒':'样品盒'}</h2><p class="report-box-path">${esc(box.path)}</p><p>${box.rows} × ${box.columns} · 已占用 ${occupied} · 空位 ${empty}</p>${grids}<h3>当前存储清单${includeEmpty?'（含空位）':'（仅占用格位）'}</h3>${list}</section>`;
  }).join('');
  return `<header class="report-title"><div>Life Atlas · 存储清单报告</div><h1>${inventory.length===1?esc(inventory[0].box.name):'全部冻存盒与样品盒'}</h1></header><dl class="report-meta"><dt>研究空间</dt><dd>${esc(workspace)}</dd><dt>生成时间</dt><dd>${esc(timestamp(generatedAt))}（Asia/Shanghai）</dd><dt>数据版本</dt><dd>V${esc(db.version)} / 修订 ${esc(db.revision)}</dd><dt>导出范围</dt><dd>${scope==='all'?'全部盒':'当前盒'} · ${inventory.length} 个盒 · ${capacity} 个格位 · 已占用 ${occupied} · ${includeNotes?'包含备注':'不含备注'} · ${includeEmpty?'清单含空位':'清单仅占用格位'}</dd></dl><p class="report-muted">生成时的当前存储快照，不含已取出、已复苏或已结束记录。实际冻存日期与当前位置存入时间分别列示；未知信息不补造。布局图始终显示全部格位，较大样品盒按行列分区展示。</p>${boxes}`;
}
