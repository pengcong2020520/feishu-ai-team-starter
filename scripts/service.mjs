// npm start / npm stop / npm run status
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { serviceStatus, startService, stopService } from '../src/setup/service.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const env = existsSync(path.join(root, '.env')) ? parseEnv(readFileSync(path.join(root, '.env'), 'utf8')) : {};
const workbench = `http://127.0.0.1:${env.PREVIEW_PORT || 4870}`;
const [command] = process.argv.slice(2);
if (command === 'start') {
  const r = await startService(root);
  if (r.ok) console.log(r.already ? `团队服务已在运行（pid ${r.pid}），工作台 ${workbench}` : `团队服务已启动（pid ${r.pid}），日志 data/service.log，工作台 ${workbench}`);
  else { console.error(`团队服务没起来：${r.error}`); process.exitCode = 1; }
} else if (command === 'stop') {
  const r = await stopService(root);
  if (r.denied) { console.error(`没有权限停止团队服务（pid ${r.pid}）：AI 助手的沙箱不让给这个进程发停止信号。请在你自己的终端里进入项目目录运行 npm stop`); process.exitCode = 1; }
  else console.log(r.stopped ? '团队服务已停止' : '团队服务没有在运行');
} else if (command === 'status') {
  const s = serviceStatus(root);
  console.log(s.running ? `团队服务在运行（pid ${s.pid}），工作台 ${workbench}` : '团队服务没有在运行，运行 npm start 启动');
} else {
  console.error('用法：node scripts/service.mjs start|stop|status');
  process.exitCode = 2;
}
