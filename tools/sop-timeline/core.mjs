// Real time is integer seconds. Rendering coordinates never enter these operations.
export const VERSION = 1;
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
  return { version: VERSION, name: '未命名实验 SOP', author: '', date: new Date().toLocaleDateString('sv-SE'), revision: 'v1.0', groups: [{id:uid(),title:'实验准备',collapsed:false}], blocks: [], notes: [], layout: {...defaults} };
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
  d.notes=[{id:uid(),group:d.groups[0].id,text:'可根据细胞类型调整离心条件。'}]; return d;
}
export function endpoints(doc) { return [...new Set([0,...doc.blocks.flatMap(b=>[b.start,end(b)])])].sort((a,b)=>a-b); }
function result(doc) { const error=validate(doc); return error ? {error} : {doc}; }
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
  const at=change=>{const d=clone(doc);for(const b of d.blocks) {if(b.id===id)b.duration+=change;else if(moved.has(b.id))b.start+=change;}return d;};
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
export function deleteBlock(doc,id) { const d=clone(doc);d.blocks=d.blocks.filter(b=>b.id!==id);return result(closeGaps(d)); }
export function addBlock(doc,block,target=total(doc)) {
  const candidates=endpoints(doc).flatMap(t=>[t,t-block.duration]).filter(t=>t>=0);
  const ordered=[...new Set(candidates)].sort((a,b)=>Math.abs(a-target)-Math.abs(b-target)||a-b);
  for(const start of ordered) {const d=clone(doc);d.blocks.push({...block,start});if(!validate(d))return {doc:d,start};}
  return {error:'没有合法落点。请在当前大步骤末端添加，或先缩短同泳道时间块。'};
}
export function insertBlock(doc,block,target) {
  const parallel=clone(doc); parallel.blocks.push({...block,start:target});
  if(endpoints(doc).some(t=>t===target||t===target+block.duration)&&!validate(parallel))return {doc:parallel,start:target};
  if(!endpoints(doc).includes(target)) return {error:'请吸附到已有时间块的端点'};
  const d=clone(doc);for(const b of d.blocks)if(b.start>=target)b.start+=block.duration;
  d.blocks.push({...block,start:target});return result(d);
}
export function moveBlock(doc,id,group,target) {
  const block=doc.blocks.find(b=>b.id===id);if(!block)return {error:'找不到时间块'};
  if(group===block.group&&target===block.start)return {doc:clone(doc)};
  const removed=deleteBlock(doc,id);if(removed.error)return removed;
  let adjusted=target,covered=0;
  for(const b of doc.blocks.filter(b=>b.id!==id).sort((a,b)=>a.start-b.start)){if(b.start>covered)adjusted-=Math.max(0,Math.min(target,b.start)-covered);covered=Math.max(covered,end(b));}
  const nodes=endpoints(removed.doc).flatMap(t=>[t,t-block.duration]).filter(t=>t>=0), snapped=nodes.reduce((a,b)=>Math.abs(b-adjusted)<Math.abs(a-adjusted)?b:a,0);
  return insertBlock(removed.doc,{...block,group},snapped);
}
export function reorderGroup(doc,id,beforeId) {
  const d=clone(doc), group=d.groups.find(g=>g.id===id);if(!group||id===beforeId)return {doc:d};
  d.groups=d.groups.filter(g=>g.id!==id);const index=d.groups.findIndex(g=>g.id===beforeId);d.groups.splice(index<0?d.groups.length:index,0,group);
  let cursor=0;for(const g of d.groups) {const blocks=d.blocks.filter(b=>b.group===g.id);if(!blocks.length)continue;const start=Math.min(...blocks.map(b=>b.start)),finish=Math.max(...blocks.map(end));for(const b of blocks)b.start+=cursor-start;cursor+=finish-start;}
  return result(d);
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
  doc.layout=layout;return doc;
}
export function environmentRuns(blocks) {
  const runs=[];
  for(const b of [...blocks].filter(b=>b.environment).sort((a,b)=>a.start-b.start)) {
    const last=[...runs].reverse().find(r=>r.object===b.object&&r.environment===b.environment&&r.end===b.start);
    if(last){last.end=end(b);last.ids.push(b.id);}else runs.push({start:b.start,end:end(b),environment:b.environment,object:b.object,ids:[b.id]});
  }return runs;
}
export function primaryObject(doc) { return doc.blocks.find(b=>b.lane==='wait')?.object||doc.blocks[0]?.object||'样本'; }
export function plainText(html) { return String(html).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/div>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'); }
export function groupLayout(doc,groupId) {
  const blocks=doc.blocks.filter(b=>b.group===groupId), nodes=[...new Set(blocks.flatMap(b=>[b.start,end(b)]))].sort((a,b)=>a-b);
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
