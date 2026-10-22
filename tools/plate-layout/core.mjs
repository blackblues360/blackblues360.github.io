export const PLATE_TYPES = Object.freeze({
  '6': { rows: 2, cols: 3 },
  '12': { rows: 3, cols: 4 },
  '24': { rows: 4, cols: 6 },
  '96': { rows: 8, cols: 12 }
});

const PALETTE = ['#a9c9ed', '#f4dc91', '#efa9b7', '#b5dba9', '#c9b4eb', '#f4bd91', '#94d5d4', '#deb9cf', '#d0d59b', '#aab9da', '#dfc3a3', '#b5d1be'];
const FONT = '-apple-system, BlinkMacSystemFont, Segoe UI, Microsoft YaHei, sans-serif';

export function cleanText(value) {
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\ufffe\uffff]/g, '').replace(/\s+/gu, ' ').trim();
  const valid = [...text].filter(character => {
    const code = character.codePointAt(0);
    return code < 0xd800 || code > 0xdfff;
  }).join('').normalize('NFC');
  return valid.slice(0, 160).replace(/[\ud800-\udbff]$/, '');
}

export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

export function wellIds(type) {
  const spec = PLATE_TYPES[type];
  if (!Object.hasOwn(PLATE_TYPES, type)) throw new Error('不支持的孔板类型');
  return Array.from({ length: spec.rows }, (_, row) =>
    Array.from({ length: spec.cols }, (_, col) => `${String.fromCharCode(65 + row)}${col + 1}`)
  ).flat();
}

export function createState(type = '96') {
  return {
    version: 1,
    plate: { type: String(type), title: '' },
    wells: Object.fromEntries(wellIds(type).map(id => [id, null])),
    labels: [],
    ui: { selected: [], activeLabelId: null, showIds: true, showAxes: true, showFrame: true, exportLegend: true, wellScale: 100 }
  };
}

