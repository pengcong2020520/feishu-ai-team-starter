import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createDirectory } from '../src/projects/directory.mjs';
import { createProjectManager } from '../src/projects/manager.mjs';
import { createMessageReceiver, messageContent } from '../src/projects/events.mjs';
import { createRecorder } from '../src/workbench/recorder.mjs';
import { createFlow } from '../src/flow/index.mjs';
import { acquireCapacity, capacityStatus } from '../src/agents/capacity.mjs';
import { startPreview } from '../src/preview.mjs';

const fixture = async fn => { const root = await mkdtemp(path.join(os.tmpdir(), 'team-projects-')); try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); } };
const stats = { turns: 1, durationMs: 1, inputTokens: 1, outputTokens: 1 };
const person = async (directory, name, unionId, responsibilities = []) => {
  const p = await directory.observe({ unionId }, name); return directory.upsert({ ...p, responsibilities });
};
const all = ['clarifying', 'confirm_prd', 'confirm_design', 'accept'];
const put = async (dir, file, value) => { await mkdir(path.dirname(path.join(dir, file)), { recursive: true }); await writeFile(path.join(dir, file), typeof value === 'string' ? value : JSON.stringify(value)); };
const prd = ['# 演示项目', '## 产品概述', '## 目标用户与场景', '## 用户故事', '假如打开页面，当提交报名，那么看到成功提示。', '## 页面与状态', 'default', '## 边界情况', '## 功能需求', 'FR-001 报名', '## 成功标准', 'SC-001 成功', '## 假设', '## 本期不做'].join('\n');

test('职责成对匹配、同名人员不合并、多个确认人要求明确指定', () => fixture(async root => {
  const d = createDirectory(root);
  const a = await person(d, '小林', 'on_a', [{ job: '产品', scope: 'APP', approvals: all }, { job: '前端', scope: 'Agent', approvals: [] }]);
  const b = await person(d, '小林', 'on_b', [{ job: '产品', scope: 'Agent', approvals: all }]);
  await d.settings({ ownerId: a.id });
  const team = await d.plan({ text: '做 Agent 项目' });
  assert.equal(team.approvers.confirm_prd, b.id);
  assert.equal((await d.get()).people.length, 2);
  const c=await person(d,'APP 测试','on_c',[{job:'测试',scope:'APP',approvals:[]}]);
  assert.deepEqual((await d.plan({text:'happy 新闻页'})).memberIds,[a.id]);
  assert.ok((await d.plan({text:'APP 新闻页'})).memberIds.includes(c.id));
  await d.upsert({ ...a, responsibilities: [{ job: '产品', scope: 'Agent', approvals: all }] });
  await assert.rejects(d.plan({ text: 'Agent 项目' }), /多位负责人/);
  const explicit = await d.plan({ text: 'Agent 项目', approvers: Object.fromEntries(all.map(s => [s, a.id])) });
  assert.equal(explicit.approvers.accept, a.id);
  await assert.rejects(d.upsert({ ...a, active: false }), /本机操作者/);
  assert.equal((await d.get()).people.find(p => p.id === a.id).active, true);
}));

test('文字重试与卡片处理交错时，同一个项目只启动一份步骤', () => fixture(async root => {
  let calls=0,hold=false,unblock;
  const feishu={sendText:async()=>{},sendCard:async()=> 'm',patchCard:async()=>{if(hold){hold=false;await new Promise(r=>{unblock=r;});}}};
  const flow=createFlow({root,feishu,agent:async()=>{calls++;return{ok:false,error:'测试停止',stats};}});
  await flow.handleMessage({chatId:'g',text:'需求',intent:'demand'});await flow.waitForIdle('g');
  hold=true;const first=flow.handleMessage({chatId:'g',text:'重试'});
  while(!unblock)await new Promise(r=>setTimeout(r,1));
  assert.equal((await flow.handleMessage({chatId:'g',text:'重试'})).busy,true);
  unblock();await first;await flow.waitForIdle('g');assert.equal(calls,2);
}));

