import {
  PLATE_TYPES, createState, restoreState, cleanText, wellIds, nextColor, assignLabel,
  setLabelColor, clearSelectedLabels, deleteLabel, usedLabels, plateMarkup,
  buildExportSvg, exportFilename
} from './core.mjs';
import {prepareImport,backupBeforeImport,readImportBackup} from './files.mjs';
import {acquireDraftGuard} from '../../assets/js/draft-lock.mjs';
import {mountDocumentManager} from '../../assets/js/account/document-manager.mjs';

const STORAGE_KEY = 'blackblues.plate-layout.v1';
const elements = Object.fromEntries([
  'saveStatus', 'planTitle', 'titleCount', 'undo', 'redo', 'reset', 'exportPng', 'exportJpg',
  'plateTypes', 'showIds', 'showAxes', 'showFrame', 'wellScale', 'wellScaleValue', 'selectAll',
  'deselectAll', 'exportScale', 'exportIds', 'exportLegend', 'plateHeading', 'assignedCount', 'plate', 'plateDimensions',
  'legendSummary', 'legend', 'selectionCount', 'selectionList', 'clearSelection', 'labelForm',
  'labelName', 'labelColor', 'colorMode', 'colorHex', 'autoColor', 'applyLabel', 'clearLabels',
  'editorHint', 'labelCount', 'labelLibrary', 'notice'
].map(id => [id, document.getElementById(id)]));

let state = createState();
let storageAvailable = true;
let restored = false;
let restoreFailed = false;
let lastStoredText = null;
const draftStorage = await acquireDraftGuard(STORAGE_KEY, message => {
  document.getElementById('draftAccessNotice').textContent = message;
  document.getElementById('draftAccessNotice').hidden = false;
});
try {
  const raw = draftStorage.getItem(STORAGE_KEY);
  lastStoredText = raw;
  if (raw) {
    state = restoreState(JSON.parse(raw));
    restored = true;
  }
} catch (error) {
  if (error instanceof SyntaxError || error.message === '保存的方案格式不兼容') restoreFailed = true;
  else storageAvailable = false;
}

let undoStack = [];
let redoStack = [];
let lastAction = '';
let lastActionTime = 0;
let drag = null;
let manualColor = false;
let exporting = false;
let noticeTimer;
let pendingImport = null;
let cloudDocuments = null;

function notify(message) {
  clearTimeout(noticeTimer);
  elements.notice.textContent = message;
  elements.notice.hidden = false;
  noticeTimer = setTimeout(() => { elements.notice.hidden = true; }, 5500);
}

