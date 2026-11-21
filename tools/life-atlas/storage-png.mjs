import {collectStorageInventory} from './storage-export.mjs?v=20261121.3';

export async function storageGridPNG(db,options={}){
  if(options.scope&&options.scope!=='box')throw Error('PNG 仅支持当前盒；全部盒请使用 PDF 或 CSV');
  const {workspace='我的研究空间',generatedAt=new Date().toISOString(),includeCodes=true,includeDates=false,includeNotes=false}=options;
  const {box,cells,occupied,empty}=collectStorageInventory(db,{...options,scope:'box'})[0];
  await document.fonts.ready;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  if(!ctx)throw Error('当前浏览器无法生成图片，请使用 PDF');
  const width=Math.max(720,box.columns*148+100),cellWidth=(width-100)/box.columns;
  ctx.font='16px "Microsoft YaHei",Arial,sans-serif';
  const wrap=(text,maxWidth)=>{
    const lines=[];let line='';
    for(const char of String(text??'')){
      if(char==='\n'){lines.push(line);line='';continue;}
      if(line&&ctx.measureText(line+char).width>maxWidth){lines.push(line);line='';}
      line+=char;
    }
    lines.push(line);return lines;
  };
  const cellLines=cells.map(c=>[c.coordinate,...(c.entity?[c.name,...(includeCodes?[c.code]:[]),[c.state,c.passage].filter(Boolean).join(' · '),...(includeDates?['冻存日期',c.frozenDate,'当前位置存入',...c.storedAt.split('T')]:[]),...(includeNotes&&c.notes?['备注：'+c.notes]:[])]:['空位'])].flatMap(text=>wrap(text,cellWidth-16)));
  const meta=[`Life Atlas · ${box.kind==='cell'?'细胞冻存盒':'样品盒'}格位布局`,box.name,box.path,`${workspace} · ${new Date(generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（Asia/Shanghai）`,`${box.rows} × ${box.columns} · 已占用 ${occupied} · 空位 ${empty} · 修订 ${db.revision}`,`当前占用快照 · ${includeCodes?'含编号':'不含编号'} · ${includeDates?'含冻存 / 存入日期':'不含日期明细'} · ${includeNotes?'含备注':'不含备注'}`].flatMap(text=>wrap(text,width-64));
  const headerHeight=meta.length*26+40,rowHeights=Array.from({length:box.rows},(_,r)=>Math.max(80,...cellLines.slice(r*box.columns,(r+1)*box.columns).map(lines=>lines.length*23+18)));
  const height=headerHeight+36+rowHeights.reduce((a,b)=>a+b,0)+36;
  if(height>16000||width*height>32000000)throw Error('图片内容过长，请关闭备注或改用 PDF 导出');
  canvas.width=width;canvas.height=height;ctx.font='16px "Microsoft YaHei",Arial,sans-serif';ctx.textBaseline='top';
  ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
  meta.forEach((line,i)=>{ctx.fillStyle=i<2?'#4938b8':'#566078';ctx.fillText(line,32,20+i*26);});
  for(let c=0;c<box.columns;c++){ctx.fillStyle='#566078';ctx.fillText(String(c+1),64+c*cellWidth,headerHeight);}
  let y=headerHeight+30;
  for(let r=0;r<box.rows;r++){
    ctx.fillStyle='#566078';ctx.fillText(String.fromCharCode(65+r),24,y+10);
    for(let c=0;c<box.columns;c++){
      const index=r*box.columns+c,x=60+c*cellWidth;
      ctx.fillStyle=cells[index].entity?'#eeebff':'#fafbfe';ctx.fillRect(x,y,cellWidth,rowHeights[r]);ctx.strokeStyle='#cbd0e2';ctx.strokeRect(x+.5,y+.5,cellWidth-1,rowHeights[r]-1);
      cellLines[index].forEach((line,i)=>{ctx.fillStyle=i===0?'#6451ce':'#252a3d';ctx.fillText(line,x+8,y+9+i*23);});
    }
    y+=rowHeights[r];
  }
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('图片生成失败，请使用 PDF')),'image/png'));
}
