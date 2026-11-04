import {raster,MAX_PIXELS} from './core.mjs';

function unpackBits(bytes,limit) {
  const out=new Uint8Array(limit);let p=0;
  for(let i=0;i<bytes.length&&p<limit;){const n=(bytes[i++]<<24)>>24;if(n>=0){const count=n+1;if(i+count>bytes.length||p+count>limit)throw Error('TIFF PackBits 数据损坏。');out.set(bytes.subarray(i,i+count),p);i+=count;p+=count;}else if(n>-128){const count=1-n;if(i>=bytes.length||p+count>limit)throw Error('TIFF PackBits 数据损坏。');out.fill(bytes[i++],p,p+count);p+=count;}}
  if(p!==limit)throw Error('TIFF 图像数据不完整。');return out;
}
function lzw(bytes,limit) {
  let bit=0,size=9,next=258,previous=null,p=0;const out=new Uint8Array(limit),table=new Array(4096);
  const reset=()=>{for(let i=0;i<256;i++)table[i]=Uint8Array.of(i);size=9;next=258;previous=null;};reset();
  const read=()=>{if(bit+size>bytes.length*8)return -1;let n=0;for(let i=0;i<size;i++,bit++)n=(n<<1)|((bytes[bit>>3]>>(7-(bit&7)))&1);return n;};
  for(let code=read();code!==-1&&code!==257;code=read()) {
    if(code===256){reset();continue;}
    let item;
    if(code<next&&table[code])item=table[code];else if(code===next&&previous){item=new Uint8Array(previous.length+1);item.set(previous);item[item.length-1]=previous[0];}else throw Error('TIFF LZW 数据损坏。');
    if(p+item.length>limit)throw Error('TIFF 解压长度异常。');out.set(item,p);p+=item.length;
    if(previous&&next<4096){const add=new Uint8Array(previous.length+1);add.set(previous);add[add.length-1]=item[0];table[next++]=add;if(next===(1<<size)-1&&size<12)size++;}previous=item;
  }
  if(p!==limit)throw Error('TIFF 图像数据不完整。');return out;
}
export async function decodeTIFF(buffer) {
  const bytes=new Uint8Array(buffer),view=new DataView(buffer);
  if(bytes.length<8)throw Error('TIFF 文件不完整。');
  const le=bytes[0]===73&&bytes[1]===73;if(!le&&!(bytes[0]===77&&bytes[1]===77))throw Error('TIFF 字节序标记无效。');
  const u16=p=>{if(p<0||p+2>bytes.length)throw Error('TIFF 字段越界。');return view.getUint16(p,le);},u32=p=>{if(p<0||p+4>bytes.length)throw Error('TIFF 字段越界。');return view.getUint32(p,le);};
  if(u16(2)!==42)throw Error('暂不支持 BigTIFF 或此 TIFF 版本。');
  const ifd=u32(4),count=u16(ifd);if(count>2048||ifd+2+count*12+4>bytes.length)throw Error('TIFF 目录损坏。');
  const tags=new Map();
  for(let i=0;i<count;i++){const at=ifd+2+i*12,id=u16(at),type=u16(at+2),n=u32(at+4),size=({1:1,3:2,4:4})[type];if(!size)continue;if(n>MAX_PIXELS*4)throw Error('TIFF 字段过大。');const start=n*size<=4?at+8:u32(at+8);if(start+n*size>bytes.length)throw Error('TIFF 字段数据不完整。');const vals=[];for(let j=0;j<n;j++)vals.push(type===1?bytes[start+j]:type===3?u16(start+j*2):u32(start+j*4));tags.set(id,vals);}
  if(u32(ifd+2+count*12)!==0)throw Error('暂不支持多页 TIFF，请先拆分后打开。');
  const get=(id,def)=>tags.get(id)?.[0]??def,w=get(256,0),h=get(257,0),samples=get(277,1),bits=tags.get(258)||[1],depth=bits[0],photo=get(262,1),compression=get(259,1),predictor=get(317,1),orientation=get(274,1);
  if(![8,16].includes(depth)||bits.some(v=>v!==depth)||(tags.get(339)||[1]).some(v=>v!==1))throw Error('仅支持无符号整数 8/16-bit TIFF。');
  if(!((photo===0||photo===1)&&[1,2].includes(samples))&&!(photo===2&&[3,4].includes(samples)))throw Error('暂不支持此 TIFF 颜色模式（需要灰度或 RGB）。');
  if(get(284,1)!==1||tags.has(322)||tags.has(324))throw Error('暂不支持分离通道或分块 TIFF，请转换为条带 TIFF。');
  if(orientation!==1)throw Error('此 TIFF 带有方向标记，请先规范方向后打开，以免误读泳道顺序。');
  if(![1,5,8,32946,32773].includes(compression)||![1,2].includes(predictor))throw Error('暂不支持此 TIFF 压缩或预测方式。');
  const image=raster(w,h,depth),offsets=tags.get(273),lengths=tags.get(279),rows=get(278,h),step=depth/8,rowBytes=w*samples*step;
  if(!offsets||!lengths||!rows||offsets.length!==Math.ceil(h/rows)||lengths.length!==offsets.length)throw Error('TIFF 条带信息不完整。');
  const extra=tags.get(338)||[],hasAlpha=samples===(photo===2?4:2);
  if(hasAlpha&&![1,2].includes(extra[0]))throw Error('额外通道未明确标记为透明度，无法安全解释该 TIFF。');
  for(let strip=0;strip<offsets.length;strip++) {
    const start=offsets[strip],length=lengths[strip],nRows=Math.min(rows,h-strip*rows),expected=nRows*rowBytes;if(start+length>bytes.length)throw Error('TIFF 条带越界。');const raw=bytes.subarray(start,start+length);let data;
    if(compression===1){if(raw.length<expected)throw Error('TIFF 条带不完整。');data=raw.slice(0,expected);}
    else if(compression===32773)data=unpackBits(raw,expected);
    else if(compression===5)data=lzw(raw,expected);
    else {
      if(typeof DecompressionStream==='undefined')throw Error('浏览器不支持 TIFF Deflate 解压，请使用新版 Edge/Chrome。');
      const reader=new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();data=new Uint8Array(expected);let pos=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;if(pos+value.length>expected){await reader.cancel();throw Error('TIFF 解压长度异常。');}data.set(value,pos);pos+=value.length;}if(pos!==expected)throw Error('TIFF 图像数据不完整。');}finally{reader.releaseLock();}
    }
    const d=new DataView(data.buffer,data.byteOffset,data.byteLength),sample=i=>depth===8?data[i]:d.getUint16(i*2,le);
    if(predictor===2){for(let y=0;y<nRows;y++)for(let x=samples;x<w*samples;x++){const i=y*w*samples+x,v=(sample(i)+sample(i-samples))&(depth===8?255:65535);if(depth===8)data[i]=v;else d.setUint16(i*2,v,le);}}
    const max=depth===8?255:65535,scale=depth===8?257:1;
    for(let y=0;y<nRows;y++)for(let x=0;x<w;x++){const src=(y*w+x)*samples,j=((strip*rows+y)*w+x)*4,alpha=hasAlpha?sample(src+samples-1):max;let r=sample(src),g=photo===2?sample(src+1):r,b=photo===2?sample(src+2):r;if(photo===0)r=g=b=max-r;if(hasAlpha&&extra[0]===1){if(alpha){r=Math.min(max,Math.round(r*max/alpha));g=Math.min(max,Math.round(g*max/alpha));b=Math.min(max,Math.round(b*max/alpha));}else r=g=b=0;}image.pixels[j]=r*scale;image.pixels[j+1]=g*scale;image.pixels[j+2]=b*scale;image.pixels[j+3]=alpha*scale;}
  }
  return image;
}
export function encodeTIFF(image,header=null,description='BLACK BLUES Gel Image; retain the original image and processing record.') {
  const bits=image.bits,step=bits/8,w=image.width,headerHeight=header?.height||0,h=image.height+headerHeight;
  if(header&&(header.width!==w||header.pixels.length!==w*headerHeight*4))throw Error('标签图层尺寸不匹配。');
  if(w*h>MAX_PIXELS)throw Error('加上标签后超过图片大小上限，请缩小图片或减少标签高度。');
  const text=new TextEncoder().encode(description+'\0'),entries=13,ifd=8,extras=ifd+2+entries*12+4,bitsAt=extras,descriptionAt=bitsAt+8,dataAt=(descriptionAt+text.length+1)&~1,length=w*h*4*step,buffer=new ArrayBuffer(dataAt+length),v=new DataView(buffer),bytes=new Uint8Array(buffer);
  bytes[0]=bytes[1]=73;v.setUint16(2,42,true);v.setUint32(4,ifd,true);v.setUint16(ifd,entries,true);
  const tags=[[256,4,1,w],[257,4,1,h],[258,3,4,bitsAt],[259,3,1,1],[262,3,1,2],[270,2,text.length,descriptionAt],[273,4,1,dataAt],[274,3,1,1],[277,3,1,4],[278,4,1,h],[279,4,1,length],[284,3,1,1],[338,3,1,2]];
  for(let i=0;i<tags.length;i++){const [id,type,n,val]=tags[i],at=ifd+2+i*12;v.setUint16(at,id,true);v.setUint16(at+2,type,true);v.setUint32(at+4,n,true);if(type===3&&n===1)v.setUint16(at+8,val,true);else v.setUint32(at+8,val,true);}
  for(let i=0;i<4;i++)v.setUint16(bitsAt+i*2,bits,true);bytes.set(text,descriptionAt);
  let pos=dataAt;
  if(header)for(const channel of header.pixels){if(bits===16){v.setUint16(pos,channel*257,true);pos+=2;}else bytes[pos++]=channel;}
  for(const channel of image.pixels){if(bits===16){v.setUint16(pos,channel,true);pos+=2;}else bytes[pos++]=Math.floor((channel+128)/257);}
  return buffer;
}