function persist() {
  if (cloudDocuments?.cloudMode) { cloudDocuments.changed(); elements.saveStatus.textContent='云端文档 · 请手动保存'; return; }
  if (!draftStorage.canWrite || restoreFailed) {
    elements.saveStatus.textContent = '本地保存不可用 · 请手动备份 JSON';
    return;
  }
  try {
    const text = JSON.stringify(state);
    draftStorage.setItem(STORAGE_KEY, text);
    lastStoredText = text;
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  elements.saveStatus.textContent = storageAvailable ? '已自动保存到此浏览器' : '本地保存不可用 · 请及时导出';
  elements.saveStatus.classList.toggle('warning', !storageAvailable);
}

function remember(before, action = '') {
  if (before === JSON.stringify(state)) return false;
  if (action !== 'title' || lastAction !== 'title' || Date.now() - lastActionTime > 1200) {
    undoStack.push(before);
    if (undoStack.length > 100) undoStack.shift();
  }
  redoStack = [];
  lastAction = action;
  lastActionTime = Date.now();
  persist();
  return true;
}

function change(mutator, message = '', action = '') {
  finishDrag();
  const before = JSON.stringify(state);
  try {
    mutator();
    remember(before, action);
    render();
    if (message) notify(message);
    return true;
  } catch (error) {
    state = JSON.parse(before);
    render();
    notify(error.message);
    return false;
  }
}

function suggestColor() {
  const name = cleanText(elements.labelName.value).toLowerCase();
  const existing = state.labels.find(label => label.name.toLowerCase() === name);
  if (existing) elements.labelColor.value = existing.color;
  else if (!manualColor) elements.labelColor.value = nextColor(state.labels);
  elements.labelColor.disabled = Boolean(existing);
  elements.colorMode.textContent = existing ? '复用已有标签颜色' : manualColor ? '自定义颜色' : '自动推荐';
  elements.colorHex.textContent = elements.labelColor.value.toUpperCase();
}

function renderSelection() {
  elements.selectionCount.textContent = `${state.ui.selected.length} 个孔位`;
  elements.selectionList.replaceChildren();
  if (!state.ui.selected.length) {
    const hint = document.createElement('span');
    hint.className = 'none-selected';
    hint.textContent = '在孔板上点击或拖动选择';
    elements.selectionList.append(hint);
  }
  for (const id of state.ui.selected) {
    const chip = document.createElement('button');
    chip.className = 'well-chip';
    chip.dataset.removeWell = id;
    chip.setAttribute('aria-label', `取消选择 ${id}`);
    chip.append(document.createTextNode(id));
    const close = document.createElement('span');
    close.textContent = '×';
    close.setAttribute('aria-hidden', 'true');
    chip.append(close);
    elements.selectionList.append(chip);
  }
  const empty = !state.ui.selected.length;
  elements.clearSelection.disabled = empty;
  elements.deselectAll.disabled = empty;
  elements.selectAll.disabled = state.ui.selected.length === Number(state.plate.type);
  elements.clearLabels.disabled = !state.ui.selected.some(id => state.wells[id]);
  elements.applyLabel.disabled = empty;
  elements.editorHint.textContent = empty ? '先在孔板上选择需要分组的孔位。' : `将标签应用到 ${state.ui.selected.length} 个孔位；已有标签将被覆盖。`;
}

function renderLabels() {
  const used = usedLabels(state);
  const marked = used.reduce((count, label) => count + label.wells.length, 0);
  elements.assignedCount.textContent = `${marked} / ${state.plate.type} 已标记`;
  elements.legendSummary.textContent = `${used.length} 个标签 · ${marked} 个孔位已标记`;
  elements.legend.replaceChildren();
  if (!used.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const heading = document.createElement('strong');
    heading.textContent = '从第一组孔位开始';
    empty.append(heading, document.createTextNode('选择孔位并应用标签，分组、数量与坐标将在这里显示。'));
    elements.legend.append(empty);
  }
  for (const label of used) {
    const card = document.createElement('article');
    card.className = 'legend-item';
    const dot = document.createElement('span');
    dot.className = 'color-dot';
    dot.style.backgroundColor = label.color;
    dot.setAttribute('aria-hidden', 'true');
    const details = document.createElement('div');
    details.className = 'legend-details';
    const name = document.createElement('strong');
    name.className = 'legend-name';
    name.textContent = label.name;
    const count = document.createElement('span');
    count.className = 'legend-count';
    count.textContent = `${label.wells.length} 孔位 (${(label.wells.length / Number(state.plate.type) * 100).toFixed(1)}%)`;
    const coordinates = document.createElement('p');
    coordinates.className = 'legend-wells';
    coordinates.textContent = label.wells.join(', ');
    coordinates.title = coordinates.textContent;
    details.append(name, count, coordinates);
    card.append(dot, details);
    elements.legend.append(card);
  }
  elements.labelCount.textContent = String(state.labels.length);
  elements.labelLibrary.replaceChildren();
  if (!state.labels.length) {
    const empty = document.createElement('p');
    empty.className = 'library-empty';
    empty.textContent = '还没有标签，试着创建一个。';
    elements.labelLibrary.append(empty);
  }
  for (const label of state.labels) {
    const wells = used.find(item => item.id === label.id)?.wells || [];
    const row = document.createElement('div');
    row.className = `library-row${label.id === state.ui.activeLabelId ? ' is-active' : ''}`;
    const color = document.createElement('input');
    color.type = 'color';
    color.value = label.color;
    color.dataset.labelColor = label.id;
    color.setAttribute('aria-label', `修改 ${label.name} 的颜色`);
    const apply = document.createElement('button');
    apply.className = 'apply-existing';
    apply.dataset.applyLabel = label.id;
    apply.textContent = label.name;
    apply.title = wells.length ? `${label.name} · ${wells.join(', ')}；点击应用到当前选择` : `${label.name} · 未使用，可点击复用`;
    const usage = document.createElement('span');
    usage.className = 'label-usage';
    usage.textContent = wells.length ? `${wells.length} 孔` : '未使用';
    const remove = document.createElement('button');
    remove.className = 'delete-label';
    remove.dataset.deleteLabel = label.id;
    remove.setAttribute('aria-label', `删除标签 ${label.name}`);
    remove.title = '删除标签';
    remove.textContent = '×';
    row.append(color, apply, usage, remove);
    elements.labelLibrary.append(row);
  }
}

function render() {
  const focusedWell = document.activeElement?.dataset?.well;
  const focusedRow = document.activeElement?.dataset?.row;
  const focusedCol = document.activeElement?.dataset?.col;
  const focusedLabel = document.activeElement?.dataset?.applyLabel;
  const plate = plateMarkup(state);
  elements.plate.setAttribute('viewBox', `0 0 ${plate.width} ${plate.height}`);
  elements.plate.innerHTML = plate.content;
  for (const button of elements.plateTypes.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.type === state.plate.type));
  elements.plateHeading.replaceChildren(document.createTextNode(`${state.plate.type} 孔板 `));
  const subtitle = document.createElement('span');
  subtitle.textContent = `${state.plate.type}-well plate`;
  elements.plateHeading.append(subtitle);
  const spec = PLATE_TYPES[state.plate.type];
  elements.plateDimensions.textContent = `${spec.rows} 行 × ${spec.cols} 列`;
  if (document.activeElement !== elements.planTitle) elements.planTitle.value = state.plate.title;
  elements.titleCount.textContent = `${state.plate.title.length} / 160`;
  for (const key of ['showIds', 'showAxes', 'showFrame', 'exportLegend']) elements[key].checked = state.ui[key];
  elements.exportIds.checked = state.ui.showIds;
  elements.wellScale.value = state.ui.wellScale;
  elements.wellScaleValue.textContent = `${state.ui.wellScale}%`;
  elements.undo.disabled = !undoStack.length;
  elements.redo.disabled = !redoStack.length;
  renderSelection();
  renderLabels();
  suggestColor();
  const focusTarget = focusedWell ? `[data-well="${focusedWell}"]` : focusedRow ? `[data-row="${focusedRow}"]` : focusedCol ? `[data-col="${focusedCol}"]` : null;
  if (focusTarget) elements.plate.querySelector(focusTarget)?.focus({ preventScroll: true });
  if (focusedLabel) elements.labelLibrary.querySelector(`[data-apply-label="${focusedLabel}"]`)?.focus({ preventScroll: true });
}

