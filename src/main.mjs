import { createFeishu } from './feishu.mjs';
import { createFlow } from './flow/index.mjs';
import { startPreview } from './preview.mjs';
import { createRecorder } from './workbench/recorder.mjs';

process.loadEnvFile();
const credentials = {};
for (const role of ['product', 'designer', 'developer']) {
  const prefix = `FEISHU_${role.toUpperCase()}_`;
  if (!process.env[`${prefix}APP_ID`] || !process.env[`${prefix}APP_SECRET`]) throw new Error(`缺少配置：${prefix}APP_ID 或 ${prefix}APP_SECRET`);
  credentials[role] = { appId: process.env[`${prefix}APP_ID`], appSecret: process.env[`${prefix}APP_SECRET`] };
}
let flow;
const recorder = createRecorder();
const feishu = createFeishu({ credentials, recorder, onMessage: event => flow.handleMessage(event), onAction: event => flow.handleAction(event) });
const workbenchBase = process.env.PUBLIC_WORKBENCH_BASE || 'http://127.0.0.1:4870';
const previewBase = process.env.PUBLIC_PREVIEW_BASE || 'http://127.0.0.1:4871';
flow = createFlow({ feishu, recorder, workbenchBase, previewBase });
const preview = await startPreview({ flow, feishu, recorder, host: process.env.PREVIEW_HOST || '127.0.0.1', previewBase });
try {
  await feishu.start();
  console.log('3 个机器人已连上飞书');
  console.log(`预览地址：${previewBase}；走查与工作台地址：${workbenchBase}`);
} catch (error) {
  await preview.close();
  feishu.close();
  console.error(error.message);
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { feishu.close(); await preview.close(); process.exit(); });
