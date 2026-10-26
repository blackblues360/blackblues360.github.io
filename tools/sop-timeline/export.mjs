import {end,total,formatDuration,environmentRuns,primaryObject} from './core.mjs?v=3';
const W=744,esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const text=(x,y,value,size=13,color='#3f506f',extra='')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" ${extra}>${esc(value)}</text>`;
function richTokens(html){const template=document.createElement('template');template.innerHTML=html;const tokens=[];function walk(node,bold=false,italic=false){if(node.nodeType===3){for(const char of node.textContent)tokens.push({char,bold,italic});return;}if(node.nodeType!==1&&node.nodeType!==11)return;const tag=node.tagName?.toLowerCase();if(['script','style','iframe','object'].includes(tag))return;if(tag==='br')tokens.push({char:'\n'});for(const child of node.childNodes)walk(child,bold||['b','strong'].includes(tag),italic||['i','em'].includes(tag));if(['div','p'].includes(tag))tokens.push({char:'\n'});}walk(template.content);return tokens;}
function wrap(html,width,size,ctx){const lines=[[]];let length=0;for(const token of richTokens(html)){ctx.font=`${token.italic?'italic ':''}${token.bold?'bold ':''}${size}px "Microsoft YaHei", sans-serif`;const w=ctx.measureText(token.char).width;if(token.char==='\n'||length+w>width){lines.push([]);length=0;if(token.char==='\n')continue;}lines.at(-1).push(token);length+=w;}return lines;}
function richLine(x,y,tokens,size){return `<text x="${x}" y="${y}" font-size="${size}" fill="#3f506f">${tokens.map(t=>`<tspan${t.bold?' font-weight="700"':''}${t.italic?' font-style="italic"':''}>${esc(t.char)}</tspan>`).join('')}</text>`;}
function diagram(doc){
  const l=doc.layout,op=l.operationWidth,wait=l.waitWidth,gap=l.laneGap,env=l.environmentWidth,tx=op+wait+gap*2,tw=W-tx-env,ctx=document.createElement('canvas').getContext('2d'),groups=[];
  for(const [index,g] of doc.groups.entries()){
    const blocks=doc.blocks.filter(b=>b.group===g.id),nodes=[...new Set(blocks.flatMap(b=>[b.start,end(b)]))].sort((a,b)=>a-b),positions=new Map(),descriptions=[],baselines=[];let y=0;
    for(let i=0;i<nodes.length;i++){
      positions.set(nodes[i],y);if(i===nodes.length-1)break;
      const simultaneous=blocks.filter(b=>b.start===nodes[i]).sort((a,b)=>(a.lane==='wait'?0:1)-(b.lane==='wait'?0:1)),textWidth=(tw-28)/Math.max(1,simultaneous.length);let textY=y+24;
      simultaneous.forEach((b,index)=>{let lineY=y+24;const x=tx+14+index*textWidth,lines=wrap(b.text||'（未填写实验操作）',textWidth-12,l.fontSize,ctx);for(const line of lines){descriptions.push(richLine(x,lineY,line,l.fontSize));baselines.push(lineY);lineY+=25;}textY=Math.max(textY,lineY+10);});
      y=Math.max(y+72+l.spacing,y+Math.min(126,48+Math.log2((nodes[i+1]-nodes[i])/60+1)*12),textY+7);
    }
    if(!blocks.length){y=72;descriptions.push(text(W/2,42,'空步骤 · 尚未添加时间块',12,'#9aa7bb','text-anchor="middle"'));}
    const notes=doc.notes.filter(n=>n.group===g.id);for(const note of notes){const lines=wrap(esc(note.text),W-44,12,ctx);descriptions.push(`<rect x="8" y="${y+8}" width="${W-16}" height="${lines.length*25+20}" rx="5" fill="#fff7e9"/>`);for(const [i,line]of lines.entries()){const baseline=y+32+i*25;descriptions.push(richLine(20,baseline,line,12));baselines.push(baseline);}y+=lines.length*25+36;}
    groups.push({id:g.id,title:g.title,index,blocks,nodes,positions,height:y,descriptions,baselines});
  }return {doc,l,op,wait,gap,env,tx,tw,groups};
}
function columnHeader(d,y){const {op,wait,gap,env,tx,tw}=d;return `<rect y="${y}" width="${W}" height="36" rx="5" fill="#e9edf4"/>${text(wait/2,y+23,'等待',13,'#34435f','text-anchor="middle" font-weight="700"')}${text(wait+gap+op/2,y+23,'操作',13,'#34435f','text-anchor="middle" font-weight="700"')}${text(tx+tw/2,y+23,'实验操作',13,'#34435f','text-anchor="middle" font-weight="700"')}${text(W-env/2,y+23,'环境',13,'#34435f','text-anchor="middle" font-weight="700"')}`;}
function heading(d,page,pages){return `${text(5,29,d.doc.name,27,'#17233e','font-weight="700"')}${text(5,57,'SOP 实验流程',14)}${text(W-5,25,`${d.doc.revision} · ${d.doc.date}`,10,'#8290a3','text-anchor="end"')}${text(W-5,44,`作者：${d.doc.author||'—'}`,10,'#8290a3','text-anchor="end"')}${columnHeader(d,75)}${page?text(W-5,62,`${page} / ${pages}`,10,'#8290a3','text-anchor="end"'):''}`;}
function groupSlice(d,g,start,stop,offset,continuation){
  const {op,wait,gap,env,tx,l}=d,h=stop-start,clip=`clip-${g.index}-${start}`,y=t=>g.positions.get(t),theme=l.theme,opFill=theme==='sage'?'#dcebe5':theme==='lavender'?'#e6e0f6':'#d8e8fc';
  let shapes=`<rect x="0" y="${start}" width="${W}" height="${h}" fill="#fff"/><path d="M ${wait} ${start} V ${stop} M ${wait+gap+op} ${start} V ${stop} M ${W-env} ${start} V ${stop}" stroke="#dce4ef" stroke-dasharray="4 4"/>`;
  for(const t of g.nodes)shapes+=`<path d="M 0 ${y(t)} H ${W}" stroke="#edf1f6"/>`;
  for(const b of g.blocks){const top=y(b.start),bottom=y(end(b));if(bottom<=start||top>=stop)continue;const x=b.lane==='wait'?13:wait+gap+13,w=(b.lane==='operation'?op:wait)-26,sy=Math.max(start,top)+7,ey=Math.min(stop,bottom)-7;
    shapes+=`<rect x="${x}" y="${sy}" width="${w}" height="${Math.max(20,ey-sy)}" rx="6" fill="${b.lane==='operation'?opFill:'#ffe0bd'}" stroke="${b.lane==='operation'?'#a5c3e5':'#efbc88'}"/>${text(x+w/2,sy+21,`${top<start?'↳ ':''}${formatDuration(b.duration)}`,11,b.lane==='operation'?'#355b88':'#875635','text-anchor="middle" font-weight="700"')}`;
    if(bottom>stop)shapes+=text(x+w/2,ey-5,'续下页 ↓',9,'#8b9ab0','text-anchor="middle"');
  }
  for(const run of environmentRuns(d.doc.blocks.filter(b=>b.object===primaryObject(d.doc)))){
    if(!g.nodes.length)continue;const ts=Math.max(run.start,g.nodes[0]),te=Math.min(run.end,g.nodes.at(-1));if(ts>=te)continue;const top=y(ts),bottom=y(te);if(bottom<=start||top>=stop)continue;
    const sy=Math.max(start,top)+6,ey=Math.min(stop,bottom)-6,cold=/4|冰|避光/.test(run.environment),color=cold?'#9478bf':'#509d87';
    shapes+=`<rect x="${W-env+9}" y="${sy}" width="${env-18}" height="${Math.max(25,ey-sy)}" rx="6" fill="${cold?'#f0eafa':'#edf8f3'}"/>${text(W-env/2,sy+15,top<start||run.start<g.nodes[0]?'↑ 续':'↑',11,color,'text-anchor="middle"')}`;
    const lines=wrap(esc(run.environment),env-30,12,document.createElement('canvas').getContext('2d'));for(const [i,line]of lines.entries())shapes+=richLine(W-env+15,sy+35+i*19,line,12);
    shapes+=text(W-env/2,ey-4,bottom>stop||run.end>g.nodes.at(-1)?'续 ↓':'↓',11,color,'text-anchor="middle"');
  }
  shapes+=g.descriptions.join('');
  return `<g transform="translate(0 ${offset})"><rect width="${W}" height="40" rx="6" fill="${g.index%2?'#eee9fa':'#e9f1fd'}"/>${text(14,26,`${String(g.index+1).padStart(2,'0')}  ${g.title}${continuation?'（续）':''}`,16,'#293d61','font-weight="700"')}<defs><clipPath id="${clip}"><rect y="${start}" width="${W}" height="${h}"/></clipPath></defs><g transform="translate(0 ${40-start})"><g clip-path="url(#${clip})">${shapes}</g></g></g>`;
}
function svg(width,height,contents){return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Microsoft YaHei, Segoe UI, sans-serif"><rect width="100%" height="100%" fill="white"/>${contents}</svg>`;}
export async function exportPNG(doc){
  await document.fonts.ready;const d=diagram(doc);let y=130,content=heading(d);for(const g of d.groups){content+=groupSlice(d,g,0,g.height,y,false);y+=g.height+58;}content+=text(W/2,y+4,`总耗时 ${formatDuration(total(doc))} · SOP TIMELINE EDITOR`,11,'#8b99ab','text-anchor="middle"');
  const height=y+30,scale=Math.min(2,30000/height,Math.sqrt(64000000/(W*height)));if(scale<.5)throw new Error('流程过长，建议拆分后导出 PNG；PDF 可保持完整分页');
  const blob=new Blob([svg(W,height,content)],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(blob);try{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=Math.ceil(W*scale);canvas.height=Math.ceil(height*scale);const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.drawImage(image,0,0);const output=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!output)throw new Error('浏览器无法生成图片');const fileURL=URL.createObjectURL(output),a=document.createElement('a');a.href=fileURL;a.download=`${doc.name.replace(/[\\/:*?"<>|]/g,'_')}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(fileURL),10000);return scale;}finally{URL.revokeObjectURL(url);}
}
export function printPDF(doc){
  const win=window.open('','_blank');if(!win)throw new Error('请允许本网站打开打印窗口后重试');
  const d=diagram(doc),landscape=doc.layout.orientation==='landscape',pageHeight=landscape?515:1040,capacity=pageHeight-155,pages=[];let parts=[],used=0;
  const flush=()=>{if(parts.length){pages.push(parts);parts=[];used=0;}};
  for(const g of d.groups){let start=0;while(start<g.height){let available=capacity-used-50;if(available<90){flush();available=capacity-50;}
    let stop=Math.min(g.height,start+available);
    if(stop<g.height){const nodeCuts=[...g.positions.values()].filter(v=>v>start+50&&v<=stop);if(nodeCuts.length)stop=Math.max(...nodeCuts);else {const line=g.baselines.find(v=>v+5>stop&&v-20<stop);if(line!==undefined)stop=line-21;}}
    if(stop<=start){flush();continue;}
    parts.push({g,start,stop,offset:125+used});used+=stop-start+50;start=stop;if(start<g.height)flush();
  }}flush();if(!pages.length)pages.push([]);
  const rendered=pages.map((parts,i)=>`<section class="print-page">${svg(W,pageHeight,heading(d,i+1,pages.length)+parts.map(p=>groupSlice(d,p.g,p.start,p.stop,p.offset,p.start>0)).join('')+text(0,pageHeight-9,`总耗时 ${formatDuration(total(doc))} · ${doc.blocks.length} 个时间块`,10,'#8795a9')+text(W,pageHeight-9,`第 ${i+1} / ${pages.length} 页`,10,'#8795a9','text-anchor="end"'))}</section>`).join('');
  win.document.open();win.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(doc.name)} · SOP</title><style>@page{size:A4 ${landscape?'landscape':'portrait'};margin:12mm}*{box-sizing:border-box}body{margin:0;background:#e9edf4;font-family:"Microsoft YaHei",sans-serif}.print-page{width:${landscape?'273':'186'}mm;margin:15px auto;background:white;break-after:page;page-break-after:always}.print-page:last-child{break-after:auto;page-break-after:auto}svg{display:block;width:100%;height:auto}.controls{padding:16px;text-align:center;color:#586d8c}button{padding:10px 25px;border:0;border-radius:6px;background:#4f86df;color:white;cursor:pointer}@media print{body{background:white}.controls{display:none}.print-page{margin:0;max-height:${landscape?'186':'273'}mm}}</style></head><body><div class="controls"><button id="print">打印 / 另存为 PDF</button><p>A4 ${landscape?'横向':'纵向'} · ${pages.length} 页 · 建议关闭浏览器页眉页脚</p></div>${rendered}</body></html>`);win.document.close();win.document.getElementById('print').onclick=()=>win.print();win.document.fonts.ready.then(()=>setTimeout(()=>win.print(),300));
}
