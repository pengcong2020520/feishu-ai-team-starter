import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const metadata = root => path.join(root, 'data/service-manager.json');
const command = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
const xml = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const unit = s => '"' + String(s).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%') + '"';
const safe = value => { if (/[\x00-\x1f\x7f]/.test(value)) throw Error('服务路径不能包含控制字符'); return value; };

export function serviceDefinition(root, { platform = process.platform, home = os.homedir(), node = process.execPath, uid = process.getuid?.(), searchPath = process.env.PATH || '/usr/bin:/bin' } = {}) {
  root = safe(path.resolve(root)); safe(node); safe(home); safe(searchPath);
  const id = 'cn.feishu-ai-team.' + createHash('sha256').update(root).digest('hex').slice(0, 12);
  const entry = path.join(root, 'scripts/managed-service.mjs'), log = path.join(root, 'data/service.log');
  if (platform === 'darwin') return { platform, root, id, domain: `gui/${uid}`, file: path.join(home, 'Library/LaunchAgents', id + '.plist'), scope: '登录后自动启动', content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${id}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(entry)}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(home)}</string><key>PATH</key><string>${xml(searchPath)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer>
<key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>\n` };
  if (platform === 'linux') return { platform, root, id, unit: id + '.service', file: path.join(home, '.config/systemd/user', id + '.service'), scope: '用户服务（开机启动需启用 linger）', content: `[Unit]
Description=Feishu AI Team
StartLimitIntervalSec=0
[Service]
Type=simple
WorkingDirectory=${unit(root)}
ExecStart=${unit(node).replaceAll('$', () => '$$')} ${unit(entry).replaceAll('$', () => '$$')}
Environment=${unit('PATH=' + searchPath)}
Restart=always
RestartSec=15
KillMode=control-group
TimeoutStopSec=20
StandardOutput=${unit('append:' + log)}
StandardError=${unit('append:' + log)}
[Install]
WantedBy=default.target
` };
  throw Error('本地常驻服务目前支持 macOS 和带 systemd 的 Linux；Windows 请使用 Linux 服务器，不能把临时后台进程当作开机自启。');
}

export function managedService(root) {
  if (!existsSync(metadata(root))) return null;
  const value = JSON.parse(readFileSync(metadata(root), 'utf8'));
  if (value.root !== path.resolve(root) || value.platform !== process.platform) throw Error('服务目录或操作系统已变化，请先卸载旧自启服务，再在目标位置重新安装。');
  return value;
}
export function managedLoaded(spec, run = command) {
  try { if (spec.platform === 'darwin') run('launchctl', ['print', `${spec.domain}/${spec.id}`]); else run('systemctl', ['--user', 'is-active', '--quiet', spec.unit]); return true; } catch { return false; }
}
export function startManaged(spec, run = command) {
  if (spec.platform === 'darwin') {
    if (!managedLoaded(spec, run)) run('launchctl', ['bootstrap', spec.domain, spec.file]);
    else run('launchctl', ['kickstart', `${spec.domain}/${spec.id}`]);
  } else run('systemctl', ['--user', 'start', spec.unit]);
}
export function stopManaged(spec, run = command) {
  if (spec.platform === 'darwin') { if (managedLoaded(spec, run)) run('launchctl', ['bootout', `${spec.domain}/${spec.id}`]); }
  else run('systemctl', ['--user', 'stop', spec.unit]);
}
export function installManaged(root, { run = command, ...options } = {}) {
  const spec = serviceDefinition(root, options);
  mkdirSync(path.dirname(spec.file), { recursive: true }); mkdirSync(path.join(root, 'data'), { recursive: true });
  // 本目录的固定名字；不会覆盖其他目录服务或写入任何模型/飞书密钥。
  writeFileSync(spec.file, spec.content, { mode: 0o600 });
  const { content, ...record } = spec;
  try {
    if (spec.platform === 'linux') { run('systemctl', ['--user', 'daemon-reload']); run('systemctl', ['--user', 'enable', spec.unit]); }
    writeFileSync(metadata(root), JSON.stringify(record, null, 2), { mode: 0o600 });
  } catch (error) {
    if (spec.platform === 'linux') { try { run('systemctl', ['--user', 'disable', spec.unit]); } catch {} }
    rmSync(spec.file, { force: true });
    if (spec.platform === 'linux') { try { run('systemctl', ['--user', 'daemon-reload']); } catch {} }
    throw error;
  }
  return record;
}
export function uninstallManaged(root, { run = command } = {}) {
  const spec = managedService(root); if (!spec) return false;
  stopManaged(spec, run);
  if (spec.platform === 'linux') run('systemctl', ['--user', 'disable', spec.unit]);
  rmSync(spec.file, { force: true });
  if (spec.platform === 'linux') run('systemctl', ['--user', 'daemon-reload']);
  rmSync(metadata(root), { force: true }); return true;
}
export function lingerStatus({ run = command, user = os.userInfo().username } = {}) {
  try { return run('loginctl', ['show-user', user, '-p', 'Linger', '--value']).trim() === 'yes'; } catch { return false; }
}
