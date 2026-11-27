import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, cp, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadPackage, installPackage, exportPackage, lockedPackage } from '../src/packages/store.mjs';
import { validateDefinition, validatePlan } from '../src/packages/schema.mjs';
import { createPackageEngine } from '../src/packages/engine.mjs';
import { createRecorder } from '../src/workbench/recorder.mjs';
import { createProjectManager } from '../src/projects/manager.mjs';
import { createRunAgent } from '../src/agents/run.mjs';
import { roleDefinition } from '../src/packages/runtime.mjs';
import { installNewtype } from '../src/packages/newtype.mjs';
import { publicAddress, extractText } from '../src/packages/research.mjs';
import { bindRole, extraCredentials } from '../src/packages/bindings.mjs';
import { createTeam } from '../src/team.mjs';
import { startPreview } from '../src/preview.mjs';
import { createPackageLobby } from '../src/packages/lobby.mjs';

const stats = { turns: 1, durationMs: 1, inputTokens: 1, outputTokens: 1 };
const fixture = async fn => { const root = await mkdtemp(path.join(os.tmpdir(), 'team-package-test-')); try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); } };
const put = async (dir, file, value) => { await mkdir(path.dirname(path.join(dir, file)), { recursive: true }); await writeFile(path.join(dir, file), typeof value === 'string' ? value : JSON.stringify(value)); };
const fake = async args => {
  if (args.mode === 'chat') return { ok: true, text: '只读讨论', structured: { reply: '只读讨论', proposal: { action: 'none', detail: '' } }, stats };
  for (const s of args.definition.skills) args.onProgress?.({ tool: 'Skill', file: s });
  const out = args.role === 'writer' ? 'drafts/brief.md' : 'review/brief.md';
  await put(args.projectDir, out, `# 简报\n${path.basename(args.projectDir)}\n目标、事实、待确认事项`);
  return { ok: true, text: '完成', sessionId: `${path.basename(args.projectDir)}-${args.role}`, stats };
};
const press = async (engine, p, action, extra = {}) => engine.action({ chatId: p.chatId, value: { action: `package_${action}`, projectId: p.id, stage: p.stage, cardId: p.cardId }, ...extra });

test('标准包校验拒绝未知角色/技能、越权产物、额外工具及无出口循环', async () => {
  const p = await loadPackage('examples/team-package');
  const mutate = fn => { const m = structuredClone(p.manifest), w = structuredClone(p.workflow); fn(m, w); return () => validateDefinition(m, w); };
  assert.throws(mutate((m,w) => w.nodes[0].role = 'missing'));
  assert.throws(mutate((m,w) => w.nodes[0].skills = ['reviewer-method']));
  assert.throws(mutate((m,w) => w.nodes[0].outputs = ['reviewer']));
  assert.throws(mutate(m => m.roles[0].tools.push('Bash')));
  assert.throws(mutate((m,w) => w.nodes[3].next = 'review'));
  assert.throws(mutate(m => m.roles[0].write = ['context']));
});

test('允许清单导出与干净安装：源目录移走后仍可加载，摘要被改就拒绝', () => fixture(async root => {
  const source = path.join(root, 'source'); await cp('examples/team-package', source, { recursive: true });
  await put(source, '.env', 'do-not-export'); await put(source, 'data/session.json', { private: true });
  const bundle = path.join(root, 'team.team.json'); const result = await exportPackage(source, bundle);
  assert.doesNotMatch(await readFile(bundle, 'utf8'), /do-not-export|session.json/);
  await rm(source, { recursive: true }); const lock = await installPackage(bundle, root);
  assert.equal((await lockedPackage(root, lock)).hash, result.hash);
  await writeFile(path.join(lock.directory, 'agents/writer.md'), 'changed');
  await assert.rejects(lockedPackage(root, lock), /内容已变化/);
}));

