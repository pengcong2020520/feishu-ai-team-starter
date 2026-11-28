import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { managedService, installManaged, lingerStatus } from './managed-service.mjs';
import { serviceStatus, startService, stopService, workbenchState } from './service.mjs';
import { capacityStatus } from '../agents/capacity.mjs';
import { readEnv } from './env-file.mjs';

const file = root => path.join(root, 'data/deployment.json');
export const quoteShell = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
export function readDeployment(root) {
  if (!existsSync(file(root))) return null;
  return JSON.parse(readFileSync(file(root), 'utf8'));
}
export function selectDeployment(root, target, { host, user, port = '22', directory = '/opt/feishu-team', identityFile, here = false } = {}) {
  if (!['local', 'server'].includes(target)) throw Error('请选择 local（本地常驻）或 server（服务器）');
  const record = { target, location: target === 'local' || here ? 'here' : 'remote', recovery: 'resume-interrupted', selectedAt: new Date().toISOString() };
  if (target === 'server' && !here) {
    if (!host || !user) throw Error('服务器部署需要 SSH 主机和用户名：deploy server --host <主机> --user <用户> [--port 22] [--path /opt/feishu-team] [--identity-file <密钥路径>]。不收集登录密码或私钥内容。');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/.test(host) || !/^[a-zA-Z_][a-zA-Z0-9_-]*\$?$/.test(user)) throw Error('SSH 主机或用户名格式无效');
    if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw Error('SSH 端口必须在 1–65535 之间');
    if (!directory.startsWith('/') || /[\x00-\x1f\x7f]/.test(directory) || directory === '/') throw Error('部署目录必须是非根目录的绝对路径');
    if (identityFile && /[\x00-\x1f\x7f]/.test(identityFile)) throw Error('SSH 密钥路径不能包含控制字符');
    record.server = { host, user, port: Number(port), directory, ...(identityFile ? { identityFile: path.resolve(identityFile) } : {}), authentication: identityFile ? 'key-file' : 'ssh-agent-or-config' };
  }
  mkdirSync(path.dirname(file(root)), { recursive: true });
  writeFileSync(file(root) + '.tmp', JSON.stringify(record, null, 2), { mode: 0o600 }); renameSync(file(root) + '.tmp', file(root)); return record;
}
export function deploymentLines(record) {
  if (!record) return ['需要用户：选择部署在服务器还是本地电脑；已明确的选择不重复询问。',
    '本地：node setup.mjs deploy local（后台常驻、系统自启动；电脑休眠、关机和断网期间仍会离线）',
    '服务器：收集 SSH 主机、用户名、端口、登录方式和部署目录，再运行 node setup.mjs deploy server --host <主机> --user <用户> --port 22 --path /opt/feishu-team；密钥只提供文件路径。'];
  if (record.location !== 'remote') return [];
  const s = record.server, ssh = ['ssh', '-p', String(s.port), ...(s.identityFile ? ['-i', s.identityFile] : []), `${s.user}@${s.host}`].map(quoteShell).join(' ');
  return [`已选择服务器 ${s.user}@${s.host}:${s.port}，部署目录 ${s.directory}。本机不扫码、不启动机器人。`,
    `Coding Agent 下一步：用 ${ssh} 检查远端系统、Node.js 24、Git、联网与目录权限；按 docs/部署与常驻.md 完成远端安装。`,
    '首次 SSH 连接需由用户核对主机指纹；不关闭主机校验，不把密码或私钥内容写进配置。',
    `在远端代码目录运行 node setup.mjs deploy server --here，再运行 node setup.mjs；扫码页和工作台通过 SSH 隧道访问。`,
    '若迁移已有安装，必须先停用原机自启和连接，再备份迁移 .env、data、workspace 及会话目录；不得把旧项目丢掉后重建机器人。'];
}

export async function installBackground(root) {
  const existing = managedService(root);
  if (existing && existsSync(existing.file)) return { ...existing, already: true, linger: process.platform === 'linux' ? lingerStatus() : undefined };
  const running = serviceStatus(root).running;
  if (running) {
    const port = Number(readEnv(path.join(root, '.env')).PREVIEW_PORT || 4870), snapshot = await workbenchState(port), capacity = await capacityStatus(root);
    if (!snapshot || snapshot.projects.some(p => p.busy) || capacity.active || capacity.queued) throw Error('服务正在执行任务或暂时无法确认空闲；保留当前服务，等步骤结束后再安装自启动。');
    const result = await stopService(root); if (result.denied) throw Error('当前环境没有权限停止旧服务，请在自己的终端运行 npm stop 后重试。');
  }
  try { const installed = installManaged(root); return { ...installed, linger: process.platform === 'linux' ? lingerStatus() : undefined }; }
  catch (error) { if (running && !managedService(root)) await startService(root); throw error; }
}
