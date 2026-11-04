// Port of the statically recovered GelFlip numerical core. All channels use uint16 RGBA.
export const MAX_PIXELS = 24_000_000;
export const defaults = () => ({grayscale:true,invert:true,angle:0,brightness:0,contrast:1,crop:null,lanes:null,labels:null,rows:null,rowLeft:'',rowRight:''});
export const clone = value => structuredClone(value);
export function roundEven(x) { const lo=Math.floor(x), f=x-lo; return f===.5 ? (lo%2===0?lo:lo+1) : Math.round(x); }
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const value=v=>clamp(roundEven(v),0,65535);
export function raster(width,height,bits=16,pixels) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>MAX_PIXELS||![8,16].includes(bits)) throw Error('图片尺寸或位深不支持，单图最多 2400 万像素。');
  if(pixels&&(!(pixels instanceof Uint16Array)||pixels.length!==width*height*4)) throw Error('图片像素数据不完整。');
  return {width,height,bits,pixels:pixels||new Uint16Array(width*height*4)};
}
export function parseLabels(input) {
  const out=[];
  for(const item of String(input).trim().split(/[,，;；\s]+/).filter(Boolean)) {
    const m=/^(\d+)[-–](\d+)$/.exec(item);
    if(m) { const a=Number(m[1]),b=Number(m[2]); if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||Math.max(a,b)>2147483647||Math.abs(a-b)>199)throw Error('数字范围过长或超出范围。'); for(let n=a;;n+=a<=b?1:-1){out.push(String(n));if(n===b)break;} }
    else out.push(item);
    if(out.length>200)throw Error('标签最多 200 项。');
  }
  if(!out.length||out.some(s=>s.length>100))throw Error('请输入 1–200 个标签，每项最多 100 字符。');
  return out;
}
export function parseRowLabels(left='',right='') {
  if(typeof left!=='string'||typeof right!=='string'||left.length>20200||right.length>20200)throw Error('横向信息格式无效或过长。');
  const a=left.split(/\r?\n/).map(s=>s.trim()),b=right.split(/\r?\n/).map(s=>s.trim());
  const rows=Array.from({length:Math.max(a.length,b.length)},(_,i)=>({left:a[i]||'',right:b[i]||''}));
  while(rows.length&&!rows.at(-1).left&&!rows.at(-1).right)rows.pop();
  if(rows.length>200||rows.some(r=>r.left.length>100||r.right.length>100))throw Error('横向信息最多 200 行，每侧每行最多 100 字符。');
  return rows;
}
export function validate(e) {
  if(!e||typeof e.grayscale!=='boolean'||typeof e.invert!=='boolean'||!Number.isFinite(e.angle)||Math.abs(e.angle)>360||!Number.isFinite(e.brightness)||Math.abs(e.brightness)>1||!Number.isFinite(e.contrast)||e.contrast<0||e.contrast>3)throw Error('旋转、亮度或对比度超出范围。');
  if(e.crop&&(!Array.isArray(e.crop)||e.crop.length!==4||e.crop.some(x=>!Number.isFinite(x))||e.crop[0]<0||e.crop[1]<0||e.crop[2]<=0||e.crop[3]<=0||e.crop[0]+e.crop[2]>1.000001||e.crop[1]+e.crop[3]>1.000001))throw Error('裁剪区域无效。');
  if(e.lanes!==null) {
    if(!Array.isArray(e.lanes)||!Array.isArray(e.labels)||e.lanes.length!==e.labels.length||!e.lanes.length||e.lanes.length>200||e.labels.some(s=>typeof s!=='string'||!s.length||s.length>100))throw Error('标签与泳道数量不一致。');
    let prev=-1;
    for(const lane of e.lanes) {if(!Number.isFinite(lane.center)||!Number.isFinite(lane.width)||lane.center<=0||lane.center>=1||lane.width<=0||lane.center-prev<=.002)throw Error('泳道中心须从左到右排列，且不能过于接近。');prev=lane.center;}
  } else if(e.labels!==null) throw Error('请先定位泳道，再应用标签。');
  const rowLabels=parseRowLabels(e.rowLeft===undefined?'':e.rowLeft,e.rowRight===undefined?'':e.rowRight);
  if(e.rows!=null){
    if(!Array.isArray(e.rows)||!e.rows.length||e.rows.length!==rowLabels.length)throw Error('横向信息与定位线数量不一致，请重新定位或修正文字。');
    let prev=-1;for(const row of e.rows){if(!row||!Number.isFinite(row.center)||row.center<=0||row.center>=1||row.center-prev<=.002)throw Error('横向位置须从上到下排列，且不能过于接近。');prev=row.center;}
  }else if(rowLabels.length)throw Error('请先定位横向信息，再应用。');
  return e;
}
export function geometry(source,e) {
  validate(e);
  const w=source.width,h=source.height;
  let cos=Math.cos(e.angle*Math.PI/180),sin=Math.sin(e.angle*Math.PI/180);
  const orth=Math.abs(e.angle/90-roundEven(e.angle/90))<1e-9;
  if(orth){cos=roundEven(cos);sin=roundEven(sin);}
  const rw=Math.ceil(Math.abs(w*cos)+Math.abs(h*sin)-1e-10),rh=Math.ceil(Math.abs(w*sin)+Math.abs(h*cos)-1e-10);
  if(rw*rh>MAX_PIXELS)throw Error('旋转后的完整画布超过 2400 万像素，请先使用较小图片。');
  let x=0,y=0,width=rw,height=rh;
  if(e.crop){x=clamp(Math.floor(e.crop[0]*rw),0,rw-1);y=clamp(Math.floor(e.crop[1]*rh),0,rh-1);width=clamp(roundEven(e.crop[2]*rw),1,rw-x);height=clamp(roundEven(e.crop[3]*rh),1,rh-y);}
  return {cos,sin,orth,rw,rh,x,y,width,height};
}
export function render(source,e) {
  const size=geometry(source,e);
  const {width:w,height:h,pixels:p,bits}=source, adjusted=raster(w,h,bits),a=adjusted.pixels;
  for(let i=0;i<p.length;i+=4) {
    let r=p[i]/65535,g=p[i+1]/65535,b=p[i+2]/65535;
    if(e.grayscale)r=g=b=.2126*r+.7152*g+.0722*b;
    for(let c=0;c<3;c++){let v=clamp(((c===0?r:c===1?g:b)-.5)*e.contrast+.5+e.brightness,0,1);if(e.invert)v=1-v;a[i+c]=value(v*65535);}
    a[i+3]=p[i+3];
  }
  const {cos,sin,orth,rw,rh}=size;
  let rotated;
  if(cos===1&&sin===0)rotated=adjusted;
  else {
    rotated=raster(rw,rh,bits);const dest=rotated.pixels;
    for(let y=0;y<rh;y++)for(let x=0;x<rw;x++) {
      const dx=x+.5-rw/2,dy=y+.5-rh/2,sx=cos*dx-sin*dy+w/2-.5,sy=sin*dx+cos*dy+h/2-.5,j=(y*rw+x)*4;
      if(orth){const xx=roundEven(sx),yy=roundEven(sy);if(xx>=0&&xx<w&&yy>=0&&yy<h)dest.set(a.subarray((yy*w+xx)*4,(yy*w+xx)*4+4),j);continue;}
      const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;let alpha=0,r=0,g=0,b=0;
      for(let m=0;m<2;m++)for(let n=0;n<2;n++){const xx=ix+n,yy=iy+m;if(xx<0||xx>=w||yy<0||yy>=h)continue;const k=(yy*w+xx)*4,weight=(n?fx:1-fx)*(m?fy:1-fy)*a[k+3]/65535;alpha+=weight;r+=a[k]*weight;g+=a[k+1]*weight;b+=a[k+2]*weight;}
      if(alpha>0){dest[j]=value(r/alpha);dest[j+1]=value(g/alpha);dest[j+2]=value(b/alpha);dest[j+3]=value(alpha*65535);}
    }
  }
  if(!e.crop)return rotated;
  const {x,y,width,height}=size,out=raster(width,height,bits);
  for(let j=0;j<height;j++)out.pixels.set(rotated.pixels.subarray(((y+j)*rw+x)*4,((y+j)*rw+x+width)*4),j*width*4);
  return out;
}
export function rgba8(image,maxWidth=Infinity,maxHeight=Infinity) {
  const scale=Math.min(1,maxWidth/image.width,maxHeight/image.height),width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale)),pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const src=(Math.min(image.height-1,Math.floor(y/scale))*image.width+Math.min(image.width-1,Math.floor(x/scale)))*4,j=(y*width+x)*4;for(let c=0;c<4;c++)pixels[j+c]=Math.floor((image.pixels[src+c]+128)/257);}
  return {width,height,pixels,fullWidth:image.width,fullHeight:image.height,bits:image.bits};
}
export function profile(image,top=0,bottom=1) {
  if(!Number.isFinite(top)||!Number.isFinite(bottom)||top<0||bottom>1||bottom-top<.02)throw Error('识别范围至少覆盖 2% 的高度。');
  const w=Math.min(1600,image.width),h=Math.max(16,roundEven(image.height*w/image.width)),start=Math.floor(h*top),end=Math.floor(h*bottom),radius=Math.max(4,Math.min(Math.floor(h/24),Math.floor((end-start)/6))),p=new Float64Array(w);
  if(end<=start)throw Error('识别范围太窄，请扩大上下界。');
  if(h>12000)throw Error('图片长宽比过于极端，请先裁剪后定位泳道。');
  const col=new Float64Array(h),prefix=new Float64Array(h+1);
  for(let x=0;x<w;x++) {
    for(let y=0;y<h;y++){const i=(Math.min(image.height-1,Math.floor(y*image.height/h))*image.width+Math.min(image.width-1,Math.floor(x*image.width/w)))*4;col[y]=(.2126*image.pixels[i]+.7152*image.pixels[i+1]+.0722*image.pixels[i+2])/257;prefix[y+1]=prefix[y]+col[y];}
    const scores=[];for(let y=start;y<end;y++){const lo=Math.max(0,y-radius),hi=Math.min(h,y+radius+1);scores.push(Math.abs(col[y]-(prefix[hi]-prefix[lo])/(hi-lo)));}scores.sort((a,b)=>b-a);const n=Math.min(scores.length,Math.max(2,Math.floor(scores.length/12)));p[x]=scores.slice(0,n).reduce((a,b)=>a+b,0)/n;
  }
  const out=new Float64Array(w),rad=Math.max(1,Math.floor(w/600));for(let x=0;x<w;x++){const lo=Math.max(0,x-rad),hi=Math.min(w-1,x+rad);for(let j=lo;j<=hi;j++)out[x]+=p[j];out[x]/=hi-lo+1;}return out;
}
export function even(count,first=.05,last=.95) {
  if(!Number.isInteger(count)||count<2||count>200||first<=0||last>=1||last<=first||(last-first)/(count-1)<=.002)throw Error('等距定位需要 2–200 个标签，且间距不能过小。');
  return Array.from({length:count},(_,i)=>({center:first+(last-first)*i/(count-1),width:(last-first)/(count-1)*.6}));
}
export function automatic(image,count,top=0,bottom=1) {
  if(!Number.isInteger(count)||count<2||count>200)throw Error('自动定位需要 2–200 个标签。');
  const p=profile(image,top,bottom),w=p.length,prefix=new Float64Array(w+1);for(let i=0;i<w;i++)prefix[i+1]=prefix[i]+p[i];
  const mean=(x,r)=>{const lo=clamp(x-r,0,w),hi=clamp(x+r+1,0,w);return (prefix[hi]-prefix[lo])/Math.max(1,hi-lo);};
  let best=-Infinity,first=0,spacing=0;
  for(let d=Math.max(4,w/(count*4));d<=(w-8)/(count-1);d+=.5){const r=Math.max(2,Math.floor(d*.18)),half=Math.floor(d*.5),scores=new Float64Array(w);for(let x=0;x<w;x++){const v=mean(x,r)-(mean(x-half,r)+mean(x+half,r))*.5;scores[x]=Math.sqrt(Math.max(0,v))-.8*Math.sqrt(Math.max(0,-v));}for(let start=4;start<=w-4-(count-1)*d;start+=2){let score=0;for(let i=0;i<count;i++)score+=scores[Math.min(w-1,roundEven(start+i*d))];score/=count;if(score>best){best=score;first=start;spacing=d;}}}
  if(best<=.8)throw Error('没有找到可靠的周期泳道，请调整识别范围或使用等距定位后手动校正。');
  const baseline=Array.from(p).sort((a,b)=>a-b)[Math.floor(w/2)],lanes=[],weak=[];
  for(let i=0;i<count;i++){const predicted=first+i*spacing,lo=Math.max(1,Math.floor(predicted-spacing*.38)),hi=Math.min(w-2,Math.floor(predicted+spacing*.38)),half=Math.max(2,Math.floor(spacing*.18)),scores=Array.from({length:Math.max(1,hi-lo+1)},(_,j)=>mean(lo+j,half)),max=Math.max(...scores);if(max<=baseline+3){lanes.push({center:predicted/w,width:spacing*.6/w});weak.push(i+1);}else{const threshold=max-Math.max(.5,(max-baseline)*.06),near=scores.map((v,j)=>v>=threshold?j:null).filter(v=>v!==null);lanes.push({center:(lo+near.reduce((a,b)=>a+b,0)/near.length)/w,width:2*half/w});}}
  return {lanes,weak};
}