test('包导入拒绝路径穿越、软链接、凭据和摘要篡改', () => fixture(async root => {
  const source = path.join(root, 'source'); await cp('examples/team-package', source, { recursive: true });
  await rm(path.join(source, 'agents/writer.md')); await symlink(path.resolve('README.md'), path.join(source, 'agents/writer.md'));
  await assert.rejects(loadPackage(source), /软链接/);
  await rm(path.join(source, 'agents/writer.md')); await put(source, 'agents/writer.md', 'API_KEY=' + 'A'.repeat(30));
  await assert.rejects(loadPackage(source), /凭据/);
  await cp('examples/team-package/agents/writer.md', path.join(source, 'agents/writer.md'));
  const file = path.join(root, 'bundle.json'); await exportPackage(source, file);
  const value = JSON.parse(await readFile(file)); value.files['../escape'] = value.files['LICENSE']; await put(root, 'bundle.json', value);
  await assert.rejects(installPackage(file, root));
  delete value.files['../escape']; value.files['LICENSE'].base64 = Buffer.from('changed').toString('base64'); await put(root, 'bundle.json', value);
  await assert.rejects(installPackage(file, root), /摘要/);
}));

test('动态计划必须保留任务依赖、必做汇总且不能让同一角色并行', async () => {
  const p = await loadPackage('team-packages/investment-lab'), n = p.workflow.nodes.find(n => n.type === 'plan');
  const plan = { rationale: '先来源，再独立分析与审查', tasks: n.tasks.map(t => ({ id:t.id,after:t.after })) };
  assert.equal(validatePlan(n, plan, p.manifest).tasks.length, 6);
  const broken=structuredClone(plan);broken.tasks.find(t=>t.id==='judge').after=['analyst'];assert.throws(()=>validatePlan(n,broken,p.manifest),/交接/);
  assert.throws(()=>validatePlan(n,{...plan,tasks:plan.tasks.slice(1)},p.manifest),/必做/);
  const cycle=structuredClone(plan);cycle.tasks[0].after=['synthesis'];assert.throws(()=>validatePlan(n,cycle,p.manifest),/成环/);
});

test('自定义第四包并行项目从导入到验收：项目、会话、卡片与确认人互相隔离', () => fixture(async root => {
  const bundle=path.join(root,'share.team.json');await exportPackage('examples/team-package',bundle);const lock=await installPackage(bundle,root);
  const recorder=createRecorder(root),projects=createProjectManager({root,recorder});
  const owner=await projects.directory.upsert({name:'负责人',responsibilities:[]});const reviewer=await projects.directory.upsert({name:'确认人',responsibilities:[]});await projects.directory.settings({ownerId:owner.id});
  const engine=createPackageEngine({root,recorder,projects,agent:fake});
  const a=await engine.create({package:lock,text:'甲项目',options:{channel:'local',memberIds:[reviewer.id],approvers:{accept:reviewer.id}}});
  const b=await engine.create({package:lock,text:'乙项目',options:{channel:'local'}});
  const [pa,pb]=await Promise.all([engine.waitForIdle(a.id),engine.waitForIdle(b.id)]);assert.equal(pa.stage,'scope');assert.equal(pb.stage,'scope');
  assert.notEqual(pa.sessions.writer,pb.sessions.writer);
  await assert.rejects(engine.action({chatId:pb.chatId,value:{action:'package_confirm',projectId:pa.id,stage:pa.stage,cardId:pa.cardId}}),/过期/);
  const ownerEvent={identity:{localPersonId:owner.id},source:'local'};
  await press(engine,pa,'confirm',ownerEvent);await assert.rejects(press(engine,pa,'confirm',ownerEvent),/过期/);
  const gate=await engine.waitForIdle(pa.id);assert.equal(gate.stage,'accept');
  await assert.rejects(press(engine,gate,'confirm',ownerEvent),/确认人/);
  await press(engine,gate,'confirm',{identity:{localPersonId:reviewer.id},source:'local'});assert.equal((await engine.waitForIdle(pa.id)).stage,'done');
  assert.equal((await engine.get(pb.id)).stage,'scope');
  assert.match(await readFile(path.join(root,'workspace',pa.id,'review/brief.md'),'utf8'),new RegExp(pa.id));
  assert.doesNotMatch(await readFile(path.join(root,'workspace',pb.id,'context/discussion.md'),'utf8'),/甲项目/);
}));