function selectGroup(ids) {
  const selected = new Set(state.ui.selected);
  const remove = ids.every(id => selected.has(id));
  for (const id of ids) {
    if (remove) selected.delete(id);
    else selected.add(id);
  }
  state.ui.selected = Object.keys(state.wells).filter(id => selected.has(id));
}

function finishDrag() {
  if (!drag) return;
  const before = drag.before;
  drag = null;
  remember(before);
  render();
}

elements.plate.addEventListener('pointerdown', event => {
  const well = event.target.closest('[data-well]');
  if (!well || event.button !== 0) return;
  event.preventDefault();
  finishDrag();
  well.focus({ preventScroll: true });
  const id = well.dataset.well;
  drag = { pointerId: event.pointerId, before: JSON.stringify(state), add: !state.ui.selected.includes(id), visited: new Set([id]), x: event.clientX, y: event.clientY };
  selectGroup([id]);
  render();
});

document.addEventListener('pointermove', event => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const steps = Math.max(1, Math.ceil(Math.hypot(event.clientX - drag.x, event.clientY - drag.y) / 12));
  const selected = new Set(state.ui.selected);
  let changed = false;
  for (let step = 1; step <= steps; step++) {
    const x = drag.x + (event.clientX - drag.x) * step / steps;
    const y = drag.y + (event.clientY - drag.y) * step / steps;
    const target = document.elementFromPoint(x, y)?.closest('[data-well]');
    if (!target || !elements.plate.contains(target) || drag.visited.has(target.dataset.well)) continue;
    const id = target.dataset.well;
    drag.visited.add(id);
    if (drag.add) selected.add(id);
    else selected.delete(id);
    changed = true;
  }
  drag.x = event.clientX;
  drag.y = event.clientY;
  if (changed) {
    state.ui.selected = Object.keys(state.wells).filter(id => selected.has(id));
    render();
  }
});
document.addEventListener('pointerup', event => { if (drag?.pointerId === event.pointerId) finishDrag(); });
document.addEventListener('pointercancel', event => { if (drag?.pointerId === event.pointerId) finishDrag(); });
window.addEventListener('blur', finishDrag);

