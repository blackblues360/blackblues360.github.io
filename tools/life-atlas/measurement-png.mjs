import {cohortMeasurements,measurementSeries,measurementTypes} from './measurements.mjs?v=20261121.4';

export function collectMeasurementImage(db,{studyId,cohortId='',eventType='体重测量'}={}){
  const study=(db.studies||[]).find(s=>s.id===studyId);
  if(!study)throw Error('实验项目不存在');
  const cohort=(db.cohorts||[]).find(c=>c.id===cohortId&&c.studyId===studyId);
  if(cohortId&&!cohort)throw Error('分组不属于当前项目');
  if(!Object.hasOwn(measurementTypes,eventType))throw Error('测量类型不受支持');
  const points=cohortMeasurements(db,{studyId,cohortId,eventType});
  if(!points.length)throw Error('当前范围没有可导出的有效测量');
  return {study,cohort,points,series:measurementSeries(points),unit:measurementTypes[eventType],min:Math.min(...points.map(p=>Date.parse(p.at))),max:Math.max(...points.map(p=>Date.parse(p.at)))};
}

export async function measurementChartPNG(db,options={}){
  const {eventType='体重测量',workspace='我的研究空间',includeCodes=true,includeDates=true,generatedAt=new Date().toISOString()}=options;
  const {study,cohort,points,series,unit,min,max}=collectMeasurementImage(db,options);
  await document.fonts.ready;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)throw Error('当前浏览器无法生成图片，请使用项目 PDF');
  const width=1600,font='22px "Microsoft YaHei",Arial,sans-serif';ctx.font=font;
  const wrap=text=>{const lines=[];let line='';for(const char of String(text)){if(char==='\n'){lines.push(line);line='';continue;}if(line&&ctx.measureText(line+char).width>width-120){lines.push(line);line='';}line+=char;}lines.push(line);return lines;};
  const stamp=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  const header=[`Life Atlas · ${eventType}个体曲线`,study.name,cohort?.name||'项目全部历史分组',`${workspace} · ${stamp(generatedAt)}（Asia/Shanghai）`,`${new Set(points.map(p=>p.entityId)).size} 只小鼠 · ${points.length} 条有效测量 · 单位 ${unit} · 修订 ${db.revision}`].flatMap(wrap);
  const legends=series.map((s,i)=>wrap(`测量段 ${i+1} · ${s.name}${includeCodes?' · '+s.code:''} · ${s.cohortName}`));
  const footer=wrap('按测量发生时的成员有效期归属；同一个体跨成员期或生命周期不连线。不补值、不计算均值或误差。* 表示原记录有追加修正，图中仍为原始值；请用事件或报告核对。');
  const top=header.length*32+80,bottom=top+470,legendY=bottom+110,height=legendY+legends.reduce((n,l)=>n+l.length*30+12,0)+footer.length*30+60;
  if(height>16000||width*height>32000000)throw Error('图片内容过长，请缩小分组范围或改用 PDF');
  canvas.width=width;canvas.height=height;ctx.font=font;ctx.textBaseline='top';ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
  header.forEach((line,i)=>{ctx.fillStyle=i<2?'#4938b8':'#566078';ctx.fillText(line,48,24+i*32);});
  const left=120,right=1480,ceiling=Math.max(1,...points.map(p=>p.value))*1.1,x=p=>min===max?(left+right)/2:left+(Date.parse(p.at)-min)/(max-min)*(right-left),y=value=>bottom-value/ceiling*420;
  for(let i=0;i<5;i++){const value=ceiling*i/4,py=y(value);ctx.strokeStyle='#dce0ed';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(right,py);ctx.stroke();ctx.fillStyle='#566078';ctx.textAlign='right';ctx.fillText(String(Number(value.toPrecision(4))),left-16,py-12);}
  ctx.textAlign='left';ctx.fillText(unit,left,top);
  const ids=[...new Set(points.map(p=>p.entityId))],colors=['#6349dc','#087f8c','#bd4e19','#2464b5','#a33677','#497b22'],color=id=>colors[ids.indexOf(id)%colors.length];
  for(const s of series){ctx.strokeStyle=color(s.entityId);ctx.lineWidth=3;if(s.points.length>1){ctx.beginPath();s.points.forEach((p,i)=>i?ctx.lineTo(x(p),y(p.value)):ctx.moveTo(x(p),y(p.value)));ctx.stroke();}for(const p of s.points){ctx.fillStyle=color(s.entityId);ctx.beginPath();ctx.arc(x(p),y(p.value),7,0,Math.PI*2);ctx.fill();if(p.correctionIds.length)ctx.fillText('*',x(p)+10,y(p.value)-20);}}
  ctx.fillStyle='#566078';ctx.fillText(includeDates?stamp(min):'最早测量',left,bottom+26);if(max!==min){ctx.textAlign='right';ctx.fillText(includeDates?stamp(max):'最晚测量',right,bottom+26);}ctx.textAlign='center';ctx.fillText(includeDates?'实际时间 · Asia/Shanghai（UTC+8）':'按实际时间比例排列（隐藏测量日期）',width/2,bottom+66);ctx.textAlign='left';
  let py=legendY;
  legends.forEach((lines,i)=>{ctx.fillStyle=color(series[i].entityId);ctx.fillRect(48,py+7,14,14);ctx.fillStyle='#252a3d';lines.forEach(line=>{ctx.fillText(line,78,py);py+=30;});py+=12;});
  ctx.fillStyle='#566078';footer.forEach(line=>{ctx.fillText(line,48,py+12);py+=30;});
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('图片生成失败，请使用 PDF')),'image/png'));
}
