import {defaults,clone,parseLabels,validate,even,geometry} from './core.mjs?v=1';
import {labelLayout,drawLabels,makeCanvas,canvasBlob,download,printFrame} from './export.mjs?v=1';

const $=id=>document.getElementById(id),canvas=$('canvas'),ctx=canvas.getContext('2d'),documents=[];
let currentId=null,processor=createProcessor(),mode='normal',cropDraft=[0,0,1,1],cropFresh=false,selectedLane=-1,drag=null,frame=null,previewVersion=0,previewTimer,previewFlight=false,previewPending=false,busy=false,comparing=false,unsaved=false;
let allowUnload=false;
const current=()=>documents.find(d=>d.id===currentId);
const filename=(doc,suffix)=>doc.name.replace(/\.[^.]*$/,'')+suffix;
const cleanEdit=edit=>({...clone(edit),lanes:null,labels:null});
const dirty=doc=>!!doc&&(JSON.stringify(doc.draft)!==JSON.stringify(doc.edit)||doc.prompt!==doc.appliedPrompt);
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function createProcessor(){
  const worker=new Worker(new URL('./worker.mjs?v=1',import.meta.url),{type:'module'}),pending=new Map();let serial=0;
  worker.onmessage=({data})=>{const p=pending.get(data.request);if(!p)return;pending.delete(data.request);data.error?p.reject(Error(data.error)):p.resolve(data.result);};
  worker.onerror=()=>{for(const p of pending.values())p.reject(Error('图片处理线程意外停止，请保存项目后刷新页面。'));pending.clear();};
  return {call(action,id,data={},transfers=[]){return new Promise((resolve,reject)=>{const request=++serial;pending.set(request,{resolve,reject});worker.postMessage({request,action,id,...data},transfers);});},close(){worker.terminate();for(const p of pending.values())p.reject(Error('处理任务已结束。'));pending.clear();}};
}
function updateActions(){
  const d=current(),changed=dirty(d),has=!!d;
  $('fileCount').textContent=`${documents.length} / 8`;$('controls').disabled=!has||busy;
  for(const id of ['add','demo','openProject'])$(id).disabled=busy;
  for(const id of ['copyImage','exportPng','exportTiff','exportPdf','exportRecord'])$(id).disabled=!has||changed||busy||mode!=='normal';
  $('saveProject').disabled=!has||busy;$('reset').disabled=!has||busy;$('compare').disabled=!has||busy||mode!=='normal';$('apply').disabled=!has||!changed||busy||mode!=='normal';$('discard').disabled=!has||!changed||busy;
  $('reviewDot').classList.toggle('dirty',changed);$('reviewText').textContent=changed?'预览含未应用修改，应用后可导出。':has?'修改已应用，可以导出。':'先调整图片，再应用修改。';$('dirtyState').textContent=unsaved?'项目未保存':'项目已保存';
  $('compare').setAttribute('aria-pressed',String(comparing));$('cropActions').hidden=mode!=='crop';$('laneActions').hidden=mode!=='lanes';$('crop').classList.toggle('active',mode==='crop');$('laneEdit').classList.toggle('active',mode==='lanes');$('modeHint').hidden=mode==='normal';$('modeHint').textContent=mode==='crop'?(cropFresh?'按住鼠标拖动，框选需要保留的区域':'框内移动 · 四角缩放 · 框外重新框选'):'拖动辅助线 · 开启补加可添加泳道';
  for(const id of ['cropX','cropY','cropW','cropH','ratio','cropFinish'])$(id).disabled=mode==='crop'&&!frame;
  if(mode==='crop'&&cropFresh)$('cropFinish').disabled=true;
  canvas.style.cursor=mode==='crop'?'crosshair':mode==='lanes'?'ew-resize':'default';
  $('laneFinish').disabled=mode==='lanes'&&!frame;canvas.style.opacity=mode!=='normal'&&!frame?'.4':'1';
}
function setBusy(value,message){busy=value;if(message)status(message);updateActions();}
function changed(geometry=false){const d=current();if(!d)return;if(geometry){d.draft.lanes=null;d.draft.labels=null;selectedLane=-1;}unsaved=true;updateCounts();updateActions();schedulePreview();}
function updateCounts(){const d=current();try{$('labelCount').textContent=`${parseLabels($('labels').value).length} 个标签`;}catch(e){$('labelCount').textContent=e.message;}$('laneCount').textContent=d?.draft.lanes?`${d.draft.lanes.length} 条辅助线`:'尚未定位';}
function cropFields(){for(const [i,id] of ['cropX','cropY','cropW','cropH'].entries())$(id).value=(cropDraft[i]*100).toFixed(2);}
function controls(){
  const d=current();mode='normal';comparing=false;selectedLane=-1;frame=null;++previewVersion;$('addLane').checked=false;
  for(const id of ['grayscale','invert'])$(id).checked=d?.draft[id]??true;
  for(const id of ['angle','brightness','contrast'])$(id).value=d?.draft[id]??(id==='contrast'?1:0);
  $('brightnessValue').textContent=Number($('brightness').value).toFixed(2);$('contrastValue').textContent=Number($('contrast').value).toFixed(2);$('labels').value=d?.prompt??'M,1-6,M';cropDraft=d?.draft.crop?[...d.draft.crop]:[0,0,1,1];cropFields();
  $('imageTitle').textContent=d?.name??'让每一道，都有清晰的名字。';$('imageMeta').textContent=d?`${d.width} × ${d.height} · ${d.bits}-bit 原图`:'WB / GEL IMAGE EDITOR';$('empty').hidden=!!d;canvas.hidden=!d;updateCounts();updateActions();schedulePreview();
}
function list(){
  $('images').replaceChildren();
    for(const d of documents){const row=document.createElement('div');row.className='file-row';const button=document.createElement('button');button.className='image-card'+(d.id===currentId?' active':'');button.onclick=()=>{if(busy)return;if(mode==='crop'){status('请先确认或取消当前裁剪，再切换图片。',true);return;}currentId=d.id;list();controls();};const thumb=document.createElement('canvas');thumb.width=180;thumb.height=76;thumb.dataset.thumbnail=d.id;const title=document.createElement('strong');title.textContent=d.name;title.title=d.name;const meta=document.createElement('small');meta.textContent=`${d.width} × ${d.height} · ${d.bits}-bit`;button.append(thumb,title,meta);if(d.thumbnail){const image=new Image();image.onload=()=>thumb.getContext('2d').drawImage(image,0,0,180,76);image.src=d.thumbnail;}const remove=document.createElement('button');remove.className='remove-image';remove.textContent='×';remove.setAttribute('aria-label','移除 '+d.name);remove.onclick=async()=>{if(busy)return;if(!confirm('移除此图片和其未保存的编辑？磁盘原图不会删除。'))return;try{await processor.call('remove',d.id);documents.splice(documents.indexOf(d),1);if(currentId===d.id)currentId=documents[0]?.id??null;unsaved=true;list();controls();}catch(e){status(e.message,true);}};row.append(button,remove);$('images').append(row);}
}
function schedulePreview(){++previewVersion;previewPending=true;clearTimeout(previewTimer);previewTimer=setTimeout(refresh,130);}
async function refresh(){
  clearTimeout(previewTimer);if(previewFlight){previewPending=true;++previewVersion;return;}previewPending=false;
  const d=current(),version=++previewVersion;if(!d){ctx.clearRect(0,0,canvas.width,canvas.height);return;}previewFlight=true;
  const edit=comparing?{...defaults(),grayscale:false,invert:false}:cleanEdit(d.draft);if(mode==='crop')edit.crop=null;
  try{const result=await processor.call('preview',d.id,{edit});if(version!==previewVersion||d.id!==currentId)return;frame=result;draw();updateActions();if(!d.thumbnail){const small=document.createElement('canvas');small.width=180;small.height=76;const raw=document.createElement('canvas');raw.width=frame.width;raw.height=frame.height;raw.getContext('2d').putImageData(new ImageData(frame.pixels,frame.width,frame.height),0,0);const c=small.getContext('2d');c.fillStyle='#edf1eb';c.fillRect(0,0,180,76);const scale=Math.min(180/frame.width,76/frame.height);c.drawImage(raw,(180-frame.width*scale)/2,(76-frame.height*scale)/2,frame.width*scale,frame.height*scale);d.thumbnail=small.toDataURL();const thumb=document.querySelector(`[data-thumbnail="${d.id}"]`);if(thumb)thumb.getContext('2d').drawImage(small,0,0);}if(!busy)status(mode==='normal'?'预览已更新。请核对泳道与上样记录。':mode==='crop'?(cropFresh?'按住鼠标拖动，框选需要保留的区域。':'完成选区后点击“确认选区”，再应用修改。'):'校正后点击“完成校正”，再应用修改。');}catch(e){if(version===previewVersion)status(e.message,true);}finally{previewFlight=false;if(previewPending)refresh();}
}
function draw(){
  const d=current();if(!frame||!d)return;const annotations=mode==='normal'&&!comparing?d.draft:null,scale=frame.width/frame.fullWidth;
  const layout=annotations?labelLayout(frame.fullWidth,annotations,(text,size)=>{ctx.font=`bold ${size}px "Segoe UI","Microsoft YaHei",sans-serif`;return ctx.measureText(text).width;}):{height:0,items:[]};
  canvas.width=frame.width;canvas.height=frame.height+Math.ceil(layout.height*scale);ctx.putImageData(new ImageData(frame.pixels,frame.width,frame.height),0,Math.ceil(layout.height*scale));if(layout.height){ctx.save();ctx.scale(scale,scale);drawLabels(ctx,frame.fullWidth,layout);ctx.restore();}
  const unit=canvas.width/Math.max(1,canvas.getBoundingClientRect().width);
  if(mode==='crop'&&!cropFresh){const [x,y,w,h]=cropDraft.map((v,i)=>v*(i%2?canvas.height:canvas.width));ctx.fillStyle='#15271b80';ctx.beginPath();ctx.rect(0,0,canvas.width,canvas.height);ctx.rect(x,y,w,h);ctx.fill('evenodd');ctx.strokeStyle='#dcaa59';ctx.lineWidth=2*unit;ctx.strokeRect(x,y,w,h);for(const [a,b] of [[x,y],[x+w,y],[x+w,y+h],[x,y+h]]){ctx.fillStyle='#dbaa60';ctx.fillRect(a-4*unit,b-4*unit,8*unit,8*unit);}}
  if(mode==='lanes'){for(const [i,lane] of (d.draft.lanes||[]).entries()){const x=lane.center*canvas.width;ctx.strokeStyle=i===selectedLane?'#d69030':'#4a9bba';ctx.lineWidth=1.5*unit;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();ctx.font=`bold ${11*unit}px sans-serif`;ctx.fillStyle=ctx.strokeStyle;ctx.fillText(String(i+1),x+3*unit,(14+(i%2)*15)*unit);}}
}
function boundCrop(rect,applyRatio=false){let [x,y,w,h]=rect;if(!rect.every(Number.isFinite))throw Error('裁剪数字必须有效。');w=Math.min(1,Math.max(.001,w));h=Math.min(1,Math.max(.001,h));const ratio=Number($('ratio').value);if(applyRatio&&ratio&&frame){h=w*frame.fullWidth/frame.fullHeight/ratio;if(h>1){h=1;w=h*ratio*frame.fullHeight/frame.fullWidth;}}return [Math.max(0,Math.min(1-w,x)),Math.max(0,Math.min(1-h,y)),w,h];}
function on(id,fn){$(id).addEventListener('click',async()=>{try{await fn();}catch(e){status(e.message,true);}});}
async function decodeFile(file,target=processor){
  if(file.size>256*1024*1024)throw Error('单个图片文件不能超过 256 MiB。');
  const buffer=await file.arrayBuffer(),hash=await crypto.subtle.digest('SHA-256',buffer),sha256=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join(''),id=crypto.randomUUID(),info=await target.call('open',id,{buffer,type:file.type},[buffer]);return {id,...info,name:file.name,file,sha256,edit:defaults(),draft:defaults(),prompt:'M,1-6,M',appliedPrompt:'M,1-6,M',history:[]};
}
async function openFiles(files){if(busy)return;setBusy(true,'正在本机解码图片…');let errors=[];try{for(const file of files){try{const d=await decodeFile(file);documents.push(d);currentId=d.id;unsaved=true;}catch(e){errors.push(`${file.name}：${e.message}`);}}list();controls();}finally{setBusy(false);}if(errors.length)status(errors.join('；'),true);}
on('add',()=>$('fileInput').click());
$('fileInput').addEventListener('change',async e=>{await openFiles([...e.target.files]);e.target.value='';});
for(const type of ['dragenter','dragover'])$('workspace').addEventListener(type,e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();$('stage').classList.add('dragover');}});
$('workspace').addEventListener('dragleave',e=>{if(!$('workspace').contains(e.relatedTarget))$('stage').classList.remove('dragover');});
$('workspace').addEventListener('drop',e=>{e.preventDefault();$('stage').classList.remove('dragover');openFiles([...e.dataTransfer.files]);});
on('demo',async()=>{const c=document.createElement('canvas');c.width=1000;c.height=440;const x=c.getContext('2d');x.fillStyle='#111';x.fillRect(0,0,c.width,c.height);for(let i=0;i<8;i++){const center=80+i*120;for(const [j,y] of [85,190,315].entries()){x.fillStyle=`rgb(${190-i%3*25},${190-i%3*25},${190-i%3*25})`;x.fillRect(center-16,y+(i%3)*6,32,9+j*2);}if(i===0||i===7){for(const y of [45,130,250,375]){x.fillStyle='#999';x.fillRect(center-16,y,32,5);}}}const blob=await canvasBlob(c);await openFiles([new File([blob],'演示胶图-8道.png',{type:'image/png'})]);});
for(const id of ['grayscale','invert','brightness','contrast','angle'])$(id).addEventListener('input',()=>{const d=current();if(!d||busy)return;const number=['brightness','contrast','angle'].includes(id),v=number?Number($(id).value):$(id).checked;if(number&&(!Number.isFinite(v)||$(id).value===''))return;d.draft[id]=v;mode='normal';if(id==='brightness'||id==='contrast')$(id+'Value').textContent=v.toFixed(2);changed(id==='angle');});
for(const [id,delta] of [['rotateLeft',90],['rotateRight',-90]])on(id,()=>{const d=current();if(!d)return;d.draft.angle=Math.min(360,Math.max(-360,d.draft.angle+delta));$('angle').value=d.draft.angle;mode='normal';changed(true);});
on('crop',()=>{const d=current();if(!d)return;mode='crop';cropFresh=true;drag=null;comparing=false;frame=null;++previewVersion;cropDraft=d.draft.crop?[...d.draft.crop]:[0,0,1,1];cropFields();updateActions();refresh();});
on('cropFinish',()=>{const d=current();if(mode!=='crop'||!d||!frame||cropFresh)return;d.draft.crop=[...cropDraft];mode='normal';changed(true);});
on('cropCancel',()=>{mode='normal';updateActions();refresh();});
on('cropReset',()=>{const d=current();if(!d)return;d.draft.crop=null;cropDraft=[0,0,1,1];cropFields();mode='normal';changed(true);});
for(const id of ['cropX','cropY','cropW','cropH'])$(id).addEventListener('change',()=>{try{if(mode!=='crop'){status('请先点击“图上裁剪”，再调整百分比。',true);return;}cropDraft=boundCrop(['cropX','cropY','cropW','cropH'].map(id=>Number($(id).value)/100),true);cropFresh=false;unsaved=true;cropFields();updateActions();draw();}catch(e){status(e.message,true);}});
$('ratio').addEventListener('change',()=>{if(mode==='crop'&&!cropFresh){cropDraft=boundCrop(cropDraft,true);cropFields();draw();}});
$('labels').addEventListener('input',()=>{const d=current();if(!d)return;d.prompt=$('labels').value;try{const names=parseLabels(d.prompt);if(d.draft.lanes)d.draft.labels=names;}catch{}changed();});
on('detect',async()=>{const d=current();if(!d)return;if(mode==='crop')throw Error('请先确认或取消裁剪选区。');const names=parseLabels(d.prompt);setBusy(true,'正在分析泳道信号，请稍候…');try{const result=await processor.call('detect',d.id,{edit:cleanEdit(d.draft),count:names.length,top:Number($('detectTop').value)/100,bottom:Number($('detectBottom').value)/100});d.draft.lanes=result.lanes;d.draft.labels=names;mode='lanes';comparing=false;frame=null;++previewVersion;selectedLane=-1;changed();await refresh();status(result.weak.length?'以下泳道信号弱，位置为估计，请核对：'+result.weak.join('、'):'已按标签数量定位，请逐道核对后完成校正。');}finally{setBusy(false);}});
on('even',()=>{const d=current();if(!d)return;if(mode==='crop')throw Error('请先确认或取消裁剪。');const names=parseLabels(d.prompt);d.draft.lanes=even(names.length);d.draft.labels=names;mode='lanes';comparing=false;frame=null;++previewVersion;selectedLane=-1;changed();});
on('laneEdit',()=>{const d=current();if(!d)return;if(!d.draft.lanes?.length)throw Error('请先自动定位或等距定位。');mode='lanes';comparing=false;frame=null;++previewVersion;selectedLane=-1;updateActions();refresh();});
on('laneFinish',()=>{const d=current();if(!d)return;d.draft.labels=parseLabels(d.prompt);validate(d.draft);mode='normal';changed();});
on('deleteLane',()=>{const d=current();if(d?.draft.lanes&&selectedLane>=0){d.draft.lanes.splice(selectedLane,1);selectedLane=-1;changed();}});
canvas.addEventListener('pointerdown',e=>{const d=current();if(!d||busy||mode==='normal'||!frame)return;const r=canvas.getBoundingClientRect(),x=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),y=Math.min(1,Math.max(0,(e.clientY-r.top)/r.height));canvas.setPointerCapture(e.pointerId);if(mode==='crop'){const [a,b,w,h]=cropDraft,corner=cropFresh?-1:[[a,b],[a+w,b],[a+w,b+h],[a,b+h]].findIndex(p=>Math.abs(p[0]-x)*r.width<12&&Math.abs(p[1]-y)*r.height<12);drag={x,y,base:[...cropDraft],corner,creating:cropFresh,move:!cropFresh&&corner<0&&x>=a&&x<=a+w&&y>=b&&y<=b+h};}else if($('addLane').checked){if(d.draft.lanes.length>=200)return;const center=Math.min(.999,Math.max(.001,x));if(d.draft.lanes.some(l=>Math.abs(l.center-center)<=.0021))return;d.draft.lanes.push({center,width:.02});d.draft.lanes.sort((a,b)=>a.center-b.center);changed();draw();}else{let nearest=-1,distance=14/r.width;d.draft.lanes.forEach((l,i)=>{if(Math.abs(l.center-x)<distance){nearest=i;distance=Math.abs(l.center-x);}});selectedLane=nearest;drag=nearest>=0?{lane:nearest}:null;draw();}});
canvas.addEventListener('pointermove',e=>{if(!drag||busy)return;const d=current(),r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;if(mode==='lanes'){const i=drag.lane,lo=i?d.draft.lanes[i-1].center+.0021:.001,hi=i===d.draft.lanes.length-1?.999:d.draft.lanes[i+1].center-.0021;if(lo<=hi)d.draft.lanes[i].center=Math.min(hi,Math.max(lo,x));unsaved=true;updateActions();draw();return;}if(mode!=='crop')return;if(drag.creating&&cropFresh&&Math.abs(x-drag.x)*r.width<3&&Math.abs(y-drag.y)*r.height<3)return;const [a,b,w,h]=drag.base;if(drag.move)cropDraft=boundCrop([a+x-drag.x,b+y-drag.y,w,h]);else if(drag.corner>=0){let left=a,top=b,right=a+w,bottom=b+h;if([0,3].includes(drag.corner))left=Math.min(right-.001,x);else right=Math.max(left+.001,x);if([0,1].includes(drag.corner))top=Math.min(bottom-.001,y);else bottom=Math.max(top+.001,y);cropDraft=boundCrop([left,top,right-left,bottom-top],true);}else cropDraft=boundCrop([Math.min(x,drag.x),Math.min(y,drag.y),Math.abs(x-drag.x),Math.abs(y-drag.y)],true);cropFresh=false;unsaved=true;cropFields();updateActions();draw();});
for(const name of ['pointerup','pointercancel'])canvas.addEventListener(name,()=>{drag=null;});
on('apply',async()=>{const d=current();if(!d)return;const names=parseLabels(d.prompt);if(d.draft.lanes)d.draft.labels=names;validate(d.draft);d.history.push({edit:clone(d.edit),prompt:d.appliedPrompt});if(d.history.length>20)d.history.shift();d.edit=clone(d.draft);d.appliedPrompt=d.prompt;unsaved=true;updateActions();await refresh();status('修改已应用。导出前请核对编号与实际泳道。');});
on('discard',()=>{const d=current();if(!d)return;if(dirty(d))unsaved=true;d.draft=clone(d.edit);d.prompt=d.appliedPrompt;controls();});
on('reset',()=>{const d=current();if(!d||!confirm('重置当前图片的处理参数和标注？原图保持不变。'))return;d.draft=defaults();d.prompt='M,1-6,M';controls();changed();});
on('compare',()=>{comparing=!comparing;updateActions();refresh();});on('fit',()=>draw());on('help',()=>$('helpDialog').showModal());on('closeHelp',()=>$('helpDialog').close());
function requireApplied(){const d=current();if(!d)throw Error('请先打开图片。');if(dirty(d)||mode!=='normal')throw Error('请先完成编辑并点击“应用修改”。');validate(d.edit);return d;}
async function exportFrame(){const d=requireApplied();return {doc:d,frame:await processor.call('pixels',d.id,{edit:cleanEdit(d.edit)})};}
on('exportPng',async()=>{requireApplied();setBusy(true,'正在生成 PNG…');try{const {doc,frame}=await exportFrame(),{canvas}=makeCanvas(frame,doc.edit);download(await canvasBlob(canvas),filename(doc,'-gel.png'));status('PNG 已生成。建议同时保存处理记录和项目。');}finally{setBusy(false);}});
on('copyImage',async()=>{
  const d=requireApplied();
  if(!window.isSecureContext||!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw Error('当前浏览器不支持复制图片，请使用新版 Edge / Chrome，或导出 PNG。');
  setBusy(true,'正在复制图片…');
  let renderError;
  const png=processor.call('pixels',d.id,{edit:cleanEdit(d.edit)}).then(frame=>canvasBlob(makeCanvas(frame,d.edit).canvas)).catch(error=>{renderError=error;throw error;});
  png.catch(()=>{});
  try{await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);status('已复制带编号的图片，可在 PPT 或文档中按 Ctrl+V 粘贴。');}
  catch(error){if(renderError)throw renderError;if(error.name==='NotAllowedError')throw Error('浏览器未允许写入剪贴板。请允许本站使用剪贴板后重试，或导出 PNG。');throw error;}
  finally{setBusy(false);}
});
on('exportTiff',async()=>{const d=requireApplied();setBusy(true,'正在生成 TIFF…');try{let header=null;if(d.edit.lanes){const size=geometry(d,d.edit),bar=document.createElement('canvas'),c=bar.getContext('2d'),layout=labelLayout(size.width,d.edit,(text,font)=>{c.font=`bold ${font}px "Segoe UI","Microsoft YaHei",sans-serif`;return c.measureText(text).width;});if(size.width*(size.height+layout.height)>24_000_000)throw Error('图片加上标签后超过 2400 万像素，请先缩小裁剪区域。');bar.width=size.width;bar.height=layout.height;drawLabels(c,size.width,layout);header={width:size.width,height:layout.height,pixels:c.getImageData(0,0,size.width,layout.height).data};}const result=await processor.call('tiff',d.id,{edit:cleanEdit(d.edit),header},header?[header.pixels.buffer]:[]);download(new Blob([result.buffer],{type:'image/tiff'}),filename(d,'-gel.tiff'));status(`TIFF 已生成，保留 ${d.bits}-bit 处理后位深。`);}finally{setBusy(false);}});
on('exportPdf',async()=>{requireApplied();const target=window.open('about:blank','_blank');if(!target)throw Error('打印页被浏览器阻止，请允许本站弹出窗口。');setBusy(true,'正在准备打印页…');try{const {doc,frame}=await exportFrame();printFrame(target,frame,doc.edit);status('打印页已打开，可选择“另存为 PDF”。');}catch(e){target.close();throw e;}finally{setBusy(false);}});
on('exportRecord',()=>{const d=requireApplied();const record={format:'blackblues.gel-record',version:1,createdAt:new Date().toISOString(),source:{name:d.name,sha256:d.sha256,width:d.width,height:d.height,bits:d.bits},edit:d.edit,processingOrder:['grayscale','brightness-contrast','invert','rotate','crop','labels'],arbitraryAngleResampled:Math.abs(d.edit.angle/90-Math.round(d.edit.angle/90))>=1e-9,displayExportBits:8,tiffExportBits:d.bits,metadataRoundTripGuaranteed:false};download(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}),filename(d,'-gel-record.json'));});
function base64(bytes){let out='';for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(out);}
function fromBase64(text){if(typeof text!=='string'||text.length>153_333_336)throw Error('项目图片数据过大或无效。');const raw=atob(text);if(raw.length>115_000_000)throw Error('项目图片数据超过大小上限。');const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;}
async function saveProject(){
  if(busy)throw Error('正在处理当前项目，请等待完成后再保存。');
  if(mode!=='normal')throw Error('请先完成或取消当前图上编辑，再保存项目。');
  for(const d of documents){try{validate(d.edit);validate(d.draft);const pending=parseLabels(d.prompt),applied=parseLabels(d.appliedPrompt);if((d.edit.lanes&&JSON.stringify(d.edit.labels)!==JSON.stringify(applied))||(d.draft.lanes&&JSON.stringify(d.draft.labels)!==JSON.stringify(pending)))throw Error('标签与上样顺序不一致。');}catch(e){throw Error(d.name+'：请先修正参数后保存。'+e.message);}}
  if(documents.reduce((n,d)=>n+d.file.size,0)>115_000_000)throw Error('项目原图总量超过 115 MB。请分批处理；单张过大时，请另存较小副本后重新打开。');
  setBusy(true,'正在打包原图与编辑参数…');
  try{
    const name='胶图项目-'+new Date().toISOString().slice(0,10)+'.gelwork';
    let handle=null;
    if(typeof window.showSaveFilePicker==='function'){
      try{handle=await window.showSaveFilePicker({id:'blackblues-gel-project',suggestedName:name,types:[{description:'胶图项目',accept:{'application/json':['.gelwork']}}]});}
      catch(error){if(!['SecurityError','NotAllowedError'].includes(error.name))throw error;}
    }
    const images=[];
    for(const d of documents){const data=base64(new Uint8Array(await d.file.arrayBuffer()));images.push({name:d.name,type:d.file.type,data,sha256:d.sha256,edit:d.edit,draft:d.draft,prompt:d.prompt,appliedPrompt:d.appliedPrompt});}
    const text=JSON.stringify({format:'blackblues.gelwork',version:1,active:documents.findIndex(d=>d.id===currentId),images});
    if(text.length>160_000_000)throw Error('项目文件过大，请减少同时打开的图片后保存。');
    const blob=new Blob([text],{type:'application/json'});
    if(handle){const file=await handle.createWritable();try{await file.write(blob);await file.close();}catch(error){try{await file.abort();}catch{}throw error;}}
    else download(blob,name);
    if(handle)unsaved=false;
    status(handle?'项目已保存，包含原图和编辑参数。':'项目已发起下载，请确认文件已保存。');
    return {confirmed:!!handle};
  }finally{setBusy(false);}
}
on('saveProject',async()=>{try{const result=await saveProject();if(!result.confirmed)await confirmLeave('保存项目',{alreadyDownloaded:true,confirmOnly:true});}catch(error){if(error.name==='AbortError')status('已取消保存，当前项目保持不变。');else throw error;}});

