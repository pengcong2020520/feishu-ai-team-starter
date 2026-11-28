import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createTeamLab } from '../src/admin/team-lab.mjs';
import { runTeamTrial } from '../src/admin/team-trial-worker.mjs';
import { installPackage, lockedPackage, listPackages, atomicJson } from '../src/packages/store.mjs';
import { stewardPermission } from '../src/admin/steward.mjs';
import { teamLabTools } from '../src/admin/team-lab-tools.mjs';
import { teamLabHttp, trialCard } from '../src/admin/team-lab-page.mjs';
import { fakeDelivery } from './helpers/delivery.mjs';
import { withPackageEditLock } from '../src/packages/edit-lock.mjs';

async function fixture(fn) {
  const root=await mkdtemp(path.join(os.tmpdir(),'team-lab-test-'));
  try { const lock=await installPackage('examples/team-package',root),lab=createTeamLab({root,launch:async()=>{}});await fn({root,lock,lab}); }
  finally { await rm(root,{recursive:true,force:true}); }
}
const open=(lab,lock,targetId='my-brief')=>lab.open({source:lock,targetId,name:'我的简报'});
const runFile=(root,id)=>path.join(root,'data/admin/team-lab/runs',id,'run.json');
async function proof(root,id){const file=runFile(root,id),r=JSON.parse(await readFile(file));r.status='passed';r.mode='real-sdk';r.calls=[{role:'writer',mode:'work',ok:true,skills:['team:writer-method']}];r.finishedAt=new Date().toISOString();await atomicJson(file,r);}
const fake=async args=>{
  if(args.outputSchema?.properties?.artifacts)return fakeDelivery(args);
  for(const skill of args.definition.skills)args.onProgress?.({tool:'Skill',file:skill,status:'succeeded'});
  const file=path.join(args.projectDir,args.role==='writer'?'drafts/brief.md':'review/brief.md');
  await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'# 一周产品观察\n\n这是完整的简报正文，明确面向独立开发者，描述使用场景、变化和下一步行动。');
  return {ok:true,text:'完成简报',sessionId:'test-session',stats:{turns:1}};
};

test('团队草稿复制后修改 Agent、Skill、workflow、workspace，原包与项目锁不变',()=>fixture(async({root,lock,lab})=>{
  const original=await lockedPackage(root,lock),d=await open(lab,lock);
  assert.equal((await listPackages(root)).length,1);
  const m=JSON.parse((await lab.read(d.id,'manifest.json')).text),w=JSON.parse((await lab.read(d.id,m.workflow)).text);
  m.workspace.templates.push({source:'workspace/guide.md',target:'drafts/guide.md'});w.nodes.find(n=>n.type==='task').prompt+=' 请参考工作区指引。';
  const edited=await lab.edit({draftId:d.id,expectedHash:d.hash,files:[
    {path:'manifest.json',text:JSON.stringify(m)},{path:m.workflow,text:JSON.stringify(w)},
    {path:'agents/writer.md',text:'你是个人产品观察员，请输出可直接阅读的简报。'},
    {path:'skills/writer-method/SKILL.md',text:'---\nname: writer-method\ndescription: 写个人简报\n---\n先读指引，写完整正文。'},
    {path:'workspace/guide.md',text:'只用已提供的资料，不编造事实。'},
  ]});
  assert.notEqual(edited.hash,d.hash);const check=await lab.validate(d.id);assert.equal(check.changed.length,5);
  assert.equal((await lockedPackage(root,lock)).hash,original.hash);assert.equal((await listPackages(root)).length,1);
  await assert.rejects(lab.edit({draftId:d.id,expectedHash:d.hash,files:[]}),/草稿已更新/);
  await assert.rejects(lab.edit({draftId:d.id,expectedHash:edited.hash,files:[{path:'manifest.json',text:'{}'}]}));
  assert.equal((await lab.read(d.id)).hash,edited.hash);
}));

