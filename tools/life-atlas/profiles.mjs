const required=(condition,message)=>{if(!condition)throw Error(message);};
const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export function profileFields(type,subtype) {
  const common=[{key:'source',label:'来源'},{key:'notes',label:'档案备注',multiline:true}];
  if(type==='mouse')return [
    {key:'strain',label:'品系'},{key:'sex',label:'性别',options:['未知','雌','雄']},
    {key:'genotype',label:'基因型'},{key:'birthDate',label:'出生日期',type:'date'},
    {key:'animalFacility',label:'动物房'},{key:'ethicsId',label:'伦理审批编号'},...common
  ];
  if(type==='cell'&&subtype==='细胞系')return [
    {key:'species',label:'物种'},{key:'cellType',label:'细胞类型'},
    {key:'reference',label:'文献 / 来源文献'},{key:'establishedDate',label:'建立日期',type:'date'},
    {key:'defaultConditions',label:'默认培养条件',multiline:true},...common
  ];
  if(type==='cell')return [...(subtype==='冻存管'?[{key:'frozenDate',label:'实际冻存日期',type:'date'},{key:'cryoprotectant',label:'冻存液'}]:[]),{key:'conditions',label:'培养条件',multiline:true},{key:'container',label:'培养容器'},...common];
  return common;
}
export function parseProfile(type,subtype,input={},acquiredAt) {
  required(input&&typeof input==='object'&&!Array.isArray(input),'档案字段格式无效');
  const fields=profileFields(type,subtype),allowed=new Set(fields.map(f=>f.key)),result={};
  required(Object.keys(input).every(key=>allowed.has(key)),'档案包含不支持的字段');
  for(const field of fields){
    const value=input[field.key];if(value===undefined)continue;
    required(typeof value==='string'&&value.length<=2000,field.label+'格式无效');
    result[field.key]=value.trim();if(!result[field.key])continue;
    if(field.options)required(field.options.includes(result[field.key]),field.label+'选项无效');
    if(field.type==='date'){
      const date=new Date(result[field.key]+'T00:00:00Z');
      required(/^\d{4}-\d{2}-\d{2}$/.test(result[field.key])&&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===result[field.key],field.label+'无效');
      required(result[field.key]<=day(acquiredAt),field.label+'不能晚于实体获得日期');
    }
  }
  return result;
}
export function cellLine(db,id) {
  const line=db.entities.find(e=>e.id===id);
  required(line&&line.type==='cell'&&line.subtype==='细胞系','请选择存在的细胞系基础档案');return line;
}
export function animalAge(entity,at=new Date().toISOString()) {
  const birth=entity.attributes?.birthDate;if(!birth)return '未知';
  const days=Math.round((Date.parse(day(at))-Date.parse(birth))/86400000);
  return `${Math.floor(days/7)} 周 ${days%7} 天（${days} 天）`;
}
export const passageLabel=entity=>entity.passage===null?'P 未知':'P'+entity.passage;
export function validateProfiles(db) {
  db.entities.forEach(e=>{
    if(e.attributes!==undefined)parseProfile(e.type,e.subtype,e.attributes,e.createdAt);
    if(e.cellLineId){required(e.type==='cell'&&e.subtype!=='细胞系','细胞系关联不适用于当前实体');cellLine(db,e.cellLineId);}
    if(e.type==='cell')required(e.passage===null||Number.isInteger(e.passage)&&e.passage>=0,'传代次数必须为非负整数或未知');
    if(e.registrationKind!==undefined)required(e.registrationKind==='existing_stock'&&e.type==='cell'&&e.subtype==='冻存管'&&db.events.some(v=>v.type==='历史库存登记'&&v.entityIds[0]===e.id),'历史库存登记来源无效');
  });
  db.events.filter(e=>e.type==='档案修订').forEach(e=>{
    const entity=db.entities.find(v=>v.id===e.entityIds[0]);
    required(entity&&e.note?.trim()&&e.data.before&&e.data.after,'档案修订缺少原始信息或原因');
    for(const snapshot of [e.data.before,e.data.after]){
      parseProfile(entity.type,entity.subtype,snapshot.attributes,entity.createdAt);
      if(snapshot.cellLineId)cellLine(db,snapshot.cellLineId);
    }
  });
  db.events.forEach(e=>{
    if(e.profileSchema!==undefined)required(Array.isArray(e.profileSchema)&&e.profileSchema.every(f=>f&&typeof f.key==='string'&&typeof f.label==='string'),'档案字段快照无效');
    if(e.data.profile){const entity=db.entities.find(v=>v.id===e.entityIds[0]);required(entity&&typeof e.data.profile==='object'&&e.data.profile.attributes,'建档快照无效');parseProfile(entity.type,entity.subtype,e.data.profile.attributes,entity.createdAt);if(e.data.profile.cellLineId)cellLine(db,e.data.profile.cellLineId);}
    if(e.type==='历史库存登记'){
      const entity=db.entities.find(v=>v.id===e.entityIds[0]),snapshot=e.data.profile;
      required(entity?.registrationKind==='existing_stock'&&snapshot&&(snapshot.passage===null||Number.isInteger(snapshot.passage)&&snapshot.passage>=0),'库存登记传代数快照无效');
      required(snapshot.quantity===null?typeof snapshot.unit==='string'&&!snapshot.unit:Number.isFinite(snapshot.quantity)&&snapshot.quantity>0&&typeof snapshot.unit==='string'&&snapshot.unit.trim(),'库存登记数量快照无效');
    }
  });
}

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function profileInputs(entity) {
  return profileFields(entity.type,entity.subtype).map(field=>{
    const value=entity.attributes?.[field.key]||'';
    const input=field.options?`<select name="profile_${field.key}">${field.options.map(option=>`<option ${option===value?'selected':''}>${esc(option)}</option>`).join('')}</select>`:field.multiline?`<textarea name="profile_${field.key}" maxlength="2000">${esc(value)}</textarea>`:`<input name="profile_${field.key}" type="${field.type||'text'}" maxlength="2000" value="${esc(value)}">`;
    return `<label>${field.label}${input}</label>`;
  }).join('');
}
export function profileValues(entity,formData) {
  return Object.fromEntries(profileFields(entity.type,entity.subtype).map(field=>[field.key,formData['profile_'+field.key]??'']));
}
export function profileDetails(db,entity) {
  const fields=profileFields(entity.type,entity.subtype),line=db.entities.find(e=>e.id===entity.cellLineId);
  const ended=db.lifecycles.filter(l=>l.entityId===entity.id).at(-1)?.endAt;
  return `<div class="detail-section"><h3>基础档案</h3>${entity.registrationKind==='existing_stock'?'<p class="form-hint">已有冻存库存：获得时间为本次登记确认时间；实际冻存日期单独记录，未知历史不补造。</p>':''}${entity.type==='mouse'?`<div class="field-line"><span>${ended?'终点时年龄':'实际年龄'}</span><span>${esc(animalAge(entity,ended||new Date().toISOString()))}</span></div><p class="form-hint">出生日期用于年龄；入库日期用于管理生命周期 D0，两者分别保存。</p>`:''}${entity.type==='cell'&&entity.subtype!=='细胞系'?`<div class="field-line"><span>所属细胞系</span><span>${line?`<button data-entity="${line.id}">${esc(line.name)}</button>`:'尚未关联'}</span></div>`:''}${fields.map(field=>`<div class="field-line"><span>${field.label}</span><span style="white-space:pre-wrap">${esc(entity.attributes?.[field.key]||'未记录')}</span></div>`).join('')}<button data-edit-profile="${entity.id}">补充 / 修订档案</button>${entity.type==='cell'&&entity.subtype==='细胞系'?`<button data-create-batch="${entity.id}">创建关联培养批次</button>`:''}</div>`;
}
export function profileEventDetails(db,event) {
  const entity=db.entities.find(e=>e.id===event.entityIds[0]);if(!entity)return '';
  if(event.type!=='档案修订'&&!event.data.profile)return '';
  const schema=event.profileSchema||profileFields(entity.type,entity.subtype);
  const before=event.data.before,after=event.data.after||event.data.profile;
  const lineName=id=>db.entities.find(e=>e.id===id)?.name||'未关联';
  const rows=schema.filter(f=>before?(before.attributes[f.key]||'')!==(after.attributes[f.key]||''):after.attributes[f.key]).map(f=>`<div class="field-line"><span>${esc(f.label)}</span><span style="white-space:pre-wrap">${before?esc(before.attributes[f.key]||'未记录')+' → ':''}${esc(after.attributes[f.key]||'未记录')}</span></div>`).join('');
  const line=before?before.cellLineId!==after.cellLineId:after.cellLineId;
  const stock=event.type==='历史库存登记'?`<p class="form-hint">本事件记录现有库存的登记确认，不代表今天进行了冻存。未知历史信息保留未知，位置从登记确认时间起跟踪。</p><div class="field-line"><span>登记时传代数</span><span>${after.passage===null?'未知':'P'+after.passage}</span></div><div class="field-line"><span>登记时每管数量</span><span>${after.quantity===null?'未知':esc(after.quantity+' '+after.unit)}</span></div>`:'';
  return rows+stock+(line?`<div class="field-line"><span>所属细胞系</span><span>${before?esc(lineName(before.cellLineId))+' → ':''}${esc(lineName(after.cellLineId))}</span></div>`:'')+(event.data.to?`<div class="field-line"><span>初始位置</span><span>${esc(event.data.to)}</span></div>`:'')||'<p class="muted">暂无已填写的基础字段</p>';
}
