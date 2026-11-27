import { names, glyph, stageNames, columns, stepDefs, stageIndex, timeSince, waitSince, flowStatus, roleForProject, artifactStep, defaultRoleProject, roleProjectHint, roleTimeline, messageView, originalDemand, latestCards, speakerName } from './presentation.mjs';
const $ = selector => document.querySelector(selector);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined && text !== null) node.textContent = text; if (className) node.className = className; return node; };
const clear = node => node.replaceChildren();
const optionNode = (label, value) => { const node = el('option', label); node.value = value; return node; };
const colors = { product: '#3B82F6', designer: '#A86BF7', developer: '#2FBF71' };
const tabs = [['prd','PRD'],['wireframe','线框'],['site','网页'],['walkthrough','走查页']];
const artifactTabs = [...tabs, ['context','讨论']];
const approvalStages = [['clarifying','需求澄清'],['confirm_prd','需求确认'],['confirm_design','设计确认'],['accept','最终验收']];
const app = { state:{ groups:{},projects:[],colleagues:{} }, chats:[], team:null, teamMissing:false, teamError:'', view:'board', project:null, tab:'prd', role:'designer', roleProject:null, modelBase:'http://127.0.0.1:4871', refreshing:false, demandRequestId:null, roleDemandRequestId:null, editingPersonId:null, editingIdentity:null, projectTeamId:null, teamStale:false };
const params = values => new URLSearchParams(values).toString();
async function json(path) { const response = await fetch(path); if (!response.ok) throw Error(await response.text()); return response.json(); }
async function post(path, body) {
  const response = await fetch(path, { method:'POST', headers:{ 'Content-Type':'application/json', 'X-Workbench':'1' }, body:JSON.stringify(body) });
  const text = await response.text();
  let result = {};
  try { result = text ? JSON.parse(text) : {}; } catch { result = { error: text }; }
  if (!response.ok) throw Error(result.error || text || '请求失败');
  return result;
}
async function loadTeam() {
  const response = await fetch('/api/team');
  if (response.status === 404) return { missing:true };
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) return { error:(body && body.error) || text || '人员名册读取失败' };
  if (!body || !Array.isArray(body.people)) return { error:'人员名册格式不正确' };
  return { value:body };
}
function notice(message) { const box=$('#notice'); box.textContent=message; box.classList.add('visible'); clearTimeout(notice.timer); notice.timer=setTimeout(()=>box.classList.remove('visible'),4500); }
const project = id => app.state.projects.find(item => item.id === id);
const active = item => item.stage !== 'done';
const isCurrent = item => app.state.groups[item.chatId]?.id === item.id;
const avatar = (role, extra='') => el('span', glyph[role || 'user'], `avatar ${role || 'user'} ${extra}`);
function personAvatar(name) {
  const node = el('span', name && name !== '你' ? Array.from(name)[0] : glyph.user, 'avatar user');
  if (name) node.title = name;
  return node;
}
const roster = () => (app.team?.people || []).filter(person => person && person.id && person.name);
const activePeople = () => roster().filter(person => person.active !== false);
const sameId = (left, right) => String(left ?? '') === String(right ?? '');
const personById = (id, people = roster()) => people.find(person => sameId(person.id, id));
function personOptionLabel(person) {
  const job = person.responsibilities?.find(item => item?.job)?.job;
  return job ? `${person.name}（${job}）` : person.name;
}
function identityLabel(identity) {
  if (!identity || typeof identity !== 'object') return '';
  const openIds = identity.openIds && typeof identity.openIds === 'object' ? Object.values(identity.openIds).some(Boolean) : false;
  return identity.unionId || identity.userId || openIds ? '已绑定飞书身份' : '';
}
function safeLink(url) {
  if (typeof url !== 'string' || !url.trim()) return '';
  try {
    const parsed = new URL(url.trim());
    if (['https:', 'http:', 'feishu:', 'lark:'].includes(parsed.protocol)) return parsed.href;
  } catch { /* 不是可用链接 */ }
  return '';
}
function waitingWho(item) {
  return typeof item?.waitingOn === 'string' && item.waitingOn.trim() ? item.waitingOn.trim() : '你';
}
function schedulerText(scheduler) {
  if (!scheduler || typeof scheduler !== 'object') return '';
  if (['active', 'queued', 'limit'].every(key => scheduler[key] === undefined || scheduler[key] === null)) return '';
  return `同时 ${scheduler.active ?? 0}/${scheduler.limit ?? 0} 在干活 · 排队 ${scheduler.queued ?? 0}`;
}
function uniqueProjects(list) {
  const seen = new Set();
  const result = [];
  for (const item of list) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}
