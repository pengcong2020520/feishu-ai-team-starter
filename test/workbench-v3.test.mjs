import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createDirectory, samePerson } from '../src/projects/directory.mjs';
import { createProjectManager } from '../src/projects/manager.mjs';
import { createRecorder } from '../src/workbench/recorder.mjs';
import { createFeishu } from '../src/feishu.mjs';
import { createMessageReceiver } from '../src/projects/events.mjs';
import { createPackageEngine } from '../src/packages/engine.mjs';
import { installPackage } from '../src/packages/store.mjs';
import { startPreview } from '../src/preview.mjs';
const fixture=async fn=>{const root=await mkdtemp(path.join(os.tmpdir(),'workbench-v3-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}};

test('扫码人员与群聊人员同一身份可处理原项目，系统管理员可处理跨项目关口',()=>fixture(async root=>{
 const d=createDirectory(root),recorder=createRecorder(root);
 const admin=await d.observe({unionId:'admin-union'},'管理员');await d.settings({ownerId:admin.id});
 const scan=await d.observe({role:'chief',openId:'owner-open'},'扫码创建人');
 const real=await d.observe({unionId:'owner-union'},'项目负责人');
 await d.observe({unionId:'owner-union',role:'chief',openId:'owner-open'},'项目负责人');
 const outsider=await d.observe({role:'other-app',openId:'owner-open',unionId:'outsider'},'同名人员');
 const manager=createProjectManager({root,directory:d,recorder,env:{FEISHU_ADMIN_OPEN_ID:'trusted-admin'}});
 const p={id:'p',chatId:'web:p',dedicated:true,name:'旧项目',demand:'写文章',stage:'accept',team:{ownerId:scan.id,memberIds:[scan.id],approvers:{accept:scan.id},people:[scan]}};
 assert.equal((await manager.authorize({project:p,identity:{role:'chief',openId:'owner-open',unionId:'owner-union'},action:'confirm',source:'feishu'})).ok,true);
 assert.equal((await manager.authorize({project:p,identity:{unionId:'admin-union'},action:'confirm',source:'feishu'})).authority,'administrator');
 assert.equal((await manager.authorize({project:p,identity:{localPersonId:admin.id},action:'confirm',source:'local'})).authority,'administrator');
 assert.equal((await manager.authorize({project:p,identity:{role:'admin',openId:'trusted-admin'},action:'confirm',source:'admin'})).authority,'administrator');
 assert.equal((await manager.authorize({project:p,identity:{unionId:'outsider'},action:'confirm',source:'feishu'})).ok,false);
 assert.equal((await manager.authorize({project:p,identity:{role:'admin',openId:'forged'},action:'confirm',source:'admin'})).ok,false);
 assert.equal(samePerson(scan,outsider),false);
 await recorder.add('web:p',{kind:'user',text:'管理员要求短标题',identity:{unionId:'admin-union'},actor:'管理员'});
 await recorder.add('web:p',{kind:'user',text:'普通成员建议长标题',identity:{unionId:'outsider'},actor:'成员'});
 const context=await manager.context(p);assert.match(context,/管理员最新意见[\s\S]*管理员要求短标题/);assert.ok(context.indexOf('管理员要求短标题')<context.indexOf('讨论与操作记录'));
 assert.ok(!context.split('## 讨论与操作记录')[0].includes('普通成员建议长标题'));
}));

test('改名更新项目、群及工作区标题，原阶段和产物不变',()=>fixture(async root=>{
 const d=createDirectory(root),owner=await d.observe({unionId:'owner'},'发起人');await d.settings({ownerId:owner.id});
 const renamed=[];const feishu={createProjectGroup:async()=> 'oc_test',addMembers:async()=>{},renameChat:async(...a)=>renamed.push(a),sendText:async()=>{},sendCard:async()=> 'm',patchCard:async()=>{}};
 const manager=createProjectManager({root,directory:d,feishu});
 const lock=await installPackage('examples/team-package',root);
 const engine=createPackageEngine({root,projects:manager,feishu,bindings:()=>({roles:{chief:'chief'}}),agent:async()=>({ok:false,text:'',error:'测试停止',stats:{}})});
 // Local project exercises persistence; remote rename is checked against the same manager method.
 const p=await engine.create({package:lock,text:'请帮我写文章',options:{channel:'local'},identity:{localPersonId:owner.id}});await engine.waitForIdle(p.id);
 const before=await engine.get(p.id);const changed=await engine.renameProject({chatId:p.chatId,name:'产品即分发',identity:{localPersonId:owner.id},source:'local'});
 assert.equal(changed.name,'产品即分发');assert.equal(changed.stage,before.stage);assert.equal(changed.error,before.error);assert.deepEqual(changed.history,before.history);
 assert.match(await readFile(path.join(root,'workspace',p.id,'context/project.json'),'utf8'),/产品即分发/);
 const remote=await manager.renameProject({...p,chatId:'oc_test',packageName:'文枢 · 内容团队',botBindings:{chief:'bot-chief'},definition:{coordinator:'chief'}},'产品即分发');
 assert.deepEqual(renamed[0],['oc_test','文枢 · 产品即分发','bot-chief']);assert.equal(remote.groupName,'文枢 · 产品即分发');
 await assert.rejects(engine.renameProject({chatId:p.chatId,name:'标题'.repeat(20),identity:{localPersonId:owner.id},source:'local'}),/24/);
}));

test('工作台消息发往飞书只留一条真人记录，回执 ID 可与飞书原消息核对',()=>fixture(async root=>{
 const recorder=createRecorder(root),sent=[];
 class Client{constructor(){this.im={v1:{message:{create:async args=>{sent.push(args);return {data:{message_id:'om_outbound'}}}}}}}}
 const feishu=createFeishu({credentials:{chief:{appId:'test',appSecret:'test'}},recorder,sdk:{Client},logger:{}});
 const p={id:'p',chatId:'oc_test',package:{id:'test'},roles:[{id:'chief'}],botBindings:{chief:'chief'}};
 const received=[];const flow={packages:{get:async()=>p,message:async e=>{received.push(e);return{ok:true}}},packageProjects:{localIdentity:async()=>({localPersonId:'local-admin'}),authorize:async()=>({ok:true,authority:'administrator'})}};
 const server=await startPreview({root,flow,feishu,recorder,workbenchPort:0,modelPort:0});
 try{for(const endpoint of ['/api/packages/message','/api/message']){
 const r=await fetch(`http://127.0.0.1:${server.workbenchPort}${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json','X-Workbench':'1'},body:JSON.stringify({chatId:'oc_test',role:'chief',text:'同步测试',identity:{unionId:'forged'}})});assert.equal(r.status,200);
 }
 const rows=await recorder.list('oc_test');assert.equal(rows.length,2);for(const row of rows){assert.equal(row.kind,'user');assert.equal(row.messageId,'om_outbound');assert.equal(row.authority,'administrator');assert.deepEqual(row.identity,{localPersonId:'local-admin'});}assert.equal(sent.length,2);assert.equal(received.length,2);
 }finally{await server.close();}
}));

test('飞书真人消息去重同步到工作台并保留管理员来源',()=>fixture(async root=>{
 const recorder=createRecorder(root),dispatched=[];
 const receive=createMessageReceiver({ids:new Map([['chief','bot-chief']]),roleOrder:['chief'],observe:async()=>({name:'管理员',authority:'administrator'}),recorder,onMessage:async e=>dispatched.push(e)});
 const event={sender:{sender_type:'user',sender_id:{open_id:'human'}},message:{chat_id:'oc_test',chat_type:'group',message_id:'om_inbound',message_type:'text',content:JSON.stringify({text:'@_user_1 请缩短标题'}),mentions:[{key:'@_user_1',id:{open_id:'bot-chief'}}]}};
 await receive(event,'chief');await receive(event,'chief');const rows=await recorder.list('oc_test');assert.equal(rows.length,1);assert.equal(rows[0].authority,'administrator');assert.equal(rows[0].text,'请缩短标题');assert.equal(dispatched.length,1);
}));
