import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createAdminJournal } from '../src/admin/journal.mjs';
import { createAssistant } from '../src/admin/assistant.mjs';
import { createTeamLab } from '../src/admin/team-lab.mjs';
import { installPackage } from '../src/packages/store.mjs';
import { teamLabTools } from '../src/admin/team-lab-tools.mjs';
import { journalHttp, lineDiff, draftEvents } from '../src/admin/journal-page.mjs';

const fixture = async fn => {const root=await mkdtemp(path.join(os.tmpdir(),'admin-journal-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}};
const input = (id,text='修改个人团队') => ({source:'feishu-private',messageId:id,chatId:'chat',senderOpenId:'admin',text});
test('私聊凭据持久化、重启去重、未知入口不冒充私聊，敏感字段不落盘',()=>fixture(async root=>{
  const journal=createAdminJournal({root,secrets:['super-secret-value']}),bot=journal.wrapBot({sendText:async()=> 'reply',sendCard:async()=> 'card',patchCard:async()=>{}});
  await journal.receive(input('real','api_key=unusual-secret super-secret-value'),async()=>{await bot.sendText('已收到');await bot.sendCard({header:{title:{content:'进行中'}},elements:[{tag:'action',actions:[{value:{action:'stop_steward'}}]}]});await bot.patchCard('card',{header:{title:{content:'已完成'}},elements:[{text:{content:'完成修改'}}]});});
  const restarted=createAdminJournal({root});await restarted.receive(input('real'),()=>assert.fail('重复消息不能再次派活'));
  await journal.receive({text:'内部测试'},async()=>{});
  const entries=journal.events(),turn=entries[0].turnId;assert.ok(entries.slice(0,4).every(e=>e.turnId===turn));assert.equal(entries.at(-1).source,'internal');
  const saved=await readFile(path.join(root,'data/admin/journal.jsonl'),'utf8');assert.doesNotMatch(saved,/super-secret-value|unusual-secret/);assert.match(saved,/"messageId":"real"/);
}));

test('逐次工具与不可变差异关联原指令，失败保留、网页转义、历史记录明确标识',()=>fixture(async root=>{
  const lock=await installPackage('examples/team-package',root),lab=createTeamLab({root}),journal=createAdminJournal({root});
  const tools=teamLabTools(lab,{journal});const call=(name,args)=>tools.find(t=>t.name===name).handler(args).then(r=>JSON.parse(r.content[0].text));
  let draft,changed;
  await journal.receive(input('real','只修改 <script>alert(1)</script>'),async()=>{
    draft=await call('team_draft_open',{source:lock,targetId:'journal-brief',name:'简报'});
    changed=await call('team_draft_edit',{draftId:draft.id,expectedHash:draft.hash,files:[{path:'agents/writer.md',text:'先写结论\n<script>alert(2)</script>'}]});
    const failed=await tools.find(t=>t.name==='team_draft_edit').handler({draftId:draft.id,expectedHash:draft.hash,files:[]});assert.equal(failed.isError,true);
  });
  const op=journal.events().find(e=>e.name==='team_draft_edit'&&e.type==='operation'&&e.ok),first=await journal.diff(op.id);
  await lab.edit({draftId:draft.id,expectedHash:changed.hash,files:[{path:'agents/writer.md',text:'后续另外一次修改'}]});
  assert.deepEqual(await journal.diff(op.id),first);assert.equal(first.files[0].after,'先写结论\n<script>alert(2)</script>');
  const render=async url=>{let result;await journalHttp({req:{method:'GET',headers:{}},res:{},url:new URL(url,'http://localhost'),root,send:(_r,status,body)=>result={status,body}});return result;};
  const page=await render('/admin/team-lab/drafts/'+draft.id);assert.equal(page.status,200);assert.match(page.body,/真实飞书私聊/);assert.match(page.body,/未完成/);assert.doesNotMatch(page.body,/<script>alert/);
  const diff=await render('/admin/team-lab/diff/'+op.id);assert.equal(diff.status,200);assert.match(diff.body,/修改前后全文/);assert.doesNotMatch(diff.body,/<script>alert/);
  const legacy=await lab.open({source:lock,targetId:'legacy-brief',name:'旧草稿'});assert.match((await render('/admin/team-lab/drafts/'+legacy.id)).body,/无真实私聊凭据/);
  assert.equal((await render('/admin/team-lab/diff/00000000-0000-0000-0000-000000000000')).status,404);
}));

test('排队消息保留自己的轮次，插话关联实际执行轮次',()=>fixture(async root=>{
  const journal=createAdminJournal({root});let complete,control,counter=0;
  const bot=journal.wrapBot({sendText:async()=>`text-${++counter}`,sendCard:async()=>`card-${++counter}`,patchCard:async()=>{}});
  const steward={run:async a=>{control=a.control;return new Promise(r=>{complete=r;});}};
  const assistant=createAssistant({root,bot,steward,journal,supervisor:{},workbench:{}});
  const wait=async fn=>{for(let i=0;i<100&&!fn();i++)await new Promise(r=>setTimeout(r,5));assert.ok(fn());};
  const first=journal.receive(input('one'),()=>assistant.onMessage({text:'第一条'}));await wait(()=>!!complete);
  await journal.receive(input('two'),()=>assistant.onMessage({text:'第二条'}));
  const old=complete;old({ok:true,text:'第一条已处理'});await first;await wait(()=>complete!==old);
  control.steer=()=>true;await journal.receive(input('three'),()=>assistant.onMessage({text:'补充第二条'}));
  complete({ok:true,text:'第二条已处理'});await wait(()=>!assistant.busy());
  const events=journal.events(),one=events.find(e=>e.messageId==='one'),two=events.find(e=>e.messageId==='two'),three=events.find(e=>e.messageId==='three');
  assert.equal(events.find(e=>e.type==='dispatch'&&e.mode==='queued').turnId,two.turnId);
  assert.equal(events.find(e=>e.type==='dispatch'&&e.mode==='steered').parentTurnId,two.turnId);
  assert.equal(events.find(e=>e.type==='dispatch'&&e.mode==='steered').turnId,three.turnId);
  assert.notEqual(one.turnId,two.turnId);assert.equal(events.find(e=>e.text?.includes('第二条已处理')).turnId,two.turnId);
}));

test('分散修改不把中间未改内容标成删改，超大行数使用有界回退',()=>{
  const original=Array.from({length:500},(_,i)=>`line ${i}`),updated=[...original];updated[3]='new 3';updated[450]='new 450';
  const diff=lineDiff(original.join('\n'),updated.join('\n'));assert.equal(diff.filter(l=>l.kind==='del').length,2);assert.equal(diff.filter(l=>l.kind==='add').length,2);assert.ok(diff.length<20);
  assert.ok(lineDiff('x\n'.repeat(2000),'y\n'.repeat(2000)).length);
  assert.match(lineDiff('x\n'.repeat(20000),'y\n')[0].text,/行数较多/);
});
test('列表与详情按同一因果链归属，内部无轮次操作可见但排队不串入其他草稿',()=>{
  const all=[{type:'instruction',turnId:'a',source:'internal'},{type:'instruction',turnId:'b',source:'feishu-private'},{type:'dispatch',turnId:'b',parentTurnId:'a',mode:'steered'},{type:'operation',turnId:'a',draftId:'d'},{type:'operation',turnId:null,draftId:'d'},{type:'instruction',turnId:'c',source:'feishu-private'},{type:'dispatch',turnId:'c',parentTurnId:'a',mode:'queued'},{type:'operation',turnId:'c',draftId:'other'}];
  const events=draftEvents(all,{id:'d',runs:[]});assert.ok(events.some(e=>e.turnId==='b'));assert.ok(events.some(e=>e.turnId===null));assert.ok(!events.some(e=>e.turnId==='c'));
});
test('页面侧与记录侧沿用同一环境密钥脱敏规则',()=>fixture(async root=>{
  process.env.TEST_JOURNAL_SECRET='test-sensitive-without-key-prefix';
  try{assert.equal(createAdminJournal({root}).redact('value test-sensitive-without-key-prefix'),'value [已隐藏密钥]');}finally{delete process.env.TEST_JOURNAL_SECRET;}
}));

test('SDK 工具跨异步入口时，工具内发出的文件回复仍关联原指令',()=>fixture(async root=>{
  const journal=createAdminJournal({root}),bot=journal.wrapBot({sendFile:async()=> 'exported-file'});
  let context;
  await journal.receive(input('export-request','导出个人团队'),async()=>{context=journal.context();});
  await journal.operation('team_draft_export',{draftId:'personal-draft'},async()=>{
    await bot.sendFile('/tmp/personal.team.json');return {draftId:'personal-draft'};
  },context);
  const reply=journal.events().find(e=>e.type==='reply');
  assert.equal(reply.turnId,context.turnId);assert.equal(reply.kind,'file');assert.equal(reply.messageId,'exported-file');
}));
