import {collectEntityReport,reportScopes} from './reports.mjs?v=20261121.6';
import {types,age,lifecycle,isCellReference} from './core.mjs?v=20261121.6';

export function collectLineageImage(db,entityId,{scope='lineage'}={}){
  const report=collectEntityReport(db,entityId,{scope}),ids=new Set(report.entities.map(e=>e.id));
  const indegree=new Map(report.entities.map(e=>[e.id,0])),levels=new Map(report.entities.map(e=>[e.id,0]));
  for(const r of report.relations)indegree.set(r.childId,indegree.get(r.childId)+1);
  const queue=report.entities.filter(e=>indegree.get(e.id)===0).map(e=>e.id),ordered=[];
  for(let i=0;i<queue.length;i++){
    const id=queue[i];ordered.push(id);
    for(const r of report.relations.filter(r=>r.parentId===id)){levels.set(r.childId,Math.max(levels.get(r.childId),levels.get(id)+1));indegree.set(r.childId,indegree.get(r.childId)-1);if(!indegree.get(r.childId))queue.push(r.childId);}
  }
  if(ordered.length!==report.entities.length)throw Error('谱系存在环，无法生成图片，请先核对数据');
  return {root:report.entities[0],scope,nodes:ordered.map((id,i)=>({entity:report.entities.find(e=>e.id===id),key:'N'+(i+1),level:levels.get(id),boundary:db.relations.filter(r=>r.parentId===id&&!ids.has(r.childId)||r.childId===id&&!ids.has(r.parentId)).length})),edges:report.relations.map((r,i)=>({...r,key:'R'+(i+1),event:db.events.find(e=>e.id===r.eventId)}))};
}

export async function lineagePNG(db,entityId,options={}){
  const {includeCodes=true,includeAge=true,includeDates=false,includeNotes=false,workspace='我的研究空间',generatedAt=new Date().toISOString()}=options,graph=collectLineageImage(db,entityId,options);
  await document.fonts.ready;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)throw Error('当前浏览器无法生成图片，请使用 PDF');
  const font='20px "Microsoft YaHei",Arial,sans-serif';ctx.font=font;
  const wrap=(text,max)=>{const lines=[];let line='';for(const char of String(text??'')){if(char==='\n'){lines.push(line);line='';continue;}if(line&&ctx.measureText(line+char).width>max){lines.push(line);line='';}line+=char;}lines.push(line);return lines;};
  const stamp=(value,missing='未知')=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):missing;
  const levels=Math.max(...graph.nodes.map(n=>n.level))+1,width=Math.max(1000,levels*430+70);
  if(width>16000)throw Error('谱系层级过多，请缩小范围或使用 PDF');
  const header=['Life Atlas · 实体上下游谱系',graph.root.name+' · '+reportScopes[graph.scope],`${workspace} · ${stamp(generatedAt)}（Asia/Shanghai） · 修订 ${db.revision}`,`${graph.nodes.length} 个实体 · ${graph.edges.length} 条范围内来源关系；横向表示来源层级，不表示时间比例。`,'仅绘制所选实体的指定方向，不扩展兄弟分支或后代的其他来源。共享输入参与不作为谱系边。'].flatMap(t=>wrap(t,width-96)),headerHeight=header.length*30+55;
  const byId=new Map(graph.nodes.map(n=>[n.entity.id,n])),longEdges=graph.edges.filter(r=>byId.get(r.childId).level-byId.get(r.parentId).level>1),lanes=new Map(longEdges.map((r,i)=>[r.key,headerHeight+i*28]));
  const positions=new Map(),bottoms=Array.from({length:levels},()=>headerHeight+longEdges.length*28+20);
  const cards=graph.nodes.map(n=>{
    const e=n.entity,l=lifecycle(db,e.id),reference=isCellReference(db,e),state=reference?'基础档案':({active:'进行中',stored:'保存中',ended:'已结束'})[e.status]||e.status;
    const lines=[n.key+' · '+e.name+(e.id===entityId?'（当前实体）':''),includeCodes&&e.code,`${types[e.type]} / ${e.subtype}`,state+(includeAge&&!reference?' · '+age(db,e.id,generatedAt):''),...(includeDates?['当前 D0：'+stamp(l?.startAt,'未启动'),'当前结束：'+stamp(l?.endAt,'未结束')]:[]),n.boundary&&'图外相邻关系：'+n.boundary,includeNotes&&e.attributes?.notes&&'档案备注：'+e.attributes.notes].filter(Boolean).flatMap(t=>wrap(t,310));
    const p={x:48+n.level*430,y:bottoms[n.level],height:lines.length*28+24};positions.set(e.id,p);bottoms[n.level]+=p.height+30;return {node:n,lines,...p};
  });
  const graphBottom=Math.max(...bottoms),edgeLines=graph.edges.flatMap(r=>{const from=graph.nodes.find(n=>n.entity.id===r.parentId),to=graph.nodes.find(n=>n.entity.id===r.childId);return wrap(`${r.key} · ${from.key} → ${to.key} · ${r.event?.type||'来源事件未知'}${includeDates?' · '+stamp(r.event?.at):''}${includeCodes&&r.eventId?' · '+r.eventId:''}`,width-96);}),height=graphBottom+70+Math.max(1,edgeLines.length)*30+45;
  if(height>16000||width*height>32000000)throw Error('谱系图片过大，请缩小范围、隐藏备注或使用 PDF');
  canvas.width=width;canvas.height=height;ctx.font=font;ctx.textBaseline='top';ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
  header.forEach((line,i)=>{ctx.fillStyle=i<2?'#4938b8':'#566078';ctx.fillText(line,48,24+i*30);});
  for(const r of graph.edges){const from=positions.get(r.parentId),to=positions.get(r.childId),sx=from.x+340,sy=from.y+30,tx=to.x,ty=to.y+30;ctx.strokeStyle='#9a94bf';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(sx,sy);if(lanes.has(r.key)){const lane=lanes.get(r.key);ctx.lineTo(sx+25,sy);ctx.lineTo(sx+25,lane);ctx.lineTo(tx-25,lane);ctx.lineTo(tx-25,ty);ctx.lineTo(tx,ty);}else ctx.bezierCurveTo(sx+50,sy,tx-50,ty,tx,ty);ctx.stroke();ctx.beginPath();ctx.moveTo(tx-10,ty-5);ctx.lineTo(tx,ty);ctx.lineTo(tx-10,ty+5);ctx.stroke();}
  for(const c of cards){ctx.fillStyle=c.node.entity.id===entityId?'#eeebff':'#f8f9fc';ctx.fillRect(c.x,c.y,340,c.height);ctx.strokeStyle=c.node.entity.id===entityId?'#6451ce':'#cbd0e2';ctx.strokeRect(c.x+.5,c.y+.5,339,c.height-1);c.lines.forEach((line,i)=>{ctx.fillStyle=i===0?'#4938b8':'#252a3d';ctx.fillText(line,c.x+15,c.y+12+i*28);});}
  ctx.fillStyle='#566078';ctx.fillText('关系索引（N 为图内节点，R 为来源关系）',48,graphBottom+5);(edgeLines.length?edgeLines:['当前范围无来源关系']).forEach((line,i)=>ctx.fillText(line,48,graphBottom+40+i*30));
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('图片生成失败，请使用 PDF')),'image/png'));
}
