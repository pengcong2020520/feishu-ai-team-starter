export const names = { product: 'AI 产品经理', designer: 'AI 设计', developer: 'AI 程序员' };
export const glyph = { product: '产', designer: '设', developer: '程', user: '你' };
export const stageNames = {
  idle: '待开始', clarifying: '澄清需求', confirm_prd: '确认 PRD', revise_prd: '修改 PRD',
  designing: '设计中', confirm_design: '确认设计', revise_design: '修改设计',
  building: '开发中', revise_build: '修改网页', walkthrough: '走查中',
  accept: '待验收', done: '已完成',
};
export const columns = [
  ['澄清与 PRD', ['idle', 'clarifying', 'confirm_prd', 'revise_prd']],
  ['线框与主题', ['designing', 'confirm_design', 'revise_design']],
  ['开发', ['building', 'revise_build']],
  ['走查', ['walkthrough']],
  ['验收', ['accept']],
  ['已完成', ['done']],
];
export const stepDefs = columns.slice(0, 5).map(([name, stages], index) => ({
  name, stages, role: ['product', 'designer', 'developer', 'designer', 'user'][index],
}));
export const stageIndex = stage => stepDefs.findIndex(step => step.stages.includes(stage));
export const roleForProject = project => project.activeRole || stepDefs[stageIndex(project.stage)]?.role || null;
export const artifactStep = { prd: 0, wireframe: 1, site: 2, walkthrough: 3 };
export const defaultRoleProject = (projects, role) => projects.find(project => roleForProject(project) === role)?.id ?? projects[0]?.id ?? (role === 'product' ? 'new' : null);
export const roleProjectHint = (project, role) => !project ? '会开一个新项目' : roleForProject(project) === role ? '' : `#${project.number} 现在由 ${names[roleForProject(project)] ?? '你'}负责`;
export const timeSince = (iso, now = Date.now()) => {
  const minutes = iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000)) : 0;
  return minutes < 1 ? '刚刚' : `${minutes} 分钟前`;
};
export const waitSince = (iso, now = Date.now()) => {
  const minutes = iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000)) : 0;
  return minutes < 1 ? '刚刚' : `已等 ${minutes} 分钟`;
};
export function flowStatus(project, index) {
  if (project.ended) {
    const reached = stageIndex(project.endedStage);
    return index < reached ? '完成' : index === reached ? '已结束' : '未开始';
  }
  const current = stageIndex(project.stage);
  if (project.stage === 'done' || index < current) return '完成';
  if (index === current && project.error) return '卡住了';
  if (index > current) return '未开始';
  if (project.waitingFor) return index === 4 ? '等你验收' : `等你${project.waitingFor}`;
  return project.busy ? '进行中' : stageNames[project.stage];
}

export function roleTimeline(events) {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at) || a.projectNumber - b.projectNumber);
  const timeline = [];
  let lastProject;
  for (const event of sorted) {
    if (event.projectId !== lastProject) {
      timeline.push({ kind: 'project_separator', projectId: event.projectId, projectNumber: event.projectNumber, projectName: event.projectName });
      lastProject = event.projectId;
    }
    timeline.push(event);
  }
  return timeline;
}

export function messageView(event) {
  if (event.card) return { type: 'card', card: event.card, user: false };
  if ((event.kind === 'card' || event.kind === 'card_update') && event.title) return { type: 'card', card: { title: event.title }, user: false };
  if (event.kind === 'action') {
    const label = { confirm: '你点了确认', reject: '你点了打回', answer: '你提交了回答', retry: '你点了重试', end: '你点了结束项目', keep: '你选择继续做', start: '你点了开始做', revise: '你点了按这个改', dismiss: '你选择先不做' }[event.action] ?? '你点了卡片按钮';
    return { type: 'text', text: label, user: true };
  }
  if (event.kind === 'action_result') return null;
  if (event.text) return { type: 'text', text: event.text, user: event.kind === 'user' };
  return null;
}

export function originalDemand(project, events) {
  return project.demand || events.find(event => event.kind === 'user' && typeof event.text === 'string' && event.text.trim())?.text || '暂无需求原文';
}

export function latestCards(events) {
  const updates = new Map();
  const originalIds = new Set(events.filter(event => event.kind === 'card' && event.messageId).map(event => event.messageId));
  for (const event of events) if (event.kind === 'card_update' && event.messageId) updates.set(event.messageId, event);
  return events.flatMap(event => {
    if (event.kind === 'card_update') {
      if (event.messageId && (originalIds.has(event.messageId) || updates.get(event.messageId) !== event)) return [];
      return event.card || event.title ? [{ ...event, kind: 'card', updatedAt: event.at }] : [];
    }
    if (event.kind !== 'card' || !event.messageId || !updates.has(event.messageId)) return [event];
    const update = updates.get(event.messageId);
    return [{ ...event, title: update.title ?? event.title, card: update.card ?? (event.card && update.title ? { ...event.card, title: update.title } : event.card), updatedAt: update.at }];
  });
}
