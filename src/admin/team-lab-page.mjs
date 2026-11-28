import { createTeamLab } from './team-lab.mjs';
import { teamCard } from '../packages/engine.mjs';
import path from 'node:path';
import { lockedPackage } from '../packages/store.mjs';
import { journalHttp } from './journal-page.mjs';
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={starting:'正在排队',running:'正在试跑',passed:'技术检查完成',failed:'试跑未完成',stopped:'已停下',interrupted:'试跑中断'};
export function trialCard(r,base) {
  const value={draftId:r.draftId,runId:r.id,expectedHash:r.hash};
  return teamCard({title:`AI 管理员助手 · ${labels[r.status]||r.status}`,color:'orange',text:[
    r.demand.slice(0,160),`完成 ${r.history?.length||0} 项任务；${r.calls?.length||0} 次模型调用。`,r.error||(r.status==='passed'?'请阅读最终成果，由你决定是否验收并应用这个版本。':'本次尚未通过。可查看过程，再调整草稿或继续失败节点。'),
    '独立调试项目，确认关口为测试模拟，原项目未改变。',`试跑编号：${r.id}`,
  ].join('\n'),buttons:r.mode!=='real-sdk'?[]:r.status==='passed'?[{label:'应用这个版本',primary:true,value:{...value,action:'team_lab_apply'}},{label:'导出团队包',value:{...value,action:'team_lab_export'}}]:['failed','stopped','interrupted'].includes(r.status)?[{label:'继续试跑',primary:true,value:{...value,action:'team_lab_retry'}}]:[],links:[{label:'试跑过程与成果',url:`${base}/admin/team-lab/${r.id}`} ]});
}
export async function teamLabHttp({req,res,url,root,send}) {
  if(await journalHttp({req,res,url,root,send}))return true;
  if(!url.pathname.startsWith('/admin/team-lab/'))return false;
  if(req.method!=='GET'){send(res,405,'只支持读取');return true;}
  const m=/^\/admin\/team-lab\/([a-f0-9-]{36})$/.exec(url.pathname);if(!m){send(res,404,'未找到试跑');return true;}
  try{
    const lab=createTeamLab({root}),r=await lab.result(m[1]),artifact=url.searchParams.get('artifact');
    const a=artifact?await lab.artifact(r.id,artifact):null;
    const pack=await lockedPackage(path.join(root,'data/admin/team-lab/runs',r.id),r.package);
    const roleName=id=>pack.manifest.roles.find(role=>role.id===id)?.name||id;
    const skillName=id=>pack.manifest.skills.find(skill=>`team:${skill.id}`===id)?.name||id;
    const modeName=mode=>({plan:'编排任务',work:'执行任务',review:'独立检查',delivery_review:'成品检查','delivery-review':'成品检查'})[mode]||'检查成果';
    const content=a?`<a href="/admin/team-lab/${r.id}">← 返回试跑</a><h2>${escape(a.name)}</h2><pre>${escape(a.text)}</pre>`:`
      <a href="/admin/team-lab/drafts/${escape(r.draftId)}">← 管理员指令、回复与修改差异</a><h2>试跑目标</h2><p>${escape(r.demand)}</p>
      <h2>交付物</h2><ul>${r.artifacts.map(a=>`<li><a href="?artifact=${encodeURIComponent(a.id)}">${escape(a.name)} ↗</a> ${a.final?'· 最终成果':''}</li>`).join('')||'<li>尚无交付物</li>'}</ul>
      <h2>工作流记录</h2>${(r.history||[]).map(h=>`<article><strong>${escape(h.name||h.task)}</strong><small>${escape(roleName(h.role))}</small><p>${escape(h.summary||h.result)}</p></article>`).join('')||'<p>正在等待任务完成。</p>'}
      <h2>角色与 Skill</h2>${(r.calls||[]).map(c=>`<article><strong>${escape(roleName(c.role))} · ${escape(modeName(c.mode))}</strong><p>${escape(c.skills?.map(skillName).join('、')||'本次无技能调用')}</p><small>${c.ok?'完成':c.finishedAt?'未完成':'执行中'} ${escape(c.error)}</small></article>`).join('')}
      <details><summary>查看逐次工具记录</summary><pre>${escape(JSON.stringify(r.events,null,2))}</pre></details>
      <details><summary>查看模拟关口与成品检查</summary><pre>${escape(JSON.stringify({approvals:r.approvals,quality:r.deliveryReviews,retries:r.retries},null,2))}</pre></details>`;
    const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>团队调试 · ${escape(labels[r.status])}</title><style>body{margin:0;background:#080f1b;color:#dbeafa;font:15px/1.7 system-ui}main{max-width:1000px;margin:40px auto;padding:24px}h1,h2{color:#8cebf3}h2{margin-top:36px}a{color:#62dcef;text-decoration:none}article{background:#101e30;border:1px solid #233c53;border-radius:12px;padding:16px;margin:12px 0}small{display:block;color:#98adbf}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#101e30;padding:20px;border-radius:12px}p{overflow-wrap:anywhere;white-space:pre-line}.error{color:#ffb19e}details{margin:24px 0}</style><main><small>TEAM LAB / 独立调试记录</small><h1>${escape(labels[r.status]||r.status)}</h1><p>${escape(pack.manifest.name)} · v${escape(r.package.version)} · 人工关口由测试驱动模拟，最终验收由你决定</p>${r.error?`<p class="error">${escape(r.error)}</p>`:''}${content}</main></html>`;
    send(res,200,html);
  }catch(e){send(res,404,'试跑或产物暂不可用',false,'text/plain; charset=utf-8');}
  return true;
}
