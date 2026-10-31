import {configured,observeAccount,currentAccount,readableError} from '../../assets/js/account/client.mjs';
import {listAnniversaries,saveAnniversary,deleteAnniversary} from '../../assets/js/account/data.mjs';
import {acquireDraftGuard} from '../../assets/js/draft-lock.mjs';
import {parseDate,anniversaryStats} from './dates.mjs';
const $=id=>document.getElementById(id);
let owner=null,records=[],editing=null,dirty=false,cache=null,loadNumber=0,busy=false;
const message=text=>{$('status').textContent=text;};
function setBusy(value){busy=value;$('fields').disabled=value;$('new').disabled=value;$('emptyAdd').disabled=value;$('refresh').disabled=value;for(const button of $('list').querySelectorAll('button'))button.disabled=value;}
function formRecord(){return {...editing,title:$('title').value.trim(),event_date:$('eventDate').value,repeat_annually:$('repeat').checked,notes:$('notes').value};}
function rememberDraft(){dirty=true;if(cache?.canWrite){try{cache.setItem(`blackblues.anniversaries.pending.v1:${owner}`,JSON.stringify(formRecord()));}catch{message('本机草稿未能保存，请导出本页草稿；表单内容仍保留。');}}}
function showEditor(record=null){editing=record?{...record}:{id:crypto.randomUUID(),revision:null,title:'',event_date:'',repeat_annually:false,notes:''};$('title').value=editing.title;$('eventDate').value=editing.event_date;$('repeat').checked=editing.repeat_annually;$('notes').value=editing.notes;$('delete').hidden=editing.revision===null;$('editorTitle').textContent=editing.revision===null?'新建纪念日':'编辑纪念日';$('conflictActions').hidden=true;dirty=false;for(const button of $('list').querySelectorAll('button'))button.classList.toggle('is-current',button.dataset.recordId===editing.id);}
function renderList(){
  $('list').replaceChildren();
  const sorted=[...records].sort((a,b)=>{
    const x=anniversaryStats(a.event_date,a.repeat_annually),y=anniversaryStats(b.event_date,b.repeat_annually);
    return (x.remaining===null||x.remaining<0?Infinity:x.remaining)-(y.remaining===null||y.remaining<0?Infinity:y.remaining);
  });
  $('emptyState').hidden=sorted.length>0;$('featured').hidden=sorted.length===0;
  for(const record of sorted){
    const stat=anniversaryStats(record.event_date,record.repeat_annually),li=document.createElement('li'),button=document.createElement('button'),count=document.createElement('span'),number=document.createElement('b'),unit=document.createElement('span'),body=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');
    count.className='day-count';body.className='item-content';number.textContent=stat.remaining===null?'—':stat.remaining===0?'今天':String(Math.abs(stat.remaining));unit.textContent=stat.remaining===null?'暂无下次':stat.remaining===0?'就是今天':stat.remaining>0?'天后':'天前';count.append(number,unit);
    name.textContent=record.title;detail.textContent=`${record.event_date}${record.repeat_annually?' · 每年重复':' · 一次性'}`;body.append(name,detail);
    if(record.notes){const note=document.createElement('span');note.className='item-note';note.textContent=record.notes;body.append(note);}
    button.disabled=busy;button.dataset.recordId=record.id;button.classList.toggle('is-current',record.id===editing?.id);button.append(count,body);button.onclick=()=>{if(busy)return;if(dirty&&!confirm('切换记录前，请确认本页草稿已导出或无需保留。'))return;showEditor(record);};li.append(button);$('list').append(li);
  }
  const first=sorted[0];if(!first){$('featuredTitle').textContent='尚无纪念日';$('featuredDays').textContent='—';$('featuredDetail').textContent='添加第一个重要的日子。';return;}
  const stat=anniversaryStats(first.event_date,first.repeat_annually);$('featuredTitle').textContent=first.title;$('featuredDays').textContent=stat.remaining===null?'—':stat.remaining>=0?`${stat.remaining} 天`:`${stat.passed} 天`;$('featuredDetail').textContent=stat.remaining>=0?`距离下一次：${stat.next}；${stat.passed>=0?`自原始日期已过去 ${stat.passed} 天`:'尚未发生'}`:'自原始日期已过去';
}
async function refresh(){const generation=currentAccount().epoch,request=++loadNumber;try{const next=await listAnniversaries();if(currentAccount().epoch!==generation||request!==loadNumber)return false;records=next;renderList();message(`已从云端读取 ${records.length} 条记录。`);return true;}catch(error){if(currentAccount().epoch===generation&&request===loadNumber)message(readableError(error));return false;}}
observeAccount(({user,epoch})=>{
  if(user?.id===owner)return;
  cache?.release();cache=null;owner=user?.id||null;records=[];editing=null;dirty=false;loadNumber++;$('title').value='';$('eventDate').value='';$('notes').value='';$('repeat').checked=false;$('list').replaceChildren();$('accountLabel').textContent='';$('accountChip').hidden=!user;setBusy(false);$('intro').hidden=Boolean(user);$('workspace').hidden=!user;
  if(!user){message(configured?'请先登录以读取私人纪念日。':'账户服务尚未配置，暂不读取或保存云端数据。');return;}
  $('accountLabel').textContent=user.email;showEditor();renderList();setBusy(true);message('正在确认本机草稿和云端记录…');
  setTimeout(async()=>{
    const key=`blackblues.anniversaries.pending.v1:${user.id}`,guard=await acquireDraftGuard(key,text=>{if(currentAccount().epoch===epoch)message(text);});
    if(currentAccount().epoch!==epoch){guard.release();return;}cache=guard;
    try{const raw=guard.getItem(key);if(raw){const pending=JSON.parse(raw);if(pending!==null){if(!pending||typeof pending.id!=='string'||typeof pending.title!=='string'||typeof pending.notes!=='string'||typeof pending.event_date!=='string'||typeof pending.repeat_annually!=='boolean'||!(pending.revision===null||(Number.isSafeInteger(pending.revision)&&pending.revision>0)))throw new Error('草稿格式无法识别');if(confirm('当前账户有未同步草稿，是否恢复到表单？')){showEditor(pending);dirty=true;}}}}catch{guard.suspend('本机草稿无法安全读取，自动写回已暂停；原始存储保持不变，请手动导出本页修改。');}
    setBusy(false);await refresh();if(currentAccount().epoch===epoch&&!guard.canWrite)message(`${guard.reason} 云端保存仍需手动确认；保存失败时请导出草稿。`);
  },0);
});
$('editor').addEventListener('input',()=>{message('本页有未保存修改。');rememberDraft();});
$('new').onclick=$('emptyAdd').onclick=()=>{if(busy)return;if(dirty&&!confirm('新建前，请确认当前草稿已导出或无需保留。'))return;showEditor();renderList();$('title').focus();};
$('refresh').onclick=()=>{if(!busy)refresh();};
$('editor').onsubmit=async event=>{event.preventDefault();if(busy)return;const generation=currentAccount().epoch,record=formRecord();try{
  parseDate(record.event_date);if(!record.title)throw new Error('请输入纪念日名称');setBusy(true);
  const saved=await saveAnniversary(record);if(currentAccount().epoch!==generation)return;
  showEditor(saved);let cleared=true;if(cache?.canWrite){try{cache.setItem(`blackblues.anniversaries.pending.v1:${owner}`,'null');}catch{cleared=false;}}const refreshed=await refresh();if(currentAccount().epoch===generation)message(!cleared?'云端已保存，本机草稿未能清空，请确认后处理。':refreshed?'已保存到云端。':'保存已成功，列表暂未刷新；当前内容仍保留。');
}catch(error){if(currentAccount().epoch===generation){message(readableError(error));$('conflictActions').hidden=false;rememberDraft();}}finally{if(currentAccount().epoch===generation)setBusy(false);}};
$('delete').onclick=async()=>{if(busy||!editing?.revision||!confirm('删除这条纪念日？将保留云端删除标记，避免旧请求重新创建。'))return;const generation=currentAccount().epoch;setBusy(true);try{await deleteAnniversary(editing);if(currentAccount().epoch!==generation)return;showEditor();if(cache?.canWrite){try{cache.setItem(`blackblues.anniversaries.pending.v1:${owner}`,'null');}catch{message('云端记录已删除，但本机旧草稿仍在，请确认后处理。');}}await refresh();}catch(error){if(currentAccount().epoch===generation)message(readableError(error));}finally{if(currentAccount().epoch===generation)setBusy(false);}};
$('copyAsNew').onclick=()=>{const record=formRecord();showEditor({...record,id:crypto.randomUUID(),revision:null});rememberDraft();message('已作为新记录准备，请确认后保存。');};
$('reloadCloud').onclick=async()=>{if(busy||!confirm('载入前请先导出本页草稿。确认放弃本页修改并读取云端版本？'))return;const generation=currentAccount().epoch,id=editing.id,snapshot=JSON.stringify(formRecord());setBusy(true);try{if(!await refresh()||currentAccount().epoch!==generation)return;if(JSON.stringify(formRecord())!==snapshot){message('载入期间表单已变化，已保留本页修改。');return;}const record=records.find(item=>item.id===id);if(record)showEditor(record);else message('该云端记录已不可见，本页内容仍保留，可另存新记录。');}finally{if(currentAccount().epoch===generation)setBusy(false);}};
$('draftExport').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(formRecord(),null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='anniversary-pending.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
