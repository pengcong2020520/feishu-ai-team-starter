import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { installPackage, listPackages } from '../src/packages/store.mjs';
import { createPackageConnections, botKey } from '../src/packages/connections.mjs';
import { createProjectManager } from '../src/projects/manager.mjs';
import { readBindings, bindRole } from '../src/packages/bindings.mjs';
import { readEnv, updateEnv } from '../src/setup/env-file.mjs';
import { createFeishu } from '../src/feishu.mjs';
import { startPreview } from '../src/preview.mjs';

const fixture = async fn => { const root=await mkdtemp(path.join(os.tmpdir(),'team-connect-test-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});} };
const prefix = key => `FEISHU_${key.replaceAll('-','_').toUpperCase()}_`;

test('扫码重复点击只注册一轮，部分成功重试复用，凭据与绑定串行保存，确认身份来自扫码',()=>fixture(async root=>{
 const lock=await installPackage('examples/team-package',root),pack=(await listPackages(root))[0],projects=createProjectManager({root});
 let calls=0,release;const connections=[];
 const service=createPackageConnections({root,projects,feishu:{connectCredentials:async c=>connections.push(Object.keys(c))},dependencies:async()=>({}),register:async({roles,save})=>{
  for(const role of roles)assert.ok(pack.roles.some(r=>r.id===role.id),'扫码保留角色标识，头像不使用机器人凭据 key');
  calls++;if(calls===1)await new Promise(r=>{release=r;});
  await Promise.all(roles.map(async(role,i)=>{if(calls===1&&i===1)return;await save(role,{appId:'cli_'+role.key,appSecret:'test-secret',openId:'ou_'+role.key});}));
  return roles.map((role,i)=>({role,ok:calls>1||i===0}));
 }});
 await service.start(lock.id);await service.start(lock.id);while(!release)await new Promise(r=>setTimeout(r,1));assert.equal(calls,1);
 await assert.rejects(service.start('another-team'),/另一支/);release();assert.equal((await service.wait()).state,'error');
 const first=await readBindings(root,lock.id);assert.equal(Object.keys(first.roles).length,1);
 await service.start(lock.id);assert.equal((await service.wait()).state,'ready');assert.equal(calls,2);assert.equal(connections[0].length,pack.roles.length);
 const bindings=await readBindings(root,lock.id);assert.equal(Object.keys(bindings.roles).length,pack.roles.length);assert.ok(bindings.localOwnerId);
 const identity=await projects.localIdentity(lock.id);assert.equal(identity.localPersonId,bindings.localOwnerId);
 const person=(await projects.directory.get()).people.find(p=>p.id===identity.localPersonId);
 assert.equal(person.identity.openIds[bindings.roles[pack.coordinator]],'ou_'+bindings.roles[pack.coordinator]);
 await service.start(lock.id);await service.wait();assert.equal(calls,2);assert.equal(await service.page(lock.id,'../.env'),null);
 assert.doesNotMatch((await service.page(lock.id,'index.html')).body,/test-secret/);
}));

test('已保存凭据但绑定中断时补绑定，不新建机器人；已有绑定缺密钥不擅自替换',()=>fixture(async root=>{
 const lock=await installPackage('examples/team-package',root),pack=(await listPackages(root))[0];
 for(const r of pack.roles){const key=botKey(lock.id,r.id),p=prefix(key);updateEnv(path.join(root,'.env'),{[p+'APP_ID']:'cli_'+r.id,[p+'APP_SECRET']:'test-secret'});}
 const service=createPackageConnections({root,projects:createProjectManager({root}),feishu:{connectCredentials:async()=>{}},register:async()=>{throw Error('不应重新扫码');}});
 await service.start(lock.id);assert.equal((await service.wait()).state,'ready');assert.equal(Object.keys((await readBindings(root,lock.id)).roles).length,2);
 const key=botKey(lock.id,pack.roles[0].id);updateEnv(path.join(root,'.env'),{[prefix(key)+'APP_SECRET']:''});
 await assert.rejects(service.start(lock.id),/已有绑定缺少凭据/);
}));

test('动态机器人仅建立一条连接；自定义团队使用自己的协调机器人和同应用 open_id 建群',async()=>{
 const sent=[],starts=[];const sdk={
  Client:class{constructor({appId}){this.request=async()=>({bot:{open_id:'bot-'+appId}});this.im={v1:{chat:{create:async args=>{sent.push({appId,args});return {data:{chat_id:'oc_team'}};}},chatMembers:{create:async args=>{sent.push({appId,args});return {data:{}};}}}};}},
  EventDispatcher:class{register(){return this;}},WSClient:class{constructor({appId}){this.appId=appId;}async start(){starts.push(this.appId);}close(){}},
 };
 const feishu=createFeishu({credentials:{product:{appId:'product',appSecret:'test'}},sdk});
 await feishu.start();await Promise.all([feishu.connectCredentials({chief:{appId:'chief',appSecret:'test'}}),feishu.connectCredentials({chief:{appId:'chief',appSecret:'test'}})]);
 await feishu.connectCredentials({expert:{appId:'expert',appSecret:'test'}});
 assert.deepEqual(starts,['product','chief','expert']);
 await feishu.createProjectGroup({projectId:'p',name:'投研',team:{ownerId:'owner',people:[{id:'owner',identity:{openIds:{product:'ou_wrong',chief:'ou_right'}}}]},botRoles:['chief','expert']});
 assert.equal(sent[0].appId,'chief');assert.equal(sent[0].args.data.owner_id,'ou_right');assert.deepEqual(sent[0].args.data.bot_id_list,['expert']);
 const large=['chief','expert',...Array.from({length:6},(_,i)=>'extra'+i)];
 await feishu.connectCredentials(Object.fromEntries(large.slice(2).map(r=>[r,{appId:r,appSecret:'test'}])));
 await feishu.createProjectGroup({projectId:'large',name:'八角色',team:{ownerId:'owner',people:[{id:'owner',identity:{openIds:{chief:'ou_right'}}}]},botRoles:large});
 assert.deepEqual(sent[1].args.data.bot_id_list,large.slice(1,6));
 await feishu.addBots('oc_team',large.slice(6),'chief');assert.deepEqual(sent[2].args.data.id_list,large.slice(6));assert.equal(sent[2].args.params.member_id_type,'app_id');
 await assert.rejects(feishu.connectCredentials({alias:{appId:'chief',appSecret:'test'}}),/只能建立一条/);feishu.close();
});

test('工作台首页是团队流程；人员管理接口和页面已删除；扫码写入遵守同源和身份边界',()=>fixture(async root=>{
 await installPackage('examples/team-package',root);let started=0;
 const flow={packages:{snapshot:async()=>[]},connections:{status:()=>null,start:async()=>{started++;return {state:'scanning'};}},getState:async()=>({projects:[]})};
 const server=await startPreview({root,assetsRoot:process.cwd(),flow,workbenchPort:0,modelPort:0});const base=`http://127.0.0.1:${server.workbenchPort}`;
 try{
  const html=await fetch(base).then(r=>r.text());assert.match(html,/teams.js/);assert.match(html,/团队生态/);assert.doesNotMatch(html,/<h2>我的 AI 团队/);
  const model=await fetch(base+'/team-board.mjs');assert.equal(model.status,200);assert.match(model.headers.get('content-type'),/javascript/);assert.doesNotMatch(html,/人员与职责|人员名册/);
  for(const asset of ['/role-portraits.mjs','/team-entry.mjs','/cyber.css']){const response=await fetch(base+asset);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),asset.endsWith('css')?/text\/css/:/javascript/);}
  for(const route of ['/api/team','/api/team/person','/api/team/settings','/api/team/project','/api/team/import'])assert.equal((await fetch(base+route,{method:route==='/api/team'?'GET':'POST'})).status,404);
  const send=headers=>fetch(base+'/api/packages/connect',{method:'POST',headers,body:JSON.stringify({packageId:'example-team'})});
  assert.equal((await send({'Content-Type':'application/json','X-Workbench':'1',Origin:'http://evil.invalid'})).status,403);
  assert.equal((await send({'Content-Type':'application/json'})).status,415);assert.equal(started,0);
  assert.equal((await send({'Content-Type':'application/json','X-Workbench':'1'})).status,200);assert.equal(started,1);
  const catalog=await fetch(base+'/api/packages').then(r=>r.json());assert.equal(catalog.packages[0].feishuReady,false);assert.ok(catalog.packages[0].workflow.nodes.length);assert.ok(catalog.packages[0].roles[0].skills.length);
 }finally{await server.close();}
}));

test('八角色建群先落群号再补两个机器人；邀请失败重试沿用群，补齐前不交付项目',()=>fixture(async root=>{
 const projects=createProjectManager({root,feishu:{createProjectGroup:async()=>{creates++;return 'oc_eight';},addBots:async(chat,roles,creator)=>{invites.push({chat,roles,creator});if(invites.length===1)throw Error('临时邀请失败');},addMembers:async()=>{}}});
 const owner=await projects.observe({role:'chief',openId:'ou_owner'},'发起人');await projects.directory.settings({ownerId:owner.id});
 let creates=0;const invites=[],botRoles=['chief','deputy','researcher','fact-checker','extractor','writer','editor','archivist'];
 const args={projectId:'eight',requestId:'same-request',text:'八角色项目',options:{channel:'feishu',botRoles}};
 await assert.rejects(projects.prepare(args),/临时邀请失败/);
 const registry=JSON.parse(await readFile(path.join(root,'data/project-registry.json'),'utf8'));assert.equal(registry.requests['same-request'].chatId,'oc_eight');
 const result=await projects.prepare(args);assert.equal(result.chatId,'oc_eight');assert.equal(creates,1);assert.deepEqual(invites[1],{chat:'oc_eight',roles:['editor','archivist'],creator:'chief'});
 await projects.prepare(args);assert.equal(invites.length,2);assert.equal(creates,1);
}));
