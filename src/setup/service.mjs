import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

// 团队服务脱离启动它的进程常驻，不随 AI 助手这一轮对话结束被关
const paths = root => ({ pid: path.join(root, 'data/service.pid'), log: path.join(root, 'data/service.log') });
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

export function serviceStatus(root) {
  const file = paths(root).pid;
  const pid = existsSync(file) ? Number(readFileSync(file, 'utf8').trim()) : 0;
  return pid && alive(pid) ? { running: true, pid } : { running: false };
}

export async function startService(root, { entry = 'src/main.mjs', readyText = '3 个机器人已连上飞书', timeoutMs = 60000, intervalMs = 500 } = {}) {
  const current = serviceStatus(root);
  if (current.running) return { ok: true, already: true, pid: current.pid };
  const { pid: pidFile, log } = paths(root);
  mkdirSync(path.dirname(log), { recursive: true });
  const offset = existsSync(log) ? statSync(log).size : 0;
  const fd = openSync(log, 'a');
  const child = spawn(process.execPath, [entry], { cwd: root, detached: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  let exited = null;
  child.on('exit', code => { exited = code ?? -1; });
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const text = readFileSync(log).subarray(offset).toString('utf8');
    if (text.includes(readyText)) return { ok: true, pid: child.pid };
    if (exited !== null) {
      rmSync(pidFile, { force: true });
      return { ok: false, error: text.trim().split('\n').slice(-5).join('\n') || `退出码 ${exited}` };
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return { ok: false, pid: child.pid, error: `${timeoutMs / 1000} 秒内没看到“${readyText}”，看 data/service.log` };
}

export async function stopService(root, { timeoutMs = 5000 } = {}) {
  const status = serviceStatus(root);
  const pidFile = paths(root).pid;
  if (!status.running) { rmSync(pidFile, { force: true }); return { stopped: false }; }
  process.kill(status.pid, 'SIGTERM');
  const end = Date.now() + timeoutMs;
  while (alive(status.pid) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 100));
  if (alive(status.pid)) process.kill(status.pid, 'SIGKILL');
  rmSync(pidFile, { force: true });
  return { stopped: true };
}
