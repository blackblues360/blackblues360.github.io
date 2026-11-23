import {types,age,eventAge,isCellReference,lifecycle} from './core.mjs?v=20261123.1';
import {profileFields,passageLabel,animalAge} from './profiles.mjs?v=20261123.1';
import {fieldLabel} from './event-fields.mjs?v=20261123.1';

export const reportScopes={entity:'当前实体',upstream:'当前实体及全部上游',downstream:'当前实体及全部下游',lineage:'当前实体及全部上游、下游'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=(value,missing='未知')=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):missing;
const status={active:'进行中',stored:'保存中',ended:'已结束',waiting:'未启动计时',pending:'待执行',postponed:'已延期',cancelled:'已取消',completed:'已完成'};

export function collectEntityReport(db,id,{scope='entity',includePlans=false}={}){
  if(!db.entities.some(e=>e.id===id))throw Error('报告实体不存在');
  if(!Object.hasOwn(reportScopes,scope))throw Error('报告范围不受支持');
  const ids=new Set([id]);
  // Each direction starts at the selected entity, so an ancestor's other children
  // and a descendant's other parents cannot pull unrelated branches into scope.
  for(const direction of scope==='lineage'?['upstream','downstream']:[scope]){
    if(direction==='entity')continue;
    const seen=new Set([id]),queue=[id];
    for(let i=0;i<queue.length;i++)for(const r of db.relations){
      const from=direction==='upstream'?r.childId:r.parentId,to=direction==='upstream'?r.parentId:r.childId;
      if(from===queue[i]&&!seen.has(to)){seen.add(to);ids.add(to);queue.push(to);}
    }
  }
  return {
    entities:[db.entities.find(e=>e.id===id),...db.entities.filter(e=>e.id!==id&&ids.has(e.id))],
    events:db.events.filter(e=>e.entityIds.some(v=>ids.has(v))).slice().sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)),
    lifecycles:db.lifecycles.filter(l=>ids.has(l.entityId)),
    relations:db.relations.filter(r=>ids.has(r.parentId)&&ids.has(r.childId)),
    plans:includePlans?db.plans.filter(p=>ids.has(p.entityId)):[],
    locations:(db.storageHistory||[]).filter(h=>ids.has(h.entityId))
  };
}

