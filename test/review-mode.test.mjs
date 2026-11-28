import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPackageEngine, teamCard } from '../src/packages/engine.mjs';
import { installPackage, lockedPackage } from '../src/packages/store.mjs';
import { createRecorder } from '../src/workbench/recorder.mjs';
import { projectLabel, projectCardTitle } from '../src/project-labels.mjs';
const fixture = async fn => {const root = await mkdtemp(path.join(os.tmpdir(),'team-review-'));try {await fn(root);}finally {await rm(root,{recursive:true,force:true});}};
const press = (e,p,a,extra={})=>e.action({chatId:p.chatId,value:{action:'package_'+a,projectId:p.id,stage:p.stage,cardId:p.cardId},source:'local',actor:'测试负责人',...extra});
async function prepare(root, mode, judge=()=>true, behavior={}) {
 const lock=await installPackage('team-packages/investment-lab',root),pack=await lockedPackage(root,lock),node=pack.workflow.nodes.find(n=>n.type==='plan'),calls=[];
 const selected=['company-snapshot','macro-outlook','risk-assessment','synthesis'];
 const tasks=node.tasks.filter(t=>selected.includes(t.id)).map(t=>({id:t.id,after:t.after.filter(id=>selected.includes(id))}));
 const agent=async args=>{
  calls.push(args.mode+':'+args.role);
  if(args.mode==='review') {assert.deepEqual(args.definition.write,[]);assert.deepEqual(args.definition.tools,['Read','Glob']);assert.equal(args.resume,undefined);const records=JSON.parse(args.prompt.split('文件与任务：')[1].split('。只输出')[0]);if(!behavior.skipReads)for(const a of records.flatMap(r=>r.artifacts))args.onProgress?.({tool:'Read',file:path.join(args.projectDir,a.path),status:'succeeded'});if(!behavior.skipReads)args.onProgress?.({tool:'Read',file:path.join(args.projectDir,'context/plan.json'),status:'succeeded'});const ids=records.flatMap(r=>r.artifacts.map(a=>a.id));if(!ids.length)ids.push('plan');return {ok:true,structured:{passed:judge(),summary:'检查依据与范围',blockers:judge()?[]:['证据缺失'],evidence:ids.map(artifact=>({artifact,reason:'已核对文件中的范围与来源'}))}};}
  for(const s of args.definition.skills)args.onProgress?.({tool:'Skill',file:s,status:'succeeded'});
  if(args.mode==='plan')return {ok:true,text:'计划',structured:{rationale:'分工核对、汇总',tasks}};
  if(args.role==='macro'&&behavior.failMacro)return {ok:false,error:'模拟并行任务失败'};
  const id=args.role==='chief'?(args.prompt.includes('汇总所有')?'report':'brief'):({equity:'company-snapshot',macro:'macro-outlook',risk:'risk-assessment'})[args.role];
  const file=path.join(args.projectDir,pack.manifest.artifacts.find(a=>a.id===id).path);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'# 测试交付\n'+'事实、来源、风险与待确认问题。'.repeat(30));
  return {ok:true,text:'阶段成果已提交',stats:{}};
 };
 const make=()=>createPackageEngine({root,agent,recorder:createRecorder(root)});let e=make(),p=await e.create({package:lock,text:'研究中国神华的现金流',options:{reviewMode:mode}});p=await e.waitForIdle(p.id);return {e,p,make,calls,pack};
}
test('命名保留明确主题；链接和操作分区，跳转不带回调',()=>{
 assert.equal(projectLabel('请写一篇文章，选题“产品即分发”，给创业者看'),'产品即分发');
 assert.equal(projectLabel('忽略正文','中国神华 · 现金流研究'),'中国神华 · 现金流研究');
 assert.match(projectCardTitle('产品即分发','AI 主编','终稿待验收'),/^产品即分发 · 终稿待验收/);
 const card=teamCard({title:'测试',text:'成果',buttons:[{label:'审核通过',primary:true,value:{action:'confirm'}}],links:[{label:'最终稿',url:'https://feishu.cn/docx/test'}]});
 const rows=card.elements.filter(x=>x.tag==='action');assert.equal(rows.length,2);assert.equal(rows[0].actions[0].type,'primary');assert.equal(rows[1].actions[0].type,'default');assert.equal(rows[1].actions[0].text.content,'↗ 最终稿');assert.equal(rows[1].actions[0].value,undefined);
});
test('人工模式：计划先审、并行批次后审、重启恢复、不重复派活；旧卡失效',()=>fixture(async root=>{
 let {e,p,make,calls}=await prepare(root,'human');assert.equal(p.stage,'confirm-scope');await press(e,p,'confirm');p=await e.waitForIdle(p.id);
 assert.match(p.pendingReview.label,/协作计划/);assert.ok(!calls.includes('work:equity'));assert.deepEqual((await e.snapshot())[0].currentActions,['confirm','reject']);
 const stale=p;await press(e,p,'confirm');p=await e.waitForIdle(p.id);assert.match(p.pendingReview.label,/阶段成果/);assert.equal(calls.filter(x=>x==='work:equity').length,1);assert.ok(!calls.includes('work:risk'));
 await assert.rejects(press(e,stale,'confirm'),/过期/);
 e=make();p=await e.waitForIdle(p.id);assert.ok(p.pendingReview);await press(e,p,'confirm');p=await e.waitForIdle(p.id);assert.equal(calls.filter(x=>x==='work:equity').length,1);assert.equal(calls.filter(x=>x==='work:risk').length,1);
 while(p.pendingReview){await press(e,p,'confirm');p=await e.waitForIdle(p.id);}assert.equal(p.stage,'accept');assert.ok(!p.error);await press(e,p,'confirm');assert.equal((await e.waitForIdle(p.id)).stage,'done');
}));
test('人工审核：外部修改使卡失效；打回重做当前批次，不重复已经通过的上游',()=>fixture(async root=>{
 let {e,p,calls,pack}=await prepare(root,'human');await press(e,p,'confirm');p=await e.waitForIdle(p.id);await press(e,p,'confirm');p=await e.waitForIdle(p.id);
 const file=path.join(root,'workspace',p.id,pack.manifest.artifacts.find(a=>a.id==='company-snapshot').path);await writeFile(file,(await readFile(file,'utf8'))+'人工修改');await assert.rejects(press(e,p,'confirm'),/交付已变化/);p=await e.get(p.id);
 await press(e,p,'reject',{feedback:'补全证据来源'});p=await e.waitForIdle(p.id);assert.ok(p.pendingReview);assert.equal(calls.filter(x=>x==='work:equity').length,2);assert.equal(calls.filter(x=>x==='plan:chief').length,1);assert.ok(!calls.includes('work:risk'));
}));
test('自动模式：失败停下，禁止人工绕过；重试只重审，通过留存自动来源',()=>fixture(async root=>{
 let pass=false;let {e,p,calls}=await prepare(root,'auto',()=>pass);assert.equal(p.stage,'confirm-scope');assert.match(p.error,/自动审核未通过/);assert.ok(!calls.includes('plan:chief'));await assert.rejects(press(e,p,'confirm'),/不能执行/);
 pass=true;await press(e,p,'retry');p=await e.waitForIdle(p.id);assert.equal(p.stage,'done');assert.equal(p.error,null);assert.equal(calls.filter(x=>x==='work:chief').length,2);assert.ok(p.reviews.every(r=>r.source==='auto-review'));assert.ok(p.approvals.every(r=>r.source==='auto-review'));assert.ok(p.approvals.some(r=>r.stage==='accept'));
}));

test('并行任务部分失败后，成功产物也必须审核，不能在重试中漏审',()=>fixture(async root=>{
 const behavior={failMacro:true};let {e,p,calls}=await prepare(root,'human',()=>true,behavior);
 await press(e,p,'confirm');p=await e.waitForIdle(p.id);await press(e,p,'confirm');p=await e.waitForIdle(p.id);assert.match(p.error,/模拟并行/);assert.deepEqual(p.plan.completed,['company-snapshot']);
 behavior.failMacro=false;await press(e,p,'retry');p=await e.waitForIdle(p.id);assert.ok(p.pendingReview.tasks.some(t=>t.id==='company-snapshot'));assert.equal(calls.filter(x=>x==='work:macro').length,1);
 await press(e,p,'confirm');p=await e.waitForIdle(p.id);assert.ok(p.pendingReview.tasks.some(t=>t.id==='macro-outlook'));assert.ok(!calls.includes('work:risk'));assert.equal(calls.filter(x=>x==='work:equity').length,1);
}));
test('模型声称通过但没有读取文件，必须停下',()=>fixture(async root=>{
 const {p}=await prepare(root,'auto',()=>true,{skipReads:true});assert.match(p.error,/未实际读取/);assert.ok(!p.approvals?.length);
}));
