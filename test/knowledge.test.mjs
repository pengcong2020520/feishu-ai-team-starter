import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, cp, symlink } from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import { projectKnowledge, adminKnowledge, wikiSearch, teamPages } from '../src/knowledge/wiki.mjs';
import { knowledgeTools } from '../src/knowledge/tools.mjs';
import { adminKnowledgeTools } from '../src/admin/knowledge-tools.mjs';
import { loadPackage, installPackage, exportPackage, lockedPackage } from '../src/packages/store.mjs';
import { roleDefinition } from '../src/packages/runtime.mjs';
import { createTeamLab } from '../src/admin/team-lab.mjs';
import { createAdminJournal } from '../src/admin/journal.mjs';
import { requestUsage } from '../src/admin/context.mjs';
const fixture=async fn=>{const root=await mkdtemp(path.join(os.tmpdir(),'wiki-'));try{await mkdir(path.join(root,'workspace/a'),{recursive:true});await mkdir(path.join(root,'workspace/b'),{recursive:true});return await fn(root);}finally{await rm(root,{recursive:true,force:true});}};
const page=(body='正文一',title='读者偏好')=>({id:'audience',title,summary:'给读者的已知约定',tags:['写作'],sources:['用户消息 m1'],status:'confirmed',links:[],body});
const data=r=>JSON.parse(r.content[0].text);
test('项目、团队和个人记忆隔离；更新可追溯、冲突不覆盖，长正文可完整分页',()=>fixture(async root=>{
 const a=await projectKnowledge(root,path.join(root,'workspace/a')),b=await projectKnowledge(root,path.join(root,'workspace/b')),owner=await adminKnowledge(root,'owner'),other=await adminKnowledge(root,'other');
 const first=await a.update('project',page(),{expectedRevision:'',actor:'admin'});
 const next=await a.update('project',page('新正文'+ '细节'.repeat(9000)),{expectedRevision:first.revision});
 assert.equal((await a.read('project','audience',{revision:first.revision})).body,'正文一');
 assert.equal((await a.history('project','audience')).revisions.length,2);
 await assert.rejects(()=>a.update('project',page('错误覆盖'),{expectedRevision:first.revision}),/已更新/);
 assert.equal((await b.search('project','读者')).total,0);assert.equal((await a.search('collaboration','读者')).total,0);
 await owner.update('collaboration',page('管理员个人口令'),{expectedRevision:''});
 assert.equal((await other.search('collaboration','')).total,0);assert.equal((await a.search('collaboration','')).total,0);
 let text='',offset=0;do{const p=await a.read('project','audience',{offset});text+=p.body;offset=p.nextOffset;}while(offset!==null);
 assert.equal(text,'新正文'+'细节'.repeat(9000));assert.equal((await a.read('project','audience')).revision,next.revision);
 await assert.rejects(()=>a.read('project','../b'),/./);await assert.rejects(()=>projectKnowledge(root,os.tmpdir()),/范围|绑定/);
}));
test('知识目录拒绝软链接；搜索返回相关短片段且可翻到后页',()=>fixture(async root=>{
 await mkdir(path.join(root,'data'));await symlink(path.join(root,'workspace/b'),path.join(root,'data/knowledge'));
 const a=await projectKnowledge(root,path.join(root,'workspace/a'));
 await assert.rejects(()=>a.update('project',page(),{expectedRevision:''}),/软链接/);
 const pages=Array.from({length:16},(_,i)=>({...page('无关正文'.repeat(3000)+'目标读者是小店经营者'),id:'p'+i}));
 const r=wikiSearch(pages,'目标读者');assert.equal(r.pages.length,8);assert.equal(r.nextOffset,8);assert.match(r.pages[0].excerpt,/小店/);assert.ok(JSON.stringify(r).length<12000);
}));
test('团队知识校验、导出导入、包锁定与所有角色检索；运行记忆不进入分享包',()=>fixture(async root=>{
 const dir=path.join(root,'source');await cp('examples/team-package',dir,{recursive:true});
 const m=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));m.knowledge={format:'wiki/1',pages:[{...page(),path:'knowledge/audience.md'}]};delete m.knowledge.pages[0].body;m.files.push('knowledge/audience.md');
 await mkdir(path.join(dir,'knowledge'));await writeFile(path.join(dir,'knowledge/audience.md'),'本团队服务小店经营者。');await writeFile(path.join(dir,'manifest.json'),JSON.stringify(m));
 const lock=await installPackage(dir,root),pack=await lockedPackage(root,lock);
 for(const role of pack.manifest.roles){const def=await roleDefinition(pack,role.id,root);const ts=await knowledgeTools({root,projectDir:path.join(root,'workspace/a'),pages:def.knowledgePages,role:role.id});assert.equal(ts.length,1);assert.match(data(await ts[0].handler({scope:'team',action:'read',id:'audience'})).body,/小店/);assert.equal(data(await ts[0].handler({scope:'team',action:'read',id:'audience',revision:'fake'})).error.includes('锁定'),true);}
 await mkdir(path.join(dir,'data'));await writeFile(path.join(dir,'data/private.md'),'不能分享的私聊');
 const bundle=path.join(root,'share.team.json');await exportPackage(dir,bundle);assert.doesNotMatch(await readFile(bundle,'utf8'),/private/);
 assert.equal((await installPackage(bundle,path.join(root,'clean'))).hash,lock.hash);
 await writeFile(path.join(dir,'knowledge/audience.md'),'只为大型企业服务');assert.match(teamPages(await lockedPackage(root,lock))[0].body,/小店/);
 m.knowledge.pages[0].links=['missing'];await writeFile(path.join(dir,'manifest.json'),JSON.stringify(m));await assert.rejects(()=>loadPackage(dir),/未知页面/);
}));
test('管理员真实入口凭据留档；草稿知识原子编辑与历史查询不改正式包',()=>fixture(async root=>{
 const lock=await installPackage('examples/team-package',root),lab=createTeamLab({root}),journal=createAdminJournal({root,secrets:[]});
 const draft=await lab.open({source:lock,targetId:'wiki-team',name:'Wiki团队'});
 const tools=Object.fromEntries(adminKnowledgeTools({root,teamLab:lab,journal,findProject:async()=>({id:'a',package:lock})}).map(t=>[t.name,t]));
 // Internal fixture is explicitly internal, never impersonates real Feishu ingress.
 await journal.receive({source:'internal',text:'保存团队知识'},async()=>{
  const r=data(await tools.wiki_update.handler({scope:'team',draftId:draft.id,page:page('团队读者是店主'),expectedRevision:draft.hash}));assert.ok(r.revision);
  const read=data(await tools.wiki_lookup.handler({scope:'team',draftId:draft.id,action:'read',id:'audience'}));assert.match(read.body,/店主/);
 });
 assert.equal((await lockedPackage(root,lock)).manifest.knowledge,undefined);
 const op=journal.events().find(e=>e.name==='wiki_update'&&e.type==='operation');assert.ok((await journal.diff(op.id)).files.some(f=>f.file==='knowledge/audience.md'));
 for(let i=0;i<20;i++)await journal.receive({source:'internal',text:'讨论 '+i},async()=>{});
 const h=data(await tools.conversation_history.handler({query:'保存团队知识',offset:0}));assert.equal(h.total,1);assert.equal(h.events[0].source,'internal');
 assert.match(data(await tools.conversation_history.handler({eventId:h.events[0].id,offset:0})).text,/保存团队知识/);
 assert.equal((await lab.read(draft.id)).hash,op.afterHash);
}));
test('Agent 只能写本项目待确认协作笔记，不能自封批准或写团队知识',()=>fixture(async root=>{
 const ts=await knowledgeTools({root,projectDir:path.join(root,'workspace/a'),role:'writer',readOnly:false});
 const r=data(await ts[1].handler({page:page('我认为已批准'),expectedRevision:''}));assert.equal(r.status,'proposed');
 const lookup=data(await ts[0].handler({scope:'collaboration',action:'read',id:'audience'}));assert.equal(lookup.actor,'writer');assert.equal(lookup.status,'proposed');
}));
test('续会话用量只取本轮增量；旧会话无基线/计数重置时明确退到主循环口径',()=>{
 const old={m:{inputTokens:1000,outputTokens:500,cacheReadInputTokens:20000,cacheCreationInputTokens:20}};
 const now={modelUsage:{m:{inputTokens:1200,outputTokens:520,cacheReadInputTokens:21000,cacheCreationInputTokens:20}}};
 assert.deepEqual(requestUsage(now,{},old,true),{inputTokens:200,outputTokens:20,cacheReadInputTokens:1000,cacheCreationInputTokens:0,usageScope:'request'});
 assert.equal(requestUsage(now,{inputTokens:12},undefined,true).usageScope,'main-loop');
 assert.equal(requestUsage({modelUsage:{m:{inputTokens:2}}},{inputTokens:2},old,true).inputTokens,2);
});

