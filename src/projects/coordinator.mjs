import { runAgent } from '../agents/run.mjs';
import path from 'node:path';
import { routingSchema,routingPrompt,validRouting,replyReference,isAcknowledgement,closesConversation } from '../packages/group-routing.mjs';
// 原网页引擎使用相同路由判断，执行仍交给原 handleMessage/提议与引导卡。
export function createLegacyCoordinator({root,flow,recorder,agent=runAgent}) {
 const queues=new Map(),muted=new Set();
 const roles=[{id:'product',name:'AI 产品经理'},{id:'designer',name:'AI 设计'},{id:'developer',name:'AI 程序员'}];
 return event=>{
  const person=event.identity?.unionId||event.identity?.userId||`${event.identity?.role}:${event.identity?.openId}`,key=`${event.chatId}:${person}`;
  if(event.senderType!=='user'||event.source!=='feishu'||!event.messageId)return Promise.resolve({ignored:true});
  if(closesConversation(event.text)){muted.add(key);return Promise.resolve({conversationClosed:true});}
  if(event.role)muted.delete(key);else if(muted.has(key)||isAcknowledgement(event.text))return Promise.resolve({ignored:true});
  const task=(queues.get(event.chatId)||Promise.resolve()).catch(()=>{}).then(async()=>{
   const p=await flow.getProject(event.chatId);if(!p)return{ignored:true};
   if (['停下','停止','重试','结束'].includes(event.text.trim())) return flow.handleMessage({...event,role:event.role||'product'});
   const rows=await recorder.list(event.chatId,{limit:300});if(rows.some(r=>r.kind==='routing'&&r.messageId===event.messageId))return{duplicate:true};
   const reference=replyReference(rows,event,roles),recent=rows.filter(r=>r.kind==='user').slice(-10).map(r=>`${r.actor}：${r.text}`).join('\n');
   let result;try{result=await agent({role:'product',projectDir:path.join(root,'workspace',p.id),runtimeRoot:root,mode:'route',isolateSession:true,outputSchema:routingSchema,timeoutMs:60000,prompt:routingPrompt({project:p,coordinator:'product',roles,preferred:event.role||reference?.role,reference,recent,event})});}catch{result={ok:false};}
   const decision=validRouting(result,roles,'product',event.role&&event.role!=='product'?event.role:null);
   await recorder.add(event.chatId,{kind:'routing',messageId:event.messageId,role:decision.role,text:decision.reason});
   if(decision.kind==='ignore'&&!event.role)return{ignored:true};
   return flow.handleMessage({...event,role:decision.role,text:event.text+(reference?`\n（回复本群消息：${reference.text}）`:'')});
  });queues.set(event.chatId,task);void task.finally(()=>{if(queues.get(event.chatId)===task)queues.delete(event.chatId);}).catch(()=>{});return Promise.resolve({ok:true,queued:true});
 };
}
