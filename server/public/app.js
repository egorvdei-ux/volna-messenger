const root = document.querySelector('#root');
let credentials = null;
try { credentials = JSON.parse(sessionStorage.getItem('volna.session')); } catch {}
let chats = [], selected = null, messages = [], register = true, busy = false, hasOlder = false;
let generation = 0, polling = false, pending = null;
const el = (tag, cls, value) => { const node = document.createElement(tag); if(cls) node.className = cls; if(value !== undefined) node.textContent = value; return node; };
function logo() { return el('div','logo','≈'); }
function avatar(name) { return el('div','avatar',Array.from(name)[0]?.toUpperCase() || '?'); }
async function api(path, method='GET', body) {
  const token = credentials?.token;
  const response = await fetch('/api'+path, {method, headers: { ...(token ? {Authorization:'Bearer '+token} : {}), ...(body ? {'Content-Type':'application/json'} : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000)});
  const result = await response.json();
  if (!response.ok) {
    if(response.status === 401 && token && credentials?.token === token) { credentials=null; sessionStorage.removeItem('volna.session'); generation++; render(); }
    throw Error(result.error || 'Ошибка сервера');
  }
  return result;
}
function showError(target,error) { target.textContent = error?.message || String(error); }
function render() { root.replaceChildren(); if(!credentials) renderAuth(); else renderApp(); }
function renderAuth() {
  root.innerHTML = `<div class="auth"><section class="hero"><div class="wordmark"><span class="logo">≈</span>волна</div><div class="eyebrow">ПРОСТО БУДЬТЕ НА СВЯЗИ</div><h1>Расстояния.<br><em>Без значения.</em></h1><p>Для важных слов и обычных «как дела?». Ваше место для общения с близкими.</p><div class="tag"><span class="dot"></span>Личные чаты · ваш сервер</div></section><section class="card"><h2>На одной волне</h2><div class="muted">Начните свой первый разговор.</div><div class="tabs"><button id="register-tab" type="button">Регистрация</button><button id="login-tab" type="button">Вход</button></div><form id="auth-form"><div id="name-wrap"><label for="name">ВАШЕ ИМЯ</label><input id="name" maxlength="40" autocomplete="name" placeholder="Как к вам обращаться"></div><label for="username">ИМЯ ПОЛЬЗОВАТЕЛЯ</label><input id="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" autocomplete="username" placeholder="Например, egor"><label for="password">ПАРОЛЬ</label><input id="password" required type="password" minlength="8" maxlength="200" placeholder="Не менее 8 символов"><div id="auth-error" class="error" role="alert"></div><button class="primary wide" id="auth-submit">Создать аккаунт →</button></form><p class="fine">Тестовый клиент для ПК и Safari. Сервер хранит историю сообщений. В локальной сети используется HTTP; сквозного шифрования нет.</p></section></div>`;
  const toggle = value => {
    register = value;
    document.querySelector('#register-tab').classList.toggle('active',value);
    document.querySelector('#login-tab').classList.toggle('active',!value);
    document.querySelector('#name-wrap').classList.toggle('hidden',!value);
    document.querySelector('#name').required = value;
    document.querySelector('#password').autocomplete = value ? 'new-password' : 'current-password';
    document.querySelector('#auth-submit').textContent = value ? 'Создать аккаунт →' : 'Войти →';
  };
  document.querySelector('#register-tab').onclick = () => toggle(true);
  document.querySelector('#login-tab').onclick = () => toggle(false);
  toggle(register);
  document.querySelector('#auth-form').onsubmit = async event => {
    event.preventDefault(); if(busy) return; busy=true;
    const submit = document.querySelector('#auth-submit'); submit.disabled=true;
    const data = {username:document.querySelector('#username').value,password:document.querySelector('#password').value};
    if(register) data.name=document.querySelector('#name').value;
    try { credentials=await api(register?'/register':'/login','POST',data); sessionStorage.setItem('volna.session',JSON.stringify(credentials)); chats=[]; selected=null; generation++; render(); }
    catch(error) { const target=document.querySelector('#auth-error'); if(target) showError(target,error); }
    finally {busy=false;submit.disabled=false;}
  };
}
function renderApp() {
  root.innerHTML = `<div class="app"><aside class="sidebar"><div class="sidebar-head"><div class="wordmark"><span class="logo">≈</span>волна</div><div class="sidebar-actions"><span class="meta-label">ВАШИ РАЗГОВОРЫ</span><button class="icon" id="new-chat" aria-label="Новый чат">+</button></div></div><form id="search-form" class="search-form hidden"><input id="peer" placeholder="Имя пользователя друга" aria-label="Имя пользователя друга" required><button class="primary">Начать разговор</button><div class="error" id="search-error" role="alert"></div></form><div class="chatlist" id="chatlist"></div><div class="profile" id="profile"></div><div class="notice">Сервер на вашем ПК · версия 0.1</div></aside><section class="conversation" id="conversation"></section></div>`;
  const profile = document.querySelector('#profile'); profile.append(avatar(credentials.user.name));
  const copy=el('div','chatcopy'); copy.append(el('div','chatname',credentials.user.name),el('div','chatpreview','@'+credentials.user.username)); profile.append(copy);
  const logout=el('button','link','Выйти'); profile.append(logout);
  logout.onclick=async()=>{logout.disabled=true;try{await api('/logout','POST');}catch{} credentials=null;sessionStorage.removeItem('volna.session');generation++;selected=null;chats=[];render();};
  document.querySelector('#new-chat').onclick=()=>{document.querySelector('#search-form').classList.toggle('hidden');document.querySelector('#peer').focus();};
  document.querySelector('#search-form').onsubmit=async event=>{
    event.preventDefault(); const button=event.target.querySelector('button'); button.disabled=true;
    try {const chat=await api('/chats','POST',{username:document.querySelector('#peer').value.replace(/^@/,'').trim()}); document.querySelector('#search-form').classList.add('hidden');await choose(chat);await refreshChats();}
    catch(error){const target=document.querySelector('#search-error');if(target)showError(target,error);}finally{button.disabled=false;}
  };
  renderChatlist(); renderConversation(); poll();
}
function renderChatlist() {
  const list=document.querySelector('#chatlist'); if(!list)return;list.replaceChildren();
  if(!chats.length)list.append(el('p','small-empty','Пока тихо. Нажмите + и найдите друга по имени пользователя.'));
  for(const chat of chats){
    const row=el('button','chatrow'+(selected?.id===chat.id?' selected':''));row.append(avatar(chat.peer.name));
    const copy=el('div','chatcopy');copy.append(el('div','chatname',chat.peer.name),el('div','chatpreview',chat.lastMessage?.text||'Начните разговор'));row.append(copy);row.onclick=()=>choose(chat);list.append(row);
  }
}
async function choose(chat) {
  generation++;selected=chat;messages=[];hasOlder=false;pending=null;renderChatlist();renderConversation();
  const mine=generation;
  try {const rows=await api('/chats/'+chat.id+'/messages');if(mine!==generation)return;messages=rows;hasOlder=rows.length===100;renderMessages(true);}
  catch(error){if(mine===generation){const target=document.querySelector('#chat-error');if(target)showError(target,error);}}
}
function renderConversation() {
  const pane=document.querySelector('#conversation');if(!pane)return;pane.replaceChildren();document.querySelector('.app')?.classList.toggle('chat-open',!!selected);
  if(!selected){const empty=el('div','empty');empty.append(logo(),el('h2','','Ближе, чем кажется.'),el('p','','Откройте чат или начните новый разговор. Иногда одного сообщения достаточно.'),el('div','tag','Волна · пространство для ваших слов'));pane.append(empty);return;}
  const header=el('header');const back=el('button','back','‹');back.setAttribute('aria-label','Назад');back.onclick=()=>{generation++;selected=null;renderConversation();renderChatlist();};header.append(back,avatar(selected.peer.name));
  const title=el('div');title.append(el('h2','',selected.peer.name),el('div','status','@'+selected.peer.username+' · личный чат'));header.append(title);pane.append(header);
  const history=el('div','messages');history.id='messages';pane.append(history);
  const error=el('div','error chat-error');error.id='chat-error';error.setAttribute('role','alert');pane.append(error);
  const form=el('form','composer');const input=el('textarea');input.id='draft';input.rows=1;input.placeholder='Сообщение';input.setAttribute('aria-label','Сообщение');input.maxLength=8000;
  const send=el('button','send','↑');send.setAttribute('aria-label','Отправить');form.append(input,send);pane.append(form);
  input.oninput=()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,140)+'px';};
  input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit();}};
  form.onsubmit=async e=>{
    e.preventDefault();const text=input.value.trim();if(!text||send.disabled)return;
    if([...text].length>4000){error.textContent='До 4000 символов в сообщении.';return;}
    if(!pending||pending.text!==text)pending={text,client_id:crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('')};
    const mine=generation;const chatID=selected.id;send.disabled=true;input.disabled=true;
    try {const message=await api('/chats/'+chatID+'/messages','POST',pending);if(mine!==generation)return;merge([message]);input.value='';input.style.height='auto';pending=null;error.textContent='';renderMessages(true);await refreshChats();}
    catch(err){if(mine===generation)error.textContent=err.message+' Нажмите ↑, чтобы повторить.';}
    finally{send.disabled=false;input.disabled=false;input.focus();}
  };
  renderMessages(true);
}
function merge(rows){const map=new Map(messages.map(m=>[m.id,m]));for(const row of rows)map.set(row.id,row);messages=Array.from(map.values()).sort((a,b)=>a.id-b.id);}
function renderMessages(scroll=false) {
  const history=document.querySelector('#messages');if(!history)return;
  const nearBottom=history.scrollHeight-history.scrollTop-history.clientHeight<100;const oldHeight=history.scrollHeight;const oldTop=history.scrollTop;
  history.replaceChildren();
  if(hasOlder&&messages.length){const older=el('button','older','Ранние сообщения');history.append(older);older.onclick=async()=>{older.disabled=true;const mine=generation;try{const rows=await api('/chats/'+selected.id+'/messages?before='+messages[0].id);if(mine!==generation)return;hasOlder=rows.length===100;merge(rows);renderMessages();}catch(error){const target=document.querySelector('#chat-error');if(target&&mine===generation)showError(target,error);}finally{older.disabled=false;}};}
  if(!messages.length){history.append(el('div','empty','Напишите первое сообщение. Ваш разговор начинается здесь.'));return;}
  for(const message of messages){const mine=message.sender_id===credentials?.user.id;const row=el('div','bubble-row'+(mine?' mine':''));const bubble=el('div','bubble');bubble.append(el('div','message-text',message.text),el('div','time',new Date(message.created_at).toLocaleString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+(mine?' ✓':'')));row.append(bubble);history.append(row);}
  if(scroll||nearBottom)history.scrollTop=history.scrollHeight;
  else history.scrollTop=oldTop+Math.max(0,history.scrollHeight-oldHeight);
}
async function refreshChats(){const token=credentials?.token;const rows=await api('/chats');if(credentials?.token!==token)return;chats=rows;renderChatlist();}
async function poll(){
  if(polling||!credentials||document.hidden)return;polling=true;const mine=generation;
  try{
    await refreshChats();
    if(selected&&mine===generation){const rows=await api('/chats/'+selected.id+'/messages?after='+(messages.at(-1)?.id||0));if(mine!==generation)return;if(rows.length){merge(rows);renderMessages();}const target=document.querySelector('#chat-error');if(target)target.textContent='';}
  }catch(error){if(mine===generation){const target=document.querySelector('#chat-error');if(target)showError(target,error);}}
  finally{polling=false;}
}
setInterval(poll,2000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});render();
