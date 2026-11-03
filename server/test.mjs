import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessenger } from './server.mjs';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function start(database = ':memory:') {
  const server = createMessenger({database}); server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, {token, body, method = body ? 'POST' : 'GET'} = {}) {
    const response = await fetch(base + path, {method, headers: { ...(token ? {Authorization:`Bearer ${token}`} : {}), ...(body ? {'Content-Type':'application/json'} : {}) }, body: body ? JSON.stringify(body) : undefined});
    return {status:response.status, data:await response.json()};
  }
  const account = async username => {
    const response = await request('/api/register',{body:{username,name:username === 'alice' ? 'Алиса' : username,password:'test-password-42'}});
    assert.equal(response.status,201); return response.data;
  };
  const close = async () => { const done=once(server,'close');server.close();server.closeAllConnections();await done; };
  return {server,base,request,account,close};
}

test('Two real users exchange messages; strangers cannot read or write their chat', async t => {
  const app=await start(); t.after(app.close);
  const a=await app.account('alice'); const b=await app.account('bob'); const c=await app.account('charlie');
  const opened=await app.request('/api/chats',{token:a.token,body:{username:'bob'}});
  assert.equal(opened.status,200);assert.equal(opened.data.peer.id,b.user.id);
  const id=opened.data.id;
  const reverse=await app.request('/api/chats',{token:b.token,body:{username:'alice'}});
  assert.equal(reverse.data.id,id);
  const message=await app.request(`/api/chats/${id}/messages`,{token:a.token,body:{text:'Привет, Боб! 🌊',client_id:'unique-message-001'}});
  assert.equal(message.status,201);assert.equal(message.data.sender_id,a.user.id);
  const received=await app.request(`/api/chats/${id}/messages`,{token:b.token});
  assert.equal(received.data[0].text,'Привет, Боб! 🌊');
  assert.equal((await app.request(`/api/chats/${id}/messages`,{token:c.token})).status,404);
  assert.equal((await app.request(`/api/chats/${id}/messages`,{token:c.token,body:{text:'Hack',client_id:'stranger-write-001'}})).status,404);
  assert.equal((await app.request(`/api/chats/${id}/messages`)).status,401);
  const reply=await app.request(`/api/chats/${id}/messages`,{token:b.token,body:{text:'И тебе привет!',client_id:'reply-message-001'}});
  assert.equal(reply.status,201);
  const inbox=await app.request('/api/chats',{token:a.token});
  assert.equal(inbox.data[0].lastMessage.text,'И тебе привет!');
});

test('Retries do not duplicate messages, and reused keys cannot change the original',async t=>{
  const app=await start();t.after(app.close);const a=await app.account('alice');await app.account('bob');
  const chat=(await app.request('/api/chats',{token:a.token,body:{username:'bob'}})).data;
  const body={text:'Один раз',client_id:'retry-key-0001'};
  const first=await app.request(`/api/chats/${chat.id}/messages`,{token:a.token,body});
  const retry=await app.request(`/api/chats/${chat.id}/messages`,{token:a.token,body});
  assert.equal(retry.status,200);assert.equal(first.data.id,retry.data.id);
  assert.equal((await app.request(`/api/chats/${chat.id}/messages`,{token:a.token})).data.length,1);
  assert.equal((await app.request(`/api/chats/${chat.id}/messages`,{token:a.token,body:{...body,text:'Другое'}})).status,409);
});

test('Login validates credentials, normalizes username, and logout revokes the session',async t=>{
  const app=await start();t.after(app.close);const a=await app.account('alice');
  assert.equal((await app.request('/api/login',{body:{username:'Alice',password:'bad-password'}})).status,401);
  const login=await app.request('/api/login',{body:{username:'ALICE',password:'test-password-42'}});
  assert.equal(login.status,200);assert.equal(login.data.user.id,a.user.id);
  assert.equal((await app.request('/api/me',{token:login.data.token})).status,200);
  assert.equal((await app.request('/api/logout',{token:login.data.token,method:'POST'})).status,200);
  assert.equal((await app.request('/api/me',{token:login.data.token})).status,401);
  assert.equal((await app.request('/api/register',{body:{username:'alice',name:'Other',password:'another-password'}})).status,409);
});