function confirmLeave(action,{alreadyDownloaded=false,confirmOnly=false}={}){
  if(busy){status('正在处理当前项目，请等待完成后再继续。');return Promise.resolve(false);}
  if(!unsaved||!documents.length)return Promise.resolve(true);
  const dialog=$('leaveDialog'),save=$('leaveSave'),discard=$('leaveDiscard'),cancel=$('leaveCancel'),message=$('leaveMessage');
  if(dialog.open)return Promise.resolve(false);
  $('leaveTitle').textContent=confirmOnly?'确认项目已保存':action+'前，保存当前项目？';message.textContent=confirmOnly?'项目已发起下载。请确认文件已保存，再点击“确认已保存”；如果取消了下载，请选择“取消”，当前项目仍会提醒保存。':'当前项目有未保存的内容。保存会包含全部图片和各自的编辑参数。';save.textContent=alreadyDownloaded?(confirmOnly?'确认已保存':'确认已保存，继续'):'保存后继续';discard.hidden=confirmOnly;save.disabled=discard.disabled=cancel.disabled=false;
  return new Promise(resolve=>{
    let saving=false,downloadStarted=alreadyDownloaded;
    const finish=proceed=>{dialog.close();dialog.removeEventListener('cancel',escape);save.onclick=discard.onclick=cancel.onclick=null;resolve(proceed);};
    const escape=event=>{event.preventDefault();if(!saving)finish(false);};
    discard.onclick=()=>finish(true);cancel.onclick=()=>finish(false);dialog.addEventListener('cancel',escape);
    save.onclick=async()=>{
      if(downloadStarted){unsaved=false;updateActions();finish(true);return;}
      saving=true;save.disabled=discard.disabled=cancel.disabled=true;dialog.setAttribute('aria-busy','true');message.textContent='正在保存项目，请稍候…';
      try{
        const result=await saveProject();
        if(result.confirmed)finish(true);
        else{downloadStarted=true;save.textContent='确认已保存，继续';message.textContent='项目已发起下载。请确认下载已完成；如取消了下载，请选择“取消”返回编辑，再重新保存；也可选择“不保存”。';}
      }catch(error){message.textContent=error.name==='AbortError'?'已取消文件保存，当前项目仍保留。可以重试保存、选择不保存，或取消本次操作。':error.message;}
      finally{saving=false;save.disabled=discard.disabled=cancel.disabled=false;dialog.removeAttribute('aria-busy');}
    };
    dialog.showModal();cancel.focus();
  });
}
on('openProject',()=>$('projectInput').click());
$('projectInput').addEventListener('change',async e=>{
  const file=e.target.files[0];e.target.value='';if(!file||busy||!await confirmLeave('打开项目'))return;
  let next;setBusy(true,'正在校验和恢复项目…');
  try{
    if(file.size>160_000_000)throw Error('项目超过 160 MB 上限。');
    const project=JSON.parse(await file.text());
    if(project.format!=='blackblues.gelwork'||project.version!==1||!Array.isArray(project.images)||project.images.length<1||project.images.length>8)throw Error('不是受支持的胶图项目。');
    next=createProcessor();const restored=[];
    for(const item of project.images){
      if(typeof item.name!=='string'||item.name.length>255||typeof item.type!=='string'||typeof item.prompt!=='string'||typeof item.appliedPrompt!=='string')throw Error('项目字段不完整。');
      validate(item.edit);validate(item.draft);const pending=parseLabels(item.prompt),applied=parseLabels(item.appliedPrompt);
      if((item.edit.lanes&&JSON.stringify(item.edit.labels)!==JSON.stringify(applied))||(item.draft.lanes&&JSON.stringify(item.draft.labels)!==JSON.stringify(pending)))throw Error('项目中的标签与上样顺序不一致。');
      const data=fromBase64(item.data),d=await decodeFile(new File([data],item.name,{type:item.type}),next);
      if(d.sha256!==item.sha256)throw Error(item.name+'：原图校验值不一致。');
      d.edit=clone(item.edit);d.draft=clone(item.draft);d.prompt=item.prompt;d.appliedPrompt=item.appliedPrompt;restored.push(d);
    }
    processor.close();processor=next;next=null;documents.splice(0,documents.length,...restored);
    currentId=documents[Math.min(documents.length-1,Math.max(0,Number.isInteger(project.active)?project.active:0))].id;
    unsaved=false;list();controls();status('项目已恢复，原图校验通过。');
  }catch(error){next?.close();status('项目未替换：'+error.message,true);}finally{setBusy(false);}
});
document.addEventListener('click',async event=>{
  if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  const link=event.target.closest?.('a[href]');if(!link||link.hasAttribute('download')||(link.target&&link.target!=='_self'))return;
  const url=new URL(link.href);if(!['http:','https:'].includes(url.protocol)||(url.origin===location.origin&&url.pathname===location.pathname&&url.search===location.search))return;
  if(busy){event.preventDefault();status('正在处理当前项目，请等待完成后再离开。');return;}
  if(!unsaved||!documents.length)return;
  event.preventDefault();if(await confirmLeave('离开页面')){allowUnload=true;location.assign(url.href);setTimeout(()=>{allowUnload=false;},0);}
});
window.addEventListener('beforeunload',e=>{if(allowUnload){allowUnload=false;return;}if((unsaved||busy)&&documents.length){e.preventDefault();e.returnValue='';}});
window.addEventListener('pageshow',()=>{allowUnload=false;});
new ResizeObserver(()=>{if(frame)draw();}).observe($('stage'));
controls();
