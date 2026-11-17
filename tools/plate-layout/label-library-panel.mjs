import {accountRequest, currentAccount, observeAccount} from '../../assets/js/account/client.mjs';
import {cleanText} from './core.mjs';
import {EMPTY_LIBRARY, changeLibrary, labelKey, readLibrary, suggestLibraryColor} from './label-library.mjs';

const TABLE = 'plate_label_libraries';

export function mountLabelLibrary({onChange, onApply, notify}) {
  const get = id => document.getElementById(id);
  const dialog = get('personalLibraryDialog');
  const open = get('openPersonalLibrary');
  const status = get('personalLibraryStatus');
  const summary = get('personalLibrarySummary');
  const groupsRoot = get('personalLibraryGroups');
  const labelForm = get('personalLabelForm');
  const name = get('personalLabelName');
  const color = get('personalLabelColor');
  const groupSelect = get('personalLabelGroup');
  const groupForm = get('personalGroupForm');
  const groupName = get('personalGroupName');
  const search = get('personalLabelSearch');
  const refresh = get('refreshPersonalLibrary');
  let library = EMPTY_LIBRARY;
  let scope = null;
  let draggedLabel = '';
  let manualColor = false;

  function sameAccount(target) {
    const account = currentAccount();
    return scope === target && account.user?.id === target.userId && account.epoch === target.epoch;
  }

  async function readRow(target) {
    if (!sameAccount(target)) throw new Error('登录账户已切换。');
    return accountRequest((db, id, signal) => db.from(TABLE)
      .select('revision,content').eq('user_id', id).maybeSingle().abortSignal(signal));
  }

  async function saveChange(target, action) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await readRow(target);
      if (!sameAccount(target)) throw new Error('登录账户已切换。');
      const base = row ? readLibrary(row.content) : EMPTY_LIBRARY;
      const next = changeLibrary(base, action);
      if (next === base) return base;
      try {
        const saved = await accountRequest((db, id, signal) => {
          const records = db.from(TABLE);
          const write = row ? records.update({revision: row.revision + 1, content: next}).eq('user_id', id).eq('revision', row.revision)
            : records.insert({user_id: id, content: next});
          return write.select('revision').maybeSingle().abortSignal(signal);
        });
        if (saved) return next;
      } catch (error) {
        if (row || error.code !== '23505') throw error;
      }
    }
    throw new Error('其他设备正在更新标签库，请同步后再试。');
  }

  function actionError(error) {
    if (['42P01', 'PGRST205'].includes(error.code)) return '个人标签库服务尚未启用。';
    if (/fetch|network/i.test(error.message || '')) return '标签库连接暂不可用，可稍后同步。';
    return error.message || '标签库更新失败，请稍后重试。';
  }

  function queue(target, task) {
    const result = target.tail.then(async () => {
      if (!sameAccount(target)) return false;
      try { return await task(); }
      catch (error) {
        if (sameAccount(target)) {
          status.textContent = actionError(error);
          renderStatus();
        }
        return false;
      }
    });
    target.tail = result;
    return result;
  }

  function commit(action) {
    const target = scope;
    if (!target) return Promise.resolve(false);
    return queue(target, async () => {
      status.textContent = '正在同步标签库…';
      const next = await saveChange(target, action);
      if (!sameAccount(target)) return false;
      library = next;
      if (['remember', 'addLabel', 'removeLabel'].includes(action.type)) target.pending.delete(labelKey(action.name));
      target.loaded = true;
      status.textContent = '个人标签库已同步。';
      render();
      onChange();
      return true;
    });
  }

  async function sync() {
    const target = scope;
    if (!target) return;
    const ok = await queue(target, async () => {
      status.textContent = '正在读取个人标签库…';
      const row = await readRow(target);
      if (!sameAccount(target)) return false;
      library = row ? readLibrary(row.content) : EMPTY_LIBRARY;
      target.loaded = true;
      status.textContent = '个人标签库已同步。';
      render();
      onChange();
      return true;
    });
    if (ok && sameAccount(target)) {
      for (const action of target.pending.values()) commit(action);
    }
  }

  function renderStatus() {
    const pending = scope?.pending.size ?? 0;
    summary.textContent = pending ? `${pending} 个新标签待同步` : scope?.loaded ? `${library.labels.length} 个个人标签` : '';
    refresh.textContent = pending ? `同步 (${pending} 待保存)` : '同步';
  }

  function fillGroups(select, value) {
    select.replaceChildren(new Option('未分类', ''), ...library.groups.map(group => new Option(group.name, group.id)));
    select.value = library.groups.some(group => group.id === value) ? value : '';
  }

  function button(text, click, className = 'button subtle') {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.textContent = text;
    node.addEventListener('click', click);
    return node;
  }

  function render() {
    open.disabled = !scope;
    refresh.disabled = !scope;
    for (const form of [labelForm, groupForm]) {
      for (const control of form.elements) control.disabled = !scope?.loaded;
    }
    renderStatus();
    fillGroups(groupSelect, groupSelect.value);
    if (!manualColor) color.value = suggestLibraryColor(library, groupSelect.value || null);
    groupsRoot.replaceChildren();
    const query = labelKey(search.value);
    for (const group of [{id: null, name: '未分类'}, ...library.groups]) {
      const section = document.createElement('section');
      section.className = 'personal-library-group';
      section.dataset.dropGroup = group.id ?? '';
      const head = document.createElement('div');
      head.className = 'section-heading';
      const title = document.createElement('h3');
      title.textContent = group.name;
      head.append(title);
      if (group.id) head.append(
        button('重命名', () => {
          const value = window.prompt('分类名称', group.name);
          if (value !== null && cleanText(value) !== group.name) commit({type: 'renameGroup', id: group.id, name: value});
        }),
        button('删除分类', () => {
          if (window.confirm(`删除「${group.name}」分类？其中的标签将移回未分类。`)) commit({type: 'removeGroup', id: group.id});
        })
      );
      section.append(head);
      const labels = library.labels.filter(label => label.groupId === group.id);
      if (new Set(labels.map(label => label.color)).size < labels.length) {
        const warning = document.createElement('p');
        warning.className = 'editor-hint';
        warning.textContent = '分类中有标签使用相同颜色，可点击色块调整。';
        section.append(warning);
      }
      for (const label of labels) {
        const key = labelKey(label.name);
        if (!key.includes(query)) continue;
        const row = document.createElement('div');
        row.className = 'personal-library-entry';
        const grip = document.createElement('span');
        grip.className = 'personal-library-grip';
        grip.textContent = '⠿';
        grip.draggable = true;
        grip.dataset.dragLabel = key;
        grip.title = `拖动 ${label.name} 到分类`;
        const swatch = document.createElement('input');
        swatch.type = 'color';
        swatch.value = label.color;
        swatch.setAttribute('aria-label', `更改个人标签 ${label.name} 的颜色`);
        swatch.onchange = async () => {
          const ok = await commit({type: 'setColor', name: label.name, color: swatch.value});
          if (!ok) swatch.value = label.color;
        };
        const apply = button(label.name, () => { if (onApply(label)) dialog.close(); }, 'apply-existing');
        const remove = button('×', () => {
          if (window.confirm(`从个人标签库移除「${label.name}」？`)) commit({type: 'removeLabel', name: label.name});
        }, 'delete-label');
        remove.setAttribute('aria-label', `从个人库移除 ${label.name}`);
        const move = document.createElement('select');
        move.setAttribute('aria-label', `移动 ${label.name} 到分类`);
        fillGroups(move, label.groupId);
        move.onchange = async () => {
          const ok = await commit({type: 'moveLabel', name: label.name, groupId: move.value || null});
          if (!ok) move.value = label.groupId ?? '';
        };
        row.append(grip, swatch, apply, remove, move);
        section.append(row);
      }
      groupsRoot.append(section);
    }
  }

  open.onclick = () => { dialog.showModal(); sync(); };
  get('closePersonalLibrary').onclick = () => dialog.close();
  refresh.onclick = sync;
  window.addEventListener('online', sync);
  search.oninput = render;
  color.oninput = () => { manualColor = true; };
  groupSelect.onchange = () => { manualColor = false; color.value = suggestLibraryColor(library, groupSelect.value || null); };
  labelForm.onsubmit = async event => {
    event.preventDefault();
    const value = name.value;
    if (await commit({type: 'addLabel', name: value, color: color.value, groupId: groupSelect.value || null}) && name.value === value) {
      name.value = '';
      manualColor = false;
      color.value = suggestLibraryColor(library, groupSelect.value || null);
    }
  };
  groupForm.onsubmit = async event => {
    event.preventDefault();
    const value = groupName.value;
    if (await commit({type: 'createGroup', id: crypto.randomUUID(), name: value}) && groupName.value === value) groupName.value = '';
  };
  groupsRoot.ondragstart = event => {
    draggedLabel = event.target.closest('[data-drag-label]')?.dataset.dragLabel || '';
    if (draggedLabel) {
      event.dataTransfer.setData('text/plain', draggedLabel);
      event.dataTransfer.effectAllowed = 'move';
    }
  };
  groupsRoot.ondragover = event => {
    const target = event.target.closest('[data-drop-group]');
    if (!draggedLabel || !target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    for (const group of groupsRoot.children) group.classList.toggle('is-drop-target', group === target);
  };
  groupsRoot.ondragleave = event => {
    const target = event.target.closest('[data-drop-group]');
    if (target && !target.contains(event.relatedTarget)) target.classList.remove('is-drop-target');
  };
  groupsRoot.ondrop = event => {
    const target = event.target.closest('[data-drop-group]');
    if (!draggedLabel || !target) return;
    event.preventDefault();
    const label = library.labels.find(item => labelKey(item.name) === draggedLabel);
    draggedLabel = '';
    target.classList.remove('is-drop-target');
    if (label) commit({type: 'moveLabel', name: label.name, groupId: target.dataset.dropGroup || null});
  };
  groupsRoot.ondragend = () => {
    draggedLabel = '';
    for (const group of groupsRoot.children) group.classList.remove('is-drop-target');
  };

  observeAccount(({user, epoch}) => {
    if (scope?.userId === user?.id && scope?.epoch === epoch) return;
    scope = user ? {userId: user.id, epoch, loaded: false, pending: new Map(), tail: Promise.resolve()} : null;
    library = EMPTY_LIBRARY;
    draggedLabel = '';
    manualColor = false;
    labelForm.reset();
    groupForm.reset();
    search.value = '';
    if (dialog.open) dialog.close();
    status.textContent = user ? '正在读取个人标签库…' : '登录后可使用个人标签库。';
    render();
    onChange();
    if (scope) sync();
  });

  return {
    find: name => library.labels.find(label => labelKey(label.name) === labelKey(name)),
    suggest: avoid => suggestLibraryColor(library, null, avoid),
    remember(label) {
      if (!scope || !label || library.labels.some(item => labelKey(item.name) === labelKey(label.name))) return;
      const key = labelKey(label.name);
      if (scope.pending.has(key)) return;
      const action = {type: 'remember', name: label.name, color: label.color};
      scope.pending.set(key, action);
      renderStatus();
      const target = scope;
      commit(action).then(ok => { if (!ok && sameAccount(target)) notify('标签已应用到孔板，个人库待同步。'); });
    }
  };
}
