import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { team } from '../src/setup/team.mjs';
import { ADDONS, installRetry, registerMissing } from '../src/setup/register.mjs';

const qrcode = { async toFile(file) { writeFileSync(file, 'png'); } };

test('扫码轮询断网时重试，其他请求和非网络错误不重试', async () => {
  let handler; let resent = 0;
  const http = { interceptors: { response: { use: (_ok, fail) => { handler = fail; } } }, request: async config => { resent += 1; return { data: 'again', config }; } };
  installRetry(http, { delayMs: 1 });
  installRetry(http, { delayMs: 1 });
  const config = { url: 'https://accounts.feishu.cn/oauth/v1/app/registration' };
  assert.equal((await handler({ code: 'ECONNRESET', message: 'socket hang up', config })).data, 'again');
  assert.equal(resent, 1);
  await assert.rejects(handler({ code: 'ECONNRESET', message: 'x', config: { url: 'https://open.feishu.cn/other' } }));
  await assert.rejects(handler({ message: 'bad', response: { status: 400 }, config: { ...config } }));
  await assert.rejects(handler({ code: 'ETIMEDOUT', message: 'x', config: { ...config, __setupRetries: 5 } }));
});

test('只给缺的角色出码；过期换码；每建成一个就保存；出完码打开页面', async () => {
  const qrDir = mkdtempSync(path.join(os.tmpdir(), 'setup-qr-'));
  const calls = {}; const saved = []; const opened = [];
  const lark = {
    async registerApp(options) {
      const name = options.appPreset.name;
      calls[name] = (calls[name] ?? 0) + 1;
      assert.equal(options.createOnly, true);
      assert.deepEqual(options.addons, ADDONS);
      options.onQRCodeReady({ url: `https://qr.test/${encodeURIComponent(name)}/${calls[name]}`, expireIn: 600 });
      await new Promise(r => setTimeout(r, 5));
      if (name === 'AI 设计' && calls[name] === 1) throw Object.assign(new Error('expired'), { code: 'expired_token' });
      return { client_id: `cli_${calls[name]}`, client_secret: 'secret', user_info: { open_id: 'ou_owner' } };
    },
  };
  const roles = team.filter(r => r.key !== 'developer');
  const results = await registerMissing({ lark, qrcode, roles, qrDir, save: async (role, r) => { saved.push([role.key, r]); }, open: f => opened.push(f), log: () => {} });
  assert.deepEqual(results.map(r => [r.role.key, r.ok]), [['product', true], ['designer', true]]);
  assert.deepEqual(calls, { 'AI 产品经理': 1, 'AI 设计': 2 });
  assert.deepEqual(saved.map(([k, r]) => [k, r.appId, r.openId]).sort(), [['designer', 'cli_2', 'ou_owner'], ['product', 'cli_1', 'ou_owner']]);
  assert.equal(opened.length, 1);
  assert.ok(existsSync(path.join(qrDir, 'index.html')));
  assert.match(readFileSync(path.join(qrDir, 'index.html'), 'utf8'), /✓ 已创建/);
});

test('等扫码超时、手机上拒绝，都按角色报出来', async () => {
  const qrDir = mkdtempSync(path.join(os.tmpdir(), 'setup-qr-'));
  const lark = {
    registerApp: options => new Promise((resolve, reject) => {
      options.onQRCodeReady({ url: 'https://qr.test/x', expireIn: 600 });
      if (options.appPreset.name === 'AI 设计') return reject(Object.assign(new Error('denied'), { code: 'access_denied' }));
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'abort' })));
    }),
  };
  const results = await registerMissing({ lark, qrcode, roles: team.slice(0, 2), qrDir, save: async () => {}, timeoutMs: 30, open: () => {}, log: () => {} });
  assert.deepEqual(results.map(r => [r.role.key, r.ok, r.error?.code]), [['product', false, 'timeout'], ['designer', false, 'access_denied']]);
});