elements.plate.addEventListener('click', event => {
  const row = event.target.closest('[data-row]')?.dataset.row;
  const col = event.target.closest('[data-col]')?.dataset.col;
  if (row) change(() => selectGroup(Object.keys(state.wells).filter(id => id[0] === row)));
  if (col) change(() => selectGroup(Object.keys(state.wells).filter(id => id.slice(1) === col)));
  // 辅助技术触发的 click 没有 pointerdown，仍需允许选择孔位。
  const well = event.target.closest('[data-well]');
  if (well && event.detail === 0) change(() => selectGroup([well.dataset.well]));
});

elements.plate.addEventListener('keydown', event => {
  const target = event.target.closest('[role="button"]');
  if (!target) return;
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    return;
  }
  if (!target.dataset.well || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const { rows, cols } = PLATE_TYPES[state.plate.type];
  let row = target.dataset.well.charCodeAt(0) - 65;
  let col = Number(target.dataset.well.slice(1));
  if (event.key === 'ArrowLeft') col = Math.max(1, col - 1);
  if (event.key === 'ArrowRight') col = Math.min(cols, col + 1);
  if (event.key === 'ArrowUp') row = Math.max(0, row - 1);
  if (event.key === 'ArrowDown') row = Math.min(rows - 1, row + 1);
  elements.plate.querySelector(`[data-well="${String.fromCharCode(65 + row)}${col}"]`)?.focus();
});

elements.plateTypes.addEventListener('click', event => {
  const type = event.target.closest('[data-type]')?.dataset.type;
  if (!type || type === state.plate.type) return;
  if ((state.labels.length || Object.values(state.wells).some(Boolean)) && !window.confirm(`切换为 ${type} 孔板将清空孔位标签和标签库，方案标题保留。此操作可撤销。是否继续？`)) return;
  change(() => {
    const title = state.plate.title;
    state = createState(type);
    state.plate.title = title;
  }, `已切换为 ${type} 孔板，可撤销恢复原方案。`);
});

elements.planTitle.addEventListener('input', () => change(() => { state.plate.title = cleanText(elements.planTitle.value); }, '', 'title'));
for (const key of ['showIds', 'showAxes', 'showFrame', 'exportLegend']) elements[key].addEventListener('change', () => change(() => { state.ui[key] = elements[key].checked; }));
elements.exportIds.addEventListener('change', () => change(() => { state.ui.showIds = elements.exportIds.checked; }));
elements.wellScale.addEventListener('input', () => change(() => { state.ui.wellScale = Number(elements.wellScale.value); }));
elements.selectAll.addEventListener('click', () => change(() => { state.ui.selected = wellIds(state.plate.type); }));
for (const id of ['deselectAll', 'clearSelection']) elements[id].addEventListener('click', () => change(() => { state.ui.selected = []; }));
elements.selectionList.addEventListener('click', event => {
  const id = event.target.closest('[data-remove-well]')?.dataset.removeWell;
  if (id) change(() => { state.ui.selected = state.ui.selected.filter(well => well !== id); });
});

