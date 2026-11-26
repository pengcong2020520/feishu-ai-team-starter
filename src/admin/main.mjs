// 管理服务入口：带着团队服务（src/main.mjs）跑。还没配管理员机器人时，团队服务退出它也退出，和以前一样
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupervisor } from './supervisor.mjs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const logFile = process.env.SERVICE_LOG_FILE ? path.resolve(root, process.env.SERVICE_LOG_FILE) : null;
let closing = false;
const supervisor = createSupervisor({ root, logFile, onExit: ({ code, signal }) => {
  console.error(`团队服务意外退出（${signal ?? `退出码 ${code}`}）`);
  void shutdown(typeof code === 'number' && code !== 0 ? code : 1);
} });
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  await supervisor.stop();
  supervisor.close();
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void shutdown(0));

const result = await supervisor.start();
if (result.ok) console.log(`管理服务已启动（pid ${process.pid}），团队服务在运行（pid ${result.pid}）`);
// 60 秒没连上但还活着（比如网络慢）：不杀它，和以前一样接着等
else if (supervisor.status().running) console.error(`团队服务还没连上飞书：${result.error}`);
else { console.error(`团队服务没起来：${result.error}`); void shutdown(1); }
