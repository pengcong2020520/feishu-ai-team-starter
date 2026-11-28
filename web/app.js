import { names, glyph, stageNames, columns, stepDefs, stageIndex, timeSince, waitSince, flowStatus, roleForProject, artifactStep, defaultRoleProject, roleProjectHint, roleTimeline, messageView, originalDemand, latestCards, speakerName } from './presentation.mjs';
const $ = selector => document.querySelector(selector);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined && text !== null) node.textContent = text; if (className) node.className = className; return node; };
const clear = node => node.replaceChildren();
const optionNode = (label, value) => { const node = el('option', label); node.value = value; return node; };
const colors = { product: '#3B82F6', designer: '#A86BF7', developer: '#2FBF71' };
const tabs = [['prd','PRD'],['wireframe','线框'],['site','网页'],['walkthrough','走查页']];
const artifactTabs = [...tabs, ['context','讨论']];
const app = { state:{ groups:{},projects:[],colleagues:{} }, chats:[], view:'board', project:null, tab:'prd', role:'designer', roleProject:null, modelBase:'http://127.0.0.1:4871', refreshing:false, demandRequestId:null, roleDemandRequestId:null };
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
  for (const [title, stages] of [...columns, ['团队协作', null]]) {
    const items = app.state.projects.filter(item => stages ? !item.package && stages.includes(item.stage) : Boolean(item.package)), column = el('div', null, 'column'), head = el('div', null, 'column-head'), body = el('div', null, 'column-body');
    head.append(el('span',title),el('span',String(items.length),'column-count'));
    column.append(head, body);
    if (!items.length) body.append(el('div', title === '澄清与 PRD' ? '点右上角「+ 提需求」开始' : '暂无', 'empty'));
    for (const item of items) {
      const waiting = item.queuedForAgent !== true && item.waitingFor;
      const card = el('button', null, `project-card ${waiting ? 'is-waiting' : ''} ${item.queuedForAgent === true ? 'is-queued' : ''} ${item.stage === 'done' ? 'compact' : ''}`), top = el('div', null, 'card-top');
      top.append(el('span', `#${item.number} ${item.name}`, 'project-name'), el('span', timeSince(item.createdAt), 'project-time'));
      card.append(top);
      if (item.package) { card.append(el('div', item.packageName, 'card-status'), el('div', item.error || item.activity || item.stageName, 'card-status')); card.onclick = () => { location.href = '/teams#' + item.id; }; body.append(card); continue; }
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
function syncProjectTools(item) {
  const chat = $('#project-chat');
  const link = safeLink(item.chatLink);
  chat.hidden = !link;
  if (link) chat.href = link;

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
function openDemand() { $('#demand-dialog').showModal(); }
function render() {
  for (const view of ['board', 'project', 'roles']) $('#' + view + '-view').hidden = app.view !== view;
  header();
  if (app.view === 'board') renderBoard();
  else if (app.view === 'project') renderProject();
  else if (app.view === 'roles') renderRoles();
}
async function refresh() {
  if (app.refreshing) { app.refreshQueued = true; return; }
  app.refreshing = true;
  try {
    const [state, chats, config] = await Promise.all([
      json('/api/state'),
      json('/api/chats').catch(() => []),
      json('/api/config').catch(() => ({})),
    ]);
    app.state = state;
    app.chats = Array.isArray(chats) ? chats : [];
    app.modelBase = config.modelBase || app.modelBase;
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
$('#new-demand').onclick = () => openDemand();
$('#demand-cancel').onclick = () => $('#demand-dialog').close();
$('#demand-form').onsubmit = async event => {
  event.preventDefault();const button=$('#demand-submit');if(button.disabled)return;button.disabled=true;
  try { const text=$('#demand-text').value.trim(); if(app.demandText!==text){app.demandRequestId=crypto.randomUUID();app.demandText=text;}
    const result=await post('/api/demand',{text,requestId:app.demandRequestId});$('#demand-text').value='';app.demandText=null;$('#demand-dialog').close();await refresh();if(result.projectId)setView('project',{id:result.projectId});
  } catch(error){notice(error.message);}finally{button.disabled=false;}
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
  else app.view = 'board';
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