test('Validation rejects empty messages, oversized text, invalid usernames, and SQL injection',async t=>{
  const app=await start();t.after(app.close);
  assert.equal((await app.request('/api/register',{body:{username:"x';drop table users;--",name:'Test',password:'password123'}})).status,400);
  assert.equal((await app.request('/api/register',{body:{username:'valid_user',name:'Test',password:'123'}})).status,400);
  const a=await app.account('alice');await app.account('bob');
  assert.equal((await app.request('/api/chats',{token:a.token,body:{username:'alice'}})).status,400);
  assert.equal((await app.request('/api/chats',{token:a.token,body:{username:'missing'}})).status,404);
  const chat=(await app.request('/api/chats',{token:a.token,body:{username:'bob'}})).data;
  for(const text of ['  ','a'.repeat(4001)])assert.equal((await app.request(`/api/chats/${chat.id}/messages`,{token:a.token,body:{text,client_id:'invalid-key-0001'}})).status,400);
  assert.equal((await app.request(`/api/chats/${chat.id}/messages?after=NaN`,{token:a.token})).status,400);
  const xss='<script>alert("hello")</script>';
  const sent=await app.request(`/api/chats/${chat.id}/messages`,{token:a.token,body:{text:xss,client_id:'xss-text-0001'}});
  assert.equal(sent.status,201);assert.equal(sent.data.text,xss);
});

test('History supports newest page, previous page and ordered incremental polling',async t=>{
  const app=await start();t.after(app.close);const a=await app.account('alice');await app.account('bob');
  const chat=(await app.request('/api/chats',{token:a.token,body:{username:'bob'}})).data;
  for(let i=0;i<105;i++){
    const response=await app.request(`/api/chats/${chat.id}/messages`,{token:a.token,body:{text:`message ${i}`,client_id:`history-key-${i.toString().padStart(4,'0')}`}});
    assert.equal(response.status,201);
  }
  const latest=(await app.request(`/api/chats/${chat.id}/messages`,{token:a.token})).data;
  assert.equal(latest.length,100);assert.equal(latest[0].text,'message 5');assert.equal(latest.at(-1).text,'message 104');
  const old=(await app.request(`/api/chats/${chat.id}/messages?before=${latest[0].id}`,{token:a.token})).data;
  assert.equal(old.length,5);assert.equal(old[0].text,'message 0');
  const newMessages=(await app.request(`/api/chats/${chat.id}/messages?after=${latest[95].id}`,{token:a.token})).data;
  assert.equal(newMessages.length,4);assert.equal(newMessages[0].text,'message 101');
});

test('Users, sessions and messages survive a server restart',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'volna-test-'));const database=join(directory,'state.sqlite');
  let app=await start(database);
  try {
    const a=await app.account('alice');await app.account('bob');
    const chat=(await app.request('/api/chats',{token:a.token,body:{username:'bob'}})).data;
    await app.request(`/api/chats/${chat.id}/messages`,{token:a.token,body:{text:'Сохранено',client_id:'persist-key-0001'}});
    await app.close();app=await start(database);
    const history=await app.request(`/api/chats/${chat.id}/messages`,{token:a.token});
    assert.equal(history.status,200);assert.equal(history.data[0].text,'Сохранено');
  } finally {await app.close();rmSync(directory,{recursive:true,force:true});}
});

test('Browser assets load and arbitrary file paths are not served',async t=>{
  const app=await start();t.after(app.close);
  for(const path of ['/','/app.js','/style.css']){
    const response=await fetch(app.base+path);assert.equal(response.status,200);
    assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  }
  assert.equal((await app.request('/server.mjs')).status,404);
  assert.equal((await app.request('/health')).data.ok,true);
});
