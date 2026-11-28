// Opt-in live SDK check. Isolated root; never impersonates Feishu ingress or applies a draft.
import path from 'node:path';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { listPackages, latestPackages, lockedPackage, installPackage, loadPackage } from '../src/packages/store.mjs';
import { createTeamLab } from '../src/admin/team-lab.mjs';
import { adminKnowledgeTools } from '../src/admin/knowledge-tools.mjs';
import { createAdminJournal } from '../src/admin/journal.mjs';
import { createSteward } from '../src/admin/steward.mjs';
import { roleDefinition, initializeWorkspace } from '../src/packages/runtime.mjs';
import { runAgent } from '../src/agents/run.mjs';
import { projectKnowledge, adminKnowledge } from '../src/knowledge/wiki.mjs';
if(!process.argv.includes('--live'))throw Error('会调用真实模型并消耗额度；使用 --live 显式运行。');
const repo=path.resolve(fileURLToPath(new URL('..',import.meta.url)));process.loadEnvFile(path.join(repo,'.env'));
const root=path.join(repo,'data/admin/knowledge-tests',String(Date.now()));await mkdir(path.join(root,'src/admin'),{recursive:true});await cp(path.join(repo,'src/admin/prompt.md'),path.join(root,'src/admin/prompt.md'));
const source=latestPackages((await listPackages(repo)).filter(p=>p.id==='newtype-editorial'))[0];if(!source)throw Error('先安装文枢团队');
const original=await lockedPackage(repo,source),lock=await installPackage(original.dir,root),lab=createTeamLab({root});
const draft=await lab.open({source:lock,targetId:'wiki-live-editorial',name:'Wiki 实测 · 文枢'});
const m=JSON.parse((await lab.read(draft.id,'manifest.json')).text);
m.knowledge={format:'wiki/1',pages:[{id:'audience',title:'读者与写作约定',summary:'测试刊物的目标读者、字数与标题规范',tags:['读者','写作'],sources:['本次本地 Wiki 验证指令'],status:'confirmed',links:[],path:'knowledge/audience.md'}]};
await lab.edit({draftId:draft.id,expectedHash:draft.hash,files:[{path:'manifest.json',text:JSON.stringify(m,null,2)},{path:'knowledge/audience.md',text:'# 读者与写作约定\n刊物代号：青禾观察。目标读者是小店经营者，文章不超过700字。标题不用夸张问句。'}]});
const revision=await lab.read(draft.id),pack=await loadPackage(path.join(root,'data/admin/team-lab/drafts',draft.id,'revisions',revision.hash));
const a=path.join(root,'workspace/a'),b=path.join(root,'workspace/b');await initializeWorkspace(pack,a);await initializeWorkspace(pack,b);
for(const p of [a,b]){await writeFile(path.join(p,'context/discussion.md'),'仅用于知识层测试，没有正式需求或流程动作。');await writeFile(path.join(p,'context/project.json'),'{}');}
const wiki=await projectKnowledge(root,a);await wiki.update('project',{id:'delivery',title:'交付时间',summary:'本项目交付时间',sources:['本地验证指令'],status:'confirmed',body:'项目 A 交付时间是周四 16:30，内部代号为苍鹭。'},{expectedRevision:'',actor:'local-test'});
const journal=createAdminJournal({root,secrets:[]}),tools=adminKnowledgeTools({root,teamLab:lab,journal,identity:'probe',findProject:async n=>({id:n===1?'a':'b',package:lock})});
const evidence={kind:'real-sdk-not-feishu-private',root,source:{id:source.id,version:source.version,hash:source.hash},draftId:draft.id,turns:[],roles:[]};
const save=()=>writeFile(path.join(root,'evidence.json'),JSON.stringify(evidence,null,2));
const prompts=[
 '记住我的长期偏好：对外文章称为“青禾观察”，写给小店经营者，不超过700字。请保存到我的个人协作记忆，来源为本次明确要求，然后用一句话回复。另一个只用于本轮上下文的暗号是白鹭，不必写入知识页。',
 '把刚才的字数限制改为900字，保留旧版；读者和刊物名称不变。请实际更新后只说最新约定。',
 '我刚才说的不写入知识页的暗号是什么？请再检索个人记忆，告诉我刊物名、读者及最新字数，并查历史版本指出修改前是多少。请简短回答。'
];
for(const prompt of prompts){const steward=createSteward({root,tools});let result;const events=[];await journal.receive({source:'internal',text:prompt},async()=>{result=await steward.run({prompt,timeoutMs:120000,onProgress:e=>events.push(e.tool)});journal.record('reply',{text:result.text,pending:false});});evidence.turns.push({prompt,...result,tools:events});await save();console.log(JSON.stringify({turn:evidence.turns.length,ok:result.ok,stats:result.stats,text:result.text}));if(!result.ok)throw Error('管理员真实 SDK 验证失败');}
let compacted;await journal.receive({source:'internal',text:'原生整理后的连续记忆测试'},async()=>{
 compacted=await createSteward({root,tools}).run({compactBefore:true,readOnly:true,timeoutMs:180000,prompt:'记忆检查：先前不写入知识页的暗号是什么？查个人 Wiki 说明刊物名、读者、当前及之前字数。简短回答。'});
 journal.record('reply',{text:compacted.text,pending:false});
});evidence.compacted=compacted;await save();
const chief=pack.workflow.coordinator,writer=pack.manifest.roles.find(r=>r.id==='writer')?.id||pack.manifest.roles[1].id;
for(const [role,dir,prompt] of [[chief,a,'用 knowledge 工具查询团队读者约定与本项目交付时间，只回答刊物名、读者、字数、截止时间、项目代号。不要读全部目录，不要提议动作。'],[writer,b,'用 knowledge 工具查询团队读者约定与本项目交付时间，只报告查到的事实；没有项目截止时间就明确未知，不要猜。不要读全部目录，不要提议动作。']]){const events=[];const r=await runAgent({runtimeRoot:root,role,projectDir:dir,definition:await roleDefinition(pack,role,root),mode:'chat',isolateSession:true,prompt,timeoutMs:120000,onProgress:e=>events.push(e.tool)});evidence.roles.push({role,project:path.basename(dir),...r,tools:events});await save();console.log(JSON.stringify({role,project:path.basename(dir),ok:r.ok,stats:r.stats,text:r.structured?.reply||r.text}));}
const memory=await adminKnowledge(root,'probe');evidence.memory=await memory.search('collaboration','青禾');
evidence.checks={compaction:compacted.ok&&compacted.stats.memoryMaintenance?.ran===true&&/白鹭/.test(compacted.text)&&/900/.test(compacted.text)&&/700/.test(compacted.text),continuity:/白鹭/.test(evidence.turns[2].text),updated:/900/.test(evidence.turns[2].text)&&/700/.test(evidence.turns[2].text),teamRetrieval:evidence.roles.every(r=>/小店/.test(r.structured?.reply||r.text)),projectA:/16[:：]30/.test(evidence.roles[0].structured?.reply||evidence.roles[0].text),projectIsolation:!/16[:：]30|苍鹭/.test(evidence.roles[1].structured?.reply||evidence.roles[1].text),allCallsSucceeded:[...evidence.turns,...evidence.roles].every(r=>r.ok)};await save();console.log(JSON.stringify({evidence:path.join(root,'evidence.json'),checks:evidence.checks}));if(Object.values(evidence.checks).some(x=>!x))process.exitCode=1;
