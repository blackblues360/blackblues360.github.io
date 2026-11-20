import {execute} from './core.mjs?v=20261120.3';
import {storageBoxes} from './storage.mjs?v=20261120.3';

export const inventoryColumns=[
  {key:'name',label:'细胞 / 冻存管名称',aliases:['细胞名称','冻存管名称','名称','细胞','name','cellname']},
  {key:'code',label:'原管号',aliases:['管号','原管号','冻存管编号','编号','code','tubeid']},
  {key:'coordinate',label:'格位（如 A1）',aliases:['格位','坐标','孔位','coordinate','slot','position']},
  {key:'row',label:'行（坐标分列时）',aliases:['行','行号','row']},
  {key:'column',label:'列（坐标分列时）',aliases:['列','列号','column','col']},
  {key:'box',label:'冻存盒（可选，留空使用目标盒）',aliases:['冻存盒','冻存盒路径','盒路径','盒编号','盒','box','boxpath']},
  {key:'passage',label:'P 数',aliases:['p数','传代数','传代次数','p','passage']},
  {key:'frozenDate',label:'实际冻存日期',aliases:['实际冻存日期','冻存日期','日期','frozendate','freezedate']},
  {key:'quantity',label:'每管数量',aliases:['每管数量','细胞数','数量','quantity','count']},
  {key:'unit',label:'数量单位',aliases:['数量单位','单位','unit']},
  {key:'cryoprotectant',label:'冻存液',aliases:['冻存液','cryoprotectant']},
  {key:'cellLine',label:'所属细胞系',aliases:['所属细胞系','细胞系','cellline']},
  {key:'source',label:'来源',aliases:['来源','source']},
  {key:'note',label:'备注',aliases:['备注','说明','note','notes']}
];

export function parseInventoryTable(input){
  if(typeof input!=='string'||input.length>2000000)throw Error('表格内容不能超过 2,000,000 字符');
  const text=input.replace(/^\ufeff/,'').replace(/\r\n?/g,'\n');
  if(!text.trim())throw Error('请选择 CSV / TSV 文件，或粘贴包含表头的表格');
  const counts={',':0,'\t':0,';':0};let quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){i++;continue;}quoted=!quoted;}
    if(!quoted&&c==='\n')break;
    if(!quoted&&c in counts)counts[c]++;
  }
  const separator=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0],records=[];
  let values=[],value='',inside=false,closed=false,line=1,start=1;
  for(let i=0;i<=text.length;i++){
    const c=text[i];
    if(inside){
      if(c===undefined)throw Error(`第 ${start} 行的引号没有闭合`);
      if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{inside=false;closed=true;}}
      else{value+=c;if(c==='\n')line++;}continue;
    }
    if(c===separator||c==='\n'||c===undefined){
      values.push(value);value='';closed=false;
      if(c!==separator){if(values.some(v=>v.trim()))records.push({line:start,values});values=[];if(records.length>501)throw Error('每次最多导入 500 支冻存管，请分批处理');if(c==='\n')line++;start=line;}
    }else if(closed){if(!/[ \t]/.test(c))throw Error(`第 ${line} 行的引号后存在额外内容`);}
    else if(c==='"'){if(value)throw Error(`第 ${line} 行的引号位置无效`);inside=true;}
    else value+=c;
  }
  if(records.length<2)throw Error('表格需要表头和至少一支冻存管的数据');
  const headers=records[0].values.map(v=>v.trim());if(headers.length>80)throw Error('表格列数不能超过 80');
  const rows=records.slice(1).map(record=>{
    if(record.values.length>headers.length)throw Error(`第 ${record.line} 行的列数超过表头，请检查分隔符或引号`);
    return {...record,values:Array.from({length:headers.length},(_,i)=>record.values[i]?.trim()||'')};
  });
  return {headers,rows};
}

export function suggestInventoryMapping(headers){
  const normal=value=>value.toLowerCase().replace(/[\s_\-（）()]/g,'');
  const mapping=Object.fromEntries(inventoryColumns.map(field=>[field.key,headers.findIndex(header=>[field.key,field.label,...field.aliases].some(alias=>normal(alias)===normal(header)))]));
  if(mapping.name<0&&mapping.cellLine>=0){mapping.name=mapping.cellLine;mapping.cellLine=-1;}
  return mapping;
}

