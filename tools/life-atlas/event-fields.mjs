// Preset schemas are copied into each new event; later edits cannot reinterpret history.
const text = (key, label, required = false) => ({key, label, type:'text', required});
const number = (key, label, required = false, min = 0) => ({key, label, type:'number', required, min});
const select = (key, label, options, required = true) => ({key, label, type:'select', options, required});
const culture = [text('conditions','培养条件'), text('medium','培养基信息'), text('observation','观察结果')];
export function eventFields(type, module) {
  const fields = {
    '培养':culture, '换液':culture,
    '复苏':[text('conditions','培养条件'),text('container','培养容器')],
    '传代':[text('ratio','传代比例'),number('cellCount','细胞数量'),text('conditions','培养条件')],
    '冻存':module==='cell'
      ? [number('quantity','每管细胞数量 / 体积',true,Number.MIN_VALUE),text('unit','每管单位',true),text('cryoprotectant','冻存液',true)]
      : [text('temperature','保存温度 / 条件',true),text('cryoprotectant','冻存液')],
    '解冻':[text('conditions','解冻条件')],
    '给药':[text('drug','药物 / 处理名称',true),text('drugBatch','药物批次'),number('dose','剂量',true,Number.MIN_VALUE),text('doseUnit','剂量单位',true),text('route','给药途径',true),number('volume','给药体积'),text('volumeUnit','体积单位')],
    '荷瘤':[number('cellCount','接种细胞数量',true,Number.MIN_VALUE),number('volume','接种体积',true,Number.MIN_VALUE),text('volumeUnit','体积单位',true),text('site','接种部位',true)],
    '细胞回输':[number('cellCount','回输细胞数量',true,Number.MIN_VALUE),number('volume','回输体积',true,Number.MIN_VALUE),text('volumeUnit','体积单位',true),text('route','回输途径',true)],
    '基因分型':[text('method','检测方法',true),text('result','检测结果',true)],
    '体重测量':[number('value','体重（g）',true,Number.MIN_VALUE)],
    '肿瘤测量':[
      select('method','体积记录方式',['手动体积','长径×短径²/2']),
      number('value','体积（mm³，手动方式必填）'),
      number('length','长径（mm，计算方式必填）'),number('width','短径（mm，计算方式必填）')
    ],
    '分装':[number('quantity','每份数量',true,Number.MIN_VALUE),text('unit','计量单位',true),text('purpose','分装用途',true)],
    '提取':[select('productSubtype','提取产物',['RNA','DNA','蛋白','核酸']),text('method','方法 / 试剂盒',true),number('inputQuantity','输入数量'),number('quantity','输出数量',true,Number.MIN_VALUE),text('unit','输出单位',true)],
    '活检':[text('tissue','组织类型',true),number('quantity','每份取材数量',true,Number.MIN_VALUE),text('unit','单位',true)],
    '终点取材':[text('tissue','组织类型',true),number('quantity','每份取材数量',true,Number.MIN_VALUE),text('unit','单位',true)],
    '检测':[text('assay','检测类型',true),text('platform','检测平台'),text('result','结果摘要',true)],
    '质量检测':[text('assay','检测类型',true),text('result','结果摘要',true)],
    '实验使用':[text('purpose','使用目的',true),number('usedQuantity','使用数量',true,Number.MIN_VALUE),text('unit','单位',true),select('allUsed','是否全部使用',['部分使用','全部使用']),number('remainingQuantity','剩余数量（部分使用必填）')],
    '消耗':[text('purpose','使用目的',true),number('usedQuantity','消耗数量',true,Number.MIN_VALUE),text('unit','单位',true),number('remainingQuantity','剩余数量',true)],
    '废弃':[text('reason','废弃原因',true)],
    '取出':[text('reason','取出原因',true)],
    '归还':[text('reason','归还说明')],
    '实际处置':[text('method','处置方式',true),text('reason','处置说明',true)]
  };
  return structuredClone(fields[type] || []);
}

export function parseEventFields(type, module, input = {}) {
  const schema = eventFields(type,module), data = {};
  for (const field of schema) {
    const value = input[field.key];
    if (value === undefined || value === null || String(value).trim() === '') {
      if (field.required) throw Error('请填写'+field.label);
      continue;
    }
    if (field.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < field.min) throw Error(field.label+'数值无效');
      data[field.key] = n;
    } else {
      if (typeof value !== 'string' || value.length > 2000) throw Error(field.label+'内容无效');
      data[field.key] = value.trim();
      if (field.options && !field.options.includes(data[field.key])) throw Error(field.label+'选项无效');
    }
  }
  if (type === '体重测量') data.unit = 'g';
  if (type === '肿瘤测量') {
    if (data.method === '长径×短径²/2') {
      if (!(data.length > 0 && data.width > 0)) throw Error('请填写正数长径和短径');
      data.value = data.length * data.width ** 2 / 2;
    } else if (!(data.value > 0)) throw Error('请填写正数肿瘤体积');
    if (!Number.isFinite(data.value)) throw Error('肿瘤体积超出范围');
    data.unit = 'mm³';
  }
  if (type === '实验使用' && data.allUsed === '部分使用' && !(data.remainingQuantity > 0)) throw Error('部分使用必须记录正数剩余数量');
  if (type === '实验使用' && data.allUsed === '全部使用' && data.remainingQuantity > 0) throw Error('全部使用时剩余数量必须为零');
  if (data.volume !== undefined && !data.volumeUnit) throw Error('请填写体积单位');
  return {data,schema};
}

export function fieldLabel(event, key) {
  return event.fieldSchema?.find(field=>field.key===key)?.label || ({value:'测量值',unit:'单位',from:'原位置',to:'新位置',operator:'操作人员',previousGenotype:'原基因型',previousConditions:'原培养条件'}[key]) || key;
}