test('失败交付停下、重试原节点；打回需意见且会重新验收', () => fixture(async root => {
  const lock=await installPackage('examples/team-package',root);let fail=true,calls=0;
  const engine=createPackageEngine({root,recorder:createRecorder(root),agent:async args=>{calls++;if(fail)return{ok:false,text:'',error:'模拟工具失败',stats};return fake(args);}});
  const p=await engine.create({package:lock,text:'简报'});let gate=await engine.waitForIdle(p.id);assert.match(gate.error,/模拟/);assert.equal(gate.stage,'draft');
  fail=false;await press(engine,gate,'retry');gate=await engine.waitForIdle(p.id);assert.equal(gate.stage,'scope');assert.equal(calls,2);
  await press(engine,gate,'reject');gate=await engine.get(p.id);assert.equal(gate.waitingFeedback,true);assert.equal(calls,2);
  await engine.message({chatId:p.chatId,role:'writer',text:'缩短成两句',senderType:'user'});gate=await engine.waitForIdle(p.id);assert.equal(gate.stage,'scope');assert.equal(gate.feedback,'缩短成两句');
}));

test('SDK 团队角色读写、Skill、网络能力与结构化输出按声明限制', () => fixture(async root => {
  const lock=await installPackage('examples/team-package',root),pack=await lockedPackage(root,lock);const dir=path.join(root,'workspace','one');await mkdir(dir,{recursive:true});
  await put(root,'.env','MODEL_BASE_URL=https://example.invalid\nMODEL_API_KEY=test-placeholder\nMODEL_NAME=test\n');
  let options;const query=async function* (args){options=args.options;yield{type:'result',subtype:'success',result:'完成',structured_output:{a:1}};};
  const definition=await roleDefinition(pack,'writer',root);
  const result=await createRunAgent(query)({role:'writer',definition,projectDir:dir,runtimeRoot:root,prompt:'写简报',isolateSession:true,outputSchema:{type:'object'}});assert.equal(result.ok,true);assert.deepEqual(result.structured,{a:1});
  for(const [tool,input,expected]of [['Write',{file_path:'drafts/x.md'},'allow'],['Write',{file_path:'review/x.md'},'deny'],['Read',{file_path:'context/project.json'},'allow'],['Read',{file_path:'../other/secret'},'deny'],['Glob',{pattern:'**/*'},'deny'],['Skill',{skill:'team:reviewer-method'},'deny'],['mcp__research__search',{},'deny'],['StructuredOutput',{},'allow'],['Bash',{command:'pwd'},'deny']])assert.equal((await options.canUseTool(tool,input)).behavior,expected);
  assert.equal(options.env.FEISHU_PRODUCT_APP_SECRET,undefined);assert.equal(options.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY,'1');
}));

test('Newtype 安装适配器保留八角色、上游声明与最小编辑路由，未运行宿主安装器', () => fixture(async root => {
  const fetchImpl=async url=>({ok:true,text:async()=>url.endsWith('plugin.json')?JSON.stringify({license:'SUL-1.0',version:'0.2.2'}):url.endsWith('.toml')?'developer_instructions = """Read the assigned source, then perform your role."""':'upstream source'});
  const lock=await installNewtype(root,fetchImpl),p=await lockedPackage(root,lock);assert.equal(p.manifest.roles.length,8);assert.equal(p.manifest.license,'SUL-1.0');
  const plan=p.workflow.nodes[0];assert.deepEqual(validatePlan(plan,{rationale:'只改已有稿',tasks:[{id:'edit',after:[]},{id:'synthesis',after:['edit']}]},p.manifest).tasks.map(t=>t.id),['edit','synthesis']);
  assert.ok(p.files.has('upstream/chief.toml'));assert.match(p.files.get('THIRD_PARTY_NOTICES.md').toString(),/未提供 LICENSE/);
}));

