const required=(condition,message)=>{if(!condition)throw Error(message);};
const uid=prefix=>prefix+'-'+crypto.randomUUID();
export function membershipAt(db,entityId,studyId,at=new Date().toISOString()) {
  const time=Date.parse(at);
  return (db.memberships||[]).find(m=>m.entityId===entityId&&m.studyId===studyId&&Date.parse(m.joinedAt)<=time&&(!m.leftAt||Date.parse(m.leftAt)>time));
}
export function applyStudyCommand(db,type,p,at,actor) {
  db.studies ||= [];db.cohorts ||= [];db.memberships ||= [];db.tags ||= [];db.entityTags ||= [];
  required(Date.parse(at)<=Date.now(),'未来分组变更请在实际发生时记录');
  if(type==='study') {
    required(typeof p.name==='string'&&p.name.trim()&&p.name.length<=120,'请填写有效项目名称');
    required(!db.studies.some(s=>s.name===p.name.trim()),'项目名称已存在');
    const study={id:uid('ST'),name:p.name.trim(),description:String(p.description||'').slice(0,2000),createdAt:at,actor};
    db.studies.push(study);return study.id;
  }
  if(type==='cohort') {
    required(db.studies.some(s=>s.id===p.studyId),'项目不存在');
    required(typeof p.name==='string'&&p.name.trim()&&p.name.length<=120,'请填写有效分组名称');
    required(!db.cohorts.some(c=>c.studyId===p.studyId&&c.name===p.name.trim()),'项目内分组名称已存在');
    const cohort={id:uid('CO'),studyId:p.studyId,name:p.name.trim(),createdAt:at,actor};db.cohorts.push(cohort);return cohort.id;
  }
  const entity=db.entities.find(e=>e.id===p.entityId);required(entity,'实体不存在');
  required(Date.parse(at)>=Date.parse(entity.createdAt),'变更时间不能早于实体获得时间');
  if(type==='membership') {
    required(entity.type==='mouse','正式分组仅适用于小鼠');required(db.studies.some(s=>s.id===p.studyId),'项目不存在');
    required(!p.cohortId||entity.status==='active','已结束个体不能加入新的分组');
    required(!p.cohortId||db.cohorts.some(c=>c.id===p.cohortId&&c.studyId===p.studyId),'分组不属于当前项目');
    const history=db.memberships.filter(m=>m.entityId===entity.id&&m.studyId===p.studyId);
    required(history.every(m=>Date.parse(m.leftAt||m.joinedAt)<=Date.parse(at)),'请按实际时间顺序记录分组变更');
    const current=history.find(m=>!m.leftAt);
    required(!current||current.cohortId!==p.cohortId,'已经在当前分组');
    required(current||p.cohortId,'当前没有可退出的分组');
    if(current){required(typeof p.reason==='string'&&p.reason.trim(),'转组或退出必须填写原因');current.leftAt=at;current.exitReason=p.reason.trim();current.closedBy=actor;}
    if(p.cohortId){const membership={id:uid('MB'),studyId:p.studyId,cohortId:p.cohortId,entityId:entity.id,joinedAt:at,leftAt:null,actor,reason:String(p.reason||'')};db.memberships.push(membership);return membership.id;}
    return current.id;
  }
  required(type==='tag'&&['add','remove'].includes(p.action),'标签操作无效');
  required(typeof p.name==='string'&&p.name.trim()&&p.name.length<=60,'请输入 1–60 字的标签');
  let tag=db.tags.find(t=>t.name===p.name.trim());
  if(!tag&&p.action==='add'){tag={id:uid('TAG'),name:p.name.trim()};db.tags.push(tag);}
  required(tag,'标签不存在');
  const history=db.entityTags.filter(t=>t.entityId===entity.id&&t.tagId===tag.id);
  required(history.every(t=>Date.parse(t.removedAt||t.addedAt)<=Date.parse(at)),'请按实际时间顺序记录标签变更');
  const active=history.find(t=>!t.removedAt);
  if(p.action==='add'){required(!active,'标签已经存在');const link={id:uid('ET'),entityId:entity.id,tagId:tag.id,addedAt:at,removedAt:null,actor};db.entityTags.push(link);return link.id;}
  required(active,'当前实体没有此标签');active.removedAt=at;active.removedBy=actor;return active.id;
}
export function validateStudies(db) {
  for(const key of ['studies','cohorts','memberships','tags','entityTags']){
    if(db[key]===undefined)continue;
    required(Array.isArray(db[key])&&db[key].every(v=>v&&typeof v.id==='string')&&new Set(db[key].map(v=>v.id)).size===db[key].length,'项目或标签记录格式无效');
  }
  const studies=db.studies||[],cohorts=db.cohorts||[],memberships=db.memberships||[],tags=db.tags||[],links=db.entityTags||[];
  const validDate=value=>Number.isFinite(Date.parse(value));
  required(new Set(studies.map(s=>s.name)).size===studies.length&&new Set(cohorts.map(c=>c.studyId+':'+c.name)).size===cohorts.length&&new Set(tags.map(t=>t.name)).size===tags.length,'项目、分组或标签名称重复');
  studies.forEach(s=>required(typeof s.name==='string'&&s.name.trim()&&validDate(s.createdAt),'项目数据无效'));
  cohorts.forEach(c=>required(studies.some(s=>s.id===c.studyId)&&typeof c.name==='string'&&c.name.trim()&&validDate(c.createdAt),'分组关联无效'));
  memberships.forEach(m=>{
    required(db.entities.some(e=>e.id===m.entityId&&e.type==='mouse')&&cohorts.some(c=>c.id===m.cohortId&&c.studyId===m.studyId)&&studies.some(s=>s.id===m.studyId),'成员关系无效');
    required(validDate(m.joinedAt)&&(!m.leftAt||validDate(m.leftAt)&&Date.parse(m.leftAt)>=Date.parse(m.joinedAt)),'成员有效期无效');
    required(!memberships.some(other=>other!==m&&other.entityId===m.entityId&&other.studyId===m.studyId&&Date.parse(other.joinedAt)<(m.leftAt?Date.parse(m.leftAt):Infinity)&&Date.parse(m.joinedAt)<(other.leftAt?Date.parse(other.leftAt):Infinity)),'同一项目分组有效期重叠');
  });
  tags.forEach(t=>required(typeof t.name==='string'&&t.name.trim(),'标签数据无效'));
  links.forEach(t=>required(db.entities.some(e=>e.id===t.entityId)&&tags.some(tag=>tag.id===t.tagId)&&validDate(t.addedAt)&&(!t.removedAt||validDate(t.removedAt)&&Date.parse(t.removedAt)>=Date.parse(t.addedAt)),'实体标签关联无效'));
  const activeLinks=links.filter(t=>!t.removedAt);required(new Set(activeLinks.map(t=>t.entityId+':'+t.tagId)).size===activeLinks.length,'实体存在重复有效标签');
  db.events.forEach(e=>{if(!e.studyId)return;const m=membershipAt(db,e.entityIds[0],e.studyId,e.at);required(m&&m.cohortId===e.cohortId,'事件项目分组关联无效');});
}

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function studiesPage(db,selectedId) {
  const studies=db.studies||[],study=studies.find(s=>s.id===selectedId)||studies[0],cohorts=(db.cohorts||[]).filter(c=>c.studyId===study?.id),mice=db.entities.filter(e=>e.type==='mouse');
  return `<div class="toolbar"><select id="studyView" aria-label="实验项目"><option value="">选择项目</option>${studies.map(s=>`<option value="${s.id}" ${s.id===study?.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select><button class="primary" data-study-action="create">新建项目</button>${study?`<button data-study-action="cohort" data-study-id="${study.id}">新建分组</button><button data-study-action="assign" data-study-id="${study.id}">分配 / 调整成员</button>`:''}<button data-study-action="tag">管理自由标签</button></div>
    ${study?`<section class="card"><div class="card-head"><h2>${esc(study.name)}</h2><small>${esc(study.description)}</small></div><div class="card-body">${cohorts.map(c=>`<span class="pill purple" style="margin:5px">${esc(c.name)} · ${(db.memberships||[]).filter(m=>m.cohortId===c.id&&!m.leftAt).length} 只</span>`).join('')||'<p class="muted">请先建立项目分组</p>'}</div></section>`:'<section class="card"><div class="empty">创建项目并建立分组；一只小鼠可参与多个项目。</div></section>'}
    <section class="card"><div class="card-head"><h2>小鼠成员与自由标签</h2></div><div class="table-wrap"><table><thead><tr><th>小鼠</th><th>当前项目分组</th><th>自由标签</th><th>成员历史</th></tr></thead><tbody>${mice.map(e=>{const member=study?membershipAt(db,e.id,study.id):null,history=(db.memberships||[]).filter(m=>m.entityId===e.id&&m.studyId===study?.id);return `<tr><td><button data-entity="${e.id}">${esc(e.name)}</button></td><td>${esc(cohorts.find(c=>c.id===member?.cohortId)?.name||'未加入')}</td><td>${(db.entityTags||[]).filter(t=>t.entityId===e.id&&!t.removedAt).map(t=>`<span class="pill">${esc((db.tags||[]).find(tag=>tag.id===t.tagId)?.name)}</span>`).join(' ')||'—'}</td><td>${history.map(m=>`${esc((db.cohorts||[]).find(c=>c.id===m.cohortId)?.name)} · ${esc(m.joinedAt.slice(0,10))} 至 ${m.leftAt?esc(m.leftAt.slice(0,10)):'现在'}${m.exitReason?' · '+esc(m.exitReason):''}`).join('<br>')||'—'}</td></tr>`;}).join('')}</tbody></table></div></section>`;
}