export function previewInventoryImport(db,table,mapping,options){
  if(inventoryColumns.some(f=>mapping[f.key]!==undefined&&(!Number.isInteger(mapping[f.key])||mapping[f.key]<-1)))throw Error('字段对应无效，请重新读取表头');
  const mapped=inventoryColumns.filter(f=>Number.isInteger(mapping[f.key])&&mapping[f.key]>=0);
  if(mapped.some(f=>mapping[f.key]>=table.headers.length))throw Error('字段对应的列已不存在，请重新读取表头');
  if(new Set(mapped.map(f=>mapping[f.key])).size!==mapped.length)throw Error('同一列不能对应多个字段');
  if(!(mapping.name>=0)||!(mapping.coordinate>=0)&&!(mapping.row>=0&&mapping.column>=0))throw Error('请对应名称列，以及格位列（或行、列两列）');
  if(!['error','skip-matching'].includes(options.duplicates))throw Error('重复记录处理方式无效');
  const boxes=storageBoxes(db).filter(b=>b.kind==='cell'),lines=db.entities.filter(e=>e.type==='cell'&&e.subtype==='细胞系');
  const get=(record,key)=>mapping[key]>=0?record.values[mapping[key]]||'':'';
  const unknown=value=>!value||/^(未知|不详|未记录|unknown|n\/?a|\?)$/i.test(value);
  const records=table.rows.map(record=>{
    const result={sourceRow:record.line,status:'ready',errors:[],data:null};
    try{
      const boxText=get(record,'box');let box;
      if(boxText){const matches=boxes.filter(b=>[b.path,b.name,b.code].includes(boxText));if(matches.length!==1)throw Error('冻存盒不存在或名称不唯一，请填写已建档的完整盒路径');box=matches[0];}
      else box=boxes.find(b=>b.id===options.boxId);
      if(!box)throw Error('请选择已建档的目标细胞冻存盒');
      const position=get(record,'coordinate').toUpperCase().replace(/[\s-]/g,'');let coordinate='';
      if(position){const match=/^([A-Z])0*([1-9]\d*)$/.exec(position);if(!match)throw Error('格位应为 A1、B2 这样的坐标');coordinate=match[1]+Number(match[2]);}
      const row=get(record,'row').toUpperCase(),column=get(record,'column');
      if(row||column){const letter=/^[1-9]\d*$/.test(row)?String.fromCharCode(64+Number(row)):row;if(!/^[A-Z]$/.test(letter)||!/^0*[1-9]\d*$/.test(column))throw Error('行应为 A、B 或 1、2；列应为正整数');const split=letter+Number(column);if(coordinate&&coordinate!==split)throw Error('格位与行列两列不一致');coordinate=split;}
      if(!coordinate)throw Error('请填写格位，或完整的行、列');
      const passageText=get(record,'passage').replace(/^P\s*/i,''),passage=unknown(passageText)?null:Number(passageText);
      const dateText=get(record,'frozenDate');let frozenDate='';
      if(!unknown(dateText)){const match=/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/.exec(dateText);if(!match)throw Error('冻存日期请使用 YYYY-MM-DD，未知可留空');frozenDate=match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');}
      const lineText=get(record,'cellLine');let cellLineId=options.cellLineId||undefined;
      if(!unknown(lineText)){const matches=lines.filter(l=>l.code===lineText||l.name===lineText);if(matches.length!==1)throw Error('所属细胞系不存在或名称不唯一，请先建档或暂不对应此列');cellLineId=matches[0].id;}
      const quantityText=get(record,'quantity'),quantity=unknown(quantityText)?'':quantityText;
      result.data={name:get(record,'name'),code:get(record,'code'),location:box.path+'/'+coordinate,passage,quantity,unit:get(record,'unit'),cellLineId,
        attributes:{frozenDate,cryoprotectant:get(record,'cryoprotectant'),source:get(record,'source')},note:get(record,'note')};
      if(result.data.name.length>120||result.data.code.length>80||result.data.note.length>2000)throw Error('名称、管号或备注超过允许长度');
    }catch(error){result.status='error';result.errors.push(error.message);}
    return result;
  });
  const codes=new Map(),positions=new Map();
  for(const row of records){if(!row.data)continue;for(const [value,index,label] of [[row.data.code,codes,'管号'],[row.data.location,positions,'格位']]){
    if(!value)continue;const prior=index.get(value);if(prior){row.status=prior.status='error';row.errors.push(`与第 ${prior.sourceRow} 行的${label}重复`);prior.errors.push(`与第 ${row.sourceRow} 行的${label}重复`);}else index.set(value,row);
  }}
  let next=db;
  for(const row of records){
    if(row.status==='error')continue;
    try{
      const item=row.data,existing=item.code?db.entities.find(e=>e.code===item.code):null;
      if(existing&&options.duplicates==='skip-matching'){
        const same=existing.type==='cell'&&existing.subtype==='冻存管'&&existing.status==='stored'&&existing.name===item.name&&existing.location===item.location
          &&(item.passage===null||item.passage===existing.passage)&&(!item.cellLineId||item.cellLineId===existing.cellLineId)
          &&(item.quantity===''||Number(item.quantity)===existing.quantity&&item.unit===existing.unit)
          &&(!item.unit||item.unit===existing.unit)&&(!item.note||db.events.some(e=>e.entityIds[0]===existing.id&&e.note===item.note))
          &&Object.entries(item.attributes).every(([key,value])=>!value||value===existing.attributes?.[key]);
        if(!same)throw Error('已有同管号记录的名称、位置或已填信息不同，请核对，不能直接跳过');
        row.status='skip';row.code=existing.code;continue;
      }
      next=execute(next,{type:'inventory-register',data:{...item,at:options.at}},'import-preview');row.code=next.entities.at(-1).code;
    }catch(error){row.status='error';row.errors.push(error.message);}
  }
  return {rows:records,items:records.filter(r=>r.status==='ready').map(r=>({sourceRow:r.sourceRow,data:r.data})),skippedRows:records.filter(r=>r.status==='skip').map(r=>r.sourceRow),errors:records.filter(r=>r.status==='error')};
}

export function inventoryTemplate(){
  return '\ufeff细胞名称,管号,格位,P数,实际冻存日期,每管数量,数量单位,冻存液,所属细胞系,来源,备注\r\n';
}
