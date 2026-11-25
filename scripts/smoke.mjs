// 冒烟测试：语法检查 → 用假飞书、假模型起工作台并能打开
import { execFileSync, spawn } from 'node:child_process';

const files = execFileSync('git', ['ls-files', '*.mjs'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
for (const file of files) execFileSync(process.execPath, ['--check', file]);
console.log(`✓ 语法检查 ${files.length} 个文件`);

const child = spawn(process.execPath, ['scripts/try-workbench.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', d => { output += d; });
child.stderr.on('data', d => { output += d; });
try {
  const end = Date.now() + 30000;
  let ok = false;
  while (!ok && Date.now() < end) {
    try {
      const home = await fetch('http://127.0.0.1:4890/');
      const state = await fetch('http://127.0.0.1:4890/api/state');
      ok = home.ok && (await home.text()).includes('<') && state.ok;
    } catch {}
    if (!ok) await new Promise(r => setTimeout(r, 500));
  }
  if (!ok) throw new Error(`工作台 30 秒内没起来：\n${output}`);
  console.log('✓ 假飞书、假模型下工作台能打开');
} finally {
  child.kill();
}
