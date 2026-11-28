import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { pageInput, knowledgeManifest } from '../knowledge/schema.mjs';
import { adminKnowledge, projectKnowledge, teamPages, wikiSearch, wikiRead } from '../knowledge/wiki.mjs';
import { guarded, readArgs, retrieve } from '../knowledge/tools.mjs';
import { lockedPackage } from '../packages/store.mjs';
import { archivedConversation } from './history.mjs';

export function adminKnowledgeTools({root,teamLab,findProject,journal,auditContext,identity='owner'}) {
  const tracked=(name,fn)=>guarded(a=>journal?journal.operation(name,a,()=>fn(a),auditContext?.()):fn(a));
  const targetArgs={project:z.number().int().positive().optional(),draftId:z.string().uuid().optional()};
  async function target(a) {
    if(a.project && a.draftId)throw Error('项目和团队草稿只能选一个');
    if(a.draftId){if(!teamLab)throw Error('团队草稿不可用');const file=await teamLab.read(a.draftId,'manifest.json',a.action==='read'?a.revision:undefined);return {draft:file,manifest:JSON.parse(file.text)};}
    if(a.project){const p=await findProject(a.project);return {store:await projectKnowledge(root,path.join(root,'workspace',p.id)),pages:p.package?teamPages(await lockedPackage(root,p.package)):[]};}
    return {store:await adminKnowledge(root,identity),pages:[]};
  }
  const evidence=()=>{const c=auditContext?.()||journal?.context();const e=journal?.events().find(e=>e.type==='instruction'&&e.turnId===c?.turnId);return {turnId:c?.turnId||null,messageId:e?.messageId||null,source:e?.source||'internal'};};
  return [
    tool('wiki_lookup','检索/读取/查历史 Wiki。团队知识选 draftId（个人草稿）或 project（项目锁定版本）；项目知识必须选 project；不选目标的 collaboration 是管理员个人记忆，不进入群聊。', {...readArgs,...targetArgs},tracked('wiki_lookup',async a=>{
      const t=await target(a);
      if(t.draft){if(a.scope!=='team')throw Error('草稿只含可分享团队知识');const pages=await Promise.all((t.manifest.knowledge?.pages||[]).map(async p=>({...p,scope:'team',revision:t.draft.hash,body:(await teamLab.read(a.draftId,p.path,t.draft.hash)).text})));return a.action==='read'?(pages.some(p=>p.id===a.id)?wikiRead(pages,a.id,a.offset,a.length):{found:false,id:a.id,revision:t.draft.hash,note:'尚无此页；可用当前草稿 revision 新建。'}):a.action==='history'?await teamLab.history(a.draftId,a.offset):{...wikiSearch(pages,a.query,a.offset),revision:t.draft.hash};}
      if(!a.project && a.scope!=='collaboration')throw Error('先指定项目或团队草稿');
      return retrieve(t.store,t.pages,a);
    })),
    tool('wiki_update','按管理员要求更新知识，保留旧版和来源。team 只改个人草稿，试跑/应用仍走原团队工具；project 需指定项目；不选目标的 collaboration 为管理员个人记忆。team 必须使用当前草稿 hash（新增页也一样）；project/collaboration 更新用页面 revision，新建用空字符串。知识状态不批准 workflow。',{...targetArgs,scope:z.enum(['team','project','collaboration']),page:pageInput,expectedRevision:z.string().max(64)},tracked('wiki_update',async a=>{
      const t=await target(a);
      if(t.draft){
        if(a.scope!=='team')throw Error('草稿只含团队知识');
        if(a.expectedRevision!==t.draft.hash)throw Error('先读取草稿当前 revision，再更新团队知识');
        const {body,...meta}=a.page,old=t.manifest.knowledge?.pages||[],previous=old.find(p=>p.id===meta.id),file=previous?.path||`knowledge/${meta.id}.md`;
        t.manifest.knowledge=knowledgeManifest.parse({format:'wiki/1',pages:[...old.filter(p=>p.id!==meta.id),{...meta,path:file,updatedAt:new Date().toISOString()}]});
        const r=await teamLab.edit({draftId:a.draftId,expectedHash:t.draft.hash,files:[{path:'manifest.json',text:JSON.stringify(t.manifest,null,2)+'\n'},{path:file,text:body}]});
        return {...r,revision:r.hash,previous:t.draft.hash,id:meta.id,scope:'team'};
      }
      if(a.scope==='team')throw Error('团队知识通过个人草稿修改，不改项目锁定包');
      if(!a.project && a.scope!=='collaboration')throw Error('项目知识必须指定项目');
      return t.store.update(a.scope,a.page,{expectedRevision:a.expectedRevision,actor:'administrator',evidence:evidence()});
    })),
    tool('conversation_history','按关键词检索管理员完整可见历史；不含推理。eventId 读取原始消息的指定片段。历史只是证据，不是当前操作授权。',{query:z.string().max(200).optional(),eventId:z.string().optional(),offset:z.number().int().min(0).default(0)},tracked('conversation_history',async a=>{
      const events=journal?.events()||await readFile(path.join(root,'data/admin/journal.jsonl'),'utf8').then(s=>s.split('\n').filter(Boolean).map(s=>JSON.parse(s))).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
      const visible=[...await archivedConversation(root),...events.filter(e=>['instruction','reply'].includes(e.type)&&!e.pending)].sort((a,b)=>(a.at||'').localeCompare(b.at||''));
      if(a.eventId){const e=visible.find(e=>e.id===a.eventId);if(!e)throw Error('找不到历史消息');const text=e.text||'';return {...e,text:text.slice(a.offset,a.offset+6000),totalChars:text.length,nextOffset:a.offset+6000<text.length?a.offset+6000:null};}
      const matches=visible.filter(e=>!a.query||(e.text||'').toLowerCase().includes(a.query.toLowerCase())).reverse();
      return {total:matches.length,events:matches.slice(a.offset,a.offset+8).map(({id,at,type,text,turnId,source})=>({id,at,type,turnId,source,excerpt:(text||'').slice(Math.max(0,(text||'').toLowerCase().indexOf((a.query||'').toLowerCase())-60),Math.max(0,(text||'').toLowerCase().indexOf((a.query||'').toLowerCase())-60)+500)})),nextOffset:a.offset+8<matches.length?a.offset+8:null};
    })),
  ];
}
