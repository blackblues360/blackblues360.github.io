import {membershipAt} from './studies.mjs?v=20261120.3';

export const measurementTypes={'体重测量':'g','肿瘤测量':'mm³'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const colors=['#6349dc','#087f8c','#bd4e19','#2464b5','#a33677','#497b22'];

export function cohortMeasurements(db,{studyId,cohortId='',eventType='体重测量'}={}) {
  const study=(db.studies||[]).find(s=>s.id===studyId);
  if(!study||!measurementTypes[eventType])return [];
  if(cohortId&&!(db.cohorts||[]).some(c=>c.id===cohortId&&c.studyId===studyId))return [];
  return db.events.flatMap(event=>{
    if(event.type!==eventType||event.studyId&&event.studyId!==studyId)return [];
    const subject=event.participants?.find(p=>p.role==='subject')?.entityId||event.entityIds[0];
    const entity=db.entities.find(e=>e.id===subject&&e.type==='mouse');
    if(!entity)return [];
    const membership=membershipAt(db,entity.id,studyId,event.at);
    if(!membership||cohortId&&membership.cohortId!==cohortId)return [];
    if(event.studyId&&event.cohortId!==membership.cohortId)return [];
    const value=event.data.value,unit=event.data.unit;
    if(!Number.isFinite(value)||value<0||unit!==measurementTypes[eventType])return [];
    const cohort=db.cohorts.find(c=>c.id===membership.cohortId);
    return [{eventId:event.id,entityId:entity.id,name:entity.name,code:entity.code,studyId,studyName:study.name,
      cohortId:cohort.id,cohortName:cohort.name,membershipId:membership.id,
      lifecycleId:event.participants?.find(p=>p.entityId===entity.id)?.lifecycleId||'',
      at:event.at,value,unit,eventType,method:event.data.method||'',length:event.data.length??'',width:event.data.width??'',
      assignment:event.studyId?'事件已关联项目':'按历史成员有效期归属',
      correctionIds:db.events.filter(e=>e.correctedFrom===event.id).map(e=>e.id)}];
  }).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.code.localeCompare(b.code)||a.eventId.localeCompare(b.eventId));
}

export function measurementSeries(points) {
  const series=new Map();
  for(const point of points){
    const key=point.entityId+':'+point.membershipId+':'+point.lifecycleId;
    if(!series.has(key))series.set(key,{entityId:point.entityId,name:point.name,code:point.code,cohortName:point.cohortName,points:[]});
    series.get(key).points.push(point);
  }
  return [...series.values()].map(s=>({...s,points:s.points.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))}));
}

