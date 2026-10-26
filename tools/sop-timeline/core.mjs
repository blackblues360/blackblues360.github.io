// Real time is integer seconds. Rendering coordinates never enter these operations.
export const VERSION = 1;
export const defaultEnvironmentTerms = ['室温','冰上','4°C','37°C','避光','4°C · 避光','生物安全柜'];
export const defaults = { operationWidth: 116, waitWidth: 116, laneGap: 0, environmentWidth: 100, fontSize: 15, spacing: 14, theme: 'blue', orientation: 'portrait' };
export const clone = value => structuredClone(value);
export const uid = () => globalThis.crypto.randomUUID();
export const end = block => block.start + block.duration;
export const total = doc => Math.max(0, ...doc.blocks.map(end));
export function parseDuration(text) {
  const m = String(text).trim().match(/^(\d+(?:\.\d+)?)\s*(s|sec|秒|min|m|分钟|分|h|hr|小时)?$/i);
  if (!m) return null;
  const seconds = Math.round(Number(m[1]) * (/^(h|hr|小时)$/i.test(m[2]) ? 3600 : /^(s|sec|秒)$/i.test(m[2]) ? 1 : 60));
  return seconds >= 1 && seconds <= 604800 ? seconds : null;
}
export function formatDuration(seconds) {
  if(seconds===0)return '0 min';
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}
export function validate(doc) {
  if (!doc || doc.version !== VERSION || !Array.isArray(doc.groups) || !Array.isArray(doc.blocks) || !Array.isArray(doc.notes)) return '不支持的文件结构或版本';
  if (doc.groups.length > 200 || doc.blocks.length > 1000 || doc.notes.length > 1000) return '文件内容过多';
  if(doc.environmentTerms!==undefined&&(!Array.isArray(doc.environmentTerms)||doc.environmentTerms.length>100||doc.environmentTerms.some(term=>typeof term!=='string'||!term.trim()||term.length>80)))return '环境词条无效（最多 100 条，每条最多 80 字）';
  const ids = new Set();
  for (const g of doc.groups) {
    if (!g || typeof g.id !== 'string' || !/^[\w-]{1,100}$/.test(g.id) || ids.has(g.id) || typeof g.title !== 'string' || g.title.length > 500) return '大步骤数据无效';
    ids.add(g.id);
  }
  const blockIds = new Set();
  for (const b of doc.blocks) {
    if (!b || typeof b.id !== 'string' || !/^[\w-]{1,100}$/.test(b.id) || blockIds.has(b.id) || !ids.has(b.group) || !['operation', 'wait'].includes(b.lane) || !Number.isSafeInteger(b.start) || b.start < 0 || !Number.isSafeInteger(b.duration) || b.duration < 1 || b.duration > 604800 || end(b) > 6048000 || !['text', 'environment', 'object'].every(k => typeof b[k] === 'string' && b[k].length <= 20000)) return '时间块数据无效';
    blockIds.add(b.id);
  }
  const noteIds=new Set();for (const n of doc.notes) {if (!n || typeof n.id !== 'string' || !/^[\w-]{1,100}$/.test(n.id) || noteIds.has(n.id) || !ids.has(n.group) || typeof n.text !== 'string' || n.text.length > 20000) return '备注数据无效';noteIds.add(n.id);}
  if(doc.environmentRanges!==undefined){
    if(!Array.isArray(doc.environmentRanges)||doc.environmentRanges.length>2000)return '环境范围数据无效';
    const rangeIds=new Set();
    for(const r of doc.environmentRanges){
      const blocks=doc.blocks.filter(b=>b.group===r?.group),nodes=blocks.flatMap(b=>[b.start,end(b)]);
      if(!r||typeof r.id!=='string'||!/^[\w-]{1,100}$/.test(r.id)||rangeIds.has(r.id)||!ids.has(r.group)||!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start>=r.end||!nodes.includes(r.start)||!nodes.includes(r.end)||typeof r.environment!=='string'||!r.environment.trim()||r.environment.length>20000)return '环境范围必须吸附到对应大步骤的时间节点';
      for(const edge of ['start','end'])if(r[`${edge}Anchor`]){const a=r[`${edge}Anchor`],b=blocks.find(b=>b.id===a.blockId);if(!b||!['start','end'].includes(a.edge)||(a.edge==='start'?b.start:end(b))!==r[edge])return '环境范围锚点无效';}
      rangeIds.add(r.id);
    }
    for(const g of doc.groups){const ranges=doc.environmentRanges.filter(r=>r.group===g.id).sort((a,b)=>a.start-b.start);for(let i=1;i<ranges.length;i++)if(ranges[i].start<ranges[i-1].end)return '同一大步骤的环境范围不能重叠';}
  }
  for (const lane of ['operation', 'wait']) {
    const blocks = doc.blocks.filter(b => b.lane === lane).sort((a,b) => a.start-b.start);
    for (let i=1;i<blocks.length;i++) if (blocks[i].start < end(blocks[i-1])) return '同一泳道的时间块不能重叠';
  }
  let covered = 0;
  for (const b of [...doc.blocks].sort((a,b) => a.start-b.start)) {
    if (b.start > covered) return '实验时间轴不能出现空洞';
    covered = Math.max(covered, end(b));
  }
  let previousEnd = 0;
  for (const group of doc.groups) {
    const blocks = doc.blocks.filter(b=>b.group===group.id);
    if (!blocks.length) continue;
    if (Math.min(...blocks.map(b=>b.start)) < previousEnd) return '大步骤不能相互交叉，请整体移动容器';
    previousEnd = Math.max(...blocks.map(end));
  }
  return null;
}
export function emptyDocument() {
  return { version: VERSION, name: '未命名实验 SOP', author: '', date: new Date().toLocaleDateString('sv-SE'), revision: 'v1.0', groups: [{id:uid(),title:'实验准备',collapsed:false}], blocks: [], notes: [], environmentTerms:[...defaultEnvironmentTerms], environmentRanges:[], layout: {...defaults} };
}
export function sampleDocument() {
  const d = emptyDocument(); d.name='流式细胞术 · 细胞表面抗体染色';
  d.groups = ['细胞收集','抗体染色','洗涤与检测'].map(title=>({id:uid(),title,collapsed:false}));
  const add=(g,l,s,t,text,env='室温',object='样本')=>d.blocks.push({id:uid(),group:d.groups[g].id,lane:l,start:s*60,duration:t*60,text,environment:env,object});
  add(0,'operation',0,5,'离心收集细胞，弃上清并重悬于基础培养基中。');
  add(0,'operation',5,2,'计数细胞并调整浓度至 1 × 10⁶ cells/mL。');
  add(0,'operation',7,5,'将细胞分装至新的离心管中，每管 100 μL。');
  add(1,'operation',12,2,'加入抗体，轻轻混匀。');
  add(1,'wait',14,30,'4°C 避光孵育。','4°C · 避光');
  add(1,'operation',14,5,'孵育期间配制洗涤液。','室温','试剂');
  add(2,'operation',44,5,'洗涤细胞，离心后弃上清，并重悬于 PBS 中。');
  add(2,'operation',49,3,'上机检测，保存流式数据。');
  d.notes=[{id:uid(),group:d.groups[0].id,text:'可根据细胞类型调整离心条件。'}];d.environmentRanges=legacyEnvironmentRanges(d);return d;
}
export function endpoints(doc) { return [...new Set([0,...doc.blocks.flatMap(b=>[b.start,end(b)])])].sort((a,b)=>a-b); }
function result(doc,before) { if(before)syncEnvironmentRanges(before,doc);const error=validate(doc); return error ? {error} : {doc}; }
// Directed dependency closure: starts on a moved tail (or a moved head) follow it.
// Blocks ending at the original tail are deliberately not included.
function followers(doc, source) {
  const moved=new Set(), nodes=new Set([end(source)]);
  let changed=true;
  while(changed) { changed=false; for(const b of doc.blocks) if(b.id!==source.id && !moved.has(b.id) && nodes.has(b.start)) { moved.add(b.id); nodes.add(end(b)); changed=true; } }
  return moved;
}
export function resizeBlock(doc,id,duration) {
  const original=doc.blocks.find(b=>b.id===id); if(!original) return {error:'找不到时间块'};
  const wanted=Math.max(1,Math.min(604800,Math.round(duration))), delta=wanted-original.duration;
  if(!delta) return {doc:clone(doc),limited:false};
  const moved=followers(doc,original);
  const at=change=>{const d=clone(doc);for(const b of d.blocks) {if(b.id===id)b.duration+=change;else if(moved.has(b.id))b.start+=change;}syncEnvironmentRanges(doc,d);return d;};
  // Legality changes only where affine endpoint coordinates cross. Visit each
  // interval in order, so a drag cannot jump over an illegal region.
  const points=doc.blocks.flatMap(b=>[{v:b.start,k:moved.has(b.id)?1:0},{v:end(b),k:b.id===id||moved.has(b.id)?1:0}]);
  const critical=new Set([0,delta,1-original.duration]);
  for(const b of doc.blocks)if(moved.has(b.id)||b.id===id)critical.add(6048000-end(b));
  for(const a of points) for(const b of points) if(a.k!==b.k) {const x=(b.v-a.v)/(a.k-b.k);if(Math.sign(x)===Math.sign(delta)&&Math.abs(x)<=Math.abs(delta))critical.add(x);}
  const candidates=[...critical].filter(x=>Math.sign(x)===Math.sign(delta)||x===0).filter(x=>Math.abs(x)<=Math.abs(delta)).sort((a,b)=>Math.abs(a)-Math.abs(b));
  let accepted=0;
  for(let i=1;i<candidates.length;i++) {
    const next=candidates[i], probe=accepted+Math.sign(delta);
    if(Math.abs(next-accepted)>1 && validate(at(probe)))break;
    if(validate(at(next)))break;
    accepted=next;
  }
  const d=at(accepted);return {doc:d,limited:accepted!==delta,message:accepted!==delta?'已限制在最近合法时间边界，其他时间块时长保持不变。':null};
}
function closeGaps(doc) {
  const d=clone(doc);let covered=0;
  for(const b of [...d.blocks].sort((a,b)=>a.start-b.start)) {
    if(b.start>covered) {const gap=b.start-covered, boundary=b.start;for(const item of d.blocks)if(item.start>=boundary)item.start-=gap;}
    covered=Math.max(covered,end(b));
  } return d;
}
export function deleteBlock(doc,id) { const d=clone(doc);d.blocks=d.blocks.filter(b=>b.id!==id);return result(closeGaps(d),doc); }
export function deleteGroup(doc,id) { const d=clone(doc);d.groups=d.groups.filter(g=>g.id!==id);d.blocks=d.blocks.filter(b=>b.group!==id);d.notes=d.notes.filter(n=>n.group!==id);return result(closeGaps(d),doc); }
export function addBlock(doc,block,target=total(doc)) {
  const candidates=endpoints(doc).flatMap(t=>[t,t-block.duration]).filter(t=>t>=0);
  const ordered=[...new Set(candidates)].sort((a,b)=>Math.abs(a-target)-Math.abs(b-target)||a-b);
  for(const start of ordered) {const d=clone(doc);d.blocks.push({...block,start});const next=result(d,doc);if(!next.error)return {...next,start};}
  return {error:'没有合法落点。请在当前大步骤末端添加，或先缩短同泳道时间块。'};
}
export function insertBlock(doc,block,target) {
  const parallel=clone(doc); parallel.blocks.push({...block,start:target});
  if(endpoints(doc).some(t=>t===target||t===target+block.duration)&&!validate(parallel))return {...result(parallel,doc),start:target};
  if(!endpoints(doc).includes(target)) return {error:'请吸附到已有时间块的端点'};
  const d=clone(doc);for(const b of d.blocks)if(b.start>=target)b.start+=block.duration;
  d.blocks.push({...block,start:target});return result(d,doc);
}
export function moveBlock(doc,id,group,target) {
  const block=doc.blocks.find(b=>b.id===id);if(!block)return {error:'找不到时间块'};
  if(group===block.group&&target===block.start)return {doc:clone(doc)};
  const removed=deleteBlock(doc,id);if(removed.error)return removed;
  let adjusted=target,covered=0;
  for(const b of doc.blocks.filter(b=>b.id!==id).sort((a,b)=>a.start-b.start)){if(b.start>covered)adjusted-=Math.max(0,Math.min(target,b.start)-covered);covered=Math.max(covered,end(b));}
  const nodes=endpoints(removed.doc).flatMap(t=>[t,t-block.duration]).filter(t=>t>=0), snapped=nodes.reduce((a,b)=>Math.abs(b-adjusted)<Math.abs(a-adjusted)?b:a,0);
  const next=insertBlock(removed.doc,{...block,group},snapped);return next.error?next:result(next.doc,doc);
}
export function reorderGroup(doc,id,beforeId) {
  const d=clone(doc), group=d.groups.find(g=>g.id===id);if(!group||id===beforeId)return {doc:d};
  d.groups=d.groups.filter(g=>g.id!==id);const index=d.groups.findIndex(g=>g.id===beforeId);d.groups.splice(index<0?d.groups.length:index,0,group);
  let cursor=0;for(const g of d.groups) {const blocks=d.blocks.filter(b=>b.group===g.id);if(!blocks.length)continue;const start=Math.min(...blocks.map(b=>b.start)),finish=Math.max(...blocks.map(end));for(const b of blocks)b.start+=cursor-start;cursor+=finish-start;}
  return result(d,doc);
}
export function importDocument(text) {
  if(text.length>5000000)throw new Error('文件不能超过 5 MB');
  const doc=JSON.parse(text);const error=validate(doc);if(error)throw new Error(error);
  if(!['name','author','date','revision'].every(k=>typeof doc[k]==='string'&&doc[k].length<1000))throw new Error('实验信息无效');
  // Migration entry point: future versions must migrate before validation.
  const layout={...defaults};
  for(const [key,min,max] of [['operationWidth',72,180],['waitWidth',72,180],['laneGap',0,24],['environmentWidth',80,150],['fontSize',12,22],['spacing',8,36]]) {
    const value=doc.layout?.[key];if(Number.isFinite(value))layout[key]=Math.max(min,Math.min(max,value));
  }
  if(['blue','sage','lavender'].includes(doc.layout?.theme))layout.theme=doc.layout.theme;
  if(doc.layout?.orientation==='landscape')layout.orientation='landscape';
  doc.environmentTerms=doc.environmentTerms?[...new Set(doc.environmentTerms.map(term=>term.trim()))]:[...defaultEnvironmentTerms];
  doc.environmentRanges=getEnvironmentRanges(doc);
  doc.layout=layout;const migratedError=validate(doc);if(migratedError)throw new Error(migratedError);return doc;
}
export function environmentRuns(blocks) {
  const runs=[];
  for(const b of [...blocks].filter(b=>b.environment).sort((a,b)=>a.start-b.start)) {
    const last=[...runs].reverse().find(r=>r.object===b.object&&r.environment===b.environment&&r.end===b.start);
    if(last){last.end=end(b);last.ids.push(b.id);}else runs.push({start:b.start,end:end(b),environment:b.environment,object:b.object,ids:[b.id]});
  }return runs;
}
export function primaryObject(doc) { return doc.blocks.find(b=>b.lane==='wait')?.object||doc.blocks[0]?.object||'样本'; }
function environmentAnchor(doc,group,time,edge,opposite){
  const blocks=doc.blocks.filter(b=>b.group===group).sort((a,b)=>b.duration-a.duration);
  const exact=blocks.find(b=>edge==='start'?b.start===time&&end(b)===opposite:end(b)===time&&b.start===opposite);if(exact)return {blockId:exact.id,edge};
  for(const kind of [edge,edge==='start'?'end':'start']){const b=blocks.find(b=>(kind==='start'?b.start:end(b))===time);if(b)return {blockId:b.id,edge:kind};}
}
function legacyEnvironmentRanges(doc){
  const runs=environmentRuns(doc.blocks.filter(b=>b.object===primaryObject(doc))),ranges=[];
  for(const [gi,g]of doc.groups.entries()){
    const blocks=doc.blocks.filter(b=>b.group===g.id);if(!blocks.length)continue;
    const first=Math.min(...blocks.map(b=>b.start)),last=Math.max(...blocks.map(end));
    for(const [ri,r]of runs.entries()){const start=Math.max(first,r.start),finish=Math.min(last,r.end);if(start<finish)ranges.push({id:`environment-${gi}-${ri}`,group:g.id,start,end:finish,environment:r.environment,startAnchor:environmentAnchor(doc,g.id,start,'start'),endAnchor:environmentAnchor(doc,g.id,finish,'end')});}
  }
  // Legacy parallel blocks could paint overlapping arrows. Keep their visible
  // order while migrating to a single, unambiguous environment column.
  const ordered=[];for(const r of ranges.sort((a,b)=>a.start-b.start||b.end-a.end)){const previous=ordered.at(-1);if(previous?.group===r.group&&r.start<previous.end)r.start=previous.end;if(r.start<r.end){r.startAnchor=environmentAnchor(doc,r.group,r.start,'start');ordered.push(r);}}return ordered;
}
export function getEnvironmentRanges(doc){return doc.environmentRanges??legacyEnvironmentRanges(doc);}
// Called only by time-model mutations. An environment edit never enters this
// path and cannot move blocks, text, groups, notes, or layout coordinates.
function syncEnvironmentRanges(before,after){
  const mapped=[];
  for(const original of getEnvironmentRanges(before)){
    const r=clone(original),oldBlocks=before.blocks.filter(b=>b.group===r.group),oldStart=Math.min(...oldBlocks.map(b=>b.start));
    const sa=r.startAnchor||environmentAnchor(before,r.group,r.start,'start'),ea=r.endAnchor||environmentAnchor(before,r.group,r.end,'end');
    const moved=sa?.blockId===ea?.blockId?after.blocks.find(b=>b.id===sa?.blockId):null;if(moved&&moved.group!==r.group)r.group=moved.group;
    const blocks=after.blocks.filter(b=>b.group===r.group);if(!blocks.length)continue;
    if(!oldBlocks.some(b=>b.start<r.end&&end(b)>r.start&&after.blocks.some(n=>n.id===b.id&&n.group===r.group)))continue;
    const nodes=[...new Set(blocks.flatMap(b=>[b.start,end(b)]))].sort((a,b)=>a-b),shift=nodes[0]-oldStart;
    for(const [edge,anchor]of [['start',sa],['end',ea]]){const b=blocks.find(b=>b.id===anchor?.blockId),target=b?(anchor.edge==='start'?b.start:end(b)):r[edge]+shift;r[edge]=nodes.reduce((a,b)=>Math.abs(b-target)<Math.abs(a-target)?b:a,nodes[0]);}
    if(r.start<r.end)mapped.push(r);
  }
  after.environmentRanges=[];
  for(const g of after.groups)for(const r of mapped.filter(r=>r.group===g.id).sort((a,b)=>a.start-b.start)){
    const previous=after.environmentRanges.at(-1);if(previous?.group===r.group)r.start=Math.max(r.start,previous.end);
    if(r.start>=r.end)continue;r.startAnchor=environmentAnchor(after,r.group,r.start,'start',r.end);r.endAnchor=environmentAnchor(after,r.group,r.end,'end',r.start);after.environmentRanges.push(r);
  }
}
export function setEnvironmentRange(doc,range){
  const d=clone(doc),id=range.id||uid(),ranges=[];
  for(const r of getEnvironmentRanges(doc)){
    if(r.id===id)continue;
    if(r.group!==range.group||r.end<=range.start||r.start>=range.end){ranges.push(clone(r));continue;}
    if(r.start<range.start)ranges.push({...clone(r),end:range.start,endAnchor:environmentAnchor(doc,r.group,range.start,'end')});
    if(r.end>range.end)ranges.push({...clone(r),id:r.start<range.start?uid():r.id,start:range.end,startAnchor:environmentAnchor(doc,r.group,range.end,'start')});
  }
  ranges.push({...range,id,startAnchor:environmentAnchor(doc,range.group,range.start,'start',range.end),endAnchor:environmentAnchor(doc,range.group,range.end,'end',range.start)});d.environmentRanges=ranges.sort((a,b)=>doc.groups.findIndex(g=>g.id===a.group)-doc.groups.findIndex(g=>g.id===b.group)||a.start-b.start);return result(d);
}
export function resizeEnvironmentRange(doc,id,edge,target){
  const r=getEnvironmentRanges(doc).find(r=>r.id===id);if(!r||!['start','end'].includes(edge))return {error:'找不到环境范围'};
  const others=getEnvironmentRanges(doc).filter(other=>other.group===r.group&&other.id!==id),previous=Math.max(0,...others.filter(o=>o.end<=r.start).map(o=>o.end)),next=Math.min(Infinity,...others.filter(o=>o.start>=r.end).map(o=>o.start));
  const nodes=[...new Set(doc.blocks.filter(b=>b.group===r.group).flatMap(b=>[b.start,end(b)]))].filter(t=>edge==='start'?t>=previous&&t<r.end:t>r.start&&t<=next);
  const value=nodes.reduce((a,b)=>Math.abs(b-target)<Math.abs(a-target)?b:a,r[edge]),d=clone(doc);d.environmentRanges=clone(getEnvironmentRanges(doc));
  const edited=d.environmentRanges.find(r=>r.id===id);edited[edge]=value;edited.startAnchor=environmentAnchor(doc,r.group,edited.start,'start',edited.end);edited.endAnchor=environmentAnchor(doc,r.group,edited.end,'end',edited.start);return {...result(d),limited:value!==target};
}
export function removeEnvironmentRange(doc,id){const d=clone(doc);d.environmentRanges=clone(getEnvironmentRanges(doc).filter(r=>r.id!==id));return result(d);}
export function plainText(html) { return String(html).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/div>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'); }
export function groupLayout(doc,groupId) {
  const blocks=doc.blocks.filter(b=>b.group===groupId), nodes=[...new Set(blocks.flatMap(b=>[b.start,end(b)]))].sort((a,b)=>a-b);
  // Empty containers still occupy a real insertion boundary in group order.
  if(!nodes.length){const preceding=new Set(doc.groups.slice(0,doc.groups.findIndex(g=>g.id===groupId)).map(g=>g.id));nodes.push(Math.max(0,...doc.blocks.filter(b=>preceding.has(b.group)).map(end)));}
  const textWidth=Math.max(180,800-doc.layout.operationWidth-doc.layout.waitWidth-doc.layout.environmentWidth-doc.layout.laneGap*2);
  const positions=new Map();let y=0;
  for(let i=0;i<nodes.length;i++) {
    positions.set(nodes[i],y);if(i===nodes.length-1)break;
    const starts=blocks.filter(b=>b.start===nodes[i]);
    const textHeight=starts.reduce((sum,b)=>sum+Math.max(44,(plainText(b.text).split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/(textWidth/doc.layout.fontSize))),0))*doc.layout.fontSize*1.65+24),0);
    y+=Math.max(58+doc.layout.spacing,Math.min(126,48+Math.log2((nodes[i+1]-nodes[i])/60+1)*12),textHeight);
  }
  const toY=t=>{if(!nodes.length)return 0;if(positions.has(t))return positions.get(t);for(let i=1;i<nodes.length;i++)if(t<nodes[i])return positions.get(nodes[i-1])+(t-nodes[i-1])/(nodes[i]-nodes[i-1])*(positions.get(nodes[i])-positions.get(nodes[i-1]));return y;};
  const toTime=pos=>{for(let i=1;i<nodes.length;i++)if(pos<=positions.get(nodes[i]))return nodes[i-1]+(pos-positions.get(nodes[i-1]))/(positions.get(nodes[i])-positions.get(nodes[i-1]))*(nodes[i]-nodes[i-1]);return nodes.at(-1)||0;};
  return {blocks,nodes,height:Math.max(y,84),toY,toTime,positions};
}