// 从本地存储恢复时只接纳有效数据，避免旧版本或损坏的映射污染当前方案。
export function restoreState(raw) {
  if (!raw || raw.version !== 1 || !Object.hasOwn(PLATE_TYPES, raw.plate?.type)) throw new Error('保存的方案格式不兼容');
  const state = createState(raw.plate.type);
  state.plate.title = typeof raw.plate.title === 'string' ? cleanText(raw.plate.title) : '';
  const ids = new Set();
  const names = new Set();
  const colors = new Set();
  for (const label of Array.isArray(raw.labels) ? raw.labels.slice(0, 96) : []) {
    if (typeof label?.id !== 'string' || !/^label-\d+$/.test(label.id) || typeof label.name !== 'string' || typeof label.color !== 'string' || !/^#[\da-f]{6}$/i.test(label.color)) continue;
    const number = Number(label.id.slice(6));
    if (!Number.isSafeInteger(number) || number < 1) continue;
    const name = cleanText(label.name);
    const key = name.toLowerCase();
    const color = label.color.toLowerCase();
    if (!name || ids.has(label.id) || names.has(key) || colors.has(color)) continue;
    state.labels.push({ id: label.id, name, color });
    ids.add(label.id);
    names.add(key);
    colors.add(color);
  }
  for (const id of Object.keys(state.wells)) {
    if (ids.has(raw.wells?.[id])) state.wells[id] = raw.wells[id];
  }
  const selected = new Set(Array.isArray(raw.ui?.selected) ? raw.ui.selected : []);
  state.ui.selected = Object.keys(state.wells).filter(id => selected.has(id));
  if (ids.has(raw.ui?.activeLabelId)) state.ui.activeLabelId = raw.ui.activeLabelId;
  for (const key of ['showIds', 'showAxes', 'showFrame', 'exportLegend']) {
    if (typeof raw.ui?.[key] === 'boolean') state.ui[key] = raw.ui[key];
  }
  if (Number.isFinite(raw.ui?.wellScale)) state.ui.wellScale = Math.max(75, Math.min(110, raw.ui.wellScale));
  return state;
}

export function nextColor(labels) {
  const used = new Set(labels.map(label => label.color.toLowerCase()));
  const available = PALETTE.find(color => !used.has(color));
  if (available) return available;
  // 标签较多时按黄金角扩展浅色调，始终避免与库中的颜色完全相同。
  for (let index = 0; index < 1000; index++) {
    const hue = ((index * 137.508) % 360) / 60;
    const saturation = .42 + (index % 3) * .09;
    const lightness = .74 + (index % 4) * .035;
    const a = saturation * Math.min(lightness, 1 - lightness);
    const rgb = [0, 8, 4].map(offset => {
      const k = (offset + hue * 2) % 12;
      return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
    });
    const color = `#${rgb.join('')}`;
    if (!used.has(color)) return color;
  }
  throw new Error('可用标签颜色不足');
}

export function assignLabel(state, name, color) {
  const trimmed = cleanText(name);
  if (!trimmed) throw new Error('请输入标签名称。');
  if (!state.ui.selected.length) throw new Error('请先选择至少一个孔位。');
  let label = state.labels.find(item => item.name.toLowerCase() === trimmed.toLowerCase());
  if (!label) {
    if (state.labels.length >= 96) throw new Error('标签库最多保留 96 个标签，请先删除不需要的标签。');
    if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('请选择有效的标签颜色。');
    if (state.labels.some(item => item.color.toLowerCase() === color.toLowerCase())) throw new Error('此颜色已被其他标签使用，请选择其他颜色或使用自动配色。');
    let number = 1;
    const ids = new Set(state.labels.map(item => item.id));
    while (ids.has(`label-${number}`)) number++;
    label = { id: `label-${number}`, name: trimmed, color: color.toLowerCase() };
    state.labels.push(label);
  }
  for (const id of state.ui.selected) {
    if (Object.hasOwn(state.wells, id)) state.wells[id] = label.id;
  }
  state.ui.activeLabelId = label.id;
  return label;
}

export function setLabelColor(state, id, color) {
  if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('请选择有效的标签颜色。');
  if (state.labels.some(label => label.id !== id && label.color.toLowerCase() === color.toLowerCase())) throw new Error('此颜色已被其他标签使用，请选择另一种颜色。');
  const label = state.labels.find(item => item.id === id);
  if (label) label.color = color.toLowerCase();
}

export function clearSelectedLabels(state) {
  for (const id of state.ui.selected) {
    if (Object.hasOwn(state.wells, id)) state.wells[id] = null;
  }
}

export function deleteLabel(state, id) {
  state.labels = state.labels.filter(label => label.id !== id);
  for (const well of Object.keys(state.wells)) {
    if (state.wells[well] === id) state.wells[well] = null;
  }
  if (state.ui.activeLabelId === id) state.ui.activeLabelId = null;
}

export function usedLabels(state) {
  return state.labels.map(label => ({ ...label, wells: Object.keys(state.wells).filter(id => state.wells[id] === label.id) })).filter(label => label.wells.length);
}

export function textColor(hex) {
  const rgb = hex.slice(1).match(/../g).map(value => {
    const s = parseInt(value, 16) / 255;
    return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
  });
  const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  if (luminance > .4) return '#20343c';
  return luminance >= .179 ? '#000000' : '#ffffff';
}

function textWidth(text, size) {
  return [...text].reduce((width, char) => {
    const ratio = /[^\u0000-\u024f]/u.test(char) ? 1.05 : /[WMwm@%]/.test(char) ? 1 : /[A-Z]/.test(char) ? .8 : /[ilI.,'! :;]/.test(char) ? .4 : .68;
    return width + ratio * size;
  }, 0);
}

function shorten(text, width, size) {
  if (textWidth(text, size) <= width) return text;
  let result = '';
  for (const char of text) {
    if (textWidth(result + char + '…', size) > width) break;
    result += char;
  }
  return result + '…';
}

export function wrapText(text, width, size) {
  const lines = [];
  let line = '';
  for (const char of text) {
    if (line && textWidth(line + char, size) > width) {
      lines.push(line);
      line = '';
    }
    line += char;
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

export function plateMarkup(state, interactive = true) {
  const { rows, cols } = PLATE_TYPES[state.plate.type];
  const width = 1000;
  const step = 878 / cols;
  const height = 64 + rows * step + 28;
  const radius = step * .405 * state.ui.wellScale / 100;
  const showAxes = !interactive || state.ui.showAxes;
  const showIds = state.ui.showIds;
  const labels = new Map(state.labels.map(label => [label.id, label]));
  const selected = new Set(interactive ? state.ui.selected : []);
  const content = [];
  if (!interactive || state.ui.showFrame) content.push(`<rect x="2" y="2" width="996" height="${height - 4}" rx="28" fill="#f8fafb" stroke="#dfe8eb" stroke-width="1.5"/><rect x="61" y="58" width="${cols * step + 14}" height="${rows * step + 11}" rx="22" fill="#ffffff" stroke="#e8eef0"/>`);
  if (showAxes) {
    for (let col = 1; col <= cols; col++) content.push(`<g ${interactive ? `data-col="${col}" role="button" tabindex="0" aria-label="选择第 ${col} 列"` : ''}><rect x="${68 + (col - 1) * step}" y="9" width="${step}" height="42" fill="transparent"/><text x="${68 + (col - .5) * step}" y="37" text-anchor="middle" fill="#526d7a" font-size="19" font-weight="550">${col}</text></g>`);
    for (let row = 0; row < rows; row++) {
      const letter = String.fromCharCode(65 + row);
      content.push(`<g ${interactive ? `data-row="${letter}" role="button" tabindex="0" aria-label="选择第 ${letter} 行"` : ''}><rect x="12" y="${64 + row * step}" width="43" height="${step}" fill="transparent"/><text x="34" y="${64 + (row + .5) * step + 6}" text-anchor="middle" fill="#526d7a" font-size="19" font-weight="550">${letter}</text></g>`);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 1; col <= cols; col++) {
      const id = `${String.fromCharCode(65 + row)}${col}`;
      const label = labels.get(state.wells[id]);
      const fill = label?.color || '#f0f3f4';
      const ink = textColor(fill);
      const fontSize = Math.max(12, Math.min(25, radius * .39));
      const coordinateSize = Math.max(13, Math.min(23, radius * .31));
      const x = 68 + (col - .5) * step;
      const y = 64 + (row + .5) * step;
      const name = label ? shorten(label.name, radius * 1.65, fontSize) : '';
      const description = `${id}：${label?.name || '未分配标签'}`;
      content.push(`<g transform="translate(${x} ${y})" ${interactive ? `data-well="${id}" role="button" tabindex="0" aria-pressed="${selected.has(id)}" aria-label="${escapeXml(description)}"` : ''}><title>${escapeXml(description)}</title>`);
      if (selected.has(id)) content.push(`<circle r="${radius + 4.5}" fill="none" stroke="#386f61" stroke-width="2.5"/><circle cx="${radius * .72}" cy="${-radius * .72}" r="6" fill="#386f61" stroke="#ffffff" stroke-width="1.5"/>`);
      content.push(`<circle class="well-circle" r="${radius}" fill="${fill}" stroke="${label ? '#263f4b20' : '#dce4e7'}" stroke-width="1.2"/>`);
      if (showIds) content.push(`<text y="${label ? -fontSize * .47 : coordinateSize * .34}" text-anchor="middle" fill="${ink}" opacity="${label ? '.72' : '.67'}" font-size="${coordinateSize}">${id}</text>`);
      if (label) content.push(`<text y="${showIds ? fontSize * .91 : fontSize * .34}" text-anchor="middle" fill="${ink}" font-size="${fontSize}" font-weight="550">${escapeXml(name)}</text>`);
      content.push('</g>');
    }
  }
  return { width, height, content: `<g font-family="${FONT}">${content.join('')}</g>` };
}

// 导出独立的 SVG 图稿，而非截取编辑界面；图例按内容计算高度。
export function buildExportSvg(state) {
  const width = 1200;
  const body = [];
  const title = cleanText(state.plate.title) || '孔板铺板方案';
  const titleLines = wrapText(title, 1100, 31);
  titleLines.forEach((line, index) => body.push(`<text x="48" y="${66 + index * 41}" font-size="31" font-weight="650">${escapeXml(line)}</text>`));
  const titleBottom = 66 + (titleLines.length - 1) * 41;
  const marked = Object.values(state.wells).filter(Boolean).length;
  const spec = PLATE_TYPES[state.plate.type];
  body.push(`<text x="48" y="${titleBottom + 33}" font-size="16" fill="#718591">${state.plate.type} 孔板 · ${spec.rows} × ${spec.cols} · ${marked} / ${state.plate.type} 孔位已标记</text>`);
  const plate = plateMarkup(state, false);
  const plateY = titleBottom + 57;
  const plateHeight = plate.height * 1.104;
  body.push(`<svg x="48" y="${plateY}" width="1104" height="${plateHeight}" viewBox="0 0 ${plate.width} ${plate.height}">${plate.content}</svg>`);
  const includeLegend = state.ui.exportLegend !== false;
  let y = plateY + plateHeight;
  if (includeLegend) {
    y += 45;
    body.push(`<text x="48" y="${y}" font-size="20" font-weight="600">标签图例 / Legend</text>`);
    y += 27;
  }
  const labels = includeLegend ? usedLabels(state) : [];
  for (let index = 0; index < labels.length; index += 2) {
    const cards = labels.slice(index, index + 2).map(label => ({
      label,
      names: wrapText(label.name, 451, 17),
      coordinates: wrapText(label.wells.join(', '), 451, 13)
    }));
    const cardHeight = Math.max(...cards.map(card => card.names.length * 24 + card.coordinates.length * 19 + 50));
    cards.forEach((card, offset) => {
      const x = 48 + offset * 562;
      body.push(`<rect x="${x}" y="${y}" width="542" height="${cardHeight}" rx="9" fill="#ffffff" stroke="#e0e8eb"/><circle cx="${x + 24}" cy="${y + 27}" r="11" fill="${card.label.color}" stroke="#20343c15"/>`);
      card.names.forEach((line, lineIndex) => body.push(`<text x="${x + 47}" y="${y + 30 + lineIndex * 24}" font-size="17" font-weight="550">${escapeXml(line)}</text>`));
      const countY = y + 33 + card.names.length * 24;
      body.push(`<text x="${x + 47}" y="${countY}" font-size="14" fill="#6c8190">${card.label.wells.length} 孔位 (${(card.label.wells.length / Number(state.plate.type) * 100).toFixed(1)}%)</text>`);
      card.coordinates.forEach((line, lineIndex) => body.push(`<text x="${x + 47}" y="${countY + 24 + lineIndex * 19}" font-size="13" fill="#718591">${escapeXml(line)}</text>`));
    });
    y += cardHeight + 13;
  }
  if (includeLegend && !labels.length) {
    body.push(`<text x="48" y="${y + 23}" font-size="16" fill="#718591">尚未分配实验标签 / No labels assigned</text>`);
    y += 60;
  }
  const height = Math.ceil(y + 67);
  body.push(`<text x="48" y="${height - 28}" font-size="12" fill="#8a9ca5">Plate Layout Designer · blackblues.xyz</text>`);
  return { width, height, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/><g fill="#20343c" font-family="${FONT}">${body.join('')}</g></svg>` };
}

export function exportFilename(title, format, date = new Date()) {
  const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  const name = cleanText(title).replace(/[<>:"/\\|?*]/g, '-').replace(/^[. ]+|[. ]+$/g, '').slice(0, 100);
  return `${name || `plate-layout-${day}`}.${format === 'jpg' ? 'jpg' : 'png'}`;
}
