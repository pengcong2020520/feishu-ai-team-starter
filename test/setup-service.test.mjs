import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serviceStatus, startService, stopService } from '../src/setup/service.mjs';

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

test('服务启动失败时带回日志里的报错', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setup-svc-'));
  writeFileSync(path.join(root, 'bad-main.mjs'), "console.error('缺少配置：FEISHU_PRODUCT_APP_ID'); process.exit(1);");
  const r = await startService(root, { entry: 'bad-main.mjs', intervalMs: 50 });
  assert.equal(r.ok, false);
  assert.match(r.error, /FEISHU_PRODUCT_APP_ID/);
  assert.equal(serviceStatus(root).running, false);
});
