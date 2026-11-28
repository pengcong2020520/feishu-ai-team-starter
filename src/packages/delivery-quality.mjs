import path from 'node:path';
import { createHash } from 'node:crypto';
import { readArtifact, roleDefinition } from './runtime.mjs';

export function contentIssues(text) {
  const issues=[];
  // 示例代码中的 # 注释不参与文章层级判断。
  const prose=text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
  if ((prose.match(/^#\s+\S/gm)||[]).length>1) issues.push('出现多个主标题，需要整理成一份连贯成品');
  const paragraphs=text.split(/\n\s*\n/).map(t=>t.replace(/\s/g,'')).filter(t=>t.length>=80);
  if(new Set(paragraphs).size!==paragraphs.length)issues.push('正文包含重复段落');
  if(/^\s*(?:TODO|TBD|待补充正文|此处插入正文|\[待填写\])/mi.test(text))issues.push('正文保留未完成占位内容');
  return issues;
}
export async function inspectDelivery({root,p,pack,task,agent,control,onQueued}) {
  const files=[];
  for(const id of task.outputs||[])files.push(await readArtifact(pack,path.join(root,'workspace',p.id),id));
  const stamp=createHash('sha256').update(JSON.stringify(files.map(a=>[a.id,a.text]))).digest('hex');
  const blockers=files.filter(a=>a.format==='markdown').flatMap(a=>contentIssues(a.text).map(s=>`${a.path}：${s}`));
  if(blockers.length)return {passed:false,summary:'成品结构需要修正',blockers,stamp};
  const definition=await roleDefinition(pack,pack.workflow.coordinator,root);
  definition.read=[...new Set(['context/',...pack.manifest.workspace.directories])];definition.write=[];definition.tools=['Read','Glob'];
  const reads=new Set();
  const result=await agent({role:pack.workflow.coordinator,projectDir:path.join(root,'workspace',p.id),runtimeRoot:root,definition,mode:'review',isolateSession:true,timeoutMs:180000,control,onQueued,
    onProgress:e=>{if(e.tool==='Read'&&e.status==='succeeded')reads.add(path.resolve(root,'workspace',p.id,e.file||''));},
    prompt:`这是成品质量检查，不是流程批准。原始目标：${p.demand}。正式修改记录：${JSON.stringify(p.approvals||[])}；已确认补充：${JSON.stringify(p.confirmedInputs||[])}。必须实际读取 ${files.map(a=>a.path).join('、')}，并核对项目讨论和相关上游材料。按专业Skill原有文档契约判断：读者能否直接使用这份交付，是否只是过程汇总、待办、待填写模板，是否重复正文，逻辑和事实依据是否足够，有没有把已具备材料的工作推给用户重做。文章必须是可阅读的正文；研究保留真实风险和证据缺口，不能为“成熟”编造数据。用户最终确认、对外发布授权不属于内容缺陷。仅列影响使用的实质问题，不要求无关润色。不要因为有文件或作者说完成就通过。每个文件用artifacts列出id和具体检查依据。文件清单：${JSON.stringify(files.map(a=>({id:a.id,path:a.path})))}`,
    outputSchema:{type:'object',additionalProperties:false,required:['passed','summary','blockers','artifacts'],properties:{passed:{type:'boolean'},summary:{type:'string'},blockers:{type:'array',items:{type:'string'}},artifacts:{type:'array',items:{type:'object',additionalProperties:false,required:['id','reason'],properties:{id:{type:'string'},reason:{type:'string'}}}}}}});
  const v=result.structured;
  if(!result.ok||typeof v?.passed!=='boolean'||!v.summary?.trim()||!Array.isArray(v.blockers)||v.blockers.some(b=>typeof b!=='string')||!files.every(a=>v.artifacts?.some(e=>e.id===a.id&&typeof e.reason==='string'&&e.reason.trim())))throw Error('成品检查未返回完整依据');
  if(!files.every(a=>reads.has(path.resolve(root,'workspace',p.id,a.path))))throw Error('成品检查未实际读取全部文件');
  const latest=[];for(const a of files)latest.push([a.id,(await readArtifact(pack,path.join(root,'workspace',p.id),a.id)).text]);
  if(createHash('sha256').update(JSON.stringify(latest)).digest('hex')!==stamp)throw Error('成品检查期间文件发生变化，请重试');
  return {...v,passed:v.passed&&!v.blockers.length,stamp};
}
