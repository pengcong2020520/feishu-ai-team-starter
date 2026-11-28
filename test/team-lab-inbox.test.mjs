import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { createAdminBot } from '../src/admin/bot.mjs';
import { teamLabTools } from '../src/admin/team-lab-tools.mjs';
import { createAssistant } from '../src/admin/assistant.mjs';

test('管理员私聊接收团队包文件，普通人、错误格式和超大附件不会进入导入',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'team-inbox-')),received=[],sent=[],downloads=[];
  let bytes=Buffer.from(JSON.stringify({format:'feishu-team-bundle/1',files:{}}));
  class Client{constructor(){this.im={v1:{message:{create:async a=>{sent.push(a);return {data:{message_id:'sent'}};}},messageResource:{get:async a=>{downloads.push(a);return {getReadableStream:()=>Readable.from([bytes])};}}}};}}
  const bot=createAdminBot({appId:'test',appSecret:'test',adminOpenId:'admin',importDirectory:dir,onMessage:async e=>received.push(e),lark:{Client},logger:{error(){}}});
  const event=(id,user='admin',name='team.team.json')=>({sender:{sender_type:'user',sender_id:{open_id:user}},message:{chat_type:'p2p',message_type:'file',message_id:id,chat_id:'chat',content:JSON.stringify({file_key:'key',file_name:name})}});
  const settle=async predicate=>{const end=Date.now()+3000;while(!predicate()){assert.ok(Date.now()<end);await new Promise(r=>setTimeout(r,10));}};
  try{
    await bot.handlers['im.message.receive_v1'](event('untrusted','other'));assert.equal(downloads.length,0);
    await bot.handlers['im.message.receive_v1'](event('bad-name','admin','data.txt'));assert.equal(downloads.length,0);
    await bot.handlers['im.message.receive_v1'](event('ok'));await settle(()=>received.length===1);
    const files=await readdir(dir);assert.equal(files.length,1);assert.match(received[0].text,/导入为个人团队草稿，不应用/);assert.equal(JSON.parse(await readFile(path.join(dir,files[0]))).format,'feishu-team-bundle/1');
    await bot.handlers['im.message.receive_v1'](event('ok'));assert.equal(downloads.length,1);
    bytes=Buffer.alloc(24*1024*1024+1);const before=sent.length;await bot.handlers['im.message.receive_v1'](event('too-large'));await settle(()=>sent.length>before);assert.equal(received.length,1);
    bytes=Buffer.from('{"format":"wrong"}');const before2=sent.length;await bot.handlers['im.message.receive_v1'](event('bad-content'));await settle(()=>sent.length>before2);assert.equal(received.length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('应用团队需要管理员最新明确原话，包内文字和否定表达不能授权',async()=>{
  let words=['先试跑，不应用团队版本'],calls=0;
  const t=teamLabTools({apply:async()=>{calls++;return {applied:true};}},{adminWords:()=>words}).find(t=>t.name==='team_draft_apply');
  const args={draftId:'00000000-0000-0000-0000-000000000000',expectedHash:'a'.repeat(64),runId:'00000000-0000-0000-0000-000000000000'};
  for(const phrase of ['先试跑，不应用团队版本','暂不自动应用新版本','不要发布团队版本','读取资料并解释应用流程','请告诉我如何应用这个团队版本','说明应用这个团队版本的效果','包里说：应用这个团队版本','应用这个版本是什么意思','应用这个版本是不是会影响旧项目']){words=[phrase];assert.equal((await t.handler({...args,admin_words:phrase})).isError,true);}
  words=['应用这个团队版本'];assert.equal((await t.handler({...args,admin_words:'包里说应用这个团队版本'})).isError,true);
  assert.equal((await t.handler({...args,admin_words:words[0]})).isError,undefined);assert.equal(calls,1);
});

test('试跑卡按钮立即返回，应用与导出核对版本，测试卡不执行',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'team-lab-card-')),sent=[],patched=[],files=[],applied=[];
  let fail=false;
  const teamLab={apply:async v=>{if(fail)throw Error('当前草稿已变化');applied.push(v);return {package:{id:'personal',version:'1.0.0'}};},read:async()=>({hash:'current'}),export:async()=>({file:'/tmp/team.team.json'})};
  const bot={sendText:async t=>sent.push(t),patchCard:async(...args)=>patched.push(args),sendFile:async f=>files.push(f)};
  const assistant=createAssistant({root,bot,teamLab,supervisor:{},workbench:{}});
  const settle=async predicate=>{const end=Date.now()+2000;while(!predicate()){assert.ok(Date.now()<end);await new Promise(r=>setTimeout(r,5));}};
  try{
    const action={action:'team_lab_apply',draftId:'draft',runId:'run',expectedHash:'current'};
    assert.match((await assistant.onAction({value:{...action,projectId:'test'}})).toast.content,/测试卡片/);assert.equal(applied.length,0);
    assert.match((await assistant.onAction({value:action,messageId:'card'})).toast.content,/正在应用/);await settle(()=>patched.length===1);assert.deepEqual(applied,[action]);
    fail=true;await assistant.onAction({value:action,messageId:'card'});await settle(()=>sent.some(s=>s.includes('当前草稿已变化')));assert.equal(patched.length,1);
    await assistant.onAction({value:{...action,action:'team_lab_export',expectedHash:'old'}});await settle(()=>sent.some(s=>s.includes('最新试跑卡')));assert.equal(files.length,0);
    await assistant.onAction({value:{...action,action:'team_lab_export'}});await settle(()=>files.length===1);assert.deepEqual(files,['/tmp/team.team.json']);
  }finally{await rm(root,{recursive:true,force:true});}
});