export function measurementCSV(points) {
  const cell=value=>'"'+String(value??'').replaceAll('"','""').replace(/^[\s]*[=+@-]/,"'$&")+'"';
  const rows=[['事件编号','小鼠编号','小鼠名称','项目','历史分组','成员期编号','实际时间（含时区）','测量类型','数值','单位','体积记录方式','长径（mm）','短径（mm）','归属依据','追加修正事件编号'],
    ...points.map(p=>[p.eventId,p.code,p.name,p.studyName,p.cohortName,p.membershipId,p.at,p.eventType,p.value,p.unit,p.method,p.length,p.width,p.assignment,p.correctionIds.join(';')])];
  return '\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}

export function measurementsPage(db,{studyId,cohortId='',eventType='体重测量'}={}) {
  const study=(db.studies||[]).find(s=>s.id===studyId)||(db.studies||[])[0];if(!study)return '';
  const cohorts=(db.cohorts||[]).filter(c=>c.studyId===study.id);
  if(cohortId&&!cohorts.some(c=>c.id===cohortId))cohortId='';
  if(!measurementTypes[eventType])eventType='体重测量';
  const points=cohortMeasurements(db,{studyId:study.id,cohortId,eventType}),series=measurementSeries(points);
  const entityIds=[...new Set(points.map(p=>p.entityId))],color=id=>colors[entityIds.indexOf(id)%colors.length];
  let chart='';
  if(points.length){
    const times=points.map(p=>Date.parse(p.at)),min=Math.min(...times),max=Math.max(...times),top=Math.max(1,...points.map(p=>p.value))*1.1;
    const x=p=>min===max?480:80+(Date.parse(p.at)-min)/(max-min)*800,y=value=>270-value/top*220;
    const ticks=Array.from({length:5},(_,i)=>top*i/4);
    chart=`<div class="cohort-chart-scroll"><svg class="cohort-chart" viewBox="0 0 960 340" role="img" aria-label="${eventType}个体曲线，按北京时间实际日期排列">
      ${ticks.map(v=>`<line x1="80" y1="${y(v)}" x2="880" y2="${y(v)}" stroke="#e6e8f2"/><text x="66" y="${y(v)+5}" text-anchor="end">${Number(v.toPrecision(3))}</text>`).join('')}
      <text x="80" y="25">${measurementTypes[eventType]}</text>
      ${series.map(s=>`${s.points.length>1?`<polyline fill="none" stroke="${color(s.entityId)}" stroke-width="2" points="${s.points.map(p=>x(p)+','+y(p.value)).join(' ')}"/>`:''}${s.points.map(p=>`<circle cx="${x(p)}" cy="${y(p.value)}" r="5" fill="${color(s.entityId)}"><title>${esc(p.name)} · ${esc(stamp(p.at))} · ${p.value} ${p.unit}${p.correctionIds.length?' · 有追加修正，查看原始事件':''}</title></circle>`).join('')}`).join('')}
      <text x="80" y="300">${esc(stamp(new Date(min)))}</text><text x="880" y="300" text-anchor="end">${min===max?'':esc(stamp(new Date(max)))}</text>
      <text x="480" y="330" text-anchor="middle">实际时间 · 北京时间（UTC+8）</text></svg></div>
      <div class="cohort-legend">${entityIds.map(id=>{const p=points.find(p=>p.entityId===id);return `<button data-entity="${id}"><i style="background:${color(id)}"></i>${esc(p.name)} · ${esc(p.code)}</button>`;}).join('')}</div>`;
  }
  return `<section class="card cohort-measurements"><div class="card-head"><h2>分组测量对比</h2><small>${entityIds.length} 只小鼠 · ${points.length} 条测量</small></div><div class="card-body">
    <div class="toolbar"><label>历史分组 <select id="measurementCohort" aria-label="测量分组"><option value="">项目全部分组</option>${cohorts.map(c=>`<option value="${c.id}" ${c.id===cohortId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label>测量类型 <select id="measurementType" aria-label="测量类型">${Object.keys(measurementTypes).map(type=>`<option ${type===eventType?'selected':''}>${type}</option>`).join('')}</select></label>
    <button data-action="exportMeasurements" ${points.length?'':'disabled'}>导出原始测量 CSV</button></div>
    <p class="form-hint">按测量发生时的项目成员有效期归属，转组不改变旧记录。已指定其他项目的事件不纳入；未指定项目的测量按历史成员期归属。横轴按实际时间比例排列，每只小鼠独立显示，跨成员期或生命周期不连线。</p>
    <p class="form-hint">连线仅连接已记录的测量点，不补值、不计算均值或误差。追加修正保留原值并标记，请从原始事件核对。</p>
    ${chart||'<div class="empty">当前项目 / 分组暂无此类有效测量；未入组时的测量或单位不匹配的旧记录不纳入。</div>'}</div>
    ${points.length?`<div class="table-wrap"><table><thead><tr><th>实际时间（北京时间）</th><th>小鼠</th><th>当时分组</th><th>测量值</th><th>方式 / 修正</th><th>追溯</th></tr></thead><tbody>${points.map(p=>`<tr class="measurement-row"><td>${esc(stamp(p.at))}</td><td><button data-entity="${p.entityId}">${esc(p.name)}</button><div class="code">${esc(p.code)}</div></td><td>${esc(p.cohortName)}</td><td>${p.value} ${p.unit}</td><td>${esc(p.method||'直接测量')}${p.correctionIds.length?'<span class="pill danger">有追加修正</span>':''}</td><td><button data-event="${p.eventId}">原始事件</button></td></tr>`).join('')}</tbody></table></div>`:''}</section>`;
}