function colleagueText(role) {
  const info = app.state.colleagues?.[role] ?? {};
  const working = uniqueProjects([
    ...(info.projects || []).map(id => project(id)).filter(Boolean),
    ...app.state.projects.filter(item => item.activeRole === role),
  ]).filter(item => active(item) && !item.queuedForAgent);
  const queued = app.state.projects.filter(item => item.queuedForAgent === true && active(item) && (item.activeRole === role || (!item.busy && roleForProject(item) === role)) && !working.some(current => current.id === item.id));
  const waitingProjects = app.state.projects.filter(item => active(item) && item.queuedForAgent !== true && !item.busy && item.waitingFor && stepDefs[stageIndex(item.stage)]?.role === role);
  const label = item => `#${item.number} ${stageNames[item.stage] || ''}`.trim();
  const parts = [];
  if (working.length) parts.push(`正在 ${working.map(label).join('、')}`);
  else if (info.busy) parts.push((info.projects || []).length > 1 ? `正在处理 ${info.projects.length} 个项目` : '正在处理项目');
  if (queued.length) parts.push(`排队 ${queued.map(label).join('、')}`);
  if (waitingProjects.length) parts.push(waitingProjects.map(item => `等${waitingWho(item)} #${item.number} ${stageNames[item.stage] || ''}`).join('、'));
  return parts.join(' · ') || '空闲';
}
function colleagueMode(role) {
  const info = app.state.colleagues?.[role];
  const text = colleagueText(role);
  if (info?.busy || text.startsWith('正在') || text.includes('排队')) return 'working';
  if (text.startsWith('等')) return 'waiting';
  return '';
}
function setView(view, { id, tab, role, roleProject } = {}) {
  if (view === 'roles' && (app.view !== 'roles' || role && role !== app.role) && !roleProject) app.roleProject = null;
  app.view = view;
  if (id) app.project = id;
  if (tab) app.tab = tab;
  if (role) app.role = role;
  if (roleProject) app.roleProject = roleProject;
  const hash = new URLSearchParams(view === 'project' ? { view, project: app.project, tab: app.tab } : view === 'roles' ? { view, role: app.role, ...(app.roleProject ? { project: app.roleProject } : {}) } : { view });
  history.replaceState(null, '', '#' + hash);
  render();
}
function header() {
  $('#team-entry').hidden = app.teamMissing;
  const projects = app.state.projects, activeProjects = projects.filter(active), waiting = activeProjects.filter(item => item.waitingFor && !item.busy), working = activeProjects.filter(item => item.busy);
  $('#count-active').textContent = activeProjects.length;
  $('#count-waiting').textContent = waiting.length;
  $('#count-working').textContent = working.length;
  $('#count-waiting').classList.toggle('has-count', waiting.length > 0);
  $('#count-working').classList.toggle('has-count', working.length > 0);
  $('#back').hidden = app.view === 'board';
  if (app.view === 'board') {
    $('#page-title').textContent = 'AI 团队工作台';
    const queue = schedulerText(app.state.scheduler);
    $('#page-subtitle').textContent = queue ? `3 个 AI 同事在做什么、哪里在等你 · ${queue}` : '3 个 AI 同事在做什么、哪里在等你';
  } else if (app.view === 'project') {
    const p = project(app.project);
    $('#page-title').textContent = p ? `#${p.number} ${p.name}` : '项目详情';
    $('#page-subtitle').textContent=p?`${stageNames[p.stage]} · ${p.source}`:'';
  } else if (app.view === 'team') {
    const operator = personById(app.team?.ownerId);
    $('#page-title').textContent = '人员与职责';
    $('#page-subtitle').textContent = operator ? `本机操作者：${operator.name}` : '先设置本机操作者，再安排岗位和确认事项';
  } else {
    $('#page-title').textContent = '和 AI 同事聊天';
    $('#page-subtitle').textContent = '和在飞书群里 @ 它是一样的';
  }
}
function progressBar(item) {
  const progress = el('div', null, 'progress'), current = stageIndex(item.stage);
  stepDefs.forEach((step, index) => {
    const part = el('i');
    if (item.stage === 'done' || index < current) part.className = step.role;
    else if (index === current) part.className = item.waitingFor ? 'waiting' : item.busy ? 'flowing' : step.role;
    progress.append(part);
  });
  return progress;
}
function cardStatus(item) {
  if (item.stage === 'done') return el('div', item.ended ? '已结束' : '✓ 已完成', `card-status ${item.ended ? 'ended' : 'done'}`);
  if (item.error) return el('div', `卡住了 · ${item.errorBrief || '需要你处理'}`, 'card-status wait');
  if (item.queuedForAgent === true) {
    const who = typeof item.waitingOn === 'string' && item.waitingOn.trim() ? ` · 等${item.waitingOn.trim()}` : '';
    return el('div', `${item.activity || '排队中'}${who}`, 'card-status queue');
  }
  if (item.waitingFor) return el('div', `等${waitingWho(item)}${item.waitingFor} · ${waitSince(item.stageAt)}`, 'card-status wait');
  if (typeof item.waitingOn === 'string' && item.waitingOn.trim()) return el('div', `等${item.waitingOn.trim()}`, 'card-status wait');
  if (item.busy) return el('div', `${names[item.activeRole] || 'AI 同事'}：${item.activity || '⏳ 在处理'}`, 'card-status');
  return el('div', stageNames[item.stage], 'card-status');
}
function renderBoard() {
  clear($('#board'));
  for (const [title, stages] of columns) {
    const items = app.state.projects.filter(item => stages.includes(item.stage)), column = el('div', null, 'column'), head = el('div', null, 'column-head'), body = el('div', null, 'column-body');
    head.append(el('span',title),el('span',String(items.length),'column-count'));
    column.append(head, body);
    if (!items.length) body.append(el('div', title === '澄清与 PRD' ? '点右上角「+ 提需求」开始' : '暂无', 'empty'));
    for (const item of items) {
      const waiting = item.queuedForAgent !== true && item.waitingFor;
      const card = el('button', null, `project-card ${waiting ? 'is-waiting' : ''} ${item.queuedForAgent === true ? 'is-queued' : ''} ${item.stage === 'done' ? 'compact' : ''}`), top = el('div', null, 'card-top');
      top.append(el('span', `#${item.number} ${item.name}`, 'project-name'), el('span', timeSince(item.createdAt), 'project-time'));
      card.append(top);
      if (item.stage === 'done') {
        card.append(el('div', item.ended ? '已结束' : '✓ 已完成', `card-status ${item.ended ? 'ended' : 'done'}`), el('div', `${item.source} · ${new Date(item.createdAt).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })} 开始`, 'done-meta'));
      } else {
        const faces = el('div', null, 'avatars'), currentRole = item.activeRole || stepDefs[Math.max(0, stageIndex(item.stage))]?.role;
        for (const role of Object.keys(names)) faces.append(avatar(role, role === currentRole ? `active ${item.busy ? 'working' : ''}` : ''));
        card.append(faces, cardStatus(item), progressBar(item));
      }
      card.onclick = () => setView('project', { id: item.id, tab: item.artifacts?.prd ? 'prd' : item.artifacts?.wireframe ? 'wireframe' : 'prd' });
      body.append(card);
    }
    $('#board').append(column);
  }
  clear($('#colleagues'));
  for (const role of Object.keys(names)) {
    const colleague = el('button', null, 'colleague'), detail = el('div'), mode = colleagueMode(role);
    detail.append(el('strong', names[role]), el('small', colleagueText(role)));
    colleague.append(avatar(role, mode), detail);
    colleague.onclick = () => setView('roles', { role });
    $('#colleagues').append(colleague);
  }
  const hint = el('div', null, 'footer-hint');
  hint.append(el('div', '点同事打开聊天，点项目看详情'));
  const queue = schedulerText(app.state.scheduler);
  if (queue) hint.append(el('div', queue, 'scheduler-hint'));
  $('#colleagues').append(hint);
}
function renderFlow(item) {
  clear($('#flow-steps'));
  const current = stageIndex(item.ended ? item.endedStage : item.stage), finished = item.stage === 'done' && !item.ended;
  stepDefs.forEach((step, i) => {
    const row = el('div', null, `flow-step ${i < current || finished ? 'done' : ''} ${i === current && !finished ? 'active' : ''} ${i === current && item.waitingFor ? 'waiting' : ''}`), dot = el('span', i < current || finished ? '✓' : '', 'step-dot'), body = el('div'), name = el('b', step.name);
    row.style.setProperty('--role-color', colors[step.role] || '#F5B82E');
    let suffix = '';
    if (i === current && !finished && !item.ended) {
      suffix += ` · ${timeSince(item.stageAt)}`;
      if (item.queuedForAgent === true) suffix += ` · ${item.activity || '排队中'}`;
      else if (typeof item.waitingOn === 'string' && item.waitingOn.trim()) suffix += ` · ${item.waitingOn.trim()}`;
    }
    body.append(name, el('small', `${names[step.role] || '你'} · ${flowStatus(item, i)}${suffix}`));
    const links = el('div', null, 'step-links');
    for (const [key, label] of tabs) {
      if (!item.artifacts?.[key]) continue;
      if(artifactStep[key]!==i)continue;
      const button = el('button', label);
      button.type = 'button';
      button.onclick = () => setView('project', { id: item.id, tab: key });
      links.append(button);
    }
    if (i === 0) {
      const discussion = el('button', '讨论');
      discussion.type = 'button';
      discussion.onclick = () => setView('project', { id: item.id, tab: 'context' });
      links.append(discussion);
    }
    body.append(links);
    row.append(dot, body);
    $('#flow-steps').append(row);
  });
  $('#demand-original').textContent = item.demand || '暂无需求原文';
  const reason = $('#flow-error');
  reason.hidden = !item.error;
  reason.textContent = item.error ? `卡住的原因：${item.error}` : '';
}
function assignmentPeople(team) {
  const map = new Map();
  for (const person of activePeople()) map.set(String(person.id), person);
  for (const person of team?.people || []) if (person?.id && person.name) map.set(String(person.id), { ...map.get(String(person.id)), ...person });
  for (const id of [team?.ownerId, ...(team?.memberIds || []), ...Object.values(team?.approvers || {})]) {
    if (id && !map.has(String(id))) map.set(String(id), { id, name: personById(id)?.name || '未命名人员' });
  }
  return [...map.values()];
}
function renderProjectTeam(item) {
  const box = $('#project-team');
  if (!box || !item) return;
  clear(box);
  const team = item.team;
  const link = safeLink(item.chatLink);
  if (!team && !link && !item.dedicated) { box.hidden = true; return; }
  box.hidden = false;
  if (link) {
    const anchor = el('a', '进入飞书群');
    anchor.href = link;
    anchor.target = '_blank';
    anchor.rel = 'noopener';
    box.append(anchor);
  }
  if (item.dedicated) box.append(el('p', '独立项目群'));
  if (item.invitationWarning) box.append(el('p', `部分成员尚未入群：${item.invitationWarning}。处理审批或调整成员后，保存分工可重新邀请。`, 'flow-error'));
  if (!team) return;
  const people = assignmentPeople(team);
  const nameOf = id => personById(id, people)?.name || '未命名人员';
  box.append(el('h3', '项目成员'));
  box.append(el('p', `负责人：${team.ownerId ? nameOf(team.ownerId) : '未指定'}`));
  if (team.scope) box.append(el('p', `负责范围：${team.scope}`));
  box.append(el('p', `成员：${(team.memberIds || []).map(nameOf).join('、') || '未指定'}`));
  for (const [stage, label] of approvalStages) box.append(el('p', `${label}：${team.approvers?.[stage] ? nameOf(team.approvers[stage]) : '未指定'}`));
  if (app.team) {
    const edit = el('button', '调整分工');
    edit.type = 'button';
    edit.onclick = () => openProjectTeam(item);
    box.append(edit);
  }
}
function syncProjectTools(item) {
  const chat = $('#project-chat');
  const link = safeLink(item.chatLink);
  chat.hidden = !link;
  if (link) chat.href = link;
  const button = $('#project-team-open');
  button.hidden = !app.team;
  button.onclick = () => openProjectTeam(item);
}
function renderPrd(text, box) {
  clear(box);
  const paper = el('article', null, 'prd-paper');
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const trimmed = line.trim(), tag = trimmed.startsWith('# ') ? 'h1' : trimmed.startsWith('## ') ? 'h2' : 'p';
    paper.append(el(tag, tag === 'p' ? trimmed : trimmed.replace(/^#{1,2}\s+/, '')));
  }
  box.append(paper);
}
function artifactLink(item, key) { return key === 'prd' || key === 'context' ? null : key === 'walkthrough' ? `/p/${item.id}/walkthrough` : `${app.modelBase}/p/${item.id}/${key}`; }
function renderArtifact(item) {
  clear($('#artifact-tabs'));
  clear($('#artifact-content'));
  for (const [key, label] of artifactTabs) {
    const button = el('button', label, app.tab === key ? 'active' : '');
    button.type = 'button';
    button.onclick = () => setView('project', { id: item.id, tab: key });
    $('#artifact-tabs').append(button);
  }
  const link = artifactLink(item, app.tab);
  $('#artifact-open').hidden = !link || !item.artifacts?.[app.tab];
  if (link) $('#artifact-open').href = link;
  if (app.tab === 'context') {
    const box = $('#artifact-content');
    box.append(el('div', '正在读取讨论…', 'empty-artifact'));
    const projectId = item.id;
    fetch(`/api/context?${params({ projectId })}`).then(async response => {
      const text = await response.text();
      if (app.view !== 'project' || app.project !== projectId || app.tab !== 'context') return;
      if (!response.ok) {
        clear(box);
        box.append(el('div', text && !text.includes('<') ? text.slice(0, 200) : '讨论尚未生成', 'empty-artifact'));
        return;
      }
      if (!text.trim()) { clear(box); box.append(el('div', '暂无项目讨论', 'empty-artifact')); return; }
      renderPrd(text, box);
    }).catch(() => { if (app.view === 'project' && app.project === projectId && app.tab === 'context') $('#artifact-content').textContent = '讨论读取失败'; });
    return;
  }
  if (!item.artifacts?.[app.tab]) { $('#artifact-content').append(el('div', '产物尚未生成', 'empty-artifact')); return; }
  if (app.tab === 'prd') {
    const box = $('#artifact-content');
    box.append(el('div', '正在读取 PRD…', 'empty-artifact'));
    fetch(`/api/prd?${params({ projectId: item.id })}`).then(response => response.text()).then(text => { if (app.view === 'project' && app.project === item.id && app.tab === 'prd') renderPrd(text, box); }).catch(() => { box.textContent = 'PRD 读取失败'; });
  } else {
    const frame = el('iframe');
    frame.title = `${item.name} ${app.tab}`;
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    frame.src = link;
    $('#artifact-content').append(frame);
  }
}
function renderMessage(event) {
  const view = messageView(event);
  if (!view) return null;
  const user = view.user, role = event.role || 'product', row = el('div', null, `message ${user ? 'user' : ''}`), content = el('div', null, 'message-content');
  const who = user ? speakerName(event) : (names[role] || '系统');
  row.append(user ? personAvatar(who) : avatar(role));
  content.append(el('div', `${who}${event.source ? ` ${event.source}` : ''}${event.at ? ` · ${new Date(event.at).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' })}` : ''}${event.updatedAt ? ' · 已更新' : ''}`, 'message-meta'));
  if (view.type === 'text') { content.append(el('div', view.text, 'bubble')); row.append(content); return row; }
  const card = view.card, box = el('div', null, 'card-box');
  box.style.setProperty('--role-color', card.color === 'purple' ? colors.designer : card.color === 'green' ? colors.developer : colors[role] || colors.product);
  box.append(el('div', card.title, 'card-title'));
  const body = el('div', null, 'card-body');
  (card.text || []).forEach((line, index) => { if (index === 1) body.append(el('hr')); if (line) body.append(el('p', line)); });
  if (card.imageUrl) {
    const img = el('img', null, 'card-preview');
    img.alt = '页面一览';
    img.src = card.imageUrl;
    img.onerror = () => {
      img.remove();
      const source = card.links?.find(link => /结构图|线框|网页|走查/.test(link.label));
      if (source) {
        const frame = el('iframe', null, 'card-preview-frame');
        frame.title = '页面预览';
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.src = source.url;
        body.insertBefore(frame, body.querySelector('.card-actions'));
      }
    };
    body.append(img);
  }
  const formValue = {};
  for (const question of card.questions || []) {
    const label = el('label', question.id, 'question'), select = el('select');
    question.options.forEach((choice, index) => { const choiceNode = el('option', choice); choiceNode.value = String(index); select.append(choiceNode); });
    select.value = String(question.recommended);
    formValue[question.id] = select.value;
    select.onchange = () => formValue[question.id] = select.value;
    label.append(select);
    body.append(label);
  }
  if (card.extra) { const textarea = el('textarea'); textarea.placeholder = '其他补充'; textarea.oninput = () => formValue[card.extra] = textarea.value; body.append(textarea); }
  const actions = el('div', null, 'card-actions');
  for (const link of card.links || []) { const anchor = el('a', `${link.label} ↗`); anchor.href = link.url; anchor.target = '_blank'; anchor.rel = 'noopener'; actions.append(anchor); }
  for (const choice of card.buttons || []) {
    if (!choice.value) continue;
    const button = el('button', choice.label, ['confirm', 'answer', 'retry', 'start', 'revise', 'steer'].includes(choice.value.action) ? 'confirm' : ['reject', 'end', 'stop'].includes(choice.value.action) ? 'reject' : '');
    button.onclick = async () => { try { const result = await post('/api/action', { chatId: event.chatId, role: event.role, value: choice.value, formValue }); notice(result.toast?.content || '已提交'); await refresh(); } catch (error) { notice(error.message); } };
    actions.append(button);
  }
  body.append(actions);
  box.append(body);
  content.append(box);
  row.append(content);
  return row;
}
async function loadMessages({ chatId, projectId, role, target }) {
  const box = $(target);
  if (!chatId) { clear(box); return; }
  try {
    const values = { chatId, ...(projectId ? { projectId } : {}), ...(role ? { role } : {}) }, events = await json(`/api/messages?${params(values)}`);
    if (target === '#project-messages' && app.project !== projectId) return;
    clear(box);
    for (const event of latestCards(events)) { const row = renderMessage(event); if (row) box.append(row); }
    box.scrollTop = box.scrollHeight;
    if (target === '#project-messages') { const current = project(projectId); if (current) $('#demand-original').textContent = originalDemand(current, events); $('#message-count').textContent = `${events.length} 条`; }
  } catch (error) { box.textContent = `消息读取失败：${error.message}`; }
}
function renderProject() {
  const current = project(app.project);
  if (!current) { setView('board'); return; }
  renderFlow(current);
  renderProjectTeam(current);
  syncProjectTools(current);
  renderArtifact(current);
  $('#project-form').hidden = !isCurrent(current);
  void loadMessages({ chatId: current.chatId, projectId: current.id, target: '#project-messages' });
}
function renderRoles() {
  clear($('#role-list'));
  for (const role of Object.keys(names)) {
    const button = el('button', null, `role-choice ${app.role === role ? 'active' : ''}`), detail = el('span'), mode = colleagueMode(role);
    detail.append(el('strong', names[role]), el('small', colleagueText(role)));
    button.append(avatar(role, mode), detail);
    button.onclick = () => setView('roles', { role });
    $('#role-list').append(button);
  }
  clear($('#role-header'));
  const mode = colleagueMode(app.role), identity = el('div', null, 'identity'), detail = el('div');
  detail.append(el('strong', names[app.role]), el('small', colleagueText(app.role)));
  identity.append(avatar(app.role, mode), detail);
  $('#role-header').append(identity);
  const candidates = app.state.projects.filter(item => active(item) && isCurrent(item));
  if (app.roleProject !== 'new' && !candidates.some(item => item.id === app.roleProject)) app.roleProject = defaultRoleProject(candidates, app.role);
  if (app.role !== 'product' && app.roleProject === 'new') app.roleProject = defaultRoleProject(candidates, app.role);
  const select = $('#role-project');
  clear(select);
  if (app.role === 'product') { const choice = el('option', '新需求'); choice.value = 'new'; select.append(choice); }
  for (const item of candidates) { const choice = el('option', `#${item.number} ${item.name} · ${item.source}`); choice.value = item.id; select.append(choice); }
  if (app.roleProject) select.value = app.roleProject;
  const updateCompose = () => {
    const current = project(app.roleProject), disabled = !(candidates.length || (app.role === 'product' && app.roleProject === 'new'));
    $('#role-project-hint').textContent = app.roleProject === 'new' ? roleProjectHint(null, app.role) : current ? roleProjectHint(current, app.role) : '';
    $('#role-input').disabled = disabled;
    $('#role-form button').disabled = disabled;
    $('#role-input').placeholder = disabled ? '暂时没有进行中的项目' : `对 ${names[app.role]}说…（Enter 发送）`;
  };
  select.onchange = () => { app.roleProject = select.value; updateCompose(); };
  updateCompose();
  void loadRoleMessages();
}
function eventKey(event) {
  if (event.messageId) return `${event.kind}:${event.messageId}:${event.at || ''}`;
  return [event.at, event.kind, event.role || '', event.action || '', event.text || '', event.actor || '', event.userName || ''].join('|');
}
const isOrdinaryDiscussion = event => event?.kind === 'user' && !names[event.role];
async function loadRoleMessages() {
  const role = app.role, request = app.roleMessageRequest = (app.roleMessageRequest || 0) + 1, box = $('#role-messages');
  const projects = app.state.projects.filter(item => item.chatId);
  try {
    const batches = await Promise.all(projects.map(async item => {
      const events = await json(`/api/messages?${params({ projectId: item.id, role })}`);
      let ordinary = [];
      try {
        const all = await json(`/api/messages?${params({ projectId: item.id })}`);
        const seen = new Set(events.map(eventKey));
        ordinary = all.filter(event => isOrdinaryDiscussion(event) && !seen.has(eventKey(event)));
      } catch { /* 角色过滤结果仍可用 */ }
      return latestCards([...events, ...ordinary]).map(event => ({ ...event, projectId: item.id, projectNumber: item.number, projectName: item.name }));
    }));
    if (app.view !== 'roles' || app.role !== role || app.roleMessageRequest !== request) return;
    clear(box);
    for (const item of roleTimeline(batches.flat().filter(event => messageView(event)))) {
      box.append(item.kind === 'project_separator' ? el('div', `#${item.projectNumber} ${item.projectName}`, 'project-separator') : renderMessage(item));
    }
    if (!box.childNodes.length) box.append(el('div', '暂无消息', 'empty-artifact'));
    box.scrollTop = box.scrollHeight;
  } catch (error) { if (app.view === 'roles' && app.role === role && app.roleMessageRequest === request) box.textContent = `消息读取失败：${error.message}`; }
}
function teamFormBusy() {
  if ($('#person-dialog')?.open) return true;
  const node = document.activeElement;
  return Boolean(node && node.closest && node.closest('#team-view') && ['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName));
}
function approvalText(list) {
  const labels = approvalStages.filter(([stage]) => (list || []).includes(stage)).map(([, label]) => label);
  return labels.length ? labels.join('、') : '未勾选确认事项';
}
function renderTeam() {
  const side = $('#team-side'), list = $('#people-list');
  if (!side || !list) return;
  if (teamFormBusy()) { app.teamStale = true; return; }
  app.teamStale = false;
  const previousOperator = $('#operator-select')?.value ?? '';
  const previousChat = $('#import-chat')?.value ?? '';
  clear(side);
  clear(list);
  if (app.teamMissing || !app.team) {
    $('#person-add').disabled = true;
    list.append(el('div', app.teamMissing ? '当前服务没有人员名册。看板、项目和聊天仍按原来的方式使用。' : (app.teamError || '人员名册暂时读不出来。'), 'empty'));
    return;
  }
  $('#person-add').disabled = false;
  const operator = el('section', null, 'team-block');
  operator.append(el('h2', '本机操作者'));
  operator.append(el('p', '本机操作统一用此人的身份。飞书操作按实际登录账号校验。', 'muted'));
  const currentOperator = personById(app.team.ownerId);
  operator.append(el('p', currentOperator ? `当前：${currentOperator.name}` : '尚未设置'));
  const operatorSelect = el('select');
  operatorSelect.id = 'operator-select';
  operatorSelect.append(optionNode('选择人员', ''));
  for (const person of [...roster()].sort((left, right) => Number(left.active === false) - Number(right.active === false))) {
    operatorSelect.append(optionNode(person.active === false ? `${person.name}（已停用）` : person.name, String(person.id)));
  }
  const operatorValue = previousOperator || (app.team.ownerId ? String(app.team.ownerId) : '');
  if ([...operatorSelect.options].some(item => item.value === operatorValue)) operatorSelect.value = operatorValue;
  const operatorButton = el('button', '设为本机操作者', 'primary');
  operatorButton.type = 'button';
  operatorButton.onclick = () => saveOperator(operatorSelect.value, operatorButton);
  operator.append(operatorSelect, operatorButton);
  const importer = el('section', null, 'team-block');
  importer.append(el('h2', '从飞书群导入'));
  importer.append(el('p', app.team.feishuAvailable === true ? '导入群里的真人成员。机器人不会当作人员导入。' : '飞书未连接，暂时不能从群里导入。', 'muted'));
  const chatSelect = el('select');
  chatSelect.id = 'import-chat';
  chatSelect.append(optionNode('选择飞书群', ''));
  for (const chat of app.chats || []) {
    if (!chat?.chat_id) continue;
    chatSelect.append(optionNode(chat.name || '未命名群', String(chat.chat_id)));
  }
  if ([...chatSelect.options].some(item => item.value === previousChat)) chatSelect.value = previousChat;
  const importButton = el('button', '导入群成员');
  importButton.type = 'button';
  importButton.disabled = app.team.feishuAvailable !== true || chatSelect.options.length < 2;
  importButton.onclick = () => importMembers(chatSelect.value, importButton);
  importer.append(chatSelect, importButton);
  importer.append(el('p', '没有飞书身份的人员可以手工新增，用于本机项目。这里不填写用户 ID。', 'muted'));
  side.append(operator, importer);
  if (!roster().length) list.append(el('div', '还没有人员。可以新增，或从飞书群导入。', 'empty'));
  for (const person of roster()) {
    const card = el('article', null, `person-card ${person.active === false ? 'inactive' : ''}`), top = el('div', null, 'person-top'), title = el('div');
    title.append(el('strong', person.name));
    const badges = el('div', null, 'tags');
    if (person.active === false) badges.append(el('span', '已停用', 'tag'));
    if (sameId(person.id, app.team.ownerId)) badges.append(el('span', '本机操作者', 'tag'));
    const bound = identityLabel(person.identity);
    if (bound) badges.append(el('span', bound, 'tag feishu'));
    title.append(badges);
    const actions = el('div', null, 'person-actions');
    const edit = el('button', '编辑');
    edit.type = 'button';
    edit.onclick = () => openPerson(person);
    const toggle = el('button', person.active === false ? '启用' : '停用');
    toggle.type = 'button';
    toggle.onclick = () => setPersonActive(person, person.active === false, toggle);
    actions.append(edit, toggle);
    top.append(title, actions);
    card.append(top);
    const duties = person.responsibilities || [];
    if (!duties.length) card.append(el('div', '还没有岗位', 'muted'));
    for (const duty of duties) {
      const block = el('div', null, 'duty');
      block.append(el('b', duty.job || '未填岗位'), document.createTextNode(` · ${duty.scope || '未填范围'}`), el('div', approvalText(duty.approvals), 'muted'));
      card.append(block);
    }
    list.append(card);
  }
}
function addDutyRow(duty = {}) {
  const row = el('div', null, 'duty-row');
  const known = new Set(approvalStages.map(([stage]) => stage));
  row._extraApprovals = (duty.approvals || []).filter(stage => !known.has(stage));
  const job = el('input');
  job.placeholder = '岗位';
  job.maxLength = 40;
  job.value = duty.job || '';
  job.className = 'duty-job';
  const scope = el('input');
  scope.placeholder = '负责范围';
  scope.maxLength = 80;
  scope.value = duty.scope || '';
  scope.className = 'duty-scope';
  const checks = el('div', null, 'duty-checks');
  for (const [stage, label] of approvalStages) {
    const labelNode = document.createElement('label');
    labelNode.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = stage;
    input.checked = (duty.approvals || []).includes(stage);
    labelNode.append(input, document.createTextNode(label));
    checks.append(labelNode);
  }
  const remove = el('button', '删除');
  remove.type = 'button';
  remove.onclick = () => { if ($('#duty-rows').children.length > 1) row.remove(); };
  row.append(job, scope, checks, remove);
  $('#duty-rows').append(row);
}
function openPerson(person) {
  app.editingPersonId = person?.id ?? null;
  app.editingIdentity = person?.identity && typeof person.identity === 'object' ? person.identity : null;
  $('#person-title').textContent = person ? '编辑人员' : '新增人员';
  $('#person-name').value = person?.name || '';
  $('#person-active').checked = person ? person.active !== false : true;
  $('#person-identity').textContent = identityLabel(app.editingIdentity);
  clear($('#duty-rows'));
  const duties = person?.responsibilities?.length ? person.responsibilities : [{}];
  for (const duty of duties) addDutyRow(duty);
  $('#person-dialog').showModal();
}
function collectPerson() {
  const responsibilities = [...$('#duty-rows').children].map(row => {
    const job = row.querySelector('.duty-job')?.value.trim() || '';
    const scope = row.querySelector('.duty-scope')?.value.trim() || '';
    const approvals = [...row.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
    return { job, scope, approvals: [...approvals, ...(row._extraApprovals || [])] };
  }).filter(duty => duty.job || duty.scope || duty.approvals.length);
  const body = { name: $('#person-name').value.trim(), active: $('#person-active').checked, responsibilities };
  if (app.editingPersonId) body.id = app.editingPersonId;
  if (app.editingIdentity) body.identity = app.editingIdentity;
  return body;
}
async function saveOperator(ownerId, button) {
  if (!ownerId) { notice('请选择本机操作者'); return; }
  const person = personById(ownerId);
  if (!person) { notice('找不到这个人员'); return; }
  if (button.dataset.busy === '1') return;
  button.dataset.busy = '1';
  button.disabled = true;
  try {
    await post('/api/team/settings', { ownerId: person.id });
    notice(`本机操作者已设为${person.name}`);
    await refresh();
  } catch (error) { notice(error.message); }
  finally { button.disabled = false; delete button.dataset.busy; }
}
async function importMembers(chatId, button) {
  if (!chatId) { notice('请选择飞书群'); return; }
  if (app.team?.feishuAvailable !== true) { notice('飞书未连接，不能导入群成员'); return; }
  if (button.dataset.busy === '1') return;
  button.dataset.busy = '1';
  button.disabled = true;
  try {
    const result = await post('/api/team/import', { chatId });
    if (!result || !Array.isArray(result.people)) throw Error('导入结果不正确');
    app.team = result;
    app.teamMissing = false;
    notice('已导入群成员');
    renderTeam();
    await refresh();
  } catch (error) { notice(error.message); }
  finally { button.disabled = app.team?.feishuAvailable !== true; delete button.dataset.busy; }
}
async function setPersonActive(person, activeState, button) {
  if (button.dataset.busy === '1') return;
  button.dataset.busy = '1';
  button.disabled = true;
  try {
    const body = { id: person.id, name: person.name, active: activeState, responsibilities: person.responsibilities || [] };
    if (person.identity) body.identity = person.identity;
    await post('/api/team/person', body);
    notice(activeState ? '已启用' : '已停用');
    await refresh();
  } catch (error) { notice(error.message); button.disabled = false; }
  finally { delete button.dataset.busy; }
}
function checkedValues(root) { return [...root.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value); }
function fillPeopleSelect(select, people, selected, blankLabel) {
  const previous = selected ?? select.value;
  clear(select);
  if (blankLabel !== undefined) select.append(optionNode(blankLabel, ''));
  for (const person of people) select.append(optionNode(personOptionLabel(person), String(person.id)));
  if ([...select.options].some(item => item.value === String(previous ?? ''))) select.value = String(previous ?? '');
}
function fillDemandPeople() {
  const people = activePeople();
  fillPeopleSelect($('#demand-owner'), people, $('#demand-owner').value, '自动匹配');
  const members = $('#demand-members');
  const checked = new Set(checkedValues(members));
  clear(members);
  members.append(el('p', '成员，不勾选则自动匹配', 'muted'));
  for (const person of people) {
    const label = document.createElement('label');
    label.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = String(person.id);
    input.checked = checked.has(String(person.id));
    label.append(input, document.createTextNode(personOptionLabel(person)));
    members.append(label);
  }
  const approvers = $('#demand-approvers');
  const previous = Object.fromEntries(approvalStages.map(([stage]) => [stage, $(`#demand-approver-${stage}`)?.value || '']));
  clear(approvers);
  approvers.append(el('p', '确认人，不选则自动匹配', 'muted'));
  for (const [stage, label] of approvalStages) {
    const field = el('label', label);
    const select = el('select');
    select.id = `demand-approver-${stage}`;
    fillPeopleSelect(select, people, previous[stage], '自动匹配');
    field.append(select);
    approvers.append(field);
  }
}
function fillDemandForm() {
  const extra = $('#demand-extra');
  const team = app.teamMissing ? null : app.team;
  extra.hidden = !team;
  if (!team) {
    $('#demand-hint').textContent = '群聊空闲时发给最近使用的群；群聊忙时在工作台单独开始。';
    return;
  }
  const online = team.feishuAvailable === true;
  $('#demand-hint').textContent = online ? '默认新建飞书项目群。人员留空则按负责范围匹配，未匹配的确认事项交给项目负责人。' : '飞书未连接，这次会创建本机项目。人员留空则按负责范围匹配，未匹配的确认事项交给项目负责人。';
  $('#channel-feishu').disabled = !online;
  $('#channel-feishu').checked = online;
  $('#channel-local').checked = !online;
  $('#channel-note').textContent = online ? '每个需求单独建群。提交失败再点一次会用同一次请求，避免重复建群。' : '连接飞书后可以改为新建项目群。';
  fillDemandPeople();
}
function openDemand() {
  const dialog = $('#demand-dialog');
  if (!dialog.open) fillDemandForm();
  dialog.showModal();
}
function demandBody() {
  // 同一次需求失败重试沿用 requestId，避免重复建群。
  const body = { text: $('#demand-text').value.trim() };
  const withRequest = () => {
    const fingerprint = JSON.stringify(body);
    if (!app.demandRequestId || app.demandFingerprint !== fingerprint) app.demandRequestId = crypto.randomUUID();
    app.demandFingerprint = fingerprint;
    return { ...body, requestId: app.demandRequestId };
  };
  if ($('#demand-extra').hidden || !app.team) return withRequest();
  const name = $('#demand-name').value.trim();
  const scope = $('#demand-scope').value.trim();
  if (name) body.name = name;
  if (scope) body.scope = scope;
  body.channel = app.team.feishuAvailable === true && $('#channel-feishu').checked ? 'feishu' : 'local';
  const owner = personById($('#demand-owner').value, activePeople());
  if (owner) body.ownerId = owner.id;
  const memberIds = checkedValues($('#demand-members')).map(value => personById(value, activePeople())?.id).filter(Boolean);
  if (memberIds.length) body.memberIds = memberIds;
  const approvers = {};
  for (const [stage] of approvalStages) {
    const picked = personById($(`#demand-approver-${stage}`)?.value, activePeople());
    if (picked) approvers[stage] = picked.id;
  }
  if (Object.keys(approvers).length) body.approvers = approvers;
  return withRequest();
}
function memberChecklist(root, people, selected) {
  clear(root);
  const chosen = new Set((selected || []).map(id => String(id)));
  if (!people.length) { root.append(el('p', '名册是空的，请先新增人员。', 'muted')); return; }
  for (const person of people) {
    const label = document.createElement('label');
    label.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = String(person.id);
    input.checked = chosen.has(String(person.id));
    label.append(input, document.createTextNode(personOptionLabel(person)));
    root.append(label);
  }
}
function openProjectTeam(item) {
  const dialog = $('#project-team-dialog');
  if (!app.team) { notice('当前服务没有人员名册'); return; }
  if (dialog.open) return;
  app.projectTeamId = item.id;
  const people = assignmentPeople(item.team);
  const operator = personById(app.team.ownerId);
  $('#project-team-hint').textContent = operator ? `本机管理员可以调整项目成员和确认人；飞书卡片仍按指定人员校验。` : '请先在人员与职责里设置本机操作者。';
  $('#project-team-scope').textContent = item.team?.scope ? `负责范围：${item.team.scope}` : '';
  fillPeopleSelect($('#project-owner'), people, item.team?.ownerId || app.team.ownerId || '', '选择负责人');
  memberChecklist($('#project-members'), people, item.team?.memberIds || []);
  const approvers = $('#project-approvers');
  clear(approvers);
  for (const [stage, label] of approvalStages) {
    const field = el('label', label);
    const select = el('select');
    select.dataset.stage = stage;
    fillPeopleSelect(select, people, item.team?.approvers?.[stage] || '', '选择确认人');
    field.append(select);
    approvers.append(field);
  }
  $('#project-team-save').disabled = !app.team.ownerId || !people.length;
  dialog.showModal();
}
function render() {
  for (const view of ['board', 'project', 'roles', 'team']) $('#' + view + '-view').hidden = app.view !== view;
  header();
  if (app.view === 'board') renderBoard();
  else if (app.view === 'project') renderProject();
  else if (app.view === 'roles') renderRoles();
  else renderTeam();
}
async function refresh() {
  if (app.refreshing) { app.refreshQueued = true; return; }
  app.refreshing = true;
  try {
    const [state, chats, config, team] = await Promise.all([
      json('/api/state'),
      json('/api/chats').catch(() => []),
      json('/api/config').catch(() => ({})),
      loadTeam(),
    ]);
    app.state = state;
    app.chats = Array.isArray(chats) ? chats : [];
    app.modelBase = config.modelBase || app.modelBase;
    // 旧版冒烟服务没有 /api/team，404 时保持原来的工作台。
    if (team.missing) { app.team = null; app.teamMissing = true; app.teamError = ''; }
    else if (team.value) { app.team = team.value; app.teamMissing = false; app.teamError = ''; }
    else if (team.error && team.error !== app.teamError) { app.teamError = team.error; notice(team.error); }
    if ($('#demand-dialog')?.open && $('#demand-extra')?.hidden && app.team && !app.teamMissing) fillDemandForm();
    $('#sync-label').textContent = '飞书同步中';
    $('.sync').classList.remove('offline');
    render();
  } catch (error) {
    $('#sync-label').textContent = '工作台服务连不上';
    $('.sync').classList.add('offline');
    notice(`状态读取失败：${error.message}`);
  } finally {
    app.refreshing = false;
    if (app.refreshQueued) { app.refreshQueued = false; void refresh(); }
  }
}
$('#back').onclick = () => setView('board');
$('#team-entry').onclick = () => setView('team');
$('#new-demand').onclick = () => openDemand();
$('#demand-cancel').onclick = () => $('#demand-dialog').close();
$('#demand-form').onsubmit = async event => {
  event.preventDefault();
  const button = $('#demand-submit');
  if (button.dataset.busy === '1') return;
  const body = demandBody();
  if (!body.text) { notice('请填写需求'); return; }
  button.dataset.busy = '1';
  button.disabled = true;
  try {
    const result = await post('/api/demand', body);
    app.demandRequestId = null;
    $('#demand-text').value = '';
    $('#demand-name').value = '';
    $('#demand-scope').value = '';
    $('#demand-dialog').close();
    notice(`需求已提交 · ${result.source || ''}`);
    await refresh();
    if (result.projectId) setView('project', { id: result.projectId });
  } catch (error) { notice(error.message); }
  finally { button.disabled = false; delete button.dataset.busy; }
};
$('#project-form').onsubmit = async event => {
  event.preventDefault();
  const text = $('#project-input').value.trim(), current = project(app.project);
  if (!text || !current) return;
  const button = $('#project-form button');
  if (button.dataset.busy === '1') return;
  button.dataset.busy = '1';
  button.disabled = true;
  try { await post('/api/message', { chatId: current.chatId, role: $('#project-role').value, text }); $('#project-input').value = ''; notice('消息已发送'); await refresh(); }
  catch (error) { notice(error.message); }
  finally { button.disabled = false; delete button.dataset.busy; }
};
$('#role-form').onsubmit = async event => {
  event.preventDefault();
  const text = $('#role-input').value.trim(), current = project(app.roleProject), button = $('#role-form button');
  if (!text || button.disabled || button.dataset.busy === '1') return;
  button.dataset.busy = '1';
  button.disabled = true;
  try {
    if ($('#role-project').value === 'new') {
      if (!app.roleDemandRequestId || app.roleDemandText !== text) app.roleDemandRequestId = crypto.randomUUID();
      app.roleDemandText = text;
      const result = await post('/api/demand', { text, requestId: app.roleDemandRequestId });
      app.roleDemandRequestId = null;
      app.roleProject = result.projectId;
      notice(`需求已提交 · ${result.source || ''}`);
    } else {
      if (!current) return;
      await post('/api/message', { chatId: current.chatId, role: app.role, text });
      notice('消息已发送');
    }
    $('#role-input').value = '';
    await refresh();
  } catch (error) { notice(error.message); }
  finally { button.disabled = $('#role-input').disabled; delete button.dataset.busy; }
};
for (const form of ['#project-form', '#role-form']) $(form + ' textarea').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $(form).requestSubmit(); } };
$('#person-add').onclick = () => { if (!app.team) { notice(app.teamMissing ? '当前服务没有人员名册' : '人员名册还没读出来'); return; } openPerson(null); };
$('#duty-add').onclick = () => addDutyRow();
$('#person-cancel').onclick = () => $('#person-dialog').close();
$('#person-form').onsubmit = async event => {
  event.preventDefault();
  const button = $('#person-form button.primary');
  if (button.dataset.busy === '1') return;
  const body = collectPerson();
  if (!body.name) { notice('请填写姓名'); return; }
  button.dataset.busy = '1';
  button.disabled = true;
  try {
    await post('/api/team/person', body);
    $('#person-dialog').close();
    notice(body.id ? '人员已保存' : '人员已添加');
    await refresh();
  } catch (error) { notice(error.message); }
  finally { button.disabled = false; delete button.dataset.busy; }
};
$('#person-dialog').addEventListener('close', () => { if (app.teamStale && app.view === 'team') renderTeam(); });
$('#project-team-cancel').onclick = () => $('#project-team-dialog').close();
$('#project-team-form').onsubmit = async event => {
  event.preventDefault();
  const button = $('#project-team-save');
  if (button.dataset.busy === '1') return;
  if (!app.team?.ownerId) { notice('请先设置本机操作者'); return; }
  const current = project(app.projectTeamId);
  if (!current) { notice('找不到这个项目'); return; }
  const people = assignmentPeople(current.team);
  const owner = personById($('#project-owner').value, people);
  if (!owner) { notice('请选择项目负责人'); return; }
  const approvers = {};
  for (const select of $('#project-approvers').querySelectorAll('select')) {
    const picked = personById(select.value, people);
    if (!picked) { notice('请为每个关口选择确认人'); return; }
    approvers[select.dataset.stage] = picked.id;
  }
  const memberIds = [...new Set([
    owner.id,
    ...checkedValues($('#project-members')).map(value => personById(value, people)?.id).filter(Boolean),
    ...Object.values(approvers),
  ])];
  button.dataset.busy = '1';
  button.disabled = true;
  try {
    const result = await post('/api/team/project', { projectId: current.id, ownerId: owner.id, memberIds, approvers });
    if (result?.team) current.team = result.team;
    $('#project-team-dialog').close();
    notice('项目分工已保存');
    await refresh();
  } catch (error) { notice(error.message); }
  finally { button.disabled = false; delete button.dataset.busy; }
};
document.addEventListener('focusout', event => {
  if (!app.teamStale || app.view !== 'team') return;
  const next = event.relatedTarget;
  if (next && next.closest && next.closest('#team-view') && ['INPUT', 'SELECT', 'TEXTAREA'].includes(next.tagName)) return;
  setTimeout(() => { if (!teamFormBusy() && app.view === 'team') renderTeam(); }, 0);
});
$('#role-source').onclick = async () => {
  try {
    const source = await json(`/api/role?${params({ role: app.role })}`);
    $('#source-title').textContent = `${source.role} · 角色说明与技能`;
    $('#source-content').textContent = `【角色说明】\n${source.prompt}\n\n` + source.skills.map(skill => `【技能：${skill.name}】\n${skill.text}`).join('\n\n');
    $('#source-dialog').showModal();
  } catch (error) { notice(error.message); }
};
$('#source-close').onclick = () => $('#source-dialog').close();
$('#source-copy').onclick = async () => { try { await navigator.clipboard.writeText($('#source-content').textContent); notice('已复制'); } catch { notice('复制失败'); } };
function readHash() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('view') === 'project') { app.view = 'project'; app.project = hash.get('project'); app.tab = hash.get('tab') || 'prd'; }
  else if (hash.get('view') === 'roles') { app.view = 'roles'; app.role = names[hash.get('role')] ? hash.get('role') : 'designer'; app.roleProject = hash.get('project'); }
  else app.view = hash.get('view') === 'team' ? 'team' : 'board';
}
readHash();
window.addEventListener('hashchange', () => { readHash(); render(); });
await refresh();
if (new URLSearchParams(location.search).has('capture')) {
  if (app.view === 'project') {
    const current = project(app.project);
    if (current) await loadMessages({ chatId: current.chatId, projectId: current.id, target: '#project-messages' });
    const frame = $('#artifact-content iframe');
    if (frame) await Promise.race([new Promise(resolve => frame.addEventListener('load', resolve, { once: true })), new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  if (app.view === 'roles') await loadRoleMessages();
  await new Promise(resolve => setTimeout(resolve, 300));
} else {
  const stream = new EventSource('/api/events');
  stream.addEventListener('change', () => { void refresh(); });
  stream.onerror = () => { setTimeout(() => void refresh(), 4000); };
}
