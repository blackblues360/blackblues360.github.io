import {parseRowLabels} from './core.mjs?v=3';

export function labelLayout(width,edit,measure) {
  if(!edit.lanes?.length||!edit.labels||edit.lanes.length!==edit.labels.length)return {height:0,items:[]};
  const lanes=edit.lanes,n=lanes.length;
  const slot=i=>{const center=lanes[i].center*width,left=i?((lanes[i-1].center*width+center)/2):0,right=i===n-1?width:(lanes[i+1].center*width+center)/2;return Math.max(1,2*Math.min(center-left,right-center)-3);};
  let font=Math.max(18,Math.min(40,width/40));
  const short=edit.labels.map((s,i)=>({s,i})).filter(x=>x.s.length<=3);
  if(short.length){const space=Math.min(...short.map(x=>slot(x.i))),text=Math.max(...short.map(x=>measure(x.s,font)));font=Math.max(18,Math.min(font,font*space/Math.max(1,text)));}
  const items=edit.labels.map((text,i)=>({text,x:lanes[i].center*width,width:measure(text,font),font,vertical:measure(text,font)>slot(i)}));
  return {height:Math.ceil(Math.max(...items.map(t=>t.vertical?t.width:t.font*1.25))+font),items};
}
export function drawLabels(context,width,layout) {
  if(!layout.height)return;
  context.save();context.fillStyle='#fff';context.fillRect(0,0,width,layout.height);context.fillStyle='#111';context.textBaseline='alphabetic';
  for(const t of layout.items){context.font=`bold ${t.font}px "Segoe UI","Microsoft YaHei",sans-serif`;context.save();if(t.vertical){context.translate(t.x-t.font*.2,t.font/2+t.width);context.rotate(-Math.PI/2);context.fillText(t.text,0,0);}else context.fillText(t.text,t.x-t.width/2,layout.height-t.font/2-t.font*.2);context.restore();}context.restore();
}
export function annotationLayout(width,height,edit,measure) {
  const top=labelLayout(width,edit,measure),names=edit.rows?.length?parseRowLabels(edit.rowLeft,edit.rowRight):[],rows=edit.rows||[];
  if(names.length!==rows.length)throw Error('横向信息与定位线数量不一致，请重新定位或修正文字。');
  let font=Math.max(18,Math.min(40,width/40));
  for(let i=1;i<rows.length;i++)font=Math.min(font,Math.max(8,(rows[i].center-rows[i-1].center)*height*.75));
  const pad=Math.ceil(font*.6),left=names.some(r=>r.left)?Math.ceil(Math.max(...names.map(r=>measure(r.left,font)))+2*pad):0,right=names.some(r=>r.right)?Math.ceil(Math.max(...names.map(r=>measure(r.right,font)))+2*pad):0;
  const imageTop=Math.max(top.height,rows.length?Math.ceil(font*.7-rows[0].center*height):0),bottom=rows.length?Math.max(0,Math.ceil(font*.7-(1-rows.at(-1).center)*height)):0;
  const layout={width:width+left+right,height:height+imageTop+bottom,left,right,top:imageTop,bottom,topLabels:top,imageWidth:width,imageHeight:height,sideItems:names.flatMap((r,i)=>['left','right'].filter(side=>r[side]).map(side=>({text:r[side],side,font,x:side==='left'?left-pad:left+width+pad,y:imageTop+rows[i].center*height})))};
  if(layout.width*layout.height>24_000_000)throw Error('图片加上标注后超过 2400 万像素，请缩小图片或减少文字。');
  return layout;
}
export function drawAnnotations(context,layout) {
  context.save();context.fillStyle='#fff';
  context.fillRect(0,0,layout.width,layout.top);context.fillRect(0,layout.top,layout.left,layout.imageHeight);context.fillRect(layout.left+layout.imageWidth,layout.top,layout.right,layout.imageHeight);
  context.fillRect(0,layout.top+layout.imageHeight,layout.width,layout.bottom);
  context.save();context.translate(layout.left,0);drawLabels(context,layout.imageWidth,layout.topLabels);context.restore();
  context.fillStyle='#111';context.textBaseline='middle';
  for(const t of layout.sideItems){context.font=`bold ${t.font}px "Segoe UI","Microsoft YaHei",sans-serif`;context.textAlign=t.side==='left'?'right':'left';context.fillText(t.text,t.x,t.y);}
  context.restore();
}
export function makeCanvas(frame,edit) {
  const canvas=document.createElement('canvas'),measure=document.createElement('canvas').getContext('2d'),layout=annotationLayout(frame.width,frame.height,edit,(text,size)=>{measure.font=`bold ${size}px "Segoe UI","Microsoft YaHei",sans-serif`;return measure.measureText(text).width;});
  canvas.width=layout.width;canvas.height=layout.height;const ctx=canvas.getContext('2d');ctx.putImageData(new ImageData(frame.pixels,frame.width,frame.height),layout.left,layout.top);drawAnnotations(ctx,layout);return {canvas,layout};
}
export function canvasBlob(canvas,type='image/png'){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('浏览器无法导出图片，请减小尺寸后重试。')),type));}
export function download(blob,name) {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export function printFrame(target,frame,edit) {
  const {canvas}=makeCanvas(frame,{...edit,lanes:null,labels:null,rows:null}),measure=document.createElement('canvas').getContext('2d'),layout=annotationLayout(frame.width,frame.height,edit,(text,size)=>{measure.font=`bold ${size}px "Segoe UI","Microsoft YaHei",sans-serif`;return measure.measureText(text).width;}),labels=layout.topLabels;
  const doc=target.document,ns='http://www.w3.org/2000/svg';doc.title='胶图 · BLACK BLUES';doc.body.replaceChildren();const style=doc.createElement('style');style.textContent='@page{margin:12mm}body{margin:24px;font-family:Arial,sans-serif;color:#344f3d}nav{display:flex;align-items:center;gap:20px;margin-bottom:24px;font-size:12px}button{padding:9px 18px;cursor:pointer}svg{width:100%;height:auto;max-height:88vh}@media print{body{margin:0}nav{display:none}svg{max-height:260mm}}';doc.head.append(style);
  const nav=doc.createElement('nav'),button=doc.createElement('button'),note=doc.createElement('span');button.textContent='打印 / 另存为 PDF';button.onclick=()=>target.print();note.textContent='请在打印目标中选择“另存为 PDF”，并关闭页眉页脚。';nav.append(button,note);doc.body.append(nav);
  const svg=doc.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${layout.width} ${layout.height}`);svg.setAttribute('xmlns',ns);svg.style.background='white';const image=doc.createElementNS(ns,'image');image.setAttribute('href',canvas.toDataURL('image/png'));image.setAttribute('x',String(layout.left));image.setAttribute('y',String(layout.top));image.setAttribute('width',String(frame.width));image.setAttribute('height',String(frame.height));svg.append(image);
  for(const t of labels.items){const text=doc.createElementNS(ns,'text');text.textContent=t.text;text.setAttribute('font-family','Segoe UI, Microsoft YaHei, sans-serif');text.setAttribute('font-size',String(t.font));text.setAttribute('font-weight','bold');if(t.vertical){text.setAttribute('transform',`translate(${layout.left+t.x-t.font*.2} ${t.font/2+t.width}) rotate(-90)`);}else{text.setAttribute('x',String(layout.left+t.x-t.width/2));text.setAttribute('y',String(labels.height-t.font*.7));}svg.append(text);}
  for(const t of layout.sideItems){const text=doc.createElementNS(ns,'text');text.textContent=t.text;text.setAttribute('x',String(t.x));text.setAttribute('y',String(t.y));text.setAttribute('dominant-baseline','central');text.setAttribute('text-anchor',t.side==='left'?'end':'start');text.setAttribute('font-family','Segoe UI, Microsoft YaHei, sans-serif');text.setAttribute('font-size',String(t.font));text.setAttribute('font-weight','bold');svg.append(text);}doc.body.append(svg);return layout;
}
