import {parseEventFields} from './event-fields.mjs?v=20261120.4';
import {applyStudyCommand,validateStudies,membershipAt} from './studies.mjs?v=20261120.4';
import {initializeStorage,addStorageBox,locationBox,checkLocation,changeLocation,validateStorage} from './storage.mjs?v=20261120.4';
import {parseProfile,profileFields,cellLine,validateProfiles} from './profiles.mjs?v=20261120.4';
export const types = {sample:'样品',cell:'细胞',mouse:'小鼠'};
export const templates = {sample:['接收','处理','分装','冻存','解冻','提取','检测','转移','取出','归还','消耗','废弃'],cell:['培养','换液','传代','冻存','复苏','转移','取出','归还','废弃','质量检测','实验使用','终止培养'],mouse:['入库','转笼','基因分型','荷瘤','给药','细胞回输','体重测量','肿瘤测量','活检','终点取材','实际处置']};
const uid = prefix => prefix+'-'+crypto.randomUUID();
export const empty = () => ({version:1,revision:0,entities:[],lifecycles:[],events:[],relations:[],plans:[],audit:[]});
export function day(date){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(date));return `${p.find(x=>x.type==='year').value}-${p.find(x=>x.type==='month').value}-${p.find(x=>x.type==='day').value}`;}
export function days(start,end){return Math.round((Date.parse(day(end))-Date.parse(day(start)))/86400000);}
export function lifecycle(db,id){return db.lifecycles.filter(l=>l.entityId===id).at(-1);}
export function isCellReference(db,entity){return entity?.type==='cell'&&entity.subtype==='细胞系'&&!lifecycle(db,entity.id)?.startAt;}
export function age(db,id,at=new Date().toISOString()){if(isCellReference(db,db.entities.find(e=>e.id===id)))return '基础档案';const l=lifecycle(db,id);return l?.startAt?`D${days(l.startAt,l.endAt||at)}`:'未启动';}
export function eventAge(db,id,event){if(isCellReference(db,db.entities.find(e=>e.id===id)))return '档案记录';const participant=event.participants?.find(p=>p.entityId===id),l=participant?db.lifecycles.find(l=>l.id===participant.lifecycleId):db.lifecycles.filter(l=>l.entityId===id&&l.startAt&&Date.parse(l.startAt)<=Date.parse(event.at)).at(-1);return l?.startAt?'D'+days(l.startAt,event.at):'保存期';}
function required(value,message){if(!value)throw Error(message);}
function validDate(value){required(value&&Number.isFinite(Date.parse(value)),'请输入有效时间');}
function entity(db,input,at){
  required(types[input.type],'实体类型无效');required(input.name?.trim(),'请填写实体名称');validDate(at);
  const id=uid('ENT');let code=input.code?.trim();
  if(!code){let sequence=db.entities.filter(e=>e.type===input.type).length;do{sequence++;code=`${{cell:'CL',sample:'SP',mouse:'MS'}[input.type]}-${String(sequence).padStart(4,'0')}`;}while(db.entities.some(e=>e.code===code));}
  required(!db.entities.some(e=>e.code===code),'实体编号已存在');
  const subtype=input.subtype||types[input.type],reference=input.type==='cell'&&subtype==='细胞系';
  required(!reference||!input.location,'细胞系为基础档案，请为具体批次或冻存管分配物理位置');
  const attributes=parseProfile(input.type,subtype,input.attributes,at);
  if(input.type==='cell')required(input.passage===null||Number.isInteger(Number(input.passage??0))&&Number(input.passage??0)>=0,'传代次数必须为非负整数或未知');
  if(input.cellLineId){required(input.type==='cell'&&!reference,'只有培养批次和冻存管可以关联细胞系');const line=cellLine(db,input.cellLineId);if(!attributes.conditions)attributes.conditions=line.attributes?.defaultConditions||'';}
  const e={id,code,name:input.name.trim(),type:input.type,subtype,status:reference?'active':input.dormant?'stored':'active',location:input.location||'',passage:input.passage===null?null:Number(input.passage)||0,createdAt:at,attributes,...(input.cellLineId?{cellLineId:input.cellLineId}:{})};db.entities.push(e);
  checkLocation(db,e,e.location);
  db.lifecycles.push({id:uid('LC'),entityId:id,acquiredAt:at,startAt:input.dormant||reference?null:at,countingStartedAt:input.dormant||reference?null:at,endAt:null,status:input.dormant||reference?'waiting':'active',sequence:1});return e;
}
// Commands operate on a copy. A failed command never leaves partial entities or events.
export function execute(original,command,actor='local'){
  const db=structuredClone(original),now=new Date().toISOString(),p=command.data||{},at=p.at||now;validDate(at);
  if(command.key&&db.events.some(e=>e.idempotencyKey===command.key))return original;
  initializeStorage(db);
  if(command.type==='storage-box'){
    const box=addStorageBox(db,p,at,actor);db.revision++;db.audit.push({id:uid('LOG'),at:now,actor,action:'storage-box',objectId:box.id,revision:db.revision});return db;
  }
  if(['study','cohort','membership','tag'].includes(command.type)){
    const objectId=applyStudyCommand(db,command.type,p,at,actor);db.revision++;
    db.audit.push({id:uid('LOG'),at:now,actor,action:command.type,objectId,reason:p.reason||'',revision:db.revision});return db;
  }
  if(command.type==='inventory-import'){
    required(typeof command.key==='string'&&command.key&&command.key.length<=120,'批量导入必须提供有效幂等键');
    required(Array.isArray(p.items)&&p.items.length>0&&p.items.length<=500,'每次必须新增 1–500 支冻存管');
    required(p.items.every(item=>item&&Number.isInteger(item.sourceRow)&&item.sourceRow>=2&&item.data&&typeof item.data==='object'),'导入行数据无效');
    required(new Set(p.items.map(item=>item.sourceRow)).size===p.items.length,'导入来源行重复');
    const skippedRows=p.skippedRows||[],sourceName=p.sourceName||'粘贴表格';
    required(Array.isArray(skippedRows)&&skippedRows.length<=500&&skippedRows.every(row=>Number.isInteger(row)&&row>=2)&&new Set(skippedRows).size===skippedRows.length&&!skippedRows.some(row=>p.items.some(item=>item.sourceRow===row)),'跳过行记录无效');
    required(typeof sourceName==='string'&&sourceName.length<=200,'导入来源名称无效');
    const request=JSON.stringify({items:p.items,skippedRows}),prior=db.audit.find(a=>a.action==='inventory-import'&&a.batchId===command.key);
    if(prior){required(prior.request===request&&prior.sourceName===sourceName,'同一导入标识不能用于不同内容');return original;}
    required(!db.events.some(e=>e.inventoryImportId===command.key),'已有不完整的同批导入记录，请检查备份');
    required(!db.events.some(e=>p.items.some(item=>e.idempotencyKey===command.key+':'+item.sourceRow)),'导入行标识已被使用，请重新生成导入预览');
    let next=db;
    for(const item of p.items){
      next=execute(next,{type:'inventory-register',key:command.key+':'+item.sourceRow,data:{...item.data,at}},actor);
      Object.assign(next.events.at(-1),{inventoryImportId:command.key,inventorySourceRow:item.sourceRow,inventorySourceName:sourceName});
    }
    next.revision++;next.audit.push({id:uid('LOG'),at:now,actor,action:'inventory-import',objectId:command.key,batchId:command.key,count:p.items.length,skippedRows,sourceName,request,revision:next.revision});return next;
  }
  if(command.type==='batch'){
    required(command.key,'批量操作必须提供幂等键');
    required(Array.isArray(p.items)&&p.items.length>0&&p.items.length<=100,'批量记录数量必须为 1–100');
    required(new Set(p.items.map(item=>item.entityId)).size===p.items.length,'批量记录不能重复选择同一实体');
    required(p.items.every(item=>db.entities.some(e=>e.id===item.entityId&&e.type==='mouse')),'批量操作只能选择小鼠');
    required(['给药','体重测量','肿瘤测量','转笼','基因分型'].includes(p.eventType),'不支持的批量事件类型');
    const existing=db.events.filter(e=>e.batchId===command.key);
    if(existing.length){required(existing.length===p.items.length,'批量幂等记录不完整');return original;}
    let next=db;
    for(const item of p.items)next=execute(next,{type:'event',key:command.key+':'+item.entityId,data:{...p,...item,eventType:p.eventType,batchId:command.key}},actor);
    return next;
  }
  if(['entity','inventory-register'].includes(command.type)){
    const stock=command.type==='inventory-register';let input=p,quantity;
    if(stock){
      required(locationBox(db,p.location||'')?.kind==='cell','请选择已建档的细胞冻存盒和格位');
      input={...p,type:'cell',subtype:'冻存管',dormant:true,passage:p.passage===undefined||p.passage===''?null:p.passage};
      if(p.quantity!==undefined&&p.quantity!==null&&p.quantity!==''){
        quantity=Number(p.quantity);required(Number.isFinite(quantity)&&quantity>0,'每管数量必须大于 0');
        required(typeof p.unit==='string'&&p.unit.trim()&&p.unit.length<=40,'请填写数量单位');
      }else required(!p.unit?.trim(),'填写单位时也需要填写每管数量');
    }
    required(Date.parse(at)<=Date.now(),'获得时间不能在未来');const e=entity(db,input,at);
    if(stock){e.registrationKind='existing_stock';if(quantity!==undefined){e.quantity=quantity;e.unit=p.unit.trim();}}
    db.events.push({id:uid('EV'),type:stock?'历史库存登记':'建档',at,createdAt:now,actor,idempotencyKey:command.key||null,entityIds:[e.id],participants:[{entityId:e.id,role:'subject',lifecycleId:lifecycle(db,e.id).id}],outputIds:[],note:p.note||'',profileSchema:profileFields(e.type,e.subtype),data:{profile:{attributes:structuredClone(e.attributes),cellLineId:e.cellLineId||null,...(stock?{passage:e.passage,quantity:quantity??null,unit:e.unit||''}:{})}}});
    if(e.location)Object.assign(db.events.at(-1).data,changeLocation(db,e,e.location,at,db.events.at(-1).id));
    if(e.cellLineId){const ev=db.events.at(-1);ev.entityIds.push(e.cellLineId);ev.outputIds.push(e.id);ev.participants.push({entityId:e.cellLineId,role:'source',lifecycleId:lifecycle(db,e.cellLineId).id});db.relations.push({parentId:e.cellLineId,childId:e.id,eventId:ev.id,relationType:'cell_line_origin'});}
  }else if(command.type==='profile-update'){
    const e=db.entities.find(e=>e.id===p.entityId);required(e,'实体不存在');required(typeof p.reason==='string'&&p.reason.trim(),'修订档案必须填写原因');
    required(Date.parse(at)<=Date.now()&&Date.parse(at)>=Date.parse(e.createdAt),'档案修订时间无效');
    const before={attributes:structuredClone(e.attributes||{}),cellLineId:e.cellLineId||null};
    if(p.cellLineId!==undefined){required(!e.cellLineId||e.cellLineId===p.cellLineId,'已有细胞系关联不能通过普通档案修订替换');if(p.cellLineId){required(e.type==='cell'&&e.subtype!=='细胞系','当前实体不能关联细胞系');cellLine(db,p.cellLineId);e.cellLineId=p.cellLineId;}}
    e.attributes=parseProfile(e.type,e.subtype,{...(e.attributes||{}),...p.attributes},e.createdAt);
    const after={attributes:structuredClone(e.attributes),cellLineId:e.cellLineId||null};required(before.cellLineId!==after.cellLineId||profileFields(e.type,e.subtype).some(field=>(before.attributes[field.key]||'')!==(after.attributes[field.key]||'')),'档案内容没有变化');
    db.events.push({id:uid('EV'),type:'档案修订',at,createdAt:now,actor,entityIds:[e.id],participants:[{entityId:e.id,role:'subject',lifecycleId:lifecycle(db,e.id).id}],outputIds:[],note:p.reason.trim(),profileSchema:profileFields(e.type,e.subtype),data:{before,after}});
  }else if(command.type==='plan'){
    required(p.name?.trim(),'请填写计划名称');const target=db.entities.find(e=>e.id===p.entityId);required(target,'请选择关联实体');required(!isCellReference(db,target),'请为独立培养批次创建实验计划');required(!p.eventType||templates[target.type].includes(p.eventType),'计划事件类型无效');db.plans.push({id:uid('PL'),name:p.name.trim(),entityId:p.entityId,eventType:p.eventType||null,scheduledAt:at,status:'pending',createdAt:now});
  }else if(command.type==='plan-update'){
    const plan=db.plans.find(plan=>plan.id===p.planId);required(plan,'计划不存在');
    required(['pending','postponed'].includes(plan.status),'已完成或取消的计划不能再次变更');
    required(typeof p.reason==='string'&&p.reason.trim(),'请填写计划变更原因');
    required(['postpone','cancel'].includes(p.action),'计划操作无效');
    plan.history ||= [];
    const from=plan.nextAt||plan.scheduledAt;
    if(p.action==='postpone'){validDate(p.nextAt);required(Date.parse(p.nextAt)>Date.parse(from),'延期时间必须晚于当前计划时间');plan.nextAt=p.nextAt;plan.status='postponed';}
    else plan.status='cancelled';
    plan.history.push({at:now,actor,action:p.action,from,to:p.action==='postpone'?p.nextAt:null,reason:p.reason.trim()});
  }else if(command.type==='event'){
    const e=db.entities.find(e=>e.id===p.entityId);required(e,'实体不存在');let l=lifecycle(db,e.id);required(p.eventType,'请选择事件类型');
    required(!isCellReference(db,e)||p.eventType==='修正记录','细胞系是基础档案，请在独立培养批次上记录实验事件');
    required(p.eventType==='修正记录'||p.eventType==='启动计时'||templates[e.type].includes(p.eventType),'事件类型与实体不匹配');
    required(e.subtype!=='冻存管'||['复苏','转移','取出','归还','废弃','修正记录'].includes(p.eventType),'冻存管只能复苏、转移、取出、归还或废弃');
    if(e.type==='sample'&&e.status==='stored'&&p.eventType==='解冻'){required(Date.parse(at)>=Date.parse(l.endAt||l.acquiredAt||e.createdAt),'解冻不能早于冻存');const source=l;l.endAt=l.endAt||at;l.status='ended';l={id:uid('LC'),entityId:e.id,acquiredAt:e.createdAt,startAt:at,countingStartedAt:at,endAt:null,status:'active',sequence:db.lifecycles.filter(v=>v.entityId===e.id).length+1,sourceLifecycleId:source.id,sourceEventId:db.relations.find(r=>r.childId===e.id)?.eventId||null};db.lifecycles.push(l);e.status='active';}
    const correction=p.eventType==='修正记录';
    if(correction){required(db.events.some(v=>v.id===p.correctedFrom&&v.entityIds.includes(e.id)),'请选择被修正的事件');required(p.note?.trim(),'修正必须说明原因与更正内容');}
    else{required(!l.endAt,'该生命周期已结束，请进入衍生实体继续记录');required(!l.startAt||Date.parse(at)>=Date.parse(l.startAt),'事件不能早于生命周期起点');const latest=db.events.filter(v=>v.entityIds.includes(e.id)&&!['修正记录','档案修订'].includes(v.type)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];required(!latest||Date.parse(at)>=Date.parse(latest.at),'首版请按时间顺序追加事件');required(Date.parse(at)<=Date.now(),'未来操作请创建计划');}
    if(p.planId){const plan=db.plans.find(x=>x.id===p.planId);required(plan&&plan.entityId===e.id&&['pending','postponed'].includes(plan.status),'计划无效或已完成');required(!plan.eventType||plan.eventType===p.eventType,'执行事件与计划模板不一致');required(!correction,'修正记录不能完成实验计划');plan.status='completed';}
    const parsed=parseEventFields(p.eventType,e.type,p);
    const membership=p.studyId?membershipAt(db,e.id,p.studyId,at):null;
    if(p.studyId)required(membership&&(!p.cohortId||membership.cohortId===p.cohortId),'操作发生时该小鼠不属于所选项目分组');
    const ev={id:uid('EV'),type:p.eventType,at,createdAt:now,actor,idempotencyKey:command.key||null,batchId:p.batchId||null,templateVersion:'preset-v2',fieldSchema:parsed.schema,timePrecision:'minute',timezone:'Asia/Shanghai',entityIds:[e.id],participants:[{entityId:e.id,role:'subject',lifecycleId:l.id}],outputIds:[],note:p.note||'',correctedFrom:p.correctedFrom||null,planId:p.planId||null,data:{...parsed.data,...(p.operator?{operator:String(p.operator).trim()}: {})}};
    if(membership){ev.studyId=membership.studyId;ev.cohortId=membership.cohortId;}
    if(p.relatedId){required(db.entities.some(x=>x.id===p.relatedId),'关联实体不存在');if(p.relatedId!==e.id){ev.entityIds.push(p.relatedId);ev.participants.push({entityId:p.relatedId,role:'input',lifecycleId:lifecycle(db,p.relatedId).id});}}
    if(['荷瘤','细胞回输'].includes(p.eventType))required(db.entities.some(v=>v.id===p.relatedId&&v.type==='cell'&&v.subtype==='培养批次'),'请选择来源细胞培养批次');
    if(p.eventType==='基因分型'){ev.data.previousGenotype=e.attributes?.genotype||'';e.attributes={...(e.attributes||{}),genotype:parsed.data.result};}
    if(e.type==='cell'&&['培养','换液'].includes(p.eventType)&&parsed.data.conditions){const field=e.subtype==='细胞系'?'defaultConditions':'conditions';ev.data.previousConditions=e.attributes?.[field]||'';e.attributes={...(e.attributes||{}),[field]:parsed.data.conditions};}
    if(['转移','转笼','归还'].includes(p.eventType)){required(p.location?.trim(),'请填写新位置');Object.assign(ev.data,changeLocation(db,e,p.location.trim(),at,ev.id));}
    if(p.eventType==='取出'){required(e.location,'实体当前没有可取出的位置');Object.assign(ev.data,changeLocation(db,e,'',at,ev.id));}
    if(p.eventType==='启动计时'){required(!l.startAt,'计时已经启动');if(e.type==='sample'){const source=l;l.endAt=at;l.status='ended';l={id:uid('LC'),entityId:e.id,acquiredAt:source.acquiredAt||e.createdAt,startAt:at,countingStartedAt:at,endAt:null,status:'active',sequence:db.lifecycles.filter(v=>v.entityId===e.id).length+1,sourceLifecycleId:source.id,sourceEventId:db.relations.find(r=>r.childId===e.id)?.eventId||null};db.lifecycles.push(l);}else{l.startAt=at;l.countingStartedAt=at;l.status='active';}ev.participants[0].lifecycleId=l.id;e.status='active';}
    let branch=['传代','分装','提取','活检','终点取材','复苏'].includes(p.eventType)||(p.eventType==='冻存'&&e.type==='cell');
    if(branch){
      const count=Number(p.count??1);required(Number.isInteger(count)&&count>=1&&count<=81,'衍生数量必须为 1–81');
      if(['传代','分装','提取'].includes(p.eventType))required(typeof p.keepParent==='boolean','请明确选择母本是否保留');
      if(p.eventType==='分装')required(typeof p.longTerm==='boolean','请明确选择分装保存用途');
      if(p.eventType==='分装'&&Number.isFinite(e.quantity)){
        required(e.unit===parsed.data.unit,'分装单位必须与母本一致，请先核对数量单位');
        const remaining=e.quantity-count*parsed.data.quantity,tolerance=Math.max(1,e.quantity)*1e-10;
        required(remaining>=-tolerance,'分装总量超过母本剩余数量');
        required(p.keepParent===(remaining>tolerance),'母本保留选择与实际剩余数量不一致');
        e.quantity=Math.abs(remaining)<=tolerance?0:remaining;
      }
      required(!['传代','复苏'].includes(p.eventType)||e.type==='cell','此事件只适用于细胞');
      required(p.eventType!=='复苏'||e.subtype==='冻存管','请从独立冻存管复苏');
      required(p.eventType!=='传代'||e.subtype!=='冻存管','冻存管需要先复苏');
      for(let i=0;i<count;i++){
        const frozen=p.eventType==='冻存'||(p.eventType==='分装'&&p.longTerm),type=['活检','终点取材','提取'].includes(p.eventType)?'sample':e.type;
        const subtype=p.eventType==='冻存'?'冻存管':p.eventType==='复苏'||p.eventType==='传代'?'培养批次':p.eventType==='提取'?parsed.data.productSubtype:['活检','终点取材'].includes(p.eventType)?'组织':e.subtype;
        const child=entity(db,{name:`${p.childName?.trim()||e.name+' · '+p.eventType}${count>1?' '+(i+1):''}`,type,subtype,dormant:frozen,passage:e.passage===null?null:e.passage+(p.eventType==='传代'?1:0),...(type==='cell'?{cellLineId:e.cellLineId||(e.subtype==='细胞系'?e.id:undefined),attributes:{conditions:p.conditions||e.attributes?.conditions||e.attributes?.defaultConditions||'',container:p.container||e.attributes?.container||'',...(p.eventType==='冻存'?{frozenDate:day(at),cryoprotectant:parsed.data.cryoprotectant||''}:{})}}:{})},at);
        if(parsed.data.quantity!==undefined){child.quantity=parsed.data.quantity;child.unit=parsed.data.unit;}
        ev.outputIds.push(child.id);ev.entityIds.push(child.id);ev.participants.push({entityId:child.id,role:'output',lifecycleId:lifecycle(db,child.id).id});db.relations.push({parentId:e.id,childId:child.id,eventId:ev.id});
      }
    }
    const usedUp=p.eventType==='实验使用'&&parsed.data.allUsed==='全部使用'||p.eventType==='消耗'&&parsed.data.remainingQuantity===0;
    if(['实验使用','消耗'].includes(p.eventType)&&Number.isFinite(e.quantity)){
      required(e.unit===parsed.data.unit,'使用单位必须与当前数量单位一致');
      const remaining=usedUp?0:parsed.data.remainingQuantity;
      required(Math.abs(e.quantity-parsed.data.usedQuantity-remaining)<=Math.max(1,e.quantity)*1e-10,'使用量与剩余量不等于当前数量');
    }
    if(p.eventType==='实验使用'&&parsed.data.allUsed==='全部使用'){e.quantity=0;e.unit=parsed.data.unit;}
    if(['实验使用','消耗'].includes(p.eventType)&&parsed.data.remainingQuantity!==undefined){e.quantity=parsed.data.remainingQuantity;e.unit=parsed.data.unit;}
    if(!correction&&(p.eventType==='复苏'||p.eventType==='冻存'&&e.type==='cell'||['终止培养','废弃','实际处置'].includes(p.eventType)||usedUp||branch&&p.keepParent===false&&!['活检','终点取材'].includes(p.eventType))){
      if(e.location)Object.assign(ev.data,changeLocation(db,e,'',at,ev.id));l.endAt=at;l.status='ended';e.status='ended';
    }
    if(!correction&&e.type==='sample'&&['启动计时','解冻'].includes(p.eventType)&&e.location)Object.assign(ev.data,changeLocation(db,e,'',at,ev.id));
    if(p.eventType==='冻存'&&e.type==='sample'){e.status='stored';l.endAt=at;l.status='ended';db.lifecycles.push({id:uid('LC'),entityId:e.id,acquiredAt:at,startAt:null,countingStartedAt:null,endAt:null,status:'waiting',sequence:db.lifecycles.filter(v=>v.entityId===e.id).length+1,sourceLifecycleId:l.id,sourceEventId:ev.id});}
    db.events.push(ev);if(p.planId)db.plans.find(x=>x.id===p.planId).eventId=ev.id;
  }else throw Error('不支持的操作');
  db.revision++;db.audit.push({id:uid('LOG'),at:now,actor,action:command.type,objectId:['event','profile-update'].includes(command.type)?db.events.at(-1).id:['entity','inventory-register'].includes(command.type)?db.entities.at(-1).id:command.type==='plan-update'?p.planId:db.plans.at(-1).id,reason:p.reason||p.note||'',revision:db.revision});return db;
}
export function validate(db){
  required(db?.version===1&&Number.isInteger(db.revision)&&db.revision>=0,'备份版本不受支持');
  for(const key of ['entities','lifecycles','events','relations','plans','audit'])required(Array.isArray(db[key]),'备份缺少 '+key);
  for(const key of ['entities','lifecycles','events','plans','audit']){const ids=db[key].map(v=>v.id);required(ids.every(x=>typeof x==='string')&&new Set(ids).size===ids.length,'备份含重复或无效编号');}
  const ids=new Set(db.entities.map(e=>e.id)),events=new Set(db.events.map(e=>e.id));required(new Set(db.entities.map(e=>e.code)).size===db.entities.length,'实体编号重复');
  const occupied=db.entities.filter(e=>e.status!=='ended'&&e.location?.startsWith('LN01/')).map(e=>e.location);required(new Set(occupied).size===occupied.length,'存储位置冲突');
  db.entities.forEach(e=>{required(types[e.type]&&typeof e.name==='string'&&typeof e.code==='string'&&typeof e.location==='string'&&typeof e.subtype==='string'&&['active','stored','ended'].includes(e.status),'实体数据无效');required(db.lifecycles.some(l=>l.entityId===e.id),'实体缺少生命周期');});
  db.lifecycles.forEach(l=>{required(ids.has(l.entityId),'生命周期关联无效');if(l.startAt)validDate(l.startAt);if(l.endAt)validDate(l.endAt);required(!l.startAt||!l.endAt||Date.parse(l.endAt)>=Date.parse(l.startAt),'生命周期时间无效');});
  db.events.forEach(e=>{required(typeof e.type==='string'&&typeof e.note==='string'&&e.data&&typeof e.data==='object'&&Array.isArray(e.entityIds)&&e.entityIds.length>0&&e.entityIds.every(id=>ids.has(id))&&Array.isArray(e.outputIds)&&e.outputIds.every(id=>e.entityIds.includes(id)),'事件关联无效');validDate(e.at);required(!e.correctedFrom||events.has(e.correctedFrom),'修正关联无效');if(e.participants)required(Array.isArray(e.participants)&&e.participants.every(p=>e.entityIds.includes(p.entityId)&&['subject','input','output','source','recipient'].includes(p.role)&&db.lifecycles.some(l=>l.id===p.lifecycleId&&l.entityId===p.entityId)),'事件参与角色无效');});
  db.events.forEach(e=>{if(e.fieldSchema!==undefined)required(Array.isArray(e.fieldSchema)&&e.fieldSchema.every(f=>f&&typeof f.key==='string'&&typeof f.label==='string'&&['text','number','select'].includes(f.type)),'事件字段快照格式无效');});
  validateStudies(db);
  validateStorage(db);
  validateProfiles(db);
  db.relations.forEach(r=>required(ids.has(r.parentId)&&ids.has(r.childId)&&r.parentId!==r.childId&&db.events.some(e=>e.id===r.eventId&&e.entityIds.includes(r.parentId)&&e.outputIds.includes(r.childId)),'谱系关联无效'));
  const visited=new Set(),active=new Set();function visit(id){required(!active.has(id),'谱系存在环');if(visited.has(id))return;active.add(id);db.relations.filter(r=>r.parentId===id).forEach(r=>visit(r.childId));active.delete(id);visited.add(id);}ids.forEach(visit);
  db.plans.forEach(p=>{required(ids.has(p.entityId)&&typeof p.name==='string'&&['pending','completed','cancelled','delayed','postponed'].includes(p.status),'计划关联无效');validDate(p.scheduledAt);if(p.nextAt)validDate(p.nextAt);if(p.history){required(Array.isArray(p.history),'计划历史格式无效');p.history.forEach(h=>{validDate(h.at);validDate(h.from);if(h.to)validDate(h.to);required(['postpone','cancel'].includes(h.action)&&typeof h.reason==='string'&&h.reason.trim(),'计划变更历史无效');});}required(p.status!=='completed'||db.events.some(e=>e.id===p.eventId&&e.planId===p.id),'完成计划缺少实际事件');});return db;
}
export function demo(){
  let db=empty();const run=(type,data)=>{db=execute(db,{type,data},'演示用户');};
  run('entity',{name:'B16-F10',type:'cell',subtype:'培养批次',passage:3,at:'2026-11-12T09:00:00+08:00',location:'培养箱 01 / 第二层'});const cell=db.entities[0].id;
  run('event',{entityId:cell,eventType:'换液',at:'2026-11-14T10:00:00+08:00',note:'细胞状态良好，汇合度约 70%。'});
  run('event',{entityId:cell,eventType:'传代',at:'2026-11-16T10:00:00+08:00',count:2,keepParent:true,childName:'B16-F10 · P4'});
  run('event',{entityId:db.entities[1].id,eventType:'冻存',at:'2026-11-18T10:00:00+08:00',count:3,quantity:1000000,unit:'cells',cryoprotectant:'演示冻存液'});
  run('entity',{name:'C57BL/6J · M001',type:'mouse',subtype:'小鼠个体',at:'2026-11-10T09:00:00+08:00',location:'SPF / R02 / C08'});const mouse=db.entities.at(-1).id;
  run('event',{entityId:mouse,eventType:'荷瘤',relatedId:cell,cellCount:1000000,volume:100,volumeUnit:'μL',site:'演示部位',at:'2026-11-15T10:00:00+08:00',note:'关联细胞培养批次，用于谱系追溯。'});
  run('event',{entityId:mouse,eventType:'体重测量',value:21.8,at:'2026-11-16T09:00:00+08:00'});
  run('event',{entityId:mouse,eventType:'体重测量',value:22.4,at:'2026-11-18T09:00:00+08:00'});
  run('entity',{name:'脾脏单细胞悬液',type:'sample',subtype:'细胞样品',at:'2026-11-17T09:00:00+08:00',location:'实验台 02'});const sample=db.entities.at(-1).id;
  run('event',{entityId:sample,eventType:'分装',at:'2026-11-18T11:00:00+08:00',count:2,keepParent:true,longTerm:true,quantity:1,unit:'mL',purpose:'独立保存'});
  run('plan',{entityId:cell,eventType:'换液',name:'观察细胞状态与换液',at:new Date(Date.now()+86400000).toISOString()});run('plan',{entityId:mouse,eventType:'体重测量',name:'记录体重与肿瘤体积',at:new Date(Date.now()+2*86400000).toISOString()});return db;
}