test('重启后排队项目变为可重试，不保留虚假的排队标记', () => fixture(async root => {
  await put(root,'data/state.json',{groups:{g:{id:'p',chatId:'g',stage:'clarifying',busy:true,queuedForAgent:true,error:null,sessions:{}}},archived:[],proposals:{}});
  const feishu={sendText:async()=>{},sendCard:async()=> 'm',patchCard:async()=>{}};
  const flow=createFlow({root,feishu,agent:async()=>{throw Error('不应自动派活');}});await flow.waitForIdle('g');
  const p=await flow.getProject('g');assert.equal(p.busy,false);assert.equal(p.queuedForAgent,false);assert.match(p.error,/重启/);
}));

test('飞书身份按应用绑定，编辑人员不能伪造身份', () => fixture(async root => {
  const d = createDirectory(root);
  const a = await d.observe({ role: 'product', openId: 'ou_a', unionId: 'on_same' }, '甲');
  const b = await d.observe({ role: 'designer', openId: 'ou_b', unionId: 'on_same' }, '甲');
  assert.equal(a.id, b.id);
  assert.equal((await d.find({ role: 'product', openId: 'ou_a' })).id, a.id);
  assert.equal(await d.find({ role: 'designer', openId: 'ou_a' }), null);
  await d.upsert({ ...b, identity: { unionId: 'on_forged' } });
  assert.equal(await d.find({ unionId: 'on_forged' }), null);
}));

test('全群讨论只记一次、不触发执行；多角色点名按序各处理一次', () => fixture(async root => {
  const recorder = createRecorder(root), calls = [];
  const ids = new Map([['product', 'bot-p'], ['designer', 'bot-d'], ['developer', 'bot-c']]);
  const receive = createMessageReceiver({ ids, recorder, onMessage: async e => { calls.push(e); } });
  const ordinary = { sender: { sender_type: 'user', sender_id: { union_id: 'on_a' } }, message: { chat_id: 'group-a', chat_type: 'group', message_id: 'm1', message_type: 'text', content: JSON.stringify({ text: '我们讨论决定先看两个方案' }) } };
  await Promise.all(['developer', 'product', 'designer'].map(role => receive(ordinary, role)));
  assert.equal((await recorder.list('group-a')).length, 1); assert.equal(calls.length, 0);
  const addressed = structuredClone(ordinary); addressed.message.message_id = 'm2'; addressed.message.mentions = [{ id: { open_id: 'bot-d' }, key: '@_user_1' }, { id: { open_id: 'bot-p' }, key: '@_user_2' }];
  addressed.message.content = JSON.stringify({ text: '@_user_1 @_user_2 请依次回答' });
  await Promise.all(['designer', 'product', 'developer'].map(role => receive(addressed, role)));
  assert.deepEqual(calls.map(e => e.role), ['product', 'designer']);
  assert.equal((await recorder.list('group-a')).length, 2);
  ordinary.sender.sender_type = 'app'; await receive(ordinary, 'product'); assert.equal(calls.length, 2);
  const ping=structuredClone(addressed);ping.message.message_id='m3';ping.message.mentions=[{id:{open_id:'bot-p'},key:'@_user_1'}];ping.message.content=JSON.stringify({text:'@_user_1'});
  await receive(ping,'product');assert.match(calls.at(-1).text,/现状和下一步/);
  const rich = messageContent({ message_type: 'post', content: JSON.stringify({ title: '讨论', content: [[{ tag: 'text', text: '附图' }, { tag: 'img', image_key: 'img_1' }]] }) });
  assert.match(rich.text, /附图/); assert.equal(rich.attachments[0].key, 'img_1');
}));

test('普通消息接续只触发一次，有跨应用真实点名或机器人消息时不误接续',()=>fixture(async root=>{
  const followups=[],calls=[],receive=createMessageReceiver({ids:new Map([['chief','own-chief'],['reviewer','own-reviewer']]),roleOrder:['chief','reviewer'],recorder:createRecorder(root),onUnaddressed:async e=>followups.push(e),onMessage:async e=>calls.push(e)});
  const event={sender:{sender_type:'user',sender_id:{union_id:'same-human'}},message:{chat_id:'c',chat_type:'group',message_id:'m1',message_type:'text',content:JSON.stringify({text:'补充一下，面向 AI 爱好者'})}};
  await receive(event,'reviewer');await receive(event,'chief');assert.equal(followups.length,1);
  event.message.message_id='m2';event.message.mentions=[{key:'@_user_1',id:{open_id:'chief-seen-by-reviewer'}}];
  await receive(event,'reviewer');assert.equal(followups.length,1);assert.equal(calls.length,0);
  event.message.mentions[0].id.open_id='own-chief';await receive(event,'chief');assert.equal(calls.length,1);assert.equal(calls[0].mentionCount,1);
  event.message.message_id='m3';event.message.mentions=[];event.sender.sender_type='app';await receive(event,'chief');assert.equal(followups.length,1);
}));