elements.labelName.addEventListener('input', suggestColor);
elements.labelColor.addEventListener('input', () => { manualColor = true; suggestColor(); });
elements.autoColor.addEventListener('click', () => { manualColor = false; suggestColor(); });
elements.labelForm.addEventListener('submit', event => {
  event.preventDefault();
  const name = elements.labelName.value;
  const color = elements.labelColor.value;
  if (change(() => {
    assignLabel(state, name, color);
    state.ui.selected = [];
  }, `已为 ${state.ui.selected.length} 个孔位应用标签，选择已清空。`)) {
    elements.labelName.value = '';
    manualColor = false;
    suggestColor();
  }
});
elements.clearLabels.addEventListener('click', () => change(() => clearSelectedLabels(state), '已清除选中孔位的标签；标签库保留，可继续复用。'));
elements.labelLibrary.addEventListener('click', event => {
  const applyId = event.target.closest('[data-apply-label]')?.dataset.applyLabel;
  if (applyId) {
    const label = state.labels.find(item => item.id === applyId);
    if (!state.ui.selected.length) { notify('请先选择孔位，再点击标签名称应用。'); return; }
    change(() => {
      assignLabel(state, label.name, label.color);
      state.ui.selected = [];
    }, '已应用已有标签，选择已清空。');
  }
  const deleteId = event.target.closest('[data-delete-label]')?.dataset.deleteLabel;
  if (deleteId) {
    const label = state.labels.find(item => item.id === deleteId);
    const count = Object.values(state.wells).filter(id => id === deleteId).length;
    if (window.confirm(`删除标签「${label.name}」？${count ? `使用此标签的 ${count} 个孔位将恢复为未标记。` : '此标签尚未使用。'}此操作可撤销。`)) change(() => deleteLabel(state, deleteId), '标签已删除。');
  }
});
elements.labelLibrary.addEventListener('change', event => {
  const id = event.target.dataset.labelColor;
  if (id) change(() => setLabelColor(state, id, event.target.value), '标签颜色已同步更新。');
});

function travelHistory(redo = false) {
  finishDrag();
  const source = redo ? redoStack : undoStack;
  const target = redo ? undoStack : redoStack;
  if (!source.length) return;
  target.push(JSON.stringify(state));
  state = JSON.parse(source.pop());
  lastAction = '';
  persist();
  render();
}
elements.undo.addEventListener('click', () => travelHistory());
elements.redo.addEventListener('click', () => travelHistory(true));
document.addEventListener('keydown', event => {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (event.key.toLowerCase() === 'z') { event.preventDefault(); travelHistory(event.shiftKey); }
  if (event.key.toLowerCase() === 'y') { event.preventDefault(); travelHistory(true); }
});
elements.reset.addEventListener('click', () => {
  if ((state.labels.length || state.plate.title || state.ui.selected.length) && !window.confirm('重置将清空当前方案的标题、标签与孔位分配。此操作可撤销。是否继续？')) return;
  change(() => { state = createState(state.plate.type); }, '已重置当前方案，可撤销恢复。');
});

async function exportImage(format) {
  if (exporting) return;
  finishDrag();
  exporting = true;
  elements.exportPng.disabled = true;
  elements.exportJpg.disabled = true;
  let imageUrl;
  try {
    const exportState = JSON.parse(JSON.stringify(state));
    const exportedAt = new Date();
    const artwork = buildExportSvg(exportState, exportedAt);
    const requestedScale = Number(elements.exportScale.value);
    // 极长图例自动控制画布内存和边长，不裁切或省略任何标签。
    const scale = Math.min(requestedScale, 16000 / artwork.height, Math.sqrt(24000000 / (artwork.width * artwork.height)));
    if (document.fonts) await document.fonts.ready;
    imageUrl = URL.createObjectURL(new Blob([artwork.svg], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('图片绘制失败，请重试或尝试其他浏览器。'));
      image.src = imageUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(artwork.width * scale);
    canvas.height = Math.round(artwork.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('此浏览器无法创建导出画布。');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, .95));
    if (!blob || blob.type !== mime) throw new Error('当前浏览器不支持此图片格式。');
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = exportFilename(exportState.plate.title, format, exportedAt);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
    notify(`${format.toUpperCase()} 已生成（${canvas.width} × ${canvas.height}）${scale < requestedScale ? '，已根据完整图例自动调整分辨率。' : '，请在浏览器下载中查看。'}`);
    canvas.width = 0;
    canvas.height = 0;
  } catch (error) {
    notify(`导出失败：${error.message}`);
  } finally {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    exporting = false;
    elements.exportPng.disabled = false;
    elements.exportJpg.disabled = false;
  }
}
elements.exportPng.addEventListener('click', () => exportImage('png'));
elements.exportJpg.addEventListener('click', () => exportImage('jpg'));

