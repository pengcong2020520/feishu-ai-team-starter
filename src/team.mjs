import { createFeishu } from './feishu.mjs';
import { createFlow } from './flow/index.mjs';
import { createRecorder } from './workbench/recorder.mjs';
import { createProjectManager } from './projects/manager.mjs';
import { resolveTeamMode } from './team-mode.mjs';
import { createPackageEngine } from './packages/engine.mjs';
import { readBindings } from './packages/bindings.mjs';
import { createPackageLobby } from './packages/lobby.mjs';
import { createPackageConnections } from './packages/connections.mjs';

// 两种版本共用 Agent、阶段表和管理员，只在入口装配项目管理能力。
export function createTeam({ root = process.cwd(), env = process.env, credentials, workbenchBase, previewBase, agent, transport = createFeishu } = {}) {
  const mode = resolveTeamMode({ root, env });
  const recorder = createRecorder(root);
  let flow, projects, packageProjects, packages, lobby;
  const feishu = transport({ credentials, recorder,
    roleOrder: async chatId => { const p = await packages.get(chatId); return p ? p.roles.map(r => p.botBindings[r.id]).filter(Boolean) : Object.keys(credentials || {}); },
    observe: (identity, name) => (packageProjects || projects)?.observe(identity, name),
    onDiscussion: async event => (await packages.get(event.chatId)) ? packages.syncContext(event.chatId) : flow.syncContext(event.chatId),
    onUnaddressed: event => packages.followup(event),
    onMessage: async event => (await packages.get(event.chatId)) ? packages.message(event) : await lobby.message(event) ? undefined : flow.handleMessage(event),
    onAction: async event => {
      if (!event.value?.action?.startsWith('package_')) return flow.handleAction(event);
      // 飞书回调先返回；权限、过期校验和实际执行在同一个受控入口完成。
      void (event.value.action === 'package_start' ? lobby.action(event) : packages.action(event)).catch(error => feishu.sendText(event.chatId, error.message).catch(() => {}));
      return { toast: { type: 'info', content: '已收到，请看项目进度' } };
    },
  });
  if (mode === 'projects') projects = createProjectManager({ root, feishu, recorder });
  flow = createFlow({ root, feishu, recorder, projects, workbenchBase, previewBase, ...(agent ? { agent } : {}) });
  packageProjects = projects || createProjectManager({ root, feishu, recorder });
  packages = createPackageEngine({ root, feishu, recorder, projects: packageProjects, workbenchBase, bindings: id => readBindings(root, id), ...(agent ? { agent } : {}) });
  lobby = createPackageLobby({ root, engine: packages, projects: packageProjects, feishu, recorder });
  packages.newProject = event => lobby.message(event);
  flow.packageLobby = lobby;
  flow.packages = packages;
  flow.packageProjects = packageProjects;
  flow.connections = createPackageConnections({ root, feishu, projects: packageProjects });
  // 旧编排扫描 workspace 时会把未知目录视为已完成；团队包项目由自己的持久化状态补入。
  const legacyState = flow.getState;
  flow.getState = async () => {
    const snapshot = await legacyState(), packProjects = await packages.snapshot();
    const ids = new Set(packProjects.map(p => p.id));
    snapshot.projects = [...snapshot.projects.filter(p => !ids.has(p.id)), ...packProjects];
    snapshot.projects.sort((a, b) => a.createdAt.localeCompare(b.createdAt)); snapshot.projects.forEach((p, i) => { p.number = i + 1; });
    for (const p of packProjects) snapshot.groups[p.chatId] = p;
    return snapshot;
  };
  const legacyGet = flow.getProjectById;
  flow.getProjectById = async id => await packages.get(id) || legacyGet(id);
  const legacyUpdateTeam = flow.updateTeam;
  flow.updateTeam = async input => await packages.get(input.projectId) ? packages.updateTeam(input) : legacyUpdateTeam(input);
  recorder.subscribe(record => { void packages.get(record.chatId).then(p => p ? packages.syncContext(record.chatId) : projects ? flow.syncContext(record.chatId) : undefined).catch(error => console.error(`项目讨论保存失败：${error.message}`)); });
  return { mode, recorder, feishu, flow };
}
