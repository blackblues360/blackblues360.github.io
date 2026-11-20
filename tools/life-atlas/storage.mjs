const required=(condition,message)=>{if(!condition)throw Error(message);};
const uid=prefix=>prefix+'-'+crypto.randomUUID();
const defaultBox={id:'BOX-LN01-A-01',kind:'cell',name:'盒 01',facility:'',room:'',equipment:'LN01',rack:'A',code:'01',path:'LN01/A/01',rows:9,columns:9};
export const storageBoxes=db=>db.storageBoxes||[structuredClone(defaultBox)];
export function initializeStorage(db) {
  db.storageBoxes ||= [structuredClone(defaultBox)];
  if(db.storageHistory!==undefined)return;
  // Legacy location caches prove the location, but not when it was first occupied.
  db.storageHistory=db.entities.filter(e=>e.location&&e.status!=='ended').map(e=>({id:uid('SH'),entityId:e.id,location:e.location,validFrom:null,validTo:null,eventId:null,source:'legacy_snapshot'}));
}
export function addStorageBox(db,p,at,actor) {
  initializeStorage(db);
  required(Date.parse(at)<=Date.now(),'冻存盒创建时间不能在未来');
  required(['cell','sample'].includes(p.kind),'请选择细胞盒或样品盒');
  const fields={};
  for(const key of ['facility','room','equipment','rack','code','name']) {
    required(typeof p[key]==='string'&&p[key].trim()&&p[key].length<=80&&!/[\/\\\x00-\x1f]/.test(p[key]),'请填写有效的存储层级和盒名称');fields[key]=p[key].trim();
    required(!['.','..'].includes(fields[key]),'存储层级名称无效');
  }
  const rows=Number(p.rows),columns=Number(p.columns);
  required(Number.isInteger(rows)&&Number.isInteger(columns)&&rows>=1&&rows<=26&&columns>=1&&columns<=26,'行列规格必须为 1–26');
  required(p.kind!=='cell'||rows===9&&columns===9,'细胞冻存盒固定为 9×9');
  const path=[fields.facility,fields.room,fields.equipment,fields.rack,fields.code].join('/');
  required(!db.storageBoxes.some(box=>box.path===path),'相同物理位置的冻存盒已存在');
  const box={id:uid('BOX'),kind:p.kind,...fields,path,rows,columns,createdAt:at,actor};db.storageBoxes.push(box);return box;
}
export function locationBox(db,location) {
  return storageBoxes(db).filter(box=>location.startsWith(box.path+'/')).sort((a,b)=>b.path.length-a.path.length)[0];
}
export function checkLocation(db,entity,location) {
  required(typeof location==='string'&&location.length<=500,'位置格式无效');
  if(!location)return;
  const box=locationBox(db,location);
  if(!box){required(entity.type==='mouse'||!location.startsWith('LN01/')&&!/\/[A-Z]\d+$/.test(location),'目标冻存盒不存在，请先建立冻存盒');return;}
  const coordinate=location.slice(box.path.length+1),match=/^([A-Z])([1-9]\d*)$/.exec(coordinate);
  required(match&&match[1].charCodeAt(0)-64<=box.rows&&Number(match[2])<=box.columns,'坐标超出冻存盒行列范围');
  required(entity.status!=='ended','已结束实体不能占用冻存盒');
  required(box.kind==='cell'?entity.type==='cell'&&entity.subtype==='冻存管'&&entity.status==='stored':entity.type==='sample','实体类型与冻存盒不匹配');
  const other=db.entities.find(e=>e.id!==entity.id&&e.status!=='ended'&&e.location===location);
  required(!other,'位置已被 '+(other?.code||'其他实体')+' 占用');
}
export function changeLocation(db,entity,to,at,eventId) {
  initializeStorage(db);checkLocation(db,entity,to);
  const current=db.storageHistory.find(h=>h.entityId===entity.id&&!h.validTo);
  required(!current||current.location!==to,'实体已经位于目标位置');
  required(!current?.validFrom||Date.parse(at)>=Date.parse(current.validFrom),'转移时间不能早于当前存入时间');
  if(to&&locationBox(db,to))required(!db.storageHistory.some(h=>h.entityId!==entity.id&&h.location===to&&(!h.validTo||Date.parse(h.validTo)>Date.parse(at))),'目标格位在该时间段存在历史占用冲突');
  const from=current?.location||'';
  if(current){current.validTo=at;current.exitEventId=eventId;}
  if(to)db.storageHistory.push({id:uid('SH'),entityId:entity.id,location:to,validFrom:at,validTo:null,eventId,source:'event'});
  entity.location=to;return {from,to};
}
export function validateStorage(db) {
  if(db.storageBoxes!==undefined){
    required(Array.isArray(db.storageBoxes)&&db.storageBoxes.length>0,'冻存盒数据无效');
    required(new Set(db.storageBoxes.map(b=>b.id)).size===db.storageBoxes.length&&new Set(db.storageBoxes.map(b=>b.path)).size===db.storageBoxes.length,'冻存盒编号或路径重复');
    db.storageBoxes.forEach(b=>required(b&&typeof b.id==='string'&&typeof b.name==='string'&&typeof b.path==='string'&&b.path&&['cell','sample'].includes(b.kind)&&Number.isInteger(b.rows)&&Number.isInteger(b.columns)&&b.rows>=1&&b.rows<=26&&b.columns>=1&&b.columns<=26&&(b.kind!=='cell'||b.rows===9&&b.columns===9),'冻存盒规格无效'));
  }
  db.entities.filter(e=>e.status!=='ended').forEach(e=>checkLocation(db,e,e.location));
  if(db.storageHistory===undefined)return;
  required(Array.isArray(db.storageHistory),'位置历史格式无效');
  required(new Set(db.storageHistory.map(h=>h.id)).size===db.storageHistory.length,'位置历史编号重复');
  const events=new Map(db.events.map(e=>[e.id,e])),validDate=v=>Number.isFinite(Date.parse(v));
  db.storageHistory.forEach(h=>{
    required(h&&typeof h.id==='string'&&db.entities.some(e=>e.id===h.entityId)&&typeof h.location==='string'&&h.location,'位置历史关联无效');
    const source=events.get(h.eventId),exit=events.get(h.exitEventId),entity=db.entities.find(e=>e.id===h.entityId);
    required(h.source==='legacy_snapshot'?h.validFrom===null&&h.eventId===null:h.source==='event'&&validDate(h.validFrom)&&source?.entityIds.includes(h.entityId)&&source.at===h.validFrom&&source.data.to===h.location&&Date.parse(h.validFrom)>=Date.parse(entity.createdAt),'位置历史来源无效');
    required(!h.validTo||validDate(h.validTo)&&(!h.validFrom||Date.parse(h.validTo)>=Date.parse(h.validFrom))&&exit?.entityIds.includes(h.entityId)&&exit.at===h.validTo&&exit.data.from===h.location,'位置退出记录无效');
  });
  db.entities.forEach(e=>{
    const active=db.storageHistory.filter(h=>h.entityId===e.id&&!h.validTo);
    required(active.length<=1,'实体存在多个当前物理位置');
    required(e.status==='ended'?active.length===0:active.length===(e.location?1:0)&&(!active.length||active[0].location===e.location),'实体当前位置与位置历史不一致');
  });
  const timed=db.storageHistory.filter(h=>h.validFrom);
  for(let i=0;i<timed.length;i++)for(let j=i+1;j<timed.length;j++){
    const a=timed[i],b=timed[j],overlap=Date.parse(a.validFrom)<(b.validTo?Date.parse(b.validTo):Infinity)&&Date.parse(b.validFrom)<(a.validTo?Date.parse(a.validTo):Infinity);
    required(!overlap||a.entityId!==b.entityId,'实体位置历史有效期重叠');
    required(!overlap||a.location!==b.location||!locationBox(db,a.location),'冻存格位历史占用冲突');
  }
}

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function storageView(db,selectedId) {
  const boxes=storageBoxes(db),box=boxes.find(b=>b.id===selectedId)||boxes[0],occupied=db.entities.filter(e=>e.status!=='ended'&&locationBox(db,e.location)?.id===box.id);
  const equipment=[...new Set(boxes.map(b=>[b.facility,b.room,b.equipment].filter(Boolean).join(' / ')))];
  return `<div class="toolbar">${box.kind==='cell'?'<button class="primary" data-storage-action="stock">登记已有冻存管</button><button data-storage-action="import">批量导入库存</button>':''}<button data-storage-action="box">新建冻存盒</button><button data-storage-action="move">存入 / 转移 / 归还已建档记录</button><button data-storage-action="export">导出清单 / PDF</button><span class="muted">每格一个独立保存单位 · 取出保留历史</span></div><div class="storage-layout"><section class="card"><div class="card-body"><h2>存储位置</h2>${equipment.map(group=>`<div class="location-tree"><strong>${esc(group)}</strong>${boxes.filter(b=>[b.facility,b.room,b.equipment].filter(Boolean).join(' / ')===group).map(b=>`<button data-storage-box="${b.id}" class="${b.id===box.id?'selected-location':''}">${esc(b.rack)} / ${esc(b.name)} (${b.rows}×${b.columns})<small> · ${b.kind==='cell'?'细胞':'样品'}</small></button>`).join('')}</div>`).join('')}</div></section><section class="card"><div class="storage-legend"><span>已占用 ${occupied.length}</span><span>空位 ${box.rows*box.columns-occupied.length}</span></div><div class="table-wrap"><div class="storage-grid labelled" style="grid-template-columns:20px repeat(${box.columns},minmax(26px,1fr));min-width:${box.columns*35+50}px"><span></span>${Array.from({length:box.columns},(_,i)=>`<span class="grid-label">${i+1}</span>`).join('')}${Array.from({length:box.rows},(_,row)=>`<span class="grid-label">${String.fromCharCode(65+row)}</span>${Array.from({length:box.columns},(_,col)=>{const pos=String.fromCharCode(65+row)+(col+1),e=occupied.find(e=>e.location===box.path+'/'+pos);return `<button class="${e?'occupied':''}" ${e?`data-entity="${e.id}"`:`data-slot="${pos}" data-box-id="${box.id}"`} aria-label="${pos} ${e?esc(e.name):'空位'}" title="${pos} · ${e?esc(e.name):'空位'}">${pos}</button>`;}).join('')}`).join('')}</div></div></section><section class="card"><div class="card-body"><h2>${esc(box.name)}</h2><p class="form-hint">${esc(box.path)}</p><div class="field-line"><span>保存类型</span><span>${box.kind==='cell'?'细胞冻存管':'样品'}</span></div><div class="field-line"><span>规格</span><span>${box.rows} × ${box.columns}</span></div><div class="field-line"><span>占用</span><span>${occupied.length} / ${box.rows*box.columns}</span></div><p class="form-hint">点击占用格位查看来源与位置历史；点击空位选择保存单位；没有已建档冻存管时可直接登记已有库存。</p></div></section></div>`;
}
export function locationHistory(db,entityId) {
  const records=db.storageHistory?.filter(h=>h.entityId===entityId)||[];
  const eventIds=new Set(records.flatMap(h=>[h.eventId,h.exitEventId]).filter(Boolean));
  const legacy=db.events.filter(e=>e.entityIds[0]===entityId&&!eventIds.has(e.id)&&(e.data.from!==undefined||e.data.to!==undefined));
  const date=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'时间未知';
  return `<div class="detail-section"><h3>位置历史</h3>${records.slice().reverse().map(h=>`<div class="detail-event"><strong>${esc(h.location)}</strong><p>${date(h.validFrom)} 至 ${h.validTo?date(h.validTo):'现在'}</p>${h.source==='legacy_snapshot'?'<p>旧版本位置快照，存入时间未知</p>':''}${h.eventId?`<button data-event="${h.eventId}">查看存入事件</button>`:''}${h.exitEventId?`<button data-event="${h.exitEventId}">查看退出事件</button>`:''}</div>`).join('')}${legacy.map(e=>`<div class="detail-event"><button data-event="${e.id}">${esc(e.type)} · ${date(e.at)}</button><p>${esc(e.data.from||'未分配')} 至 ${esc(e.data.to||'已取出')}</p></div>`).join('')}${!records.length&&!legacy.length?'<p class="muted">尚无位置历史记录</p>':''}</div>`;
}
