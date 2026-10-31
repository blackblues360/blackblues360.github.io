import {restoreState} from './core.mjs';

export function prepareImport(rawText) {
  if (new TextEncoder().encode(rawText).length > 5000000) throw new Error('JSON 文件不能超过 5 MB');
  const raw = JSON.parse(rawText);
  if (!raw || raw.version !== 1 || typeof raw.plate?.title !== 'string'
    || typeof raw.plate?.type !== 'string' || !raw.wells || Array.isArray(raw.wells) || typeof raw.wells !== 'object'
    || !Array.isArray(raw.labels) || (raw.ui !== undefined && (!raw.ui || Array.isArray(raw.ui) || typeof raw.ui !== 'object'))) {
    throw new Error('无法安全识别此原始方案，请保留原文件；仅支持 v1 孔板 JSON');
  }
  const normalized = restoreState(raw);
  const changes = [];
  const differences = [];
  function compare(before, after, path, depth = 0) {
    if (depth > 64) throw new Error('文件嵌套过深，无法安全预览，请保留原文件');
    if (Object.is(before, after)) return;
    if (before && after && typeof before === 'object' && typeof after === 'object'
      && Array.isArray(before) === Array.isArray(after)) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) compare(before[key], after[key], `${path}.${key}`, depth + 1);
    } else { changes.push(path); differences.push({path, before, after}); }
  }
  compare(raw, normalized, 'state');
  return {rawText, normalized, changes, differences, summary: {
    type: normalized.plate.type, labels: normalized.labels.length,
    assigned: Object.values(normalized.wells).filter(value => value !== null).length
  }};
}

// Save BOTH the original stored text and the current editor snapshot before confirmation.
export function backupBeforeImport(storage, key, state) {
  const backup = {version: 1, storageText: storage.getItem(key), state: structuredClone(state)};
  const previous = storage.getItem(`${key}.import-backup`);
  if (previous !== null) storage.setItem(`${key}.import-backup.${globalThis.crypto.randomUUID()}`, previous);
  storage.setItem(`${key}.import-backup`, JSON.stringify(backup));
  return backup;
}

export function readImportBackup(storage, key) {
  const text = storage.getItem(`${key}.import-backup`);
  if (text === null) throw new Error('没有可恢复的导入前备份');
  const backup = JSON.parse(text);
  if (backup.version !== 1) throw new Error('备份格式不兼容');
  return restoreState(backup.state);
}
