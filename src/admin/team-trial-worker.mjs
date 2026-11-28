import path from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPackageEngine } from '../packages/engine.mjs';
import { atomicJson, lockedPackage } from '../packages/store.mjs';
import { runAgent } from '../agents/run.mjs';
import { createRecorder } from '../workbench/recorder.mjs';
import { readArtifact } from '../packages/runtime.mjs';
import { finalArtifactIds } from '../packages/archive.mjs';

export async function runTeamTrial(root,id,{agent=runAgent,timeoutMs=60*60000}={}) {
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('试跑编号无效');
  const dir=path.join(root,'data/admin/team-lab/runs',id),file=path.join(dir,'run.json');
  const r=JSON.parse(await readFile(file,'utf8')),controls=new Set();
  const mode=agent===runAgent?'real-sdk':'test-double';
  if(r.finishedAt&&!r.resumeRequested)throw Error('该试跑已结束，请通过继续试跑入口操作');
  if(r.projectId&&r.mode!==mode)throw Error('测试替身的历史不能续成真实试跑');
  let writes=Promise.resolve(),stopped=false,ticking=false,engine,p,pack;
  const scrub=s=>String(s||'').replaceAll(process.env.MODEL_API_KEY||'\0','[已隐藏]').slice(0,2000);
  const save=()=>{r.updatedAt=new Date().toISOString();const snapshot=structuredClone(r);writes=writes.then(()=>atomicJson(file,snapshot));return writes;};
  const resume=r.resumeRequested;delete r.resumeRequested;
  const start=Date.now();r.status='running';r.pid=process.pid;r.mode=mode;await save();
  const tick=async()=>{if(ticking)return;ticking=true;try{
    if(Date.now()-start>timeoutMs) {stopped=true;r.error='试跑达到时间上限';}
    if(await access(path.join(dir,'stop')).then(()=>true,()=>false))stopped=true;
    if(stopped)for(const c of controls)await c.stop?.();
    if(p){const live=await engine.get(p.id);r.stage=live.stage;r.history=live.history;r.approvals=live.approvals||[];r.deliveryReviews=live.deliveryReviews||[];}
    await save();
  }finally{ticking=false;}};
  const heartbeat=setInterval(()=>void tick().catch(()=>{}),1000);
  try{
    pack=await lockedPackage(dir,r.package);
    if(await access(path.join(dir,'stop')).then(()=>true,()=>false)){stopped=true;throw Error('试跑已停下');}
    engine=createPackageEngine({root:dir,recorder:createRecorder(dir),agent:async args=>{
      if(stopped)return {ok:false,stopped:true,error:'试跑已停下',stats:{}};
      const c=args.control||{};controls.add(c);const call={role:args.role,mode:args.mode,startedAt:new Date().toISOString(),skills:[]};(r.calls||=[]).push(call);
      try{const result=await agent({...args,runtimeRoot:root,control:c,onProgress:e=>{
        args.onProgress?.(e);const row={at:new Date().toISOString(),role:args.role,mode:args.mode,tool:e.tool,file:e.file,status:e.status};r.events.push(row);if(r.events.length>5000)r.events.shift();
        if(e.tool==='Skill'&&e.status==='succeeded')call.skills.push(e.file);
      }});call.ok=result.ok;call.error=result.ok?undefined:scrub(result.error);call.stats=result.stats;return result;
      }finally{call.finishedAt=new Date().toISOString();controls.delete(c);await save();}
    }});
    // Testing follows the exact package graph. Gate decisions remain labelled simulated.
    if(resume){p=await engine.get(r.projectId);if(!p||p.ended)throw Error('原调试项目不可继续');if(p.error)await engine.action({chatId:p.chatId,value:{action:'retry',projectId:p.id,stage:p.stage,cardId:p.cardId},source:'automated-test',actor:'团队调试（继续失败步骤）'});}
    else p=await engine.create({package:r.package,text:r.demand,source:'automated-test',options:{channel:'local',reviewMode:'workflow',name:'团队调试'}});
    r.projectId=p.id;await save();
    for(let turns=0;turns<pack.workflow.maxSteps+10;turns++){
      p=await engine.waitForIdle(p.id);r.stage=p.stage;r.history=p.history;r.approvals=p.approvals||[];r.deliveryReviews=p.deliveryReviews||[];await save();
      if(stopped){r.status='stopped';break;}
      if(p.error)throw Error(p.error);
      const node=pack.workflow.nodes.find(n=>n.id===p.stage);
      if(node.type==='done'){if(p.ended)throw Error('试跑提前结束');r.status='passed';break;}
      if(node.type!=='gate')throw Error('试跑停在非确认节点，请查看任务记录');
      const formValue={};if(node.questions){const q=JSON.parse(await readFile(path.join(dir,'workspace',p.id,'docs/questions.json'),'utf8'));for(const item of q.questions)formValue[item.id]=String(Number.isInteger(item.recommended)?item.recommended:0);formValue.extra='调试自动选择推荐项，不表示真人审核。';}
      await engine.action({chatId:p.chatId,value:{action:node.questions?'answer':'confirm',projectId:p.id,stage:p.stage,cardId:p.cardId},formValue,source:'automated-test',actor:'团队调试（模拟关口）',feedback:'调试继续：使用样例目标及已生成资料，不表示真人审核，不执行对外发布。'});
    }
    if(r.status==='running')throw Error('试跑超过工作流步数');
  }catch(e){r.status=stopped?'stopped':'failed';r.error=scrub(e.message);}
  finally{
    clearInterval(heartbeat);engine?.stopDocumentPolling();
    // A failed run is useful debugging evidence too: retain every readable artifact.
    if(pack&&p){
      r.artifacts=[];
      for(const a of pack.manifest.artifacts){try{const actual=await readArtifact(pack,path.join(dir,'workspace',p.id),a.id);r.artifacts.push({id:a.id,name:a.name,path:a.path,format:a.format,bytes:Buffer.byteLength(actual.text),final:finalArtifactIds(pack).includes(a.id)});}catch(e){if(e.code!=='ENOENT')(r.artifactErrors||=[]).push({id:a.id,error:scrub(e.message)});}}
      const expected=new Set([...finalArtifactIds(pack),...(pack.manifest.examples.find(e=>e.demand===r.demand)?.expectedArtifacts||[])]);
      if(r.status==='passed'&&([...(r.artifactErrors||[])].length||[...expected].some(id=>!r.artifacts.some(a=>a.id===id)))){r.status='failed';r.error='试跑交付物缺失或无法读取';}
      if(r.status==='passed'&&!r.calls?.some(c=>c.ok&&['work','plan'].includes(c.mode))){r.status='failed';r.error='试跑没有实际执行角色任务';}
    }
    r.finishedAt=new Date().toISOString();await save();
  }
  return r;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.resolve(process.argv[2]);try{process.loadEnvFile(path.join(root,'.env'));}catch{}
  await runTeamTrial(root,process.argv[3]);
}
