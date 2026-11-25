import { execFileSync } from 'node:child_process';

// 只看 PID 活着不够：进程退出后 PID 可能被系统分给别的程序，再核对命令行里有我们的脚本
export function isOurProcess(pid, marker) {
  if (!pid) return false;
  try { process.kill(pid, 0); } catch (error) { if (error.code !== 'EPERM') return false; }
  if (process.platform === 'win32') return true;
  try { return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).includes(marker); } catch { return false; }
}
