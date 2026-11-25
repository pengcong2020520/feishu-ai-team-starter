// 由 install.mjs 在后台启动：跑 npm ci，日志写 data/install.log，结果写回 data/install.json
import { openSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const [registry] = process.argv.slice(2);
const log = openSync('data/install.log', 'a');
const win = process.platform === 'win32';
const child = spawn(win ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund', `--registry=${registry}`], { stdio: ['ignore', log, log], shell: win });
const finish = (code, reason) => {
  const s = JSON.parse(readFileSync('data/install.json', 'utf8'));
  writeFileSync('data/install.json', JSON.stringify({ ...s, status: code === 0 ? 'ok' : 'failed', code, reason, finishedAt: new Date().toISOString() }));
};
child.on('error', error => finish(-1, error.message));
child.on('exit', code => finish(code ?? -1));