test('新项目建群请求幂等，失败后沿用同一项目号；需求变化不能复用请求号', () => fixture(async root => {
  const d = createDirectory(root), owner = await person(d, '负责人', 'on_owner'); await d.settings({ ownerId: owner.id });
  const calls = []; let failed = false;
  const manager = createProjectManager({ root, directory: d, feishu: { createProjectGroup: async request => { calls.push(request); if (!failed) { failed = true; throw Error('临时失败'); } return 'group-new'; } } });
  const args = { projectId: 'p1', sourceChatId: 'lobby', text: '需求甲', options: {}, requestId: 'req1' };
  await assert.rejects(manager.prepare(args), /临时失败/);
  const results = await Promise.all([manager.prepare({ ...args, projectId: 'p2' }), manager.prepare({ ...args, projectId: 'p3' })]);
  assert.deepEqual(calls.map(c => c.projectId), ['p1', 'p1']);
  assert.ok(results.every(p => p.id === 'p1' && p.chatId === 'group-new'));
  await assert.rejects(manager.prepare({ ...args, text: '另一个需求' }), /其他需求/);
}));

test('两个项目独立工作区与会话，全部讨论入上下文，确认人校验后原流程继续', () => fixture(async root => {
  const directory = createDirectory(root), recorder = createRecorder(root);
  const owner = await person(directory, '负责人', 'on_owner'); await directory.settings({ ownerId: owner.id });
  const expert = await person(directory, '产品同事', 'on_expert', [{ job: '产品', scope: 'APP', approvals: all }]);
  const cards = [], calls = [];
  const feishu = { sendText: async () => {}, sendCard: async (chat, card) => { cards.push({ chat, card }); return `m${cards.length}`; }, patchCard: async () => {} };
  const manager = createProjectManager({ root, directory, recorder, feishu });
  const agent = async args => {
    calls.push(args);
    if (args.mode === 'chat') return { ok: true, structured: { reply: '收到', proposal: { action: 'none', detail: '' } }, stats };
    if (!args.resume) await put(args.projectDir, 'docs/questions.json', { round: 1, why: '确认范围', questions: [{ id: 'q1', question: '选择范围', matters: '决定内容', options: ['默认', '扩展'], recommended: 0, reason: '简单' }] });
    else { await put(args.projectDir, 'docs/prd.md', prd); await put(args.projectDir, 'docs/outline.json', { title: '演示项目', blocks: [{ name: '首页', content: '报名' }], states: [{ id: 'default', name: '默认', desc: '填写' }] }); await put(args.projectDir, 'docs/checklist.md', Array.from({ length: 14 }, (_, i) => `- [x] CHK${String(i + 1).padStart(3, '0')} 已检查`).join('\n')); }
    return { ok: true, text: '完成', sessionId: path.basename(args.projectDir) + '-product', stats };
  };
  const flow = createFlow({ root, feishu, recorder, projects: manager, agent });
  const first = await flow.handleMessage({ chatId: 'web:entry1', intent: 'demand', text: 'APP 红色项目', requestId: 'r1', options: { channel: 'local' } });
  const second = await flow.handleMessage({ chatId: 'web:entry2', intent: 'demand', text: 'APP 蓝色项目', requestId: 'r2', options: { channel: 'local' } });
  await Promise.all([flow.waitForIdle(first.chatId), flow.waitForIdle(second.chatId)]);
  assert.notEqual(first.chatId, second.chatId); assert.notEqual(first.projectId, second.projectId);
  await recorder.add(first.chatId, { kind: 'user', actor: '产品同事', text: '甲项目的独有讨论，其他项目不得引用' }); await flow.syncContext(first.chatId);
  await flow.syncContext(second.chatId);
  assert.match(await readFile(path.join(root, 'workspace', first.projectId, 'context/discussion.md'), 'utf8'), /独有讨论/);
  assert.doesNotMatch(await readFile(path.join(root, 'workspace', second.projectId, 'context/discussion.md'), 'utf8'), /独有讨论|红色项目/);
  const p = await flow.getProject(first.chatId); assert.equal(p.error, null); const value = { action: 'answer', projectId: p.id, stage: p.stage, cardId: p.cardId };
  const denied = await flow.handleAction({ chatId: p.chatId, value, identity: { unionId: 'on_owner' }, source: 'feishu' });
  assert.match(denied.toast.content, /产品同事/); assert.equal(calls.length, 2);
  await flow.handleAction({ chatId: p.chatId, value, identity: { unionId: 'on_expert' }, source: 'feishu' }); await flow.waitForIdle(p.chatId);
  assert.equal((await flow.getProject(p.chatId)).stage, 'confirm_prd');
  assert.equal(calls.at(-1).resume, first.projectId + '-product');
  assert.equal((await flow.getProject(second.chatId)).stage, 'clarifying');
  assert.equal((await flow.getState()).projects.find(p => p.id === first.projectId).waitingOn, expert.name);
  assert.equal((await flow.handleMessage({ chatId: 'web:entry1', intent: 'demand', text: 'APP 红色项目', requestId: 'r1', options: { channel: 'local' } })).projectId, first.projectId);
}));

