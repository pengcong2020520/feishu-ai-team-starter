import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { REQUIRED, NPMJS, MIRROR, depsReady, pickRegistry, installStatus, startInstall, waitForInstall, installEnv } from '../src/setup/install.mjs';

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
  writeFileSync(path.join(root, 'install-run.mjs'), 'setInterval(() => {}, 1000);');
  const child = spawn(process.execPath, [path.join(root, 'install-run.mjs')], { stdio: 'ignore' });
  try {
    writeFileSync(path.join(root, 'data/install.json'), JSON.stringify({ status: 'running', pid: child.pid }));
    assert.deepEqual(await waitForInstall(root, { timeoutMs: 30, intervalMs: 10 }), { ok: false, pending: true });
  } finally { child.kill(); }
});

test('PID 还活着但不是安装进程（被系统复用了），算安装失败', () => {
  const root = tmp();
  mkdirSync(path.join(root, 'data'));
  writeFileSync(path.join(root, 'data/install.json'), JSON.stringify({ status: 'running', pid: process.pid }));
  assert.equal(installStatus(root).status, 'failed');
});

test('装依赖的子进程拿不到模型和飞书的密钥', () => {
  const env = installEnv({ PATH: '/bin', HTTPS_PROXY: 'http://p', ANTHROPIC_AUTH_TOKEN: 't', ANTHROPIC_API_KEY: 'k', MODEL_API_KEY: 'm', FEISHU_PRODUCT_APP_SECRET: 's' });
  assert.deepEqual(env, { PATH: '/bin', HTTPS_PROXY: 'http://p' });
  let options;
  process.env.ANTHROPIC_AUTH_TOKEN = 'leak-test';
  try { startInstall(tmp(), { registry: NPMJS, spawnImpl: (_cmd, _args, o) => { options = o; return { pid: 1, unref() {} }; } }); }
  finally { delete process.env.ANTHROPIC_AUTH_TOKEN; }
  assert.equal(options.env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.ok(options.env.PATH);
});
