import {profileInputs,profileValues,profileDetails,profileEventDetails,passageLabel} from './profiles.mjs?v=20261121.2';
import {storageBoxes,locationBox,locationHistory} from './storage.mjs?v=20261121.2';
import {inventoryColumns,parseInventoryTable,suggestInventoryMapping,previewInventoryImport,inventoryTemplate} from './inventory-import.mjs?v=20261121.2';
import {membershipAt} from './studies.mjs?v=20261121.2';
import {cohortMeasurements,measurementCSV} from './measurements.mjs?v=20261121.2';
import {eventFields,fieldLabel} from './event-fields.mjs?v=20261121.2';
import {home,management as modulePage,eventsPage,storagePage,settingsPage,calendarPage} from './views.mjs?v=20261121.2';
import {types,templates,empty,execute,day,days,age,eventAge,lifecycle,isCellReference,validate,demo} from './core.mjs?v=20261121.2';
import {load,save} from './store.mjs?v=20261121.2';
import {renderEntityReport,reportScopes} from './reports.mjs?v=20261121.2';
import {storageInventoryCSV,renderStorageReport} from './storage-export.mjs?v=20261121.2';
import {storageGridPNG} from './storage-png.mjs?v=20261121.2';
import {measurementChartPNG} from './measurement-png.mjs?v=20261121.2';
import {studyMembershipCSV,renderStudyReport} from './study-export.mjs?v=20261121.2';
import {currentAccount,observeAccount} from '../../assets/js/account/client.mjs';
const owner=currentAccount().user?.id;if(!owner)throw Error('请先登录');
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selectedStudy=null,selectedStorageBox=null;
let measurementCohort='',measurementType='体重测量';
let focusedId=null,pageTab='lifecycle',settingsTab='account',eventMode='all',eventQuery='',eventTypeFilter='',compact=false;const selectedEvents=new Set();
let db=empty(),view='home',demoMode=false,zoom=1,collapsed=false,calendarMode='week',calendarOffset=0,filter='',busy=false,storageFailed=false;
const labels={home:'首页总览',sample:'样品管理',cell:'细胞管理',mouse:'小鼠管理',calendar:'实验日历',events:'事件数据库',lineage:'全局谱系',storage:'位置与存储',backup:'数据备份中心',settings:'账户与设置'};
const icons={home:'▦',sample:'◇',cell:'◉',mouse:'♧',calendar:'▤',events:'☷',lineage:'⑂',storage:'▧',backup:'☁',settings:'⚙'};
const entityBy=id=>db.entities.find(e=>e.id===id),date=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'未启动';
const badge=e=>isCellReference(db,e)?'<span class="badge">基础档案</span>':`<span class="badge ${esc(e.status)}">${{active:'进行中',stored:'保存中',ended:'已结束'}[e.status]}</span>`;
const options=(values,selected)=>values.map(v=>`<option value="${esc(typeof v==='string'?v:v.id)}" ${selected===(typeof v==='string'?v:v.id)?'selected':''}>${esc(typeof v==='string'?v:v.name)}</option>`).join('');
const localTime=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,16);
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,4000);}
function status(){ $('#saveStatus').textContent=storageFailed?'本地数据读取失败 · 已停止写入，请保留原始数据':demoMode?'演示空间 · 操作仅在本页演示，不写入正式数据':`本机 IndexedDB 已保存 · ${db.entities.length} 个实体 · 云备份尚未接入`;$ ('#space').innerHTML=`<span class="avatar">L</span><span>${demoMode?'演示研究空间':'我的研究空间'}<small>${demoMode?'Demo workspace':'Personal workspace'}</small></span><span>⌄</span>`;}
function heading(title,sub,action=true){return `<div class="page-heading"><div><div class="eyebrow">YOUR RESEARCH, CONNECTED</div><h1>${title}</h1><p>${sub}</p></div>${action?'<div class="actions"><button data-action="plan">＋ 新建计划</button><button class="primary" data-action="create">＋ 新建实体</button></div>':''}</div>`;}
function nav(){ $('#nav').innerHTML=[['工作区',['home','calendar']],['实验对象',['cell','sample','mouse','storage']],['记录',['events','lineage']],['系统',['backup','settings']]].map(([title,items])=>`<div class="nav-label">${title}</div>${items.map(key=>`<button data-view="${key}" class="${key===view?'active':''}" title="${labels[key]}"><span class="nav-icon">${icons[key]}</span><span class="nav-text">${labels[key]}</span></button>`).join('')}`).join('');$('#breadcrumb').textContent=labels[view];$('#quickCreate').textContent=view==='calendar'?'新建计划':view==='backup'?'导出备份':'新建事件';}
function table(entities,focus=false){return entities.length?`<div class="table-wrap"><table><thead><tr><th>实体名称 / 编号</th><th>类型</th><th>生命周期</th><th>状态</th><th>当前位置</th></tr></thead><tbody>${entities.map(e=>`<tr><td><button ${focus?'data-focus':'data-entity'}="${e.id}">${esc(e.name)}</button><div class="code">${esc(e.code)}</div></td><td><span class="dot-label ${e.type}">${esc(e.subtype)}</span></td><td>${age(db,e.id)}</td><td>${badge(e)}</td><td class="muted">${esc(e.location||'尚未分配')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">研究从第一个实体开始。<br>新建实体，记录它的第一段生命周期。<br><button class="primary" data-action="create">＋ 新建实体</button> <button data-action="demo">查看演示工作区</button></div>';}
function timeline(entities){return `<div class="timeline-scroll"><div class="timeline" style="zoom:${zoom}">${entities.length?entities.slice(0,8).map(e=>{const events=db.events.filter(v=>v.entityIds.includes(e.id)).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)),children=db.relations.filter(r=>r.parentId===e.id);return `<div class="timeline-row"><button class="track-name" data-entity="${e.id}">${esc(e.name)}<small>${esc(e.code)} · ${age(db,e.id)}</small></button><div class="track-line ${e.type}">${events.map(ev=>`<button class="node ${ev.outputIds.length?'branch':''} ${lifecycle(db,e.id)?.endAt===ev.at?'end':''} ${ev.correctedFrom||ev.type==='档案修订'?'correction':''}" data-event="${ev.id}" title="${date(ev.at)}"><span>${esc(ev.type)}</span><small>${eventAge(db,e.id,ev)} · ${day(ev.at).slice(5)}</small></button>`).join('')}</div></div>${children.length&&!collapsed?`<div class="branch-row">└ 衍生实体 ${children.map(r=>`<button data-entity="${r.childId}">${esc(entityBy(r.childId).name)} · ${age(db,r.childId)}</button>`).join('')}</div>`:''}`;}).join(''):'<div class="empty">创建实体后，操作记录会在这里形成时间轴。</div>'}</div></div><div class="timeline-controls"><span>● 普通事件　▪ 衍生分支　○ 生命周期终点 · 按事件顺序排列，横向滚动查看</span><div><button data-action="collapse">${collapsed?'展开分支':'折叠分支'}</button><button data-action="zoomOut" aria-label="缩小">−</button><button data-action="zoomReset">${Math.round(zoom*100)}%</button><button data-action="zoomIn" aria-label="放大">＋</button></div></div>`;}
function overview(){return home(db,{demoMode,table});}
function management(){return modulePage(db,view,{selected:focusedId,tab:pageTab,filter,table,timeline,selectedStudy,measurementCohort,measurementType});}
function calendar(){return calendarPage(db,{mode:calendarMode,offset:calendarOffset});}
function graph(id,visited=new Set()){if(visited.has(id))return '';const seen=new Set(visited);seen.add(id);const e=entityBy(id);return `<button class="graph-node" data-entity="${id}"><span class="dot-label ${e.type}">${esc(e.name)}</span><small>${esc(e.code)} · ${age(db,id)}</small></button>${!collapsed?`<div class="graph-level">${db.relations.filter(r=>r.parentId===id).map(r=>graph(r.childId,seen)).join('')}</div>`:''}`;}
function backup(){return '<div class="backup-banner"><h2>本地数据已保存 · 云备份尚未接入</h2><p>请先导出完整 JSON 备份。当前没有自动上传或云端历史版本。</p></div>'+heading('数据备份中心','将每一段生命周期与关联完整保留。',false)+`<div class="backup-info"><section class="card"><div class="card-head"><h2>本地数据库</h2><span class="badge">IndexedDB</span></div><div class="card-body"><div class="big-number">${db.entities.length} <small>个实体</small></div><p>${db.events.length} 条事件 · ${db.relations.length} 条谱系关系 · ${db.audit.length} 条操作日志</p><p>当前数据按登录账户隔离，保存在这台设备的当前浏览器中。</p><button class="primary" data-action="export">导出完整 JSON 备份</button></div></section><section class="card"><div class="card-head"><h2>自动云端备份</h2><span class="badge ended">尚未接入</span></div><div class="card-body"><p>当前版本尚未连接云备份服务，没有执行自动上传。清理浏览器数据或更换设备前，请导出备份。</p><p>云端保留策略、附件容量与恢复权限将在后续开发中配置。</p><span class="muted">本地记录可在页面加载后离线使用；首次离线打开尚未支持。</span></div></section></div><section class="card"><div class="card-head"><h2>从 JSON 恢复工作区</h2></div><div class="card-body"><p>先检查编号和关联完整性，展示恢复范围。确认恢复时自动保存当前工作区的保护快照。</p><br><button data-action="import">选择备份并预览</button><button data-action="snapshots">下载恢复前保护快照</button></div></section>`;}
function render(){nav();status();let html;if(view==='home')html=overview();else if(types[view])html=management();else if(view==='calendar')html=calendar();else if(view==='backup')html=backup();else if(view==='events')html=eventsPage(db,{mode:eventMode,query:eventQuery,type:eventTypeFilter,selected:selectedEvents,compact});else if(view==='lineage')html=heading('全局谱系','从母本到衍生实体，跨模块追溯每一段来源。')+`<div class="toolbar"><button data-action="collapse">${collapsed?'展开':'折叠'}谱系</button></div><section class="card"><div class="card-body">${db.entities.filter(e=>!db.relations.some(r=>r.childId===e.id)).map(e=>graph(e.id)).join('')||'<div class="empty">建立实体并记录衍生事件后，在这里查看谱系。</div>'}</div></section>`;else if(view==='storage')html=storagePage(db,selectedStorageBox);else html=settingsPage(db,{email:currentAccount().user?.email,tab:settingsTab,storageFailed});$('#main').innerHTML=html;if(types[view]){const active=$('.culture-card.active'),strip=$('.culture-cards');if(active&&strip){const overflow=active.getBoundingClientRect().right-strip.getBoundingClientRect().right;if(overflow>0)strip.scrollLeft+=overflow+2;}}if(view==='calendar'&&['week','day'].includes(calendarMode))$('.calendar-week-scroll').scrollTop=8*70;}
function drawer(title,html){$('#drawerTitle').textContent=title;$('#drawerBody').innerHTML=html;$('#drawer').hidden=false;$('#closeDrawer').focus();}
let reportFocus=null;
function closeReport(){
  $('#reportPreview').hidden=true;$('#reportContent').innerHTML='';document.body.classList.remove('printing-report');
  if(reportFocus?.isConnected)reportFocus.focus();reportFocus=null;
}
function entityReport(id){
  if(currentAccount().user?.id!==owner||storageFailed)throw Error('请先确认登录和本地数据读取状态');
  const entity=entityBy(id);if(!entity)return;
  form('导出实体报告',`<p>${esc(entity.name)} · ${esc(entity.code)}</p><label>导出范围<select name="scope">${Object.entries(reportScopes).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><label><input type="checkbox" name="includeNotes" checked> 包含档案与事件备注</label><label><input type="checkbox" name="includePlans"> 附上计划记录（单独标注）</label><p class="muted">先预览报告，再通过浏览器打印窗口选择“另存为 PDF”。报告包含当前档案、完整生命周期、实际事件、位置历史及范围内的谱系关系。</p>`,async p=>{
    if(currentAccount().user?.id!==owner)throw Error('登录状态已变化，请刷新后重试');
    const html=renderEntityReport(db,id,{scope:p.scope,includeNotes:!!p.includeNotes,includePlans:!!p.includePlans,workspace:demoMode?'演示研究空间':'我的研究空间'});
    reportFocus=document.querySelector(`[data-report="${id}"]`);$('#drawer').hidden=true;
    $('#reportContent').innerHTML=html;$('#reportPreview').hidden=false;document.body.classList.add('printing-report');$('#printReport').focus();
  });
  $('#editor [type="submit"]').textContent='预览报告';
}
$('#closeReport').onclick=closeReport;
$('#printReport').onclick=()=>{
  if(currentAccount().user?.id!==owner||document.documentElement.dataset.toolAccess!=='allowed'){closeReport();toast('登录状态已变化，请刷新后重试');return;}
  window.print();
};
observeAccount(()=>{if(currentAccount().user?.id!==owner)closeReport();});
function detail(id){const e=entityBy(id);if(!e)return;const l=lifecycle(db,id),parents=db.relations.filter(r=>r.childId===id),children=db.relations.filter(r=>r.parentId===id),events=db.events.filter(v=>v.entityIds.includes(id)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)),measurements=events.filter(v=>v.data.value).reverse();drawer('实体档案',`<span class="dot-label ${e.type}">${esc(e.subtype)}</span><h2 class="detail-title">${esc(e.name)}</h2><div class="code">${esc(e.code)}</div><div class="field-line"><span>当前状态</span>${badge(e)}</div><div class="field-line"><span>生命周期</span><span>${age(db,id)}${isCellReference(db,e)?'':' · '+(l.status==='ended'?'已结束':'独立计时')}</span></div><div class="field-line"><span>D0 / 起始日期</span><span>${date(l.startAt)}</span></div><div class="field-line"><span>当前位置</span><span>${esc(e.location||'尚未分配')}</span></div>${Number.isFinite(e.quantity)?`<div class="field-line"><span>当前数量</span><span>${e.quantity} ${esc(e.unit)}</span></div>`:''}${e.type==='cell'&&!isCellReference(db,e)?`<div class="field-line"><span>传代次数</span><span>${passageLabel(e)}</span></div>`:''}<div class="actions"><button data-report="${id}">导出报告 / PDF</button><button class="primary" data-record="${id}" ${isCellReference(db,e)||l.endAt&&!(e.type==='sample'&&e.status==='stored')?'disabled':''}>＋ 记录事件</button>${!l.startAt&&!['冻存管','细胞系'].includes(e.subtype)?`<button data-start="${id}">启动计时</button>`:''}${isCellReference(db,e)?'':`<button data-plan-entity="${id}">新建计划</button>`}${e.location&&e.status!=='ended'&&e.type!=='mouse'?`<button data-withdraw="${id}">取出并释放位置</button>`:''}</div>${measurements.length?`<div class="detail-section"><h3>纵向测量记录</h3>${['体重测量','肿瘤测量'].map(type=>{const values=measurements.filter(v=>v.type===type);if(!values.length)return '';const min=Math.min(...values.map(v=>v.data.value)),max=Math.max(...values.map(v=>v.data.value));return `<p class="muted">${type}</p><svg class="measure-chart" viewBox="0 0 320 140" role="img" aria-label="${type}曲线"><polyline fill="none" stroke="#749268" stroke-width="2" points="${values.map((v,i)=>`${20+i*280/Math.max(1,values.length-1)},${110-(v.data.value-min)*80/(max-min||1)}`).join(' ')}"/>${values.map((v,i)=>`<circle cx="${20+i*280/Math.max(1,values.length-1)}" cy="${110-(v.data.value-min)*80/(max-min||1)}" r="4" fill="#749268"/>`).join('')}</svg><div class="measure-values">${values.map(v=>`${date(v.at)} · ${v.data.value} ${v.data.unit}`).join('<br>')}</div>`;}).join('')}</div>`:''}<div class="detail-section"><h3>来源与去向</h3>${parents.map(r=>`<p><button data-entity="${r.parentId}">来源 · ${esc(entityBy(r.parentId).name)}</button></p>`).join('')}${children.map(r=>`<p><button data-entity="${r.childId}">衍生 · ${esc(entityBy(r.childId).name)}</button></p>`).join('')}${!parents.length&&!children.length?'<p class="muted">暂无衍生关系</p>':''}</div>${profileDetails(db,e)}${locationHistory(db,id)}<div class="detail-section"><h3>操作历史 · ${events.length}</h3>${events.map(ev=>`<div class="detail-event"><button data-event="${ev.id}">${esc(ev.type)}</button><p>${date(ev.at)} · ${eventAge(db,id,ev)}</p></div>`).join('')}</div>`);}
function eventDetail(id){const e=db.events.find(e=>e.id===id);if(!e)return;drawer('事件详情',`<span class="badge">${e.correctedFrom?'追加修正':'实际事件'}</span><h2 class="detail-title">${esc(e.type)}</h2><div class="code">${esc(e.id)}</div><div class="field-line"><span>发生时间</span><span>${date(e.at)}</span></div><div class="field-line"><span>创建时间</span><span>${date(e.createdAt)}</span></div>${e.planId?`<div class="field-line"><span>原计划时间</span><span>${date(db.plans.find(p=>p.id===e.planId)?.scheduledAt)}</span></div>`:''}<div class="detail-section"><h3>参与实体</h3>${e.entityIds.map(id=>`<p><button data-entity="${id}">${esc(entityBy(id).name)} · ${esc(entityBy(id).code)} · ${{subject:'操作对象',input:'输入材料',output:'产物',source:'来源',recipient:'接收者'}[e.participants?.find(p=>p.entityId===id)?.role]||'关联实体'}</button></p>`).join('')}</div><div class="detail-section"><h3>记录内容</h3><p class="note">${esc(e.note||'无备注')}</p>${profileEventDetails(db,e)||Object.entries(e.data).map(([k,v])=>`<div class="field-line"><span>${esc(fieldLabel(e,k))}</span><span>${esc(v)}</span></div>`).join('')}</div>${e.correctedFrom?`<button data-event="${e.correctedFrom}">查看原始事件</button>`:''}<div class="detail-section"><h3>历史修正</h3><p class="form-hint">已发生事件保留原文。更正内容通过追加修正记录保存，不直接覆盖。</p><button data-correct="${e.id}">追加修正记录</button>${db.events.filter(v=>v.correctedFrom===id).map(v=>`<p><button data-event="${v.id}">${date(v.createdAt)} · ${esc(v.note.slice(0,30))}</button></p>`).join('')}</div>`);}
function form(title,html,callback){drawer(title,`<form class="form" id="editor">${html}<p id="formError" class="error" role="alert"></p><button class="primary" type="submit">保存记录</button></form>`);$('#editor').onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;const button=event.target.querySelector('[type=submit]');button.disabled=true;try{await callback(Object.fromEntries(new FormData(event.target)));}catch(error){$('#formError')&&($('#formError').textContent=error.message);}finally{busy=false;if(button.isConnected)button.disabled=false;}};}
async function commit(command){if(storageFailed)throw Error('本地读取失败，已停止写入，请先排查原始数据。');if(currentAccount().user?.id!==owner)throw Error('账户已切换，请重新打开工作区');const next=execute(db,command,owner);if(!demoMode)await save(owner,next,db.revision);db=next;if(command.type==='storage-box')selectedStorageBox=db.storageBoxes.at(-1).id;render();$('#drawer').hidden=true;toast(demoMode?'演示操作已记录':'已保存到本机数据库');}
function create(initial={}) {
  form('新建科研实体',`<label>实体类型<select name="type" id="newType">${options(Object.entries(types).map(([id,name])=>({id,name})),initial.type||(types[view]?view:'cell'))}</select></label>
    <label>显示名称<input name="name" required maxlength="120" placeholder="例如 B16-F10 · P3"></label><label>实体子类型<select name="subtype" id="subtype"></select></label>
    <label>自定义编号<input name="code" maxlength="80" placeholder="留空自动生成"></label>
    <label>实际获得 / 入库时间<input name="at" type="datetime-local" required value="${localTime()}"></label>
    <label id="locationField">物理位置<input name="location" maxlength="500"></label><label id="passageField">传代次数 P<input name="passage" type="number" min="0" step="1" value="0"></label>
    <label id="cellLineField">所属细胞系<select name="cellLineId" id="newCellLine"></select></label>
    <label id="dormantField"><input name="dormant" type="checkbox">暂不启动活跃生命周期计时</label>
    <div id="entityProfileFields"></div>`,async p=>{
      const info={type:p.type,subtype:p.subtype};
      await commit({type:'entity',data:{...p,attributes:profileValues(info,p),cellLineId:p.cellLineId||undefined,dormant:p.subtype==='冻存管'||p.dormant==='on',at:p.at+'+08:00'}});
    });
  const updateProfile=()=>{
    const type=$('#newType').value,subtype=$('#subtype').value,isLine=type==='cell'&&subtype==='细胞系';
    $('#entityProfileFields').innerHTML=profileInputs({type,subtype});
    $('#locationField').hidden=isLine;$('#locationField input').disabled=isLine;
    $('#passageField').hidden=type!=='cell'||isLine;$('#passageField input').disabled=type!=='cell'||isLine;
    $('#cellLineField').hidden=type!=='cell'||isLine;$('#newCellLine').disabled=type!=='cell'||isLine;
    $('#newCellLine').innerHTML='<option value="">暂不关联（来源未确认）</option>'+options(db.entities.filter(e=>e.type==='cell'&&e.subtype==='细胞系'),initial.cellLineId);
    $('#dormantField').hidden=type==='mouse'||isLine||subtype==='冻存管';$('#dormantField input').checked=subtype==='冻存管';$('#dormantField input').disabled=type==='mouse'||isLine||subtype==='冻存管';
    const defaults=()=>{const line=entityBy($('#newCellLine').value),conditions=$('#entityProfileFields [name="profile_conditions"]');if(line&&conditions&&!conditions.value)conditions.value=line.attributes?.defaultConditions||'';};
    $('#newCellLine').onchange=defaults;defaults();
  };
  const update=()=>{$('#subtype').innerHTML=options({cell:['培养批次','冻存管','细胞系'],sample:['组织','体液','细胞样品','核酸','蛋白','其他'],mouse:['小鼠个体']}[$('#newType').value],initial.subtype);updateProfile();};
  $('#newType').onchange=update;$('#subtype').onchange=updateProfile;update();
}
function editProfile(id) {
  const e=entityBy(id);if(!e)return;
  const association=e.type==='cell'&&e.subtype!=='细胞系'
    ? e.cellLineId?`<p class="form-hint">所属细胞系：${esc(entityBy(e.cellLineId)?.name)}。已确认关联不通过普通档案修订替换。</p>`:`<label>所属细胞系<select name="cellLineId"><option value="">暂不关联</option>${options(db.entities.filter(v=>v.type==='cell'&&v.subtype==='细胞系'))}</select></label>`:'';
  form('补充 / 修订档案',`<p class="form-hint">${esc(e.name)} · 修订保留修改前后内容；位置、生命周期与 P 数仍通过业务事件管理。</p>${profileInputs(e)}${association}<label>修订原因<textarea name="reason" required maxlength="2000"></textarea></label>`,async p=>commit({type:'profile-update',data:{entityId:id,attributes:profileValues(e,p),...(p.cellLineId?{cellLineId:p.cellLineId}:{}),reason:p.reason}}));
}
function eventInputs(type,module) {
  return eventFields(type,module).map(field=>{
    const input=field.type==='select'
      ? `<select name="${field.key}" ${field.required?'required':''}>${options(field.options)}</select>`
      : `<input name="${field.key}" type="${field.type==='number'?'number':'text'}" ${field.type==='number'?`step="any" min="${field.min}"`:'maxlength="2000"'} ${field.required?'required':''}>`;
    return `<label>${esc(field.label)}${field.required?' *':''}${input}</label>`;
  }).join('');
}
function record(id,planId=null,forced=null,correctedFrom=null) {
  const e=entityBy(id);if(!e)return;
  const available=e.subtype==='冻存管'?['复苏','转移','取出','归还','废弃']:templates[e.type];
  form(planId?'记录计划执行结果':'记录实际事件',`
    <div class="form-hint">${esc(e.name)} · ${esc(e.code)}${Number.isFinite(e.quantity)?`<br>当前数量：${e.quantity} ${esc(e.unit)}`:''}<br>所有时间使用北京时间（UTC+8）。</div>
    <label>事件类型<select name="eventType" id="eventType">${options(forced?[forced]:[...available,...(!lifecycle(db,id).startAt&&e.subtype!=='冻存管'?['启动计时']:[])],forced)}</select></label>
    <label>实际执行时间<input name="at" type="datetime-local" required value="${localTime()}"></label>
    <label>操作人员<input name="operator" required maxlength="200" value="${esc(currentAccount().user?.email||'当前用户')}"></label>
    <div id="dynamicFields"></div>
    <label>关联输入实体<select name="relatedId" id="relatedEntity"><option value="">无关联</option>${options(db.entities.filter(v=>v.id!==id))}</select></label>
    <label>备注 / 修正原因<textarea name="note" maxlength="5000" ${correctedFrom?'required':''}></textarea></label>`,
    async p=>commit({type:'event',key:crypto.randomUUID(),data:{...p,entityId:id,planId,correctedFrom,at:p.at+'+08:00',keepParent:p.keepParent==='yes'?true:p.keepParent==='no'?false:undefined,longTerm:p.longTerm==='long'?true:p.longTerm==='short'?false:undefined}}));
  const update=()=>{
    const type=$('#eventType').value,branch=['传代','分装','复苏','提取','活检','终点取材'].includes(type)||(type==='冻存'&&e.type==='cell');
    $('#dynamicFields').innerHTML=(branch?`
      <label>衍生实体数量<input name="count" type="number" value="1" min="1" max="81" required></label>
      <label>衍生实体名称<input name="childName" maxlength="120" placeholder="留空根据母本命名"></label>
      ${['传代','分装','提取'].includes(type)?'<label>母本是否有剩余 *<select name="keepParent" required><option value="">请选择</option><option value="yes">有剩余，母本继续</option><option value="no">无剩余，结束母本</option></select></label>':''}
      ${type==='分装'?'<label>分装保存模式 *<select name="longTerm" required><option value="">请选择</option><option value="short">短期继续处理</option><option value="long">长期保存，未来逐管启用</option></select></label>':''}
      <p class="form-hint">${type==='冻存'&&e.type==='cell'?'冻存结束当前培养，生成独立冻存管。':type==='终点取材'||type==='活检'?'创建样品不自动视为已完成小鼠处置。':type==='复苏'?'复苏创建新的培养批次，冻存管原位置释放。':'每个衍生实体独立编号和计时。'}</p>`:'')+
      eventInputs(type,e.type)+(['转移','转笼','归还'].includes(type)?'<label>新位置<input name="location" required maxlength="500"></label>':'');
    const needsCell=['荷瘤','细胞回输'].includes(type);
    $('#relatedEntity').required=needsCell;
    $('#relatedEntity').innerHTML='<option value="">'+(needsCell?'请选择来源培养批次':'无关联')+'</option>'+options(db.entities.filter(v=>v.id!==id&&(!needsCell||v.type==='cell'&&v.subtype==='培养批次')));
  };
  $('#eventType').onchange=update;update();
}
function planDetail(id) {
  const p=db.plans.find(p=>p.id===id);if(!p)return;
  const active=['pending','postponed'].includes(p.status);
  drawer('计划详情',`<span class="badge">${{pending:'待执行',postponed:'已延期',completed:'已完成',cancelled:'已取消'}[p.status]||p.status}</span><h2 class="detail-title">${esc(p.name)}</h2>
    <div class="field-line"><span>关联实体</span><span>${esc(entityBy(p.entityId).name)}</span></div>
    <div class="field-line"><span>原定时间</span><span>${date(p.scheduledAt)}</span></div>
    ${p.nextAt?`<div class="field-line"><span>当前计划时间</span><span>${date(p.nextAt)}</span></div>`:''}
    <div class="actions">${active?`<button class="primary" data-complete-plan="${p.id}">记录执行结果</button><button data-postpone-plan="${p.id}">延期</button><button data-cancel-plan="${p.id}">取消计划</button>`:''}${p.eventId?`<button data-event="${p.eventId}">查看实际事件</button>`:''}</div>
    <div class="detail-section"><h3>计划变更历史</h3>${(p.history||[]).map(h=>`<div class="detail-event"><strong>${h.action==='postpone'?'延期':'取消'}</strong><p>${date(h.at)} · ${date(h.from)}${h.to?' 至 '+date(h.to):''}</p><p class="note">${esc(h.reason)}</p></div>`).join('')||'<p class="muted">尚无变更</p>'}</div>`);
}
function changePlan(id,action) {
  form(action==='postpone'?'延期计划':'取消计划',`${action==='postpone'?`<label>新的计划时间<input type="datetime-local" name="nextAt" required value="${localTime()}"></label>`:''}<label>变更原因<textarea name="reason" required maxlength="2000"></textarea></label><p class="form-hint">原计划时间和变更记录会保留。</p>`,async p=>commit({type:'plan-update',data:{...p,planId:id,action,nextAt:p.nextAt?p.nextAt+'+08:00':undefined}}));
}
function batchRecord() {
  const mice=db.entities.filter(e=>e.type==='mouse'&&e.status==='active');
  if(!mice.length){toast('请先登记活跃小鼠');return;}
  form('小鼠批量记录',`<label>实验项目<select name="studyId" id="batchStudy"><option value="">全部小鼠，不关联项目</option>${options(db.studies||[])}</select></label><label>项目分组<select name="cohortId" id="batchCohort"><option value="">项目内全部分组</option></select></label><label>操作类型<select name="eventType" id="batchEventType">${options(['给药','体重测量','肿瘤测量','转笼','基因分型'])}</select></label>
    <label>实际时间<input name="at" type="datetime-local" value="${localTime()}" required></label><label>操作人员<input name="operator" required value="${esc(currentAccount().user?.email||'当前用户')}"></label>
    <div id="batchCommon"></div><div id="batchTargets"></div><label>共同备注<textarea name="note" maxlength="5000"></textarea></label>`,async p=>{
      const type=p.eventType,overrideKey=type==='给药'?'dose':['体重测量','肿瘤测量'].includes(type)?'value':type==='转笼'?'location':'result';
      const items=mice.flatMap((e,i)=>p['target_'+i]==='on'&&visibleMice.some(v=>v.id===e.id)?[{entityId:e.id,...(p['override_'+i]?.trim()?{[overrideKey]:p['override_'+i]}:{}),...(type==='肿瘤测量'&&p['length_'+i]?.trim()?{length:p['length_'+i]}:{}),...(type==='肿瘤测量'&&p['width_'+i]?.trim()?{width:p['width_'+i]}:{})}]:[]);
      const command={type:'batch',key:'BATCH-'+crypto.randomUUID(),data:{...p,at:p.at+'+08:00',items}};
      const preview=execute(db,command,owner),revision=db.revision;
      form('确认批量记录',`<p class="form-hint">${items.length} 只小鼠将分别创建独立事件。本批所有记录一起保存；任意一项失败则全部不保存。</p>${preview.events.slice(db.events.length).map(e=>`<div class="batch-preview"><strong>${esc(entityBy(e.entityIds[0]).name)}</strong><p>${esc(e.type)} · ${Object.entries(e.data).map(([k,v])=>esc(fieldLabel(e,k))+': '+esc(v)).join('；')}</p></div>`).join('')}<label><input type="checkbox" required>确认保存上述记录</label>`,async()=>{if(db.revision!==revision)throw Error('数据已变化，请重新预览');await commit(command);});
      $('#editor [type=submit]').textContent='确认并保存全部';
    });
  let visibleMice=mice;
  const update=()=>{
    const type=$('#batchEventType').value;
    $('#batchCommon').innerHTML=eventInputs(type,'mouse')+(type==='转笼'?'<label>共同目标笼位<input name="location" required maxlength="500"></label>':'');
    const label=type==='给药'?'个体剂量':['体重测量','肿瘤测量'].includes(type)?'个体测量值':type==='转笼'?'个体目标笼位':'个体检测结果';
    $('#batchTargets').innerHTML='<h3>选择小鼠与个体差异</h3>'+mice.flatMap((e,i)=>visibleMice.some(v=>v.id===e.id)?[`<div class="batch-target"><label><input type="checkbox" name="target_${i}">${esc(e.name)}</label><label>${label}（留空使用共同值）<input name="override_${i}" type="${['给药','体重测量','肿瘤测量'].includes(type)?'number':'text'}" step="any"></label>${type==='肿瘤测量'?`<label>个体长径（mm，计算方式）<input name="length_${i}" type="number" step="any" min="0"></label><label>个体短径（mm，计算方式）<input name="width_${i}" type="number" step="any" min="0"></label>`:''}</div>`]:[]).join('');
  };
  const filterTargets=()=>{
    const studyId=$('#batchStudy').value,cohortId=$('#batchCohort').value;
    visibleMice=mice.filter(e=>{if(!studyId)return true;const m=membershipAt(db,e.id,studyId);return m&&(!cohortId||m.cohortId===cohortId);});update();
  };
  $('#batchStudy').onchange=()=>{$('#batchCohort').innerHTML='<option value="">项目内全部分组</option>'+options((db.cohorts||[]).filter(c=>c.studyId===$('#batchStudy').value));filterTargets();};
  $('#batchCohort').onchange=filterTargets;
  $('#batchEventType').onchange=update;update();$('#editor [type=submit]').textContent='校验并预览';
}
function inventoryImportRows(preview){
  return `<div class="table-wrap"><table><thead><tr><th>源行</th><th>名称 / 管号</th><th>位置 / P 数</th><th>检查结果</th></tr></thead><tbody>${preview.rows.map(row=>`<tr class="inventory-import-row" data-result="${row.status}"><td>${row.sourceRow}</td><td>${esc(row.data?.name||'未解析')}<div class="code">${esc(row.code||row.data?.code||'自动编号')}</div></td><td>${esc(row.data?.location||'未解析')}<br>${row.data?passageLabel(row.data):''}</td><td>${row.status==='ready'?'待新增':row.status==='skip'?'跳过已有一致记录':esc(row.errors.join('；'))}</td></tr>`).join('')}</tbody></table></div>`;
}
function importInventory(initial={}){
  const boxes=storageBoxes(db).filter(box=>box.kind==='cell');if(!boxes.length){toast('请先建立细胞冻存盒');return;}
  const boxId=initial.boxId||(boxes.find(box=>box.id===selectedStorageBox)||boxes[0]).id;
  let parsed=null,parsedText='',sourceName=initial.sourceName||'粘贴表格',readSequence=0;
  form('批量导入已有冻存库',`<p class="form-hint">每行一支冻存管。支持 CSV / TSV 文件，或直接从 Excel 复制含表头的清单粘贴。Excel 工作簿文件请先复制单元格或另存为 CSV；冻存盒需先建档。单次最多 500 支，不覆盖已有记录。</p>
    <button type="button" id="inventoryTemplate">下载空白 CSV 模板</button><label>读取 CSV / TSV 文件<input id="inventoryCSV" type="file" accept=".csv,.tsv,.txt"></label>
    <label>文件编码<select id="inventoryEncoding"><option value="utf-8">UTF-8（常用）</option><option value="gb18030">GB18030 / GBK（部分中文 Excel CSV）</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select></label>
    <label>表格内容<textarea name="content" id="inventoryText" rows="8" maxlength="2000000" placeholder="粘贴含表头的清单，例如：细胞名称、管号、格位、P数、实际冻存日期">${esc(initial.text||'')}</textarea></label>
    <label>默认目标冻存盒<select name="boxId">${options(boxes.map(box=>({id:box.id,name:box.name+' · '+box.path})),boxId)}</select></label>
    <label>默认所属细胞系（可选）<select name="cellLineId"><option value="">暂不关联</option>${options(db.entities.filter(e=>e.type==='cell'&&e.subtype==='细胞系'),initial.cellLineId)}</select></label>
    <label>重复记录处理<select name="duplicates"><option value="error">遇到重复或冲突，全部停止</option><option value="skip-matching" ${initial.duplicates==='skip-matching'?'selected':''}>跳过管号、名称、位置及已填信息一致的已有记录</option></select></label>
    <button type="button" id="inventoryReadHeaders">读取表头并配置字段</button><div id="inventoryMapping"></div><div id="inventoryIssues"></div>
    <p class="form-hint">格位使用 A1、B2，也支持分别对应行和列。日期使用 YYYY-MM-DD；P 数、日期、数量未知可留空。导入保留来源文件名和源行号，不保存原始文件附件。</p>`,async p=>{
      if(!parsed||p.content!==parsedText)throw Error('表格内容已改变，请重新读取表头');
      const mapping=Object.fromEntries(inventoryColumns.map(field=>[field.key,Number(p['map_'+field.key])])),at=localTime()+'+08:00';
      const preview=previewInventoryImport(db,parsed,mapping,{boxId:p.boxId,cellLineId:p.cellLineId,duplicates:p.duplicates,at});
      $('#inventoryIssues').innerHTML=`<p>待新增 ${preview.items.length} 支 · 跳过 ${preview.skippedRows.length} 行 · 问题 ${preview.errors.length} 行</p>${inventoryImportRows(preview)}`;
      if(preview.errors.length)throw Error('存在问题行，尚未保存任何记录。请修改内容或字段对应后重新预览');
      if(!preview.items.length)throw Error('没有需要新增的冻存管；一致的已有记录已全部跳过');
      const state={text:p.content,boxId:p.boxId,cellLineId:p.cellLineId,duplicates:p.duplicates,mapping,sourceName},revision=db.revision;
      const command={type:'inventory-import',key:'IMPORT-'+crypto.randomUUID(),data:{at,sourceName,items:preview.items,skippedRows:preview.skippedRows}};
      form('确认导入冻存库存',`<p>新增 <strong>${preview.items.length}</strong> 支 · 跳过 ${preview.skippedRows.length} 行 · 来源 ${esc(sourceName)}</p><p class="form-hint">本次追加库存记录，现有记录不覆盖。未知字段保留未知，不启动培养计时；任一保存校验失败，全部不写入。</p>${inventoryImportRows(preview)}<button type="button" id="inventoryImportBack">返回修改</button><label><input type="checkbox" required>确认上述新增与跳过结果</label>`,async()=>{
        if(db.revision!==revision)throw Error('数据已变化，请返回修改并重新预览');await commit(command);toast(`已新增 ${preview.items.length} 支冻存管，跳过 ${preview.skippedRows.length} 行`);
      });
      $('#inventoryImportBack').onclick=()=>importInventory(state);$('#editor [type=submit]').textContent='确认并导入全部';
    });
  const readHeaders=()=>{
    try{
      parsedText=$('#inventoryText').value;parsed=parseInventoryTable(parsedText);
      const mapping=initial.mapping||suggestInventoryMapping(parsed.headers);
      $('#inventoryMapping').innerHTML=`<p>已读取 ${parsed.rows.length} 行 · ${esc(sourceName)}</p><details ${mapping.name<0||mapping.coordinate<0&&!(mapping.row>=0&&mapping.column>=0)?'open':''}><summary>字段对应（已自动匹配，可展开调整）</summary>${inventoryColumns.map(field=>`<label>${field.label}<select name="map_${field.key}"><option value="-1">不对应此字段</option>${parsed.headers.map((header,i)=>`<option value="${i}" ${mapping[field.key]===i?'selected':''}>第 ${i+1} 列：${esc(header||'无表头')}</option>`).join('')}</select></label>`).join('')}</details>`;
      $('#inventoryIssues').innerHTML='';$('#formError').textContent='';$('#editor [type=submit]').disabled=false;
    }catch(error){parsed=null;$('#inventoryMapping').innerHTML='';$('#formError').textContent=error.message;$('#editor [type=submit]').disabled=true;}
  };
  const readFile=async()=>{
    const file=$('#inventoryCSV').files[0];if(!file)return;const sequence=++readSequence;parsed=null;$('#editor [type=submit]').disabled=true;
    try{
      if(file.size>2000000||file.name.length>200)throw Error('文件不能超过 2 MB，文件名不能超过 200 字符');
      if(!/\.(csv|tsv|txt)$/i.test(file.name))throw Error('请使用 CSV / TSV 文件，或从 Excel 复制清单后粘贴');
      const buffer=await file.arrayBuffer();if(sequence!==readSequence)return;const bytes=new Uint8Array(buffer);let encoding=$('#inventoryEncoding').value;
      if(bytes[0]===255&&bytes[1]===254)encoding='utf-16le';if(bytes[0]===254&&bytes[1]===255)encoding='utf-16be';
      $('#inventoryEncoding').value=encoding;$('#inventoryText').value=new TextDecoder(encoding,{fatal:true}).decode(buffer);sourceName=file.name;initial.mapping=null;readHeaders();
    }catch(error){if(sequence!==readSequence)return;parsed=null;$('#editor [type=submit]').disabled=true;$('#formError').textContent=error instanceof TypeError?'无法按当前编码读取文件，请调整文件编码后重试':error.message;}
  };
  $('#inventoryCSV').onchange=readFile;$('#inventoryEncoding').onchange=readFile;
  $('#inventoryReadHeaders').onclick=readHeaders;$('#inventoryTemplate').onclick=()=>download(inventoryTemplate(),'life-atlas-inventory-template.csv','text/csv;charset=utf-8');
  $('#inventoryText').oninput=()=>{readSequence++;parsed=null;initial.mapping=null;sourceName='粘贴表格';$('#inventoryMapping').innerHTML='';$('#inventoryIssues').innerHTML='';$('#editor [type=submit]').disabled=true;};
  $('#editor [type=submit]').textContent='校验并预览';$('#editor [type=submit]').disabled=true;if(initial.text)readHeaders();
}
function registerStock(presetLocation=null){
  const boxes=storageBoxes(db).filter(box=>box.kind==='cell');
  if(!boxes.length){toast('请先新建一个细胞冻存盒');return;}
  const selected=locationBox(db,presetLocation||'')||boxes.find(box=>box.id===selectedStorageBox)||boxes[0];
  form('登记已有冻存管',`<p class="form-hint">直接登记已有库存，无需补录培养历史。一支管对应一个格位；P 数和实际冻存日期未知可留空。本次登记不启动培养计时。</p>
    <label>细胞 / 冻存管名称<input name="name" required maxlength="120"></label><label>原管号（可选）<input name="code" maxlength="80" placeholder="留空自动编号"></label>
    <label>所属细胞系<select name="cellLineId"><option value="">暂不关联（来源未确认）</option>${options(db.entities.filter(e=>e.type==='cell'&&e.subtype==='细胞系'))}</select></label>
    <label>传代次数 P（未知留空）<input name="passage" type="number" min="0" step="1" placeholder="未知"></label>
    <label>实际冻存日期（未知留空）<input name="frozenDate" type="date" max="${day(new Date())}"></label><label>冻存液（可选）<input name="cryoprotectant" maxlength="2000"></label>
    <label>每管数量（可选）<input name="quantity" type="number" min="0" step="any"></label><label>数量单位（填写数量时必填）<input name="unit" maxlength="40" placeholder="如 cells、mL"></label>
    <label>冻存盒<select name="boxId" id="stockBox">${boxes.map(box=>`<option value="${box.id}" ${box.id===selected.id?'selected':''}>${esc(box.name)} · ${esc(box.path)}</option>`).join('')}</select></label>
    <label>空格位<select name="coordinate" id="stockSlot" required></select></label><p class="form-hint" id="stockAvailability"></p>
    <label>来源（可选）<input name="source" maxlength="2000"></label><label>备注<textarea name="note" maxlength="2000"></textarea></label>
    <p class="form-hint">保存时记录当前登记确认时间，历史冻存日期按填写内容单独保存。未知来源不会自动关联到现有培养批次。</p>`,async p=>{
      const box=storageBoxes(db).find(box=>box.id===p.boxId&&box.kind==='cell');if(!box)throw Error('冻存盒不存在');
      await commit({type:'inventory-register',key:crypto.randomUUID(),data:{at:localTime()+'+08:00',name:p.name,code:p.code,cellLineId:p.cellLineId||undefined,passage:p.passage,quantity:p.quantity,unit:p.unit,location:box.path+'/'+p.coordinate,attributes:{frozenDate:p.frozenDate,cryoprotectant:p.cryoprotectant,source:p.source},note:p.note}});
    });
  const update=()=>{
    const box=boxes.find(box=>box.id===$('#stockBox').value),slots=[];
    for(let row=0;row<box.rows;row++)for(let col=1;col<=box.columns;col++){const coordinate=String.fromCharCode(65+row)+col;if(!db.entities.some(e=>e.status!=='ended'&&e.location===box.path+'/'+coordinate))slots.push(coordinate);}
    $('#stockSlot').innerHTML=slots.length?options(slots,presetLocation?.startsWith(box.path+'/')?presetLocation.slice(box.path.length+1):undefined):'<option value="">此盒已满，请切换冻存盒</option>';
    $('#stockAvailability').textContent=`${box.name} · ${slots.length} 个空位；保存时再次检查占用。`;
    $('#editor [type=submit]').disabled=!slots.length;
  };
  $('#stockBox').onchange=update;update();
}
function exportStorage(){
  if(currentAccount().user?.id!==owner||storageFailed)throw Error('请先确认登录和本地数据读取状态');
  const box=storageBoxes(db).find(b=>b.id===selectedStorageBox)||storageBoxes(db)[0];
  form('导出存储清单',`<p>当前盒：${esc(box.name)}<br><span class="muted">${esc(box.path)}</span></p><label>导出范围<select name="scope"><option value="box">当前盒</option><option value="all">全部冻存盒与样品盒</option></select></label><label>导出格式<select name="format" id="storageExportFormat"><option value="pdf">报告预览 / 保存为 PDF</option><option value="csv">CSV 清单</option><option value="png">当前盒格位 PNG 图片</option></select></label><div id="storagePNGOptions" hidden><label><input type="checkbox" name="includeCodes" checked> 图片包含实体编号</label><label><input type="checkbox" name="includeDates"> 图片包含实际冻存与当前位置存入日期</label><p class="muted">PNG 仅导出当前盒，始终显示全部格位。</p></div><label><input type="checkbox" name="includeEmpty"> 清单包含空位（布局图始终显示全部格位）</label><label><input type="checkbox" name="includeNotes"> 包含档案备注</label><p class="muted">仅导出当前占用快照，不包含已取出、已复苏或已结束记录。实际冻存日期和当前位置存入时间分别列示；未知信息保持未知。</p>`,async p=>{
    if(currentAccount().user?.id!==owner)throw Error('登录状态已变化，请刷新后重试');
    if(!['pdf','csv','png'].includes(p.format))throw Error('导出格式不受支持');
    const options={boxId:box.id,scope:p.scope,includeEmpty:!!p.includeEmpty,includeNotes:!!p.includeNotes,workspace:demoMode?'演示研究空间':'我的研究空间'};
    if(p.format==='png'){
      const blob=await storageGridPNG(db,{...options,scope:'box',includeCodes:!!p.includeCodes,includeDates:!!p.includeDates});
      if(currentAccount().user?.id!==owner)throw Error('登录状态已变化，请刷新后重试');
      download(blob,`life-atlas-storage-${day(new Date())}${demoMode?'-demo':''}.png`,'image/png');$('#drawer').hidden=true;toast('已导出当前盒格位图片');return;
    }
    if(p.format==='csv'){
      download(storageInventoryCSV(db,options),`life-atlas-storage-${day(new Date())}${demoMode?'-demo':''}.csv`,'text/csv;charset=utf-8');
      $('#drawer').hidden=true;toast('已导出当前存储清单');return;
    }
    const html=renderStorageReport(db,options);
    reportFocus=document.querySelector('[data-storage-action="export"]');$('#drawer').hidden=true;
    $('#reportContent').innerHTML=html;$('#reportPreview').hidden=false;document.body.classList.add('printing-report');$('#printReport').focus();
  });
  const updateLabel=()=>{const format=$('#storageExportFormat').value,png=format==='png';$('#storagePNGOptions').hidden=!png;const scope=$('#editor [name="scope"]');if(png)scope.value='box';scope.disabled=png;$('#editor [name="includeEmpty"]').disabled=png;$('#editor [type="submit"]').textContent=format==='csv'?'导出 CSV':png?'导出 PNG':'预览报告';};
  $('#storageExportFormat').onchange=updateLabel;updateLabel();
}
function storageAction(action,presetLocation=null,kind=null) {
  if(action==='export'){exportStorage();return;}
  if(action==='import'){importInventory();return;}
  if(action==='stock'){registerStock(presetLocation);return;}
  if(action==='box'){
    form('新建冻存盒',`<label>保存类型<select name="kind" id="boxKind"><option value="cell">细胞冻存盒（固定 9×9）</option><option value="sample">样品盒（自定义行列）</option></select></label>
      <label>设施 / 实验室<input name="facility" required maxlength="80"></label><label>房间<input name="room" required maxlength="80"></label>
      <label>设备 / 液氮罐<input name="equipment" required maxlength="80"></label><label>层架<input name="rack" required maxlength="80"></label>
      <label>盒编号<input name="code" required maxlength="80"></label><label>显示名称<input name="name" required maxlength="80"></label>
      <label>行数<input name="rows" type="number" min="1" max="26" value="9" required readonly></label><label>列数<input name="columns" type="number" min="1" max="26" value="9" required readonly></label>`,async p=>commit({type:'storage-box',data:p}));
    $('#boxKind').onchange=()=>{for(const key of ['rows','columns']){const field=$('#editor [name='+key+']');field.readOnly=$('#boxKind').value==='cell';if(field.readOnly)field.value='9';}};return;
  }
  kind ||= (storageBoxes(db).find(box=>box.id===selectedStorageBox)||storageBoxes(db)[0]).kind;
  const eligible=db.entities.filter(e=>e.status!=='ended'&&(!presetLocation||!e.location)&&(kind==='sample'?e.type==='sample':kind==='cell'?e.subtype==='冻存管'&&e.status==='stored':e.type==='sample'||e.subtype==='冻存管'&&e.status==='stored'));
  if(!eligible.length){if(kind==='cell'){registerStock(presetLocation);return;}toast('暂无已建档样品，请先在样品管理中新建样品');return;}
  const boxes=storageBoxes(db);
  form(presetLocation?'存入 '+presetLocation.split('/').at(-1):'登记存入 / 转移 / 归还',`${kind==='cell'?`<button type="button" data-storage-action="stock" data-stock-location="${esc(presetLocation||'')}">新增一支已有冻存管</button>`:''}<label>保存单位<select name="entityId">${options(eligible)}</select></label>
    <label>目标完整位置<input name="location" required maxlength="500" value="${esc(presetLocation||'')}" ${presetLocation?'readonly':''} list="storagePositions"></label>
    <datalist id="storagePositions">${boxes.map(box=>`<option value="${esc(box.path)}/A1">${esc(box.name)}</option>`).join('')}</datalist>
    <label>实际时间<input name="at" type="datetime-local" required value="${localTime()}"></label><label>原因 / 备注<textarea name="note" maxlength="2000"></textarea></label><p class="form-hint">完整位置格式为“盒路径/坐标”，如 ${esc(boxes[0].path)}/A1。保存时再次校验规格、类型和占用。</p>`,async p=>commit({type:'event',data:{...p,eventType:'转移',at:p.at+'+08:00'}}));
}
function exportMeasurementPNG(){
  if(currentAccount().user?.id!==owner||storageFailed)throw Error('请先确认登录和本地数据读取状态');
  const study=(db.studies||[]).find(s=>s.id===selectedStudy)||(db.studies||[])[0];if(!study)throw Error('请先创建实验项目');
  const cohorts=(db.cohorts||[]).filter(c=>c.studyId===study.id),cohortId=cohorts.some(c=>c.id===measurementCohort)?measurementCohort:'';
  form('导出测量曲线 PNG',`<p>${esc(study.name)}</p><label>历史分组<select name="cohortId"><option value="">项目全部分组</option>${options(cohorts,cohortId)}</select></label><label>测量类型<select name="eventType">${options(['体重测量','肿瘤测量'],measurementType)}</select></label><label><input type="checkbox" name="includeCodes" checked> 包含小鼠编号</label><label><input type="checkbox" name="includeDates" checked> 包含测量日期</label><p class="muted">图片使用原始有效测量，按发生时的历史分组归属；跨成员期或生命周期不连线。原记录有追加修正时以星号标记，不重算原值。图片不包含事件备注。</p>`,async p=>{
    if(currentAccount().user?.id!==owner)throw Error('登录状态已变化，请刷新后重试');
    const blob=await measurementChartPNG(db,{studyId:study.id,cohortId:p.cohortId,eventType:p.eventType,includeCodes:!!p.includeCodes,includeDates:!!p.includeDates,workspace:demoMode?'演示研究空间':'我的研究空间'});
    if(currentAccount().user?.id!==owner)throw Error('登录状态已变化，请刷新后重试');
    download(blob,`life-atlas-measurements-${day(new Date())}${demoMode?'-demo':''}.png`,'image/png');$('#drawer').hidden=true;toast('已导出测量曲线图片');
  });$('#editor [type="submit"]').textContent='导出 PNG';
}
function exportStudy(studyId){
  if(currentAccount().user?.id!==owner||storageFailed)throw Error('请先确认登录和本地数据读取状态');
  const study=(db.studies||[]).find(s=>s.id===studyId);if(!study)throw Error('实验项目不存在');
  const cohorts=(db.cohorts||[]).filter(c=>c.studyId===studyId),cohortId=cohorts.some(c=>c.id===measurementCohort)?measurementCohort:'';
  form('导出实验项目',`<p>${esc(study.name)}</p><label>历史分组范围<select name="cohortId"><option value="">项目全部分组</option>${options(cohorts,cohortId)}</select></label><label>导出格式<select name="format" id="studyExportFormat"><option value="pdf">项目报告 / 保存为 PDF</option><option value="csv">成员与分组 CSV</option></select></label><label><input type="checkbox" name="includeHistory" checked> 成员清单包含退出与转组历史</label><label><input type="checkbox" name="includeNotes"> 包含项目说明、变更原因与事件备注</label><div id="studyReportOptions"><label><input type="checkbox" name="includeMeasurements" checked> 包含体重与肿瘤测量图表</label><label><input type="checkbox" name="includeEvents" checked> 包含实际事件与追加修正明细</label></div><p class="muted">事件和测量按发生时的成员有效期归组，当前 / 历史成员清单的选择不改变事件范围。追加修正随原事件保留，不重算原值。PDF 在预览后通过浏览器打印保存。</p>`,async p=>{
    if(currentAccount().user?.id!==owner)throw Error('登录状态已变化，请刷新后重试');
    if(!['pdf','csv'].includes(p.format))throw Error('导出格式不受支持');
    const settings={studyId,cohortId:p.cohortId,includeHistory:!!p.includeHistory,includeNotes:!!p.includeNotes,includeMeasurements:!!p.includeMeasurements,includeEvents:!!p.includeEvents,workspace:demoMode?'演示研究空间':'我的研究空间'};
    if(p.format==='csv'){
      download(studyMembershipCSV(db,settings),`life-atlas-study-members-${day(new Date())}${demoMode?'-demo':''}.csv`,'text/csv;charset=utf-8');
      $('#drawer').hidden=true;toast('已导出项目成员与分组清单');return;
    }
    const html=renderStudyReport(db,settings);reportFocus=document.querySelector(`[data-study-action="export"][data-study-id="${studyId}"]`);$('#drawer').hidden=true;
    $('#reportContent').innerHTML=html;$('#reportPreview').hidden=false;document.body.classList.add('printing-report');$('#printReport').focus();
  });
  const update=()=>{const csv=$('#studyExportFormat').value==='csv';$('#studyReportOptions').hidden=csv;$('#editor [type="submit"]').textContent=csv?'导出 CSV':'预览报告';};
  $('#studyExportFormat').onchange=update;update();
}
function studyAction(action,studyId) {
  if(action==='export'){exportStudy(studyId);return;}
  if(action==='create'){form('新建实验项目','<label>项目名称<input name="name" required maxlength="120"></label><label>项目说明<textarea name="description" maxlength="2000"></textarea></label>',async p=>commit({type:'study',data:p}));return;}
  if(action==='cohort'){form('新建项目分组','<label>分组名称<input name="name" required maxlength="120"></label>',async p=>commit({type:'cohort',data:{...p,studyId}}));return;}
  const mice=db.entities.filter(e=>e.type==='mouse');
  if(!mice.length){toast('请先登记小鼠');return;}
  if(action==='assign'){
    form('分配 / 调整项目成员',`<label>小鼠<select name="entityId">${options(mice)}</select></label><label>目标分组<select name="cohortId"><option value="">退出当前项目分组</option>${options((db.cohorts||[]).filter(c=>c.studyId===studyId))}</select></label><label>实际变更时间<input name="at" type="datetime-local" required value="${localTime()}"></label><label>原因（转组 / 退出必填）<textarea name="reason" maxlength="2000"></textarea></label><p class="form-hint">同一项目内只保留一个有效分组，转组会保留旧组加入、退出时间。其他项目分组不受影响。</p>`,async p=>commit({type:'membership',data:{...p,studyId,at:p.at+'+08:00'}}));return;
  }
  if(action==='tag')form('管理自由标签',`<label>小鼠<select name="entityId">${options(mice)}</select></label><label>操作<select name="action"><option value="add">添加标签</option><option value="remove">移除标签</option></select></label><label>标签名称<input name="name" required maxlength="60" placeholder="例如：待基因分型"></label><p class="form-hint">标签与正式项目分组并存，移除后保留历史。</p>`,async p=>commit({type:'tag',data:p}));
}
function plan(entityId){if(!db.entities.some(e=>!isCellReference(db,e))){toast('请先创建一个实体');return;}form('新建实验计划',`<label>计划名称<input name="name" required maxlength="200"></label><label>关联实体<select name="entityId" id="planEntity">${options(db.entities.filter(e=>!isCellReference(db,e)),entityId)}</select></label><label>操作类型<select name="eventType" id="planEventType"></select></label><label>计划时间<input name="at" type="datetime-local" required value="${localTime()}"></label><p class="form-hint">计划独立保存。执行后需填写实际时间与结果。</p>`,async p=>commit({type:'plan',data:{...p,at:p.at+'+08:00'}}));const update=()=>{const e=entityBy($('#planEntity').value);$('#planEventType').innerHTML=options(templates[e.type]);};$('#planEntity').onchange=update;update();}
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function search(){drawer('全局搜索','<input class="search-field" id="globalSearch" placeholder="名称、编号、位置、事件备注" aria-label="全局搜索"><div class="search-results" id="searchResults"></div>');$('#globalSearch').focus();$('#globalSearch').oninput=()=>{const q=$('#globalSearch').value.trim().toLowerCase();$('#searchResults').innerHTML=q?[...db.entities.filter(e=>`${e.name} ${e.code} ${e.location}`.toLowerCase().includes(q)).map(e=>`<button data-entity="${e.id}">${esc(e.name)}<small>${esc(e.code)} · ${types[e.type]}</small></button>`),...db.events.filter(e=>`${e.type} ${e.note}`.toLowerCase().includes(q)).map(e=>`<button data-event="${e.id}">${esc(e.type)}<small>${date(e.at)} · ${esc(e.note.slice(0,60))}</small></button>`)].slice(0,60).join('')||'<p class="empty">没有找到匹配记录</p>':'';};}
const snapshots=[];
$('#importFile').onchange=async event=>{const file=event.target.files[0];event.target.value='';if(!file)return;try{if(file.size>10*1024*1024)throw Error('备份文件不能超过 10MB');const parsed=JSON.parse(await file.text()),incoming=validate(parsed.data);if(parsed.format!=='life-atlas-backup')throw Error('备份格式无效');form('确认恢复范围',`<p class="note">即将替换当前${demoMode?'演示':'账户本地'}工作区：<br>${incoming.entities.length} 个实体<br>${incoming.events.length} 个事件<br>${incoming.relations.length} 条谱系关系<br>${incoming.plans.length} 项计划<br>${incoming.storageBoxes?.length||0} 个已保存冻存盒<br>${incoming.storageHistory?.length||0} 条位置历史</p><p class="form-hint">当前数据将先保存为保护快照，备份文件不会改变云端数据。</p><label><input type="checkbox" required>我确认替换当前工作区</label>`,async()=>{if(currentAccount().user?.id!==owner||storageFailed)throw Error('账户状态或本地数据库异常，恢复已停止');const next=structuredClone(incoming);next.revision=db.revision+1;next.audit.push({id:'LOG-'+crypto.randomUUID(),action:'restore',actor:owner,at:new Date().toISOString(),revision:next.revision});if(!demoMode)await save(owner,next,db.revision,{restore:true});snapshots.push(structuredClone(db));db=next;render();$('#drawer').hidden=true;toast('恢复完成，已保留恢复前快照');});}catch(error){toast(error.message);}};
document.addEventListener('click',async event=>{const b=event.target.closest('button');if(!b||busy)return;try{if(b.dataset.report){entityReport(b.dataset.report);return;}if(b.dataset.studyAction){studyAction(b.dataset.studyAction,b.dataset.studyId);return;}if(b.dataset.view){view=b.dataset.view;filter='';focusedId=null;pageTab='lifecycle';render();return;}if(b.dataset.focus){focusedId=b.dataset.focus;view=entityBy(focusedId).type;pageTab='lifecycle';render();return;}if(b.dataset.pageTab){pageTab=b.dataset.pageTab;render();return;}if(b.dataset.settingsTab){settingsTab=b.dataset.settingsTab;render();return;}if(b.dataset.eventMode){eventMode=b.dataset.eventMode;render();return;}if(b.dataset.entity){detail(b.dataset.entity);return;}if(b.dataset.event){eventDetail(b.dataset.event);return;}if(b.dataset.record){record(b.dataset.record,null,entityBy(b.dataset.record).type==='sample'&&entityBy(b.dataset.record).status==='stored'&&lifecycle(db,b.dataset.record).endAt?'解冻':null);return;}if(b.dataset.start){record(b.dataset.start,null,'启动计时');return;}if(b.dataset.correct){const e=db.events.find(e=>e.id===b.dataset.correct);record(e.entityIds[0],null,'修正记录',e.id);return;}if(b.dataset.planEntity){plan(b.dataset.planEntity);return;}if(b.dataset.plan){planDetail(b.dataset.plan);return;}if(b.dataset.completePlan){const p=db.plans.find(p=>p.id===b.dataset.completePlan);record(p.entityId,p.id,p.eventType);return;}if(b.dataset.postponePlan){changePlan(b.dataset.postponePlan,'postpone');return;}if(b.dataset.cancelPlan){changePlan(b.dataset.cancelPlan,'cancel');return;}if(b.dataset.storageBox){selectedStorageBox=b.dataset.storageBox;render();return;}
if(b.dataset.editProfile){editProfile(b.dataset.editProfile);return;}
if(b.dataset.createBatch){create({type:'cell',subtype:'培养批次',cellLineId:b.dataset.createBatch});return;}
if(b.dataset.storageAction){storageAction(b.dataset.storageAction,b.dataset.stockLocation||null);return;}
if(b.dataset.withdraw){record(b.dataset.withdraw,null,'取出');return;}
if(b.dataset.slot){const box=storageBoxes(db).find(box=>box.id===(b.dataset.boxId||selectedStorageBox))||storageBoxes(db)[0];storageAction('move',box.path+'/'+b.dataset.slot,box.kind);return;}

const action=b.dataset.action;if(action==='measurementPNG'){exportMeasurementPNG();return;}if(action==='exportMeasurements'){const study=(db.studies||[]).find(s=>s.id===selectedStudy)||(db.studies||[])[0];const rows=cohortMeasurements(db,{studyId:study?.id,cohortId:measurementCohort,eventType:measurementType});if(rows.length)download(measurementCSV(rows),'life-atlas-measurements.csv','text/csv;charset=utf-8');}if(action==='batch')batchRecord();if(action==='eventFilter'){eventQuery=$('#eventSearch').value;eventTypeFilter=$('#eventTypeFilter').value;render();}if(action==='density'){compact=!compact;render();}if(action==='clearSelection'){selectedEvents.clear();render();}if(action==='exportEvents'){const rows=db.events.filter(e=>selectedEvents.has(e.id));const csv=[['事件编号','事件类型','实际时间（含时区）','操作人员','模板版本','结构化字段 JSON','备注'],...rows.map(e=>[e.id,e.type,e.at,e.data.operator||e.actor,e.templateVersion||'',JSON.stringify(e.data),e.note])];download('\ufeff'+csv.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'),'life-atlas-events.csv','text/csv;charset=utf-8');toast('已导出 '+rows.length+' 个实际事件；计划不计为实际事件');}if(action==='create')create();if(action==='plan')plan();if(action==='demo'){demoMode=true;db=demo();render();$('#drawer').hidden=true;}if(action==='real'){const real=await load(owner);demoMode=false;db=real;render();$('#drawer').hidden=true;}if(action==='filter'){filter=$('#entityFilter').value;render();}if(action==='collapse'){collapsed=!collapsed;render();}if(action==='zoomIn'){zoom=Math.min(1.7,zoom+.1);render();}if(action==='zoomOut'){zoom=Math.max(.6,zoom-.1);render();}if(action==='zoomReset'){zoom=1;render();}if(action==='prev'){calendarOffset--;render();}if(action==='next'){calendarOffset++;render();}if(action==='today'){calendarOffset=0;render();}if(action==='export')download(JSON.stringify({format:'life-atlas-backup',exportedAt:new Date().toISOString(),data:db},null,2),`life-atlas-${day(new Date())}${demoMode?'-demo':''}.json`,'application/json');if(action==='csv'){const cell=v=>'"'+String(v??'').replaceAll('"','""').replace(/^[=+@-]/,"'$&")+'"';download('\ufeff'+[['编号','名称','类型','状态','位置'],...db.entities.filter(e=>e.type===view).map(e=>[e.code,e.name,e.subtype,e.status,e.location])].map(r=>r.map(cell).join(',')).join('\r\n'),'life-atlas-entities.csv','text/csv;charset=utf-8');}if(action==='import')$('#importFile').click();if(action==='snapshots'){const local=await import('./store.mjs?v=20261121.2');const all=demoMode?snapshots:await local.getSnapshots(owner);if(!all.length){toast('暂无恢复前保护快照');return;}download(JSON.stringify(all,null,2),'life-atlas-protection-snapshots.json','application/json');}
}catch(error){toast(error.message);}});
$('#quickCreate').onclick=()=>{if(view==='calendar'){plan();return;}if(view==='backup'){download(JSON.stringify({format:'life-atlas-backup',data:db},null,2),'life-atlas.json','application/json');return;}const items=db.entities.filter(e=>!isCellReference(db,e)&&(!types[view]||e.type===view));if(!items.length){create();return;}form('选择操作对象',`<label>关联实体<select name="entityId">${options(items)}</select></label>`,async p=>{record(p.entityId);});};
document.addEventListener('click',event=>{
  const panel=$('#drawer');
  if(!busy&&!panel.hidden&&!panel.contains(event.target)&&!event.target.closest('button,a,input,select,textarea,label,[role="button"]'))panel.hidden=true;
});
$('#closeDrawer').onclick=()=>$('#drawer').hidden=true;$('#searchOpen').onclick=search;$('#space').onclick=()=>{view='settings';render();};
document.addEventListener('keydown',event=>{if(!$('#reportPreview').hidden){if(event.key==='Escape'){event.preventDefault();closeReport();}if(event.key==='Tab'){event.preventDefault();(document.activeElement===$('#printReport')?$('#closeReport'):$('#printReport')).focus();}return;}if(event.key==='Escape')$('#drawer').hidden=true;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();search();}});
document.addEventListener('change',event=>{if(event.target.dataset.selectEvent){event.target.checked?selectedEvents.add(event.target.dataset.selectEvent):selectedEvents.delete(event.target.dataset.selectEvent);render();}if(event.target.id==='studyView'){selectedStudy=event.target.value;measurementCohort='';render();}if(event.target.id==='measurementCohort'){measurementCohort=event.target.value;render();}if(event.target.id==='measurementType'){measurementType=event.target.value;render();}if(event.target.id==='focusEntity'){focusedId=event.target.value;render();}if(event.target.id==='calendarMode'){calendarMode=event.target.value;calendarOffset=0;render();}});
try{db=await load(owner);}catch(error){storageFailed=true;toast('无法读取本地数据：'+error.message);}render();
