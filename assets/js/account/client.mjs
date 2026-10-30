import {createClient} from '../../vendor/supabase.mjs';
import {accountConfig} from './config.mjs';
export const configured = Boolean(accountConfig.url && accountConfig.publishableKey);
export const client = configured ? createClient(accountConfig.url, accountConfig.publishableKey, {
  auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce', storageKey: 'blackblues.auth.v1'}
}) : null;

let user = null, session = null, epoch = 0;
const listeners = new Set(), pending = new Set();
export const currentAccount = () => ({user, session, epoch});
export function observeAccount(listener) { listeners.add(listener); listener(currentAccount()); return () => listeners.delete(listener); }
if (client) client.auth.onAuthStateChange((_event, next) => {
  if (user?.id !== next?.user?.id) { epoch++; for (const request of pending) request.abort(); pending.clear(); }
  session = next; user = next?.user || null;
  for (const listener of listeners) listener(currentAccount());
});

export async function accountRequest(operation) {
  if (!client || !user) throw new Error('请先登录');
  const generation = epoch, owner = user.id, token = session?.access_token, controller = new AbortController();
  if (!token) throw new Error('登录会话不可用，请重新登录');
  pending.add(controller);
  try {
    // The SDK otherwise reads its latest session asynchronously at send time.
    // Bind the initiating identity even if a cross-tab account change races it.
    const request = operation(client, owner, controller.signal);
    if (!request || typeof request.setHeader !== 'function') throw new Error('账户请求必须返回数据库请求');
    const result = await request.setHeader('Authorization', `Bearer ${token}`);
    if (generation !== epoch || owner !== user?.id) throw new Error('账户已切换，本次请求结果已忽略');
    if (result.error) throw result.error;
    return result.data;
  } finally { pending.delete(controller); }
}
export const callbackUrl = () => new URL('/account/callback/', location.origin).href;
export function readableError(error) {
  if (error?.code === '54000') return /rate/.test(error.message || '') ? '保存过于频繁，修改仍保留，请稍后重试。' : '已达到内测容量或数量限制，修改仍保留；请导出数据并联系管理员。';
  if (/Invalid login credentials/i.test(error?.message || '')) return '邮箱或密码不正确，请核对后重试。';
  if (error?.code === '23505') return '记录已存在，请读取云端版本或另存副本。';
  if (error?.code === '23514') return '内容不符合保存要求或超过容量限制，本页修改仍保留。';
  if (error?.code === '42501') return '当前账户没有此项操作权限。';
  if (/fetch|network|abort/i.test(error?.message || '')) return '网络连接中断，修改仍保留，请稍后重试。';
  return error?.message || '操作失败，请重试。';
}
