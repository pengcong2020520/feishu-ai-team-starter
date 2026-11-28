// Read-only presentation model shared by the browser and offline tests.
import { stageNames } from './presentation.mjs';

export const boardColumns = [
  { id: 'active', name: '进行中' }, { id: 'waiting', name: '等你确认' },
  { id: 'blocked', name: '需处理' }, { id: 'done', name: '已完成' },
];
export const statusLabels = { running: '执行中', queued: '排队中', waiting: '等你确认', blocked: '需处理', idle: '空闲', pending: '待前序完成' };
const oldOwners = { idle:'product', clarifying:'product', confirm_prd:'product', revise_prd:'product', designing:'designer', confirm_design:'designer', revise_design:'designer', building:'developer', revise_build:'developer', walkthrough:'designer', accept:'developer' };
export const teamName = pack => pack?.name?.split(/\s*·\s*/)[0] || '我的团队';
export const stageName = p => p.stageName || stageNames[p.stage] || '等待流程衔接';
export const finished = p => !!p.ended || p.stageType === 'done' || p.stage === 'done';
export function activityText(text, pack) {
  return String(text || '').replace(/使用技能\s+(?:team:)?([\w-]+)/g, (_,id) => {
    const skill = pack?.skills?.find(s => s.id === id);
    return skill?.name && !/^[\w-]+$/.test(skill.name) ? `正在使用「${skill.name}」` : '正在使用专业技能';
  });
}
export function projectStatus(p) {
  if (finished(p)) return 'done';
  if (p.busy) return 'active';
  if (p.error) return 'blocked';
  if (p.pendingReview || p.stageType === 'gate' || p.waitingFor) return 'waiting';
  return 'active';
}
export function selectTeam(packages, projects, { team, project, saved } = {}) {
  const owner = projects.find(p => p.id === project)?.package?.id;
  return [owner, team, saved, 'web-studio'].map(id => packages.find(p => p.id === id)).find(Boolean) || packages[0];
}
export function teamProjects(pack, packages, legacy = []) {
  if (!pack) return [];
  // Detailed package snapshots win over the merged legacy/state endpoint.
  const unique = new Map([...legacy, ...packages].map(p => [p.id, p]));
  return [...unique.values()].filter(p => p.package ? p.package.id === pack.id : pack.id === 'web-studio')
    .sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || a.id.localeCompare(b.id));
}
export function projectOwners(p, pack) {
  const n = p.definition?.workflow?.nodes.find(n => n.id === p.stage);
  const active = p.running || (p.activeRole ? [p.activeRole] : []);
  const pending = p.error && !p.busy ? Object.entries(p.activities || {}).filter(([,a]) => a.status === 'stopped').map(([id]) => id) : p.pendingReview?.tasks?.map(t => t.role) || [];
  return [...new Set(active.length ? active : pending.length ? pending : [n?.role || p.retryRole || oldOwners[p.stage] || p.definition?.coordinator || pack.coordinator])].filter(Boolean);
}
export function roleStates(pack, projects) {
  // Include roles still used by active projects locked to an earlier package version.
  const definitions = new Map((pack.roles || []).map(r => [r.id, r]));
  for (const p of projects.filter(p => !finished(p))) for (const r of p.definition?.roles || []) if (!definitions.has(r.id)) definitions.set(r.id, r);
  const priority = { running:0, queued:1, blocked:2, waiting:3, pending:4 };
  return [...definitions.values()].map(role => {
    const tasks = [], recent = [];
    for (const p of projects) {
      const a = p.activities?.[role.id];
      for (const live of p.liveActivities || []) if (live.role === role.id) tasks.push({ project:p, status:live.status, name:live.name, text:live.text, startedAt:live.startedAt, kind:live.kind });
      if (a?.status === 'done') recent.push({ project:p, name:a.name });
      if (finished(p)) continue;
      const owners = projectOwners(p, pack), mine = owners.includes(role.id), status = projectStatus(p);
      const executing = p.busy && (p.package ? p.running?.includes(role.id) && a?.status !== 'done' : p.activeRole === role.id);
      if (executing) tasks.push({ project:p, status:(a?.status === 'queued' || p.queuedForAgent) ? 'queued' : 'running', name:a?.name || stageName(p), text:a?.text || p.activity || '正在处理任务', startedAt:a?.startedAt || p.workStartedAt, kind:'work' });
      else if (status === 'blocked' && (mine || a?.status === 'stopped')) tasks.push({ project:p, status:'blocked', name:a?.name || stageName(p), text:'这一步已暂停，请查看项目', kind:'work' });
      else if (status === 'waiting' && mine) tasks.push({ project:p, status:'waiting', name:stageName(p), text:p.waitingFeedback ? '等待补充修改意见' : '阶段成果已就绪，等待确认', kind:'work' });
      else if (p.plan && !p.pendingReview && !p.error) {
        const node = p.definition?.workflow?.nodes.find(n => n.id === p.plan.node);
        for (const task of p.plan.tasks || []) {
          const def = node?.tasks?.find(t => t.id === task.id);
          if (def?.role === role.id && !p.plan.completed?.includes(task.id) && !executing) tasks.push({ project:p, status:'pending', name:def.name, text:'等待前序任务与流程派工', kind:'work' });
        }
      }
    }
    tasks.sort((a,b) => priority[a.status] - priority[b.status]);
    return { ...role, status:tasks[0]?.status || 'idle', tasks, recent:recent[0] || null };
  });
}
