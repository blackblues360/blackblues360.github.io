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
export function makeCanvas(frame,edit) {
  const canvas=document.createElement('canvas'),measure=document.createElement('canvas').getContext('2d'),layout=labelLayout(frame.width,edit,(text,size)=>{measure.font=`bold ${size}px "Segoe UI","Microsoft YaHei",sans-serif`;return measure.measureText(text).width;});
  if(frame.width*(frame.height+layout.height)>24_000_000)throw Error('图片加上标签后超过 2400 万像素，请先缩小裁剪区域。');
  canvas.width=frame.width;canvas.height=frame.height+layout.height;const ctx=canvas.getContext('2d');ctx.putImageData(new ImageData(frame.pixels,frame.width,frame.height),0,layout.height);drawLabels(ctx,frame.width,layout);return {canvas,layout};
}
export function canvasBlob(canvas,type='image/png'){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('浏览器无法导出图片，请减小尺寸后重试。')),type));}
export function download(blob,name) {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export function printFrame(target,frame,edit) {
  const {canvas,layout}=makeCanvas(frame,{...edit,lanes:null,labels:null}),measure=document.createElement('canvas').getContext('2d'),labels=labelLayout(frame.width,edit,(text,size)=>{measure.font=`bold ${size}px "Segoe UI","Microsoft YaHei",sans-serif`;return measure.measureText(text).width;});
  const doc=target.document,ns='http://www.w3.org/2000/svg';doc.title='胶图 · BLACK BLUES';doc.body.replaceChildren();const style=doc.createElement('style');style.textContent='@page{margin:12mm}body{margin:24px;font-family:Arial,sans-serif;color:#344f3d}nav{display:flex;align-items:center;gap:20px;margin-bottom:24px;font-size:12px}button{padding:9px 18px;cursor:pointer}svg{width:100%;height:auto;max-height:88vh}@media print{body{margin:0}nav{display:none}svg{max-height:260mm}}';doc.head.append(style);
  const nav=doc.createElement('nav'),button=doc.createElement('button'),note=doc.createElement('span');button.textContent='打印 / 另存为 PDF';button.onclick=()=>target.print();note.textContent='请在打印目标中选择“另存为 PDF”，并关闭页眉页脚。';nav.append(button,note);doc.body.append(nav);
  const svg=doc.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${frame.width} ${frame.height+labels.height}`);svg.setAttribute('xmlns',ns);svg.style.background='white';const image=doc.createElementNS(ns,'image');image.setAttribute('href',canvas.toDataURL('image/png'));image.setAttribute('x','0');image.setAttribute('y',String(labels.height));image.setAttribute('width',String(frame.width));image.setAttribute('height',String(frame.height));svg.append(image);
  for(const t of labels.items){const text=doc.createElementNS(ns,'text');text.textContent=t.text;text.setAttribute('font-family','Segoe UI, Microsoft YaHei, sans-serif');text.setAttribute('font-size',String(t.font));text.setAttribute('font-weight','bold');if(t.vertical){text.setAttribute('transform',`translate(${t.x-t.font*.2} ${t.font/2+t.width}) rotate(-90)`);}else{text.setAttribute('x',String(t.x-t.width/2));text.setAttribute('y',String(labels.height-t.font*.7));}svg.append(text);}doc.body.append(svg);return layout;
}
