export async function readInventoryWorkbook(buffer){
  if(buffer.byteLength>2000000)throw Error('文件不能超过 2 MB');
  const bytes=new Uint8Array(buffer);
  if(!(bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===3&&bytes[3]===4)&&![0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((b,i)=>bytes[i]===b))throw Error('文件不是有效的 XLSX / XLS 工作簿');
  const XLSX=await import('./vendor/sheetjs-0.20.3.mjs');
  try{return XLSX.read(buffer,{type:'array',cellNF:true,cellFormula:true,sheetRows:502});}
  catch{throw Error('无法读取工作簿，请确认文件未加密且为有效的 XLSX / XLS 文件');}
}

export async function inventoryWorksheetText(workbook,sheetName){
  const XLSX=await import('./vendor/sheetjs-0.20.3.mjs'),sheet=workbook.Sheets[sheetName];
  if(!sheet||!workbook.SheetNames.includes(sheetName))throw Error('工作表不存在');
  if(sheet['!merges']?.length)throw Error('工作表含合并单元格，请取消合并并逐格确认内容后再导入');
  if(!sheet['!ref'])throw Error('所选工作表为空');
  const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']);
  if(range.e.r>500||range.e.c>79)throw Error('工作表超出 501 行或 80 列，请拆分并移除多余格式区域');
  const rows=[];
  for(let r=0;r<=range.e.r;r++){
    const row=[];
    for(let c=0;c<=range.e.c;c++){
      const address=XLSX.utils.encode_cell({r,c}),cell=sheet[address];let value='';
      if(cell?.f)throw Error(`工作表 ${address} 含公式，请先复制并粘贴为值后导入`);
      if(cell?.t==='e')throw Error(`工作表 ${address} 含错误值，请先修正`);
      if(cell?.v!==undefined&&cell.v!==null){
        if(cell.t==='n'&&XLSX.SSF.is_date(cell.z||'')){
          const date=XLSX.SSF.parse_date_code(cell.v,{date1904:!!workbook.Workbook?.WBProps?.date1904});
          if(!date||date.y<1900||date.m<1||date.d<1||date.y===1900&&date.m===2&&date.d===29)throw Error(`工作表 ${address} 日期无效`);
          value=`${date.y}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}`;
        }else value=cell.w??String(cell.v);
      }
      row.push('"'+String(value).replaceAll('"','""')+'"');
    }
    rows.push(row.join('\t'));
  }
  return rows.join('\n');
}
