// 系统服务以前台方式运行此入口；不在 launchd/systemd 下再次 detached。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOurProcess } from '../src/setup/proc.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
process.chdir(root);
const pidFile = path.join(root, 'data/service.pid'), lock = path.join(root, 'data/managed.lock');
mkdirSync(path.dirname(pidFile), { recursive: true });
if (existsSync(pidFile)) {
  const [pid, entry] = readFileSync(pidFile, 'utf8').trim().split('\n');
  if (Number(pid) !== process.pid && isOurProcess(Number(pid), entry || 'src/main.mjs')) {
    console.error('同一目录的服务已运行，拒绝启动第二份连接。'); process.exit(1);
  }
}
// launchd/systemd 每个任务只有一个实例；mkdir 额外挡住手工并发执行。
try { mkdirSync(lock); } catch (e) {
  if (e.code !== 'EEXIST') throw e;
  const ownerFile = path.join(lock, 'pid');
  if (!existsSync(ownerFile) && Date.now() - statSync(lock).mtimeMs < 30000) process.exit(1);
  const owner = existsSync(ownerFile) ? Number(readFileSync(ownerFile, 'utf8')) : 0;
  if (isOurProcess(owner, 'scripts/managed-service.mjs')) process.exit(1);
  rmSync(lock, { recursive: true }); mkdirSync(lock);
}
writeFileSync(path.join(lock, 'pid'), String(process.pid));
writeFileSync(pidFile, `${process.pid}\nscripts/managed-service.mjs\n`);
process.once('exit', () => {
  if (existsSync(pidFile) && Number(readFileSync(pidFile, 'utf8').split('\n')[0]) === process.pid) rmSync(pidFile, { force: true });
  if (existsSync(path.join(lock, 'pid')) && Number(readFileSync(path.join(lock, 'pid'), 'utf8')) === process.pid) rmSync(lock, { recursive: true, force: true });
});
process.env.TEAM_SERVICE_MANAGED = '1';
await import('../src/admin/main.mjs');
