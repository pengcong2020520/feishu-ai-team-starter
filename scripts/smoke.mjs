// 冒烟测试：语法检查 → 用假飞书、假模型起工作台并能打开 → 启动命令首跑
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pickPort } from '../src/setup/service.mjs';

const files = execFileSync('git', ['ls-files', '*.mjs'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
for (const file of files) execFileSync(process.execPath, ['--check', file]);
console.log(`✓ 语法检查 ${files.length} 个文件`);

// 挑一对空闲端口，免得本机正在跑的团队服务占着 4890 时误判通过
const port = await pickPort(4950);
const child = spawn(process.execPath, ['scripts/try-workbench.mjs'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DEMO_PORT: String(port) } });
let output = '';
child.stdout.on('data', d => { output += d; });
child.stderr.on('data', d => { output += d; });
try {
  const end = Date.now() + 30000;
  let ok = false;
  while (!ok && Date.now() < end) {
    try {
      const home = await fetch(`http://127.0.0.1:${port}/`);
      const state = await fetch(`http://127.0.0.1:${port}/api/state`);
      ok = home.ok && (await home.text()).includes('<') && state.ok;
    } catch {}
    if (!ok) await new Promise(r => setTimeout(r, 500));
  }
  if (!ok) throw new Error(`工作台 30 秒内没起来：\n${output}`);
  console.log('✓ 假飞书、假模型下工作台能打开');
} finally {
  child.kill();
}

// 启动命令首跑：在临时目录里跑，确认建好 .env（600）并请用户提供模型信息
const dir = mkdtempSync(path.join(os.tmpdir(), 'setup-smoke-'));
try {
  for (const item of ['setup.mjs', 'src', '.env.example', 'package.json']) cpSync(item, path.join(dir, item), { recursive: true });
  symlinkSync(path.resolve('node_modules'), path.join(dir, 'node_modules'), 'dir');
  const out = execFileSync(process.execPath, ['setup.mjs'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
  if (!out.includes('== 下一步 ==') || !out.includes('接口地址、密钥、模型名')) throw new Error(`启动命令首跑输出不对：\n${out}`);
  if ((statSync(path.join(dir, '.env')).mode & 0o777) !== 0o600) throw new Error('.env 权限不是 600');
  console.log('✓ 启动命令首跑：建好 .env 并请用户提供模型信息');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
