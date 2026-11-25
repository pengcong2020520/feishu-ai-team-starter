import { names, glyph, stageNames, columns, stepDefs, stageIndex, timeSince, waitSince, flowStatus, roleForProject, artifactStep, defaultRoleProject, roleProjectHint, roleTimeline, messageView, originalDemand, latestCards } from './presentation.mjs';
const $ = selector => document.querySelector(selector);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined && text !== null) node.textContent = text; if (className) node.className = className; return node; };
const clear = node => node.replaceChildren();
const colors = { product: '#3B82F6', designer: '#A86BF7', developer: '#2FBF71' };
const tabs = [['prd','PRD'],['wireframe','线框'],['site','网页'],['walkthrough','走查页']];
const app = { state:{ groups:{},projects:[],colleagues:{} }, chats:[], view:'board', project:null, tab:'prd', role:'designer', roleProject:null, modelBase:'http://127.0.0.1:4871', refreshing:false };
const params = values => new URLSearchParams(values).toString();
async function json(path) { const response = await fetch(path); if (!response.ok) throw Error(await response.text()); return response.json(); }
async function post(path, body) { const response = await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Workbench':'1'},body:JSON.stringify(body)}); const result = await response.json(); if (!response.ok) throw Error(result.error || '请求失败'); return result; }
function notice(message) { const box=$('#notice');box.textContent=message;box.classList.add('visible');clearTimeout(notice.timer);notice.timer=setTimeout(()=>box.classList.remove('visible'),4500); }
const project = id => app.state.projects.find(p=>p.id===id);
const active = p => p.stage!=='done';
const isCurrent = p => app.state.groups[p.chatId]?.id===p.id;
const avatar = (role, extra='') => el('span',glyph[role||'user'],`avatar ${role||'user'} ${extra}`);
function setView(view, { id, tab, role, roleProject }={}) { if(view==='roles'&&(app.view!=='roles'||role&&role!==app.role)&&!roleProject)app.roleProject=null;app.view=view; if(id)app.project=id;if(tab)app.tab=tab;if(role)app.role=role;if(roleProject)app.roleProject=roleProject; const hash=new URLSearchParams(view==='project'?{view,project:app.project,tab:app.tab}:view==='roles'?{view,role:app.role,...(app.roleProject?{project:app.roleProject}:{})}:{view}); history.replaceState(null,'','#'+hash);render(); }
function header() { const projects=app.state.projects, activeProjects=projects.filter(active), waiting=activeProjects.filter(p=>p.waitingFor&&!p.busy), working=activeProjects.filter(p=>p.busy); $('#count-active').textContent=activeProjects.length;$('#count-waiting').textContent=waiting.length;$('#count-working').textContent=working.length;$('#count-waiting').classList.toggle('has-count',waiting.length>0);$('#count-working').classList.toggle('has-count',working.length>0);$('#back').hidden=app.view==='board'; if(app.view==='board'){ $('#page-title').textContent='AI 团队工作台';$('#page-subtitle').textContent='3 个 AI 同事在做什么、哪里在等你'; } else if(app.view==='project'){const p=project(app.project);$('#page-title').textContent=p?`#${p.number} ${p.name}`:'项目详情';$('#page-subtitle').textContent=p?`${stageNames[p.stage]} · ${p.source}`:'';}else{$('#page-title').textContent='和 AI 同事聊天';$('#page-subtitle').textContent='和在飞书群里 @ 它是一样的';} }
function progressBar(p) { const progress=el('div',null,'progress'), current=stageIndex(p.stage); stepDefs.forEach((step,i)=>{const part=el('i');if(p.stage==='done'||i<current)part.className=step.role;else if(i===current)part.className=p.waitingFor?'waiting':p.busy?'flowing':step.role;progress.append(part);});return progress; }
function cardStatus(p) { if(p.stage==='done')return el('div','✓ 已完成','card-status done');if(p.error)return el('div',`需要重试 · ${p.error}`,'card-status wait');if(p.waitingFor)return el('div',`等你${p.waitingFor} · ${waitSince(p.stageAt)}`,'card-status wait');if(p.busy){const tool={Read:'📖 读',Write:'✍️ 写',Edit:'✏️ 改',Glob:'🔍 找文件',Skill:'🧰 用技能'}[p.currentTool]||'正在处理';return el('div',`${names[p.activeRole]||'AI 同事'}：${tool} ${p.currentFile||''}`,'card-status');}return el('div',stageNames[p.stage],'card-status'); }
function renderBoard() { clear($('#board'));for(const [title,stages] of columns){const items=app.state.projects.filter(p=>stages.includes(p.stage)),column=el('div',null,'column'),head=el('div',null,'column-head'),body=el('div',null,'column-body');head.append(el('span',title),el('span',String(items.length),'column-count'));column.append(head,body);if(!items.length)body.append(el('div',title==='澄清与 PRD'?'点右上角「+ 提需求」开始':'暂无','empty'));for(const p of items){const card=el('button',null,`project-card ${p.waitingFor?'is-waiting':''} ${p.stage==='done'?'compact':''}`),top=el('div',null,'card-top');top.append(el('span',`#${p.number} ${p.name}`,'project-name'),el('span',timeSince(p.createdAt),'project-time'));card.append(top);if(p.stage==='done'){card.append(el('div',`✓ 已完成`,'card-status done'),el('div',`${p.source} · ${new Date(p.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})} 开始`,'done-meta'));}else{const faces=el('div',null,'avatars'),currentRole=p.activeRole||stepDefs[Math.max(0,stageIndex(p.stage))]?.role;for(const role of Object.keys(names))faces.append(avatar(role,role===currentRole?`active ${p.busy?'working':''}`:''));card.append(faces,cardStatus(p),progressBar(p));}card.onclick=()=>setView('project',{id:p.id,tab:p.artifacts?.prd?'prd':p.artifacts?.wireframe?'wireframe':'prd'});body.append(card);}$('#board').append(column);}clear($('#colleagues'));for(const role of Object.keys(names)){const info=app.state.colleagues?.[role],p=app.state.projects.find(p=>p.activeRole===role),waitingProject=app.state.projects.find(p=>active(p)&&p.waitingFor&&stepDefs[stageIndex(p.stage)]?.role===role),colleague=el('button',null,'colleague'),detail=el('div');detail.append(el('strong',names[role]),el('small',info?.busy?`正在 #${p?.number||''} ${stageNames[p?.stage]||'处理项目'}`:waitingProject?`等你处理 #${waitingProject.number} ${stageNames[waitingProject.stage]}`:'空闲'));colleague.append(avatar(role,info?.busy?'working':waitingProject?'waiting':''),detail);colleague.onclick=()=>setView('roles',{role});$('#colleagues').append(colleague);}$('#colleagues').append(el('div','点同事打开聊天，点项目看详情','footer-hint')); }
function renderFlow(p){clear($('#flow-steps'));const current=stageIndex(p.stage);stepDefs.forEach((step,i)=>{const row=el('div',null,`flow-step ${i<current||p.stage==='done'?'done':''} ${i===current?'active':''} ${i===current&&p.waitingFor?'waiting':''}`),dot=el('span',i<current||p.stage==='done'?'✓':'','step-dot'),body=el('div'),name=el('b',step.name);row.style.setProperty('--role-color',colors[step.role]||'#F5B82E');body.append(name,el('small',`${names[step.role]||'你'} · ${flowStatus(p,i)}${i===current&&p.stage!=='done'?` · ${timeSince(p.stageAt)}`:''}`));const links=el('div',null,'step-links');for(const [key,label] of tabs){if(!p.artifacts?.[key])continue;if(artifactStep[key]!==i)continue;const button=el('button',label);button.onclick=()=>setView('project',{id:p.id,tab:key});links.append(button);}body.append(links);row.append(dot,body);$('#flow-steps').append(row);});$('#demand-original').textContent=p.demand||'暂无需求原文';}
function renderPrd(text,box){clear(box);const paper=el('article',null,'prd-paper');for(const line of text.split(/\r?\n/)){const trimmed=line.trim(),tag=trimmed.startsWith('# ')?'h1':trimmed.startsWith('## ')?'h2':'p';paper.append(el(tag,tag==='p'?trimmed:trimmed.replace(/^#{1,2}\s+/,'')));}box.append(paper);}
function artifactLink(p,key){return key==='prd'?null:key==='walkthrough'?`/p/${p.id}/walkthrough`:`${app.modelBase}/p/${p.id}/${key}`;}
function renderArtifact(p){clear($('#artifact-tabs'));clear($('#artifact-content'));for(const [key,label] of tabs){const button=el('button',label,app.tab===key?'active':'');button.onclick=()=>setView('project',{id:p.id,tab:key});$('#artifact-tabs').append(button);}const link=artifactLink(p,app.tab);$('#artifact-open').hidden=!link||!p.artifacts?.[app.tab];if(link)$('#artifact-open').href=link;if(!p.artifacts?.[app.tab]){$('#artifact-content').append(el('div','产物尚未生成','empty-artifact'));return;}if(app.tab==='prd'){const box=$('#artifact-content');box.append(el('div','正在读取 PRD…','empty-artifact'));fetch(`/api/prd?${params({projectId:p.id})}`).then(r=>r.text()).then(text=>{if(app.view==='project'&&app.project===p.id&&app.tab==='prd')renderPrd(text,box);}).catch(()=>{box.textContent='PRD 读取失败';});}else{const frame=el('iframe');frame.title=`${p.name} ${app.tab}`;frame.setAttribute('sandbox','allow-scripts allow-forms');frame.src=link;$('#artifact-content').append(frame);}}
function renderMessage(event){const view=messageView(event);if(!view)return null;const user=view.user,role=event.role||'product',row=el('div',null,`message ${user?'user':''}`),content=el('div',null,'message-content');row.append(avatar(user?null:role));content.append(el('div',`${user?'你':names[role]||'系统'}${event.source?` ${event.source}`:''}${event.at?` · ${new Date(event.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`:''}${event.updatedAt?' · 已更新':''}`,'message-meta'));if(view.type==='text'){content.append(el('div',view.text,'bubble'));row.append(content);return row;}const card=view.card,box=el('div',null,'card-box');box.style.setProperty('--role-color',card.color==='purple'?colors.designer:card.color==='green'?colors.developer:colors[role]||colors.product);box.append(el('div',card.title,'card-title'));const body=el('div',null,'card-body');(card.text||[]).forEach((line,index)=>{if(index===1)body.append(el('hr'));if(line)body.append(el('p',line));});if(card.imageUrl){const img=el('img',null,'card-preview');img.alt='页面一览';img.src=card.imageUrl;img.onerror=()=>{img.remove();const source=card.links?.find(link=>/结构图|线框|网页|走查/.test(link.label));if(source){const frame=el('iframe',null,'card-preview-frame');frame.title='页面预览';frame.setAttribute('sandbox','allow-scripts');frame.src=source.url;body.insertBefore(frame,body.querySelector('.card-actions'));}};body.append(img);}const formValue={};for(const question of card.questions||[]){const label=el('label',question.id,'question'),select=el('select');question.options.forEach((option,index)=>{const item=el('option',option);item.value=String(index);select.append(item);});select.value=String(question.recommended);formValue[question.id]=select.value;select.onchange=()=>formValue[question.id]=select.value;label.append(select);body.append(label);}if(card.extra){const textarea=el('textarea');textarea.placeholder='其他补充';textarea.oninput=()=>formValue[card.extra]=textarea.value;body.append(textarea);}const actions=el('div',null,'card-actions');for(const link of card.links||[]){const anchor=el('a',`${link.label} ↗`);anchor.href=link.url;anchor.target='_blank';anchor.rel='noopener';actions.append(anchor);}for(const option of card.buttons||[]){if(!option.value)continue;const button=el('button',option.label,option.value.action==='confirm'||option.value.action==='answer'?'confirm':option.value.action==='reject'?'reject':'');button.onclick=async()=>{try{const result=await post('/api/action',{chatId:event.chatId,role:event.role,value:option.value,formValue});notice(result.toast?.content||'已提交');await refresh();}catch(error){notice(error.message);}};actions.append(button);}body.append(actions);box.append(body);content.append(box);row.append(content);return row;}
async function loadMessages({chatId,projectId,role,target}){const box=$(target);if(!chatId){clear(box);return;}try{const values={chatId,...(projectId?{projectId}:{}),...(role?{role}:{})},events=await json(`/api/messages?${params(values)}`);if(target==='#project-messages'&&app.project!==projectId)return;clear(box);for(const event of latestCards(events)){const row=renderMessage(event);if(row)box.append(row);}box.scrollTop=box.scrollHeight;if(target==='#project-messages'){const p=project(projectId);if(p)$('#demand-original').textContent=originalDemand(p,events);$('#message-count').textContent=`${events.length} 条`; }}catch(error){box.textContent=`消息读取失败：${error.message}`;}}
function renderProject(){const p=project(app.project);if(!p){setView('board');return;}renderFlow(p);renderArtifact(p);$('#project-form').hidden=!isCurrent(p);void loadMessages({chatId:p.chatId,projectId:p.id,target:'#project-messages'});}
function renderRoles(){
  clear($('#role-list'));
  for(const role of Object.keys(names)){
    const info=app.state.colleagues?.[role],button=el('button',null,`role-choice ${app.role===role?'active':''}`),detail=el('span');
    detail.append(el('strong',names[role]),el('small',info?.busy?'正在处理项目':'空闲'));
    button.append(avatar(role,info?.busy?'working':''),detail);
    button.onclick=()=>setView('roles',{role});
    $('#role-list').append(button);
  }
  clear($('#role-header'));
  const info=app.state.colleagues?.[app.role],identity=el('div',null,'identity'),detail=el('div');
  detail.append(el('strong',names[app.role]),el('small',info?.busy?'正在处理项目':'空闲'));
  identity.append(avatar(app.role,info?.busy?'working':''),detail);
  $('#role-header').append(identity);
  const candidates=app.state.projects.filter(p=>active(p)&&isCurrent(p));
  if(app.roleProject!=='new'&&!candidates.some(p=>p.id===app.roleProject))app.roleProject=defaultRoleProject(candidates,app.role);
  if(app.role!=='product'&&app.roleProject==='new')app.roleProject=defaultRoleProject(candidates,app.role);
  const select=$('#role-project');clear(select);
  if(app.role==='product'){const option=el('option','新需求');option.value='new';select.append(option);}
  for(const p of candidates){const option=el('option',`#${p.number} ${p.name} · ${p.source}`);option.value=p.id;select.append(option);}
  if(app.roleProject)select.value=app.roleProject;
  const updateCompose=()=>{
    const p=project(app.roleProject),disabled=!candidates.length;
    $('#role-project-hint').textContent=app.roleProject==='new'?roleProjectHint(null,app.role):p?roleProjectHint(p,app.role):'';
    $('#role-input').disabled=disabled;
    $('#role-form button').disabled=disabled;
    $('#role-input').placeholder=disabled?'暂时没有进行中的项目':`对 ${names[app.role]}说…（Enter 发送）`;
  };
  select.onchange=()=>{app.roleProject=select.value;updateCompose();};
  updateCompose();
  void loadRoleMessages();
}
async function loadRoleMessages(){
  const role=app.role,request=app.roleMessageRequest=(app.roleMessageRequest||0)+1,box=$('#role-messages');
  const projects=app.state.projects.filter(p=>p.chatId);
  try{
    const batches=await Promise.all(projects.map(async p=>{
      const events=await json(`/api/messages?${params({projectId:p.id,role})}`);
      return latestCards(events).map(event=>({...event,projectId:p.id,projectNumber:p.number,projectName:p.name}));
    }));
    if(app.view!=='roles'||app.role!==role||app.roleMessageRequest!==request)return;
    clear(box);
    for(const item of roleTimeline(batches.flat().filter(event=>messageView(event)))){
      box.append(item.kind==='project_separator'?el('div',`#${item.projectNumber} ${item.projectName}`,'project-separator'):renderMessage(item));
    }
    if(!box.childNodes.length)box.append(el('div','暂无消息','empty-artifact'));
    box.scrollTop=box.scrollHeight;
  }catch(error){if(app.view==='roles'&&app.role===role&&app.roleMessageRequest===request)box.textContent=`消息读取失败：${error.message}`;}
}
function render(){for(const view of ['board','project','roles'])$('#'+view+'-view').hidden=app.view!==view;header();if(app.view==='board')renderBoard();else if(app.view==='project')renderProject();else renderRoles();}
async function refresh(){if(app.refreshing)return;app.refreshing=true;try{const [state,chats,config]=await Promise.all([json('/api/state'),json('/api/chats').catch(()=>[]),json('/api/config').catch(()=>({}))]);app.state=state;app.chats=chats;app.modelBase=config.modelBase||app.modelBase;$('#sync-label').textContent='飞书同步中';$('.sync').classList.remove('offline');render();}catch(error){$('#sync-label').textContent='工作台服务连不上';$('.sync').classList.add('offline');notice(`状态读取失败：${error.message}`);}finally{app.refreshing=false;}}
$('#back').onclick=()=>setView('board');$('#new-demand').onclick=()=>$('#demand-dialog').showModal();$('#demand-cancel').onclick=()=>$('#demand-dialog').close();$('#demand-form').onsubmit=async event=>{event.preventDefault();try{const result=await post('/api/demand',{text:$('#demand-text').value});$('#demand-text').value='';$('#demand-dialog').close();notice(`需求已提交 · ${result.source}`);await refresh();if(result.projectId)setView('project',{id:result.projectId});}catch(error){notice(error.message);}};
$('#project-form').onsubmit=async event=>{event.preventDefault();const text=$('#project-input').value.trim(),p=project(app.project);if(!text||!p)return;try{await post('/api/message',{chatId:p.chatId,role:$('#project-role').value,text});$('#project-input').value='';notice('消息已发送');await refresh();}catch(error){notice(error.message);}};
$('#role-form').onsubmit=async event=>{event.preventDefault();const text=$('#role-input').value.trim(),p=project(app.roleProject);if(!text)return;try{if($('#role-project').value==='new'){const result=await post('/api/demand',{text});app.roleProject=result.projectId;notice(`需求已提交 · ${result.source}`);}else{if(!p)return;await post('/api/message',{chatId:p.chatId,role:app.role,text});notice('消息已发送');}$('#role-input').value='';await refresh();}catch(error){notice(error.message);}};
for(const form of ['#project-form','#role-form'])$(form+' textarea').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$(form).requestSubmit();}};
$('#role-source').onclick=async()=>{try{const source=await json(`/api/role?${params({role:app.role})}`);$('#source-title').textContent=`${source.role} · 角色说明与技能`;$('#source-content').textContent=`【角色说明】\n${source.prompt}\n\n`+source.skills.map(skill=>`【技能：${skill.name}】\n${skill.text}`).join('\n\n');$('#source-dialog').showModal();}catch(error){notice(error.message);}};$('#source-close').onclick=()=>$('#source-dialog').close();$('#source-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('#source-content').textContent);notice('已复制');}catch{notice('复制失败');}};
const hash=new URLSearchParams(location.hash.slice(1));if(hash.get('view')==='project'){app.view='project';app.project=hash.get('project');app.tab=hash.get('tab')||'prd';}else if(hash.get('view')==='roles'){app.view='roles';app.role=names[hash.get('role')]?hash.get('role'):'designer';app.roleProject=hash.get('project');}
await refresh();
if(new URLSearchParams(location.search).has('capture')){
  if(app.view==='project'){
    const p=project(app.project);
    if(p) await loadMessages({chatId:p.chatId,projectId:p.id,target:'#project-messages'});
    const frame=$('#artifact-content iframe');
    if(frame) await Promise.race([new Promise(resolve=>frame.addEventListener('load',resolve,{once:true})),new Promise(resolve=>setTimeout(resolve,3000))]);
  }
  if(app.view==='roles'){
    await loadRoleMessages();
  }
  await new Promise(resolve=>setTimeout(resolve,300));
}else{
  const stream=new EventSource('/api/events');stream.addEventListener('change',()=>{void refresh();});stream.onerror=()=>{setTimeout(()=>void refresh(),4000);};
}