test('导出只带团队定义，可重新导入为个人团队；运行目录、跨目录和软链接拒绝',()=>fixture(async({root,lock,lab})=>{
  const d=await open(lab,lock),exported=await lab.export(d.id),imported=await lab.open({source:exported.file,targetId:'imported-brief',name:'导入简报'});
  assert.equal(exported.verified,true);assert.equal(exported.draft,true);assert.equal(imported.roles.length,2);
  assert.equal((await listPackages(root)).length,1);
  await assert.rejects(lab.open({source:path.join(root,'data/packages'),targetId:'bad',name:'错误'}),/本机导入/);
  await assert.rejects(lab.open({source:'https://github.com/x/y/tree/main/pack',targetId:'bad',name:'错误'}),/40 位/);
  await assert.rejects(lab.edit({draftId:d.id,expectedHash:d.hash,files:[{path:'../outside',text:'x'}]}));
  await assert.rejects(lab.edit({draftId:d.id,expectedHash:d.hash,files:[{path:'.env',text:'secret'}]}),/不导出/);
  await mkdir(path.join(root,'team-packages'),{recursive:true});await symlink(os.tmpdir(),path.join(root,'team-packages/outside'));
  await assert.rejects(lab.open({source:'team-packages/outside',targetId:'bad',name:'错误'}),/本机导入/);
  assert.equal((await stewardPermission(root,'Write',{file_path:`data/admin/team-lab/drafts/${d.id}/draft.json`})).behavior,'deny');
}));

test('试跑使用原编排与隔离工作区，保留 Skill、模拟关口与产物，替身不能作为真实发布依据',()=>fixture(async({root,lock,lab})=>{
  const d=await open(lab,lock),started=await lab.trial({draftId:d.id,expectedHash:d.hash,demand:'写个人产品简报'});
  await assert.rejects(lab.trial({draftId:d.id,expectedHash:d.hash,demand:'重复'}),/已有试跑/);
  const r=await runTeamTrial(root,started.runId,{agent:fake});assert.equal(r.status,'passed');assert.equal(r.mode,'test-double');
  assert.ok(r.calls.some(c=>c.skills.includes('team:writer-method')));assert.ok(r.calls.some(c=>c.skills.includes('team:reviewer-method')));
  assert.ok(r.approvals.every(a=>a.source==='automated-test'));assert.ok(r.artifacts.some(a=>a.final));
  assert.match((await lab.artifact(r.id,r.artifacts[0].id)).text,/产品观察/);
  assert.equal((await listPackages(root)).length,1);await assert.rejects(readFile(path.join(root,'data/package-projects.json')),{code:'ENOENT'});
  await assert.rejects(lab.apply({draftId:d.id,expectedHash:d.hash,runId:r.id}),/真实试跑/);
}));

test('应用要求当前草稿通过记录，旧草稿试跑拒绝；新版本不覆盖已锁定包',()=>fixture(async({root,lock,lab})=>{
  const d=await open(lab,lock),run=await lab.trial({draftId:d.id,expectedHash:d.hash,demand:'样例'});await proof(root,run.runId);
  const e=await lab.edit({draftId:d.id,expectedHash:d.hash,files:[{path:'agents/writer.md',text:'新的写作职责'}]});
  await assert.rejects(lab.apply({draftId:d.id,expectedHash:e.hash,runId:run.runId}),/当前草稿/);
  const run2=await lab.trial({draftId:d.id,expectedHash:e.hash,demand:'样例'});await proof(root,run2.runId);
  const result=await lab.apply({draftId:d.id,expectedHash:e.hash,runId:run2.runId});assert.equal(result.applied,true);
  const again=await lab.apply({draftId:d.id,expectedHash:e.hash,runId:run2.runId});assert.equal(again.unchanged,true);
  const noChange=await lab.edit({draftId:d.id,expectedHash:e.hash,files:[]});assert.equal(noChange.needsNewTrial,false);assert.equal((await lab.export(d.id)).draft,false);
  await assert.rejects(lab.edit({draftId:d.id,expectedHash:e.hash,files:[{path:'agents/writer.md',text:'再次改动'}]}),/最新版本复制/);
  assert.equal((await lockedPackage(root,lock)).hash,lock.hash);assert.equal((await listPackages(root)).length,2);
  const update=await open(lab,result.package,'my-brief');assert.equal(update.version,'1.0.1');
}));

