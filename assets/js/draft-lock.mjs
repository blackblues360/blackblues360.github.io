// One cooperative writer for a draft and its related backup/default keys.
// Other pages retain in-memory editing and explicit file exports.
export async function acquireDraftGuard(key, onChange = () => {}, options = {}) {
  const storage = options.storage || {getItem: k => localStorage.getItem(k), setItem: (k,v) => localStorage.setItem(k,v)};
  const locks = options.locks === undefined ? globalThis.navigator?.locks : options.locks;
  let release;
  const guard = {
    canWrite: false, snapshot: null, reason: '',
    suspend(reason) { this.canWrite = false; this.reason = reason; onChange(reason); },
    release() { this.canWrite = false; release?.(); },
    getItem(k) { return storage.getItem(k); },
    setItem(k, value) {
      if (!this.canWrite) throw new Error(this.reason || '本页处于文件模式，请手动保存');
      if (storage.getItem(key) !== this.snapshot) {
        this.suspend('其他页面已改变草稿，自动保存已暂停。请先保存本页文件，再刷新。');
        throw new Error(this.reason);
      }
      storage.setItem(k, value);
      if (k === key) this.snapshot = value;
    }
  };
  if (!locks) {
    guard.reason = '浏览器不支持可靠的跨标签锁。本页可编辑并保存文件，自动保存已暂停。';
    return guard;
  }
  await new Promise(ready => {
    locks.request(`blackblues-draft:${key}`, {mode: 'exclusive', ifAvailable: true}, async lock => {
      if (!lock) { guard.reason = '另一标签页正在编辑此草稿。本页可编辑并保存文件，自动保存已暂停；关闭其他页面后刷新可接管。'; ready(); return; }
      try { guard.snapshot = storage.getItem(key); guard.canWrite = true; }
      catch { guard.reason = '本地保存不可用。本页可编辑并保存文件。'; }
      ready();
      await new Promise(resolve => { release = resolve; });
      guard.suspend('编辑锁已释放，请保存文件并刷新后继续自动保存。');
    }).catch(() => { guard.suspend('无法取得可靠的编辑锁，本页仅手动保存文件。'); ready(); });
  });
  globalThis.addEventListener?.('storage', event => {
    if (event.key === key && event.newValue !== guard.snapshot) guard.suspend('其他页面已改变草稿，自动保存已暂停。请先保存本页文件，再刷新。');
  });
  globalThis.addEventListener?.('pagehide', () => { guard.canWrite = false; release?.(); });
  globalThis.addEventListener?.('pageshow', event => {
    if (event.persisted) guard.suspend('页面从历史恢复，自动保存已暂停。请先保存文件，再刷新以重新取得编辑锁。');
  });
  return guard;
}
