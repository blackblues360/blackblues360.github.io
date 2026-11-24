import {membershipAt} from './studies.mjs?v=20261124.2';
import {cohortMeasurements,measurementSeries,measurementTypes} from './measurements.mjs?v=20261124.2';
import {fieldLabel} from './event-fields.mjs?v=20261124.2';
import {profileFields} from './profiles.mjs?v=20261124.2';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=(value,missing='未知')=>value?new Date(Date.parse(value)+8*3600000).toISOString().slice(0,19)+'+08:00':missing;
const state={active:'进行中',stored:'保存中',ended:'已结束'};

export function collectStudyReport(db,{studyId,cohortId='',generatedAt=new Date().toISOString()}={}){
  const study=(db.studies||[]).find(s=>s.id===studyId);
  if(!study)throw Error('要导出的实验项目不存在');
  if(!Number.isFinite(Date.parse(generatedAt)))throw Error('报告生成时间无效');
  const cohorts=(db.cohorts||[]).filter(c=>c.studyId===studyId&&(!cohortId||c.id===cohortId));
  if(cohortId&&!cohorts.length)throw Error('分组不属于当前项目');
  const memberships=(db.memberships||[]).filter(m=>m.studyId===studyId&&(!cohortId||m.cohortId===cohortId)).slice().sort((a,b)=>Date.parse(a.joinedAt)-Date.parse(b.joinedAt)||a.id.localeCompare(b.id));
  const currentMemberships=memberships.filter(m=>Date.parse(m.joinedAt)<=Date.parse(generatedAt)&&(!m.leftAt||Date.parse(m.leftAt)>Date.parse(generatedAt)));
  const memberIds=new Set(memberships.map(m=>m.entityId)),entities=db.entities.filter(e=>memberIds.has(e.id));
  const selected=new Map();
  for(const event of db.events){
    if(event.correctedFrom||event.studyId&&event.studyId!==studyId)continue;
    const subject=event.participants?.find(p=>p.role==='subject')?.entityId||event.entityIds[0],entity=db.entities.find(e=>e.id===subject&&e.type==='mouse');
    if(!entity)continue;
    const membership=membershipAt(db,subject,studyId,event.at);
    if(!membership||cohortId&&membership.cohortId!==cohortId||event.studyId&&event.cohortId!==membership.cohortId)continue;
    selected.set(event.id,{event,entity,membership,assignment:event.studyId?'事件已关联项目':'按历史成员有效期归属'});
  }
  // Corrections follow their source event even after transfer/exit, including
  // corrections of corrections; they do not reassign that event to a new group.
  let added=true;
  while(added){
    added=false;
    for(const event of db.events){
      const source=selected.get(event.correctedFrom);
      if(!source||selected.has(event.id))continue;
      selected.set(event.id,{event,entity:source.entity,membership:source.membership,assignment:'随原事件纳入的追加修正'});added=true;
    }
  }
  const events=[...selected.values()].sort((a,b)=>Date.parse(a.event.at)-Date.parse(b.event.at)||a.event.id.localeCompare(b.event.id));
  const measurements=Object.fromEntries(Object.keys(measurementTypes).map(eventType=>[eventType,cohortMeasurements(db,{studyId,cohortId,eventType})]));
  return {study,cohorts,memberships,currentMemberships,entities,events,measurements};
}

