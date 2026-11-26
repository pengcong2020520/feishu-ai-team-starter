// 管理服务入口：带着团队服务（src/main.mjs）跑。
// 配了 AI 管理员助手（.env 的 FEISHU_ADMIN_*）时，它连上自己的长连接，团队服务出问题私聊提醒管理员；
// 没配时，团队服务退出它也退出，和以前一样
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupervisor } from './supervisor.mjs';
import { workbenchAction, workbenchMessage, workbenchState } from '../setup/service.mjs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
// 团队服务用启动时的环境，自己去读 .env：重启时能读到 .env 的新内容
const baseEnv = { ...process.env, ADMIN_WORKBENCH_TOKEN: randomBytes(32).toString('hex') };
try { process.loadEnvFile(path.join(root, '.env')); } catch {}
const logFile = process.env.SERVICE_LOG_FILE ? path.resolve(root, process.env.SERVICE_LOG_FILE) : null;
// 管理服务自己的话：容器里也写进 data/service.log，管理员助手以后能读到
const say = (stream, text) => {
  stream.write(`${text}\n`);
  if (logFile) try { appendFileSync(logFile, `${text}\n`); } catch {}
};
const logger = { log: text => say(process.stdout, text), error: text => say(process.stderr, text) };

const config = ['APP_ID', 'APP_SECRET', 'OPEN_ID'].every(k => process.env[`FEISHU_ADMIN_${k}`])
  ? { appId: process.env.FEISHU_ADMIN_APP_ID, appSecret: process.env.FEISHU_ADMIN_APP_SECRET, adminOpenId: process.env.FEISHU_ADMIN_OPEN_ID }
  : null;
let assistant = null;
let bot = null;
let closing = false;
let timer = null;

const supervisor = createSupervisor({ root, env: baseEnv, logFile, onExit: exit => {
  logger.error(`团队服务意外退出（${exit.signal ?? `退出码 ${exit.code}`}）`);
  if (assistant) void assistant.serviceDown(exit);
  else void shutdown(typeof exit.code === 'number' && exit.code !== 0 ? exit.code : 1);
} });
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  bot?.close();
  await supervisor.stop();
  supervisor.close();
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void shutdown(0));

if (config) {
  try {
    const { createAdminBot } = await import('./bot.mjs');
    const { createAssistant } = await import('./assistant.mjs');
    const { createChanges } = await import('./changes.mjs');
    const { createDeploy } = await import('./deploy.mjs');
    const port = Number(process.env.PREVIEW_PORT || 4870);
    const workbench = { state: () => workbenchState(port), message: message => workbenchMessage(port, message, baseEnv.ADMIN_WORKBENCH_TOKEN), action: action => workbenchAction(port, action, baseEnv.ADMIN_WORKBENCH_TOKEN) };
    let ready = null;
    bot = createAdminBot({ ...config, logger, onMessage: event => ready.onMessage(event), onAction: event => ready.onAction(event) });
    const changes = createChanges({ root });
    const deploy = createDeploy({ changes, supervisor, workbench, bot, logger, handBack: text => ready.runSteward(text, '测试没过，我接着改'), serviceDown: (exit, error) => ready.serviceDown(exit, error) });
    // 模型配好了才有管家；没配时只做固定的事
    let steward = null;
    if (['MODEL_BASE_URL', 'MODEL_API_KEY', 'MODEL_NAME'].every(k => process.env[k])) {
      const { createSteward } = await import('./steward.mjs');
      const { buildTools } = await import('./tools.mjs');
      const { runAgent } = await import('../agents/run.mjs');
      steward = createSteward({ root, tools: buildTools({ supervisor, workbench, changes, deploy, runAgent, root, adminWords: () => ready?.adminWords() ?? [] }) });
    }
    ready = createAssistant({ root, bot, supervisor, workbench, steward, deploy, changes, logger });
    await bot.start();
    assistant = ready;
    logger.log('AI 管理员助手已连上飞书');
  } catch (error) {
    bot?.close();
    bot = null;
    logger.error(`AI 管理员助手没连上飞书（${error.message}），先只带着团队服务跑`);
  }
}

const result = await supervisor.start();
if (result.ok) logger.log(`管理服务已启动（pid ${process.pid}），团队服务在运行（pid ${result.pid}）`);
// 60 秒没连上但还活着（比如网络慢）：不杀它，和以前一样接着等
else if (supervisor.status().running) logger.error(`团队服务还没连上飞书：${result.error}`);
else if (assistant) { logger.error(`团队服务没起来：${result.error}`); void assistant.serviceDown(null, result.error); }
else { logger.error(`团队服务没起来：${result.error}`); void shutdown(1); }

if (assistant) timer = setInterval(() => void assistant.tick().catch(error => logger.error(`巡检出错：${error.message}`)), 30000);
