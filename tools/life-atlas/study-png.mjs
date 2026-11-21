import {collectStudyReport} from './study-export.mjs?v=20261121.6';

export function collectStudyImage(db,options={}){
  const {includeHistory=true,includeNotes=false,generatedAt=new Date().toISOString()}=options,report=collectStudyReport(db,{...options,generatedAt});
  const entity=id=>report.entities.find(e=>e.id===id),cohort=id=>report.cohorts.find(c=>c.id===id)?.name||id;
  const stamp=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未离组';
  const rows=[{title:'分组概览',lines:report.cohorts.map(c=>{
    const history=report.memberships.filter(m=>m.cohortId===c.id),current=report.currentMemberships.filter(m=>m.cohortId===c.id);
    return `${c.name} · 曾入组 ${new Set(history.map(m=>m.entityId)).size} 只 · 当前有效 ${current.length} 只 · 其中在管 ${current.filter(m=>entity(m.entityId)?.status==='active').length} 只 · 体重 ${report.measurements['体重测量'].filter(p=>p.cohortId===c.id).length} 条 · 肿瘤 ${report.measurements['肿瘤测量'].filter(p=>p.cohortId===c.id).length} 条`;
  })},{title:'当前有效成员（档案为当前快照）',lines:report.currentMemberships.map(m=>{
    const e=entity(m.entityId),state={active:'进行中',stored:'保存中',ended:'已结束'};
    return `${e.name} · ${e.code} · ${cohort(m.cohortId)} · ${state[e.status]||e.status} · 笼位：${e.location||'未分配'}`;
  })}];
  if(includeHistory)rows.push({title:'成员有效期与转组历史',lines:report.memberships.map(m=>{
    const e=entity(m.entityId);
    return `${e.name} · ${e.code} · ${cohort(m.cohortId)} · ${m.id} · ${stamp(m.joinedAt)} 至 ${stamp(m.leftAt)}${includeNotes?' · 原因：'+[m.reason,m.exitReason].filter(Boolean).join('；'):''}`;
  })});
  return {study:{name:report.study.name},cohortCount:report.cohorts.length,historicalCount:report.entities.length,currentCount:new Set(report.currentMemberships.map(m=>m.entityId)).size,eventCount:report.events.length,description:includeNotes?report.study.description||'':'',rows};
}

export async function studyOverviewPNG(db,options={}){
  const {workspace='我的研究空间',generatedAt=new Date().toISOString()}=options,data=collectStudyImage(db,{...options,generatedAt});
  await document.fonts.ready;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)throw Error('当前浏览器无法生成图片，请使用 PDF');
  const width=1440,font='20px "Microsoft YaHei",Arial,sans-serif';ctx.font=font;
  const wrap=text=>{const lines=[];let line='';for(const char of String(text)){if(char==='\n'){lines.push(line);line='';continue;}if(line&&ctx.measureText(line+char).width>width-128){lines.push(line);line='';}line+=char;}lines.push(line);return lines;};
  const blocks=[{title:'Life Atlas · 实验项目概览',lines:[data.study.name,`${workspace} · ${new Date(generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（Asia/Shanghai） · 修订 ${db.revision}`,`${options.cohortId?'所选历史分组':'项目全部分组'} · ${data.cohortCount} 个分组 · 曾入组 ${data.historicalCount} 只 · 当前有效 ${data.currentCount} 只 · 实际事件及追加修正 ${data.eventCount} 条`,...(data.description?[data.description]:[])]},...data.rows,{title:'统计口径',lines:['当前有效成员不等同于仍在管个体；历史分组曾入组人数不可相加作为项目去重人数。','事件和测量按发生时的成员有效期归组；明确关联其他项目的原事件不纳入，追加修正随原事件保留。','测量条数仅包含有效数值及单位的原始记录，不重算修正值、不计算组均值；计划不计为实际事件。','本图为概览，不包含事件明细及测量曲线；完整明细请使用项目 PDF，曲线请使用测量 PNG。']}].map(b=>({...b,lines:(b.lines.length?b.lines:['暂无记录']).flatMap(wrap),titles:wrap(b.title)}));
  const height=48+blocks.reduce((h,b)=>h+(b.titles.length+b.lines.length)*30+48,0);
  if(height>16000||width*height>32000000)throw Error('项目图片过大，请缩小分组范围、隐藏历史或备注，或使用 PDF');
  canvas.width=width;canvas.height=height;ctx.font=font;ctx.textBaseline='top';ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);let y=32;
  for(const block of blocks){ctx.fillStyle='#4938b8';for(const line of block.titles){ctx.fillText(line,48,y);y+=30;}y+=10;ctx.fillStyle='#252a3d';for(const line of block.lines){ctx.fillText(line,64,y);y+=30;}y+=38;}
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('图片生成失败，请使用 PDF')),'image/png'));
}
