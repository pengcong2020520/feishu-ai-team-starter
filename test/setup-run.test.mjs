import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSetup } from '../src/setup/run.mjs';
import { readProgress, saveProgress } from '../src/setup/progress.mjs';

const MODEL = 'MODEL_BASE_URL=https://m.test/api\nMODEL_API_KEY=sk-secret-123\nMODEL_NAME=m1\n';
const BOTS = ['PRODUCT', 'DESIGNER', 'DEVELOPER'].map(k => `FEISHU_${k}_APP_ID=cli_${k.toLowerCase()}\nFEISHU_${k}_APP_SECRET=s_${k}\n`).join('');

function setupRoot(envText) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setup-run-'));
  writeFileSync(path.join(root, '.env.example'), '# 模板\nMODEL_BASE_URL=https://example.com/api/compatible\nMODEL_API_KEY=xxx\nMODEL_NAME=xxx\n');
  if (envText !== undefined) writeFileSync(path.join(root, '.env'), envText, { mode: 0o600 });
  return root;
}

function fakes(over = {}) {
  const calls = { install: 0, scan: [], group: [], service: 0 };
  let running = false;
  const deps = {
    depsReady: () => true,
    installStatus: () => ({ status: 'ok' }),
    pickRegistry: async () => 'https://registry.npmjs.org/',
    startInstall: () => { calls.install += 1; return { status: 'running' }; },
    waitForInstall: async () => ({ ok: true }),
    installLogTail: () => '',
    checkModel: async () => ({ ok: true }),
    serviceStatus: () => ({ running }),
    startService: async () => { calls.service += 1; running = true; return { ok: true, pid: 1 }; },
    loadFeishu: async () => ({
      lark: { defaultHttpInstance: {}, LoggerLevel: { error: 0 }, Client: class { constructor(o) { this.appId = o.appId; } } },
      qrcode: {},
      installRetry: () => {},
      registerMissing: async ({ roles, save }) => { calls.scan.push(roles.map(r => r.key)); for (const role of roles) await save(role, { appId: `cli_new_${role.key}`, appSecret: 'new-secret', openId: 'ou_me' }); return roles.map(role => ({ role, ok: true, error: null })); },
      createTeamGroup: async args => { calls.group.push(args); return { chatId: 'oc_team', ownerSet: true, joinLink: null }; },
    }),
    ...over,
  };
  return { deps, calls };
}

async function run(root, argv, { deps, env = {}, stdin = '' }) {
  const out = [];
  const code = await runSetup({ root, argv, env, readStdin: async () => stdin, log: line => out.push(line), deps });
  return { code, text: out.join('\n') };
}

test('首跑：按模板建 .env（600），在后台装依赖，问用户要模型三项', async () => {
  const root = setupRoot();
  const { deps, calls } = fakes({ depsReady: () => false, installStatus: () => ({ status: 'none' }) });
  const { code, text } = await run(root, [], { deps });
  assert.equal(code, 0);
  assert.equal(statSync(path.join(root, '.env')).mode & 0o777, 0o600);
  assert.equal(calls.install, 1);
  assert.match(text, /== 下一步 ==/);
  assert.match(text, /接口地址、密钥、模型名/);
});

test('model 子命令：密钥从标准输入写入，输出里没有密钥', async () => {
  const root = setupRoot();
  const { deps } = fakes({ checkModel: async () => ({ ok: false, reason: '密钥不对或没有权限：检查 MODEL_API_KEY（HTTP 401）' }) });
  const { text } = await run(root, ['model', '--base-url', 'https://m.test/api', '--model', 'm1'], { deps, stdin: 'sk-secret-123\n' });
  assert.match(readFileSync(path.join(root, '.env'), 'utf8'), /MODEL_API_KEY=sk-secret-123/);
  assert.match(text, /MODEL_API_KEY/);
  assert.doesNotMatch(text, /sk-secret-123/);
});

test('沿用终端变量：只报变量名，不出现值', async () => {
  const root = setupRoot();
  const { deps } = fakes();
  const env = { ANTHROPIC_BASE_URL: 'https://gw.test', ANTHROPIC_AUTH_TOKEN: 'tok-secret', ANTHROPIC_MODEL: 'm2' };
  const { text } = await run(root, ['--use-anthropic-env'], { deps, env });
  assert.match(readFileSync(path.join(root, '.env'), 'utf8'), /MODEL_API_KEY=tok-secret/);
  assert.match(text, /ANTHROPIC_AUTH_TOKEN/);
  assert.doesNotMatch(text, /tok-secret/);
});

test('到扫码这步只提示，不自己开始扫码', async () => {
  const root = setupRoot(MODEL);
  saveProgress(root, { modelOk: true });
  const { deps, calls } = fakes();
  const { text } = await run(root, [], { deps });
  assert.deepEqual(calls.scan, []);
  assert.match(text, /node setup\.mjs scan/);
  assert.match(text, /飞书手机版/);
});

test('scan：只扫缺的角色，写凭证，建群，起服务，最后让用户去群里 @', async () => {
  const root = setupRoot(MODEL + 'FEISHU_PRODUCT_APP_ID=cli_old\nFEISHU_PRODUCT_APP_SECRET=s_old\n');
  saveProgress(root, { modelOk: true });
  const { deps, calls } = fakes();
  const { code, text } = await run(root, ['scan'], { deps });
  assert.equal(code, 0);
  assert.deepEqual(calls.scan, [['designer', 'developer']]);
  const env = readFileSync(path.join(root, '.env'), 'utf8');
  assert.match(env, /FEISHU_DESIGNER_APP_ID=cli_new_designer/);
  assert.match(env, /FEISHU_PRODUCT_APP_ID=cli_old/);
  assert.equal(calls.group[0].appIds.product, 'cli_old');
  assert.equal(calls.group[0].ownerOpenId, undefined);
  assert.equal(calls.service, 1);
  assert.equal(readProgress(root).groupReady, true);
  assert.match(text, /@AI 产品经理/);
  assert.match(text, /127\.0\.0\.1:4870/);
  assert.doesNotMatch(text, /new-secret|s_old|sk-secret-123/);
});

test('扫产品经理的码时拿到的 open_id 用来当群主', async () => {
  const root = setupRoot(MODEL);
  saveProgress(root, { modelOk: true });
  const { deps, calls } = fakes();
  await run(root, ['scan'], { deps });
  assert.equal(calls.group[0].ownerOpenId, 'ou_me');
});

test('依赖还在装：提示稍后重跑', async () => {
  const root = setupRoot(MODEL + BOTS);
  saveProgress(root, { modelOk: true });
  const { deps } = fakes({ depsReady: () => false, installStatus: () => ({ status: 'running' }), waitForInstall: async () => ({ ok: false, pending: true }) });
  const { code, text } = await run(root, [], { deps });
  assert.equal(code, 0);
  assert.match(text, /依赖还在后台安装/);
});

test('都好了再跑只报状态；不认识的参数报错', async () => {
  const root = setupRoot(MODEL + BOTS);
  saveProgress(root, { modelOk: true, groupReady: true, chatId: 'oc', ownerSet: true });
  const { deps, calls } = fakes({ serviceStatus: () => ({ running: true }) });
  const done = await run(root, [], { deps });
  assert.match(done.text, /都好了/);
  assert.equal(calls.service, 0);
  assert.equal((await run(root, ['--nope'], { deps })).code, 1);
});
