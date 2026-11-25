import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { isOurProcess } from './proc.mjs';

// 团队服务脱离启动它的进程常驻，不随 AI 助手这一轮对话结束被关
const paths = root => ({ pid: path.join(root, 'data/service.pid'), log: path.join(root, 'data/service.log') });
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

// 工作台用 port，模型写的页面用 port + 1；两个都空着才算可用
const portFree = port => new Promise(resolve => {
  const server = net.createServer().once('error', () => resolve(false)).once('listening', () => server.close(() => resolve(true)));
  server.listen(port, '127.0.0.1');
});
export const portsFree = async port => (await portFree(port)) && (await portFree(port + 1));

export async function pickPort(start = 4870) {
  for (let port = start; port < start + 100; port += 10) if (await portsFree(port)) return port;
  throw new Error(`${start}–${start + 99} 之间找不到空闲端口，请在 .env 里手动设置 PREVIEW_PORT`);
}

export function serviceStatus(root) {
  const file = paths(root).pid;
  const [pidText = '', entry = 'src/main.mjs'] = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : [];
  const pid = Number(pidText);
  return isOurProcess(pid, entry) ? { running: true, pid } : { running: false };
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
  writeFileSync(pidFile, `${child.pid}\n${entry}\n`);
  let exited = null;
  child.on('exit', code => { exited = code ?? -1; });
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const text = readFileSync(log).subarray(offset).toString('utf8');
    if (text.includes(readyText)) return { ok: true, pid: child.pid };
    if (exited !== null) {
      rmSync(pidFile, { force: true });
      const busy = /EADDRINUSE[^\n]*?:(\d+)/.exec(text);
      if (busy) return { ok: false, error: `端口 ${busy[1]} 被别的程序占用：在 .env 里把 PREVIEW_PORT 改成别的（比如 4880），再 npm start` };
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

// 服务在跑时用工作台接口读项目状态、替用户给角色发话（和在飞书群里 @ 它走同一个处理函数）
export async function workbenchState(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(5000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

export async function workbenchMessage(port, { chatId, role, text }) {
  const res = await fetch(`http://127.0.0.1:${port}/api/message`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workbench': '1' }, body: JSON.stringify({ chatId, role, text }), signal: AbortSignal.timeout(10000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `工作台返回 ${res.status}`);
  return data;
}
