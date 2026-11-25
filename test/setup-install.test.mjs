import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REQUIRED, NPMJS, MIRROR, depsReady, pickRegistry, installStatus, startInstall, waitForInstall } from '../src/setup/install.mjs';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'setup-install-'));
const fakeDeps = root => { for (const name of REQUIRED) { mkdirSync(path.join(root, 'node_modules', name), { recursive: true }); writeFileSync(path.join(root, 'node_modules', name, 'package.json'), '{}'); } };

test('三个依赖都在才算装好', () => {
  const root = tmp();
  assert.equal(depsReady(root), false);
  fakeDeps(root);
  assert.equal(depsReady(root), true);
});

test('npm 官方源连不上就换 npmmirror', async () => {
  assert.equal(await pickRegistry({ fetchImpl: async () => new Response('{}') }), NPMJS);
  assert.equal(await pickRegistry({ fetchImpl: async () => { throw new Error('timeout'); } }), MIRROR);
});

test('安装进程意外退出算失败；装完且依赖齐全算成功', async () => {
  const root = tmp();
  assert.equal(installStatus(root).status, 'none');
  const s = startInstall(root, { registry: NPMJS, spawnImpl: () => ({ pid: 999999, unref() {} }) });
  assert.equal(s.status, 'running');
  assert.equal(installStatus(root).status, 'failed');
  writeFileSync(path.join(root, 'data/install.json'), JSON.stringify({ status: 'ok', code: 0 }));
  assert.deepEqual(await waitForInstall(root, { timeoutMs: 50, intervalMs: 10 }), { ok: false, reason: '依赖不完整，重跑会重新安装' });
  fakeDeps(root);
  assert.deepEqual(await waitForInstall(root, { timeoutMs: 50, intervalMs: 10 }), { ok: true });
});

test('还在装时等到超时返回 pending', async () => {
  const root = tmp();
  mkdirSync(path.join(root, 'data'));
  writeFileSync(path.join(root, 'data/install.json'), JSON.stringify({ status: 'running', pid: process.pid }));
  assert.deepEqual(await waitForInstall(root, { timeoutMs: 30, intervalMs: 10 }), { ok: false, pending: true });
});
