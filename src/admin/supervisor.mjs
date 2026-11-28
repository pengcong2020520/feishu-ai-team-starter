// 管理服务带着团队服务跑：拉起、接住它的输出、重启、停下。团队服务挂了或改坏了起不来，管理服务还在
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';

export const READY_TEXT = '个机器人已连上飞书';
const tail = text => text.trim().split('\n').slice(-5).join('\n');

export function createSupervisor({ root, entry = 'src/main.mjs', env = process.env, readyText = READY_TEXT, readyMs = 60000, stopMs = 4000, logFile = null, echo = true, onExit = () => {} } = {}) {
  let child = null;
  let stopping = false;
  let state = { running: false, healthy: false, pid: null, startedAt: null, lastExit: null };
  // 本机由 npm start 把管理服务的输出重定向到 data/service.log；容器里另设 logFile，让 docker logs 和文件里都有
  const log = logFile ? (mkdirSync(path.dirname(logFile), { recursive: true }), createWriteStream(logFile, { flags: 'a' })) : null;
  const write = (stream, chunk) => { if (echo) stream.write(chunk); log?.write(chunk); };

  // 拉起团队服务，等它说“已连上飞书”才算健康；没等到也不杀它，交给调用方决定
  const startNow = () => new Promise(resolve => {
    if (child) { resolve(state.healthy ? { ok: true, already: true, pid: child.pid } : { ok: false, pid: child.pid, error: '团队服务还没连上飞书' }); return; }
    const proc = spawn(process.execPath, [entry], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
    child = proc;
    stopping = false;
    state = { running: true, healthy: false, pid: proc.pid, startedAt: new Date().toISOString(), lastExit: state.lastExit };
    let seen = '';
    let settled = false;
    const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => finish({ ok: false, pid: proc.pid, error: `${Math.round(readyMs / 1000)} 秒内没看到“${readyText}”` }), readyMs);
    const watch = (stream, target) => stream.on('data', chunk => {
      write(target, chunk);
      seen = (seen + chunk).slice(-4000);
      if (!state.healthy && child === proc && seen.includes(readyText)) { state.healthy = true; finish({ ok: true, pid: proc.pid }); }
    });
    watch(proc.stdout, process.stdout);
    watch(proc.stderr, process.stderr);
    proc.on('error', error => finish({ ok: false, error: error.message }));
    proc.on('exit', (code, signal) => {
      const expected = stopping;
      if (child === proc) child = null;
      state = { ...state, running: false, healthy: false, pid: null, lastExit: { code, signal, at: new Date().toISOString(), expected } };
      finish({ ok: false, error: tail(seen) || `团队服务退出了（${signal ?? `退出码 ${code}`}）` });
      // 通知里带上最后几行输出（不存进 status，免得到处传）
      if (!expected) onExit({ ...state.lastExit, output: tail(seen) });
    });
  });

  // 先礼后兵：SIGTERM 让它收好长连接，过 stopMs 还没退就强制结束
  const stopNow = async () => {
    const proc = child;
    if (!proc) return { stopped: false };
    stopping = true;
    const exited = new Promise(resolve => proc.once('exit', resolve));
    proc.kill('SIGTERM');
    let timer;
    const late = await Promise.race([exited.then(() => false), new Promise(resolve => { timer = setTimeout(() => resolve(true), stopMs); })]);
    clearTimeout(timer);
    if (late) { proc.kill('SIGKILL'); await exited; }
    return { stopped: true };
  };
  let chain = Promise.resolve();
  let starting = null;
  const serial = fn => { const next = chain.then(fn, fn); chain = next.catch(() => {}); return next; };
  const start = () => {
    if (starting) return starting;
    const task = serial(startNow);
    starting = task;
    void task.then(() => { if (starting === task) starting = null; }, () => { if (starting === task) starting = null; });
    return task;
  };
  const stop = () => serial(stopNow);
  const restart = () => serial(async () => { await stopNow(); return startNow(); });
  return { start, stop, restart, status: () => ({ ...state }), close: () => log?.end() };
}