test('两个草稿竞争应用时拒绝过时基线，不静默产生同版本多摘要',()=>fixture(async({root,lock,lab})=>{
  const a=await open(lab,lock),b=await open(lab,lock);
  const edited=await lab.edit({draftId:b.id,expectedHash:b.hash,files:[{path:'agents/writer.md',text:'另一个版本'}]});
  const x=await lab.trial({draftId:a.id,expectedHash:a.hash,demand:'样例'}),y=await lab.trial({draftId:b.id,expectedHash:edited.hash,demand:'样例'});
  await proof(root,x.runId);await proof(root,y.runId);
  await lab.apply({draftId:a.id,expectedHash:a.hash,runId:x.runId});
  await assert.rejects(lab.apply({draftId:b.id,expectedHash:edited.hash,runId:y.runId}),/版本已更新/);
}));

test('试跑失败、主动停止和失去心跳均保留诊断，不允许应用；通知重启不重复',()=>fixture(async({root,lock,lab})=>{
  const d=await open(lab,lock),x=await lab.trial({draftId:d.id,expectedHash:d.hash,demand:'失败'});
  const failed=await runTeamTrial(root,x.runId,{agent:async()=>({ok:false,error:'模型额度不足',stats:{}})});assert.equal(failed.status,'failed');assert.match(failed.error,/额度不足/);
  const y=await lab.trial({draftId:d.id,expectedHash:d.hash,demand:'停止'});await lab.stop(y.runId);const stopped=await runTeamTrial(root,y.runId,{agent:async args=>{await new Promise(r=>setTimeout(r,1100));return fake(args);}});assert.equal(stopped.status,'stopped');
  const z=await lab.trial({draftId:d.id,expectedHash:d.hash,demand:'中断'}),file=runFile(root,z.runId),r=JSON.parse(await readFile(file));r.updatedAt='2000-01-01T00:00:00Z';await atomicJson(file,r);assert.equal((await lab.result(z.runId)).status,'interrupted');
  const notices=[],restored=createTeamLab({root,notify:async r=>notices.push(r.id)});await restored.tick();await restored.tick();assert.equal(notices.length,3);
}));

test('私聊工具完整覆盖草稿、试跑、发布和导出；只读诊断拒绝写操作',()=>fixture(async({root,lock,lab})=>{
  const tools=teamLabTools(lab),names=tools.map(t=>t.name);
  for(const name of ['team_draft_open','team_draft_edit','team_trial_start','team_draft_apply','team_draft_export'])assert.ok(names.includes(name));
  for(const name of names)assert.equal((await stewardPermission(root,'mcp__admin__'+name,{},true)).behavior,['team_catalog','team_draft_read','team_draft_validate','team_trial_result'].includes(name)?'allow':'deny');
  const catalog=await tools.find(t=>t.name==='team_catalog').handler({});assert.match(catalog.content[0].text,/brief-demo/);
}));

test('调试页仅展示本次产物，转义模型 HTML；卡片外链不带操作',()=>fixture(async({root,lock,lab})=>{
  const d=await open(lab,lock),x=await lab.trial({draftId:d.id,expectedHash:d.hash,demand:'<script>alert(1)</script>'});await runTeamTrial(root,x.runId,{agent:fake});
  let response;const get=url=>teamLabHttp({req:{method:'GET'},res:{},url:new URL(url,'http://localhost'),root,send:(_r,status,body)=>{response={status,body};}});
  await get('/admin/team-lab/'+x.runId);assert.equal(response.status,200);assert.match(response.body,/&lt;script&gt;/);assert.doesNotMatch(response.body,/<script>alert/);
  await get('/admin/team-lab/'+x.runId+'?artifact=../../.env');assert.equal(response.status,404);
  const testCard=trialCard(await lab.result(x.runId),'http://127.0.0.1:4870');assert.doesNotMatch(JSON.stringify(testCard),/team_lab_apply/);
  await proof(root,x.runId);
  const card=trialCard(await lab.result(x.runId),'http://127.0.0.1:4870');assert.match(JSON.stringify(card),/↗/);
  const buttons=card.elements.flatMap(e=>e.actions||[]);assert.ok(buttons.some(b=>b.value?.action==='team_lab_apply'&&b.type==='primary'));
  assert.ok(buttons.filter(b=>b.url).every(b=>!b.value&&b.type==='default'));
}));

