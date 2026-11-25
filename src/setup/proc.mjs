import { execFileSync } from 'node:child_process';

const psCommand = pid => execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });

// 只看 PID 活着不够：进程退出后 PID 可能被系统分给别的程序，再核对命令行里有我们的脚本
export function isOurProcess(pid, marker, { ps = psCommand } = {}) {
  if (!pid) return false;
  try { process.kill(pid, 0); } catch (error) { if (error.code !== 'EPERM') return false; }
  if (process.platform === 'win32') return true;
  try { return ps(pid).includes(marker); } catch (error) {
    // ps 根本启动不了（AI 助手的沙箱里会拒绝执行 ps，报 EPERM）：只能信 PID 还活着；
    // ps 跑了但没找到这个进程（退出码非 0、没有 error.code）才算不是我们的
    return typeof error.code === 'string';
  }
}
