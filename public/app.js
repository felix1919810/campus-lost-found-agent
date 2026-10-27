const $=s=>document.querySelector(s);
let sessionId=null, running=false;
const fileUrls=new Set();
async function api(url,options){const r=await fetch(url,options);const d=await r.json();if(!r.ok)throw new Error(d.error || '请求失败');return d;}
function message(role,text){const box=document.createElement('div');box.className=`message ${role}`;const label=document.createElement('span');label.className='message-label';label.textContent=role==='user'?'你':role==='error'?'处理提示':'寻回';box.append(label,document.createTextNode(String(text)));$('#messages .empty')?.remove();$('#messages').append(box);$('#messages').scrollTop=$('#messages').scrollHeight;}
function eventView(event){
  if(event.type==='model'){const p=document.createElement('p');p.className='model-event';p.textContent=`${String(event.round).padStart(2,'0')} — ${event.label}`;$('#trace').append(p);}
  if(event.type==='tool_start'){const d=document.createElement('details');d.className='trace-step';const s=document.createElement('summary');s.textContent=`→ ${event.name} · 调用参数`;const pre=document.createElement('pre');pre.textContent=JSON.stringify(event.args,null,2);d.append(s,pre);$('#trace').append(d);}
  if(event.type==='tool_end'){
    const d=document.createElement('details');d.className='trace-step';const s=document.createElement('summary');s.textContent=`${event.result.error?'!':'✓'} ${event.name} · ${event.elapsedMs} ms`;
    const pre=document.createElement('pre');pre.textContent=JSON.stringify(event.result,null,2);d.append(s,pre);$('#trace').append(d);
    if(event.result.url && /^\/api\/files\/[0-9a-f-]+\/checklist-[0-9a-f-]+\.md$/.test(event.result.url) && !fileUrls.has(event.result.url)){
      fileUrls.add(event.result.url);$('#files .muted')?.remove();const a=document.createElement('a');a.className='file-link';a.href=event.result.url;a.textContent='↓ 下载领取核对清单';const small=document.createElement('small');small.textContent=(event.result.ids || []).join(' · ');a.append(small);$('#files').append(a);
    }
  }
  $('#trace').scrollTop=$('#trace').scrollHeight;
}
async function refreshSessions(){const {sessions}=await api('/api/sessions');$('#sessions').replaceChildren();for(const s of sessions){const b=document.createElement('button');b.textContent=s.title;b.classList.toggle('active',s.id===sessionId);b.disabled=running;b.onclick=()=>openSession(s.id).catch(showError);$('#sessions').append(b);}}
async function openSession(id){if(running)return;const s=await api(`/api/sessions/${id}`);sessionId=s.id;localStorage.setItem('xunhui-session',sessionId);$('#messages').replaceChildren();$('#trace').replaceChildren();$('#files').replaceChildren();fileUrls.clear();for(const t of s.turns){message('user',t.prompt);message('assistant',t.answer);t.events.forEach(eventView);}await refreshSessions();}
async function newSession(){if(running)return;const s=await api('/api/sessions',{method:'POST'});await openSession(s.id);}
function showError(e){message('error',e.message || String(e));}
async function send(prompt){
  if(running || !prompt.trim())return;
  if(!sessionId)await newSession();
  running=true;$('#send').disabled=true;$('#new-chat').disabled=true;$('#examples').querySelectorAll('button').forEach(b=>b.disabled=true);$('#sessions').querySelectorAll('button').forEach(b=>b.disabled=true);
  message('user',prompt);$('#prompt').value='';$('#trace').replaceChildren();
  try {
    const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,prompt})});
    if(!r.ok){const d=await r.json();throw new Error(d.error);}
    const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='',completed=false;
    while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){if(!line.trim())continue;const e=JSON.parse(line);if(e.type==='done'){completed=true;message('assistant',e.answer);}else if(e.type==='error'){completed=true;showError(new Error(e.error));}else eventView(e);}if(done)break;}
    if(!completed)throw new Error('连接中断，请重新打开会话检查结果。');
  }catch(e){showError(e);}finally{running=false;$('#send').disabled=false;$('#new-chat').disabled=false;$('#examples').querySelectorAll('button').forEach(b=>b.disabled=false);await refreshSessions().catch(showError);}
}
$('#new-chat').onclick=()=>newSession().catch(showError);
$('#chat-form').onsubmit=e=>{e.preventDefault();send($('#prompt').value).catch(showError);};
$('#prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send($('#prompt').value).catch(showError);}};
async function init(){
  const status=await api('/api/status');$('#mode').textContent=status.mode==='live'?`真实模型 · ${status.model}`:'离线演练 · 无模型';
  $('#notice').textContent=status.mode==='live'?(status.configured?'真实模型模式：消息和虚构物品数据将发送到你配置的模型服务。请勿输入个人敏感信息。':'真实模式尚未配置密钥。请编辑本地 .env 并重启服务。'):'当前为固定脚本离线演练，仅用于检查工具与界面，不代表 AI 验收。配置模型后可自由对话。所有物品均为虚构样例。';
  const labels=['蓝色雨伞 → 查询并导出','白色耳机 → 查询并导出','红色背包 → 无结果','LF-001 → 详情与指引'];
  status.demos.forEach((text,i)=>{const b=document.createElement('button');b.textContent=labels[i];b.onclick=()=>send(text).catch(showError);$('#examples').append(b);});
  const {items}=await api('/api/items');for(const i of items){const div=document.createElement('div');div.className='item';const title=document.createElement('strong');title.textContent=`${i.id} · ${i.name}`;const sub=document.createElement('span');sub.textContent=`${i.location} / ${i.foundAt} / ${i.status}`;div.append(title,sub);$('#inventory').append(div);}
  const saved=localStorage.getItem('xunhui-session');if(saved){try{await openSession(saved);return;}catch{localStorage.removeItem('xunhui-session');}}await newSession();
}
init().catch(showError);
