import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveRolePrompt } from '../src/packages/prompt-editor.mjs';
import { installPackage, listPackages, lockedPackage } from '../src/packages/store.mjs';
import { messagePage } from '../src/workbench/history.mjs';
import { taskRecords } from '../web/team-ui.mjs';
import { createRecorder } from '../src/workbench/recorder.mjs';
import { startPreview } from '../src/preview.mjs';
import { createPackageEngine } from '../src/packages/engine.mjs';
const fixture=async fn=>{const root=await mkdtemp(path.join(os.tmpdir(),'workbench-v2-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}};

test('提示词保存创建新包，旧版本、其他角色、工作流和 Skill 完全保留；冲突不覆盖',()=>fixture(async root=>{
 const lock=await installPackage('examples/team-package',root),old=await lockedPackage(root,lock),role=old.manifest.roles[0];
 const text=old.files.get(role.prompt).toString();
 assert.equal((await saveRolePrompt(root,{package:lock,role:role.id,prompt:text})).unchanged,true);
 const changed=await saveRolePrompt(root,{package:lock,role:role.id,prompt:text+'\n写清下一步。\n'}),fresh=await lockedPackage(root,changed);
 assert.notEqual(changed.hash,lock.hash);assert.notEqual(changed.version,lock.version);
 assert.equal((await lockedPackage(root,lock)).files.get(role.prompt).toString(),text);
 for(const [name,bytes]of old.files)if(!['manifest.json',role.prompt].includes(name))assert.deepEqual(fresh.files.get(name),bytes,name);
 await assert.rejects(saveRolePrompt(root,{package:lock,role:role.id,prompt:'过期编辑'}),/版本已更新/);
 const restored=await saveRolePrompt(root,{package:changed,role:role.id,prompt:text});assert.equal((await lockedPackage(root,restored)).files.get(role.prompt).toString(),text);
 assert.equal((await listPackages(root)).length,3);
 await assert.rejects(saveRolePrompt(root,{package:restored,role:role.id,prompt:' '}),/不能为空/);
 await assert.rejects(saveRolePrompt(root,{package:restored,role:'../wrong',prompt:'内容'}),/角色不存在/);
}));

test('完整对话使用稳定文件游标，合并卡片更新，旧群项目互不串记录',()=>{
 const rows=Array.from({length:130},(_,i)=>({kind:'user',projectId:'a',text:'消息'+i,at:new Date(i*1000).toISOString()}));
 rows.splice(5,0,{kind:'card',projectId:'a',messageId:'card',card:{title:'进行中'},at:new Date(5000).toISOString()});
 rows.push({kind:'card_update',projectId:'a',messageId:'card',card:{title:'已完成'},at:new Date(140000).toISOString()}, {kind:'user',projectId:'b',text:'另一个项目',at:new Date(150000).toISOString()});
 let page=messagePage(rows,{projectId:'a',limit:50}),items=[...page.items];
 const firstCursor=page.nextCursor;rows.push({kind:'user',projectId:'a',text:'新消息',at:new Date(160000).toISOString()});
 while(page.nextCursor!=null){page=messagePage(rows,{projectId:'a',cursor:page.nextCursor,limit:50});items.push(...page.items);}
 assert.equal(items.length,131);assert.equal(new Set(items.map(x=>x.index)).size,131);assert.equal(items.find(x=>x.messageId==='card').card.title,'已完成');assert.ok(!items.some(x=>x.projectId==='b'));
 assert.equal(messagePage(rows,{projectId:'a',cursor:firstCursor}).items.at(-1).index,firstCursor-1);
 assert.equal(messagePage(rows,{projectId:'a',loadedFrom:0}).updates.find(r=>r.messageId==='card').card.title,'已完成');
 assert.throws(()=>messagePage(rows,{cursor:'bad'}),/游标/);
});

test('历史任务保留同项目多次尝试、成功调用与各项目锁定版本',()=>{
 const p={id:'a',name:'项目 A',history:[{role:'chief',task:'plan',at:'2026-01-01',skills:['team:chief-method']}],attempts:[{role:'chief',task:'plan',at:'2026-01-02',status:'failed',summary:'失败',skills:[]}],definition:{workflow:{nodes:[]}}};
 const records=taskRecords([p,{...p,id:'b',name:'项目 B',attempts:[]}],'chief');
 assert.equal(records.length,3);assert.equal(records[0].status,'failed');assert.equal(records[1].status,'done');assert.equal(new Set(records.map(h=>h.id)).size,3);assert.equal(taskRecords([p],'writer').length,0);
});

test('新接口实际读全量项目历史，提示词写入拒绝跨源且可保存回读',()=>fixture(async root=>{
 const lock=await installPackage('examples/team-package',root),pack=await lockedPackage(root,lock),r=pack.manifest.roles[0],recorder=createRecorder(root),p={id:'p',chatId:'chat',createdAt:'2026-01-01T00:00:00Z'};
 for(let i=0;i<320;i++)await recorder.add('chat',{kind:'user',projectId:'p',text:String(i)});
 const flow={packages:{snapshot:async()=>[]},getProjectById:async id=>id==='p'?p:null,getState:async()=>({projects:[p]})};
 const server=await startPreview({root,assetsRoot:process.cwd(),flow,recorder,workbenchPort:0,modelPort:0}),base=`http://127.0.0.1:${server.workbenchPort}`;
 try{let total=0,cursor;do{const page=await fetch(base+'/api/messages?'+new URLSearchParams({projectId:'p',paginated:'1',...(cursor!=null?{beforeIndex:cursor}:{})})).then(r=>r.json());total+=page.items.length;cursor=page.nextCursor;}while(cursor!=null);assert.equal(total,320);
 const send=origin=>fetch(base+'/api/packages/prompt',{method:'POST',headers:{'Content-Type':'application/json','X-Workbench':'1',...(origin?{Origin:origin}:{})},body:JSON.stringify({package:lock,role:r.id,prompt:'你负责清楚地完成原任务。'})});
 assert.equal((await send('http://other.invalid')).status,403);const response=await send();assert.equal(response.status,200);const updated=await response.json();const source=await fetch(base+'/api/packages/role?'+new URLSearchParams({...updated,role:r.id})).then(r=>r.json());assert.equal(source.prompt,'你负责清楚地完成原任务。');
 assert.equal((await fetch(base+'/api/packages/prompt',{method:'POST',headers:{'Content-Type':'application/json','X-Workbench':'1'},body:JSON.stringify({via:'admin',package:updated,role:r.id,prompt:'无令牌'})})).status,403);
 assert.equal((await fetch(base+'/team-ui.mjs')).status,200);
 }finally{await server.close();}
}));

test('失败任务单独留痕，不被既有 workflow 当成成功；重试保留两次实际记录',()=>fixture(async root=>{
 const lock=await installPackage('examples/team-package',root);let fail=true;
 const engine=createPackageEngine({root,agent:async args=>{
  if(fail)return {ok:false,error:'测试失败',text:'',stats:{}};
  for(const skill of args.definition.skills)args.onProgress?.({tool:'Skill',file:skill,status:'succeeded'});
  await mkdir(path.join(args.projectDir,'drafts'),{recursive:true});await writeFile(path.join(args.projectDir,'drafts/brief.md'),'# 简报\n实际交付');
  return {ok:true,text:'完成',stats:{}};
 }});
 const created=await engine.create({package:lock,text:'失败与恢复测试'});let p=await engine.waitForIdle(created.id);
 assert.equal(p.history.length,0);assert.equal(p.attempts.length,1);assert.equal(p.attempts[0].status,'failed');assert.ok(p.error);
 const originalStage=p.stage;fail=false;await engine.action({chatId:p.chatId,value:{action:'package_retry',projectId:p.id,stage:p.stage,cardId:p.cardId}});p=await engine.waitForIdle(p.id);
 assert.equal(p.history.length,1);assert.equal(p.attempts.length,1);assert.notEqual(p.stage,originalStage);assert.equal(p.history[0].status,'done');
}));