// Horizontal bands need not be periodic (for example a molecular-weight ladder).
// Reuse the lane detector's local-background contrast, aggregating across the selected columns.
export function automaticRows(image,count,left=0,right=1) {
  if(!Number.isInteger(count)||count<1||count>200)throw Error('横向自动定位需要 1–200 行信息。');
  if(!Number.isFinite(left)||!Number.isFinite(right)||left<0||right>1||right-left<.02)throw Error('识别范围至少覆盖 2% 的宽度。');
  const w=Math.min(1600,image.width),h=Math.min(1600,image.height),start=Math.floor(w*left),end=Math.floor(w*right),radius=Math.max(4,Math.floor(h/24));
  if(end<=start||h<5)throw Error('图片或识别范围太小，请扩大范围或手动定位。');
  const p=new Float64Array(h),column=new Float64Array(h),prefix=new Float64Array(h+1);
  for(let x=start;x<end;x++){
    for(let y=0;y<h;y++){const i=(Math.floor(y*image.height/h)*image.width+Math.floor(x*image.width/w))*4;column[y]=(.2126*image.pixels[i]+.7152*image.pixels[i+1]+.0722*image.pixels[i+2])/257;prefix[y+1]=prefix[y]+column[y];}
    // Keep the interior of a wide band connected instead of counting its two edges.
    const background=Array.from(column).sort((a,b)=>a-b)[Math.floor(h/2)];
    for(let y=0;y<h;y++){const lo=Math.max(0,y-radius),hi=Math.min(h,y+radius+1);p[y]+=(.75*Math.abs(column[y]-background)+.25*Math.abs(column[y]-(prefix[hi]-prefix[lo])/(hi-lo)))/(end-start);}
  }
  const smooth=Float64Array.from(p,(_,y)=>{const lo=Math.max(0,y-1),hi=Math.min(h-1,y+1);let sum=0;for(let j=lo;j<=hi;j++)sum+=p[j];return sum/(hi-lo+1);});
  const baseline=Array.from(smooth).sort((a,b)=>a-b)[Math.floor(h/2)],peak=Math.max(...smooth),threshold=baseline+Math.max(1,(peak-baseline)*.3),candidates=[];
  for(let y=1;y<h-1;y++){
    if(smooth[y]<=threshold)continue;
    let sum=0,weighted=0,score=0;
    while(y<h-1&&smooth[y]>threshold){const signal=smooth[y]-baseline;sum+=signal;weighted+=y*signal;score=Math.max(score,signal);y++;}
    candidates.push({center:weighted/sum/h,score});
  }
  candidates.sort((a,b)=>b.score-a.score);const rows=[];
  for(const candidate of candidates){if(rows.every(r=>Math.abs(r.center-candidate.center)>.008))rows.push(candidate);if(rows.length===count)break;}
  if(rows.length!==count)throw Error(`只找到 ${rows.length} 个可靠横向位置，需要 ${count} 个。请调整左右识别范围，或用等距定位后手动校正。`);
  rows.sort((a,b)=>a.center-b.center);return {rows:rows.map(r=>({center:r.center}))};
}
