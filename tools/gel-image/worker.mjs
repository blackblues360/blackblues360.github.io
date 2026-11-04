import {raster,render,rgba8,automatic,automaticRows,MAX_PIXELS} from './core.mjs?v=2';
import {decodeTIFF,encodeTIFF} from './tiff.mjs?v=2';
const images=new Map();
async function handle(data){
  const {request,action,id}=data;
  try {
    let result,transfers=[];
    if(action==='open') {
      if(images.size>=8)throw Error('最多同时打开 8 张图，请先移除部分图片。');
      let image;
      const head=new Uint8Array(data.buffer,0,Math.min(4,data.buffer.byteLength));
      if((head[0]===73&&head[1]===73)||(head[0]===77&&head[1]===77))image=await decodeTIFF(data.buffer);
      else {
        const bytes=new Uint8Array(data.buffer);
        if(bytes.length>24&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[24]===16)throw Error('当前不支持保留 16-bit PNG 的位深。请先转换为 16-bit TIFF，再打开处理。');
        let width=0,height=0;
        if(bytes.length>=24&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71){const view=new DataView(data.buffer);width=view.getUint32(16);height=view.getUint32(20);}
        else if(bytes[0]===255&&bytes[1]===216){for(let at=2;at+4<bytes.length;){if(bytes[at++]!==255)continue;let marker=bytes[at++];while(marker===255&&at<bytes.length)marker=bytes[at++];if(marker===217||marker===218)break;if(marker===0||marker===216||(marker>=208&&marker<=215))continue;const length=(bytes[at]<<8)|bytes[at+1];if(length<2||at+length>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=7){height=(bytes[at+3]<<8)|bytes[at+4];width=(bytes[at+5]<<8)|bytes[at+6];break;}at+=length;}}
        else throw Error('只支持 PNG、JPEG 和 TIFF 图片。');
        if(width*height>MAX_PIXELS)throw Error('单图最多 2400 万像素，请先缩小图片。');
        const bitmap=await createImageBitmap(new Blob([data.buffer],{type:data.type}));
        try{image=raster(bitmap.width,bitmap.height,8);const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);const bytes=context.getImageData(0,0,bitmap.width,bitmap.height).data;for(let i=0;i<bytes.length;i++)image.pixels[i]=bytes[i]*257;}finally{bitmap.close();}
      }
      if([...images.values()].reduce((n,s)=>n+s.width*s.height,0)+image.width*image.height>32_000_000)throw Error('当前图片总量超过 3200 万像素，请先移除部分图片。');
      images.set(id,image);result={width:image.width,height:image.height,bits:image.bits};
    } else if(action==='remove'){images.delete(id);result={};}
    else {
      const source=images.get(id);if(!source)throw Error('图片尚未打开或已被移除。');
      const image=render(source,data.edit);
      if(action==='detect')result=automatic(image,data.count,data.top,data.bottom);
      else if(action==='detectRows')result=automaticRows(image,data.count,data.left,data.right);
      else if(action==='preview'||action==='pixels'){result=rgba8(image,action==='preview'?1500:Infinity,action==='preview'?1100:Infinity);transfers=[result.pixels.buffer];}
      else if(action==='tiff'){result={buffer:encodeTIFF(image,data.header)};transfers=[result.buffer];}
      else throw Error('未知的图片处理请求。');
    }
    self.postMessage({request,result},transfers);
  }catch(error){self.postMessage({request,error:error.message||'图片处理失败。'});}
}
let queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.then(()=>handle(data));};
