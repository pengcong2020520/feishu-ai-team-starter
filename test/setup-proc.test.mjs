import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOurProcess } from '../src/setup/proc.mjs';

const spawnError = code => () => { throw Object.assign(new Error(`spawnSync ps ${code}`), { code }); };

test('命令行里有我们的脚本才算是我们的进程', () => {
  assert.equal(isOurProcess(process.pid, 'src/main.mjs', { ps: () => 'node src/main.mjs\n' }), true);
  assert.equal(isOurProcess(process.pid, 'src/main.mjs', { ps: () => 'node other.mjs\n' }), false);
  assert.equal(isOurProcess(0, 'src/main.mjs', { ps: () => 'node src/main.mjs\n' }), false);
});

test('沙箱里 ps 启动不了（EPERM）：PID 还活着就算在跑，不会被当成没起来而重复启动', { skip: process.platform === 'win32' }, () => {
  assert.equal(isOurProcess(process.pid, 'src/main.mjs', { ps: spawnError('EPERM') }), true);
  assert.equal(isOurProcess(process.pid, 'src/main.mjs', { ps: spawnError('ENOENT') }), true);
});

test('ps 跑了但没找到这个进程（退出码 1）：不算我们的', { skip: process.platform === 'win32' }, () => {
  const exited = () => { throw Object.assign(new Error('Command failed: ps'), { status: 1 }); };
  assert.equal(isOurProcess(process.pid, 'src/main.mjs', { ps: exited }), false);
});

test('PID 已经不在了：不管 ps 怎样都不算在跑', () => {
  assert.equal(isOurProcess(2 ** 22 + 12345, 'src/main.mjs', { ps: spawnError('EPERM') }), false);
});
