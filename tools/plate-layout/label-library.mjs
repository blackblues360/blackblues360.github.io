import {cleanText, nextColor} from './core.mjs';

export const EMPTY_LIBRARY = {groups: [], labels: []};
export const labelKey = name => cleanText(name).toLowerCase();
const COLOR = /^#[0-9a-f]{6}$/i;

export function readLibrary(content) {
  if (!Array.isArray(content?.groups) || !Array.isArray(content?.labels)) throw new Error('标签库格式无法读取。');
  const groups = [], labels = [];
  const groupIds = new Set(), groupNames = new Set(), names = new Set();
  for (const group of content.groups) {
    if (typeof group?.id !== 'string' || !/^[0-9a-f-]{36}$/.test(group.id) || typeof group.name !== 'string' ||
      !group.name || group.name.length > 60 || cleanText(group.name) !== group.name ||
      groupIds.has(group.id) || groupNames.has(labelKey(group.name))) throw new Error('标签库分类无法读取。');
    groupIds.add(group.id);
    groupNames.add(labelKey(group.name));
    groups.push({id: group.id, name: group.name});
  }
  for (const label of content.labels) {
    if (typeof label?.name !== 'string' || !label.name || cleanText(label.name) !== label.name ||
      typeof label.color !== 'string' || !COLOR.test(label.color) || names.has(labelKey(label.name)) ||
      (label.groupId !== null && !groupIds.has(label.groupId))) throw new Error('标签库条目无法读取。');
    names.add(labelKey(label.name));
    labels.push({name: label.name, color: label.color.toLowerCase(), groupId: label.groupId});
  }
  return {groups, labels};
}

export function suggestLibraryColor(library, groupId = null, avoid = []) {
  const used = [...library.labels, ...avoid];
  const peers = library.labels.filter(label => label.groupId === groupId);
  if (!peers.length) return nextColor(used);
  const rgb = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  const colors = peers.map(label => rgb(label.color));
  let bestColor, bestDistance = -1;
  for (let index = 0; index < 18; index++) {
    const color = nextColor(used);
    used.push({color});
    const [r, g, b] = rgb(color);
    const distance = Math.min(...colors.map(([red, green, blue]) => 2 * (r - red) ** 2 + 4 * (g - green) ** 2 + 3 * (b - blue) ** 2));
    if (distance > bestDistance) { bestDistance = distance; bestColor = color; }
  }
  return bestColor;
}

export function changeLibrary(library, action) {
  const {groups, labels} = library;
  if (action.type === 'createGroup' || action.type === 'renameGroup') {
    const name = cleanText(action.name);
    if (!name || name.length > 60) throw new Error('请输入 1–60 字的分类名称。');
    if (labelKey(name) === '未分类' || groups.some(group => group.id !== action.id && labelKey(group.name) === labelKey(name))) {
      throw new Error('已有同名分类。');
    }
    if (action.type === 'renameGroup') {
      if (!groups.some(group => group.id === action.id)) throw new Error('这个分类已删除。');
      return {...library, groups: groups.map(group => group.id === action.id ? {...group, name} : group)};
    }
    if (groups.length >= 40) throw new Error('个人标签库最多保留 40 个分类。');
    return {...library, groups: [...groups, {id: action.id, name}]};
  }
  if (action.type === 'removeGroup') {
    return {groups: groups.filter(group => group.id !== action.id), labels: labels.map(label => label.groupId === action.id ? {...label, groupId: null} : label)};
  }

  const name = cleanText(action.name);
  const key = labelKey(name);
  const existing = labels.find(label => labelKey(label.name) === key);
  if (action.type === 'removeLabel') return existing ? {...library, labels: labels.filter(label => label !== existing)} : library;
  if (action.type === 'remember' && existing) return library;
  if (action.type === 'addLabel' && existing) throw new Error('已有同名标签，可直接编辑该条目。');
  if (action.type !== 'addLabel' && action.type !== 'remember' && !existing) throw new Error('这个标签已从个人库移除。');
  const groupId = action.type === 'setColor' ? existing.groupId : action.groupId ?? null;
  if (groupId !== null && !groups.some(group => group.id === groupId)) throw new Error('这个分类已删除，请重新选择。');
  if (action.type === 'moveLabel') {
    return groupId === existing.groupId ? library : {...library, labels: labels.map(label => label === existing ? {...label, groupId} : label)};
  }
  if (!name || typeof action.color !== 'string' || !COLOR.test(action.color)) throw new Error('请填写标签名称并选择有效颜色。');
  const color = action.color.toLowerCase();
  if (existing) return color === existing.color ? library : {...library, labels: labels.map(label => label === existing ? {...label, color} : label)};
  if (labels.length >= 500) throw new Error('个人标签库最多保留 500 个标签，请先移除不需要的条目。');
  return {...library, labels: [...labels, {name, color, groupId}]};
}