test('团队 Wiki 可读取历史包版本；新建页面查询提供可写入的草稿版本',()=>fixture(async root=>{
 const lock=await installPackage('examples/team-package',root),lab=createTeamLab({root});const d=await lab.open({source:lock,targetId:'versioned-wiki',name:'版本测试'});
 const ts=Object.fromEntries(adminKnowledgeTools({root,teamLab:lab}).map(t=>[t.name,t]));
 const empty=data(await ts.wiki_lookup.handler({scope:'team',draftId:d.id,action:'read',id:'audience'}));assert.equal(empty.found,false);assert.equal(empty.revision,d.hash);
 const a=data(await ts.wiki_update.handler({scope:'team',draftId:d.id,page:page('700字'),expectedRevision:empty.revision}));
 const b=data(await ts.wiki_update.handler({scope:'team',draftId:d.id,page:page('900字'),expectedRevision:a.revision}));
 assert.equal(data(await ts.wiki_lookup.handler({scope:'team',draftId:d.id,action:'read',id:'audience',revision:a.revision})).body,'700字');
 assert.equal(data(await ts.wiki_lookup.handler({scope:'team',draftId:d.id,action:'read',id:'audience'})).body,'900字');
 const h=data(await ts.wiki_lookup.handler({scope:'team',draftId:d.id,action:'history'}));assert.equal(h.revision,b.revision);assert.equal(h.revisions.length,3);
}));
test('压缩前归档完整可见原文，不复制推理或工具载荷，不冒称飞书入站',()=>fixture(async root=>{
 const {archiveSessionText,archivedConversation}=await import('../src/admin/history.mjs');const sid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',cfg=path.join(root,'.claude-agent-config'),dir=path.join(cfg,'projects/project');await mkdir(dir,{recursive:true});
 const es=[{type:'user',uuid:'u',message:{content:'很早说过的业务约定'}},{type:'assistant',uuid:'a',message:{content:[{type:'thinking',thinking:'HIDDEN_THOUGHT'},{type:'text',text:'可见答复'}]}},{type:'user',uuid:'t',message:{content:[{type:'tool_result',content:'HUGE_TOOL_PAYLOAD'}]}}].map(e=>({...e,sessionId:sid,cwd:root,timestamp:'2026-11-28T01:00:00Z'}));
 await writeFile(path.join(dir,sid+'.jsonl'),es.map(JSON.stringify).join('\n'));
 await archiveSessionText({root,configDir:cfg,sessionId:sid});await archiveSessionText({root,configDir:cfg,sessionId:sid});
 const saved=await archivedConversation(root);assert.equal(saved.length,2);assert.equal(saved[0].source,'sdk-history');assert.doesNotMatch(JSON.stringify(saved),/HIDDEN_THOUGHT|HUGE_TOOL_PAYLOAD/);
 const t=adminKnowledgeTools({root}).find(t=>t.name==='conversation_history');assert.equal(data(await t.handler({query:'业务约定',offset:0})).total,1);
}));