test('失败试跑保留已完成产物，不能用未收尾的成功状态应用版本',()=>fixture(async({root,lock,lab})=>{
  const d=await open(lab,lock),x=await lab.trial({draftId:d.id,expectedHash:d.hash,demand:'失败前有正文'});
  const r=await runTeamTrial(root,x.runId,{agent:async args=>args.role==='reviewer'?{ok:false,error:'复核暂不可用',stats:{}}:fake(args)});
  assert.equal(r.status,'failed');assert.ok(r.artifacts.length>0);assert.match((await lab.artifact(r.id,r.artifacts[0].id)).text,/产品观察/);
  r.status='passed';r.mode='real-sdk';delete r.finishedAt;await atomicJson(runFile(root,r.id),r);
  await assert.rejects(lab.apply({draftId:d.id,expectedHash:d.hash,runId:r.id}),/真实试跑/);
}));

test('团队内容拒绝模型凭据，错误修改不覆盖草稿',()=>fixture(async({lock,lab})=>{
  const d=await open(lab,lock);
  await assert.rejects(lab.edit({draftId:d.id,expectedHash:d.hash,files:[{path:'agents/writer.md',text:'oc_sk_'+ 'notarealcredential'.repeat(2)}]}),/凭据/);
  assert.equal((await lab.read(d.id)).hash,d.hash);
}));

test('管理服务重新创建后停止服务，仍能停下此前启动的调试任务',()=>fixture(async({root,lock,lab})=>{
  const d=await open(lab,lock),x=await lab.trial({draftId:d.id,expectedHash:d.hash,demand:'等待运行'});
  await createTeamLab({root}).close();
  let calls=0;const r=await runTeamTrial(root,x.runId,{agent:async args=>{calls++;return fake(args);}});
  assert.equal(r.status,'stopped');assert.equal(calls,0);
}));

test('启动异常立即留下失败记录；执行中的停止会中断该次模型调用',()=>fixture(async({root,lock,lab})=>{
  const d=await open(lab,lock),broken=createTeamLab({root,launch:async()=>{throw Error('worker unavailable');}});
  await assert.rejects(broken.trial({draftId:d.id,expectedHash:d.hash,demand:'启动异常'}),/worker unavailable/);
  const failed=await broken.result((await broken.read(d.id)).runs.at(-1));assert.equal(failed.status,'failed');assert.ok(failed.finishedAt);
  const next=await lab.trial({draftId:d.id,expectedHash:d.hash,demand:'运行后停止'});
  let entered;const started=new Promise(resolve=>{entered=resolve;});
  const running=runTeamTrial(root,next.runId,{agent:async args=>new Promise(resolve=>{args.control.stop=async()=>resolve({ok:false,stopped:true,error:'已停止',stats:{}});entered();})});
  await started;await lab.stop(next.runId);const result=await running;assert.equal(result.status,'stopped');assert.equal(result.calls.length,1);assert.ok(result.calls[0].finishedAt);
}));

test('电脑休眠造成心跳延迟时，活着的试跑不会被判死或重复启动',()=>fixture(async({root,lock,lab})=>{
  const d=await open(lab,lock),x=await lab.trial({draftId:d.id,expectedHash:d.hash,demand:'睡眠恢复'}),file=runFile(root,x.runId),r=JSON.parse(await readFile(file));
  r.status='running';r.pid=process.pid;r.updatedAt='2000-01-01T00:00:00Z';await atomicJson(file,r);
  const status=await lab.result(x.runId);assert.equal(status.status,'running');assert.equal(status.heartbeatDelayed,true);
  await assert.rejects(lab.trial({draftId:d.id,expectedHash:d.hash,demand:'重复'}),/已有试跑/);
  assert.equal(JSON.parse(await readFile(file)).status,'running');
}));