test('开工卡先返回，后台建群；重复点击不重复建群', () => fixture(async root => {
  const directory = createDirectory(root), recorder = createRecorder(root), owner = await person(directory, '甲', 'on_a'); await directory.settings({ ownerId: owner.id });
  let resolveGroup, count = 0; const cards = [];
  const feishu = { sendText: async () => {}, patchCard: async () => {}, sendCard: async (chat, card) => { cards.push(card); return 'm'; }, createProjectGroup: async () => { count++; return new Promise(r => { resolveGroup = r; }); } };
  const projects = createProjectManager({ root, feishu, recorder, directory });
  const agent = async args => args.mode === 'chat' ? { ok: true, structured: { reply: '开始吗', proposal: { action: 'start', detail: '做一个演示' } }, stats } : { ok: false, error: '验收到此停止', stats };
  const flow = createFlow({ root, feishu, recorder, projects, agent });
  await recorder.add('private', { kind:'user', text:'旧项目内容不应带入', actor:'甲' });
  await recorder.add('private', { kind:'action_result', action:'start', accepted:true });
  await recorder.add('private', { kind:'user', text:'新项目之前讨论过：需要蓝色按钮', actor:'甲' });
  await flow.handleMessage({ chatId: 'private', text: '做一个演示', identity: { unionId: 'on_a' } }); await flow.waitForIdle('private');
  const value = cards[0].elements.at(-1).actions[0].value;
  const start = Date.now();
  const result = await flow.handleAction({ chatId: 'private', value, identity: { unionId: 'on_a' } });
  assert.ok(Date.now() - start < 1000); assert.match(result.toast.content, /创建/);
  await flow.handleAction({ chatId: 'private', value, identity: { unionId: 'on_a' } });
  while (!resolveGroup) await new Promise(r => setTimeout(r, 1));
  assert.equal(count, 1); resolveGroup('project-group'); await flow.waitForIdle('private'); await flow.waitForIdle('project-group');
  assert.equal(await flow.getProject('private'), null); assert.equal((await flow.getProject('project-group')).dedicated, true);
  const context = await projects.context(await flow.getProject('project-group'));
  assert.match(context, /需要蓝色按钮/); assert.doesNotMatch(context, /旧项目内容/);
}));

