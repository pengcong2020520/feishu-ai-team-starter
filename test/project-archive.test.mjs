import { legacyArchiveService } from '../src/workbench/archives.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRunAgent } from '../src/agents/run.mjs';
import { roleDefinition } from '../src/packages/runtime.mjs';
import { finalArtifactIds, archiveEvidence, checkedArchive, createArchives } from '../src/packages/archive.mjs';
import { contentIssues, inspectDelivery } from '../src/packages/delivery-quality.mjs';
import { createPackageEngine } from '../src/packages/engine.mjs';
import { createDocumentSync } from '../src/packages/documents.mjs';
import { installPackage, lockedPackage, loadPackage } from '../src/packages/store.mjs';
import { createRecorder } from '../src/workbench/recorder.mjs';
import { fakeDelivery } from './helpers/delivery.mjs';
const fixture=async fn=>{const root=await mkdtemp(path.join(os.tmpdir(),'project-archive-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}};

test('最终成果跟随工作流，不把归档记录、走查 JSON 或最近修改的文件当成成品',async()=>{
  assert.deepEqual(finalArtifactIds(await loadPackage('team-packages/web-studio')),['site']);
  const pack=await loadPackage('team-packages/investment-lab');assert.ok(finalArtifactIds(pack).includes('report'));
});
test('档案留住人、AI 与决策的来源，卡片更新合并且不会串项目',()=>{
 const p={id:'p',name:'项目',demand:'最初想法',roles:[{id:'chief',name:'主编'}],history:[{at:'2',role:'chief',name:'写作',summary:'已写正文',outputs:['article']}],approvals:[{at:'3',actor:'自动审核',source:'auto-review',action:'confirm',stage:'accept'}]};
 const e=archiveEvidence(p,[{projectId:'other',text:'绝密其他项目'},{kind:'user',at:'1',actor:'小王',text:'保留观点'},{kind:'card',messageId:'m',at:'2',card:{title:'旧卡'}},{kind:'card_update',messageId:'m',at:'3',card:{title:'已完成'}}],[]);
 assert.equal(e.events.filter(e=>e.text==='已完成').length,1);assert.ok(!JSON.stringify(e).includes('绝密'));assert.equal(e.events.find(e=>e.kind==='human').actor,'小王');assert.equal(e.events.find(e=>e.kind==='decision').source,'auto-review');
 const good={summary:'写作项目',outcome:'生成正文',tags:['内容','内容'],milestones:[{title:'形成观点',summary:'基于最初想法',sources:['origin']}]};assert.deepEqual(checkedArchive(good,e).tags,['内容']);assert.throws(()=>checkedArchive({...good,milestones:[{...good.milestones[0],sources:['不存在']}]},e),/依据/);
});
test('重复长段、多个主标题、占位正文被识别；真实风险声明可以保留',()=>{
 const para='这是一段完整的内容。'.repeat(12);assert.ok(contentIssues('# 标题\n\n'+para+'\n\n'+para).length);assert.ok(contentIssues('# 标题\n# 另一个标题').length);assert.ok(contentIssues('TODO\n以后填写').length);assert.deepEqual(contentIssues('# 标题\n\n```sh\n# 代码注释\n```'),[]);assert.deepEqual(contentIssues('# 研究报告\n\n公开资料无法证明该预测，保留风险。'),[]);
});
test('正文内容才产生新文档版本；状态变化不重复正文，历史评论继续回流',()=>fixture(async root=>{
 const p={id:'p',chatId:'oc_p',botBindings:{chief:'chief'}},pack={workflow:{coordinator:'chief'},manifest:{artifacts:[{id:'a',name:'文章',path:'report/a.md',format:'markdown'}]}};
 await mkdir(path.join(root,'workspace/p/report'),{recursive:true});await mkdir(path.join(root,'workspace/p/context'));const file=path.join(root,'workspace/p/report/a.md');await writeFile(file,'# 成品\n\n正文第一版');
 const calls=[],docs=new Map();let n=0;const remote={documents:()=>({create:async()=>{const id='doc'+(++n);docs.set(id,[]);return id;},share:async()=>{},append:async(id,md,token,options)=>{calls.push({id,md,options});docs.get(id).push(md);},comments:async id=>id==='doc1'?[{comment_id:'c',reply_list:{replies:[{reply_id:'r',content:{elements:[{text_run:{text:'历史评论仍可见'}}]}}]}}]:[]})};
 const sync=createDocumentSync({root,feishu:remote});await sync.sync(p,pack,{status:'草稿'});await sync.sync(p,pack,{status:'项目已完成'});assert.equal(n,1);assert.equal(calls.length,1);assert.doesNotMatch(calls[0].md,/同步状态/);
 await writeFile(file,'# 成品\n\n正文第二版');await sync.sync(p,pack);assert.equal(n,2);assert.deepEqual(docs.get('doc2'),['# 成品\n\n正文第二版\n']);assert.equal(calls.at(-1).options.startIndex,0);assert.match(calls.at(-1).md,/doc2/);assert.equal((await sync.view(p)).items[0].versions.length,1);assert.match(await readFile(path.join(root,'workspace/p/context/document-feedback.md'),'utf8'),/历史评论仍可见/);
 await sync.sync(p,pack);assert.equal(calls.length,3);
}));
test('档案只读归纳、缓存相同证据、并发去重，原始项目状态保持不变',()=>fixture(async root=>{
 const lock=await installPackage('examples/team-package',root),pack=await lockedPackage(root,lock),recorder=createRecorder(root);const p={id:'p',name:'简报',demand:'写简报',stage:'accept',chatId:'web:p',roles:pack.manifest.roles,history:[]};
 await mkdir(path.join(root,'workspace/p/review'),{recursive:true});await writeFile(path.join(root,'workspace/p/review/brief.md'),'# 简报\n这是实际成果');let calls=0;
 const archives=createArchives({root,recorder,agent:async args=>{calls++;assert.equal(args.mode,'archive');assert.deepEqual(args.definition.write,[]);assert.match(args.prompt,/这是实际成果/);return{ok:true,structured:{summary:'简报项目',outcome:'有正文，待确认',tags:['简报'],milestones:[{title:'提出目标',summary:'要求写简报',sources:['origin']}]}};}});
 await Promise.all([archives.refresh(p,pack),archives.refresh(p,pack)]);await archives.wait();assert.equal(calls,1);await archives.refresh(p,pack);await archives.wait();assert.equal(calls,1);let view=await archives.view(p,pack,{full:true});assert.equal(view.status,'ready');assert.equal(view.stale,false);assert.equal(p.stage,'accept');await recorder.add(p.chatId,{kind:'user',text:'补充受众'});view=await archives.view(p,pack,{full:true});assert.equal(view.stale,true);
}));
test('质量检查要求真实 Read 回执，文件改动会使检查作废',()=>fixture(async root=>{
 const lock=await installPackage('examples/team-package',root),pack=await lockedPackage(root,lock),task=pack.workflow.nodes.find(n=>n.id==='review');const p={id:'p',demand:'写简报',roles:pack.manifest.roles};await mkdir(path.join(root,'workspace/p/review'),{recursive:true});const file=path.join(root,'workspace/p/review/brief.md');await writeFile(file,'# 简报\n已完成正文');
 const good={ok:true,structured:{passed:true,summary:'可用',blockers:[],artifacts:[{id:'review',reason:'检查了正文'}]}};
 // 使用清单实际 id，避免替身绕过文件契约。
 good.structured.artifacts[0].id=task.outputs[0];
 await assert.rejects(inspectDelivery({root,p,pack,task,agent:async()=>good}),/未实际读取/);
 await assert.rejects(inspectDelivery({root,p,pack,task,agent:async args=>{args.onProgress({tool:'Read',file,status:'succeeded'});await writeFile(file,'# 已经变化');return good;}}),/发生变化/);
}));
test('成品问题由原任务自动修正，最多两轮，人工关口和批准记录不被跳过',()=>fixture(async root=>{
 const lock=await installPackage('examples/team-package',root);let writes=0,fail=false;
 const agent=async args=>{if(args.outputSchema?.properties?.artifacts){const r=await fakeDelivery(args);return r;}for(const s of args.definition.skills)args.onProgress?.({tool:'Skill',file:s,status:'succeeded'});const file=args.role==='writer'?'drafts/brief.md':'review/brief.md';if(args.role==='reviewer')writes++;await writeFile(path.join(args.projectDir,file),args.role==='reviewer'&&(fail||writes===1)?'# 第一份\n# 重复正文':'# 简报\n目标与完整内容已经写清。');return{ok:true,text:'完成',stats:{}};};
 const engine=createPackageEngine({root,agent,recorder:createRecorder(root)});let p=await engine.create({package:lock,text:'写简报',options:{channel:'local'}});p=await engine.waitForIdle(p.id);await engine.action({chatId:p.chatId,value:{action:'package_confirm',stage:p.stage,projectId:p.id,cardId:p.cardId}});p=await engine.waitForIdle(p.id);assert.equal(p.stage,'accept');assert.equal(writes,2);assert.equal(p.deliveryReviews.length,2);assert.equal(p.approvals.length,1);
 fail=true;writes=0;await engine.action({chatId:p.chatId,value:{action:'package_reject',stage:p.stage,projectId:p.id,cardId:p.cardId},feedback:'调整正文'});p=await engine.waitForIdle(p.id);assert.equal(writes,3);assert.match(p.error,/成品检查未通过/);assert.notEqual(p.stage,'done');
}));

test('档案 SDK 仅允许读取本项目，无写入、Skill、网络及续用工作会话',()=>fixture(async root=>{
 const lock=await installPackage('examples/team-package',root),pack=await lockedPackage(root,lock),definition=await roleDefinition(pack,'writer',root),dir=path.join(root,'workspace/one');
 await mkdir(dir,{recursive:true});await writeFile(path.join(root,'.env'),'MODEL_BASE_URL=https://example.invalid\nMODEL_API_KEY=test-placeholder\nMODEL_NAME=test\n');
 let options;const query=async function* (args){options=args.options;yield{type:'result',subtype:'success',result:'档案',structured_output:{summary:'真实资料'}};};
 const result=await createRunAgent(query)({role:'writer',definition,projectDir:dir,runtimeRoot:root,prompt:'整理档案',mode:'archive',resume:'不得续用',isolateSession:true,outputSchema:{type:'object'}});
 assert.ok(result.ok);assert.deepEqual(options.tools,['Read','Glob']);assert.equal(options.resume,undefined);assert.equal(options.plugins,undefined);assert.equal(options.mcpServers,undefined);
 assert.equal((await options.canUseTool('Write',{file_path:'drafts/test.md'})).behavior,'deny');assert.equal((await options.canUseTool('Read',{file_path:'../two/report.md'})).behavior,'deny');assert.equal((await options.canUseTool('Read',{file_path:'context/project.json'})).behavior,'allow');
}));

test('旧网页项目保留原编排，档案真实引用网页；共享旧群按项目时间隔离讨论',()=>fixture(async root=>{
 const state={projects:[{id:'old',name:'旧网页',demand:'建报名页',chatId:'shared',stage:'done',createdAt:'2026-01-01T00:00:00Z'},{id:'next',name:'新网页',chatId:'shared',stage:'done',createdAt:'2026-02-01T00:00:00Z'}]};
 await mkdir(path.join(root,'workspace/old/site'),{recursive:true});await writeFile(path.join(root,'workspace/old/site/index.html'),'<h1>实际网页</h1>');
 const recorder=createRecorder(root);await recorder.add('shared',{at:'2026-01-02T00:00:00Z',kind:'user',text:'旧项目意见'});await recorder.add('shared',{at:'2026-02-02T00:00:00Z',kind:'user',text:'另一项目意见'});
 const service=legacyArchiveService({root,assetsRoot:process.cwd(),flow:{getState:async()=>state},recorder,previewBase:'http://127.0.0.1:4871'});
 const list=await service.list();assert.equal(list[0].artifacts[0].id,'site');assert.equal(list[0].archiveTeam,'web-studio');assert.equal(list[0].package,undefined);const full=await service.get('old');assert.equal(full.source.artifacts[0].text,'<h1>实际网页</h1>');assert.ok(JSON.stringify(full).includes('旧项目意见'));assert.ok(!JSON.stringify(full).includes('另一项目意见'));assert.equal(state.projects[0].stage,'done');state.projects[1].chatId=null;assert.ok((await service.get('next')).source);await assert.rejects(service.get('../outside'),/不存在/);
}));
