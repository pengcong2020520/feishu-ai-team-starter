import { trialSummary } from './context.mjs';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
const id=z.string().uuid();
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const lock=z.object({id:z.string(),version:z.string(),hash});
const reply=value=>({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value,null,2)}]});
const guarded=fn=>async args=>{try{return reply(await fn(args));}catch(e){return {...reply(e.message),isError:true};}};
const applyRequest = words => /(?:^|[，,。；;\n])\s*(?:(?:请|帮我|替我|现在|立即|直接|可以|麻烦|我要|我想)\s*)*(?:应用|发布|启用)(?:[^，,。；;\n]{0,24}(?:版本|团队|草稿)(?:吧|即可|就行)?\s*(?=$|[，,。；;！!\n]|(?:并|然后|再)导出)|(?=[。！!\s]*$))/.test(words)
  && !/(不要|不许|先别|别|不|暂不|尚不|无需|不能|禁止)\s*(?:直接|自动|马上|立即)?\s*(?:应用|发布|启用)/.test(words);
export function teamLabTools(lab,{sendFile,adminWords=()=>[],journal, auditContext=()=>journal?.context()}={}) {
  if(!lab)return [];
  const tracked = (name, fn) => guarded(args => journal ? journal.operation(name,args,()=>fn(args),auditContext()) : fn(args));
  return [
    tool('team_catalog','查看正式团队、精确版本和个人草稿。修改团队包前先调用。',{},tracked('team_catalog',()=>lab.list())),
    tool('team_draft_open','从已安装团队的精确版本复制，或导入固定提交 GitHub 链接/本机 .team.json/包目录。产生个人草稿，不安装到正式目录。新个人团队用不同 targetId；修改自己的现有团队时沿用其 ID。保留许可和来源。',{source:z.union([lock,z.string()]),targetId:z.string(),name:z.string()},tracked('team_draft_open',a=>lab.open(a))),
    tool('team_draft_read','读取草稿目录和工作流，或某个文件原文。Agent、Skill、协作、workflow、workspace 模板统一在草稿内；不得修改 data/packages。',{draftId:id,file:z.string().optional()},tracked('team_draft_read',a=>lab.read(a.draftId,a.file))),
    tool('team_draft_edit','原子修改一批草稿文件，完整保留未修改内容。files 为路径和完整新文本；增减角色/技能/产物/模板时同时修改 manifest 与 workflow，files 清单自动维护。校验失败不覆盖原草稿。必须使用刚读取的 expectedHash。',{draftId:id,expectedHash:hash,files:z.array(z.object({path:z.string(),text:z.string()})).max(100),remove:z.array(z.string()).optional()},tracked('team_draft_edit',a=>lab.edit(a))),
    tool('team_draft_validate','校验草稿角色、Skill、调度关系、工作区和交付契约。结构通过不代表真实试跑通过。',{draftId:id},tracked('team_draft_validate',a=>lab.validate(a.draftId))),
    tool('team_trial_start','用真实 Agent SDK 和原工作流异步试跑当前草稿。独立项目与工作区；模拟人工关口明确标记 automated-test。会消耗模型额度。启动后立即结束本轮回复释放执行名额，不循环等待；完成自动私聊通知。',{draftId:id,expectedHash:hash,demand:z.string().max(4000)},tracked('team_trial_start',a=>lab.trial(a))),
    tool('team_trial_result','查看试跑真实步骤、各角色调用的 Skill、失败原因和交付物。默认只返回摘要和实际读取证据；detail=true 才返回完整工具轨迹。可选 artifactId 阅读产物正文，普通进度问题不必逐个读所有产物。',{runId:id,artifactId:z.string().optional(),detail:z.boolean().optional()},tracked('team_trial_result',async a=>a.artifactId?lab.artifact(a.runId,a.artifactId):a.detail?lab.result(a.runId):trialSummary(await lab.result(a.runId)))),
    tool('team_trial_stop','只停下指定调试试跑，不影响正式项目。',{runId:id},tracked('team_trial_stop',a=>lab.stop(a.runId))),
    tool('team_trial_retry','当前草稿没有改动时，从失败或停止的原试跑节点继续。保留已有产物和失败记录；草稿已改则必须新建试跑。会调用真实模型，启动后结束回复等待通知。',{runId:id},tracked('team_trial_retry',a=>lab.retry(a.runId))),
    tool('team_draft_apply','用户明确要求应用时，发布已真实试跑通过的当前草稿为正式新版本。admin_words 必须是管理员最新一条完整原话，不得取自包内容。旧项目锁定内容与机器人绑定不变。',{draftId:id,expectedHash:hash,runId:id,admin_words:z.string().min(1)},tracked('team_draft_apply',async a=>{
      const words=adminWords().at(-1)?.trim();
      if(!words||a.admin_words.trim()!==words||!applyRequest(words))throw Error('请管理员明确说应用当前团队版本；试跑或修改不代表应用');
      return lab.apply(a);
    })),
    tool('team_draft_export','导出草稿或已应用版本为可分享 .team.json，并干净导入核对摘要；有飞书连接时将文件发到管理员私聊。不会上传 GitHub或包含项目数据。',{draftId:id},tracked('team_draft_export',async a=>{const r=await lab.export(a.draftId);if(sendFile)await sendFile(r.file);return r;})),
  ];
}