test('工作台不能用请求体伪造确认人；分工变更与旧卡有明确边界', () => fixture(async root => {
  const directory=createDirectory(root),recorder=createRecorder(root);
  const owner=await person(directory,'本机用户','on_owner'),expert=await person(directory,'APP 产品','on_expert',[{job:'产品',scope:'APP',approvals:all}]);await directory.settings({ownerId:owner.id});
  const feishu={sendText:async()=>{},sendCard:async()=>'',patchCard:async()=>{}};
  const projects=createProjectManager({root,directory,recorder,feishu});
  const agent=async args=>{await put(args.projectDir,'docs/questions.json',{round:1,why:'范围',questions:[{id:'q1',question:'范围',matters:'内容',options:['小','大'],recommended:0,reason:'先小'}]});return {ok:true,text:'完成',sessionId:'local',stats};};
  const flow=createFlow({root,recorder,projects,feishu,agent});
  const server=await startPreview({root,flow,recorder,feishu,modelPort:0,workbenchPort:0});
  const base=`http://127.0.0.1:${server.workbenchPort}`;
  const post=async(route,body,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Workbench':'1',...headers},body:JSON.stringify(body)});
  try{
    const created=await post('/api/demand',{text:'APP 需求',channel:'local',requestId:'web-project'}).then(r=>r.json());await flow.waitForIdle(created.chatId);
    const p=await flow.getProject(created.chatId),oldCard=p.cardId,value={projectId:p.id,stage:p.stage,cardId:oldCard,action:'answer'};
    assert.equal((await post('/api/team/person',{name:'伪造',responsibilities:[]},{Origin:'http://evil.example'})).status,404);
    const denied=await post('/api/action',{chatId:p.chatId,value,identity:{unionId:'on_expert',localPersonId:expert.id},source:'local'}).then(r=>r.json());
    assert.match(denied.toast.content,/APP 产品/);assert.equal(p.cardId,oldCard);
    assert.equal((await post('/api/team/project',{projectId:p.id})).status,404);
    // 历史项目的内部迁移仍保留权限与旧卡保护，人员管理 HTTP 已删除。
    await flow.updateTeam({projectId:p.id,ownerId:owner.id,memberIds:[owner.id,expert.id],approvers:Object.fromEntries(all.map(s=>[s,owner.id]))});
    assert.notEqual(p.cardId,oldCard);
    const stale=await post('/api/action',{chatId:p.chatId,value}).then(r=>r.json());assert.match(stale.toast.content,/过期/);assert.equal(p.busy,false);
    const context=await fetch(base+'/api/context?projectId='+p.id).then(r=>r.text());assert.match(context,/APP 产品/);assert.match(context,/本机用户/);
  }finally{await server.close();}
}));

test('全局执行名额限制与排队取消，释放后其他角色继续', () => fixture(async root => {
  const release = await acquireCapacity({ root, limit: 1, role: 'admin', intervalMs: 5 });
  const abort = new AbortController(); let waiting = false;
  const queued = acquireCapacity({ root, limit: 1, role: 'product', signal: abort.signal, intervalMs: 5, onQueued: x => { waiting = x; } });
  while (!waiting) await new Promise(r => setTimeout(r, 1));
  assert.deepEqual(await capacityStatus(root, 1), { active: 1, queued: 1, limit: 1 });
  abort.abort(); await assert.rejects(queued); await release();
  const next = await acquireCapacity({ root, limit: 1, role: 'developer' });
  assert.equal((await capacityStatus(root, 1)).active, 1); await next();
  assert.deepEqual(await capacityStatus(root, 1), { active: 0, queued: 0, limit: 1 });
}));

test('建群成功但邀请失败，重启后只补邀请，不产生第二个群', () => fixture(async root => {
  const d = createDirectory(root), owner = await person(d, '负责人', 'on_owner'); await d.settings({ ownerId: owner.id });
  let creates = 0, invites = 0;
  const feishu = { createProjectGroup: async () => { creates++; return 'oc_existing'; }, addMembers: async () => { if (++invites === 1) throw Error('邀请失败'); } };
  const args = { projectId: 'p1', sourceChatId: 'entry', text: '建群需求', requestId: 'r1' };
  const partial=await createProjectManager({root, directory:d, feishu}).prepare(args);
  assert.equal(partial.chatId,'oc_existing');assert.match(partial.invitationWarning,/邀请失败/);
  const result = await createProjectManager({root, directory:d, feishu}).prepare({...args, projectId:'p2'});
  assert.equal(result.chatId, 'oc_existing'); assert.equal(result.id, 'p1'); assert.equal(creates, 1); assert.equal(invites, 2);
  assert.equal(result.invitationWarning,null);
}));

test('不同进程共用三个名额，超过上限排队并在释放后继续', () => fixture(async root => {
  const events = [], children = [];
  const moduleUrl = new URL('../src/agents/capacity.mjs', import.meta.url).href;
  try {
    const tasks = Array.from({length:6}, (_, index) => new Promise((resolve, reject) => {
      const code = `import {acquireCapacity} from ${JSON.stringify(moduleUrl)}; const release=await acquireCapacity({root:process.argv[1],limit:3,role:process.argv[2],intervalMs:10});console.log(JSON.stringify({kind:'start',at:Date.now()}));await new Promise(r=>setTimeout(r,180));console.log(JSON.stringify({kind:'end',at:Date.now()}));await release();`;
      const child=spawn(process.execPath,['--input-type=module','-e',code,root,String(index)],{stdio:['ignore','pipe','pipe']});children.push(child);
      let output='',error='';child.stdout.on('data',x=>{output+=x;});child.stderr.on('data',x=>{error+=x;});child.on('error',reject);
      child.on('exit',code=>{if(code!==0)return reject(Error(error));events.push(...output.trim().split('\n').map(JSON.parse));resolve();});
    }));
    await Promise.all(tasks);
    let count=0,max=0; for(const e of events.sort((a,b)=>a.at-b.at||(a.kind==='end'?-1:1))){count+=e.kind==='start'?1:-1;max=Math.max(max,count);assert.ok(count<=3);}
    assert.equal(max,3);assert.equal(count,0);assert.deepEqual(await capacityStatus(root,3),{active:0,queued:0,limit:3});
  } finally { for(const child of children)if(child.exitCode===null)child.kill(); }
}));


test('引用消息和附件保留在原群入站事件中，多应用重复推送仅接收一次',()=>fixture(async root=>{
 const recorder=createRecorder(root),seen=[];const receive=createMessageReceiver({ids:new Map([['chief','bot-chief']]),recorder,onMessage:async e=>seen.push(e),onUnaddressed:async e=>seen.push(e)});
 const event={sender:{sender_type:'user',sender_id:{union_id:'alice'}},message:{chat_id:'group-a',chat_type:'group',message_id:'reply-1',parent_id:'parent-a',root_id:'thread-a',message_type:'file',content:JSON.stringify({file_name:'来源.pdf',file_key:'file-a'})}};
 await receive(event,'chief');await receive(event,'chief');assert.equal(seen.length,1);assert.equal(seen[0].replyToMessageId,'parent-a');assert.equal(seen[0].threadRootMessageId,'thread-a');assert.equal(seen[0].attachments[0].name,'来源.pdf');
 const rows=await recorder.list('group-a');assert.equal(rows.length,1);assert.equal(rows[0].replyToMessageId,'parent-a');assert.match(rows[0].text,/文件/);
}));

test('同名新群编号区分，创建重试固定原名称且不重复建群',()=>fixture(async root=>{
 const directory=createDirectory(root),owner=await person(directory,'负责人','on_owner');await directory.settings({ownerId:owner.id});const calls=[];
 const manager=createProjectManager({root,directory,feishu:{createProjectGroup:async r=>{calls.push(r);return 'oc_'+r.projectId;}}});
 const make=id=>manager.prepare({projectId:id,requestId:id,text:'请帮我写一篇关于产品即分发的文章，面向创业者',options:{groupLabel:'文枢 · 内容团队'}});
 const a=await make('a'),b=await make('b'),again=await make('a');
 assert.equal(a.groupName,'文枢 · 产品即分发');assert.equal(b.groupName,'文枢 · 产品即分发（2）');assert.equal(again.groupName,a.groupName);assert.equal(calls.length,2);
 const more=await Promise.all([make('c'),make('d')]);assert.equal(new Set(more.map(p=>p.groupName)).size,2);assert.ok(more.every(p=>p.groupName!==b.groupName));
}));