function downloadJson(text, name) {
  const url = URL.createObjectURL(new Blob([text], {type: 'application/json;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
document.getElementById('exportJson').onclick = () => {
  finishDrag();
  downloadJson(JSON.stringify(state, null, 2), 'plate-layout-v1.json');
};
const importDialog = document.getElementById('importDialog');
const jsonInput = document.getElementById('jsonInput');
document.getElementById('importJson').onclick = () => jsonInput.click();
jsonInput.onchange = async () => {
  const file = jsonInput.files[0];
  if (!file) return;
  const cloudContext = cloudDocuments?.contextToken;
  try {
    if (file.size > 5000000) throw new Error('JSON 文件不能超过 5 MB');
    const prepared = prepareImport(await file.text());
    if (cloudContext !== cloudDocuments?.contextToken) throw new Error('账户或文档已切换，请重新选择文件');
    finishDrag();
    const memoryOnly = cloudDocuments?.cloudMode || !draftStorage.canWrite;
    const backup = !memoryOnly ? backupBeforeImport(draftStorage, STORAGE_KEY, state) : {storageText: null};
    pendingImport = {...prepared, beforeStorage: backup.storageText, beforeState: structuredClone(state), memoryOnly, cloudContext};
    document.getElementById('importProtection').textContent = cloudDocuments?.cloudMode
      ? '已保留导入前内存副本，可下载当前方案备份。确认后作为新的云端草稿打开，需手动保存；原云端记录和游客原件不变。'
      : pendingImport.memoryOnly
      ? '文件模式：已保留导入前内存副本，可下载当前方案备份。确认只替换本页内容，不会写入浏览器草稿；请手动保存JSON。'
      : '已备份当前编辑状态及原存储文本。导入将使用规范化结果，原始文件不作改动；可取消、撤销或恢复导入前备份。';
    document.getElementById('importSummary').textContent = `${prepared.summary.type} 孔板 · ${prepared.summary.labels} 个标签 · ${prepared.summary.assigned} 个孔位已分配`;
    document.getElementById('importChanges').textContent = prepared.changes.length
      ? `规范化将改变 ${prepared.changes.length} 处字段（最多显示20处）：\n${prepared.differences.slice(0, 20).map(({path,before,after})=>`${path}: ${JSON.stringify(before)?.slice(0,80) ?? '缺失'} → ${JSON.stringify(after)?.slice(0,80) ?? '删除'}`).join('\n')}\n可下载规范化预览，核对完整结果。`
      : '未检测到数据字段差异（JSON 缩进和键顺序不参与比较）。';
    importDialog.showModal();
  } catch (error) { pendingImport = null; notify(`导入未进行：${error.message}`); }
  finally { jsonInput.value = ''; }
};
document.getElementById('downloadImportOriginal').onclick = () => {
  if (pendingImport) downloadJson(pendingImport.rawText, 'plate-import-original.json');
};
document.getElementById('downloadImportNormalized').onclick = () => {
  if (pendingImport) downloadJson(JSON.stringify(pendingImport.normalized, null, 2), 'plate-import-normalized.json');
};
document.getElementById('downloadBeforeImport').onclick = () => {
  if (pendingImport) downloadJson(JSON.stringify(pendingImport.beforeState, null, 2), 'plate-before-import.json');
};
document.getElementById('exportBrowserOriginal').onclick = () => {
  try { const raw = draftStorage.getItem(STORAGE_KEY); if (raw !== null) downloadJson(raw, 'plate-browser-original.json'); }
  catch (error) { notify(`无法读取原文：${error.message}`); }
};
document.getElementById('exportImportBackup').onclick = () => {
  try {
    const text = localStorage.getItem(`${STORAGE_KEY}.import-backup`);
    if (text === null) throw new Error('没有导入前备份');
    downloadJson(text, 'plate-import-backup.json');
  } catch (error) { notify(`无法导出备份：${error.message}`); }
};
document.getElementById('confirmImport').onclick = async () => {
  if (!pendingImport) return;
  if (pendingImport.cloudContext !== cloudDocuments?.contextToken) { notify('账户或文档已切换，未导入。请重新选择文件。');return; }
  const next = pendingImport.normalized;
  if (cloudDocuments?.cloudMode) {
    try { if (await cloudDocuments.importContent(next)) { pendingImport=null;importDialog.close();notify('已作为独立云端草稿打开，请手动保存。'); } }
    catch(error) { notify(`未导入：${error.message}`); }
    return;
  }
  // A failed primary write must not change the editor or its undo history.
  try {
    if (!pendingImport.memoryOnly) {
      if (draftStorage.getItem(STORAGE_KEY) !== pendingImport.beforeStorage) throw new Error('原方案已在其他页面变化，请取消后重新预览');
      const text = JSON.stringify(next);
      draftStorage.setItem(STORAGE_KEY, text);
      lastStoredText = text;
      restoreFailed = false;
    }
  }
  catch (error) { notify(`未导入：无法保存方案。${error.message}`); return; }
  change(() => { state = next; }, '已导入，可撤销或恢复导入前备份。');
  pendingImport = null; importDialog.close();
};
document.getElementById('cancelImport').onclick = () => importDialog.close();
importDialog.addEventListener('close', () => { pendingImport = null; });
document.getElementById('restoreImportBackup').onclick = () => {
  try {
    if (cloudDocuments?.cloudMode) throw new Error('请先返回本机方案，再恢复本机导入备份');
    const next = readImportBackup(draftStorage, STORAGE_KEY);
    if (!draftStorage.canWrite) throw new Error('本页没有共享草稿写入权限，请使用JSON文件恢复');
    if (draftStorage.getItem(STORAGE_KEY) !== lastStoredText) throw new Error('原方案已在其他页面变化，请先备份并刷新');
    if (!confirm('恢复最近一次导入前的编辑状态？当前修改可通过撤销恢复。')) return;
    const text = JSON.stringify(next);
    draftStorage.setItem(STORAGE_KEY, text);
    lastStoredText = text;
    change(() => { state = next; }, '已恢复导入前备份，可撤销。');
  } catch (error) { notify(`无法恢复备份：${error.message}`); }
};

render();
if (restored) elements.saveStatus.textContent = '已恢复此浏览器中的方案';
if (!storageAvailable) {
  elements.saveStatus.textContent = '本地保存不可用 · 请及时导出';
  elements.saveStatus.classList.add('warning');
}
if (restoreFailed || !draftStorage.canWrite) {
  const notice = document.getElementById('draftAccessNotice'); notice.hidden = false;
  notice.textContent = restoreFailed ? '原草稿无法恢复，自动保存已暂停。请下载浏览器原文；本页修改可备份为JSON，确认导入有效JSON后才替换原草稿。' : draftStorage.reason;
}
cloudDocuments = mountDocumentManager({
  appId:'plate-layout',
  read:()=>structuredClone(state),
  flush:()=>{document.activeElement?.blur?.();finishDrag();},
  validate:value=>{const result=prepareImport(JSON.stringify(value));if(result.changes.length)throw new Error('孔板内容需要规范化，请先导出原文并通过 JSON 导入预览核对，不能静默改写');return result.normalized;},
  apply:value=>{state=structuredClone(value);drag=null;undoStack=[];redoStack=[];lastAction='';pendingImport=null;if(importDialog.open)importDialog.close();render();const mode=cloudDocuments?.cloudMode?'云端文档 · 请手动保存':'本机方案 · 保留独立文件备份';elements.saveStatus.textContent=mode;const footer=document.querySelector('.workspace-footer span');if(footer)footer.textContent=mode;document.getElementById('draftAccessNotice').hidden=Boolean(cloudDocuments?.cloudMode)||!(restoreFailed||!draftStorage.canWrite);},
  create:()=>createState(),title:value=>value.plate.title,
  summary:value=>`${value.plate.type} 孔板 · ${value.labels.length} 个标签 · ${Object.values(value.wells).filter(Boolean).length} 个孔位分配`,
  localRaw:()=>draftStorage.getItem(STORAGE_KEY),canImportLocal:()=>!restoreFailed,
  export:()=>{finishDrag();downloadJson(JSON.stringify(state,null,2),'plate-layout-v1.json');}
});
