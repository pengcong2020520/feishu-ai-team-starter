import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {adminContext,requestUsage,trialSummary} from '../src/admin/context.mjs';
test('近期上下文保留指令和任务编号，不带工具大字段、进行中回复或当前重复消息',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'context-'));
 try{await mkdir(path.join(root,'data/admin'),{recursive:true});const es=[];
 for(let i=0;i<20;i++)es.push({type:'instruction',turnId:String(i),text:'需求'+i},{type:'reply',turnId:String(i),text:'早期进行中',pending:true},{type:'reply',turnId:String(i),text:'结果'+i},{type:'operation',ok:true,draftId:'d',runId:'r'+i,events:'TOOL_PAYLOAD'.repeat(50000)});
 await writeFile(path.join(root,'data/admin/journal.jsonl'),es.map(e=>JSON.stringify(e)).join('\n'));
 const text=adminContext(root,'管理员说：需求19');assert.match(text,/需求18/);assert.doesNotMatch(text,/需求19|需求0|TOOL_PAYLOAD|早期进行中/);assert.match(text,/r19/);assert.ok(text.length<16500);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('新请求累计用量取最后结果，不把缓存读取当作未缓存输入',()=>{
 assert.deepEqual(requestUsage({modelUsage:{m:{inputTokens:100,outputTokens:20,cacheReadInputTokens:900,cacheCreationInputTokens:40}}},{}),{inputTokens:100,outputTokens:20,cacheReadInputTokens:900,cacheCreationInputTokens:40,usageScope:'request'});
 assert.equal(requestUsage({}, {inputTokens:15,outputTokens:3}).usageScope,'main-loop');
});
test('试跑默认摘要保留完成和读取证据，不返回大量轨迹与历史正文',()=>{
 const r={id:'r',status:'passed',events:[{role:'writer',tool:'Read',file:'drafts/editorial-guide.md'}],history:[{summary:'LONG'.repeat(10000)}],calls:[{role:'writer',ok:true,skills:['team:writer']}],artifacts:[{id:'final',path:'report/result.md'}]};
 const s=trialSummary(r);assert.equal(s.taskCount,1);assert.deepEqual(s.fileReads,['writer: drafts/editorial-guide.md']);assert.equal(s.events,undefined);assert.doesNotMatch(JSON.stringify(s),/LONG/);assert.equal(s.artifacts[0].id,'final');
});
