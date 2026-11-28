import { startPreview } from './preview.mjs';
import { createTeam } from './team.mjs';
import { teamModeNames } from './team-mode.mjs';
import { extraCredentials } from './packages/bindings.mjs';

process.loadEnvFile();
const credentials = {};
for (const role of ['product', 'designer', 'developer']) {
  const prefix = `FEISHU_${role.toUpperCase()}_`;
  if (!process.env[`${prefix}APP_ID`] || !process.env[`${prefix}APP_SECRET`]) throw new Error(`缺少配置：${prefix}APP_ID 或 ${prefix}APP_SECRET`);
  credentials[role] = { appId: process.env[`${prefix}APP_ID`], appSecret: process.env[`${prefix}APP_SECRET`] };
}
// 工作台用 PREVIEW_PORT（默认 4870），模型写的页面用下一个端口
const port = Number(process.env.PREVIEW_PORT || 4870);
if (!Number.isInteger(port) || port < 1024 || port > 65534) throw new Error('PREVIEW_PORT 必须是 1024–65534 的整数');
const workbenchBase = process.env.PUBLIC_WORKBENCH_BASE || `http://127.0.0.1:${port}`;
const previewBase = process.env.PUBLIC_PREVIEW_BASE || `http://127.0.0.1:${port + 1}`;
const allCredentials = extraCredentials(process.env, credentials);
const { mode, flow, feishu, recorder } = createTeam({ credentials: allCredentials, workbenchBase, previewBase });
const preview = await startPreview({ flow, feishu, recorder, host: process.env.PREVIEW_HOST || '127.0.0.1', previewBase, workbenchPort: port, modelPort: port + 1 });
try {
  await feishu.start();
  flow.packages.startDocumentPolling();
  console.log(`${Object.keys(allCredentials).length} 个机器人已连上飞书`);
  console.log(`当前版本：${teamModeNames[mode]}`);
  console.log(`预览地址：${previewBase}；走查与工作台地址：${workbenchBase}`);
} catch (error) {
  await preview.close();
  feishu.close();
  console.error(error.message);
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { flow.packages.stopDocumentPolling(); feishu.close(); await preview.close(); process.exit(); });
