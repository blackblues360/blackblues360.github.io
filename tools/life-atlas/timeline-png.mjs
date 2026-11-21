import {types,eventAge,age,isCellReference} from './core.mjs?v=20261121.4';

export function collectTimelineImage(db,entityId,{includeCodes=true,includeDates=true,includeAge=true,includeNotes=false,includeBranches=true}={}){
  const entity=db.entities.find(e=>e.id===entityId);if(!entity)throw Error('要导出的实体不存在');
  const events=db.events.filter(e=>e.entityIds.includes(entityId)).slice().sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const rows=events.map(event=>{
    const children=includeBranches?db.relations.filter(r=>r.parentId===entityId&&r.eventId===event.id).map(r=>db.entities.find(e=>e.id===r.childId)):[];
    const role=event.participants?.find(p=>p.entityId===entityId)?.role||'subject';
    return {id:event.id,type:event.type,role,day:includeAge?eventAge(db,entityId,event):'',at:includeDates?event.at:'',note:includeNotes?event.note:'',correction:!!event.correctedFrom,source:includeCodes?event.correctedFrom:'',code:includeCodes?event.id:'',children:children.map(e=>({name:e.name,code:includeCodes?e.code:''}))};
  });
  return {entity,rows};
}

export async function timelinePNG(db,entityId,options={}){
  const {workspace='我的研究空间',generatedAt=new Date().toISOString(),includeCodes=true,includeAge=true}=options,{entity,rows}=collectTimelineImage(db,entityId,options);
  await document.fonts.ready;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)throw Error('当前浏览器无法生成图片，请使用 PDF');
  const width=1400,font='22px "Microsoft YaHei",Arial,sans-serif';ctx.font=font;
  const wrap=(text,max)=>{const lines=[];let line='';for(const char of String(text??'')){if(char==='\n'){lines.push(line);line='';continue;}if(line&&ctx.measureText(line+char).width>max){lines.push(line);line='';}line+=char;}lines.push(line);return lines;};
  const stamp=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  const reference=isCellReference(db,entity);
  const header=['Life Atlas · 单实体事件时间轴',entity.name+(includeCodes?' · '+entity.code:''),`${types[entity.type]} / ${entity.subtype} · 当前状态：${reference?'基础档案':({active:'进行中',stored:'保存中',ended:'已结束'})[entity.status]||entity.status}${includeAge&&!reference?' · 当前 '+age(db,entityId,generatedAt):''}`,`${workspace} · ${stamp(generatedAt)}（Asia/Shanghai） · 修订 ${db.revision}`,`${rows.length} 条参与事件 · 按发生时间排序，间距随文字调整，不表示时间比例；计划不作为实际事件。`].flatMap(text=>wrap(text,width-96));
  const labels=rows.map(r=>[
    r.type+(r.correction?' · 追加修正':'')+(r.day?' · '+r.day:''),
    r.at&&stamp(r.at)+'（Asia/Shanghai）',r.code&&'事件编号：'+r.code,
    '参与角色：'+({subject:'操作对象',input:'输入材料',output:'产出实体'}[r.role]||r.role),
    r.source&&'修正原事件：'+r.source,...r.children.map(e=>'衍生：'+e.name+(e.code?' · '+e.code:'')),r.note&&'备注：'+r.note
  ].filter(Boolean).flatMap(text=>wrap(text,width-190)));
  const headerHeight=header.length*32+50,heights=labels.map(lines=>Math.max(92,lines.length*30+24)),height=headerHeight+heights.reduce((n,h)=>n+h+24,0)+60;
  if(height>16000||width*height>32000000)throw Error('时间轴图片内容过长，请隐藏备注或分支，或改用 PDF');
  canvas.width=width;canvas.height=height;ctx.font=font;ctx.textBaseline='top';ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
  header.forEach((line,i)=>{ctx.fillStyle=i<2?'#4938b8':'#566078';ctx.fillText(line,48,24+i*32);});
  let py=headerHeight;ctx.strokeStyle='#cbd0e2';ctx.lineWidth=3;if(rows.length){ctx.beginPath();ctx.moveTo(78,py+26);ctx.lineTo(78,py+heights.slice(0,-1).reduce((n,h)=>n+h+24,0)+26);ctx.stroke();}
  labels.forEach((lines,i)=>{const row=rows[i];ctx.fillStyle=row.correction?'#fff2dc':'#f2f0ff';ctx.fillRect(115,py,width-163,heights[i]);ctx.fillStyle=row.correction?'#bb6510':'#6451ce';ctx.beginPath();ctx.arc(78,py+26,9,0,Math.PI*2);ctx.fill();lines.forEach((line,j)=>{ctx.fillStyle=j===0?'#4938b8':'#252a3d';ctx.fillText(line,131,py+12+j*30);});py+=heights[i]+24;});
  if(!rows.length){ctx.fillStyle='#566078';ctx.fillText('暂无实际参与事件',48,headerHeight);}
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('图片生成失败，请使用 PDF')),'image/png'));
}