export function studyMembershipCSV(db,options={}){
  const {workspace='我的研究空间',generatedAt=new Date().toISOString(),includeHistory=true,includeNotes=false}=options,report=collectStudyReport(db,{...options,generatedAt});
  const members=includeHistory?report.memberships:report.currentMemberships;
  const rows=[['研究空间','生成时间（Asia/Shanghai）','项目','分组','成员期编号','小鼠编号','小鼠名称','成员期状态','入组时间（Asia/Shanghai）','离组时间（Asia/Shanghai）','当前实体状态','当前品系','当前性别','当前基因型','当前笼位','登记人员','退出登记人员',...(includeNotes?['入组原因','退出原因']:[])],...members.map(m=>{
    const e=report.entities.find(e=>e.id===m.entityId),c=report.cohorts.find(c=>c.id===m.cohortId);
    return [workspace,stamp(generatedAt),report.study.name,c.name,m.id,e.code,e.name,report.currentMemberships.some(v=>v.id===m.id)?'有效':'已离组',stamp(m.joinedAt),stamp(m.leftAt,''),state[e.status]||e.status,e.attributes?.strain,e.attributes?.sex,e.attributes?.genotype,e.location,m.actor,m.closedBy,...(includeNotes?[m.reason,m.exitReason]:[])];
  })];
  const cell=value=>{let text=String(value??'');if(/^[\s\u0000-\u001f]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  return '\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}

function measurementChart(points,type){
  if(!points.length)return '<p class="report-muted">暂无此类有效测量记录。</p>';
  const series=measurementSeries(points),ids=[...new Set(points.map(p=>p.entityId))],colors=['#6048dc','#087f8c','#bd4e19','#2464b5','#a33677','#497b22'];
  const min=Math.min(...points.map(p=>Date.parse(p.at))),max=Math.max(...points.map(p=>Date.parse(p.at))),top=Math.max(1,...points.map(p=>p.value))*1.1;
  const x=p=>min===max?430:70+(Date.parse(p.at)-min)/(max-min)*720,y=v=>210-v/top*170,color=id=>colors[ids.indexOf(id)%colors.length];
  return `<div class="report-study-chart"><svg viewBox="0 0 860 280" role="img" aria-label="${type}个体曲线，按实际时间排列"><text x="70" y="20">${measurementTypes[type]}</text>${Array.from({length:5},(_,i)=>{const v=top*i/4;return `<line x1="70" y1="${y(v)}" x2="790" y2="${y(v)}" stroke="#dce0ed"/><text x="60" y="${y(v)+4}" text-anchor="end">${Number(v.toPrecision(3))}</text>`;}).join('')}${series.map(s=>`${s.points.length>1?`<polyline fill="none" stroke="${color(s.entityId)}" stroke-width="2" points="${s.points.map(p=>x(p)+','+y(p.value)).join(' ')}"/>`:''}${s.points.map(p=>`<circle cx="${x(p)}" cy="${y(p.value)}" r="4" fill="${color(s.entityId)}"/>`).join('')}`).join('')}<text x="70" y="242">${esc(stamp(new Date(min)).slice(0,19))}</text><text x="790" y="242" text-anchor="end">${min===max?'':esc(stamp(new Date(max)).slice(0,19))}</text><text x="430" y="268" text-anchor="middle">实际时间 · Asia/Shanghai（UTC+8）</text></svg><div class="report-study-legend">${series.map(s=>`<span><i style="background:${color(s.entityId)}"></i>${esc(s.name)} · ${esc(s.code)} · ${esc(s.cohortName)}</span>`).join('')}</div></div>`;
}

export function renderStudyReport(db,options={}){
  const {workspace='我的研究空间',generatedAt=new Date().toISOString(),cohortId='',includeHistory=true,includeMeasurements=true,includeEvents=true,includeNotes=false}=options,report=collectStudyReport(db,{...options,generatedAt});
  const entity=id=>db.entities.find(e=>e.id===id),name=id=>{const e=entity(id);return e?`${e.name} · ${e.code}`:id;},cohort=id=>report.cohorts.find(c=>c.id===id)?.name||id;
  const table=(heads,rows)=>rows.length?`<div class="report-table report-study-table"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="report-muted">暂无记录。</p>';
  const section=(title,body)=>`<section class="report-section"><h2>${title}</h2>${body}</section>`;
  const labels={...Object.fromEntries(profileFields('mouse').map(f=>[f.key,f.label])),profile:'初始档案',attributes:'档案字段',before:'修订前',after:'修订后',cellLineId:'所属细胞系',passage:'传代次数',quantity:'数量',note:'备注',reason:'原因'};
  const value=(data,event)=>{
    if(data===null||data===undefined)return '未知';
    if(typeof data==='boolean')return data?'是':'否';
    if(Array.isArray(data))return data.map(v=>value(v,event)).join('；');
    if(typeof data==='object')return Object.entries(data).filter(([k])=>includeNotes||!['note','notes','reason','exitReason'].includes(k)).map(([k,v])=>`${labels[k]||fieldLabel(event,k)}：${k==='cellLineId'&&v?name(v):value(v,event)}`).join('；');
    return String(data);
  };
  const summary=table(['分组','曾入组个体','当前有效成员','其中仍在管','体重记录','肿瘤记录'],report.cohorts.map(c=>{
    const history=report.memberships.filter(m=>m.cohortId===c.id),current=report.currentMemberships.filter(m=>m.cohortId===c.id);
    return [c.name,new Set(history.map(m=>m.entityId)).size,current.length,current.filter(m=>entity(m.entityId).status==='active').length,report.measurements['体重测量'].filter(p=>p.cohortId===c.id).length,report.measurements['肿瘤测量'].filter(p=>p.cohortId===c.id).length];
  }));
  const current=table(['小鼠 / 编号','当前分组','实体状态','当前笼位','当前品系 / 基因型'],report.currentMemberships.map(m=>{const e=entity(m.entityId);return [name(m.entityId),cohort(m.cohortId),state[e.status]||e.status,e.location||'未分配',[e.attributes?.strain,e.attributes?.genotype].filter(Boolean).join(' / ')||'未知'];}));
  const history=includeHistory?section('成员有效期与转组历史',table(['小鼠 / 成员期编号','历史分组','入组至离组时间（Asia/Shanghai）','登记 / 退出人员',...(includeNotes?['变更原因']:[])],report.memberships.map(m=>[name(m.entityId)+'\n'+m.id,cohort(m.cohortId),stamp(m.joinedAt)+'\n至 '+stamp(m.leftAt,'现在'),[m.actor,m.closedBy].filter(Boolean).join(' / '),...(includeNotes?[[m.reason,m.exitReason].filter(Boolean).join('；')]:[])]))):'';
  const measurements=includeMeasurements?Object.keys(measurementTypes).map(type=>{
    const points=report.measurements[type],invalid=report.events.filter(r=>r.event.type===type).length-points.length;
    return section(`${type} · ${points.length} 条有效记录`,measurementChart(points,type)+`<p class="report-muted">${invalid>0?`${invalid} 条数值或单位不符合要求的记录未纳入图表与测量表。`:''}连线仅连接同一个体、成员期和生命周期的已记录测量点，不补值、不计算均值或误差；追加修正保留原值。</p>`+table(['时间 / 事件编号','小鼠 / 当时分组','数值 / 单位','方式 / 长径 / 短径','归属 / 修正编号'],points.map(p=>[stamp(p.at)+'\n'+p.eventId,name(p.entityId)+'\n'+p.cohortName,p.value+' '+p.unit,[p.method,p.length!==''?'长径 '+p.length+' mm':'',p.width!==''?'短径 '+p.width+' mm':''].filter(Boolean).join('；')||'直接测量',p.assignment+(p.correctionIds.length?'\n追加修正：'+p.correctionIds.join('；'):'')])));
  }).join(''):'';
  const events=includeEvents?section(`实际事件与追加修正 · ${report.events.length} 条`,table(['时间 / 事件编号','小鼠 / 历史分组','事件类型 / 归属依据','记录参数'],report.events.map(({event:e,entity:subject,membership,assignment})=>[
    stamp(e.at)+'\n'+e.id,name(subject.id)+'\n'+cohort(membership.cohortId),e.type+'\n'+assignment,
    ['操作人员：'+(e.data?.operator||e.actor||'未知'),'参与实体：'+(e.participants||e.entityIds.map(entityId=>({entityId,role:'subject'}))).map(p=>name(p.entityId)+'（'+({subject:'操作对象',input:'输入材料',output:'产出实体'}[p.role]||p.role)+'）').join('；'),e.correctedFrom&&'原事件：'+e.correctedFrom,value(e.data||{},e),includeNotes&&e.note&&'事件备注：'+e.note].filter(Boolean).join('\n')
  ]))):'';
  const uniqueCurrent=new Set(report.currentMemberships.map(m=>m.entityId)).size;
  return `<header class="report-title"><div>Life Atlas · 实验项目报告</div><h1>${esc(report.study.name)}</h1><p>${esc(cohortId?cohort(cohortId):'项目全部分组')}</p></header><dl class="report-meta"><dt>研究空间</dt><dd>${esc(workspace)}</dd><dt>生成时间</dt><dd>${esc(stamp(generatedAt))}（Asia/Shanghai）</dd><dt>数据版本</dt><dd>V${esc(db.version)} / 修订 ${esc(db.revision)}</dd><dt>导出范围</dt><dd>${report.cohorts.length} 个分组 · ${report.entities.length} 只曾入组小鼠 · ${uniqueCurrent} 只当前有效成员 · ${report.events.length} 条范围内实际事件（含追加修正）</dd><dt>正文内容</dt><dd>${includeHistory?'含成员历史':'仅当前成员清单'} · ${includeMeasurements?'含测量图表':'不含测量图表'} · ${includeEvents?'含事件明细':'不含事件明细'} · ${includeNotes?'含说明和备注':'不含说明和备注'}</dd></dl>${includeNotes&&report.study.description?`<p class="report-study-description">${esc(report.study.description)}</p>`:''}<p class="report-muted">当前成员与档案为生成时快照，仍有效的成员关系可能对应已结束个体。事件和测量按发生时的成员有效期归属，成员清单的当前 / 历史选择不改变事件范围；已关联其他项目的原事件不纳入。追加修正随原事件保留，不改变原始值与历史分组。计划不作为实际事件导出。</p>${section('分组概览',summary)}${section('当前有效成员',current)}${history}${measurements}${events}`;
}
