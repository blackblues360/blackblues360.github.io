import {client,configured,observeAccount,currentAccount} from './client.mjs';

const root=document.documentElement;
const bootstrap=document.querySelector('script[data-tool-entry]');
const gate=document.getElementById('toolAccessGate');
const status=gate.querySelector('[role=status]');
const login=gate.querySelector('[data-tool-login]');
const retry=gate.querySelector('button');
const next=location.pathname+location.search+location.hash;
login.href='/account/?next='+encodeURIComponent(next);
let request=0,loaded=false,activeOwner=null;
function lock(text){root.removeAttribute('data-tool-access');status.textContent=text;}
// A page that has already loaded an editor must never retain usable controls
// after logout, account replacement or failed server verification.
window.addEventListener('keydown',event=>{if(root.dataset.toolAccess!=='allowed'&&!gate.contains(event.target))event.stopImmediatePropagation();},true);
async function check(){
  const turn=++request,{user,epoch}=currentAccount();
  retry.disabled=false;
  if(!configured){lock('账户服务尚未配置，工具暂不可用。');return;}
  if(!user){lock('请先登录账户，再使用此工具。本机方案保持不变。');return;}
  if(!loaded)lock('正在验证登录状态…');retry.disabled=true;
  try{
    const {data,error}=await client.auth.getUser();
    if(turn!==request||epoch!==currentAccount().epoch)return;
    if(error||data.user?.id!==user.id)throw new Error('登录验证未完成，请重新登录或重试。');
    if(loaded&&activeOwner!==user.id){location.reload();return;}
    if(!bootstrap?.dataset.toolEntry)throw new Error('工具入口未配置。');
    const entry=new URL(bootstrap.dataset.toolEntry,location.href);
    if(entry.origin!==location.origin||!entry.pathname.startsWith(location.pathname.slice(0,location.pathname.lastIndexOf('/')+1)))throw new Error('工具入口不受支持。');
    if(!loaded){
      activeOwner=user.id;
      await import(entry.href);
      loaded=true;
    }
    if(turn!==request||epoch!==currentAccount().epoch)return;
    root.dataset.toolAccess='allowed';
  }catch(error){if(turn===request)lock(error.message||'暂时无法验证登录，请重试。');}
  finally{if(turn===request)retry.disabled=false;}
}
observeAccount(()=>{request++;lock('正在检查登录状态…');setTimeout(check,0);});
retry.onclick=check;
window.addEventListener('pageshow',event=>{if(event.persisted)check();});
window.addEventListener('focus',()=>{if(loaded)check();});