test('通知收据独立保存，不会用旧快照覆盖运行结果；零角色调用不能应用',()=>fixture(async({root,lock,lab})=>{
  const d=await open(lab,lock),x=await lab.trial({draftId:d.id,expectedHash:d.hash,demand:'通知'});await proof(root,x.runId);
  const file=runFile(root,x.runId),r=JSON.parse(await readFile(file));
  const notifier=createTeamLab({root,notify:async()=>{await atomicJson(file,{...r,marker:'newer-worker-result'});}});
  await notifier.tick();assert.equal(JSON.parse(await readFile(file)).marker,'newer-worker-result');
  r.calls=[];await atomicJson(file,r);await assert.rejects(lab.apply({draftId:d.id,expectedHash:d.hash,runId:x.runId}),/真实试跑/);
}));

test('应用锁回收已退出的持有者，活进程与并发保存不能相互覆盖',()=>fixture(async({root})=>{
  const dir=path.join(root,'data/package-edit-locks/my-team');await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'owner.json'),JSON.stringify({pid:0,token:'dead'}));
  let active=0,peak=0;
  const work=()=>withPackageEditLock(root,'my-team',async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,20));active--;return 'saved';});
  const attempts=await Promise.allSettled(Array.from({length:12},work));assert.equal(peak,1);assert.ok(attempts.some(r=>r.status==='fulfilled'));assert.ok(attempts.some(r=>r.status==='rejected'));
  await withPackageEditLock(root,'my-team',async()=>{await assert.rejects(work(),/正在保存/);});
}));

test('同草稿允许从失败步骤继续，保留已有步骤；替身历史不能变成真实通过',()=>fixture(async({root,lock,lab})=>{
  const d=await open(lab,lock),x=await lab.trial({draftId:d.id,expectedHash:d.hash,demand:'接续'});
  let writers=0;
  const agent=async args=>{if(args.role==='writer'&&args.mode==='work')writers++;return args.role==='reviewer'?{ok:false,error:'临时故障',stats:{}}:fake(args);};
  const failed=await runTeamTrial(root,x.runId,{agent});assert.equal(failed.status,'failed');await assert.rejects(lab.retry(x.runId),/真实试跑/);
  failed.resumeRequested=true;delete failed.finishedAt;failed.status='starting';delete failed.error;await atomicJson(runFile(root,x.runId),failed);
  const passed=await runTeamTrial(root,x.runId,{agent:async args=>{if(args.role==='writer'&&args.mode==='work')writers++;return fake(args);}});
  assert.equal(passed.status,'passed');assert.equal(passed.projectId,failed.projectId);assert.equal(writers,1);assert.equal(passed.mode,'test-double');
}));

test('不同管理员实例同时编辑与应用，不能覆盖新草稿或同时成功',()=>fixture(async({root,lock,lab})=>{
  const d=await open(lab,lock),x=await lab.trial({draftId:d.id,expectedHash:d.hash,demand:'并发应用'});await proof(root,x.runId);
  const other=createTeamLab({root,launch:async()=>{}});
  const results=await Promise.allSettled([
    lab.apply({draftId:d.id,expectedHash:d.hash,runId:x.runId}),
    other.edit({draftId:d.id,expectedHash:d.hash,files:[{path:'agents/writer.md',text:'一个新的个人写作职责'}]}),
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const current=await lab.read(d.id);
  if(results[0].status==='fulfilled'){assert.equal(current.hash,d.hash);assert.ok(current.application);}
  else{assert.notEqual(current.hash,d.hash);assert.equal(current.application,undefined);assert.equal((await listPackages(root)).some(p=>p.id===d.targetId),false);}
}));
