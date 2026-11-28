import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { pageId, pageInput } from './schema.mjs';
import { projectKnowledge, wikiRead, wikiSearch } from './wiki.mjs';
export const reply = value => ({content:[{type:'text',text:JSON.stringify(value)}]});
export const guarded = fn => async args => {try{return reply(await fn(args));}catch(e){return {...reply({error:e.message}),isError:true};}};
export const readArgs = { scope:z.enum(['team','project','collaboration']), action:z.enum(['search','read','history']).default('search'), query:z.string().max(200).optional(), id:pageId.optional(), revision:z.string().max(64).optional(), offset:z.number().int().min(0).optional(), length:z.number().int().min(1).max(8000).optional() };
export async function retrieve(store, pages, a) {
  if(a.scope==='team') {
    if(a.action==='history')return {note:'团队知识随包版本锁定；旧项目保留旧版。',revision:pages[0]?.revision||null};
    if(a.revision && !pages.some(p=>p.id===a.id&&p.revision===a.revision))throw Error('只能读取当前项目锁定的团队知识版本');
    return a.action==='read'?wikiRead(pages,a.id,a.offset,a.length):wikiSearch(pages,a.query,a.offset);
  }
  if(a.action==='history')return store.history(a.scope,a.id,a.offset);
  return a.action==='read'?store.read(a.scope,a.id,a):store.search(a.scope,a.query,a.offset);
}
export async function knowledgeTools({root,projectDir,pages=[],role,readOnly=true}) {
  const store=await projectKnowledge(root,projectDir);
  return [tool('lookup','按主题检索 Wiki；先 search，再 read 指定页/段；history 查旧版。只访问当前锁定团队和本项目。',readArgs,guarded(a=>retrieve(store,pages,a))),
    ...(!readOnly?[tool('remember','保存本项目协作笔记，始终标 proposed，不代表批准；保留所有旧版。更新前 lookup 读 revision，新建 expectedRevision 为空。',{page:pageInput,expectedRevision:z.string().max(64)},guarded(a=>store.update('collaboration',{...a.page,status:'proposed'},{expectedRevision:a.expectedRevision,actor:role,evidence:{kind:'agent-note'}})))]:[])];
}
export async function knowledgeServer(args) {return createSdkMcpServer({name:'knowledge',version:'1.0.0',tools:await knowledgeTools(args)});}
