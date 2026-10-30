import {client,readableError} from '../../assets/js/account/client.mjs';
const params=new URLSearchParams(location.search),token=params.get('token_hash'),type=params.get('type'),code=params.get('code');
history.replaceState(null,'',location.pathname);
try {
  if(!client)throw new Error('账户服务尚未配置，请联系站点管理员');
  let result;
  if(token&&['invite','recovery','email','signup','email_change'].includes(type))result=await client.auth.verifyOtp({token_hash:token,type});
  else if(code)result=await client.auth.exchangeCodeForSession(code);
  else throw new Error('验证链接不完整或已失效，请重新申请邮件');
  if(result.error)throw result.error;
  if(['invite','recovery'].includes(type))sessionStorage.setItem('blackblues.password-flow',type);
  location.replace('/account/');
}catch(error){document.getElementById('status').textContent=readableError(error);}
