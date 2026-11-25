import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

export const REQUIRED = ['@larksuiteoapi/node-sdk', '@anthropic-ai/claude-agent-sdk', 'qrcode'];
export const NPMJS = 'https://registry.npmjs.org/';
export const MIRROR = 'https://registry.npmmirror.com/';
const statusFile = root => path.join(root, 'data/install.json');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

export const depsReady = root => REQUIRED.every(name => existsSync(path.join(root, 'node_modules', name, 'package.json')));

export async function pickRegistry({ fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  try {
    const res = await fetchImpl(`${NPMJS}-/ping`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return NPMJS;
  } catch {}
  return MIRROR;
}

export function installStatus(root) {
  let s;
  try { s = JSON.parse(readFileSync(statusFile(root), 'utf8')); } catch { return { status: 'none' }; }
  if (s.status === 'running' && !alive(s.pid)) return { ...s, status: 'failed', reason: '安装进程意外退出' };
  return s;
}

// 脱离当前进程在后台跑 npm ci：用户回答问题的同时依赖在装
export function startInstall(root, { registry, spawnImpl = spawn }) {
  mkdirSync(path.join(root, 'data'), { recursive: true });
  const child = spawnImpl(process.execPath, [path.join(root, 'src/setup/install-run.mjs'), registry], { cwd: root, detached: true, stdio: 'ignore' });
  child.unref();
  const s = { status: 'running', pid: child.pid, registry, startedAt: new Date().toISOString() };
  writeFileSync(statusFile(root), JSON.stringify(s));
  return s;
}

export async function waitForInstall(root, { timeoutMs = 100000, intervalMs = 2000 } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const s = installStatus(root);
    if (s.status === 'ok') return depsReady(root) ? { ok: true } : { ok: false, reason: '依赖不完整，重跑会重新安装' };
    if (s.status === 'failed') return { ok: false, reason: s.reason ?? `npm ci 退出码 ${s.code}` };
    if (s.status === 'none') return { ok: false, reason: '没有在安装，重跑会开始安装' };
    if (Date.now() >= end) return { ok: false, pending: true };
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

export function installLogTail(root, lines = 15) {
  try { return readFileSync(path.join(root, 'data/install.log'), 'utf8').trimEnd().split('\n').slice(-lines).join('\n'); } catch { return ''; }
}
