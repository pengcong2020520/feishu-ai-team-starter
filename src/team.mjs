import { createFeishu } from './feishu.mjs';
import { createFlow } from './flow/index.mjs';
import { createRecorder } from './workbench/recorder.mjs';
import { createProjectManager } from './projects/manager.mjs';
import { resolveTeamMode } from './team-mode.mjs';

// 两种版本共用 Agent、阶段表和管理员，只在入口装配项目管理能力。
export function createTeam({ root = process.cwd(), env = process.env, credentials, workbenchBase, previewBase, agent, transport = createFeishu } = {}) {
  const mode = resolveTeamMode({ root, env });
  const recorder = createRecorder(root);
  let flow, projects;
  const feishu = transport({ credentials, recorder,
    observe: (identity, name) => projects?.observe(identity, name),
    onDiscussion: event => flow.syncContext(event.chatId),
    onMessage: event => flow.handleMessage(event), onAction: event => flow.handleAction(event),
  });
  if (mode === 'projects') projects = createProjectManager({ root, feishu, recorder });
  flow = createFlow({ root, feishu, recorder, projects, workbenchBase, previewBase, ...(agent ? { agent } : {}) });
  if (projects) recorder.subscribe(record => { void flow.syncContext(record.chatId).catch(error => console.error(`项目讨论保存失败：${error.message}`)); });
  return { mode, recorder, feishu, flow };
}
