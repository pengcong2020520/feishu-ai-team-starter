import path from 'node:path';
import { createArchives } from '../packages/archive.mjs';
import { loadPackage } from '../packages/store.mjs';
import { readArtifact } from '../packages/runtime.mjs';
import { runAgent } from '../agents/run.mjs';

// 老网页项目只增加档案投影，不迁移状态，不接管原 workflow。
export function legacyArchiveService({root,assetsRoot,flow,recorder,agent=runAgent,previewBase}) {
  let bundle;
  const pack=()=>bundle ||= loadPackage(path.join(assetsRoot,'team-packages/web-studio'));
  const archive=createArchives({root,agent,recorder});
  async function project(id, list) {
    list ||= (await flow.getState()).projects.filter(p=>!p.package);
    const p=list.find(p=>p.id===id);
    if(!p)throw Error('项目不存在');
    const definition=await pack();
    const next=list.filter(q=>q.chatId===p.chatId&&q.createdAt>p.createdAt).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];
    return {...p,roles:definition.manifest.roles,history:p.history||[],archiveTeam:'web-studio',archiveLegacy:true,discussionWindow:{after:p.createdAt,before:next?.createdAt},stageType:p.stage==='done'?'done':['confirm_prd','confirm_design','accept'].includes(p.stage)?'gate':'task',siteUrl:`${previewBase}/p/${encodeURIComponent(p.id)}/site`};
  }
  return {
    async list(){const list=(await flow.getState()).projects.filter(p=>!p.package);return Promise.all(list.map(async item=>{const p=await project(item.id,list),bundle=await pack();let artifacts=[];try{const a=await readArtifact(bundle,path.join(root,'workspace',p.id),'site');artifacts=[{id:'site',name:'网页成品',title:p.name,format:'html',updatedAt:a.updatedAt,role:'developer'}];}catch(e){if(e.code!=='ENOENT')throw e;}return {...p,artifacts,finalArtifacts:['site'],archive:await archive.view(p,bundle)};}));},
    async get(id){const p=await project(id);return archive.view(p,await pack(),{full:true});},
    async refresh(id){const p=await project(id);return archive.refresh(p,await pack());},
  };
}
export async function legacyArchiveHttp({req,res,url,service,send}) {
  if(url.pathname!=='/api/project-archives')return false;
  const reply=(code,data)=>send(res,code,JSON.stringify(data),false,'application/json; charset=utf-8');
  try{
    if(req.method==='GET'){reply(200,url.searchParams.has('projectId')?await service.get(url.searchParams.get('projectId')):await service.list());return true;}
    if(req.method!=='POST'){reply(405,{error:'方法不支持'});return true;}
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){reply(403,{error:'Origin 不允许'});return true;}
    if(req.headers['x-workbench']!=='1'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){reply(415,{error:'请求格式不正确'});return true;}
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384){reply(413,{error:'请求过大'});return true;}}
    const {projectId}=JSON.parse(body);reply(200,await service.refresh(projectId));
  }catch(e){reply(400,{error:e.message});}return true;
}
