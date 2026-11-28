import { createAdminJournal } from './journal.mjs';
import { createTeamLab } from './team-lab.mjs';
import { plainText } from '../presentation.mjs';
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names = {wiki_lookup:'检索知识',wiki_update:'更新知识',conversation_history:'追溯原始讨论',team_catalog:'查看团队目录',team_draft_open:'复制 / 导入团队',team_draft_read:'读取草稿',team_draft_edit:'修改草稿',team_draft_validate:'校验团队结构',team_trial_start:'启动真实试跑',team_trial_result:'查看试跑结果',team_trial_retry:'继续试跑',team_trial_stop:'停止试跑',team_draft_apply:'应用团队版本',team_draft_export:'导出分享'};
const states = {starting:'等待试跑',running:'试跑中',passed:'技术检查完成',failed:'未通过',stopped:'已停止',interrupted:'已中断',stopping:'正在停止'};
const time = s => s ? new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '';
const shell = (title,body) => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · 管理员调试</title><style>
:root{color-scheme:dark;font:15px/1.7 system-ui;background:#080e1b;color:#dceaf5}*{box-sizing:border-box}body{margin:0;background:radial-gradient(at 15% 0,#14304470,transparent 65%)}main{max-width:1180px;margin:auto;padding:24px}header{display:flex;align-items:center;justify-content:space-between;gap:24px;border-bottom:1px solid #294256;padding-bottom:20px;margin-bottom:28px}nav{display:flex;gap:22px}a{color:#72e5ef;text-decoration:none}a:hover{text-decoration:underline}h1{font-size:28px;margin:5px 0}h2{font-size:20px;margin:26px 0 12px}small,.muted{color:#94afc1}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}article,.panel{border:1px solid #294256;background:#101d2de0;border-radius:12px;padding:18px;margin:12px 0}.badge{font-size:12px;border-radius:20px;background:#123c40;color:#9df0dc;padding:3px 9px;display:inline-block}.legacy{background:#383123;color:#edce93}.instruction{border-left:3px solid #668dff;background:#13233f;margin-left:10%}.reply{border-left:3px solid #65dac9;margin-right:10%}.operation{margin:10px 0;padding:12px 16px;background:#0b1724;border-left:2px solid #395267}.error{color:#ffb3a5}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.65 ui-monospace,monospace;padding:12px;background:#0a1420;max-height:550px;overflow:auto}details{margin:12px 0}.diff-line{display:block;white-space:pre-wrap;overflow-wrap:anywhere}.add{color:#a5efb2;background:#153625}.del{color:#ffb2b9;background:#3b1d29}.columns{display:grid;grid-template-columns:1fr 1fr;gap:12px}button{background:#142b3c;color:#9ee7f1;border:1px solid #36586b;border-radius:7px;padding:7px 15px;cursor:pointer}a:focus-visible,summary:focus-visible,button:focus-visible{outline:2px solid #8feaf6;outline-offset:4px}.ids{overflow-wrap:anywhere;font-size:12px}.history{border-top:1px solid #294256;margin-top:30px}@media(max-width:650px){main{padding:16px}.columns{grid-template-columns:1fr}header{display:block}.instruction{margin-left:4%}.reply{margin-right:4%}}
</style><main><header><div><small>TEAM STUDIO / 管理员调试</small><h1>${esc(title)}</h1></div><nav><a href="/teams">← 工作看板</a><a href="/admin/team-lab">全部调试</a><button onclick="location.reload()">刷新记录</button></nav></header>${body}</main></html>`;

// Bounded LCS handles separated edits in manifests without marking the whole file changed.
export function lineDiff(before, after) {
  const a=before.split('\n'),b=after.split('\n'),rows=[];
  if(a.length+b.length>10000)return [{kind:'same',text:'文件行数较多，请展开下方修改前后全文。'}];
  if((a.length+1)*(b.length+1)<=2000000){
    const width=b.length+1,table=new Uint32Array((a.length+1)*width);
    for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)table[i*width+j]=a[i]===b[j]?1+table[(i+1)*width+j+1]:Math.max(table[(i+1)*width+j],table[i*width+j+1]);
    let i=0,j=0;while(i<a.length||j<b.length){
      if(i<a.length&&j<b.length&&a[i]===b[j]){rows.push({kind:'same',text:a[i++]});j++;}
      else if(i<a.length&&(j===b.length||table[(i+1)*width+j]>=table[i*width+j+1]))rows.push({kind:'del',text:a[i++]});
      else rows.push({kind:'add',text:b[j++]});
    }
  }else{
    let start=0,end=0;
    while(start<a.length&&start<b.length&&a[start]===b[start])start++;
    while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end])end++;
    rows.push(...a.slice(0,start).map(text=>({kind:'same',text})),...a.slice(start,a.length-end).map(text=>({kind:'del',text})),...b.slice(start,b.length-end).map(text=>({kind:'add',text})),...b.slice(b.length-end).map(text=>({kind:'same',text})));
  }
  const keep=new Set();for(let i=0;i<rows.length;i++)if(rows[i].kind!=='same')for(let j=Math.max(0,i-2);j<=Math.min(rows.length-1,i+2);j++)keep.add(j);
  const out=[];let skipped=0;for(let i=0;i<rows.length;i++){
    if(!keep.has(i)){skipped++;continue;}
    if(skipped)out.push({kind:'same',text:`… ${skipped} 行未修改 …`});skipped=0;out.push(rows[i]);
  }
  if(skipped)out.push({kind:'same',text:`… ${skipped} 行未修改 …`});return out;
}

function timeline(events) {
  // A patched card replaces its initial progress card; it is not a second reply.
  const lastCard=new Map();for(const e of events)if(e.type==='reply'&&e.messageId)lastCard.set(e.messageId,e.id);
  const completed=new Set(events.filter(e=>e.type==='operation').map(e=>e.operationId));
  return events.map(e=>{
    if(e.type==='instruction')return `<article class="instruction"><b>你 · ${e.kind==='card'?'卡片操作':'指令'}</b> <span class="badge ${e.source?.startsWith('feishu-')?'':'legacy'}">${e.source==='feishu-private'?'真实飞书私聊':e.source==='feishu-card'?'真实飞书按钮':'内部调用'}</span><p>${esc(e.text)}</p><small>${esc(time(e.at))}</small>${e.messageId?`<details class="ids"><summary>飞书消息凭据</summary>消息：${esc(e.messageId)}<br>会话：${esc(e.chatId)}<br>发送人：${esc(e.senderOpenId)}</details>`:''}</article>`;
    if(e.type==='reply'&&(!e.messageId||lastCard.get(e.messageId)===e.id))return `<article class="reply"><b>${esc(e.title||'AI 管理员助手')}</b>${e.pending?' <span class="badge">处理中</span>':''}<p>${esc(plainText(e.text))}</p><small>${esc(time(e.at))}</small>${e.messageId?`<details class="ids"><summary>回复凭据</summary>${esc(e.messageId)}</details>`:''}</article>`;
    if(e.type==='operation')return `<div class="operation"><b>${esc(names[e.name]||e.name)}</b> · <span class="${e.ok?'':'error'}">${e.ok?'完成':'未完成'}</span>${e.pageId?`<p>${esc(e.scope)} · ${esc(e.pageId)}${e.project?' · 项目 #'+esc(e.project):''}</p>`:''}${e.afterRevision?`<small class="ids">版本 ${esc(e.beforeRevision||'新建')} → ${esc(e.afterRevision)}</small>`:''}${e.error?`<p>${esc(e.error)}</p>`:''}${e.changed?.length?`<p>${esc(e.changed.join('、'))}</p>`:''}${['team_draft_edit','wiki_update'].includes(e.name)&&e.draftId&&e.ok?`<a href="/admin/team-lab/diff/${e.id}">查看修改前后差异 ↗</a>`:''}${e.runId?` <a href="/admin/team-lab/${esc(e.runId)}">试跑记录 ↗</a>`:''}<small> ${esc(time(e.at))}</small></div>`;
    if(e.type==='operation-start'&&!completed.has(e.id))return `<div class="operation">${esc(names[e.name]||e.name)} · 尚未收到完成记录</div>`;
    if(e.type==='dispatch')return `<p class="muted">${e.mode==='steered'?'这条补充已交给正在执行的管理员任务。':'这条指令已排队，上一轮完成后处理。'}</p>`;
    if(e.type==='error')return `<p class="error">${esc(e.text)}</p>`;
    return '';
  }).join('')||'<p class="muted">暂无已保存的私聊记录。旧试跑没有记录的指令和回复不会补造。</p>';
}
export function draftEvents(all,draft) {
  const direct=e=>e.draftId===draft.id||draft.runs.includes(e.runId);
  const turns=new Set(all.filter(direct).map(e=>e.turnId).filter(Boolean));
  let changed;do{changed=false;for(const e of all)if(e.type==='dispatch'&&e.mode==='steered'&&(turns.has(e.turnId)||turns.has(e.parentTurnId)))for(const id of [e.turnId,e.parentTurnId])if(id&&!turns.has(id)){turns.add(id);changed=true;}}while(changed);
  // Queued turns have their own operations: their parent belongs to another request.
  return all.filter(e=>direct(e)||turns.has(e.turnId));
}
export async function journalHttp({req,res,url,root,send}) {
  const route=url.pathname,match=/^\/admin\/team-lab\/(drafts|diff)\/([a-f0-9-]{36})$/.exec(route);
  if(!['/admin/team-lab','/admin/team-lab/'].includes(route)&&!match)return false;
  if(req.method!=='GET'){send(res,405,'只支持读取');return true;}
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`){send(res,403,'来源不允许');return true;}
  try {
    const journal=createAdminJournal({root}),all=journal.events(),lab=createTeamLab({root});
    if(match?.[1]==='diff'){
      const d=await journal.diff(match[2]);
      send(res,200,shell('修改前后差异',`<a href="/admin/team-lab/drafts/${d.operation.draftId}">← 返回管理员对话</a><p class="ids">${esc(d.operation.beforeHash)} → ${esc(d.operation.afterHash)}</p>${d.files.map(f=>`<section class="panel"><h2>${esc(f.file)} ${f.added?'· 新增':f.removed?'· 删除':''}</h2><pre>${lineDiff(f.before,f.after).map(l=>`<span class="diff-line ${l.kind}">${l.kind==='add'?'+ ':l.kind==='del'?'- ':'  '}${esc(l.text)}</span>`).join('')}</pre><details><summary>查看修改前后全文</summary><div class="columns"><div><h3>修改前</h3><pre>${esc(f.before)}</pre></div><div><h3>修改后</h3><pre>${esc(f.after)}</pre></div></div></details></section>`).join('')||'<p>内容没有变化。</p>'}`));return true;
    }
    const {drafts}=await lab.list();
    if(match){
      const d=drafts.find(d=>d.id===match[2]);if(!d)throw Error('找不到草稿');
      const events=draftEvents(all,d);
      const runs=await Promise.all([...d.runs].reverse().map(id=>lab.result(id).catch(()=>({id,status:'unavailable'}))));
      const real=events.some(e=>e.type==='instruction'&&e.source==='feishu-private');
      send(res,200,shell(d.name,`<span class="badge ${real?'':'legacy'}">${real?'已记录真实私聊':'历史草稿 · 无真实私聊凭据'}</span><p>${esc(d.targetId)} · v${esc(d.version)} · ${d.application?'已应用':'个人草稿'}</p><h2>试跑结果</h2><div class="grid">${runs.map(r=>`<article><b>${esc(states[r.status]||'记录暂不可用')}</b><p>${esc(r.demand?.slice(0,120))}</p><small>${r.history?.length||0} 项任务 · ${r.calls?.length||0} 次模型调用 · ${r.mode==='real-sdk'?'真实 SDK':'测试替身 / 未知'}</small><small>草稿 ${esc(r.hash?.slice(0,10))} · ${r.hash===d.hash?'当前版本':'历史版本'}</small><small>人工关口由测试驱动模拟</small><a href="/admin/team-lab/${r.id}">查看角色、Skill 与成果 ↗</a>${r.error?`<p class="error">${esc(r.error)}</p>`:''}</article>`).join('')||'<p class="muted">尚未开始试跑</p>'}</div><h2>指令、回复与修改</h2>${timeline(events)}`));return true;
    }
    const recent=all.filter(e=>e.type==='instruction').slice(-30),ids=new Set(recent.map(e=>e.turnId));
    send(res,200,shell('团队调试',`<p class="muted">在飞书私聊「AI 管理员助手」提出修改，这里保留对话、逐次差异与独立试跑结果。已有项目使用原版本。</p><div class="grid">${drafts.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(d=>{
      const inputs=draftEvents(all,d).filter(e=>e.type==='instruction');
      return `<article><h2><a href="/admin/team-lab/drafts/${d.id}">${esc(d.name)} ↗</a></h2><span class="badge ${inputs.some(e=>e.source==='feishu-private')?'':'legacy'}">${inputs.some(e=>e.source==='feishu-private')?'真实私聊':'历史记录 / 内部调用'}</span><p>${esc(d.targetId)} · v${esc(d.version)}</p><small>${d.runs.length} 次试跑 · ${d.application?'已应用':'草稿'} · ${esc(time(d.updatedAt))}</small></article>`;
    }).join('')||'<p>还没有个人团队草稿。可以私聊管理员：复制文枢，帮我调整作者和写作技能。</p>'}</div><section class="history"><h2>最近管理员对话</h2><p class="muted">尚未关联草稿的指令也会保留。显示最近 30 条指令；完整调试过程进入对应团队查看。</p>${timeline(all.filter(e=>ids.has(e.turnId)))}</section>`));
  } catch {send(res,404,'调试记录暂不可用',false,'text/plain; charset=utf-8');}
  return true;
}
