import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { team } from '../src/setup/team.mjs';
import { ADDONS, installRetry, registerMissing, registerRole } from '../src/setup/register.mjs';

const qrcode = { async toFile(file) { writeFileSync(file, 'png'); } };

test('文档与素材上传权限只附加到需要发布文档的协调角色', async () => {
  const requested=[];
  const lark={registerApp:async input=>{requested.push(input.addons.scopes.tenant);return{client_id:'cli_test',client_secret:'test-only'};}};
  await registerRole({lark,role:{key:'chief',name:'协调者',mode:'projects',documents:true}});
  await registerRole({lark,role:{key:'writer',name:'作者',mode:'projects'}});
  for(const scope of ['docx:document','docs:permission.member:create','docs:document.media:upload']){
    assert.ok(requested[0].includes(scope));assert.ok(!requested[1].includes(scope));
  }
});

test('基础版产品经理接收全部群消息；私聊和成员管理仅多项目版申请', async () => {
  const requested = [];
  const lark = { registerApp: async options => { requested.push(options.addons.scopes.tenant); return { client_id: 'cli_new', client_secret: 'test-only' }; } };
  await registerRole({ lark, role: { ...team[0], mode: 'basic' } });
  await registerRole({ lark, role: { ...team[0], mode: 'projects' } });
  for (const scope of ['im:message.group_msg', 'im:message.p2p_msg:readonly', 'im:chat.members:write_only']) {
    assert.equal(requested[0].includes(scope), scope === 'im:message.group_msg');
    assert.equal(requested[1].includes(scope), true);
  }
});

test('多项目授权更新指定现有机器人，不重建；应用号不一致时不保存', async () => {
  let options;
  const lark = { registerApp: async input => { options = input; return { client_id: 'cli_existing', client_secret: 'test-only' }; } };
  const role = { ...team[0], existingAppId: 'cli_existing' };
  await registerRole({ lark, role, onQr: () => {} });
  assert.equal(options.appId, 'cli_existing'); assert.notEqual(options.createOnly, true);
  assert.ok(options.addons.scopes.tenant.includes('im:message.group_msg'));
  lark.registerApp = async () => ({ client_id: 'cli_other', client_secret: 'test-only' });
  await assert.rejects(registerRole({ lark, role, onQr: () => {} }), /不一致/);
});

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
      assert.deepEqual(options.addons, name === 'AI 产品经理' ? {...ADDONS,scopes:{tenant:[...ADDONS.scopes.tenant,'im:message.group_msg']}} : ADDONS);
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

test('一位角色生成二维码失败，仍打开页面让其他角色继续扫码', async () => {
  const qrDir = mkdtempSync(path.join(os.tmpdir(), 'setup-qr-partial-'));
  let opened = 0;
  const lark = { async registerApp(options) {
    if (options.appPreset.name === 'AI 产品经理') throw Object.assign(new Error('denied'), { code: 'access_denied' });
    options.onQRCodeReady({ url: 'https://qr.test/available', expireIn: 600 });
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(opened, 1);
    return { client_id: 'cli_created', client_secret: 'test-only' };
  } };
  const results = await registerMissing({ lark, qrcode, roles: team.slice(0, 2), qrDir, save: async () => {}, open: () => { opened++; }, log: () => {} });
  assert.deepEqual(results.map(r => r.ok), [false, true]);
  assert.equal(opened, 1);
});

test('重试也没救回来的断网：换一张新码继续等，不让这个角色直接失败', async () => {
  const qrDir = mkdtempSync(path.join(os.tmpdir(), 'setup-qr-'));
  let calls = 0; const logs = [];
  const lark = {
    async registerApp(options) {
      calls += 1;
      options.onQRCodeReady({ url: `https://qr.test/${calls}`, expireIn: 600 });
      if (calls < 3) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      return { client_id: 'cli_ok', client_secret: 's', user_info: { open_id: 'ou' } };
    },
  };
  const results = await registerMissing({ lark, qrcode, roles: team.slice(0, 1), qrDir, save: async () => {}, retryDelayMs: 1, open: () => {}, log: l => logs.push(l) });
  assert.deepEqual(results.map(r => r.ok), [true]);
  assert.equal(calls, 3);
  assert.ok(logs.some(l => l.includes('网络中断')));
});
