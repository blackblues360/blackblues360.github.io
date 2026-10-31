import {importDocument} from './core.mjs?v=5';

export function loadDraft(storage, key) {
  let raw = null;
  try {
    raw = storage.getItem(key);
    if (raw === null) return {status: 'missing', raw, document: null};
    return {status: 'restored', raw, document: importDocument(raw)};
  } catch (error) {
    return {status: 'failed', raw, document: null, error: error.message};
  }
}

export function saveDraft(recovery, storage, key, document) {
  if (recovery.status === 'failed') return false;
  storage.setItem(key, JSON.stringify(document));
  return true;
}

// Called only after the user explicitly confirms replacing the unreadable draft.
export function replaceFailedDraft(recovery, storage, key, document) {
  if (recovery.status !== 'failed') throw new Error('草稿不在恢复失败状态');
  const next = importDocument(JSON.stringify(document));
  if (storage.getItem(key) !== recovery.raw) throw new Error('原草稿已在其他页面变化，请刷新后重新处理');
  if (recovery.raw !== null) {
    const previous = storage.getItem(`${key}.recovery`);
    if (previous !== null && previous !== recovery.raw) storage.setItem(`${key}.recovery.${globalThis.crypto.randomUUID()}`, previous);
    storage.setItem(`${key}.recovery`, recovery.raw);
  }
  storage.setItem(key, JSON.stringify(next));
  recovery.status = 'restored';
  recovery.document = next;
  return next;
}
