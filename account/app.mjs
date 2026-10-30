import {client,configured,observeAccount,currentAccount,callbackUrl,readableError} from '../assets/js/account/client.mjs';
import {accountConfig} from '../assets/js/account/config.mjs';
import {loadProfile,updateNickname,exportPrivateData} from '../assets/js/account/data.mjs';
const $=id=>document.getElementById(id),status=$('status');
let shownUser;
const message=text=>{status.textContent=text;};
function showAuthPane(register){
  $('loginPane').hidden=register;$('registerPane').hidden=!register;
  for(const [id,selected] of [['loginTab',!register],['registerTab',register]]){$(id).setAttribute('aria-selected',String(selected));$(id).tabIndex=selected?0:-1;}
}
$('loginTab').onclick=$('showLogin').onclick=()=>showAuthPane(false);
$('registerTab').onclick=$('showRegister').onclick=()=>showAuthPane(true);
document.querySelector('.auth-tabs').onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const register=event.key==='End'||(event.key!=='Home'&&$('loginTab').getAttribute('aria-selected')==='true');showAuthPane(register);$(register?'registerTab':'loginTab').focus();};
$('togglePassword').onclick=()=>{const visible=$('password').type==='password';$('password').type=visible?'text':'password';$('togglePassword').setAttribute('aria-pressed',String(visible));$('togglePassword').setAttribute('aria-label',visible?'隐藏密码':'显示密码');};
$('openReset').onclick=()=>{$('resetDetails').hidden=!$('resetDetails').hidden;$('openReset').setAttribute('aria-expanded',String(!$('resetDetails').hidden));if(!$('resetDetails').hidden){$('resetEmail').value=$('email').value;$('resetEmail').focus();}};
for(const button of document.querySelectorAll('[data-account-help]'))button.onclick=()=>$('accountHelp').showModal();
$('showPrivacy').onclick=()=>$('accountPrivacy').showModal();
try{const remembered=localStorage.getItem('blackblues.account.remembered-email');if(remembered){$('email').value=remembered;$('rememberEmail').checked=true;}}catch{}
$('rememberEmail').onchange=()=>{if(!$('rememberEmail').checked)try{localStorage.removeItem('blackblues.account.remembered-email');}catch{}};
if(!configured) {message('账户服务尚未配置，当前网站内容仍可正常使用。');for(const el of document.querySelectorAll('form button'))el.disabled=true;}
observeAccount(({user,epoch})=>{
  if(user?.id===shownUser)return;
  shownUser=user?.id;
  $('password').value='';$('nickname').value='';$('newPassword').value='';$('confirmPassword').value='';
  $('password').type='password';$('togglePassword').setAttribute('aria-pressed','false');$('togglePassword').setAttribute('aria-label','显示密码');
  $('signedOut').hidden=Boolean(user);$('signedIn').hidden=!user;
  const flow=sessionStorage.getItem('blackblues.password-flow');
  $('setPasswordForm').hidden=!user||!['invite','recovery'].includes(flow);
  if(!user)return;
  $('identity').textContent=`${user.email} · ${user.email_confirmed_at?'邮箱已验证':'邮箱待验证'}`;
  $('nickname').disabled=true;$('profileForm').querySelector('button[type=submit]').disabled=true;
  $('passwordIdentity').textContent=`为 ${user.email} 设置密码`;
  const subject=encodeURIComponent('blackblues.xyz 账户注销申请');
  $('deleteRequest').href=`mailto:${accountConfig.deletionEmail}?subject=${subject}&body=${encodeURIComponent(`申请注销账户：${user.email}\n账户ID：${user.id}\n我已导出需要保留的数据，请告知核验及删除流程。`)}`;
  setTimeout(async()=>{if(currentAccount().epoch!==epoch)return;try{const profile=await loadProfile();if(currentAccount().epoch===epoch)$('nickname').value=profile.display_name;}catch(error){if(currentAccount().epoch===epoch)message(`已登录；资料暂未载入，不影响应用使用。${readableError(error)}`);}finally{if(currentAccount().epoch===epoch){$('nickname').disabled=false;$('profileForm').querySelector('button[type=submit]').disabled=false;}}},0);
});
async function submit(form,operation) {
  const button=form.querySelector('button[type=submit]');button.disabled=true;
  try{await operation();}catch(error){message(readableError(error));}finally{button.disabled=!configured;}
}
$('loginForm').onsubmit=event=>{event.preventDefault();submit(event.currentTarget,async()=>{
  const email=$('email').value.trim(),remember=$('rememberEmail').checked;
  const {error}=await client.auth.signInWithPassword({email,password:$('password').value});if(error)throw error;
  try{if(remember)localStorage.setItem('blackblues.account.remembered-email',email);else localStorage.removeItem('blackblues.account.remembered-email');}catch{}
  message('已登录。');
});};
$('resetForm').onsubmit=event=>{event.preventDefault();submit(event.currentTarget,async()=>{
  const {error}=await client.auth.resetPasswordForEmail($('resetEmail').value.trim(),{redirectTo:callbackUrl()});if(error)throw error;message('若此邮箱属于受邀账户，将收到重置邮件。');
});};
$('profileForm').onsubmit=event=>{event.preventDefault();const generation=currentAccount().epoch;submit(event.currentTarget,async()=>{await updateNickname($('nickname').value.trim());if(currentAccount().epoch===generation)message('昵称已保存。');});};
$('signOut').onclick=async()=>{const {error}=await client.auth.signOut();if(error)message(readableError(error));else{sessionStorage.removeItem('blackblues.password-flow');message('已退出登录，旧账户界面已清空。');}};
$('setPasswordForm').onsubmit=event=>{event.preventDefault();submit(event.currentTarget,async()=>{
  if($('newPassword').value!==$('confirmPassword').value)throw new Error('两次密码不一致');
  const {error}=await client.auth.updateUser({password:$('newPassword').value});if(error)throw error;
  sessionStorage.removeItem('blackblues.password-flow');$('setPasswordForm').hidden=true;$('newPassword').value='';$('confirmPassword').value='';message('密码已更新。');
});};
$('exportData').onclick=async()=>{const generation=currentAccount().epoch;$('exportData').disabled=true;try{
  const data=await exportPrivateData();if(currentAccount().epoch!==generation)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='blackblues-private-data.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);message('已导出当前账户数据，文件含私人内容，请妥善保存。');
}catch(error){message(readableError(error));}finally{$('exportData').disabled=false;}};
