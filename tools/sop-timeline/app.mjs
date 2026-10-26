import {defaults,clone,uid,end,total,formatDuration,parseDuration,validate,emptyDocument,sampleDocument,endpoints,resizeBlock,deleteBlock,deleteGroup,addBlock,insertBlock,moveBlock,reorderGroup,importDocument,environmentRuns,primaryObject,groupLayout} from './core.mjs?v=2';
import {exportPNG,printPDF} from './export.mjs?v=2';
const $=s=>document.querySelector(s), paper=$('#paper'),viewport=$('#viewport'),storageKey='blackblues.sop-timeline.v1';
let doc=sampleDocument(), selected=null, activeGroup=doc.groups[0].id, past=[],future=[],clipboard=null,zoom=1,drag=null,toastTimer,editSnapshot=null,fileHandle=null,space=false,pointerHeld=false,needsRefresh=false,environmentTargetIds=[];
let recoveryMessage='';
try {const stored=localStorage.getItem(storageKey);if(stored){doc=importDocument(stored);recoveryMessage='已恢复本机自动保存的草稿';}activeGroup=doc.groups[0]?.id;}catch{recoveryMessage='草稿读取失败，已保留原存储。请先保存当前文件。';}
const esc=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeHTML(html) {
  const template=document.createElement('template');template.innerHTML=html;
  const visit=node=>{if(node.nodeType===3)return esc(node.textContent);if(node.nodeType!==1)return '';const tag=node.tagName.toLowerCase();if(['script','style','iframe','object'].includes(tag))return '';const children=[...node.childNodes].map(visit).join('');return ['b','strong','i','em'].includes(tag)?`<${tag}>${children}</${tag}>`:tag==='br'?'<br>':tag==='div'||tag==='p'?`${children}<br>`:children;};
  return [...template.content.childNodes].map(visit).join('');
}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(doc));$('#draftStatus').textContent=`本机草稿 · 已保存 ${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`;}catch{$('#draftStatus').textContent='自动保存失败，请保存 .soptime 文件';}}
function remember(before){if(JSON.stringify(before)===JSON.stringify(doc))return;past.push(before);if(past.length>100)past.shift();future=[];persist();}
function commit(next,message){if(next.error){toast(next.error);return false;}if(validate(next.doc)){toast(validate(next.doc));return false;}const before=clone(doc);doc=next.doc;remember(before);render();if(next.message||message)toast(next.message||message);return true;}
function mutate(fn){const next=clone(doc);fn(next);return commit({doc:next});}
function undo(){finishEdit();if(!past.length)return;future.push(clone(doc));doc=past.pop();persist();render();}
function redo(){finishEdit();if(!future.length)return;past.push(clone(doc));doc=future.pop();persist();render();}
function finishEdit(){if(editSnapshot){remember(editSnapshot);editSnapshot=null;}}
function refreshAfterEdit(){if(needsRefresh&&!pointerHeld&&!drag&&!paper.contains(document.activeElement)){needsRefresh=false;render();}}
document.addEventListener('pointerdown',()=>pointerHeld=true,true);
for(const event of ['pointerup','pointercancel'])document.addEventListener(event,()=>{pointerHeld=false;setTimeout(refreshAfterEdit,0);},true);
function applyZoom(){paper.style.transform=`scale(${zoom})`;$('#paperWrap').style.width=`${800*zoom}px`;$('#paperWrap').style.height=`${paper.offsetHeight*zoom}px`;$('#zoomReset').textContent=`${Math.round(zoom*100)}%⌄`;}
function setZoom(value){zoom=Math.min(1.8,Math.max(.35,value));applyZoom();}
function fit(){setZoom(Math.min(1,(viewport.clientWidth-42)/800));}
function select(id){selected=id;const b=doc.blocks.find(b=>b.id===id);if(b)activeGroup=b.group;paper.querySelectorAll('.time-block').forEach(el=>el.classList.toggle('selected',el.dataset.id===id));$('#copy').disabled=!b;$('#delete').disabled=!b;}
function renderSettings(){
  const range=(key,label,min,max,unit='px')=>`<label class="setting-row">${label}<span class="setting-control"><input type="range" data-setting="${key}" min="${min}" max="${max}" value="${doc.layout[key]}" aria-label="${label}"><output>${doc.layout[key]} ${unit}</output></span></label>`;
  $('#settingFields').innerHTML=`<section class="setting-section"><h3>泳道宽度</h3>${range('waitWidth','等待泳道宽度',72,180)}${range('operationWidth','操作泳道宽度',72,180)}${range('environmentWidth','环境列宽度',80,150)}${range('laneGap','两泳道间距',0,24)}</section><section class="setting-section"><h3>排版与样式</h3>${range('fontSize','实验文字字号',12,22)}${range('spacing','时间节点间距',8,36)}<label class="setting-row">颜色主题<select data-setting="theme"><option value="blue">浅雾蓝 · 杏橙</option><option value="sage">鼠尾草 · 浅沙</option><option value="lavender">薰衣草 · 杏橙</option></select></label></section><section class="setting-section"><h3>页面设置</h3><label class="setting-row">A4 页面方向<select data-setting="orientation"><option value="portrait">纵向 · 210 × 297 mm</option><option value="landscape">横向 · 297 × 210 mm</option></select></label></section>`;
  $('#settingFields').insertAdjacentHTML('beforeend',`<section class="setting-section"><h3>环境词条</h3><div class="environment-terms">${doc.environmentTerms.map((term,index)=>`<span>${esc(term)}<button data-remove-term="${index}" aria-label="删除环境词条 ${esc(term)}">×</button></span>`).join('')}</div><form id="environmentTermForm"><input id="environmentTermInput" maxlength="80" placeholder="输入新环境，如 25°C" aria-label="新增环境词条"><button type="submit">添加</button></form><p class="environment-hint">拖入环境块后选择。删除词条不影响已有标注。</p></section>`);
  for(const key of ['theme','orientation'])$(`[data-setting="${key}"]`).value=doc.layout[key];
}
function render(){
  needsRefresh=false;
  if(!doc.groups.some(g=>g.id===activeGroup))activeGroup=doc.groups[0]?.id;
  const l=doc.layout;paper.style.setProperty('--ow',`${l.operationWidth}px`);paper.style.setProperty('--ww',`${l.waitWidth}px`);paper.style.setProperty('--gap',`${l.laneGap}px`);paper.style.setProperty('--ew',`${l.environmentWidth}px`);paper.style.setProperty('--fs',`${l.fontSize}px`);document.body.dataset.theme=l.theme;
  paper.innerHTML=`<header class="paper-heading"><div class="paper-title"><h1 contenteditable="plaintext-only" data-doc="name" aria-label="实验名称">${esc(doc.name)}</h1><p>SOP 实验流程</p></div><div class="metadata">${[['revision','版本'],['date','日期'],['author','作者']].map(([key,label])=>`<label><span>${label}</span><input data-doc="${key}" value="${esc(doc[key])}" aria-label="${label}" placeholder="点击填写"></label>`).join('')}</div></header><div class="columns"><span>等待</span><span>操作</span><span>实验操作</span><span>环境</span></div>`;
  const allRuns=environmentRuns(doc.blocks.filter(b=>b.object===primaryObject(doc)));
  doc.groups.forEach((g,index)=>{
    const layout=groupLayout(doc,g.id), section=document.createElement('section');section.className='step-group';section.dataset.group=g.id;
    section.innerHTML=`<header class="group-heading"><span class="group-grip" draggable="true" data-group-drag="${g.id}" title="拖动大步骤排序">⠿</span><span class="number">${String(index+1).padStart(2,'0')}</span><span class="group-title" contenteditable="plaintext-only" data-group-title="${g.id}" aria-label="大步骤标题">${esc(g.title)}</span><span class="group-time">${layout.blocks.length?formatDuration(Math.max(...layout.blocks.map(end))-Math.min(...layout.blocks.map(b=>b.start))):'空步骤'}</span><button class="remove-group" data-remove-group="${g.id}" title="删除整个大步骤（Ctrl+Z 撤销）">×</button><button data-collapse="${g.id}" aria-label="${g.collapsed?'展开':'折叠'}大步骤" aria-expanded="${!g.collapsed}">${g.collapsed?'⌄':'⌃'}</button></header>`;
    if(!g.collapsed){
      const body=document.createElement('div');body.className='timeline-body';body.dataset.group=g.id;body.style.height=`${layout.height}px`;
      body.innerHTML='<div class="lane lane-operation" data-lane="operation"></div><div class="lane lane-wait" data-lane="wait"></div>';
      if(!layout.blocks.length)body.innerHTML+='<div class="empty-group">将时间块拖入对应泳道，开始编排实验</div>';
      layout.nodes.slice(0,-1).forEach(time=>{const line=document.createElement('div');line.className='time-line';line.dataset.time=time;line.style.top=`${layout.toY(time)}px`;line.innerHTML=`<small>${formatDuration(time)}</small>`;body.append(line);});
      for(const b of layout.blocks){const block=document.createElement('div');block.className=`time-block ${b.lane}`;block.dataset.id=b.id;block.draggable=true;block.style.top=`${layout.toY(b.start)+10}px`;block.style.height=`${Math.max(32,layout.toY(end(b))-layout.toY(b.start)-20)}px`;block.innerHTML=`<input class="duration" value="${formatDuration(b.duration)}" data-duration="${b.id}" aria-label="时间块持续时间" draggable="false">${b.duration>=1200?'<span class="compression" title="较长时间已视觉压缩">⋮</span>':''}<span class="resize" data-resize="${b.id}" title="拖动尾端调整时长"></span>`;body.append(block);}
      for(const time of [...new Set(layout.blocks.map(b=>b.start))]){
        const texts=document.createElement('div');texts.className='block-texts';texts.dataset.time=time;texts.style.top=`${layout.toY(time)}px`;
        const simultaneous=layout.blocks.filter(b=>b.start===time).sort((a,b)=>(a.lane==='wait'?0:1)-(b.lane==='wait'?0:1));
        texts.classList.toggle('parallel',simultaneous.length>1);
        texts.innerHTML=simultaneous.map(b=>`<div class="text-item ${b.lane==='wait'?'wait-text':''}" data-text-id="${b.id}"><div class="block-description" contenteditable="true" data-text="${b.id}" data-placeholder="点击输入实验操作…" aria-label="实验操作文字">${safeHTML(b.text)}</div></div>`).join('');body.append(texts);
      }
      const start=layout.nodes[0], finish=layout.nodes.at(-1);
      for(const run of allRuns.filter(r=>r.start<finish&&r.end>start)){
        const top=Math.max(run.start,start),bottom=Math.min(run.end,finish),env=document.createElement('div');env.className=`env-run ${/4|冰|避光/.test(run.environment)?'cold':/37/.test(run.environment)?'warm':''}`;env.style.top=`${layout.toY(top)+7}px`;env.style.height=`${Math.max(36,layout.toY(bottom)-layout.toY(top)-14)}px`;env.innerHTML=`<button class="environment-label" data-edit-environment="${run.ids.join(',')}" title="选择环境">${esc(run.environment)}</button><small class="env-object">${run.start<start?'↑ 接上步骤':run.end>finish?'↓ 续下步骤':''}</small>`;body.append(env);
      }
      section.append(body);
      doc.notes.filter(n=>n.group===g.id).forEach(n=>{const note=document.createElement('div');note.className='group-note';note.innerHTML=`<span>!</span><span contenteditable="plaintext-only" data-note="${n.id}" aria-label="备注">${esc(n.text)}</span><button data-remove-note="${n.id}" aria-label="删除备注">×</button>`;section.append(note);});
    }paper.append(section);
  });
  paper.insertAdjacentHTML('beforeend',`<footer class="paper-footer">${doc.blocks.length} 个时间块 &nbsp; · &nbsp; 总耗时 ${formatDuration(total(doc))} &nbsp; · &nbsp; SOP TIMELINE EDITOR</footer>`);
  $('#summary').textContent=`${doc.groups.length} 个大步骤 · ${doc.blocks.length} 个时间块 · 总耗时 ${formatDuration(total(doc))}`;$('#undo').disabled=!past.length;$('#redo').disabled=!future.length;$('#orientationLabel').textContent=l.orientation==='portrait'?'纵向':'横向';renderSettings();select(selected);requestAnimationFrame(()=>{measureText();applyZoom();});
}
// Font metrics are measured in the DOM; extra height remains purely visual.
// Recompute the shared mapping when actual rich text exceeds estimated height.
function measureText(){
  for(const section of paper.querySelectorAll('.step-group')){
    const body=section.querySelector('.timeline-body');if(!body)continue;
    const layout=groupLayout(doc,section.dataset.group);let extra=0;const shifts=[];
    for(const el of body.querySelectorAll('.block-texts,.time-line'))el.style.top=`${layout.toY(Number(el.dataset.time))}px`;
    for(const b of layout.blocks){const el=body.querySelector(`.time-block[data-id="${b.id}"]`);el.style.top=`${layout.toY(b.start)+10}px`;el.style.height=`${layout.toY(end(b))-layout.toY(b.start)-20}px`;}
    body.style.height=`${layout.height}px`;
    for(const time of layout.nodes.slice(0,-1)){
      const area=[...body.querySelectorAll('.block-texts')].find(el=>Number(el.dataset.time)===time);
      const next=layout.nodes[layout.nodes.indexOf(time)+1], available=layout.toY(next)-layout.toY(time), needed=area?.offsetHeight||0;
      shifts.push({time,extra});if(needed+8>available)extra+=needed+8-available;
    }
    shifts.push({time:layout.nodes.at(-1),extra});
    const y=t=>layout.toY(t)+(shifts.find(s=>s.time===t)?.extra||0);
    if(extra){for(const b of layout.blocks){const block=body.querySelector(`.time-block[data-id="${b.id}"]`);block.style.top=`${y(b.start)+10}px`;block.style.height=`${y(end(b))-y(b.start)-20}px`;}
      for(const el of body.querySelectorAll('.block-texts,.time-line'))el.style.top=`${y(Number(el.dataset.time))}px`;
      body.style.height=`${layout.height+extra}px`;
    }
    const runs=environmentRuns(doc.blocks.filter(b=>b.object===primaryObject(doc))).filter(r=>r.start<layout.nodes.at(-1)&&r.end>layout.nodes[0]);
    [...body.querySelectorAll('.env-run')].forEach((el,i)=>{const r=runs[i];el.style.top=`${y(Math.max(r.start,layout.nodes[0]))+7}px`;el.style.height=`${y(Math.min(r.end,layout.nodes.at(-1)))-y(Math.max(r.start,layout.nodes[0]))-14}px`;});
    body._mapping={nodes:layout.nodes,ys:layout.nodes.map(y)};
  }
}
function bodyTime(body,clientY){const m=body._mapping, pos=(clientY-body.getBoundingClientRect().top)/zoom;if(!m?.nodes.length)return 0;for(let i=1;i<m.nodes.length;i++)if(pos<=m.ys[i])return m.nodes[i-1]+(pos-m.ys[i-1])/(m.ys[i]-m.ys[i-1])*(m.nodes[i]-m.nodes[i-1]);const i=m.nodes.length-1;return i>0?m.nodes[i]+(pos-m.ys[i])/(m.ys[i]-m.ys[i-1])*(m.nodes[i]-m.nodes[i-1]):m.nodes[0];}
function nearestTime(body,clientY,duration=0){const time=bodyTime(body,clientY);const nodes=[...new Set(endpoints(doc).flatMap(t=>[t,t-duration]))].filter(t=>t>=0);return nodes.reduce((a,b)=>Math.abs(b-time)<Math.abs(a-time)?b:a,0);}
function newBlock(lane,group){return {id:uid(),lane,group,start:0,duration:lane==='wait'?1800:300,text:'',environment:'',object:'样本'};}
function chooseEnvironment(ids){
  environmentTargetIds=ids.filter(id=>doc.blocks.some(b=>b.id===id));if(!environmentTargetIds.length){toast('请先添加时间块，再拖入环境块');return;}
  $('#environmentChoices').innerHTML=doc.environmentTerms.map((term,index)=>`<button data-environment-choice="${index}">${esc(term)}</button>`).join('')||'<p>请先在设置中添加环境词条。</p>';
  $('#environmentDialog').showModal();
}
function environmentBlockAt(body,clientY){const time=bodyTime(body,clientY),blocks=doc.blocks.filter(b=>b.group===body.dataset.group&&b.object===primaryObject(doc)).sort((a,b)=>(a.lane==='wait'?0:1)-(b.lane==='wait'?0:1)||a.start-b.start);return blocks.find(b=>b.start<=time&&end(b)>time)||blocks.at(-1);}
function addComponent(type,group=activeGroup,time){
  finishEdit();
  if(type==='group'){const id=uid();mutate(d=>d.groups.push({id,title:'新大步骤',collapsed:false}));activeGroup=id;return;}
  if(!group){toast('请先添加一个大步骤容器');return;}
  if(type==='environment'){const b=doc.blocks.find(b=>b.id===selected)||doc.blocks.find(b=>b.group===group&&b.object===primaryObject(doc));chooseEnvironment(b?[b.id]:[]);return;}
  if(type==='note'){mutate(d=>d.notes.push({id:uid(),group,text:'点击输入备注'}));return;}
  const blocks=doc.blocks.filter(b=>b.group===group), groupEnd=blocks.length?Math.max(...blocks.map(end)):total(doc),wait=blocks.find(b=>b.lane==='wait'&&!doc.blocks.some(o=>o.lane==='operation'&&o.start<=b.start&&end(o)>b.start));
  const target=time??(type==='operation'&&wait?wait.start:groupEnd), b=newBlock(type,group);
  let next=time===undefined?addBlock(doc,b,target):insertBlock(doc,b,target);if(next.error&&time===undefined)next=insertBlock(doc,b,groupEnd);if(commit(next)){select(b.id);requestAnimationFrame(()=>paper.querySelector(`[data-text="${b.id}"]`)?.focus());}
}
paper.addEventListener('focusin',e=>{const el=e.target;if(el.matches('[contenteditable],.metadata input,.duration')){if(!editSnapshot)editSnapshot=clone(doc);}const section=el.closest('.step-group');if(section)activeGroup=section.dataset.group;});
paper.addEventListener('input',e=>{
  const el=e.target;if(el.dataset.duration)return;
  if(el.dataset.doc)doc[el.dataset.doc]=el.value??el.textContent;
  if(el.dataset.groupTitle)doc.groups.find(g=>g.id===el.dataset.groupTitle).title=el.textContent;
  if(el.dataset.text)doc.blocks.find(b=>b.id===el.dataset.text).text=safeHTML(el.innerHTML);
  if(el.dataset.note)doc.notes.find(n=>n.id===el.dataset.note).text=el.textContent;
  if(el.dataset.text)requestAnimationFrame(()=>{measureText();applyZoom();});
  persist();
});
paper.addEventListener('focusout',e=>{
  const el=e.target;
  if(el.dataset.duration){const b=doc.blocks.find(b=>b.id===el.dataset.duration),duration=parseDuration(el.value);finishEdit();if(duration===null){el.value=formatDuration(b.duration);toast('请输入 5 min、30 min 或 2 h（1 秒至 7 天）');}else commit(resizeBlock(doc,b.id,duration));return;}
  if(el.matches('[contenteditable],.metadata input')){finishEdit();needsRefresh=true;setTimeout(refreshAfterEdit,0);}
});
paper.addEventListener('keydown',e=>{if(e.target.dataset.duration&&e.key==='Enter'){e.preventDefault();e.target.blur();}});
paper.addEventListener('paste',e=>{if(!e.target.matches('[contenteditable]'))return;e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));});
paper.addEventListener('click',e=>{
  const el=e.target, b=el.closest('.time-block');if(b)select(b.dataset.id);
  if(el.dataset.select)select(el.dataset.select);
  if(el.dataset.editEnvironment)chooseEnvironment(el.dataset.editEnvironment.split(','));
  if(el.dataset.collapse)mutate(d=>{const g=d.groups.find(g=>g.id===el.dataset.collapse);g.collapsed=!g.collapsed;});
  if(el.dataset.removeGroup)commit(deleteGroup(doc,el.dataset.removeGroup),'已删除大步骤及其内容，Ctrl+Z 可撤销');
  if(el.dataset.removeNote)mutate(d=>d.notes=d.notes.filter(n=>n.id!==el.dataset.removeNote));
  const group=el.closest('.step-group');if(group)activeGroup=group.dataset.group;
});
document.querySelectorAll('[data-component]').forEach(el=>{el.addEventListener('click',()=>addComponent(el.dataset.component));el.addEventListener('dragstart',e=>{finishEdit();drag={type:el.dataset.component};e.dataTransfer.setData('text/plain',el.dataset.component);e.dataTransfer.effectAllowed='copy';});});
paper.addEventListener('dragstart',e=>{
  if(e.target.closest('input,[contenteditable],.resize')){e.preventDefault();return;}
  finishEdit();const grip=e.target.closest('[data-group-drag]'),b=e.target.closest('.time-block');
  if(grip)drag={group:grip.dataset.groupDrag};else if(b){drag={id:b.dataset.id,type:doc.blocks.find(x=>x.id===b.dataset.id).lane};select(b.dataset.id);}else return;
  e.dataTransfer.setData('text/plain',JSON.stringify(drag));e.dataTransfer.effectAllowed='move';
});
function clearGuide(){paper.querySelectorAll('.drop-guide').forEach(el=>el.remove());}
paper.addEventListener('dragover',e=>{
  if(!drag)return;e.preventDefault();clearGuide();const body=e.target.closest('.timeline-body');if(!body||drag.group||drag.type==='group'||drag.type==='note')return;
  if(drag.type==='environment'){const b=environmentBlockAt(body,e.clientY),valid=e.clientX>=body.getBoundingClientRect().right-doc.layout.environmentWidth*zoom&&b,guide=document.createElement('div');guide.className=`drop-guide${valid?'':' invalid'}`;const m=body._mapping;guide.style.top=`${b?m.ys[m.nodes.indexOf(b.start)]:0}px`;guide.innerHTML=`<span>${valid?'放入环境块 · 选择词条':'请拖到最右侧环境区'}</span>`;body.append(guide);return;}
  const x=(e.clientX-body.getBoundingClientRect().left)/zoom,l=doc.layout,lane=x<l.waitWidth?'wait':x>=l.waitWidth+l.laneGap&&x<l.waitWidth+l.laneGap+l.operationWidth?'operation':null;
  const b=drag.id?{...doc.blocks.find(b=>b.id===drag.id),group:body.dataset.group}:newBlock(drag.type,body.dataset.group),time=nearestTime(body,e.clientY,b.duration);
  const next=drag.id?moveBlock(doc,b.id,body.dataset.group,time):insertBlock(doc,b,time),valid=lane===drag.type&&!next.error;
  const m=body._mapping,index=m?.nodes.indexOf(time);let y=index>=0?m.ys[index]:0;if(index<0&&m)for(let i=1;i<m.nodes.length;i++)if(time>=m.nodes[i-1]&&time<=m.nodes[i])y=m.ys[i-1]+(time-m.nodes[i-1])/(m.nodes[i]-m.nodes[i-1])*(m.ys[i]-m.ys[i-1]);const guide=document.createElement('div');guide.className=`drop-guide${valid?'':' invalid'}`;guide.style.top=`${y}px`;guide.innerHTML=`<span>${valid?'吸附':'冲突'} · ${formatDuration(time)}${lane!==drag.type?' · 请放入对应泳道':''}</span>`;body.append(guide);
});
paper.addEventListener('drop',e=>{
  if(!drag)return;e.preventDefault();clearGuide();const target=e.target.closest('.step-group'),body=e.target.closest('.timeline-body'),group=target?.dataset.group||activeGroup;
  if(drag.group){commit(reorderGroup(doc,drag.group,target?.dataset.group));}
  else if(drag.type==='group'||drag.type==='note')addComponent(drag.type,group);
  else if(drag.type==='environment'&&body){if(e.clientX<body.getBoundingClientRect().right-doc.layout.environmentWidth*zoom)toast('环境块只能放入最右侧环境区');else {const b=environmentBlockAt(body,e.clientY);chooseEnvironment(b?[b.id]:[]);}}
  else if(body){const x=(e.clientX-body.getBoundingClientRect().left)/zoom,l=doc.layout,lane=x<l.waitWidth?'wait':x>=l.waitWidth+l.laneGap&&x<l.waitWidth+l.laneGap+l.operationWidth?'operation':null;if(lane!==drag.type)toast('时间块只能放入对应的操作或等待泳道');else {const duration=drag.id?doc.blocks.find(b=>b.id===drag.id).duration:drag.type==='wait'?1800:300,t=nearestTime(body,e.clientY,duration);if(drag.id)commit(moveBlock(doc,drag.id,group,t));else addComponent(drag.type,group,t);}}
  drag=null;
});
document.addEventListener('dragend',()=>{drag=null;pointerHeld=false;clearGuide();setTimeout(refreshAfterEdit,0);});
paper.addEventListener('pointerdown',e=>{
  const handle=e.target.closest('[data-resize]');if(!handle)return;e.preventDefault();finishEdit();select(handle.dataset.resize);
  const before=clone(doc),b=before.blocks.find(b=>b.id===handle.dataset.resize),body=handle.closest('.timeline-body'),startY=e.clientY,atEnd=bodyTime(body,e.clientY);let final={doc:before};
  handle.setPointerCapture(e.pointerId);
  const move=event=>{const now=bodyTime(body,event.clientY), requested=b.duration+Math.round((now-atEnd)/60)*60;final=resizeBlock(before,b.id,requested);const current=final.doc.blocks.find(x=>x.id===b.id);handle.parentElement.querySelector('input').value=formatDuration(current.duration);let guide=body.querySelector('.drop-guide');if(!guide){guide=document.createElement('div');body.append(guide);}guide.className=`drop-guide${final.limited?' invalid':''}`;guide.style.top=`${Math.max(0,(event.clientY-body.getBoundingClientRect().top)/zoom)}px`;guide.innerHTML=`<span>${formatDuration(current.duration)}${final.limited?' · 已限制到合法边界':''}</span>`;};
  const up=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',cancel);clearGuide();if(Math.abs(lastY-startY)>2)commit(final);else render();};
  let lastY=startY;const track=e=>{lastY=e.clientY;move(e);};
  // Keep the model snapshot immutable throughout one gesture (one undo entry).
  const cancel=()=>{handle.removeEventListener('pointermove',track);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',cancel);render();};
  const finish=()=>{handle.removeEventListener('pointermove',track);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',cancel);up();};
  handle.addEventListener('pointermove',track);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',cancel);
});
function copy(){const b=doc.blocks.find(b=>b.id===selected);if(b){clipboard=clone(b);toast('已复制时间块，点击粘贴添加');}}
function paste(){if(!clipboard){toast('请先复制一个时间块');return;}const b={...clipboard,id:uid(),group:activeGroup},target=doc.blocks.find(b=>b.id===selected);const next=addBlock(doc,b,target?end(target):total(doc));if(commit(next))select(b.id);}
function remove(){if(selected){const id=selected;if(commit(deleteBlock(doc,id)))select(null);}}
$('#copy').onclick=copy;$('#paste').onclick=paste;$('#delete').onclick=remove;$('#undo').onclick=undo;$('#redo').onclick=redo;
for(const [id,command] of [['bold','bold'],['italic','italic']]){$(`#${id}`).addEventListener('mousedown',e=>e.preventDefault());$(`#${id}`).onclick=()=>{document.execCommand(command);const el=document.activeElement;if(el?.dataset.text)el.dispatchEvent(new Event('input',{bubbles:true}));};}
$('#zoomIn').onclick=()=>setZoom(zoom+.1);$('#zoomOut').onclick=()=>setZoom(zoom-.1);$('#zoomReset').onclick=()=>setZoom(1);$('#fit').onclick=fit;
viewport.addEventListener('wheel',e=>{if(e.ctrlKey){e.preventDefault();setZoom(zoom+(e.deltaY<0?.05:-.05));}},{passive:false});
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();document.activeElement?.blur();saveFile(e.shiftKey);return;}
  const editing=e.target.matches('input,textarea,select,[contenteditable]');if(editing)return;
  if(e.code==='Space'){space=true;e.preventDefault();viewport.style.cursor='grab';}
  if(e.ctrlKey||e.metaKey){const key=e.key.toLowerCase();if(['z','y','c','v','s'].includes(key))e.preventDefault();if(key==='z')e.shiftKey?redo():undo();if(key==='y')redo();if(key==='c')copy();if(key==='v')paste();if(key==='s')saveFile(false);}
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();remove();}
});
document.addEventListener('keyup',e=>{if(e.code==='Space'){space=false;viewport.style.cursor='';}});window.addEventListener('blur',()=>space=false);
viewport.addEventListener('pointerdown',e=>{if(!space)return;e.preventDefault();const x=e.clientX,y=e.clientY,left=viewport.scrollLeft,top=viewport.scrollTop;viewport.classList.add('panning');viewport.setPointerCapture(e.pointerId);const move=ev=>{viewport.scrollLeft=left-(ev.clientX-x);viewport.scrollTop=top-(ev.clientY-y);};const up=()=>{viewport.classList.remove('panning');viewport.removeEventListener('pointermove',move);viewport.removeEventListener('pointerup',up);viewport.removeEventListener('pointercancel',up);};viewport.addEventListener('pointermove',move);viewport.addEventListener('pointerup',up);viewport.addEventListener('pointercancel',up);});
function toggleSettings(show){$('.workspace').classList.toggle('settings-hidden',!show);$('#settingsToggle').setAttribute('aria-expanded',String(show));}
$('#settingsToggle').onclick=()=>toggleSettings($('.workspace').classList.contains('settings-hidden'));$('#settingsClose').onclick=()=>toggleSettings(false);
$('#settingFields').addEventListener('input',e=>{const el=e.target;if(!el.dataset.setting)return;if(!editSnapshot)editSnapshot=clone(doc);doc.layout[el.dataset.setting]=el.type==='range'?Number(el.value):el.value;if(el.type==='range')el.nextElementSibling.value=`${el.value} px`;});
$('#settingFields').addEventListener('change',e=>{if(e.target.dataset.setting){finishEdit();render();}});
$('#settingFields').addEventListener('submit',e=>{if(e.target.id!=='environmentTermForm')return;e.preventDefault();const term=$('#environmentTermInput').value.trim();if(!term){toast('请输入环境词条');return;}if(doc.environmentTerms.includes(term)){toast('这个环境词条已存在');return;}if(doc.environmentTerms.length>=100){toast('最多添加 100 个环境词条');return;}mutate(d=>d.environmentTerms.push(term));});
$('#settingFields').addEventListener('click',e=>{if(e.target.dataset.removeTerm!==undefined)mutate(d=>d.environmentTerms.splice(Number(e.target.dataset.removeTerm),1));});
$('#environmentChoices').addEventListener('click',e=>{const index=e.target.dataset.environmentChoice;if(index===undefined)return;const term=doc.environmentTerms[Number(index)];if(term===undefined)return;mutate(d=>{for(const b of d.blocks)if(environmentTargetIds.includes(b.id))b.environment=term;});$('#environmentDialog').close();});
$('#clearEnvironment').onclick=()=>{mutate(d=>{for(const b of d.blocks)if(environmentTargetIds.includes(b.id))b.environment='';});$('#environmentDialog').close();};
$('#resetLayout').onclick=()=>mutate(d=>d.layout={...defaults});$('#saveDefaults').onclick=()=>{try{localStorage.setItem(`${storageKey}.defaults`,JSON.stringify(doc.layout));toast('已设为新 SOP 的默认布局');}catch{toast('浏览器无法保存默认布局');}};
$('#help').onclick=()=>$('#helpDialog').showModal();
$('#new').onclick=()=>{finishEdit();if(!confirm('新建空白 SOP？当前内容可用撤销恢复；建议先保存原始文件。'))return;const next=emptyDocument();next.environmentTerms=[...doc.environmentTerms];try{const saved=localStorage.getItem(`${storageKey}.defaults`);if(saved)next.layout=importDocument(JSON.stringify({...next,layout:JSON.parse(saved)})).layout;}catch{}fileHandle=null;commit({doc:next});activeGroup=doc.groups[0].id;};
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
async function saveFile(asNew){finishEdit();const blob=new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}),name=`${doc.name.replace(/[\\/:*?"<>|]/g,'_')||'实验SOP'}.soptime`;
  try{if(window.showSaveFilePicker){if(!fileHandle||asNew)fileHandle=await window.showSaveFilePicker({suggestedName:name,types:[{description:'SOP 时间轴',accept:{'application/json':['.soptime']}}]});const stream=await fileHandle.createWritable();await stream.write(blob);await stream.close();}else download(blob,name);toast('已保存可编辑的 .soptime 原始文件');}catch(error){if(error.name!=='AbortError')toast(`保存失败：${error.message}`);}}
$('#save').onclick=()=>saveFile(false);$('#saveAs').onclick=()=>saveFile(true);$('#open').onclick=()=>$('#fileInput').click();
$('#fileInput').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>5000000)throw new Error('文件不能超过 5 MB');const next=importDocument(await file.text());if(commit({doc:next},'已打开原始文件，可继续编辑')){fileHandle=null;activeGroup=doc.groups[0]?.id;}}catch(error){toast(`无法打开：${error.message}`);}e.target.value='';};
$('#png').onclick=async()=>{finishEdit();$('#png').disabled=true;try{const scale=await exportPNG(doc);toast(`已导出完整时间轴 PNG（${Number(scale.toFixed(2))}× 分辨率）`);}catch(error){toast(`PNG 导出失败：${error.message}`);}finally{$('#png').disabled=false;}};
$('#pdf').onclick=()=>{finishEdit();try{printPDF(doc);}catch(error){toast(error.message);}};
window.addEventListener('beforeunload',()=>{finishEdit();persist();});
render();requestAnimationFrame(fit);if(recoveryMessage)toast(recoveryMessage);
