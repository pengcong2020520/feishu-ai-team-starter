import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { pickPort, portsFree, serviceStatus, startService, stopService } from '../src/setup/service.mjs';

test('后台启动、不重复启动、停止', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setup-svc-'));
  writeFileSync(path.join(root, 'fake-main.mjs'), "console.log('3 个机器人已连上飞书'); setInterval(() => {}, 1000);");
  const first = await startService(root, { entry: 'fake-main.mjs', intervalMs: 50 });
  assert.equal(first.ok, true);
  assert.equal(serviceStatus(root).running, true);
  const second = await startService(root, { entry: 'fake-main.mjs', intervalMs: 50 });
  assert.deepEqual([second.ok, second.already, second.pid], [true, true, first.pid]);
  assert.deepEqual(await stopService(root), { stopped: true });
  assert.equal(serviceStatus(root).running, false);
  assert.equal(existsSync(path.join(root, 'data/service.pid')), false);
});

test('沙箱里没有权限发停止信号：不报错退出，保留 pid 文件，说明是谁停不掉', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setup-svc-'));
  writeFileSync(path.join(root, 'fake-main.mjs'), "console.log('3 个机器人已连上飞书'); setInterval(() => {}, 1000);");
  const first = await startService(root, { entry: 'fake-main.mjs', intervalMs: 50 });
  const denied = () => { throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' }); };
  assert.deepEqual(await stopService(root, { kill: denied }), { stopped: false, denied: true, pid: first.pid });
  assert.equal(serviceStatus(root).running, true);
  assert.deepEqual(await stopService(root), { stopped: true });
});

test('服务启动失败时带回日志里的报错', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setup-svc-'));
  writeFileSync(path.join(root, 'bad-main.mjs'), "console.error('缺少配置：FEISHU_PRODUCT_APP_ID'); process.exit(1);");
  const r = await startService(root, { entry: 'bad-main.mjs', intervalMs: 50 });
  assert.equal(r.ok, false);
  assert.match(r.error, /FEISHU_PRODUCT_APP_ID/);
  assert.equal(serviceStatus(root).running, false);
});

test('端口被占时跳到下一对空闲端口', async () => {
  const blocker = net.createServer();
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const busy = blocker.address().port;
  try {
    assert.equal(await portsFree(busy), false);
    const picked = await pickPort(busy);
    assert.notEqual(picked, busy);
    assert.equal((picked - busy) % 10, 0);
  } finally {
    blocker.close();
  }
});

test('服务因端口占用起不来时，提示改 PREVIEW_PORT', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setup-svc-'));
  writeFileSync(path.join(root, 'busy-main.mjs'), "console.error(\"Error: listen EADDRINUSE: address already in use 127.0.0.1:4871\"); process.exit(1);");
  const r = await startService(root, { entry: 'busy-main.mjs', intervalMs: 50 });
  assert.equal(r.ok, false);
  assert.match(r.error, /端口 4871 被别的程序占用：在 \.env 里把 PREVIEW_PORT 改成别的/);
});

test('pid 文件指向的进程不是我们的服务（PID 被复用），不算在运行，也不发信号', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setup-svc-'));
  (await import('node:fs')).mkdirSync(path.join(root, 'data'));
  writeFileSync(path.join(root, 'data/service.pid'), `${process.pid}\nsrc/main.mjs\n`);
  assert.equal(serviceStatus(root).running, false);
  assert.deepEqual(await stopService(root), { stopped: false });
  assert.equal(existsSync(path.join(root, 'data/service.pid')), false);
});