test('研究能力拒绝内网地址，网页提取不执行脚本', () => {
  for(const ip of ['127.0.0.1','10.0.1.2','169.254.169.254','172.16.1.2','192.168.0.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(extractText('<script>secret()</script><p>Hello &amp; world</p>'),'Hello & world');
});

test('角色机器人一对一绑定、跨团队复用；同应用不能重复连接', () => fixture(async root => {
  await installPackage('examples/team-package',root);const env={FEISHU_PRODUCT_APP_ID:'one',FEISHU_PRODUCT_APP_SECRET:'fake'};
  await bindRole(root,'brief-demo','writer','product',env);
  await assert.rejects(bindRole(root,'brief-demo','reviewer','product',env),/独立机器人/);
  assert.throws(()=>extraCredentials({...env,FEISHU_OTHER_APP_ID:'one',FEISHU_OTHER_APP_SECRET:'fake'},{}),/多个机器人/);
}));

test('真实装配与 HTTP 工作台：动态团队建项、同源保护和安全产物接口', () => fixture(async root => {
  const lock=await installPackage('examples/team-package',root);
  const transport=()=>({sendText:async()=>{},sendCard:async()=>{},patchCard:async()=>{},listChats:async()=>[]});
  const {flow,feishu,recorder}=createTeam({root,env:{TEAM_MODE:'basic'},credentials:{},agent:fake,transport});
  const server=await startPreview({root,assetsRoot:process.cwd(),flow,feishu,recorder,workbenchPort:0,modelPort:0});
  try{
    const base=`http://127.0.0.1:${server.workbenchPort}`;
    assert.equal((await fetch(base+'/teams')).status,200);
    const headers={'Content-Type':'application/json','X-Workbench':'1'};
    const body=JSON.stringify({package:lock,text:'端到端简报',requestId:'request-one'});
    assert.equal((await fetch(base+'/api/packages/projects',{method:'POST',headers:{...headers,Origin:'http://evil.invalid'},body})).status,403);
    const r=await fetch(base+'/api/packages/projects',{method:'POST',headers,body});assert.equal(r.status,200,await r.clone().text());const p=await r.json();await flow.packages.waitForIdle(p.id);
    const snapshot=await(await fetch(base+'/api/state')).json();assert.equal(snapshot.projects.length,1);assert.equal(snapshot.projects[0].stageType,'gate');
    assert.equal((await fetch(base+'/api/packages/artifact?projectId='+p.id+'&artifactId=../.env')).status,400);
    const artifact=await(await fetch(base+'/api/packages/artifact?projectId='+p.id+'&artifactId=writer')).json();assert.match(artifact.text,/目标/);
  }finally{await server.close();}
}));

test('计划并行失败后保留成功任务，重启后重试只补失败项', () => fixture(async root => {
  const lock=await installPackage('team-packages/investment-lab',root),pack=await lockedPackage(root,lock),node=pack.workflow.nodes.find(n=>n.type==='plan');
  const calls=[];let fails=true,active=0,peak=0;
  const agent=async args=>{
    calls.push(args.role+(args.outputSchema?':plan':''));for(const s of args.definition.skills)args.onProgress?.({tool:'Skill',file:s});
    if(args.outputSchema)return{ok:true,text:'计划',structured:{rationale:'并行分析和审查',tasks:node.tasks.map(t=>({id:t.id,after:t.after}))},stats};
    active++;peak=Math.max(active,peak);await new Promise(r=>setTimeout(r,10));active--;
    if(args.role==='venture'&&fails)return{ok:false,text:'',error:'模拟评审失败',stats};
    const file=args.role==='chief'?(args.prompt.includes('汇总所有')?'report/final.md':'brief/result.md'):pack.manifest.artifacts.find(a=>a.id===args.role).path;
    await put(args.projectDir,file,'# 模拟交付\n基于证据');return{ok:true,text:'完成',sessionId:args.role,stats};
  };
  let engine=createPackageEngine({root,agent,recorder:createRecorder(root)});
  let p=await engine.create({package:lock,text:'模拟研究'});p=await engine.waitForIdle(p.id);await press(engine,p,'confirm');p=await engine.waitForIdle(p.id);
  assert.match(p.error,/评审失败/);assert.ok(p.plan.completed.includes('radar'));assert.ok(p.plan.completed.includes('analyst'));assert.equal(peak,2);
  engine=createPackageEngine({root,agent,recorder:createRecorder(root)});fails=false;await press(engine,await engine.get(p.id),'retry');p=await engine.waitForIdle(p.id);assert.equal(p.stage,'accept');
  assert.equal(calls.filter(x=>x==='radar').length,1);assert.equal(calls.filter(x=>x==='analyst').length,1);assert.equal(calls.filter(x=>x==='venture').length,2);
  await press(engine,p,'confirm');assert.equal((await engine.waitForIdle(p.id)).stage,'done');
}));

test('第三方 JSON 分支与自定义确认职责在同一引擎执行', () => fixture(async root => {
  const source=path.join(root,'source');await cp('examples/team-package',source,{recursive:true});
  const m=JSON.parse(await readFile(path.join(source,'manifest.json'))),w=JSON.parse(await readFile(path.join(source,m.workflow)));
  m.artifacts.push({id:'decision',name:'结果选择',path:'drafts/decision.json',format:'json',requiredKeys:['result']});
  w.nodes[0].outputs.push('decision');w.nodes[0].route={artifact:'decision',field:'result',cases:{ready:'scope',revise:'draft'}};w.nodes[1].approval='editorial-review';
  await put(source,'manifest.json',m);await put(source,m.workflow,w);const lock=await installPackage(source,root);
  const recorder=createRecorder(root),projects=createProjectManager({root,recorder});
  const owner=await projects.directory.upsert({name:'发起人',responsibilities:[]});const reviewer=await projects.directory.upsert({name:'编辑负责人',responsibilities:[{job:'编辑',scope:'内容',approvals:['editorial-review']}]});await projects.directory.settings({ownerId:owner.id});
  const engine=createPackageEngine({root,recorder,projects,agent:async args=>{const result=await fake(args);if(args.role==='writer')await put(args.projectDir,'drafts/decision.json',{result:'ready'});return result;}});
  let p=await engine.create({package:lock,text:'内容项目'});p=await engine.waitForIdle(p.id);assert.equal(p.team.approvers['editorial-review'],reviewer.id);
  await assert.rejects(press(engine,p,'confirm',{source:'local',identity:{localPersonId:owner.id}}),/编辑负责人/);
  await press(engine,p,'confirm',{source:'local',identity:{localPersonId:reviewer.id}});assert.equal((await engine.waitForIdle(p.id)).stage,'accept');
}));

test('停止会中断当前 Agent，服务重启时未完成任务不会自动执行', () => fixture(async root => {
  const lock=await installPackage('examples/team-package',root);let start,stop,calls=0;
  const started=new Promise(r=>start=r);
  const engine=createPackageEngine({root,recorder:createRecorder(root),agent:async args=>{calls++;const promise=new Promise(r=>stop=()=>r({ok:false,error:'用户停下',stats}));args.control.stop=async()=>stop();start();return promise;}});
  const p=await engine.create({package:lock,text:'测试停下'});await started;await press(engine,await engine.get(p.id),'stop');assert.match((await engine.waitForIdle(p.id)).error,/停下/);
  const stateFile=path.join(root,'data/package-projects.json'),state=JSON.parse(await readFile(stateFile));state.projects[0].busy=true;await put(root,'data/package-projects.json',state);
  const restarted=createPackageEngine({root,recorder:createRecorder(root),agent:async()=>{calls++;throw Error('不应自动执行');}});assert.match((await restarted.get(p.id)).error,/重启/);assert.equal(calls,1);
}));

test('标准网页包完整澄清、设计、开发、走查、验收与打回保持顺序', () => fixture(async root => {
  const lock=await installPackage('team-packages/web-studio',root);const stages=[];
  const agent=async args=>{
    for(const s of args.definition.skills)args.onProgress?.({tool:'Skill',file:s});stages.push(args.role);
    if(args.role==='product'){
      if(!args.resume)await put(args.projectDir,'docs/questions.json',{round:1,why:'确认报名方式',questions:[{id:'q1',question:'是否报名',matters:'字段',options:['是','否'],recommended:0,reason:'按目标'}]});
      else{
        await put(args.projectDir,'docs/prd.md',['# 模拟报名页','## 产品概述','## 目标用户与场景','## 用户故事','假如打开页面，当提交报名，那么看到成功。','## 页面与状态','default','## 边界情况','## 功能需求','FR-001 报名','## 成功标准','SC-001 成功','## 假设','## 本期不做'].join('\n'));
        await put(args.projectDir,'docs/outline.json',{title:'模拟报名页',blocks:[{name:'首页',content:'报名'}],states:[{id:'default',name:'默认',desc:'填写'}]});
        await put(args.projectDir,'docs/checklist.md',Array.from({length:14},(_,i)=>`- [x] CHK${String(i+1).padStart(3,'0')}`).join('\n'));
      }
    }else if(args.role==='designer'&&args.prompt.includes('轮走查')){
      assert.equal(args.resume,undefined);await put(args.projectDir,'design/walkthrough.json',{round:1,conclusion:'通过',summary:'完成',coverage:[],findings:[],groups:[{title:'报名',flowNote:'填写',screens:[{title:'报名页',state:'default',reproduce:'打开',mark:'可以',note:'显示表单'}]}]});
    }else if(args.role==='designer'){
      await put(args.projectDir,'design/wireframe.html','<html><section data-screen="page" data-state="default"></section><script type="application/json" id="design-outline">{"groups":[{"id":"signup","title":"报名","screens":[{"id":"page","title":"报名页","states":["default"]}]}]}</script><script>addEventListener("hashchange",()=>{}); // #screen=page&state=default</script></html>');
      const colors=Object.fromEntries(['background','surface','text','muted','border','primary','onPrimary','accent','success','warning','error','disabled'].map(x=>[x,'#123456']));
      await put(args.projectDir,'design/theme.json',{preset:'modern',name:'现代',reason:'清楚',tokens:{colors,typography:{body:'system'},radii:{sm:4},spacing:{sm:8},shadows:{none:'none'}}});
    }else await put(args.projectDir,'site/index.html','<html><style></style><script>const states=["default"];addEventListener("hashchange",()=>location.hash.includes("state="));</script></html>');
    return{ok:true,text:'模拟完成',sessionId:args.role,stats};
  };
  const engine=createPackageEngine({root,recorder:createRecorder(root),agent});let p=await engine.create({package:lock,text:'报名页'});p=await engine.waitForIdle(p.id);assert.equal(p.stage,'questions');
  await press(engine,p,'answer',{formValue:{q1:'0'}});p=await engine.waitForIdle(p.id);assert.equal(p.stage,'confirm-prd');
  await press(engine,p,'confirm');p=await engine.waitForIdle(p.id);assert.equal(p.stage,'confirm-design');
  await press(engine,p,'confirm');p=await engine.waitForIdle(p.id);assert.equal(p.stage,'accept');
  await press(engine,p,'reject',{feedback:'调整报名提示'});p=await engine.waitForIdle(p.id);assert.equal(p.stage,'accept');assert.deepEqual(stages.slice(-2),['developer','designer']);
  await press(engine,p,'confirm');assert.equal((await engine.waitForIdle(p.id)).stage,'done');
}));

test('新团队入口由发起人确认后建群，并按项目切分建项前讨论', () => fixture(async root => {
  await installPackage('examples/team-package',root);
  await bindRole(root,'brief-demo','writer','brief-writer',{FEISHU_BRIEF_WRITER_APP_ID:'fake-app',FEISHU_BRIEF_WRITER_APP_SECRET:'fake-secret'});
  const recorder=createRecorder(root),projects=createProjectManager({root,recorder});
  const creator=await projects.observe({unionId:'synthetic-owner'},'发起人');await projects.directory.settings({ownerId:creator.id});await projects.observe({unionId:'synthetic-other'},'其他人');
  const cards=[],created=[];
  const feishu={sendCard:async(chat,card)=>{cards.push(card);},sendText:async()=>{}};
  const engine={create:async input=>{created.push(input);return{name:'项目',chatId:'oc_simulated',chatLink:''};}};
  const lobby=createPackageLobby({root,engine,projects,feishu,recorder});
  const event={chatId:'oc_lobby',role:'brief-writer',text:'第一件事',identity:{unionId:'synthetic-owner'},senderType:'user'};
  await recorder.add(event.chatId,{kind:'user',text:'第一轮讨论'});await lobby.message(event);
  const value=cards.at(-1).elements.at(-1).actions[0].value;
  await assert.rejects(lobby.action({...event,value,identity:{unionId:'synthetic-other'}}),/提出需求的人/);
  await lobby.action({...event,value});assert.equal(created.length,1);assert.equal(created[0].intake[0].text,'第一轮讨论');
  await assert.rejects(lobby.action({...event,value}),/过期/);
  await recorder.add(event.chatId,{kind:'user',text:'第二轮讨论'});await lobby.message({...event,text:'第二件事'});
  await lobby.action({...event,value:cards.at(-1).elements.at(-1).actions[0].value});
  assert.deepEqual(created[1].intake.map(x=>x.text),['第二轮讨论']);
  assert.equal(await lobby.message({...event,role:'product'}),false);
}));
