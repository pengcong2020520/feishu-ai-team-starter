// npm start / npm stop / npm run status
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceStatus, startService, stopService } from '../src/setup/service.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const workbench = 'http://127.0.0.1:4870';
const [command] = process.argv.slice(2);
if (command === 'start') {
  const r = await startService(root);
  if (r.ok) console.log(r.already ? `团队服务已在运行（pid ${r.pid}），工作台 ${workbench}` : `团队服务已启动（pid ${r.pid}），日志 data/service.log，工作台 ${workbench}`);
  else { console.error(`团队服务没起来：${r.error}`); process.exitCode = 1; }
} else if (command === 'stop') {
  console.log((await stopService(root)).stopped ? '团队服务已停止' : '团队服务没有在运行');
} else if (command === 'status') {
  const s = serviceStatus(root);
  console.log(s.running ? `团队服务在运行（pid ${s.pid}），工作台 ${workbench}` : '团队服务没有在运行，运行 npm start 启动');
} else {
  console.error('用法：node scripts/service.mjs start|stop|status');
  process.exitCode = 2;
}