export function renderEntityReport(db,id,{scope='entity',includeNotes=true,includePlans=false,workspace='我的研究空间',generatedAt=new Date().toISOString()}={}){
  const report=collectEntityReport(db,id,{scope,includePlans}),root=report.entities[0];
  const names=entityId=>{const e=db.entities.find(e=>e.id===entityId);return e?`${e.name} · ${e.code}`:entityId||'未关联';};
  const labels={...Object.fromEntries(['cell','sample','mouse'].flatMap(type=>profileFields(type,'冻存管').map(f=>[f.key,f.label]))),...Object.fromEntries(profileFields('cell','细胞系').map(f=>[f.key,f.label])),attributes:'档案字段',profile:'初始档案',before:'修订前',after:'修订后',passage:'传代次数',cellLineId:'所属细胞系',quantity:'数量',length:'长径',width:'短径',method:'测量方式',count:'数量',keepParent:'保留母本',location:'位置',reason:'原因',note:'备注',notes:'档案备注',source:'来源',unit:'单位'};
  const value=(data,event)=>{
    if(data===null||data===undefined)return '未知';
    if(typeof data==='boolean')return data?'是':'否';
    if(Array.isArray(data))return data.map(v=>value(v,event)).join('；');
    if(typeof data==='object')return Object.entries(data).filter(([k])=>includeNotes||!['note','notes'].includes(k)).map(([k,v])=>`${labels[k]||fieldLabel(event||{},k)}：${k==='cellLineId'?names(v):value(v,event)}`).join('；');
    return String(data);
  };
  const table=(heads,rows)=>rows.length?`<div class="report-table"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="report-muted">暂无记录</p>';
  const section=(title,body)=>`<section class="report-section"><h2>${title}</h2>${body}</section>`;
  const profiles=report.entities.map(e=>{
    const fields=[['实体编号',e.code],['类型',`${types[e.type]} / ${e.subtype}`],['当前状态',isCellReference(db,e)?'基础档案':status[e.status]||e.status],['当前生命周期',age(db,e.id,generatedAt)],['建档时间',stamp(e.createdAt)],['当前位置',e.location||'未分配']];
    if(e.type==='cell')fields.push(['传代次数',passageLabel(e)]);
    if(e.type==='mouse')fields.push(['实际年龄',animalAge(e,lifecycle(db,e.id)?.endAt||generatedAt)]);
    if(Number.isFinite(e.quantity))fields.push(['当前数量',`${e.quantity} ${e.unit||''}`]);
    if(e.cellLineId)fields.push(['所属细胞系',names(e.cellLineId)]);
    for(const f of profileFields(e.type,e.subtype))if((includeNotes||f.key!=='notes')&&e.attributes?.[f.key]!==undefined)fields.push([f.label,value(e.attributes[f.key])]);
    return `<h3>${esc(names(e.id))}</h3>${table(['档案项目','当前值'],fields)}`;
  }).join('');
  const cycles=report.lifecycles.slice().sort((a,b)=>Date.parse(a.acquiredAt)-Date.parse(b.acquiredAt)).map(l=>[names(l.entityId),`第 ${l.sequence??'未知'} 周期\n${l.id}`,stamp(l.acquiredAt),stamp(l.startAt,'未启动'),stamp(l.endAt,'未结束'),status[l.status]||l.status,l.sourceLifecycleId||'—']);
  const events=report.events.map(event=>{
    const participants=event.participants||event.entityIds.map(entityId=>({entityId,role:'subject'}));
    const rows=[['事件编号',event.id],['实际发生时间',stamp(event.at)],['记录创建时间',stamp(event.createdAt)],['操作人员',event.data?.operator||event.actor||'未知'],['参与实体',participants.map(p=>`${names(p.entityId)}（${({subject:'操作对象',input:'输入材料',output:'产出实体'})[p.role]||p.role}）`).join('；')],['生命周期位置',report.entities.filter(e=>event.entityIds.includes(e.id)).map(e=>`${e.code}：${eventAge(db,e.id,event)}`).join('；')]];
    if(event.correctedFrom)rows.push(['追加修正的原事件',event.correctedFrom]);
    if(event.planId)rows.push(['关联计划编号',event.planId]);
    if(event.inventorySourceName)rows.push(['库存导入来源',`${event.inventorySourceName} · ${event.inventorySourceCell?'原表单元格 '+event.inventorySourceCell+'（记录 '+event.inventorySourceRow+'）':'原表第 '+event.inventorySourceRow+' 行'}`]);
    if(event.studyId)rows.push(['实验项目',(db.studies||[]).find(s=>s.id===event.studyId)?.name||event.studyId]);
    for(const [key,v] of Object.entries(event.data||{}))if(includeNotes||!['note','notes'].includes(key))rows.push([labels[key]||fieldLabel(event,key),value(v,event)]);
    if(includeNotes&&event.note)rows.push(['事件备注',event.note]);
    return `<article class="report-event"><h3>${esc(event.type)}${event.correctedFrom?' · 追加修正':''}</h3>${table(['事件项目','记录值'],rows)}</article>`;
  }).join('');
  const measurements=report.events.filter(e=>['体重测量','肿瘤测量'].includes(e.type)&&Number.isFinite(e.data?.value)).map(e=>[stamp(e.at),e.entityIds.map(names).join('；'),e.type,e.data.value,e.data.unit||'未知',e.data.length??'—',e.data.width??'—']);
  return `<header class="report-title"><div>Life Atlas · 科研实体报告</div><h1>${esc(root.name)}</h1><p>${esc(root.code)} · ${esc(reportScopes[scope])}</p></header><dl class="report-meta"><dt>研究空间</dt><dd>${esc(workspace)}</dd><dt>生成时间</dt><dd>${esc(stamp(generatedAt))}（Asia/Shanghai）</dd><dt>数据版本</dt><dd>V${esc(db.version)} / 修订 ${esc(db.revision)}</dd><dt>导出范围</dt><dd>${report.entities.length} 个实体 · ${report.events.length} 条实际事件 · ${includePlans?'包含计划':'不含计划'} · ${includeNotes?'包含备注':'不含备注'}</dd></dl><p class="report-muted">档案为生成时的当前状态；历史事件保留原记录和追加修正，不重算历史状态。未知日期和传代次数保持未知。输入材料不自动计入谱系范围。</p>${section('实体档案',profiles)}${section('完整生命周期',table(['实体','周期编号','获得时间','计时起点 D0','结束时间','状态','来源生命周期编号'],cycles))}${section('范围内的来源与衍生关系',table(['来源实体','衍生实体','来源事件编号'],report.relations.map(r=>[names(r.parentId),names(r.childId),r.eventId||'未知'])))}${section('实际事件 · 按发生时间排序',events||'<p>暂无实际事件</p>')}${measurements.length?section('小鼠纵向测量',table(['实际时间','参与实体','测量类型','测量值','单位','长径 mm','短径 mm'],measurements)):''}${section('存储位置历史',table(['实体','位置','开始时间','结束时间','来源'],report.locations.map(h=>[names(h.entityId),h.location,stamp(h.validFrom),stamp(h.validTo,'当前占用'),h.source==='legacy_snapshot'?'历史快照（原日期未知）':'操作记录'])))}${includePlans?section('计划记录 · 不代表已发生事件',table(['实体','计划名称','原计划时间','下次时间','状态'],report.plans.map(p=>[names(p.entityId),p.name||p.eventType,stamp(p.scheduledAt||p.at),stamp(p.nextAt),status[p.status]||p.status]))):''}`;
}
